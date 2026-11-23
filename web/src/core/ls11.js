// ls11.js — 光榮 LS10/LS11 壓縮包解碼 (與 tools/uw2lib.py ls_unpack 相同; MAIN.EXE 2e09:750e/752b)
//   0x000 "LS10"/"LS11" + 12 bytes 0 | 0x010 256 bytes 字典 | 0x110 {u32be 壓縮長, 原長, 偏移}*N, 壓縮長 0 結束
//   位元流 MSB 優先; 變長碼 = bits(n+1) + 2^(n+1) − 2 (n = 前導 1 個數); <256 字典字元, 否則 (距離 = 碼−256, 長度 = 下一碼+3)
export function lsEntries(b) {
  const be32 = o => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const out = [];
  for (let p = 0x110; ; p += 12) { const c = be32(p); if (!c) break; out.push({ clen: c, ulen: be32(p + 4), off: be32(p + 8) }); }
  return out;
}
export function lsDecode(b, { clen, ulen, off }) {
  if (clen === ulen) return b.slice(off, off + ulen);
  const dic = b.subarray(16, 272), o = new Uint8Array(ulen);
  let n = 0, bp = off * 8;
  const bit = () => { const v = (b[bp >> 3] >> (7 - (bp & 7))) & 1; bp++; return v; };
  const code = () => { let k = 0; while (bit()) k++; let v = 0; for (let i = 0; i <= k; i++) v = (v << 1) | bit(); return v + (1 << (k + 1)) - 2; };
  while (n < ulen) {
    const cd = code();
    if (cd < 256) o[n++] = dic[cd];
    else { const d = cd - 256, L = code() + 3; for (let i = 0; i < L && n < ulen; i++) { o[n] = o[n - d]; n++; } }
  }
  return o;
}
export function lsUnpack(b) { return lsEntries(b).map(e => lsDecode(b, e)); }
