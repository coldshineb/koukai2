// schema_views.ts — 由 tools/gen_model.py 依 assets/data/schema.json 自動產生; 請勿手改
// 零拷貝強型別具名存取層: 過渡期底層直接讀寫原版 GameState.b (Uint8Array), 確保差分回歸 100% 一致。

export interface StateBuffer {
  readonly b: Uint8Array;
  u8(ds: number): number;
  set8(ds: number, v: number): void;
  u16(ds: number): number;
  set16(ds: number, v: number): void;
  bytes(ds: number, n: number): Uint8Array;
  cstr(ds: number): Uint8Array;
}

/** 原版 DGROUP 位址常數 (供過渡期對照與劇本 VM 橋接使用) */
export const DS = {
  STATE_BASE: 0x0ca4,
  STATE_END: 0x8d18,
  NPCS: 0x0cbc,            // 港內行人 (8 × 3 bytes)
  WIND_CUR: 0x0cb2,        // 海流 (u8)
  EXPLORE_LOC: 0x1046,     // 已探索地點位元表
  COOLDOWN_10A6: 0x10a6,   // 每日倒數計數器
  DAYS_AT_SEA: 0x2e18,     // 出港天數 (u8)
  PARTY_CREW: 0x2e1b,      // 同伴人物編號 (30 格, FF=空)
  INVENTORY: 0x2e57,       // 主角隨身物道具編號 (20 格, FF=空)
  TRADE_LOGS: 0x8a18,      // 航海日誌 / 交易記錄 (48 筆 × 16 bytes)
  OPTIONS: 0x0ca4,
  SEA_SPEED: 0x0ca6,
  MOUSE_SENS: 0x0ca8,
  SEA_SCROLL: 0x0ca9,
  YEAR: 0x0caa,
  MONTH: 0x0cab,
  DAY: 0x0cac,
  TIME: 0x0cad,
  PORT: 0x0cae,
  LAST_PORT: 0x0caf,
  DAILY_FLAGS: 0x0cb0,
  PORT_FLAGS: 0x0cb1,
  WEATHER: 0x0cb3,
  PORT_VIEW_X: 0x0cb4,
  PORT_VIEW_Y: 0x0cb6,
  HERO_WIN_X: 0x0cb8,
  HERO_WIN_Y: 0x0cba,
  HERO_CHAP: 0x0cd4,
  HERO_SEC: 0x0cd5,
  COMMON_CHAP: 0x0d5e,
  COMMON_SEC: 0x0d5f,
  SEA_FLAGS: 0x1004,
  SEA_FLAGS2: 0x1005,
  SEA_VIEW_X: 0x1006,
  SEA_VIEW_Y: 0x1008,
  MONEY: 0x12ae,
  BANK_QUOTIENT: 0x12b2,
  BANK_REM: 0x12b4,
  HERO: 0x12b5,
  DISCOVERY_ID: 0x8246,
  TBL_COUNTRY: 0x117a,
  TBL_HERO_DATA: 0x125a,
  TBL_PERSON: 0x12b6,
  TBL_NOBLE: 0x2a26,
  TBL_BARMAID: 0x2bde,
  TBL_FLEET: 0x2e76,
  TBL_CREW_SLOT: 0x52d4,
  TBL_DOCK_SLOT: 0x5784,
  TBL_SHIP: 0x5892,
  TBL_SHIP_TYPE: 0x5e28,
  TBL_PORT: 0x5f54,
  TBL_PORT_ECONOMY: 0x6a80,
  TBL_REGION_PRICE: 0x78f4,
  TBL_USED_SHIP_CACHE: 0x7f74,
  TBL_DISCOVERY: 0x7f8c,
  TBL_ITEM: 0x8248,
} as const;

/** 各資料表欄位偏移常數 (由 schema.json 自動產生, 供高效能/指標運算模組具名化使用) */
export const OFF = {
  COUNTRY: {
    POWER: 0x00,
    AID_MONEY_K: 0x05,
    AID_SHIP_TYPE: 0x07,
    AID_SHIP_COUNT: 0x08,
    CAPITAL_PORT: 0x0a,
    RELATIONS: 0x0b,
    TREATIES: 0x12,
  },
  HERO_DATA: {
    TRADE_FAME: 0x00,
    PIRATE_FAME: 0x02,
    ADVENTURE_FAME: 0x04,
    COUNTRY_STANDING: 0x06,
    RANK: 0x0d,
  },
  PERSON: {
    GIVEN_NAME: 0x00,
    FAMILY_NAME: 0x0d,
    PORTRAIT: 0x1a,
    STATS: 0x1c,
    NAV_LEVEL: 0x24,
    BATTLE_LEVEL: 0x25,
    NAV_EXP: 0x26,
    BATTLE_EXP: 0x28,
    AGE: 0x2a,
    LOYALTY: 0x2b,
    FLEET: 0x2c,
    STAY_PORT: 0x2d,
    ROLE: 0x2e,
    FLAGS: 0x2f,
    SKILLS: 0x30,
    FACE: 0x31,
  },
  NOBLE: {
    NAME: 0x00,
    KIND: 0x11,
    PORTRAIT: 0x12,
    FLAGS: 0x14,
    PORT: 0x15,
  },
  BARMAID: {
    NAME: 0x00,
    AGE: 0x0d,
    PORT: 0x0e,
    AFFECTION: 0x0f,
    QUEST: 0x10,
    QUEST_DAYS: 0x11,
    FLAGS: 0x12,
  },
  FLEET: {
    X: 0x00,
    Y: 0x02,
    DEST_X: 0x04,
    DEST_Y: 0x06,
    MID_X: 0x08,
    MID_Y: 0x0a,
    ROUTE_FLAGS: 0x0c,
    ROUTE_PTS: 0x10,
    SUB_X: 0x18,
    SUB_Y: 0x19,
    DIR: 0x1a,
    MISSION: 0x1b,
    TARGET: 0x1c,
    CARGO_GOOD: 0x21,
    CARGO_AMT: 0x22,
    FUNDS: 0x24,
    HOME_PORT: 0x26,
    STAY_DAYS: 0x27,
    STRENGTH: 0x28,
    FLAGS: 0x29,
    ADMIRAL: 0x2a,
    SHIPS: 0x2b,
  },
  CREW_SLOT: {
    WATER: 0x00,
    FOOD: 0x02,
    MATERIAL: 0x04,
    AMMO: 0x06,
    NAV_RATIO: 0x08,
    LOOK_RATIO: 0x09,
    LOAD_TOTAL: 0x0a,
    CARGO_AMTS: 0x0c,
    CARGO_GOODS: 0x16,
    CAPTAIN: 0x1b,
    MORALE: 0x1c,
    FIGUREHEAD: 0x1d,
  },
  DOCK_SLOT: {
    CREW: 0x00,
    DURABILITY: 0x02,
    MAX_DURABILITY: 0x03,
    TURN: 0x04,
    PROPULSION: 0x05,
    GUNS: 0x06,
    SHIP: 0x07,
    FLAGS: 0x08,
  },
  SHIP: {
    NAME: 0x00,
    TYPE: 0x0f,
    FLAGS: 0x10,
    MAX_GUNS: 0x11,
    MAX_CREW: 0x12,
    MAX_CARGO: 0x14,
  },
  SHIP_TYPE: {
    SHIP_CLASS: 0x00,
    DURABILITY: 0x01,
    TURN: 0x02,
    PROPULSION: 0x03,
    MAX_CREW_DIV10: 0x04,
    MIN_CREW: 0x05,
    CAPACITY: 0x06,
    MAX_GUNS: 0x08,
    BUILD_LEVEL: 0x09,
    PRICE: 0x0a,
  },
  PORT: {
    X: 0x00,
    Y: 0x02,
    NAME: 0x04,
    REGION: 0x15,
  },
  PORT_ECONOMY: {
    COMMERCE: 0x00,
    COMMERCE_INVEST: 0x02,
    INDUSTRY: 0x04,
    INDUSTRY_INVEST: 0x06,
    INFLUENCE: 0x08,
    PRICES: 0x0e,
    SPECIALTY_BASE: 0x18,
    SPECIALTY_GOOD: 0x1a,
    SPECIALTY_LEVEL: 0x1b,
    REGION_GROUP: 0x1c,
    SHOP_ITEMS: 0x1d,
    PRICE_REGION: 0x21,
    LIQUOR: 0x24,
  },
  REGION_PRICE: {
    SELL_BASE: 0x00,
    BUY_BASE: 0x5c,
    BUY_GOODS: 0x6e,
    BUY_LEVELS: 0x77,
  },
  USED_SHIP_CACHE: {
    SHIP_TYPES: 0x00,
    PORT: 0x05,
  },
  DISCOVERY: {
    X: 0x00,
    Y: 0x02,
    ITEM: 0x04,
    IMPORTANCE: 0x05,
    FLAGS: 0x06,
  },
  ITEM: {
    NAME: 0x00,
    ICON: 0x0f,
    PRICE_DIV100: 0x10,
    POWER: 0x12,
    KIND_FLAGS: 0x13,
  },
} as const;

