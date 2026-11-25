// scenes/sea.js — 海上場景 (MAIN.EXE: 出海 seg0:851f、海上畫面 6b30 / 6cfc / 8067、時間主循環的海上部分 1fd9:13c1 / 1afe8 / 2e09:38ec / 2e09:2f3d、
//   每日 195b6、天候 19a99 / 19f48)
// 與港口共用同一個場景物件 (SeaScene 繼承 PortScene): 原版的地圖視窗 (1fac)、圖塊快取 cs:1b2c、地圖緩衝 [03f6]、羅盤指針 [8c1d] 都是同一份
// 原版變數 (DS, 不在存檔內): [06c8] 區域編號 region   [06ca] WORLDMAP 項 item   [bda6]/[bdaa] 區域左上 (地圖格)   [bdba] 視窗偏移 bdba
//   [bdac] 本時刻船速 speed   [bdca] 瞭望範圍 sight   [a9c8] 輸入旗標 (bit0 暫停, bit1 滑鼠按著)   [bda8] 隨身物旗標 (0x80 望遠鏡 0x18, 0x40 0x19)
// 存檔內: 主角艦隊 [c2d4] = 2e76 + 0x85 × (主角 +2c): +0 x  +2 y (地圖格, 0..2159 / 0..1079)  +4/+6 目的地  +8/+a 中途點  +18/+19 格內位置 (0..0x3b)
//   +1a 方位 (0..7, 8 = 停船)  [1006]/[1008] 地圖視窗左上 (地圖格)  [1005] 航行旗標 (0x80/0x40 委任, 0x20 停船, 0x18 ?)  [2e18] 出港天數  [2e19]/[2e1a] 水/糧食配給 %
// 階段 5 後半 (docs/RE_NOTES.md 第 28 節): 委任 / 指定目的地 / 自動航行 (1fd9 段的地點路線, 艦隊 AI 共用)、偵察、航海圖、隨身物 地圖
// 他艦隊 (6aae / 1afe8 = 艦隊 AI) → game/fleetai.js (第 29 節)
// 上陸探索 (34d54 / 34ccc) → scenes/land.js、海上特殊地點 (30e9f / 31047) → 本檔 seaEvent / monsterRead (第 36 節)
import { PortScene } from "./port.js";
import { Buildings } from "./buildings.js";
import { Commands } from "./commands.js";
import { seaNegotiate } from "./negotiate.js";
import { NavalBattle } from "./battle.js";
import { marketTradeLog } from "./market.js";
import { WorldMap } from "../gfx/worldmap.js";
import { CellSelect } from "../ui/cellsel.js";
import { FleetAI } from "../game/fleetai.js";
import { Land } from "./land.js";
import { DS, OFF } from "../model/schema_views.ts";
import { WorkDS } from "../model/flags.ts";
import { renderWideSea, hitWideCommandButton } from "../canvas_ui/wide_world.ts";
import { createDomModal, hasDom, runDomInfoLines, runDomStoryCard } from "../modern/dom_ui.ts";
import { captureConsoleText, decodeCleanCstr, toSimp } from "../canvas_ui/text_util.ts";

const seaHex = s => { const b = Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16))), o = new Uint8Array(b.length + 1); o.set(b); return o; };
const seaS16 = v => (v << 16) >> 16;
const seaS8 = v => (v << 24) >> 24;
const seaUmin = (a, b) => ((a & 0xffff) > (b & 0xffff) ? b & 0xffff : a & 0xffff);   // seg0:4d7c
const seaUmax = (a, b) => ((a & 0xffff) < (b & 0xffff) ? b & 0xffff : a & 0xffff);   // seg0:4d87
const seaSgn = v => (v < 0 ? -1 : v > 0 ? 1 : 0);                                    // seg0:4dde
const seaWarned = new Set();
const seaTodo = n => { if (!seaWarned.has(n)) { seaWarned.add(n); console.warn("尚未移植: " + n); } };

export class SeaScene extends PortScene {
  constructor(ctx, P) {
    super(ctx, P);
    const S = P.sea;                                                     // assets/data/sea.json (tools/extract_sea.py)
    this.SJ = S; this.SS = Object.fromEntries(Object.entries(S.str).map(([k, v]) => [k, seaHex(v)]));
    this.seaMonths = S.months.map(seaHex);                              // DS:8af0 月份字串
    this.wm = new WorldMap(P.worldmap, S);
    this.seaBuf = new Uint8Array(0x2400);                                // [03f4]:[03f6]
    this.region = 0xffff; this.item = 0xff; this.bda6 = 0; this.bdaa = 0;   // DS 初值: [06c8] = FFFF、[06ca] = FF、[bda6] = [bdaa] = 0
    this.speed = 0; this.sight = 0; this.a9c8 = 0; this.bda8 = 0; this.btnX = 0; this.btnY = 0;
  }
  get fleet() { return DS.TBL_FLEET + ((0x85 * this.st.u8(this.st.personRecord(this.st.hero) + 0x2c)) & 0xffff); }   // [c2d4] (162e3)
  get b() { return (this.buildings ??= new Buildings(this)); }
  get ai() { return (this.fleetAI ??= new FleetAI(this)); }             // 艦隊 AI (game/fleetai.js)
  get mapBuf() { return this.map || this.seaBuf; }                      // [03f6]: 在港時是港口地圖 (艦隊 AI 的陸地判斷照樣讀它, 原版如此)
  slotOf(i) { return i < 10 ? (this.fleet + 0x2b + 9 * i) & 0xffff : 0x572a + 9 * i; }   // seg0:5c58
  crewOf(i) { return DS.TBL_CREW_SLOT + ((0x1e * i) & 0xffff); }                                    // seg0:5c38
  shipRec(n) { return DS.TBL_SHIP + ((0x16 * n) & 0xffff); }                                   // seg0:5c7a
  typeOf(t) { return DS.TBL_SHIP_TYPE + ((0x0c * t) & 0xffff); }                                    // seg0:5c8a
  present(i) { return (this.st.u8(this.slotOf(i) + 8) & 0x30) === 0x10; }
  loadSum(i) { const st = this.st, S = this.slotOf(i); return (this.b.cargoUsed(i) + st.u8(S + 6) + st.u16(S)) & 0xffff; }   // seg0:5d8b
  wx(F) { return seaS16(this.st.u16(F)); } wy(F) { return seaS16(this.st.u16(F + OFF.FLEET.Y)); }
  get vx1006() { return seaS16(this.st.u16(DS.SEA_VIEW_X)); } set vx1006(v) { this.st.set16(DS.SEA_VIEW_X, v); }
  get vy1008() { return seaS16(this.st.u16(DS.SEA_VIEW_Y)); } set vy1008(v) { this.st.set16(DS.SEA_VIEW_Y, v); }

  // ================= 出港 (碼頭 27a07 之後) =================
  // 0fea:9348 = 191e8 糧食 / 0fea:9401 = 192a1 水: 每艘船從自己 (沒有時從第一艘還有的船) 扣一天的量
  //   量 = (配給% × 水手) 的低 16 位元 / ([1005]&0x18 ? 200 : 100) + 1; 士氣扣在「供應的那艘船」上 (原版如此), 降到 20 以下時「本船」的水手逃走 (19016)
  //   全艦隊都沒有時本船士氣 −min(16, 士氣) (191ba)
  dailySupply(off, rate) {
    const st = this.st;
    for (let i = 0; i < 10; i++) {
      if (!this.present(i)) continue;
      let found = 0xff;
      if (st.u16(this.crewOf(i) + off)) found = i;
      else for (let j = 0; j < 10; j++) if (this.present(j) && st.u16(this.crewOf(j) + off)) { found = j; break; }
      if (found !== 0xff) this.consume(found, i, off, rate); else this.starve(i);
    }
  }
  foodDaily() { this.dailySupply(2, 0x2e1a); }                          // 191e8
  waterDaily() { this.dailySupply(0, 0x2e19); }                         // 192a1
  // 19056 / 19109
  consume(found, i, off, rateAddr) {
    const st = this.st, M = this.crewOf(found), P = st.personRecord(st.u8(M + OFF.CREW_SLOT.CAPTAIN)), rate = st.u8(rateAddr);
    const div = (st.u8(DS.SEA_FLAGS2) & 0x18) ? 200 : 100;
    const amt = seaUmin(Math.floor(((rate * st.u16(this.slotOf(i))) & 0xffff) / div) + 1, st.u16(M + off));
    st.set16(M + off, st.u16(M + off) - amt);
    const v = seaS16(100 - Math.floor(st.u8(P + OFF.PERSON.STATS) / 5) - rate);
    const d = Math.trunc(v / (v > 0 ? 5 : 10));
    let m = st.u8(M + OFF.CREW_SLOT.MORALE) - d;
    m = m < 0 ? 0 : m > 100 ? 100 : m;
    st.set8(M + OFF.CREW_SLOT.MORALE, m);
    if (m < 0x14) this.desert(i);
  }
  // 191ba
  starve(i) { const st = this.st, M = this.crewOf(i); st.set8(M + OFF.CREW_SLOT.MORALE, st.u8(M + OFF.CREW_SLOT.MORALE) - seaUmin(16, st.u8(M + OFF.CREW_SLOT.MORALE))); if (st.u8(M + OFF.CREW_SLOT.MORALE) < 0x14) this.desert(i); }
  // 19016 士氣 < 20: 水手 −min(⌊(20 − 士氣) × 水手 / 100⌋ + 1, 水手)
  desert(i) {
    const st = this.st, M = this.crewOf(i), S = this.slotOf(i), n = seaS16(st.u16(S));
    const loss = (Math.trunc(Math.imul(20 - st.u8(M + OFF.CREW_SLOT.MORALE), n) / 100) + 1) & 0xffff;
    st.set16(S, st.u16(S) - seaUmin(loss, st.u16(S)));
  }

  // ================= 進入海上 seg0:851f =================
  async enterSea() {
    const { palette, sys, graph, state: st, con } = this.c;
    if (palette.ending) { await palette.fadeBlack(); return; }
    // 地點表 [0c96] (DATA1 #4, [bd7e] = DATA1 #5 筆): DS:1046 位元表中已探索的地點 +1 |= 0x80 (執行期緩衝, 不在存檔內)
    const N = this.nodes;
    for (let i = 0; i < this.SJ.nodeCount; i++) if ((st.u8(DS.EXPLORE_LOC + (i >> 3)) & (0x80 >> (i & 7))) && N.length > i * 16 + 1) N[i * 16 + 1] |= 0x80;
    this.bda8 = 0;
    for (let i = 0; i < 0x14; i++) { const v = st.u8(DS.INVENTORY + i); if (v === 0x18) this.bda8 |= 0x80; else if (v === 0x19) this.bda8 |= 0x40; }
    st.set8(DS.PORT, 0xff);
    this.item = Math.trunc(this.vx1006 / 0x2d0) & 0xff;               // [06ca]
    // 849a: WORLDMAP 第 [06ca] 項 → [06ce]; 84de: DATA1 #11 → [03ee] (海上圖塊與船隻精靈); DATA1 #7 → [0c86]+0x3ea0 (羅盤指針)
    await palette.fadeBlack();                                         // 99f2 (先淡黑再切換海圖緩衝，避免切換瞬間閃出錯位圖塊)
    if (this.map && this.map !== this.seaBuf) this.seaBuf.set(this.map.subarray(0, 0x2400));   // [03f6] 原本是出港港口的 PORTMAP
    this.map = this.seaBuf; this.chipSetName = "seachip"; this.tileCache.clear();
    this.c.bgm.playSong(st.u8(DS.HERO) + 4);                            // 9670 主角的海上曲目
    sys.mouseHide();
    // 9630: [03d5] 恆為 1, 不動作
    con.right = 0x50;                                                  // [8a22]
    this.c.scr.clear(0);
    this.seaDate();                                                    // 71ad / 71c6 / 71f0
    this.clearCache();                                                 // 2103
    this.region = 0xffff;
    this.seaView();                                                    // 6b30
    palette.selectTimePalette(this.time, true, st.u8(DS.WEATHER));         // 0fea:98ce = 1976e
    this.c.scr.setAtmosphere?.({ active: true, atSea: true, weather: st.u8(DS.WEATHER) & 15 });
    this.c.scr.wideRenderer = (ctx, scr) => renderWideSea(ctx, scr, this);
    this.a9c8 = 0;
    this.seaPanel();                                                   // 8067
    this.needle = 0xff;
    if ((st.u8(DS.WEATHER) & 15) === 1) this.stormSound();                // 9768(DS:0c5a) + 9804(0x30)
    sys.mouseShow();
    await palette.fadeToTarget();
  }
  // 9768(DS:0c5a) + 9804(0x30) FM 效果音 (暴風雨, 持續到 9888; core/sfx.js)
  stormSound() { this.c.sfx?.voice(0x0c5a); this.c.sfx?.note(0x30); }

  // ================= 畫面 =================
  // 7180: (col, 0x10) 印 %2d (v+1); 只在海上
  seaNum(col, v) { if (this.c.scr.wideRenderer) return; const { con, printf } = this.c; con.right = 0x4f; con.setCursor(col, 0x10); printf(this.SS.day2, v + 1); }
  // 71ad 年 / 71c6 月 / 71f0 日 (只在海上; 主迴圈 1623a 在每年 / 每月 / 每天開始時也各呼叫一次)
  seaYear() { if (this.port === 0xff && !this.c.scr.wideRenderer) this.seaNum(0x43, this.c.rt.year + 0x5dc); }
  seaMonth() { if (this.port === 0xff && !this.c.scr.wideRenderer) { const { con, printf, rt } = this.c; con.setCursor(0x48, 0x10); printf(this.SS.month, this.seaMonths[rt.month]); } }
  seaDay() { if (this.port === 0xff && !this.c.scr.wideRenderer) this.seaNum(0x4c, this.c.rt.day); }
  seaDate() { if (this.c.scr.wideRenderer) return; this.seaYear(); this.seaMonth(); this.seaDay(); }
  // 6b30 / 6cfc / 3197c 共用: 主角所在的 3×3 海域格區域 → bda6 / bdaa (地圖格) 與區域編號
  regionOf() {
    const F = this.fleet;
    let cx = (Math.trunc(this.wx(F) / 24) % 30) - 1, cy = (Math.trunc(this.wy(F) / 24) % 45) - 1;
    cx = cx < 0 ? 0 : cx > 0x1b ? 0x1b : cx; cy = cy < 0 ? 0 : cy > 0x2a ? 0x2a : cy;
    this.bda6 = 24 * cx; this.bdaa = 24 * cy;
    return 30 * cy + cx;
  }
  // 1fd9:2fd2 = 22d62 解碼區域
  decodeRegion(si) { this.wm.decode(this.st, this.item, si & 0xffff, this.seaBuf); }
  // 6bce..6caa / 6d9b..6e5a: 主角周圍 3×3 海域格記入探索表 DS:0de8 (45 列 × 12 bytes), 新探索的格 [100e]++ [1010]++
  explore() {
    const st = this.st, F = this.fleet;
    const cx0 = (Math.trunc(this.wx(F) / 24) + 0x59) % 0x5a;
    let ry = Math.trunc(this.wy(F) / 24) - 1;
    for (let k = 0; k < 3; k++, ry++) {
      if (ry < 0 || ry >= 0x2d) continue;
      for (let j = 0, cx = cx0; j < 3; j++, cx = (cx + 1) % 0x5a) {
        const a = WorkDS.EXPLORE_MAP + 12 * ry + (cx >> 3), m = 0x80 >> (cx & 7);
        if (!(st.u8(a) & m)) { st.set16(WorkDS.EXPLORE_TOTAL, st.u16(WorkDS.EXPLORE_TOTAL) + 1); st.set16(WorkDS.EXPLORE_UNREP, st.u16(WorkDS.EXPLORE_UNREP) + 1); }
        st.set8(a, st.u8(a) | m);
      }
    }
  }
  // 6aae 區域改變時處理區域內的他艦隊 (game/fleetai.js regionChange)
  fleetsRegion() { if (!this.c.noFleets) this.ai.regionChange(); }
  viewOffset() {
    this.bdba = ((this.vy1008 - this.bdaa) * 0x60 + (this.vx1006 % 0x2d0) - this.bda6) & 0xffff;
  }
  // 6b30 重新取得區域並畫地圖 (不畫船)
  seaView() {
    const si = this.regionOf();
    if (this.region !== si) { this.region = si; this.decodeRegion(si); this.fleetsRegion(); this.explore(); }
    this.viewOffset();
    this.clearCache();
    this.drawMap();                                                    // 1fac
    this.seaPanel();                                                   // 8067
  }
  // 24bc 32×32 海上船隻精靈 (sea_ships.png 透明圖集)
  sprite(col, y, off) {
    if (col < 0 || col + 4 > 80 || y < 0 || y + 32 > 400) { seaTodo("精靈超出畫面"); return; }
    const idx = (off - 0x4000) >> 9;
    this.c.art?.drawSheetTile(this.c.scr, "sea_ships", idx, col * 8, y, { transparent: true });
  }
  // 艦隊 k 的精靈 (6f07..6f88 主角單獨 / 7080..7137 全部艦隊)
  drawFleet(F, k, heroOnly) {
    const st = this.st, dx = this.wx(F) - this.vx1006, dy = this.wy(F) - this.vy1008, T = this.SJ.tab.shipDir;
    let si;
    if (F === this.fleet) {
      let i = 0; while (i < 10 && st.u8(this.crewOf(i) + 0x1b) !== st.u8(DS.HERO)) i++;   // 旗艦 = 船長是主角的船位
      si = (st.u8(this.shipRec(st.u8(this.slotOf(i) + 7)) + 0x10) & 0x10) << 8;
    } else si = (((st.u8(this.shipRec(st.u8(F + 0x32)) + 0x10) & 0x10) << 8) + 0x2000) & 0xffff;
    const d = T[st.u8(F + OFF.FLEET.DIR) & 7] + 0x10;
    si = heroOnly ? (si + (((d * 2 + (this.time & 1)) << 9) & 0xffff)) & 0xffff : (si + ((d << 10) & 0xffff) + (((k + this.time) & 1) << 9)) & 0xffff;
    this.sprite((dx + 6) * 2, dy * 16 + 8, si);
    this.invalidate(24 * dy + dx);                                     // 2119
  }
  // 6cfc 每個時刻的海上畫面: 區域、探索、延遲 ([0ca6] 海上速度)、地圖、艦隊、日期、風向/海流/航向、船速、游標
  async seaTick() {
    const { sys, menu, con, printf } = this.c, st = this.st;
    const si = this.regionOf();
    if (this.region !== si) { this.region = si; this.decodeRegion(si); this.fleetsRegion(); this.explore(); }
    // 507c: 空函式
    this.toggle ^= 1;
    this.viewOffset();
    if (st.u8(DS.SEA_SPEED)) {
      sys.timer.set(st.u8(DS.SEA_SPEED));
      while (sys.timer.get()) { if (menu.source()) break; await sys.poll(); }
    }
    sys.mouseHide();
    this.drawMap();
    const w = st.u8(DS.WEATHER) & 15;
    if (w === 0 || w === 2) {
      for (let row = 0; row < 0x17; row++) for (let k = 0; k < 0x46; k++) {
        const F = DS.TBL_FLEET + k * 0x85, dx = this.wx(F) - this.vx1006, dy = this.wy(F) - this.vy1008;
        if (dx < 0 || dx >= 0x17 || row !== dy) continue;
        if (st.u8(F + OFF.FLEET.FLAGS) & 0x10 || !(st.u8(F + OFF.FLEET.FLAGS) & 1)) continue;
        if (this.landAt(this.wx(F), this.wy(F))) continue;
        this.drawFleet(F, k, false);
      }
    } else this.drawFleet(this.fleet, 0, true);
    this.seaDate();
    this.dials();                                                      // 8fbf
    if (!this.c.scr.wideRenderer) { con.setCursor(0x45, 0xd0); printf(this.SS.speed, (this.speed + 1) >> 1); }
    this.seaCursor();
    sys.mouseShow();
    // 507d: 空函式
  }
  // 6fbe..716b 游標: 地圖視窗內依滑鼠所在的 3×3 區塊顯示方向游標 (DS gfx 0x2960 + (列內欄 − 3×列) × 0x90), 否則 0x2b10
  seaCursor() {
    const { sys } = this.c, p = sys.mousePos(), x = p.x - 0x60, y = p.y - 8;
    let si = 0x2b10;
    if (x >= 0 && x < 0x180 && y >= 0 && y < 0x180) si = (0x2960 + ((x >> 7) - 3 * (y >> 7)) * 0x90) & 0xffff;
    if (this.cursor !== si) { this.cursor = si; sys.setCursorShape(si); }
  }
  // 8fbf 風向 (y 0x40)、海流 (0x70)、航向 (0xa0, 不印數字) 的轉盤
  dials() {
    if (this.port !== 0xff) return;
    const st = this.st, a = st.u8(DS.PORT_FLAGS), b = st.u8(DS.WIND_CUR);
    this.dial(0x40, (a & 0x38) >> 3, a & 7);
    this.dial(0x70, (b & 0x38) >> 3, b & 7);
    this.dial(0xa0, st.u8(this.fleet + 0x1a), 0xffff);
  }
  // 8f4f(y, 方向, 強度): 強度 ≠ 0 且方向 < 8 → gfx + 0x490 + 方向 × 0x320, 否則 0x1d90 (5 欄 × 0x28 行); 強度 >= 0 (有號) 時於 (0x43, y+0x18) 印出
  dial(y, dir, str) {
    if (this.c.scr.wideRenderer) return;
    const { scr, con, printf, art } = this.c;
    const idx = str !== 0 && dir < 8 ? dir : 8;
    art?.drawSheetTile(scr, "dials", idx, 0x47 * 8, y);
    if (seaS16(str) >= 0) { con.setCursor(0x43, y + 0x18); printf(this.SS.dialNum, str); }
  }
  // 3135c (x, y) 的 2×2 地圖格中有 >= 0x34 的圖塊 (陸地)
  landAt(x, y) {
    const o = ((seaS16(y) - this.bdaa) * 0x60 + (seaS16(x) % 0x2d0) - this.bda6) & 0xffff, B = this.mapBuf, g = i => B[i & 0xffff] ?? 0;
    return g(o) >= 0x34 || g(o + 1) >= 0x34 || g(o + 0x60) >= 0x34 || g(o + 0x61) >= 0x34 ? 1 : 0;
  }

