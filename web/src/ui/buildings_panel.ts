// ui/buildings_panel.ts — 与交易所 / 码头 / 道具店 1:1 统一规格的六大建筑一体化工作台
// 涵盖：王宫 (Palace)、银行 (Bank)、事务所 (Office)、旅馆 (Inn)、教会 (Church)、占卜师 (Fortune)
// 统一结构：createDomModal(wide) + headerRight(.uw2-pill + 关闭) + .uw2-modal-toolbar(.uw2-tab-btn) + .uw2-split + .uw2-modal-footer
import { DiscoveryFlag, GameConst, NobleFlag, OptionFlag, ShipSlotFlag, SkillFlag, TreatyFlag } from "../model/flags.ts";
import {
  WorldConst,
  barmaidByAddr,
  getCountryExtra,
  getPortEcoExtra,
  getWorkState,
  heroOrDockSlot,
  personRawBytes,
  revealEntireWorldMap,
  setExploreUnrep,
  setPortBuildDays,
  setWorkCurParam,
  writeShipName,
} from "../model/world_helpers.ts";
import { domS16, calcDepositLimit, canTakeLoan, calcLoanLimit } from "../domain/economy.ts";
import { captureConsoleText, decodeCleanCstr, toSimp } from "./text_util.ts";
import { createDomModal, getBuildingArtUrl, getPersonPortraitSrc, mountBuildingBanner, preserveScroll, runDomStoryCard } from "./modals.ts";
import { UI_STR } from "./strings.ts";
import { ENV_COMMON, ENV_HERO } from "../game/scenario.js";
import { mainEnding } from "../game/endgame.js";
import { ListSelect } from "./dos/listsel.js";

const capMsg = (c: any, id: number, ...args: any[]) =>
  toSimp(captureConsoleText(c, () => c.message(id, ...args)).trim());

const fmtMoneyPill = (money: number) => `金块 ${Math.trunc(money / 10000)}  ·  金币 ${money % 10000}`;

const plS16 = (v: number) => (v << 16) >> 16;
const plUmin = (a: number, b: number) => ((a & 0xffff) > (b & 0xffff) ? b & 0xffff : a & 0xffff);
const plUmax = (a: number, b: number) => ((b & 0xffff) >= (a & 0xffff) ? b & 0xffff : a & 0xffff);

