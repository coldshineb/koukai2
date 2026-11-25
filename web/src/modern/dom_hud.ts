// modern/dom_hud.ts — 16:9 港口/海面主界面羊皮纸现代 HTML/CSS HUD + 新建游戏选角界面
// 与「读取进度 (save_modal.ts)」1:1 同套暖羊皮纸 + 古铜金边视觉，彻底取代老 Canvas 黑蓝框 HUD 与黑底选角页。
import { DS } from "../model/schema_views.ts";
import { decodeCleanCstr, toSimp } from "../canvas_ui/text_util.ts";
import { createDomModal, hasDom, getPersonPortraitSrc } from "./dom_ui.ts";
import { hideDomBattleHud } from "./dom_battle.ts";
import { PortMove } from "../scenes/portmove.js";

let hudRoot: HTMLElement | null = null;
let tlEl: HTMLElement | null = null;
let trWrapEl: HTMLElement | null = null;
let trEl: HTMLElement | null = null;
let pmEl: HTMLElement | null = null;
let blEl: HTMLElement | null = null;
let brEl: HTMLElement | null = null;
let lastTlKey = "";
let lastTrKey = "";
let lastPmKey = "";
let lastBlKey = "";
let currentSys: any = null;
let currentScene: any = null;

const BLD_NAMES = [
  "交易所", "酒馆", "造船厂", "码头",
  "旅馆", "王宫", "事务所", "住宅",
  "银行", "道具店", "教会", "占卜师",
];

// 4 枚主指令按钮对应的 PC BIOS F1-F4 扫描码 (keymap.js: 0x3b / 0x3c / 0x3d / 0x3e)
const CMD_DEFS: [string, number][] = [
  ["情报", 0x3b],
  ["经营", 0x3c],
  ["命令", 0x3d],
  ["航海术", 0x3e],
];

const DIR_LABELS = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];

function ensureHudRoot(): HTMLElement | null {
  if (!hasDom()) return null;
  const host = document.getElementById("uw2-overlay");
  if (!host) return null;
  if (hudRoot && hudRoot.parentElement === host) return hudRoot;

  hudRoot = document.createElement("div");
  hudRoot.className = "uw2-world-hud";

  tlEl = document.createElement("div");
  tlEl.className = "uw2-card uw2-hud-card uw2-hud-tl";

  trWrapEl = document.createElement("div");
  trWrapEl.className = "uw2-hud-tr-wrap";

  trEl = document.createElement("div");
  trEl.className = "uw2-card uw2-hud-card";

  pmEl = document.createElement("div");
  pmEl.className = "uw2-card uw2-hud-pm";

  trWrapEl.append(trEl, pmEl);

  blEl = document.createElement("div");
  blEl.className = "uw2-card uw2-hud-compass";

  brEl = document.createElement("div");
  brEl.className = "uw2-hud-cmdbar";
  CMD_DEFS.forEach(([label], idx) => {
    const btn = document.createElement("button");
    btn.className = "uw2-btn uw2-hud-cmdbtn";
    btn.textContent = label;
    btn.addEventListener("pointerdown", e => { e.stopPropagation(); });
    btn.addEventListener("click", e => {
      e.stopPropagation();
      if (document.body.dataset.uw2Modal === "open") return;
      if (currentScene) currentScene.pendingCmd = idx;
    });
    brEl!.appendChild(btn);
  });

  if (!(window as any).__uw2CmdKeyHooked) {
    (window as any).__uw2CmdKeyHooked = true;
    window.addEventListener("keydown", e => {
      if (document.body.dataset.uw2Modal === "open") return;
      if (!hudRoot || hudRoot.style.display === "none") return;
      const idx = e.key === "F1" ? 0 : e.key === "F2" ? 1 : e.key === "F3" ? 2 : e.key === "F4" ? 3 : -1;
      if (idx < 0) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (currentScene) currentScene.pendingCmd = idx;
    }, true);
  }

  hudRoot.append(tlEl, trWrapEl, blEl, brEl);
  host.appendChild(hudRoot);
  return hudRoot;
}

