// worldmap_tests.js — 海上地图区域解码差分测试: 原版 1fd9:2fd2 (= 线性 22d62, 含 22b19 格解码、22028 海岸接边、港口/发现物) vs web/src/gfx/worldmap.js
// 前提: 先跑过一条出海路线 (例: sea_depart_route.js + port_tests.js), 使 session.titleEnv 的原版停在海上 ([03f6] 等缓冲已配置), 并已加载 ui_bundle.js
// 做法: 随机把 130 个港口 +15 bit4 / 100 个发现物 +6 bit6 设为一半已发现; 对 3 项 × 7 列 × 5 栏 + 60 个随机区域, 原版换项 (849a) 后调用 22d62,
//       移植版以同一份 DS 内存 (状态) 解码, 96 × 96 缓冲逐 byte 比对; 测完还原原版内存
(function () {
const fs = require("fs"), S = session, A = S.W + "/uw2_remake/web/assets/";
const sea = JSON.parse(fs.readFileSync(A + "data/sea.json", "utf8")), codes = new Uint8Array(fs.readFileSync(A + "gfx/worldmap.bin"));
const env = S.titleEnv, c = env.cpu, d = c.s[3] * 16, DSEG = c.s[3];
const st = { u8: a => c.mem[d + (a & 0xffff)], u16: a => c.mem[d + (a & 0xffff)] | (c.mem[d + ((a + 1) & 0xffff)] << 8) };
const wm = new S.UI.WorldMap(codes, sea);
const saveEnv = S.env, saveD = S.DSEG; S.env = env; S.DSEG = DSEG;
const snap = c.mem.slice();
let seed = 12345; const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
for (let p = 0; p < 130; p++) { const a = d + 0x5f54 + p * 0x16 + 0x15; if (rnd(2)) c.mem[a] |= 0x10; else c.mem[a] &= ~0x10; }
for (let p = 0; p < 100; p++) { const a = d + 0x7f8c + p * 7 + 6; if (rnd(2)) c.mem[a] |= 0x40; else c.mem[a] &= ~0x40; }
const bufSeg = c.mem[d + 0x3f6] | (c.mem[d + 0x3f7] << 8);
const list = []; for (let k = 0; k < 3; k++) for (const r of [0, 1, 13, 20, 30, 41, 42]) for (const cc of [0, 5, 13, 20, 27]) list.push([k, r * 30 + cc]);
for (let i = 0; i < 60; i++) list.push([rnd(3), rnd(43) * 30 + rnd(28)]);
let bad = 0, tested = 0; const t0 = Date.now();
for (const [item, idx] of list) {
  if (c.mem[d + 0x6ca] !== item) { c.mem[d + 0x6ca] = item; S.call(0x849a); }          // 849a: 读 WORLDMAP 第 [06ca] 项
  const pre = c.mem.slice(bufSeg * 16, bufSeg * 16 + 0x2400);
  S.call(0x22d62, { ax: idx });
  const emu = c.mem.slice(bufSeg * 16, bufSeg * 16 + 0x2400), buf = pre.slice();
  wm.decode(st, item, idx, buf);
  let n = 0; for (let p = 0; p < 0x2400; p++) if (buf[p] !== emu[p]) n++;
  tested++; if (n) { bad++; if (bad < 5) console.log("item", item, "idx", idx, "diff", n); }
  if (Date.now() - t0 > 250000) break;
}
console.log(`[worldmap] ${tested - bad}/${tested} 區域一致 (${Date.now() - t0} ms)`);
c.mem.set(snap); S.env = saveEnv; S.DSEG = saveD;
})();
