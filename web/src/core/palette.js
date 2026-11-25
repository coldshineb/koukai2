// palette.js — 原版调色盘系统 (MAIN.EXE seg0:98fe..9a4c, 0FEA 段 1975a..197f6, 1b1d2)
//
// 原版模型:
//   目前调色盘 cur    = DS:bcd6 (48 bytes, 每色 B,R,G 各 4 bit; 开机时为 0 = 全黑)
//   目标调色盘 target = DS:8c36 (初值 = PALETTES.default)
//   所有颜色变化都经「淡入淡出」: 每 tick 每个通道朝目标移动 1, 写入 16 色 DAC, 等 1 tick (16.58 ms)
//   [03ea] ≠ 0 (结局/特殊状态) 时 fadeTo 直接返回, 不做任何变化
//   [c2d6] ≠ 0 时以 15-x 反色输出 (此版本只有清除它的代码, 实际不会发生, 仍照搬)
// 调色盘数据由 tools/extract.py 从 MAIN.EXE 取出, 见 assets/data/palettes.json

// DS 地址 -> 名称 (用途由调用点推定, 见 docs/RE_NOTES.md 第 10 节)
export const PALETTE_ADDR = {
  default: 0x8c36,   // 目标调色盘初值
  unused8c66: 0x8c66,
  battle: 0x9c76,    // 海战 (0a899 移动 / 0abef 白刃战 / 0b61f 待命·撤退)
  heroSelect: 0xa2ac, // 主角选择画面 (GRAPH2.DAT #1 + 头像, 颜色 8..15 另有循环动画 DS:a32c)
  night: 0xa4ac,     // 时段 0 (时刻 0-11, 60-71)
  dawn: 0xa4dc,      // 时段 1 (12-23)
  day: 0xa50c,       // 时段 2 (24-47)
  dusk: 0xa53c,      // 时段 3 (48-59)
  overcast: 0xa56c,  // 海上天候码 3
  chart: 0xa700,     // 航海图 / 经纬度测量 (GRAPH.DAT #25, #2/#3)
  ships: 0xa730,     // 舰队/舰船情报、造船厂、保管、水手配置、战利品
};
// DS:a4a4 时段表: index = 时刻 [0535] / 12
export const TIME_TABLE = [0, 1, 2, 2, 3, 0];
const TIME_PALETTES = ["night", "dawn", "day", "dusk", "overcast"];   // a4ac + 0x30*n

