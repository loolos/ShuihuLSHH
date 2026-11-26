"""道具图标换色（负责人 2026-11-26：新道具不生成新图，拿现有图标换颜色）。

用法：
  python tools/recolor-icon.py <源> <输出.png> [--hue H] [--sat S] [--val V] [--tint R,G,B --amount A] [--rgba]

- 源：gamedata/icons 的帧号（如 103）或 PNG 路径（索引色或 RGBA 都行）。
- --hue：把色相换成 H（0–360）；不写保持原色相。--sat / --val：饱和度、亮度乘数（默认 1）。
- 默认输出 8 位索引色、调色板 = 原版 Default.pal（gamedata/tables/palette.json），0 号透明，
  每个像素换色后取调色板里最接近的颜色（不用 0 号和 13 号）。
  13 号是图标的抠图色键（src/game/assets.ts ICON_KEY），原样保留；--rgba 时当透明。--rgba 输出 RGBA（扩展包 packs/*/icons 用）。
"""
import argparse
import colorsys
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
KEY = 13
PAL = [tuple(c) for c in json.loads((ROOT / 'gamedata/tables/palette.json').read_text())]


def nearest(rgb):
    best, bi = None, 1
    for i in range(1, len(PAL)):
        if i == KEY:
            continue
        p = PAL[i]
        d = (p[0] - rgb[0]) ** 2 * 3 + (p[1] - rgb[1]) ** 2 * 4 + (p[2] - rgb[2]) ** 2 * 2
        if best is None or d < best:
            best, bi = d, i
    return bi


def shift(rgb, hue, sat, val, tint=None, amount=0.0):
    if tint:
        # 灰色调没有色相可换：按亮度染上 tint 色，再与原色按 amount 混合
        lum = (rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11) / 255
        rgb = tuple(round(o * (1 - amount) + min(255, t * lum * 1.4) * amount) for o, t in zip(rgb, tint))
    h, s, v = colorsys.rgb_to_hsv(*(c / 255 for c in rgb))
    if hue is not None:
        h = hue / 360
    s = min(1, s * sat)
    v = min(1, v * val)
    return tuple(round(c * 255) for c in colorsys.hsv_to_rgb(h, s, v))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('out')
    ap.add_argument('--hue', type=float)
    ap.add_argument('--sat', type=float, default=1)
    ap.add_argument('--val', type=float, default=1)
    ap.add_argument('--tint', help='染色 R,G,B（给灰色图标上色）')
    ap.add_argument('--amount', type=float, default=0.7, help='染色比例 0–1')
    ap.add_argument('--rgba', action='store_true')
    a = ap.parse_args()
    src = ROOT / f'gamedata/icons/{int(a.src):03d}.png' if a.src.isdigit() else Path(a.src)
    im = Image.open(src)
    w, h = im.size
    if im.mode == 'P':
        idx = list(getattr(im, 'get_flattened_data', im.getdata)())
        px = [None if i in (0, KEY) else PAL[i] for i in idx]
        keyed = [i == KEY for i in idx]
    else:
        rgba = list(im.convert('RGBA').getdata())
        px = [None if p[3] < 128 else p[:3] for p in rgba]
        keyed = [False] * len(px)
    cache = {}
    out = []
    for p in px:
        if p is None:
            out.append(None)
            continue
        if p not in cache:
            cache[p] = shift(p, a.hue, a.sat, a.val, tuple(int(x) for x in a.tint.split(',')) if a.tint else None, a.amount)
        out.append(cache[p])
    if a.rgba:
        img = Image.new('RGBA', (w, h))
        img.putdata([(0, 0, 0, 0) if p is None else (*p, 255) for p in out])
    else:
        img = Image.new('P', (w, h))
        img.putpalette([c for rgb in PAL for c in rgb])
        img.putdata([KEY if k else 0 if p is None else nearest(p) for p, k in zip(out, keyed)])
        img.info['transparency'] = 0
    img.save(a.out, **({} if a.rgba else {'transparency': 0}))


if __name__ == '__main__':
    main()
