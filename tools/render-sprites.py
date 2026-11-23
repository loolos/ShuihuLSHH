"""把带动画的 3D 模型渲染成原版风格的精灵图条（扩展包用，docs/game-design.md §15.6）。

用法（需要 Blender 的 Python 模块 bpy，可 `pip install bpy`，要求 Python 版本与 bpy 轮子一致）：
  python tools/render-sprites.py 模型.glb|.fbx 输出目录 [--height 1.75 | --length 2.2] [--ppm 50] [--frames 12] [--scale-by bones|mesh] [--outfit 上色.json]
         [--actions 名字,名字] [--yaw 0] [--samples 16]

- 相机：正交，俯角 30.7°（原版菱形格 90×46，sin 俯角 = 46/90），方位角 45°，和原版等距格对齐。
- 比例：--ppm 每米多少像素（默认 50：1.75 m 的人站着约 65 像素高，接近原版武龍）。
  模型尺寸不对时用 --height 把模型整体缩放到这个身高（米）；四足动物用 --length 按身长缩放。
- 朝向：只渲染 front（正面朝斜下）和 back（背面朝斜上）两个方向，另两个由游戏水平镜像（原版 Man.lib 朝向 1/3 正是 0/2 的镜像）。
  模型的正面不是 -Y 时用 --yaw 转（度）。
- 每个动作取 --frames 帧（均匀采样），输出 <动作>-<方向>-<帧数>f.png 横条：每帧 160×160，脚底（模型原点）在 (80,120)；
  再输出 sprites.json（每帧时长、锚点）。颜色缩到原版 Default.pal，影子画成第 159 色（原版做法）。
"""
import argparse
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

CW, CH, AX, AY = 160, 160, 80, 120
ELEV = math.degrees(math.asin(46 / 90))
SHADOW_INDEX = 159


def parse_args():
    argv = sys.argv[1:]
    if '--' in argv:
        argv = argv[argv.index('--') + 1:]
    p = argparse.ArgumentParser()
    p.add_argument('model')
    p.add_argument('out')
    p.add_argument('--palette', default=os.path.join(os.path.dirname(__file__), '..', 'gamedata', 'original', 'Data', 'Default.pal'))
    p.add_argument('--ppm', type=float, default=50)
    p.add_argument('--height', type=float, help='把模型缩放到这个身高（米）')
    p.add_argument('--length', type=float, help='把模型缩放到这个身长（米，四足动物）')
    p.add_argument('--frames', type=int, default=12)
    p.add_argument('--actions', help='只渲染这些动作（逗号分隔）')
    p.add_argument('--yaw', type=float, default=0)
    p.add_argument('--samples', type=int, default=16)
    p.add_argument('--ms', type=int, default=0, help='每帧时长（毫秒），0 = 按动作原长平均分')
    p.add_argument('--scale-by', choices=['bones', 'mesh'], default='bones',
                   help='按什么量尺寸：bones = 待机姿势的骨骼（Sketchfab 老虎这类网格单位不可靠的模型），mesh = 静止网格（UAL 假人这类骨骼带缩放的模型）')
    p.add_argument('--sun', type=float, default=2.5, help='主光强度')
    p.add_argument('--ambient', type=float, default=0.9, help='环境光强度（小一点明暗对比更强）')
    p.add_argument('--toon', type=int, default=0, help='平涂明暗档数（如 3）；0 = 照常的连续明暗。需要 --outfit')
    p.add_argument('--outline', action='store_true', help='外轮廓和衣物分界画深色描边')
    p.add_argument('--poses', help='自拼动作 JSON：在已有动作的某一帧上按世界坐标轴转动骨骼、打关键帧，生成新动作（如踢腿，见 make_actions）')
    p.add_argument('--anims', help='从别的 glb/fbx 借动作（逗号分隔）：骨骼名相同的模型直接通用（如 UAL2 女假人 Mannequin_F 没有动作，借 UAL1/UAL2 的）')
    p.add_argument('--outfit', help='上色方案 JSON：按骨骼给通用假人模型的各部位上色（见 apply_outfit）')
    return p.parse_args(argv)


def load_palette(path):
    raw = np.frombuffer(open(path, 'rb').read()[:768], dtype=np.uint8).reshape(256, 3).astype(np.int32)
    # 可用颜色：16 号以后的色阶（0–15 是界面专用色），去掉影子色
    usable = [i for i in range(16, 256) if i != SHADOW_INDEX]
    return raw, np.array(usable)


