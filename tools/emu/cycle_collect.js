// cycle_collect.js — 在 cycle_measure.js (S.CM.features = 1) + port_tests.js 之后运行: 把对齐的事件段整理成拟合数据
//   每段 = 两个相邻事件之间: 原版周期数 (cycles.js) 与 移植版各方法的调用次数差; 也记录各段的移植版模型周期 (验证用)
//   S.CM_OUT = 输出档 (JSON 行: {route, names, rows: [[原版周期, 模型周期, 事件种类, [特征 id, 次数, ...]], ...], mism})
"use strict";
(function () {
const S = session, fs = require("fs");
const log = S.cmLog, R = S.cmReport();
const E = log.E, J = log.J, F = R.jfeat;
// 依 "K" 分组, 组内事件种类一致才使用
const groups = a => { const g = [[]]; a.forEach((e, i) => { if (e[0] === "K") g.push([]); else g[g.length - 1].push(i); }); return g; };
const gE = groups(E), gJ = groups(J);
const rows = []; let bad = 0, used = 0;
for (let k = 0; k < Math.min(gE.length, gJ.length); k++) {
  const a = gE[k], b = gJ[k];
  if (a.length !== b.length || a.some((ie, t) => E[ie][0] !== J[b[t]][0])) { bad++; continue; }
  used++;
  for (let t = 1; t < a.length; t++) {
    const ie0 = a[t - 1], ie = a[t], ij0 = b[t - 1], ij = b[t];
    // 特征 = ij0+1 .. ij 之间所有事件 (含 K) 的差的总和
    const acc = new Map();
    for (let q = ij0 + 1; q <= ij; q++) { const d = F[q]; for (let z = 0; z < d.length; z += 2) acc.set(d[z], (acc.get(d[z]) || 0) + d[z + 1]); }
    const fv = []; for (const [id, n] of acc) fv.push(id, n);
    rows.push([E[ie][1] - E[ie0][1], J[ij][1] - J[ij0][1], E[ie][0], fv]);
  }
}
const out = { route: S.CM_ROUTE || "?", names: R.featNames, rows, groups: [used, bad], totalE: R.totalE };
fs.writeFileSync(S.CM_OUT, JSON.stringify(out));
console.log(`[collect] ${out.route}: rows ${rows.length}, groups used ${used} / mismatched ${bad}, totalE ${R.totalE}`);
})();
