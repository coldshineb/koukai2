// scenes/port.js — 港口场景 (MAIN.EXE seg0:5f0c..6a65, 869f..8c53, 8dfd..8f03, 9453..95f2 与 0FEA 段 1b1a3..1bb49)
// 原版变量对照 (DS):
//   窗口左上 (地图格) cb4/cb6 (word, 存盘内)   主角在窗口内的位置 cb8/cba (word)   上次所在港 caf
//   行人 0cbc + i*3 {x, y, 方向/种类} i=0..3 走动, 4..7 站立   建筑入口 0904 + k*2 {x, y} k=0..11 (ZA_DAT.DAT)
//   地图偏移 bdba = cb6*96 + cb4   精灵动画相位 8b0a (0 / 0x280)   8b1e 每步切换   8b08 交谈冷却   8c1d 罗盘指针
//   图块参数 bd78..bd7b (PORTCHIP 组 2n+1)   图块缓存 cs:1b2c (24×24)
// 画面: 地图窗口 24×24 格 (每格 16×16) 位于 x=96, y=8; 精灵 = 2×2 格 (32×32)
//
// 与原版的差异 (尚未移植, 见 docs/RE_NOTES.md 第 15 节):
//   - 建筑内部: 见 scenes/buildings.js (部分移植); 4 个指令按钮见 scenes/commands.js
//   - 剧本事件 (2e09:5481/53f0/55c2/5546): 目前视为「没有事件」
import { loadBinary, loadJSON } from "../core/assets.js";
import {
  decodeMonsterJson,
  decodePortMapJson,
  decodeWindCurJson,
  decodeWorldMapJson,
  decodeZaDatJson,
} from "../decoders/bin_json.ts";
import { Buildings } from "./buildings.js";
import { Commands } from "./commands.js";
import { Scenario, ENV_COMMON, ENV_HERO } from "../game/scenario.js";
import { loadDuelAssets } from "./duel.js";
import { PortMove } from "./portmove.js";
import { GameConst, OptionFlag, TreatyFlag } from "../model/flags.ts";
import { getPortNpc, getWorkState, setPortNpc } from "../model/world_helpers.ts";
import { renderWidePort, hitWideCommandButton } from "../renderer/world.ts";
import { renderWideBuilding } from "../renderer/building.ts";
import { hasDom } from "../ui/modals.ts";
import { captureConsoleText } from "../ui/text_util.ts";

const pHex = s => { const b = Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16))), o = new Uint8Array(b.length + 1); o.set(b); return o; };
const P_MAP_W = 96, P_VIEW = 24, P_VIEW_X = 96, P_VIEW_Y = 8;
const P_CURSORS = [0x2570, 0x29f0, 0x28d0, 0x2690, 0x27b0];        // 1b966: 无 / ↑ / → / ↓ / ←
const pS16 = v => (v << 16) >> 16;

export async function loadPortAssets(ctx) {
  const A = ctx.ASSETS;
  const [zaJson, mapJson, data, windJson, portchipMeta, colony, itemMes, commands, worldmapJson, sea, battle, fleet, duel, monsterJson] = await Promise.all([
    loadJSON(A + "/data/za_dat.json"),
    loadJSON(A + "/data/portmap.json"),
    loadJSON(A + "/data/port.json"),
    loadJSON(A + "/data/windcur.json"),
    loadJSON(A + "/data/portchip.json"),
    loadJSON(A + "/text/colony.json"),
    loadJSON(A + "/text/item_mes.json"),
    loadJSON(A + "/data/commands.json"),
    loadJSON(A + "/data/worldmap.json"),
    loadJSON(A + "/data/sea.json"),
    loadJSON(A + "/data/battle.json"),
    loadJSON(A + "/data/fleet.json"),
    loadDuelAssets(A, loadBinary, loadJSON),
    loadJSON(A + "/data/monster.json"),
  ]);
  const za = decodeZaDatJson(zaJson);
  const map = decodePortMapJson(mapJson);
  const wind = decodeWindCurJson(windJson);
  const worldmap = decodeWorldMapJson(worldmapJson);
  const monster = decodeMonsterJson(monsterJson);
  data.bld2 = await loadJSON(A + "/data/buildings2.json");
  // 预载全部场景 PNG 图集，确保港口 / 海上 / 海战 / 赌博零延迟呈现
  if (ctx.art) {
    const sheets = [
      "portchip_0", "portchip_1", "portchip_2", "portchip_3", "portchip_4", "portchip_5", "portchip_6",
      "chars", "seachip", "sea_ships", "compass", "seacompass",
      "naval_battle", "battle_ships", "battle_fx_lg", "battle_fx_sm", "battle_ball",
      "dials", "supply_icons", "gamble_cards", "gamble_dice", "hud_buttons",
    ];
    await ctx.art.preloadUrls([
      ...sheets.map(s => ctx.art.sheetUrl(s)),
      ...sheets.map(s => ctx.art.hdSheetUrl(s)),
      ...sheets.map(s => ctx.art.hdSheetNormalUrl(s)),
      ...sheets.map(s => ctx.art.hdSheetMatUrl(s)),
    ]);
    const dm = ctx.art.manifest?.duel;
    if (dm) {
      const duelUrls = [
        dm.decks?.sea?.path,
        dm.decks?.port?.path,
        dm.rails?.left?.path,
        dm.rails?.right?.path,
        ...Object.values(dm.fighters ?? {}).map(f => f.path),
      ].filter(Boolean).map(p => `${ctx.art.baseUrl}/${p}`);
      await ctx.art.preloadUrls(duelUrls);
    }
  }
  return {
    za, map, data, wind,
    chipNo: portchipMeta.chipNo,
    tilesets: portchipMeta.tilesets,
    colony, itemMes, commands, worldmap, sea, fleet, battle, duel, monster,
  };
}

