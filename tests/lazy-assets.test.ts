// 拆出来的原版图像（gamedata/sprites、tiles、portraits、icons）：切出的帧与原版图像库逐像素一致（锚点对齐、空白补 0）；
// 进关只载入走路/受击/防御/普通攻击那几张图，技能出招前再载入。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import '../src/platform/buffer-shim.ts';
import { openGrp, openLib, openPic, type Frame } from '../src/formats/image.ts';
import { ensureSkill, loadAssets, preloadStage, startupImages } from '../src/game/assets.ts';
import { fxGroups } from '../src/game/effects.ts';
import { nodeGameFiles } from '../tools/sim-lib.ts';

const DATA = path.resolve(import.meta.dirname, '../gamedata/original/Data');
const has = fs.existsSync(path.join(DATA, 'Man.lib'));

/** 拆出的帧 a 与原版帧 b 一致：b 按锚点放进 a 的格子里，其余是透明 */
function same(a: Frame, b: Frame, what: string) {
  const ox = a.anchorX - b.anchorX, oy = a.anchorY - b.anchorY;
  expect(ox >= 0 && oy >= 0 && ox + b.width <= a.width && oy + b.height <= a.height, what).toBe(true);
  let opaque = 0;
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      const bx = x - ox, by = y - oy;
      const want = bx >= 0 && by >= 0 && bx < b.width && by < b.height ? b.pixels[by * b.width + bx] : 0;
      if (a.pixels[y * a.width + x] !== want) throw new Error(`${what}: (${x},${y})`);
      if (want) opaque++;
    }
  return opaque;
}

describe.skipIf(!has)('拆出来的图像', () => {
  it('N01：进关载入的帧与原版一致，技能出招前才载入', async () => {
    const loaded: string[] = [];
    const assets = loadAssets(nodeGameFiles((p) => loaded.push(p)));
    await assets.files.ensure(startupImages(assets));
    loaded.length = 0;
    await preloadStage(assets, 'n01');
    expect(loaded.length).toBeGreaterThan(0);
    const man = openLib(fs.readFileSync(path.join(DATA, 'Man.lib')), 'Man.lib');
    const fx = openLib(fs.readFileSync(path.join(DATA, 'Effect.lib')), 'Effect.lib');
    const check = (g: number, lib = assets.man, ref = man) => {
      const r = lib.actions[g];
      expect([r.first, r.last]).toEqual([ref.actions[g].first, ref.actions[g].last]);
      for (let i = r.first; i <= r.last; i++) same(lib.frame(i), ref.frame(i), `组 ${g} 帧 ${i}`);
    };
    // 主角（职业 0）：走路、受击、防御、普通攻击
    const c = assets.man.classes[0];
    const basic = assets.data.classes[0].skills[0];
    for (const g of [...Array(12).keys(), ...[0, 1, 2, 3].map((d) => (3 + basic.group) * 4 + d)]) check(c.first + g);
    // 别的技能还没载入：出招前补上
    const sk = assets.data.classes[0].skills.find((s) => s.group !== basic.group && fxGroups(s).length)!;
    const g0 = c.first + (3 + sk.group) * 4;
    expect(assets.files.hasImage(assets.man.sheetOf(g0))).toBe(false);
    loaded.length = 0;
    await ensureSkill(assets, 0, sk);
    expect(loaded.length).toBeGreaterThan(0);
    for (let d = 0; d < 4; d++) check(g0 + d);
    for (const g of fxGroups(sk)) check(g, assets.effects, fx);
    // 第二次不再载入
    loaded.length = 0;
    await ensureSkill(assets, 0, sk);
    expect(loaded).toEqual([]);
  });

  it('图块、格子光标、头像、图标与原版一致', async () => {
    const assets = loadAssets(nodeGameFiles());
    const all = (lib: { count: number; sheetOf(i: number): string }) => Array.from({ length: lib.count }, (_, i) => lib.sheetOf(i));
    await assets.files.ensure([...all(assets.ground), ...all(assets.upper), ...startupImages(assets)]);
    const pairs = [
      [assets.ground, openGrp(fs.readFileSync(path.join(DATA, 'Ground.grp')))],
      [assets.upper, openGrp(fs.readFileSync(path.join(DATA, 'Upper.grp')))],
      [assets.grid, openGrp(fs.readFileSync(path.join(DATA, 'Grid.grp')))],
      [assets.heads, openPic(fs.readFileSync(path.join(DATA, 'Head.lib')))],
      [assets.objects, openPic(fs.readFileSync(path.join(DATA, 'Object.lib')))],
    ] as const;
    for (const [mine, ref] of pairs) {
      expect(mine.count).toBe(ref.count);
      for (let i = 0; i < ref.count; i++) {
        const a = mine.frame(i), b = ref.frame(i);
        expect([a.width, a.height, a.anchorX, a.anchorY]).toEqual([b.width, b.height, b.anchorX, b.anchorY]);
        same(a, b, `#${i}`);
      }
    }
  });
});
