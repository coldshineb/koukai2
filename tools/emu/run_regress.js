// run_regress.js — 本地 Node 批量差分回归运行器
// 前提: 已运行 python tools/emu/prep_local.py && python tools/emu/make_runf.py
// 用法:
//   node tools/emu/run_regress.js --fast               (内核代表路线 ~18 条)
//   node tools/emu/run_regress.js --all                (全部路线)
//   node tools/emu/run_regress.js --filter port,market (按名称关键字过滤)
//   node tools/emu/run_regress.js --from 0 --to 20     (按索引区间)
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const HERE = __dirname, W = path.resolve(HERE, "..", "..", "..").replace(/\\/g, "/");

const args = process.argv.slice(2);
const has = k => args.includes(k);
const val = k => { const i = args.indexOf(k); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };

const FAST_NAMES = new Set([
  "data_tests", "data_tests_event", "menu_tests", "newgame_tests",
  "port (港口走路)", "tavern_route", "wharf_route", "market_route:lis", "palace_route:main",
  "cmd_info_route", "cmd_manage_route", "cmd_nav_route:func",
  "sea_depart_route", "storm_route:start", "land_route:repair",
  "battle_route:open", "duel_route:cpu", "fleet_route:month",
  "mouse_route:list", "title_settings_route",
]);

for (const f of ["uw2_remake/tools/work/rom8x8.bin", "uw2_remake/tools/work/newgame.bin", "uw2_remake/tools/work/ui_bundle.js", "uw2_remake/tools/work/runf.js", "uw2_remake/tools/work/sea2/MAIN.EXE"])
  if (!fs.existsSync(W + "/" + f)) { console.error("缺少 " + f + ", 請先執行 prep_local.py 與 make_runf.py"); process.exit(1); }

global.session = {}; global.WORKSPACE_DIR = W; global.require = require;
const S = global.session;
const load = f => vm.runInThisContext(fs.readFileSync(f, "utf8"), { filename: f });

const t0 = Date.now();
for (const f of ["x86emu.js", "dosenv.js", "harness.js", "harness_menu.js", "boot_title.js", "boot_port.js"]) load(path.join(HERE, f));
S.boot(W);
S.bootTitle();
console.log(`[boot] ${((Date.now() - t0) / 1000).toFixed(1)}s`);

load(W + "/uw2_remake/tools/work/ui_bundle.js");
load(W + "/uw2_remake/tools/work/runf.js");

(async () => {
  await S.RUNF["regress_all.js"]();
  const list = S.REGRESS_LIST;
  const indices = [];
  if (has("--all")) {
    for (let i = 0; i < list.length; i++) indices.push(i);
  } else if (val("--filter")) {
    const kws = val("--filter").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    for (let i = 0; i < list.length; i++)
      if (kws.some(k => list[i].name.toLowerCase().includes(k))) indices.push(i);
  } else if (val("--from") !== null || val("--to") !== null) {
    const a = Number(val("--from") ?? 0), b = Number(val("--to") ?? list.length);
    for (let i = Math.max(0, a); i < Math.min(list.length, b); i++) indices.push(i);
  } else {
    // 默认 --fast
    for (let i = 0; i < list.length; i++) if (FAST_NAMES.has(list[i].name)) indices.push(i);
  }

  console.log(`[run_regress] selected ${indices.length}/${list.length} routes`);
  let failed = 0;
  for (const idx of indices) {
    const res = await S.regress({ from: idx, to: idx + 1 });
    const r = res[res.length - 1];
    if (r.err || r.bad.length > 0 || (r.summary && /FAIL/i.test(r.summary))) failed++;
  }
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[run_regress] finished ${indices.length} routes in ${sec}s | failed=${failed}`);
  if (failed > 0) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
