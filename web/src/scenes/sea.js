// scenes/sea.js — 海上场景 (MAIN.EXE: 出海 seg0:851f、海上画面 6b30 / 6cfc / 8067、时间主循环的海上部分 1fd9:13c1 / 1afe8 / 2e09:38ec / 2e09:2f3d、
//   每日 195b6、天候 19a99 / 19f48)
// 与港口共用同一个场景对象 (SeaScene 继承 PortScene): 原版的地图窗口 (1fac)、图块缓存 cs:1b2c、地图缓冲 [03f6]、罗盘指针 [8c1d] 都是同一份
// 原版变量 (DS, 不在存盘内): [06c8] 区域编号 region   [06ca] WORLDMAP 项 item   [bda6]/[bdaa] 区域左上 (地图格)   [bdba] 窗口偏移 bdba
//   [bdac] 本时刻船速 speed   [bdca] 瞭望范围 sight   [a9c8] 输入标志 (bit0 暂停, bit1 鼠标按着)   [bda8] 随身物标志 (0x80 望远镜 0x18, 0x40 0x19)
// 存盘内: 主角舰队 [c2d4] = 2e76 + 0x85 × (主角 +2c): +0 x  +2 y (地图格, 0..2159 / 0..1079)  +4/+6 目的地  +8/+a 中途点  +18/+19 格内位置 (0..0x3b)
//   +1a 方位 (0..7, 8 = 停船)  [1006]/[1008] 地图窗口左上 (地图格)  [1005] 航行标志 (0x80/0x40 委任, 0x20 停船, 0x18 ?)  [2e18] 出港天数  [2e19]/[2e1a] 水/粮食配给 %
// 阶段 5 后半 (docs/RE_NOTES.md 第 28 节): 委任 / 指定目的地 / 自动航行 (1fd9 段的地点路线, 舰队 AI 共用)、侦察、航海图、随身物 地图
// 他舰队 (6aae / 1afe8 = 舰队 AI) → game/fleetai.js (第 29 节)
// 上陆探索 (34d54 / 34ccc) → scenes/land.js、海上特殊地点 (30e9f / 31047) → 本档 seaEvent / monsterRead (第 36 节)
import { PortScene } from "./port.js";
import { Buildings } from "./buildings.js";
import { Commands } from "./commands.js";
import { seaNegotiate } from "./negotiate.js";
import { NavalBattle } from "./battle.js";
import { WorldMap } from "../decoders/worldmap.js";
import { CellSelect } from "../ui/dos/cellsel.js";
import { FleetAI } from "../game/fleetai.js";
import { Land } from "./land.js";
import {
  appendTradeLog,
  discoverWorldCellIfUnseen,
  fleetByAddr,
  fleetShipSlot,
  getFleetRouteExtra,
  getFoodRationPct,
  getPartySalaryUnit,
  getPortEcoExtra,
  getSeaEncounter,
  getSeaEncounterIndex,
  getWaterRationPct,
  heroFleet,
  heroOrDockSlot,
  heroShipSlot,
  isExploreLocationNodeMarked,
  isWorldCellExplored,
  markExploreLocationNode,
  promoteUsedShipCache,
  readDsLowOrStateByte,
  setPartySalaryUnit,
  setSeaEncounterIndex,
  shiftUsedShipCache,
} from "../model/world_helpers.ts";
import { renderWideSea, hitWideCommandButton } from "../renderer/world.ts";
import { hasDom, runDomInfoLines, runDomStoryCard } from "../ui/modals.ts";
import { runDomTreasureChartModal } from "../ui/sea_modals.ts";
import { captureConsoleText, decodeCleanCstr, toSimp } from "../ui/text_util.ts";

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
    this.seaMonths = S.months.map(seaHex);                              // DS:8af0 月份字符串
    this.wm = new WorldMap(P.worldmap, S);
    this.seaBuf = new Uint8Array(0x2400);                                // [03f4]:[03f6]
    this.region = 0xffff; this.item = 0xff; this.bda6 = 0; this.bdaa = 0;   // DS 初值: [06c8] = FFFF、[06ca] = FF、[bda6] = [bdaa] = 0
    this.speed = 0; this.sight = 0; this.a9c8 = 0; this.bda8 = 0; this.btnX = 0; this.btnY = 0;
  }
  get fleet() { return heroFleet(this.m).addr; }                       // [c2d4] (162e3, 地址兼容外部调用)
  asFleet(f) { return typeof f === "number" ? fleetByAddr(this.m, f) : f; }
  get b() { return (this.buildings ??= new Buildings(this)); }
  get ai() { return (this.fleetAI ??= new FleetAI(this)); }             // 舰队 AI (game/fleetai.js)
  get mapBuf() { return this.map || this.seaBuf; }                      // [03f6]: 在港时是港口地图 (舰队 AI 的陆地判断照样读它, 原版如此)
  present(i) { return (heroOrDockSlot(this.m, i).flags & 0x30) === 0x10; }
  loadSum(i) { const S = heroOrDockSlot(this.m, i); return (this.b.cargoUsed(i) + S.guns + S.crew) & 0xffff; }   // seg0:5d8b
  wx(fAddr) { return seaS16(fleetByAddr(this.m, fAddr).x); }
  wy(fAddr) { return seaS16(fleetByAddr(this.m, fAddr).y); }
  get vx1006() { return seaS16(this.m.globals.seaViewX); } set vx1006(v) { this.m.globals.seaViewX = v; }
  get vy1008() { return seaS16(this.m.globals.seaViewY); } set vy1008(v) { this.m.globals.seaViewY = v; }

  // ================= 出港 (码头 27a07 之后) =================
  // 0fea:9348 = 191e8 粮食 / 0fea:9401 = 192a1 水: 每艘船从自己 (没有时从第一艘还有的船) 扣一天的量
  //   量 = (配给% × 水手) 的低 16 比特 / ([1005]&0x18 ? 200 : 100) + 1; 士气扣在「供应的那艘船」上 (原版如此), 降到 20 以下时「本船」的水手逃走 (19016)
  //   全舰队都没有时本船士气 −min(16, 士气) (191ba)
  dailySupply(isFood) {
    const m = this.m;
    const amtOf = cs => (isFood ? cs.food : cs.water);
    for (let i = 0; i < 10; i++) {
      if (!this.present(i)) continue;
      let found = 0xff;
      if (amtOf(m.crewSlot(i))) found = i;
      else for (let j = 0; j < 10; j++) if (this.present(j) && amtOf(m.crewSlot(j))) { found = j; break; }
      if (found !== 0xff) this.consume(found, i, isFood); else this.starve(i);
    }
  }
  foodDaily() { this.dailySupply(true); }                                // 191e8
  waterDaily() { this.dailySupply(false); }                              // 192a1
  // 19056 / 19109
  consume(found, i, isFood) {
    const m = this.m, M = m.crewSlot(found), P = m.person(M.captain);
    const rate = isFood ? getFoodRationPct(m) : getWaterRationPct(m);
    const curAmt = isFood ? M.food : M.water;
    const div = (m.globals.seaFlags2 & 0x18) ? 200 : 100;
    const amt = seaUmin(Math.floor(((rate * heroShipSlot(m, i).crew) & 0xffff) / div) + 1, curAmt);
    if (isFood) M.food = curAmt - amt; else M.water = curAmt - amt;
    const v = seaS16(100 - Math.floor(P.getStats(0) / 5) - rate);
    const d = Math.trunc(v / (v > 0 ? 5 : 10));
    let mo = M.morale - d;
    mo = mo < 0 ? 0 : mo > 100 ? 100 : mo;
    M.morale = mo;
    if (mo < 0x14) this.desert(i);
  }
  // 191ba
  starve(i) { const M = this.m.crewSlot(i); M.morale = M.morale - seaUmin(16, M.morale); if (M.morale < 0x14) this.desert(i); }
  // 19016 士气 < 20: 水手 −min(⌊(20 − 士气) × 水手 / 100⌋ + 1, 水手)
  desert(i) {
    const m = this.m, M = m.crewSlot(i), S = heroShipSlot(m, i), n = seaS16(S.crew);
    const loss = (Math.trunc(Math.imul(20 - M.morale, n) / 100) + 1) & 0xffff;
    S.crew = S.crew - seaUmin(loss, S.crew);
  }

  // ================= 进入海上 seg0:851f =================
  async enterSea() {
    const { palette, sys, con } = this.c, m = this.m, g = m.globals;
    if (palette.ending) { await palette.fadeBlack(); return; }
    // 地点表 [0c96] (DATA1 #4, [bd7e] = DATA1 #5 笔): DS:1046 比特表中已探索的地点 +1 |= 0x80 (运行期缓冲, 不在存盘内)
    const N = this.nodes;
    for (let i = 0; i < this.SJ.nodeCount; i++) if (isExploreLocationNodeMarked(m, i) && N.length > i * 16 + 1) N[i * 16 + 1] |= 0x80;
    this.bda8 = 0;
    for (let i = 0; i < 0x14; i++) { const v = m.inventory(i); if (v === 0x18) this.bda8 |= 0x80; else if (v === 0x19) this.bda8 |= 0x40; }
    g.port = 0xff;
    this.item = Math.trunc(this.vx1006 / 0x2d0) & 0xff;               // [06ca]
    // 849a: WORLDMAP 第 [06ca] 项 → [06ce]; 84de: DATA1 #11 → [03ee] (海上图块与船只精灵); DATA1 #7 → [0c86]+0x3ea0 (罗盘指针)
    await palette.fadeBlack();                                         // 99f2 (先淡黑再切换海图缓冲，避免切换瞬间闪出错位图块)
    if (this.map && this.map !== this.seaBuf) this.seaBuf.set(this.map.subarray(0, 0x2400));   // [03f6] 原本是出港港口的 PORTMAP
    this.map = this.seaBuf; this.chipSetName = "seachip"; this.tileCache.clear();
    this.c.bgm.playSong(g.hero + 4);                                   // 9670 主角的海上曲目
    sys.mouseHide();
    // 9630: [03d5] 恒为 1, 不动作
    con.right = 0x50;                                                  // [8a22]
    this.c.scr.clear(0);
    this.seaDate();                                                    // 71ad / 71c6 / 71f0
    this.clearCache();                                                 // 2103
    this.region = 0xffff;
    this.seaView();                                                    // 6b30
    palette.selectTimePalette(this.time, true, g.weather);             // 0fea:98ce = 1976e
    this.c.scr.setAtmosphere?.({ active: true, atSea: true, weather: g.weather & 15 });
    this.c.scr.wideRenderer = (ctx, scr) => renderWideSea(ctx, scr, this);
    this.a9c8 = 0;
    this.seaPanel();                                                   // 8067
    this.needle = 0xff;
    if ((g.weather & 15) === 1) this.stormSound();                     // 9768(DS:0c5a) + 9804(0x30)
    sys.mouseShow();
    await palette.fadeToTarget();
  }
  // 9768(DS:0c5a) + 9804(0x30) FM 效果音 (暴风雨, 持续到 9888; core/sfx.js)
  stormSound() { this.c.sfx?.voice(0x0c5a); this.c.sfx?.note(0x30); }

  // ================= 画面 =================
  // 7180: (col, 0x10) 印 %2d (v+1); 只在海上
  seaNum(col, v) { if (this.c.scr.wideRenderer) return; const { con, printf } = this.c; con.right = 0x4f; con.setCursor(col, 0x10); printf(this.SS.day2, v + 1); }
  // 71ad 年 / 71c6 月 / 71f0 日 (只在海上; 主循环 1623a 在每年 / 每月 / 每天开始时也各调用一次)
  seaYear() { if (this.port === 0xff && !this.c.scr.wideRenderer) this.seaNum(0x43, this.c.rt.year + 0x5dc); }
  seaMonth() { if (this.port === 0xff && !this.c.scr.wideRenderer) { const { con, printf, rt } = this.c; con.setCursor(0x48, 0x10); printf(this.SS.month, this.seaMonths[rt.month]); } }
  seaDay() { if (this.port === 0xff && !this.c.scr.wideRenderer) this.seaNum(0x4c, this.c.rt.day); }
  seaDate() { if (this.c.scr.wideRenderer) return; this.seaYear(); this.seaMonth(); this.seaDay(); }
  // 6b30 / 6cfc / 3197c 共用: 主角所在的 3×3 海域格区域 → bda6 / bdaa (地图格) 与区域编号
  regionOf() {
    const F = this.fleet;
    let cx = (Math.trunc(this.wx(F) / 24) % 30) - 1, cy = (Math.trunc(this.wy(F) / 24) % 45) - 1;
    cx = cx < 0 ? 0 : cx > 0x1b ? 0x1b : cx; cy = cy < 0 ? 0 : cy > 0x2a ? 0x2a : cy;
    this.bda6 = 24 * cx; this.bdaa = 24 * cy;
    return 30 * cy + cx;
  }
  // 1fd9:2fd2 = 22d62 解码区域
  decodeRegion(si) { this.wm.decode(this.m.st, this.item, si & 0xffff, this.seaBuf); }
  // 6bce..6caa / 6d9b..6e5a: 主角周围 3×3 海域格记入探索表 DS:0de8 (45 列 × 12 bytes), 新探索的格 [100e]++ [1010]++
  explore() {
    const m = this.m, F = this.fleet;
    const cx0 = (Math.trunc(this.wx(F) / 24) + 0x59) % 0x5a;
    let ry = Math.trunc(this.wy(F) / 24) - 1;
    for (let k = 0; k < 3; k++, ry++) {
      if (ry < 0 || ry >= 0x2d) continue;
      for (let j = 0, cx = cx0; j < 3; j++, cx = (cx + 1) % 0x5a) discoverWorldCellIfUnseen(m, cx, ry);
    }
  }
  // 6aae 区域改变时处理区域内的他舰队 (game/fleetai.js regionChange)
  fleetsRegion() { if (!this.c.noFleets) this.ai.regionChange(); }
  viewOffset() {
    this.bdba = ((this.vy1008 - this.bdaa) * 0x60 + (this.vx1006 % 0x2d0) - this.bda6) & 0xffff;
  }
  // 6b30 重新取得区域并画地图 (不画船)
  seaView() {
    const si = this.regionOf();
    if (this.region !== si) { this.region = si; this.decodeRegion(si); this.fleetsRegion(); this.explore(); }
    this.viewOffset();
    this.clearCache();
    this.drawMap();                                                    // 1fac
    this.seaPanel();                                                   // 8067
  }
  // 24bc 32×32 海上船只精灵 (sea_ships.png 透明图集)
  sprite(col, y, off) {
    if (col < 0 || col + 4 > 80 || y < 0 || y + 32 > 400) { seaTodo("精靈超出畫面"); return; }
    const idx = (off - 0x4000) >> 9;
    this.c.art?.drawSheetTile(this.c.scr, "sea_ships", idx, col * 8, y, { transparent: true });
  }
  // 舰队 k 的精灵 (6f07..6f88 主角单独 / 7080..7137 全部舰队)
  drawFleet(f, k, heroOnly) {
    const m = this.m, F = this.asFleet(f), dx = seaS16(F.x) - this.vx1006, dy = seaS16(F.y) - this.vy1008, T = this.SJ.tab.shipDir;
    let si;
    if (F.addr === this.fleet) {
      let i = 0; while (i < 10 && m.crewSlot(i).captain !== m.globals.hero) i++;   // 旗舰 = 船长是主角的船位
      si = (m.ship(heroOrDockSlot(m, i).ship).flags & 0x10) << 8;
    } else si = (((m.ship(fleetShipSlot(F, 0).ship).flags & 0x10) << 8) + 0x2000) & 0xffff;
    const d = T[F.dir & 7] + 0x10;
    si = heroOnly ? (si + (((d * 2 + (this.time & 1)) << 9) & 0xffff)) & 0xffff : (si + ((d << 10) & 0xffff) + (((k + this.time) & 1) << 9)) & 0xffff;
    this.sprite((dx + 6) * 2, dy * 16 + 8, si);
    this.invalidate(24 * dy + dx);                                     // 2119
  }
  // 6cfc 每个时刻的海上画面: 区域、探索、延迟 ([0ca6] 海上速度)、地图、舰队、日期、风向/海流/航向、船速、光标
  async seaTick() {
    const { sys, menu, con, printf } = this.c, m = this.m, g = m.globals;
    const si = this.regionOf();
    if (this.region !== si) { this.region = si; this.decodeRegion(si); this.fleetsRegion(); this.explore(); }
    // 507c: 空函数
    this.toggle ^= 1;
    this.viewOffset();
    if (g.seaSpeed) {
      sys.timer.set(g.seaSpeed);
      while (sys.timer.get()) { if (menu.source()) break; await sys.poll(); }
    }
    sys.mouseHide();
    this.drawMap();
    const w = g.weather & 15;
    if (w === 0 || w === 2) {
      for (let row = 0; row < 0x17; row++) for (let k = 0; k < 0x46; k++) {
        const F = m.fleet(k), dx = seaS16(F.x) - this.vx1006, dy = seaS16(F.y) - this.vy1008;
        if (dx < 0 || dx >= 0x17 || row !== dy) continue;
        if (F.flags & 0x10 || !(F.flags & 1)) continue;
        if (this.landAt(seaS16(F.x), seaS16(F.y))) continue;
        this.drawFleet(F, k, false);
      }
    } else this.drawFleet(heroFleet(m), 0, true);
    this.seaDate();
    this.dials();                                                      // 8fbf
    if (!this.c.scr.wideRenderer) { con.setCursor(0x45, 0xd0); printf(this.SS.speed, (this.speed + 1) >> 1); }
    this.seaCursor();
    sys.mouseShow();
    // 507d: 空函数
  }
  // 6fbe..716b 光标: 地图窗口内依鼠标所在的 3×3 区块显示方向光标 (DS gfx 0x2960 + (列内栏 − 3×列) × 0x90), 否则 0x2b10
  seaCursor() {
    const { sys } = this.c, p = sys.mousePos(), x = p.x - 0x60, y = p.y - 8;
    let si = 0x2b10;
    if (x >= 0 && x < 0x180 && y >= 0 && y < 0x180) si = (0x2960 + ((x >> 7) - 3 * (y >> 7)) * 0x90) & 0xffff;
    if (this.cursor !== si) { this.cursor = si; sys.setCursorShape(si); }
  }
  // 8fbf 风向 (y 0x40)、海流 (0x70)、航向 (0xa0, 不印数字) 的转盘
  dials() {
    if (this.port !== 0xff) return;
    const m = this.m, a = m.globals.portFlags, b = m.globals.windCur;
    this.dial(0x40, (a & 0x38) >> 3, a & 7);
    this.dial(0x70, (b & 0x38) >> 3, b & 7);
    this.dial(0xa0, heroFleet(m).dir, 0xffff);
  }
  // 8f4f(y, 方向, 强度): 强度 ≠ 0 且方向 < 8 → gfx + 0x490 + 方向 × 0x320, 否则 0x1d90 (5 栏 × 0x28 行); 强度 >= 0 (有号) 时于 (0x43, y+0x18) 印出
  dial(y, dir, str) {
    if (this.c.scr.wideRenderer) return;
    const { scr, con, printf, art } = this.c;
    const idx = str !== 0 && dir < 8 ? dir : 8;
    art?.drawSheetTile(scr, "dials", idx, 0x47 * 8, y);
    if (seaS16(str) >= 0) { con.setCursor(0x43, y + 0x18); printf(this.SS.dialNum, str); }
  }
  // 3135c (x, y) 的 2×2 地图格中有 >= 0x34 的图块 (陆地)
  landAt(x, y) {
    const o = ((seaS16(y) - this.bdaa) * 0x60 + (seaS16(x) % 0x2d0) - this.bda6) & 0xffff, B = this.mapBuf, g = i => B[i & 0xffff] ?? 0;
    return g(o) >= 0x34 || g(o + 1) >= 0x34 || g(o + 0x60) >= 0x34 || g(o + 0x61) >= 0x34 ? 1 : 0;
  }

  // 8067 左侧面板: 状态条 (转向力/推进力/耐久度/吃水量/瞭望范围/水手/船舰状态)、货物 (水/粮食/资材/砲弹)、出港天数; 同时算出瞭望范围 [bdca]
  //   (各船的 +0a 总载重在这里重算写回); 只在海上画, 画两次
  seaPanel() {
    const m = this.m, g = m.globals, { con, printf, sys } = this.c;
    if (this.port !== 0xff) return;
    con.right = 0x4f;
    con.puts(this.SS.dateColor);
    const F = heroFleet(m), T = this.SJ.tab.windSpeed;
    let minSpd = 10000, slowSlot = heroShipSlot(m, 0), slowIdx = 0, minDur = 100, maxLook = 0, crewSum = 0, maxCrewSum = 0, morale = 0;
    const sums = [0, 0, 0, 0];
    const row = ((Math.abs(((g.portFlags & 0x38) >> 3) - F.dir) & 0xff) * 8);
    for (let i = 0; i < 10; i++) {
      const S = heroShipSlot(m, i);
      if ((S.flags & 0x30) !== 0x10) continue;
      const ship = m.ship(S.ship), t = ship.type, Ty = m.shipType(t), t5 = Ty.minCrew;
      const crew = seaS16(S.crew);
      crewSum = (crewSum + S.crew) & 0xffff; maxCrewSum = (maxCrewSum + ship.maxCrew) & 0xffff;
      const M = m.crewSlot(i), drv = M.lookRatio;
      const load = this.loadSum(i); M.loadTotal = load;
      const cap = seaS16(Ty.capacity);
      const P = m.person(M.captain), nav = P.navLevel, sk = P.getStats(1);
      morale += crew * M.morale;
      const w2 = seaS16(T[row + t] * S.propulsion);
      const q = seaUmin(100, Math.trunc((drv * crew) / t5) & 0xffff);
      const c = seaUmin(0x96, (0xb4 - seaUmin(0xb4, Math.trunc(seaS16(Math.imul(100, seaS16(load))) / cap))) & 0xffff);
      let u = Math.trunc(seaS16(Math.imul(q, w2)) / 100) & 0xffff;
      u = Math.floor(((u * c) & 0xffff) / 100);
      const v1 = seaUmin(30, (Math.trunc(seaS16(Math.imul(u, nav)) / 10) + u) & 0xffff);
      const spd = seaUmin(40, Math.trunc(seaS16(Math.imul(v1, sk)) / 75) & 0xffff);
      if (spd < minSpd) { minSpd = spd; slowSlot = S; slowIdx = i; }
      if (S.durability < minDur) minDur = S.durability;
      const lk = (M.navRatio * S.crew) & 0xffff; if (lk > maxLook) maxLook = lk;
      sums[0] = (sums[0] + M.water) & 0xffff;
      sums[1] = (sums[1] + M.food) & 0xffff;
      sums[2] = (sums[2] + M.material) & 0xffff;
      sums[3] = (sums[3] + M.ammo) & 0xffff;
    }
    const sT = m.ship(slowSlot.ship).type;
    const sLoad = seaS16(m.crewSlot(slowIdx).loadTotal), sCap = seaS16(m.shipType(sT).capacity);
    const loadPct = Math.trunc((sLoad * 100) / sCap);                  // 3722 有号长整数除法
    const avgMorale = crewSum ? Math.trunc(morale / crewSum) : 0;
    this.sight = (Math.imul(this.bda8 & 0x80 ? 2 : 1, seaUmin(12, Math.floor(maxLook / 100))) & 0xffff);   // [bdca]
    this._seaStats = {
      turn: slowSlot.turn,
      prop: slowSlot.propulsion,
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
      daysAtSea: g.daysAtSea,
    };
    this.c.hud?.updateSea(this._seaStats);
    if (this.c.scr.wideRenderer) return;
    sys.mouseHide();
    const B = (y, v) => this.commandsObj().bar(2, y, seaS16(v));            // seg0:92f7
    for (let n = 0; n < 2; n++) {
      B(0x48, slowSlot.turn); B(0x60, slowSlot.propulsion); B(0x78, minDur); B(0x90, loadPct);
      B(0xa8, Math.trunc((100 * this.sight) / 24));
      if (!maxCrewSum) maxCrewSum = 1;
      if (!crewSum) crewSum = 1;
      B(0xc0, Math.trunc((seaS16(crewSum) * 100) / seaS16(maxCrewSum)));
      B(0xd8, Math.trunc(morale / seaS16(crewSum)));
      for (let k = 0; k < 2; k++) { con.setCursor(6, k * 32 + 0x108); printf(this.SS.n5, Math.floor(sums[k] / 10)); }
      for (let k = 2; k < 4; k++) { con.setCursor(6, k * 32 + 0x108); printf(this.SS.n5b, seaS16(sums[k])); }
      con.setCursor(0x45, 0xf0); printf(this.SS.n3, g.daysAtSea);
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
  // ================= 海上时刻 1fd9:13c1 = 21151 (输入) =================
  async seaInput() {
    const { sys, menu, scr } = this.c;
    if (this.pendingCmd !== undefined) {
      const cmd = this.pendingCmd; this.pendingCmd = undefined;
      await this.runSeaCmd(cmd);
      return;
    }
    const steerFromViewPos = (vx, vy) => {
      // 以主角船只实际画面座标为中心计算 8 方向（靠近地图边缘时也能精准转向）
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
        return 0x35;                    // 点击主角船只自身 = 按 '5' 指定目的地
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
      if (k === 0x1c) return 0x36;      // → -> 东 (6)
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
  // 21008 海上画面按钮 (DS:a9d8, 13 个 × 9 bytes: x, y, w, h, 键): 0..7 舵轮方向, 8 中央 (指定目的地), 9..12 情报/经营/命令/航海术
  async seaButton(key) {
    const { sys, con } = this.c, g = this.m.globals, B = this.SJ.tab.buttons;
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
    if (di < 13 && !((g.seaFlags2 & 0x18) && di < 9)) {
      if (di < 8) this.steer(di);                                       // 20fec
      else if (di === 8) await this.chooseDest();                        // 2e09:310b
      else {
        sys.mouseHide();
        const cm = this.commandsObj();
        cm.press(di - 9);                                               // seg0:9396
        await [() => cm.info(), () => cm.manage(), () => cm.order(), () => cm.nav()][di - 9]();   // DS:aa4e 远程函数表
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
  // 20fec 转舵: [1005] &= 0x5f, 方位 = d, 95f2(d)
  steer(d) { const m = this.m; m.globals.seaFlags2 &= 0x5f; heroFleet(m).dir = d; this.helm(d); }
  // 95f2 舵轮指针 [8c1d]
  helm(d) {
    if (this.needle === d) return;
    const { sys } = this.c, g = this.m.globals;
    sys.mouseHide();
    this.helmDraw(0);
    if (g.options & 1) { this.needle = d; this.helmDraw(9); } else this.needle = 0xff;
    sys.mouseShow();
  }
  // 9537(base): seacompass.png 第 (指针 + base) 张
  helmDraw(base) {
    const n = this.needle; if (n === 0xff) return;
    const col = n > 4 ? 0x3e : n === 0 || n === 4 ? 0x43 : 0x48, y = n < 2 || n === 7 ? 0x110 : n === 2 || n === 6 ? 0x138 : 0x160;
    this.c.art?.drawSheetTile(this.c.scr, "seacompass", n + base, col * 8, y);
  }
  cellSel() { return (this.c.cellSel ??= new CellSelect(this.c)); }
  // 2e09:310b = 3119b 指定目的地 (舵轮中央 '5' / 委任到达后未进港): [1005] |= 20 (停船), 光标 = 十字 0x2840 ([06d6]);
  //   还没委任时以 seg0:7925 标签框 (0x1b, 0xc8, 0x12, 0x20) 印「请指定目的地」([8a24] = FFFF 期间印出; 没有其他地方读它);
  //   0fea:5f74 地图窗口 24 × 24 格 (2 × 2 光标, 起点 = 主角) 选格 → 取消返回 0; 选定 → +4/+6 = 该格,
  //   该格是港口 (1bb4a) → 23e19 换成附近可到达的海面; +0c = 0x6000, [1005] = (&DF) | 0x80, 返回 1
  async chooseDest() {
    const m = this.m, g = m.globals, { sys, win, con, printf } = this.c, F = heroFleet(m);
    g.seaFlags2 |= 0x20;
    sys.mouseHide();
    this.cursor = 0x2840; sys.setCursorShape(0x2840);                 // [06d6] = 0x2840, seg0:5050
    const deleg = g.seaFlags2 & 0x80;
    const isWide = !!this.c.scr.wideRenderer;
    if (!deleg) {
      if (isWide) this.cellSel().widePrompt = "请指定目的地";
      else { win.labelBox(0x1b, 0xc8, 0x12, 0x20); printf(this.SS.destPrompt); con.right = 0x50; }
    }
    await this.c.menu.waitRelease();                                   // 0fea:3343 = 131e3
    let x, y;
    if (isWide && this.c.scr._wideSeaCam) {
      const pt = await this.cellSel().selectWideSeaWorld(seaS16(F.x), seaS16(F.y));
      if (sys.mouse) sys.mouse.lastClick = null;
      sys.mouseShow();
      if (!pt) return 0;
      x = pt.wx; y = pt.wy;
    } else {
      const init = (Math.imul(0x18, seaS16(F.y - this.vy1008)) - this.vx1006 + F.x) & 0xffff;
      const si = await this.cellSel().select(0x60, 8, 0x18, 0x10, 0x10, 0x18, seaS16(init));
      if (sys.mouse) sys.mouse.lastClick = null;
      if (!deleg && !isWide) await win.close();
      sys.mouseShow();
      if (si === -1) return 0;
      x = (si % 0x18) + this.vx1006; y = Math.trunc(si / 0x18) + this.vy1008;
    }
    F.destX = x; F.destY = y;
    if (this.portIdAt(x, y) !== 0xffff) { const W = this.ptLocal(x, y); this.nearSea(F, W); F.destX = W.x; F.destY = W.y; }
    F.routeFlags = 0x6000;
    g.seaFlags2 = (g.seaFlags2 & 0xdf) | 0x80;
    return 1;
  }

  // ================= 1afe8 他舰队的海上移动 (舰队 AI, game/fleetai.js seaTick) =================
  // 每支舰队先查一次鼠标右键 (按下 → [a9c8] |= 1 暂停); 主角与未出航 (+29 bit0 = 0) 的略过
  async fleetsMove() { await this.ai.seaTick(); }

  // ================= 2e09:38ec = 3197c 主角舰队移动 =================
  // 316b3 本时刻航向: 委任 ([1005]&0xc0) → 自动航行; 停船 (0x20) → 8; 否则 +1a
  //   委任中到达目的地 (+0/+2 = +4/+6, 1fd9:33d4) → 0fea:c0d9 靠港 (隐藏光标), [1005] &= 7F; 进了港 → 返回 0;
  //   没进港 → 3119b 再指定目的地 (此时 [1005] bit7 已清, 会显示「请指定目的地」); 之后 313b1 求方向 (−1 或 > 7 → [1005] &= 7F, 停船)
  async heading() {
    const m = this.m, g = m.globals, F = heroFleet(m), f = g.seaFlags2, { sys } = this.c;
    if (!(f & 0xc0)) return f & 0x20 ? 8 : F.dir;
    if (F.x === F.destX && F.y === F.destY) {
      sys.mouseHide(); await this.dock(); sys.mouseShow();
      g.seaFlags2 &= 0x7f;
      if (g.port !== 0xff) return 0;
      await this.chooseDest();
    }
    const si = this.autoSteer(F);
    if (si === 0xffff || si > 7) { g.seaFlags2 &= 0x7f; return 8; }
    F.dir = si;
    return F.dir;
  }

  // ================= 委任航行的路线 (1fd9 段 231c7..241c2, 舰队 AI 共用) =================
  // 舰队记录: +4/+6 目的地  +8/+a 中途点  +0c: 低 3 比特 = 目前的路线格 (0..3), bit4..7 (DS:ae30 = 80/40/20/10) = 路线格 0..3 已填;
  //   +0d 标志: 80 中途点有效, 40 需重新搜索路线, 20 直接驶向目的地, 08 路线已到目的地的地点, 02 重设误差 +0e
  //   +0e 直线步进的误差累计  +10..+17 路线格 0..3 的地点编号  +1b 种类 (委任时 0)
  // 地点表 [0c96] (DATA1 #4, 每笔 16 bytes: +0 x (bit15 = 已探索, enterSea 设置), +2 y, +4..+0b 4 个邻点 (FFFF = 无), +0c..+0f 4 个距离)
  midPt(f) { const F = this.asFleet(f); return { get x() { return F.midX; }, set x(v) { F.midX = v; }, get y() { return F.midY; }, set y(v) { F.midY = v; } }; }
  ptLocal(x, y) { const o = { _x: x & 0xffff, _y: y & 0xffff, get x() { return this._x; }, set x(v) { this._x = v & 0xffff; }, get y() { return this._y; }, set y(v) { this._y = v & 0xffff; } }; return o; }
  // 地点表 [0c96]: 开始新游戏 / 读档 (1667a) 时由 DATA1 #4 加载, 港内的舰队 AI 也会用到 (出海前就要有)
  get nodes() { return (this.c.nodesRT ??= Uint8Array.from(this.c.mapNodes ?? new Uint8Array(0))); }
  nodeW(n, off) { const N = this.nodes, o = ((n << 4) + off) & 0xffff; return ((N[o] ?? 0) | ((N[o + 1] ?? 0) << 8)) & 0xffff; }
  // 313b1 自动航行的方向: 到达目的地 → 8; 241c2 失败 → −1 (0xffff); 目标 = 中途点 (+0d&80) / 目的地 (&20) / 目前路线格的地点;
  //   以 Bresenham 式误差 (+0e) 在长轴上每步前进、短轴依误差前进 → DS:b7da[3 dy + dx + 4] (与 ae38 相同的表)
  autoSteer(f) {
    const F = this.asFleet(f), exR = getFleetRouteExtra(F);
    if (F.x === F.destX && F.y === F.destY) return 8;
    if (!this.route(F)) return 0xffff;
    let tx, ty;
    const fd = exR.routeMode;
    if (fd & 0x80) { tx = F.midX; ty = F.midY; }
    else if (fd & 0x20) { tx = F.destX; ty = F.destY; }
    else { const n = F.getRoutePts(F.routeFlags & 7); tx = this.nodeW(n, 0) & 0x7fff; ty = this.nodeW(n, 2); }
    const fx = F.x, fy = F.y;
    const di = Math.abs(seaS16(fx - tx)) & 0xffff, dy = Math.abs(seaS16(fy - ty)) & 0xffff;   // seg0:4d76
    let ex, ey;
    if (exR.routeMode & 2) { exR.routeErr = -Math.trunc(seaS16(di) / 2); exR.routeMode &= 0xfd; }
    if (seaS16(dy) < seaS16(di)) {
      ex = seaSgn(seaS16(tx - fx));
      const e = seaS16(exR.routeErr + dy); exR.routeErr = e;
      if (e < 0) ey = 0; else { exR.routeErr = e - di; ey = seaSgn(seaS16(ty - fy)); }
    } else {
      ey = seaSgn(seaS16(ty - fy));
      const e = seaS16(exR.routeErr + di); exR.routeErr = e;
      if (e < 0) ex = 0; else { exR.routeErr = e - dy; ex = seaSgn(seaS16(tx - fx)); }
    }
    return this.SJ.tab.dir3[3 * ey + ex + 4];
  }
  // 1fd9:4432 = 241c2: 已到达目前路线格的地点 → 下一格 (24206); 舰队在区域内 → 240a7; 否则 (只有舰队 AI 会走到) 清中途点, 需搜索时 232a6
  route(f) {
    const F = this.asFleet(f), exR = getFleetRouteExtra(F);
    const di = F.routeFlags & 7, n = F.getRoutePts(di);
    if ((this.nodeW(n, 0) & 0x7fff) === F.x && this.nodeW(n, 2) === F.y) this.nextNode(F, di);
    if (this.inRegion(F.x, F.y)) return this.regionRoute(F);
    exR.routeMode &= 0x7f;
    if (!(exR.routeMode & 0x40)) return 1;
    if (exR.routeMode & 8) { exR.routeMode |= 0x20; return 1; }
    return this.routeSearch(F);
  }
  // 24206 / 24112: 清掉路线格 di 的遮罩, 目前格 = (di + 1) & 3, +0d |= 2; 路线格都空了 (+0c & F0 = 0) 时 +0d |= 40 (重新搜索)
  nextNode(F, di) {
    const AE = [0x80, 0x40, 0x20, 0x10], exR = getFleetRouteExtra(F);
    let c = F.routeFlags & ~AE[di] & 0xffff;
    c = (c & 0xfff8) | ((di + 1) & 3) | 0x200;
    F.routeFlags = c;
    if (!(c & 0xf0)) exR.routeMode |= 0x40;
  }
  // 2317c 点在目前区域 (72 × 72) 内
  inRegion(x, y) {
    const left = (this.item * 0x2d0 + this.bda6) & 0xffff;
    return ((x - left) & 0xffff) < 0x48 && ((y - this.bdaa) & 0xffff) < 0x48 ? 1 : 0;
  }
  // 240a7 区域内的路线: 中途点无效 → 设 +0d |= 82; 已到达中途点 → (到了路线格的地点就换下一格) 重求; 否则沿用 (返回 1)
  //   需搜索 (+0d&40): 已到目的地的地点 (&8) → 直接驶向目的地 (|= 20), 否则 232a6; 之后 23e53 取目标 → 区域内就以 23a97(模式 1) 求中途点;
  //   失败时 24008 (项的左右 / 南北边界), 再失败 23ef7 把目标投影到区域边上后 23a97
  regionRoute(F) {
    const exR = getFleetRouteExtra(F), W = this.midPt(F);
    if (!(exR.routeMode & 0x80)) exR.routeMode |= 0x82;
    else {
      if (W.x !== F.x || W.y !== F.y) return 1;
      const di = F.routeFlags & 7, n = F.getRoutePts(di);
      if ((this.nodeW(n, 0) & 0x7fff) === F.x && this.nodeW(n, 2) === F.y) this.nextNode(F, di);
    }
    if (exR.routeMode & 0x40) { if (exR.routeMode & 8) exR.routeMode |= 0x20; else this.routeSearch(F); }
    if (this.wayTarget(F, W) && this.pathStep(F, W, 1)) return 1;
    if (this.edgeTarget(F, W)) return 1;
    if (this.clipTarget(F, W)) return this.pathStep(F, W, 1);
    return 0;
  }
  // 23e53 目标: 直接驶向目的地 (+0d&20) 时 = +4/+6 (+1b 为 0..3 或 9、目的地在区域内且是陆地 → 23e19 换成附近可到达的海面并写回 +4/+6);
  //   否则 = 目前路线格的地点。返回 目标在区域内
  wayTarget(F, W) {
    if (getFleetRouteExtra(F).routeMode & 0x20) {
      const b = F.mission;
      if ((b <= 3 || b === 9) && this.inRegion(F.destX, F.destY) && this.landAt(F.destX, F.destY)) {
        this.nearSea(F, W); F.destX = W.x; F.destY = W.y;
      }
      W.x = F.destX; W.y = F.destY;
    } else { const n = F.getRoutePts(F.routeFlags & 7); W.x = this.nodeW(n, 0) & 0x7fff; W.y = this.nodeW(n, 2); }
    return this.inRegion(W.x, W.y);
  }
  // 舰队在第 0 项而目标在第 2 项 (或相反) 时把目标 x 换到相邻的一圈 (±0x870)
  wrapX(fx, si) {
    if (fx < 0x2d0) { if (si >= 0x5a0) si -= 0x870; } else if (fx >= 0x5a0) { if (si < 0x2d0) si += 0x870; }
    return si;
  }
  // 24008 舰队在项的左右边缘 (x mod 720 = 0 / 0x2ce) 或南北边缘 (y = 0 / 0x436) 而目标在外侧 → 目标 = 舰队位置外 2 格, 返回 1
  edgeTarget(F, W) {
    const fx = seaS16(F.x), fy = seaS16(F.y), fm = fx % 0x2d0;
    const si = this.wrapX(fx, seaS16(W.x));
    if (fm === 0 && fx > si) { W.x = fx - 2; return 1; }
    if (fm === 0x2ce && si > fx) { W.x = fx + 2; return 1; }
    if (fy === 0 && seaS16(W.y) < fy) { W.y = fy - 2; return 1; }
    if (fy === 0x436 && seaS16(W.y) > fy) { W.y = fy + 2; return 1; }
    return 0;
  }
  // 23ef7 目标在区域外: 沿舰队 → 目标的直线投影到区域的左 / 右 (left / left + 0x46)、上 / 下 (top / top + 0x46) 边; 乘积只取低 16 比特 (imul 后 cwd)
  clipTarget(F, W) {
    const left = seaS16(this.item * 0x2d0 + this.bda6), top = seaS16(this.bdaa);
    const fx = seaS16(F.x), fy = seaS16(F.y);
    let si = this.wrapX(fx, seaS16(W.x)), di = seaS16(W.y);
    const q = (a, b, c) => Math.trunc(seaS16(Math.imul(a, b)) / seaS16(c));
    if (left > si) { di = seaS16(di + q(fy - di, left - si, fx - si)); si = left; }
    else if (left + 0x48 <= si) { di = seaS16(di + q(fy - di, left - si + 0x46, fx - si)); si = left + 0x46; }
    if (top > di) { si = seaS16(si + q(fx - si, top - di, fy - di)); di = top; }
    else if (top + 0x48 <= di) { si = seaS16(si + q(fx - si, top - di + 0x46, fy - di)); di = top + 0x46; }
    W.x = si; W.y = di;
    return this.inRegion(W.x, W.y);
  }
  // 1fd9:4089 = 23e19: 目的地 (+4/+6) 周围 12 个位置 (23d7b 堆栈上的表) 中第一个 在区域内、不是陆地、且 23872 可到达 的 → W (都不行时 W = 最后一个)
  nearSea(f, W) {
    const F = this.asFleet(f), D = [0, -2, 0, 2, 2, 0, -2, 0, -1, -2, 1, -2, 2, -1, 2, 1, -1, 2, 1, 2, -2, -1, -2, 1];
    for (let i = 0; i < 12; i++) {
      W.x = F.destX + D[2 * i]; W.y = F.destY + D[2 * i + 1];
      if (!this.inRegion(W.x, W.y) || this.landAt(W.x, W.y)) continue;
      if (this.pathField(F, W)) return 1;
    }
    return 0;
  }
  // 231c7 最近的地点 (由最后一笔往前, 距离平方, x 差依世界一圈 0x870 取近的一边; 找到距离 0 即停): 返回编号 | (距离 0 ? 0x8000 : 0)
  nearestNode(px, py) {
    const N = this.SJ.nodeCount;
    let best = 0xffffffff, bi = 0xffff;
    for (let i = N - 1; i >= 0 && best !== 0; i--) {
      const dx = seaS16((this.nodeW(i, 0) & 0x7fff) - px), dy = seaS16(this.nodeW(i, 2) - py);
      let si = dx;
      if (dx > 0x438) si = seaS16(si - 0x870); else if (si < -0x438) si = seaS16(si + 0x870);
      const d = (dy * dy + si * si) >>> 0;                             // seg0:37bc 长整数乘法
      if (d < best) { best = d; bi = i; }
    }
    return (best === 0 ? 0x8000 : 0) | bi;
  }
  // 232a6 地点路线搜索: 由目的地最近的地点往外做广度优先 (5 bytes 的队列项 {由哪个方向来的比特, 地点, 距离}; 已访问的只放宽距离, 不重排),
  //   主角舰队只走已探索 (+1 bit7) 的地点; 扩展到起点后由起点沿「距离 + 边长 = 本点距离」的邻点走回, 最多 4 个 (起点本身距离 0 时不算)
  //   → 从目前路线格起找第一个空格 (DS:ae30 遮罩), 依序填入, 遇到目的地的地点时 +0d |= 8; 最后 +0d &= BF。起点 = 目的地的地点且距离 0 → +0d |= 28
  routeSearch(F) {
    const N = this.nodes, AE = [0x80, 0x40, 0x20, 0x10], exR = getFleetRouteExtra(F);
    const link = (n, k) => this.nodeW(n, 4 + 2 * k), cost = (n, k) => N?.[((n << 4) + 0x0c + k) & 0xffff] ?? 0;
    const s0 = this.nearestNode(F.x, F.y), start = s0 & 0x7fff;
    const goal = this.nearestNode(F.destX, F.destY) & 0x7fff;
    if ((s0 & 0x8000) && start === goal) { exR.routeMode |= 0x28; return 1; }
    const E = [{ flags: 0, node: goal, cost: 0 }], vis = new Int16Array(0x300).fill(-1);
    vis[goal] = 0;
    const hero = F.addr === this.fleet;
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
        let rm = 8; for (let j = 0; j < 64 && link(nb, j) !== h.node; j++) rm = (rm >> 1) & 0xff;   // 2333d: 邻点的哪一个邻点是本点 (原版不限次数)
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
      cur = link(e.node, k);                                           // k = 4 (都不符) 时读到距离字段, 原版如此
      path.push(cur);
    }
    let slot = F.routeFlags & 7;
    for (let g = 0; g < 4 && (AE[slot & 3] & F.routeFlags); g++) slot = (slot + 1) & 3;
    for (let i = 0; i < path.length; i++, slot = (slot + 1) & 3) {
      if ((F.routeFlags & 0xf0) === 0xf0) break;
      F.routeFlags |= AE[slot & 3];
      F.setRoutePts(slot, path[i]);
      if (path[i] === goal) { exR.routeMode |= 8; break; }
    }
    exR.routeMode &= 0xbf;
    return 1;
  }
  // 314eb 船速 (各船取最小): 风向差 k = |风向 − 航向| → DS:06d8 表第 k 列的帆种系数 × 推进力 × 风力 (纵帆船 (+10 bit4 = 0) 风力至少 3) / 150
  //   × min(100, 驾驶% × 水手 / 船型 +5) / 100 × min(150, 180 − min(180, 载重%)) / 100 → 加上航海术 (+24) 10%/点 (上限 30) → × 技能 (+1d) / 75 (上限 40)
  //   k = 3..5 (逆风) 时再 × 转向力 / 100; 结果至少 2; 风力 0 且没有纵帆船 → 0
  shipSpeedAt(h, wStr, wDir) {
    const m = this.m, T = this.SJ.tab.windSpeed;
    const k = Math.abs(wDir - h) & 0xff, row = k * 8, beat = k >= 3 && k <= 5;
    let best = 0xc8, fore = 0;
    for (let i = 0; i < 10; i++) {
      const S = heroShipSlot(m, i), M = m.crewSlot(i);
      if ((S.flags & 0x30) !== 0x10) continue;
      const ship = m.ship(S.ship), Ty = m.shipType(ship.type);
      const P = m.person(M.captain);
      let ws;
      if (!(ship.flags & 0x10)) { ws = wStr < 3 ? 3 : wStr; fore = (fore - 1) & 0xff; } else ws = wStr;
      let v = Math.trunc(seaS16(Math.imul((T[row + Ty.buildLevel] * S.propulsion) & 0xffff, ws)) / 0x96) & 0xff;
      const q = Math.trunc(Math.imul(M.lookRatio, seaS16(S.crew)) / Ty.minCrew);
      v = Math.trunc(((seaUmin(100, q & 0xffff) * v) & 0xffff) / 100) & 0xff;
      const pct = Math.trunc(seaS16(Math.imul(100, seaS16(M.loadTotal))) / seaS16(Ty.capacity));
      const c = seaUmin(0x96, (0xb4 - pct) & 0xffff);
      v = Math.floor(((v * c) & 0xffff) / 100) & 0xff;
      const a = seaS16(Math.imul(P.navLevel, v));
      const b7 = seaUmin(30, (Math.trunc(a / 10) + v) & 0xffff) & 0xff;
      let sp = seaUmin(40, Math.trunc(((P.getStats(1) * b7) & 0xffff) / 75) & 0xffff) & 0xff;
      if (beat) sp = Math.trunc((S.turn * sp) / 100) & 0xff;
      if (sp < best) best = sp;
    }
    if (best < 2) best = 2;
    return !wStr && !fore ? 0 : best;
  }
  // 31728 依航向与海流移动一步: 格内位置 (+18/+19, 每格 0x3c) 累加 (方位矢量 × 船速 + 海流矢量 × 海流强度, 8 比特);
  //   跨格时检查陆地 (3135c); 走到 WORLDMAP 项的左右边界 (x mod 720 < 0 或 >= 719) / 南北边界时不检查陆地并设 crossed
  //   返回 1 = 被陆地挡住 (连斜向也不行)
  stepFleet(h, out) {
    const m = this.m, F = heroFleet(m), X = this.SJ.tab.dirX, Y = this.SJ.tab.dirY, b = m.globals.windCur;
    const cd = (b & 0x38) >> 3, cs = b & 7;
    out.crossed = 0;
    const ddx = seaS8(Math.imul(X[h], seaS8(this.speed)) + Math.imul(X[cd], cs)), ddy = seaS8(Math.imul(Y[h], seaS8(this.speed)) + Math.imul(Y[cd], cs));
    const fx = seaS8(ddx + F.subX), fy = seaS8(ddy + F.subY);
    let px = seaS16(F.x) % 0x2d0, py = seaS16(F.y), ax = 0, ay = 0;
    if (fx >= 0x3c) { px++; ax = -0x3c; } else if (fx < 0) { px--; ax = 0x3c; }
    if (fy >= 0x3c) { py++; ay = -0x3c; } else if (fy < 0) { py--; ay = 0x3c; }
    else if (!ax) { F.subX = fx; F.subY = fy; out.x = px; out.y = py; return 0; }
    const base = (this.item * 0x2d0) & 0xffff;
    if (px < 0 || px >= 0x2cf) { px += seaSgn(ddx); py = seaS16(F.y); out.crossed = 1; }
    if (py < 0 || py >= 0x437) {
      px = seaS16(F.x) % 0x2d0;
      if (py >= 0 && py < 0x438) { py += seaSgn(ddy); out.crossed = 1; } else py = seaS16(F.y);
    }
    out.x = px; out.y = py;
    if (!out.crossed && this.landAt(px, py)) {
      out.x = seaS16(F.x) % 0x2d0; out.y = seaS16(F.y);
      if (this.landAt(seaS16(F.x) + seaSgn(ddx), seaS16(F.y) + seaSgn(ddy))) return 1;
      F.subX = fx; F.subY = fy;
      if (ax) F.subX = ddx > 0 ? 0x3b : 0;
      if (ay) F.subY = ddy > 0 ? 0x3b : 0;
      return 0;
    }
    F.x = (px + base + 0x870) % 0x870;
    F.y = (py + 0x438) % 0x438;
    F.subX = ax + fx; F.subY = ay + fy;
    return 0;
  }
  async heroMove() {
    const m = this.m, F = heroFleet(m);
    let si = await this.heading();
    if (this.port !== 0xff) return;
    if (si !== 8) {
      const a = m.globals.portFlags;
      this.speed = this.shipSpeedAt(si, a & 7, (a & 0x38) >> 3) & 0xff;   // [bdac] (海流方向/强度是传入的参数, 但 314eb 没有用到)
      const ox = F.x, oy = F.y, out = {};
      if (this.stepFleet(si, out)) {
        si = (si + 1) & 7;
        if (this.stepFleet(si, out)) { si = (si - 2) & 7; if (this.stepFleet(si, out)) this.blocked(); }
      }
      if (out.crossed) {
        this.item = Math.trunc(seaS16(F.x) / 0x2d0) & 0xff;             // 849a 换 WORLDMAP 项
        const r = this.regionOf(); this.region = r; this.decodeRegion(r);
        if (this.landAt(seaS16(F.x), seaS16(F.y))) {
          F.x = ox; F.y = oy;
          this.item = Math.trunc(seaS16(F.x) / 0x2d0) & 0xff;           // 849a (区域缓冲保留新项的内容, [06c8] 之后设为 FFFF)
        } else {
          if (out.x < 0 || out.x >= 0x2cf) this.vx1006 = Math.trunc(seaS16(F.x) / 24) * 24;
          if (out.y < 0 || out.y >= 0x437) this.vy1008 = Math.trunc(seaS16(F.y) / 24) * 24;
        }
        this.region = 0xffff;
        F.midX = (seaS16(F.midX) + 0x870) % 0x870;
      }
    }
    this.scroll();
  }
  // 1fd9:44d8 = 24268: 三个方向都被挡住 → 23a97(目标 = 舰队 +8, 舰队, 0): 以 +8/+a 为目标重求中途点写回 +8/+a
  blocked() { const F = heroFleet(this.m); this.pathStep(F, this.midPt(F), 0); }
  // 237fb + 23872 区域距离场 (缓冲 [0c88] = 窗口保存区, 72 × 72 字): 0x800 = 未到, 0x801 = 陆地 (图块 >= 0x34); 由目标往外做带权最短路
  //   (DS:ae18: 8 方向 dx, dy, 成本 2 / 3; 队列 = 堆栈上 72×72 字的环状缓冲, 插入排序); 船身 2×2: 该格与 东、南、东南 都不能是陆地
  //   返回 1 = 由目标扩展到了起点 (起点 = 舰队 F, 座标以区域左上为原点的 8 比特值); 目标在陆地上或到不了 → 0
  pathField(f, T) {
    const F = this.asFleet(f), D = this.SJ.tab.path8, N = 72 * 72, Q = new Int32Array(N);
    const buf = (this.pathBuf ??= new Uint16Array(0x8000)); buf.fill(0);
    const left = (this.item * 0x2d0 + this.bda6) & 0xffff, top = this.bdaa & 0xffff;
    const sx = (F.x - left) & 0xff, sy = (F.y - top) & 0xff, tx = (T.x - left) & 0xff, ty = (T.y - top) & 0xff;
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
  // 23a97(T, F, mode): 距离场建好后由舰队沿距离递减走 (最多 256 步, 每步取 8 邻格中最小的; 都不更小时往北), 第一步的方向一直延伸到不再同向的位置 → T
  //   舰队与目标同一格时 T = 区域左上 (原版如此)。mode ≠ 0 的后半 (再尝试转向) 只有舰队 AI 使用, 尚未移植
  pathStep(f, T, mode) {
    const F = this.asFleet(f), D = this.SJ.tab.path8;
    if (!this.pathField(F, T)) return 0;
    const buf = this.pathBuf;
    const left = (this.item * 0x2d0 + this.bda6) & 0xffff, top = this.bdaa & 0xffff;
    const fx = seaS16(F.x - left), fy = seaS16(F.y - top), tx = seaS16(T.x - left), ty = seaS16(T.y - top);
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
    const X = this.SJ.tab.dirX, Y = this.SJ.tab.dirY, next = k => (x0 + X[k]) + (y0 + Y[k]) * 72;   // DS:ae42 / ae4a (与 0718 / 0720 相同)
    for (; si < path.length; si++, run++) {
      if (path[si] !== next(d)) break;
      x0 += X[d]; y0 += Y[d];
    }
    // 23c9c 第 3 参数 ≠ 0 (委任 / 舰队 AI 的 240a7): 路线转弯处先试 方向 +1、再试 −1 走一格; 转成功且直线段长度 ≠ 0 时沿新方向继续延伸
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
  // 31b73 地图窗口滚动: 主角离窗口左上 < 11 − [0ca9] 或 > 11 + [0ca9] 时移动一格 (x 限 项内 0..0x2b8, y 0..0x420)
  scroll() {
    const gm = this.m, F = heroFleet(gm), m = gm.globals.seaScroll;
    const rx = seaS16(F.x) - this.vx1006, si = this.vx1006 % 0x2d0;
    if (11 - m > rx) { if (si > 0) this.vx1006 = this.vx1006 - 1; }
    else if (m + 11 < rx) { if (si < 0x2b8) this.vx1006 = this.vx1006 + 1; }
    const ry = seaS16(F.y) - this.vy1008, dy = this.vy1008;
    if (11 - m > ry) { if (dy > 0) this.vy1008 = dy - 1; }
    else if (m + 11 < ry) { if (dy < 0x420) this.vy1008 = dy + 1; }
  }

  // ================= 2e09:2f3d = 30fcd 发现 (港口 / 村落) 与海上特殊地点 =================
  async discover() {
    const m = this.m, F = heroFleet(m), rng = this.c.sys.rng;
    if (this.port !== 0xff) return;
    const sight = seaUmax(this.sight, 2);
    for (let i = 0; i < 10; i++) {
      const enc = getSeaEncounter(m, i);
      if (enc.x !== F.x || enc.y !== F.y) continue;
      enc.x = 0; enc.y = 0;
      await this.seaEvent(enc.eventId);                                // 30e9f
      this.monsterRead(i);                                             // 31047
      setSeaEncounterIndex(m, (getSeaEncounterIndex(m) + 1) & 0xff);
      return;
    }
    let skill = m.heroPerson().getStats(3);
    for (let i = 0; i < 0x1e; i++) { const n = m.partyCrew(i); if (n !== 0xff && m.person(n).getStats(3) > skill) skill = m.person(n).getStats(3); }
    for (let di = 0; di < 0x82; di++) {
      const R = m.port(di);
      if (R.region & 0x30) continue;
      const x = seaS16(R.x), y = seaS16(R.y);
      if (!this.near(2, x, y)) {
        if (!this.inSight(sight, x, y)) continue;
        if (rng.random(0xc8) >= skill) return;
      }
      appendTradeLog(m, this.c.rt, 9, di, 0, 0);                       // 0fea:e3e5 交易记录 种类 9 (发现港口)
      R.region |= 0x10;
      await this.found(0, di);
      return;
    }
    for (let di = 0; di < 0x64; di++) {
      const R = m.discovery(di);
      if (R.flags & 0xc0) continue;
      const x = seaS16(R.x), y = seaS16(R.y);
      if (!this.near(2, x, y)) {
        if (!this.inSight(sight, x, y)) continue;
        if (rng.random(0xc8) >= skill) return;
      }
      R.flags |= 0x40;
      await this.found(1, 0);
      return;
    }
  }
  // 0fea:30fc = 12f9c: |主角 − (x, y)| 各轴 <= r
  near(r, x, y) {
    const F = this.fleet, fx = this.wx(F), fy = this.wy(F);
    const dx = fx < x ? x - fx : fx - x, dy = fy < y ? y - fy : fy - y;
    return dx <= r && dy <= r;
  }
  // 30f81: 雾 (天候 3) 以外、距离 <= r 且在地图窗口内
  inSight(r, x, y) {
    if ((this.m.globals.weather & 15) === 3) return false;
    if (!this.near(r, x, y)) return false;
    return x >= this.vx1006 && x < this.vx1006 + 0x18 && y >= this.vy1008 && y < this.vy1008 + 0x18;
  }
  // 30b34 发现: 重新解码区域并画地图, 「船长！发现%s港！」/「发现村落！」, 港口 (< 100) 加冒险名声 25 × 规模 (+1c), 补给港与村落 50
  async found(kind, id) {
    const { sys, con, printf, message, win, menu } = this.c, m = this.m;
    let fame = 0x32;
    this.decodeRegion(this.region);
    sys.mouseHide();
    this.drawMap();
    const l = con.left, r = con.right;
    if (this.c.scr.wideRenderer) this.b.beginWideTalk(null);
    else win.shadowedSaved(0x10, 0xa0, 0x24, 0x80, 0);                      // 30b1e
    con.puts(this.SS.captain);
    if (kind === 0) {
      printf(this.SS.foundPort, m.port(id).nameBytes);
      fame = id >= 0x64 ? 0x32 : (0x19 * m.portEconomy(id).regionGroup) & 0xffff;
    } else con.puts(this.SS.foundVillage);
    if (fame) {
      const H = m.heroInfo();
      H.adventureFame = H.adventureFame + seaUmin(50000 - H.adventureFame, fame);
      message(0x1dc, fame);
    }
    await menu.waitPrompt(); await win.close();
    sys.mouseShow();
    con.left = l; con.right = r;
  }
  // 31047: 以唯读开 MONSTER.DAT (0fea:6114, 开不了时原版显示错误并结束程序), lseek 到第 [1044] 笔 (5 bytes), 读 4 bytes 到 DS:1012 + 4i (x, y)、
  //   1 byte 到 DS:103a + i (事件编号) — 用过的地点换成文件里的下一个; 读到档尾以后读不到, 该地点维持 (0, 0) (RE_NOTES 36.2)
  monsterRead(i) {
    const m = this.m, M = this.P.monster, enc = getSeaEncounter(m, i);
    let pos = getSeaEncounterIndex(m) * 5;
    if (pos < M.length) enc.x = (enc.x & 0xff00) | M[pos++];
    if (pos < M.length) enc.x = (enc.x & 0x00ff) | (M[pos++] << 8);
    if (pos < M.length) enc.y = (enc.y & 0xff00) | M[pos++];
    if (pos < M.length) enc.y = (enc.y & 0x00ff) | (M[pos++] << 8);
    if (pos < M.length) enc.eventId = M[pos];
  }
  // 30e9f 海上特殊地点事件 n: 先运行 DS:b796[n] 的函数 (返回 0 = 没有发生, 什么都不显示); 发生时效果音 DS:0c44 两次 (各 0x1e tick, 中间 0x14),
  //   30b1e 窗口「船长！不得了啦！快看海面上！」, 再两段消息 (n + 0xff) × 2 + i 各自一个窗口, 8067 重画, 9888
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
  // DS:b796 的 10 个函数 (返回 1 = 发生)
  seaEventFn(n) {
    const m = this.m, H = m.globals.hero;
    // 事件 2 / 5 / 8: 从第 9 艘往前找第一艘「有船且船长不是主角」的 (10 艘都不是 → 0)
    const other = () => { for (let i = 9; i >= 0; i--) if ((heroShipSlot(m, i).flags & 0x30) === 0x10 && m.crewSlot(i).captain !== H) return i; return -1; };
    const has = i => (heroShipSlot(m, i).flags & 0x30) === 0x10;
    switch (n) {
      case 0:                                                          // 30c10: 348ff(0x19, 0) 各船水手 −25% (不显示损失)
        for (let i = 0; i < 10; i++) if (has(i)) {
          const S = heroShipSlot(m, i), p = seaS16(Math.imul(0x19, seaS16(S.crew)) & 0xffff);   // imul 后只用低 16 比特 (cwd)
          S.crew = S.crew + Math.trunc(p / -100);
        }
        return 1;
      case 1: {                                                        // 30c1d: 主角 + 船员 (12d8c → [0538]) 各 +20 −= min(+20, 10)
        const cnt = this.b.captainPool(), L = this.c.persons;
        for (let i = 0; i < cnt; i++) { const P = m.person(L[i] & 0xff), cur = P.getStats(4); P.setStats(4, cur - seaUmin(cur, 10)); }
        return 1;
      }
      case 2: {                                                        // 30c6a: 那艘船离队 (+8 &= EF), 船长 +2e = 6, 船长栏 = FF
        const i = other(); if (i < 0) return 0;
        const S = heroShipSlot(m, i), M = m.crewSlot(i);
        S.flags &= 0xef; m.person(M.captain).role = 6; M.captain = 0xff;
        return 1;
      }
      case 3: return 1;                                                // 30cce: 没有效果
      case 4: {                                                        // 30cd2: 有船的船位 (12c8a → [0538]) 士气 +1c += min(10, 100 − +1c)
        const cnt = this.b.fleetShips(), L = this.c.persons;
        for (let i = 0; i < cnt; i++) { const M = m.crewSlot(L[i] & 0xff); M.morale = M.morale + seaUmin(10, 100 - M.morale); }
        return 1;
      }
      case 5: { const i = other(); if (i < 0) return 0; const S = heroShipSlot(m, i); S.propulsion >>= 1; return 1; }   // 30d24
      case 6:                                                          // 30d75: 各船 +16..+1a = FF、+0c..+14 (5 字) = 0, 每艘之后 0fea:9d01 (19ba1, 只计算)
        for (let i = 0; i < 10; i++) if (has(i)) {
          const M = m.crewSlot(i);
          for (let k = 0; k < 5; k++) { M.setCargoGoods(k, 0xff); M.setCargoAmts(k, 0); }
        }
        return 1;
      case 7:                                                          // 30dd9: 各船士气 +1c −= min(+1c, 10)
        for (let i = 0; i < 10; i++) if (has(i)) { const M = m.crewSlot(i); M.morale = M.morale - seaUmin(M.morale, 10); }
        return 1;
      case 8: {                                                        // 30e29: 那艘船 +2 >>= 1, 0fea:83f9 舰队重算
        const i = other(); if (i < 0) return 0;
        const S = heroShipSlot(m, i); S.durability >>= 1; this.fleetDurability(heroFleet(m));
        return 1;
      }
      case 9: { const P = m.heroPerson(), v = P.getStats(7); P.setStats(7, v - seaUmin(v, 0x1e)); return 1; }   // 30e83: 主角 +23 −= min(+23, 30)
    }
    return 0;                                                          // 表外: 原版会跳到表后的地址 (正常不会发生)
  }

  // ================= 每日 195b6 (只在海上) =================
  async seaDaily() {
    if (this.port !== 0xff) return;
    this.foodDaily(); this.waterDaily();
    await this.rats(); await this.scurvy(); await this.lost();
  }
  // 19427: 鼠患 (0cb3 bit4): 未发生时 19358 判断发生, 发生中 193dc 每船粮食 −min(10, 粮食)
  async rats() {
    const m = this.m;
    if (!(m.globals.weather & 0x10)) await this.ratsStart();
    if (m.globals.weather & 0x10) for (let i = 0; i < 10; i++) if (this.present(i)) { const M = m.crewSlot(i); M.food = M.food - seaUmin(10, M.food); }
  }
  // 19358: 出港 > 30 天、没有猫 ([bda8]&0x40)、random(主角 +24 / 5 + 2) = 0 且 random(105) > 主角 +23 → GRAPH #0x39、0x1d9
  async ratsStart() {
    const m = this.m, g = m.globals, H = m.heroPerson(), rng = this.c.sys.rng, di = H.getStats(7), si = H.navLevel;
    if (g.weather & 0x10 || this.bda8 & 0x40 || g.daysAtSea <= 0x1e) return;
    if (rng.random(Math.trunc(si / 5) + 2)) return;
    if (rng.random(0x69) <= di) return;
    await this.seaNotice(0x39, 0x1d9);
    g.weather |= 0x10;
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
  // 19511: 坏血病 (0cb3 bit5): 出港 > 60 天且 random(105) > 主角 +23 时发生 (GRAPH #0x3b、0x1da); 发生中每船水手 −min(random(2) + (100 − 船长 +1e) / 5, 水手)
  async scurvy() {
    const m = this.m, g = m.globals, rng = this.c.sys.rng;
    if (!(g.weather & 0x20)) {
      if (g.daysAtSea > 0x3c && rng.random(0x69) > m.heroPerson().getStats(7)) { await this.seaNotice(0x3b, 0x1da); g.weather |= 0x20; }
    }
    if (g.weather & 0x20) for (let i = 0; i < 10; i++) {
      if (!this.present(i)) continue;
      const S = heroShipSlot(m, i), P = m.person(m.crewSlot(i).captain);
      const v = (rng.random(2) + Math.trunc((100 - P.getStats(2)) / 5)) & 0xffff;
      S.crew = S.crew - seaUmin(v, S.crew);
    }
  }
  // 19528: 全舰队没有水手 (或没有船) → 0x1ba / 0x241 后游戏结束 ([03ea] = 0x19)
  async lost() {
    const m = this.m, { sys, palette, message, menu, win } = this.c;
    let n = 0, crew = 0;
    for (let i = 0; i < 10; i++) if (this.present(i)) { crew = (crew + heroShipSlot(m, i).crew) & 0xffff; n++; }
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
  // 19a99 天候开始: 所在海域的风向表 bit7 (天候区) 时, random(155) > 最高的观测 (航海士/测量士 +23) + 50 且 random(11) > 平均 +1d
  //   → bit6: 1988c (落水); 海流表 bit6..7 = 1 暴风雨 / 2 无风 / 3 雾
  async weatherStart() {
    const m = this.m, g = m.globals, rng = this.c.sys.rng, [w, c] = this.clock.windAt(this.fleet);
    if (!(w & 0x80)) return;
    let best = m.heroPerson().getStats(7);
    for (let i = 0; i < 0x1e; i++) {
      const n = m.partyCrew(i); if (n === 0xff) continue;
      const P = m.person(n), job = P.role;
      if ((job === 3 || job === 5) && P.getStats(7) > best) best = P.getStats(7);
    }
    let sum = 0, cnt = 0;
    for (let i = 0; i < 10; i++) if (this.present(i)) { sum += m.crewSlot(i).figurehead; cnt++; }
    if (rng.random(0x9b) <= best + 0x32) return;
    if (rng.random(0x0b) <= Math.floor(sum / cnt)) return;
    if (w & 0x40) await this.overboard();
    switch (c & 0xc0) {
      case 0x40: if (rng.random(7) + 3 >= (g.portFlags & 7) && !g.cooldown10a6) { await this.weatherBegin(0x154, 1); this.stormSound(); } break;
      case 0x80: if (rng.random(6) >= (g.portFlags & 7)) await this.weatherBegin(0x158, 2); break;
      case 0xc0: if (!rng.random(10) && rng.random(6) >= (g.portFlags & 7)) await this.weatherBegin(0x15c, 3); break;
    }
  }
  // 1988c 海难: 非主角当船长、船长 +1b & 0xc0 且 random(100) > 船长 +23 的第一艘船 → 19849 (船长离队、船 5deb 移除) → 197f7
  async overboard() {
    const m = this.m, rng = this.c.sys.rng;
    for (let i = 0; i < 10; i++) {
      const M = m.crewSlot(i);
      if (!this.present(i) || M.captain === m.globals.hero) continue;
      const P = m.person(M.captain);
      if (rng.random(100) <= P.getStats(7)) continue;
      if (!(P.portrait & 0xc000)) continue;
      this.dropShip(i, M);
      await this.shipLostMsg(i);
      return;
    }
  }
  // 19849: 船长从船员名单 (DS:2e1b) 移除 (+2d = FF, +31 &= DF), 再 5deb 移除船位 i
  dropShip(i, M) {
    const m = this.m, c = M.captain;
    for (let k = 0; k < 0x1e; k++) if (m.partyCrew(k) === c) {
      m.setPartyCrew(k, 0xff);
      const P = m.person(c); P.stayPort = 0xff; P.face &= 0xdf;
      break;
    }
    this.removeShip(i);
  }
  // seg0:5deb 移除船位 i: 船 (+0f = FF, +10/+11/+12/+14 = 0)、船位 (+2..+6 = FF, +0 = 0, +8 = 0)、船员配置清空, 船长 (非主角) 职务 = 6; +08 先写 0x19 再写 0x32 (原版如此)
  removeShip(i) {
    const m = this.m, M = m.crewSlot(i), S = heroShipSlot(m, i), ship = m.ship(S.ship);
    ship.type = 0xff; ship.maxGuns = 0; ship.flags = 0; ship.maxCargo = 0; ship.maxCrew = 0;
    S.propulsion = 0xff; S.turn = 0xff; S.maxDurability = 0xff; S.durability = 0xff; S.guns = 0xff;
    S.crew = 0; S.flags = 0;
    M.ammo = 0; M.material = 0; M.food = 0; M.water = 0;
    for (let k = 0; k < 5; k++) { M.setCargoGoods(k, 0xff); M.setCargoAmts(k, 0); }
    M.loadTotal = 0;
    if (M.captain !== m.globals.hero) m.person(M.captain).role = 6;
    M.captain = 0xff; M.morale = 0; M.figurehead = 0; M.navRatio = 0x19; M.navRatio = 0x32;
  }
  // 197f7: 0x150 / 0x151「%s 不见了」— 原版以「船位编号」当船编号取船名 (5c7a(i)), 照搬
  async shipLostMsg(i) {
    if (this.port !== 0xff) return;
    const { sys, message, con } = this.c, m = this.m, ship = m.ship(i);
    sys.mouseHide();
    const p = this.b.crewSpeaks();
    message(p !== 0xff && (m.person(p).flags & 8) ? 0x151 : 0x150, ship.nameBytes);
    await this.c.menu.waitPrompt(); await this.c.win.close();
    sys.mouseShow();
    con.right = 0x50;
  }
  // 19909 观测者: 船员名单中最后一个职务 3 与最后一个职务 5 的人, 取 +1f 较高者 (相同时取职务 5)
  watcher() {
    const m = this.m; let a = 0xffff, b = 0xffff, pa = null, pb = null;
    for (let i = 0; i < 0x1e; i++) {
      const n = m.partyCrew(i); if (n === 0xff) continue;
      const P = m.person(n), j = P.role;
      if (j === 3) { pa = P; a = n; } else if (j === 5) { pb = P; b = n; }
    }
    if (b === 0xffff && a === 0xffff) return 0xffff;
    if (b === 0xffff) return a;
    if (a !== 0xffff && pb.getStats(3) < pa.getStats(3)) return a;
    return b;
  }
  // 1999c 天候开始: [0cb3] = (高 4 比特) | 种类 | 0x40; 观测者 random(100) <= +1f 时发言 (msg + 2 若 +1e < 70; + 1 若 +2f bit3)
  async weatherBegin(msg, kind) {
    const m = this.m, g = m.globals, { sys, message, menu, win } = this.c;
    const di = this.watcher();
    g.weather = (g.weather & 0xf0) | kind | 0x40;
    if (di === 0xffff) return;
    const P = m.person(di);
    if ((this.c.sys.rng.random(100) & 0xff) > P.getStats(3)) return;
    if (this.port !== 0xff) return;
    sys.mouseHide();
    this.b.talkPerson(di);
    if (P.getStats(2) < 0x46) msg += 2;
    message(P.flags & 8 ? msg + 1 : msg);
    await menu.waitPrompt(); await win.close();
    sys.mouseShow();
  }
  // 船员发言 0x... (+1 若发言者 +2f bit3) 后等待、关闭
  async crewSay(m0, m1, ...a) {
    const { message, menu, win } = this.c, m = this.m, p = this.b.crewSpeaks();
    message(p !== 0xff && (m.person(p).flags & 8) ? m1 : m0, ...a);
    await menu.waitPrompt(); await win.close();
  }
  // 19f48 天候进行中: 刚开始 (bit6) 时船员报告 (暴风雨先 2103 + GRAPH #0x3a), 重画地图, bit6 → bit7; 依种类 19bd1 / 19e84 / 19efc; 1976e
  async weatherOngoing() {
    const m = this.m, g = m.globals, { sys, graph } = this.c;
    if (g.weather & 0x40) {
      sys.mouseHide();
      if ((g.weather & 15) === 1) { this.clearCache(); graph.draw(0x3a, 0xa0, 0x10); }
      const si = ((g.weather & 15) + 0xaf) * 2;
      await this.crewSay(si, si + 1);
      this.drawMap();
      sys.mouseShow();
      g.weather = (g.weather & 0xbf) | 0x80;
    }
    switch (g.weather & 15) {
      case 1: await this.storm(); break;
      case 2: await this.calm(); break;
      case 3: await this.fog(); break;
    }
    this.c.palette.selectTimePalette(this.time, true, g.weather);       // 1976e
  }
  // 19bd1 暴风雨 (每时刻): 各船损伤 si = min(10, (100 − 船长 +1d) / (+24/5 + 3) + 1) + random(2), 非 +10 bit6 的船 ×5;
  //   耐久度 (+2) −si, 转向力 (+4)、推进力 (+5) −si/2; 最大耐久 (+3) = max(船型 +1 / 4, +3 − 1), 耐久度 <= 最大耐久;
  //   耐久度 0: 主角的船 → 淡出、[03ea] = 0x18 (游戏结束); 其他船 → 沉没消息 0x166/0x167 (+ 船长 0x329 或 19849), 5deb
  //   [1005]&0x18 时不损伤。之后 18299、风力 = 7; 非当天开始且 (random(8) = 0 或离开天候区) → 结束 0x168/0x169; 8067
  async storm() {
    const m = this.m, g = m.globals, { sys, palette, message, menu, win } = this.c, rng = this.c.sys.rng, F = heroFleet(m);
    if (!(g.seaFlags2 & 0x18)) {
      for (let i = 0; i < 10; i++) {
        const M = m.crewSlot(i), S = heroShipSlot(m, i);
        if ((S.flags & 0x30) !== 0x10) continue;
        const P = m.person(M.captain), ship = m.ship(S.ship);
        const cx = Math.floor(P.navLevel / 5) + 3;
        let si = seaUmin(10, (Math.trunc((100 - P.getStats(1)) / cx) + 1) & 0xffff);
        si = (si + rng.random(2)) & 0xffff;
        if (!(ship.flags & 0x40)) si = (5 * si) & 0xffff;
        S.durability -= seaUmin(S.durability, si);
        const h = Math.trunc(seaS16(si) / 2);
        S.propulsion -= seaUmin(S.propulsion, h);
        S.turn -= seaUmin(S.turn, h);
        const mx = seaUmax(m.shipType(ship.type).durability >> 2, (S.maxDurability - 1) & 0xffff) & 0xff;
        S.maxDurability = mx;
        S.durability = seaUmin(mx, S.durability);
        if (S.durability) continue;
        if (M.captain === g.hero) { await palette.fadeBlack(); palette.ending = 0x18; return; }
        sys.mouseHide();
        const cap = M.captain, Pc = m.person(cap);
        if (!(Pc.portrait & 0xc000)) {
          let k = 0; while (k < 0x1e && m.partyCrew(k) !== cap) k++;
          if (k < 0x1e) m.setPartyCrew(k, 0xff);
          const p = this.b.crewSpeaks();
          message(p !== 0xff && (m.person(p).flags & 8) ? 0x167 : 0x166, m.ship(S.ship).nameBytes);
          message(0x329, Pc.givenNameBytes);
          if (k < 0x1e) m.setPartyCrew(k, cap); else setPartySalaryUnit(m, 0, cap);   // 原版把船长放回原位 (找不到时写到 DS:2e39)
          this.removeShip(i);
        } else {
          this.dropShip(i, M);
          const p = this.b.crewSpeaks();
          message(p !== 0xff && (m.person(p).flags & 8) ? 0x167 : 0x166, m.ship(S.ship).nameBytes);   // 5deb 不清 +7 与船名, 仍是原船名
        }
        await menu.waitPrompt(); await win.close();
        sys.mouseShow();
      }
      this.fleetDurability(F);                                         // 18299
    }
    g.portFlags |= 7;
    if (!(g.weather & 0x80) && (!rng.random(8) || !(g.portFlags & 0x80))) {
      this.c.sfx?.off();                                               // 9888 停止效果音
      g.weather &= 0xf0;
      sys.mouseHide(); await this.crewSay(0x168, 0x169); sys.mouseShow();
    }
    this.seaPanel();                                                   // 8067
  }
  // 18299 舰队 +28 = (各船耐久度和 + 4) / 5; 和为 0 时 +29 bit0 清除
  fleetDurability(f) {
    const F = this.asFleet(f); let sum = 0;
    for (let i = 0; i < 10; i++) { const S = fleetShipSlot(F, i); if ((S.flags & 0x30) === 0x10) sum += S.durability; }
    F.strength = Math.trunc((sum + 4) / 5);
    if (!sum) F.flags &= 0xfe;
  }
  // 19e84 无风: 非当天开始、random(20) = 0 且所在海域风力 (风向表 &7) ≠ 0 → 结束 0x16a/0x16b; 期间风力 = 0
  async calm() {
    const g = this.m.globals, rng = this.c.sys.rng, [w] = this.clock.windAt(this.fleet), { sys } = this.c;
    if (!(g.weather & 0x80) && !rng.random(0x14) && (w & 7)) {
      g.weather &= 0xf0;
      sys.mouseHide(); await this.crewSay(0x16a, 0x16b); sys.mouseShow();
    }
    g.portFlags &= 0xf8;
  }
  // 19efc 雾: 非当天开始且 (random(30) = 0 或离开天候区 (风 bit7 = 0)) → 结束 0x16c
  async fog() {
    const g = this.m.globals, rng = this.c.sys.rng, { sys, message, menu, win } = this.c;
    if (g.weather & 0x80) return;
    if (rng.random(0x1e) && (g.portFlags & 0x80)) return;
    g.weather &= 0xf0;
    sys.mouseHide(); this.b.crewSpeaks(); message(0x16c); await menu.waitPrompt(); await win.close(); sys.mouseShow();
  }

  // ================= 靠港 0fea:c0d9 = 1bf79 =================
  // 主角周围 12 格 (DS:a6e8) 中地图缓冲 ([03f6], 96 宽, 以区域左上为原点) 是港口图块 0x74 / 0x78 的: 1bb4a 找座标相同的港口 → [0cae]
  //   → 1bf4c 确认 → [1005] |= 0x20、交易记录 (种类 0, +4 出港天数, +6 港口) → 1bd16 到港处理 → 8c53 进港; 否 → [0cae] = FF 结束
  //   **进港后循环不结束**: 继续检查其余的格, 但缓冲已换成港口地图 (原版如此, 若刚好是 0x74 / 0x78 会再问一次)
  async dock() {
    const m = this.m, g = m.globals, F = this.fleet, T = this.SJ.tab.dock12;
    let cx = (Math.trunc(this.wx(F) / 24) % 30) - 1, cy = (Math.trunc(this.wy(F) / 24) % 45) - 1;
    cx = cx < 0 ? 0 : cx > 0x1b ? 0x1b : cx; cy = cy < 0 ? 0 : cy > 0x2a ? 0x2a : cy;
    const rx = seaS16((this.wx(F) % 0x2d0) - 24 * cx), ry = seaS16(this.wy(F) - 24 * cy);
    for (let k = 0; k < 12; k++) {
      const x = T[2 * k] + rx, y = T[2 * k + 1] + ry;
      if (x < 0 || x >= 0x60 || y < 0 || y >= 0x60) continue;
      const t = this.map[y * 0x60 + x];
      if (t !== 0x74 && t !== 0x78) continue;
      g.port = this.portIdAt(this.wx(F) + T[2 * k], this.wy(F) + T[2 * k + 1]) & 0xff;
      if (!(await this.askDock())) { g.port = 0xff; return; }
      g.seaFlags2 |= 0x20;
      appendTradeLog(m, this.c.rt, 0, g.daysAtSea, 0, 0, g.port);
      await this.arrival();                                            // 1bd16
      await this.enter();                                              // 8c53
    }
  }
  // 1bb4a 座标完全相同的港口 (130 个), 没有 → 0xffff
  portIdAt(x, y) {
    const m = this.m;
    for (let i = 0; i < 0x82; i++) { const R = m.port(i); if (R.x === (x & 0xffff) && R.y === (y & 0xffff)) return i; }
    return 0xffff;
  }
  // 1bf4c 船员「要进入%s港吗？」(0x16d) 是/否
  async askDock() {
    const { message, menu, win } = this.c;
    this.b.crewSpeaks();
    message(0x16d, this.m.currentPort().nameBytes);
    const r = await menu.yesNo();
    await win.close();
    return r;
  }
  // 1bd16 到港: 港口 +15 |= 0x50、[1005] |= 0x20、[0cb3] &= C0; 依出港天数 d 给经验 (主角与职务 2/3 的船员 2·min(d,70)², 其他船员 min(d,100)²);
  //   1fd9:333a 地点比特表; 港口 < 100 时更新中古船清单 DS:7f74 (3 笔 × 8: +0..+4 船型, +5 港口)
  async arrival() {
    const m = this.m, g = m.globals, rng = this.c.sys.rng, port = g.port;
    const R0 = m.port(port);
    R0.region |= 0x50;
    g.seaFlags2 |= 0x20;
    g.weather &= 0xc0;
    this.c.sfx?.off();                                                 // 9888 停止效果音
    const a = seaUmin(g.daysAtSea, 0x46), b2 = seaUmin(g.daysAtSea, 0x64);
    const g2 = Math.imul(b2, b2) & 0xffff, g1 = (Math.imul(a, a) << 1) & 0xffff;
    const H = m.heroPerson();
    if (this.levelUp(H, g1)) await this.levelMsg(H, 0);
    for (let k = 0; k < 0x1e; k++) {
      const n = m.partyCrew(k); if (n === 0xff) continue;
      const P = m.person(n), j = P.role;
      if (j === 2 || j === 3) { if (this.levelUp(P, g1)) await this.levelMsg(P, 1); }
      else if (this.levelUp(P, g2)) await this.levelMsg(P, 2);
    }
    this.locationBits();                                               // 1fd9:333a
    if (port >= 0x64) return;
    let si = 0; while (si < 3 && m.usedShipCache(si).port !== port) si++;
    if (si < 3) { promoteUsedShipCache(m, si); return; }
    shiftUsedShipCache(m);
    const c0 = m.usedShipCache(0);
    c0.port = port;
    for (let i = 0; i < 5; i++) c0.setShipTypes(i, 0xff);
    const E = m.portEconomy(port), R = this.SJ.tab.usedShips, row = getPortEcoExtra(E).shipRegion * 8;
    let di = 8;
    for (let i = 0; i < 8; i++) { const t = R[row + i]; if (t === 0xff || ((10 * m.shipType(t).shipClass) & 0xffff) > E.industry) di--; }
    let k = 0;
    if (di) for (let n = 0; n < 3; n++) c0.setShipTypes(k++, R[row + (rng.random(di) & 0xff)]);
    for (let n = 0; n < 2; n++) c0.setShipTypes(k++, this.SJ.tab.usedShips2[rng.random(Math.floor(seaUmin(E.commerce, 0x2a8) / 0x28) + 1) & 0xff]);
  }
  // 1bb9c 经验 (+26) += g; 足够时升级 (+24, 所需 = min(等级, 18)² × 30, 100 为上限: 经验归零); 有升级时 +1c..+1f 各 + min(random(3), 100 − 值)
  levelUp(P, g) {
    const rng = this.c.sys.rng;
    let n = 0;
    P.navExp = (P.navExp + g) & 0xffff;
    for (;;) {
      const lv = P.navLevel, need = seaS16(Math.imul(seaUmin(lv, 0x12) * seaUmin(lv, 0x12), 0x1e));
      if (need > seaS16(P.navExp)) break;
      if (lv === 0x64) { P.navExp = 0; break; }
      n++; P.navExp = (P.navExp - need) & 0xffff; P.navLevel = lv + 1;
    }
    if (n) for (let i = 0; i < 4; i++) { const v = P.getStats(i); P.setStats(i, v + seaUmin(rng.random(3), (100 - v) & 0xffff)); }
    return n;
  }
  // 1bc14 升级消息: 发言者就是本人 → 「助手」, 主角 → 「船长」, 其他 → 姓名; 「的航海等级有所提高．」+ 3 项能力各 + min(random(3), 100 − 值) (有增加的列出) + 「上升．」
  async levelMsg(P, kind) {
    const m = this.m, { sys, con, printf, menu, win } = this.c, rng = sys.rng;
    const l = con.left, r = con.right;
    sys.mouseHide();
    const p = this.b.crewSpeaks();
    con.puts(p !== 0xff && m.person(p).addr === P.addr ? this.SS.assistant : kind === 0 ? this.SS.captainT : P.givenNameBytes);
    con.puts(this.SS.levelUp);
    let up = 0;
    for (let i = 0; i < 3; i++) {
      const cur = P.getStats(i), v = seaUmin(rng.random(3), (100 - cur) & 0xffff) & 0xff;
      if (!v) continue;
      printf(this.SS.listSep, this.SJ.statNames[i] ? seaHex(this.SJ.statNames[i]) : Uint8Array.of(0));
      P.setStats(i, cur + v); up = 1;
    }
    if (up) { con.setCursor(con.x - 2, con.y); con.puts(this.SS.rise); }
    this.c.sfx?.voice(0x0c2e); this.c.sfx?.note(0x3c);                // 9768(DS:0c2e) + 9804(0x3c) 效果音, 5998(0x14) 延迟, 9888
    await sys.waitTicks(0x14);
    this.c.sfx?.off();
    await menu.waitPrompt(); await win.close();
    sys.mouseShow();
    con.left = l; con.right = r;
  }
  // 1fd9:333a = 230ca 地点 (x & 0x7fff, y) 所在的格在探索表 DS:0de8 有比特的, DS:1046 比特表设比特
  locationBits() {
    const m = this.m, N = this.c.nodesRT ?? this.c.mapNodes;
    if (!N) return;
    for (let i = 0; i < this.SJ.nodeCount; i++) {
      const x = Math.floor(((N[i * 16] | (N[i * 16 + 1] << 8)) & 0x7fff) / 24), y = Math.trunc(seaS16(N[i * 16 + 2] | (N[i * 16 + 3] << 8)) / 24);
      if (isWorldCellExplored(m, x, y)) markExploreLocationNode(m, i);
    }
  }

  // 2e09:3223 = 312b3 委任: 职务 3 的第一个船员 (seg0:5cee) 没有或 +30 bit4 (技能) = 0 → 船员 0x357/0x358 (+2f bit3), 返回 0;
  //   否则 0fea:321a 已发现港口清单 (清单 0x85 = 种类 5 港名) → 舰队 +4/+6 = 港口座标 (陆地上, 之后 23e53 换成附近的海), +0c = 0x4000, +1b = 0,
  //   [1005] = (&DF) | 0x80 (之后每个时刻由 316b3 / 313b1 自动航行); 取消 → 0
  async delegate() {
    const m = this.m;
    let ok = 0;
    for (let i = 0; i < 0x1e; i++) {
      const n = m.partyCrew(i); if (n === 0xff) continue;
      if (m.person(n).role === 3) { if (m.person(n).skills & 0x10) ok = 1; break; }
    }
    if (!ok) { await this.crewSay(0x358, 0x357); return 0; }
    const si = await this.b.listSel().select(0x85, this.knownPorts());
    if (si < 0) return 0;
    const R = m.port(this.c.persons[si] & 0xff), F = heroFleet(m);   // seg0:5c9a
    F.destX = R.x; F.destY = R.y;
    F.routeFlags = 0x4000; F.mission = 0;
    m.globals.seaFlags2 = (m.globals.seaFlags2 & 0xdf) | 0x80;
    return 1;
  }
  // 0fea:321a = 130ba 已发现 (+15 bit4) 的港口编号 → [0538], 返回个数
  knownPorts() {
    const m = this.m, P = this.c.persons; let n = 0;
    for (let i = 0; i < 0x82; i++) if (m.port(i).region & 0x10) P[n++] = i;
    return n;
  }
  // ================= 停船 / 出航 20ee3 =================
  async stopToggle() {
    const g = this.m.globals, { win, con, menu, scr } = this.c;
    if (scr.wideRenderer) this.b.beginWideTalk(null);
    else win.shadowedSaved(0x10, 0xa0, 0x24, 0x48, 1);
    if (g.seaFlags2 & 0x20) { con.puts(this.SS.move); g.seaFlags2 &= 0xdf; }
    else { con.puts(this.SS.stop); g.seaFlags2 = (g.seaFlags2 | 0x20) & 0x7f; }
    await menu.waitPrompt(); await win.close();
  }

  // ================= 登陆 2e09:6e37 = 34ec7 =================
  // 主角周围 8 个 2×2 位置 (DS:b92e / b93e, 靠窗口边缘的方向略过) 做成点击区 → 0fea:37d1 选择 → [8246] = 34c53 该处的发现物
  //   → 该处地图格: 0x41/0x49/0x51/0x59 (0x59 时 [b8de] = 0) 或 0x7c..0x7f → 34d54 上陆; 0x74..0x7b → 靠港; < 0x74 → 0x1b9「这里不能上陆」; >= 0x80 → 无
  //   [1005]&0x18 时直接 34d54
  async land() {
    const g = this.m.globals, F = this.fleet, { menu, message, win } = this.c;
    if (g.seaFlags2 & 0x18) { await this.landExplore(); return; }
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
    g.discoveryId = this.discNear(x, y);                               // [8246] (在存盘范围内)
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
  // 34c53 窗口座标 (x, y) 的 2×2 (含左上 1 格) 内的发现物编号, 没有 → 0xff
  discNear(x, y) {
    const m = this.m;
    for (let d = 0; d < 0x64; d++) for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      const R = m.discovery(d);
      if (((x - R.x + this.vx1006) & 0xffff) === a && ((this.vy1008 - R.y + y) & 0xffff) === b) return d;
    }
    return 0xff;
  }
  // 0fea:37d1 = 13671 以点击区选择 (数字键 4 / 6 循环, Enter 确定, Esc / '0' 取消 → 0xff); [a160] 不重设 (超出时才归 0)
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
        // 顶部提示
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
  // 34d54 上陆探索 (确认、MENU #0x24 上陆菜单、34ccc 发现物) → scenes/land.js (RE_NOTES 第 36 节)
  async landExplore() { await new Land(this).run(); }

  // ================= 命令 交涉 20a6d / 战斗 0fea:1181 / 侦察 1feae =================
  // 0fea:314a = 12fea(r) 距离 <= r、出航中 (+29 bit0)、非 bit4、指挥者 (+2a) 不是主角的舰队 → DS:0538 = 指挥者, 返回数量
  nearFleets(r) {
    const m = this.m, hero = m.globals.hero, P = this.c.persons; let n = 0;
    for (let k = 0; k < 0x46; k++) {
      const F = m.fleet(k);
      if (!(F.flags & 1) || (F.flags & 0x10) || F.admiral === hero) continue;
      if (this.near(r, seaS16(F.x), seaS16(F.y))) P[n++] = F.admiral;
    }
    return n;
  }
  async smallMsg(m) {
    const { win, message, menu, scr } = this.c;
    if (scr.wideRenderer) this.b.beginWideTalk(null);
    else win.shadowedSaved(0x14, 0x80, 0x1e, 0x60, 0);
    message(m); await menu.waitPrompt(); await win.close();
  }
  // 20a6d 交涉 → 20127 (scenes/negotiate.js, 第 30.1 节)
  async negotiate() { return seaNegotiate(this); }
  // 10f7e 海战 (AL, DL = 双方指挥者, 其中一方是主角; BL、堆栈参数 = 双方援军, 0xff = 没有) → scenes/battle.js (第 30 节)
  async navalBattle(al, dl, bl, arg) { return new NavalBattle(this).run(al, dl, bl, arg); }
  // 0fea:1181 = 11021 战斗: 时刻 < 15 或 >= 60 → 0x30d「夜间不能开战」; 10df0 选对象 (附近没有 → 0x30a); 与主角同国 (非 6) → 0x30e 确认; → 10f7e(主角, 对象, 0xff, 0xff)
  async battle() {
    const m = this.m, t = this.c.rt.time;
    if (t < 0x0f || t >= 0x3c) { await this.smallMsg(0x30d); return; }
    for (;;) {
      const tg = await this.battleTarget();
      if (tg === 0xff) return;
      const nat = Math.floor(m.person(tg).fleet / 10), hn = m.heroPerson().face & 0x0f;
      if (nat === hn && hn !== 6) {
        const { win, message, menu, scr } = this.c;
        if (scr.wideRenderer) this.b.beginWideTalk(null);
        else win.shadowedSaved(0x14, 0x80, 0x1e, 0x60, 0);
        message(0x30e);
        const ok = await menu.yesNo(); await win.close();
        if (!ok) continue;
      }
      await this.navalBattle(m.globals.hero, tg, 0xff, 0xff);
      return;
    }
  }
  // 10df0 对象: 12fea(2) → 清单 3 → 1c839 人物数据 + 是/否
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
  // ================= 情报 航海图 0fea:dc2e = 1dace、随身物 地图 0fea:ded6 = 1dd76 =================
  // 1d8ac(0x80): 现代 PNG 模式直接由 seachip.png 缩放绘制，无需二进位缩略图表
  chartTiles() {
    return null;
  }
  // 1d710(栏 col, y, 世界栏 bc, 列 br, 缩略图表 T, 模式)
  chartQuad(col, y, bc, br, _T, mode) {
    const m = this.m, scr = this.c.scr, art = this.c.art;
    bc %= 0x5a;
    if (mode === 0 && !isWorldCellExplored(m, bc, br)) { scr.fillCols(col, y, 0x18, 0xc0, 9); return; }
    const it = (3 * Math.trunc(br / 0x2d) + Math.trunc(bc / 0x1e)) & 0xff;
    if (it !== this.item) this.item = it;                              // 849a
    let ox = 0x18, oy = 0x18, r = (br % 0x2d) - 1, c = (bc % 0x1e) - 1;
    if (c < 0) { c = 0; ox = 0; } else if (c > 0x1b) { ox = 0x30; c = 0x1b; }
    if (r < 0) { r = 0; oy = 0; } else if (r > 0x2a) { oy = 0x30; r = 0x2a; }
    if (mode === 0) this.decodeRegion(0x1e * r + c);                   // 1fd9:2fd2
    else this.wm.decodeChart(m.st, this.item, 0x1e * r + c, this.seaBuf);   // 1fd9:3187
    for (let rr = 0; rr < 0x18; rr++) for (let cc = 0; cc < 0x18; cc++)
      art?.drawSheetTile(scr, "seachip", this.seaBuf[0x60 * (oy + rr) + ox + cc], (col + cc) * 8, y + rr * 8, { dw: 8, dh: 8, smooth: true });
  }
  // 1fd9:1f2a 水平 XOR 线 (逐点 seg0:0b33, 剪裁矩形 DS:aaac)
  xorLine(x0, y, x1, color) {
    const [cx0, cy0, cx1, cy1] = this.c.clip ?? [0, 0, 0x27f, 0x18f], fb = this.c.scr.fb;
    if (y < cy0 || y > cy1) return;
    for (let x = Math.max(x0, cx0); x <= Math.min(x1, cx1); x++) fb[y * 640 + x] ^= color & 15;
    this.c.scr.dirty = true;
  }
  // 1d9be 世界全图: 淡出 → GRAPH.DAT #0x19 (5b5d) → 未探索的海域格 (DS:0de8) 以 6 × 6 色 0xd 盖住 (画面栏 = 世界栏 + [06d5] (= 30) mod 90) →
  //   主角位置 ((x + 720) mod 2160 − 12) / 4、(y − 12) / 4 起 6 条 XOR 色 0xb 的横线 → 99ce(DS:a700) 航海图调色盘
  async worldView() {
    const m = this.m, { palette, graph, scr } = this.c, F = heroFleet(m);
    scr.setAtmosphere?.({ active: false });
    scr.wideRenderer = null;
    await palette.fadeBlack();                                         // 99f2
    graph.draw(0x19, 0, 0);
    for (let r = 0; r < 0x2d; r++) {
      let si = 0x5a - 0x1e;
      for (let c = 0; c < 0x5a; c++) {
        if (!isWorldCellExplored(m, si, r)) scr.fillRectPxPlanes(6 * c + 0x32, 6 * r + 0x32, 6 * c + 0x37, 6 * r + 0x37, 0x0d, 4);   // 1fd9:227c
        si = (si + 1) % 0x5a;
      }
    }
    const x = Math.trunc((((0x18 * 0x1e + F.x) % 0x870) - 0x0c) / 4) + 0x32;
    let y = Math.trunc((seaS16(F.y) - 0x0c) / 4) + 0x32;
    for (let i = 0; i < 6; i++, y++) this.xorLine(x, y, x + 5, 0x0b);
    await palette.fadeTo(palette.table("chart"));                      // 99ce(DS:a700)
  }
  // 0fea:dc2e = 1dace 航海图: 在港时先读海上图块 (84de, [06ca] = FF); 世界全图上以 0fea:5f74 (90 × 45 格, 格宽 −6 = 1 格光标, 起点 = 主角所在) 选格 →
  //   该格与右、下 共 2 × 2 格都未探索 → 重选 (光标回到上次的格); 否则 淡出、清画面 (07f7)、外框 (5a91: 在港 #3/#5 + 8894, 海上 #2/#4 + 日期 / 8067 / 8fbf)、
  //   1d710 画 2 × 2 个海域格 (模式 0) → 航海图调色盘 → 等按键 (131f9) → 淡出 → 1d9be → 99ce → 再选。取消后: 在港 88e9 + 外框 + 8894 + 罗盘指针;
  //   海上 还原 [06ca] (849a)、重新解码目前区域、外框、舵轮指针 (95f2) → 1976e → 2103 + 1fac → 淡入
  async chart() {
    const m = this.m, g = m.globals, { palette, sys, graph, scr, menu } = this.c, F = heroFleet(m);
    const item0 = this.item, needle0 = this.needle, inPort = this.port !== 0xff;
    if (inPort) this.item = 0xff;                                      // 84de (移植版的 seachip 常驻)
    const T = this.chartTiles();                                       // 1d8ac(0x80)
    await this.worldView();                                            // 1d9be
    let init = Math.trunc(F.y / 0x18) * 0x5a + Math.trunc(((0x1e * 0x18 + F.x) % 0x870) / 0x18);
    for (;;) {
      const r = await this.cellSel().select(0x32, 0x32, 0x5a, -6, 6, 0x2d, init);
      if (r === -1) break;
      const col = ((r % 0x5a) - 0x1e + 0x5a) % 0x5a, row = Math.trunc(r / 0x5a);
      let seen = 0;
      for (let yy = row; yy < row + 2; yy++) for (let xx = col; xx < col + 2; xx++) if (yy < 45 && xx < 90 && isWorldCellExplored(m, xx, yy)) seen = 1;
      if (!seen) continue;
      init = r;
      await palette.fadeBlack();                                       // 99f2
      scr.clear(0);                                                    // 07f7
      if (inPort) { graph.draw8(g.options & 0x80 ? 3 : 5, 0, 0); this.panels(); }
      else { graph.draw8(g.options & 0x80 ? 2 : 4, 0, 0); this.seaDate(); this.seaPanel(); this.dials(); }
      this.chartQuad(0x0c, 8, col, row, T, 0); this.chartQuad(0x24, 8, col + 1, row, T, 0);
      this.chartQuad(0x0c, 0xc8, col, row + 1, T, 0); this.chartQuad(0x24, 0xc8, col + 1, row + 1, T, 0);
      await palette.fadeTo(palette.table("chart"));                    // 99ce(DS:a700)
      sys.flush(); await menu.waitRelease(); await menu.waitPress();   // 131f9
      await palette.fadeBlack();
      await this.worldView();
      await palette.fadeTo(palette.table("chart"));
    }
    await palette.fadeBlack();
    if (inPort) { this.loadPort(); graph.draw8(g.options & 0x80 ? 3 : 5, 0, 0); this.panels(); this.compass(0xff); this.compass(needle0); }   // 88e9 / 5a91 / 8894 / 94fa
    else {
      if (this.item !== item0) this.item = item0;                      // 849a
      this.decodeRegion(this.region);                                  // 1fd9:2fd2([06c8])
      graph.draw8(g.options & 0x80 ? 2 : 4, 0, 0);
      this.helm(0xff); this.helm(needle0);                             // 95f2
    }
    palette.selectTimePalette(this.time, !inPort, g.weather);          // 1976e
    this.clearCache(); this.drawMap();                                 // 2103 + 1fac
    await palette.fadeToTarget();                                      // 99e8
    sys.flush();                                                       // 3fae
  }
  // 0fea:ded6 = 1dd76 随身物 种类 0x0c 地图 (it = 随身物编号): 缩略图表的图块 0x7c..0x7f 改成在图块 0x41 (海) 上画 X 记号
  //   (DS:a7c8 / a7cf 两条斜线: 平面 1 OR, 其他平面 AND NOT) → 发现物 (随身物 +12 → DS:7f8c + 7 × n) 所在的 2 × 2 海域格
  //   (x mod 24 < 12 时往左一格, y mod 24 < 12 且列 ≠ 0 时往上一格) 以 1d710 模式 1 画在地图窗口 → 航海图调色盘 → 等按键 →
  //   在港 88e9 / 海上 还原 [06ca] 与区域 → 淡出 → 1976e → 2103 + 1fac → 淡入 (不重画外框与面板)
  async mapItem(it) {
    const m = this.m, g = m.globals, { palette, sys, menu, scr, art, codec } = this.c, item0 = this.item, inPort = this.port !== 0xff;
    const itObj = m.item(it), R = m.discovery(itObj.power);            // seg0:5cde → +12 → seg0:5cce
    const x = seaS16(R.x), y = seaS16(R.y);
    if (scr.wideRenderer && hasDom() && art) {
      const itemName = codec ? toSimp(decodeCleanCstr(codec, itObj.nameBytes)) : "藏宝图";
      await runDomTreasureChartModal({ title: itemName, x, y, art, wm: this.wm, st: m.st });
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
    palette.selectTimePalette(this.time, !inPort, g.weather);          // 1976e
    this.clearCache(); this.drawMap();                                 // 2103 + 1fac
    await palette.fadeToTarget();                                      // 99e8
    sys.flush();                                                       // 3fae
  }

  // 1feae 侦察: 1fd9c 选格 → 港口 (已显示消息) / 没有 → 再选; 舰队 → 指挥者的数据窗口 7849(0x0f, 0x20, 0x21, 0xd8, 1):
  //   「名•姓」、国名 (DS:08de; 国籍 6 时 = 指挥者编号 mod 6) + 舰队种类 (MENU #0x27: 舰队编号 mod 10 = 0 → 0, 1..4 → 1, 5..9 → 2)、
  //   速度 (1acbf / 2, 调用端把风力 / 风向、海流方向 / 强度对调传入, 原版如此)、航向 (MENU #0x28[+1a])、各船名 (两栏, 行高 [8a1e] = 0x10)
  //   舰队编号 61..69 (除 60) 时, 船员中最高的 +1e > random(90) → 船员 0x2fe「国名 + 种类」
  async scout() {
    const m = this.m, g = m.globals, { win, con, printf, message, menu } = this.c, S = this.SS, rng = this.c.sys.rng;
    const types = (this.fleetTypes ??= this.c.menuItems(0x27)), heads = (this.headNames ??= this.c.menuItems(0x28));   // 2e09:57aa
    const nations = (this.nationNames ??= this.P.data.nations.map(seaHex));
    for (;;) {
      const al = await this.scoutPick();                               // 1fd9c
      if (al === 0xff) return;
      if (al === 0x80) continue;
      const P = m.person(al), F = m.fleet(P.fleet);                    // seg0:5c28
      let nat = P.face & 0x0f; if (nat === 6) nat = al % 6;
      let ty = P.fleet % 10; ty = ty ? Math.trunc(ty / 5) + 1 : 0;
      const a = g.portFlags, b = g.windCur;
      const spd = this.c.prefs?.fixScoutSpeedArgs
        ? this.fleetSpeed(F, (a >> 3) & 7, a & 7, b & 7, (b >> 3) & 7)
        : this.fleetSpeed(F, a & 7, a >> 3, b >> 3, b & 7);    // 0fea:ae1f = 1acbf
      if (this.c.scr.wideRenderer && hasDom() && this.c.codec) {
        const dec = bts => toSimp(decodeCleanCstr(this.c.codec, bts));
        const gName = dec(P.givenNameBytes), fName = dec(P.familyNameBytes);
        const fullName = fName ? `${gName}·${fName}` : gName;
        const headName = dec(heads[F.dir] ?? Uint8Array.of(0));
        const ships = [];
        for (let i = 0; i < 10; i++) {
          const Sl = fleetShipSlot(F, i);
          if ((Sl.flags & 0x30) !== 0x10) continue;
          ships.push(dec(m.ship(Sl.ship).nameBytes));
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
        printf(S.scName, P.givenNameBytes, P.familyNameBytes);
        printf(S.scNation, nations[nat], types[ty]);
        printf(S.scSpeed, Math.trunc(seaS16(spd) / 2));
        printf(S.scHead, heads[F.dir] ?? Uint8Array.of(0));
        con.setCursor(-1, 0x98);
        con.lineH = 0x10;                                                // [8a1e]
        let col = 0;
        for (let i = 0; i < 10; i++) {
          const Sl = fleetShipSlot(F, i);
          if ((Sl.flags & 0x30) !== 0x10) continue;
          con.setCursor(col ? 0x20 : 0x11, -1);                          // seg0:442c
          printf(S.scShip, m.ship(Sl.ship).nameBytes);
          if (col) printf(S.nl);
          col ^= 1;
        }
        await menu.waitPrompt(); await win.close();
        con.lineH = 0x18;
      }
      if (Math.trunc(P.fleet / 10) !== 6 || P.fleet === 0x3c) continue;
      const n = this.b.crewCount(); let mx = 0;
      for (let i = 0; i < n; i++) { const v = m.person(this.c.persons[i] & 0xff).getStats(2); if (v > mx) mx = v; }
      if (rng.random(0x5a) < mx) { this.b.crewSpeaks(); message(0x2fe, nations[nat], types[ty]); await menu.waitPrompt(); await win.close(); }
    }
  }
  // 1fd9c 侦察的选格: 0fea:5f74 地图窗口 24 × 24 格 (起点 = 主角) → 取消 0xff; 已发现港口 (+15 bit4) 的座标 = 窗口左上 + 格 → 「船长，那是%s港．」0x80;
  //   0fea:31a8 该格的他舰队: 0 → 0xd7「那儿什么也没有」0x80; 1 → 指挥者; 多个 → 清单 0x8c (种类 12) 选 (取消 0x80)
  async scoutPick() {
    const m = this.m, g = m.globals, F = heroFleet(m), { win, printf, message, menu, scr } = this.c;
    if (scr.wideRenderer && scr._wideSeaCam) {
      this.cellSel().widePrompt = "请选择侦察目标";
      const pt = await this.cellSel().selectWideSeaWorld(seaS16(F.x), seaS16(F.y));
      if (!pt) return 0xff;
      const WORLD_W = 0x870;
      const wrapX = v => ((v % WORLD_W) + WORLD_W) % WORLD_W;
      const probes = [
        [0, 0], [-1, 0], [0, -1], [-1, -1], [1, 0], [0, 1],
      ].map(([dx, dy]) => [wrapX(pt.wx + dx), pt.wy + dy]);
      for (const [tx, ty] of probes) {
        if (ty < 0 || ty >= 0x438) continue;
        for (let di = 0; di < 0x82; di++) {
          const R = m.port(di);
          if (wrapX(R.x) !== tx || R.y !== ty) continue;
          if (!(R.region & 0x10)) continue;
          this.b.beginWideTalk(null);
          printf(this.SS.scPort, R.nameBytes);
          await menu.waitPrompt(); await win.close();
          return 0x80;
        }
        const P = this.c.persons;
        let n = 0;
        for (let k = 0; k < 0x46; k++) {
          const Fl = m.fleet(k);
          if (!(Fl.flags & 1) || (Fl.flags & 0x10) || Fl.admiral === g.hero) continue;
          if (wrapX(Fl.x) === tx && Fl.y === ty) P[n++] = Fl.admiral;
        }
        if (n === 1) return P[0] & 0xff;
        if (n > 1) {
          const si = await this.b.listSel().select(0x8c, n);
          if (si === -1) return 0x80;
          return P[si] & 0xff;
        }
      }
      this.b.beginWideTalk(null);
      message(0xd7); await menu.waitPrompt(); await win.close(); return 0x80;
    }
    const init = seaS16(Math.imul(seaS16(F.y - this.vy1008), 0x18) + seaS16(F.x - this.vx1006));
    if (scr.wideRenderer) this.cellSel().widePrompt = "请选择侦察目标";
    const c = await this.cellSel().select(0x60, 8, 0x18, 0x10, 0x10, 0x18, init);
    if (c < 0) return 0xff;
    const cCol = c % 0x18, cRow = Math.trunc(c / 0x18);
    // 宽屏幕下允许点击 2×2 船只/港口任意一格命中（优先精准格，再查相邻 ±1 格）
    const probes = scr.wideRenderer
      ? [c, c - 1, c - 0x18, c - 0x19, c + 1, c + 0x18]
      : [c];
    for (const pc of probes) {
      if (pc < 0 || pc >= 0x18 * 0x18) continue;
      if (Math.abs((pc % 0x18) - cCol) > 1 || Math.abs(Math.trunc(pc / 0x18) - cRow) > 1) continue;
      for (let di = 0; di < 0x82; di++) {
        const R = m.port(di);
        if (((R.x - (pc % 0x18)) & 0xffff) !== g.seaViewX || ((R.y - Math.trunc(pc / 0x18)) & 0xffff) !== g.seaViewY) continue;
        if (!(R.region & 0x10)) continue;
        if (scr.wideRenderer) this.b.beginWideTalk(null);
        else win.shadowedSaved(0x14, 0x80, 0x1e, 0x60, 0);
        printf(this.SS.scPort, R.nameBytes);
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
  // 0fea:31a8 = 13048 格 c (窗口内) 上的他舰队 (出航中、非 +29 bit4、指挥者不是主角) 的指挥者 → [0538]
  fleetsAt(c) {
    const m = this.m, g = m.globals, P = this.c.persons; let n = 0;
    for (let k = 0; k < 0x46; k++) {
      const F = m.fleet(k);
      if (!(F.flags & 1) || (F.flags & 0x10) || F.admiral === g.hero) continue;
      if (((F.x - (c % 0x18)) & 0xffff) === g.seaViewX && ((F.y - Math.trunc(c / 0x18)) & 0xffff) === g.seaViewY) P[n++] = F.admiral;
    }
    return n;
  }
  // 0fea:ae1f = 1acbf 舰队 F 的速度 (舰队 AI 共用): AX = wDir, DX = wStr, [bp+6] = cB, [bp+8] = cA
  //   各船: 风向差 k = |wDir − 航向| 的帆种系数 × 推进力 × wStr / 150 → + 指挥者 +24 × v / 10 (上限 30) → × 指挥者 +1d / 75 (上限 40),
  //   k = 3..5 再 × 转向力 / 100; 取最小 (至少 2); 再依 |cA − 航向|: 0..1 或 ≥ 7 → + min(40 − v, cB), 3..5 → − min(v − 1, cB);
  //   wStr = 0 且没有纵帆船 → 0 (与 314eb 不同: 没有水手与载重项, 也没有纵帆船至少 3 的风力)
  readDsLow(addr) {
    const D = (this.dsLow ??= Uint8Array.from((this.P.fleet?.dsLow ?? "").match(/../g) ?? [], h => parseInt(h, 16)));
    return readDsLowOrStateByte(this.m, D, addr);
  }
  fleetSpeed(f, wDir, wStr, cB, cA) {
    const m = this.m, F = this.asFleet(f), P = m.person(F.admiral);
    const lv = P.navLevel, sk = P.getStats(1), hd = F.dir;
    let best = 0xff, fore = 0;
    const k = Math.abs(seaS16(wDir - hd)) & 0xff, k2 = Math.abs(seaS16(cA - hd)) & 0xff, beat = k >= 3 && k <= 5;
    for (let i = 0; i < 10; i++) {
      const S = fleetShipSlot(F, i);
      if ((S.flags & 0x30) !== 0x10) continue;
      const ship = m.ship(S.ship);
      if (!(ship.flags & 0x10)) fore = (fore - 1) & 0xff;
      const t = m.shipType(ship.type);
      // DS:06d8 表 (航向 FF 时读到 dsLow/state 越界位置，保持原版一致)
      let v = Math.trunc(seaS16(Math.imul(this.readDsLow(0x06d8 + ((k * 8) & 0xffff) + t.buildLevel) * S.propulsion, wStr)) / 0x96) & 0xff;
      v = seaUmin(0x1e, (Math.trunc(seaS16(Math.imul(v, lv)) / 10) + v) & 0xffff) & 0xff;
      v = seaUmin(0x28, Math.trunc(seaS16(Math.imul(v, sk)) / 0x4b) & 0xffff) & 0xff;
      if (beat) v = Math.trunc((S.turn * v) / 100) & 0xff;
      if (v < best) best = v;
    }
    if (best < 2) best = 2;
    if (k2 === 0 || k2 === 1 || k2 >= 7) best = (best + seaUmin(0x28 - best, cB)) & 0xff;
    else if (k2 >= 3 && k2 <= 5) best = (best - seaUmin(best - 1, cB)) & 0xff;
    return !wStr && !fore ? 0 : best;
  }
}
