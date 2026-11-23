// cycle_realtime.js — 即時節奏 (秒數) 與流暢度的對照 (RE_NOTES 32.8 / 32.9)
//   原版: 模擬器以 DOSBox 時間執行 (cycle_measure.js 的 realtime: FMDRV 計時器 F0/F1 與垂直同步依 週期 / 10500 計算, 再扣 IRQ0 佔用);
//   移植版: 即時模式 (Sys virtual = false → Timer 用 CPU 的虛擬時鐘, Sys.poll = CPU.sync) + 記帳表 (installCostModel)。
//     「真實時間」用模擬時鐘 (S.RT_REAL = 1 時改用 Node 真的時鐘與 setTimeout, 不量流暢度):
//       - setTimeout(n) 在 max(n, 4) + 0.5..2 ms 後醒 (巢狀計時器下限 4 ms 與晚醒), 讓出 = 0.05 ms;
//       - 移植版 JS 本身的執行時間 = 記帳時間 × S.RT_JSFRAC (預設 0.2), 在每個輪詢點加上;
//       - rAF 60 Hz: 主執行緒閒著 (睡 / 讓出) 且到了畫格時間才畫, 每次畫 S.RT_RENDER_MS (預設 2) ms; 畫的內容依 CPU.frameGate (同 main.js)。
//     S.RT_HICCUP = [機率, ms]: 每個輪詢點以此機率多卡 ms (壓力測試)。
//     S.RT_KHZ = 0: 沒有耗時模型的移植版 (只有原版設定的等待)。S.RT_BEFORE = 1: 模擬 32.9 修改前 (沒有快照延後顯示, LAG_MAX = 100)。
// 路線: 預設 sea_depart_route.js (里斯本出港) → 按 '4' (向西, S.RT_HEADING) → 之後不再按鍵, 海上航行到出港天數 [2e18] = S.RT_DAYS + 1;
//   兩邊同時寫入 [0ca6] 海上速度 = S.RT_SPEED (預設 5), S.RT_MOVE 有給時 [0ca9] 海上移動值。
//   S.RT_FILES = [路線檔..., "port_tests.js"] (+ S.RT_SET 設定): 改跑其他路線, 只有移植版是即時模式 (原版照常, 不量秒數), 量流暢度用。
// 結果: session.rtResult (也推入 S.rtResults)
// 用法 (先載入 emu_boot.js、ui_bundle.js、runf.js): S.RT_SPEED = 5; S.RT_DAYS = 2; await S.RUNF["cycle_realtime.js"]();
(async function () {
const S = session, U = S.UI, CPU = U.CPU;
if (!S.DOSBoxCycles) await S.RUNF["cycles.js"]();
const sea = !S.RT_FILES, days = S.RT_DAYS ?? 2, speed = S.RT_SPEED ?? 5, TICK = 4096 * 256 / (1193181.67 * 53) * 1000;
const keep = { real: CPU.real, sleepFn: CPU.sleepFn, yieldFn: CPU.yieldFn, khz: CPU.khz, sync: CPU.sync, LAG_MAX: CPU.LAG_MAX, capture: CPU.capture, seaTick: U.SeaScene.prototype.seaTick };
const base = S.__regBase ??= new Set(Object.keys(S));
for (const k of Object.keys(S)) if (!base.has(k) && /^[A-Z][A-Z0-9_]*$/.test(k) && !/^RT_/.test(k)) delete S[k];
S.QUIET = 1;
let seen0E = false;
if (sea) {
  S.SEA_POKE = [[0x0ca6, speed], ...(S.RT_MOVE !== undefined ? [[0x0ca9, S.RT_MOVE]] : [])];
  // 出港後先按一次航向鍵 (S.RT_HEADING, 預設 '4' = 向西; null = 不按, 停在港外), 之後不再按鍵
  const HD = S.RT_HEADING === undefined ? [0x05, 0x34] : S.RT_HEADING;
  S.SEA_KEYS = HD ? [{ mouse: {} }, { mouse: {} }, HD, { mouse: {} }] : [{ mouse: {} }]; S.EMU_MS = S.RT_EMU_MS || 900000;
  // 原版: 出港天數 [2e18] 回到 0 之後到 RT_DAYS+1 時結束
  S.CM = { max: 10500, realtime: true, noLog: true, irqLoad: 0.012, marks: [0x2e18, 0x0535], gapAfter: [HD ? 17 : 14, 1e9],
    stop: (mem, d) => { const v = mem[d + 0x2e18]; if (v === 0) seen0E = true; return seen0E && v >= days + 1; } };
  await S.RUNF["cycle_measure.js"]();
} else Object.assign(S, S.RT_SET || {});
// ---- 移植版: 模擬時鐘 + rAF ----
const sim = { t: 1000, seed: 12345 }, FR = 1000 / 60, JSF = S.RT_JSFRAC ?? 0.2, RMS = S.RT_RENDER_MS ?? 2;
const rnd = () => (sim.seed = (Math.imul(sim.seed, 1103515245) + 12345) >>> 0) / 4294967296;
let ticksDone = 0, nextF = 0, lastTick = -1, lastCyc = 0;
const fr = { renders: 0, adv: [0, 0, 0, 0], advMax: 0, earlyMax: 0, early1: 0, earlyTick: 0, seaRenders: 0 };
const render = () => {
  const g = CPU.frameGate(sim.t);
  if (g !== null) {
    const tick = g === "live" ? ticksDone : g.snap.tick, cv = g === "live" ? CPU.now() : g.due, early = cv - sim.t;
    fr.renders++;
    if (early > fr.earlyMax) fr.earlyMax = early;
    if (early > 1) fr.early1++;
    if (early > TICK) fr.earlyTick++;
    if (lastTick >= 0 && ticksDone > 0) { const a = tick - lastTick; fr.adv[Math.min(3, Math.max(0, a))]++; if (a > fr.advMax) fr.advMax = a; fr.seaRenders++; }
    lastTick = tick;
  }
  sim.t += RMS;
};
const idleUntil = end => {                                       // 主執行緒閒到 end: 途中到了畫格時間就畫
  if (!nextF) nextF = Math.ceil(sim.t / FR) * FR;
  while (nextF <= end) { if (nextF > sim.t) sim.t = nextF; render(); nextF += FR; while (nextF <= sim.t) nextF += FR; }
  if (end > sim.t) sim.t = end;
};
if (!S.RT_REAL) {
  CPU.real = () => sim.t;
  CPU.sleepFn = async ms => { idleUntil(sim.t + Math.max(Math.floor(ms), 4) + 0.5 + 1.5 * rnd()); };
  CPU.yieldFn = async () => { idleUntil(sim.t + 0.05); };
  // S.RT_HICCUP = [機率, ms]: 每個輪詢點以此機率多卡 ms (瀏覽器 GC / 重畫 / 其他分頁; 壓力測試)
  const HIC = S.RT_HICCUP;
  CPU.sync = async function () { sim.t += (CPU.cyc - lastCyc) / 10500 * JSF + (HIC && rnd() < HIC[0] ? HIC[1] : 0); lastCyc = CPU.cyc; return keep.sync.call(CPU); };
  CPU.capture = () => ({ tick: ticksDone });
}
if (S.RT_BEFORE) { CPU.capture = null; CPU.LAG_MAX = 100; }
CPU.pend.length = 0;
CPU.khz = S.RT_KHZ ?? 10500;
U.installCostModel(U);
const js = []; let seen0J = false, lastJ = -1, polls = 0;
U.SeaScene.prototype.seaTick = async function (...a) {
  const d = this.st.u8(0x2e18), t = this.c.rt ? this.c.rt.time : -1;
  if (d === 0) seen0J = true;
  if (d * 1000 + t !== lastJ) { lastJ = d * 1000 + t; js.push([d, t, CPU.real(), CPU.v]); }
  if (sea && seen0J && d >= days + 1) { S.rtFleetJ = [this.st.u16(0x2e76), this.st.u16(0x2e78), this.st.u8(0x2e76 + 0x1a)]; throw new Error("STOP"); }
  const r = await keep.seaTick.apply(this, a); ticksDone++; return r;
};
S.JS_SYS = { virtual: false, poll: async () => { polls++; await CPU.sync(); } };
const t0 = Date.now(); let tStart = 0;
// 移植版從標題開始時才啟動虛擬時鐘 (原版先跑完, 期間的真實時間不算)
const run0 = U.Title.prototype.run;
U.Title.prototype.run = function (...a) { CPU.start(); lastCyc = CPU.cyc; tStart = CPU.real(); return run0.apply(this, a); };
let err = null;
try { for (const f of (sea ? ["sea_depart_route.js", "port_tests.js"] : S.RT_FILES)) await S.RUNF[f](); } catch (e) { err = String(e && e.stack || e).split("\n")[0]; }
const tEnd = CPU.real();
Object.assign(CPU, { real: keep.real, sleepFn: keep.sleepFn, yieldFn: keep.yieldFn, khz: keep.khz, sync: keep.sync, LAG_MAX: keep.LAG_MAX, capture: keep.capture }); CPU.active = false; CPU.pend.length = 0;
U.SeaScene.prototype.seaTick = keep.seaTick; U.Title.prototype.run = run0; delete S.JS_SYS; S.EMU_DONE = false;
// 原版: marks [位址, 值, ms] → 每個 (天, 時刻) 第一次出現的時間
const emu = []; { let d = -1, t = -1; for (const [a, v, ms] of S.cmMarks || []) { if (a === 0x2e18) d = v; else t = v; if (d >= 0 && t >= 0 && (!emu.length || emu[emu.length - 1][0] !== d || emu[emu.length - 1][1] !== t)) emu.push([d, t, ms]); } }
if (sea) S.cmUninstall?.();
S.cmMarks = null;
const span = (A, ti) => {                                         // 出港後第 1 天開始 → 第 days+1 天開始
  const i0 = A.findIndex(x => x[0] === 1);                       // 原版的記錄只在改變時寫入 (沒有第 0 天的項), 以第 1 天第一次出現為起點
  if (i0 < 0) return null;
  const i1 = A.findIndex((x, i) => i > i0 && x[0] === days + 1), end = i1 >= 0 ? A[i1] : A[A.length - 1], n = (i1 >= 0 ? i1 : A.length - 1) - i0;
  return { sec: +((end[ti] - A[i0][ti]) / 1000).toFixed(3), ticks: n, msPerTick: +((end[ti] - A[i0][ti]) / Math.max(1, n)).toFixed(2), complete: i1 >= 0 };
};
const smooth = S.RT_REAL ? null : { renders: fr.renders, seaRenders: fr.seaRenders, advanceHist: fr.adv, advanceMax: fr.advMax, earlyMaxMs: +fr.earlyMax.toFixed(1), earlyOver1ms: fr.early1, earlyOverTick: fr.earlyTick };
const res = { route: sea ? `海上 速度 ${speed}${S.RT_MOVE !== undefined ? " 移動值 " + S.RT_MOVE : ""}` : (S.RT_NAME || S.RT_FILES.join(" → ")), before: !!S.RT_BEFORE, khz: S.RT_KHZ ?? 10500, real: !!S.RT_REAL, err: err === "Error: STOP" ? null : err,
  emu: sea ? span(emu, 2) : null, js: sea ? span(js, 2) : null, jsTotalSec: +((tEnd - tStart) / 1000).toFixed(3), polls, wallSec: +((Date.now() - t0) / 1000).toFixed(1), fleetJ: S.rtFleetJ, smooth,
  perDay: sea ? [emu, js].map(A => { const o = []; for (let d = 1; d <= days; d++) { const a = A.find(x => x[0] === d), b = A.find(x => x[0] === d + 1); if (a && b) o.push(+((b[2] - a[2]) / 1000).toFixed(3)); } return o; }) : null };
S.rtResult = res; (S.rtResults ??= []).push(res);
const sm = smooth ? ` | 流暢度: 畫面 ${smooth.renders} 次, 每次畫面推進的海上時刻 [0,1,2,≥3] = [${smooth.advanceHist}] (最多 ${smooth.advanceMax}), 先顯示後凍結 最長 ${smooth.earlyMaxMs} ms, 超過 1 tick ${smooth.earlyOverTick} 次` : "";
console.log(`[realtime] ${res.route}${res.before ? " (修改前)" : ""}, cycles ${res.khz}${res.real ? " (真實時鐘)" : ""}: ` +
  (sea ? `出港第 1 天 → 第 ${days + 1} 天 原版 ${res.emu?.sec}s (${res.emu?.ticks} 個時刻, 每時刻 ${res.emu?.msPerTick} ms), 移植版 ${res.js?.sec}s (${res.js?.ticks} 個時刻, 每時刻 ${res.js?.msPerTick} ms)` +
    `${res.emu && res.js ? `, 差 ${(100 * (res.js.sec - res.emu.sec) / res.emu.sec).toFixed(2)}%` : ""}` : `移植版 ${res.jsTotalSec}s`) + sm + (res.err ? " ERROR " + res.err : ""));
})();