def apply_outfit(path):
    """给没有衣服的通用人形模型（如 Quaternius UAL 假人）"穿衣服"：按部位上色、把衣服部位往外鼓（宽袖、宽裤、衣摆），
    再挂上小部件（发髻等）。全部在静止姿势下按世界坐标（米，模型正面朝 -Y）判断，蒙皮权重不变，所以动作照常。
    JSON：
      "default": [r,g,b]
      "rules": [{"bones": ["正则",...]（可省）, "when": "表达式"（可省）, "color": [r,g,b], "inflate": 米（可省）}, ...]
        每个顶点按顺序找第一条匹配的规则。bones 匹配权重最大的骨骼；when 是 Python 表达式，
        可用 x y z（世界坐标）、ax（|x|）、b（骨骼名）。inflate 沿法线把顶点往外推；folds（0–1）是布料褶皱强度。
      "shading": {"ao": 缝隙变暗 0–1, "edge": 轮廓变暗 0–1, "fold_scale": 褶皱疏密, "fold_strength": 褶皱深浅, "fold_distortion": 褶皱扭曲}（可省）
      "layers": [{"name": 名字, "bones": [...], "when": "表达式", "offset": 米或表达式（往外推多少）, "thickness": 米,
                  "color": [r,g,b], "colors": [{"when": "表达式", "color": [r,g,b]}, ...]（包边等，先匹配先用）, "folds": 0–1}, ...]
        分层衣物：从身体复制出选中部位的外壳，往外推再加厚，权重照抄。里层 offset 小、外层大，就能一层压一层。
      "props": [{"bone": "Head", "shape": "sphere", "radius": 米, "at": [x,y,z], "scale": [sx,sy,sz], "color": [r,g,b]}, ...]
        shape 还可以是 "box"（边长 1 米的方块，用 scale 定长宽高）、"cylinder"（radius、depth）；"rot": [x,y,z] 度数旋转。
        兵器（如李逵的板斧）用 cylinder 做柄、box 做刃，挂在 hand_r / hand_l 上。
    颜色 0–255。"""
    import re
    cfg = json.load(open(path, encoding='utf-8'))
    arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    rules = [(re.compile('|'.join(r['bones'])) if r.get('bones') else None,
              compile(r['when'], 'when', 'eval') if r.get('when') else None, r) for r in cfg['rules']]

    sh = {'ao': 0.55, 'edge': 0.35, 'fold_scale': 9.0, 'fold_strength': 0.8, 'fold_distortion': 6.0, **cfg.get('shading', {})}

    def outfit_material(name):
        """颜色 = 顶点色 × 缝隙变暗（AO）× 轮廓变暗（侧面朝外的地方暗一些，显得更立体）；
        衣服部位（规则里 folds > 0）再加凹凸褶皱。褶皱纹理用 Generated 坐标（静止姿势），动起来不会滑动。"""
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        nt = mat.node_tree
        N, L = nt.nodes, nt.links.new
        bsdf = N['Principled BSDF']
        bsdf.inputs['Roughness'].default_value = 0.85
        ca = N.new('ShaderNodeVertexColor'); ca.layer_name = 'Outfit'
        ao = N.new('ShaderNodeAmbientOcclusion'); ao.inputs['Distance'].default_value = 0.06
        aof = N.new('ShaderNodeMapRange'); aof.inputs['To Min'].default_value = 1 - sh['ao']
        L(ao.outputs['AO'], aof.inputs['Value'])
        lw = N.new('ShaderNodeLayerWeight'); lw.inputs['Blend'].default_value = 0.35
        edf = N.new('ShaderNodeMapRange'); edf.inputs['To Min'].default_value = 1; edf.inputs['To Max'].default_value = 1 - sh['edge']
        L(lw.outputs['Facing'], edf.inputs['Value'])
        m1 = N.new('ShaderNodeMix'); m1.data_type = 'RGBA'; m1.blend_type = 'MULTIPLY'; m1.inputs['Factor'].default_value = 1
        L(ca.outputs['Color'], m1.inputs['A']); L(aof.outputs['Result'], m1.inputs['B'])
        m2 = N.new('ShaderNodeMix'); m2.data_type = 'RGBA'; m2.blend_type = 'MULTIPLY'; m2.inputs['Factor'].default_value = 1
        L(m1.outputs['Result'], m2.inputs['A']); L(edf.outputs['Result'], m2.inputs['B'])
        L(m2.outputs['Result'], bsdf.inputs['Base Color'])
        # 褶皱：竖向为主的扭曲波纹，强度由顶点属性 Folds 控制
        tc = N.new('ShaderNodeTexCoord')
        wv = N.new('ShaderNodeTexWave'); wv.wave_type = 'BANDS'; wv.bands_direction = 'X'
        wv.inputs['Scale'].default_value = sh['fold_scale']; wv.inputs['Distortion'].default_value = sh['fold_distortion']
        wv.inputs['Detail'].default_value = 2
        L(tc.outputs['Generated'], wv.inputs['Vector'])
        fa = N.new('ShaderNodeAttribute'); fa.attribute_name = 'Folds'
        hm = N.new('ShaderNodeMath'); hm.operation = 'MULTIPLY'
        L(wv.outputs['Fac'], hm.inputs[0]); L(fa.outputs['Fac'], hm.inputs[1])
        bump = N.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = sh['fold_strength']
        bump.inputs['Distance'].default_value = 0.02
        L(hm.outputs['Value'], bump.inputs['Height']); L(bump.outputs['Normal'], bsdf.inputs['Normal'])
        # 平涂明暗（--toon）要第二遍只渲固有色：ToonFlat = 1 时输出纯顶点色（自发光）
        em = N.new('ShaderNodeEmission'); L(ca.outputs['Color'], em.inputs['Color'])
        tf = N.new('ShaderNodeValue'); tf.name = 'ToonFlat'; tf.outputs[0].default_value = 0
        mix = N.new('ShaderNodeMixShader')
        L(tf.outputs[0], mix.inputs['Fac']); L(bsdf.outputs['BSDF'], mix.inputs[1]); L(em.outputs['Emission'], mix.inputs[2])
        L(mix.outputs['Shader'], N['Material Output'].inputs['Surface'])
        return mat

    lin = lambda col: [(c / 255) ** 2.2 for c in col] + [1]
    bodies = [o for o in bpy.context.scene.objects if o.type == 'MESH']

    def vertex_env(ob, v, names):
        bone = names.get(max(v.groups, key=lambda g: g.weight).group, '') if v.groups else ''
        p = ob.matrix_world @ v.co
        return bone, {'x': p.x, 'y': p.y, 'z': p.z, 'ax': abs(p.x), 'b': bone}

    # 分层衣物：从身体网格复制出一块外壳（只留选中的部位），沿法线往外推，加厚度，蒙皮权重照抄，所以跟着骨骼动
    for lay in cfg.get('layers', []):
        rx = re.compile('|'.join(lay['bones'])) if lay.get('bones') else None
        cond = compile(lay['when'], 'when', 'eval') if lay.get('when') else None
        off = compile(str(lay.get('offset', 0.02)), 'offset', 'eval')
        cols = [(compile(c['when'], 'when', 'eval'), c['color']) for c in lay.get('colors', [])]
        for body in bodies:
            ob = body.copy(); ob.data = body.data.copy(); ob.name = lay.get('name', 'Layer')
            for col in body.users_collection:
                col.objects.link(ob)
            me = ob.data
            names = {g.index: g.name for g in ob.vertex_groups}
            keep, disp, vcol = set(), {}, {}
            for v in me.vertices:
                bone, env = vertex_env(ob, v, names)
                if rx and not rx.fullmatch(bone):
                    continue
                if cond and not eval(cond, {}, env):
                    continue
                keep.add(v.index)
                disp[v.index] = v.normal.copy() * eval(off, {}, env)
                vcol[v.index] = next((c for w, c in cols if eval(w, {}, env)), lay['color'])
            import bmesh
            bm = bmesh.new(); bm.from_mesh(me)
            bm.verts.ensure_lookup_table()
            for v in bm.verts:
                if v.index in keep:
                    v.co += disp[v.index]
            # 颜色先按原编号写进属性，再删点
            ca = bm.verts.layers.float_color.new('Outfit')
            fl = bm.verts.layers.float.new('Folds')
            for v in bm.verts:
                if v.index in keep:
                    v[ca] = lin(vcol[v.index]); v[fl] = lay.get('folds', 0)
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index not in keep], context='VERTS')
            bm.to_mesh(me); bm.free()
            if not len(me.vertices):
                bpy.data.objects.remove(ob)
                continue
            me.materials.clear()
            me.materials.append(outfit_material('Layer'))
            if lay.get('thickness'):
                sol = ob.modifiers.new('Thick', 'SOLIDIFY')
                sol.thickness = lay['thickness']; sol.offset = -1; sol.use_rim = True
                ob.modifiers.move(len(ob.modifiers) - 1, 0)

    for ob in bodies:
        me = ob.data
        names = {g.index: g.name for g in ob.vertex_groups}
        attr = me.color_attributes.new('Outfit', 'FLOAT_COLOR', 'POINT')
        fold = me.attributes.new('Folds', 'FLOAT', 'POINT')
        moves = []
        for v in me.vertices:
            col, inflate, folds = cfg.get('default', [200, 160, 120]), 0, 0
            bone, env = vertex_env(ob, v, names)
            for rx, cond, r in rules:
                if rx and not rx.fullmatch(bone):
                    continue
                if cond and not eval(cond, {}, env):
                    continue
                col, inflate, folds = r['color'], r.get('inflate', 0), r.get('folds', 0)
                break
            attr.data[v.index].color = lin(col)
            fold.data[v.index].value = folds
            if inflate:
                moves.append((v.index, v.normal.copy() * inflate))
        for i, d in moves:
            me.vertices[i].co += d
        me.materials.clear()
        me.materials.append(outfit_material('Outfit'))

    for pr in cfg.get('props', []):
        shape = pr.get('shape', 'sphere')
        rot = [math.radians(a) for a in pr.get('rot', [0, 0, 0])]
        if shape == 'box':
            bpy.ops.mesh.primitive_cube_add(size=1, location=pr['at'], rotation=rot)
        elif shape == 'cylinder':
            bpy.ops.mesh.primitive_cylinder_add(radius=pr.get('radius', 0.02), depth=pr.get('depth', 0.5), vertices=12,
                                                location=pr['at'], rotation=rot)
        else:
            bpy.ops.mesh.primitive_uv_sphere_add(radius=pr.get('radius', 0.05), segments=16, ring_count=8, location=pr['at'],
                                                 rotation=rot)
        ob = bpy.context.active_object
        ob.scale = pr.get('scale', [1, 1, 1])
        bpy.context.view_layer.update()  # 让 matrix_world 带上缩放，挂到骨骼上时才不会丢
        if shape != 'box':
            bpy.ops.object.shade_smooth()
        attr = ob.data.color_attributes.new('Outfit', 'FLOAT_COLOR', 'POINT')
        for d in attr.data:
            d.color = lin(pr['color'])
        ob.data.materials.append(outfit_material('Prop'))
        mw = ob.matrix_world.copy()
        ob.parent = arm
        ob.parent_type = 'BONE'
        ob.parent_bone = pr['bone']
        bpy.context.view_layer.update()
        ob.matrix_world = mw

    if cfg.get('weapon'):
        build_weapon(arm, cfg['weapon'], lin, outfit_material('Weapon'))


