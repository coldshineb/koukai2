// trace_emu.js — 只跑原版 (同 port_tests.js 的 runEmu 与 PORT_SETUP / PORT_KEYS / NO_EVENTS 设置), 记录每个画面之间被调用的函数 (call 目标线性地址)
// 用法: 先运行路线脚本, 再运行本档; 结果 session.trace = [{ shot, calls: {线性地址: 次数} }, ...], 并印出 S.TRACE_FROM 之后各画面的调用摘要
// S.TRACE_FROM: 从第几个画面开始记录 (默认 0); S.TRACE_PATCH(mem, L): 额外修补原版 (例: 关闭他舰队移动)
(function () {
const S = session, L = 0x110 * 16;
const K = { down: [0x50, 0], up: [0x48, 0], left: [0x4b, 0], right: [0x4d, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b] };
const NEWGAME = [K.down, K.enter, K.enter, K.enter, K.left, K.left, K.enter, K.left, K.left, K.enter, K.enter];
const KEYS = NEWGAME.concat(S.PORT_KEYS || []);
S.restoreTitle();
const env = S.titleEnv, c = env.cpu, shots = [];
Object.assign(env.mouse, { x: 0x27f, y: 0x18f + 0x28, b: 0 });
const sc = S.makeScript(KEYS.concat([{ mouse: {} }]));
let done = false, cur = {};
const trace = S.trace = [];
const saveEnv = S.env, sH16 = S._H16, sH33 = S._H33; S.env = env; S._H16 = S._H33 = undefined;
S.installEmuServices(sc, () => { trace.push({ shot: shots.length, calls: cur }); cur = {}; shots.push({ fb: S.TRACE_FB === 0 ? null : S.emuFb480().slice(), dac: Array.from(c.vga.dac.slice(0, 48)), mouse: { x: env.mouse.x, y: env.mouse.y } });
  { const tp = S.TELEPORT?.[shots.length - 1]; if (tp) for (const [a, v] of tp) c.mem[S.DSEG * 16 + a] = v; }
  if (!sc.keys.length) { done = true; c.halted = true; } });
S.env = saveEnv; S._H16 = sH16; S._H33 = sH33;
c.mem[L + 0x1ac19] = 0xcb;
if (S.NO_EVENTS) for (const o of [0x33511, 0x33652]) { c.mem[L + o] = 0x31; c.mem[L + o + 1] = 0xc0; c.mem[L + o + 2] = 0xcb; }
if (S.NO_FLEETS) { c.mem[L + 0x6aae] = 0xcb; c.mem[L + 0x1b048] = 0x90; c.mem[L + 0x1b049] = 0x90; }
S.TRACE_PATCH?.(c.mem, L);
let setupDone = !S.PORT_SETUP, prevCall = false;
const from = S.TRACE_FROM || 0;
c.onTick = cpu => {
  const lin = cpu.s[1] * 16 + cpu.ip;
  if (prevCall && shots.length >= from) { const k = (lin - L).toString(16); cur[k] = (cur[k] || 0) + 1; }
  const op = cpu.mem[lin]; prevCall = op === 0x9a || op === 0xe8 || (op === 0x0e && cpu.mem[lin + 1] === 0xe8 && false);
  if (op === 0xff) { const m = cpu.mem[lin + 1]; const r = (m >> 3) & 7; if (r === 2 || r === 3) prevCall = true; }
  if (!setupDone && lin === L + 0x8c53) { setupDone = true; const d = cpu.s[3] * 16, P = S.PORT_SETUP;
    const w16 = (o, v) => { cpu.mem[d + o] = v & 255; cpu.mem[d + o + 1] = (v >> 8) & 255; };
    cpu.mem[d + 0x0cae] = P.port; cpu.mem[d + 0x0caf] = 0x82; w16(0x0cb4, P.vx); w16(0x0cb6, P.vy); w16(0x0cb8, P.hx); w16(0x0cba, P.hy);
    if (P.time !== undefined) { cpu.mem[d + 0x0cad] = P.time; cpu.mem[d + 0x0535] = P.time; }
    for (const [a, v] of P.poke || []) cpu.mem[d + a] = v;
    P.emuHook?.(cpu.mem, d); }
};
const t0 = Date.now();
while (!done && Date.now() - t0 < (S.TRACE_MS || 200000)) c.run(2e7);
c.onTick = null; c.halted = false;
S.traceShots = shots;
const tot = {};
for (const t of trace) if (t.shot >= from) for (const k in t.calls) tot[k] = (tot[k] || 0) + t.calls[k];
console.log("shots", shots.length, "done", done, "ms", Date.now() - t0);
console.log(Object.entries(tot).sort((a, b) => parseInt(a[0], 16) - parseInt(b[0], 16)).map(([k, v]) => k + ":" + v).join(" "));
})();
