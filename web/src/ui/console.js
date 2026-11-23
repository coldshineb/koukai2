// console.js — 原版文字輸出系統 (MAIN.EXE seg0:49bd putc / 4b9c puts / 4965 換行 / 4988 控制碼)
// 狀態變數與原版 DS 位址對照:
//   x=8a1a (欄, 0..79)  y=8a1c (像素, 0..400)  lineH=8a1e  left=8a20  right=8a22
//   mode=8a26 (ESC M)   fg=8a27 (ESC C)        bg=8a28 (ESC B)  f29=8a29 (ESC F)
//   lead=8a2a (雙位元組首碼暫存)  esc=8a2c (跳脫序列狀態)
// 跳脫序列 (0x1B 開頭):
//   ESC = y x   游標 y=(y-0x20)*8, x=x-0x20      ESC C n  前景色 (0..7)
//   ESC B n     不透明背景色 (0=關)               ESC M n  繪製模式 (0 黑底/1 XOR/2 AND/3 OR/4 透明)
//   ESC R c     左邊界 = c-0x20                   ESC F n  (8a29)
//   ESC W       等待 (seg0:59c1)
export class TextConsole {
  constructor(scr, font, hooks = {}) { this.scr = scr; this.font = font; this.hooks = hooks; this.reset(); }
  // DS:8a1a.. 的初始值
  reset() {
    this.x = 0; this.y = 0; this.lineH = 0x18; this.left = 0; this.right = 0x4f;
    this.mode = 0; this.fg = 7; this.bg = 0; this.f29 = 0; this.lead = 0; this.esc = 0;
    this.mono = false;
  }
  // seg0:43f9 游標夾限
  clamp() {
    this.x = this.x < 0 ? 0 : Math.min(this.x, 0x4f);
    this.y = this.y < 0 ? 0 : Math.min(this.y, 0x190);
  }
  setCursor(x, y) { if (x >= 0) this.x = x; if (y >= 0) this.y = y; this.clamp(); }  // seg0:443c
  setColor(c) { if (c <= 7) this.fg = c; }                                                // seg0:4450
  // seg0:4965 換行: 已在行首時不動作
  newline() {
    if (this.x === this.left) return;
    this.x = this.left;
    if (this.y + this.lineH <= 0x190) this.y += this.lineH;
  }
  control(ch) {                                                                         // seg0:4988
    switch (ch) {
      case 0x07: this.hooks.beep?.(); break;
      case 0x08: if (this.x >= 1) this.x--; break;
      case 0x0a: this.newline(); break;
      case 0x0d: this.x = this.left; break;
    }
  }
  // seg0:46e0 畫一個字 (code<0x200 為半形)
  drawChar(code) {
    const s = this.scr, cw = this.fg, ch = this.bg || this.mode;
    if (code < 0x200) {
      const rows = this.font.asciiRows(code & 0xff);
      if (this.bg) s.glyph(this.x, this.y, 1, 16, rows, cw, 0, ch); else s.glyph(this.x, this.y, 1, 16, rows, cw, ch, 0);
    } else if ((code >= 0x8130 && code <= 0xaf68) || (code >= 0xb030 && code <= 0xd8c3)) {
      const rows = this.font.kanjiRows(code);
      if (this.bg) s.glyph(this.x, this.y, 2, 14, rows, cw, 0, ch); else s.glyph(this.x, this.y, 2, 14, rows, cw, ch, 0);
    }
  }
  // seg0:46e0 直接呼叫: 在 (col, y) 畫字碼 code, 屬性字 attr 由呼叫端指定 (不經游標/顏色狀態)
  //   依目前 [8a28] (bg) 選擇繪製函式 DS:8a78 表: bg=0 → seg0:0636 (高位元組=模式, 低位元組=顏色),
  //   bg≠0 → seg0:0653 不透明 (高位元組=背景色, 低位元組=前景色)
  drawCharAt(col, y, attr, code) {
    const s = this.scr, hi = (attr >> 8) & 0xff, lo = attr & 0xff;
    let rows, w, h;
    if (code >= 0x8130 && code <= 0xaf68) { rows = this.font.kanjiRows(code); w = 2; h = 14; }
    else if (code >= 0xb030 && code <= 0xd8c3) { rows = this.font.kanjiRows(code); w = 2; h = 14; }
    else if (code < 0x200) { rows = this.font.asciiRows(code & 0xff); w = 1; h = 16; }
    else return;
    if (this.bg) s.glyph(col, y, w, h, rows, lo, 0, hi);
    else {
      const t = new Uint8Array(w * h); for (let i = 0; i < t.length; i++) t[i] = rows[i];
      s.glyphMode(col, y, w, h, t, attr & 0x7fff);
    }
  }
  putc(c) {
    c &= 0xff;
    if (this.esc) return this.escape(c);
    let code;
    if (this.lead) { code = (this.lead << 8) + c; this.lead = 0; }
    else {
      if ((c >= 0x81 && c <= 0xaf) || (c >= 0xb0 && c <= 0xd8)) { this.lead = c; return; }
      if (c === 0x1b) { this.esc = 1; return; }
      if (c < 0x20) { this.control(c); return; }
      code = c;
    }
    const limit = code >= 0x200 ? 0x4e : 0x4f;
    if (limit < this.x) this.newline();
    this.drawChar(code);
    this.x += code >= 0x200 ? 2 : 1;
    if (this.x > this.right) this.newline();
  }
  escape(c) {
    switch (this.esc) {
      case 1:
        switch (c) {
          case 0x3d: this.esc = 2; return;          // '='
          case 0x42: this.esc = 7; return;          // 'B'
          case 0x43: this.esc = 4; return;          // 'C'
          case 0x46: this.esc = 8; return;          // 'F'
          case 0x4d: this.esc = 6; return;          // 'M'
          case 0x52: this.esc = 5; return;          // 'R'
          case 0x57: this.hooks.wait?.(1); this.esc = 0; return;   // 'W'
        }
        return;                                     // 原版: 其他字元不改變狀態
      case 2: this.y = (c - 0x20) * 8; this.clamp(); this.esc = 3; return;
      case 3: this.x = c - 0x20; this.clamp(); this.esc = 0; return;
      case 4: { let n = (c - 0x30) & 0xff; if (this.mono) { if (n < 4) n = 0; else if (n < 7) n = 4; } this.setColor(n); this.esc = 0; return; }
      case 5: this.left = c - 0x20; this.esc = 0; return;
      case 6: this.mode = (c - 0x30) & 0xff; this.esc = 0; return;
      case 7: this.bg = (c - 0x30) & 0xff; this.esc = 0; return;
      case 8: this.f29 = (c - 0x30) & 0xff; this.esc = 0; return;
    }
  }
  // seg0:4b9c 以 0 結尾
  puts(bytes) { for (let i = 0; i < bytes.length && bytes[i]; i++) this.putc(bytes[i]); }
  print(str) { this.puts(this.font.encode(str)); }
}
