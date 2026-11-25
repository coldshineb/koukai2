// ui/battle_hud.ts — 16:9 现代羊皮纸海战 HUD + 战场 Canvas 缩放渲染器 + 无遮挡右侧指令/确认栏 + 羊皮纸情报卡
// 左侧 (20, 10, 728×700) 清晰呈现 1.75× 缩放六角格海战场（绝不被菜单模糊遮挡），
// 右侧以暖羊皮纸卡片呈现旗舰状态、风向、战术小地图，底部卡位无缝承载战况消息、战斗指令与是/否确认。
import { createDomModal, hasDom, getPersonPortraitSrc, preserveScroll } from "./modals.ts";
import { hideDomWorldHud } from "./hud.ts";
import { decodeCleanCstr, toSimp } from "./text_util.ts";
import { DS, OFF } from "../model/schema_views.ts";

export const BATTLE_VIEWPORT = { x: 20, y: 10, w: 728, h: 700, srcW: 416, srcH: 400 };

const WIND_NAMES = ["北", "东北", "东南", "南", "西南", "西北"];
const WIND_ANGLES = [0, 60, 120, 180, 240, 300];

let battleRoot: HTMLElement | null = null;
let statusCard: HTMLElement | null = null;
let miniCanvas: HTMLCanvasElement | null = null;
let miniCtx: CanvasRenderingContext2D | null = null;
let msgCard: HTMLElement | null = null;
let actionCard: HTMLElement | null = null;
let lastStatusKey = "";
let lastMsgText = "";

function arrowSvg(deg: number): string {
  return `<svg class="uw2-dir-arrow" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">`
    + `<circle cx="12" cy="12" r="10" fill="rgba(61,40,23,0.06)" stroke="rgba(138,93,23,0.45)" stroke-width="1.2"/>`
    + `<g transform="rotate(${deg} 12 12)">`
    + `<polygon points="12,3.5 16,14 12,11.6 8,14" fill="#9e2a2b"/>`
    + `<polygon points="12,20.5 14.5,14 12,15.4 9.5,14" fill="#5e4732"/>`
    + `</g></svg>`;
}

function ensureBattleRoot(): HTMLElement | null {
  if (!hasDom()) return null;
  const host = document.getElementById("uw2-overlay");
  if (!host) return null;
  if (battleRoot && battleRoot.parentElement === host) return battleRoot;

  battleRoot = document.createElement("div");
  battleRoot.className = "uw2-battle-hud";

  statusCard = document.createElement("div");
  statusCard.className = "uw2-card uw2-battle-card";

  const miniCard = document.createElement("div");
  miniCard.className = "uw2-card uw2-battle-card uw2-battle-mini-card";
  const miniTitle = document.createElement("div");
  miniTitle.className = "uw2-pane-title";
  miniTitle.textContent = "战场态势";
  miniCanvas = document.createElement("canvas");
  miniCanvas.width = 208;
  miniCanvas.height = 192;
  miniCanvas.className = "uw2-battle-mini-canvas";
  miniCtx = miniCanvas.getContext("2d");
  miniCard.append(miniTitle, miniCanvas);

  msgCard = document.createElement("div");
  msgCard.className = "uw2-card uw2-battle-card uw2-battle-msg-card";

  actionCard = document.createElement("div");
  actionCard.className = "uw2-card uw2-battle-card uw2-battle-action-card";
  actionCard.style.display = "none";

  battleRoot.append(statusCard, miniCard, msgCard, actionCard);
  host.appendChild(battleRoot);
  return battleRoot;
}

export function hideDomBattleHud() {
  if (battleRoot) battleRoot.style.display = "none";
  if (actionCard) { actionCard.style.display = "none"; actionCard.innerHTML = ""; }
  if (msgCard) msgCard.style.display = "flex";
  if (hasDom()) delete document.body.dataset.uw2Battle;
  lastStatusKey = "";
  lastMsgText = "";
}

