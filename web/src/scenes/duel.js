// scenes/duel.js — 一骑打 (MAIN.EXE 12998 以下; docs/RE_NOTES.md 30.16..30.18)
// 入口: 海战 0fea:2d1a = 12bba → NavalBattle.duel(ax, T) → duelInBattle();  剧本命令 E8 0fea:2ca9 = 12b49 → duelFromScenario()
// 状态都在 DS (以原版地址存放在海战的 DS 镜像 ctx.battleDS; 0ca4..8d17 走 GameState)，画面由 ArtRegistry 标准 PNG 精灵表绘制。
import { GameConst, ItemFlag } from "../model/flags.ts";
import { personByAddr, personRawBytes } from "../model/world_helpers.ts";
import { hasDom, runDomStoryCard } from "../ui/modals.ts";
import { renderWideDuel, hideDomDuelHud, runDomDuelMove } from "../ui/duel_hud.ts";
import { decodeCleanCstr, toSimp } from "../ui/text_util.ts";

const duHex = s => { const b = Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16))), o = new Uint8Array(b.length + 1); o.set(b); return o; };
const duS16 = v => (v << 16) >> 16;
const duUmin = (a, b) => ((a & 0xffff) > (b & 0xffff) ? b & 0xffff : a & 0xffff);   // seg0:4d7c
const DU_DS0 = 0x9d44;
// 12176 的动作表 (6 列 × 6 格): 高 4 比特 − 1 = dx, 低 4 比特 = 格; 第 0..2 列 攻击 3 招、第 3..5 列 防守 3 招
const DU_ANIM = [[0x06, 0x01, 0x07, 0x08, 0x00, 0x01], [0x06, 0x07, 0x08, 0x09, 0x00, 0x01], [0x06, 0x07, 0x08, 0x08, 0x00, 0x01],
  [0x01, 0x16, 0x17, 0x17, 0x18, 0x11], [0x01, 0x16, 0x17, 0x17, 0x18, 0x11], [0x06, 0x17, 0x27, 0x28, 0x28, 0x21]];

// 加载文字常数 (data/duel.json)；精灵图形由 ArtRegistry 下的 web/assets/art/duel/*.png 提供
export async function loadDuelAssets(A, _loadBinary, loadJSON) {
  const J = await loadJSON(A + "/data/duel.json");
  return { J };
}

export class Duel {
  // c: 共用对象; P: loadPortAssets() 的结果 (P.duel = loadDuelAssets(), P.battle = 海战常数)
  constructor(c, P) {
    this.c = c; this.P = P; const D = P.duel;
    this.J = D.J;
    if (!c.battleDS) {                                                   // 与 NavalBattle 相同: MAIN.EXE 的初值
      const W = new Uint8Array(0x10000); for (const [a, h] of Object.entries(P.battle.ds)) W.set(Uint8Array.from(h.match(/../g).map(x => parseInt(x, 16))), parseInt(a, 16));
      c.battleDS = W;
    }
    this.W = c.battleDS;
    if (!c.duelDSInit) { const h = this.J.ds["9d44"]; for (let i = 0; i < h.length / 2; i++) this.W[DU_DS0 + i] = parseInt(h.substr(2 * i, 2), 16); c.duelDSInit = 1; }
    this.atk = this.J.attack.map(duHex); this.def = this.J.defend.map(duHex);
    this.curAction = [0, 0];
    this.viewState = null;
  }
  get st() { return this.c.state; }
  get m() { return this.c.state.model; }
  u8(a) { return this.W[a & 0xffff]; }
  u16(a) { return this.u8(a) | (this.u8(a + 1) << 8); }
  s16(a) { return duS16(this.u16(a)); }
  set8(a, v) { this.W[a & 0xffff] = v & 0xff; }
  set16(a, v) { this.set8(a, v & 0xff); this.set8(a + 1, (v >> 8) & 0xff); }
  ds(a) { let e = a; while (this.W[e]) e++; return this.W.subarray(a, e + 1); }    // DS 上的 C 字符串
  rnd(n) { n &= 0xffff; return n ? this.c.sys.rng.random(n) & 0xffff : 0; }         // seg0:4dc4 (n = 0 时不取随机数)
  get h() { return this.u16(0x9d48); }                                                // 1 = 电脑发起
  get side() { return (this.u16(0x9d4e) + this.h) % 2; }                              // 0 = 主角那方是攻方
  wait(n) { return this.c.sys.waitTicks(n); }                                         // seg0:5998
  itemName(n) { return this.m.item(n & 0xff).nameBytes; }                             // 5cde

