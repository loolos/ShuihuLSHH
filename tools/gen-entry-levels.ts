// 完整主线（含插关、续篇）的入场推荐等级；包职业用稳定字符串key，不保存运行时编号。
import fs from 'node:fs';
import path from 'node:path';
import {ROUTES}from'../src/rules/campaign.ts';
import {readExeTables}from'../src/formats/exe.ts';
import {exeTables}from'../src/rules/load.ts';
import {estimateCampaign}from'./estimate-campaign.ts';
import {DATA,NodeFiles}from'./sim-lib.ts';
const rows=estimateCampaign(),levels:Record<string,Record<string,number>>={};
for(const r of rows){const own:Record<string,number>={};for(const[id,level]of r.entry)own[r.map.includes('/')?(r.keys.get(id)??String(id)):String(id)]=level;levels[r.map.toLowerCase()]=own;}
const files=new NodeFiles(DATA),stages=exeTables(files).stages;
for(const{alt}of Object.values(ROUTES)){const a=stages.find(s=>s.index===alt),main=stages.find(s=>s.index===alt-1);if(a&&main&&levels[main.mapName.toLowerCase()])levels[a.mapName.toLowerCase()]={...levels[main.mapName.toLowerCase()]};}
const out=path.resolve(import.meta.dirname,'../src/data/entry-levels.json');
const body=Object.entries(levels).map(([k,v])=>`    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
fs.writeFileSync(out,`{\n  "note": "完整主线期望经验估算：包含主线插关、续篇与Act5-2战斗；不刷训练，按全敌击倒上限及出场人物均摊；包职业使用稳定key；选关不再被旧敌人绝对等级压低",\n  "levels": {\n${body}\n  }\n}\n`);
console.log(`写入${out}，共${Object.keys(levels).length}段（含两条小径预设）。`);
