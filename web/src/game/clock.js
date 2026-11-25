// clock.js — 遊戲主迴圈與時間推進 (MAIN.EXE 0FEA 段 1623a..162e1, 1b2ba, 1b1d2, 1a011, 1603c/16003; 1fd9:32c4)
// 時間: 年 [0532]  月 [0533] (0..11)  日 [0534]  時刻 [0535] (0..71, 每格 20 分鐘); 存檔內的起點 [0caa..0cad]
// 每個時刻: 1a011 風向/天候 → 1b1d2 (港口: 調色盤 + 港口行動, 回傳消耗的時刻) → 艦隊 AI (每格處理一支艦隊, 1ac19)
// 艦隊 AI 1ac19 → game/fleetai.js、月末 18ff5 / 年末 16126 → game/monthly.js (docs/RE_NOTES.md 第 29 節)
// 海上部分 (出海 851f、海上時刻 1fd9:13c1 / 1afe8 / 2e09:38ec、海上移動 6cfc / 2e09:2f3d、每日 195b6、天候 19a99 / 19f48、劇本 2e09:55c2) → scenes/sea.js
import { loadPortAssets } from "../scenes/port.js";
import { SeaScene } from "../scenes/sea.js";
import { Scenario, ENV_HERO } from "./scenario.js";
import { Title } from "./title.js";
import { faFleet } from "./fleetai.js";
import { Monthly } from "./monthly.js";
import { mainEnding } from "./endgame.js";
import { GameConst, OptionFlag } from "../model/flags.ts";

const clockWarned = new Set();
const clockTodo = name => { if (!clockWarned.has(name)) { clockWarned.add(name); console.warn("尚未移植: " + name); } };

