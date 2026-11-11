// 战斗界面的 HTML 部分：顶栏、战报、单位面板、指令菜单、对白框、结算画面。
import type { AttackPreview } from '../rules/combat.ts';
import type { Unit } from '../rules/unit.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface Command {
  label: string;
  enabled?: boolean;
  on?: boolean;
  run: () => void;
}

const SIDE_NAME = { player: '我方', ally: '友军', enemy: '敌方' } as const;

export class BattleUI {
  private log = $('log');
  private panel = $('unit-panel');
  private cmd = $('cmd');
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
    this.dialog.onclick = () => this.advance();
    window.addEventListener('keydown', (e) => {
      if (!this.dialog.hidden && (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape')) {
        e.preventDefault();
        this.advance();
      }
    });
  }

  show() {
    $('bottom').hidden = false;
  }

  setTurn(turn: number, limit: number, phase: string) {
    $('turn').textContent = `第 ${turn}${limit ? ` / ${limit}` : ''} 回合 · ${phase}`;
  }

  setEndTurnEnabled(on: boolean) {
    $<HTMLButtonElement>('end-turn').disabled = !on;
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

  showUnit(u: Unit | null, preview?: AttackPreview | null, hint = '') {
    if (!u) {
      this.panel.hidden = true;
      return;
    }
    const s = u.stats;
    const pct = (a: number, b: number) => `${Math.round((100 * a) / Math.max(1, b))}%`;
    const states = [u.defending && '防御中', u.poisonTurns > 0 && `中毒 ${u.poisonTurns}`, u.stunTurns > 0 && `昏迷 ${u.stunTurns}`, u.ended && u.side === 'player' && '已行动']
      .filter(Boolean)
      .join('　');
    const face = this.portrait(u.classId);
    this.panel.innerHTML = `
      ${face ? `<img class="face" alt="" src="${face}">` : ''}
      <div class="info">
      <div class="name side-${u.side}">${esc(u.name)}　<small>${SIDE_NAME[u.side]} Lv${u.level}${u.side === 'player' ? `　经验 ${u.exp}` : ''}</small></div>
      <div class="bars">
        <div>体力 <span class="bar2"><i style="width:${pct(u.hp, s.maxHp)}"></i></span> ${u.hp}/${s.maxHp}</div>
        <div>气力 <span class="bar2 mp"><i style="width:${pct(u.mp, s.maxMp)}"></i></span> ${u.mp}/${s.maxMp}</div>
      </div>
      <div class="grid"><span>攻 ${s.attack}</span><span>防 ${s.defense}</span><span>移 ${s.move}</span><span>命 ${s.hit}</span><span>敏 ${s.agility}</span><span>必 ${s.crit}</span></div>
      ${states ? `<div>${states}</div>` : ''}
      ${preview ? `<div class="preview">命中 ${preview.hit}%　伤害 ${preview.damage}　必杀 ${preview.crit}%（${preview.critDamage}）</div>` : ''}
      ${hint ? `<div class="preview">${esc(hint)}</div>` : ''}
      </div>`;
    this.panel.classList.toggle('has-face', !!face);
    this.panel.hidden = false;
  }

  setCommands(list: Command[] | null) {
    if (!list) {
      this.cmd.hidden = true;
      return;
    }
    this.cmd.replaceChildren(
      ...list.map((c) => {
        const b = document.createElement('button');
        b.textContent = c.label;
        b.disabled = c.enabled === false;
        if (c.on) b.classList.add('on');
        b.onclick = (e) => {
          e.stopPropagation();
          c.run();
        };
        return b;
      }),
    );
    this.cmd.hidden = false;
  }

  /** 对白框：点击或按回车继续 */
  say(speaker: string, text: string, classId: number | null = null): Promise<void> {
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

  result(won: boolean, text: string, restart: () => void) {
    $('result-title').textContent = won ? '胜利' : '失败';
    $('result-text').textContent = this.tr(text) || (won ? '达成了胜利条件。' : '');
    $('result').hidden = false;
    $('result-restart').onclick = () => {
      $('result').hidden = true;
      restart();
    };
  }
  hideResult() {
    $('result').hidden = true;
  }
}