export class GlobalsView {
  readonly st: StateBuffer;
  constructor(st: StateBuffer) { this.st = st; }
  /** DS:0x0ca4: 環境設定位元 (bit0動畫, bit1結局, bit2BGM, bit3效果音, bit6劇本) */
  get options(): number { return this.st.u8(0x0ca4); }
  set options(v: number) { this.st.set8(0x0ca4, v); }
  /** DS:0x0ca6: 海上速度延遲 0..10 (0最快, 10最慢) */
  get seaSpeed(): number { return this.st.u8(0x0ca6); }
  set seaSpeed(v: number) { this.st.set8(0x0ca6, v); }
  /** DS:0x0ca8: 滑鼠靈敏度 0..4 */
  get mouseSens(): number { return this.st.u8(0x0ca8); }
  set mouseSens(v: number) { this.st.set8(0x0ca8, v); }
  /** DS:0x0ca9: 海上移動值 0..10 */
  get seaScroll(): number { return this.st.u8(0x0ca9); }
  set seaScroll(v: number) { this.st.set8(0x0ca9, v); }
  /** DS:0x0caa: 年 (相對 1500; 0FEA:1681a 複製到 [0532]) */
  get year(): number { return this.st.u8(0x0caa); }
  set year(v: number) { this.st.set8(0x0caa, v); }
  /** DS:0x0cab: 月 0..11 */
  get month(): number { return this.st.u8(0x0cab); }
  set month(v: number) { this.st.set8(0x0cab, v); }
  /** DS:0x0cac: 日 0..30 */
  get day(): number { return this.st.u8(0x0cac); }
  set day(v: number) { this.st.set8(0x0cac, v); }
  /** DS:0x0cad: 時刻 0..71 (調色盤時段) */
  get time(): number { return this.st.u8(0x0cad); }
  set time(v: number) { this.st.set8(0x0cad, v); }
  /** DS:0x0cae: 目前港口, FF = 海上 */
  get port(): number { return this.st.u8(0x0cae); }
  set port(v: number) { this.st.set8(0x0cae, v); }
  /** DS:0x0caf: 上次所在港口 */
  get lastPort(): number { return this.st.u8(0x0caf); }
  set lastPort(v: number) { this.st.set8(0x0caf, v); }
  /** DS:0x0cb0: 每日重設旗標 (bit1造船廠被拒, bit6女郎見聞等) */
  get dailyFlags(): number { return this.st.u8(0x0cb0); }
  set dailyFlags(v: number) { this.st.set8(0x0cb0, v); }
  /** DS:0x0cb1: 港內狀態旗標 */
  get portFlags(): number { return this.st.u8(0x0cb1); }
  set portFlags(v: number) { this.st.set8(0x0cb1, v); }
  /** DS:0x0cb3: 天候 (0..5) */
  get weather(): number { return this.st.u8(0x0cb3); }
  set weather(v: number) { this.st.set8(0x0cb3, v); }
  /** DS:0x0cb4: 港內地圖視窗左上 X */
  get portViewX(): number { return this.st.u16(0x0cb4); }
  set portViewX(v: number) { this.st.set16(0x0cb4, v); }
  /** DS:0x0cb6: 港內地圖視窗左上 Y */
  get portViewY(): number { return this.st.u16(0x0cb6); }
  set portViewY(v: number) { this.st.set16(0x0cb6, v); }
  /** DS:0x0cb8: 主角在港內視窗的 X */
  get heroWinX(): number { return this.st.u16(0x0cb8); }
  set heroWinX(v: number) { this.st.set16(0x0cb8, v); }
  /** DS:0x0cba: 主角在港內視窗的 Y */
  get heroWinY(): number { return this.st.u16(0x0cba); }
  set heroWinY(v: number) { this.st.set16(0x0cba, v); }
  /** DS:0x0cd4: 主角專屬劇本當前章 */
  get heroChap(): number { return this.st.u8(0x0cd4); }
  set heroChap(v: number) { this.st.set8(0x0cd4, v); }
  /** DS:0x0cd5: 主角專屬劇本當前節 */
  get heroSec(): number { return this.st.u8(0x0cd5); }
  set heroSec(v: number) { this.st.set8(0x0cd5, v); }
  /** DS:0x0d5e: 共用劇本 (工作) 當前章 */
  get commonChap(): number { return this.st.u8(0x0d5e); }
  set commonChap(v: number) { this.st.set8(0x0d5e, v); }
  /** DS:0x0d5f: 共用劇本 (工作) 當前節 */
  get commonSec(): number { return this.st.u8(0x0d5f); }
  set commonSec(v: number) { this.st.set8(0x0d5f, v); }
  /** DS:0x1004: 海上狀態旗標低位元組 */
  get seaFlags(): number { return this.st.u8(0x1004); }
  set seaFlags(v: number) { this.st.set8(0x1004, v); }
  /** DS:0x1005: 海上狀態旗標高位元組 (bit3/4上陸, bit5停船) */
  get seaFlags2(): number { return this.st.u8(0x1005); }
  set seaFlags2(v: number) { this.st.set8(0x1005, v); }
  /** DS:0x1006: 世界地圖視窗左上 X */
  get seaViewX(): number { return this.st.u16(0x1006); }
  set seaViewX(v: number) { this.st.set16(0x1006, v); }
  /** DS:0x1008: 世界地圖視窗左上 Y */
  get seaViewY(): number { return this.st.u16(0x1008); }
  set seaViewY(v: number) { this.st.set16(0x1008, v); }
  /** DS:0x12ae: 所持現金 (32 位元, 上限 6 億) */
  get money(): number { return (this.st.u16(0x12ae) | (this.st.u16(0x12b0) << 16)) | 0; }
  set money(v: number) { this.st.set16(0x12ae, v & 0xffff); this.st.set16(0x12b0, (v >>> 16) & 0xffff); }
  /** DS:0x12b2: 銀行餘額 / 100 (有號 16 位元, 負為借款) */
  get bankQuotient(): number { return this.st.u16(0x12b2); }
  set bankQuotient(v: number) { this.st.set16(0x12b2, v); }
  /** DS:0x12b4: 銀行餘額餘數 (0..100) */
  get bankRem(): number { return this.st.u8(0x12b4); }
  set bankRem(v: number) { this.st.set8(0x12b4, v); }
  /** DS:0x12b5: 主角編號 0..5 */
  get hero(): number { return this.st.u8(0x12b5); }
  set hero(v: number) { this.st.set8(0x12b5, v); }
  /** DS:0x8246: 當前選中/發現物編號 (FF=無) */
  get discoveryId(): number { return this.st.u8(0x8246); }
  set discoveryId(v: number) { this.st.set8(0x8246, v); }
  /** 銀行餘額 = 100 × (有號 bankQuotient) + bankRem (負數表示借款) */
  get bankBalance(): number { const q = (this.bankQuotient << 16) >> 16; return (Math.imul(100, q) + this.bankRem) | 0; }
}

