// newgame.js — 開始新航海 (MAIN.EXE 0FEA 段)
//   16f96 標題選單「開始新航海」處理
//   16564 主角選擇 (6 位主角頭像, 調色盤循環, 框選高亮)   1637a 主角資料視窗   1630f 確認框
//   164b7 改名 (2e09:2a38 鍵盤)   164e0 / 16506 姓名備份/還原
//   16949 新遊戲初始化: 162e4, 16854 (發現物/寶物), 168ea (地圖視窗), 1681a, 167bd + 1fd9:333a (已探索範圍)
import { NameInput } from "../ui/nameinput.js";

const ngHex = s => { const b = Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16))), o = new Uint8Array(b.length + 1); o.set(b); return o; };
const ngDiv8 = v => (v < 0 ? -((-v) >> 3) : v >> 3);
const ngDiv2 = v => (v < 0 ? -((-v) >> 1) : v >> 1);

export class NewGame {
  // data: assets/data/newgame.json; nodes: assets/data/mapnodes.bin (DATA1.LZW #4, 每筆 16 bytes)
  constructor(ctx, data, nodes) {
    this.c = ctx; this.d = data; this.nodes = nodes;
    this.S = { all: ngHex(data.strings.all), d3: ngHex(data.strings.d3) };
    this.skillNames = data.skillNames.map(ngHex);
    this.kb = new NameInput(ctx, data);
  }
  get st() { return this.c.state; }
  // 162e4: [c2ce] = 主角人物記錄, [c2d4] = 主角艦隊記錄 (人物 +2c = 艦隊編號)
  get personDS() { return 0x12b6 + this.st.hero * 0x32; }
  get fleetDS() { return 0x2e76 + this.st.u8(this.personDS + 0x2c) * 0x85; }

