// audio.js — BGM (PS 版音源, mp3)
// 原版: 0:9670(曲目) 以 DS:8c20 表把游戏内曲目编号 (0..0x17) 转成 FMDRV 的乐曲编号再播放 (同曲播放中则不重播, 否则先淡出); 0:9712(0x14) 淡出停止。
// 游戏内曲目编号 -> PS 版音档 的对应在 assets/data/bgm.json ("songs", 依旋律比对与播放场景逆向决定, 见 docs/RE_NOTES.md 第 23 节)。
//   值为 null = 原版送 FMDRV 乐曲 0 (停止); "once" 列出的曲目原版播放后以 96eb(0) 关闭重播, 只播一次 (海战胜利短曲 0x15)。
import { loadJSON } from "./assets.js";

export const SONG_TO_DRIVER = [21, 19, 22, 18, 2, 3, 4, 7, 6, 5, 11, 9, 8, 10, 1, 13, 14, 15, 16, 20, 17, 12, 0, 0];  // DS:8c20

export class BGM {
  constructor(base) {
    this.base = base; this.el = typeof Audio !== "undefined" ? new Audio() : null; if (this.el) this.el.loop = true; this.cur = null; this.enabled = true;
    this.volume = 0.8; this.muted = false;
    this.song = 0xff;                    // [8c1e] 目前曲目 (游戏内编号; 9670 写入, 环境设置打开 BGM 时重播它)
    this.optionOff = null;               // () => 环境设置「BGM」关闭 ([0ca4] bit2 = 0); title.js init 设置
    if (this.el) this.el.addEventListener?.("ended", () => { this.cur = null; this.done(); if (this.next) this.start(); });   // 只播一次的曲子播完 = 停止
  }
  get effectiveVolume() { return this.muted ? 0 : Math.max(0, Math.min(1, this.volume)); }
  setVolume(v) { this.volume = Math.max(0, Math.min(1, +v || 0)); if (this.el && !this.fading) this.el.volume = this.effectiveVolume; }
  setMuted(m) { this.muted = !!m; if (this.el && !this.fading) this.el.volume = this.effectiveVolume; }
  async init() { this.map = await loadJSON(this.base + "/data/bgm.json"); return this; }
  // 原版 0:9670: 同一首播放中不重播; 不同的曲子播放中 → 先淡出, 等驱动回报停止 (AH=03) 后才播放新曲。
  //   返回的 Promise 在新曲开始播放时完成 (调用端要像原版一样等待时 await 它)
  playFile(f, loop = true) {
    if (!this.el || !this.enabled || !f) return Promise.resolve();
    if (f === this.cur && !this.fading) return Promise.resolve();
    this.next = { f, loop };
    if (this.cur && !this.el.paused) { if (!this.fading) this.fade(false); return this.stopped(); }
    this.start();
    return Promise.resolve();
  }
  start() {
    const { f, loop } = this.next; this.next = null;
    this.cur = f; this.el.loop = loop; this.el.src = this.base + "/../bgm/" + f; this.el.currentTime = 0; this.el.volume = this.effectiveVolume;
    this.el.play().catch(() => { this.pending = true; });
  }
  // 目前的曲子停止 (含淡出完成) 时完成
  stopped() {
    if (!this.cur || !this.el || this.el.paused) return Promise.resolve();
    return new Promise(r => (this.waiters ??= []).push(r));
  }
  done() { const w = this.waiters || []; this.waiters = []; for (const r of w) r(); }
  // 0:9670: 编号 ≤ 0x17 时 [8c1e] = 编号; BGM 关闭时只记下编号、不播放 ([8c1f] = FF; 之后打开 BGM 由环境设置 213c5 重播)
  playSong(id) {
    if (id <= 0x17) { this.song = id; if (this.optionOff?.()) return Promise.resolve(); }
    const songs = this.map.songs, k = String(id);
    if (songs && k in songs) {
      if (!songs[k]) { this.stop(); return Promise.resolve(); }                              // FMDRV 乐曲 0: 停止
      return this.playFile(songs[k], !(this.map.once || []).includes(id));
    }
    return this.playFile(this.map.tracks?.[String(SONG_TO_DRIVER[id])]);
  }
  play(id) { return this.playSong(id); }
  resume() { if (this.pending && this.el) { this.pending = false; this.el.play().catch(() => {}); } }
  // 0:9712 淡出停止 (外部调用时取消等待中的下一首)
  fadeOut() { this.next = null; this.fade(true); }
  fade(cancelNext) {
    if (!this.el || !this.cur) { if (!cancelNext && this.next) this.start(); return; }
    const el = this.el, token = this.token = (this.token || 0) + 1;
    this.fading = true;
    const step = () => {
      if (token !== this.token) return;
      el.volume = Math.max(0, el.volume - 0.05);
      if (el.volume > 0) { setTimeout(step, 50); return; }
      el.pause(); this.cur = null; this.fading = false;
      this.done();
      if (this.next) this.start();
    };
    step();
  }
  stop() { this.token = (this.token || 0) + 1; this.next = null; this.fading = false; if (this.el) this.el.pause(); this.cur = null; this.done(); }
}