/** countries (DS:0x117a, 7 × 0x20): 6 國 + 海盜 (與名稱表 countries 同序) */
export class CountryView {
  readonly st: StateBuffer;
  readonly addr: number;
  constructor(st: StateBuffer, addr: number) { this.st = st; this.addr = addr; }
  /** +0x00: 17a80 國力/收益 */
  get power(): number { return this.st.u16(this.addr + 0x00); }
  set power(v: number) { this.st.set16(this.addr + 0x00, v); }
  /** +0x05: 2a713 資金援助 (單位: 千枚) */
  get aidMoneyK(): number { return this.st.u8(this.addr + 0x05); }
  set aidMoneyK(v: number) { this.st.set8(this.addr + 0x05, v); }
  /** +0x07: 2a79b 援助船型 */
  get aidShipType(): number { return this.st.u8(this.addr + 0x07); }
  set aidShipType(v: number) { this.st.set8(this.addr + 0x07, v); }
  /** +0x08: 2a79b 援助船數 */
  get aidShipCount(): number { return this.st.u8(this.addr + 0x08); }
  set aidShipCount(v: number) { this.st.set8(this.addr + 0x08, v); }
  /** +0x0a: 0FEA:18786 [rec+0Ah] → 港口表 (seg0:5c9a) */
  get capitalPort(): number { return this.st.u8(this.addr + 0x0a); }
  set capitalPort(v: number) { this.st.set8(this.addr + 0x0a, v); }
  /** +0x0b: 對各國友好度 (0..100) */
  getRelations(k: number): number { return this.st.u8(this.addr + 0x0b + k); }
  setRelations(k: number, v: number): void { this.st.set8(this.addr + 0x0b + k, v); }
  /** +0x12: 對各國同盟/封鎖狀態 */
  getTreaties(k: number): number { return this.st.u8(this.addr + 0x12 + k); }
  setTreaties(k: number, v: number): void { this.st.set8(this.addr + 0x12 + k, v); }
}

/** heroData (DS:0x125a, 6 × 0x0e): 6 位主角名聲、聲望與爵位 */
export class HeroDataView {
  readonly st: StateBuffer;
  readonly addr: number;
  constructor(st: StateBuffer, addr: number) { this.st = st; this.addr = addr; }
  /** +0x00: 商人名聲 (palace.js / market.js) */
  get tradeFame(): number { return this.st.u16(this.addr + 0x00); }
  set tradeFame(v: number) { this.st.set16(this.addr + 0x00, v); }
  /** +0x02: 海盜名聲 (battle.js) */
  get pirateFame(): number { return this.st.u16(this.addr + 0x02); }
  set pirateFame(v: number) { this.st.set16(this.addr + 0x02, v); }
  /** +0x04: 冒險家名聲 (house.js / land.js) */
  get adventureFame(): number { return this.st.u16(this.addr + 0x04); }
  set adventureFame(v: number) { this.st.set16(this.addr + 0x04, v); }
  /** +0x06: 對 7 國聲望/功績 */
  getCountryStanding(k: number): number { return this.st.u8(this.addr + 0x06 + k); }
  setCountryStanding(k: number, v: number): void { this.st.set8(this.addr + 0x06 + k, v); }
  /** +0x0d: 爵位 0..9 (palace.js) */
  get rank(): number { return this.st.u8(this.addr + 0x0d); }
  set rank(v: number) { this.st.set8(this.addr + 0x0d, v); }
}

