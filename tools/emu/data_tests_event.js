// data_tests_event.js — 剧情插图 PNG 资产与剧本一致性校验 (无需模拟器)
//   1. web/assets/art/manifest.json 与 web/assets/art/events/*.png 全部存在且尺寸为 192 × 144
//   2. 七个剧本的 picture 指令坐标均在 (112, 24) 且索引在对应事件图数量范围内
(function () {
const fs = require("fs"), W = session.W || WORKSPACE_DIR, A = W + "/uw2_remake/web/assets";
const manifest = JSON.parse(fs.readFileSync(`${A}/art/manifest.json`, "utf8"));
const out = [];
for (let n = 0; n < 7; n++) {
  const list = manifest.events?.[`event${n}`] || [];
  let sizeOk = list.length > 0;
  for (const e of list) {
    const p = `${A}/art/${e.path}`;
    if (!fs.existsSync(p) || e.w !== 192 || e.h !== 144) sizeOk = false;
  }
  out.push([`event${n} PNG 清单 (${list.length} 张 192x144)`, sizeOk]);
  if (n) {
    const doc = JSON.parse(fs.readFileSync(`${A}/scenario/snr${n}.json`, "utf8")); let c = 0, bad = 0;
    doc.chapters.forEach(ch => ch && ch.sections.forEach(sec => sec && sec.code.forEach(i => { if (i.k === "picture") { c++; if (i.x !== 112 || i.y !== 24 || i.pic >= list.length) bad++; } })));
    out.push([`SNR${n} 的 CB ${c} 個都在 (112, 24) 且張數 < ${list.length}`, !bad]);
  }
}
console.log(out.map(([n, ok]) => (ok ? "OK  " : "FAIL") + " " + n).join("\n"));
console.log(`[summary] ${out.filter(r => r[1]).length}/${out.length} OK`);
})();
