// sfx.js — FM 效果音 (RE_NOTES 第 35 节): FMDRV.COM 效果音声部 4/5 的翻译 (FmDriver) 与 MAIN.EXE 的 9768 / 9804 / 9888 (SfxPort)
// 原版: MAIN.EXE 以 int86(0x66) 调用 FMDRV.COM 的 AH=05 音色 (DS:DX)、AH=06 发音 (DL = 音高)、AH=07 放键;
//   FMDRV 的 IRQ0 (CS:01d0, 291.304 Hz) 每次 [0120] += 36h, 进位时 11a6 处理软件 LFO (每秒约 61.45 次)。
// FmDriver: 内存依 FMDRV 的 DS 排法 (地址 = COM 加载后的 IP): 声部记录 DS:048c + 2Eh × i (i = 0..5; 4/5 = 效果音)、节奏 DS:05a0、
//   [05ce] LFO 计数、[05d0] 随机数、[05e4] BD 寄存器、[0120] / [0121] IRQ0 累加器与 BIOS 转送计数。输出 = OPL 寄存器写入 write(reg, val)。
//   函数名 = FMDRV 的地址。移植版没有 FM 乐曲 (BGM 用 PS 版 mp3), 所以 [0118] 恒 0、声部 0..3 与节奏声部只有初始化。
// SfxPort: 主线程端; 依 [03e4] (有 FMDRV, 移植版恒有) 与 [0ca4] bit3 (效果音开关) 决定是否送出, 实际的合成在 AudioWorklet (sfx_worklet.js)。
//   测试模式 (Node) 没有 AudioContext: 不出声、不碰游戏状态; 指令可记录到 log 供差分测试比对。

// MAIN.EXE DS:0bc0..0c70 的 9 组效果音音色 (每组 0x16 bytes, 格式同 MML F4 音色: 0..10 = 20/23/C0/E0/E3/40/43/60/63/80/83 寄存器,
//   0B = 有号移调, 0C..0D = LFO 速率, 0E = 波形, 0F = 音高深度, 10 = 速率表 DS:0600 索引, 11 = 音量深度, 12/13 = 两操作符的音量比例, 14 = 延迟, 15 = LFO 开)
export const SFX_VOICES = {
  0x0bc0: [0xaf, 0xaf, 0x0c, 0x03, 0x00, 0x00, 0x00, 0xf6, 0xf5, 0x11, 0xff, 0x08, 0x64, 0x19, 0x01, 0x16, 0x05, 0x32, 0x00, 0x00, 0x01, 0x01],   // 一骑打 (没打中)
  0x0bd6: [0xac, 0xa9, 0x0c, 0x03, 0x00, 0x00, 0x00, 0xf6, 0xf5, 0x11, 0xff, 0x0c, 0x40, 0x1f, 0x02, 0x16, 0x05, 0x32, 0x00, 0x00, 0x01, 0x01],   // 一骑打 (打中)
  0x0bec: [0x20, 0x00, 0x0e, 0x00, 0x00, 0x07, 0x00, 0xf0, 0xf0, 0x08, 0x05, 0xe8, 0x40, 0x1f, 0x02, 0xce, 0x0a, 0xf1, 0x00, 0x00, 0x01, 0x01],   // 砲弹轨迹 / 砲击
  0x0c02: [0x23, 0x21, 0x0d, 0x03, 0x01, 0x85, 0x45, 0x5f, 0x53, 0x0f, 0x0f, 0x00, 0x50, 0x46, 0x01, 0x64, 0x0b, 0x8d, 0x00, 0x00, 0x00, 0x01],   // 接舷
  0x0c18: [0x01, 0x11, 0x0f, 0x00, 0x02, 0x00, 0x00, 0xfa, 0xf1, 0xf0, 0xff, 0x18, 0x58, 0x1b, 0x01, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x01],   // 发现物 (348ff)
  0x0c2e: [0x00, 0x00, 0x00, 0x00, 0x00, 0x0f, 0x08, 0xff, 0x90, 0xa0, 0x03, 0x0b, 0x10, 0x27, 0x04, 0x64, 0x0f, 0x81, 0x00, 0x00, 0x02, 0x01],   // 航海等级提高 (1bc14)
  0x0c44: [0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0x00, 0xf0, 0xf0, 0x00, 0x04, 0xf5, 0x10, 0x27, 0x02, 0x9c, 0x0f, 0x81, 0x00, 0x00, 0x02, 0x01],   // 海上特殊地点 (30e9f)
  0x0c5a: [0x0a, 0x00, 0x0e, 0x02, 0x02, 0x07, 0x00, 0x70, 0x20, 0x00, 0x00, 0x00, 0x46, 0x00, 0x02, 0x32, 0x0f, 0x00, 0x00, 0x00, 0x00, 0x01],   // 暴风雨
  0x0c70: [0x0f, 0x01, 0x0c, 0x02, 0x01, 0x00, 0x00, 0xf0, 0xf6, 0x00, 0xf0, 0x00, 0x64, 0x19, 0x02, 0x1e, 0x05, 0x32, 0x00, 0x00, 0x08, 0x00],   // (MAIN.EXE 没有引用)
};
// FMDRV.COM 的表: DS:05e6 滑音半音比例 (13 字)、DS:0600 LFO 速率比例 (16 字)、DS:0620 F-Number (C..B 12 字; 后 12 字是其后的代码字节,
//   半音索引超出 11 时原版会读到它们, 照搬)
const FM_T05E6 = [0x0000, 0x079c, 0x0fad, 0x1838, 0x2145, 0x2adc, 0x3505, 0x3fc8, 0x4b2f, 0x5744, 0x6411, 0x71a1, 0x7fff];
const FM_T0600 = [0x004c, 0x0072, 0x00be, 0x010a, 0x017d, 0x02fe, 0x079c, 0x0fad, 0x2145, 0x2adc, 0x3fc8, 0x4b2f, 0x5744, 0x7fff, 0x9f58, 0xea08];
const FM_T0620 = [0x0157, 0x016b, 0x0181, 0x0198, 0x01b0, 0x01ca, 0x01e5, 0x0202, 0x0220, 0x0241, 0x0263, 0x0287,
  0x5150, 0xba52, 0x0388, 0x04b9, 0xec00, 0xfde2, 0x595a, 0xc358, 0x5150, 0xba52, 0x0388, 0x17b9];
