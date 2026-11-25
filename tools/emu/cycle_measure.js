// cycle_measure.js — 运行速度量测 (RE_NOTES 第 32 节): 在 port_tests.js 的同一条按键路在线,
//   原版: 以 cycles.js 依 DOSBox 0.72 规则计算周期; 移植版: 读 web/src/core/cpucost.js 的耗时模型累计的周期。
//   两边各记录一串「输入查找 / 计时器读写」事件与当时的周期数, 依序对齐后逐段比较。
// 用法 (先加载 emu_boot.js、ui_bundle.js、cycles.js 与路线设置):
//   运行本档 (安装) → 运行 port_tests.js → S.cmReport() 取得结果 → S.cmUninstall()
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
// FMDRV INT 66h 计时器服务在 DOSBox 下实际运行的指令数 (cs:0108 → 013e 分派 → F0/F1; tools/work/re_fmdrv.txt), 模拟器的桩只算 3 条
const FM66 = O.fm66 ?? 18;
let nK = 0;
// S.CM.profileFromKey = n: 从原版第 n 次送键起才累计 依指令位置的周期 (只看某一段, 例: 出海之后)
if (O.profileFromKey !== undefined) C.hist = null;
let ev = (k) => {
  if (log.side === "E") { log.E.push([k, C.game]); if (k === "K" && ++nK === O.profileFromKey) { C.hist = new Float64Array(0x100000); C.histFrom = C.game; } }
  else log.J.push([k, U.CPU ? U.CPU.cyc : 0]);
};
// ---- 原版 ----
const inst0 = S.installEmuServices;
// 包装只在本次量测 (S.cmLog === log) 且是最外层时记录; port_tests 每次安装都会把上一次的处理常式串在里面
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
  // S.CM.realtime: 原版的计时器 (FMDRV F0/F1) 与垂直同步 (3DAh) 改依 DOSBox 时间 (周期 / N, 再扣掉 IRQ0 占用 S.CM.irqLoad) 计算,
  //   用来量原版实际的节奏 (秒数)。F1 01 设置时累加器 [0123] 归零, 之后每次 IRQ0 (4096/1193182 秒) +0x35, 进位时减一 (01d0)。
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
  // S.CM.marks = [DS 地址, ...]: 该字节改变时记录 [地址, 新值, 原版时间 ms] (例: 0x2e18 出港天数、0x0535 时刻)
  if (O.marks) {
    const d = S.DSEG * 16, last = O.marks.map(a => cpu.mem[d + a]); S.cmMarks = [];
    const h = H[0x16]; H[0x16] = c => { O.marks.forEach((a, i) => { const v = c.mem[d + a]; if (v !== last[i]) { last[i] = v; S.cmMarks.push([a, v, C.T / C.max / (1 - (O.irqLoad ?? 0.012)), C.game]); } });
      // S.CM.stop(mem, DS 线性地址): 返回 true 时结束原版 (port_tests.js 的 S.EMU_DONE)
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
// S.CM.features: 移植版每个类别方法的调用次数 (每个事件记一次与上一事件的差) — 供拟合耗时模型 (tools/emu/cycle_fit.py)
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
  // 依工作量 (面积、长度、图像大小) 的特征: 名称后加 "#a" / "#p"
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
  // 软件光标: 显示计数由 0 变 1 时画光标、由 1 变 0 时擦掉 (2f9a / 2fc0)
  { const SP = U.Sys.prototype, sh = SP.mouseShow, hd = SP.mouseHide, i1 = featNames.length, i2 = i1 + 1; featNames.push("Sys.mouseShow!", "Sys.mouseHide!");
    SP.mouseShow = function (...a) { if (this.mouse.present && this.mouse.visible === 0) fcnt[i1]++; return sh.apply(this, a); };
    SP.mouseHide = function (...a) { if (this.mouse.present && this.mouse.visible === 1) fcnt[i2]++; return hd.apply(this, a); };
    wrapped.push([SP, "mouseShow", sh], [SP, "mouseHide", hd]); }
  // 属性改变 ("类别.属性="): SeaScene.item = 849a 换 WORLDMAP 项 (移植版只是指定); 旧值已定义且新值不同时算一次 (与 core/cpucost.js 相同)
  for (const [cn, prop] of [["SeaScene", "item"]]) { const C = U[cn]; if (!C || Object.getOwnPropertyDescriptor(C.prototype, prop)) continue;
    const id = featNames.length, slot = "\u0000" + prop; featNames.push(cn + "." + prop + "=");
    Object.defineProperty(C.prototype, prop, { configurable: true, get() { return this[slot]; }, set(v) { const o = this[slot]; if (o !== undefined && o !== v && !this.__cmInEnter) fcnt[id]++; this[slot] = v; } });
    wrapped.push([C.prototype, prop, undefined]);
    // enterSea (851f) 的固定耗时已含一次 849a: 其同步部分运行中的改变不算 (与 core/cpucost.js PROP_SKIP_IN 相同)
    const fe = C.prototype.enterSea; if (fe) { C.prototype.enterSea = function (...a) { this.__cmInEnter = true; try { return fe.apply(this, a); } finally { this.__cmInEnter = false; } }; wrapped.push([C.prototype, "enterSea", fe]); } }
  // 静态方法 Kao.blit3 (头像)
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
// S.CM.noLog: 不记事件 (realtime 量秒数时原版每个等待循环都在查找输入, 事件会多到内存不够)
if (O.noLog) ev = () => {};
Object.defineProperty(U.Sys.prototype, "onIO", { configurable: true,
  get() { return this._onIO; },
  set(f) { this._onIO = f ? (s => { ev("io"); f(s); }) : f; } });
const sstep = S.scriptStep;
// S.CM.gapAfter = [n, gap]: 送出 n 个动作之后, 每个动作之间的输入查找次数改为 gap (realtime 量测: 出港后长时间航行)
S.scriptStep = (sc, buf, push, od) => { if (O.gapAfter && sc.delivered + (sc.mouseN || 0) >= O.gapAfter[0]) sc.gap = O.gapAfter[1]; return sstep(sc, buf, push, k => { if (k && k.mouse) sc.mouseN = (sc.mouseN || 0) + 1; if (log.side === "J") ev("K"); od?.(k); }); };
S.cmUninstall = () => {
  for (const [p, n, f] of wrapped.reverse()) { if (f === undefined) delete p[n]; else p[n] = f; }
  cpu.cyc = null; S.installEmuServices = inst0; U.Title.prototype.run = run0; TP.get = tg; TP.set = ts; S.scriptStep = sstep;
  delete U.Sys.prototype.onIO; S.cmRestoreVGA?.(); S.cmRestoreVGA = null; S.cmUninstall = null;
};
// 依 "K" (送键) 切段, 段内事件依序对齐
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
