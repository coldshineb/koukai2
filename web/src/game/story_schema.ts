// game/story_schema.ts — 语义化剧情 JSON (uw2-story-v1) 的类型定义与名称映射工具

export const STORY_FORMAT_VERSION = "uw2-story-v1" as const;

export const BUILDING_LABELS: Readonly<Record<number, string>> = {
  0: "交易所",
  1: "酒馆",
  2: "造船厂",
  3: "码头",
  4: "旅馆",
  5: "王宫",
  6: "事务所",
  7: "住宅",
  8: "银行",
  9: "道具店",
  10: "教会",
  11: "占卜师",
  21: "王宫(内厅/夜间)",
  60: "事务所委托结算",
  255: "任意建筑",
};

export const SPECIAL_PORT_LABELS: Readonly<Record<number, string>> = {
  160: "海上每日事件",
  161: "海战开战前",
  162: "海战结束后",
  163: "任意普通港",
};

export const SYS_VALUE_LABELS: Readonly<Record<number, string>> = {
  0: "展开后的消息字节串",
  1: "主角所在世界格子编号",
  2: "当前年份",
  3: "当前月份",
  4: "当前日期",
  5: "当前港口",
  6: "一骑打主角当前体力",
  7: "当前时刻",
};

export const KIND_FIELD_LABELS: Readonly<Record<string, string>> = {
  "0:2": "countries.powerHi (国家国力高字节)",
  "0:10": "countries.capitalPort (首都港口)",
  "0:11": "countries.relations (外交关系)",
  "0:18": "countries.treaties (同盟/停战条约)",
  "1:0": "heroData.tradeFame (商业声望)",
  "1:6": "heroData.countryStanding (各国贡献度)",
  "1:13": "heroData.rank (主角爵位)",
  "2:4": "globals.bankQuotient (银行存款/100)",
  "2:7": "globals.hero (主角编号)",
  "3:0": "persons.givenName (人物名)",
  "3:13": "persons.familyName (人物姓)",
  "3:26": "persons.portrait (头像编号)",
  "3:28": "persons.stats (能力数组)",
  "3:36": "persons.navLevel (航海等级)",
  "3:37": "persons.battleLevel (战斗等级)",
  "3:44": "persons.fleet (所属舰队)",
  "3:45": "persons.stayPort (停留港口)",
  "3:46": "persons.role (职位)",
  "3:49": "persons.face (外貌/性格特征)",
  "4:20": "nobles.flags (贵族标志)",
  "5:15": "barmaids.affection (酒吧女郎好感)",
  "5:18": "barmaids.flags (酒吧女郎标志)",
  "6:3": "workVars.flags (剧本工作标志)",
  "6:63": "workVars.extra (剧本工作变量)",
  "7:0": "heroOrDockSlot.crew (船只水手数)",
  "7:2": "heroOrDockSlot.durability (当前耐久)",
  "7:3": "heroOrDockSlot.maxDurability (最大耐久)",
  "7:6": "heroOrDockSlot.guns (火炮数)",
  "7:8": "heroOrDockSlot.flags (船位状态标志)",
  "8:0": "fleets.x (舰队X坐标)",
  "8:4": "fleets.destX (舰队目的地X)",
  "8:12": "fleets.routeFlags (航线标志)",
  "8:27": "fleets.mission (舰队任务)",
  "8:28": "fleets.target (舰队目标)",
  "8:33": "fleets.cargoGood (载货商品)",
  "8:34": "fleets.cargoAmt (载货数量)",
  "8:38": "fleets.homePort (母港)",
  "8:40": "fleets.strength (舰队战力)",
  "8:41": "fleets.flags (舰队标志)",
  "8:42": "fleets.admiral (舰队提督)",
  "9:0": "crewSlots.water (淡水)",
  "9:2": "crewSlots.food (粮食)",
  "9:6": "crewSlots.ammo (炮弹)",
  "9:12": "crewSlots.cargoAmts (货物数量)",
  "9:22": "crewSlots.cargoGoods (货物种类)",
  "10:15": "ships.type (船型)",
  "12:4": "ports.name (港名)",
  "12:21": "ports.region (港口所属海域/国家)",
  "13:33": "portEconomy.priceRegion (物价区域)",
  "14:0": "regionPrices.sellBase (卖出基价)",
  "14:110": "regionPrices.buyGoods (特产收购表)",
  "16:4": "discoveries.item (发现物编号)",
  "16:5": "discoveries.importance (重要度)",
  "16:6": "discoveries.flags (发现状态标志)",
  "17:0": "items.name (道具名)",
  "17:18": "items.power (道具威力)",
  "17:19": "items.kindFlags (道具类型与装备)",
  "18:0": "colony.data (殖民地资料)",
  "19:0": "runtime.bd06 (运行期临时寄存器)",
};

