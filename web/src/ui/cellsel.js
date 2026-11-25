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
  // 16:9 宽屏幕海面目标格选择 (侦察 / 指定目的地等 24×24 窗口)
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

    const screenToCell = (vx, vy, clampToRange = false) => {
      const cam = scr._wideSeaCam;
      if (!cam || vx < 0 || vy < 0 || vx >= 1280 || vy >= 720) return -1;
      // 以光标为 2×2 瞄准框中心（减去半格偏移，点在船/港任意位置都能精准命中）
      const mx = cam.camX + Math.floor((vx - cam.tile * 0.5) / cam.tile);
      const my = cam.camY + Math.floor((vy - cam.tile * 0.5) / cam.tile);
      const wx = cam.baseWX + mx;
      const wy = cam.baseWY + my;
      let col = wx - cam.vx1006;
      if (col < -cam.worldW / 2) col += cam.worldW;
      else if (col > cam.worldW / 2) col -= cam.worldW;
      let row = wy - cam.vy1008;
      if (clampToRange) {
        col = Math.max(0, Math.min(cols - span, col));
        row = Math.max(0, Math.min(rows - span, row));
        return row * cols + col;
      }
      if (col < 0 || col > cols - span || row < 0 || row > rows - span) return -1;
      return row * cols + col;
    };

    const drawFn = ctx => {
      const box = cellToScreen(cur);
      ctx.save();
      // 淡金虚线标出 24×24 有效侦察/指定范围
      const tl = cellToScreen(0);
      if (tl && scr._wideSeaCam) {
        const rangePx = cols * scr._wideSeaCam.tile;
        ctx.strokeStyle = "rgba(230, 198, 124, 0.35)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([8, 6]);
        ctx.strokeRect(tl.x, tl.y, rangePx, rangePx);
        ctx.setLineDash([]);
      }
      if (box) {
        const { x, y, size } = box;
        const pulse = 0.72 + 0.28 * Math.sin(performance.now() * 0.008);
        ctx.fillStyle = `rgba(245, 200, 92, ${(0.18 * pulse).toFixed(3)})`;
        ctx.fillRect(x, y, size, size);
        ctx.strokeStyle = `rgba(255, 224, 130, ${(0.95 * pulse).toFixed(3)})`;
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 1.5, y + 1.5, size - 3, size - 3);
        // 四角瞄准括号
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
      ctx.restore();
    };

    // 使用原生 DOM 羊皮纸提示牌显示「请指定目的地」等文字，避免画在 Canvas 上被拉伸变扁发糊
    let promptEl = null;
    if (promptText && typeof document !== "undefined" && document.body) {
      promptEl = document.createElement("div");
      promptEl.className = "uw2-card";
      promptEl.style.cssText =
        "position:fixed;top:56px;left:50%;transform:translateX(-50%);z-index:60;pointer-events:none;" +
        "padding:8px 22px;border-radius:8px;font-size:16px;font-weight:700;color:var(--uw2-ink);" +
        "box-shadow:0 6px 20px rgba(0,0,0,0.35);white-space:nowrap;";
      promptEl.textContent = promptText;
      document.body.appendChild(promptEl);
    }

    // 直接监听 canvas 鼠标移动与左/右键点击，确保浏览器中 100% 实时响应（不依赖轮询时机）
    const canvas = scr.canvas;
    let clickResult = null;
    const clientToView = e => {
      if (!canvas) return { vx: -1, vy: -1 };
      const r = canvas.getBoundingClientRect();
      return {
        vx: Math.max(0, Math.min(1279, Math.floor(((e.clientX - r.left) * 1280) / r.width))),
        vy: Math.max(0, Math.min(719, Math.floor(((e.clientY - r.top) * 720) / r.height))),
      };
    };
    const onMove = e => {
      const { vx, vy } = clientToView(e);
      const hov = screenToCell(vx, vy, true);
      if (hov >= 0 && hov !== cur) {
        cur = hov;
        scr.dirty = true;
      }
    };
    const onDown = e => {
      if (e.button === 2) { clickResult = -1; e.preventDefault(); return; }
      if (e.button === 0) {
        const { vx, vy } = clientToView(e);
        const hov = screenToCell(vx, vy, true);
        if (hov >= 0) cur = hov;
        clickResult = cur;
        e.preventDefault();
      }
    };
    canvas?.addEventListener("mousemove", onMove);
    canvas?.addEventListener("mousedown", onDown);

    scr.wideOverlays.push(drawFn);
    scr.dirty = true;
    sys.mouseShow();
    let result = -1;
    let lastVx = -1, lastVy = -1;
    try {
      for (;;) {
        if (clickResult !== null) { result = clickResult; break; }
        const vx = sys.mouse?.vx ?? -1;
        const vy = sys.mouse?.vy ?? -1;
        if (vx !== lastVx || vy !== lastVy) {
          lastVx = vx; lastVy = vy;
          const hov = screenToCell(vx, vy, true);
          if (hov >= 0 && hov !== cur) {
            cur = hov;
            scr.dirty = true;
          }
        }
        const k = m.readEvent();
        if (k === 0x1b || k === 0x30) { result = -1; break; }
        if (k === 0x0d) {
          if (m.mouseFlag) {
            const hov = screenToCell(vx, vy, true);
            if (hov >= 0) cur = hov;
            result = cur; break;
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
      promptEl?.remove();
      canvas?.removeEventListener("mousemove", onMove);
      canvas?.removeEventListener("mousedown", onDown);
      const idx = scr.wideOverlays.indexOf(drawFn);
      if (idx >= 0) scr.wideOverlays.splice(idx, 1);
      scr.dirty = true;
      await m.waitRelease();
      if (sys.mouse) sys.mouse.lastClick = null;
      sys.flush();
      sys.mouseHide();
    }
    return result;
  }
  // 16:9 全视口海面目标格选择（无 24×24 正方形框限制，全屏幕任意可见海面/港口/舰队皆可点击）
  async selectWideSeaWorld(initWX, initWY) {
    const { sys, scr } = this.c, m = this.m;
    const cam = scr._wideSeaCam;
    if (!cam) return null;
    await m.waitRelease();
    const viewCols = cam.viewCols ?? 40;
    const viewRows = cam.viewRows ?? 23;
    const worldW = cam.worldW ?? 0x870;
    const worldH = cam.worldH ?? 0x438;
    const maxCol = viewCols - 2;
    const maxRow = viewRows - 2;

    let initCol = initWX - cam.baseWX;
    if (initCol < -worldW / 2) initCol += worldW;
    else if (initCol > worldW / 2) initCol -= worldW;
    let curCol = Math.max(0, Math.min(maxCol, initCol | 0));
    let curRow = Math.max(0, Math.min(maxRow, (initWY - cam.baseWY) | 0));

    const promptText = this.widePrompt || "";
    this.widePrompt = "";

    const drawFn = ctx => {
      const x = curCol * cam.tile;
      const y = curRow * cam.tile;
      const size = cam.tile * 2;
      const pulse = 0.72 + 0.28 * Math.sin(performance.now() * 0.008);
      ctx.save();
      ctx.fillStyle = `rgba(245, 200, 92, ${(0.18 * pulse).toFixed(3)})`;
      ctx.fillRect(x, y, size, size);
      ctx.strokeStyle = `rgba(255, 224, 130, ${(0.95 * pulse).toFixed(3)})`;
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 1.5, y + 1.5, size - 3, size - 3);
      const cl = 14;
      ctx.strokeStyle = "#fff4cc";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x - 2, y + cl); ctx.lineTo(x - 2, y - 2); ctx.lineTo(x + cl, y - 2);
      ctx.moveTo(x + size - cl, y - 2); ctx.lineTo(x + size + 2, y - 2); ctx.lineTo(x + size + 2, y + cl);
      ctx.moveTo(x - 2, y + size - cl); ctx.lineTo(x - 2, y + size + 2); ctx.lineTo(x + cl, y + size + 2);
      ctx.moveTo(x + size - cl, y + size + 2); ctx.lineTo(x + size + 2, y + size + 2); ctx.lineTo(x + size + 2, y + size - cl);
      ctx.stroke();
      ctx.restore();
    };

    let promptEl = null;
    if (promptText && typeof document !== "undefined" && document.body) {
      promptEl = document.createElement("div");
      promptEl.className = "uw2-card";
      promptEl.style.cssText =
        "position:fixed;top:56px;left:50%;transform:translateX(-50%);z-index:60;pointer-events:none;" +
        "padding:8px 22px;border-radius:8px;font-size:16px;font-weight:700;color:var(--uw2-ink);" +
        "box-shadow:0 6px 20px rgba(0,0,0,0.35);white-space:nowrap;";
      promptEl.textContent = promptText;
      document.body.appendChild(promptEl);
    }

    const canvas = scr.canvas;
    let clickResult = null;
    const clientToView = e => {
      if (!canvas) return { vx: -1, vy: -1 };
      const r = canvas.getBoundingClientRect();
      return {
        vx: Math.max(0, Math.min(1279, Math.floor(((e.clientX - r.left) * 1280) / r.width))),
        vy: Math.max(0, Math.min(719, Math.floor(((e.clientY - r.top) * 720) / r.height))),
      };
    };
    const updateFromView = (vx, vy) => {
      const nc = Math.max(0, Math.min(maxCol, Math.floor((vx - cam.tile * 0.5) / cam.tile)));
      const nr = Math.max(0, Math.min(maxRow, Math.floor((vy - cam.tile * 0.5) / cam.tile)));
      if (nc !== curCol || nr !== curRow) { curCol = nc; curRow = nr; scr.dirty = true; }
    };
    const onMove = e => { const { vx, vy } = clientToView(e); updateFromView(vx, vy); };
    const onDown = e => {
      if (e.button === 2) { clickResult = "cancel"; e.preventDefault(); return; }
      if (e.button === 0) {
        const { vx, vy } = clientToView(e);
        updateFromView(vx, vy);
        clickResult = "ok";
        e.preventDefault();
      }
    };
    canvas?.addEventListener("mousemove", onMove);
    canvas?.addEventListener("mousedown", onDown);

    scr.wideOverlays.push(drawFn);
    scr.dirty = true;
    sys.mouseShow();
    let ok = false;
    try {
      for (;;) {
        if (clickResult === "cancel") { ok = false; break; }
        if (clickResult === "ok") { ok = true; break; }
        const k = m.readEvent();
        if (k === 0x1b || k === 0x30) { ok = false; break; }
        if (k === 0x0d) { ok = true; break; }
        if (k === 0x1c || k === 0x36) curCol = curCol < maxCol ? curCol + 1 : 0;
        else if (k === 0x1d || k === 0x34) curCol = curCol > 0 ? curCol - 1 : maxCol;
        else if (k === 0x1e || k === 0x38) curRow = curRow > 0 ? curRow - 1 : maxRow;
        else if (k === 0x1f || k === 0x32) curRow = curRow < maxRow ? curRow + 1 : 0;
        scr.dirty = true;
        await sys.poll();
      }
    } finally {
      promptEl?.remove();
      canvas?.removeEventListener("mousemove", onMove);
      canvas?.removeEventListener("mousedown", onDown);
      const idx = scr.wideOverlays.indexOf(drawFn);
      if (idx >= 0) scr.wideOverlays.splice(idx, 1);
      scr.dirty = true;
      await m.waitRelease();
      if (sys.mouse) sys.mouse.lastClick = null;
      sys.flush();
      sys.mouseHide();
    }
    if (!ok) return null;
    const wx = (((cam.baseWX + curCol) % worldW) + worldW) % worldW;
    const wy = Math.max(0, Math.min(worldH - 1, cam.baseWY + curRow));
    return { wx, wy };
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
