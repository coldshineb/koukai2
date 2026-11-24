// bank.js — 銀行 (MAIN.EXE 1fd9:9511 = 線性 292a1, 處理函式表 DS:a612[8]); 見 RE_NOTES 25
// 夏洛克銀行: MENU #0 (存款/提款/貸款/還款), 子功能 DS:b0d4 = 28dc2 / 28f23 / 2903d / 29197
// 帳戶 (存檔內): bankQuotient 有號字 = 餘額 / 100 (負 = 借款), bankRem 位元組 = 餘額 % 100; 餘額 = 100 × bankQuotient + bankRem
//   原版寫回時: bankQuotient = _ldiv(餘額, 100) (向零取整), bankRem = (bankQuotient 低位元組 × 0x9c + 餘額低位元組) & 0xff (= 餘額 − 100 × 商)
//   貸款 / 還款寫回時另把商減 1 (貸款: 餘額 < 0 時; 還款: 餘額 ≠ 0 時), 所以借款正好是 100 的倍數時存成 (商 − 1, 100) —— 原版如此, 照搬
// 銀行內的金錢增減不呼叫 8894 (面板要等下次選單才重畫) —— 原版如此
import { GameConst, MenuId } from "../model/flags.ts";

const bkS16 = v => (v << 16) >> 16;

export class Bank {
  constructor(b) { this.b = b; }
  get c() { return this.b.c; }
  get st() { return this.b.st; }
  get m() { return this.b.st.model; }
  get money() { return this.b.money; } set money(v) { this.b.money = v; }
  get bal() { return this.m.globals.bankBalance; }
  // 寫回帳戶: q = 商 (已調整), v = 餘額
  store(q, v) {
    const g = this.m.globals;
    g.bankQuotient = q & 0xffff;
    g.bankRem = ((q & 0xff) * 0x9c + (v & 0xff)) & 0xff;
  }
  greetWait(n, ...a) { this.b.greet(n, ...a); return this.b.wait(); }

  // ================= 入口 292a1 =================
  async run() {
    const b = this.b, m = this.m;
    if (b.noEvent()) {
      if (b.port === GameConst.VENICE_PORT_ID) b.greet(0x61);                   // 威尼斯本行
      else b.greet(0x62, m.port(b.port).nameBytes);                             // %s 分行
    }
    let sel;
    do {
      sel = await b.menu(this.c.menuItems(MenuId.BANK).slice(0, 4));
      if (sel !== 0xff) await [() => this.deposit(), () => this.withdraw(), () => this.loan(), () => this.repay()][sel]();
      b.after();
    } while (sel !== 0xff);
    await this.greetWait(0xa4);
  }

  // 28dc2 存款
  async deposit() {
    const b = this.b, g = this.m.globals, bal = this.bal;
    if (this.money <= 1000) {                                                   // 現金 ≤ 1000
      b.crewSpeaks([4, 3, 5, 2, 6]); this.c.message(0x64); await b.wait(); await b.closeTalk(); return;
    }
    const q = bkS16(g.bankQuotient);
    if (q >= 10000) return this.greetWait(0x65);
    if (q < 0) return this.greetWait(0x66);
    let max = (Math.imul(bkS16(10000 - q), 100) - g.bankRem) | 0;
    if (max > this.money) max = this.money;
    if (bal) b.greet(0x67, bal); else b.greet(0x68);
    await b.wait();
    b.greet(0x69, max);
    const v = await b.numpad.input(0, max);
    if (!v) return;
    await this.greetWait(0x6a, v);
    const nb = (bal + v) | 0;
    await this.greetWait(0x67, nb);
    this.store(Math.trunc(nb / 100), nb);
    this.money = (this.money - v) | 0;
  }
  // 28f23 提款
  async withdraw() {
    const b = this.b, bal = this.bal;
    if (bal <= 0) return this.greetWait(0x68);
    if (this.money > 599999900) return this.greetWait(0x6b);                    // 0x23c3459c
    await this.greetWait(0x67, bal);
    b.greet(0x6c, bal);
    const v = await b.numpad.input(0, bal);
    if (!v) return;
    if (((this.money + v) | 0) > GameConst.MAX_CASH) return this.greetWait(0x6d);
    await this.greetWait(0x6e, v);
    const nb = (bal - v) | 0;
    await this.greetWait(0x67, nb);
    this.store(Math.trunc(nb / 100), nb);
    this.money = (this.money + v) | 0;
  }
  // 2903d 貸款: 額度 = 爵位² × 10000 + 餘額 + 1000; bankQuotient ≤ −(爵位² × 100) − 10 (16 位元) 時不再貸
  async loan() {
    const b = this.b, m = this.m, t = m.heroInfo().rank, bal = this.bal;
    if (bal > 0) return this.greetWait(0x6f);
    if (bkS16(Math.imul(bkS16(t * t), -100) - 10) >= bkS16(m.globals.bankQuotient)) return this.greetWait(0x71);
    if (this.money >= 1000000) await this.greetWait(0x70);                      // 只說一句, 仍可借
    const max = (Math.imul(Math.imul(10000, t), t) + bal + 1000) | 0;
    await this.greetWait(0x72, max);
    b.greet(0x73, max);
    const v = await b.numpad.input(0, max);
    if (!v) return;
    await this.greetWait(0x74, v);
    await this.greetWait(0x75);
    const nb = (bal - v) | 0;
    let q = Math.trunc(nb / 100); if (nb < 0) q--;
    this.store(q, nb);
    this.money = (this.money + v) | 0;                                          // 不檢查 600000000 上限
  }
  // 29197 還款
  async repay() {
    const b = this.b, bal = this.bal;
    if (bal >= 0) return this.greetWait(0x76);
    const owe = -bal | 0;
    b.greet(0x95, owe);
    const max = owe > this.money ? this.money : owe;
    await b.wait();
    b.greet(0x77, max);
    const v = await b.numpad.input(0, max);
    if (!v) return;
    b.greet(0x78);
    const nb = (bal + v) | 0;
    await b.wait();
    await this.greetWait(0x75);
    this.store(Math.trunc(nb / 100) - (nb ? 1 : 0), nb);
    this.money = (this.money - v) | 0;
  }
}
