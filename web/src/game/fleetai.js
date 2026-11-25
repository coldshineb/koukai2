// game/fleetai.js — 其他舰队 AI (MAIN.EXE: 每天一支 0fea 段 1ac19、海上每个时刻 1afe8、区域改变 seg0:6aae、任务 2e09 段 3407f / 33921 / 339e9)
// 依 docs/RE_NOTES.md 第 29.4–29.8 节。路线 (241c2)、自动航行方向 (313b1)、中途点 (23a97)、舰队速度 (1acbf)、陆地 (3135c)、区域 (2317c) 沿用 scenes/sea.js 已移植的函数。
// 运行期变量 (DS, 不在存盘): [c2ea] 目前处理的舰队、[bdb8] 任务的国家 (只在 3407f 写入)、[bd7c] 任务中的舰队 → ctx.aiVars
// 尚未移植 (主控台警告): 海战本体 10f7e (第 30 节, 经 SeaScene.navalBattle 调用)

import { DS, OFF } from "../model/schema_views.ts";
const faS16 = v => (v << 16) >> 16, faS8 = v => (v << 24) >> 24, faU16 = v => v & 0xffff;
export const faUmin = (a, b) => (faU16(a) > faU16(b) ? faU16(b) : faU16(a));          // seg0:4d7c
export const faUmax = (a, b) => (faU16(a) < faU16(b) ? faU16(b) : faU16(a));          // seg0:4d87
export const faLdiv = (a, b) => ((b | 0) === 0 ? 0 : Math.trunc((a | 0) / (b | 0)) | 0);   // seg0:3722 _ldiv (向零取整)
export const faLmul = (a, b) => Math.imul(a | 0, b | 0);                       // seg0:37bc _lmul (低 32 比特)
const faIdiv = (a, b) => Math.trunc(faS16(a) / faS16(b));                          // cwd; idiv (16 比特)
const faImod = (a, b) => faS16(a) % b;                                           // idiv 的余数 (正负号同被除数)
const faSgn = v => (v < 0 ? -1 : v > 0 ? 1 : 0);                               // seg0:4dde
const faWarned = new Set();
const faTodo = n => { if (!faWarned.has(n)) { faWarned.add(n); console.warn("尚未移植: " + n); } };

export const faFleet = k => DS.TBL_FLEET + ((0x85 * (k & 0xff)) & 0xffff);     // seg0:5c28
export const faNation = n => DS.TBL_COUNTRY + ((n & 0xff) << 5);                   // seg0:5bde
export const faPort = n => DS.TBL_PORT + 0x16 * (n & 0xff);                     // seg0:5c9a
export const faEcon = n => DS.TBL_PORT_ECONOMY + 0x25 * (n & 0xff);                     // seg0:5caa
// 23d7b 的 12 个相对位置 (与 23e19 相同)
const faSpot12 = [0, -2, 0, 2, 2, 0, -2, 0, -1, -2, 1, -2, 2, -1, 2, 1, -1, 2, 1, 2, -2, -1, -2, 1];

export class FleetAI {
  constructor(sea) { this.sea = sea; }
  get c() { return this.sea.c; }
  get st() { return this.sea.st; }
  get v() { return (this.c.aiVars ??= { c2ea: 0, bdb8: 0, bd7c: 0 }); }   // DS:c2ea / bdb8 / bd7c
  get T() { return this.c.portAssets.fleet.tab; }                          // assets/data/fleet.json (tools/extract_fleet.py)
  rnd(n) { n &= 0xffff; return n ? this.c.sys.rng.random(n) : 0; }        // seg0:4dc4: n = 0 时直接返回 0 (不取随机数)
  P(n) { return this.st.personRecord(n & 0xff); }                          // seg0:5bf8
  get hero() { return this.st.u8(DS.HERO); }
  get heroRec() { return this.P(this.hero); }                              // [c2ce]
  get heroFleet() { return this.sea.fleet; }                               // [c2d4]
  get heroData() { return DS.TBL_HERO_DATA + 0x0e * this.hero; }                     // seg0:5be8
  get heroRank() { return this.st.u8(this.heroData + 0x0d); }              // [1267 + 0e·主角]
  present(S) { return (this.st.u8(S + OFF.DOCK_SLOT.FLAGS) & 0x30) === 0x10; }
  inRegion(A) { return this.sea.inRegion(this.st.u16(A), this.st.u16(A + 2)); }          // 1fd9:33ec = 2317c (A = 座标的地址)
  same(A, B) { const st = this.st; return st.u16(A) === st.u16(B) && st.u16(A + 2) === st.u16(B + 2) ? 1 : 0; }   // 1fd9:33d4 = 23164
  land(x, y) { return this.sea.landAt(x, y); }                             // 2e09:32cc = 3135c
  goodsCat(g) { const L = this.T.goodsCat; for (let i = 0; i < 10; i++) if (L[i] > (g & 0xff)) return i; return 0; }   // 1fd9:468e = 2441e