/** 在右侧海战 HUD 底部无遮挡呈现战斗指令菜单（绝不模糊或盖住左侧战场） */
export function runDomBattleMenu(
  labels: string[],
  disabledMask: number,
  cancelable: boolean,
  title = "战斗指令",
): Promise<number> {
  const root = ensureBattleRoot();
  if (!root || !actionCard || !msgCard) return Promise.resolve(cancelable ? 0xff : 0);

  return new Promise(resolve => {
    let settled = false;
    let selected = 0;
    for (let i = 0; i < labels.length; i++) {
      if (!(disabledMask & (1 << i))) { selected = i; break; }
    }

    const done = (idx: number) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("contextmenu", onCtx, true);
      if (actionCard) { actionCard.style.display = "none"; actionCard.innerHTML = ""; }
      if (msgCard) msgCard.style.display = "flex";
      resolve(idx);
    };

    msgCard!.style.display = "none";
    actionCard!.style.display = "flex";
    actionCard!.innerHTML = "";

    const head = document.createElement("div");
    head.className = "uw2-battle-action-head";
    const tEl = document.createElement("span");
    tEl.className = "uw2-pane-title";
    tEl.textContent = title || "战斗指令";
    head.appendChild(tEl);
    if (cancelable) {
      const backBtn = document.createElement("button");
      backBtn.className = "uw2-step-btn";
      backBtn.textContent = "返回";
      backBtn.addEventListener("click", () => done(0xff));
      head.appendChild(backBtn);
    }

    const grid = document.createElement("div");
    grid.className = labels.length <= 3 ? "uw2-battle-cmd-row" : "uw2-battle-cmd-grid";
    const btns: HTMLButtonElement[] = [];

    labels.forEach((raw, i) => {
      const dis = !!(disabledMask & (1 << i));
      const btn = document.createElement("button");
      btn.className = "uw2-battle-cmd-btn";
      btn.disabled = dis;
      btn.textContent = toSimp(raw);
      btn.addEventListener("mouseenter", () => { if (!dis) { selected = i; syncSel(); } });
      btn.addEventListener("click", () => { if (!dis) done(i); });
      btns.push(btn);
      grid.appendChild(btn);
    });

    const syncSel = () => {
      btns.forEach((b, i) => b.classList.toggle("selected", i === selected));
    };
    syncSel();

    const move = (step: number) => {
      for (let k = 1; k <= labels.length; k++) {
        const next = (selected + step * k + labels.length) % labels.length;
        if (!(disabledMask & (1 << next))) { selected = next; syncSel(); break; }
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (document.body?.dataset.uw2Modal === "open") return;
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); move(-1); }
      else if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); move(1); }
      else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault(); e.stopPropagation();
        if (!(disabledMask & (1 << selected))) done(selected);
      } else if (e.key === "Escape" && cancelable) {
        e.preventDefault(); e.stopPropagation();
        done(0xff);
      }
    };
    const onCtx = (e: MouseEvent) => {
      if (document.body?.dataset.uw2Modal === "open") return;
      if (cancelable) { e.preventDefault(); e.stopPropagation(); done(0xff); }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("contextmenu", onCtx, true);

    actionCard!.append(head, grid);
  });
}

/** 在右侧海战 HUD 底部无遮挡呈现是/否确认（同时显示完整战况提问，绝不盖住战场） */
export function runDomBattleYesNo(promptText: string, yesLabel = "是", noLabel = "否"): Promise<number> {
  const root = ensureBattleRoot();
  if (!root || !actionCard || !msgCard) return Promise.resolve(0);

  return new Promise(resolve => {
    let settled = false;
    const done = (v: number) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("contextmenu", onCtx, true);
      if (actionCard) { actionCard.style.display = "none"; actionCard.innerHTML = ""; }
      if (msgCard) msgCard.style.display = "flex";
      resolve(v);
    };

    msgCard!.style.display = "none";
    actionCard!.style.display = "flex";
    actionCard!.innerHTML = "";

    const head = document.createElement("div");
    head.className = "uw2-pane-title";
    head.textContent = "确认";

    const msg = document.createElement("div");
    msg.className = "uw2-battle-msg-text";
    msg.textContent = toSimp(promptText || "确定执行此操作？");

    const row = document.createElement("div");
    row.className = "uw2-dialog-actions";
    row.style.marginTop = "auto";

    const noBtn = document.createElement("button");
    noBtn.className = "uw2-step-btn";
    noBtn.style.padding = "7px 22px";
    noBtn.textContent = noLabel;
    noBtn.addEventListener("click", () => done(0));

    const yesBtn = document.createElement("button");
    yesBtn.className = "uw2-btn uw2-btn-primary";
    yesBtn.style.padding = "7px 26px";
    yesBtn.textContent = yesLabel;
    yesBtn.addEventListener("click", () => done(1));

    const onKey = (e: KeyboardEvent) => {
      if (document.body?.dataset.uw2Modal === "open") return;
      if (e.key === "Enter" || e.key === "y" || e.key === "Y") { e.preventDefault(); e.stopPropagation(); done(1); }
      else if (e.key === "Escape" || e.key === "n" || e.key === "N") { e.preventDefault(); e.stopPropagation(); done(0); }
    };
    const onCtx = (e: MouseEvent) => {
      if (document.body?.dataset.uw2Modal === "open") return;
      e.preventDefault(); e.stopPropagation(); done(0);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("contextmenu", onCtx, true);

    row.append(noBtn, yesBtn);
    actionCard!.append(head, msg, row);
  });
}

