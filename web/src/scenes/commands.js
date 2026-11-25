// commands.js — 港口画面右侧 4 个指令按钮 (MAIN.EXE 0FEA:1b8c8 → DS:a642 远程函数表) 与其在港内可用的子功能
//   按钮 8..11: 情报 1fd9:0e33 (线性 20bc3) / 经营 1fd9:0fdc (20d6c) / 命令 1fd9:10a8 (20e38) / 航海术 1fd9:119e (20f2e)
//   (1b8c8 以 DS:[a622 + di×4] 取函数, di = 8..11, 所以表其实在 DS:a642; a622 起是建筑处理表 a612 的第 4 项)
//   分析: tools/re/commands.py → tools/work/re_cmd_*.txt; 常数: tools/extract_commands.py → assets/data/commands.json
//   结论与未移植部分: docs/RE_NOTES.md 第 26 节
// 共用:
//   1b8c8   按下按钮: 隐藏光标 → seg0:9396(n) 按钮凹下图 → 处理函数 → seg0:937e(n) 还原 → 显示光标
//   20b0c   右侧菜单: 0fea:44c4 = 14364 带阴影直式菜单, x = 0x4a − 最长项目字数, 可取消; [a158] = 项目数
//   20b40   结束时重画地图窗口 (2103 + 1fac, 主角不重画) → 99e8 淡入 → 清键盘缓冲
import { Buildings } from "./buildings.js";
import { Title } from "../game/title.js";
import { PortMove } from "./portmove.js";
import { DS, OFF } from "../model/schema_views.ts";
import { WorkDS } from "../model/flags.ts";

const cmHex = s => { const b = Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16))), o = new Uint8Array(b.length + 1); o.set(b); return o; };
const cmStrlen = s => { let n = 0; while (n < s.length && s[n]) n++; return n; };
const cmUmin = (a, b) => ((a & 0xffff) > (b & 0xffff) ? b & 0xffff : a & 0xffff);     // seg0:4d7c (无号)
const cmWarned = new Set();
const cmTodo = n => { if (!cmWarned.has(n)) { cmWarned.add(n); console.warn("尚未移植: " + n); } };

export class Commands {
  constructor(scene) {
    this.p = scene; this.c = scene.c;
    const J = scene.P.commands;                                         // assets/data/commands.json
    this.S = Object.fromEntries(Object.entries(J.str).map(([k, v]) => [k, cmHex(v)]));
    const D = scene.P.data, h = a => a.map(cmHex);                     // port.json 的共用表 + commands.json 的表
    this.T = { ...J.tab, cannons: h(D.build.cannons), skills: h(J.ptr.skills) };
    this.c.persons ??= new Array(0x50).fill(0);
    this.c.barColors ??= [0, 0];                                       // DS:bafa / bafc (BSS 初值 0, seg0:9376 设置)
  }
  get st() { return this.c.state; }
  get b() { return this.p.buildings ??= new Buildings(this.p); }
  get rt() { return this.c.rt; }

  // ================= 1b8c8 后半: 指令按钮 n (0..3) =================
  async button(n) {
    const { sys } = this.c;
    sys.mouseHide();
    this.press(n);                                                     // seg0:9396
    switch (n) {
      case 0: await this.info(); break;
      case 1: await this.manage(); break;
      case 2: await this.order(); break;
      case 3: await this.nav(); break;
    }
    this.release(n);                                                   // seg0:937e
    sys.mouseShow();
  }
  // seg0:9396 按钮凹下: 先以 2929 保存 (0x4d 栏, y = 0x48 + 0x50n) 3 栏 × 0x50 行 4 平面;
  //   动画效果开: TRANSIT.DAT 0x4b00 + 0x2d0n 的 0x2d0 bytes 以 seg0:055e (044d 模式 0: 每栏 3 bytes = 平面 0..2, 平面 3 不动) 粘贴
  //   关: seg0:063e 以 [0c86]+0 (全 FF) 模式 0x107 (XOR 色 7) 反白
  press(n) {
    const { scr, gfx } = this.c, y = 0x48 + 0x50 * n, fb = scr.fb;
    this.pressSave = new Uint8Array(24 * 0x50);
    for (let r = 0; r < 0x50; r++) this.pressSave.set(fb.subarray((y + r) * 640 + 0x4d * 8, (y + r) * 640 + 0x50 * 8), r * 24);
    if (this.st.options & 1) {
      const src = this.p.P.transit, o = 0x4b00 + 0x2d0 * n;
      for (let r = 0; r < 0x50; r++) for (let c = 0; c < 3; c++) {
        const k = o + (r * 3 + c) * 3, p0 = src[k], p1 = src[k + 1], p2 = src[k + 2];
        for (let i = 0; i < 8; i++) {
          const sh = 7 - i, a = (y + r) * 640 + (0x4d + c) * 8 + i;
          fb[a] = (fb[a] & 8) | ((p0 >> sh) & 1) | (((p1 >> sh) & 1) << 1) | (((p2 >> sh) & 1) << 2);
        }
      }
      scr.dirty = true;
    } else scr.glyphMode(0x4d, y, 3, 0x50, gfx.subarray(0), 0x107);
  }
  // seg0:937e 还原 (2997)
  release(n) {
    const { scr } = this.c, y = 0x48 + 0x50 * n;
    if (!this.pressSave) return;
    for (let r = 0; r < 0x50; r++) scr.fb.set(this.pressSave.subarray(r * 24, r * 24 + 24), (y + r) * 640 + 0x4d * 8);
    scr.dirty = true;
  }
  // 20b0c 右侧菜单 (y, 项目)
  async popMenu(y, items) {
    const m = this.c.menu;
    m.count = items.length;                                            // [a158]
    let w = 0; for (const s of items) w = Math.max(w, cmStrlen(s));    // 13847
    return m.listMenu(0x4a - w, y, items, 1);
  }
  // 20b40 重画地图窗口 (不画主角) → 淡入 → 清键盘
  async redrawMap() {
    const p = this.p;
    p.clearCache(); p.drawMap();
    await this.c.palette.fadeToTarget();
    this.c.sys.flush();
  }
  // 1721f 依目前位置重新进入港口 (8c53) 或海上 (851f)
  async reenter() {
    if (this.st.port !== 0xff) await this.p.enter(); else await this.p.enterSea();
  }
  // 1b39a 时间循环中止标志
  abort() { const r = this.rt; return r.month >= 0xf0 || r.day >= 0xf0 || r.time >= 0xf0; }
  // 小消息窗口 294bf: 7849(0x12, 0x30, 0x1c, 0x60)
  smallWin() { this.c.win.shadowedSaved(0x12, 0x30, 0x1c, 0x60, 0); }
  async waitClose() { await this.c.menu.waitPrompt(); await this.c.win.close(); }   // 0fea:490b + 796d

