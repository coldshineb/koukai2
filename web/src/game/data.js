// data.js — 游戏状态 JSON <-> 原版字节 (与 tools/gamedata.py 相同规则, 依 assets/data/schema.json)
//   world.json  = 新游戏初值 (DATA1.LZW #15 + DGROUP 尾段), 运行时编码成 0x8074 bytes 的 GameState
//   存盘仍是原版二进位格式; 需要时可用 decodeState() 转成 JSON 查看/修改, encodeState() 写回
export class TextCodec {
  constructor(charmap) {
    this.c2u = new Map(); this.u2c = new Map();
    for (const [code, , , u] of charmap.table) { this.c2u.set(code, u); this.u2c.set(u, code); }
  }
  decode(b) {
    let s = "";
    for (let i = 0; i < b.length; ) {
      const c = b[i];
      if (c >= 0x81 && i + 1 < b.length) { const cd = (c << 8) | b[i + 1]; s += this.c2u.get(cd) ?? "{#" + cd.toString(16).toUpperCase().padStart(4, "0") + "}"; i += 2; }
      else if (c === 0x0a) { s += "\n"; i++; }
      else if (c >= 0x20 && c < 0x7f && c !== 0x7b && c !== 0x7d) { s += String.fromCharCode(c); i++; }
      else { s += "{" + c.toString(16).toUpperCase().padStart(2, "0") + "}"; i++; }
    }
    return s;
  }
  encode(s) {
    const out = [];
    for (let i = 0; i < s.length; ) {
      const cp = s.codePointAt(i), ch = String.fromCodePoint(cp);
      if (ch === "{") { const j = s.indexOf("}", i), tok = s.slice(i + 1, j);
        if (tok[0] === "#") { const v = parseInt(tok.slice(1), 16); out.push(v >> 8, v & 255); } else out.push(parseInt(tok, 16));
        i = j + 1; continue; }
      if (ch === "\n") out.push(0x0a); else if (cp < 0x80) out.push(cp);
      else { const c = this.u2c.get(ch); if (c === undefined) throw new Error("unmapped " + ch); out.push(c >> 8, c & 255); }
      i += ch.length;
    }
    return Uint8Array.from(out);
  }
}
const hex = b => Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
const unhex = s => { const o = new Uint8Array(s.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(s.substr(i * 2, 2), 16); return o; };
const key = off => "u_" + off.toString(16).padStart(2, "0");
function fsize(f) {
  if (f.type === "str") return f.size;
  if (f.type === "struct") return f.size * (f.count ?? 1);
  return (f.type === "u16" ? 2 : 1) * (f.count ?? 1);
}
function spans(fields, size) {
  const out = []; let p = 0;
  for (const f of [...fields].sort((a, b) => a.off - b.off)) {
    if (f.off > p) out.push([p, null, f.off - p]);
    const n = fsize(f); out.push([f.off, f, n]); p = f.off + n;
  }
  if (p < size) out.push([p, null, size - p]);
  return out;
}
function decodeRecord(b, fields, size, codec) {
  const rec = {};
  for (const [off, f, n] of spans(fields, size)) {
    const raw = b.subarray(off, off + n);
    if (!f) { rec[key(off)] = hex(raw); continue; }
    const c = f.count;
    if (f.type === "str") {
      let k = raw.indexOf(0); if (k < 0) k = raw.length;
      rec[f.name] = codec.decode(raw.subarray(0, k));
      if (raw.subarray(k).some(x => x)) rec[f.name + "Tail"] = hex(raw.subarray(k));
    } else if (f.type === "struct") {
      rec[f.name] = Array.from({ length: c }, (_, i) => decodeRecord(raw.subarray(i * f.size, (i + 1) * f.size), f.fields, f.size, codec));
    } else if (f.type === "u8") rec[f.name] = c ? Array.from(raw) : raw[0];
    else { const v = Array.from({ length: c ?? 1 }, (_, i) => raw[i * 2] | (raw[i * 2 + 1] << 8)); rec[f.name] = c ? v : v[0]; }
  }
  return rec;
}
function encodeRecord(rec, fields, size, codec) {
  const out = new Uint8Array(size);
  for (const [off, f, n] of spans(fields, size)) {
    if (!f) { out.set(unhex(rec[key(off)]), off); continue; }
    const v = rec[f.name], c = f.count;
    if (f.type === "str") {
      const e = codec.encode(v), tail = unhex(rec[f.name + "Tail"] ?? "");
      if (e.length + tail.length > n) throw new Error(`${f.name} too long: ${v}`);
      out.set(e, off); out.set(tail, off + e.length);
    } else if (f.type === "struct") v.forEach((r, i) => out.set(encodeRecord(r, f.fields, f.size, codec), off + i * f.size));
    else if (f.type === "u8") { if (c) out.set(v, off); else out[off] = v; }
    else (c ? v : [v]).forEach((x, i) => { out[off + i * 2] = x & 255; out[off + i * 2 + 1] = (x >> 8) & 255; });
  }
  return out;
}
export function decodeState(b, schema, codec) {
  const B = schema.stateBase, size = schema.stateEnd - B;
  const full = new Uint8Array(size); full.set(b.subarray(0, size));
  const sl = (ds, n) => full.subarray(ds - B, ds - B + n);
  const out = { format: "uw2-state-1", sourceLength: b.length, globals: {}, tables: {}, gaps: {} };
  for (const g of schema.globals) {
    if (g.type === "u32") { const r = sl(g.ds, 4); out.globals[g.name] = (r[0] | (r[1] << 8) | (r[2] << 16) | (r[3] << 24)) >>> 0; }
    else if (g.type === "u16") { const r = sl(g.ds, 2); out.globals[g.name] = r[0] | (r[1] << 8); }
    else out.globals[g.name] = sl(g.ds, 1)[0];
  }
  let p = B;
  for (const t of schema.tables) {
    if (t.ds > p) out.gaps[p.toString(16).padStart(4, "0")] = hex(sl(p, t.ds - p));
    out.tables[t.name] = Array.from({ length: t.count }, (_, i) => decodeRecord(sl(t.ds + i * t.stride, t.stride), t.fields, t.stride, codec));
    p = t.ds + t.count * t.stride;
  }
  if (p < schema.tail.ds) out.gaps[p.toString(16).padStart(4, "0")] = hex(sl(p, schema.tail.ds - p));
  out.tail = hex(sl(schema.tail.ds, schema.tail.size));
  return out;
}
export function encodeState(d, schema, codec) {
  const B = schema.stateBase, buf = new Uint8Array(schema.stateEnd - B);
  const put = (ds, bb) => buf.set(bb, ds - B);
  for (const [k, v] of Object.entries(d.gaps)) put(parseInt(k, 16), unhex(v));
  for (const t of schema.tables) d.tables[t.name].forEach((r, i) => put(t.ds + i * t.stride, encodeRecord(r, t.fields, t.stride, codec)));
  put(schema.tail.ds, unhex(d.tail));
  for (const g of schema.globals) {
    const v = d.globals[g.name];
    if (g.type === "u32") put(g.ds, Uint8Array.of(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255));
    else if (g.type === "u16") put(g.ds, Uint8Array.of(v & 255, (v >> 8) & 255));
    else buf[g.ds - B] = v & 255;
  }
  return buf.slice(0, d.sourceLength ?? buf.length);
}
// 表记录的原版 DS 地址 (与 MAIN.EXE 访问函数相同的计算)
export function recordAddr(schema, table, i) { const t = schema.tables.find(t => t.name === table); return t.ds + i * t.stride; }