  // 8067 左側面板: 狀態條 (轉向力/推進力/耐久度/吃水量/瞭望範圍/水手/船艦狀態)、貨物 (水/糧食/資材/砲彈)、出港天數; 同時算出瞭望範圍 [bdca]
  //   (各船的 +0a 總載重在這裡重算寫回); 只在海上畫, 畫兩次
  seaPanel() {
    const st = this.st, { con, printf, sys } = this.c;
    if (this.port !== 0xff) return;
    con.right = 0x4f;
    con.puts(this.SS.dateColor);
    const F = this.fleet, T = this.SJ.tab.windSpeed;
    let minSpd = 10000, slowSlot = this.slotOf(0), slowIdx = 0, minDur = 100, maxLook = 0, crewSum = 0, maxCrewSum = 0, morale = 0;
    const sums = [0, 0, 0, 0];
    const row = ((Math.abs(((st.u8(DS.PORT_FLAGS) & 0x38) >> 3) - st.u8(F + OFF.FLEET.DIR)) & 0xff) * 8);
    for (let i = 0; i < 10; i++) {
      const S = this.slotOf(i);
      if ((st.u8(S + 8) & 0x30) !== 0x10) continue;
      const ship = this.shipRec(st.u8(S + 7)), t = st.u8(ship + 0x0f), Ty = this.typeOf(t), t5 = st.u8(Ty + 5);
      const crew = seaS16(st.u16(S));
      crewSum = (crewSum + st.u16(S)) & 0xffff; maxCrewSum = (maxCrewSum + st.u16(ship + 0x12)) & 0xffff;
      const M = this.crewOf(i), drv = st.u8(M + OFF.CREW_SLOT.LOOK_RATIO);
      const load = this.loadSum(i); st.set16(M + OFF.CREW_SLOT.LOAD_TOTAL, load);
      const cap = seaS16(st.u16(Ty + 6));
      const P = st.personRecord(st.u8(M + OFF.CREW_SLOT.CAPTAIN)), nav = st.u8(P + OFF.PERSON.NAV_LEVEL), sk = st.u8(P + 0x1d);
      morale += crew * st.u8(M + OFF.CREW_SLOT.MORALE);
      const w2 = seaS16(T[row + t] * st.u8(S + 5));
      const q = seaUmin(100, Math.trunc((drv * crew) / t5) & 0xffff);
      const c = seaUmin(0x96, (0xb4 - seaUmin(0xb4, Math.trunc(seaS16(Math.imul(100, seaS16(load))) / cap))) & 0xffff);
      let u = Math.trunc(seaS16(Math.imul(q, w2)) / 100) & 0xffff;
      u = Math.floor(((u * c) & 0xffff) / 100);
      const v1 = seaUmin(30, (Math.trunc(seaS16(Math.imul(u, nav)) / 10) + u) & 0xffff);
      const spd = seaUmin(40, Math.trunc(seaS16(Math.imul(v1, sk)) / 75) & 0xffff);
      if (spd < minSpd) { minSpd = spd; slowSlot = S; slowIdx = i; }
      if (st.u8(S + 2) < minDur) minDur = st.u8(S + 2);
      const lk = (st.u8(M + OFF.CREW_SLOT.NAV_RATIO) * st.u16(S)) & 0xffff; if (lk > maxLook) maxLook = lk;
      for (let k = 0; k < 4; k++) sums[k] = (sums[k] + st.u16(M + 2 * k)) & 0xffff;
    }
    const sT = st.u8(this.shipRec(st.u8(slowSlot + 7)) + 0x0f);
    const sLoad = seaS16(st.u16(this.crewOf(slowIdx) + 0x0a)), sCap = seaS16(st.u16(this.typeOf(sT) + 6));
    const loadPct = Math.trunc((sLoad * 100) / sCap);                  // 3722 有號長整數除法
    const avgMorale = crewSum ? Math.trunc(morale / crewSum) : 0;
    this.sight = (Math.imul(this.bda8 & 0x80 ? 2 : 1, seaUmin(12, Math.floor(maxLook / 100))) & 0xffff);   // [bdca]
    this._seaStats = {
      turn: st.u8(slowSlot + 4),
      prop: st.u8(slowSlot + 5),
      minDur,
      loadPct,
      sight: this.sight,
      sightPct: Math.trunc((100 * this.sight) / 24),
      crewSum,
      maxCrewSum,
      morale: avgMorale,
      water: Math.floor(sums[0] / 10),
      food: Math.floor(sums[1] / 10),
      lumber: seaS16(sums[2]),
      ammo: seaS16(sums[3]),
      daysAtSea: st.u8(DS.DAYS_AT_SEA),
    };
    this.c.hud?.updateSea(this._seaStats);
    if (this.c.scr.wideRenderer) return;
    sys.mouseHide();
    const B = (y, v) => this.commandsObj().bar(2, y, seaS16(v));            // seg0:92f7
    for (let n = 0; n < 2; n++) {
      B(0x48, st.u8(slowSlot + 4)); B(0x60, st.u8(slowSlot + 5)); B(0x78, minDur); B(0x90, loadPct);
      B(0xa8, Math.trunc((100 * this.sight) / 24));
      if (!maxCrewSum) maxCrewSum = 1;
      if (!crewSum) crewSum = 1;
      B(0xc0, Math.trunc((seaS16(crewSum) * 100) / seaS16(maxCrewSum)));
      B(0xd8, Math.trunc(morale / seaS16(crewSum)));
      for (let k = 0; k < 2; k++) { con.setCursor(6, k * 32 + 0x108); printf(this.SS.n5, Math.floor(sums[k] / 10)); }
      for (let k = 2; k < 4; k++) { con.setCursor(6, k * 32 + 0x108); printf(this.SS.n5b, seaS16(sums[k])); }
      con.setCursor(0x45, 0xf0); printf(this.SS.n3, st.u8(DS.DAYS_AT_SEA));
    }
    sys.mouseShow();
  }
  commandsObj() { return (this.commands ??= new Commands(this)); }

  async runSeaCmd(cmd) {
    const { sys, con } = this.c;
    sys.mouseHide();
    const cm = this.commandsObj();
    this.c.menu.wideAnchorCmd = cmd;
    try {
      await [() => cm.info(), () => cm.manage(), () => cm.order(), () => cm.nav()][cmd]();
    } finally {
      this.c.menu.wideAnchorCmd = -1;
      sys.mouseShow();
    }
    if (this.timeAbort()) return;
    con.left = 0; con.right = 0x50;
    if (!this.c.palette.ending) this.seaPanel();
    if (this.a9c8 & 1) await this.c.menu.waitRelease();
    this.a9c8 &= 0xfc;
  }
  // ================= 海上時刻 1fd9:13c1 = 21151 (輸入) =================
  async seaInput() {
    const { sys, menu, scr } = this.c;
    if (this.pendingCmd !== undefined) {
      const cmd = this.pendingCmd; this.pendingCmd = undefined;
      await this.runSeaCmd(cmd);
      return;
    }
    const steerFromViewPos = (vx, vy) => {
      // 以主角船隻實際畫面座標為中心計算 8 方向（靠近地圖邊緣時也能精準轉向）
      let cx = 640, cy = 360;
      const cam = scr._wideSeaCam;
      if (cam) {
        let dxw = this.wx(this.fleet) - cam.baseWX;
        if (dxw < -cam.worldW / 2) dxw += cam.worldW;
        else if (dxw > cam.worldW / 2) dxw -= cam.worldW;
        const dyw = this.wy(this.fleet) - cam.baseWY;
        cx = (dxw - cam.camX) * cam.tile + cam.tile;
        cy = (dyw - cam.camY) * cam.tile + cam.tile;
      }
      const dx = vx - cx, dy = vy - cy;
      if (Math.hypot(dx, dy) < 36) {
        this.a9c8 &= 0xfd;
        return 0x35;                    // 點擊主角船隻自身 = 按 '5' 指定目的地
      }
      const deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360;
      const oct = Math.floor(((deg + 22.5) % 360) / 45);
      this.a9c8 &= 0xfd;
      return [0x38, 0x39, 0x36, 0x33, 0x32, 0x31, 0x34, 0x37][oct];
    };
    const translateSeaKey = k => {
      if (k === 0x1e) return 0x38;      // ↑ -> 北 (8)
      if (k === 0x1f) return 0x32;      // ↓ -> 南 (2)
      if (k === 0x1d) return 0x34;      // ← -> 西 (4)
      if (k === 0x1c) return 0x36;      // → -> 東 (6)
      if (k === 0xff && scr.wideRenderer && sys.mouse?.vx !== undefined) {
        sys.mouse.lastClick = null;
        return steerFromViewPos(sys.mouse.vx, sys.mouse.vy);
      }
      if (!k && scr.wideRenderer && sys.mouse?.lastClick) {
        const lc = sys.mouse.lastClick;
        sys.mouse.lastClick = null;
        if (performance.now() - lc.t < 600) return steerFromViewPos(lc.vx, lc.vy);
      }
      return k;
    };
    let key = translateSeaKey(this.readInput());                       // 210f1
    if (key === 0xff && !this.c.scr.wideRenderer) {
      this.a9c8 |= 2;
      const p = sys.mousePos(), x = p.x - 0x60, y = p.y - 8;
      if (x >= 0 && x < 0x180 && y >= 0 && y < 0x180) {
        key = ((x >> 7) + 3 * ((0x180 - y) >> 7) + 0x31) & 0xff;
        this.a9c8 &= 0xfd;
      }
    }
    if (key === 0x30 || key === 0x1b) this.a9c8 |= 1;
    if (this.a9c8 & 1) { key = 0; this.cursor = 0x2570; sys.setCursorShape(0x2570); await menu.waitRelease(); }
    for (;;) {
      if (this.pendingCmd !== undefined) {
        const cmd = this.pendingCmd; this.pendingCmd = undefined;
        await this.runSeaCmd(cmd);
        if (this.timeAbort()) return;
        if (!(this.a9c8 & 1)) return;
        continue;
      }
      if (this.a9c8 & 1) key = translateSeaKey(this.readInput());
      if (key || (this.a9c8 & 2)) { await this.seaButton(key); if (this.timeAbort()) return; }
      if (!(this.a9c8 & 1)) return;
      await sys.poll();
    }
  }
  // 21008 海上畫面按鈕 (DS:a9d8, 13 個 × 9 bytes: x, y, w, h, 鍵): 0..7 舵輪方向, 8 中央 (指定目的地), 9..12 情報/經營/命令/航海術
  async seaButton(key) {
    const { sys, con } = this.c, st = this.st, B = this.SJ.tab.buttons;
    const m = sys.mouse;
    if (this.c.scr.wideRenderer && key === 0xff && (this.a9c8 & 3) && m?.vx !== undefined) {
      const cmd = hitWideCommandButton(m.vx, m.vy);
      if (cmd >= 0) {
        sys.mouseHide();
        const cm = this.commandsObj();
        this.c.menu.wideAnchorCmd = cmd;
        try {
          await [() => cm.info(), () => cm.manage(), () => cm.order(), () => cm.nav()][cmd]();
        } finally {
          this.c.menu.wideAnchorCmd = -1;
          sys.mouseShow();
        }
        if (this.timeAbort()) return;
        con.left = 0; con.right = 0x50;
        if (!this.c.palette.ending) this.seaPanel();
        if (this.a9c8 & 1) await this.c.menu.waitRelease();
        this.a9c8 &= 0xfc;
        return;
      }
    }
    const p = sys.mousePos(); this.btnX = p.x; this.btnY = p.y;
    let di = 13;
    if (key && key !== 0xff) {
      for (let i = 0; i < 13; i++) {
        if (key === B[i * 9 + 8]) { di = i; break; }
      }
    }
    if (di === 13 && !this.c.scr.wideRenderer) {
      di = 0;
      for (; di < 13; di++) {
        const o = di * 9, i16 = k => seaS16(B[o + k] | (B[o + k + 1] << 8)), x0 = i16(0), y0 = i16(2), w = i16(4), h = i16(6);
        if (key === B[o + 8]) break;
        if ((this.a9c8 & 3) && x0 <= this.btnX && x0 + w >= this.btnX && y0 <= this.btnY && y0 + h >= this.btnY) break;
      }
    }
    if (di < 13 && !((st.u8(DS.SEA_FLAGS2) & 0x18) && di < 9)) {
      if (di < 8) this.steer(di);                                       // 20fec
      else if (di === 8) await this.chooseDest();                        // 2e09:310b
      else {
        sys.mouseHide();
        const cm = this.commandsObj();
        cm.press(di - 9);                                               // seg0:9396
        await [() => cm.info(), () => cm.manage(), () => cm.order(), () => cm.nav()][di - 9]();   // DS:aa4e 遠程函式表
        cm.release(di - 9);                                             // seg0:937e
        sys.mouseShow();
        if (this.timeAbort()) return;
        con.left = 0; con.right = 0x50;                                 // [8a20] = 0, [8a22] = 0x50
      }
      if (!this.c.palette.ending) this.seaPanel();                      // 8067
    }
    if (this.a9c8 & 1) await this.c.menu.waitRelease();
    this.a9c8 &= 0xfc;
  }
  // 20fec 轉舵: [1005] &= 0x5f, 方位 = d, 95f2(d)
  steer(d) { const st = this.st; st.set8(DS.SEA_FLAGS2, st.u8(DS.SEA_FLAGS2) & 0x5f); st.set8(this.fleet + 0x1a, d); this.helm(d); }
  // 95f2 舵輪指針 [8c1d]
  helm(d) {
    if (this.needle === d) return;
    const { sys, state: st } = this.c;
    sys.mouseHide();
    this.helmDraw(0);
    if (st.options & 1) { this.needle = d; this.helmDraw(9); } else this.needle = 0xff;
    sys.mouseShow();
  }
  // 9537(base): seacompass.png 第 (指針 + base) 張
  helmDraw(base) {
    const n = this.needle; if (n === 0xff) return;
    const col = n > 4 ? 0x3e : n === 0 || n === 4 ? 0x43 : 0x48, y = n < 2 || n === 7 ? 0x110 : n === 2 || n === 6 ? 0x138 : 0x160;
    this.c.art?.drawSheetTile(this.c.scr, "seacompass", n + base, col * 8, y);
  }
  cellSel() { return (this.c.cellSel ??= new CellSelect(this.c)); }
  // 2e09:310b = 3119b 指定目的地 (舵輪中央 '5' / 委任到達後未進港): [1005] |= 20 (停船), 游標 = 十字 0x2840 ([06d6]);
  //   還沒委任時以 seg0:7925 標籤框 (0x1b, 0xc8, 0x12, 0x20) 印「請指定目的地」([8a24] = FFFF 期間印出; 沒有其他地方讀它);
  //   0fea:5f74 地圖視窗 24 × 24 格 (2 × 2 游標, 起點 = 主角) 選格 → 取消回傳 0; 選定 → +4/+6 = 該格,
  //   該格是港口 (1bb4a) → 23e19 換成附近可到達的海面; +0c = 0x6000, [1005] = (&DF) | 0x80, 回傳 1
  async chooseDest() {
    const st = this.st, { sys, win, con, printf } = this.c, F = this.fleet;
    st.set8(DS.SEA_FLAGS2, st.u8(DS.SEA_FLAGS2) | 0x20);
    sys.mouseHide();
    this.cursor = 0x2840; sys.setCursorShape(0x2840);                 // [06d6] = 0x2840, seg0:5050
    const deleg = st.u8(DS.SEA_FLAGS2) & 0x80;
    const isWide = !!this.c.scr.wideRenderer;
    if (!deleg) {
      if (isWide) this.cellSel().widePrompt = "请指定目的地";
      else { win.labelBox(0x1b, 0xc8, 0x12, 0x20); printf(this.SS.destPrompt); con.right = 0x50; }
    }
    await this.c.menu.waitRelease();                                   // 0fea:3343 = 131e3
    const init = (Math.imul(0x18, seaS16(st.u16(F + OFF.FLEET.Y) - this.vy1008)) - this.vx1006 + st.u16(F)) & 0xffff;
    const si = await this.cellSel().select(0x60, 8, 0x18, 0x10, 0x10, 0x18, seaS16(init));
    if (sys.mouse) sys.mouse.lastClick = null;
    if (!deleg && !isWide) await win.close();
    sys.mouseShow();
    if (si === -1) return 0;
    const x = (si % 0x18) + this.vx1006, y = Math.trunc(si / 0x18) + this.vy1008;
    st.set16(F + OFF.FLEET.DEST_X, x); st.set16(F + OFF.FLEET.DEST_Y, y);
    if (this.portIdAt(x, y) !== 0xffff) { const W = this.ptLocal(x, y); this.nearSea(F, W); st.set16(F + OFF.FLEET.DEST_X, W.x); st.set16(F + OFF.FLEET.DEST_Y, W.y); }
    st.set16(F + OFF.FLEET.ROUTE_FLAGS, 0x6000);
    st.set8(DS.SEA_FLAGS2, (st.u8(DS.SEA_FLAGS2) & 0xdf) | 0x80);
    return 1;
  }

  // ================= 1afe8 他艦隊的海上移動 (艦隊 AI, game/fleetai.js seaTick) =================
  // 每支艦隊先查一次滑鼠右鍵 (按下 → [a9c8] |= 1 暫停); 主角與未出航 (+29 bit0 = 0) 的略過
  async fleetsMove() { await this.ai.seaTick(); }

