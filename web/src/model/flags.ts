// flags.ts — 原版游戏状态的比特标志与具名枚举常数

/** 游戏规则常用常数 */
export const GameConst = {
  MAX_CASH: 600_000_000,
  MAX_FAME: 50_000,
  MAX_INVEST: 50_000,
  INV_SLOTS: 20,
  PARTY_SLOTS: 30,
  FLEET_SHIPS: 10,
  CARGO_SLOTS: 5,
  EMPTY_SLOT: 0xff,
  VENICE_PORT_ID: 13,
  TRADE_LOG_COUNT: 48,
} as const;

/** 共用剧本 (工作) 与世界探索 DS 地址常数 */
export const WorkDS = {
  FLAGS: 0x0d62,        // 工作状态标志 (bit1/2 国王召见/任务中)
  KINDS: 0x0d68,        // 3 件可选工作的种类 (u16 × 3)
  PARAMS: 0x0d6e,       // 3 件可选工作的参数 (u16 × 3)
  CUR_KIND: 0x0d74,     // 目前运行的工作种类 (u16)
  CUR_PARAM: 0x0d78,    // 目前运行的工作参数 (u16)
  TARGET_PORT: 0x0d88,  // 工作目标港 (u16)
  TARGET_PERSON: 0x0d8a,// 工作目标人物 (u16)
  TARGET_ITEM: 0x0d8c,  // 工作目标道具 (u8)
  RAND_RANGE: 0x0d96,   // 随机数范围 (u16)
  ROYAL_CHAP: 0x0da4,   // 国王召见对应的共用剧本章节 (u8)
  EXPLORE_MAP: 0x0de8,  // 世界地图探索比特表 (45 × 12 bytes)
  EXPLORE_TOTAL: 0x100e,// 已探索总格数 (u16, ≥ 3300 完成世界地图)
  EXPLORE_UNREP: 0x1010,// 未报告探索格数 (u16)
} as const;

/** 人物技能比特 (persons.skills, +0x30) */
export const SkillFlag = {
  NEGOTIATE: 0x01,      // 交涉
  ACCOUNTING: 0x02,     // 会计
  GUNNERY: 0x04,        // 砲术
  CARTOGRAPHY: 0x08,    // 地图制作
  SURVEY: 0x10,         // 测量
} as const;

/** 住宅/贵族标志 (nobles.flags, +0x14) */
export const NobleFlag = {
  REWARD_MASK: 0x03,    // 低 2 位: 酬金等级
  CONTRACTED: 0x10,     // bit4: 已签合约
} as const;

/** 国家条约标志 (countries.treaties[i], +0x12+i) */
export const TreatyFlag = {
  BLOCKADE: 0x10,       // bit4: 封锁
  ALLY: 0x20,           // bit5: 同盟
} as const;

/** DS:0x0ca4 环境设置与全域标志 */
export const OptionFlag = {
  ANIMATION: 0x01,      // bit0: 窗口与转场动画
  ENDING_READY: 0x02,   // bit1: 爵位 9 结局尚未触发
  BGM: 0x04,            // bit2: 背景音乐开关
  SFX: 0x08,            // bit3: FM 效果音开关
  SCENARIO: 0x40,       // bit6: 主角剧本激活
} as const;

/** 港口 12 种建筑编号 (MAIN.EXE DS:a612 处理函数表索引) */
export const BuildingId = {
  MARKET: 0,            // 交易所
  TAVERN: 1,            // 酒馆
  SHIPYARD: 2,          // 造船厂
  WHARF: 3,             // 码头
  INN: 4,               // 旅馆
  PALACE: 5,            // 王宫
  OFFICE: 6,            // 事务所
  HOUSE: 7,             // 住宅
  BANK: 8,              // 银行
  ITEM_SHOP: 9,         // 道具店
  CHURCH: 10,           // 教会
  FORTUNE: 11,          // 占卜师
} as const;

/** 船位 flags (+0x08) */
export const ShipSlotFlag = {
  CANNON_MASK: 0x07,    // 低 3 位: 砲种
  STATE_MASK: 0x30,     // bit4-5: 状态
  ACTIVE: 0x10,         // 舰队出航 / 现役船
  BUILDING: 0x20,       // 建造中 / 援助船待交船
} as const;

/** 舰队 flags (+0x29) */
export const FleetFlag = {
  AT_SEA: 0x01,         // bit0: 出航中 / 有船
  IN_PORT: 0x10,        // bit4: 在港内
  ARRIVED: 0x20,        // bit5: 已到达 / 停住
  SCENARIO: 0x40,       // bit6: 剧本控制
} as const;

/** 海上状态高字节 DS:0x1005 */
export const SeaFlag2 = {
  LANDED_MASK: 0x18,    // bit3-4: 留在岸上
  STOPPED: 0x20,        // bit5: 停船中
} as const;

/** 发现物 flags (+0x06) */
export const DiscoveryFlag = {
  KIND_MASK: 0x07,      // 低 3 位: 发现物种类
  KNOWN: 0x20,          // bit5: 已知位置/情报
  FOUND: 0x80,          // bit7: 已发现
} as const;

/** 道具 kindFlags (+0x13) */
export const ItemFlag = {
  KIND_MASK: 0x0f,      // 低 4 位: 道具种类
  EQUIPPED: 0x10,       // bit4: 已装备
} as const;

/** 道具种类 (ItemFlag.KIND_MASK) */
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

/** 常用 MENU.DAT 编号 */
export const MenuId = {
  BANK: 0,              // 存款 / 提款 / 贷款 / 还款
  INN: 4,               // 海港支持度 / 就寝 / 与航海者闲聊
  ITEM_SHOP: 5,         // 买进 / 卖出
  MARKET: 6,            // 买进 / 卖出 / 投资 / 物价
  DOCK: 8,              // 保管 / 配备 / 交换
  BARMAID_INFO: 13,     // 工作的情报 / 她的喜好 / 她的芳龄
  BARMAID: 14,          // 航海见闻 / 送她礼物 / 调查结果 / 探听情报
  PALACE: 16,           // 晋见国王 / 入籍 / 资金援助 / 船舶援助 / (密会)
  FUNCTIONS: 20,        // 环境设置 / 保存文件 / 取出存盘 / 结束游戏
  SHIPYARD: 22,         // 造新船 / 买旧船 / 修理 / 卖船 / 改造 / 工业投资
  SEA_NAV: 29,          // 委任 / 停船 / 靠港 / 登陆 / 随身物 / 功能
  DISCOVERY_ACT: 35,    // 调查 / 雇向导 / 狩猎 / 离开
  LAND_ACT: 36,         // 修理 / 搜索 / 留在岸上
  PALACE_AUDIENCE: 55,  // 势力状况 / 私掠许可证 / 免税证
  TITLE: 56,            // 继续航海进度 / 开始新航海 / 环境设置 / 结束游戏
} as const;
