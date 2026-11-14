"""把一张白底的人物半身像做成原版风格的对话头像（Head.lib 那样：宽 140、透明底、颜色缩到 Default.pal）。

用法：
  python3 tools/make-portrait.py 原图 输出.png [--box x0,y0,x1,y1] [--width 140] [--white 238]

步骤：
  1. 按 --box 裁剪（原图像素坐标；不填就自动裁掉四周空白，再按 140:187 补齐比例）；
  2. 从图边缘往里"漫水"，把和边缘连通的近白色（三个通道都 ≥ --white）当作背景，变透明；
  3. 缩到宽 --width（高按比例），只留几乎不透明的像素（免得留白边）；
  4. 颜色用误差扩散抖动缩到原版 Default.pal 的 16–255 号（0–15 是界面色，159 是影子色，都不用）。
只依赖 Pillow 和 numpy。
"""
import argparse
import os
from collections import deque

import numpy as np
from PIL import Image

SHADOW_INDEX = 159
RATIO = 187 / 140  # 原版头像的高宽比（Head.lib 69 是 140×187）


def load_palette(path):
    raw = np.frombuffer(open(path, 'rb').read()[:768], dtype=np.uint8).reshape(256, 3).astype(np.int32)
    usable = [i for i in range(16, 256) if i != SHADOW_INDEX]
    return raw, np.array(usable)


def auto_box(rgb, white):
    content = rgb.min(axis=2) < white
    ys = np.where(content.any(axis=1))[0]
    xs = np.where(content.any(axis=0))[0]
    x0, x1, y0, y1 = xs[0], xs[-1] + 1, ys[0], ys[-1] + 1
    w, h = x1 - x0, y1 - y0
    if h / w > RATIO:  # 太高：从下面截（半身像下面是身体，截掉不要紧）
        y1 = y0 + round(w * RATIO)
    else:  # 太宽：左右平均截
        cut = w - round(h / RATIO)
        x0 += cut // 2
        x1 -= cut - cut // 2
    return x0, y0, x1, y1


def background_mask(rgb, white):
    h, w = rgb.shape[:2]
    near_white = rgb.min(axis=2) >= white
    bg = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if near_white[y, x] and not bg[y, x]:
                bg[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if near_white[y, x] and not bg[y, x]:
                bg[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and near_white[ny, nx] and not bg[ny, nx]:
                bg[ny, nx] = True
                q.append((ny, nx))
    return bg


def main():
    p = argparse.ArgumentParser()
    p.add_argument('src')
    p.add_argument('out')
    p.add_argument('--box', help='x0,y0,x1,y1（原图像素）')
    p.add_argument('--width', type=int, default=140)
    p.add_argument('--white', type=int, default=215, help='三个通道都不低于它、又和图边连通的像素算背景')
    p.add_argument('--palette', default=os.path.join(os.path.dirname(__file__), '..', 'gamedata', 'shuihu', 'Data', 'Default.pal'))
    a = p.parse_args()

    im = Image.open(a.src).convert('RGB')
    rgb = np.asarray(im).astype(np.int32)
    box = tuple(int(v) for v in a.box.split(',')) if a.box else auto_box(rgb, a.white)
    im = im.crop(box)
    rgb = np.asarray(im).astype(np.int32)
    alpha = np.where(background_mask(rgb, a.white), 0, 255).astype(np.uint8)
    rgba = np.dstack([rgb.astype(np.uint8), alpha])

    w = a.width
    h = round(im.height * w / im.width)
    small = np.asarray(Image.fromarray(rgba, 'RGBA').resize((w, h), Image.LANCZOS)).astype(np.int32)
    # 边缘半透明的像素混着白底，留下会有白边：只留几乎不透明的
    body = small[..., 3] >= 240

    # 缩色用误差扩散抖动（原版头像也是抖动出来的；直接取最近色会出现色块）
    pal, usable = load_palette(a.palette)
    flat = [0, 0, 0] * 256
    for k, i in enumerate(usable):
        flat[k * 3:k * 3 + 3] = pal[i].tolist()
    for k in range(len(usable), 256):  # 补满 256 色时重复第一色，免得被选中别的颜色
        flat[k * 3:k * 3 + 3] = pal[usable[0]].tolist()
    pimg = Image.new('P', (1, 1))
    pimg.putpalette(flat)
    rgb_small = Image.fromarray(small[..., :3].astype(np.uint8), 'RGB')
    q = np.asarray(rgb_small.quantize(palette=pimg, dither=Image.Dither.FLOYDSTEINBERG).convert('RGB'))
    out = np.zeros((h, w, 4), dtype=np.uint8)
    out[body, :3] = q[body]
    out[body, 3] = 255
    Image.fromarray(out, 'RGBA').save(a.out, optimize=True)
    print(f'{a.src} → {a.out}：裁剪 {box}，{w}×{h}')


if __name__ == '__main__':
    main()