/** 现代羊皮纸海战舰队情报弹窗（取代老 Canvas 蓝底舰队一览） */
export async function runDomBattleFleetModal(battle: any, personId: number): Promise<void> {
  if (!hasDom()) return;
  const st = battle.st, art = battle.c.art, codec = battle.c.codec;
  const dec = (bts: Uint8Array) => toSimp(decodeCleanCstr(codec, bts));
  const P = battle.person(personId);
  const fId = st.u8(P + OFF.PERSON.FLEET);
  const F = DS.TBL_FLEET + fId * 0x85;
  const gName = dec(st.cstr(P));
  const fName = dec(st.cstr(P + OFF.PERSON.FAMILY_NAME));
  const fullName = fName ? `${gName}·${fName}` : gName;
  const portraitSrc = await getPersonPortraitSrc(art, st.bytes(P, 0x32));

  const ships: { name: string; typeId: number; dur: number; maxDur: number; crew: number; maxCrew: number; turn: number; prop: number; cannons: number }[] = [];
  let totalCrew = 0, totalCannons = 0, minDur = 100, minTurn = 100, minProp = 100;
  for (let i = 0; i < 10; i++) {
    const S = F + OFF.FLEET.SHIPS + i * 9;
    if ((st.u8(S + OFF.DOCK_SLOT.FLAGS) & 0x30) !== 0x10) continue;
    const R = battle.shipRec(st.u8(S + OFF.DOCK_SLOT.SHIP));
    const dur = st.u8(S + OFF.DOCK_SLOT.DURABILITY);
    const maxDur = st.u8(S + OFF.DOCK_SLOT.MAX_DURABILITY);
    const crew = st.u16(S);
    const maxCrew = st.u16(R + 0x12);
    const turn = st.u8(S + OFF.DOCK_SLOT.TURN);
    const prop = st.u8(S + OFF.DOCK_SLOT.PROPULSION);
    const cannons = st.u8(S + OFF.DOCK_SLOT.GUNS);
    totalCrew += crew;
    totalCannons += cannons;
    if (dur < minDur) minDur = dur;
    if (turn < minTurn) minTurn = turn;
    if (prop < minProp) minProp = prop;
    ships.push({ name: dec(st.cstr(R)), typeId: st.u8(R + 0x0f), dur, maxDur, crew, maxCrew, turn, prop, cannons });
  }

  return new Promise(resolve => {
    const h = createDomModal({
      title: `${fullName} 舰队`,
      size: "wide",
      cancelable: true,
      closeLabel: "关闭",
      onCancel: () => resolve(),
    });

    const top = document.createElement("div");
    top.className = "uw2-action-box";
    top.style.cssText = "flex-direction:row;align-items:center;gap:14px;";
    if (portraitSrc) {
      const img = document.createElement("img");
      img.src = portraitSrc;
      img.className = "uw2-portrait-img";
      top.appendChild(img);
    }
    const meta = document.createElement("div");
    meta.style.cssText = "flex:1;display:grid;grid-template-columns:repeat(3,1fr);gap:6px 14px;font-size:13px;color:var(--uw2-ink);";
    meta.innerHTML =
      `<div>提督：<strong>${fullName}</strong></div>` +
      `<div>航海等级：<strong>${st.u8(P + OFF.PERSON.NAV_LEVEL)}</strong></div>` +
      `<div>战斗等级：<strong>${st.u8(P + OFF.PERSON.BATTLE_LEVEL)}</strong></div>` +
      `<div>舰船数量：<strong>${ships.length} 艘</strong></div>` +
      `<div>水手总数：<strong>${totalCrew} 名</strong></div>` +
      `<div>总炮门数：<strong>${totalCannons} 门</strong></div>` +
      `<div>舰队耐久：<strong>${ships.length ? minDur : 0}</strong></div>` +
      `<div>舰队转向：<strong>${ships.length ? minTurn : 0}</strong></div>` +
      `<div>舰队推进：<strong>${ships.length ? minProp : 0}</strong></div>`;
    top.appendChild(meta);

    const grid = document.createElement("div");
    grid.className = "uw2-list-col";
    grid.style.maxHeight = "340px";
    ships.forEach((s, idx) => {
      const card = document.createElement("div");
      card.className = "uw2-slot-card";
      const durPct = s.maxDur > 0 ? Math.min(100, Math.round((s.dur * 100) / s.maxDur)) : 0;
      const shipUrl = art?.shipUrl?.(s.typeId);
      card.innerHTML =
        `<div style="display:flex;align-items:center;gap:12px;flex:1;">` +
          (shipUrl ? `<img src="${shipUrl}" style="width:72px;height:48px;object-fit:contain;border-radius:6px;background:#102442;border:1px solid var(--uw2-gold);image-rendering:pixelated;" />` : "") +
          `<div style="flex:1;">` +
            `<div class="uw2-slot-title">${idx === 0 ? "★ " : ""}${s.name}</div>` +
            `<div class="uw2-slot-sub">水手 ${s.crew}/${s.maxCrew} · 转向 ${s.turn} · 推进 ${s.prop} · 炮门 ${s.cannons}</div>` +
          `</div>` +
          `<div style="width:120px;">` +
            `<div style="font-size:12px;text-align:right;font-weight:700;margin-bottom:4px;">耐久 ${s.dur}/${s.maxDur}</div>` +
            `<div class="uw2-bar-track"><div class="uw2-bar-fill ${durPct < 35 ? "red" : "green"}" style="width:${durPct}%"></div></div>` +
          `</div>` +
        `</div>`;
      grid.appendChild(card);
    });

    h.body.append(top, grid);
  });
}

