// modern/ui_strings.ts — 全部不影響存檔的固定 UI 標籤、標題、屬性名與表頭（標準簡體中文，忠實原版名詞）
export const UI_STR = {
  cmdButtons: ["情报", "经营", "命令", "航海术"] as const,

  heroStats: ["统御力", "航海术", "知识", "直觉", "勇气", "剑术", "魅力"] as const,

  infoTabs: [
    "自舰队情报",
    "舰船情报",
    "人物情报",
    "主公情报",
    "积载情报",
    "积载一览表",
    "发现物情报",
    "航海图",
    "航海日志",
    "海港地图",
  ] as const,

  marketTabs: ["买进", "卖出", "投资", "物价"] as const,

  wharfTitle: "码头",
  wharfTabs: ["补给", "船坞"] as const,
  wharfDepart: "出航",
  supplies: ["水", "食物", "资材", "炮弹"] as const,
  dockActions: ["保管", "配备", "交换"] as const,

  fleetHubTitle: "经营",
  fleetHubTabs: ["船长变更", "水手比例", "人事变更", "积载分配"] as const,
  crewPosts: ["大副", "会计", "水手长"] as const,
  crewRatios: ["操帆", "瞭望", "甲板"] as const,

  belongingsTitle: "随身物",
  belongingsActions: ["佩戴", "使用"] as const,
  formationTitle: "队形变更",
  newGameTitle: "开始新航海",

  listTitles: {
    0: "选择舰船",
    1: "选择交易品",
    2: "选择舰船",
    3: "选择目标舰队",
    4: "选择舰船（剩余舱容）",
    5: "选择港口",
    6: "选择人物",
    7: "选择舰船",
    8: "选择商品类别",
    9: "选择船员",
    10: "选择修理舰船",
    11: "选择补水舰船",
    12: "选择目标舰队",
    13: "选择随身物",
    14: "选择船型",
    15: "选择船材",
    16: "选择船首像",
    17: "选择火炮",
    18: "选择发现物",
    20: "选择海域",
  } as Record<number, string>,
} as const;