export class PortScene {
  // ctx: 游戏共用对象 (scr, sys, state, con, win, menu, graph, palette, message, printf, bgm, font)
  // P: loadPortAssets() 的结果
  constructor(ctx, P) {
    this.c = ctx; this.P = P;
    const F = P.data.fmt; this.F = {}; for (const k in F) this.F[k] = pHex(F[k]);
    this.months = P.data.months.map(pHex); this.nations = P.data.nations.map(pHex); this.goods = P.data.goods.map(pHex);
    this.cache = new Int16Array(P_VIEW * P_VIEW).fill(-1);
    this.door = new Uint8Array(24);       // DS:0904
    this.bd78 = new Uint8Array(4);
    this.phase = 0;                        // [8b0a]
    this.toggle = 0;                       // [8b1e]
    this.talkCool = 10;                    // [8b08]
    this.needle = 0xff;                    // [8c1d]
    this.cursor = 0xffff;                  // [06d6]
    this.bdba = 0;
    this.tileCache = new Map();
  }
  get st() { return this.c.state; }
  get m() { return this.c.state.model; }
  get port() { return this.m.globals.port; }
  // ---- 状态字段 (具名访问) ----
  get vx() { return pS16(this.m.globals.portViewX); } set vx(v) { this.m.globals.portViewX = v; }
  get vy() { return pS16(this.m.globals.portViewY); } set vy(v) { this.m.globals.portViewY = v; }
  get hx() { return pS16(this.m.globals.heroWinX); } set hx(v) { this.m.globals.heroWinX = v; }
  get hy() { return pS16(this.m.globals.heroWinY); } set hy(v) { this.m.globals.heroWinY = v; }
  npc(i) { return getPortNpc(this.m, i); }
  setNpc(i, k, v) { setPortNpc(this.m, i, k, v); }
  get time() { return this.c.rt.time; }

  // ================= 进港 seg0:8c53 =================
  async enter() {
    const { palette, sys, graph, state: st } = this.c, g = this.m.globals;
    if (palette.ending) { await palette.fadeBlack(); return; }
    if (g.lastPort !== this.port) {
      this.loadZa();                                                  // 88a7
      if (g.lastPort === GameConst.EMPTY_SLOT) {
        const ex = this.door[6], ey = this.door[7];                   // [090a]/[090b] = 第 3 个入口 (码头)
        this.vy = ey - 13; this.vx = ex - 12;
        if (this.vx < 0) this.vx = 0; else if (this.vx >= 0x48) this.vx = 0x48;
        if (this.vy < 0) this.vy = 0; else if (this.vy >= 0x48) this.vy = 0x48;
        this.hx = ex - this.vx; this.hy = ey - this.vy + 1;
        this.initNpcs();                                              // 8b3b
      }
      g.lastPort = this.port;
      this.talkCool = 10;
    } else this.loadZa();                                             // (移植版没有常驻的 DS:0904, 每次进港重新取得)
    await palette.fadeBlack();
    this.loadPort();                                                  // 88e9 (先淡黑再切换港图缓冲，避免进港瞬间闪出错位图块)
    sys.mouseHide();
    this.toggle = 0;
    this.c.scr.clear(0);
    this.bdba = this.vy * P_MAP_W + this.vx;
    palette.selectTimePalette(this.time, false, g.weather);          // 0fea:98ce = 1976e (先设置目标调色盘供 HD 文字取色)
    this.redraw();                                                    // 0fea:b303 = 1b1a3
    this.panels();                                                    // 8894
    this.c.scr.setAtmosphere?.({ active: true, atSea: false });
    this.c.scr.wideDialog = null;
    this.c.scr.wideRenderer = (ctx, scr) => renderWidePort(ctx, scr, this);
    this.needle = 0xff;
    this.portBgm();                                                   // 0fea:b516 = 1b3b6
    sys.mouseShow();
    await palette.fadeToTarget();
  }
  // 88a7: ZA_DAT.DAT 第 min(港,100) 笔 24 bytes → DS:0904
  loadZa() { const k = Math.min(this.port, 100) * 24; this.door.set(this.P.za.subarray(k, k + 24)); }
  // 88e9: 图块组 (CHIP_NO.DAT) / 参数 bd78 / 地图; 港口编号 >= 100 用第 3 组与第 100 张
  loadPort() {
    const p = this.port, set = p < 100 ? this.P.chipNo[p] : 3;
    this.chipSetName = `portchip_${set}`;
    this.bd78.set(this.P.tilesets[set]);
    const m = p < 100 ? p : 100; this.map = this.P.map.subarray(m * 0x2400, (m + 1) * 0x2400);
    this.tileCache.clear();
  }
  // 8b3b: 行人初始位置 (各入口旁); 白天且港口所属国对主角国籍有标志 0x10 且主角站在码头入口下方时, 码头两侧加 3 名卫兵
  initNpcs() {
    const D = this.door;
    for (let si = 0, di = 0; si < 4; si++) {
      if (si === 3) di++;
      const k = (di + si) * 2, x = D[k], y = D[k + 1];
      this.setNpc(si, 0, x - 2); this.setNpc(si, 1, y + 1); this.setNpc(si, 2, 2);
      this.setNpc(si + 4, 0, x + 2); this.setNpc(si + 4, 1, y + 1); this.setNpc(si + 4, 2, si);
      if (si === 2) { this.setNpc(si, 0, x); this.setNpc(si, 1, y); this.setNpc(si + 4, 0, 0xff); this.setNpc(si + 4, 1, 0xff); }
    }
    const m = this.m, nation = m.port(this.port).region & 7;
    if (this.night() || nation >= 6) return;
    const di = m.heroPerson().face & 15;
    if (!(m.country(nation).getTreaties(di) & TreatyFlag.BLOCKADE)) return;
    if (this.door[6] - this.hx !== this.vx) return;
    if (this.door[7] - this.hy - this.vy + 1 !== 0) return;
    for (let si = 0; si < 3; si++) {
      this.setNpc(si + 4, 0, (si - 1) * 2 + this.door[6]);
      this.setNpc(si + 4, 1, (si % 2) + this.door[7] + 2);
      this.setNpc(si + 4, 2, 2);
    }
  }
  // 615d 夜间 (时刻 < 12 或 >= 60)
  night() { const t = this.time; return t < 12 || t >= 0x3c; }
  // 1b3b6 依地区播放港口音乐
  portBgm() {
    const T = [0, 0, 0, 1, 2, 1, 1, 1, 1, 2, 3, 4, 4];               // 堆栈上的 13 bytes 表
    const song = this.port < 100 ? T[this.m.portEconomy(this.port).priceRegion] + 10 : 15;
    this.c.bgm.playSong(song);
  }