const FM_V0 = 0x048c, FM_VL = 0x2e, FM_RHY = 0x05a0;
const fmS8 = v => (v << 24) >> 24, fmS16 = v => (v << 16) >> 16;

export class FmDriver {
  constructor(write) {
    this.out = write;                                              // OPL 寄存器写入 (0658: 388h = 索引, 389h = 数据)
    this.m = new Uint8Array(0x700);
    this.vd = new Map();                                           // 声部 → 音色数据 (原版 [di+16] / [di+18] = ES:SI)
    for (let i = 0; i < 6; i++) { this.m[FM_V0 + FM_VL * i + 0x26] = i; this.m[FM_V0 + FM_VL * i + 0x27] = [0, 1, 2, 8, 9, 10][i]; }   // 声道 / 操作符偏移 (COM 档内的初值)
    this.m[FM_RHY + 0x26] = 6;
    this.m[0x05d0] = 0x7d; this.m[0x05d1] = 0x03;                  // [05d0] = 037d
    this.m[0x0121] = 1;
  }
  b(a) { return this.m[a]; }
  sb(a, v) { this.m[a] = v & 0xff; }
  w(a) { return this.m[a] | (this.m[a + 1] << 8); }
  sw(a, v) { this.m[a] = v & 0xff; this.m[a + 1] = (v >> 8) & 0xff; }
  opl(ah, al) { this.out(ah & 0xff, al & 0xff); }                   // 0658
  // ---- 常驻时的初始化: 132b OPL 侦测、12cf → 1267 ----
  init() {
    this.opl(0x04, 0x60); this.opl(0x04, 0x80); this.opl(0x02, 0xff); this.opl(0x04, 0x21); this.opl(0x04, 0x60); this.opl(0x04, 0x80);   // 132b
    this.sb(0x0128, 0xff);                                         // 12cf
    this.opl(0x01, 0x20); this.opl(0x08, 0x40); this.opl(0xbd, 0x00);   // 1267
    for (let i = 0; i < 6; i++) { const di = FM_V0 + FM_VL * i; this.f08a3(di); this.f06ae(di); }
    this.f08a3(FM_RHY); this.f06f0();
  }
  // 06f0 节奏声部初始化
  f06f0() {
    this.opl(0xbd, (this.b(0x05e4) & 0xe0) | 0x20); this.sb(0x05a6, 0x20);
    let ah = 0xa6; for (let k = 0; k < 3; k++) { this.opl(ah, 0); ah += 0x10; this.opl(ah, 0); ah = (ah + 0xf1) & 0xff; }
    ah = 0x90; for (let k = 0; k < 3; k++) { this.opl(ah, 0x0f); ah += 3; this.opl(ah, 0x0f); ah -= 2; }
    ah = 0x50; for (let k = 0; k < 3; k++) { this.opl(ah, 0x3f); ah += 3; this.opl(ah, 0x3f); ah -= 2; }
  }
  // 08a3 声部记录重设 (前 26h bytes 清 0)
  f08a3(di) {
    this.m.fill(0, di, di + 0x26); this.vd.delete(di);
    this.sb(di + 4, 1); this.sb(di + 6, 0xff); this.sb(di + 7, 0x30); this.sb(di + 8, 0x2d); this.sb(di + 9, 1); this.sw(di + 0x22, 1);
  }
  // 06ae 静音: A0/B0 = 0, 80/83 = 0F, 40/43 = 3F
  f06ae(di) {
    this.sw(di + 0x2a, 0);
    let ah = (this.b(di + 0x26) + 0xa0) & 0xff; this.opl(ah, 0); ah = (ah + 0x10) & 0xff; this.opl(ah, 0);
    ah = (this.b(di + 0x27) + 0x80) & 0xff; this.opl(ah, 0x0f); ah = (ah + 3) & 0xff; this.opl(ah, 0x0f);
    ah = (ah + 0xbd) & 0xff; this.opl(ah, 0x3f); this.sb(di + 0x28, 0x3f); ah = (ah + 3) & 0xff; this.opl(ah, 0x3f); this.sb(di + 0x29, 0x3f);
    this.m[di + 4] &= 0x1f; this.m[di + 0x1b] &= 0xbf;
  }
  // 0670 触键 / 0692 放键
  f0670(di) {
    if (this.b(di + 0x2c) & 0x80) return;
    const al = this.b(di + 0x2b) | 0x20; this.sb(di + 0x2b, al); this.opl(this.b(di + 0x26) + 0xb0, al);
    this.m[di + 4] |= 0xc0; this.m[di + 0x1b] |= 3;
  }
  f0692(di) {
    const al = this.b(di + 0x2b) & 0xdf; this.sb(di + 0x2b, al); this.opl(this.b(di + 0x26) + 0xb0, al);
    this.m[di + 4] &= 0x5f; this.m[di + 0x1b] &= 0xbf;
  }
  // 073e 音色的 11 个寄存器
  f073e(di, d) {
    const bh = this.b(di + 0x27), bl = this.b(di + 0x26);
    let ah = 0x20 + bh; this.opl(ah, d[0]); ah += 3; this.opl(ah, d[1]);
    this.opl(0xc0 + bl, d[2]);
    ah = 0xe0 + bh; this.opl(ah, d[3]); ah += 3; this.opl(ah, d[4]);
    for (let k = 5; k < 11; k += 2) { ah = (ah + (k === 5 ? 0x5d : 0x1d)) & 0xff; this.opl(ah, d[k]); ah += 3; this.opl(ah, d[k + 1]); }
  }
  // 079a 操作符音量: 衰减 = ~((~TL & 3F) − (~TL & 3F) × [d+14] / 7F) & 3F, 保留 KSL 比特; 与 [d+28] 相同时不写
  f079a(d, ah, al) {
    let bh = ~al & 0x3f; const q = Math.floor((bh * this.b(d + 0x14)) / 0x7f) & 0xff;
    bh -= q; if (bh < 0) bh = 0;
    let v = ~bh & 0x3f; const old = this.b(d + 0x28); v |= old & 0xc0;
    if (v !== old) { this.sb(d + 0x28, v); this.opl(ah, v); }
  }
  // 07ca 频率 (A0 / B0, 保留触键比特); 与 [2a] 相同时不写
  f07ca(di, ax) {
    const bx = ax & 0xdfff, cur = this.w(di + 0x2a) & 0xdfff;
    if (cur === bx) return;
    const ch = this.b(di + 0x26);
    this.sb(di + 0x2a, bx & 0xff); this.opl(0xa0 + ch, bx & 0xff);
    const al = (this.b(di + 0x2b) & 0x20) | (bx >> 8); this.sb(di + 0x2b, al); this.opl(0xb0 + ch, al);
  }
  // 0818 淡出量 [05d5] (只用于声部 0..3)
  f0818(al) {
    let ah = this.b(0x05d5); ah = ah >= 0x80 ? ah - 0x40 : ah >> 1;
    al += ah; return al > 0x7f ? 0x7f : al;
  }
  // 096a 音量 al → 载波 (相加型时调制器也) TL
  f096a(di, al) {
    al += this.b(di + 0x2c) & 0x7f; if (al > 0x7f) al = 0x7f;
    if (this.b(di + 0x26) < 4) al = this.f0818(al);
    const dl = al >> 1, d = this.vd.get(di);
    if (!this.voicePtr(di)) return;
    let dh = d[2] | 2, ah = (this.b(di + 0x27) + 0x40) & 0xff;
    for (let k = 0; k < 2; k++) {
      let a = d[5 + k] & 0x3f;
      const cf = dh & 1; dh >>= 1;
      if (cf) { a += dl; if (a > 0x3f) a = 0x3f; }
      this.sb(di + k + 0x12, a);
      this.f079a(di + k, ah, a);
      ah = (ah + 3) & 0xff;
    }
  }
  voicePtr(di) { return (this.w(di + 0x16) | this.w(di + 0x18)) !== 0; }
  // 09c7
  f09c7(di) { this.sb(di + 0x14, 0); this.sb(di + 0x15, 0); this.f096a(di, this.b(di + 5)); }
  // 09ff 加载音色 (addr = DS 地址, d = 22 bytes)
  f09ff(di, addr, d, seg) {
    this.sw(di + 0x16, addr); this.sw(di + 0x18, seg); this.vd.set(di, d);   // [18] = ES (调用者的 DS)
    this.f06ae(di);
    this.f073e(di, d);
    this.sb(di + 0x28, d[5]); this.sb(di + 0x29, d[6]); this.sb(di + 0x1a, d[0x0b]);
    this.m[di + 0x1b] &= 0x7f; this.m[di + 4] &= 0xfb;
    if (d[0x15]) { this.m[di + 4] |= 4; if (this.b(di + 4) & 8) this.m[di + 0x1b] |= 0x80; }
    this.f09c7(di);
  }
  // 0bd2 发音 (al = 音高, ah ≠ 0)
  f0bd2(di, al, ah) {
    if (ah === 0) { this.sb(di + 6, 0xff); if (this.b(di + 4) & 0x80) this.f0692(di); }
    else {
      const sum = (al + fmS8(this.b(di + 0x1a)) + fmS8(this.b(di + 0x2d))) & 0xffff;   // 16 比特
      const s = fmS16(sum), quot = Math.trunc(s / 12) & 0xff, rem = (s % 12) & 0xff;   // idiv cl
      let bl = quot, bh = rem, n = sum & 0xff;
      if (sum >> 8) { bl = 0; if (bh) bh = (bh + 12) & 0xff; n = bh; }   // 负数 (或 ≥ 256): 八度 0
      else if (bl > 7) { bl = 7; n = (bh + 0x54) & 0xff; }
      let skip = false;
      if (this.b(di + 4) & 0x20) { if (n === this.b(di + 6)) skip = true; }
      else if (this.b(di + 4) & 0x80) this.f0692(di);
      if (!skip) {
        this.sb(di + 6, n);
        const ax = (FM_T0620[bh] | (((bl << 2) & 0xff) << 8)) & 0xffff;
        this.f07ca(di, ax); this.sw(di + 0x10, ax);
        if (!(this.b(di + 4) & 0x20)) this.f0670(di);
        this.m[di + 0x1b] &= 0xbf;
      }
      if (this.b(di + 4) & 2) this.m[di + 0x1b] |= 0x40;
    }
    // 0c60
    const a7 = this.b(di + 7), a8 = this.b(di + 8);
    this.sb(di + 9, a7); this.sb(di + 0x0a, a8);
    this.m[di + 4] &= 0xdd;
    if (a8 > a7) this.m[di + 4] |= 0x20;
  }
  // ---- 软件 LFO (11a6 → 1110) ----
  // 0f66: [24] += [1c] × [22]; 跨过正负号时还原并返回 CF
  f0f66(di) {
    const ax = Math.imul(fmS16(this.w(di + 0x1c)), fmS16(this.w(di + 0x22))) & 0xffff, dx = this.w(di + 0x24);
    let v = (dx + ax) & 0xffff, cf = 0;
    if ((dx ^ v) & 0x8000) { v = (v - ax) & 0xffff; cf = 1; }
    this.sw(di + 0x24, v); return [v, cf];
  }
  f0f7f(di) { const [v, cf] = this.f0f66(di); if (cf) this.sw(di + 0x24, -this.w(di + 0x24)); return v; }   // 波形 0: 锯齿
  f0fc1(di) {                                                      // 波形 1: 方波
    const cx = Math.floor(0x7fff / this.w(di + 0x1c)) & 0xffff;
    const q = Math.floor(this.w(di + 0x20) / cx);
    const v = q & 1 ? 0x8000 : 0x7fff; this.sw(di + 0x24, v); return v;
  }
  f0f88(di) {                                                      // 波形 2: 三角
    const ax = Math.imul((this.w(di + 0x1c) << 1) & 0xffff, fmS16(this.w(di + 0x22))) & 0xffff, cx = this.w(di + 0x22), dx = this.w(di + 0x24);
    let v = (dx + ax) & 0xffff;
    if (((dx ^ v) & 0x8000) && ((cx ^ v) & 0x8000)) { v = (v - ax) & 0xffff; this.sw(di + 0x22, -cx); }
    this.sw(di + 0x24, v); return v;
  }
  f0fe2(di) {                                                      // 波形 3: 随机 (DS:05d0)
    const cx = (Math.floor(0x7fff / this.w(di + 0x1c)) & 0xffff) | 1;
    const r = fmS16(this.w(di + 0x20)) % fmS16(cx);
    let ax = this.w(0x05d0);
    if (r === 0) { ax = ((Math.imul(fmS16(ax), 0x383) % 0x7fff) & 0xffff); this.sw(0x05d0, ax); }
    return ax;
  }
  f0fac(di) {                                                      // 波形 4: 单次上升到 7FFF (滑音也用)
    if (this.w(di + 0x24) === 0x7fff) return 0x7fff;
    const [v, cf] = this.f0f66(di);
    if (!cf) return v;
    this.sw(di + 0x24, 0x7fff); return 0x7fff;
  }
  f1016(di, d) {
    let bl = d[0x0e]; if (bl > 4) bl = 0;
    let ax = [this.f0f7f, this.f0fc1, this.f0f88, this.f0fe2, this.f0fac][bl].call(this, di);
    if (ax === 0x8000) ax = 0x8001;
    return ax;
  }
  // 1030 音高 LFO: 量 = 深度 [0f] × LFO / 7F → 103d
  f1030(di, d, ax) { const p = fmS8(d[0x0f]) * fmS16(ax); this.f103d(di, Math.trunc(p / 0x7f) & 0xffff); }
  // 103d 频率 [10] 依量 cx (有号) 与 [1e] 比例变化: 正 → F 加 F × cx × [1e] / 7FFF² (超过 3FF 进位八度); 负 → F × 7FFF / (7FFF + |cx| × [1e] / 7FFF)
  f103d(di, cx) {
    const f10 = this.w(di + 0x10); let ax = f10 & 0x3ff, bx;
    if (!(cx & 0x8000)) {
      ax = Math.floor((ax * cx) / 0x7fff) & 0xffff;
      ax = Math.floor((ax * this.w(di + 0x1e)) / 0x7fff) & 0xffff;
      bx = f10 & 0x1c00; ax = (ax + (f10 & 0x3ff)) & 0xffff;
      while (ax > 0x3ff) { if (bx < 0x1c00) { bx += 0x400; ax >>= 1; } else { bx = 0x1c00; ax = 0x3ff; } }
    } else {
      const a = (-cx) & 0xffff;
      const c1 = Math.floor((a * this.w(di + 0x1e)) / 0x7fff) & 0xffff;
      let num = ax * 0x7fff, den = c1 + 0x7fff;
      if (den > 0xffff) { den >>= 1; num = Math.floor(num / 2); }   // rcr cx / shr dx, rcr ax
      ax = Math.floor(num / den) & 0xffff;
      bx = f10 & 0x1c00;
    }
    ax |= bx; this.f07ca(di, ax);
    return ax;
  }
  // 10a5 音量 LFO: 依波形换算 LFO → × |深度 [11]| / FFFE (深度为负时取 ~LFO), 两操作符各 × [12+k] / 0F → [di+14+k] → 079a
  f10a5(di, d, ax) {
    const wf = d[0x0e];
    if (wf === 4) ax = (ax << 1) & 0xffff;
    else if (wf === 1) ax = ax & 0x8000 ? 0xffff : 0;
    else if (wf === 2) { ax = ax & 0x8000 ? (-ax) & 0xffff : ax; ax = (ax << 1) & 0xffff; }
    const dep = fmS8(d[0x11]), cx = (dep < 0 ? (-dep) & 0xff : dep) & 0x7f;
    if (dep < 0) ax = ~ax & 0xffff;
    ax = Math.floor((ax * cx) / 0xfffe) & 0xffff;
    let dh = (this.b(di + 0x27) + 0x40) & 0xff;
    for (let k = 0; k < 2; k++) {
      const v = Math.floor((ax * (d[0x12 + k] & 0x0f)) / 0x0f) & 0xffff;
      this.sb(di + k + 0x14, v & 0xff);
      this.f079a(di + k, dh, this.b(di + k + 0x12));
      dh = (dh + 3) & 0xff;
    }
  }
  // 1110 LFO 状态机 ([1b] 比特 7 = 开, 比特 0..1: 3 = 触键后重新开始, 1 = 延迟中, 2 = 进行中)
  f1110(di, d) {
    const inc = () => this.sw(di + 0x20, this.w(di + 0x20) + 1);   // 11a2
    if (!(this.b(di + 0x1b) & 0x80)) { inc(); return; }
    if (!(this.b(di + 4) & 0xc0)) { this.m[di + 0x1b] |= 3; inc(); return; }   // 没有按着键
    this.sw(di + 0x1e, FM_T0600[d[0x10] & 0x0f]);
    const rate = d[0x0c] | (d[0x0d] << 8); this.sw(di + 0x1c, rate);
    if (!rate) { this.m[di + 0x1b] |= 3; inc(); return; }
    let st = this.b(di + 0x1b) & 3, run = false;
    if (st === 0) { inc(); return; }
    if (st === 3) {
      this.sb(di + 0x1b, (this.b(di + 0x1b) & 0xfc) | 1);
      const dl = d[0x14];
      if (dl === 0) {
        if (d[0x0e] !== 4) { this.sw(di + 0x20, this.w(0x05ce)); this.sb(di + 0x1b, (this.b(di + 0x1b) & 0xfc) | 2); run = true; }   // 116e: 相位 = 全域计数 [05ce]
        else st = -1;
      } else if (dl === 1) st = -1;
      else { this.sw(di + 0x20, ((dl - 1) & 0xff) << 2); inc(); return; }   // 延迟 = (al − 1) × 4 + 1 次
    } else if (st === 1) {
      this.sw(di + 0x20, this.w(di + 0x20) - 1);
      if (this.w(di + 0x20)) return;                               // 11a5: 不递增
      st = -1;
    } else run = true;                                             // st = 2
    if (st === -1) {                                               // 1182
      this.sw(di + 0x20, 0); this.sw(di + 0x24, 0); this.sw(di + 0x22, 1);
      this.sb(di + 0x1b, (this.b(di + 0x1b) & 0xfc) | 2); run = true;
    }
    if (run) { const ax = this.f1016(di, d); this.f1030(di, d, ax); this.f10a5(di, d, ax); }
    inc();
  }
  // 11a6 (效果音计时; 乐曲淡出 [05d2] 在移植版恒为 0, 略过)
  f11a6() {
    for (let i = 0; i < 6; i++) {
      const di = FM_V0 + FM_VL * i;
      if (this.b(di + 0x1b) & 0x40) {                              // 滑音 (只有 MML F7 会设, 效果音声部不会)
        let ax = this.f0fac(di); if (this.b(di + 0x1b) & 4) ax = (-ax) & 0xffff;
        ax = this.f103d(di, ax);
        if (this.w(di + 0x24) === 0x7fff) { this.sw(di + 0x10, ax); this.m[di + 0x1b] &= 0xbf; }
      } else if (this.voicePtr(di)) this.f1110(di, this.vd.get(di));
    }
    this.sw(0x05ce, this.w(0x05ce) + 1);
  }
  // IRQ0 (01d0): [0120] += 36h 进位 → [011e]++; 每 16 次转给 BIOS (这一次不处理); 否则 08ce 把累积的计时跑完
  irq0() {
    const a = this.b(0x0120) + 0x36; this.sb(0x0120, a); if (a > 0xff) this.sw(0x011e, this.w(0x011e) + 1);
    const c = (this.b(0x0121) - 1) & 0xff; this.sb(0x0121, c);
    if (c === 0) { this.sb(0x0121, 0x10); return; }
    if (this.b(0x05e5) || !this.w(0x011e) || !this.b(0x0128)) return;
    while (this.w(0x011e)) { this.f11a6(); this.sw(0x011e, this.w(0x011e) - 1); }
  }
  // INT 66h AH=05..07 (al = 声部 0/1; AH=05 的 addr / d 为 null = DS:DX 为 0; seg = 调用者的 DS, 只记录在 [di+18], 默认 MAIN.EXE 的 DGROUP 3925)
  int66(ah, al, dl, addr, d, seg = 0x3925) {
    if (al >= 2) return;                                           // 0317
    const di = FM_V0 + FM_VL * (al + 4);
    if (ah === 5) {
      this.f06ae(di);
      if (!d) {
        this.f08a3(di);
        const r = (this.b(di + 0x27) + 0x40) & 0xff;
        this.opl(r, 0x3f); this.sb(di + 0x28, 0x3f); this.opl(r + 3, 0x3f); this.sb(di + 0x29, 0x3f);
      } else { this.sb(di + 5, 0); this.m[di + 4] |= 8; this.f09ff(di, addr, d, seg); }
    } else if (ah === 6) {
      if (dl > 0x5f) return;
      this.m[di + 4] &= 0x9d; this.f0bd2(di, dl, 1); this.m[di + 4] &= 0xdd;
    } else if (ah === 7) this.f0692(di);
  }
}

