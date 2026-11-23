// cpucost.js — 原版在 DOSBox (core=normal, cycles=N) 下的執行耗時模型 (RE_NOTES 第 32 節)
// 原版的節奏 = 程式設定的計時等待 + 程式本身在慢 CPU 上執行的時間; 瀏覽器裡後者幾乎是 0。
// 這裡依量測得到的原版週期數 (core/cpucost_table.js), 在對應的移植方法上「記帳」(CPU.charge), 並維護一個虛擬時鐘:
//   - 記帳時虛擬時鐘前進 週期 / (N × (1 − IRQ 佔用)) 毫秒;
//   - 計時器 (core/sys.js Timer) 以虛擬時鐘計算, 所以「設定計時器 → 執行慢的程式 → 等待」的重疊與原版相同;
//   - 每個輪詢點 (Sys.poll) 先睡到真實時間追上虛擬時鐘, 之後虛擬時鐘不落後於真實時間。
// 網址參數 ?cycles=N 換基準, ?cycles=0 關閉 (只保留原版設定的等待)。測試模式 (Timer virtual) 只累計 CPU.cyc, 不影響任何結果。
import { COST_TABLE } from "./cpucost_table.js";

export const CPU = {
  khz: 10500,           // 每毫秒週期數 (DOSBox cycles); 0 = 關閉
  irqLoad: 0,           // 目前 IRQ0 (FMDRV) 佔用的比例
  irqLoadMusic: 0.012,  // 播放音樂時 (量測見 RE_NOTES 32.5)
  irqLoadIdle: 0.0008,  // 不播放時 (291.3 Hz 的計時中斷本身)
  cyc: 0,               // 累計的模型週期
  v: 0,                 // 虛擬時鐘 (毫秒, performance.now 基準)
  charge(n) {
    this.cyc += n;
    if (this.khz) this.v += n / (this.khz * (1 - this.irqLoad));
  },
  real() { return typeof performance !== "undefined" ? performance.now() : Date.now(); },
  // 虛擬時鐘目前值 (不落後於真實時間)
  now() {
    const r = this.real();
    if (!this.khz) return r;
    if (this.v < r) this.v = r;
    return this.v;
  },
  // 輪詢點: 先等真實時間追上虛擬時鐘, 再讓出執行緒 (瀏覽器處理輸入與畫面)
  async sync() {
    const d = this.khz ? this.v - this.real() : 0;
    await new Promise(res => setTimeout(res, d > 1 ? Math.floor(d) : 1));
    if (this.khz && this.v < this.real()) this.v = this.real();
  },
  setMusic(on) { this.irqLoad = on ? this.irqLoadMusic : this.irqLoadIdle; },
  // ?cycles=N
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

// 依記帳表包裝類別方法 (呼叫時先記帳, 不改變行為); classes = { 類別名: 類別 }
export function installCostModel(classes, table = COST_TABLE) {
  for (const [cls, name, k] of table) {
    const C = classes[cls]; if (!C) continue;
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
