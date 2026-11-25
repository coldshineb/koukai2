// menu_tests.js — 菜单/提示/确认框 差分测试 (先加载 ui_bundle.js; session 已 boot 并加载 harness_menu.js)
// 每个测试: 同一组按键脚本分别喂给原版 (模拟器) 和 JS 版, 比对每次送键时的画面、最终画面、返回值与状态。
(async function () {
const fs = require("fs"), S = session, U = S.UI, c = S.env.cpu, D = S.DSEG;
const f = S.files; const font = U.Font.fromRaw(f["1.PAT"], f["2.PAT"], S.rom);
const cm = JSON.parse(fs.readFileSync(S.W + "/uw2_remake/web/assets/font/charmap.json", "utf8"));
font.u2c = new Map(); for (const [code, , , u] of cm.table) font.u2c.set(u, code);
const menu = JSON.parse(fs.readFileSync(S.W + "/uw2_remake/web/assets/text/menu.json", "utf8"));
const items = n => menu[n].replace(/^(?:\{[0-9A-F]{2}\}|[^{]){2}/, "").split("{00}").filter(Boolean).map(s => Array.from(font.encode(s)));
const patch = lin => { c.mem[0x110 * 16 + lin] = 0xcb; };
const prepEmu = () => { S.loadState(S.base); S.setupMenuEnv(); patch(0x2f9a); patch(0x2fc0); S.emuFillBG();
  Object.assign(S.env.mouse, { x: 320, y: 240, b: 0 }); S.env.bioskeys = []; c.mem[D * 16 + 0x0ca4] = 1; };
const applyMouse = (m, k) => { if ("x" in k.mouse) m.x = k.mouse.x; if ("y" in k.mouse) m.y = k.mouse.y; if ("b" in k.mouse) m.b = k.mouse.b; };
const jsEnv = (script, frames) => {
  const scr = new U.Screen(); for (let y = 0; y < 400; y++) for (let x = 0; x < 640; x++) scr.fb[y * 640 + x] = S.bgcol(x, y);
  let polls = 0;
  const sys = new U.Sys({ virtual: true, poll: async () => { if (++polls > 300000) throw new Error("poll limit"); } });
  sys.mouse.x = 320; sys.mouse.y = 240;
  sys.onIO = s => S.scriptStep(script, s.keybuf, (sc, as) => s.pushKey(sc, as), k => {
    if (k.mouse) { const m = { x: sys.mouse.x, y: sys.mouse.y, b: sys.mouse.buttons }; applyMouse(m, k); sys.mouse.x = m.x; sys.mouse.y = m.y; sys.mouse.buttons = m.b; }
    frames.push(scr.fb.slice()); });
  const con = new U.TextConsole(scr, font);
  const win = new U.WindowSystem(scr, con, S.D1[14], { wait: n => sys.waitTicks(n), options: { animate: true } });
  const G = new U.GraphDat(S.files["GRAPH.DAT"]);
  const graph = { draw: (n, x, y) => G.draw(scr.fb, n, x, y), draw8: (n, x, y) => G.draw8(scr.fb, n, x, y) };
  return { scr, sys, con, win, menu: new U.MenuSystem({ sys, scr, con, win, gfx: S.D1[14], graph }) };
};
const runEmu = (lin, regs, keys) => {
  const sc = S.makeScript(keys), frames = [];
  S.installEmuServices(sc, k => { frames.push(S.emuFB().slice()); });
  const r = S.call(lin, { ...regs, maxIns: 4e8 });
  return { ret: r.ax & 0xff, frames, fb: S.emuFB().slice(), vars: S.menuVars(), left: sc.keys.length };
};
const K = { down: [0x50, 0], up: [0x48, 0], left: [0x4b, 0], right: [0x4d, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b], sp: [0x39, 0x20],
  n2: [0x50, 0x32], n4: [0x4b, 0x34], n6: [0x4d, 0x36], n8: [0x48, 0x38], zero: [0x52, 0x30], a: [0x1e, 0x61] };
const M = (x, y, b) => ({ mouse: { x, y, b } });
const rep = [];
const report = (name, E, r, jf, J) => {
  const fd = E.frames.length === jf.length ? E.frames.map((fr, i) => S.cmp(fr, jf[i]).n).reduce((a, b) => a + b, 0) : `frames ${E.frames.length} vs ${jf.length}`;
  const fin = S.cmp(E.fb, J.scr.fb);
  const ok = E.ret === r && fd === 0 && fin.n === 0;
  rep.push(`${ok ? "OK  " : "FAIL"} ${name.padEnd(28)} ret ${E.ret}/${r} frames=${E.frames.length} frameDiff=${fd} final=${fin.n}${fin.first ? " @" + fin.first : ""} bg ${E.vars.bg}/${J.con.bg}`);
};
// ---- 直式菜单 14364 ----
async function list(name, its, x, y, cancel, keys, disabled = 0) {
  prepEmu(); const tbl = S.emuTable(its); c.ww(D * 16 + 0xa14c, disabled);
  const E = runEmu(0x14364, { ax: x, dx: y, bx: its.length, args: [cancel, tbl] }, keys);
  const jf = []; const J = jsEnv(S.makeScript(keys), jf); J.menu.disabled = disabled;
  report(name, E, await J.menu.listMenu(x, y, its, cancel), jf, J);
}
// ---- 弹出菜单 1458c ----
async function popup(name, its, mx, my, cancel, keys) {
  prepEmu(); const tbl = S.emuTable(its); Object.assign(S.env.mouse, { x: mx, y: my });
  const E = runEmu(0x1458c, { ax: its.length, bx: tbl, dx: cancel }, keys);
  const jf = []; const J = jsEnv(S.makeScript(keys), jf); J.sys.mouse.x = mx; J.sys.mouse.y = my;
  report(name, E, await J.menu.popupMenu(its, cancel), jf, J);
}
// ---- 是/否 1469c ----
async function yesno(name, mx, my, keys) {
  prepEmu(); Object.assign(S.env.mouse, { x: mx, y: my });
  const E = runEmu(0x1469c, {}, keys);
  const jf = []; const J = jsEnv(S.makeScript(keys), jf); J.sys.mouse.x = mx; J.sys.mouse.y = my;
  report(name, E, await J.menu.yesNo(), jf, J);
}
// ---- 等待提示 147ab (先开一个窗口并写字) ----
async function prompt(name, keys) {
  prepEmu(); c.mem[D * 16 + 0x0ca4] = 0;
  S.call(0x7779, { ax: 10, dx: 100, bx: 40, args: [0, 96] }); S.emuStr(Array.from(font.encode("測試"))); S.call(0x4b9c, { bx: 0xe000 });
  c.mem[D * 16 + 0x0ca4] = 1;
  const E = runEmu(0x147ab, {}, keys);
  const jf = []; const J = jsEnv(S.makeScript(keys), jf); J.win.options.animate = false;
  J.win.shadowed(10, 100, 40, 96, 0); J.con.print("測試"); J.win.options.animate = true;
  await J.menu.waitPrompt();
  report(name, { ...E, ret: 0 }, 0, jf, J);
}
const it6 = items(6), it26 = items(26), it22 = items(22), it15 = items(15);
await list("list ↓↓↑ enter", it6, 10, 60, 1, [K.down, K.down, K.up, K.enter]);
await list("list esc", it6, 10, 60, 1, [K.down, K.esc]);
await list("list non-cancel esc", it6, 30, 100, 0, [K.esc, K.down, K.enter]);
await list("list wrap up (10 items)", it26, 2, 20, 1, [K.up, K.up, K.n8, K.enter]);
await list("list wrap down + space", it22, 50, 10, 1, [K.down, K.n2, K.down, K.down, K.down, K.down, K.down, K.sp]);
await list("list disabled item", it6, 20, 80, 1, [K.down, K.enter, K.down, K.enter], 0b0010);
await list("list '0' cancels", it6, 20, 80, 1, [K.zero]);
await list("list ←→ ignored, other key", it15, 40, 40, 1, [K.left, K.right, K.a, K.n4, K.n6, K.down, K.enter]);
await list("list mouse click item 2", it6, 10, 60, 1, [M(100, 60 + 40 + 16 + 24 * 2 + 4, 0), M(100, 60 + 40 + 16 + 24 * 2 + 4, 1), M(100, 60 + 40 + 16 + 24 * 2 + 4, 0)]);
await list("list right-click cancel", it6, 10, 60, 1, [M(100, 200, 2), M(100, 200, 0)]);
await popup("popup ↓ enter", it6, 300, 200, 1, [K.down, K.enter]);
await popup("popup near edge", it26, 630, 470, 1, [K.up, K.enter]);
await popup("popup top-left", it15, 5, 45, 1, [K.down, K.down, K.esc]);
await yesno("yes/no enter", 320, 240, [K.enter]);
await yesno("yes/no → enter", 320, 240, [K.right, K.enter]);
await yesno("yes/no ←← enter", 100, 300, [K.left, K.left, K.enter]);
await yesno("yes/no esc", 600, 470, [K.esc]);
await prompt("wait prompt (blink)", [{ mouse: {} }, { mouse: {} }, { mouse: {} }, { mouse: {} }, { mouse: {} }, { mouse: {} }, K.enter]);
console.log(rep.join("\n"));
})();
