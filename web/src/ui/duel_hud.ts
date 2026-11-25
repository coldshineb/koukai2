// ui/duel_hud.ts — 16:9 现代羊皮纸单挑 (一骑打) HUD + 缩放动画舞台 + 底部招式栏
import { hasDom, getPersonPortraitSrc } from "./modals.ts";
import { hideDomWorldHud } from "./hud.ts";
import { hideDomBattleHud } from "./battle_hud.ts";
import { decodeCleanCstr, toSimp } from "./text_util.ts";
import { GameConst } from "../model/flags.ts";
import { personByAddr, personRawBytes } from "../model/world_helpers.ts";

let duelRoot: HTMLElement | null = null;
let topBar: HTMLElement | null = null;
let botBar: HTMLElement | null = null;
let lastTopKey = "";

function ensureDuelRoot(): HTMLElement | null {
  if (!hasDom()) return null;
  const host = document.getElementById("uw2-overlay");
  if (!host) return null;
  if (duelRoot && duelRoot.parentElement === host) return duelRoot;

  duelRoot = document.createElement("div");
  duelRoot.className = "uw2-duel-hud";

  topBar = document.createElement("div");
  topBar.className = "uw2-card uw2-duel-top";

  botBar = document.createElement("div");
  botBar.className = "uw2-card uw2-duel-bot";
  botBar.style.display = "none";

  duelRoot.append(topBar, botBar);
  host.appendChild(duelRoot);
  return duelRoot;
}

export function hideDomDuelHud() {
  if (duelRoot) duelRoot.style.display = "none";
  if (botBar) { botBar.style.display = "none"; botBar.innerHTML = ""; }
  lastTopKey = "";
}

export function syncDomDuelHud(duel: any) {
  hideDomWorldHud();
  hideDomBattleHud();
  const root = ensureDuelRoot();
  if (!root || !topBar) return;
  root.style.display = "flex";

  const m = duel.st.model, codec = duel.c.codec, art = duel.c.art, h = duel.h;
  const dec = (bts: Uint8Array) => toSimp(decodeCleanCstr(codec, bts));
  const heroAddr = h === 0 ? duel.u16(0x9d44) : duel.u16(0x9d46);
  const enemyAddr = h === 0 ? duel.u16(0x9d46) : duel.u16(0x9d44);
  if (!heroAddr || !enemyAddr) return;

  const heroP = personByAddr(m, heroAddr);
  const enemyP = personByAddr(m, enemyAddr);
  const fullName = (p: ReturnType<typeof personByAddr>) => {
    const g = dec(p.givenNameBytes), f = dec(p.familyNameBytes);
    return f ? `${g}·${f}` : g;
  };
  const itemText = (addr: number) => {
    const n = duel.u8(addr);
    return n === GameConst.EMPTY_SLOT ? "无" : dec(duel.itemName(n));
  };

  const k = 7 * h;
  const enemyName = fullName(enemyP);
  const heroName = fullName(heroP);
  const enemyWep = itemText(0xa025 - k), enemyArm = itemText(0xa026 - k);
  const heroWep = itemText(0xa01e + k), heroArm = itemText(0xa01f + k);
  const v = duel.u8(0x9c2a);
  const enemyHp = h === 0 ? 200 - v : v;
  const heroHp = h === 0 ? v : 200 - v;

  const key = `${enemyName}|${heroName}|${enemyHp}|${heroHp}|${enemyWep}|${heroWep}`;
  if (key === lastTopKey) return;
  lastTopKey = key;

  const enemyPct = Math.max(0, Math.min(100, Math.round((enemyHp * 100) / 200)));
  const heroPct = Math.max(0, Math.min(100, Math.round((heroHp * 100) / 200)));

  topBar.innerHTML =
    `<div class="uw2-duel-fighter">` +
      `<div class="uw2-duel-port" data-side="enemy"></div>` +
      `<div class="uw2-duel-info">` +
        `<div class="uw2-duel-name">${enemyName}</div>` +
        `<div class="uw2-duel-eq">武器：${enemyWep} · 防具：${enemyArm}</div>` +
        `<div class="uw2-bar-track"><div class="uw2-bar-fill red" style="width:${enemyPct}%"></div></div>` +
      `</div>` +
      `<div class="uw2-duel-hp">${enemyHp}</div>` +
    `</div>` +
    `<div class="uw2-duel-vs">单挑</div>` +
    `<div class="uw2-duel-fighter right">` +
      `<div class="uw2-duel-hp">${heroHp}</div>` +
      `<div class="uw2-duel-info">` +
        `<div class="uw2-duel-name">${heroName}</div>` +
        `<div class="uw2-duel-eq">武器：${heroWep} · 防具：${heroArm}</div>` +
        `<div class="uw2-bar-track"><div class="uw2-bar-fill green" style="width:${heroPct}%"></div></div>` +
      `</div>` +
      `<div class="uw2-duel-port" data-side="hero"></div>` +
    `</div>`;

  const eSlot = topBar.querySelector('[data-side="enemy"]');
  const hSlot = topBar.querySelector('[data-side="hero"]');
  void getPersonPortraitSrc(art, personRawBytes(enemyP)).then(src => {
    if (src && eSlot && eSlot.isConnected) eSlot.innerHTML = `<img src="${src}" class="uw2-portrait-img" style="width:52px;height:64px;" />`;
  });
  void getPersonPortraitSrc(art, personRawBytes(heroP)).then(src => {
    if (src && hSlot && hSlot.isConnected) hSlot.innerHTML = `<img src="${src}" class="uw2-portrait-img" style="width:52px;height:64px;" />`;
  });
}

