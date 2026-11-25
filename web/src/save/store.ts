// save/store.ts — 现代 JSON 存盘保存管理 (localStorage uw2.saves.v2 + 自动存盘 + 文件导入/导出)
import { createEmptyBundleV2, createSaveSlotV2, isSaveBundleV2, parseSaveJsonV2, slotV2ToLegacyHeader, v2ToStateBytes, SAVE_SLOTS_COUNT } from "./format.ts";
import type { SaveBundleV2, SaveSlotV2 } from "./format.ts";
import { importLegacySave, isLegacyKoukaiDat } from "./legacy_import.ts";

export const SAVE_STORAGE_KEY_V2 = "uw2.saves.v2";
export const LEGACY_STORAGE_KEY = "uw2.KOUKAI2.DAT";

function getBrowserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage ?? null; } catch { return null; }
}

function decodeLegacyB64(s: string): Uint8Array {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

export class SaveStore {
  bundle: SaveBundleV2;
  readonly schema: any;
  readonly codec: any;
  readonly baseState: Uint8Array;

  constructor(bundle: SaveBundleV2, schema: any, codec: any, baseState: Uint8Array) {
    this.bundle = bundle;
    this.schema = schema;
    this.codec = codec;
    this.baseState = baseState;
  }

  /**
   * 启动打开存盘库:
   * 1. 优先读取现代 JSON (localStorage["uw2.saves.v2"])
   * 2. 若无，自动只读迁移旧版 localStorage["uw2.KOUKAI2.DAT"] → 存为 uw2.saves.v2
   * 3. 若无，尝试只读加载 assets/save/KOUKAI2.DAT → 存为 uw2.saves.v2
   * 4. 皆无则创建空白 uw2-save-v2 存盘库
   */
  static async open(ASSETS: string, initState: Uint8Array, schema: any, codec: any): Promise<SaveStore> {
    const ls = getBrowserStorage();
    if (ls) {
      const rawV2 = ls.getItem(SAVE_STORAGE_KEY_V2);
      if (rawV2) {
        try {
          const parsed = JSON.parse(rawV2);
          if (isSaveBundleV2(parsed)) {
            return new SaveStore(parsed, schema, codec, initState);
          }
        } catch (e) {
          console.warn("讀取 uw2.saves.v2 失敗，嘗試回退:", e);
        }
      }
      const rawLegacy = ls.getItem(LEGACY_STORAGE_KEY);
      if (rawLegacy) {
        try {
          const bytes = decodeLegacyB64(rawLegacy);
          if (isLegacyKoukaiDat(bytes)) {
            const bundle = importLegacySave(bytes, schema, codec);
            const store = new SaveStore(bundle, schema, codec, initState);
            store.persist();
            return store;
          }
        } catch (e) {
          console.warn("遷移舊版 localStorage KOUKAI2.DAT 失敗:", e);
        }
      }
    }

    if (typeof fetch !== "undefined" && ASSETS) {
      try {
        const r = await fetch(ASSETS + "/save/KOUKAI2.DAT");
        if (r.ok) {
          const bytes = new Uint8Array(await r.arrayBuffer());
          if (isLegacyKoukaiDat(bytes)) {
            const bundle = importLegacySave(bytes, schema, codec);
            const store = new SaveStore(bundle, schema, codec, initState);
            store.persist();
            return store;
          }
        }
      } catch (e) {
        /* 无默认档 */
      }
    }

    const empty = createEmptyBundleV2(initState[0x12b5 - 0x0ca4] ?? 0);
    const store = new SaveStore(empty, schema, codec, initState);
    store.persist();
    return store;
  }

  persist(): void {
    this.bundle.updatedAt = new Date().toISOString();
    const ls = getBrowserStorage();
    if (!ls) return;
    try {
      ls.setItem(SAVE_STORAGE_KEY_V2, JSON.stringify(this.bundle));
    } catch (e) {
      console.warn("寫入 uw2.saves.v2 失敗 (可能超出 localStorage 配額):", e);
    }
  }

  getSlot(i: number): SaveSlotV2 | null {
    return this.bundle.slots[i] ?? null;
  }

  saveSlot(i: number, stateBytes: Uint8Array, header15?: Uint8Array): SaveSlotV2 {
    const slot = createSaveSlotV2(i, stateBytes, header15, this.schema, this.codec);
    this.bundle.slots[i] = slot;
    this.persist();
    return slot;
  }

  saveAuto(stateBytes: Uint8Array, header15?: Uint8Array): SaveSlotV2 {
    const slot = createSaveSlotV2("auto", stateBytes, header15, this.schema, this.codec);
    this.bundle.autoSave = slot;
    this.persist();
    return slot;
  }

  loadSlotBytes(i: number): Uint8Array {
    const slot = this.bundle.slots[i];
    if (!slot) return this.baseState.slice();
    return v2ToStateBytes(slot.state, this.schema, this.codec, this.baseState);
  }

  loadAutoBytes(): Uint8Array | null {
    if (!this.bundle.autoSave) return null;
    return v2ToStateBytes(this.bundle.autoSave.state, this.schema, this.codec, this.baseState);
  }

  /** 产生原版 150-byte 头部表 (供阶段 3 原版读档/存盘画面显示) */
  buildLegacyHeaders(): Uint8Array {
    const out = new Uint8Array(SAVE_SLOTS_COUNT * 15);
    for (let i = 0; i < SAVE_SLOTS_COUNT; i++) {
      out.set(slotV2ToLegacyHeader(this.bundle.slots[i]), i * 15);
    }
    return out;
  }

  /** 导出纯 JSON 字符串 (可选择省略 _compat 以取得最精简人类可读存盘) */
  exportJson(opts: { pretty?: boolean; stripCompat?: boolean; slotIndex?: number } = {}): string {
    const strip = (slot: SaveSlotV2 | null): SaveSlotV2 | null => {
      if (!slot) return null;
      if (!opts.stripCompat) return slot;
      const { _compat, ...cleanState } = slot.state;
      return { ...slot, state: cleanState };
    };
    if (typeof opts.slotIndex === "number") {
      const s = strip(this.getSlot(opts.slotIndex));
      if (!s) throw new Error(`槽位 ${opts.slotIndex} 為空`);
      return JSON.stringify(s, null, opts.pretty ? 2 : 0);
    }
    const bundle: SaveBundleV2 = {
      ...this.bundle,
      slots: this.bundle.slots.map(strip),
      autoSave: strip(this.bundle.autoSave ?? null),
    };
    return JSON.stringify(bundle, null, opts.pretty ? 2 : 0);
  }

  /** 导入外部文件 (自动辨识现代 JSON 或原版二进位 KOUKAI2.DAT) */
  importBuffer(data: Uint8Array | ArrayBuffer, targetSlot?: number): { kind: "json-bundle" | "json-slot" | "legacy-dat"; importedSlots: number } {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (isLegacyKoukaiDat(bytes)) {
      const imported = importLegacySave(bytes, this.schema, this.codec);
      let count = 0;
      for (let i = 0; i < SAVE_SLOTS_COUNT; i++) {
        if (imported.slots[i]) {
          this.bundle.slots[i] = imported.slots[i];
          count++;
        }
      }
      this.bundle.heroId = imported.heroId;
      this.persist();
      return { kind: "legacy-dat", importedSlots: count };
    }

    const text = new TextDecoder("utf-8").decode(bytes);
    const parsed = parseSaveJsonV2(text);
    if (isSaveBundleV2(parsed)) {
      this.bundle = parsed;
      this.persist();
      const count = parsed.slots.filter(Boolean).length;
      return { kind: "json-bundle", importedSlots: count };
    }

    const idx = targetSlot ?? (typeof parsed.slotIndex === "number" ? parsed.slotIndex : 0);
    this.bundle.slots[idx] = { ...parsed, slotIndex: idx };
    this.persist();
    return { kind: "json-slot", importedSlots: 1 };
  }
}
