// game/fleetai.js — 其他艦隊 AI (MAIN.EXE: 每天一支 0fea 段 1ac19、海上每個時刻 1afe8、區域改變 seg0:6aae、任務 2e09 段 3407f / 33921 / 339e9)
// 依 docs/RE_NOTES.md 第 29.4–29.8 節。路線 (241c2)、自動航行方向 (313b1)、中途點 (23a97)、艦隊速度 (1acbf)、陸地 (3135c)、區域 (2317c) 沿用 scenes/sea.js 已移植的函式。
// 執行期變數 (DS, 不在存檔): [c2ea] 目前處理的艦隊、[bdb8] 任務的國家 (只在 3407f 寫入)、[bd7c] 任務中的艦隊 → ctx.aiVars
// 尚未移植 (主控台警告): 海戰本體 10f7e (第 30 節, 經 SeaScene.navalBattle 呼叫)

const faS16 = v => (v << 16) >> 16, faS8 = v => (v << 24) >> 24, faU16 = v => v & 0xffff;
export const faUmin = (a, b) => (faU16(a) > faU16(b) ? faU16(b) : faU16(a));          // seg0:4d7c
export const faUmax = (a, b) => (faU16(a) < faU16(b) ? faU16(b) : faU16(a));          // seg0:4d87
export const faLdiv = (a, b) => ((b | 0) === 0 ? 0 : Math.trunc((a | 0) / (b | 0)) | 0);   // seg0:3722 _ldiv (向零取整)
export const faLmul = (a, b) => Math.imul(a | 0, b | 0);                       // seg0:37bc _lmul (低 32 位元)
const faIdiv = (a, b) => Math.trunc(faS16(a) / faS16(b));                          // cwd; idiv (16 位元)
const faImod = (a, b) => faS16(a) % b;                                           // idiv 的餘數 (正負號同被除數)
const faSgn = v => (v < 0 ? -1 : v > 0 ? 1 : 0);                               // seg0:4dde
const faWarned = new Set();
const faTodo = n => { if (!faWarned.has(n)) { faWarned.add(n); console.warn("尚未移植: " + n); } };

export const faFleet = k => 0x2e76 + ((0x85 * (k & 0xff)) & 0xffff);     // seg0:5c28
export const faNation = n => 0x117a + ((n & 0xff) << 5);                   // seg0:5bde
export const faPort = n => 0x5f54 + 0x16 * (n & 0xff);                     // seg0:5c9a
export const faEcon = n => 0x6a80 + 0x25 * (n & 0xff);                     // seg0:5caa
// 23d7b 的 12 個相對位置 (與 23e19 相同)
const faSpot12 = [0, -2, 0, 2, 2, 0, -2, 0, -1, -2, 1, -2, 2, -1, 2, 1, -1, 2, 1, 2, -2, -1, -2, 1];

export class FleetAI {
  constructor(sea) { this.sea = sea; }
  get c() { return this.sea.c; }
  get st() { return this.sea.st; }
  get v() { return (this.c.aiVars ??= { c2ea: 0, bdb8: 0, bd7c: 0 }); }   // DS:c2ea / bdb8 / bd7c
  get T() { return this.c.portAssets.fleet.tab; }                          // assets/data/fleet.json (tools/extract_fleet.py)
  rnd(n) { n &= 0xffff; return n ? this.c.sys.rng.random(n) : 0; }        // seg0:4dc4: n = 0 時直接回傳 0 (不取亂數)
  P(n) { return this.st.personRecord(n & 0xff); }                          // seg0:5bf8
  get hero() { return this.st.u8(0x12b5); }
  get heroRec() { return this.P(this.hero); }                              // [c2ce]
  get heroFleet() { return this.sea.fleet; }                               // [c2d4]
  get heroData() { return 0x125a + 0x0e * this.hero; }                     // seg0:5be8
  get heroRank() { return this.st.u8(this.heroData + 0x0d); }              // [1267 + 0e·主角]
  present(S) { return (this.st.u8(S + 8) & 0x30) === 0x10; }
  inRegion(A) { return this.sea.inRegion(this.st.u16(A), this.st.u16(A + 2)); }          // 1fd9:33ec = 2317c (A = 座標的位址)
  same(A, B) { const st = this.st; return st.u16(A) === st.u16(B) && st.u16(A + 2) === st.u16(B + 2) ? 1 : 0; }   // 1fd9:33d4 = 23164
  land(x, y) { return this.sea.landAt(x, y); }                             // 2e09:32cc = 3135c
  goodsCat(g) { const L = this.T.goodsCat; for (let i = 0; i < 10; i++) if (L[i] > (g & 0xff)) return i; return 0; }   // 1fd9:468e = 2441e

