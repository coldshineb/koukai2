// opl.js — OPL2 (YM3812) 合成器: Nuked OPL3 1.8 的 JavaScript 移植 (效果音用, RE_NOTES 第 35 节)
// 原作: Nuked OPL3, Copyright (C) 2013-2020 Nuke.YKT, https://github.com/nukeykt/Nuked-OPL3 (opl3.c / opl3.h, version 1.8)
// 授权: GNU Lesser General Public License 2.1 (或更新版本)。本档是该程序库的衍生作品, 依 LGPL-2.1 以源代码形式散布,
//   用户可自由修改或替换本档 (只被 core/sfx_worklet.js 加载)。原作致谢: MAME Development Team (Jarek Burczynski, Tatsuyuki Satoh)、
//   forums.submarine.org.uk (carbon14, opl3)、OPLx decapsulated (Matthew Gambrell, Olli Niemitalo)、siliconpr0n.org (John McMaster, digshadow)。
// 移植范围: 芯片全部 (36 slot / 18 channel / 节奏 / 4op / OPL3 高位寄存器), 不含 OPL_ENABLE_STEREOEXT 与写入缓冲 (OPL3_WriteRegBuffered:
//   这里由调用端在正确的采样点直接写入)。OPL_QUIRK_CHANNELSAMPLEDELAY = 1 (原作默认)。C 的指针 (slot->mod / channel->out / slot->trem)
//   改成「来源 slot + 字段」; 整数宽度依原作 (int16 / uint16 / uint32 的截断都照做)。
const oplLogsin = Uint16Array.of(
  0x859, 0x6c3, 0x607, 0x58b, 0x52e, 0x4e4, 0x4a6, 0x471, 0x443, 0x41a, 0x3f5, 0x3d3, 0x3b5, 0x398, 0x37e, 0x365,
  0x34e, 0x339, 0x324, 0x311, 0x2ff, 0x2ed, 0x2dc, 0x2cd, 0x2bd, 0x2af, 0x2a0, 0x293, 0x286, 0x279, 0x26d, 0x261,
  0x256, 0x24b, 0x240, 0x236, 0x22c, 0x222, 0x218, 0x20f, 0x206, 0x1fd, 0x1f5, 0x1ec, 0x1e4, 0x1dc, 0x1d4, 0x1cd,
  0x1c5, 0x1be, 0x1b7, 0x1b0, 0x1a9, 0x1a2, 0x19b, 0x195, 0x18f, 0x188, 0x182, 0x17c, 0x177, 0x171, 0x16b, 0x166,
  0x160, 0x15b, 0x155, 0x150, 0x14b, 0x146, 0x141, 0x13c, 0x137, 0x133, 0x12e, 0x129, 0x125, 0x121, 0x11c, 0x118,
  0x114, 0x10f, 0x10b, 0x107, 0x103, 0x0ff, 0x0fb, 0x0f8, 0x0f4, 0x0f0, 0x0ec, 0x0e9, 0x0e5, 0x0e2, 0x0de, 0x0db,
  0x0d7, 0x0d4, 0x0d1, 0x0cd, 0x0ca, 0x0c7, 0x0c4, 0x0c1, 0x0be, 0x0bb, 0x0b8, 0x0b5, 0x0b2, 0x0af, 0x0ac, 0x0a9,
  0x0a7, 0x0a4, 0x0a1, 0x09f, 0x09c, 0x099, 0x097, 0x094, 0x092, 0x08f, 0x08d, 0x08a, 0x088, 0x086, 0x083, 0x081,
  0x07f, 0x07d, 0x07a, 0x078, 0x076, 0x074, 0x072, 0x070, 0x06e, 0x06c, 0x06a, 0x068, 0x066, 0x064, 0x062, 0x060,
  0x05e, 0x05c, 0x05b, 0x059, 0x057, 0x055, 0x053, 0x052, 0x050, 0x04e, 0x04d, 0x04b, 0x04a, 0x048, 0x046, 0x045,
  0x043, 0x042, 0x040, 0x03f, 0x03e, 0x03c, 0x03b, 0x039, 0x038, 0x037, 0x035, 0x034, 0x033, 0x031, 0x030, 0x02f,
  0x02e, 0x02d, 0x02b, 0x02a, 0x029, 0x028, 0x027, 0x026, 0x025, 0x024, 0x023, 0x022, 0x021, 0x020, 0x01f, 0x01e,
  0x01d, 0x01c, 0x01b, 0x01a, 0x019, 0x018, 0x017, 0x017, 0x016, 0x015, 0x014, 0x014, 0x013, 0x012, 0x011, 0x011,
  0x010, 0x00f, 0x00f, 0x00e, 0x00d, 0x00d, 0x00c, 0x00c, 0x00b, 0x00a, 0x00a, 0x009, 0x009, 0x008, 0x008, 0x007,
  0x007, 0x007, 0x006, 0x006, 0x005, 0x005, 0x005, 0x004, 0x004, 0x004, 0x003, 0x003, 0x003, 0x002, 0x002, 0x002,
  0x002, 0x001, 0x001, 0x001, 0x001, 0x001, 0x001, 0x001, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000);