/** persons (DS:0x12b6, 120 × 0x32): 人物 (主角、提督、船長、夥伴) */
export class PersonView {
  readonly st: StateBuffer;
  readonly addr: number;
  constructor(st: StateBuffer, addr: number) { this.st = st; this.addr = addr; }
  /** +0x00: 0FEA:185a7 由 NAME.TBL 隨機抽名字寫入 rec+0 */
  get givenNameBytes(): Uint8Array { return this.st.cstr(this.addr + 0x00); }
  /** +0x0d: 0FEA:185a7 寫入 rec+0Dh */
  get familyNameBytes(): Uint8Array { return this.st.cstr(this.addr + 0x0d); }
  /** +0x1a: seg0:7d39: bit14-15 ≠ 0 → 拼合頭像部件字, 否則為具名頭像編號 */
  get portrait(): number { return this.st.u16(this.addr + 0x1a); }
  set portrait(v: number) { this.st.set16(this.addr + 0x1a, v); }
  /** +0x1c: 8 項能力值 (航海術/運用術/劍術/魅力/運氣/直覺/勇氣/統率等) */
  getStats(k: number): number { return this.st.u8(this.addr + 0x1c + k); }
  setStats(k: number, v: number): void { this.st.set8(this.addr + 0x1c + k, v); }
  /** +0x24: 0FEA:1d302 MESSAGE #398「航海水平」印 rec+24h */
  get navLevel(): number { return this.st.u8(this.addr + 0x24); }
  set navLevel(v: number) { this.st.set8(this.addr + 0x24, v); }
  /** +0x25: 0FEA:1d31e MESSAGE #399「戰鬥水平」印 rec+25h */
  get battleLevel(): number { return this.st.u8(this.addr + 0x25); }
  set battleLevel(v: number) { this.st.set8(this.addr + 0x25, v); }
  /** +0x26: 航海經驗值 */
  get navExp(): number { return this.st.u16(this.addr + 0x26); }
  set navExp(v: number) { this.st.set16(this.addr + 0x26, v); }
  /** +0x28: 戰鬥經驗值 */
  get battleExp(): number { return this.st.u16(this.addr + 0x28); }
  set battleExp(v: number) { this.st.set16(this.addr + 0x28, v); }
  /** +0x2a: 年齡 (0FEA:186b1 生成 20..35) */
  get age(): number { return this.st.u8(this.addr + 0x2a); }
  set age(v: number) { this.st.set8(this.addr + 0x2a, v); }
  /** +0x2b: 忠誠度 (wharf 加薪判定 < 30) */
  get loyalty(): number { return this.st.u8(this.addr + 0x2b); }
  set loyalty(v: number) { this.st.set8(this.addr + 0x2b, v); }
  /** +0x2c: 0FEA:162f1 [rec+2Ch] → 艦隊表 (seg0:5c28); FE/FF = 無艦隊 */
  get fleet(): number { return this.st.u8(this.addr + 0x2c); }
  set fleet(v: number) { this.st.set8(this.addr + 0x2c, v); }
  /** +0x2d: 停留港口 (0xFF = 不在特定港) */
  get stayPort(): number { return this.st.u8(this.addr + 0x2d); }
  set stayPort(v: number) { this.st.set8(this.addr + 0x2d, v); }
  /** +0x2e: 職務/薪水等級 (commands.js / buildings.js) */
  get role(): number { return this.st.u8(this.addr + 0x2e); }
  set role(v: number) { this.st.set8(this.addr + 0x2e, v); }
  /** +0x2f: 人物旗標 (bit4 隱藏/不可交談, bit5 性格/AI 等) */
  get flags(): number { return this.st.u8(this.addr + 0x2f); }
  set flags(v: number) { this.st.set8(this.addr + 0x2f, v); }
  /** +0x30: 技能位元 (測量/地圖/砲術/交涉/會計) */
  get skills(): number { return this.st.u8(this.addr + 0x30); }
  set skills(v: number) { this.st.set8(this.addr + 0x30, v); }
  /** +0x31: 國籍與拼合頭像種類 (低4位=國籍/頭像種類, bit4/5 狀態) */
  get face(): number { return this.st.u8(this.addr + 0x31); }
  set face(v: number) { this.st.set8(this.addr + 0x31, v); }
}

/** nobles (DS:0x2a26, 20 × 0x16): 劇情人物與住宅主人 (0..9 住宅收藏家/製圖/學校, 10..15 各國國王) */
export class NobleView {
  readonly st: StateBuffer;
  readonly addr: number;
  constructor(st: StateBuffer, addr: number) { this.st = st; this.addr = addr; }
  /** +0x00: 記錄開頭為名稱字串 */
  get nameBytes(): Uint8Array { return this.st.cstr(this.addr + 0x00); }
  /** +0x11: 住宅種類 0=收藏家 1=製圖 2=測量校 3=砲術校 FF=國王 */
  get kind(): number { return this.st.u8(this.addr + 0x11); }
  set kind(v: number) { this.st.set8(this.addr + 0x11, v); }
  /** +0x12: KAO 具名頭像編號 */
  get portrait(): number { return this.st.u16(this.addr + 0x12); }
  set portrait(v: number) { this.st.set16(this.addr + 0x12, v); }
  /** +0x14: 合約旗標 (bit4 已簽約, 低2位酬金等級) */
  get flags(): number { return this.st.u8(this.addr + 0x14); }
  set flags(v: number) { this.st.set8(this.addr + 0x14, v); }
  /** +0x15: 所在港口 */
  get port(): number { return this.st.u8(this.addr + 0x15); }
  set port(v: number) { this.st.set8(this.addr + 0x15, v); }
}

/** barmaids (DS:0x2bde, 34 × 0x13): 酒吧女郎 (前 30 人有效; 有 0x12 bytes 尾隨資料在 2E64) */
export class BarmaidView {
  readonly st: StateBuffer;
  readonly addr: number;
  constructor(st: StateBuffer, addr: number) { this.st = st; this.addr = addr; }
  /** +0x00: 記錄開頭為名稱字串 */
  get nameBytes(): Uint8Array { return this.st.cstr(this.addr + 0x00); }
  /** +0x0d: 芳齡 (RE_NOTES 17.8) */
  get age(): number { return this.st.u8(this.addr + 0x0d); }
  set age(v: number) { this.st.set8(this.addr + 0x0d, v); }
  /** +0x0e: 所在港口 */
  get port(): number { return this.st.u8(this.addr + 0x0e); }
  set port(v: number) { this.st.set8(this.addr + 0x0e, v); }
  /** +0x0f: 好感度 (0..100) */
  get affection(): number { return this.st.u8(this.addr + 0x0f); }
  set affection(v: number) { this.st.set8(this.addr + 0x0f, v); }
  /** +0x10: 調查委託 (低4位=國家, 高4位=種類, FF=無) */
  get quest(): number { return this.st.u8(this.addr + 0x10); }
  set quest(v: number) { this.st.set8(this.addr + 0x10, v); }
  /** +0x11: 調查剩餘天數 */
  get questDays(): number { return this.st.u8(this.addr + 0x11); }
  set questDays(v: number) { this.st.set8(this.addr + 0x11, v); }
  /** +0x12: 旗標 (bit3 在店, bit4-5 性格, bit6 登場) */
  get flags(): number { return this.st.u8(this.addr + 0x12); }
  set flags(v: number) { this.st.set8(this.addr + 0x12, v); }
}

