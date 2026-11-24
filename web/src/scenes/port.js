// scenes/port.js — 港口場景 (MAIN.EXE seg0:5f0c..6a65, 869f..8c53, 8dfd..8f03, 9453..95f2 與 0FEA 段 1b1a3..1bb49)
// 原版變數對照 (DS):
//   視窗左上 (地圖格) cb4/cb6 (word, 存檔內)   主角在視窗內的位置 cb8/cba (word)   上次所在港 caf
//   行人 0cbc + i*3 {x, y, 方向/種類} i=0..3 走動, 4..7 站立   建築入口 0904 + k*2 {x, y} k=0..11 (ZA_DAT.DAT)
//   地圖偏移 bdba = cb6*96 + cb4   精靈動畫相位 8b0a (0 / 0x280)   8b1e 每步切換   8b08 交談冷卻   8c1d 羅盤指針
//   圖塊參數 bd78..bd7b (PORTCHIP 組 2n+1)   圖塊快取 cs:1b2c (24×24)
// 畫面: 地圖視窗 24×24 格 (每格 16×16) 位於 x=96, y=8; 精靈 = 2×2 格 (32×32)
//
// 與原版的差異 (尚未移植, 見 docs/RE_NOTES.md 第 15 節):
//   - 建築內部: 見 scenes/buildings.js (部分移植); 4 個指令按鈕見 scenes/commands.js
//   - 劇本事件 (2e09:5481/53f0/55c2/5546): 目前視為「沒有事件」
import { loadBinary, loadJSON } from "../core/assets.js";
import { Buildings } from "./buildings.js";
import { Commands } from "./commands.js";
import { Scenario, ENV_COMMON, ENV_HERO } from "../game/scenario.js";
import { loadDuelAssets } from "./duel.js";
import { PortMove } from "./portmove.js";

const pHex = s => { const b = Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16))), o = new Uint8Array(b.length + 1); o.set(b); return o; };
const P_MAP_W = 96, P_VIEW = 24, P_VIEW_X = 96, P_VIEW_Y = 8;
const P_CURSORS = [0x2570, 0x29f0, 0x28d0, 0x2690, 0x27b0];        // 1b966: 無 / ↑ / → / ↓ / ←
const pS16 = v => (v << 16) >> 16;

export async function loadPortAssets(ctx) {
  const A = ctx.ASSETS;
  const [za, chip, map, chr, compass, data, wind] = await Promise.all([
    loadBinary(A + "/data/za_dat.bin"), loadBinary(A + "/gfx/portchip.bin"), loadBinary(A + "/gfx/portmap.bin"),
    loadBinary(A + "/gfx/char.bin"), loadBinary(A + "/gfx/compass.bin"), loadJSON(A + "/data/port.json"), loadBinary(A + "/data/windcur.bin")]);
  const chipNo = (await loadJSON(A + "/data/portchip.json")).chipNo;
  const transit = await loadBinary(A + "/gfx/transit.bin");          // TRANSIT.DAT 船首像
  const colony = await loadJSON(A + "/text/colony.json"), itemMes = await loadJSON(A + "/text/item_mes.json");   // 發現物 / 隨身物說明
  const gamble = await loadBinary(A + "/gfx/gamble.bin");             // DATA1 #9 賭博圖形
  data.bld2 = await loadJSON(A + "/data/buildings2.json");            // 王宮/事務所/住宅/銀行/道具店 (tools/extract_buildings2.py)
  const commands = await loadJSON(A + "/data/commands.json");         // 指令按鈕常數 (tools/extract_commands.py)
  // 海上 (scenes/sea.js, tools/extract_sea.py): WORLDMAP 格碼、DATA1 #11 海上圖塊與船隻精靈、#7 羅盤指針、表與字串
  const [worldmap, seachip, seacompass, sea] = await Promise.all([loadBinary(A + "/gfx/worldmap.bin"), loadBinary(A + "/gfx/seachip.bin"),
    loadBinary(A + "/gfx/seacompass.bin"), loadJSON(A + "/data/sea.json")]);
  const [hdat, battle] = await Promise.all([loadBinary(A + "/gfx/hdat.bin"), loadJSON(A + "/data/battle.json")]);   // 海戰 (scenes/battle.js, tools/extract_battle.py)
  const fleet = await loadJSON(A + "/data/fleet.json");                // 月末 / 艦隊 AI 常數表與 NAME.TBL (tools/extract_fleet.py)
  const duel = await loadDuelAssets(A, loadBinary, loadJSON);         // 一騎打: DATA1 / IAP / IAE、DS 常數 (scenes/duel.js, tools/extract_duel.py)
  const monster = await loadBinary(A + "/data/monster.bin");          // MONSTER.DAT 原檔 (海上特殊地點的後續地點, 唯讀; RE_NOTES 36.2)
  return { za, chip, map, chr, compass, data, wind, chipNo, transit, colony, itemMes, gamble, commands, worldmap, seachip, seacompass, sea, fleet, hdat, battle, duel, monster };
}