const oplExp = Uint16Array.of(
  0x7fa, 0x7f5, 0x7ef, 0x7ea, 0x7e4, 0x7df, 0x7da, 0x7d4, 0x7cf, 0x7c9, 0x7c4, 0x7bf, 0x7b9, 0x7b4, 0x7ae, 0x7a9,
  0x7a4, 0x79f, 0x799, 0x794, 0x78f, 0x78a, 0x784, 0x77f, 0x77a, 0x775, 0x770, 0x76a, 0x765, 0x760, 0x75b, 0x756,
  0x751, 0x74c, 0x747, 0x742, 0x73d, 0x738, 0x733, 0x72e, 0x729, 0x724, 0x71f, 0x71a, 0x715, 0x710, 0x70b, 0x706,
  0x702, 0x6fd, 0x6f8, 0x6f3, 0x6ee, 0x6e9, 0x6e5, 0x6e0, 0x6db, 0x6d6, 0x6d2, 0x6cd, 0x6c8, 0x6c4, 0x6bf, 0x6ba,
  0x6b5, 0x6b1, 0x6ac, 0x6a8, 0x6a3, 0x69e, 0x69a, 0x695, 0x691, 0x68c, 0x688, 0x683, 0x67f, 0x67a, 0x676, 0x671,
  0x66d, 0x668, 0x664, 0x65f, 0x65b, 0x657, 0x652, 0x64e, 0x649, 0x645, 0x641, 0x63c, 0x638, 0x634, 0x630, 0x62b,
  0x627, 0x623, 0x61e, 0x61a, 0x616, 0x612, 0x60e, 0x609, 0x605, 0x601, 0x5fd, 0x5f9, 0x5f5, 0x5f0, 0x5ec, 0x5e8,
  0x5e4, 0x5e0, 0x5dc, 0x5d8, 0x5d4, 0x5d0, 0x5cc, 0x5c8, 0x5c4, 0x5c0, 0x5bc, 0x5b8, 0x5b4, 0x5b0, 0x5ac, 0x5a8,
  0x5a4, 0x5a0, 0x59c, 0x599, 0x595, 0x591, 0x58d, 0x589, 0x585, 0x581, 0x57e, 0x57a, 0x576, 0x572, 0x56f, 0x56b,
  0x567, 0x563, 0x560, 0x55c, 0x558, 0x554, 0x551, 0x54d, 0x549, 0x546, 0x542, 0x53e, 0x53b, 0x537, 0x534, 0x530,
  0x52c, 0x529, 0x525, 0x522, 0x51e, 0x51b, 0x517, 0x514, 0x510, 0x50c, 0x509, 0x506, 0x502, 0x4ff, 0x4fb, 0x4f8,
  0x4f4, 0x4f1, 0x4ed, 0x4ea, 0x4e7, 0x4e3, 0x4e0, 0x4dc, 0x4d9, 0x4d6, 0x4d2, 0x4cf, 0x4cc, 0x4c8, 0x4c5, 0x4c2,
  0x4be, 0x4bb, 0x4b8, 0x4b5, 0x4b1, 0x4ae, 0x4ab, 0x4a8, 0x4a4, 0x4a1, 0x49e, 0x49b, 0x498, 0x494, 0x491, 0x48e,
  0x48b, 0x488, 0x485, 0x482, 0x47e, 0x47b, 0x478, 0x475, 0x472, 0x46f, 0x46c, 0x469, 0x466, 0x463, 0x460, 0x45d,
  0x45a, 0x457, 0x454, 0x451, 0x44e, 0x44b, 0x448, 0x445, 0x442, 0x43f, 0x43c, 0x439, 0x436, 0x433, 0x430, 0x42d,
  0x42a, 0x428, 0x425, 0x422, 0x41f, 0x41c, 0x419, 0x416, 0x414, 0x411, 0x40e, 0x40b, 0x408, 0x406, 0x403, 0x400);
