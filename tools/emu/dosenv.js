// dosenv.js — 開發用最小 DOS/BIOS 環境 (配合 x86emu.js)
// 提供: EXE 載入與重定位, INT 21h 檔案/記憶體/向量, INT 10h/16h/1Ah/33h, 計時器 IRQ0, 鍵盤 IRQ1
"use strict";
(function (G) {
const X86 = (typeof session !== "undefined" && session.X86) || G.X86;

class DOSEnv {
  // files: { "KAO.LZW": Uint8Array, ... } 名稱不分大小寫
  constructor(files, opts = {}) {
    this.cpu = new X86.CPU();
    this.files = {}; for (const k in files) this.files[k.toUpperCase()] = files[k];
    this.handles = {}; this.nextHandle = 5;
    this.log = opts.log || (() => {});
    this.unhandled = new Map();
    this.ticksPerIRQ0 = opts.ticksPerIRQ0 || 20000;   // 指令數 / 每次 IRQ0 (預設 18.2Hz 對應約 0.36 MIPS*... 可調)
    this.keyq = []; this.bioskeys = [];
    this.mouse = { x: 320, y: 200, b: 0, minX: 0, maxX: 639, minY: 0, maxY: 199, visible: 0 };
    this.mcbTop = 0x9fff; this.blocks = [];
    this.dta = 0; this.findState = null;
    this.setupBIOS(opts.romFont);
  }
  setupBIOS(romFont) {
    const c = this.cpu, m = c.mem;
    // 中斷向量預設指向 F000:n*8 的 [F1 n | CA 02 00] (回呼後 retf 2, 保留回呼設定的旗標)
    for (let n = 0; n < 256; n++) {
      const a = 0xf0000 + n * 8;
      m[a] = 0xf1; m[a + 1] = n; m[a + 2] = 0xca; m[a + 3] = 0x02; m[a + 4] = 0x00;
      m[n * 4] = (n * 8) & 255; m[n * 4 + 1] = (n * 8) >> 8; m[n * 4 + 2] = 0x00; m[n * 4 + 3] = 0xf0;
    }
    // INT 08h BIOS 計時器: 真正的程式碼, 會呼叫 INT 1Ch
    const t8 = [0x50, 0x1e, 0x31, 0xc0, 0x8e, 0xd8, 0xff, 0x06, 0x6c, 0x04, 0x75, 0x04, 0xff, 0x06, 0x6e, 0x04, 0xcd, 0x1c, 0xb0, 0x20, 0xe6, 0x20, 0x1f, 0x58, 0xcf];
    t8.forEach((b, i) => m[0xf0800 + 0x100 + i] = b); m[0x20] = 0x00; m[0x21] = 0x09; m[0x22] = 0x00; m[0x23] = 0xf0;
    // 1Ch 及其他未處理中斷預設 iret
    m[0xf0000 + 0x1c * 8] = 0xcf;
    // INT 09h: 從 port 60 讀掃描碼放入 BIOS 緩衝區
    // BDA
    m[0x449] = 0x03; m[0x44a] = 80; m[0x484] = 24; m[0x413] = 640 & 255; m[0x414] = 640 >> 8;
    // BIOS 8x8 字型 F000:FA6E
    if (romFont) for (let i = 0; i < romFont.length; i++) m[0xffa6e + i] = romFont[i];
    // 回呼返回點 (callFar 用): F000:F000 = F1 FF
    m[0xff000] = 0xf1; m[0xff001] = 0xff;
    const H = c.hooks, self = this;
    H[0xff] = cpu => { cpu.halted = true; cpu.returned = true; };
    H[0x21] = cpu => self.int21(cpu);
    H[0x10] = cpu => self.int10(cpu);
    H[0x16] = cpu => self.int16(cpu);
    H[0x1a] = cpu => self.int1a(cpu);
    H[0x33] = cpu => self.int33(cpu);
    H[0x2f] = cpu => { if (cpu.r[0] === 0x4300) cpu.s8(0, 0); self.ret(cpu); };
    H[0x09] = cpu => { const sc = cpu.in8(0x60); if (!(sc & 0x80)) self.bioskeys.push(sc << 8 | (self.asciiOf[sc] || 0)); cpu.out8(0x20, 0x20); self.iret(cpu); };
    for (let n = 0; n < 256; n++) if (!H[n]) H[n] = cpu => { self.unhandled.set(n, (self.unhandled.get(n) || 0) + 1); self.iret(cpu); };
    H[0x1c] = cpu => self.iret(cpu);
    // 埠
    c.ports[0x60] = { in: () => (this.port60 ?? 0), out: () => {} };
    c.ports[0x61] = { in: () => 0, out: () => {} };
    c.ports[0x64] = { in: () => 0x14, out: () => {} };
    for (const p of [0x20, 0x21, 0xa0, 0xa1, 0x40, 0x41, 0x42, 0x43, 0x388, 0x389]) c.ports[p] = { in: () => 0, out: (pp, v) => { if (pp === 0x40) this.pitWrite(v); if (pp === 0x43) this.pitBytes = 0; } };
    this.asciiOf = {};
    let tick = 0;
    c.onTick = cpu => {
      if (++tick >= this.ticksPerIRQ0) { tick = 0; if (!cpu.pendingIRQ.includes(8)) cpu.pendingIRQ.push(8); }
    };
  }
  pitWrite(v) { this.pitBytes = (this.pitBytes || 0) + 1; }
  // 回呼結束方式: 以 retf 2 返回 (stub), 但要恢復呼叫端 IF
  ret(cpu) { const fl = cpu.rw(cpu.lin(2, cpu.r[4] + 4)); cpu.flags = (cpu.flags & ~0x200) | (fl & 0x200); }
  iret(cpu) { this.ret(cpu); }
  cf(cpu, v) { if (v) cpu.flags |= 1; else cpu.flags &= ~1; }
  // ---------------- EXE 載入 ----------------
  loadEXE(bin, name = "C:\\MAIN.EXE", cmdTail = "") {
    const c = this.cpu, m = c.mem;
    const env = 0x0080, psp = 0x0100, load = psp + 0x10;
    const envs = "PATH=C:\\\0COMSPEC=C:\\COMMAND.COM\0\0\x01\0" + name + "\0";
    for (let i = 0; i < envs.length; i++) m[env * 16 + i] = envs.charCodeAt(i);
    const P = psp * 16;
    m[P] = 0xcd; m[P + 1] = 0x20; m[P + 2] = 0x00; m[P + 3] = 0xa0;   // 記憶體上限 A000
    m[P + 0x2c] = env & 255; m[P + 0x2d] = env >> 8;
    m[P + 0x80] = cmdTail.length; for (let i = 0; i < cmdTail.length; i++) m[P + 0x81 + i] = cmdTail.charCodeAt(i); m[P + 0x81 + cmdTail.length] = 13;
    for (let i = 0; i < 20; i++) m[P + 0x18 + i] = i < 5 ? i : 0xff;
    const u16 = o => bin[o] | (bin[o + 1] << 8);
    const hdr = u16(8) * 16, pages = u16(4), last = u16(2);
    const size = (pages - 1) * 512 + (last || 512) - hdr;
    m.set(bin.subarray(hdr, hdr + size), load * 16);
    const nrel = u16(6), relo = u16(0x18);
    for (let i = 0; i < nrel; i++) {
      const o = u16(relo + i * 4), s = u16(relo + i * 4 + 2), a = (load + s) * 16 + o;
      const v = (m[a] | (m[a + 1] << 8)) + load; m[a] = v & 255; m[a + 1] = (v >> 8) & 255;
    }
    c.s[2] = load + u16(0x0e); c.r[4] = u16(0x10); c.s[1] = load + u16(0x16); c.ip = u16(0x14);
    c.s[3] = psp; c.s[0] = psp; this.psp = psp; this.loadSeg = load;
    const minPara = Math.ceil((size + 0x100) / 16) + u16(0x0a);
    this.blocks = [{ seg: psp, size: 0xa000 - psp }];   // DOS 會把全部記憶體給程式
    this.dta = P + 0x80;
    return { load, size };
  }
  // ---------------- 記憶體區塊 ----------------
  alloc(paras) {
    const bl = this.blocks.slice().sort((a, b) => a.seg - b.seg);
    let cur = 0x0100;
    let best = 0;
    for (const b of bl) { const gap = b.seg - cur - 1; if (gap >= paras) { return this.addBlock(cur + 1, paras); } if (gap > best) best = gap; cur = Math.max(cur, b.seg + b.size); }
    const gap = 0x9fff - cur - 1; if (gap >= paras) return this.addBlock(cur + 1, paras); if (gap > best) best = gap;
    return -Math.max(0, best);
  }
  addBlock(seg, size) { this.blocks.push({ seg, size }); return seg; }
  // ---------------- 中斷 ----------------
  str(seg, off) { let s = "", a = seg * 16 + off; for (;;) { const ch = this.cpu.mem[a++]; if (!ch) break; s += String.fromCharCode(ch); } return s; }
  fname(p) { p = p.replace(/^[A-Za-z]:/, "").replace(/^.*[\\/]/, ""); return p.toUpperCase(); }
  int21(c) {
    const r = c.r, ah = r[0] >> 8, al = r[0] & 255;
    this.ret(c);
    switch (ah) {
      case 0x30: r[0] = 0x0005; r[3] = 0; r[1] = 0; return;              // DOS 5.0
      case 0x25: { const a = al * 4; c.mem[a] = r[2] & 255; c.mem[a + 1] = r[2] >> 8; c.mem[a + 2] = c.s[3] & 255; c.mem[a + 3] = c.s[3] >> 8; return; }
      case 0x35: { const a = al * 4; r[3] = c.mem[a] | (c.mem[a + 1] << 8); c.s[0] = c.mem[a + 2] | (c.mem[a + 3] << 8); return; }
      case 0x4a: { const b = this.blocks.find(b => b.seg === c.s[0]); if (b) { const others = this.blocks.filter(x => x !== b && x.seg > b.seg); const lim = others.length ? Math.min(...others.map(x => x.seg)) - b.seg - 1 : 0x9fff - b.seg;
          if (r[3] <= lim) { b.size = r[3]; this.cf(c, 0); } else { r[3] = lim; r[0] = 8; this.cf(c, 1); } } else this.cf(c, 0); return; }
      case 0x48: { const s = this.alloc(r[3]); if (s > 0) { r[0] = s; this.cf(c, 0); } else { r[3] = -s; r[0] = 8; this.cf(c, 1); } return; }
      case 0x49: { this.blocks = this.blocks.filter(b => b.seg !== c.s[0]); this.cf(c, 0); return; }
      case 0x44: { if (al === 0) { r[2] = r[3] < 3 ? 0x80d3 : 0x0002; this.cf(c, 0); } else if (al === 8) { r[0] = 1; this.cf(c, 0); } else { this.cf(c, 0); } return; }
      case 0x3d: case 0x3c: case 0x5b: {
        const n = this.fname(this.str(c.s[3], r[2]));
        if (ah === 0x3d && !this.files[n]) { r[0] = 2; this.cf(c, 1); this.log("open fail " + n); return; }
        if (ah !== 0x3d) this.files[n] = new Uint8Array(0);
        const h = this.nextHandle++; this.handles[h] = { name: n, pos: 0 }; r[0] = h; this.cf(c, 0); this.log("open " + n + " -> " + h); return; }
      case 0x3e: delete this.handles[r[3]]; this.cf(c, 0); return;
      case 0x3f: { const h = this.handles[r[3]]; if (!h) { if (r[3] === 0) { r[0] = 0; this.cf(c, 0); return; } r[0] = 6; this.cf(c, 1); return; }
        const f = this.files[h.name]; const n = Math.max(0, Math.min(r[1], f.length - h.pos)); const a = c.s[3] * 16 + r[2];
        for (let i = 0; i < n; i++) c.wb(a + i, f[h.pos + i]); h.pos += n; r[0] = n; this.cf(c, 0); return; }
      case 0x40: { const h = this.handles[r[3]]; const a = c.s[3] * 16 + r[2];
        if (!h) { let s = ""; for (let i = 0; i < r[1]; i++) s += String.fromCharCode(c.mem[a + i]); this.log("stdout: " + JSON.stringify(s)); r[0] = r[1]; this.cf(c, 0); return; }
        let f = this.files[h.name]; const need = h.pos + r[1]; if (need > f.length) { const nf = new Uint8Array(need); nf.set(f); f = this.files[h.name] = nf; }
        for (let i = 0; i < r[1]; i++) f[h.pos + i] = c.mem[a + i]; h.pos += r[1]; r[0] = r[1]; this.cf(c, 0); return; }
      case 0x42: { const h = this.handles[r[3]]; if (!h) { r[0] = 6; this.cf(c, 1); return; } const off = (r[1] << 16 | r[2]) >>> 0;
        const len = this.files[h.name].length; const sOff = off | 0; h.pos = al === 0 ? off : al === 1 ? h.pos + sOff : len + sOff;
        r[0] = h.pos & 0xffff; r[2] = (h.pos >>> 16) & 0xffff; this.cf(c, 0); return; }
      case 0x4c: c.halted = true; c.exitCode = al; this.log("exit " + al); return;
      case 0x00: c.halted = true; return;
      case 0x19: r[0] = (r[0] & 0xff00) | 2; return;
      case 0x0e: r[0] = (r[0] & 0xff00) | 26; return;
      case 0x47: c.mem[c.s[3] * 16 + r[6]] = 0; this.cf(c, 0); return;
      case 0x3b: this.cf(c, 0); return;
      case 0x1a: this.dta = c.s[3] * 16 + r[2]; return;
      case 0x2f: c.s[0] = this.dta >> 4; r[3] = this.dta & 15; return;
      case 0x2a: r[1] = 1994; r[2] = 0x0101; r[0] = (r[0] & 0xff00) | 6; return;
      case 0x2c: { const t = (c.icount / 1e6) | 0; r[1] = 0x0c00 | ((t / 60) % 60); r[2] = ((t % 60) << 8); return; }
      case 0x4e: case 0x4f: {
        if (ah === 0x4e) { const pat = this.fname(this.str(c.s[3], r[2])); const re = new RegExp("^" + pat.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
          this.findState = Object.keys(this.files).filter(n => re.test(n)).sort(); }
        const n = this.findState && this.findState.shift(); if (!n) { r[0] = 18; this.cf(c, 1); return; }
        const d = this.dta; for (let i = 0; i < 43; i++) c.mem[d + i] = 0; c.mem[d + 0x15] = 0x20;
        const L = this.files[n].length; c.mem[d + 0x1a] = L & 255; c.mem[d + 0x1b] = (L >> 8) & 255; c.mem[d + 0x1c] = (L >> 16) & 255;
        for (let i = 0; i < n.length; i++) c.mem[d + 0x1e + i] = n.charCodeAt(i); this.cf(c, 0); return; }
      case 0x62: r[3] = this.psp; return;
      case 0x33: if (al === 0 || al === 1) r[2] &= 0xff00; return;
      case 0x0b: r[0] &= 0xff00; return;
      case 0x06: if ((r[2] & 255) === 0xff) { r[0] &= 0xff00; c.flags |= 0x40; } else this.log("putc " + String.fromCharCode(r[2] & 255)); return;
      case 0x09: this.log("print$ " + this.str$(c.s[3], r[2])); return;
      case 0x41: delete this.files[this.fname(this.str(c.s[3], r[2]))]; this.cf(c, 0); return;
      case 0x57: r[1] = 0; r[2] = 0; this.cf(c, 0); return;
    }
    this.unhandled.set("21:" + ah.toString(16), (this.unhandled.get("21:" + ah.toString(16)) || 0) + 1);
    this.cf(c, 1);
  }
  str$(seg, off) { let s = "", a = seg * 16 + off; for (let i = 0; i < 400; i++) { const ch = this.cpu.mem[a++]; if (ch === 36) break; s += String.fromCharCode(ch); } return s; }
  int10(c) {
    const r = c.r, ah = r[0] >> 8, al = r[0] & 255; this.ret(c);
    if (ah === 0x00) { this.videoMode = al & 0x7f; c.mem[0x449] = this.videoMode; if (!(al & 0x80)) c.vga.planes.forEach(p => p.fill(0)); return; }
    if (ah === 0x0f) { r[0] = (80 << 8) | (this.videoMode ?? 3); r[3] &= 0x00ff; return; }
    if (ah === 0x10) {
      if (al === 0x00) { c.vga.attr[r[3] & 15] = r[3] >> 8; return; }
      if (al === 0x02) { const a = c.s[0] * 16 + r[2]; for (let i = 0; i < 16; i++) c.vga.attr[i] = c.mem[a + i]; return; }
      if (al === 0x10) { const k = (r[3] & 255) * 3; c.vga.dac[k] = r[2] >> 8; c.vga.dac[k + 1] = r[1] >> 8; c.vga.dac[k + 2] = r[1] & 255; return; }
      if (al === 0x12) { const a = c.s[0] * 16 + r[2]; for (let i = 0; i < r[1] * 3; i++) c.vga.dac[r[3] * 3 + i] = c.mem[a + i] & 63; return; }
      return;
    }
    if (ah === 0x1a) { r[0] = (r[0] & 0xff00) | 0x1a; r[3] = 0x0008; return; }
    if (ah === 0x12) { r[3] = 0x0003; return; }
  }
  int16(c) {
    const r = c.r, ah = r[0] >> 8; this.ret(c);
    if (ah === 0 || ah === 0x10) { if (!this.bioskeys.length) { c.ip = (c.ip - 2) & 0xffff; c.flags |= 0x200; this.waitingKey = true; return; } this.waitingKey = false; r[0] = this.bioskeys.shift(); return; }
    if (ah === 1 || ah === 0x11) { if (this.bioskeys.length) { r[0] = this.bioskeys[0]; c.flags &= ~0x40; } else c.flags |= 0x40; return; }
    if (ah === 2) { r[0] &= 0xff00; return; }
  }
  int1a(c) { const r = c.r, ah = r[0] >> 8; this.ret(c); if (ah === 0) { const t = c.mem[0x46c] | c.mem[0x46d] << 8 | c.mem[0x46e] << 16; r[1] = t >> 16; r[2] = t & 0xffff; r[0] &= 0xff00; } }
  int33(c) {
    const r = c.r, M = this.mouse; this.ret(c);
    switch (r[0]) {
      case 0: r[0] = 0xffff; r[3] = 2; return;
      case 1: M.visible++; return; case 2: M.visible--; return;
      case 3: r[3] = M.b; r[1] = M.x; r[2] = M.y; return;
      case 4: M.x = r[1]; M.y = r[2]; return;
      case 5: case 6: r[0] = M.b; r[3] = 0; r[1] = M.x; r[2] = M.y; return;
      case 7: M.minX = r[1]; M.maxX = r[2]; return; case 8: M.minY = r[1]; M.maxY = r[2]; return;
      case 0x0b: r[1] = 0; r[2] = 0; return;
      default: return;
    }
  }
  // ---- 外部輸入 ----
  pressKey(scan, ascii = 0) { this.asciiOf[scan] = ascii; this.port60 = scan; this.cpu.pendingIRQ.push(9); }
  releaseKey(scan) { this.port60 = scan | 0x80; this.cpu.pendingIRQ.push(9); }
  // ---- 呼叫遊戲內遠程函式 (Microsoft C far cdecl/register 混合) ----
  callFar(seg, off, { ax = 0, bx = 0, cx = 0, dx = 0, si = 0, di = 0, args = [], maxIns = 5e7 } = {}) {
    const c = this.cpu;
    for (let i = args.length - 1; i >= 0; i--) c.push(args[i] & 0xffff);
    c.push(0xf000); c.push(0xf000);
    c.r[0] = ax; c.r[3] = bx; c.r[1] = cx; c.r[2] = dx; c.r[6] = si; c.r[7] = di;
    c.s[1] = seg; c.ip = off; c.halted = false; c.returned = false;
    c.run(maxIns);
    if (!c.returned) throw new Error(`callFar ${seg.toString(16)}:${off.toString(16)} did not return; at ${c.s[1].toString(16)}:${c.ip.toString(16)}`);
    return c.r[0];
  }
}
if (typeof session !== "undefined") session.DOSEnv = DOSEnv;
G.DOSEnv = DOSEnv;
})(typeof globalThis !== "undefined" ? globalThis : this);
