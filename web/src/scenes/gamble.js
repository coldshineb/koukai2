// gamble.js — 酒館 賭博 (MAIN.EXE 1fd9:7491 = 27491; 子功能 DS:af80 = 二十一點 2e8ed / 骰子 2fc60), 見 RE_NOTES 17.9
// 圖形: DATA1.LZW 第 9 項 (assets/gfx/gamble.bin, 0x15c0 bytes) 每次進入賭博時重新載入到 [c2ec]:
//   撲克牌 花色 k (牌 / 13) 於 0x300×k (k = 4 為背面), 4 欄 × 48 行平面交錯; 骰子 v (0..5) 於 0xf00 + 0x120×v, 3 欄 × 24 行
// 文字與格式字串: port.json gamble (tools/extract_port.py)
const gHex = s => { const b = Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16))), o = new Uint8Array(b.length + 1); o.set(b); return o; };

export class Gamble {
  constructor(b) {
    this.b = b;
    const G = b.p.P.data.gamble;
    this.G = { items: G.items.map(gHex), ranks: G.ranks.map(gHex), hands: G.hands.map(gHex),
      ...Object.fromEntries(Object.entries(G.fmt).map(([k, v]) => [k, gHex(v)])) };
  }
  get c() { return this.b.c; }
  get st() { return this.b.st; }
  get money() { return this.b.money; } set money(v) { this.b.money = v; }
  get rng() { return this.c.sys.rng; }
  fill(col, y, w, h, color) { this.c.scr.fillCols(col, y, w, h, color); }           // seg0:0906
  at(col, y) { this.c.con.setCursor(col, y); }                                     // seg0:443c
  // 金幣 = 現金 % 10000 (seg0:37ee), 金塊 = 現金 / 10000 (seg0:3722)
  get gold() { return this.money % 10000; } get bars() { return Math.trunc(this.money / 10000); }
  // 2e09e 賭注上限 = min(現金, 500)
  maxBet() { return this.money > 500 ? 500 : this.money; }

  // ================= 1fd9:7491 入口 =================
  async run() {
    const { message, menu, palette, graph } = this.c;
    if (this.money === 0) { this.b.randomTalk(); message(0x3f2); await this.b.wait(); await this.b.closeTalk(); return; }
    this.gfx = new Uint8Array(this.b.p.P.gamble);                                  // 2e09:7399 讀入 DATA1 #9 (0x15c0)
    let sel;
    do {
      await palette.fadeBlack();                                                    // seg0:99f2
      graph.draw(0x1b, 0, 0);                                                       // seg0:5b5d GRAPH.DAT #0x1b
      await palette.fadeToTarget();                                                 // seg0:99e8
      sel = await menu.listMenu(0x3c, 0x68, this.G.items, 1);                       // 0fea:44c4
      if (sel !== 0xff) await [() => this.blackjack(), () => this.dice()][sel]();
    } while (sel !== 0xff);
    await palette.fadeBlack();
    graph.draw8(this.st.options & 0x80 ? 3 : 5, 0, 0);                              // seg0:5a91
    await this.b.p.interior(1);                                                     // seg0:8ebc(1)
    await palette.fadeToTarget();
  }

