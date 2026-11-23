// 扩展包关卡试打：我方也交给 AI，跑若干种子，打印胜率、回合数、关键剧情有没有触发。
// 用法：node --experimental-transform-types tools/sim-pack.ts [包名] [关卡] [种子数]
//      包名写 original 时试打原版关卡（关卡写地图名，如 N10），我方按选关跳关的等级和装备。
// 我方开局站得太靠前的人先后撤（tools/sim-orders.ts；SIM_AUTO_BACK=0 关掉，TRACE_ORDERS=1 打印）。
import fs from 'node:fs';
import path from 'node:path';
import { Battle } from '../src/rules/battle.ts';
import { bestAttack, planAi } from '../src/rules/ai.ts';
import { attackSkill, facingTowards } from '../src/rules/unit.ts';
import { watcherSees } from '../src/rules/combat.ts';
import { buildT2S, exeTables, loadGameData, loadStage } from '../src/rules/load.ts';
import { jumpTo } from '../src/rules/preset.ts';
import { joinLevel, newCampaign, partyOf } from '../src/rules/campaign.ts';
import type { StageInput } from '../src/rules/battle.ts';
import { useDiskCustomMaps } from '../src/packs/custom-maps-node.ts';
import { buildPack, compileStage, type SpriteSheetJson } from '../src/packs/build.ts';
import type { PackJson, PackStageJson } from '../src/packs/types.ts';
import { DATA, NodeFiles } from './sim-lib.ts';
import { applyOrders, hasOrder } from './sim-orders.ts';

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
  const data = loadGameData(files, tr);
  let make: (seed: number) => StageInput;
  let stage: { id: string };
  const stageKey = id === 'original' ? stageId.toUpperCase() : `${id}/${stageId}`;
  if (id === 'original') {
    const stages = exeTables(files).stages;
    const st = stages.find((s) => s.mapName.toUpperCase() === stageKey);
    if (!st) throw new Error(`找不到原版关卡 ${stageId}`);
    const c = jumpTo(files, data, stages, st.index, newCampaign(0));
    stage = { id: st.mapName };
    make = (seed) => loadStage(files, data, st.mapName, { seed, text: tr, party: partyOf(c), joinLevel: joinLevel(c) });
  } else {
    const rt = loadPackFromDisk(id, data);
    const ps = rt.stages.find((s) => !stageId || s.id === stageId)!;
    stage = ps;
    make = (seed) => compileStage(rt, ps, files, { seed, text: tr, preset: id === 'mainline' });
  }
  let wins = 0;
  for (let seed = 1; seed <= Number(n); seed++) {
    const input = make(seed);
    const b = new Battle(input);
    const goalBlock = input.blocks.find((x) => x.trigger.kind === 'area' && !(x.trigger.side && x.trigger.flagged) && x.ops.some((o) => o.op === 29));
    const gt = goalBlock?.trigger.kind === 'area' ? goalBlock.trigger : null;
    let goal = gt ? { who: gt.chars ?? [gt.char], x: (gt.x1 + gt.x2) >> 1, y: (gt.y1 + gt.y2) >> 1, x1: Math.min(gt.x1, gt.x2), x2: Math.max(gt.x1, gt.x2), y1: Math.min(gt.y1, gt.y2), y2: Math.max(gt.y1, gt.y2) } : null;
    const inGoal = (c: { x: number; y: number }) => !!goal && c.x >= goal.x1 && c.x <= goal.x2 && c.y >= goal.y1 && c.y <= goal.y2;
    /** 区域里离这人最近、没人站的格子（区域中心被人占了也能进去） */
    const goalCell = (u: Battle['units'][number]) => {
      let best = { x: goal!.x, y: goal!.y }, bd = Infinity;
      for (let y = goal!.y1; y <= Math.min(goal!.y2, b.board.height - 1); y++) for (let x = goal!.x1; x <= Math.min(goal!.x2, b.board.width - 1); x++) {
        if (!b.board.passable(x, y) || b.active().some((o) => o !== u && o.x === x && o.y === y)) continue;
        const d = dist(u, { x, y });
        if (d < bd) { bd = d; best = { x, y }; }
      }
      return best;
    };
    const ev = [...b.begin()];
    while (b.pendingChoice) ev.push(...b.answer(0));
    let guard = 0;
    while (b.status === 'playing' && guard++ < 40) {
      // 没有直接过关的区域时，用画面上标出的目标区域（区域只设标志、另有区块再过关，如旱地忽律放号箭）
      if (!gt) {
        const z = b.objectiveZones().find((k) => k.kind === 'goal');
        goal = z ? { who: z.chars, x: (z.x1 + z.x2) >> 1, y: (z.y1 + z.y2) >> 1, x1: z.x1, x2: z.x2, y1: z.y1, y2: z.y2 } : null;
      }
      // 谁都能进的区域（智取无为军的探查点、放火点）：每个这样的区域派离它最近、还没分派的一个人去【新】
      const anyZones = !gt ? b.objectiveZones().filter((k) => k.kind === 'goal' && !k.chars.length) : [];
      const assigned = new Map<number, (typeof anyZones)[number]>();
      for (const z of anyZones) {
        const c = { x: (z.x1 + z.x2) >> 1, y: (z.y1 + z.y2) >> 1 };
        const field = b.board.distanceField([c]);
        const free = b.active().filter((x) => x.side === 'player' && !assigned.has(x.uid) && b.canAct(x));
        const who = free.sort((p, q) => field[p.y * b.board.width + p.x] - field[q.y * b.board.width + q.x])[0];
        if (who) assigned.set(who.uid, z);
      }
      for (const u of b.active().filter((x) => x.side === 'player')) {
        if (b.status !== 'playing') break;
        if (!b.canAct(u)) continue;
        const zone = assigned.get(u.uid);
        // 不潜行时，附近 6 格有敌人就先打，清出路来再去
        if (zone && !b.watchZones().length && b.foesOf(u).some((f) => dist(f, u) <= 6)) goal = null;
        else if (zone) goal = { who: [u.classId], x: (zone.x1 + zone.x2) >> 1, y: (zone.y1 + zone.y2) >> 1, x1: zone.x1, x2: zone.x2, y1: zone.y1, y2: zone.y2 };
        else if (anyZones.length) {
          const z = b.objectiveZones().find((k) => k.kind === 'goal' && k.chars.includes(u.classId));
          goal = z ? { who: z.chars, x: (z.x1 + z.x2) >> 1, y: (z.y1 + z.y2) >> 1, x1: z.x1, x2: z.x2, y1: z.y1, y2: z.y2 } : null;
        }
        // 潜行关：有人被发现就全力去打倒发现的人；否则要逃的人绕开哨兵现在和下回合看得见的格子往区域走
        if (b.watchZones().length) {
          // 期限最近的发现者先打，用打他最狠的招
          const spotter = b.units.filter((w) => w.uid in b.spotters && w.alive && w.present).sort((p, q) => b.spotters[p.uid] - b.spotters[q.uid])[0];
          if (spotter) {
            const plan = bestAttack(b, u, spotter);
            const last = plan?.path?.at(-1);
            if (plan && last && plan.path!.length > 1) ev.push(...b.move(u, last.x, last.y));
            if (plan?.skill && plan.cell && plan.skill !== attackSkill(u, b.data)) ev.push(...b.useSkill(u, plan.skill, plan.cell));
            else if (plan?.target && b.attackTargets(u).includes(plan.target)) ev.push(...b.attack(u, plan.target));
            else {
              walkTo(b, u, spotter.x, spotter.y, ev);
              if (b.canAct(u) && b.attackTargets(u).includes(spotter)) ev.push(...b.attack(u, spotter));
            }
            if (b.canAct(u)) ev.push(...b.defend(u));
            continue;
          }
          if (goal && goal.who.includes(u.classId)) {
            // 每个哨兵现在和下回合可能站的位置、朝向（巡逻的沿直线往目标点走，走到了会掉头），半径多留 2 格给跟着走的公人
            // 有跟着走的友军（公人）时半径多留 2 格，没有就多留 1 格
            const pad = b.active().some((x) => x.side === 'ally') ? 2 : 1;
            // 认得这人是自己人的哨兵（石秀探庄巡庄庄客认卖柴的）不算眼睛；会盘问的另算「软眼睛」：能绕就绕，绕不过去再硬走
            const trusted = (w: { uid: number }) => !!input.watchTrust?.[w.uid]?.includes(u.classId);
            const soft = b.watchZones().filter((w) => trusted(w) && input.watchQuestion?.includes(w.uid)).map((w) => ({ x: w.x, y: w.y, facing: w.facing, r: w.r }));
            const eyes = b.watchZones().filter((w) => !trusted(w)).flatMap((w) => {
              const g = b.units[w.uid], route = b.patrolOf(g);
              const out = [{ x: w.x, y: w.y, facing: w.facing, r: w.r + pad }];
              if (!route) return out;
              const pt = g.ai.point, f = facingTowards(g, pt, g.facing);
              let x = g.x, y = g.y;
              for (let k = 0; k <= g.stats.move && (x !== pt.x || y !== pt.y); k++) {
                if (x !== pt.x) x += Math.sign(pt.x - x); else y += Math.sign(pt.y - y);
                out.push({ x, y, facing: f, r: w.r + pad });
              }
              if (x === pt.x && y === pt.y) out.push({ x, y, facing: (f + 2) % 4, r: w.r + pad });
              return out;
            });
            const field = b.board.distanceField([{ x: goal.x, y: goal.y }]);
            const d = (c: { x: number; y: number }) => field[c.y * b.board.width + c.x];
            const safe = b.moveRange(u).green.filter((c) => !eyes.some((e) => watcherSees(e, c, e.r) || dist(e, c) <= 1));
            const calm = safe.filter((c) => !soft.some((e) => watcherSees(e, c, e.r)));
            const best = (cs: { x: number; y: number }[]) => cs.reduce((a, g) => (d(g) < d(a) ? g : a), { x: u.x, y: u.y });
            const c0 = best(calm);
            const c = d(c0) < d(u) ? c0 : best(safe);
            if (c.x !== u.x || c.y !== u.y) ev.push(...b.move(u, c.x, c.y));
            if (b.canAct(u)) ev.push(...b.defend(u));
            continue;
          }
          // 潜行中没事做的人原地躲着，不去惊动睡着的敌人
          if (anyZones.length) {
            ev.push(...b.defend(u));
            continue;
          }
        }
        // 关卡要求某几个人走到区域（劫法场逃到出口）：这几个人一律往区域走
        // 像真人一样护送：附近 5 格内有敌人就原地防御，等别人清出路来再走
        // 过关区域还没启用（剧本标志没设）而关卡给这人下了指令（一丈青：扈三娘没捉住前宋江别先跑回营寨）：先照指令走
        const gtIdle = !!gt?.flagged && !(b as unknown as { flagsOk(x: unknown): boolean }).flagsOk(goalBlock);
        if (goal && goal.who.includes(u.classId) && !(gtIdle && hasOrder(stageKey, u.classId, b.turn))) {
          // 这回合走得进区域就直接进去（还道村宋江钻神帐）【新】
          const inReach = b.moveRange(u).green.find((c) => inGoal(c) && !b.active().some((o) => o !== u && o.x === c.x && o.y === c.y));
          if (inReach && !inGoal(u)) { ev.push(...b.move(u, inReach.x, inReach.y)); if (b.canAct(u)) ev.push(...b.defend(u)); }
          else if (b.foesOf(u).some((f) => dist(f, u) <= 5)) ev.push(...b.defend(u));
          else if (inGoal(u)) ev.push(...b.defend(u));
          else {
            // 像真人一样绕开敌人：这回合走得到的格子里，离区域近、又不贴着敌人（4 格内）的优先【新】
            // 从区域往外广搜，敌人 5 格内的格子当成走不通（都绕不开时退回普通距离）
            const W = b.board.width, H = b.board.height, foes = b.foesOf(u);
            const safeField = new Float64Array(W * H).fill(Infinity);
            const q: number[] = [];
            for (let y = goal.y1; y <= Math.min(goal.y2, H - 1); y++) for (let x = goal.x1; x <= Math.min(goal.x2, W - 1); x++) { safeField[y * W + x] = 0; q.push(y * W + x); }
            for (let i = 0; i < q.length; i++) {
              const x = q[i] % W, y = (q[i] / W) | 0;
              for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const X = x + dx, Y = y + dy, k = Y * W + X;
                if (X < 0 || Y < 0 || X >= W || Y >= H || safeField[k] !== Infinity || !b.board.passable(X, Y)) continue;
                if (foes.some((f) => dist(f, { x: X, y: Y }) <= 5)) continue;
                safeField[k] = safeField[q[i]] + 1; q.push(k);
              }
            }
            const field = b.board.distanceField([{ x: goal.x, y: goal.y }]);
            const score = (c: { x: number; y: number }) => (safeField[c.y * W + c.x] !== Infinity ? safeField[c.y * W + c.x] : 1000 + field[c.y * W + c.x]);
            const c = b.moveRange(u).green.filter((g) => !b.active().some((o) => o !== u && o.x === g.x && o.y === g.y)).reduce((a, g) => (score(g) < score(a) ? g : a), { x: u.x, y: u.y });
            if (c.x !== u.x || c.y !== u.y) ev.push(...b.move(u, c.x, c.y));
            if (b.canAct(u)) ev.push(...b.defend(u));
          }
          continue;
        }
        // 能劝人收手的人（梁山截路的宋江）走到最近一个还没劝住的人身边；走到某人身边就过关的（赌坊劝架拦李逵），谁都往那人身边走
        const plea = input.blocks
          .filter((x) => x.trigger.kind === 'near' && !b.hasFired(x.index) && ((x.trigger.by === u.classId && x.ops.some((o) => o.op === 121 || o.op === 103)) || (x.trigger.by === undefined && x.ops.some((o) => o.op === 29 || o.op === 103))))
          .map((x) => x.trigger)
          .map((t) => (t.kind === 'near' ? b.units.find((f) => f.uid === t.uid && f.alive && f.present && (f.side === 'enemy' || f.side === 'ally')) : undefined))
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
        // 开局站得太靠前的人先后撤；关卡指定的开局指令（tools/sim-orders.ts）
        if (applyOrders(b, u, stageKey, ev, (x, y) => walkTo(b, u, x, y, ev))) continue;
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
      if (process.env.TRACE_POS) console.log(`  回合 ${b.turn}:`, b.units.filter((u) => u.side === 'player' && u.present).map((u) => `${u.name}(${u.x},${u.y})`).join(' '), '发现', JSON.stringify(b.spotters));
      if (b.status === 'playing') ev.push(...b.endPlayerPhase());
    }
    if (process.env.TRACE_STATUS) for (const e of ev) if ((e as { type: string }).type === 'status') console.log('  ', b.turn, JSON.stringify(e));
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