export function hideDomWorldHud() {
  if (hudRoot) hudRoot.style.display = "none";
}

export function syncDomWorldHud(scene: any, atSea: boolean) {
  hideDomBattleHud();
  const root = ensureHudRoot();
  if (!root || !tlEl || !trEl || !pmEl || !blEl) return;
  root.style.display = "block";

  const c = scene.c, st = c.state, m = st.model, rt = c.rt, art = c.art, codec = c.codec;
  currentSys = c.sys;
  currentScene = scene;

  // 1. 左上：头像 + 日期时刻 + 声望/金块/金币
  const heroId = m.globals.hero;
  const months = scene.months ?? [];
  const monthStr = months[rt.month] ? decodeCleanCstr(codec, months[rt.month]) : `${rt.month + 1}`;
  const t = rt.time;
  const hh = ((Math.floor(t / 3) + 11) % 12) + 1;
  const mm = String((t % 3) * 20).padStart(2, "0");
  const ap = t >= 0x24 ? "PM" : "AM";
  const dateOnlyText = `A.D.${rt.year + 1501} ${monthStr} ${rt.day + 1}`;
  const dateText = atSea ? dateOnlyText : `${dateOnlyText}  ${hh}:${mm}${ap}`;
  const hd = m.heroInfo();
  const fame = Math.max(hd.tradeFame, hd.pirateFame, hd.adventureFame);
  const money = m.globals.money;
  const bars = Math.trunc(money / 10000);
  const gold = money % 10000;

  const ss = atSea ? scene._seaStats : null;
  let seaWater = ss?.water ?? 0;
  let seaFood = ss?.food ?? 0;
  let seaLumber = ss?.lumber ?? 0;
  let seaAmmo = ss?.ammo ?? 0;
  if (atSea && typeof scene.slotOf === "function" && typeof scene.crewOf === "function") {
    let w = 0, f = 0, l = 0, a = 0;
    for (let i = 0; i < 10; i++) {
      const S = scene.slotOf(i);
      if ((st.u8(S + 8) & 0x30) !== 0x10) continue;
      const M = scene.crewOf(i);
      w = (w + st.u16(M)) & 0xffff;
      f = (f + st.u16(M + 2)) & 0xffff;
      l = (l + st.u16(M + 4)) & 0xffff;
      a = (a + st.u16(M + 6)) & 0xffff;
    }
    seaWater = Math.floor(w / 10);
    seaFood = Math.floor(f / 10);
    seaLumber = (l << 16) >> 16;
    seaAmmo = (a << 16) >> 16;
  }
  const tlKey = atSea && ss
    ? `S|${heroId}|${dateText}|${seaWater}|${seaFood}|${seaLumber}|${seaAmmo}`
    : `P|${heroId}|${dateText}|${fame}|${bars}|${gold}`;
  if (tlKey !== lastTlKey) {
    lastTlKey = tlKey;
    tlEl.innerHTML = "";
    const img = document.createElement("img");
    img.className = "uw2-portrait-img";
    img.style.cssText = "width:62px;height:78px;";
    void getPersonPortraitSrc(art, st.bytes(st.personRecord(heroId), 0x32)).then(src => { if (src) img.src = src; });

    const info = document.createElement("div");
    info.style.cssText = "display:flex;flex-direction:column;gap:5px;min-width:258px;";
    if (atSea && ss) {
      info.innerHTML = `
        <div style="font-size:15.5px;font-weight:700;color:#7a4e10;font-variant-numeric:tabular-nums;">${dateText}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px 12px;font-size:15px;font-weight:600;color:var(--uw2-ink);font-variant-numeric:tabular-nums;">
          <span style="white-space:nowrap;">水 <b style="color:${seaWater <= 10 ? "#b83d3d" : "#2a6bb8"};">${seaWater}</b></span>
          <span style="white-space:nowrap;">粮食 <b style="color:${seaFood <= 10 ? "#b83d3d" : "#247544"};">${seaFood}</b></span>
          <span style="white-space:nowrap;">物资 <b>${seaLumber}</b></span>
          <span style="white-space:nowrap;">炮弹 <b>${seaAmmo}</b></span>
        </div>
      `;
    } else {
      info.innerHTML = `
        <div style="font-size:15.5px;font-weight:700;color:#7a4e10;font-variant-numeric:tabular-nums;">${dateText}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px 12px;font-size:15px;font-weight:600;color:var(--uw2-ink);font-variant-numeric:tabular-nums;">
          <span style="white-space:nowrap;">声望 <b>${fame}</b></span>
          <span style="white-space:nowrap;">金块 <b style="color:#8a5d17;">${bars}</b></span>
          <span style="white-space:nowrap;">金币 <b style="color:#8a5d17;">${gold}</b></span>
        </div>
      `;
    }
    tlEl.append(img, info);
  }

  // 2. 右上：港情（含商业/工业投资额）+ 港内置筑一键直达  或  海上气象
  if (!atSea) {
    const P = scene.port;
    if (P >= 130) return;
    const portName = decodeCleanCstr(codec, m.port(P).nameBytes);
    const E = P < 100 ? m.portEconomy(P) : null;
    const regionName = E ? toSimp(c.messageText(0x181 + E.priceRegion).trim()) : "";
    let avgPrice = 100;
    const com = E ? (E.commerce << 16) >> 16 : 0;
    const ind = E ? (E.industry << 16) >> 16 : 0;
    const comInv = E ? E.commerceInvest : 0;
    const indInv = E ? E.industryInvest : 0;
    if (E) {
      let sum = 0;
      for (let i = 0; i < 10; i++) sum += E.getPrices(i);
      avgPrice = Math.trunc(sum / 10) + 50;
    }
    const trKey = `P|${P}|${portName}|${regionName}|${com}|${ind}|${comInv}|${indInv}|${avgPrice}`;
    if (trKey !== lastTrKey) {
      lastTrKey = trKey;
      trEl.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:5px;width:100%;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;">
            <span style="font-size:19px;font-weight:700;color:var(--uw2-ink);">${portName}</span>
            <span style="font-size:13.5px;font-weight:600;color:#7a4e10;">${regionName}</span>
          </div>
          ${E ? `
          <div style="display:flex;justify-content:space-between;font-size:14.5px;color:var(--uw2-ink);">
            <span>商业 <b>${com}</b> <small style="color:#7a4e10;font-size:12.5px;">(投资 ${comInv})</small></span>
            <span>物价 <b style="color:#8a5d17;">${avgPrice}%</b></span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:14.5px;color:var(--uw2-ink);">
            <span>工业 <b>${ind}</b> <small style="color:#7a4e10;font-size:12.5px;">(投资 ${indInv})</small></span>
          </div>` : ""}
        </div>
      `;
    }

    // 港内置筑一键直达（只在允许港内移动时显示）
    if (PortMove.enabled(c) && scene.door) {
      const items: { k: number; open: boolean; ok: boolean }[] = [];
      for (let k = 0; k < 12; k++) {
        if (!PortMove.present(scene, k)) continue;
        items.push({ k, open: !!scene.isOpen?.(k), ok: PortMove.reachable(scene, k) });
      }
      const pmKey = `${P}|${rt.time}|${scene.hx},${scene.hy},${scene.vx},${scene.vy}|` + items.map(x => `${x.k}:${x.open ? 1 : 0}${x.ok ? 1 : 0}`).join(",");
      pmEl.style.display = items.length ? "grid" : "none";
      pmEl.style.gridTemplateColumns = "";
      pmEl.style.gap = "";
      if (pmKey !== lastPmKey) {
        lastPmKey = pmKey;
        pmEl.innerHTML = "";
        for (const it of items) {
          const btn = document.createElement("button");
          btn.className = `uw2-pm-btn ${it.open ? "open" : "closed"}`;
          btn.disabled = !it.ok;
          btn.innerHTML = `<span class="uw2-pm-dot"></span><span>${BLD_NAMES[it.k] || ""}</span>`;
          btn.addEventListener("pointerdown", e => e.stopPropagation());
          btn.addEventListener("click", e => {
            e.stopPropagation();
            if (document.body.dataset.uw2Modal === "open") return;
            if (!currentScene) return;
            currentScene.pmTarget = it.k;
            currentSys?.pushKey?.(0, 0);
          });
          pmEl.appendChild(btn);
        }
      }
    } else {
      pmEl.style.display = "none";
    }
  } else {
    const a = st.u8(DS.PORT_FLAGS);
    const b = st.u8(DS.WIND_CUR);
    const windDir = (a & 0x38) >> 3, windStr = a & 7;
    const curDir = (b & 0x38) >> 3, curStr = b & 7;
    const headDir = st.u8(scene.fleet + 0x1a);
    const spd = (scene.speed + 1) >> 1;
    const days = st.u8(DS.DAYS_AT_SEA);
    const trKey = `S|${windDir}|${windStr}|${curDir}|${curStr}|${headDir}|${spd}|${days}`;
    if (trKey !== lastTrKey) {
      lastTrKey = trKey;
      const arrowSvg = (dir: number, active: boolean, color: string) => active && dir < 8
        ? `<svg viewBox="0 0 28 28" width="30" height="30" style="display:block;margin:2px auto;">
             <circle cx="14" cy="14" r="12" fill="rgba(255,252,244,0.9)" stroke="#b3873a" stroke-width="1.3"/>
             <g transform="rotate(${dir * 45} 14 14)">
               <polygon points="14,4 18.5,18 14,15 9.5,18" fill="${color}"/>
             </g>
           </svg>`
        : `<svg viewBox="0 0 28 28" width="30" height="30" style="display:block;margin:2px auto;">
             <circle cx="14" cy="14" r="12" fill="rgba(255,252,244,0.75)" stroke="#b3873a" stroke-width="1.3"/>
             <circle cx="14" cy="14" r="3" fill="#8a7a62"/>
           </svg>`;
      trEl.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr 1.25fr;gap:6px;align-items:center;font-size:14.5px;color:var(--uw2-ink);width:100%;text-align:center;font-variant-numeric:tabular-nums;">
          <div style="min-width:0;">
            <div style="color:var(--uw2-ink-muted);margin-bottom:2px;font-weight:600;">风向</div>
            ${arrowSvg(windDir, windStr > 0, "#247544")}
            <b style="display:block;white-space:nowrap;">${windStr ? `${DIR_LABELS[windDir]} ${windStr}` : "无风"}</b>
          </div>
          <div style="min-width:0;">
            <div style="color:var(--uw2-ink-muted);margin-bottom:2px;font-weight:600;">洋流</div>
            ${arrowSvg(curDir, curStr > 0, "#2a6bb8")}
            <b style="display:block;white-space:nowrap;">${curStr ? `${DIR_LABELS[curDir]} ${curStr}` : "平静"}</b>
          </div>
          <div style="min-width:0;">
            <div style="color:var(--uw2-ink-muted);margin-bottom:2px;font-weight:600;">航向</div>
            ${arrowSvg(headDir, headDir < 8, "#c93b2b")}
            <b style="display:block;white-space:nowrap;color:#8a5d17;">${spd}kt · ${days}天</b>
          </div>
        </div>
      `;
    }

    // 海上右侧舰队完整状态栏（还原原版 7 项属性：转向力 / 推进力 / 耐久度 / 吃水量 / 瞭望范围 / 水手 / 船舰状态）
    if (ss) {
      let turn = ss.turn;
      let prop = ss.prop;
      if ((turn === undefined || prop === undefined) && typeof scene.slotOf === "function") {
        let minT = 100, minP = 100, found = false;
        for (let i = 0; i < 10; i++) {
          const S = scene.slotOf(i);
          if ((st.u8(S + 8) & 0x30) !== 0x10) continue;
          found = true;
          minT = Math.min(minT, st.u8(S + 4));
          minP = Math.min(minP, st.u8(S + 5));
        }
        if (turn === undefined) turn = found ? minT : 0;
        if (prop === undefined) prop = found ? minP : 0;
      }
      turn = turn ?? 0;
      prop = prop ?? 0;
      const sightPct = ss.sightPct ?? (typeof scene.sight === "number" ? Math.trunc((100 * scene.sight) / 24) : 0);
      const crewPct = ss.maxCrewSum > 0 ? Math.min(100, Math.round((ss.crewSum * 100) / ss.maxCrewSum)) : 0;
      const seaPmKey = `SEA|${turn}|${prop}|${ss.minDur}|${ss.loadPct}|${sightPct}|${ss.crewSum}/${ss.maxCrewSum}|${ss.morale}`;
      pmEl.style.display = "grid";
      pmEl.style.gridTemplateColumns = "1fr 1fr";
      pmEl.style.gap = "8px 14px";
      if (seaPmKey !== lastPmKey) {
        lastPmKey = seaPmKey;
        const barRow = (lbl: string, valTxt: string, pct: number, cls = "") =>
          `<div style="display:flex;flex-direction:column;gap:3px;">` +
          `<div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;color:var(--uw2-ink);"><span style="color:var(--uw2-ink-muted);">${lbl}</span><span style="font-variant-numeric:tabular-nums;">${valTxt}</span></div>` +
          `<div class="uw2-bar-track" style="height:7px;"><div class="uw2-bar-fill ${cls}" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>` +
          `</div>`;
        pmEl.innerHTML =
          barRow("转向力", `${turn}`, turn) +
          barRow("推进力", `${prop}`, prop) +
          barRow("耐久度", `${ss.minDur}`, ss.minDur, ss.minDur < 40 ? "red" : "green") +
          barRow("吃水量", `${ss.loadPct}%`, ss.loadPct, ss.loadPct >= 90 ? "red" : "") +
          barRow("瞭望范围", `${sightPct}%`, sightPct) +
          barRow("水手", `${ss.crewSum}/${ss.maxCrewSum}`, crewPct, crewPct < 40 ? "red" : "green") +
          barRow("船舰状态", `${ss.morale}`, ss.morale, ss.morale < 40 ? "red" : "green");
      }
    } else {
      pmEl.style.display = "none";
    }
  }

  // 3. 左下：罗盘
  const rawNeedle = scene.needle === 0xff ? 0 : scene.needle;
  const deg = atSea ? rawNeedle * 45 : rawNeedle * 90;
  const blKey = `${deg}`;
  if (blKey !== lastBlKey) {
    lastBlKey = blKey;
    blEl.innerHTML = `
      <svg viewBox="0 0 64 64" width="58" height="58" aria-hidden="true">
        <circle cx="32" cy="32" r="28" fill="none" stroke="#b3873a" stroke-width="1.5" opacity="0.55"/>
        <text x="32" y="12" text-anchor="middle" font-size="9" font-weight="700" fill="#7a4e10">N</text>
        <text x="32" y="58" text-anchor="middle" font-size="9" font-weight="700" fill="#7a4e10">S</text>
        <text x="10" y="35" text-anchor="middle" font-size="9" font-weight="700" fill="#7a4e10">W</text>
        <text x="54" y="35" text-anchor="middle" font-size="9" font-weight="700" fill="#7a4e10">E</text>
        <g transform="rotate(${deg} 32 32)">
          <polygon points="32,14 36,32 28,32" fill="#c93b2b"/>
          <polygon points="32,50 36,32 28,32" fill="#3a4c66"/>
          <circle cx="32" cy="32" r="3" fill="#e5c170"/>
        </g>
      </svg>
    `;
  }
}

