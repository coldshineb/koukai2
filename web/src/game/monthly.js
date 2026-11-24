// game/monthly.js — 月末 18ff5 / 年末 16126 (MAIN.EXE 0fea 段 178a8..18ff5、16126), 依 docs/RE_NOTES.md 第 29.2–29.3 節
// 港口與海上共用; 與艦隊 AI (fleetai.js) 共用 18299 戰力、33921 去港 與執行期變數 [c2ea]
import { faFleet, faNation, faPort, faEcon, faUmin, faUmax, faLdiv, faLmul } from "./fleetai.js";
import { DS, OFF } from "../model/schema_views.ts";

const moS16 = v => (v << 16) >> 16;
const moWarned = new Set();
const moTodo = n => { if (!moWarned.has(n)) { moWarned.add(n); console.warn("尚未移植: " + n); } };

export class Monthly {
  constructor(ai) { this.ai = ai; }
  get c() { return this.ai.c; }
  get st() { return this.ai.st; }
  get T() { return this.ai.T; }
  rnd(n) { return this.ai.rnd(n); }
  P(n) { return this.ai.P(n); }
  present(S) { return this.ai.present(S); }

  // 18ff5 月末
  async monthEnd() {
    if (this.c.palette.ending) return;                                           // [03ea] ≠ 0
    this.season();                                                               // 178a8
    this.interest();                                                             // 17929
    this.economy();                                                              // 179e8
    this.power(); this.enemies(); this.policy(); this.targets();                 // 18add: 17a80, 17fbc (17c19 / 17d82 / 17edb)
    this.diplomacy();                                                            //        181ed
    this.reinforce(0x182df); this.reinforce(0x183d3); this.reinforce(0x184c8); this.launch(); this.aid();   // 18ac8
    this.persons(); this.rivals(); this.upgrade(); await this.salary();          // 18fe4: 18aee, 18c58, 18cfb, 18e7f
    this.st.set8(DS.DAY, 0);                                                     // 下個月從 1 號開始
  }
  // 16126 年末
  yearEnd() {
    const st = this.st, rt = this.c.rt;
    st.set8(DS.MONTH, 0);                                                          // [0caa] (存檔的年) 不更新
    rt.year = (rt.year + 1) & 0xff;
    if (rt.year > 0x34) this.c.palette.ending = 0x10;                            // 1552 年 → 遊戲結束 (1764f(0x10) 未移植)
    this.ai.sea.seaYear();                                                       // 71ad
    for (let p = 0; p < 0x78; p++) { const Q = this.P(p); st.set8(Q + 0x2a, st.u8(Q + 0x2a) + 1); }
    for (let g = 0; g < 0x1e; g++) { const G = DS.TBL_BARMAID + 0x13 * g; st.set8(G + 0x0d, st.u8(G + 0x0d) + 1); }
  }

