// ui/info_maps.ts — 世界航海图（支持局部海域缩放漫游）与海港全图（从 ui/info_hub.ts 拆分）
import { WorldConst, heroFleet, isWorldCellExplored } from "../model/world_helpers.ts";
import { createDomModal } from "./modals.ts";
import { decodeCleanCstr, UI_FONT } from "./text_util.ts";

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
    let anySeen = false;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (isCellSeen(wcol + dc, row + dr)) anySeen = true;
    if (!anySeen) return;
    zoomCol = (wcol - 1 + 90) % 90;
    zoomRow = Math.max(0, Math.min(42, row - 1));
    mode = "local";
    tip.style.display = "none";
    renderAll();
  });
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
