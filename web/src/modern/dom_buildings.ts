// modern/dom_buildings.ts — 與交易所 / 碼頭 / 道具店 1:1 統一規格的六大建築一體化工作台
// 涵蓋：王宮 (Palace)、銀行 (Bank)、事務所 (Office)、旅館 (Inn)、教會 (Church)、占卜師 (Fortune)
// 統一結構：createDomModal(wide) + headerRight(.uw2-pill + 關閉) + .uw2-modal-toolbar(.uw2-tab-btn) + .uw2-split + .uw2-modal-footer
import { DS, OFF } from "../model/schema_views.ts";
import { GameConst, MenuId, OptionFlag, ShipSlotFlag, TreatyFlag, WorkDS } from "../model/flags.ts";
import { domS16, calcDepositLimit, canTakeLoan, calcLoanLimit } from "../domain/economy.ts";
import { captureConsoleText, decodeCleanCstr, toSimp } from "../canvas_ui/text_util.ts";
import { createDomModal, getPersonPortraitSrc, preserveScroll } from "./dom_ui.ts";
import { ENV_COMMON, ENV_HERO } from "../game/scenario.js";
import { mainEnding } from "../game/endgame.js";

const capMsg = (c: any, id: number, ...args: any[]) =>
  toSimp(captureConsoleText(c, () => c.message(id, ...args)).trim());

const fmtMoneyPill = (money: number) => `金块 ${Math.trunc(money / 10000)}  ·  金币 ${money % 10000}`;

const plS16 = (v: number) => (v << 16) >> 16;
const plUmin = (a: number, b: number) => ((a & 0xffff) > (b & 0xffff) ? b & 0xffff : a & 0xffff);
const plUmax = (a: number, b: number) => ((b & 0xffff) >= (a & 0xffff) ? b & 0xffff : a & 0xffff);

function createWorkbenchShell(title: string, money: number, onClose: () => void) {
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

  const toolbar = document.createElement("div");
  toolbar.className = "uw2-modal-toolbar";
  h.modal.insertBefore(toolbar, h.body);

  const footer = document.createElement("div");
  footer.className = "uw2-modal-footer";
  const toastEl = document.createElement("span");
  toastEl.style.cssText = "font-size:13px;font-weight:600;color:#247544;";
  footer.appendChild(toastEl);
  h.modal.appendChild(footer);

  return { h, moneyPill, toolbar, footer, toastEl };
}

