"""按人物配方（gamedata/models/characters/<id>.json）渲染整套精灵图条，写进扩展包的 sprites 目录。

用法（需要 bpy，见 docs/game-design.md §15.6）：
  python tools/render-character.py gamedata/models/characters/gudasao.json [--only 动作,动作] [--frames 4 --samples 8] [--out 目录]

配方格式见 gamedata/models/README.md。流程：
  1. 合并服装：底版（outfit，可写多个，后面的追加到前面）→ remove 去掉的部件 → colors 换色 → add 追加的部件；
  2. 调 tools/render-sprites.py：身体 male = UAL1 假人，female = UAL2 女假人，动作同时借 UAL1 + UAL2（两库骨骼同名）；
  3. 文件改成游戏用的名字（idle-front.png 这种），写 sprites.json（含 alias 派生的重复 / 加速条、concat 拼接条）。
"""
import argparse
import copy
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
MODELS = os.path.join(ROOT, 'gamedata', 'models')
BODIES = {'male': 'UAL1_Standard.glb', 'female': 'Mannequin_F.glb'}
ANIM_LIBS = ['UAL1_Standard.glb', 'UAL2_Standard.glb']
RENDER_DEFAULTS = {'ppm': 50, 'samples': 12, 'ambient': 0.5, 'sun': 3.5, 'toon': 3, 'outline': True}


def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


# 不能进公开 repo 的原料（如 Mixamo 转出来的动作库）放项目文件夹，云端每个 thread 都能读
PRIVATE = os.environ.get('SHUIHU_PRIVATE_MODELS', '/mnt/project-files/shuihu-design/models')


def resolve(base_dir, p):
    for d in (base_dir, MODELS, ROOT, PRIVATE):
        q = os.path.join(d, p)
        if os.path.exists(q):
            return q
    raise SystemExit(f'找不到 {p}')