  // ================= 2e09:38ec = 3197c 主角艦隊移動 =================
  // 316b3 本時刻航向: 委任 ([1005]&0xc0) → 自動航行; 停船 (0x20) → 8; 否則 +1a
  //   委任中到達目的地 (+0/+2 = +4/+6, 1fd9:33d4) → 0fea:c0d9 靠港 (隱藏游標), [1005] &= 7F; 進了港 → 回傳 0;
  //   沒進港 → 3119b 再指定目的地 (此時 [1005] bit7 已清, 會顯示「請指定目的地」); 之後 313b1 求方向 (−1 或 > 7 → [1005] &= 7F, 停船)
  async heading() {
    const st = this.st, F = this.fleet, f = st.u8(DS.SEA_FLAGS2), { sys } = this.c;
    if (!(f & 0xc0)) return f & 0x20 ? 8 : st.u8(F + OFF.FLEET.DIR);
    if (st.u16(F) === st.u16(F + OFF.FLEET.DEST_X) && st.u16(F + OFF.FLEET.Y) === st.u16(F + OFF.FLEET.DEST_Y)) {
      sys.mouseHide(); await this.dock(); sys.mouseShow();
      st.set8(DS.SEA_FLAGS2, st.u8(DS.SEA_FLAGS2) & 0x7f);
      if (st.u8(DS.PORT) !== 0xff) return 0;
      await this.chooseDest();
    }
    const si = this.autoSteer(F);
    if (si === 0xffff || si > 7) { st.set8(DS.SEA_FLAGS2, st.u8(DS.SEA_FLAGS2) & 0x7f); return 8; }
    st.set8(F + OFF.FLEET.DIR, si);
    return st.u8(F + OFF.FLEET.DIR);
  }

  // ================= 委任航行的路線 (1fd9 段 231c7..241c2, 艦隊 AI 共用) =================
  // 艦隊記錄: +4/+6 目的地  +8/+a 中途點  +0c: 低 3 位元 = 目前的路線格 (0..3), bit4..7 (DS:ae30 = 80/40/20/10) = 路線格 0..3 已填;
  //   +0d 旗標: 80 中途點有效, 40 需重新搜尋路線, 20 直接駛向目的地, 08 路線已到目的地的地點, 02 重設誤差 +0e
  //   +0e 直線步進的誤差累計  +10..+17 路線格 0..3 的地點編號  +1b 種類 (委任時 0)
  // 地點表 [0c96] (DATA1 #4, 每筆 16 bytes: +0 x (bit15 = 已探索, enterSea 設定), +2 y, +4..+0b 4 個鄰點 (FFFF = 無), +0c..+0f 4 個距離)
  pt(a) { const st = this.st; return { get x() { return st.u16(a); }, set x(v) { st.set16(a, v); }, get y() { return st.u16(a + 2); }, set y(v) { st.set16(a + 2, v); } }; }
  ptLocal(x, y) { const o = { _x: x & 0xffff, _y: y & 0xffff, get x() { return this._x; }, set x(v) { this._x = v & 0xffff; }, get y() { return this._y; }, set y(v) { this._y = v & 0xffff; } }; return o; }
  // 地點表 [0c96]: 開始新遊戲 / 讀檔 (1667a) 時由 DATA1 #4 載入, 港內的艦隊 AI 也會用到 (出海前就要有)
  get nodes() { return (this.c.nodesRT ??= Uint8Array.from(this.c.mapNodes ?? new Uint8Array(0))); }
  nodeW(n, off) { const N = this.nodes, o = ((n << 4) + off) & 0xffff; return ((N[o] ?? 0) | ((N[o + 1] ?? 0) << 8)) & 0xffff; }
  // 313b1 自動航行的方向: 到達目的地 → 8; 241c2 失敗 → −1 (0xffff); 目標 = 中途點 (+0d&80) / 目的地 (&20) / 目前路線格的地點;
  //   以 Bresenham 式誤差 (+0e) 在長軸上每步前進、短軸依誤差前進 → DS:b7da[3 dy + dx + 4] (與 ae38 相同的表)
  autoSteer(F) {
    const st = this.st;
    if (st.u16(F) === st.u16(F + OFF.FLEET.DEST_X) && st.u16(F + OFF.FLEET.Y) === st.u16(F + OFF.FLEET.DEST_Y)) return 8;
    if (!this.route(F)) return 0xffff;
    let tx, ty;
    const fd = st.u8(F + 0x0d);
    if (fd & 0x80) { tx = st.u16(F + OFF.FLEET.MID_X); ty = st.u16(F + OFF.FLEET.MID_Y); }
    else if (fd & 0x20) { tx = st.u16(F + OFF.FLEET.DEST_X); ty = st.u16(F + OFF.FLEET.DEST_Y); }
    else { const n = st.u16(F + OFF.FLEET.ROUTE_PTS + 2 * (st.u8(F + OFF.FLEET.ROUTE_FLAGS) & 7)); tx = this.nodeW(n, 0) & 0x7fff; ty = this.nodeW(n, 2); }
    const fx = st.u16(F), fy = st.u16(F + OFF.FLEET.Y);
    const di = Math.abs(seaS16(fx - tx)) & 0xffff, dy = Math.abs(seaS16(fy - ty)) & 0xffff;   // seg0:4d76
    let ex, ey;
    if (st.u8(F + 0x0d) & 2) { st.set16(F + 0x0e, -Math.trunc(seaS16(di) / 2)); st.set8(F + 0x0d, st.u8(F + 0x0d) & 0xfd); }
    if (seaS16(dy) < seaS16(di)) {
      ex = seaSgn(seaS16(tx - fx));
      const e = seaS16(st.u16(F + 0x0e) + dy); st.set16(F + 0x0e, e);
      if (e < 0) ey = 0; else { st.set16(F + 0x0e, e - di); ey = seaSgn(seaS16(ty - fy)); }
    } else {
      ey = seaSgn(seaS16(ty - fy));
      const e = seaS16(st.u16(F + 0x0e) + di); st.set16(F + 0x0e, e);
      if (e < 0) ex = 0; else { st.set16(F + 0x0e, e - dy); ex = seaSgn(seaS16(tx - fx)); }
    }
    return this.SJ.tab.dir3[3 * ey + ex + 4];
  }
  // 1fd9:4432 = 241c2: 已到達目前路線格的地點 → 下一格 (24206); 艦隊在區域內 → 240a7; 否則 (只有艦隊 AI 會走到) 清中途點, 需搜尋時 232a6
  route(F) {
    const st = this.st, di = st.u8(F + OFF.FLEET.ROUTE_FLAGS) & 7, n = st.u16(F + OFF.FLEET.ROUTE_PTS + 2 * di);
    if ((this.nodeW(n, 0) & 0x7fff) === st.u16(F) && this.nodeW(n, 2) === st.u16(F + OFF.FLEET.Y)) this.nextNode(F, di);
    if (this.inRegion(st.u16(F), st.u16(F + OFF.FLEET.Y))) return this.regionRoute(F);
    st.set8(F + 0x0d, st.u8(F + 0x0d) & 0x7f);
    if (!(st.u8(F + 0x0d) & 0x40)) return 1;
    if (st.u8(F + 0x0d) & 8) { st.set8(F + 0x0d, st.u8(F + 0x0d) | 0x20); return 1; }
    return this.routeSearch(F);
  }
  // 24206 / 24112: 清掉路線格 di 的遮罩, 目前格 = (di + 1) & 3, +0d |= 2; 路線格都空了 (+0c & F0 = 0) 時 +0d |= 40 (重新搜尋)
  nextNode(F, di) {
    const st = this.st, AE = [0x80, 0x40, 0x20, 0x10];
    let c = st.u16(F + OFF.FLEET.ROUTE_FLAGS) & ~AE[di] & 0xffff;
    c = (c & 0xfff8) | ((di + 1) & 3) | 0x200;
    st.set16(F + OFF.FLEET.ROUTE_FLAGS, c);
    if (!(c & 0xf0)) st.set8(F + 0x0d, st.u8(F + 0x0d) | 0x40);
  }
  // 2317c 點在目前區域 (72 × 72) 內
  inRegion(x, y) {
    const left = (this.item * 0x2d0 + this.bda6) & 0xffff;
    return ((x - left) & 0xffff) < 0x48 && ((y - this.bdaa) & 0xffff) < 0x48 ? 1 : 0;
  }
  // 240a7 區域內的路線: 中途點無效 → 設 +0d |= 82; 已到達中途點 → (到了路線格的地點就換下一格) 重求; 否則沿用 (回傳 1)
  //   需搜尋 (+0d&40): 已到目的地的地點 (&8) → 直接駛向目的地 (|= 20), 否則 232a6; 之後 23e53 取目標 → 區域內就以 23a97(模式 1) 求中途點;
  //   失敗時 24008 (項的左右 / 南北邊界), 再失敗 23ef7 把目標投影到區域邊上後 23a97
  regionRoute(F) {
    const st = this.st, W = this.pt(F + OFF.FLEET.MID_X);
    if (!(st.u8(F + 0x0d) & 0x80)) st.set8(F + 0x0d, st.u8(F + 0x0d) | 0x82);
    else {
      if (W.x !== st.u16(F) || W.y !== st.u16(F + OFF.FLEET.Y)) return 1;
      const di = st.u8(F + OFF.FLEET.ROUTE_FLAGS) & 7, n = st.u16(F + OFF.FLEET.ROUTE_PTS + 2 * di);
      if ((this.nodeW(n, 0) & 0x7fff) === st.u16(F) && this.nodeW(n, 2) === st.u16(F + OFF.FLEET.Y)) this.nextNode(F, di);
    }
    if (st.u8(F + 0x0d) & 0x40) { if (st.u8(F + 0x0d) & 8) st.set8(F + 0x0d, st.u8(F + 0x0d) | 0x20); else this.routeSearch(F); }
    if (this.wayTarget(F, W) && this.pathStep(F, W, 1)) return 1;
    if (this.edgeTarget(F, W)) return 1;
    if (this.clipTarget(F, W)) return this.pathStep(F, W, 1);
    return 0;
  }
  // 23e53 目標: 直接駛向目的地 (+0d&20) 時 = +4/+6 (+1b 為 0..3 或 9、目的地在區域內且是陸地 → 23e19 換成附近可到達的海面並寫回 +4/+6);
  //   否則 = 目前路線格的地點。回傳 目標在區域內
  wayTarget(F, W) {
    const st = this.st;
    if (st.u8(F + 0x0d) & 0x20) {
      const b = st.u8(F + OFF.FLEET.MISSION);
      if ((b <= 3 || b === 9) && this.inRegion(st.u16(F + OFF.FLEET.DEST_X), st.u16(F + OFF.FLEET.DEST_Y)) && this.landAt(st.u16(F + OFF.FLEET.DEST_X), st.u16(F + OFF.FLEET.DEST_Y))) {
        this.nearSea(F, W); st.set16(F + OFF.FLEET.DEST_X, W.x); st.set16(F + OFF.FLEET.DEST_Y, W.y);
      }
      W.x = st.u16(F + OFF.FLEET.DEST_X); W.y = st.u16(F + OFF.FLEET.DEST_Y);
    } else { const n = st.u16(F + OFF.FLEET.ROUTE_PTS + 2 * (st.u8(F + OFF.FLEET.ROUTE_FLAGS) & 7)); W.x = this.nodeW(n, 0) & 0x7fff; W.y = this.nodeW(n, 2); }
    return this.inRegion(W.x, W.y);
  }
  // 艦隊在第 0 項而目標在第 2 項 (或相反) 時把目標 x 換到相鄰的一圈 (±0x870)
  wrapX(fx, si) {
    if (fx < 0x2d0) { if (si >= 0x5a0) si -= 0x870; } else if (fx >= 0x5a0) { if (si < 0x2d0) si += 0x870; }
    return si;
  }
  // 24008 艦隊在項的左右邊緣 (x mod 720 = 0 / 0x2ce) 或南北邊緣 (y = 0 / 0x436) 而目標在外側 → 目標 = 艦隊位置外 2 格, 回傳 1
  edgeTarget(F, W) {
    const st = this.st, fx = seaS16(st.u16(F)), fy = seaS16(st.u16(F + OFF.FLEET.Y)), fm = fx % 0x2d0;
    const si = this.wrapX(fx, seaS16(W.x));
    if (fm === 0 && fx > si) { W.x = fx - 2; return 1; }
    if (fm === 0x2ce && si > fx) { W.x = fx + 2; return 1; }
    if (fy === 0 && seaS16(W.y) < fy) { W.y = fy - 2; return 1; }
    if (fy === 0x436 && seaS16(W.y) > fy) { W.y = fy + 2; return 1; }
    return 0;
  }
  // 23ef7 目標在區域外: 沿艦隊 → 目標的直線投影到區域的左 / 右 (left / left + 0x46)、上 / 下 (top / top + 0x46) 邊; 乘積只取低 16 位元 (imul 後 cwd)
  clipTarget(F, W) {
    const st = this.st, left = seaS16(this.item * 0x2d0 + this.bda6), top = seaS16(this.bdaa);
    const fx = seaS16(st.u16(F)), fy = seaS16(st.u16(F + OFF.FLEET.Y));
    let si = this.wrapX(fx, seaS16(W.x)), di = seaS16(W.y);
    const q = (a, b, c) => Math.trunc(seaS16(Math.imul(a, b)) / seaS16(c));
    if (left > si) { di = seaS16(di + q(fy - di, left - si, fx - si)); si = left; }
    else if (left + 0x48 <= si) { di = seaS16(di + q(fy - di, left - si + 0x46, fx - si)); si = left + 0x46; }
    if (top > di) { si = seaS16(si + q(fx - si, top - di, fy - di)); di = top; }
    else if (top + 0x48 <= di) { si = seaS16(si + q(fx - si, top - di + 0x46, fy - di)); di = top + 0x46; }
    W.x = si; W.y = di;
    return this.inRegion(W.x, W.y);
  }
  // 1fd9:4089 = 23e19: 目的地 (+4/+6) 周圍 12 個位置 (23d7b 堆疊上的表) 中第一個 在區域內、不是陸地、且 23872 可到達 的 → W (都不行時 W = 最後一個)
  nearSea(F, W) {
    const st = this.st, D = [0, -2, 0, 2, 2, 0, -2, 0, -1, -2, 1, -2, 2, -1, 2, 1, -1, 2, 1, 2, -2, -1, -2, 1];
    for (let i = 0; i < 12; i++) {
      W.x = st.u16(F + OFF.FLEET.DEST_X) + D[2 * i]; W.y = st.u16(F + OFF.FLEET.DEST_Y) + D[2 * i + 1];
      if (!this.inRegion(W.x, W.y) || this.landAt(W.x, W.y)) continue;
      if (this.pathField(F, W)) return 1;
    }
    return 0;
  }
  // 231c7 最近的地點 (由最後一筆往前, 距離平方, x 差依世界一圈 0x870 取近的一邊; 找到距離 0 即停): 回傳編號 | (距離 0 ? 0x8000 : 0)
  nearestNode(px, py) {
    const N = this.SJ.nodeCount;
    let best = 0xffffffff, bi = 0xffff;
    for (let i = N - 1; i >= 0 && best !== 0; i--) {
      const dx = seaS16((this.nodeW(i, 0) & 0x7fff) - px), dy = seaS16(this.nodeW(i, 2) - py);
      let si = dx;
      if (dx > 0x438) si = seaS16(si - 0x870); else if (si < -0x438) si = seaS16(si + 0x870);
      const d = (dy * dy + si * si) >>> 0;                             // seg0:37bc 長整數乘法
      if (d < best) { best = d; bi = i; }
    }
    return (best === 0 ? 0x8000 : 0) | bi;
  }
  // 232a6 地點路線搜尋: 由目的地最近的地點往外做廣度優先 (5 bytes 的佇列項 {由哪個方向來的位元, 地點, 距離}; 已訪問的只放寬距離, 不重排),
  //   主角艦隊只走已探索 (+1 bit7) 的地點; 擴展到起點後由起點沿「距離 + 邊長 = 本點距離」的鄰點走回, 最多 4 個 (起點本身距離 0 時不算)
  //   → 從目前路線格起找第一個空格 (DS:ae30 遮罩), 依序填入, 遇到目的地的地點時 +0d |= 8; 最後 +0d &= BF。起點 = 目的地的地點且距離 0 → +0d |= 28
  routeSearch(F) {
    const st = this.st, N = this.nodes, AE = [0x80, 0x40, 0x20, 0x10];
    const link = (n, k) => this.nodeW(n, 4 + 2 * k), cost = (n, k) => N?.[((n << 4) + 0x0c + k) & 0xffff] ?? 0;
    const s0 = this.nearestNode(st.u16(F), st.u16(F + OFF.FLEET.Y)), start = s0 & 0x7fff;
    const goal = this.nearestNode(st.u16(F + OFF.FLEET.DEST_X), st.u16(F + OFF.FLEET.DEST_Y)) & 0x7fff;
    if ((s0 & 0x8000) && start === goal) { st.set8(F + 0x0d, st.u8(F + 0x0d) | 0x28); return 1; }
    const E = [{ flags: 0, node: goal, cost: 0 }], vis = new Int16Array(0x300).fill(-1);
    vis[goal] = 0;
    const hero = F === this.fleet;
    let head = 0, found = 0;
    while (!found && head < E.length) {
      const h = E[head];
      if (h.node === start) break;
      for (let k = 0, mask = 8; k < 4; k++, mask >>= 1) {
        if (h.flags & mask) continue;
        const nb = link(h.node, k); if (nb === 0xffff) continue;
        const c = (cost(h.node, k) + h.cost) & 0xffff;
        if (hero && !((N?.[((nb << 4) + 1) & 0xffff] ?? 0) & 0x80)) continue;
        h.flags |= mask;
        let rm = 8; for (let j = 0; j < 64 && link(nb, j) !== h.node; j++) rm = (rm >> 1) & 0xff;   // 2333d: 鄰點的哪一個鄰點是本點 (原版不限次數)
        if (vis[nb] < 0) {
          vis[nb] = E.length; E.push({ flags: rm, node: nb, cost: c });
          if (nb === start) { found = 1; break; }
        } else { const e = E[vis[nb]]; e.flags |= rm; if (seaS16(e.cost) > seaS16(c)) e.cost = c; }
      }
      head++;
    }
    const path = [];
    if (!(s0 & 0x8000)) path.push(start);
    let cur = start;
    while (cur !== goal && path.length < 4) {
      if (vis[cur] < 0) { seaTodo("232a6 路線搜尋失敗 (原版讀到堆疊上的殘值)"); break; }
      const e = E[vis[cur]];
      let k = 0;
      for (let mask = 8; k < 4; k++, mask >>= 1) {
        if (!(e.flags & mask)) continue;
        const nb = link(e.node, k), v = vis[nb];
        if (v >= 0 && ((cost(e.node, k) + E[v].cost) & 0xffff) === e.cost) break;
      }
      cur = link(e.node, k);                                           // k = 4 (都不符) 時讀到距離欄位, 原版如此
      path.push(cur);
    }
    let slot = st.u8(F + OFF.FLEET.ROUTE_FLAGS) & 7;
    for (let g = 0; g < 4 && (AE[slot & 3] & st.u16(F + OFF.FLEET.ROUTE_FLAGS)); g++) slot = (slot + 1) & 3;
    for (let i = 0; i < path.length; i++, slot = (slot + 1) & 3) {
      if ((st.u8(F + OFF.FLEET.ROUTE_FLAGS) & 0xf0) === 0xf0) break;
      st.set16(F + OFF.FLEET.ROUTE_FLAGS, st.u16(F + OFF.FLEET.ROUTE_FLAGS) | AE[slot & 3]);
      st.set16(F + OFF.FLEET.ROUTE_PTS + 2 * slot, path[i]);
      if (path[i] === goal) { st.set8(F + 0x0d, st.u8(F + 0x0d) | 8); break; }
    }
    st.set8(F + 0x0d, st.u8(F + 0x0d) & 0xbf);
    return 1;
  }
  // 314eb 船速 (各船取最小): 風向差 k = |風向 − 航向| → DS:06d8 表第 k 列的帆種係數 × 推進力 × 風力 (縱帆船 (+10 bit4 = 0) 風力至少 3) / 150
  //   × min(100, 駕駛% × 水手 / 船型 +5) / 100 × min(150, 180 − min(180, 載重%)) / 100 → 加上航海術 (+24) 10%/點 (上限 30) → × 技能 (+1d) / 75 (上限 40)
  //   k = 3..5 (逆風) 時再 × 轉向力 / 100; 結果至少 2; 風力 0 且沒有縱帆船 → 0
  shipSpeedAt(h, wStr, wDir) {
    const st = this.st, T = this.SJ.tab.windSpeed;
    const k = Math.abs(wDir - h) & 0xff, row = k * 8, beat = k >= 3 && k <= 5;
    let best = 0xc8, fore = 0;
    for (let i = 0; i < 10; i++) {
      const S = this.slotOf(i), M = this.crewOf(i);
      if ((st.u8(S + 8) & 0x30) !== 0x10) continue;
      const ship = this.shipRec(st.u8(S + 7)), Ty = this.typeOf(st.u8(ship + 0x0f));
      const P = st.personRecord(st.u8(M + OFF.CREW_SLOT.CAPTAIN));
      let ws;
      if (!(st.u8(ship + 0x10) & 0x10)) { ws = wStr < 3 ? 3 : wStr; fore = (fore - 1) & 0xff; } else ws = wStr;
      let v = Math.trunc(seaS16(Math.imul((T[row + st.u8(Ty + 9)] * st.u8(S + 5)) & 0xffff, ws)) / 0x96) & 0xff;
      const q = Math.trunc(Math.imul(st.u8(M + OFF.CREW_SLOT.LOOK_RATIO), seaS16(st.u16(S))) / st.u8(Ty + 5));
      v = Math.trunc(((seaUmin(100, q & 0xffff) * v) & 0xffff) / 100) & 0xff;
      const pct = Math.trunc(seaS16(Math.imul(100, seaS16(st.u16(M + OFF.CREW_SLOT.LOAD_TOTAL)))) / seaS16(st.u16(Ty + 6)));
      const c = seaUmin(0x96, (0xb4 - pct) & 0xffff);
      v = Math.floor(((v * c) & 0xffff) / 100) & 0xff;
      const a = seaS16(Math.imul(st.u8(P + OFF.PERSON.NAV_LEVEL), v));
      const b7 = seaUmin(30, (Math.trunc(a / 10) + v) & 0xffff) & 0xff;
      let sp = seaUmin(40, Math.trunc(((st.u8(P + 0x1d) * b7) & 0xffff) / 75) & 0xffff) & 0xff;
      if (beat) sp = Math.trunc((st.u8(S + 4) * sp) / 100) & 0xff;
      if (sp < best) best = sp;
    }
    if (best < 2) best = 2;
    return !wStr && !fore ? 0 : best;
  }
  // 31728 依航向與海流移動一步: 格內位置 (+18/+19, 每格 0x3c) 累加 (方位向量 × 船速 + 海流向量 × 海流強度, 8 位元);
  //   跨格時檢查陸地 (3135c); 走到 WORLDMAP 項的左右邊界 (x mod 720 < 0 或 >= 719) / 南北邊界時不檢查陸地並設 crossed
  //   回傳 1 = 被陸地擋住 (連斜向也不行)
  stepFleet(h, out) {
    const st = this.st, F = this.fleet, X = this.SJ.tab.dirX, Y = this.SJ.tab.dirY, b = st.u8(DS.WIND_CUR);
    const cd = (b & 0x38) >> 3, cs = b & 7;
    out.crossed = 0;
    const ddx = seaS8(Math.imul(X[h], seaS8(this.speed)) + Math.imul(X[cd], cs)), ddy = seaS8(Math.imul(Y[h], seaS8(this.speed)) + Math.imul(Y[cd], cs));
    const fx = seaS8(ddx + st.u8(F + OFF.FLEET.SUB_X)), fy = seaS8(ddy + st.u8(F + OFF.FLEET.SUB_Y));
    let px = this.wx(F) % 0x2d0, py = this.wy(F), ax = 0, ay = 0;
    if (fx >= 0x3c) { px++; ax = -0x3c; } else if (fx < 0) { px--; ax = 0x3c; }
    if (fy >= 0x3c) { py++; ay = -0x3c; } else if (fy < 0) { py--; ay = 0x3c; }
    else if (!ax) { st.set8(F + OFF.FLEET.SUB_X, fx); st.set8(F + OFF.FLEET.SUB_Y, fy); out.x = px; out.y = py; return 0; }
    const base = (this.item * 0x2d0) & 0xffff;
    if (px < 0 || px >= 0x2cf) { px += seaSgn(ddx); py = this.wy(F); out.crossed = 1; }
    if (py < 0 || py >= 0x437) {
      px = this.wx(F) % 0x2d0;
      if (py >= 0 && py < 0x438) { py += seaSgn(ddy); out.crossed = 1; } else py = this.wy(F);
    }
    out.x = px; out.y = py;
    if (!out.crossed && this.landAt(px, py)) {
      out.x = this.wx(F) % 0x2d0; out.y = this.wy(F);
      if (this.landAt(this.wx(F) + seaSgn(ddx), this.wy(F) + seaSgn(ddy))) return 1;
      st.set8(F + OFF.FLEET.SUB_X, fx); st.set8(F + OFF.FLEET.SUB_Y, fy);
      if (ax) st.set8(F + OFF.FLEET.SUB_X, ddx > 0 ? 0x3b : 0);
      if (ay) st.set8(F + OFF.FLEET.SUB_Y, ddy > 0 ? 0x3b : 0);
      return 0;
    }
    st.set16(F, (px + base + 0x870) % 0x870);
    st.set16(F + OFF.FLEET.Y, (py + 0x438) % 0x438);
    st.set8(F + OFF.FLEET.SUB_X, ax + fx); st.set8(F + OFF.FLEET.SUB_Y, ay + fy);
    return 0;
  }
  async heroMove() {
    const st = this.st, F = this.fleet;
    let si = await this.heading();
    if (this.port !== 0xff) return;
    if (si !== 8) {
      const a = st.u8(DS.PORT_FLAGS), b = st.u8(DS.WIND_CUR);
      this.speed = this.shipSpeedAt(si, a & 7, (a & 0x38) >> 3) & 0xff;   // [bdac] (海流方向/強度是傳入的參數, 但 314eb 沒有用到)
      const ox = st.u16(F), oy = st.u16(F + OFF.FLEET.Y), out = {};
      if (this.stepFleet(si, out)) {
        si = (si + 1) & 7;
        if (this.stepFleet(si, out)) { si = (si - 2) & 7; if (this.stepFleet(si, out)) this.blocked(); }
      }
      if (out.crossed) {
        this.item = Math.trunc(this.wx(F) / 0x2d0) & 0xff;             // 849a 換 WORLDMAP 項
        const r = this.regionOf(); this.region = r; this.decodeRegion(r);
        if (this.landAt(this.wx(F), this.wy(F))) {
          st.set16(F, ox); st.set16(F + OFF.FLEET.Y, oy);
          this.item = Math.trunc(this.wx(F) / 0x2d0) & 0xff;           // 849a (區域緩衝保留新項的內容, [06c8] 之後設為 FFFF)
        } else {
          if (out.x < 0 || out.x >= 0x2cf) this.vx1006 = Math.trunc(this.wx(F) / 24) * 24;
          if (out.y < 0 || out.y >= 0x437) this.vy1008 = Math.trunc(this.wy(F) / 24) * 24;
        }
        this.region = 0xffff;
        st.set16(F + OFF.FLEET.MID_X, (seaS16(st.u16(F + OFF.FLEET.MID_X)) + 0x870) % 0x870);
      }
    }
    this.scroll();
  }
  // 1fd9:44d8 = 24268: 三個方向都被擋住 → 23a97(目標 = 艦隊 +8, 艦隊, 0): 以 +8/+a 為目標重求中途點寫回 +8/+a
  blocked() { this.pathStep(this.fleet, this.pt(this.fleet + 8), 0); }
  // 237fb + 23872 區域距離場 (緩衝 [0c88] = 視窗保存區, 72 × 72 字): 0x800 = 未到, 0x801 = 陸地 (圖塊 >= 0x34); 由目標往外做帶權最短路
  //   (DS:ae18: 8 方向 dx, dy, 成本 2 / 3; 佇列 = 堆疊上 72×72 字的環狀緩衝, 插入排序); 船身 2×2: 該格與 東、南、東南 都不能是陸地
  //   回傳 1 = 由目標擴展到了起點 (起點 = 艦隊 F, 座標以區域左上為原點的 8 位元值); 目標在陸地上或到不了 → 0
  pathField(F, T) {
    const st = this.st, D = this.SJ.tab.path8, N = 72 * 72, Q = new Int32Array(N);
    const buf = (this.pathBuf ??= new Uint16Array(0x8000)); buf.fill(0);
    const left = (this.item * 0x2d0 + this.bda6) & 0xffff, top = this.bdaa & 0xffff;
    const sx = (st.u16(F) - left) & 0xff, sy = (st.u16(F + OFF.FLEET.Y) - top) & 0xff, tx = (T.x - left) & 0xff, ty = (T.y - top) & 0xff;
    for (let y = 0; y < 72; y++) for (let x = 0; x < 72; x++) buf[y * 72 + x] = this.mapBuf[y * 0x60 + x] >= 0x34 ? 0x801 : 0x800;
    const ti = ty * 72 + tx;
    if (buf[ti] > 0x800) return 0;
    buf[ti] = 0;
    let head = 0, tail = 1; Q[0] = ti;
    if (buf[sy * 72 + sx] === 0) return 1;
    buf[sy * 72 + sx] = 0x800;
    while (head !== tail) {
      const cur = Q[head], x = cur % 72, y = Math.floor(cur / 72), d = buf[cur];
      for (let k = 0; k < 8; k++) {
        const nx = (x + D[k * 3]) & 0xff, ny = (y + D[k * 3 + 1]) & 0xff;          // 237c7
        if (nx >= 72 || ny >= 72) continue;
        if (nx === sx && ny === sy) return 1;
        const n = ny * 72 + nx;
        if (buf[n] !== 0x800 || buf[n + 1] === 0x801 || buf[n + 72] === 0x801 || buf[n + 73] === 0x801) continue;
        buf[n] = (d + D[k * 3 + 2]) & 0xffff;
        let slot = tail, bx = tail - 1;
        for (;;) {
          if (bx < 0) bx = N - 1;
          Q[slot] = Q[bx];
          if (buf[Q[bx]] <= buf[n]) break;
          slot = bx; bx--;
        }
        Q[slot] = n;
        if (++tail >= N) tail = 0;
      }
      if (++head >= N) head = 0;
    }
    return 0;
  }
  // 23a97(T, F, mode): 距離場建好後由艦隊沿距離遞減走 (最多 256 步, 每步取 8 鄰格中最小的; 都不更小時往北), 第一步的方向一直延伸到不再同向的位置 → T
  //   艦隊與目標同一格時 T = 區域左上 (原版如此)。mode ≠ 0 的後半 (再嘗試轉向) 只有艦隊 AI 使用, 尚未移植
  pathStep(F, T, mode) {
    const st = this.st, D = this.SJ.tab.path8;
    if (!this.pathField(F, T)) return 0;
    const buf = this.pathBuf;
    const left = (this.item * 0x2d0 + this.bda6) & 0xffff, top = this.bdaa & 0xffff;
    const fx = seaS16(st.u16(F) - left), fy = seaS16(st.u16(F + OFF.FLEET.Y) - top), tx = seaS16(T.x - left), ty = seaS16(T.y - top);
    const ti = seaS16(ty * 72 + tx); let cur = seaS16(fy * 72 + fx);
    if (cur === ti) { T.x = left; T.y = top; return 1; }
    const path = []; let x = fx, y = fy;
    while (cur !== ti && path.length < 0x100) {
      let best = buf[cur & 0x7fff], bd = 0;
      for (let k = 0; k < 8; k++) {
        const nx = x + D[k * 3], ny = y + D[k * 3 + 1];
        if (nx < 0 || nx >= 72 || ny < 0 || ny >= 72) continue;
        const w = buf[(cur + D[k * 3 + 1] * 72 + D[k * 3]) & 0x7fff];
        if (w < best) { best = w; bd = k; }
      }
      cur = seaS16(cur + D[bd * 3] + 72 * D[bd * 3 + 1]); path.push(cur); x += D[bd * 3]; y += D[bd * 3 + 1];
    }
    let y0 = Math.trunc(path[0] / 72), x0 = path[0] % 72, run = 0, si = 1;
    let d = this.SJ.tab.dir3[(y0 - fy) * 3 + (x0 - fx) + 4];
    const X = this.SJ.tab.dirX, Y = this.SJ.tab.dirY, next = k => (x0 + X[k]) + (y0 + Y[k]) * 72;   // DS:ae42 / ae4a (與 0718 / 0720 相同)
    for (; si < path.length; si++, run++) {
      if (path[si] !== next(d)) break;
      x0 += X[d]; y0 += Y[d];
    }
    // 23c9c 第 3 引數 ≠ 0 (委任 / 艦隊 AI 的 240a7): 路線轉彎處先試 方向 +1、再試 −1 走一格; 轉成功且直線段長度 ≠ 0 時沿新方向繼續延伸
    if (mode && path.length > si) {
      d = (d + 1) & 7;
      let ok = path[si] === next(d);
      if (!ok) { d = (d - 2) & 7; ok = path[si] === next(d); }
      if (!ok) run = 0;
      else for (;;) {
        x0 += X[d]; y0 += Y[d]; si++;
        if (!run || path.length <= si || path[si] !== next(d)) break;
      }
    }
    T.x = x0 + left; T.y = y0 + top;
    return 1;
  }
  // 31b73 地圖視窗捲動: 主角離視窗左上 < 11 − [0ca9] 或 > 11 + [0ca9] 時移動一格 (x 限 項內 0..0x2b8, y 0..0x420)
  scroll() {
    const st = this.st, F = this.fleet, m = st.u8(DS.SEA_SCROLL);
    const rx = this.wx(F) - this.vx1006, si = this.vx1006 % 0x2d0;
    if (11 - m > rx) { if (si > 0) this.vx1006 = this.vx1006 - 1; }
    else if (m + 11 < rx) { if (si < 0x2b8) this.vx1006 = this.vx1006 + 1; }
    const ry = this.wy(F) - this.vy1008, dy = this.vy1008;
    if (11 - m > ry) { if (dy > 0) this.vy1008 = dy - 1; }
    else if (m + 11 < ry) { if (dy < 0x420) this.vy1008 = dy + 1; }
  }

