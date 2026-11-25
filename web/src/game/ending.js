// ending.js — 现代 HD 结局演播系统（完全使用 ArtRegistry 标准 PNG 与 16:9 Canvas + 羊皮纸对话卡片，不再读取 ENDGRP/END_PUT/EVENT*.DAT）
import { VIEW_W, VIEW_H } from "../core/screen.js";
import { PROLOGUES } from "./ending_pro.js";
import { toSimp, UI_FONT, MONO_FONT } from "../ui/text_util.ts";

export class EndingExit extends Error {
  constructor(code) {
    super("ending exit");
    this.code = code;
  }
}

const EVENT_FILES = [
  1, 1, 1, 1, 1,
  2, 2, 2, 2, 2,
  0, 3, 3, 3, 3,
  4, 4, 4, 4, 4,
  5, 5, 5, 5, 5,
  0, 6, 6, 6, 6,
];
const EVENT_ENTRIES = [
  0, 3, 1, 4, 2,
  4, 0, 1, 5, 3,
  0, 1, 0, 3, 2,
  0, 1, 4, 3, 2,
  2, 1, 4, 3, 0,
  0, 1, 3, 2, 0,
];
const CREDIT_OFFSETS = [
  0x6c, 0x8b, 0xaa, 0xb9, 0xd8, 0xef, 0x10e, 0x12d,
  0x146, 0x165, 0x184, 0x1a3, 0x1c2, 0x1e1, 0x1ea, 0x209, 0x228,
];
const HERO_SCENE_MAIN = [10, 15, 23, 37, 30, 45];
const HERO_SCENE_ALT = [11, 16, 23, 38, 30, 46];

