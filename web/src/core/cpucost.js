// cpucost.js — 原版在 DOSBox (core=normal, cycles=N) 下的執行耗時模型 (RE_NOTES 第 32 節)
// 原版的節奏 = 程式設定的計時等待 + 程式本身在慢 CPU 上執行的時間; 瀏覽器裡後者幾乎是 0。
// 這裡依量測得到的原版週期數 (core/cpucost_table.js), 在對應的移植方法上「記帳」(CPU.charge), 並維護一個虛擬時鐘:
//   - 記帳時虛擬時鐘前進 週期 / (N × (1 − IRQ 佔用)) 毫秒;
//   - 計時器 (core/sys.js Timer) 以虛擬時鐘計算, 所以「設定計時器 → 執行慢的程式 → 等待」的重疊與原版相同;
//   - 每個輪詢點 (Sys.poll → CPU.sync) 先睡到真實時間追上虛擬時鐘; 等計時器時睡到下一次減一; 等玩家輸入時虛擬時鐘跟著真實時間走。
// 網址參數 ?cycles=N 換基準, ?cycles=0 關閉 (只保留原版設定的等待)。測試模式 (Timer virtual) 只累計 CPU.cyc, 不影響任何結果。
// 接入: main.js 在片頭結束後 installCostModel(...) + CPU.start(); 同步規則見 RE_NOTES 32.8。
import { COST_TABLE } from "./cpucost_table.js";

// 讓出執行緒: 不需要睡時以 MessageChannel (0 延遲), 否則 setTimeout; 測試可換成模擬時鐘 (CPU.sleepFn / CPU.yieldFn)
const _mc = typeof MessageChannel !== "undefined" ? new MessageChannel() : null, _mq = [];
if (_mc) { _mc.port1.onmessage = () => _mq.shift()?.(); _mc.port1.unref?.(); _mc.port2.unref?.(); }
const sleepMs = ms => new Promise(r => setTimeout(r, Math.max(0, Math.floor(ms))));
const yieldNow = () => _mc ? new Promise(r => { _mq.push(r); _mc.port2.postMessage(0); }) : sleepMs(0);