  // ================= 12998 本体 =================
  async body() {
    const { con, sys, scr } = this.c;
    if (scr) {
      scr.wideDialog = null;
      scr.wideOverlays.length = 0;
      scr.wideRenderer = hasDom() ? (ctx, s) => renderWideDuel(ctx, s, this) : null;
    }
    this.alloc();                                                       // 111ce
    const l = con.left, r = con.right;
    con.left = 0; con.right = 0x4f;
    this.set8(0x9d4a, 1); this.set8(0x9d4b, 1);
    if (this.scene && "cursor" in this.scene) this.scene.cursor = 0x2570;   // [06d6] = 0x2570
    sys.setCursorShape(0x2570);                                         // 5050
    await this.screen();                                                // 12612
    this.hp();                                                          // 1148a
    let si = 0;
    for (; si < 0x14; si++) {
      this.set16(0x9d4e, si % 2);
      this.cpuMove();                                                   // 112b2
      await this.playerMove(si);                                        // 11424
      const d = this.damage();                                          // 1231f
      await this.anim(d);                                               // 12176
      if (await this.result(d)) break;                                  // 12149
      this.hp();                                                        // 1148a
    }
    if (si === 0x14) {
      this.set16(0x9d50, 0xffff); this.set16(0x9d54, 1); this.set16(0x9d56, 0); this.set16(0x9d52, 0);
      await this.frame(0, 0); await this.wait(4);
      await this.frame(1, 1); await this.wait(4);
      await this.frame(0, 0); await this.wait(si);
    }
    con.left = l; con.right = r;
    this.free();                                                        // 0030 × 2、2e09:7030、11236
  }
  // 111ce: [0c88] (窗口保存区) 释放后配置 4 块缓冲; 11236: 释放, 重新配置 [0c88], [0536] = 0 (保存堆栈清空)
  alloc() {
    this.c.win.stack.length = 0;
  }
  free() { hideDomDuelHud(); this.c.win.stack.length = 0; this.viewState = null; }
  isAtSea() { return this.m.globals.port === GameConst.EMPTY_SLOT; }
  weaponKind(sideIdx) {
    const k = 7 * this.h;
    return sideIdx === 0 ? this.u8(0xa020 + k) : this.u8(0xa027 - k);
  }

