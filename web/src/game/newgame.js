// newgame.js — 开始新航海 (MAIN.EXE 0FEA 段)
//   16f96 标题菜单「开始新航海」处理
//   16564 主角选择 (6 位主角头像, 调色盘循环, 框选高亮)   1637a 主角数据窗口   1630f 确认框
//   164b7 改名 (2e09:2a38 键盘)   164e0 / 16506 姓名备份/还原
//   16949 新游戏初始化: 162e4, 16854 (发现物/宝物), 168ea (地图窗口), 1681a, 167bd + 1fd9:333a (已探索范围)
import { NameInput } from "../ui/nameinput.js";
import { DS } from "../model/schema_views.ts";
import { DiscoveryFlag, FleetFlag, WorkDS } from "../model/flags.ts";
import { renderWideNewGame, hitWideHeroCard } from "../canvas_ui/wide_newgame.ts";
import { renderWideTitle } from "../canvas_ui/wide_title.ts";
import { captureConsoleText, decodeCleanCstr } from "../canvas_ui/text_util.ts";
import { hasDom } from "../modern/dom_ui.ts";
import { runDomNewGameSelect, hideDomWorldHud } from "../modern/dom_hud.ts";
import { UI_STR } from "../modern/ui_strings.ts";

const ngHex = s => { const b = Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16))), o = new Uint8Array(b.length + 1); o.set(b); return o; };
const ngDiv8 = v => (v < 0 ? -((-v) >> 3) : v >> 3);
const ngDiv2 = v => (v < 0 ? -((-v) >> 1) : v >> 1);

export class NewGame {
  // data: assets/data/newgame.json; nodes: assets/data/mapnodes.bin (DATA1.LZW #4, 每笔 16 bytes)
  constructor(ctx, data, nodes) {
    this.c = ctx; this.d = data; this.nodes = nodes;
    this.S = { all: ngHex(data.strings.all), d3: ngHex(data.strings.d3) };
    this.skillNames = data.skillNames.map(ngHex);
    this.kb = new NameInput(ctx, data);
  }
  get st() { return this.c.state; }
  get m() { return this.c.state.model; }
  // 162e4: [c2ce] = 主角人物记录, [c2d4] = 主角舰队记录 (人物 +2c = 舰队编号)
  get personDS() { return this.m.heroPerson().addr; }
  get fleetDS() { return this.m.fleet(this.m.heroPerson().fleet).addr; }