export function describeKindField(kind: number, field: number): string {
  return KIND_FIELD_LABELS[`${kind}:${field}`] ?? `table_${kind}+0x${field.toString(16)}`;
}

export type StoryOperand =
  | { readonly var: number }
  | { readonly ptr: number }
  | { readonly flag: number }
  | { readonly imm: number }
  | { readonly sys: number };

export type StoryCmpOp = "eq" | "ne" | "ge" | "le";

export type StoryCond =
  | {
      readonly cmp: StoryCmpOp;
      readonly dst: StoryOperand;
      readonly src: StoryOperand;
      readonly not?: boolean;
    }
  | {
      readonly op: "not";
      readonly expr: StoryCond;
    }
  | {
      readonly op: "and" | "or";
      readonly args: readonly StoryCond[];
    };

export type StoryStep =
  | { readonly op: "if"; readonly cond: StoryCond; readonly then: StoryStep[]; readonly else?: StoryStep[] }
  | { readonly op: "loop"; readonly body: StoryStep[] }
  | { readonly op: "break" }
  | { readonly op: "continue" }
  | { readonly op: "block"; readonly label: string; readonly body: StoryStep[] }
  | { readonly op: "exit"; readonly target: string }
  | { readonly op: "win_open"; readonly win: number }
  | { readonly op: "win_close" }
  | { readonly op: "win_close_all" }
  | { readonly op: "win_select"; readonly win: number }
  | { readonly op: "face"; readonly face: number; readonly speaker?: string }
  | { readonly op: "face_var"; readonly var: number }
  | { readonly op: "msg"; readonly msg: number; readonly text: string }
  | { readonly op: "msg_expand"; readonly msg: number; readonly text: string }
  | { readonly op: "wait_key" }
  | { readonly op: "menu"; readonly var: number; readonly msg: number; readonly text: string; readonly options: string[] }
  | { readonly op: "music"; readonly song: number }
  | { readonly op: "picture"; readonly x: number; readonly y: number; readonly pic: number }
  | { readonly op: "yes_no"; readonly flag: number }
  | { readonly op: "addr"; readonly var: number; readonly kind: number; readonly index: number; readonly field: number; readonly ref?: string }
  | { readonly op: "addr_var"; readonly var: number; readonly kind: number; readonly indexVar: number; readonly field: number; readonly ref?: string }
  | { readonly op: "mov"; readonly size: "word" | "byte" | "sys"; readonly dst: StoryOperand; readonly src: StoryOperand; readonly note?: string }
  | { readonly op: "alu"; readonly fn: "add" | "sub" | "mul" | "div" | "or" | "and" | "shr" | "shl"; readonly dst: StoryOperand; readonly src: StoryOperand }
  | { readonly op: "random"; readonly var: number; readonly range: number }
  | { readonly op: "seed_set"; readonly var: number }
  | { readonly op: "seed_get"; readonly var: number }
  | { readonly op: "money_set"; readonly var: number }
  | { readonly op: "money_add"; readonly var: number }
  | { readonly op: "money_sub"; readonly var: number }
  | { readonly op: "money_div10000"; readonly var: number }
  | { readonly op: "cargo_free"; readonly var: number }
  | { readonly op: "cargo_load"; readonly varGoods: number; readonly varAmount: number }
  | { readonly op: "cargo_unload"; readonly varGoods: number; readonly varAmount: number }
  | { readonly op: "ship_new"; readonly type: number; readonly b2: number }
  | { readonly op: "ship_name"; readonly b1: number; readonly msg: number; readonly text: string }
  | { readonly op: "crew_join"; readonly person: number; readonly personName?: string }
  | { readonly op: "barmaid_love"; readonly girl: number; readonly girlName?: string; readonly amount: number }
  | { readonly op: "d1"; readonly var: number }
  | { readonly op: "duel"; readonly person: number; readonly personName?: string }
  | { readonly op: "ending"; readonly code: number }
  | { readonly op: "next_section" }
  | { readonly op: "next_chapter" }
  | { readonly op: "return0" }
  | { readonly op: "stop" }
  | { readonly op: "nop" };

export interface StoryTrigger {
  readonly port: number;
  readonly portLabel: string;
  readonly building: number;
  readonly buildingLabel: string;
  readonly handler: string;
  readonly summary: string;
}

export interface StoryHandler {
  readonly entryAt: number;
  readonly summary: string;
  readonly steps: StoryStep[];
}

export interface StorySection {
  readonly section: number;
  readonly triggers: StoryTrigger[];
  readonly handlers: Record<string, StoryHandler>;
}

export interface StoryChapter {
  readonly chapter: number;
  readonly sections: Array<StorySection | null>;
}

export interface StoryDoc {
  readonly format: typeof STORY_FORMAT_VERSION;
  readonly id: number;
  readonly title: string;
  readonly chapters: Array<StoryChapter | null>;
}