  // 0fea:83f9 = 18299 战力: +28 = (Σ 在的船 +2 + 4) / 5; 总和 0 → +29 &= FE
  strength(F) {
    const st = this.st; let s = 0;
    for (let i = 0; i < 10; i++) { const S = F + OFF.FLEET.SHIPS + 9 * i; if (this.present(S)) s += st.u8(S + OFF.DOCK_SLOT.DURABILITY); }
    st.set8(F + OFF.FLEET.STRENGTH, faIdiv(s + 4, 5) & 0xff);
    if (!s) st.set8(F + OFF.FLEET.FLAGS, st.u8(F + OFF.FLEET.FLAGS) & 0xfe);
  }
  // 1a75a 舰队解散: 提督离开 (具名人物 9/10 概率到港 random(42), 其他记录释放)
  release(G) {
    const st = this.st; st.set8(G + 0x29, st.u8(G + 0x29) & 0xfe);
    const C = this.P(st.u8(G + 0x2a));
    st.set8(C + 0x2e, 0); st.set8(C + 0x2c, 0xff);
    if (!(st.u8(C + 0x1b) & 0xc0) && this.rnd(10)) st.set8(C + 0x2d, this.rnd(0x2a));
    else { st.set8(C + 0x2d, 0xff); st.set8(C + 0x31, st.u8(C + 0x31) & 0xdf); }
    st.set8(G + 0x2a, 0xff);
  }
  // 3384e 同组在海上 (非 +29 bit4) 的舰队够多: 商船 (k%10 = 1..4) ≥ 2 支、0 / 5..6 组 (5, 6 号) ≥ 1、7..9 组 ≥ 1
  groupBusy() {
    const st = this.st, k = this.v.c2ea & 0xff, sub = k % 10, base = k - sub;
    const cnt = (a, b) => { let n = 0; for (let j = a; j < b; j++) if (!(st.u8(faFleet(base + j) + 0x29) & 0x10)) n++; return n; };
    if (sub >= 1 && sub < 5) return cnt(1, 5) >= 2 ? 1 : 0;
    if (sub < 7) return cnt(5, 7) ? 1 : 0;
    return cnt(7, 10) ? 1 : 0;
  }
  idle(F) { const st = this.st; st.set8(F + OFF.FLEET.MISSION, 0); st.set8(F + OFF.FLEET.TARGET, st.u8(F + OFF.FLEET.HOME_PORT)); st.set8(F + OFF.FLEET.STAY_DAYS, 5); }   // 33962
  // 1fd9:3feb = 23d7b 舰队周围第 i 个位置在区域内且不是陆地 → 该位置
  seaSpot(i, F) {
    const st = this.st, x = (st.u16(F) + faSpot12[2 * i]) & 0xffff, y = (st.u16(F + OFF.FLEET.Y) + faSpot12[2 * i + 1]) & 0xffff;
    return this.sea.inRegion(x, y) && !this.land(x, y) ? { x, y } : null;
  }
  // 在港且在区域内 → 位置换成附近的海面 (都不行返回 0)
  leavePort(F) {
    const st = this.st;
    if (!(st.u8(F + OFF.FLEET.FLAGS) & 0x10) || !this.inRegion(F)) return 1;
    for (let i = 0; i < 12; i++) { const W = this.seaSpot(i, F); if (W) { st.set16(F, W.x); st.set16(F + OFF.FLEET.Y, W.y); return 1; } }
    return 0;
  }
  // 2e09:5891 = 33921 去港 (a = 任务, FF = 不改)
  goPort(a, port, F) {
    const st = this.st, R = faPort(port);
    if (!(a & 0xffff)) { st.set16(F + OFF.FLEET.DEST_X, st.u16(R)); st.set16(F + OFF.FLEET.DEST_Y, st.u16(R + 2)); }
    if (!(st.u8(F + OFF.FLEET.FLAGS) & 0x40) && this.groupBusy() && (a & 0xffff)) return this.idle(F);
    if (!this.leavePort(F)) return this.idle(F);
    if ((a & 0xff) !== 0xff) st.set8(F + OFF.FLEET.MISSION, a);
    st.set8(F + OFF.FLEET.TARGET, port); st.set16(F + OFF.FLEET.DEST_X, st.u16(R)); st.set16(F + OFF.FLEET.DEST_Y, st.u16(R + 2));
    st.set16(F + OFF.FLEET.ROUTE_FLAGS, 0x4000); st.set8(F + OFF.FLEET.FLAGS, st.u8(F + OFF.FLEET.FLAGS) & 0xcf);
  }
  // 2e09:5959 = 339e9 追踪舰队 t
  chaseFleet(a, t, F) {
    const st = this.st, G = faFleet(t);
    if (!(st.u8(F + OFF.FLEET.FLAGS) & 0x40) && this.groupBusy()) return this.idle(F);
    if (!(st.u8(G + 0x29) & 1)) return this.goPort(0, st.u8(F + OFF.FLEET.HOME_PORT), F);
    if (!this.leavePort(F)) return this.idle(F);
    if ((a & 0xff) !== 0xff) st.set8(F + OFF.FLEET.MISSION, a);
    st.set8(F + OFF.FLEET.TARGET, st.u8(G + 0x2a)); st.set16(F + OFF.FLEET.DEST_X, st.u16(G)); st.set16(F + OFF.FLEET.DEST_Y, st.u16(G + 2));
    st.set16(F + OFF.FLEET.ROUTE_FLAGS, 0x4000); st.set8(F + OFF.FLEET.FLAGS, st.u8(F + OFF.FLEET.FLAGS) & 0xcf);
  }
  // 33aaf 剧本 D1: 依任务恢复目的地
  resume(F) {
    const st = this.st, b = st.u8(F + OFF.FLEET.MISSION);
    if (b <= 3 || b === 9) return this.goPort(0xff, st.u8(F + OFF.FLEET.TARGET), F);
    if (b === 4) { if (this.heroRank) this.chaseFleet(0xff, st.u8(this.heroRec + 0x2c), F); return; }
    this.chaseFleet(0xff, st.u8(this.P(st.u8(F + OFF.FLEET.TARGET)) + 0x2c), F);
  }
  // 对象人物的舰队位置 → 目的地 (+0c = 区域内 ? 0x6000 : 0x4000)
  followTarget(F, clear) {
    const st = this.st, G = faFleet(st.u8(this.P(st.u8(F + OFF.FLEET.TARGET)) + 0x2c));
    st.set16(F + OFF.FLEET.DEST_X, st.u16(G)); st.set16(F + OFF.FLEET.DEST_Y, st.u16(G + 2));
    st.set16(F + OFF.FLEET.ROUTE_FLAGS, this.inRegion(F) ? 0x6000 : 0x4000);
    if (clear) st.set8(F + OFF.FLEET.FLAGS, st.u8(F + OFF.FLEET.FLAGS) & 0xcf);
  }

