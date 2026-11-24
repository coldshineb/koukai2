// palace.js — 王宮 (MAIN.EXE 1fd9:acda = 線性 2aa6a, 處理函式表 DS:a612[5]); 見 RE_NOTES 25
// MENU #16 共 5 項, 但原版只傳 4 項 (bl = 4) 給選單, 所以「密會」不會出現 (DS:b258 也只有 4 個處理函式 2a523 / 2a5f6 / 2a713 / 2a79b)
// 國王記錄 [bdbc] = seg0:5c08(港口所屬國 + 10) (+0 名稱, +12 頭像); 國家記錄 seg0:5bde = 0x117a + 0x20×n
//   (+0 收益, +2 爵位上限?/關係, +4 首都, +5 資金援助 (千枚), +7 援助船型, +8 援助船數, +0b.. 對各國友好, +12.. 同盟/封鎖)
// 主角資料 seg0:5be8 = 0x125a + 0x0e×主角 (+0/+2/+4 商人/海盜/冒險家名聲, +6+國 對各國聲望, +0d 爵位)
import { Scenario, ENV_COMMON, ENV_HERO } from "../game/scenario.js";
import { mainEnding } from "../game/endgame.js";
const plHex = s => { const b = Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16))), o = new Uint8Array(b.length + 1); o.set(b); return o; };
const plS16 = v => (v << 16) >> 16;
const plUmin = (a, b) => ((a & 0xffff) > (b & 0xffff) ? b & 0xffff : a & 0xffff);   // seg0:4d7c
const plUmax = (a, b) => ((b & 0xffff) >= (a & 0xffff) ? b & 0xffff : a & 0xffff);  // seg0:4d87
const plWarned = new Set();
const plTodo = n => { if (!plWarned.has(n)) { plWarned.add(n); console.warn("尚未移植: " + n); } };

export class Palace {
  constructor(b) {
    this.b = b; const D = b.p.P.data.bld2;
    this.F = Object.fromEntries(Object.entries(D.fmt).map(([k, v]) => [k, plHex(v)]));
    this.div = D.regionDiv;
  }
  get c() { return this.b.c; }
  get st() { return this.b.st; }
  get money() { return this.b.money; } set money(v) { this.b.money = v; }
  get P() { return 0x5f54 + this.b.port * 0x16; }                                // seg0:5c9a 本港
  get nation() { return this.st.u8(this.P + 0x15) & 7; }
  same(mask = 0x0f) { return ((this.nation ^ this.st.u8(this.b.hero + 0x31)) & mask) === 0; }   // 港口所屬國 = 主角國籍
  nationRec(n) { return 0x117a + (n & 0xff) * 0x20; }
  get HD() { return this.b.heroData; }
  heroName() { return this.b.dstr(this.b.hero + 0x0d); }
  async gw(n, ...a) { this.b.greet(n, ...a); await this.b.wait(); }
  // seg0:7e60 國王視窗 (不保存背景): 頭像於 (0x0e, 0x12c), 「〔名〕」於 (0x17, 0x128)
  king() {
    const { win, kao, scr, con, printf } = this.c, K = this.K;
    win.frame(0x0c, 0x120, 0x2f, 0x68, 0);
    kao.drawNamed(scr, this.st.u16(K + 0x12), 0x0e, 0x12c);
    con.right = 0x38; con.left = 0x17; con.setCursor(0x17, 0x128);
    printf(this.F.kingName, this.b.dstr(K));
  }
  // seg0:7fa8 國王說話 (清除 (0x16,0x140) 0x24 欄 × 0x40 行)
  kingSay(n, ...a) {
    const { sys, con, scr, message } = this.c;
    sys.mouseHide();
    con.right = 0x38; con.left = 0x17; con.setCursor(0x17, 0x140);
    con.puts(this.F.kingTalk);
    scr.fillCols(0x16, 0x140, 0x24, 0x40, 7);
    message(n, ...a);
    sys.mouseShow();
  }
  async kingSayWait(n, ...a) { this.kingSay(n, ...a); await this.b.wait(); }
  async crewSays(n) { this.b.crewSpeaks([4, 3, 5, 2, 6]); this.c.message(n); await this.b.wait(); await this.b.closeTalk(); }   // seg0:9076
  // 2e09:5525 (共用) / 2e09:5678 (主角): 有事件就執行並回傳結果, 沒有回傳 1
  async event(env, building) {
    if (this.c.noEvents) return 1;
    const sc = (this.c.events ??= new Scenario(this.c)); sc.scene = this.b.p;
    if (!(await sc.check(env, this.b.port, building))) return 1;
    return sc.run(env);
  }

