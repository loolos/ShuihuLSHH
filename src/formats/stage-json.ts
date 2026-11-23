// 原版关卡与地图的 JSON 形式（gamedata/stages/*.json、gamedata/maps/*.json）。
// 2026-11-19 由原版 .act/.pab/.pas/.map 导出（并入了当时的重制版关卡改动），此后 JSON 就是原版关卡的唯一来源，可直接编辑。
// 字段说明见 docs/binary-formats.md §7（单位）、§8（剧本区块与指令）。
import type { ActUnit } from './act.ts';
import type { MapData, MapJson } from './map.ts';
import type { PasBlock, PasHeader, PasOp } from './pas.ts';
import type { FireRules } from '../rules/fire.ts';

/** 关卡单位：ACT 的一条记录（index = 在 units 里的位置，剧本按 group 点名） */
export type StageUnit = Omit<ActUnit, 'raw'>;

/** 剧本区块：区块号 = 在 blocks 里的位置，所以文件里不写 index */
export type StageBlock = Omit<PasBlock, 'index'>;

/** 战斗规则里的关卡特例（原 src/rules/stage-tune.ts 的运行时部分，见 docs/game-design.md §9.3） */
export interface StageRules {
  /** 这个角色（角色号）倒下时，还没来的回合增援提前：第一波马上登场，之后每回合再来一波 */
  rushOnDeath?: number;
  /** "敌方全灭"要连还没登场的回合增援一起算 */
  clearAllWaves?: boolean;
  /** rushOnDeath 那人倒下以后才登场的增援，这几句对白换掉（简体原文 → 替换） */
  rushText?: Record<string, string>;
  /** 过关时还没打倒的敌人（在场的、收手 / 归顺了但没人拿到经验的）按击败经验放进全队经验【新】 */
  poolLeftoverExp?: boolean;
  /** 火势蔓延【新】（火烧草料场）：见 src/rules/fire.ts */
  fire?: FireRules;
  /**
   * 手下留情【新】（夜走东溪村：朱仝放晁盖，负责人 2026-11-21）：角色 by 打角色 target 只是做样子，必定"打中"但没有伤害、
   * 不中毒眩晕；by 的 AI 专找 target 打。第一次打到时设标志 flag（剧本用条件 100 接着演对白）。
   */
  feint?: { by: number; target: number; flag?: number };
}

export interface StageJson {
  /** 地图名（gamedata/maps/<名字>.json），可带截取范围「名字@x,y,宽,高」 */
  map: string;
  /** 剧本头：城镇号、下一关（EXE 关卡表序号）、是否过场 */
  header: PasHeader;
  units: StageUnit[];
  /** 剧本区块。文字指令的 text 是显示用的简体（原版 .pas），触发、条件、数值来自 .pab */
  blocks: StageBlock[];
  /** 单位显示名（单位号 → 名字），不写用职业名 */
  names?: Record<number, string>;
  /** 敌人的等级档（单位号 → troop/leader），不写按职业判断 */
  enemyRanks?: Record<number, 'troop' | 'leader'>;
  /** 观战演员（单位号） */
  spectators?: number[];
  /** 单位体力倍率（单位号 → 倍率）【新】：叫阵晁家庄单挑的教头 */
  hpMultipliers?: Record<number, number>;
  /** 过关奖励银子，不写按原版 */
  clearGold?: number;
  rules?: StageRules;
  /**
   * 重制版改过这一关多少【新】（负责人 2026-11-20）：选关页在关名前标星，好知道哪些原版关卡动过。
   * 1 = 改过（插原著引文、补对白、加敌人 / 增援等）；2 = 大改（换胜利方式、重排剧情、整段对白重写）。
   * 不算全局的东西：敌人等级重定、关名。改了关卡记得顺手更新。
   */
  edited?: 1 | 2;
}

/** JSON → 引擎用的单位、区块（补上 index；文字指令的 value 没有意义，补 0） */
export function stageUnits(j: StageJson): ActUnit[] {
  return j.units.map((u, i) => ({ ...u, index: i, extra: [...u.extra], items: [...u.items] }));
}
export function stageBlocks(j: StageJson, stage?: string): PasBlock[] {
  return j.blocks.map((b, i) => ({
    ...b,
    index: i,
    ops: b.ops.map((o) => ({ ...o, value: o.value ?? 0, ...(stage && o.id !== undefined ? { tid: `${stage}#${o.id}` } : {}) })),
  }));
}

const line = (v: unknown) => JSON.stringify(v);

/** 写成便于阅读和比对的格式：每个单位、每条指令各占一行 */
export function formatStageJson(j: StageJson & { units: (StageUnit & { raw?: unknown })[]; blocks: (StageBlock & { index?: number })[] }): string {
  const out: string[] = ['{'];
  if (j.edited) out.push(`  "edited": ${j.edited},`);
  out.push(`  "map": ${line(j.map)},`);
  out.push(`  "header": ${line(j.header)},`);
  out.push('  "units": [');
  out.push(
    j.units
      .map(({ index, type, group, side, facing, x, y, level, flags, extra, items }) => '    ' + line({ index, type, group, side, facing, x, y, level, flags, extra, items }))
      .join(',\n'),
  );
  out.push('  ],');
  out.push('  "blocks": [');
  out.push(
    j.blocks
      .map(({ head, trigger, cond, ops }) => {
        const opLines = ops.map((o: PasOp) => {
          const { op, flag, value, text, id, ...rest } = o;
          return '        ' + line(text !== undefined ? { op, flag, id, text, ...rest } : { op, flag, value, ...rest });
        });
        return `    {\n      "trigger": ${line(trigger)},\n      "cond": ${line(cond)},\n      "head": ${line(head)},\n      "ops": [\n${opLines.join(',\n')}\n      ]\n    }`;
      })
      .join(',\n'),
  );
  const extra: [string, unknown][] = (
    [
      ['names', j.names],
      ['enemyRanks', j.enemyRanks],
      ['spectators', j.spectators],
      ['hpMultipliers', j.hpMultipliers],
      ['clearGold', j.clearGold],
      ['rules', j.rules && Object.fromEntries(Object.entries(j.rules).filter(([, v]) => v !== undefined))],
    ] as [string, unknown][]
  ).filter(([, v]) => v !== undefined);
  out.push(extra.length ? '  ],' : '  ]');
  extra.forEach(([k, v], i) => out.push(`  ${line(k)}: ${line(v)}${i < extra.length - 1 ? ',' : ''}`));
  out.push('}');
  return out.join('\n') + '\n';
}

/** 地图写成 MapJson（和自拼地图同一种格式），每行一排格子 */
export function formatMapJson(m: MapData): string {
  const cells = m.cells.map((c) => {
    if (c[0].flags) throw new Error('地表层带高度，MapJson 存不下');
    return c.length === 1 ? c[0].tile : [c[0].tile, ...c.slice(1).flatMap((l) => [l.tile, l.flags])];
  });
  const rows: string[] = [];
  for (let y = 0; y < m.height; y++) rows.push('    ' + cells.slice(y * m.width, (y + 1) * m.width).map((c) => line(c)).join(','));
  return `{\n  "width": ${m.width},\n  "height": ${m.height},\n  "cells": [\n${rows.join(',\n')}\n  ]\n}\n`;
}

export type { MapJson };