  // ================= 任务 3407f (DS:b8ae) =================
  mission(F) {
    const st = this.st, b = st.u8(F + OFF.FLEET.MISSION);
    this.v.bd7c = F;
    if (b < 3 || b === 9) {
      this.v.bdb8 = Math.trunc((this.v.c2ea & 0xff) / 10);
      if (b === 0) this.m0(); else if (b === 1) this.m1(); else if (b === 2) this.m2();     // 3..10 = 空函数
    }
  }
  countdown() { const st = this.st, F = this.v.bd7c; if (st.u8(F + OFF.FLEET.STAY_DAYS)) st.set8(F + OFF.FLEET.STAY_DAYS, st.u8(F + OFF.FLEET.STAY_DAYS) - 1); return st.u8(F + OFF.FLEET.STAY_DAYS); }   // 33c9d
  // 33cb4 任务 0 (母港): 卖货、补水手、补 +1d..+20、资金、下一个任务
  m0() {
    if (this.countdown()) return;
    const st = this.st, F = this.v.bd7c;
    if (st.u8(F + OFF.FLEET.CARGO_GOOD) !== 0xff) {
      const E = faEcon(st.u8(F + OFF.FLEET.TARGET)), k = this.goodsCat(st.u8(F + OFF.FLEET.CARGO_GOOD));
      for (let i = 0; i < 10; i++) { const d = this.rnd(3) + (k === i ? 2 : 0), p = st.u8(E + OFF.PORT_ECONOMY.PRICES + i); st.set8(E + OFF.PORT_ECONOMY.PRICES + i, p - faUmin(p, d)); }
    }
    for (let j = 0; j < 10; j++) { const S = F + OFF.FLEET.SHIPS + 9 * j; st.set8(S + OFF.DOCK_SLOT.DURABILITY, st.u8(S + OFF.DOCK_SLOT.MAX_DURABILITY)); }
    for (let i = 0; i < 4; i++) {
      if (this.rnd((i + 1) * 2)) break;
      if (st.u8(F + 0x1d + i) === 0xff) st.set8(F + 0x1d + i, this.rnd(20) + 0x32);
    }
    this.strength(F);
    st.set16(F + OFF.FLEET.FUNDS, this.rnd(3) + faIdiv(st.u16(faNation(this.v.bdb8)), 10) + 1);
    st.set8(F + OFF.FLEET.CARGO_GOOD, 0xff); st.set16(F + OFF.FLEET.CARGO_AMT, 0);
    st.set8(F + OFF.FLEET.MISSION, this.nextMission());
    this.dispatch();
  }
  // 33c2d 在首都时依国家方针取新任务 (DS:b89c), 否则 0
  nextMission() {
    const st = this.st, N = faNation(this.v.bdb8), F = this.v.bd7c;
    if (st.u8(F + OFF.FLEET.TARGET) !== st.u8(N + 0x0a)) return 0;
    const sub = (this.v.c2ea & 0xff) % 10, sh = sub >= 1 && sub < 5 ? 8 : sub < 7 ? 4 : 0;
    return ((this.T.mission[st.u8(N + 3)] ?? 0) >> sh) & 0x0f;
  }
  // 33b0b 依任务设置目的地
  dispatch() {
    const st = this.st, N = faNation(this.v.bdb8), F = this.v.bd7c;
    const t = st.u8(N + 2) === 7 ? st.u8(this.heroRec + 0x31) & 0x0f : st.u8(N + 2);
    const chase = k => this.chaseFleet(0xff, k, F);
    switch (st.u8(F + OFF.FLEET.MISSION)) {
      case 0: case 9: return this.goPort(0xff, st.u8(F + OFF.FLEET.HOME_PORT), F);
      case 1: case 2: return this.goPort(0xff, st.u8(N + 4), F);
      case 4: return chase(st.u8(this.heroRec + 0x2c));
      case 5: case 6:
        switch (st.u8(N + 3)) {
          case 3: case 7: return chase(st.u8(this.heroRec + 0x2c));
          case 4: case 8: return chase(this.heroRank > 2 ? this.rnd(5) + 10 * t : this.rnd(4) + 10 * t + 1);
          case 5: return chase(this.rnd(2) + 10 * t + 5);
          case 6: return chase(this.rnd(9) + 0x3d);
        }
        return;
      case 8: { const r = this.rnd(4); return chase(10 * this.v.bdb8 + r + 1); }
    }
  }
  // 33dbf 任务 1 投资 (不在首都、资金 ≥ 2)
  m1() {
    if (this.countdown()) return;
    const st = this.st, bd = this.v.bdb8, N = faNation(bd), F = this.v.bd7c, E = faEcon(st.u8(F + OFF.FLEET.TARGET));
    if (st.u16(F + OFF.FLEET.FUNDS) >= 2 && st.u8(F + OFF.FLEET.TARGET) !== st.u8(N + 0x0a)) {
      const add = o => { const v = (st.u16(F + OFF.FLEET.FUNDS) >>> 1) * 100 + st.u16(E + o); st.set16(E + o, v > 50000 ? 50000 : v); };
      if (st.u16(E + OFF.PORT_ECONOMY.INDUSTRY) > st.u16(E)) { if (st.u16(E + OFF.PORT_ECONOMY.COMMERCE_INVEST) !== 50000) add(2); else if (st.u16(E + OFF.PORT_ECONOMY.INDUSTRY_INVEST) !== 50000) add(6); }
      else if (st.u16(E + OFF.PORT_ECONOMY.INDUSTRY_INVEST) !== 50000) add(6); else if (st.u16(E + OFF.PORT_ECONOMY.COMMERCE_INVEST) !== 50000) add(2);
      st.set16(F + OFF.FLEET.FUNDS, st.u16(F + OFF.FLEET.FUNDS) - (st.u16(F + OFF.FLEET.FUNDS) >>> 1));
      let s = 0; for (let n = 0; n < 6; n++) if (n !== bd && st.u8(E + OFF.PORT_ECONOMY.INFLUENCE + n)) s += st.u8(E + OFF.PORT_ECONOMY.INFLUENCE + n);
      const own = st.u8(E + OFF.PORT_ECONOMY.INFLUENCE + bd), v = faUmin(Math.trunc(((6 * st.u16(F + OFF.FLEET.FUNDS)) & 0xffff) / 10), 100 - own);
      st.set8(E + OFF.PORT_ECONOMY.INFLUENCE + bd, own + v);
      let si = faUmin(v, s);
      while (si) for (let n = 0; n < 6 && si; n++) if (n !== bd && st.u8(E + OFF.PORT_ECONOMY.INFLUENCE + n)) { st.set8(E + OFF.PORT_ECONOMY.INFLUENCE + n, st.u8(E + OFF.PORT_ECONOMY.INFLUENCE + n) - 1); si--; }
    }
    st.set8(F + OFF.FLEET.MISSION, 0); this.dispatch();
  }
  // 33f48 任务 2 买货 (不在首都)
  m2() {
    if (this.countdown()) return;
    const st = this.st, N = faNation(this.v.bdb8), F = this.v.bd7c, E = faEcon(st.u8(F + OFF.FLEET.TARGET));
    if (st.u8(F + OFF.FLEET.TARGET) !== st.u8(N + 0x0a)) {
      const g = this.rnd(16) + 10, k = this.goodsCat(g);
      const base = faS16(st.u16(DS.TBL_REGION_PRICE + (st.u8(E + OFF.PORT_ECONOMY.PRICE_REGION) << 7) + 2 * g));
      const price = faLdiv(faLmul(base, st.u8(E + OFF.PORT_ECONOMY.PRICES + k) + 50), 100), cap = 100 * st.u16(F + OFF.FLEET.FUNDS);
      if (cap >= price) {
        const q = faUmin(faLdiv(cap, price), 1000), p = st.u8(E + OFF.PORT_ECONOMY.PRICES + k);
        st.set8(E + OFF.PORT_ECONOMY.PRICES + k, p + faUmin(this.rnd(3) + 3, 100 - p));
        st.set16(F + OFF.FLEET.FUNDS, st.u16(F + OFF.FLEET.FUNDS) + faLdiv(faLmul(q, price), -100));
        st.set8(F + OFF.FLEET.CARGO_GOOD, g); st.set16(F + OFF.FLEET.CARGO_AMT, q);
      }
    }
    st.set8(F + OFF.FLEET.MISSION, 0); this.dispatch();
  }

