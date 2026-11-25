// ui/info_hub.ts — F1「情报中心」一体化多标签页工作台 +「随身物」一体化面板
// 与「读取进度 (save_modal.ts)」1:1 同套暖羊皮纸视觉，彻底消灭多层嵌套菜单，并完整呈现所有原版插图
// （发现物插图、道具插图、高清船图、船首像、具名与 5 层拼合人物头像）。100% 原版游戏文本。
import { DiscoveryFlag, GameConst, ItemFlag, ShipSlotFlag, SkillFlag } from "../model/flags.ts";
import {
  WorldConst,
  fleetShipSlot,
  getTradeLogEntry,
  getWorkState,
  heroFleet,
  heroOrDockSlot,
  isWorldCellExplored,
  personRawBytes,
} from "../model/world_helpers.ts";
import { ListSelect } from "./dos/listsel.js";
import { captureConsoleText, decodeCleanCstr, toSimp, UI_FONT } from "./text_util.ts";
import { createDomModal, getPersonPortraitSrc, preserveScroll } from "./modals.ts";
import { UI_STR } from "./strings.ts";

const s16 = (v: number) => (v << 16) >> 16;
const umin = (a: number, b: number) => ((a & 0xffff) > (b & 0xffff) ? b & 0xffff : a & 0xffff);

