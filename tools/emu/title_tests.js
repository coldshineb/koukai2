// title_tests.js — 开机/标题/读档画面差分测试 (先运行 title 参考截屏: session.titleEnv / titleState, 以及 ui_bundle.js)
(async function () {
const fs = require("fs"), S = session, U = S.UI;
const f = S.files;
const font = U.Font.fromRaw(f["1.PAT"], f["2.PAT"], S.rom);
const cm = JSON.parse(fs.readFileSync(S.W + "/uw2_remake/web/assets/font/charmap.json", "utf8"));
font.u2c = new Map(); for (const [code, , , u] of cm.table) font.u2c.set(u, code);
const menuText = JSON.parse(fs.readFileSync(S.W + "/uw2_remake/web/assets/text/menu.json", "utf8"));
const palJson = JSON.parse(fs.readFileSync(S.W + "/uw2_remake/web/assets/data/palettes.json", "utf8"));
const msg = f["MESSAGE.DAT"];
const initState = new Uint8Array(fs.readFileSync(S.W + "/uw2_remake/tools/work/newgame.bin"));   // = world.json 编码结果 (见 data_tests)
// 创建与 web/src/main.js + ui/index.js 相同的 ctx (计时器为测试模式)
function makeCtx(script, frames) {
  const scr = new U.Screen();
  let polls = 0;
  const sys = new U.Sys({ virtual: true, poll: async () => { if (++polls > 2e6) throw new Error("poll limit"); } });
  sys.mouse.x = 320; sys.mouse.y = 240;
  if (script) sys.onIO = s => S.scriptStep(script, s.keybuf, (a, b) => s.pushKey(a, b), () => frames && frames.push(scr.fb.slice()));
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
  Object.assign(ctx, { con, win, graph, menu, message, printf, menuItems, gfx: S.D1[14] });
  ctx.saveFile = new U.SaveFile(new Uint8Array(f["KOUKAI2.DAT"])); ctx.saveFile.flush = () => {};
  return ctx;
}
const load = n => { const a = new Uint8Array(fs.readFileSync(S.W + "/uw2_remake/tools/work/" + n + ".idx")); return a.length === 640 * 480 ? a.subarray(640 * 40, 640 * 440) : a; };
const rep = [];
const report = (name, a, b, extra = "") => { const d = S.cmp(a, b); if (d.n) fs.writeFileSync(S.W + "/uw2_remake/tools/work/js_" + name.replace(/[^a-z]+/gi, "_") + ".idx", Buffer.from(b)); rep.push(`${d.n === 0 ? "OK  " : "FAIL"} ${name.padEnd(26)} diff=${d.n}${d.first ? " @" + d.first : ""} ${extra}`); };
// 1) 标题画面: 跑到菜单等待输入时截屏
{
  const shot = {}; const ctx = makeCtx(null);
  const t = new U.Title(ctx);
  let done = false;
  let idleCalls = 0;
  ctx.sys.onIO = () => { if (!done && ctx.menu.count === 4 && ++idleCalls > 60) { done = true; shot.fb = ctx.scr.fb.slice(); shot.dac = Array.from(ctx.palette.cur); throw new Error("STOP"); } };
  try { await t.run(); } catch (e) { if (e.message !== "STOP") throw e; }
  report("title screen", load("title"), shot.fb, "dac " + (shot.dac.join() === Array.from(palJson.palettes.find(p => p.name === "default").raw).join() ? "= default" : "differs"));
}
// 2) 读档画面: 标题选 继续航海进度 (Enter), 停在存盘一览等待输入
{
  const ctx = makeCtx(null); const t = new U.Title(ctx); let stage = 0, shotFb = null, stage1Calls = 0;
  ctx.sys.onIO = s => {
    if (stage === 0 && ctx.menu.count === 4) { stage = 1; s.pushKey(0x1c, 0x0d); }
    else if (stage === 1 && ctx.menu.count === 10 && !s.keybuf.length && ++stage1Calls > 60) { shotFb = ctx.scr.fb.slice(); throw new Error("STOP"); }
  };
  try { await t.run(); } catch (e) { if (e.message !== "STOP") throw e; }
  report("load: slot list", load("emu_slots"), shotFb);
}

// ---- 以按键脚本驱动 JS 版, 在指定时机截屏 ----
async function flow(keys, probes) {
  const ctx = makeCtx(null); const t = new U.Title(ctx); const out = {};
  const sc = S.makeScript(keys);
  ctx.sys.onIO = s => {
    for (const p of probes) if (p.when && !out[p.name] && p.when(ctx, sc, s)) { out[p.name] = p.grab(ctx, t); if (p.stop) throw new Error("STOP"); }
    S.scriptStep(sc, s.keybuf, (a, b) => s.pushKey(a, b));
  };
  if (probes.some(p => p.atPress)) { const wp = ctx.menu.waitPress.bind(ctx.menu); ctx.menu.waitPress = async () => { for (const p of probes) if (p.atPress) out[p.name] = p.grab(ctx, t); throw new Error("STOP"); }; }
  if (probes.some(p => p.atLoad)) { const lm = t.loadMenu.bind(t); t.loadMenu = async () => { const r = await lm(); if (r) { for (const p of probes) if (p.atLoad) out[p.name] = p.grab(ctx, t); throw new Error("STOP"); } return r; }; }
  try { await t.run(); } catch (e) { if (e.message !== "STOP") throw e; }
  return out;
}
const idle = (ctx, sc, s) => !sc.keys.length && !s.keybuf.length && sc.calls > 60;
const K = { down: [0x50, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b] };
const fbGrab = ctx => ctx.scr.fb.slice();
{ // C) 继续 → Esc → 回到标题
  const o = await flow([K.enter, K.esc], [{ name: "cancel", when: (c, sc, s) => idle(c, sc, s) && c.menu.count === 4, grab: fbGrab, stop: true }]);
  report("load: cancel → title", load("emu_cancel"), o.cancel);
}
{ // B) 结束游戏 → 确认框 → 是 → KOEI 画面
  const o = await flow([K.down, K.down, K.down, K.enter], [{ name: "qc", when: (c, sc, s) => idle(c, sc, s) && c.menu.level === 2, grab: fbGrab, stop: true }]);
  report("quit: confirm", load("emu_quitConfirm"), o.qc);
  const o2 = await flow([K.down, K.down, K.down, K.enter, K.enter], [{ name: "logo", atPress: true, grab: c => ({ fb: c.scr.fb.slice(), dac: Array.from(c.palette.cur) }) }]);
  const edac = JSON.parse(fs.readFileSync(S.W + "/uw2_remake/tools/work/emu_logo_dac.json", "utf8"));
  report("quit: KOEI logo", load("emu_logo"), o2.logo.fb, "dac " + (edac.join() === o2.logo.dac.join() ? "same" : "DIFF"));
}
{ // A) 继续 → ↓↓ → Enter → 确认框 → 是 → 读档
  const o = await flow([K.enter, K.down, K.down, K.enter], [{ name: "cf", when: (c, sc, s) => idle(c, sc, s) && c.menu.level === 2, grab: fbGrab, stop: true }]);
  report("load: confirm", load("emu_confirm"), o.cf);
  const o2 = await flow([K.enter, K.down, K.down, K.enter, K.enter], [{ name: "ld", atLoad: true, grab: (c) => ({ fb: c.scr.fb.slice(), st: c.state.b.slice(0, 0x7d74), buf: c.state.b.slice(0x7d74, 0x8074), rt: c.rt }) }]);
  report("load: after load screen", load("emu_afterLoad"), o2.ld.fb);
  const est = new Uint8Array(fs.readFileSync(S.W + "/uw2_remake/tools/work/emu_loaded_state.bin")), ebuf = new Uint8Array(fs.readFileSync(S.W + "/uw2_remake/tools/work/emu_loaded_buf.bin"));
  const ert = JSON.parse(fs.readFileSync(S.W + "/uw2_remake/tools/work/emu_loaded_rt.json", "utf8"));
  const diffs = []; for (let i = 0; i < est.length; i++) if (est[i] !== o2.ld.st[i]) diffs.push((0x0ca4 + i).toString(16) + ":" + est[i].toString(16) + "/" + o2.ld.st[i].toString(16));
  let bd = 0; for (let i = 0; i < 0x300; i++) if (ebuf[i] !== o2.ld.buf[i]) bd++;
  const rtOk = JSON.stringify(ert) === JSON.stringify([o2.ld.rt.year, o2.ld.rt.month, o2.ld.rt.day, o2.ld.rt.time]);
  rep.push(`${diffs.length === 0 && bd === 0 && rtOk ? "OK  " : "FAIL"} load: state 0ca4..8a18      diffBytes=${diffs.length} ${diffs.slice(0, 12).join(" ")} buf0c8e diff=${bd} rt ${rtOk ? "same" : JSON.stringify(ert) + "/" + JSON.stringify(o2.ld.rt)}`);
}
console.log(rep.join("\n"));
})();