// ============================================================================
// 1. 王宮一體化工作台 (Palace)
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

  // 先計算某地區的本國港口清單與收益評估（與 palace.js regionPorts / regionEval 完全一致）
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

  for (;;) {
    let pendingAction: null | "royal_event" | "ship_aid" = null;

    await new Promise<void>(resolve => {
      let settled = false;
      let tab = 0; // 0: 晋见国王, 1: 势力状况, 2: 许可与归化, 3: 王室援助
      let selRegion = 0;
      let notice = initGreet;

      const done = () => {
        if (settled) return;
        settled = true;
        shell.h.close();
        resolve();
      };

      const shell = createWorkbenchShell(`${portName} · 王宫`, palace.money, done);

      const render = () => preserveScroll(shell.h.body, () => {
        shell.moneyPill.textContent = fmtMoneyPill(palace.money);
        shell.toastEl.textContent = notice;

        const same = palace.same(7);
        const c5e = g.commonChap;
        const canNaturalize = !(same || (c5e !== 0 && c5e !== 0xff && plS16(st.u16(WorkDS.CUR_KIND)) >= 6) || (st.u8(WorkDS.FLAGS) & 6));
        const tabs = [
          { label: "晋见国王", disabled: false },
          { label: "势力状况", disabled: false },
          { label: "许可与归化", disabled: false },
          { label: "王室援助", disabled: !same },
        ];

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

        // 左欄：國王與身分概況 / 或地區清單（勢力狀況分頁）
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
            `<div style="font-size:18px;font-weight:700;color:var(--uw2-ink);">${kingName}</div>` +
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

        // 右欄：對應分頁操作
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
          btnAud.textContent = "晋见国王（敕命 / 封爵）";
          btnAud.addEventListener("click", () => {
            pendingAction = "royal_event";
            done();
          });

          const btnSit = document.createElement("button");
          btnSit.className = "uw2-btn";
          btnSit.style.cssText = "padding:9px 18px;align-self:flex-start;";
          btnSit.textContent = "查看本国势力状况";
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

          // 1. 私掠許可證
          const lomBtn = document.createElement("button");
          lomBtn.className = "uw2-row-card";
          lomBtn.textContent = "申请私掠许可证";
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

          // 2. 免稅證
          const tfTarget = (palace.nation + 0x23) & 0xff;
          let tfCostW = 0;
          if (!palace.same()) tfCostW = 11 - hd.rank;
          else if (hd.rank < 6) tfCostW = 7 - hd.rank;
          tfCostW = plS16(tfCostW);

          const tfBtn = document.createElement("button");
          tfBtn.className = "uw2-row-card";
          tfBtn.disabled = !palace.same();
          tfBtn.textContent = tfCostW > 0 ? `申请免税证（需 ${tfCostW} 块金块）` : "申请免税证（免费）";
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

          // 3. 申請國籍（歸化）
          const natBtn = document.createElement("button");
          natBtn.className = "uw2-row-card";
          natBtn.disabled = !canNaturalize;
          natBtn.textContent = same ? "已为本国国籍" : "申请归化入籍";
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
          const v = country.aidMoneyK;
          fundsBtn.textContent = v ? `领取资金援助（${(v * 1000).toLocaleString()} 金币）` : "资金援助（暂无）";
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
          shipBtn.textContent = country.aidShipCount
            ? `领取船舶援助（${decodeCleanCstr(codec, m.ship(country.aidShipType + 40).nameBytes)}）`
            : "船舶援助（暂无）";
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
// 2. 銀行一體化工作台 (Bank)
// ============================================================================
export function runDomBankWorkbench(bank: any): Promise<void> {
  const b = bank.b, c = bank.c, m = bank.m, g = m.globals, codec = c.codec;
  const portName = decodeCleanCstr(codec, m.port(b.port).nameBytes);
  const tabLabels = c.menuItems(MenuId.BANK).slice(0, 4).map((raw: Uint8Array) => decodeCleanCstr(codec, raw).replace(/\s+/g, ""));
  const initGreet = b.noEvent()
    ? (b.port === GameConst.VENICE_PORT_ID ? capMsg(c, 0x61) : capMsg(c, 0x62, m.port(b.port).nameBytes))
    : "";

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

    const shell = createWorkbenchShell(`${portName} · 银行`, bank.money, done);

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

      // 左欄：帳戶狀態
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

      // 右欄：金額滑桿與確認
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
// 3. 事務所一體化工作台 (Office — 補齊原先不可見的各國情報表)
// ============================================================================
export async function runDomOfficeWorkbench(office: any): Promise<void> {
  const b = office.b, c = office.c, st = office.st, m = office.m, g = m.globals, codec = c.codec;
  const portName = decodeCleanCstr(codec, m.port(b.port).nameBytes);
  const tabLabels = c.menuItems(1).slice(0, 2).map((raw: Uint8Array) => decodeCleanCstr(codec, raw).replace(/\s+/g, ""));
  const nationNames = office.nations.slice(0, 6).map((raw: Uint8Array) => decodeCleanCstr(codec, raw).replace(/\s+/g, ""));
  const initGreet = b.noEvent() ? capMsg(c, 0x55) : "";

  for (;;) {
    let pickJobIdx = -1;
    let askJobHint = false;

    await new Promise<void>(resolve => {
      let settled = false;
      let tab = 0; // 0: 工作介绍, 1: 各国情报
      let selNation = 0;
      let paidNation = -1;
      let notice = initGreet;

      const done = () => {
        if (settled) return;
        settled = true;
        shell.h.close();
        resolve();
      };

      const shell = createWorkbenchShell(`${portName} · 事务所`, b.money, done);

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
            tip.textContent = "点击左侧委托即可听取详情并决定是否接受。";
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
// 4. 旅館一體化工作台 (Inn — 補齊原先不可見的海港支持度表)
// ============================================================================
export async function runDomInnWorkbench(b: any): Promise<void> {
  const c = b.c, st = b.st, codec = c.codec, art = c.art;
  const portName = decodeCleanCstr(codec, st.model.port(b.port).nameBytes);
  const tabLabels = c.menuItems(4).map((raw: Uint8Array) => decodeCleanCstr(codec, raw).replace(/\s+/g, ""));
  let isCapital = false;
  for (let i = 0; i < 6; i++) if (st.u8(DS.TBL_COUNTRY + i * 0x20 + 0x0a) === b.port) isCapital = true;
  const initGreet = b.noEvent() ? capMsg(c, 0x42) : "";

  for (;;) {
    let talkTarget = -1;
    let doSleep = false;

    await new Promise<void>(resolve => {
      let settled = false;
      let tab = 0;
      let notice = initGreet;

      const done = () => {
        if (settled) return;
        settled = true;
        shell.h.close();
        resolve();
      };

      const shell = createWorkbenchShell(`${portName} · 旅馆`, b.money, done);

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
          const p = document.createElement("div");
          p.style.cssText = "font-size:14px;color:var(--uw2-ink);";
          p.textContent = "在旅馆休息至次日清晨。";
          const btn = document.createElement("button");
          btn.className = "uw2-btn uw2-btn-primary";
          btn.style.alignSelf = "flex-start";
          btn.textContent = tabLabels[2] || "就寝";
          btn.addEventListener("click", () => { doSleep = true; done(); });
          box.append(p, btn);
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
// 5. 教會 / 清真寺一體化工作台 (Church)
// ============================================================================
export function runDomChurchWorkbench(b: any, base: number): Promise<void> {
  const c = b.c, st = b.st, codec = c.codec;
  const portName = decodeCleanCstr(codec, st.model.port(b.port).nameBytes);
  const tabLabels = c.menuItems(7).map((raw: Uint8Array) => decodeCleanCstr(codec, raw).replace(/\s+/g, ""));
  const initGreet = b.noEvent() ? capMsg(c, base + 0x5b) : "";

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

    const shell = createWorkbenchShell(`${portName} · ${b.mosque ? "清真寺" : "教会"}`, b.money, done);

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
// 6. 占卜師一體化工作台 (Fortune)
// ============================================================================
export function runDomFortuneWorkbench(b: any): Promise<void> {
  const c = b.c, st = b.st, codec = c.codec;
  const portName = decodeCleanCstr(codec, st.model.port(b.port).nameBytes);
  const tabLabels = c.menuItems(17).map((raw: Uint8Array) => decodeCleanCstr(codec, raw).replace(/\s+/g, ""));
  const initGreet = b.noEvent() ? capMsg(c, 0x12a) : "";

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

    const shell = createWorkbenchShell(`${portName} · 占卜师`, b.money, done);

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
// 7. 酒館一體化工作台 (Tavern — 與交易所 / 碼頭 / 道具店 / 王宮 1:1 統一結構)
// ============================================================================
export async function runDomTavernWorkbench(b: any, drinkNameBytes: Uint8Array, onGamble: () => Promise<void>): Promise<void> {
  const c = b.c, st = b.st, codec = c.codec, art = c.art;
  const portName = decodeCleanCstr(codec, st.model.port(b.port).nameBytes);
  const tabLabels = c.menuItems(15).map((raw: Uint8Array) => decodeCleanCstr(codec, raw).replace(/\s+/g, ""));
  const drinkName = decodeCleanCstr(codec, drinkNameBytes);
  const k = st.u8(b.eco + 0x24);
  const drinkPrice = b.T.liquorPrice[k];
  const initGreet = b.noEvent() ? capMsg(c, 0x12, drinkNameBytes) : "";

  for (;;) {
    let pending: null | { kind: "hire" | "dismiss" | "drink" | "chat" | "girl" | "gamble"; arg?: number } = null;

    await new Promise<void>(resolve => {
      let settled = false;
      let tab = 2; // 預設停在「飲酒敘話」或第一個可用分頁
      if (b.fleetShips() && !(st.u8(DS.DAILY_FLAGS) & 1)) tab = 0;
      let rounds = 1;
      let notice = initGreet;

      const done = () => {
        if (settled) return;
        settled = true;
        shell.h.close();
        resolve();
      };

      const shell = createWorkbenchShell(`${portName} · 酒馆`, b.money, done);

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
            const shipId = st.u8(b.fleetSlot(slot) + 7);
            const ship = st.model.ship(shipId);
            const cs = st.model.crewSlot(slot);
            const row = document.createElement("div");
            row.className = "uw2-slot-card";
            row.innerHTML =
              `<span style="font-weight:700;min-width:110px;">${decodeCleanCstr(codec, ship.nameBytes)}</span>` +
              `<span style="font-size:13px;color:var(--uw2-ink-muted);">水手 ${cs.crew} / ${ship.maxCrew} · 士气 ${cs.morale}</span>`;
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
          const p = document.createElement("div");
          p.style.cssText = "font-size:14px;color:var(--uw2-ink);";
          p.textContent = tab === 0
            ? (hiredToday ? "今日已在本港招募过水手。" : "前往酒馆柜台招募各舰水手。")
            : "选择要解雇水手的舰船与人数。";
          const btn = document.createElement("button");
          btn.className = "uw2-btn uw2-btn-primary";
          btn.style.alignSelf = "flex-start";
          btn.disabled = (tab === 0 && (hiredToday || !hasFleet)) || (tab === 1 && !hasFleet);
          btn.textContent = tabLabels[tab] || (tab === 0 ? "雇用水手" : "解雇水手");
          btn.addEventListener("click", () => { pending = { kind: tab === 0 ? "hire" : "dismiss" }; done(); });
          box.append(p, btn);
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

          const n = b.portPersons();
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
              card.addEventListener("click", () => { pending = { kind: "chat" }; done(); });
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
            nm.style.cssText = "font-size:18px;font-weight:700;color:var(--uw2-ink);";
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
          const p = document.createElement("div");
          p.style.cssText = "font-size:14px;color:var(--uw2-ink);";
          p.textContent = "在酒馆赌桌参与 21 点或骰子赌局。";
          const btn = document.createElement("button");
          btn.className = "uw2-btn uw2-btn-primary";
          btn.style.alignSelf = "flex-start";
          btn.textContent = tabLabels[5] || "赌博";
          btn.addEventListener("click", () => { pending = { kind: "gamble" }; done(); });
          box.append(p, btn);
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
    } else if (act.kind === "chat") await b.chat();
    else if (act.kind === "girl") await b.barGirl();
    else if (act.kind === "gamble") await onGamble();
    b.after();
  }
}
