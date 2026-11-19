// 保留原估算命令/导出，模型现在覆盖完整主线、插关及续篇。
// SCALE=总经验倍率，ATT=每敌平均出手系数；不刷训练，默认按全敌击倒上限估算。
import {estimateCampaign,type CampaignEstimateRow}from'./estimate-campaign.ts';
export type EstRow=CampaignEstimateRow;
export const estimate=estimateCampaign;
if(import.meta.main){
 const rows=estimate(Number(process.argv[2]??200));
 console.log('关卡                          敌数 敌均   我方进→出 人数 人均经验');
 for(const r of rows)if(r.n&&r.foes)console.log(`${r.map.padEnd(29)} ${String(r.foes).padStart(3)} ${r.foeAvg.toFixed(1).padStart(4)} ${r.enter.toFixed(1).padStart(5)}→${r.exit.toFixed(1).padEnd(5)} ${String(r.n).padStart(3)} ${(r.total/r.n).toFixed(0)}`);
}