WPN_TINY = 1e-4


def build_weapon(arm, w, lin, mat):
    """双手兵器（枪、棍、弓、大刀）：在骨架上加几根骨骼，让兵器能脱离手单独做动画、两只手用 IK 去握。
      wpn_hand：挂在 hand（默认 hand_r）上，普通动作（走、待机、受击）里兵器跟着这只手；
      wpn_free：挂在 root 上，--poses 里写了 weapon 的动作由它按世界坐标摆兵器，两手前臂的 IK 去够 grip_r / grip_l；
      两根骨骼各挂一份兵器网格，用骨骼缩放（1 或几乎为 0）决定显示哪一份。
    JSON（outfit 的 "weapon"）：
      {"hand": "hand_r", "grip": [x,y,z]（静止姿势里握点的世界坐标）, "dir": [0,-1,0]（静止时兵器指向）, "up": [0,0,1],
       "parts": [{"from": 米, "to": 米, "shape": "cylinder"|"box"|"cone", "radius": 米, "size": [宽,厚], "off": [x,z], "color": [r,g,b]}]}
      parts 沿兵器轴（握点为 0，指向枪尖为正）摆放；off 是横向偏移（弓臂弯曲用）。"""
    from mathutils import Matrix
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones
    inv = arm.matrix_world.inverted()
    grip = inv @ Vector(w.get('grip', [-0.80, -0.03, 1.43]))
    d = Vector(w.get('dir', [0, -1, 0])).normalized()
    up = Vector(w.get('up', [0, 0, 1]))
    hand = w.get('hand', 'hand_r')

    def add(name, parent, head, direction):
        b = eb.new(name)
        b.head = head
        b.tail = head + direction * 0.1
        b.align_roll(up)
        b.parent = eb[parent] if parent else None
        b.use_deform = False
        return b
    root_name = 'root' if 'root' in eb else None
    add('wpn_hand', hand, grip, d)
    add('wpn_free', root_name, Vector((0, 0, 0)), d)
    add('grip_r', 'wpn_free', Vector((0, 0, 0)), d)
    add('grip_l', 'wpn_free', Vector((0, 0, 0)), d)
    bpy.ops.object.mode_set(mode='OBJECT')
    for side in ('r', 'l'):
        c = arm.pose.bones[f'lowerarm_{side}'].constraints.new('IK')
        c.name = 'WpnIK'
        c.target = arm
        c.subtarget = f'grip_{side}'
        c.chain_count = 2
        c.influence = 0
    bpy.context.view_layer.update()

    for bone in ('wpn_hand', 'wpn_free'):
        pb = arm.pose.bones[bone]
        bm = arm.matrix_world @ arm.data.bones[bone].matrix_local  # 静止姿势的骨骼坐标系：Y = 兵器轴
        for i, part in enumerate(w['parts']):
            a, b = part['from'], part['to']
            L = b - a
            ox, oz = part.get('off', [0, 0])
            shape = part.get('shape', 'cylinder')
            if shape == 'box':
                sw, st = part.get('size', [0.03, 0.01])
                bpy.ops.mesh.primitive_cube_add(size=1)
                ob = bpy.context.active_object
                ob.scale = (st, L, sw)
            else:
                r = part.get('radius', 0.016)
                if shape == 'cone':
                    bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=0, depth=L, vertices=10)
                else:
                    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=L, vertices=10)
                ob = bpy.context.active_object
                ob.rotation_euler = (-math.pi / 2, 0, 0)  # 圆柱 / 圆锥沿 Z → 沿 Y（尖朝 +Y）
            local = Matrix.Translation((ox, (a + b) / 2, oz)) @ ob.matrix_basis
            ob.name = f'Wpn_{bone}_{i}'
            ob.matrix_world = bm @ local
            bpy.context.view_layer.update()
            attr = ob.data.color_attributes.new('Outfit', 'FLOAT_COLOR', 'POINT')
            for dd in attr.data:
                dd.color = lin(part['color'])
            ob.data.materials.append(mat)
            mw = ob.matrix_world.copy()
            ob.parent = arm
            ob.parent_type = 'BONE'
            ob.parent_bone = bone
            bpy.context.view_layer.update()
            ob.matrix_world = mw
    arm.pose.bones['wpn_free'].scale = (WPN_TINY,) * 3  # 网格挂好之后再缩，不然父子关系会把缩放抵消掉
    bpy.context.view_layer.update()
    print('兵器骨骼已加：', len(w['parts']), '段')


