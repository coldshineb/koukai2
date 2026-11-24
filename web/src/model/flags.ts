// flags.ts — 原版遊戲狀態的位元旗標與具名列舉常數

/** 遊戲規則常用常數 */
export const GameConst = {
  MAX_CASH: 600_000_000,
  INV_SLOTS: 20,
  PARTY_SLOTS: 30,
  EMPTY_SLOT: 0xff,
  VENICE_PORT_ID: 13,
} as const;

/** DS:0x0ca4 環境設定與全域旗標 */
export const OptionFlag = {
  ANIMATION: 0x01,      // bit0: 視窗與轉場動畫
  ENDING_READY: 0x02,   // bit1: 爵位 9 結局尚未觸發
  BGM: 0x04,            // bit2: 背景音樂開關
  SFX: 0x08,            // bit3: FM 效果音開關
  SCENARIO: 0x40,       // bit6: 主角劇本啟用
} as const;

/** 港口 12 種建築編號 (MAIN.EXE DS:a612 處理函式表索引) */
export const BuildingId = {
  MARKET: 0,            // 交易所
  TAVERN: 1,            // 酒館
  SHIPYARD: 2,          // 造船廠
  WHARF: 3,             // 碼頭
  INN: 4,               // 旅館
  PALACE: 5,            // 王宮
  OFFICE: 6,            // 事務所
  HOUSE: 7,             // 住宅
  BANK: 8,              // 銀行
  ITEM_SHOP: 9,         // 道具店
  CHURCH: 10,           // 教會
  FORTUNE: 11,          // 占卜師
} as const;

/** 船位 flags (+0x08) */
export const ShipSlotFlag = {
  CANNON_MASK: 0x07,    // 低 3 位: 砲種
  STATE_MASK: 0x30,     // bit4-5: 狀態
  ACTIVE: 0x10,         // 艦隊出航 / 現役船
  BUILDING: 0x20,       // 建造中 / 援助船待交船
} as const;

/** 艦隊 flags (+0x29) */
export const FleetFlag = {
  AT_SEA: 0x01,         // bit0: 出航中 / 有船
  IN_PORT: 0x10,        // bit4: 在港內
  ARRIVED: 0x20,        // bit5: 已到達 / 停住
  SCENARIO: 0x40,       // bit6: 劇本控制
} as const;

/** 海上狀態高位元組 DS:0x1005 */
export const SeaFlag2 = {
  LANDED_MASK: 0x18,    // bit3-4: 留在岸上
  STOPPED: 0x20,        // bit5: 停船中
} as const;

/** 發現物 flags (+0x06) */
export const DiscoveryFlag = {
  KIND_MASK: 0x07,      // 低 3 位: 發現物種類
  KNOWN: 0x20,          // bit5: 已知位置/情報
  FOUND: 0x80,          // bit7: 已發現
} as const;

/** 道具 kindFlags (+0x13) */
export const ItemFlag = {
  KIND_MASK: 0x0f,      // 低 4 位: 道具種類
  EQUIPPED: 0x10,       // bit4: 已裝備
} as const;

/** 道具種類 (ItemFlag.KIND_MASK) */
export const ItemKind = {
  DAGGER: 0,
  RAPIER: 1,
  SCIMITAR: 2,
  SABER: 3,
  SHIELD: 4,
  DEFENSE: 5,
  ARMOR: 6,
  NAVI_TOOL: 7,
  SEA_GEAR: 8,
  CONSUMABLE: 9,
  ACCESSORY: 10,
  TREASURE: 11,
  MAP: 12,
  RELIC: 13,
} as const;

/** 常用 MENU.DAT 編號 */
export const MenuId = {
  BANK: 0,              // 存款 / 提款 / 貸款 / 還款
  INN: 4,               // 海港支持度 / 就寢 / 與航海者閒聊
  ITEM_SHOP: 5,         // 買進 / 賣出
  MARKET: 6,            // 買進 / 賣出 / 投資 / 物價
  DOCK: 8,              // 保管 / 配備 / 交換
  BARMAID_INFO: 13,     // 工作的情報 / 她的喜好 / 她的芳齡
  BARMAID: 14,          // 航海見聞 / 送她禮物 / 調查結果 / 探聽情報
  PALACE: 16,           // 晉見國王 / 入籍 / 資金援助 / 船舶援助 / (密會)
  FUNCTIONS: 20,        // 環境設定 / 儲存檔案 / 取出存檔 / 結束遊戲
  SHIPYARD: 22,         // 造新船 / 買舊船 / 修理 / 賣船 / 改造 / 工業投資
  SEA_NAV: 29,          // 委任 / 停船 / 靠港 / 登陸 / 隨身物 / 功能
  DISCOVERY_ACT: 35,    // 調查 / 雇嚮導 / 狩獵 / 離開
  LAND_ACT: 36,         // 修理 / 搜索 / 留在岸上
  PALACE_AUDIENCE: 55,  // 勢力狀況 / 私掠許可證 / 免稅證
  TITLE: 56,            // 繼續航海進度 / 開始新航海 / 環境設定 / 結束遊戲
} as const;