  // 0fea:83f9 = 18299 戰力: +28 = (Σ 在的船 +2 + 4) / 5; 總和 0 → +29 &= FE
  strength(F) {
    const st = this.st; let s = 0;
    for (let i = 0; i < 10; i++) { const S = F + 0x2b + 9 * i; if (this.present(S)) s += st.u8(S + 2); }
    st.set8(F + 0x28, faIdiv(s + 4, 5) & 0xff);
    if (!s) st.set8(F + 0x29, st.u8(F + 0x29) & 0xfe);
  }
  // 1a75a 艦隊解散: 提督離開 (具名人物 9/10 機率到港 random(42), 其他記錄釋放)
  release(G) {
    const st = this.st; st.set8(G + 0x29, st.u8(G + 0x29) & 0xfe);
    const C = this.P(st.u8(G + 0x2a));
    st.set8(C + 0x2e, 0); st.set8(C + 0x2c, 0xff);
    if (!(st.u8(C + 0x1b) & 0xc0) && this.rnd(10)) st.set8(C + 0x2d, this.rnd(0x2a));
    else { st.set8(C + 0x2d, 0xff); st.set8(C + 0x31, st.u8(C + 0x31) & 0xdf); }
    st.set8(G + 0x2a, 0xff);
  }
  // 3384e 同組在海上 (非 +29 bit4) 的艦隊夠多: 商船 (k%10 = 1..4) ≥ 2 支、0 / 5..6 組 (5, 6 號) ≥ 1、7..9 組 ≥ 1
  groupBusy() {
    const st = this.st, k = this.v.c2ea & 0xff, sub = k % 10, base = k - sub;
    const cnt = (a, b) => { let n = 0; for (let j = a; j < b; j++) if (!(st.u8(faFleet(base + j) + 0x29) & 0x10)) n++; return n; };
    if (sub >= 1 && sub < 5) return cnt(1, 5) >= 2 ? 1 : 0;
    if (sub < 7) return cnt(5, 7) ? 1 : 0;
    return cnt(7, 10) ? 1 : 0;
  }
  idle(F) { const st = this.st; st.set8(F + 0x1b, 0); st.set8(F + 0x1c, st.u8(F + 0x26)); st.set8(F + 0x27, 5); }   // 33962
  // 1fd9:3feb = 23d7b 艦隊周圍第 i 個位置在區域內且不是陸地 → 該位置
  seaSpot(i, F) {
    const st = this.st, x = (st.u16(F) + faSpot12[2 * i]) & 0xffff, y = (st.u16(F + 2) + faSpot12[2 * i + 1]) & 0xffff;
    return this.sea.inRegion(x, y) && !this.land(x, y) ? { x, y } : null;
  }
  // 在港且在區域內 → 位置換成附近的海面 (都不行回傳 0)
  leavePort(F) {
    const st = this.st;
    if (!(st.u8(F + 0x29) & 0x10) || !this.inRegion(F)) return 1;
    for (let i = 0; i < 12; i++) { const W = this.seaSpot(i, F); if (W) { st.set16(F, W.x); st.set16(F + 2, W.y); return 1; } }
    return 0;
  }
  // 2e09:5891 = 33921 去港 (a = 任務, FF = 不改)
  goPort(a, port, F) {
    const st = this.st, R = faPort(port);
    if (!(a & 0xffff)) { st.set16(F + 4, st.u16(R)); st.set16(F + 6, st.u16(R + 2)); }
    if (!(st.u8(F + 0x29) & 0x40) && this.groupBusy() && (a & 0xffff)) return this.idle(F);
    if (!this.leavePort(F)) return this.idle(F);
    if ((a & 0xff) !== 0xff) st.set8(F + 0x1b, a);
    st.set8(F + 0x1c, port); st.set16(F + 4, st.u16(R)); st.set16(F + 6, st.u16(R + 2));
    st.set16(F + 0x0c, 0x4000); st.set8(F + 0x29, st.u8(F + 0x29) & 0xcf);
  }
  // 2e09:5959 = 339e9 追蹤艦隊 t
  chaseFleet(a, t, F) {
    const st = this.st, G = faFleet(t);
    if (!(st.u8(F + 0x29) & 0x40) && this.groupBusy()) return this.idle(F);
    if (!(st.u8(G + 0x29) & 1)) return this.goPort(0, st.u8(F + 0x26), F);
    if (!this.leavePort(F)) return this.idle(F);
    if ((a & 0xff) !== 0xff) st.set8(F + 0x1b, a);
    st.set8(F + 0x1c, st.u8(G + 0x2a)); st.set16(F + 4, st.u16(G)); st.set16(F + 6, st.u16(G + 2));
    st.set16(F + 0x0c, 0x4000); st.set8(F + 0x29, st.u8(F + 0x29) & 0xcf);
  }
  // 33aaf 劇本 D1: 依任務恢復目的地
  resume(F) {
    const st = this.st, b = st.u8(F + 0x1b);
    if (b <= 3 || b === 9) return this.goPort(0xff, st.u8(F + 0x1c), F);
    if (b === 4) { if (this.heroRank) this.chaseFleet(0xff, st.u8(this.heroRec + 0x2c), F); return; }
    this.chaseFleet(0xff, st.u8(this.P(st.u8(F + 0x1c)) + 0x2c), F);
  }
  // 對象人物的艦隊位置 → 目的地 (+0c = 區域內 ? 0x6000 : 0x4000)
  followTarget(F, clear) {
    const st = this.st, G = faFleet(st.u8(this.P(st.u8(F + 0x1c)) + 0x2c));
    st.set16(F + 4, st.u16(G)); st.set16(F + 6, st.u16(G + 2));
    st.set16(F + 0x0c, this.inRegion(F) ? 0x6000 : 0x4000);
    if (clear) st.set8(F + 0x29, st.u8(F + 0x29) & 0xcf);
  }