  // ================= 12612 画面 =================
  async screen() {
    const { scr, graph, kao, con, printf } = this.c, m = this.m, g = m.globals, h = this.h;
    const diP = personByAddr(m, h === 0 ? this.u16(0x9d44) : this.u16(0x9d46));
    const siP = personByAddr(m, h === 0 ? this.u16(0x9d46) : this.u16(0x9d44));
    scr.clear(0);                                                       // 07f7
    graph.draw(0x17, 0, 0);
    if (g.port !== GameConst.EMPTY_SLOT) graph.draw(0x18, 0x50, 0xa8);
    kao.drawPerson(scr, personRawBytes(siP), 0x0c, 0x38);               // 7d39
    kao.drawPerson(scr, personRawBytes(diP), 0x3c, 0x38);
    con.puts(this.ds(0xa0f3));
    con.setCursor(0x0c, 0x18); printf(this.ds(0xa0fa), siP.givenNameBytes, siP.familyNameBytes);
    con.setCursor(0x2a, 0x18); printf(this.ds(0xa103), diP.givenNameBytes, diP.familyNameBytes);
    this.equip();                                                       // 12490
    const k = 7 * h;
    const item = (a, x, y, f) => { const n = this.u8(a); if (n === 0xff) return; con.setCursor(x, y); printf(this.ds(f), this.itemName(n)); };
    item(0xa025 - k, 0x19, 0x38, 0xa10c); item(0xa026 - k, 0x19, 0x50, 0xa10f);
    item(0xa01e + k, 0x29, 0x38, 0xa112); item(0xa01f + k, 0x29, 0x50, 0xa117);
    this.msgClear();                                                    // 11275
    this.set8(0x9d58, 0);
    await this.enter();                                                 // 11cbd
  }
  // 11275 消息区: 0906(0x1a, 0x70, 0x1c, 0x30, 7), 光标 (0x1c, 0x80), 左右边界 0x1c / 0x35, a051
  msgClear() {
    const { scr, con } = this.c;
    scr.fillCols(0x1a, 0x70, 0x1c, 0x30, 7);
    con.setCursor(0x1c, 0x80); con.left = 0x1c; con.right = 0x35;
    con.puts(this.ds(0xa051));
  }
  // 1148a 体力: 主角那方 / 对手 的数值于 (0x17, 0x168) / (0x33, 0x168)
  hp() {
    const { con, printf } = this.c, v = this.u8(0x9c2a);
    con.left = 0; con.right = 0x4f;
    const [di, si] = this.h === 0 ? [0xc8 - v, v] : [v, 0xc8 - v];
    con.puts(this.ds(0xa0c0));
    con.setCursor(0x17, 0x168); printf(this.ds(0xa0c7), di);
    con.setCursor(0x33, 0x168); printf(this.ds(0xa0ce), si);
  }
  // 12490 装备 (RE_NOTES 30.18)
  equip() {
    const m = this.m, k = this.h & 0xff, A = 0xa01e + 7 * k;
    this.set8(A + 2, 0); this.set8(A + 1, 0xff); this.set8(A, 0xff); this.set16(A + 5, 0); this.set16(A + 3, 0);
    for (let i = 0; i < GameConst.INV_SLOTS; i++) {
      const n = m.inventory(i); if (n === GameConst.EMPTY_SLOT) continue;
      const item = m.item(n); if (!(item.kindFlags & ItemFlag.EQUIPPED)) continue;
      const t = item.kindFlags & ItemFlag.KIND_MASK;
      if (t < 4) { this.set8(A, n); this.set8(A + 2, t); this.set16(A + 3, item.power); }
      if (t === 6) { this.set8(A + 1, n); this.set16(A + 5, this.u16(A + 5) + item.power); }
    }
    const k2 = (1 - k) & 0xff, B = 0xa01e + 7 * k2, opp = personByAddr(m, this.h === 0 ? this.u16(0x9d46) : this.u16(0x9d44));
    const a = duUmin(opp.battleLevel, 0x18) & 0xff, b = duUmin(opp.navLevel, 0x18) & 0xff;
    const W = [0x0f, 0x07, 0x0d, 0x0c, 0x0e, 0x0b], Ar = [0x11, 0x12, 0x13, 0x13];
    const wi = a === 0x18 ? (opp.navLevel % 3) + 3 : a >> 3;
    const w = W[wi], wp = m.item(w); this.set8(B, w);
    this.set8(B + 2, wp.kindFlags & ItemFlag.KIND_MASK); this.set16(B + 3, wp.power);
    const ar = Ar[b >> 3]; this.set8(B + 1, ar); this.set16(B + 5, m.item(ar).power);
  }

  // ================= 画面的格 (由 PNG 精灵表绘制) =================
  loadAnim(side, n) { this.curAction[side] = n; }
  cacheFrames() {}
  async frame(a, b) {
    this.viewState = {
      mode: "frame",
      L: this.s16(0x9d4c),
      a, b,
      dxA: this.s16(0x9d50), dyA: this.s16(0x9d52),
      dxB: this.s16(0x9d54), dyB: this.s16(0x9d56),
    };
    if (this.c.scr) this.c.scr.dirty = true;
    this.c.probe?.("11a4c");
  }
  frameApart(a, b, di, si) {
    this.viewState = {
      mode: "apart",
      di, si,
      a, b,
      dxA: this.s16(0x9d50), dyA: this.s16(0x9d52),
      dxB: this.s16(0x9d54), dyB: this.s16(0x9d56),
    };
    if (this.c.scr) this.c.scr.dirty = true;
    this.c.probe?.("11b4d");
  }
  // 114f3 位置 = (主角那方是 9d44 ? 200 − 体力 : 体力) / 20
  pos() { const v = this.u8(0x9c2a); this.set16(0x9d4c, this.h % 2 === 0 ? Math.trunc((0xc8 - v) / 0x14) : Math.floor(v / 0x14)); }

