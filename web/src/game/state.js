// state.js — 遊戲狀態 (原版 DGROUP 0x0CA4..0x8D18 的鏡像, 0x8074 bytes)
// 原版把所有可存檔的遊戲狀態放在 DS:0CA4 起的連續區域, 存檔就是把這塊原樣寫進 KOUKAI2.DAT。
// 這裡以「原版 DS 位址」存取, 方便與逆向筆記逐一對照; 之後會逐步加上具名存取器 (港口/人物/船隻...)。
import { WorldModel, DS } from "../model/schema_views.ts";

export const STATE_BASE = DS.STATE_BASE, STATE_END = DS.STATE_END, STATE_SIZE = STATE_END - STATE_BASE;   // 0x8074
export const STATE_LOAD_SIZE = 0x8a18 - STATE_BASE;    // 讀檔時直接覆蓋 DS 的部分 (0x7D74); 其後 0x300 bytes 讀入緩衝 [0c8e]

export class GameState {
  // schema: assets/data/schema.json (可省略; 提供時可用表名/欄位名存取)
  constructor(bytes, schema = null) {
    this.b = new Uint8Array(STATE_SIZE); if (bytes) this.b.set(bytes.subarray(0, STATE_SIZE));
    this.schema = schema;
    this.T = schema ? Object.fromEntries(schema.tables.map(t => [t.name, t])) : {};
    this._model = null;
  }
  /** 強型別具名狀態存取層 (零拷貝代理到底層 Uint8Array) */
  get model() { return (this._model ??= new WorldModel(this)); }
  // 表記錄位址 (= MAIN.EXE 存取函式的結果)
  rec(table, i) { const t = this.T[table]; if (!t || i < 0 || i >= t.count) throw new Error(`${table}[${i}]`); return t.ds + i * t.stride; }
  // 以欄位名讀寫數值欄位 (u8 / u16, 陣列欄位用 k)
  field(table, i, name, k = 0) {
    const f = this.T[table].fields.find(f => f.name === name), a = this.rec(table, i) + f.off;
    return f.type === "u16" ? this.u16(a + k * 2) : this.u8(a + k);
  }
  setField(table, i, name, v, k = 0) {
    const f = this.T[table].fields.find(f => f.name === name), a = this.rec(table, i) + f.off;
    if (f.type === "u16") this.set16(a + k * 2, v); else this.set8(a + k, v);
  }
  static inRange(ds) { return ds >= STATE_BASE && ds < STATE_END; }
  u8(ds) { return this.b[ds - STATE_BASE]; }
  set8(ds, v) { this.b[ds - STATE_BASE] = v & 0xff; }
  u16(ds) { const o = ds - STATE_BASE; return this.b[o] | (this.b[o + 1] << 8); }
  set16(ds, v) { const o = ds - STATE_BASE; this.b[o] = v & 0xff; this.b[o + 1] = (v >> 8) & 0xff; }
  bytes(ds, n) { const o = ds - STATE_BASE; return this.b.subarray(o, o + n); }
  cstr(ds) { const o = ds - STATE_BASE; let e = o; while (this.b[e]) e++; return this.b.subarray(o, e + 1); }   // 含結尾 0
  // ---- 已確認的欄位 ----
  get options() { return this.u8(0x0ca4); }          // [0ca4] 環境設定位元: 1 動畫效果, 4 背景音樂, 8 效果音 ...
  set options(v) { this.set8(0x0ca4, v); }
  get year() { return this.u8(0x0caa); }              // [0caa..0cad] 年(相對)/月/日/時刻 — 讀檔後複製到 [0532..0535]
  get month() { return this.u8(0x0cab); }
  get day() { return this.u8(0x0cac); }
  get time() { return this.u8(0x0cad); }
  get port() { return this.u8(0x0cae); }              // [0cae] 目前港口, 0xFF = 海上
  get weather() { return this.u8(0x0cb3); }           // [0cb3] 天候
  get hero() { return this.u8(0x12b5); }              // [12b5] 主角編號 (0..5)
  // seg0:5c9a 港口 DS:5F54 + n*16h (+4 = 港名); seg0:5bf8 人物 DS:12B6 + n*32h
  portRecord(n) { return 0x5f54 + n * 0x16; }
  portName(n) { return this.cstr(this.portRecord(n) + 4); }
  personRecord(n) { return 0x12b6 + n * 0x32; }
}