/** fleets (DS:0x2e76, 70 × 0x85): 70 支艦隊 (RE_NOTES 29.4) */
export class FleetView {
  readonly st: StateBuffer;
  readonly addr: number;
  constructor(st: StateBuffer, addr: number) { this.st = st; this.addr = addr; }
  /** +0x00: 世界座標 X */
  get x(): number { return this.st.u16(this.addr + 0x00); }
  set x(v: number) { this.st.set16(this.addr + 0x00, v); }
  /** +0x02: 世界座標 Y */
  get y(): number { return this.st.u16(this.addr + 0x02); }
  set y(v: number) { this.st.set16(this.addr + 0x02, v); }
  /** +0x04: 目的地 X */
  get destX(): number { return this.st.u16(this.addr + 0x04); }
  set destX(v: number) { this.st.set16(this.addr + 0x04, v); }
  /** +0x06: 目的地 Y */
  get destY(): number { return this.st.u16(this.addr + 0x06); }
  set destY(v: number) { this.st.set16(this.addr + 0x06, v); }
  /** +0x08: 中途點 X */
  get midX(): number { return this.st.u16(this.addr + 0x08); }
  set midX(v: number) { this.st.set16(this.addr + 0x08, v); }
  /** +0x0a: 中途點 Y */
  get midY(): number { return this.st.u16(this.addr + 0x0a); }
  set midY(v: number) { this.st.set16(this.addr + 0x0a, v); }
  /** +0x0c: 路線旗標 (RE_NOTES 28.4) */
  get routeFlags(): number { return this.st.u16(this.addr + 0x0c); }
  set routeFlags(v: number) { this.st.set16(this.addr + 0x0c, v); }
  /** +0x10: 自動航行路線地點 (最多 4 點) */
  getRoutePts(k: number): number { return this.st.u16(this.addr + 0x10 + k * 2); }
  setRoutePts(k: number, v: number): void { this.st.set16(this.addr + 0x10 + k * 2, v); }
  /** +0x18: 格內位置 X */
  get subX(): number { return this.st.u8(this.addr + 0x18); }
  set subX(v: number) { this.st.set8(this.addr + 0x18, v); }
  /** +0x19: 格內位置 Y */
  get subY(): number { return this.st.u8(this.addr + 0x19); }
  set subY(v: number) { this.st.set8(this.addr + 0x19, v); }
  /** +0x1a: 航向 0..7 */
  get dir(): number { return this.st.u8(this.addr + 0x1a); }
  set dir(v: number) { this.st.set8(this.addr + 0x1a, v); }
  /** +0x1b: 任務 0..10 */
  get mission(): number { return this.st.u8(this.addr + 0x1b); }
  set mission(v: number) { this.st.set8(this.addr + 0x1b, v); }
  /** +0x1c: 任務對象 (港口或人物) */
  get target(): number { return this.st.u8(this.addr + 0x1c); }
  set target(v: number) { this.st.set8(this.addr + 0x1c, v); }
  /** +0x21: 商船載運商品 */
  get cargoGood(): number { return this.st.u8(this.addr + 0x21); }
  set cargoGood(v: number) { this.st.set8(this.addr + 0x21, v); }
  /** +0x22: 商船載運數量 */
  get cargoAmt(): number { return this.st.u16(this.addr + 0x22); }
  set cargoAmt(v: number) { this.st.set16(this.addr + 0x22, v); }
  /** +0x24: 艦隊資金 */
  get funds(): number { return this.st.u16(this.addr + 0x24); }
  set funds(v: number) { this.st.set16(this.addr + 0x24, v); }
  /** +0x26: 母港 */
  get homePort(): number { return this.st.u8(this.addr + 0x26); }
  set homePort(v: number) { this.st.set8(this.addr + 0x26, v); }
  /** +0x27: 港口停留天數 */
  get stayDays(): number { return this.st.u8(this.addr + 0x27); }
  set stayDays(v: number) { this.st.set8(this.addr + 0x27, v); }
  /** +0x28: 戰力評估 (18299) */
  get strength(): number { return this.st.u8(this.addr + 0x28); }
  set strength(v: number) { this.st.set8(this.addr + 0x28, v); }
  /** +0x29: 旗標 (bit0 出航中, bit4 在港, bit5 到達/停住, bit6 劇本) */
  get flags(): number { return this.st.u8(this.addr + 0x29); }
  set flags(v: number) { this.st.set8(this.addr + 0x29, v); }
  /** +0x2a: 提督人物編號 */
  get admiral(): number { return this.st.u8(this.addr + 0x2a); }
  set admiral(v: number) { this.st.set8(this.addr + 0x2a, v); }
  /** +0x2b: seg0:5c58: 艦隊 10 艘船位 */
  shipSlot(k: number): ShipSlotView { return new ShipSlotView(this.st, this.addr + 0x2b + k * 0x09); }
}

/** t52d4 (DS:0x52d4, 40 × 0x1e): 船員配置 / 補給與載貨表 (0..9 主角艦隊, 10..39 船塢船) */
export class CrewSlotView {
  readonly st: StateBuffer;
  readonly addr: number;
  constructor(st: StateBuffer, addr: number) { this.st = st; this.addr = addr; }
  /** +0x00: 水 (單位: 1/10 桶) */
  get water(): number { return this.st.u16(this.addr + 0x00); }
  set water(v: number) { this.st.set16(this.addr + 0x00, v); }
  /** +0x02: 糧食 (單位: 1/10 桶) */
  get food(): number { return this.st.u16(this.addr + 0x02); }
  set food(v: number) { this.st.set16(this.addr + 0x02, v); }
  /** +0x04: 資材 */
  get material(): number { return this.st.u16(this.addr + 0x04); }
  set material(v: number) { this.st.set16(this.addr + 0x04, v); }
  /** +0x06: 砲彈 */
  get ammo(): number { return this.st.u16(this.addr + 0x06); }
  set ammo(v: number) { this.st.set16(this.addr + 0x06, v); }
  /** +0x08: 駕駛水手比例 (%) */
  get navRatio(): number { return this.st.u8(this.addr + 0x08); }
  set navRatio(v: number) { this.st.set8(this.addr + 0x08, v); }
  /** +0x09: 瞭望水手比例 (%) */
  get lookRatio(): number { return this.st.u8(this.addr + 0x09); }
  set lookRatio(v: number) { this.st.set8(this.addr + 0x09, v); }
  /** +0x0a: 總載重 (seg0:5db1) */
  get loadTotal(): number { return this.st.u16(this.addr + 0x0a); }
  set loadTotal(v: number) { this.st.set16(this.addr + 0x0a, v); }
  /** +0x0c: 5 格商品數量 (buildings.js cargoUsed) */
  getCargoAmts(k: number): number { return this.st.u16(this.addr + 0x0c + k * 2); }
  setCargoAmts(k: number, v: number): void { this.st.set16(this.addr + 0x0c + k * 2, v); }
  /** +0x16: 5 格商品編號 (FF=空) */
  getCargoGoods(k: number): number { return this.st.u8(this.addr + 0x16 + k); }
  setCargoGoods(k: number, v: number): void { this.st.set8(this.addr + 0x16 + k, v); }
  /** +0x1b: 船長人物編號 (或 港|0x80 表示在該港船塢/造船中) */
  get captain(): number { return this.st.u8(this.addr + 0x1b); }
  set captain(v: number) { this.st.set8(this.addr + 0x1b, v); }
  /** +0x1c: 士氣 0..100 */
  get morale(): number { return this.st.u8(this.addr + 0x1c); }
  set morale(v: number) { this.st.set8(this.addr + 0x1c, v); }
  /** +0x1d: 船首像 0..10 */
  get figurehead(): number { return this.st.u8(this.addr + 0x1d); }
  set figurehead(v: number) { this.st.set8(this.addr + 0x1d, v); }
}

