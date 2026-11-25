// bank.js — 银行 (MAIN.EXE 1fd9:9511 = 线性 292a1, 处理函数表 DS:a612[8]); 见 RE_NOTES 25
// 夏洛克银行: MENU #0 (存款/提款/贷款/还款), 子功能 DS:b0d4 = 28dc2 / 28f23 / 2903d / 29197
// 帐户 (存盘内): bankQuotient 有号字 = 余额 / 100 (负 = 借款), bankRem 字节 = 余额 % 100; 余额 = 100 × bankQuotient + bankRem
//   原版写回时: bankQuotient = _ldiv(余额, 100) (向零取整), bankRem = (bankQuotient 低字节 × 0x9c + 余额低字节) & 0xff (= 余额 − 100 × 商)
//   贷款 / 还款写回时另把商减 1 (贷款: 余额 < 0 时; 还款: 余额 ≠ 0 时), 所以借款正好是 100 的倍数时存成 (商 − 1, 100) —— 原版如此, 照搬
// 银行内的金钱增减不调用 8894 (面板要等下次菜单才重画) —— 原版如此
import { GameConst, MenuId } from "../model/flags.ts";
import { domS16, encodeBankBalance, calcDepositLimit, canTakeLoan, calcLoanLimit } from "../domain/economy.ts";
import { hasDom } from "../ui/modals.ts";
import { runDomBankWorkbench } from "../ui/buildings/bank.ts";

export class Bank {
  constructor(b) { this.b = b; }
  get c() { return this.b.c; }
  get st() { return this.b.st; }
  get m() { return this.b.st.model; }
  get money() { return this.b.money; } set money(v) { this.b.money = v; }
  get bal() { return this.m.globals.bankBalance; }
  // 写回帐户: mode = "normal" | "loan" | "repay"
  store(v, mode = "normal") {
    const g = this.m.globals, enc = encodeBankBalance(v, mode);
    g.bankQuotient = enc.quotient;
    g.bankRem = enc.rem;
  }
  greetWait(n, ...a) { this.b.greet(n, ...a); return this.b.wait(); }

  // ================= 入口 292a1 =================
  async run() {
    if (hasDom() && this.c.codec) {
      await runDomBankWorkbench(this);
      return;
    }
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
    if (this.money <= 1000) {                                                   // 现金 ≤ 1000
      b.crewSpeaks([4, 3, 5, 2, 6]); this.c.message(0x64); await b.wait(); await b.closeTalk(); return;
    }
    const q = domS16(g.bankQuotient);
    if (q >= 10000) return this.greetWait(0x65);
    if (q < 0) return this.greetWait(0x66);
    const max = calcDepositLimit(g.bankQuotient, g.bankRem, this.money);
    if (bal) b.greet(0x67, bal); else b.greet(0x68);
    await b.wait();
    b.greet(0x69, max);
    const v = await b.numpad.input(0, max);
    if (!v) return;
    await this.greetWait(0x6a, v);
    const nb = (bal + v) | 0;
    await this.greetWait(0x67, nb);
    this.store(nb, "normal");
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
    this.store(nb, "normal");
    this.money = (this.money + v) | 0;
  }
  // 2903d 贷款: 额度 = 爵位² × 10000 + 余额 + 1000; bankQuotient ≤ −(爵位² × 100) − 10 (16 比特) 时不再贷
  async loan() {
    const b = this.b, m = this.m, t = m.heroInfo().rank, bal = this.bal;
    if (bal > 0) return this.greetWait(0x6f);
    if (!canTakeLoan(t, m.globals.bankQuotient)) return this.greetWait(0x71);
    if (this.money >= 1000000) await this.greetWait(0x70);                      // 只说一句, 仍可借
    const max = calcLoanLimit(t, bal);
    await this.greetWait(0x72, max);
    b.greet(0x73, max);
    const v = await b.numpad.input(0, max);
    if (!v) return;
    await this.greetWait(0x74, v);
    await this.greetWait(0x75);
    const nb = (bal - v) | 0;
    this.store(nb, "loan");
    this.money = (this.money + v) | 0;                                          // 不检查 600000000 上限
  }
  // 29197 还款
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
    this.store(nb, "repay");
    this.money = (this.money - v) | 0;
  }
}
