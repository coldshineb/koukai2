// clock.js — 游戏主循环与时间推进 (MAIN.EXE 0FEA 段 1623a..162e1, 1b2ba, 1b1d2, 1a011, 1603c/16003; 1fd9:32c4)
// 时间: 年 [0532]  月 [0533] (0..11)  日 [0534]  时刻 [0535] (0..71, 每格 20 分钟); 存盘内的起点 [0caa..0cad]
// 每个时刻: 1a011 风向/天候 → 1b1d2 (港口: 调色盘 + 港口行动, 返回消耗的时刻) → 舰队 AI (每格处理一支舰队, 1ac19)
// 舰队 AI 1ac19 → game/fleetai.js、月末 18ff5 / 年末 16126 → game/monthly.js (docs/RE_NOTES.md 第 29 节)
// 海上部分 (出海 851f、海上时刻 1fd9:13c1 / 1afe8 / 2e09:38ec、海上移动 6cfc / 2e09:2f3d、每日 195b6、天候 19a99 / 19f48、剧本 2e09:55c2) → scenes/sea.js
import { loadPortAssets } from "../scenes/port.js";
import { SeaScene } from "../scenes/sea.js";
import { Scenario, ENV_HERO } from "./scenario.js";
import { Title } from "./title.js";
import { faFleet } from "./fleetai.js";
import { Monthly } from "./monthly.js";
import { mainEnding } from "./endgame.js";
import { GameConst, OptionFlag } from "../model/flags.ts";
import { hasDom, runDomStoryCard } from "../modern/dom_ui.ts";
import { hideDomBattleHud } from "../modern/dom_battle.ts";
import { captureConsoleText, toSimp } from "../canvas_ui/text_util.ts";

const clockWarned = new Set();
const clockTodo = name => { if (!clockWarned.has(name)) { clockWarned.add(name); console.warn("尚未移植: " + name); } };