/** 现代羊皮纸人物数据弹窗（海战敌方提督） */
export async function runDomBattlePersonModal(battle: any, personId: number): Promise<void> {
  return runDomBattleCrewModal(battle, [personId], "人物数据");
}

/** 现代羊皮纸左右分栏人物情报弹窗（左侧人名清单、右侧实时显示头像与能力，无需二次弹窗） */
export async function runDomBattleCrewModal(battle: any, personIds: number[], title = "舰队人物"): Promise<void> {
  if (!hasDom() || !personIds.length) return;
  const st = battle.st, art = battle.c.art, codec = battle.c.codec;
  const dec = (bts: Uint8Array) => toSimp(decodeCleanCstr(codec, bts));
  let selIdx = 0;

  return new Promise(resolve => {
    const h = createDomModal({
      title,
      size: personIds.length > 1 ? "wide" : "md",
      cancelable: true,
      closeLabel: "关闭",
      onCancel: () => resolve(),
    });

    const render = () => {
      preserveScroll(h.body, () => {
        h.body.innerHTML = "";
        const pid = personIds[selIdx];
        const P = battle.person(pid);
        const gName = dec(st.cstr(P));
        const fName = dec(st.cstr(P + OFF.PERSON.FAMILY_NAME));
        const fullName = fName ? `${gName}·${fName}` : gName;

        const detail = document.createElement("div");
        detail.className = "uw2-action-box";
        detail.style.cssText = "flex-direction:row;gap:16px;align-items:flex-start;";

        const portWrap = document.createElement("div");
        portWrap.style.cssText = "width:68px;flex-shrink:0;";
        void getPersonPortraitSrc(art, st.bytes(P, 0x32)).then(src => {
          if (!src || !portWrap.isConnected) return;
          const img = document.createElement("img");
          img.src = src;
          img.className = "uw2-portrait-img";
          portWrap.appendChild(img);
        });
        detail.appendChild(portWrap);

        const rightCol = document.createElement("div");
        rightCol.style.cssText = "flex:1;display:flex;flex-direction:column;gap:10px;";
        const nameEl = document.createElement("div");
        nameEl.style.cssText = "font-size:17px;font-weight:700;color:var(--uw2-ink);";
        nameEl.textContent = fullName;
        const grid = document.createElement("div");
        grid.style.cssText = "display:grid;grid-template-columns:repeat(2,1fr);gap:8px 16px;font-size:14px;color:var(--uw2-ink);";
        const stats: [string, number][] = [
          ["航海等级", st.u8(P + OFF.PERSON.NAV_LEVEL)],
          ["战斗等级", st.u8(P + OFF.PERSON.BATTLE_LEVEL)],
          ["统率力", st.u8(P + 0x1c)],
          ["航海术", st.u8(P + 0x1d)],
          ["知识", st.u8(P + 0x1e)],
          ["直觉", st.u8(P + 0x1f)],
          ["勇气", st.u8(P + 0x20)],
          ["剑术", st.u8(P + 0x21)],
          ["魅力", st.u8(P + 0x22)],
          ["运气", st.u8(P + 0x23)],
        ];
        grid.innerHTML = stats.map(([k, v]) => `<div>${k}：<strong>${v}</strong></div>`).join("");
        rightCol.append(nameEl, grid);
        detail.appendChild(rightCol);

        if (personIds.length === 1) {
          h.body.appendChild(detail);
          return;
        }

        const split = document.createElement("div");
        split.className = "uw2-split narrow-left";
        const left = document.createElement("div");
        left.className = "uw2-list-col";
        personIds.forEach((id, i) => {
          const R = battle.person(id);
          const gn = dec(st.cstr(R));
          const fn = dec(st.cstr(R + OFF.PERSON.FAMILY_NAME));
          const btn = document.createElement("button");
          btn.className = `uw2-row-card ${i === selIdx ? "selected" : ""}`;
          btn.innerHTML = `<span style="font-weight:700;">${fn ? `${gn}·${fn}` : gn}</span><span style="font-size:12px;color:var(--uw2-ink-muted);">战斗等级 ${st.u8(R + OFF.PERSON.BATTLE_LEVEL)}</span>`;
          btn.addEventListener("click", () => { selIdx = i; render(); });
          left.appendChild(btn);
        });
        split.append(left, detail);
        h.body.appendChild(split);
      }, true);
    };

    render();
  });
}

