// save/store.ts — 现代无限槽位 JSON 存盘保存管理 (IndexedDB 主保存 + localStorage 备援 + 导入槽位选择 + 导出 JSON)
import { createEmptyBundleV2, createSaveSlotV2, isSaveBundleV2, parseSaveJsonV2, slotV2ToLegacyHeader, v2ToStateBytes, SAVE_SLOTS_COUNT } from "./format.ts";
import type { SaveBundleV2, SaveSlotV2 } from "./format.ts";
import { importLegacySave, isLegacyKoukaiDat } from "./legacy_import.ts";

export const SAVE_STORAGE_KEY_V2 = "uw2.saves.v2";
export const LEGACY_STORAGE_KEY = "uw2.KOUKAI2.DAT";
const IDB_NAME = "uw2-saves-db";
const IDB_STORE = "bundles";

export interface InspectedImport {
  kind: "json-bundle" | "json-slot" | "legacy-dat";
  heroId?: number;
  entries: Array<{ sourceIndex: number; slot: SaveSlotV2 }>;
}

function getBrowserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage ?? null; } catch { return null; }
}

function openIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readIdbBundle(): Promise<SaveBundleV2 | null> {
  const db = await openIdb();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(SAVE_STORAGE_KEY_V2);
      req.onsuccess = () => {
        const val = req.result;
        resolve(isSaveBundleV2(val) ? val : null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function writeIdbBundle(bundle: SaveBundleV2): Promise<void> {
  const db = await openIdb();
  if (!db) return;
  return new Promise(resolve => {
    try {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(bundle, SAVE_STORAGE_KEY_V2);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
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
   * 1. 优先读取 IndexedDB (支持无限槽位、无 5MB 限制)
   * 2. 其次读取 localStorage["uw2.saves.v2"] 并同步迁移至 IndexedDB
   * 3. 其次自动只读迁移旧版 localStorage["uw2.KOUKAI2.DAT"] 或 assets/save/KOUKAI2.DAT
   * 4. 皆无则创建空白 uw2-save-v2 存盘库
   */
  static async open(ASSETS: string, initState: Uint8Array, schema: any, codec: any): Promise<SaveStore> {
    const idbBundle = await readIdbBundle();
    if (idbBundle) {
      return new SaveStore(idbBundle, schema, codec, initState);
    }

    const ls = getBrowserStorage();
    if (ls) {
      const rawV2 = ls.getItem(SAVE_STORAGE_KEY_V2);
      if (rawV2) {
        try {
          const parsed = JSON.parse(rawV2);
          if (isSaveBundleV2(parsed)) {
            const store = new SaveStore(parsed, schema, codec, initState);
            store.persist();
            return store;
          }
        } catch (e) {
          console.warn("读取 uw2.saves.v2 失败，尝试回退:", e);
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
          console.warn("迁移旧版 localStorage KOUKAI2.DAT 失败:", e);
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
      } catch {
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
    void writeIdbBundle(this.bundle);
    const ls = getBrowserStorage();
    if (!ls) return;
    try {
      ls.setItem(SAVE_STORAGE_KEY_V2, JSON.stringify(this.bundle));
    } catch {
      /* 超过 localStorage 5MB 配额时已由 IndexedDB 完整保存 */
    }
  }

  getSlot(i: number): SaveSlotV2 | null {
    return this.bundle.slots[i] ?? null;
  }

  private ensureSlotCapacity(index: number): void {
    while (this.bundle.slots.length <= index) {
      this.bundle.slots.push(null);
    }
  }

  saveSlot(i: number, stateBytes: Uint8Array, header15?: Uint8Array): SaveSlotV2 {
    this.ensureSlotCapacity(i);
    const slot = createSaveSlotV2(i, stateBytes, header15, this.schema, this.codec);
    this.bundle.slots[i] = slot;
    this.persist();
    return slot;
  }

  deleteSlot(i: number): void {
    if (i < 0 || i >= this.bundle.slots.length) return;
    this.bundle.slots[i] = null;
    while (this.bundle.slots.length > SAVE_SLOTS_COUNT && this.bundle.slots[this.bundle.slots.length - 1] === null) {
      this.bundle.slots.pop();
    }
    this.persist();
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
      if (!s) throw new Error(`槽位 ${opts.slotIndex + 1} 为空`);
      return JSON.stringify(s, null, opts.pretty ? 2 : 0);
    }
    const bundle: SaveBundleV2 = {
      ...this.bundle,
      slots: this.bundle.slots.map(strip),
      autoSave: strip(this.bundle.autoSave ?? null),
    };
    return JSON.stringify(bundle, null, opts.pretty ? 2 : 0);
  }

  /** 解析外部文档但不立即写入，供现代存盘界面让玩家自由挑选目标槽位 */
  inspectImportBuffer(data: Uint8Array | ArrayBuffer): InspectedImport {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (isLegacyKoukaiDat(bytes)) {
      const imported = importLegacySave(bytes, this.schema, this.codec);
      const entries: Array<{ sourceIndex: number; slot: SaveSlotV2 }> = [];
      imported.slots.forEach((slot, idx) => {
        if (slot) entries.push({ sourceIndex: idx, slot });
      });
      return { kind: "legacy-dat", heroId: imported.heroId, entries };
    }

    const text = new TextDecoder("utf-8").decode(bytes);
    const parsed = parseSaveJsonV2(text);
    if (isSaveBundleV2(parsed)) {
      const entries: Array<{ sourceIndex: number; slot: SaveSlotV2 }> = [];
      parsed.slots.forEach((slot, idx) => {
        if (slot) entries.push({ sourceIndex: idx, slot });
      });
      return { kind: "json-bundle", heroId: parsed.heroId, entries };
    }

    const srcIdx = typeof parsed.slotIndex === "number" ? parsed.slotIndex : 0;
    return { kind: "json-slot", entries: [{ sourceIndex: srcIdx, slot: parsed }] };
  }

  /** 将用户选定的存盘项写入指定目标槽位 (不限 1–10 号，可自动扩充至任意后方槽位) */
  importSlots(items: Array<{ slot: SaveSlotV2; targetIndex: number }>, heroId?: number): number {
    let count = 0;
    for (const { slot, targetIndex } of items) {
      if (targetIndex < 0) continue;
      this.ensureSlotCapacity(targetIndex);
      this.bundle.slots[targetIndex] = { ...slot, slotIndex: targetIndex };
      count++;
    }
    if (typeof heroId === "number") this.bundle.heroId = heroId;
    if (count > 0) this.persist();
    return count;
  }

  /** 兼容旧版直接导入界面 (支持可选 targetSlot 作为单槽或起始槽位偏移) */
  importBuffer(data: Uint8Array | ArrayBuffer, targetSlot?: number): { kind: "json-bundle" | "json-slot" | "legacy-dat"; importedSlots: number } {
    const inspected = this.inspectImportBuffer(data);
    if (inspected.kind === "json-slot") {
      const entry = inspected.entries[0];
      const idx = targetSlot ?? entry.sourceIndex;
      const count = this.importSlots([{ slot: entry.slot, targetIndex: idx }]);
      return { kind: "json-slot", importedSlots: count };
    }
    const items = inspected.entries.map((e, i) => ({
      slot: e.slot,
      targetIndex: typeof targetSlot === "number" ? targetSlot + i : e.sourceIndex,
    }));
    const count = this.importSlots(items, inspected.heroId);
    return { kind: inspected.kind, importedSlots: count };
  }
}