export class Palette {
  // scr: Screen (有 setPaletteRaw), sys: Sys (waitTicks), tables: {name: raw[48]}
  constructor(scr, sys, tables) {
    this.scr = scr; this.sys = sys; this.T = tables;
    this.cur = new Uint8Array(48);
    this.target = Uint8Array.from(tables.default);
    this.ending = 0;      // [03ea]
    this.invert = 0;      // [c2d6]
    this.fadeState = 0;   // DS:a4aa
    this.onStep = null;   // 测试用
  }
  table(name) { return this.T[name]; }
  setTarget(raw) { this.target.set(raw.subarray ? raw.subarray(0, 48) : raw.slice(0, 48)); }   // 98fe
  // 160a 写一色到 DAC (以 Screen 的 4bit 原始格式保存)
  writeDAC() {
    if (!this.invert) { this.scr.setPaletteRaw(this.cur); return; }
    const inv = this.cur.map(v => 15 - v); this.scr.setPaletteRaw(inv);
  }
  // 9918 一步; 返回是否有变化
  async fadeStep(raw) {
    let changed = 0;
    for (let i = 0; i < 48; i++) {
      const t = raw[i];
      if (this.cur[i] !== t) { changed = 1; if (this.cur[i] > t) this.cur[i]--; else this.cur[i]++; }
    }
    if (!changed) return 0;
    this.writeDAC();
    this.onStep?.(this.cur);
    await this.sys.waitTicks(1);
    return 1;
  }
  async fadeStepTarget() { return this.fadeStep(this.target); }                      // 99c5
  async fadeTo(raw) { if (this.ending) return; while (await this.fadeStep(raw)); }    // 99ce
  async fadeToTarget() { return this.fadeTo(this.target); }                           // 99e8
  async fadeBlack() { return this.fadeTo(new Uint8Array(48)); }                      // 99f2
  // ---------------- 调色盘循环 (seg0:16ee 安装 INT 1Ch 处理 seg0:3f44, seg0:1743 移除) ----------------
  // 每个 BIOS tick (18.2065 Hz): 倒数不为 0 就减一; 为 0 时重设为 speed, 换到下一格 (frame = (frame+1) % n),
  //   把该格 8 个 word 直接写进 DAC 颜色 8..15 (seg0:160a: R=(w>>4)&15, G=(w>>8)&15, B=w&15)。
  //   只改 DAC, 不改目前调色盘 cur (DS:bcd6), 所以之后的淡入淡出仍以 cur 为起点。
  startCycle(frames, speed) {                                                      // 16ee
    if (this.cycle) return;                                                        // [cs:16ed] 已安装
    this.cycle = { frames, speed, count: speed, frame: 0 };
    if (!this.sys.timer.virtual && typeof setInterval === "function") this.cycleTimer = setInterval(() => this.cycleTick(), 1000 / 18.2065);
  }
  stopCycle() {                                                                    // 1743
    if (this.cycleTimer) clearInterval(this.cycleTimer);
    this.cycle = null; this.cycleTimer = null;
  }
  cycleTick() {                                                                    // 3f44
    const c = this.cycle; if (!c) return;
    if (c.count) { c.count--; return; }
    c.count = c.speed;
    c.frame = (c.frame + 1) % c.frames.length;
    this.scr.setPaletteRaw(Palette.wordsToRaw(c.frames[c.frame]), 8, 8);
  }
  static wordsToRaw(ws) {
    const raw = new Uint8Array(ws.length * 3);
    ws.forEach((w, i) => { raw[i * 3] = w & 15; raw[i * 3 + 1] = (w >> 4) & 15; raw[i * 3 + 2] = (w >> 8) & 15; });
    return raw;
  }
  // 9a10 保留前 8 色 (取目标), 后 8 色淡到黑; 并把淡出前的目前调色盘存到 out
  async fadeUpperBlack(out) {
    if (out) out.set(this.cur);
    const t = Uint8Array.from(this.target); t.fill(0, 24);
    return this.fadeTo(t);
  }
  // ---------------- 时段 / 天候 (0FEA 段) ----------------
  // 1975a 时段编号
  static timeSlot(time) { return TIME_TABLE[Math.floor((time & 0xff) / 12)] ?? 0; }
  // 1976e 依时刻/位置/天候选目标调色盘. atSea: [0cae]==ff; weather: [0cb3]&15
  selectTimePalette(time, atSea, weather) {
    let name;
    if (this.invert) name = "day";
    else {
      const w = atSea ? weather & 15 : 0;
      if (w === 1) name = "night";
      else if (w === 3) name = "overcast";
      else name = TIME_PALETTES[Palette.timeSlot(time)];
    }
    this.setTarget(this.T[name]);
    return name;
  }
  // 197b4 到了特定时刻就换目标调色盘并返回 1
  timeTransition(time) {
    if (this.invert) return 0;
    const name = { 12: "dawn", 24: "day", 48: "dusk", 60: "night" }[time & 0xff];
    if (!name) return 0;
    this.setTarget(this.T[name]); return 1;
  }
  // 1b1d2 开头的渐变状态机 (每次时间推进调用一次); weather: [0cb3]
  async tickFade(time, weather) {
    switch (this.fadeState) {
      case 0: if (!(weather & 15)) this.fadeState = this.timeTransition(time); break;
      case 1: this.fadeState = await this.fadeStepTarget(); break;
      case 2: this.fadeState = 0; await this.fadeToTarget(); break;
    }
  }
}

// palettes.json -> {name: Uint8Array(48)}
export function paletteTables(json) {
  const byAddr = new Map(json.palettes.map(p => [p.imageOffset - 0x38150, Uint8Array.from(p.raw)]));
  const out = {};
  for (const [name, addr] of Object.entries(PALETTE_ADDR)) if (byAddr.has(addr)) out[name] = byAddr.get(addr);
  return out;
}
