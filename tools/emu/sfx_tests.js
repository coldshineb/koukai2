// sfx_tests.js — FM 效果音差分測試 (RE_NOTES 35.6): 原版 FMDRV.COM (模擬器) 與移植版 core/sfx.js FmDriver 的 OPL 暫存器寫入序列逐項比對
// 前提: 已載入 x86emu.js、dosenv.js 與 tools/work/ui_bundle.js; session.files 有 FMDRV.COM / MAIN.EXE, session.rom (8×8 字形)
// 每條路線: 兩邊各從頭載入 FMDRV (原版執行到常駐 INT 21h AH=31) → 依 [IRQ0 序號, INT 66h 指令] 表在該次 IRQ0 之前呼叫 → 共 N 次 IRQ0;
//   每筆寫入記為 [IRQ0 序號 (常駐前 = −1), 暫存器, 值], 兩邊的整串必須完全相同。音色資料: 原版取 MAIN.EXE 的 DS 映像 (DS:0bc0..), 移植版用 SFX_VOICES。
// S.SFX_WAV = 目錄: 另以 FmDriver + OPL3 (Nuked OPL3 移植) 產生試聽用 wav (22050 Hz, 16 位元單聲道)
"use strict";
(function () {
const S = session, U = S.UI, f = S.files;
const ex = f["MAIN.EXE"], hdr = (ex[8] | (ex[9] << 8)) * 16, DSO = hdr + 0x38150;   // MAIN.EXE DGROUP 在映像內的位置 (tools/re_env.py 的 DS)
const T = 4.8303;                                                   // 1 個遊戲 tick (60.309 Hz) ≈ 4.83 次 IRQ0 (291.304 Hz)
const tk = n => Math.round(n * T);
// 指令: v = 9768 (音色), n = 9804 (發音), off = 9888 (AH=05 null + AH=07 ×2); 另有 raw [ah, al, dl, addr]
const V = a => ({ ah: 5, al: 0, addr: a }), N = n => ({ ah: 6, al: 0, dl: n }), OFF = [{ ah: 5, al: 0, addr: 0 }, { ah: 7, al: 0 }, { ah: 7, al: 1 }];
const seq = (...items) => { const out = []; let t = 0; for (const it of items) { if (typeof it === "number") t += it; else for (const c of [].concat(it)) out.push([t, c]); } return out; };
const ROUTES = [
  { name: "storm 0c5a (出海暴風雨, 5 秒後 9888)", pre: 37, cmds: seq(V(0x0c5a), N(0x30), 1500, OFF), n: 1900 },
  { name: "cannon 0bec (c853 軌跡 → cdcd 命中)", pre: 5, cmds: seq(V(0x0bec), N(0x24), tk(30), V(0x0bec), N(0x24)), n: 900 },
  { name: "board 0c02 (d1eb 接舷 → d3d0 9888)", pre: 111, cmds: seq(V(0x0c02), N(0x30), tk(48), OFF), n: 700 },
  { name: "duel 0bc0 / 0bd6 (12176 沒打中 → 打中)", pre: 2, cmds: seq(V(0x0bc0), N(0x30), tk(60), V(0x0bd6), N(0x30)), n: 900 },
  { name: "levelup 0c2e (1bc14: 5998(0x14) → 9888)", pre: 64, cmds: seq(V(0x0c2e), N(0x3c), tk(0x14), OFF), n: 500 },
  { name: "seaevent 0c44 (30e9f: 兩次各 0x1e tick, 中間 0x14)", pre: 9, cmds: seq(V(0x0c44), N(0x30), tk(0x1e), OFF, tk(0x14), V(0x0c44), N(0x30), tk(0x1e), OFF), n: 600 },
  { name: "find 0c18 (348ff 發現物)", pre: 300, cmds: seq(V(0x0c18), N(0x3c), 700), n: 800 },
  { name: "unused 0c70 (MAIN.EXE 沒有引用)", pre: 17, cmds: seq(V(0x0c70), N(0x30), 300, OFF), n: 500 },
  // 遊戲的 9 組音色沒有用到的 LFO 波形 0 (鋸齒)、3 (隨機, DS:05d0) 與延遲 0 時以全域計數 [05ce] 當相位: 以改過的音色 (放在 DS:e000 / e016) 驗證
  { name: "lfo wave0 / wave3 (自訂音色)", pre: 41, voices: { 0xe000: [0x0a, 0x00, 0x0e, 0x02, 0x02, 0x07, 0x00, 0x70, 0x20, 0x00, 0x00, 0x00, 0x46, 0x00, 0x00, 0x32, 0x0f, 0x40, 0x0f, 0x0f, 0x00, 0x01],
      0xe016: [0x23, 0x21, 0x0d, 0x03, 0x01, 0x85, 0x45, 0x5f, 0x53, 0x0f, 0x0f, 0xf4, 0x50, 0x06, 0x03, 0x9c, 0x0b, 0xc0, 0x07, 0x0c, 0x05, 0x01] },
    cmds: seq(V(0xe000), N(0x30), 600, V(0xe016), N(0x40), 600, OFF), n: 1400 },
  { name: "edge (聲部 1、音高 > 5F 不發音、無音色發音、重複觸鍵、低音 / 高音、AH=07 聲部 2 不動作)", pre: 3,
    cmds: seq(N(0x30), 10, { ah: 6, al: 0, dl: 0x60 }, V(0x0bec), N(0x05), 30, N(0x5f), 30, N(0x5f), 30, { ah: 5, al: 1, addr: 0x0c5a }, { ah: 6, al: 1, dl: 0x30 },
      50, { ah: 7, al: 2 }, { ah: 7, al: 1 }, 20, OFF, { ah: 6, al: 1, dl: 0x10 }), n: 400 },
];
S.SFX_ROUTES = ROUTES;
// ---------------- 原版 ----------------
function emuRun(R) {
  const env = new S.DOSEnv(f, { romFont: S.rom }), c = env.cpu, m = c.mem;
  c.onTick = null;
  const PSP = 0x2000, com = f["FMDRV.COM"];
  m.fill(0, PSP * 16, PSP * 16 + 0x10000);
  m[PSP * 16] = 0xcd; m[PSP * 16 + 1] = 0x20; m[PSP * 16 + 0x80] = 0; m[PSP * 16 + 0x81] = 0x0d;
  m.set(com, PSP * 16 + 0x100);
  const log = []; let irq = -1, idx = 0, status = 0;
  c.ports[0x388] = { in: () => status, out: (p, v) => { idx = v; } };
  c.ports[0x389] = { in: () => 0xff, out: (p, v) => { log.push([irq, idx, v]); if (idx === 4) { if (v & 0x80) status = 0; else if (v & 1) status = 0xc0; } } };
  const h21 = c.hooks[0x21]; let tsr = false;
  c.hooks[0x21] = cpu => { if ((cpu.r[0] >> 8) === 0x31) { cpu.halted = true; tsr = true; return; } h21(cpu); };
  c.s[0] = c.s[1] = c.s[2] = c.s[3] = PSP; c.r[4] = 0xfffe; c.ip = 0x100; c.flags = 0x202; c.halted = false;
  c.run(5e6);
  if (!tsr || m[PSP * 16 + 0x128] !== 0xff) throw new Error("FMDRV 沒有常駐 / 沒偵測到 OPL");
  m.set(ex.subarray(DSO, Math.min(ex.length, DSO + 0x10000)), 0x30000);   // 音色資料: DS = 3000 (MAIN.EXE 的 DS 映像)
  for (const [a, d] of Object.entries(R.voices || {})) m.set(d, 0x30000 + +a);
  const callInt = (n, regs) => {
    for (const [k, v] of Object.entries(regs || {})) { if (k === "ds") c.s[3] = v; else c.r[{ ax: 0, cx: 1, dx: 2, bx: 3 }[k]] = v; }
    c.r[4] = 0xfff0; c.s[2] = 0x1000;
    c.push(c.flags); c.push(0xf000); c.push(0xf000);
    c.ip = c.rw(n * 4); c.s[1] = c.rw(n * 4 + 2); c.halted = false;
    c.run(2e6);
  };
  const cmd = q => callInt(0x66, { ax: (q.ah << 8) | q.al, dx: q.ah === 5 ? (q.addr || 0) : (q.dl ?? 0), ds: q.ah === 5 && !q.addr ? 0 : 0x3000 });
  run(R, q => cmd(q), () => { c.flags &= ~0x200; callInt(8, {}); }, v => (irq = v));
  return { log, mem: m.slice(PSP * 16, PSP * 16 + 0x700) };
}
// ---------------- 移植版 ----------------
function jsRun(R) {
  const log = []; let irq = -1;
  const drv = new U.FmDriver((r, v) => log.push([irq, r, v]));
  drv.init();
  run(R, q => drv.int66(q.ah, q.al, q.dl ?? 0, q.addr || 0, q.ah === 5 && q.addr ? (R.voices?.[q.addr] || U.SFX_VOICES[q.addr]) : null, 0x3000), () => drv.irq0(), v => (irq = v));   // 原版這邊的 DS = 3000
  return { log, mem: drv.m };
}
function run(R, doCmd, doIrq, setIrq) {
  const cmds = R.cmds.map(([t, q]) => [t + R.pre, q]);
  let k = 0;
  for (let i = 0; i < R.pre + R.n; i++) {
    setIrq(i);
    while (k < cmds.length && cmds[k][0] <= i) doCmd(cmds[k++][1]);
    doIrq();
  }
}
// ---------------- 比對 ----------------
const out = [];
{ // 音色表與原版 DS 相同
  let bad = 0; for (const [a, d] of Object.entries(U.SFX_VOICES)) for (let i = 0; i < 0x16; i++) if (ex[DSO + +a + i] !== d[i]) bad++;
  out.push(`${bad ? "FAIL" : "OK"} SFX_VOICES = MAIN.EXE DS:0bc0..0c86 (${Object.keys(U.SFX_VOICES).length} 組${bad ? ", " + bad + " bytes 不同" : ""})`);
}
let okN = 0;
for (const R of S.SFX_ONLY ? ROUTES.filter(r => S.SFX_ONLY.some(s => r.name.startsWith(s))) : ROUTES) {
  const E = emuRun(R), J = jsRun(R);
  let d = -1; const n = Math.max(E.log.length, J.log.length);
  for (let i = 0; i < n; i++) { const a = E.log[i], b = J.log[i]; if (!a || !b || a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) { d = i; break; } }
  // 效果音聲部記錄 (DS:0544..05a0) 與 [05ce] 也比對
  let dm = -1; for (const a of [[0x544, 0x5a0], [0x5ce, 0x5d2]]) for (let o = a[0]; o < a[1] && dm < 0; o++) if (E.mem[o] !== J.mem[o]) dm = o;
  const keyOn = E.log.filter(w => (w[1] & 0xf0) === 0xb0 && w[1] !== 0xbd).length, lfo = E.log.filter(w => w[0] >= R.pre && ((w[1] & 0xf0) === 0x40 || (w[1] & 0xf0) === 0xa0)).length;
  const ok = d < 0 && dm < 0; if (ok) okN++;
  const h = x => x ? `[${x[0]}, ${x[1].toString(16)}, ${x[2].toString(16)}]` : "—";
  out.push(`${ok ? "OK" : "FAIL"} ${R.name}: 寫入 原版 ${E.log.length} / 移植 ${J.log.length} 筆 (B0 ${keyOn} 筆, 發音後的 40/A0 寫入 ${lfo})` +
    (d >= 0 ? ` 第 ${d} 筆不同: 原版 ${h(E.log[d])} 移植 ${h(J.log[d])}` : "") + (dm >= 0 ? ` 記憶體 DS:${dm.toString(16)} 原版 ${E.mem[dm].toString(16)} 移植 ${J.mem[dm].toString(16)}` : ""));
}
out.push(`[summary] sfx_tests ${okN}/${(S.SFX_ONLY ? ROUTES.filter(r => S.SFX_ONLY.some(s => r.name.startsWith(s))) : ROUTES).length} 路線一致`);
// ---------------- 試聽 wav ----------------
if (S.SFX_WAV) {
  const fs = require("fs"), RATE = 22050;
  const WAVS = [["sfx_storm", seq(V(0x0c5a), N(0x30), tk(240), OFF), tk(300)], ["sfx_cannon", seq(V(0x0bec), N(0x24), tk(30), V(0x0bec), N(0x24)), tk(150)],
    ["sfx_board", seq(V(0x0c02), N(0x30), tk(48), OFF), tk(90)], ["sfx_duel", seq(V(0x0bc0), N(0x30), tk(60), V(0x0bd6), N(0x30)), tk(130)]];
  S.sfxStats = [];
  for (const [name, cmds, n] of WAVS) {
    const chip = new U.OPL3(RATE), drv = new U.FmDriver((r, v) => chip.write(r, v)); drv.init();
    const total = Math.ceil(n / 291.304 * RATE), pcm = new Int16Array(total), b = [0, 0, 0, 0];
    let acc = 0, irq = 0, k = 0;
    const tick = () => {
      while (k < cmds.length && cmds[k][0] <= irq) { const q = cmds[k++][1]; drv.int66(q.ah, q.al, q.dl ?? 0, q.addr || 0, q.ah === 5 && q.addr ? U.SFX_VOICES[q.addr] : null); }
      acc += 1193182; if (acc >= 4096 * 49716) { acc -= 4096 * 49716; drv.irq0(); irq++; }
    };
    let peak = 0, sq = 0;
    for (let i = 0; i < total; i++) { chip.generateResampled(b, tick); pcm[i] = b[0]; peak = Math.max(peak, Math.abs(b[0])); sq += b[0] * b[0]; }
    const head = Buffer.alloc(44);
    head.write("RIFF", 0); head.writeUInt32LE(36 + total * 2, 4); head.write("WAVEfmt ", 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
    head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write("data", 36); head.writeUInt32LE(total * 2, 40);
    fs.writeFileSync(`${S.SFX_WAV}/${name}.wav`, Buffer.concat([head, Buffer.from(pcm.buffer)]));
    S.sfxStats.push({ name, sec: +(total / RATE).toFixed(2), peak, rms: Math.round(Math.sqrt(sq / total)) });
  }
  out.push("wav: " + JSON.stringify(S.sfxStats));
}
for (const l of out) console.log(l);
})();