/** 现代羊皮纸「新建游戏 — 选择主角 + 可选改名」一体化界面 */
export function runDomNewGameSelect(
  heroes: { id: number; name: string; given: string; family: string; age: number; stats: number[]; skill: string; intro: string; portraitUrl: string | null }[],
  statLabels: string[],
  cancelable: boolean,
): Promise<{ id: number; given: string; family: string } | null> {
  return new Promise(resolve => {
    let selected = 0;
    let settled = false;
    const customNames = heroes.map(h => ({ given: h.given, family: h.family }));
    const done = (v: { id: number; given: string; family: string } | null) => {
      if (settled) return;
      settled = true;
      h.close();
      resolve(v);
    };

    const h = createDomModal({
      title: "开始新航海",
      size: "wide",
      cancelable,
      closeLabel: "关闭",
      onCancel: () => done(null),
    });

    const footer = document.createElement("div");
    footer.className = "uw2-modal-footer";
    const okBtn = document.createElement("button");
    okBtn.className = "uw2-btn uw2-btn-primary";
    okBtn.style.padding = "8px 28px";
    okBtn.textContent = "开始航海";
    okBtn.addEventListener("click", () => {
      const nm = customNames[selected];
      done({ id: selected, given: nm.given.trim(), family: nm.family.trim() });
    });
    footer.appendChild(okBtn);
    h.modal.appendChild(footer);

    const render = () => {
      h.body.innerHTML = "";
      const split = document.createElement("div");
      split.className = "uw2-split";

      const grid = document.createElement("div");
      grid.style.cssText = "display:grid;grid-template-columns:repeat(3,1fr);gap:10px;";
      heroes.forEach((hero, i) => {
        const card = document.createElement("button");
        card.className = `uw2-pers-card ${i === selected ? "selected" : ""}`;
        card.style.cssText = `padding:10px;gap:6px;${i === selected ? "border-color:#9e6d1c;background:#f7e4b2;box-shadow:0 0 0 2px rgba(158,109,28,0.28);" : ""}`;
        if (hero.portraitUrl) {
          const img = document.createElement("img");
          img.className = "uw2-portrait-img";
          img.style.cssText = "width:76px;height:95px;";
          img.src = hero.portraitUrl;
          card.appendChild(img);
        }
        const nm = document.createElement("div");
        nm.style.cssText = "font-weight:700;font-size:13px;color:var(--uw2-ink);text-align:center;";
        nm.textContent = hero.name;
        card.appendChild(nm);
        card.addEventListener("click", () => { selected = i; render(); });
        grid.appendChild(card);
      });

      const cur = heroes[selected];
      const curName = customNames[selected];
      const detail = document.createElement("div");
      detail.className = "uw2-action-box";
      detail.style.gap = "10px";

      const head = document.createElement("div");
      head.style.cssText = "display:flex;justify-content:space-between;align-items:baseline;";
      head.innerHTML = `<span style="font-size:19px;font-weight:700;color:var(--uw2-ink);">${cur.name}</span><span style="font-size:13px;color:#7a4e10;font-weight:600;">${cur.age}岁 · ${cur.skill}</span>`;

      const nameRow = document.createElement("div");
      nameRow.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;";
      const mkField = (label: string, val: string, onChange: (v: string) => void) => {
        const box = document.createElement("label");
        box.style.cssText = "display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--uw2-ink-muted);";
        const span = document.createElement("span");
        span.textContent = label;
        const inp = document.createElement("input");
        inp.type = "text";
        inp.maxLength = 6;
        inp.value = val;
        inp.style.cssText = "flex:1;min-width:0;padding:4px 8px;font-size:13px;font-weight:600;border:1px solid var(--uw2-gold);border-radius:6px;background:#fffdf6;color:var(--uw2-ink);";
        inp.addEventListener("input", () => onChange(inp.value));
        box.append(span, inp);
        return box;
      };
      nameRow.append(
        mkField("名字", curName.given, v => { curName.given = v; }),
        mkField("姓氏", curName.family, v => { curName.family = v; }),
      );

      const intro = document.createElement("div");
      intro.style.cssText = "font-size:14px;line-height:1.65;color:var(--uw2-ink);padding:8px 10px;background:rgba(255,252,242,0.7);border-radius:6px;border:1px solid rgba(154,119,56,0.25);";
      intro.textContent = cur.intro;

      const statsGrid = document.createElement("div");
      statsGrid.style.cssText = "display:grid;grid-template-columns:repeat(2,1fr);gap:8px 14px;";
      cur.stats.forEach((v, idx) => {
        const row = document.createElement("div");
        row.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;margin-bottom:2px;"><span>${statLabels[idx] || ""}</span><span>${v}</span></div><div class="uw2-bar-track"><div class="uw2-bar-fill ${v >= 80 ? "" : "green"}" style="width:${Math.min(100, v)}%"></div></div>`;
        statsGrid.appendChild(row);
      });

      detail.append(head, nameRow, intro, statsGrid);
      split.append(grid, detail);
      h.body.appendChild(split);
    };

    render();
  });
}