  // ================= 绘图 (现代 PNG 图集 + HD 2D Canvas) =================
  drawTileAt(t, dx, dy) {
    this.c.art?.drawSheetTile(this.c.scr, this.chipSetName || "portchip_0", t, dx, dy);
  }
  // 2103 清除图块缓存
  clearCache() { this.cache.fill(-1); }
  // 1fac 画地图窗口 (只重画缓存中编号不同的格)
  drawMap() {
    const M = this.map;
    for (let r = 0; r < P_VIEW; r++) for (let c = 0; c < P_VIEW; c++) {
      const t = M[(this.bdba + r * P_MAP_W + c) & 0xffff], k = r * P_VIEW + c;
      if (this.cache[k] === t) continue;
      this.cache[k] = t;
      this.drawTileAt(t, P_VIEW_X + c * 16, P_VIEW_Y + r * 16);
    }
  }
  // 2119 使 2×2 格的缓存失效
  invalidate(k) { for (const d of [0, 1, P_VIEW, P_VIEW + 1]) if (k + d < this.cache.length) this.cache[k + d] = -1; }
  // 5f6a 在窗口座标 (x,y) 画 2×2 格透明精灵 (chars.png: 主角 0..47, 行人 48..71)
  drawFigure(x, y, off) {
    const M = this.map, i = (y + this.vy) * P_MAP_W + x + this.vx;
    const dx = (x + 6) * 16, dy = y * 16 + 8;
    this.drawTileAt(M[i], dx, dy);
    this.drawTileAt(M[i + 1], dx + 16, dy);
    this.drawTileAt(M[i + 0x60], dx, dy + 16);
    this.drawTileAt(M[i + 0x61], dx + 16, dy + 16);
    const localIdx = Math.floor(off / 0x280);
    const globalIdx = localIdx < 8 ? this.m.globals.hero * 8 + localIdx : 48 + (localIdx - 8);
    this.c.art?.drawSheetTile(this.c.scr, "chars", globalIdx, dx, dy, { transparent: true });
    this.invalidate(y * P_VIEW + x);
  }
  // 60e0 主角 (每次调用切换走路相位)
  drawHero(x, y, dir) {
    this._lastDir = dir;
    this.phase ^= 0x280;
    this.drawFigure(x, y, dir * 0x500 + this.phase);
    this.invalidate(y * P_VIEW + x);
  }
  // 1b1a3 重画地图与主角
  redraw() {
    this.c.scr.wideDialog = null;
    this.c.scr.wideOverlays.length = 0;
    this.clearCache();
    this.drawMap();
    this.drawHero(this.hx, this.hy, 2);
    if (this.port !== 0xff) this.c.scr.wideRenderer = (ctx, scr) => renderWidePort(ctx, scr, this);
    this.c.scr.dirty = true;
  }
  // 9453 罗盘指针 (compass.png)
  needleDraw(base) {
    const n = this.needle; if (n === 0xff) return;
    const col = n === 1 ? 0x45 : n === 3 ? 0x3f : 0x42, y = n === 0 ? 0x130 : n === 2 ? 0x170 : 0x150;
    this.c.art?.drawSheetTile(this.c.scr, "compass", n + base, col * 8, y);
  }
  // 94fa
  compass(dir) {
    if (this.needle === dir) return;
    const { sys } = this.c;
    sys.mouseHide();
    this.needleDraw(0);
    if (this.m.globals.options & 1) { this.needle = dir; this.needleDraw(4); } else this.needle = 0xff;
    sys.mouseShow();
  }
  // 8894 = 869f × 2
  panels() { const s = this.c.sys; s.mouseHide(); this.panel(); this.panel(); s.mouseShow(); this.c.hud?.updatePort(this); }
  // 869f 日期 / 时刻 / 声望 / 现金 / 港口情报
  panel() {
    if (this.c.scr.wideRenderer) return;
    const { con, printf, message } = this.c, m = this.m, g = m.globals, F = this.F, rt = this.c.rt, P = this.port;
    con.puts(F.color);
    con.setCursor(6, 0x10); printf(F.year, rt.year + 1);
    con.setCursor(3, 0x28); printf(F.date, this.months[rt.month], rt.day + 1);
    con.setCursor(1, 0x90);
    const t = rt.time;
    printf(F.clock, ((Math.floor(t / 3) + 11) % 12) + 1, (t % 3) * 20, t >= 0x24 ? 0x50 : 0x41);
    con.left = 5; con.lineH = 0x28; con.right = 0x4f;
    const hd = m.heroInfo();
    let fame = hd.tradeFame; if (hd.pirateFame > fame) fame = hd.pirateFame; if (hd.adventureFame > fame) fame = hd.adventureFame;
    con.setCursor(6, 0xf8); printf(F.fame, fame);
    con.setCursor(5, 0x140);
    const money = g.money;
    printf(F.money, money % 10000, Math.trunc(money / 10000));       // 金币 = 余数, 金块 = 万位
    con.lineH = 0x10; con.left = 0x3d; con.setCursor(0x3d, 8);
    if (P < 100) { message(0x181 + m.portEconomy(P).priceRegion); con.puts(F.empty); } else con.puts(F.supply);
    this.c.scr.fillCols(0x3d, 0x18, 0x12, 0x10, 7);
    printf(F.portName, m.port(P).nameBytes);
    if (P < 100) {
      con.left = 0x46; con.lineH = 0x20;
      const E = m.portEconomy(P);
      con.setCursor(0x46, 0x60);
      let sum = 0; for (let i = 0; i < 10; i++) sum += E.getPrices(i);
      printf(F.economy, pS16(E.commerce), E.commerceInvest, pS16(E.industry), E.industryInvest, Math.trunc(sum / 10) + 50);
    }
    con.lineH = 0x18;
  }
  // 8dfd 建筑内部底图 (地图窗口区以点阵填满)
  wallpaper(mode) {
    const s = this.c.scr, g = this.c.gfx;
    for (let r = 0; r < 6; r++) for (let k = 0; k < 3; k++) {
      s.glyphMode(k * 16 + 12, r * 64 + 8, 8, 0x40, g.subarray(0x3ca0), mode);
      s.glyphMode(k * 16 + 20, r * 64 + 40, 8, 0x20, g.subarray(0x3ca0), mode);
      s.glyphMode(k * 16 + 20, r * 64 + 8, 8, 0x20, g.subarray(0x3da0), mode);
    }
  }
  // 8ebc 进入建筑: 现代 DOM 模式下保持干净的 16:9 港口底图，不再在后方 Canvas 弹出老黑蓝建筑框
  async interior(k) {
    const { scr, art } = this.c;
    if (hasDom()) {
      scr.wideRenderer = (ctx, s) => renderWidePort(ctx, s, this);
      scr.dirty = true;
      return;
    }
    const picId = k === 10 && this.colonyChurch() ? 0x14 : k + 6;
    const entry = art?.graphEntry?.("GRAPH.DAT", picId);
    if (entry) await art.loadImage(`${art.baseUrl}/${entry.path}`);
    scr.wideRenderer = (ctx, s) => renderWideBuilding(ctx, s, this, k, picId);
    scr.dirty = true;
  }
  // 1fd9:ce07 CHIP_NO.DAT[港] == 2
  colonyChurch() { return this.port < 100 && this.P.chipNo[this.port] === 2; }

