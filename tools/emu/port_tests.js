// port_tests.js — 港口 差分测试: 同一按键脚本从标题菜单开始 (开始新航海 → 里斯本港 → 走路/进建筑), 分别驱动原版与移植版
// 每次送键时比对画面、调色盘、随机数与游戏状态 (DS:0CA4..8A18 + 时间)
// 先加载 x86emu/dosenv/harness/harness_menu/boot_title(session.bootTitle()) 与 tools/work/ui_bundle.js
(async function () {
const fs = require("fs"), S = session, U = S.UI, f = S.files, L = 0x110 * 16;
const K = { down: [0x50, 0], up: [0x48, 0], left: [0x4b, 0], right: [0x4d, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b], sp: [0x39, 0x20] };
const NEWGAME = S.NEWGAME || [K.down, K.enter, K.enter, K.enter, K.left, K.left, K.enter, K.left, K.left, K.enter, K.enter];   // S.NEWGAME: 改选其他主角 (event_route.js 的 S.EVENT_HERO)
const KEYS = NEWGAME.concat(S.PORT_KEYS || [K.left, K.left, K.left, K.right, K.right, K.down, K.up, K.up, K.enter, K.left, K.down, K.down, K.right]);
const TAIL = 30;                    // 最后一键之后再等多少次输入查找才截最终状态
// S.SLICE_MS = n: 长路线分次运行 — 每次调用运行约 n 毫秒就暂停 (原版与移植版都是), 由下一次调用接续 (沙盒的单次运行时间有上限)。
//   用法 (每次调用): S.sliceT0 = Date.now(); const p = new Promise(r => S.sliceSignal = r); if (!S.PTP) S.PTP = S.RUNF["port_tests.js"](); else S.sliceResume();
//                    await Promise.race([S.PTP, p]);   → S.PTP 完成才是跑完
const sliceWait = async () => { if (S.SLICE_MS && Date.now() - S.sliceT0 > S.SLICE_MS) await new Promise(r => { S.sliceResume = r; S.sliceSignal?.(); }); };
// S.EXTRA_DS = [[起, 迄], ...]: 另外比对存盘区以外的 DS 范围 (移植版为 ctx.battleDS 等 DS 镜像, 例: 海战工作区)
// S.DAC_N = n: 调色盘只比前 n 色 (例: 海战的调色盘循环 16ee 由 IRQ0 驱动, 两边换格的时间点不同, 只比 0..7)
const grabEmu = c => { const d = c.s[3] * 16; return { x: (S.EXTRA_DS || []).map(([a, b]) => c.mem.slice(d + a, d + b)), st: c.mem.slice(d + 0x0ca4, d + 0x8a18), rt: Array.from(c.mem.slice(d + 0x532, d + 0x536)),
  rng: ((c.mem[d + 0xbd88] | (c.mem[d + 0xbd89] << 8) | (c.mem[d + 0xbd8a] << 16) | (c.mem[d + 0xbd8b] << 24)) >>> 0) }; };
// 遮掉光标区 (24×24, 热点左上; 驱动座标 y − 40) 后的 32 比特哈希
function fbHash(fb, ms) {
  const f = fb.slice();
  for (const m of ms) if (m) for (let yy = m.y - 40; yy < m.y - 16; yy++) for (let xx = m.x; xx < m.x + 24; xx++) if (yy >= 0 && yy < 400 && xx < 640) f[yy * 640 + xx] = 0;
  f[399 * 640 + 639] = 0;
  let h = 0x811c9dc5; for (let i = 0; i < f.length; i++) h = Math.imul(h ^ f[i], 0x01000193);
  return h >>> 0;
}
async function runEmu() {
  S.restoreTitle();
  const env = S.titleEnv, c = env.cpu, shots = [];
  Object.assign(env.mouse, { x: 0x27f, y: 0x18f + 0x28, b: 0, _mk: 0, mdx: 0, mdy: 0 });       // 标题时的鼠标位置 (1752c), 上一次测试可能移动过
  const sc = S.makeScript(KEYS.concat([{ mouse: {} }]));            // 最后一个空动作 = 收尾截屏点
  let synced = false, done = false;
  const saveEnv = S.env, sH16 = S._H16, sH33 = S._H33; S.env = env; S._H16 = S._H33 = undefined;
  S.installEmuServices(sc, () => { let fb = S.emuFb480(); fb[399 * 640 + 639] = 0xff; const m = { x: env.mouse.x, y: env.mouse.y };
    // S.FB_HASH = n: 长路线省内存 — 每张只存遮掉光标 (本张与上一张的位置) 后的哈希, 每 n 张与最后一张才存完整画面
    let fh; if (S.FB_HASH) { fh = fbHash(fb, [m, ...Array.from({ length: S.CURSOR_LAG ?? 1 }, (_, k) => shots[shots.length - 1 - k]?.mouse)]); if (shots.length % S.FB_HASH && sc.keys.length && !(S.FB_KEEP && shots.length >= S.FB_KEEP[0] && shots.length <= S.FB_KEEP[1])) fb = null; }
    // S.SHOT_RANGE = [起, 迄): 长路线省内存 — 范围外的画面只记光标位置, 不保存画面与状态 (不比对; 最后一张照常保存)
    if (S.SHOT_RANGE && (shots.length < S.SHOT_RANGE[0] || shots.length >= S.SHOT_RANGE[1]) && sc.keys.length) shots.push({ mouse: m, skip: true });
    else shots.push({ mouse: m, fb, fh, dac: Array.from(c.vga.dac.slice(0, 48)), ...grabEmu(c) });
    const tp = S.TELEPORT?.[shots.length - 1]; if (tp) for (const [a, v] of tp) c.mem[S.DSEG * 16 + a] = v;              // S.TELEPORT[画面序号] = [[DS 地址, 值], ...]
    if (!sc.keys.length) { done = true; c.halted = true; } });
  S.env = saveEnv; S._H16 = sH16; S._H33 = sH33;
  // S.SFX_LOG: 记录 MAIN.EXE 的效果音调用 (INT 66h AH=05 / 06 / 07 = 9768 / 9804 / 9888; [画面序号, AH, AL, AH=05 的 DX (DS = 0 时记 0) / AH=06 的 DL]),
  //   与移植版 ctx.sfx (core/sfx.js SfxPort) 送出的指令依序比对。S.SFX_LOG = 2: 原版的 [03e4] (有音源驱动) 设为 1 (测试环境没有常驻 FMDRV)
  const sfxE = S.sfxE = [];
  if (S.SFX_LOG) { const h66 = c.hooks[0x66];
    c.hooks[0x66] = cpu => { const ah = cpu.r[0] >> 8; if (ah >= 5 && ah <= 7) sfxE.push([shots.length, ah, cpu.r[0] & 0xff, ah === 5 ? (cpu.s[3] ? cpu.r[2] : 0) : ah === 6 ? cpu.r[2] & 0xff : 0]); h66(cpu); };
    if (S.SFX_LOG === 2) c.mem[S.DSEG * 16 + 0x03e4] = 1; }
  // S.FLEET_AI: 舰队 AI (1ac19, game/fleetai.js) 两边都运行; 否则原版的 1ac19 改成直接返回, 移植版同样略过 (ctx.noFleetAI)
  if (!S.FLEET_AI) c.mem[L + 0x1ac19] = 0xcb;
  // 剧本事件检查 (2e09:5481 / 2e09:55c2) 尚未移植: 测试建筑时以 S.NO_EVENTS 让原版一律返回「没有事件」
  if (S.NO_EVENTS) for (const o of [0x33511, 0x33652]) { c.mem[L + o] = 0x31; c.mem[L + o + 1] = 0xc0; c.mem[L + o + 2] = 0xcb; }                       // 舰队 AI (1ac19) 尚未移植: 两边都略过, 以便单独验证港口与建筑
  // 他舰队 (舰队 AI) 尚未移植: S.NO_FLEETS 时原版的 6aae (区域内他舰队) 直接返回, 1afe8 不处理任何他舰队 (1b048 jne → nop), 移植版同样略过
  if (S.NO_FLEETS) { c.mem[L + 0x6aae] = 0xcb; c.mem[L + 0x1b048] = 0x90; c.mem[L + 0x1b049] = 0x90; }
  let setupDone = !S.PORT_SETUP;
  // S.WATCH = DS 地址: 该字节改变时记录当时的指令位置 (之前已运行的那条指令) 与按键序号, 结果在 S.watchLog
  const W8 = S.WATCH, WF = S.WATCH_FROM || 0, WD = c.s[3] * 16, wlog = S.watchLog = []; let wv = -1, wip = 0;   // WD: 游戏的 DS (标题时)
  // S.PROBES = [{ name, ip }]: 原版运行到 ip (映像内的线性地址) 时另取一份快照 (状态 / DS 工作区 / 随机数 / 画面), 与移植版 ctx.probe(name) 的快照依序比对
  //   (两次等待输入之间的处理, 例: 海战一次砲击的随机数、损伤与动画结束后的画面)
  const PR = S.PROBES || [], prE = S.probeE = [];
  const ET = S.EMU_TICK;                                               // S.EMU_TICK(cpu, 映像内线性地址): 每条指令前调用 (测试设置用, 例: portmove_route.js)
  c.onTick = cpu => {
    const lin = cpu.s[1] * 16 + cpu.ip;
    if (ET) ET(cpu, lin - L);
    if (PR.length) for (const p of PR) if (lin === L + p.ip && prE.length < 200) { const g = grabEmu(cpu); prE.push({ name: p.name, ...g, fb: S.emuFb480().slice(), mouse: { x: env.mouse.x, y: env.mouse.y }, shot: shots.length }); }
    if (W8 !== undefined) { const v = cpu.mem[WD + W8]; if (wv >= 0 && v !== wv && shots.length >= WF && wlog.length < 50) wlog.push({ ip: (wip - L).toString(16), from: wv, to: v, shot: shots.length }); wv = v; wip = lin; }
    if (!synced && lin === L + 0x4d92) { synced = true; sc.calls = 0; }
    if (!setupDone && lin === L + 0x8c53) { setupDone = true; const d = cpu.s[3] * 16, P = S.PORT_SETUP;
      const w16 = (o, v) => { cpu.mem[d + o] = v & 255; cpu.mem[d + o + 1] = (v >> 8) & 255; };
      // [0caf] = 0x82 (存盘后的值): 重新读入入口表但保留位置
      cpu.mem[d + 0x0cae] = P.port; cpu.mem[d + 0x0caf] = 0x82; w16(0x0cb4, P.vx); w16(0x0cb6, P.vy); w16(0x0cb8, P.hx); w16(0x0cba, P.hy);
      if (P.time !== undefined) { cpu.mem[d + 0x0cad] = P.time; cpu.mem[d + 0x0535] = P.time; }
      for (const [a, v] of P.poke || []) cpu.mem[d + a] = v;
      P.emuHook?.(cpu.mem, d); }                                     // 只写原版的额外设置 (例: [0c8e] 缓冲), 与 jsHook 成对
  };
  const t0 = Date.now();
  // S.EMU_DONE: 由外部 (例: cycle_measure.js 的 S.CM.stop) 提前结束原版; S.EMU_MS: 原版运行的时间上限 (默认 230 秒)
  while (!done && !S.EMU_DONE && (S.SLICE_MS || Date.now() - t0 < (S.EMU_MS || 230000))) { c.run(2e7); await sliceWait(); }
  c.onTick = null; c.halted = false;
  return { shots, done, ip: (c.s[1] * 16 + c.ip - L).toString(16) };
}
// ---------------- 移植版 ----------------
const font = U.Font.fromRaw(f["1.PAT"], f["2.PAT"], S.rom);
{ const cm = JSON.parse(fs.readFileSync(S.W + "/uw2_remake/web/assets/font/charmap.json", "utf8")); font.u2c = new Map(); for (const [code, , , u] of cm.table) font.u2c.set(u, code); }
const A = S.W + "/uw2_remake/web/assets/", GFX = S.W + "/uw2_remake/tools/work/gfx/", SEA2 = S.W + "/uw2_remake/tools/work/sea2/";
const rdj = n => JSON.parse(fs.readFileSync(A + n, "utf8")), rdg = n => new Uint8Array(fs.readFileSync(GFX + n));
const menuText = rdj("text/menu.json"), palJson = rdj("data/palettes.json"), ngData = rdj("data/newgame.json"), nodes = U.decodeMapNodesJson(rdj("data/mapnodes.json"));
const portAssets = { za: U.decodeZaDatJson(rdj("data/za_dat.json")), chip: rdg("portchip.bin"), map: U.decodePortMapJson(rdj("data/portmap.json")), chr: rdg("char.bin"), compass: rdg("compass.bin"),
  data: rdj("data/port.json"), wind: U.decodeWindCurJson(rdj("data/windcur.json")), chipNo: rdj("data/portchip.json").chipNo, transit: rdg("transit.bin"), colony: rdj("text/colony.json"), itemMes: rdj("text/item_mes.json"), gamble: rdg("gamble.bin"), commands: rdj("data/commands.json") };
portAssets.data.bld2 = rdj("data/buildings2.json");                 // 王宫/事务所/住宅/银行/道具店 (port.js loadPortAssets 同一项)
Object.assign(portAssets, { worldmap: U.decodeWorldMapJson(rdj("data/worldmap.json")), seachip: rdg("seachip.bin"), seacompass: rdg("seacompass.bin"), sea: rdj("data/sea.json"), fleet: rdj("data/fleet.json") });   // 海上 (loadPortAssets 同一组)
Object.assign(portAssets, { hdat: rdg("hdat.bin"), battle: rdj("data/battle.json") });   // 海战 (loadPortAssets 同一组)
portAssets.monster = U.decodeMonsterJson(rdj("data/monster.json"));    // MONSTER.DAT (海上特殊地点, loadPortAssets 同一项)
portAssets.duel = { J: rdj("data/duel.json") };                        // 一骑打 (loadPortAssets 同一组)
const msg = f["MESSAGE.DAT"], initState = new Uint8Array(fs.readFileSync(S.W + "/uw2_remake/tools/work/newgame.bin"));
async function runJS(rng0) {
  const scr = new U.Screen(); let polls = 0;
  // S.JS_SYS: 移植版改用指定的 Sys 设置 (例: cycle_realtime.js 的实时模式 { virtual: false }); 默认为测试模式 (虚拟计时器)
  const sys = S.JS_SYS ? new U.Sys(S.JS_SYS) : new U.Sys({ virtual: true, poll: async () => { if (++polls > (S.POLL_LIMIT || 8e6)) throw new Error("poll limit"); if (S.SLICE_MS && !(polls & 1023)) await sliceWait(); } });
  sys.mouse.x = 320; sys.mouse.y = 240;
  const state = new U.GameState(initState);
  const ctx = { scr, sys, state, initState, font, ASSETS: "", options: { get animate() { return !!(state.options & 1); } } };
  // 剧本: S.NO_EVENTS 时原版的事件检查被改成直接返回, 移植版也略过; 其余情况两边都运行剧本 VM
  ctx.noEvents = !!S.NO_EVENTS; ctx.noFleets = !!S.NO_FLEETS; ctx.noFleetAI = !S.FLEET_AI;
  const lazy = dir => new Proxy({}, { get: (o, k) => (o[k] ??= rdj(`${dir}${k}.json`)) });
  ctx.scenarioData = { vm: rdj("scenario/vm.json"), snr: lazy("scenario/snr"), mes: lazy("text/snr") };
  ctx.palette = new U.Palette(scr, sys, U.paletteTables(palJson));
  ctx.bgm = { song: 0xff, playSong(id) { if (id <= 0x17) this.song = id; }, fadeOut() {}, resume() {} };   // song = [8c1e] (环境设置的 BGM 开关重播它, core/audio.js)
  const sfxJ = S.sfxJ = [];                                          // S.SFX_LOG: 移植版的效果音指令 (见 runEmu); 没有 SFX_LOG 时 ctx.sfx 不存在, 效果音调用一律略过
  if (S.SFX_LOG) { ctx.sfx = new U.SfxPort(null, { log: m => sfxJ.push([shots.length, m.ah, m.al, m.ah === 5 ? m.addr : m.ah === 6 ? m.dl : 0]) }); ctx.sfx.state = state; }
  const con = new U.TextConsole(scr, font, { wait: n => sys.waitSpeed(n) });
  const win = new U.WindowSystem(scr, con, S.D1[14], { wait: n => sys.waitTicks(n), options: ctx.options, sys });
  const graph = new U.Graph(scr);                                      // PNG manifest 由浏览器运行时 ArtRegistry 提供
  const menu = new U.MenuSystem({ sys, scr, con, win, gfx: S.D1[14], graph });
  const message = (n, ...a) => { const off = (msg[n * 2] << 8) | msg[n * 2 + 1]; U.cprintf(msg.subarray(off, off + 256), a, ch => con.putc(ch)); };
  const printf = (fmt, ...a) => U.cprintf(typeof fmt === "string" ? font.encode(fmt + "\0") : fmt, a, ch => con.putc(ch));
  const menuItems = n => menuText[n].replace(/^(?:\{[0-9A-F]{2}\}|[^{]){2}/, "").split("{00}").slice(0, -1).map(s => font.encode(s + "{00}"));
  Object.assign(ctx, { con, win, graph, menu, message, printf, menuItems, gfx: S.D1[14], kao: new U.Kao(f["KAO.LZW"]), newgameData: ngData, mapNodes: nodes, portAssets });
  const prJ = S.probeJ = [];
  if (S.PROBES?.length) ctx.probe = name => { if (S.PROBES.some(p => p.name === name) && prJ.length < 200) prJ.push({ name, x: (S.EXTRA_DS || []).map(([a, b]) => (ctx.battleDS || new Uint8Array(0x10000)).slice(a, b)), st: state.b.slice(0, 0x8a18 - 0x0ca4), rng: sys.rng.state, fb: scr.fb.slice(), shot: shots.length }); };
  ctx.saveFile = new U.SaveFile(new Uint8Array(save0)); ctx.saveFile.flush = () => {};   // 原版运行时会写入 f["KOUKAI2.DAT"] (模拟磁盘), 移植版用运行前的副本
  const sc = S.makeScript(KEYS.concat([{ mouse: {} }])), shots = [];
  let synced = false;
  const r0 = sys.rng.rand.bind(sys.rng);
  sys.rng.rand = () => { if (!synced && ctx.menu.count === 4 && ctx.menu.level === 0) { synced = true; sc.calls = 0; sys.rng.state = rng0; } return r0(); };
  sys.onIO = s => S.scriptStep(sc, s.keybuf, (a, b) => s.pushKey(a, b), k => {
    if (k && k.mouse) { S.mickeyAdd(s.mouse, k.mouse.x, k.mouse.y, s.mickeyRatio?.[0] ?? 8, s.mickeyRatio?.[1] ?? 16); if ('x' in k.mouse) s.mouse.x = k.mouse.x; if ('y' in k.mouse) s.mouse.y = k.mouse.y; if ('b' in k.mouse) s.mouse.buttons = k.mouse.b; }
    let fb = scr.fb.slice(), fh;
    if (S.FB_HASH) { const R = S.emuShotsRef, n = shots.length, e = R?.[n]; fh = fbHash(fb, Array.from({ length: (S.CURSOR_LAG ?? 1) + 1 }, (_, k) => R?.[n - k]?.mouse)); if (!e?.fb) fb = null; }
    if (S.SHOT_RANGE && (shots.length < S.SHOT_RANGE[0] || shots.length >= S.SHOT_RANGE[1]) && sc.keys.length) shots.push({ skip: true });
    else shots.push({ fb, fh, x: (S.EXTRA_DS || []).map(([a, b]) => (ctx.battleDS || new Uint8Array(0x10000)).slice(a, b)), dac: Array.from(scr.raw), st: state.b.slice(0, 0x8a18 - 0x0ca4), rt: ctx.rt ? [ctx.rt.year, ctx.rt.month, ctx.rt.day, ctx.rt.time] : [], rng: sys.rng.state });
    { const tp = S.TELEPORT?.[shots.length - 1]; if (tp) for (const [a, v] of tp) state.set8(a, v); }
    if (!sc.keys.length) throw new Error("STOP");
  });
  const enter0 = U.PortScene.prototype.enter;
  if (S.PORT_SETUP) U.PortScene.prototype.enter = function () { U.PortScene.prototype.enter = enter0; const P = S.PORT_SETUP, st = this.st;
    st.set8(0x0cae, P.port); st.set8(0x0caf, 0x82); st.set16(0x0cb4, P.vx); st.set16(0x0cb6, P.vy); st.set16(0x0cb8, P.hx); st.set16(0x0cba, P.hy);
    if (P.time !== undefined) { st.set8(0x0cad, P.time); this.c.rt.time = P.time; }
    for (const [a, v] of P.poke || []) st.set8(a, v);
    P.jsHook?.(st);
    return enter0.call(this); };
  try { const r = await new U.Title(ctx).run(); if (r === 1) await new U.GameClock(ctx).run(); } catch (e) { if (e.mainExit) S.MAIN_EXIT = e.params; else if (e.message !== "STOP") throw e; }   // MainExit: 1764f 结局 (INT 65h 的值) finally { U.PortScene.prototype.enter = enter0; }
  return { shots, ctx };
}
// 原版的随机数初值 (标题菜单第一次 random 时) 由 newgame_tests 的方法取得: 先跑原版, 从第一张截屏前的状态回推不可行, 改为直接读
S.restoreTitle(); const c0 = S.titleEnv.cpu, d0 = c0.s[3] * 16;
const rngTitle = (c0.mem[d0 + 0xbd88] | (c0.mem[d0 + 0xbd89] << 8) | (c0.mem[d0 + 0xbd8a] << 16) | (c0.mem[d0 + 0xbd8b] << 24)) >>> 0;
const save0 = new Uint8Array(fs.readFileSync(S.W + "/uw2_remake/tools/work/sea2/KOUKAI2.DAT"));   // 原始存盘 (模拟磁盘上的 f["KOUKAI2.DAT"] 会被存盘路线改写)
if (f["KOUKAI2.DAT"].length === save0.length) f["KOUKAI2.DAT"].set(save0);   // 两边都从原始存盘开始 (上一次测试的存盘路线改写过模拟磁盘)
const E = await runEmu();
S.emuShotsRef = E.shots;
const J = await runJS(rngTitle);
S.emuShotsRef = null;
S.lastRun = { E, J };                                             // 供测试后检查 (例: 最终状态 E.shots.at(-1).st)
const rep = [`keys=${KEYS.length} emuShots=${E.shots.length} jsShots=${J.shots.length} emuDone=${E.done} ip=${E.ip}`];
if (S.PROBES?.length) {                                            // 快照比对 (S.PROBES)
  const pe = S.probeE, pj = S.probeJ;
  rep.push(`[probe] emu ${pe.length} / js ${pj.length}`);
  for (let i = 0; i < Math.min(pe.length, pj.length); i++) {
    const e = pe[i], j = pj[i], sd = [];
    for (let k = 0; k < e.st.length; k++) if (e.st[k] !== j.st[k]) sd.push((0x0ca4 + k).toString(16) + ":" + e.st[k].toString(16) + "/" + j.st[k].toString(16));
    (S.EXTRA_DS || []).forEach(([a], r) => { for (let k = 0; k < e.x[r].length; k++) if (e.x[r][k] !== j.x[r][k]) sd.push((a + k).toString(16) + ":" + e.x[r][k].toString(16) + "/" + j.x[r][k].toString(16)); });
    const ef = e.fb, m = e.mouse; ef[399 * 640 + 639] = j.fb[399 * 640 + 639];
    for (let yy = m.y - 40; yy < m.y - 16; yy++) for (let xx = m.x; xx < m.x + 24; xx++) if (yy >= 0 && yy < 400 && xx < 640) ef[yy * 640 + xx] = j.fb[yy * 640 + xx];
    let fd = 0; for (let k = 0; k < 640 * 400; k++) if (ef[k] !== j.fb[k]) fd++;
    const ok = e.name === j.name && !sd.length && e.rng === j.rng && !fd;
    rep.push(`${ok ? "POK " : "PFAIL"} probe ${i} ${e.name}/${j.name} @shot ${e.shot}/${j.shot} fb ${fd} state=${sd.length}${sd.length ? " " + sd.slice(0, 8).join(" ") : ""} rng ${e.rng === j.rng ? "=" : e.rng.toString(16) + "/" + j.rng.toString(16)}`);
  }
}
const n = Math.min(E.shots.length, J.shots.length);
let firstStateDiff = -1;
for (let i = 0; i < n; i++) {
  const e = E.shots[i], j = J.shots[i];
  if (e.skip || j.skip) continue;
  if (!e.fb || !j.fb) {                                              // S.FB_HASH: 只比哈希
    let dd = 0; for (let k = 0; k < (S.DAC_N ?? 16); k++) if (e.dac[k * 3] !== j.dac[k * 3 + 1] * 4 || e.dac[k * 3 + 1] !== j.dac[k * 3 + 2] * 4 || e.dac[k * 3 + 2] !== j.dac[k * 3] * 4) dd++;
    const sd = []; for (let k = 0; k < e.st.length; k++) if (e.st[k] !== j.st[k]) sd.push((0x0ca4 + k).toString(16) + ":" + e.st[k].toString(16) + "/" + j.st[k].toString(16));
    (S.EXTRA_DS || []).forEach(([a], r) => { for (let k = 0; k < e.x[r].length; k++) if (e.x[r][k] !== j.x[r][k]) sd.push((a + k).toString(16) + ":" + e.x[r][k].toString(16) + "/" + j.x[r][k].toString(16)); });
    if (sd.length && firstStateDiff < 0) firstStateDiff = i;
    const ok = e.fh === j.fh && !dd && !sd.length && e.rng === j.rng && (i < NEWGAME.length || e.rt.join() === j.rt.join());
    rep.push(`${ok ? "OK  " : "FAIL"} #${String(i).padStart(2)} ${i < KEYS.length ? JSON.stringify(KEYS[i]) : "end"} fb ${e.fh === j.fh ? "=" : "≠"} dac=${dd} state=${sd.length}${sd.length ? " " + sd.slice(0, 8).join(" ") : ""} rng ${e.rng === j.rng ? "=" : e.rng.toString(16) + "/" + j.rng.toString(16)} rt ${e.rt}/${j.rt}`);
    continue;
  }
  e.fb[399 * 640 + 639] = j.fb[399 * 640 + 639];
  // 原版的软件光标画在 VRAM 里 (24×24, 热点左上): 遮掉目前与上一次的光标位置
  // S.CURSOR_LAG = n: 原版软件光标有时晚几张才在旧位置重画/还原 (鼠标在测试中是瞬间移动的), 改为遮掉最近 n+1 张的所有位置
  for (const m of Array.from({ length: (S.CURSOR_LAG ?? 1) + 1 }, (_, k) => E.shots[i - k]?.mouse)) if (m) for (let yy = m.y - 40; yy < m.y - 16; yy++) for (let xx = m.x; xx < m.x + 24; xx++)
    if (yy >= 0 && yy < 400 && xx < 640) e.fb[yy * 640 + xx] = j.fb[yy * 640 + xx];
  const d = S.cmp(e.fb, j.fb);
  let dd = 0; for (let k = 0; k < (S.DAC_N ?? 16); k++) if (e.dac[k * 3] !== j.dac[k * 3 + 1] * 4 || e.dac[k * 3 + 1] !== j.dac[k * 3 + 2] * 4 || e.dac[k * 3 + 2] !== j.dac[k * 3] * 4) dd++;
  const sd = []; for (let k = 0; k < e.st.length; k++) if (e.st[k] !== j.st[k]) sd.push((0x0ca4 + k).toString(16) + ":" + e.st[k].toString(16) + "/" + j.st[k].toString(16));
    (S.EXTRA_DS || []).forEach(([a], r) => { for (let k = 0; k < e.x[r].length; k++) if (e.x[r][k] !== j.x[r][k]) sd.push((a + k).toString(16) + ":" + e.x[r][k].toString(16) + "/" + j.x[r][k].toString(16)); });
  if (sd.length && firstStateDiff < 0) firstStateDiff = i;
  if (d.n) { fs.writeFileSync(S.W + `/uw2_remake/tools/work/pt_emu_${i}.idx`, Buffer.from(e.fb)); fs.writeFileSync(S.W + `/uw2_remake/tools/work/pt_js_${i}.idx`, Buffer.from(j.fb)); fs.writeFileSync(S.W + `/uw2_remake/tools/work/pt_dac_${i}.json`, JSON.stringify(e.dac)); }
  const ok = !d.n && !dd && !sd.length && e.rng === j.rng && (i < NEWGAME.length || e.rt.join() === j.rt.join());
  rep.push(`${ok ? "OK  " : "FAIL"} #${String(i).padStart(2)} ${i < KEYS.length ? JSON.stringify(KEYS[i]) : "end"} diff=${d.n}${d.first ? " @" + d.first : ""} dac=${dd} state=${sd.length}${sd.length ? " " + sd.slice(0, 8).join(" ") : ""} rng ${e.rng === j.rng ? "=" : e.rng.toString(16) + "/" + j.rng.toString(16)} rt ${e.rt}/${j.rt}`);
}
if (S.SFX_LOG) {
  const a = S.sfxE, b = S.sfxJ; let d = -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (String(a[i]) !== String(b[i])) { d = i; break; }
  rep.push(`${d < 0 ? "OK  " : "FAIL"} sfx 效果音呼叫 原版 ${a.length} / 移植 ${b.length}${d >= 0 ? ` 第 ${d} 筆 原版 ${a[d]} 移植 ${b[d]}` : ""}: ${a.slice(0, 8).map(x => x.map(v => v.toString(16)).join(":")).join(" ")}`);
}
if (S.SAVE_PT) for (const i of S.SAVE_PT) if (E.shots[i]) { fs.writeFileSync(S.W + `/uw2_remake/tools/work/pts_${i}.idx`, Buffer.from(E.shots[i].fb)); fs.writeFileSync(S.W + `/uw2_remake/tools/work/pts_${i}.dac`, JSON.stringify(E.shots[i].dac)); }
if (S.WATCH !== undefined) rep.push('watch ' + S.WATCH.toString(16) + ': ' + JSON.stringify(S.watchLog));
if (S.PT_DEBUG) rep.push('emu mouse: ' + E.shots.slice(0, 6).map(x => x.mouse.x + ',' + x.mouse.y).join(' '));
// S.QUIET: 只印不一致的画面与总计
if (S.QUIET) { const bad = rep.filter(l => !l.startsWith("OK") && !l.startsWith("POK")); console.log(rep[0].startsWith("keys") ? rep[0] : "", bad.slice(0, 12).join("\n"), `\n[summary] ${rep.filter(l => l.startsWith("OK")).length}/${rep.filter(l => /^(OK|FAIL)/.test(l)).length} OK` + (S.PROBES?.length ? `  [probes] ${rep.filter(l => l.startsWith("POK")).length}/${rep.filter(l => /^(POK|PFAIL)/.test(l)).length} OK` : "")); }
else console.log(rep.join("\n"));
})();
