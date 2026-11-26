// ui/fleet_panel.ts — 舰队经营一体化大面板 + 人物/舰船情报卡
import { GameConst, ShipSlotFlag } from "../model/flags.ts";
import { heroOrDockSlot, personRawBytes } from "../model/world_helpers.ts";
import { domS16 } from "../domain/economy.ts";
import { decodeCleanCstr } from "./text_util.ts";
import { createDomModal, getPersonPortraitSrc, preserveScroll, runDomYesNo } from "./modals.ts";
import { mountCargoShipEditor } from "./buildings/shipyard_parts.ts";
import { UI_STR } from "./strings.ts";
// ============================================================================
// 3. 舰队经营一体化大面板（左选船、右切 船长与舰船 / 水手与比例 / 人事变更 / 积载）
// ============================================================================
export function runDomFleetHub(cmd: any): Promise<void> {
  const c = cmd.c, m = cmd.st.model, b = cmd.b, { codec, art } = c;
  const dec = (bts: Uint8Array) => decodeCleanCstr(codec, bts);
  const m1b = c.menuItems(0x1b).slice(0, 6).map(dec);
  const tabLabels = [...UI_STR.fleetHubTabs];
  const statLabels = c.menuItems(0x29).slice(0, 7).map(dec);
  const roleLabels = [...UI_STR.crewPosts];

  return new Promise(resolve => {
    let activeTab = 0;
    let selShipIdx = 0;
    let pool = 0;
    let poolMorale = 0;
    let toastMsg = "";
    const tempLg = new Array<number>(9).fill(0xff);
    const tempLa = new Array<number>(9).fill(0);
    let closing = false;
    const hasTempLeft = () => tempLg.some((g, i) => g !== 0xff && tempLa[i] > 0);

    const tryClose = async () => {
      if (closing) return;
      if (b.fleetShips() > 0) {
        let heroCap = false;
        for (let i = 0; i < GameConst.FLEET_SHIPS; i++) {
          if ((heroOrDockSlot(m, i).flags & ShipSlotFlag.STATE_MASK) === ShipSlotFlag.ACTIVE && m.crewSlot(i).captain === m.globals.hero) { heroCap = true; break; }
        }
        if (!heroCap) { toastMsg = cmd.cap(() => c.message(0xe2)); render(); return; }
      }
      if (hasTempLeft()) {
        closing = true;
        const discard = await runDomYesNo(
          "积载暂存区尚有未装回船只的物资，未装入部分将被放弃。\n确定放弃剩余物资并关闭吗？",
          "放弃剩余",
          "返回分配",
        );
        closing = false;
        if (!discard) { activeTab = 3; render(); return; }
        c.shell?.showToast?.("已放弃暂存区剩余物资");
      }
      h.close();
      resolve();
    };

    const h = createDomModal({
      title: "经营",
      size: "wide",
      cancelable: false,
    });

    const poolPill = document.createElement("span");
    poolPill.className = "uw2-pill";
    const closeBtn = document.createElement("button");
    closeBtn.className = "uw2-btn";
    closeBtn.textContent = "关闭";
    closeBtn.addEventListener("click", tryClose);
    h.headerRight.append(poolPill, closeBtn);

    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); tryClose(); }
    };
    window.addEventListener("keydown", onEsc);
    h.backdrop.addEventListener("contextmenu", e => {
      e.preventDefault();
      e.stopPropagation();
      tryClose();
    });
    const origClose = h.close;
    h.close = () => { window.removeEventListener("keydown", onEsc); origClose(); };

    const toolbar = document.createElement("div");
    toolbar.className = "uw2-modal-toolbar";
    h.modal.insertBefore(toolbar, h.body);

    const footer = document.createElement("div");
    footer.className = "uw2-modal-footer";
    const toastEl = document.createElement("span");
    toastEl.style.cssText = "font-size:13px;font-weight:700;color:#b83d3d;";
    footer.appendChild(toastEl);
    h.modal.appendChild(footer);

    const scanPosts = () => {
      const posts = [GameConst.EMPTY_SLOT, GameConst.EMPTY_SLOT, GameConst.EMPTY_SLOT];
      for (let i = 0; i < GameConst.PARTY_SLOTS; i++) {
        const n = m.partyCrew(i);
        if (n === GameConst.EMPTY_SLOT) continue;
        const r = m.person(n).role;
        if (r >= 3 && r <= 5) posts[r - 3] = n;
      }
      return posts;
    };

    const getShips = () => {
      const n = b.fleetShips(), out = [];
      for (let i = 0; i < n; i++) {
        const slot = c.persons[i] & 0xff, slotView = heroOrDockSlot(m, slot), cs = m.crewSlot(slot);
        const capId = cs.captain;
        if (capId & 0x80) continue;
        const ship = m.ship(slotView.ship);
        out.push({
          slot, name: dec(ship.nameBytes), typeId: ship.type, capId,
          capName: dec(m.person(capId).givenNameBytes),
          crew: slotView.crew, maxCrew: ship.maxCrew,
          dur: slotView.durability, maxDur: slotView.maxDurability,
          turn: slotView.turn, prop: slotView.propulsion,
          used: domS16(b.cargoUsed(slot)), maxCargo: domS16(ship.maxCargo),
          speed: (b.shipSpeed(slot) + 1) >> 1,
          navR: cs.navRatio, lookR: cs.lookRatio,
        });
      }
      return out;
    };

    const adjustSailors = (slot: number, delta: number) => {
      const cs = m.crewSlot(slot), slotView = heroOrDockSlot(m, slot);
      const ship = m.ship(slotView.ship);
      const cur = slotView.crew, maxCrew = ship.maxCrew, mor = cs.morale;
      const next = Math.max(0, Math.min(cur + delta, Math.min(cur + pool, maxCrew)));
      if (next === cur) return;
      slotView.crew = next;
      const prevPool = pool;
      pool = (pool - next + cur) & 0xffff;
      cs.morale = 0;
      if (next) cs.morale = cur < next ? Math.trunc((mor * cur + (next - cur) * poolMorale) / next) : mor;
      poolMorale = 0;
      if (pool) poolMorale = (cur < next ? poolMorale : Math.trunc((poolMorale * prevPool + (cur - next) * mor) / pool)) & 0xff;
      render();
    };

    const stepRatio = (slot: number, r: number, times = 1) => {
      const cs = m.crewSlot(slot);
      for (let k = 0; k < times; k++) {
        const a = cs.navRatio, b9 = cs.lookRatio, rest = (100 - a - b9) & 0xff;
        if (r <= 1) { const t = [b9, a, rest]; cmd.ratioStep(r, t); cs.navRatio = t[1]; cs.lookRatio = t[0]; }
        else if (r <= 3) { const t = [a, rest, b9]; cmd.ratioStep(r, t); cs.navRatio = t[0]; cs.lookRatio = t[2]; }
        else { const t = [rest, b9, a]; cmd.ratioStep(r, t); cs.navRatio = t[2]; cs.lookRatio = t[1]; }
      }
      render();
    };

    const render = (keepScroll = true) => {
      poolPill.style.display = pool > 0 ? "inline-flex" : "none";
      poolPill.textContent = `${dec(cmd.S.slRest)}: ${pool}`;
      toastEl.textContent = toastMsg;

      toolbar.innerHTML = "";
      tabLabels.forEach((lb: string, i: number) => {
        const btn = document.createElement("button");
        btn.className = `uw2-btn uw2-tab-btn ${i === activeTab ? "active" : ""}`;
        btn.textContent = lb;
        btn.addEventListener("click", () => { activeTab = i; render(false); });
        toolbar.appendChild(btn);
      });

      const ships = getShips();
      if (selShipIdx >= ships.length) selShipIdx = Math.max(0, ships.length - 1);
      const curShip = ships[selShipIdx];

      preserveScroll(h.body, () => {
      h.body.innerHTML = "";
      const split = document.createElement("div");
      split.className = "uw2-split narrow-left";

      const left = document.createElement("div");
      left.className = "uw2-list-col";
      const leftCardMeta: { slot: number; el: HTMLElement }[] = [];
      ships.forEach((s, i) => {
        const row = document.createElement("button");
        row.className = `uw2-row-card ${i === selShipIdx ? "selected" : ""}`;
        const metaRight = document.createElement("div");
        metaRight.style.textAlign = "right";
        const renderShipMeta = (used: number, maxCargo: number) => {
          if (activeTab === 3) {
            const free = Math.max(0, maxCargo - used);
            metaRight.innerHTML = `<div style="font-weight:700;font-size:13px;">空余 ${free}</div><div class="uw2-slot-sub">${used}/${maxCargo}</div>`;
          } else {
            metaRight.innerHTML = `<div style="font-weight:700;font-size:13px;">水手 ${s.crew}/${s.maxCrew}</div><div class="uw2-slot-sub">速度 ${s.speed}kt</div>`;
          }
        };
        renderShipMeta(s.used, s.maxCargo);
        const metaLeft = document.createElement("div");
        metaLeft.innerHTML = `<div class="uw2-slot-title">${s.name}</div><div class="uw2-slot-sub">${s.capName}</div>`;
        row.append(metaLeft, metaRight);
        row.addEventListener("click", () => { selShipIdx = i; render(); });
        left.appendChild(row);
        leftCardMeta.push({ slot: s.slot, el: metaRight });
      });

      const right = document.createElement("div");
      right.className = "uw2-pane";

      if (activeTab === 0 && curShip) {
        const top = document.createElement("div");
        top.className = "uw2-action-box";
        top.style.flexDirection = "row";
        top.style.alignItems = "center";
        top.style.justifyContent = "space-between";
        const shipUrl = art?.shipUrl?.(curShip.typeId);
        if (shipUrl) {
          const img = document.createElement("img");
          img.src = shipUrl;
          img.style.cssText = "width:144px;height:96px;object-fit:contain;border-radius:6px;background:#0e1b30;border:1px solid var(--uw2-gold);";
          top.appendChild(img);
        }
        const meta = document.createElement("div");
        meta.style.cssText = "flex:1;padding:0 14px;";
        meta.innerHTML = `<div style="font-size:18px;font-weight:700;">${curShip.name}</div><div style="font-size:14px;color:var(--uw2-ink-muted);margin-top:4px;">${curShip.capName}</div>`;
        const btns = document.createElement("div");
        btns.style.cssText = "display:flex;gap:8px;";
        const capBtn = document.createElement("button");
        capBtn.className = "uw2-btn uw2-btn-primary";
        capBtn.textContent = m1b[0];
        capBtn.addEventListener("click", async () => {
          const s = await b.listSel().select(0x89, b.captainPool());
          if (s !== -1) { cmd.setCaptain(curShip.slot, c.persons[s]); render(); }
        });
        const scrapBtn = document.createElement("button");
        scrapBtn.className = "uw2-step-btn";
        scrapBtn.disabled = ships.length <= 1 || curShip.capId === m.globals.hero;
        scrapBtn.textContent = m1b[4];
        scrapBtn.addEventListener("click", async () => {
          await cmd.scrapShip(curShip.slot);
          for (let i = 0; i < GameConst.FLEET_SHIPS; i++) {
            const slotView = heroOrDockSlot(m, i);
            if ((slotView.flags & ShipSlotFlag.STATE_MASK) === ShipSlotFlag.ACTIVE && m.crewSlot(i).captain === GameConst.EMPTY_SLOT) slotView.flags = 0;
          }
          render();
        });
        btns.append(capBtn, scrapBtn);
        top.append(meta, btns);
        right.appendChild(top);

        const statsBox = document.createElement("div");
        statsBox.className = "uw2-action-box";
        for (const [lb, v, mx] of [
          [statLabels[0], curShip.dur, curShip.maxDur || 100],
          [statLabels[1], curShip.turn, 100],
          [statLabels[2], curShip.prop, 100],
          [statLabels[3], curShip.crew, curShip.maxCrew || 1],
          [statLabels[5], curShip.used, curShip.maxCargo || 1],
        ] as [string, number, number][]) {
          const row = document.createElement("div");
          row.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;margin-bottom:3px;"><span>${lb}</span><span>${v} / ${mx}</span></div><div class="uw2-bar-track"><div class="uw2-bar-fill" style="width:${Math.min(100, Math.round((v / (mx || 1)) * 100))}%"></div></div>`;
          statsBox.appendChild(row);
        }
        right.appendChild(statsBox);
      } else if (activeTab === 1 && curShip) {
        const sBox = document.createElement("div");
        sBox.className = "uw2-action-box";
        sBox.innerHTML = `<div style="display:flex;justify-content:space-between;font-weight:700;"><span>${m1b[2]} — ${curShip.name}</span><span>${curShip.crew} / ${curShip.maxCrew}</span></div>`;
        const sRow = document.createElement("div");
        sRow.className = "uw2-step-row";
        for (const [lb, d] of [["-10", -10], ["-1", -1], ["+1", 1], ["+10", 10]] as [string, number][]) {
          const btn = document.createElement("button");
          btn.className = "uw2-step-btn";
          btn.textContent = lb;
          btn.addEventListener("click", () => adjustSailors(curShip.slot, d));
          sRow.appendChild(btn);
        }
        sBox.appendChild(sRow);

        const rBox = document.createElement("div");
        rBox.className = "uw2-action-box";
        const rt = document.createElement("div");
        rt.className = "uw2-pane-title";
        rt.textContent = m1b[3];
        rBox.appendChild(rt);
        for (const [lb, pct, da, ia] of [
          [dec(cmd.S.rDrive), curShip.lookR, 0, 1],
          [dec(cmd.S.rWatch), curShip.navR, 2, 3],
          [dec(cmd.S.rDeck), Math.max(0, 100 - curShip.navR - curShip.lookR), 4, 5],
        ] as [string, number, number, number][]) {
          const card = document.createElement("div");
          card.className = "uw2-slot-card";
          const people = Math.trunc((pct * curShip.crew) / 100);
          const lbl = document.createElement("span");
          lbl.className = "uw2-slot-title";
          lbl.style.minWidth = "84px";
          lbl.textContent = lb;
          const ctrl = document.createElement("div");
          ctrl.className = "uw2-step-row";
          const mk = (t: string, fn: () => void) => { const btn = document.createElement("button"); btn.className = "uw2-step-btn"; btn.textContent = t; btn.addEventListener("click", fn); return btn; };
          const val = document.createElement("span");
          val.style.cssText = "min-width:86px;text-align:center;font-weight:700;";
          val.textContent = `${people} (${pct}%)`;
          ctrl.append(mk("-5", () => stepRatio(curShip.slot, da, 5)), mk("-", () => stepRatio(curShip.slot, da, 1)), val, mk("+", () => stepRatio(curShip.slot, ia, 1)), mk("+5", () => stepRatio(curShip.slot, ia, 5)));
          card.append(lbl, ctrl);
          rBox.appendChild(card);
        }
        right.append(sBox, rBox);
      } else if (activeTab === 2) {
        const posts = scanPosts();
        const grid = document.createElement("div");
        grid.className = "uw2-pers-grid";
        for (let k = 0; k < 3; k++) {
          const pid = posts[k];
          const card = document.createElement("button");
          card.className = "uw2-pers-card";
          const roleEl = document.createElement("div");
          roleEl.style.cssText = "font-weight:700;color:#8a5d17;font-size:15px;";
          roleEl.textContent = roleLabels[k];
          const img = document.createElement("img");
          img.className = "uw2-portrait-img";
          img.style.width = "84px";
          img.style.height = "105px";
          const nameEl = document.createElement("div");
          nameEl.style.cssText = "font-weight:700;font-size:15px;color:var(--uw2-ink);";
          if (pid !== GameConst.EMPTY_SLOT) {
            const p = m.person(pid);
            nameEl.textContent = dec(p.givenNameBytes);
            void getPersonPortraitSrc(art, personRawBytes(p)).then(src => { if (src) img.src = src; });
          } else {
            nameEl.textContent = "----";
          }
          card.append(roleEl, img, nameEl);
          card.addEventListener("click", async () => {
            cmd.posts = scanPosts();
            await cmd.setPost(k);
            render();
          });
          grid.appendChild(card);
        }
        right.appendChild(grid);
      } else if (activeTab === 3 && curShip) {
        mountCargoShipEditor({
          b,
          lg: tempLg,
          la: tempLa,
          shipSlot: curShip.slot,
          shipName: curShip.name,
          container: right,
          poolPrefix: "暂存区：",
          poolEmptyText: "暂存区为空（从某船减下水/粮/资材/炮弹/货物移入暂存区，再切船装入）",
          autoBtnLabel: "一键装回舰队",
          onAutoFillDone: () => {
            render();
            return true;
          },
          onMutate: () => {
            for (const lc of leftCardMeta) {
              const sv = heroOrDockSlot(m, lc.slot);
              const maxCargo = domS16(m.ship(sv.ship).maxCargo);
              const used = domS16(b.cargoUsed(lc.slot));
              const free = Math.max(0, maxCargo - used);
              lc.el.innerHTML = `<div style="font-weight:700;font-size:13px;">空余 ${free}</div><div class="uw2-slot-sub">${used}/${maxCargo}</div>`;
            }
          },
        });
      }

      split.append(left, right);
      h.body.appendChild(split);
      }, keepScroll);
    };

    render(false);
  });
}

