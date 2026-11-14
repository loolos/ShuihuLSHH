// 标题画面【新】（负责人 2026-11-14）：开始游戏 / 读取存档 / 选关。
// 原版的标题图在 Title/ 目录，不在仓库里，这里用文字和原版半身头像排一个简单的封面。
// 纯 DOM，盖在 Phaser 画布上面；选好之后由 main.ts 进关。

export interface TitleStageItem {
  label: string;
  /** 交给 main.ts 跳关的值：关卡序号，或 town:<关卡序号> */
  value: string;
  title?: string;
}

export interface TitleOptions {
  /** 存档摘要；没有存档时为 null，「读取存档」置灰 */
  save: { where: string; detail: string } | null;
  chapters: { label: string; items: TitleStageItem[] }[];
  /** 封面上排的几张半身头像（data URL） */
  portraits: string[];
  version: string;
  /** 音效 / 音乐按钮：标题画面借用顶栏的这两个按钮 */
  buttons: HTMLElement[];
  onNew: () => void;
  onLoad: () => void;
  onJump: (value: string) => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export class TitleScreen {
  private root = document.getElementById('title')!;
  private o!: TitleOptions;
  /** 借来的按钮原来的位置，离开标题画面时放回去 */
  private homes: { node: HTMLElement; parent: Node; next: Node | null }[] = [];

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (this.root.hidden) return;
      if (e.key === 'Escape' && this.root.dataset.view !== 'menu') {
        e.preventDefault();
        this.menu();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        // 上下键在当前一列按钮间移动焦点
        const list = [...this.root.querySelectorAll<HTMLButtonElement>('.title-nav button:not(:disabled)')];
        if (!list.length) return;
        e.preventDefault();
        const i = list.indexOf(document.activeElement as HTMLButtonElement);
        const d = e.key === 'ArrowDown' ? 1 : -1;
        list[i < 0 ? 0 : (i + d + list.length) % list.length].focus();
      }
    });
  }

  show(o: TitleOptions) {
    this.o = o;
    this.homes = o.buttons.map((node) => ({ node, parent: node.parentNode!, next: node.nextSibling }));
    document.body.classList.add('at-title');
    this.root.hidden = false;
    this.menu();
  }

  hide() {
    this.root.hidden = true;
    document.body.classList.remove('at-title');
    for (const h of this.homes) h.parent.insertBefore(h.node, h.next);
    this.homes = [];
  }

  private frame(view: string, ...body: HTMLElement[]) {
    this.root.dataset.view = view;
    const head = el('header', 'title-head');
    const faces = el('div', 'title-faces');
    for (const src of this.o.portraits) {
      const img = el('img');
      img.src = src;
      img.alt = '';
      faces.append(img);
    }
    head.append(el('h1', 'title-logo', '水浒传'), el('p', 'title-sub', '梁山好汉'), faces);
    const foot = el('footer', 'title-foot');
    const ver = el('span', 'title-ver', `网页重制版 · ${this.o.version}`);
    const tools = el('span', 'title-tools');
    tools.append(...this.o.buttons);
    foot.append(ver, tools);
    const main = el('div', 'title-body');
    main.append(...body);
    this.root.replaceChildren(head, main, foot);
  }

  private button(label: string, run: () => void, sub?: string, primary = false) {
    const b = el('button', primary ? 'primary' : undefined);
    b.type = 'button';
    b.append(el('span', undefined, label));
    if (sub) b.append(el('small', undefined, sub));
    b.onclick = run;
    return b;
  }

  /** 主菜单 */
  menu() {
    const { save } = this.o;
    const nav = el('nav', 'title-nav');
    const start = this.button('开始游戏', () => (save ? this.confirmNew() : this.o.onNew()), '从第一章「私走延安府」开始', !save);
    const load = this.button('读取存档', () => this.o.onLoad(), save ? [save.where, save.detail.split('\n')[0]].filter(Boolean).join('\n') : '还没有存档', !!save);
    load.disabled = !save;
    const jump = this.button('选　　关', () => this.stages(), '直接进入任意一关（按那一关的难度配等级和装备）');
    nav.append(start, load, jump);
    this.frame('menu', nav);
    (save ? load : start).focus();
  }

  /** 已有存档时开新游戏先确认 */
  private confirmNew() {
    const box = el('div', 'title-confirm');
    box.append(el('p', undefined, '开始新游戏会覆盖现有的存档：'), el('p', 'title-save', `${this.o.save!.where}\n${this.o.save!.detail}`));
    const nav = el('nav', 'title-nav');
    const ok = this.button('覆盖存档，开始新游戏', () => this.o.onNew(), undefined, true);
    nav.append(ok, this.button('返回', () => this.menu()));
    box.append(nav);
    this.frame('confirm', box);
    ok.focus();
  }

  /** 选关：按章分组 */
  private stages() {
    const box = el('div', 'title-stages');
    const top = el('div', 'title-stages-top');
    const back = this.button('‹ 返回', () => this.menu());
    top.append(back, el('span', 'hint', this.o.save ? '选关会覆盖现有的存档。' : '人物等级和装备按所选关卡的难度配好。'));
    const list = el('div', 'title-stage-list');
    for (const ch of this.o.chapters) {
      const sec = el('section');
      sec.append(el('h3', undefined, ch.label));
      const grid = el('div', 'title-stage-grid');
      for (const it of ch.items) {
        const b = el('button', /^town:/.test(it.value) ? 'town' : /^剧情/.test(it.label) ? 'story' : undefined, it.label);
        b.type = 'button';
        if (it.title) b.title = it.title;
        b.onclick = () => this.o.onJump(it.value);
        grid.append(b);
      }
      sec.append(grid);
      list.append(sec);
    }
    box.append(top, list);
    this.frame('stages', box);
    back.focus();
  }
}
