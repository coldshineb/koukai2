// x86emu.js — 開發用 16 位元 x86 (8086/80186/286 實模式) + VGA 平面模式模擬器
// 用途: 執行原版 MAIN.EXE 的個別例程或整個遊戲, 取得「標準答案」畫面與數值, 與重寫版逐像素比對。
// 不屬於移植版遊戲本體; 遊戲本體不載入任何原版機器碼。
// 用法: 本檔執行後掛在 session.X86 (Quick 沙盒) 或 globalThis.X86 (瀏覽器/Node)。
"use strict";
(function (G) {
const PAR = new Uint8Array(256);
for (let i = 0; i < 256; i++) { let b = i, p = 1; while (b) { p ^= b & 1; b >>= 1; } PAR[i] = p; }
const CF = 1, PF = 4, AF = 0x10, ZF = 0x40, SF = 0x80, TF = 0x100, IF = 0x200, DF = 0x400, OF = 0x800;

class VGA {
  constructor() {
    this.planes = [0, 1, 2, 3].map(() => new Uint8Array(65536));
    this.latch = new Uint8Array(4);
    this.seq = new Uint8Array(8); this.seq[2] = 0xf; this.seqIdx = 0;
    this.gc = new Uint8Array(16); this.gc[8] = 0xff; this.gcIdx = 0;
    this.crt = new Uint8Array(32); this.crtIdx = 0;
    this.attr = new Uint8Array(21); for (let i = 0; i < 16; i++) this.attr[i] = i; this.attrIdx = 0; this.attrFlip = 0;
    this.dac = new Uint8Array(768); this.dacW = 0; this.dacR = 0; this.stat = 0;
  }
  read(off) {
    const L = this.latch, P = this.planes;
    L[0] = P[0][off]; L[1] = P[1][off]; L[2] = P[2][off]; L[3] = P[3][off];
    if (this.gc[5] & 8) {
      const cc = this.gc[2], cd = this.gc[7]; let res = 0;
      for (let b = 0; b < 8; b++) {
        let ok = true;
        for (let p = 0; p < 4; p++) if ((cd >> p) & 1) { if (((L[p] >> b) & 1) !== ((cc >> p) & 1)) { ok = false; break; } }
        if (ok) res |= 1 << b;
      }
      return res;
    }
    return L[this.gc[4] & 3];
  }
  write(off, val) {
    const gc = this.gc, mode = gc[5] & 3, mask = this.seq[2], func = (gc[3] >> 3) & 3, rot = gc[3] & 7;
    const L = this.latch, P = this.planes;
    let v = rot ? ((val >> rot) | (val << (8 - rot))) & 255 : val;
    for (let p = 0; p < 4; p++) {
      if (!((mask >> p) & 1)) continue;
      let d, bm = gc[8];
      if (mode === 1) { P[p][off] = L[p]; continue; }
      if (mode === 0) d = ((gc[1] >> p) & 1) ? (((gc[0] >> p) & 1) ? 255 : 0) : v;
      else if (mode === 2) d = ((val >> p) & 1) ? 255 : 0;
      else { bm &= v; d = ((gc[0] >> p) & 1) ? 255 : 0; }
      const l = L[p];
      if (func === 1) d &= l; else if (func === 2) d |= l; else if (func === 3) d ^= l;
      P[p][off] = ((d & bm) | (l & ~bm)) & 255;
    }
  }
  portIn(port) {
    switch (port) {
      case 0x3c4: return this.seqIdx; case 0x3c5: return this.seq[this.seqIdx & 7];
      case 0x3ce: return this.gcIdx; case 0x3cf: return this.gc[this.gcIdx & 15];
      case 0x3d4: return this.crtIdx; case 0x3d5: return this.crt[this.crtIdx & 31];
      case 0x3c9: { const v = this.dac[this.dacR % 768]; this.dacR++; return v; }
      case 0x3da: { this.attrFlip = 0; this.stat++; return ((this.stat >> 1) & 1) ? 0x09 : 0x00; }
      case 0x3c1: return this.attr[this.attrIdx % 21];
    }
    return 0xff;
  }
  portOut(port, v) {
    switch (port) {
      case 0x3c4: this.seqIdx = v; break; case 0x3c5: this.seq[this.seqIdx & 7] = v; break;
      case 0x3ce: this.gcIdx = v; break; case 0x3cf: this.gc[this.gcIdx & 15] = v; break;
      case 0x3d4: this.crtIdx = v; break; case 0x3d5: this.crt[this.crtIdx & 31] = v; break;
      case 0x3c8: this.dacW = v * 3; break; case 0x3c7: this.dacR = v * 3; break;
      case 0x3c9: this.dac[this.dacW % 768] = v & 63; this.dacW++; break;
      case 0x3c0: if (!this.attrFlip) this.attrIdx = v & 31; else if (this.attrIdx < 21) this.attr[this.attrIdx] = v; this.attrFlip ^= 1; break;
    }
  }
  // 640 x lines 索引畫面 (平面 -> 0..15)
  snapshotIndexed(lines = 480, start = null) {
    const s = start ?? ((this.crt[0x0c] << 8) | this.crt[0x0d]);
    const out = new Uint8Array(640 * lines), P = this.planes;
    for (let y = 0; y < lines; y++) for (let xb = 0; xb < 80; xb++) {
      const o = (s + y * 80 + xb) & 0xffff;
      const b0 = P[0][o], b1 = P[1][o], b2 = P[2][o], b3 = P[3][o];
      for (let bit = 0; bit < 8; bit++) {
        const sh = 7 - bit;
        out[y * 640 + xb * 8 + bit] = ((b0 >> sh) & 1) | (((b1 >> sh) & 1) << 1) | (((b2 >> sh) & 1) << 2) | (((b3 >> sh) & 1) << 3);
      }
    }
    return out;
  }
  rgbOf(i) { const d = this.attr[i & 15] & 63, k = d * 3; return [this.dac[k] * 255 / 63 | 0, this.dac[k + 1] * 255 / 63 | 0, this.dac[k + 2] * 255 / 63 | 0]; }
}

class CPU {
  constructor() {
    this.mem = new Uint8Array(0x110000);
    this.r = new Uint16Array(8);      // ax cx dx bx sp bp si di
    this.s = new Uint16Array(6);      // es cs ss ds fs gs
    this.ip = 0; this.flags = 0x0202;
    this.vga = new VGA();
    this.hooks = {};                  // F1 nn 回呼
    this.ports = {};                  // 其他 I/O 埠: {in(p), out(p,v)}
    this.icount = 0; this.halted = false; this.segov = -1;
    this.pendingIRQ = [];
    this.trace = null;
    this.cyc = null;                  // DOSBox 週期計數器 (tools/emu/cycles.js 安裝; null = 關閉, 不影響其他測試)
  }
  // ---- 記憶體 ----
  rb(a) { a &= 0xfffff; if (a >= 0xa0000 && a < 0xb0000) return this.vga.read(a - 0xa0000); return this.mem[a]; }
  wb(a, v) { a &= 0xfffff; if (a >= 0xa0000 && a < 0xb0000) { this.vga.write(a - 0xa0000, v & 255); return; } if (a >= 0xf0000) return; this.mem[a] = v; }
  rw(a) { return this.rb(a) | (this.rb(a + 1) << 8); }
  ww(a, v) { this.wb(a, v & 255); this.wb(a + 1, (v >> 8) & 255); }
  lin(seg, off) { return ((this.s[seg] << 4) + (off & 0xffff)) & 0xfffff; }
  // ---- 暫存器 ----
  g8(i) { return i < 4 ? this.r[i] & 255 : this.r[i - 4] >> 8; }
  s8(i, v) { if (i < 4) this.r[i] = (this.r[i] & 0xff00) | (v & 255); else this.r[i - 4] = (this.r[i - 4] & 0xff) | ((v & 255) << 8); }
  f8() { const v = this.rb((this.s[1] << 4) + this.ip); this.ip = (this.ip + 1) & 0xffff; return v; }
  f16() { const lo = this.f8(); return lo | (this.f8() << 8); }
  push(v) { this.r[4] = (this.r[4] - 2) & 0xffff; this.ww((this.s[2] << 4) + this.r[4], v); }
  pop() { const v = this.rw((this.s[2] << 4) + this.r[4]); this.r[4] = (this.r[4] + 2) & 0xffff; return v; }
  // ---- ModRM ----
  modrm() {
    const m = this.f8(), mod = m >> 6, rm = m & 7, r = this.r;
    this.mreg = (m >> 3) & 7;
    if (mod === 3) { this.misreg = true; this.mrm = rm; return; }
    this.misreg = false;
    let off, seg;
    switch (rm) {
      case 0: off = r[3] + r[6]; seg = 3; break; case 1: off = r[3] + r[7]; seg = 3; break;
      case 2: off = r[5] + r[6]; seg = 2; break; case 3: off = r[5] + r[7]; seg = 2; break;
      case 4: off = r[6]; seg = 3; break; case 5: off = r[7]; seg = 3; break;
      case 6: if (mod === 0) { off = this.f16(); seg = 3; } else { off = r[5]; seg = 2; } break;
      default: off = r[3]; seg = 3;
    }
    if (mod === 1) { let d = this.f8(); if (d & 0x80) d -= 256; off += d; }
    else if (mod === 2) off += this.f16();
    off &= 0xffff; if (this.segov >= 0) seg = this.segov;
    this.moff = off; this.mseg = seg; this.mea = ((this.s[seg] << 4) + off) & 0xfffff;
  }
  grm8() { return this.misreg ? this.g8(this.mrm) : this.rb(this.mea); }
  srm8(v) { if (this.misreg) this.s8(this.mrm, v); else this.wb(this.mea, v); }
  grm16() { return this.misreg ? this.r[this.mrm] : this.rw(this.mea); }
  srm16(v) { if (this.misreg) this.r[this.mrm] = v & 0xffff; else this.ww(this.mea, v); }
  ea2() { return ((this.s[this.mseg] << 4) + ((this.moff + 2) & 0xffff)) & 0xfffff; }
  // ---- 旗標 ----
  szp(v, w) {
    let f = this.flags & ~(SF | ZF | PF); v &= w ? 0xffff : 0xff;
    if (v === 0) f |= ZF; if (v & (w ? 0x8000 : 0x80)) f |= SF; if (PAR[v & 255]) f |= PF; this.flags = f;
  }
  alu(op, a, b, w) {
    const m = w ? 0xffff : 0xff, sb = w ? 0x8000 : 0x80;
    let res, cf = 0, of = 0, af = 0, c;
    switch (op) {
      case 0: res = a + b; cf = res > m; of = (a ^ res) & (b ^ res) & sb; af = (a ^ b ^ res) & 0x10; break;
      case 2: c = this.flags & 1; res = a + b + c; cf = res > m; of = (a ^ res) & (b ^ res) & sb; af = (a ^ b ^ res) & 0x10; break;
      case 3: c = this.flags & 1; res = a - b - c; cf = res < 0; of = (a ^ b) & (a ^ res) & sb; af = (a ^ b ^ res) & 0x10; break;
      case 5: case 7: res = a - b; cf = res < 0; of = (a ^ b) & (a ^ res) & sb; af = (a ^ b ^ res) & 0x10; break;
      case 1: res = a | b; break; case 4: res = a & b; break; default: res = a ^ b;
    }
    res &= m;
    let f = this.flags & ~(CF | PF | AF | ZF | SF | OF);
    if (cf) f |= CF; if (of) f |= OF; if (af) f |= AF; if (res === 0) f |= ZF; if (res & sb) f |= SF; if (PAR[res & 255]) f |= PF;
    this.flags = f; return res;
  }
  incdec(v, w, dec) { const c = this.flags & 1; const r = this.alu(dec ? 5 : 0, v, 1, w); this.flags = (this.flags & ~1) | c; return r; }
  setCO(c, o) { this.flags = (this.flags & ~(CF | OF)) | (c ? CF : 0) | (o ? OF : 0); }
  shift(op, v, cnt, w) {
    cnt &= 31; if (!cnt) return v;
    const m = w ? 0xffff : 0xff, sb = w ? 0x8000 : 0x80;
    let cf = this.flags & 1, r = v;
    switch (op) {
      case 0: for (let i = 0; i < cnt; i++) { cf = (r & sb) ? 1 : 0; r = ((r << 1) | cf) & m; } this.setCO(cf, ((r & sb) ? 1 : 0) ^ cf); return r;
      case 1: for (let i = 0; i < cnt; i++) { cf = r & 1; r = (r >> 1) | (cf ? sb : 0); } this.setCO(cf, ((r ^ (r << 1)) & sb) ? 1 : 0); return r;
      case 2: for (let i = 0; i < cnt; i++) { const n = (r & sb) ? 1 : 0; r = ((r << 1) | cf) & m; cf = n; } this.setCO(cf, ((r & sb) ? 1 : 0) ^ cf); return r;
      case 3: for (let i = 0; i < cnt; i++) { const n = r & 1; r = (r >> 1) | (cf ? sb : 0); cf = n; } this.setCO(cf, ((r ^ (r << 1)) & sb) ? 1 : 0); return r;
      case 4: case 6: for (let i = 0; i < cnt; i++) { cf = (r & sb) ? 1 : 0; r = (r << 1) & m; } this.szp(r, w); this.setCO(cf, ((r & sb) ? 1 : 0) ^ cf); return r;
      case 5: { const o = (v & sb) ? 1 : 0; for (let i = 0; i < cnt; i++) { cf = r & 1; r >>= 1; } this.szp(r, w); this.setCO(cf, o); return r; }
      default: for (let i = 0; i < cnt; i++) { cf = r & 1; r = (r >> 1) | (r & sb); } this.szp(r, w); this.setCO(cf, 0); return r;
    }
  }
  cond(c) {
    const f = this.flags; let v;
    switch (c >> 1) {
      case 0: v = f & OF; break; case 1: v = f & CF; break; case 2: v = f & ZF; break; case 3: v = f & (CF | ZF); break;
      case 4: v = f & SF; break; case 5: v = f & PF; break; case 6: v = !(f & SF) !== !(f & OF); break;
      default: v = (f & ZF) || (!(f & SF) !== !(f & OF));
    }
    v = !!v; return (c & 1) ? !v : v;
  }
  interrupt(n) {
    this.push(this.flags); this.push(this.s[1]); this.push(this.ip);
    this.flags &= ~(IF | TF);
    this.ip = this.rw(n * 4); this.s[1] = this.rw(n * 4 + 2);
  }
  in8(p) { if (this.cyc && !this.io16) this.cyc.io(this, 0); if (p >= 0x3c0 && p <= 0x3df) return this.vga.portIn(p); const h = this.ports[p]; return h ? h.in(p) & 255 : 0xff; }
  out8(p, v) { if (this.cyc && !this.io16) this.cyc.io(this, 1); v &= 255; if (p >= 0x3c0 && p <= 0x3df) return this.vga.portOut(p, v); const h = this.ports[p]; if (h) h.out(p, v); }
  out16(p, v) { if (this.cyc) this.cyc.io(this, 1); this.io16 = true; this.out8(p, v & 255); this.out8(p + 1, v >> 8); this.io16 = false; }
  in16(p) { if (this.cyc) this.cyc.io(this, 0); this.io16 = true; const v = this.in8(p) | (this.in8(p + 1) << 8); this.io16 = false; return v; }
  // 依 SI/DI 方向推進
  dstep(w) { return (this.flags & DF) ? -(w ? 2 : 1) : (w ? 2 : 1); }
  string(op, rep) {
    const r = this.r, w = op & 1, srcSeg = this.segov >= 0 ? this.segov : 3, d = this.dstep(w);
    const base = op & 0xfe;
    if (rep && r[1] === 0) { if (this.cyc) this.cyc.rep(this, base, 0); return; }
    let it = 0;
    for (;;) {
      it++;
      switch (base) {
        case 0xa4: { const sa = this.lin(srcSeg, r[6]), da = this.lin(0, r[7]);
          if (w) this.ww(da, this.rw(sa)); else this.wb(da, this.rb(sa)); r[6] += d; r[7] += d; break; }
        case 0xa6: { const a = w ? this.rw(this.lin(srcSeg, r[6])) : this.rb(this.lin(srcSeg, r[6]));
          const b = w ? this.rw(this.lin(0, r[7])) : this.rb(this.lin(0, r[7])); this.alu(7, a, b, w); r[6] += d; r[7] += d; break; }
        case 0xaa: { const da = this.lin(0, r[7]); if (w) this.ww(da, r[0]); else this.wb(da, r[0] & 255); r[7] += d; break; }
        case 0xac: { const sa = this.lin(srcSeg, r[6]); if (w) r[0] = this.rw(sa); else this.s8(0, this.rb(sa)); r[6] += d; break; }
        case 0xae: { const b = w ? this.rw(this.lin(0, r[7])) : this.rb(this.lin(0, r[7])); this.alu(7, w ? r[0] : r[0] & 255, b, w); r[7] += d; break; }
        case 0x6c: { const da = this.lin(0, r[7]); if (w) this.ww(da, this.in16(r[2])); else this.wb(da, this.in8(r[2])); r[7] += d; break; }
        case 0x6e: { const sa = this.lin(srcSeg, r[6]); if (w) this.out16(r[2], this.rw(sa)); else this.out8(r[2], this.rb(sa)); r[6] += d; break; }
      }
      if (!rep) return;
      r[1]--;
      if (r[1] === 0) { if (this.cyc) this.cyc.rep(this, base, it); return; }
      if (base === 0xa6 || base === 0xae) { const z = !!(this.flags & ZF); if ((rep === 3 && !z) || (rep === 2 && z)) { if (this.cyc) this.cyc.rep(this, base, it); return; } }
    }
  }
  run(maxIns) {
    const end = this.icount + maxIns;
    while (!this.halted && this.icount < end) {
      if (this.pendingIRQ.length && (this.flags & IF)) { const ret = [this.s[1], this.ip, this.r[4], this.s[2]]; this.interrupt(this.pendingIRQ.shift()); if (this.cyc) this.cyc.irqEnter(this, ret); }
      if (this.onTick) this.onTick(this);
      this.step(); this.icount++;
    }
  }
  step() {
    this.segov = -1; let rep = 0, op;
    this.opCS = this.s[1]; this.opIP = this.ip;
    if (this.cyc) this.cyc.begin(this);
    for (;;) {
      op = this.f8();
      if (op === 0x26) { this.segov = 0; continue; } if (op === 0x2e) { this.segov = 1; continue; }
      if (op === 0x36) { this.segov = 2; continue; } if (op === 0x3e) { this.segov = 3; continue; }
      if (op === 0x64) { this.segov = 4; continue; } if (op === 0x65) { this.segov = 5; continue; }
      if (op === 0xf2) { rep = 2; continue; } if (op === 0xf3) { rep = 3; continue; } if (op === 0xf0) continue;
      break;
    }
    const r = this.r;
    if (op < 0x40 && (op & 7) < 6) {
      const a = op >> 3, k = op & 7; let v;
      switch (k) {
        case 0: this.modrm(); v = this.alu(a, this.grm8(), this.g8(this.mreg), 0); if (a !== 7) this.srm8(v); break;
        case 1: this.modrm(); v = this.alu(a, this.grm16(), r[this.mreg], 1); if (a !== 7) this.srm16(v); break;
        case 2: this.modrm(); v = this.alu(a, this.g8(this.mreg), this.grm8(), 0); if (a !== 7) this.s8(this.mreg, v); break;
        case 3: this.modrm(); v = this.alu(a, r[this.mreg], this.grm16(), 1); if (a !== 7) r[this.mreg] = v; break;
        case 4: v = this.alu(a, r[0] & 255, this.f8(), 0); if (a !== 7) this.s8(0, v); break;
        default: v = this.alu(a, r[0], this.f16(), 1); if (a !== 7) r[0] = v;
      }
      return;
    }
    if (op >= 0x40 && op < 0x48) { r[op - 0x40] = this.incdec(r[op - 0x40], 1, 0); return; }
    if (op >= 0x48 && op < 0x50) { r[op - 0x48] = this.incdec(r[op - 0x48], 1, 1); return; }
    if (op >= 0x50 && op < 0x58) { this.push(r[op - 0x50]); return; }
    if (op >= 0x58 && op < 0x60) { r[op - 0x58] = this.pop(); return; }
    if (op >= 0x70 && op < 0x80) { let d = this.f8(); if (d & 0x80) d -= 256; if (this.cond(op - 0x70)) this.ip = (this.ip + d) & 0xffff; return; }
    if (op >= 0x91 && op < 0x98) { const t = r[0]; r[0] = r[op - 0x90]; r[op - 0x90] = t; return; }
    if (op >= 0xb0 && op < 0xb8) { this.s8(op - 0xb0, this.f8()); return; }
    if (op >= 0xb8 && op < 0xc0) { r[op - 0xb8] = this.f16(); return; }
    switch (op) {
      case 0x06: this.push(this.s[0]); return; case 0x07: this.s[0] = this.pop(); return;
      case 0x0e: this.push(this.s[1]); return;
      case 0x16: this.push(this.s[2]); return; case 0x17: this.s[2] = this.pop(); return;
      case 0x1e: this.push(this.s[3]); return; case 0x1f: this.s[3] = this.pop(); return;
      case 0x27: case 0x2f: { let al = r[0] & 255; const oc = this.flags & CF, oa = this.flags & AF; let cf = 0, af = 0;
        if (op === 0x27) { if ((al & 15) > 9 || oa) { al += 6; af = 1; cf = oc || al > 255; } if ((r[0] & 255) > 0x99 || oc) { al += 0x60; cf = 1; } }
        else { const o = al; if ((al & 15) > 9 || oa) { al -= 6; af = 1; cf = oc || al < 0; } if (o > 0x99 || oc) { al -= 0x60; cf = 1; } }
        this.s8(0, al & 255); this.szp(al & 255, 0); this.flags = (this.flags & ~(CF | AF)) | (cf ? CF : 0) | (af ? AF : 0); return; }
      case 0x37: case 0x3f: { if ((r[0] & 15) > 9 || (this.flags & AF)) { if (op === 0x37) { r[0] = (r[0] + 0x106) & 0xffff; } else { this.s8(0, (r[0] - 6) & 255); this.s8(4, ((r[0] >> 8) - 1) & 255); } this.flags |= CF | AF; } else this.flags &= ~(CF | AF); this.s8(0, r[0] & 15); return; }
      case 0x0f: {
        const o2 = this.f8();
        if (o2 >= 0x80 && o2 < 0x90) { let d = this.f16(); if (d & 0x8000) d -= 65536; if (this.cond(o2 - 0x80)) this.ip = (this.ip + d) & 0xffff; return; }
        if (o2 === 0x01) { this.modrm(); if (this.mreg === 4) this.srm16(0xfff0); return; }
        if (o2 === 0xb6 || o2 === 0xbe) { this.modrm(); let v = this.grm8(); if (o2 === 0xbe && (v & 0x80)) v |= 0xff00; r[this.mreg] = v; return; }
        throw new Error(`0F ${o2.toString(16)} @${this.opCS.toString(16)}:${this.opIP.toString(16)}`);
      }
      case 0x60: { const sp = r[4]; this.push(r[0]); this.push(r[1]); this.push(r[2]); this.push(r[3]); this.push(sp); this.push(r[5]); this.push(r[6]); this.push(r[7]); return; }
      case 0x61: r[7] = this.pop(); r[6] = this.pop(); r[5] = this.pop(); this.pop(); r[3] = this.pop(); r[2] = this.pop(); r[1] = this.pop(); r[0] = this.pop(); return;
      case 0x62: this.modrm(); return;
      case 0x68: this.push(this.f16()); return;
      case 0x6a: { let v = this.f8(); if (v & 0x80) v |= 0xff00; this.push(v); return; }
      case 0x69: case 0x6b: { this.modrm(); let a = this.grm16(); if (a & 0x8000) a -= 65536;
        let b = op === 0x69 ? this.f16() : this.f8(); if (op === 0x69) { if (b & 0x8000) b -= 65536; } else if (b & 0x80) b -= 256;
        const p = a * b; r[this.mreg] = p & 0xffff; const ov = p < -32768 || p > 32767; this.setCO(ov, ov); return; }
      case 0x6c: case 0x6d: case 0x6e: case 0x6f: this.string(op, rep); return;
      case 0x80: case 0x81: case 0x82: case 0x83: {
        this.modrm(); const w = op & 1; const a = this.mreg;
        const x = w ? this.grm16() : this.grm8();
        let b = op === 0x81 ? this.f16() : this.f8(); if (op === 0x83 && (b & 0x80)) b |= 0xff00;
        const v = this.alu(a, x, b, w); if (a !== 7) { if (w) this.srm16(v); else this.srm8(v); } return; }
      case 0x84: this.modrm(); this.alu(4, this.grm8(), this.g8(this.mreg), 0); return;
      case 0x85: this.modrm(); this.alu(4, this.grm16(), r[this.mreg], 1); return;
      case 0x86: { this.modrm(); const a = this.grm8(); this.srm8(this.g8(this.mreg)); this.s8(this.mreg, a); return; }
      case 0x87: { this.modrm(); const a = this.grm16(); this.srm16(r[this.mreg]); r[this.mreg] = a; return; }
      case 0x88: this.modrm(); this.srm8(this.g8(this.mreg)); return;
      case 0x89: this.modrm(); this.srm16(r[this.mreg]); return;
      case 0x8a: this.modrm(); this.s8(this.mreg, this.grm8()); return;
      case 0x8b: this.modrm(); r[this.mreg] = this.grm16(); return;
      case 0x8c: this.modrm(); this.srm16(this.s[this.mreg & 7]); return;
      case 0x8d: this.modrm(); r[this.mreg] = this.moff; return;
      case 0x8e: this.modrm(); this.s[this.mreg & 7] = this.grm16(); return;
      case 0x8f: { this.modrm(); const v = this.pop(); this.srm16(v); return; }
      case 0x90: return;
      case 0x98: r[0] = (r[0] & 0x80) ? (r[0] | 0xff00) : (r[0] & 0xff); return;
      case 0x99: r[2] = (r[0] & 0x8000) ? 0xffff : 0; return;
      case 0x9a: { const o = this.f16(), sg = this.f16(); this.push(this.s[1]); this.push(this.ip); this.s[1] = sg; this.ip = o; return; }
      case 0x9b: return;
      case 0x9c: this.push((this.flags & 0x0fd5) | 0xf002); return;
      case 0x9d: this.flags = (this.pop() & 0x0fd5) | 0x0002; return;
      case 0x9e: this.flags = (this.flags & 0xff00) | ((r[0] >> 8) & 0xd5) | 2; return;
      case 0x9f: this.s8(4, this.flags & 255); return;
      case 0xa0: { const o = this.f16(); this.s8(0, this.rb(this.lin(this.segov >= 0 ? this.segov : 3, o))); return; }
      case 0xa1: { const o = this.f16(); r[0] = this.rw(this.lin(this.segov >= 0 ? this.segov : 3, o)); return; }
      case 0xa2: { const o = this.f16(); this.wb(this.lin(this.segov >= 0 ? this.segov : 3, o), r[0] & 255); return; }
      case 0xa3: { const o = this.f16(); this.ww(this.lin(this.segov >= 0 ? this.segov : 3, o), r[0]); return; }
      case 0xa4: case 0xa5: case 0xa6: case 0xa7: case 0xaa: case 0xab: case 0xac: case 0xad: case 0xae: case 0xaf: this.string(op, rep); return;
      case 0xa8: this.alu(4, r[0] & 255, this.f8(), 0); return;
      case 0xa9: this.alu(4, r[0], this.f16(), 1); return;
      case 0xc0: case 0xc1: case 0xd0: case 0xd1: case 0xd2: case 0xd3: {
        this.modrm(); const w = op & 1; const x = w ? this.grm16() : this.grm8();
        const cnt = (op === 0xc0 || op === 0xc1) ? this.f8() : (op >= 0xd2 ? r[1] & 255 : 1);
        const v = this.shift(this.mreg, x, cnt, w); if (w) this.srm16(v); else this.srm8(v); return; }
      case 0xc2: { const n = this.f16(); this.ip = this.pop(); r[4] = (r[4] + n) & 0xffff; return; }
      case 0xc3: this.ip = this.pop(); return;
      case 0xc4: case 0xc5: { this.modrm(); r[this.mreg] = this.rw(this.mea); this.s[op === 0xc4 ? 0 : 3] = this.rw(this.ea2()); return; }
      case 0xc6: this.modrm(); this.srm8(this.f8()); return;
      case 0xc7: this.modrm(); this.srm16(this.f16()); return;
      case 0xc8: { const sz = this.f16(), lv = this.f8() & 31; this.push(r[5]); const fp = r[4];
        for (let i = 1; i < lv; i++) { r[5] = (r[5] - 2) & 0xffff; this.push(this.rw(this.lin(2, r[5]))); }
        if (lv) this.push(fp); r[5] = fp; r[4] = (r[4] - sz) & 0xffff; return; }
      case 0xc9: r[4] = r[5]; r[5] = this.pop(); return;
      case 0xca: { const n = this.f16(); this.ip = this.pop(); this.s[1] = this.pop(); r[4] = (r[4] + n) & 0xffff; return; }
      case 0xcb: this.ip = this.pop(); this.s[1] = this.pop(); return;
      case 0xcc: this.interrupt(3); return;
      case 0xcd: this.interrupt(this.f8()); return;
      case 0xce: if (this.flags & OF) this.interrupt(4); return;
      case 0xcf: this.ip = this.pop(); this.s[1] = this.pop(); this.flags = (this.pop() & 0x0fd5) | 2; return;
      case 0xd4: { const b = this.f8(); if (!b) { this.interrupt(0); return; } const al = r[0] & 255; this.s8(4, (al / b) | 0); this.s8(0, al % b); this.szp(r[0] & 255, 0); return; }
      case 0xd5: { const b = this.f8(); const v = ((r[0] & 255) + (r[0] >> 8) * b) & 255; r[0] = v; this.szp(v, 0); return; }
      case 0xd6: this.s8(0, (this.flags & CF) ? 0xff : 0); return;
      case 0xd7: this.s8(0, this.rb(this.lin(this.segov >= 0 ? this.segov : 3, (r[3] + (r[0] & 255)) & 0xffff))); return;
      case 0xd8: case 0xd9: case 0xda: case 0xdb: case 0xdc: case 0xdd: case 0xde: case 0xdf: this.modrm(); return;
      case 0xe0: case 0xe1: case 0xe2: case 0xe3: {
        let d = this.f8(); if (d & 0x80) d -= 256; let j;
        if (op === 0xe3) j = r[1] === 0;
        else { r[1]--; j = r[1] !== 0; if (op === 0xe0) j = j && !(this.flags & ZF); if (op === 0xe1) j = j && !!(this.flags & ZF); }
        if (j) this.ip = (this.ip + d) & 0xffff; return; }
      case 0xe4: this.s8(0, this.in8(this.f8())); return;
      case 0xe5: r[0] = this.in16(this.f8()); return;
      case 0xe6: this.out8(this.f8(), r[0] & 255); return;
      case 0xe7: this.out16(this.f8(), r[0]); return;
      case 0xe8: { const d = this.f16(); this.push(this.ip); this.ip = (this.ip + d) & 0xffff; return; }
      case 0xe9: { const d = this.f16(); this.ip = (this.ip + d) & 0xffff; return; }
      case 0xea: { const o = this.f16(), sg = this.f16(); this.ip = o; this.s[1] = sg; return; }
      case 0xeb: { let d = this.f8(); if (d & 0x80) d -= 256; this.ip = (this.ip + d) & 0xffff; return; }
      case 0xec: this.s8(0, this.in8(r[2])); return;
      case 0xed: r[0] = this.in16(r[2]); return;
      case 0xee: this.out8(r[2], r[0] & 255); return;
      case 0xef: this.out16(r[2], r[0]); return;
      case 0xf1: { const n = this.f8(); const h = this.hooks[n];
        if (!h) throw new Error(`no hook ${n.toString(16)}`); h(this); return; }
      case 0xf4: this.halted = true; return;
      case 0xf5: this.flags ^= CF; return;
      case 0xf6: case 0xf7: {
        this.modrm(); const w = op & 1; const x = w ? this.grm16() : this.grm8();
        switch (this.mreg) {
          case 0: case 1: this.alu(4, x, w ? this.f16() : this.f8(), w); return;
          case 2: if (w) this.srm16(~x); else this.srm8(~x); return;
          case 3: { const v = this.alu(5, 0, x, w); if (w) this.srm16(v); else this.srm8(v); this.flags = (this.flags & ~CF) | (x ? CF : 0); return; }
          case 4: if (w) { const p = r[0] * x; r[0] = p & 0xffff; r[2] = (p >>> 16) & 0xffff; this.setCO(r[2] !== 0, r[2] !== 0); }
                  else { const p = (r[0] & 255) * x; r[0] = p; this.setCO(p > 255, p > 255); } return;
          case 5: if (w) { const a = (r[0] << 16) >> 16, b = (x << 16) >> 16, p = a * b; r[0] = p & 0xffff; r[2] = (p >> 16) & 0xffff; const ov = p < -32768 || p > 32767; this.setCO(ov, ov); }
                  else { const a = ((r[0] & 255) << 24) >> 24, b = (x << 24) >> 24, p = a * b; r[0] = p & 0xffff; const ov = p < -128 || p > 127; this.setCO(ov, ov); } return;
          case 6: if (w) { if (!x) { this.ip = this.opIP; this.interrupt(0); return; } const n = r[2] * 65536 + r[0]; const q = Math.floor(n / x); if (q > 0xffff) { this.ip = this.opIP; this.interrupt(0); return; } r[0] = q; r[2] = n % x; }
                  else { if (!x) { this.ip = this.opIP; this.interrupt(0); return; } const n = r[0]; const q = (n / x) | 0; if (q > 255) { this.ip = this.opIP; this.interrupt(0); return; } this.s8(0, q); this.s8(4, n % x); } return;
          default: if (w) { const b = (x << 16) >> 16; if (!b) { this.ip = this.opIP; this.interrupt(0); return; } const n = (r[2] << 16) | r[0]; const q = Math.trunc(n / b); if (q > 32767 || q < -32768) { this.ip = this.opIP; this.interrupt(0); return; } r[0] = q & 0xffff; r[2] = (n % b) & 0xffff; }
                   else { const b = (x << 24) >> 24; if (!b) { this.ip = this.opIP; this.interrupt(0); return; } const n = (r[0] << 16) >> 16; const q = Math.trunc(n / b); if (q > 127 || q < -128) { this.ip = this.opIP; this.interrupt(0); return; } this.s8(0, q & 255); this.s8(4, (n % b) & 255); } return;
        } }
      case 0xf8: this.flags &= ~CF; return; case 0xf9: this.flags |= CF; return;
      case 0xfa: this.flags &= ~IF; return; case 0xfb: this.flags |= IF; return;
      case 0xfc: this.flags &= ~DF; return; case 0xfd: this.flags |= DF; return;
      case 0xfe: { this.modrm(); this.srm8(this.incdec(this.grm8(), 0, this.mreg & 1)); return; }
      case 0xff: {
        this.modrm();
        switch (this.mreg) {
          case 0: this.srm16(this.incdec(this.grm16(), 1, 0)); return;
          case 1: this.srm16(this.incdec(this.grm16(), 1, 1)); return;
          case 2: { const t = this.grm16(); this.push(this.ip); this.ip = t; return; }
          case 3: { const o = this.rw(this.mea), sg = this.rw(this.ea2()); this.push(this.s[1]); this.push(this.ip); this.s[1] = sg; this.ip = o; return; }
          case 4: this.ip = this.grm16(); return;
          case 5: { const o = this.rw(this.mea), sg = this.rw(this.ea2()); this.s[1] = sg; this.ip = o; return; }
          default: this.push(this.grm16()); return;
        } }
    }
    throw new Error(`bad opcode ${op.toString(16)} @${this.opCS.toString(16)}:${this.opIP.toString(16)}`);
  }
}
const X86 = { CPU, VGA, FLAGS: { CF, PF, AF, ZF, SF, TF, IF, DF, OF } };
if (typeof session !== "undefined") session.X86 = X86;
G.X86 = X86;
})(typeof globalThis !== "undefined" ? globalThis : this);