  // ================= 任務 3407f (DS:b8ae) =================
  mission(F) {
    const st = this.st, b = st.u8(F + 0x1b);
    this.v.bd7c = F;
    if (b < 3 || b === 9) {
      this.v.bdb8 = Math.trunc((this.v.c2ea & 0xff) / 10);
      if (b === 0) this.m0(); else if (b === 1) this.m1(); else if (b === 2) this.m2();     // 3..10 = 空函式
    }
  }
  countdown() { const st = this.st, F = this.v.bd7c; if (st.u8(F + 0x27)) st.set8(F + 0x27, st.u8(F + 0x27) - 1); return st.u8(F + 0x27); }   // 33c9d
  // 33cb4 任務 0 (母港): 賣貨、補水手、補 +1d..+20、資金、下一個任務
  m0() {
    if (this.countdown()) return;
    const st = this.st, F = this.v.bd7c;
    if (st.u8(F + 0x21) !== 0xff) {
      const E = faEcon(st.u8(F + 0x1c)), k = this.goodsCat(st.u8(F + 0x21));
      for (let i = 0; i < 10; i++) { const d = this.rnd(3) + (k === i ? 2 : 0), p = st.u8(E + 0x0e + i); st.set8(E + 0x0e + i, p - faUmin(p, d)); }
    }
    for (let j = 0; j < 10; j++) { const S = F + 0x2b + 9 * j; st.set8(S + 2, st.u8(S + 3)); }
    for (let i = 0; i < 4; i++) {
      if (this.rnd((i + 1) * 2)) break;
      if (st.u8(F + 0x1d + i) === 0xff) st.set8(F + 0x1d + i, this.rnd(20) + 0x32);
    }
    this.strength(F);
    st.set16(F + 0x24, this.rnd(3) + faIdiv(st.u16(faNation(this.v.bdb8)), 10) + 1);
    st.set8(F + 0x21, 0xff); st.set16(F + 0x22, 0);
    st.set8(F + 0x1b, this.nextMission());
    this.dispatch();
  }
  // 33c2d 在首都時依國家方針取新任務 (DS:b89c), 否則 0
  nextMission() {
    const st = this.st, N = faNation(this.v.bdb8), F = this.v.bd7c;
    if (st.u8(F + 0x1c) !== st.u8(N + 0x0a)) return 0;
    const sub = (this.v.c2ea & 0xff) % 10, sh = sub >= 1 && sub < 5 ? 8 : sub < 7 ? 4 : 0;
    return ((this.T.mission[st.u8(N + 3)] ?? 0) >> sh) & 0x0f;
  }
  // 33b0b 依任務設定目的地
  dispatch() {
    const st = this.st, N = faNation(this.v.bdb8), F = this.v.bd7c;
    const t = st.u8(N + 2) === 7 ? st.u8(this.heroRec + 0x31) & 0x0f : st.u8(N + 2);
    const chase = k => this.chaseFleet(0xff, k, F);
    switch (st.u8(F + 0x1b)) {
      case 0: case 9: return this.goPort(0xff, st.u8(F + 0x26), F);
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
  // 33dbf 任務 1 投資 (不在首都、資金 ≥ 2)
  m1() {
    if (this.countdown()) return;
    const st = this.st, bd = this.v.bdb8, N = faNation(bd), F = this.v.bd7c, E = faEcon(st.u8(F + 0x1c));
    if (st.u16(F + 0x24) >= 2 && st.u8(F + 0x1c) !== st.u8(N + 0x0a)) {
      const add = o => { const v = (st.u16(F + 0x24) >>> 1) * 100 + st.u16(E + o); st.set16(E + o, v > 50000 ? 50000 : v); };
      if (st.u16(E + 4) > st.u16(E)) { if (st.u16(E + 2) !== 50000) add(2); else if (st.u16(E + 6) !== 50000) add(6); }
      else if (st.u16(E + 6) !== 50000) add(6); else if (st.u16(E + 2) !== 50000) add(2);
      st.set16(F + 0x24, st.u16(F + 0x24) - (st.u16(F + 0x24) >>> 1));
      let s = 0; for (let n = 0; n < 6; n++) if (n !== bd && st.u8(E + 8 + n)) s += st.u8(E + 8 + n);
      const own = st.u8(E + 8 + bd), v = faUmin(Math.trunc(((6 * st.u16(F + 0x24)) & 0xffff) / 10), 100 - own);
      st.set8(E + 8 + bd, own + v);
      let si = faUmin(v, s);
      while (si) for (let n = 0; n < 6 && si; n++) if (n !== bd && st.u8(E + 8 + n)) { st.set8(E + 8 + n, st.u8(E + 8 + n) - 1); si--; }
    }
    st.set8(F + 0x1b, 0); this.dispatch();
  }
  // 33f48 任務 2 買貨 (不在首都)
  m2() {
    if (this.countdown()) return;
    const st = this.st, N = faNation(this.v.bdb8), F = this.v.bd7c, E = faEcon(st.u8(F + 0x1c));
    if (st.u8(F + 0x1c) !== st.u8(N + 0x0a)) {
      const g = this.rnd(16) + 10, k = this.goodsCat(g);
      const base = faS16(st.u16(0x78f4 + (st.u8(E + 0x21) << 7) + 2 * g));
      const price = faLdiv(faLmul(base, st.u8(E + 0x0e + k) + 50), 100), cap = 100 * st.u16(F + 0x24);
      if (cap >= price) {
        const q = faUmin(faLdiv(cap, price), 1000), p = st.u8(E + 0x0e + k);
        st.set8(E + 0x0e + k, p + faUmin(this.rnd(3) + 3, 100 - p));
        st.set16(F + 0x24, st.u16(F + 0x24) + faLdiv(faLmul(q, price), -100));
        st.set8(F + 0x21, g); st.set16(F + 0x22, q);
      }
    }
    st.set8(F + 0x1b, 0); this.dispatch();
  }

  // ================= 每天一支 1ac19 =================
  // 1a6d8 任務 5..8 / 10: 對象的艦隊位置 → 目的地 (不在區域內時 3/4 機率不更新); 對象不在 → 回母港
  retarget(F) {
    const st = this.st, b = st.u8(F + 0x1b);
    if (!((b >= 5 && b <= 8) || b === 10)) return;
    const C = this.P(st.u8(F + 0x1c));
    if ((st.u8(C + 0x31) & 0x20) && st.u8(C + 0x2c) !== 0xff) {
      if (!this.inRegion(F) && this.rnd(4)) return;
      this.followTarget(F, false);
    } else this.goPort(0, st.u8(F + 0x26), F);
  }
  // 1a4a5 任務判斷 (+29 bit6 時不做)
  decide(F) {
    const st = this.st, k = this.v.c2ea & 0xff, nat = Math.trunc(k / 10), sub = k % 10;
    if (st.u8(F + 0x29) & 0x40) return;
    if (k > 0x3c || sub >= 5) {
      const Pa = this.P(st.u8(F + 0x2a)), b = st.u8(F + 0x1b);
      if (b >= 4 && b <= 6) {                                                     // 1a550
        const G = faFleet(st.u8(this.P(st.u8(F + 0x1c)) + 0x2c));
        let home = st.u8(G + 0x27) !== 0;
        if (!home) { const bit = st.u8(Pa + 0x2f) & 0x20; home = this.rnd(sub <= 6 ? (bit ? 30 : 15) : (bit ? 60 : 30)) === 0; }
        if (home) this.goPort(0, st.u8(F + 0x26), F);
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
    // 1a502 海盜 (k > 60) 獵捕中、在區域內 → 改追隨機一支商船 (或主角艦隊)
    if (k > 0x3c && st.u8(F + 0x1b) === 4 && this.inRegion(F) && this.rnd(st.u8(this.P(st.u8(F + 0x2a)) + 0x2f) & 0x80 ? 3 : 2) === 0) {
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
  // 1aa79 同一個 24 格內的對象人物 (FF = 沒有)
  cellTarget(F) {
    const st = this.st, cell = (faIdiv(st.u16(F), 24) + Math.imul(faIdiv(st.u16(F + 2), 24), 90)) & 0xffff, b = st.u8(F + 0x1b);
    if (b < 4 || b > 7) return 0xff;
    if (b === 4) {
      for (let i = 0; i < 0x3c; i++) {
        const G = faFleet(i);
        if (!(st.u8(G + 0x29) & 1)) continue;
        if (((Math.imul(faIdiv(st.u16(G + 2), 24), 90) - cell) & 0xffff) !== (faIdiv(st.u16(G), -24) & 0xffff)) continue;
        if (st.u8(G + 0x29) & 0x50) continue;                                   // 原版的「k % 10 在 1..4」判斷恆真
        if (st.u8(F + 0x28) > st.u8(G + 0x28)) { st.set8(F + 0x1b, 5); return st.u8(G + 0x2a); }
      }
      return 0xff;
    }
    const G = faFleet(st.u8(this.P(st.u8(F + 0x1c)) + 0x2c));
    if (!(st.u8(G + 0x29) & 1)) { this.goPort(0, st.u8(F + 0x26), F); return 0xff; }
    if (st.u8(G + 0x29) & 0x50) return 0xff;
    return ((faIdiv(st.u16(G), 24) + Math.imul(faIdiv(st.u16(G + 2), 24), 90)) & 0xffff) === cell ? st.u8(F + 0x1c) : 0xff;
  }
  // 1ab8b 海上同一格的對象 (FF = 沒有)
  contact(F) {
    const st = this.st, b = st.u8(F + 0x1b);
    if (b < 4 || b > 7) return 0xff;
    if (b === 4) {
      const H = this.heroFleet;
      if (this.same(H, F)) { st.set8(F + 0x1b, 5); return st.u8(H + 0x2a); }
      return 0xff;
    }
    const G = faFleet(st.u8(this.P(st.u8(F + 0x1c)) + 0x2c));
    if (!(st.u8(G + 0x29) & 1)) { this.goPort(0, st.u8(F + 0x26), F); return 0xff; }
    if (st.u8(G + 0x29) & 0x50) return 0xff;
    return this.same(G, F) ? st.u8(F + 0x1c) : 0xff;
  }
  // 1a7a8 交戰 (只在時刻 0x12..0x35)
  async fight(di, F) {
    const st = this.st, { sys } = this.c, Pd = this.P(di), G = faFleet(st.u8(Pd + 0x2c));
    let a = Math.trunc(st.u8(F + 0x28) / 10);
    const b = Math.trunc(st.u8(G + 0x28) / 10), t = this.c.rt.time;
    if (t < 0x12 || t >= 0x36) return;
    const home = () => this.goPort(0, st.u8(F + 0x26), F);
    if (this.inRegion(F)) {
      if (di === this.hero) {
        if (!(st.u8(F + 0x29) & 0x40) && !this.heroRank) return home();
        sys.mouseHide();
        if (this.sea.navalBattle) await this.sea.navalBattle(st.u8(F + 0x2a), di, 0xff, 0xff); else faTodo("海戰 (10f7e)");
        sys.mouseShow();
        if (!(st.u8(F + 0x29) & 1) || (st.u8(F + 0x29) & 0x40) || st.u8(F + 0x1b) === 7 || this.rnd(3)) return;
        return home();
      }
    } else {
      if (di === this.hero) return;
      if (this.rnd(150) < st.u8(Pd + 0x1d)) { if (st.u8(F + 0x1b) !== 7) home(); return; }
    }
    if (st.u8(F + 0x1b) !== 7) home();
    if ((st.u8(G + 0x29) & 0x40) || !(st.u8(G + 0x29) & 1) || (st.u8(G + 0x29) & 0x10)) return;
    for (let n = 10, S = G + 0x7c; n > 0; n--, S -= 9) {                       // 攻方扣對象的水手 (由第 10 個船位往前)
      if (!this.present(S)) continue;
      const s = st.u8(S + 2);
      if (s > a) { st.set8(S + 2, s - a); break; }
      a -= s; st.set8(S + 8, st.u8(S + 8) & 0xef);
      const q = faIdiv(st.u16(G + 0x22), 5); st.set16(G + 0x22, st.u16(G + 0x22) - q);
      st.set16(F + 0x22, st.u16(F + 0x22) + faUmin(1000 - st.u16(F + 0x22), q));
      st.set8(F + 0x21, st.u8(G + 0x21));
      const q2 = Math.trunc(st.u16(G + 0x24) / 5); st.set16(G + 0x24, st.u16(G + 0x24) - q2);
      st.set16(F + 0x24, st.u16(F + 0x24) + faUmin(60000 - st.u16(F + 0x24), q2));
    }
    this.strength(G);
    if (!(st.u8(G + 0x29) & 1)) { this.release(G); home(); }
    let c = b;
    for (let n = 10, S = F + 0x7c; n > 0; n--, S -= 9) {                       // 對象扣攻方
      if (!this.present(S)) continue;
      const s = st.u8(S + 2);
      if (s > c) { st.set8(S + 2, s - c); break; }
      c -= s; st.set8(S + 8, st.u8(S + 8) & 0xef);
    }
    this.strength(F);
    if (!(st.u8(F + 0x29) & 1)) this.release(F);
    const bd = this.v.bdb8 & 0xff, tn = Math.trunc(st.u8(Pd + 0x2c) / 10);   // 對象國籍 (提督已離開時 +2c = FF)
    let Nb = 0;
    if (bd < 6) { Nb = faNation(bd); const d = this.rnd(2) + 2, r = st.u8(Nb + 0x0b + tn); st.set8(Nb + 0x0b + tn, r - faUmin(r, d)); }
    if (tn < 6) {
      const M = faNation(tn);
      if (bd < 6) st.set8(M + 0x0b + bd, st.u8(Nb + 0x0b + tn));
      else { const d = this.rnd(2) + 2, r = st.u8(M + 0x0b + bd); st.set8(M + 0x0b + bd, r - faUmin(r, d)); }
    }
  }
  // 0fea:a22a = 1a0ca 下一個點
  nextPoint(F) {
    const st = this.st, sea = this.sea;
    if ((st.u8(F + 0x0d) & 0x40) && this.same(F + 4, F) && !sea.route(F)) {
      if (!(st.u8(F + 0x29) & 0x40)) this.goPort(0, st.u8(F + 0x26), F);
      return { x: st.u16(F), y: st.u16(F + 2) };
    }
    if (st.u8(F + 0x0d) & 0x80) return { x: st.u16(F + 8), y: st.u16(F + 0x0a) };
    if (st.u8(F + 0x0d) & 0x20) return { x: st.u16(F + 4), y: st.u16(F + 6) };
    const n = st.u16(F + 0x10 + 2 * (st.u8(F + 0x0c) & 7));
    return { x: sea.nodeW(n, 0) & 0x7fff, y: sea.nodeW(n, 2) };
  }
  // 到了目的地: 任務 4 → random(10) = 0 時回母港; 5..8/10 → 換成對象位置; 其他 1a16d 進港
  atDest(F, ai1ac19) {
    const st = this.st, b = st.u8(F + 0x1b);
    if (b === 4) { if (ai1ac19 && !this.rnd(10)) this.goPort(0, st.u8(F + 0x26), F); return; }
    if ((b >= 5 && b <= 8) || b === 10) this.followTarget(F, true);
    else this.arrive(F);
  }
  // 1a1e0 一天跳到 T (T 在區域內時停在區域邊上的海面入口)
  jump(T, F) {
    const st = this.st, sea = this.sea, rg = sea.region & 0xffff;
    const left = faS16(Math.imul(((30 * (sea.item & 0xff)) & 0xffff) + rg % 30, 24)), top = faS16(Math.imul(Math.trunc(rg / 30), 24));
    const q = (a, b, c) => Math.trunc(faS16(Math.imul(faS16(a), faS16(b))) / faS16(c));     // imul 後 cwd: 只取乘積的低 16 位元
    const land = (x, y) => this.land(x & 0xffff, y & 0xffff), tx = faS16(T.x), ty = faS16(T.y);
    let si, y2;
    if (sea.inRegion(T.x, T.y)) {
      let di = faS16(st.u16(F)); y2 = faS16(st.u16(F + 2));
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
        else { si = left; while (faS16(left + 0x47) > y2 && land(si, y2)) si = faS16(si + 1); }   // 原版這裡比較的是 y, 不是 si
      }
    } else { si = tx; y2 = ty; }
    st.set16(F, faImod(si + 0x870, 0x870)); st.set16(F + 2, faImod(y2 + 0x438, 0x438));
    if (this.same(F + 4, F)) this.atDest(F, true);
    if (this.inRegion(F)) sea.route(F);
  }
  // 1a16d 進港 / 到達
  arrive(F) {
    const st = this.st, b = st.u8(F + 0x1b);
    st.set8(F + 0x29, st.u8(F + 0x29) | 0x30);
    let A = 0;
    if (b <= 2 || b === 9) A = faPort(st.u8(F + 0x1c));
    else if (b === 3) st.set8(F + 0x29, st.u8(F + 0x29) & 0xef);
    else if ((b >= 5 && b <= 8) || b === 10) A = faFleet(st.u8(this.P(st.u8(F + 0x1c)) + 0x2c));
    if (A) { st.set16(F, st.u16(A)); st.set16(F + 2, st.u16(A + 2)); }
    st.set8(F + 0x27, this.rnd(8) + 8);
    this.mission(F);
  }
  // 1ac19 (呼叫前 [c2ea] = k)
  async daily(F) {
    const st = this.st;
    if (!(st.u8(F + 0x29) & 1)) return;
    if (st.port === 0xff && this.inRegion(F)) { st.set8(F + 0x0d, st.u8(F + 0x0d) | 0x80); return; }
    if (F === this.heroFleet) return;
    this.retarget(F);
    this.decide(F);
    const di = this.cellTarget(F);
    if (di !== 0xff) { if (!this.inRegion(faFleet(st.u8(this.P(di) + 0x2c)))) await this.fight(di, F); return; }
    if (st.u8(F + 0x29) & 0x10) { this.mission(F); if (st.u8(F + 0x29) & 0x10) return; }
    if (this.sea.route(F)) this.jump(this.nextPoint(F), F);
  }

  // ================= 海上每個時刻 1afe8 =================
  // 1ae55 走一步 (沒有海流): 擋住回傳 1
  step(F, dir, speed) {
    const st = this.st, sea = this.sea;
    const ex = faS8(sea.dsb(0x0718 + dir)), ey = faS8(sea.dsb(0x0720 + dir)), sp = faS8(speed);   // 路線失敗時方向 = FF, 原版照樣讀 DS:0718 / 0720 表外
    const ax = (ex * sp) & 0xff, ay = (ey * sp) & 0xff;
    const nx = (ax + st.u8(F + 0x18)) & 0xff, ny = (ay + st.u8(F + 0x19)) & 0xff;
    let di = faImod(st.u16(F), 0x2d0), y2 = faS16(st.u16(F + 2)), b6 = 0, b7 = 0, out = 0;
    if (nx >= 0x3c) { if (faS8(ax) < 0) { di--; b6 = 0x3c; } else { di++; b6 = 0xc4; } }
    if (ny >= 0x3c) { if (faS8(ay) < 0) { y2--; b7 = 0x3c; } else { y2++; b7 = 0xc4; } }
    const bda6 = faS16(sea.bda6), bdaa = faS16(sea.bdaa);
    if (bda6 > di || !(faS16(bda6 + 0x48) > di)) { di = faS16(di + faSgn(faS8(ax))); y2 = faS16(st.u16(F + 2)); out = 1; }
    if (bdaa > y2 || !(faS16(bdaa + 0x48) > y2)) { di = faImod(st.u16(F), 0x2d0); y2 = faS16(y2 + faSgn(faS8(ay))); out = 1; }
    if (!out && this.land(di & 0xffff, y2 & 0xffff)) {
      if (this.land((st.u16(F) + ex) & 0xffff, (st.u16(F + 2) + ey) & 0xffff)) return 1;
      st.set8(F + 0x18, nx); st.set8(F + 0x19, ny);
      if (b6) st.set8(F + 0x18, faS8(ax) > 0 ? 0x3b : 0);
      if (b7) st.set8(F + 0x19, faS8(ay) > 0 ? 0x3b : 0);
      return 0;
    }
    st.set16(F, faImod(di + faS16(Math.imul(sea.item & 0xff, 0x2d0)) + 0x870, 0x870));
    st.set16(F + 2, faImod(y2 + 0x438, 0x438));
    st.set8(F + 0x18, nx + b6); st.set8(F + 0x19, ny + b7);
    return 0;
  }
  // 1afe8 每支艦隊 (先查滑鼠右鍵); 迴圈以全域 [c2ea] 判斷結束 (艦隊指標另外遞增): 途中開戰 → 回到海上 851f → 6aae 把 [c2ea] 設成 0x46 → 這一輪剩下的艦隊不處理
  async seaTick() {
    const st = this.st, sea = this.sea, { sys, palette } = this.c;
    const w1 = st.u8(0x0cb1), w2 = st.u8(0x0cb2);
    const wDir = (w1 & 0x38) >> 3, wStr = w1 & 7, cDir = (w2 & 0x38) >> 3, cStr = w2 & 7;
    let k = 0;
    for (this.v.c2ea = 0; !palette.ending && this.v.c2ea < 0x46; k++, this.v.c2ea = (this.v.c2ea + 1) & 0xff) {
      if (sys.mouseEvent() === 0x82) sea.a9c8 |= 1;
      const F = faFleet(k);
      if (F === this.heroFleet || !(st.u8(F + 0x29) & 1)) continue;
      if (this.c.noFleets) continue;                                          // 測試: 原版 1b048 改成不處理
      if (st.u8(F + 0x29) & 0x10) { if (this.c.rt.time === 0) this.mission(F); if (st.u8(F + 0x29) & 0x10) continue; }
      if (this.land(st.u16(F), st.u16(F + 2))) continue;
      if (st.port !== 0xff || !this.inRegion(F)) { st.set8(F + 0x0d, st.u8(F + 0x0d) & 0x7f); continue; }
      const t = this.contact(F);
      if (t !== 0xff) { await this.fight(t, F); continue; }
      if (this.same(F + 4, F) && st.u8(F + 0x1b) !== 4) this.atDest(F, false);
      let d = sea.autoSteer(F) & 0xff;                                        // 2e09:3321 = 313b1 (失敗 = FF)
      if (d === 8) { st.set8(F + 0x29, st.u8(F + 0x29) | 0x20); continue; }
      st.set8(F + 0x1a, d);
      const v = sea.fleetSpeed(F, wDir, wStr, cStr, cDir) & 0xff;            // 1acbf
      if (this.step(F, d, v)) {
        d = (d + 1) & 7;
        if (this.step(F, d, v)) { d = (d - 2) & 7; if (this.step(F, d, v)) sea.pathStep(F, sea.pt(F + 8), 0); }   // 1fd9:44d8 = 24268
      }
    }
  }
  // 6aae 區域改變時: 區域內、出航中、非 bit5 的他艦隊 — 在陸地上 → 1a0ca (結果不用); 中途點在區域內且是陸地 → 重新搜尋路線
  regionChange() {
    const st = this.st;
    for (let k = 0; k < 0x46; k++) {
      this.v.c2ea = k;
      const F = faFleet(k);
      if (!(st.u8(F + 0x29) & 1) || !this.inRegion(F) || (st.u8(F + 0x29) & 0x20) || F === this.heroFleet) continue;
      if (this.land(st.u16(F), st.u16(F + 2))) this.nextPoint(F);
      if (this.inRegion(F + 8) && this.land(st.u16(F + 8), st.u16(F + 0x0a))) {
        st.set16(F + 0x0c, st.u16(F + 0x0c) & 0x100); st.set8(F + 0x0d, st.u8(F + 0x0d) | 0x40);
      }
    }
    this.v.c2ea = 0x46;
  }
}
