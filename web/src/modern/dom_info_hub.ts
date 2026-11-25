// modern/dom_info_hub.ts — F1「情報中心」一體化多標籤頁工作台 +「隨身物」一體化面板
// 與「讀取進度 (save_modal.ts)」1:1 同套暖羊皮紙視覺，徹底消滅多層嵌套選單，並完整呈現所有原版插圖
// （發現物插圖、道具插圖、高清船圖、船首像、具名與 5 層拼合人物頭像）。100% 原版遊戲文本。
import { DS, OFF } from "../model/schema_views.ts";
import { WorkDS } from "../model/flags.ts";
import { ListSelect } from "../ui/listsel.js";
import { captureConsoleText, decodeCleanCstr } from "../canvas_ui/text_util.ts";
import { runWideWorldChart } from "../canvas_ui/wide_panels.ts";
import { createDomModal, getPersonPortraitSrc } from "./dom_ui.ts";

const s16 = (v: number) => (v << 16) >> 16;
const umin = (a: number, b: number) => ((a & 0xffff) > (b & 0xffff) ? b & 0xffff : a & 0xffff);

/** F1 情報中心：10 項原版情報全部平鋪為一體化標籤頁，零嵌套選單 */
export async function runDomInfoHub(cmd: any): Promise<void> {
  const c = cmd.c, st = cmd.st, b = cmd.b, p = cmd.p, art = c.art;
  const dec = (bts: Uint8Array) => decodeCleanCstr(c.codec, bts);
  const cap = (fn: () => void) => captureConsoleText(c, fn);
  const tabLabels: string[] = c.menuItems(0x1a).slice(0, 10).map(dec);
  const infoTitle = c.menuItems(0x19)?.[0] ? dec(c.menuItems(0x19)[0]) : tabLabels[0];

  const hasShips = () => b.fleetShips() > 0;
  const hasCargo = () => !!cmd.anyCargo();
  const hasDisc = () => !!cmd.discList(1);
  const hasWorld = () => !!st.u16(WorkDS.EXPLORE_TOTAL);
  const hasLog = () => st.u16(DS.TRADE_LOGS) !== 0xffff;
  const inPort = () => st.port !== 0xff;

  const isDisabled = (idx: number): boolean => {
    if (idx === 0 || idx === 1) return !hasShips();
    if (idx === 4 || idx === 5) return !hasShips() || !hasCargo();
    if (idx === 6) return !hasDisc();
    if (idx === 7) return !hasWorld();
    if (idx === 8) return !hasLog();
    if (idx === 9) return !inPort();
    return false;
  };

  let activeTab = hasShips() ? 0 : 3;
  let selShipIdx = 0;
  let selPersonIdx = 0;
  let selCargoShipIdx = 0;
  let selGoodIdx = 0;
  let selDiscIdx = 0;

  for (;;) {
    const extAction = await new Promise<"close" | "world" | "portMap">(resolve => {
      let settled = false;
      const done = (act: "close" | "world" | "portMap") => {
        if (settled) return;
        settled = true;
        h.close();
        resolve(act);
      };

      const h = createDomModal({
        title: infoTitle,
        size: "wide",
        cancelable: true,
        closeLabel: "关闭",
        onCancel: () => done("close"),
      });

      const toolbar = document.createElement("div");
      toolbar.className = "uw2-modal-toolbar";
      h.modal.insertBefore(toolbar, h.body);

      const render = () => {
        if (isDisabled(activeTab)) activeTab = hasShips() ? 0 : 3;

        toolbar.innerHTML = "";
        tabLabels.forEach((lb, i) => {
          const btn = document.createElement("button");
          btn.className = `uw2-btn uw2-tab-btn ${i === activeTab ? "active" : ""}`;
          btn.disabled = isDisabled(i);
          btn.textContent = lb;
          btn.addEventListener("click", () => {
            if (i === 7) { done("world"); return; }
            if (i === 9) { done("portMap"); return; }
            activeTab = i;
            render();
          });
          toolbar.appendChild(btn);
        });

        h.body.innerHTML = "";

        if (activeTab === 0) renderFleetTab(h.body);
        else if (activeTab === 1) renderShipTab(h.body);
        else if (activeTab === 2) renderPersonTab(h.body);
        else if (activeTab === 3) renderLordTab(h.body);
        else if (activeTab === 4) renderCargoShipTab(h.body);
        else if (activeTab === 5) renderCargoSummaryTab(h.body);
        else if (activeTab === 6) renderDiscoveryTab(h.body);
        else if (activeTab === 8) renderLogTab(h.body);
      };

      // ---- Tab 0: 自艦隊情報 ----
      const renderFleetTab = (root: HTMLElement) => {
        const f = st.u8(st.personRecord(st.hero) + 0x2c);
        const F = DS.TBL_FLEET + f * 0x85;
        const A = st.personRecord(st.u8(F + OFF.FLEET.ADMIRAL));
        const T = cmd.T;
        const wind = Math.abs(((st.u8(DS.PORT_FLAGS) & 0x38) >> 3) - st.u8(F + OFF.FLEET.DIR)) & 0xff;
        const WT = T.windSpeed, wbase = wind << 3;
        let best = 10000, slow = F + OFF.FLEET.SHIPS, sumSail = 0, sumGuns = 0, sumX = 0, minDur = 100;

        const grid = document.createElement("div");
        grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:10px;";

        for (let i = 0; i < 10; i++) {
          const S = F + OFF.FLEET.SHIPS + i * 9;
          if ((st.u8(S + OFF.DOCK_SLOT.FLAGS) & 0x30) !== 0x10) continue;
          const ship = DS.TBL_SHIP + st.u8(S + OFF.DOCK_SLOT.SHIP) * 0x16;
          const t = st.u8(ship + 0x0f), TR = DS.TBL_SHIP_TYPE + t * 0x0c;
          const minS = st.u8(TR + 5), sail = s16(st.u16(S));
          sumSail = (sumSail + st.u16(S)) & 0xffff;
          const M = b.crewData(i);
          const r8 = st.u8(M + OFF.CREW_SLOT.NAV_RATIO);
          const r9 = st.u8(M + OFF.CREW_SLOT.LOOK_RATIO);
          const w = s16(st.u16(M + OFF.CREW_SLOT.LOAD_TOTAL));
          const capId = st.u8(M + OFF.CREW_SLOT.CAPTAIN);
          const maxw = s16(st.u16(TR + 6)), s5 = st.u8(S + OFF.DOCK_SLOT.PROPULSION);
          const CP = st.personRecord(capId), pc = st.u8(CP + 0x24), pd = st.u8(CP + 0x1d);
          sumGuns = (sumGuns + st.u8(S + OFF.DOCK_SLOT.GUNS)) & 0xffff;
          const deck = umin(300, Math.trunc(s16((100 - r9 - r8) * sail) / 100) & 0xffff);
          const k = st.u8(S + OFF.DOCK_SLOT.FLAGS) & 7;
          const g = Math.trunc((umin(st.u8(S + OFF.DOCK_SLOT.GUNS), deck) * ((2 * T.gunA[k] + T.gunB[k]) & 0xffff)) / 10) & 0xffff;
          sumX = (sumX + 2 * st.u8(S + OFF.DOCK_SLOT.DURABILITY) + g + deck) & 0xffff;
          const di2 = s16(WT[wbase + t] * s5);
          const q = umin(100, Math.trunc((r9 * sail) / (minS || 1)) & 0xffff);
          const cc = umin(150, (180 - umin(180, Math.trunc(s16(100 * w) / (maxw || 1)) & 0xffff)) & 0xffff);
          const x = Math.trunc(s16(q * di2) / 100) & 0xffff;
          const di3 = Math.trunc(((x * cc) >>> 0) / 100) & 0xffff;
          const v = umin(30, (Math.trunc(s16(di3 * pc) / 10) + di3) & 0xffff);
          const sp = umin(40, Math.trunc(s16(v * pd) / 75) & 0xffff);
          if (sp < best) { best = sp; slow = S; }
          if (st.u8(S + OFF.DOCK_SLOT.DURABILITY) < minDur) minDur = st.u8(S + OFF.DOCK_SLOT.DURABILITY);

          const card = document.createElement("button");
          card.className = "uw2-pers-card";
          card.style.cssText = "padding:10px;gap:6px;text-align:center;";
          const shipUrl = art?.shipUrl?.(t);
          if (shipUrl) {
            const img = document.createElement("img");
            img.src = shipUrl;
            img.style.cssText = "width:100%;height:74px;object-fit:contain;border-radius:6px;background:#0e1b30;border:1px solid var(--uw2-gold);padding:4px;";
            card.appendChild(img);
          }
          const nm = document.createElement("div");
          nm.style.cssText = "font-weight:700;font-size:14px;color:var(--uw2-ink);";
          nm.textContent = dec(st.cstr(ship));
          const sub = document.createElement("div");
          sub.className = "uw2-slot-sub";
          sub.textContent = `${st.u8(S + OFF.DOCK_SLOT.DURABILITY)}/${st.u8(S + OFF.DOCK_SLOT.MAX_DURABILITY)} · ${st.u16(S)} · ${st.u8(S + OFF.DOCK_SLOT.GUNS)}`;
          card.append(nm, sub);
          const targetIdx = grid.children.length;
          card.addEventListener("click", () => { selShipIdx = targetIdx; activeTab = 1; render(); });
          grid.appendChild(card);
        }

        const summary = document.createElement("div");
        summary.className = "uw2-action-box";
        summary.style.cssText = "flex-direction:row;align-items:center;gap:16px;";
        const pImg = document.createElement("img");
        pImg.className = "uw2-portrait-img";
        void getPersonPortraitSrc(art, st.bytes(A, 0x32)).then(src => { if (src) pImg.src = src; });
        summary.appendChild(pImg);

        const col1 = document.createElement("div");
        col1.style.cssText = "flex:1;display:flex;flex-direction:column;gap:4px;font-size:14px;font-weight:600;";
        for (const l of [
          cap(() => c.message(0x397, st.cstr(A))),
          cap(() => c.message(0x398, st.u8(A + OFF.PERSON.NAV_LEVEL))),
          cap(() => c.message(0x399, st.u8(A + OFF.PERSON.BATTLE_LEVEL))),
        ]) {
          const d = document.createElement("div");
          d.textContent = l;
          col1.appendChild(d);
        }
        const col2 = document.createElement("div");
        col2.style.cssText = "flex:1.4;display:flex;flex-direction:column;gap:4px;font-size:14px;font-weight:600;";
        for (const l of [
          cap(() => c.message(0x39a, st.u8(slow + 4), sumSail)),
          cap(() => c.message(0x39b, st.u8(slow + 5), sumGuns)),
          cap(() => c.message(0x39c, minDur, sumX)),
        ]) {
          const d = document.createElement("div");
          d.textContent = l;
          col2.appendChild(d);
        }
        summary.append(col1, col2);
        root.append(grid, summary);
      };

      // ---- Tab 1: 艦船情報 ----
      const renderShipTab = (root: HTMLElement) => {
        const n = b.fleetShips();
        const slots: number[] = [];
        for (let i = 0; i < n; i++) slots.push(c.persons[i] & 0xff);
        if (selShipIdx >= slots.length) selShipIdx = Math.max(0, slots.length - 1);

        const split = document.createElement("div");
        split.className = "uw2-split narrow-left";
        const left = document.createElement("div");
        left.className = "uw2-list-col";
        slots.forEach((slot, i) => {
          const ship = DS.TBL_SHIP + st.u8(b.fleetSlot(slot) + 7) * 0x16;
          const btn = document.createElement("button");
          btn.className = `uw2-row-card ${i === selShipIdx ? "selected" : ""}`;
          btn.textContent = dec(st.cstr(ship));
          btn.addEventListener("click", () => { selShipIdx = i; render(); });
          left.appendChild(btn);
        });

        const right = document.createElement("div");
        right.className = "uw2-pane";
        if (slots.length) {
          const slot = slots[selShipIdx];
          const data = cmd.shipInfo(slot, 0x0f);
          if (data) {
            const topRow = document.createElement("div");
            topRow.className = "uw2-action-box";
            topRow.style.cssText = "flex-direction:row;align-items:center;gap:12px;";
            const shipUrl = art?.shipUrl?.(data.typeId);
            if (shipUrl) {
              const img = document.createElement("img");
              img.src = shipUrl;
              img.style.cssText = "width:170px;height:108px;object-fit:contain;border-radius:8px;background:#0e1b30;border:1px solid var(--uw2-gold);padding:6px;flex-shrink:0;";
              topRow.appendChild(img);
            }
            if (data.figureheadId) {
              const fhUrl = art?.figureheadUrl?.(data.figureheadId);
              if (fhUrl) {
                const fImg = document.createElement("img");
                fImg.src = fhUrl;
                fImg.style.cssText = "width:64px;height:80px;object-fit:contain;border-radius:6px;background:#0e1b30;border:1px solid var(--uw2-gold);image-rendering:pixelated;flex-shrink:0;";
                topRow.appendChild(fImg);
              }
            }
            const supNames = b.LO?.supplies ? b.LO.supplies.map(dec) : dec(b.WF.supplyHdr).split(/\s+/).filter(Boolean).slice(0, 4);
            const supGrid = document.createElement("div");
            supGrid.style.cssText = "flex:1;display:grid;grid-template-columns:repeat(2,1fr);gap:6px;";
            for (let k = 0; k < 4; k++) {
              const box = document.createElement("div");
              box.className = "uw2-slot-card";
              box.style.padding = "6px 10px";
              box.innerHTML = `<span class="uw2-slot-sub">${supNames[k] || ""}</span><span style="font-weight:700;font-size:14px;">${data.supplies?.[k] ?? 0}</span>`;
              supGrid.appendChild(box);
            }
            topRow.appendChild(supGrid);

            const bodySplit = document.createElement("div");
            bodySplit.className = "uw2-split";
            const infoBox = document.createElement("div");
            infoBox.className = "uw2-action-box";
            for (const l of data.leftLines) {
              const d = document.createElement("div");
              d.style.cssText = "font-size:13px;line-height:1.5;color:var(--uw2-ink);";
              d.textContent = l;
              infoBox.appendChild(d);
            }
            const barBox = document.createElement("div");
            barBox.className = "uw2-action-box";
            for (const br of data.bars) {
              const pct = br.max > 0 ? Math.min(100, Math.round((br.cur / br.max) * 100)) : 0;
              const row = document.createElement("div");
              row.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;margin-bottom:3px;"><span>${br.label}</span><span>${br.cur} / ${br.max}</span></div><div class="uw2-bar-track"><div class="uw2-bar-fill" style="width:${pct}%"></div></div>`;
              barBox.appendChild(row);
            }
            bodySplit.append(infoBox, barBox);
            right.append(topRow, bodySplit);
          }
        }
        split.append(left, right);
        root.appendChild(split);
      };

      // ---- Tab 2: 人物情報 ----
      const renderPersonTab = (root: HTMLElement) => {
        const n = b.captainPool();
        const pids: number[] = [];
        for (let i = 0; i < n; i++) pids.push(c.persons[i] & 0xff);
        if (selPersonIdx >= pids.length) selPersonIdx = Math.max(0, pids.length - 1);

        const split = document.createElement("div");
        split.className = "uw2-split narrow-left";
        const left = document.createElement("div");
        left.className = "uw2-list-col";
        pids.forEach((pid, i) => {
          const P = st.personRecord(pid);
          const btn = document.createElement("button");
          btn.className = `uw2-row-card ${i === selPersonIdx ? "selected" : ""}`;
          btn.innerHTML = `<span style="font-weight:700;">${dec(st.cstr(P))}</span><span class="uw2-slot-sub">${dec(b.T.crewRoles[st.u8(P + 0x2e)])}</span>`;
          btn.addEventListener("click", () => { selPersonIdx = i; render(); });
          left.appendChild(btn);
        });

        const right = document.createElement("div");
        right.className = "uw2-pane";
        if (pids.length) {
          const data = cmd.personInfo(pids[selPersonIdx], 0x0f, 1);
          if (data) {
            const top = document.createElement("div");
            top.className = "uw2-action-box";
            top.style.cssText = "flex-direction:row;align-items:center;gap:14px;";
            const img = document.createElement("img");
            img.className = "uw2-portrait-img";
            img.style.cssText = "width:80px;height:100px;";
            void getPersonPortraitSrc(art, data.personBytes).then(src => { if (src) img.src = src; });
            top.appendChild(img);
            const hCol = document.createElement("div");
            hCol.style.cssText = "display:flex;flex-direction:column;gap:4px;";
            data.headerLines.forEach((l: string, idx: number) => {
              const d = document.createElement("div");
              d.style.cssText = idx === 0 ? "font-size:18px;font-weight:700;" : "font-size:13px;color:var(--uw2-ink-muted);";
              d.textContent = l;
              hCol.appendChild(d);
            });
            top.appendChild(hCol);

            const bodySplit = document.createElement("div");
            bodySplit.className = "uw2-split";
            const sBox = document.createElement("div");
            sBox.className = "uw2-action-box";
            for (const s of data.stats) {
              const row = document.createElement("div");
              row.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;margin-bottom:2px;"><span>${s.label}</span><span>${s.val}</span></div><div class="uw2-bar-track"><div class="uw2-bar-fill ${s.val >= 80 ? "" : "green"}" style="width:${Math.min(100, s.val)}%"></div></div>`;
              sBox.appendChild(row);
            }
            const dBox = document.createElement("div");
            dBox.className = "uw2-action-box";
            for (const dl of data.detailLines) {
              const d = document.createElement("div");
              d.style.cssText = "font-size:13px;line-height:1.6;color:var(--uw2-ink);";
              d.textContent = dl;
              dBox.appendChild(d);
            }
            bodySplit.append(sBox, dBox);
            right.append(top, bodySplit);
          }
        }
        split.append(left, right);
        root.appendChild(split);
      };

      // ---- Tab 3: 主公情報 ----
      const renderLordTab = (root: HTMLElement) => {
        const lab = c.menuItems(0x2a), H = DS.TBL_HERO_DATA + st.hero * 0x0e;
        const money = (st.u16(DS.MONEY) | (st.u16(0x12b0) << 16)) | 0;
        const heroP = st.personRecord(st.hero);

        const split = document.createElement("div");
        split.className = "uw2-split";

        const left = document.createElement("div");
        left.className = "uw2-pane";
        const topCard = document.createElement("div");
        topCard.className = "uw2-action-box";
        topCard.style.cssText = "flex-direction:row;align-items:center;gap:14px;";
        const img = document.createElement("img");
        img.className = "uw2-portrait-img";
        void getPersonPortraitSrc(art, st.bytes(heroP, 0x32)).then(src => { if (src) img.src = src; });
        topCard.appendChild(img);
        const mCol = document.createElement("div");
        mCol.style.cssText = "display:flex;flex-direction:column;gap:4px;font-size:15px;font-weight:600;";
        for (const ml of [
          cap(() => c.message(0x38e)),
          cap(() => c.message(0x38f, money % 10000)),
          cap(() => c.message(0x390, Math.trunc(money / 10000))),
        ]) {
          const d = document.createElement("div");
          d.textContent = ml;
          mCol.appendChild(d);
        }
        topCard.appendChild(mCol);

        const fameBox = document.createElement("div");
        fameBox.className = "uw2-action-box";
        const fh = document.createElement("div");
        fh.className = "uw2-pane-title";
        fh.textContent = cap(() => c.message(0x391));
        fameBox.appendChild(fh);
        for (let i = 0; i < 3; i++) {
          const val = st.u16(H + 2 * i);
          const row = document.createElement("div");
          row.innerHTML = `<div style="font-size:14px;font-weight:600;margin-bottom:4px;">${cap(() => c.message(0x392, lab[i], val))}</div><div class="uw2-bar-track"><div class="uw2-bar-fill" style="width:${Math.min(100, (val / 50000) * 100)}%"></div></div>`;
          fameBox.appendChild(row);
        }
        left.append(topCard, fameBox);

        const right = document.createElement("div");
        right.className = "uw2-action-box";
        for (let i = 0; i < 6; i++) {
          const v = st.u8(H + 6 + i), diff = v - 100;
          const row = document.createElement("div");
          row.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;margin-bottom:4px;"><span>${cap(() => c.message(0x393, p.nations[i]))}</span><span style="color:${v >= 100 ? "#247544" : "#b83d3d"};">${diff < 0 ? `-${Math.abs(diff)}` : String(diff)}</span></div><div class="uw2-bar-track"><div class="uw2-bar-fill ${v >= 100 ? "green" : "red"}" style="width:${Math.min(100, (v / 200) * 100)}%"></div></div>`;
          right.appendChild(row);
        }
        split.append(left, right);
        root.appendChild(split);
      };

      // ---- Tab 4: 積載情報 ----
      const renderCargoShipTab = (root: HTMLElement) => {
        const n = b.fleetShips();
        const slots: number[] = [];
        for (let i = 0; i < n; i++) slots.push(c.persons[i] & 0xff);
        if (selCargoShipIdx >= slots.length) selCargoShipIdx = Math.max(0, slots.length - 1);

        const split = document.createElement("div");
        split.className = "uw2-split narrow-left";
        const left = document.createElement("div");
        left.className = "uw2-list-col";
        slots.forEach((slot, i) => {
          const ship = DS.TBL_SHIP + st.u8(b.fleetSlot(slot) + 7) * 0x16;
          const btn = document.createElement("button");
          btn.className = `uw2-row-card ${i === selCargoShipIdx ? "selected" : ""}`;
          btn.textContent = dec(st.cstr(ship));
          btn.addEventListener("click", () => { selCargoShipIdx = i; render(); });
          left.appendChild(btn);
        });

        const right = document.createElement("div");
        right.className = "uw2-action-box";
        if (slots.length) {
          const slot = slots[selCargoShipIdx], M = b.crewData(slot);
          const ship = DS.TBL_SHIP + st.u8(b.fleetSlot(slot) + 7) * 0x16;
          const title = document.createElement("div");
          title.className = "uw2-pane-title";
          title.textContent = cap(() => c.message(0x374, st.cstr(ship)));
          right.appendChild(title);
          let count = 0;
          for (let k = 0; k < 5; k++) {
            const g = st.u8(M + OFF.CREW_SLOT.CARGO_GOODS + k);
            if (g === 0xff) continue;
            count++;
            const card = document.createElement("div");
            card.className = "uw2-slot-card";
            card.textContent = cap(() => c.message(0x395, p.goods[g], st.u16(M + OFF.CREW_SLOT.CARGO_AMTS + 2 * k)));
            right.appendChild(card);
          }
          if (!count) {
            const empty = document.createElement("div");
            empty.className = "uw2-slot-sub";
            empty.textContent = "—";
            right.appendChild(empty);
          }
        }
        split.append(left, right);
        root.appendChild(split);
      };

      // ---- Tab 5: 積載一覽表 ----
      const renderCargoSummaryTab = (root: HTMLElement) => {
        const totals = new Map<number, number>();
        for (let i = 0; i < 10; i++) {
          if ((st.u8(b.fleetSlot(i) + 8) & 0x30) !== 0x10) continue;
          const M = b.crewData(i);
          for (let j = 0; j < 5; j++) {
            const g = st.u8(M + OFF.CREW_SLOT.CARGO_GOODS + j);
            if (g === 0xff) continue;
            totals.set(g, ((totals.get(g) ?? 0) + st.u16(M + OFF.CREW_SLOT.CARGO_AMTS + 2 * j)) & 0xffff);
          }
        }
        const goodsList = Array.from(totals.entries());
        if (selGoodIdx >= goodsList.length) selGoodIdx = Math.max(0, goodsList.length - 1);

        const split = document.createElement("div");
        split.className = "uw2-split narrow-left";
        const left = document.createElement("div");
        left.className = "uw2-list-col";
        goodsList.forEach(([g, amt], i) => {
          const btn = document.createElement("button");
          btn.className = `uw2-row-card ${i === selGoodIdx ? "selected" : ""}`;
          btn.innerHTML = `<span style="font-weight:700;">${dec(p.goods[g])}</span><span style="font-weight:700;">×${amt}</span>`;
          btn.addEventListener("click", () => { selGoodIdx = i; render(); });
          left.appendChild(btn);
        });

        const right = document.createElement("div");
        right.className = "uw2-pane";
        if (goodsList.length) {
          const [g] = goodsList[selGoodIdx];
          const R = DS.TBL_PORT + cmd.bestPort(g) * 0x16;
          const hero = st.personRecord(st.hero);
          const remarks: { pid: number; text: string }[] = [];
          if (st.u8(hero + 0x30) & 2) {
            remarks.push({ pid: st.hero, text: cap(() => c.message(0x350, p.goods[g], st.cstr(R + OFF.PORT.NAME))) });
          } else {
            for (let i = 0; i < 0x1e; i++) {
              const cid = st.u8(DS.PARTY_CREW + i);
              if (cid === 0xff) continue;
              const C = st.personRecord(cid);
              if (st.u8(C + 0x2e) !== 4) continue;
              const txt = (st.u8(C + 0x30) & 2)
                ? cap(() => c.message(0x351, p.goods[g], st.cstr(R + OFF.PORT.NAME)))
                : cap(() => c.message(0x352, p.goods[g]));
              remarks.push({ pid: cid, text: txt });
            }
          }
          for (const rm of remarks) {
            const box = document.createElement("div");
            box.className = "uw2-action-box";
            box.style.cssText = "flex-direction:row;align-items:center;gap:14px;";
            const img = document.createElement("img");
            img.className = "uw2-portrait-img";
            void getPersonPortraitSrc(art, st.bytes(st.personRecord(rm.pid), 0x32)).then(src => { if (src) img.src = src; });
            const txt = document.createElement("div");
            txt.style.cssText = "flex:1;font-size:15px;line-height:1.6;color:var(--uw2-ink);";
            txt.textContent = rm.text;
            box.append(img, txt);
            right.appendChild(box);
          }
        }
        split.append(left, right);
        root.appendChild(split);
      };

      // ---- Tab 6: 發現物情報 (附高清發現物插圖) ----
      const renderDiscoveryTab = (root: HTMLElement) => {
        const n = cmd.discList(0);
        const ids: number[] = [];
        for (let i = 0; i < n; i++) ids.push(c.persons[i] & 0xff);
        if (selDiscIdx >= ids.length) selDiscIdx = Math.max(0, ids.length - 1);

        const split = document.createElement("div");
        split.className = "uw2-split narrow-left";
        const left = document.createElement("div");
        left.className = "uw2-list-col";
        ids.forEach((id, i) => {
          const rec = ListSelect.colonyRec(c, id);
          const btn = document.createElement("button");
          btn.className = `uw2-row-card ${i === selDiscIdx ? "selected" : ""}`;
          btn.textContent = dec(rec);
          btn.addEventListener("click", () => { selDiscIdx = i; render(); });
          left.appendChild(btn);
        });

        const right = document.createElement("div");
        right.className = "uw2-action-box";
        if (ids.length) {
          const id = ids[selDiscIdx];
          const d = DS.TBL_DISCOVERY + id * 7;
          const imp = c.menuItems(0x22);
          const rec = ListSelect.colonyRec(c, id);
          const B = b.BG;

          const head = document.createElement("div");
          head.style.cssText = "display:flex;gap:16px;align-items:center;";
          const imgUrl = art?.discoveryUrl?.(rec[0x0f]);
          if (imgUrl) {
            const img = document.createElement("img");
            img.src = imgUrl;
            img.style.cssText = "width:96px;height:96px;object-fit:contain;border-radius:8px;border:1px solid var(--uw2-gold);background:#141c2b;image-rendering:pixelated;flex-shrink:0;";
            head.appendChild(img);
          }
          const meta = document.createElement("div");
          meta.style.cssText = "display:flex;flex-direction:column;gap:6px;";
          const tEl = document.createElement("div");
          tEl.style.cssText = "font-size:20px;font-weight:700;color:var(--uw2-ink);";
          tEl.textContent = dec(rec);
          const cEl = document.createElement("div");
          cEl.style.cssText = "font-size:14px;color:#8a5d17;font-weight:600;";
          cEl.textContent = cap(() => c.printf(B.cat, B.discCats[st.u8(d + 6) & 7]));
          const iEl = document.createElement("div");
          iEl.style.cssText = "font-size:14px;color:var(--uw2-ink-muted);";
          iEl.textContent = cap(() => c.printf(B.imp, imp[Math.trunc(st.u8(d + 5) / 0x19)] ?? Uint8Array.of(0)));
          meta.append(tEl, cEl, iEl);
          head.appendChild(meta);

          const descEl = document.createElement("div");
          descEl.style.cssText = "font-size:15px;line-height:1.75;color:var(--uw2-ink);margin-top:8px;padding-top:10px;border-top:1px solid rgba(154,119,56,0.28);";
          descEl.textContent = dec(rec.subarray(0x10));

          right.append(head, descEl);
        }
        split.append(left, right);
        root.appendChild(split);
      };

      // ---- Tab 8: 航海日誌 ----
      const renderLogTab = (root: HTMLElement) => {
        const L = DS.TRADE_LOGS, S = cmd.S;
        const entries: { date: string; text: string }[] = [];
        for (let i = 0; i < 0x30; i++) {
          const e = L + i * 16, w = st.u16(e);
          if (w === 0xffff) break;
          const d = Math.trunc(w / 31), m = Math.trunc(d / 12);
          const date = cap(() => c.printf(S.logDate, m + 0x5dd, d % 12 + 1, w % 31 + 1));
          const t = st.u16(e + 2), a = e + 4;
          const text = cap(() => {
            if (t === 0 || t === 1) c.message(t ? 0x16f : 0x16e, st.u16(a), st.cstr(DS.TBL_PORT + st.u8(a + 2) * 0x16 + 4));
            else if (t === 2) {
              const m34 = c.menuItems(0x34), m35 = c.menuItems(0x35), v = st.u16(a);
              const k = v >= 0x3c ? 0 : v % 10 === 0 ? 0 : v % 10 < 5 ? 1 : 2;
              c.message(0x345, p.nations[Math.trunc(v / 10)], m34[k], m35[st.u16(a + 2)]);
            } else if (t === 9) c.message(0x17d, st.cstr(DS.TBL_PORT + st.u8(a) * 0x16 + 4));
            else if (t === 0x0c) c.message(0x180, p.goods[st.u16(a)], (st.u16(a + 4) | (st.u16(a + 2) << 16)) | 0, st.u16(a + 6));
          });
          entries.push({ date, text });
        }
        const list = document.createElement("div");
        list.className = "uw2-list-col";
        list.style.maxHeight = "500px";
        for (const e of [...entries].reverse()) {
          const card = document.createElement("div");
          card.className = "uw2-slot-card";
          const d = document.createElement("span");
          d.style.cssText = "font-weight:700;color:#8a5d17;white-space:nowrap;font-size:13px;";
          d.textContent = e.date;
          const tx = document.createElement("span");
          tx.style.cssText = "flex:1;font-size:14px;color:var(--uw2-ink);";
          tx.textContent = e.text;
          card.append(d, tx);
          list.appendChild(card);
        }
        root.appendChild(list);
      };

      render();
    });

    if (extAction === "close") return;
    if (extAction === "world") await runWideWorldChart(c, p, tabLabels[7]);
    else if (extAction === "portMap") await cmd.portMap();
  }
}