export class GameClock {
  constructor(ctx) { this.c = ctx; }
  get st() { return this.c.state; }
  get m() { return this.c.state.model; }
  get rt() { return this.c.rt; }
  get monthly() { const ai = this.portScene.ai; return this.mon?.ai === ai ? this.mon : (this.mon = new Monthly(ai)); }
  // 1b2ba: [c2ea] = k、1ac19(舰队 k) — 测试时 ctx.noFleetAI (原版的 1ac19 改成直接返回) 两边都略过
  async fleetDaily(k) {
    if (this.c.noFleetAI) return;
    const ai = this.portScene.ai;
    ai.v.c2ea = k;
    await ai.daily(faFleet(k));
  }
  // 1b39a 中止标志 (月/日/时刻 >= F0)
  abort() { const r = this.rt; return r.month >= 0xf0 || r.day >= 0xf0 || r.time >= 0xf0; }
  // 16003 闰年: 原版只在 (1500+年) 同时被 4 与 100 整除且 %400==0 时才算闰年 (照搬)
  leap() { const y = this.rt.year + 0x5dc; return y % 4 === 0 && y % 100 === 0 ? (y % 400 === 0 ? 1 : 0) : 0; }
  // 1603c
  daysInMonth() { const d = this.c.portAssets.data.daysInMonth[this.rt.month]; return this.rt.month === 1 && this.leap() ? d + 1 : d; }
  // 1fd9:32c4 舰队所在海域的风向 ([0400]) 与海流 ([0404]); 各 30×15 格 (每格 = 3×3 个 24 单位)
  windAt(F) {
    const s16 = v => (v << 16) >> 16, st = this.st;
    const x = s16(st.u16(F)), y = s16(st.u16(F + 2));
    const k = Math.trunc(Math.trunc(y / 24) / 3) * 30 + Math.trunc(Math.trunc(x / 24) / 3);
    const W = this.c.portAssets.wind, off = this.c.windOffset ?? 0;
    return [W[(off + k) & 0xffff] ?? 0, W[0x384 + k] ?? 0];
  }
  // 1a011 风向与天候
  async weather() {
    const st = this.st, m = this.m, g = m.globals, rng = this.c.sys.rng;
    const F = m.fleet(m.heroPerson().fleet).addr;
    const [w0, w2] = this.windAt(F);
    let v;
    if (g.weather & 15) v = (g.portFlags & 0x3f) | (w0 & 0xc0);
    else {
      const sum = rng.random(2) + (w0 & 7), mn = sum > 7 ? 7 : sum;                   // seg0:4d7c 无号最小值
      const si = rng.random(3), a = rng.random(5);
      let al = ((a >> 2) * ((si - 1) & 0xff)) & 0xff;                                // mul cl (8 比特)
      al = (al << 3) & 0xff;
      al = ((al + (w0 & 0xf8)) & 0xff) & 0x38;
      v = (al + mn) & 0xff;
    }
    g.portFlags = v; st.set8(0x0cb2, w2);
    // 19ba1: 只做计算, 不改状态
    if (g.port === GameConst.EMPTY_SLOT) {
      const sea = this.portScene;
      if (g.weather & 15) { this.c.palette.selectTimePalette(this.rt.time, true, g.weather); this.c.palette.fadeState = 1; }   // 1976e, [a4aa] = 1
      if (g.weather & 15) await sea.weatherOngoing();                                // 19f48
      if (!(g.weather & 15)) await sea.weatherStart();                               // 19a99
    } else g.weather &= 0xf0;
  }
  // 1b1d2 一个时刻 (港口)
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
    if (g.port === GameConst.EMPTY_SLOT && !this.c.noEvents) {                       // 2e09:55c2(0xa0, 出港天数) → 2e09:5546
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
  // 19717 一天结束
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
    this.portScene.seaPanel();                                                       // 8067 (在港时不做任何事)
  }
  // 19648 各港每日: 支持度 >= 75 的国家取得该港; 所属国支持度 < 75 时变成无所属 (6);
  //   bit3 (待开发) 的港在商业价值 >= 150 时清除 bit3 并使 10 项物价各增加 min(random(5)+10, 100-值); [港+23] 倒数
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
  // 17546 后半 (1721f) + 1623a 主循环
  async run() {
    const { sys, palette, bgm } = this.c, st = this.st;
    this.c.portAssets ??= await loadPortAssets(this.c);
    this.portScene = new SeaScene(this.c, this.c.portAssets); this.portScene.clock = this;
    for (;;) {
      if (st.port !== 0xff) await this.portScene.enter();                            // 1721f: 8c53 进港
      else await this.portScene.enterSea();                                          //        851f 出海
      if (!(st.options & OptionFlag.BGM)) bgm.fadeOut();
      sys.mouseShow();
      await palette.fadeToTarget();
      await this.mainLoop();
      // 162c8: [03ea] ≠ 0 → 隐藏光标、淡出 (此时 99f2 因 [03ea] ≠ 0 不动作) → 1764f 结束处理 → 1757d 回到标题
      sys.mouseHide(); await palette.fadeBlack();
      if (!await this.ending(palette.ending)) return;
      // 1757d: 98f8 属性寄存器恒等, [03d6] = 0 (光标显示计数归零) → 171a2(0) 标题 (重新加载初始状态) → 1721f 进港
      sys.mouse.visible = 0;
      const r = await new Title(this.c).run(true);
      if (r !== 1 || this.c.halted) return;
      this.portScene = new SeaScene(this.c, this.c.portAssets); this.portScene.clock = this;
    }
  }
  // 1764f 结束处理 (RE_NOTES 30.13): 9888, 99f2 ([03ea] ≠ 0 时不动作), 清画面, 光标 (0,0), ESC C7 ESC B0 →
  //   0x88 = 功能「结束游戏」: [03ea] = 0, 清画面 → 回到标题
  //   0x1? = 游戏结束: 9670(0x14); 消息 0 → 0x83f8 (1552 年, 不画图) / 8 → 0x3f6 (沉船) / 9 → 0x3f7 (船员全灭) / 0x0a → 0x3f5 (海战战败);
  //          [03ea] = 0; GRAPH.DAT #0x3d + 74f7(0x12, 0xd8, 0x2c, 0xa8, 1) (或 74f7(0x12, 0x50, 0x2c, 0xd8, 1)), 消息 (年 + 1、月、日、主角名、+0d、主角名、+0d),
  //          99e8 淡入 → 等待 → 99f2 → 796d → 清画面 → 回到标题
  //   0x0? = 结局 (game/endgame.js; 正常只由剧本命令 F4 / 王宫直接调用, 不经 [03ea]); 其他 code: [bp-4] 未初始化 (原版怪行为), 正常游戏不会走到
  async ending(code) {
    const { scr, con, palette, bgm, graph, win, message, menu } = this.c;
    const hi = code & 0xf0;
    if (hi === 0) await mainEnding(this.portScene, code);
    if (code !== 0x88 && hi !== 0x10) { clockTodo("結束處理 1764f(" + code.toString(16) + ")"); return false; }
    this.c.sfx?.off();                                                  // 9888
    await palette.fadeBlack();
    scr.wideRenderer = null;
    scr._battleHudActive = false;
    scr._battleMsg = null;
    scr.wideDialog = null;
    scr.wideOverlays.length = 0;
    this.c.sys._battleViewport = null;
    hideDomBattleHud();
    scr.clear(0);
    con.setCursor(0, 0); con.puts(Uint8Array.of(0x1b, 0x43, 0x37, 0x1b, 0x42, 0x30, 0));   // DS:a3d0
    let m = 0;
    if (hi === 0x10) { bgm.playSong(0x14); m = { 0: 0x83f8, 8: 0x3f6, 9: 0x3f7, 0x0a: 0x3f5 }[code & 0x0f] ?? 0; }
    palette.ending = 0;
    if (m) {
      const hero = this.m.heroPerson(), rt = this.rt;
      if (hasDom() && this.c.codec) {
        const txt = toSimp(captureConsoleText(this.c, () =>
          message(m & 0x7fff, (rt.year & 0xff) + 1, rt.month & 0xff, rt.day & 0xff, hero.givenNameBytes, hero.familyNameBytes, hero.givenNameBytes, hero.familyNameBytes),
        ));
        await runDomStoryCard(this.c.art, (m & 0x8000) ? null : 0x3d, txt, "航海终结", "返回标题");
      } else {
        if (m & 0x8000) await win.open(0x12, 0x50, 0x2c, 0xd8, 1);
        else { graph.draw(0x3d, 0xb8, 0x20); await win.open(0x12, 0xd8, 0x2c, 0xa8, 1); }
        message(m & 0x7fff, (rt.year & 0xff) + 1, rt.month & 0xff, rt.day & 0xff, hero.givenNameBytes, hero.familyNameBytes, hero.givenNameBytes, hero.familyNameBytes);
        await palette.fadeToTarget();                                     // 99e8
        await menu.waitPrompt();                                          // 147ab
        await palette.fadeBlack();                                        // 99f2
        await win.close();                                                // 796d
      }
    }
    scr.clear(0);
    return true;
  }
  // 1623a 主循环
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
