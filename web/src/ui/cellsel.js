// cellsel.js — 地圖格游標選擇 (MAIN.EXE 0fea:5f74 = 線性 15e14 及其子函式 15b71 / 15cb1 / 15d5d / 15d76)
// 呼叫: select(x0, y0, cols, w, h, rows, init) — 原版 15e14(AX = x0, DX = y0, BX = 欄數, 堆疊: 列數, 格寬, 格高, 起始格)
//   格寬 < 0 ([bb02] = 1): 游標 1 格 (換行時退 1); 否則 2 × 2 格 (換行時退 2)。回傳格編號 (列 × 欄數 + 欄), Esc / '0' / 點在範圍外 = -1
//   格寬 < 8 像素: 游標 = 2 × 2 格大小的 XOR 外框 (1fd9:1fed, 色 7), 另在左方 0x21c 像素 (= 90 格 × 6, 世界地圖一圈) 再畫一個 (橫向環繞);
//     兩者都受剪裁矩形 DS:aaac (1fd9:18de, = 選擇範圍) 限制
//   格寬 >= 8: 游標 = [0c86]+0x3820 的 32 × 32 點陣 (模式 4 色 7), 畫前以 50c4 保存底下畫面, 擦除時 7a8e 還原 ([a239] 交替)
// 與選單引擎共用的狀態: cur = a160, prev = a15a, hit = a150, mouseFlag = a14e, lastX/lastY = bd9a / bd9c (此處存滑鼠所在格)
// 原版怪行為 (照搬): 上下換行固定以「列數 − 2」計算 (與游標大小無關), 所以最後一列永遠走不到; 滑鼠所在格先減 1 格 (游標左上角),
//   2 × 2 模式時最右欄換成「欄數」(= 不命中), 1 格模式時 −1 換成最右欄; 列的命中範圍是 0..列數 − 2
const csTdiv8 = v => (v < 0 ? -((-v) >> 3) : v >> 3);                // cwd / xor / sar 3: 向零取整

