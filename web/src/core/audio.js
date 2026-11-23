// audio.js — BGM (PS 版音源, mp3)
// 原版: 0:9670(曲目) 以 DS:8c20 表把遊戲內曲目編號 (0..0x17) 轉成 FMDRV 的樂曲編號再播放; 0:9712(0x14) 淡出停止。
// 遊戲內曲目編號 -> PS 版音檔 的對應在 assets/data/bgm.json ("songs"), 目前為暫定值, 待逐曲比對後校正。
import { loadJSON } from "./assets.js";

export const SONG_TO_DRIVER = [21, 19, 22, 18, 2, 3, 4, 7, 6, 5, 11, 9, 8, 10, 1, 13, 14, 15, 16, 20, 17, 12, 0, 0];  // DS:8c20

export class BGM {
  constructor(base) { this.base = base; this.el = typeof Audio !== "undefined" ? new Audio() : null; if (this.el) this.el.loop = true; this.cur = null; this.enabled = true; }
  async init() { this.map = await loadJSON(this.base + "/data/bgm.json"); return this; }
  playFile(f) {
    if (!this.el || !this.enabled || !f || f === this.cur) return;
    this.cur = f; this.el.src = this.base + "/../bgm/" + f; this.el.currentTime = 0; this.el.volume = 1;
    this.el.play().catch(() => { this.pending = true; });
  }
  playSong(id) {
    const f = this.map.songs?.[String(id)] ?? this.map.tracks?.[String(SONG_TO_DRIVER[id])];
    this.playFile(f);
  }
  play(id) { this.playSong(id); }
  resume() { if (this.pending && this.el) { this.pending = false; this.el.play().catch(() => {}); } }
  fadeOut() {
    if (!this.el || !this.cur) return;
    const el = this.el, step = () => { el.volume = Math.max(0, el.volume - 0.05); if (el.volume > 0) setTimeout(step, 50); else { el.pause(); this.cur = null; } };
    step();
  }
  stop() { if (this.el) this.el.pause(); this.cur = null; }
}