  // ================= 2e09:2f3d = 30fcd 發現 (港口 / 村落) 與海上特殊地點 =================
  async discover() {
    const st = this.st, F = this.fleet, rng = this.c.sys.rng;
    if (this.port !== 0xff) return;
    const sight = seaUmax(this.sight, 2);
    for (let i = 0; i < 10; i++) {
      if (st.u16(0x1012 + 4 * i) !== st.u16(F) || st.u16(0x1014 + 4 * i) !== st.u16(F + OFF.FLEET.Y)) continue;
      st.set16(0x1012 + 4 * i, 0); st.set16(0x1014 + 4 * i, 0);
      await this.seaEvent(st.u8(0x103a + i));                          // 30e9f
      this.monsterRead(i);                                             // 31047
      st.set8(0x1044, st.u8(0x1044) + 1);
      return;
    }
    let skill = st.u8(this.b.hero + 0x1f);
    for (let i = 0; i < 0x1e; i++) { const n = st.u8(DS.PARTY_CREW + i); if (n !== 0xff && st.u8(st.personRecord(n) + 0x1f) > skill) skill = st.u8(st.personRecord(n) + 0x1f); }
    for (let di = 0; di < 0x82; di++) {
      const R = DS.TBL_PORT + di * 0x16;
      if (st.u8(R + 0x15) & 0x30) continue;
      const x = seaS16(st.u16(R)), y = seaS16(st.u16(R + 2));
      if (!this.near(2, x, y)) {
        if (!this.inSight(sight, x, y)) continue;
        if (rng.random(0xc8) >= skill) return;
      }
      marketTradeLog(st, this.c.rt, 9, di, 0, 0);                    // 0fea:e3e5 交易記錄 種類 9 (發現港口)
      st.set8(R + 0x15, st.u8(R + 0x15) | 0x10);
      await this.found(0, di);
      return;
    }
    for (let di = 0; di < 0x64; di++) {
      const R = DS.TBL_DISCOVERY + di * 7;
      if (st.u8(R + 6) & 0xc0) continue;
      const x = seaS16(st.u16(R)), y = seaS16(st.u16(R + 2));
      if (!this.near(2, x, y)) {
        if (!this.inSight(sight, x, y)) continue;
        if (rng.random(0xc8) >= skill) return;
      }
      st.set8(R + 6, st.u8(R + 6) | 0x40);
      await this.found(1, 0);
      return;
    }
  }
  // 0fea:30fc = 12f9c: |主角 − (x, y)| 各軸 <= r
  near(r, x, y) {
    const F = this.fleet, fx = this.wx(F), fy = this.wy(F);
    const dx = fx < x ? x - fx : fx - x, dy = fy < y ? y - fy : fy - y;
    return dx <= r && dy <= r;
  }
  // 30f81: 霧 (天候 3) 以外、距離 <= r 且在地圖視窗內
  inSight(r, x, y) {
    if ((this.st.u8(DS.WEATHER) & 15) === 3) return false;
    if (!this.near(r, x, y)) return false;
    return x >= this.vx1006 && x < this.vx1006 + 0x18 && y >= this.vy1008 && y < this.vy1008 + 0x18;
  }
  // 30b34 發現: 重新解碼區域並畫地圖, 「船長！發現%s港！」/「發現村落！」, 港口 (< 100) 加冒險名聲 25 × 規模 (+1c), 補給港與村落 50
  async found(kind, id) {
    const { sys, con, printf, message, win, menu } = this.c, st = this.st;
    let fame = 0x32;
    this.decodeRegion(this.region);
    sys.mouseHide();
    this.drawMap();
    const l = con.left, r = con.right;
    if (this.c.scr.wideRenderer) this.b.beginWideTalk(null);
    else win.shadowedSaved(0x10, 0xa0, 0x24, 0x80, 0);                      // 30b1e
    con.puts(this.SS.captain);
    if (kind === 0) {
      printf(this.SS.foundPort, st.cstr(DS.TBL_PORT + id * 0x16 + 4));
      fame = id >= 0x64 ? 0x32 : (0x19 * st.u8(DS.TBL_PORT_ECONOMY + id * 0x25 + 0x1c)) & 0xffff;
    } else con.puts(this.SS.foundVillage);
    if (fame) {
      const H = DS.TBL_HERO_DATA + st.u8(DS.HERO) * 0x0e;
      st.set16(H + 4, st.u16(H + 4) + seaUmin(50000 - st.u16(H + 4), fame));
      message(0x1dc, fame);
    }
    await menu.waitPrompt(); await win.close();
    sys.mouseShow();
    con.left = l; con.right = r;
  }
  // 31047: 以唯讀開 MONSTER.DAT (0fea:6114, 開不了時原版顯示錯誤並結束程式), lseek 到第 [1044] 筆 (5 bytes), 讀 4 bytes 到 DS:1012 + 4i (x, y)、
  //   1 byte 到 DS:103a + i (事件編號) — 用過的地點換成檔案裡的下一個; 讀到檔尾以後讀不到, 該地點維持 (0, 0) (RE_NOTES 36.2)
  monsterRead(i) {
    const st = this.st, M = this.P.monster; let pos = st.u8(0x1044) * 5;
    for (let k = 0; k < 4; k++, pos++) if (pos < M.length) st.set8(0x1012 + 4 * i + k, M[pos]);
    if (pos < M.length) st.set8(0x103a + i, M[pos]);
  }
  // 30e9f 海上特殊地點事件 n: 先執行 DS:b796[n] 的函式 (回傳 0 = 沒有發生, 什麼都不顯示); 發生時效果音 DS:0c44 兩次 (各 0x1e tick, 中間 0x14),
  //   30b1e 視窗「船長！不得了啦！快看海面上！」, 再兩段訊息 (n + 0xff) × 2 + i 各自一個視窗, 8067 重畫, 9888
  async seaEvent(n) {
    const { sys, con, message, win, menu } = this.c, sfx = this.c.sfx;
    sys.mouseHide();                                                   // 4ee7
    if (this.seaEventFn(n & 0xff)) {
      const l = con.left, r = con.right;                               // [8a20] / [8a22]
      sfx?.voice(0x0c44); sfx?.note(0x30); await sys.waitTicks(0x1e); sfx?.off(); await sys.waitTicks(0x14);
      sfx?.voice(0x0c44); sfx?.note(0x30); await sys.waitTicks(0x1e); sfx?.off();
      if (this.c.scr.wideRenderer) this.b.beginWideTalk(null);
      else win.shadowedSaved(0x10, 0xa0, 0x24, 0x80, 0);                    // 30b1e
      con.puts(this.SS.seaEvent); await menu.waitPrompt(); await win.close();   // DS:b777, 490b, 796d
      for (let i = 0; i < 2; i++) {
        if (this.c.scr.wideRenderer) this.b.beginWideTalk(null);
        else win.shadowedSaved(0x10, 0xa0, 0x24, 0x80, 0);
        message((((n & 0xff) + 0xff) * 2 + i) & 0xffff); await menu.waitPrompt(); await win.close();   // 3377e
      }
      con.left = l; con.right = r;
      this.seaPanel();                                                 // 8067
      sfx?.off();                                                      // 30f71
    }
    sys.mouseShow();                                                   // 4ecf
  }
  // DS:b796 的 10 個函式 (回傳 1 = 發生)
  seaEventFn(n) {
    const st = this.st, H = st.u8(DS.HERO);
    // 事件 2 / 5 / 8: 從第 9 艘往前找第一艘「有船且船長不是主角」的 (10 艘都不是 → 0)
    const other = () => { for (let i = 9; i >= 0; i--) if ((st.u8(this.slotOf(i) + 8) & 0x30) === 0x10 && st.u8(this.crewOf(i) + 0x1b) !== H) return i; return -1; };
    const has = i => (st.u8(this.slotOf(i) + 8) & 0x30) === 0x10;
    switch (n) {
      case 0:                                                          // 30c10: 348ff(0x19, 0) 各船水手 −25% (不顯示損失)
        for (let i = 0; i < 10; i++) if (has(i)) {
          const S = this.slotOf(i), p = seaS16(Math.imul(0x19, seaS16(st.u16(S))) & 0xffff);   // imul 後只用低 16 位元 (cwd)
          st.set16(S, st.u16(S) + Math.trunc(p / -100));
        }
        return 1;
      case 1: {                                                        // 30c1d: 主角 + 船員 (12d8c → [0538]) 各 +20 −= min(+20, 10)
        const cnt = this.b.captainPool(), L = this.c.persons;
        for (let i = 0; i < cnt; i++) { const P = st.personRecord(L[i] & 0xff); st.set8(P + 0x20, st.u8(P + 0x20) - seaUmin(st.u8(P + 0x20), 10)); }
        return 1;
      }
      case 2: {                                                        // 30c6a: 那艘船離隊 (+8 &= EF), 船長 +2e = 6, 船長欄 = FF
        const i = other(); if (i < 0) return 0;
        const S = this.slotOf(i), M = this.crewOf(i);
        st.set8(S + 8, st.u8(S + 8) & 0xef); st.set8(st.personRecord(st.u8(M + OFF.CREW_SLOT.CAPTAIN)) + 0x2e, 6); st.set8(M + OFF.CREW_SLOT.CAPTAIN, 0xff);
        return 1;
      }
      case 3: return 1;                                                // 30cce: 沒有效果
      case 4: {                                                        // 30cd2: 有船的船位 (12c8a → [0538]) 士氣 +1c += min(10, 100 − +1c)
        const cnt = this.b.fleetShips(), L = this.c.persons;
        for (let i = 0; i < cnt; i++) { const M = this.crewOf(L[i] & 0xff); st.set8(M + OFF.CREW_SLOT.MORALE, st.u8(M + OFF.CREW_SLOT.MORALE) + seaUmin(10, 100 - st.u8(M + OFF.CREW_SLOT.MORALE))); }
        return 1;
      }
      case 5: { const i = other(); if (i < 0) return 0; const S = this.slotOf(i); st.set8(S + 5, st.u8(S + 5) >> 1); return 1; }   // 30d24
      case 6:                                                          // 30d75: 各船 +16..+1a = FF、+0c..+14 (5 字) = 0, 每艘之後 0fea:9d01 (19ba1, 只計算)
        for (let i = 0; i < 10; i++) if (has(i)) {
          const M = this.crewOf(i);
          for (let k = 0; k < 5; k++) { st.set8(M + OFF.CREW_SLOT.CARGO_GOODS + k, 0xff); st.set16(M + OFF.CREW_SLOT.CARGO_AMTS + 2 * k, 0); }
        }
        return 1;
      case 7:                                                          // 30dd9: 各船士氣 +1c −= min(+1c, 10)
        for (let i = 0; i < 10; i++) if (has(i)) { const M = this.crewOf(i); st.set8(M + OFF.CREW_SLOT.MORALE, st.u8(M + OFF.CREW_SLOT.MORALE) - seaUmin(st.u8(M + OFF.CREW_SLOT.MORALE), 10)); }
        return 1;
      case 8: {                                                        // 30e29: 那艘船 +2 >>= 1, 0fea:83f9 艦隊重算
        const i = other(); if (i < 0) return 0;
        const S = this.slotOf(i); st.set8(S + 2, st.u8(S + 2) >> 1); this.fleetDurability(this.fleet);
        return 1;
      }
      case 9: { const P = this.b.hero; st.set8(P + 0x23, st.u8(P + 0x23) - seaUmin(st.u8(P + 0x23), 0x1e)); return 1; }   // 30e83: 主角 +23 −= min(+23, 30)
    }
    return 0;                                                          // 表外: 原版會跳到表後的位址 (正常不會發生)
  }

