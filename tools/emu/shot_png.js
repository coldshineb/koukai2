// shot_png.js — 测试辅助: 把 port_tests 的画面 (session.lastRun.E/J.shots[i]) 存成 PNG, 以便核对分支 / 拼图
//   S.png(shot, 文件名, emu = true)          单张 (emu: dac 为 6 比特 RGB; 移植版: dac 为 4 比特 B,R,G)
//   S.sheet(shots, 索参数组, 文件名, emu, 栏数) 缩小一半的拼图
(function () {
const S = session, { createCanvas } = require("canvas"), fs = require("fs");
const rgb = (shot, k, emu) => {
  const d = shot.dac;
  if (emu) { const c = v => (v << 2) | (v >> 4); return [c(d[k * 3]), c(d[k * 3 + 1]), c(d[k * 3 + 2])]; }
  const c = v => { const v6 = v * 4; return (v6 << 2) | (v6 >> 4); }; return [c(d[k * 3 + 1]), c(d[k * 3 + 2]), c(d[k * 3])];
};
S.png = (shot, file, emu = true) => {
  const cv = createCanvas(640, 400), x = cv.getContext("2d"), im = x.createImageData(640, 400);
  for (let i = 0; i < 640 * 400; i++) { const [r, g, b] = rgb(shot, shot.fb[i] & 15, emu); im.data.set([r, g, b, 255], i * 4); }
  x.putImageData(im, 0, 0); fs.writeFileSync(file, cv.toBuffer("image/png"));
};
S.sheet = (shots, idx, file, emu = true, cols = 4) => {
  const rows = Math.ceil(idx.length / cols), cv = createCanvas(320 * cols, 200 * rows), x = cv.getContext("2d"), im = x.createImageData(320 * cols, 200 * rows);
  idx.forEach((n, k) => {
    const sh = shots[n]; if (!sh || !sh.fb) return;
    const ox = (k % cols) * 320, oy = Math.floor(k / cols) * 200;
    for (let y = 0; y < 200; y++) for (let xx = 0; xx < 320; xx++) { const [r, g, b] = rgb(sh, sh.fb[(y * 2) * 640 + xx * 2] & 15, emu); im.data.set([r, g, b, 255], ((oy + y) * 320 * cols + ox + xx) * 4); }
  });
  x.putImageData(im, 0, 0); fs.writeFileSync(file, cv.toBuffer("image/png"));
};
})();