def reset_weapon(arm):
    """切换动作前把兵器骨骼和 IK 复位成「兵器在手上」；带兵器的自拼动作有自己的关键帧，会覆盖这里"""
    if 'wpn_free' not in arm.pose.bones:
        return
    arm.pose.bones['wpn_free'].scale = (WPN_TINY,) * 3
    arm.pose.bones['wpn_hand'].scale = (1, 1, 1)
    for side in ('r', 'l'):
        arm.pose.bones[f'lowerarm_{side}'].constraints['WpnIK'].influence = 0


def make_actions(path, scene):
    """模型里没有的动作（如踢腿）用关键帧拼出来。

    JSON：{"actions": [{"name": "Kick", "base": "Idle_Loop", "baseFrame": 0, "frames": 18,
            "keys": [{"t": 0.3, "rot": {"thigh_r": [-100, 0, 0]}, "move": {"pelvis": [0, 0, 0.05]}}]}]}
    - 每个关键帧都从基础姿势（base 动作的 baseFrame 帧）出发；t 是 0–1 的时间位置。
    - rot：绕骨骼头部、按世界坐标轴 X/Y/Z 依次转多少度（人物正面朝 -Y，右手在 -X，Z 向上；
      绕 X 转负角 = 往前抬）。按骨骼层级从父到子处理，子骨骼跟着父骨骼走，再叠加自己的转动。
    - move：骨骼整体平移（米，世界坐标），用来做起跳、压低重心。
    """
    from mathutils import Euler, Matrix
    spec = json.load(open(path, encoding='utf-8'))
    arm = next(o for o in scene.objects if o.type == 'ARMATURE')

    def depth(pb):
        d = 0
        while pb.parent:
            pb, d = pb.parent, d + 1
        return d

    for a in spec['actions']:
        base = bpy.data.actions[a['base']]
        set_action(arm, base)
        scene.frame_set(int(base.frame_range[0]) + a.get('baseFrame', 0))
        bpy.context.view_layer.update()
        pose0 = {pb.name: (pb.location.copy(), pb.rotation_quaternion.copy(), pb.scale.copy()) for pb in arm.pose.bones}
        act = bpy.data.actions.new(a['name'])
        act.use_fake_user = True
        set_action(arm, act)
        n = a.get('frames', 24)
        for key in a['keys']:
            frame = 1 + round(key['t'] * n)
            reset_weapon(arm)
            for pb in arm.pose.bones:
                pb.rotation_mode = 'QUATERNION'
                loc, rot, scl = pose0[pb.name]
                pb.location, pb.rotation_quaternion, pb.scale = loc, rot, scl
            bpy.context.view_layer.update()
            names = set(key.get('rot', {})) | set(key.get('move', {}))
            for name in sorted(names, key=lambda b: depth(arm.pose.bones[b])):
                pb = arm.pose.bones[name]
                mw = arm.matrix_world @ pb.matrix
                head = mw.translation.copy()
                if name in key.get('rot', {}):
                    r = Euler([math.radians(v) for v in key['rot'][name]], 'XYZ').to_matrix().to_4x4()
                    mw = Matrix.Translation(head) @ r @ Matrix.Translation(-head) @ mw
                if name in key.get('move', {}):
                    mw = Matrix.Translation(key['move'][name]) @ mw
                pb.matrix = arm.matrix_world.inverted() @ mw
                bpy.context.view_layer.update()
            if a.get('weapon'):
                # 兵器单独摆：wpn_free 显示，wpn_hand 隐藏，两手 IK 去握
                wk = {**a['weapon'], **key.get('weapon', {})}
                wpn = arm.pose.bones['wpn_free']
                y = Vector(wk['dir']).normalized()
                x = y.cross(Vector(wk.get('up', [0, 0, 1]))).normalized()
                z = x.cross(y)
                m = Matrix((x, y, z)).transposed().to_4x4()
                m.translation = Vector(wk['at'])
                wpn.matrix = arm.matrix_world.inverted() @ m
                wpn.scale = (1, 1, 1)
                arm.pose.bones['wpn_hand'].scale = (WPN_TINY,) * 3
                bpy.context.view_layer.update()
                for side in ('r', 'l'):
                    g = wk.get('grips', {}).get(side)
                    c = arm.pose.bones[f'lowerarm_{side}'].constraints['WpnIK']
                    gb = arm.pose.bones[f'grip_{side}']
                    if g is None:
                        c.influence = 0
                    else:
                        c.influence = 1
                        g = g if isinstance(g, list) else [0, g, 0]  # 数字 = 沿兵器轴的位置
                        gb.location = (0, 0, 0)
                        bpy.context.view_layer.update()
                        gm = arm.matrix_world @ wpn.matrix
                        gm2 = gm.copy()
                        gm2.translation = gm @ Vector((g[0], g[1], g[2]))
                        gb.matrix = arm.matrix_world.inverted() @ gm2
                    c.keyframe_insert('influence', frame=frame)
                    bpy.context.view_layer.update()
            for pb in arm.pose.bones:
                for path_ in ('location', 'rotation_quaternion', 'scale'):
                    pb.keyframe_insert(path_, frame=frame)
        print('拼出动作', a['name'], f'{n} 帧')