/** 隨身物一體化工作台：左側道具清單 + 右側高清道具插圖、屬性、原版說明與佩戴/使用按鈕 */
export async function runDomBelongings(cmd: any): Promise<void> {
  const c = cmd.c, st = cmd.st, b = cmd.b, art = c.art;
  const dec = (bts: Uint8Array) => decodeCleanCstr(c.codec, bts);
  const cap = (fn: () => void) => captureConsoleText(c, fn);
  const navMenu = c.menuItems(0x1d);
  const title = navMenu?.[4] ? dec(navMenu[4]) : "";
  const actLabels = c.menuItems(0x21).slice(0, 2).map(dec);

  let selIdx = 0;

  for (;;) {
    const n = cmd.itemList();
    if (!n) return;
    const itemIds: number[] = [];
    for (let i = 0; i < n; i++) itemIds.push(c.persons[i] & 0xff);
    if (selIdx >= itemIds.length) selIdx = Math.max(0, itemIds.length - 1);

    const action = await new Promise<{ type: "close" | "equip" | "use"; it?: number }>(resolve => {
      let settled = false;
      const done = (v: { type: "close" | "equip" | "use"; it?: number }) => {
        if (settled) return;
        settled = true;
        h.close();
        resolve(v);
      };

      const h = createDomModal({
        title,
        size: "wide",
        cancelable: true,
        closeLabel: "关闭",
        onCancel: () => done({ type: "close" }),
      });

      const render = () => {
        h.body.innerHTML = "";
        const split = document.createElement("div");
        split.className = "uw2-split narrow-left";

        const left = document.createElement("div");
        left.className = "uw2-list-col";
        itemIds.forEach((it, i) => {
          const R = DS.TBL_ITEM + it * 0x14;
          const eq = !!(st.u8(R + 0x13) & 0x10);
          const btn = document.createElement("button");
          btn.className = `uw2-row-card ${i === selIdx ? "selected" : ""}`;
          btn.innerHTML = `<span style="font-weight:700;">${dec(st.cstr(R))}</span><span style="color:#8a5d17;font-weight:700;">${eq ? "★" : ""}</span>`;
          btn.addEventListener("click", () => { selIdx = i; render(); });
          left.appendChild(btn);
        });

        const right = document.createElement("div");
        right.className = "uw2-action-box";
        const it = itemIds[selIdx];
        const R = DS.TBL_ITEM + it * 0x14;
        const imgUrl = art?.discoveryUrl?.(st.u8(R + 0x0f) + 0x55);
        const lines = cap(() => b.itemInfo(it, 1)).split("\n").filter(Boolean);

        const head = document.createElement("div");
        head.style.cssText = "display:flex;gap:16px;align-items:flex-start;";
        if (imgUrl) {
          const img = document.createElement("img");
          img.src = imgUrl;
          img.style.cssText = "width:96px;height:96px;object-fit:contain;border-radius:8px;border:1px solid var(--uw2-gold);background:#141c2b;image-rendering:pixelated;flex-shrink:0;";
          head.appendChild(img);
        }
        const col = document.createElement("div");
        col.style.cssText = "flex:1;display:flex;flex-direction:column;gap:6px;";
        lines.forEach((l, idx) => {
          const d = document.createElement("div");
          d.style.cssText = idx === 0 ? "font-size:18px;font-weight:700;color:var(--uw2-ink);" : "font-size:14px;line-height:1.65;color:var(--uw2-ink);";
          d.textContent = l;
          col.appendChild(d);
        });
        head.appendChild(col);

        const btnRow = document.createElement("div");
        btnRow.className = "uw2-dialog-actions";
        const eqBtn = document.createElement("button");
        eqBtn.className = "uw2-btn uw2-btn-primary";
        eqBtn.style.padding = "8px 22px";
        eqBtn.textContent = actLabels[0];
        eqBtn.addEventListener("click", () => done({ type: "equip", it }));

        const useBtn = document.createElement("button");
        useBtn.className = "uw2-step-btn";
        useBtn.style.padding = "8px 22px";
        useBtn.textContent = actLabels[1];
        useBtn.addEventListener("click", () => done({ type: "use", it }));

        btnRow.append(eqBtn, useBtn);
        right.append(head, btnRow);

        split.append(left, right);
        h.body.appendChild(split);
      };

      render();
    });

    if (action.type === "close") return;
    if (action.type === "equip" && action.it !== undefined) await cmd.equip(action.it);
    else if (action.type === "use" && action.it !== undefined) await cmd.use(action.it);
  }
}