  // ================= 情报 1fd9:0e33 (20bc3) =================
  // MENU #0x1a (自舰队/舰船/人物/主公/积载情报/积载一览表/发现物/航海图/航海日志/海港地图) 于 y=0x30
  // 禁用: 没有船 → 0,1,4,5; 有船但都没载货 (20b6a, 只在进入时算一次) → 4,5; [100e] = 0 → 7; 日志 [0c8e] 首字 = FFFF → 8; 海上 → 9;
  //   没有「已知且已发现」的发现物 → 6。海港地图与取消后结束, 其他回到菜单
  async info() {
    const st = this.st, { menu, palette } = this.c, items = this.c.menuItems(0x1a).slice(0, 10), b = this.b, p = this.p;
    const cargo = this.anyCargo();
    let di = 0;
    do {
      if (!b.fleetShips()) menu.disabled |= 0x33; else if (!cargo) menu.disabled |= 0x30;
      if (!st.u16(WorkDS.EXPLORE_TOTAL)) menu.disabled |= 0x80;
      if (st.u16(DS.TRADE_LOGS) === 0xffff) menu.disabled |= 0x100;
      if (st.port === 0xff) menu.disabled |= 0x200;
      if (!this.discList(1)) menu.disabled |= 0x40;
      const r = await this.popMenu(0x30, items);
      switch (r) {
        case 0: if (await this.fleetInfo()) await this.reenter(); break;          // 0fea:d7be = 1d65e
        case 1:                                                                    // 0fea:d7e8 = 1d688
          await this.shipInfos();
          await palette.fadeBlack(); p.clearCache(); p.drawMap();
          palette.selectTimePalette(this.rt.time, st.port === 0xff, st.weather); await palette.fadeToTarget();
          break;
        case 2: await this.personInfos(); p.clearCache(); p.drawMap(); break;     // 0fea:d81f = 1d6bf
        case 3: await this.lordInfo(); p.clearCache(); p.drawMap(); break;         // 0fea:d843 = 1cc11
        case 4: await this.cargoInfos(); break;                                    // 0fea:d848 = 1d6e8
        case 5: await this.cargoList(); break;                                     // 0fea:d866 = 1cf02
        case 6: await this.discInfos(); break;                                     // 0fea:d86b = 1d084
        case 7: await p.chart(); break;                                            // 0fea:dc2e = 1dace (scenes/sea.js)
        case 8: await this.logBook(); break;                                       // 0fea:e47e = 1e31e
        case 9: await this.portMap(); di = 1; break;                               // 0fea:e10f = 1dfaf
        default: di = 1;
      }
    } while (!di);
    await this.redrawMap();                                                        // 20b40
  }
  // 20b6a 舰队中有船且载有商品 (+16..+1a ≠ FF) 的船位
  anyCargo() {
    const st = this.st, b = this.b;
    for (let i = 0; i < 10; i++) {
      if ((st.u8(b.fleetSlot(i) + 8) & 0x30) !== 0x10) continue;
      for (let k = 0; k < 5; k++) if (st.u8(b.crewData(i) + 0x16 + k) !== 0xff) return 1;
    }
    return 0;
  }
  // 发现物 (DS:7f8c + 7×i, 100 笔): +6 bit7 = 0 且 bit6、bit5 = 1; first = 1 时只判断有无 (20bc3), 否则列入 [0538] (1d084)
  discList(first) {
    const st = this.st, P = this.c.persons; let n = 0;
    for (let i = 0; i < 100; i++) {
      const f = st.u8(DS.TBL_DISCOVERY + i * 7 + 6);
      if (!(f & 0x80) && (f & 0x40) && (f & 0x20)) { if (first) return 1; P[n++] = i; }
    }
    return n;
  }
  // ---- 0 自舰队情报 1d65e → 1d0e8(主角舰队): 返回 1 时重新进港 (8c53) ----
  async fleetInfo() {
    const st = this.st, { sys } = this.c;
    if (!this.b.fleetShips()) return 0;
    sys.mouseHide();
    await this.fleetView(st.u8(st.personRecord(st.hero) + 0x2c));
    sys.mouseShow();
    return 1;
  }
  // 1d0e8 舰队一览: 全画面 [0c86]+0x2ba0 底纹 → 各船图 (seg0:8050, 位置 DS:a7a4) → 下方数据框: 提督头像、0x397..0x399、
  //   最慢的船 (速度计算同 1c0a8 但风向表 DS:06d8) 的 +4/+5 与 总水手、总砲数、最低耐久、总战力 (0x39a..0x39c)
  async fleetView(f) {
    const st = this.st, { scr, gfx, graph, con, message, palette } = this.c, b = this.b, T = this.T;
    const F = DS.TBL_FLEET + f * 0x85, hero = st.u8(st.personRecord(st.hero) + 0x2c) === f;
    await palette.fadeBlack();
    for (let c = 0; c < 0x28; c++) for (let r = 0; r < 0x14; r++) scr.putPlanar(c * 2, r << 4, 2, 0x10, gfx, 0x2ba0);
    let cnt = 0;
    for (let i = 0; i < 10; i++) {
      const S = F + OFF.FLEET.SHIPS + i * 9;
      if ((st.u8(S + OFF.DOCK_SLOT.FLAGS) & 0x30) !== 0x10) continue;
      graph.draw(st.u8(DS.TBL_SHIP + st.u8(S + OFF.DOCK_SLOT.SHIP) * 0x16 + 0x0f) + 0x1c, T.fleetPos[cnt * 2] << 3, T.fleetPos[cnt * 2 + 1] << 4);   // seg0:8050
      cnt++;
    }
    if (!cnt) {
      await this.c.win.open(0x14, 0x80, 0x1e, 0x60, 0);
      con.puts(this.S.fvColor); con.setCursor(0x16, 0x90); message(0x396); await this.waitClose();
      return;
    }
    scr.fillCols(0, 0x130, 0x50, 0x60, 0);
    scr.fillRectPxPlanes(1, 0x131, 0x27e, 0x18e, 0x0d, 4);
    scr.fillRectPxPlanes(2, 0x132, 0x27d, 0x18d, 0x0e, 4);
    scr.fillRectPxPlanes(3, 0x133, 0x27c, 0x18c, 0x0a, 4);
    scr.fillRectPxPlanes(4, 0x134, 0x27b, 0x18b, 0x00, 4);
    scr.fillRectPxPlanes(5, 0x135, 0xd7, 0x18a, 0x08, 4);
    const A = st.personRecord(st.u8(F + OFF.FLEET.ADMIRAL));
    scr.fillCols(1, 0x138, 8, 0x50, 0);
    this.c.kao.drawPerson(scr, st.bytes(A, 0x32), 1, 0x138);             // seg0:7d39
    con.setCursor(0x0b, 0x140); message(0x397, st.cstr(A));
    con.setCursor(0x0b, 0x160); message(0x398, st.u8(A + OFF.PERSON.NAV_LEVEL));
    con.setCursor(0x0b, 0x178); message(0x399, st.u8(A + OFF.PERSON.BATTLE_LEVEL));
    const s16 = v => (v << 16) >> 16;
    const wind = Math.abs(((st.u8(DS.PORT_FLAGS) & 0x38) >> 3) - st.u8(F + OFF.FLEET.DIR)) & 0xff, WT = T.windSpeed, wbase = wind << 3;
    let best = 10000, slow = F + OFF.FLEET.SHIPS, sumSail = 0, sumMax = 0, sumGuns = 0, sumX = 0, minDur = 100;
    for (let i = 0; i < 10; i++) {
      const S = F + OFF.FLEET.SHIPS + i * 9;
      if ((st.u8(S + OFF.DOCK_SLOT.FLAGS) & 0x30) !== 0x10) continue;
      const ship = DS.TBL_SHIP + st.u8(S + OFF.DOCK_SLOT.SHIP) * 0x16, t = st.u8(ship + 0x0f), TR = DS.TBL_SHIP_TYPE + t * 0x0c;
      const minS = st.u8(TR + 5), sail = s16(st.u16(S));
      sumSail = (sumSail + st.u16(S)) & 0xffff; sumMax = (sumMax + st.u16(ship + 0x12)) & 0xffff;
      let r8, r9, w, cap;
      if (hero) { const M = b.crewData(i); r8 = st.u8(M + OFF.CREW_SLOT.NAV_RATIO); r9 = st.u8(M + OFF.CREW_SLOT.LOOK_RATIO); w = s16(st.u16(M + OFF.CREW_SLOT.LOAD_TOTAL)); cap = st.u8(M + OFF.CREW_SLOT.CAPTAIN); }
      else { r8 = 0x19; r9 = 0x32; w = Math.trunc(s16(st.u16(TR + 6)) / 2); cap = st.u8(F + OFF.FLEET.ADMIRAL); }
      const maxw = s16(st.u16(TR + 6)), s5 = st.u8(S + OFF.DOCK_SLOT.PROPULSION), CP = st.personRecord(cap), pc = st.u8(CP + 0x24), pd = st.u8(CP + 0x1d);
      sumGuns = (sumGuns + st.u8(S + OFF.DOCK_SLOT.GUNS)) & 0xffff;
      const deck = cmUmin(300, Math.trunc(s16((100 - r9 - r8) * sail) / 100) & 0xffff);
      const k = st.u8(S + OFF.DOCK_SLOT.FLAGS) & 7, g = Math.trunc((cmUmin(st.u8(S + OFF.DOCK_SLOT.GUNS), deck) * ((2 * T.gunA[k] + T.gunB[k]) & 0xffff)) / 10) & 0xffff;
      sumX = (sumX + 2 * st.u8(S + OFF.DOCK_SLOT.DURABILITY) + g + deck) & 0xffff;
      const di2 = s16(WT[wbase + t] * s5);
      const q = cmUmin(100, Math.trunc((r9 * sail) / minS) & 0xffff);
      const c = cmUmin(150, (180 - cmUmin(180, Math.trunc(s16(100 * w) / maxw) & 0xffff)) & 0xffff);
      const x = Math.trunc(s16(q * di2) / 100) & 0xffff;
      const di3 = Math.trunc(((x * c) >>> 0) / 100) & 0xffff;
      const v = cmUmin(30, (Math.trunc(s16(di3 * pc) / 10) + di3) & 0xffff);
      const sp = cmUmin(40, Math.trunc(s16(v * pd) / 75) & 0xffff);
      if (sp < best) { best = sp; slow = S; }
      if (st.u8(S + OFF.DOCK_SLOT.DURABILITY) < minDur) minDur = st.u8(S + OFF.DOCK_SLOT.DURABILITY);
    }
    con.setCursor(0x1d, 0x140); message(0x39a, st.u8(slow + 4), sumSail);
    con.setCursor(0x1d, 0x158); message(0x39b, st.u8(slow + 5), sumGuns);
    con.setCursor(0x1d, 0x170); message(0x39c, minDur, sumX);
    palette.setTarget(palette.table("ships")); await palette.fadeToTarget();
    await this.c.menu.waitPrompt();
  }
  // 1d607 舰队的船 (清单 0x80), FF = 取消或没有船
  async pickShip() {
    const n = this.b.fleetShips(); if (!n) return 0xff;
    const r = await this.b.listSel().select(0x80, n);
    return r === -1 ? 0xff : this.c.persons[r];
  }
  // ---- 1 舰船情报 1d688: 舰船调色盘 (DS:a730), 8dfd(1) 底纹, 淡入; 反复选船 → 1c1a3(船位, 0x0f) ----
  async shipInfos() {
    const { palette } = this.c;
    palette.setTarget(palette.table("ships"));
    this.p.wallpaper(1);
    await palette.fadeToTarget();
    for (;;) { const s = await this.pickShip(); if (s === 0xff) break; this.shipInfo(s, 0x0f); }
  }
  // 1c1a3 船只详细数据 (栏 x): 7358(x,0x20,0x29,0x150) 船图 / 船首像 (TRANSIT.DAT 0x1980 + 0x480×n) / 补给 2×2 (图 [0c86]+0x20d0) /
  //   船级、0x374/0x375/0x377 砲 (DS:07cc)/0x378/0x379/0x37a 人数/0x37b/0x37c 载重比例 (>79 色 2, >30 色 4)/0x37e 速度 /
  //   MENU #0x29 七项 「目前 / 最大」 与长条 (seg0:90c0 / 91a1)
  shipInfo(slot, x) {
    const st = this.st, { scr, gfx, graph, con, printf, message, win } = this.c, b = this.b, S0 = this.S, T = this.T;
    const lab = this.c.menuItems(0x29);
    const S = b.fleetSlot(slot), M = b.crewData(slot), cap = st.personRecord(st.u8(M + OFF.CREW_SLOT.CAPTAIN)), ship = DS.TBL_SHIP + st.u8(S + OFF.DOCK_SLOT.SHIP) * 0x16;
    const TR = DS.TBL_SHIP_TYPE + st.u8(ship + 0x0f) * 0x0c, tmpl = DS.TBL_SHIP + (st.u8(ship + 0x0f) + 0x28) * 0x16, s16 = v => (v << 16) >> 16;
    const sup = [Math.trunc(s16(st.u16(M)) / 10), Math.trunc(s16(st.u16(M + OFF.CREW_SLOT.FOOD)) / 10), s16(st.u16(M + OFF.CREW_SLOT.MATERIAL)), s16(st.u16(M + OFF.CREW_SLOT.AMMO))];
    const cur = [st.u8(S + OFF.DOCK_SLOT.DURABILITY), st.u8(S + OFF.DOCK_SLOT.TURN), st.u8(S + OFF.DOCK_SLOT.PROPULSION), st.u16(S), st.u8(M + OFF.CREW_SLOT.MORALE), this.c.cargoUsed(slot), (this.c.cargoUsed(slot) + st.u8(S + OFF.DOCK_SLOT.GUNS) + st.u16(S)) & 0xffff];   // 5d36 / 5d8b
    const max = [st.u8(S + OFF.DOCK_SLOT.MAX_DURABILITY), st.u8(TR + 2), st.u8(TR + 3), st.u16(ship + 0x12), 100, st.u16(ship + 0x14), st.u16(TR + 6)];
    win.frame(x, 0x20, 0x29, 0x150, 0);
    graph.draw(st.u8(ship + 0x0f) + 0x1c, (x + 2) << 3, 0x30);           // seg0:8050
    con.puts(S0.siColor);
    const fh = st.u8(M + OFF.CREW_SLOT.FIGUREHEAD);
    if (fh) scr.putPlanar(x + 0x13, 0x30, 6, 0x30, this.p.P.transit, 0x1980 + 0x480 * fh);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
      scr.putPlanar(c * 7 + x + 0x1a, r * 0x28 + 0x30, 2, 0x20, gfx, 0x20d0 + ((2 * r + c) << 8));
      con.setCursor((c + 4) * 7 + x, r * 0x28 + 0x40); printf(S0.n4, sup[2 * r + c]);
    }
    scr.fillCols(x + 0x14, 0x80, 1, 0xe0, 2);
    con.left = x + 2; con.setCursor(con.left, 0x98); printf(S0.siClass, st.cstr(tmpl));
    con.setCursor(con.left, 0xa8); message(0x374, st.cstr(ship)); message(0x375, st.cstr(cap)); message(0x377, T.cannons[st.u8(S + OFF.DOCK_SLOT.FLAGS) & 7]);
    con.left++; con.setCursor(con.left, 0xea);
    if (st.u8(S + OFF.DOCK_SLOT.FLAGS) & 7) message(0x378, st.u8(S + OFF.DOCK_SLOT.GUNS), st.u8(ship + 0x11), s16(T.gunW[st.u8(S + OFF.DOCK_SLOT.FLAGS) & 7] * st.u8(S + OFF.DOCK_SLOT.GUNS)));
    con.left--; con.setCursor(con.left, 0x100); message(0x379);
    const s0 = st.u16(S), a = Math.trunc(((st.u8(M + OFF.CREW_SLOT.LOOK_RATIO) * s0) >>> 0) / 100) & 0xffff, bb = Math.trunc(((st.u8(M + OFF.CREW_SLOT.NAV_RATIO) * s0) >>> 0) / 100) & 0xffff;
    con.setCursor(con.left, 0x112); message(0x37a, a, bb, (s0 - a - bb) & 0xffff);
    con.setCursor(con.left, 0x128); message(0x37b, st.u8(TR + 5));
    con.left += 2; con.setCursor(con.left, 0x13a); message(0x37c);
    const pct = Math.trunc((100 * cur[6]) / (s16(max[6]) || 1)) & 0xffff;
    if (pct > 0x4f) con.puts(S0.siHi); else if (pct > 0x1e) con.puts(S0.siMid);
    message(0x37d, pct);
    con.setCursor(con.left, 0x14c); message(0x37e, (b.shipSpeed(slot) + 1) >> 1);
    this.c.barColors = [2, 1];                                          // seg0:9376(2, 1)
    for (let i = 0; i < 7; i++) {
      con.setCursor(x + 0x16, (i + 4) << 5); message(0x37f, lab[i], cur[i], max[i]);
      this.barFrame(x + 0x18, (i << 5) + 0x94, 1);
      this.bar(x + 0x18, (i << 5) + 0x94, Math.trunc((100 * cur[i]) / (s16(max[i]) || 1)), 1);
    }
  }
  // ---- 2 人物情报 1d6bf: 反复 清单 0x86 (主角 + 船员, 12d8c) → 1c839(人物, 0x0f, 1) ----
  async personInfos() {
    for (;;) {
      const n = this.b.captainPool();
      const r = await this.b.listSel().select(0x86, n);
      if (r === -1) break;
      this.personInfo(this.c.persons[r], 0x0f, 1);
    }
  }
  // 1c839 人物数据 (栏 x, mode ≠ 0 时加上 所乘的船、职务、爵位 / 酬金): 头像 7d39、0x381 姓名、0x382 年龄、
  //   能力 7 项 (DS:08f6「%-6s%3d」与 9216 / 92f7)、0x386..0x38a、技能 5 项 (DS:08ec, +30 bit (0x10>>i) 为 ○)
  personInfo(n, x, mode) {
    const st = this.st, { scr, con, printf, message, kao, win } = this.c, b = this.b, S0 = this.S, T = this.T;
    const P = st.personRecord(n), H = DS.TBL_HERO_DATA + st.hero * 0x0e, isHero = n === st.hero;
    const xs = [0x0e, 0x13, 0x1c, 0x21, 0x0e], ys = [0x118, 0x118, 0x118, 0x118, 0x130];
    let si7 = 0, shipR = 0;
    if (mode) {
      si7 = 0xff; let found = 0;
      for (let i = 0; i < 10; i++) {
        if ((st.u8(b.fleetSlot(i) + 8) & 0x30) !== 0x10) continue;
        const c = st.u8(b.crewData(i) + 0x1b);
        if (c === n) { found = 1; si7 = i; }
        if (!found && c === st.hero) si7 = i;
      }
      if (si7 !== 0xff) shipR = DS.TBL_SHIP + st.u8(b.fleetSlot(si7) + 7) * 0x16;
    }
    win.frame(x, 0x20, 0x28, 0x160, 0);
    kao.drawPerson(scr, st.bytes(P, 0x32), x + 2, 0x30);
    scr.fillCols(x + 0x0c, 0x90, 1, 0xe0, 2);
    con.left = x + 0x0b; con.setCursor(con.left, 0x30); con.puts(S0.piColor);
    if (mode) {
      if (si7 !== 0xff) message(0x39d, st.cstr(shipR));
      message(0x380, b.T.crewRoles[st.u8(P + 0x2e)]);
    }
    message(0x381, st.cstr(P), st.cstr(P + 0x0d));
    message(0x382, st.u8(P + 0x2a));
    this.c.barColors = [2, 1];
    for (let i = 0; i < 7; i++) {
      con.setCursor(x + 2, (i << 5) + 0x90); printf(S0.piStat, b.T.stats[i], st.u8(P + 0x1c + i));
      this.barFrame(x + 2, (i << 5) + 0xa4); this.bar(x + 2, (i << 5) + 0xa4, st.u8(P + 0x1c + i));
    }
    con.left = x + 0x0e; con.setCursor(con.left, 0x90);
    if (mode) {
      if (isHero) {
        message(0x383);
        const ti = st.u8(H + OFF.PERSON.FAMILY_NAME);
        if (ti) printf(S0.piTitle, st.hero === 5 ? b.T.ottomanTitles[ti] : b.T.titles[ti]); else message(0x384);
      } else for (let i = 0; i < 0x1e; i++) if (st.u8(DS.PARTY_CREW + i) === n) message(0x385, 10 * st.u8(0x2e39 + i));
    }
    message(0x386, st.u8(P + 0x24));
    con.left += 6; con.setCursor(con.left, -1); message(0x387, st.u16(P + 0x26));
    con.left -= 6; con.setCursor(con.left, -1); message(0x388, st.u8(P + 0x25));
    con.left += 6; con.setCursor(con.left, -1); message(0x389, st.u16(P + 0x28));
    con.left -= 6; con.setCursor(con.left, -1); message(0x38a, this.p.nations[st.u8(P + 0x31) & 0x0f]);
    message(0x38b);
    for (let i = 0; i < 5; i++) {
      message(0x38c);
      if (st.u8(P + 0x30) & (0x10 >> i)) message(0x38d);
      con.setCursor(xs[i] + x, ys[i] + 0x20); message(0x380, T.skills[i]);
    }
    message(0x38c);
  }
  // ---- 3 主公情报 1cc11: 7358(0x0f,0x20,0x1f,0xa8) 金币 (%10000) / 金块 (/10000)、MENU #0x2a 三种声望、6 国友好度 (−100 → 0x394 + 绝对值) ----
  async lordInfo() {
    const st = this.st, { con, printf, message, win } = this.c, lab = this.c.menuItems(0x2a), H = DS.TBL_HERO_DATA + st.hero * 0x0e;
    const money = (st.u16(DS.MONEY) | (st.u16(0x12b0) << 16)) | 0;
    win.frame(0x0f, 0x20, 0x1f, 0xa8, 0);
    con.setCursor(0x11, 0x30); message(0x38e);
    con.setCursor(0x11, 0x48); message(0x38f, money % 10000);            // seg0:37ee 有号长整数余数
    con.setCursor(0x11, 0x58); message(0x390, Math.trunc(money / 10000));
    con.setCursor(0x11, 0x70); message(0x391);
    for (let i = 0; i < 3; i++) { con.setCursor(0x11, (i << 4) + 0x88); message(0x392, lab[i], st.u16(H + 2 * i)); }
    for (let i = 0; i < 6; i++) {
      con.setCursor(0x1c, (i << 4) + 0x48); message(0x393, this.p.nations[i]);
      const v = st.u8(H + 6 + i);
      if (v < 100) message(0x394);
      printf(this.S.n3, Math.abs(v - 100));
    }
    await this.c.menu.waitPrompt();
  }
  // ---- 4 积载情报 1d6e8: 反复选船 → 1cd6c (没有商品的船什么都不显示) ----
  async cargoInfos() {
    for (;;) { const s = await this.pickShip(); if (s === 0xff) break; await this.cargoInfo(s); }
  }
  // 1cd6c 74f7(0x0f,0x20,0x14,0x90,0): 0x374 船名, 每种商品 0x395 (名称 DS:0728, 数量 +0c)
  async cargoInfo(slot) {
    const st = this.st, { con, message, win } = this.c, M = this.b.crewData(slot);
    let any = 0; for (let k = 0; k < 5; k++) if (st.u8(M + OFF.CREW_SLOT.CARGO_GOODS + k) !== 0xff) any = 1;
    if (!any) return;
    const ship = DS.TBL_SHIP + st.u8(this.b.fleetSlot(slot) + 7) * 0x16;
    await win.open(0x0f, 0x20, 0x14, 0x90, 0);
    con.setCursor(0x11, 0x28); message(0x374, st.cstr(ship));
    let y = 0;
    for (let k = 0; k < 5; k++) {
      const g = st.u8(M + OFF.CREW_SLOT.CARGO_GOODS + k); if (g === 0xff) continue;
      con.setCursor(0x11, y + 0x50); message(0x395, this.p.goods[g], st.u16(M + OFF.CREW_SLOT.CARGO_AMTS + 2 * k)); y += 0x10;
    }
    await this.waitClose();
  }
  // ---- 5 积载一览表 1cf02: 各商品总数 ([0538 + 0x32×2 + 商品×2]) → 清单 0x81 → 1ce45 最高价港口:
  //   主角 +30 bit1 → 主角说 0x350; 否则每位会计 (职务 4) 各说一次: +30 bit1 → 0x351 (港名), 否则 0x352 ----
  async cargoList() {
    const st = this.st, { message } = this.c, b = this.b, P = this.c.persons;
    for (let i = 0x32; i < 0x64; i++) P[i] = 0;
    let k = 0;
    for (let i = 0; i < 10; i++) {
      if ((st.u8(b.fleetSlot(i) + 8) & 0x30) !== 0x10) continue;
      const M = b.crewData(i);
      for (let j = 0; j < 5; j++) {
        const g = st.u8(M + OFF.CREW_SLOT.CARGO_GOODS + j); if (g === 0xff) continue;
        if (!P[0x32 + g]) P[k++] = g;
        P[0x32 + g] = (P[0x32 + g] + st.u16(M + OFF.CREW_SLOT.CARGO_AMTS + 2 * j)) & 0xffff;
      }
    }
    if (!k) return;
    const r = await b.listSel().select(0x81, k);
    if (r === -1) return;
    const g = P[r], R = DS.TBL_PORT + this.bestPort(g) * 0x16, hero = st.personRecord(st.hero);
    if (st.u8(hero + 0x30) & 2) { b.talkPerson(st.hero); message(0x350, this.p.goods[g], st.cstr(R + OFF.PORT.NAME)); await this.waitClose(); return; }
    for (let i = 0; i < 0x1e; i++) {
      const c = st.u8(DS.PARTY_CREW + i); if (c === 0xff) continue;
      const C = st.personRecord(c); if (st.u8(C + 0x2e) !== 4) continue;
      b.talkPerson(c);
      if (st.u8(C + 0x30) & 2) message(0x351, this.p.goods[g], st.cstr(R + OFF.PORT.NAME)); else message(0x352, this.p.goods[g]);
      await this.waitClose();
    }
  }
  // 1ce45 商品 g 卖价最高的港口 (+15 bit6 的港才算): 特产港 (+1a = g) = (分类物价 + 50) × +18 / 200, 其他 = (分类物价 + 50) × 地区价 / 100
  bestPort(g) {
    const st = this.st, cats = this.T.goodsCat; let best = 0, port = 0;
    let cat = 0; while (cat < 10 && !(cats[cat] > g)) cat++; if (cat >= 10) cat = 0;     // 1fd9:468e = 2441e
    for (let p = 0; p < 100; p++) {
      const R = DS.TBL_PORT + p * 0x16, E = DS.TBL_PORT_ECONOMY + p * 0x25, pr = st.u8(E + 0x0e + cat) + 0x32, s16 = v => (v << 16) >> 16;
      const v = st.u8(E + 0x1a) === g ? s16(Math.trunc(pr * s16(st.u16(E + 0x18)) / 200))                         // seg0:3722
        : s16(Math.trunc(pr * s16(st.u16(DS.TBL_REGION_PRICE + st.u8(E + 0x21) * 0x80 + 2 * g)) / 100));                         // seg0:5cba 地区价
      if (v > best && (st.u8(R + OFF.PORT.REGION) & 0x40)) { best = v; port = p; }
    }
    return port;
  }
  // ---- 6 发现物情报 1d084: 清单 0x92 → 2e09:681c 发现物数据 (buildings.discInfo), 直到 Esc ----
  async discInfos() {
    for (;;) {
      const n = this.discList(0);
      const r = await this.b.listSel().select(0x92, n);
      if (r === -1) break;
      await this.b.discInfo(this.c.persons[r]);
    }
  }
  // ---- 8 航海日志 1e31e: 7849(0x0f,0x20,0x2a,0x140), 文字区 0x1c..; 缓冲 [0c8e] (本移植版在状态 0x8a18) 每笔 16 bytes:
  //   +0 日期 (日 = %31+1, 月 = /31%12+1, 年 = /372+1501; FFFF = 结束) +2 种类: 0 / 1 抵达 / 出航 (0x16e / 0x16f, +4 字, +6 港),
  //   2 海战 (0x345, MENU #0x34 / #0x35), 9 (0x17d, +4 港), 0x0c (0x180), 其他不显示。每页 6 笔, 从最后一页开始; 前页 / 后页 (13762) ----
  async logBook() {
    const st = this.st, { win, con, printf, message, sys, menu } = this.c, S = this.S, L = DS.TRADE_LOGS;
    win.shadowedSaved(0x0f, 0x20, 0x2a, 0x140, 0);
    con.left = 0x1c; con.right--;
    let n = 0; while (n < 0x30 && st.u16(L + n * 16) !== 0xffff) n++;
    const last = Math.trunc((n - Math.sign(n)) / 6);                    // seg0:4dde 符号
    let page = last;
    con.lineH = 0x10;
    for (;;) {
      for (let di = 0; di < 6; di++) {
        const e = L + (6 * page + di) * 16, w = st.u16(e);
        if (w === 0xffff) break;
        con.setCursor(0x11, di * 0x30 + 0x28);
        const d = Math.trunc(w / 31), m = Math.trunc(d / 12);
        printf(S.logDate, m + 0x5dd, d % 12 + 1, w % 31 + 1);
        const t = st.u16(e + 2), a = e + 4;
        if (t === 0 || t === 1) message(t ? 0x16f : 0x16e, st.u16(a), st.cstr(DS.TBL_PORT + st.u8(a + 2) * 0x16 + 4));
        else if (t === 2) {
          const m34 = this.c.menuItems(0x34), m35 = this.c.menuItems(0x35), v = st.u16(a);
          const k = v >= 0x3c ? 0 : v % 10 === 0 ? 0 : v % 10 < 5 ? 1 : 2;
          message(0x345, this.p.nations[Math.trunc(v / 10)], m34[k], m35[st.u16(a + 2)]);
        } else if (t === 9) message(0x17d, st.cstr(DS.TBL_PORT + st.u8(a) * 0x16 + 4));
        // 0x180 的 %ld 由堆栈上相邻的两个字组成: 低字 = +8, 高字 = +6 (原版依 +10, +6, +8 的顺序推入, 照搬)
        else if (t === 0x0c) message(0x180, this.p.goods[st.u16(a)], (st.u16(a + 4) | (st.u16(a + 2) << 16)) | 0, st.u16(a + 6));
      }
      con.setCursor(0x11, 0x148);
      let f = 0;
      if (page) { con.puts(S.logPrev); f = 1; }
      con.setCursor(0x16, -1);
      if (page !== last) { con.puts(S.logNext); f |= 2; }
      if (!f) { sys.flush(); await menu.waitRelease(); await menu.waitPress(); break; }   // 131f9
      sys.mouseShow();
      const cnt = f === 3 ? 2 : 1, r = await this.pageMenu(f === 2 ? 0x16 : 0x11, 0x148, 4, cnt, cnt);
      sys.mouseHide();
      if (r === 0xff) break;
      if (f !== 2 && r === 0) page--; else page++;
      this.c.scr.fillCols(0x10, 0x28, 0x28, 0x130, 7);
    }
    con.lineH = 0x18;
    await win.close();
  }
  // 13762 横列菜单 (x 栏, y, 每项宽 w 栏, 每列 cols 项, 共 count 项; 行高 [a15e] = 0x10): 1347c 点击区 → 136cb (光标保留, 超出才归 0)
  async pageMenu(x, y, w, cols, count) {
    const m = this.c.menu, R = m.rects;
    m.lineH = 0x10; m.count = count;
    for (let i = 0; i < count; i++) {
      const c = i % cols, r = Math.trunc(i / cols), x0 = ((1 + w) * c + x) << 3, y0 = r * 0x10 + y;
      R[i] = { x0, x1: x0 + (w << 3), y0, y1: y0 + m.lineH };
    }
    if (count <= m.cur) m.cur = 0;
    const step = cols === 1 ? 0 : 1;
    m.highlight(0);
    let k;
    do k = await this.nav134db(cols, step); while (k !== 0x0d && k !== 0x1b && k !== 0x30);
    m.highlight(m.bracket);
    await m.waitRelease();
    return k === 0x1b || k === 0x30 ? 0xff : m.cur;
  }
  // 134db 导览 (13412 取键; 与 13df0 不同: ← 在列首一律 +C−1, 不检查范围)
  async nav134db(C, step) {
    const m = this.c.menu;
    let k = await m.getKeyFree();
    if (k === 0x0d && m.mouseFlag && !m.hit) k = 0xff;
    m.prev = m.cur;
    const n = m.count;
    switch (k) {
      case 0x38: case 0x1e: m.cur += C <= m.cur ? -C : n - C; break;
      case 0x1c: case 0x36: m.cur += (m.cur + 1) % C !== 0 && m.cur + 1 < n ? step : -(C - 1); break;
      case 0x1d: case 0x34: m.cur += m.cur % C !== 0 ? -step : C - 1; break;
      case 0x1f: case 0x32: m.cur += C + m.cur < n ? C : C - n; break;
    }
    if ([0x32, 0x34, 0x36, 0x38, 0x1e, 0x1f, 0x1c, 0x1d].includes(k)) m.moveHighlight();
    this.c.sys.flush();
    return k;
  }
  // ---- 9 海港地图 1dfaf: 港内 48×48 格缩小图 (1d8ac: 16×16 图块缩成 8×8) + 各建筑名 (MENU #0x3a, 7 号除外) 与外框 ----
  async portMap() {
    const st = this.st, { scr, con, palette, sys, menu } = this.c, p = this.p, S = this.S;
    await palette.fadeBlack();
    const X = p.hx + p.vx, Y = p.hy + p.vy;
    let di = Math.trunc(X / 24), si = Math.trunc(Y / 24);
    if (X % 24 < 12 ? di !== 0 : di === 3) di--;
    if (Y % 24 < 12 ? si !== 0 : si === 3) si--;
    this.miniQuad(0x0c, 8, di, si); this.miniQuad(0x24, 8, di + 1, si);
    this.miniQuad(0x0c, 0xc8, di, si + 1); this.miniQuad(0x24, 0xc8, di + 1, si + 1);
    const clip = [0x60, 8, 0x1df, 0x187];                              // 1fd9:18de (2166e) 线段剪裁矩形 DS:aaac
    con.puts(S.pmColor);
    const lab = this.c.menuItems(0x3a);
    for (let k = 0; k < 12; k++) {
      if (k === 7) continue;
      const len = cmStrlen(lab[k]);
      const x = p.door[k * 2] - (len >> 1) - 24 * di + 0x0d, y = (p.door[k * 2 + 1] - 24 * si - 1) << 3;
      if (x < 0x0c || x + len >= 0x3c || y < 8 || y >= 0x178) continue;
      con.setCursor(x, y); con.puts(lab[k]);
      this.clipRect((x << 3) - 2, y - 2, ((len + x) << 3) + 1, y + 0x11, 4, clip);
      this.clipRect((x << 3) - 1, y - 1, (len + x) << 3, y + 0x10, 4, clip);
    }
    con.puts(S.pmColor2);
    await palette.fadeTo(palette.table("day"));                         // 99ce(DS:a50c)
    sys.flush(); await menu.waitRelease(); await menu.waitPress();      // 131f9
    await palette.fadeBlack();
    palette.selectTimePalette(this.rt.time, st.port === 0xff, st.weather);   // 1976e
    p.clearCache(); p.drawMap();
    await palette.fadeToTarget();
    sys.flush();
  }
  // 1d710 模式 2: 地图第 (bc, br) 块 24×24 格以 8×8 缩小图块画于 (栏 col, y)
  miniQuad(col, y, bc, br) {
    const p = this.p, fb = this.c.scr.fb, M = p.map;
    bc %= 0x5a;
    for (let r = 0; r < 24; r++) for (let c = 0; c < 24; c++) {
      const px = p.tile(M[(br * 24 + r) * 0x60 + bc * 24 + c]), o = (y + r * 8) * 640 + (col + c) * 8;
      // 1d8ac: DS:a7b8 把每 4 个像素 (半个字节) 缩成第 0 与第 3 个像素; 只取偶数行
      for (let yy = 0; yy < 8; yy++) for (let xx = 0; xx < 8; xx++) fb[o + yy * 640 + xx] = px[(yy * 2) * 16 + (xx >> 1) * 4 + (xx & 1) * 3];
    }
    this.c.scr.dirty = true;
  }
  // 1fd9:1f9d 矩形外框, 4 条线各自依剪裁矩形裁切 (1fd9:171e; 水平/垂直线的裁切等于夹限座标)
  clipRect(x0, y0, x1, y1, color, [cx0, cy0, cx1, cy1]) {
    const s = this.c.scr;
    const v = (x, ya, yb) => { if (x < cx0 || x > cx1) return; const a = Math.max(Math.min(ya, yb), cy0), b = Math.min(Math.max(ya, yb), cy1); if (a <= b) s.line(x, a, x, b, color); };
    const h = (y, xa, xb) => { if (y < cy0 || y > cy1) return; const a = Math.max(Math.min(xa, xb), cx0), b = Math.min(Math.max(xa, xb), cx1); if (a <= b) s.line(a, y, b, y, color); };
    v(x0, y0, y1); h(y1, x0, x1); v(x1, y0, y1); h(y0, x0, x1);
  }
  // ================= 经营 1fd9:0fdc (20d6c) =================
  // MENU #0x1b (船长变更/人事变更/水手编组/水手比例/舰船销毁/积载分配) 于 y=0x88; 没有船 → 0,2..5 禁用; 没有船员 → 1
  // 选了项目就先画舰队表 (1e628, 不保存背景); 子功能结束后回到菜单, 取消才结束
  async manage() {
    const { menu } = this.c, items = this.c.menuItems(0x1b).slice(0, 6), b = this.b;
    let si = 0;
    do {
      if (!b.fleetShips()) menu.disabled |= 0x3d;
      if (!b.crewCount()) menu.disabled |= 2;
      const r = await this.popMenu(0x88, items);
      if (r !== 0xff) b.fleetTable();
      switch (r) {
        case 0: await this.captains(); break;                           // 1ea39
        case 1: await this.personnel(); break;                          // 1ed2d
        case 2: await this.sailors(); break;                            // 1ef45
        case 3: await this.ratios(); break;                             // 1f33d
        case 4: await this.scrap(); this.p.clearCache(); this.p.drawMap(); b.fleetTable(); break;   // 1f4ae
        case 5: await b.distribute(new Array(9).fill(0xff), new Array(9).fill(0)); break;           // 1fc43 → 与 1fcf7 相同的循环
        default: si = 1;
      }
    } while (!si);
    await this.redrawMap();                                            // 20b40
  }
  // 1e8b5 舰队表各列的点击区 (x 0x88..0x1b8, 第 i 列 y = (i+3)×0x18) 与第 n 区 (整张表); [8a28] = 0x0f
  fleetRects() {
    const { menu, con } = this.c, R = menu.rects, n = this.b.fleetShips();
    menu.count = n;
    for (let i = 0; i < n; i++) R[i] = { x0: 0x88, x1: 0x1b8, y0: (i + 3) * 0x18, y1: i * 0x18 + 0x58 };
    R[n] = { x0: 0x78, x1: 0x1d0, y0: 0x20, y1: (0x18 * n + 0x50) & 0xffff };
    con.bg = 0x0f;
    return n;
  }
  winE2() { this.c.win.shadowedSaved(0x10, 0xa0, 0x24, 0x48, 1); }       // 1e89e
  winBot() { this.c.win.shadowedSaved(0x1e, 0x120, 0x1c, 0x48, 1); }     // 1edb5
  // 1ea39 船长变更: 选船 → 清单 0x89 (主角 + 船员, 12d8c) → 1e921; Esc 时主角必须是某艘船的船长 (1e9d6), 否则 0xe2 并继续
  async captains() {
    const { menu } = this.c, b = this.b;
    for (;;) {
      const n = this.fleetRects();
      const r = await menu.customMenu(n, 1, 1);
      if (r === 0xff) { if (await this.heroCaptain()) return; continue; }
      const slot = this.c.persons[r];
      const s = await b.listSel().select(0x89, b.captainPool());
      if (s === -1) continue;
      this.setCaptain(slot, this.c.persons[s]);
      b.fleetTable();
    }
  }
  // 1e9d6
  async heroCaptain() {
    const st = this.st, b = this.b;
    for (let i = 0; i < 10; i++) if ((st.u8(b.fleetSlot(i) + 8) & 0x30) === 0x10 && st.u8(b.crewData(i) + 0x1b) === st.hero) return 1;
    this.winE2(); this.c.message(0xe2); await this.waitClose();
    return 0;
  }
  // 1e921 船位 slot 的船长改为 p: p 的职务是 1 或 2 且已是另一艘船的船长 → 两船互换船长 (职务不变);
  //   否则原船长职务 (不是 1 时) 改 6, p 的职务 (不是 1 时) 改 2
  setCaptain(slot, p) {
    const st = this.st, b = this.b, M = b.crewData(slot), oldP = st.personRecord(st.u8(M + OFF.CREW_SLOT.CAPTAIN)), P = st.personRecord(p);
    let other = 0;
    if (st.u8(P + 0x2e) === 1 || st.u8(P + 0x2e) === 2) {
      for (let i = 0; i < 10; i++) if ((st.u8(b.fleetSlot(i) + 8) & 0x30) === 0x10 && st.u8(b.crewData(i) + 0x1b) === p) { other = b.crewData(i); break; }
    }
    if (other) st.set8(other + 0x1b, st.u8(M + OFF.CREW_SLOT.CAPTAIN));
    else {
      if (st.u8(oldP + 0x2e) !== 1) st.set8(oldP + 0x2e, 6);
      if (st.u8(P + 0x2e) !== 1) st.set8(P + 0x2e, 2);
    }
    st.set8(M + OFF.CREW_SLOT.CAPTAIN, p);
  }
  // 1ed2d 人事变更: 窗口 1ea99 (助手/会计/水手长), 1e79f 由船员职务 3/4/5 取得现任 (DS:a87e/a87f/a880, 最后一个为准);
  //   没有船员 → 0xe5; 否则 1eae1 → 14524(3, 1, 1) → 1ec2b
  async personnel() {
    const st = this.st, { win, con, menu, message } = this.c, S = this.S;
    win.shadowedSaved(0x12, 0x60, 0x1c, 0x60, 1);
    con.puts(S.pAssist); con.setCursor(con.left, 0x88); con.puts(S.pAccount); con.setCursor(con.left, 0xa0); con.puts(S.pBosun);
    this.posts = [0xff, 0xff, 0xff];
    for (let i = 0; i < 0x1e; i++) {
      const n = st.u8(DS.PARTY_CREW + i); if (n === 0xff) continue;
      const r = st.u8(st.personRecord(n) + 0x2e); if (r >= 3 && r <= 5) this.posts[r - 3] = n;
    }
    // 没有船员: 0xe5 后只关闭消息窗口就返回, 人事变更窗口留在画面与窗口堆栈上 (照搬; 菜单已禁用此项, 实际走不到)
    if (!this.b.crewCount()) { this.winE2(); message(0xe5); await menu.waitPrompt(); await win.close(); return; }
    for (;;) {
      this.postRows();
      const r = await menu.customMenu(menu.count, 1, 1);
      if (r === 0xff) break;
      await this.setPost(r);
    }
    await win.close();
  }
  // 1eae1 现任者姓名 (补空白到 12 字) 与点击区 0..2, 第 3 区 = 窗口
  postRows() {
    const st = this.st, { con, menu } = this.c, S = this.S, R = menu.rects;
    con.left = 0x14; con.right = 0x2b;
    menu.count = 3;
    const ys = [0x70, 0x88, 0xa0], pads = [S.pPad0, S.pPad1, S.pPad2];
    for (let k = 0; k < 3; k++) {
      R[k] = k === 0 ? { x0: 0xa0, x1: 0x160, y0: 0x70, y1: 0x80 } : { x0: con.left << 3, x1: (con.left + 0x18) << 3, y0: ys[k], y1: ys[k] + 0x10 };
      con.setCursor(k === 0 ? 0x20 : con.left + 0x0c, ys[k]);
      let n = 0;
      if (this.posts[k] !== 0xff) { const nm = st.cstr(st.personRecord(this.posts[k])); con.puts(nm); n = cmStrlen(nm); }
      for (; n < 0x0c; n++) con.puts(pads[k]);
    }
    R[3] = { x0: 0x90, x1: 0x170, y0: 0x60, y1: 0xc0 };
  }
  // 1ec2b 职位 k: 清单 0x89 → 船长 (职务 2) 不行 0xe3; 原本担任 3/4/5 的职位空出; 现任者 (< 0x78) 职务改 6; 新任职务 = k+3 → 0xe4
  async setPost(k) {
    const st = this.st, { message } = this.c, b = this.b, roles = b.T.crewRoles;
    const s = await b.listSel().select(0x89, b.crewCount());
    if (s === -1) return;
    const cur = k < 3 ? this.posts[k] : 0, p = this.c.persons[s], P = st.personRecord(p), r = st.u8(P + 0x2e);
    if (r === 2) { this.winE2(); message(0xe3, st.cstr(P), roles[3 + k]); await this.waitClose(); return; }
    if (r >= 3 && r <= 5) this.posts[r - 3] = 0xff;
    if (cur < 0x78) st.set8(st.personRecord(cur) + 0x2e, 6);
    st.set8(P + 0x2e, k + 3);
    if (k < 3) this.posts[k] = p;
    this.winE2(); message(0xe4, st.cstr(P), roles[st.u8(P + 0x2e)]); await this.waitClose();
  }
  // 1ef45 水手编组: 剩余水手 [a898] / 其士气 [a89a] 从 0 开始; 窗口 1ed8c; 选船 → 1edf9; Esc 时还有剩 → 0xe7 是/否
  async sailors() {
    const { win, con, menu, message, printf } = this.c, S = this.S;
    this.pool = 0; this.poolMorale = 0;
    win.shadowedSaved(0x3c, 0x10, 0x0e, 0x48, 1);
    con.puts(S.slColor); con.puts(S.slRest);
    for (;;) {
      con.right = 0x47; con.left = 0x3e; con.setCursor(0x3e, 0x38); con.puts(S.slColor2); printf(S.slNum, this.pool);   // 1edcc
      const n = this.fleetRects();
      const r = await menu.customMenu(n, 1, 1);
      if (r === 0xff) {
        if (!this.pool) break;
        this.winBot(); message(0xe7);
        const yes = await menu.yesNo(); await win.close();
        if (yes) break;
        continue;
      }
      await this.assignSailors(this.c.persons[r]);
      this.b.fleetTable();
    }
    await win.close();
  }
  // 1edf9 一艘船的水手数 (0..min(现有 + 剩余, 最多水手)); 士气依人数加权平均 (seg0:38ba 长整数除法)
  async assignSailors(slot) {
    const st = this.st, { win, message } = this.c, b = this.b;
    const M = b.crewData(slot), S = b.fleetSlot(slot), ship = DS.TBL_SHIP + st.u8(S + OFF.DOCK_SLOT.SHIP) * 0x16;
    const di = st.u16(S), mor = st.u8(M + OFF.CREW_SLOT.MORALE), pool = this.pool, pm = this.poolMorale;
    const max = cmUmin(di + pool, st.u16(ship + 0x12));
    this.winBot(); message(0xe6, st.cstr(ship), max);
    const si = (await b.numpad.input(0, max)) & 0xffff;
    await win.close();
    st.set16(S, si);
    this.pool = (pool - si + di) & 0xffff;
    st.set8(M + OFF.CREW_SLOT.MORALE, 0);
    if (si) st.set8(M + OFF.CREW_SLOT.MORALE, di < si ? Math.trunc((mor * di + (si - di) * pm) / si) : mor);
    this.poolMorale = 0;
    if (this.pool) this.poolMorale = (di < si ? pm : Math.trunc((pm * pool + (di - si) * mor) / this.pool)) & 0xff;
  }
  // 1f33d 水手比例: 选船 → 1f25a
  async ratios() {
    const { menu } = this.c;
    for (;;) {
      const n = this.fleetRects();
      const r = await menu.customMenu(n, 1, 1);
      if (r === 0xff) return;
      await this.ratio(this.c.persons[r]);
      this.b.fleetTable();
    }
  }
  // 1f25a 驾驶 (+9) / 瞭望 (+8) / 甲板 (其余) 比例: 74f7(0x39,0xe0,0x16,0x80,1), 6 个 −/+ 区 (1efa6) + 第 6 区 = 窗口
  async ratio(slot) {
    const st = this.st, { win, con, scr, gfx, menu } = this.c, S = this.S, M = this.b.crewData(slot), R = menu.rects;
    await win.open(0x39, 0xe0, 0x16, 0x80, 1);
    let n = 0;
    for (let row = 0; row < 3; row++) for (let j = 0; j < 2; j++) {
      const c = 0x0b * j + con.left;
      R[n++] = { x0: (c + 5) << 3, x1: (c + 7) << 3, y0: (row << 5) + 0xf0, y1: (row + 8) << 5 };
    }
    R[n] = { x0: 0x1c8, x1: 0x278, y0: 0xe0, y1: 0x160 };
    menu.count = n;
    con.puts(S.rColor);                                                // 1f141 (DS:a8cc)
    const labels = [S.rDrive, S.rWatch, S.rDeck];
    for (let k = 0; k < 3; k++) { con.setCursor(con.left, 0xf0 + (k << 5)); con.puts(labels[k]); this.barFrame(con.left + 7, 0xf4 + (k << 5)); }
    for (let k = 0; k < 3; k++) {
      const y = (k << 5) + 0xf0;
      scr.putPlanar(con.left + 5, y, 2, 0x10, gfx, 0x390);
      scr.putPlanar(con.left + 0x10, y, 2, 0x10, gfx, 0x410);
    }
    for (;;) {
      this.ratioValues(slot);
      const r = await menu.customMenu(menu.count, 2, 3);
      if (r === 0xff) break;
      const a = st.u8(M + OFF.CREW_SLOT.NAV_RATIO), b9 = st.u8(M + OFF.CREW_SLOT.LOOK_RATIO), rest = (100 - a - b9) & 0xff;
      if (r <= 1) { const t = [b9, a, rest]; this.ratioStep(r, t); st.set8(M + OFF.CREW_SLOT.NAV_RATIO, t[1]); st.set8(M + OFF.CREW_SLOT.LOOK_RATIO, t[0]); }
      else if (r <= 3) { const t = [a, rest, b9]; this.ratioStep(r, t); st.set8(M + OFF.CREW_SLOT.NAV_RATIO, t[0]); st.set8(M + OFF.CREW_SLOT.LOOK_RATIO, t[2]); }
      else if (r <= 5) { const t = [rest, b9, a]; this.ratioStep(r, t); st.set8(M + OFF.CREW_SLOT.NAV_RATIO, t[2]); st.set8(M + OFF.CREW_SLOT.LOOK_RATIO, t[1]); }
    }
    await win.close();
  }
  // 1f227: 奇数 → t0 +1 (≤ 100), 由 t1 扣 (t1 为 0 时改由 t2 扣); 偶数 → t0 −1 (≥ 0), t1 +1
  ratioStep(r, t) {
    if (r & 1) { if (t[0] < 100) { t[0]++; if (t[1]) t[1]--; else t[2] = (t[2] - 1) & 0xff; } }
    else if (t[0]) { t[0]--; t[1] = (t[1] + 1) & 0xff; }
  }
  // 1f036 「%4d人:%3d%%」(人数 = 比例 × 水手 / 100, seg0:3722) 与百分比条
  ratioValues(slot) {
    const st = this.st, { con, printf } = this.c, S = this.S, M = this.b.crewData(slot), s0 = (st.u16(this.b.fleetSlot(slot)) << 16) >> 16;
    const v9 = st.u8(M + OFF.CREW_SLOT.LOOK_RATIO), v8 = st.u8(M + OFF.CREW_SLOT.NAV_RATIO);
    con.setCursor(con.left + 6, 0x100); const a = Math.trunc(v9 * s0 / 100); printf(S.rNum, a, v9); this.bar(con.left + 7, 0xf4, v9);
    con.setCursor(con.left + 6, 0x120); const c = Math.trunc(v8 * s0 / 100); printf(S.rNum, c, v8); this.bar(con.left + 7, 0x114, v8);
    con.setCursor(con.left + 6, 0x140); const v = 100 - v8 - v9; printf(S.rNum, s0 - c - a, v); this.bar(con.left + 7, 0x134, v);
  }
  // 1f4ae 舰船销毁: 只有 1 艘 → 0xd9; 选船 (已销毁的不列入, 1f38a) → 1f43a; 结束时船长为 FF 的船位 +8 = 0
  async scrap() {
    const st = this.st, { menu, message } = this.c, b = this.b;
    if (b.fleetShips() === 1) { this.c.win.shadowedSaved(0x10, 0xa0, 0x24, 0x80, 1); message(0xd9); await this.waitClose(); return; }
    for (;;) {
      const n = this.scrapRects();
      const r = await menu.customMenu(n, 1, 1);
      if (r === 0xff) break;
      await this.scrapShip(this.c.persons[r]);
      b.fleetTable();
    }
    for (let i = 0; i < 10; i++) {
      const S = b.fleetSlot(i);
      if ((st.u8(S + OFF.DOCK_SLOT.FLAGS) & 0x30) === 0x10 && st.u8(b.crewData(i) + 0x1b) === 0xff) st.set8(S + OFF.DOCK_SLOT.FLAGS, 0);
    }
  }
  // 1f38a 尚未销毁 (+1b bit7 = 0) 的船: 点击区位置仍依舰队表的列, [0538] 重新排紧
  scrapRects() {
    const st = this.st, { menu } = this.c, b = this.b, R = menu.rects, P = this.c.persons, n = b.fleetShips();
    let k = 0;
    for (let si = 0; si < n; si++) {
      if (st.u8(b.crewData(P[si]) + 0x1b) & 0x80) continue;
      R[k] = { x0: 0x88, x1: 0x1b8, y0: (si + 3) * 0x18, y1: si * 0x18 + 0x58 };
      P[k] = P[si]; k++;
    }
    R[k] = { x0: 0x78, x1: 0x1d0, y0: 0x20, y1: (0x18 * k + 0x50) & 0xffff };
    menu.count = k;
    return k;
  }
  // 1f43a 主角的船 → 0xe9; 否则 0xea (%s 船名) 是/否 → 1f41d: seg0:5deb 移除后 +8 = 0x10 (表上显示「销毁完毕」直到离开)
  async scrapShip(slot) {
    const st = this.st, { message, menu } = this.c, b = this.b, M = b.crewData(slot), ship = DS.TBL_SHIP + st.u8(b.fleetSlot(slot) + 7) * 0x16;
    this.c.win.shadowedSaved(0x10, 0xa0, 0x24, 0x80, 1);
    if (st.u8(M + OFF.CREW_SLOT.CAPTAIN) === st.hero) { message(0xe9); await menu.waitPrompt(); }
    else {
      message(0xea, st.cstr(ship));
      if (await menu.yesNo()) { b.removeShip(slot); st.set8(b.fleetSlot(slot) + 8, 0x10); }
    }
    await this.c.win.close();
  }
  // ================= 命令 1fd9:10a8 (20e38) =================
  // MENU #0x1c (侦察/交涉/战斗/队形变更/粮食分配/酬金设置) 于 y=0xe0; 在港 → 0..2 禁用; 没有船 → 3,4; 没有船员 → 5
  // 侦察、队形变更、粮食分配、酬金设置 后回到菜单; 交涉 返回 0 时、战斗、取消 后结束
  async order() {
    const st = this.st, { menu } = this.c, items = this.c.menuItems(0x1c).slice(0, 6), b = this.b;
    let si = 0;
    do {
      if (st.port !== 0xff) menu.disabled |= 7;
      if (!b.fleetShips()) menu.disabled |= 0x18;
      if (!b.crewCount()) menu.disabled |= 0x20;
      const r = await this.popMenu(0xe0, items);
      switch (r) {
        case 0: await this.p.scout(); break;                            // 1feae 侦察 (以下 3 项在港时禁用; scenes/sea.js)
        case 1: si = (await this.p.negotiate()) ? 0 : 1; break;          // 20a6d 交涉
        case 2: await this.p.battle(); si = 1; break;                   // 0fea:1181 战斗
        case 3: await this.formation(); break;                          // 20587
        case 4: await this.rations(); break;                            // 208af
        case 5: await this.wages(); break;                              // 20ade
        default: si = 1;
      }
    } while (!si);
    await this.redrawMap();                                            // 20b40
  }
  // 20587 队形变更: 依序指定第 1, 2, … 艘 (清单 0x80 = 船名「%s号」), Esc 取消上一个 (一个都没选时直接到确认);
  //   全部指定后 0xdb 是/否: 否 → 从头开始; 是 → 2051b 依新顺序交换船位 (203e9) 并整理 (20468)
  async formation() {
    const { win, con, message, menu } = this.c, b = this.b, P = this.c.persons;
    for (;;) {
      const n = b.fleetShips();
      const nw = new Array(10).fill(0xff), old = new Array(10).fill(0xff);
      for (let i = 0; i < n; i++) old[i] = P[i];
      if (!n) return;
      if (n === 1) { win.shadowedSaved(0x14, 0x80, 0x1e, 0x60, 0); message(0xd9); await this.waitClose(); return; }
      this.fmNumbers(n);                                               // 2029f
      let si = n;
      while (si > 0) {
        this.fmNames(n, nw);                                           // 202f7
        win.shadowedSaved(0x14, 0x40, 0x1e, 0x48, 0);
        con.setCursor(-1, 0x58);                                       // seg0:4434
        message(0xda, n - si + 1);
        const r = await b.listSel().select(0x80, si);
        await win.close();
        if (r === -1) {
          if (si >= n) break;
          si++; nw[n - si] = 0xff;
        } else { nw[n - si] = P[r]; si--; }
        this.fmRemain(nw, old);                                        // 20363
      }
      this.fmNames(n, nw);
      win.shadowedSaved(0x14, 0x40, 0x1e, 0x48, 0);
      message(0xdb);
      const yes = await menu.yesNo();
      await win.close(); await win.close();
      if (!yes) continue;
      if (nw[0] !== 0xff) this.fmApply(old, nw);                       // 2051b
      return;
    }
  }
  // 2029f 编号窗口 7849(0x16, 0x90, 0x18, (n+2)×16) 与「%2d﹒」
  fmNumbers(n) {
    const { win, con, printf } = this.c;
    win.shadowedSaved(0x16, 0x90, 0x18, (n + 2) << 4, 0);
    con.setCursor(con.left, 0x90);
    for (let si = 0; si < n; si++) { con.setCursor(con.left, (si + 10) << 4); printf(this.S.fmNum, si + 1); }
  }
  // 202f7 已指定的船名 (左边界 0x18, 右边界 0x2b; 未指定 = 16 个空白)
  fmNames(n, nw) {
    const st = this.st, { con, printf } = this.c, S = this.S, b = this.b;
    con.left = 0x18; con.right = 0x2b;
    con.puts(S.fmColor);
    for (let si = 0; si < n; si++) {
      con.setCursor(con.left + 4, (si + 10) << 4);
      if (nw[si] !== 0xff) printf(S.fmShip, st.cstr(DS.TBL_SHIP + st.u8(b.fleetSlot(nw[si]) + 7) * 0x16)); else con.puts(S.fmBlank);
    }
  }
  // 20363 [0538] = 原顺序中还没被指定的船位
  fmRemain(nw, old) {
    const P = this.c.persons; let k = 0;
    for (let i = 0; old[i] !== 0xff && i < 10; i++) {
      P[k] = old[i];
      for (let j = 0; nw[j] !== 0xff && j < 10; j++) if (old[i] === nw[j]) P[k] = 0xff;
      if (P[k] !== 0xff) k++;
    }
  }
  // 2051b 第 i 位应为 nw[i]: 交换 old[i] 与 nw[i] 两个船位, 并把 nw 中等于 old[i] 的那一格改成 nw[i]; 最后 20468 整理
  fmApply(old, nw) {
    const b = this.b;
    for (let i = 0; i < 10; i++) {
      if (nw[i] === 0xff || nw[i] === old[i]) continue;
      b.swapSlots(old[i], nw[i]);
      for (let j = 0; j < 10; j++) if (nw[j] === old[i]) { nw[j] = nw[i]; nw[i] = old[i]; break; }
    }
    b.compactSlots();
  }
  // 208af 粮食分配: 水 [2e19] / 粮食 [2e1a] 0..100%, 14524(4, 2 栏, 可取消+保留光标): 0/2 减 1, 1/3 加 1
  async rations() {
    const st = this.st, { con, menu, win } = this.c;
    if (!this.b.fleetShips()) return;
    con.puts(this.S.rtColor);
    await this.rtParts();
    for (;;) {
      this.rtValues();
      const r = await menu.customMenu(menu.count, 2, 3);
      if (r === 0xff) break;
      const a = r < 2 ? 0x2e19 : 0x2e1a, v = st.u8(a);
      if (r & 1) { if (v < 100) st.set8(a, v + 1); } else if (v) st.set8(a, v - 1);
    }
    await win.close();
  }
  // 206dd 窗口 74f7(0x39, 0xe0, 0x16, 0x60, 1), 文字区 0x3b..0x4b; −/+ 按钮 (左边界 +5 / +0x10) 与点击区 0..3, 第 4 区 = 窗口
  async rtParts() {
    const { win, con, scr, gfx, menu } = this.c, S = this.S, R = menu.rects;
    await win.open(0x39, 0xe0, 0x16, 0x60, 1);
    con.left = 0x3b; con.right = 0x4b;
    con.puts(S.rtColor2);
    con.setCursor(con.left, 0xf0); con.puts(S.water); this.barFrame(con.left + 7, 0xf4);
    con.setCursor(con.left, 0x110); con.puts(S.food); this.barFrame(con.left + 7, 0x114);
    for (let k = 0; k < 2; k++) {
      const y = (k << 5) + 0xf0;
      scr.putPlanar(con.left + 5, y, 2, 0x10, gfx, 0x390);
      scr.putPlanar(con.left + 0x10, y, 2, 0x10, gfx, 0x410);
    }
    let n = 0;
    for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) {
      const c = 0x0b * j + con.left;
      R[n++] = { x0: (c + 5) << 3, x1: (c + 7) << 3, y0: (k << 5) + 0xf0, y1: (k + 8) << 5 };
    }
    R[n] = { x0: 0x1c8, x1: 0x278, y0: 0xe0, y1: 0x140 };
    menu.count = n;                                                    // [a158] = 4
  }
  // 20848 「%3d%%」与百分比条
  rtValues() {
    const st = this.st, { con, printf } = this.c, S = this.S;
    con.setCursor(con.left + 0x0d, 0x100); printf(S.pct, st.u8(0x2e19)); this.bar(con.left + 7, 0xf4, st.u8(0x2e19));
    con.setCursor(con.left + 0x0d, 0x120); printf(S.pct, st.u8(0x2e1a)); this.bar(con.left + 7, 0x114, st.u8(0x2e1a));
  }
  // 20ade 酬金设置: 有船员时反复 清单 0x89 → 20933
  async wages() {
    for (;;) {
      const n = this.b.crewCount();
      if (!n) return;
      const r = await this.b.listSel().select(0x89, n);
      if (r === -1) return;
      await this.wage(this.c.persons[r]);
    }
  }
  // 20933 一名船员的酬金: 忠诚 (+2b) ≥ 80 → 本人 0xdc; 否则船员 (9076 [4,3,5,2,6]) 说 0xdd (本人) / 0xde (%s = 姓名),
  //   「（%d∼2000）」目前 = 10 × [2e39 + 序号] → 计算机 (0, 2000), 低于目前 → 0xe0 再输入 (不再印范围);
  //   0xdf → 忠诚 = min(100, 忠诚 + (新 − 旧) / 5), [2e39 + 序号] = 新 / 10
  async wage(p) {
    const st = this.st, { message, printf } = this.c, b = this.b, S = this.S;
    let idx = 0;
    for (let i = 0; i < 0x1e; i++) if (st.u8(DS.PARTY_CREW + i) === p) { idx = i; break; }
    const P = st.personRecord(p);
    if (st.u8(P + 0x2b) >= 0x50) { b.talkPerson(p); message(0xdc); await this.waitClose(); return; }
    const di = 10 * st.u8(0x2e39 + idx);
    const who = b.crewSpeaks([4, 3, 5, 2, 6]);                         // seg0:9076
    if (who === p) message(0xdd); else message(0xde, st.cstr(P));
    printf(S.wageRange, di);
    let si;
    for (;;) {
      si = (await b.numpad.input(0, 2000)) & 0xffff;
      if (who === p) b.talkClear(); else { await this.c.win.close(); b.talkPerson(p); }
      if (di > si) { message(0xe0); await this.c.menu.waitPrompt(); continue; }
      break;
    }
    message(0xdf); await this.waitClose();
    st.set8(P + 0x2b, cmUmin(Math.trunc(((si - di) & 0xffff) / 5) + st.u8(P + 0x2b), 100));
    st.set8(0x2e39 + idx, Math.trunc(si / 10));
  }

  // ================= 航海术 1fd9:119e (20f2e) =================
  // MENU #0x1d (委任/停船/靠港/登陆/随身物/功能), [1005] bit5 (停船中) 时 #0x2e (第 2 项改为「出航」)
  // 禁用: [1005] & 0x18 → 0..2; 在港 → 0..3; 没有随身物 → 4。选随身物以外的项目 (或取消) 后结束; 功能返回值决定是否结束
  async nav() {
    const st = this.st, { menu, palette } = this.c;
    const items = this.c.menuItems(st.u8(DS.SEA_FLAGS2) & 0x20 ? 0x2e : 0x1d).slice(0, 6);
    const pm = PortMove.enabled(this.c);                               // 扩充功能 (非原版): 第 7 项「港内移动」, 菜单上移一行 (RE_NOTES 33.1)
    if (pm) items.push(PortMove.label(this.c));
    let si = 0;
    while (!palette.ending) {                                          // 20fd9: [03ea] == 0
      if (si) break;
      if (st.u8(DS.SEA_FLAGS2) & 0x18) menu.disabled |= 7;
      if (st.port !== 0xff) menu.disabled |= 0x0f;
      if (!this.itemList()) menu.disabled |= 0x10;
      if (pm && st.port === 0xff) menu.disabled |= 0x40;
      const r = await this.popMenu(pm ? 0xc8 : 0xe0, items);
      switch (r) {
        case 0: await this.p.delegate(); si = 1; break;                // 2e09:3223 委任 (以下 4 项在港时禁用; scenes/sea.js)
        case 1: await this.p.stopToggle(); si = 1; break;              // 20ee3 停船 / 出航
        case 2: await this.p.dock(); si = 1; break;                    // 0fea:c0d9 = 1bf79 靠港
        case 3: await this.p.land(); si = 1; break;                    // 2e09:6e37 = 34ec7 登陆
        case 4: await this.belongings(); break;                         // 29a4c (不结束)
        case 5: si = await this.functions(); break;                     // 215bd
        case 6: si = await PortMove.choose(this); break;                 // 扩充功能: 港内移动 (scenes/portmove.js)
        default: si = 1;
      }
    }
    await this.redrawMap();                                            // 20b40
  }
  // 0fea:32a6 = 13146 随身物 (DS:2e57, 20 格, FF = 空) → [0538], 返回个数
  itemList() {
    const st = this.st, P = this.c.persons; let n = 0;
    for (let i = 0; i < 0x14; i++) { const v = st.u8(DS.INVENTORY + i); if (v !== 0xff) P[n++] = v; }
    return n;
  }
  // 29a4c 随身物: 清单 0x8d → 道具数据 (29497: 74f7(0x0c,0x80,0x30,0xb0,1) + 29340) → MENU #0x21 (佩戴/使用) 于 y=0x108
  async belongings() {
    const { win } = this.c, ls = this.b.listSel();
    for (;;) {
      const n = this.itemList();
      const items = this.c.menuItems(0x21).slice(0, 2);
      const si = await ls.select(0x8d, n);
      if (si === -1) break;
      const it = this.c.persons[si];
      await win.open(0x0c, 0x80, 0x30, 0xb0, 1);
      this.b.itemInfo(it, 1);
      const r = await this.popMenu(0x108, items);
      await win.close();
      if (r === 0) await this.equip(it);
      else if (r === 1) await this.use(it);
    }
  }
  // 294d5 佩戴: 种类 (+13 & 0f) ≥ 7 不能装备; 已装备 → 除去; 否则装上:
  //   先除去所有已装备的随身物, 依种类记住各类最后一件 (0..3 武器 / 4,5 甲 / 6 盾), 本件取代它那一类, 再把 3 类各自装回
  async equip(it) {
    const st = this.st, { con } = this.c, S = this.S, R = DS.TBL_ITEM + it * 0x14, t = st.u8(R + 0x13) & 0x0f;
    if (t >= 7) { this.smallWin(); con.puts(S.noEquip); await this.waitClose(); return; }
    if (st.u8(R + 0x13) & 0x10) { this.smallWin(); con.puts(S.unequip); await this.waitClose(); st.set8(R + 0x13, st.u8(R + 0x13) & 0xef); return; }
    this.smallWin(); con.puts(S.equipped); await this.waitClose();
    const cat = k => (k <= 3 ? 0 : k <= 5 ? 1 : k === 6 ? 2 : -1), slot = [0xff, 0xff, 0xff];
    for (let i = 0; i < 0x14; i++) {
      const x = st.u8(DS.INVENTORY + i); if (x === 0xff) continue;
      const Q = DS.TBL_ITEM + x * 0x14; if (!(st.u8(Q + 0x13) & 0x10)) continue;
      st.set8(Q + 0x13, st.u8(Q + 0x13) & 0xef);
      const k = cat(st.u8(Q + 0x13) & 0x0f); if (k >= 0) slot[k] = x;
    }
    { const k = cat(t); if (k >= 0) slot[k] = it; }
    for (const x of slot) if (x !== 0xff) { const Q = DS.TBL_ITEM + x * 0x14; st.set8(Q + 0x13, st.u8(Q + 0x13) | 0x10); }
  }
  // 299f5 使用: 种类 7 → 298a5 (位置), 8 → 29710 (道具), 9 → 29808 (药品, 用后消失), 0x0c → 0fea:ded6 (地图), 其他 → 2962f
  async use(it) {
    const st = this.st, R = DS.TBL_ITEM + it * 0x14, t = st.u8(R + 0x13) & 0x0f;
    switch (t) {
      case 7: return this.useNavi(R);
      case 8: return this.useTool(it);
      case 9: return this.useMedicine(it);
      case 0x0c: return this.p.mapItem(it);                                       // 0fea:ded6 = 1dd76 (scenes/sea.js)
      default: return this.cantUse(t);
    }
  }
  // 2962f 用不了: 0..3「武器」4「盾」5「防御」+「武器」6「甲」其他「这东西」+「在这儿用不了．」(cs:98b9 跳跃表, 照搬)
  async cantUse(t) {
    const { con } = this.c, S = this.S;
    this.smallWin();
    if (t <= 3) con.puts(S.kWeapon);
    else if (t === 4) con.puts(S.kShield);
    else if (t === 5) { con.puts(S.kDefense); con.puts(S.kWeapon); }
    else if (t === 6) con.puts(S.kArmor);
    else con.puts(S.kThing);
    con.puts(S.cantUse);
    await this.waitClose();
  }
  // 298a5 种类 7 (测量用具, BX = 随身物记录 R): 在港 → MESSAGE 0x2f4。海上:
  //   主角 ([c2ce]) +30 bit4 (测量技能) 没有 → 0x2f5 → 29852 选有技能的船员; 取消 → 主角发言 (+31 bit4 ? 0x2f6 + 0x2f8 : 0x2f7 + 0x2f9), 误差 = random(100) + 1
  //   经度 si = (x + 0x7bd) mod 0x870 (> 0x438 → 0x870 − si, 消息 0x81 西经, 否则 0x80 东经) → (si / (精度 × 6)) × 精度 (精度 = R +12)
  //   纬度 = 0x280 − y (≥ 0 → 0x7e 北纬, 否则 0x7f 南纬) → (|纬度| × 8 / (精度 × 0x39)) × 精度
  //   误差加在两个值上 (原版如此: 不会测量时显示的度数直接多 1..100 度)。两则消息印在同一个小窗口 (294bf) 中
  async useNavi(R) {
    const st = this.st, { message, sys } = this.c;
    if (st.port !== 0xff) { this.smallWin(); message(0x2f4); await this.waitClose(); return; }
    let err = 0;
    const H = this.b.hero;
    if (!(st.u8(H + OFF.PERSON.SKILLS) & 0x10)) {
      this.smallWin(); message(0x2f5); await this.waitClose();
      if (!(await this.pickSurveyor())) {
        this.b.talkPerson(st.u8(DS.HERO));                               // seg0:7f06
        if (st.u8(H + OFF.PERSON.FACE) & 0x10) { message(0x2f6); message(0x2f8); } else { message(0x2f7); message(0x2f9); }
        await this.waitClose();
        err = (sys.rng.random(100) + 1) & 0xffff;
      }
    }
    const F = this.p.fleet, s16 = v => (v << 16) >> 16, prec = st.u8(R + 0x12);
    let si = s16(st.u16(F) + 0x7bd) % 0x870, di = 0x80;
    const lat = s16(0x280 - st.u16(F + OFF.FLEET.Y));
    if (si > 0x438) { di = 0x81; si = 0x870 - si; }
    const lon = Math.imul(Math.trunc(si / s16(prec * 6)), prec);
    const latv = Math.imul(Math.trunc(s16(Math.abs(lat) << 3) / s16(prec * 0x39)), prec);
    this.smallWin();
    message(lat >= 0 ? 0x7e : 0x7f, s16(err + latv));
    message(di, s16(err + lon));
    await this.waitClose();
  }
  // 29852 选测量者: 船员清单 (0fea:2f1b) → 清单 0x89; 选到没有技能 (+30 bit4) 的 → 0x2f3 再选; 选到有的 → 1, 取消 → 0
  async pickSurveyor() {
    const st = this.st, P = this.c.persons;
    for (;;) {
      const n = this.b.crewCount();
      const si = await this.b.listSel().select(0x89, n);
      if (si === -1) return 0;
      if (st.u8(st.personRecord(P[si] & 0xff) + 0x30) & 0x10) return 1;
      this.smallWin(); this.c.message(0x2f3); await this.waitClose();
    }
  }
  // 29710 种类 8: 编号 0x17 时刻 (29694), 0x19 喵呜 (296f8), 0x18/0x1a..0x1c 看得很远 (296e0), 其他用不了 (cs:9996 跳跃表)
  async useTool(it) {
    const { con, printf } = this.c, S = this.S, k = it - 0x17;
    if (k < 0 || k > 5) return this.cantUse(8);
    this.smallWin();
    if (k === 0) {
      const t = this.rt.time;
      printf(S.hour, Math.trunc(t / 3));
      if (t % 3) printf(S.minute, (t % 3) * 2);
    } else con.puts(k === 2 ? S.meow : S.farSight);
    await this.waitClose();
  }
  // 29808 种类 9: 0x29 老鼠药 ([0cb3] bit4) / 0x2a 暴风雨 (29780, [0cb3] 低 4 位 = 1) / 0x2b 坏血病 ([0cb3] bit5) / 其他用不了;
  //   之后一律从随身物中移除第一个同编号的格子 (连「用不了」的也被消耗, 照搬)
  async useMedicine(it) {
    const st = this.st, { con } = this.c, S = this.S;
    if (it === 0x29) {
      this.smallWin();
      if ((st.u8(DS.WEATHER) & 0x10) === 0x10) { st.set8(DS.WEATHER, st.u8(DS.WEATHER) & 0xef); con.puts(S.ratGone); } else con.puts(S.noTrouble);
      await this.waitClose();
    } else if (it === 0x2a) {
      this.smallWin();
      if ((st.u8(DS.WEATHER) & 0x0f) === 1) {
        st.set8(DS.WEATHER, st.u8(DS.WEATHER) & 0xf0);
        this.c.palette.selectTimePalette(this.rt.time, st.port === 0xff, st.weather);     // 0fea:98ce = 1976e
        con.puts(this.rt.time >= 0x0c && this.rt.time < 0x3c ? S.stormDay : S.stormNight);
        this.c.sfx?.off();                                             // 297b4: 9888
      } else con.puts(S.noTrouble2);
      st.set8(DS.COOLDOWN_10A6, this.c.sys.rng.random(6) + 0x0a);
      await this.waitClose();
    } else if (it === 0x2b) {
      this.smallWin();
      if ((st.u8(DS.WEATHER) & 0x20) === 0x20) { st.set8(DS.WEATHER, st.u8(DS.WEATHER) & 0xdf); con.puts(S.scurvyCured); } else con.puts(S.good);
      await this.waitClose();
    } else await this.cantUse(st.u8(DS.TBL_ITEM + it * 0x14 + 0x13) & 0x0f);
    for (let i = 0; i < 0x14; i++) if (st.u8(DS.INVENTORY + i) === it) { st.set8(DS.INVENTORY + i, 0xff); break; }
  }
  // 215bd 功能: MENU #0x14 (环境设置/保存文件/取出存盘/结束游戏) 于 y=0xf8, 无禁用项;
  //   读档成功 → [0533..0535] = F0 (时间循环中止) 并返回 1 (结束航海术菜单); 其他回到此菜单, 取消返回 0
  async functions() {
    const st = this.st, { menu, palette } = this.c, items = this.c.menuItems(0x14).slice(0, 4);
    while (!palette.ending) {
      menu.disabled = 0;
      const r = await this.popMenu(0xf8, items);
      switch (r) {
        case 0: {
          const o = st.options;
          await this.settings();
          if ((st.options ^ o) & 0x80) { this.release(3); await this.reenter(); this.press(3); }   // 环境设置不会改 bit7 (死码, 照搬)
          break; }
        case 1:
          if (st.port !== 0xff) st.set8(DS.LAST_PORT, 0x82);                   // 读档后重新读入入口表但保留位置
          await this.saveLoad(0); break;
        case 2:
          if (await this.saveLoad(1)) { this.rt.time = this.rt.day = this.rt.month = 0xf0; return 1; }
          break;
        case 3: await this.quit(); break;
        default: return 0;
      }
    }
    return 0;
  }
  // 214cf 环境设置: 74f7(0x18,0x20,0x20,0xc0,1); 5 个标题 (0x1a, 0x30+32i) "%-s"; 2123a 按钮与点击区; 循环 21342 显示 → 14524(10, 2 栏, 可取消+保留光标)
  //   项目 0,1 = 表示效果 ([0ca4] bit0), 2,3 = BGM (bit2), 4..9 = 3 个数值的 −/+ (鼠标灵敏度 [0ca8] 0..4, 海上移动值 [0ca9] 0..10, 海上速度 [0ca6] 0..10)
  async settings() {
    const st = this.st, { win, con, printf, menu } = this.c, S = this.S;
    await win.open(0x18, 0x20, 0x20, 0xc0, 1);
    const L = [S.optAnim, S.optBgm, S.optMouse, S.optSeaMove, S.optSeaSpeed];
    for (let i = 0; i < 5; i++) { con.setCursor(0x1a, 0x30 + (i << 5)); printf(S.fmtS, L[i]); }
    this.settingsParts();
    let r;
    do {
      this.settingsValues();
      r = await menu.customMenu(menu.count, 2, 3);
      const h = r >> 1;
      if (h <= 1) await this.settingsToggle(r);
      else if (h <= 4) this.settingsStep(r - 4);
    } while (r !== 0xff);
    await win.close();
  }
  // 2123a 3 列 −/+ 按钮 ([0c86]+0x390 / 0x410 于栏 0x26 / 0x31) 与 9216 数值框; 点击区 0..3 (每列 2 个相同的区域, 照搬) 与 4..9
  settingsParts() {
    const { scr, gfx, menu } = this.c, R = menu.rects;
    for (let si = 0; si < 3; si++) {
      const y = 0x70 + (si << 5);
      scr.putPlanar(0x26, y, 2, 0x10, gfx, 0x390);
      scr.putPlanar(0x31, y, 2, 0x10, gfx, 0x410);
      this.barFrame(0x28, 0x74 + (si << 5));
    }
    let n = 0;
    for (let bx = 0; bx < 2; bx++) for (let k = 0; k < 2; k++) R[n++] = { x0: 0x130, x1: 0x160, y0: (bx << 5) + 0x30, y1: (bx << 5) + 0x40 };
    for (let di = 0; di < 3; di++) for (let bx = 0; bx < 2; bx++) { const x0 = bx * 0x58 + 0x130; R[n++] = { x0, x1: x0 + 0x10, y0: (di << 5) + 0x70, y1: (di << 5) + 0x80 }; }
    menu.count = n;                                                    // [a158] = 10
  }
  // 21342 ON/OFF 与 3 个百分比条
  settingsValues() {
    const st = this.st, { con } = this.c, S = this.S;
    for (let si = 0; si < 2; si++) { con.setCursor(0x26, 0x30 + (si << 5)); con.puts(st.options & (si ? 4 : 1) ? S.on : S.off); }
    for (let si = 0; si < 3; si++) {
      const v = si < 2 ? Math.trunc(100 * st.u8(DS.MOUSE_SENS + si) / (si ? 10 : 4)) : 10 * st.u8(DS.SEA_SPEED);
      this.bar(0x28, 0x74 + (si << 5), v);
    }
  }
  // 213c5: 0 表示效果; 1 BGM ([8c1e] ≠ FF 且有音源驱动 [03e4] 时, 否则连开关比特都不改): 开 → (暴风雨中 9768(DS:0c5a) + 9804(0x30)) 9670([8c1e]) 重播目前曲目,
  //   关 → 9888 + 9712(5) 淡出并等到停止 (9739)。[8c1e] = core/audio.js BGM.song (港口 / 海上 / 标题各自的目前曲目; 不是重算港口曲目)
  //   (效果音跟着背景音乐开关: 关掉音乐也停掉暴风雨声, 打开音乐时重新开始, 照搬)
  async settingsToggle(r) {
    const st = this.st;
    if ((r >> 1) === 0) { st.options = st.options ^ 1; return; }
    const bgm = this.c.bgm, song = bgm.song ?? 0xff;
    if (song === 0xff || this.c.noSoundDriver) return;
    st.options = st.options ^ 4;
    if (st.options & 4) { if ((st.u8(DS.WEATHER) & 15) === 1) { this.c.sfx?.voice(0x0c5a); this.c.sfx?.note(0x30); } bgm.playSong(song); }
    else { this.c.sfx?.off(); bgm.fadeOut(); await bgm.stopped?.(); }
  }
  // 21432: si = 项目 − 4; 奇数 +1 (不超过上限), 偶数 −1 (不低于 0); 之后 seg0:5022 以 ([0ca8]+2)×2 设置鼠标速度
  settingsStep(si) {
    const st = this.st, max = si >= 2 ? 10 : 4, a = si < 4 ? DS.MOUSE_SENS + (si >> 1) : DS.SEA_SPEED, v = st.u8(a);
    if (si & 1) st.set8(a, v + cmUmin(max - v, 1)); else st.set8(a, v - cmUmin(v, 1));
    const m = (st.u8(DS.MOUSE_SENS) + 2) * 2; this.c.sys.mickeyRatio = [m, m];
  }
  // seg0:9216 数值框 (栏 x, y); wide = seg0:90c0 (13 栏, 右端 +0x6a / +0x6f)
  barFrame(x, y, wide = 0) {
    const s = this.c.scr, si = (x << 3) + 4, e = wide ? 0x6a : 0x38;
    s.fillCols(x + 1, y, wide ? 0x0d : 7, 8, 5);
    s.fillRectPxPlanes(si, y, si + 5, y + 7, 5, 4);
    s.fillRectPxPlanes(si + e, y, si + e + 5, y + 7, 5, 4);
    s.rectOutline(si, y, si + e + 5, y + 7, 0);
    s.rectOutline(si + 5, y + 1, si + e, y + 6, 0);
    s.line(si, y, si + e + 5, y, 7);
    s.line(si, y, si, y + 7, 7);
    s.line(si + 5, y + 6, si + e, y + 6, 7);
    s.line(si + e, y + 1, si + e, y + 6, 7);
  }
  // seg0:92f7 百分比条 (0..100 → 0..50 像素), 颜色 DS:bafa / bafc; wide = seg0:91a1 (0..100 像素)
  bar(x, y, v, wide = 0) {
    const s = this.c.scr, [ca, cb] = this.c.barColors, c = v < 0 ? 0 : v > 100 ? 100 : v;
    const si = wide ? c : Math.trunc(c / 2), x8 = x << 3, full = wide ? 100 : 50, end = wide ? 0x6d : 0x3b;
    if (si) s.fillRectPxPlanes(x8 + 0x0a, y + 2, x8 + si + 9, y + 5, ca, 4);
    if (si !== full) s.fillRectPxPlanes(x8 + si + 0x0a, y + 2, x8 + end, y + 5, cb, 4);
  }
  // 0fea:7042 = 16ee2(mode): 0/2/3 存盘 (16cf0), 1 读档 (16b3f); 读档成功且 mode = 1 时 1721f 重新进港, 返回 1
  async saveLoad(mode) {
    if (mode === 1) {
      const ok = await new Title(this.c).loadMenu();
      if (ok) { await this.reenter(); return 1; }
      return 0;
    }
    await this.save(mode);
    return 0;
  }
  // 16cf0 存盘: 16a03 存盘一览 (标题「保存进度」) → 14524(10,1,1) → 74f7(0x18,0x100,0x20,0x30,1) MESSAGE 0x3ba 是/否
  //   头部 15 bytes: 日 (≤8 时十位为空白) "/" 月字符串 (DS:8af0) "/15" 年 (+9,+10), +12 港, +13 = mode ([0ca4] 无 bit6 → 2, 无 bit1 → 3);
  //   [0caa..0cad] = 目前日期时刻, 写入 DS:0CA4..8A18 + 缓冲 [0c8e] 0x300 bytes
  async save(mode) {
    const st = this.st, { win, con, menu, message } = this.c, f = this.c.saveFile, T = new Title(this.c);
    const hdr = f.headers();
    await T.slotList(hdr, 4);
    let flag = mode;
    if (!(st.options & 0x40)) flag = 2; else if (!(st.options & 2)) flag = 3;
    for (;;) {
      T.slotRects();
      const sel = await menu.customMenu(10, 1, 1);
      if (sel === 0xff) { await win.close(); return 0; }
      await win.open(0x18, 0x100, 0x20, 0x30, 1);
      con.setCursor(0x1a, 0x110); message(0x3ba);
      if (!await menu.yesNo()) { await win.close(); continue; }
      const h = new Uint8Array(15), rt = this.rt, d = rt.day;
      h[0] = d > 8 ? 0x30 + Math.trunc((d + 1) / 10) : 0x20;
      h[1] = 0x30 + (d + 1) % 10; h[2] = 0x2f;
      let k = 3;
      const cat = s => { for (let i = 0; s[i]; i++) h[k++] = s[i]; };   // strcat (4d31)
      cat(this.p.months[rt.month]); cat(this.S.saveYear);
      h[9] = (0x30 + Math.trunc((rt.year + 1) / 10)) & 0xff; h[10] = 0x30 + (rt.year + 1) % 10;
      h[12] = st.port; h[13] = flag;
      st.set8(DS.YEAR, rt.year); st.set8(DS.MONTH, rt.month); st.set8(DS.DAY, rt.day); st.set8(DS.TIME, rt.time);
      f.writeSlot(sel, h, st.b);
      await win.close(); await win.close();
      return 1;
    }
  }
  // 2157f 结束游戏: 7849(0x11,0xa0,0x20,0x50,1)「可以结束吗？」是 → 淡出, [03ea] = 0x88 (主循环结束后回到标题, 见 clock.js)
  async quit() {
    const { win, con, menu, palette } = this.c;
    win.shadowedSaved(0x11, 0xa0, 0x20, 0x50, 1);
    con.puts(this.S.quitAsk);
    const yes = await menu.yesNo();
    await win.close();
    if (!yes) return;
    await palette.fadeBlack();
    palette.ending = 0x88;
  }
}
