// palette_tests.js — 調色盤系統差分測試 (原版 vs core/palette.js)
(async function () {
const fs = require("fs"), S = session, U = S.UI, c = S.env.cpu, D = S.DSEG;
const json = JSON.parse(fs.readFileSync(S.W + "/uw2_remake/web/assets/data/palettes.json", "utf8"));
const T = U.paletteTables(json);
const rep = []; let fails = 0;
const memB = o => c.mem[D * 16 + o];
const setMem = (o, bytes) => bytes.forEach((b, i) => c.mem[D * 16 + o + i] = b);
const getMem = (o, n) => Array.from(c.mem.subarray(D * 16 + o, D * 16 + o + n));
const dacRaw = () => { const out = []; for (let i = 0; i < 16; i++) { const k = i * 3; out.push(c.vga.dac[k + 2] >> 2, c.vga.dac[k] >> 2, c.vga.dac[k + 1] >> 2); } return out; };  // DAC -> (B,R,G) 4bit
const prep = () => { S.loadState(S.base); S.setupMenuEnv(); S.installEmuServices(null); };
// 原版: 在 seg0:5998 截取每步的 DAC
const emuFade = (lin, regs) => {
  const steps = [], old = c.onTick;
  c.onTick = cpu => { old(cpu); if (cpu.s[1] === 0x110 && cpu.ip === 0x5998) { steps.push(dacRaw().join(",")); cpu.ip = cpu.pop(); cpu.s[1] = cpu.pop(); } };
  try { S.call(lin, { ...regs, maxIns: 2e8 }); } finally { c.onTick = old; }
  return steps;
};
const jsPal = (start, target) => {
  const scr = { setPaletteRaw() {} }, sys = { waitTicks: async () => {} };
  const P = new U.Palette(scr, sys, T); P.cur.set(start); if (target) P.target.set(target);
  const steps = []; P.onStep = cur => steps.push(Array.from(cur).join(","));
  return { P, steps };
};
const check = (name, ok, extra = "") => { if (!ok) fails++; rep.push(`${ok ? "OK  " : "FAIL"} ${name.padEnd(34)} ${extra}`); };
const names = Object.keys(T);
// 1) 99ce fadeTo: 各調色盤之間淡變 (起點 = 黑 / 其他調色盤)
const pairs = [["black", "heroSelect"], ["heroSelect", "black"], ["night", "dawn"], ["dawn", "day"], ["day", "dusk"], ["dusk", "night"], ["day", "overcast"], ["ships", "chart"], ["chart", "battle"], ["battle", "default"], ["black", "ships"]];
const zero = new Array(48).fill(0);
for (const [a, b] of pairs) {
  prep();
  const A = a === "black" ? zero : Array.from(T[a]), B = b === "black" ? zero : Array.from(T[b]);
  setMem(0xbcd6, A); setMem(0xe100, B);
  const es = emuFade(0x99ce, { bx: 0xe100 });
  const J = jsPal(A); await J.P.fadeTo(Uint8Array.from(B));
  const same = es.length === J.steps.length && es.every((s, i) => s === J.steps[i]);
  check(`fadeTo ${a} -> ${b}`, same && getMem(0xbcd6, 48).join() === Array.from(J.P.cur).join(), `steps ${es.length}/${J.steps.length}`);
}
// 2) 99f2 fadeBlack, 99e8 fadeToTarget, 9a10 fadeUpperBlack
for (const [nm, lin, fn] of [["fadeBlack", 0x99f2, P => P.fadeBlack()], ["fadeToTarget", 0x99e8, P => P.fadeToTarget()], ["fadeUpperBlack", 0x9a10, P => P.fadeUpperBlack(new Uint8Array(48))]]) {
  prep(); const A = Array.from(T.dusk), Tg = Array.from(T.ships);
  setMem(0xbcd6, A); setMem(0x8c36, Tg);
  const es = emuFade(lin, { bx: 0xe200 });
  const J = jsPal(A, Tg); await fn(J.P);
  const same = es.length === J.steps.length && es.every((s, i) => s === J.steps[i]);
  check(nm, same, `steps ${es.length}/${J.steps.length}`);
}
// 3) [03ea] ≠ 0 時 fadeTo 不動作
prep(); setMem(0xbcd6, Array.from(T.day)); setMem(0xe100, zero); c.mem[D * 16 + 0x03ea] = 0x10;
{ const es = emuFade(0x99ce, { bx: 0xe100 }); const J = jsPal(T.day); J.P.ending = 0x10; await J.P.fadeTo(new Uint8Array(48));
  check("fadeTo skipped when [03ea]≠0", es.length === 0 && J.steps.length === 0 && getMem(0xbcd6, 48).join() === Array.from(T.day).join(), `steps ${es.length}/${J.steps.length}`); }
// 4) 1976e 時段/天候選擇: 全部時刻 0..71 x (港內/海上) x 天候 0..4
let selFail = 0, selN = 0;
const nameOf = arr => names.find(n => Array.from(T[n]).join() === arr.join()) ?? "?";
for (let time = 0; time < 72; time++) for (const atSea of [0, 1]) for (const w of [0, 1, 2, 3, 4, 0x11]) {
  prep(); c.mem[D * 16 + 0x0535] = time; c.mem[D * 16 + 0x0cae] = atSea ? 0xff : 3; c.mem[D * 16 + 0x0cb3] = w;
  setMem(0x8c36, zero);
  S.call(0x1976e, {});
  const emuName = nameOf(getMem(0x8c36, 48));
  const J = jsPal(zero); const jsName = J.P.selectTimePalette(time, atSea, w);
  selN++; if (emuName !== jsName) { selFail++; if (selFail < 5) rep.push(`   mismatch t=${time} sea=${atSea} w=${w}: ${emuName}/${jsName}`); }
}
check("selectTimePalette (1976e)", selFail === 0, `${selN - selFail}/${selN}`);
// 5) 197b4 時刻轉換
let trFail = 0;
for (let time = 0; time < 256; time++) {
  prep(); c.mem[D * 16 + 0x0535] = time; setMem(0x8c36, zero);
  const r = S.call(0x197b4, {}).ax;
  const J = jsPal(zero); const jr = J.P.timeTransition(time);
  if (r !== jr || nameOf(getMem(0x8c36, 48)) !== (jr ? nameOf(Array.from(J.P.target)) : "?")) trFail++;
}
check("timeTransition (197b4) t=0..255", trFail === 0, `fails ${trFail}`);
console.log(`fails=${fails}/${rep.filter(r => !r.startsWith("   ")).length}`);
console.log(rep.join("\n"));
})();