export const CPU = {
  khz: 10500,           // 每毫秒週期數 (DOSBox cycles); 0 = 關閉
  irqLoad: 0.012,       // 目前 IRQ0 (FMDRV) 佔用的比例
  irqLoadMusic: 0.012,  // 播放音樂時 (量測見 RE_NOTES 32.3)
  irqLoadIdle: 0.0008,  // 不播放時 (291.3 Hz 的計時中斷本身)
  cyc: 0,               // 累計的模型週期
  v: 0,                 // 虛擬時鐘 (毫秒, performance.now 基準) — 原版程式「現在」的時間
  active: false,        // start() 之後才以虛擬時鐘計時 (片頭 OPEN.EXE 不記帳, 之前一律用真實時間)
  wakeAt: 0,            // Timer.get 設定: 等待中的計時器下一次減一的虛擬時間 (sync 用完即清)
  idle: 0,              // 連續「不超前、沒有計時器」的輪詢次數 (≥ 3 = 在等玩家輸入)
  musicProbe: null,     // () => BGM 是否在播放 (main.js 設定)
  LAG_MAX: 8,           // 真實時間領先虛擬時鐘的上限 (ms, < 1 tick): 只吸收 setTimeout 晚醒, 不追趕 (32.9 B)
  capture: null,        // () => 畫面快照 (main.js 設定); null = 不延後顯示
  pend: [],             // 等虛擬時間到期才顯示的快照 [{ due, snap }] (32.9 A)
  sleepFn: sleepMs, yieldFn: yieldNow,
  charge(n) {
    this.cyc += n;
    if (this.khz) this.v += n / (this.khz * (1 - this.irqLoad));
  },
  real() { return typeof performance !== "undefined" ? performance.now() : Date.now(); },
  start() { this.active = true; this.v = this.real(); this.wakeAt = 0; this.idle = 0; },
  // 計時器用的「現在」: 虛擬時鐘 (關閉或 start 之前 = 真實時間)
  now() { return this.active && this.khz ? this.v : this.real(); },
  // 輪詢點 (Sys.poll) — 規則見 RE_NOTES 32.8
  async sync() {
    if (this.musicProbe) this.irqLoad = this.musicProbe() ? this.irqLoadMusic : this.irqLoadIdle;
    const w = this.wakeAt; this.wakeAt = 0;
    let r = this.real();
    if (!this.active || !this.khz) {                     // 只保留原版設定的等待 (真實時間)
      const d = w ? w - r : 1;
      await (d >= 1 ? this.sleepFn(d) : this.yieldFn());
      return;
    }
    if (r - this.v > this.LAG_MAX) this.v = r - this.LAG_MAX;   // 落後超過上限: 不追趕 (否則之後的等待直接通過, 連跑多個時刻)
    const ahead = this.v - r;
    if (ahead >= 1) {                                    // 晚醒的部分留在落後量裡, 下一次記帳先抵掉
      this.idle = 0; this.hold(this.v);                  // 剛畫好的畫面等到虛擬時間到了才顯示
      await this.sleepFn(ahead); return;
    }
    if (w > this.v) {                                    // 計時器在等: 睡到下一次減一, 之後 v = 該時刻 (不是醒來的時間)
      this.idle = 0;
      if (w - r >= 1) await this.sleepFn(w - r); else await this.yieldFn();
      if (this.real() >= w && this.v < w) this.v = w;
      return;
    }
    if (++this.idle >= 3) {                              // 在等玩家輸入: 虛擬時鐘跟著真實時間走
      this.v = Math.max(this.v, r);
      await this.sleepFn(4);
      this.v = Math.max(this.v, this.real());
      return;
    }
    await this.yieldFn();
  },
  // 超前睡眠前: 拍下目前畫面, 到期 (due = 睡醒的虛擬時間) 才顯示; 已到期的只留最新一張
  hold(due) {
    if (!this.capture) return;
    const p = this.pend, now = this.real();
    while (p.length > 1 && p[1].due <= now) p.shift();
    p.push({ due, snap: this.capture() });
  },
  // 畫格 (rAF) 時呼叫: 回傳 { due, snap } = 顯示這張快照; "live" = 顯示目前畫面; null = 維持上一張 (還有快照沒到期)
  frameGate(now = this.real()) {
    const p = this.pend; let s = null;
    while (p.length && p[0].due <= now) s = p.shift();
    return s || (p.length ? null : "live");
  },
  setMusic(on) { this.irqLoad = on ? this.irqLoadMusic : this.irqLoadIdle; },
  // ?cycles=N (0 = 關閉)
  configure(search) {
    const m = /[?&]cycles=(\d+)/.exec(search || "");
    if (m) this.khz = +m[1];
  },
};

// 工作量 (與量測腳本 tools/emu/cycle_measure.js 相同的定義)
const pxArea = a => (Math.abs(a[2] - a[0]) + 1) * (Math.abs(a[3] - a[1]) + 1) / 8;
const imgArea = (a, t) => { const o = t.offsets[a[1]]; return o === undefined ? 0 : (t.dat[o] | (t.dat[o + 1] << 8)) * (t.dat[o + 2] | (t.dat[o + 3] << 8)); };
export const COST_FEATURES = {
  a: {                                                  // 面積
    "Screen.putPlanar": a => a[2] * a[3], "Screen.tile": a => a[2] * a[3], "Screen.fillCols": a => a[2] * a[3],
    "Screen.fillRectPx": pxArea, "Screen.fillRectPxPlanes": pxArea, "Screen.xorRect": pxArea,
    "Screen.rectOutline": a => Math.abs(a[2] - a[0]) + Math.abs(a[3] - a[1]),
    "Screen.line": a => Math.max(Math.abs(a[2] - a[0]), Math.abs(a[3] - a[1])),
    "Screen.glyphMode": a => a[2] * a[3], "Screen.glyph": a => a[2] * a[3], "Screen.blit": a => a[3] * a[4],
    "WindowSystem.save": a => a[2] * a[3], "WindowSystem.restoreRows": a => (a[0]?.w || 0) * a[3],
    "WindowSystem.frame": a => a[2] * a[3], "WindowSystem.open": a => a[2] * a[3],
    "GraphDat.draw": imgArea, "GraphDat.draw8": imgArea,
  },
  p: {                                                  // 長度 (高度或周長)
    "WindowSystem.frame": a => a[2] + a[3], "WindowSystem.open": a => a[2] + a[3], "WindowSystem.save": a => a[3], "Screen.putPlanar": a => a[3],
  },
};