  // ================= 入口 2aa6a =================
  async run() {
    const b = this.b, st = this.st, { sys, menu } = this.c;
    this.K = 0x2a26 + ((this.nation + 10) & 0xff) * 0x16;                        // [bdbc]
    const fame = this.HD + 6 + this.nation;
    if (st.u8(fame) <= 0x50 && sys.rng.random(100) > st.u8(fame)) {             // 惡名昭彰: 抓起來
      await this.gw(0x1bb, this.heroName());
      return this.arrest(fame);
    }
    if (st.u8(this.HD + 0x0d) === 0 && (st.u8(b.hero + 0x31) & 0x0f) !== 6) {     // 平民
      if (!this.same() || !(st.u8(0x0d62) & 6)) return this.gw(0x54);
    }
    const t = st.u8(this.HD + 0x0d);
    if (t) b.greet(0x1bc, this.heroName(), st.hero === 5 ? b.T.ottomanTitles[t] : b.T.titles[t]);
    else b.greet(0x240);
    await b.wait();
    b.after();
    let sel;
    do {
      const items = this.c.menuItems(16).slice(0, 4);
      const c5e = st.u8(0x0d5e), same = this.same(7);
      if (same || (c5e !== 0 && c5e !== 0xff && plS16(st.u16(0x0d74)) >= 6) || (st.u8(0x0d62) & 6)) menu.disabled = 2;
      if (!same) menu.disabled |= 0x0c;
      sel = await b.menu(items);
      if (sel !== 0xff) {
        await [() => this.audience(), () => this.naturalize(), () => this.funds(), () => this.shipAid()][sel]();
        if (st.u8(this.HD + 0x0d) === 9 && (st.u8(0x0ca4) & 2)) await mainEnding(this.b.p, 0x0f);   // 2ac50: 0fea:77af(0x0f) 爵位 9 結局 (game/endgame.js)
      }
      b.after();
    } while (sel !== 0xff);
  }
  // 2a8e8 被抓: (主角 +25 × +21 / 100 + +21) & 0xff ≥ random(150) 時逃脫; 否則沒收 4/5 現金與存款, 對該國聲望 = 100
  async arrest(fame) {
    const b = this.b, st = this.st, { sys, palette } = this.c, H = b.hero;
    const bal = (Math.imul(100, plS16(st.u16(0x12b2))) + st.u8(0x12b4)) | 0;
    const r = sys.rng.random(150) & 0xff;
    const a = (Math.trunc((st.u8(H + 0x25) * st.u8(H + 0x21)) / 100) + st.u8(H + 0x21)) & 0xff;
    if (a >= r) {
      b.talkPerson(st.hero); this.c.message(0x1be); await b.wait(); await b.closeTalk();
      await palette.fadeBlack(); await sys.waitTenths(0x14); await palette.fadeToTarget();
      b.crewSpeaks(); this.c.message(0x1c0); await b.wait(); await b.closeTalk();
      return;
    }
    b.talkPerson(st.hero); this.c.message(0x1bd); await b.wait(); await b.closeTalk();
    await palette.fadeBlack(); b.after(); await sys.waitTenths(0x0f); await palette.fadeToTarget();
    this.king();
    await this.kingSayWait(0x1c1, this.heroName());
    await this.kingSayWait(0x1c2); await this.kingSayWait(0x1c3); await this.kingSayWait(0x1c4);
    this.money = (this.money + Math.trunc((this.money << 2) / -5)) | 0;           // _ldiv(現金 << 2, −5) (左移 32 位元回繞)
    const nb = (bal + Math.trunc((bal << 2) / -5)) | 0, q = Math.trunc(nb / 100);
    st.set16(0x12b2, q & 0xffff); st.set8(0x12b4, ((q & 0xff) * 0x9c + (nb & 0xff)) & 0xff);
    st.set8(fame, 100);
    b.p.panels();
  }