export class PortScene {
  // ctx: 遊戲共用物件 (scr, sys, state, con, win, menu, graph, palette, message, printf, bgm, font)
  // P: loadPortAssets() 的結果
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
  get port() { return this.st.u8(0x0cae); }
  // ---- 狀態欄位 (DS 位址) ----
  get vx() { return pS16(this.st.u16(0x0cb4)); } set vx(v) { this.st.set16(0x0cb4, v); }
  get vy() { return pS16(this.st.u16(0x0cb6)); } set vy(v) { this.st.set16(0x0cb6, v); }
  get hx() { return pS16(this.st.u16(0x0cb8)); } set hx(v) { this.st.set16(0x0cb8, v); }
  get hy() { return pS16(this.st.u16(0x0cba)); } set hy(v) { this.st.set16(0x0cba, v); }
  npc(i) { const a = 0x0cbc + i * 3; return { x: this.st.u8(a), y: this.st.u8(a + 1), d: this.st.u8(a + 2) }; }
  setNpc(i, k, v) { this.st.set8(0x0cbc + i * 3 + k, v); }
  get time() { return this.c.rt.time; }

  // ================= 進港 seg0:8c53 =================
  async enter() {
    const { palette, sys, graph, state: st } = this.c;
    if (palette.ending) { await palette.fadeBlack(); return; }
    if (st.u8(0x0caf) !== this.port) {
      this.loadZa();                                                  // 88a7
      if (st.u8(0x0caf) === 0xff) {
        const ex = this.door[6], ey = this.door[7];                   // [090a]/[090b] = 第 3 個入口 (碼頭)
        this.vy = ey - 13; this.vx = ex - 12;
        if (this.vx < 0) this.vx = 0; else if (this.vx >= 0x48) this.vx = 0x48;
        if (this.vy < 0) this.vy = 0; else if (this.vy >= 0x48) this.vy = 0x48;
        this.hx = ex - this.vx; this.hy = ey - this.vy + 1;
        this.initNpcs();                                              // 8b3b
      }
      st.set8(0x0caf, this.port);
      this.talkCool = 10;
    } else this.loadZa();                                             // (移植版沒有常駐的 DS:0904, 每次進港重新取得)
    this.loadPort();                                                  // 88e9
    await palette.fadeBlack();
    sys.mouseHide();
    this.toggle = 0;
    const n = st.options & 0x80 ? 3 : 5;
    graph.draw8(n, 0, 0); graph.draw8(n, 0, 0);
    this.bdba = this.vy * P_MAP_W + this.vx;
    this.redraw();                                                    // 0fea:b303 = 1b1a3
    this.panels();                                                    // 8894
    palette.selectTimePalette(this.time, false, st.weather);          // 0fea:98ce = 1976e
    this.needle = 0xff;
    this.portBgm();                                                   // 0fea:b516 = 1b3b6
    sys.mouseShow();
    await palette.fadeToTarget();
  }
  // 88a7: ZA_DAT.DAT 第 min(港,100) 筆 24 bytes → DS:0904
  loadZa() { const k = Math.min(this.port, 100) * 24; this.door.set(this.P.za.subarray(k, k + 24)); }
  // 88e9: 圖塊組 (CHIP_NO.DAT) / 參數 bd78 / 地圖; 港口編號 >= 100 用第 3 組與第 100 張
  loadPort() {
    const p = this.port, set = p < 100 ? this.P.chipNo[p] : 3, base = set * (0x7800 + 4);
    this.chip = this.P.chip.subarray(base, base + 0x7800);
    this.bd78.set(this.P.chip.subarray(base + 0x7800, base + 0x7804));
    const m = p < 100 ? p : 100; this.map = this.P.map.subarray(m * 0x2400, (m + 1) * 0x2400);
    const h = this.st.hero; this.chr = new Uint8Array(0x1400 + 0x3c00);
    this.chr.set(this.P.chr.subarray(h * 0x1400, (h + 1) * 0x1400)); this.chr.set(this.P.chr.subarray(6 * 0x1400), 0x1400);
    this.tileCache.clear();
  }
  // 8b3b: 行人初始位置 (各入口旁); 白天且港口所屬國對主角國籍有旗標 0x10 且主角站在碼頭入口下方時, 碼頭兩側加 3 名衛兵
  initNpcs() {
    const D = this.door;
    for (let si = 0, di = 0; si < 4; si++) {
      if (si === 3) di++;
      const k = (di + si) * 2, x = D[k], y = D[k + 1];
      this.setNpc(si, 0, x - 2); this.setNpc(si, 1, y + 1); this.setNpc(si, 2, 2);
      this.setNpc(si + 4, 0, x + 2); this.setNpc(si + 4, 1, y + 1); this.setNpc(si + 4, 2, si);
      if (si === 2) { this.setNpc(si, 0, x); this.setNpc(si, 1, y); this.setNpc(si + 4, 0, 0xff); this.setNpc(si + 4, 1, 0xff); }
    }
    const st = this.st, nation = st.u8(0x5f54 + this.port * 0x16 + 0x15) & 7;
    if (this.night() || nation >= 6) return;
    const di = st.u8(st.personRecord(st.hero) + 0x31) & 15;
    if (!(st.u8(0x117a + nation * 0x20 + di + 0x12) & 0x10)) return;
    if (this.door[6] - this.hx !== this.vx) return;
    if (this.door[7] - this.hy - this.vy + 1 !== 0) return;
    for (let si = 0; si < 3; si++) {
      this.setNpc(si + 4, 0, (si - 1) * 2 + this.door[6]);
      this.setNpc(si + 4, 1, (si % 2) + this.door[7] + 2);
      this.setNpc(si + 4, 2, 2);
    }
  }
  // 615d 夜間 (時刻 < 12 或 >= 60)
  night() { const t = this.time; return t < 12 || t >= 0x3c; }
  // 1b3b6 依地區播放港口音樂
  portBgm() {
    const T = [0, 0, 0, 1, 2, 1, 1, 1, 1, 2, 3, 4, 4];               // 堆疊上的 13 bytes 表
    const song = this.port < 100 ? T[this.st.u8(0x6a80 + this.port * 0x25 + 0x21)] + 10 : 15;
    this.c.bgm.playSong(song);
  }