  // ================= 11cbd 入场 =================
  async enter() {
    const { palette } = this.c;
    this.set16(0x9d4e, 0);
    this.pos();
    this.loadAnim(0, 0); this.loadAnim(1, 0);
    this.cacheFrames();
    this.set16(0x9d50, 1); this.set16(0x9d54, 0xffff); this.set16(0x9d56, 0); this.set16(0x9d52, 0);
    let di = 0x11, si = -7;
    await palette.fadeTo(palette.table("battle"));                      // bcfa (淡入战场调色盘; 循环随即停止)
    if (!palette.invert) palette.stopCycle();                           // [c2d6] = 0 → 1743
    let cR = 0, cL = 0;                                                 // [bp-6] 右 (主角那方) 走的步数、[bp-8] 左 (对手)
    while (this.s16(0x9d4c) !== si) {
      this.frameApart(cR % 2, cL % 2, di, si);                          // 11b4d
      const L = this.s16(0x9d4c), ax = L - si, cx = di - L;
      if (ax <= cx) { di--; cR++; }
      if (ax >= cx) { si++; cL++; }
      await this.wait(4);
    }
    this.set16(0x9d50, 0); this.set16(0x9d54, 0);
    await this.frame(cR % 2, cL % 2); await this.wait(4);
    this.set16(0x9d50, 0xffff); this.set16(0x9d54, 1);
    await this.frame(0, 0); await this.wait(4);
    await this.frame(1, 1); await this.wait(4);
    await this.frame(0, 0); await this.wait(4);
  }

  // ================= 出招 =================
  // 112b2 电脑: 依电脑方自己的武器种类 / 防具值决定门槛; v = random(10): < 下限 → 0, > 上限 → 2, 否则 1
  cpuMove() {
    const h = this.h, p = h === 0 ? 0x9d4b : 0x9d4a;
    const kind = h === 0 ? this.u8(0xa027) : this.u8(0xa020), armor = h === 0 ? this.u16(0xa02a) : this.u16(0xa023);
    let lo, hi;
    switch (kind) { case 1: lo = 6; hi = 7; break; case 2: lo = 2; hi = 7; break; case 3: lo = 2; hi = 3; break; default: lo = 3; hi = 6; }
    let dlo, dhi;
    if (duS16(armor) >= 0x3c) { dlo = 6; dhi = 7; } else if (duS16(armor) >= 0x14) { dlo = 2; dhi = 7; } else { dlo = 2; dhi = 3; }
    let r = 1;
    const v = duS16(this.rnd(0x0a));
    if (this.side) { if (v < lo) r = 0; if (v > hi) r = 2; }
    else { if (v < dlo) r = 0; if (v > dhi) r = 2; }
    this.set8(p, (this.u8(p) << 2) | r);
  }
  // 11424 玩家: 主角那方是攻方 → 11394 攻击菜单, 否则 113dc 防守菜单
  async playerMove(si) {
    const p = this.h === 0 ? 0x9d4a : 0x9d4b;
    const r = await this.ask(si, this.side === 0 ? 0xa06d : 0xa0a1, this.side === 0 ? this.atk : this.def);
    this.set8(p, (this.u8(p) << 2) | r);
  }
  async ask(si, title, items) {
    if (this.c.scr?.wideRenderer && hasDom() && this.c.codec) {
      const labels = items.map(b => decodeCleanCstr(this.c.codec, b));
      return (await runDomDuelMove(Math.trunc(si / 2) + 1, this.side === 0, labels)) & 0xff;
    }
    const { con, printf, menu } = this.c;
    this.msgClear();
    printf(this.ds(title), Math.trunc(si / 2) + 1);
    con.left = 0; con.right = 0x4f;
    let r;
    do r = await menu.listMenuKeep(0x46, 0xf0, items, 0); while (r === 0xff);   // 14411
    return r & 0xff;
  }
  // 1146d 攻击力: +21 × +25 / 50 + +21 / 2
  power(p) { const a = p.getStats(5); return (Math.trunc(duS16(Math.imul(p.battleLevel, a) & 0xffff) / 50) + (a >> 1)) & 0xffff; }
  // 1231f 伤害 (RE_NOTES 30.16 / 30.18)
  damage() {
    const m = this.m, k = this.u16(0x9d4e);
    const [ah, dh, attAddr, defAddr] = k === 0 ? [this.u8(0x9d4a), this.u8(0x9d4b), this.u16(0x9d44), this.u16(0x9d46)]
      : [this.u8(0x9d4b), this.u8(0x9d4a), this.u16(0x9d46), this.u16(0x9d44)];
    const att = personByAddr(m, attAddr), def = personByAddr(m, defAddr);
    const aPrev = (ah & 0x0c) >> 2, dPrev = (dh & 0x0c) >> 2, dCur = dh & 3, aCur = ah & 3;
    const b14 = this.power(att), b16 = (4 - aPrev) & 0xffff;
    const R = 0xa01e + 7 * k;
    let si = this.u16(R + 3) >= 1 ? 0x32 : 0;
    si = (si + aCur * 0x19) & 0xffff;
    if ((((this.u8(R + 2) - aCur) & 0xff) - 1 & 0xff) === 0) si = (si + this.u16(R + 3)) & 0xffff;
    const t = (((this.u16(R + 3) + b14) & 0xffff) * b16) & 0xffff;
    const b0c = Math.floor((Math.imul(t >>> 2, si) & 0xffff) / 100);   // mul si 后 sub dx, dx 再 div: 只用乘积的低 16 比特
    const b10 = ((4 - dPrev) << 1) & 0xffff;
    const b12 = (dCur * 2 + 5) & 0xffff;
    const armor = this.u16((0xa02a - 7 * k) & 0xffff), b8 = armor >>> 1;
    const b0a = (Math.imul(2 - dCur, 5) + armor + duUmin(def.battleLevel, 0x14)) & 0xffff;
    const cx = this.rnd(att.battleLevel >> 1);
    const q = Math.trunc(duS16(Math.imul(duS16((100 - b0a) & 0xffff), duS16(b0c)) & 0xffff) / 100) & 0xffff;
    let dmg = (cx + duUmin(q, 0x32)) & 0xffff;
    const roll = this.rnd(100);
    if (((Math.imul(b12, b10) - b8) & 0xffff) >= roll) dmg = 0;        // jb: 门槛 < random(100) 才打中
    return dmg;
  }