  // ================= 晉見國王 2a523 =================
  async audience() {
    const b = this.b, st = this.st, { menu } = this.c;
    if (this.same() && (st.u8(0x0d62) & 2)) {
      st.set8(0x0d5e, st.u8(0x0da4)); st.set8(0x0d5f, 0);
      await this.event(ENV_COMMON, 5);
    }
    if (!(await this.event(ENV_HERO, 0x15))) return;
    if (!(await this.event(ENV_COMMON, 0x15))) return;
    b.after();
    const items = this.c.menuItems(0x37).slice(0, 3);
    let sel;
    do {
      if (!this.same()) menu.disabled = 2;
      sel = await b.menu(items);
      if (sel !== 0xff) await [() => this.situation(), () => this.letterOfMarque(), () => this.taxFree()][sel]();
      b.after();
    } while (sel !== 0xff);
  }
  // 2a20c 勢力狀況
  async situation() {
    const st = this.st, n = this.nation;
    this.king();
    await this.kingSayWait(0x1c5, this.heroName());
    let cnt = 0; for (let q = 0; q < 0x64; q++) if ((st.u8(0x5f54 + q * 0x16 + 0x15) & 7) === n) cnt = (cnt + 1) & 0xff;   // 2a1bf
    await this.kingSayWait(0x373, cnt);
    for (;;) {
      const L = []; for (let i = 0; i < 8; i++) L.push(i);                       // 29e82
      this.b.setPersons(L);
      const r = await this.b.listSel().select(0x94, 8);
      if (r === -1) break;
      const sel = this.c.persons[r] & 0xff;
      if (await this.regionPorts(sel)) await this.regionEval(sel);
    }
    await this.kingSayWait(0x1c6);
  }
  // 29eb1 該地區的本國港口表 (每 7 筆等一次)
  async regionPorts(sel) {
    const st = this.st, b = this.b, { con, printf, message } = this.c, n = this.nation;
    con.left = 0x0e; con.right = 0x37;
    let cnt = 0, row = 0;
    for (let q = 0; q < 0x64; q++) {
      const P = 0x5f54 + q * 0x16, E = 0x6a80 + q * 0x25;
      if (st.u8(E + 0x1c) !== sel || (st.u8(P + 0x15) & 7) !== n) continue;
      cnt = (cnt + 1) & 0xff;
      if (!row) { b.table(); con.setCursor(0x13, 0x90); message(0x1db); }
      con.setCursor(0x0f, (row + 10) << 4);
      printf(this.F.portRow, b.dstr(P + 4), st.u8(E + 8 + (st.u8(P + 0x15) & 7)), st.u16(E + 4), st.u16(E));
      row++;
      if (row === 7 && q !== 0x63) { await b.wait(); row = 0; }
    }
    if (!cnt) { this.kingSay(0x1d1 + sel); message(0x1c7); await b.wait(); return 0; }
    return 1;
  }
  // 29fe7 地區收益: 各國各地區 A = Σ工業價值, B = Σ商業價值 × (港 +15 bit3 ? 2 : 1); A ≥ 300 (地區 3: 地區 2 或 4 也要 ≥ 300; 4..7: 4..該地區都要) 時說 B / DS:b244[地區]
  async regionEval(sel) {
    const st = this.st, A = new Uint16Array(64), B = new Uint16Array(64), n = this.nation;
    for (let q = 0; q < 0x64; q++) {
      const P = 0x5f54 + q * 0x16, E = 0x6a80 + q * 0x25, k = ((st.u8(P + 0x15) & 7) * 8 + st.u8(E + 0x1c)) & 63;
      A[k] += st.u16(E + 4);
      B[k] += Math.imul(st.u8(P + 0x15) & 8 ? 2 : 1, st.u16(E));
    }
    const a = i => A[n * 8 + i] >= 300;
    let ok = false;
    if (sel <= 2) ok = a(sel);
    else if (sel === 3) ok = (a(2) || a(4)) && a(3);
    else if (sel <= 7) { ok = true; for (let i = 4; i <= sel; i++) if (!a(i)) ok = false; }
    this.kingSay(0x1d1 + sel);
    if (ok) this.c.message(0x1c9, Math.trunc(B[n * 8 + sel] / this.div[sel]));   // 29fc0
    else this.c.message(0x1c8);
    await this.b.wait();
  }
  // 隨身物中找 target; 回傳 -1 = 已有, 0 = 沒有空格, 否則 = 最後一個空格的位址
  invSlot(target) {
    let slot = 0;
    for (let i = 0; i < 0x14; i++) { const v = this.st.u8(0x2e57 + i); if (v === target) return -1; if (v === 0xff) slot = 0x2e57 + i; }
    return slot;
  }
  // 2a27e 私掠許可証 (道具 0x1d + 國): 海盜名聲 ≥ 1000 且不低於商人/冒險家名聲
  async letterOfMarque() {
    const st = this.st, HD = this.HD, target = (this.nation + 0x1d) & 0xff, slot = this.invSlot(target);
    if (slot === -1) return this.crewSays(0x360);
    if (!slot) return this.crewSays(0x361);
    await this.gw(0x362);
    if (st.u16(HD + 2) < 1000) return this.gw(0x363);
    if (st.u16(HD + 2) < st.u16(HD) || st.u16(HD + 2) < st.u16(HD + 4)) return this.gw(0x364);
    await this.gw(0x365);
    this.king();
    await this.kingSayWait(0x366, this.heroName());
    await this.kingSayWait(0x367);
    st.set8(slot, target);
  }
  // 2a38a 免稅証 (道具 0x23 + 國): 本國人 爵位 < 6 時 (7 − 爵位) 萬, 外國人 (11 − 爵位) 萬; 付錢後不重畫面板 (原版如此)
  async taxFree() {
    const st = this.st, HD = this.HD, target = (this.nation + 0x23) & 0xff, slot = this.invSlot(target);
    if (slot === -1) return this.crewSays(0x368);
    if (!slot) return this.crewSays(0x361);
    await this.gw(0x369);
    if (this.c.rt.month % 6 < 3) await this.gw(0x36a);
    this.b.greet(0x36b);
    if (!(await this.c.menu.yesNo())) return;
    await this.gw(0x365);
    this.king();
    await this.kingSayWait(0x36c, this.heroName());
    const t = st.u8(HD + 0x0d);
    let si = 0;
    if (!this.same()) si = 0x0b - t; else if (t < 6) si = 7 - t;
    si = plS16(si);
    if (si) {
      this.kingSay(0x36d, si);
      if (!(await this.c.menu.yesNo())) return;
      if (plS16(Math.trunc(this.money / 10000)) < si) return this.crewSays(0x36e);
      this.money = (this.money + Math.imul(si, -10000)) | 0;
    }
    await this.kingSayWait(0x367);
    st.set8(slot, target);
  }

