// 自拼地图（docs/game-design.md §15.15）：packs/maps/*.json 由 tools/compose-map.ts 按 tools/map-recipes/*.json 生成。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapFromJson, mapToJson } from '../src/formats/map.ts';
import { loadStageMap, stageMapName } from '../src/rules/load.ts';
import { useDiskCustomMaps } from '../src/packs/custom-maps-node.ts';
import { compose, passStats, type Recipe } from '../tools/compose-map.ts';
import { DATA, NodeFiles } from '../tools/sim-lib.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const has = fs.existsSync(path.join(DATA, 'ShuiHu.exe'));
const maps = fs.readdirSync(path.join(ROOT, 'packs/maps')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
const recipes = fs.readdirSync(path.join(ROOT, 'tools/map-recipes')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));

describe('自拼地图', () => {
  it('JSON 来回转换不丢东西', () => {
    const j = { width: 2, height: 1, cells: [5, [7, 100, 0, 101, 64]] };
    const m = mapFromJson(j);
    expect(m.cells[1]).toEqual([{ tile: 7, flags: 0 }, { tile: 100, flags: 0 }, { tile: 101, flags: 64 }]);
    expect(mapToJson(m)).toEqual(j);
  });

  it('地图名：custom 前缀，也能截取', () => {
    expect(stageMapName({ custom: 'jiulou' })).toBe('custom:jiulou');
    expect(stageMapName({ custom: 'jiulou', crop: [1, 2, 3, 4] })).toBe('custom:jiulou@1,2,3,4');
    expect(stageMapName({ base: 'N05' })).toBe('N05');
  });

  it('每个配方都有生成好的地图，反过来也是', () => {
    expect(maps.sort()).toEqual(recipes.sort());
  });

  describe.skipIf(!has)('需要原版图块', () => {
    useDiskCustomMaps(ROOT);
    const files = new NodeFiles(DATA);
    const att = (f: string) => new Uint8Array(files.get(f).subarray(8));

    it.each(maps)('%s：能载入，图块号都在原版图块库里，可走的格子连成一片', (name) => {
      const loaded = loadStageMap(files, `custom:${name}`);
      expect(loaded).toBeDefined();
      const m = loaded!.map;
      for (const c of m.cells) {
        expect(c[0].tile).toBeLessThan(758);
        for (const l of c.slice(1)) expect(l.tile).toBeLessThan(1018);
      }
      const s = passStats(m, att('Data/Ground.att'), att('Data/Upper.att'));
      expect(s.total).toBeGreaterThan(100);
      expect(s.largest).toBeGreaterThanOrEqual(s.total * 0.9);
      // 截取也能用
      expect(loadStageMap(files, `custom:${name}@0,0,10,10`)!.map.width).toBe(10);
    });

    it.each(recipes)('%s：配方重拼的结果和入库的地图一致（改了配方要重跑 compose-map）', (name) => {
      const recipe = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/map-recipes', `${name}.json`), 'utf8')) as Recipe;
      const saved = JSON.parse(fs.readFileSync(path.join(ROOT, 'packs/maps', `${name}.json`), 'utf8'));
      expect(mapToJson(compose(recipe))).toEqual(saved);
    });
  });
});
