// ui/buildings/church_inn_fortune.ts — 旅馆 / 教会 / 占卜师一体化工作台
import { WorldConst, personRawBytes } from "../../model/world_helpers.ts";
import { decodeCleanCstr } from "../text_util.ts";
import { getBuildingArtUrl, getPersonPortraitSrc, preserveScroll } from "../modals.ts";
import { UI_STR } from "../strings.ts";
import { capMsg, createWorkbenchShell, fmtMoneyPill } from "./shared.ts";
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