  // ================= 行人 =================
  // 6241 是否在窗口外
  outOfView(x, y) { return !(this.vx <= x && this.vx + 0x17 > x && this.vy <= y && this.vy + 0x17 > y); }
  // 6116 / 6076 可否通行: 0 = 可以
  blockedAt(i) {
    const M = this.map, [, P1, P2, P3] = this.bd78, m0 = M[i], m1 = M[i + 1];
    if (m0 >= P2) return 1;
    if (m1 >= P1 && m1 < P2) return 1;
    if (m1 >= P3) return 1;
    return 0;
  }
  heroBlocked() { return this.blockedAt((this.hy + this.vy) * P_MAP_W + this.hx + this.vx + P_MAP_W); }
  // 6172 (x,y) 是否撞到其他行人 / 主角; 返回 0 或 行人编号+1 (站立的卫兵返回 7)
  collide(self, x, y) {
    if (this.night()) return 0;
    for (let b = 0; b < 8; b++) {
      if (b === self) continue;
      const n = this.npc(b);
      if (n.x - 1 <= x && n.x + 1 >= x && n.y - 1 <= y && n.y + 1 >= y) return b > 3 && n.d === 2 ? 7 : b + 1;
    }
    if (self === -1) return 0;
    const hx = this.hx + this.vx, hy = this.hy + this.vy;
    if (hx >= x - 1 && hx <= x + 1 && hy >= y - 1 && hy <= y + 1) return 1;
    return 0;
  }
  // 6269 行人: 站立者原地动画, 走动者随机移动
  npcs() {
    if (this.night()) { this.initNpcs(); return; }
    const rng = this.c.sys.rng;
    const frames = (this._npcFrames ??= [0, 0, 0, 0]);
    for (let si = 4; si < 8; si++) {
      const n = this.npc(si);
      if (this.outOfView(n.x, n.y)) {
        frames[si - 4] = (this.toggle ^ si) & 1;
        continue;
      }
      const f = rng.random(2);
      frames[si - 4] = f;
      const fr = f + (n.d + 12) * 2;
      this.drawFigure(n.x - this.vx, n.y - this.vy, fr * 0x280);
    }
    for (let di = 0; di < 4; di++) {
      const n = this.npc(di);
      let x = n.x, y = n.y;
      const dir = rng.random(10) === 0 ? rng.random(4) : n.d;
      if (rng.random(3) === 0) {
        if (dir & 1) x = dir === 1 ? n.x + 1 : n.x - 1;
        else y = dir === 0 ? n.y - 1 : n.y + 1;
      }
      const set = (di & 1) * 4 + dir + 4;
      let nd;
      if (!this.collide(di, x, y) && (x & 0xffff) < 0x5e && (y & 0xffff) < 0x5e && !this.blockedAt((y + 1) * P_MAP_W + x)) {   // 63c1 / 63c7: word 无号比较 (x 或 y 从 0 减 1 = FFFF 时不能走)
        if (!this.outOfView(x, y)) this.drawFigure(x - this.vx, y - this.vy, set * 0x500 + (((x + y) & 1) === 0 ? 0x280 : 0));
        this.setNpc(di, 0, x); this.setNpc(di, 1, y);
        nd = dir;
      } else {
        if (!this.outOfView(n.x, n.y)) this.drawFigure(n.x - this.vx, n.y - this.vy, set * 0x500 + (((n.x + n.y) % 2) === 0 ? 0x280 : 0));
        nd = (rng.random(3) + dir - 1) & 3;
      }
      this.setNpc(di, 2, nd);
    }
  }
  // 64c6 与行人交谈
  async talk(code) {
    const { sys, win, menu, message, scr, codec } = this.c, m = this.m, P = this.port, port = m.port(P);
    const nation = port.region & 7;
    const emit = () => {
      switch (code) {
        case 1: message(0x282 + P); break;
        case 2: message((this.c.rt.day % 10) + 0x276); break;
        case 3: {
          const cache = m.usedShipCache(0); let k = 0;
          while (k < 5 && cache.getShipTypes(k) === GameConst.EMPTY_SLOT) k++;
          if (k < 5) message(0x280, m.ship(cache.getShipTypes(k) + 40).nameBytes); else message(0x281);
          break; }
        case 4: message(nation + 0x26f); break;
        case 5:
          if (P >= 100) { message(0x242, port.nameBytes); break; }
          if (this.isCapital()) { message(0x243, this.nations[nation], port.nameBytes); break; }
          if (nation !== 6) message(0x244, this.nations[nation], port.region & 0x80 ? this.F.colony : this.F.ally, port.nameBytes);
          else message(0x245, port.nameBytes);
          break;
        case 6: message((P % 3) + 0x26b); break;
        case 7: message(0x26e, this.nations[m.heroPerson().face & 15]); break;
        case 8: {
          message(0x268);
          const g = m.portEconomy(P).specialtyGood;
          if (g !== GameConst.EMPTY_SLOT) message(0x269, this.goods[g]); else message(0x26a);
          break; }
      }
    };
    if (scr.wideRenderer && codec) {
      scr.wideDialog = { text: captureConsoleText(this.c, emit), portraitId: null, waiting: false };
      scr.dirty = true;
      sys.flush();
      await menu.waitPrompt();
      scr.wideDialog = null;
      scr.dirty = true;
      return;
    }
    sys.mouseHide();
    win.shadowedSaved(0x10, 0xa0, 0x24, 0x80, 0);
    emit();
    sys.flush();
    sys.mouseShow();
    await menu.waitPrompt();
    sys.mouseHide();
    await win.close();
    sys.mouseShow();
  }
  // 0fea:b578 = 1b418: 本港是否为某国首都
  isCapital() { for (let i = 0; i < 6; i++) if (this.m.country(i).capitalPort === this.port) return true; return false; }

