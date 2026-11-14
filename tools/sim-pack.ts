// 扩展包关卡试打：我方也交给 AI，跑若干种子，打印胜率、回合数、关键剧情有没有触发。
// 用法：node --experimental-transform-types tools/sim-pack.ts [包名] [关卡] [种子数]
import fs from 'node:fs';
import path from 'node:path';
import { Battle } from '../src/rules/battle.ts';
import { planAi } from '../src/rules/ai.ts';
import { attackSkill } from '../src/rules/unit.ts';
import { buildT2S, loadGameData } from '../src/rules/load.ts';
import { buildPack, compileStage, type SpriteSheetJson } from '../src/packs/build.ts';
import type { PackJson, PackStageJson } from '../src/packs/types.ts';
import { DATA, NodeFiles } from './sim-lib.ts';

export function loadPackFromDisk(id: string, base = loadGameData(new NodeFiles(DATA))) {
  const dir = path.resolve(import.meta.dirname, '../packs', id);
  const read = (p: string) => JSON.parse(fs.readFileSync(path.join(dir, p), 'utf8'));
  const pack = read('pack.json') as PackJson;
  const stages = pack.stages.map((s) => read(s) as PackStageJson);
  const sheets: Record<string, SpriteSheetJson> = {};
  for (const c of pack.classes) sheets[c.sprite.sheet] = read(`${c.sprite.sheet}/sprites.json`);
  return buildPack(base, pack, stages, sheets);
}

if (import.meta.main ?? process.argv[1]?.endsWith('sim-pack.ts')) {
  const [id = 'wusong', stageId, n = '20'] = process.argv.slice(2);
  const files = new NodeFiles(DATA);
  const tr = buildT2S(files);
  const rt = loadPackFromDisk(id, loadGameData(files, tr));
  const stage = rt.stages.find((s) => !stageId || s.id === stageId)!;
  let wins = 0;
  for (let seed = 1; seed <= Number(n); seed++) {
    const b = new Battle(compileStage(rt, stage, files, { seed, text: tr }));
    const ev = [...b.begin()];
    let guard = 0;
    while (b.status === 'playing' && guard++ < 40) {
      for (const u of b.active().filter((x) => x.side === 'player')) {
        if (b.status !== 'playing') break;
        // 我方也按敌方 AI 走：打得到就打（含技能），血少于一半先吃药，否则朝老虎走
        const heal = u.hp < u.stats.maxHp * 0.45 ? b.usableSlots(u)[0] : undefined;
        if (heal !== undefined) ev.push(...b.useItem(u, heal, u));
        if (!b.foesOf(u).length) {
          // 还没遇到敌人：往冈上（地图上方）走
          const c = b.moveRange(u).green.reduce((a, x) => (x.x + x.y < a.x + a.y ? x : a), { x: u.x, y: u.y });
          ev.push(...b.move(u, c.x, c.y));
          if (b.canAct(u)) ev.push(...b.wait(u));
          continue;
        }
        const plan = planAi(b, u);
        const last = plan.path?.at(-1);
        if (last && plan.path!.length > 1) ev.push(...b.move(u, last.x, last.y));
        if (plan.skill && plan.cell && plan.skill !== attackSkill(u, b.data)) ev.push(...b.useSkill(u, plan.skill, plan.cell));
        else if (plan.target && b.attackTargets(u).includes(plan.target)) ev.push(...b.attack(u, plan.target));
        else if (b.canAct(u)) ev.push(...b.defend(u));
      }
      if (b.status === 'playing') ev.push(...b.endPlayerPhase());
    }
    if (process.env.TRACE) for (const e of ev) if (e.type === 'attack') console.log('  ', b.units.find((u) => u.uid === e.uid)!.classId, e.skill.name, e.hits.map((h) => `${h.uid}:${JSON.stringify(h.result)}`).join(' '));
    const said = ev.filter((e) => e.type === 'narrate' || e.type === 'say').map((e) => ('text' in e ? e.text : '').slice(0, 8));
    if (b.status === 'won') wins++;
    const hp = (u: (typeof b.units)[number]) => `${b.data.charNames[u.classId] ?? u.classId} ${u.hp}/${u.stats.maxHp} 级${u.level}`;
    // 我方和敌方首领（体力上限最高的敌人）的剩余体力
    const me = b.units.filter((u) => u.side === 'player' && u.present).map(hp).join('、');
    const boss = b.units.filter((u) => u.side === 'enemy').sort((a, c) => c.stats.maxHp - a.stats.maxHp)[0];
    const left = b.units.filter((u) => u.side === 'enemy' && u.present && u.hp > 0).length;
    const flags =
      id === 'wusong' ? `  折棒 ${said.some((s) => s.startsWith('武松双手')) ? '是' : '否'}  泄气 ${said.some((s) => s.startsWith('原来那大虫')) ? '是' : '否'}` : '';
    console.log(`种子 ${seed}: ${b.status} 第 ${b.turn} 回合  ${me}  ${boss ? hp(boss) : ''}  敌人剩 ${left}${flags}`);
  }
  console.log(`胜 ${wins}/${n}`);
}