def set_action(arm, act):
    reset_weapon(arm)
    arm.animation_data_create()
    arm.animation_data.action = act
    if hasattr(arm.animation_data, 'action_suitable_slots') and arm.animation_data.action_suitable_slots:
        arm.animation_data.action_slot = arm.animation_data.action_suitable_slots[0]


def evaluated_bounds(scene):
    """当前帧（含骨骼动画）所有网格顶点的世界坐标包围盒"""
    dg = bpy.context.evaluated_depsgraph_get()
    xs, ys, zs = [], [], []
    for o in scene.objects:
        if o.type != 'MESH' or o.is_shadow_catcher or o.name.startswith('Wpn_'):
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        for v in me.vertices:
            p = ev.matrix_world @ v.co
            xs.append(p.x); ys.append(p.y); zs.append(p.z)
        ev.to_mesh_clear()
    return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))


def ground(scene, root, height=None, length=None, scale_by='bones'):
    """按待机动作第一帧（没有就用第一个动作）的实际姿势缩放，并把包围盒水平中心、最低点移到原点（= 脚底锚点）"""
    arm = next((o for o in scene.objects if o.type == 'ARMATURE'), None)
    if arm and bpy.data.actions:
        idle = next((a for a in bpy.data.actions if 'idle' in a.name.lower()), bpy.data.actions[0])
        set_action(arm, idle)
        scene.frame_set(int(idle.frame_range[0]) + 1)
        scene.frame_set(int(idle.frame_range[0]))
    bpy.context.view_layer.update()
    # 缩放：有骨骼时按待机姿势的骨骼范围（头顶 / 鼻尖到尾尖），否则按网格包围盒。
    # （带蒙皮的模型用 to_mesh 拿到的是未变形、未换算单位的网格，尺寸不可靠，如 Sketchfab 的老虎）
    pts = pose_points(scene) if scale_by == 'bones' else []
    if pts:
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    else:
        # 静止网格：不受动画影响，先让动画停在静止姿势再量
        lo, hi = evaluated_bounds(scene)
    size = hi - lo
    s = height / size.z if height else length / max(size.x, size.y) if length else 1.0
    root.scale = [v * s for v in root.scale]
    bpy.context.view_layer.update()
    # 位置按待机姿势的骨骼：最低的骨骼端点落在地面，骨骼的水平平均位置对准原点
    pts = pose_points(scene) or [lo, hi]
    cx = sum(p.x for p in pts) / len(pts)
    cy = sum(p.y for p in pts) / len(pts)
    z0 = min(p.z for p in pts)
    root.location = root.location - Vector((cx, cy, z0))
    bpy.context.view_layer.update()
    print(f'待机姿势（骨骼）尺寸 {size.x * s:.2f}×{size.y * s:.2f}×{size.z * s:.2f} 米，待机姿势最低骨骼 z={z0:.2f} 已移到地面')


