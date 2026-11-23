// cycle_check.js — 耗時模型的端到端驗證 (RE_NOTES 32.8): 同一條按鍵路線上, 原版的週期 (cycles.js, DOSBox 0.72 規則) 與
//   移植版裝上記帳表 (installCostModel) 後累計的 CPU.cyc 比較。與擬合資料 (cycle_fit.py) 不同, 這裡用的是瀏覽器裡實際執行的包裝,
//   而且也包含「送鍵之後」的那一段 (按鍵觸發的處理)。
// 前提: 已載入 emu_boot.js、ui_bundle.js、runf.js
// 用法: await S.RUNF["cycle_check.js"](); await S.cycleCheck({ name, set: { S 的設定 }, files: [路線檔..., "port_tests.js"] }) → 結果物件 (也存入 S.ccResults)
"use strict";
(function () {
const S = session;
S.cycleCheck = async (T) => {
  const U = S.UI;
  if (!S.DOSBoxCycles) await S.RUNF["cycles.js"]();
  U.installCostModel(U);                                           // 只記帳 (測試模式的計時器是虛擬的), 已安裝時不重複
  const base = S.__regBase ??= new Set(Object.keys(S));
  for (const k of Object.keys(S)) if (!base.has(k) && /^[A-Z][A-Z0-9_]*$/.test(k)) delete S[k];
  Object.assign(S, T.set || {}); S.QUIET = 1;
  S.CM = { max: 10500 };
  await S.RUNF["cycle_measure.js"]();
  const log0 = console.log, lines = [];
  console.log = (...a) => lines.push(a.join(" "));
  let err = null;
  try { for (const f of T.files) await S.RUNF[f](); } catch (e) { err = String(e && e.stack || e).split("\n")[0]; } finally { console.log = log0; }
  const L = S.cmLog, E = L.E, J = L.J;
  S.cmUninstall();
  // 依 "K" (送鍵) 分組; 組內事件種類一致的才比較
  const groups = a => { const g = [[]]; a.forEach((e, i) => { if (e[0] === "K") g.push([]); else g[g.length - 1].push(i); }); return g; };
  const gE = groups(E), gJ = groups(J), segs = [], keys = [];
  let used = 0, bad = 0, prevE = -1, prevJ = -1;
  for (let k = 1; k < Math.min(gE.length, gJ.length); k++) {       // 第 0 組 (標題畫面開始前) 兩邊不同, 捨棄
    const a = gE[k], b = gJ[k];
    if (!a.length || a.length !== b.length || a.some((ie, t) => E[ie][0] !== J[b[t]][0])) { bad++; prevE = prevJ = -1; continue; }
    used++;
    let ke = 0, kj = 0;
    if (prevE >= 0) { const de = E[a[0]][1] - E[prevE][1], dj = J[b[0]][1] - J[prevJ][1]; segs.push([de, dj]); ke += de; kj += dj; }   // 送鍵之後的那一段
    for (let t = 1; t < a.length; t++) { const de = E[a[t]][1] - E[a[t - 1]][1], dj = J[b[t]][1] - J[b[t - 1]][1]; segs.push([de, dj]); ke += de; kj += dj; }
    keys.push([ke, kj]); prevE = a[a.length - 1]; prevJ = b[b.length - 1];
  }
  const sum = (A, i) => A.reduce((s, x) => s + x[i], 0), within = (x, p = 0.05) => Math.abs(x[1] - x[0]) <= p * x[0];
  const totE = sum(segs, 0), totJ = sum(segs, 1);
  const big = segs.filter(s => s[0] >= 5000), bigK = keys.filter(s => s[0] >= 10500 * 5);   // 段 ≥ 5000 週期; 一次按鍵 ≥ 5 ms
  const wins = []; { let e = 0, j = 0; for (const s of segs) { e += s[0]; j += s[1]; if (e >= 1.05e6) { wins.push([e, j]); e = j = 0; } } }
  const pct = (A, f) => A.length ? +(100 * A.filter(f).length / A.length).toFixed(1) : null;
  const wpct = (A, f) => { const t = sum(A, 0); return t ? +(100 * A.filter(f).reduce((s, x) => s + x[0], 0) / t).toFixed(1) : null; };
  const worst = A => A.reduce((m, x) => Math.abs(x[1] - x[0]) > Math.abs(m[1] - m[0]) ? x : m, [1, 1]);
  const wk = worst(bigK);
  const r = { name: T.name, err, groups: [used, bad], sec: +(totE / 10.5e6).toFixed(3), errPct: +(100 * (totJ - totE) / totE).toFixed(2),
    seg5k: pct(big, within), seg5kW: wpct(big, within), keys: bigK.length, key5: pct(bigK, within), key2: pct(bigK, x => within(x, 0.02)), key5W: wpct(bigK, within),
    keyWorstMs: +((wk[1] - wk[0]) / 10500).toFixed(1), keyWorstPct: +(100 * (wk[1] - wk[0]) / wk[0]).toFixed(1), win01: pct(wins, within), summary: (lines.join("\n").match(/\[summary\][^\n]*/) || [""])[0] };
  (S.ccResults ??= []).push(r);
  log0(`[check] ${r.name}: 原版 ${r.sec}s, 模型 ${r.errPct >= 0 ? "+" : ""}${r.errPct}% | 每次按鍵 (≥5ms, ${r.keys} 次) ±5% 內 ${r.key5}% (±2% ${r.key2}%, 週期加權 ${r.key5W}%), 最差 ${r.keyWorstMs} ms (${r.keyWorstPct}%)` +
    ` | 段 ≥5000 週期 ±5% 內 ${r.seg5k}% (加權 ${r.seg5kW}%) | 0.1 秒窗 ±5% 內 ${r.win01}% | 組 ${used}/${used + bad}${err ? " ERROR " + err : ""}`);
  return r;
};
})();
