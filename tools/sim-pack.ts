// 扩展包关卡试打：我方也交给 AI，跑若干种子，打印胜率、回合数、关键剧情有没有触发。
// 用法：node --experimental-transform-types tools/sim-pack.ts [包名] [关卡] [种子数]
import fs from 'node:fs';
import path from 'node:path';
import { Battle } from '../src/rules/battle.ts';
import { planAi } from '../src/rules/ai.ts';
import { attackSkill } from '../src/rules/unit.ts';
import { buildT2S, loadGameData } from '../src/rules/load.ts';
import { useDiskCustomMaps } from '../src/packs/custom-maps-node.ts';
import { buildPack, compileStage, type SpriteSheetJson } from '../src/packs/build.ts';
import type { PackJson, PackStageJson } from '../src/packs/types.ts';
import { DATA, NodeFiles } from './sim-lib.ts';

useDiskCustomMaps(); // 自拼地图 packs/maps/*.json（§15.15）

export function loadPackFromDisk(id: string, base = loadGameData(new NodeFiles(DATA))) {
  const dir = path.resolve(import.meta.dirname, '../packs', id);
  const read = (p: string) => JSON.parse(fs.readFileSync(path.join(dir, p), 'utf8'));
  const pack = read('pack.json') as PackJson;
  const stages = pack.stages.map((s) => read(s) as PackStageJson);
  const sheets: Record<string, SpriteSheetJson> = {};
  for (const c of pack.classes) if ('sheet' in c.sprite) sheets[c.sprite.sheet] = read(`${c.sprite.sheet}/sprites.json`);
  return buildPack(base, pack, stages, sheets);
}

const dist = (a: { x: number; y: number }, c: { x: number; y: number }) => Math.abs(a.x - c.x) + Math.abs(a.y - c.y);
/** 走到离 (x, y) 最近的能到的格子；走不动就原地防御 */
function walkTo(b: Battle, u: Battle['units'][number], x: number, y: number, ev: unknown[]) {
  // 按地形距离（绕开墙）挑最近的一格，不用直线距离，免得隔着墙卡住
  const field = b.board.distanceField([{ x, y }]);
  const d = (c: { x: number; y: number }) => field[c.y * b.board.width + c.x];
  const c = b.moveRange(u).green.reduce((a, g) => (d(g) < d(a) ? g : a), { x: u.x, y: u.y });
  if (c.x !== u.x || c.y !== u.y) ev.push(...b.move(u, c.x, c.y));
  if (b.canAct(u)) ev.push(...b.defend(u));
}

if (import.meta.main ?? process.argv[1]?.endsWith('sim-pack.ts')) {
  const [id = 'mainline', stageId = 'jingyanggang', n = '20'] = process.argv.slice(2);
  const files = new NodeFiles(DATA);
  const tr = buildT2S(files);
  const rt = loadPackFromDisk(id, loadGameData(files, tr));
  const stage = rt.stages.find((s) => !stageId || s.id === stageId)!;
  let wins = 0;
  for (let seed = 1; seed <= Number(n); seed++) {
    const input = compileStage(rt, stage, files, { seed, text: tr, preset: id === 'mainline' });
    const b = new Battle(input);
    const goalBlock = input.blocks.find((x) => x.trigger.kind === 'area' && x.ops.some((o) => o.op === 29));
    const goal = goalBlock?.trigger.kind === 'area' ? { who: goalBlock.trigger.chars ?? [goalBlock.trigger.char], x: (goalBlock.trigger.x1 + goalBlock.trigger.x2) >> 1, y: (goalBlock.trigger.y1 + goalBlock.trigger.y2) >> 1 } : null;
    const ev = [...b.begin()];
    while (b.pendingChoice) ev.push(...b.answer(0));
    let guard = 0;
    while (b.status === 'playing' && guard++ < 40) {
      for (const u of b.active().filter((x) => x.side === 'player')) {
        if (b.status !== 'playing') break;
        if (!b.canAct(u)) continue;
        // 关卡要求某几个人走到区域（劫法场逃到出口）：这几个人一律往区域走
        // 像真人一样护送：附近 5 格内有敌人就原地防御，等别人清出路来再走
        if (goal && goal.who.includes(u.classId)) {
          if (b.foesOf(u).some((f) => dist(f, u) <= 5)) ev.push(...b.defend(u));
          else walkTo(b, u, goal.x, goal.y, ev);
          continue;
        }
        // 能劝人收手的人（梁山截路的宋江）：走到最近一个还没劝住的人身边
        const plea = input.blocks
          .filter((x) => x.trigger.kind === 'near' && x.trigger.by === u.classId && !b.hasFired(x.index) && x.ops.some((o) => o.op === 121))
          .map((x) => x.trigger)
          .map((t) => (t.kind === 'near' ? b.units.find((f) => f.uid === t.uid && f.alive && f.present && f.side === 'enemy') : undefined))
          .filter((t) => t !== undefined)
          .sort((p, q) => dist(p, u) - dist(q, u))[0];
        if (plea) {
          walkTo(b, u, plea.x, plea.y, ev);
          continue;
        }
        // 有被绑的自己人：最近的一个人先过去松绑
        const bound = b.active().find((x) => x.side === 'player' && x.stunTurns >= 1000);
        if (bound && b.active().filter((x) => x.side === 'player' && x.stunTurns < 1000).sort((p, q) => dist(p, bound) - dist(q, bound))[0] === u) {
          walkTo(b, u, bound.x, bound.y, ev);
          if (b.canAct(u)) ev.push(...b.defend(u));
          continue;
        }
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
      stage.id === 'jingyanggang' ? `  折棒 ${said.some((s) => s.startsWith('武松双手')) ? '是' : '否'}  泄气 ${said.some((s) => s.startsWith('原来那大虫')) ? '是' : '否'}` : '';
    console.log(`种子 ${seed}: ${b.status} 第 ${b.turn} 回合  ${me}  ${boss ? hp(boss) : ''}  敌人剩 ${left}${flags}`);
  }
  console.log(`胜 ${wins}/${n}`);
}