export class CellSelect {
  constructor(ctx) { this.c = ctx; this.a239 = 0; }
  get m() { return this.c.menu; }
  // 0fea:5f74 = 15e14
  async select(x0, y0, cols, w, h, rows, init) {
    const { sys, scr } = this.c, m = this.m;
    if (scr.wideRenderer && cols === 0x18 && rows === 0x18 && scr._wideSeaCam) {
      return this.selectWideSea(init);
    }
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
  // 16:9 寬螢幕海面目標格選擇 (偵察 / 指定目的地等 24×24 視窗)
  async selectWideSea(init) {
    const { sys, scr } = this.c, m = this.m;
    const cols = 0x18, rows = 0x18, span = 2;
    await m.waitRelease();
    let cur = Math.max(0, Math.min((rows - 2) * cols + (cols - span), init | 0));
    const promptText = this.widePrompt || "";
    this.widePrompt = "";

    const cellToScreen = idx => {
      const cam = scr._wideSeaCam;
      if (!cam) return null;
      const col = idx % cols, row = Math.trunc(idx / cols);
      let dx = (cam.vx1006 + col) - cam.baseWX;
      if (dx < -cam.worldW / 2) dx += cam.worldW;
      else if (dx > cam.worldW / 2) dx -= cam.worldW;
      const dy = (cam.vy1008 + row) - cam.baseWY;
      return {
        x: (dx - cam.camX) * cam.tile,
        y: (dy - cam.camY) * cam.tile,
        size: cam.tile * 2,
      };
    };

    const screenToCell = (vx, vy) => {
      const cam = scr._wideSeaCam;
      if (!cam || vx < 0 || vy < 0 || vx >= 1280 || vy >= 720) return -1;
      const mx = cam.camX + Math.floor(vx / cam.tile);
      const my = cam.camY + Math.floor(vy / cam.tile);
      const wx = cam.baseWX + mx;
      const wy = cam.baseWY + my;
      let col = wx - cam.vx1006;
      if (col < -cam.worldW / 2) col += cam.worldW;
      else if (col > cam.worldW / 2) col -= cam.worldW;
      const row = wy - cam.vy1008;
      if (col < 0 || col > cols - span || row < 0 || row > rows - span) return -1;
      return row * cols + col;
    };

    const drawFn = ctx => {
      const box = cellToScreen(cur);
      ctx.save();
      if (box) {
        const { x, y, size } = box;
        const pulse = 0.72 + 0.28 * Math.sin(performance.now() * 0.008);
        ctx.fillStyle = `rgba(245, 200, 92, ${(0.18 * pulse).toFixed(3)})`;
        ctx.fillRect(x, y, size, size);
        ctx.strokeStyle = `rgba(255, 224, 130, ${(0.95 * pulse).toFixed(3)})`;
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 1.5, y + 1.5, size - 3, size - 3);
        // 四角瞄準括號
        const cl = 14;
        ctx.strokeStyle = "#fff4cc";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x - 2, y + cl); ctx.lineTo(x - 2, y - 2); ctx.lineTo(x + cl, y - 2);
        ctx.moveTo(x + size - cl, y - 2); ctx.lineTo(x + size + 2, y - 2); ctx.lineTo(x + size + 2, y + cl);
        ctx.moveTo(x - 2, y + size - cl); ctx.lineTo(x - 2, y + size + 2); ctx.lineTo(x + cl, y + size + 2);
        ctx.moveTo(x + size - cl, y + size + 2); ctx.lineTo(x + size + 2, y + size + 2); ctx.lineTo(x + size + 2, y + size - cl);
        ctx.stroke();
      }
      if (promptText) {
        ctx.font = '700 15px "Microsoft YaHei UI", "PingFang SC", "Noto Sans SC", sans-serif';
        const tw = ctx.measureText(promptText).width;
        const pw = tw + 36, ph = 38, px = (1280 - pw) / 2, py = 20;
        ctx.fillStyle = "rgba(246, 236, 212, 0.96)";
        ctx.strokeStyle = "#9c7432";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(px, py, pw, ph, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#3d2817";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(promptText, 640, py + ph / 2);
      }
      ctx.restore();
    };

    scr.wideOverlays.push(drawFn);
    scr.dirty = true;
    sys.mouseShow();
    let result = -1;
    let lastVx = -1, lastVy = -1;
    try {
      for (;;) {
        const vx = sys.mouse?.vx ?? -1;
        const vy = sys.mouse?.vy ?? -1;
        if (vx !== lastVx || vy !== lastVy) {
          lastVx = vx; lastVy = vy;
          const hov = screenToCell(vx, vy);
          if (hov >= 0 && hov !== cur) {
            cur = hov;
            scr.dirty = true;
          }
        }
        const k = m.readEvent();
        if (k === 0x1b || k === 0x30) { result = -1; break; }
        if (k === 0x0d) {
          if (m.mouseFlag) {
            const hov = screenToCell(vx, vy);
            if (hov >= 0) { cur = hov; result = cur; break; }
            result = -1; break;
          }
          result = cur; break;
        }
        const c = cur % cols;
        if (k === 0x1c || k === 0x36) cur += cols - span > c ? 1 : span - cols;
        else if (k === 0x1d || k === 0x34) cur += c > 0 ? -1 : cols - span;
        else if (k === 0x1e || k === 0x38) cur += cur >= cols ? -cols : (rows - 2) * cols;
        else if (k === 0x1f || k === 0x32) cur += (rows - 2) * cols > cur ? cols : (2 - rows) * cols;
        scr.dirty = true;
        await sys.poll();
      }
    } finally {
      const idx = scr.wideOverlays.indexOf(drawFn);
      if (idx >= 0) scr.wideOverlays.splice(idx, 1);
      scr.dirty = true;
      await m.waitRelease();
      sys.mouseHide();
    }
    return result;
  }
  // 15b71 畫 / 擦游標 (第 cur 格)
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
  // 15d5d 在舊位置 (prev) 擦掉、新位置畫上
  move() { const m = this.m, si = m.cur; m.cur = m.prev; this.draw(); m.cur = si; this.draw(); }
  // 15cb1 滑鼠命中: 所在格 − 1 (游標左上角)
  hitTest() {
    const m = this.m, { x, y } = this.c.sys.mousePos();
    let col = Math.trunc((x - this.x0 - this.w) / this.w), row = Math.trunc((y - this.y0 - this.h) / this.h);
    if (!this.one) { if (this.cols - col - 1 === 0) col = this.cols; }
    else if (col === -1) col = this.cols - 1;
    if (col === m.lastX && row === m.lastY) return;
    m.lastY = row; m.lastX = col;
    if (col >= 0 && this.cols > col && row >= 0 && this.rows - 1 > row) { m.cur = this.cols * row + col; m.hit = 1; } else m.hit = 0;
  }
  // 15d76 取得按鍵: 滑鼠按住時游標跟著移動; 點在範圍外 = Esc
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