  // ================= 12176 双方出招的动画 =================
  async anim(dmg) {
    const h = this.h;
    let r1 = (h === 0 ? this.u8(0x9d4a) : this.u8(0x9d4b)) & 3, r2 = (h === 0 ? this.u8(0x9d4b) : this.u8(0x9d4a)) & 3, hd;
    if (this.side === 0) { r2 += 3; hd = 0; } else { r1 += 3; hd = 1; }
    this.loadAnim(0, r1 + 1); this.loadAnim(1, r2 + 1);                // 117b7
    const n = dmg < 1 ? 6 : 4;
    for (let si = 0; si < n; si++) {
      const a = DU_ANIM[r1][si], b = DU_ANIM[r2][si];
      this.set16(0x9d50, (a >> 4) - 1); this.set16(0x9d54, -((b >> 4) - 1));
      this.set16(0x9d56, 0); this.set16(0x9d52, 0);
      let fa = a & 0x0f, fb = b & 0x0f;
      if (dmg && si >= 3) { if (hd) { fa = 2; this.set16(0x9d52, 0xfff8); } else { fb = 2; this.set16(0x9d56, 0xfff8); } }
      await this.frame(fa, fb);
      if (si === 3) { this.c.sfx?.voice(dmg ? 0x0bd6 : 0x0bc0); this.c.sfx?.note(0x30); }   // 122dc: 效果音 9768(DS:0bd6 打中 / 0bc0) + 9804(0x30), 不放键
      await this.wait(2);
    }
  }
  // 12149
  async result(dmg) {
    if (dmg && (await this.hit(dmg))) return 1;
    this.set16(0x9d50, 0xffff); this.set16(0x9d54, 1); this.set16(0x9d56, 0); this.set16(0x9d52, 0);
    await this.frame(0, 0);
    return 0;
  }
  // 11fae 扣血 → 分出胜负 → 11e6b; 否则依位置移动 (每格闪伤害数字)
  async hit(dmg) {
    const old = this.s16(0x9d4c), v = this.u8(0x9c2a);
    if (this.u16(0x9d4e) === 0) this.set8(0x9c2a, duUmin(v + dmg, 0xc8));
    else this.set8(0x9c2a, v - duUmin(dmg, v));
    this.pos();
    const L = this.s16(0x9d4c);
    if (this.u8(0x9c2a) === 0 || this.u8(0x9c2a) === 0xc8) { await this.knock(dmg); return 1; }
    const step = old > L ? -1 : 1, p = this.side;
    this.set16(0x9d4c, old);
    let si = 0;
    while (this.s16(0x9d4c) !== L) {
      const fa = p === 0 ? si % 2 : 2, fb = p === 0 ? 2 : si % 2;
      this.set16(0x9d52, p === 0 ? 0 : -((si % 2) << 3)); this.set16(0x9d56, p === 0 ? -((si % 2) << 3) : 0);
      await this.frame(fa, fb);
      this.flash(si, dmg);
      await this.wait(4);
      si++; this.set16(0x9d4c, this.s16(0x9d4c) + step);
    }
    this.set16(0x9d56, 0); this.set16(0x9d52, 0);
    await this.frame(p >= 1 ? 3 : 0, p < 1 ? 3 : 0);
    for (let i = 0; i < 4; i++) { this.flash(si++, dmg); await this.wait(4); }
    return 0;
  }
  // 11dcc 伤害数字 (偶数格显示「-%d」, 奇数格清掉), 第 8 格起不画
  flash(n, dmg) {
    if (duS16(n) >= 8) return;
    const { con, printf } = this.c;
    con.left = 0; con.right = 0x4f;
    if (this.side === 0) {
      if (n % 2 === 0) { con.puts(this.ds(0xa0d5)); con.setCursor(0x1a, 0x168); printf(this.ds(0xa0dc), dmg); }
      else { con.setCursor(0x1a, 0x168); con.puts(this.ds(0xa0e0)); }
    } else {
      if (n % 2 === 0) { con.puts(this.ds(0xa0e4)); con.setCursor(0x36, 0x168); printf(this.ds(0xa0eb), dmg); }
      else { con.setCursor(0x36, 0x168); con.puts(this.ds(0xa0ef)); }
    }
  }
  // 11e6b 倒下
  async knock(dmg) {
    const di = this.side, step = di < 1 ? -1 : 1;
    let b8 = 0, ba = 0;
    for (let si = 0; si < 7; si++) {
      const fa = di === 0 ? si % 2 : 2, fb = di === 0 ? 2 : si % 2;
      if (di) this.set16(0x9d52, this.u16(0x9d52) + b8);
      if (!di) this.set16(0x9d56, this.u16(0x9d56) + b8);
      await this.frame(fa, fb);
      this.flash(ba++, dmg);
      b8 = si >= 3 ? 8 : -8;
      await this.wait(4);
      this.set16(0x9d4c, this.s16(0x9d4c) + step);
    }
    this.set16(0x9d56, 0); this.set16(0x9d52, 0);
    this.flash(ba++, dmg);
    await this.frame(di >= 1 ? 3 : 0, di < 1 ? 3 : 0);
    await this.wait(4);
    this.flash(ba++, dmg);
    this.hp();
    for (let i = 0; i < 0x10; i++) {
      if (di === 0) await this.frame(i % 2 + 4, 3); else await this.frame(3, i % 2 + 4);
      await this.wait(4);
    }
  }

