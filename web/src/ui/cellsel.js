// cellsel.js — 地图格光标选择 (MAIN.EXE 0fea:5f74 = 线性 15e14 及其子函数 15b71 / 15cb1 / 15d5d / 15d76)
// 调用: select(x0, y0, cols, w, h, rows, init) — 原版 15e14(AX = x0, DX = y0, BX = 栏数, 堆栈: 列数, 格宽, 格高, 起始格)
//   格宽 < 0 ([bb02] = 1): 光标 1 格 (换行时退 1); 否则 2 × 2 格 (换行时退 2)。返回格编号 (列 × 栏数 + 栏), Esc / '0' / 点在范围外 = -1
//   格宽 < 8 像素: 光标 = 2 × 2 格大小的 XOR 外框 (1fd9:1fed, 色 7), 另在左方 0x21c 像素 (= 90 格 × 6, 世界地图一圈) 再画一个 (横向环绕);
//     两者都受剪裁矩形 DS:aaac (1fd9:18de, = 选择范围) 限制
//   格宽 >= 8: 光标 = [0c86]+0x3820 的 32 × 32 点阵 (模式 4 色 7), 画前以 50c4 保存底下画面, 擦除时 7a8e 还原 ([a239] 交替)
// 与菜单引擎共用的状态: cur = a160, prev = a15a, hit = a150, mouseFlag = a14e, lastX/lastY = bd9a / bd9c (此处存鼠标所在格)
// 原版怪行为 (照搬): 上下换行固定以「列数 − 2」计算 (与光标大小无关), 所以最后一列永远走不到; 鼠标所在格先减 1 格 (光标左上角),
//   2 × 2 模式时最右栏换成「栏数」(= 不命中), 1 格模式时 −1 换成最右栏; 列的命中范围是 0..列数 − 2
const csTdiv8 = v => (v < 0 ? -((-v) >> 3) : v >> 3);                // cwd / xor / sar 3: 向零取整

export class CellSelect {
  constructor(ctx) { this.c = ctx; this.a239 = 0; }
  get m() { return this.c.menu; }
  // 0fea:5f74 = 15e14
  async select(x0, y0, cols, w, h, rows, init) {
    const { sys } = this.c, m = this.m;
    this.one = w < 0 ? 1 : 0;                                          // [bb02]
    const span = this.one ? 1 : 2;                                     // [bp-2]
    this.x0 = x0; this.y0 = y0; this.cols = cols; this.rows = rows;    // [bb08] [bb0a] [bafe] [bb00]
    this.w = Math.abs(w); this.h = h;                                  // [bb0c] [bb0e]
    this.x1 = this.w * cols + x0; this.y1 = rows * h + y0;             // [bb04] [bb06]
    this.a239 = 0;
    await m.waitRelease();                                             // 131e3
    this.c.clip = [x0, y0, this.x1 - 1, this.y1 - 1];                  // 1fd9:18de = 2166e 剪裁矩形 DS:aaac
    m.prev = 0xffff; m.cur = init;                                     // [a15a] [a160]
    this.draw();                                                       // 15b71
    sys.mouseShow();
    let k;
    for (;;) {
      k = await this.getKey();                                         // 15d76
      if (k === 0x1b || k === 0x30 || k === 0x0d) break;
      m.prev = m.cur;
      const c = m.cur % cols;                                          // idiv (cur >= 0)
      switch (k) {
        case 0x1c: case 0x36: m.cur += cols - span > c ? 1 : span - cols; break;
        case 0x1d: case 0x34: m.cur += c > 0 ? -1 : cols - span; break;
        case 0x1e: case 0x38: m.cur += m.cur >= cols ? -cols : (rows - 2) * cols; break;
        case 0x1f: case 0x32: m.cur += (rows - 2) * cols > m.cur ? cols : (2 - rows) * cols; break;
      }
      if (m.cur !== m.prev) this.move();                               // 15d5d
      sys.flush();                                                     // 3fae
    }
    sys.mouseHide();
    this.draw();
    this.c.clip = [0, 0, 0x27f, 0x18f];                                // 1fd9:18de(0, 0, 0x27f, 0x18f)
    return k === 0x1b || k === 0x30 ? -1 : m.cur;
  }
  // 15b71 画 / 擦光标 (第 cur 格)
  draw() {
    const { sys, scr, win, gfx } = this.c, m = this.m;
    sys.mouseHide();
    const col = m.cur % this.cols, row = Math.trunc(m.cur / this.cols);
    if (this.w < 8) {
      const xa = this.w * col + this.x0, ya = this.h * row + this.y0, xb = (col + 2) * this.w + this.x0 - 1, yb = (row + 2) * this.h + this.y0 - 1;
      scr.xorRect(xa, ya, xb, yb, 7, this.c.clip);                     // 1fd9:1fed
      scr.xorRect(xa - 0x21c, ya, xb - 0x21c, yb, 7, this.c.clip);
    } else if ((this.a239 ^= 1)) {
      const x = csTdiv8(col * this.w + this.x0), y = row * this.h + this.y0;
      win.save(x, y, 4, 0x20);                                         // seg0:50c4
      scr.glyphMode(x, y, 4, 0x20, gfx.subarray(0x3820), 0x407);       // seg0:063e
    } else win.closeNow();                                             // seg0:7a8e
    sys.mouseShow();
  }
  // 15d5d 在旧位置 (prev) 擦掉、新位置画上
  move() { const m = this.m, si = m.cur; m.cur = m.prev; this.draw(); m.cur = si; this.draw(); }
  // 15cb1 鼠标命中: 所在格 − 1 (光标左上角)
  hitTest() {
    const m = this.m, { x, y } = this.c.sys.mousePos();
    let col = Math.trunc((x - this.x0 - this.w) / this.w), row = Math.trunc((y - this.y0 - this.h) / this.h);
    if (!this.one) { if (this.cols - col - 1 === 0) col = this.cols; }
    else if (col === -1) col = this.cols - 1;
    if (col === m.lastX && row === m.lastY) return;
    m.lastY = row; m.lastX = col;
    if (col >= 0 && this.cols > col && row >= 0 && this.rows - 1 > row) { m.cur = this.cols * row + col; m.hit = 1; } else m.hit = 0;
  }
  // 15d76 取得按键: 鼠标按住时光标跟着移动; 点在范围外 = Esc
  async getKey() {
    const { sys } = this.c, m = this.m;
    m.lastX = m.lastY = -1;
    for (;;) {
      sys.rng.random(100);
      const k = m.readEvent();                                         // 1320c
      if (m.mouseFlag && k === 0x0d) {
        for (;;) {
          m.prev = m.cur;
          this.hitTest();
          if (m.cur !== m.prev) this.move();
          if (!sys.mouseAny()) break;                                  // seg0:507e
          await sys.poll();
        }
      }
      if (!k || (m.mouseFlag && !m.hit && k === 0x0d)) { await sys.poll(); continue; }
      if (m.mouseFlag) {
        const { x, y } = sys.mousePos();                               // seg0:4efa
        if (this.x0 > x || this.x1 <= x || this.y0 > y || this.y1 <= y) return 0x1b;
      }
      return k;
    }
  }
}