def pose_points(scene):
    """当前帧所有骨骼头部的世界坐标（尾部方向对辅助骨骼没有意义，不用）（骨骼姿势随动画求值；网格的 to_mesh 在这里拿不到蒙皮后的形状）"""
    pts = []
    for arm in [o for o in scene.objects if o.type == 'ARMATURE']:
        for pb in arm.pose.bones:
            if pb.name.startswith(('wpn_', 'grip_')):
                continue
            pts.append(arm.matrix_world @ pb.head)
    return pts


def import_anims(paths):
    """把别的文件里的动作导进来，再删掉随之导入的物体，只留动作（骨骼名要一致）。同名动作以先导入的为准。"""
    for path in paths:
        before = set(bpy.data.objects)
        have = {a.name for a in bpy.data.actions}
        if os.path.splitext(path)[1].lower() == '.fbx':
            bpy.ops.import_scene.fbx(filepath=path)
        else:
            bpy.ops.import_scene.gltf(filepath=path)
        for a in list(bpy.data.actions):
            if a.name not in have:
                if '.' in a.name and a.name.rsplit('.', 1)[0] in have:
                    bpy.data.actions.remove(a)
                else:
                    a.use_fake_user = True
        for o in set(bpy.data.objects) - before:
            bpy.data.objects.remove(o, do_unlink=True)
        print(f'从 {os.path.basename(path)} 借了动作，现在共 {len(bpy.data.actions)} 个')