  // ================= 二十一點 2e8ed =================
  bjText() { this.fill(0x20, 0x10, 0x1a, 0x58, 7); }                                // 2e11e
  bjClear() {                                                                       // 2e13b
    this.bjText(); this.fill(0x16, 0x68, 0x24, 0x40, 4); this.fill(0x20, 0xe8, 0x1a, 0x58, 7); this.fill(0x16, 0x140, 0x24, 0x40, 4);
  }
  async blackjack() {
    const { win, kao, scr, con, message, menu } = this.c, st = this.st;
    if (this.money < 10) return;
    const face = this.rng.random(0x3fff) | 0xc000, start = this.money;          // [bd76]
    win.frame(0x15, 8, 0x26, 0xa8, 2);
    kao.drawRandomType(scr, this.rng, face, 0x17, 0x14);                           // seg0:7cb9
    win.frame(0x15, 0xe0, 0x26, 0xa8, 2);
    kao.drawPerson(scr, st.bytes(this.b.hero, 0x32), 0x17, 0xec);                  // seg0:7d39
    con.left = 0x20; con.right = 0x38;
    this.bjClear();
    this.at(0x20, 0x10); message(0x3d3);
    if (!(await menu.yesNo())) return;
    for (;;) {
      this.bjClear();
      await this.bjRound();
      this.bjText(); this.at(0x20, 0x10);
      if (this.money < 10) { message(0x3d4); await this.b.wait(); break; }
      message(0x3d5);
      if (!(await menu.yesNo())) break;
    }
    if (this.money === 0) return;
    this.bjText(); this.at(0x20, 0x10);
    if (start + 500 < this.money) { message(0x3d6); await this.b.wait(); }
    if (this.money + 500 < start) { message(0x3d7); await this.b.wait(); }
  }
  // 2e0b6 洗牌: 0..51 以 random(52) 交換 0xd0 次 (位置 = 次數 % 52), 取前 24 張
  shuffle() {
    const d = Array.from({ length: 0x34 }, (_, i) => i);
    for (let n = 0, si = 0; n < 0xd0; si = ++n % 0x34) { const di = this.rng.random(0x34); if (di !== si) [d[si], d[di]] = [d[di], d[si]]; }
    return d.slice(0, 0x18);
  }
  static cardVal(c) { return Math.min(c % 13 + 1, 10); }                           // 2e414
  static handSum(h, n) {                                                            // 2e23c: 有 A 且 ≤ 11 時 +10
    let s = 0, ace = 0;
    for (let i = 0; i < n; i++) { if (h[i] === 1) ace = 1; s += h[i]; }
    return ace && s <= 11 ? s + 10 : s;
  }
  // 2e194 畫一張牌 (c = 0x34 為背面)
  card(col, y, c) {
    const k = Math.trunc(c / 13);
    this.c.scr.putPlanar(col, y, 4, 0x30, this.gfx, k * 0x300);                     // seg0:03ca
    this.at(col, y);
    if (k !== 4) this.c.printf(this.G.card, this.G.ranks[c % 13]);
  }
  printMoney(col) {
    this.at(col, 0x118); this.c.printf(this.G.n4, this.gold);
    this.at(col, 0x12c); this.c.printf(this.G.n4, this.bars);
  }
  // 2e725 一局
  async bjRound() {
    const { con, message, menu, sys } = this.c, D = this.shuffle(), ph = [], dh = [];
    ph[0] = Gamble.cardVal(D[0]);
    let pc = 1, idx = 2, last = 0, pt;
    const bet = await this.bjBet(D[0]);
    for (;;) {
      await sys.waitTicks(0x28);
      this.card(pc * 5 + 0x17, 0x148, D[idx]); last = idx++;
      ph[pc++] = Gamble.cardVal(D[last]);
      pt = Gamble.handSum(ph, pc);
      this.at(0x32, 0x12c); message(0x3d2, pt);
      if (pt > 21) { pt = 0; break; }
      if ((await menu.listMenu(0x41, 0x30, [this.G.deal, this.G.stand], 0)) === 1) { pt = Gamble.handSum(ph, pc); break; }
      if (idx === 8) break;
    }
    const pcount = pc;
    dh[0] = Gamble.cardVal(D[1]);
    let dc = 1, dt;
    for (;;) {
      this.bjText();
      this.card(dc * 5 + 0x17, 0x70, D[idx]);
      dh[dc] = Gamble.cardVal(D[idx]); last = idx; dc++;
      const s = Gamble.handSum(dh, dc);
      if (s >= 17) {
        dt = s;
        this.card(0x17, 0x70, D[1]);                                                 // 翻開莊家的第一張
        this.at(0x32, 0x50); message(0x3d2, dt);
        if (dt > 21) dt = 0;
        break;
      }
      if (dc === 6) { dt = s; break; }
      idx++;
    }
    await this.bjSettle(pt, pcount, dt, bet, D, last);
    this.printMoney(0x2c);
  }
  // 2e278 下注 (c0 = 玩家第一張)
  async bjBet(c0) {
    const { message, printf } = this.c;
    this.card(0x17, 0x70, 0x34);
    this.card(0x17, 0x148, c0);
    this.at(0x20, 0x118); message(0x3bf, this.gold);
    this.at(0x27, 0x12c); message(0x3c0, this.bars);
    const max = this.maxBet();
    this.at(0x20, 0x100); message(0x3e3, max);
    this.at(0x20, 0x10); message(0x3c2);
    const bet = await this.b.numpad.input(10, max);                                // seg0:592a
    this.at(0x25, 0x100); printf(this.G.bet, max, bet);
    this.bjText(); this.at(0x20, 0x10);
    message(bet < 20 ? 0x3c3 : bet > 200 ? 0x3c4 : 0x3c5);
    this.money = this.money - bet;
    this.printMoney(0x2c);
    return bet;
  }
  // 三張牌排序 D[1..3] (2e4e3 / 2e60e)
  static sort3(D) { for (let i = 1; i < 3; i++) for (let j = i + 1; j <= 3; j++) if (D[j] < D[i]) [D[i], D[j]] = [D[j], D[i]]; }
  static same3(D) { return D[1] % 13 === D[2] % 13 && D[1] % 13 === D[3] % 13; }
  static run3(D) { D[1]++; if (D[2] !== D[1]) return false; D[2]++; return D[3] === D[2]; }   // 同花色連號 (牌碼連續)
  // 2e427 結算: win / lose = 倍數; 現金 += (win − lose) × 賭注 (賭注已先扣)
  async bjSettle(pt, pc, dt, bet, D, last) {
    const { con, message } = this.c, r = c => c % 13;
    let win = 0, lose = 0;
    this.at(0x20, 0x10); con.left = 0x20; con.right = 0x38;
    if (dt < pt) {
      let di = 0, m = 0;
      if (pt === 21 && pc === 2) {
        if ((D[0] === 0 && D[2] === 10) || (D[0] === 10 && D[2] === 0)) { di = 6; m = 0x3c6; }     // 黑桃 A + 黑桃 J
        else if (r(D[0]) <= 9 && r(D[2]) <= 9) { di = 2; m = 0x3c8; }
        else { di = 3; m = 0x3c7; }
      } else if (pt === 21 && pc === 3) {
        D[1] = D[0]; Gamble.sort3(D);
        if (Gamble.same3(D)) { di = 4; m = 0x3c9; } else if (Gamble.run3(D)) { di = 4; m = 0x3ca; } else { di = 2; m = 0x3c8; }
      }
      if (m) message(m);
      win = di;
      if (!di) { if (pc >= 5) { win = 4; message(0x3cb); } else { win = 2; message(0x3c8); } }
    } else {
      const dx = last - pc;                                                         // 莊家牌數 − 1
      if (dt === 21 && dx === 1) {
        if ((D[1] === 0 && D[last] === 10) || (D[1] === 10 && D[last] === 0)) { lose = 4; message(0x3cc); }
        else if (r(D[1]) <= 9 && r(D[last]) <= 9) message(0x3ce);
        else { lose = 1; message(0x3cd); }
      } else if (dt === 21 && dx === 2) {
        D[2] = D[last]; D[3] = D[last - 1]; Gamble.sort3(D);
        if (Gamble.same3(D)) { lose = 2; message(0x3cf); } else if (Gamble.run3(D)) { lose = 2; message(0x3d0); } else message(0x3ce);
      } else if (dx >= 4 && (dt === 21 || dt !== 0)) { lose = 2; message(0x3d1); }
      else message(0x3ce);
    }
    if (!(this.money === 0 && lose)) {
      if (lose * bet > this.money) this.money = 0; else this.money = this.money + (win - lose) * bet;
    }
    await this.b.wait();
  }

