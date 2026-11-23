// clock.js — 遊戲主迴圈與時間推進 (MAIN.EXE 0FEA 段 1623a..162e1, 1b2ba, 1b1d2, 1a011, 1603c/16003; 1fd9:32c4)
// 時間: 年 [0532]  月 [0533] (0..11)  日 [0534]  時刻 [0535] (0..71, 每格 20 分鐘); 存檔內的起點 [0caa..0cad]
// 每個時刻: 1a011 風向/天候 → 1b1d2 (港口: 調色盤 + 港口行動, 回傳消耗的時刻) → 艦隊 AI (每格處理一支艦隊, 1ac19)
//
// 尚未移植 (見 docs/RE_NOTES.md 第 15 節; 目前以 console.warn 標出, 不改狀態):
//   1ac19 艦隊 AI   19717 後半的每日處理 (195d2 / 19648 / 196ef / 8067)   18ff5 月末   16126 年末   海上 (851f / 6cfc / 2e09:2f3d)
import { PortScene, loadPortAssets } from "../scenes/port.js";

const clockWarned = new Set();
const clockTodo = name => { if (!clockWarned.has(name)) { clockWarned.add(name); console.warn("尚未移植: " + name); } };

export class GameClock {
  constructor(ctx) { this.c = ctx; }
  get st() { return this.c.state; }
  get rt() { return this.c.rt; }
  // 1b39a 中止旗標 (月/日/時刻 >= F0)
  abort() { const r = this.rt; return r.month >= 0xf0 || r.day >= 0xf0 || r.time >= 0xf0; }
  // 16003 閏年: 原版只在 (1500+年) 同時被 4 與 100 整除且 %400==0 時才算閏年 (照搬)
  leap() { const y = this.rt.year + 0x5dc; return y % 4 === 0 && y % 100 === 0 ? (y % 400 === 0 ? 1 : 0) : 0; }
  // 1603c
  daysInMonth() { const d = this.c.portAssets.data.daysInMonth[this.rt.month]; return this.rt.month === 1 && this.leap() ? d + 1 : d; }
  // 1fd9:32c4 艦隊所在海域的風向 ([0400]) 與海流 ([0404]); 各 30×15 格 (每格 = 3×3 個 24 單位)
  windAt(F) {
    const s16 = v => (v << 16) >> 16, st = this.st;
    const x = s16(st.u16(F)), y = s16(st.u16(F + 2));
    const k = Math.trunc(Math.trunc(y / 24) / 3) * 30 + Math.trunc(Math.trunc(x / 24) / 3);
    const W = this.c.portAssets.wind, off = this.c.windOffset ?? 0;
    return [W[(off + k) & 0xffff] ?? 0, W[0x384 + k] ?? 0];
  }
  // 1a011 風向與天候
  weather() {
    const st = this.st, rng = this.c.sys.rng;
    const F = 0x2e76 + st.u8(st.personRecord(st.hero) + 0x2c) * 0x85;
    const [w0, w2] = this.windAt(F);
    let v;
    if (st.u8(0x0cb3) & 15) v = (st.u8(0x0cb1) & 0x3f) | (w0 & 0xc0);
    else {
      const sum = rng.random(2) + (w0 & 7), m = sum > 7 ? 7 : sum;                   // seg0:4d7c 無號最小值
      const si = rng.random(3), a = rng.random(5);
      let al = ((a >> 2) * ((si - 1) & 0xff)) & 0xff;                                // mul cl (8 位元)
      al = (al << 3) & 0xff;
      al = ((al + (w0 & 0xf8)) & 0xff) & 0x38;
      v = (al + m) & 0xff;
    }
    st.set8(0x0cb1, v); st.set8(0x0cb2, w2);
    // 19ba1: 只做計算, 不改狀態
    if (st.port === 0xff) { clockTodo("海上天候 (1976e/19f48/19a99)"); }
    else st.set8(0x0cb3, st.u8(0x0cb3) & 0xf0);
  }
  // 1b1d2 一個時刻 (港口)
  async slot() {
    const { palette } = this.c, st = this.st;
    switch (palette.fadeState) {                                                     // [a4aa]
      case 0: if (!(st.u8(0x0cb3) & 15)) palette.fadeState = palette.timeTransition(this.rt.time); break;
      case 1: palette.fadeState = await palette.fadeStepTarget(); break;
      case 2: palette.fadeState = 0; await palette.fadeToTarget(); break;
    }
    if (st.port === 0xff) { clockTodo("海上時刻 (1fd9:13c1 / 1afe8 / 2e09:38ec)"); this.rt.time = 0x48; return; }
    if (!palette.invert) palette.setTarget(palette.T[["night", "dawn", "day", "dusk", "overcast"][palette.constructor.timeSlot(this.rt.time)]]);
    await palette.fadeToTarget();
    this.rt.time = (this.rt.time + await this.portScene.action()) & 0xff;            // 1bb07
    if (this.abort()) return;
    if (st.port !== 0xff) this.portScene.redraw();                                  // 1b1a3
    if (st.u8(0x0cb0) & 0x80) this.rt.time = 0x48;
    else if (!palette.invert) {
      const name = this.rt.time < 0x48 ? ["night", "dawn", "day", "dusk", "overcast"][palette.constructor.timeSlot(this.rt.time)] : "night";
      palette.setTarget(palette.T[name]);
    }
    palette.fadeState = 1;
  }
  // 1b2ba 一天
  async day() {
    const st = this.st;
    if (st.port === 0xff) clockTodo("海上每日事件 (2e09:55c2)");
    let t = st.u8(0x0cad);
    while (!this.c.palette.ending) {
      this.rt.time = t;
      if (t >= 0x48) break;
      if (st.u8(0x0cad) !== 0 || t % 12 === 0) this.weather();
      await this.slot();
      if (this.abort()) return;
      for (; t < this.rt.time; t++) if (t < 0x46) clockTodo("艦隊 AI (1ac19)");
      if (!this.c.palette.ending && st.port === 0xff) clockTodo("海上移動 (6cfc / 2e09:2f3d)");
    }
    if (this.c.palette.ending) return;
    this.dayEnd();                                                                   // 19717
    for (t = 0; t < st.u8(0x0cad); t++) if (t < 0x46) clockTodo("艦隊 AI (1ac19)");
  }
  // 19717 一天結束 (前半)
  dayEnd() {
    const st = this.st;
    st.set8(0x0cad, st.u8(0x0cb0) & 0x80 ? 0x18 : 0);
    st.set8(0x0cb3, st.u8(0x0cb3) & 0x7f);
    st.set8(0x0cb0, 0);
    st.set8(0x2e18, st.u8(0x2e18) + 1);
    if (st.port === 0xff) clockTodo("海上每日處理 (195b6)");                          // 195d2: 只在海上
    this.portsDaily();                                                               // 19648
    for (let i = 0; i < 0x1e; i++) {                                                 // 196ef 酒吧女郎
      const a = 0x2bde + i * 0x13 + 0x11, v = st.u8(a); if (v !== 0xff && v !== 0) st.set8(a, v - 1);
    }
    if (st.u8(0x10a6)) st.set8(0x10a6, st.u8(0x10a6) - 1);
    if (st.port === 0xff) clockTodo("海上每日處理 (8067)");                          // 8067: 在港時不做任何事
  }
  // 19648 各港每日: 支持度 >= 75 的國家取得該港; 所屬國支持度 < 75 時變成無所屬 (6);
  //   bit3 (待開發) 的港在商業價值 >= 150 時清除 bit3 並使 10 項物價各增加 min(random(5)+10, 100-值); [港+23] 倒數
  portsDaily() {
    const st = this.st, rng = this.c.sys.rng;
    for (let p = 0; p < 100; p++) {
      const R = 0x5f54 + p * 0x16, E = 0x6a80 + p * 0x25;
      for (let i = 0; i < 6; i++) {
        const nat = st.u8(R + 0x15) & 7;
        if (st.u8(E + 8 + i) >= 0x4b) {
          if (nat !== i) {                                                           // 195d7
            st.set8(R + 0x15, (st.u8(R + 0x15) & 0xf8) | i);
            if (st.u16(E) < 0x96 && p > 0x29) st.set8(R + 0x15, st.u8(R + 0x15) | 8);
          }
        } else if (nat === i) st.set8(R + 0x15, (st.u8(R + 0x15) & 0xf6) | 6);   // 19602
      }
      if ((st.u8(R + 0x15) & 8) && st.u16(E) >= 0x96) {                            // 1960d
        st.set8(R + 0x15, st.u8(R + 0x15) & 0xf7);
        for (let k = 0; k < 10; k++) { const v = st.u8(E + 0x0e + k); st.set8(E + 0x0e + k, v + Math.min(rng.random(5) + 10, (100 - v) & 0xffff)); }
      }
      const c = st.u8(E + 0x23); if (c !== 0xff) st.set8(E + 0x23, c - Math.min(1, c));
    }
  }
  // 17546 後半 (1721f) + 1623a 主迴圈
  async run() {
    const { sys, palette, bgm } = this.c, st = this.st;
    this.c.portAssets ??= await loadPortAssets(this.c);
    this.portScene = new PortScene(this.c, this.c.portAssets);
    if (st.port !== 0xff) await this.portScene.enter();                              // 8c53
    else { clockTodo("出海 (851f)"); return; }
    if (!(st.options & 4)) bgm.fadeOut();
    sys.mouseShow();
    await palette.fadeToTarget();
    for (;;) {
      // 16173
      if (this.abort()) Object.assign(this.rt, { year: st.year, month: st.month, day: st.day, time: st.time });
      if (palette.ending) break;
      this.rt.month = st.month;
      while (this.rt.month < 12 && !palette.ending) {
        const days = this.daysInMonth();
        this.rt.day = st.day;
        while (!palette.ending && this.rt.day < days) { await this.day(); this.rt.day++; }
        if (!palette.ending && !this.abort()) clockTodo("月末處理 (18ff5)");
        this.rt.month++;
      }
      if (!palette.ending && !this.abort()) clockTodo("年末處理 (16126)");
      if (palette.ending) break;
    }
  }
}
