// cpucost.js — 原版在 DOSBox (core=normal, cycles=N) 下的运行耗时模型 (RE_NOTES 第 32 节)
// 原版的节奏 = 程序设置的计时等待 + 程序本身在慢 CPU 上运行的时间; 浏览器里后者几乎是 0。
// 这里依量测得到的原版周期数 (core/cpucost_table.js), 在对应的移植方法上「记帐」(CPU.charge), 并维护一个虚拟时钟:
//   - 记帐时虚拟时钟前进 周期 / (N × (1 − IRQ 占用)) 毫秒;
//   - 计时器 (core/sys.js Timer) 以虚拟时钟计算, 所以「设置计时器 → 运行慢的程序 → 等待」的重叠与原版相同;
//   - 每个轮询点 (Sys.poll → CPU.sync) 先睡到真实时间追上虚拟时钟; 等计时器时睡到下一次减一; 等玩家输入时虚拟时钟跟着真实时间走。
// 网址参数 ?cycles=N 换基准, ?cycles=0 关闭 (只保留原版设置的等待)。测试模式 (Timer virtual) 只累计 CPU.cyc, 不影响任何结果。
// 接入: main.js 在片头结束后 installCostModel(...) + CPU.start(); 同步规则见 RE_NOTES 32.8。
import { COST_TABLE } from "./cpucost_table.js";

// 让出线程: 不需要睡时以 MessageChannel (0 延迟), 否则 setTimeout; 测试可换成模拟时钟 (CPU.sleepFn / CPU.yieldFn)
const _mc = typeof MessageChannel !== "undefined" ? new MessageChannel() : null, _mq = [];
if (_mc) { _mc.port1.onmessage = () => _mq.shift()?.(); _mc.port1.unref?.(); _mc.port2.unref?.(); }
const sleepMs = ms => new Promise(r => setTimeout(r, Math.max(0, Math.floor(ms))));
const yieldNow = () => _mc ? new Promise(r => { _mq.push(r); _mc.port2.postMessage(0); }) : sleepMs(0);

export const CPU = {
  khz: 10500,           // 每毫秒周期数 (DOSBox cycles); 0 = 关闭
  irqLoad: 0.012,       // 目前 IRQ0 (FMDRV) 占用的比例
  irqLoadMusic: 0.012,  // 播放音乐时 (量测见 RE_NOTES 32.3)
  irqLoadIdle: 0.0008,  // 不播放时 (291.3 Hz 的计时中断本身)
  cyc: 0,               // 累计的模型周期
  v: 0,                 // 虚拟时钟 (毫秒, performance.now 基准) — 原版程序「现在」的时间
  active: false,        // start() 之后才以虚拟时钟计时 (片头 OPEN.EXE 不记帐, 之前一律用真实时间)
  wakeAt: 0,            // Timer.get 设置: 等待中的计时器下一次减一的虚拟时间 (sync 用完即清)
  idle: 0,              // 连续「不超前、没有计时器」的轮询次数 (≥ 3 = 在等玩家输入)
  musicProbe: null,     // () => BGM 是否在播放 (main.js 设置)
  LAG_MAX: 8,           // 真实时间领先虚拟时钟的上限 (ms, < 1 tick): 只吸收 setTimeout 晚醒, 不追赶 (32.9 B)
  capture: null,        // () => 画面快照 (main.js 设置); null = 不延后显示
  pend: [],             // 等虚拟时间到期才显示的快照 [{ due, snap }] (32.9 A)
  sleepFn: sleepMs, yieldFn: yieldNow,
  charge(n) {
    this.cyc += n;
    if (this.khz) this.v += n / (this.khz * (1 - this.irqLoad));
  },
  real() { return typeof performance !== "undefined" ? performance.now() : Date.now(); },
  start() { this.active = true; this.v = this.real(); this.wakeAt = 0; this.idle = 0; },
  // 计时器用的「现在」: 虚拟时钟 (关闭或 start 之前 = 真实时间)
  now() { return this.active && this.khz ? this.v : this.real(); },
  // 轮询点 (Sys.poll) — 规则见 RE_NOTES 32.8
  async sync() {
    if (this.musicProbe) this.irqLoad = this.musicProbe() ? this.irqLoadMusic : this.irqLoadIdle;
    const w = this.wakeAt; this.wakeAt = 0;
    let r = this.real();
    if (!this.active || !this.khz) {                     // 只保留原版设置的等待 (真实时间)
      const d = w ? w - r : 1;
      await (d >= 1 ? this.sleepFn(d) : this.yieldFn());
      return;
    }
    if (r - this.v > this.LAG_MAX) this.v = r - this.LAG_MAX;   // 落后超过上限: 不追赶 (否则之后的等待直接通过, 连跑多个时刻)
    const ahead = this.v - r;
    if (ahead >= 1) {                                    // 晚醒的部分留在落后量里, 下一次记帐先抵掉
      this.idle = 0; this.hold(this.v);                  // 刚画好的画面等到虚拟时间到了才显示
      await this.sleepFn(ahead); return;
    }
    if (w > this.v) {                                    // 计时器在等: 睡到下一次减一, 之后 v = 该时刻 (不是醒来的时间)
      this.idle = 0;
      if (w - r >= 1) await this.sleepFn(w - r); else await this.yieldFn();
      if (this.real() >= w && this.v < w) this.v = w;
      return;
    }
    if (++this.idle >= 3) {                              // 在等玩家输入: 虚拟时钟跟着真实时间走
      this.v = Math.max(this.v, r);
      await this.sleepFn(4);
      this.v = Math.max(this.v, this.real());
      return;
    }
    await this.yieldFn();
  },
  // 超前睡眠前: 拍下目前画面, 到期 (due = 睡醒的虚拟时间) 才显示; 已到期的只留最新一张
  hold(due) {
    if (!this.capture) return;
    const p = this.pend, now = this.real();
    while (p.length > 1 && p[1].due <= now) p.shift();
    p.push({ due, snap: this.capture() });
  },
  // 画格 (rAF) 时调用: 返回 { due, snap } = 显示这张快照; "live" = 显示目前画面; null = 维持上一张 (还有快照没到期)
  frameGate(now = this.real()) {
    const p = this.pend; let s = null;
    while (p.length && p[0].due <= now) s = p.shift();
    return s || (p.length ? null : "live");
  },
  setMusic(on) { this.irqLoad = on ? this.irqLoadMusic : this.irqLoadIdle; },
  // ?cycles=N (0 = 关闭)
  configure(search) {
    const m = /[?&]cycles=(\d+)/.exec(search || "");
    if (m) this.khz = +m[1];
  },
};

