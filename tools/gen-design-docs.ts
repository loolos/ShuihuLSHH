// 从原版数据生成设计阶段文档（docs/design/*.md）与结构化数据（extracted/*.json，不入库）。
// 用法：node tools/gen-design-docs.ts [原版目录]   （默认 gamedata/shuihu，或环境变量 SHUIHU_DATA）
// 只读打开原版文件；Node 22.6+ 直接运行 .ts（类型擦除），无第三方依赖。
import fs from 'node:fs';
import path from 'node:path';
import { readExeTables, PLAYABLE_COUNT } from '../src/formats/exe.ts';
import { parseGoods, itemTypeName, WEAPON_TYPES, type Item } from '../src/formats/goo.ts';
import { parseHuman } from '../src/formats/hum.ts';
import { parseAct, type ActUnit, type Side } from '../src/formats/act.ts';
import { parsePas, type PasScript } from '../src/formats/pas.ts';
import { parseMap } from '../src/formats/map.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.resolve(process.argv[2] ?? process.env.SHUIHU_DATA ?? path.join(ROOT, 'gamedata/shuihu'));
const DOCS = path.join(ROOT, 'docs/design');
const OUT = path.join(ROOT, 'extracted/data');
fs.mkdirSync(DOCS, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const read = (...p: string[]) => fs.readFileSync(path.join(DATA, ...p));
// Map 目录下的文件名大小写与 EXE 路径表不一致（如 n-add01 ↔ N-add01.map），按不区分大小写查找
const mapFiles = new Map(fs.readdirSync(path.join(DATA, 'Map')).map((f) => [f.toLowerCase(), f]));
const mapFile = (name: string, ext: string) => mapFiles.get(`${name}.${ext}`.toLowerCase());

const exe = readExeTables(read('ShuiHu.exe'));
const items = parseGoods(read('Data', 'Goods.dab'));
const classes = parseHuman(read('Data', 'Human.hum'));
const names = exe.characterNames;

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const charName = (id: number) => names[id] || `#${id}`;
const skillName = (id: number) => exe.skillNames[id] || `#${id}`;
const speakerName = (id: number) => (id < names.length ? names[id] : `特殊#${id}`);

/** 槽位 0 的含义有歧义：道具 0 是"皮手套"（武器）。非武器槽里的 0 一定是空；武器槽里的 0 仅在职业武器类别为 0 时视为皮手套。 */
function slotItem(id: number, slot: number, weaponType: number | null): string {
  if (id === 0 && (slot > 0 || weaponType !== 0)) return '—';
  return items[id]?.name ?? `#${id}`;
}

const HEADER = (title: string, desc: string) =>
  `# ${title}\n\n> 由 \`tools/gen-design-docs.ts\` 从原版数据自动生成，请勿手改；修正请改工具或另写 overrides。\n> ${desc}\n> 字段置信度沿用 [binary-formats.md](../binary-formats.md)：标"推测"的列只是候选解释。\n\n`;

// ───────────────────────── 1. 规则数据表 ─────────────────────────
function genDataTables(): string {
  let md = HEADER(
    '规则数据表（data-tables）',
    '来源：`Human.hum`（职业）、`Goods.dab`（道具）、`ShuiHu.exe`（角色名、绰号、技能名）。按项目总纲 §2.2，这些数值是**参考基线**，重制版可以重新设计。',
  );

  md += `## 1. 可控好汉（职业 0–${PLAYABLE_COUNT - 1}）\n\n`;
  md +=
    '属性列顺序推测为 攻擊/防禦/命中/敏捷/必殺（值 + 成长等级字母），依据是 Editor 存档字段顺序与数值量级（攻、命大，防、敏小，必杀最小），置信度**中低**。生命/气力为推测的初始值。\n\n';
  md += '| # | 姓名 | 绰号 | 生命 | 气力 | 移动 | 攻 | 防 | 命 | 敏 | 必 | 武器类别 | 默认装备（推测） | 技能数 |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n';
  for (const c of classes.slice(0, PLAYABLE_COUNT)) {
    const st = c.stats.map((s) => `${s.base}${s.grade.trim()}`);
    const eq = c.defaultItems.map((id, k) => slotItem(id, k, c.weaponType)).filter((x) => x !== '—');
    md += `| ${c.id} | ${charName(c.id)} | ${exe.nicknames[c.id] || ''} | ${c.hp}${c.hpGrade} | ${c.mp}${c.mpGrade} | ${c.move} | ${st.join(' | ')} | ${WEAPON_TYPES[c.weaponType] ?? c.weaponType} | ${eq.join('、') || '—'} | ${c.skills.length} |\n`;
  }

  md += '\n## 2. 好汉技能表\n\n每个技能：学习等级、名称，`*` 表示隐藏技（需古武術祕笈）。技能子项 58 B 中其余字段（推测含气力消耗、威力、范围）原样保留在 `extracted/data/classes.json`。\n\n';
  for (const c of classes.slice(0, PLAYABLE_COUNT)) {
    const list = [...c.skills].sort((a, b) => a.learnLevel - b.learnLevel).map((s) => `Lv${s.learnLevel} ${skillName(s.skillId)}${s.hidden ? '*' : ''}`);
    md += `- **${charName(c.id)}**：${list.join('、') || '（无）'}\n`;
  }

  md += '\n## 3. NPC 与敌方职业（18–71）\n\n| # | 名称 | 生命 | 气力 | 移动 | 攻 | 防 | 命 | 敏 | 必 | 武器类别 | 技能 |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n';
  for (const c of classes.slice(PLAYABLE_COUNT)) {
    const st = c.stats.map((s) => `${s.base}${s.grade.trim()}`);
    const sk = c.skills.map((s) => skillName(s.skillId)).join('、');
    md += `| ${c.id} | ${charName(c.id)} | ${c.hp} | ${c.mp} | ${c.move} | ${st.join(' | ')} | ${WEAPON_TYPES[c.weaponType] ?? c.weaponType} | ${esc(sk) || '—'} |\n`;
  }

  md += '\n## 4. 技能名索引\n\n技能名编号（EXE 技能名表 0–228）→ 使用该技能的职业（学习等级）。末尾 221–228 疑为技能类型标签。\n\n| # | 技能名 | 职业（等级） |\n|---|---|---|\n';
  const users = new Map<number, string[]>();
  for (const c of classes)
    for (const s of c.skills) {
      const arr = users.get(s.skillId) ?? [];
      arr.push(`${charName(c.id)}(${s.learnLevel}${s.hidden ? '*' : ''})`);
      users.set(s.skillId, arr);
    }
  exe.skillNames.forEach((n, i) => {
    md += `| ${i} | ${esc(n)} | ${(users.get(i) ?? []).join('、') || '—'} |\n`;
  });

  md += '\n## 5. 道具表\n\n"移动"为 +104 移动力加成；价格为 +142 买入 / +144 卖出（0 = 不可购买或无价）。攻防加成数值只出现在说明文字里，数据区尚未找到。\n\n| # | 名称 | 类别 | 说明 | 移动 | 买 | 卖 |\n|---|---|---|---|---|---|---|\n';
  for (const it of items) {
    md += `| ${it.id} | ${esc(it.name)} | ${itemTypeName(it.type)} | ${esc(it.description)} | ${it.moveBonus || ''} | ${it.buyPrice || ''} | ${it.sellPrice || ''} |\n`;
  }
  return md;
}

// ───────────────────────── 2. 关卡简报 & 3. 剧本 ─────────────────────────
interface Stage {
  index: number;
  mapName: string;
  title: string;
  file?: string;
  size?: string;
  units: ActUnit[];
  script?: PasScript;
  scriptGb?: PasScript;
}

const stages: Stage[] = exe.stages.map((s) => {
  if (!s.mapName) return { index: s.index, mapName: '', title: s.title, units: [] };
  const base = mapFile(s.mapName, 'map')!.replace(/\.map$/i, '');
  const m = parseMap(read('Map', `${base}.map`), base);
  return {
    index: s.index,
    mapName: s.mapName,
    title: s.title,
    file: base,
    size: `${m.width}×${m.height}`,
    units: parseAct(read('Map', mapFile(s.mapName, 'act')!), base),
    script: parsePas(read('Map', mapFile(s.mapName, 'pab')!), 'big5', base),
    scriptGb: parsePas(read('Map', mapFile(s.mapName, 'pas')!), 'gbk', base),
  };
});

const SIDE_LABEL: Record<Side, string> = { player: '我方', ally: '友军', enemy: '敌方', object: '物件', unknown: '未知' };
const CONDITION_RE = /(回合|條件|勝利|失敗|撤退|---)/;

function unitLabel(u: ActUnit): string {
  if (u.side === 'object') return u.type === 1000 ? '特殊物件(1000)' : `${items[u.type]?.name ?? '#' + u.type}`;
  return `${charName(u.type)} Lv${u.level}`;
}

function genStageBriefs(): string {
  let md = HEADER(
    '关卡简报（stage-briefs）',
    '来源：EXE 关卡表（顺序、章节名）、`Map\\*.map`（尺寸）、`*.act`（单位）、`*.pab`（目标与条件文字、对白）。关卡顺序按 EXE 关卡表；空位是表中的空项。按项目总纲 §2.1，这里的内容属于"必须还原"。',
  );
  md +=
    '**已知局限**：\n\n- 胜负条件取自剧本中的说明文字，**判定逻辑本身**（事件指令）尚未解析；同一条件在剧本里可能出现多次（开场说明与中途提示），这里去重显示。\n- 单位阵营/朝向/等级的字段解释为中等置信度；`AI/条件` 列是 ACT w7 的原值，含义未解。\n- 章节名取自 EXE，与地图编号存在错位（如 `n14` 对应"第15章"），以 EXE 原文为准，待游玩核对。\n- 坐标为地图格坐标 (x, y)。整图预览由 `node tools/render-maps.ts` 生成到 `extracted/maps/`（不入库）：(0,0) 在画面上方顶角，x 向右下、y 向左下；彩点为单位（蓝=我方、绿=友军、红=敌方、黄=物件）。渲染方式尚未与游戏截图核对。\n- 18×18 的室内图（多数 `Act*`）只有中间一块有内容，四周是绿色网格图块，推测为地图外区域。\n\n';

  md += '## 总览\n\n| # | 章节名（EXE） | 地图 | 尺寸 | 我方 | 友军 | 敌方 | 物件 | 对白 | 回合限制 |\n|---|---|---|---|---|---|---|---|---|---|\n';
  for (const s of stages) {
    if (!s.file) {
      md += `| ${s.index} | （空位） | | | | | | | | |\n`;
      continue;
    }
    const cnt = (side: Side) => s.units.filter((u) => u.side === side).length || '';
    const turns = s.script!.otherStrings.map((o) => o.text.match(/回合數\s*-+\s*(\d+)/)?.[1]).find(Boolean) ?? '';
    md += `| ${s.index} | ${s.title || '—'} | [${s.file}](#${s.file.toLowerCase()}) | ${s.size} | ${cnt('player')} | ${cnt('ally')} | ${cnt('enemy')} | ${cnt('object')} | ${s.script!.lines.length} | ${turns} |\n`;
  }

  for (const s of stages) {
    if (!s.file) continue;
    md += `\n---\n\n## ${s.file}\n\n- 关卡序号：${s.index}　章节名：${s.title || '—'}　地图尺寸：${s.size}　整图预览：\`extracted/maps/${s.file}.png\`\n`;
    const conds = [...new Set(s.script!.otherStrings.map((o) => o.text).filter((t) => CONDITION_RE.test(t)))];
    if (conds.length) md += `- 目标与条件：\n${conds.map((c) => `  - ${esc(c)}`).join('\n')}\n`;
    const narr = s.script!.otherStrings.map((o) => o.text).filter((t) => !CONDITION_RE.test(t));
    if (narr.length) md += `- 剧情/结局文字（非对白指令中的字符串，${narr.length} 段，全文见 [script.md](script.md#${s.file.toLowerCase()})）\n`;
    const speakers = new Map<string, number>();
    for (const l of s.script!.lines) speakers.set(speakerName(l.speaker), (speakers.get(speakerName(l.speaker)) ?? 0) + 1);
    if (speakers.size)
      md += `- 对白 ${s.script!.lines.length} 句，说话者：${[...speakers].map(([n, c]) => `${n}×${c}`).join('、')}\n`;

    for (const side of ['player', 'ally', 'enemy', 'object', 'unknown'] as Side[]) {
      const us = s.units.filter((u) => u.side === side);
      if (!us.length) continue;
      md += `\n**${SIDE_LABEL[side]}（${us.length}）**\n\n`;
      if (side === 'object') {
        md += us.map((u) => `${unitLabel(u)} (${u.x},${u.y})`).join('、') + '\n';
        continue;
      }
      md += '| 单位 | 坐标 | 朝向 | 装备/物品 | AI/条件(w7) | w1 | w8–10 |\n|---|---|---|---|---|---|---|\n';
      for (const u of us) {
        const wt = classes[u.type]?.weaponType ?? null;
        const eq = u.items.map((id, k) => slotItem(id, k, wt)).filter((x) => x !== '—');
        md += `| ${unitLabel(u)} | (${u.x},${u.y}) | ${u.facing} | ${eq.join('、') || '—'} | ${u.flags || ''} | ${u.group || ''} | ${u.extra.some(Boolean) ? u.extra.join(',') : ''} |\n`;
      }
    }
  }
  return md;
}

function genScript(variant: 'big5' | 'gbk'): string {
  const hans = variant === 'gbk';
  let md = HEADER(
    hans ? '剧本文本全集·简体（script-zh-hans）' : '剧本文本全集（script）',
    hans
      ? '来源：`Map\\*.pas`（原版附带的 GB2312 简体副本，程序运行时不读取）。说话者名称取自 EXE（繁体）。繁体原文见 [script.md](script.md)。'
      : '来源：`Map\\*.pab`（程序实际读取的 Big5 繁体版）。简体副本见 [script-zh-hans.md](script-zh-hans.md)。',
  );
  md +=
    '`%X`、`%N` 为主角名占位符。"〔文字〕"是剧本中不属于对白指令的字符串（目标、提示、结局旁白等），按其在文件中的位置与对白交错排列；它们何时显示由尚未解析的事件指令决定。说话者"特殊#1001"等编号 ≥1000 的含义未解（推测指向关卡内的某个单位）。\n';
  for (const s of stages) {
    if (!s.file) continue;
    const sc = hans ? s.scriptGb! : s.script!;
    const entries = [
      ...sc.lines.map((l) => ({ off: l.offset, txt: `**${speakerName(l.speaker)}**：${l.text}` })),
      ...sc.otherStrings.map((o) => ({ off: o.offset, txt: `〔${o.text}〕` })),
    ].sort((a, b) => a.off - b.off);
    md += `\n## ${s.file}\n\n> 关卡 ${s.index} · ${s.title || '—'}\n\n`;
    md += entries.map((e) => `- ${e.txt}`).join('\n') + '\n';
  }
  return md;
}

// ───────────────────────── 输出 ─────────────────────────
fs.writeFileSync(path.join(DOCS, 'data-tables.md'), genDataTables());
fs.writeFileSync(path.join(DOCS, 'stage-briefs.md'), genStageBriefs());
fs.writeFileSync(path.join(DOCS, 'script.md'), genScript('big5'));
fs.writeFileSync(path.join(DOCS, 'script-zh-hans.md'), genScript('gbk'));

const json = (name: string, v: unknown) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(v, null, 1));
json('characters.json', { names: exe.characterNames, nicknames: exe.nicknames });
json('skills.json', exe.skillNames);
json('items.json', items satisfies Item[]);
json('classes.json', classes);
json(
  'stages.json',
  stages.map((s) => ({ index: s.index, mapName: s.mapName, file: s.file, title: s.title, size: s.size, units: s.units, script: s.script })),
);

const lines = stages.reduce((n, s) => n + (s.script?.lines.length ?? 0), 0);
console.log(`stages=${stages.filter((s) => s.file).length}/${stages.length} classes=${classes.length} items=${items.length} dialogue=${lines}`);
console.log(`docs → ${path.relative(ROOT, DOCS)}/  json → ${path.relative(ROOT, OUT)}/`);
