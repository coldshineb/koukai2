// save/legacy_import.ts — 原版 KOUKAI2.DAT 只讀解析與匯入器
// 只讀：將舊版二進位 KOUKAI2.DAT (328,991 bytes, 10 格) 轉換為現代 uw2-save-v2 JSON 存檔包；
// 之後所有的寫入與匯出全部採用現代 JSON 格式，不再寫回二進位 KOUKAI2.DAT。
import { createEmptyBundleV2, createSaveSlotV2, SAVE_SLOTS_COUNT } from "./format.ts";
import type { SaveBundleV2 } from "./format.ts";

export const LEGACY_HEADER_OFF = 1;
export const LEGACY_HEADER_SIZE = 15;
export const LEGACY_SLOT_OFF = 0x97;
export const LEGACY_SLOT_SIZE = 0x8074;
export const LEGACY_FILE_SIZE = LEGACY_SLOT_OFF + SAVE_SLOTS_COUNT * LEGACY_SLOT_SIZE;

export interface LegacySlotHeaderInfo {
  slotIndex: number;
  occupied: boolean;
  rawDate: string;
  portId: number;
  flag: number;
}

/** 檢查緩衝區是否為合法的原版 KOUKAI2.DAT 大小 */
export function isLegacyKoukaiDat(data: Uint8Array | ArrayBuffer): boolean {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return bytes.length === LEGACY_FILE_SIZE;
}

/** 僅解析原版 10 格標頭摘要 (不解碼整份狀態，適合快速預覽) */
export function parseLegacyHeaders(data: Uint8Array | ArrayBuffer): LegacySlotHeaderInfo[] {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < LEGACY_SLOT_OFF) throw new Error(`KOUKAI2.DAT 檔案過短 (${bytes.length} bytes)`);
  const out: LegacySlotHeaderInfo[] = [];
  for (let i = 0; i < SAVE_SLOTS_COUNT; i++) {
    const off = LEGACY_HEADER_OFF + i * LEGACY_HEADER_SIZE;
    const h = bytes.subarray(off, off + LEGACY_HEADER_SIZE);
    const occupied = h[0] !== 0;
    let rawDate = "";
    if (occupied) {
      let end = 0;
      while (end < 12 && h[end] !== 0) end++;
      for (let k = 0; k < end; k++) rawDate += String.fromCharCode(h[k]);
    }
    out.push({ slotIndex: i, occupied, rawDate, portId: h[12], flag: h[13] });
  }
  return out;
}

/**
 * 只讀匯入原版 KOUKAI2.DAT → 現代 SaveBundleV2
 * - 每個已佔用槽位都會轉成具名 uw2-save-v2 存檔並附帶摘要
 * - 空白槽位維持 null
 */
export function importLegacySave(
  data: Uint8Array | ArrayBuffer,
  schema: any,
  codec: any,
  opts: { includeCompat?: boolean; savedAt?: string } = {},
): SaveBundleV2 {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (!isLegacyKoukaiDat(bytes)) {
    throw new Error(`無效的 KOUKAI2.DAT 大小: ${bytes.length} (預期 ${LEGACY_FILE_SIZE})`);
  }
  const bundle = createEmptyBundleV2(bytes[0]);
  const savedAt = opts.savedAt ?? new Date().toISOString();
  bundle.updatedAt = savedAt;

  for (let i = 0; i < SAVE_SLOTS_COUNT; i++) {
    const hOff = LEGACY_HEADER_OFF + i * LEGACY_HEADER_SIZE;
    const header15 = bytes.subarray(hOff, hOff + LEGACY_HEADER_SIZE);
    if (header15[0] === 0) continue;
    const sOff = LEGACY_SLOT_OFF + i * LEGACY_SLOT_SIZE;
    const stateBytes = bytes.subarray(sOff, sOff + LEGACY_SLOT_SIZE);
    bundle.slots[i] = createSaveSlotV2(i, stateBytes, header15, schema, codec, {
      includeCompat: opts.includeCompat ?? true,
      savedAt,
    });
  }
  return bundle;
}