// ============================================================================
// 4. 现代人物情报弹窗（支持具名头像 + 5 层拼合随机头像，彻底修复艾德瓦等伙伴头像错误）
// ============================================================================
export async function runDomPersonInfo(
  art: any,
  personBytes: Uint8Array,
  headerLines: string[],
  stats: { label: string; val: number }[],
  detailLines: string[],
): Promise<void> {
  const portraitSrc = await getPersonPortraitSrc(art, personBytes);
  return new Promise(resolve => {
    const h = createDomModal({
      title: headerLines[0] || "",
      size: "wide",
      cancelable: true,
      closeLabel: "关闭",
      onCancel: () => resolve(),
    });

    const top = document.createElement("div");
    top.className = "uw2-action-box";
    top.style.flexDirection = "row";
    top.style.alignItems = "center";
    if (portraitSrc) {
      const img = document.createElement("img");
      img.className = "uw2-portrait-img";
      img.style.width = "88px";
      img.style.height = "110px";
      img.src = portraitSrc;
      top.appendChild(img);
    }
    const hCol = document.createElement("div");
    hCol.style.cssText = "display:flex;flex-direction:column;gap:4px;";
    headerLines.forEach((l, i) => {
      const d = document.createElement("div");
      d.style.cssText = i === 0 ? "font-size:20px;font-weight:700;" : "font-size:14px;color:var(--uw2-ink-muted);";
      d.textContent = l;
      hCol.appendChild(d);
    });
    top.appendChild(hCol);

    const split = document.createElement("div");
    split.className = "uw2-split";

    const sBox = document.createElement("div");
    sBox.className = "uw2-action-box";
    for (const s of stats) {
      const row = document.createElement("div");
      row.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;margin-bottom:3px;"><span>${s.label}</span><span>${s.val}</span></div><div class="uw2-bar-track"><div class="uw2-bar-fill ${s.val >= 80 ? "" : "green"}" style="width:${Math.min(100, s.val)}%"></div></div>`;
      sBox.appendChild(row);
    }

    const dBox = document.createElement("div");
    dBox.className = "uw2-action-box";
    for (const dl of detailLines) {
      const d = document.createElement("div");
      d.style.cssText = "font-size:14px;line-height:1.65;color:var(--uw2-ink);";
      d.textContent = dl;
      dBox.appendChild(d);
    }

    split.append(sBox, dBox);
    h.body.append(top, split);
  });
}

