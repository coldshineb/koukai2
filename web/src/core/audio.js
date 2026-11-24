// audio.js — BGM (PS 版音源, mp3)
// 原版: 0:9670(曲目) 以 DS:8c20 表把遊戲內曲目編號 (0..0x17) 轉成 FMDRV 的樂曲編號再播放 (同曲播放中則不重播, 否則先淡出); 0:9712(0x14) 淡出停止。
// 遊戲內曲目編號 -> PS 版音檔 的對應在 assets/data/bgm.json ("songs", 依旋律比對與播放場景逆向決定, 見 docs/RE_NOTES.md 第 23 節)。
//   值為 null = 原版送 FMDRV 樂曲 0 (停止); "once" 列出的曲目原版播放後以 96eb(0) 關閉重播, 只播一次 (海戰勝利短曲 0x15)。
import { loadJSON } from "./assets.js";

export const SONG_TO_DRIVER = [21, 19, 22, 18, 2, 3, 4, 7, 6, 5, 11, 9, 8, 10, 1, 13, 14, 15, 16, 20, 17, 12, 0, 0];  // DS:8c20

export class BGM {
  constructor(base) {
    this.base = base; this.el = typeof Audio !== "undefined" ? new Audio() : null; if (this.el) this.el.loop = true; this.cur = null; this.enabled = true;
    this.song = 0xff;                    // [8c1e] 目前曲目 (遊戲內編號; 9670 寫入, 環境設定打開 BGM 時重播它)
    this.optionOff = null;               // () => 環境設定「BGM」關閉 ([0ca4] bit2 = 0); title.js init 設定
    if (this.el) this.el.addEventListener?.("ended", () => { this.cur = null; this.done(); if (this.next) this.start(); });   // 只播一次的曲子播完 = 停止
  }
  async init() { this.map = await loadJSON(this.base + "/data/bgm.json"); return this; }
  // 原版 0:9670: 同一首播放中不重播; 不同的曲子播放中 → 先淡出, 等驅動回報停止 (AH=03) 後才播放新曲。
  //   回傳的 Promise 在新曲開始播放時完成 (呼叫端要像原版一樣等待時 await 它)
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
    this.cur = f; this.el.loop = loop; this.el.src = this.base + "/../bgm/" + f; this.el.currentTime = 0; this.el.volume = 1;
    this.el.play().catch(() => { this.pending = true; });
  }
  // 目前的曲子停止 (含淡出完成) 時完成
  stopped() {
    if (!this.cur || !this.el || this.el.paused) return Promise.resolve();
    return new Promise(r => (this.waiters ??= []).push(r));
  }
  done() { const w = this.waiters || []; this.waiters = []; for (const r of w) r(); }
  // 0:9670: 編號 ≤ 0x17 時 [8c1e] = 編號; BGM 關閉時只記下編號、不播放 ([8c1f] = FF; 之後打開 BGM 由環境設定 213c5 重播)
  playSong(id) {
    if (id <= 0x17) { this.song = id; if (this.optionOff?.()) return Promise.resolve(); }
    const songs = this.map.songs, k = String(id);
    if (songs && k in songs) {
      if (!songs[k]) { this.stop(); return Promise.resolve(); }                              // FMDRV 樂曲 0: 停止
      return this.playFile(songs[k], !(this.map.once || []).includes(id));
    }
    return this.playFile(this.map.tracks?.[String(SONG_TO_DRIVER[id])]);
  }
  play(id) { return this.playSong(id); }
  resume() { if (this.pending && this.el) { this.pending = false; this.el.play().catch(() => {}); } }
  // 0:9712 淡出停止 (外部呼叫時取消等待中的下一首)
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
