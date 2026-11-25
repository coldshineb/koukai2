// opening.js — 现代 HD 片头动画演播系统（使用 ArtRegistry PNG + 16:9 Canvas + Simplified Chinese 字幕，不再使用 OpVGA / opgraph/*.dat）
import { VIEW_W, VIEW_H } from "../core/screen.js";
import { toSimp, UI_FONT, MONO_FONT } from "../ui/text_util.ts";

export class OpeningExit extends Error {
  constructor() {
    super("opening exit");
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCaptionBox(ctx, title, body, alpha = 1) {
  if ((!title && !body) || alpha <= 0.01) return;
  const x = 140, y = 496, w = VIEW_W - 280, h = 166;
  ctx.save();
  ctx.globalAlpha *= alpha;
  roundRect(ctx, x, y, w, h, 14);
  const bg = ctx.createLinearGradient(x, y, x, y + h);
  bg.addColorStop(0, "rgba(12, 24, 44, 0.90)");
  bg.addColorStop(1, "rgba(7, 15, 29, 0.95)");
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = "rgba(218, 178, 102, 0.85)";
  ctx.lineWidth = 1.8;
  ctx.stroke();

  let ty = y + 24;
  if (title && title.trim()) {
    ctx.fillStyle = "#f7dfa4";
    ctx.font = `700 24px ${UI_FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(title.trim(), x + 32, ty);
    ty += 36;
  }

  if (body && body.trim()) {
    ctx.fillStyle = "#f2e7d0";
    ctx.font = `500 20px ${UI_FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const lines = body.replace(/^[\u3000 ]+/gm, m => "  ".repeat(m.length)).split("\n");
    for (const line of lines) {
      ctx.fillText(line, x + 32, ty);
      ty += 28;
    }
  }
  ctx.restore();
}

export class Opening {
  // ctx: { scr, sys, bgm, art }  data: opening.json
  constructor(ctx, data) {
    this.ctx = ctx;
    this.scr = ctx.scr;
    this.sys = ctx.sys;
    this.bgm = ctx.bgm;
    this.art = ctx.art;
    this.data = data;
    this.full = null;

    const rd = data?.readable ?? {};
    const t1 = rd["text1 (DS:0898)"] ?? [];
    const t2 = rd["text2 (DS:08ae)"] ?? [];
    this.titles = t1.map(s => toSimp(s));
    this.texts = t2.map(s => toSimp(s));

    this.stageAlpha = 1;
    this.backdropColor = "#040812";
    this.layers = []; // { entry, x, y, w, h, alpha, scrollX? }
    this.caption = null; // { title, body, alpha }
    this.showSkipHint = false;
  }

  entry(pack, idx) {
    const key = pack === "tail" ? "tail" : `op${String(pack).padStart(2, "0")}`;
    return this.art?.manifest?.opening?.[key]?.[idx] ?? null;
  }

  getImg(e) {
    if (!e || !this.art) return null;
    return this.art.getImage(`${this.art.baseUrl}/${e.path}`);
  }

  async preloadAll() {
    const op = this.art?.manifest?.opening;
    if (!op) return;
    const urls = [];
    for (const arr of Object.values(op)) {
      for (const e of arr) if (e?.path) urls.push(`${this.art.baseUrl}/${e.path}`);
    }
    await this.art.preloadUrls(urls);
  }

  flushKeys() {
    while (this.sys.kbhit()) this.sys.readRaw();
  }

  anySkipPressed(escOnly = false) {
    if (this.sys.mouseLeft() || this.sys.mouseRight()) {
      if (!escOnly) return true;
    }
    while (this.sys.kbhit()) {
      const k = this.sys.readRaw();
      const ascii = k & 0xff;
      if (ascii === 0x1b) return true;
      if (!escOnly && (ascii === 0x0d || ascii === 0x20)) return true;
    }
    return false;
  }

  async poll() {
    if (this.scr) this.scr.dirty = true;
    await this.sys.poll();
  }

  async waitTicks(n, { escOnly = false, skippable = true } = {}) {
    this.sys.timer.set(n & 0xffff);
    while (this.sys.timer.get()) {
      if (skippable && this.anySkipPressed(escOnly)) throw new OpeningExit();
      await this.poll();
    }
  }

  async fade(from, to, ticks = 18, opts = {}) {
    for (let i = 0; i <= ticks; i++) {
      this.stageAlpha = from + ((to - from) * i) / ticks;
      await this.waitTicks(1, opts);
    }
    this.stageAlpha = to;
  }

  renderWide(ctx) {
    ctx.save();
    ctx.fillStyle = this.backdropColor;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // 深海光晕底层
    const grad = ctx.createRadialGradient(VIEW_W / 2, VIEW_H * 0.42, 30, VIEW_W / 2, VIEW_H * 0.5, VIEW_W * 0.65);
    grad.addColorStop(0, "rgba(28, 56, 98, 0.35)");
    grad.addColorStop(1, "rgba(4, 8, 18, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.globalAlpha = Math.max(0, Math.min(1, this.stageAlpha));

    // 原版逻辑画布 640×400 -> 等比 1.8× 铺高 720 (offX = 64)
    const S = 1.8, OX = 64;
    for (const l of this.layers) {
      const img = this.getImg(l.entry);
      if (!img) continue;
      ctx.save();
      ctx.globalAlpha *= (l.alpha ?? 1);
      const iw = img.naturalWidth || l.entry.w;
      const ih = img.naturalHeight || l.entry.h;
      const dw = (l.w ?? l.entry.w) * S;
      const dh = (l.h ?? l.entry.h) * S;
      ctx.imageSmoothingEnabled = iw > l.entry.w || ih > l.entry.h;
      ctx.drawImage(img, OX + (l.x ?? 0) * S, (l.y ?? 0) * S, dw, dh);
      ctx.restore();
    }

    if (this.caption) {
      drawCaptionBox(ctx, this.caption.title, this.caption.body, this.caption.alpha ?? 1);
    }

    if (this.showSkipHint) {
      ctx.save();
      ctx.fillStyle = "rgba(218, 198, 152, 0.55)";
      ctx.font = `500 13px ${MONO_FONT}`;
      ctx.textAlign = "right";
      ctx.fillText("Enter / Space / 点击跳过", VIEW_W - 24, VIEW_H - 18);
      ctx.restore();
    }
    ctx.restore();
  }

  async playIntroCard({ cardEntry, heroEntry, heroX, heroY, spriteEntries, eyeEntries, eyeX, eyeY, idx }) {
    this.caption = null;
    this.backdropColor = "#060e1c";
    // 1. 人物剪影出场行走片段
    if (spriteEntries?.length) {
      for (let step = 0; step < 18; step++) {
        const sp = spriteEntries[step % spriteEntries.length];
        const progress = step / 17;
        const sx = Math.round(420 - progress * 220);
        const sy = 150;
        this.layers = [{ entry: sp, x: sx, y: sy, alpha: 0.95 }];
        await this.waitTicks(3);
      }
    }

    // 2. 呈现背景卡片 + 主角大图 + 简介卡片 + 眨眼动画
    const title = this.titles[idx] ?? "";
    const body = this.texts[idx] ?? "";
    const baseLayers = [];
    if (cardEntry) baseLayers.push({ entry: cardEntry, x: 88, y: 48 });
    if (heroEntry) baseLayers.push({ entry: heroEntry, x: heroX, y: heroY });

    this.layers = baseLayers;
    this.caption = { title, body, alpha: 0 };
    for (let f = 1; f <= 12; f++) {
      this.caption.alpha = f / 12;
      await this.waitTicks(2);
    }

    for (let t = 0; t < 150; t++) {
      if (eyeEntries?.length) {
        const cyc = (t + 40) % 50;
        if (cyc < 5) {
          const blinkIdx = 2 - Math.abs(cyc - 2);
          const eye = eyeEntries[Math.min(eyeEntries.length - 1, blinkIdx)];
          this.layers = [...baseLayers, { entry: eye, x: eyeX, y: eyeY }];
        } else {
          this.layers = baseLayers;
        }
      }
      await this.waitTicks(2);
    }
    this.caption = null;
  }

  async run() {
    this.scr.wideDialog = null;
    this.scr.wideOverlays.length = 0;
    this.scr.setAtmosphere?.({ active: false });
    this.scr.setPaletteRaw(new Uint8Array(48).fill(15));
    await this.preloadAll();
    this.scr.wideRenderer = ctx => this.renderWide(ctx);
    this.flushKeys();

    try {
      await this.playAllScenes();
    } catch (e) {
      if (!(e instanceof OpeningExit)) throw e;
      this.bgm?.fadeOut?.();
      await this.fade(this.stageAlpha, 0, 14, { skippable: false });
    } finally {
      this.scr.wideRenderer = null;
      this.scr.setPaletteRaw(new Uint8Array(48));
      this.scr.clear(0);
    }
  }

  async playAllScenes() {
    // 场景 0: KOEI 徽标与版权页 (支持 Esc 跳过)
    this.showSkipHint = false;
    this.bgm?.playSong?.(0);
    this.layers = [
      { entry: this.entry(0, 0), x: 216, y: 96 },
      { entry: this.entry(0, 1), x: 216, y: 224 },
    ];
    await this.fade(0, 1, 18, { escOnly: true });
    await this.waitTicks(95, { escOnly: true });
    await this.fade(1, 0, 18, { escOnly: true });

    this.layers = [{ entry: this.entry(0, 3), x: 120, y: 174 }];
    await this.fade(0, 1, 16, { escOnly: true });
    await this.waitTicks(90, { escOnly: true });
    await this.fade(1, 0, 14, { escOnly: true });

    this.layers = [
      { entry: this.entry("tail", 0), x: 248, y: 132 },
      { entry: this.entry("tail", 1), x: 128, y: 188 },
    ];
    await this.fade(0, 1, 16, { escOnly: true });
    await this.waitTicks(90, { escOnly: true });
    await this.fade(1, 0, 14, { escOnly: true });

    // 场景 1: 海平线晨曦 + 海鸥掠过 + 大航海时代 II 标题横幅
    this.showSkipHint = true;
    this.layers = [
      { entry: this.entry(0, 9), x: 0, y: 112 },
      { entry: this.entry("tail", 2), x: 0, y: 120 },
    ];
    await this.fade(0, 1, 20);
    for (let k = 0; k < 28; k++) {
      const bird = this.entry(0, 10 + (k % 5));
      this.layers = [
        { entry: this.entry(0, 9), x: 0, y: 112 },
        { entry: this.entry("tail", 2), x: 0, y: 120 },
        { entry: bird, x: 180 + k * 9, y: 96 - Math.sin(k * 0.25) * 14 },
      ];
      await this.waitTicks(3);
    }
    this.layers = [
      { entry: this.entry(0, 4), x: 40, y: 120 },
      { entry: this.entry(0, 8), x: 520, y: 112 },
      { entry: this.entry(13, 0), x: 32, y: 36 },
    ];
    await this.waitTicks(120);
    await this.fade(1, 0, 16);

    // 场景 2: 序言字幕 + 欧洲航图启程
    this.layers = [{ entry: this.entry(1, 0), x: 0, y: 100 }];
    this.caption = { title: "", body: this.texts[8] ?? "", alpha: 1 };
    await this.fade(0, 1, 16);
    await this.waitTicks(160);
    this.caption = null;
    await this.fade(1, 0, 14);

    // 场景 3..7: 5 位初始可选主角登场
    await this.playIntroCard({
      idx: 0,
      cardEntry: this.entry(3, 5),
      heroEntry: this.entry(3, 7), heroX: 152, heroY: 64,
      spriteEntries: [this.entry(3, 0), this.entry(3, 1), this.entry(3, 2), this.entry(3, 3), this.entry(3, 4)],
      eyeEntries: [this.entry(3, 8), this.entry(3, 9), this.entry(3, 10)], eyeX: 184, eyeY: 104,
    });
    await this.playIntroCard({
      idx: 1,
      cardEntry: this.entry(4, 3),
      heroEntry: this.entry(4, 4), heroX: 192, heroY: 48,
      spriteEntries: [this.entry(4, 0), this.entry(4, 1), this.entry(4, 2)],
      eyeEntries: [this.entry(4, 5), this.entry(4, 6), this.entry(4, 7)], eyeX: 432, eyeY: 120,
    });
    await this.playIntroCard({
      idx: 2,
      cardEntry: this.entry(5, 3),
      heroEntry: this.entry(5, 4), heroX: 184, heroY: 64,
      spriteEntries: [this.entry(5, 0), this.entry(5, 1), this.entry(5, 2)],
      eyeEntries: [this.entry(5, 5), this.entry(5, 6), this.entry(5, 7)], eyeX: 208, eyeY: 112,
    });
    await this.playIntroCard({
      idx: 3,
      cardEntry: this.entry(6, 3),
      heroEntry: this.entry(6, 4), heroX: 360, heroY: 80,
      spriteEntries: [this.entry(6, 0), this.entry(6, 1), this.entry(6, 2)],
      eyeEntries: [this.entry(6, 5), this.entry(6, 6), this.entry(6, 7)], eyeX: 376, eyeY: 128,
    });
    await this.playIntroCard({
      idx: 4,
      cardEntry: this.entry(7, 3),
      heroEntry: this.entry(7, 4), heroX: 160, heroY: 48,
      spriteEntries: [this.entry(7, 0), this.entry(7, 1), this.entry(7, 2)],
      eyeEntries: [this.entry(7, 5), this.entry(7, 6), this.entry(7, 7)], eyeX: 200, eyeY: 88,
    });

    // 场景 8..9: 女伴与宿敌
    await this.playIntroCard({
      idx: 5,
      cardEntry: this.entry(8, 5),
      heroEntry: null, heroX: 0, heroY: 0,
      spriteEntries: [this.entry(8, 0), this.entry(8, 1), this.entry(8, 2)],
      eyeEntries: [this.entry(8, 6), this.entry(8, 7), this.entry(8, 8)], eyeX: 344, eyeY: 120,
    });
    await this.playIntroCard({
      idx: 6,
      cardEntry: this.entry(9, 10),
      heroEntry: null, heroX: 0, heroY: 0,
      spriteEntries: [],
      eyeEntries: [this.entry(9, 0), this.entry(9, 1), this.entry(9, 2)], eyeX: 216, eyeY: 72,
    });

    // 场景 10: 约翰·法雷尔
    await this.playIntroCard({
      idx: 7,
      cardEntry: this.entry(10, 0),
      heroEntry: this.entry(10, 4), heroX: 304, heroY: 72,
      spriteEntries: [],
      eyeEntries: [this.entry(10, 1), this.entry(10, 2), this.entry(10, 3)], eyeX: 368, eyeY: 120,
    });

    // 场景 11: 尾声大船远航 + 淡出进标题
    this.layers = [{ entry: this.entry(11, 0), x: 0, y: 100 }];
    this.caption = { title: "", body: this.texts[9] ?? "", alpha: 1 };
    await this.fade(0, 1, 18);
    await this.waitTicks(200);
    this.bgm?.fadeOut?.();
    await this.fade(1, 0, 24, { skippable: false });
  }
}

// 加载片头数据 (纯 JSON；图像由 ArtRegistry 标准 PNG 提供)
export async function loadOpeningData(ASSETS, _loadBinaryOrJson, maybeLoadJSON) {
  const rdJson = typeof maybeLoadJSON === "function" ? maybeLoadJSON : _loadBinaryOrJson;
  return rdJson(`${ASSETS}/data/opening.json`);
}
