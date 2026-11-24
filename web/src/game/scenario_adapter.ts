// game/scenario_adapter.ts — 劇本 VM 的記憶體位址橋接層
// 把 SNR 劇本對原版 DS 位址的讀寫 (rd8/wr8/rd16/wr16 與 31f0b 記錄表索引) 獨立封裝,
// 讓階段 3–5 切換至純 JSON 狀態物件時, 只需替換此適配器而無需改動劇本指令直譯器。
import { DS } from "../model/schema_views.ts";

export const SC_STRBUF = 0x041e;
export const SC_STRLEN = 0x100;
export const SC_COLONY = 0xbb64;

// 31f0b 記錄種類 → [基底, 每筆大小] (7 = 艦隊船位, 18 = COLONY.DAT 記錄, 另行處理)
export const SC_KINDS: ReadonlyArray<readonly [number, number] | null> = [
  [DS.TBL_COUNTRY, 0x20], [DS.TBL_HERO_DATA, 0x0e], [DS.MONEY, 0], [DS.TBL_PERSON, 0x32],
  [DS.TBL_NOBLE, 0x16], [DS.TBL_BARMAID, 0x13], [DS.DAYS_AT_SEA, 0], null,
  [DS.TBL_FLEET, 0x85], [DS.TBL_CREW_SLOT, 0x1e], [DS.TBL_SHIP, 0x16], [DS.TBL_SHIP_TYPE, 0x0c],
  [DS.TBL_PORT, 0x16], [DS.TBL_PORT_ECONOMY, 0x25], [DS.TBL_REGION_PRICE, 0x80], [DS.TBL_USED_SHIP_CACHE, 8],
  [DS.TBL_DISCOVERY, 7], [DS.TBL_ITEM, 0x14], null, [0xbd06, 2],
];

export class ScenarioMemoryAdapter {
  readonly c: any;
  readonly extra = new Uint8Array(0x10000);
  readonly str = new Uint8Array(SC_STRLEN);
  readonly onTodo: (msg: string) => void;

  constructor(ctx: any, onTodo: (msg: string) => void) {
    this.c = ctx;
    this.onTodo = onTodo;
  }
  get st() { return this.c.state; }

  rd8(a: number): number {
    a &= 0xffff;
    if (a >= DS.STATE_BASE && a < DS.STATE_END) return this.st.u8(a);
    if (a >= SC_STRBUF && a < SC_STRBUF + SC_STRLEN) return this.str[a - SC_STRBUF];
    if (a >= 0x0532 && a < 0x0536) {
      const r = this.c.rt;
      return [r.year, r.month, r.day, r.time][a - 0x0532] & 0xff;
    }
    if (a >= 0x0538 && a < 0x0538 + 0x100) {
      const p = this.c.persons || [], i = (a - 0x0538) >> 1;
      return ((p[i] ?? 0) >> ((a & 1) * 8)) & 0xff;
    }
    if (a >= SC_COLONY && a < SC_COLONY + 0xb1) return this.extra[a];
    this.onTodo("劇本讀取 DS:" + a.toString(16));
    return this.extra[a];
  }

  wr8(a: number, v: number): void {
    a &= 0xffff; v &= 0xff;
    if (a >= DS.STATE_BASE && a < DS.STATE_END) { this.st.set8(a, v); return; }
    if (a >= SC_STRBUF && a < SC_STRBUF + SC_STRLEN) { this.str[a - SC_STRBUF] = v; return; }
    if (a >= 0x0532 && a < 0x0536) {
      this.c.rt[["year", "month", "day", "time"][a - 0x0532]] = v;
      return;
    }
    this.onTodo("劇本寫入 DS:" + a.toString(16));
    this.extra[a] = v;
  }

  rd16(a: number): number { return this.rd8(a) | (this.rd8(a + 1) << 8); }
  wr16(a: number, v: number): void { this.wr8(a, v); this.wr8(a + 1, v >> 8); }

  colonyRead(i: number): void {
    const c = this.c, col = c.portAssets?.colony;
    if (!col || i >= col.length) return;
    const r = (c._colony ??= [])[i] ??= c.font.encode(col[i]);
    for (let k = 0; k < 0xb1; k++) this.extra[SC_COLONY + k] = r[k] ?? 0;
  }

  recordAddr(kind: number, i: number, field: number): number {
    let base = 0;
    if (kind === 7) {
      base = i < 10
        ? DS.TBL_FLEET + this.st.u8(this.st.personRecord(this.st.hero) + 0x2c) * 0x85 + 0x2b + 9 * i
        : 0x572a + 9 * i;
    } else if (kind === 18) {
      this.colonyRead(i);
      base = SC_COLONY;
    } else if (kind < 20) {
      const ent = SC_KINDS[kind];
      if (ent) base = ent[0] + ent[1] * i;
    }
    return (base + field) & 0xffff;
  }
}