// ---- 主线程: MAIN.EXE 9768 / 9804 / 9888 ----
export class SfxPort {
  // url: AudioWorklet 模块 (core/sfx_worklet.js, 相对于页面); 测试时为 null
  constructor(url, opts = {}) {
    this.url = url; this.present = true;                           // [03e4]: 移植版恒有音源驱动
    this.state = null;                                             // GameState ([0ca4] bit3)
    this.gain = opts.gain ?? 2; this.volume = 0.8; this.muted = false;
    this.log = opts.log || null; this.node = null; this.gainNode = null; this.q = [];
  }
  get effectiveGain() { return this.muted ? 0 : this.gain * Math.max(0, Math.min(1, this.volume)); }
  setVolume(v) { this.volume = Math.max(0, Math.min(1, +v || 0)); if (this.gainNode) this.gainNode.gain.value = this.effectiveGain; }
  setMuted(m) { this.muted = !!m; if (this.gainNode) this.gainNode.gain.value = this.effectiveGain; }
  // 第一次用户操作时创建 AudioContext (浏览器的自动播放限制)
  resume() {
    if (!this.url || typeof AudioContext === "undefined") return;
    if (this.ac) { if (this.ac.state === "suspended") this.ac.resume().catch(() => {}); return; }
    const ac = this.ac = new AudioContext();
    ac.audioWorklet.addModule(this.url).then(() => {
      const node = new AudioWorkletNode(ac, "uw2-sfx", { numberOfInputs: 0, outputChannelCount: [2] });
      const g = ac.createGain(); g.gain.value = this.effectiveGain; node.connect(g); g.connect(ac.destination);
      this.gainNode = g;
      this.node = node; for (const m of this.q) node.port.postMessage(m); this.q = [];
    }).catch(e => console.warn("效果音無法啟動", e));
  }
  send(m) {
    if (this.log) this.log(m);
    if (this.node) this.node.port.postMessage(m); else if (this.ac) this.q.push(m);
  }
  // 9768 (DS:bx): AH=05 AL=0
  voice(addr) { if (this.present) this.send({ ah: 5, al: 0, addr }); }
  // 9804 (AL): [0ca4] bit3 时 AH=06 AL=0 DL=音高
  note(n) { if (this.present && this.state && (this.state.options & 8)) this.send({ ah: 6, al: 0, dl: n }); }
  // 9888: AH=05 AL=0 DS:DX = 0 (重设声部 4), AH=07 AL=0, AH=07 AL=1
  off() { if (this.present) { this.send({ ah: 5, al: 0, addr: 0 }); this.send({ ah: 7, al: 0 }); this.send({ ah: 7, al: 1 }); } }
}
