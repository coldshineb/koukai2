// newgame_tests.js — 开始新航海 差分测试 (先加载 x86emu/dosenv/harness/harness_menu/boot_title 与 tools/work/ui_bundle.js)
// 以同一按键脚本分别驱动原版 (模拟器, 从标题菜单状态开始) 与移植版, 在每次送键时截屏比对; 最后比对 16949 之后的游戏状态
(async function () {
const fs = require("fs"), S = session, U = S.UI, f = S.files;
const K = { down: [0x50, 0], up: [0x48, 0], left: [0x4b, 0], right: [0x4d, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b], n1: [0x02, 0x31], n3: [0x04, 0x33] };
const KEYS = S.NG_KEYS || [K.down, K.enter, K.right, K.enter, K.enter, K.esc, K.enter, K.right, K.enter, K.esc, K.left, K.left, K.down, K.down, K.enter,
  K.down, K.enter, K.n3, K.esc, K.down, K.enter, K.esc, K.left, K.left, K.enter, K.enter];
const L = 0x110 * 16, BREAK = L + 0x16faf;
// ---------------- 原版 ----------------
function runEmu() {
  S.restoreTitle();
  const env = S.titleEnv, c = env.cpu, shots = [], dacs = [];
  let rng0 = null, done = false, st = null, rt = null;
  const sc = S.makeScript(KEYS);
  const saveEnv = S.env, sH16 = S._H16, sH33 = S._H33; S.env = env; S._H16 = S._H33 = undefined;   // installEmuServices 会缓存原始 INT16/33 处理
  S.etr = [];
  { const h16 = c.hooks[0x16], h33 = c.hooks[0x33]; S._wrapEmu = () => { const a = c.hooks[0x16]._orig || c.hooks[0x16], b = c.hooks[0x33]._orig || c.hooks[0x33]; c.hooks[0x16] = cpu => { if ((cpu.r[0] >> 8) === 1) S.etr.push('K'); a(cpu); }; c.hooks[0x33] = cpu => { if (cpu.r[0] === 3) S.etr.push('M'); b(cpu); }; c.hooks[0x16]._orig = a; c.hooks[0x33]._orig = b; }; }
  S.installEmuServices(sc, () => {
    S.etr.push('|');
    if (rng0 === null) { const d = c.s[3] * 16 + 0xbd88; rng0 = (c.mem[d] | (c.mem[d + 1] << 8) | (c.mem[d + 2] << 16) | (c.mem[d + 3] << 24)) >>> 0; }
    shots.push(S.emuFb480()); dacs.push(Array.from(c.vga.dac.slice(0, 48)));
    { const d = c.s[3] * 16 + 0xbd88; (S.emuRngLog ??= []).push((c.mem[d] | (c.mem[d + 1] << 8) | (c.mem[d + 2] << 16) | (c.mem[d + 3] << 24)) >>> 0); }
  });
  S.env = saveEnv; S._H16 = sH16; S._H33 = sH33;
  S._wrapEmu();
  c.onTick = cpu => {
    const lin = cpu.s[1] * 16 + cpu.ip;
    if (lin === L + 0x4d92) { if (S.TRACE) S.etr.push('R'); if (!S.emuSynced) { S.emuSynced = true; sc.calls = 0; S.etr.length = 0; } }
    if (lin === L + 0x16949 || lin === L + 0x1695c || lin === L + 0x16964) { const d = cpu.s[3] * 16 + 0xbd88; (S.emuInitRng ??= []).push(lin.toString(16) + ":" + ((cpu.mem[d] | (cpu.mem[d + 1] << 8) | (cpu.mem[d + 2] << 16) | (cpu.mem[d + 3] << 24)) >>> 0).toString(16) + " ax=" + cpu.r[0].toString(16)); }
    if (lin === BREAK) {
      const d = cpu.s[3] * 16; st = cpu.mem.slice(d + 0x0ca4, d + 0x8d18); rt = Array.from(cpu.mem.slice(d + 0x532, d + 0x536));
      const r = []; for (let i = 92; i < 117; i++) { const o = d + 0xbdcc + i * 8; r.push(cpu.mem[o] | cpu.mem[o + 1] << 8, cpu.mem[o + 2] | cpu.mem[o + 3] << 8); }
      S.emuRectTail = r; cpu.halted = true; done = true;
    }
  };
  for (let k = 0; k < 60 && !done; k++) c.run(5e7);
  c.onTick = null; c.halted = false;
  return { shots, dacs, rng0, st, rt, done };
}
// ---------------- 移植版 ----------------
const font = U.Font.fromRaw(f["1.PAT"], f["2.PAT"], S.rom);
{ const cm = JSON.parse(fs.readFileSync(S.W + "/uw2_remake/web/assets/font/charmap.json", "utf8")); font.u2c = new Map(); for (const [code, , , u] of cm.table) font.u2c.set(u, code); }
const menuText = JSON.parse(fs.readFileSync(S.W + "/uw2_remake/web/assets/text/menu.json", "utf8"));
const palJson = JSON.parse(fs.readFileSync(S.W + "/uw2_remake/web/assets/data/palettes.json", "utf8"));
const ngData = JSON.parse(fs.readFileSync(S.W + "/uw2_remake/web/assets/data/newgame.json", "utf8"));
const nodes = U.decodeMapNodesJson(JSON.parse(fs.readFileSync(S.W + "/uw2_remake/web/assets/data/mapnodes.json", "utf8")));
const msg = f["MESSAGE.DAT"];
const initState = new Uint8Array(fs.readFileSync(S.W + "/uw2_remake/tools/work/newgame.bin"));
async function runJS(rng0) {
  const scr = new U.Screen(); let polls = 0;
  const sys = new U.Sys({ virtual: true, poll: async () => { if (++polls > 4e6) throw new Error("poll limit"); } });
  sys.mouse.x = 320; sys.mouse.y = 240;
  const state = new U.GameState(initState);
  const ctx = { scr, sys, state, initState, font, ASSETS: "", options: { get animate() { return !!(state.options & 1); } } };
  ctx.palette = new U.Palette(scr, sys, U.paletteTables(palJson));
  ctx.bgm = { playSong() {}, fadeOut() {}, resume() {} };
  const con = new U.TextConsole(scr, font, { wait: n => sys.waitSpeed(n) });
  const win = new U.WindowSystem(scr, con, S.D1[14], { wait: n => sys.waitTicks(n), options: ctx.options, sys });
  const graph = new U.Graph(scr); graph.files = { "GRAPH.DAT": new U.GraphDat(f["GRAPH.DAT"]), "GRAPH2.DAT": new U.GraphDat(f["GRAPH2.DAT"]) }; graph.g = graph.files["GRAPH.DAT"];
  const menu = new U.MenuSystem({ sys, scr, con, win, gfx: S.D1[14], graph });
  const message = (n, ...a) => { const off = (msg[n * 2] << 8) | msg[n * 2 + 1]; U.cprintf(msg.subarray(off, off + 256), a, ch => con.putc(ch)); };
  const printf = (fmt, ...a) => U.cprintf(typeof fmt === "string" ? font.encode(fmt + "\0") : fmt, a, ch => con.putc(ch));
  const menuItems = n => menuText[n].replace(/^(?:\{[0-9A-F]{2}\}|[^{]){2}/, "").split("{00}").slice(0, -1).map(s => font.encode(s + "{00}"));
  Object.assign(ctx, { con, win, graph, menu, message, printf, menuItems, gfx: S.D1[14], kao: new U.Kao(f["KAO.LZW"]), newgameData: ngData, mapNodes: nodes });
  ctx.saveFile = new U.SaveFile(new Uint8Array(f["KOUKAI2.DAT"])); ctx.saveFile.flush = () => {};
  const sc = S.makeScript(KEYS), frames = [], dacs = [];
  let first = true, out = null;
  S.jtr = [];
  { const r0 = sys.rng.rand.bind(sys.rng); sys.rng.rand = () => { if (!S.jsSynced && ctx.menu.count === 4 && ctx.menu.level === 0) { S.jsSynced = true; sc.calls = 0; S.jtr.length = 0; } S.jtr.push('R'); return r0(); };
    const kb = sys.kbhit.bind(sys); sys.kbhit = () => { S.jtr.push('K'); return kb(); };
    const ml = sys.mouseLeft.bind(sys), mr = sys.mouseRight.bind(sys), mp = sys.mousePos.bind(sys), ms = sys.mouseShow.bind(sys);
    sys.mouseLeft = () => { S.jtr.push('M'); return ml(); }; sys.mouseRight = () => { S.jtr.push('M'); return mr(); };
    sys.mousePos = () => { S.jtr.push('M'); return mp(); };
    sys.mouseShow = () => { if (sys.mouse.present && sys.mouse.visible === 0) S.jtr.push('M'); return ms(); }; }
  sys.onIO = s => S.scriptStep(sc, s.keybuf, (a, b) => s.pushKey(a, b), () => {
    S.jtr.push('|');
    if (first) { sys.rng.state = rng0; first = false; }
    frames.push(scr.fb.slice()); dacs.push(Array.from(scr.raw)); (S.jsRngLog ??= []).push(sys.rng.state);
  });
  const init0 = U.NewGame.prototype.init;
  U.NewGame.prototype.init = function () { S.jsInitRng = sys.rng.state.toString(16); init0.call(this); out = { st: ctx.state.b.slice(), rt: ctx.rt }; throw new Error("STOP"); };
  try { await new U.Title(ctx).run(); } catch (e) { if (e.message !== "STOP") throw e; } finally { U.NewGame.prototype.init = init0; }
  return { frames, dacs, out, ctx };
}
S.emuRngLog = []; S.emuInitRng = []; S.emuSynced = false;
const E = runEmu();
S.jsRngLog = []; S.jsSynced = false;
const J = await runJS(E.rng0);
if (S.SAVE_FRAMES) for (const i of S.SAVE_FRAMES) { fs.writeFileSync(S.W + `/uw2_remake/tools/work/ngf_${i}.idx`, Buffer.from(E.shots[i])); fs.writeFileSync(S.W + `/uw2_remake/tools/work/ngf_${i}.dac`, JSON.stringify(E.dacs[i])); }
const rep = [];
const n = Math.min(E.shots.length, J.frames.length);
rep.push(`keys=${KEYS.length} emuShots=${E.shots.length} jsFrames=${J.frames.length} emuReachedInit=${E.done}`);
for (let i = 0; i < n; i++) {
  E.shots[i][399 * 640 + 639] = J.frames[i][399 * 640 + 639];   // 原版软件光标 (鼠标在 27F,18F) 画在 VRAM
  const d = S.cmp(E.shots[i], J.frames[i]);
  if (d.n) { fs.writeFileSync(S.W + `/uw2_remake/tools/work/ng_emu_${i}.idx`, Buffer.from(E.shots[i])); fs.writeFileSync(S.W + `/uw2_remake/tools/work/ng_js_${i}.idx`, Buffer.from(J.frames[i])); }
  // DAC: 原版 VGA DAC 为 6 比特 RGB, 移植版 raw 为 4 比特 (B,R,G)
  const ed = E.dacs[i], jd = J.dacs[i]; let dd = 0;
  for (let c = 0; c < 16; c++) { const [r, g, b] = [ed[c * 3], ed[c * 3 + 1], ed[c * 3 + 2]]; if (r !== jd[c * 3 + 1] * 4 || g !== jd[c * 3 + 2] * 4 || b !== jd[c * 3] * 4) dd++; }
  rep.push(`${d.n === 0 ? "OK  " : "FAIL"} shot#${String(i).padStart(2)} before key ${JSON.stringify(KEYS[i])} diff=${d.n}${d.first ? " @" + d.first : ""} dacDiffColors=${dd}`);
}
if (E.st && J.out) {
  const js = J.out.st, diffs = [];
  for (let i = 0; i < 0x8a18 - 0x0ca4; i++) if (E.st[i] !== js[i]) diffs.push((0x0ca4 + i).toString(16) + ":" + E.st[i].toString(16) + "/" + js[i].toString(16));
  rep.push(`${js.subarray(0x8a18 - 0x0ca4).every(v => v === 0xff) ? "OK  " : "FAIL"} [0c8e] buffer = FF x 0x300`);
  rep.push(`${diffs.length ? "FAIL" : "OK  "} state 0ca4..8a18 after 16949: diffBytes=${diffs.length} ${diffs.slice(0, 20).join(" ")}`);
  const rt = [J.out.rt.year, J.out.rt.month, J.out.rt.day, J.out.rt.time];
  rep.push(`${E.rt.join() === rt.join() ? "OK  " : "FAIL"} rt [0532..0535] emu=${E.rt} js=${rt}`);
  fs.writeFileSync(S.W + "/uw2_remake/tools/work/emu_newgame_state.bin", Buffer.from(E.st));
} else rep.push("FAIL state capture: emu=" + !!E.st + " js=" + !!J.out);
{ const step = s => (Math.imul(s, 0x41c64e6d) + 0x3039) >>> 0, e0 = S.emuRngLog[0];
  const pos = t => { let s = e0; for (let i = 0; i < 1e6; i++) { if (s === t) return i; s = step(s); } return -1; };
  const pe = S.emuRngLog.map(pos), pj = S.jsRngLog.map(pos);
  rep.push("rng calls between keys emu: " + pe.map((v, i) => i ? v - pe[i - 1] : 0).join(" "));
  rep.push("rng calls between keys js : " + pj.map((v, i) => i ? v - pj[i - 1] : 0).join(" ")); }
rep.push("rng emu: " + S.emuRngLog.map(v => v.toString(16)).join(" "));
rep.push("rng js : " + S.jsRngLog.map(v => v.toString(16)).join(" "));
rep.push("init rng emu: " + S.emuInitRng.join(" ") + " | js: " + S.jsInitRng);
{ const es = S.etr.join("").split("|"), js = S.jtr.join("").split("|");
  { const a = S.etr.join(""), b = S.jtr.join(""); let k = 0; while (k < a.length && a[k] === b[k]) k++;
    rep.push(`trace first diff at ${k}: emu ...${a.slice(Math.max(0, k - 120), k)}[${a.slice(k, k + 60)}]`); rep.push(`                       js  ...${b.slice(Math.max(0, k - 120), k)}[${b.slice(k, k + 60)}]`); }
  for (const i of (S.TRACE_IDX || [2, 3])) { rep.push(`trace ${i} emu: ${es[i]}`); rep.push(`trace ${i} js : ${js[i]}`); } }
rep.push("emu rects 92..116 nonzero: " + (S.emuRectTail || []).filter(v => v).length);
console.log(rep.join("\n"));
})();
