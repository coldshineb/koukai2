// scenes/battle.js — 海戰 (MAIN.EXE 10f7e 以下; docs/RE_NOTES.md 第 30 節)
// 由 SeaScene.navalBattle(al, dl, bl, arg) 呼叫: new NavalBattle(sea).run(al, dl, bl, arg)
// 原版的海戰工作區都在 DS (不在存檔內), 這裡以「原版 DS 位址」存取, 方便與反組譯逐條對照、與模擬器的記憶體逐位元組比對:
//   W = DS 鏡像 (Uint8Array 0x10000, 只用 8e14 以後; 初值 = MAIN.EXE 的 DS:9bfe..9d2f, 存在 ctx.battleDS, 與原版一樣跨場海戰保留)
//   DS 0ca4..8d17 (存檔區) 一律讀寫 GameState
//   8e14  戰場地圖 0x34 欄 × 0x30 列 (bit7 陸地, bit5/6 船 (偶數 / 奇數方), 低 5 位元 = 圖塊)
//   97d4..97df  三個戰場緩衝的遠指標 (0f08a, [0c8a] 的 EMS / 一般記憶體; 移植版不用, 比對時略過)
//   97e0  4 方 × 8 bytes: +0 旗艦 (船鏈開頭)  +2 目前的船  +4 艦隊記錄  +6 指揮者  +7 船數
//         方 0 = AL (攻方)、1 = DL (守方)、2 = BL (攻方援軍)、3 = 堆疊參數 (守方援軍); 地圖以方 1 的艦隊為中心
//   9800  戰場上的船 4 方 × 10 × 0x18: +0 船長 (人物記錄)  +2 船位 (艦隊 +2b + 9i)  +4 位置 (列 × 0x34 + 欄)  +6/+8 下一艘
//         +0a 方向 (0..5)  +0c 狀態 (bit6 沉沒, 0x20 旗艦 …)  +0d 旗標 (bit7/6 攻守, bit4-5 方, 低 4 位元 = 船鏈中的序號)
//         +0e 砲數  +10..+14 各距離的命中率  +15 射程  +16 戰力  +17 士氣
//   9bc0 目前這一方 (97e0 + 8k)  9bc2 目前的船  9bef/9bf0 視窗左上 (欄 / 列)  9bf2..9bf7 風力表  9bf8 風向  9bf9 風力
//   9bfb 結束原因 (0 = 繼續; 1 日落, 2/3/9 對話後不打, 4/5 一方全滅, 8 劇本)  9c2a/9c2c  9d3e 主角在攻方  9d40/9d42 雙方戰力
// 一騎打 12998 以下: scenes/duel.js (RE_NOTES 30.16..30.18)
import { Scenario, ENV_COMMON, ENV_HERO } from "../game/scenario.js";
import { duelInBattle } from "./duel.js";
import { marketTradeLog } from "./market.js";
import { DS, OFF } from "../model/schema_views.ts";
import { WorkDS } from "../model/flags.ts";

const btHex = s => Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16)));
const btS16 = v => (v << 16) >> 16;
const btS8 = v => (v << 24) >> 24;
const btIdiv = (a, b) => Math.trunc(a / b);                       // 有號除法 (向零取整)
const btImod = (a, b) => a - Math.trunc(a / b) * b;               // 有號餘數 (與被除數同號)
const btUmin = (a, b) => ((a & 0xffff) > (b & 0xffff) ? b & 0xffff : a & 0xffff);   // seg0:4d7c
const btUmax = (a, b) => ((a & 0xffff) < (b & 0xffff) ? b & 0xffff : a & 0xffff);   // seg0:4d87
const btUdiv32 = (a, b) => Math.floor((a >>> 0) / (b >>> 0)) >>> 0;   // seg0:38ba (32 位元無號除法)
const btSdiv32 = (a, b) => Math.trunc((a | 0) / (b | 0)) | 0;        // seg0:3722 (32 位元有號除法)
const btMul32 = (a, b) => Math.imul(a | 0, b | 0) >>> 0;            // seg0:37bc (32 位元乘法, 取低 32 位元)
const btWarned = new Set();
const btTodo = n => { if (!btWarned.has(n)) { btWarned.add(n); console.warn("尚未移植: " + n); } };

export class NavalBattle {
  constructor(sea) {
    this.sea = sea; this.c = sea.c;
    const J = sea.P.battle;                                               // assets/data/battle.json (tools/extract_battle.py)
    this.J = J; this.hd = sea.P.hdat;                                     // HDAT.PUT = [03ee]:0
    this.coast = new Map(Object.entries(J.coast).map(([k, v]) => [+k, v]));
    if (!this.c.battleDS) {                                               // DS 工作區: MAIN.EXE 的初值
      const W = new Uint8Array(0x10000); for (const [a, h] of Object.entries(J.ds)) W.set(btHex(h), parseInt(a, 16)); this.c.battleDS = W;
    }
    this.W = this.c.battleDS;
  }
  get st() { return this.c.state; }
  // ---- DS 存取: 存檔區走 GameState, 其他走 W ----
  u8(a) { a &= 0xffff; return a >= DS.OPTIONS && a < 0x8d18 ? this.st.u8(a) : this.W[a]; }
  u16(a) { return this.u8(a) | (this.u8(a + 1) << 8); }
  s16(a) { return btS16(this.u16(a)); }
  set8(a, v) { a &= 0xffff; if (a >= DS.OPTIONS && a < 0x8d18) this.st.set8(a, v); else this.W[a] = v & 0xff; }
  set16(a, v) { this.set8(a, v & 0xff); this.set8(a + 1, (v >> 8) & 0xff); }
  or8(a, v) { this.set8(a, this.u8(a) | v); }
  and8(a, v) { this.set8(a, this.u8(a) & v); }
  ds(a) { const W = this.W; let e = a; while (W[e]) e++; return W.subarray(a, e + 1); }   // DS 上的 C 字串 (含結尾 0)
  cstr(a) { return a >= DS.OPTIONS && a < 0x8d18 ? this.st.cstr(a) : this.ds(a); }
  rnd(n) { n &= 0xffff; return n ? this.c.sys.rng.random(n) & 0xffff : 0; }                // seg0:4dc4 (n = 0 時不取亂數)
  // ---- 記錄位址 (seg0) ----
  person(n) { return (DS.TBL_PERSON + 0x32 * (n & 0xff)) & 0xffff; }                             // 5bf8
  fleetOf(n) { return (DS.TBL_FLEET + 0x85 * (n & 0xff)) & 0xffff; }                             // 5c28 (AL × 0x85, 8 位元乘法)
  crew(i) { return (DS.TBL_CREW_SLOT + 0x1e * (i & 0xff)) & 0xffff; }                                // 5c38
  slot(i) { return this.sea.slotOf(i & 0xff); }                                            // 5c58
  shipRec(n) { return (DS.TBL_SHIP + 0x16 * (n & 0xff)) & 0xffff; }                             // 5c7a
  typeRec(t) { return (DS.TBL_SHIP_TYPE + 0x0c * (t & 0xff)) & 0xffff; }                             // 5c8a
  get heroRec() { return this.person(this.st.u8(DS.HERO)); }                                 // [c2ce]
  get heroFleet() { return this.sea.fleet; }                                                // [c2d4]
  pos(B) { const p = this.s16(B + 4); return [btImod(p, 0x34), btIdiv(p, 0x34)]; }       // 位置 → (欄, 列)
  mapAt(x, y) { return (0x8e14 + y * 0x34 + x) & 0xffff; }

  // ================= 10f7e 海戰 =================
  async run(al, dl, bl, arg) {
    const st = this.st, hero = st.u8(DS.HERO);
    const enemy = hero === al ? dl : al;
    st.set16(0x0de0, enemy); st.set16(0x0d56, enemy);
    // 0be20: HDAT.PUT → [03ee]:0 (移植版直接使用資源 hdat.bin)
    this.set8(0x9bfb, 0);
    const ally = { a: bl & 0xff, d: arg & 0xff };
    await this.allies(al, dl, ally);                                    // 10e68
    const si = await this.open(al, dl, ally.a, ally.d);                // fcf9
    if (this.u8(0x9bfb) === 0) await this.mainLoop();                  // fe9a
    const other = hero === al ? dl : al;
    await this.after(si, other);                                       // 10bdf
    await this.backToSea();                                            // bd26 / ff5c / 19ba1 / 851f
  }

  // 10e68 援軍: 主角不是海盜 (+31 & 0f ≠ 6) 時, 附近 (12fea(2)) 的艦隊中, 不是雙方指揮者、+2c % 10 ≥ 5 (護衛艦隊) 且與某方同國的加入
  async allies(al, dl, ally) {
    const st = this.st, n = this.sea.nearFleets(2);
    const nA = Math.floor(st.u8(this.person(al) + 0x2c) / 10), nD = Math.floor(st.u8(this.person(dl) + 0x2c) / 10);
    if ((st.u8(this.heroRec + 0x31) & 0x0f) === 6) return;
    for (let di = 0; di < n; di++) {
      const p = this.c.persons[di];
      if (p === dl || p === al) continue;
      const R = this.person(p), f = st.u8(R + 0x2c);
      if (f % 10 < 5) continue;
      let m;
      if (ally.d === 0xff && Math.floor(f / 10) === nD) { ally.d = p; m = 0x30b; }
      else if (ally.a === 0xff && Math.floor(f / 10) === nA) { ally.a = p; m = 0x30c; }
      else continue;
      this.c.win.shadowedSaved(0x14, 0x80, 0x1e, 0x60, 0);
      this.c.message(m, st.cstr(R), st.cstr(R + 0x0d));
      await this.c.menu.waitPrompt();
      await this.c.win.close();
    }
  }

  // ================= fcf9 開戰 =================
  async open(al, dl, bl, arg) {
    const { palette, bgm, sys } = this.c, st = this.st;
    await palette.fadeBlack();                                          // 99f2
    bgm.playSong(0x10);                                                 // 9670(0x10)
    this.sea.cursor = 0x2570; sys.setCursorShape(0x2570);               // [06d6] = 0x2570, 5050
    const di = this.setup(al, dl, bl, arg);                             // f84d
    this.drawPanel();                                                   // c581
    this.drawField();                                                   // c5ff
    await this.fadeIn();                                                // bcfa
    // 劇本: 2e09:55c2(0xa1, [0d56]) / 2e09:5546、2e09:5481(0xa1, [0de0]) / 2e09:53f0 — 劇本要求時 [9bfb] = 8, 不打
    let si = 0;
    if (!this.c.noEvents) {
      const sc = (this.c.events ??= new Scenario(this.c)); sc.scene = this.sea;
      const no = () => { this.set8(0x9bfb, 8); return 0xffff; };
      if ((await sc.check(ENV_HERO, 0xa1, st.u16(0x0d56) & 0xff)) && !(await sc.run(ENV_HERO))) return no();
      si = await sc.check(ENV_COMMON, 0xa1, st.u16(0x0de0) & 0xff);
      if (si && !(await sc.run(ENV_COMMON))) return no();
    }
    if (st.u16(0x0de6) === 0 && st.u16(0x0d5c) === 0) {
      if (await this.parley(si)) return 0xffff;                         // fcdb
    }
    await this.desert();                                                // f89e
    this.drawShips();                                                   // c0ad
    this.set8(0x9c2a, 100); this.set16(0x9c2c, 0);
    return di;
  }

  // f84d 編成
  setup(al, dl, bl, arg) {
    const st = this.st, hero = st.u8(DS.HERO);
    this.set8(0x97e6, al); this.set8(0x97ee, dl); this.set8(0x97f6, bl); this.set8(0x97fe, arg);
    this.set16(0x9d3e, hero === al || hero === bl ? 1 : 0);
    const si = this.sides();                                            // f58a
    this.makeMap();                                                     // f08a
    this.place();                                                       // f754
    this.viewOrigin();                                                  // f82c
    return si;
  }
  // f58a 4 方的艦隊: [9d40] / [9d42] = 主角方 / 對方 的戰力 (艦隊 +28) 總和; 回傳 非主角方的 Σ 船位 +3
  sides() {
    let di = 0; this.set16(0x9d42, 0); this.set16(0x9d40, 0);
    const A = this.u16(0x9d3e);
    for (let k = 0; k < 4; k++) {
      const E = 0x97e0 + 8 * k;
      if (this.u8(E + 6) !== 0xff) {
        const F = this.fleetOf(this.st.u8(this.person(this.u8(E + 6)) + 0x2c));
        this.set16(E + 4, F);
        this.fleetPower(F);                                             // 0fea:83f9
        const mine = (A && !(k & 1)) || (!A && (k & 1));
        const w = mine ? 0x9d40 : 0x9d42;
        this.set16(w, this.u16(w) + this.st.u8(F + OFF.FLEET.STRENGTH));
        this.set8(E + 7, this.ships(E, k));                             // f3dd
        this.set16(E + 2, this.u16(E));
        di = (di + this.crewSum(E)) & 0xffff;                           // f568
      } else {
        this.set16(E + 4, 0); this.set8(E + 7, 0); this.set16(E, 0); this.set16(E + 2, 0);
      }
    }
    return di;
  }
  // 0fea:83f9 = 18299: 艦隊 +28 = (Σ 在的船 +2 + 4) / 5; 總和 0 → +29 &= FE
  fleetPower(F) {
    const st = this.st; let sum = 0;
    for (let i = 0; i < 10; i++) { const S = (F + OFF.FLEET.SHIPS + 9 * i) & 0xffff; if ((st.u8(S + OFF.DOCK_SLOT.FLAGS) & 0x30) === 0x10) sum += st.u8(S + OFF.DOCK_SLOT.DURABILITY); }
    st.set8(F + OFF.FLEET.STRENGTH, Math.trunc((sum + 4) / 5));
    if (!sum) st.set8(F + OFF.FLEET.FLAGS, st.u8(F + OFF.FLEET.FLAGS) & 0xfe);
  }
  // f568 船鏈的 Σ 船位 +3 (開頭的船 +0d bit7 = 主角方時 0)
  crewSum(E) {
    let dx = 0, si = this.u16(E);
    if (this.u8(si + 0x0d) & 0x80) return 0;
    for (; si; si = this.u16(si + 8)) dx += this.u8(this.u16(si + 2) + 3);
    return dx & 0xffff;
  }
  // f3dd 一方的船 (DS:9800 + 0xf0 × k): 艦隊的 10 個船位
  ships(E, k) {
    const st = this.st, F = this.u16(E + 4), A = this.u16(0x9d3e), hf = this.heroFleet;
    let S = (F + OFF.FLEET.SHIPS) & 0xffff, si = 0x9800 + ((0xf0 * k) & 0xffff), first = 1, cnt = 0;
    const mine = (A && !(k & 1)) || (!A && (k & 1));
    const fl = mine ? (F === hf ? 0x80 : 0xc0) : k >= 2 ? 0x40 : 0;
    for (let i = 0; i < 10; i++, si += 0x18, S = (S + 9) & 0xffff) {
      if ((st.u8(S + OFF.DOCK_SLOT.FLAGS) & 0x30) === 0x10) {
        const cap = F === hf ? st.u8(this.crew(i) + 0x1b) : this.u8(E + 6);
        this.set8(si + 0x0d, ((k << 4) | fl | i) & 0xff);
        this.set16(si, this.person(cap)); this.set16(si + 2, S); this.set16(si + 4, 0); this.set16(si + 6, 0); this.set16(si + 8, 0);
        this.set8(si + 0x0a, 0); this.set8(si + 0x0b, 0);
        let mo;
        // 主角艦隊: 100 − 船員 +8 − 船員 +9; 原版第二次呼叫 5c38 時 AL 還是 +9 的值, 所以 +8 取的是「船員 (+9 的值)」的 (照搬)
        if (F === hf) { const v9 = st.u8(this.crew(i) + 9); mo = (100 - st.u8(this.crew(v9) + 8) - v9) & 0xff; }
        else mo = st.u8(this.shipRec(this.u8(S + OFF.DOCK_SLOT.SHIP)) + 0x10) & 0x10 ? 0x19 : 0x32;
        this.set8(si + 0x17, mo);
        this.shipStats(si, E, first);                                    // f259
        this.set8(si + 0x0c, this.shipFlags(si));                        // f0c6
        first = 0; cnt++;
      } else {
        this.set8(si + 0x0d, 0);
        for (const o of [0, 2, 4, 6, 8]) this.set16(si + o, 0);
        this.set8(si + 0x0a, 0); this.set8(si + 0x0b, 0); this.set8(si + 0x0c, 0); this.set16(si + 0x0e, 0);
        for (const o of [0x15, 0x14, 0x13, 0x12, 0x11, 0x10, 0x16]) this.set8(si + o, 0);
      }
    }
    this.chain(E, k);                                                   // f13f
    return cnt & 0xff;
  }
  // eb9e 船位 S 在主角艦隊中的序號 (找不到 → 0)
  heroSlotIndex(B) {
    let S = this.slot(0);
    for (let i = 0; i < 10; i++, S = (S + 9) & 0xffff) if (this.u16(B + 2) === S) return i;
    return 0;
  }
  // f259 砲數 / 射程 / 命中率 / 戰力
  shipStats(si, E, first) {
    const st = this.st;
    const T = [0, 0, 0, 0, 0, 0, 0x0a, 0, 0, 0, 0, 0x0a, 9, 0, 0, 0, 0x0a, 9, 8, 0, 0, 0x0a, 9, 8, 7];
    let mul;
    if (this.u16(E + 4) === this.heroFleet) {
      this.set16(si + 0x0e, st.u16(this.crew(this.heroSlotIndex(si)) + 6));
      mul = 3;
    } else {
      const R = this.shipRec(this.u8(this.u16(si + 2) + 7));
      const b1 = Math.floor(st.u8(this.typeRec(st.u8(R + 0x0f)) + 8) / 5);
      const f = st.u8(this.u16(si) + 0x2c);
      if ((f % 10 === 0 || f % 10 >= 5) && (st.u8(R + 0x10) & 0x10)) this.set16(si + 0x0e, b1); else this.set16(si + 0x0e, 0);
      this.set16(si + 0x0e, (this.u16(si + 0x0e) + (this.rnd(b1) & 0xff)) & 0xffff);
      mul = first ? 3 : 2;
    }
    const g = this.u8(this.u16(si + 2) + 8) & 7;
    let r = this.J.t07ec[g];
    this.set8(si + 0x15, r);
    if (r) r--;
    for (let i = 0; i < 5; i++) this.set8(si + 0x10 + i, (T[5 * r + i] * this.J.t07fc[g]) & 0xff);
    const P = this.u16(si), a = st.u8(P + 0x25), b = st.u8(P + 0x21);
    this.set8(si + 0x16, Math.floor(((Math.floor((a * b) / 100) + (b >> 1)) * mul) / 3));
  }
  // f0c6 +0c: random(50) > 船長 +20 → 2, 否則 3; 有砲且船 +10 bit4 → |0x10; 艦隊 % 10 在 1..4 且國籍 ≠ 6 → |8
  shipFlags(si) {
    const st = this.st;
    let v = this.rnd(0x32) > st.u8(this.u16(si) + 0x20) ? 2 : 3;
    if (this.u16(si + 0x0e) && (st.u8(this.shipRec(this.u8(this.u16(si + 2) + 7)) + 0x10) & 0x10)) v |= 0x10;
    const f = st.u8(this.u16(si) + 0x2c);
    if (f % 10 !== 0 && Math.floor(f / 10) !== 6 && f % 10 < 5) v |= 8;
    return v;
  }
  // f13f 船鏈: 旗艦 (主角艦隊 = 主角的船; 其他 = 船位 +3 最大的第一艘) 開頭, 其餘依船位順序; +0c = 0x22; +0d 低 4 位元重新編號
  chain(E, k) {
    const st = this.st, base = 0x9800 + ((0xf0 * k) & 0xffff), list = [];
    let flag = 0, best = 0;
    for (let i = 0, si = base; i < 10; i++, si += 0x18) {
      const S = this.u16(si + 2);
      if (!S || (st.u8(S + OFF.DOCK_SLOT.FLAGS) & 0x30) !== 0x10) continue;
      list.push(i);
      if (this.u16(E + 4) === this.heroFleet) { if (st.u8(this.crew(i) + 0x1b) === st.u8(DS.HERO)) flag = i; }
      else if (st.u8(S + OFF.DOCK_SLOT.MAX_DURABILITY) > best) { flag = i; best = st.u8(S + OFF.DOCK_SLOT.MAX_DURABILITY); }
    }
    const head = (base + 0x18 * flag) & 0xffff;
    this.set16(E, head);
    this.set8(head + 0x0c, 2); this.or8(head + 0x0c, 0x20);
    let si = head, j = 0;
    while (list.length > j) {
      if (list[j] === flag) j++;
      if (list.length > j) { this.set16(si + 8, (base + 0x18 * list[j]) & 0xffff); j++; si = this.u16(si + 8); }
      else { this.set16(si + 8, 0); break; }
    }
    let n = 0;
    for (si = this.u16(E); si; si = this.u16(si + 8)) { this.and8(si + 0x0d, 0xf0); this.or8(si + 0x0d, n); n++; }
  }