function createWorkbenchShell(title: string, money: number, onClose: () => void, artUrl: string | null = null) {
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

// ============================================================================
// 1. 王宫一体化工作台 (Palace)
// ============================================================================
export async function runDomPalaceWorkbench(palace: any): Promise<void> {
  const b = palace.b, c = palace.c, m = palace.m;
  const g = m.globals, hd = m.heroInfo(), codec = c.codec, art = c.art;
  const portName = decodeCleanCstr(codec, m.port(b.port).nameBytes);
  const K = palace.kingRec;
  const kingName = decodeCleanCstr(codec, K.nameBytes);
  const kingPortraitUrl = art?.portraitUrl?.(K.portrait & 0xff) ?? null;

  const t = hd.rank;
  const initGreet = t
    ? capMsg(c, 0x1bc, palace.heroName(), g.hero === 5 ? b.T.ottomanTitles[t] : b.T.titles[t])
    : capMsg(c, 0x240);

  const regionNames = Array.from({ length: 8 }, (_, i) => capMsg(c, 0x1d1 + i));

  // 先计算某地区的本国港口清单与收益评估（与 palace.js regionPorts / regionEval 完全一致）
  const evalRegion = (sel: number) => {
    const n = palace.nation;
    const ports: { name: string; inf: number; ind: number; com: number }[] = [];
    const A = new Uint16Array(64), B = new Uint16Array(64);
    for (let q = 0; q < 100; q++) {
      const P = m.port(q), E = m.portEconomy(q);
      const k = ((P.region & 7) * 8 + E.regionGroup) & 63;
      A[k] += E.industry;
      B[k] += Math.imul(P.region & 8 ? 2 : 1, E.commerce);
      if (E.regionGroup === sel && (P.region & 7) === n) {
        ports.push({
          name: decodeCleanCstr(codec, P.nameBytes),
          inf: E.getInfluence(P.region & 7),
          ind: E.industry,
          com: E.commerce,
        });
      }
    }
    const a = (i: number) => A[n * 8 + i] >= 300;
    let ok = false;
    if (sel <= 2) ok = a(sel);
    else if (sel === 3) ok = (a(2) || a(4)) && a(3);
    else if (sel <= 7) { ok = true; for (let i = 4; i <= sel; i++) if (!a(i)) ok = false; }
    const summary = ports.length === 0
      ? toSimp(captureConsoleText(c, () => { c.message(0x1d1 + sel); c.message(0x1c7); }).trim())
      : toSimp(captureConsoleText(c, () => {
          c.message(0x1d1 + sel);
          if (ok) c.message(0x1c9, Math.trunc(B[n * 8 + sel] / palace.div[sel]));
          else c.message(0x1c8);
        }).trim());
    return { ports, summary };
  };

  let tab = 0; // 0: 晋见国王, 1: 势力状况, 2: 许可与归化, 3: 王室援助
  let selRegion = 0;
  let notice = initGreet;

  for (;;) {
    let pendingAction: null | "royal_event" | "ship_aid" = null;

    await new Promise<void>(resolve => {
      let settled = false;

      const done = () => {
        if (settled) return;
        settled = true;
        shell.h.close();
        resolve();
      };

      const shell = createWorkbenchShell(`${portName} · 王宫`, palace.money, done, getBuildingArtUrl(c, 5, b.p));

      const render = () => preserveScroll(shell.h.body, () => {
        shell.moneyPill.textContent = fmtMoneyPill(palace.money);
        shell.toastEl.textContent = notice;

        const same = palace.same(7);
        const c5e = g.commonChap;
        const wk = getWorkState(m);
        const canNaturalize = !(same || (c5e !== 0 && c5e !== GameConst.EMPTY_SLOT && plS16(wk.curKind) >= 6) || (wk.flags & 6));
        const tabs = UI_STR.palaceTabs.map((label, idx) => ({
          label,
          disabled: idx === 3 && !same,
        }));

        shell.toolbar.innerHTML = "";
        tabs.forEach((tb, idx) => {
          const btn = document.createElement("button");
          btn.className = `uw2-btn uw2-tab-btn ${tab === idx ? "active" : ""}`;
          btn.disabled = tb.disabled;
          btn.textContent = tb.label;
          btn.addEventListener("click", () => { tab = idx; render(); });
          shell.toolbar.appendChild(btn);
        });

        shell.h.body.innerHTML = "";
        const split = document.createElement("div");
        split.className = "uw2-split";

        // 左栏：国王与身分概况 / 或地区清单（势力状况分页）
        const left = document.createElement("div");
        left.className = "uw2-pane";

        if (tab === 1) {
          const lt = document.createElement("div");
          lt.className = "uw2-pane-title";
          lt.textContent = "海域地区";
          left.appendChild(lt);

          const list = document.createElement("div");
          list.className = "uw2-list-col";
          regionNames.forEach((rn, idx) => {
            const btn = document.createElement("button");
            btn.className = `uw2-row-card ${idx === selRegion ? "selected" : ""}`;
            btn.textContent = rn;
            btn.addEventListener("click", () => { selRegion = idx; render(); });
            list.appendChild(btn);
          });
          left.appendChild(list);
        } else {
          const lt = document.createElement("div");
          lt.className = "uw2-pane-title";
          lt.textContent = "王室觐见";
          left.appendChild(lt);

          const card = document.createElement("div");
          card.className = "uw2-action-box";
          const head = document.createElement("div");
          head.style.cssText = "display:flex;align-items:center;gap:14px;";
          if (kingPortraitUrl) {
            const img = document.createElement("img");
            img.className = "uw2-portrait-img";
            img.src = kingPortraitUrl;
            head.appendChild(img);
          }
          let portCount = 0;
          for (let q = 0; q < 100; q++) if ((m.port(q).region & 7) === palace.nation) portCount++;
          const titleStr = hd.rank ? decodeCleanCstr(codec, g.hero === 5 ? b.T.ottomanTitles[hd.rank] : b.T.titles[hd.rank]) : "平民";
          const standing = hd.getCountryStanding(palace.nation);
          const meta = document.createElement("div");
          meta.style.cssText = "display:flex;flex-direction:column;gap:4px;";
          meta.innerHTML =
            `<div class="uw2-detail-title">${kingName}</div>` +
            `<div style="font-size:13px;color:var(--uw2-ink-muted);">当前爵位：${titleStr} · 贡献度：${standing - 100}</div>` +
            `<div style="font-size:13px;color:var(--uw2-ink-muted);">本国同盟港：${portCount} 座</div>`;
          head.appendChild(meta);
          card.appendChild(head);

          const speech = document.createElement("div");
          speech.style.cssText = "font-size:14px;line-height:1.65;color:var(--uw2-ink);padding:8px 10px;border-radius:6px;background:rgba(255,252,242,0.72);border:1px solid rgba(154,119,56,0.24);";
          speech.textContent = notice;
          card.appendChild(speech);
          left.appendChild(card);
        }

        // 右栏：对应分页操作
        const right = document.createElement("div");
        right.className = "uw2-pane";

        if (tab === 0) {
          const rt = document.createElement("div");
          rt.className = "uw2-pane-title";
          rt.textContent = "觐见事项";
          right.appendChild(rt);

          const box = document.createElement("div");
          box.className = "uw2-action-box";

          const btnAud = document.createElement("button");
          btnAud.className = "uw2-btn uw2-btn-primary";
          btnAud.style.cssText = "padding:10px 20px;align-self:flex-start;";
          btnAud.textContent = UI_STR.palaceActions.audience;
          btnAud.addEventListener("click", () => {
            pendingAction = "royal_event";
            done();
          });

          const btnSit = document.createElement("button");
          btnSit.className = "uw2-btn";
          btnSit.style.cssText = "padding:9px 18px;align-self:flex-start;";
          btnSit.textContent = UI_STR.palaceActions.situation;
          btnSit.addEventListener("click", () => { tab = 1; render(); });

          box.append(btnAud, btnSit);
          right.appendChild(box);
        } else if (tab === 1) {
          const rt = document.createElement("div");
          rt.className = "uw2-pane-title";
          rt.textContent = `${regionNames[selRegion]} · 本国同盟港`;
          right.appendChild(rt);

          const { ports, summary } = evalRegion(selRegion);
          const box = document.createElement("div");
          box.className = "uw2-action-box";

          const sumEl = document.createElement("div");
          sumEl.style.cssText = "font-size:13px;line-height:1.6;color:var(--uw2-ink);padding:8px 10px;border-radius:6px;background:rgba(255,252,242,0.72);border:1px solid rgba(154,119,56,0.24);";
          sumEl.textContent = summary;
          box.appendChild(sumEl);

          if (ports.length) {
            const list = document.createElement("div");
            list.className = "uw2-list-col";
            list.style.maxHeight = "300px";
            ports.forEach(p => {
              const row = document.createElement("div");
              row.className = "uw2-slot-card";
              row.innerHTML =
                `<span style="font-weight:700;color:var(--uw2-ink);min-width:110px;">${p.name}</span>` +
                `<span style="font-size:13px;color:var(--uw2-ink-muted);">占有 ${p.inf}% · 工业 ${p.ind} · 商业 ${p.com}</span>`;
              list.appendChild(row);
            });
            box.appendChild(list);
          }
          right.appendChild(box);
        } else if (tab === 2) {
          const rt = document.createElement("div");
          rt.className = "uw2-pane-title";
          rt.textContent = "许可与国籍";
          right.appendChild(rt);

          const box = document.createElement("div");
          box.className = "uw2-action-box";

          // 1. 私掠许可证
          const lomBtn = document.createElement("button");
          lomBtn.className = "uw2-row-card";
          lomBtn.textContent = UI_STR.palaceActions.letterOfMarque;
          lomBtn.addEventListener("click", () => {
            const target = (palace.nation + 0x1d) & 0xff;
            const slot = palace.invSlot(target);
            if (slot === -1) { notice = capMsg(c, 0x360); render(); return; }
            if (slot === -2) { notice = capMsg(c, 0x361); render(); return; }
            if (hd.pirateFame < 1000) { notice = capMsg(c, 0x363); render(); return; }
            if (hd.pirateFame < hd.tradeFame || hd.pirateFame < hd.adventureFame) { notice = capMsg(c, 0x364); render(); return; }
            m.setInventory(slot, target);
            notice = capMsg(c, 0x367);
            render();
          });

          // 2. 免税证
          const tfTarget = (palace.nation + 0x23) & 0xff;
          let tfCostW = 0;
          if (!palace.same()) tfCostW = 11 - hd.rank;
          else if (hd.rank < 6) tfCostW = 7 - hd.rank;
          tfCostW = plS16(tfCostW);

          const tfBtn = document.createElement("button");
          tfBtn.className = "uw2-row-card";
          tfBtn.disabled = !palace.same();
          tfBtn.textContent = UI_STR.palaceActions.taxFree;
          tfBtn.addEventListener("click", () => {
            const slot = palace.invSlot(tfTarget);
            if (slot === -1) { notice = capMsg(c, 0x368); render(); return; }
            if (slot === -2) { notice = capMsg(c, 0x361); render(); return; }
            if (tfCostW > 0) {
              if (plS16(Math.trunc(palace.money / 10000)) < tfCostW) { notice = capMsg(c, 0x36e); render(); return; }
              palace.money = (palace.money + Math.imul(tfCostW, -10000)) | 0;
            }
            m.setInventory(slot, tfTarget);
            b.p.panels();
            notice = capMsg(c, 0x367);
            render();
          });

          // 3. 申请国籍（归化）
          const natBtn = document.createElement("button");
          natBtn.className = "uw2-row-card";
          natBtn.disabled = !canNaturalize;
          natBtn.textContent = UI_STR.palaceActions.naturalize;
          natBtn.addEventListener("click", () => {
            const hero = m.heroPerson();
            const oldNat = hero.face & 7, newNat = palace.nation;
            hero.face = (hero.face & 0xf0) | newNat;
            m.fleet(hero.fleet).homePort = b.port;
            const country = m.country(newNat);
            const ce = getCountryExtra(country);
            if (ce.rival === 7) ce.rival = 6;
            country.aidMoneyK = 0; ce.clearAidExtra(); country.aidShipType = 0;
            const oldVal = hd.getCountryStanding(oldNat);
            if (oldVal >= 30) hd.setCountryStanding(oldNat, (oldVal - 30) & 0xff);
            hd.setCountryStanding(newNat, plUmax(100, plUmin(hd.getCountryStanding(newNat) + 10, 200)));
            b.p.panels();
            notice = capMsg(c, 0x1cc);
            render();
          });

          box.append(lomBtn, tfBtn, natBtn);
          right.appendChild(box);
        } else {
          const rt = document.createElement("div");
          rt.className = "uw2-pane-title";
          rt.textContent = "王室援助";
          right.appendChild(rt);

          const country = m.country(palace.nation);
          const box = document.createElement("div");
          box.className = "uw2-action-box";

          const fundsBtn = document.createElement("button");
          fundsBtn.className = "uw2-row-card";
          fundsBtn.textContent = UI_STR.palaceActions.funds;
          fundsBtn.addEventListener("click", () => {
            if (!country.aidMoneyK) { notice = capMsg(c, 0x1cd); render(); return; }
            if (((palace.money + country.aidMoneyK * 1000) | 0) > GameConst.MAX_CASH) { notice = capMsg(c, 0x212); render(); return; }
            const amtK = country.aidMoneyK;
            palace.money = (palace.money + amtK * 1000) | 0;
            country.aidMoneyK = 0;
            b.p.panels();
            notice = capMsg(c, 0x1ce, amtK);
            render();
          });

          const shipBtn = document.createElement("button");
          shipBtn.className = "uw2-row-card";
          shipBtn.textContent = UI_STR.palaceActions.shipAid;
          shipBtn.addEventListener("click", () => {
            if (!country.aidShipCount) { notice = capMsg(c, 0x1cd); render(); return; }
            pendingAction = "ship_aid";
            done();
          });

          box.append(fundsBtn, shipBtn);
          right.appendChild(box);
        }

        split.append(left, right);
        shell.h.body.appendChild(split);
      });

      render();
    });

    if (pendingAction === "royal_event") {
      const wk = getWorkState(m);
      if (palace.same() && (wk.flags & 2)) {
        g.commonChap = wk.royalChap; g.commonSec = 0;
        await palace.event(ENV_COMMON, 5);
      }
      await palace.event(ENV_HERO, 0x15);
      await palace.event(ENV_COMMON, 0x15);
      if (hd.rank === 9 && (g.options & OptionFlag.ENDING_READY)) {
        await mainEnding(b.p, 0x0f);
        return;
      }
      b.after();
      continue;
    }
    if (pendingAction === "ship_aid") {
      await palace.shipAid();
      b.after();
      continue;
    }
    break;
  }
}

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

// ============================================================================
// 3. 事务所一体化工作台 (Office — 补齐原先不可见的各国情报表)
// ============================================================================
export async function runDomOfficeWorkbench(office: any): Promise<void> {
  const b = office.b, c = office.c, m = office.m, g = m.globals, codec = c.codec;
  const portName = decodeCleanCstr(codec, m.port(b.port).nameBytes);
  const tabLabels = [...UI_STR.officeTabs];
  const nationNames = office.nations.slice(0, 6).map((raw: Uint8Array) => decodeCleanCstr(codec, raw).replace(/\s+/g, ""));
  const initGreet = capMsg(c, 0x55);

  let tab = 0; // 0: 工作介绍, 1: 各国情报
  let selNation = 0;
  let paidNation = -1;
  let notice = initGreet;

  for (;;) {
    let pickJobIdx = -1;
    let askJobHint = false;

    await new Promise<void>(resolve => {
      let settled = false;

      const done = () => {
        if (settled) return;
        settled = true;
        shell.h.close();
        resolve();
      };

      const shell = createWorkbenchShell(`${portName} · 事务所`, b.money, done, getBuildingArtUrl(c, 6, b.p));

      const render = () => preserveScroll(shell.h.body, () => {
        shell.moneyPill.textContent = fmtMoneyPill(b.money);
        shell.toastEl.textContent = notice;

        shell.toolbar.innerHTML = "";
        tabLabels.forEach((lbl: string, idx: number) => {
          const btn = document.createElement("button");
          btn.className = `uw2-btn uw2-tab-btn ${tab === idx ? "active" : ""}`;
          btn.textContent = lbl;
          btn.addEventListener("click", () => { tab = idx; render(); });
          shell.toolbar.appendChild(btn);
        });

        shell.h.body.innerHTML = "";
        const split = document.createElement("div");
        split.className = "uw2-split";

        const left = document.createElement("div");
        left.className = "uw2-pane";
        const right = document.createElement("div");
        right.className = "uw2-pane";

        if (tab === 0) {
          const lt = document.createElement("div");
          lt.className = "uw2-pane-title";
          lt.textContent = "委托列表";
          left.appendChild(lt);

          const rt = document.createElement("div");
          rt.className = "uw2-pane-title";
          rt.textContent = "委托状态";
          right.appendChild(rt);

          const box = document.createElement("div");
          box.className = "uw2-action-box";

          const wk = getWorkState(m);
          if (g.commonChap) {
            const p = document.createElement("div");
            p.style.cssText = "font-size:14px;color:var(--uw2-ink);line-height:1.6;";
            if (plS16(wk.curKind) < 6) {
              const tp = wk.targetPort & 0xff;
              p.textContent = tp === b.port ? capMsg(c, 0x3a3) : capMsg(c, 0x152, office.portName(tp));
            } else {
              p.textContent = "当前已有正在执行的委托。";
              const hintBtn = document.createElement("button");
              hintBtn.className = "uw2-btn uw2-btn-primary";
              hintBtn.style.alignSelf = "flex-start";
              hintBtn.textContent = "询问委托线索";
              hintBtn.addEventListener("click", () => { askJobHint = true; done(); });
              box.append(p, hintBtn);
            }
            if (!box.contains(p)) box.appendChild(p);
            const empty = document.createElement("div");
            empty.className = "uw2-empty";
            empty.textContent = "请先完成当前委托";
            left.appendChild(empty);
          } else if ((wk.flags & 3) === 3) {
            const msg = toSimp(captureConsoleText(c, () => {
              c.message(0x19a + (m.heroPerson().face & 0x0f));
              c.message(0x3a4);
            }).trim());
            const p = document.createElement("div");
            p.style.cssText = "font-size:14px;color:var(--uw2-ink);";
            p.textContent = msg;
            box.appendChild(p);
          } else {
            const list = document.createElement("div");
            list.className = "uw2-list-col";
            for (let i = 0; i < 3; i++) {
              const k = wk.kindAt(i) & 0xff;
              const btn = document.createElement("button");
              btn.className = "uw2-row-card";
              btn.textContent = decodeCleanCstr(codec, office.jobs[k]);
              btn.addEventListener("click", () => { pickJobIdx = i; done(); });
              list.appendChild(btn);
            }
            left.appendChild(list);
            const tip = document.createElement("div");
            tip.style.cssText = "font-size:14px;color:var(--uw2-ink-muted);";
            tip.textContent = initGreet;
            box.appendChild(tip);
          }
          right.appendChild(box);
        } else {
          const lt = document.createElement("div");
          lt.className = "uw2-pane-title";
          lt.textContent = "选择国家（100 金币）";
          left.appendChild(lt);

          const list = document.createElement("div");
          list.className = "uw2-list-col";
          nationNames.forEach((nn: string, idx: number) => {
            const btn = document.createElement("button");
            btn.className = `uw2-row-card ${idx === selNation ? "selected" : ""}`;
            btn.textContent = nn;
            btn.addEventListener("click", () => { selNation = idx; render(); });
            list.appendChild(btn);
          });
          left.appendChild(list);

          const rt = document.createElement("div");
          rt.className = "uw2-pane-title";
          rt.textContent = `${nationNames[selNation]} · 国家情报`;
          right.appendChild(rt);

          const box = document.createElement("div");
          box.className = "uw2-action-box";

          if (paidNation !== selNation) {
            const p = document.createElement("div");
            p.style.cssText = "font-size:14px;color:var(--uw2-ink);";
            p.textContent = capMsg(c, 0x56);
            const payBtn = document.createElement("button");
            payBtn.className = "uw2-btn uw2-btn-primary";
            payBtn.style.alignSelf = "flex-start";
            payBtn.textContent = "支付 100 金币查看情报";
            payBtn.addEventListener("click", () => {
              if (b.money < 100) { notice = capMsg(c, 0xa3); render(); return; }
              b.money = (b.money - 100) | 0;
              b.p.panels();
              paidNation = selNation;
              render();
            });
            box.append(p, payBtn);
          } else {
            const country = m.country(selNation);
            const ce = getCountryExtra(country);
            const hd = m.heroInfo();
            const standing = hd.getCountryStanding(selNation);
            const contrib = 100 - standing;
            const rival = ce.rival;
            const keyPortId = ce.keyPort;
            const keyPort = decodeCleanCstr(codec, office.portName(keyPortId));
            const rivalTxt = rival < 7
              ? capMsg(c, 0x58, office.nations[selNation], office.nations[rival])
              : capMsg(c, 0x355, office.nations[selNation]);
            const portTxt = capMsg(c, 0x59, office.portName(keyPortId));

            const top = document.createElement("div");
            top.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;";
            top.innerHTML =
              `<div>国力收益：<strong>${country.power}</strong></div>` +
              `<div>贡献度：<strong style="color:${standing < 100 ? "#b83d3d" : "#247544"};">${standing < 100 ? "-" : ""}${Math.abs(plS16(contrib))}</strong></div>` +
              `<div style="grid-column:1/-1;color:var(--uw2-ink-muted);">${rivalTxt} ${portTxt}（${keyPort}）</div>`;
            box.appendChild(top);

            const relList = document.createElement("div");
            relList.className = "uw2-list-col";
            for (let i = 0; i < 6; i++) {
              if (i === selNation) continue;
              const rel = country.getRelations(i);
              const diff = plS16(0x1e - rel);
              const treaty = country.getTreaties(i);
              const tags: string[] = [];
              if (treaty & TreatyFlag.ALLY) tags.push("同盟");
              if (treaty & TreatyFlag.BLOCKADE) tags.push("封锁");
              const row = document.createElement("div");
              row.className = "uw2-slot-card";
              row.innerHTML =
                `<span style="font-weight:700;min-width:90px;">${nationNames[i]}</span>` +
                `<span style="font-size:13px;color:${rel < 0x1e ? "#b83d3d" : "#247544"};">友好度 ${rel < 0x1e ? "-" : ""}${Math.abs(diff)}</span>` +
                `<span style="font-size:12px;color:#7c5216;font-weight:700;">${tags.join(" · ") || "普通"}</span>`;
              relList.appendChild(row);
            }
            box.appendChild(relList);
          }
          right.appendChild(box);
        }

        split.append(left, right);
        shell.h.body.appendChild(split);
      });

      render();
    });

    if (askJobHint) {
      await office.jobHint();
      b.after();
      continue;
    }
    if (pickJobIdx >= 0) {
      const wk = getWorkState(m);
      const k = wk.kindAt(pickJobIdx) & 0xff;
      g.commonSec = (k + 1) & 0xff;
      setWorkCurParam(m, wk.paramAt(pickJobIdx));
      if (await office.event(6)) g.commonChap = getWorkState(m).curKind & 0xff;
      g.commonSec = 0;
      b.after();
      continue;
    }
    break;
  }
}

// ============================================================================
// 4. 旅馆一体化工作台 (Inn — 补齐原先不可见的海港支持度表)
// ============================================================================
export async function runDomInnWorkbench(b: any): Promise<void> {
  const c = b.c, m = b.st.model, codec = c.codec, art = c.art;
  const portName = decodeCleanCstr(codec, m.port(b.port).nameBytes);
  const tabLabels = [...UI_STR.innTabs];
  let isCapital = false;
  for (let i = 0; i < WorldConst.TOTAL_COUNTRIES; i++) if (m.country(i).capitalPort === b.port) isCapital = true;
  const initGreet = capMsg(c, 0x42);

  let tab = 0;
  let notice = initGreet;

  for (;;) {
    let talkTarget = -1;
    let doSleep = false;

    await new Promise<void>(resolve => {
      let settled = false;

      const done = () => {
        if (settled) return;
        settled = true;
        shell.h.close();
        resolve();
      };

      const shell = createWorkbenchShell(`${portName} · 旅馆`, b.money, done, getBuildingArtUrl(c, 4, b.p));

      const render = () => preserveScroll(shell.h.body, () => {
        shell.moneyPill.textContent = fmtMoneyPill(b.money);
        shell.toastEl.textContent = notice;

        shell.toolbar.innerHTML = "";
        tabLabels.forEach((lbl: string, idx: number) => {
          const btn = document.createElement("button");
          btn.className = `uw2-btn uw2-tab-btn ${tab === idx ? "active" : ""}`;
          btn.disabled = idx === 1 && isCapital;
          btn.textContent = lbl;
          btn.addEventListener("click", () => { tab = idx; render(); });
          shell.toolbar.appendChild(btn);
        });

        shell.h.body.innerHTML = "";

        if (tab === 0) {
          const n = b.portPersons();
          const hasPeople = n > 0 && c.persons[0] !== 0xff;
          const pane = document.createElement("div");
          pane.className = "uw2-pane";
          const pt = document.createElement("div");
          pt.className = "uw2-pane-title";
          pt.textContent = "在港航海者";
          pane.appendChild(pt);

          if (!hasPeople) {
            const box = document.createElement("div");
            box.className = "uw2-action-box";
            box.textContent = n === 0 ? capMsg(c, 0x43) : capMsg(c, 0x44);
            pane.appendChild(box);
          } else {
            const grid = document.createElement("div");
            grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;";
            for (let i = 0; i < n; i++) {
              const pid = c.persons[i] & 0xff;
              const pv = m.person(pid);
              const rec = personRawBytes(pv);
              const nm = `${decodeCleanCstr(codec, pv.givenNameBytes)} ${decodeCleanCstr(codec, pv.familyNameBytes)}`.trim();
              const card = document.createElement("button");
              card.className = "uw2-row-card";
              card.style.cssText = "display:flex;align-items:center;gap:10px;text-align:left;";
              const img = document.createElement("img");
              img.className = "uw2-portrait-img";
              img.style.cssText = "width:44px;height:55px;flex-shrink:0;";
              void getPersonPortraitSrc(art, rec).then(src => { if (src) img.src = src; });
              const sp = document.createElement("span");
              sp.style.fontWeight = "700";
              sp.textContent = nm;
              card.append(img, sp);
              card.addEventListener("click", () => { talkTarget = pid; done(); });
              grid.appendChild(card);
            }
            pane.appendChild(grid);
          }
          shell.h.body.appendChild(pane);
        } else if (tab === 1) {
          const eco = m.portEconomy(b.port);
          const allyIdx = m.port(b.port).region & WorldConst.PORT_OWNER_MASK;

          const pane = document.createElement("div");
          pane.className = "uw2-pane";
          const pt = document.createElement("div");
          pt.className = "uw2-pane-title";
          pt.textContent = "各国海港支持度";
          pane.appendChild(pt);

          const box = document.createElement("div");
          box.className = "uw2-action-box";
          for (let i = 0; i < WorldConst.TOTAL_COUNTRIES; i++) {
            const pct = eco.getInfluence(i);
            const nn = decodeCleanCstr(codec, b.p.nations[i]);
            const row = document.createElement("div");
            row.style.cssText = "display:flex;flex-direction:column;gap:4px;";
            row.innerHTML =
              `<div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;">` +
                `<span>${nn}${allyIdx === i ? " ★ 同盟港" : ""}</span>` +
                `<span>${pct}%</span>` +
              `</div>` +
              `<div class="uw2-bar-track"><div class="uw2-bar-fill ${allyIdx === i ? "" : "green"}" style="width:${Math.min(100, pct)}%"></div></div>`;
            box.appendChild(row);
          }
          pane.appendChild(box);
          shell.h.body.appendChild(pane);
        } else {
          const box = document.createElement("div");
          box.className = "uw2-action-box";
          const btn = document.createElement("button");
          btn.className = "uw2-btn uw2-btn-primary";
          btn.style.alignSelf = "flex-start";
          btn.textContent = tabLabels[2] || "就寝";
          btn.addEventListener("click", () => { doSleep = true; done(); });
          box.append(btn);
          shell.h.body.appendChild(box);
        }
      });

      render();
    });

    if (talkTarget >= 0) {
      b.talkPerson(talkTarget);
      await b.innTalk(talkTarget);
      await b.closeTalk();
      b.after();
      continue;
    }
    if (doSleep) {
      await b.innSleep();
      return;
    }
    break;
  }
}

// ============================================================================
// 5. 教会 / 清真寺一体化工作台 (Church)
// ============================================================================
export function runDomChurchWorkbench(b: any, base: number): Promise<void> {
  const c = b.c, m = b.st.model, codec = c.codec;
  const portName = decodeCleanCstr(codec, m.port(b.port).nameBytes);
  const tabLabels = [...UI_STR.churchTabs];
  const initGreet = capMsg(c, base + 0x5b);

  return new Promise(resolve => {
    let settled = false;
    let tab = 0;
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

    const shell = createWorkbenchShell(`${portName} · ${b.mosque ? "清真寺" : "教会"}`, b.money, done, getBuildingArtUrl(c, 10, b.p));

    const render = () => preserveScroll(shell.h.body, () => {
      shell.moneyPill.textContent = fmtMoneyPill(b.money);
      shell.toastEl.textContent = notice;

      shell.toolbar.innerHTML = "";
      tabLabels.forEach((lbl: string, idx: number) => {
        const btn = document.createElement("button");
        btn.className = `uw2-btn uw2-tab-btn ${tab === idx ? "active" : ""}`;
        btn.textContent = lbl;
        btn.addEventListener("click", () => { tab = idx; render(); });
        shell.toolbar.appendChild(btn);
      });

      shell.h.body.innerHTML = "";
      const box = document.createElement("div");
      box.className = "uw2-action-box";

      if (tab === 0) {
        const p = document.createElement("div");
        p.style.cssText = "font-size:14px;color:var(--uw2-ink);";
        p.textContent = notice || capMsg(c, base + 0x5b);
        const btn = document.createElement("button");
        btn.className = "uw2-btn uw2-btn-primary";
        btn.style.alignSelf = "flex-start";
        btn.textContent = tabLabels[0] || "祈祷";
        btn.addEventListener("click", () => {
          if (b.worship) {
            const hero = m.heroPerson();
            const v = c.sys.rng.random(2) + hero.getStats(7);
            hero.setStats(7, Math.min(100, v));
            b.worship = 0;
          }
          notice = capMsg(c, base + 0x5c);
          render();
        });
        box.append(p, btn);
      } else {
        const max = b.money;
        if (amt > max) amt = max;
        const p = document.createElement("div");
        p.style.cssText = "font-size:14px;color:var(--uw2-ink);";
        p.textContent = capMsg(c, base + 0x5d);

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

        const sync = (v: number) => {
          amt = Math.max(0, Math.min(max, Math.trunc(v || 0)));
          numInp.value = String(amt);
          slider.value = String(amt);
        };
        numInp.addEventListener("input", () => sync(Number(numInp.value)));
        slider.addEventListener("input", () => sync(Number(slider.value)));

        const btn = document.createElement("button");
        btn.className = "uw2-btn uw2-btn-primary";
        btn.style.alignSelf = "flex-start";
        btn.textContent = `确认${tabLabels[1] || "捐款"}`;
        btn.addEventListener("click", () => {
          if (amt <= 0 || amt > b.money) return;
          const ratio = Math.trunc(b.money / amt) | 0;
          if (ratio > 10) {
            notice = capMsg(c, base + 0x5e);
          } else {
            notice = capMsg(c, base + 0x5f);
            const r = ((c.sys.rng.random(5) + 1) * 100) & 0xffff;
            if (amt >= r) {
              const hero = m.heroPerson();
              hero.setStats(7, Math.min(100, (hero.getStats(7) - ratio + 11) & 0xffff));
            }
          }
          b.money = (b.money - amt) | 0;
          amt = 0;
          b.p.panels();
          render();
        });
        box.append(p, numInp, slider, btn);
      }

      shell.h.body.appendChild(box);
    });

    render();
  });
}

// ============================================================================
// 6. 占卜师一体化工作台 (Fortune)
// ============================================================================
export function runDomFortuneWorkbench(b: any): Promise<void> {
  const c = b.c, m = b.st.model, codec = c.codec;
  const portName = decodeCleanCstr(codec, m.port(b.port).nameBytes);
  const tabLabels = [...UI_STR.fortuneTabs];
  const initGreet = capMsg(c, 0x12a);

  const expNeed = (lv: number) => { const m = Math.min(lv, 0x12); return (m * m * 30) & 0xffff; };

  return new Promise(resolve => {
    let settled = false;
    let tab = 0;
    let selCrew = 0;
    let reading = "";
    let notice = initGreet;

    const done = () => {
      if (settled) return;
      settled = true;
      shell.h.close();
      b.p.panels();
      b.after();
      resolve();
    };

    const shell = createWorkbenchShell(`${portName} · 占卜师`, b.money, done, getBuildingArtUrl(c, 11, b.p));

    const render = () => preserveScroll(shell.h.body, () => {
      shell.moneyPill.textContent = fmtMoneyPill(b.money);
      shell.toastEl.textContent = notice;

      const crewN = b.crewCount();
      const crewIds = Array.from({ length: crewN }, (_, i) => c.persons[i] & 0xff);
      if (selCrew >= crewIds.length) selCrew = 0;

      shell.toolbar.innerHTML = "";
      tabLabels.forEach((lbl: string, idx: number) => {
        const btn = document.createElement("button");
        btn.className = `uw2-btn uw2-tab-btn ${tab === idx ? "active" : ""}`;
        btn.disabled = (idx === 3 && crewN === 0) || (idx === 2 && m.globals.hero === 1);
        btn.textContent = lbl;
        btn.addEventListener("click", () => { tab = idx; reading = ""; render(); });
        shell.toolbar.appendChild(btn);
      });

      shell.h.body.innerHTML = "";
      const box = document.createElement("div");
      box.className = "uw2-action-box";

      if (tab === 3 && crewIds.length) {
        const list = document.createElement("div");
        list.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;";
        crewIds.forEach((pid, idx) => {
          const pv = m.person(pid);
          const nm = `${decodeCleanCstr(codec, pv.givenNameBytes)} ${decodeCleanCstr(codec, pv.familyNameBytes)}`.trim();
          const cb = document.createElement("button");
          cb.className = `uw2-btn ${idx === selCrew ? "active" : ""}`;
          cb.textContent = nm;
          cb.addEventListener("click", () => { selCrew = idx; render(); });
          list.appendChild(cb);
        });
        box.appendChild(list);
      }

      const ask = document.createElement("div");
      ask.style.cssText = "font-size:14px;color:var(--uw2-ink);";
      ask.textContent = capMsg(c, 0x12b);
      box.appendChild(ask);

      const btn = document.createElement("button");
      btn.className = "uw2-btn uw2-btn-primary";
      btn.style.alignSelf = "flex-start";
      btn.textContent = `占卜「${tabLabels[tab]}」（50 金币）`;
      btn.addEventListener("click", () => {
        if (b.money < 0x32) { notice = capMsg(c, 0x12c); render(); return; }
        b.money = (b.money - 0x32) | 0;
        b.p.panels();
        notice = capMsg(c, 0x12d);
        if (tab === 0) {
          reading = capMsg(c, Math.trunc(m.heroPerson().getStats(7) / 25) + 0x12e);
        } else if (tab === 1) {
          const hero = m.heroPerson(), hd = m.heroInfo();
          const lines = [
            capMsg(c, 0x221, (expNeed(hero.navLevel) - hero.navExp) << 16 >> 16),
            capMsg(c, 0x222, (expNeed(hero.battleLevel) - hero.battleExp) << 16 >> 16),
          ];
          if ((hero.face & 15) !== 6) {
            const fame = Math.max(hd.tradeFame, hd.pirateFame, hd.adventureFame);
            const need = b.p.P.data.titleFame[hd.rank];
            lines.push(need > fame ? capMsg(c, 0x223, (need - fame) & 0xffff) : capMsg(c, 0x2f2));
          }
          reading = lines.join("\n");
        } else if (tab === 2) {
          let foundGirl = null;
          for (let i = 0; i < 30; i++) {
            const bm = m.barmaid(i);
            if (bm.port === b.port && (bm.flags & 8) && !(bm.flags & 0x40)) { foundGirl = bm; break; }
          }
          if (!foundGirl) reading = capMsg(c, 0x149);
          else if (foundGirl.affection >= 80) reading = capMsg(c, 0x146, foundGirl.nameBytes);
          else reading = capMsg(c, foundGirl.affection >= 50 ? 0x147 : 0x148);
        } else if (crewIds.length) {
          const pv = m.person(crewIds[selCrew]);
          reading = [
            capMsg(c, 0x4e + Math.trunc(pv.getStats(7) / 25)),
            capMsg(c, 0x319 + Math.trunc(pv.loyalty / 25)),
          ].join("\n");
        }
        render();
      });
      box.appendChild(btn);

      if (reading) {
        const resEl = document.createElement("div");
        resEl.style.cssText = "white-space:pre-line;font-size:14px;line-height:1.75;color:var(--uw2-ink);padding:10px 12px;border-radius:8px;background:rgba(255,252,242,0.82);border:1px solid rgba(154,119,56,0.34);";
        resEl.textContent = reading;
        box.appendChild(resEl);
      }

      shell.h.body.appendChild(box);
    });

    render();
  });
}

// ============================================================================
// 7. 酒馆一体化工作台 (Tavern — 与交易所 / 码头 / 道具店 / 王宫 1:1 统一结构)
// ============================================================================
export async function runDomTavernWorkbench(b: any, drinkNameBytes: Uint8Array, onGamble: () => Promise<void>): Promise<void> {
  const c = b.c, m = b.st.model, codec = c.codec, art = c.art;
  const portName = decodeCleanCstr(codec, m.port(b.port).nameBytes);
  const tabLabels = [...UI_STR.tavernTabs];
  const drinkName = decodeCleanCstr(codec, drinkNameBytes);
  const k = m.portEconomy(b.port).liquor;
  const drinkPrice = b.T.liquorPrice[k];
  const initGreet = capMsg(c, 0x12, drinkNameBytes);

  let tab = 2;
  if (b.fleetShips() && !(m.globals.dailyFlags & 1)) tab = 0;
  let rounds = 1;
  let notice = initGreet;
  const hireAdds = new Map<number, number>();
  const dismissSubs = new Map<number, number>();

  for (;;) {
    let pending: null | { kind: "drink" | "chat" | "girl" | "gamble"; arg?: number } = null;

    await new Promise<void>(resolve => {
      let settled = false;

      const done = () => {
        if (settled) return;
        settled = true;
        shell.h.close();
        resolve();
      };

      const shell = createWorkbenchShell(`${portName} · 酒馆`, b.money, done, getBuildingArtUrl(c, 1, b.p));

      const renderCrewAllocator = (isHire: boolean, hiredToday: boolean) => {
        const nShips = b.fleetShips();
        const ships = Array.from({ length: nShips }, (_, i) => {
          const slot = c.persons[i] & 0xff;
          const slotView = heroOrDockSlot(m, slot);
          const cs = m.crewSlot(slot);
          const ship = m.ship(slotView.ship);
          const stype = m.shipType(ship.type);
          const cap = decodeCleanCstr(codec, m.person(cs.captain).givenNameBytes);
          return { slot, slotView, cs, ship, stype, cap, cur: slotView.crew, room: Math.max(0, ship.maxCrew - slotView.crew) };
        });

        const eco0 = m.portEconomy(b.port).commerce;
        const A = b.tvA;
        const apps = Math.trunc(((A * eco0) >>> 0) / 500) & 0xffff;
        const rank = m.heroInfo().rank;
        const si = plUmin(((rank + 1) * A) & 0xffff, apps);
        const wage = Math.trunc(eco0 / 20) + 5;
        const totalRoom = ships.reduce((acc, s) => acc + s.room, 0);
        const byMoney = Math.trunc(b.money / wage) & 0xffff;
        const lim = isHire && !hiredToday && b.money >= 10 ? plUmin(plUmin(byMoney, si), totalRoom) : 0;

        const draftMap = isHire ? hireAdds : dismissSubs;
        let running = 0;
        for (const s of ships) {
          const rawMax = isHire ? Math.max(0, Math.min(s.room, lim - running)) : s.cur;
          const clamped = Math.max(0, Math.min(rawMax, Math.trunc(draftMap.get(s.slot) || 0)));
          if (clamped > 0) draftMap.set(s.slot, clamped);
          else draftMap.delete(s.slot);
          running += clamped;
        }

        const wrap = document.createElement("div");
        wrap.className = "uw2-pane";

        const headBox = document.createElement("div");
        headBox.className = "uw2-action-box";

        if (isHire && !hiredToday) {
          const msgEl = document.createElement("div");
          msgEl.className = "uw2-speech-box";
          if (totalRoom === 0) msgEl.textContent = capMsg(c, 0x1d);
          else if (b.money < 10) msgEl.textContent = capMsg(c, 0x1e);
          else {
            const countLine = capMsg(c, si >= 0x14 ? 0x79 : si > 0 ? 0x7a : 0x7b, si);
            const warn = A < 0x1e ? `${capMsg(c, 0x1f)} ` : "";
            msgEl.textContent = `${warn}${countLine} ${capMsg(c, 0x7c, wage)} ${capMsg(c, 0x7d, lim)}`.trim();
          }
          headBox.appendChild(msgEl);
        }

        const summaryBar = document.createElement("div");
        summaryBar.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:space-between;";
        const totalBadge = document.createElement("span");
        totalBadge.style.cssText = "font-size:14px;font-weight:700;color:var(--uw2-ink);";
        const btnBar = document.createElement("div");
        btnBar.style.cssText = "display:flex;align-items:center;gap:8px;margin-left:auto;";

        const fillAllBtn = document.createElement("button");
        if (isHire) {
          fillAllBtn.className = "uw2-step-btn";
          fillAllBtn.disabled = lim <= 0;
          fillAllBtn.textContent = "最大";
          btnBar.appendChild(fillAllBtn);
        }

        const clearBtn = document.createElement("button");
        clearBtn.className = "uw2-step-btn";
        clearBtn.textContent = "0";

        const commitBtn = document.createElement("button");
        commitBtn.className = "uw2-btn uw2-btn-primary";
        commitBtn.textContent = tabLabels[isHire ? 0 : 1] || (isHire ? "水手雇用" : "水手解雇");

        btnBar.append(clearBtn, commitBtn);
        summaryBar.append(totalBadge, btnBar);
        headBox.appendChild(summaryBar);
        wrap.appendChild(headBox);

        const list = document.createElement("div");
        list.className = "uw2-list-col";
        list.style.maxHeight = "330px";

        const rowSyncs: (() => void)[] = [];
        const getTotalSelected = () => ships.reduce((acc, s) => acc + (draftMap.get(s.slot) || 0), 0);
        const syncAll = () => {
          const total = getTotalSelected();
          totalBadge.textContent = isHire
            ? `+${total}（${(total * wage).toLocaleString()}）`
            : `-${total}`;
          clearBtn.disabled = total <= 0;
          commitBtn.disabled = total <= 0 || (isHire && lim <= 0);
          rowSyncs.forEach(fn => fn());
        };

        for (const s of ships) {
          const rowMax = isHire ? Math.min(s.room, lim) : s.cur;
          const card = document.createElement("div");
          card.className = "uw2-slot-card";
          card.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;";

          const leftInfo = document.createElement("div");
          leftInfo.style.cssText = "display:flex;align-items:center;gap:10px;min-width:240px;flex:1;";
          const shipImgUrl = art?.shipUrl?.(s.ship.type);
          if (shipImgUrl) {
            const img = document.createElement("img");
            img.src = shipImgUrl;
            img.style.cssText = "width:56px;height:42px;object-fit:contain;border-radius:6px;border:1px solid rgba(154,119,56,0.35);background:#1b2a40;flex-shrink:0;";
            leftInfo.appendChild(img);
          }
          const txt = document.createElement("div");
          txt.style.cssText = "display:flex;flex-direction:column;gap:2px;";
          const titleLine = document.createElement("div");
          titleLine.style.cssText = "font-weight:700;font-size:14px;color:var(--uw2-ink);";
          titleLine.textContent = `${decodeCleanCstr(codec, s.ship.nameBytes)}（船长 ${s.cap}）`;
          const metaLine = document.createElement("div");
          metaLine.style.cssText = "font-size:12px;color:var(--uw2-ink-muted);";
          txt.append(titleLine, metaLine);
          leftInfo.appendChild(txt);

          const ctrl = document.createElement("div");
          ctrl.className = "uw2-step-row";
          ctrl.style.flexWrap = "nowrap";

          const slider = document.createElement("input");
          slider.type = "range";
          slider.min = "0";
          slider.max = String(rowMax);
          slider.value = String(draftMap.get(s.slot) || 0);
          slider.style.width = "120px";
          slider.disabled = rowMax <= 0;

          const deltaBadge = document.createElement("span");
          deltaBadge.style.cssText = "min-width:46px;text-align:right;font-weight:700;font-size:13px;font-variant-numeric:tabular-nums;";

          const setSlotDelta = (desired: number) => {
            const curTotal = getTotalSelected();
            const prevVal = draftMap.get(s.slot) || 0;
            const avail = isHire ? Math.min(s.room, Math.max(0, lim - (curTotal - prevVal))) : s.cur;
            const nextVal = Math.max(0, Math.min(avail, Math.trunc(desired) || 0));
            if (nextVal > 0) draftMap.set(s.slot, nextVal);
            else draftMap.delete(s.slot);
            syncAll();
          };

          slider.addEventListener("input", () => setSlotDelta(Number(slider.value)));

          const stepBtns: HTMLButtonElement[] = [];
          for (const [lb, delta] of [["-5", -5], ["-1", -1], ["+1", 1], ["+5", 5]] as const) {
            const sb = document.createElement("button");
            sb.className = "uw2-step-btn";
            sb.textContent = lb;
            sb.addEventListener("click", () => setSlotDelta((draftMap.get(s.slot) || 0) + delta));
            stepBtns.push(sb);
          }
          const maxBtn = document.createElement("button");
          maxBtn.className = "uw2-step-btn";
          maxBtn.textContent = isHire ? "满" : "全";
          maxBtn.addEventListener("click", () => setSlotDelta(rowMax));

          rowSyncs.push(() => {
            const v = draftMap.get(s.slot) || 0;
            const nextCrew = isHire ? s.cur + v : s.cur - v;
            const nextMorale = isHire
              ? (v > 0 && nextCrew > 0 ? Math.trunc((v * 0x3c + s.cs.morale * s.cur) / nextCrew) : s.cs.morale)
              : (nextCrew === 0 ? 0 : s.cs.morale);
            metaLine.textContent = v > 0
              ? `水手 ${s.cur} → ${nextCrew}/${s.ship.maxCrew} (必要 ${s.stype.minCrew}) · 士气 ${s.cs.morale} → ${nextMorale}`
              : `水手 ${s.cur}/${s.ship.maxCrew} (必要 ${s.stype.minCrew}) · 士气 ${s.cs.morale}`;
            slider.value = String(v);
            deltaBadge.textContent = v > 0 ? (isHire ? `+${v}` : `-${v}`) : "0";
            deltaBadge.style.color = v > 0 ? (isHire ? "#247544" : "#a13626") : "var(--uw2-ink-muted)";
            const avail = isHire ? Math.min(s.room, Math.max(0, lim - (getTotalSelected() - v))) : s.cur;
            stepBtns[0].disabled = v <= 0;
            stepBtns[1].disabled = v <= 0;
            stepBtns[2].disabled = v >= avail;
            stepBtns[3].disabled = v >= avail;
            maxBtn.disabled = avail <= 0 || v >= avail;
          });

          ctrl.append(slider, ...stepBtns, maxBtn, deltaBadge);
          card.append(leftInfo, ctrl);
          list.appendChild(card);
        }

        fillAllBtn.addEventListener("click", () => {
          hireAdds.clear();
          let leftLim = lim;
          // 优先补足未达到最低必要人数的船只，再按顺序补满其余空位
          for (const pass of [0, 1]) {
            for (const s of ships) {
              if (leftLim <= 0) break;
              const prev = hireAdds.get(s.slot) || 0;
              const need = pass === 0 ? Math.max(0, s.stype.minCrew - (s.cur + prev)) : Math.max(0, s.room - prev);
              const take = Math.min(leftLim, need);
              if (take > 0) {
                hireAdds.set(s.slot, prev + take);
                leftLim -= take;
              }
            }
          }
          syncAll();
        });

        clearBtn.addEventListener("click", () => {
          draftMap.clear();
          syncAll();
        });

        commitBtn.addEventListener("click", () => {
          const total = getTotalSelected();
          if (total <= 0) return;
          if (isHire) {
            if (hiredToday || total > lim) return;
            b.payMoney(((wage * total) << 16) >> 16);
            for (const s of ships) {
              const add = hireAdds.get(s.slot) || 0;
              if (add <= 0) continue;
              const old = (s.cur << 16) >> 16;
              s.slotView.crew = old + add;
              const now = (s.slotView.crew << 16) >> 16;
              if (old < now) s.cs.morale = Math.trunc(((now - old) * 0x3c + s.cs.morale * old) / now);
            }
            m.globals.dailyFlags |= 1;
            hireAdds.clear();
            b.p.panels();
            notice = `+${total}（${(total * wage).toLocaleString()} 金币）`;
          } else {
            for (const s of ships) {
              const sub = dismissSubs.get(s.slot) || 0;
              if (sub <= 0) continue;
              s.slotView.crew = Math.max(0, s.cur - sub);
              if (!s.slotView.crew) s.cs.morale = 0;
            }
            dismissSubs.clear();
            b.p.panels();
            notice = `-${total}`;
          }
          render();
        });

        syncAll();
        wrap.appendChild(list);
        return wrap;
      };

      const render = () => preserveScroll(shell.h.body, () => {
        shell.moneyPill.textContent = fmtMoneyPill(b.money);
        shell.toastEl.textContent = notice;

        const hasFleet = b.fleetShips() > 0;
        const hiredToday = !!(m.globals.dailyFlags & 1);
        const hasGirl = !!b.girl;

        shell.toolbar.innerHTML = "";
        tabLabels.forEach((lbl: string, idx: number) => {
          const btn = document.createElement("button");
          btn.className = `uw2-btn uw2-tab-btn ${tab === idx ? "active" : ""}`;
          btn.disabled =
            (idx === 0 && (hiredToday || !hasFleet)) ||
            (idx === 1 && !hasFleet) ||
            (idx === 4 && !hasGirl);
          btn.textContent = lbl;
          btn.addEventListener("click", () => { tab = idx; render(); });
          shell.toolbar.appendChild(btn);
        });

        shell.h.body.innerHTML = "";

        if (tab === 0 || tab === 1) {
          shell.h.body.appendChild(renderCrewAllocator(tab === 0, hiredToday));
        } else if (tab === 2) {
          const box = document.createElement("div");
          box.className = "uw2-action-box";
          let si = (b.money % 10000) & 0xffff;
          if (b.money >= 10000) si = (si + 10000) & 0xffff;
          const maxRounds = Math.min(50, Math.trunc(domS16(si) / drinkPrice));
          if (rounds > maxRounds) rounds = Math.max(0, maxRounds);

          const p = document.createElement("div");
          p.style.cssText = "font-size:14px;color:var(--uw2-ink);";
          p.textContent = capMsg(c, 0x13, b.T.liquors[k], drinkPrice);

          const row = document.createElement("div");
          row.style.cssText = "display:flex;align-items:center;gap:12px;";
          const slider = document.createElement("input");
          slider.type = "range";
          slider.className = "uw2-slider";
          slider.style.flex = "1";
          slider.min = "0";
          slider.max = String(maxRounds);
          slider.value = String(rounds);
          const badge = document.createElement("span");
          badge.style.cssText = "font-size:14px;font-weight:700;min-width:110px;text-align:right;";
          const syncR = () => { badge.textContent = `${rounds} 杯（${rounds * drinkPrice} 金币）`; };
          slider.addEventListener("input", () => { rounds = Number(slider.value); syncR(); });
          syncR();
          row.append(slider, badge);

          const btn = document.createElement("button");
          btn.className = "uw2-btn uw2-btn-primary";
          btn.style.alignSelf = "flex-start";
          btn.disabled = maxRounds <= 0;
          btn.textContent = `请大家喝${drinkName}并打听传闻`;
          btn.addEventListener("click", () => {
            if (rounds <= 0) return;
            pending = { kind: "drink", arg: rounds };
            done();
          });

          box.append(p, row, btn);
          shell.h.body.appendChild(box);
        } else if (tab === 3) {
          const pane = document.createElement("div");
          pane.className = "uw2-pane";
          const pt = document.createElement("div");
          pt.className = "uw2-pane-title";
          pt.textContent = "酒馆内的航海者";
          pane.appendChild(pt);

          const n = b.tavernPersons();
          const hasPeople = n > 0 && c.persons[0] !== 0xff;
          if (!hasPeople) {
            const box = document.createElement("div");
            box.className = "uw2-action-box";
            box.textContent = "现在酒馆里没有可交谈的航海者。";
            pane.appendChild(box);
          } else {
            const grid = document.createElement("div");
            grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;";
            for (let i = 0; i < n; i++) {
              const pid = c.persons[i] & 0xff;
              const pv = m.person(pid);
              const rec = personRawBytes(pv);
              const nm = `${decodeCleanCstr(codec, pv.givenNameBytes)} ${decodeCleanCstr(codec, pv.familyNameBytes)}`.trim();
              const card = document.createElement("button");
              card.className = "uw2-row-card";
              card.style.cssText = "display:flex;align-items:center;gap:10px;text-align:left;";
              const img = document.createElement("img");
              img.className = "uw2-portrait-img";
              img.style.cssText = "width:44px;height:55px;flex-shrink:0;";
              void getPersonPortraitSrc(art, rec).then(src => { if (src) img.src = src; });
              const sp = document.createElement("span");
              sp.style.fontWeight = "700";
              sp.textContent = nm;
              card.append(img, sp);
              card.addEventListener("click", () => { pending = { kind: "chat", arg: pid }; done(); });
              grid.appendChild(card);
            }
            pane.appendChild(grid);
          }
          shell.h.body.appendChild(pane);
        } else if (tab === 4) {
          const box = document.createElement("div");
          box.className = "uw2-action-box";
          if (b.girl) {
            const girl = barmaidByAddr(m, b.girl);
            const face = girl.quest;
            const gName = decodeCleanCstr(codec, girl.nameBytes);
            const head = document.createElement("div");
            head.style.cssText = "display:flex;align-items:center;gap:14px;";
            const url = art?.portraitUrl?.(face);
            if (url) {
              const img = document.createElement("img");
              img.className = "uw2-portrait-img";
              img.src = url;
              head.appendChild(img);
            }
            const nm = document.createElement("div");
            nm.className = "uw2-detail-title";
            nm.textContent = gName;
            head.appendChild(nm);
            box.appendChild(head);

            const btn = document.createElement("button");
            btn.className = "uw2-btn uw2-btn-primary";
            btn.style.alignSelf = "flex-start";
            btn.textContent = `与${gName}交谈 / 送礼`;
            btn.addEventListener("click", () => { pending = { kind: "girl" }; done(); });
            box.appendChild(btn);
          }
          shell.h.body.appendChild(box);
        } else {
          const box = document.createElement("div");
          box.className = "uw2-action-box";
          const btn = document.createElement("button");
          btn.className = "uw2-btn uw2-btn-primary";
          btn.style.alignSelf = "flex-start";
          btn.textContent = tabLabels[5] || "赌博";
          btn.addEventListener("click", () => { pending = { kind: "gamble" }; done(); });
          box.append(btn);
          shell.h.body.appendChild(box);
        }
      });

      render();
    });

    if (!pending) break;
    const act: { kind: string; arg?: number } = pending;
    if (act.kind === "drink") {
      const v = act.arg ?? 1;
      const heat = Math.trunc(((v * 200) & 0xffff) / m.portEconomy(b.port).commerce);
      const d = Math.trunc(domS16(heat * m.heroPerson().getStats(6)) / 10) + b.tvA;
      b.tvA = Math.min(100, d);
      b.payMoney(domS16(drinkPrice * v));
      await b.rumor(heat);
    } else if (act.kind === "chat") {
      if (act.arg !== undefined) {
        const who = act.arg;
        b.mate = m.person(who).addr;
        b.talkPerson(who);
        b.mateNo = who;
        await b.chatMenu();
        await b.closeTalk();
      } else {
        await b.chat();
      }
    } else if (act.kind === "girl") await b.barGirl();
    else if (act.kind === "gamble") await onGamble();
    b.after();
  }
}

// ============================================================================
// 8. 造船厂一体化工作台 (Shipyard — 6 分页全部内置操作，零层叠弹窗)
// ============================================================================
export async function runDomShipyardWorkbench(b: any): Promise<void> {
  const c = b.c, m = b.st.model, codec = c.codec, art = c.art;
  const portName = decodeCleanCstr(codec, m.port(b.port).nameBytes);
  const tabLabels = [...UI_STR.shipyardTabs];
  const remodelLabels = [...UI_STR.remodelTabs];
  const initGreet = capMsg(c, 0x4d);

  // 依原版 rmFigure / rmGuns 规则：每次切换到「船首像」或「武装」子分页时都进行 1/20 稀有品判定（与原版反复进出子菜单刷彩蛋完全一致）
  const eco = m.portEconomy(b.port), ecoEx = getPortEcoExtra(eco), hero = m.heroPerson(), rng = c.sys.rng;
  let figCount = Math.min(8, Math.trunc(eco.commerce / 100) + 1);
  let gunCount = Math.min(6, Math.trunc(((eco.industry + eco.commerce) & 0xffff) / 200) + 1);
  let specialNotice = "";
  const rollFigureheads = () => {
    figCount = Math.min(8, Math.trunc(eco.commerce / 100) + 1);
    if (eco.industry > 800 && eco.commerce > 800 && hero.getStats(7) > 80 && !rng.random(20)) {
      figCount++;
      if (rng.random(hero.getStats(7)) >= 90) figCount++;
      specialNotice = capMsg(c, 0x10a);
      return true;
    }
    return false;
  };
  const rollGuns = () => {
    gunCount = Math.min(6, Math.trunc(((eco.industry + eco.commerce) & 0xffff) / 200) + 1);
    if (eco.industry > 900 && eco.commerce > 900 && hero.getStats(7) > 90 && !rng.random(20)) {
      gunCount++;
      specialNotice = capMsg(c, 0x10a);
      return true;
    }
    return false;
  };

  let tab = 0; // 0:造新船, 1:买旧船, 2:修理, 3:卖船, 4:改造, 5:工业投资
  let selIdx = 0;
  let rmSub = 0; // 0:船首像, 1:武装, 2:积载比例变更, 3:船名变更
  let selFig = 1;
  let selGun = 1;
  let gunQty = 1;
  let investAmt = 1000;
  let investReply = "";
  let replaceSlot = -1;
  let newMat = 0;
  let designCrew = -1;
  let designGuns = -1;
  let customShipName = "";
  let lastNameKey = "";
  let offerPrice = -1;
  let lastPriceKey = "";
  let haggleOpen = false;
  let haggleAccRand = 5;
  let notice = specialNotice || initGreet;

  const hexToU8 = (s: string) => Uint8Array.from([...(s.match(/../g) || []).map(h => parseInt(h, 16)), 0]);
  const matTab = (c.portAssets?.data?.build?.materials || []).map(hexToU8);
  const figTab = (c.portAssets?.data?.build?.figureheads || []).map(hexToU8);

  const encodeShipNameSafe = (txt: string, fallback: Uint8Array): Uint8Array => {
    const trimmed = txt.trim();
    if (!trimmed) return fallback;
    try {
      return c.font.encode(trimmed);
    } catch {
      return fallback;
    }
  };

  for (;;) {
    let pendingLeftovers: null | { goods: number[]; amt: number[] } = null;

    await new Promise<void>(resolve => {
      let settled = false;

      const done = () => {
        if (settled) return;
        settled = true;
        shell.h.close();
        resolve();
      };

      const shell = createWorkbenchShell(`${portName} · 造船厂`, b.money, done, getBuildingArtUrl(c, 2, b.p));

      const getFleetSlots = () => {
        const n = b.fleetShips();
        return Array.from({ length: n }, (_, i) => c.persons[i] & 0xff);
      };

      const getBuildableTypes = () => {
        const ind = eco.industry;
        const row = b.BT.levels[ecoEx.shipRegion];
        const out: number[] = [];
        for (let i = 0; i < 8; i++) {
          const t = row[i];
          if (t === GameConst.EMPTY_SLOT) break;
          if (((10 * m.shipType(t).shipClass) & 0xffff) <= ind) out.push(t);
        }
        return out;
      };

      const getUsedShips = () => {
        const cache = m.usedShipCache(0);
        const out: { cacheIdx: number; type: number }[] = [];
        for (let i = 0; i < 5; i++) {
          const t = cache.getShipTypes(i);
          if (t !== GameConst.EMPTY_SLOT) out.push({ cacheIdx: i, type: t });
        }
        return out;
      };

      const getFreeFleetSlot = () => {
        for (let i = 0; i < GameConst.FLEET_SHIPS; i++) {
          const f = b.slotState(i);
          if (f !== ShipSlotFlag.ACTIVE && f !== ShipSlotFlag.BUILDING) return i;
        }
        return -1;
      };

      const allocShipRecord = (slotIdx: number, typeId: number, tmpl: any, stype: any, isTrade: boolean, captainId: number, nameBytes: Uint8Array) => {
        const S = heroOrDockSlot(m, slotIdx), M = m.crewSlot(slotIdx);
        let n = 0;
        for (let i = 0; i < 0x28; i++) if (m.ship(i).type === GameConst.EMPTY_SLOT) { n = i; break; }
        const si = m.ship(n);
        si.maxGuns = stype.maxGuns;
        si.type = typeId;
        si.flags = tmpl.flags;
        si.maxCrew = tmpl.maxCrew;
        si.maxCargo = (stype.capacity - si.maxGuns - si.maxCrew) & 0xffff;
        const d = Math.trunc(9 * stype.durability / 10) & 0xffff;
        S.maxDurability = (d - Math.trunc((d & 0xff) / 15)) & 0xff;
        S.durability = S.maxDurability;
        S.turn = stype.turn;
        S.propulsion = stype.propulsion;
        S.guns = plUmin(S.guns, isTrade ? si.maxGuns : 0);
        S.crew = plUmin(S.crew, isTrade ? si.maxCrew : 0);
        S.ship = n;
        if (!isTrade) S.flags = ShipSlotFlag.ACTIVE;
        M.water = 0; M.food = 0; M.material = 0; M.ammo = 0;
        M.navRatio = 0x19; M.lookRatio = 0x32; M.captain = captainId;
        M.loadTotal = 0; M.figurehead = 0;
        for (let k = 0; k < GameConst.CARGO_SLOTS; k++) { M.setCargoGoods(k, GameConst.EMPTY_SLOT); M.setCargoAmts(k, 0); }
        writeShipName(si, nameBytes);
        return { S, M, si };
      };

      const renderShipHeader = (box: HTMLElement, shipType: number, titleText: string, subText: string) => {
        const head = document.createElement("div");
        head.style.cssText = "display:flex;align-items:center;gap:14px;";
        const url = art?.shipUrl?.(shipType);
        if (url) {
          const img = document.createElement("img");
          img.src = url;
          img.style.cssText = "width:112px;height:84px;object-fit:contain;border-radius:8px;border:1px solid rgba(154,119,56,0.4);background:#1b2a40;";
          head.appendChild(img);
        }
        const meta = document.createElement("div");
        meta.style.cssText = "display:flex;flex-direction:column;gap:4px;";
        meta.innerHTML =
          `<div class="uw2-detail-title">${titleText}</div>` +
          `<div style="font-size:13px;color:var(--uw2-ink-muted);">${subText}</div>`;
        head.appendChild(meta);
        box.appendChild(head);
      };

      const mountDesignControls = (box: HTMLElement, stype: any, initCrew?: number, initGuns?: number) => {
        const maxCrewCap = stype.maxCrewDiv10 * 10;
        if (designCrew < stype.minCrew || designCrew > maxCrewCap) {
          designCrew = Math.max(stype.minCrew, Math.min(maxCrewCap, initCrew ?? stype.minCrew));
        }
        const maxGunsAllow = Math.max(0, Math.min(stype.maxGuns, stype.capacity - designCrew));
        if (designGuns < 0 || designGuns > maxGunsAllow) {
          designGuns = Math.max(0, Math.min(maxGunsAllow, initGuns ?? 0));
        }

        const wrap = document.createElement("div");
        wrap.style.cssText = "display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-radius:8px;background:rgba(255,253,246,0.7);border:1px solid rgba(154,119,56,0.28);";

        const capSummary = document.createElement("div");
        capSummary.style.cssText = "font-size:13px;font-weight:700;color:var(--uw2-ink);";
        wrap.appendChild(capSummary);

        const makeRow = (label: string, min: number, getMax: () => number, getVal: () => number, setVal: (v: number) => void, stepBig = 10) => {
          const row = document.createElement("div");
          row.className = "uw2-step-row";
          const lb = document.createElement("span");
          lb.style.cssText = "min-width:68px;font-size:12px;font-weight:700;color:var(--uw2-ink-muted);";
          lb.textContent = label;
          const sl = document.createElement("input");
          sl.type = "range";
          sl.style.flex = "1";
          sl.min = String(min);
          const valEl = document.createElement("span");
          valEl.style.cssText = "min-width:44px;text-align:right;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;";
          const btns: { el: HTMLButtonElement; d: number }[] = [];
          for (const d of [-stepBig, -1, 1, stepBig]) {
            const btn = document.createElement("button");
            btn.className = "uw2-step-btn";
            btn.textContent = d > 0 ? `+${d}` : String(d);
            btn.addEventListener("click", () => { setVal(getVal() + d); syncDesign(); });
            btns.push({ el: btn, d });
          }
          sl.addEventListener("input", () => { setVal(Number(sl.value)); syncDesign(); });
          row.append(lb, sl, ...btns.map(b0 => b0.el), valEl);
          wrap.appendChild(row);
          return () => {
            const mx = getMax();
            const v = Math.max(min, Math.min(mx, getVal()));
            sl.max = String(mx);
            sl.value = String(v);
            sl.disabled = mx <= min;
            valEl.textContent = String(v);
            for (const b0 of btns) b0.el.disabled = b0.d < 0 ? v <= min : v >= mx;
          };
        };

        let syncGunsRow = () => {};
        const syncCrewRow = makeRow(
          "最大水手", stype.minCrew, () => maxCrewCap,
          () => designCrew,
          v => {
            designCrew = Math.max(stype.minCrew, Math.min(maxCrewCap, v));
            const maxG = Math.max(0, Math.min(stype.maxGuns, stype.capacity - designCrew));
            if (designGuns > maxG) designGuns = maxG;
          },
          10,
        );
        syncGunsRow = makeRow(
          "最大火炮", 0, () => Math.max(0, Math.min(stype.maxGuns, stype.capacity - designCrew)),
          () => designGuns,
          v => {
            const maxG = Math.max(0, Math.min(stype.maxGuns, stype.capacity - designCrew));
            designGuns = Math.max(0, Math.min(maxG, v));
          },
          5,
        );

        const syncDesign = () => {
          syncCrewRow();
          syncGunsRow();
          const cargo = Math.max(0, stype.capacity - designCrew - designGuns);
          capSummary.textContent = `载货 ${cargo}/${stype.capacity} · 水手 ${designCrew} · 火炮 ${designGuns}`;
        };
        syncDesign();
        box.appendChild(wrap);
      };

      const mountNegotiateAndName = (opts: {
        box: HTMLElement;
        priceKey: string;
        defaultName: string;
        listPrice: number;
        tradeInSlot: number;
        submitLabel: string;
        onCommit: (offer: number, avail: number, nameTxt: string) => void;
      }) => {
        if (lastNameKey !== opts.priceKey) {
          customShipName = opts.defaultName;
          lastNameKey = opts.priceKey;
        }
        const avail = (b.money + (opts.tradeInSlot >= 0 ? Math.trunc(b.shipPrice(opts.tradeInSlot) / 2) : 0)) | 0;
        const maxOffer = Math.max(0, Math.min(avail, opts.listPrice));
        if (lastPriceKey !== opts.priceKey) {
          offerPrice = maxOffer;
          lastPriceKey = opts.priceKey;
          haggleOpen = false;
          haggleAccRand = rng.random(10);
        } else if (offerPrice < 0 || offerPrice > maxOffer) {
          offerPrice = maxOffer;
        }
        const floor = Math.trunc(Math.imul(500 - hero.getStats(6), opts.listPrice) / 500) | 0;

        const nameRow = document.createElement("div");
        nameRow.style.cssText = "display:flex;align-items:center;gap:8px;";
        const nLbl = document.createElement("span");
        nLbl.style.cssText = "font-size:13px;font-weight:700;color:var(--uw2-ink-muted);white-space:nowrap;";
        nLbl.textContent = "新船名";
        const nameInp = document.createElement("input");
        nameInp.type = "text";
        nameInp.maxLength = 7;
        nameInp.value = customShipName;
        nameInp.style.cssText = "flex:1;padding:6px 10px;font-size:14px;font-weight:700;border:1px solid var(--uw2-gold);border-radius:6px;background:#fffdf6;color:var(--uw2-ink);";
        nameInp.addEventListener("input", () => { customShipName = nameInp.value; });
        nameRow.append(nLbl, nameInp);
        opts.box.appendChild(nameRow);

        const priceWrap = document.createElement("div");
        priceWrap.style.cssText = "display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-radius:8px;background:rgba(255,253,246,0.7);border:1px solid rgba(154,119,56,0.28);";
        const origAsk = capMsg(c, opts.priceKey.startsWith("new_") ? 0x100 : 0xc2, opts.listPrice);
        const topLine = document.createElement("div");
        topLine.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px;font-weight:700;flex-wrap:wrap;";
        const pInfo = document.createElement("span");
        pInfo.style.color = "var(--uw2-ink)";

        if (!haggleOpen) {
          pInfo.textContent = origAsk;
          topLine.appendChild(pInfo);

          const btnRow = document.createElement("div");
          btnRow.className = "uw2-step-row";
          const hagBtn = document.createElement("button");
          hagBtn.className = "uw2-step-btn";
          hagBtn.textContent = "议价";
          hagBtn.disabled = opts.listPrice <= 0;
          hagBtn.addEventListener("click", () => {
            haggleOpen = true;
            haggleAccRand = rng.random(10);
            offerPrice = maxOffer;
            render();
          });
          const buyFullBtn = document.createElement("button");
          buyFullBtn.className = "uw2-btn uw2-btn-primary";
          buyFullBtn.style.marginLeft = "auto";
          buyFullBtn.textContent = `${opts.submitLabel}（${opts.listPrice.toLocaleString()} 金币）`;
          buyFullBtn.addEventListener("click", () => opts.onCommit(opts.listPrice, avail, nameInp.value));
          btnRow.append(hagBtn, buyFullBtn);
          priceWrap.append(topLine, btnRow);
          opts.box.appendChild(priceWrap);
          return;
        }

        const acc = b.roleMember(4);
        const accK = acc !== GameConst.EMPTY_SLOT && (m.person(acc).skills & SkillFlag.ACCOUNTING) ? 5 : haggleAccRand;
        const accHint = acc !== GameConst.EMPTY_SLOT ? (Math.trunc(Math.imul(accK + 95, floor) / 100) | 0) : -1;
        pInfo.textContent = accHint >= 0 ? `${capMsg(c, 0xc3)} ${capMsg(c, 0xc4, accHint)}` : capMsg(c, 0xc3);
        const offerReadout = document.createElement("span");
        offerReadout.style.color = "#7c5216";
        topLine.append(pInfo, offerReadout);

        const sl = document.createElement("input");
        sl.type = "range";
        sl.min = "0";
        sl.max = String(maxOffer);
        sl.value = String(offerPrice);
        sl.disabled = maxOffer <= 0;

        const btnRow = document.createElement("div");
        btnRow.className = "uw2-step-row";
        const decBtn = document.createElement("button");
        decBtn.className = "uw2-step-btn";
        decBtn.textContent = "-5%";
        const resetBtn = document.createElement("button");
        resetBtn.className = "uw2-step-btn";
        resetBtn.textContent = "原价";
        const goBtn = document.createElement("button");
        goBtn.className = "uw2-btn uw2-btn-primary";
        goBtn.style.marginLeft = "auto";

        const syncOffer = (val: number) => {
          offerPrice = Math.max(0, Math.min(maxOffer, Math.trunc(val) || 0));
          sl.value = String(offerPrice);
          offerReadout.textContent = `${offerPrice.toLocaleString()} 金币`;
          goBtn.textContent = `${opts.submitLabel}（${offerPrice.toLocaleString()} 金币）`;
          goBtn.disabled = avail < opts.listPrice && offerPrice <= 0;
        };
        syncOffer(offerPrice);
        sl.addEventListener("input", () => syncOffer(Number(sl.value)));
        decBtn.addEventListener("click", () => syncOffer(offerPrice - Math.max(100, Math.trunc(opts.listPrice * 0.05))));
        resetBtn.addEventListener("click", () => syncOffer(maxOffer));
        goBtn.addEventListener("click", () => opts.onCommit(offerPrice, avail, nameInp.value));

        btnRow.append(decBtn, resetBtn, goBtn);
        priceWrap.append(topLine, sl, btnRow);
        opts.box.appendChild(priceWrap);
      };

      const render = () => preserveScroll(shell.h.body, () => {
        shell.moneyPill.textContent = fmtMoneyPill(b.money);
        shell.toastEl.textContent = notice;

        const usedList = getUsedShips();
        const fleetSlots = getFleetSlots();

        shell.toolbar.innerHTML = "";
        tabLabels.forEach((lbl, idx) => {
          const btn = document.createElement("button");
          btn.className = `uw2-btn uw2-tab-btn ${tab === idx ? "active" : ""}`;
          btn.disabled = (idx === 1 && usedList.length === 0) || ((idx === 2 || idx === 3 || idx === 4) && fleetSlots.length === 0);
          btn.textContent = lbl;
          btn.addEventListener("click", () => {
            tab = idx; selIdx = 0; replaceSlot = -1; designCrew = -1; designGuns = -1;
            if (tab === 4) {
              if (rmSub === 0 && rollFigureheads()) notice = specialNotice;
              else if (rmSub === 1 && rollGuns()) notice = specialNotice;
            }
            render();
          });
          shell.toolbar.appendChild(btn);
        });

        shell.h.body.innerHTML = "";
        const split = document.createElement("div");
        split.className = "uw2-split";
        const left = document.createElement("div");
        left.className = "uw2-pane";
        const right = document.createElement("div");
        right.className = "uw2-pane";

        if (tab === 0) {
          // ---- 0. 造新船 & 交船（全部就地完成，零层叠弹窗） ----
          const buildDays = ecoEx.buildDays;
          const types = getBuildableTypes();
          if (selIdx >= types.length) selIdx = Math.max(0, types.length - 1);

          const lt = document.createElement("div");
          lt.className = "uw2-pane-title";
          lt.textContent = buildDays !== GameConst.EMPTY_SLOT ? `建造中（剩余 ${buildDays} 天）` : `可建造船型（工业 ${eco.industry}）`;
          left.appendChild(lt);

          const list = document.createElement("div");
          list.className = "uw2-list-col";
          list.style.maxHeight = "390px";
          types.forEach((t, idx) => {
            const tmpl = m.ship(t + 40);
            const stype = m.shipType(t);
            const basePrice = domS16(stype.price);
            const row = document.createElement("button");
            row.className = `uw2-row-card ${idx === selIdx ? "selected" : ""}`;
            row.style.cssText = "display:flex;justify-content:space-between;align-items:center;";
            row.innerHTML = `<span class="uw2-item-name">${decodeCleanCstr(codec, tmpl.nameBytes)}</span><span class="uw2-item-price">${basePrice.toLocaleString()} 金币</span>`;
            row.addEventListener("click", () => { selIdx = idx; designCrew = -1; designGuns = -1; render(); });
            list.appendChild(row);
          });
          left.appendChild(list);

          const rt = document.createElement("div");
          rt.className = "uw2-pane-title";
          rt.textContent = tabLabels[0];
          right.appendChild(rt);

          const box = document.createElement("div");
          box.className = "uw2-action-box";
          if (buildDays !== GameConst.EMPTY_SLOT) {
            const p = document.createElement("div");
            p.style.cssText = "font-size:14px;color:var(--uw2-ink);";
            p.textContent = buildDays > 0 ? capMsg(c, 0x105, buildDays) : capMsg(c, 0x106, 0);
            box.appendChild(p);
            if (buildDays === 0) {
              const needMate = !b.findMate();
              const fleetFull = fleetSlots.length >= 10;
              const needPickReplace = needMate || fleetFull;
              if (needPickReplace) {
                const warn = document.createElement("div");
                warn.className = "uw2-speech-box";
                warn.textContent = needMate ? capMsg(c, 0xa6) : capMsg(c, 0xa7);
                box.appendChild(warn);
                if (replaceSlot < 0 || !fleetSlots.includes(replaceSlot)) replaceSlot = fleetSlots[0] ?? -1;
                const repRow = document.createElement("div");
                repRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;align-items:center;";
                fleetSlots.forEach(fs => {
                  const sNm = decodeCleanCstr(codec, m.ship(heroOrDockSlot(m, fs).ship).nameBytes);
                  const rb = document.createElement("button");
                  rb.className = `uw2-btn ${replaceSlot === fs ? "active" : ""}`;
                  rb.textContent = `替换 ${sNm}`;
                  rb.addEventListener("click", () => { replaceSlot = fs; render(); });
                  repRow.appendChild(rb);
                });
                box.appendChild(repRow);
              }
              const delBtn = document.createElement("button");
              delBtn.className = "uw2-btn uw2-btn-primary";
              delBtn.style.alignSelf = "flex-start";
              delBtn.textContent = "领取新船";
              delBtn.addEventListener("click", () => {
                let buildSlot = 0;
                for (let i = 0; i < 0x28; i++) {
                  if (m.crewSlot(i).captain === (b.port | 0x80) && b.slotState(i) === ShipSlotFlag.BUILDING) { buildSlot = i; break; }
                }
                let targetSlot = getFreeFleetSlot();
                let tradeIn = -1;
                let capId = b.findMate() ? b.b2f7 : m.globals.hero;
                if (needPickReplace) {
                  if (replaceSlot < 0) return;
                  tradeIn = replaceSlot;
                  targetSlot = replaceSlot;
                  capId = m.crewSlot(replaceSlot).captain;
                }
                const S = heroOrDockSlot(m, buildSlot), M = m.crewSlot(buildSlot);
                S.flags = (S.flags & 0xdf) | ShipSlotFlag.ACTIVE;
                M.captain = capId;
                if (capId !== m.globals.hero) m.person(capId).role = 2;
                setPortBuildDays(eco, GameConst.EMPTY_SLOT);
                if (targetSlot >= 0 && targetSlot !== buildSlot) b.swapSlots(buildSlot, targetSlot);
                if (tradeIn >= 0) {
                  b.b2f4 = buildSlot;
                  b.b2f5 = GameConst.EMPTY_SLOT;
                  const leftData = { goods: new Array(9).fill(0xff), amt: new Array(9).fill(0) };
                  b.transfer(1, leftData);
                  b.sellDone();
                  b.compactSlots();
                  if (leftData.goods[0] !== 0xff) { pendingLeftovers = leftData; done(); return; }
                } else {
                  b.compactSlots();
                }
                m.person(capId).role = capId !== m.globals.hero ? 2 : 1;
                b.fleetRecalc();
                b.p.panels();
                notice = capMsg(c, 0xfa);
                replaceSlot = -1;
                render();
              });
              box.appendChild(delBtn);
            }
          } else if (types.length) {
            const t = types[selIdx];
            const tmpl = m.ship(t + 40);
            const stype = m.shipType(t);
            const matCount = t === 0x18 ? 6 : Math.trunc((eco.industry - plUmin(500, eco.industry)) / 200) + 3;
            if (newMat >= matCount) newMat = matCount - 1;
            if (newMat < 0) newMat = 0;

            const durVal = plUmin(Math.trunc((newMat + 8) * stype.durability / 10), 100);
            const buildTime = Math.trunc((((100 - Math.trunc(eco.industry / 50)) & 0xffff) * stype.durability) / 100) & 0xff;
            const base = domS16(stype.price);
            const matPrice = (Math.trunc(base * 4 / 5) + Math.trunc(base * newMat / 10)) & 0xffff;
            const listPrice = Math.imul(Math.trunc(Math.imul(b.priceIndex() + 50, matPrice) / 100), 10) | 0;

            renderShipHeader(box, t, decodeCleanCstr(codec, tmpl.nameBytes), `耐久 ${durVal} · 转向 ${stype.turn} · 推进 ${stype.propulsion} · 工期 ${buildTime} 天`);
            const desc = document.createElement("div");
            desc.className = "uw2-speech-box";
            desc.textContent = capMsg(c, b.BT.typeMsg[t]);
            box.appendChild(desc);

            b.freeSlots();
            const hasDockSlot = domS16(c.persons[0]) >= 10;
            if (!hasDockSlot) {
              const full = document.createElement("div");
              full.style.cssText = "font-size:13px;font-weight:700;color:#a13626;";
              full.textContent = decodeCleanCstr(codec, b.BT.fmt.dockFull);
              box.appendChild(full);
            } else {
              const buildSlot = c.persons[0];
              const matRow = document.createElement("div");
              matRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;align-items:center;";
              const mLbl = document.createElement("span");
              mLbl.style.cssText = "font-size:12px;font-weight:700;color:var(--uw2-ink-muted);";
              mLbl.textContent = "材质";
              matRow.appendChild(mLbl);
              for (let mi = 0; mi < matCount; mi++) {
                const mName = matTab[mi] ? decodeCleanCstr(codec, matTab[mi]) : `材质#${mi}`;
                const mb = document.createElement("button");
                mb.className = `uw2-btn ${newMat === mi ? "active" : ""}`;
                mb.style.cssText = "padding:4px 10px;font-size:12px;";
                mb.textContent = mName;
                mb.addEventListener("click", () => { newMat = mi; render(); });
                matRow.appendChild(mb);
              }
              box.appendChild(matRow);

              mountDesignControls(box, stype);
              mountNegotiateAndName({
                box,
                priceKey: `new_${t}_${newMat}`,
                defaultName: decodeCleanCstr(codec, tmpl.nameBytes),
                listPrice,
                tradeInSlot: -1,
                submitLabel: `签约造船 (${buildTime}天)`,
                onCommit: (offer, avail, nameTxt) => {
                  const floor = Math.trunc(Math.imul(500 - hero.getStats(6), listPrice) / 500) | 0;
                  if (offer < floor) {
                    if (!rng.random(5)) {
                      m.globals.dailyFlags |= 2;
                      notice = capMsg(c, 0xc5);
                      done();
                      return;
                    }
                    notice = capMsg(c, 0xc6);
                    render();
                    return;
                  }
                  if (avail < offer) { notice = capMsg(c, 0xef); render(); return; }
                  b.money = (avail - offer) | 0;
                  b.b2f4 = GameConst.EMPTY_SLOT;
                  b.b2f6 = buildSlot;
                  b.b2f7 = b.port | 0x80;
                  const { S, M, si } = allocShipRecord(buildSlot, t, tmpl, stype, false, b.port | 0x80, encodeShipNameSafe(nameTxt, tmpl.nameBytes));
                  S.flags = ShipSlotFlag.BUILDING;
                  si.flags = (si.flags & 0xf8) | newMat;
                  S.maxDurability = durVal;
                  S.durability = durVal;
                  si.maxCrew = designCrew;
                  si.maxGuns = designGuns;
                  si.maxCargo = Math.max(0, stype.capacity - designCrew - designGuns);
                  S.crew = plUmin(S.crew, si.maxCrew);
                  S.guns = plUmin(S.guns, si.maxGuns);
                  M.captain = b.port | 0x80;
                  setPortBuildDays(eco, buildTime);
                  b.p.panels();
                  notice = capMsg(c, 0x106, getPortEcoExtra(eco).buildDays);
                  render();
                },
              });
            }
          } else {
            box.textContent = capMsg(c, 0xfb);
          }
          right.appendChild(box);
        } else if (tab === 1) {
          // ---- 1. 买旧船（全部就地完成，零层叠弹窗） ----
          if (selIdx >= usedList.length) selIdx = Math.max(0, usedList.length - 1);
          const lt = document.createElement("div");
          lt.className = "uw2-pane-title";
          lt.textContent = tabLabels[1];
          left.appendChild(lt);

          const list = document.createElement("div");
          list.className = "uw2-list-col";
          usedList.forEach((u, idx) => {
            const tmpl = m.ship(u.type + 40);
            const price = m.shipType(u.type).price;
            const row = document.createElement("button");
            row.className = `uw2-row-card ${idx === selIdx ? "selected" : ""}`;
            row.style.cssText = "display:flex;justify-content:space-between;align-items:center;";
            row.innerHTML = `<span class="uw2-item-name">${decodeCleanCstr(codec, tmpl.nameBytes)}</span><span class="uw2-item-price">${price.toLocaleString()} 金币</span>`;
            row.addEventListener("click", () => { selIdx = idx; render(); });
            list.appendChild(row);
          });
          left.appendChild(list);

          const rt = document.createElement("div");
          rt.className = "uw2-pane-title";
          rt.textContent = "舰船详情";
          right.appendChild(rt);

          const box = document.createElement("div");
          box.className = "uw2-action-box";
          if (usedList.length) {
            const u = usedList[selIdx];
            const tmpl = m.ship(u.type + 40);
            const stype = m.shipType(u.type);
            const d0 = Math.trunc(9 * stype.durability / 10) & 0xffff;
            const usedDur = (d0 - Math.trunc((d0 & 0xff) / 15)) & 0xff;
            renderShipHeader(box, u.type, decodeCleanCstr(codec, tmpl.nameBytes), `耐久 ${usedDur} · 转向 ${stype.turn} · 推进 ${stype.propulsion} · 容量 ${stype.capacity}`);
            const desc = document.createElement("div");
            desc.className = "uw2-speech-box";
            desc.textContent = capMsg(c, b.BT.typeMsg[u.type]);
            box.appendChild(desc);

            const hasMate = !!b.findMate();
            const needReplace = !hasMate || fleetSlots.length >= 10;
            if (needReplace) {
              const warn = document.createElement("div");
              warn.style.cssText = "font-size:13px;font-weight:700;color:#8a4f11;";
              warn.textContent = !hasMate ? capMsg(c, 0xa6) : capMsg(c, 0xa7);
              box.appendChild(warn);
              if (replaceSlot < 0 || !fleetSlots.includes(replaceSlot)) replaceSlot = fleetSlots[0] ?? -1;
              const repRow = document.createElement("div");
              repRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;";
              fleetSlots.forEach(fs => {
                const sNm = decodeCleanCstr(codec, m.ship(heroOrDockSlot(m, fs).ship).nameBytes);
                const rb = document.createElement("button");
                rb.className = `uw2-btn ${replaceSlot === fs ? "active" : ""}`;
                rb.textContent = `替换 ${sNm}`;
                rb.addEventListener("click", () => { replaceSlot = fs; render(); });
                repRow.appendChild(rb);
              });
              box.appendChild(repRow);
            }

            const tradeInSlot = needReplace ? replaceSlot : -1;
            const listPrice = Math.imul(Math.trunc(Math.imul(b.priceIndex() + 50, stype.price) / 100), 10) | 0;

            mountNegotiateAndName({
              box,
              priceKey: `used_${u.cacheIdx}_${u.type}_${tradeInSlot}`,
              defaultName: decodeCleanCstr(codec, tmpl.nameBytes),
              listPrice,
              tradeInSlot,
              submitLabel: tabLabels[1],
              onCommit: (offer, avail, nameTxt) => {
                const floor = Math.trunc(Math.imul(500 - hero.getStats(6), listPrice) / 500) | 0;
                if (offer < floor) {
                  if (!rng.random(5)) {
                    m.globals.dailyFlags |= 2;
                    notice = capMsg(c, 0xc5);
                    done();
                    return;
                  }
                  notice = capMsg(c, 0xc6);
                  render();
                  return;
                }
                if (avail < offer) { notice = capMsg(c, 0xef); render(); return; }
                const targetSlot = needReplace ? replaceSlot : getFreeFleetSlot();
                if (targetSlot < 0) return;
                const capId = needReplace ? m.crewSlot(replaceSlot).captain : b.b2f7;
                b.money = (avail - offer) | 0;
                b.b2f4 = needReplace ? replaceSlot : GameConst.EMPTY_SLOT;
                b.b2f6 = targetSlot;
                b.b2f7 = capId;
                const leftData = { goods: new Array(9).fill(0xff), amt: new Array(9).fill(0) };
                if (b.b2f4 !== GameConst.EMPTY_SLOT) b.transfer(0, leftData);
                allocShipRecord(targetSlot, u.type, tmpl, stype, b.b2f4 !== GameConst.EMPTY_SLOT, capId, encodeShipNameSafe(nameTxt, tmpl.nameBytes));
                if (capId !== m.globals.hero) m.person(capId).role = 2;
                m.usedShipCache(0).setShipTypes(u.cacheIdx, GameConst.EMPTY_SLOT);
                b.fleetRecalc();
                b.p.panels();
                if (leftData.goods[0] !== 0xff) { pendingLeftovers = leftData; done(); return; }
                notice = decodeCleanCstr(codec, tmpl.nameBytes);
                replaceSlot = -1;
                render();
              },
            });
          }
          right.appendChild(box);
        } else if (tab === 2) {
          // ---- 2. 修理（全部就地完成，零弹窗） ----
          if (selIdx >= fleetSlots.length) selIdx = Math.max(0, fleetSlots.length - 1);
          const lt = document.createElement("div");
          lt.className = "uw2-pane-title";
          lt.textContent = "自舰队";
          left.appendChild(lt);

          const list = document.createElement("div");
          list.className = "uw2-list-col";
          fleetSlots.forEach((slot, idx) => {
            const slotView = heroOrDockSlot(m, slot), ship = m.ship(slotView.ship), stype = m.shipType(ship.type);
            const dmg = domS16(slotView.maxDurability - slotView.durability - slotView.turn - slotView.propulsion + stype.turn + stype.propulsion);
            const cost = dmg > 0 ? domS16(dmg * 20) : 0;
            const row = document.createElement("button");
            row.className = `uw2-row-card ${idx === selIdx ? "selected" : ""}`;
            row.style.cssText = "display:flex;justify-content:space-between;align-items:center;";
            row.innerHTML =
              `<span class="uw2-item-name">${decodeCleanCstr(codec, ship.nameBytes)}</span>` +
              `<span class="uw2-item-price ${cost ? "err" : "ok"}">${cost ? `${cost.toLocaleString()} 金币` : "完好"}</span>`;
            row.addEventListener("click", () => { selIdx = idx; render(); });
            list.appendChild(row);
          });
          left.appendChild(list);

          const rt = document.createElement("div");
          rt.className = "uw2-pane-title";
          rt.textContent = tabLabels[2];
          right.appendChild(rt);

          const box = document.createElement("div");
          box.className = "uw2-action-box";
          if (fleetSlots.length) {
            const slot = fleetSlots[selIdx];
            const slotView = heroOrDockSlot(m, slot), ship = m.ship(slotView.ship), stype = m.shipType(ship.type);
            const dur = slotView.durability, maxDur = slotView.maxDurability;
            const turn = slotView.turn, prop = slotView.propulsion;
            const dmg = domS16(maxDur - dur - turn - prop + stype.turn + stype.propulsion);
            const cost = dmg > 0 ? domS16(dmg * 20) : 0;
            renderShipHeader(box, ship.type, decodeCleanCstr(codec, ship.nameBytes), `耐久 ${dur}/${maxDur} · 转向 ${turn}/${stype.turn} · 推进 ${prop}/${stype.propulsion}`);

            const p = document.createElement("div");
            p.style.cssText = "font-size:14px;color:var(--uw2-ink);";
            p.textContent = cost ? capMsg(c, 0xcd, cost) : capMsg(c, 0xcc);
            box.appendChild(p);

            const repBtn = document.createElement("button");
            repBtn.className = "uw2-btn uw2-btn-primary";
            repBtn.style.alignSelf = "flex-start";
            repBtn.disabled = cost <= 0;
            repBtn.textContent = cost ? `${tabLabels[2]}（${cost.toLocaleString()} 金币）` : tabLabels[2];
            repBtn.addEventListener("click", () => {
              if (cost > b.money) { notice = capMsg(c, 0xcf); render(); return; }
              b.money = (b.money - cost) | 0;
              slotView.durability = maxDur;
              slotView.turn = stype.turn;
              slotView.propulsion = stype.propulsion;
              b.p.panels();
              notice = capMsg(c, 0xcc);
              render();
            });
            box.appendChild(repBtn);
          }
          right.appendChild(box);
        } else if (tab === 3) {
          // ---- 3. 卖船（全部就地完成，零弹窗） ----
          if (selIdx >= fleetSlots.length) selIdx = Math.max(0, fleetSlots.length - 1);
          const lt = document.createElement("div");
          lt.className = "uw2-pane-title";
          lt.textContent = "自舰队";
          left.appendChild(lt);

          const list = document.createElement("div");
          list.className = "uw2-list-col";
          fleetSlots.forEach((slot, idx) => {
            const ship = m.ship(heroOrDockSlot(m, slot).ship);
            const val = Math.trunc(b.shipPrice(slot) / 2);
            const row = document.createElement("button");
            row.className = `uw2-row-card ${idx === selIdx ? "selected" : ""}`;
            row.style.cssText = "display:flex;justify-content:space-between;align-items:center;";
            row.innerHTML = `<span class="uw2-item-name">${decodeCleanCstr(codec, ship.nameBytes)}</span><span class="uw2-item-price">${val.toLocaleString()} 金币</span>`;
            row.addEventListener("click", () => { selIdx = idx; replaceSlot = -1; render(); });
            list.appendChild(row);
          });
          left.appendChild(list);

          const rt = document.createElement("div");
          rt.className = "uw2-pane-title";
          rt.textContent = tabLabels[3];
          right.appendChild(rt);

          const box = document.createElement("div");
          box.className = "uw2-action-box";
          if (fleetSlots.length <= 1) {
            box.textContent = capMsg(c, 0xd0);
          } else {
            const slot = fleetSlots[selIdx];
            const slotView = heroOrDockSlot(m, slot), cs = m.crewSlot(slot), ship = m.ship(slotView.ship);
            const val = Math.trunc(b.shipPrice(slot) / 2);
            const isHeroShip = cs.captain === m.globals.hero;
            renderShipHeader(box, ship.type, decodeCleanCstr(codec, ship.nameBytes), `载货 ${b.cargoUsed(slot)} · 水手 ${slotView.crew}/${ship.maxCrew}`);

            const p = document.createElement("div");
            p.style.cssText = "font-size:14px;color:var(--uw2-ink);";
            p.textContent = capMsg(c, 0xd5, val);
            box.appendChild(p);

            if (isHeroShip) {
              const others = fleetSlots.filter(s => s !== slot);
              if (replaceSlot < 0 || !others.includes(replaceSlot)) replaceSlot = others[0];
              const repRow = document.createElement("div");
              repRow.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;align-items:center;";
              const lbl = document.createElement("span");
              lbl.style.cssText = "font-size:13px;font-weight:700;color:var(--uw2-ink-muted);";
              lbl.textContent = capMsg(c, 0xd2);
              repRow.appendChild(lbl);
              others.forEach(os => {
                const oShip = m.ship(heroOrDockSlot(m, os).ship);
                const ob = document.createElement("button");
                ob.className = `uw2-btn ${replaceSlot === os ? "active" : ""}`;
                ob.textContent = decodeCleanCstr(codec, oShip.nameBytes);
                ob.addEventListener("click", () => { replaceSlot = os; render(); });
                repRow.appendChild(ob);
              });
              box.appendChild(repRow);
            }

            const sellBtn = document.createElement("button");
            sellBtn.className = "uw2-btn uw2-btn-primary";
            sellBtn.style.alignSelf = "flex-start";
            sellBtn.textContent = `${tabLabels[3]}（${val.toLocaleString()} 金币）`;
            sellBtn.addEventListener("click", () => {
              b.b2f4 = slot;
              b.b2f5 = isHeroShip ? replaceSlot : GameConst.EMPTY_SLOT;
              b.sellDone();
              selIdx = 0;
              replaceSlot = -1;
              render();
            });
            box.appendChild(sellBtn);
          }
          right.appendChild(box);
        } else if (tab === 4) {
          // ---- 4. 改造（船首像 / 武装 / 积载比例变更 / 船名变更，全部内置分页） ----
          if (selIdx >= fleetSlots.length) selIdx = Math.max(0, fleetSlots.length - 1);
          const lt = document.createElement("div");
          lt.className = "uw2-pane-title";
          lt.textContent = "自舰队";
          left.appendChild(lt);

          const list = document.createElement("div");
          list.className = "uw2-list-col";
          fleetSlots.forEach((slot, idx) => {
            const slotView = heroOrDockSlot(m, slot), ship = m.ship(slotView.ship);
            const row = document.createElement("button");
            row.className = `uw2-row-card ${idx === selIdx ? "selected" : ""}`;
            row.style.cssText = "display:flex;justify-content:space-between;align-items:center;";
            row.innerHTML = `<span class="uw2-item-name">${decodeCleanCstr(codec, ship.nameBytes)}</span><span class="uw2-item-meta">火炮 ${slotView.guns}/${ship.maxGuns}</span>`;
            row.addEventListener("click", () => { selIdx = idx; render(); });
            list.appendChild(row);
          });
          left.appendChild(list);

          const rt = document.createElement("div");
          rt.className = "uw2-pane-title";
          rt.textContent = tabLabels[4];
          right.appendChild(rt);

          const box = document.createElement("div");
          box.className = "uw2-action-box";

          const subBar = document.createElement("div");
          subBar.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;";
          remodelLabels.forEach((rl, ri) => {
            const sb = document.createElement("button");
            sb.className = `uw2-btn ${rmSub === ri ? "active" : ""}`;
            sb.textContent = rl;
            sb.addEventListener("click", () => {
              rmSub = ri;
              if (ri === 0 && rollFigureheads()) notice = specialNotice;
              else if (ri === 1 && rollGuns()) notice = specialNotice;
              render();
            });
            subBar.appendChild(sb);
          });
          box.appendChild(subBar);

          const slot = fleetSlots[selIdx];
          const slotView = heroOrDockSlot(m, slot), cs = m.crewSlot(slot), ship = m.ship(slotView.ship);

          if (rmSub === 0) {
            // 船首像
            if (selFig > figCount) selFig = 1;
            const fGrid = document.createElement("div");
            fGrid.style.cssText = "display:grid;grid-template-columns:repeat(2,1fr);gap:6px;";
            for (let v = 1; v <= figCount; v++) {
              const nm = figTab[v] ? decodeCleanCstr(codec, figTab[v]) : `#${v}`;
              const price = v * v * 500;
              const fb = document.createElement("button");
              fb.className = `uw2-row-card ${selFig === v ? "selected" : ""}`;
              fb.style.cssText = "display:flex;justify-content:space-between;padding:7px 10px;font-size:13px;";
              fb.innerHTML = `<span>${nm}</span><span style="color:#7c5216;">${price.toLocaleString()}</span>`;
              fb.addEventListener("click", () => { selFig = v; render(); });
              fGrid.appendChild(fb);
            }
            box.appendChild(fGrid);

            const price = selFig * selFig * 500;
            const okBtn = document.createElement("button");
            okBtn.className = "uw2-btn uw2-btn-primary";
            okBtn.style.alignSelf = "flex-start";
            okBtn.textContent = `${remodelLabels[0]}（${price.toLocaleString()} 金币）`;
            okBtn.addEventListener("click", () => {
              if (b.money < price) { notice = capMsg(c, 0xcf); render(); return; }
              b.money = (b.money - price) | 0;
              cs.figurehead = selFig;
              b.p.panels();
              notice = figTab[selFig] ? decodeCleanCstr(codec, figTab[selFig]) : "";
              render();
            });
            box.appendChild(okBtn);
          } else if (rmSub === 1) {
            // 武装
            if (selGun > gunCount) selGun = 1;
            const gGrid = document.createElement("div");
            gGrid.style.cssText = "display:grid;grid-template-columns:repeat(2,1fr);gap:6px;";
            for (let v = 1; v <= gunCount; v++) {
              const nm = decodeCleanCstr(codec, b.BT.cannons[v]);
              const unitP = domS16(b.BT.cannonPrice[v]);
              const gb = document.createElement("button");
              gb.className = `uw2-row-card ${selGun === v ? "selected" : ""}`;
              gb.style.cssText = "display:flex;justify-content:space-between;padding:7px 10px;font-size:13px;";
              gb.innerHTML = `<span>${nm}</span><span style="color:#7c5216;">${unitP.toLocaleString()}</span>`;
              gb.addEventListener("click", () => { selGun = v; render(); });
              gGrid.appendChild(gb);
            }
            box.appendChild(gGrid);

            const same = (slotView.flags & ShipSlotFlag.CANNON_MASK) === selGun;
            const maxG = ship.maxGuns;
            const curG = slotView.guns;
            const room = same ? Math.max(0, maxG - curG) : maxG;
            if (gunQty > room) gunQty = room;
            if (gunQty < 1 && room > 0) gunQty = 1;

            if (room <= 0) {
              const emp = document.createElement("div");
              emp.style.fontSize = "13px";
              emp.textContent = maxG === 0 ? capMsg(c, 0x3fd) : capMsg(c, 0x3fc);
              box.appendChild(emp);
            } else {
              const unitP = domS16(b.BT.cannonPrice[selGun]);
              const sRow = document.createElement("div");
              sRow.style.cssText = "display:flex;align-items:center;gap:10px;";
              const sl = document.createElement("input");
              sl.type = "range";
              sl.className = "uw2-slider";
              sl.style.flex = "1";
              sl.min = "1";
              sl.max = String(room);
              sl.value = String(gunQty);
              const valSp = document.createElement("span");
              valSp.style.cssText = "font-size:13px;font-weight:700;min-width:110px;text-align:right;";
              const syncG = () => { valSp.textContent = `${gunQty} 门（${(gunQty * unitP).toLocaleString()} 金币）`; };
              sl.addEventListener("input", () => { gunQty = Number(sl.value); syncG(); });
              syncG();
              sRow.append(sl, valSp);
              box.appendChild(sRow);

              const buyG = document.createElement("button");
              buyG.className = "uw2-btn uw2-btn-primary";
              buyG.style.alignSelf = "flex-start";
              buyG.textContent = remodelLabels[1];
              buyG.addEventListener("click", () => {
                const total = Math.imul(gunQty, unitP) | 0;
                if (total > b.money) { notice = capMsg(c, 0xcf); render(); return; }
                b.money = (b.money - total) | 0;
                const nextQ = same ? (curG + gunQty) & 0xff : gunQty & 0xff;
                slotView.guns = nextQ;
                slotView.flags = (slotView.flags & ~ShipSlotFlag.CANNON_MASK) | (selGun & 0xff);
                b.p.panels();
                notice = `${decodeCleanCstr(codec, b.BT.cannons[selGun])} × ${nextQ}`;
                render();
              });
              box.appendChild(buyG);
            }
          } else if (rmSub === 2) {
            // 积载比例变更（就地滑杆调整，零弹窗）
            const stype = m.shipType(ship.type);
            const cost = domS16(stype.price);
            const p = document.createElement("div");
            p.style.fontSize = "14px";
            p.textContent = `${capMsg(c, 0x112, cost)}（当前载货 ${b.cargoUsed(slot)}/${ship.maxCargo}）`;
            box.appendChild(p);
            mountDesignControls(box, stype, ship.maxCrew, ship.maxGuns);
            const btn = document.createElement("button");
            btn.className = "uw2-btn uw2-btn-primary";
            btn.style.alignSelf = "flex-start";
            btn.textContent = `${remodelLabels[2]}（${cost.toLocaleString()} 金币）`;
            btn.addEventListener("click", () => {
              if (cost > b.money) { notice = capMsg(c, 0xcf); render(); return; }
              const nextCargo = Math.max(0, stype.capacity - designCrew - designGuns);
              if (domS16(b.cargoUsed(slot)) > domS16(nextCargo)) { notice = capMsg(c, 0x14); render(); return; }
              b.money = (b.money - cost) | 0;
              ship.maxCargo = nextCargo;
              ship.maxCrew = designCrew;
              ship.maxGuns = designGuns;
              slotView.crew = plUmin(slotView.crew, ship.maxCrew);
              slotView.guns = plUmin(slotView.guns, ship.maxGuns);
              b.p.panels();
              notice = `${decodeCleanCstr(codec, ship.nameBytes)}：载货 ${nextCargo} · 水手 ${designCrew} · 火炮 ${designGuns}`;
              render();
            });
            box.appendChild(btn);
          } else {
            // 船名变更（就地输入改名）
            const curName = decodeCleanCstr(codec, ship.nameBytes);
            const inp = document.createElement("input");
            inp.type = "text";
            inp.maxLength = 7;
            inp.value = curName;
            inp.style.cssText = "width:100%;padding:8px 12px;font-size:16px;font-weight:700;border:1px solid var(--uw2-gold);border-radius:6px;background:#fffdf6;color:var(--uw2-ink);";
            const btn = document.createElement("button");
            btn.className = "uw2-btn uw2-btn-primary";
            btn.style.alignSelf = "flex-start";
            btn.textContent = remodelLabels[3];
            btn.addEventListener("click", () => {
              const nv = inp.value.trim();
              if (!nv) return;
              try {
                writeShipName(ship, c.font.encode(nv));
                b.p.panels();
                notice = nv;
                render();
              } catch { /* 字库未收录字符保留原名 */ }
            });
            box.append(inp, btn);
          }
          right.appendChild(box);
        } else {
          // ---- 5. 工业投资（与交易所商业投资 1:1 统一面板） ----
          shell.toastEl.textContent = "";
          const curInv = eco.industryInvest;
          const capAmt = b.money >= GameConst.MAX_INVEST ? GameConst.MAX_INVEST : b.money & 0xffff;
          const maxInv = b.isCapital() ? 0 : Math.min(capAmt, Math.max(0, GameConst.MAX_INVEST - curInv));
          if (investAmt > maxInv) investAmt = maxInv;
          const blockMsg = b.isCapital() ? capMsg(c, 2) : curInv >= GameConst.MAX_INVEST ? (investReply || capMsg(c, 7)) : "";
          renderUnifiedInvestPane({
            container: shell.h.body,
            leftTitle: "港口工业",
            rightTitle: tabLabels[5],
            statLabel: "工业价值",
            statValue: eco.industry,
            investLabel: "本月工业投资",
            curInvest: curInv,
            maxInvest: maxInv,
            amount: investAmt,
            blockMsg,
            promptMsg: investReply || capMsg(c, 8),
            confirmLabel: tabLabels[5],
            onAmountChange: v => { investAmt = v; },
            onConfirm: v => {
              if (v <= 0) { investReply = capMsg(c, 0x0d); render(); return; }
              eco.industryInvest += v;
              b.investSupport(v);
              b.investOwner();
              b.money = (b.money - v) | 0;
              b.p.panels();
              investReply = capMsg(c, v < 500 ? 0x0e : v < 10000 ? 0x0f : 0x10);
              investAmt = 0;
              render();
            },
          });
          return;
        }

        split.append(left, right);
        shell.h.body.appendChild(split);
      });

      render();
    });

    if (!pendingLeftovers) break;
    await b.leftovers(pendingLeftovers);
    b.after();
    if (m.globals.dailyFlags & 2) break;
  }
}

// =========================================================================
// 9. 住宅一体化工作台 (House — 发现物收购 / 地图制作 / 测量技术 / 砲术)
// =========================================================================
export async function runDomHouseWorkbench(house: any): Promise<void> {
  const b = house.b, c = house.c, m = house.m, noble = house.noble;
  const { codec, art, sys } = c;
  const kind = noble.kind;
  const portName = decodeCleanCstr(codec, m.port(b.port).nameBytes);
  const nobleName = decodeCleanCstr(codec, noble.nameBytes);
  const hero = m.heroPerson();

  const hsS16 = (v: number) => (v << 16) >> 16;
  const hsUmin = (a: number, bv: number) => ((a & 0xffff) > (bv & 0xffff) ? bv & 0xffff : a & 0xffff);

  const tabLabels = kind === 0
    ? c.menuItems(0x18).slice(0, 3).map((x: Uint8Array) => decodeCleanCstr(codec, x))
    : kind === 1
      ? c.menuItems(0x19).slice(0, 4).map((x: Uint8Array) => decodeCleanCstr(codec, x))
      : [kind === 3 ? "炮术" : "测量技术"];

  const initGreet = (() => {
    if (kind === 0) return noble.flags & NobleFlag.CONTRACTED ? capMsg(c, 0x1de, hero.familyNameBytes) : capMsg(c, 0x1dd);
    if (kind === 1) return capMsg(c, noble.flags & NobleFlag.CONTRACTED ? 0x1ee : 0x1ed, hero.familyNameBytes);
    return capMsg(c, kind === 3 ? 0x2e7 : 0x2ee);
  })();

  let activeTab = 0;
  let selDiscIdx = 0;
  let reportedGeo = false;
  let speechText = "";
  let notice = initGreet;

  for (;;) {
    const pendingStory = await new Promise<{ txt: string } | null>(resolve => {
      let settled = false;
      const finish = (story: { txt: string } | null) => {
        if (settled) return;
        settled = true;
        shell.h.close();
        resolve(story);
      };

      const shell = createWorkbenchShell(`${portName} · 住宅`, house.money, () => finish(null), getBuildingArtUrl(c, 7, b.p));

      const hasTreasureMap = () => {
        for (let i = 0; i < GameConst.INV_SLOTS; i++) {
          const v = m.inventory(i);
          if (v >= 0x50 && v <= 0x59) return true;
        }
        return false;
      };

      const getReportableDiscs = () => {
        const out: number[] = [];
        for (let i = 0; i < 100; i++) {
          const f = m.discovery(i).flags;
          if (!(f & DiscoveryFlag.FOUND) && (f & DiscoveryFlag.KNOWN) && !(f & 0x10)) out.push(i);
        }
        return out;
      };

      const render = () => preserveScroll(shell.h.body, () => {
        shell.moneyPill.textContent = fmtMoneyPill(house.money);
        shell.toastEl.textContent = notice;

        shell.toolbar.innerHTML = "";
        tabLabels.forEach((lbl: string, idx: number) => {
          const btn = document.createElement("button");
          btn.className = `uw2-tab-btn ${activeTab === idx ? "active" : ""}`;
          btn.textContent = lbl;
          btn.addEventListener("click", () => { activeTab = idx; speechText = ""; render(); });
          shell.toolbar.appendChild(btn);
        });

        shell.h.body.innerHTML = "";
        const split = document.createElement("div");
        split.className = "uw2-split";

        const left = document.createElement("div");
        left.className = "uw2-pane";
        const right = document.createElement("div");
        right.className = "uw2-pane";

        // 左栏：主人头像与基本信息（或发现物报告清单）
        const profile = document.createElement("div");
        profile.style.cssText = "display:flex;gap:14px;align-items:center;";
        const url = art?.portraitUrl?.(noble.portrait);
        if (url) {
          const img = document.createElement("img");
          img.className = "uw2-portrait-img";
          img.src = url;
          profile.appendChild(img);
        }
        const meta = document.createElement("div");
        meta.style.cssText = "display:flex;flex-direction:column;gap:4px;";
        meta.innerHTML =
          `<div class="uw2-detail-title">${nobleName}</div>` +
          (kind <= 1
            ? `<div class="uw2-detail-sub">${noble.flags & NobleFlag.CONTRACTED ? "已签约" : "未签约"}</div>`
            : `<div class="uw2-detail-sub">${kind === 3 ? "炮术指导" : "测量技术指导"}</div>`);
        profile.appendChild(meta);
        left.appendChild(profile);

        if (kind === 0 && activeTab === 1) {
          const discs = getReportableDiscs();
          const lt = document.createElement("div");
          lt.className = "uw2-pane-title";
          lt.textContent = `${tabLabels[1]} (${discs.length})`;
          left.appendChild(lt);

          const list = document.createElement("div");
          list.className = "uw2-list-col";
          if (!discs.length) {
            const emp = document.createElement("div");
            emp.className = "uw2-speech-box";
            emp.textContent = capMsg(c, 0x1e4);
            list.appendChild(emp);
          } else {
            if (selDiscIdx >= discs.length) selDiscIdx = 0;
            discs.forEach((n, idx) => {
              const d = m.discovery(n), v = d.importance;
              const kMul = hsS16(Math.imul(5 - (noble.flags & NobleFlag.REWARD_MASK), v === 100 ? 4 : 1));
              const pay = Math.imul(Math.imul(kMul, v), 50);
              const name = decodeCleanCstr(codec, ListSelect.colonyRec(c, n));
              const row = document.createElement("button");
              row.className = `uw2-row-card ${idx === selDiscIdx ? "selected" : ""}`;
              row.innerHTML = `<span class="uw2-item-name">${name}</span><span class="uw2-item-price">${pay.toLocaleString()} 金币</span>`;
              row.addEventListener("click", () => { selDiscIdx = idx; speechText = ""; render(); });
              list.appendChild(row);
            });
          }
          left.appendChild(list);
        } else if (kind === 1) {
          const kvBox = document.createElement("div");
          kvBox.style.cssText = "display:flex;flex-direction:column;gap:8px;margin-top:8px;";
          const wk = getWorkState(m);
          const unrep = wk.exploreUnrep;
          const total = wk.exploreTotal;
          kvBox.innerHTML =
            `<div class="uw2-kv-row"><span class="uw2-kv-label">地图制作技能</span><span class="uw2-kv-val">${hero.skills & SkillFlag.CARTOGRAPHY ? "已习得" : "未习得"}</span></div>` +
            `<div class="uw2-kv-row"><span class="uw2-kv-label">未报告探索格数</span><span class="uw2-kv-val">${unrep}</span></div>` +
            `<div class="uw2-kv-row"><span class="uw2-kv-label">累计探索格数</span><span class="uw2-kv-val">${total} / 3300</span></div>`;
          left.appendChild(kvBox);
        } else if (kind >= 2) {
          const isGun = kind === 3;
          const req = isGun ? [75, 65, 80] : [70, 80, 70];
          const idxs = isGun ? house.D.gunSkills : house.D.measureSkills;
          const learned = !!(hero.skills & (isGun ? SkillFlag.GUNNERY : SkillFlag.SURVEY));
          const kvBox = document.createElement("div");
          kvBox.style.cssText = "display:flex;flex-direction:column;gap:8px;margin-top:8px;";
          let html = `<div class="uw2-kv-row"><span class="uw2-kv-label">状态</span><span class="uw2-kv-val">${learned ? "已习得" : "未习得"}</span></div>`;
          for (let i = 0; i < 3; i++) {
            const sName = decodeCleanCstr(codec, house.stats[idxs[i]]);
            const cur = hero.getStats(idxs[i]);
            html += `<div class="uw2-kv-row"><span class="uw2-kv-label">${sName}</span><span class="uw2-kv-val" style="color:${cur >= req[i] ? "#247544" : "#b83d3d"};">${cur} / ${req[i]}</span></div>`;
          }
          html += `<div class="uw2-kv-row"><span class="uw2-kv-label">学费</span><span class="uw2-item-price">${house.fee().toLocaleString()} 金币</span></div>`;
          kvBox.innerHTML = html;
          left.appendChild(kvBox);
        }

        // 右栏：对应页签的操作面板
        const rt = document.createElement("div");
        rt.className = "uw2-pane-title";
        rt.textContent = tabLabels[activeTab];
        right.appendChild(rt);

        if (kind === 0) {
          if (activeTab === 0) {
            const box = document.createElement("div");
            box.className = "uw2-speech-box";
            box.textContent = speechText || (noble.flags & NobleFlag.CONTRACTED
              ? capMsg(c, 0x1de, hero.familyNameBytes)
              : `${capMsg(c, 0x1e0, hero.familyNameBytes)} ${capMsg(c, 0x1e1)}`);
            right.appendChild(box);
            if (!(noble.flags & NobleFlag.CONTRACTED)) {
              const btn = document.createElement("button");
              btn.className = "uw2-btn uw2-btn-primary";
              btn.style.cssText = "padding:9px 22px;align-self:flex-start;";
              btn.textContent = tabLabels[0];
              btn.addEventListener("click", () => {
                for (let i = 0; i < 20; i++) { const n = m.noble(i); if (n.kind === 0) n.flags &= ~NobleFlag.CONTRACTED; }
                noble.flags |= NobleFlag.CONTRACTED;
                speechText = capMsg(c, 0x1e3);
                notice = speechText;
                render();
              });
              right.appendChild(btn);
            }
          } else if (activeTab === 1) {
            const discs = getReportableDiscs();
            if (!(noble.flags & NobleFlag.CONTRACTED)) {
              const box = document.createElement("div");
              box.className = "uw2-speech-box";
              box.textContent = capMsg(c, 0x1dd);
              right.appendChild(box);
            } else if (!discs.length) {
              const box = document.createElement("div");
              box.className = "uw2-speech-box";
              box.textContent = speechText || capMsg(c, 0x1e4);
              right.appendChild(box);
            } else {
              const n = discs[selDiscIdx] ?? discs[0];
              const d = m.discovery(n), v = d.importance;
              const kMul = hsS16(Math.imul(5 - (noble.flags & NobleFlag.REWARD_MASK), v === 100 ? 4 : 1));
              const pay = Math.imul(Math.imul(kMul, v), 50);
              const name = decodeCleanCstr(codec, ListSelect.colonyRec(c, n));
              const box = document.createElement("div");
              box.className = "uw2-speech-box";
              box.textContent = speechText || capMsg(c, 0x1e5);
              right.appendChild(box);

              const btn = document.createElement("button");
              btn.className = "uw2-btn uw2-btn-primary";
              btn.style.cssText = "padding:9px 22px;align-self:flex-start;";
              btn.textContent = `${tabLabels[1]}「${name}」（+${pay.toLocaleString()} 金币）`;
              btn.addEventListener("click", () => {
                const nameBytes = ListSelect.colonyRec(c, n);
                speechText = capMsg(c, 0x1e6 + Math.trunc(v / 25), nameBytes, pay);
                notice = speechText;
                let nextCash = (house.money + pay) | 0;
                if (nextCash > GameConst.MAX_CASH) nextCash = GameConst.MAX_CASH;
                house.money = nextCash;
                const hd = m.heroInfo(), add = ((v === 100 ? 15 : 8) * v) & 0xffff;
                hd.adventureFame = (hd.adventureFame + hsUmin((GameConst.MAX_FAME - hd.adventureFame) & 0xffff, add)) & 0xffff;
                d.flags |= 0x10;
                b.p.panels();
                render();
              });
              right.appendChild(btn);
            }
          } else {
            const box = document.createElement("div");
            box.className = "uw2-speech-box";
            box.textContent = speechText || (noble.flags & NobleFlag.CONTRACTED ? capMsg(c, 0x1de, hero.familyNameBytes) : capMsg(c, 0x1dd));
            right.appendChild(box);
            if (noble.flags & NobleFlag.CONTRACTED) {
              const btn = document.createElement("button");
              btn.className = "uw2-btn uw2-btn-primary";
              btn.style.cssText = "padding:9px 22px;align-self:flex-start;";
              btn.textContent = tabLabels[2];
              btn.addEventListener("click", () => {
                const dir = c.menuItems(0x30);
                let d: any = null;
                for (let i = 0; i < 50; i++) { const dc = m.discovery(i); if (!(dc.flags & DiscoveryFlag.FOUND) && !(dc.flags & 0x40)) { d = dc; break; } }
                if (!d) { speechText = capMsg(c, 0x1eb); notice = speechText; render(); return; }
                let ew, lon, ns, lat;
                if ((sys.rng.random(0x50) & 0xff) > hero.getStats(7)) {
                  const di = sys.rng.random(0x48);
                  ew = di >= 0x24 ? 1 : 0;
                  lon = hsS16(Math.imul(Math.abs(hsS16(di - 0x24)), 5));
                  const r = sys.rng.random(0x1b);
                  ns = r >= 0x32 ? 2 : 3;
                  lat = hsS16(Math.imul(Math.abs(hsS16(r - 10)), 5));
                } else {
                  ew = 0;
                  let di = (hsS16(d.x) + 0x7bd) % 0x870;
                  if (di > 0x438) { ew = 1; di = 0x870 - di; }
                  lon = Math.trunc(Math.trunc(di / 6) / 5) * 5;
                  const v = hsS16(0x280 - d.y);
                  ns = v >= 0 ? 2 : 3;
                  lat = hsS16(Math.imul(Math.trunc(Math.trunc(hsS16(Math.abs(v) << 3) / 0x39) / 5), 5));
                }
                speechText = capMsg(c, 0x1ec, dir[ew], lon, dir[ns], lat);
                notice = speechText;
                render();
              });
              right.appendChild(btn);
            }
          }
        } else if (kind === 1) {
          if (activeTab === 0) {
            const box = document.createElement("div");
            box.className = "uw2-speech-box";
            box.textContent = speechText || (noble.flags & NobleFlag.CONTRACTED ? capMsg(c, 0x1ee, hero.familyNameBytes) : capMsg(c, 0x1ef));
            right.appendChild(box);
            if (!(noble.flags & NobleFlag.CONTRACTED)) {
              const btn = document.createElement("button");
              btn.className = "uw2-btn uw2-btn-primary";
              btn.style.cssText = "padding:9px 22px;align-self:flex-start;";
              btn.textContent = tabLabels[0];
              btn.addEventListener("click", () => {
                if (!(hero.skills & SkillFlag.CARTOGRAPHY)) { speechText = capMsg(c, 0x1f0); notice = speechText; render(); return; }
                for (let i = 0; i < 20; i++) { const n = m.noble(i); if (n.kind === 1) n.flags &= ~NobleFlag.CONTRACTED; }
                noble.flags |= NobleFlag.CONTRACTED;
                setExploreUnrep(m, 0);
                speechText = capMsg(c, 0x1f4);
                notice = speechText;
                render();
              });
              right.appendChild(btn);
            }
          } else if (activeTab === 1) {
            const names = c.menuItems(0x2b);
            const fee = house.fee();
            const kv = document.createElement("div");
            kv.style.cssText = "display:flex;flex-direction:column;gap:6px;";
            let html = "";
            for (let i = 0; i < 3; i++) {
              const cur = hero.getStats(house.D.mapSkills[i]);
              html += `<div class="uw2-kv-row"><span class="uw2-kv-label">${decodeCleanCstr(codec, names[i])}</span><span class="uw2-kv-val" style="color:${cur >= 75 ? "#247544" : "#b83d3d"};">${cur} / 75</span></div>`;
            }
            html += `<div class="uw2-kv-row"><span class="uw2-kv-label">学费</span><span class="uw2-item-price">${fee.toLocaleString()} 金币</span></div>`;
            kv.innerHTML = html;
            right.appendChild(kv);

            const box = document.createElement("div");
            box.className = "uw2-speech-box";
            box.textContent = speechText || capMsg(c, 0x1f5);
            right.appendChild(box);

            if (!(hero.skills & SkillFlag.CARTOGRAPHY)) {
              const btn = document.createElement("button");
              btn.className = "uw2-btn uw2-btn-primary";
              btn.style.cssText = "padding:9px 22px;align-self:flex-start;";
              btn.textContent = `${tabLabels[1]}（${fee.toLocaleString()} 金币）`;
              btn.addEventListener("click", () => {
                for (let i = 0; i < 3; i++) {
                  if (hero.getStats(house.D.mapSkills[i]) < 75) {
                    speechText = capMsg(c, 0x1f6, names[i]);
                    notice = speechText;
                    render();
                    return;
                  }
                }
                if (house.money < fee) { speechText = capMsg(c, 0x1f8); notice = speechText; render(); return; }
                house.money = (house.money - fee) | 0;
                hero.skills |= SkillFlag.CARTOGRAPHY;
                b.p.panels();
                speechText = capMsg(c, 0x1f7, fee);
                notice = speechText;
                render();
              });
              right.appendChild(btn);
            }
          } else if (activeTab === 2) {
            const unrep = getWorkState(m).exploreUnrep;
            const pay = Math.imul(Math.imul(hsS16(5 - (noble.flags & NobleFlag.REWARD_MASK)), unrep), 20);
            const box = document.createElement("div");
            box.className = "uw2-speech-box";
            box.textContent = speechText || (unrep ? capMsg(c, 0x1fc, pay) : capMsg(c, 0x1fa));
            right.appendChild(box);
            if ((noble.flags & NobleFlag.CONTRACTED) && !reportedGeo && unrep > 0) {
              const btn = document.createElement("button");
              btn.className = "uw2-btn uw2-btn-primary";
              btn.style.cssText = "padding:9px 22px;align-self:flex-start;";
              btn.textContent = `${tabLabels[2]}（+${pay.toLocaleString()} 金币）`;
              btn.addEventListener("click", () => {
                reportedGeo = true;
                const total = getWorkState(m).exploreTotal;
                const hd = m.heroInfo();
                hd.adventureFame = (hd.adventureFame + hsUmin((GameConst.MAX_FAME - hd.adventureFame) & 0xffff, Math.imul(5, unrep))) & 0xffff;
                const room = (GameConst.MAX_CASH - house.money) | 0;
                house.money = (house.money + (room > pay ? pay : room)) | 0;
                setExploreUnrep(m, 0);
                b.p.panels();
                if (total >= 3300) {
                  revealEntireWorldMap(m);
                  const txt = capMsg(c, 0x1fb);
                  speechText = capMsg(c, 0x1fc, pay);
                  notice = speechText;
                  finish({ txt });
                  return;
                }
                speechText = `${capMsg(c, 0x1fc, pay)} ${capMsg(c, 0x1fd)}`;
                notice = speechText;
                render();
              });
              right.appendChild(btn);
            }
          } else {
            const hasMap = hasTreasureMap();
            const box = document.createElement("div");
            box.className = "uw2-speech-box";
            box.textContent = speechText || (hasMap ? capMsg(c, 0x311) : capMsg(c, 0x1fa));
            right.appendChild(box);
            if (hasMap) {
              const btn = document.createElement("button");
              btn.className = "uw2-btn uw2-btn-primary";
              btn.style.cssText = "padding:9px 22px;align-self:flex-start;";
              btn.textContent = `${tabLabels[3]}（20,000 金币）`;
              btn.addEventListener("click", () => {
                if (house.money <= 20000) { speechText = capMsg(c, 0xef); notice = speechText; render(); return; }
                let idx = 0;
                for (; idx < GameConst.INV_SLOTS; idx++) { const v = m.inventory(idx); if (v >= 0x50 && v <= 0x59) break; }
                const d = m.discovery(m.item(m.inventory(idx)).power);
                let si = (hsS16(d.x) + 0x7bd) % 0x870, di = hsS16(0x280 - d.y), ew = 0x80;
                if (si > 0x438) { ew = 0x81; si = 0x870 - si; }
                const ns = di >= 0 ? 0x7e : 0x7f;
                di = Math.trunc(hsS16(Math.abs(di) << 3) / 0x39);
                si = hsS16(Math.imul(Math.trunc(Math.trunc(si / 6) / 5) + sys.rng.random(2), 5));
                di = hsS16(Math.imul(Math.trunc(di / 5) + sys.rng.random(2), 5));
                house.money = (house.money - 20000) | 0;
                speechText = toSimp(captureConsoleText(c, () => {
                  c.message(0x30f); c.message(ns, di); c.message(ew, si); c.message(0x310);
                }).trim());
                notice = speechText;
                render();
              });
              right.appendChild(btn);
            }
          }
        } else {
          // 种类 2 测量技术 / 种类 3 砲术
          const isGun = kind === 3;
          const M = isGun
            ? { ask: 0x2e7, done: 0x2e8, lack: 0x2e9, poor: 0x2eb, ok: 0x2ec, bye: 0x2ed, bit: SkillFlag.GUNNERY, req: [75, 65, 80], idx: house.D.gunSkills }
            : { ask: 0x2ee, done: 0x2ef, lack: 0x2f0, poor: 0x1f8, ok: 0x1f9, bye: 0x2f1, bit: SkillFlag.SURVEY, req: [70, 80, 70], idx: house.D.measureSkills };
          const learned = !!(hero.skills & M.bit);
          const fee = house.fee();

          const box = document.createElement("div");
          box.className = "uw2-speech-box";
          box.textContent = speechText || (learned ? capMsg(c, M.done) : capMsg(c, M.ask));
          right.appendChild(box);

          if (!learned) {
            const btn = document.createElement("button");
            btn.className = "uw2-btn uw2-btn-primary";
            btn.style.cssText = "padding:9px 22px;align-self:flex-start;";
            btn.textContent = `${tabLabels[0]}（${fee.toLocaleString()} 金币）`;
            btn.addEventListener("click", () => {
              for (let i = 0; i < 3; i++) {
                if (hero.getStats(M.idx[i]) < M.req[i]) {
                  speechText = capMsg(c, M.lack, house.stats[M.idx[i]], M.req[i]);
                  notice = speechText;
                  render();
                  return;
                }
              }
              if (house.money < fee) { speechText = capMsg(c, M.poor); notice = speechText; render(); return; }
              house.money = (house.money - fee) | 0;
              hero.skills |= M.bit;
              b.p.panels();
              speechText = capMsg(c, M.bye);
              notice = speechText;
              render();
            });
            right.appendChild(btn);
          }
        }

        split.append(left, right);
        shell.h.body.appendChild(split);
      });

      render();
    });

    if (pendingStory) {
      await runDomStoryCard(art, 0x3f, pendingStory.txt, "世界地图完成");
      continue;
    }
    b.after();
    break;
  }
}