  // ================= 繪圖 =================
  // 圖塊 t 的 16×16 索引像素 (原版每塊 128 bytes, 4 平面依序, 每平面 16 行 × 2 bytes)
  tile(t) {
    let px = this.tileCache.get(t); if (px) return px;
    px = new Uint8Array(256); const o = t * 128, C = this.chip;
    for (let p = 0; p < 4; p++) for (let r = 0; r < 16; r++) for (let b = 0; b < 2; b++) {
      const v = C[o + p * 32 + r * 2 + b];
      for (let i = 0; i < 8; i++) if ((v >> (7 - i)) & 1) px[r * 16 + b * 8 + i] |= 1 << p;
    }
    this.tileCache.set(t, px); return px;
  }
  put16(col, y, px) {
    const fb = this.c.scr.fb;
    for (let r = 0; r < 16; r++) fb.set(px.subarray(r * 16, r * 16 + 16), (y + r) * 640 + col * 8);
    this.c.scr.dirty = true;
  }
  // 2103 清除圖塊快取
  clearCache() { this.cache.fill(-1); }
  // 1fac 畫地圖視窗 (只重畫快取中編號不同的格)
  drawMap() {
    const M = this.map;
    for (let r = 0; r < P_VIEW; r++) for (let c = 0; c < P_VIEW; c++) {
      const t = M[(this.bdba + r * P_MAP_W + c) & 0xffff], k = r * P_VIEW + c;
      if (this.cache[k] === t) continue;
      this.cache[k] = t;
      this.put16((P_VIEW_X >> 3) + c * 2, P_VIEW_Y + r * 16, this.tile(t));
    }
  }
  // 2119 使 2×2 格的快取失效
  invalidate(k) { for (const d of [0, 1, P_VIEW, P_VIEW + 1]) if (k + d < this.cache.length) this.cache[k + d] = -1; }
  // 5f0c 一格: 底圖 + 精靈 (每平面 先 AND 遮罩 再 OR 圖像; 遮罩 16 行 × 2 bytes 對 4 平面共用)
  quad(t, col, y, off) {
    const base = this.tile(t), px = new Uint8Array(256), S = this.chr;
    for (let r = 0; r < 16; r++) for (let b = 0; b < 2; b++) {
      const m = S[off + 0x80 + r * 2 + b];
      const ip = [S[off + r * 2 + b], S[off + 32 + r * 2 + b], S[off + 64 + r * 2 + b], S[off + 96 + r * 2 + b]];
      for (let i = 0; i < 8; i++) {
        const sh = 7 - i, k = r * 16 + b * 8 + i;
        const img = ((ip[0] >> sh) & 1) | (((ip[1] >> sh) & 1) << 1) | (((ip[2] >> sh) & 1) << 2) | (((ip[3] >> sh) & 1) << 3);
        px[k] = (((m >> sh) & 1) ? base[k] : 0) | img;
      }
    }
    this.put16(col, y, px);
  }
  // 5f6a 在視窗座標 (x,y) 畫 2×2 格精靈 (精靈資料位移 off)
  drawFigure(x, y, off) {
    const M = this.map, i = (y + this.vy) * P_MAP_W + x + this.vx, col = (x + 6) * 2, py = y * 16 + 8;
    this.quad(M[i], col, py, off);
    this.quad(M[i + 1], col + 2, py, off + 0xa0);
    this.quad(M[i + 0x60], col, py + 16, off + 0x140);
    this.quad(M[i + 0x61], col + 2, py + 16, off + 0x1e0);
    this.invalidate(y * P_VIEW + x);
  }
  // 60e0 主角 (每次呼叫切換走路相位)
  drawHero(x, y, dir) {
    this.phase ^= 0x280;
    this.drawFigure(x, y, dir * 0x500 + this.phase);
    this.invalidate(y * P_VIEW + x);
  }
  // 1b1a3 重畫地圖與主角
  redraw() {
    this.clearCache();
    this.drawMap();
    this.drawHero(this.hx, this.hy, 2);
  }
  // 9453 羅盤指針 (5 欄 × 24 行, DATA1 #6)
  needleDraw(base) {
    const n = this.needle; if (n === 0xff) return;
    const col = n === 1 ? 0x45 : n === 3 ? 0x3f : 0x42, y = n === 0 ? 0x130 : n === 2 ? 0x170 : 0x150;
    const off = (n + base) * 0x1e0;
    this.c.scr.putPlanar(col, y, 5, 0x18, this.P.compass, off);
    this.c.scr.putPlanar(col, y, 5, 0x18, this.P.compass, off);
  }
  // 94fa
  compass(dir) {
    if (this.needle === dir) return;
    const { sys, state } = this.c;
    sys.mouseHide();
    this.needleDraw(0);
    if (state.options & 1) { this.needle = dir; this.needleDraw(4); } else this.needle = 0xff;
    sys.mouseShow();
  }
  // 8894 = 869f × 2
  panels() { const s = this.c.sys; s.mouseHide(); this.panel(); this.panel(); s.mouseShow(); }
  // 869f 日期 / 時刻 / 聲望 / 現金 / 港口情報
  panel() {
    const { con, printf, message } = this.c, st = this.st, F = this.F, rt = this.c.rt, P = this.port;
    con.puts(F.color);
    con.setCursor(6, 0x10); printf(F.year, rt.year + 1);
    con.setCursor(3, 0x28); printf(F.date, this.months[rt.month], rt.day + 1);
    con.setCursor(1, 0x90);
    const t = rt.time;
    printf(F.clock, ((Math.floor(t / 3) + 11) % 12) + 1, (t % 3) * 20, t >= 0x24 ? 0x50 : 0x41);
    con.left = 5; con.lineH = 0x28; con.right = 0x4f;
    const H = 0x125a + st.hero * 0x0e;
    let fame = st.u16(H); if (st.u16(H + 2) > fame) fame = st.u16(H + 2); if (st.u16(H + 4) > fame) fame = st.u16(H + 4);
    con.setCursor(6, 0xf8); printf(F.fame, fame);
    con.setCursor(5, 0x140);
    const money = (st.u16(0x12ae) | (st.u16(0x12b0) << 16)) | 0;
    printf(F.money, money % 10000, Math.trunc(money / 10000));       // 金幣 = 餘數, 金塊 = 萬位
    con.lineH = 0x10; con.left = 0x3d; con.setCursor(0x3d, 8);
    if (P < 100) { message(0x181 + st.u8(0x6a80 + P * 0x25 + 0x21)); con.puts(F.empty); } else con.puts(F.supply);
    this.c.scr.fillCols(0x3d, 0x18, 0x12, 0x10, 7);
    printf(F.portName, st.portName(P));
    if (P < 100) {
      con.left = 0x46; con.lineH = 0x20;
      const E = 0x6a80 + P * 0x25;
      con.setCursor(0x46, 0x60);
      let sum = 0; for (let i = 0; i < 10; i++) sum += st.u8(E + 0x0e + i);
      printf(F.economy, pS16(st.u16(E)), st.u16(E + 2), pS16(st.u16(E + 4)), st.u16(E + 6), Math.trunc(sum / 10) + 0x32);
    }
    con.lineH = 0x18;
  }
  // 8dfd 建築內部底圖 (地圖視窗區以點陣填滿)
  wallpaper(mode) {
    const s = this.c.scr, g = this.c.gfx;
    for (let r = 0; r < 6; r++) for (let k = 0; k < 3; k++) {
      s.glyphMode(k * 16 + 12, r * 64 + 8, 8, 0x40, g.subarray(0x3ca0), mode);
      s.glyphMode(k * 16 + 20, r * 64 + 40, 8, 0x20, g.subarray(0x3ca0), mode);
      s.glyphMode(k * 16 + 20, r * 64 + 8, 8, 0x20, g.subarray(0x3da0), mode);
    }
  }
  // 8ebc 進入建築: 淡出, 底圖, 建築圖 (GRAPH.DAT #k+6), 淡入
  async interior(k) {
    const { palette, sys, graph } = this.c;
    await palette.fadeBlack();
    sys.mouseHide();
    this.wallpaper(1);
    graph.draw(k === 10 && this.colonyChurch() ? 0x14 : k + 6, 0x68, 0x10);
    sys.mouseShow();
    await palette.fadeToTarget();
  }
  // 1fd9:ce07 CHIP_NO.DAT[港] == 2
  colonyChurch() { return this.port < 100 && this.P.chipNo[this.port] === 2; }