// ============================================================================
// 5. 现代舰船情报弹窗
// ============================================================================
export function runDomShipInfo(
  art: any,
  typeId: number,
  leftLines: string[],
  bars: { label: string; cur: number; max: number }[],
): Promise<void> {
  return new Promise(resolve => {
    const h = createDomModal({
      title: leftLines[1] || leftLines[0] || "",
      size: "wide",
      cancelable: true,
      closeLabel: "关闭",
      onCancel: () => resolve(),
    });
    const split = document.createElement("div");
    split.className = "uw2-split";

    const left = document.createElement("div");
    left.className = "uw2-action-box";
    const shipUrl = art?.shipUrl?.(typeId);
    if (shipUrl) {
      const img = document.createElement("img");
      img.src = shipUrl;
      img.style.cssText = "width:100%;max-height:140px;object-fit:contain;border-radius:8px;background:#0e1b30;border:1px solid var(--uw2-gold);padding:8px;";
      left.appendChild(img);
    }
    for (const l of leftLines) {
      const d = document.createElement("div");
      d.style.cssText = "font-size:14px;line-height:1.55;color:var(--uw2-ink);";
      d.textContent = l;
      left.appendChild(d);
    }

    const right = document.createElement("div");
    right.className = "uw2-action-box";
    for (const b of bars) {
      const pct = b.max > 0 ? Math.min(100, Math.round((b.cur / b.max) * 100)) : 0;
      const row = document.createElement("div");
      row.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;margin-bottom:3px;"><span>${b.label}</span><span>${b.cur} / ${b.max}</span></div><div class="uw2-bar-track"><div class="uw2-bar-fill" style="width:${pct}%"></div></div>`;
      right.appendChild(row);
    }

    split.append(left, right);
    h.body.append(split);
  });
}