  // ================= 每天一支 1ac19 =================
  // 1a6d8 任务 5..8 / 10: 对象的舰队位置 → 目的地 (不在区域内时 3/4 概率不更新); 对象不在 → 回母港
  retarget(F) {
    const st = this.st, b = st.u8(F + OFF.FLEET.MISSION);
    if (!((b >= 5 && b <= 8) || b === 10)) return;
    const C = this.P(st.u8(F + OFF.FLEET.TARGET));
    if ((st.u8(C + 0x31) & 0x20) && st.u8(C + 0x2c) !== 0xff) {
      if (!this.inRegion(F) && this.rnd(4)) return;
      this.followTarget(F, false);
    } else this.goPort(0, st.u8(F + OFF.FLEET.HOME_PORT), F);
  }
  // 1a4a5 任务判断 (+29 bit6 时不做)
  decide(F) {
    const st = this.st, k = this.v.c2ea & 0xff, nat = Math.trunc(k / 10), sub = k % 10;
    if (st.u8(F + OFF.FLEET.FLAGS) & 0x40) return;
    if (k > 0x3c || sub >= 5) {
      const Pa = this.P(st.u8(F + OFF.FLEET.ADMIRAL)), b = st.u8(F + OFF.FLEET.MISSION);
      if (b >= 4 && b <= 6) {                                                     // 1a550
        const G = faFleet(st.u8(this.P(st.u8(F + OFF.FLEET.TARGET)) + 0x2c));
        let home = st.u8(G + 0x27) !== 0;
        if (!home) { const bit = st.u8(Pa + 0x2f) & 0x20; home = this.rnd(sub <= 6 ? (bit ? 30 : 15) : (bit ? 60 : 30)) === 0; }
        if (home) this.goPort(0, st.u8(F + OFF.FLEET.HOME_PORT), F);
      } else if (b === 8 || b === 9) {                                            // 1a5cb
        if (this.c.rt.time % 12 === 0) for (let i = 0; i < 0x46; i++) {
          const G = faFleet(i);
          if (!(st.u8(G + 0x29) & 1) || G === F || st.u8(G + 0x1b) < 5 || st.u8(G + 0x1b) >= 8) continue;
          if (Math.trunc(st.u8(this.P(st.u8(G + 0x1c)) + 0x2c) / 10) !== nat) continue;
          if (this.rnd(st.u8(Pa + 0x2f) & 0x80 ? 2 : 1)) continue;
          this.chaseFleet(sub > 6 ? 6 : 5, i, F);
        }
      }
    }
    // 1a502 海盗 (k > 60) 猎捕中、在区域内 → 改追随机一支商船 (或主角舰队)
    if (k > 0x3c && st.u8(F + OFF.FLEET.MISSION) === 4 && this.inRegion(F) && this.rnd(st.u8(this.P(st.u8(F + OFF.FLEET.ADMIRAL)) + 0x2f) & 0x80 ? 3 : 2) === 0) {
      const L = (this.c.persons ??= []); let n = 0;
      for (let i = 0; i < 0x3c; i++) {
        const G = faFleet(i);
        if (st.u8(G + 0x2a) === this.hero && !this.heroRank) continue;
        const s = i % 10;
        if (!((s >= 1 && s < 5) || G === this.heroFleet)) continue;
        if ((st.u8(G + 0x29) & 1) && G !== F) L[n++] = i;                     // DS:0538 (字)
      }
      this.chaseFleet(5, (L[this.rnd(n)] ?? 0) & 0xffff, F);
    }
  }
  // 1aa79 同一个 24 格内的对象人物 (FF = 没有)
  cellTarget(F) {
    const st = this.st, cell = (faIdiv(st.u16(F), 24) + Math.imul(faIdiv(st.u16(F + OFF.FLEET.Y), 24), 90)) & 0xffff, b = st.u8(F + OFF.FLEET.MISSION);
    if (b < 4 || b > 7) return 0xff;
    if (b === 4) {
      for (let i = 0; i < 0x3c; i++) {
        const G = faFleet(i);
        if (!(st.u8(G + 0x29) & 1)) continue;
        if (((Math.imul(faIdiv(st.u16(G + 2), 24), 90) - cell) & 0xffff) !== (faIdiv(st.u16(G), -24) & 0xffff)) continue;
        if (st.u8(G + 0x29) & 0x50) continue;                                   // 原版的「k % 10 在 1..4」判断恒真
        if (st.u8(F + OFF.FLEET.STRENGTH) > st.u8(G + 0x28)) { st.set8(F + OFF.FLEET.MISSION, 5); return st.u8(G + 0x2a); }
      }
      return 0xff;
    }
    const G = faFleet(st.u8(this.P(st.u8(F + OFF.FLEET.TARGET)) + 0x2c));
    if (!(st.u8(G + 0x29) & 1)) { this.goPort(0, st.u8(F + OFF.FLEET.HOME_PORT), F); return 0xff; }
    if (st.u8(G + 0x29) & 0x50) return 0xff;
    return ((faIdiv(st.u16(G), 24) + Math.imul(faIdiv(st.u16(G + 2), 24), 90)) & 0xffff) === cell ? st.u8(F + OFF.FLEET.TARGET) : 0xff;
  }
  // 1ab8b 海上同一格的对象 (FF = 没有)
  contact(F) {
    const st = this.st, b = st.u8(F + OFF.FLEET.MISSION);
    if (b < 4 || b > 7) return 0xff;
    if (b === 4) {
      const H = this.heroFleet;
      if (this.same(H, F)) { st.set8(F + OFF.FLEET.MISSION, 5); return st.u8(H + OFF.FLEET.ADMIRAL); }
      return 0xff;
    }
    const G = faFleet(st.u8(this.P(st.u8(F + OFF.FLEET.TARGET)) + 0x2c));
    if (!(st.u8(G + 0x29) & 1)) { this.goPort(0, st.u8(F + OFF.FLEET.HOME_PORT), F); return 0xff; }
    if (st.u8(G + 0x29) & 0x50) return 0xff;
    return this.same(G, F) ? st.u8(F + OFF.FLEET.TARGET) : 0xff;
  }
  // 1a7a8 交战 (只在时刻 0x12..0x35)
  async fight(di, F) {
    const st = this.st, { sys } = this.c, Pd = this.P(di), G = faFleet(st.u8(Pd + 0x2c));
    let a = Math.trunc(st.u8(F + OFF.FLEET.STRENGTH) / 10);
    const b = Math.trunc(st.u8(G + 0x28) / 10), t = this.c.rt.time;
    if (t < 0x12 || t >= 0x36) return;
    const home = () => this.goPort(0, st.u8(F + OFF.FLEET.HOME_PORT), F);
    if (this.inRegion(F)) {
      if (di === this.hero) {
        if (!(st.u8(F + OFF.FLEET.FLAGS) & 0x40) && !this.heroRank) return home();
        sys.mouseHide();
        if (this.sea.navalBattle) await this.sea.navalBattle(st.u8(F + OFF.FLEET.ADMIRAL), di, 0xff, 0xff); else faTodo("海戰 (10f7e)");
        sys.mouseShow();
        if (!(st.u8(F + OFF.FLEET.FLAGS) & 1) || (st.u8(F + OFF.FLEET.FLAGS) & 0x40) || st.u8(F + OFF.FLEET.MISSION) === 7 || this.rnd(3)) return;
        return home();
      }
    } else {
      if (di === this.hero) return;
      if (this.rnd(150) < st.u8(Pd + 0x1d)) { if (st.u8(F + OFF.FLEET.MISSION) !== 7) home(); return; }
    }
    if (st.u8(F + OFF.FLEET.MISSION) !== 7) home();
    if ((st.u8(G + 0x29) & 0x40) || !(st.u8(G + 0x29) & 1) || (st.u8(G + 0x29) & 0x10)) return;
    for (let n = 10, S = G + 0x7c; n > 0; n--, S -= 9) {                       // 攻方扣对象的水手 (由第 10 个船位往前)
      if (!this.present(S)) continue;
      const s = st.u8(S + OFF.DOCK_SLOT.DURABILITY);
      if (s > a) { st.set8(S + OFF.DOCK_SLOT.DURABILITY, s - a); break; }
      a -= s; st.set8(S + OFF.DOCK_SLOT.FLAGS, st.u8(S + OFF.DOCK_SLOT.FLAGS) & 0xef);
      const q = faIdiv(st.u16(G + 0x22), 5); st.set16(G + 0x22, st.u16(G + 0x22) - q);
      st.set16(F + OFF.FLEET.CARGO_AMT, st.u16(F + OFF.FLEET.CARGO_AMT) + faUmin(1000 - st.u16(F + OFF.FLEET.CARGO_AMT), q));
      st.set8(F + OFF.FLEET.CARGO_GOOD, st.u8(G + 0x21));
      const q2 = Math.trunc(st.u16(G + 0x24) / 5); st.set16(G + 0x24, st.u16(G + 0x24) - q2);
      st.set16(F + OFF.FLEET.FUNDS, st.u16(F + OFF.FLEET.FUNDS) + faUmin(60000 - st.u16(F + OFF.FLEET.FUNDS), q2));
    }
    this.strength(G);
    if (!(st.u8(G + 0x29) & 1)) { this.release(G); home(); }
    let c = b;
    for (let n = 10, S = F + 0x7c; n > 0; n--, S -= 9) {                       // 对象扣攻方
      if (!this.present(S)) continue;
      const s = st.u8(S + OFF.DOCK_SLOT.DURABILITY);
      if (s > c) { st.set8(S + OFF.DOCK_SLOT.DURABILITY, s - c); break; }
      c -= s; st.set8(S + OFF.DOCK_SLOT.FLAGS, st.u8(S + OFF.DOCK_SLOT.FLAGS) & 0xef);
    }
    this.strength(F);
    if (!(st.u8(F + OFF.FLEET.FLAGS) & 1)) this.release(F);
    const bd = this.v.bdb8 & 0xff, tn = Math.trunc(st.u8(Pd + 0x2c) / 10);   // 对象国籍 (提督已离开时 +2c = FF)
    let Nb = 0;
    if (bd < 6) { Nb = faNation(bd); const d = this.rnd(2) + 2, r = st.u8(Nb + 0x0b + tn); st.set8(Nb + 0x0b + tn, r - faUmin(r, d)); }
    if (tn < 6) {
      const M = faNation(tn);
      if (bd < 6) st.set8(M + OFF.COUNTRY.RELATIONS + bd, st.u8(Nb + 0x0b + tn));
      else { const d = this.rnd(2) + 2, r = st.u8(M + OFF.COUNTRY.RELATIONS + bd); st.set8(M + OFF.COUNTRY.RELATIONS + bd, r - faUmin(r, d)); }
    }
  }
  // 0fea:a22a = 1a0ca 下一个点
  nextPoint(F) {
    const st = this.st, sea = this.sea;
    if ((st.u8(F + 0x0d) & 0x40) && this.same(F + OFF.FLEET.DEST_X, F) && !sea.route(F)) {
      if (!(st.u8(F + OFF.FLEET.FLAGS) & 0x40)) this.goPort(0, st.u8(F + OFF.FLEET.HOME_PORT), F);
      return { x: st.u16(F), y: st.u16(F + OFF.FLEET.Y) };
    }
    if (st.u8(F + 0x0d) & 0x80) return { x: st.u16(F + OFF.FLEET.MID_X), y: st.u16(F + OFF.FLEET.MID_Y) };
    if (st.u8(F + 0x0d) & 0x20) return { x: st.u16(F + OFF.FLEET.DEST_X), y: st.u16(F + OFF.FLEET.DEST_Y) };
    const n = st.u16(F + OFF.FLEET.ROUTE_PTS + 2 * (st.u8(F + OFF.FLEET.ROUTE_FLAGS) & 7));
    return { x: sea.nodeW(n, 0) & 0x7fff, y: sea.nodeW(n, 2) };
  }
  // 到了目的地: 任务 4 → random(10) = 0 时回母港; 5..8/10 → 换成对象位置; 其他 1a16d 进港
  atDest(F, ai1ac19) {
    const st = this.st, b = st.u8(F + OFF.FLEET.MISSION);
    if (b === 4) { if (ai1ac19 && !this.rnd(10)) this.goPort(0, st.u8(F + OFF.FLEET.HOME_PORT), F); return; }
    if ((b >= 5 && b <= 8) || b === 10) this.followTarget(F, true);
    else this.arrive(F);
  }
  // 1a1e0 一天跳到 T (T 在区域内时停在区域边上的海面入口)
  jump(T, F) {
    const st = this.st, sea = this.sea, rg = sea.region & 0xffff;
    const left = faS16(Math.imul(((30 * (sea.item & 0xff)) & 0xffff) + rg % 30, 24)), top = faS16(Math.imul(Math.trunc(rg / 30), 24));
    const q = (a, b, c) => Math.trunc(faS16(Math.imul(faS16(a), faS16(b))) / faS16(c));     // imul 后 cwd: 只取乘积的低 16 比特
    const land = (x, y) => this.land(x & 0xffff, y & 0xffff), tx = faS16(T.x), ty = faS16(T.y);
    let si, y2;
    if (sea.inRegion(T.x, T.y)) {
      let di = faS16(st.u16(F)); y2 = faS16(st.u16(F + OFF.FLEET.Y));
      if (Math.abs(faS16(st.u16(F) - T.x)) >= 0x438) di = faS16(tx > di ? di + 0x870 : di - 0x870);
      if (left > di) {
        y2 = faS16(y2 + q(ty - y2, left - di, tx - di)); di = left;
        if (land(di, y2)) { y2 = top; while (faS16(top + 0x47) > y2 && land(di, y2)) y2 = faS16(y2 + 1); }
      } else if (!(faS16(left + 0x48) > di)) {
        y2 = faS16(y2 + q(ty - y2, left - di + 0x46, tx - di)); di = faS16(left + 0x46);
        if (land(di, y2)) { y2 = top; while (faS16(top + 0x47) > y2 && land(di, y2)) y2 = faS16(y2 + 1); }
      }
      if (y2 < top) {
        di = faS16(di + q(tx - di, top - y2, ty - y2)); y2 = top;
        if (!land(di, y2)) si = di;
        else { si = left; while (faS16(left + 0x47) > si && land(si, y2)) si = faS16(si + 1); }
      } else if (faS16(top + 0x48) > y2) si = di;
      else {
        di = faS16(di + q(tx - di, top - y2 + 0x46, ty - y2)); y2 = faS16(top + 0x46);
        if (!land(di, y2)) si = di;
        else { si = left; while (faS16(left + 0x47) > y2 && land(si, y2)) si = faS16(si + 1); }   // 原版这里比较的是 y, 不是 si
      }
    } else { si = tx; y2 = ty; }
    st.set16(F, faImod(si + 0x870, 0x870)); st.set16(F + OFF.FLEET.Y, faImod(y2 + 0x438, 0x438));
    if (this.same(F + OFF.FLEET.DEST_X, F)) this.atDest(F, true);
    if (this.inRegion(F)) sea.route(F);
  }
  // 1a16d 进港 / 到达
  arrive(F) {
    const st = this.st, b = st.u8(F + OFF.FLEET.MISSION);
    st.set8(F + OFF.FLEET.FLAGS, st.u8(F + OFF.FLEET.FLAGS) | 0x30);
    let A = 0;
    if (b <= 2 || b === 9) A = faPort(st.u8(F + OFF.FLEET.TARGET));
    else if (b === 3) st.set8(F + OFF.FLEET.FLAGS, st.u8(F + OFF.FLEET.FLAGS) & 0xef);
    else if ((b >= 5 && b <= 8) || b === 10) A = faFleet(st.u8(this.P(st.u8(F + OFF.FLEET.TARGET)) + 0x2c));
    if (A) { st.set16(F, st.u16(A)); st.set16(F + OFF.FLEET.Y, st.u16(A + 2)); }
    st.set8(F + OFF.FLEET.STAY_DAYS, this.rnd(8) + 8);
    this.mission(F);
  }
  // 1ac19 (调用前 [c2ea] = k)
  async daily(F) {
    const st = this.st;
    if (!(st.u8(F + OFF.FLEET.FLAGS) & 1)) return;
    if (st.port === 0xff && this.inRegion(F)) { st.set8(F + 0x0d, st.u8(F + 0x0d) | 0x80); return; }
    if (F === this.heroFleet) return;
    this.retarget(F);
    this.decide(F);
    const di = this.cellTarget(F);
    if (di !== 0xff) { if (!this.inRegion(faFleet(st.u8(this.P(di) + 0x2c)))) await this.fight(di, F); return; }
    if (st.u8(F + OFF.FLEET.FLAGS) & 0x10) { this.mission(F); if (st.u8(F + OFF.FLEET.FLAGS) & 0x10) return; }
    if (this.sea.route(F)) this.jump(this.nextPoint(F), F);
  }