  // ================= 每日 195b6 (只在海上) =================
  async seaDaily() {
    if (this.port !== 0xff) return;
    this.foodDaily(); this.waterDaily();
    await this.rats(); await this.scurvy(); await this.lost();
  }
  // 19427: 鼠患 (0cb3 bit4): 未發生時 19358 判斷發生, 發生中 193dc 每船糧食 −min(10, 糧食)
  async rats() {
    const st = this.st;
    if (!(st.u8(DS.WEATHER) & 0x10)) await this.ratsStart();
    if (st.u8(DS.WEATHER) & 0x10) for (let i = 0; i < 10; i++) if (this.present(i)) { const M = this.crewOf(i); st.set16(M + OFF.CREW_SLOT.FOOD, st.u16(M + OFF.CREW_SLOT.FOOD) - seaUmin(10, st.u16(M + OFF.CREW_SLOT.FOOD))); }
  }
  // 19358: 出港 > 30 天、沒有貓 ([bda8]&0x40)、random(主角 +24 / 5 + 2) = 0 且 random(105) > 主角 +23 → GRAPH #0x39、0x1d9
  async ratsStart() {
    const st = this.st, H = this.b.hero, rng = this.c.sys.rng, di = st.u8(H + 0x23), si = st.u8(H + 0x24);
    if (st.u8(DS.WEATHER) & 0x10 || this.bda8 & 0x40 || st.u8(DS.DAYS_AT_SEA) <= 0x1e) return;
    if (rng.random(Math.trunc(si / 5) + 2)) return;
    if (rng.random(0x69) <= di) return;
    await this.seaNotice(0x39, 0x1d9);
    st.set8(DS.WEATHER, st.u8(DS.WEATHER) | 0x10);
  }
  async seaNotice(pic, msg) {
    const { sys, graph, message, menu, win, scr } = this.c;
    if (scr.wideRenderer && hasDom() && this.c.codec) {
      const txt = toSimp(captureConsoleText(this.c, () => message(msg)));
      await runDomStoryCard(this.c.art, pic, txt, "海上事件");
      return;
    }
    sys.mouseHide(); this.clearCache(); graph.draw(pic, 0xa0, 0x10);
    this.b.crewSpeaks(); message(msg); await menu.waitPrompt(); await win.close(); sys.mouseShow();
  }
  // 19511: 壞血病 (0cb3 bit5): 出港 > 60 天且 random(105) > 主角 +23 時發生 (GRAPH #0x3b、0x1da); 發生中每船水手 −min(random(2) + (100 − 船長 +1e) / 5, 水手)
  async scurvy() {
    const st = this.st, rng = this.c.sys.rng;
    if (!(st.u8(DS.WEATHER) & 0x20)) {
      if (st.u8(DS.DAYS_AT_SEA) > 0x3c && rng.random(0x69) > st.u8(this.b.hero + 0x23)) { await this.seaNotice(0x3b, 0x1da); st.set8(DS.WEATHER, st.u8(DS.WEATHER) | 0x20); }
    }
    if (st.u8(DS.WEATHER) & 0x20) for (let i = 0; i < 10; i++) {
      if (!this.present(i)) continue;
      const S = this.slotOf(i), P = st.personRecord(st.u8(this.crewOf(i) + 0x1b));
      const v = (rng.random(2) + Math.trunc((100 - st.u8(P + 0x1e)) / 5)) & 0xffff;
      st.set16(S, st.u16(S) - seaUmin(v, st.u16(S)));
    }
  }
  // 19528: 全艦隊沒有水手 (或沒有船) → 0x1ba / 0x241 後遊戲結束 ([03ea] = 0x19)
  async lost() {
    const st = this.st, { sys, palette, message, menu, win } = this.c;
    let n = 0, crew = 0;
    for (let i = 0; i < 10; i++) if (this.present(i)) { crew = (crew + st.u16(this.slotOf(i))) & 0xffff; n++; }
    if (crew && n) return;
    if (palette.ending) return;
    sys.mouseHide();
    if (this.c.scr.wideRenderer) this.b.beginWideTalk(null);
    else win.shadowedSaved(0x12, 0x80, 0x22, 0x60, 0);
    message(n ? 0x1ba : 0x1ba + 0x87); await menu.waitPrompt(); await win.close();
    sys.mouseHide();
    await palette.fadeBlack();
    palette.ending = 0x19;
  }

  // ================= 天候 (1a011 的海上部分) =================
  // 19a99 天候開始: 所在海域的風向表 bit7 (天候區) 時, random(155) > 最高的觀測 (航海士/測量士 +23) + 50 且 random(11) > 平均 +1d
  //   → bit6: 1988c (落水); 海流表 bit6..7 = 1 暴風雨 / 2 無風 / 3 霧
  async weatherStart() {
    const st = this.st, rng = this.c.sys.rng, [w, c] = this.clock.windAt(this.fleet);
    if (!(w & 0x80)) return;
    let best = st.u8(this.b.hero + 0x23);
    for (let i = 0; i < 0x1e; i++) {
      const n = st.u8(DS.PARTY_CREW + i); if (n === 0xff) continue;
      const P = st.personRecord(n), job = st.u8(P + OFF.PERSON.ROLE);
      if ((job === 3 || job === 5) && st.u8(P + 0x23) > best) best = st.u8(P + 0x23);
    }
    let sum = 0, cnt = 0;
    for (let i = 0; i < 10; i++) if (this.present(i)) { sum += st.u8(this.crewOf(i) + 0x1d); cnt++; }
    if (rng.random(0x9b) <= best + 0x32) return;
    if (rng.random(0x0b) <= Math.floor(sum / cnt)) return;
    if (w & 0x40) await this.overboard();
    switch (c & 0xc0) {
      case 0x40: if (rng.random(7) + 3 >= (st.u8(DS.PORT_FLAGS) & 7) && !st.u8(DS.COOLDOWN_10A6)) { await this.weatherBegin(0x154, 1); this.stormSound(); } break;
      case 0x80: if (rng.random(6) >= (st.u8(DS.PORT_FLAGS) & 7)) await this.weatherBegin(0x158, 2); break;
      case 0xc0: if (!rng.random(10) && rng.random(6) >= (st.u8(DS.PORT_FLAGS) & 7)) await this.weatherBegin(0x15c, 3); break;
    }
  }
  // 1988c 海難: 非主角當船長、船長 +1b & 0xc0 且 random(100) > 船長 +23 的第一艘船 → 19849 (船長離隊、船 5deb 移除) → 197f7
  async overboard() {
    const st = this.st, rng = this.c.sys.rng;
    for (let i = 0; i < 10; i++) {
      const M = this.crewOf(i);
      if (!this.present(i) || st.u8(M + OFF.CREW_SLOT.CAPTAIN) === st.u8(DS.HERO)) continue;
      const P = st.personRecord(st.u8(M + OFF.CREW_SLOT.CAPTAIN));
      if (rng.random(100) <= st.u8(P + 0x23)) continue;
      if (!(st.u8(P + 0x1b) & 0xc0)) continue;
      this.dropShip(i, M);
      await this.shipLostMsg(i);
      return;
    }
  }
  // 19849: 船長從船員名單 (DS:2e1b) 移除 (+2d = FF, +31 &= DF), 再 5deb 移除船位 i
  dropShip(i, M) {
    const st = this.st, c = st.u8(M + OFF.CREW_SLOT.CAPTAIN);
    for (let k = 0; k < 0x1e; k++) if (st.u8(DS.PARTY_CREW + k) === c) {
      st.set8(DS.PARTY_CREW + k, 0xff);
      const P = st.personRecord(c); st.set8(P + OFF.PERSON.STAY_PORT, 0xff); st.set8(P + OFF.PERSON.FACE, st.u8(P + OFF.PERSON.FACE) & 0xdf);
      break;
    }
    this.removeShip(i);
  }
  // seg0:5deb 移除船位 i: 船 (+0f = FF, +10/+11/+12/+14 = 0)、船位 (+2..+6 = FF, +0 = 0, +8 = 0)、船員配置清空, 船長 (非主角) 職務 = 6; +08 先寫 0x19 再寫 0x32 (原版如此)
  removeShip(i) {
    const st = this.st, M = this.crewOf(i), S = this.slotOf(i), ship = this.shipRec(st.u8(S + 7));
    st.set8(ship + 0x0f, 0xff); st.set8(ship + 0x11, 0); st.set8(ship + 0x10, 0); st.set16(ship + 0x14, 0); st.set16(ship + 0x12, 0);
    for (const k of [5, 4, 3, 2, 6]) st.set8(S + k, 0xff);
    st.set16(S, 0); st.set8(S + 8, 0);
    st.set16(M + OFF.CREW_SLOT.AMMO, 0); st.set16(M + OFF.CREW_SLOT.MATERIAL, 0); st.set16(M + OFF.CREW_SLOT.FOOD, 0); st.set16(M, 0);
    for (let k = 0; k < 5; k++) { st.set8(M + OFF.CREW_SLOT.CARGO_GOODS + k, 0xff); st.set16(M + OFF.CREW_SLOT.CARGO_AMTS + 2 * k, 0); }
    st.set16(M + OFF.CREW_SLOT.LOAD_TOTAL, 0);
    if (st.u8(M + OFF.CREW_SLOT.CAPTAIN) !== st.u8(DS.HERO)) st.set8(st.personRecord(st.u8(M + OFF.CREW_SLOT.CAPTAIN)) + 0x2e, 6);
    st.set8(M + OFF.CREW_SLOT.CAPTAIN, 0xff); st.set8(M + OFF.CREW_SLOT.MORALE, 0); st.set8(M + OFF.CREW_SLOT.FIGUREHEAD, 0); st.set8(M + OFF.CREW_SLOT.NAV_RATIO, 0x19); st.set8(M + OFF.CREW_SLOT.NAV_RATIO, 0x32);
  }
  // 197f7: 0x150 / 0x151「%s 不見了」— 原版以「船位編號」當船編號取船名 (5c7a(i)), 照搬
  async shipLostMsg(i) {
    if (this.port !== 0xff) return;
    const { sys, message, con } = this.c, st = this.st, ship = this.shipRec(i);
    sys.mouseHide();
    const p = this.b.crewSpeaks();
    message(p !== 0xff && (st.u8(st.personRecord(p) + 0x2f) & 8) ? 0x151 : 0x150, this.b.dstr(ship));
    await this.c.menu.waitPrompt(); await this.c.win.close();
    sys.mouseShow();
    con.right = 0x50;
  }
  // 19909 觀測者: 船員名單中最後一個職務 3 與最後一個職務 5 的人, 取 +1f 較高者 (相同時取職務 5)
  watcher() {
    const st = this.st; let a = 0xffff, b = 0xffff, pa = 0, pb = 0;
    for (let i = 0; i < 0x1e; i++) {
      const n = st.u8(DS.PARTY_CREW + i); if (n === 0xff) continue;
      const P = st.personRecord(n), j = st.u8(P + OFF.PERSON.ROLE);
      if (j === 3) { pa = P; a = n; } else if (j === 5) { pb = P; b = n; }
    }
    if (b === 0xffff && a === 0xffff) return 0xffff;
    if (b === 0xffff) return a;
    if (a !== 0xffff && st.u8(pb + 0x1f) < st.u8(pa + 0x1f)) return a;
    return b;
  }
  // 1999c 天候開始: [0cb3] = (高 4 位元) | 種類 | 0x40; 觀測者 random(100) <= +1f 時發言 (msg + 2 若 +1e < 70; + 1 若 +2f bit3)
  async weatherBegin(msg, kind) {
    const st = this.st, { sys, message, menu, win } = this.c;
    const di = this.watcher();
    st.set8(DS.WEATHER, (st.u8(DS.WEATHER) & 0xf0) | kind | 0x40);
    if (di === 0xffff) return;
    const P = st.personRecord(di);
    if ((this.c.sys.rng.random(100) & 0xff) > st.u8(P + 0x1f)) return;
    if (this.port !== 0xff) return;
    sys.mouseHide();
    this.b.talkPerson(di);
    if (st.u8(P + 0x1e) < 0x46) msg += 2;
    message(st.u8(P + OFF.PERSON.FLAGS) & 8 ? msg + 1 : msg);
    await menu.waitPrompt(); await win.close();
    sys.mouseShow();
  }
  // 船員發言 0x... (+1 若發言者 +2f bit3) 後等待、關閉
  async crewSay(m0, m1, ...a) {
    const { message, menu, win } = this.c, st = this.st, p = this.b.crewSpeaks();
    message(p !== 0xff && (st.u8(st.personRecord(p) + 0x2f) & 8) ? m1 : m0, ...a);
    await menu.waitPrompt(); await win.close();
  }
  // 19f48 天候進行中: 剛開始 (bit6) 時船員報告 (暴風雨先 2103 + GRAPH #0x3a), 重畫地圖, bit6 → bit7; 依種類 19bd1 / 19e84 / 19efc; 1976e
  async weatherOngoing() {
    const st = this.st, { sys, graph } = this.c;
    if (st.u8(DS.WEATHER) & 0x40) {
      sys.mouseHide();
      if ((st.u8(DS.WEATHER) & 15) === 1) { this.clearCache(); graph.draw(0x3a, 0xa0, 0x10); }
      const si = ((st.u8(DS.WEATHER) & 15) + 0xaf) * 2;
      await this.crewSay(si, si + 1);
      this.drawMap();
      sys.mouseShow();
      st.set8(DS.WEATHER, (st.u8(DS.WEATHER) & 0xbf) | 0x80);
    }
    switch (st.u8(DS.WEATHER) & 15) {
      case 1: await this.storm(); break;
      case 2: await this.calm(); break;
      case 3: await this.fog(); break;
    }
    this.c.palette.selectTimePalette(this.time, true, st.u8(DS.WEATHER));   // 1976e
  }
  // 19bd1 暴風雨 (每時刻): 各船損傷 si = min(10, (100 − 船長 +1d) / (+24/5 + 3) + 1) + random(2), 非 +10 bit6 的船 ×5;
  //   耐久度 (+2) −si, 轉向力 (+4)、推進力 (+5) −si/2; 最大耐久 (+3) = max(船型 +1 / 4, +3 − 1), 耐久度 <= 最大耐久;
  //   耐久度 0: 主角的船 → 淡出、[03ea] = 0x18 (遊戲結束); 其他船 → 沉沒訊息 0x166/0x167 (+ 船長 0x329 或 19849), 5deb
  //   [1005]&0x18 時不損傷。之後 18299、風力 = 7; 非當天開始且 (random(8) = 0 或離開天候區) → 結束 0x168/0x169; 8067
  async storm() {
    const st = this.st, { sys, palette, message, menu, win } = this.c, rng = this.c.sys.rng, F = this.fleet;
    if (!(st.u8(DS.SEA_FLAGS2) & 0x18)) {
      for (let i = 0; i < 10; i++) {
        const M = this.crewOf(i), S = this.slotOf(i);
        if ((st.u8(S + 8) & 0x30) !== 0x10) continue;
        const P = st.personRecord(st.u8(M + OFF.CREW_SLOT.CAPTAIN)), ship = this.shipRec(st.u8(S + 7));
        const cx = Math.floor(st.u8(P + OFF.PERSON.NAV_LEVEL) / 5) + 3;
        let si = seaUmin(10, (Math.trunc((100 - st.u8(P + 0x1d)) / cx) + 1) & 0xffff);
        si = (si + rng.random(2)) & 0xffff;
        if (!(st.u8(ship + 0x10) & 0x40)) si = (5 * si) & 0xffff;
        st.set8(S + 2, st.u8(S + 2) - seaUmin(st.u8(S + 2), si));
        const h = Math.trunc(seaS16(si) / 2);
        st.set8(S + 5, st.u8(S + 5) - seaUmin(st.u8(S + 5), h));
        st.set8(S + 4, st.u8(S + 4) - seaUmin(st.u8(S + 4), h));
        const mx = seaUmax(st.u8(this.typeOf(st.u8(ship + 0x0f)) + 1) >> 2, (st.u8(S + 3) - 1) & 0xffff) & 0xff;
        st.set8(S + 3, mx);
        st.set8(S + 2, seaUmin(mx, st.u8(S + 2)));
        if (st.u8(S + 2)) continue;
        if (st.u8(M + OFF.CREW_SLOT.CAPTAIN) === st.u8(DS.HERO)) { await palette.fadeBlack(); palette.ending = 0x18; return; }
        sys.mouseHide();
        const cap = st.u8(M + OFF.CREW_SLOT.CAPTAIN), Pc = st.personRecord(cap);
        if (!(st.u8(Pc + 0x1b) & 0xc0)) {
          let k = 0; while (k < 0x1e && st.u8(DS.PARTY_CREW + k) !== cap) k++;
          if (k < 0x1e) st.set8(DS.PARTY_CREW + k, 0xff);
          const p = this.b.crewSpeaks();
          message(p !== 0xff && (st.u8(st.personRecord(p) + 0x2f) & 8) ? 0x167 : 0x166, this.b.dstr(this.shipRec(st.u8(S + 7))));
          message(0x329, this.b.dstr(Pc));
          st.set8(DS.PARTY_CREW + k, cap);                                      // 原版把船長放回原位 (找不到時寫到 DS:2e39)
          this.removeShip(i);
        } else {
          this.dropShip(i, M);
          const p = this.b.crewSpeaks();
          message(p !== 0xff && (st.u8(st.personRecord(p) + 0x2f) & 8) ? 0x167 : 0x166, this.b.dstr(this.shipRec(st.u8(S + 7))));   // 5deb 不清 +7 與船名, 仍是原船名
        }
        await menu.waitPrompt(); await win.close();
        sys.mouseShow();
      }
      this.fleetDurability(F);                                         // 18299
    }
    st.set8(DS.PORT_FLAGS, st.u8(DS.PORT_FLAGS) | 7);
    if (!(st.u8(DS.WEATHER) & 0x80) && (!rng.random(8) || !(st.u8(DS.PORT_FLAGS) & 0x80))) {
      this.c.sfx?.off();                                               // 9888 停止效果音
      st.set8(DS.WEATHER, st.u8(DS.WEATHER) & 0xf0);
      sys.mouseHide(); await this.crewSay(0x168, 0x169); sys.mouseShow();
    }
    this.seaPanel();                                                   // 8067
  }
  // 18299 艦隊 +28 = (各船耐久度和 + 4) / 5; 和為 0 時 +29 bit0 清除
  fleetDurability(F) {
    const st = this.st; let sum = 0;
    for (let i = 0; i < 10; i++) { const S = F + OFF.FLEET.SHIPS + 9 * i; if ((st.u8(S + 8) & 0x30) === 0x10) sum += st.u8(S + 2); }
    st.set8(F + OFF.FLEET.STRENGTH, Math.trunc((sum + 4) / 5));
    if (!sum) st.set8(F + OFF.FLEET.FLAGS, st.u8(F + OFF.FLEET.FLAGS) & 0xfe);
  }
  // 19e84 無風: 非當天開始、random(20) = 0 且所在海域風力 (風向表 &7) ≠ 0 → 結束 0x16a/0x16b; 期間風力 = 0
  async calm() {
    const st = this.st, rng = this.c.sys.rng, [w] = this.clock.windAt(this.fleet), { sys } = this.c;
    if (!(st.u8(DS.WEATHER) & 0x80) && !rng.random(0x14) && (w & 7)) {
      st.set8(DS.WEATHER, st.u8(DS.WEATHER) & 0xf0);
      sys.mouseHide(); await this.crewSay(0x16a, 0x16b); sys.mouseShow();
    }
    st.set8(DS.PORT_FLAGS, st.u8(DS.PORT_FLAGS) & 0xf8);
  }
  // 19efc 霧: 非當天開始且 (random(30) = 0 或離開天候區 (風 bit7 = 0)) → 結束 0x16c
  async fog() {
    const st = this.st, rng = this.c.sys.rng, { sys, message, menu, win } = this.c;
    if (st.u8(DS.WEATHER) & 0x80) return;
    if (rng.random(0x1e) && (st.u8(DS.PORT_FLAGS) & 0x80)) return;
    st.set8(DS.WEATHER, st.u8(DS.WEATHER) & 0xf0);
    sys.mouseHide(); this.b.crewSpeaks(); message(0x16c); await menu.waitPrompt(); await win.close(); sys.mouseShow();
  }