/** dockSlots (DS:0x5784, 30 × 0x09): 船塢船位 10..39 (seg0:5c58: 0x572A + 9×編號), 與 fleets.ships 同格式 */
export class ShipSlotView {
  readonly st: StateBuffer;
  readonly addr: number;
  constructor(st: StateBuffer, addr: number) { this.st = st; this.addr = addr; }
  /** +0x00: 水手數 (seg0:5c58 +0) */
  get crew(): number { return this.st.u16(this.addr + 0x00); }
  set crew(v: number) { this.st.set16(this.addr + 0x00, v); }
  /** +0x02: 目前耐久度 (seg0:5c58 +2) */
  get durability(): number { return this.st.u8(this.addr + 0x02); }
  set durability(v: number) { this.st.set8(this.addr + 0x02, v); }
  /** +0x03: 最大耐久度 (seg0:5c58 +3) */
  get maxDurability(): number { return this.st.u8(this.addr + 0x03); }
  set maxDurability(v: number) { this.st.set8(this.addr + 0x03, v); }
  /** +0x04: 轉向力 (seg0:5c58 +4) */
  get turn(): number { return this.st.u8(this.addr + 0x04); }
  set turn(v: number) { this.st.set8(this.addr + 0x04, v); }
  /** +0x05: 推進力 (seg0:5c58 +5) */
  get propulsion(): number { return this.st.u8(this.addr + 0x05); }
  set propulsion(v: number) { this.st.set8(this.addr + 0x05, v); }
  /** +0x06: 武裝砲數 (seg0:5c58 +6) */
  get guns(): number { return this.st.u8(this.addr + 0x06); }
  set guns(v: number) { this.st.set8(this.addr + 0x06, v); }
  /** +0x07: 0FEA:148c1 [slot+7] → 船隻表 (seg0:5c7a) */
  get ship(): number { return this.st.u8(this.addr + 0x07); }
  set ship(v: number) { this.st.set8(this.addr + 0x07, v); }
  /** +0x08: 狀態與砲種 (bit4-5: 10=有船/20=建造或保管; 低3位=砲種) */
  get flags(): number { return this.st.u8(this.addr + 0x08); }
  set flags(v: number) { this.st.set8(this.addr + 0x08, v); }
}

/** ships (DS:0x5892, 65 × 0x16): #0..39 個別船隻 (類型 FF = 未使用); #40..64 為 25 種船型範本 */
export class ShipView {
  readonly st: StateBuffer;
  readonly addr: number;
  constructor(st: StateBuffer, addr: number) { this.st = st; this.addr = addr; }
  /** +0x00: 船名 (範本為船種名) */
  get nameBytes(): Uint8Array { return this.st.cstr(this.addr + 0x00); }
  /** +0x0f: 0FEA:148d4 [rec+0Fh] → 船種表 (seg0:5c8a); FF = 空欄 */
  get type(): number { return this.st.u8(this.addr + 0x0f); }
  set type(v: number) { this.st.set8(this.addr + 0x0f, v); }
  /** +0x10: 船隻旗標 / 材質 (bit4 特殊船型/外觀) */
  get flags(): number { return this.st.u8(this.addr + 0x10); }
  set flags(v: number) { this.st.set8(this.addr + 0x10, v); }
  /** +0x11: 最大武裝數 */
  get maxGuns(): number { return this.st.u8(this.addr + 0x11); }
  set maxGuns(v: number) { this.st.set8(this.addr + 0x11, v); }
  /** +0x12: 最大水手數 */
  get maxCrew(): number { return this.st.u16(this.addr + 0x12); }
  set maxCrew(v: number) { this.st.set16(this.addr + 0x12, v); }
  /** +0x14: 最大載貨量 */
  get maxCargo(): number { return this.st.u16(this.addr + 0x14); }
  set maxCargo(v: number) { this.st.set16(this.addr + 0x14, v); }
}

/** shipTypes (DS:0x5e28, 25 × 0x0c): 25 種船的規格; 船種名見 ships #40..64, 說明見 MESSAGE #168..192 */
export class ShipTypeView {
  readonly st: StateBuffer;
  readonly addr: number;
  constructor(st: StateBuffer, addr: number) { this.st = st; this.addr = addr; }
  /** +0x00: 船種分類 */
  get shipClass(): number { return this.st.u8(this.addr + 0x00); }
  set shipClass(v: number) { this.st.set8(this.addr + 0x00, v); }
  /** +0x01: 基準耐久 (初始耐久 = 9×此值/10) */
  get durability(): number { return this.st.u8(this.addr + 0x01); }
  set durability(v: number) { this.st.set8(this.addr + 0x01, v); }
  /** +0x02: 基準轉向力 */
  get turn(): number { return this.st.u8(this.addr + 0x02); }
  set turn(v: number) { this.st.set8(this.addr + 0x02, v); }
  /** +0x03: 基準推進力 */
  get propulsion(): number { return this.st.u8(this.addr + 0x03); }
  set propulsion(v: number) { this.st.set8(this.addr + 0x03, v); }
  /** +0x04: 最多人員 / 10 */
  get maxCrewDiv10(): number { return this.st.u8(this.addr + 0x04); }
  set maxCrewDiv10(v: number) { this.st.set8(this.addr + 0x04, v); }
  /** +0x05: 必要水手數 */
  get minCrew(): number { return this.st.u8(this.addr + 0x05); }
  set minCrew(v: number) { this.st.set8(this.addr + 0x05, v); }
  /** +0x06: 總載重量 */
  get capacity(): number { return this.st.u16(this.addr + 0x06); }
  set capacity(v: number) { this.st.set16(this.addr + 0x06, v); }
  /** +0x08: 最大武器數 */
  get maxGuns(): number { return this.st.u8(this.addr + 0x08); }
  set maxGuns(v: number) { this.st.set8(this.addr + 0x08, v); }
  /** +0x09: 造船所需工業等級 */
  get buildLevel(): number { return this.st.u8(this.addr + 0x09); }
  set buildLevel(v: number) { this.st.set8(this.addr + 0x09, v); }
  /** +0x0a: 基準造價 */
  get price(): number { return this.st.u16(this.addr + 0x0a); }
  set price(v: number) { this.st.set16(this.addr + 0x0a, v); }
}

