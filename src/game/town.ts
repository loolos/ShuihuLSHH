// 城镇与整备界面（HTML）：顶部是店铺分页，左边是本店的货或传闻，右边是队员和他们的 7 格道具。
// 规则在 src/rules/town.ts；这里只负责显示和把点击交给规则函数。
import type { Item } from '../formats/goo.ts';
import type { CampaignState, Member } from '../rules/campaign.ts';
import { canEquip, equipSlotOf, EQUIP_SLOTS, forgedStats, forgeLimit, itemOf, SLOT_COUNT } from '../rules/data.ts';
import { buy, canForge, discard, equip, forge, forgeCost, give, partyMembers, pawn, SHOPS, stock, type Outcome, type ShopAction } from '../rules/town.ts';
import { computeStats } from '../rules/unit.ts';
import { frameToCanvas, ICON_KEY, type Assets } from './assets.ts';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const ACTION_LABEL: Record<ShopAction | 'items', string> = { talk: '交談', buy: '買', items: '物品', forge: '打鐵', pawn: '典當' };
const SLOT_LABEL = ['武器', '衣服', '头饰'];
/** 整备分页的序号（店是 0–4） */
const PREP = -1;

export interface TownOptions {
  /** 城镇号 1–13；0 = 没有城镇，只整备 */
  town: number;
  title: string;
  /** 每次买卖、整理后调用（用来存档） */
  onChange: (c: CampaignState) => void;
  onLeave: (c: CampaignState) => void;
}

export class TownUI {
  private root = $('town');
  private c!: CampaignState;
  private o!: TownOptions;
  private shop = PREP;
  private action: ShopAction | 'items' = 'items';
  private member = 0;
  private slot = -1;
  private giving = false;
  private line = '';
  private rumor = new Map<number, number>();
  private icons = new Map<number, string>();

  constructor(
    private assets: Assets,
    private portrait: (classId: number) => string | null,
  ) {
    this.root.addEventListener('click', (e) => {
      const el = (e.target as Element).closest<HTMLElement>('[data-do]');
      if (el) this.on(el.dataset.do!, Number(el.dataset.v ?? 0));
    });
  }

  get open() {
    return !this.root.hidden;
  }

  show(c: CampaignState, o: TownOptions) {
    this.c = c;
    this.o = o;
    this.member = partyMembers(c)[0]?.classId ?? 0;
    this.slot = -1;
    this.giving = false;
    if (o.town) this.enter(0);
    else this.enter(PREP);
    this.root.hidden = false;
  }

  hide() {
    this.root.hidden = true;
  }

  private tr = (s: string) => this.assets.tr(s);
  private get data() {
    return this.assets.data;
  }

  private enter(shop: number) {
    this.shop = shop;
    this.slot = -1;
    this.giving = false;
    if (shop === PREP) {
      this.action = 'items';
      this.line = this.o.town ? '' : '整理队员的装备和道具。';
    } else {
      this.action = SHOPS[shop].actions[0];
      this.line = this.assets.exe.town.greet[shop];
      if (this.action === 'talk') this.talk();
    }
    this.render();
  }

  /** 酒店交谈：依次说出本城的传闻，说完从头再来（EXE 0x4194d1） */
  private talk() {
    const list = this.assets.exe.town.rumors[this.o.town] ?? [];
    if (!list.length) {
      this.line = '最近没听说什么新鲜事。'; // 原版这些城镇点"交談"没有反应【新】
      return;
    }
    const k = this.rumor.get(this.o.town) ?? 0;
    this.line = list[k % list.length];
    this.rumor.set(this.o.town, k + 1);
  }

  private apply(r: Outcome) {
    if (r.text) this.line = r.text;
    if (!r.ok) return;
    this.c = r.c;
    this.slot = -1;
    this.giving = false;
    this.o.onChange(this.c);
  }