export function runDomDuelMove(round: number, isAttack: boolean, labels: string[]): Promise<number> {
  const root = ensureDuelRoot();
  if (!root || !botBar) return Promise.resolve(0);

  return new Promise(resolve => {
    let settled = false;
    let selected = 0;
    const done = (idx: number) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("keydown", onKey, true);
      if (botBar) { botBar.style.display = "none"; botBar.innerHTML = ""; }
      resolve(idx);
    };

    botBar!.style.display = "flex";
    botBar!.innerHTML = "";

    const title = document.createElement("div");
    title.className = "uw2-duel-prompt";
    title.textContent = `第 ${round} 回合 · ${isAttack ? "选择攻击招式" : "选择防守招式"}`;

    const row = document.createElement("div");
    row.className = "uw2-duel-moves";
    const btns: HTMLButtonElement[] = [];

    labels.forEach((raw, i) => {
      const btn = document.createElement("button");
      btn.className = `uw2-battle-cmd-btn ${i === selected ? "selected" : ""}`;
      btn.style.padding = "10px 26px";
      btn.textContent = toSimp(raw);
      btn.addEventListener("mouseenter", () => { selected = i; sync(); });
      btn.addEventListener("click", () => done(i));
      btns.push(btn);
      row.appendChild(btn);
    });

    const sync = () => btns.forEach((b, i) => b.classList.toggle("selected", i === selected));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") { e.preventDefault(); selected = (selected + labels.length - 1) % labels.length; sync(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); selected = (selected + 1) % labels.length; sync(); }
      else if (e.key === "1" || e.key === "2" || e.key === "3") {
        const idx = Number(e.key) - 1;
        if (idx < labels.length) { e.preventDefault(); done(idx); }
      } else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); done(selected); }
    };
    window.addEventListener("keydown", onKey, true);

    botBar!.append(title, row);
  });
}