def setup_scene(args):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ext = os.path.splitext(args.model)[1].lower()
    if ext in ('.glb', '.gltf'):
        bpy.ops.import_scene.gltf(filepath=args.model)
    elif ext == '.fbx':
        bpy.ops.import_scene.fbx(filepath=args.model)
    else:
        raise SystemExit(f'不支持的模型格式：{ext}')
    if args.anims:
        import_anims(args.anims.split(','))
    if args.outfit:
        apply_outfit(args.outfit)
    scene = bpy.context.scene
    objs = [o for o in scene.objects if o.type in ('MESH', 'ARMATURE', 'EMPTY')]
    roots = [o for o in objs if o.parent is None]
    root = bpy.data.objects.new('SpriteRoot', None)
    scene.collection.objects.link(root)
    for o in roots:
        o.parent = root
    root.rotation_euler[2] = math.radians(args.yaw)
    bpy.context.view_layer.update()

    # 按包围盒缩放：身高（Z）或身长（XY 最大边）
    meshes = [o for o in scene.objects if o.type == 'MESH']
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    size = hi - lo
    s = 1.0
    print(f'模型尺寸 {size.x:.2f}×{size.y:.2f}×{size.z:.2f}，缩放 {s:.3f}')

    # 地面：只接影子
    bpy.ops.mesh.primitive_plane_add(size=50)
    ground = bpy.context.active_object
    ground.is_shadow_catcher = True

    # 灯光：主光从左上方打（原版人物亮面在左上），加一点环境光
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = args.sun
    sun.data.angle = math.radians(2)
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new('W')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[1].default_value = args.ambient
    scene.world = world

    # 正交相机：俯角 ELEV，脚底原点落在 (AX, AY)
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = CW / args.ppm
    cam.data.shift_x = -(AX - CW / 2) / CW
    cam.data.shift_y = (AY - CH / 2) / CW
    scene.collection.objects.link(cam)
    scene.camera = cam

    scene.render.engine = 'CYCLES'
    scene.cycles.samples = args.samples
    scene.cycles.device = 'CPU'
    scene.render.film_transparent = True
    scene.render.resolution_x = CW * 2
    scene.render.resolution_y = CH * 2
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'Standard'
    return scene, root, cam


def aim_camera(cam, azimuth_deg):
    """azimuth：相机在角色的哪个方向（度，0 = 正 -Y 方向，即模型正面）。
    灯光跟着相机转，保证屏幕上光照一致：影子落在脚的左下方、比较短（照原版帧里的影子）。"""
    el = math.radians(ELEV)
    az = math.radians(azimuth_deg)
    d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    cam.location = d * 30
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    fh = Vector((-d.x, -d.y, 0)).normalized()          # 水平的视线方向（离开相机）
    r = fh.cross(Vector((0, 0, 1))).normalized()        # 屏幕右方
    lh = (-0.8 * r - 0.3 * fh).normalized()             # 影子往屏幕左下
    el = math.radians(72)
    light = Vector((lh.x * math.cos(el), lh.y * math.cos(el), -math.sin(el)))
    sun = bpy.data.objects['Sun']
    sun.rotation_euler = light.to_track_quat('-Z', 'Y').to_euler()


def quantize(img, pal, usable):
    """img: H×W×4 float 0–1（Blender 的输出，已从 2 倍缩小）。返回调色板索引图。"""
    h, w = img.shape[:2]
    out = np.zeros((h, w), dtype=np.uint8)
    rgb = (img[..., :3] * 255).astype(np.int32)
    a = img[..., 3]
    body = a > 0.5
    # 影子：shadow catcher 输出的是带透明度的黑色；身体以外、遮挡较强的像素画成影子色
    shadow = (~body) & (a > 0.25)
    cand = pal[usable]
    px = rgb[body]
    if len(px):
        d = ((px[:, None, :] - cand[None, :, :]) ** 2).sum(-1)
        out[body] = usable[d.argmin(1)]
    out[shadow] = SHADOW_INDEX
    return out


def to_rgba(idx, pal):
    rgba = np.zeros(idx.shape + (4,), dtype=np.uint8)
    m = idx > 0
    rgba[m, :3] = pal[idx[m]]
    rgba[m, 3] = 255
    return rgba


def render_frame(scene, tmp):
    scene.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(tmp)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)[::-1]
    bpy.data.images.remove(img)
    # 2 倍渲染 → 平均缩小，边缘更干净
    return px.reshape(CH, 2, CW, 2, 4).mean(axis=(1, 3))


