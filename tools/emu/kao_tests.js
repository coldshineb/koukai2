// kao_tests.js — 头像差分测试: 原版 (模拟器) vs gfx/kao.js
(async function () {
const S = session, U = S.UI, c = S.env.cpu, D = S.DSEG;
const kao = new U.Kao(S.files["KAO.LZW"]);
const rep = []; let fails = 0, total = 0;
const bgFill = () => { const scr = new U.Screen(); for (let y = 0; y < 400; y++) for (let x = 0; x < 640; x++) scr.fb[y * 640 + x] = S.bgcol(x, y); return scr; };
const prep = () => { S.loadState(S.base); S.setupMenuEnv(); S.emuFillBG(); };
function cmp(name, emuFn, jsFn, quiet) {
  prep(); let err = null;
  try { emuFn(); } catch (e) { err = e.message; }
  const scr = bgFill(); jsFn(scr);
  const d = S.cmp(S.emuFB(), scr.fb); total++;
  const ok = d.n === 0 && !err; if (!ok) fails++;
  if (!ok || !quiet) rep.push(`${ok ? "OK  " : "FAIL"} ${name.padEnd(30)} diff=${d.n}${d.first ? " @" + d.first : ""}${err ? " ERR " + err : ""}`);
}
// 1) 具名大头像: 全部 128 张, 位置轮换 (含奇数栏 / 背景平面 3 有值的区域)
for (let n = 0; n < 128; n++) { const col = (n * 7) % 72, y = (n * 37) % 320;
  cmp(`named #${n} @${col},${y}`, () => S.call(0x7cdd, { ax: col, dx: y, bx: n }), s => kao.drawNamed(s, n, col, y), true); }
rep.push(`named 128: ${fails === 0 ? "all OK" : fails + " fail"}`);
// 2) 发现物图: 全部 128 张
let f0 = fails;
for (let n = 0; n < 128; n++) { const col = (n * 11) % 74, y = (n * 29) % 352;
  cmp(`item #${n} @${col},${y}`, () => S.call(0x7d4c, { ax: col, dx: y, bx: n }), s => kao.drawItem(s, n, col, y), true); }
rep.push(`item 128: ${fails === f0 ? "all OK" : (fails - f0) + " fail"}`);
// 3) 拼合: 7 种类 x 全部部件组合抽样 (每个字段的每个值至少出现一次) + 随机 200 组
f0 = fails;
const combos = [];
for (let t = 0; t < 7; t++) for (let v = 0; v < 8; v++) combos.push([t, (v) | (v << 3) | ((v & 3) << 6) | (v << 8) | (v << 11)]);
let seed = 12345; const r16 = () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 16;
for (let i = 0; i < 200; i++) combos.push([r16() % 7, (r16() & 0x3fff) | 0xc000]);
combos.push([7, 0xc123]);   // 种类超出 (读到档尾以后)
for (const [t, parts] of combos) { const col = (t * 9 + (parts & 15)) % 72, y = ((parts >> 4) * 3) % 320;
  const off = 0x476a2 + t * 0x60c0;
  cmp(`compose t=${t} parts=${parts.toString(16)}`, () => S.call(0x7bb5, { ax: off & 0xffff, dx: off >>> 16, bx: col, args: [parts, y] }), s => kao.drawComposed(s, t, parts, col, y), true); }
rep.push(`compose ${combos.length}: ${fails === f0 ? "all OK" : (fails - f0) + " fail"}`);
// 4) 随机种类 (7cb9) — 同一随机数种子
f0 = fails;
for (const sd of [1, 2, 3, 777, 40000, 65535]) {
  const parts = 0xc000 | (sd * 2654435761 >>> 18);
  cmp(`randomType seed=${sd}`, () => { c.ww(D * 16 + 0xbd88, sd); c.ww(D * 16 + 0xbd8a, 0); S.call(0x7cb9, { ax: 20, dx: 100, bx: parts }); },
      s => { const rng = new U.Rng(sd); kao.drawRandomType(s, rng, parts, 20, 100); });
}
// 5) 人物数据 (7d39): 具名 / 拼合
for (const [lo, hi, t] of [[5, 0, 0], [100, 0, 3], [0x34, 0xc5, 2], [0xff, 0xff, 6], [0x12, 0x40, 1], [0x12, 0x80, 15]]) {
  cmp(`byRecord ${hi.toString(16)}${lo.toString(16)} t=${t}`, () => {
      const rec = D * 16 + 0xe400; for (let i = 0; i < 0x40; i++) c.mem[rec + i] = 0; c.mem[rec + 0x1a] = lo; c.mem[rec + 0x1b] = hi; c.mem[rec + 0x31] = t;
      S.call(0x7d39, { ax: 30, dx: 200, bx: 0xe400 }); },
    s => { const rec = new Uint8Array(0x40); rec[0x1a] = lo; rec[0x1b] = hi; rec[0x31] = t; kao.drawPerson(s, rec, 30, 200); });
}
console.log(`fails=${fails}/${total}`);
console.log(rep.join("\n"));
})();