  // f08a 戰場地圖: 方 1 艦隊周圍 6 × 6 的海圖格 (陸地 = 圖塊 ≥ 0x34) 放大 8 倍 → 8e14, 陸地邊緣隨機; ebce 海岸; f022 風
  makeMap() {
    const sea = this.sea, F1 = this.u16(0x97ec);
    const bx = btImod(this.s16(F1), 0x2d0) - btS16(sea.bda6) - 2, by = btImod(this.s16(F1 + 2), 0x438) - btS16(sea.bdaa) - 2;
    const g = new Uint8Array(36);
    for (let di = 0; di < 6; di++) for (let si = 0; si < 6; si++) g[di * 6 + si] = sea.seaBuf[((by + di) * 0x60 + bx + si) & 0xffff] >= 0x34 ? 0x84 : 1;
    for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 6; dx++)
      for (let r = dy * 8; r < (dy + 1) * 8; r++) for (let c = dx * 8 + 2; c < dx * 8 + 0x0a; c++) this.set8(0x8e14 + r * 0x34 + c, g[dy * 6 + dx]);
    for (let si = 0; si < 6; si++) for (let bxx = 0; bxx < 6; bxx++) {
      if (g[si * 6 + bxx] & 0x80) continue;
      const x0 = Math.max(0, bxx * 8 - 4) + 2, x1 = Math.min(0x30, bxx * 8 + 0x0c) + 2;
      const y0 = Math.max(0, si * 8 - 4), y1 = Math.min(0x30, si * 8 + 0x0c);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const cell = g[btIdiv(y, 8) * 6 + btIdiv(x, 8)];
        this.set8(0x8e14 + y * 0x34 + x, (cell & 0x80) && this.rnd(2) ? 0 : 1);
      }
    }
    for (let y = 0; y < 0x30; y++) {
      const r = 0x8e14 + y * 0x34;
      this.set8(r + 1, this.u8(r + 2)); this.set8(r, this.u8(r + 2));
      this.set8(r + 0x32, this.u8(r + 0x31)); this.set8(r + 0x33, this.u8(r + 0x31));
    }
    this.coastTiles();                                                  // ebce
    this.wind();                                                        // f022
  }
  // ebce 陸地格依 8 鄰格 (bit7 = 左上 … bit0 = 右下, 該鄰格不是陸地時置位; 超出地圖以邊緣代替) 換成海岸圖塊
  coastTiles() {
    for (let si = 0; si < 0x30; si++) for (let bx = 0; bx < 0x34; bx++) {
      if (!(this.u8(this.mapAt(bx, si)) & 0x80)) continue;
      let m = 0, bit = 0x80;
      for (let dy = si - 1; dy <= si + 1; dy++) {
        const yy = Math.min(Math.max(dy, 0), 0x2f);
        for (let dx = bx - 1; dx <= bx + 1; dx++) {
          const xx = Math.min(Math.max(dx, 0), 0x33);
          if (dy === si && dx === bx) continue;
          if (!(this.u8(0x8e14 + yy * 0x34 + xx) & 0x80)) m |= bit;
          bit >>= 1;
        }
      }
      const t = this.coast.get(m);
      if (t !== undefined) this.set8(this.mapAt(bx, si), t);
    }
  }
  // f022 風: [9bf9] = random(8) + 1, [9bf8] = random(8) × 5 / 7; [9bf2 + (i % 6)] (i = [9bf8] .. [9bf8] + 5) = 與風向的距離換算
  wind() {
    this.set8(0x9bf9, this.rnd(8) + 1);
    const di = Math.floor((this.rnd(8) * 5) / 7);
    this.set8(0x9bf8, di);
    for (let si = di; si < di + 6; si++) {
      const v = si - di > 3 ? di - si + 7 : si - di + 1;
      this.set8(0x9bf2 + btImod(si, 6), v);
    }
  }
  // f754 配置: 各方方向 (f63b), 以方 1 艦隊的位置為準換算成 5 × 5 的格 → f66f
  place() {
    const B1 = this.u16(0x97ec), x0 = this.s16(B1), y0 = this.s16(B1 + 2);
    for (let k = 0; k < 4; k++) {
      const E = 0x97e0 + 8 * k;
      if (!this.u16(E + 4)) continue;
      this.sideDir(E);                                                  // f63b
      const F = this.u16(E + 4);
      let gx = this.s16(F) - x0 + 2; const cy = this.s16(F + OFF.FLEET.Y) - y0 + 2;
      if (gx < 0) gx = 0;
      if (gx > 4) gx = 4;
      let gy = cy < 0 ? 0 : cy;                                         // 原版: cy ≥ 0 時 di = cy (再夾到 4), 否則 di = 0
      if (gy > 4) gy = 4;
      this.placeSide(E, gx * 8 + 0x0a, (gy + 1) * 8);                   // f66f
    }
  }
  // f63b 方向 = (艦隊 +1a × 5 / 7) % 6
  sideDir(E) {
    const d = btImod(btIdiv((5 * this.st.u8(this.u16(E + 4) + 0x1a)) & 0xffff, 7), 6);
    for (let si = this.u16(E); si; si = this.u16(si + 8)) this.set8(si + 0x0a, d);
  }
  inMap(x, y) { return x >= 0 && x < 0x34 && y >= 0 && y < 0x30; }      // d6dd
  side(B) { return this.u8(B + 0x0d) >> 4; }                            // d626
  // f66f 旗艦放在 (x, y) 附近 (±8 的空海格), 其餘的船在旗艦 ±4 內 (找到空海格為止, 同一艘一直重抽); 地圖格 |= 0x20 << (方 & 1)
  placeSide(E, cx, cy) {
    let x = cx, y = cy;
    while (!this.inMap(x, y) || (this.u8(this.mapAt(x, y)) & 0xe0)) { x = this.rnd(0x10) + cx - 8; y = this.rnd(0x10) + cy - 8; }
    let di = this.u16(E);
    const p = (0x34 * y + x) & 0xffff;
    this.set16(di + 4, p);
    const bit = 0x20 << (this.side(di) & 1);
    this.or8(0x8e14 + p, bit);
    for (di = this.u16(di + 8); di;) {
      const sx = this.rnd(8) + x - 4, sy = this.rnd(8) + y - 4;
      if (!this.inMap(sx, sy) || (this.u8(this.mapAt(sx, sy)) & 0xe0)) continue;
      const q = (0x34 * sy + sx) & 0xffff;
      this.set16(di + 4, q); this.or8(0x8e14 + q, bit);
      di = this.u16(di + 8);
    }
  }
  // f82c 視窗左上: 主角艦隊那一方的旗艦 (f7e3: 欄 − 6 (0..0x27), 列 − 6 (0..0x24))
  viewOrigin() {
    for (let k = 0; k < 4; k++) {
      const E = 0x97e0 + 8 * k;
      if (this.u16(E + 4) === this.heroFleet) this.viewFor(this.u16(E));
    }
  }
  // f7e3 以船 B 為準的視窗左上: 欄 − 6 (0..0x27)、列 − 6 (0..0x24)
  viewFor(B) {
    const [x, y] = this.pos(B);
    this.set8(0x9bf0, 0); this.set8(0x9bef, 0);
    if (x > 6) { this.set8(0x9bef, x - 6); if (this.u8(0x9bef) > 0x27) this.set8(0x9bef, 0x27); }
    if (y > 6) { this.set8(0x9bf0, y - 6); if (this.u8(0x9bf0) > 0x24) this.set8(0x9bf0, 0x24); }
  }

  // ================= 畫面 =================
  // c581 右側面板: GRAPH.DAT #0x1a 於 (0x1a0, 0)、c327、小地圖底色、風向盤 ([0c86] + 0x490 + 0x320 × ((15 × 風向 − 風向 / 3) / 10))、c2ee
  drawPanel() {
    const { graph, scr, gfx } = this.c;
    graph.draw(0x1a, 0x1a0, 0);
    this.status();                                                      // c327
    scr.fillCols(0x35, 8, 0x1a, 0xc0, 5);
    const w = this.u8(0x9bf8), si = (btIdiv(0x0f * w - Math.floor(w / 3), 10) * 0x320) & 0xffff;
    scr.putPlanar(0x37, 0xe6, 5, 0x28, gfx, (si + 0x490) & 0xffff);    // 3d2 ([0c86] 段)
    this.msgArea();                                                     // c2ee
  }
  // c2ee 訊息區: 0906(0x35, 0x148, 0x18, 0x38, 0), 左右邊界 0x36 / 0x4b, 游標 (0x36, 0x150), 字串 9cb8
  msgArea() {
    const { scr, con } = this.c;
    scr.fillCols(0x35, 0x148, 0x18, 0x38, 0);
    con.right = 0x4b; con.left = 0x36; con.setCursor(0x36, 0x150);
    con.puts(this.ds(0x9cb8));
  }
  // c327 狀態: 主角旗艦的 耐久 / 水手 / 轉向 / 推進 / 砲彈、船名、時辰
  status() {
    const { scr, con, printf } = this.c, st = this.st;
    con.left = 0x36; con.right = 0x4d;
    con.puts(this.ds(0x9cc0));
    let B = 0, di = 0, R = 0, T = 0;
    for (let k = 0; k < 4; k++) {
      const E = 0x97e0 + 8 * k;
      if (this.u16(E + 4) !== this.heroFleet) continue;
      B = this.u16(E); di = this.u16(B + 2); R = this.shipRec(st.u8(di + 7)); T = this.typeRec(st.u8(R + 0x0f));
      break;
    }
    scr.fillCols(0x3f, 0xe8, 0x0e, 0x50, 7);
    scr.fillCols(0x3b, 0x118, 1, 0x10, 7);
    scr.fillCols(0x3b, 0xd4, 1, 0x10, 7);
    con.setCursor(0x37, 0xd4); printf(this.ds(0x9cc8));
    con.setCursor(0x37, 0x118); con.puts(this.ds(0x9ccd));
    con.setCursor(0x3f, 0xe8); con.puts(this.ds(0x9cd2));
    con.setCursor(0x3f, 0xf8); con.puts(this.ds(0x9cd9));
    con.setCursor(0x3f, 0x108); con.puts(this.ds(0x9ce0));
    con.setCursor(0x3f, 0x118); con.puts(this.ds(0x9ce7));
    con.setCursor(0x3f, 0x128); con.puts(this.ds(0x9cee));
    con.setCursor(0x3e, 0xd8); printf(this.ds(0x9cf5), st.cstr(R));
    const t = this.c.rt.time & 0xff;
    con.setCursor(0x38, 0x128); printf(this.ds(0x9cfa), Math.floor(t / 3));
    con.setCursor(0x3b, 0x128); printf(this.ds(0x9cfe), (t % 3) * 0x14);
    con.setCursor(0x46, 0xe8); printf(this.ds(0x9d03), this.u8(di + 2), this.u8(di + 3));
    con.setCursor(0x46, 0xf8); printf(this.ds(0x9d0b), this.u16(di), this.u16(R + 0x12));
    con.setCursor(0x46, 0x108); printf(this.ds(0x9d13), this.u8(di + 4), st.u8(T + 2));
    con.setCursor(0x46, 0x118); printf(this.ds(0x9d1b), this.u8(di + 5), st.u8(T + 3));
    con.setCursor(0x46, 0x128); printf(this.ds(0x9d23), this.u16(B + 0x0e));
  }
  // be86 (欄, 列) 在視窗內 (13 × 12)
  inView(x, y) {
    const ox = this.u8(0x9bef), oy = this.u8(0x9bf0);
    return ox <= x && ox + 0x0d > x && oy <= y && oy + 0x0c > y;
  }
  // c5ff = c2cf 視窗內所有圖塊 (c2a4 → c14e) + c0e6 小地圖的陸地
  drawField() {
    for (let y = 0; y < 0x30; y++) for (let x = 0; x < 0x34; x++) if (this.inView(x, y)) this.tile(x, y);
    this.miniLand();
  }
  // 02a7 模式 1/2/3 (XOR/AND/OR) 的 4 平面交錯圖 (移植版的畫面是索引像素: 4 個平面的運算 = 索引的位元運算)
  putOp(col, y, w, h, mode, src, off) {
    const scr = this.c.scr;
    if (mode === 0) return scr.putPlanar(col, y, w, h, src, off);
    if (!scr.inBounds(col, y, w, h)) return -1;
    const fb = scr.fb; let s = off;
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++, s += 4) {
      const o = (y + r) * 640 + (col + c) * 8, p0 = src[s], p1 = src[s + 1], p2 = src[s + 2], p3 = src[s + 3];
      for (let i = 0; i < 8; i++) {
        const b = 7 - i, v = ((p0 >> b) & 1) | (((p1 >> b) & 1) << 1) | (((p2 >> b) & 1) << 2) | (((p3 >> b) & 1) << 3);
        if (mode === 1) fb[o + i] ^= v; else if (mode === 2) fb[o + i] &= v; else fb[o + i] |= v;
      }
    }
    scr.dirty = true; return 0;
  }
  // c14e 一格圖塊 (HDAT 圖塊 = 格 & 1f, 每張 0x200): 偶數欄整張 (最下一列再補下一列的上半); 奇數欄下移半格: 上半 = 本格下半 (第 0 列畫整張), 再畫下一列的上半
  tile(x, y) {
    const scr = this.c.scr, hd = this.hd;
    const cx = x - this.u8(0x9bef), si = y - this.u8(0x9bf0);
    const t = this.u8(this.mapAt(x, y)) & 0x1f, a = (t << 9) & 0xffff;
    const below = () => (this.u8(this.mapAt(x, btUmin(y + 1, 0x2f))) & 0x1f) << 9;
    if (x & 1) {
      if (si === 0) scr.putPlanar(cx * 4, si << 5, 4, 0x20, hd, a);
      else scr.putPlanar(cx * 4, (si << 5) + 0x10, 4, 0x10, hd, (a + 0x100) & 0xffff);
      scr.putPlanar(cx * 4, (si + 1) << 5, 4, 0x10, hd, below());
    } else {
      scr.putPlanar(cx * 4, si << 5, 4, 0x20, hd, a);
      if (si === 0x0b) scr.putPlanar(cx * 4, 0x180, 4, 0x10, hd, below());
    }
  }
  // c0e6 小地圖的陸地: 0636 點陣 DS:9bfe + (欄 % 2) × 4, 模式 0x400 (色 0) 於 (0x35 + 欄 / 2, (列 + 2) × 4)
  miniLand() {
    for (let y = 0; y < 0x30; y++) for (let x = 0; x < 0x34; x++)
      if (this.u8(this.mapAt(x, y)) & 0x80) this.miniDot(x, y, 0x400);
  }
  miniDot(x, y, mode) { this.c.scr.glyphMode(0x35 + btIdiv(x, 2), (y + 2) * 4, 1, 4, this.W.subarray(0x9bfe + (x % 2) * 4), mode); }   // be49 / c0e6
  // c0ad 所有的船: c05d (戰場) + beb7 (小地圖)
  drawShips() {
    for (let k = 0; k < 4; k++) for (let si = this.u16(0x97e0 + 8 * k); si; si = this.u16(si + 8)) { this.drawShip(si); this.miniShip(si); }
  }
  // c05d: 在視窗內、船位 +2 (耐久) ≠ 0、未沉 (+0c bit6) → bf16
  drawShip(B) {
    const [x, y] = this.pos(B);
    if (!this.inView(x, y) || !this.u8(this.u16(B + 2) + 2) || (this.u8(B + 0x0c) & 0x40)) return;
    this.shipSprite(B, x, y);
  }
  // bf16 船的圖: 種類 = (攻守 bit7 = 0 ? 1 : 0) + (船 +10 bit4 = 0 ? 2 : 0); 圖 = 0x1a00 + (種類 × 6 + 方向) × 0x280:
  //   0x80 遮罩以 063e 模式 0x20f (AND) 畫, 再以 02a7 模式 3 (OR) 疊上圖像; 有水手 (船位 +0 ≠ 0) 時標上序號 (旗艦 C7, 其他 C1; 方 2/3 往右 3 欄)
  shipSprite(B, x, y) {
    const { scr, con, printf } = this.c, st = this.st, fl = this.u8(B + 0x0d);
    const cx = x - this.u8(0x9bef), cy = y - this.u8(0x9bf0), dy = x % 2 === 1 ? 0x10 : 0;
    let di = fl & 0x80 ? 0 : 1;
    if (!(st.u8(this.shipRec(this.u8(this.u16(B + 2) + 7)) + 0x10) & 0x10)) di += 2;
    const spr = ((((di * 6 + this.u8(B + 0x0a)) * 0x280) & 0xffff) + 0x1a00) & 0xffff;
    const X = cx << 2, Y = (cy << 5) + dy;
    scr.glyphMode(X, Y, 4, 0x20, this.hd.subarray(spr), 0x20f);
    this.putOp(X, Y, 4, 0x20, 3, this.hd, (spr + 0x80) & 0xffff);
    if (!this.u16(this.u16(B + 2))) return;
    con.puts(this.ds(this.u16(0x97e0 + ((fl & 0x30) >> 1)) === B ? 0x9ca6 : 0x9cad));
    con.setCursor((fl & 0x20 ? 3 : 0) + X, Y);
    printf(this.ds(0x9cb4), fl & 0x0f);
  }
  // beb7 小地圖的船: 主角方 (bit7) 色 7 (bit6 時 6), 對方 色 2 (bit6 時 3)
  miniShip(B) {
    if (!this.u8(this.u16(B + 2) + 2) || (this.u8(B + 0x0c) & 0x40)) return;
    const [x, y] = this.pos(B), fl = this.u8(B + 0x0d);
    const c = fl & 0x80 ? (fl & 0x40 ? 6 : 7) : (fl & 0x40 ? 3 : 2);
    this.miniDot(x, y, 0x400 | c);
  }
  // bcfa 淡入戰場調色盤 (DS:9c76), [03ea] = 0 且未反色時開始調色盤循環 16ee(DS:9c6e, 4, 0x10)
  async fadeIn() {
    const { palette } = this.c;
    await palette.fadeTo(palette.table("battle"));
    if (!palette.ending && !palette.invert) {
      const frames = [0, 1, 2, 3].map(i => { const p = this.u16(0x9c6e + 2 * i); return Array.from({ length: 8 }, (_, j) => this.u16(p + 2 * j)); });
      palette.startCycle(frames, 0x10);
    }
  }

  // ================= 開戰前的對話 fcdb =================
  // f95d: 劇本視窗 n (2e09:3c76) + 頭像 (2e09:3e62 = 31ef2: 目前視窗的頭像位置畫人物記錄 R)
  async talkWin(n, R) {
    const sc = (this.c.events ??= new Scenario(this.c)); await sc.init();
    await sc.op_win_open({ win: n });
    if (sc.cur >= 0) { const w = sc.W(sc.cur); this.c.kao.drawPerson(this.c.scr, this.st.bytes(R, 0x32), w.faceX, w.faceY); }
    return sc;
  }
  async closeAllWin() { const sc = (this.c.events ??= new Scenario(this.c)); await sc.init(); await sc.closeAll(); }   // 2e09:3d2b
  async parley(arg) {
    return this.u8(0x97e6) === this.st.u8(DS.HERO) ? this.parleyHero(arg) : this.parleyEnemy();
  }
  // f972 主角開戰: 對方是海盜 (艦隊 / 10 = 6 或 +31 & 0f = 6) → 0x32b (劇本開戰時 0x32a) …; 其他 → 0x32c, 對方 0x32e / 0x330 / 0x32f (是 → [9bfb] = 2, 不打)
  async parleyHero(arg) {
    const st = this.st, { message, menu } = this.c;
    let di = 0;
    const si = this.person(this.u8(0x97ee));
    let f = st.u8(si + 0x2c);
    if ((st.u8(si + 0x31) & 0x0f) === 6) f = 0x3c;
    await this.talkWin(2, this.heroRec);
    let m;
    if (Math.floor(f / 10) === 6) {
      message(arg ? 0x32a : 0x32b, st.cstr(si), st.cstr(si + 0x0d));
      await menu.waitPrompt();
      await this.talkWin(1, si);
      m = 0x32d;
    } else {
      message(0x32c); await menu.waitPrompt();
      await this.talkWin(1, si);
      if (f % 10 !== 0 && f % 10 < 5) {
        if (((this.u16(0x9d42) * 3) & 0xffff) >>> 1 < this.u16(0x9d40)) {
          message(0x32f);
          di = await menu.yesNo();
          if (di) this.set8(0x9bfb, 2);
          await this.closeAllWin();
          return di;
        }
        m = 0x330;
      } else m = 0x32e;
    }
    message(m); await menu.waitPrompt();
    await this.closeAllWin();
    return di;
  }
  // fa5b 對方開戰: 對方說話 (海盜 0x331 / 任務 3 埋伏 0x332 / 其他 0x333) → 船員 909b: 0x334 (我方較弱) / 0x335 → MENU #0x36 (交戰 / 撤離 / 投降)
  //   撤離: random(150) < 主角 +24 + +23 → 0x336, [9bfb] = 3 (不打); 否則 0x338 (照打)
  //   投降: 一般 → 0x339, 現金 × 2 / 3, 貨物剩 2/3; 海盜 → 0x33a, 現金 < 1000 → 0x33b 現金 +1000 (原版如此), < 10000 → 0x33c, 否則 0x33d 現金 = 5000, 貨物全失; [9bfb] = 9
  async parleyEnemy() {
    const st = this.st, { message, menu, sys } = this.c, b = this.sea.b, nations = this.nations;
    let di = 0;
    const si = this.person(this.u8(0x97e6));
    let f = st.u8(si + 0x2c);
    if ((st.u8(si + 0x31) & 0x0f) === 6) f = 0x3c;
    await this.talkWin(1, si);
    if (Math.floor(f / 10) === 6) message(0x331);
    else if (st.u8(this.fleetOf(f) + 0x1b) === 3) message(0x332, st.cstr(this.heroRec + 0x0d), nations[Math.floor(st.u8(si + 0x2c) / 10)]);
    else message(0x333, nations[st.u8(this.heroRec + 0x31) & 0x0f]);
    await menu.waitPrompt();
    b.crewSpeaks();                                                     // 909b
    message(((this.u16(0x9d40) * 3) & 0xffff) >>> 1 >= this.u16(0x9d42) ? 0x335 : 0x334);
    const r = await menu.popupMenu(this.c.menuItems(0x36), 0);          // 2e09:57aa(0x36) + 0fea:46ec (3 項)
    await b.closeTalk();                                                // 796d
    if (r === 1) {
      b.crewSpeaks();
      const x = this.rnd(0x96), H = this.heroRec;
      if (st.u8(H + 0x24) + st.u8(H + 0x23) > x) { message(0x336); this.set8(0x9bfb, 3); di = 1; }
      else message(0x338);
      await menu.waitPrompt(); await b.closeTalk();
    } else if (r === 2) {
      await this.talkWin(1, si);
      let keep;
      if (Math.floor(f / 10) !== 6) {
        message(0x339);
        b.money = Math.trunc(((b.money * 2) | 0) / 3);                  // seg0:3722
        keep = 2;
      } else {
        message(0x33a); await menu.waitPrompt();
        await this.talkWin(1, si);
        const m = b.money;
        if (m < 1000) { message(0x33b); b.money = m + 1000; }
        else if (m < 10000) message(0x33c);
        else { message(0x33d); b.money = 5000; }
        keep = 0;
      }
      await menu.waitPrompt();
      for (let i = 0; i < 10; i++) {
        if ((st.u8(this.slot(i) + 8) & 0x30) !== 0x10) continue;
        const M = this.crew(i);
        for (let k = 0; k < 5; k++) {
          const v = btIdiv(btS16(st.u16(M + OFF.CREW_SLOT.CARGO_AMTS + 2 * k)) * keep, 3);
          st.set16(M + OFF.CREW_SLOT.CARGO_AMTS + 2 * k, v);
          if (!(v & 0xffff)) st.set8(M + OFF.CREW_SLOT.CARGO_GOODS + k, 0xff);
        }
      }
      this.set8(0x9bfb, 9); di = 1;
    }
    await this.closeAllWin();
    return di;
  }
  // f89e 雙方戰力差距大 ([9d40] + 20 ≤ [9d42]) 時, 主角方旗艦之後忠誠 (+2b) < 40 的船長帶船離隊:
  //   劇本視窗 2 + 頭像, 0x313 + (+2f >> 6) (%s = +0d), 關閉視窗; eb3f 船長離開艦隊 (船員欄清除、5deb 移除船、+2e = 0、+2c = FF、+2d = random(54) + 3); 從船鏈與地圖移除
  async desert() {
    if (((this.u16(0x9d40) + 0x14) & 0xffff) > this.u16(0x9d42)) return;
    const st = this.st, { message, menu } = this.c;
    let E = 0x97e0;
    for (let dx = 0; dx < 4; dx++, E += 8) if (this.u16(E + 4) === this.heroFleet) break;
    let prev = this.u16(E);
    for (let si = this.u16(prev + 8); si; si = this.u16(prev + 8)) {
      const P = this.u16(si);
      if (st.u8(P + 0x2b) >= 0x28) { prev = si; continue; }
      const sc = await this.talkWin(2, P);
      message(0x313 + (st.u8(P + 0x2f) >> 6), st.cstr(P + 0x0d));
      await menu.waitPrompt();
      await sc.op_win_close();                                          // 2e09:3cce
      this.leave(this.heroSlotIndex(si));                               // eb9e → eb3f
      this.set16(prev + 8, this.u16(si + 8));
      this.and8(0x8e14 + this.u16(si + 4), 0x1f);
    }
  }
  // eb3f 主角艦隊第 i 艘的船長離隊
  leave(i) {
    const st = this.st, M = this.crew(i), cap = st.u8(M + OFF.CREW_SLOT.CAPTAIN), P = this.person(cap);
    for (let k = 0; k < 0x1e; k++) if (st.u8(DS.PARTY_CREW + k) === cap) st.set8(DS.PARTY_CREW + k, 0xff);
    this.sea.b.removeShip(i);                                           // seg0:5deb
    st.set8(P + 0x2e, 0); st.set8(P + 0x2c, 0xff); st.set8(P + 0x2d, this.rnd(0x36) + 3);
  }

  // ================= fe9a 主迴圈 =================
  async mainLoop() {
    const rt = this.c.rt;
    while ((rt.time & 0xff) < 0x3f) {
      for (let k = 0; k < 4; k++) { const E = 0x97e0 + 8 * k; this.set16(E + 2, this.u16(E)); }
      for (let di = 0; di < 10; di++) {
        for (let k = 0; k < 4; k++) {
          this.set16(0x9bc0, 0x97e0 + 8 * k);
          this.set16(0x9bc2, this.u16(0x97e0 + 8 * k + 2));
          if (!(await this.turn())) return;
        }
      }
      rt.time = (rt.time + 1) & 0xff;
    }
    this.set8(0x9bfb, 1);
  }
  // fdb8 一方行動
  async turn() {
    let si = 1;
    if (this.c.palette.ending || this.u8(0x9bfb)) return 0;
    const B = this.u16(0x9bc2);
    if (!B) return si;
    const S = this.u16(B + 2);
    if (this.u8(S + OFF.DOCK_SLOT.DURABILITY) && this.u16(S) && !(this.u8(B + 0x0c) & 0x40)) {
      const E = this.u16(0x9bc0);
      if (this.u16(E + 4) === this.heroFleet && this.u16(E) === B) si = await this.playerTurn();   // b8b1
      else si = await this.cpuTurn();                                                               // a3ce
    }
    this.set16(this.u16(0x9bc0) + 2, this.u16(this.u16(0x9bc2) + 8));
    this.status();                                                      // c327
    await this.c.sys.waitTicks(8);                                      // 5998(8)
    return si;
  }
  // ================= a3ce 電腦行動 (RE_NOTES 30.10) =================
  // 三個遠端緩衝 (0x34 × 0x30, 不在 DS): [97d4] = this.mv (bit4 可到達、bit7 + 低 4 位元 = 攻擊方向)、[97d8] = mv2 (對方的威脅)、[97dc] = mv3 (攻擊價值)
  get mv2() { return (this.c.battleMv2 ??= new Uint8Array(0x10000)); }
  get mv3() { return (this.c.battleMv3 ??= new Uint8Array(0x10000)); }
  // a3ce: 本船不活著 → 1; 9aaa 本方旗艦不健全 → 本船 +0c |= 8 (撤退); a263 三張圖 → a238 目的地 → e54f 路徑 → a2d5 照路徑移動 → a2a7 攻擊 → a35e
  async cpuTurn() {
    const cur = this.u16(0x9bc2);
    if (!this.alive(cur)) return 1;
    if (!this.flagHealthy()) this.or8(cur + 0x0c, 8);                  // 9aaa
    this.cpuMaps();                                                     // a263
    this.cpuGoal();                                                     // a238
    this.cpuPath();                                                     // e54f
    await this.runPath();                                               // a2d5
    await this.cpuAttack();                                             // a2a7
    return this.endCheck();                                             // a35e
  }
  // 9aaa 本方旗艦健全: 水手 > 船型 +12 × 4 / 10 (有號)、耐久 > 最大耐久 × 4 / 10 (的低位元組)、未沉
  flagHealthy() {
    const F = this.u16(this.u16(0x9bc0)), S = this.u16(F + OFF.FLEET.Y), R = this.shipRec(this.u8(S + OFF.DOCK_SLOT.SHIP));
    if (btIdiv(btS16((this.u16(R + 0x12) << 2) & 0xffff), 10) >= btS16(this.u16(S))) return 0;
    if ((btIdiv(btS16((this.u8(S + OFF.DOCK_SLOT.MAX_DURABILITY) << 2) & 0xffff), 10) & 0xff) >= this.u8(S + OFF.DOCK_SLOT.DURABILITY)) return 0;
    return this.u8(F + OFF.FLEET.ROUTE_FLAGS) & 0x40 ? 0 : 1;
  }
  distTo(B, x, y) { const [bx, by] = this.pos(B); return this.dist(bx, by, x, y) & 0xff; }   // d5b6
  // a263 + e1c6: mv 填 0x0f、mv3 / mv2 填 0; 本船位置 |= 0x10; dd88 威脅; 本船的左前 / 正前 / 右前三個方向各 de1f(原地); df41 可到達; e18d 友船
  cpuMaps() {
    this.mvFill(0x0f); this.mv3.fill(0, 0x2000, 0x2000 + 0x9c0); this.mv2.fill(0, 0x2000, 0x2000 + 0x9c0);
    const cur = this.u16(0x9bc2), pts = this.movePts(cur), [x, y] = this.pos(cur), dir = this.u8(cur + 0x0a);
    this.mv[this.mvAt(this.s16(cur + 4))] |= 0x10;
    this.threat();                                                      // dd88
    for (let k = 5; k < 8; k++) this.attackVal(x, y, (dir + k) % 6);   // de1f
    this.cpuReach(this.u16(cur + 4), dir, pts, this.u8(cur + 0x0b));    // df41
    this.allyBlock();                                                   // e18d
  }
  // dd88 / dd14: 對方兩方的每艘船 (不看死活) 周圍 ±5 格: 距離 d ≠ 0 時, 在它的射界內 (d8ef) → mv2 += 它的命中率[d]; d = 1 → mv2 += 它的戰力 +16 (位元組相加)
  threat() {
    let E = this.enemySide(this.u16(0x9bc2));
    for (let k = 0; k < 2; k++, E = (E + 0x10) & 0xffff)
      for (let B = this.u16(E); B; B = this.u16(B + 8)) {
        const [x, y] = this.pos(B);
        for (let yy = y - 5; yy <= y + 5; yy++) for (let xx = x - 5; xx <= x + 5; xx++) {
          if (!this.inMap(xx, yy)) continue;
          const i = this.mvAt((0x34 * yy + xx) & 0xffff), d = this.dist(x, y, xx, yy) & 0xff;
          if (!d) continue;
          if (this.inRange(B, x, y, xx, yy, this.u8(B + 0x0a))) this.mv2[i] += this.u8(B + 0x0f + d);
          if (d === 1) this.mv2[i] += this.u8(B + 0x16);
        }
      }
  }
  // de1f(x, y, dir) 攻擊價值: 本船 +0c 低 2 位元 = 0 → 不做; 砲船 (+0c bit4) 砲擊 ×2 / 接舷 ×1, 否則 ×1 / ×2;
  //   對方的每艘船 T: 本船在 (x, y) 朝 dir 時 T 在射界內 → v = T 的命中率[距離] × 倍數 (低位元組; 原版用的是目標自己的命中率); 相鄰 → v = T 的戰力 × 倍數;
  //   v ≥ mv3 → mv3 = v、mv = dir | 0x80 (整個位元組蓋掉)
  attackVal(x, y, dir) {
    const cur = this.u16(0x9bc2), f = this.u8(cur + 0x0c);
    if (!(f & 3)) return;
    const g = f & 0x10 ? 2 : 1, b = f & 0x10 ? 1 : 2, i = this.mvAt((0x34 * y + x) & 0xffff);
    let E = this.enemySide(cur);
    for (let k = 0; k < 2; k++, E = (E + 0x10) & 0xffff)
      for (let T = this.u16(E); T; T = this.u16(T + 8)) {
        const [tx, ty] = this.pos(T), d = this.dist(x, y, tx, ty) & 0xff;
        if (this.inRange(cur, x, y, tx, ty, dir)) {
          const v = (this.u8(T + 0x0f + d) * g) & 0xff;
          if (v >= this.mv3[i]) { this.mv3[i] = v; this.mv[i] = (dir | 0x80) & 0xff; }
        }
        if (d === 1) {
          const v = (this.u8(T + 0x16) * b) & 0xff;
          if (v >= this.mv3[i]) { this.mv3[i] = v; this.mv[i] = (dir | 0x80) & 0xff; }
        }
      }
  }
  // df41(p, dir, pts, mom) 可到達 (與 db20 同樣的規則): 每個可走的鄰格先 de1f(鄰格, 新方向), 再把「目前這一格」|= 0x10, 然後遞迴
  //   (所以路徑最後一格只有在它還有可走的鄰格時才會被標成可到達, 照搬)
  cpuReach(p, dir, pts, mom) {
    const cur = this.u16(0x9bc2), m = btUmin(0x64, (this.inertia(cur) + mom) & 0xffff) & 0xff;
    for (let k = 5; k < 8; k++) {
      if (m < 0x32 && k !== 6) continue;                                // d786
      const nd = (k + dir) % 6, [nx, ny] = this.nb(p, nd), cost = this.stepCost(cur, nd, dir);
      if (!this.inMap(nx, ny) || (this.u8(this.mapAt(nx, ny)) & 0xe0) || cost > pts) continue;
      this.attackVal(nx, ny, nd);                                       // de1f
      this.mv[this.mvAt(p)] |= 0x10;
      this.cpuReach((0x34 * ny + nx) & 0xffff, nd, (pts - cost) & 0xff, k === 6 ? m : 0);
    }
  }
  // e18d / e065: 本方兩方的每艘活船 B: 它正前方那格若可到達 → mv = 0x0f; 它的 6 個鄰格中 5 個有船 (本船那格不算) 時, 剩下那格若可到達 → mv = 0x0f
  allyBlock() {
    const cur = this.u16(0x9bc2);
    let E = 0x97e0 + ((this.side(cur) & 1) << 3);                       // d641
    for (let k = 0; k < 2; k++, E = (E + 0x10) & 0xffff) for (let B = this.u16(E); B; B = this.u16(B + 8)) this.allyCells(B);
  }
  allyCells(B) {
    if (!this.alive(B)) return;
    const cur = this.u16(0x9bc2), [x, y] = this.pos(B), [cx, cy] = this.pos(cur);
    let free = 0, n = 0;
    for (let d = 0; d < 6; d++) {
      const [nx, ny] = this.nb((0x34 * y + x) & 0xffff, d), si = (0x34 * ny + nx) & 0xffff;
      if (!this.inMap(nx, ny)) continue;
      if ((this.u8(this.mapAt(nx, ny)) & 0xe0) && !(nx === cx && ny === cy)) n++;
      else free = si;
      if (this.u8(B + 0x0a) === d && (this.mv[this.mvAt(si)] & 0x10)) this.mv[this.mvAt(si)] = 0x0f;
    }
    if (n === 5 && (this.mv[this.mvAt(free)] & 0x10)) this.mv[this.mvAt(free)] = 0x0f;
  }
  // a238 目的地 [9bc4]: DS:8c96 遠程函式表 [+0c & 0x0f]: 0/1 a17e、2/3 a145、4/5 a008、6/7 9fe7、8..15 9dc9 (撤退)
  cpuGoal() {
    const f = this.u8(this.u16(0x9bc2) + 0x0c) & 0x0f;
    if (f < 2) this.goalSafe();
    else if (f < 4) { const cur = this.u16(0x9bc2), T = this.u8(cur + 0x0c) & 0x80 ? this.u16(cur + 6) : this.u16(this.enemySide(cur)); this.approach(...this.pos(T)); }   // a145
    else if (f < 6) this.goalGuard();                                   // a008
    else if (f < 8) this.approach(...this.pos(this.u16(this.u16(0x9bc0))));   // 9fe7
    else this.goalFlee();                                               // 9dc9
  }
  // a17e: 可到達的格中 威脅 mv2 最小的; 相同時離本船最遠的
  goalSafe() {
    const cur = this.u16(0x9bc2);
    let bt = 0xff, bd = 0, bx = 0, by = 0;
    for (let y = 0; y < 0x30; y++) for (let x = 0; x < 0x34; x++) {
      const i = 0x2000 + y * 0x34 + x;
      if (!(this.mv[i] & 0x10)) continue;
      const d = this.distTo(cur, x, y), t = this.mv2[i];
      if (t < bt || (t === bt && bd < d)) { bx = x; by = y; bd = d; bt = t; }
    }
    this.set16(0x9bc4, (by * 0x34 + bx) & 0xffff);
  }
  // 9eb3(tx, ty) 接近: 可到達的格中 max(到 (tx, ty) 的距離, 本船射程) 最小的; 相同時攻擊價值 mv3 > 以目前最佳值換算的門檻; 再相同時離本船最遠的
  approach(tx, ty) {
    const cur = this.u16(0x9bc2);
    let b9 = 0, b8 = 0, b7 = 0xff, bx = 0, by = 0;
    for (let y = 0; y < 0x30; y++) for (let x = 0; x < 0x34; x++) {
      const i = 0x2000 + y * 0x34 + x;
      if (!(this.mv[i] & 0x10)) continue;
      const d2 = btUmax(this.dist(x, y, tx, ty) & 0xff, this.u8(cur + 0x15)) & 0xff, d4 = this.distTo(cur, x, y), v3 = this.mv3[i];
      const a = Math.floor((((((0x0c - btUmin(d2, 0x0a)) & 0xffff) * b8) & 0xffff) * 0x0a & 0xffff) / 0x64) & 0xff;
      const b1 = (btIdiv(a + 9, 10) * 10) & 0xff;
      if (d2 < b7 || (d2 === b7 && (b1 < v3 || (b1 === v3 && b9 < d4)))) { bx = x; by = y; b8 = v3; b7 = d2; b9 = d4; }
    }
    this.set16(0x9bc4, (by * 0x34 + bx) & 0xffff);
  }
  // a008 護衛: 可到達的格中 到本方旗艦的距離最小的; 相同時威脅 mv2 < 門檻; 再相同時離本船最遠的
  goalGuard() {
    const cur = this.u16(0x9bc2), [fx, fy] = this.pos(this.u16(this.u16(0x9bc0)));
    let b7 = 0xff, b8 = 0xff, b9 = 0, bx = 0, by = 0;
    for (let y = 0; y < 0x30; y++) for (let x = 0; x < 0x34; x++) {
      const i = 0x2000 + y * 0x34 + x;
      if (!(this.mv[i] & 0x10)) continue;
      const d2 = this.dist(x, y, fx, fy) & 0xff, d4 = this.distTo(cur, x, y), v3 = this.mv2[i];
      const a = Math.floor((((btUmin(d2, 0x0a) * b8) & 0xffff) * 0x0a & 0xffff) / 0x64) & 0xff;
      const b1 = (btIdiv(a + 9, 10) * 10) & 0xff;
      if (b7 > d2 || (b7 === d2 && (b1 > v3 || (b1 === v3 && b9 < d4)))) { bx = x; by = y; b8 = v3; b7 = d2; b9 = d4; }
    }
    this.set16(0x9bc4, (by * 0x34 + bx) & 0xffff);
  }
  // 9dc9 撤退: 本船已在地圖邊緣的海格 → e5fc 離開戰場 (不設目的地); 否則 可到達的邊緣海格中離本船最遠的, 沒有時 9b4d 離 12 個角落 / 邊中點最近的格
  goalFlee() {
    const cur = this.u16(0x9bc2), [x0, y0] = this.pos(cur);
    if (this.edgeSea(x0, y0)) { this.leaveField(cur); return; }
    let be = 0, bex = 0, bey = 0;
    const o = { best: 0xff, x: 0, y: 0 };
    for (let y = 0; y < 0x30; y++) for (let x = 0; x < 0x34; x++) {
      if (!(this.mv[0x2000 + y * 0x34 + x] & 0x10)) continue;
      const d = this.distTo(cur, x, y);
      if (this.edgeSea(x, y)) { if (be < d) { bex = x; bey = y; be = d; } }
      else this.corner(x, y, o);
    }
    const tx = be ? bex : o.x, ty = be ? bey : o.y;
    this.set16(0x9bc4, (ty * 0x34 + tx) & 0xffff);
  }
  // 9b4d: 12 個點 (四角、上下邊中點 0x19 / 0x1a、左右邊中點 0x17 / 0x18); 距離 < 目前最佳且該點不是陸地 → 記下
  //   (原版判斷陸地時欄列對調, 例如 (0x33, 0) 讀 8e14 + 0x33 × 0x34 = 9870, 讀到地圖外的船記錄, 照搬)
  corner(x, y, o) {
    const P = [[0, 0, 0x8e14], [0x33, 0, 0x9870], [0, 0x2f, 0x8e43], [0x33, 0x2f, 0x989f], [0x19, 0, 0x9328], [0x1a, 0, 0x935c], [0, 0x17, 0x8e2b], [0, 0x18, 0x8e2c],
      [0x33, 0x17, 0x9887], [0x33, 0x18, 0x9888], [0x19, 0x2f, 0x9357], [0x1a, 0x2f, 0x938b]];
    for (const [tx, ty, a] of P) { const d = this.dist(x, y, tx, ty) & 0xff; if (d < o.best && !(this.u8(a) & 0x80)) { o.x = x; o.y = y; o.best = d; } }
  }
  // e54f 路徑: 9bc6 / 9d30 各 10 格填 0x0f、[9d3a] = 0x0f; 已在目的地 → 9bc6[0] = e447 (原地轉向); 否則 e31f 找路
  cpuPath() {
    for (let i = 0; i < 0x0a; i++) { this.set8(0x9bc6 + i, 0x0f); this.set8(0x9d30 + i, 0x0f); }
    const cur = this.u16(0x9bc2), pts = this.movePts(cur);
    this.set8(0x9d3a, 0x0f);
    if (this.u16(cur + 4) === this.u16(0x9bc4)) this.set8(0x9bc6, this.faceDir());
    else this.pathRec(this.u16(cur + 4), this.u8(cur + 0x0a), pts, 0x9d30, this.u8(cur + 0x0b));
  }
  // e447: 本格 mv bit7 → 那個攻擊方向; 否則 左前 / 正前 / 右前中離目標 (+0c bit7 ? +6 : 對方旗艦) 最近的方向
  faceDir() {
    const cur = this.u16(0x9bc2), v = this.mv[this.mvAt(this.s16(cur + 4))];
    if (v & 0x80) return v & 0x0f;
    const T = this.u8(cur + 0x0c) & 0x80 ? this.u16(cur + 6) : this.u16(this.enemySide(cur));
    const [tx, ty] = this.pos(T), dir = this.u8(cur + 0x0a), p = this.s16(cur + 4);
    let bd = 0xff, r = 0xff;
    for (let k = 5; k < 8; k++) { const nd = (dir + k) % 6, [nx, ny] = this.nb(p, nd), d = this.dist(nx, ny, tx, ty) & 0xff; if (d < bd) { bd = d; r = nd; } }
    return r;
  }
  // e31f 遞迴找所有走得到目的地的路 (規則同 db20, 不檢查走過的格, 指標沒有上限); 到達 → e2c9
  pathRec(p, dir, pts, ptr, mom) {
    if ((p & 0xffff) === this.u16(0x9bc4)) { this.pathEnd(p, dir); return; }
    const cur = this.u16(0x9bc2), m = btUmin(0x64, (this.inertia(cur) + mom) & 0xffff) & 0xff;
    for (let k = 5; k < 8; k++) {
      if (m < 0x32 && k !== 6) continue;
      const nd = (dir + k) % 6, [nx, ny] = this.nb(p, nd), cost = this.stepCost(cur, nd, dir);
      if (!this.inMap(nx, ny) || (this.u8(this.mapAt(nx, ny)) & 0xe0) || cost > pts) continue;
      this.set8(ptr, nd);
      this.pathRec((0x34 * ny + nx) & 0xffff, nd, (pts - cost) & 0xff, (ptr + 1) & 0xffff, k === 6 ? m : 0);
      this.set8(ptr, 0x0f);
    }
  }
  // e2c9: 目的地沒有攻擊方向 → 轉彎次數 (e262) 比 [9d3a] 少才採用 (e2a4 複製到 9bc6); 有攻擊方向 → 抵達方向相同就採用 (後找到的蓋掉先前的)
  pathEnd(p, dir) {
    const n = this.turnsIn(), t = this.mv[this.mvAt(p)] & 0x0f;
    if (t === 0x0f) { if (n < this.u8(0x9d3a)) { this.copyPath(); this.set8(0x9d3a, n); } }
    else if (t === (dir & 0xff)) this.copyPath();
  }
  turnsIn() {                                                           // e262
    let prev = this.u8(this.u16(0x9bc2) + 0x0a), n = 0;
    for (let i = 0; this.u8(0x9d30 + i) < 6; i++) { if (i >= 0x0a) break; if (this.u8(0x9d30 + i) !== prev) n++; prev = this.u8(0x9d30 + i); }
    return n;
  }
  copyPath() { for (let i = 0; i < 0x0a; i++) this.set8(0x9bc6 + i, this.u8(0x9d30 + i)); }   // e2a4
  // a2a7: 本船活著且所在格 mv bit7 → eb22: eaad 選目標 ([9d3c]) → 1 砲擊 e8cc / 2 接舷 e95e
  async cpuAttack() {
    const cur = this.u16(0x9bc2);
    if (!this.alive(cur) || !(this.mv[this.mvAt(this.s16(cur + 4))] & 0x80)) return;
    const r = this.pickCpuTarget();
    if (r === 1) await this.gunnery(this.u16(0x9d3c));
    else if (r === 2) await this.board(this.u16(0x9d3c));
  }
  // eaad: +0c bit7 時先試指定的目標 +6; 否則 (或不行時) 對方兩方依序第一艘可打的
  pickCpuTarget() {
    const cur = this.u16(0x9bc2);
    if (this.u8(cur + 0x0c) & 0x80) { const r = this.canHit(this.u16(cur + 6)); if (r) { this.set16(0x9d3c, this.u16(cur + 6)); return r; } }
    let E = this.enemySide(cur);
    for (let k = 0; k < 2; k++, E = (E + 0x10) & 0xffff) for (let T = this.u16(E); T; T = this.u16(T + 8)) { const r = this.canHit(T); if (r) { this.set16(0x9d3c, T); return r; } }
    return 0;
  }
  // ea34: 目標活著; 砲船先看射界 (1) 再看相鄰 (2), 其他船先看相鄰再看射界
  canHit(T) {
    if (!this.alive(T)) return 0;
    const cur = this.u16(0x9bc2), [x, y] = this.pos(T), [cx, cy] = this.pos(cur);
    const gun = () => this.inRange(cur, cx, cy, x, y, this.u8(cur + 0x0a)), adj = () => (this.dist(cx, cy, x, y) & 0xff) === 1;
    if (this.u8(cur + 0x0c) & 0x10) return gun() ? 1 : adj() ? 2 : 0;
    return adj() ? 2 : gun() ? 1 : 0;
  }

  // ================= b8b1 玩家指令 =================
  async playerTurn() {
    const { menu } = this.c;
    for (;;) {
      this.set8(0x9bee, 0);
      const B = this.u16(0x9bc2);
      this.set16(0x9bd0, this.u16(B + 4)); this.set8(0x9be4, this.u8(B + 0x0a));
      const items = this.c.menuItems(0x32);
      this.enable();                                                    // b751
      const r = await menu.popupMenu(items, 0);                         // 0fea:46ec (8 項, 不可取消)
      const ax = await this.command(r);                                 // DS:8df4 遠程函式表
      if (ax) break;
    }
    return this.endCheck();                                             // a35e
  }
  async command(r) {
    switch (r) {
      case 0: return this.cmdMove();                                    // ad20
      case 1: return this.attack();                                     // ad38 = ac7d
      case 2: return this.cmdInfo();                                    // b258
      case 3: return this.cmdSignal();                                  // b30f
      case 4: return this.cmdOrders();                                  // b6db
      case 5: return this.cmdStop();                                    // b6f2
      case 6: await this.sea.commandsObj().belongings(); return 0;     // b71b: 1fd9:9cbc = 29a4c 隨身物 (commands.js), 回傳 0
      case 7: return this.cmdRetreat();                                 // b723
    }
    return 0;
  }
  // ================= b258 情報 / b30f 信號 / b6db 作戰 (RE_NOTES 30.15) =================
  shipName(k) { const v = btHex(this.J.shipNames[k & 0x0f] ?? ""), o = new Uint8Array(v.length + 1); o.set(v); return o; }   // DS:091c 船鏈名
  dstr(k) { const v = btHex(this.J.str[k]), o = new Uint8Array(v.length + 1); o.set(v); return o; }
  cursorCell(B) { const [x, y] = this.pos(B); return ((x - this.u8(0x9bef)) + (y - this.u8(0x9bf0)) * 0x0d) & 0xffff; }   // [a160] (customMenu 旗標 1 時沒有作用)
  // b258: MENU #0x33 → b19c → 0fea:46ec(7, 可取消) → DS:8d36 → c608 / bcfa; 取消 → 0
  async cmdInfo() {
    const { menu } = this.c;
    for (;;) {
      const items = this.c.menuItems(0x33);
      this.infoEnable();                                                // b19c
      const r = await menu.popupMenu(items, 1);
      if (r === 0xff) return 0;
      await [() => this.fleetLook(this.st.u8(DS.HERO)), () => this.infoCrew(), () => this.infoShips(), () => this.infoEnemyFleet(),
        () => this.infoEnemyPerson(), () => this.infoEnemyShip(), () => this.infoOrders()][r]();   // ad9f / ada7 / addc / ae57 / aebc / af32 / b0bc
      this.redraw();                                                    // c608
      await this.fadeIn();                                              // bcfa
    }
  }
  // b19c [a14c]: bit5 主角艦隊以外沒有視窗內的活船, bit6 目前這艘之後本方沒有活船
  infoEnable() {
    let dis = 0, vis = 0, n = 0;
    for (let k = 0; k < 4; k++) {
      const E = 0x97e0 + 8 * k;
      if (this.u16(E + 4) === this.heroFleet) continue;
      for (let B = this.u16(E); B; B = this.u16(B + 8)) { if (!this.alive(B)) continue; const [x, y] = this.pos(B); if (this.inView(x, y)) vis++; }
    }
    if (!(vis & 0xff)) dis |= 0x20;
    for (let B = this.u16(this.u16(0x9bc2) + 8); B; B = this.u16(B + 8)) if (this.alive(B)) n++;
    if (!(n & 0xff)) dis |= 0x40;
    this.c.menu.disabled = dis;
  }
  // ad3d 指揮者 p 的艦隊一覽 (0fea:d248 = 1d0e8)
  async fleetLook(p) {
    const { con, palette } = this.c, st = this.st;
    const l = con.left, r = con.right;
    con.left = 0; con.right = 0x4f;
    await this.fadeOutField();                                          // bd26
    st.set8(0x8b1e, st.u8(0x8b1e) ^ 1);
    await this.sea.commandsObj().fleetView(st.u8(this.person(p) + 0x2c));
    await palette.fadeBlack();                                          // 99f2
    st.set8(0x8b1e, st.u8(0x8b1e) ^ 1);
    this.drawPanel(); this.drawField(); this.drawShips();               // c581 / c5ff / c0ad
    con.left = l; con.right = r;
    await this.fadeIn();                                                // bcfa
  }
  // ada7 人物 (主角 + 船員, 12d8c): 清單種類 6 → 1c839(人物, 6, 1)
  async infoCrew() {
    const b = this.sea.b, cm = this.sea.commandsObj(), n = b.captainPool();
    for (;;) {
      const r = await b.listSel().select(6, n);
      await b.closeTalk();                                              // 796d
      if (r === -1) return;
      cm.personInfo(this.c.persons[r] & 0xff, 6, 1);                    // 0fea:c999
    }
  }
  // addc 本方的船: 清單種類 0 → 艦船調色盤 → 1c1a3(船位, 6) → 490b → c2ee / c608 / bcfa
  async infoShips() {
    const { palette, menu } = this.c, b = this.sea.b, cm = this.sea.commandsObj(), P = this.c.persons;
    let n = 0;
    for (let B = this.u16(this.u16(0x9bc0)); B; B = this.u16(B + 8)) if (!(this.u8(B + 0x0c) & 0x40)) P[n++] = this.heroSlotIndex(B);   // eb9e
    for (;;) {
      const r = await b.listSel().select(0, n);
      await b.closeTalk();
      if (r === -1) return;
      if (!palette.invert) palette.stopCycle();                         // 1743
      palette.setTarget(palette.table("ships")); await palette.fadeToTarget();   // 98fe(a730), 99e8
      cm.shipInfo(P[r] & 0xff, 6);                                      // 0fea:c303
      await menu.waitPrompt();                                          // 490b
      this.msgArea(); this.redraw(); await this.fadeIn();
    }
  }
  // ae57 / aebc 共用: 主角艦隊以外、艦隊 ≠ 0 的各方的提督 → [0538]
  enemyCommanders() {
    const P = this.c.persons; let n = 0;
    for (let k = 0; k < 4; k++) { const F = this.u16(0x97e0 + 8 * k + 4); if (F === this.heroFleet || !F) continue; P[n++] = this.u8(F + OFF.FLEET.ADMIRAL); }
    return n;
  }
  // ae57 對方的艦隊一覽
  async infoEnemyFleet() {
    const b = this.sea.b, P = this.c.persons, n = this.enemyCommanders();
    if (n === 1) return this.fleetLook(P[0] & 0xff);
    for (;;) {
      const r = await b.listSel().select(6, n);
      await b.closeTalk();
      if (r === -1) return;
      await this.fleetLook(P[r] & 0xff);
    }
  }
  // aebc 對方的提督資料 1c839(人物, 6, 0)
  async infoEnemyPerson() {
    const b = this.sea.b, cm = this.sea.commandsObj(), P = this.c.persons, n = this.enemyCommanders();
    if (n === 1) { cm.personInfo(P[0] & 0xff, 6, 0); await this.c.menu.waitPrompt(); return; }
    for (;;) {
      const r = await b.listSel().select(6, n);
      await b.closeTalk();
      if (r === -1) return;
      cm.personInfo(P[r] & 0xff, 6, 0);
    }
  }
  // af32 對方的船: a65e 標記 → bc37 選格 → 1c652
  async infoEnemyShip() {
    const { palette, menu } = this.c;
    this.mvFill(0);                                                     // d3f7(0x9c0, 0, [97d4])
    for (;;) {
      if (!this.markOthers()) return;                                   // a65e
      const B = await this.pickOther();                                 // bc37
      this.msgArea();
      if (!B) return;
      const E = 0x97e0 + ((this.u8(B + 0x0d) & 0x30) >> 1), F = this.u16(E + 4), idx = this.u8(B + 0x0d) & 0x0f;
      if (!palette.invert) palette.stopCycle();
      palette.setTarget(palette.table("ships")); await palette.fadeToTarget();
      for (let i = 0; i < 10; i++) if (this.u16(B + 2) === ((F + OFF.FLEET.SHIPS + 9 * i) & 0xffff)) this.enemyShipInfo(i, idx, this.u8(F + OFF.FLEET.ADMIRAL));   // 0fea:c7b2
      await menu.waitPrompt();                                          // 490b
      this.msgArea(); this.redraw(); await this.fadeIn();
    }
  }
  // a65e 主角艦隊以外各方、視窗內的船 (只看 +0c bit6, 不看死活) → bd3f 2、緩衝 |= 0x80
  markOthers() {
    let any = 0;
    for (let k = 0; k < 4; k++) {
      const E = 0x97e0 + 8 * k;
      if (this.u16(E + 4) === this.heroFleet) continue;
      for (let B = this.u16(E); B; B = this.u16(B + 8)) {
        if (this.u8(B + 0x0c) & 0x40) continue;
        const [x, y] = this.pos(B);
        if (!this.inView(x, y)) continue;
        this.mark(x, y, 2); this.mv[this.mvAt(this.s16(B + 4))] |= 0x80; any = 1;
      }
    }
    return any;
  }
  // bc37 標記的格上、耐久 ≠ 0 的 (主角艦隊以外的) 船; 取消 → 0
  async pickOther() {
    this.cellRects();                                                   // b916
    for (;;) {
      const c = await this.pickCell();                                  // b99c
      if (c === -1) return 0;
      if (!(this.mv[this.mvAt(c)] & 0x80)) continue;
      for (let k = 0; k < 4; k++) {
        const E = 0x97e0 + 8 * k;
        if (this.u16(E + 4) === this.heroFleet) continue;
        for (let B = this.u16(E); B; B = this.u16(B + 8)) if (this.s16(B + 4) === c && this.u8(this.u16(B + 2) + 2)) return B;
      }
    }
  }
  // 1c652 對方船隻資料 (提督 cmdr 的艦隊第 i 船位, 船鏈序號 idx)
  enemyShipInfo(i, idx, cmdr) {
    const st = this.st, { win, graph, con, message, printf, scr } = this.c, cm = this.sea.commandsObj(), T0 = cm.T;
    const lab = this.c.menuItems(0x29);                                 // 2e09:57aa(0x29)
    const P = this.person(cmdr), F = this.fleetOf(st.u8(P + 0x2c)), S = (F + 9 * i + 0x2b) & 0xffff;
    const R = this.shipRec(st.u8(S + OFF.DOCK_SLOT.SHIP)), T = this.typeRec(st.u8(R + 0x0f));
    const cur = [st.u8(S + OFF.DOCK_SLOT.DURABILITY), st.u8(S + OFF.DOCK_SLOT.TURN), st.u8(S + OFF.DOCK_SLOT.PROPULSION), st.u16(S)], max = [st.u8(S + OFF.DOCK_SLOT.MAX_DURABILITY), st.u8(T + 2), st.u8(T + 3), st.u16(R + 0x12)];
    win.frame(6, 0x20, 0x29, 0x150, 0);                                 // 7358
    graph.draw(st.u8(R + 0x0f) + 0x1c, 8 << 3, 0x30);                   // 8050
    con.puts(this.dstr("a779"));
    scr.fillCols(0x1a, 0x80, 1, 0xe0, 2);                               // 0906
    con.left = 8; con.setCursor(8, 0x98);
    message(0x376, st.cstr(P));
    printf(this.dstr("a780"), this.shipName(idx));
    const k = st.u8(S + OFF.DOCK_SLOT.FLAGS) & 7;
    message(0x377, T0.cannons[k]);
    con.left++; con.setCursor(con.left, -1);                            // 442c
    if (k) message(0x378, st.u8(S + OFF.DOCK_SLOT.GUNS), st.u8(R + 0x11), btS16(T0.gunW[k] * st.u8(S + OFF.DOCK_SLOT.GUNS)));
    this.c.barColors = [2, 1];                                          // 9376(2, 1)
    for (let j = 0; j < 4; j++) {
      con.setCursor(0x1c, (j + 4) << 5); message(0x37f, lab[j], cur[j], max[j]);
      cm.barFrame(0x1e, (j << 5) + 0x94, 1);                            // 90c0
      cm.bar(0x1e, (j << 5) + 0x94, btSdiv32((100 * cur[j]) >>> 0, max[j] || 1), 1);   // 3722 / 91a1
    }
  }
  // b0bc 本方各船的命令一覽 (視窗不保存背景)
  async infoOrders() {
    const { win, con, printf, menu } = this.c, st = this.st, flag = this.u16(this.u16(0x9bc0));
    let n = 0; for (let B = flag; B; B = this.u16(B + 8)) if (this.alive(B)) n++;
    win.frame(0, 0x20, 0x34, (n * 0x18 + 0x20) & 0xffff, 0);           // 7358
    printf(this.ds(0x8d22));
    let di = 0;
    for (let B = flag; B; B = this.u16(B + 8)) {
      if (!this.alive(B)) continue;
      const R = this.shipRec(this.u8(this.u16(B + 2) + 7));
      con.setCursor(2, ((di + 2) * 0x18) & 0xffff);
      printf(this.ds(0x8d29), (this.u8(B + 0x0d) & 0x0f) + 1, st.cstr(R));
      con.setCursor(0x14, -1);                                          // 442c
      if (B === flag) printf(this.ds(0x8d31));
      else { this.orderA(B); this.orderB(B); }                          // affe / b03e
      di++;
    }
    await menu.waitPrompt();                                            // 490b
    this.msgArea();                                                     // c2ee
  }
  orderA(B) {                                                           // affe: 撤離 / 集結 / 分敢、攻勢 / 守勢
    const f = this.u8(B + 0x0c), pf = a => this.c.printf(this.ds(a));
    pf(f & 8 ? 0x8cd6 : f & 4 ? 0x8cdc : 0x8ce2); pf(f & 1 ? 0x8ce8 : 0x8cee);
  }
  orderB(B) {                                                           // b03e: 攻擊 / 退避、砲擊 / 肉搏、對象
    const f = this.u8(B + 0x0c), pf = (a, ...x) => this.c.printf(this.ds(a), ...x);
    pf(f & 2 ? 0x8cf4 : 0x8cfa); pf(f & 0x10 ? 0x8d00 : 0x8d08);
    if (f & 0x80) { const T = this.u16(B + 6); pf(this.u8(T + 0x0d) & 0x20 ? 0x8d10 : 0x8d13); pf(0x8d16, this.shipName(this.u8(T + 0x0d) & 0x0f)); }
    else pf(0x8d19);
  }
  // b30f 信號: 目前這艘 (旗艦) +0c bit3 / bit2 / bit0 切換 → 結束時抄給本方之後的每艘
  async cmdSignal() {
    const { con, menu, printf } = this.c, cur = this.u16(0x9bc2), R = menu.rects;
    this.msgArea();                                                     // c2ee
    this.signalText(cur);                                               // b2b5
    for (let i = 0; i < 3; i++) R[i] = { x0: 0x1b8 + 0x30 * i, x1: 0x1d8 + 0x30 * i, y0: 0x170, y1: 0x180 };
    R[3] = { x0: 0x1a8, x1: 0x268, y0: 0x148, y1: 0x1e0 };
    for (;;) {
      con.bg = 0;                                                       // [8a28]
      con.setCursor(0x3e, 0x160); printf(this.ds(0x8d83));
      con.setCursor(0x36, 0x170); this.signalText(cur);
      menu.cur = this.cursorCell(cur);                                  // [a160]
      const r = (await menu.customMenu(3, 3, 1)) & 0xff;                // 0fea:4684
      if (r === 0xff) break;
      if (r < 3) this.set8(cur + 0x0c, this.u8(cur + 0x0c) ^ [8, 4, 1][r]);
    }
    for (let B = this.u16(cur + 8); B; B = this.u16(B + 8)) {
      const f = this.u8(cur + 0x0c);
      this.set8(B + 0x0c, (this.u8(B + 0x0c) & 0xf0) | (f & 0x0d) | ((f & 1) << 1));
    }
    this.msgArea();
    return 0;
  }
  // b2b5 信號的現況
  signalText(B) {
    const { con, printf } = this.c, f = this.u8(B + 0x0c);
    con.puts(this.ds(0x8d52));
    printf(this.ds(f & 8 ? 0x8d59 : 0x8d60)); printf(this.ds(f & 4 ? 0x8d67 : 0x8d6e)); printf(this.ds(f & 1 ? 0x8d75 : 0x8d7c));
    con.bg = 7;
  }
  // b6db 作戰: b44a 選本方的船 → b61f, 直到取消
  async cmdOrders() {
    for (;;) { const B = await this.pickOwn(); if (!B) return 0; await this.shipOrders(B); }
  }
  // b44a: 緩衝 0 → a541 標記 → 0x305 → bb80 選格 → c2ee / c608
  async pickOwn() {
    this.mvFill(0);
    if (!this.markOwn()) return 0;                                      // a541
    this.msgArea(); this.c.message(0x305);
    const B = await this.pickOwnCell();                                 // bb80
    this.msgArea(); this.redraw();
    return B;
  }
  // a541 目前這艘之後、本方視窗內的活船 → bd3f 1、緩衝 |= 0x80
  markOwn() {
    let any = 0;
    for (let B = this.u16(this.u16(0x9bc2) + 8); B; B = this.u16(B + 8)) {
      if (!this.alive(B)) continue;
      const [x, y] = this.pos(B);
      if (!this.inView(x, y)) continue;
      this.mark(x, y, 1); this.mv[this.mvAt(this.s16(B + 4))] |= 0x80; any = 1;
    }
    return any;
  }
  // bb80 標記的格上 d52c 的本方船 (目前這艘之後); 取消 → 0
  async pickOwnCell() {
    this.cellRects();
    for (;;) {
      const c = await this.pickCell();
      if (c === -1) return 0;
      if (!(this.mv[this.mvAt(c)] & 0x80)) continue;
      for (let B = this.u16(this.u16(0x9bc2) + 8); B; B = this.u16(B + 8)) if (this.alive(B) && this.s16(B + 4) === c) return B;
    }
  }
  // b61f 一艘船的命令: 0 策略 (bit1, bit0 = bit1)、1 戰術 (bit4)、2 對象 (bit7 + +6)
  async shipOrders(B) {
    const { menu } = this.c;
    this.msgArea();
    for (;;) {
      this.ordersText(B);                                               // b4a5
      menu.cur = this.cursorCell(this.u16(0x9bc2));
      const r = (await menu.customMenu(3, 1, 1)) & 0xff;                // 0fea:4684
      if (r === 0xff) break;
      if (r === 0) { this.set8(B + 0x0c, this.u8(B + 0x0c) ^ 2); this.and8(B + 0x0c, 0xfe); this.or8(B + 0x0c, (this.u8(B + 0x0c) & 2) >> 1); }
      else if (r === 1) this.set8(B + 0x0c, this.u8(B + 0x0c) ^ 0x10);
      else if (r === 2) {
        if (!(this.u8(B + 0x0c) & 0x80)) { this.or8(B + 0x0c, 0x80); this.set16(B + 6, await this.pickTargetFor()); }
        else { this.and8(B + 0x0c, 0x7f); this.set16(B + 6, 0); }
        if (!this.u16(B + 6)) this.and8(B + 0x0c, 0x7f);
      }
    }
    this.msgArea();
  }
  // b4a5 一艘船的命令現況與點擊區
  ordersText(B) {
    const { con, printf, menu } = this.c, f = this.u8(B + 0x0c), R = menu.rects, pf = (a, ...x) => printf(this.ds(a), ...x);
    con.puts(this.ds(0x8d86));
    con.setCursor(0x36, 0x150); pf(0x8d8d); pf(f & 2 ? 0x8d94 : 0x8da1);
    con.setCursor(0x36, 0x160); pf(0x8dae); pf(f & 0x10 ? 0x8db5 : 0x8dc2);
    con.setCursor(0x36, 0x170); pf(0x8dcf);
    if (f & 0x80) { const T = this.u16(B + 6); pf(this.u8(T + 0x0d) & 0x20 ? 0x8dd6 : 0x8ddd); pf(0x8de4, this.shipName(this.u8(T + 0x0d) & 0x0f)); }
    else pf(0x8de7);
    for (let i = 0; i < 3; i++) R[i] = { x0: 0x1e0, x1: 0x240, y0: (i + 0x15) << 4, y1: ((i + 0x15) << 4) + 0x10 };
    R[3] = { x0: 0x1a8, x1: 0x268, y0: 0x148, y1: 0x1e0 };
    con.bg = 7;
  }
  // b5c4 指定對象: 緩衝 0 → a5c2 → 0x306 → bbcd → c2ee / c608
  async pickTargetFor() {
    this.mvFill(0);
    if (!this.markEnemyVis()) return 0;                                 // a5c2
    this.msgArea(); this.c.message(0x306);
    const T = await this.pickEnemyCell();                               // bbcd
    this.msgArea(); this.redraw();
    return T;
  }
  // a5c2 對方兩方、視窗內的活船 → bd3f 2、緩衝 |= 0x80
  markEnemyVis() {
    let any = 0, E = this.enemySide(this.u16(0x9bc2));
    for (let k = 0; k < 2; k++, E += 0x10)
      for (let B = this.u16(E); B; B = this.u16(B + 8)) {
        if (!this.alive(B)) continue;
        const [x, y] = this.pos(B);
        if (!this.inView(x, y)) continue;
        this.mark(x, y, 2); this.mv[this.mvAt(this.s16(B + 4))] |= 0x80; any = 1;
      }
    return any;
  }
  // bbcd 標記的格上任何對方的船 (不看死活); 取消 → 0
  async pickEnemyCell() {
    this.cellRects();
    for (;;) {
      const c = await this.pickCell();
      if (c === -1) return 0;
      if (!(this.mv[this.mvAt(c)] & 0x80)) continue;
      let E = this.enemySide(this.u16(0x9bc2));
      for (let k = 0; k < 2; k++, E += 0x10) for (let B = this.u16(E); B; B = this.u16(B + 8)) if (this.s16(B + 4) === c) return B;
    }
  }

  // ================= ad20 移動 (RE_NOTES 30.6) =================
  // [97d4] 遠端緩衝 0x34 × 0x30 (不在 DS): 移動 bit4 可到達 / bit7 第一步可到達; 轉向 / 攻擊 bit6 目標、bit1 射界內、bit0 相鄰
  //   原版以 [97d4] + 位置 存取 (位置可能超出 0..0x9bf), 移植版在 64K 陣列的 0x2000 處
  get mv() { return (this.c.battleMv ??= new Uint8Array(0x10000)); }
  mvAt(p) { return (0x2000 + btS16(p)) & 0xffff; }
  mvFill(v) { this.mv.fill(v & 0xff, 0x2000, 0x2000 + 0x9c0); }       // d3f7(0x9c0, v, [97d4])
  // DS:9c06 方向表 (6 × 3 word: dx、偶數欄 dy、奇數欄 dy): 位置 p 往方向 d 的鄰格 (欄, 列)
  nb(p, d) {
    p = btS16(p); const x = btImod(p, 0x34), y = btIdiv(p, 0x34);
    return [x + this.s16(0x9c06 + 6 * d), y + this.s16(0x9c06 + 2 * (3 * d + (btImod(x, 2) === 0 ? 1 : 2)))];
  }
  abil(B, k) { return this.u8(this.u16(B) + 0x1c + k); }               // d419: 船長 +1c + k
  // d745 慣性: s = (轉向 × 船長 +1d) / 200 (有號), min(100, s + (船長 +24 × s) / 15)
  inertia(B) {
    const S = this.u16(B + 2), si = btIdiv(btS16((this.u8(S + OFF.DOCK_SLOT.TURN) * this.abil(B, 1)) & 0xffff), 200) & 0xffff;
    return btUmin(0x64, (Math.floor(((this.u8(this.u16(B) + 0x24) * si) & 0xffff) / 15) + si) & 0xffff);
  }
  // d792 移動力: s = ((推進 × 風力) << 3) / 150 + 20, s = s × 船長 +1d / 100, max(10, min(25, s + (船長 +24 × s) / 15))
  movePts(B) {
    const S = this.u16(B + 2);
    let si = Math.floor((((this.u8(S + OFF.DOCK_SLOT.PROPULSION) * this.u8(0x9bf9)) << 3) & 0xffff) / 0x96) + 0x14;
    si = Math.floor(((si * this.abil(B, 1)) & 0xffff) / 0x64);
    const a = btUmin(0x19, (Math.floor(((this.u8(this.u16(B) + 0x24) * si) & 0xffff) / 15) + si) & 0xffff);
    return (a >= 0x0a ? a : 0x0a) & 0xff;
  }
  // d6f6 一步的消耗 (新方向 nd, 原方向 dir)
  stepCost(B, nd, dir) {
    const S = this.u16(B + 2), w = this.u8(0x9bf2 + (nd & 0xff));
    if ((nd & 0xff) === (dir & 0xff)) return (Math.floor((this.u8(S + OFF.DOCK_SLOT.PROPULSION) * w) / 0x64) + 5) & 0xff;
    if (w < 3) return 5;
    return (0x0a - Math.floor((5 * this.u8(S + OFF.DOCK_SLOT.TURN)) / 0x64)) & 0xff;
  }
  // dc3c 可到達範圍
  reach(B, p, dir, pts, mom) {
    this.mvFill(0x0f);
    this.mv[this.mvAt(p)] |= 0x10;
    this.reachRec(B, p, dir, pts, mom);                                 // db20
    for (let d = 5; d < 8; d++) {
      const [nx, ny] = this.nb(p, (d + dir) % 6), q = this.mvAt((ny * 0x34 + nx) & 0xffff);
      if (this.mv[q] & 0x10) this.mv[q] |= 0x80;
    }
  }
  // db20 遞迴: 慣性' < 50 時只看正前 (方向 + 6)
  reachRec(B, p, dir, pts, mom) {
    const m = btUmin(0x64, (this.inertia(B) + mom) & 0xffff) & 0xff;
    for (let d = 5; d < 8; d++) {
      if (m < 0x32 && d !== 6) continue;                                // d786
      const nd = (d + dir) % 6, [nx, ny] = this.nb(p, nd), cost = this.stepCost(B, nd, dir), q = (ny * 0x34 + nx) & 0xffff;
      if (!this.inMap(nx, ny) || (this.u8(this.mapAt(nx, ny)) & 0xe0) || cost > pts) continue;
      this.mv[this.mvAt(q)] |= 0x10;
      this.reachRec(B, q, nd, (pts - cost) & 0xff, d === 6 ? m : 0);
    }
  }
  // bd3f 標記圖 (063e 模式 0x400 | 色, 4 × 0x20, 奇數欄下移 16)
  mark(x, y, t) {
    const { scr, gfx } = this.c;
    const X = ((x - this.u8(0x9bef)) << 2), Y = ((y - this.u8(0x9bf0)) << 5) + (btImod(x, 2) === 0 ? 0 : 0x10);
    let di = 4, si = 0x68c0;
    if (t === 1) { di = 2; si = 0x3820; } else if (t === 2) si = 0x3820; else if (t === 3) { di = 6; si = 0x38a0; } else if (t === 4) { di = 3; si = 0x3920; }
    else if (t >= 0x80 && t <= 0x85) si = (0x68c0 + ((t & 0x0f) << 7) + 0x280) & 0xffff;
    scr.glyphMode(X, Y, 4, 0x20, (t && !(t & 0x80) ? gfx : this.hd).subarray(si), 0x400 | di);
  }
  // a6f2 標出可到達的格、已走的路徑、可攻擊的船; 回傳有沒有第一步可到達 (bit7) 的格
  showReach() {
    const idx = this.u8(0x9bee), p = this.s16(0x9bd0 + 2 * idx), cx = btImod(p, 0x34), cy = btIdiv(p, 0x34);
    let any = 0;
    for (let y = this.u8(0x9bf0); this.u8(0x9bf0) + 0x0c > y; y++) for (let x = this.u8(0x9bef); this.u8(0x9bef) + 0x0d > x; x++) {
      const d = this.dist(cx, cy, x, y) & 0xff, v = this.mv[this.mvAt((y * 0x34 + x) & 0xffff)];
      if (!(v & 0x10) || !d) continue;
      if (v & 0x80) { this.mark(x, y, 1); any = 1; } else this.mark(x, y, 2);
    }
    for (let i = 1; i <= this.u8(0x9bee); i++) {
      const q = this.s16(0x9bd0 + 2 * i);
      this.mark(btImod(q, 0x34), btIdiv(q, 0x34), this.u8(0x9be4 + i) | 0x80);
    }
    this.markTargets();                                                 // a40a
    return any;
  }
  // a40a 兩個敵方的活船: 射界內 → 標記 3、緩衝 |= 0x42; 相鄰 → 標記 4、|= 0x41
  markTargets() {
    const idx = this.u8(0x9bee), p = this.s16(0x9bd0 + 2 * idx), x = btImod(p, 0x34), y = btIdiv(p, 0x34), dir = this.u8(0x9be4 + idx);
    const cur = this.u16(0x9bc2);
    let E = this.enemySide(cur), r = 0;
    for (let k = 0; k < 2; k++, E += 0x10) for (let si = this.u16(E); si; si = this.u16(si + 8)) {
      if (!this.alive(si) || (this.u8(si + 0x0c) & 0x40)) continue;
      const [ex, ey] = this.pos(si), q = this.mvAt(this.s16(si + 4));
      if (this.inRange(cur, x, y, ex, ey, dir)) { if (this.inView(ex, ey)) this.mark(ex, ey, 3); this.mv[q] |= 0x42; r = 1; }
      if ((this.dist(x, y, ex, ey) & 0xff) === 1) { if (this.inView(ex, ey)) this.mark(ex, ey, 4); this.mv[q] |= 0x41; r = 1; }
    }
    return r;
  }
  // b916 選格用的矩形 (DS:bdcc): 13 × 12 格 + 整個戰場
  cellRects() {
    const R = this.c.menu.rects; let di = 0;
    for (let dy = 0; dy < 0x0c; dy++) for (let si = 0; si < 0x0d; si++, di++) {
      const y0 = (((this.u8(0x9bef) + si) % 2) ? 0x10 : 0) + (dy << 5);
      R[di] = { x0: si << 5, x1: (si << 5) + 0x20, y0, y1: y0 + 0x20 };
    }
    R[di] = { x0: 0, x1: 0x1a0, y0: 0, y1: 0x190 };
  }
  // b99c 選一格: [a160] = 目前位置 → 0fea:4684 (156 項、13 欄、可取消且保留游標); 回傳位置, 取消 → −1
  async pickCell() {
    const menu = this.c.menu, p = this.s16(0x9bd0 + 2 * this.u8(0x9bee));
    menu.cur = (btImod(p, 0x34) + (btIdiv(p, 0x34) - this.u8(0x9bf0)) * 0x0d - this.u8(0x9bef)) & 0xffff;
    menu.hexX = this.u8(0x9bef);                                       // 13e0e 的斜向鍵讀 DS:9bef
    const r = (await menu.customMenu(0x9c, 0x0d, 3)) & 0xff;
    if (r === 0xff) return -1;
    return btS16(((Math.floor(r / 0x0d) + this.u8(0x9bf0)) * 0x34 + r % 0x0d + this.u8(0x9bef)) & 0xffff);
  }
  // ba28 選方向: 目前位置 → 0x80, 左前 / 正前 / 右前中緩衝 bit7 的格 → 該方向, 取消 → 0xff
  async pickDir() {
    const idx = this.u8(0x9bee), p = this.s16(0x9bd0 + 2 * idx), dir = this.u8(0x9be4 + idx);
    this.cellRects();
    for (;;) {
      const c = await this.pickCell();
      if (c === -1) return 0xff;
      if (this.s16(0x9bd0 + 2 * this.u8(0x9bee)) === c) return 0x80;
      for (let d = 5; d < 8; d++) {
        const nd = (dir + d) % 6, [nx, ny] = this.nb(p, nd), q = btS16((ny * 0x34 + nx) & 0xffff);
        if (q === c && (this.mv[this.mvAt(q)] & 0x80)) return nd;
      }
    }
  }
  redraw() { this.drawField(); this.drawShips(); }                     // c608 = c5ff + c0ad
  // ad20 移動: a899 逐步移動 → 有移動時 ac7d; 否則 aaac 原地轉向 → 有轉向時 ac7d
  async cmdMove() {
    if (!(await this.moveSteps())) { if (!(await this.turnInPlace())) return 0; }
    await this.attack();
    return 1;
  }
  // a899 逐步移動 (區域變數: 慣性[i] = bp−22 + 2i、移動力[i] = bp−0e + i、選到的方向 bp−1; 以 L 模擬堆疊框)
  async moveSteps() {
    const L = new Uint8Array(0x30), F = k => 0x30 - k;
    const mom = i => L[F(0x22) + 2 * i] | (L[F(0x22) + 2 * i + 1] << 8), setMom = (i, v) => { L[F(0x22) + 2 * i] = v & 0xff; L[F(0x22) + 2 * i + 1] = (v >> 8) & 0xff; };
    const pts = i => L[F(0x0e) + i], setPts = (i, v) => { L[F(0x0e) + i] = v & 0xff; };
    for (;;) {
      for (let i = 0; i < 0x0a; i++) this.set8(0x9bc6 + i, 0x0f);       // 4c39
      this.set8(0x9bee, 0);
      let B = this.u16(0x9bc2);
      this.set16(0x9bd0, this.u16(B + 4)); this.set8(0x9be4, this.u8(B + 0x0a));
      setMom(0, this.u8(B + 0x0b));
      setPts(0, this.movePts(B));                                       // d792
      for (;;) {
        let idx = this.u8(0x9bee);
        this.reach(this.u16(0x9bc2), this.s16(0x9bd0 + 2 * idx), this.u8(0x9be4 + idx), pts(idx), mom(idx));   // dc3c
        if (!this.showReach()) break;                                   // a6f2
        this.msgArea(); this.c.message(0x2ff);
        L[F(1)] = await this.pickDir();                                 // ba28
        if (L[F(1)] === 0xff) { this.msgArea(); this.redraw(); break; }
        this.msgArea(); this.redraw();
        if (L[F(1)] === 0x80) {
          this.set8(0x9bc6 + this.u8(0x9bee), 0x0f);
          this.set8(0x9bee, this.u8(0x9bee) - btUmin(1, this.u8(0x9bee)));
          continue;
        }
        idx = this.u8(0x9bee);
        const r = L[F(1)], [nx, ny] = this.nb(this.s16(0x9bd0 + 2 * idx), r);
        this.set16(0x9bd2 + 2 * idx, (ny * 0x34 + nx) & 0xffff);         // 步 = 9 時蓋到 9be4 / 9be5
        this.set8(0x9be5 + idx, L[F(1)]);                               // 步 = 9 時就是 [9bee]
        if (this.u8(0x9be4 + idx) !== L[F(1)]) setMom(this.u8(0x9bee) + 1, 0);
        else { const s = this.u8(0x9bee); B = this.u16(0x9bc2); setMom(s + 1, btUmin(0x64, (this.inertia(B) + mom(s)) & 0xffff) & 0xff); }
        const s = this.u8(0x9bee);
        setPts(s + 1, pts(s) - this.stepCost(this.u16(0x9bc2), L[F(1)], this.u8(0x9be4 + s)));
        this.set8(0x9bc6 + this.u8(0x9bee), L[F(1)]);
        const old = this.u8(0x9bee); L[F(2)] = old; this.set8(0x9bee, old + 1);
        if (old >= 9) break;
      }
      if (!this.u8(0x9bee)) return 0;
      this.showReach();
      this.msgArea(); this.c.message(0x300);
      const ok = await this.confirm();                                  // bca4
      this.msgArea(); this.redraw();
      if (ok) {
        this.set16(0x9bc4, this.u16(0x9bd0 + 2 * this.u8(0x9bee)));
        await this.runPath();                                           // a2d5
        await this.scrollTo();                                          // a80a
        return this.u8(0x9bee);
      }
    }
  }
  // a2d5 照 9bc6 的路徑移動 (起點 ≠ 終點才真的移動)
  async runPath() {
    const di = this.s16(this.u16(0x9bc2) + 4) !== this.s16(0x9bc4) ? 1 : 0;
    for (let si = 0x9bc6, n = 0; this.u8(si) < 6 && n < 0x0a; si++, n++) {
      const B = this.u16(0x9bc2), old = this.u8(B + 0x0a);
      this.set8(B + 0x0a, this.u8(si));
      if (old !== this.u8(si) && di) this.set8(B + 0x0b, 0);
      else this.set8(B + 0x0b, btUmin(0x64, (this.inertia(B) + this.u8(B + 0x0b)) & 0xffff));
      await this.stepShip(di);                                          // c611
    }
  }
  // c611 目前的船往 +0a 方向移一格 (moved = 0 時原地重畫)
  async stepShip(moved) {
    const B = this.u16(0x9bc2), p = this.s16(B + 4), si = btImod(p, 0x34), di = btIdiv(p, 0x34);
    let [nx, ny] = moved ? this.nb(p, this.u8(B + 0x0a)) : [si, di];
    this.set16(B + 4, (0x34 * ny + nx) & 0xffff);
    if (this.inView(si, di)) this.tile(si, di);                         // c2a4
    this.miniDot(si, di, 0x405);                                        // be49(色 5)
    this.drawShip(this.u16(0x9bc2));                                    // c05d
    this.miniShip(this.u16(0x9bc2));                                    // beb7
    await this.c.sys.waitTicks(8);
    const o = this.mapAt(si, di), a = this.u8(o) & 0xe0;
    this.and8(o, 0x1f);
    const n = (0x8e14 + ((0x34 * ny) & 0xffff) + nx) & 0xffff;
    this.and8(n, 0x1f); this.or8(n, a);
  }
  // a80a 視窗每次各軸移 1 格捲到以目前的船為準的位置
  async scrollTo() {
    const ox = this.u8(0x9bef), oy = this.u8(0x9bf0);
    this.viewFor(this.u16(0x9bc2));                                     // f7e3
    const tx = this.u8(0x9bef), ty = this.u8(0x9bf0);
    this.set8(0x9bef, ox); this.set8(0x9bf0, oy);
    while (this.u8(0x9bef) !== tx || this.u8(0x9bf0) !== ty) {
      if (this.u8(0x9bef) !== tx) this.set8(0x9bef, this.u8(0x9bef) < tx ? this.u8(0x9bef) + 1 : this.u8(0x9bef) - 1);
      if (this.u8(0x9bf0) !== ty) this.set8(0x9bf0, this.u8(0x9bf0) < ty ? this.u8(0x9bf0) + 1 : this.u8(0x9bf0) - 1);
      await this.c.sys.waitTicks(4);
      this.redraw();
    }
  }
  // aaac 原地轉向: 左前 / 右前 (+5 / +7) 的鄰格 |= 0x90 → 0x301 → ba28
  async turnInPlace() {
    let B = this.u16(0x9bc2);
    this.set8(0x9bee, 0); this.set16(0x9bd0, this.u16(B + 4)); this.set8(0x9be4, this.u8(B + 0x0a));
    this.mvFill(0);
    const p = this.s16(B + 4), dir = this.u8(B + 0x0a);
    for (let d = 5; d < 8; d += 2) {
      const [nx, ny] = this.nb(p, (dir + d) % 6);
      if (this.inMap(nx, ny)) this.mv[this.mvAt((ny * 0x34 + nx) & 0xffff)] |= 0x90;
    }
    this.showReach();
    this.msgArea(); this.c.message(0x301);
    const r = await this.pickDir();
    if (r & 0x80) { this.msgArea(); this.redraw(); return 0; }
    B = this.u16(0x9bc2); this.set8(B + 0x0a, r); this.set8(B + 0x0b, 0);
    this.msgArea(); this.redraw();
    await this.stepShip(0);
    await this.scrollTo();
    return 1;
  }
  // ac7d 攻擊 (指令 攻擊 ad38 也是它): 沒有目標 → 0; 0x304 → bb0b 選目標 → 射界內 e8cc 砲擊, 否則 abef (一騎打) / e95e 接舷
  async attack() {
    this.mvFill(0);
    this.set8(0x9bee, 0);
    const B = this.u16(0x9bc2);
    this.set16(0x9bd0, this.u16(B + 4)); this.set8(0x9be4, this.u8(B + 0x0a));
    if (!this.markTargets()) return 0;
    this.msgArea(); this.c.message(0x304);
    const T = await this.pickTarget();                                  // bb0b
    if (!T) { this.msgArea(); this.redraw(); return 0; }
    this.msgArea(); this.redraw();
    if (this.mv[this.mvAt(this.s16(T + 4))] & 2) await this.gunnery(T); // e8cc
    else if (!(await this.duelOffer(T))) await this.board(T);           // abef / e95e
    return 1;
  }
  // bb0b 選目標: 緩衝 & 0x43 且有敵方活船的格
  async pickTarget() {
    this.cellRects();
    for (;;) {
      const c = await this.pickCell();
      if (c === -1) return 0;
      if (!(this.mv[this.mvAt(c)] & 0x43)) continue;
      let E = this.enemySide(this.u16(0x9bc2));
      for (let k = 0; k < 2; k++, E += 0x10) for (let si = this.u16(E); si; si = this.u16(si + 8)) if (this.alive(si) && this.s16(si + 4) === c) return si;
    }
  }
  // abef 目標是敵方旗艦: 0x302 是否 → 是: random(主角 +23) + 本船水手 ≥ 目標水手 → 0fea:2d1a(1, 目標) 一騎打 (回傳 1); 否則 0x303
  async duelOffer(T) {
    const E = this.enemySide(this.u16(0x9bc2));
    if (this.u16(E) !== T && this.u16(E + 0x10) !== T) return 0;
    this.msgArea(); this.c.message(0x302);
    if (await this.confirm()) {
      this.msgArea();
      const a = (this.rnd(this.st.u8(this.heroRec + 0x23)) + this.u16(this.u16(this.u16(0x9bc2) + 2))) & 0xffff;
      if (a >= this.u16(this.u16(T + 2))) { await this.duel(1, T); return 1; }
      this.c.message(0x303); await this.c.menu.waitPrompt();
      this.msgArea();
    }
    this.msgArea();
    return 0;
  }
  // ================= e8cc 砲擊 (RE_NOTES 30.8) =================
  // e8cc: e735 損傷 → cdcd 動畫 → 目標耐久 = 0 → e679 擊沉; 水手 = 0 → e6bb 無人船; 否則目前這方是主角艦隊時 e616(本船船長, 10) → 本船 +0e (砲彈) − 1
  async gunnery(T) {
    this.damage(T);                                                     // e735
    await this.shotAnim(T);                                             // cdcd
    const S = this.u16(T + 2);
    if (!this.u8(S + OFF.DOCK_SLOT.DURABILITY)) this.sink(T);                                  // e679
    else if (!this.u16(S)) this.unmanned(T);                            // e6bb
    else if (this.u16(this.u16(0x9bc0) + 4) === this.heroFleet) this.gainExp(this.u16(this.u16(0x9bc2)), 0x0a);   // e616
    const B = this.u16(0x9bc2);
    this.set16(B + 0x0e, this.u16(B + 0x0e) - 1);
    this.c.probe?.("e8cc");                                             // 差分測試的快照點 (原版 e91a); 遊戲中不做任何事
  }
  // d5e4 兩艘船的六角格距離 (d54a)
  shipDist(A, B) { const [x, y] = this.pos(A), [tx, ty] = this.pos(B); return this.dist(x, y, tx, ty) & 0xff; }
  // d427 能力 +1c + k: 船長是主角 ([c2ce]) 時再與職務 3 / 5 的船員 (seg0:5cee) 比, 取較大
  bestAbil(B, k) {
    const st = this.st, P = this.u16(B);
    let v = st.u8(P + 0x1c + (k & 0xff));
    if (P === this.heroRec) for (const role of [3, 5]) {
      const n = this.sea.b.roleMember(role);
      if (n !== 0xff) { const w = st.u8(this.person(n) + 0x1c + (k & 0xff)); if (w > v) v = w; }
    }
    return v;
  }
  // d48f 戰鬥等級 +25: 同上
  bestLevel(B) {
    const st = this.st, P = this.u16(B);
    let v = st.u8(P + 0x25);
    if (P === this.heroRec) for (const role of [3, 5]) {
      const n = this.sea.b.roleMember(role);
      if (n !== 0xff) { const w = st.u8(this.person(n) + 0x25); if (w > v) v = w; }
    }
    return v;
  }
  // d4e4 +30 bit2 (砲術): 船長有, 或船長是主角時職務 3 / 5 的船員有
  gunSkill(B) {
    const st = this.st, P = this.u16(B);
    if (st.u8(P + 0x30) & 4) return 1;
    if (P !== this.heroRec) return 0;
    for (const role of [3, 5]) { const n = this.sea.b.roleMember(role); if (n !== 0xff && (st.u8(this.person(n) + 0x30) & 4)) return 1; }
    return 0;
  }
  // d9de 砲擊威力 (AL = 距離 d): 乘除都照原版的 16 / 32 位元寬度
  power(B, d) {
    const st = this.st, S = this.u16(B + 2), P = this.u16(B);
    const a10 = this.bestAbil(B, 0), lv = this.bestLevel(B);
    const v8 = (btIdiv(btS16((this.bestAbil(B, 0) * lv) & 0xffff), 0x64) + (a10 >> 1)) & 0xffff;               // [bp-8]
    const m1 = btUdiv32((this.u8(B + 0x17) * btS16(this.u16(S))) >>> 0, 0x64) & 0xffff;                       // 士氣 × 水手 / 100
    const m = btUmin(this.u8(S + OFF.DOCK_SLOT.GUNS) >> 1, m1 >>> 1);                                                           // [bp-0a]
    const q = btUdiv32((this.u8(B + 0x0f + (d & 0xff)) * m) >>> 0, 0x0a);                                       // 命中率[d] × m / 10
    const r = this.gunSkill(B) ? btUdiv32((q + 0x13) >>> 0, 0x14) : btUdiv32((q + 0x27) >>> 0, 0x28);
    let v = btUdiv32(btMul32(r, v8), 0x64) & 0xffff;
    v = btUdiv32(btMul32(v, (this.rnd(this.bestAbil(B, 5) >> 1) + 0x32) & 0xffff), 0x64) & 0xffff;
    v = btUmin(v, (this.rnd(st.u8(P + 0x25) >> 1) + 0x32) & 0xffff);
    return btUmax(v, 1);
  }
  // e735 損傷: 威力 di; 種類 (bit0 最大耐久、bit1 推進、bit2 轉向) 依威力以亂數表決定 (跳躍表 e782 / e7ea)
  damage(T) {
    const st = this.st, S = this.u16(T + 2), cur = this.u16(0x9bc2);
    const d = this.shipDist(cur, T);
    const di = this.power(cur, d);
    let k = 0;
    if (di >= 0x0a || !this.rnd(5)) k = [1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 3, 3, 5, 5, 6, 6, 7][this.rnd(0x13)];
    if (di >= 0x14) k = [3, 3, 5, 5, 6, 6, 7][this.rnd(7)];
    if (di >= 0x28) k = 7;
    this.set8(S + OFF.DOCK_SLOT.DURABILITY, this.u8(S + OFF.DOCK_SLOT.DURABILITY) - btUmin(this.u8(S + OFF.DOCK_SLOT.DURABILITY), di));
    this.set8(S + OFF.DOCK_SLOT.DURABILITY, btUmin(this.u8(S + OFF.DOCK_SLOT.DURABILITY), this.u8(S + OFF.DOCK_SLOT.MAX_DURABILITY)));
    { const v = (this.rnd(3) + (di >>> 1)) & 0xffff; this.set16(S, this.u16(S) - btUmin(this.u16(S), v)); }
    if (k & 1) {
      const t = st.u8(this.typeRec(st.u8(this.shipRec(this.u8(S + OFF.DOCK_SLOT.SHIP)) + 0x0f)) + 1) >> 2;
      this.set8(S + OFF.DOCK_SLOT.MAX_DURABILITY, btUmax(t, (this.u8(S + OFF.DOCK_SLOT.MAX_DURABILITY) - 1) & 0xffff));        // 4d87 (最大耐久 0 時是 FFFF → 寫入 FF, 照搬)
    }
    if (k & 2) { const v = (this.rnd(3) + (di >>> 1)) & 0xffff; this.set8(S + OFF.DOCK_SLOT.PROPULSION, this.u8(S + OFF.DOCK_SLOT.PROPULSION) - btUmin(this.u8(S + OFF.DOCK_SLOT.PROPULSION), v)); }
    if (k & 4) { const v = (this.rnd(3) + (di >>> 1)) & 0xffff; this.set8(S + OFF.DOCK_SLOT.TURN, this.u8(S + OFF.DOCK_SLOT.TURN) - btUmin(this.u8(S + OFF.DOCK_SLOT.TURN), v)); }
  }
  // 063e 遮罩 (模式 0x20f) + 3d2 圖像 (模式 3), 都在 HDAT 段
  spr(col, y, w, h, mask, img) {
    this.c.scr.glyphMode(col, y, w, h, this.hd.subarray(mask & 0xffff), 0x20f);
    this.putOp(col, y, w, h, 3, this.hd, img & 0xffff);
  }
  restoreUnder() { this.c.win.closeNow(); }                            // c744: 還原 [0c88] 佇列最上層的畫面 (h > 16 且動畫開啟時分段還原, 結果相同)
  // cdcd 砲擊動畫: 兩船任一在視窗內 → c853 砲彈; 目標在視窗內 → 效果音 9768(DS:0bec) + 9804(0x24) (不放鍵), 命中動畫 4 + 4 + 4 格
  async shotAnim(T) {
    const B = this.u16(0x9bc2), [x0, y0] = this.pos(B), [tx, ty] = this.pos(T), { win, sys } = this.c;
    if (this.inView(x0, y0) || this.inView(tx, ty)) await this.trajectory(T);   // c853
    if (!this.inView(tx, ty)) return;
    this.c.sfx?.voice(0x0bec); this.c.sfx?.note(0x24);                // ce57: 9768(DS:0bec) + 9804(0x24)
    const col = ((tx - this.u8(0x9bef)) << 2) & 0xffff, y = ((((ty - this.u8(0x9bf0)) << 5) + (btImod(tx, 2) >= 1 ? 0x10 : 0))) & 0xffff;
    const both = async () => {
      const o = this.rnd(2) ? 0 : 2;
      for (let i = 0; i < 4; i++) {
        win.save(col, y, 4, 0x20);                                      // 50c4
        this.spr(col, y, 4, 0x20, 0x6e40 + 0x280 * i, 0x6ec0 + 0x280 * i);
        this.spr(col + o, y + 0x0c, 2, 0x14, 0x7840 + 0xc8 * i, 0x7868 + 0xc8 * i);
        await sys.waitTicks(8);
        this.restoreUnder();                                            // c744
      }
    };
    await both();
    const r = this.u8(B + 0x15);
    if (r >= 4 && this.shipDist(T, B) === r) {                          // 射程 ≥ 4 且距離 = 射程: 只有小的那一組
      const o = this.rnd(2) ? 0 : 2;
      for (let i = 0; i < 4; i++) {
        win.save(col, y, 4, 0x20);
        this.spr(col + o, y + 0x0c, 2, 0x14, 0x7840 + 0xc8 * i, 0x7868 + 0xc8 * i);
        await sys.waitTicks(8);
        this.restoreUnder();
      }
    } else {
      for (let i = 0; i < 4; i++) {
        win.save(col, y, 4, 0x20);
        this.spr(col, y, 4, 0x20, 0x6e40 + 0x280 * i, 0x6ec0 + 0x280 * i);
        await sys.waitTicks(8);
        this.restoreUnder();
      }
    }
    await both();
  }
  // c853 砲彈軌跡: 主軸每個計時單位走 1 點, 副軸以 32 位元定點拋物線 (0xe100 / d², 0x7080 / d, ×600); 每進入新的 8 × 8 點就存背景 (50c4)、
  //   不在射擊者自己那格內時畫砲彈 (HDAT 7b60 / 7b68, 1 欄 × 8 行), 換格時還原 (c744)
  async trajectory(T) {
    const B = this.u16(0x9bc2), { win, sys } = this.c;
    const [cx, cy] = this.pos(B), [tx, ty] = this.pos(T);
    const X0 = (cx << 5) & 0xffff, Y0 = ((cy << 5) + (btImod(cx, 2) >= 1 ? 0x10 : 0)) & 0xffff;
    const X1 = (tx << 5) & 0xffff, Y1 = ((ty << 5) + (btImod(tx, 2) >= 1 ? 0x10 : 0)) & 0xffff;
    const DX = X0 > X1 ? X0 - X1 : X1 - X0, DY = Y1 >= Y0 ? Y1 - Y0 : Y0 - Y1;
    let drawn = 0, pc, pr;                                              // [bp-2a], [bp-0c], [bp-0e]
    this.c.sfx?.voice(0x0bec); this.c.sfx?.note(0x24);                // c906: 9768(DS:0bec) + 9804(0x24) (不放鍵)
    const body = (x, y) => {
      const c = x >>> 3, r = y >>> 3;
      if (drawn && this.inView(pc >>> 2, pr >>> 2) && (pc !== c || pr !== r)) { this.restoreUnder(); drawn = 0; }
      if (drawn || !this.inView(c >>> 2, r >>> 2) || (pc === c && pr === r)) return;
      const col = (c - (this.u8(0x9bef) << 2) + 1) & 0xffff, yy = (y - (this.u8(0x9bf0) << 5) + 8) & 0xffff;
      win.save(col, yy, 1, 8); drawn = 1;                               // 50c4
      const inSrc = !(x + 8 < X0) && !(x + 8 >= X0 + 0x20) && !(y + 8 < Y0) && Y0 + 0x20 > y + 8;
      if (!inSrc) this.spr(col, yy, 1, 8, 0x7b60, 0x7b68);
      pc = c; pr = r;
    };
    if (DY <= DX) {
      const Bq = btUdiv32(0xe100, (DX * DX) & 0xffff);                 // mul 之後高位元組被清成 0 (照搬)
      let A = btUdiv32(0x7080, DX), acc = btMul32(Y0, 0x258);
      const slope = btS16(btSdiv32(btMul32(Y1 >= Y0 ? 0x258 : -0x258, DY), DX) & 0xffff);
      const step = X0 > X1 ? -1 : 1;
      let x = X0, y = Y0; pc = x >>> 3; pr = y >>> 3;
      for (;;) {
        body(x, y);
        if (x === X1) break;
        A = (A - Bq) >>> 0; acc = (acc + ((slope - A) | 0)) >>> 0;
        y = btUdiv32(acc, 0x258) & 0xffff;
        await sys.waitTicks(1);
        x = (x + step) & 0xffff;
      }
    } else {
      const Bq = btUdiv32(0xe100, (DY * DY) & 0xffff);
      let A = btUdiv32(0x7080, DY), acc = btMul32(0x258, X0);
      const slope = btS16(btSdiv32(btMul32(X0 > X1 ? -0x258 : 0x258, DX), DY) & 0xffff);
      const step = Y0 > Y1 ? -1 : 1;
      let x = X0, y = Y0; pc = x >>> 3; pr = y >>> 3;
      for (;;) {
        body(x, y);
        if (y === Y1) break;
        A = (A - Bq) >>> 0; acc = (acc + ((slope - A) | 0)) >>> 0;
        x = btUdiv32(acc, 0x258) & 0xffff;
        await sys.waitTicks(1);
        y = (y + step) & 0xffff;
      }
    }
    if (drawn && this.inView(pc >>> 2, pr >>> 2)) { await sys.waitTicks(1); this.restoreUnder(); }
  }
  // e616 戰鬥經驗: 1bb9c(P +25 等級, P +28 經驗, n) 的升級次數, 每次 +20 += random(3)、+21 += random(2) (上限 100)
  gainExp(P, n) {
    const st = this.st, c = this.levelUp(P + 0x25, P + 0x28, P, n);
    for (let i = 0; i < c; i++) {
      st.set8(P + 0x20, btUmin(0x64, this.rnd(3) + st.u8(P + 0x20)));
      st.set8(P + 0x21, btUmin(0x64, this.rnd(2) + st.u8(P + 0x21)));
    }
  }
  // 1bb9c 經驗 += g; 足夠時升級 (所需 = min(等級, 18)² × 30 (1bb84), 等級 100 時經驗歸零); 有升級時 P +1c..+1f 各 + min(random(3), 100 − 值)
  levelUp(lvA, expA, P, g) {
    const st = this.st; let n = 0;
    st.set16(expA, st.u16(expA) + g);
    for (;;) {
      const lv = st.u8(lvA), m = Math.min(lv, 0x12), need = btS16((m * m * 0x1e) & 0xffff);
      if (need > btS16(st.u16(expA))) break;
      if (lv === 0x64) { st.set16(expA, 0); break; }
      n++; st.set16(expA, st.u16(expA) - need); st.set8(lvA, lv + 1);
    }
    if (n) for (let i = 0; i < 4; i++) st.set8(P + 0x1c + i, st.u8(P + 0x1c + i) + btUmin(this.rnd(3), (0x64 - st.u8(P + 0x1c + i)) & 0xffff));
    return n;
  }
  // e679 擊沉: 主角艦隊打沉的 → e616(本船船長, 10 × 目標最大耐久); c6fa 擦掉; e5b1; 目標船位 +8 = 0 (船從艦隊消失)
  sink(T) {
    const S = this.u16(T + 2);
    if (this.u16(this.u16(0x9bc0) + 4) === this.heroFleet) this.gainExp(this.u16(this.u16(0x9bc2)), (0x0a * this.u8(S + OFF.DOCK_SLOT.MAX_DURABILITY)) & 0xffff);
    this.erase(T);                                                      // c6fa
    this.untarget(T);                                                   // e5b1
    this.set8(S + OFF.DOCK_SLOT.FLAGS, 0);
  }
  // e6bb 無人船: 地圖格 &= 1f 後 |= 0x80 (變成障礙); 經驗同上; e5b1; c0ad 重畫所有的船
  unmanned(T) {
    const p = this.mapAt(...this.pos(T));
    this.and8(p, 0x1f); this.or8(p, 0x80);
    if (this.u16(this.u16(0x9bc0) + 4) === this.heroFleet) this.gainExp(this.u16(this.u16(0x9bc2)), (0x0a * this.u8(this.u16(T + 2) + 3)) & 0xffff);
    this.untarget(T);
    this.drawShips();
  }
  // ================= e95e 接舷 (RE_NOTES 30.9) =================
  // 目前的船是本方旗艦且目標是主角艦隊的旗艦 (= 電腦方的旗艦接舷主角): random(15) + 船長 +21 ≥ 主角 +21 且 船長 +23 ≥ random(目標水手) → 一騎打 (電腦發起;
  //   前後 [9c2a] = 200 − [9c2a]), 不接舷; 否則 e91f 白刃戰 → d1eb 動畫 → 目標水手 = 0 → e6bb 無人船, 否則目前這方是主角艦隊時 e616(本船船長, 10)
  async board(T) {
    const cur = this.u16(0x9bc2);
    if (this.u16(this.u16(0x9bc0)) === cur) {
      const di = this.enemySide(cur), d2 = (di + 0x10) & 0xffff;
      if ((this.u16(di + 4) === this.heroFleet && this.u16(di) === T) || (this.u16(d2 + 4) === this.heroFleet && this.u16(d2) === T)) {
        const a = (this.rnd(0x0f) + this.abil(cur, 5)) & 0xffff;
        if (a >= this.st.u8(this.heroRec + 0x21)) {
          const r = this.rnd(this.u16(this.u16(T + 2)));
          if (this.abil(cur, 7) >= r) {
            this.set8(0x9c2a, 0xc8 - this.u8(0x9c2a));
            await this.duel(0, T);                                      // 0fea:2d1a(0, T)
            this.set8(0x9c2a, 0xc8 - this.u8(0x9c2a));
            this.c.probe?.("e95e");
            return;
          }
        }
      }
    }
    this.melee(T);                                                      // e91f
    await this.boardAnim(T);                                            // d1eb
    if (!this.u16(this.u16(T + 2))) this.unmanned(T);                    // e6bb
    else if (this.u16(this.u16(0x9bc0) + 4) === this.heroFleet) this.gainExp(this.u16(cur), 0x0a);   // e616
    this.c.probe?.("e95e");                                             // 差分測試的快照點 (原版 ea2e)
  }
  // e91f 白刃戰: 目標水手 −= min(水手, d95e(本船)); 之後 本船水手 −= min(水手, d95e(目標)) (目標的威力以減少後的水手計算)
  melee(T) {
    const S = this.u16(T + 2), cur = this.u16(0x9bc2);
    let p = this.meleePower(cur);
    this.set16(S, this.u16(S) - btUmin(this.u16(S), p));
    const C = this.u16(cur + 2);
    p = this.meleePower(T);
    this.set16(C, this.u16(C) - btUmin(this.u16(C), p));
  }
  // d95e 白刃戰威力: di = (random(10) + 水手) × 士氣 / 100 (32 位元無號); si = random(d427(5) / 2) + 50;
  //   a = 戰力 +16 × di (imul, 有號) / 100; v = (a × si 的低 16 位元) / 100 (mul 之後 dx 被清成 0); max(1, min(50, v))
  meleePower(B) {
    const S = this.u16(B + 2);
    const di = btUdiv32((((this.rnd(0x0a) + this.u16(S)) & 0xffff) * this.u8(B + 0x17)) >>> 0, 0x64) & 0xffff;
    const si = (this.rnd(this.bestAbil(B, 5) >> 1) + 0x32) & 0xffff;
    const a = btUdiv32((this.u8(B + 0x16) * btS16(di)) >>> 0, 0x64) & 0xffff;
    const v = Math.floor(((a * si) & 0xffff) / 0x64);
    return btUmax(btUmin(0x32, v), 1);
  }
  // d1eb 接舷動畫: 兩船都不在視窗內 → 不畫; 否則 效果音 9768(DS:0c02) + 9804(0x30), 目標 → 本船 → 目標 各 8 格
  //   ([0c86] 段 0x2e20 + 0x280 × (0, 1, 2, 3, 1, 3, 0, 2)[i]: 圖像 0x200 bytes、遮罩在其後; 每格 50c4 存背景 → 畫 → 等 2 → c744); 最後 (9888) c05d 重畫兩船
  async boardAnim(T) {
    const cur = this.u16(0x9bc2), { win, sys, gfx } = this.c;
    const [cx, cy] = this.pos(cur), [tx, ty] = this.pos(T);
    if (!this.inView(cx, cy) && !this.inView(tx, ty)) return;
    this.c.sfx?.voice(0x0c02); this.c.sfx?.note(0x30);                // d2ea
    const tab = [0, 1, 2, 3, 1, 3, 0, 2];
    for (let k = 0; k < 3; k++) {
      const [x, y] = k % 2 ? [cx, cy] : [tx, ty];
      if (!this.inView(x, y)) continue;
      const col = ((x - this.u8(0x9bef)) << 2) & 0xffff, yy = ((((y - this.u8(0x9bf0)) << 5) + (btImod(x, 2) >= 1 ? 0x10 : 0))) & 0xffff;
      for (let i = 0; i < 8; i++) {
        win.save(col, yy, 4, 0x20);                                     // 50c4
        const o = (0x280 * tab[i] + 0x2e20) & 0xffff;
        this.c.scr.glyphMode(col, yy, 4, 0x20, gfx.subarray((o + 0x200) & 0xffff), 0x20f);
        this.putOp(col, yy, 4, 0x20, 3, gfx, o);
        await sys.waitTicks(2);
        this.restoreUnder();                                            // c744
      }
    }
    this.c.sfx?.off();                                                  // d3d0: 9888
    this.drawShip(T); this.drawShip(cur);                               // c05d
  }
  async duel(ax, T) { return duelInBattle(this, ax, T); }             // 0fea:2d1a = 12bba (scenes/duel.js)

  // b6f2 停船: c2ee → 0x307 → bca4 是否 → c2ee; 是 → 回傳 1 (本回合結束)
  async cmdStop() {
    this.msgArea(); this.c.message(0x307);
    const r = await this.confirm();
    this.msgArea();
    return r ? 1 : 0;
  }
  // b723 撤離: c2ee → 0x308 → bca4 是否 → c2ee; 是 → e5fc (這艘船離開戰場) 回傳 1
  async cmdRetreat() {
    this.msgArea(); this.c.message(0x308);
    const r = await this.confirm();
    this.msgArea();
    if (!r) return 0;
    this.leaveField(this.u16(0x9bc2));                                  // e5fc
    return 1;
  }
  // bca4 是否: 暫時把文字範圍設成 0..0x4f、游標 (0, 0xc8) 後 0fea:47fc, 再還原
  async confirm() {
    const con = this.c.con, l = con.left, r = con.right, x = con.x, y = con.y;
    con.right = 0x4f; con.left = 0; con.x = 0; con.y = 0xc8;
    const v = await this.c.menu.yesNo();
    con.left = l; con.right = r; con.x = x; con.y = y;
    return v;
  }
  // e5fc: c6fa 從戰場擦掉 (視窗內重畫該格、小地圖色 5、地圖格 &= 1f) → e5b1 對方兩方以它為目標 (+0c bit7、+6) 的船解除 → +0c |= 0x40
  leaveField(B) {
    this.erase(B);                                                      // c6fa
    this.untarget(B);                                                   // e5b1
    this.or8(B + 0x0c, 0x40);
  }
  // e5b1 對方兩方中以 B 為目標 (+0c bit7 且 +6 = B) 的船解除目標
  untarget(B) {
    let E = this.enemySide(B);
    for (let k = 0; k < 2; k++, E += 0x10)
      for (let bx = this.u16(E); bx; bx = this.u16(bx + 8))
        if ((this.u8(bx + 0x0c) & 0x80) && this.u16(bx + 6) === B) { this.set16(bx + 6, 0); this.and8(bx + 0x0c, 0x7f); }
  }
  // c6fa 擦掉一艘船
  erase(B) {
    const [x, y] = this.pos(B);
    if (this.inView(x, y)) this.tile(x, y);                             // c2a4 → c14e
    this.miniDot(x, y, 0x405);                                          // be49(色 5)
    this.and8(this.mapAt(x, y), 0x1f);
  }
  // b751 選單的不可選項 ([a14c]): bit1 攻擊 (沒有可攻擊的敵船: 射程內 d931 或相鄰 d54a = 1)、bit3 信號 (本方沒有其他活著的船)、
  //   bit4 作戰 (其他船都不在視窗內)、bit6 隨身物 (沒有)、bit7 撤離 (不在地圖邊緣的海格)
  enable() {
    let dis = 0;
    const idx = this.u8(0x9bee), p = this.s16(0x9bd0 + 2 * idx), di = btImod(p, 0x34), y = btIdiv(p, 0x34), dir = this.u8(0x9be4 + idx);
    const cur = this.u16(0x9bc2);
    let E = this.enemySide(cur), n = 0;
    for (let k = 0; k < 2; k++, E += 0x10) {
      for (let si = this.u16(E); si; si = this.u16(si + 8)) {
        if (!this.alive(si) || (this.u8(si + 0x0c) & 0x40)) continue;
        const [ex, ey] = this.pos(si);
        if (this.inRange(cur, di, y, ex, ey, dir) || this.dist(di, y, ex, ey) === 1) n++;
      }
    }
    if (!n) dis |= 2;
    let alive = 0, vis = 0;
    for (let si = this.u16(cur + 8); si; si = this.u16(si + 8)) {
      if (!this.alive(si) || (this.u8(si + 0x0c) & 0x40)) continue;
      const [x, yy] = this.pos(si);
      if (this.inView(x, yy)) vis++;
      alive++;
    }
    if (!alive) dis |= 8;
    if (!vis) dis |= 0x10;
    if (!this.sea.commandsObj().itemList()) dis |= 0x40;               // 0fea:32a6
    if (!this.edgeSea(di, y)) dis |= 0x80;                              // 9afb
    this.c.menu.disabled = dis;
  }
  // d62e 對方的第一方: 方為偶數 → 97e8 (方 1), 奇數 → 97e0 (方 0); 再 +0x10 是其援軍
  enemySide(B) { return 0x97e8 - ((this.side(B) & 1) << 3); }
  // d52c 活著: 船位 +0 (水手) ≠ 0、+2 (耐久) ≠ 0、未沉
  alive(B) { const S = this.u16(B + 2); return this.u16(S) !== 0 && this.u8(S + OFF.DOCK_SLOT.DURABILITY) !== 0 && !(this.u8(B + 0x0c) & 0x40); }
  // d931 射程內: 沒有砲 (+0e = 0) → 否; 否則 d808(射程 = +15)
  inRange(B, x, y, tx, ty, dir) { return this.u16(B + 0x0e) ? this.arc(x, y, this.u8(B + 0x15), tx, ty, dir) : 0; }
  // d808 射界: 六角格距離 ≤ 射程且 ≠ 1, 並依方向 % 3 判斷目標在船的側面
  arc(x, y, range, tx, ty, dir) {
    const ay = btImod(x, 2) + y * 2, by = btImod(tx, 2) + ty * 2;
    const dx = tx > x ? tx - x : x - tx;
    const dy = by > ay ? by - ay : ay - by;
    const d = dy < dx ? dx : (((dy + dx) - ((dy + dx) < 0 ? -1 : 0)) >> 1);
    if (d > btS16(range) || d === 1) return 0;
    switch (dir % 3) {
      case 0: return dy <= dx ? 1 : 0;
      case 1: if (dy < dx) return 0; if (x >= tx && by <= ay) return 1; if (tx < x || by < ay) return 0; return 1;
      case 2: if (dy < dx) return 0; if (x >= tx && by >= ay) return 1; if (tx < x || by > ay) return 0; return 1;
    }
    return 0;
  }
  // d54a 六角格距離
  dist(x, y, tx, ty) {
    const ay = btImod(x, 2) + y * 2, by = btImod(tx, 2) + ty * 2;
    const dx = tx > x ? tx - x : x - tx;
    const dy = ay >= by ? ay - by : by - ay;
    let a = dy < dx ? dx : dy;
    a += dx;
    return (a - (a < 0 ? -1 : 0)) >> 1;
  }
  // 9afb 在地圖邊緣 (欄 0 / 0x33、列 0 / 0x2f) 的海格
  edgeSea(x, y) {
    if (x && y && x !== 0x33 && y !== 0x2f) return 0;
    return this.u8(this.mapAt(x, y)) & 0x80 ? 0 : 1;
  }
  // a35e 結束判定: 方 0 / 方 1 的旗艦不活著 → [9bfb] = 4 (主角那方被打敗則 5); 旗艦沉沒 (+0c bit6) 時再 −2
  endCheck() {
    if (this.u8(0x9bfb)) return 0;
    let E = 0x97e0;
    if (this.alive(this.u16(E))) {
      E = 0x97e8;
      if (this.alive(this.u16(E))) return 1;
      this.set8(0x9bfb, this.u16(E + 4) === this.heroFleet ? 5 : 4);
    } else this.set8(0x9bfb, this.u16(E + 4) === this.heroFleet ? 5 : 4);
    if (this.u8(this.u16(E) + 0x0c) & 0x40) this.set8(0x9bfb, this.u8(0x9bfb) - 2);
    return 0;
  }

  // ================= 10bdf 戰後處理 =================
  // 10bdf(AX = fcf9 的回傳值 si, DL = 對方指揮者) (RE_NOTES 30.12)
  async after(si, other) {
    const st = this.st, b = this.sea.b;
    let E = 0x97e0, k = 0;
    for (; k < 4; k++, E += 8) if (this.u16(E + 4) === this.heroFleet) break;
    if (k < 4) for (let B = this.u16(E); B; B = this.u16(B + 8)) st.set16(this.crew(this.heroSlotIndex(B)) + 6, this.u16(B + 0x0e));   // eb9e → 船員配置 +6 = 剩餘砲彈
    const r = this.u8(0x9bfb);
    if (r !== 5 && r !== 7) {
      for (let i = 0; i < 10; i++) {
        const M = this.crew(i);
        if (st.u8(M + OFF.CREW_SLOT.CAPTAIN) >= 0x78) continue;
        if ((st.u8(this.slot(i) + 8) & 0x30) !== 0x10) { b.removeShip(i); continue; }          // 5deb (被擊沉的船)
        if (!(r & 1)) this.gainExp(this.person(st.u8(M + OFF.CREW_SLOT.CAPTAIN)), btIdiv(btS16(si), 5) & 0xffff);  // e616(船長, si / 5)
      }
    }
    await this.result(other);                                           // 10679
    if (this.c.palette.ending) return;                                  // [03ea] ≠ 0: 主角戰敗
    await this.repute();                                                // 10984
    const f = st.u8(this.person(other) + 0x2c);
    for (let k = 0; k < 4; k++) {
      const E = 0x97e0 + 8 * k, B = this.u16(E);
      this.set16(0x9bc2, B);
      if (!B) continue;
      const F = this.u16(E + 4);
      this.sea.ai.strength(F);                                          // 18299
      if (F === this.heroFleet) continue;
      const S = this.u16(B + 2);
      if ((this.u8(S + OFF.DOCK_SLOT.FLAGS) & 0x30) === 0x10 && (this.u8(this.u16(B) + 0x31) & 0x20) && this.u16(S) && this.u8(S + OFF.DOCK_SLOT.DURABILITY) && this.u8(0x9bfb) !== 6) continue;
      this.dissolve(this.u8(F + OFF.FLEET.ADMIRAL));                                 // ff62
    }
    if (!this.c.noEvents) {                                             // 2e09:5525(0xa2, [0de0]) 共用 / 2e09:5678(0xa2, [0d56]) 主角
      const sc = (this.c.events ??= new Scenario(this.c)); sc.scene = this.sea;
      if (await sc.check(ENV_COMMON, 0xa2, st.u16(0x0de0) & 0xff)) await sc.run(ENV_COMMON);
      if (await sc.check(ENV_HERO, 0xa2, st.u16(0x0d56) & 0xff)) await sc.run(ENV_HERO);
    }
    if (st.u16(0x0de6) || st.u16(0x0d5c)) return;
    const r2 = this.u8(0x9bfb);
    if (r2 !== 2 && r2 !== 4 && r2 !== 6) return;
    const s1 = r2 !== 2, h = f % 10;
    await this.talkWin(1, this.person(other));                          // 10642(1): 劇本視窗 1 + 對方頭像
    this.c.message(Math.floor(f / 10) === 6 ? (s1 ? 0x33e : 0x342) : h && h < 5 ? (s1 ? 0x340 : 0x344) : (s1 ? 0x33f : 0x343));
    await this.c.menu.waitPrompt();                                     // 147ab
    await this.closeAllWin();                                           // 2e09:3d2b
  }
  // 國名 DS:08de (7 項)
  get nations() {
    return (this.sea.nationNames ??= this.sea.P.data.nations.map(h => { const v = btHex(h), o = new Uint8Array(v.length + 1); o.set(v); return o; }));
  }
  async scWin(n) { const sc = (this.c.events ??= new Scenario(this.c)); await sc.init(); await sc.op_win_open({ win: n }); return sc; }   // 2e09:3c76
  // 10679 結果訊息 (跳躍表 106c0 以 [9bfb] 分支)
  async result(other) {
    const st = this.st, { message, menu, bgm, graph, win, rt, palette } = this.c, b = this.sea.b, H = this.heroRec;
    const r = this.u8(0x9bfb);
    if (r === 8) return;
    let si = 3, loot = 0;
    const P = this.person(other), f = st.u8(P + 0x2c), F = this.fleetOf(f);
    const say = async (n, ...a) => { message(n, ...a); await menu.waitPrompt(); await b.closeTalk(); };   // 訊息 → 147ab → 796d
    const big = () => win.shadowedSaved(7, 0xb0, 0x26, 0x90, 0);       // 10657
    const small = () => win.shadowedSaved(0x0a, 0xb0, 0x1e, 0x60, 0);  // 10620
    const pic = n => graph.draw(n, 0x78, 0x20);                         // 1060a = 5b5d
    const Y = (rt.year & 0xff) + 0x5dd, Mo = (rt.month & 0xff) + 1, D = (rt.day & 0xff) + 1;
    switch (r) {
      case 0: case 2: case 4: case 6: {
        marketTradeLog(st, rt, 2, f, 0, 0, 0);                          // 1e285 交易記錄 種類 2 (海戰)
        loot = r !== 2 ? 1 : 0;
        if (loot) {
          bgm.playSong(0x15);                                           // 9670(0x15) + 96eb(0): 勝利短曲只播一次
          pic(0x35); big();
          await say(0x341, st.cstr(H), st.cstr(H + 0x0d), this.nations[Math.floor(f / 10)], Y, Mo, D);
          bgm.playSong(0x11);
          si = 3;
        } else { pic(0x36); small(); await say(0x235); si = 1; }
        if ((st.u8(H + 0x31) & 0x0f) === 6) si *= 3;
        else { const c = this.classify(); if (c === 2) si <<= 1; else if (c === 3) si *= 3; else if (c === 4) si <<= 2; }
        const A = b.heroData, lv = st.u8(P + 0x25);
        const v = ((((btUmin(lv, 0x1e) * btUmin(lv, 0x0f)) & 0xffff) * si) + 0xc8) & 0xffff;
        st.set16(A + 2, btUmin(0xc350, (st.u16(A + 2) + v) & 0xffff));
        break;
      }
      case 1:
        marketTradeLog(st, rt, 2, f, 0, 0, 1); pic(0x37); small(); await say(0x233);
        break;
      case 3: case 9:
        if (r === 9 && !(st.u8(F + OFF.FLEET.FLAGS) & 0x40) && st.u8(F + OFF.FLEET.MISSION) !== 7) this.sea.ai.goPort(0, st.u8(F + OFF.FLEET.HOME_PORT), F);   // 2e09:5891 回母港
        marketTradeLog(st, rt, 2, f, 0, 0, 2); pic(0x36); small(); await say(r === 3 ? 0x234 : 0x236);
        for (let i = 0; i < 10; i++) {
          if ((st.u8(this.slot(i) + 8) & 0x30) !== 0x10) continue;
          const C = this.person(st.u8(this.crew(i) + 0x1b));
          if (C === H || st.u8(C + 0x2b) >= 0x28) continue;
          b.crewSpeaks(); await say(0x317, st.cstr(C + 0x0d));          // 909b
          this.leave(i);                                                // eb3f
        }
        break;
      case 5: case 7:
        bgm.playSong(0x14); pic(0x38); big();
        await say(0x3f9, Y, Mo, D, st.cstr(H), st.cstr(H + 0x0d), st.cstr(H), st.cstr(H + 0x0d));
        await this.fadeOutField();                                      // bd26
        palette.ending = 0x1a;                                          // [03ea] = 0x1a → 1764f (clock.js ending)
        break;
    }
    if (loot) await this.loot();                                        // 10513
  }
  // fea0 戰鬥的分類: 主角有本國的私掠許可證 (隨身物 = 國籍 + 0x1d) 時 1..6, 否則 0
  classify() {
    const st = this.st, hn = st.u8(this.heroRec + 0x31) & 0x0f, hero = st.u8(DS.HERO);
    let r = 0;
    for (let i = 0; i < 0x14; i++) if (((hn - st.u8(DS.INVENTORY + i)) & 0xff) === 0xe3) r = 1;
    const on = Math.floor(st.u8(this.person(this.u8(0x97e6) === hero ? this.u8(0x97ee) : this.u8(0x97e6)) + 0x2c) / 10);
    const NH = DS.TBL_COUNTRY + (hn << 5), NO = DS.TBL_COUNTRY + (on << 5);             // 5bde
    if (r) {
      if (st.u8(NH + 0x0b + on) <= 0x28) r = 2;
      if (st.u8(NO + 0x12 + hn) & 0x10) r = 3;
      if (st.u8(NH + 2) === on) r = 4;
      if (st.u8(NH + 0x0b + on) >= 0x3c) r = 5;
      if (st.u8(NH + 0x12 + on) & 0x20) r = 6;
    }
    return r;
  }
  // 10513 戰利品: 金額 (艦隊 +24 + 1) × 100、對方艦隊 +1d 的道具 → 10138
  async loot() {
    const st = this.st, { message, menu, win } = this.c, b = this.sea.b;
    let E = 0;
    if (this.u16(0x97e4) === this.heroFleet) E = 0x97e8;
    if (this.u16(0x97ec) === this.heroFleet) E = 0x97e0;
    if (!E) return;
    let item = 0xff;
    const F = this.u16(E + 4);
    if (!(this.u8(this.u16(E) + 0x0d) & 0x80)) {
      const L = []; for (let i = 0; i < 0x14; i++) if (st.u8(DS.INVENTORY + i) !== 0xff) L.push(st.u8(DS.INVENTORY + i));
      b.setPersons(L);                                                  // 13146 → [0538]
      if (L.length < 0x14) item = st.u8(F + 0x1d);
    }
    const money = (((st.u16(F + OFF.FLEET.FUNDS) + 1) & 0xffff) * 100) >>> 0;
    win.shadowedSaved(0x14, 0x80, 0x1e, 0x60, 0);                       // 7849
    message(0x230, money);
    if (item !== 0xff) {
      message(0x231, st.cstr(DS.TBL_ITEM + 0x14 * item));                    // 5cde
      for (let i = 0; i < 0x14; i++) if (st.u8(DS.INVENTORY + i) === 0xff) { st.set8(DS.INVENTORY + i, item); break; }
    }
    message(0x232);
    b.money = (b.money + money) | 0;
    await menu.waitPrompt(); await b.closeTalk();
    await this.capture(E);                                              // 10138
  }
  // 10138 剩餘貨物與掳獲 (E = 對方那一方)
  async capture(E) {
    const st = this.st, { message, menu, palette, scr, win } = this.c, b = this.sea.b;
    const list = new Array(10).fill(0); let n = 0, t = 0;
    for (let B = this.u16(E); B; B = this.u16(B + 8)) {
      if (!this.u8(this.u16(B + 2) + 2)) continue;                      // 耐久 0 (擊沉)
      const [x, y] = this.pos(B);
      if (this.inView(x, y)) list[n++] = B;                             // be86
      t++;
    }
    if (!n) return;
    let cap = 0; for (let i = 0; i < n; i++) cap = (cap + this.u16(this.shipRec(this.u8(this.u16(list[i] + 2) + 7)) + 0x14)) & 0xffff;
    const f = st.u8(this.person(this.u8(E + 6)) + 0x2c), F = this.u16(E + 4);
    const g16 = () => btS16(st.u16(F + OFF.FLEET.CARGO_AMT));
    if (st.u8(F + OFF.FLEET.CARGO_GOOD) !== 0xff) st.set16(F + OFF.FLEET.CARGO_AMT, btSdiv32(Math.imul(g16(), n), t) & 0xffff);   // 3722
    else if (this.rnd(2) && f % 10 && f % 10 < 5) {
      st.set16(F + OFF.FLEET.CARGO_AMT, cap);
      if (this.rnd(10)) st.set8(F + OFF.FLEET.CARGO_GOOD, this.rnd(6) + 10);
      else { st.set8(F + OFF.FLEET.CARGO_GOOD, this.rnd(7) + 0x1a); st.set16(F + OFF.FLEET.CARGO_AMT, btIdiv(g16(), 4) & 0xffff); }
      st.set16(F + OFF.FLEET.CARGO_AMT, btIdiv(g16(), 5) & 0xffff);
    } else st.set16(F + OFF.FLEET.CARGO_AMT, 0);
    const g = btIdiv(g16(), n) & 0xffff;
    const types = [0x80, 0x81, 0x82, 0x83, st.u8(F + OFF.FLEET.CARGO_GOOD), 0xff, 0xff, 0xff, 0xff], amt = new Array(9).fill(0);
    for (let i = 0; i < n; i++) {
      const B = list[i], sh = this.u16(B + 0x0e);
      const d = (this.u16(this.shipRec(this.u8(this.u16(B + 2) + 7)) + 0x14) - sh - g) & 0xffff;
      const pct = k => Math.floor(((k * d) & 0xffff) / 100);           // mul 後 sub dx,dx: 只取低 16 位元
      amt[0] = (amt[0] + pct(this.rnd(5) + 0x1e)) & 0xffff;
      amt[1] = (amt[1] + pct(this.rnd(5) + 0x1e)) & 0xffff;
      amt[2] = (amt[2] + pct(this.rnd(2) + 2)) & 0xffff;
      amt[3] = (amt[3] + sh) & 0xffff;
      amt[4] = (amt[4] + g) & 0xffff;
    }
    let has = 0; for (let k = 0; k < 9; k++) { if (!amt[k]) types[k] = 0xff; else has = 1; }
    const fs = b.fleetShips();                                          // 12c8a
    let left = btUmin(0x0a - fs, btUmin(b.crewList(), n)) & 0xff;      // 12de3
    const slots = new Array(10).fill(0), P = this.c.persons;
    while (left) {
      await this.scWin(0);
      message(0x22e, n, left);
      b.crewList(); const capt = P[0] & 0xff;                           // 12de3: 第一位人選
      let j = 0;
      for (let i = 0; i < n; i++) {
        if (!list[i]) continue;
        const B = list[i]; list[i] = 0; list[j] = B; slots[j] = this.u16(B + 2); P[j] = this.u8(slots[j] + 7); j++;
      }
      let sel, ok = 1;
      for (;;) {
        sel = await b.listSel().select(0x0e, j);                        // 15a70 清單種類 0x0e (船記錄名)
        await b.closeTalk();                                            // 796d
        if (sel === -1) { ok = 0; break; }
        const ship = P[sel] & 0xff;
        if (!palette.invert) palette.stopCycle();                       // 1743
        palette.setTarget(palette.table("ships")); await palette.fadeToTarget();   // 98fe(a730), 99e8
        win.save(0x0c, 0x80, 0x30, 0xb0);                               // 50c4
        scr.fillCols(0x0c, 0x80, 0x30, 0xb0, 8); scr.fillCols(0x0d, 0x88, 0x2e, 0xa0, 0x0f);   // 0906
        b.shipData(ship, 3, slots[sel]);                                // 1fd9:b1a0 = 2af30 (模式 3, 船位位址)
        const yes = await menu.yesNo();                                 // 1469c
        await b.closeTalk();                                            // 796d
        await this.fadeIn();                                            // bcfa
        if (yes) break;
      }
      if (ok) { await this.captureShip(slots[sel], capt); list[sel] = 0; left = (left - 1) & 0xff; continue; }   // ffc1
      await this.scWin(0); message(0x22f);
      if (await menu.yesNo()) break;
    }
    await this.closeAllWin();                                           // 2e09:3d2b
    if (has) { b.fleetTable(); await b.distribute(types, amt); }        // 1e628 / 1fcf7
  }
  // ffc1 掳獲 S (對方船位) → 主角艦隊第一個空船位 / 第一個空船記錄; 新船長 capt
  async captureShip(S, capt) {
    const b = this.sea.b, R = this.shipRec(this.u8(S + OFF.DOCK_SLOT.SHIP));
    let i = 0; for (; i < 10; i++) { const v = this.u8(this.slot(i) + 8) & 0x30; if (v !== 0x10 && v !== 0x20) break; }
    const D = this.slot(i), M = i < 10 ? this.crew(i) : 0;              // 10 個都滿時原版寫到 DS:0 一帶
    let n = 0, N = this.shipRec(0);
    for (let k = 0; k < 0x28; k++, N = (N + 0x16) & 0xffff) if (this.u8(N + 0x0f) === 0xff) { n = k; break; }
    for (const o of [3, 2, 4, 5, 6]) this.set8(D + o, this.u8(S + o));
    this.set16(D, btUmin(btIdiv(btS16(this.u16(S)), 10) & 0xffff, this.u16(R + 0x12)));
    this.set8(D + 7, n); this.set8(D + 8, this.u8(S + OFF.DOCK_SLOT.FLAGS));
    for (const o of [0x11, 0x0f, 0x10]) this.set8(N + o, this.u8(R + o));
    this.set16(N + 0x12, this.u16(R + 0x12)); this.set16(N + 0x14, this.u16(R + 0x14));
    for (const o of [0, 2, 4, 6]) this.set16(M + o, 0);
    this.set8(M + OFF.CREW_SLOT.NAV_RATIO, 0x19); this.set8(M + OFF.CREW_SLOT.LOOK_RATIO, 0x32); this.set8(M + OFF.CREW_SLOT.CAPTAIN, capt); this.set8(M + OFF.CREW_SLOT.MORALE, 0x3c);
    this.set8(this.person(capt) + 0x2e, 2);
    this.set16(M + OFF.CREW_SLOT.LOAD_TOTAL, 0);
    for (let k = 0; k < 5; k++) { this.set8(M + OFF.CREW_SLOT.CARGO_GOODS + k, 0xff); this.set16(M + OFF.CREW_SLOT.CARGO_AMTS + 2 * k, 0); }
    await this.scWin(0); this.c.message(0x22d);
    const ni = b.nameInput();
    for (;;) { ni.prompt(2, 7); if ((await ni.run(N, 7)) === 1) break; await b.closeTalk(); }   // 2e09:29a0 / 26a5
    await b.closeTalk();
  }
  // 10984 聲望 ([9bfb] 為奇數時不做)
  async repute() {
    const st = this.st, { message, menu, win } = this.c, b = this.sea.b;
    if (this.u8(0x9bfb) & 1) return;
    const hero = st.u8(DS.HERO), H = this.heroRec;
    const O = this.person(this.u8(0x97e6) === hero ? this.u8(0x97ee) : this.u8(0x97e6));
    const hn = st.u8(H + 0x31) & 0x0f, on = Math.floor(st.u8(O + 0x2c) / 10);
    const NH = DS.TBL_COUNTRY + (hn << 5), NO = DS.TBL_COUNTRY + (on << 5);
    const x = btUmin(this.rnd(5) + 3, st.u8(NH + 0x0b + on));
    st.set8(NH + 0x0b + on, st.u8(NH + 0x0b + on) - x);
    st.set8(NO + 0x0b + hn, st.u8(NH + 0x0b + on));
    const D = b.heroData, A = D + 6;                                    // 5be8: +6.. 各國聲望
    let s, w;
    switch (this.classify()) {
      case 2: s = 2; w = 0x0a; break;
      case 3: s = 3; w = 6; break;
      case 4: s = 4; w = 3; break;
      case 5: s = -1; w = 0x5a; break;
      case 6: s = -1; w = 0x3c; break;
      default: s = 1; w = 0x1e;
    }
    if (on !== 6) {
      const v = Math.floor((((this.rnd(5) + 0x0a) * w) & 0xffff) / 0x1e);
      st.set8(A + on, st.u8(A + on) - btUmin(v, st.u8(A + on)));
    }
    if (hn === 6) return;
    if (on !== hn) {
      if (s >= 0) st.set8(A + hn, btUmin(0xc8, ((((this.rnd(5) + 5) * s) & 0xffff) + st.u8(A + hn)) & 0xffff));
      else { const v = ((this.rnd(5) + 5) * -s) & 0xffff; st.set8(A + hn, st.u8(A + hn) - btUmin(v, st.u8(A + hn))); }
      return;
    }
    st.set8(A + hn, st.u8(A + hn) - btUmin(this.rnd(5) + 0x0a, st.u8(A + hn)));
    if (st.u8(A + hn) <= 0x28) {
      win.shadowedSaved(0x14, 0x80, 0x1e, 0x60, 0); message(0x238); await menu.waitPrompt(); await b.closeTalk();
      st.set8(D + 0x0d, 0); st.set8(H + 0x31, (st.u8(H + 0x31) & 0xf0) | 6);   // 變成海盜
    } else if (st.u8(D + 0x0d) && st.u8(A + hn) <= 0x46) {
      win.shadowedSaved(0x14, 0x80, 0x1e, 0x60, 0); message(0x239); await menu.waitPrompt(); await b.closeTalk();
      st.set8(D + 0x0d, 0);
    } else return;
    st.set8(DS.COMMON_SEC, 0); st.set8(DS.COMMON_CHAP, 0); st.set8(WorkDS.FLAGS, st.u8(WorkDS.FLAGS) & 0xf8);
  }
  // ff62 解散指揮者 p 的艦隊
  dissolve(p) {
    const st = this.st, P = this.person(p), F = this.fleetOf(st.u8(P + 0x2c));
    st.set8(F + OFF.FLEET.STRENGTH, 0); st.set8(F + OFF.FLEET.FLAGS, st.u8(F + OFF.FLEET.FLAGS) & 0xfe); st.set8(F + OFF.FLEET.ADMIRAL, 0xff);
    st.set8(P + 0x2e, 0); st.set8(P + 0x2c, 0xff); st.set8(P + 0x2d, this.rnd(0x2a));
    if (st.u8(P + 0x1b) & 0xc0) st.set8(P + 0x31, st.u8(P + 0x31) & 0xdf);
    for (let i = 0; i < 10; i++) st.set8(F + OFF.FLEET.SHIPS + 9 * i + 8, 0);
  }
  // bd26: [03ea] = 0 且未反色 → 停止調色盤循環 (1743); 淡出 (99f2)
  async fadeOutField() {
    const { palette } = this.c;
    if (!palette.ending && !palette.invert) palette.stopCycle();
    await palette.fadeBlack();
  }
  // ff5c = 84de: 把 DS:09e4 的檔案第 0xb 項重新解壓到 [03ee] (被 HDAT.PUT 蓋掉的緩衝; 移植版各資源各自保存, 不需要)
  // 19ba1: 主角艦隊在的船各呼叫一次 5d8b (只計算, 不寫回) → 0000:851f 回到海上畫面
  async backToSea() {
    await this.fadeOutField();                                          // bd26
    if (this.c.palette.ending) return;
    await this.sea.enterSea();
  }
}