// 「屬性=」項目不另記的情況: SeaScene.enterSea (851f) 的固定耗時已含一次 849a 換 WORLDMAP 項
const PROP_SKIP_IN = { "SeaScene.item": "enterSea" };

// 依記帳表包裝類別方法 (呼叫時先記帳, 不改變行為); classes = { 類別名: 類別 }
export function installCostModel(classes, table = COST_TABLE) {
  for (const [cls, name, k] of table) {
    const C = classes[cls]; if (!C) continue;
    // "屬性=": 實例的這個屬性值改變時記帳 (原版在這時候做的事, 移植版只是一個指定; 例: SeaScene.item = 849a 換 WORLDMAP 項)
    //   規則與量測 (tools/emu/cycle_measure.js) 相同: 舊值已定義且新值不同時才算
    if (name.endsWith("=")) {
      const prop = name.slice(0, -1), slot = "\u0000" + prop, n = k.n || 0, skip = PROP_SKIP_IN[cls + "." + prop], inSkip = "\u0000in_" + skip;
      if (!C.prototype || Object.getOwnPropertyDescriptor(C.prototype, prop)) continue;
      Object.defineProperty(C.prototype, prop, { configurable: true,
        get() { return this[slot]; },
        set(v) { const o = this[slot]; if (o !== undefined && o !== v && !this[inSkip]) CPU.charge(n); this[slot] = v; } });
      if (skip && typeof C.prototype[skip] === "function") {        // 這個方法的固定耗時已含這件事: 方法 (同步部分) 執行中的改變不另記
        const f = C.prototype[skip];
        C.prototype[skip] = function (...a) { this[inSkip] = true; try { return f.apply(this, a); } finally { this[inSkip] = false; } };
      }
      continue;
    }
    const isStatic = typeof C[name] === "function" && !(C.prototype && Object.prototype.hasOwnProperty.call(C.prototype, name));
    const host = isStatic ? C : C.prototype, f = host[name];
    if (typeof f !== "function" || f.__cost) continue;
    const n = k.n || 0, ka = k.a || 0, kp = k.p || 0, kt = k.t || 0, key = cls + "." + name;
    const fa = ka && COST_FEATURES.a[key], fp = kp && COST_FEATURES.p[key];
    let g;
    if (kt && key === "Sys.mouseShow") g = function (...a) { const draw = this.mouse.present && this.mouse.visible === 0; const r = f.apply(this, a); if (draw) CPU.charge(kt); return r; };
    else if (kt && key === "Sys.mouseHide") g = function (...a) { if (this.mouse.present && this.mouse.visible === 1) CPU.charge(kt); return f.apply(this, a); };
    else if (!fa && !fp) g = function (...a) { CPU.charge(n); return f.apply(this, a); };
    else g = function (...a) { let c = n; try { if (fa) c += ka * (+fa(a, this) || 0); if (fp) c += kp * (+fp(a, this) || 0); } catch (e) { /* 參數不完整時只算固定部分 */ } CPU.charge(c); return f.apply(this, a); };
    g.__cost = true; g.__orig = f;
    host[name] = g;
  }
}