  // ================= 骰子 2fc60 =================
  areaA() { const c = this.c.con; c.right = 0x25; c.left = 0x0e; this.at(0x0e, 0x10); }            // 2eb39
  areaB() { const c = this.c.con; c.right = 0x42; c.left = 0x2b; this.at(0x2b, 0x90); }            // 2eb4e
  wide() { const c = this.c.con; c.left = 0x0e; c.right = 0x39; }                                   // 2eb63
  // 2eb70 對手 k (0 / 1) 的發言區: 清除並把文字區設在那裡
  area(k) {
    const [col, y] = [[0x0e, 0x10], [0x2b, 0x90]][k & 0xff], c = this.c.con;
    c.left = col; c.right = col + 0x17;
    this.fill(col, y, 0x18, 0x2b, 7); this.at(col, y);
  }
  diceTop() { this.fill(0x0c, 8, 0x1b, 0x70, 7); }                                  // 2ea57
  diceMid() { this.fill(0x29, 0x88, 0x1b, 0x70, 7); }                               // 2ea74
  // 2eaae 清除三家的骰子區並寫上 1..5
  diceClear() {
    this.diceTop(); this.fill(0x0d, 0x3c, 0x19, 0x24, 0);
    this.diceMid(); this.fill(0x2a, 0xbc, 0x19, 0x24, 0);
    this.fill(0x0c, 0x108, 0x2f, 0x80, 7); this.fill(0x0d, 0x14c, 0x19, 0x24, 0);
    for (let i = 0; i < 5; i++) { this.at((i + 3) * 5, 0x138); this.c.printf(this.G.d, i + 1); }
  }
  async dice() {
    const { win, kao, scr, con, message, menu } = this.c, st = this.st;
    if (this.money < 10) return;
    const start = this.money, ord = { v: 0 };                                       // [bp-6] 先後順序
    win.frame(2, 0, 0x26, 0x80, 2);                                                 // 2ebf4
    kao.drawRandomType(scr, this.rng, this.rng.random(0x3fff) | 0xc000, 4, 0x10);
    win.frame(0x28, 0x80, 0x26, 0x80, 2);
    kao.drawRandomType(scr, this.rng, this.rng.random(0x3fff) | 0xc000, 0x44, 0x90);
    win.frame(2, 0x100, 0x3a, 0x90, 2);
    kao.drawPerson(scr, st.bytes(this.b.hero, 0x32), 4, 0x120);
    con.puts(this.G.reset);
    this.areaA(); message(0x3e9);
    if (!(await menu.yesNo())) return;
    this.areaB(); message(0x3ea); await this.b.wait();
    for (;;) {
      this.diceClear();
      await this.diceRound(ord);
      await this.b.wait();
      this.area(this.rng.random(2));
      if (this.money < 10) {
        this.diceClear(); this.areaA(); message(0x3eb); this.areaB(); message(0x3ec); await this.b.wait(); break;
      }
      message(0x3ed);
      if (!(await menu.yesNo()) || this.money < 10) break;
    }
    this.diceTop(); this.diceMid();
    if (this.money === 0) return;
    if (start + 500 < this.money) { this.areaA(); message(0x3ee); this.areaB(); message(0x3ef); await this.b.wait(); }
    if (this.money + 500 < start) { this.areaA(); message(0x3f0); this.areaB(); message(0x3f1); await this.b.wait(); }
  }
  // 2f873 一局: 下注 → 抬價 → 依順序三家擲骰 → 判定
  async diceRound(ord) {
    const { con, message, printf } = this.c, G = this.G;
    this.wide();
    this.at(0x28, 0x150); message(0x3bf, this.gold);
    this.at(0x2f, 0x164); message(0x3c0, this.bars);
    const max = this.maxBet();
    this.at(0x28, 0x130); message(0x3e3, max);
    const coin = this.rng.random(2);                                              // [bp-22]: 由哪一家開口 (AX 直接當 2eb70 的參數)
    this.area(coin); message(0x3c2);
    let bet = await this.b.numpad.input(10, max);
    bet = await this.raise(max, bet, coin);
    this.at(0x28, 0x130); message(0x3e4, max, bet);
    this.money = this.money - bet;
    this.at(0x34, 0x150); printf(G.n4, this.gold);
    this.at(0x34, 0x164); printf(G.n4, this.bars);
    const D = [];
    for (const k of [[0, 1, 2], [1, 2, 0], [2, 0, 1]][ord.v]) {
      const [col, y, hy] = [[0x0e, 0x40, 0x10], [0x2b, 0xc0, 0x90], [0x0e, 0x150, 0x110]][k];
      if (k < 2) this.area(k); else this.wide();
      const d = D[k] = await this.roll(k, col, y);
      for (let i = 0; i < 5; i++) if (d[i] === 0) d[i] = 6;
      if (k === 2) { this.fill(0x0e, 0x110, 0x18, 0x20, 7); this.at(0x0d, 0x110); }          // 2ebcc
      this.handName(Gamble.pairs(d), col, hy);
    }
    const r = Gamble.judge(D[2], D[0], D[1]);
    con.left = 1; con.right = 0x4e;
    if (r === 0) { this.at(0x2b, 0xa8); message(0x3e5); this.money = this.money + bet * 3; ord.v = 2; }
    else if (r <= 3) {
      if (r === 1) { this.at(0x0e, 0x28); ord.v = 0; }
      else { this.at(0x2b, 0xa8); if (r === 2) ord.v = 1; else if (ord.v === 2) ord.v = 0; }
      message(0x3e6);
    } else if (r === 4) { this.at(0x2b, 0xa8); message(0x3e7); this.money = this.money + bet; }
    else {
      if (r === 5) { this.at(0x2b, 0xa8); if (ord.v === 1) ord.v = 2; }
      else { this.at(0x0e, 0x28); if (ord.v === 0) ord.v = 1; }
      message(0x3e8); this.money = this.money + Math.trunc(bet * 3 / 2);
    }
    this.wide();
    this.at(0x34, 0x150); printf(G.n4, this.gold);
    this.at(0x34, 0x164); printf(G.n4, this.bars);
  }
  // 2f688 對手抬價 (coin = 由哪一家開口)
  async raise(max, bet, coin) {
    const { con, message, menu, sys } = this.c, other = coin < 1 ? 1 : 0;
    let nb = bet, m;
    if (bet >= 200 || !this.rng.random(4)) { this.area(coin); message(0x3e1); this.area(other); m = 0x3e2; }
    else {
      const k = this.rng.random(bet >= 100 ? 5 : 10) + 1, raised = bet + Math.trunc(bet * k / 10);
      this.area(other); message(0x3d9, raised); this.area(coin);
      if (await menu.yesNo()) { nb = raised; message(0x3da); this.area(other); m = 0x3db; }
      else if (!this.rng.random(3)) { message(0x3df, bet); this.area(other); m = 0x3e0; }
      else {
        nb = this.rng.random(2) ? raised : Math.trunc((raised + bet) / 2);
        if (raised === nb) { message(0x3dc, nb); this.area(other); m = 0x3db; }
        else { message(0x3dd, nb); this.area(other); m = 0x3de; }
      }
    }
    message(m);
    if (max < nb) nb = max;
    con.left = 0; con.right = 0x4e;
    sys.flush(); await menu.waitRelease(); await menu.waitPress();                   // 0fea:3359 = 131f9
    return nb;
  }
  die(col, y, v) { this.c.scr.putPlanar(col, y, 3, 0x18, this.gfx, 0xf00 + v * 0x120); }   // 2ec7a
  keepRow(f, col, y, s1, s0) {
    for (let i = 0; i < 5; i++) { this.at(col + i * 5, y + 0x20); this.c.printf(f[i] ? s1 : s0); }
  }
  // 2f471 擲骰 (最多換兩次): who 0/1 = 對手 (成對的保留, 2ed19), 2 = 主角 (選要換的骰子)
  async roll(who, col, y) {
    const { con, message, menu, sys, printf } = this.c, G = this.G, d = [0, 0, 0, 0, 0], f = [0, 0, 0, 0, 0];
    let tries = 0;
    for (let it = 0; it < 3; it++) {
      if (it > 0) { for (let i = 0; i < 5; i++) if (!f[i]) this.fill(col + i * 5, y, 3, 0x18, 0); await sys.waitTicks(0x14); }
      for (let i = 0; i < 5; i++) if (!f[i]) { const v = this.rng.random(6); d[i] = v; this.die(col + i * 5, y, v); await sys.waitTicks(0x14); }
      for (let i = 1; i < 5; i++) {                                                // 2f3e9 插入排序 (旗標跟著移動)
        const v = d[i], fv = f[i]; let j = i;
        while (j > 0 && d[j - 1] > v) { d[j] = d[j - 1]; f[j] = f[j - 1]; j--; }
        d[j] = v; f[j] = fv;
      }
      await sys.waitTicks(0x0a);
      for (let i = 0; i < 5; i++) { this.die(col + i * 5, y, d[i]); this.at(col + i * 5, y + 0x20); printf(f[i] >= 1 ? G.keep : G.blank4); }
      if (tries >= 2) continue;
      if (who !== 2) {
        for (let i = 0; i < 4; i++) for (let j = i + 1; j < 5; j++) if (d[j] === d[i]) f[i] = f[j] = 1;   // 2ed19
        this.keepRow(f, col, y, G.keep, G.blank4);
        await sys.waitTicks(0x14);
      } else {
        this.at(0x10, 0x120); message(0x3d8);
        if (await menu.yesNo()) break;
        this.at(0x10, 0x120); printf(G.blank14);
        for (let i = 0; i < 5; i++) menu.rects[i] = { x0: i * 0x28 + 0x70, x1: i * 0x28 + 0x88, y0: 0x150, y1: 0x168 };
        let s;
        do {
          s = (await menu.customMenu(5, 5, 0x81)) & 0xff;                           // 0fea:4684
          this.toggleKeep(s, f);
          this.keepRow(f, col, y, G.keep, G.blank4);
        } while (s !== 0xff);
        for (let i = 0; i < 5; i++) if (f[i] === 1) f[i] = 2;
        if (f.every(v => v === 2)) break;
      }
      tries++;
    }
    return d;
  }
  // 2eca8 切換第 s 顆「不換」。原版取消時 (s = 0xff) 也照樣以 [旗標 + 0x1fe] 讀寫:
  //   該位址落在 27491 堆疊上的賭博圖形緩衝區 (offset 0x1a4, 黑桃牌圖內), 那個字為 1 → 0、為 0 → 1, 移植版照做
  toggleKeep(s, f) {
    if (s === 0xff) {
      const g = this.gfx, w = g[0x1a4] | (g[0x1a5] << 8);
      if (w === 1) g[0x1a4] = 0; else if (w === 0) g[0x1a4] = 1;
      if (w <= 1) g[0x1a5] = 0;
      return;
    }
    if (f[s] === 1) f[s] = 0; else if (f[s] === 0) f[s] = 1;
  }
  // 2f837 牌型名 (成對數 0,1,2,3,4,6,10 → DS:b5b8 第 0..6 項)
  handName(n, col, y) {
    const i = n === 6 ? 5 : n === 10 ? 6 : n;
    this.at(col, y); this.c.printf(this.G.hand, this.G.hands[i]);
  }
  // ---- 判定 (骰子已排序後把 0 換成 6, 所以 6 排在最前面) ----
  static pairs(h) { let n = 0; for (let i = 0; i < 4; i++) for (let j = i + 1; j < 5; j++) if (h[j] === h[i]) n++; return n; }   // 2ed97: 0,1,2,3,4,6,10
  static low(h) { for (let i = 0; i < 4; i++) for (let j = i + 1; j < 5; j++) if (h[j] === h[i]) return h[i]; return h[3]; }    // 2edc3: 第一個成對的點數
  static other(h, v) { for (let i = 0; i < 4; i++) for (let j = i + 1; j < 5; j++) if (h[j] === h[i] && h[i] !== v) return h[i]; return h[3]; }  // 2edf0
  // 2ee23 同牌型的兩家比較: 0 = X 勝, 1 = Y 勝, 3 = 平手
  static cmp2(X, Y, n) {
    let dx = 3;
    if (n === 10) { if (Y[0] < X[0]) dx = 0; if (Y[0] > X[0]) dx = 1; }
    if (n === 6 || n === 3) { if (Y[2] < X[2]) dx = 0; if (Y[2] > X[2]) dx = 1; }
    let r = dx;
    if (n === 4) {
      if (Y[2] < X[2]) dx = 0;
      r = dx; if (Y[2] > X[2]) r = 1;
      if (Y[2] === X[2]) { const p = Gamble.other(X, X[2]), q = Gamble.other(Y, Y[2]); if (q < p) r = 0; if (p < q) r = 1; }
    }
    if (n === 2) {
      const p = Gamble.low(X), q = Gamble.low(Y);
      if (q < p) r = 0; if (q > p) r = 1;
      if (q === p) { const a = Gamble.other(X, p), b = Gamble.other(Y, q); if (b < a) r = 0; if (b > a) r = 1; }
    }
    if (n === 1) { const p = Gamble.low(X), q = Gamble.low(Y); if (q < p) return 0; return p < q ? 1 : r; }
    return r;
  }
  // 三家比較同一個值 (p = 主角, a / b = 對手 0 / 1): 2efe2 / 2f06c / 2f17d / 2f25e / 2f29f 共用的形式
  static three(p, a, b) {
    if (a < p && b < p) return 0;
    if (a > p || b > p) { let r = Gamble.U; if (b > a) r = 2; if (b < a) r = 1; return a === b ? 3 : r; }
    if (a === p && b === p) return 4;
    return a === p ? 5 : 6;
  }
  // 2ef5b 判定: 0 = 主角勝, 1 / 2 = 對手 0 / 1 勝, 3 = 兩對手平手, 4 = 三家平手, 5 / 6 = 主角與對手 0 / 1 平手
  //   原版有幾條路徑不設定結果, 回傳未初始化的 [bp-8] (= 先前 2f837 呼叫留下的 CS 0x2e09, > 5); 呼叫端處理與 6 相同, 以 Gamble.U = 6 表示
  static judge(P, A, B) {
    const U = Gamble.U, cP = Gamble.pairs(P), cA = Gamble.pairs(A), cB = Gamble.pairs(B);
    if (cA < cP && cB < cP) return 0;
    if (cA > cP || cB > cP) {
      let r = U; if (cB > cA) r = 2; if (cB < cA) r = 1;
      if (cB !== cA) return r;
      r = Gamble.cmp2(A, B, cA); return r === 3 ? 3 : r + 1;
    }
    if (cA === cP && cB === cP) {
      const n = cP;
      if (n === 10) return Gamble.three(P[0], A[0], B[0]);
      if (n === 6 || n === 3) return Gamble.three(P[2], A[2], B[2]);
      if (n === 4) {
        const a = P[2], b = A[2], c = B[2], pa = Gamble.other(P, a), pb = Gamble.other(A, b), pc = Gamble.other(B, c);
        if (b < a && c < a) return 0;
        if (b > a || c > a) {
          let r = U; if (c > b) r = 2; if (c < b) r = 1;
          if (c !== b) return r;
          return pc < pb ? 1 : pc > pb ? 2 : 3;
        }
        if (b === a && c === a) return Gamble.three(pa, pb, pc);
        if (b === a) { let r = U; if (pb < pa) r = 0; if (pb > pa) r = 1; return pb === pa ? 5 : r; }
        if (c === a) { let r = U; if (pc < pa) r = 0; if (pc > pa) r = 2; return pc === pa ? 6 : r; }
        return U;
      }
      if (n === 2) {
        const hP = Gamble.low(P), hA = Gamble.low(A), hB = Gamble.low(B);
        const lP = Gamble.other(P, hP), lA = Gamble.other(A, hA), lB = Gamble.other(B, hB);
        if (hA < hP && hB < hP) return 0;
        if (hA > hP || hB > hP) { let r = U; if (hB > hA) r = 2; if (hB < hA) r = 1; return hA === hB ? 3 : r; }
        if (hA === hP && hB === hP) return Gamble.three(lP, lA, lB);
        if (hA === hP) { let r = U; if (lA < lP) r = 0; if (lA > lP) r = 1; return lA === lP ? 5 : r; }
        if (hB === hP) { let r = U; if (lB < lP) r = 0; if (lB > lP) r = 1; return lB === lP ? 6 : r; }   // 原版此處對手 1 勝也是 1
        return U;
      }
      if (n === 1) {
        const hP = Gamble.low(P), hA = Gamble.low(A), hB = Gamble.low(B);
        if (hA < hP && hB < hP) return 0;
        if (hA > hP || hB > hP) { let r = U; if (hB > hA) r = 2; if (hB < hA) r = 1; return hA === hB ? 3 : r; }
        if (hA === hP && hB === hP) return 2;                                      // 原版如此 (三家同點的一對 → 對手 1 勝)
        return hA === hP ? 5 : 6;
      }
      return U;
    }
    if (cA === cP) { const r = Gamble.cmp2(P, A, cP); return r === 3 ? 5 : r; }
    { let r = Gamble.cmp2(P, B, cP); if (r === 1) r = 2; return r === 3 ? 6 : r; }
  }
}
Gamble.U = 6;
