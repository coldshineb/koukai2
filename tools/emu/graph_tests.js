// graph_tests.js — GRAPH.DAT 解码器差分测试: 原版 (模拟器 seg0:5b5d / 5a91) vs JS decodeGraph
(async function () {
const fs = require("fs"), S = session, U = S.UI, c = S.env.cpu;
const dat = S.files["GRAPH.DAT"];
const G = new U.GraphDat(dat);
const rep = []; let fails = 0;
const bgFill = () => { const fb = new Uint8Array(640 * 400); for (let y = 0; y < 400; y++) for (let x = 0; x < 640; x++) fb[y * 640 + x] = S.bgcol(x, y); return fb; };
S.graphTruth = S.graphTruth || {};
function test(name, emuLin, n, x, y, jsFn) {
  S.loadState(S.base); S.setupMenuEnv(); S.emuFillBG();
  let err = null;
  try { S.call(emuLin, { ax: x, dx: y, bx: n, maxIns: 5e8 }); } catch (e) { err = e.message; }
  const efb = S.emuFB().slice();
  const jfb = bgFill(); jsFn(jfb);
  const d = S.cmp(efb, jfb);
  if (d.n) fails++;
  rep.push(`${d.n === 0 && !err ? "OK  " : "FAIL"} ${name.padEnd(22)} diff=${d.n}${d.first ? " @" + d.first : ""}${err ? " ERR " + err : ""}`);
  return efb;
}
// 16 色版本: 全部 65 张 (位置 0,0; 能放下时再测奇数单位起点 x=4, y=3)
for (let n = 0; n < G.offsets.length; n++) {
  const { w, h } = U.graphSize(dat, G.offsets[n]);
  const efb = test(`draw(${n}) ${w}x${h}`, 0x5b5d, n, 0, 0, fb => G.draw(fb, n, 0, 0));
  S.graphTruth[n] = { w, h, px: efb.slice(0, 0) };
  if (w + 4 <= 640 && h + 3 <= 400) test(`draw(${n}) @4,3`, 0x5b5d, n, 4, 3, fb => G.draw(fb, n, 4, 3));
}
// 8 色版本
for (const n of [0, 2, 3, 4, 5, 0x3e]) test(`draw8(${n})`, 0x5a91, n, 0, 0, fb => G.draw8(fb, n, 0, 0));
test("draw8(0) @300,200", 0x5a91, 0, 300, 200, fb => G.draw8(fb, 0, 300, 200));
// 越界: 什么都不画
test("draw(2) @8,0 越界", 0x5b5d, 2, 8, 0, fb => G.draw(fb, 2, 8, 0));
console.log(`fails=${fails} / ${rep.length}`);
console.log(rep.filter(r => r.startsWith("FAIL")).concat(rep.slice(0, 6)).join("\n"));
})();