  // ================= 海上每个时刻 1afe8 =================
  // 1ae55 走一步 (没有海流): 挡住返回 1
  step(F, dir, speed) {
    const st = this.st, sea = this.sea;
    const ex = faS8(sea.dsb(0x0718 + dir)), ey = faS8(sea.dsb(0x0720 + dir)), sp = faS8(speed);   // 路线失败时方向 = FF, 原版照样读 DS:0718 / 0720 表外
    const ax = (ex * sp) & 0xff, ay = (ey * sp) & 0xff;
    const nx = (ax + st.u8(F + OFF.FLEET.SUB_X)) & 0xff, ny = (ay + st.u8(F + OFF.FLEET.SUB_Y)) & 0xff;
    let di = faImod(st.u16(F), 0x2d0), y2 = faS16(st.u16(F + OFF.FLEET.Y)), b6 = 0, b7 = 0, out = 0;
    if (nx >= 0x3c) { if (faS8(ax) < 0) { di--; b6 = 0x3c; } else { di++; b6 = 0xc4; } }
    if (ny >= 0x3c) { if (faS8(ay) < 0) { y2--; b7 = 0x3c; } else { y2++; b7 = 0xc4; } }
    const bda6 = faS16(sea.bda6), bdaa = faS16(sea.bdaa);
    if (bda6 > di || !(faS16(bda6 + 0x48) > di)) { di = faS16(di + faSgn(faS8(ax))); y2 = faS16(st.u16(F + OFF.FLEET.Y)); out = 1; }
    if (bdaa > y2 || !(faS16(bdaa + 0x48) > y2)) { di = faImod(st.u16(F), 0x2d0); y2 = faS16(y2 + faSgn(faS8(ay))); out = 1; }
    if (!out && this.land(di & 0xffff, y2 & 0xffff)) {
      if (this.land((st.u16(F) + ex) & 0xffff, (st.u16(F + OFF.FLEET.Y) + ey) & 0xffff)) return 1;
      st.set8(F + OFF.FLEET.SUB_X, nx); st.set8(F + OFF.FLEET.SUB_Y, ny);
      if (b6) st.set8(F + OFF.FLEET.SUB_X, faS8(ax) > 0 ? 0x3b : 0);
      if (b7) st.set8(F + OFF.FLEET.SUB_Y, faS8(ay) > 0 ? 0x3b : 0);
      return 0;
    }
    st.set16(F, faImod(di + faS16(Math.imul(sea.item & 0xff, 0x2d0)) + 0x870, 0x870));
    st.set16(F + OFF.FLEET.Y, faImod(y2 + 0x438, 0x438));
    st.set8(F + OFF.FLEET.SUB_X, nx + b6); st.set8(F + OFF.FLEET.SUB_Y, ny + b7);
    return 0;
  }
  // 1afe8 每支舰队 (先查鼠标右键); 循环以全域 [c2ea] 判断结束 (舰队指针另外递增): 途中开战 → 回到海上 851f → 6aae 把 [c2ea] 设成 0x46 → 这一轮剩下的舰队不处理
  async seaTick() {
    const st = this.st, sea = this.sea, { sys, palette } = this.c;
    const w1 = st.u8(DS.PORT_FLAGS), w2 = st.u8(DS.WIND_CUR);
    const wDir = (w1 & 0x38) >> 3, wStr = w1 & 7, cDir = (w2 & 0x38) >> 3, cStr = w2 & 7;
    let k = 0;
    for (this.v.c2ea = 0; !palette.ending && this.v.c2ea < 0x46; k++, this.v.c2ea = (this.v.c2ea + 1) & 0xff) {
      if (sys.mouseEvent() === 0x82) sea.a9c8 |= 1;
      const F = faFleet(k);
      if (F === this.heroFleet || !(st.u8(F + OFF.FLEET.FLAGS) & 1)) continue;
      if (this.c.noFleets) continue;                                          // 测试: 原版 1b048 改成不处理
      if (st.u8(F + OFF.FLEET.FLAGS) & 0x10) { if (this.c.rt.time === 0) this.mission(F); if (st.u8(F + OFF.FLEET.FLAGS) & 0x10) continue; }
      if (this.land(st.u16(F), st.u16(F + OFF.FLEET.Y))) continue;
      if (st.port !== 0xff || !this.inRegion(F)) { st.set8(F + 0x0d, st.u8(F + 0x0d) & 0x7f); continue; }
      const t = this.contact(F);
      if (t !== 0xff) { await this.fight(t, F); continue; }
      if (this.same(F + OFF.FLEET.DEST_X, F) && st.u8(F + OFF.FLEET.MISSION) !== 4) this.atDest(F, false);
      let d = sea.autoSteer(F) & 0xff;                                        // 2e09:3321 = 313b1 (失败 = FF)
      if (d === 8) { st.set8(F + OFF.FLEET.FLAGS, st.u8(F + OFF.FLEET.FLAGS) | 0x20); continue; }
      st.set8(F + OFF.FLEET.DIR, d);
      const v = sea.fleetSpeed(F, wDir, wStr, cStr, cDir) & 0xff;            // 1acbf
      if (this.step(F, d, v)) {
        d = (d + 1) & 7;
        if (this.step(F, d, v)) { d = (d - 2) & 7; if (this.step(F, d, v)) sea.pathStep(F, sea.pt(F + OFF.FLEET.MID_X), 0); }   // 1fd9:44d8 = 24268
      }
    }
  }
  // 6aae 区域改变时: 区域内、出航中、非 bit5 的他舰队 — 在陆地上 → 1a0ca (结果不用); 中途点在区域内且是陆地 → 重新搜索路线
  regionChange() {
    const st = this.st;
    for (let k = 0; k < 0x46; k++) {
      this.v.c2ea = k;
      const F = faFleet(k);
      if (!(st.u8(F + OFF.FLEET.FLAGS) & 1) || !this.inRegion(F) || (st.u8(F + OFF.FLEET.FLAGS) & 0x20) || F === this.heroFleet) continue;
      if (this.land(st.u16(F), st.u16(F + OFF.FLEET.Y))) this.nextPoint(F);
      if (this.inRegion(F + OFF.FLEET.MID_X) && this.land(st.u16(F + OFF.FLEET.MID_X), st.u16(F + OFF.FLEET.MID_Y))) {
        st.set16(F + OFF.FLEET.ROUTE_FLAGS, st.u16(F + OFF.FLEET.ROUTE_FLAGS) & 0x100); st.set8(F + 0x0d, st.u8(F + 0x0d) | 0x40);
      }
    }
    this.v.c2ea = 0x46;
  }
}
