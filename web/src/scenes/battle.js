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
// 尚未移植 (主控台警告): 電腦行動 a3ce、玩家指令中的 移動 / 攻擊 / 信號 / 作戰 / 情報、戰後處理 10bdf、一騎打 12998
import { Scenario, ENV_COMMON, ENV_HERO } from "../game/scenario.js";

const btHex = s => Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16)));
const btS16 = v => (v << 16) >> 16;
const btS8 = v => (v << 24) >> 24;
const btIdiv = (a, b) => Math.trunc(a / b);                       // 有號除法 (向零取整)
const btImod = (a, b) => a - Math.trunc(a / b) * b;               // 有號餘數 (與被除數同號)
const btUmin = (a, b) => ((a & 0xffff) > (b & 0xffff) ? b & 0xffff : a & 0xffff);   // seg0:4d7c
const btWarned = new Set();
const btTodo = n => { if (!btWarned.has(n)) { btWarned.add(n); console.warn("尚未移植: " + n); } };

export class NavalBattle {
  constructor(sea) {
    this.sea = sea; this.c = sea.c;
    const J = sea.P.battle;                                               // assets/data/battle.json (tools/extract_battle.py)
    this.J = J; this.hd = sea.P.hdat;                                     // HDAT.PUT = [03ee]:0
    this.coast = new Map(Object.entries(J.coast).map(([k, v]) => [+k, v]));
    if (!this.c.battleDS) {                                               // DS 工作區: MAIN.EXE 的初值
      const W = new Uint8Array(0x10000), d = btHex(J.ds["9bfe"]); W.set(d, 0x9bfe); this.c.battleDS = W;
    }
    this.W = this.c.battleDS;
  }
  get st() { return this.c.state; }
  // ---- DS 存取: 存檔區走 GameState, 其他走 W ----
  u8(a) { a &= 0xffff; return a >= 0x0ca4 && a < 0x8d18 ? this.st.u8(a) : this.W[a]; }
  u16(a) { return this.u8(a) | (this.u8(a + 1) << 8); }
  s16(a) { return btS16(this.u16(a)); }
  set8(a, v) { a &= 0xffff; if (a >= 0x0ca4 && a < 0x8d18) this.st.set8(a, v); else this.W[a] = v & 0xff; }
  set16(a, v) { this.set8(a, v & 0xff); this.set8(a + 1, (v >> 8) & 0xff); }
  or8(a, v) { this.set8(a, this.u8(a) | v); }
  and8(a, v) { this.set8(a, this.u8(a) & v); }
  ds(a) { const W = this.W; let e = a; while (W[e]) e++; return W.subarray(a, e + 1); }   // DS 上的 C 字串 (含結尾 0)
  cstr(a) { return a >= 0x0ca4 && a < 0x8d18 ? this.st.cstr(a) : this.ds(a); }
  rnd(n) { n &= 0xffff; return n ? this.c.sys.rng.random(n) & 0xffff : 0; }                // seg0:4dc4 (n = 0 時不取亂數)
  // ---- 記錄位址 (seg0) ----
  person(n) { return (0x12b6 + 0x32 * (n & 0xff)) & 0xffff; }                             // 5bf8
  fleetOf(n) { return (0x2e76 + 0x85 * (n & 0xff)) & 0xffff; }                             // 5c28 (AL × 0x85, 8 位元乘法)
  crew(i) { return (0x52d4 + 0x1e * (i & 0xff)) & 0xffff; }                                // 5c38
  slot(i) { return this.sea.slotOf(i & 0xff); }                                            // 5c58
  shipRec(n) { return (0x5892 + 0x16 * (n & 0xff)) & 0xffff; }                             // 5c7a
  typeRec(t) { return (0x5e28 + 0x0c * (t & 0xff)) & 0xffff; }                             // 5c8a
  get heroRec() { return this.person(this.st.u8(0x12b5)); }                                 // [c2ce]
  get heroFleet() { return this.sea.fleet; }                                                // [c2d4]
  pos(B) { const p = this.s16(B + 4); return [btImod(p, 0x34), btIdiv(p, 0x34)]; }       // 位置 → (欄, 列)
  mapAt(x, y) { return (0x8e14 + y * 0x34 + x) & 0xffff; }

