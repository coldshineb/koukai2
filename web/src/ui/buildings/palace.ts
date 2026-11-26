// ui/buildings/palace.ts — 王宫一体化工作台
import { GameConst, OptionFlag, ShipSlotFlag } from "../../model/flags.ts";
import { getCashCap } from "../../core/prefs.ts";
import { getCountryExtra, getWorkState, writeShipName } from "../../model/world_helpers.ts";
import { ENV_COMMON, ENV_HERO } from "../../game/scenario.js";
import { mainEnding } from "../../game/endgame.js";
import { captureConsoleText, decodeCleanCstr, toSimp } from "../text_util.ts";
import { encodeTextForFont } from "../t2s.ts";
import { getBuildingArtUrl, preserveScroll } from "../modals.ts";
import { UI_STR } from "../strings.ts";
import { capMsg, createWorkbenchShell, fmtMoneyPill, plS16, plUmax, plUmin } from "./shared.ts";
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
  let permConfirm: null | "taxFree" | "naturalize" = null;
  let aidNamingOpen = false;
  let aidShipName = "";
  let notice = initGreet;

  for (;;) {
    let pendingAction: null | "royal_event" = null;

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
          btn.addEventListener("click", () => { tab = idx; permConfirm = null; aidNamingOpen = false; render(); });
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
          speech.style.cssText = "font-size:14px;line-height:1.65;white-space:pre-line;color:var(--uw2-ink);padding:8px 10px;border-radius:6px;background:rgba(255,252,242,0.72);border:1px solid rgba(154,119,56,0.24);";
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
            permConfirm = null;
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
            permConfirm = null;
            const slot = palace.invSlot(tfTarget);
            if (slot === -1) { notice = capMsg(c, 0x368); render(); return; }
            if (slot === -2) { notice = capMsg(c, 0x361); render(); return; }
            permConfirm = "taxFree";
            const parts = [capMsg(c, 0x369)];
            if (c.rt.month % 6 < 3) parts.push(capMsg(c, 0x36a));
            parts.push(tfCostW > 0 ? capMsg(c, 0x36d, tfCostW) : capMsg(c, 0x36b));
            notice = parts.join("\n");
            render();
          });

          // 3. 申请国籍（归化）
          const natBtn = document.createElement("button");
          natBtn.className = "uw2-row-card";
          natBtn.disabled = !canNaturalize;
          natBtn.textContent = UI_STR.palaceActions.naturalize;
          natBtn.addEventListener("click", () => {
            permConfirm = "naturalize";
            notice = capMsg(c, 0x1ca, palace.heroName());
            render();
          });

          box.append(lomBtn, tfBtn, natBtn);

          if (permConfirm) {
            const cCard = document.createElement("div");
            cCard.className = "uw2-action-box";
            cCard.style.cssText = "margin-top:6px;padding:12px;border-radius:8px;background:rgba(255,252,242,0.85);border:1px solid rgba(154,119,56,0.34);";
            const actRow = document.createElement("div");
            actRow.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";

            const noBtn = document.createElement("button");
            noBtn.type = "button";
            noBtn.className = "uw2-btn";
            noBtn.textContent = "否";
            noBtn.addEventListener("click", () => {
              const kind = permConfirm;
              permConfirm = null;
              notice = kind === "naturalize" ? capMsg(c, 0x1cb) : initGreet;
              render();
            });

            const yesBtn = document.createElement("button");
            yesBtn.type = "button";
            yesBtn.className = "uw2-btn uw2-btn-primary";
            yesBtn.textContent = "是";
            yesBtn.addEventListener("click", () => {
              const kind = permConfirm;
              permConfirm = null;
              if (kind === "taxFree") {
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
                return;
              }
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

            actRow.append(noBtn, yesBtn);
            cCard.appendChild(actRow);
            box.appendChild(cCard);
          }

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
            aidNamingOpen = false;
            if (!country.aidMoneyK) { notice = capMsg(c, 0x1cd); render(); return; }
            if (palace.money + country.aidMoneyK * 1000 > getCashCap(c)) { notice = capMsg(c, 0x212); render(); return; }
            const amtK = country.aidMoneyK;
            palace.money = (palace.money + amtK * 1000) | 0;
            country.aidMoneyK = 0;
            b.p.panels();
            notice = `${capMsg(c, 0x1ce, amtK)}\n${capMsg(c, 0x1cf)}`;
            render();
          });

          const shipBtn = document.createElement("button");
          shipBtn.className = "uw2-row-card";
          shipBtn.textContent = UI_STR.palaceActions.shipAid;
          shipBtn.addEventListener("click", () => {
            if (!country.aidShipCount) { notice = capMsg(c, 0x1cd); render(); return; }
            b.freeSlots();
            if (plS16(c.persons[0]) < 10 || b.fleetShips() >= GameConst.FLEET_SHIPS) {
              notice = capMsg(c, 0x213);
              render();
              return;
            }
            if (!palace.mates()) {
              notice = capMsg(c, 0x214);
              render();
              return;
            }
            const tag = b.port | 0x80;
            for (let i = 0; i < 40; i++) {
              if (m.crewSlot(i).captain === tag && b.slotState(i) === ShipSlotFlag.BUILDING) {
                notice = capMsg(c, 0x1cd);
                render();
                return;
              }
            }
            const tmpl = m.ship(country.aidShipType + 40);
            aidShipName = decodeCleanCstr(codec, tmpl.nameBytes);
            aidNamingOpen = true;
            notice = `${capMsg(c, 0x1d0, tmpl.nameBytes)}\n${capMsg(c, 0x22b)}`;
            render();
          });

          box.append(fundsBtn, shipBtn);

          if (aidNamingOpen) {
            const tmpl = m.ship(country.aidShipType + 40);
            const shipTypeName = decodeCleanCstr(codec, tmpl.nameBytes);
            const card = document.createElement("div");
            card.className = "uw2-action-box";
            card.style.cssText = "margin-top:6px;padding:12px;border-radius:8px;background:rgba(255,252,242,0.85);border:1px solid rgba(154,119,56,0.34);";

            const hdr = document.createElement("div");
            hdr.className = "uw2-detail-title";
            hdr.style.fontSize = "14px";
            hdr.textContent = `${shipTypeName} · 命名`;

            const inp = document.createElement("input");
            inp.type = "text";
            inp.className = "uw2-amount-input";
            inp.style.width = "100%";
            inp.maxLength = 14;
            inp.value = aidShipName;
            inp.addEventListener("input", () => { aidShipName = inp.value; });

            const actRow = document.createElement("div");
            actRow.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";

            const cancelBtn = document.createElement("button");
            cancelBtn.type = "button";
            cancelBtn.className = "uw2-btn";
            cancelBtn.textContent = "取消";
            cancelBtn.addEventListener("click", () => {
              aidNamingOpen = false;
              notice = initGreet;
              render();
            });

            const okBtn = document.createElement("button");
            okBtn.type = "button";
            okBtn.className = "uw2-btn uw2-btn-primary";
            okBtn.textContent = "确认";
            okBtn.addEventListener("click", () => {
              const trimmed = inp.value.trim();
              let nameBytes = tmpl.nameBytes;
              if (trimmed) {
                const enc = encodeTextForFont(c.font, trimmed);
                if (!enc) {
                  notice = capMsg(c, 0x22b);
                  render();
                  return;
                }
                nameBytes = enc;
              }
              const shipIdx = palace.makeShip(country.aidShipType);
              country.aidShipCount--;
              if (typeof shipIdx === "number") writeShipName(m.ship(shipIdx), nameBytes);
              b.p.panels();
              aidNamingOpen = false;
              notice = `${capMsg(c, 0x228)}\n${capMsg(c, 0x1cf)}`;
              render();
            });

            actRow.append(cancelBtn, okBtn);
            card.append(hdr, inp, actRow);
            box.appendChild(card);
          }

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
    break;
  }
}
