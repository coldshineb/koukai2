// port_tests.js — 港口 差分測試: 同一按鍵腳本從標題選單開始 (開始新航海 → 里斯本港 → 走路/進建築), 分別驅動原版與移植版
// 每次送鍵時比對畫面、調色盤、亂數與遊戲狀態 (DS:0CA4..8A18 + 時間)
// 先載入 x86emu/dosenv/harness/harness_menu/boot_title(session.bootTitle()) 與 tools/work/ui_bundle.js
(async function () {
const fs = require("fs"), S = session, U = S.UI, f = S.files, L = 0x110 * 16;
const K = { down: [0x50, 0], up: [0x48, 0], left: [0x4b, 0], right: [0x4d, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b], sp: [0x39, 0x20] };
const NEWGAME = [K.down, K.enter, K.enter, K.enter, K.left, K.left, K.enter, K.left, K.left, K.enter, K.enter];
const KEYS = NEWGAME.concat(S.PORT_KEYS || [K.left, K.left, K.left, K.right, K.right, K.down, K.up, K.up, K.enter, K.left, K.down, K.down, K.right]);
const TAIL = 30;                    // 最後一鍵之後再等多少次輸入查詢才截最終狀態
const grabEmu = c => { const d = c.s[3] * 16; return { st: c.mem.slice(d + 0x0ca4, d + 0x8a18), rt: Array.from(c.mem.slice(d + 0x532, d + 0x536)),
  rng: ((c.mem[d + 0xbd88] | (c.mem[d + 0xbd89] << 8) | (c.mem[d + 0xbd8a] << 16) | (c.mem[d + 0xbd8b] << 24)) >>> 0) }; };
function runEmu() {
  S.restoreTitle();
  const env = S.titleEnv, c = env.cpu, shots = [];
  Object.assign(env.mouse, { x: 0x27f, y: 0x18f + 0x28, b: 0 });       // 標題時的滑鼠位置 (1752c), 上一次測試可能移動過
  const sc = S.makeScript(KEYS.concat([{ mouse: {} }]));            // 最後一個空動作 = 收尾截圖點
  let synced = false, done = false;
  const saveEnv = S.env, sH16 = S._H16, sH33 = S._H33; S.env = env; S._H16 = S._H33 = undefined;
  S.installEmuServices(sc, () => { const fb = S.emuFb480(); fb[399 * 640 + 639] = 0xff; shots.push({ mouse: { x: env.mouse.x, y: env.mouse.y }, fb, dac: Array.from(c.vga.dac.slice(0, 48)), ...grabEmu(c) });
    const tp = S.TELEPORT?.[shots.length - 1]; if (tp) for (const [a, v] of tp) c.mem[S.DSEG * 16 + a] = v;              // S.TELEPORT[畫面序號] = [[DS 位址, 值], ...]
    if (!sc.keys.length) { done = true; c.halted = true; } });
  S.env = saveEnv; S._H16 = sH16; S._H33 = sH33;
  c.mem[L + 0x1ac19] = 0xcb;
  // 劇本事件檢查 (2e09:5481 / 2e09:55c2) 尚未移植: 測試建築時以 S.NO_EVENTS 讓原版一律回傳「沒有事件」
  if (S.NO_EVENTS) for (const o of [0x33511, 0x33652]) { c.mem[L + o] = 0x31; c.mem[L + o + 1] = 0xc0; c.mem[L + o + 2] = 0xcb; }                       // 艦隊 AI (1ac19) 尚未移植: 兩邊都略過, 以便單獨驗證港口與建築
  let setupDone = !S.PORT_SETUP;
  // S.WATCH = DS 位址: 該位元組改變時記錄當時的指令位置 (之前已執行的那條指令) 與按鍵序號, 結果在 S.watchLog
  const W8 = S.WATCH, WF = S.WATCH_FROM || 0, WD = c.s[3] * 16, wlog = S.watchLog = []; let wv = -1, wip = 0;   // WD: 遊戲的 DS (標題時)
  c.onTick = cpu => {
    const lin = cpu.s[1] * 16 + cpu.ip;
    if (W8 !== undefined) { const v = cpu.mem[WD + W8]; if (wv >= 0 && v !== wv && shots.length >= WF && wlog.length < 50) wlog.push({ ip: (wip - L).toString(16), from: wv, to: v, shot: shots.length }); wv = v; wip = lin; }
    if (!synced && lin === L + 0x4d92) { synced = true; sc.calls = 0; }
    if (!setupDone && lin === L + 0x8c53) { setupDone = true; const d = cpu.s[3] * 16, P = S.PORT_SETUP;
      const w16 = (o, v) => { cpu.mem[d + o] = v & 255; cpu.mem[d + o + 1] = (v >> 8) & 255; };
      // [0caf] = 0x82 (存檔後的值): 重新讀入入口表但保留位置
      cpu.mem[d + 0x0cae] = P.port; cpu.mem[d + 0x0caf] = 0x82; w16(0x0cb4, P.vx); w16(0x0cb6, P.vy); w16(0x0cb8, P.hx); w16(0x0cba, P.hy);
      if (P.time !== undefined) { cpu.mem[d + 0x0cad] = P.time; cpu.mem[d + 0x0535] = P.time; }
      for (const [a, v] of P.poke || []) cpu.mem[d + a] = v; }
  };
  const t0 = Date.now();
  while (!done && Date.now() - t0 < 230000) c.run(2e7);
  c.onTick = null; c.halted = false;
  return { shots, done, ip: (c.s[1] * 16 + c.ip - L).toString(16) };
}
// ---------------- 移植版 ----------------
const font = U.Font.fromRaw(f["1.PAT"], f["2.PAT"], S.rom);
{ const cm = JSON.parse(fs.readFileSync(S.W + "/uw2_remake/web/assets/font/charmap.json", "utf8")); font.u2c = new Map(); for (const [code, , , u] of cm.table) font.u2c.set(u, code); }
const A = S.W + "/uw2_remake/web/assets/";
const rdj = n => JSON.parse(fs.readFileSync(A + n, "utf8")), rdb = n => new Uint8Array(fs.readFileSync(A + n));
const menuText = rdj("text/menu.json"), palJson = rdj("data/palettes.json"), ngData = rdj("data/newgame.json"), nodes = rdb("data/mapnodes.bin");
const portAssets = { za: rdb("data/za_dat.bin"), chip: rdb("gfx/portchip.bin"), map: rdb("gfx/portmap.bin"), chr: rdb("gfx/char.bin"), compass: rdb("gfx/compass.bin"),
  data: rdj("data/port.json"), wind: rdb("data/windcur.bin"), chipNo: rdj("data/portchip.json").chipNo, transit: rdb("gfx/transit.bin"), colony: rdj("text/colony.json"), itemMes: rdj("text/item_mes.json"), gamble: rdb("gfx/gamble.bin") };
const msg = f["MESSAGE.DAT"], initState = new Uint8Array(fs.readFileSync(S.W + "/uw2_remake/tools/work/newgame.bin"));
async function runJS(rng0) {
  const scr = new U.Screen(); let polls = 0;
  const sys = new U.Sys({ virtual: true, poll: async () => { if (++polls > 8e6) throw new Error("poll limit"); } });
  sys.mouse.x = 320; sys.mouse.y = 240;
  const state = new U.GameState(initState);
  const ctx = { scr, sys, state, initState, font, ASSETS: "", options: { get animate() { return !!(state.options & 1); } } };
  // 劇本: S.NO_EVENTS 時原版的事件檢查被改成直接返回, 移植版也略過; 其餘情況兩邊都執行劇本 VM
  ctx.noEvents = !!S.NO_EVENTS;
  const lazy = dir => new Proxy({}, { get: (o, k) => (o[k] ??= rdj(`${dir}${k}.json`)) });
  ctx.scenarioData = { vm: rdj("scenario/vm.json"), snr: lazy("scenario/snr"), mes: lazy("text/snr") };
  ctx.palette = new U.Palette(scr, sys, U.paletteTables(palJson));
  ctx.bgm = { playSong() {}, fadeOut() {}, resume() {} };
  const con = new U.TextConsole(scr, font, { wait: n => sys.waitSpeed(n) });
  const win = new U.WindowSystem(scr, con, S.D1[14], { wait: n => sys.waitTicks(n), options: ctx.options, sys });
  const graph = new U.Graph(scr); graph.files = { "GRAPH.DAT": new U.GraphDat(f["GRAPH.DAT"]), "GRAPH2.DAT": new U.GraphDat(f["GRAPH2.DAT"]) }; graph.g = graph.files["GRAPH.DAT"];
  const menu = new U.MenuSystem({ sys, scr, con, win, gfx: S.D1[14], graph });
  const message = (n, ...a) => { const off = (msg[n * 2] << 8) | msg[n * 2 + 1]; U.cprintf(msg.subarray(off, off + 256), a, ch => con.putc(ch)); };
  const printf = (fmt, ...a) => U.cprintf(typeof fmt === "string" ? font.encode(fmt + "\0") : fmt, a, ch => con.putc(ch));
  const menuItems = n => menuText[n].replace(/^(?:\{[0-9A-F]{2}\}|[^{]){2}/, "").split("{00}").slice(0, -1).map(s => font.encode(s + "{00}"));
  Object.assign(ctx, { con, win, graph, menu, message, printf, menuItems, gfx: S.D1[14], kao: new U.Kao(f["KAO.LZW"]), newgameData: ngData, mapNodes: nodes, portAssets });
  ctx.saveFile = new U.SaveFile(new Uint8Array(f["KOUKAI2.DAT"])); ctx.saveFile.flush = () => {};
  const sc = S.makeScript(KEYS.concat([{ mouse: {} }])), shots = [];
  let synced = false;
  const r0 = sys.rng.rand.bind(sys.rng);
  sys.rng.rand = () => { if (!synced && ctx.menu.count === 4 && ctx.menu.level === 0) { synced = true; sc.calls = 0; sys.rng.state = rng0; } return r0(); };
  sys.onIO = s => S.scriptStep(sc, s.keybuf, (a, b) => s.pushKey(a, b), k => {
    if (k && k.mouse) { if ('x' in k.mouse) s.mouse.x = k.mouse.x; if ('y' in k.mouse) s.mouse.y = k.mouse.y; if ('b' in k.mouse) s.mouse.buttons = k.mouse.b; }
    shots.push({ fb: scr.fb.slice(), dac: Array.from(scr.raw), st: state.b.slice(0, 0x8a18 - 0x0ca4), rt: ctx.rt ? [ctx.rt.year, ctx.rt.month, ctx.rt.day, ctx.rt.time] : [], rng: sys.rng.state });
    { const tp = S.TELEPORT?.[shots.length - 1]; if (tp) for (const [a, v] of tp) state.set8(a, v); }
    if (!sc.keys.length) throw new Error("STOP");
  });
  const enter0 = U.PortScene.prototype.enter;
  if (S.PORT_SETUP) U.PortScene.prototype.enter = function () { U.PortScene.prototype.enter = enter0; const P = S.PORT_SETUP, st = this.st;
    st.set8(0x0cae, P.port); st.set8(0x0caf, 0x82); st.set16(0x0cb4, P.vx); st.set16(0x0cb6, P.vy); st.set16(0x0cb8, P.hx); st.set16(0x0cba, P.hy);
    if (P.time !== undefined) { st.set8(0x0cad, P.time); this.c.rt.time = P.time; }
    for (const [a, v] of P.poke || []) st.set8(a, v);
    return enter0.call(this); };
  try { const r = await new U.Title(ctx).run(); if (r === 1) await new U.GameClock(ctx).run(); } catch (e) { if (e.message !== "STOP") throw e; } finally { U.PortScene.prototype.enter = enter0; }
  return { shots, ctx };
}
// 原版的亂數初值 (標題選單第一次 random 時) 由 newgame_tests 的方法取得: 先跑原版, 從第一張截圖前的狀態回推不可行, 改為直接讀
S.restoreTitle(); const c0 = S.titleEnv.cpu, d0 = c0.s[3] * 16;
const rngTitle = (c0.mem[d0 + 0xbd88] | (c0.mem[d0 + 0xbd89] << 8) | (c0.mem[d0 + 0xbd8a] << 16) | (c0.mem[d0 + 0xbd8b] << 24)) >>> 0;
const E = runEmu();
const J = await runJS(rngTitle);
S.lastRun = { E, J };                                             // 供測試後檢查 (例: 最終狀態 E.shots.at(-1).st)
const rep = [`keys=${KEYS.length} emuShots=${E.shots.length} jsShots=${J.shots.length} emuDone=${E.done} ip=${E.ip}`];
const n = Math.min(E.shots.length, J.shots.length);
let firstStateDiff = -1;
for (let i = 0; i < n; i++) {
  const e = E.shots[i], j = J.shots[i];
  e.fb[399 * 640 + 639] = j.fb[399 * 640 + 639];
  // 原版的軟體游標畫在 VRAM 裡 (24×24, 熱點左上): 遮掉目前與上一次的游標位置
  for (const m of [E.shots[i].mouse, i ? E.shots[i - 1].mouse : null]) if (m) for (let yy = m.y - 40; yy < m.y - 16; yy++) for (let xx = m.x; xx < m.x + 24; xx++)
    if (yy >= 0 && yy < 400 && xx < 640) e.fb[yy * 640 + xx] = j.fb[yy * 640 + xx];
  const d = S.cmp(e.fb, j.fb);
  let dd = 0; for (let k = 0; k < 16; k++) if (e.dac[k * 3] !== j.dac[k * 3 + 1] * 4 || e.dac[k * 3 + 1] !== j.dac[k * 3 + 2] * 4 || e.dac[k * 3 + 2] !== j.dac[k * 3] * 4) dd++;
  const sd = []; for (let k = 0; k < e.st.length; k++) if (e.st[k] !== j.st[k]) sd.push((0x0ca4 + k).toString(16) + ":" + e.st[k].toString(16) + "/" + j.st[k].toString(16));
  if (sd.length && firstStateDiff < 0) firstStateDiff = i;
  if (d.n) { fs.writeFileSync(S.W + `/uw2_remake/tools/work/pt_emu_${i}.idx`, Buffer.from(e.fb)); fs.writeFileSync(S.W + `/uw2_remake/tools/work/pt_js_${i}.idx`, Buffer.from(j.fb)); fs.writeFileSync(S.W + `/uw2_remake/tools/work/pt_dac_${i}.json`, JSON.stringify(e.dac)); }
  const ok = !d.n && !dd && !sd.length && e.rng === j.rng && (i < NEWGAME.length || e.rt.join() === j.rt.join());
  rep.push(`${ok ? "OK  " : "FAIL"} #${String(i).padStart(2)} ${i < KEYS.length ? JSON.stringify(KEYS[i]) : "end"} diff=${d.n}${d.first ? " @" + d.first : ""} dac=${dd} state=${sd.length}${sd.length ? " " + sd.slice(0, 8).join(" ") : ""} rng ${e.rng === j.rng ? "=" : e.rng.toString(16) + "/" + j.rng.toString(16)} rt ${e.rt}/${j.rt}`);
}
if (S.SAVE_PT) for (const i of S.SAVE_PT) if (E.shots[i]) { fs.writeFileSync(S.W + `/uw2_remake/tools/work/pts_${i}.idx`, Buffer.from(E.shots[i].fb)); fs.writeFileSync(S.W + `/uw2_remake/tools/work/pts_${i}.dac`, JSON.stringify(E.shots[i].dac)); }
if (S.WATCH !== undefined) rep.push('watch ' + S.WATCH.toString(16) + ': ' + JSON.stringify(S.watchLog));
if (S.PT_DEBUG) rep.push('emu mouse: ' + E.shots.slice(0, 6).map(x => x.mouse.x + ',' + x.mouse.y).join(' '));
// S.QUIET: 只印不一致的畫面與總計
if (S.QUIET) { const bad = rep.filter(l => !l.startsWith("OK")); console.log(rep[0].startsWith("keys") ? rep[0] : "", bad.slice(0, 12).join("\n"), `\n[summary] ${rep.filter(l => l.startsWith("OK")).length}/${rep.filter(l => /^(OK|FAIL)/.test(l)).length} OK`); }
else console.log(rep.join("\n"));
})();
