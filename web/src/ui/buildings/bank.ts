// ui/buildings/bank.ts — 银行一体化工作台
import { GameConst } from "../../model/flags.ts";
import { domS16, calcDepositLimit, canTakeLoan, calcLoanLimit } from "../../domain/economy.ts";
import { decodeCleanCstr } from "../text_util.ts";
import { getBuildingArtUrl, preserveScroll } from "../modals.ts";
import { UI_STR } from "../strings.ts";
import { capMsg, createWorkbenchShell, fmtMoneyPill } from "./shared.ts";
// ============================================================================
// 2. 银行一体化工作台 (Bank)
// ============================================================================
export function runDomBankWorkbench(bank: any): Promise<void> {
  const b = bank.b, c = bank.c, m = bank.m, g = m.globals, codec = c.codec;
  const portName = decodeCleanCstr(codec, m.port(b.port).nameBytes);
  const tabLabels = [...UI_STR.bankTabs];
  const initGreet = b.port === GameConst.VENICE_PORT_ID
    ? capMsg(c, 0x61)
    : capMsg(c, 0x62, m.port(b.port).nameBytes);

  return new Promise(resolve => {
    let settled = false;
    let tab = 0; // 0: 存款, 1: 提款, 2: 贷款, 3: 还款
    let amt = 0;
    let notice = initGreet;

    const done = () => {
      if (settled) return;
      settled = true;
      shell.h.close();
      b.p.panels();
      b.after();
      resolve();
    };

    const shell = createWorkbenchShell(`${portName} · 银行`, bank.money, done, getBuildingArtUrl(c, 8, b.p));

    const getLimitAndBlock = (): { max: number; blockMsg: string } => {
      const bal = bank.bal;
      const q = domS16(g.bankQuotient);
      if (tab === 0) {
        if (bank.money <= 1000) return { max: 0, blockMsg: capMsg(c, 0x64) };
        if (q >= 10000) return { max: 0, blockMsg: capMsg(c, 0x65) };
        if (q < 0) return { max: 0, blockMsg: capMsg(c, 0x66) };
        return { max: calcDepositLimit(g.bankQuotient, g.bankRem, bank.money), blockMsg: "" };
      }
      if (tab === 1) {
        if (bal <= 0) return { max: 0, blockMsg: capMsg(c, 0x68) };
        if (bank.money > 599999900) return { max: 0, blockMsg: capMsg(c, 0x6b) };
        return { max: bal, blockMsg: "" };
      }
      if (tab === 2) {
        if (bal > 0) return { max: 0, blockMsg: capMsg(c, 0x6f) };
        if (!canTakeLoan(m.heroInfo().rank, g.bankQuotient)) return { max: 0, blockMsg: capMsg(c, 0x71) };
        return { max: calcLoanLimit(m.heroInfo().rank, bal), blockMsg: "" };
      }
      if (bal >= 0) return { max: 0, blockMsg: capMsg(c, 0x76) };
      const owe = -bal | 0;
      return { max: Math.min(owe, bank.money), blockMsg: "" };
    };

    const render = () => preserveScroll(shell.h.body, () => {
      shell.moneyPill.textContent = fmtMoneyPill(bank.money);
      shell.toastEl.textContent = notice;

      shell.toolbar.innerHTML = "";
      tabLabels.forEach((lbl: string, idx: number) => {
        const btn = document.createElement("button");
        btn.className = `uw2-btn uw2-tab-btn ${tab === idx ? "active" : ""}`;
        btn.textContent = lbl;
        btn.addEventListener("click", () => { tab = idx; amt = 0; render(); });
        shell.toolbar.appendChild(btn);
      });

      shell.h.body.innerHTML = "";
      const split = document.createElement("div");
      split.className = "uw2-split";

      // 左栏：帐户状态
      const left = document.createElement("div");
      left.className = "uw2-pane";
      const lt = document.createElement("div");
      lt.className = "uw2-pane-title";
      lt.textContent = "账户概览";
      left.appendChild(lt);

      const bal = bank.bal;
      const infoCard = document.createElement("div");
      infoCard.className = "uw2-action-box";
      infoCard.innerHTML =
        `<div style="display:flex;justify-content:space-between;font-size:14px;"><span>持有现金</span><strong>${bank.money.toLocaleString()} 金币</strong></div>` +
        `<div style="display:flex;justify-content:space-between;font-size:14px;"><span>${bal < 0 ? "当前借款" : "当前存款"}</span><strong style="color:${bal < 0 ? "#b83d3d" : "#247544"};">${Math.abs(bal).toLocaleString()} 金币</strong></div>` +
        `<div style="display:flex;justify-content:space-between;font-size:13px;color:var(--uw2-ink-muted);"><span>爵位信用额度</span><span>${(m.heroInfo().rank * m.heroInfo().rank * 10000 + 1000).toLocaleString()} 金币</span></div>`;
      left.appendChild(infoCard);

      // 右栏：金额滑杆与确认
      const right = document.createElement("div");
      right.className = "uw2-pane";
      const rt = document.createElement("div");
      rt.className = "uw2-pane-title";
      rt.textContent = tabLabels[tab] || "办理业务";
      right.appendChild(rt);

      const box = document.createElement("div");
      box.className = "uw2-action-box";
      const { max, blockMsg } = getLimitAndBlock();

      if (blockMsg) {
        const msgEl = document.createElement("div");
        msgEl.style.cssText = "font-size:14px;color:var(--uw2-ink);line-height:1.6;";
        msgEl.textContent = blockMsg;
        box.appendChild(msgEl);
      } else {
        if (amt > max) amt = max;
        const promptId = [0x69, 0x6c, 0x73, 0x77][tab];
        const p = document.createElement("div");
        p.style.cssText = "font-size:14px;color:var(--uw2-ink);";
        p.textContent = capMsg(c, promptId, max);
        box.appendChild(p);

        const numInp = document.createElement("input");
        numInp.type = "number";
        numInp.min = "0";
        numInp.max = String(max);
        numInp.value = String(amt);
        numInp.style.cssText = "width:100%;padding:8px 12px;font-size:18px;font-weight:700;border:1px solid var(--uw2-gold);border-radius:6px;background:#fffdf6;color:var(--uw2-ink);";

        const slider = document.createElement("input");
        slider.type = "range";
        slider.className = "uw2-slider";
        slider.style.width = "100%";
        slider.min = "0";
        slider.max = String(max);
        slider.value = String(amt);

        const syncVal = (v: number) => {
          amt = Math.max(0, Math.min(max, Math.trunc(v || 0)));
          numInp.value = String(amt);
          slider.value = String(amt);
        };
        numInp.addEventListener("input", () => syncVal(Number(numInp.value)));
        slider.addEventListener("input", () => syncVal(Number(slider.value)));

        const quickRow = document.createElement("div");
        quickRow.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;";
        [
          { label: "清空", fn: () => syncVal(0) },
          { label: "+1,000", fn: () => syncVal(amt + 1000) },
          { label: "+10,000", fn: () => syncVal(amt + 10000) },
          { label: "全部", fn: () => syncVal(max) },
        ].forEach(q => {
          const qb = document.createElement("button");
          qb.className = "uw2-btn";
          qb.textContent = q.label;
          qb.addEventListener("click", q.fn);
          quickRow.appendChild(qb);
        });

        const okBtn = document.createElement("button");
        okBtn.className = "uw2-btn uw2-btn-primary";
        okBtn.style.cssText = "padding:9px 24px;align-self:flex-start;";
        okBtn.textContent = `确认${tabLabels[tab]}`;
        okBtn.addEventListener("click", () => {
          if (amt <= 0) return;
          if (tab === 0) {
            const nb = (bal + amt) | 0;
            bank.store(nb, "normal");
            bank.money = (bank.money - amt) | 0;
            notice = capMsg(c, 0x6a, amt);
          } else if (tab === 1) {
            if (((bank.money + amt) | 0) > GameConst.MAX_CASH) { notice = capMsg(c, 0x6d); render(); return; }
            const nb = (bal - amt) | 0;
            bank.store(nb, "normal");
            bank.money = (bank.money + amt) | 0;
            notice = capMsg(c, 0x6e, amt);
          } else if (tab === 2) {
            const nb = (bal - amt) | 0;
            bank.store(nb, "loan");
            bank.money = (bank.money + amt) | 0;
            notice = capMsg(c, 0x74, amt);
          } else {
            const nb = (bal + amt) | 0;
            bank.store(nb, "repay");
            bank.money = (bank.money - amt) | 0;
            notice = capMsg(c, 0x78);
          }
          amt = 0;
          b.p.panels();
          render();
        });

        box.append(numInp, slider, quickRow, okBtn);
      }
      right.appendChild(box);
      split.append(left, right);
      shell.h.body.appendChild(split);
    });

    render();
  });
}
