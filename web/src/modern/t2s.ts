// modern/t2s.ts — 統一繁體轉簡體中文轉換器 (基於 opencc-js/t2cn，按需載入體積小、含快取)
// 同時修正 build_charmap.py 透過 Unifont 字形比對產生的 5 組相鄰對調字：
//   速↔連 (0x9F75/0x9F76)、散↔敢 (0xA072/0xA073)、髯↔髮 (0xA8A0/0xA8A1)、
//   匾↔區 (0x9D4A/0x9D4B)、綞↔緩 (0xA7C1/0xA7C2)
// 保持底層 charmap.json 雙向位元組可逆性不變，所有顯示出口自動呈現正確簡體中文。
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
};
const SWAP_RE = /[速連散敢髯髮匾區綞緩]/g;

/** 將任意繁體中文文字修正 charmap 對調字後轉為標準簡體中文（自動快取） */
export function toSimp(text: string): string {
  if (!text) return text;
  let hasNonAscii = false;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) { hasNonAscii = true; break; }
  }
  if (!hasNonAscii) return text;

  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  const fixed = text.replace(SWAP_RE, ch => CHARMAP_SWAP[ch] ?? ch);
  const out = converter(fixed);
  if (cache.size >= MAX_CACHE) cache.clear();
  cache.set(text, out);
  return out;
}