  // ================= 行人 =================
  // 6241 是否在視窗外
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
  // 6172 (x,y) 是否撞到其他行人 / 主角; 回傳 0 或 行人編號+1 (站立的衛兵回傳 7)
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
  // 6269 行人: 站立者原地動畫, 走動者隨機移動
  npcs() {
    if (this.night()) { this.initNpcs(); return; }
    const rng = this.c.sys.rng;
    for (let si = 4; si < 8; si++) {
      const n = this.npc(si);
      if (this.outOfView(n.x, n.y)) continue;
      const fr = rng.random(2) + (n.d + 12) * 2;
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
      if (!this.collide(di, x, y) && (x & 0xffff) < 0x5e && (y & 0xffff) < 0x5e && !this.blockedAt((y + 1) * P_MAP_W + x)) {   // 63c1 / 63c7: word 無號比較 (x 或 y 從 0 減 1 = FFFF 時不能走)
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
  // 64c6 與行人交談
  async talk(code) {
    const { sys, win, menu, message } = this.c, st = this.st, P = this.port, R = 0x5f54 + P * 0x16, E = 0x6a80 + P * 0x25;
    sys.mouseHide();
    win.shadowedSaved(0x10, 0xa0, 0x24, 0x80, 0);
    const nation = st.u8(R + 0x15) & 7;
    switch (code) {
      case 1: message(0x282 + P); break;
      case 2: message((this.c.rt.day % 10) + 0x276); break;
      case 3: {
        const T = 0x7f74; let k = 0;
        while (k < 5 && st.u8(T + k) === 0xff) k++;
        if (k < 5) message(0x280, st.cstr(0x5892 + (st.u8(T + k) + 0x28) * 0x16)); else message(0x281);
        break; }
      case 4: message(nation + 0x26f); break;
      case 5:
        if (P >= 100) { message(0x242, st.cstr(R + 4)); break; }
        if (this.isCapital()) { message(0x243, this.nations[nation], st.cstr(R + 4)); break; }
        if (nation !== 6) message(0x244, this.nations[nation], st.u8(R + 0x15) & 0x80 ? this.F.colony : this.F.ally, st.cstr(R + 4));
        else message(0x245, st.cstr(R + 4));
        break;
      case 6: message((P % 3) + 0x26b); break;
      case 7: message(0x26e, this.nations[st.u8(st.personRecord(st.hero) + 0x31) & 15]); break;
      case 8: {
        message(0x268);
        const g = st.u8(E + 0x1a);
        if (g !== 0xff) message(0x269, this.goods[g]); else message(0x26a);
        break; }
    }
    sys.flush();
    sys.mouseShow();
    await menu.waitPrompt();
    sys.mouseHide();
    await win.close();
    sys.mouseShow();
  }
  // 0fea:b578 = 1b418: 本港是否為某國首都
  isCapital() { for (let i = 0; i < 6; i++) if (this.st.u8(0x117a + i * 0x20 + 0x0a) === this.port) return true; return false; }

  // ================= 主角移動 66be =================
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
      if (code && this.talkCool >= 10) { await this.talk(code); this.talkCool = 0; return 0; }
      if (this.talkCool < 10) this.talkCool++;
      this.hx += dx; this.hy += dy;
      if (this.heroBlocked() || this.collide(-1, this.hx + this.vx, this.hy + this.vy)) {
        // 被擋住: 往兩側找最近的空隙 (各試 1..19 格)
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
      // 靠近邊緣時捲動視窗
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
  // 6031 主角是否站在建築入口
  doorAt() {
    const x = (this.hx + this.vx) & 0xff, y = (this.hy + this.vy) & 0xff;
    for (let k = 0; k < 12; k++) if (this.door[k * 2] === x && this.door[k * 2 + 1] === y) return k;
    return -1;
  }
  // 1b6ba 進入建築的時刻限制
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
  // 1b6ba: 回傳消耗的時間 (0 = 沒有進入)
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
    // 劇本事件: 2e09:5481/53f0 (共用 SNR0), [0de6]=0 時 2e09:55c2/5546 (主角 SNRn); 回傳 0 (命令 F8) 時不進入建築處理
    let r1 = 1, r2 = 1;
    if (!this.c.noEvents) {
      const sc = (this.c.events ??= new Scenario(this.c)); sc.scene = this;       // ctx.scenario 是劇本檔編號 (newgame.js)
      if (await sc.check(ENV_COMMON, this.port, k)) r1 = await sc.run(ENV_COMMON);
      if (!this.st.u16(0x0de6) && await sc.check(ENV_HERO, this.port, k)) r2 = await sc.run(ENV_HERO);
    }
    sys.mouseShow();
    if (!((r1 && r2) || k === 4)) { sys.mouseHide(); this.portBgm(); this.redraw(); sys.mouseShow(); return cost; }   // 1b7ef → 1b8ab
    sys.mouseHide();
    // 1b7fc: 港口所屬國對主角聲望不足時的入場檢查 (碼頭/造船廠/教會/商館?/10 號除外)
    const st = this.st, H = 0x125a + st.hero * 0x0e, nation = st.u8(0x5f54 + this.port * 0x16 + 0x15) & 7;
    if (![5, 7, 3, 10].includes(k) && nation !== 6 && st.u8(H + 6 + nation) < 0x50) {
      if (sys.rng.random(3) === 0 && sys.rng.random(100) > st.u8(H + 6 + nation) + 0x14) {
        await this.refused(nation, H);                                 // 1b5c1
        if (this.port !== 0xff) { this.portBgm(); this.redraw(); }
        sys.mouseShow(); return cost;
      }
      (this.buildings ??= new Buildings(this)).crewSpeaks();          // 909b 船員: 「這是%s的港口, 留點神」
      this.c.message(0x346, this.nations[nation]);
      await this.c.menu.waitPrompt(); await this.c.win.close();
    }
    await this.building(k);                                           // DS:a612[k]
    if (this.port !== 0xff) { this.portBgm(); this.redraw(); }
    sys.mouseShow();
    return cost;
  }
  // 1b5c1 入場被拒: 可疑的人靠近 → 被包圍; (主角 +21) + (主角 +25) × (+21) / 100 ≥ random(150) 時逃脫,
  //   否則沒收 3/4 現金, 而且對該國聲望 **加** 20 (原版寫 add byte [H+6+國], 14h; 照搬); 現金改變後不重畫面板 (之後的 1b1a3 才重畫)
  async refused(nation, H) {
    const b = (this.buildings ??= new Buildings(this)), { sys, message, menu, win } = this.c, st = this.st, P = b.hero;
    b.crewSpeaks(); message(0x347); await menu.waitPrompt(); await win.close();
    b.greet(0x348, b.dstr(P + 0x0d)); await menu.waitPrompt();
    let si = st.u8(P + 0x21);
    b.talkPerson(st.hero);
    const r = sys.rng.random(0x96);
    si = (si + Math.trunc((st.u8(P + 0x25) * si) / 100)) & 0xffff;
    if (si < r) {
      message(0x349); await menu.waitPrompt();
      b.greet(0x34d); await menu.waitPrompt();
      b.money = (b.money - Math.trunc(Math.imul(b.money, 3) / 4)) | 0;         // _ldiv(現金 × 3, 4)
      st.set8(H + 6 + nation, (st.u8(H + 6 + nation) + 0x14) & 0xff);
    } else {
      message(0x34a); await menu.waitPrompt(); await win.close();
      b.crewSpeaks(); message(0x34b); await menu.waitPrompt();
    }
    await win.close();
  }
  // 建築內部 (1fd9 段, DS:a612[k]) — scenes/buildings.js
  async building(k) { return (this.buildings ??= new Buildings(this)).enter(k); }
  // 1b58d 關門了
  async closed() {
    const { sys, win, menu, message } = this.c;
    sys.mouseHide();
    win.shadowedSaved(0x1c, 0x30, 0x14, 0x30, 0);
    message(0x2fd);
    await menu.waitPrompt();
    await win.close();
    sys.mouseShow();
  }

  // ================= 走路迴圈 1b966 =================
  // 210f1 讀輸入: 滑鼠左鍵 = FF; 功能鍵換成指令按鈕的代碼
  readInput() {
    const { menu, sys } = this.c, src = menu.source();
    if (src === 1) return sys.mouseEvent() === 0x81 ? 0xff : 0;
    if (src !== 2) return 0;
    const k = sys.getKey();
    switch (k) { case 0x2d: case 0x02: return 0x2b; case 0x14: return 0x2a; case 0x16: return 0x2f; case 0x19: case 0x2b: return 0x3d; }
    return k;
  }
  // 1b8c8 畫面按鈕: 0..3 / 4..7 = 方向 1..4; 8..11 = 指令按鈕 (scenes/commands.js), 回傳 FF
  async buttons(key) {
    const { x, y } = this.c.sys.mousePos(), B = this.P.data.buttons;
    for (let i = 0; i < 12; i++) {
      const [x0, y0, x1, y1, k] = B[i];
      if (k !== key && !(x >= x0 && x1 >= x && y0 <= y && y1 >= y)) continue;
      if (key === 0) return 0;
      if (i < 8) return i >= 4 ? i - 3 : i + 1;
      await (this.commands ??= new Commands(this)).button(i - 8);    // DS:[a622 + i×4]: 情報/經營/命令/航海術
      return 0xff;
    }
    return 0xff;
  }
  async walk() {
    const { sys, palette } = this.c;
    let face = 2, di = 0;                                           // di (方向) 跨迴圈保留: 之後任何按鍵都會沿用上次方向
    sys.mickeys();
    for (;;) {
      if (palette.ending) return 0;
      const key = this.readInput();
      const mk = sys.mickeys();
      sys.mousePos();
      if (Math.abs(mk.h) > 8 || Math.abs(mk.v) > 8) {
        if (Math.abs(mk.v) < Math.abs(mk.h)) di = mk.h >= 0 ? 2 : 4; else di = mk.v >= 0 ? 3 : 1;
      }
      const b = await this.buttons(key);
      if (this.pmTarget !== undefined) {                              // 擴充功能 (非原版): 港內移動 — 瞬移到門口後照原版進門 (RE_NOTES 33.5)
        const k = this.pmTarget; this.pmTarget = undefined;
        sys.mouseHide(); PortMove.teleport(this, k); sys.mouseShow();
        const r = await this.tryEnter();
        if (r) return r;
        continue;
      }
      if (b !== 0xff) di = b;
      if (this.port === 0xff) return 0;
      if (this.timeAbort()) return 0;                                 // 1b39a (讀檔後)
      const shape = P_CURSORS[di];
      if (shape !== this.cursor) { this.cursor = shape; sys.setCursorShape(shape); }
      sys.timer.set(this.c.state.options & 1 ? 8 : 4);
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
        sys.mouseShow();
      }
      while (sys.timer.get()) await sys.poll();
    }
  }
  // 1b39a 時間迴圈中止旗標 (月/日/時刻 >= F0; 讀檔時設定)
  timeAbort() { const r = this.c.rt; return r.month >= 0xf0 || r.day >= 0xf0 || r.time >= 0xf0; }
  // 1bb07 港口行動: 回傳消耗的時間
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