/** 现代羊皮纸作战一览弹窗（取代原版 Canvas 列表） */
export function runDomBattleOrdersModal(battle: any): Promise<void> {
  if (!hasDom()) return Promise.resolve();
  const st = battle.st, codec = battle.c.codec;
  const dec = (bts: Uint8Array) => toSimp(decodeCleanCstr(codec, bts));
  const flag = battle.u16(battle.u16(0x9bc0));

  return new Promise(resolve => {
    const h = createDomModal({
      title: "作战一览",
      size: "md",
      cancelable: true,
      closeLabel: "关闭",
      onCancel: () => resolve(),
    });
    const list = document.createElement("div");
    list.className = "uw2-list-col";
    for (let B = flag; B; B = battle.u16(B + 8)) {
      if (!battle.alive(B)) continue;
      const num = (battle.u8(B + 0x0d) & 0x0f) + 1;
      const R = battle.shipRec(battle.u8(battle.u16(B + 2) + 7));
      const shipName = dec(st.cstr(R));
      const f = battle.u8(B + 0x0c);
      let desc = "";
      if (B === flag) {
        desc = "旗舰";
      } else {
        const form = (f & 8) ? "撤离" : (f & 4) ? "集结" : "分散";
        const stance = (f & 1) ? "攻势" : "守势";
        const strat = (f & 2) ? "攻击" : "退避";
        const tactic = (f & 0x10) ? "炮击" : "肉搏";
        let target = "委任";
        if (f & 0x80) {
          const T = battle.u16(B + 6);
          const sideTag = (battle.u8(T + 0x0d) & 0x20) ? "敌援" : "敌";
          target = `${sideTag}${dec(battle.shipName(battle.u8(T + 0x0d) & 0x0f))}`;
        }
        desc = `${form} · ${stance} · ${strat} · ${tactic} · 目标：${target}`;
      }
      const card = document.createElement("div");
      card.className = "uw2-slot-card";
      card.innerHTML = `<span class="uw2-slot-title">${num}号 ${shipName}</span><span class="uw2-slot-sub">${desc}</span>`;
      list.appendChild(card);
    }
    h.body.appendChild(list);
  });
}

/** 右侧海战 HUD 无遮挡「信号」面板（3 个可点击开关 + 确定） */
export function runDomBattleSignal(battle: any, cur: number): Promise<void> {
  const root = ensureBattleRoot();
  if (!root || !actionCard || !msgCard) return Promise.resolve();

  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("contextmenu", onCtx, true);
      if (actionCard) { actionCard.style.display = "none"; actionCard.innerHTML = ""; }
      if (msgCard) msgCard.style.display = "flex";
      resolve();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); finish(); }
    };
    const onCtx = (e: MouseEvent) => {
      if (document.body?.dataset.uw2Modal === "open") return;
      e.preventDefault(); e.stopPropagation(); finish();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("contextmenu", onCtx, true);

    const render = () => {
      msgCard!.style.display = "none";
      actionCard!.style.display = "flex";
      actionCard!.innerHTML = "";

      const f = battle.u8(cur + 0x0c);
      const head = document.createElement("div");
      head.className = "uw2-battle-action-head";
      head.innerHTML = `<span class="uw2-pane-title">全舰信号</span>`;
      const doneBtn = document.createElement("button");
      doneBtn.className = "uw2-btn uw2-btn-primary";
      doneBtn.style.padding = "4px 14px";
      doneBtn.textContent = "确定";
      doneBtn.addEventListener("click", finish);
      head.appendChild(doneBtn);

      const grid = document.createElement("div");
      grid.className = "uw2-battle-cmd-row";
      const defs: [string, string, number][] = [
        ["行动", (f & 8) ? "撤离" : "继续作战", 8],
        ["阵形", (f & 4) ? "集结" : "分散", 4],
        ["态势", (f & 1) ? "攻势" : "守势", 1],
      ];
      for (const [label, val, bit] of defs) {
        const btn = document.createElement("button");
        btn.className = "uw2-battle-cmd-btn";
        btn.style.cssText = "display:flex;justify-content:space-between;align-items:center;";
        btn.innerHTML = `<span style="color:var(--uw2-ink-muted);font-weight:600;">${label}</span><strong>${val}</strong>`;
        btn.addEventListener("click", () => {
          battle.set8(cur + 0x0c, battle.u8(cur + 0x0c) ^ bit);
          render();
        });
        grid.appendChild(btn);
      }
      actionCard!.append(head, grid);
    };
    render();
  });
}

