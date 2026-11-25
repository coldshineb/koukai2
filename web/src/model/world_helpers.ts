// model/world_helpers.ts — 强类型领域视图辅助函数（封装尚未纳入自动生成 schema_views 的复合读取，消除业务层裸 0x 偏移）
import {
  BarmaidView,
  CountryView,
  DS,
  OFF,
  FleetView,
  PersonView,
  PortEconomyView,
  ShipSlotView,
  ShipView,
  WorldModel,
} from "./schema_views.ts";
import { WorkDS } from "./flags.ts";

export const WorldConst = {
  NORMAL_PORTS: 100,
  TOTAL_PORTS: 130,
  TOTAL_DISCOVERIES: 100,
  TOTAL_ITEMS: 100,
  TOTAL_FLEETS: 70,
  TOTAL_PERSONS: 120,
  TOTAL_BARMAIDS: 24,
  TOTAL_NOBLES: 20,
  TOTAL_COUNTRIES: 6,
  TOTAL_SHIP_TYPES: 25,
  TOTAL_DOCK_SLOTS: 30,
  FLEET_RECORD_SIZE: 0x85,
  PERSON_RECORD_SIZE: 0x32,
  SHIP_SLOT_SIZE: 0x09,
  PORT_DISCOVERED_BIT: 0x10,
  PORT_OWNER_MASK: 0x07,
  DISCOVERY_CHART_BIT: 0x40,
  SHIP_LARGE_BIT: 0x10,
} as const;

/** 由人物地址构造 PersonView（供尚未脱离地址参数的场景过渡使用） */
export function personByAddr(m: WorldModel, addr: number): PersonView {
  return new PersonView(m.st, addr);
}

/** 由舰队地址构造 FleetView */
export function fleetByAddr(m: WorldModel, addr: number): FleetView {
  return new FleetView(m.st, addr);
}

/** 由船位地址构造 ShipSlotView */
export function shipSlotByAddr(m: WorldModel, addr: number): ShipSlotView {
  return new ShipSlotView(m.st, addr);
}

/** 舰队内第 slot 艘船的船位视图 (0..9) */
export function fleetShipSlot(fleet: FleetView, slot: number): ShipSlotView {
  return new ShipSlotView(fleet.st, fleet.addr + OFF.FLEET.SHIPS + slot * WorldConst.SHIP_SLOT_SIZE);
}

/** 当前主角所属舰队 */
export function heroFleet(m: WorldModel): FleetView {
  return m.fleet(m.heroPerson().fleet);
}

/** 主角舰队船位 (0..9) 或船坞寄存船位 (10..39) */
export function heroOrDockSlot(m: WorldModel, slot: number): ShipSlotView {
  return slot < 10 ? fleetShipSlot(heroFleet(m), slot) : m.dockSlot(slot - 10);
}

/** 写入出航天数 */
export function setDaysAtSea(m: WorldModel, days: number): void {
  m.st.set8(DS.DAYS_AT_SEA, days);
}

/** 取得人物记录原始字节（供头像合成器读取） */
export function personRawBytes(p: PersonView): Uint8Array {
  return p.st.bytes(p.addr, WorldConst.PERSON_RECORD_SIZE);
}

/** 海上气象、海流与出航天数 */
export function getSeaEnv(m: WorldModel) {
  const a = m.globals.portFlags;
  const b = m.st.u8(DS.WIND_CUR);
  return {
    windDir: (a & 0x38) >> 3,
    windStr: a & 7,
    curDir: (b & 0x38) >> 3,
    curStr: b & 7,
    daysAtSea: m.st.u8(DS.DAYS_AT_SEA),
  };
}

/** 世界航海图 (90×45) 某格是否已探索 (MSB 优先) */
export function isWorldCellExplored(m: WorldModel, col: number, row: number): boolean {
  if (row < 0 || row >= 45) return false;
  const c0 = ((col % 90) + 90) % 90;
  return (m.st.u8(WorkDS.EXPLORE_MAP + 12 * row + (c0 >> 3)) & (0x80 >> (c0 & 7))) !== 0;
}

