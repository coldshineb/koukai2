// run_local.js — 在本機 Node 執行差分測試 (取代沙盒的 session 環境)
// 先執行: python tools/emu/prep_local.py
// 用法: node tools/emu/run_local.js <測試.js> ["前置 JS, 例如 S.NO_EVENTS=1"]
//       node tools/emu/run_local.js data_tests.js   (不需要模擬器的測試會自動略過開機)
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const HERE = __dirname, W = path.resolve(HERE, "..", "..", "..").replace(/\\/g, "/");
const test = process.argv[2], pre = process.argv[3] || "";
if (!test) { console.log("usage: node run_local.js <test.js> [pre-js]"); process.exit(1); }
for (const f of ["uw2_remake/tools/work/rom8x8.bin", "uw2_remake/tools/work/newgame.bin", "uw2_remake/tools/work/ui_bundle.js", "uw2_remake/tools/work/sea2/MAIN.EXE"])
  if (!fs.existsSync(W + "/" + f)) { console.error("缺少 " + f + ", 先執行 python tools/emu/prep_local.py"); process.exit(1); }
global.session = {}; global.WORKSPACE_DIR = W; global.require = require;
const S = global.session;
const load = f => vm.runInThisContext(fs.readFileSync(f, "utf8"), { filename: f });
const needsEmu = !/^data_tests/.test(path.basename(test));
const t0 = Date.now();
if (needsEmu) {
  for (const f of ["x86emu.js", "dosenv.js", "harness.js", "harness_menu.js", "boot_title.js", "boot_port.js"]) load(path.join(HERE, f));
  S.boot(W);
  S.bootTitle();
  console.log(`[boot] ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
load(W + "/uw2_remake/tools/work/ui_bundle.js");
if (pre) vm.runInThisContext("(function(S){" + pre + "})(session)");
const r = load(path.isAbsolute(test) ? test : path.join(HERE, test));
Promise.resolve(r).then(() => console.log(`[done] ${((Date.now() - t0) / 1000).toFixed(1)}s`), e => { console.error(e); process.exit(1); });
