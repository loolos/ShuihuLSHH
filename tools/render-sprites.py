"""把带动画的 3D 模型渲染成原版风格的精灵图条（扩展包用，docs/game-design.md §15.4）。

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
    p.add_argument('--palette', default=os.path.join(os.path.dirname(__file__), '..', 'gamedata', 'shuihu', 'Data', 'Default.pal'))
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
        可用 x y z（世界坐标）、ax（|x|）、b（骨骼名）。inflate 沿法线把顶点往外推。
      "props": [{"bone": "Head", "shape": "sphere", "radius": 米, "at": [x,y,z], "scale": [sx,sy,sz], "color": [r,g,b]}, ...]
    颜色 0–255。"""
    import re
    cfg = json.load(open(path, encoding='utf-8'))
    arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    rules = [(re.compile('|'.join(r['bones'])) if r.get('bones') else None,
              compile(r['when'], 'when', 'eval') if r.get('when') else None, r) for r in cfg['rules']]

    def outfit_material(name):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = nt.nodes['Principled BSDF']
        bsdf.inputs['Roughness'].default_value = 0.85
        ca = nt.nodes.new('ShaderNodeVertexColor')
        ca.layer_name = 'Outfit'
        nt.links.new(ca.outputs['Color'], bsdf.inputs['Base Color'])
        return mat

    lin = lambda col: [(c / 255) ** 2.2 for c in col] + [1]
    for ob in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
        me = ob.data
        names = {g.index: g.name for g in ob.vertex_groups}
        attr = me.color_attributes.new('Outfit', 'FLOAT_COLOR', 'POINT')
        moves = []
        for v in me.vertices:
            col, inflate = cfg.get('default', [200, 160, 120]), 0
            bone = names.get(max(v.groups, key=lambda g: g.weight).group, '') if v.groups else ''
            p = ob.matrix_world @ v.co
            env = {'x': p.x, 'y': p.y, 'z': p.z, 'ax': abs(p.x), 'b': bone}
            for rx, cond, r in rules:
                if rx and not rx.fullmatch(bone):
                    continue
                if cond and not eval(cond, {}, env):
                    continue
                col, inflate = r['color'], r.get('inflate', 0)
                break
            attr.data[v.index].color = lin(col)
            if inflate:
                moves.append((v.index, v.normal.copy() * inflate))
        for i, d in moves:
            me.vertices[i].co += d
        me.materials.clear()
        me.materials.append(outfit_material('Outfit'))

    for pr in cfg.get('props', []):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=pr.get('radius', 0.05), segments=16, ring_count=8, location=pr['at'])
        ob = bpy.context.active_object
        ob.scale = pr.get('scale', [1, 1, 1])
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


def set_action(arm, act):
    arm.animation_data_create()
    arm.animation_data.action = act
    if hasattr(arm.animation_data, 'action_suitable_slots') and arm.animation_data.action_suitable_slots:
        arm.animation_data.action_slot = arm.animation_data.action_suitable_slots[0]


def evaluated_bounds(scene):
    """当前帧（含骨骼动画）所有网格顶点的世界坐标包围盒"""
    dg = bpy.context.evaluated_depsgraph_get()
    xs, ys, zs = [], [], []
    for o in scene.objects:
        if o.type != 'MESH' or o.is_shadow_catcher:
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
            pts.append(arm.matrix_world @ pb.head)
    return pts


def setup_scene(args):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ext = os.path.splitext(args.model)[1].lower()
    if ext in ('.glb', '.gltf'):
        bpy.ops.import_scene.gltf(filepath=args.model)
    elif ext == '.fbx':
        bpy.ops.import_scene.fbx(filepath=args.model)
    else:
        raise SystemExit(f'不支持的模型格式：{ext}')
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
    sun.data.energy = 2.5
    sun.data.angle = math.radians(2)
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new('W')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[1].default_value = 0.9
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


def main():
    args = parse_args()
    os.makedirs(args.out, exist_ok=True)
    pal, usable = load_palette(args.palette)
    scene, root, cam = setup_scene(args)
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
                idx = quantize(render_frame(scene, tmp), pal, usable)
                strip[:, k * CW:(k + 1) * CW] = to_rgba(idx, pal)
            file = f'{name}-{dir_name}-{n}f.png'
            Image.fromarray(strip, 'RGBA').save(os.path.join(args.out, file))
            meta['actions'].setdefault(name, {})[dir_name] = {'file': file, 'frames': n, 'ms': dur_ms}
            print('写出', file)
    if os.path.exists(tmp):
        os.remove(tmp)
    json.dump(meta, open(os.path.join(args.out, 'sprites.json'), 'w'), ensure_ascii=False, indent=1)


main()
