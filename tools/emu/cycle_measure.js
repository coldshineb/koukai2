// cycle_measure.js — 執行速度量測 (RE_NOTES 第 32 節): 在 port_tests.js 的同一條按鍵路線上,
//   原版: 以 cycles.js 依 DOSBox 0.72 規則計算週期; 移植版: 讀 web/src/core/cpucost.js 的耗時模型累計的週期。
//   兩邊各記錄一串「輸入查詢 / 計時器讀寫」事件與當時的週期數, 依序對齊後逐段比較。
// 用法 (先載入 emu_boot.js、ui_bundle.js、cycles.js 與路線設定):
//   執行本檔 (安裝) → 執行 port_tests.js → S.cmReport() 取得結果 → S.cmUninstall()
//   S.CM = { max: 10500, profile: false }
"use strict";
(function () {
const S = session, U = S.UI, O = S.CM || {};
if (S.cmUninstall) S.cmUninstall();
const L = 0x110 * 16;
const log = { E: [], J: [], side: "E" };
const C = new S.DOSBoxCycles({ max: O.max || 10500, profile: !!O.profile });
const cpu = S.titleEnv.cpu;
cpu.cyc = C;
// FMDRV INT 66h 計時器服務在 DOSBox 下實際執行的指令數 (cs:0108 → 013e 分派 → F0/F1; tools/work/re_fmdrv.txt), 模擬器的樁只算 3 條
const FM66 = O.fm66 ?? 18;
let nK = 0;
// S.CM.profileFromKey = n: 從原版第 n 次送鍵起才累計 依指令位置的週期 (只看某一段, 例: 出海之後)
if (O.profileFromKey !== undefined) C.hist = null;
let ev = (k) => {
  if (log.side === "E") { log.E.push([k, C.game]); if (k === "K" && ++nK === O.profileFromKey) { C.hist = new Float64Array(0x100000); C.histFrom = C.game; } }
  else log.J.push([k, U.CPU ? U.CPU.cyc : 0]);
};
// ---- 原版 ----
const inst0 = S.installEmuServices;
// 包裝只在本次量測 (S.cmLog === log) 且是最外層時記錄; port_tests 每次安裝都會把上一次的處理常式串在裡面
const wrap = f => c => { if (S._cmIn || S.cmLog !== log) return; S._cmIn = 1; try { f(c); } finally { S._cmIn = 0; } };
S.installEmuServices = (sc, od) => {
  inst0(sc, k => { ev("K"); od?.(k); });
  const envI = S.env;
  const H = cpu.hooks, h16 = H[0x16], h33 = H[0x33], h66 = H[0x66];
  const m16 = wrap(c => { if ((c.r[0] >> 8) === 1) { C.add(1); ev("io"); } }), m33 = wrap(c => { if (c.r[0] === 3) { C.add(1); ev("io"); } });
  const m66 = wrap(c => { const ax = c.r[0], hi = ax >> 8; if (hi === 0xf0 || hi === 0xf1) { C.add(FM66); ev((ax & 0xff) === 1 ? (hi === 0xf1 ? "ts" : "ts0") : (hi === 0xf1 ? "tr" : "tr0")); } });
  H[0x16] = c => { m16(c); h16(c); };                                                      // DOSBox INT 16h: STI + 回呼 + IRET (+1)
  H[0x33] = c => { m33(c); h33(c); };                                                      // DOSBox INT 33h: JMP + 回呼 + IRET (+1)
  H[0x66] = c => { m66(c); h66(c); };
  // S.CM.realtime: 原版的計時器 (FMDRV F0/F1) 與垂直同步 (3DAh) 改依 DOSBox 時間 (週期 / N, 再扣掉 IRQ0 佔用 S.CM.irqLoad) 計算,
  //   用來量原版實際的節奏 (秒數)。F1 01 設定時累加器 [0123] 歸零, 之後每次 IRQ0 (4096/1193182 秒) +0x35, 進位時減一 (01d0)。
  if (O.realtime) {
    const PIT = 4096 / 1193181.6667 * 1000, load = O.irqLoad ?? 0.012;
    const nowMs = () => C.T / C.max / (1 - load);
    const irqAt = t => Math.floor(t / PIT);
    const tm = [{ n: 0, k0: 0 }, { n: 0, k0: 0 }];
    H[0x66] = c => {
      const ax = c.r[0], hi = ax >> 8;
      if (hi !== 0xf0 && hi !== 0xf1) { m66(c); h66(c); return; }
      m66(c); envI.ret(c);
      const T = tm[hi === 0xf1 ? 0 : 1], k = irqAt(nowMs());
      if ((ax & 0xff) === 1) { T.n = c.r[3]; T.k0 = k; }
      else c.r[3] = Math.max(0, T.n - Math.floor((k - T.k0) * 0x35 / 256));
    };
    const vga = cpu.vga, pin = vga.portIn0 || vga.portIn; vga.portIn0 = pin;
    vga.portIn = function (p) {
      if (p !== 0x3da) return pin.call(this, p);
      this.attrFlip = 0;
      const fr = C.frameP, t = (C.T / (1 - load)) % fr, line = fr / 525;
      return (t >= C.vr[0] && t <= C.vr[1] ? 0x08 : 0) | (t >= 480 * line || (t % line) >= line * 640 / 800 ? 0x01 : 0);
    };
    S.cmRestoreVGA = () => { vga.portIn = pin; delete vga.portIn0; };
  }
  // S.CM.marks = [DS 位址, ...]: 該位元組改變時記錄 [位址, 新值, 原版時間 ms] (例: 0x2e18 出港天數、0x0535 時刻)
  if (O.marks) {
    const d = S.DSEG * 16, last = O.marks.map(a => cpu.mem[d + a]); S.cmMarks = [];
    const h = H[0x16]; H[0x16] = c => { O.marks.forEach((a, i) => { const v = c.mem[d + a]; if (v !== last[i]) { last[i] = v; S.cmMarks.push([a, v, C.T / C.max / (1 - (O.irqLoad ?? 0.012)), C.game]); } });
      // S.CM.stop(mem, DS 線性位址): 回傳 true 時結束原版 (port_tests.js 的 S.EMU_DONE)
      if (O.stop && O.stop(c.mem, d)) { S.EMU_DONE = true; c.halted = true; return; }
      h(c); };
  }
};
// ---- 移植版 ----
const run0 = U.Title.prototype.run;
U.Title.prototype.run = function (...a) { log.side = "J"; return run0.apply(this, a); };
const TP = U.Timer.prototype, tg = TP.get, ts = TP.set;
TP.get = function () { if (this.virtual) ev("tr"); return tg.call(this); };
TP.set = function (n) { if (this.virtual) ev("ts"); return ts.call(this, n); };
// S.CM.features: 移植版每個類別方法的呼叫次數 (每個事件記一次與上一事件的差) — 供擬合耗時模型 (tools/emu/cycle_fit.py)
const feat = new Map(), featNames = [], wrapped = [];
let fcnt = null;
if (O.features) {
  fcnt = new Float64Array(8192);
  const skip = new Set(["constructor"]);
  for (const [cn, C] of Object.entries(U)) {
    if (typeof C !== "function" || !C.prototype || C === U.CPU) continue;
    for (const name of Object.getOwnPropertyNames(C.prototype)) {
      if (skip.has(name)) continue;
      const d = Object.getOwnPropertyDescriptor(C.prototype, name);
      if (!d || typeof d.value !== "function") continue;
      const f = d.value, id = featNames.length; featNames.push(cn + "." + name);
      const g = function (...a) { fcnt[id]++; return f.apply(this, a); };
      C.prototype[name] = g; wrapped.push([C.prototype, name, f]);
    }
  }
  // 依工作量 (面積、長度、圖像大小) 的特徵: 名稱後加 "#a" / "#p"
  const pxA = a => (Math.abs(a[2] - a[0]) + 1) * (Math.abs(a[3] - a[1]) + 1) / 8;
  const AREA = {
    "Screen.putPlanar": a => a[2] * a[3], "Screen.tile": a => a[2] * a[3], "Screen.fillCols": a => a[2] * a[3],
    "Screen.fillRectPx": pxA, "Screen.fillRectPxPlanes": pxA, "Screen.xorRect": pxA,
    "Screen.rectOutline": a => Math.abs(a[2] - a[0]) + Math.abs(a[3] - a[1]),
    "Screen.line": a => Math.max(Math.abs(a[2] - a[0]), Math.abs(a[3] - a[1])),
    "Screen.glyphMode": a => a[2] * a[3], "Screen.glyph": a => a[2] * a[3], "Screen.blit": a => a[3] * a[4],
    "WindowSystem.save": a => a[2] * a[3], "WindowSystem.restoreRows": a => (a[0]?.w || 0) * a[3],
    "WindowSystem.frame": a => a[2] * a[3], "WindowSystem.open": a => a[2] * a[3],
    "GraphDat.draw": (a, t) => { const o = t.offsets[a[1]]; return o === undefined ? 0 : (t.dat[o] | (t.dat[o + 1] << 8)) * (t.dat[o + 2] | (t.dat[o + 3] << 8)); },
    "GraphDat.draw8": (a, t) => { const o = t.offsets[a[1]]; return o === undefined ? 0 : (t.dat[o] | (t.dat[o + 1] << 8)) * (t.dat[o + 2] | (t.dat[o + 3] << 8)); },
  };
  const PERIM = { "WindowSystem.frame": a => a[2] + a[3], "WindowSystem.open": a => a[2] + a[3], "WindowSystem.save": a => a[3], "Screen.putPlanar": a => a[3] };
  for (const [tbl, suf] of [[AREA, "#a"], [PERIM, "#p"]]) for (const [k, fn] of Object.entries(tbl)) {
    const [cn, name] = k.split("."), C = U[cn]; if (!C || typeof C.prototype[name] !== "function") continue;
    const g = C.prototype[name], id = featNames.length; featNames.push(k + suf);
    C.prototype[name] = function (...a) { try { fcnt[id] += +fn(a, this) || 0; } catch (e) { /* */ } return g.apply(this, a); };
    wrapped.push([C.prototype, name, g]);
  }
  // 軟體游標: 顯示計數由 0 變 1 時畫游標、由 1 變 0 時擦掉 (2f9a / 2fc0)
  { const SP = U.Sys.prototype, sh = SP.mouseShow, hd = SP.mouseHide, i1 = featNames.length, i2 = i1 + 1; featNames.push("Sys.mouseShow!", "Sys.mouseHide!");
    SP.mouseShow = function (...a) { if (this.mouse.present && this.mouse.visible === 0) fcnt[i1]++; return sh.apply(this, a); };
    SP.mouseHide = function (...a) { if (this.mouse.present && this.mouse.visible === 1) fcnt[i2]++; return hd.apply(this, a); };
    wrapped.push([SP, "mouseShow", sh], [SP, "mouseHide", hd]); }
  // 屬性改變 ("類別.屬性="): SeaScene.item = 849a 換 WORLDMAP 項 (移植版只是指定); 舊值已定義且新值不同時算一次 (與 core/cpucost.js 相同)
  for (const [cn, prop] of [["SeaScene", "item"]]) { const C = U[cn]; if (!C || Object.getOwnPropertyDescriptor(C.prototype, prop)) continue;
    const id = featNames.length, slot = "\u0000" + prop; featNames.push(cn + "." + prop + "=");
    Object.defineProperty(C.prototype, prop, { configurable: true, get() { return this[slot]; }, set(v) { const o = this[slot]; if (o !== undefined && o !== v && !this.__cmInEnter) fcnt[id]++; this[slot] = v; } });
    wrapped.push([C.prototype, prop, undefined]);
    // enterSea (851f) 的固定耗時已含一次 849a: 其同步部分執行中的改變不算 (與 core/cpucost.js PROP_SKIP_IN 相同)
    const fe = C.prototype.enterSea; if (fe) { C.prototype.enterSea = function (...a) { this.__cmInEnter = true; try { return fe.apply(this, a); } finally { this.__cmInEnter = false; } }; wrapped.push([C.prototype, "enterSea", fe]); } }
  // 靜態方法 Kao.blit3 (頭像)
  if (U.Kao && U.Kao.blit3) { const g = U.Kao.blit3, id = featNames.length; featNames.push("Kao.blit3");
    U.Kao.blit3 = function (...a) { fcnt[id]++; return g.apply(this, a); }; wrapped.push([U.Kao, "blit3", g]); }
}
let lastF = fcnt ? new Float64Array(fcnt.length) : null;
const evJ0 = ev;
const jfeat = [];
if (fcnt) {
  const evx = (k) => {
    if (log.side === "J") {
      const d = []; for (let i = 0; i < featNames.length; i++) if (fcnt[i] !== lastF[i]) { d.push(i, fcnt[i] - lastF[i]); lastF[i] = fcnt[i]; }
      jfeat.push(d);
    }
    evJ0(k);
  };
  ev = evx;
}
// S.CM.noLog: 不記事件 (realtime 量秒數時原版每個等待迴圈都在查詢輸入, 事件會多到記憶體不夠)
if (O.noLog) ev = () => {};
Object.defineProperty(U.Sys.prototype, "onIO", { configurable: true,
  get() { return this._onIO; },
  set(f) { this._onIO = f ? (s => { ev("io"); f(s); }) : f; } });
const sstep = S.scriptStep;
// S.CM.gapAfter = [n, gap]: 送出 n 個動作之後, 每個動作之間的輸入查詢次數改為 gap (realtime 量測: 出港後長時間航行)
S.scriptStep = (sc, buf, push, od) => { if (O.gapAfter && sc.delivered + (sc.mouseN || 0) >= O.gapAfter[0]) sc.gap = O.gapAfter[1]; return sstep(sc, buf, push, k => { if (k && k.mouse) sc.mouseN = (sc.mouseN || 0) + 1; if (log.side === "J") ev("K"); od?.(k); }); };
S.cmUninstall = () => {
  for (const [p, n, f] of wrapped.reverse()) { if (f === undefined) delete p[n]; else p[n] = f; }
  cpu.cyc = null; S.installEmuServices = inst0; U.Title.prototype.run = run0; TP.get = tg; TP.set = ts; S.scriptStep = sstep;
  delete U.Sys.prototype.onIO; S.cmRestoreVGA?.(); S.cmRestoreVGA = null; S.cmUninstall = null;
};
// 依 "K" (送鍵) 切段, 段內事件依序對齊
S.cmReport = () => {
  const E = log.E, J = log.J, split = a => { const r = [[]]; for (const e of a) { if (e[0] === "K") r.push([]); else r[r.length - 1].push(e); } return r; };
  const sE = split(E), sJ = split(J), out = { segs: [], mism: [] };
  for (let i = 0; i < Math.min(sE.length, sJ.length); i++) {
    const a = sE[i], b = sJ[i];
    const ta = a.map(e => e[0]).join(","), tb = b.map(e => e[0]).join(",");
    if (ta !== tb) out.mism.push({ key: i, nE: a.length, nJ: b.length, firstDiff: (() => { let k = 0; while (k < a.length && k < b.length && a[k][0] === b[k][0]) k++; return k; })() });
    out.segs.push({ key: i, E: a, J: b });
  }
  out.totalE = C.game; out.irqE = C.irq; out.T = C.T; out.hist = C.hist;
  out.featNames = featNames; out.jfeat = jfeat;
  return out;
};
S.cmLog = log; S.cmC = C;
})();
