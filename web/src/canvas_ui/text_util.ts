// canvas_ui/text_util.ts — 統一原版控制碼清理、文字擷取與高清晰度字體常數
// 精確對應 console.js 的所有 ESC 控制序列，徹底消除 64 / 01 / 51 / 2 等殘留色碼字元。
export const UI_FONT = '"Microsoft YaHei UI", "PingFang SC", "Noto Sans TC", "Segoe UI", sans-serif';
export const MONO_FONT = '"Cascadia Mono", "Consolas", "Microsoft YaHei UI", monospace';

export function stripEscBytes(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b === 0) break;
    if (b === 0x1b) {
      const cmd = bytes[i + 1];
      if (cmd === 0x3d) i += 4; // ESC = y x
      else if (cmd === 0x43 || cmd === 0x42 || cmd === 0x4d || cmd === 0x52 || cmd === 0x46) i += 3; // ESC C/B/M/R/F n
      else if (cmd === 0x57) i += 2; // ESC W
      else i += 2;
      continue;
    }
    if (b >= 0x20 || b === 0x0a) out.push(b);
    i++;
  }
  return Uint8Array.from(out);
}

export function decodeCleanCstr(codec: any, bytes: Uint8Array): string {
  if (!codec || !bytes) return "";
  const clean = stripEscBytes(bytes);
  return codec.decode(clean).replace(/\{[0-9A-F]{2}\}/g, "").trim();
}

export function createEscStripper(onByte: (b: number) => void) {
  let esc = 0;
  return (ch: number) => {
    ch &= 0xff;
    if (esc === 1) {
      if (ch === 0x3d) { esc = 3; return; } // skip 2 more bytes (y, x)
      if (ch === 0x43 || ch === 0x42 || ch === 0x4d || ch === 0x52 || ch === 0x46) { esc = 2; return; } // skip 1 more byte (n)
      esc = 0; // ESC W or unknown 2-byte
      return;
    }
    if (esc === 3) { esc = 2; return; }
    if (esc === 2) { esc = 0; return; }
    if (ch === 0x1b) { esc = 1; return; }
    if (ch >= 0x20 || ch === 0x0a) onByte(ch);
  };
}

export function captureConsoleText(ctx: any, fn: () => void): string {
  const { con, codec } = ctx;
  const saved = con.putc;
  const raw: number[] = [];
  con.putc = createEscStripper(b => raw.push(b));
  try {
    fn();
  } finally {
    con.putc = saved;
  }
  return codec ? codec.decode(Uint8Array.from(raw)).replace(/\{[0-9A-F]{2}\}/g, "").trim() : "";
}