  // ================= 靠港 0fea:c0d9 = 1bf79 =================
  // 主角周圍 12 格 (DS:a6e8) 中地圖緩衝 ([03f6], 96 寬, 以區域左上為原點) 是港口圖塊 0x74 / 0x78 的: 1bb4a 找座標相同的港口 → [0cae]
  //   → 1bf4c 確認 → [1005] |= 0x20、交易記錄 (種類 0, +4 出港天數, +6 港口) → 1bd16 到港處理 → 8c53 進港; 否 → [0cae] = FF 結束
  //   **進港後迴圈不結束**: 繼續檢查其餘的格, 但緩衝已換成港口地圖 (原版如此, 若剛好是 0x74 / 0x78 會再問一次)
  async dock() {
    const st = this.st, F = this.fleet, T = this.SJ.tab.dock12;
    let cx = (Math.trunc(this.wx(F) / 24) % 30) - 1, cy = (Math.trunc(this.wy(F) / 24) % 45) - 1;
    cx = cx < 0 ? 0 : cx > 0x1b ? 0x1b : cx; cy = cy < 0 ? 0 : cy > 0x2a ? 0x2a : cy;
    const rx = seaS16((this.wx(F) % 0x2d0) - 24 * cx), ry = seaS16(this.wy(F) - 24 * cy);
    for (let k = 0; k < 12; k++) {
      const x = T[2 * k] + rx, y = T[2 * k + 1] + ry;
      if (x < 0 || x >= 0x60 || y < 0 || y >= 0x60) continue;
      const t = this.map[y * 0x60 + x];
      if (t !== 0x74 && t !== 0x78) continue;
      st.set8(DS.PORT, this.portIdAt(this.wx(F) + T[2 * k], this.wy(F) + T[2 * k + 1]) & 0xff);
      if (!(await this.askDock())) { st.set8(DS.PORT, 0xff); return; }
      st.set8(DS.SEA_FLAGS2, st.u8(DS.SEA_FLAGS2) | 0x20);
      marketTradeLog(st, this.c.rt, 0, st.u8(DS.DAYS_AT_SEA), 0, 0, st.u8(DS.PORT));
      await this.arrival();                                            // 1bd16
      await this.enter();                                              // 8c53
    }
  }
  // 1bb4a 座標完全相同的港口 (130 個), 沒有 → 0xffff
  portIdAt(x, y) {
    const st = this.st;
    for (let i = 0; i < 0x82; i++) { const R = DS.TBL_PORT + i * 0x16; if (st.u16(R) === (x & 0xffff) && st.u16(R + 2) === (y & 0xffff)) return i; }
    return 0xffff;
  }
  // 1bf4c 船員「要進入%s港嗎？」(0x16d) 是/否
  async askDock() {
    const st = this.st, { message, menu, win } = this.c;
    this.b.crewSpeaks();
    message(0x16d, this.b.dstr(DS.TBL_PORT + st.u8(DS.PORT) * 0x16 + 4));
    const r = await menu.yesNo();
    await win.close();
    return r;
  }
  // 1bd16 到港: 港口 +15 |= 0x50、[1005] |= 0x20、[0cb3] &= C0; 依出港天數 d 給經驗 (主角與職務 2/3 的船員 2·min(d,70)², 其他船員 min(d,100)²);
  //   1fd9:333a 地點位元表; 港口 < 100 時更新中古船清單 DS:7f74 (3 筆 × 8: +0..+4 船型, +5 港口)
  async arrival() {
    const st = this.st, rng = this.c.sys.rng, port = st.u8(DS.PORT);
    st.set8(DS.TBL_PORT + port * 0x16 + 0x15, st.u8(DS.TBL_PORT + port * 0x16 + 0x15) | 0x50);
    st.set8(DS.SEA_FLAGS2, st.u8(DS.SEA_FLAGS2) | 0x20);
    st.set8(DS.WEATHER, st.u8(DS.WEATHER) & 0xc0);
    this.c.sfx?.off();                                                 // 9888 停止效果音
    const a = seaUmin(st.u8(DS.DAYS_AT_SEA), 0x46), b2 = seaUmin(st.u8(DS.DAYS_AT_SEA), 0x64);
    const g2 = Math.imul(b2, b2) & 0xffff, g1 = (Math.imul(a, a) << 1) & 0xffff;
    const H = this.b.hero;
    if (this.levelUp(H, g1)) await this.levelMsg(H, 0);
    for (let k = 0; k < 0x1e; k++) {
      const n = st.u8(DS.PARTY_CREW + k); if (n === 0xff) continue;
      const P = st.personRecord(n), j = st.u8(P + OFF.PERSON.ROLE);
      if (j === 2 || j === 3) { if (this.levelUp(P, g1)) await this.levelMsg(P, 1); }
      else if (this.levelUp(P, g2)) await this.levelMsg(P, 2);
    }
    this.locationBits();                                               // 1fd9:333a
    if (port >= 0x64) return;
    const E = DS.TBL_PORT_ECONOMY + port * 0x25, L = DS.TBL_USED_SHIP_CACHE;
    const ent = i => L + 8 * i, copy = (d, s0) => { for (let i = 0; i < 8; i++) st.set8(d + i, st.u8(s0 + i)); };
    let si = 0; while (si < 3 && st.u8(ent(si) + 5) !== port) si++;
    if (si < 3) {
      const tmp = st.bytes(ent(si), 8).slice();
      for (let k = si; k > 0; k--) copy(ent(k), ent(k - 1));
      for (let i = 0; i < 8; i++) st.set8(L + i, tmp[i]);
      return;
    }
    for (let k = 2; k > 0; k--) copy(ent(k), ent(k - 1));
    st.set8(L + 5, port);
    for (let i = 0; i < 5; i++) st.set8(L + i, 0xff);
    const R = this.SJ.tab.usedShips, row = st.u8(E + 0x22) * 8;
    let di = 8;
    for (let i = 0; i < 8; i++) { const t = R[row + i]; if (t === 0xff || ((10 * st.u8(this.typeOf(t))) & 0xffff) > st.u16(E + 4)) di--; }
    let k = 0;
    if (di) for (let n = 0; n < 3; n++) st.set8(L + k++, R[row + (rng.random(di) & 0xff)]);
    for (let n = 0; n < 2; n++) st.set8(L + k++, this.SJ.tab.usedShips2[rng.random(Math.floor(seaUmin(st.u16(E), 0x2a8) / 0x28) + 1) & 0xff]);
  }
  // 1bb9c 經驗 (+26) += g; 足夠時升級 (+24, 所需 = min(等級, 18)² × 30, 100 為上限: 經驗歸零); 有升級時 +1c..+1f 各 + min(random(3), 100 − 值)
  levelUp(P, g) {
    const st = this.st, rng = this.c.sys.rng;
    let n = 0;
    st.set16(P + OFF.PERSON.NAV_EXP, st.u16(P + OFF.PERSON.NAV_EXP) + g);
    for (;;) {
      const lv = st.u8(P + OFF.PERSON.NAV_LEVEL), need = seaS16(Math.imul(seaUmin(lv, 0x12) * seaUmin(lv, 0x12), 0x1e));
      if (need > seaS16(st.u16(P + OFF.PERSON.NAV_EXP))) break;
      if (lv === 0x64) { st.set16(P + OFF.PERSON.NAV_EXP, 0); break; }
      n++; st.set16(P + OFF.PERSON.NAV_EXP, st.u16(P + OFF.PERSON.NAV_EXP) - need); st.set8(P + OFF.PERSON.NAV_LEVEL, lv + 1);
    }
    if (n) for (let i = 0; i < 4; i++) st.set8(P + OFF.PERSON.STATS + i, st.u8(P + OFF.PERSON.STATS + i) + seaUmin(rng.random(3), (100 - st.u8(P + OFF.PERSON.STATS + i)) & 0xffff));
    return n;
  }
  // 1bc14 升級訊息: 發言者就是本人 → 「助手」, 主角 → 「船長」, 其他 → 姓名; 「的航海等級有所提高．」+ 3 項能力各 + min(random(3), 100 − 值) (有增加的列出) + 「上昇．」
  async levelMsg(P, kind) {
    const st = this.st, { sys, con, printf, menu, win } = this.c, rng = sys.rng;
    const l = con.left, r = con.right;
    sys.mouseHide();
    const p = this.b.crewSpeaks();
    con.puts(p !== 0xff && st.personRecord(p) === P ? this.SS.assistant : kind === 0 ? this.SS.captainT : this.b.dstr(P));
    con.puts(this.SS.levelUp);
    let up = 0;
    for (let i = 0; i < 3; i++) {
      const v = seaUmin(rng.random(3), (100 - st.u8(P + OFF.PERSON.STATS + i)) & 0xffff) & 0xff;
      if (!v) continue;
      printf(this.SS.listSep, this.SJ.statNames[i] ? seaHex(this.SJ.statNames[i]) : Uint8Array.of(0));
      st.set8(P + OFF.PERSON.STATS + i, st.u8(P + OFF.PERSON.STATS + i) + v); up = 1;
    }
    if (up) { con.setCursor(con.x - 2, con.y); con.puts(this.SS.rise); }
    this.c.sfx?.voice(0x0c2e); this.c.sfx?.note(0x3c);                // 9768(DS:0c2e) + 9804(0x3c) 效果音, 5998(0x14) 延遲, 9888
    await sys.waitTicks(0x14);
    this.c.sfx?.off();
    await menu.waitPrompt(); await win.close();
    sys.mouseShow();
    con.left = l; con.right = r;
  }
  // 1fd9:333a = 230ca 地點 (x & 0x7fff, y) 所在的格在探索表 DS:0de8 有位元的, DS:1046 位元表設位元
  locationBits() {
    const st = this.st, N = this.c.nodesRT ?? this.c.mapNodes;
    if (!N) return;
    for (let i = 0; i < this.SJ.nodeCount; i++) {
      const x = Math.floor(((N[i * 16] | (N[i * 16 + 1] << 8)) & 0x7fff) / 24), y = Math.trunc(seaS16(N[i * 16 + 2] | (N[i * 16 + 3] << 8)) / 24);
      const a = WorkDS.EXPLORE_MAP + ((y * 12) & 0xffff) + (x >> 3);
      if (st.u8(a) & (0x80 >> (x & 7))) st.set8(DS.EXPLORE_LOC + (i >> 3), st.u8(DS.EXPLORE_LOC + (i >> 3)) | (0x80 >> (i & 7)));
    }
  }

  // 2e09:3223 = 312b3 委任: 職務 3 的第一個船員 (seg0:5cee) 沒有或 +30 bit4 (技能) = 0 → 船員 0x357/0x358 (+2f bit3), 回傳 0;
  //   否則 0fea:321a 已發現港口清單 (清單 0x85 = 種類 5 港名) → 艦隊 +4/+6 = 港口座標 (陸地上, 之後 23e53 換成附近的海), +0c = 0x4000, +1b = 0,
  //   [1005] = (&DF) | 0x80 (之後每個時刻由 316b3 / 313b1 自動航行); 取消 → 0
  async delegate() {
    const st = this.st;
    let ok = 0;
    for (let i = 0; i < 0x1e; i++) {
      const n = st.u8(DS.PARTY_CREW + i); if (n === 0xff) continue;
      if (st.u8(st.personRecord(n) + 0x2e) === 3) { if (st.u8(st.personRecord(n) + 0x30) & 0x10) ok = 1; break; }
    }
    if (!ok) { await this.crewSay(0x358, 0x357); return 0; }
    const si = await this.b.listSel().select(0x85, this.knownPorts());
    if (si < 0) return 0;
    const R = DS.TBL_PORT + (((this.c.persons[si] & 0xff) * 0x16) & 0xffff), F = this.fleet;   // seg0:5c9a
    st.set16(F + OFF.FLEET.DEST_X, st.u16(R)); st.set16(F + OFF.FLEET.DEST_Y, st.u16(R + 2));
    st.set16(F + OFF.FLEET.ROUTE_FLAGS, 0x4000); st.set8(F + OFF.FLEET.MISSION, 0);
    st.set8(DS.SEA_FLAGS2, (st.u8(DS.SEA_FLAGS2) & 0xdf) | 0x80);
    return 1;
  }
  // 0fea:321a = 130ba 已發現 (+15 bit4) 的港口編號 → [0538], 回傳個數
  knownPorts() {
    const st = this.st, P = this.c.persons; let n = 0;
    for (let i = 0; i < 0x82; i++) if (st.u8(DS.TBL_PORT + i * 0x16 + 0x15) & 0x10) P[n++] = i;
    return n;
  }
  // ================= 停船 / 出航 20ee3 =================
  async stopToggle() {
    const st = this.st, { win, con, menu, scr } = this.c;
    if (scr.wideRenderer) this.b.beginWideTalk(null);
    else win.shadowedSaved(0x10, 0xa0, 0x24, 0x48, 1);
    if (st.u8(DS.SEA_FLAGS2) & 0x20) { con.puts(this.SS.move); st.set8(DS.SEA_FLAGS2, st.u8(DS.SEA_FLAGS2) & 0xdf); }
    else { con.puts(this.SS.stop); st.set8(DS.SEA_FLAGS2, (st.u8(DS.SEA_FLAGS2) | 0x20) & 0x7f); }
    await menu.waitPrompt(); await win.close();
  }