  // 16f96: [03d5] ≠ 0 时先选主角 (本版本恒为 1); 取消返回 0
  async run() {
    if (this.c.flag03d5 ?? 1) { if (await this.select(0) === -1) return 0; }
    this.init();
    // [03d5] = 0 时会把姓名写进 USERNAME.DAT (本版本不会发生)
    return 1;
  }
  // 16532 画 6 位主角头像 (KAO #0..5)
  drawPortraits() {
    for (let i = 5; i >= 0; i--) { const [x, y] = this.d.portraits[i]; this.c.kao.drawNamed(this.c.scr, i, ngDiv8(x), y); }
  }
  captureMessage(n, ...args) {
    return captureConsoleText(this.c, () => this.c.message(n, ...args));
  }
  // 16564 主角选择; 返回主角编号, 取消返回 -1
  async select(di) {
    const { palette, graph, menu, win, scr, art, codec, sys } = this.c;
    if (scr.hdCtx && art && codec) {
      const dec = b => decodeCleanCstr(codec, b);
      const buildHero = i => {
        this.m.globals.hero = i;
        const p = this.m.heroPerson();
        return {
          id: i,
          name: this.captureMessage(0x3a6, p.givenNameBytes, p.familyNameBytes),
          given: dec(p.givenNameBytes),
          family: dec(p.familyNameBytes),
          age: p.age,
          stats: Array.from({ length: 7 }, (_, k) => p.getStats(k)),
          skill: dec(this.skillNames[this.d.heroSkill[i]]),
          intro: this.captureMessage(this.d.heroMessage[i]),
          portraitUrl: art.portraitUrl(i),
        };
      };
      const heroes = Array.from({ length: 6 }, (_, i) => buildHero(i));
      await Promise.all(heroes.map(h => h.portraitUrl ? art.loadImage(h.portraitUrl).catch(() => {}) : null));
      const statLabels = [...UI_STR.heroStats];

      if (hasDom()) {
        hideDomWorldHud();
        scr.wideRenderer = c2d => renderWideTitle(c2d, art);
        scr.dirty = true;
        const res = await runDomNewGameSelect(heroes, statLabels, di < 1);
        if (!res) return -1;
        this.m.globals.hero = res.id;
        const writeIfChanged = (dest, origStr, newStr, maxBytes) => {
          if (!newStr || newStr === origStr) return;
          try {
            const bts = this.c.font.encode(newStr).subarray(0, maxBytes);
            for (let i = 0; i < bts.length; i++) this.st.set8(dest + i, bts[i]);
            this.st.set8(dest + bts.length, 0);
          } catch { /* 若输入含字库未收录字符则保留原名 */ }
        };
        writeIfChanged(this.personDS, heroes[res.id].given, res.given, 12);
        writeIfChanged(this.personDS + 13, heroes[res.id].family, res.family, 12);
        return res.id;
      }

      let selected = 0;
      const drawGallery = c2d => renderWideNewGame(c2d, art, heroes, selected, statLabels);
      scr.wideRenderer = drawGallery;
      scr.dirty = true;
      await menu.waitRelease();

      for (;;) {
        const vx = sys.mouse?.vx ?? -1, vy = sys.mouse?.vy ?? -1;
        const hov = hitWideHeroCard(vx, vy, heroes.length);
        if (hov >= 0 && hov !== selected) { selected = hov; scr.dirty = true; }

        const ev = menu.readEvent();
        if (ev === 0x1c || ev === 0x36) { selected = (selected + 1) % 6; scr.dirty = true; }
        else if (ev === 0x1d || ev === 0x34) { selected = (selected + 5) % 6; scr.dirty = true; }
        else if (ev === 0x1e || ev === 0x38) { selected = (selected + 3) % 6; scr.dirty = true; }
        else if (ev === 0x1f || ev === 0x32) { selected = (selected + 3) % 6; scr.dirty = true; }
        else if ((ev === 0x1b || ev === 0x30) && di < 1) {
          scr.wideRenderer = null;
          scr.wideDialog = null;
          return -1;
        } else if (ev === 0x0d) {
          if (menu.mouseFlag && hov < 0) { await sys.poll(); continue; }
          if (menu.mouseFlag && hov >= 0) selected = hov;
          this.m.globals.hero = selected;
          scr.wideDialog = { text: this.captureMessage(0x3b3), portraitId: null, waiting: false };
          scr.dirty = true;
          let ok = await menu.yesNo();
          scr.wideDialog = null;
          scr.dirty = true;
          if (ok) {
            const saved = this.st.bytes(this.personDS, 26).slice();
            scr.wideRenderer = null;
            scr.clear(0);
            await this.rename();
            heroes[selected] = buildHero(selected);
            scr.wideRenderer = drawGallery;
            scr.wideDialog = { text: dec(this.S.all) + this.captureMessage(0x3b3), portraitId: null, waiting: false };
            scr.dirty = true;
            ok = await menu.yesNo();
            scr.wideDialog = null;
            scr.dirty = true;
            if (!ok) {
              this.st.b.set(saved, this.personDS - DS.STATE_BASE);
              heroes[selected] = buildHero(selected);
            }
          }
          if (ok) {
            scr.wideRenderer = null;
            scr.wideDialog = null;
            return selected;
          }
          await menu.waitRelease();
        }
        await sys.poll();
      }
    }
    await palette.fadeBlack();                                           // 99f2
    graph.draw(1, 0, 0);                                                 // 5b5d: GRAPH.DAT #1
    this.drawPortraits();
    await palette.fadeTo(palette.table("heroSelect"));                   // 99ce(a2ac)
    if (!palette.invert) palette.startCycle(this.d.cycle.frames, this.d.cycle.speed);   // 16ee(a32c, 8, 8)
    for (;;) {
      for (let i = 5; i >= 0; i--) {
        const [x, y] = this.d.portraits[i];
        menu.rects[i] = { x0: x, x1: x + 0x40, y0: y, y1: y + 0x50 };
      }
      const sel = await menu.customMenu(6, 6, di < 1 ? 0x81 : 0x80);  // 14524
      if (sel === 0xff) {                                                // 1663f
        if (!palette.invert) palette.stopCycle();
        await palette.fadeBlack(); scr.clear(0); await palette.fadeToTarget();
        return -1;
      }
      this.m.globals.hero = sel;
      await this.info();
      let ok = await this.confirm(0);
      if (ok) {
        await win.close();
        const saved = this.st.bytes(this.personDS, 26).slice();         // 164e0
        await this.rename();                                             // 164b7
        await this.info();
        ok = await this.confirm(1);
        if (!ok) this.st.b.set(saved, this.personDS - DS.STATE_BASE);    // 16506
      }
      await win.close();
      if (ok) {
        if (!palette.invert && di === 0) palette.stopCycle();
        return sel;
      }
    }
  }
  // 1637a 主角数据窗口
  async info() {
    const { win, con, kao, scr, message, printf } = this.c, m = this.m, heroId = m.globals.hero, p = m.heroPerson();
    await win.open(0x1e, 0x20, 0x2e, 0xf0, 1);                          // 74f7
    con.lineH = 0x10;                                                    // [8a1e]
    kao.drawNamed(scr, heroId, 0x20, 0x30);                              // 7cdd
    con.setCursor(0x29, 0x30); message(0x3a6, p.givenNameBytes, p.familyNameBytes);   // 姓名
    con.setCursor(0x2a, 0x50); message(0x3a7);
    con.setCursor(0x36, -1); message(0x3a8);                              // 442c: 只设栏
    con.setCursor(0x2a, -1); message(0x3a9);
    con.setCursor(0x36, -1); message(0x3aa);
    con.setCursor(0x2f, 0x50); message(0x3ab, p.age);                    // 年龄
    for (let i = 0; i < 7; i++) {
      con.setCursor((i & 1) * 11 + 0x3c, (ngDiv2(i) + 5) << 4);
      printf(this.S.d3, p.getStats(i));                                  // 能力值 %3d
    }
    con.setCursor(0x2c, 0x80); con.puts(this.skillNames[this.d.heroSkill[heroId]]);  // 技能
    con.setCursor(0x22, 0xa0); message(this.d.heroMessage[heroId]);      // 介绍
    con.lineH = 0x18;
  }
  // 1630f 确认框 (flag=1 时前置「全部」); 返回 1 = 是
  async confirm(flag) {
    const { win, con, menu, message } = this.c;
    const y = con.left === con.x ? con.y : con.y + 0x18;
    await win.open(ngDiv2(con.right - con.left) + con.left - 12, y, 0x18, 0x30, 1);
    if (flag) con.puts(this.S.all);
    message(0x3b3);
    const r = await menu.yesNo();                                        // 1469c
    await win.close();
    return r;
  }
  // 164b7 改名
  async rename() {
    const { win, message } = this.c;
    await win.open(0x28, 0x30, 0x28, 0x60, 1);
    message(0x3ac);
    await this.kb.renameHero(this.personDS, 6);                          // 2e09:2a38
    await win.close();
  }
  // ---------------- 16949 新游戏初始化 ----------------
  init() {
    const st = this.st, m = this.m, g = m.globals, rng = this.c.sys.rng, p = m.heroPerson(), fl = m.fleet(p.fleet);
    fl.flags |= FleetFlag.AT_SEA;
    p.setStats(7, rng.random(0x65));
    g.port = fl.homePort;                                                 // 出发港
    m.port(g.port).region |= 0x50;
    this.shuffleDiscoveries(rng);                                         // 16854
    this.mapView();                                                       // 168ea
    this.c.rt = { year: g.year, month: g.month, day: g.day, time: g.time };   // 1681a: [0532..0535]
    this.c.scenario = g.hero + 1;
    this.c.eventFile = `EVENT${g.hero + 1}.DAT`;                          // 1681a 结尾: [0a89] = '1' + 主角 (剧情插图档, scenario.js CB)
    this.c.windOffset = g.month >= 3 && g.month < 9 ? 0 : 0x1c2;
    { const r = (g.mouseSens + 2) * 2; this.c.sys.mickeyRatio = [r, r]; }
    this.exploreStart();                                                  // 167bd
    st.b.fill(0xff, DS.TRADE_LOGS - DS.STATE_BASE, DS.TRADE_LOGS - DS.STATE_BASE + 0x300);   // [0c8e] 缓冲 0x300 bytes = FF
    this.c.buf0c8e = st.b.slice(DS.TRADE_LOGS - DS.STATE_BASE, DS.TRADE_LOGS - DS.STATE_BASE + 0x300);
  }
  // 16854: 98 个发现物先全部标成「未发现」(+6 bit7), 再随机取消 50 个;
  //   然后替宝物 #80..89 各随机指定一个仍未发现、且 +4 < 0x5a 的发现物 (+4 = 0x5a + 序号, 宝物 +0x12 = 发现物编号)
  shuffleDiscoveries(rng) {
    const m = this.m;
    for (let i = 0; i < 98; i++) m.discovery(i).flags |= DiscoveryFlag.FOUND;
    for (let n = 0; n < 50;) {
      const k = rng.random(98) & 0xff, d = m.discovery(k);
      if (d.flags & DiscoveryFlag.FOUND) { d.flags &= ~DiscoveryFlag.FOUND; n++; }
    }
    for (let n = 0; n < 10;) {
      const k = rng.random(98) & 0xff, d = m.discovery(k);
      if ((d.flags & DiscoveryFlag.FOUND) && d.item < 0x5a) {
        d.item = n + 0x5a; m.item(0x50 + n).power = k; n++;
      }
    }
  }
  // 168ea: 世界地图窗口左上角 seaViewX / seaViewY = 舰队座标 - 11, 限制在范围内
  mapView() {
    const m = this.m, g = m.globals, fl = m.fleet(m.heroPerson().fleet), s16 = v => (v << 16) >> 16;
    const x = s16(fl.x), base = Math.trunc(x / 0x2d0) * 0x2d0;
    let vx = s16(x - 11);
    if (vx < base) vx = base; else if (base + 0x2b8 <= vx) vx = base + 0x2b8;
    let vy = s16(fl.y - 11);
    if (vy < 0) vy = 0; else if (0x420 <= vy) vy = 0x420;
    g.seaViewX = vx; g.seaViewY = vy;
  }
  // 167bd: 清除已探索点阵 WorkDS.EXPLORE_MAP (0x21c bytes, 每列 12 bytes = 96 格), 标记第 8..17 列 x 第 4..16 栏
  exploreStart() {
    const st = this.st;
    st.b.fill(0, WorkDS.EXPLORE_MAP - DS.STATE_BASE, WorkDS.EXPLORE_MAP - DS.STATE_BASE + 0x21c);
    for (let row = 8; row <= 0x11; row++) for (let col = 4; col <= 0x10; col++) {
      const a = WorkDS.EXPLORE_MAP + (col >> 3) + row * 12;
      st.set8(a, st.u8(a) | (0x80 >> (col & 7)));
      st.set16(WorkDS.EXPLORE_TOTAL, st.u16(WorkDS.EXPLORE_TOTAL) + 1);
    }
    this.markExplored();
  }
  // 1fd9:333a
  markExplored() {
    const st = this.st, N = this.nodes, n = N.length >> 4;
    for (let i = 0; i < n; i++) {
      const w0 = N[i * 16] | (N[i * 16 + 1] << 8), w2 = ((N[i * 16 + 2] | (N[i * 16 + 3] << 8)) << 16) >> 16;
      const cx = Math.floor((w0 & 0x7fff) / 0x18), cy = Math.trunc(w2 / 0x18);
      if (st.u8(WorkDS.EXPLORE_MAP + (cx >> 3) + cy * 12) & (0x80 >> (cx & 7))) {
        const a = 0x1046 + (i >> 3);
        st.set8(a, st.u8(a) | (0x80 >> (i & 7)));
      }
    }
  }
}