  // 16f96: [03d5] ≠ 0 時先選主角 (本版本恆為 1); 取消回傳 0
  async run() {
    if (this.c.flag03d5 ?? 1) { if (await this.select(0) === -1) return 0; }
    this.init();
    // [03d5] = 0 時會把姓名寫進 USERNAME.DAT (本版本不會發生)
    return 1;
  }
  // 16532 畫 6 位主角頭像 (KAO #0..5)
  drawPortraits() {
    for (let i = 5; i >= 0; i--) { const [x, y] = this.d.portraits[i]; this.c.kao.drawNamed(this.c.scr, i, ngDiv8(x), y); }
  }
  // 16564 主角選擇; 回傳主角編號, 取消回傳 -1
  async select(di) {
    const { palette, graph, menu, win, scr } = this.c;
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
      this.st.set8(0x12b5, sel);
      await this.info();
      let ok = await this.confirm(0);
      if (ok) {
        await win.close();
        const saved = this.st.bytes(this.personDS, 26).slice();         // 164e0
        await this.rename();                                             // 164b7
        await this.info();
        ok = await this.confirm(1);
        if (!ok) this.st.b.set(saved, this.personDS - 0x0ca4);           // 16506
      }
      await win.close();
      if (ok) {
        if (!palette.invert && di === 0) palette.stopCycle();
        return sel;
      }
    }
  }
  // 1637a 主角資料視窗
  async info() {
    const { win, con, kao, scr, message, printf } = this.c, st = this.st, P = this.personDS, hero = st.hero;
    await win.open(0x1e, 0x20, 0x2e, 0xf0, 1);                          // 74f7
    con.lineH = 0x10;                                                    // [8a1e]
    kao.drawNamed(scr, hero, 0x20, 0x30);                                // 7cdd
    con.setCursor(0x29, 0x30); message(0x3a6, st.cstr(P), st.cstr(P + 13));   // 姓名
    con.setCursor(0x2a, 0x50); message(0x3a7);
    con.setCursor(0x36, -1); message(0x3a8);                              // 442c: 只設欄
    con.setCursor(0x2a, -1); message(0x3a9);
    con.setCursor(0x36, -1); message(0x3aa);
    con.setCursor(0x2f, 0x50); message(0x3ab, st.u8(P + 0x2a));          // 年齡
    for (let i = 0; i < 7; i++) {
      con.setCursor((i & 1) * 11 + 0x3c, (ngDiv2(i) + 5) << 4);
      printf(this.S.d3, st.u8(P + 0x1c + i));                             // 能力值 %3d
    }
    con.setCursor(0x2c, 0x80); con.puts(this.skillNames[this.d.heroSkill[hero]]);  // 技能
    con.setCursor(0x22, 0xa0); message(this.d.heroMessage[hero]);         // 介紹
    con.lineH = 0x18;
  }
  // 1630f 確認框 (flag=1 時前置「全部」); 回傳 1 = 是
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
  // ---------------- 16949 新遊戲初始化 ----------------
  init() {
    const st = this.st, rng = this.c.sys.rng, P = this.personDS, F = this.fleetDS;
    st.set8(F + 0x29, st.u8(F + 0x29) | 1);
    st.set8(P + 0x23, rng.random(0x65));
    st.set8(0x0cae, st.u8(F + 0x26));                                    // 出發港
    const port = 0x5f54 + st.u8(0x0cae) * 0x16;
    st.set8(port + 0x15, st.u8(port + 0x15) | 0x50);
    this.shuffleDiscoveries(rng);                                         // 16854
    this.mapView();                                                       // 168ea
    this.c.rt = { year: st.year, month: st.month, day: st.day, time: st.time };   // 1681a: [0532..0535]
    // 1681a 其餘: 2e09:4978 載入 SNR(主角+1).DAT, 1667a 讀 DATA1.LZW 世界地圖資料, seg0:5022 滑鼠速度, [0a89] 檔名字元
    this.c.scenario = st.hero + 1;
    // 1667a: WINDCUR.DAT 風向表 (4..9 月用前 450 bytes, 其他月份用第二組) → [0400]; 海流 (+0x384) → [0404]
    this.c.windOffset = st.month >= 3 && st.month < 9 ? 0 : 0x1c2;
    // seg0:5022 (INT 33h fn 0Fh) 滑鼠速度: 每 8 像素的 mickey = ([0ca8]+2)*2
    { const r = (st.u8(0x0ca8) + 2) * 2; this.c.sys.mickeyRatio = [r, r]; }
    this.exploreStart();                                                  // 167bd
    st.b.fill(0xff, 0x8a18 - 0x0ca4, 0x8a18 - 0x0ca4 + 0x300);           // [0c8e] 緩衝 0x300 bytes = FF
    this.c.buf0c8e = st.b.slice(0x8a18 - 0x0ca4, 0x8a18 - 0x0ca4 + 0x300);
  }
  // 16854: 98 個發現物先全部標成「未發現」(+6 bit7), 再隨機取消 50 個;
  //   然後替寶物 #80..89 各隨機指定一個仍未發現、且 +4 < 0x5a 的發現物 (+4 = 0x5a + 序號, 寶物 +0x12 = 發現物編號)
  shuffleDiscoveries(rng) {
    const st = this.st, D = i => 0x7f8c + i * 7;
    for (let i = 0; i < 0x62; i++) st.set8(D(i) + 6, st.u8(D(i) + 6) | 0x80);
    for (let n = 0; n < 0x32;) {
      const k = rng.random(0x62) & 0xff;
      if (st.u8(D(k) + 6) & 0x80) { st.set8(D(k) + 6, st.u8(D(k) + 6) & 0x7f); n++; }
    }
    let item = 0x8248 + 0x50 * 0x14;
    for (let n = 0; n < 10;) {
      const k = rng.random(0x62) & 0xff;
      if ((st.u8(D(k) + 6) & 0x80) && st.u8(D(k) + 4) < 0x5a) {
        st.set8(D(k) + 4, n + 0x5a); st.set8(item + 0x12, k); n++; item += 0x14;
      }
    }
  }
  // 168ea: 世界地圖視窗左上角 [1006]/[1008] = 艦隊座標 - 11, 限制在範圍內
  mapView() {
    const st = this.st, F = this.fleetDS, s16 = v => (v << 16) >> 16;
    const x = s16(st.u16(F)), base = Math.trunc(x / 0x2d0) * 0x2d0;
    let vx = s16(x - 11);
    if (vx < base) vx = base; else if (base + 0x2b8 <= vx) vx = base + 0x2b8;
    let vy = s16(st.u16(F + 2) - 11);
    if (vy < 0) vy = 0; else if (0x420 <= vy) vy = 0x420;
    st.set16(0x1006, vx); st.set16(0x1008, vy);
  }
  // 167bd: 清除已探索點陣 DS:0de8 (0x21c bytes, 每列 12 bytes = 96 格), 標記第 8..17 列 x 第 4..16 欄,
  //   每格 [100e]++; 再以 1fd9:333a 把座標落在已探索格內的地點記到 DS:1046 位元表
  exploreStart() {
    const st = this.st;
    st.b.fill(0, 0x0de8 - 0x0ca4, 0x0de8 - 0x0ca4 + 0x21c);
    for (let row = 8; row <= 0x11; row++) for (let col = 4; col <= 0x10; col++) {
      const a = 0x0de8 + (col >> 3) + row * 12;
      st.set8(a, st.u8(a) | (0x80 >> (col & 7)));
      st.set16(0x100e, st.u16(0x100e) + 1);
    }
    this.markExplored();
  }
  // 1fd9:333a
  markExplored() {
    const st = this.st, N = this.nodes, n = N.length >> 4;
    for (let i = 0; i < n; i++) {
      const w0 = N[i * 16] | (N[i * 16 + 1] << 8), w2 = ((N[i * 16 + 2] | (N[i * 16 + 3] << 8)) << 16) >> 16;
      const cx = Math.floor((w0 & 0x7fff) / 0x18), cy = Math.trunc(w2 / 0x18);
      if (st.u8(0x0de8 + (cx >> 3) + cy * 12) & (0x80 >> (cx & 7))) {
        const a = 0x1046 + (i >> 3);
        st.set8(a, st.u8(a) | (0x80 >> (i & 7)));
      }
    }
  }
}