  // ================= 登陸 2e09:6e37 = 34ec7 =================
  // 主角周圍 8 個 2×2 位置 (DS:b92e / b93e, 靠視窗邊緣的方向略過) 做成點擊區 → 0fea:37d1 選擇 → [8246] = 34c53 該處的發現物
  //   → 該處地圖格: 0x41/0x49/0x51/0x59 (0x59 時 [b8de] = 0) 或 0x7c..0x7f → 34d54 上陸; 0x74..0x7b → 靠港; < 0x74 → 0x1b9「這裡不能上陸」; >= 0x80 → 無
  //   [1005]&0x18 時直接 34d54
  async land() {
    const st = this.st, F = this.fleet, { menu, message, win } = this.c;
    if (st.u8(DS.SEA_FLAGS2) & 0x18) { await this.landExplore(); return; }
    const rx = this.wx(F) - this.vx1006, ry = this.wy(F) - this.vy1008, DX = this.SJ.tab.landDX, DY = this.SJ.tab.landDY, Pn = this.c.persons;
    let n = 0;
    for (let d = 0; d < 8; d++) {
      if (d < 2 ? !(ry > 0) : d < 4 ? !(rx < 0x16) : d < 6 ? !(ry < 0x16) : !(rx > 0)) continue;
      const x = ((rx + DX[d] + 6) << 4) & 0xffff, y = (((ry + DY[d]) << 4) + 8) & 0xffff;        // 34e8d
      Pn[2 * n] = x; Pn[2 * n + 1] = y;
      Object.assign(menu.rects[n], { x0: seaS16(x), x1: seaS16(x + 0x10), y0: seaS16(y), y1: seaS16(y + 0x10) });   // 34e6e
      n++;
    }
    menu.count = n;                                                    // [a158]
    const sel = await this.pickRect();                                 // 0fea:37d1
    if (sel === 0xff) return;
    const x = Math.trunc(seaS16(Pn[2 * sel] - 0x60) / 16), y = Math.trunc(seaS16(Pn[2 * sel + 1] - 8) / 16);
    st.set8(DS.DISCOVERY_ID, this.discNear(x, y));                              // [8246] (在存檔範圍內)
    let cx = (Math.trunc(this.wx(F) / 24) % 30) - 1, cy = (Math.trunc(this.wy(F) / 24) % 45) - 1;
    cx = cx < 0 ? 0 : cx > 0x1b ? 0x1b : cx; cy = cy < 0 ? 0 : cy > 0x2a ? 0x2a : cy;
    const bx = seaS16((this.wx(F) % 0x2d0) - 24 * cx), by = seaS16(this.wy(F) - 24 * cy);
    this.landFlag = 1;                                                 // [b8de]
    const t = this.map[((y - ry + by) * 0x60 + (x - rx + bx)) & 0xffff] ?? 0;
    if (t === 0x41 || t === 0x49 || t === 0x51 || t === 0x59) { if (t === 0x59) this.landFlag = 0; await this.landExplore(); }
    else if (t < 0x74) { this.b.crewSpeaks(); message(0x1b9); await menu.waitPrompt(); await win.close(); }
    else if (t < 0x7c) await this.dock();
    else if (t < 0x80) await this.landExplore();
  }
  // 34c53 視窗座標 (x, y) 的 2×2 (含左上 1 格) 內的發現物編號, 沒有 → 0xff
  discNear(x, y) {
    const st = this.st;
    for (let d = 0; d < 0x64; d++) for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      const R = DS.TBL_DISCOVERY + d * 7;
      if (((x - st.u16(R) + this.vx1006) & 0xffff) === a && ((this.vy1008 - st.u16(R + 2) + y) & 0xffff) === b) return d;
    }
    return 0xff;
  }
  // 0fea:37d1 = 13671 以點擊區選擇 (數字鍵 4 / 6 循環, Enter 確定, Esc / '0' 取消 → 0xff); [a160] 不重設 (超出時才歸 0)
  async pickRect() {
    const { sys, menu, scr } = this.c;
    if (scr.wideRenderer && scr._wideSeaCam) {
      await menu.waitRelease();
      if (menu.count <= menu.cur) menu.cur = 0;
      const toBox = i => {
        const cam = scr._wideSeaCam;
        const r = menu.rects[i];
        const col = Math.trunc((r.x0 - 0x60) / 16);
        const row = Math.trunc((r.y0 - 8) / 16);
        let dx = (cam.vx1006 + col) - cam.baseWX;
        if (dx < -cam.worldW / 2) dx += cam.worldW;
        else if (dx > cam.worldW / 2) dx -= cam.worldW;
        const dy = (cam.vy1008 + row) - cam.baseWY;
        return { x: (dx - cam.camX) * cam.tile, y: (dy - cam.camY) * cam.tile, size: cam.tile * 2 };
      };
      const drawFn = ctx => {
        ctx.save();
        for (let i = 0; i < menu.count; i++) {
          const b = toBox(i);
          if (i === menu.cur) continue;
          ctx.fillStyle = "rgba(255, 224, 130, 0.10)";
          ctx.fillRect(b.x, b.y, b.size, b.size);
          ctx.strokeStyle = "rgba(255, 224, 130, 0.55)";
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          ctx.strokeRect(b.x + 1, b.y + 1, b.size - 2, b.size - 2);
          ctx.setLineDash([]);
        }
        const curBox = toBox(menu.cur);
        const pulse = 0.72 + 0.28 * Math.sin(performance.now() * 0.008);
        ctx.fillStyle = `rgba(245, 200, 92, ${(0.24 * pulse).toFixed(3)})`;
        ctx.fillRect(curBox.x, curBox.y, curBox.size, curBox.size);
        ctx.strokeStyle = `rgba(255, 232, 148, ${(0.98 * pulse).toFixed(3)})`;
        ctx.lineWidth = 3.5;
        ctx.strokeRect(curBox.x + 1.5, curBox.y + 1.5, curBox.size - 3, curBox.size - 3);
        // 頂部提示
        const promptText = "请选择登陆地点";
        ctx.font = '700 15px "Microsoft YaHei UI", "PingFang SC", "Noto Sans SC", sans-serif';
        const pw = ctx.measureText(promptText).width + 36, ph = 38, px = (1280 - pw) / 2, py = 20;
        ctx.fillStyle = "rgba(246, 236, 212, 0.96)";
        ctx.strokeStyle = "#9c7432";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(px, py, pw, ph, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#3d2817";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(promptText, 640, py + ph / 2);
        ctx.restore();
      };
      const hitIdx = (vx, vy) => {
        for (let i = 0; i < menu.count; i++) {
          const b = toBox(i);
          if (vx >= b.x && vx < b.x + b.size && vy >= b.y && vy < b.y + b.size) return i;
        }
        return -1;
      };
      scr.wideOverlays.push(drawFn);
      scr.dirty = true;
      sys.mouseShow();
      let res = 0xff;
      try {
        for (;;) {
          const vx = sys.mouse?.vx ?? -1, vy = sys.mouse?.vy ?? -1;
          const hov = hitIdx(vx, vy);
          if (hov >= 0 && hov !== menu.cur) { menu.cur = hov; scr.dirty = true; }
          const k = menu.readEvent();
          if (k === 0x1b || k === 0x30) { res = 0xff; break; }
          if (k === 0x0d) {
            if (menu.mouseFlag) {
              if (hov >= 0) { menu.cur = hov; res = hov; break; }
              res = 0xff; break;
            }
            res = menu.cur; break;
          }
          if (k === 0x34 || k === 0x1d || k === 0x1e || k === 0x38) menu.cur = menu.cur > 0 ? menu.cur - 1 : menu.count - 1;
          else if (k === 0x36 || k === 0x1c || k === 0x1f || k === 0x32) menu.cur = menu.count - 1 > menu.cur ? menu.cur + 1 : 0;
          scr.dirty = true;
          await sys.poll();
        }
      } finally {
        const idx = scr.wideOverlays.indexOf(drawFn);
        if (idx >= 0) scr.wideOverlays.splice(idx, 1);
        scr.dirty = true;
        await menu.waitRelease();
        sys.mouseHide();
      }
      return res;
    }
    sys.mouseShow();
    if (menu.count <= menu.cur) menu.cur = 0;
    menu.highlight(0);
    let k;
    do {
      k = await menu.getKeyFree();                                     // 135f0 → 13412
      if (k === 0x0d && menu.mouseFlag && !menu.hit) k = 0xff;
      menu.prev = menu.cur;
      if (k === 0x34) menu.cur = menu.cur > 0 ? menu.cur - 1 : menu.count - 1;
      else if (k === 0x36) menu.cur = menu.count - 1 > menu.cur ? menu.cur + 1 : 0;
      if (k === 0x34 || k === 0x36) menu.moveHighlight();
      sys.flush();
    } while (k !== 0x0d && k !== 0x1b && k !== 0x30);
    menu.highlight(menu.bracket);
    await menu.waitRelease();
    sys.mouseHide();
    return k === 0x1b || k === 0x30 ? 0xff : menu.cur;
  }
  // 34d54 上陸探索 (確認、MENU #0x24 上陸選單、34ccc 發現物) → scenes/land.js (RE_NOTES 第 36 節)
  async landExplore() { await new Land(this).run(); }

  // ================= 命令 交涉 20a6d / 戰鬥 0fea:1181 / 偵察 1feae =================
  // 0fea:314a = 12fea(r) 距離 <= r、出航中 (+29 bit0)、非 bit4、指揮者 (+2a) 不是主角的艦隊 → DS:0538 = 指揮者, 回傳數量
  nearFleets(r) {
    const st = this.st, P = this.c.persons; let n = 0;
    for (let k = 0; k < 0x46; k++) {
      const F = DS.TBL_FLEET + k * 0x85;
      if (!(st.u8(F + OFF.FLEET.FLAGS) & 1) || (st.u8(F + OFF.FLEET.FLAGS) & 0x10) || st.u8(F + OFF.FLEET.ADMIRAL) === st.u8(DS.HERO)) continue;
      if (this.near(r, seaS16(st.u16(F)), seaS16(st.u16(F + OFF.FLEET.Y)))) P[n++] = st.u8(F + OFF.FLEET.ADMIRAL);
    }
    return n;
  }
  async smallMsg(m) {
    const { win, message, menu, scr } = this.c;
    if (scr.wideRenderer) this.b.beginWideTalk(null);
    else win.shadowedSaved(0x14, 0x80, 0x1e, 0x60, 0);
    message(m); await menu.waitPrompt(); await win.close();
  }
  // 20a6d 交涉 → 20127 (scenes/negotiate.js, 第 30.1 節)
  async negotiate() { return seaNegotiate(this); }
  // 10f7e 海戰 (AL, DL = 雙方指揮者, 其中一方是主角; BL、堆疊參數 = 雙方援軍, 0xff = 沒有) → scenes/battle.js (第 30 節)
  async navalBattle(al, dl, bl, arg) { return new NavalBattle(this).run(al, dl, bl, arg); }
  // 0fea:1181 = 11021 戰鬥: 時刻 < 15 或 >= 60 → 0x30d「夜間不能開戰」; 10df0 選對象 (附近沒有 → 0x30a); 與主角同國 (非 6) → 0x30e 確認; → 10f7e(主角, 對象, 0xff, 0xff)
  async battle() {
    const st = this.st, t = this.c.rt.time;
    if (t < 0x0f || t >= 0x3c) { await this.smallMsg(0x30d); return; }
    for (;;) {
      const tg = await this.battleTarget();
      if (tg === 0xff) return;
      const nat = Math.floor(st.u8(st.personRecord(tg) + 0x2c) / 10), hn = st.u8(this.b.hero + 0x31) & 0x0f;
      if (nat === hn && hn !== 6) {
        const { win, message, menu, scr } = this.c;
        if (scr.wideRenderer) this.b.beginWideTalk(null);
        else win.shadowedSaved(0x14, 0x80, 0x1e, 0x60, 0);
        message(0x30e);
        const ok = await menu.yesNo(); await win.close();
        if (!ok) continue;
      }
      await this.navalBattle(st.u8(DS.HERO), tg, 0xff, 0xff);
      return;
    }
  }
  // 10df0 對象: 12fea(2) → 清單 3 → 1c839 人物資料 + 是/否
  async battleTarget() {
    for (;;) {
      const n = this.nearFleets(2);
      if (!n) { await this.smallMsg(0x30a); return 0xff; }
      const si = await this.b.listSel().select(3, n);
      await this.c.win.close();
      if (si === -1) return 0xff;
      this.commandsObj().personInfo(this.c.persons[si], 0x0f, 0);
      if (await this.c.menu.yesNo()) return this.c.persons[si];
    }
  }
  // ================= 情報 航海圖 0fea:dc2e = 1dace、隨身物 地圖 0fea:ded6 = 1dd76 =================
  // 1d8ac(0x80): 現代 PNG 模式直接由 seachip.png 縮放繪製，無需二進位縮圖表
  chartTiles() {
    return null;
  }
  // 1d710(欄 col, y, 世界欄 bc, 列 br, 縮圖表 T, 模式)
  chartQuad(col, y, bc, br, _T, mode) {
    const st = this.st, scr = this.c.scr, art = this.c.art;
    bc %= 0x5a;
    if (mode === 0 && !(st.u8(WorkDS.EXPLORE_MAP + ((12 * br) & 0xffff) + (bc >> 3)) & (0x80 >> (bc & 7)))) { scr.fillCols(col, y, 0x18, 0xc0, 9); return; }
    const it = (3 * Math.trunc(br / 0x2d) + Math.trunc(bc / 0x1e)) & 0xff;
    if (it !== this.item) this.item = it;                              // 849a
    let ox = 0x18, oy = 0x18, r = (br % 0x2d) - 1, c = (bc % 0x1e) - 1;
    if (c < 0) { c = 0; ox = 0; } else if (c > 0x1b) { ox = 0x30; c = 0x1b; }
    if (r < 0) { r = 0; oy = 0; } else if (r > 0x2a) { oy = 0x30; r = 0x2a; }
    if (mode === 0) this.decodeRegion(0x1e * r + c);                   // 1fd9:2fd2
    else this.wm.decodeChart(st, this.item, 0x1e * r + c, this.seaBuf);   // 1fd9:3187
    for (let rr = 0; rr < 0x18; rr++) for (let cc = 0; cc < 0x18; cc++)
      art?.drawSheetTile(scr, "seachip", this.seaBuf[0x60 * (oy + rr) + ox + cc], (col + cc) * 8, y + rr * 8, { dw: 8, dh: 8, smooth: true });
  }
  // 1fd9:1f2a 水平 XOR 線 (逐點 seg0:0b33, 剪裁矩形 DS:aaac)
  xorLine(x0, y, x1, color) {
    const [cx0, cy0, cx1, cy1] = this.c.clip ?? [0, 0, 0x27f, 0x18f], fb = this.c.scr.fb;
    if (y < cy0 || y > cy1) return;
    for (let x = Math.max(x0, cx0); x <= Math.min(x1, cx1); x++) fb[y * 640 + x] ^= color & 15;
    this.c.scr.dirty = true;
  }
  // 1d9be 世界全圖: 淡出 → GRAPH.DAT #0x19 (5b5d) → 未探索的海域格 (DS:0de8) 以 6 × 6 色 0xd 蓋住 (畫面欄 = 世界欄 + [06d5] (= 30) mod 90) →
  //   主角位置 ((x + 720) mod 2160 − 12) / 4、(y − 12) / 4 起 6 條 XOR 色 0xb 的橫線 → 99ce(DS:a700) 航海圖調色盤
  async worldView() {
    const st = this.st, { palette, graph, scr } = this.c, F = this.fleet;
    scr.setAtmosphere?.({ active: false });
    scr.wideRenderer = null;
    await palette.fadeBlack();                                         // 99f2
    graph.draw(0x19, 0, 0);
    for (let r = 0; r < 0x2d; r++) {
      let si = 0x5a - 0x1e;
      for (let c = 0; c < 0x5a; c++) {
        if (!(st.u8(WorkDS.EXPLORE_MAP + 12 * r + (si >> 3)) & (0x80 >> (si & 7)))) scr.fillRectPxPlanes(6 * c + 0x32, 6 * r + 0x32, 6 * c + 0x37, 6 * r + 0x37, 0x0d, 4);   // 1fd9:227c
        si = (si + 1) % 0x5a;
      }
    }
    const x = Math.trunc((((0x18 * 0x1e + st.u16(F)) % 0x870) - 0x0c) / 4) + 0x32;
    let y = Math.trunc((seaS16(st.u16(F + OFF.FLEET.Y)) - 0x0c) / 4) + 0x32;
    for (let i = 0; i < 6; i++, y++) this.xorLine(x, y, x + 5, 0x0b);
    await palette.fadeTo(palette.table("chart"));                      // 99ce(DS:a700)
  }
  // 0fea:dc2e = 1dace 航海圖: 在港時先讀海上圖塊 (84de, [06ca] = FF); 世界全圖上以 0fea:5f74 (90 × 45 格, 格寬 −6 = 1 格游標, 起點 = 主角所在) 選格 →
  //   該格與右、下 共 2 × 2 格都未探索 → 重選 (游標回到上次的格); 否則 淡出、清畫面 (07f7)、外框 (5a91: 在港 #3/#5 + 8894, 海上 #2/#4 + 日期 / 8067 / 8fbf)、
  //   1d710 畫 2 × 2 個海域格 (模式 0) → 航海圖調色盤 → 等按鍵 (131f9) → 淡出 → 1d9be → 99ce → 再選。取消後: 在港 88e9 + 外框 + 8894 + 羅盤指針;
  //   海上 還原 [06ca] (849a)、重新解碼目前區域、外框、舵輪指針 (95f2) → 1976e → 2103 + 1fac → 淡入
  async chart() {
    const st = this.st, { palette, sys, graph, scr, menu } = this.c, F = this.fleet;
    const item0 = this.item, needle0 = this.needle, inPort = this.port !== 0xff;
    if (inPort) this.item = 0xff;                                      // 84de (移植版的 seachip 常駐)
    const T = this.chartTiles();                                       // 1d8ac(0x80)
    await this.worldView();                                            // 1d9be
    let init = Math.trunc(st.u16(F + OFF.FLEET.Y) / 0x18) * 0x5a + Math.trunc(((0x1e * 0x18 + st.u16(F)) % 0x870) / 0x18);
    for (;;) {
      const r = await this.cellSel().select(0x32, 0x32, 0x5a, -6, 6, 0x2d, init);
      if (r === -1) break;
      const col = ((r % 0x5a) - 0x1e + 0x5a) % 0x5a, row = Math.trunc(r / 0x5a);
      let seen = 0;
      for (let yy = row; yy < row + 2; yy++) for (let xx = col; xx < col + 2; xx++) seen |= st.u8(WorkDS.EXPLORE_MAP + 12 * yy + (xx >> 3)) & (0x80 >> (xx & 7));
      if (!seen) continue;
      init = r;
      await palette.fadeBlack();                                       // 99f2
      scr.clear(0);                                                    // 07f7
      if (inPort) { graph.draw8(st.options & 0x80 ? 3 : 5, 0, 0); this.panels(); }
      else { graph.draw8(st.options & 0x80 ? 2 : 4, 0, 0); this.seaDate(); this.seaPanel(); this.dials(); }
      this.chartQuad(0x0c, 8, col, row, T, 0); this.chartQuad(0x24, 8, col + 1, row, T, 0);
      this.chartQuad(0x0c, 0xc8, col, row + 1, T, 0); this.chartQuad(0x24, 0xc8, col + 1, row + 1, T, 0);
      await palette.fadeTo(palette.table("chart"));                    // 99ce(DS:a700)
      sys.flush(); await menu.waitRelease(); await menu.waitPress();   // 131f9
      await palette.fadeBlack();
      await this.worldView();
      await palette.fadeTo(palette.table("chart"));
    }
    await palette.fadeBlack();
    if (inPort) { this.loadPort(); graph.draw8(st.options & 0x80 ? 3 : 5, 0, 0); this.panels(); this.compass(0xff); this.compass(needle0); }   // 88e9 / 5a91 / 8894 / 94fa
    else {
      if (this.item !== item0) this.item = item0;                      // 849a
      this.decodeRegion(this.region);                                  // 1fd9:2fd2([06c8])
      graph.draw8(st.options & 0x80 ? 2 : 4, 0, 0);
      this.helm(0xff); this.helm(needle0);                             // 95f2
    }
    palette.selectTimePalette(this.time, !inPort, st.u8(DS.WEATHER));      // 1976e
    this.clearCache(); this.drawMap();                                 // 2103 + 1fac
    await palette.fadeToTarget();                                      // 99e8
    sys.flush();                                                       // 3fae
  }
  // 0fea:ded6 = 1dd76 隨身物 種類 0x0c 地圖 (it = 隨身物編號): 縮圖表的圖塊 0x7c..0x7f 改成在圖塊 0x41 (海) 上畫 X 記號
  //   (DS:a7c8 / a7cf 兩條斜線: 平面 1 OR, 其他平面 AND NOT) → 發現物 (隨身物 +12 → DS:7f8c + 7 × n) 所在的 2 × 2 海域格
  //   (x mod 24 < 12 時往左一格, y mod 24 < 12 且列 ≠ 0 時往上一格) 以 1d710 模式 1 畫在地圖視窗 → 航海圖調色盤 → 等按鍵 →
  //   在港 88e9 / 海上 還原 [06ca] 與區域 → 淡出 → 1976e → 2103 + 1fac → 淡入 (不重畫外框與面板)
  async mapItem(it) {
    const st = this.st, { palette, sys, menu, scr, art, codec } = this.c, item0 = this.item, inPort = this.port !== 0xff;
    const R = DS.TBL_DISCOVERY + ((st.u8(DS.TBL_ITEM + ((it * 0x14) & 0xffff) + 0x12) * 7) & 0xffff);   // seg0:5cde → +12 → seg0:5cce
    const x = seaS16(st.u16(R)), y = seaS16(st.u16(R + 2));
    if (scr.wideRenderer && hasDom() && art) {
      let di = Math.trunc(x / 0x18), si = Math.trunc(y / 0x18);
      if (x % 0x18 < 0x0c) di = (di + 0x59) % 0x5a;
      if (y % 0x18 < 0x0c && si) si--;
      const tileBuf = new Uint8Array(0x60 * 0x60);
      const itemName = codec ? toSimp(decodeCleanCstr(codec, st.cstr(DS.TBL_ITEM + ((it * 0x14) & 0xffff)))) : "藏宝图";
      const sheetMeta = art.sheet("seachip");
      const sheetImg = sheetMeta ? (art.getImage(art.sheetUrl("seachip")) || await art.loadImage(art.sheetUrl("seachip")).catch(() => null)) : null;

      await new Promise(resolve => {
        const h = createDomModal({ title: itemName, size: "md", cancelable: true, closeLabel: "关闭", onCancel: () => resolve() });
        const cv = document.createElement("canvas");
        cv.width = 48 * 8; cv.height = 48 * 8;
        cv.style.cssText = "width:100%;max-width:420px;aspect-ratio:1/1;margin:0 auto;display:block;border-radius:8px;border:2px solid var(--uw2-gold);background:#0c2648;image-rendering:pixelated;";
        const ctx = cv.getContext("2d");
        if (ctx && sheetMeta && sheetImg) {
          ctx.imageSmoothingEnabled = false;
          const sxScale = (sheetImg.naturalWidth || sheetMeta.w) / sheetMeta.w;
          const syScale = (sheetImg.naturalHeight || sheetMeta.h) / sheetMeta.h;
          const drawQuad = (qx, qy, bc, br) => {
            bc = ((bc % 0x5a) + 0x5a) % 0x5a;
            if (br < 0 || br >= 0x2d) return;
            const itIdx = (3 * Math.trunc(br / 0x2d) + Math.trunc(bc / 0x1e)) & 0xff;
            let ox = 0x18, oy = 0x18, r = (br % 0x2d) - 1, c = (bc % 0x1e) - 1;
            if (c < 0) { c = 0; ox = 0; } else if (c > 0x1b) { ox = 0x30; c = 0x1b; }
            if (r < 0) { r = 0; oy = 0; } else if (r > 0x2a) { oy = 0x30; r = 0x2a; }
            this.wm.decodeChart(st, itIdx, 0x1e * r + c, tileBuf);
            for (let rr = 0; rr < 24; rr++) for (let cc = 0; cc < 24; cc++) {
              const t = tileBuf[0x60 * (oy + rr) + ox + cc];
              const col = t % sheetMeta.cols, row = Math.floor(t / sheetMeta.cols);
              ctx.drawImage(sheetImg, col * sheetMeta.tileW * sxScale, row * sheetMeta.tileH * syScale, sheetMeta.tileW * sxScale, sheetMeta.tileH * syScale, (qx + cc) * 8, (qy + rr) * 8, 8, 8);
            }
          };
          drawQuad(0, 0, di, si);
          drawQuad(24, 0, di + 1, si);
          drawQuad(0, 24, di, si + 1);
          drawQuad(24, 24, di + 1, si + 1);
          // 繪製紅色 X 寶藏標記
          let rx = x - di * 24;
          if (rx < -1080) rx += 2160; else if (rx > 1080) rx -= 2160;
          const ry = y - si * 24;
          if (rx >= 0 && rx < 48 && ry >= 0 && ry < 48) {
            const px = rx * 8 + 4, py = ry * 8 + 4;
            ctx.strokeStyle = "#dc2626"; ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(px - 8, py - 8); ctx.lineTo(px + 8, py + 8);
            ctx.moveTo(px + 8, py - 8); ctx.lineTo(px - 8, py + 8);
            ctx.stroke();
          }
        }
        h.body.appendChild(cv);
      });
      return;
    }
    if (inPort) this.item = 0xff;                                      // 84de
    await palette.fadeBlack();                                         // 99f2
    const T = this.chartTiles(), A = this.SJ.tab.chartX;               // 1d8ac(0x80)
    for (let dx = 0; dx < 2; dx++) for (let di = 0; di < 8; di++) for (let si = 0; si < 4; si++) {
      const src = T[0x41 * 32 + di * 4 + si], a = A[dx * 8 + di], b = A[dx * 8 - di + 7], o = (dx * 8 + di) * 4 + si;
      if (si === 1) { T[0x7c * 32 + o] = src | a; T[0x7e * 32 + o] = src | b; }
      else { T[0x7c * 32 + o] = src & ~a & 0xff; T[0x7e * 32 + o] = src & ~b & 0xff; }
    }
    let di = Math.trunc(x / 0x18), si = Math.trunc(y / 0x18);
    if (x % 0x18 < 0x0c) di += 0x59;
    if (y % 0x18 < 0x0c && si) si--;
    this.chartQuad(0x0c, 8, di, si, T, 1); this.chartQuad(0x24, 8, di + 1, si, T, 1);
    this.chartQuad(0x0c, 0xc8, di, si + 1, T, 1); this.chartQuad(0x24, 0xc8, di + 1, si + 1, T, 1);
    await palette.fadeTo(palette.table("chart"));                      // 99ce(DS:a700)
    sys.flush(); await menu.waitRelease(); await menu.waitPress();     // 131f9
    if (inPort) this.loadPort();                                       // 88e9
    else { if (this.item !== item0) this.item = item0; this.decodeRegion(this.region); }
    await palette.fadeBlack();
    palette.selectTimePalette(this.time, !inPort, st.u8(DS.WEATHER));      // 1976e
    this.clearCache(); this.drawMap();                                 // 2103 + 1fac
    await palette.fadeToTarget();                                      // 99e8
    sys.flush();                                                       // 3fae
  }

  // 1feae 偵察: 1fd9c 選格 → 港口 (已顯示訊息) / 沒有 → 再選; 艦隊 → 指揮者的資料視窗 7849(0x0f, 0x20, 0x21, 0xd8, 1):
  //   「名•姓」、國名 (DS:08de; 國籍 6 時 = 指揮者編號 mod 6) + 艦隊種類 (MENU #0x27: 艦隊編號 mod 10 = 0 → 0, 1..4 → 1, 5..9 → 2)、
  //   速度 (1acbf / 2, 呼叫端把風力 / 風向、海流方向 / 強度對調傳入, 原版如此)、航向 (MENU #0x28[+1a])、各船名 (兩欄, 行高 [8a1e] = 0x10)
  //   艦隊編號 61..69 (除 60) 時, 船員中最高的 +1e > random(90) → 船員 0x2fe「國名 + 種類」
  async scout() {
    const st = this.st, { win, con, printf, message, menu } = this.c, S = this.SS, rng = this.c.sys.rng;
    const types = (this.fleetTypes ??= this.c.menuItems(0x27)), heads = (this.headNames ??= this.c.menuItems(0x28));   // 2e09:57aa
    const nations = (this.nationNames ??= this.P.data.nations.map(seaHex));
    for (;;) {
      const al = await this.scoutPick();                               // 1fd9c
      if (al === 0xff) return;
      if (al === 0x80) continue;
      const P = st.personRecord(al), F = DS.TBL_FLEET + ((0x85 * st.u8(P + OFF.PERSON.FLEET)) & 0xffff);   // seg0:5c28
      let nat = st.u8(P + OFF.PERSON.FACE) & 0x0f; if (nat === 6) nat = al % 6;
      let ty = st.u8(P + OFF.PERSON.FLEET) % 10; ty = ty ? Math.trunc(ty / 5) + 1 : 0;
      const a = st.u8(DS.PORT_FLAGS), b = st.u8(DS.WIND_CUR);
      const spd = this.fleetSpeed(F, a & 7, a >> 3, b >> 3, b & 7);    // 0fea:ae1f = 1acbf
      if (this.c.scr.wideRenderer && hasDom() && this.c.codec) {
        const dec = bts => toSimp(decodeCleanCstr(this.c.codec, bts));
        const gName = dec(st.cstr(P)), fName = dec(st.cstr(P + OFF.PERSON.FAMILY_NAME));
        const fullName = fName ? `${gName}·${fName}` : gName;
        const headName = dec(heads[st.u8(F + OFF.FLEET.DIR)] ?? Uint8Array.of(0));
        const ships = [];
        for (let i = 0; i < 10; i++) {
          const Sl = F + OFF.FLEET.SHIPS + 9 * i;
          if ((st.u8(Sl + 8) & 0x30) !== 0x10) continue;
          ships.push(dec(st.cstr(this.shipRec(st.u8(Sl + 7)))));
        }
        const lines = [
          `提督：${fullName}`,
          `所属：${dec(nations[nat])} ${dec(types[ty])}`,
          `航速：${Math.trunc(seaS16(spd) / 2)} 节　航向：${headName}`,
          `舰船 (${ships.length})：${ships.join("、")}`,
        ];
        await runDomInfoLines("侦察报告", lines);
      } else {
        win.shadowedSaved(0x0f, 0x20, 0x21, 0xd8, 1);                    // 7849
        con.left = 0x11; con.right = 0x2e;
        con.setCursor(-1, 0x30);                                         // seg0:4434
        printf(S.scName, st.cstr(P), st.cstr(P + OFF.PERSON.FAMILY_NAME));
        printf(S.scNation, nations[nat], types[ty]);
        printf(S.scSpeed, Math.trunc(seaS16(spd) / 2));
        printf(S.scHead, heads[st.u8(F + OFF.FLEET.DIR)] ?? Uint8Array.of(0));
        con.setCursor(-1, 0x98);
        con.lineH = 0x10;                                                // [8a1e]
        let col = 0;
        for (let i = 0; i < 10; i++) {
          const Sl = F + OFF.FLEET.SHIPS + 9 * i;
          if ((st.u8(Sl + 8) & 0x30) !== 0x10) continue;
          con.setCursor(col ? 0x20 : 0x11, -1);                          // seg0:442c
          printf(S.scShip, st.cstr(this.shipRec(st.u8(Sl + 7))));
          if (col) printf(S.nl);
          col ^= 1;
        }
        await menu.waitPrompt(); await win.close();
        con.lineH = 0x18;
      }
      if (Math.trunc(st.u8(P + OFF.PERSON.FLEET) / 10) !== 6 || st.u8(P + OFF.PERSON.FLEET) === 0x3c) continue;
      const n = this.b.crewCount(); let mx = 0;
      for (let i = 0; i < n; i++) { const v = st.u8(st.personRecord(this.c.persons[i] & 0xff) + 0x1e); if (v > mx) mx = v; }
      if (rng.random(0x5a) < mx) { this.b.crewSpeaks(); message(0x2fe, nations[nat], types[ty]); await menu.waitPrompt(); await win.close(); }
    }
  }
  // 1fd9c 偵察的選格: 0fea:5f74 地圖視窗 24 × 24 格 (起點 = 主角) → 取消 0xff; 已發現港口 (+15 bit4) 的座標 = 視窗左上 + 格 → 「船長，那是%s港．」0x80;
  //   0fea:31a8 該格的他艦隊: 0 → 0xd7「那兒什麼也沒有」0x80; 1 → 指揮者; 多個 → 清單 0x8c (種類 12) 選 (取消 0x80)
  async scoutPick() {
    const st = this.st, F = this.fleet, { win, printf, message, menu, scr } = this.c;
    const init = seaS16(Math.imul(seaS16(st.u16(F + OFF.FLEET.Y) - this.vy1008), 0x18) + seaS16(st.u16(F) - this.vx1006));
    if (scr.wideRenderer) this.cellSel().widePrompt = "请选择侦察目标";
    const c = await this.cellSel().select(0x60, 8, 0x18, 0x10, 0x10, 0x18, init);
    if (c < 0) return 0xff;
    const cCol = c % 0x18, cRow = Math.trunc(c / 0x18);
    // 寬螢幕下允許點擊 2×2 船隻/港口任意一格命中（優先精準格，再查相鄰 ±1 格）
    const probes = scr.wideRenderer
      ? [c, c - 1, c - 0x18, c - 0x19, c + 1, c + 0x18]
      : [c];
    for (const pc of probes) {
      if (pc < 0 || pc >= 0x18 * 0x18) continue;
      if (Math.abs((pc % 0x18) - cCol) > 1 || Math.abs(Math.trunc(pc / 0x18) - cRow) > 1) continue;
      for (let di = 0; di < 0x82; di++) {
        const R = DS.TBL_PORT + di * 0x16;
        if (((st.u16(R) - (pc % 0x18)) & 0xffff) !== st.u16(DS.SEA_VIEW_X) || ((st.u16(R + 2) - Math.trunc(pc / 0x18)) & 0xffff) !== st.u16(DS.SEA_VIEW_Y)) continue;
        if (!(st.u8(R + 0x15) & 0x10)) continue;
        if (scr.wideRenderer) this.b.beginWideTalk(null);
        else win.shadowedSaved(0x14, 0x80, 0x1e, 0x60, 0);
        printf(this.SS.scPort, st.cstr(R + 4));
        await menu.waitPrompt(); await win.close();
        return 0x80;
      }
      const n = this.fleetsAt(pc);
      if (n === 1) return this.c.persons[0] & 0xff;
      if (n > 1) {
        const si = await this.b.listSel().select(0x8c, n);
        if (si === -1) return 0x80;
        return this.c.persons[si] & 0xff;
      }
    }
    if (scr.wideRenderer) this.b.beginWideTalk(null);
    else win.shadowedSaved(0x14, 0x80, 0x1e, 0x60, 0);
    message(0xd7); await menu.waitPrompt(); await win.close(); return 0x80;
  }
  // 0fea:31a8 = 13048 格 c (視窗內) 上的他艦隊 (出航中、非 +29 bit4、指揮者不是主角) 的指揮者 → [0538]
  fleetsAt(c) {
    const st = this.st, P = this.c.persons; let n = 0;
    for (let k = 0; k < 0x46; k++) {
      const F = DS.TBL_FLEET + k * 0x85;
      if (!(st.u8(F + OFF.FLEET.FLAGS) & 1) || (st.u8(F + OFF.FLEET.FLAGS) & 0x10) || st.u8(F + OFF.FLEET.ADMIRAL) === st.u8(DS.HERO)) continue;
      if (((st.u16(F) - (c % 0x18)) & 0xffff) === st.u16(DS.SEA_VIEW_X) && ((st.u16(F + OFF.FLEET.Y) - Math.trunc(c / 0x18)) & 0xffff) === st.u16(DS.SEA_VIEW_Y)) P[n++] = st.u8(F + OFF.FLEET.ADMIRAL);
    }
    return n;
  }
  // 0fea:ae1f = 1acbf 艦隊 F 的速度 (艦隊 AI 共用): AX = wDir, DX = wStr, [bp+6] = cB, [bp+8] = cA
  //   各船: 風向差 k = |wDir − 航向| 的帆種係數 × 推進力 × wStr / 150 → + 指揮者 +24 × v / 10 (上限 30) → × 指揮者 +1d / 75 (上限 40),
  //   k = 3..5 再 × 轉向力 / 100; 取最小 (至少 2); 再依 |cA − 航向|: 0..1 或 ≥ 7 → + min(40 − v, cB), 3..5 → − min(v − 1, cB);
  //   wStr = 0 且沒有縱帆船 → 0 (與 314eb 不同: 沒有水手與載重項, 也沒有縱帆船至少 3 的風力)
  // DS 位元組: 存檔區 (0ca4..8a18) 讀遊戲狀態, 其他讀 MAIN.EXE 的 DS 初值 (assets/data/fleet.json dsLow; 原版在表外讀取時用到, 例: 航向 FF)
  dsb(a) {
    a &= 0xffff;
    if (a >= DS.OPTIONS && a < DS.TRADE_LOGS) return this.st.u8(a);
    const D = (this.dsLow ??= Uint8Array.from((this.P.fleet?.dsLow ?? "").match(/../g) ?? [], h => parseInt(h, 16)));
    return D[a] ?? 0;
  }
  fleetSpeed(F, wDir, wStr, cB, cA) {
    const st = this.st, P = st.personRecord(st.u8(F + OFF.FLEET.ADMIRAL));
    const lv = st.u8(P + OFF.PERSON.NAV_LEVEL), sk = st.u8(P + 0x1d), hd = st.u8(F + OFF.FLEET.DIR);
    let best = 0xff, fore = 0;
    const k = Math.abs(seaS16(wDir - hd)) & 0xff, k2 = Math.abs(seaS16(cA - hd)) & 0xff, beat = k >= 3 && k <= 5;
    for (let i = 0; i < 10; i++) {
      const S = F + OFF.FLEET.SHIPS + 9 * i;
      if ((st.u8(S + 8) & 0x30) !== 0x10) continue;
      const ship = this.shipRec(st.u8(S + 7));
      if (!(st.u8(ship + 0x10) & 0x10)) fore = (fore - 1) & 0xff;
      const t = this.typeOf(st.u8(ship + 0x0f));
      let v = Math.trunc(seaS16(Math.imul(this.dsb(0x06d8 + ((k * 8) & 0xffff) + st.u8(t + 9)) * st.u8(S + 5), wStr)) / 0x96) & 0xff;   // DS:06d8 表 (航向 FF 時讀到表外)
      v = seaUmin(0x1e, (Math.trunc(seaS16(Math.imul(v, lv)) / 10) + v) & 0xffff) & 0xff;
      v = seaUmin(0x28, Math.trunc(seaS16(Math.imul(v, sk)) / 0x4b) & 0xffff) & 0xff;
      if (beat) v = Math.trunc((st.u8(S + 4) * v) / 100) & 0xff;
      if (v < best) best = v;
    }
    if (best < 2) best = 2;
    if (k2 === 0 || k2 === 1 || k2 >= 7) best = (best + seaUmin(0x28 - best, cB)) & 0xff;
    else if (k2 >= 3 && k2 <= 5) best = (best - seaUmin(best - 1, cB)) & 0xff;
    return !wStr && !fore ? 0 : best;
  }
}
