// ui/t2s.ts — 统一繁体转简体中文转换器 (基于 opencc-js/t2cn，按需加载体积小、含缓存)
// 同时修正 build_charmap.py 透过 Unifont 字形比对产生的 5 组相邻对调字：
//   速↔连 (0x9F75/0x9F76)、散↔敢 (0xA072/0xA073)、髯↔发 (0xA8A0/0xA8A1)、
//   匾↔区 (0x9D4A/0x9D4B)、缍↔缓 (0xA7C1/0xA7C2)
// 保持底层 charmap.json 双向字节可逆性不变，所有显示出口自动呈现正确简体中文。
import * as OpenCC from "opencc-js/t2cn";

const converter: (s: string) => string = OpenCC.Converter({ from: "tw", to: "cn" });
const cache = new Map<string, string>();
const MAX_CACHE = 4096;

const CHARMAP_SWAP: Record<string, string> = {
  "速": "連", "連": "速",
  "散": "敢", "敢": "散",
  "髯": "髮", "髮": "髯",
  "匾": "區", "區": "匾",
  "綞": "緩", "緩": "綞",
  "薨": "薦",
};
const SWAP_RE = /[速連散敢髯髮匾區綞緩薨]/g;
const UNMAPPED_GLYPHS: Record<string, string> = {
  "{#93D3}": "打",
  "{#D8C6}": "里",
};
const UNMAPPED_RE = /\{#[0-9A-Fa-f]{4}\}/g;
const CTRL_BRACE_RE = /\{[0-9A-Fa-f]{2,4}\}/g;

/** 将任意繁体中文文字修正 charmap 对调字、补齐未映射字形并清除残留 {XX} 控制码后转为标准简体中文（自动缓存） */
export function toSimp(text: string): string {
  if (!text) return text;
  const cleaned = text.includes("{")
    ? text.replace(UNMAPPED_RE, m => UNMAPPED_GLYPHS[m.toUpperCase()] ?? "").replace(CTRL_BRACE_RE, "")
    : text;
  let hasNonAscii = false;
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned.charCodeAt(i) > 0x7f) { hasNonAscii = true; break; }
  }
  if (!hasNonAscii) return cleaned;

  const hit = cache.get(cleaned);
  if (hit !== undefined) return hit;
  const fixed = cleaned.replace(SWAP_RE, ch => CHARMAP_SWAP[ch] ?? ch).replace(/金弊/g, "金幣");
  const out = converter(fixed);
  if (cache.size >= MAX_CACHE) cache.clear();
  cache.set(cleaned, out);
  return out;
}
