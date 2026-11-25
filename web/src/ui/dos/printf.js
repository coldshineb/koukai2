// printf.js — 原版格式化输出 (MAIN.EXE seg0:4194), 逐字符送给 putc 回呼
// 支持: %[-][0][宽度][.精度][l](c|d|s|u|w), 转换字符不分大小写; 其他字符原样输出。
//   %w = 以全角数字输出 (每位 0x82, 0x4F+d) —— 日文版遗留, 繁中字体中为空白
//   精度只对 %s 有效 (截断); 负数的 '-' 在补齐字符之后 (例: %05d of -3 -> "000-3")
// args: 数值或字节数组 (字符串)。%ld 取一个数值 (原版占 2 个 word)。
function udigits(v) { return String(v >>> 0).split("").map(c => c.charCodeAt(0)); }
// seg0:40a1 长整数输出: 以「有号」比较判断是否 >= 10, 所以最高比特为 1 的值 (>= 2^31) 只输出一个字符 '0'+低字节
function ldigits(v) {
  v |= 0;
  const out = [];
  const rec = x => {
    if ((x >> 16) < 0 || (x < 10 && (x >> 16) === 0)) { out.push((0x30 + (x & 0xff)) & 0xff); return; }
    rec(Math.trunc(x / 10)); rec(x % 10);
  };
  rec(v); return out;
}
function wdigits(v) { const out = []; for (const c of String(v & 0xffff)) out.push(0x82, 0x4f + (c.charCodeAt(0) - 0x30)); return out; }

export function cprintf(fmt, args, putc) {
  let ai = 0, i = 0;
  const next = () => args[ai++];
  while (i < fmt.length) {
    let ch = fmt[i++];
    if (ch === 0) break;
    if (ch !== 0x25) { putc(ch); continue; }
    let prec = 6, isLong = 0, precFlag = 0, left = 0;
    if (fmt[i] === 0x2d) { i++; left = 1; }
    const pad = fmt[i] === 0x30 ? 0x30 : 0x20;
    let width = 0;
    if (fmt[i] >= 0x30 && fmt[i] <= 0x39) { while (fmt[i] - 0x30 < 10 && fmt[i] >= 0x30) width = (width * 10 + (fmt[i++] - 0x30)) & 0xffff; }
    ch = fmt[i++];
    if (ch === 0x2e) { prec = 0; while (fmt[i] - 0x30 < 10 && fmt[i] >= 0x30) prec = (prec * 10 + (fmt[i++] - 0x30)) & 0xffff; precFlag = 1; ch = fmt[i++]; }
    if (ch === 0x6c) { isLong = 1; ch = fmt[i++]; }
    const up = (ch >= 0x61 && ch <= 0x7a) ? ch - 0x20 : ch;
    if (up === 0) break;
    let buf, si = width, isStr = false;
    switch (up) {
      case 0x43: buf = [next() & 0xff]; si = width - 1; break;                    // C
      case 0x44: {                                                                // D
        let v = next(); buf = [];
        if (isLong) { v |= 0; if (v < 0) { buf.push(0x2d); si--; v = -v | 0; } buf.push(...ldigits(v)); }
        else { v = (v << 16) >> 16; if (v < 0) { buf.push(0x2d); si--; v = -v & 0xffff; } buf.push(...String(v & 0xffff).split("").map(c => c.charCodeAt(0))); }
        si -= buf.length - (buf[0] === 0x2d ? 1 : 0); break; }
      case 0x55: { const v = next(); buf = isLong ? ldigits(v) : String(v & 0xffff).split("").map(c => c.charCodeAt(0)); si -= buf.length; break; }  // U
      case 0x53: { const s = next(); let n = 0; while (n < s.length && s[n]) n++; buf = Array.from(s.subarray ? s.subarray(0, n) : s.slice(0, n)); si = width - n; isStr = true; break; }  // S
      case 0x57: buf = wdigits(next()); si -= buf.length; break;                  // W
      default: putc(fmt[i - 1]); continue;                                         // 原版输出原字符
    }
    if (!isStr) precFlag = 0;
    if (!left) while (si-- > 0) putc(pad);
    for (const b of buf) { if (!precFlag || prec > 0) putc(b); prec--; }
    if (left) while (si-- > 0) putc(0x20);
  }
}