/** 右侧海战 HUD 无遮挡「作战」单船指令面板（策略 / 战术 / 目标均可直接点击） */
export async function runDomBattleShipOrders(battle: any, B: number): Promise<void> {
  const root = ensureBattleRoot();
  if (!root || !actionCard || !msgCard) return;
  const st = battle.st, codec = battle.c.codec;
  const dec = (bts: Uint8Array) => toSimp(decodeCleanCstr(codec, bts));
  const R = battle.shipRec(battle.u8(battle.u16(B + 2) + 7));
  const shipLabel = `${(battle.u8(B + 0x0d) & 0x0f) + 1}号 ${dec(st.cstr(R))}`;

  for (;;) {
    const action = await new Promise<"strat" | "tactic" | "target" | "done">(resolve => {
      let settled = false;
      const done = (v: "strat" | "tactic" | "target" | "done") => {
        if (settled) return;
        settled = true;
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("contextmenu", onCtx, true);
        if (actionCard) { actionCard.style.display = "none"; actionCard.innerHTML = ""; }
        if (msgCard) msgCard.style.display = "flex";
        resolve(v);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done("done"); }
      };
      const onCtx = (e: MouseEvent) => {
        if (document.body?.dataset.uw2Modal === "open") return;
        e.preventDefault(); e.stopPropagation(); done("done");
      };
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("contextmenu", onCtx, true);

      msgCard!.style.display = "none";
      actionCard!.style.display = "flex";
      actionCard!.innerHTML = "";

      const f = battle.u8(B + 0x0c);
      const head = document.createElement("div");
      head.className = "uw2-battle-action-head";
      head.innerHTML = `<span class="uw2-pane-title">作战 · ${shipLabel}</span>`;
      const doneBtn = document.createElement("button");
      doneBtn.className = "uw2-btn uw2-btn-primary";
      doneBtn.style.padding = "4px 14px";
      doneBtn.textContent = "完成";
      doneBtn.addEventListener("click", () => done("done"));
      head.appendChild(doneBtn);

      let targetText = "委任";
      if (f & 0x80) {
        const T = battle.u16(B + 6);
        const sideTag = (battle.u8(T + 0x0d) & 0x20) ? "敌援" : "敌";
        targetText = `${sideTag}${dec(battle.shipName(battle.u8(T + 0x0d) & 0x0f))}`;
      }

      const grid = document.createElement("div");
      grid.className = "uw2-battle-cmd-row";
      const rows: [string, string, "strat" | "tactic" | "target"][] = [
        ["策略", (f & 2) ? "攻击" : "退避", "strat"],
        ["战术", (f & 0x10) ? "炮击为主" : "肉搏为主", "tactic"],
        ["目标", targetText, "target"],
      ];
      for (const [label, val, act] of rows) {
        const btn = document.createElement("button");
        btn.className = "uw2-battle-cmd-btn";
        btn.style.cssText = "display:flex;justify-content:space-between;align-items:center;";
        btn.innerHTML = `<span style="color:var(--uw2-ink-muted);font-weight:600;">${label}</span><strong>${val}</strong>`;
        btn.addEventListener("click", () => done(act));
        grid.appendChild(btn);
      }
      actionCard!.append(head, grid);
    });

    if (action === "done") break;
    if (action === "strat") {
      battle.set8(B + 0x0c, battle.u8(B + 0x0c) ^ 2);
      battle.and8(B + 0x0c, 0xfe);
      battle.or8(B + 0x0c, (battle.u8(B + 0x0c) & 2) >> 1);
    } else if (action === "tactic") {
      battle.set8(B + 0x0c, battle.u8(B + 0x0c) ^ 0x10);
    } else if (action === "target") {
      if (!(battle.u8(B + 0x0c) & 0x80)) {
        battle.or8(B + 0x0c, 0x80);
        battle.set16(B + 6, await battle.pickTargetFor());
      } else {
        battle.and8(B + 0x0c, 0x7f);
        battle.set16(B + 6, 0);
      }
      if (!battle.u16(B + 6)) battle.and8(B + 0x0c, 0x7f);
    }
  }
}

