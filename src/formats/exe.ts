// ShuiHu.exe 内的静态数据表（只读解析，不执行）。
// 地址来自 ChillWhiteDid/Shuihu-Editor 与本项目核对；本副本中 文件偏移 = VA − 0x400000。
import { cstrBig5 } from './bytes.ts';

const IMAGE_BASE = 0x400000;
const VA_NAMES = 0x443a5c; // 角色名表（72 项）+ 绰号表（紧随其后，与角色编号一一对应，可为空串）
const VA_SKILLS = 0x443bc4; // 技能名表（0–228）+ 关卡名表（229 起，与关卡表一一对应）
const VA_STAGES = 0x4430f0; // 关卡地图路径表（76 项，可为空）
/**
 * 二选一对话框（0x413650 按序号建立）：
 * - 问题表 0x443988，每项 14 字节 {u16 说话人, 指针 问题, 指针 按钮一, 指针 按钮二}；
 * - 回答表 0x4439b2，每项 12 字节 {u16 说话人, 指针 选一后的台词, u16 说话人, 指针 选二后的台词}。
 * 0 = N-add03 伏兵号令（AI 模式 9 的单位行动时弹出，0x407b26）；1、2 = 离开城镇 2、5 时问走大道还是小径（0x418c60）。
 */
const VA_PROMPTS = 0x443988;
const VA_REPLIES = 0x4439b2;
const PROMPT_COUNT = 3;
/** 城镇（0x418a40 菜单、0x4149a0 选货、0x419360 酒店交谈）：店名 5 项，接着是各店的招呼语和告别语 */
const VA_SHOP_NAMES = 0x44392c; // 酒店、武器店、打鐵鋪、藥鋪、當鋪
const VA_SHOP_GREET = 0x44395c;
const VA_SHOP_BYE = 0x443970;
/** 酒店传闻：19 条文字指针；每个城镇 {s16 起始, s16 条数}（0x445f50，城镇号 0–13，−1 = 没有） */
const VA_RUMORS = 0x4439d8;
const RUMOR_COUNT = 19;
const VA_TOWN_RUMORS = 0x445f50;
export const TOWN_COUNT = 13;

export const CLASS_COUNT = 72;
export const PLAYABLE_COUNT = 18; // 绰号表只有前 18 项（可控好汉），其后紧接技能名表
export const STAGE_COUNT = 76;
export const SKILL_NAME_COUNT = 229;

function isPtr(v: number): boolean {
  return v >= IMAGE_BASE && v < IMAGE_BASE + 0x100000;
}

function readPtrTable(exe: Buffer, va: number, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const v = exe.readUInt32LE(va - IMAGE_BASE + 4 * i);
    out.push(isPtr(v) ? cstrBig5(exe, v - IMAGE_BASE) : '');
  }
  return out;
}

export interface ExePrompt {
  speaker: number;
  question: string;
  options: [string, string];
  /** 选了第 k 个按钮后，replies[k] 的人说的台词 */
  replies: [{ speaker: number; text: string }, { speaker: number; text: string }];
}

export interface ExeTables {
  /** 下标 = 职业/角色编号 0–71 */
  characterNames: string[];
  /** 下标 = 可控好汉编号 0–17；空串表示无绰号 */
  nicknames: string[];
  /** 下标 = 技能名编号 0–228（HUM 技能子项 +0） */
  skillNames: string[];
  stages: { index: number; mapPath: string; mapName: string; title: string }[];
  /** 二选一对话框（见 VA_PROMPTS） */
  prompts: ExePrompt[];
  /** 城镇的店名、招呼语、告别语（各 5 项，按店序号），以及每个城镇号（1–13）的酒店传闻 */
  town: { shops: string[]; greet: string[]; bye: string[]; rumors: string[][] };
}

export function readExeTables(exe: Buffer): ExeTables {
  const names = readPtrTable(exe, VA_NAMES, CLASS_COUNT * 2);
  const skillsAndStages = readPtrTable(exe, VA_SKILLS, SKILL_NAME_COUNT + STAGE_COUNT);
  const paths = readPtrTable(exe, VA_STAGES, STAGE_COUNT);
  return {
    characterNames: names.slice(0, CLASS_COUNT),
    nicknames: names.slice(CLASS_COUNT, CLASS_COUNT + PLAYABLE_COUNT),
    skillNames: skillsAndStages.slice(0, SKILL_NAME_COUNT),
    prompts: Array.from({ length: PROMPT_COUNT }, (_, i): ExePrompt => {
      const str = (o: number) => cstrBig5(exe, exe.readUInt32LE(o) - IMAGE_BASE);
      const q = VA_PROMPTS - IMAGE_BASE + 14 * i;
      const r = VA_REPLIES - IMAGE_BASE + 12 * i;
      return {
        speaker: exe.readUInt16LE(q),
        question: str(q + 2),
        options: [str(q + 6), str(q + 10)],
        replies: [
          { speaker: exe.readUInt16LE(r), text: str(r + 2) },
          { speaker: exe.readUInt16LE(r + 6), text: str(r + 8) },
        ],
      };
    }),
    town: readTown(exe),
    stages: paths.map((p, i) => ({
      index: i,
      mapPath: p,
      mapName: p.replace(/^map\\/i, ''),
      title: skillsAndStages[SKILL_NAME_COUNT + i].replace(/\s+/g, ' ').trim(),
    })),
  };
}

function readTown(exe: Buffer): ExeTables['town'] {
  const all = readPtrTable(exe, VA_RUMORS, RUMOR_COUNT);
  const rumors = Array.from({ length: TOWN_COUNT + 1 }, (_, t) => {
    const o = VA_TOWN_RUMORS - IMAGE_BASE + 4 * t;
    const start = exe.readInt16LE(o), count = exe.readInt16LE(o + 2);
    return start < 0 ? [] : all.slice(start, start + count);
  });
  return { shops: readPtrTable(exe, VA_SHOP_NAMES, 5), greet: readPtrTable(exe, VA_SHOP_GREET, 5), bye: readPtrTable(exe, VA_SHOP_BYE, 5), rumors };
}
