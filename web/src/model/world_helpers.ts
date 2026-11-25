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

/** 主角舰队船位 (0..9) */
export function heroShipSlot(m: WorldModel, slot: number): ShipSlotView {
  return fleetShipSlot(heroFleet(m), slot);
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
    get flags(): number { return st.u8(WorkDS.FLAGS); },
    set flags(v: number) { st.set8(WorkDS.FLAGS, v); },
    get curKind(): number { return st.u16(WorkDS.CUR_KIND); },
    get curParam(): number { return st.u16(WorkDS.CUR_PARAM); },
    set curParam(v: number) { st.set16(WorkDS.CUR_PARAM, v); },
    get targetPort(): number { return st.u16(WorkDS.TARGET_PORT); },
    set targetPort(v: number) { st.set16(WorkDS.TARGET_PORT, v); },
    get targetPerson(): number { return st.u16(WorkDS.TARGET_PERSON); },
    set targetPerson(v: number) { st.set16(WorkDS.TARGET_PERSON, v); },
    get targetItem(): number { return st.u8(WorkDS.TARGET_ITEM); },
    get targetItemWord(): number { return st.u16(WorkDS.TARGET_ITEM); },
    set targetItemWord(v: number) { st.set16(WorkDS.TARGET_ITEM, v); },
    get rewardScale(): number { return st.u16(0x0d8e); },
    get randRange(): number { return st.u16(WorkDS.RAND_RANGE); },
    get royalChap(): number { return st.u8(WorkDS.ROYAL_CHAP); },
    get commonEvent(): number { return st.u16(0x0de6); },
    get heroEvent(): number { return st.u16(0x0d5c); },
    get commonBattleTarget(): number { return st.u16(0x0de0); },
    set commonBattleTarget(v: number) { st.set16(0x0de0, v); },
    get heroBattleTarget(): number { return st.u16(0x0d56); },
    set heroBattleTarget(v: number) { st.set16(0x0d56, v); },
    get exploreTotal(): number { return st.u16(WorkDS.EXPLORE_TOTAL); },
    get exploreUnrep(): number { return st.u16(WorkDS.EXPLORE_UNREP); },
    set exploreUnrep(v: number) { st.set16(WorkDS.EXPLORE_UNREP, v); },
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
    set keyPort(v: number) { country.st.set8(country.addr + 4, v); },
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

/** 写入海流字节 */
export function setWindCurrent(m: WorldModel, v: number): void {
  m.st.set8(DS.WIND_CUR, v);
}

/** 读取/写入出航天数 */
export function getDaysAtSea(m: WorldModel): number {
  return m.st.u8(DS.DAYS_AT_SEA);
}

/** 读取/写入每日冷却计数器 (DS:0x10a6) */
export function getSeaCooldown(m: WorldModel): number {
  return m.st.u8(DS.COOLDOWN_10A6);
}
export function setSeaCooldown(m: WorldModel, v: number): void {
  m.st.set8(DS.COOLDOWN_10A6, v);
}

/** 港口经济造船倒数天数写入 */
export function setPortBuildDays(eco: PortEconomyView, days: number): void {
  eco.st.set8(eco.addr + 0x23, days);
}

/** 人物附加读写 (stats 12 字节名/13 字节姓全量写入) */
export function writePersonNamePart(p: PersonView, isFamily: boolean, src: Uint8Array, offset = 0): void {
  const base = p.addr + (isFamily ? OFF.PERSON.FAMILY_NAME : OFF.PERSON.GIVEN_NAME);
  for (let i = 0; i < 13; i++) p.st.set8(base + i, src[offset + i] ?? 0);
}

/** 读取/写入 32 位金钱（与 GlobalsView.money 同步） */
export function setHeroMoney(m: WorldModel, v: number): void {
  const clamped = v > 600_000_000 ? 600_000_000 : v;
  m.st.set16(DS.MONEY, clamped & 0xffff);
  m.st.set16(0x12b0, (clamped >>> 16) & 0xffff);
}

/** 写入工作标志 / 章节字节（仅限原版状态区间） */
export function clearTradeLogsBuffer(m: WorldModel): Uint8Array {
  const off = DS.TRADE_LOGS - DS.STATE_BASE;
  m.st.b.fill(0xff, off, off + 0x300);
  return m.st.b.slice(off, off + 0x300);
}

export function clearExploreMap(m: WorldModel): void {
  const off = WorkDS.EXPLORE_MAP - DS.STATE_BASE;
  m.st.b.fill(0, off, off + 0x21c);
}

export function markWorldCellExplored(m: WorldModel, col: number, row: number): void {
  const a = WorkDS.EXPLORE_MAP + (col >> 3) + row * 12;
  m.st.set8(a, m.st.u8(a) | (0x80 >> (col & 7)));
  m.st.set16(WorkDS.EXPLORE_TOTAL, m.st.u16(WorkDS.EXPLORE_TOTAL) + 1);
}

export function markExploreLocationNode(m: WorldModel, nodeIdx: number): void {
  const a = DS.EXPLORE_LOC + (nodeIdx >> 3);
  m.st.set8(a, m.st.u8(a) | (0x80 >> (nodeIdx & 7)));
}

/** 同伴薪水/贡献基准字节 (DS:0x2e39 + slot) */
export function getPartySalaryUnit(m: WorldModel, slot: number): number {
  return m.st.u8(0x2e39 + slot);
}

export function setPartySalaryUnit(m: WorldModel, slot: number, v: number): void {
  m.st.set8(0x2e39 + slot, v);
}

/** 海上补给配给比例 (DS:0x2e19 水 %, DS:0x2e1a 食物 %) */
export function getWaterRationPct(m: WorldModel): number {
  return m.st.u8(0x2e19);
}
export function setWaterRationPct(m: WorldModel, v: number): void {
  m.st.set8(0x2e19, v);
}
export function getFoodRationPct(m: WorldModel): number {
  return m.st.u8(0x2e1a);
}
export function setFoodRationPct(m: WorldModel, v: number): void {
  m.st.set8(0x2e1a, v);
}

/** 舰队补充视图 (舰员特长槽 +0x1d..+0x20 等) */
export function getFleetOfficer(fleet: FleetView, i: number): number {
  return fleet.st.u8(fleet.addr + 0x1d + i);
}
export function setFleetOfficer(fleet: FleetView, i: number, v: number): void {
  fleet.st.set8(fleet.addr + 0x1d + i, v);
}

/** 国家记录额外扩展 (方针 +3, 资金援助附加 +6, 活跃度 +9, 占领港 +0x19+i) */
export function getCountryMonthlyExtra(country: CountryView) {
  return {
    get policy(): number { return country.st.u8(country.addr + 3); },
    set policy(v: number) { country.st.set8(country.addr + 3, v); },
    get aggressiveness(): number { return country.st.u8(country.addr + 9); },
    get aidExtra(): number { return country.st.u8(country.addr + 6); },
    set aidExtra(v: number) { country.st.set8(country.addr + 6, v); },
    setCapturedPort(i: number, portId: number): void { country.st.set8(country.addr + 0x19 + i, portId); },
  };
}

/** 读人物任意偏移字节 (仅限未命名字节如 +0x1b, 待后续具名化) */
export function getPersonByte(p: PersonView, off: number): number {
  return p.st.u8(p.addr + off);
}

/** 写入一笔航海日志到 48 笔环形缓冲 (满时整体前移) */
export function appendTradeLog(
  m: WorldModel,
  rt: { year: number; month: number; day: number },
  kind: number,
  g: number,
  price: number,
  amount: number,
  a6 = 0,
): void {
  const st = m.st, B = DS.TRADE_LOGS, N = 48;
  let i = 0;
  while (i < N && st.u16(B + i * 16) !== 0xffff) i++;
  if (i === N) {
    st.b.copyWithin(B - DS.STATE_BASE, B - DS.STATE_BASE + 16, B - DS.STATE_BASE + 0x300);
    i = N - 1;
  }
  const a = B + i * 16;
  st.set16(a, (((((12 * rt.year) & 0xffff) + rt.month) * 31) & 0xffff) + rt.day);
  st.set16(a + 2, kind);
  st.set16(a + 4, g);
  st.set16(a + 6, a6);
  st.set16(a + 8, price);
  st.set16(a + 10, amount);
}

/** 港内 NPC 坐标/朝向 (DS:0x0cbc + i * 3) */
export function getPortNpc(m: WorldModel, i: number) {
  const a = 0x0cbc + i * 3;
  return { x: m.st.u8(a), y: m.st.u8(a + 1), d: m.st.u8(a + 2) };
}

export function setPortNpc(m: WorldModel, i: number, field: number, v: number): void {
  m.st.set8(0x0cbc + i * 3 + field, v);
}

/** 写入港口名称字节 */
export function writePortName(port: { st: { set8(a: number, v: number): void }; addr: number }, src: Uint8Array): void {
  for (let i = 0; i < src.length; i++) port.st.set8(port.addr + 4 + i, src[i]);
  if (!src.length || src[src.length - 1] !== 0) port.st.set8(port.addr + 4 + src.length, 0);
}

/** 交换两个船位 (0..39) 的船位记录 (9B) 与船员配置记录 (30B) */
export function swapShipAndCrewSlots(m: WorldModel, a: number, b: number): void {
  const sa = heroOrDockSlot(m, a), sb = heroOrDockSlot(m, b);
  for (let k = 0; k < WorldConst.SHIP_SLOT_SIZE; k++) {
    const t = sa.st.u8(sa.addr + k);
    sa.st.set8(sa.addr + k, sb.st.u8(sb.addr + k));
    sb.st.set8(sb.addr + k, t);
  }
  const ca = m.crewSlot(a), cb = m.crewSlot(b);
  for (let k = 0; k < 0x1e; k++) {
    const t = ca.st.u8(ca.addr + k);
    ca.st.set8(ca.addr + k, cb.st.u8(cb.addr + k));
    cb.st.set8(cb.addr + k, t);
  }
}

/** 反转精灵动画相位标志 (DS:0x8b1e) */
export function toggleSpritePhase(m: WorldModel): void {
  m.st.set8(0x8b1e, m.st.u8(0x8b1e) ^ 1);
}

/** 舰队自动航行路线模式与 Bresenham 误差寄存器 (+0x0d/+0x0e) */
export function getFleetRouteExtra(fleet: FleetView) {
  return {
    get routeMode(): number { return fleet.st.u8(fleet.addr + 0x0d); },
    set routeMode(v: number) { fleet.st.set8(fleet.addr + 0x0d, v); },
    get routeErr(): number { return fleet.st.u16(fleet.addr + 0x0e); },
    set routeErr(v: number) { fleet.st.set16(fleet.addr + 0x0e, v); },
  };
}

/** 探索世界地图网格：若该格尚未探索，置位并递增总探索数与未报告格数 */
export function discoverWorldCellIfUnseen(m: WorldModel, col: number, row: number): void {
  if (row < 0 || row >= 45) return;
  const c0 = ((col % 90) + 90) % 90;
  const a = WorkDS.EXPLORE_MAP + 12 * row + (c0 >> 3);
  const bit = 0x80 >> (c0 & 7);
  if (!(m.st.u8(a) & bit)) {
    m.st.set16(WorkDS.EXPLORE_TOTAL, m.st.u16(WorkDS.EXPLORE_TOTAL) + 1);
    m.st.set16(WorkDS.EXPLORE_UNREP, m.st.u16(WorkDS.EXPLORE_UNREP) + 1);
  }
  m.st.set8(a, m.st.u8(a) | bit);
}

/** 地点探索位图查询 (DS:0x1046) */
export function isExploreLocationNodeMarked(m: WorldModel, nodeIdx: number): boolean {
  return (m.st.u8(DS.EXPLORE_LOC + (nodeIdx >> 3)) & (0x80 >> (nodeIdx & 7))) !== 0;
}

/** 海上特殊事件/海怪触发点 (DS:0x1012 + 4*i, 事件编号 0x103a + i, 当前序号 0x1044) */
export function getSeaEncounter(m: WorldModel, i: number) {
  const st = m.st;
  return {
    get x(): number { return st.u16(0x1012 + 4 * i); },
    set x(v: number) { st.set16(0x1012 + 4 * i, v); },
    get y(): number { return st.u16(0x1014 + 4 * i); },
    set y(v: number) { st.set16(0x1014 + 4 * i, v); },
    get eventId(): number { return st.u8(0x103a + i); },
    set eventId(v: number) { st.set8(0x103a + i, v); },
  };
}

export function getSeaEncounterIndex(m: WorldModel): number {
  return m.st.u8(0x1044);
}

export function setSeaEncounterIndex(m: WorldModel, v: number): void {
  m.st.set8(0x1044, v);
}

/** 将中古船缓存第 slotIdx 项（8B）提升至第 0 格 */
export function promoteUsedShipCache(m: WorldModel, slotIdx: number): void {
  const base = DS.TBL_USED_SHIP_CACHE;
  const copy8 = (d: number, s: number) => {
    for (let k = 0; k < 8; k++) m.st.set8(d + k, m.st.u8(s + k));
  };
  const tmp = m.st.bytes(base + slotIdx * 8, 8).slice();
  for (let k = slotIdx; k > 0; k--) copy8(base + k * 8, base + (k - 1) * 8);
  for (let k = 0; k < 8; k++) m.st.set8(base + k, tmp[k]);
}

/** 中古船缓存整体后移 1 格，准备填入新进港的数据 */
export function shiftUsedShipCache(m: WorldModel): void {
  const base = DS.TBL_USED_SHIP_CACHE;
  for (let k = 2; k > 0; k--) {
    for (let i = 0; i < 8; i++) m.st.set8(base + k * 8 + i, m.st.u8(base + (k - 1) * 8 + i));
  }
}

/** 读取 DS 低区表或状态区单字节（复刻 fleetSpeed 越界查表兼容） */
export function readDsLowOrStateByte(m: WorldModel, dsLow: Uint8Array, addr: number): number {
  const a = addr & 0xffff;
  if (a >= DS.OPTIONS && a < DS.TRADE_LOGS) return m.st.u8(a);
  return dsLow[a] ?? 0;
}
