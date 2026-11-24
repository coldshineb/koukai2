// explore_walk.js — explore.js 的港內走路輔助: 依港口地圖 (web/assets/gfx/portmap.bin + portchip.bin 的 bd78) 以 BFS 找路,
//   每送一個方向鍵就重新讀主角位置與行人位置; 撞到行人開了對話視窗時按 Enter 關掉。只用來「探索」按鍵序列, 重播時不需要。
"use strict";
(function () {
const S = session, X = S.X, fs = require("fs");
const K = S.K = { down: [0x50, 0], up: [0x48, 0], left: [0x4b, 0], right: [0x4d, 0], enter: [0x1c, 0x0d], esc: [0x01, 0x1b], sp: [0x39, 0x20], f5: [0x3f, 0] };
K.d = n => String(n).split("").map(ch => [ch === "0" ? 0x0b : ch.charCodeAt(0) - 0x2f, ch.charCodeAt(0)]);   // 數字鍵 (計算機輸入)
// 至今的按鍵存檔 (沙盒被殺掉時可從檔案重播): X.save(名稱) / X.load(名稱)
X.save = name => fs.writeFileSync(S.W + "/op/" + name + ".json", JSON.stringify(X.log));
X.load = name => JSON.parse(fs.readFileSync(S.W + "/op/" + name + ".json", "utf8"));
const A = S.W + "/uw2_remake/web/assets/";
const MAPS = new Uint8Array(fs.readFileSync(A + "gfx/portmap.bin")), CHIP = new Uint8Array(fs.readFileSync(A + "gfx/portchip.bin"));
const chipNo = JSON.parse(fs.readFileSync(A + "data/portchip.json", "utf8")).chipNo;
const ZA = new Uint8Array(fs.readFileSync(A + "data/za_dat.bin"));
X.doors = p => { const k = Math.min(p, 100) * 24, D = []; for (let i = 0; i < 12; i++) D.push([ZA[k + i * 2], ZA[k + i * 2 + 1]]); return D; };
X.blocked = (p, x, y) => {
  const set = p < 100 ? chipNo[p] : 3, base = set * (0x7800 + 4), P = CHIP.subarray(base + 0x7800, base + 0x7804), M = MAPS.subarray((p < 100 ? p : 100) * 0x2400);
  const i = y * 96 + x + 96, m0 = M[i], m1 = M[i + 1];
  return m0 >= P[2] || (m1 >= P[1] && m1 < P[2]) || m1 >= P[3];
};
X.win = () => X.u16(0x0536);
X.npcs = () => { const r = []; for (let b = 0; b < 8; b++) r.push([X.u8(0x0cbc + b * 3), X.u8(0x0cbc + b * 3 + 1), X.u8(0x0cbc + b * 3 + 2)]); return r; };
X.night = () => { const t = X.u8(0x0535); return t < 12 || t >= 0x3c; };
// 下一步的方向鍵 (BFS; 行人周圍 ±1 視為障礙, 目標格本身例外)
X.nextKey = (tx, ty, avoidNpc = true) => {
  const p = X.u8(0x0cae), [sx, sy] = X.st().pos, N = avoidNpc && !X.night() ? X.npcs() : [];
  const bad = (x, y) => { if (x < 0 || y < 0 || x > 94 || y > 94) return true; if (x === tx && y === ty) return false;
    if (X.blocked(p, x, y)) return true; for (const [nx, ny] of N) if (nx - 1 <= x && nx + 1 >= x && ny - 1 <= y && ny + 1 >= y) return true; return false; };
  const prev = new Map(), key = (x, y) => y * 128 + x, q = [[sx, sy]]; prev.set(key(sx, sy), null);
  const D = [[0, -1, K.up], [1, 0, K.right], [0, 1, K.down], [-1, 0, K.left]];
  while (q.length) { const [x, y] = q.shift(); if (x === tx && y === ty) break;
    for (const [dx, dy] of D) { const nx = x + dx, ny = y + dy; if (prev.has(key(nx, ny)) || bad(nx, ny)) continue; prev.set(key(nx, ny), [x, y, dx, dy]); q.push([nx, ny]); } }
  if (!prev.has(key(tx, ty))) return null;
  let c = [tx, ty], step = null; while (true) { const pv = prev.get(key(c[0], c[1])); if (!pv) break; step = pv; c = [pv[0], pv[1]]; }
  if (!step) return "here";
  return D.find(d => d[0] === step[2] && d[1] === step[3])[2];
};
// 走到 (tx, ty); 回傳最後狀態。maxSteps 步內走不到就停 (印出原因)
X.walkTo = (tx, ty, maxSteps = 200) => {
  let stuck = 0, last = null;
  for (let n = 0; n < maxSteps; n++) {
    if (X.ctx === "wait") { X.step([K.enter]); continue; }               // 撞到行人的對話
    const st = X.st(); if (st.pos[0] === tx && st.pos[1] === ty) return st;
    if (st.port !== X.port0) return st;                                 // 進了建築又出來後港口不變; 換港 = 出海
    let k = X.nextKey(tx, ty, stuck < 3);
    if (k === null) k = X.nextKey(tx, ty, false);
    if (k === null || k === "here") { console.log("[walk] no path", st.pos, "→", tx, ty); return st; }
    const r = X.step([k]);
    if (last && r.pos[0] === last[0] && r.pos[1] === last[1]) stuck++; else stuck = 0;
    last = r.pos;
    const D = X.doors(X.port0);                                         // 走進了建築 (站上門口) → 交給呼叫端
    if (D.some(([dx, dy]) => dx === r.pos[0] && dy === r.pos[1] - 1) && X.inside()) return X.st();
  }
  console.log("[walk] gave up", X.st().pos, "→", tx, ty);
  return X.st();
};
// 走進第 k 棟建築 (先到門口正下方, 再往上)
X.enter = k => {
  X.port0 = X.u8(0x0cae);
  const [dx, dy] = X.doors(X.port0)[k];
  X.walkTo(dx, dy + 1);
  return X.step([K.up]);
};
// 對話 (按鍵等待 "wait") 時一直按 Enter, 直到回到街上或出現選單 / 是否 / 清單等需要選擇的畫面; 回傳停下時的 ctx
X.talk = (max = 120) => {
  for (let n = 0; n < max; n++) { if (X.ctx !== "wait") return X.ctx; X.step([K.enter]); }
  return X.ctx;
};
// 依序送鍵, 每送一鍵印出 ctx (探索選單用)
X.keys = ks => { for (const k of ks) X.step([k]); return X.ctx; };
// 離開建築: 對話按 Enter, 選單按 Esc, 直到回到街上
X.out = (max = 8) => { for (let i = 0; i < max && X.ctx !== "walk"; i++) X.step([X.ctx === "wait" ? K.enter : K.esc]); return X.ctx; };
})();