  // 178a8 3 月底 / 9 月底換季: 重讀風向表 (夏 / 冬), 隨身物 0x23..0x28 消失
  season() {
    const st = this.st, m = this.c.rt.month;
    if (m % 6 !== 2) return;
    this.c.windOffset = m === 2 ? 0 : 0x1c2;
    for (let i = 0; i < 0x14; i++) { const v = st.u8(DS.INVENTORY + i); if (v >= 0x23 && v <= 0x28) st.set8(DS.INVENTORY + i, 0xff); }
  }
  // 17929 銀行利息 (存款 3%、借款 10%)
  interest() {
    const st = this.st, q0 = moS16(st.u16(DS.BANK_QUOTIENT)), bal = (Math.imul(100, q0) + st.u8(DS.BANK_REM)) | 0;
    let nb = (bal + faLdiv(faLmul(bal, q0 >= 0 ? 3 : 10), 100)) | 0;
    if (nb > 1000000) nb = 1000000; else if (nb < -1000000) nb = -1000000;
    const q = nb >= 0 ? faLdiv(nb, 100) : faLdiv(nb - 99, 100);
    st.set16(DS.BANK_QUOTIENT, q & 0xffff); st.set8(DS.BANK_REM, ((q & 0xff) * 0x9c + (nb & 0xff)) & 0xff);
  }
  // 179e8 本月投資 → 商業 / 工業值, 物價指數向 50 回歸
  economy() {
    const st = this.st;
    for (let p = 0; p < 100; p++) {
      const E = faEcon(p);
      st.set16(E, faUmin(1000, st.u16(E) + Math.trunc(st.u16(E + OFF.PORT_ECONOMY.COMMERCE_INVEST) / 300)));
      st.set16(E + OFF.PORT_ECONOMY.INDUSTRY, faUmin(1000, st.u16(E + OFF.PORT_ECONOMY.INDUSTRY) + Math.trunc(st.u16(E + OFF.PORT_ECONOMY.INDUSTRY_INVEST) / 300)));
      st.set16(E + OFF.PORT_ECONOMY.INDUSTRY_INVEST, 0); st.set16(E + OFF.PORT_ECONOMY.COMMERCE_INVEST, 0);
      for (let i = 0; i < 10; i++) { const r = this.rnd(5) + 1, v = st.u8(E + OFF.PORT_ECONOMY.PRICES + i); st.set8(E + OFF.PORT_ECONOMY.PRICES + i, v > 50 ? v - r : v + r); }
    }
  }
  // 17a80 國力 N +0
  power() {
    const st = this.st, A = new Uint16Array(64), B = new Uint16Array(64), D = this.T.powerDiv;
    for (let p = 0; p < 100; p++) {
      const R = faPort(p), E = faEcon(p), k = (((st.u8(R + 0x15) & 7) << 3) + st.u8(E + OFF.PORT_ECONOMY.REGION_GROUP)) & 63;
      A[k] += st.u16(E + OFF.PORT_ECONOMY.INDUSTRY);
      B[k] += Math.imul(st.u8(R + 0x15) & 8 ? 2 : 1, st.u16(E));
    }
    let total = 0;
    for (let n = 0; n < 6; n++) {
      const a = k => A[n * 8 + k], b = k => Math.trunc(B[n * 8 + k] / D[k]);
      let v = b(0);
      for (let k = 4; k < 8; k++) { if (a(k) >= 300) v += b(k); else break; }
      for (let k = 1; k < 3; k++) if (a(k) >= 300) v += b(k);
      if ((a(2) >= 300 || a(4) >= 300) && a(3) >= 300) v += b(3);
      st.set16(faNation(n), v & 0xffff); total += moS16(v);
    }
    st.set16(faNation(6), faLdiv(total, 6) & 0xffff);
  }
  // 17c19 敵對國 N +2 (7 = 主角)
  enemies() {
    const st = this.st, H = this.ai.heroData;
    for (let i = 0; i < 6; i++) {
      const Ni = faNation(i); let best = 7, min = 0xffff;
      for (let j = 0; j < 7; j++) {
        if (j === i) continue;
        const v = faLdiv(faLmul(st.u8(Ni + 0x0b + j), moS16(st.u16(faNation(j)))), 100) & 0xffff;
        if (v < min) { min = v; best = j; }
      }
      const cx = Math.abs(moS16(200 - st.u8(H + 6 + i)));
      const r = (this.rnd(180 - st.u8(Ni + 9)) + 100) & 0xffff;
      st.set8(Ni + 2, r < cx ? 7 : best);
    }
    const N6 = faNation(6); let best = 0, max = 0;
    for (let d = 0; d < 6; d++) {
      const v = Math.imul((100 - st.u8(N6 + 0x0b + d)) & 0xffff, st.u16(faNation(d))) & 0xffff;
      if (v > max) { max = v; best = d; }
    }
    const cx = Math.abs(moS16(200 - st.u8(H + 6 + 6)));
    st.set8(N6 + 2, this.rnd(50) + 100 < cx ? 7 : best);
  }
  // 17d82 方針 N +3
  policy() {
    const st = this.st;
    for (let i = 0; i < 6; i++) {
      const Ni = faNation(i); let t = st.u8(Ni + 2);
      if (t >= 7) t = st.u8(this.ai.heroRec + 0x31) & 0x0f;
      const Tn = faNation(t), pt = moS16(st.u16(Tn)), pi = moS16(st.u16(Ni));
      if (this.rnd(pt >= pi ? 120 : 90) < st.u8(Ni + 9)) st.set8(Ni + 3, pt > pi ? 4 : 5);   // 17d3a (先寫的 3 / 6 被覆蓋)
      else st.set8(Ni + 3, this.rnd(3));                                                    // 17d6c
    }
    const N6 = faNation(6); st.set8(N6 + 3, st.u8(N6 + 2) === 7 ? 7 : 8);
  }
  // 17edb 目標港 N +4 (條件函式表 DS:a3e2)
  targets() {
    const st = this.st, heroNat = () => st.u8(this.ai.heroRec + 0x31);
    const nat = R => st.u8(R + 0x15) & 7, cap = n => st.u8(faNation(n) + 0x0a);
    const fns = [
      (i, p, R) => nat(R) === 6,                                                  // 17e06 無所屬
      (i, p, R, Ni) => nat(R) === i && st.u8(Ni + 0x0a) !== p,                    // 17e20 本國的非首都
      (i, p) => p >= 0x4b && p <= 0x5c,                                           // 17e46
      (i, p, R) => !((st.u8(R + 0x15) ^ heroNat()) & 7) && cap(nat(R)) !== p,     // 17e5b 主角國籍的非首都
      (i, p, R, Ni) => { const t = st.u8(Ni + 2) === 7 ? heroNat() & 0x0f : st.u8(Ni + 2); return nat(R) === t && cap(nat(R)) !== p; },   // 17e94
    ];
    const FN = [fns[0], fns[1], fns[2], fns[3], fns[4], fns[4], fns[0]], NEXT = [1, 2, 2, 0, 0, 0, 1];
    for (let i = 0; i < 6; i++) {
      const Ni = faNation(i); let pick = 0xff, found = 0, act = st.u8(Ni + 3), guard = 0;
      while (pick === 0xff) {
        if (act > 6 || ++guard > 10000) { moTodo("17edb 找不到目標港 (原版無限迴圈)"); break; }
        for (let p = 0; pick === 0xff && p < 100; p++) if (FN[act](i, p, faPort(p), Ni)) { found = 1; if (this.rnd(5) === 0) pick = p; }
        if (!found) act = NEXT[act];
      }
      st.set8(Ni + 4, pick);
    }
  }
  // 181ed 外交 (6 × 6)
  diplomacy() {
    const st = this.st;
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
      if (i === j) { st.set8(faNation(i) + 0x12 + j, 0); continue; }
      this.relState(i, j); this.relAct(i, j);
    }
  }
  // 17fc9 i 對 j 的關係 (DS:a3fe 表)
  relState(i, j) {
    const st = this.st, Ni = faNation(i), Nj = faNation(j), pi = moS16(st.u16(Ni)), pj = moS16(st.u16(Nj));
    const cls = Math.trunc(pi / 2) > pj ? 0 : Math.trunc(pj / 2) > pi ? 1 : pj < pi ? 2 : 3;
    const f = st.u8(Ni + 0x12 + j), fc = f & 0x20 ? 0 : f & 0x10 ? 1 : 2, rel = st.u8(Ni + 0x0b + j);
    let v = this.T.diplo[3 * (4 * Math.trunc((rel + 9) / 40) + cls) + fc] ?? 0;
    switch (v) {
      case 7: v = this.rnd(100) < rel ? 3 : 0; break;
      case 8: v = this.rnd(100) <= rel ? 0 : 2; break;
      case 9: v = this.rnd(20) + 30 <= rel ? 0 : 2; break;
      case 10: v = this.rnd(10) + 30 > rel ? 2 : 0; break;
    }
    st.set8(Ni + 0x12 + j, (f & 0xf0) | v);
  }
  // 18162 關係 1 → 友好度上升 (雙方相同); 4 → 依國力比 奪港 180d0
  relAct(i, j) {
    const st = this.st, Ni = faNation(i), Nj = faNation(j), f = st.u8(Ni + 0x12 + j);
    if (f === 1) { const v = (st.u8(Nj + 0x0b + i) + this.rnd(5) + 3) & 0xff; st.set8(Nj + 0x0b + i, v); st.set8(Ni + 0x0b + j, v); }
    else if (f === 4) {
      const pj = moS16(st.u16(Nj)), lim = pj ? faUmin(faLdiv(faLmul(10, moS16(st.u16(Ni))), pj), 50) : 50;
      if (this.rnd(50) < lim) this.capture(i, j);
    }
  }
  // 180d0 由港 99 往下第一個 j 國、非 j 首都的港歸 i
  capture(i, j) {
    const st = this.st;
    for (let p = 99; p >= 0; p--) {
      const R = faPort(p);
      if ((st.u8(R + 0x15) & 7) !== j || st.u8(faNation(j) + 0x0a) === p) continue;
      st.set8(R + 0x15, (st.u8(R + 0x15) & 0xf8) | i);
      st.set8(faEcon(p) + 8 + i, this.rnd(10) + 0x50);
      st.set8(faNation(i) + 0x19 + i, p);
      return;
    }
  }
  // 18238 船位 S 依範本船初始化 (k: +8 的耐久等級)
  initSlot(k, S) {
    const st = this.st, ship = DS.TBL_SHIP + 0x16 * st.u8(S + OFF.DOCK_SLOT.SHIP), T = DS.TBL_SHIP_TYPE + 0x0c * st.u8(ship + 0x0f);
    st.set8(S + OFF.DOCK_SLOT.MAX_DURABILITY, st.u8(T + 1)); st.set8(S + OFF.DOCK_SLOT.DURABILITY, st.u8(T + 1)); st.set8(S + OFF.DOCK_SLOT.TURN, st.u8(T + 2)); st.set8(S + OFF.DOCK_SLOT.PROPULSION, st.u8(T + 3));
    st.set8(S + OFF.DOCK_SLOT.GUNS, st.u8(ship + 0x11));
    const r = this.rnd(3);
    st.set8(S + OFF.DOCK_SLOT.FLAGS, ((r - 3 * k + 4) & 0xff) | 0x10);
    st.set16(S, st.u16(ship + 0x12));
  }
  // 182df / 183d3 / 184c8 各國艦隊補船
  reinforce(which) {
    const st = this.st;
    const cfg = { 0x182df: [50, 1, 5, this.T.fleetA, 0x28, 0], 0x183d3: [75, 5, 7, this.T.fleetB, 0x30, 1], 0x184c8: [75, 7, 10, this.T.fleetC, 0x28, 1] }[which];
    const [div, k0, k1, tab, add, kk] = cfg;
    for (let n = 0; n < 7; n++) {
      const pw = moS16(st.u16(faNation(n)));
      let cnt = (Math.trunc(pw / div) + 5) | 0, tier = Math.trunc(pw / 500); if (tier >= 3) tier = 2;
      const ship = () => ((tab[n * 3 + tier] ?? 0) >> (this.rnd(3) * 4)) & 0x0f;
      let k = k0, F = faFleet((10 * n + k0) & 0xff);
      if (which === 0x184c8) {                                                   // 迴圈 (數量 − 1) 次, 每支補滿空位
        while ((cnt = (cnt - 1) & 0xffff) !== 0 && k < k1) {
          for (let j = 0; j < 10; j++) {
            const S = F + OFF.FLEET.SHIPS + 9 * j;
            if (!this.present(S)) { st.set8(S + OFF.DOCK_SLOT.SHIP, ship() + add); this.initSlot(kk, S); }
            if (st.u8(F + OFF.FLEET.FLAGS) & 1) break;
          }
          this.ai.strength(F); F += 0x85; k++;
        }
        continue;
      }
      while (cnt !== 0 && k < k1) {                                              // 182df / 183d3: 總共補 數量 艘
        for (let j = 0; cnt !== 0 && j < 10; j++) {
          const S = F + OFF.FLEET.SHIPS + 9 * j;
          if (!this.present(S)) { st.set8(S + OFF.DOCK_SLOT.SHIP, ship() + add); this.initSlot(kk, S); cnt = (cnt - 1) | 0; }
          if (st.u8(F + OFF.FLEET.FLAGS) & 1) break;
        }
        this.ai.strength(F); F += 0x85; k++;
      }
    }
  }
  // 1897e 船夠多 (≥ random(2) + 4) 的港內艦隊派提督出港
  launch() {
    const st = this.st;
    for (let k = 0; k < 0x46; k++) {
      const F = faFleet(k);
      if (k % 10 === 0 || (st.u8(F + OFF.FLEET.FLAGS) & 1)) continue;
      let c = 0; for (let j = 0; j < 10; j++) if (this.present(F + OFF.FLEET.SHIPS + 9 * j)) c++;
      if (this.rnd(2) + 4 <= c) this.assign(k, F);
    }
  }
  // 18824 選提督 (或產生新人物) → 18772 出港
  assign(k) {
    const st = this.st, nat = Math.trunc(k / 10), free = () => { for (let q = 6; q < 0x78; q++) if (!(st.u8(this.P(q) + 0x31) & 0x20)) return q; return 0xff; };
    let p = 0xff;
    if (k < 0x3c) {
      if (this.rnd(2) === 0) {
        for (let q = 6; q < 0x78; q++) { const Q = this.P(q), f = st.u8(Q + 0x31); if ((f & 0x0f) === nat && !(f & 0x10) && (f & 0x20) && st.u8(Q + 0x2c) === 0xff) { p = q; break; } }
      } else { const q = free(); if (q !== 0xff) { this.newPerson(q, nat, this.rnd(2)); p = q; } }
    } else if (this.rnd(2) === 0) {
      for (let q = 6; q < 0x78; q++) { const Q = this.P(q); if (st.u8(Q + 0x2c) === 0xff && (st.u8(Q + 0x2f) & 3) >= 2 && (st.u8(Q + 0x31) & 0x20)) { p = q; break; } }
    } else { const q = free(); if (q !== 0xff) { this.newPerson(q, this.rnd(6), 2); p = q; } }
    if (p === 0xff) return;
    const Q = this.P(p); st.set8(Q + 0x2c, k); st.set8(Q + 0x2d, 0xff); st.set8(Q + 0x2e, 1);
    this.launchFleet(nat, k, p);
  }
  // 18772 艦隊 k 由首都出港 (任務 0)
  launchFleet(n, k, p) {
    const st = this.st, N = faNation(n), capital = st.u8(N + OFF.COUNTRY.CAPITAL_PORT), R = faPort(capital), F = faFleet(k);
    this.ai.v.c2ea = k;
    st.set16(F, st.u16(R)); st.set16(F + OFF.FLEET.Y, st.u16(R + 2));
    this.ai.goPort(0, capital, F);
    st.set16(F + OFF.FLEET.FUNDS, this.rnd(3) + Math.trunc(moS16(st.u16(N)) / 10) + 1);
    st.set8(F + OFF.FLEET.CARGO_GOOD, 0xff); st.set16(F + OFF.FLEET.CARGO_AMT, 0);
    for (let i = 0; i < 4; i++) st.set8(F + 0x1d + i, 0xff);
    st.set8(F + OFF.FLEET.HOME_PORT, capital); st.set8(F + OFF.FLEET.STAY_DAYS, this.rnd(10) + 5); st.set8(F + OFF.FLEET.FLAGS, 0x31); st.set8(F + OFF.FLEET.ADMIRAL, p);
    this.ai.strength(F);
  }
  // 185a7 新人物 (NAME.TBL 6 國 × 16 筆 × 26 bytes: 名 13 + 姓 13)
  newPerson(p, nat, kind) {
    const st = this.st, Q = this.P(p), NT = (this.c.nameTbl ??= Uint8Array.from(this.c.portAssets.fleet.names.match(/../g).map(h => parseInt(h, 16))));
    const eq = (a, b) => { for (let i = 0; ; i++) { const x = st.u8(a + i), y = st.u8(b + i); if (x !== y) return false; if (!x) return true; } };   // seg0:4bea
    for (;;) {
      const o1 = (this.rnd(16) + nat * 16) * 26; for (let i = 0; i < 13; i++) st.set8(Q + i, NT[o1 + i] ?? 0);
      const o2 = (this.rnd(16) + nat * 16) * 26 + 13; for (let i = 0; i < 13; i++) st.set8(Q + 0x0d + i, NT[o2 + i] ?? 0);
      let dup = false;
      for (let q = 0; q < 0x78 && !dup; q++) { if (q === p) continue; const R = this.P(q); if (eq(R + 0x0d, Q + 0x0d) && eq(R, Q)) dup = true; }
      if (!dup) break;
    }
    st.set8(Q + 0x2a, this.rnd(16) + 20);
    for (let i = 0; i < 8; i++) st.set8(Q + 0x1c + i, this.rnd(0x23) + 0x3c);
    for (const o of [0x24, 0x25]) { const lo = this.rnd(5) + 8, v = this.rnd(4) + st.u8(Q + o) + 2; st.set8(Q + o, faUmin(faUmax(v, lo), 100)); }
    st.set16(Q + 0x28, 0); st.set16(Q + 0x26, 0);
    st.set8(Q + 0x2f, (this.rnd(16) << 4) + kind);
    st.set8(Q + 0x30, this.rnd(16));
    st.set8(Q + 0x31, nat | 0x20);
    st.set16(Q + 0x1a, this.rnd(0x3fff) | 0xc000);
  }
  // 189f6 主角對各國聲望 → 援助 (N +5..+8)
  aid() {
    const st = this.st, H = this.ai.heroData;
    for (let n = 0; n < 6; n++) {
      const N = faNation(n), s = st.u8(H + 6 + n);
      if (s >= 0x82) {
        const pw = faLmul(st.u8(H + 0x0d), moS16(st.u16(N)));
        st.set8(N + OFF.COUNTRY.AID_MONEY_K, faUmin((st.u8(N + OFF.COUNTRY.AID_MONEY_K) + faLdiv(pw, 3000)) & 0xff, 100));
        st.set8(N + 6, faUmin((st.u8(N + 6) + faLdiv(pw, 1000)) & 0xff, 100));
        const t = faLdiv(pw, 4000); st.set8(N + OFF.COUNTRY.AID_SHIP_TYPE, faUmin(t, 7)); st.set8(N + OFF.COUNTRY.AID_SHIP_COUNT, st.u8(N + OFF.COUNTRY.AID_SHIP_COUNT) + faUmin(t, 10));
      } else if (s < 0x46) { st.set8(N + OFF.COUNTRY.AID_MONEY_K, 0); st.set8(N + 6, 0); st.set8(N + OFF.COUNTRY.AID_SHIP_TYPE, 0xff); st.set8(N + OFF.COUNTRY.AID_SHIP_COUNT, 0); }
    }
  }
  // 18aee 人物 6..119: 流浪、空記錄產生新人物
  persons() {
    const st = this.st;
    for (let p = 6; p < 0x78; p++) {
      const Q = this.P(p), f = st.u8(Q + 0x31);
      if (f & 0x20) {
        if (!(f & 0x40) && st.u8(Q + 0x2c) === 0xff && st.u8(Q + 0x2d) !== 0xff && this.rnd(3) === 0) {
          const v = this.rnd(5) + st.u8(Q + 0x2d) - 2; st.set8(Q + 0x2d, v < 0 ? 0 : v > 0x60 ? 0x60 : v);
        }
      } else if (this.rnd(3) === 0) {
        const kind = this.rnd(3), nat = this.rnd(6);
        this.newPerson(p, nat, kind);
        st.set8(Q + 0x2d, this.rnd(0x2a)); st.set8(Q + 0x2c, 0xff);
      }
    }
  }
  // 18c58 對手 (主角 0..5 與人物 60) 追上主角的等級 (迴圈變數到 6 時改成 60, 但記錄指標已指到第 6 號人物, 原版如此)
  rivals() {
    const st = this.st, HR = this.ai.heroRec, hero = this.ai.hero;
    for (let i = 0, rec = this.P(0); i < 7; i++, rec += 0x32) {
      const di = i === 6 ? 0x3c : i;
      if (di === hero) continue;
      if (st.u8(HR + 0x24) > st.u8(rec + 0x24)) {
        const r = this.rnd(2), d = (st.u8(HR + 0x24) - st.u8(rec + 0x24) + r + 1) & 0xffff;
        st.set8(rec + 0x24, st.u8(rec + 0x24) + d); this.grow(di, d, 0);
      }
      if (st.u8(HR + 0x25) > st.u8(rec + 0x25)) {
        const r = this.rnd(2), d = (Math.trunc((st.u8(HR + 0x25) - st.u8(rec + 0x25)) / 2) + r + 1) & 0xffff;
        st.set8(rec + 0x25, st.u8(rec + 0x25) + d); this.grow(di, d, 1);
      }
    }
  }
  // 18b97 能力成長 d 次 (do-while)
  grow(p, d, kind) {
    const st = this.st, Q = this.P(p), up = (o, n) => st.set8(Q + o, faUmin(this.rnd(n) + st.u8(Q + o), 100));
    let n = d & 0xffff;
    do {
      up(0x1c, 3);
      if (kind) { up(0x20, 5); up(0x21, 5); } else { up(0x1d, 5); up(0x1e, 5); up(0x1f, 5); }
      n = (n - 1) & 0xffff;
    } while (n);
  }
  // 18cfb 對手與提督換船
  upgrade() {
    const st = this.st, HF = this.ai.heroFleet, hero = this.ai.hero;
    this.ai.strength(HF);
    const tier = Math.trunc(st.u8(this.ai.heroData + 0x0d) / 5);
    for (let p = 0; p < 0x78; p++) {
      const Q = this.P(p), fk = st.u8(Q + 0x2c);
      if (p === hero) continue;
      if (p >= 6) {
        if (!(st.u8(Q + 0x2f) & 4) || !(st.u8(Q + 0x31) & 0x20) || st.u8(Q + 0x2e) !== 1) continue;
        if (fk < 0x3c && fk % 10 < 5) continue;
      }
      if (fk >= 0x46) continue;
      const F = faFleet(fk); this.ai.strength(F);
      if (st.u8(F + OFF.FLEET.STRENGTH) >= st.u8(HF + 0x28) && this.rnd(3) === 0) continue;
      const c = p < 6 ? [0, 1, 2, 0, 0, 3][p] : fk % 10 >= 7 ? 2 : 1;
      let min = 0xff, di = 0xff;
      for (let j = 0; j < 10; j++) {
        const S = F + OFF.FLEET.SHIPS + 9 * j;
        if (!this.present(S)) { di = j; break; }
        if (st.u8(S + OFF.DOCK_SLOT.SHIP) < min) { min = st.u8(S + OFF.DOCK_SLOT.SHIP); di = j; }
      }
      if (di === 0xff) return;                                                   // 原版直接結束整個函式
      const S = F + OFF.FLEET.SHIPS + 9 * di;
      st.set8(S + OFF.DOCK_SLOT.SHIP, (((this.T.upgrade[c] ?? 0) >> ((tier * 4) & 31)) & 0x0f) + 0x31);
      this.initSlot(1, S); this.ai.strength(F);
    }
  }
  // 18e7f 薪水與忠誠
  async salary() {
    const st = this.st, { sys, message, menu, win, con } = this.c;
    let total = 0;
    for (let i = 0; i < 0x1e; i++) if (st.u8(DS.PARTY_CREW + i) !== 0xff) total += st.u8(0x2e39 + i);
    total = faLmul(total, 10);
    const gold = (st.u16(DS.MONEY) | (st.u16(0x12b0) << 16)) | 0;
    let msg;
    if (total !== 0 && total > gold) {
      for (let i = 0; i < 0x1e; i++) { const n = st.u8(DS.PARTY_CREW + i); if (n !== 0xff) { const Q = this.P(n); st.set8(Q + 0x31, st.u8(Q + 0x31) | 0x80); } }
      msg = 0x23c;
    } else { const g = (gold - total) | 0; st.set16(DS.MONEY, g & 0xffff); st.set16(0x12b0, (g >>> 16) & 0xffff); msg = 0x23e; }
    const h1c = st.u8(this.ai.heroRec + 0x1c);
    for (let i = 0; i < 0x1e; i++) {
      const n = st.u8(DS.PARTY_CREW + i); if (n === 0xff) continue;
      const Q = this.P(n); let mx = 0;
      for (let j = 0; j < 8; j++) if (st.u8(Q + 0x1c + j) > mx) mx = st.u8(Q + 0x1c + j);
      if (st.u8(Q + 0x2b) === 100) continue;
      const v = (st.u8(Q + 0x2b) + st.u8(0x2e39 + i) * 2 - mx + h1c) & 0xffff;   // 負數時 4d87 的無號 max 變成大數 → min 成 100
      st.set8(Q + 0x2b, faUmin(faUmax(0, v), 100));
    }
    if (!(st.u8(DS.WEATHER) & 0x0f) && total !== 0 && st.port === 0xff) {
      sys.mouseHide();
      this.ai.sea.b.crewSpeaks([4, 3, 5, 2, 6]);                                // seg0:9076
      message(msg, total);
      await menu.waitPrompt();                                                   // 0fea:490b
      await win.close();                                                         // 796d
      con.right = 0x50;                                                          // [8a22]
      sys.mouseShow();
    }
  }
}
