// ui/buildings/tavern.ts — 酒馆一体化工作台
import { barmaidByAddr, heroOrDockSlot, personRawBytes } from "../../model/world_helpers.ts";
import { domS16 } from "../../domain/economy.ts";
import { decodeCleanCstr } from "../text_util.ts";
import { getBuildingArtUrl, getPersonPortraitSrc, preserveScroll } from "../modals.ts";
import { UI_STR } from "../strings.ts";
import { capMsg, createWorkbenchShell, fmtMoneyPill, plUmin } from "./shared.ts";
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