// 工作量 (与量测脚本 tools/emu/cycle_measure.js 相同的定义)
const pxArea = a => (Math.abs(a[2] - a[0]) + 1) * (Math.abs(a[3] - a[1]) + 1) / 8;
const imgArea = (a, t) => { const o = t.offsets[a[1]]; return o === undefined ? 0 : (t.dat[o] | (t.dat[o + 1] << 8)) * (t.dat[o + 2] | (t.dat[o + 3] << 8)); };
export const COST_FEATURES = {
  a: {                                                  // 面积
    "Screen.putPlanar": a => a[2] * a[3], "Screen.tile": a => a[2] * a[3], "Screen.fillCols": a => a[2] * a[3],
    "Screen.fillRectPx": pxArea, "Screen.fillRectPxPlanes": pxArea, "Screen.xorRect": pxArea,
    "Screen.rectOutline": a => Math.abs(a[2] - a[0]) + Math.abs(a[3] - a[1]),
    "Screen.line": a => Math.max(Math.abs(a[2] - a[0]), Math.abs(a[3] - a[1])),
    "Screen.glyphMode": a => a[2] * a[3], "Screen.glyph": a => a[2] * a[3], "Screen.blit": a => a[3] * a[4],
    "WindowSystem.save": a => a[2] * a[3], "WindowSystem.restoreRows": a => (a[0]?.w || 0) * a[3],
    "WindowSystem.frame": a => a[2] * a[3], "WindowSystem.open": a => a[2] * a[3],
    "GraphDat.draw": imgArea, "GraphDat.draw8": imgArea,
  },
  p: {                                                  // 长度 (高度或周长)
    "WindowSystem.frame": a => a[2] + a[3], "WindowSystem.open": a => a[2] + a[3], "WindowSystem.save": a => a[3], "Screen.putPlanar": a => a[3],
  },
};

// 「属性=」项目不另记的情况: SeaScene.enterSea (851f) 的固定耗时已含一次 849a 换 WORLDMAP 项
const PROP_SKIP_IN = { "SeaScene.item": "enterSea" };

// 依记帐表包装类别方法 (调用时先记帐, 不改变行为); classes = { 类别名: 类别 }
export function installCostModel(classes, table = COST_TABLE) {
  for (const [cls, name, k] of table) {
    const C = classes[cls]; if (!C) continue;
    // "属性=": 实例的这个属性值改变时记帐 (原版在这时候做的事, 移植版只是一个指定; 例: SeaScene.item = 849a 换 WORLDMAP 项)
    //   规则与量测 (tools/emu/cycle_measure.js) 相同: 旧值已定义且新值不同时才算
    if (name.endsWith("=")) {
      const prop = name.slice(0, -1), slot = "\u0000" + prop, n = k.n || 0, skip = PROP_SKIP_IN[cls + "." + prop], inSkip = "\u0000in_" + skip;
      if (!C.prototype || Object.getOwnPropertyDescriptor(C.prototype, prop)) continue;
      Object.defineProperty(C.prototype, prop, { configurable: true,
        get() { return this[slot]; },
        set(v) { const o = this[slot]; if (o !== undefined && o !== v && !this[inSkip]) CPU.charge(n); this[slot] = v; } });
      if (skip && typeof C.prototype[skip] === "function") {        // 这个方法的固定耗时已含这件事: 方法 (同步部分) 运行中的改变不另记
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
    else g = function (...a) { let c = n; try { if (fa) c += ka * (+fa(a, this) || 0); if (fp) c += kp * (+fp(a, this) || 0); } catch (e) { /* 参数不完整时只算固定部分 */ } CPU.charge(c); return f.apply(this, a); };
    g.__cost = true; g.__orig = f;
    host[name] = g;
  }
}