const oplMt = [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 20, 24, 24, 30, 30];
const oplKslrom = [0, 32, 40, 45, 48, 51, 53, 55, 56, 58, 59, 60, 61, 62, 63, 64];
const oplKslshift = [8, 1, 2, 0];
const oplEgIncstep = [[0, 0, 0, 0], [1, 0, 0, 0], [1, 0, 1, 0], [1, 1, 1, 0]];
const oplAdSlot = [0, 1, 2, 3, 4, 5, -1, -1, 6, 7, 8, 9, 10, 11, -1, -1, 12, 13, 14, 15, 16, 17, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1];
const oplChSlot = [0, 1, 2, 6, 7, 8, 12, 13, 14, 18, 19, 20, 24, 25, 26, 30, 31, 32];
const OPL_ATTACK = 0, OPL_DECAY = 1, OPL_SUSTAIN = 2, OPL_RELEASE = 3;
const OPL_2OP = 0, OPL_4OP = 1, OPL_4OP2 = 2, OPL_DRUM = 3;
const OPL_RSM_FRAC = 10;
const oplS16 = v => (v << 16) >> 16;
const oplClip = v => (v > 32767 ? 32767 : v < -32768 ? -32768 : v);
function oplCalcExp(level) { if (level > 0x1fff) level = 0x1fff; return (oplExp[level & 0xff] << 1) >> (level >> 8); }
// envelope_sin[0..7]: 返回 int16
const oplSin = [
  (phase, env) => { phase &= 0x3ff; const neg = phase & 0x200; const out = phase & 0x100 ? oplLogsin[(phase & 0xff) ^ 0xff] : oplLogsin[phase & 0xff];
    const v = oplCalcExp(out + (env << 3)); return neg ? ~v : v; },
  (phase, env) => { phase &= 0x3ff; const out = phase & 0x200 ? 0x1000 : phase & 0x100 ? oplLogsin[(phase & 0xff) ^ 0xff] : oplLogsin[phase & 0xff]; return oplCalcExp(out + (env << 3)); },
  (phase, env) => { phase &= 0x3ff; const out = phase & 0x100 ? oplLogsin[(phase & 0xff) ^ 0xff] : oplLogsin[phase & 0xff]; return oplCalcExp(out + (env << 3)); },
  (phase, env) => { phase &= 0x3ff; const out = phase & 0x100 ? 0x1000 : oplLogsin[phase & 0xff]; return oplCalcExp(out + (env << 3)); },
  (phase, env) => { phase &= 0x3ff; const neg = (phase & 0x300) === 0x100;
    const out = phase & 0x200 ? 0x1000 : phase & 0x80 ? oplLogsin[((phase ^ 0xff) << 1) & 0xff] : oplLogsin[(phase << 1) & 0xff];
    const v = oplCalcExp(out + (env << 3)); return neg ? ~v : v; },
  (phase, env) => { phase &= 0x3ff; const out = phase & 0x200 ? 0x1000 : phase & 0x80 ? oplLogsin[((phase ^ 0xff) << 1) & 0xff] : oplLogsin[(phase << 1) & 0xff]; return oplCalcExp(out + (env << 3)); },
  (phase, env) => { phase &= 0x3ff; const v = oplCalcExp(env << 3); return phase & 0x200 ? ~v : v; },
  (phase, env) => { phase &= 0x3ff; let neg = 0; if (phase & 0x200) { neg = 1; phase = (phase & 0x1ff) ^ 0x1ff; }
    const v = oplCalcExp((phase << 3) + (env << 3)); return neg ? ~v : v; },
];

