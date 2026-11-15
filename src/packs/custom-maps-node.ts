// Node（工具、测试）里读自拼地图：packs/maps/<名字>.json。浏览器里由 src/game/packs.ts 从打包的 JSON 读。
import fs from 'node:fs';
import path from 'node:path';
import { setCustomMapLoader } from '../rules/load.ts';

export function useDiskCustomMaps(root = path.resolve(import.meta.dirname, '../..')): void {
  setCustomMapLoader((name) => {
    const f = path.join(root, 'packs/maps', `${name}.json`);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : undefined;
  });
}