/** ports (DS:0x5f54, 130 × 0x16): #0..99 港口 (對應 PORTMAP / CHIP_NO 100 張), #100..129 補給港 */
export class PortView {
  readonly st: StateBuffer;
  readonly addr: number;
  constructor(st: StateBuffer, addr: number) { this.st = st; this.addr = addr; }
  /** +0x00: 世界座標 X */
  get x(): number { return this.st.u16(this.addr + 0x00); }
  set x(v: number) { this.st.set16(this.addr + 0x00, v); }
  /** +0x02: 世界座標 Y */
  get y(): number { return this.st.u16(this.addr + 0x02); }
  set y(v: number) { this.st.set16(this.addr + 0x02, v); }
  /** +0x04: 0FEA:16b07 存檔一覽印 rec+4 */
  get nameBytes(): Uint8Array { return this.st.cstr(this.addr + 0x04); }
  /** +0x15: 所屬國與屬性 (低3位=屬國/頭像種類, bit3 同盟/翻倍收益等) */
  get region(): number { return this.st.u8(this.addr + 0x15); }
  set region(v: number) { this.st.set8(this.addr + 0x15, v); }
}

/** portEconomy (DS:0x6a80, 100 × 0x25): 100 個港口的經濟、物價與商店資料 */
export class PortEconomyView {
  readonly st: StateBuffer;
  readonly addr: number;
  constructor(st: StateBuffer, addr: number) { this.st = st; this.addr = addr; }
  /** +0x00: 商業價值 */
  get commerce(): number { return this.st.u16(this.addr + 0x00); }
  set commerce(v: number) { this.st.set16(this.addr + 0x00, v); }
  /** +0x02: 商業投資累計 (上限 50000) */
  get commerceInvest(): number { return this.st.u16(this.addr + 0x02); }
  set commerceInvest(v: number) { this.st.set16(this.addr + 0x02, v); }
  /** +0x04: 工業價值 */
  get industry(): number { return this.st.u16(this.addr + 0x04); }
  set industry(v: number) { this.st.set16(this.addr + 0x04, v); }
  /** +0x06: 工業投資累計 */
  get industryInvest(): number { return this.st.u16(this.addr + 0x06); }
  set industryInvest(v: number) { this.st.set16(this.addr + 0x06, v); }
  /** +0x08: 6 國支持度 (合計 100) */
  getInfluence(k: number): number { return this.st.u8(this.addr + 0x08 + k); }
  setInfluence(k: number, v: number): void { this.st.set8(this.addr + 0x08 + k, v); }
  /** +0x0e: 10 類商品物價指數 (0..100, 顯示為 +50) */
  getPrices(k: number): number { return this.st.u8(this.addr + 0x0e + k); }
  setPrices(k: number, v: number): void { this.st.set8(this.addr + 0x0e + k, v); }
  /** +0x18: 特產基準價 */
  get specialtyBase(): number { return this.st.u16(this.addr + 0x18); }
  set specialtyBase(v: number) { this.st.set16(this.addr + 0x18, v); }
  /** +0x1a: 特產商品編號 (FF=無) */
  get specialtyGood(): number { return this.st.u8(this.addr + 0x1a); }
  set specialtyGood(v: number) { this.st.set8(this.addr + 0x1a, v); }
  /** +0x1b: 特產出現所需商業等級 */
  get specialtyLevel(): number { return this.st.u8(this.addr + 0x1b); }
  set specialtyLevel(v: number) { this.st.set8(this.addr + 0x1b, v); }
  /** +0x1c: 地區群組 0..7 (王宮勢力狀況/BGM) */
  get regionGroup(): number { return this.st.u8(this.addr + 0x1c); }
  set regionGroup(v: number) { this.st.set8(this.addr + 0x1c, v); }
  /** +0x1d: 道具店商品 (一般3項+夜市第4項, FF=無) */
  getShopItems(k: number): number { return this.st.u8(this.addr + 0x1d + k); }
  setShopItems(k: number, v: number): void { this.st.set8(this.addr + 0x1d + k, v); }
  /** +0x21: 物價地區編號 0..12 (指向 t78f4) */
  get priceRegion(): number { return this.st.u8(this.addr + 0x21); }
  set priceRegion(v: number) { this.st.set8(this.addr + 0x21, v); }
  /** +0x24: 酒館酒類編號 0..13 */
  get liquor(): number { return this.st.u8(this.addr + 0x24); }
  set liquor(v: number) { this.st.set8(this.addr + 0x24, v); }
}

/** t78f4 (DS:0x78f4, 13 × 0x80): 13 個物價地區的商品基準價表 (market.js) */
export class RegionPriceView {
  readonly st: StateBuffer;
  readonly addr: number;
  constructor(st: StateBuffer, addr: number) { this.st = st; this.addr = addr; }
  /** +0x00: 46 種商品賣價基準 */
  getSellBase(k: number): number { return this.st.u16(this.addr + 0x00 + k * 2); }
  setSellBase(k: number, v: number): void { this.st.set16(this.addr + 0x00 + k * 2, v); }
  /** +0x5c: 9 種本區可買商品的買價基準 */
  getBuyBase(k: number): number { return this.st.u16(this.addr + 0x5c + k * 2); }
  setBuyBase(k: number, v: number): void { this.st.set16(this.addr + 0x5c + k * 2, v); }
  /** +0x6e: 9 種本區可買商品編號 */
  getBuyGoods(k: number): number { return this.st.u8(this.addr + 0x6e + k); }
  setBuyGoods(k: number, v: number): void { this.st.set8(this.addr + 0x6e + k, v); }
  /** +0x77: 9 種商品所需商業等級 */
  getBuyLevels(k: number): number { return this.st.u8(this.addr + 0x77 + k); }
  setBuyLevels(k: number, v: number): void { this.st.set8(this.addr + 0x77 + k, v); }
}

