import { areaCells, castCells, learnedSkills } from '../src/rules/skills.ts';
import { attackParts } from '../src/rules/combat.ts';
import { Board } from '../src/rules/board.ts';
import type { Unit } from '../src/rules/unit.ts';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { balanceHeroAoe, HERO_AOE_COSTS } from '../src/rules/aoe-balance.ts';
import { loadPackFromDisk } from '../tools/sim-pack.ts';
import { DATA } from '../tools/sim-lib.ts';

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')) )('群伤技能耗气审查', () => {
  const rt = loadPackFromDisk('mainline');
  it('最终载入的全部原版好汉技能使用审定耗气，且不改变敌方同号技能', () => {
    for (const [cls, costs] of Object.entries(HERO_AOE_COSTS)) {
      for (const [id, cost] of Object.entries(costs)) {
        const skill = rt.data.classes[Number(cls)].skills.find(s => s.skillId === Number(id));
        expect(skill, `${cls}/${id}`).toBeDefined();
        expect(skill!.mpCost, `${cls}/${skill!.name}`).toBe(cost);
      }
    }
    for (const cls of rt.data.classes.filter(c => c.id >= 18)) {
      for (const skill of cls.skills) expect(balanceHeroAoe(cls.id, skill)).toBe(skill);
    }
    expect(rt.data.classes[9].skills.find(s => s.skillId === 84)?.hitMod).toBe(15);
    const costs = rt.data.classes[12].skills.filter(s => s.skillId >= 107 && s.skillId <= 111).map(s => s.mpCost);
    expect(costs).toEqual([75, 100, 120, 140, 160]);
  });
  for(const pack of ['mainline'])it(`${pack}万夫莫敌四阶数值、段数、范围及28级替换正确`,()=>{
    const d=loadPackFromDisk(pack).data;
    const tiers=d.classes[0].skills.filter(s=>[10,11,12,1309].includes(s.skillId));expect(tiers).toHaveLength(4);
    tiers.forEach((s,i)=>{
      expect(s).toMatchObject({learnLevel:[8,12,22,28][i],mpCost:[75,115,170,210][i],power:[35,45,55,55][i],critMod:[20,20,20,5][i],hitMod:5+5*i,type:1,area:5+i,poison:0,stun:0});
      expect(s.damageScale).toBe(i===3?0.85:undefined);
      expect(attackParts(s)).toHaveLength(i<2?1:2);expect(attackParts(s).reduce((n,h)=>n+h.percent,0)).toBe(100);
      for(const [dx,dy]of [[0,-1],[1,0],[0,1],[-1,0]])expect(areaCells(new Board(40,40),{x:20,y:20},s,{x:20+dx,y:20+dy})).toHaveLength([13,18,25,32][i]);
    });
    for(let level=1;level<=30;level++){
      const skills=learnedSkills({classId:0,level}as Unit,d).filter(s=>s.name.startsWith('萬夫莫敵'));
      const tier=[8,12,22,28].filter(n=>n<=level).length;expect(skills).toHaveLength(tier?1:0);if(tier)expect(skills[0]).toBe(tiers[tier-1]);
    }
  });
  it('千军万马四阶：命中+5/+10/+15/+20、三四阶两段、一线3/5/7/9格、22级换成LV4',()=>{
    const d=loadPackFromDisk('mainline').data;
    const tiers=d.classes[0].skills.filter(s=>[4,5,6,1310].includes(s.skillId));expect(tiers).toHaveLength(4);
    tiers.forEach((s,i)=>{
      expect(s).toMatchObject({learnLevel:[7,10,15,22][i],mpCost:[50,75,110,150][i],power:[25,40,50,65][i],hitMod:5+5*i,type:0,area:3+2*i});
      expect(attackParts(s)).toHaveLength(i<2?1:2);expect(attackParts(s).reduce((n,h)=>n+h.percent,0)).toBe(100);
      expect(areaCells(new Board(40,40),{x:20,y:20},s,{x:20,y:21})).toHaveLength(3+2*i);
      // LV3、LV4 可选周围 8 格，斜着放时一线斜着走；LV1、LV2 仍只四向
      const cells=castCells(new Board(40,40),{x:20,y:20},[1,1],s.targetShape);
      expect(cells).toHaveLength(i<2?4:8);
      if(i>=2)expect(areaCells(new Board(40,40),{x:20,y:20},s,{x:21,y:21})).toEqual(Array.from({length:3+2*i},(_,k)=>({x:21+k,y:21+k})));
    });
    for(let level=1;level<=30;level++){
      const skills=learnedSkills({classId:0,level}as Unit,d).filter(s=>s.name.startsWith('千軍萬馬'));
      const tier=[7,10,15,22].filter(n=>n<=level).length;expect(skills).toHaveLength(tier?1:0);if(tier)expect(skills[0]).toBe(tiers[tier-1]);
    }
    // 敌方版武龍不受影响
    for(const c of d.classes.filter(c=>c.id>=18))expect(c.skills.some(s=>s.skillId===1310)).toBe(false);
  });
  it('铲恶除奸四阶：命中+5/+10/+15/+20、必杀+10/+12/+14/+16、几级几段、一线3/4/5/6格、30级换成LV4',()=>{
    const d=loadPackFromDisk('mainline').data;
    const tiers=d.classes[11].skills.filter(s=>[101,102,103,1311].includes(s.skillId));expect(tiers).toHaveLength(4);
    tiers.forEach((s,i)=>{
      expect(s).toMatchObject({learnLevel:[11,15,25,30][i],mpCost:[55,100,135,175][i],power:[25,35,60,75][i],hitMod:5+5*i,critMod:10+2*i,type:0,area:3+i});
      expect(attackParts(s)).toHaveLength(i+1);expect(attackParts(s).reduce((n,h)=>n+h.percent,0)).toBe(100);
      expect(areaCells(new Board(40,40),{x:20,y:20},s,{x:20,y:21})).toHaveLength(3+i);
    });
    for(let level=1;level<=32;level++){
      const skills=learnedSkills({classId:11,level}as Unit,d).filter(s=>s.name.startsWith('鏟惡除奸'));
      const tier=[11,15,25,30].filter(n=>n<=level).length;expect(skills).toHaveLength(tier?1:0);if(tier)expect(skills[0]).toBe(tiers[tier-1]);
    }
    for(const c of d.classes.filter(c=>c.id>=18))expect(c.skills.some(s=>s.skillId===1311)).toBe(false);
  });
  it('主线与江州的对应扩展技能同步，非审定技能保留', () => {
    for (const pack of ['mainline']) {
      const p = loadPackFromDisk(pack);
      for (const [cls, name, cost] of [['wusong', '玉环鸳鸯脚', 55], ['huarong', '穿云贯日LV3', 60], ['huarong', '连珠飞星', 60]] as const) {
        expect(p.data.classes[p.classIds.get(cls)!].skills.find(s => s.name === name)?.mpCost).toBe(cost);
      }
    }
  });
});

