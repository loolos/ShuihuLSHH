// 战斗界面的 HTML 部分：顶栏、战报、单位面板、指令菜单、对白框、结算画面。
import { expToNext } from '../rules/exp.ts';
import type { AttackPreview } from '../rules/combat.ts';
import type { Unit } from '../rules/unit.ts';
import { buffName } from '../rules/data.ts';
import { sound } from './sound.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface Command {
  label: string;
  enabled?: boolean;
  on?: boolean;
  /** 按钮下面的小字（道具效果等） */
  note?: string;
  run: () => void;
}

const SIDE_NAME = { player: '我方', ally: '友军', enemy: '敌方' } as const;

export class BattleUI {
  private log = $('log');
  private panel = $('unit-panel');
  private cmd = $('cmd');
  /** 跟着人物的指令菜单（攻击、技能、防御、道具……） */
  private cmdFloat = $('cmd-float');
  private dialog = $('dialog');
  private dialogNext: (() => void) | null = null;
  private face = document.createElement('img');
  /** 职业 → 头像图片地址；没有头像时返回 null */
  portrait: (classId: number) => string | null = () => null;
  /** 文字转换（繁→简） */
  tr: (s: string) => string = (s) => s;

  constructor() {
    this.face.id = 'dialog-face';
    this.face.alt = '';
    this.dialog.prepend(this.face);
    // 对白期间：页面任何位置点击都继续（捕获阶段拦下，不让点击落到地图或按钮上）；
    // 回车 / 空格继续；Esc 跳过这一段剩下的全部对白。
    // 手机上 Phaser 会对触摸调用 preventDefault，浏览器就不再补发 click，所以用 pointerup 推进；
    // 推进后短时间内的鼠标/触摸/click 事件一并拦下，免得同一下点击又落到地图上。
    let swallowUntil = 0;
    // 检查更新的按钮和提示条不受对白影响
    const exempt = (e: Event) => !!(e.target as Element | null)?.closest?.('#update, #toast, #sound, #music, #minimap');
    const guard = (e: Event) => {
      if ((this.dialog.hidden && performance.now() > swallowUntil) || exempt(e)) return;
      e.stopPropagation();
      if (e.type === 'click') e.preventDefault();
    };
    for (const t of ['pointerdown', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click']) window.addEventListener(t, guard, true);
    window.addEventListener(
      'pointerup',
      (e) => {
        if (this.dialog.hidden || exempt(e)) return guard(e);
        e.stopPropagation();
        swallowUntil = performance.now() + 400;
        if ((e.target as Element | null)?.closest?.('#dialog-skip')) this.skip();
        else this.advance();
      },
      true,
    );
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.dialog.hidden && this.playing) {
        this.skip(); // 对白之间的镜头移动时按 Esc 也算
        return;
      }
      if (this.dialog.hidden) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.advance();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.skip();
      }
    });
  }

  /** Esc 或"跳过"按钮之后，直到这段事件播完都不再显示对白 */
  skipping = false;
  /** 开始跳过时通知场景（场景借此加速并停止镜头移动） */
  onSkip: () => void = () => {};
  skip() {
    this.skipping = true;
    this.onSkip();
    if (!this.dialog.hidden) this.advance();
  }
  /** 正在播放一段事件（由场景设置） */
  playing = false;
  endSkip() {
    this.skipping = false;
  }

  show() {
    $('bottom').hidden = false;
  }

  setTurn(turn: number, limit: number, phase: string) {
    $('turn').textContent = `第 ${turn}${limit ? ` / ${limit}` : ''} 回合 · ${phase}`;
  }

  /** 全队经验池（击倒经验的 35%，胜利后结算）【新】（负责人 2026-11-13） */
  setTeamExp(n: number) {
    $('team-exp').textContent = `全队经验 ${n}`;
  }

  setEndTurnEnabled(on: boolean) {
    $<HTMLButtonElement>('end-turn').disabled = !on;
  }

  /** 时光倒流按钮：turn = 会回到第几回合开始，null = 没有可用的记录（置灰）【新】 */
  setRewind(turn: number | null) {
    const b = $<HTMLButtonElement>('rewind');
    b.disabled = turn === null;
    b.title = turn === null ? '时光倒流：暂时没有可以回到的回合' : `时光倒流：回到第 ${turn} 回合开始时的状态`;
  }

  message(text: string) {
    const d = document.createElement('div');
    d.textContent = this.tr(text);
    this.log.append(d);
    while (this.log.childElementCount > 5) this.log.firstElementChild!.remove();
  }
  clearLog() {
    this.log.replaceChildren();
  }

  showUnit(u: Unit | null, preview?: AttackPreview | null, hint = '', item?: { title: string; lines: string[]; warn?: string }) {
    if (!u) {
      this.panel.hidden = true;
      return;
    }
    const s = u.stats;
    const pct = (a: number, b: number) => `${Math.round((100 * a) / Math.max(1, b))}%`;
    const buffs = u.buffs.map((b) => `${buffName(b.stat)}${b.value ? `+${b.value}` : ''} ${b.turns}`);
    const states = [u.defending && '防御中', ...buffs, u.poisonTurns > 0 && `中毒 ${u.poisonTurns}`, u.stunTurns > 0 && `昏迷 ${u.stunTurns}`, u.ended && u.side === 'player' && '已行动']
      .filter(Boolean)
      .join('　');
    const face = this.portrait(u.classId);
    this.panel.innerHTML = `
      ${face ? `<img class="face" alt="" src="${face}">` : ''}
      <div class="info">
      <div class="name side-${u.side}">${esc(u.name)}　<small>${SIDE_NAME[u.side]} Lv${u.level}</small></div>
      <div class="bars">
        <div>体力 <span class="bar2"><i style="width:${pct(u.hp, s.maxHp)}"></i></span> ${u.hp}/${s.maxHp}</div>
        <div>气力 <span class="bar2 mp"><i style="width:${pct(u.mp, s.maxMp)}"></i></span> ${u.mp}/${s.maxMp}</div>
        ${u.side === 'player' ? `<div>经验 <span class="bar2 exp"><i style="width:${pct(u.exp, expToNext(u.level))}"></i></span> ${u.exp}/${expToNext(u.level)}</div>` : ''}
      </div>
      <div class="grid"><span>攻 ${s.attack}</span><span>防 ${s.defense}</span><span>移 ${s.move}</span><span>命 ${s.hit}</span><span>敏 ${s.agility}</span><span>必 ${s.crit}</span></div>
      ${states ? `<div>${states}</div>` : ''}
      ${preview ? `<div class="preview">命中 ${preview.hit}%　伤害 ${preview.damage}${preview.parts > 1 ? `（${preview.parts} 段）` : ''}　必杀 ${preview.crit}%（${preview.critDamage}）</div>` : ''}
      ${hint ? `<div class="preview">${esc(hint)}</div>` : ''}
      ${
        item
          ? `<div class="item-detail"><b>${esc(this.tr(item.title))}</b>${item.lines.filter(Boolean).map((l) => `<div>${esc(this.tr(l))}</div>`).join('')}${
              item.warn ? `<div class="warn">${esc(this.tr(item.warn))}</div>` : ''
            }</div>`
          : ''
      }
      </div>`;
    this.panel.classList.toggle('has-face', !!face);
    this.panel.hidden = false;
  }

  /** 显示指令菜单。`float` 为真时菜单跟着人物（位置由 placeCommands 每帧更新），否则放在右下角 */
  setCommands(list: Command[] | null, float = false) {
    const [box, other] = float ? [this.cmdFloat, this.cmd] : [this.cmd, this.cmdFloat];
    // 原版打开 / 关闭窗口时播 m01 / m02（EXE 0x416fb0 / 0x417010）
    const was = !this.cmd.hidden || !this.cmdFloat.hidden;
    other.hidden = true;
    if (!list) {
      box.hidden = true;
      if (was) void sound.sfx('m02');
      return;
    }
    if (!was) void sound.sfx('m01');
    box.replaceChildren(
      ...list.map((c) => {
        const b = document.createElement('button');
        b.textContent = this.tr(c.label);
        if (c.note) {
          const n = document.createElement('small');
          n.textContent = this.tr(c.note);
          b.append(n);
        }
        b.disabled = c.enabled === false;
        if (c.on) b.classList.add('on');
        b.onclick = (e) => {
          e.stopPropagation();
          c.run();
        };
        return b;
      }),
    );
    box.hidden = false;
  }

  get floatingCommands() {
    return !this.cmdFloat.hidden;
  }

  /**
   * 把跟随菜单放在人物旁边：x 是人物中心的屏幕横坐标，y 是身体中部，reach 是人物到相邻格的横向距离。
   * 默认放右边，放不下就放左边；上下限制在顶栏和底部面板之间。
   */
  placeCommands(x: number, y: number, reach: number) {
    const el = this.cmdFloat;
    if (el.hidden) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const top0 = ($('hud').getBoundingClientRect().bottom || 0) + 4;
    // 道具栏可能很长：最多占满顶栏以下的高度，再长就在菜单里滚动
    const maxH = `${Math.max(80, Math.floor(vh - 4 - top0))}px`;
    if (el.style.maxHeight !== maxH) el.style.maxHeight = maxH;
    const w = el.offsetWidth, h = el.offsetHeight;
    const gap = reach + 8;
    let left = x + gap;
    if (left + w > vw - 4) left = x - gap - w;
    left = Math.max(4, Math.min(left, vw - w - 4));
    const bottomEl = $('bottom').getBoundingClientRect();
    // 底部面板占得不多时避开它，屏幕太矮就允许盖住
    const bottom1 = bottomEl.height && bottomEl.top - top0 > h + 8 ? bottomEl.top - 4 : vh - 4;
    const top = Math.max(top0, Math.min(y - h / 2, bottom1 - h));
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  /** 对白框：点击或按回车继续 */
  say(speaker: string, text: string, classId: number | null = null): Promise<void> {
    if (this.skipping) return Promise.resolve();
    const face = classId === null ? null : this.portrait(classId);
    this.face.hidden = !face;
    if (face) this.face.src = face;
    this.dialog.classList.toggle('has-face', !!face);
    $('dialog-who').textContent = this.tr(speaker);
    $('dialog-text').textContent = this.tr(text);
    this.dialog.hidden = false;
    return new Promise((r) => (this.dialogNext = r));
  }
  private advance() {
    const next = this.dialogNext;
    if (!next) return;
    this.dialogNext = null;
    this.dialog.hidden = true;
    next();
  }
  get inDialog() {
    return !this.dialog.hidden;
  }

  /** 胜负面板：每个选项一个按钮，可附一行说明（如路线的胜利条件） */
  result(won: boolean, text: string, choices: { label: string; note?: string; run: () => void }[], title?: string, compact = false) {
    $('result').classList.toggle('compact', compact); // compact：不遮地图，面板放在下方
    $('result-title').textContent = title ?? (won ? '胜利' : '失败');
    $('result-text').textContent = this.tr(text) || (won ? '达成了胜利条件。' : '');
    const box = $('result-actions');
    box.replaceChildren();
    for (const c of choices) {
      const b = document.createElement('button');
      b.textContent = c.label;
      if (c.note) {
        const n = document.createElement('small');
        n.textContent = this.tr(c.note);
        b.append(n);
      }
      b.onclick = () => {
        $('result').hidden = true;
        c.run();
      };
      box.append(b);
    }
    $('result').hidden = false;
  }
  hideResult() {
    $('result').hidden = true;
  }

  /**
   * 选人面板（训练关、断后）：点人物卡选中（要选 count 人；只选 1 人时点别人就换人），"确定"后返回选中的人。
   * required 是不用选也一定出战的人，显示成灰框。
   */
  pick(title: string, units: Unit[], required: Unit[], count: number, preset: number[]): Promise<number[]> {
    const chosen = new Set(preset.slice(0, count));
    const list = $('unit-pick-list');
    const ok = $<HTMLButtonElement>('unit-pick-ok');
    const need = Math.min(count, units.length);
    $('unit-pick-title').textContent = this.tr(title);
    const card = (u: Unit, fixed: boolean) => {
      const b = document.createElement('button');
      b.type = 'button';
      const face = this.portrait(u.classId);
      const s = u.stats;
      b.innerHTML = `${face ? `<img alt="" src="${face}">` : ''}<span>${fixed ? '<span class="tag">必定出战</span>' : ''}<b>${esc(this.tr(u.name))}</b> Lv${u.level}
        <small><i>体 ${u.hp}/${s.maxHp}</i> <i>气 ${u.mp}/${s.maxMp}</i></small><small><i>攻 ${s.attack}</i> <i>防 ${s.defense}</i> <i>移 ${s.move}</i></small></span>`;
      b.disabled = fixed;
      b.dataset.uid = String(u.uid);
      return b;
    };
    const refresh = () => {
      for (const b of list.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')) b.classList.toggle('on', chosen.has(Number(b.dataset.uid)));
      ok.disabled = chosen.size !== need;
      $('unit-pick-hint').textContent = `已选 ${chosen.size} / ${need} 人${required.length ? `（另有${required.map((u) => this.tr(u.name)).join('、')}一定出战）` : ''}　没选上的人这一关留在后方，下一关归队`;
    };
    list.replaceChildren(...required.map((u) => card(u, true)), ...units.map((u) => card(u, false)));
    for (const b of list.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')) {
      b.onclick = (e) => {
        e.stopPropagation();
        const id = Number(b.dataset.uid);
        if (chosen.has(id)) chosen.delete(id);
        else {
          if (need === 1) chosen.clear();
          if (chosen.size < need) chosen.add(id);
        }
        void sound.sfx('m01');
        refresh();
      };
    }
    refresh();
    $('unit-pick').hidden = false;
    return new Promise((r) => {
      ok.onclick = (e) => {
        e.stopPropagation();
        if (chosen.size !== need) return;
        $('unit-pick').hidden = true;
        r([...chosen]);
      };
    });
  }
}