/** 共用剧本（工作 / 国王召见 / 探索进度）状态 */
export function getWorkState(m: WorldModel) {
  const st = m.st;
  return {
    flags: st.u8(WorkDS.FLAGS),
    curKind: st.u16(WorkDS.CUR_KIND),
    curParam: st.u16(WorkDS.CUR_PARAM),
    targetPort: st.u16(WorkDS.TARGET_PORT),
    targetPerson: st.u16(WorkDS.TARGET_PERSON),
    targetItem: st.u8(WorkDS.TARGET_ITEM),
    royalChap: st.u8(WorkDS.ROYAL_CHAP),
    exploreTotal: st.u16(WorkDS.EXPLORE_TOTAL),
    exploreUnrep: st.u16(WorkDS.EXPLORE_UNREP),
    kindAt: (i: number) => st.u16(WorkDS.KINDS + i * 2),
    paramAt: (i: number) => st.u16(WorkDS.PARAMS + i * 2),
  };
}

/** 航海日志第 index 笔 (0..47) */
export function getTradeLogEntry(m: WorldModel, index: number) {
  const base = DS.TRADE_LOGS + index * 16;
  const st = m.st;
  return {
    dateWord: st.u16(base),
    type: st.u16(base + 2),
    argU8: (off: number) => st.u8(base + 4 + off),
    argU16: (off: number) => st.u16(base + 4 + off),
    argI32HiLo: (off: number) => ((st.u16(base + 4 + off + 2) | (st.u16(base + 4 + off) << 16)) | 0),
  };
}

/** 有符号 16 位转换 */
export function toS16(v: number): number {
  return (v << 16) >> 16;
}

/** 由酒馆女郎地址构造 BarmaidView */
export function barmaidByAddr(m: WorldModel, addr: number): BarmaidView {
  return new BarmaidView(m.st, addr);
}

/** 国家记录补充字段（敌对国、重点港、援助清零） */
export function getCountryExtra(country: CountryView) {
  return {
    get rival(): number { return country.st.u8(country.addr + 2); },
    set rival(v: number) { country.st.set8(country.addr + 2, v); },
    get keyPort(): number { return country.st.u8(country.addr + 4); },
    clearAidExtra(): void { country.st.set8(country.addr + 6, 0); },
  };
}

/** 港口经济补充字段（造船地域表索引、造船剩余天数） */
export function getPortEcoExtra(eco: PortEconomyView) {
  return {
    get shipRegion(): number { return eco.st.u8(eco.addr + 0x22); },
    get buildDays(): number { return eco.st.u8(eco.addr + 0x23); },
  };
}

/** 写入舰船名称字节（最多 14 字节 + 0 终止符） */
export function writeShipName(ship: ShipView, encodedBytes: Uint8Array): void {
  const bts = encodedBytes.subarray(0, 14);
  for (let i = 0; i < bts.length; i++) ship.st.set8(ship.addr + i, bts[i]);
  ship.st.set8(ship.addr + bts.length, 0);
}

/** 写入当前工作参数 */
export function setWorkCurParam(m: WorldModel, v: number): void {
  m.st.set16(WorkDS.CUR_PARAM, v);
}

/** 写入未报告探索格数 */
export function setExploreUnrep(m: WorldModel, v: number): void {
  m.st.set16(WorkDS.EXPLORE_UNREP, v);
}

/** 完成世界地图后全量点亮 90×45 探索位图 */
export function revealEntireWorldMap(m: WorldModel): void {
  for (let r = 0; r < 45; r++) {
    for (let k = 0; k < 11; k++) m.st.set8(WorkDS.EXPLORE_MAP + r * 12 + k, 0xff);
    m.st.set8(WorkDS.EXPLORE_MAP + r * 12 + 11, 0xc0);
  }
}

/** 读取/写入清单选择窗口参数 (DS:0x10a8 + k * 10) */
export function getListParam(m: WorldModel, kind: number, fieldIdx: number): number {
  return toS16(m.st.u16(0x10a8 + kind * 10 + fieldIdx * 2));
}

export function setListParam(m: WorldModel, kind: number, fieldIdx: number, v: number): void {
  m.st.set16(0x10a8 + kind * 10 + fieldIdx * 2, v);
}