/** t7f74 (DS:0x7f74, 3 × 0x08): 造船廠中古船快取表 (最近到過的 3 港; RE_NOTES 20.11) */
export class UsedShipCacheView {
  readonly st: StateBuffer;
  readonly addr: number;
  constructor(st: StateBuffer, addr: number) { this.st = st; this.addr = addr; }
  /** +0x00: 5 格中古船船型 (FF=空) */
  getShipTypes(k: number): number { return this.st.u8(this.addr + 0x00 + k); }
  setShipTypes(k: number, v: number): void { this.st.set8(this.addr + 0x00 + k, v); }
  /** +0x05: 所屬港口 */
  get port(): number { return this.st.u8(this.addr + 0x05); }
  set port(v: number) { this.st.set8(this.addr + 0x05, v); }
}

/** discoveries (DS:0x7f8c, 100 × 0x07): 100 個發現物, 名稱與說明在 COLONY.DAT (100 × 177 bytes) */
export class DiscoveryView {
  readonly st: StateBuffer;
  readonly addr: number;
  constructor(st: StateBuffer, addr: number) { this.st = st; this.addr = addr; }
  /** +0x00: 世界座標 X */
  get x(): number { return this.st.u16(this.addr + 0x00); }
  set x(v: number) { this.st.set16(this.addr + 0x00, v); }
  /** +0x02: 世界座標 Y */
  get y(): number { return this.st.u16(this.addr + 0x02); }
  set y(v: number) { this.st.set16(this.addr + 0x02, v); }
  /** +0x04: 對應寶物道具編號 */
  get item(): number { return this.st.u8(this.addr + 0x04); }
  set item(v: number) { this.st.set8(this.addr + 0x04, v); }
  /** +0x05: 重要度 (0..100) */
  get importance(): number { return this.st.u8(this.addr + 0x05); }
  set importance(v: number) { this.st.set8(this.addr + 0x05, v); }
  /** +0x06: 旗標 (低3位=種類, bit5=已知, bit7=已發現) */
  get flags(): number { return this.st.u8(this.addr + 0x06); }
  set flags(v: number) { this.st.set8(this.addr + 0x06, v); }
}

/** items (DS:0x8248, 100 × 0x14): 道具 (說明見 ITEM.MES 100 筆) */
export class ItemView {
  readonly st: StateBuffer;
  readonly addr: number;
  constructor(st: StateBuffer, addr: number) { this.st = st; this.addr = addr; }
  /** +0x00: 道具名 */
  get nameBytes(): Uint8Array { return this.st.cstr(this.addr + 0x00); }
  /** +0x0f: KAO 道具小圖偏移 (+0x55) */
  get icon(): number { return this.st.u8(this.addr + 0x0f); }
  set icon(v: number) { this.st.set8(this.addr + 0x0f, v); }
  /** +0x10: 價格 / 100 */
  get priceDiv100(): number { return this.st.u16(this.addr + 0x10); }
  set priceDiv100(v: number) { this.st.set16(this.addr + 0x10, v); }
  /** +0x12: 攻防數值 / 地圖對應發現物編號 */
  get power(): number { return this.st.u8(this.addr + 0x12); }
  set power(v: number) { this.st.set8(this.addr + 0x12, v); }
  /** +0x13: 低4位=道具種類, bit4=已裝備 */
  get kindFlags(): number { return this.st.u8(this.addr + 0x13); }
  set kindFlags(v: number) { this.st.set8(this.addr + 0x13, v); }
}

export class WorldModel {
  readonly st: StateBuffer;
  readonly globals: GlobalsView;
  constructor(st: StateBuffer) { this.st = st; this.globals = new GlobalsView(st); }
  country(i: number): CountryView { return new CountryView(this.st, 0x117a + (i & 0xff) * 0x20); }
  heroData(i: number): HeroDataView { return new HeroDataView(this.st, 0x125a + (i & 0xff) * 0x0e); }
  person(i: number): PersonView { return new PersonView(this.st, 0x12b6 + (i & 0xff) * 0x32); }
  noble(i: number): NobleView { return new NobleView(this.st, 0x2a26 + (i & 0xff) * 0x16); }
  barmaid(i: number): BarmaidView { return new BarmaidView(this.st, 0x2bde + (i & 0xff) * 0x13); }
  fleet(i: number): FleetView { return new FleetView(this.st, 0x2e76 + (i & 0xff) * 0x85); }
  crewSlot(i: number): CrewSlotView { return new CrewSlotView(this.st, 0x52d4 + (i & 0xff) * 0x1e); }
  dockSlot(i: number): ShipSlotView { return new ShipSlotView(this.st, 0x5784 + (i & 0xff) * 0x09); }
  ship(i: number): ShipView { return new ShipView(this.st, 0x5892 + (i & 0xff) * 0x16); }
  shipType(i: number): ShipTypeView { return new ShipTypeView(this.st, 0x5e28 + (i & 0xff) * 0x0c); }
  port(i: number): PortView { return new PortView(this.st, 0x5f54 + (i & 0xff) * 0x16); }
  portEconomy(i: number): PortEconomyView { return new PortEconomyView(this.st, 0x6a80 + (i & 0xff) * 0x25); }
  regionPrice(i: number): RegionPriceView { return new RegionPriceView(this.st, 0x78f4 + (i & 0xff) * 0x80); }
  usedShipCache(i: number): UsedShipCacheView { return new UsedShipCacheView(this.st, 0x7f74 + (i & 0xff) * 0x08); }
  discovery(i: number): DiscoveryView { return new DiscoveryView(this.st, 0x7f8c + (i & 0xff) * 0x07); }
  item(i: number): ItemView { return new ItemView(this.st, 0x8248 + (i & 0xff) * 0x14); }
  /** 目前主角的人物記錄 */
  heroPerson(): PersonView { return this.person(this.globals.hero); }
  /** 目前主角的名聲 / 聲望 / 爵位記錄 */
  heroInfo(): HeroDataView { return this.heroData(this.globals.hero); }
  /** 目前所在港口 (海上時為 0xFF) */
  currentPort(): PortView { return this.port(this.globals.port); }
  /** 目前所在港口的經濟資料 */
  currentPortEconomy(): PortEconomyView { return this.portEconomy(this.globals.port); }
  /** 隨身物第 slot 格 (0..19, 0xFF=空) */
  inventory(slot: number): number { return this.st.u8(DS.INVENTORY + slot); }
  setInventory(slot: number, itemId: number): void { this.st.set8(DS.INVENTORY + slot, itemId); }
  /** 同伴欄位第 slot 格 (0..29, 0xFF=空) */
  partyCrew(slot: number): number { return this.st.u8(DS.PARTY_CREW + slot); }
  setPartyCrew(slot: number, personId: number): void { this.st.set8(DS.PARTY_CREW + slot, personId); }
}
