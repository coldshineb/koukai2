// savefile.js — 存盘界面 (阶段 3: 浏览器端改以现代 uw2-save-v2 JSON 保存，只读导入原版 KOUKAI2.DAT)
//   - 浏览器运行 (提供 schema + codec): 由 SaveStore (localStorage "uw2.saves.v2") 驱动，
//     首次启动若侦测到旧版 localStorage 或 assets/save/KOUKAI2.DAT 则自动只读迁移为 JSON。
//   - 差分回归测试 (直接 new SaveFile(bytes) 或不传 schema/codec): 维持原版内存缓冲，确保 100% 兼容。
import { STATE_SIZE } from "../game/state.js";
import { SaveStore } from "./store.ts";

export const HEADER_OFF = 1, HEADER_SIZE = 15, SLOTS = 10, SLOT_OFF = 0x97, SLOT_SIZE = STATE_SIZE;
export const FILE_SIZE = SLOT_OFF + SLOTS * SLOT_SIZE;
const KEY = "uw2.KOUKAI2.DAT";

function toB64(u8) { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); }
function fromB64(s) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i); return u; }

export class SaveFile {
  constructor(bytes, store = null) {
    this.b = bytes;
    this.store = store;
  }

  static async open(ASSETS, initState, schema, codec) {
    if (schema && codec) {
      const store = await SaveStore.open(ASSETS, initState, schema, codec);
      const b = new Uint8Array(FILE_SIZE);
      b[0] = store.bundle.heroId & 0xff;
      b.set(store.buildLegacyHeaders(), HEADER_OFF);
      return new SaveFile(b, store);
    }
    const st = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (st) return new SaveFile(fromB64(st));
    try {
      const r = await fetch(ASSETS + "/save/KOUKAI2.DAT");
      if (r.ok) { const f = new SaveFile(new Uint8Array(await r.arrayBuffer())); f.flush(); return f; }
    } catch (e) { /* 无档 */ }
    return SaveFile.create(initState);
  }

  static create(initState) {
    const b = new Uint8Array(FILE_SIZE);
    b[0] = initState[0x12b5 - 0x0ca4];
    for (let i = 0; i < SLOTS; i++) b.set(initState.subarray(0, SLOT_SIZE), SLOT_OFF + i * SLOT_SIZE);
    const f = new SaveFile(b); f.flush(); return f;
  }

  flush() {
    if (this.store) { this.store.persist(); return; }
    try { localStorage.setItem(KEY, toB64(this.b)); } catch (e) { /* 配额不足等: 仅保留于内存 */ }
  }

  headers() {
    if (this.store) return this.store.buildLegacyHeaders();
    return this.b.slice(HEADER_OFF, HEADER_OFF + SLOTS * HEADER_SIZE);
  }

  header(i) {
    if (this.store) {
      const all = this.store.buildLegacyHeaders();
      return all.subarray(i * HEADER_SIZE, (i + 1) * HEADER_SIZE);
    }
    return this.b.subarray(HEADER_OFF + i * HEADER_SIZE, HEADER_OFF + (i + 1) * HEADER_SIZE);
  }

  slot(i) {
    if (this.store) return this.store.loadSlotBytes(i);
    return this.b.subarray(SLOT_OFF + i * SLOT_SIZE, SLOT_OFF + (i + 1) * SLOT_SIZE);
  }

  writeSlot(i, header15, state) {
    if (this.store) {
      this.store.saveSlot(i, state.subarray(0, SLOT_SIZE), header15);
      if (i >= 0 && i < SLOTS) this.b.set(header15, HEADER_OFF + i * HEADER_SIZE);
      return;
    }
    this.b.set(header15, HEADER_OFF + i * HEADER_SIZE);
    this.b.set(state.subarray(0, SLOT_SIZE), SLOT_OFF + i * SLOT_SIZE);
    this.flush();
  }

  deleteSlot(i) {
    if (!this.store) return;
    this.store.deleteSlot(i);
    this.b.set(this.store.buildLegacyHeaders(), HEADER_OFF);
  }

  exportJson(opts) {
    if (!this.store) throw new Error("SaveFile 尚未連接 JSON SaveStore");
    return this.store.exportJson(opts);
  }

  inspectImportBuffer(data) {
    if (!this.store) throw new Error("SaveFile 尚未連接 JSON SaveStore");
    return this.store.inspectImportBuffer(data);
  }

  importSlots(items, heroId) {
    if (!this.store) throw new Error("SaveFile 尚未連接 JSON SaveStore");
    const count = this.store.importSlots(items, heroId);
    this.b[0] = this.store.bundle.heroId & 0xff;
    this.b.set(this.store.buildLegacyHeaders(), HEADER_OFF);
    return count;
  }

  importBuffer(data, targetSlot) {
    if (!this.store) throw new Error("SaveFile 尚未連接 JSON SaveStore");
    const res = this.store.importBuffer(data, targetSlot);
    this.b[0] = this.store.bundle.heroId & 0xff;
    this.b.set(this.store.buildLegacyHeaders(), HEADER_OFF);
    return res;
  }
}