class OplSlot {
  constructor(chip, n) {
    this.chip = chip; this.channel = null; this.slot_num = n;
    this.out = 0; this.fbmod = 0; this.prout = 0;
    this.modSrc = null; this.modKey = "";                          // slot->mod: null = zeromod, 否则 modSrc[modKey] ("fbmod" / "out")
    this.eg_rout = 0x1ff; this.eg_out = 0x1ff; this.eg_gen = OPL_RELEASE; this.eg_ksl = 0;
    this.trem = false;                                             // slot->trem: true = &chip->tremolo, false = zeromod
    this.reg_vib = 0; this.reg_type = 0; this.reg_ksr = 0; this.reg_mult = 0; this.reg_ksl = 0; this.reg_tl = 0;
    this.reg_ar = 0; this.reg_dr = 0; this.reg_sl = 0; this.reg_rr = 0; this.reg_wf = 0; this.key = 0;
    this.pg_reset = 0; this.pg_phase = 0; this.pg_phase_out = 0;
  }
  mod() { return this.modSrc ? this.modSrc[this.modKey] : 0; }
}
class OplChannel {
  constructor(chip, n) {
    this.chip = chip; this.ch_num = n; this.slotz = [null, null]; this.pair = null;
    this.out = [null, null, null, null];                           // channel->out[i]: null = zeromod, 否则该 slot 的 out
    this.chtype = OPL_2OP; this.f_num = 0; this.f_num_reg = 0; this.block = 0; this.block_reg = 0;
    this.fb = 0; this.con = 0; this.alg = 0; this.ksv = 0; this.cha = 0xffff; this.chb = 0xffff; this.chc = 0; this.chd = 0;
  }
}

