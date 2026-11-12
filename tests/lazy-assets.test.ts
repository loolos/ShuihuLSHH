// 网页版按需下载：进关只下载走路/受击/防御/普通攻击，技能出招前再下载；字节相同的帧只下载一份再复制。
// 用仓库里的 gamedata/shuihu 模拟 GitHub 的 Range 请求，检查解出来的帧与整份文件一致。
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import '../src/platform/buffer-shim.ts';
import { GameFiles, LAZY_FILES, RemoteFile } from '../src/platform/gamefiles.ts';
import { indexSpans, openLib } from '../src/formats/image.ts';
import { ensureSkill, loadAssets, preloadStage } from '../src/game/assets.ts';
import { fxGroups } from '../src/game/effects.ts';
import alias from '../src/data/frame-alias.json';

const DATA = path.resolve(import.meta.dirname, '../gamedata/shuihu');
const has = fs.existsSync(path.join(DATA, 'ShuiHu.exe'));

describe.skipIf(!has)('按需下载', () => {
  let fetched = 0;
  beforeAll(() => {
    vi.stubGlobal('fetch', async (url: string, init?: { headers?: Record<string, string> }) => {
      const buf = fs.readFileSync(path.join(DATA, decodeURIComponent(url.replace('repo:', ''))));
      const m = /bytes=(\d+)-(\d+)/.exec(init?.headers?.Range ?? '');
      const part = m ? buf.subarray(Number(m[1]), Number(m[2]) + 1) : buf;
      fetched += part.length;
      return new Response(new Uint8Array(part), { status: m ? 206 : 200 });
    });
  });
  afterAll(() => vi.unstubAllGlobals());

  const open = async () => {
    const small = new Map<string, ArrayBuffer>();
    const walk = (d: string, rel: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(d, e.name), r);
        else if (!LAZY_FILES.includes(r)) small.set(r, new Uint8Array(fs.readFileSync(path.join(d, e.name))).buffer);
      }
    };
    walk(DATA, '');
    const remote: RemoteFile[] = [];
    for (const p of LAZY_FILES) {
      const size = fs.statSync(path.join(DATA, p)).size;
      const r = new RemoteFile(p, size, `repo:${p}`);
      await r.ensure([[0, 15]]);
      await r.ensure(indexSpans(Buffer.from(r.buf.buffer, 0, 15), size));
      remote.push(r);
    }
    return loadAssets(new GameFiles(small, remote));
  };

  it('frame-alias.json 与 Man.lib、Effect.lib 一致', () => {
    for (const [p, { dup, src }] of Object.entries(alias as Record<string, { dup: number[]; src: number[] }>)) {
      const buf = fs.readFileSync(path.join(DATA, p));
      const lib = openLib(buf, p);
      let i = 0;
      dup.forEach((d, k) => {
        i += d;
        const [a, b] = lib.span(i);
        const [c, e] = lib.span(src[k]);
        expect(src[k]).toBeLessThan(i);
        expect(Buffer.compare(buf.subarray(a, b), buf.subarray(c, e))).toBe(0);
      });
    }
  });

  it('N01：进关下载的帧与整份文件解码一致，技能出招前才下载', async () => {
    const assets = await open();
    const full = openLib(fs.readFileSync(path.join(DATA, 'Data/Man.lib')), 'Man.lib');
    const fullFx = openLib(fs.readFileSync(path.join(DATA, 'Data/Effect.lib')), 'Effect.lib');
    fetched = 0;
    await preloadStage(assets, 'n01');
    const core = fetched;
    expect(core).toBeGreaterThan(0);
    // 主角（职业 0）：走路、受击、防御、普通攻击都已下载
    const c = assets.man.classes[0];
    const basic = assets.data.classes[0].skills[0];
    const groups = [...Array(12).keys(), ...[0, 1, 2, 3].map((d) => (3 + basic.group) * 4 + d)].map((g) => c.first + g);
    const same = (g: number, lib = assets.man, ref = full) => {
      const r = lib.actions[g];
      for (let i = r.first; i <= r.last; i++) expect(Buffer.compare(Buffer.from(lib.frame(i).pixels), Buffer.from(ref.frame(i).pixels))).toBe(0);
    };
    for (const g of groups) same(g);
    // 其中有字节相同、只下载了第一份再复制过来的帧
    const dups = new Set<number>();
    let i = 0;
    for (const d of alias['Data/Man.lib'].dup) dups.add((i += d));
    expect(groups.some((g) => { const r = assets.man.actions[g]; for (let k = r.first; k <= r.last; k++) if (dups.has(k)) return true; return false; })).toBe(true);
    // 别的技能还没下载：出招前补上
    const sk = assets.data.classes[0].skills.find((s) => s.group !== basic.group && fxGroups(s).length)!;
    const g0 = c.first + (3 + sk.group) * 4;
    const [a, b] = assets.man.span(assets.man.actions[g0].first);
    expect(assets.files.get('Data/Man.lib').subarray(a, b).every((x) => x === 0)).toBe(true);
    fetched = 0;
    await ensureSkill(assets, 0, sk);
    expect(fetched).toBeGreaterThan(0);
    for (let d = 0; d < 4; d++) same(g0 + d);
    for (const g of fxGroups(sk)) same(g, assets.effects, fullFx);
    // 第二次不再下载
    fetched = 0;
    await ensureSkill(assets, 0, sk);
    expect(fetched).toBe(0);
  });
});