  // ================= 10f7e 海戰 =================
  async run(al, dl, bl, arg) {
    const st = this.st, hero = st.u8(0x12b5);
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
    // bd26 / ff5c / 19ba1 / 851f
    if (!this.c.palette.ending) await this.backToSea();
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
    const st = this.st, hero = st.u8(0x12b5);
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
        this.set16(w, this.u16(w) + this.st.u8(F + 0x28));
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
    for (let i = 0; i < 10; i++) { const S = (F + 0x2b + 9 * i) & 0xffff; if ((st.u8(S + 8) & 0x30) === 0x10) sum += st.u8(S + 2); }
    st.set8(F + 0x28, Math.trunc((sum + 4) / 5));
    if (!sum) st.set8(F + 0x29, st.u8(F + 0x29) & 0xfe);
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
    let S = (F + 0x2b) & 0xffff, si = 0x9800 + ((0xf0 * k) & 0xffff), first = 1, cnt = 0;
    const mine = (A && !(k & 1)) || (!A && (k & 1));
    const fl = mine ? (F === hf ? 0x80 : 0xc0) : k >= 2 ? 0x40 : 0;
    for (let i = 0; i < 10; i++, si += 0x18, S = (S + 9) & 0xffff) {
      if ((st.u8(S + 8) & 0x30) === 0x10) {
        const cap = F === hf ? st.u8(this.crew(i) + 0x1b) : this.u8(E + 6);
        this.set8(si + 0x0d, ((k << 4) | fl | i) & 0xff);
        this.set16(si, this.person(cap)); this.set16(si + 2, S); this.set16(si + 4, 0); this.set16(si + 6, 0); this.set16(si + 8, 0);
        this.set8(si + 0x0a, 0); this.set8(si + 0x0b, 0);
        let mo;
        // 主角艦隊: 100 − 船員 +8 − 船員 +9; 原版第二次呼叫 5c38 時 AL 還是 +9 的值, 所以 +8 取的是「船員 (+9 的值)」的 (照搬)
        if (F === hf) { const v9 = st.u8(this.crew(i) + 9); mo = (100 - st.u8(this.crew(v9) + 8) - v9) & 0xff; }
        else mo = st.u8(this.shipRec(this.u8(S + 7)) + 0x10) & 0x10 ? 0x19 : 0x32;
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
      if (!S || (st.u8(S + 8) & 0x30) !== 0x10) continue;
      list.push(i);
      if (this.u16(E + 4) === this.heroFleet) { if (st.u8(this.crew(i) + 0x1b) === st.u8(0x12b5)) flag = i; }
      else if (st.u8(S + 3) > best) { flag = i; best = st.u8(S + 3); }
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
      let gx = this.s16(F) - x0 + 2; const cy = this.s16(F + 2) - y0 + 2;
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
      if (this.u16(E + 4) !== this.heroFleet) continue;
      const [x, y] = this.pos(this.u16(E));
      this.set8(0x9bf0, 0); this.set8(0x9bef, 0);
      if (x > 6) { this.set8(0x9bef, x - 6); if (this.u8(0x9bef) > 0x27) this.set8(0x9bef, 0x27); }
      if (y > 6) { this.set8(0x9bf0, y - 6); if (this.u8(0x9bf0) > 0x24) this.set8(0x9bf0, 0x24); }
    }
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
    return this.u8(0x97e6) === this.st.u8(0x12b5) ? this.parleyHero(arg) : this.parleyEnemy();
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
    const st = this.st, { message, menu, sys } = this.c, b = this.sea.b, nations = this.sea.nations;
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
          const v = btIdiv(btS16(st.u16(M + 0x0c + 2 * k)) * keep, 3);
          st.set16(M + 0x0c + 2 * k, v);
          if (!(v & 0xffff)) st.set8(M + 0x16 + k, 0xff);
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
    const st = this.st, M = this.crew(i), cap = st.u8(M + 0x1b), P = this.person(cap);
    for (let k = 0; k < 0x1e; k++) if (st.u8(0x2e1b + k) === cap) st.set8(0x2e1b + k, 0xff);
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
    if (this.u8(S + 2) && this.u16(S) && !(this.u8(B + 0x0c) & 0x40)) {
      const E = this.u16(0x9bc0);
      if (this.u16(E + 4) === this.heroFleet && this.u16(E) === B) si = await this.playerTurn();   // b8b1
      else si = await this.cpuTurn();                                                               // a3ce
    }
    this.set16(this.u16(0x9bc0) + 2, this.u16(this.u16(0x9bc2) + 8));
    this.status();                                                      // c327
    await this.c.sys.waitTicks(8);                                      // 5998(8)
    return si;
  }
  // a3ce 電腦行動 — 尚未移植
  async cpuTurn() { btTodo("海戰 電腦行動 (a3ce)"); return 1; }

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
      case 0: btTodo("海戰 指令 移動 (ad20)"); return 0;
      case 1: btTodo("海戰 指令 攻擊 (ad38)"); return 0;
      case 2: btTodo("海戰 指令 情報 (b258)"); return 0;
      case 3: btTodo("海戰 指令 信號 (b30f)"); return 0;
      case 4: btTodo("海戰 指令 作戰 (b6db)"); return 0;
      case 5: btTodo("海戰 指令 停船 (b6f2)"); return 0;
      case 6: btTodo("海戰 指令 隨身物 (b71b)"); return 0;
      case 7: btTodo("海戰 指令 撤離 (b723)"); return 0;
    }
    return 0;
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
  alive(B) { const S = this.u16(B + 2); return this.u16(S) !== 0 && this.u8(S + 2) !== 0 && !(this.u8(B + 0x0c) & 0x40); }
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
  async after(si, other) { btTodo("海戰 戰後處理 (10bdf)"); }
  // bd26 / ff5c (84de) / 19ba1 / 0000:851f 回到海上畫面
  async backToSea() { btTodo("海戰結束後回到海上 (bd26 / ff5c / 19ba1 / 851f)"); }
}