export class OPL3 {
  constructor(samplerate = 49716) { this.reset(samplerate); }
  reset(samplerate) {
    this.slot = Array.from({ length: 36 }, (_, i) => new OplSlot(this, i));
    this.channel = Array.from({ length: 18 }, (_, i) => new OplChannel(this, i));
    this.timer = 0; this.eg_timer = 0; this.eg_timerrem = 0; this.eg_state = 0; this.eg_add = 0; this.eg_timer_lo = 0;
    this.newm = 0; this.nts = 0; this.rhy = 0; this.vibpos = 0; this.tremolo = 0; this.tremolopos = 0;
    this.mixbuff = [0, 0, 0, 0];
    this.rm_hh_bit2 = 0; this.rm_hh_bit3 = 0; this.rm_hh_bit7 = 0; this.rm_hh_bit8 = 0; this.rm_tc_bit3 = 0; this.rm_tc_bit5 = 0;
    for (let ch = 0; ch < 18; ch++) {
      const c = this.channel[ch], ls = oplChSlot[ch];
      c.slotz[0] = this.slot[ls]; c.slotz[1] = this.slot[ls + 3];
      this.slot[ls].channel = c; this.slot[ls + 3].channel = c;
      if (ch % 9 < 3) c.pair = this.channel[ch + 3]; else if (ch % 9 < 6) c.pair = this.channel[ch - 3];
      this.setupAlg(c);
    }
    this.noise = 1;
    this.rateratio = Math.floor((samplerate * (1 << OPL_RSM_FRAC)) / 49716);
    this.samplecnt = 0; this.oldsamples = [0, 0, 0, 0]; this.samples = [0, 0, 0, 0];
    this.tremoloshift = 4; this.vibshift = 1;
  }
  // ---- 包络 ----
  updateKSL(slot) {
    let ksl = (oplKslrom[slot.channel.f_num >> 6] << 2) - ((0x08 - slot.channel.block) << 5);
    if (ksl < 0) ksl = 0;
    slot.eg_ksl = ksl & 0xff;
  }
  envelopeCalc(slot) {
    let reg_rate = 0, reset = 0;
    slot.eg_out = (slot.eg_rout + (slot.reg_tl << 2) + (slot.eg_ksl >> oplKslshift[slot.reg_ksl]) + (slot.trem ? this.tremolo : 0)) & 0xffff;
    if (slot.key && slot.eg_gen === OPL_RELEASE) { reset = 1; reg_rate = slot.reg_ar; }
    else switch (slot.eg_gen) {
      case OPL_ATTACK: reg_rate = slot.reg_ar; break;
      case OPL_DECAY: reg_rate = slot.reg_dr; break;
      case OPL_SUSTAIN: if (!slot.reg_type) reg_rate = slot.reg_rr; break;
      case OPL_RELEASE: reg_rate = slot.reg_rr; break;
    }
    slot.pg_reset = reset;
    const ks = slot.channel.ksv >> ((slot.reg_ksr ^ 1) << 1);
    const nonzero = reg_rate !== 0;
    const rate = (ks + (reg_rate << 2)) & 0xff;
    let rate_hi = rate >> 2; const rate_lo = rate & 0x03;
    if (rate_hi & 0x10) rate_hi = 0x0f;
    const eg_shift = rate_hi + this.eg_add;
    let shift = 0;
    if (nonzero) {
      if (rate_hi < 12) {
        if (this.eg_state) switch (eg_shift) { case 12: shift = 1; break; case 13: shift = (rate_lo >> 1) & 1; break; case 14: shift = rate_lo & 1; break; }
      } else {
        shift = (rate_hi & 0x03) + oplEgIncstep[rate_lo][this.eg_timer_lo];
        if (shift & 0x04) shift = 0x03;
        if (!shift) shift = this.eg_state;
      }
    }
    let eg_rout = slot.eg_rout, eg_inc = 0, eg_off = 0;
    if (reset && rate_hi === 0x0f) eg_rout = 0;
    if ((slot.eg_rout & 0x1f8) === 0x1f8) eg_off = 1;
    if (slot.eg_gen !== OPL_ATTACK && !reset && eg_off) eg_rout = 0x1ff;
    switch (slot.eg_gen) {
      case OPL_ATTACK:
        if (!slot.eg_rout) slot.eg_gen = OPL_DECAY;
        else if (slot.key && shift > 0 && rate_hi !== 0x0f) eg_inc = oplS16(~slot.eg_rout >> (4 - shift));
        break;
      case OPL_DECAY:
        if ((slot.eg_rout >> 4) === slot.reg_sl) slot.eg_gen = OPL_SUSTAIN;
        else if (!eg_off && !reset && shift > 0) eg_inc = 1 << (shift - 1);
        break;
      case OPL_SUSTAIN: case OPL_RELEASE:
        if (!eg_off && !reset && shift > 0) eg_inc = 1 << (shift - 1);
        break;
    }
    slot.eg_rout = (eg_rout + eg_inc) & 0x1ff;
    if (reset) slot.eg_gen = OPL_ATTACK;
    if (!slot.key) slot.eg_gen = OPL_RELEASE;
  }
  // ---- 相位 ----
  phaseGenerate(slot) {
    let f_num = slot.channel.f_num;
    if (slot.reg_vib) {
      let range = (f_num >> 7) & 7; const vibpos = this.vibpos;
      if (!(vibpos & 3)) range = 0; else if (vibpos & 1) range >>= 1;
      range >>= this.vibshift;
      if (vibpos & 4) range = -range;
      f_num = (f_num + range) & 0xffff;
    }
    const basefreq = (f_num << slot.channel.block) >>> 1;
    const phase = (slot.pg_phase >>> 9) & 0xffff;
    if (slot.pg_reset) slot.pg_phase = 0;
    slot.pg_phase = (slot.pg_phase + ((basefreq * oplMt[slot.reg_mult]) >>> 1)) >>> 0;
    const noise = this.noise;
    slot.pg_phase_out = phase;
    if (slot.slot_num === 13) { this.rm_hh_bit2 = (phase >> 2) & 1; this.rm_hh_bit3 = (phase >> 3) & 1; this.rm_hh_bit7 = (phase >> 7) & 1; this.rm_hh_bit8 = (phase >> 8) & 1; }
    if (slot.slot_num === 17 && (this.rhy & 0x20)) { this.rm_tc_bit3 = (phase >> 3) & 1; this.rm_tc_bit5 = (phase >> 5) & 1; }
    if (this.rhy & 0x20) {
      const rm_xor = (this.rm_hh_bit2 ^ this.rm_hh_bit7) | (this.rm_hh_bit3 ^ this.rm_tc_bit5) | (this.rm_tc_bit3 ^ this.rm_tc_bit5);
      switch (slot.slot_num) {
        case 13: slot.pg_phase_out = (rm_xor << 9) | ((rm_xor ^ (noise & 1)) ? 0xd0 : 0x34); break;
        case 16: slot.pg_phase_out = (this.rm_hh_bit8 << 9) | ((this.rm_hh_bit8 ^ (noise & 1)) << 8); break;
        case 17: slot.pg_phase_out = (rm_xor << 9) | 0x80; break;
      }
    }
    const n_bit = ((noise >> 14) ^ noise) & 1;
    this.noise = (noise >>> 1) | (n_bit << 22);
  }
  // ---- slot ----
  slotWrite20(slot, d) { slot.trem = !!(d & 0x80); slot.reg_vib = (d >> 6) & 1; slot.reg_type = (d >> 5) & 1; slot.reg_ksr = (d >> 4) & 1; slot.reg_mult = d & 0x0f; }
  slotWrite40(slot, d) { slot.reg_ksl = (d >> 6) & 3; slot.reg_tl = d & 0x3f; this.updateKSL(slot); }
  slotWrite60(slot, d) { slot.reg_ar = (d >> 4) & 0x0f; slot.reg_dr = d & 0x0f; }
  slotWrite80(slot, d) { slot.reg_sl = (d >> 4) & 0x0f; if (slot.reg_sl === 0x0f) slot.reg_sl = 0x1f; slot.reg_rr = d & 0x0f; }
  slotWriteE0(slot, d) { slot.reg_wf = d & 0x07; if (this.newm === 0) slot.reg_wf &= 0x03; }
  slotGenerate(slot) { slot.out = oplS16(oplSin[slot.reg_wf]((slot.pg_phase_out + slot.mod()) & 0xffff, slot.eg_out)); }
  slotCalcFB(slot) {
    slot.fbmod = slot.channel.fb !== 0 ? oplS16((slot.prout + slot.out) >> (0x09 - slot.channel.fb)) : 0;
    slot.prout = slot.out;
  }
  processSlot(slot) { this.slotCalcFB(slot); this.envelopeCalc(slot); this.phaseGenerate(slot); this.slotGenerate(slot); }
  // ---- channel ----
  updateRhythm(data) {
    this.rhy = data & 0x3f;
    const C = this.channel;
    if (this.rhy & 0x20) {
      const c6 = C[6], c7 = C[7], c8 = C[8];
      c6.out = [c6.slotz[1], c6.slotz[1], null, null];
      c7.out = [c7.slotz[0], c7.slotz[0], c7.slotz[1], c7.slotz[1]];
      c8.out = [c8.slotz[0], c8.slotz[0], c8.slotz[1], c8.slotz[1]];
      for (let ch = 6; ch < 9; ch++) C[ch].chtype = OPL_DRUM;
      this.setupAlg(c6); this.setupAlg(c7); this.setupAlg(c8);
      const k = (s, on) => { if (on) s.key |= 2; else s.key &= ~2; };
      k(c7.slotz[0], this.rhy & 0x01);                             // hh
      k(c8.slotz[1], this.rhy & 0x02);                             // tc
      k(c8.slotz[0], this.rhy & 0x04);                             // tom
      k(c7.slotz[1], this.rhy & 0x08);                             // sd
      k(c6.slotz[0], this.rhy & 0x10); k(c6.slotz[1], this.rhy & 0x10);   // bd
    } else {
      for (let ch = 6; ch < 9; ch++) { C[ch].chtype = OPL_2OP; this.setupAlg(C[ch]); C[ch].slotz[0].key &= ~2; C[ch].slotz[1].key &= ~2; }
    }
  }
  updateFrequency(c) { c.ksv = (c.block << 1) | ((c.f_num >> (0x09 - this.nts)) & 1); this.updateKSL(c.slotz[0]); this.updateKSL(c.slotz[1]); }
  restoreFrequency(c) { c.f_num = c.f_num_reg; c.block = c.block_reg; this.updateFrequency(c); }
  sync4Op(c) { c.pair.f_num = c.f_num; c.pair.block = c.block; this.updateFrequency(c.pair); }
  writeA0(c, d) { c.f_num_reg = (c.f_num_reg & 0x300) | d; if (c.chtype === OPL_4OP2) return; this.restoreFrequency(c); if (c.chtype === OPL_4OP) this.sync4Op(c); }
  writeB0(c, d) { c.f_num_reg = (c.f_num_reg & 0xff) | ((d & 3) << 8); c.block_reg = (d >> 2) & 7; if (c.chtype === OPL_4OP2) return; this.restoreFrequency(c); if (c.chtype === OPL_4OP) this.sync4Op(c); }
  setMod(s, src, key) { s.modSrc = src; s.modKey = key; }
  setupAlg(c) {
    const s0 = c.slotz[0], s1 = c.slotz[1];
    if (c.chtype === OPL_DRUM) {
      if (c.ch_num === 7 || c.ch_num === 8) { this.setMod(s0, null); this.setMod(s1, null); return; }
      if (c.alg & 1) { this.setMod(s0, s0, "fbmod"); this.setMod(s1, null); }
      else { this.setMod(s0, s0, "fbmod"); this.setMod(s1, s0, "out"); }
      return;
    }
    if (c.alg & 0x08) return;
    if (c.alg & 0x04) {
      const p = c.pair, p0 = p.slotz[0], p1 = p.slotz[1];
      p.out = [null, null, null, null];
      switch (c.alg & 3) {
        case 0: this.setMod(p0, p0, "fbmod"); this.setMod(p1, p0, "out"); this.setMod(s0, p1, "out"); this.setMod(s1, s0, "out"); c.out = [s1, null, null, null]; break;
        case 1: this.setMod(p0, p0, "fbmod"); this.setMod(p1, p0, "out"); this.setMod(s0, null); this.setMod(s1, s0, "out"); c.out = [p1, s1, null, null]; break;
        case 2: this.setMod(p0, p0, "fbmod"); this.setMod(p1, null); this.setMod(s0, p1, "out"); this.setMod(s1, s0, "out"); c.out = [p0, s1, null, null]; break;
        case 3: this.setMod(p0, p0, "fbmod"); this.setMod(p1, null); this.setMod(s0, p1, "out"); this.setMod(s1, null); c.out = [p0, s0, s1, null]; break;
      }
    } else if (c.alg & 1) { this.setMod(s0, s0, "fbmod"); this.setMod(s1, null); c.out = [s0, s1, null, null]; }
    else { this.setMod(s0, s0, "fbmod"); this.setMod(s1, s0, "out"); c.out = [s1, null, null, null]; }
  }
  updateAlg(c) {
    c.alg = c.con;
    if (c.chtype === OPL_4OP) { c.pair.alg = 0x04 | (c.con << 1) | c.pair.con; c.alg = 0x08; this.setupAlg(c.pair); }
    else if (c.chtype === OPL_4OP2) { c.alg = 0x04 | (c.pair.con << 1) | c.con; c.pair.alg = 0x08; this.setupAlg(c); }
    else this.setupAlg(c);
  }
  writeC0(c, d) {
    c.fb = (d & 0x0e) >> 1; c.con = d & 1; this.updateAlg(c);
    if (this.newm) { c.cha = (d >> 4) & 1 ? 0xffff : 0; c.chb = (d >> 5) & 1 ? 0xffff : 0; c.chc = (d >> 6) & 1 ? 0xffff : 0; c.chd = (d >> 7) & 1 ? 0xffff : 0; }
    else { c.cha = c.chb = 0xffff; c.chc = c.chd = 0; }
  }
  keyOn(c) {
    if (c.chtype === OPL_4OP) { c.slotz[0].key |= 1; c.slotz[1].key |= 1; c.pair.slotz[0].key |= 1; c.pair.slotz[1].key |= 1; }
    else if (c.chtype === OPL_2OP || c.chtype === OPL_DRUM) { c.slotz[0].key |= 1; c.slotz[1].key |= 1; }
  }
  keyOff(c) {
    if (c.chtype === OPL_4OP) { c.slotz[0].key &= ~1; c.slotz[1].key &= ~1; c.pair.slotz[0].key &= ~1; c.pair.slotz[1].key &= ~1; }
    else if (c.chtype === OPL_2OP || c.chtype === OPL_DRUM) { c.slotz[0].key &= ~1; c.slotz[1].key &= ~1; }
  }
  set4Op(data) {
    for (let bit = 0; bit < 6; bit++) {
      const ch = bit >= 3 ? bit + 6 : bit, C = this.channel;
      if ((data >> bit) & 1) { C[ch].chtype = OPL_4OP; C[ch + 3].chtype = OPL_4OP2; this.sync4Op(C[ch]); this.updateAlg(C[ch]); }
      else { C[ch].chtype = OPL_2OP; C[ch + 3].chtype = OPL_2OP; this.restoreFrequency(C[ch + 3]); this.updateAlg(C[ch]); this.updateAlg(C[ch + 3]); }
    }
  }
  // OPL3_WriteReg
  write(reg, v) {
    const high = (reg >> 8) & 1, regm = reg & 0xff; v &= 0xff;
    const sl = () => { const a = oplAdSlot[regm & 0x1f]; return a >= 0 ? this.slot[18 * high + a] : null; };
    switch (regm & 0xf0) {
      case 0x00:
        if (high) { if ((regm & 0x0f) === 4) this.set4Op(v); else if ((regm & 0x0f) === 5) this.newm = v & 1; }
        else if ((regm & 0x0f) === 8) this.nts = (v >> 6) & 1;
        break;
      case 0x20: case 0x30: { const s = sl(); if (s) this.slotWrite20(s, v); break; }
      case 0x40: case 0x50: { const s = sl(); if (s) this.slotWrite40(s, v); break; }
      case 0x60: case 0x70: { const s = sl(); if (s) this.slotWrite60(s, v); break; }
      case 0x80: case 0x90: { const s = sl(); if (s) this.slotWrite80(s, v); break; }
      case 0xe0: case 0xf0: { const s = sl(); if (s) this.slotWriteE0(s, v); break; }
      case 0xa0: if ((regm & 0x0f) < 9) this.writeA0(this.channel[9 * high + (regm & 0x0f)], v); break;
      case 0xb0:
        if (regm === 0xbd && !high) { this.tremoloshift = (((v >> 7) ^ 1) << 1) + 2; this.vibshift = ((v >> 6) & 1) ^ 1; this.updateRhythm(v); }
        else if ((regm & 0x0f) < 9) { const c = this.channel[9 * high + (regm & 0x0f)]; this.writeB0(c, v); if (v & 0x20) this.keyOn(c); else this.keyOff(c); }
        break;
      case 0xc0: if ((regm & 0x0f) < 9) this.writeC0(this.channel[9 * high + (regm & 0x0f)], v); break;
    }
  }
  accm(c) { const o = c.out; return oplS16((o[0] ? o[0].out : 0) + (o[1] ? o[1].out : 0) + (o[2] ? o[2].out : 0) + (o[3] ? o[3].out : 0)); }
  // OPL3_Generate4Ch (原生 49716 Hz 一个采样; buf4 = [左, 右, 第 3, 第 4 声道])
  generate4Ch(buf4) {
    const S = this.slot, C = this.channel;
    buf4[1] = oplClip(this.mixbuff[1]); buf4[3] = oplClip(this.mixbuff[3]);
    for (let i = 0; i < 15; i++) this.processSlot(S[i]);
    let m0 = 0, m1 = 0;
    for (let i = 0; i < 18; i++) { const c = C[i], a = this.accm(c); m0 += oplS16(a & c.cha); m1 += oplS16(a & c.chc); }
    this.mixbuff[0] = m0; this.mixbuff[2] = m1;
    for (let i = 15; i < 18; i++) this.processSlot(S[i]);
    buf4[0] = oplClip(this.mixbuff[0]); buf4[2] = oplClip(this.mixbuff[2]);
    for (let i = 18; i < 33; i++) this.processSlot(S[i]);
    m0 = 0; m1 = 0;
    for (let i = 0; i < 18; i++) { const c = C[i], a = this.accm(c); m0 += oplS16(a & c.chb); m1 += oplS16(a & c.chd); }
    this.mixbuff[1] = m0; this.mixbuff[3] = m1;
    for (let i = 33; i < 36; i++) this.processSlot(S[i]);
    if ((this.timer & 0x3f) === 0x3f) this.tremolopos = (this.tremolopos + 1) % 210;
    this.tremolo = this.tremolopos < 105 ? this.tremolopos >> this.tremoloshift : (210 - this.tremolopos) >> this.tremoloshift;
    if ((this.timer & 0x3ff) === 0x3ff) this.vibpos = (this.vibpos + 1) & 7;
    this.timer = (this.timer + 1) & 0xffff;
    if (this.eg_state) {
      let shift = 0; const lo = this.eg_timer % 8192;                // eg_timer 为 36 比特, 这里只需要低 13 位
      while (shift < 13 && ((lo >> shift) & 1) === 0) shift++;
      this.eg_add = shift > 12 ? 0 : shift + 1;
      this.eg_timer_lo = this.eg_timer % 4;
    }
    if (this.eg_timerrem || this.eg_state) {
      if (this.eg_timer === 0xfffffffff) { this.eg_timer = 0; this.eg_timerrem = 1; }
      else { this.eg_timer++; this.eg_timerrem = 0; }
    }
    this.eg_state ^= 1;
  }
  // OPL3_Generate4ChResampled: 以建构时的采样率输出一个采样 (线性内插); onNative() 在每个原生采样产生之前调用 (调用端在这里写寄存器)
  generateResampled(buf4, onNative) {
    while (this.samplecnt >= this.rateratio) {
      for (let i = 0; i < 4; i++) this.oldsamples[i] = this.samples[i];
      if (onNative) onNative();
      this.generate4Ch(this.samples);
      this.samplecnt -= this.rateratio;
    }
    for (let i = 0; i < 4; i++) buf4[i] = oplS16(Math.trunc((this.oldsamples[i] * (this.rateratio - this.samplecnt) + this.samples[i] * this.samplecnt) / this.rateratio));
    this.samplecnt += 1 << OPL_RSM_FRAC;
  }
}