  // ================= 申請國籍 2a5f6 =================
  async naturalize() {
    const st = this.st, b = this.b, H = b.hero, HD = this.HD;
    this.king();
    await this.kingSayWait(0x1ca, this.heroName());
    if (!(await this.c.menu.yesNo())) return this.kingSayWait(0x1cb);
    await this.kingSayWait(0x1cc);
    const old = HD + 6 + (st.u8(H + 0x31) & 7), neu = HD + 6 + this.nation;
    st.set8(H + 0x31, (st.u8(H + 0x31) & 0xf0) | this.nation);
    st.set8(0x2e76 + st.u8(H + 0x2c) * 0x85 + 0x26, b.port);                    // [c2d4] 艦隊 +26 = 本港
    const N = this.nationRec(this.nation);
    if (st.u8(N + 2) === 7) st.set8(N + 2, 6);
    st.set8(N + 5, 0); st.set8(N + 6, 0); st.set8(N + 7, 0);
    if (st.u8(old) >= 0x1e) st.set8(old, (st.u8(old) + 0xe2) & 0xff);            // 原國 −30
    st.set8(neu, plUmax(100, plUmin(st.u8(neu) + 10, 200)));                     // 新國 max(100, min(+10, 200))
  }
  // ================= 資金援助 2a713 =================
  async funds() {
    const st = this.st, N = this.nationRec(this.nation), v = st.u8(N + 5);
    if (!v) return this.gw(0x1cd);
    if (((this.money + v * 1000) | 0) > 600000000) return this.gw(0x212);
    await this.gw(0x1ce, v);
    this.money = (this.money + v * 1000) | 0;
    st.set8(N + 5, 0);
    this.b.p.panels();
    await this.gw(0x1cf);
  }
  // ================= 船舶援助 2a79b =================
  async shipAid() {
    const st = this.st, b = this.b, N = this.nationRec(this.nation), tag = b.port | 0x80;
    if (!st.u8(N + 8)) return this.gw(0x1cd);
    b.freeSlots();                                                               // 12d0e
    if (plS16(this.c.persons[0]) < 10) return this.gw(0x213);                    // [0538] 不是船塢位 (沒有空位時沿用舊值)
    if (b.fleetShips() >= 10) return this.gw(0x213);
    if (!this.mates()) return this.gw(0x214);
    for (let i = 0; i < 0x28; i++) if (st.u8(b.crewData(i) + 0x1b) === tag && b.slotState(i) === 0x20) return this.gw(0x1cd);
    await this.gw(0x1d0, b.dstr(0x5892 + (st.u8(N + 7) + 0x28) * 0x16));
    this.makeShip(st.u8(N + 7));                                                 // 2e09:44bc
    st.set8(N + 8, st.u8(N + 8) - 1);
    for (let i = 0; i < 0x28; i++) {
      if (st.u8(b.crewData(i) + 0x1b) !== tag || b.slotState(i) !== 0x20) continue;
      const S = 0x5892 + st.u8(b.fleetSlot(i) + 7) * 0x16;
      b.greet(0x22b);
      const ni = b.nameInput();
      ni.prompt(2, 7);                                                           // 2e09:29a0
      while ((await ni.run(S, 7)) !== 1);                                        // 2e09:26a5 (不重開提示視窗)
      await this.c.win.close();
      break;
    }
    await this.gw(0x228);
    await this.gw(0x1cf);
  }
  // 0fea:2f43 = 12de3 可當船長的人: 主角 (沒有擔任艦隊船長時) + 船員欄中職務 > 2 的人
  mates() {
    const st = this.st, L = [];
    let i = 0; for (; i < 10; i++) if (st.u8(this.b.crewData(i) + 0x1b) === st.hero) break;
    if (i === 10) L.push(st.hero);
    for (let k = 0; k < 0x1e; k++) { const n = st.u8(0x2e1b + k); if (n !== 0xff && st.u8(st.personRecord(n) + 0x2e) > 2) L.push(n); }
    this.b.setPersons(L); return L.length;
  }
  // 2e09:44bc = 3254c 援助船 (船型 t): 放在第一個空的艦隊位, 狀態 0x20 (在造船所保管), 船員配置 +1b = 本港 | 0x80
  makeShip(t) {
    const st = this.st, b = this.b, T = 0x5e28 + t * 12, tmpl = 0x5892 + (t + 0x28) * 0x16;
    let i = 0; for (; i < 10; i++) { const f = b.slotState(i); if (f !== 0x10 && f !== 0x20) break; }
    const S = b.fleetSlot(0) + 9 * i, M = i < 10 ? b.crewData(i) : 0;           // 找不到空位時 S 指到第 10 格之後 (原版如此)
    let n = 0; for (let k = 0; k < 0x28; k++) if (st.u8(0x5892 + k * 0x16 + 0x0f) === 0xff) { n = k; break; }
    const d = Math.trunc((9 * st.u8(T + 1)) / 10) & 0xff;
    st.set8(S + 3, d); st.set8(S + 2, d);
    st.set8(S + 4, st.u8(T + 2)); st.set8(S + 5, st.u8(T + 3)); st.set8(S + 6, 0); st.set16(S, 0);
    st.set8(S + 7, n); st.set8(S + 8, 0x20);
    if (!M) console.warn("援助船: 艦隊沒有空位 (原版會寫到 DS:0000)");
    else {
      for (const k of [0, 2, 4, 6]) st.set16(M + k, 0);
      st.set8(M + 8, 0x19); st.set8(M + 9, 0x32); st.set8(M + 0x1b, b.port | 0x80); st.set16(M + 0x0a, 0);
      for (let k = 0; k < 5; k++) { st.set8(M + 0x16 + k, 0xff); st.set16(M + 0x0c + 2 * k, 0); }
    }
    const R = 0x5892 + n * 0x16;
    st.set8(R + 0x11, st.u8(tmpl + 0x11)); st.set8(R + 0x0f, t); st.set8(R + 0x10, st.u8(tmpl + 0x10));
    st.set16(R + 0x12, st.u16(tmpl + 0x12));
    st.set16(R + 0x14, (st.u16(T + 6) - st.u8(R + 0x11) - st.u16(R + 0x12)) & 0xffff);
    st.set8(b.eco + 0x23, 0);                                                    // [c2dc] +23
  }
}
