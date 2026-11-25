// game/story_schema.ts — 语义化剧情 JSON (uw2-story-v1) 的类型定义、字段索引映射与表达式格式化工具

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

export interface FieldMetaEntry {
  readonly key: string;     // e.g. "heroData.rank" or "globals.hero"
  readonly kind: number;
  readonly field: number;
  readonly label: string;   // 中文语义说明
  readonly indexed: boolean;
}

// 覆盖全部 SC_KINDS 表与偏移的唯一双向映射（支持静态提升与运行期反查）
export const FIELD_ENTRIES: readonly FieldMetaEntry[] = [
  // kind 0: countries (stride 0x20)
  { key: "countries.power", kind: 0, field: 0, label: "国家国力", indexed: true },
  { key: "countries.powerHi", kind: 0, field: 2, label: "国家国力高字", indexed: true },
  { key: "countries.aidMoneyK", kind: 0, field: 5, label: "国家援助资金", indexed: true },
  { key: "countries.aidShipType", kind: 0, field: 7, label: "国家援助船型", indexed: true },
  { key: "countries.aidShipCount", kind: 0, field: 8, label: "国家援助船数", indexed: true },
  { key: "countries.capitalPort", kind: 0, field: 10, label: "国家首都港口", indexed: true },
  { key: "countries.relations", kind: 0, field: 11, label: "国家外交关系", indexed: true },
  { key: "countries.treaties", kind: 0, field: 18, label: "国家条约标志", indexed: true },

  // kind 1: heroData (stride 0x0e)
  { key: "heroData.tradeFame", kind: 1, field: 0, label: "商业声望", indexed: true },
  { key: "heroData.pirateFame", kind: 1, field: 2, label: "海盗声望", indexed: true },
  { key: "heroData.adventureFame", kind: 1, field: 4, label: "冒险声望", indexed: true },
  { key: "heroData.countryStanding", kind: 1, field: 6, label: "各国贡献度", indexed: true },
  { key: "heroData.rank", kind: 1, field: 13, label: "主角爵位", indexed: true },

  // kind 2: globals near 0x12ae (unindexed)
  { key: "globals.money", kind: 2, field: 0, label: "主角现金", indexed: false },
  { key: "globals.bankQuotient", kind: 2, field: 4, label: "银行存款(/100)", indexed: false },
  { key: "globals.bankRem", kind: 2, field: 6, label: "银行余数", indexed: false },
  { key: "globals.hero", kind: 2, field: 7, label: "主角编号", indexed: false },

  // kind 3: persons (stride 0x32)
  { key: "persons.givenName", kind: 3, field: 0, label: "人物名", indexed: true },
  { key: "persons.familyName", kind: 3, field: 13, label: "人物姓", indexed: true },
  { key: "persons.portrait", kind: 3, field: 26, label: "头像编号", indexed: true },
  { key: "persons.stats", kind: 3, field: 28, label: "能力值", indexed: true },
  { key: "persons.navLevel", kind: 3, field: 36, label: "航海等级", indexed: true },
  { key: "persons.battleLevel", kind: 3, field: 37, label: "战斗等级", indexed: true },
  { key: "persons.navExp", kind: 3, field: 38, label: "航海经验", indexed: true },
  { key: "persons.battleExp", kind: 3, field: 40, label: "战斗经验", indexed: true },
  { key: "persons.age", kind: 3, field: 42, label: "年龄", indexed: true },
  { key: "persons.loyalty", kind: 3, field: 43, label: "忠诚度", indexed: true },
  { key: "persons.fleet", kind: 3, field: 44, label: "所属舰队", indexed: true },
  { key: "persons.stayPort", kind: 3, field: 45, label: "停留港口", indexed: true },
  { key: "persons.role", kind: 3, field: 46, label: "职位", indexed: true },
  { key: "persons.flags", kind: 3, field: 47, label: "人物标志", indexed: true },
  { key: "persons.skills", kind: 3, field: 48, label: "技能标志", indexed: true },
  { key: "persons.face", kind: 3, field: 49, label: "外貌/国籍特征", indexed: true },

  // kind 4: nobles (stride 0x16)
  { key: "nobles.name", kind: 4, field: 0, label: "贵族名", indexed: true },
  { key: "nobles.flags", kind: 4, field: 20, label: "贵族标志", indexed: true },
  { key: "nobles.port", kind: 4, field: 21, label: "贵族所在港", indexed: true },

  // kind 5: barmaids (stride 0x13)
  { key: "barmaids.name", kind: 5, field: 0, label: "女郎名", indexed: true },
  { key: "barmaids.affection", kind: 5, field: 15, label: "女郎好感", indexed: true },
  { key: "barmaids.quest", kind: 5, field: 16, label: "女郎委托", indexed: true },
  { key: "barmaids.questDays", kind: 5, field: 17, label: "委托剩余天数", indexed: true },
  { key: "barmaids.flags", kind: 5, field: 18, label: "女郎标志", indexed: true },

  // kind 6: workVars / DS near 0x2e18 (unindexed)
  { key: "workVars.daysAtSea", kind: 6, field: 0, label: "出航天数", indexed: false },
  { key: "workVars.flags", kind: 6, field: 3, label: "剧本工作标志", indexed: false },
  { key: "workVars.extra", kind: 6, field: 63, label: "剧本工作变量", indexed: false },

  // kind 7: heroOrDockSlot (9B)
  { key: "heroShip.crew", kind: 7, field: 0, label: "船只水手数", indexed: true },
  { key: "heroShip.durability", kind: 7, field: 2, label: "船只耐久", indexed: true },
  { key: "heroShip.maxDurability", kind: 7, field: 3, label: "最大耐久", indexed: true },
  { key: "heroShip.turn", kind: 7, field: 4, label: "转向力", indexed: true },
  { key: "heroShip.propulsion", kind: 7, field: 5, label: "推进力", indexed: true },
  { key: "heroShip.guns", kind: 7, field: 6, label: "火炮数", indexed: true },
  { key: "heroShip.ship", kind: 7, field: 7, label: "船只记录号", indexed: true },
  { key: "heroShip.flags", kind: 7, field: 8, label: "船位状态标志", indexed: true },

  // kind 8: fleets (stride 0x85)
  { key: "fleets.x", kind: 8, field: 0, label: "舰队X坐标", indexed: true },
  { key: "fleets.y", kind: 8, field: 2, label: "舰队Y坐标", indexed: true },
  { key: "fleets.destX", kind: 8, field: 4, label: "目的地X", indexed: true },
  { key: "fleets.destY", kind: 8, field: 6, label: "目的地Y", indexed: true },
  { key: "fleets.routeFlags", kind: 8, field: 12, label: "航线标志", indexed: true },
  { key: "fleets.dir", kind: 8, field: 26, label: "航向", indexed: true },
  { key: "fleets.mission", kind: 8, field: 27, label: "舰队任务", indexed: true },
  { key: "fleets.target", kind: 8, field: 28, label: "舰队目标", indexed: true },
  { key: "fleets.cargoGood", kind: 8, field: 33, label: "载货商品", indexed: true },
  { key: "fleets.cargoAmt", kind: 8, field: 34, label: "载货数量", indexed: true },
  { key: "fleets.homePort", kind: 8, field: 38, label: "母港", indexed: true },
  { key: "fleets.strength", kind: 8, field: 40, label: "舰队战力", indexed: true },
  { key: "fleets.flags", kind: 8, field: 41, label: "舰队标志", indexed: true },
  { key: "fleets.admiral", kind: 8, field: 42, label: "舰队提督", indexed: true },

  // kind 9: crewSlots (stride 0x1e)
  { key: "crewSlots.water", kind: 9, field: 0, label: "淡水", indexed: true },
  { key: "crewSlots.food", kind: 9, field: 2, label: "粮食", indexed: true },
  { key: "crewSlots.material", kind: 9, field: 4, label: "资材", indexed: true },
  { key: "crewSlots.ammo", kind: 9, field: 6, label: "炮弹", indexed: true },
  { key: "crewSlots.cargoAmts", kind: 9, field: 12, label: "货物数量", indexed: true },
  { key: "crewSlots.cargoGoods", kind: 9, field: 22, label: "货物种类", indexed: true },

  // kind 10: ships (stride 0x16)
  { key: "ships.name", kind: 10, field: 0, label: "船名", indexed: true },
  { key: "ships.type", kind: 10, field: 15, label: "船型", indexed: true },

  // kind 12: ports (stride 0x16)
  { key: "ports.name", kind: 12, field: 4, label: "港名", indexed: true },
  { key: "ports.region", kind: 12, field: 21, label: "港口所属海域/国家", indexed: true },

  // kind 13: portEconomy (stride 0x25)
  { key: "portEconomy.priceRegion", kind: 13, field: 33, label: "物价区域", indexed: true },

  // kind 14: regionPrices (stride 0x80)
  { key: "regionPrices.sellBase", kind: 14, field: 0, label: "卖出基价", indexed: true },
  { key: "regionPrices.buyGoods", kind: 14, field: 110, label: "特产收购表", indexed: true },

  // kind 16: discoveries (stride 7)
  { key: "discoveries.item", kind: 16, field: 4, label: "发现物编号", indexed: true },
  { key: "discoveries.importance", kind: 16, field: 5, label: "发现物重要度", indexed: true },
  { key: "discoveries.flags", kind: 16, field: 6, label: "发现状态标志", indexed: true },

  // kind 17: items (stride 0x14)
  { key: "items.name", kind: 17, field: 0, label: "道具名", indexed: true },
  { key: "items.power", kind: 17, field: 18, label: "道具威力", indexed: true },
  { key: "items.kindFlags", kind: 17, field: 19, label: "道具类型与装备", indexed: true },

  // kind 18: colony (unindexed/per index)
  { key: "colony.data", kind: 18, field: 0, label: "殖民地资料", indexed: true },

  // kind 19: runtime.bd06
  { key: "runtime.bd06", kind: 19, field: 0, label: "运行期寄存器", indexed: true },
];

