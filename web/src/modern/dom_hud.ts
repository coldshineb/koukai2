// modern/dom_hud.ts — 16:9 港口/海面主介面羊皮紙現代 HTML/CSS HUD + 新建遊戲選角介面
// 與「讀取進度 (save_modal.ts)」1:1 同套暖羊皮紙 + 古銅金邊視覺，徹底取代老 Canvas 黑藍框 HUD 與黑底選角頁。
import { DS } from "../model/schema_views.ts";
import { decodeCleanCstr, toSimp } from "../canvas_ui/text_util.ts";
import { createDomModal, hasDom, getPersonPortraitSrc } from "./dom_ui.ts";
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

// 4 枚主指令按鈕對應的 PC BIOS F1-F4 掃描碼 (keymap.js: 0x3b / 0x3c / 0x3d / 0x3e)
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
  for (const [label, scan] of CMD_DEFS) {
    const btn = document.createElement("button");
    btn.className = "uw2-btn uw2-hud-cmdbtn";
    btn.textContent = label;
    btn.addEventListener("pointerdown", e => { e.stopPropagation(); });
    btn.addEventListener("click", e => {
      e.stopPropagation();
      if (document.body.dataset.uw2Modal === "open") return;
      currentSys?.pushKey?.(scan, 0);
    });
    brEl.appendChild(btn);
  }

  hudRoot.append(tlEl, trWrapEl, blEl, brEl);
  host.appendChild(hudRoot);
  return hudRoot;
}

export function hideDomWorldHud() {
  if (hudRoot) hudRoot.style.display = "none";
}

export function syncDomWorldHud(scene: any, atSea: boolean) {
  const root = ensureHudRoot();
  if (!root || !tlEl || !trEl || !pmEl || !blEl) return;
  root.style.display = "block";

  const c = scene.c, st = c.state, m = st.model, rt = c.rt, art = c.art, codec = c.codec;
  currentSys = c.sys;
  currentScene = scene;

  // 1. 左上：頭像 + 日期時刻 + 聲望/金塊/金幣
  const heroId = m.globals.hero;
  const months = scene.months ?? [];
  const monthStr = months[rt.month] ? decodeCleanCstr(codec, months[rt.month]) : `${rt.month + 1}`;
  const t = rt.time;
  const hh = ((Math.floor(t / 3) + 11) % 12) + 1;
  const mm = String((t % 3) * 20).padStart(2, "0");
  const ap = t >= 0x24 ? "PM" : "AM";
  const dateText = `A.D.${rt.year + 1501} ${monthStr} ${rt.day + 1}  ${hh}:${mm}${ap}`;
  const hd = m.heroInfo();
  const fame = Math.max(hd.tradeFame, hd.pirateFame, hd.adventureFame);
  const money = m.globals.money;
  const bars = Math.trunc(money / 10000);
  const gold = money % 10000;

  const tlKey = `${heroId}|${dateText}|${fame}|${bars}|${gold}`;
  if (tlKey !== lastTlKey) {
    lastTlKey = tlKey;
    tlEl.innerHTML = "";
    const img = document.createElement("img");
    img.className = "uw2-portrait-img";
    img.style.cssText = "width:54px;height:68px;";
    void getPersonPortraitSrc(art, st.bytes(st.personRecord(heroId), 0x32)).then(src => { if (src) img.src = src; });

    const info = document.createElement("div");
    info.style.cssText = "display:flex;flex-direction:column;gap:4px;min-width:210px;";
    info.innerHTML = `
      <div style="font-size:13px;font-weight:700;color:#7a4e10;">${dateText}</div>
      <div style="display:flex;gap:14px;font-size:13px;font-weight:600;color:var(--uw2-ink);">
        <span>声望 <b>${fame}</b></span>
        <span>金块 <b style="color:#8a5d17;">${bars}</b></span>
      </div>
      <div style="font-size:13px;font-weight:600;color:var(--uw2-ink);">金币 <b style="color:#8a5d17;">${gold}</b></div>
    `;
    tlEl.append(img, info);
  }

  // 2. 右上：港情（含商業/工業投資額）+ 港內建築一鍵直達  或  海上氣象
  if (!atSea) {
    const P = scene.port;
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
        <div style="display:flex;flex-direction:column;gap:4px;min-width:268px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;">
            <span style="font-size:17px;font-weight:700;color:var(--uw2-ink);">${portName}</span>
            <span style="font-size:12px;font-weight:600;color:#7a4e10;">${regionName}</span>
          </div>
          ${E ? `
          <div style="display:flex;justify-content:space-between;font-size:12.5px;color:var(--uw2-ink);">
            <span>商业 <b>${com}</b> <small style="color:#7a4e10;">(投资 ${comInv})</small></span>
            <span>物价 <b style="color:#8a5d17;">${avgPrice}%</b></span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:12.5px;color:var(--uw2-ink);">
            <span>工业 <b>${ind}</b> <small style="color:#7a4e10;">(投资 ${indInv})</small></span>
          </div>` : ""}
        </div>
      `;
    }

    // 港內建築一鍵直達（只在允許港內移動時顯示）
    if (PortMove.enabled(c) && scene.door) {
      const items: { k: number; open: boolean; ok: boolean }[] = [];
      for (let k = 0; k < 12; k++) {
        if (!PortMove.present(scene, k)) continue;
        items.push({ k, open: !!scene.isOpen?.(k), ok: PortMove.reachable(scene, k) });
      }
      const pmKey = `${P}|${rt.time}|${scene.hx},${scene.hy},${scene.vx},${scene.vy}|` + items.map(x => `${x.k}:${x.open ? 1 : 0}${x.ok ? 1 : 0}`).join(",");
      pmEl.style.display = items.length ? "grid" : "none";
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
    pmEl.style.display = "none";
    const a = st.u8(DS.PORT_FLAGS);
    const b = st.u8(DS.WIND_CUR);
    const windDir = (a & 0x38) >> 3, windStr = a & 7;
    const curDir = (b & 0x38) >> 3, curStr = b & 7;
    const spd = (scene.speed + 1) >> 1;
    const days = st.u8(DS.DAYS_AT_SEA);
    const trKey = `S|${windDir}|${windStr}|${curDir}|${curStr}|${spd}|${days}`;
    if (trKey !== lastTrKey) {
      lastTrKey = trKey;
      trEl.innerHTML = `
        <div style="display:flex;gap:16px;align-items:center;font-size:13px;color:var(--uw2-ink);min-width:250px;justify-content:space-between;">
          <div><div style="font-size:11px;color:var(--uw2-ink-muted);">风向</div><b>${windStr ? `${DIR_LABELS[windDir]} ${windStr}` : "无风"}</b></div>
          <div><div style="font-size:11px;color:var(--uw2-ink-muted);">海流</div><b>${curStr ? `${DIR_LABELS[curDir]} ${curStr}` : "平静"}</b></div>
          <div><div style="font-size:11px;color:var(--uw2-ink-muted);">航速 / 天数</div><b style="color:#8a5d17;">${spd}kt · ${days}天</b></div>
        </div>
      `;
    }
  }

  // 3. 左下：羅盤
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

/** 現代羊皮紙「新建遊戲 — 選擇主角 + 可選改名」一體化介面 */
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
      closeLabel: "×",
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
