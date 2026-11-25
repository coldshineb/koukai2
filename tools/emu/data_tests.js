// data_tests.js — 游戏数据 JSON 往返测试 (先加载 ui_bundle.js; 需要 tools/work/newgame.bin 与 tools/work/sea2/KOUKAI2.DAT)
(function () {
const fs = require("fs"), U = session.UI, W = WORKSPACE_DIR, A = W + "/uw2_remake/web/assets";
const schema = JSON.parse(fs.readFileSync(A + "/data/schema.json", "utf8"));
const codec = new U.TextCodec(JSON.parse(fs.readFileSync(A + "/font/charmap.json", "utf8")));
const world = JSON.parse(fs.readFileSync(A + "/data/world.json", "utf8"));
const newgame = new Uint8Array(fs.readFileSync(W + "/uw2_remake/tools/work/newgame.bin"));
const k2 = new Uint8Array(fs.readFileSync(W + "/uw2_remake/tools/work/sea2/KOUKAI2.DAT"));
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const out = [];
out.push(["world.json → bytes == 新遊戲初值", eq(U.encodeState(world, schema, codec), newgame)]);
const jd = U.decodeState(newgame, schema, codec); const w2 = { ...world }; delete w2.source;
out.push(["JS decode == Python export", JSON.stringify(jd) === JSON.stringify(w2)]);
for (let i = 0; i < 10; i++) { const b = k2.subarray(0x97 + i * 0x8074, 0x97 + (i + 1) * 0x8074);
  out.push([`KOUKAI2.DAT 第 ${i} 格往返`, eq(U.encodeState(JSON.parse(JSON.stringify(U.decodeState(b, schema, codec))), schema, codec), b)]); }
console.log(out.map(([n, ok]) => (ok ? "OK  " : "FAIL") + " " + n).join("\n"));
})();