const BY_KIND_FIELD = new Map<string, FieldMetaEntry>();
const BY_KEY = new Map<string, FieldMetaEntry>();
for (const e of FIELD_ENTRIES) {
  BY_KIND_FIELD.set(`${e.kind}:${e.field}`, e);
  BY_KEY.set(e.key, e);
}

export function getFieldMeta(kind: number, field: number): FieldMetaEntry | null {
  return BY_KIND_FIELD.get(`${kind}:${field}`) ?? null;
}

export function describeKindField(kind: number, field: number): string {
  const m = getFieldMeta(kind, field);
  return m ? `${m.key} (${m.label})` : `table_${kind}+0x${field.toString(16)}`;
}

export function formatFieldTarget(kind: number, field: number, indexExpr: number | string): { target: string; note: string } {
  const m = getFieldMeta(kind, field);
  if (!m) return { target: `table_${kind}[${indexExpr}]+0x${field.toString(16)}`, note: `表#${kind} 偏移0x${field.toString(16)}` };
  if (!m.indexed && indexExpr === 0) return { target: m.key, note: m.label };
  const dot = m.key.indexOf(".");
  const tbl = m.key.slice(0, dot), fld = m.key.slice(dot + 1);
  return { target: `${tbl}[${indexExpr}].${fld}`, note: m.label };
}

