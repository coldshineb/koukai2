// ui/sea_modals.ts — 海上与上陆探索专用 DOM 弹窗（从 scenes/land.js、scenes/sea.js 抽出）
import { createDomModal } from "./modals.ts";

export interface LandRepairRow {
  label: string;
  cur: number;
  max: number;
}

/** 上陆探索期间使用资材修理船只的现代羊皮纸弹窗，返回选中项索引（0..2），取消返回 -1 */
export function runDomLandRepairModal(shipName: string, rows: readonly LandRepairRow[]): Promise<number> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (idx: number) => {
      if (settled) return;
      settled = true;
      resolve(idx);
    };
    const h = createDomModal({
      title: `修理 · ${shipName}`,
      size: "sm",
      cancelable: true,
      closeLabel: "完成",
      onCancel: () => finish(-1),
    });
    rows.forEach(({ label, cur, max }, idx) => {
      const btn = document.createElement("button");
      btn.className = "uw2-row-card";
      const pct = max > 0 ? Math.min(100, Math.round((cur * 100) / max)) : 100;
      btn.disabled = cur >= max;
      btn.innerHTML =
        `<span style="font-weight:700;min-width:44px;">${label}</span>` +
        `<div class="uw2-bar-track" style="flex:1;"><div class="uw2-bar-fill ${pct < 40 ? "red" : "green"}" style="width:${pct}%"></div></div>` +
        `<span style="font-weight:700;min-width:58px;text-align:right;">${cur}/${max}</span>`;
      btn.addEventListener("click", () => {
        h.close();
        finish(idx);
      });
      h.body.appendChild(btn);
    });
  });
}

export interface TreasureChartOptions {
  title: string;
  x: number;
  y: number;
  art: any;
  wm: any;
  st: any;
}

/** 宝藏图 / 发现物局部海域画布弹窗，绘制 48×48 海域格与红色 X 宝藏坐标标记 */
export async function runDomTreasureChartModal(opts: TreasureChartOptions): Promise<void> {
  const { title, x, y, art, wm, st } = opts;
  let di = Math.trunc(x / 0x18);
  let si = Math.trunc(y / 0x18);
  if (x % 0x18 < 0x0c) di = (di + 0x59) % 0x5a;
  if (y % 0x18 < 0x0c && si) si--;

  const tileBuf = new Uint8Array(0x60 * 0x60);
  const sheetMeta = art.sheet("seachip");
  const sheetImg = sheetMeta
    ? (art.getImage(art.sheetUrl("seachip")) || await art.loadImage(art.sheetUrl("seachip")).catch(() => null))
    : null;

  await new Promise<void>(resolve => {
    const h = createDomModal({
      title,
      size: "md",
      cancelable: true,
      closeLabel: "关闭",
      onCancel: () => resolve(),
    });
    const cv = document.createElement("canvas");
    cv.width = 48 * 8;
    cv.height = 48 * 8;
    cv.style.cssText =
      "width:100%;max-width:420px;aspect-ratio:1/1;margin:0 auto;display:block;border-radius:8px;" +
      "border:2px solid var(--uw2-gold);background:#0c2648;image-rendering:pixelated;";
    const ctx = cv.getContext("2d");
    if (ctx && sheetMeta && sheetImg) {
      ctx.imageSmoothingEnabled = false;
      const sxScale = (sheetImg.naturalWidth || sheetMeta.w) / sheetMeta.w;
      const syScale = (sheetImg.naturalHeight || sheetMeta.h) / sheetMeta.h;
      const drawQuad = (qx: number, qy: number, bc: number, br: number) => {
        bc = ((bc % 0x5a) + 0x5a) % 0x5a;
        if (br < 0 || br >= 0x2d) return;
        const itIdx = (3 * Math.trunc(br / 0x2d) + Math.trunc(bc / 0x1e)) & 0xff;
        let ox = 0x18, oy = 0x18, r = (br % 0x2d) - 1, c = (bc % 0x1e) - 1;
        if (c < 0) { c = 0; ox = 0; } else if (c > 0x1b) { ox = 0x30; c = 0x1b; }
        if (r < 0) { r = 0; oy = 0; } else if (r > 0x2a) { oy = 0x30; r = 0x2a; }
        wm.decodeChart(st, itIdx, 0x1e * r + c, tileBuf);
        for (let rr = 0; rr < 24; rr++) {
          for (let cc = 0; cc < 24; cc++) {
            const t = tileBuf[0x60 * (oy + rr) + ox + cc];
            const col = t % sheetMeta.cols;
            const row = Math.floor(t / sheetMeta.cols);
            ctx.drawImage(
              sheetImg,
              col * sheetMeta.tileW * sxScale,
              row * sheetMeta.tileH * syScale,
              sheetMeta.tileW * sxScale,
              sheetMeta.tileH * syScale,
              (qx + cc) * 8,
              (qy + rr) * 8,
              8,
              8,
            );
          }
        }
      };
      drawQuad(0, 0, di, si);
      drawQuad(24, 0, di + 1, si);
      drawQuad(0, 24, di, si + 1);
      drawQuad(24, 24, di + 1, si + 1);
      // 绘制红色 X 宝藏标记
      let rx = x - di * 24;
      if (rx < -1080) rx += 2160;
      else if (rx > 1080) rx -= 2160;
      const ry = y - si * 24;
      if (rx >= 0 && rx < 48 && ry >= 0 && ry < 48) {
        const px = rx * 8 + 4;
        const py = ry * 8 + 4;
        ctx.strokeStyle = "#dc2626";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(px - 8, py - 8);
        ctx.lineTo(px + 8, py + 8);
        ctx.moveTo(px + 8, py - 8);
        ctx.lineTo(px - 8, py + 8);
        ctx.stroke();
      }
    }
    h.body.appendChild(cv);
  });
}