/** 现代羊皮纸单船情报弹窗（海战我方/敌方舰船） */
export async function runDomBattleShipModal(battle: any, slotAddr: number, titleOverride = ""): Promise<void> {
  if (!hasDom()) return;
  const st = battle.st, art = battle.c.art, codec = battle.c.codec;
  const dec = (bts: Uint8Array) => toSimp(decodeCleanCstr(codec, bts));
  const R = battle.shipRec(st.u8(slotAddr + OFF.DOCK_SLOT.SHIP));
  const T = battle.typeRec(st.u8(R + 0x0f));
  const shipName = dec(st.cstr(R));
  const shipUrl = art?.shipUrl?.(st.u8(R + 0x0f));
  const cannons = battle.sea.commandsObj().T.cannons;
  const cannonName = dec(cannons[st.u8(slotAddr + OFF.DOCK_SLOT.FLAGS) & 7] ?? Uint8Array.of(0));

  const dur = st.u8(slotAddr + OFF.DOCK_SLOT.DURABILITY), maxDur = st.u8(slotAddr + OFF.DOCK_SLOT.MAX_DURABILITY);
  const crew = st.u16(slotAddr), maxCrew = st.u16(R + 0x12);
  const turn = st.u8(slotAddr + OFF.DOCK_SLOT.TURN), maxTurn = st.u8(T + 2);
  const prop = st.u8(slotAddr + OFF.DOCK_SLOT.PROPULSION), maxProp = st.u8(T + 3);
  const guns = st.u8(slotAddr + OFF.DOCK_SLOT.GUNS);

  return new Promise(resolve => {
    const h = createDomModal({
      title: titleOverride || shipName,
      size: "md",
      cancelable: true,
      closeLabel: "关闭",
      onCancel: () => resolve(),
    });
    const box = document.createElement("div");
    box.className = "uw2-action-box";
    if (shipUrl) {
      const img = document.createElement("img");
      img.src = shipUrl;
      img.style.cssText = "width:100%;max-height:140px;object-fit:contain;border-radius:8px;background:#0e1b30;border:1px solid var(--uw2-gold);padding:8px;image-rendering:pixelated;";
      box.appendChild(img);
    }
    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(2,1fr);gap:8px 16px;font-size:14px;color:var(--uw2-ink);";
    grid.innerHTML =
      `<div>船名：<strong>${shipName}</strong></div>` +
      `<div>火炮：<strong>${cannonName} (${guns}门)</strong></div>` +
      `<div>耐久：<strong>${dur} / ${maxDur}</strong></div>` +
      `<div>水手：<strong>${crew} / ${maxCrew}</strong></div>` +
      `<div>转向：<strong>${turn} / ${maxTurn}</strong></div>` +
      `<div>推进：<strong>${prop} / ${maxProp}</strong></div>`;
    box.appendChild(grid);
    h.body.appendChild(box);
  });
}