export interface ParsedFieldTarget {
  readonly kind: number;
  readonly index: { readonly var: number } | { readonly imm: number };
  readonly field: number;
}

export function parseFieldTarget(target: string): ParsedFieldTarget {
  // Match either "globals.hero", "heroData[v10].rank", "heroData[0].rank", or "table_6[0]+0x3f"
  let m = target.match(/^([a-zA-Z0-9_]+)\[(v?\d+)\]\.([a-zA-Z0-9_]+)$/);
  if (m) {
    const [, tbl, idxStr, fld] = m;
    const entry = BY_KEY.get(`${tbl}.${fld}`);
    if (!entry) throw new Error(`Unknown field target: ${target}`);
    const index = idxStr.startsWith("v") ? { var: parseInt(idxStr.slice(1), 10) } : { imm: parseInt(idxStr, 10) };
    return { kind: entry.kind, index, field: entry.field };
  }
  m = target.match(/^([a-zA-Z0-9_]+\.[a-zA-Z0-9_]+)$/);
  if (m) {
    const entry = BY_KEY.get(m[1]);
    if (!entry) throw new Error(`Unknown unindexed field target: ${target}`);
    return { kind: entry.kind, index: { imm: 0 }, field: entry.field };
  }
  m = target.match(/^table_(\d+)\[(v?\d+)\]\+0x([0-9a-fA-F]+)$/);
  if (m) {
    const [, kStr, idxStr, fHex] = m;
    const index = idxStr.startsWith("v") ? { var: parseInt(idxStr.slice(1), 10) } : { imm: parseInt(idxStr, 10) };
    return { kind: parseInt(kStr, 10), index, field: parseInt(fHex, 16) };
  }
  throw new Error(`Invalid field target syntax: ${target}`);
}

export type StoryOperand =
  | { readonly var: number }
  | { readonly ptr: number }
  | { readonly flag: number }
  | { readonly imm: number }
  | { readonly sys: number };