  // ================= 主角移动 66be =================
  async move(dir) {
    const { sys } = this.c;
    const dx = dir === 1 ? 1 : dir === 3 ? -1 : 0, dy = dir === 2 ? 1 : dir < 1 ? -1 : 0;
    let face = dir;
    const ox = this.hx, oy = this.hy;
    let di = dx, si = dy;
    moved: {
      if (ox + dx < 0 || ox + dx >= 0x17 || oy + dy < 0 || oy + dy >= 0x17) break moved;
      this.oldVy = this.vy; this.oldVx = this.vx;
      const code = this.collide(-1, this.vx + ox + dx, oy + this.vy + dy);
      if (code && (code !== this.lastTalkCode || this.talkCool >= 3)) {
        await this.talk(code);
        this.lastTalkCode = code;
        this.talkCool = 0;
        return 0;
      }
      if (this.talkCool < 10) this.talkCool++;
      this.hx += dx; this.hy += dy;
      if (this.heroBlocked() || this.collide(-1, this.hx + this.vx, this.hy + this.vy)) {
        // 被挡住: 往两侧找最近的空隙 (各试 1..19 格)
        const tryside = sgn => {
          for (let k = 1; k < 20; k++) {
            this.hy = oy + sgn * dx * k; this.hx = ox + sgn * dy * k;
            let ax = this.hx + this.vx, ay = this.hy + this.vy;
            if (ax < 0 || ax >= 0x5f || ay < 0 || ay >= 0x5f) return 20;
            if (this.heroBlocked() || this.collide(-1, ax, ay)) return 20;
            ay += dy; ax += dx;
            if (ax < 0 || ax >= 0x5f || ay < 0 || ay >= 0x5f) return 20;
            this.hx += dx; this.hy += dy;
            if (!this.heroBlocked() && !this.collide(-1, this.hx + this.vx, this.hy + this.vy)) return k;
          }
          return 20;
        };
        const plus = tryside(1), minus = tryside(-1);
        if (plus === 20 && minus === 20) { this.hx = ox; this.hy = oy; si = dy; di = dx; }
        else {
          if (plus < minus) { di = dy; si = dx; } else { di = -dy; si = -dx; }
          this.hx = ox + di; this.hy = oy + si;
        }
      }
      // 靠近边缘时滚动窗口
      if ((di === -1 && this.hx < 4 && this.vx !== 0) || (di === 1 && this.hx > 0x12 && this.vx !== 0x48)) {
        this.hx -= di;
        if (this.vx + di >= 0 && this.vx + di < 0x49) this.vx += di;
      }
      if ((si === -1 && this.hy < 4 && this.vy !== 0) || (si === 1 && this.hy > 0x12 && this.vy !== 0x48)) {
        this.hy -= si;
        if (this.vy + si >= 0 && this.vy + si < 0x49) this.vy += si;
      }
      face = si < 0 ? 0 : si > 0 ? 2 : di >= 0 ? 1 : 3;
    }
    this.bdba = this.vy * P_MAP_W + this.vx;
    this.compass(face);
    this.toggle ^= 1;
    sys.mouseHide();
    this.drawMap();
    sys.flush();
    this.drawHero(this.hx, this.hy, face);
    this.npcs();
    sys.mouseShow();
    return 1;
  }
  // 6031 主角是否站在建筑入口
  doorAt() {
    const x = (this.hx + this.vx) & 0xff, y = (this.hy + this.vy) & 0xff;
    for (let k = 0; k < 12; k++) if (this.door[k * 2] === x && this.door[k * 2 + 1] === y) return k;
    return -1;
  }
  // 1b6ba 进入建筑的时刻限制
  isOpen(k) {
    const t = this.time;
    switch (k) {
      case 0: case 2: case 5: case 6: case 8: return t >= 12 && t < 0x3c;
      case 1: return t < 12 || t >= 0x18;
      case 9: if (t >= 0x18 && t < 0x3c) return true; return t >= 6 && t < 9;
      case 10: return t >= 12;
      case 11: return t >= 0x30;
      default: return true;
    }
  }
  // 1b6ba: 返回消耗的时间 (0 = 没有进入)
  async tryEnter() {
    const { sys, bgm } = this.c;
    const k = this.doorAt();
    if (k < 0) return 0;
    this.cursor = 0x2570; sys.setCursorShape(0x2570);
    if (!this.isOpen(k)) { await this.closed(); return 0; }
    const cost = sys.rng.random(3) + 2;
    await this.interior(k);
    if (k === 1) bgm.playSong(0x13); else if (k === 5) bgm.playSong(0x12);
    this.hy++;
    sys.mouseHide();
    // 剧本事件: 2e09:5481/53f0 (共用 SNR0), [0de6]=0 时 2e09:55c2/5546 (主角 SNRn); 返回 0 (命令 F8) 时不进入建筑处理
    let r1 = 1, r2 = 1;
    if (!this.c.noEvents) {
      const sc = (this.c.events ??= new Scenario(this.c)); sc.scene = this;       // ctx.scenario 是剧本档编号 (newgame.js)
      if (await sc.check(ENV_COMMON, this.port, k)) r1 = await sc.run(ENV_COMMON);
      if (!getWorkState(this.m).commonEvent && await sc.check(ENV_HERO, this.port, k)) r2 = await sc.run(ENV_HERO);
    }
    sys.mouseShow();
    if (!((r1 && r2) || k === 4)) { sys.mouseHide(); this.portBgm(); this.redraw(); sys.mouseShow(); return cost; }   // 1b7ef → 1b8ab
    sys.mouseHide();
    // 1b7fc: 港口所属国对主角声望不足时的入场检查 (码头/造船厂/教会/商馆?/10 号除外)
    const m = this.m, hd = m.heroInfo(), nation = m.port(this.port).region & 7;
    if (![5, 7, 3, 10].includes(k) && nation !== 6 && hd.getCountryStanding(nation) < 80) {
      if (sys.rng.random(3) === 0 && sys.rng.random(100) > hd.getCountryStanding(nation) + 20) {
        await this.refused(nation, hd);                                // 1b5c1
        if (this.port !== GameConst.EMPTY_SLOT) { this.portBgm(); this.redraw(); }
        sys.mouseShow(); return cost;
      }
      const b = (this.buildings ??= new Buildings(this));
      b.crewSpeaks();          // 909b 船员: 「这是%s的港口, 留点神」
      this.c.message(0x346, this.nations[nation]);
      await this.c.menu.waitPrompt(); await b.closeTalk();
    }
    await this.building(k);                                           // DS:a612[k]
    if (this.port !== GameConst.EMPTY_SLOT) { this.portBgm(); this.redraw(); }
    sys.mouseShow();
    return cost;
  }
  // 1b5c1 入场被拒: 可疑的人靠近 → 被包围; (主角 +21) + (主角 +25) × (+21) / 100 ≥ random(150) 时逃脱,
  //   否则没收 3/4 现金, 而且对该国声望 **加** 20 (原版写 add byte [H+6+国], 14h; 照搬); 现金改变后不重画面板 (之后的 1b1a3 才重画)
  async refused(nation, hd) {
    const b = (this.buildings ??= new Buildings(this)), { sys, message, menu } = this.c, m = this.m, hero = m.heroPerson();
    b.crewSpeaks(); message(0x347); await menu.waitPrompt(); await b.closeTalk();
    b.greet(0x348, hero.familyNameBytes); await menu.waitPrompt();
    let si = hero.getStats(5);
    b.talkPerson(m.globals.hero);
    const r = sys.rng.random(150);
    si = (si + Math.trunc((hero.battleLevel * si) / 100)) & 0xffff;
    if (si < r) {
      message(0x349); await menu.waitPrompt();
      b.greet(0x34d); await menu.waitPrompt();
      b.money = (b.money - Math.trunc(Math.imul(b.money, 3) / 4)) | 0;         // _ldiv(现金 × 3, 4)
      hd.setCountryStanding(nation, (hd.getCountryStanding(nation) + 20) & 0xff);
    } else {
      message(0x34a); await menu.waitPrompt(); await b.closeTalk();
      b.crewSpeaks(); message(0x34b); await menu.waitPrompt();
    }
    await b.closeTalk();
  }
  // 建筑内部 (1fd9 段, DS:a612[k]) — scenes/buildings.js
  async building(k) { return (this.buildings ??= new Buildings(this)).enter(k); }
  // 1b58d 关门了
  async closed() {
    const { sys, win, menu, message, scr, con, codec } = this.c;
    if (scr.wideRenderer && codec) {
      scr.wideDialog = { text: captureConsoleText(this.c, () => message(0x2fd)), portraitId: null, waiting: false };
      scr.dirty = true;
      await menu.waitPrompt();
      scr.wideDialog = null;
      scr.dirty = true;
      return;
    }
    sys.mouseHide();
    win.shadowedSaved(0x1c, 0x30, 0x14, 0x30, 0);
    message(0x2fd);
    await menu.waitPrompt();
    await win.close();
    sys.mouseShow();
  }

