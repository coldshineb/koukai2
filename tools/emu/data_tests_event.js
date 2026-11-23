// data_tests_event.js — 劇情插圖 EVENT0..6.DAT 的解碼測試 (不需要模擬器; 先載入 ui_bundle.js)  docs/RE_NOTES.md 第 31 節
//   1. 每張以 16 色版本 (seg0:5b5d) 在 (112, 24) 解碼, 解碼結束位置必須剛好等於下一張的偏移 (最後一張 = 檔案長度), 寬高 192 × 144
//   2. web/assets/gfx/event 的副本與原版 tools/work/sea2 的檔案逐位元組相同
//   3. 七個劇本的 CB 都在 (112, 24), 張數不超過該主角的 EVENT 檔
//   4. 總覽: 全部插圖排成 6 欄 × 7 列 (每列一個檔), 原始索引色寫到 tools/work/event_overview.bin (w, h u16le + 像素), 由 Python 轉 PNG
(function () {
const fs = require("fs"), U = session.UI, W = session.W || WORKSPACE_DIR, A = W + "/uw2_remake/web/assets";
const out = [], ow = 6 * 200, oh = 7 * 152, ov = new Uint8Array(ow * oh);
for (let n = 0; n < 7; n++) {
  const dat = new Uint8Array(fs.readFileSync(`${A}/gfx/event/EVENT${n}.DAT`)), orig = new Uint8Array(fs.readFileSync(`${W}/uw2_remake/tools/work/sea2/EVENT${n}.DAT`));
  out.push([`EVENT${n}.DAT 與原版相同`, dat.length === orig.length && dat.every((v, i) => v === orig[i])]);
  const offs = U.graphOffsets(dat);
  offs.forEach((o, i) => {
    const fb = new Uint8Array(640 * 400), end = U.decodeGraph(fb, dat, 112, 24, true, o), next = i + 1 < offs.length ? offs[i + 1] : dat.length;
    const { w, h } = U.graphSize(dat, o);
    out.push([`EVENT${n} #${i} ${w}x${h} 結束 ${end} / ${next}`, end === next && w === 192 && h === 144]);
    for (let y = 0; y < 144; y++) for (let x = 0; x < 192; x++) ov[(n * 152 + 4 + y) * ow + i * 200 + 4 + x] = fb[(24 + y) * 640 + 112 + x];
  });
  if (n) {
    const doc = JSON.parse(fs.readFileSync(`${A}/scenario/snr${n}.json`, "utf8")); let c = 0, bad = 0;
    doc.chapters.forEach(ch => ch && ch.sections.forEach(sec => sec && sec.code.forEach(i => { if (i.k === "picture") { c++; if (i.x !== 112 || i.y !== 24 || i.pic >= offs.length) bad++; } })));
    out.push([`SNR${n} 的 CB ${c} 個都在 (112, 24) 且張數 < ${offs.length}`, !bad]);
  }
}
const hdr = new Uint8Array(4); hdr[0] = ow & 255; hdr[1] = ow >> 8; hdr[2] = oh & 255; hdr[3] = oh >> 8;
fs.writeFileSync(W + "/uw2_remake/tools/work/event_overview.bin", Buffer.concat([Buffer.from(hdr), Buffer.from(ov)]));
console.log(out.map(([n, ok]) => (ok ? "OK  " : "FAIL") + " " + n).join("\n"));
console.log(`[summary] ${out.filter(r => r[1]).length}/${out.length} OK`);
})();
