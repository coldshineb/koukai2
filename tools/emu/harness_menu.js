// harness_menu.js — 菜单差分测试扩充 (需先加载 x86emu.js, dosenv.js, harness.js 并 session.boot)
"use strict";
(function () {
const S = session;
// ---- 脚本输入: 键盘缓冲空了且 kbhit 被调用 gap 次后, 才送下一个按键 (JS 端 Sys.onKbhit 用同一规则) ----
S.makeScript = (keys, gap = 40) => ({ keys: keys.slice(), gap, calls: 0, delivered: 0, frames: [] });
// 鼠标移动量 (INT 33h fn 0Bh, RE_NOTES 38.4): S.MICKEY 时, 脚本移动鼠标的像素差 × 比例 (fn 0Fh 设置的每 8 像素 mickey 数, 驱动默认 8 / 16) / 8
//   累加到 m.mdx / m.mdy (原版 dosenv 的 fn 0Bh 与移植版 Sys.mickeys 读后归零); 两边用同一个公式。没有 S.MICKEY 时移动量恒 0 (之前的路线不受影响)
S.mickeyAdd = (m, nx, ny, rx, ry) => {
  if (!S.MICKEY) return;
  if (!m._mk) { m._mk = 1; return; }                                  // 路线第一次移动鼠标只定位 (两边开始时的位置不同)
  if (nx !== undefined) m.mdx = (m.mdx | 0) + Math.trunc((nx - m.x) * rx / 8);
  if (ny !== undefined) m.mdy = (m.mdy | 0) + Math.trunc((ny - m.y) * ry / 8);
};
const emuMouse = (M, k) => { S.mickeyAdd(M, k.x, k.y, M.rx ?? 8, M.ry ?? 16); Object.assign(M, k); };
S.scriptStep = (sc, buf, push, onDeliver) => {
  sc.calls++;
  if (!buf.length && sc.keys.length && sc.calls >= sc.gap) {
    const k = sc.keys.shift();
    if (k.mouse) { onDeliver?.(k); sc.calls = 0; return; }
    push(k[0], k[1]); sc.calls = 0; sc.delivered++; onDeliver?.(k);
  }
};
S.installEmuServices = (script, onDeliver) => {
  const env = S.env, c = env.cpu;
  // INT 66h (FMDRV 计时器服务): 测试模式每次读取减一
  env.t66 = [0, 0];
  c.hooks[0x66] = cpu => {
    env.ret(cpu); const ax = cpu.r[0], hi = ax >> 8;
    if (hi !== 0xf0 && hi !== 0xf1) { cpu.r[0] = 0; return; }     // 其他 FMDRV 功能 (音乐播放/查找): 视为「未播放」
    const t = hi === 0xf1 ? 0 : 1;
    if ((ax & 0xff) === 1) env.t66[t] = cpu.r[3];
    else { if (env.t66[t]) env.t66[t]--; cpu.r[3] = env.t66[t]; }
  };
  // INT 16h AH=1 时推进脚本
  S._H16 ??= c.hooks[0x16]; const H16 = S._H16;
  c.hooks[0x16] = cpu => {
    if ((cpu.r[0] >> 8) === 1 && script) S.scriptStep(script, env.bioskeys, (sc, as) => env.bioskeys.push((sc << 8) | as),
      k => { if (k.mouse) emuMouse(env.mouse, k.mouse); onDeliver?.(k); });
    H16(cpu);
  };
  // INT 33h fn 3 亦推进脚本 (鼠标动作也排在同一串行)
  S._H33 ??= c.hooks[0x33]; const H33 = S._H33;
  c.hooks[0x33] = cpu => {
    if (cpu.r[0] === 3 && script) S.scriptStep(script, env.bioskeys, (sc, as) => env.bioskeys.push((sc << 8) | as),
      k => { if (k.mouse) emuMouse(env.mouse, k.mouse); onDeliver?.(k); });
    H33(cpu);
  };
};
// ---- 准备原版菜单所需的缓冲与文件 ----
S.setupMenuEnv = () => {
  const c = S.env.cpu, D = S.DSEG;
  S.setupFrameGfx();
  const H = (i, seg, size) => { const h = D * 16 + 0xbc36 + i * 7; c.mem[h] = 0; c.mem[h + 1] = seg & 255; c.mem[h + 2] = seg >> 8; c.mem[h + 3] = size & 255; c.mem[h + 4] = size >> 8; c.mem[h + 5] = 0xff; c.mem[h + 6] = 0xff; };
  H(2, 0x7000, 0x400);  c.ww(D * 16 + 0xc8a, 2);
  S.call(0x1609a);       // 开 KAO.LZW / MESSAGE.DAT / MENU.DAT
  S.call(0x160bc);       // 开 GRAPH.DAT -> [03d8]
  c.mem[D * 16 + 0x8a90] = 1; c.mem[D * 16 + 0x8a91] = 0;       // 有鼠标
  c.mem[D * 16 + 0x03d6] = 0;                                     // 鼠标光标隐藏计数
};
// 把字节字符串表写入 DGROUP (字符串区 0xe000, 指针表 0xe800)
S.emuTable = (strs) => {
  const c = S.env.cpu, D = S.DSEG * 16; let p = 0xe000;
  strs.forEach((s, i) => { c.ww(D + 0xe800 + i * 2, p); for (const b of s) c.mem[D + p++] = b; c.mem[D + p++] = 0; });
  return 0xe800;
};
S.menuVars = () => { const c = S.env.cpu, D = S.DSEG * 16, w = o => c.rw(D + o);
  return { cur: w(0xa160), count: w(0xa158), lineH: w(0xa15e), disabled: w(0xa14c), level: w(0xa156), bg: c.mem[D + 0x8a28], stack: w(0x536) }; };
})();
