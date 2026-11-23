// port_tests.js — 港口 差分測試: 同一按鍵腳本從標題選單開始 (開始新航海 → 里斯本港 → 走路/進建築), 分別驅動原版與移植版
// 每次送鍵時比對畫面、調色盤、亂數與遊戲狀態 (DS:0CA4..8A18 + 時間)
// 先載入 x86emu/dosenv/harness/harness_menu/boot_title(session.bootTitle()) 與 tools/work/ui_bundle.js
(async function () {
const fs = require("fs"), S = session, U = S.UI, f = S.files, L = 0x110 * 16;
const K = { down: [0x50, 0], up: [0x48, 0], left: [0x4b, 0], right: [0x4d, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b], sp: [0x39, 0x20] };
const NEWGAME = S.NEWGAME || [K.down, K.enter, K.enter, K.enter, K.left, K.left, K.enter, K.left, K.left, K.enter, K.enter];   // S.NEWGAME: 改選其他主角 (event_route.js 的 S.EVENT_HERO)
const KEYS = NEWGAME.concat(S.PORT_KEYS || [K.left, K.left, K.left, K.right, K.right, K.down, K.up, K.up, K.enter, K.left, K.down, K.down, K.right]);
const TAIL = 30;                    // 最後一鍵之後再等多少次輸入查詢才截最終狀態
// S.EXTRA_DS = [[起, 迄], ...]: 另外比對存檔區以外的 DS 範圍 (移植版為 ctx.battleDS 等 DS 鏡像, 例: 海戰工作區)
// S.DAC_N = n: 調色盤只比前 n 色 (例: 海戰的調色盤循環 16ee 由 IRQ0 驅動, 兩邊換格的時間點不同, 只比 0..7)
const grabEmu = c => { const d = c.s[3] * 16; return { x: (S.EXTRA_DS || []).map(([a, b]) => c.mem.slice(d + a, d + b)), st: c.mem.slice(d + 0x0ca4, d + 0x8a18), rt: Array.from(c.mem.slice(d + 0x532, d + 0x536)),
  rng: ((c.mem[d + 0xbd88] | (c.mem[d + 0xbd89] << 8) | (c.mem[d + 0xbd8a] << 16) | (c.mem[d + 0xbd8b] << 24)) >>> 0) }; };
// 遮掉游標區 (24×24, 熱點左上; 驅動座標 y − 40) 後的 32 位元雜湊
function fbHash(fb, ms) {
  const f = fb.slice();
  for (const m of ms) if (m) for (let yy = m.y - 40; yy < m.y - 16; yy++) for (let xx = m.x; xx < m.x + 24; xx++) if (yy >= 0 && yy < 400 && xx < 640) f[yy * 640 + xx] = 0;
  f[399 * 640 + 639] = 0;
  let h = 0x811c9dc5; for (let i = 0; i < f.length; i++) h = Math.imul(h ^ f[i], 0x01000193);
  return h >>> 0;
}
function runEmu() {
  S.restoreTitle();
  const env = S.titleEnv, c = env.cpu, shots = [];
  Object.assign(env.mouse, { x: 0x27f, y: 0x18f + 0x28, b: 0 });       // 標題時的滑鼠位置 (1752c), 上一次測試可能移動過
  const sc = S.makeScript(KEYS.concat([{ mouse: {} }]));            // 最後一個空動作 = 收尾截圖點
  let synced = false, done = false;
  const saveEnv = S.env, sH16 = S._H16, sH33 = S._H33; S.env = env; S._H16 = S._H33 = undefined;
  S.installEmuServices(sc, () => { let fb = S.emuFb480(); fb[399 * 640 + 639] = 0xff; const m = { x: env.mouse.x, y: env.mouse.y };
    // S.FB_HASH = n: 長路線省記憶體 — 每張只存遮掉游標 (本張與上一張的位置) 後的雜湊, 每 n 張與最後一張才存完整畫面
    let fh; if (S.FB_HASH) { fh = fbHash(fb, [m, ...Array.from({ length: S.CURSOR_LAG ?? 1 }, (_, k) => shots[shots.length - 1 - k]?.mouse)]); if (shots.length % S.FB_HASH && sc.keys.length && !(S.FB_KEEP && shots.length >= S.FB_KEEP[0] && shots.length <= S.FB_KEEP[1])) fb = null; }
    shots.push({ mouse: m, fb, fh, dac: Array.from(c.vga.dac.slice(0, 48)), ...grabEmu(c) });
    const tp = S.TELEPORT?.[shots.length - 1]; if (tp) for (const [a, v] of tp) c.mem[S.DSEG * 16 + a] = v;              // S.TELEPORT[畫面序號] = [[DS 位址, 值], ...]
    if (!sc.keys.length) { done = true; c.halted = true; } });
  S.env = saveEnv; S._H16 = sH16; S._H33 = sH33;
  // S.FLEET_AI: 艦隊 AI (1ac19, game/fleetai.js) 兩邊都執行; 否則原版的 1ac19 改成直接返回, 移植版同樣略過 (ctx.noFleetAI)
  if (!S.FLEET_AI) c.mem[L + 0x1ac19] = 0xcb;
  // 劇本事件檢查 (2e09:5481 / 2e09:55c2) 尚未移植: 測試建築時以 S.NO_EVENTS 讓原版一律回傳「沒有事件」
  if (S.NO_EVENTS) for (const o of [0x33511, 0x33652]) { c.mem[L + o] = 0x31; c.mem[L + o + 1] = 0xc0; c.mem[L + o + 2] = 0xcb; }                       // 艦隊 AI (1ac19) 尚未移植: 兩邊都略過, 以便單獨驗證港口與建築
  // 他艦隊 (艦隊 AI) 尚未移植: S.NO_FLEETS 時原版的 6aae (區域內他艦隊) 直接返回, 1afe8 不處理任何他艦隊 (1b048 jne → nop), 移植版同樣略過
  if (S.NO_FLEETS) { c.mem[L + 0x6aae] = 0xcb; c.mem[L + 0x1b048] = 0x90; c.mem[L + 0x1b049] = 0x90; }
  let setupDone = !S.PORT_SETUP;
  // S.WATCH = DS 位址: 該位元組改變時記錄當時的指令位置 (之前已執行的那條指令) 與按鍵序號, 結果在 S.watchLog
  const W8 = S.WATCH, WF = S.WATCH_FROM || 0, WD = c.s[3] * 16, wlog = S.watchLog = []; let wv = -1, wip = 0;   // WD: 遊戲的 DS (標題時)
  // S.PROBES = [{ name, ip }]: 原版執行到 ip (映像內的線性位址) 時另取一份快照 (狀態 / DS 工作區 / 亂數 / 畫面), 與移植版 ctx.probe(name) 的快照依序比對
  //   (兩次等待輸入之間的處理, 例: 海戰一次砲擊的亂數、損傷與動畫結束後的畫面)
  const PR = S.PROBES || [], prE = S.probeE = [];
  c.onTick = cpu => {
    const lin = cpu.s[1] * 16 + cpu.ip;
    if (PR.length) for (const p of PR) if (lin === L + p.ip && prE.length < 200) { const g = grabEmu(cpu); prE.push({ name: p.name, ...g, fb: S.emuFb480().slice(), mouse: { x: env.mouse.x, y: env.mouse.y }, shot: shots.length }); }
    if (W8 !== undefined) { const v = cpu.mem[WD + W8]; if (wv >= 0 && v !== wv && shots.length >= WF && wlog.length < 50) wlog.push({ ip: (wip - L).toString(16), from: wv, to: v, shot: shots.length }); wv = v; wip = lin; }
    if (!synced && lin === L + 0x4d92) { synced = true; sc.calls = 0; }
    if (!setupDone && lin === L + 0x8c53) { setupDone = true; const d = cpu.s[3] * 16, P = S.PORT_SETUP;
      const w16 = (o, v) => { cpu.mem[d + o] = v & 255; cpu.mem[d + o + 1] = (v >> 8) & 255; };
      // [0caf] = 0x82 (存檔後的值): 重新讀入入口表但保留位置
      cpu.mem[d + 0x0cae] = P.port; cpu.mem[d + 0x0caf] = 0x82; w16(0x0cb4, P.vx); w16(0x0cb6, P.vy); w16(0x0cb8, P.hx); w16(0x0cba, P.hy);
      if (P.time !== undefined) { cpu.mem[d + 0x0cad] = P.time; cpu.mem[d + 0x0535] = P.time; }
      for (const [a, v] of P.poke || []) cpu.mem[d + a] = v;
      P.emuHook?.(cpu.mem, d); }                                     // 只寫原版的額外設定 (例: [0c8e] 緩衝), 與 jsHook 成對
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
  data: rdj("data/port.json"), wind: rdb("data/windcur.bin"), chipNo: rdj("data/portchip.json").chipNo, transit: rdb("gfx/transit.bin"), colony: rdj("text/colony.json"), itemMes: rdj("text/item_mes.json"), gamble: rdb("gfx/gamble.bin"), commands: rdj("data/commands.json") };
portAssets.data.bld2 = rdj("data/buildings2.json");                 // 王宮/事務所/住宅/銀行/道具店 (port.js loadPortAssets 同一項)
Object.assign(portAssets, { worldmap: rdb("gfx/worldmap.bin"), seachip: rdb("gfx/seachip.bin"), seacompass: rdb("gfx/seacompass.bin"), sea: rdj("data/sea.json"), fleet: rdj("data/fleet.json") });   // 海上 (loadPortAssets 同一組)
Object.assign(portAssets, { hdat: rdb("gfx/hdat.bin"), battle: rdj("data/battle.json") });   // 海戰 (loadPortAssets 同一組)
portAssets.duel = { J: rdj("data/duel.json"), data1: rdb("gfx/duel/DATA1.LZW"), iae: rdb("gfx/duel/IAE1.LZW"), iap: [1, 2, 3, 4, 5, 6].map(i => rdb(`gfx/duel/IAP${i}.LZW`)) };   // 一騎打 (loadPortAssets 同一組)
const msg = f["MESSAGE.DAT"], initState = new Uint8Array(fs.readFileSync(S.W + "/uw2_remake/tools/work/newgame.bin"));
async function runJS(rng0) {
  const scr = new U.Screen(); let polls = 0;
  const sys = new U.Sys({ virtual: true, poll: async () => { if (++polls > 8e6) throw new Error("poll limit"); } });
  sys.mouse.x = 320; sys.mouse.y = 240;
  const state = new U.GameState(initState);
  const ctx = { scr, sys, state, initState, font, ASSETS: "", options: { get animate() { return !!(state.options & 1); } } };
  // 劇本: S.NO_EVENTS 時原版的事件檢查被改成直接返回, 移植版也略過; 其餘情況兩邊都執行劇本 VM
  ctx.noEvents = !!S.NO_EVENTS; ctx.noFleets = !!S.NO_FLEETS; ctx.noFleetAI = !S.FLEET_AI;
  const lazy = dir => new Proxy({}, { get: (o, k) => (o[k] ??= rdj(`${dir}${k}.json`)) });
  ctx.scenarioData = { vm: rdj("scenario/vm.json"), snr: lazy("scenario/snr"), mes: lazy("text/snr") };
  ctx.palette = new U.Palette(scr, sys, U.paletteTables(palJson));
  ctx.bgm = { playSong() {}, fadeOut() {}, resume() {} };
  const con = new U.TextConsole(scr, font, { wait: n => sys.waitSpeed(n) });
  const win = new U.WindowSystem(scr, con, S.D1[14], { wait: n => sys.waitTicks(n), options: ctx.options, sys });
  const graph = new U.Graph(scr); graph.files = { "GRAPH.DAT": new U.GraphDat(f["GRAPH.DAT"]), "GRAPH2.DAT": new U.GraphDat(f["GRAPH2.DAT"]) }; graph.g = graph.files["GRAPH.DAT"];
  for (let i = 0; i < 7; i++) graph.files[`EVENT${i}.DAT`] = new U.GraphDat(rdb(`gfx/event/EVENT${i}.DAT`));   // 劇情插圖 (graph.ensure 不再載入)
  const menu = new U.MenuSystem({ sys, scr, con, win, gfx: S.D1[14], graph });
  const message = (n, ...a) => { const off = (msg[n * 2] << 8) | msg[n * 2 + 1]; U.cprintf(msg.subarray(off, off + 256), a, ch => con.putc(ch)); };
  const printf = (fmt, ...a) => U.cprintf(typeof fmt === "string" ? font.encode(fmt + "\0") : fmt, a, ch => con.putc(ch));
  const menuItems = n => menuText[n].replace(/^(?:\{[0-9A-F]{2}\}|[^{]){2}/, "").split("{00}").slice(0, -1).map(s => font.encode(s + "{00}"));
  Object.assign(ctx, { con, win, graph, menu, message, printf, menuItems, gfx: S.D1[14], kao: new U.Kao(f["KAO.LZW"]), newgameData: ngData, mapNodes: nodes, portAssets });
  const prJ = S.probeJ = [];
  if (S.PROBES?.length) ctx.probe = name => { if (S.PROBES.some(p => p.name === name) && prJ.length < 200) prJ.push({ name, x: (S.EXTRA_DS || []).map(([a, b]) => (ctx.battleDS || new Uint8Array(0x10000)).slice(a, b)), st: state.b.slice(0, 0x8a18 - 0x0ca4), rng: sys.rng.state, fb: scr.fb.slice(), shot: shots.length }); };
  ctx.saveFile = new U.SaveFile(new Uint8Array(save0)); ctx.saveFile.flush = () => {};   // 原版執行時會寫入 f["KOUKAI2.DAT"] (模擬磁碟), 移植版用執行前的副本
  const sc = S.makeScript(KEYS.concat([{ mouse: {} }])), shots = [];
  let synced = false;
  const r0 = sys.rng.rand.bind(sys.rng);
  sys.rng.rand = () => { if (!synced && ctx.menu.count === 4 && ctx.menu.level === 0) { synced = true; sc.calls = 0; sys.rng.state = rng0; } return r0(); };
  sys.onIO = s => S.scriptStep(sc, s.keybuf, (a, b) => s.pushKey(a, b), k => {
    if (k && k.mouse) { if ('x' in k.mouse) s.mouse.x = k.mouse.x; if ('y' in k.mouse) s.mouse.y = k.mouse.y; if ('b' in k.mouse) s.mouse.buttons = k.mouse.b; }
    let fb = scr.fb.slice(), fh;
    if (S.FB_HASH) { const R = S.emuShotsRef, n = shots.length, e = R?.[n]; fh = fbHash(fb, Array.from({ length: (S.CURSOR_LAG ?? 1) + 1 }, (_, k) => R?.[n - k]?.mouse)); if (!e?.fb) fb = null; }
    shots.push({ fb, fh, x: (S.EXTRA_DS || []).map(([a, b]) => (ctx.battleDS || new Uint8Array(0x10000)).slice(a, b)), dac: Array.from(scr.raw), st: state.b.slice(0, 0x8a18 - 0x0ca4), rt: ctx.rt ? [ctx.rt.year, ctx.rt.month, ctx.rt.day, ctx.rt.time] : [], rng: sys.rng.state });
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
  try { const r = await new U.Title(ctx).run(); if (r === 1) await new U.GameClock(ctx).run(); } catch (e) { if (e.message !== "STOP") throw e; } finally { U.PortScene.prototype.enter = enter0; }
  return { shots, ctx };
}
// 原版的亂數初值 (標題選單第一次 random 時) 由 newgame_tests 的方法取得: 先跑原版, 從第一張截圖前的狀態回推不可行, 改為直接讀
S.restoreTitle(); const c0 = S.titleEnv.cpu, d0 = c0.s[3] * 16;
const rngTitle = (c0.mem[d0 + 0xbd88] | (c0.mem[d0 + 0xbd89] << 8) | (c0.mem[d0 + 0xbd8a] << 16) | (c0.mem[d0 + 0xbd8b] << 24)) >>> 0;
const save0 = new Uint8Array(fs.readFileSync(S.W + "/uw2_remake/tools/work/sea2/KOUKAI2.DAT"));   // 原始存檔 (模擬磁碟上的 f["KOUKAI2.DAT"] 會被存檔路線改寫)
if (f["KOUKAI2.DAT"].length === save0.length) f["KOUKAI2.DAT"].set(save0);   // 兩邊都從原始存檔開始 (上一次測試的存檔路線改寫過模擬磁碟)
const E = runEmu();
S.emuShotsRef = E.shots;
const J = await runJS(rngTitle);
S.emuShotsRef = null;
S.lastRun = { E, J };                                             // 供測試後檢查 (例: 最終狀態 E.shots.at(-1).st)
const rep = [`keys=${KEYS.length} emuShots=${E.shots.length} jsShots=${J.shots.length} emuDone=${E.done} ip=${E.ip}`];
if (S.PROBES?.length) {                                            // 快照比對 (S.PROBES)
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
  if (!e.fb || !j.fb) {                                              // S.FB_HASH: 只比雜湊
    let dd = 0; for (let k = 0; k < (S.DAC_N ?? 16); k++) if (e.dac[k * 3] !== j.dac[k * 3 + 1] * 4 || e.dac[k * 3 + 1] !== j.dac[k * 3 + 2] * 4 || e.dac[k * 3 + 2] !== j.dac[k * 3] * 4) dd++;
    const sd = []; for (let k = 0; k < e.st.length; k++) if (e.st[k] !== j.st[k]) sd.push((0x0ca4 + k).toString(16) + ":" + e.st[k].toString(16) + "/" + j.st[k].toString(16));
    (S.EXTRA_DS || []).forEach(([a], r) => { for (let k = 0; k < e.x[r].length; k++) if (e.x[r][k] !== j.x[r][k]) sd.push((a + k).toString(16) + ":" + e.x[r][k].toString(16) + "/" + j.x[r][k].toString(16)); });
    if (sd.length && firstStateDiff < 0) firstStateDiff = i;
    const ok = e.fh === j.fh && !dd && !sd.length && e.rng === j.rng && (i < NEWGAME.length || e.rt.join() === j.rt.join());
    rep.push(`${ok ? "OK  " : "FAIL"} #${String(i).padStart(2)} ${i < KEYS.length ? JSON.stringify(KEYS[i]) : "end"} fb ${e.fh === j.fh ? "=" : "≠"} dac=${dd} state=${sd.length}${sd.length ? " " + sd.slice(0, 8).join(" ") : ""} rng ${e.rng === j.rng ? "=" : e.rng.toString(16) + "/" + j.rng.toString(16)} rt ${e.rt}/${j.rt}`);
    continue;
  }
  e.fb[399 * 640 + 639] = j.fb[399 * 640 + 639];
  // 原版的軟體游標畫在 VRAM 裡 (24×24, 熱點左上): 遮掉目前與上一次的游標位置
  // S.CURSOR_LAG = n: 原版軟體游標有時晚幾張才在舊位置重畫/還原 (滑鼠在測試中是瞬間移動的), 改為遮掉最近 n+1 張的所有位置
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
if (S.SAVE_PT) for (const i of S.SAVE_PT) if (E.shots[i]) { fs.writeFileSync(S.W + `/uw2_remake/tools/work/pts_${i}.idx`, Buffer.from(E.shots[i].fb)); fs.writeFileSync(S.W + `/uw2_remake/tools/work/pts_${i}.dac`, JSON.stringify(E.shots[i].dac)); }
if (S.WATCH !== undefined) rep.push('watch ' + S.WATCH.toString(16) + ': ' + JSON.stringify(S.watchLog));
if (S.PT_DEBUG) rep.push('emu mouse: ' + E.shots.slice(0, 6).map(x => x.mouse.x + ',' + x.mouse.y).join(' '));
// S.QUIET: 只印不一致的畫面與總計
if (S.QUIET) { const bad = rep.filter(l => !l.startsWith("OK") && !l.startsWith("POK")); console.log(rep[0].startsWith("keys") ? rep[0] : "", bad.slice(0, 12).join("\n"), `\n[summary] ${rep.filter(l => l.startsWith("OK")).length}/${rep.filter(l => /^(OK|FAIL)/.test(l)).length} OK` + (S.PROBES?.length ? `  [probes] ${rep.filter(l => l.startsWith("POK")).length}/${rep.filter(l => /^(POK|PFAIL)/.test(l)).length} OK` : "")); }
else console.log(rep.join("\n"));
})();
