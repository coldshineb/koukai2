import { Screen } from "../src/core/screen.js";
import { Font } from "../src/core/font.js";
import { Sys } from "../src/core/sys.js";
import { bindInput } from "../src/core/input.js";
import { loadJSON } from "../src/core/assets.js";
import { createUI } from "../src/ui/index.js";

const A = "../assets", $ = id => document.getElementById(id);
const canvas = $("c"), scr = new Screen(canvas), sys = new Sys();
bindInput(canvas, sys);
const ctx = { scr, sys, ASSETS: A, font: await new Font().load(A), palettes: (await loadJSON(A + "/data/palettes.json")).palettes, options: { animate: true } };
Object.assign(ctx, await createUI(ctx));
const menuText = await loadJSON(A + "/text/menu.json");
const log = s => { $("log").textContent = s + "\n" + $("log").textContent; };
scr.setPaletteRaw(ctx.palettes.find(p => p.name === "day").raw);
for (let y = 0; y < 400; y++) for (let x = 0; x < 640; x++) scr.fb[y * 640 + x] = ((x >> 4) + (y >> 4)) & 1 ? 1 : 9;
sys.mouseShow();
(function frame() {
  const m = sys.mouse; scr.cursor = { visible: m.visible > 0, x: m.x, y: m.y, gfx: ctx.gfx, shape: m.shape };
  scr.present(); requestAnimationFrame(frame);
})();
const items = n => menuText[n].replace(/^(?:\{[0-9A-F]{2}\}|[^{]){2}/, "").split("{00}").filter(Boolean).map(s => ctx.font.encode(s));
let busy = false;
const run = fn => async () => { if (busy) return; busy = true; ctx.options.animate = $("anim").checked; canvas.focus(); try { await fn(); } finally { busy = false; } };
$("b_list").onclick = run(async () => { const r = await ctx.menu.listMenu(4, 40, items(+$("mn").value), $("cancel").checked ? 1 : 0); log("listMenu -> " + r); });
$("b_popup").onclick = run(async () => { log("點畫面上任一處後按 Enter / 或直接操作"); const r = await ctx.menu.popupMenu(items(+$("mn").value), $("cancel").checked ? 1 : 0); log("popupMenu -> " + r); });
$("b_yesno").onclick = run(async () => { const r = await ctx.menu.yesNo(); log("yesNo -> " + r); });
$("b_msg").onclick = run(async () => {
  await ctx.win.open(4, 260, 60, 96, 0);
  ctx.message(+$("msgn").value, ctx.font.encode("阿方索\0"), ctx.font.encode("科斯塔\0"), 1500);
  await ctx.menu.waitPrompt();
  await ctx.win.close();
  log("message done");
});
