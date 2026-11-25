// modern/dom_battle.ts — 16:9 現代羊皮紙海戰 HUD + 戰場 Canvas 縮放渲染器
// 左側 (20, 10, 728×700) 清晰呈現 1.75× 縮放六角格海戰場，右側以暖羊皮紙卡片呈現旗艦狀態、風向、戰術小地圖與戰況訊息。
import { hasDom } from "./dom_ui.ts";
import { hideDomWorldHud } from "./dom_hud.ts";
import { decodeCleanCstr, toSimp } from "../canvas_ui/text_util.ts";
import { DS } from "../model/schema_views.ts";

export const BATTLE_VIEWPORT = { x: 20, y: 10, w: 728, h: 700, srcW: 416, srcH: 400 };

const WIND_NAMES = ["北", "东北", "东南", "南", "西南", "西北"];
const WIND_ANGLES = [0, 60, 120, 180, 240, 300];

let battleRoot: HTMLElement | null = null;
let statusCard: HTMLElement | null = null;
let miniCanvas: HTMLCanvasElement | null = null;
let miniCtx: CanvasRenderingContext2D | null = null;
let msgCard: HTMLElement | null = null;
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

  battleRoot.append(statusCard, miniCard, msgCard);
  host.appendChild(battleRoot);
  return battleRoot;
}

export function hideDomBattleHud() {
  if (battleRoot) battleRoot.style.display = "none";
  lastStatusKey = "";
  lastMsgText = "";
}

export function syncDomBattleHud(battle: any) {
  hideDomWorldHud();
  const root = ensureBattleRoot();
  if (!root || !statusCard || !msgCard) return;
  root.style.display = "flex";

  const st = battle.st;
  const codec = battle.c.codec;
  const dec = (bts: Uint8Array) => toSimp(decodeCleanCstr(codec, bts));

  // 1. 取得主角旗艦資料與雙方存活船數
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

  // 2. 繪製戰術小地圖 (52 × 48, 每格 4×4 像素 = 208×192)
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
    // 視窗框
    const ox = battle.u8(0x9bef), oy = battle.u8(0x9bf0);
    miniCtx.strokeStyle = "rgba(255, 244, 204, 0.85)";
    miniCtx.lineWidth = 1.5;
    miniCtx.strokeRect(ox * 4 + 0.75, oy * 4 + 0.75, 13 * 4 - 1.5, 12 * 4 - 1.5);
    // 各艦隊船隻點
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

  // 3. 戰況訊息欄
  const msg = battle._wideMsg ? toSimp(battle._wideMsg.trim()) : "";
  if (msg !== lastMsgText) {
    lastMsgText = msg;
    msgCard.innerHTML = `<div class="uw2-pane-title">战况</div><div class="uw2-battle-msg-text">${msg || "—"}</div>`;
  }
}

/** 16:9 現代海戰場渲染器：左側渲染 1.75× 縮放六角格戰場，右側交由羊皮紙 DOM HUD */
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

  // 古銅金戰場邊框
  ctx.save();
  ctx.strokeStyle = "#b8904a";
  ctx.lineWidth = 2;
  ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
  ctx.restore();

  if (hasDom()) syncDomBattleHud(battle);
}