/** 现代 16:9 标题开始界面（深海航海罗盘全屏底图 + 古铜金标题 + 暖羊皮纸主菜单，彻底取代模糊 KOEI Canvas） */
export function runDomTitleMenu(labels: string[]): Promise<number> {
  if (!hasDom()) return Promise.resolve(0);
  hideDomWorldHud();

  return new Promise(resolve => {
    let settled = false;
    let selected = 0;

    const backdrop = document.createElement("div");
    backdrop.className = "uw2-title-screen";
    backdrop.innerHTML =
      `<svg class="uw2-title-compass" viewBox="0 0 240 240" aria-hidden="true">` +
        `<circle cx="120" cy="120" r="112" fill="none" stroke="rgba(214,174,96,0.22)" stroke-width="1.2" stroke-dasharray="4 6"/>` +
        `<circle cx="120" cy="120" r="88" fill="none" stroke="rgba(214,174,96,0.18)" stroke-width="1"/>` +
        `<polygon points="120,10 134,106 230,120 134,134 120,230 106,134 10,120 106,106" fill="rgba(214,174,96,0.08)" stroke="rgba(214,174,96,0.26)" stroke-width="1"/>` +
        `<polygon points="120,38 128,112 202,120 128,128 120,202 112,128 38,120 112,112" fill="rgba(230,198,124,0.07)"/>` +
      `</svg>` +
      `<div class="uw2-title-hero">` +
        `<div class="uw2-title-sub">UNCHARTED WATERS II</div>` +
        `<h1 class="uw2-title-main">大航海时代 II</h1>` +
        `<div class="uw2-title-rule"></div>` +
      `</div>`;

    const card = document.createElement("div");
    card.className = "uw2-card uw2-title-menu";
    const btns: HTMLButtonElement[] = [];

    const done = (idx: number) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("keydown", onKey, true);
      delete document.body.dataset.uw2Modal;
      backdrop.remove();
      resolve(idx);
    };

    labels.forEach((raw, i) => {
      const btn = document.createElement("button");
      btn.className = `uw2-title-btn ${i === selected ? "selected" : ""}`;
      btn.textContent = toSimp(raw).replace(/\s+/g, "");
      btn.addEventListener("mouseenter", () => { selected = i; sync(); });
      btn.addEventListener("click", () => done(i));
      btns.push(btn);
      card.appendChild(btn);
    });

    const sync = () => btns.forEach((b, i) => b.classList.toggle("selected", i === selected));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); selected = (selected + labels.length - 1) % labels.length; sync(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); selected = (selected + 1) % labels.length; sync(); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); done(selected); }
    };

    backdrop.appendChild(card);
    document.body.dataset.uw2Modal = "open";
    document.body.appendChild(backdrop);
    window.addEventListener("keydown", onKey, true);
  });
}