export function formatOperand(o: StoryOperand): string | number {
  if ("var" in o) return `v${o.var}`;
  if ("ptr" in o) return `*v${o.ptr}`;
  if ("flag" in o) return `F${o.flag}`;
  if ("imm" in o) return o.imm;
  return `sys#${o.sys}`;
}

export function parseOperandToken(tok: string | number): StoryOperand {
  if (typeof tok === "number") return { imm: tok };
  const s = tok.trim();
  if (/^-?\d+$/.test(s)) return { imm: parseInt(s, 10) };
  if (/^v\d+$/.test(s)) return { var: parseInt(s.slice(1), 10) };
  if (/^\*v\d+$/.test(s)) return { ptr: parseInt(s.slice(2), 10) };
  if (/^F\d+$/.test(s)) return { flag: parseInt(s.slice(1), 10) };
  if (/^sys#\d+$/.test(s)) return { sys: parseInt(s.slice(4), 10) };
  throw new Error(`Invalid operand token: ${tok}`);
}

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

export function formatCondExpr(c: StoryCond): string {
  if ("op" in c) {
    if (c.op === "not") return `!(${formatCondExpr(c.expr)})`;
    const sep = c.op === "and" ? " && " : " || ";
    return c.args.map(a => formatCondExpr(a)).join(sep);
  }
  const lhs = formatOperand(c.dst);
  const rhs = formatOperand(c.src);
  if (c.not) {
    if (c.cmp === "ge") return `${lhs} < ${rhs}`;
    if (c.cmp === "le") return `${lhs} > ${rhs}`;
    if (c.cmp === "eq") return `${lhs} != ${rhs}`;
    return `${lhs} == ${rhs}`;
  }
  const sym = c.cmp === "eq" ? "==" : c.cmp === "ne" ? "!=" : c.cmp === "ge" ? ">=" : "<=";
  return `${lhs} ${sym} ${rhs}`;
}

export function parseWhenExpr(expr: string): StoryCond {
  const m = expr.trim().match(/^(\S+)\s*(==|!=|>=|<=|<|>)\s*(\S+)$/);
  if (!m) throw new Error(`Invalid when expression: ${expr}`);
  const [, lStr, sym, rStr] = m;
  const dst = parseOperandToken(lStr);
  const src = parseOperandToken(rStr);
  switch (sym) {
    case "==": return { cmp: "eq", dst, src };
    case "!=": return { cmp: "ne", dst, src };
    case ">=": return { cmp: "ge", dst, src };
    case "<=": return { cmp: "le", dst, src };
    case "<": return { cmp: "ge", dst, src, not: true };
    case ">": return { cmp: "le", dst, src, not: true };
    default: throw new Error(`Unsupported comparison operator: ${sym}`);
  }
}

export type StoryAluFn = "add" | "sub" | "mul" | "div" | "or" | "and" | "shr" | "shl";

export type StoryStep =
  | { readonly op: "if"; readonly when?: string; readonly cond?: StoryCond; readonly then: StoryStep[]; readonly else?: StoryStep[] }
  | { readonly op: "loop"; readonly body: StoryStep[] }
  | { readonly op: "break" }
  | { readonly op: "continue" }
  | { readonly op: "block"; readonly label: string; readonly body: StoryStep[] }
  | { readonly op: "exit"; readonly target: string }
  // 融合高层剧情演出指令
  | {
      readonly op: "say";
      readonly win?: number;
      readonly face?: number;
      readonly speaker?: string;
      readonly faceVar?: number;
      readonly msg: number;
      readonly text: string;
      readonly wait?: boolean;
    }
  // 融合高层状态字段读写指令
  | { readonly op: "get_field"; readonly to: string; readonly from: string; readonly size: "u8" | "u16" | "u8_lo"; readonly note?: string }
  | { readonly op: "set_field"; readonly target: string; readonly value: string | number; readonly size: "u8" | "u16"; readonly note?: string }
  | { readonly op: "alu_field"; readonly target: string; readonly fn: StoryAluFn; readonly value: string | number; readonly size: "u8" | "u16"; readonly note?: string }
  // 简化变量/标志操作
  | { readonly op: "set"; readonly dst: string; readonly value: string | number; readonly size?: "u8" | "u16"; readonly ptrLoad?: "u8" | "u16"; readonly note?: string }
  | { readonly op: "calc"; readonly dst: string; readonly fn: StoryAluFn; readonly value: string | number }
  // 保留基础演出与控制原语（兼容未融合情况）
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
  | { readonly op: "alu"; readonly fn: StoryAluFn; readonly dst: StoryOperand; readonly src: StoryOperand }
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
