"""把 Mixamo 的动作（FBX，mixamorig 骨骼）转到 UAL 假人的骨骼上，存成一个只有动作的动作库 glb，给 render-sprites --anims 用。

用法（需要 bpy）：
  python tools/retarget-mixamo.py 输出.glb 动作.fbx [动作.fbx ...] [--prefix GS_] [--body gamedata/models/UAL1_Standard.glb]

- 每个 FBX 变成一个动作，名字 = 前缀 + 文件名（小写、空格和括号换成下划线），如 "great sword slash (4).fbx" → GS_great_sword_slash_4。
- 做法：逐帧取 Mixamo 骨骼的世界朝向相对它静止姿势（T 字）的转动，套到 UAL 对应骨骼的静止朝向上；骨盆位置按两边胯高的比例缩放。
  两边都是正面朝 −Y、左手在 +X，所以不用另外转向。手指也对上了（握拳 / 握刀）。
- Mixamo 的授权不许公开原文件，转出来的动作库也属于衍生文件：放项目文件夹（shuihu-design/models/mixamo/），不要进 repo。
  渲染出来的图条可以进 repo。
"""
import argparse
import os
import re
import sys

import bpy
from mathutils import Matrix

BONES = {
    'Hips': 'pelvis', 'Spine': 'spine_01', 'Spine1': 'spine_02', 'Spine2': 'spine_03', 'Neck': 'neck_01', 'Head': 'Head',
}
for side, s in (('Left', 'l'), ('Right', 'r')):
    BONES.update({
        f'{side}Shoulder': f'clavicle_{s}', f'{side}Arm': f'upperarm_{s}', f'{side}ForeArm': f'lowerarm_{s}', f'{side}Hand': f'hand_{s}',
        f'{side}UpLeg': f'thigh_{s}', f'{side}Leg': f'calf_{s}', f'{side}Foot': f'foot_{s}', f'{side}ToeBase': f'ball_{s}',
    })
    for mf, uf in (('Thumb', 'thumb'), ('Index', 'index'), ('Middle', 'middle'), ('Ring', 'ring'), ('Pinky', 'pinky')):
        for i in (1, 2, 3):
            BONES[f'{side}Hand{mf}{i}'] = f'{uf}_0{i}_{s}'


def parse():
    argv = sys.argv[1:]
    if '--' in argv:
        argv = argv[argv.index('--') + 1:]
    p = argparse.ArgumentParser()
    p.add_argument('out')
    p.add_argument('fbx', nargs='+')
    p.add_argument('--prefix', default='MX_')
    p.add_argument('--keep-travel', action='store_true', help='保留骨盆的水平位移（默认去掉，原地做动作，免得跑出 160×160 的格子）')
    p.add_argument('--body', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'gamedata', 'models', 'UAL1_Standard.glb'))
    return p.parse_args(argv)


def action_name(prefix, path):
    n = os.path.splitext(os.path.basename(path))[0].lower()
    return prefix + re.sub(r'_+', '_', re.sub(r'[^a-z0-9]+', '_', n)).strip('_')


def depth(pb):
    d = 0
    while pb.parent:
        pb, d = pb.parent, d + 1
    return d


def main():
    a = parse()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=a.body)
    tgt = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    for act in list(bpy.data.actions):
        bpy.data.actions.remove(act)
    tgt.animation_data_clear()
    scene = bpy.context.scene
    tw = tgt.matrix_world
    t_rest = {b.name: (tw @ b.matrix_local) for b in tgt.data.bones}
    order = sorted([pb for pb in tgt.pose.bones if pb.name in BONES.values()], key=depth)
    inv = {v: k for k, v in BONES.items()}

    for path in a.fbx:
        before = set(bpy.data.objects)
        acts_before = set(bpy.data.actions)
        bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False)
        new = set(bpy.data.objects) - before
        src = next(o for o in new if o.type == 'ARMATURE')
        sact = next(iter(set(bpy.data.actions) - acts_before), None)
        if not sact:
            print('没有动作，跳过', path)
            for o in new:
                bpy.data.objects.remove(o, do_unlink=True)
            continue
        sw = src.matrix_world
        pre = next(b.name for b in src.data.bones if b.name.endswith('Hips')).rsplit('Hips', 1)[0]
        s_rest = {b.name: (sw @ b.matrix_local) for b in src.data.bones}
        hips = pre + 'Hips'
        k = t_rest['pelvis'].translation.z / s_rest[hips].translation.z

        act = bpy.data.actions.new(action_name(a.prefix, path))
        act.use_fake_user = True
        tgt.animation_data_create()
        tgt.animation_data.action = act
        if hasattr(tgt.animation_data, 'action_suitable_slots'):
            if not tgt.animation_data.action_slot:
                slot = act.slots.new('OBJECT', tgt.name) if hasattr(act, 'slots') else None
                if slot:
                    tgt.animation_data.action_slot = slot
        f0, f1 = (int(v) for v in sact.frame_range)
        for f in range(f0, f1 + 1):
            scene.frame_set(f)
            for pb in tgt.pose.bones:
                pb.rotation_mode = 'QUATERNION'
                pb.matrix_basis = Matrix.Identity(4)
            bpy.context.view_layer.update()
            for pb in order:
                sname = pre + inv[pb.name]
                spb = src.pose.bones.get(sname)
                if not spb:
                    continue
                ws = sw @ spb.matrix
                delta = ws.to_3x3().normalized() @ s_rest[sname].to_3x3().normalized().inverted()
                rot = delta @ t_rest[pb.name].to_3x3().normalized()
                cur = tw @ pb.matrix
                m = rot.to_4x4()
                if pb.name == 'pelvis':
                    d = (ws.translation - s_rest[sname].translation) * k
                    if not a.keep_travel:
                        d.x = d.y = 0
                    m.translation = t_rest['pelvis'].translation + d
                else:
                    m.translation = cur.translation
                pb.matrix = tw.inverted() @ m
                bpy.context.view_layer.update()
            for pb in order:
                pb.keyframe_insert('rotation_quaternion', frame=f - f0 + 1)
                if pb.name == 'pelvis':
                    pb.keyframe_insert('location', frame=f - f0 + 1)
        print('转好', act.name, f'{f1 - f0 + 1} 帧')
        for o in new:
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.actions.remove(sact)

    tgt.animation_data.action = None
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=a.out, export_format='GLB', export_animation_mode='ACTIONS', export_force_sampling=True,
                              export_def_bones=False)
    print('写出', a.out)


main()