export interface DomSettingsToggle {
  label: string;
  onText: string;
  offText: string;
  get: () => boolean;
  toggle: () => void | Promise<void>;
}

export interface DomSettingsSlider {
  label: string;
  min: number;
  max: number;
  get: () => number;
  set: (v: number) => void;
}

/** 独立现代环境设置界面（开关分段钮 + 可拖拽古铜金滑杆，标题画面与游戏内共用） */
export function runDomSettingsModal(opts: {
  title: string;
  toggles: DomSettingsToggle[];
  sliders: DomSettingsSlider[];
}): Promise<void> {
  if (!hasDom()) return Promise.resolve();

  return new Promise(resolve => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      h.close();
      resolve();
    };

    const h = createDomModal({
      title: toSimp(opts.title),
      size: "md",
      cancelable: true,
      closeLabel: "关闭",
      onCancel: done,
    });
    h.modal.classList.add("uw2-settings-modal");

    const wrap = document.createElement("div");
    wrap.className = "uw2-settings-wrap";

    if (opts.toggles.length) {
      const sec = document.createElement("div");
      sec.className = "uw2-settings-section";
      const hd = document.createElement("div");
      hd.className = "uw2-settings-heading";
      hd.textContent = "显示与音频";
      sec.appendChild(hd);

      opts.toggles.forEach(item => {
        const row = document.createElement("div");
        row.className = "uw2-settings-row";

        const lbl = document.createElement("span");
        lbl.className = "uw2-settings-label";
        lbl.textContent = toSimp(item.label).replace(/\s+/g, "");

        const seg = document.createElement("div");
        seg.className = "uw2-seg-group";
        const btnOn = document.createElement("button");
        btnOn.type = "button";
        btnOn.className = "uw2-seg-btn";
        btnOn.textContent = toSimp(item.onText).replace(/\s+/g, "") || "开";

        const btnOff = document.createElement("button");
        btnOff.type = "button";
        btnOff.className = "uw2-seg-btn";
        btnOff.textContent = toSimp(item.offText).replace(/\s+/g, "") || "关";

        const sync = () => {
          const on = item.get();
          btnOn.classList.toggle("active", on);
          btnOff.classList.toggle("active", !on);
        };

        let busy = false;
        const setTarget = async (wantOn: boolean) => {
          if (busy || item.get() === wantOn) return;
          busy = true;
          try { await item.toggle(); } finally { busy = false; sync(); }
        };
        btnOn.addEventListener("click", () => { void setTarget(true); });
        btnOff.addEventListener("click", () => { void setTarget(false); });
        sync();

        seg.append(btnOn, btnOff);
        row.append(lbl, seg);
        sec.appendChild(row);
      });
      wrap.appendChild(sec);
    }

    if (opts.sliders.length) {
      const sec = document.createElement("div");
      sec.className = "uw2-settings-section";
      const hd = document.createElement("div");
      hd.className = "uw2-settings-heading";
      hd.textContent = "操作与速度";
      sec.appendChild(hd);

      opts.sliders.forEach(item => {
        const row = document.createElement("div");
        row.className = "uw2-settings-row";

        const lbl = document.createElement("span");
        lbl.className = "uw2-settings-label";
        lbl.textContent = toSimp(item.label).replace(/\s+/g, "");

        const ctrl = document.createElement("div");
        ctrl.className = "uw2-settings-slider-box";

        const minusBtn = document.createElement("button");
        minusBtn.type = "button";
        minusBtn.className = "uw2-btn uw2-btn-step";
        minusBtn.textContent = "−";

        const range = document.createElement("input");
        range.type = "range";
        range.className = "uw2-slider uw2-settings-slider";
        range.min = String(item.min);
        range.max = String(item.max);
        range.step = "1";

        const plusBtn = document.createElement("button");
        plusBtn.type = "button";
        plusBtn.className = "uw2-btn uw2-btn-step";
        plusBtn.textContent = "+";

        const valBadge = document.createElement("span");
        valBadge.className = "uw2-settings-val";

        const sync = () => {
          const cur = item.get();
          range.value = String(cur);
          valBadge.textContent = `${cur} / ${item.max}`;
          minusBtn.disabled = cur <= item.min;
          plusBtn.disabled = cur >= item.max;
        };

        range.addEventListener("input", () => {
          item.set(Number(range.value));
          sync();
        });
        minusBtn.addEventListener("click", () => {
          item.set(Math.max(item.min, item.get() - 1));
          sync();
        });
        plusBtn.addEventListener("click", () => {
          item.set(Math.min(item.max, item.get() + 1));
          sync();
        });
        sync();

        ctrl.append(minusBtn, range, plusBtn, valBadge);
        row.append(lbl, ctrl);
        sec.appendChild(row);
      });
      wrap.appendChild(sec);
    }

    h.body.appendChild(wrap);

    const footer = document.createElement("div");
    footer.className = "uw2-modal-footer";
    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "uw2-btn uw2-btn-primary";
    okBtn.style.padding = "8px 28px";
    okBtn.textContent = "完成";
    okBtn.addEventListener("click", done);
    footer.appendChild(okBtn);
    h.modal.appendChild(footer);
  });
}