export function renderWideDuel(ctx: CanvasRenderingContext2D, _scr: any, duel: any) {
  ctx.fillStyle = "#081222";
  ctx.fillRect(0, 0, 1280, 720);

  // 原版单挑动画舞台逻辑尺寸为 400 × 120 (cols 0x0f..0x41, rows 0xb0..0x128)，以 2.4× 居中呈现于 960×288
  const dx = 160, dy = 190, dw = 960, dh = 288, scale = 2.4;
  const art = duel.c?.art;
  const dm = art?.manifest?.duel;
  const getImg = (entry: any) => (entry ? art.getImage(`${art.baseUrl}/${entry.path}`) : null);

  const deckEntry = duel.isAtSea?.() ? dm?.decks?.sea : dm?.decks?.port;
  const deckImg = getImg(deckEntry);
  const bgEntry = art?.backgroundUrl?.("duel_bg");
  const bgImg = bgEntry ? art.getImage(bgEntry) : null;

  ctx.save();
  ctx.beginPath();
  ctx.rect(dx, dy, dw, dh);
  ctx.clip();

  if (bgImg) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bgImg, 120, 176, 400, 120, dx, dy, dw, dh);
  } else {
    ctx.fillStyle = "#101b2d";
    ctx.fillRect(dx, dy, dw, dh);
  }

  ctx.imageSmoothingEnabled = false;
  const vs = duel.viewState;

  const drawFighter = (sideIdx: number, winColOffset: number, actionVal: number, offDx: number, offDy: number) => {
    const fighterKey = sideIdx === 0 ? `iap${(duel.m.globals.hero & 7) + 1}` : "iae1";
    const sheet = dm?.fighters?.[fighterKey];
    const sheetImg = getImg(sheet);
    if (!sheet || !sheetImg) return;
    const isWalk = actionVal < 6;
    const baseAction = isWalk ? 0 : (duel.curAction?.[sideIdx] ?? 0);
    const frameIdx = isWalk ? actionVal : actionVal - 6;
    const wepKind = duel.weaponKind?.(sideIdx) ?? 0;
    for (const layerEntry of [baseAction * 5, baseAction * 5 + wepKind + 1]) {
      const f = sheet.entries?.[layerEntry]?.[frameIdx];
      if (!f) continue;
      const fx = dx + (winColOffset + f.x + offDx) * 8 * scale;
      const fy = dy + (f.y + offDy) * scale;
      ctx.drawImage(sheetImg, f.sx, f.sy, f.sw, f.sh, fx, fy, f.sw * scale, f.sh * scale);
    }
  };

  const drawRail = (pos: number, winColOffset: number) => {
    if (!duel.isAtSea?.()) return;
    const p = pos + 7;
    if (p <= 8) {
      const railL = getImg(dm?.rails?.left);
      const di = 9 - p;
      if (railL && di > 0) {
        const wPx = Math.min(9, di) * 8;
        ctx.drawImage(railL, 72 - wPx, 0, wPx, 120, dx + winColOffset * 8 * scale, dy, wPx * scale, dh);
      }
    }
    if (p >= 16) {
      const railR = getImg(dm?.rails?.right);
      const di = p - 15;
      if (railR && di > 0) {
        const wPx = Math.min(9, di) * 8;
        const xOff = (winColOffset + 24) * 8 - wPx;
        ctx.drawImage(railR, 0, 0, wPx, 120, dx + xOff * scale, dy, wPx * scale, dh);
      }
    }
  };

  if (vs && deckImg) {
    if (vs.mode === "apart") {
      // 入场阶段：右侧 (di) 12 栏、左侧 (si) 12 栏分开呈现
      const rCol = vs.di + 0x23 - 0x0f;
      const lCol = vs.si + 0x17 - 0x0f;
      ctx.drawImage(deckImg, (vs.di + 0x13) * 8, 0, 96, 120, dx + rCol * 8 * scale, dy, 96 * scale, dh);
      ctx.drawImage(deckImg, (vs.si + 7) * 8, 0, 96, 120, dx + lCol * 8 * scale, dy, 96 * scale, dh);
      const winCol = vs.si + 8;
      drawFighter(0, winCol, vs.a, vs.dxA, vs.dyA);
      drawFighter(1, winCol, vs.b, vs.dxB, vs.dyB);
      drawRail(vs.di, vs.di + 8);
      drawRail(vs.si, vs.si + 8);
    } else {
      const winCol = vs.L + 8;
      ctx.drawImage(deckImg, (vs.L + 7) * 8, 0, 192, 120, dx + winCol * 8 * scale, dy, 192 * scale, dh);
      drawFighter(0, winCol, vs.a, vs.dxA, vs.dyA);
      drawFighter(1, winCol, vs.b, vs.dxB, vs.dyB);
      drawRail(vs.L, winCol);
    }
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "#c8a258";
  ctx.lineWidth = 2.5;
  ctx.strokeRect(dx - 2, dy - 2, dw + 4, dh + 4);
  ctx.restore();

  if (hasDom()) syncDomDuelHud(duel);
}