  // ================= 12a93 经验 =================
  async exp(ax) {
    const m = this.m, { con, menu } = this.c, opp = personByAddr(m, ax ? this.u16(0x9d46) : this.u16(0x9d44)), H = m.heroPerson();
    let n;
    if ((ax === 0 && this.u8(0x9c2a) === 0) || (ax !== 0 && this.u8(0x9c2a) === 0xc8)) {
      if (this.c.scr?.wideRenderer && hasDom() && this.c.codec) {
        await runDomStoryCard(this.c.art, null, toSimp(decodeCleanCstr(this.c.codec, this.ds(0xa11c))));
      } else {
        this.msgClear(); con.puts(this.ds(0xa11c)); await menu.waitPrompt();          // 147ab
      }
      n = (10 * opp.battleLevel) & 0xffff;
    } else n = (3 * opp.battleLevel) & 0xffff;
    const up = this.levelUp(H, n);                                      // 1bb9c(主角 +25, +28)
    if (up || opp.getStats(5) >= H.getStats(5)) {
      H.setStats(5, duUmin(H.getStats(5) + this.rnd(3), 100));
      H.setStats(4, duUmin(H.getStats(4) + this.rnd(3), 100));
    }
  }
  // 1bb9c 经验 (+28) += g; 足够时升级 (+25, 所需 = min(等级, 18)² × 30 (1bb84), 等级 100 时经验归零); 有升级时 +1c..+1f 各 + min(random(3), 100 − 值)
  levelUp(p, g) {
    let n = 0;
    p.battleExp = (p.battleExp + g) & 0xffff;
    for (;;) {
      const lv = p.battleLevel, m = duUmin(lv, 0x12) & 0xff, need = duS16(Math.imul(Math.imul(m, m) & 0xffff, 0x1e) & 0xffff);
      if (need > duS16(p.battleExp)) break;
      if (lv === 0x64) { p.battleExp = 0; break; }
      n++; p.battleExp = (p.battleExp - need) & 0xffff; p.battleLevel = lv + 1;
    }
    if (n) for (let i = 0; i < 4; i++) p.setStats(i, p.getStats(i) + duUmin(this.rnd(3), (100 - p.getStats(i)) & 0xffff));
    return n;
  }
}

