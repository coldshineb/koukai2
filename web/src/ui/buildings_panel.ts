// ui/buildings_panel.ts — 与交易所 / 码头 / 道具店 1:1 统一规格的六大建筑一体化工作台
// 涵盖：王宫 (Palace)、银行 (Bank)、事务所 (Office)、旅馆 (Inn)、教会 (Church)、占卜师 (Fortune)
// 统一结构：createDomModal(wide) + headerRight(.uw2-pill + 关闭) + .uw2-modal-toolbar(.uw2-tab-btn) + .uw2-split + .uw2-modal-footer
import { DS, OFF } from "../model/schema_views.ts";
import { DiscoveryFlag, GameConst, NobleFlag, OptionFlag, SkillFlag, TreatyFlag, WorkDS } from "../model/flags.ts";
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
  const b = palace.b, c = palace.c, st = palace.st, m = palace.m;
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
        const canNaturalize = !(same || (c5e !== 0 && c5e !== 0xff && plS16(st.u16(WorkDS.CUR_KIND)) >= 6) || (st.u8(WorkDS.FLAGS) & 6));
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
            if (st.u8(country.addr + 2) === 7) st.set8(country.addr + 2, 6);
            country.aidMoneyK = 0; st.set8(country.addr + 6, 0); country.aidShipType = 0;
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
      if (palace.same() && (st.u8(WorkDS.FLAGS) & 2)) {
        g.commonChap = st.u8(WorkDS.ROYAL_CHAP); g.commonSec = 0;
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
  const b = office.b, c = office.c, st = office.st, m = office.m, g = m.globals, codec = c.codec;
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

          if (g.commonChap) {
            const p = document.createElement("div");
            p.style.cssText = "font-size:14px;color:var(--uw2-ink);line-height:1.6;";
            if (plS16(st.u16(WorkDS.CUR_KIND)) < 6) {
              const tp = st.u8(WorkDS.TARGET_PORT);
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
          } else if ((st.u8(WorkDS.FLAGS) & 3) === 3) {
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
              const k = st.u8(WorkDS.KINDS + i * 2);
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
            const hd = m.heroInfo();
            const standing = hd.getCountryStanding(selNation);
            const contrib = 100 - standing;
            const rival = st.u8(country.addr + 2);
            const keyPort = decodeCleanCstr(codec, office.portName(st.u8(country.addr + 4)));
            const rivalTxt = rival < 7
              ? capMsg(c, 0x58, office.nations[selNation], office.nations[rival])
              : capMsg(c, 0x355, office.nations[selNation]);
            const portTxt = capMsg(c, 0x59, office.portName(st.u8(country.addr + 4)));

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
      const k = st.u8(WorkDS.KINDS + pickJobIdx * 2);
      g.commonSec = (k + 1) & 0xff;
      st.set16(WorkDS.CUR_PARAM, st.u16(WorkDS.PARAMS + pickJobIdx * 2));
      if (await office.event(6)) g.commonChap = st.u8(WorkDS.CUR_KIND);
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
  const c = b.c, st = b.st, codec = c.codec, art = c.art;
  const portName = decodeCleanCstr(codec, st.model.port(b.port).nameBytes);
  const tabLabels = [...UI_STR.innTabs];
  let isCapital = false;
  for (let i = 0; i < 6; i++) if (st.u8(DS.TBL_COUNTRY + i * 0x20 + 0x0a) === b.port) isCapital = true;
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
              const rec = st.bytes(st.personRecord(pid), 0x32);
              const nm = `${decodeCleanCstr(codec, st.cstr(st.personRecord(pid)))} ${decodeCleanCstr(codec, st.cstr(st.personRecord(pid) + 13))}`.trim();
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
          const E = DS.TBL_PORT_ECONOMY + b.port * 0x25;
          const R = DS.TBL_PORT + b.port * 0x16;
          const allyIdx = st.u8(R + 0x15) & 7;

          const pane = document.createElement("div");
          pane.className = "uw2-pane";
          const pt = document.createElement("div");
          pt.className = "uw2-pane-title";
          pt.textContent = "各国海港支持度";
          pane.appendChild(pt);

          const box = document.createElement("div");
          box.className = "uw2-action-box";
          for (let i = 0; i < 6; i++) {
            const pct = st.u8(E + 8 + i);
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
  const c = b.c, st = b.st, codec = c.codec;
  const portName = decodeCleanCstr(codec, st.model.port(b.port).nameBytes);
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
            const H = b.hero, v = c.sys.rng.random(2) + st.u8(H + 0x23);
            st.set8(H + 0x23, Math.min(100, v));
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
              const H = b.hero;
              st.set8(H + 0x23, Math.min(100, (st.u8(H + 0x23) - ratio + 0x0b) & 0xffff));
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
  const c = b.c, st = b.st, codec = c.codec;
  const portName = decodeCleanCstr(codec, st.model.port(b.port).nameBytes);
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
        btn.disabled = (idx === 3 && crewN === 0) || (idx === 2 && st.hero === 1);
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
          const nm = `${decodeCleanCstr(codec, st.cstr(st.personRecord(pid)))} ${decodeCleanCstr(codec, st.cstr(st.personRecord(pid) + 13))}`.trim();
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
          reading = capMsg(c, Math.trunc(st.u8(b.hero + 0x23) / 0x19) + 0x12e);
        } else if (tab === 1) {
          const H = b.hero, D = b.heroData;
          const lines = [
            capMsg(c, 0x221, (expNeed(st.u8(H + OFF.PERSON.NAV_LEVEL)) - st.u16(H + OFF.PERSON.NAV_EXP)) << 16 >> 16),
            capMsg(c, 0x222, (expNeed(st.u8(H + OFF.PERSON.BATTLE_LEVEL)) - st.u16(H + OFF.PERSON.BATTLE_EXP)) << 16 >> 16),
          ];
          if ((st.u8(H + OFF.PERSON.FACE) & 15) !== 6) {
            let fame = 0; for (let i = 0; i < 3; i++) if (st.u16(D + i * 2) > fame) fame = st.u16(D + i * 2);
            const need = b.p.P.data.titleFame[st.u8(D + 0x0d)];
            lines.push(need > fame ? capMsg(c, 0x223, (need - fame) & 0xffff) : capMsg(c, 0x2f2));
          }
          reading = lines.join("\n");
        } else if (tab === 2) {
          let found = -1, rec = 0;
          for (let i = 0; i < 0x1e; i++) {
            const mRec = DS.TBL_BARMAID + i * 0x13;
            if (st.u8(mRec + 0x0e) === b.port && (st.u8(mRec + 0x12) & 8) && !(st.u8(mRec + 0x12) & 0x40)) { found = i; rec = mRec; break; }
          }
          if (found < 0) reading = capMsg(c, 0x149);
          else if (st.u8(rec + 0x0f) >= 0x50) reading = capMsg(c, 0x146, st.cstr(rec));
          else reading = capMsg(c, st.u8(rec + 0x0f) >= 0x32 ? 0x147 : 0x148);
        } else if (crewIds.length) {
          const P = st.personRecord(crewIds[selCrew]);
          reading = [
            capMsg(c, 0x4e + Math.trunc(st.u8(P + 0x23) / 0x19)),
            capMsg(c, 0x319 + Math.trunc(st.u8(P + 0x2b) / 0x19)),
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
  const c = b.c, st = b.st, codec = c.codec, art = c.art;
  const portName = decodeCleanCstr(codec, st.model.port(b.port).nameBytes);
  const tabLabels = [...UI_STR.tavernTabs];
  const drinkName = decodeCleanCstr(codec, drinkNameBytes);
  const k = st.u8(b.eco + 0x24);
  const drinkPrice = b.T.liquorPrice[k];
  const initGreet = capMsg(c, 0x12, drinkNameBytes);

  let tab = 2;
  if (b.fleetShips() && !(st.u8(DS.DAILY_FLAGS) & 1)) tab = 0;
  let rounds = 1;
  let notice = initGreet;

  for (;;) {
    let pending: null | { kind: "hire" | "dismiss" | "drink" | "chat" | "girl" | "gamble"; arg?: number } = null;

    await new Promise<void>(resolve => {
      let settled = false;

      const done = () => {
        if (settled) return;
        settled = true;
        shell.h.close();
        resolve();
      };

      const shell = createWorkbenchShell(`${portName} · 酒馆`, b.money, done, getBuildingArtUrl(c, 1, b.p));

      const render = () => preserveScroll(shell.h.body, () => {
        shell.moneyPill.textContent = fmtMoneyPill(b.money);
        shell.toastEl.textContent = notice;

        const hasFleet = b.fleetShips() > 0;
        const hiredToday = !!(st.u8(DS.DAILY_FLAGS) & 1);
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
          const split = document.createElement("div");
          split.className = "uw2-split";

          const left = document.createElement("div");
          left.className = "uw2-pane";
          const lt = document.createElement("div");
          lt.className = "uw2-pane-title";
          lt.textContent = "舰队水手概况";
          left.appendChild(lt);

          const list = document.createElement("div");
          list.className = "uw2-list-col";
          const nShips = b.fleetShips();
          for (let i = 0; i < nShips; i++) {
            const slot = c.persons[i] & 0xff;
            const S = b.fleetSlot(slot);
            const shipId = st.u8(S + 7);
            const curCrew = st.u16(S);
            const ship = st.model.ship(shipId);
            const cs = st.model.crewSlot(slot);
            const row = document.createElement("div");
            row.className = "uw2-slot-card";
            row.innerHTML =
              `<span style="font-weight:700;min-width:110px;">${decodeCleanCstr(codec, ship.nameBytes)}</span>` +
              `<span style="font-size:13px;color:var(--uw2-ink-muted);">水手 ${curCrew} / ${ship.maxCrew} · 士气 ${cs.morale}</span>`;
            list.appendChild(row);
          }
          left.appendChild(list);

          const right = document.createElement("div");
          right.className = "uw2-pane";
          const rt = document.createElement("div");
          rt.className = "uw2-pane-title";
          rt.textContent = tab === 0 ? "招募水手" : "解雇水手";
          right.appendChild(rt);

          const box = document.createElement("div");
          box.className = "uw2-action-box";
          const btn = document.createElement("button");
          btn.className = "uw2-btn uw2-btn-primary";
          btn.style.alignSelf = "flex-start";
          btn.disabled = (tab === 0 && (hiredToday || !hasFleet)) || (tab === 1 && !hasFleet);
          btn.textContent = tabLabels[tab] || (tab === 0 ? "水手雇用" : "水手解雇");
          btn.addEventListener("click", () => { pending = { kind: tab === 0 ? "hire" : "dismiss" }; done(); });
          box.append(btn);
          right.appendChild(box);

          split.append(left, right);
          shell.h.body.appendChild(split);
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
              const rec = st.bytes(st.personRecord(pid), 0x32);
              const nm = `${decodeCleanCstr(codec, st.cstr(st.personRecord(pid)))} ${decodeCleanCstr(codec, st.cstr(st.personRecord(pid) + 13))}`.trim();
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
            const face = st.u8(b.girl + 0x10);
            const gName = decodeCleanCstr(codec, b.dstr(b.girl));
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
    if (act.kind === "hire") await b.hire();
    else if (act.kind === "dismiss") await b.dismiss();
    else if (act.kind === "drink") {
      const v = act.arg ?? 1;
      const heat = Math.trunc(((v * 200) & 0xffff) / st.u16(b.eco));
      const d = Math.trunc(domS16(heat * st.u8(b.hero + 0x22)) / 10) + b.tvA;
      b.tvA = Math.min(100, d);
      b.payMoney(domS16(drinkPrice * v));
      await b.rumor(heat);
    } else if (act.kind === "chat") {
      if (act.arg !== undefined) {
        const who = act.arg;
        b.mate = st.personRecord(who);
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
  const c = b.c, st = b.st, m = st.model, codec = c.codec, art = c.art;
  const portName = decodeCleanCstr(codec, m.port(b.port).nameBytes);
  const tabLabels = [...UI_STR.shipyardTabs];
  const remodelLabels = [...UI_STR.remodelTabs];
  const initGreet = capMsg(c, 0x4d);

  // 依原版 rmFigure / rmGuns 规则：每次切换到「船首像」或「武装」子分页时都进行 1/20 稀有品判定（与原版反复进出子菜单刷彩蛋完全一致）
  const E = b.eco, H = b.hero, rng = c.sys.rng;
  let figCount = Math.min(8, Math.trunc(st.u16(E) / 100) + 1);
  let gunCount = Math.min(6, Math.trunc(((st.u16(E + 4) + st.u16(E)) & 0xffff) / 200) + 1);
  let specialNotice = "";
  const rollFigureheads = () => {
    figCount = Math.min(8, Math.trunc(st.u16(E) / 100) + 1);
    if (st.u16(E + 4) > 800 && st.u16(E) > 800 && st.u8(H + 0x23) > 80 && !rng.random(20)) {
      figCount++;
      if (rng.random(st.u8(H + 0x23)) >= 90) figCount++;
      specialNotice = capMsg(c, 0x10a);
      return true;
    }
    return false;
  };
  const rollGuns = () => {
    gunCount = Math.min(6, Math.trunc(((st.u16(E + 4) + st.u16(E)) & 0xffff) / 200) + 1);
    if (st.u16(E + 4) > 900 && st.u16(E) > 900 && st.u8(H + 0x23) > 90 && !rng.random(20)) {
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
  let notice = specialNotice || initGreet;

  for (;;) {
    let pending: null | { kind: "new_ship" | "deliver" | "used_ship" | "ratio"; arg?: number } = null;

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
        const ind = st.u16(E + 4);
        const row = b.BT.levels[st.u8(E + 0x22)];
        const out: number[] = [];
        for (let i = 0; i < 8; i++) {
          const t = row[i];
          if (t === 0xff) break;
          if (((10 * st.u8(b.typeRec(t))) & 0xffff) <= ind) out.push(t);
        }
        return out;
      };

      const getUsedShips = () => {
        const out: { cacheIdx: number; type: number }[] = [];
        for (let i = 0; i < 5; i++) {
          const t = st.u8(DS.TBL_USED_SHIP_CACHE + i);
          if (t !== 0xff) out.push({ cacheIdx: i, type: t });
        }
        return out;
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
            tab = idx; selIdx = 0; replaceSlot = -1;
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
          // ---- 0. 造新船 ----
          const buildDays = st.u8(E + 0x23);
          const types = getBuildableTypes();
          if (selIdx >= types.length) selIdx = Math.max(0, types.length - 1);

          const lt = document.createElement("div");
          lt.className = "uw2-pane-title";
          lt.textContent = buildDays !== 0xff ? `建造中（剩余 ${buildDays} 天）` : `可建造船型（工业 ${st.u16(E + 4)}）`;
          left.appendChild(lt);

          const list = document.createElement("div");
          list.className = "uw2-list-col";
          list.style.maxHeight = "390px";
          types.forEach((t, idx) => {
            const tmpl = m.ship(t + 40);
            const T = b.typeRec(t);
            const basePrice = domS16(st.u16(T + 0x0a));
            const row = document.createElement("button");
            row.className = `uw2-row-card ${idx === selIdx ? "selected" : ""}`;
            row.style.cssText = "display:flex;justify-content:space-between;align-items:center;";
            row.innerHTML = `<span class="uw2-item-name">${decodeCleanCstr(codec, tmpl.nameBytes)}</span><span class="uw2-item-price">${basePrice.toLocaleString()} 金币</span>`;
            row.addEventListener("click", () => { selIdx = idx; render(); });
            list.appendChild(row);
          });
          left.appendChild(list);

          const rt = document.createElement("div");
          rt.className = "uw2-pane-title";
          rt.textContent = tabLabels[0];
          right.appendChild(rt);

          const box = document.createElement("div");
          box.className = "uw2-action-box";
          if (buildDays !== 0xff) {
            const p = document.createElement("div");
            p.style.cssText = "font-size:14px;color:var(--uw2-ink);";
            p.textContent = buildDays > 0 ? capMsg(c, 0x105, buildDays) : capMsg(c, 0x106, 0);
            box.appendChild(p);
            if (buildDays === 0) {
              const delBtn = document.createElement("button");
              delBtn.className = "uw2-btn uw2-btn-primary";
              delBtn.style.alignSelf = "flex-start";
              delBtn.textContent = "领取新船";
              delBtn.addEventListener("click", () => { pending = { kind: "deliver" }; done(); });
              box.appendChild(delBtn);
            }
          } else if (types.length) {
            const t = types[selIdx];
            const tmpl = m.ship(t + 40);
            const T = b.typeRec(t);
            const dur = st.u8(T + 1), turn = st.u8(T + 2), prop = st.u8(T + 3), cap = st.u16(T + 6);
            renderShipHeader(box, t, decodeCleanCstr(codec, tmpl.nameBytes), `耐久 ${dur} · 转向 ${turn} · 推进 ${prop} · 容量 ${cap}`);
            const desc = document.createElement("div");
            desc.className = "uw2-speech-box";
            desc.textContent = capMsg(c, b.BT.typeMsg[t]);
            box.appendChild(desc);

            const goBtn = document.createElement("button");
            goBtn.className = "uw2-btn uw2-btn-primary";
            goBtn.style.alignSelf = "flex-start";
            goBtn.textContent = tabLabels[0];
            goBtn.addEventListener("click", () => { pending = { kind: "new_ship", arg: t }; done(); });
            box.appendChild(goBtn);
          } else {
            box.textContent = capMsg(c, 0xfb);
          }
          right.appendChild(box);
        } else if (tab === 1) {
          // ---- 1. 买旧船 ----
          if (selIdx >= usedList.length) selIdx = Math.max(0, usedList.length - 1);
          const lt = document.createElement("div");
          lt.className = "uw2-pane-title";
          lt.textContent = tabLabels[1];
          left.appendChild(lt);

          const list = document.createElement("div");
          list.className = "uw2-list-col";
          usedList.forEach((u, idx) => {
            const tmpl = m.ship(u.type + 40);
            const price = st.u16(b.typeRec(u.type) + 0x0a);
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
            const T = b.typeRec(u.type);
            renderShipHeader(box, u.type, decodeCleanCstr(codec, tmpl.nameBytes), `耐久 ${st.u8(T + 1)} · 转向 ${st.u8(T + 2)} · 推进 ${st.u8(T + 3)} · 容量 ${st.u16(T + 6)}`);
            const desc = document.createElement("div");
            desc.className = "uw2-speech-box";
            desc.textContent = capMsg(c, b.BT.typeMsg[u.type]);
            box.appendChild(desc);

            const buyBtn = document.createElement("button");
            buyBtn.className = "uw2-btn uw2-btn-primary";
            buyBtn.style.alignSelf = "flex-start";
            buyBtn.textContent = tabLabels[1];
            buyBtn.addEventListener("click", () => { pending = { kind: "used_ship", arg: u.cacheIdx }; done(); });
            box.appendChild(buyBtn);
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
            const S = b.fleetSlot(slot), ship = m.ship(st.u8(S + 7)), T = b.typeRec(ship.type);
            const dmg = domS16(st.u8(S + OFF.DOCK_SLOT.MAX_DURABILITY) - st.u8(S + OFF.DOCK_SLOT.DURABILITY) - st.u8(S + OFF.DOCK_SLOT.TURN) - st.u8(S + OFF.DOCK_SLOT.PROPULSION) + st.u8(T + 2) + st.u8(T + 3));
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
            const S = b.fleetSlot(slot), ship = m.ship(st.u8(S + 7)), T = b.typeRec(ship.type);
            const dur = st.u8(S + OFF.DOCK_SLOT.DURABILITY), maxDur = st.u8(S + OFF.DOCK_SLOT.MAX_DURABILITY);
            const turn = st.u8(S + OFF.DOCK_SLOT.TURN), prop = st.u8(S + OFF.DOCK_SLOT.PROPULSION);
            const dmg = domS16(maxDur - dur - turn - prop + st.u8(T + 2) + st.u8(T + 3));
            const cost = dmg > 0 ? domS16(dmg * 20) : 0;
            renderShipHeader(box, ship.type, decodeCleanCstr(codec, ship.nameBytes), `耐久 ${dur}/${maxDur} · 转向 ${turn}/${st.u8(T + 2)} · 推进 ${prop}/${st.u8(T + 3)}`);

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
              st.set8(S + OFF.DOCK_SLOT.DURABILITY, maxDur);
              st.set8(S + OFF.DOCK_SLOT.TURN, st.u8(T + 2));
              st.set8(S + OFF.DOCK_SLOT.PROPULSION, st.u8(T + 3));
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
            const S = b.fleetSlot(slot), ship = m.ship(st.u8(S + 7));
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
            const S = b.fleetSlot(slot), M = b.crewData(slot), ship = m.ship(st.u8(S + 7));
            const val = Math.trunc(b.shipPrice(slot) / 2);
            const isHeroShip = st.u8(M + 0x1b) === st.hero;
            renderShipHeader(box, ship.type, decodeCleanCstr(codec, ship.nameBytes), `载货 ${b.cargoUsed(slot)} · 水手 ${st.u16(S)}/${ship.maxCrew}`);

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
                const oShip = m.ship(st.u8(b.fleetSlot(os) + 7));
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
              b.b2f5 = isHeroShip ? replaceSlot : 0xff;
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
            const S = b.fleetSlot(slot), ship = m.ship(st.u8(S + 7));
            const row = document.createElement("button");
            row.className = `uw2-row-card ${idx === selIdx ? "selected" : ""}`;
            row.style.cssText = "display:flex;justify-content:space-between;align-items:center;";
            row.innerHTML = `<span class="uw2-item-name">${decodeCleanCstr(codec, ship.nameBytes)}</span><span class="uw2-item-meta">火炮 ${st.u8(S + OFF.DOCK_SLOT.GUNS)}/${ship.maxGuns}</span>`;
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
          const S = b.fleetSlot(slot), M = b.crewData(slot), ship = m.ship(st.u8(S + 7));

          if (rmSub === 0) {
            // 船首像
            if (selFig > figCount) selFig = 1;
            const hexToU8 = (s: string) => Uint8Array.from([...(s.match(/../g) || []).map(h => parseInt(h, 16)), 0]);
            const figTab = (c.portAssets?.data?.build?.figureheads || []).map(hexToU8);
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
              st.set8(M + 0x1d, selFig);
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

            const same = (st.u8(S + OFF.DOCK_SLOT.FLAGS) & 7) === selGun;
            const maxG = ship.maxGuns;
            const curG = st.u8(S + OFF.DOCK_SLOT.GUNS);
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
                st.set8(S + OFF.DOCK_SLOT.GUNS, nextQ);
                st.set8(S + OFF.DOCK_SLOT.FLAGS, (st.u8(S + OFF.DOCK_SLOT.FLAGS) & 0xf8) | (selGun & 0xff));
                b.p.panels();
                notice = `${decodeCleanCstr(codec, b.BT.cannons[selGun])} × ${nextQ}`;
                render();
              });
              box.appendChild(buyG);
            }
          } else if (rmSub === 2) {
            // 积载比例变更
            const cost = domS16(st.u16(b.typeRec(ship.type) + 0x0a));
            const p = document.createElement("div");
            p.style.fontSize = "14px";
            p.textContent = capMsg(c, 0x112, cost);
            const btn = document.createElement("button");
            btn.className = "uw2-btn uw2-btn-primary";
            btn.style.alignSelf = "flex-start";
            btn.textContent = remodelLabels[2];
            btn.addEventListener("click", () => { pending = { kind: "ratio", arg: slot }; done(); });
            box.append(p, btn);
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
                const bts = c.font.encode(nv).subarray(0, 14);
                for (let i = 0; i < bts.length; i++) st.set8(ship.addr + i, bts[i]);
                st.set8(ship.addr + bts.length, 0);
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
          const curInv = st.u16(E + 6);
          const capAmt = b.money >= GameConst.MAX_INVEST ? GameConst.MAX_INVEST : b.money & 0xffff;
          const maxInv = b.isCapital() ? 0 : Math.min(capAmt, Math.max(0, GameConst.MAX_INVEST - curInv));
          if (investAmt > maxInv) investAmt = maxInv;
          const blockMsg = b.isCapital() ? capMsg(c, 2) : curInv >= GameConst.MAX_INVEST ? (investReply || capMsg(c, 7)) : "";
          renderUnifiedInvestPane({
            container: shell.h.body,
            leftTitle: "港口工业",
            rightTitle: tabLabels[5],
            statLabel: "工业价值",
            statValue: st.u16(E + 4),
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
              st.set16(E + 6, st.u16(E + 6) + v);
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

    if (!pending) break;
    const act: { kind: string; arg?: number } = pending;
    b.b2f4 = b.b2f5 = b.b2f6 = b.b2f7 = 0xff;
    b.b2f8 = 0;
    if (act.kind === "deliver") {
      await b.delivery();
    } else if (act.kind === "new_ship") {
      await b.newShip();
    } else if (act.kind === "used_ship") {
      await b.usedShip();
    } else if (act.kind === "ratio" && act.arg !== undefined) {
      const slot = act.arg;
      const ship = m.ship(st.u8(b.fleetSlot(slot) + 7));
      const cost = domS16(st.u16(b.typeRec(ship.type) + 0x0a));
      if (cost <= b.money && (await b.design(slot))) {
        b.money = (b.money - cost) | 0;
        b.p.panels();
      }
    }
    b.after();
    if (st.u8(DS.DAILY_FLAGS) & 2) break;
  }
}

// =========================================================================
// 9. 住宅一体化工作台 (House — 发现物收购 / 地图制作 / 测量技术 / 砲术)
// =========================================================================
export async function runDomHouseWorkbench(house: any): Promise<void> {
  const b = house.b, c = house.c, st = house.st, m = house.m, noble = house.noble;
  const { codec, art, sys } = c;
  const kind = noble.kind;
  const portName = decodeCleanCstr(codec, m.port(b.port).nameBytes);
  const nobleName = decodeCleanCstr(codec, st.cstr(noble.addr));
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
          const unrep = st.u16(WorkDS.EXPLORE_UNREP);
          const total = st.u16(WorkDS.EXPLORE_TOTAL);
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
                st.set16(WorkDS.EXPLORE_UNREP, 0);
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
            const unrep = st.u16(WorkDS.EXPLORE_UNREP);
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
                const total = st.u16(WorkDS.EXPLORE_TOTAL);
                const hd = m.heroInfo();
                hd.adventureFame = (hd.adventureFame + hsUmin((GameConst.MAX_FAME - hd.adventureFame) & 0xffff, Math.imul(5, unrep))) & 0xffff;
                const room = (GameConst.MAX_CASH - house.money) | 0;
                house.money = (house.money + (room > pay ? pay : room)) | 0;
                st.set16(WorkDS.EXPLORE_UNREP, 0);
                b.p.panels();
                if (total >= 3300) {
                  for (let r = 0; r < 45; r++) {
                    for (let k = 0; k < 11; k++) st.set8(WorkDS.EXPLORE_MAP + r * 12 + k, 0xff);
                    st.set8(WorkDS.EXPLORE_MAP + r * 12 + 11, 0xc0);
                  }
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