  // ================= 走路循环 1b966 =================
  // 210f1 读输入: 鼠标左键 = FF; 功能键换成指令按钮的代码
  readInput() {
    const { menu, sys } = this.c, src = menu.source();
    if (src === 1) return sys.mouseEvent() === 0x81 ? 0xff : 0;
    if (src !== 2) return 0;
    const k = sys.getKey();
    switch (k) { case 0x2d: case 0x02: return 0x2b; case 0x14: return 0x2a; case 0x16: return 0x2f; case 0x19: case 0x2b: return 0x3d; }
    return k;
  }
  // 1b8c8 画面按钮: 0..3 / 4..7 = 方向 1..4; 8..11 = 指令按钮 (scenes/commands.js), 返回 FF
  async buttons(key) {
    const m = this.c.sys.mouse;
    if (this.c.scr.wideRenderer && key === 0xff && m?.vx !== undefined) {
      const cmd = hitWideCommandButton(m.vx, m.vy, this.c.scr);
      if (cmd >= 0) {
        await (this.commands ??= new Commands(this)).button(cmd);
        return 0xff;
      }
    }
    const { x, y } = this.c.sys.mousePos(), B = this.P.data.buttons;
    // 先比对明确的 F1–F4 指令键，避免光标停留在旧版方向热区时吞掉快捷键
    if (key && key !== 0xff) {
      for (let i = 8; i < 12; i++) {
        if (B[i][4] === key) {
          await (this.commands ??= new Commands(this)).button(i - 8);
          return 0xff;
        }
      }
    }
    // 现代 DOM 模式：港内仅允许方向键 / 小键盘 8624 / WASD 移动，禁止鼠标位置决定方向与任意键沿用方向
    if (hasDom()) {
      if (!key || key === 0xff) return 0xff;
      switch (key) {
        case 0x1e: case 0x38: case 0x77: case 0x57: return 1;         // ↑ / 8 / W
        case 0x1c: case 0x36: case 0x64: case 0x44: return 2;         // → / 6 / D
        case 0x1f: case 0x32: case 0x73: case 0x53: return 3;         // ↓ / 2 / S
        case 0x1d: case 0x34: case 0x61: case 0x41: return 4;         // ← / 4 / A
        default: return 0xff;
      }
    }
    for (let i = 0; i < 12; i++) {
      const [x0, y0, x1, y1, k] = B[i];
      if (k !== key && !(x >= x0 && x1 >= x && y0 <= y && y1 >= y)) continue;
      if (key === 0) return 0;
      if (i < 8) return i >= 4 ? i - 3 : i + 1;
      await (this.commands ??= new Commands(this)).button(i - 8);    // DS:[a622 + i×4]: 情报/经营/命令/航海术
      return 0xff;
    }
    return 0xff;
  }
  async walk() {
    const { sys, palette } = this.c;
    const modern = hasDom();
    let face = 2, di = 0;                                           // 原版 di (方向) 跨循环保留；现代模式每次仅依明确方向键移动
    sys.mickeys();
    for (;;) {
      if (palette.ending) return 0;
      const key = this.readInput();
      const mk = sys.mickeys();
      sys.mousePos();
      if (!modern && (Math.abs(mk.h) > 8 || Math.abs(mk.v) > 8)) {
        if (Math.abs(mk.v) < Math.abs(mk.h)) di = mk.h >= 0 ? 2 : 4; else di = mk.v >= 0 ? 3 : 1;
      }
      if (this.pendingCmd !== undefined) {
        const cmd = this.pendingCmd; this.pendingCmd = undefined;
        await (this.commands ??= new Commands(this)).button(cmd);
        if (this.port === 0xff || this.timeAbort()) return 0;
        continue;
      }
      if (this.pmTarget !== undefined) {                              // 扩充功能 (非原版): 港内移动 — 瞬移到门口后照原版进门 (RE_NOTES 33.5)
        const k = this.pmTarget; this.pmTarget = undefined;
        sys.mouseHide(); PortMove.teleport(this, k); sys.mouseShow();
        const r = await this.tryEnter();
        if (r) return r;
        continue;
      }
      const b = await this.buttons(key);
      if (modern) di = (b >= 1 && b <= 4) ? b : 0;
      else if (b !== 0xff) di = b;
      if (this.port === 0xff) return 0;
      if (this.timeAbort()) return 0;                                 // 1b39a (读档后)
      const shape = P_CURSORS[modern ? 0 : di];
      if (shape !== this.cursor) { this.cursor = shape; sys.setCursorShape(shape); }
      sys.timer.set(this.m.globals.options & 1 ? 8 : 4);
      if (key && di) {
        face = di - 1;
        await this.move(di - 1);
        const r = await this.tryEnter();
        if (r) return r;
      } else {
        this.toggle ^= 1;
        sys.mouseHide();
        this.drawMap();
        this.drawHero(this.hx, this.hy, face);
        this.drawHero(this.hx, this.hy, face);
        this.npcs();
        this.c.scr.dirty = true;
        sys.mouseShow();
      }
      await sys.poll();
      while (sys.timer.get()) {
        if (this.pendingCmd !== undefined || this.pmTarget !== undefined || this.port === GameConst.EMPTY_SLOT) break;
        if (!key && this.c.menu.source()) break;
        await sys.poll();
      }
    }
  }
  // 1b39a 时间循环中止标志 (月/日/时刻 >= F0; 读档时设置)
  timeAbort() { const r = this.c.rt; return r.month >= 0xf0 || r.day >= 0xf0 || r.time >= 0xf0; }
  // 1bb07 港口行动: 返回消耗的时间
  async action() {
    const { palette, menu } = this.c;
    this.panels();
    for (;;) {
      if (palette.ending || this.port === 0xff || this.timeAbort()) return 0;
      await menu.waitRelease();
      const r = await this.walk();
      await menu.waitRelease();
      if (r) return r;
    }
  }
}