def merge_outfit(recipe, recipe_dir):
    """底版 + remove + colors + add → 一份 render-sprites 认的服装 JSON"""
    bases = recipe.get('outfit', [])
    if isinstance(bases, str):
        bases = [bases]
    out = {'default': None, 'shading': {}, 'rules': [], 'layers': [], 'props': []}
    for b in bases:
        o = load_json(resolve(recipe_dir, b))
        if o.get('default'):
            out['default'] = o['default']
        out['shading'].update(o.get('shading', {}))
        for k in ('rules', 'layers', 'props'):
            out[k] += copy.deepcopy(o.get(k, []))
        if o.get('weapon'):
            out['weapon'] = copy.deepcopy(o['weapon'])  # 双手兵器（见 render-sprites.py build_weapon），后面的覆盖前面的
    remove = set(recipe.get('remove', []))
    for k in ('rules', 'layers', 'props'):
        out[k] = [p for p in out[k] if p.get('name') not in remove]
    names = {p.get('name') for k in ('rules', 'layers', 'props') for p in out[k]}
    for name, c in recipe.get('colors', {}).items():
        if name == 'skin':
            out['default'] = c
            continue
        if name not in names:
            raise SystemExit(f'colors 里的「{name}」在服装里找不到（现有：{sorted(n for n in names if n)}）')
        for k in ('rules', 'layers', 'props'):
            for p in out[k]:
                if p.get('name') != name:
                    continue
                if isinstance(c, dict):  # {"color": 主色, "colors": [第 i 条包边色, ...]}
                    if 'color' in c:
                        p['color'] = c['color']
                    for i, cc in enumerate(c.get('colors', [])):
                        if cc is not None and i < len(p.get('colors', [])):
                            p['colors'][i]['color'] = cc
                else:
                    p['color'] = c
    add = recipe.get('add', {})
    for k in ('rules', 'layers', 'props'):
        if k == 'rules':
            out[k] = copy.deepcopy(add.get(k, [])) + out[k]  # 规则先匹配先用：追加的放前面
        else:
            out[k] += copy.deepcopy(add.get(k, []))
    out['shading'].update(add.get('shading', {}))
    if out['default'] is None:
        out['default'] = [222, 176, 140]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('recipe')
    ap.add_argument('--only', help='只渲染这些（游戏里的动作名，逗号分隔）')
    ap.add_argument('--frames', type=int, help='覆盖帧数（试渲染用）')
    ap.add_argument('--samples', type=int, help='覆盖采样数（试渲染用）')
    ap.add_argument('--out', help='输出目录（默认配方里的 out）')
    ap.add_argument('--python', default=sys.executable, help='带 bpy 的 Python')
    ap.add_argument('--keep-outfit', help='把合并后的服装 JSON 另存一份（调试）')
    args = ap.parse_args()

    recipe_path = os.path.abspath(args.recipe)
    recipe_dir = os.path.dirname(recipe_path)
    r = load_json(recipe_path)
    out_dir = os.path.join(ROOT, args.out or r['out'])
    outfit = merge_outfit(r, recipe_dir)
    if args.keep_outfit:
        json.dump(outfit, open(args.keep_outfit, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    actions = r['actions']  # 游戏动作名 → 模型动作名 或 {"from": 名, "frames": n, "ms": 毫秒}
    if args.only:
        want = args.only.split(',')
        actions = {k: v for k, v in actions.items() if k in want}
    spec = {k: (v if isinstance(v, dict) else {'from': v}) for k, v in actions.items()}
    opt = dict(RENDER_DEFAULTS, **r.get('render', {}))
    frames_default = args.frames or r.get('frames', 8)
    if args.samples:
        opt['samples'] = args.samples

    body = resolve(recipe_dir, r.get('model') or BODIES[r.get('body', 'male')])
    libs = [resolve(recipe_dir, a) for a in r.get('anims', ANIM_LIBS) + r.get('extraAnims', [])]
    tmp = tempfile.mkdtemp(prefix='render-character-')
    outfit_path = os.path.join(tmp, 'outfit.json')
    json.dump(outfit, open(outfit_path, 'w', encoding='utf-8'), ensure_ascii=False)
    poses = None
    if r.get('poses'):  # 可写多个，合并成一份
        plist = r['poses'] if isinstance(r['poses'], list) else [r['poses']]
        merged = {'actions': []}
        for pp in plist:
            merged['actions'] += load_json(resolve(recipe_dir, pp))['actions']
        poses = os.path.join(tmp, 'poses.json')
        json.dump(merged, open(poses, 'w', encoding='utf-8'), ensure_ascii=False)

    # 帧数不同的动作分批渲染
    groups = {}
    for name, s in spec.items():
        groups.setdefault(args.frames or s.get('frames', frames_default), []).append(name)
    meta_all = {}
    for n, names in groups.items():
        sub = os.path.join(tmp, f'f{n}')
        src = sorted({spec[k]['from'] for k in names})
        cmd = [args.python, os.path.join(ROOT, 'tools', 'render-sprites.py'), body, sub,
               '--anims', ','.join(libs), '--scale-by', 'mesh', '--height', str(r.get('height', 1.75)),
               '--ppm', str(opt['ppm']), '--frames', str(n), '--samples', str(opt['samples']),
               '--ambient', str(opt['ambient']), '--sun', str(opt['sun']), '--outfit', outfit_path,
               '--actions', ','.join(src)]
        if opt.get('toon'):
            cmd += ['--toon', str(opt['toon'])]
        if opt.get('outline'):
            cmd.append('--outline')
        if poses:
            cmd += ['--poses', poses]
        print('渲染', n, '帧：', ', '.join(src), flush=True)
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL if not os.environ.get('VERBOSE') else None)
        m = load_json(os.path.join(sub, 'sprites.json'))
        meta_all.update({k: (sub, v) for k, v in m['actions'].items()})
        frame_meta = {kk: m[kk] for kk in ('frame', 'anchor', 'ppm')}

    os.makedirs(out_dir, exist_ok=True)
    old = os.path.join(out_dir, 'sprites.json')
    meta = load_json(old) if os.path.exists(old) and args.only else {}
    meta.update(frame_meta)
    meta.setdefault('actions', {})
    for name, s in spec.items():
        sub, a = meta_all[s['from']]
        entry = {'source': s['from']}
        for d in ('front', 'back'):
            fn = f'{name}-{d}.png'
            shutil.copy(os.path.join(sub, a[d]['file']), os.path.join(out_dir, fn))
            entry[d] = {'file': fn, 'frames': a[d]['frames'], 'ms': s.get('ms', a[d]['ms'])}
        meta['actions'][name] = entry
    # concat：几条横向拼成一条（如左右交替踢）
    from PIL import Image
    for name, parts in r.get('concat', {}).items():
        if not all(p in meta['actions'] for p in parts['of']):
            continue
        entry = {'source': ' + '.join(meta['actions'][p]['source'] for p in parts['of'])}
        for d in ('front', 'back'):
            ims = [Image.open(os.path.join(out_dir, meta['actions'][p][d]['file'])) for p in parts['of']]
            c = Image.new('RGBA', (sum(i.width for i in ims), ims[0].height))
            x = 0
            for i in ims:
                c.paste(i, (x, 0))
                x += i.width
            fn = f'{name}-{d}.png'
            c.save(os.path.join(out_dir, fn))
            entry[d] = {'file': fn, 'frames': sum(meta['actions'][p][d]['frames'] for p in parts['of']),
                        'ms': parts.get('ms', meta['actions'][parts['of'][0]][d]['ms'])}
        meta['actions'][name] = entry
    # alias：同一条图换速度 / 重复播放（如两连斩 = 一斩 × 2）
    for name, a in r.get('alias', {}).items():
        base = meta['actions'].get(a['of'])
        if not base:
            continue
        entry = {'source': base['source'] + (f" × {a['cycles']}" if a.get('cycles', 1) > 1 else '')}
        for d in ('front', 'back'):
            entry[d] = dict(base[d], ms=a.get('ms', base[d]['ms']))
            if a.get('cycles', 1) > 1:
                entry[d]['cycles'] = a['cycles']
        meta['actions'][name] = entry
    json.dump(meta, open(old, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    shutil.rmtree(tmp, ignore_errors=True)
    print('写到', os.path.relpath(out_dir, ROOT), '：', ', '.join(meta['actions']))


main()
