// savefile.js — KOUKAI2.DAT 存檔 (原版格式, MAIN.EXE 0FEA:170dc / 16b3f / 16cf0)
//   +0x00        1 byte   [12b5] (建立檔案時的主角編號)
//   +0x01        10 x 15  各格標頭: 12 bytes 日期字串 "dd/ mm/yyyy\0", +12 港口 (FF=海上), +13 旗標 (2/3 顯示 *), +14
//   +0x97        10 x 0x8074  各格內容 = DS:0CA4..8D18
// 瀏覽器版把整個檔案以原格式存進 localStorage; 第一次啟動時用 assets/save/KOUKAI2.DAT (原機磁碟上的檔案) 當作磁碟內容,
// 沒有時則和原版一樣建立新檔 (10 格空白標頭 + 初值狀態)。
import { STATE_SIZE } from "./state.js";

export const HEADER_OFF = 1, HEADER_SIZE = 15, SLOTS = 10, SLOT_OFF = 0x97, SLOT_SIZE = STATE_SIZE;
export const FILE_SIZE = SLOT_OFF + SLOTS * SLOT_SIZE;
const KEY = "uw2.KOUKAI2.DAT";

function toB64(u8) { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); }
function fromB64(s) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i); return u; }

export class SaveFile {
  constructor(bytes) { this.b = bytes; }
  // 170dc: 開啟; 不存在就建立
  static async open(ASSETS, initState) {
    const st = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (st) return new SaveFile(fromB64(st));
    try {
      const r = await fetch(ASSETS + "/save/KOUKAI2.DAT");
      if (r.ok) { const f = new SaveFile(new Uint8Array(await r.arrayBuffer())); f.flush(); return f; }
    } catch (e) { /* 無檔 */ }
    return SaveFile.create(initState);
  }
  static create(initState) {
    const b = new Uint8Array(FILE_SIZE);
    b[0] = initState[0x12b5 - 0x0ca4];
    for (let i = 0; i < SLOTS; i++) b.set(initState.subarray(0, SLOT_SIZE), SLOT_OFF + i * SLOT_SIZE);
    const f = new SaveFile(b); f.flush(); return f;
  }
  flush() { try { localStorage.setItem(KEY, toB64(this.b)); } catch (e) { /* 配額不足等: 僅保留於記憶體 */ } }
  headers() { return this.b.slice(HEADER_OFF, HEADER_OFF + SLOTS * HEADER_SIZE); }      // 16a03 讀 150 bytes
  header(i) { return this.b.subarray(HEADER_OFF + i * HEADER_SIZE, HEADER_OFF + (i + 1) * HEADER_SIZE); }
  slot(i) { return this.b.subarray(SLOT_OFF + i * SLOT_SIZE, SLOT_OFF + (i + 1) * SLOT_SIZE); }
  writeSlot(i, header15, state) { this.b.set(header15, HEADER_OFF + i * HEADER_SIZE); this.b.set(state.subarray(0, SLOT_SIZE), SLOT_OFF + i * SLOT_SIZE); this.flush(); }
}
