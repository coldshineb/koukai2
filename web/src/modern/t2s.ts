// modern/t2s.ts — 統一繁體轉簡體中文轉換器 (基於 opencc-js/t2cn，按需載入體積小、含快取)
import * as OpenCC from "opencc-js/t2cn";

const converter: (s: string) => string = OpenCC.Converter({ from: "tw", to: "cn" });
const cache = new Map<string, string>();
const MAX_CACHE = 4096;

/** 將任意繁體中文文字轉為標準簡體中文（自動快取，純 ASCII 直接零成本返回） */
export function toSimp(text: string): string {
  if (!text) return text;
  // 純 ASCII 直接跳過
  let hasNonAscii = false;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) { hasNonAscii = true; break; }
  }
  if (!hasNonAscii) return text;

  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  const out = converter(text).replace(/连度/g, "速度");
  if (cache.size >= MAX_CACHE) cache.clear();
  cache.set(text, out);
  return out;
}