// ================= 12bba 海战的入口 (0fea:2d1a) =================
// b: NavalBattle; ax = 1 玩家发起 / 0 电脑发起; T = 对方的船 (海战船记录地址)
export async function duelInBattle(b, ax, T) {
  const d = new Duel(b.c, b.sea.P); d.scene = b.sea;
  if (!ax) {
    if (b.c.scr?.wideRenderer && hasDom() && b.c.codec) {
      await runDomStoryCard(b.c.art, null, toSimp(decodeCleanCstr(b.c.codec, d.ds(0xa12e))));
    } else {
      b.msgArea(); b.c.printf(d.ds(0xa12e)); await b.c.menu.waitPrompt();  // c2ee、a12e、147ab
    }
    const B = b.u16(0x9bc2);
    if (b.u16(B) !== b.u16(0x9c2c)) b.set8(0x9c2a, 0x64);
    b.set16(0x9c2c, b.u16(B));
  } else {
    if (b.u16(0x9c2c) !== b.u16(T)) b.set8(0x9c2a, 0x64);
    b.set16(0x9c2c, b.u16(T));
  }
  await b.fadeOutField();                                               // bd26
  d.set16(0x9d44, b.u16(b.u16(0x9bc2))); d.set16(0x9d46, b.u16(T)); d.set16(0x9d48, ax < 1 ? 1 : 0);
  await d.body();                                                       // 12998
  await d.exp(ax);                                                      // 12a93
  const v = b.u8(0x9c2a);
  if (v === 0 || v === 0xc8) {
    if (ax) {
      if (!(b.u8(T + 0x0d) & 0xc0)) b.set8(0x9bfb, v < 1 ? 7 : 6);
      else b.set16(b.u16(T + 2), 0);                                    // T 船位 +0 (水手) = 0
    } else b.set8(0x9bfb, v < 1 ? 6 : 7);
  }
  const { palette, scr } = b.c;
  await palette.fadeBlack();                                            // 99f2
  scr.clear(0);                                                         // be20 (HDAT 重读, 移植版不需要) / 07f7
  b.drawPanel(); b.redraw();                                            // c581 / c608
  await b.fadeIn();                                                     // bcfa
}

// ================= 剧本命令 E8 (32377 → 0fea:2ca9 = 12b49) =================
// sc: Scenario; person: 人物编号 (命令的操作数)
export async function duelFromScenario(sc, person) {
  const c = sc.c, m = c.state.model, g = m.globals, scene = sc.scene, P = scene?.P ?? c.portAssets;
  const opp = m.person(person & 0xff);
  await sc.closeAll();                                                  // 31dbb
  const d = new Duel(c, P); d.scene = scene;
  await c.palette.fadeBlack();                                          // 99f2
  d.set16(0x9d44, m.heroPerson().addr); d.set16(0x9d46, opp.addr); d.set16(0x9d48, 0);
  d.set8(0x9c2a, 0x64);
  await d.body();                                                       // 12998
  c.con.puts(d.ds(0xa127));
  await c.palette.fadeBlack();                                          // 99f2
  if (g.port === GameConst.EMPTY_SLOT) { /* 84de: 海上图块常驻 (移植版不需要) */ } else scene?.loadPort?.();   // 88e9
  c.graph.draw8(g.options & 0x80 ? 3 : 5, 0, 0);                      // 5a91 ([8b1e] 前后各反转一次, 两次相同)
  sc.panels();                                                          // 8894
  if (scene?.interior) await scene.interior(sc.b876);                  // 8ebc([b876])
  await c.palette.fadeToTarget();                                       // 99e8
}