/** 将世界航海图内嵌绘制到任意 DOM 容器中（支持悬停港名 + 点击放大查看 72×72 局部真实海域地形图与漫游） */
export function mountDomWorldChart(container: HTMLElement, c: any, scene?: any) {
  const st = c.state, art = c.art;
  const dec = (bts: Uint8Array) => decodeCleanCstr(c.codec, bts);

  const cw = 9, ch = 9; // 90×45 格 = 810×405
  const mapW = 90 * cw, mapH = 45 * ch;
  const wrap = document.createElement("div");
  wrap.className = "uw2-action-box";
  wrap.style.cssText = "align-items:center;gap:10px;";

  const topBar = document.createElement("div");
  topBar.style.cssText = "width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:30px;";

  const stage = document.createElement("div");
  stage.style.cssText = `position:relative;width:${mapW}px;max-width:100%;aspect-ratio:${mapW}/${mapH};border-radius:8px;overflow:hidden;border:1px solid var(--uw2-gold);background:#0a1b32;cursor:crosshair;`;

  const cv = document.createElement("canvas");
  cv.width = mapW;
  cv.height = mapH;
  cv.style.cssText = "width:100%;height:100%;display:block;";
  stage.appendChild(cv);

  const tip = document.createElement("div");
  tip.style.cssText = "position:absolute;pointer-events:none;display:none;padding:4px 10px;border-radius:6px;background:rgba(12,24,42,0.94);color:#fff4d6;border:1px solid #d4af5a;font-size:13px;font-weight:700;white-space:nowrap;z-index:2;";
  stage.appendChild(tip);

  const legend = document.createElement("div");
  legend.style.cssText = "display:flex;gap:18px;font-size:13px;color:var(--uw2-ink-muted);align-items:center;flex-wrap:wrap;justify-content:center;";

  wrap.append(topBar, stage, legend);
  container.appendChild(wrap);

  const fl = heroFleet(st.model);
  const fx = fl.x, fy = fl.y;
  const toX = (wx: number) => (((wx / 24) + 30) % 90) * cw;
  const toY = (wy: number) => (wy / 24) * ch;

  const ports: { wx: number; wy: number; x: number; y: number; name: string; supply: boolean }[] = [];
  for (let p = 0; p < WorldConst.TOTAL_PORTS; p++) {
    const pv = st.model.port(p);
    if (!(pv.region & WorldConst.PORT_DISCOVERED_BIT)) continue;
    const wx = pv.x, wy = pv.y;
    ports.push({ wx, wy, x: toX(wx), y: toY(wy), name: dec(pv.nameBytes), supply: p >= WorldConst.NORMAL_PORTS });
  }

  const mapEntry = art?.graphEntry?.("GRAPH.DAT", 0x19);
  const mapUrl = mapEntry ? `${art.baseUrl}/${mapEntry.path}` : null;
  const seaMeta = art?.sheet?.("seachip");
  const wm = scene?.wm ?? null;
  const localBuf = new Uint8Array(0x2400);

  let mode: "world" | "local" = "world";
  let hoverCell: { wcol: number; row: number } | null = null;
  // 局部放大模式：左上海域格 (0..89, 0..42)
  let zoomCol = 0;
  let zoomRow = 0;

  const isCellSeen = (wcol: number, row: number) => isWorldCellExplored(st.model, wcol, row);

  const renderTopAndLegend = () => {
    topBar.innerHTML = "";
    if (mode === "world") {
      topBar.style.display = "none";
      legend.innerHTML = `<span><b style="color:#ff4d4d;">●</b> 舰队</span><span><b style="color:#d49d2a;">■</b> 港口</span><span><b style="color:#3898d8;">■</b> 补给港</span>`;
    } else {
      topBar.style.display = "flex";
      const backBtn = document.createElement("button");
      backBtn.className = "uw2-btn uw2-btn-primary";
      backBtn.style.padding = "5px 14px";
      backBtn.textContent = "← 返回";
      backBtn.addEventListener("click", () => { mode = "world"; tip.style.display = "none"; renderAll(); });

      const nav = document.createElement("div");
      nav.className = "uw2-step-row";
      const pan = (dc: number, dr: number) => {
        zoomCol = (zoomCol + dc + 90) % 90;
        zoomRow = Math.max(0, Math.min(42, zoomRow + dr));
        renderAll();
      };
      for (const [lb, dc, dr] of [["←", -1, 0], ["↑", 0, -1], ["↓", 0, 1], ["→", 1, 0]] as const) {
        const b = document.createElement("button");
        b.className = "uw2-step-btn";
        b.textContent = lb;
        b.addEventListener("click", () => pan(dc, dr));
        nav.appendChild(b);
      }
      topBar.append(backBtn, nav);
      legend.innerHTML = "";
    }
  };

  const drawWorld = () => {
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    cv.width = mapW;
    cv.height = mapH;
    stage.style.width = `${mapW}px`;
    stage.style.aspectRatio = `${mapW}/${mapH}`;

    ctx.fillStyle = "#0a1b32";
    ctx.fillRect(0, 0, mapW, mapH);

    const mapImg = mapUrl ? art?.getImage?.(mapUrl) : null;
    if (mapImg) {
      const sx = (50 / 640) * mapImg.naturalWidth;
      const sy = (50 / 400) * mapImg.naturalHeight;
      const sw = (540 / 640) * mapImg.naturalWidth;
      const sh = (270 / 400) * mapImg.naturalHeight;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(mapImg, sx, sy, sw, sh, 0, 0, mapW, mapH);
    }

    for (let row = 0; row < 45; row++) {
      for (let col = 0; col < 90; col++) {
        const wcol = (col - 30 + 90) % 90;
        if (isCellSeen(wcol, row)) continue;
        ctx.fillStyle = "rgba(8, 18, 34, 0.84)";
        ctx.fillRect(col * cw, row * ch, cw, ch);
      }
    }

    ctx.strokeStyle = "rgba(214, 174, 96, 0.14)";
    ctx.lineWidth = 1;
    for (let col = 0; col <= 90; col += 15) {
      ctx.beginPath(); ctx.moveTo(col * cw, 0); ctx.lineTo(col * cw, mapH); ctx.stroke();
    }
    for (let row = 0; row <= 45; row += 9) {
      ctx.beginPath(); ctx.moveTo(0, row * ch); ctx.lineTo(mapW, row * ch); ctx.stroke();
    }

    // 悬停 3×3 放大预览框
    if (hoverCell && wm) {
      const sc = ((hoverCell.wcol + 30) % 90) - 1;
      const sr = Math.max(0, Math.min(42, hoverCell.row - 1));
      ctx.strokeStyle = "rgba(255, 224, 130, 0.9)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sc * cw, sr * ch, cw * 3, ch * 3);
    }

    for (const pt of ports) {
      ctx.fillStyle = pt.supply ? "#80d4ff" : "#f2d89b";
      ctx.fillRect(pt.x - 2, pt.y - 2, 4, 4);
    }

    const hx = toX(fx), hy = toY(fy);
    ctx.fillStyle = "#ff4d4d";
    ctx.beginPath();
    ctx.arc(hx, hy, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.8;
    ctx.stroke();
  };

  const drawLocal = () => {
    const ctx = cv.getContext("2d");
    if (!ctx || !wm) return;
    const tilePx = 6; // 72×6 = 432×432 清晰真实海域图
    const sz = 72 * tilePx;
    cv.width = sz;
    cv.height = sz;
    stage.style.width = `${sz}px`;
    stage.style.aspectRatio = "1/1";

    ctx.fillStyle = "#08182e";
    ctx.fillRect(0, 0, sz, sz);

    const sheetImg = seaMeta ? art.getImage(art.sheetUrl("seachip")) : null;
    const scaleX = sheetImg && seaMeta ? (sheetImg.naturalWidth || seaMeta.w) / seaMeta.w : 1;
    const scaleY = sheetImg && seaMeta ? (sheetImg.naturalHeight || seaMeta.h) / seaMeta.h : 1;
    ctx.imageSmoothingEnabled = false;

    // 逐海域格 (3×3) 解码，支持跨大区 (item 0/1/2) 与全球环绕
    const decodedItems = new Map<string, Uint8Array>();
    for (let dr = 0; dr < 3; dr++) {
      const rCell = zoomRow + dr;
      if (rCell < 0 || rCell >= 45) continue;
      for (let dc = 0; dc < 3; dc++) {
        const wcol = (zoomCol + dc + 90) % 90;
        if (!isCellSeen(wcol, rCell)) {
          ctx.fillStyle = "#091628";
          ctx.fillRect(dc * 24 * tilePx, dr * 24 * tilePx, 24 * tilePx, 24 * tilePx);
          continue;
        }
        const item = Math.trunc(wcol / 30);
        const colInItem = wcol % 30;
        // 取包含 (colInItem, rCell) 的合法 3×3 解码起点
        const c0 = Math.max(0, Math.min(27, colInItem));
        const r0 = Math.max(0, Math.min(42, rCell));
        const key = `${item}_${r0}_${c0}`;
        let buf = decodedItems.get(key);
        if (!buf) {
          buf = new Uint8Array(0x2400);
          wm.decode(st, item, r0 * 30 + c0, buf);
          decodedItems.set(key, buf);
        }
        const offC = (colInItem - c0) * 24;
        const offR = (rCell - r0) * 24;
        if (sheetImg && seaMeta) {
          for (let y = 0; y < 24; y++) {
            const rowOff = (offR + y) * 96 + offC;
            for (let x = 0; x < 24; x++) {
              const t = buf[rowOff + x];
              if (t < 0 || t >= seaMeta.count) continue;
              const sx = (t % seaMeta.cols) * seaMeta.tileW * scaleX;
              const sy = Math.floor(t / seaMeta.cols) * seaMeta.tileH * scaleY;
              ctx.drawImage(
                sheetImg,
                sx, sy, seaMeta.tileW * scaleX, seaMeta.tileH * scaleY,
                (dc * 24 + x) * tilePx, (dr * 24 + y) * tilePx, tilePx, tilePx,
              );
            }
          }
        }
      }
    }

    // 标注区域内的已知港口与名称
    const baseWX = zoomCol * 24;
    const baseWY = zoomRow * 24;
    ctx.font = `700 12px ${UI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const pt of ports) {
      let dx = pt.wx - baseWX;
      if (dx < -1080) dx += 2160;
      else if (dx > 1080) dx -= 2160;
      const dy = pt.wy - baseWY;
      if (dx < 0 || dx >= 72 || dy < 0 || dy >= 72) continue;
      const px = dx * tilePx + tilePx / 2;
      const py = dy * tilePx + tilePx / 2;
      ctx.fillStyle = pt.supply ? "#80d4ff" : "#ffe082";
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
      const tw = ctx.measureText(pt.name).width + 10;
      const lx = Math.min(sz - tw / 2 - 4, Math.max(tw / 2 + 4, px));
      const ly = Math.max(12, py - 14);
      ctx.fillStyle = "rgba(8, 18, 34, 0.88)";
      ctx.fillRect(lx - tw / 2, ly - 9, tw, 18);
      ctx.strokeStyle = "rgba(232, 194, 114, 0.9)";
      ctx.lineWidth = 1;
      ctx.strokeRect(lx - tw / 2, ly - 9, tw, 18);
      ctx.fillStyle = "#fff4d6";
      ctx.fillText(pt.name, lx, ly + 1);
    }

    // 若主角舰队在区域内则绘制红点
    let hdx = fx - baseWX;
    if (hdx < -1080) hdx += 2160;
    else if (hdx > 1080) hdx -= 2160;
    const hdy = fy - baseWY;
    if (hdx >= 0 && hdx < 72 && hdy >= 0 && hdy < 72) {
      ctx.fillStyle = "#ff4d4d";
      ctx.beginPath();
      ctx.arc(hdx * tilePx + tilePx, hdy * tilePx + tilePx, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  };

  const renderAll = () => {
    renderTopAndLegend();
    if (mode === "world") drawWorld();
    else drawLocal();
  };

  renderAll();
  if (mapUrl && !art?.getImage?.(mapUrl)) {
    void art?.loadImage?.(mapUrl).then(() => { if (mode === "world") drawWorld(); }).catch(() => {});
  }
  if (seaMeta && !art?.getImage?.(art.sheetUrl("seachip"))) {
    void art?.loadImage?.(art.sheetUrl("seachip")).then(() => { if (mode === "local") drawLocal(); }).catch(() => {});
  }

  cv.addEventListener("mousemove", e => {
    if (mode !== "world") return;
    const r = cv.getBoundingClientRect();
    const mx = ((e.clientX - r.left) / (r.width || 1)) * mapW;
    const my = ((e.clientY - r.top) / (r.height || 1)) * mapH;
    const col = Math.max(0, Math.min(89, Math.floor(mx / cw)));
    const row = Math.max(0, Math.min(44, Math.floor(my / ch)));
    const wcol = (col - 30 + 90) % 90;
    hoverCell = { wcol, row };
    drawWorld();

    let best: typeof ports[0] | null = null;
    let bestD = 12;
    for (const pt of ports) {
      const d = Math.hypot(mx - pt.x, my - pt.y);
      if (d < bestD) { bestD = d; best = pt; }
    }
    if (best) {
      tip.textContent = best.name;
      tip.style.display = "block";
      tip.style.left = `${Math.min(82, Math.max(2, (best.x / mapW) * 100))}%`;
      tip.style.top = `${Math.max(2, (best.y / mapH) * 100 - 9)}%`;
    } else {
      tip.style.display = "none";
    }
  });
  cv.addEventListener("mouseleave", () => {
    if (mode !== "world") return;
    hoverCell = null;
    tip.style.display = "none";
    drawWorld();
  });
  cv.addEventListener("click", e => {
    if (mode !== "world" || !wm) return;
    const r = cv.getBoundingClientRect();
    const mx = ((e.clientX - r.left) / (r.width || 1)) * mapW;
    const my = ((e.clientY - r.top) / (r.height || 1)) * mapH;
    const col = Math.max(0, Math.min(89, Math.floor(mx / cw)));
    const row = Math.max(0, Math.min(44, Math.floor(my / ch)));
    const wcol = (col - 30 + 90) % 90;
    // 若点击区域（含周围 3×3）任一格已探索即可放大查看
    let anySeen = false;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (isCellSeen(wcol + dc, row + dr)) anySeen = true;
    if (!anySeen) return;
    zoomCol = (wcol - 1 + 90) % 90;
    zoomRow = Math.max(0, Math.min(42, row - 1));
    mode = "local";
    tip.style.display = "none";
    renderAll();
  });
  // 局部放大状态下右键返回世界航海图主界面（不直接关闭整个情报窗口）
  const onLocalRightClick = (e: MouseEvent) => {
    if (!container.isConnected) {
      window.removeEventListener("contextmenu", onLocalRightClick, true);
      return;
    }
    if (mode !== "local") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    mode = "world";
    renderAll();
  };
  window.addEventListener("contextmenu", onLocalRightClick, true);
  void localBuf;
}

/** 将完整海港地图 (全港 96×96 格) 内嵌绘制到任意 DOM 容器中（点击不会关闭） */
export function mountDomPortMap(container: HTMLElement, c: any, p: any) {
  const st = c.state, art = c.art;
  const dec = (bts: Uint8Array) => decodeCleanCstr(c.codec, bts);
  const sheetName = p.chipSetName || "portchip_0";
  const meta = art?.sheet?.(sheetName);
  const lab = c.menuItems(0x3a);

  const X = p.hx + p.vx, Y = p.hy + p.vy;
  const tilePx = 5;
  const mapPx = 96 * tilePx; // 全港 96×96 格 = 480×480

  const wrap = document.createElement("div");
  wrap.className = "uw2-action-box";
  wrap.style.cssText = "align-items:center;gap:10px;";

  const header = document.createElement("div");
  header.className = "uw2-pane-title";
  header.textContent = dec(st.model.port(p.port).nameBytes);

  const cv = document.createElement("canvas");
  cv.width = mapPx;
  cv.height = mapPx;
  cv.style.cssText = `width:${mapPx}px;max-width:100%;height:auto;border-radius:8px;border:1px solid var(--uw2-gold);background:#0c1a2e;display:block;`;

  wrap.append(header, cv);
  container.appendChild(wrap);

  const draw = () => {
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#0c1a2e";
    ctx.fillRect(0, 0, mapPx, mapPx);
    const sheetImg = meta ? art.getImage(art.sheetUrl(sheetName)) : null;
    if (meta && sheetImg) {
      ctx.imageSmoothingEnabled = false;
      const scaleX = (sheetImg.naturalWidth || meta.w) / meta.w;
      const scaleY = (sheetImg.naturalHeight || meta.h) / meta.h;
      const M = p.map;
      for (let r = 0; r < 96; r++) {
        const rowOff = r * 96;
        for (let col = 0; col < 96; col++) {
          const t = M[rowOff + col];
          if (t < 0 || t >= meta.count) continue;
          const sx = (t % meta.cols) * meta.tileW * scaleX;
          const sy = Math.floor(t / meta.cols) * meta.tileH * scaleY;
          ctx.drawImage(sheetImg, sx, sy, meta.tileW * scaleX, meta.tileH * scaleY, col * tilePx, r * tilePx, tilePx, tilePx);
        }
      }
    }

    const hx = X * tilePx + tilePx;
    const hy = Y * tilePx + tilePx;
    ctx.fillStyle = "#ff4d4d";
    ctx.beginPath();
    ctx.arc(hx, hy, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = `700 11px ${UI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let k = 0; k < 12; k++) {
      if (k === 7) continue;
      const dx = p.door[k * 2], dy = p.door[k * 2 + 1];
      if ((!dx && !dy) || dx >= 96 || dy >= 96) continue;
      const text = dec(lab[k]);
      if (!text) continue;
      const tw = ctx.measureText(text).width + 10;
      const lx = Math.min(mapPx - tw / 2 - 3, Math.max(tw / 2 + 3, dx * tilePx + tilePx / 2));
      const ly = Math.max(11, dy * tilePx - 8);
      ctx.fillStyle = "rgba(8, 18, 34, 0.88)";
      ctx.fillRect(lx - tw / 2, ly - 8, tw, 16);
      ctx.strokeStyle = "rgba(232, 194, 114, 0.9)";
      ctx.lineWidth = 1;
      ctx.strokeRect(lx - tw / 2, ly - 8, tw, 16);
      ctx.fillStyle = "#fff4d6";
      ctx.fillText(text, lx, ly + 1);
    }
  };

  draw();
  if (meta && !art.getImage(art.sheetUrl(sheetName))) {
    void art.loadImage(art.sheetUrl(sheetName)).then(() => draw()).catch(() => {});
  }
}

export function runDomWorldChartModal(c: any, title: string, scene?: any): Promise<void> {
  return new Promise(resolve => {
    const h = createDomModal({ title, size: "wide", cancelable: true, closeLabel: "关闭", onCancel: () => resolve() });
    mountDomWorldChart(h.body, c, scene);
  });
}

export function runDomPortMapModal(c: any, p: any, title = "海港地图"): Promise<void> {
  return new Promise(resolve => {
    const h = createDomModal({ title, size: "md", cancelable: true, closeLabel: "关闭", onCancel: () => resolve() });
    mountDomPortMap(h.body, c, p);
  });
}

/** F1 情报中心：10 项原版情报全部平铺为一体化标签页，零嵌套菜单 */
export async function runDomInfoHub(cmd: any): Promise<void> {
  const c = cmd.c, m = cmd.st.model, b = cmd.b, p = cmd.p, art = c.art;
  const dec = (bts: Uint8Array) => decodeCleanCstr(c.codec, bts);
  const cap = (fn: () => void) => captureConsoleText(c, fn);
  const tabLabels = [...UI_STR.infoTabs];
  const infoTitle = UI_STR.cmdButtons[0];

  const hasShips = () => b.fleetShips() > 0;
  const hasDisc = () => !!cmd.discList(1);
  const hasWorld = () => !!getWorkState(m).exploreTotal;
  const hasLog = () => getTradeLogEntry(m, 0).dateWord !== 0xffff;
  const inPort = () => m.globals.port !== GameConst.EMPTY_SLOT;

  const isDisabled = (idx: number): boolean => {
    if (idx === 0 || idx === 1 || idx === 4 || idx === 5) return !hasShips();
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

  return new Promise(resolve => {
    const h = createDomModal({
      title: infoTitle,
      size: "wide",
      cancelable: true,
      closeLabel: "关闭",
      onCancel: () => resolve(),
    });

    const toolbar = document.createElement("div");
    toolbar.className = "uw2-modal-toolbar";
    h.modal.insertBefore(toolbar, h.body);

    const render = (keepScroll = true) => {
      if (isDisabled(activeTab)) activeTab = hasShips() ? 0 : 3;

      toolbar.innerHTML = "";
      tabLabels.forEach((lb, i) => {
        const btn = document.createElement("button");
        btn.className = `uw2-btn uw2-tab-btn ${i === activeTab ? "active" : ""}`;
        btn.disabled = isDisabled(i);
        btn.textContent = lb;
        btn.addEventListener("click", () => {
          activeTab = i;
          render(false);
        });
        toolbar.appendChild(btn);
      });

      preserveScroll(h.body, () => {
        h.body.innerHTML = "";
        if (activeTab === 0) renderFleetTab(h.body);
        else if (activeTab === 1) renderShipTab(h.body);
        else if (activeTab === 2) renderPersonTab(h.body);
        else if (activeTab === 3) renderLordTab(h.body);
        else if (activeTab === 4) renderCargoShipTab(h.body);
        else if (activeTab === 5) renderCargoSummaryTab(h.body);
        else if (activeTab === 6) renderDiscoveryTab(h.body);
        else if (activeTab === 7) mountDomWorldChart(h.body, c, p);
        else if (activeTab === 8) renderLogTab(h.body);
        else if (activeTab === 9) mountDomPortMap(h.body, c, p);
      }, keepScroll);
    };

      // ---- Tab 0: 自舰队情报 ----
      const renderFleetTab = (root: HTMLElement) => {
        const fl = heroFleet(m);
        const admiral = m.person(fl.admiral);
        const T = cmd.T;
        const wind = Math.abs(((m.globals.portFlags & 0x38) >> 3) - fl.dir) & 0xff;
        const WT = T.windSpeed, wbase = wind << 3;
        let best = 10000, slow = fleetShipSlot(fl, 0), sumSail = 0, sumGuns = 0, sumX = 0, minDur = 100;

        const grid = document.createElement("div");
        grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:10px;";

        for (let i = 0; i < GameConst.FLEET_SHIPS; i++) {
          const slot = fleetShipSlot(fl, i);
          if ((slot.flags & ShipSlotFlag.STATE_MASK) !== ShipSlotFlag.ACTIVE) continue;
          const ship = m.ship(slot.ship);
          const t = ship.type, shipType = m.shipType(t);
          const minS = shipType.minCrew, sail = s16(slot.crew);
          sumSail = (sumSail + slot.crew) & 0xffff;
          const cs = m.crewSlot(i);
          const r8 = cs.navRatio;
          const r9 = cs.lookRatio;
          const w = s16(cs.loadTotal);
          const maxw = s16(shipType.capacity), s5 = slot.propulsion;
          const capP = m.person(cs.captain), pc = capP.navLevel, pd = capP.getStats(1);
          sumGuns = (sumGuns + slot.guns) & 0xffff;
          const deck = umin(300, Math.trunc(s16((100 - r9 - r8) * sail) / 100) & 0xffff);
          const k = slot.flags & ShipSlotFlag.CANNON_MASK;
          const g = Math.trunc((umin(slot.guns, deck) * ((2 * T.gunA[k] + T.gunB[k]) & 0xffff)) / 10) & 0xffff;
          sumX = (sumX + 2 * slot.durability + g + deck) & 0xffff;
          const di2 = s16(WT[wbase + t] * s5);
          const q = umin(100, Math.trunc((r9 * sail) / (minS || 1)) & 0xffff);
          const cc = umin(150, (180 - umin(180, Math.trunc(s16(100 * w) / (maxw || 1)) & 0xffff)) & 0xffff);
          const x = Math.trunc(s16(q * di2) / 100) & 0xffff;
          const di3 = Math.trunc(((x * cc) >>> 0) / 100) & 0xffff;
          const v = umin(30, (Math.trunc(s16(di3 * pc) / 10) + di3) & 0xffff);
          const sp = umin(40, Math.trunc(s16(v * pd) / 75) & 0xffff);
          if (sp < best) { best = sp; slow = slot; }
          if (slot.durability < minDur) minDur = slot.durability;

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
          nm.textContent = dec(ship.nameBytes);
          const sub = document.createElement("div");
          sub.className = "uw2-slot-sub";
          sub.textContent = `耐久 ${slot.durability}/${slot.maxDurability} · 水手 ${slot.crew} · 炮 ${slot.guns}`;
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
        void getPersonPortraitSrc(art, personRawBytes(admiral)).then(src => { if (src) pImg.src = src; });
        summary.appendChild(pImg);

        const col1 = document.createElement("div");
        col1.style.cssText = "flex:1;display:flex;flex-direction:column;gap:4px;font-size:14px;font-weight:600;";
        for (const l of [
          cap(() => c.message(0x397, admiral.givenNameBytes)),
          cap(() => c.message(0x398, admiral.navLevel)),
          cap(() => c.message(0x399, admiral.battleLevel)),
        ]) {
          const d = document.createElement("div");
          d.textContent = l;
          col1.appendChild(d);
        }
        const col2 = document.createElement("div");
        col2.style.cssText = "flex:1.4;display:flex;flex-direction:column;gap:4px;font-size:14px;font-weight:600;";
        for (const l of [
          cap(() => c.message(0x39a, slow.turn, sumSail)),
          cap(() => c.message(0x39b, slow.propulsion, sumGuns)),
          cap(() => c.message(0x39c, minDur, sumX)),
        ]) {
          const d = document.createElement("div");
          d.textContent = l;
          col2.appendChild(d);
        }
        summary.append(col1, col2);
        root.append(grid, summary);
      };

      // ---- Tab 1: 舰船情报 ----
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
          const ship = m.ship(heroOrDockSlot(m, slot).ship);
          const btn = document.createElement("button");
          btn.className = `uw2-row-card ${i === selShipIdx ? "selected" : ""}`;
          btn.textContent = dec(ship.nameBytes);
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
            const supNames = UI_STR.supplies;
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

      // ---- Tab 2: 人物情报 ----
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
          const pv = m.person(pid);
          const btn = document.createElement("button");
          btn.className = `uw2-row-card ${i === selPersonIdx ? "selected" : ""}`;
          btn.innerHTML = `<span style="font-weight:700;">${dec(pv.givenNameBytes)}</span><span class="uw2-slot-sub">${dec(b.T.crewRoles[pv.role])}</span>`;
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

      // ---- Tab 3: 主公情报 ----
      const renderLordTab = (root: HTMLElement) => {
        const lab = c.menuItems(0x2a), hd = m.heroInfo();
        const money = m.globals.money;
        const heroP = m.heroPerson();

        const split = document.createElement("div");
        split.className = "uw2-split";

        const left = document.createElement("div");
        left.className = "uw2-pane";
        const topCard = document.createElement("div");
        topCard.className = "uw2-action-box";
        topCard.style.cssText = "flex-direction:row;align-items:center;gap:14px;";
        const img = document.createElement("img");
        img.className = "uw2-portrait-img";
        void getPersonPortraitSrc(art, personRawBytes(heroP)).then(src => { if (src) img.src = src; });
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
        const fameVals = [hd.tradeFame, hd.pirateFame, hd.adventureFame];
        for (let i = 0; i < 3; i++) {
          const val = fameVals[i];
          const row = document.createElement("div");
          row.innerHTML = `<div style="font-size:14px;font-weight:600;margin-bottom:4px;">${cap(() => c.message(0x392, lab[i], val))}</div><div class="uw2-bar-track"><div class="uw2-bar-fill" style="width:${Math.min(100, (val / GameConst.MAX_FAME) * 100)}%"></div></div>`;
          fameBox.appendChild(row);
        }
        left.append(topCard, fameBox);

        const right = document.createElement("div");
        right.className = "uw2-action-box";
        for (let i = 0; i < WorldConst.TOTAL_COUNTRIES; i++) {
          const v = hd.getCountryStanding(i), diff = v - 100;
          const row = document.createElement("div");
          row.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;margin-bottom:4px;"><span>${cap(() => c.message(0x393, p.nations[i]))}</span><span style="color:${v >= 100 ? "#247544" : "#b83d3d"};">${diff < 0 ? `-${Math.abs(diff)}` : String(diff)}</span></div><div class="uw2-bar-track"><div class="uw2-bar-fill ${v >= 100 ? "green" : "red"}" style="width:${Math.min(100, (v / 200) * 100)}%"></div></div>`;
          right.appendChild(row);
        }
        split.append(left, right);
        root.appendChild(split);
      };

      // ---- Tab 4: 积载情报 ----
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
          const ship = m.ship(heroOrDockSlot(m, slot).ship);
          const btn = document.createElement("button");
          btn.className = `uw2-row-card ${i === selCargoShipIdx ? "selected" : ""}`;
          btn.textContent = dec(ship.nameBytes);
          btn.addEventListener("click", () => { selCargoShipIdx = i; render(); });
          left.appendChild(btn);
        });

        const right = document.createElement("div");
        right.className = "uw2-action-box";
        if (slots.length) {
          const slot = slots[selCargoShipIdx], cs = m.crewSlot(slot);
          const ship = m.ship(heroOrDockSlot(m, slot).ship);
          const title = document.createElement("div");
          title.className = "uw2-pane-title";
          title.textContent = cap(() => c.message(0x374, ship.nameBytes));
          right.appendChild(title);
          let count = 0;
          for (let k = 0; k < GameConst.CARGO_SLOTS; k++) {
            const g = cs.getCargoGoods(k);
            if (g === GameConst.EMPTY_SLOT) continue;
            count++;
            const card = document.createElement("div");
            card.className = "uw2-slot-card";
            card.textContent = cap(() => c.message(0x395, p.goods[g], cs.getCargoAmts(k)));
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

      // ---- Tab 5: 积载一览表 ----
      const renderCargoSummaryTab = (root: HTMLElement) => {
        const totals = new Map<number, number>();
        for (let i = 0; i < GameConst.FLEET_SHIPS; i++) {
          if ((heroOrDockSlot(m, i).flags & ShipSlotFlag.STATE_MASK) !== ShipSlotFlag.ACTIVE) continue;
          const cs = m.crewSlot(i);
          for (let j = 0; j < GameConst.CARGO_SLOTS; j++) {
            const g = cs.getCargoGoods(j);
            if (g === GameConst.EMPTY_SLOT) continue;
            totals.set(g, ((totals.get(g) ?? 0) + cs.getCargoAmts(j)) & 0xffff);
          }
        }
        const goodsList = Array.from(totals.entries());
        if (selGoodIdx >= goodsList.length) selGoodIdx = Math.max(0, goodsList.length - 1);

        const split = document.createElement("div");
        split.className = "uw2-split narrow-left";
        const left = document.createElement("div");
        left.className = "uw2-list-col";
        if (!goodsList.length) {
          const empty = document.createElement("div");
          empty.className = "uw2-slot-sub";
          empty.style.padding = "12px";
          empty.textContent = "—";
          left.appendChild(empty);
        }
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
          const bestPortName = m.port(cmd.bestPort(g)).nameBytes;
          const hero = m.heroPerson();
          const remarks: { pid: number; text: string }[] = [];
          if (hero.skills & SkillFlag.ACCOUNTING) {
            remarks.push({ pid: m.globals.hero, text: cap(() => c.message(0x350, p.goods[g], bestPortName)) });
          } else {
            for (let i = 0; i < GameConst.PARTY_SLOTS; i++) {
              const cid = m.partyCrew(i);
              if (cid === GameConst.EMPTY_SLOT) continue;
              const cp = m.person(cid);
              if (cp.role !== 4) continue;
              const txt = (cp.skills & SkillFlag.ACCOUNTING)
                ? cap(() => c.message(0x351, p.goods[g], bestPortName))
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
            void getPersonPortraitSrc(art, personRawBytes(m.person(rm.pid))).then(src => { if (src) img.src = src; });
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

      // ---- Tab 6: 发现物情报 (附高清发现物插图) ----
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
          const disc = m.discovery(id);
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
          cEl.textContent = cap(() => c.printf(B.cat, B.discCats[disc.flags & DiscoveryFlag.KIND_MASK]));
          const iEl = document.createElement("div");
          iEl.style.cssText = "font-size:14px;color:var(--uw2-ink-muted);";
          iEl.textContent = cap(() => c.printf(B.imp, imp[Math.trunc(disc.importance / 25)] ?? Uint8Array.of(0)));
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

      // ---- Tab 8: 航海日志 ----
      const renderLogTab = (root: HTMLElement) => {
        const S = cmd.S;
        const entries: { date: string; text: string }[] = [];
        for (let i = 0; i < GameConst.TRADE_LOG_COUNT; i++) {
          const e = getTradeLogEntry(m, i), w = e.dateWord;
          if (w === 0xffff) break;
          const d = Math.trunc(w / 31), mon = Math.trunc(d / 12);
          const date = cap(() => c.printf(S.logDate, mon + 1501, d % 12 + 1, w % 31 + 1));
          const t = e.type;
          const text = cap(() => {
            if (t === 0 || t === 1) c.message(t ? 0x16f : 0x16e, e.argU16(0), m.port(e.argU8(2)).nameBytes);
            else if (t === 2) {
              const m34 = c.menuItems(0x34), m35 = c.menuItems(0x35), v = e.argU16(0);
              const k = v >= 60 ? 0 : v % 10 === 0 ? 0 : v % 10 < 5 ? 1 : 2;
              c.message(0x345, p.nations[Math.trunc(v / 10)], m34[k], m35[e.argU16(2)]);
            } else if (t === 9) c.message(0x17d, m.port(e.argU8(0)).nameBytes);
            else if (t === 12) c.message(0x180, p.goods[e.argU16(0)], e.argI32HiLo(2), e.argU16(6));
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

      render(false);
  });
}

/** 随身物一体化工作台：左侧道具清单 + 右侧高清道具插图、属性、原版说明与佩戴/使用按钮 */
export async function runDomBelongings(cmd: any): Promise<void> {
  const c = cmd.c, m = cmd.st.model, b = cmd.b, art = c.art;
  const dec = (bts: Uint8Array) => decodeCleanCstr(c.codec, bts);
  const title = UI_STR.belongingsTitle;
  const actLabels = [...UI_STR.belongingsActions];

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
        preserveScroll(h.body, () => {
          h.body.innerHTML = "";
          const split = document.createElement("div");
          split.className = "uw2-split narrow-left";

          const left = document.createElement("div");
          left.className = "uw2-list-col";
          itemIds.forEach((it, i) => {
            const item = m.item(it);
            const eq = !!(item.kindFlags & ItemFlag.EQUIPPED);
            const btn = document.createElement("button");
            btn.className = `uw2-row-card ${i === selIdx ? "selected" : ""}`;
            btn.innerHTML = `<span style="font-weight:700;">${dec(item.nameBytes)}</span><span style="color:#8a5d17;font-weight:700;">${eq ? "★" : ""}</span>`;
            btn.addEventListener("click", () => { selIdx = i; render(); });
            left.appendChild(btn);
          });

          const right = document.createElement("div");
          right.className = "uw2-action-box";
          const it = itemIds[selIdx];
          const item = m.item(it);
          const imgUrl = art?.discoveryUrl?.(item.icon + 0x55);
          const itemType = item.kindFlags & ItemFlag.KIND_MASK;
          const itemVal = item.power;
          const isEquipped = !!(item.kindFlags & ItemFlag.EQUIPPED);
          const typeName = b.BG?.itemTypes?.[itemType] ? dec(b.BG.itemTypes[itemType]) : "";
          const lvItems = c.menuItems(0x22);
          const lines: string[] = [
            `${dec(item.nameBytes)}${typeName ? `（${typeName}）` : ""}${isEquipped ? "  [已装备]" : ""}`,
          ];
          if (itemType <= 3) {
            const gIdx = itemVal >= 0x23 ? 4 : Math.max(0, Math.min(4, Math.trunc((itemVal - 5) / 6)));
            lines.push(`攻击力：${dec(lvItems[gIdx] ?? Uint8Array.of(0))}`);
          } else if (itemType === 6) {
            const gIdx = itemVal > 0x28 ? 4 : Math.max(0, Math.min(4, Math.trunc((itemVal - 10) / 10)));
            lines.push(`防御力：${dec(lvItems[gIdx] ?? Uint8Array.of(0))}`);
          }
          const rawDesc = c.portAssets?.itemMes?.[it];
          if (rawDesc) lines.push(toSimp(String(rawDesc).replace(/\s+/g, " ").trim()));

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
        }, true);
      };

      render();
    });

    if (action.type === "close") return;
    if (action.type === "equip" && action.it !== undefined) await cmd.equip(action.it);
    else if (action.type === "use" && action.it !== undefined) await cmd.use(action.it);
  }
}

/** 现代队形变更面板：上移 / 下移 / 置顶实时调整舰队顺序，一键确定写回原版槽位 */
export function runDomFormation(cmd: any, title: string): Promise<void> {
  const c = cmd.c, m = cmd.st.model, b = cmd.b, art = c.art;
  const dec = (bts: Uint8Array) => decodeCleanCstr(c.codec, bts);
  const n = b.fleetShips();
  if (n <= 1) return Promise.resolve();

  const oldSlots: number[] = [];
  for (let i = 0; i < n; i++) oldSlots.push(c.persons[i] & 0xff);
  const order = [...oldSlots];

  return new Promise(resolve => {
    let settled = false;
    const finish = (apply: boolean) => {
      if (settled) return;
      settled = true;
      h.close();
      if (apply) {
        const oldArr = new Array(10).fill(0xff);
        const nwArr = new Array(10).fill(0xff);
        for (let i = 0; i < order.length; i++) { oldArr[i] = oldSlots[i]; nwArr[i] = order[i]; }
        cmd.fmApply(oldArr, nwArr);
      }
      resolve();
    };

    const h = createDomModal({
      title: title || "队形变更",
      size: "md",
      cancelable: true,
      closeLabel: "关闭",
      onCancel: () => finish(false),
    });

    const footer = document.createElement("div");
    footer.className = "uw2-modal-footer";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "uw2-btn";
    cancelBtn.style.padding = "7px 22px";
    cancelBtn.textContent = "取消";
    cancelBtn.addEventListener("click", () => finish(false));

    const okBtn = document.createElement("button");
    okBtn.className = "uw2-btn uw2-btn-primary";
    okBtn.style.padding = "7px 22px";
    okBtn.textContent = "确定";
    okBtn.addEventListener("click", () => finish(true));

    footer.append(cancelBtn, okBtn);
    h.modal.appendChild(footer);

    const render = () => {
      preserveScroll(h.body, () => {
        h.body.innerHTML = "";
        const list = document.createElement("div");
        list.className = "uw2-list-col";
        list.style.maxHeight = "440px";

        order.forEach((slot, idx) => {
          const slotView = heroOrDockSlot(m, slot), cs = m.crewSlot(slot);
          const ship = m.ship(slotView.ship);
          const typeId = ship.type;
          const capId = cs.captain;
          const capName = (capId & 0x80) ? "----" : dec(m.person(capId).givenNameBytes);
          const dur = slotView.durability, maxDur = slotView.maxDurability;
          const crew = slotView.crew, spd = (b.shipSpeed(slot) + 1) >> 1;

          const card = document.createElement("div");
          card.className = "uw2-slot-card";
          card.style.gap = "12px";

          const num = document.createElement("span");
          num.style.cssText = "width:26px;font-size:16px;font-weight:700;color:#8a5d17;text-align:center;";
          num.textContent = String(idx + 1);
          card.appendChild(num);

          const shipUrl = art?.shipUrl?.(typeId);
          if (shipUrl) {
            const img = document.createElement("img");
            img.src = shipUrl;
            img.style.cssText = "width:64px;height:42px;object-fit:contain;border-radius:4px;background:#0e1b30;border:1px solid var(--uw2-gold);padding:2px;flex-shrink:0;";
            card.appendChild(img);
          }

          const info = document.createElement("div");
          info.style.cssText = "flex:1;min-width:0;";
          info.innerHTML = `<div class="uw2-slot-title">${dec(ship.nameBytes)}</div><div class="uw2-slot-sub">${capName} · 耐久 ${dur}/${maxDur} · 水手 ${crew} · ${spd}kt</div>`;
          card.appendChild(info);

          const ctrl = document.createElement("div");
          ctrl.className = "uw2-step-row";

          const mkBtn = (lb: string, dis: boolean, fn: () => void) => {
            const btn = document.createElement("button");
            btn.className = "uw2-step-btn";
            btn.disabled = dis;
            btn.textContent = lb;
            btn.addEventListener("click", fn);
            return btn;
          };

          ctrl.append(
            mkBtn("置顶", idx === 0, () => {
              const [x] = order.splice(idx, 1);
              order.unshift(x);
              render();
            }),
            mkBtn("↑", idx === 0, () => {
              [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
              render();
            }),
            mkBtn("↓", idx === order.length - 1, () => {
              [order[idx + 1], order[idx]] = [order[idx], order[idx + 1]];
              render();
            }),
          );
          card.appendChild(ctrl);
          list.appendChild(card);
        });
        h.body.appendChild(list);
      }, true);
    };

    render();
  });
}