def set_flat(on):
    for m in bpy.data.materials:
        if m.node_tree and 'ToonFlat' in m.node_tree.nodes:
            m.node_tree.nodes['ToonFlat'].outputs[0].default_value = 1 if on else 0


def render_flat(scene, tmp):
    """只渲固有色（自发光、无光照），给平涂明暗算亮度比用。"""
    set_flat(True)
    s = scene.cycles.samples
    scene.cycles.samples = 4
    img = render_frame(scene, tmp)
    scene.cycles.samples = s
    set_flat(False)
    return img


def lum(rgb):
    return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114


def toon(lit, flat, bands, do_outline):
    """亮度比（光照 / 固有色）分成几档：最暗 0.55，最亮 1.05，中间均分；颜色 = 固有色 × 档位。"""
    out = lit.copy()
    body = lit[..., 3] > 0.5
    ratio = lum(lit[..., :3]) / np.maximum(lum(flat[..., :3]), 1e-3)
    cuts = np.linspace(0.35, 0.95, bands)[1:]          # 分界
    levels = np.linspace(0.55, 1.05, bands)
    lv = levels[np.searchsorted(cuts, ratio)]
    out[..., :3] = np.where(body[..., None], np.clip(flat[..., :3] * lv[..., None], 0, 1), lit[..., :3])
    return outline(out, flat) if do_outline else out


def outline(img, flat):
    """外轮廓：身体像素挨着非身体 → 压暗到 35%。衣物分界：固有色和右边 / 下边相差大 → 压暗到 60%。"""
    out = img.copy()
    body = img[..., 3] > 0.5
    pad = np.pad(body, 1)
    edge = body & ~(pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:])
    if flat is not None:
        f = flat[..., :3]
        dx = np.zeros(body.shape, bool); dy = np.zeros(body.shape, bool)
        dx[:, :-1] = (np.abs(f[:, :-1] - f[:, 1:]).sum(-1) > 0.25) & body[:, 1:]
        dy[:-1] = (np.abs(f[:-1] - f[1:]).sum(-1) > 0.25) & body[1:]
        inner = body & (dx | dy) & ~edge
        out[inner, :3] *= 0.6
    out[edge, :3] *= 0.35
    return out


def main():
    args = parse_args()
    os.makedirs(args.out, exist_ok=True)
    pal, usable = load_palette(args.palette)
    scene, root, cam = setup_scene(args)
    if args.poses:
        make_actions(args.poses, scene)
    ground(scene, root, args.height, args.length, args.scale_by)
    arm = next((o for o in scene.objects if o.type == 'ARMATURE'), None)
    actions = list(bpy.data.actions)
    if args.actions:
        want = args.actions.split(',')
        actions = [a for a in actions if a.name in want]
    if not actions:
        actions = [None]
    from PIL import Image
    tmp = os.path.join(args.out, '_tmp.png')
    meta = {'frame': [CW, CH], 'anchor': [AX, AY], 'ppm': args.ppm, 'actions': {}}
    for act in actions:
        name = act.name if act else 'static'
        if act and arm:
            set_action(arm, act)
            f0, f1 = act.frame_range
        else:
            f0, f1 = 1, 1
        n = args.frames if act else 1
        fps = scene.render.fps / scene.render.fps_base
        dur_ms = args.ms or max(30, round((f1 - f0) / fps * 1000 / n))
        for dir_name, azimuth in (('front', 45), ('back', 225)):
            aim_camera(cam, azimuth)
            strip = np.zeros((CH, CW * n, 4), dtype=np.uint8)
            for k in range(n):
                scene.frame_set(int(round(f0 + (f1 - f0) * k / n)))
                if os.environ.get('SPRITE_DEBUG'):
                    from bpy_extras.object_utils import world_to_camera_view
                    lo, hi = evaluated_bounds(scene)
                    o = world_to_camera_view(scene, cam, Vector((0, 0, 0)))
                    print('DEBUG', name, dir_name, k, 'lo', tuple(round(v, 2) for v in lo), 'origin px', round(o.x * CW, 1), round((1 - o.y) * CH, 1))
                img = render_frame(scene, tmp)
                if args.toon:
                    img = toon(img, render_flat(scene, tmp), args.toon, args.outline)
                elif args.outline:
                    img = outline(img, None)
                idx = quantize(img, pal, usable)
                strip[:, k * CW:(k + 1) * CW] = to_rgba(idx, pal)
            file = f'{name}-{dir_name}-{n}f.png'
            Image.fromarray(strip, 'RGBA').save(os.path.join(args.out, file))
            meta['actions'].setdefault(name, {})[dir_name] = {'file': file, 'frames': n, 'ms': dur_ms}
            print('写出', file)
    if os.path.exists(tmp):
        os.remove(tmp)
    json.dump(meta, open(os.path.join(args.out, 'sprites.json'), 'w'), ensure_ascii=False, indent=1)


main()