describe.skipIf(!fs.existsSync(path.join(DATA, 'Data/Human.hum')))('林沖 懷璧其罪 LV3/LV4', () => {
  it('LV3、LV4 打施放点及左右各一格（选身前相邻格即前方三格），30 级学会 LV4', () => {
    const d = loadPackFromDisk('mainline').data;
    const tiers = d.classes[11].skills.filter((s) => s.name.startsWith('懷璧其罪'));
    expect(tiers.map((s) => [s.name, s.learnLevel, s.mpCost])).toEqual([
      ['懷璧其罪LV1', 9, 30], ['懷璧其罪LV2', 18, 40], ['懷璧其罪LV3', 24, 60], ['懷璧其罪LV4', 30, 75],
    ]);
    const board = new Board(40, 40);
    for (const s of tiers.slice(2)) {
      expect(areaCells(board, { x: 20, y: 20 }, s, { x: 20, y: 19 })).toEqual(
        expect.arrayContaining([{ x: 19, y: 19 }, { x: 20, y: 19 }, { x: 21, y: 19 }]));
      expect(areaCells(board, { x: 20, y: 20 }, s, { x: 20, y: 19 })).toHaveLength(3);
    }
    expect(areaCells(board, { x: 20, y: 20 }, tiers[1], { x: 20, y: 19 })).toHaveLength(1);
    // LV3、LV4 能斜放（负责人 2026-11-24）：射程 1–2 的四向 + 四斜共 16 格；斜放打施放点和它朝林沖那边的两格
    for (const s of tiers.slice(2)) {
      expect(castCells(board, { x: 20, y: 20 }, [s.rangeMin, s.rangeMax], s.targetShape)).toHaveLength(16);
      expect(areaCells(board, { x: 20, y: 20 }, s, { x: 21, y: 19 })).toEqual([{ x: 21, y: 19 }, { x: 20, y: 19 }, { x: 21, y: 20 }]);
      expect(areaCells(board, { x: 20, y: 20 }, s, { x: 18, y: 22 })).toEqual([{ x: 18, y: 22 }, { x: 19, y: 22 }, { x: 18, y: 21 }]);
    }
    expect(castCells(board, { x: 20, y: 20 }, [tiers[1].rangeMin, tiers[1].rangeMax], tiers[1].targetShape)).toHaveLength(8);
    const at30 = learnedSkills({ classId: 11, level: 30 } as Unit, d).filter((s) => s.name.startsWith('懷璧其罪'));
    expect(at30.map((s) => s.name)).toEqual(['懷璧其罪LV4']);
  });
});