  private on(what: string, v: number) {
    const d = this.data, town = this.o.town;
    switch (what) {
      case 'shop':
        return this.enter(v);
      case 'action':
        this.action = SHOPS[this.shop]?.actions.find((a) => a === (['talk', 'buy', 'items', 'forge', 'pawn'] as const)[v]) ?? 'items';
        this.slot = -1;
        this.giving = false;
        if (this.action === 'talk') this.talk();
        break;
      case 'member':
        this.member = v;
        this.slot = -1;
        this.giving = false;
        break;
      case 'slot':
        this.slot = this.slot === v ? -1 : v;
        this.giving = false;
        if (this.action === 'pawn' && this.slot >= 0) return this.apply(pawn(this.c, d, this.member, v)), this.render();
        if (this.action === 'forge' && this.slot >= 0) return this.apply(forge(this.c, d, this.member, v, town)), this.render();
        break;
      case 'buy':
        this.apply(buy(this.c, d, this.member, v));
        break;
      case 'equip':
        this.apply(equip(this.c, d, this.member, this.slot));
        break;
      case 'discard':
        this.apply(discard(this.c, d, this.member, this.slot));
        break;
      case 'give':
        this.giving = !this.giving;
        break;
      case 'give-to':
        this.apply(give(this.c, d, this.member, this.slot, v));
        break;
      case 'leave':
        this.hide();
        return this.o.onLeave(this.c);
    }
    this.render();
  }

  private icon(it: Item): string {
    if (!this.icons.has(it.icon)) {
      let url = '';
      try {
        url = frameToCanvas(this.assets.objects.frame(it.icon), this.assets.palette, ICON_KEY).toDataURL();
      } catch {
        /* 没有图标就只显示名字 */
      }
      this.icons.set(it.icon, url);
    }
    const url = this.icons.get(it.icon);
    return url ? `<img class="ico" alt="" src="${url}">` : '';
  }

  /** 道具的简短说明：装备列攻防等加成（含打铁），消耗品列效果 */
  private summary(it: Item, n = 0): string {
    const p: string[] = [];
    const f = forgedStats(it, n);
    if (equipSlotOf(it) >= 0) {
      if (f.attack) p.push(`攻${f.attack}`);
      if (f.defense) p.push(`防${f.defense}`);
      for (const [k, l] of [['hit', '命'], ['agility', '敏'], ['crit', '必'], ['moveBonus', '移'], ['range', '射程'], ['maxHp', '体'], ['maxMp', '气']] as const)
        if (it[k]) p.push(`${l}${it[k] > 0 ? '+' : ''}${it[k]}`);
      if (it.regenHp) p.push(`每回合回体${it.regenHp}`);
      if (it.regenMp) p.push(`每回合回气${it.regenMp}`);
    } else {
      if (it.healHp) p.push(it.healHp < 0 ? '体力全满' : `回体${it.healHp}`);
      if (it.healMp) p.push(it.healMp < 0 ? '气力全满' : `回气${it.healMp}`);
      if (it.curePoison || it.type === 18) p.push('解毒');
      if (it.cureStun || it.type === 19) p.push('解昏迷');
    }
    return p.join(' ');
  }

  private itemName(it: Item, n: number) {
    return `${esc(this.tr(it.name))}${n ? `<b class="plus">+${n}</b>` : ''}`;
  }

  private render() {
    const town = this.o.town, exe = this.assets.exe.town;
    const shops = town
      ? SHOPS.map((_, i) => `<button data-do="shop" data-v="${i}" class="${this.shop === i ? 'on' : ''}">${esc(this.tr(exe.shops[i]))}</button>`).join('') +
        `<button data-do="shop" data-v="${PREP}" class="${this.shop === PREP ? 'on' : ''}">整备</button>`
      : '';
    const actions =
      this.shop === PREP
        ? ''
        : SHOPS[this.shop].actions
            .map((a) => `<button data-do="action" data-v="${['talk', 'buy', 'items', 'forge', 'pawn'].indexOf(a)}" class="${this.action === a ? 'on' : ''}">${this.tr(ACTION_LABEL[a])}</button>`)
            .join('');
    this.root.innerHTML = `
      <div class="town-head">
        <h2>${esc(this.tr(this.o.title))}</h2>
        <span class="gold">黄金 <b>${this.c.gold}</b> 两</span>
        <button class="leave" data-do="leave">${town ? '离开城镇 ▸' : '完成 ▸'}</button>
      </div>
      ${shops ? `<nav class="town-shops">${shops}</nav>` : ''}
      <div class="town-body">
        <section class="town-shop">
          ${actions ? `<div class="town-actions">${actions}</div>` : ''}
          ${this.line ? `<p class="town-line">${esc(this.tr(this.line))}</p>` : ''}
          ${this.shopPane()}
        </section>
        <section class="town-party">${this.partyPane()}</section>
      </div>`;
  }