export function syncDomBattleHud(battle: any) {
  hideDomWorldHud();
  const root = ensureBattleRoot();
  if (!root || !statusCard || !msgCard) return;
  root.style.display = "flex";
  document.body.dataset.uw2Battle = "1";

  const st = battle.st;
  const codec = battle.c.codec;
  const dec = (bts: Uint8Array) => toSimp(decodeCleanCstr(codec, bts));

  let B = 0, di = 0, R = 0, T = 0;
  let allyShips = 0, enemyShips = 0;
  const heroSideParity = battle.u16(0x9d3e) ? 0 : 1;
  for (let k = 0; k < 4; k++) {
    const E = 0x97e0 + 8 * k;
    if (battle.u16(E + 4) === battle.heroFleet) {
      B = battle.u16(E);
      if (B) {
        di = battle.u16(B + 2);
        R = battle.shipRec(st.u8(di + 7));
        T = battle.typeRec(st.u8(R + 0x0f));
      }
    }
    for (let s = battle.u16(E); s; s = battle.u16(s + 8)) {
      const slot = battle.u16(s + 2);
      if (slot && battle.u8(slot + 2) && !(battle.u8(s + 0x0c) & 0x40)) {
        if ((k & 1) === heroSideParity) allyShips++;
        else enemyShips++;
      }
    }
  }

  const shipName = R ? dec(st.cstr(R)) : "旗舰";
  const t = battle.c.rt.time & 0xff;
  const hh = String(Math.floor(t / 3)).padStart(2, "0");
  const mm = String((t % 3) * 20).padStart(2, "0");
  const windDir = battle.u8(0x9bf8) % 6;
  const windStr = battle.u8(0x9bf9);
  const dur = di ? battle.u8(di + 2) : 0;
  const maxDur = di ? battle.u8(di + 3) : 100;
  const crew = di ? battle.u16(di) : 0;
  const maxCrew = R ? battle.u16(R + 0x12) : 100;
  const turn = di ? battle.u8(di + 4) : 0;
  const maxTurn = T ? st.u8(T + 2) : 0;
  const prop = di ? battle.u8(di + 5) : 0;
  const maxProp = T ? st.u8(T + 3) : 0;
  const ammo = B ? battle.u16(B + 0x0e) : 0;

  const skey = `${shipName}|${hh}:${mm}|${windDir}|${windStr}|${dur}/${maxDur}|${crew}/${maxCrew}|${turn}/${maxTurn}|${prop}/${maxProp}|${ammo}|${allyShips}|${enemyShips}`;
  if (skey !== lastStatusKey) {
    lastStatusKey = skey;
    const durPct = maxDur > 0 ? Math.min(100, Math.round((dur * 100) / maxDur)) : 0;
    const crewPct = maxCrew > 0 ? Math.min(100, Math.round((crew * 100) / maxCrew)) : 0;
    statusCard.innerHTML =
      `<div class="uw2-battle-head">` +
        `<div><div class="uw2-battle-ship">${shipName}</div><div class="uw2-battle-sub">我方 ${allyShips} 艘 · 敌方 ${enemyShips} 艘</div></div>` +
        `<div class="uw2-battle-meta">` +
          `<div class="uw2-battle-clock">${hh}:${mm}</div>` +
          `<div class="uw2-battle-wind">${arrowSvg(WIND_ANGLES[windDir])}<span>${WIND_NAMES[windDir]} ${windStr}</span></div>` +
        `</div>` +
      `</div>` +
      `<div class="uw2-battle-bars">` +
        `<div class="uw2-battle-stat"><span>耐久</span><div class="uw2-bar-track"><div class="uw2-bar-fill ${durPct < 35 ? "red" : "green"}" style="width:${durPct}%"></div></div><strong>${dur}/${maxDur}</strong></div>` +
        `<div class="uw2-battle-stat"><span>水手</span><div class="uw2-bar-track"><div class="uw2-bar-fill ${crewPct < 35 ? "red" : "green"}" style="width:${crewPct}%"></div></div><strong>${crew}/${maxCrew}</strong></div>` +
      `</div>` +
      `<div class="uw2-battle-grid">` +
        `<div><span>转向</span><strong>${turn}/${maxTurn}</strong></div>` +
        `<div><span>推进</span><strong>${prop}/${maxProp}</strong></div>` +
        `<div><span>炮弹</span><strong>${ammo}</strong></div>` +
      `</div>`;
  }

  if (miniCtx) {
    miniCtx.fillStyle = "#163b64";
    miniCtx.fillRect(0, 0, 208, 192);
    miniCtx.fillStyle = "#5b7a48";
    for (let y = 0; y < 0x30; y++) {
      for (let x = 0; x < 0x34; x++) {
        if (battle.u8(battle.mapAt(x, y)) & 0x80) {
          miniCtx.fillRect(x * 4, y * 4, 4, 4);
        }
      }
    }
    const ox = battle.u8(0x9bef), oy = battle.u8(0x9bf0);
    miniCtx.strokeStyle = "rgba(255, 244, 204, 0.85)";
    miniCtx.lineWidth = 1.5;
    miniCtx.strokeRect(ox * 4 + 0.75, oy * 4 + 0.75, 13 * 4 - 1.5, 12 * 4 - 1.5);
    for (let k = 0; k < 4; k++) {
      for (let s = battle.u16(0x97e0 + 8 * k); s; s = battle.u16(s + 8)) {
        const slot = battle.u16(s + 2);
        if (!slot || !battle.u8(slot + 2) || (battle.u8(s + 0x0c) & 0x40)) continue;
        const [sx, sy] = battle.pos(s);
        const fl = battle.u8(s + 0x0d);
        const isFlag = battle.u16(0x97e0 + ((fl & 0x30) >> 1)) === s;
        miniCtx.fillStyle = (fl & 0x80) ? (isFlag ? "#ffe066" : "#6ee7b7") : (isFlag ? "#ff5a5f" : "#fca5a5");
        miniCtx.fillRect(sx * 4, sy * 4, 4, 4);
      }
    }
  }

  const msg = battle._wideMsg ? toSimp(battle._wideMsg.trim()) : "";
  if (msg !== lastMsgText) {
    lastMsgText = msg;
    msgCard.innerHTML = `<div class="uw2-pane-title">战况</div><div class="uw2-battle-msg-text">${msg || "—"}</div>`;
  }
}

/** 16:9 现代海战场渲染器：左侧渲染 1.75× 缩放六角格战场，右侧交由羊皮纸 DOM HUD */
export function renderWideBattle(ctx: CanvasRenderingContext2D, scr: any, battle: any) {
  const { x, y, w, h, srcW, srcH } = BATTLE_VIEWPORT;
  ctx.fillStyle = "#081222";
  ctx.fillRect(0, 0, 1280, 720);

  if (scr.hdCanvas) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(scr.hdCanvas, 0, 0, srcW * 2, srcH * 2, x, y, w, h);
  }
  if (scr.fbCanvas) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(scr.fbCanvas, 0, 40, srcW, srcH, x, y, w, h);
  }

  ctx.save();
  ctx.strokeStyle = "#b8904a";
  ctx.lineWidth = 2;
  ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
  ctx.restore();

  if (hasDom() && scr._battleHudActive) syncDomBattleHud(battle);
}
