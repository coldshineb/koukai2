// game/scenario_adapter.ts — 剧本 VM 的内存地址桥接层
// 把 SNR 剧本对原版 DS 地址的读写 (rd8/wr8/rd16/wr16 与 31f0b 记录表索引) 独立封装,
// 让阶段 3–5 切换至纯 JSON 状态对象时, 只需替换此适配器而无需改动剧本指令解释器。
import { DS } from "../model/schema_views.ts";
import { WorkDS } from "../model/flags.ts";
import { heroOrDockSlot } from "../model/world_helpers.ts";

export interface ScenarioEnv {
  readonly name: string;
  readonly ch: number;
  readonly flags: number;
  readonly vars: number;
  readonly event: number;
  readonly portMax: number;
  readonly addTime: boolean;
}

export const ENV_COMMON: ScenarioEnv = { name: "SNR0", ch: DS.COMMON_CHAP, flags: 0x0d60, vars: WorkDS.KINDS, event: 0x0de6, portMax: 0x82, addTime: false };
export const ENV_HERO: ScenarioEnv = { name: "SNRn", ch: DS.HERO_CHAP, flags: 0x0cd6, vars: 0x0cde, event: 0x0d5c, portMax: 0x64, addTime: true };

export const SC_STRBUF = 0x041e;
export const SC_STRLEN = 0x100;
export const SC_COLONY = 0xbb64;

// 31f0b 记录种类 → [基底, 每笔大小] (7 = 舰队船位, 18 = COLONY.DAT 记录, 另行处理)
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

  clearEvent(env: ScenarioEnv): void { this.st.set16(env.event, 0); }
  getChapter(env: ScenarioEnv): { chap: number; sec: number } {
    return { chap: this.st.u8(env.ch), sec: this.st.u8(env.ch + 1) };
  }
  setChapter(env: ScenarioEnv, chap: number, sec: number): void {
    this.st.set8(env.ch, chap);
    this.st.set8(env.ch + 1, sec);
  }

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
      base = heroOrDockSlot(this.st.model, i).addr;
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