function cleanEscapes(raw) {
  return raw
    .replace(/\x1b[A-Za-z][0-9A-Za-z]?/g, "")
    .replace(/\{[0-9A-Fa-f]{2}\}/g, "");
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

function drawLinesWrapped(ctx, text, x, y, maxW, lineH) {
  const paras = text.split("\n");
  let cy = y;
  for (const para of paras) {
    let line = "";
    for (const ch of para) {
      const test = line + ch;
      if (line && ctx.measureText(test).width > maxW) {
        ctx.fillText(line, x, cy);
        cy += lineH;
        line = ch;
      } else {
        line = test;
      }
    }
    if (line || para === "") {
      ctx.fillText(line, x, cy);
      cy += lineH;
    }
  }
}

export class Ending {
  // ctx: { scr, sys, bgm, art, codec }  data: ending.json
  constructor(ctx, data) {
    this.ctx = ctx;
    this.scr = ctx.scr;
    this.sys = ctx.sys;
    this.bgm = ctx.bgm;
    this.art = ctx.art;
    this.codec = ctx.codec;
    this.data = data;

    this.m = new Uint8Array(0x10000);
    const ds = data.ds;
    for (let i = 0; i < ds.length / 2; i++) this.m[i] = parseInt(ds.substr(i * 2, 2), 16);

    this.slotHandles = {};
    this.eventSlots = {};
    this.curEventHero = 1;
    this.stageAlpha = 1;
    this.bgEntry = null;
    this.centerArt = null;
    this.centerAlpha = 1;
    this.topBox = null;      // { face, text, waiting }
    this.botBox = null;      // { face, text, waiting }
    this.narratorBox = null; // { text, waiting }
    this.epilogueSlide = null; // { picEntry, lines: string[], revealed: number }
    this.finaleView = null;    // { mainEntry, altEntry, altAlpha, vignetteEntry, vignetteAlpha, castEntry, finEntry, scrollLines, scrollY, showFin }
  }

  // ---- DS 访问 (供 ending_pro.js 与参数检查使用) ----
  b(o) { return this.m[o & 0xffff]; }
  w(o) { o &= 0xffff; return this.m[o] | (this.m[(o + 1) & 0xffff] << 8); }
  sb(o, v) { this.m[o & 0xffff] = v & 255; }
  sw(o, v) { o &= 0xffff; this.m[o] = v & 255; this.m[(o + 1) & 0xffff] = (v >> 8) & 255; }
  str(o) {
    let e = o;
    while (e < this.m.length && this.m[e]) e++;
    return this.m.subarray(o, e);
  }
  ptr(h) { return this.eventSlots[h] ?? null; }

  decodeCstr(bytesOrOff) {
    const bts = typeof bytesOrOff === "number" ? this.str(bytesOrOff) : bytesOrOff;
    if (!this.codec || !bts) return "";
    return toSimp(cleanEscapes(this.codec.decode(bts)));
  }

  formatStr(fmtOff, ...args) {
    let txt = this.decodeCstr(fmtOff);
    let idx = 0;
    txt = txt.replace(/%s/g, () => {
      const a = args[idx++];
      if (a instanceof Uint8Array) return this.decodeCstr(a);
      return String(a ?? "");
    });
    return txt.trim();
  }

  // ---- 计时与输入 ----
  async poll() {
    if (this.scr) this.scr.dirty = true;
    await this.sys.poll();
  }
  async waitTicks(n) {
    this.sys.timer.set(n & 0xffff);
    while (this.sys.timer.get()) await this.poll();
  }
  kbhit() { return this.sys.kbhit() ? 1 : 0; }
  flushKeys() { while (this.kbhit()) this.sys.readRaw(); }
  mouseAny() { return this.sys.mouseLeft() || this.sys.mouseRight() ? 1 : 0; }
  inputState() { return this.mouseAny() ? 1 : this.kbhit() ? 2 : 0; }
  async waitNoInput() { while (this.inputState()) { this.flushKeys(); await this.poll(); } }
  async waitInput() {
    await this.waitNoInput();
    while (!this.inputState()) await this.poll();
    await this.waitNoInput();
  }
  async waitOrKey(n) {
    this.sys.timer.set(n & 0xffff);
    for (;;) {
      if (!this.sys.timer.get()) return 0;
      if (this.kbhit() || this.mouseAny()) {
        this.flushKeys();
        return 1;
      }
      await this.poll();
    }
  }
  async fadeAlpha(from, to, steps = 16) {
    for (let i = 0; i <= steps; i++) {
      this.stageAlpha = from + ((to - from) * i) / steps;
      await this.waitTicks(1);
    }
    this.stageAlpha = to;
  }

  // ---- 音乐 ----
  async playSong(k) {
    if (!this.b(0x1ff6) || k > 0x17) return;
    this.bgm?.playSong?.(k + 1);
    if (this.bgm?.el) this.bgm.el.loop = true;
    this.sb(0x0e46, k);
  }
  musicFlag(v) {
    if (this.bgm?.el) this.bgm.el.loop = !!v;
  }
  musicFade(_speed) {
    this.bgm?.fadeOut?.();
  }

  // ---- 兼容 ending_pro.js 调用 ----
  setCursor() {}
  openEvent(n) { this.curEventHero = n; }
  drawGraph(picIdx) {
    const entry = this.art?.manifest?.events?.[`event${this.curEventHero}`]?.[picIdx] ?? null;
    if (entry) {
      this.centerArt = entry;
      this.centerAlpha = 1;
    }
  }
  put(_col, _y, _w, _h, _mode, slot) {
    if (slot?.eventPic) {
      const { hero, idx } = slot.eventPic;
      this.centerArt = this.art?.manifest?.events?.[`event${hero}`]?.[idx] ?? null;
      this.centerAlpha = 1;
    }
  }
  async talkTop(face, fmt, ...args) {
    this.narratorBox = null;
    this.topBox = { face: face & 0xff, text: this.formatStr(fmt, ...args), waiting: true };
    await this.waitInput();
    this.topBox.waiting = false;
  }
  async talkBottom(face, fmt, ...args) {
    this.narratorBox = null;
    this.botBox = { face: face & 0xff, text: this.formatStr(fmt, ...args), waiting: true };
    await this.waitInput();
    this.botBox.waiting = false;
  }
  async closeAll() {
    this.topBox = null;
    this.botBox = null;
    this.narratorBox = null;
    this.centerArt = null;
  }
  async printf(fmt, ...args) {
    this.narratorBox = { text: this.formatStr(fmt, ...args), waiting: true };
  }
  async prompt() {
    if (this.narratorBox) this.narratorBox.waiting = true;
    await this.waitInput();
    if (this.narratorBox) this.narratorBox.waiting = false;
  }
  async finalWords(fmt, ...args) {
    await this.closeAll();
    const slot = this.ptr(this.w(0x1fde));
    this.put(0, 0, 0, 0, 0, slot);
    await this.printf(fmt, ...args);
    await this.prompt();
  }

  // ---- 图片辅助 ----
  endingEntry(idx) { return this.art?.manifest?.ending?.[idx] ?? null; }
  faceEntry(idx) { return this.art?.manifest?.endingFaces?.[idx] ?? null; }
  getArtImg(entry) {
    if (!entry || !this.art) return null;
    return this.art.getImage(`${this.art.baseUrl}/${entry.path}`);
  }

  async preloadAssets(c) {
    if (!this.art?.manifest) return;
    const urls = [];
    const pushEntry = e => { if (e?.path) urls.push(`${this.art.baseUrl}/${e.path}`); };
    pushEntry(this.endingEntry(7));
    pushEntry(this.endingEntry(53));
    pushEntry(this.endingEntry(56));
    pushEntry(this.endingEntry(57));
    pushEntry(this.endingEntry(58));
    if (c >= 0 && c <= 5) {
      pushEntry(this.endingEntry(HERO_SCENE_MAIN[c]));
      pushEntry(this.endingEntry(HERO_SCENE_ALT[c]));
    }
    for (let i = 0; i < 7; i++) pushEntry(this.endingEntry(i));
    for (const f of this.art.manifest.endingFaces ?? []) pushEntry(f);
    for (let i = 0; i < 5; i++) {
      const slot = this.ptr(this.w(0x1fd6 + 2 * i));
      if (slot?.eventPic) {
        pushEntry(this.art.manifest.events?.[`event${slot.eventPic.hero}`]?.[slot.eventPic.idx]);
      }
    }
    if (c === 4) pushEntry(this.art.manifest.events?.event4?.[5]);
    await this.art.preloadUrls(urls);
  }

  // ---- HD 2D Canvas 渲染 ----
  renderWide(ctx) {
    ctx.save();
    ctx.fillStyle = "#060d18";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // 渐变夜海底衬
    const bgGrad = ctx.createRadialGradient(VIEW_W / 2, VIEW_H * 0.4, 40, VIEW_W / 2, VIEW_H * 0.5, VIEW_W * 0.68);
    bgGrad.addColorStop(0, "#142742");
    bgGrad.addColorStop(0.6, "#0b1628");
    bgGrad.addColorStop(1, "#050a14");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.globalAlpha = Math.max(0, Math.min(1, this.stageAlpha));

    if (this.bgEntry) {
      const img = this.getArtImg(this.bgEntry);
      if (img) {
        const scale = Math.min(VIEW_W / (img.naturalWidth || this.bgEntry.w), VIEW_H / (img.naturalHeight || this.bgEntry.h));
        const dw = (img.naturalWidth || this.bgEntry.w) * scale;
        const dh = (img.naturalHeight || this.bgEntry.h) * scale;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(img, (VIEW_W - dw) / 2, (VIEW_H - dh) / 2, dw, dh);
      }
    }

    if (this.centerArt) {
      const img = this.getArtImg(this.centerArt);
      if (img) {
        const iw = img.naturalWidth || this.centerArt.w;
        const ih = img.naturalHeight || this.centerArt.h;
        const scale = Math.min(480 / iw, 340 / ih);
        const dw = Math.round(iw * scale), dh = Math.round(ih * scale);
        const dx = Math.round((VIEW_W - dw) / 2), dy = 110;
        ctx.save();
        ctx.globalAlpha *= this.centerAlpha;
        roundRect(ctx, dx - 6, dy - 6, dw + 12, dh + 12, 10);
        ctx.fillStyle = "rgba(8, 15, 28, 0.88)";
        ctx.fill();
        ctx.strokeStyle = "rgba(218, 178, 102, 0.85)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.imageSmoothingEnabled = iw > this.centerArt.w;
        ctx.drawImage(img, dx, dy, dw, dh);
        ctx.restore();
      }
    }

    const drawTalkCard = (box, y) => {
      const w = 780, h = 196, x = (VIEW_W - w) / 2;
      ctx.save();
      roundRect(ctx, x, y, w, h, 14);
      const cardGrad = ctx.createLinearGradient(x, y, x, y + h);
      cardGrad.addColorStop(0, "rgba(249, 241, 222, 0.96)");
      cardGrad.addColorStop(1, "rgba(235, 221, 191, 0.96)");
      ctx.fillStyle = cardGrad;
      ctx.fill();
      ctx.strokeStyle = "#b58b46";
      ctx.lineWidth = 2;
      ctx.stroke();

      const fEntry = this.faceEntry(box.face);
      const fImg = this.getArtImg(fEntry);
      if (fImg) {
        roundRect(ctx, x + 22, y + 26, 108, 136, 8);
        ctx.fillStyle = "#16243b";
        ctx.fill();
        ctx.strokeStyle = "#9a7738";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.imageSmoothingEnabled = (fImg.naturalWidth || 64) > 64;
        ctx.drawImage(fImg, x + 26, y + 30, 100, 128);
      }

      ctx.fillStyle = "#2b1d0c";
      ctx.font = `600 22px ${UI_FONT}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      drawLinesWrapped(ctx, box.text, x + 154, y + 32, w - 186, 34);

      if (box.waiting && Math.floor(performance.now() / 420) % 2 === 0) {
        ctx.fillStyle = "#8a5c18";
        ctx.font = `700 18px ${UI_FONT}`;
        ctx.fillText("▼", x + w - 40, y + h - 34);
      }
      ctx.restore();
    };

    if (this.topBox) drawTalkCard(this.topBox, 72);
    if (this.botBox) drawTalkCard(this.botBox, 380);

    if (this.narratorBox) {
      const w = 840, h = 158, x = (VIEW_W - w) / 2, y = 492;
      ctx.save();
      roundRect(ctx, x, y, w, h, 14);
      ctx.fillStyle = "rgba(12, 22, 40, 0.92)";
      ctx.fill();
      ctx.strokeStyle = "rgba(218, 178, 102, 0.85)";
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.fillStyle = "#f4e5c2";
      ctx.font = `600 22px ${UI_FONT}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      drawLinesWrapped(ctx, this.narratorBox.text, x + 36, y + 28, w - 72, 34);
      if (this.narratorBox.waiting && Math.floor(performance.now() / 420) % 2 === 0) {
        ctx.fillStyle = "#f4d78e";
        ctx.fillText("▼", x + w - 42, y + h - 34);
      }
      ctx.restore();
    }

    if (this.epilogueSlide) {
      const s = this.epilogueSlide;
      const panelX = 110, panelY = 120, panelW = 1060, panelH = 480;
      ctx.save();
      roundRect(ctx, panelX, panelY, panelW, panelH, 16);
      ctx.fillStyle = "rgba(10, 20, 36, 0.86)";
      ctx.fill();
      ctx.strokeStyle = "rgba(218, 178, 102, 0.78)";
      ctx.lineWidth = 2;
      ctx.stroke();

      const pImg = this.getArtImg(s.picEntry);
      if (pImg) {
        const ix = panelX + 36, iy = panelY + 66, iw = 420, ih = 315;
        roundRect(ctx, ix - 4, iy - 4, iw + 8, ih + 8, 10);
        ctx.fillStyle = "#080f1c";
        ctx.fill();
        ctx.strokeStyle = "rgba(218, 178, 102, 0.65)";
        ctx.stroke();
        ctx.imageSmoothingEnabled = (pImg.naturalWidth || 192) > 192;
        ctx.drawImage(pImg, ix, iy, iw, ih);
      }

      ctx.fillStyle = "#f5e8cc";
      ctx.font = `600 22px ${UI_FONT}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      for (let i = 0; i < Math.min(s.revealed, s.lines.length); i++) {
        ctx.fillText(s.lines[i], panelX + 492, panelY + 68 + i * 38);
      }
      ctx.restore();
    }

    if (this.finaleView) {
      const f = this.finaleView;
      // 左侧：主结局大图 + FIN
      const mainImg = this.getArtImg(f.mainEntry);
      if (mainImg) {
        const iw = mainImg.naturalWidth || f.mainEntry.w;
        const ih = mainImg.naturalHeight || f.mainEntry.h;
        const scale = Math.min(680 / iw, 560 / ih);
        const dw = Math.round(iw * scale), dh = Math.round(ih * scale);
        const lx = 56, ly = Math.round((VIEW_H - dh) / 2);
        ctx.save();
        ctx.imageSmoothingEnabled = iw > f.mainEntry.w;
        ctx.drawImage(mainImg, lx, ly, dw, dh);
        if (f.altEntry && f.altAlpha > 0) {
          const altImg = this.getArtImg(f.altEntry);
          if (altImg) {
            ctx.globalAlpha *= f.altAlpha;
            ctx.drawImage(altImg, lx, ly, dw, dh);
          }
        }
        ctx.restore();
      }

      // 右上：6位主角小图轮换
      if (f.vignetteEntry && f.vignetteAlpha > 0) {
        const vImg = this.getArtImg(f.vignetteEntry);
        if (vImg) {
          ctx.save();
          ctx.globalAlpha *= f.vignetteAlpha;
          const vx = 780, vy = 56, vw = 420, vh = 300;
          roundRect(ctx, vx - 4, vy - 4, vw + 8, vh + 8, 10);
          ctx.fillStyle = "rgba(8, 16, 30, 0.82)";
          ctx.fill();
          ctx.strokeStyle = "rgba(218, 178, 102, 0.72)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.imageSmoothingEnabled = (vImg.naturalWidth || 224) > 224;
          ctx.drawImage(vImg, vx, vy, vw, vh);
          ctx.restore();
        }
      }

      // 右下：史诗结语滚动字幕区
      if (f.scrollLines.length) {
        const sx = 768, sy = 382, sw = 446, sh = 276;
        ctx.save();
        roundRect(ctx, sx, sy, sw, sh, 12);
        ctx.fillStyle = "rgba(8, 15, 28, 0.84)";
        ctx.fill();
        ctx.strokeStyle = "rgba(218, 178, 102, 0.45)";
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.beginPath();
        ctx.rect(sx + 16, sy + 16, sw - 32, sh - 32);
        ctx.clip();

        ctx.fillStyle = "#f2e2be";
        ctx.font = `500 20px ${UI_FONT}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        for (let i = 0; i < f.scrollLines.length; i++) {
          const ly = sy + sh - f.scrollY + i * 36;
          if (ly > sy - 40 && ly < sy + sh + 10) {
            ctx.fillText(f.scrollLines[i], sx + 24, ly);
          }
        }
        ctx.restore();
      }

      if (f.castEntry && f.showCast) {
        const cImg = this.getArtImg(f.castEntry);
        if (cImg) {
          ctx.save();
          ctx.imageSmoothingEnabled = (cImg.naturalWidth || 192) > 192;
          ctx.drawImage(cImg, 780, 440, 384, 160);
          ctx.restore();
        }
      }

      if (f.showFin) {
        ctx.save();
        ctx.fillStyle = "rgba(6, 13, 24, 0.76)";
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        const f1 = this.getArtImg(this.endingEntry(57));
        const f2 = this.getArtImg(this.endingEntry(58));
        if (f1) ctx.drawImage(f1, (VIEW_W - 416) / 2, 160, 416, 224);
        if (f2) ctx.drawImage(f2, (VIEW_W - 544) / 2, 410, 544, 208);
        ctx.fillStyle = "#d9c293";
        ctx.font = `500 16px ${MONO_FONT}`;
        ctx.textAlign = "center";
        ctx.fillText("按任意键结束", VIEW_W / 2, 656);
        ctx.restore();
      }
    }

    ctx.restore();
  }

  // ---- 结局主入口 (与 MainExit 参数校验协议一致) ----
  async run({ v3 = 0, v4 = 0, v5 = 0, name = new Uint8Array([0]) } = {}) {
    this.scr.wideDialog = null;
    this.scr.wideOverlays.length = 0;
    this.scr.setAtmosphere?.({ active: false });
    this.scr.clear(0);

    this.sw(0x1fc2, v3);
    this.sw(0x1fd4, v4);
    const chk = v5 & 0xffff;
    let ax = (chk - 0x1465) & 0xffff;
    if (!(ax & 0x7f) && (ax >>= 6) <= 0x0e) {
      const c = [2, 3, 0, 1, -1, -1, 4, 5][ax >> 1];
      if (c >= 0) this.sw(0x1fc2, c);
    }
    for (const [k, nat, v] of [
      [0x9565, 0, 0x100],
      [0x95e4, 1, 0x101],
      [0x9466, 3, 0x102],
      [0x94e0, 5, 0x103],
      [0x9761, 4, 0x104],
      [0x97e7, 2, 0x105],
    ]) {
      if (chk === k && this.w(0x1fd4) === nat) this.sw(0x1fc2, v);
    }
    if (((((this.w(0x1fc2) << 7) | this.w(0x1fd4)) ^ 0x1565) & 0xffff) !== chk) {
      this.flushKeys();
      await this.waitInput();
      return { exit: "check" };
    }

    // 拷贝主角名与姓到 DS:1fc6 / DS:202e (供 ending_pro.js 与 f155d 读取)
    let p = 0, i = 0;
    while (name[p] !== 0x20 && name[p] !== undefined) {
      if (i >= 0x0c) break;
      this.sb(0x1fc6 + i, name[p]); p++; i++;
      this.sb(0x1fc6 + i, name[p] ?? 0); p++; i++;
    }
    this.sb(0x1fc6 + i, 0); p++;
    i = 0;
    while (name[p]) {
      if (i >= 0x0c) break;
      this.sb(0x202e + i, name[p]); p++; i++;
      this.sb(0x202e + i, name[p] ?? 0); p++; i++;
    }
    this.sb(0x202e + i, 0);
    if (this.b(0x1fc3)) {
      this.sw(0x0042, 0);
      this.sb(0x1fc3, 0);
    }

    const c = this.w(0x1fc2);
    for (let idx = 0; idx < 5; idx++) {
      const handle = idx + 1;
      this.sw(0x1fd6 + 2 * idx, handle);
      const base = Math.max(0, Math.min(5, c)) * 5;
      this.eventSlots[handle] = { eventPic: { hero: EVENT_FILES[base + idx], idx: EVENT_ENTRIES[base + idx] } };
    }

    await this.preloadAssets(c);
    this.scr.wideRenderer = ctx => this.renderWide(ctx);

    try {
      await this.playSequence();
    } finally {
      this.musicFlag(0);
      await this.waitInput();
      await this.fadeAlpha(1, 0, 12);
      this.scr.wideRenderer = null;
      this.scr.clear(0);
    }
    return { exit: "end" };
  }

  async playSequence() {
    this.sb(0x1ff6, 1);
    const isScenario = !!this.w(0x0042);
    const c = Math.max(0, Math.min(5, this.w(0x1fc2)));

    // 1. 序幕对话
    await this.playSong(0);
    this.bgEntry = this.endingEntry(56);
    await this.fadeAlpha(0, 1, 14);
    if (isScenario) {
      await PROLOGUES[c](this);
    } else {
      const S = () => this.str(0x1fc6), N = () => this.str(0x202e);
      await this.talkTop(this.w(0x1fd4) + 6, 0x0cf7, S(), N());
      await this.talkBottom(c, 0x0d24);
      await this.talkTop(this.w(0x1fd4) + 6, 0x0d2f, S());
      await this.talkBottom(c, 0x0d81);
      await this.finalWords(0x0d8e, S(), N());
    }
    this.musicFade(0x14);
    await this.fadeAlpha(1, 0, 14);
    await this.closeAll();

    // 2. 剧本结局后日谈 5 段 (插图 + 文本)
    await this.playSong(1);
    if (isScenario) {
      this.bgEntry = this.endingEntry(7);
      await this.fadeAlpha(0, 1, 14);
      for (let idx = 0; idx < 5; idx++) {
        const base = c * 5;
        const picEntry = this.art?.manifest?.events?.[`event${EVENT_FILES[base + idx]}`]?.[EVENT_ENTRIES[base + idx]] ?? null;
        const lines = [];
        for (let j = 0; j < 9; j++) {
          const si = (j + (base + idx) * 9) * 2;
          lines.push(this.decodeCstr(this.w(0x1a9e + si)));
        }
        this.epilogueSlide = { picEntry, lines, revealed: 0 };
        for (let j = 1; j <= lines.length; j++) {
          this.epilogueSlide.revealed = j;
          if (await this.waitOrKey(18)) {
            this.epilogueSlide.revealed = lines.length;
            break;
          }
        }
        await this.waitOrKey(180);
      }
      this.epilogueSlide = null;
      await this.fadeAlpha(1, 0, 12);
    }

    // 3. 终章大画面 + 结语字幕滚动 + 7 位主角剪影轮播 + FIN
    this.bgEntry = null;
    const scrollLines = CREDIT_OFFSETS.map(o => this.decodeCstr(o));
    const finale = this.finaleView = {
      mainEntry: this.endingEntry(HERO_SCENE_MAIN[c]),
      altEntry: this.endingEntry(HERO_SCENE_ALT[c]),
      altAlpha: 0,
      vignetteEntry: this.endingEntry(0),
      vignetteAlpha: 0,
      castEntry: this.endingEntry(53),
      showCast: false,
      scrollLines,
      scrollY: 0,
      showFin: false,
    };
    await this.fadeAlpha(0, 1, 16);

    const totalScrollPx = scrollLines.length * 36 + 260;
    const stepCount = 560;
    for (let step = 0; step < stepCount; step++) {
      finale.scrollY = (totalScrollPx * step) / stepCount;
      const vIdx = Math.min(6, Math.floor((step * 7) / stepCount));
      finale.vignetteEntry = this.endingEntry(vIdx);
      const segProgress = ((step * 7) / stepCount) - vIdx;
      finale.vignetteAlpha = segProgress < 0.12 ? segProgress / 0.12 : segProgress > 0.88 ? (1 - segProgress) / 0.12 : 1;
      if (await this.waitOrKey(2)) {
        finale.scrollY = totalScrollPx;
        break;
      }
    }
    finale.vignetteAlpha = 0;
    for (let a = 0; a <= 16; a++) {
      finale.altAlpha = a / 16;
      if (await this.waitOrKey(2)) break;
    }
    finale.altAlpha = 1;
    finale.showCast = true;
    await this.waitOrKey(120);
    this.musicFade(0x78);
    finale.showFin = true;
  }
}

// 加载结局数据 (纯 JSON；图像由 ArtRegistry 标准 PNG 提供)
export async function loadEndingData(ASSETS, _loadBinaryOrJson, maybeLoadJSON) {
  const rdJson = typeof maybeLoadJSON === "function" ? maybeLoadJSON : _loadBinaryOrJson;
  return rdJson(`${ASSETS}/data/ending.json`);
}
