// ui/buildings/shared.ts — 12 建筑一体化工作台共用壳体、数字/消息工具与统一双栏投资面板
import { GameConst } from "../../model/flags.ts";
import { captureConsoleText, toSimp } from "../text_util.ts";
import { createDomModal, mountBuildingBanner } from "../modals.ts";

export const capMsg = (c: any, id: number, ...args: any[]) =>
  toSimp(captureConsoleText(c, () => c.message(id, ...args)).trim());

export const fmtMoneyPill = (money: number) => `金块 ${Math.trunc(money / 10000)}  ·  金币 ${money % 10000}`;

export const plS16 = (v: number) => (v << 16) >> 16;
export const plUmin = (a: number, b: number) => ((a & 0xffff) > (b & 0xffff) ? b & 0xffff : a & 0xffff);
export const plUmax = (a: number, b: number) => ((b & 0xffff) >= (a & 0xffff) ? b & 0xffff : a & 0xffff);

export function createWorkbenchShell(title: string, money: number, onClose: () => void, artUrl: string | null = null) {
  const h = createDomModal({
    title,
    size: "wide",
    cancelable: true,
    closeLabel: "关闭",
    onCancel: onClose,
  });
  const moneyPill = document.createElement("span");
  moneyPill.className = "uw2-pill";
  moneyPill.textContent = fmtMoneyPill(money);
  h.headerRight.prepend(moneyPill);

  const toolbar = mountBuildingBanner(h.modal, h.body, artUrl);

  const footer = document.createElement("div");
  footer.className = "uw2-modal-footer";
  const toastEl = document.createElement("span");
  toastEl.style.cssText = "font-size:13px;font-weight:600;color:#247544;";
  footer.appendChild(toastEl);
  h.modal.appendChild(footer);

  return { h, moneyPill, toolbar, footer, toastEl };
}

/** 交易所「商业投资」与造船厂「工业投资」共用 1:1 统一双栏投资面板 */
export function renderUnifiedInvestPane(opts: {
  container: HTMLElement;
  leftTitle: string;
  rightTitle: string;
  statLabel: string;
  statValue: number;
  investLabel: string;
  curInvest: number;
  maxInvest: number;
  amount: number;
  blockMsg: string;
  promptMsg: string;
  confirmLabel: string;
  onAmountChange: (v: number) => void;
  onConfirm: (v: number) => void;
}) {
  const split = document.createElement("div");
  split.className = "uw2-split";

  const left = document.createElement("div");
  left.className = "uw2-pane";
  const lt = document.createElement("div");
  lt.className = "uw2-pane-title";
  lt.textContent = opts.leftTitle;
  left.appendChild(lt);

  const info = document.createElement("div");
  info.className = "uw2-action-box";
  info.innerHTML =
    `<div class="uw2-kv-row"><span class="uw2-kv-label">${opts.statLabel}</span><span class="uw2-kv-val">${opts.statValue}</span></div>` +
    `<div class="uw2-kv-row"><span class="uw2-kv-label">${opts.investLabel}</span><span class="uw2-kv-val">${opts.curInvest.toLocaleString()} / ${GameConst.MAX_INVEST.toLocaleString()}</span></div>`;
  left.appendChild(info);

  const right = document.createElement("div");
  right.className = "uw2-pane";
  const rt = document.createElement("div");
  rt.className = "uw2-pane-title";
  rt.textContent = opts.rightTitle;
  right.appendChild(rt);

  const box = document.createElement("div");
  box.className = "uw2-action-box";
  if (opts.blockMsg) {
    const p = document.createElement("div");
    p.className = "uw2-speech-box";
    p.textContent = opts.blockMsg;
    box.appendChild(p);
  } else {
    let cur = Math.max(0, Math.min(opts.maxInvest, Math.trunc(opts.amount || 0)));
    if (opts.promptMsg) {
      const p = document.createElement("div");
      p.className = "uw2-speech-box";
      p.textContent = opts.promptMsg;
      box.appendChild(p);
    }

    const numInp = document.createElement("input");
    numInp.type = "number";
    numInp.className = "uw2-amount-input";
    numInp.min = "0";
    numInp.max = String(opts.maxInvest);
    numInp.value = String(cur);

    const sl = document.createElement("input");
    sl.type = "range";
    sl.className = "uw2-slider";
    sl.style.width = "100%";
    sl.min = "0";
    sl.max = String(opts.maxInvest);
    sl.value = String(cur);

    const invBtn = document.createElement("button");
    invBtn.className = "uw2-btn uw2-btn-primary";
    invBtn.style.cssText = "padding:8px 28px;align-self:flex-start;";
    invBtn.textContent = opts.confirmLabel;

    const sync = (v: number) => {
      cur = Math.max(0, Math.min(opts.maxInvest, Math.trunc(v || 0)));
      numInp.value = String(cur);
      sl.value = String(cur);
      invBtn.disabled = cur <= 0 || opts.maxInvest <= 0;
      opts.onAmountChange(cur);
    };
    numInp.addEventListener("input", () => sync(Number(numInp.value)));
    sl.addEventListener("input", () => sync(Number(sl.value)));

    const stepRow = document.createElement("div");
    stepRow.className = "uw2-step-row";
    for (const [lb, fn] of [
      ["-5000", () => sync(cur - 5000)],
      ["-1000", () => sync(cur - 1000)],
      ["+1000", () => sync(cur + 1000)],
      ["+5000", () => sync(cur + 5000)],
      ["MAX", () => sync(opts.maxInvest)],
    ] as const) {
      const qb = document.createElement("button");
      qb.className = "uw2-step-btn";
      qb.disabled = opts.maxInvest <= 0;
      qb.textContent = lb;
      qb.addEventListener("click", fn);
      stepRow.appendChild(qb);
    }

    invBtn.disabled = cur <= 0 || opts.maxInvest <= 0;
    invBtn.addEventListener("click", () => opts.onConfirm(cur));
    box.append(numInp, sl, stepRow, invBtn);
  }
  right.appendChild(box);
  split.append(left, right);
  opts.container.appendChild(split);
}
