// printf_tests.js — 原版 printf (seg0:4bad -> 4194) 與 MESSAGE.DAT 輸出的差分測試
(async function () {
const fs = require("fs"), S = session, U = S.UI, c = S.env.cpu, D = S.DSEG;
const font = U.Font.fromRaw(S.files["1.PAT"], S.files["2.PAT"], S.rom);
const cm = JSON.parse(fs.readFileSync(S.W + "/uw2_remake/web/assets/font/charmap.json", "utf8"));
font.u2c = new Map(); for (const [code, , , u] of cm.table) font.u2c.set(u, code);
const msg = fs.readFileSync(S.W + "/uw2_remake/tools/work/sea2/MESSAGE.DAT");
const E = s => Array.from(font.encode(s));
const rep = [];
const setup = () => { S.loadState(S.base); S.setupMenuEnv(); S.emuFillBG(); c.mem[D * 16 + 0xca4] = 0;
  S.call(0x7358, { ax: 2, dx: 20, bx: 76, args: [0, 360] }); };
const jsSetup = () => { const scr = new U.Screen(); for (let y = 0; y < 400; y++) for (let x = 0; x < 640; x++) scr.fb[y * 640 + x] = S.bgcol(x, y);
  const con = new U.TextConsole(scr, font); const win = new U.WindowSystem(scr, con, S.D1[14], { options: { animate: false } }); win.frame(2, 20, 76, 360, 0); return { scr, con }; };
// 參數: 數字 -> word; 位元組陣列 -> 寫入 DGROUP 並傳指標; {long:v} -> 兩個 word
function emuArgs(args) { let p = 0xf000; const out = [];
  for (const a of args) {
    if (Array.isArray(a)) { out.push(p); for (const b of a) c.mem[D * 16 + p++] = b; c.mem[D * 16 + p++] = 0; }
    else if (typeof a === "object") { out.push(a.long & 0xffff, (a.long >>> 16) & 0xffff); }
    else out.push(a & 0xffff);
  } return out; }
const jsArgs = args => args.map(a => typeof a === "object" && !Array.isArray(a) ? a.long : a);
async function pf(name, fmt, args) {
  setup(); const fb = Array.from(fmt); const fp = 0xe000; for (let i = 0; i < fb.length; i++) c.mem[D * 16 + fp + i] = fb[i]; c.mem[D * 16 + fp + fb.length] = 0;
  S.call(0x4bad, { args: [fp, ...emuArgs(args)] });
  const J = jsSetup(); U.cprintf(Uint8Array.from([...fb, 0]), jsArgs(args), ch => J.con.putc(ch));
  const d = S.cmp(S.emuFB(), J.scr.fb); const ev = S.emuVars(), jv = S.jsVars(J.con);
  rep.push(`${d.n === 0 && ev.x === jv.x && ev.y === jv.y ? "OK  " : "FAIL"} ${name.padEnd(26)} diff=${d.n} cursor ${ev.x},${ev.y}/${jv.x},${jv.y}`);
}
await pf("%d %u", E("A=%d B=%u C=%d"), [123, 65535, -45]);
await pf("width/pad", E("[%5d][%-5d][%05d][%3d]"), [42, 42, -3, 12345]);
await pf("%ld %lu", E("%ld|%lu|%8ld"), [{ long: 1234567 }, { long: 4000000000 }, { long: -99999 }]);
await pf("%s width/prec/left", E("<%s><%10s><%-10s><%.3s>"), [E("港口"), E("AB"), E("里斯本"), E("ABCDEF")]);
await pf("%c and unknown", E("%c%c %x %% %q"), [0x41, 0x42]);
await pf("mixed CJK", E("您給%s金幣%d枚，%s"), [E("船長"), 1500, E("謝謝")]);
// %w (全形數字) 在繁中版資料中沒有使用 (僅二進位資料巧合), 原版會讀到字型檔範圍外的殘留點陣, 不測
await pf("%ld edge values", E("%ld %lu %ld %5lu"), [{ long: -2147483648 }, { long: 2147483647 }, { long: 0 }, { long: 9 }]);
// MESSAGE.DAT 第 n 條 (2e09:56ee = 0x3377e)
for (const [n, args] of [[1, [E("阿方索"), E("科斯塔")]], [12, [5000]], [19, [E("葡萄酒"), 12]], [33, [E("聖"), E("瑪利亞號")]], [100, []], [500, []]]) {
  setup(); S.call(0x3377e, { args: [n, ...emuArgs(args)] });
  const J = jsSetup(); const off = msg.readUInt16BE(n * 2); U.cprintf(msg.subarray(off, off + 256), jsArgs(args), ch => J.con.putc(ch));
  const d = S.cmp(S.emuFB(), J.scr.fb);
  rep.push(`${d.n === 0 ? "OK  " : "FAIL"} ${("MESSAGE #" + n).padEnd(26)} diff=${d.n}`);
}
console.log(rep.join("\n"));
})();