  private shopPane(): string {
    const d = this.data;
    if (this.action === 'buy') {
      const list = stock(d, this.shop, this.o.town);
      if (!list.length) return '<p class="hint">这里没有东西卖。</p>';
      const who = partyMembers(this.c)
        .map((m) => `<button data-do="member" data-v="${m.classId}" class="${m.classId === this.member ? 'on' : ''}">${esc(this.tr(d.charNames[m.classId] ?? ''))}</button>`)
        .join('');
      return `<div class="town-actions"><small class="hint">买给</small>${who}</div><ul class="goods">${list
        .map((id) => {
          const it = itemOf(d, id)!;
          const ok = this.c.gold >= it.buyPrice;
          const fit = equipSlotOf(it) !== 0 || canEquip(d.classes[this.member], it, d);
          return `<li><button data-do="buy" data-v="${id}" ${ok ? '' : 'disabled'}>
            ${this.icon(it)}<span class="nm">${esc(this.tr(it.name))}${fit ? '' : '<small class="warn">不合用</small>'}</span>
            <span class="eff">${esc(this.summary(it))}</span><span class="price">${it.buyPrice} 两</span></button></li>`;
        })
        .join('')}</ul>`;
    }
    if (this.action === 'pawn') return '<p class="hint">点选右边队员的道具典当，按道具的卖价收钱。</p>';
    if (this.action === 'forge') return '<p class="hint">点选右边队员的装备打铁：每次收买价的一半，攻击、防御还有剩余次数的一起提升。标「可打铁」的才能在这里打铁。</p>';
    if (this.action === 'talk') return '';
    return '<p class="hint">点选道具：装备、卸下、交给别人或丢弃。前三格是装备栏，只有装在这里的才有加成。</p>';
  }

  private partyPane(): string {
    const list = partyMembers(this.c);
    return list.map((m) => this.memberCard(m, m.classId === this.member)).join('') || '<p class="hint">还没有队员。</p>';
  }

  private memberCard(m: Member, open: boolean): string {
    const d = this.data, cls = d.classes[m.classId];
    const forge = m.forge ?? [];
    const st = computeStats(cls, m.level, m.slots, d, false, forge);
    const face = this.portrait(m.classId);
    const head = `<button class="who" data-do="member" data-v="${m.classId}">
      ${face ? `<img class="face" alt="" src="${face}">` : ''}
      <span><b>${esc(this.tr(d.charNames[m.classId] ?? ''))}</b> Lv${m.level}<br>
      <small>体${st.maxHp} 气${st.maxMp} 攻${st.attack} 防${st.defense} 命${st.hit} 敏${st.agility} 必${st.crit} 移${st.move}</small></span></button>`;
    if (!open) return `<div class="member">${head}</div>`;
    const slots = Array.from({ length: SLOT_COUNT }, (_, k) => {
      const it = itemOf(d, m.slots[k] ?? 0);
      const n = forge[k] ?? 0;
      const label = k < EQUIP_SLOTS ? SLOT_LABEL[k] : '物品';
      let tag = '';
      if (it && this.action === 'pawn') tag = `<span class="price">${it.sellPrice} 两</span>`;
      if (it && this.action === 'forge')
        tag = canForge(it, n, this.o.town) ? `<span class="price">可打铁 ${forgeCost(it)} 两</span>` : n && n >= forgeLimit(it) ? '<small>已打到头</small>' : '';
      return `<li class="${this.slot === k ? 'sel' : ''}"><button data-do="slot" data-v="${k}" ${it ? '' : 'disabled'}>
        <small class="lab">${label}</small>${it ? `${this.icon(it)}<span class="nm">${this.itemName(it, n)}</span><span class="eff">${esc(this.summary(it, n))}</span>${tag}` : '<span class="nm empty">—</span>'}
        </button></li>`;
    }).join('');
    let ops = '';
    const it = itemOf(d, m.slots[this.slot] ?? 0);
    if (it && this.action === 'items') {
      const others = partyMembers(this.c).filter((x) => x.classId !== m.classId);
      const eq = this.slot < EQUIP_SLOTS ? '卸下' : equipSlotOf(it) >= 0 ? '装备' : '';
      ops = `<div class="ops">
        ${eq ? `<button data-do="equip" ${eq === '装备' && !canEquip(cls, it, d) ? 'disabled' : ''}>${eq}</button>` : ''}
        ${others.length ? `<button data-do="give" class="${this.giving ? 'on' : ''}">给予</button>` : ''}
        <button data-do="discard">丢弃</button></div>
        ${this.giving ? `<div class="ops">${others.map((x) => `<button data-do="give-to" data-v="${x.classId}">交给 ${esc(this.tr(d.charNames[x.classId]))}</button>`).join('')}</div>` : ''}`;
    }
    return `<div class="member open">${head}<ul class="slots">${slots}</ul>${ops}</div>`;
  }
}