export class GameClock {
  constructor(ctx) { this.c = ctx; }
  get st() { return this.c.state; }
  get m() { return this.c.state.model; }
  get rt() { return this.c.rt; }
  get monthly() { const ai = this.portScene.ai; return this.mon?.ai === ai ? this.mon : (this.mon = new Monthly(ai)); }
  // 1b2ba: [c2ea] = k、1ac19(艦隊 k) — 測試時 ctx.noFleetAI (原版的 1ac19 改成直接返回) 兩邊都略過
  async fleetDaily(k) {
    if (this.c.noFleetAI) return;
    const ai = this.portScene.ai;
    ai.v.c2ea = k;
    await ai.daily(faFleet(k));
  }
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
  async weather() {
    const st = this.st, m = this.m, g = m.globals, rng = this.c.sys.rng;
    const F = m.fleet(m.heroPerson().fleet).addr;
    const [w0, w2] = this.windAt(F);
    let v;
    if (g.weather & 15) v = (g.portFlags & 0x3f) | (w0 & 0xc0);
    else {
      const sum = rng.random(2) + (w0 & 7), mn = sum > 7 ? 7 : sum;                   // seg0:4d7c 無號最小值
      const si = rng.random(3), a = rng.random(5);
      let al = ((a >> 2) * ((si - 1) & 0xff)) & 0xff;                                // mul cl (8 位元)
      al = (al << 3) & 0xff;
      al = ((al + (w0 & 0xf8)) & 0xff) & 0x38;
      v = (al + mn) & 0xff;
    }
    g.portFlags = v; st.set8(0x0cb2, w2);
    // 19ba1: 只做計算, 不改狀態
    if (g.port === GameConst.EMPTY_SLOT) {
      const sea = this.portScene;
      if (g.weather & 15) { this.c.palette.selectTimePalette(this.rt.time, true, g.weather); this.c.palette.fadeState = 1; }   // 1976e, [a4aa] = 1
      if (g.weather & 15) await sea.weatherOngoing();                                // 19f48
      if (!(g.weather & 15)) await sea.weatherStart();                               // 19a99
    } else g.weather &= 0xf0;
  }
  // 1b1d2 一個時刻 (港口)
  async slot() {
    const { palette } = this.c, g = this.m.globals;
    switch (palette.fadeState) {                                                     // [a4aa]
      case 0: if (!(g.weather & 15)) palette.fadeState = palette.timeTransition(this.rt.time); break;
      case 1: palette.fadeState = await palette.fadeStepTarget(); break;
      case 2: palette.fadeState = 0; await palette.fadeToTarget(); break;
    }
    if (g.port === GameConst.EMPTY_SLOT) {                                           // 1b284 海上
      const sea = this.portScene, sys = this.c.sys;
      await sea.seaInput();                                                          // 1fd9:13c1 = 21151
      if (this.abort()) return;
      sys.timer.set(1);                                                              // 16a8(1)
      await sea.fleetsMove();                                                        // 1afe8
      if (palette.ending) return;
      await sea.heroMove();                                                          // 2e09:38ec = 3197c
      this.rt.time = (this.rt.time + 1) & 0xff;
      while (sys.timer.get()) await sys.poll();                                      // 16b5
      return;
    }
    if (!palette.invert) palette.setTarget(palette.T[["night", "dawn", "day", "dusk", "overcast"][palette.constructor.timeSlot(this.rt.time)]]);
    await palette.fadeToTarget();
    this.rt.time = (this.rt.time + await this.portScene.action()) & 0xff;            // 1bb07
    if (this.abort()) return;
    if (g.port !== GameConst.EMPTY_SLOT) this.portScene.redraw();                    // 1b1a3
    if (g.dailyFlags & 0x80) this.rt.time = 0x48;
    else if (!palette.invert) {
      const name = this.rt.time < 0x48 ? ["night", "dawn", "day", "dusk", "overcast"][palette.constructor.timeSlot(this.rt.time)] : "night";
      palette.setTarget(palette.T[name]);
    }
    palette.fadeState = 1;
  }
  // 1b2ba 一天
  async day() {
    const st = this.st, g = this.m.globals, { sys, palette } = this.c;
    if (g.port === GameConst.EMPTY_SLOT && !this.c.noEvents) {                       // 2e09:55c2(0xa0, 出港天數) → 2e09:5546
      const sc = (this.c.events ??= new Scenario(this.c)); sc.scene = this.portScene;
      if (await sc.check(ENV_HERO, 0xa0, st.u8(0x2e18))) { sys.mouseHide(); await sc.run(ENV_HERO); sys.mouseShow(); await palette.fadeToTarget(); }
    }
    let t = g.time;
    while (!this.c.palette.ending) {
      this.rt.time = t;
      if (t >= 0x48) break;
      if (g.time !== 0 || t % 12 === 0) await this.weather();
      await this.slot();
      if (this.abort()) return;
      for (; t < this.rt.time; t++) if (t < 0x46) await this.fleetDaily(t);
      if (!this.c.palette.ending && g.port === GameConst.EMPTY_SLOT) { await this.portScene.seaTick(); await this.portScene.discover(); }   // 6cfc / 2e09:2f3d
    }
    if (this.c.palette.ending) return;
    await this.dayEnd();                                                             // 19717
    for (t = 0; t < g.time; t++) if (t < 0x46) await this.fleetDaily(t);
  }
  // 19717 一天結束
  async dayEnd() {
    const st = this.st, m = this.m, g = m.globals;
    g.time = g.dailyFlags & 0x80 ? 0x18 : 0;
    g.weather &= 0x7f;
    g.dailyFlags = 0;
    st.set8(0x2e18, st.u8(0x2e18) + 1);
    await this.portScene.seaDaily();                                                 // 195d2 → 195b6 (只在海上)
    this.portsDaily();                                                               // 19648
    for (let i = 0; i < 30; i++) {                                                   // 196ef 酒吧女郎
      const bm = m.barmaid(i), v = bm.questDays; if (v !== GameConst.EMPTY_SLOT && v !== 0) bm.questDays = v - 1;
    }
    if (st.u8(0x10a6)) st.set8(0x10a6, st.u8(0x10a6) - 1);
    this.portScene.seaPanel();                                                       // 8067 (在港時不做任何事)
  }
  // 19648 各港每日: 支持度 >= 75 的國家取得該港; 所屬國支持度 < 75 時變成無所屬 (6);
  //   bit3 (待開發) 的港在商業價值 >= 150 時清除 bit3 並使 10 項物價各增加 min(random(5)+10, 100-值); [港+23] 倒數
  portsDaily() {
    const st = this.st, m = this.m, rng = this.c.sys.rng;
    for (let p = 0; p < 100; p++) {
      const port = m.port(p), eco = m.portEconomy(p);
      for (let i = 0; i < 6; i++) {
        const nat = port.region & 7;
        if (eco.getInfluence(i) >= 75) {
          if (nat !== i) {                                                           // 195d7
            port.region = (port.region & 0xf8) | i;
            if (eco.commerce < 150 && p > 41) port.region |= 8;
          }
        } else if (nat === i) port.region = (port.region & 0xf6) | 6;                // 19602
      }
      if ((port.region & 8) && eco.commerce >= 150) {                                // 1960d
        port.region &= 0xf7;
        for (let k = 0; k < 10; k++) { const v = eco.getPrices(k); eco.setPrices(k, v + Math.min(rng.random(5) + 10, (100 - v) & 0xffff)); }
      }
      const c = st.u8(eco.addr + 0x23); if (c !== GameConst.EMPTY_SLOT) st.set8(eco.addr + 0x23, c - Math.min(1, c));
    }
  }
  // 17546 後半 (1721f) + 1623a 主迴圈
  async run() {
    const { sys, palette, bgm } = this.c, st = this.st;
    this.c.portAssets ??= await loadPortAssets(this.c);
    this.portScene = new SeaScene(this.c, this.c.portAssets); this.portScene.clock = this;
    for (;;) {
      if (st.port !== 0xff) await this.portScene.enter();                            // 1721f: 8c53 進港
      else await this.portScene.enterSea();                                          //        851f 出海
      if (!(st.options & OptionFlag.BGM)) bgm.fadeOut();
      sys.mouseShow();
      await palette.fadeToTarget();
      await this.mainLoop();
      // 162c8: [03ea] ≠ 0 → 隱藏游標、淡出 (此時 99f2 因 [03ea] ≠ 0 不動作) → 1764f 結束處理 → 1757d 回到標題
      sys.mouseHide(); await palette.fadeBlack();
      if (!await this.ending(palette.ending)) return;
      // 1757d: 98f8 屬性暫存器恆等, [03d6] = 0 (游標顯示計數歸零) → 171a2(0) 標題 (重新載入初始狀態) → 1721f 進港
      sys.mouse.visible = 0;
      const r = await new Title(this.c).run(true);
      if (r !== 1 || this.c.halted) return;
      this.portScene = new SeaScene(this.c, this.c.portAssets); this.portScene.clock = this;
    }
  }
  // 1764f 結束處理 (RE_NOTES 30.13): 9888, 99f2 ([03ea] ≠ 0 時不動作), 清畫面, 游標 (0,0), ESC C7 ESC B0 →
  //   0x88 = 功能「結束遊戲」: [03ea] = 0, 清畫面 → 回到標題
  //   0x1? = 遊戲結束: 9670(0x14); 訊息 0 → 0x83f8 (1552 年, 不畫圖) / 8 → 0x3f6 (沉船) / 9 → 0x3f7 (船員全滅) / 0x0a → 0x3f5 (海戰戰敗);
  //          [03ea] = 0; GRAPH.DAT #0x3d + 74f7(0x12, 0xd8, 0x2c, 0xa8, 1) (或 74f7(0x12, 0x50, 0x2c, 0xd8, 1)), 訊息 (年 + 1、月、日、主角名、+0d、主角名、+0d),
  //          99e8 淡入 → 等待 → 99f2 → 796d → 清畫面 → 回到標題
  //   0x0? = 結局 (game/endgame.js; 正常只由劇本命令 F4 / 王宮直接呼叫, 不經 [03ea]); 其他 code: [bp-4] 未初始化 (原版怪行為), 正常遊戲不會走到
  async ending(code) {
    const { scr, con, palette, bgm, graph, win, message, menu } = this.c;
    const hi = code & 0xf0;
    if (hi === 0) await mainEnding(this.portScene, code);
    if (code !== 0x88 && hi !== 0x10) { clockTodo("結束處理 1764f(" + code.toString(16) + ")"); return false; }
    this.c.sfx?.off();                                                  // 9888
    await palette.fadeBlack();
    scr.wideRenderer = null;
    scr.wideDialog = null;
    scr.wideOverlays.length = 0;
    scr.clear(0);
    con.setCursor(0, 0); con.puts(Uint8Array.of(0x1b, 0x43, 0x37, 0x1b, 0x42, 0x30, 0));   // DS:a3d0
    let m = 0;
    if (hi === 0x10) { bgm.playSong(0x14); m = { 0: 0x83f8, 8: 0x3f6, 9: 0x3f7, 0x0a: 0x3f5 }[code & 0x0f] ?? 0; }
    palette.ending = 0;
    if (m) {
      const hero = this.m.heroPerson(), rt = this.rt;
      if (m & 0x8000) await win.open(0x12, 0x50, 0x2c, 0xd8, 1);
      else { graph.draw(0x3d, 0xb8, 0x20); await win.open(0x12, 0xd8, 0x2c, 0xa8, 1); }
      message(m & 0x7fff, (rt.year & 0xff) + 1, rt.month & 0xff, rt.day & 0xff, hero.givenNameBytes, hero.familyNameBytes, hero.givenNameBytes, hero.familyNameBytes);
      await palette.fadeToTarget();                                     // 99e8
      await menu.waitPrompt();                                          // 147ab
      await palette.fadeBlack();                                        // 99f2
      await win.close();                                                // 796d
    }
    scr.clear(0);
    return true;
  }
  // 1623a 主迴圈
  async mainLoop() {
    const { palette } = this.c, st = this.st;
    for (;;) {
      // 16173
      if (this.abort()) Object.assign(this.rt, { year: st.year, month: st.month, day: st.day, time: st.time });
      if (palette.ending) break;
      this.portScene.seaYear();                                                      // 71ad
      this.rt.month = st.month;
      while (this.rt.month < 12 && !palette.ending) {
        const days = this.daysInMonth();
        this.portScene.seaMonth();                                                   // 71c6
        this.rt.day = st.day;
        while (!palette.ending && this.rt.day < days) { this.portScene.seaDay(); await this.day(); this.rt.day++; }   // 71f0
        if (!palette.ending && !this.abort()) await this.monthly.monthEnd();                        // 18ff5
        this.rt.month++;
      }
      if (!palette.ending && !this.abort()) this.monthly.yearEnd();                                  // 16126
      if (palette.ending) break;
    }
  }
}
