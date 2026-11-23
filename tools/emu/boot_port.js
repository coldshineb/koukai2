// boot_port.js — 開發用: 從標題選單狀態以按鍵開始新航海 (主角 hero, 不改名), 讓原版一直跑到港口走路迴圈 (1b966 的 1fd9:1361 讀輸入)
// 保存狀態 session.portState, 之後 session.restorePort() 可重複從進港後第一次等待輸入開始測試
"use strict";
(function () {
const S = session, L = 0x110 * 16;
S.snapEmu = env => { const c = env.cpu; return { mem: c.mem.slice(), r: c.r.slice(), s: c.s.slice(), ip: c.ip, flags: c.flags, planes: c.vga.planes.map(p => p.slice()),
  gc: c.vga.gc.slice(), seq: c.vga.seq.slice(), dac: c.vga.dac.slice(), attr: c.vga.attr.slice(), t66: env.t66.slice(),
  handles: JSON.parse(JSON.stringify(env.handles)), next: env.nextHandle, mouse: { ...env.mouse } }; };
S.loadEmu = (env, st) => { const c = env.cpu;
  c.mem.set(st.mem); c.r.set(st.r); c.s.set(st.s); c.ip = st.ip; c.flags = st.flags;
  st.planes.forEach((p, i) => c.vga.planes[i].set(p)); c.vga.gc.set(st.gc); c.vga.seq.set(st.seq); c.vga.dac.set(st.dac); c.vga.attr.set(st.attr);
  env.t66 = st.t66.slice(); env.bioskeys = []; c.halted = false; c.pendingIRQ = [];
  env.handles = JSON.parse(JSON.stringify(st.handles)); env.nextHandle = st.next; Object.assign(env.mouse, st.mouse); };
// hero: 0..5; 走: ↓ Enter (開始新航海) → 方向鍵選主角 → Enter → Enter(是) → 鍵盤: Esc→游標「結束」? 用 «結束» = 游標 0: 從 10 按 ← ← 再 ↑↑ 到 0 → Enter → (姓氏) 同 → Enter(是)
S.bootPortStart = function (hero = 0) {
  S.restoreTitle();
  const env = S.titleEnv, c = env.cpu, K = { down: [0x50, 0], up: [0x48, 0], left: [0x4b, 0], right: [0x4d, 0], enter: [0x1c, 0x0d] };
  const keys = [K.down, K.enter];
  for (let i = 0; i < hero; i++) keys.push(K.right);
  keys.push(K.enter, K.enter);                                   // 選定, 是
  for (let n = 0; n < 2; n++) keys.push(K.left, K.left, K.enter); // 名字/姓氏 鍵盤: 10 → 5 → 0 (結束)
  keys.push(K.enter);                                            // 全部可以了嗎 → 是
  const sc = S.makeScript(keys);
  const saveEnv = S.env, sH16 = S._H16, sH33 = S._H33; S.env = env; S._H16 = S._H33 = undefined;
  S.installEmuServices(sc, null);
  S.env = saveEnv; S._H16 = sH16; S._H33 = sH33;
  S.bp = { sc, hit: 0, hero };
  c.onTick = cpu => { if (cpu.s[1] * 16 + cpu.ip === L + 0x1b9a3 && !S.bp.sc.keys.length) { S.bp.hit++; cpu.halted = true; } };
};
// 每次呼叫執行 n 條指令; 到達港口後保存狀態
S.bootPortStep = function (n = 4e8) {
  const env = S.titleEnv, c = env.cpu, t0 = Date.now();
  while (!S.bp.hit && Date.now() - t0 < 200000) c.run(2e7);
  if (!S.bp.hit) return { ok: false, ip: (c.s[1] * 16 + c.ip - L).toString(16), keysLeft: S.bp.sc.keys.length, icount: c.icount };
  c.onTick = null; c.halted = false;
  S.portEnv = env; S.portState = S.snapEmu(env); S.portHero = S.bp.hero;
  return { ok: true, icount: c.icount };
};
S.restorePort = () => S.loadEmu(S.portEnv, S.portState);
})();
