"""
gamedata.py — 大航海時代II 遊戲狀態資料 (DS:0CA4..8D18, 0x8074 bytes) 的結構定義與 JSON 轉換

資料來源:
  * 新遊戲初值 = DATA1.LZW 第 15 項 (0x7D75 bytes; 前 0x7D74 與 MAIN.EXE DGROUP 0x0CA4..0x8A18 逐位元組相同)
  * 存檔 = KOUKAI2.DAT 每格 0x8074 bytes (= DS:0CA4..8D18)
結構由 MAIN.EXE 的資料表存取函式 (seg0:5bde..5cde, 形如 base + 編號 x 記錄大小) 取得, 16 張表剛好鋪滿整個區域。
欄位名稱只標註有程式碼證據的部分 (每個欄位附 evidence); 其餘位元組以 u_XX (十六進位字串) 原樣保留,
所以 JSON <-> 二進位可以逐位元組還原。

用法:
  python tools/gamedata.py schema  web/assets/data/schema.json
  python tools/gamedata.py export  <state.bin> <out.json> <charmap.json>
"""
import json, struct

STATE_BASE, STATE_END = 0x0CA4, 0x8D18


def F(name, off, type_="u8", count=None, evidence="", conf="confirmed", **kw):
    d = {"name": name, "off": off, "type": type_, "evidence": evidence, "confidence": conf}
    if count:
        d["count"] = count
    d.update(kw)
    return d


SHIP_SLOT_FIELDS = [
    F("crew", 0x00, "u16", evidence="水手數 (seg0:5c58 +0)"),
    F("durability", 0x02, evidence="目前耐久度 (seg0:5c58 +2)"),
    F("maxDurability", 0x03, evidence="最大耐久度 (seg0:5c58 +3)"),
    F("turn", 0x04, evidence="轉向力 (seg0:5c58 +4)"),
    F("propulsion", 0x05, evidence="推進力 (seg0:5c58 +5)"),
    F("guns", 0x06, evidence="武裝砲數 (seg0:5c58 +6)"),
    F("ship", 0x07, evidence="0FEA:148c1 [slot+7] → 船隻表 (seg0:5c7a)", ref="ships"),
    F("flags", 0x08, evidence="狀態與砲種 (bit4-5: 10=有船/20=建造或保管; 低3位=砲種)"),
]

# 名称代号 (MAIN.EXE DGROUP 常数表, 见 NAME_TABLES): 字段以 "ref" 注明对应的名称表
TABLES = [
    {"name": "countries", "ds": 0x117A, "stride": 0x20, "count": 7, "accessor": "seg0:5bde",
     "note": "6 國 + 海盜 (與名稱表 countries 同序)",
     "fields": [
        F("power", 0x00, "u16", evidence="17a80 國力/收益"),
        F("aidMoneyK", 0x05, evidence="2a713 資金援助 (單位: 千枚)"),
        F("aidShipType", 0x07, evidence="2a79b 援助船型", ref="shipTypes"),
        F("aidShipCount", 0x08, evidence="2a79b 援助船數"),
        F("capitalPort", 0x0A, evidence="0FEA:18786 [rec+0Ah] → 港口表 (seg0:5c9a)", ref="ports"),
        F("relations", 0x0B, count=7, evidence="對各國友好度 (0..100)"),
        F("treaties", 0x12, count=7, evidence="對各國同盟/封鎖狀態"),
     ]},
    {"name": "heroData", "ds": 0x125A, "stride": 0x0E, "count": 6, "accessor": "seg0:5be8",
     "note": "6 位主角名聲、聲望與爵位",
     "fields": [
        F("tradeFame", 0x00, "u16", evidence="商人名聲 (palace.js / market.js)"),
        F("pirateFame", 0x02, "u16", evidence="海盜名聲 (battle.js)"),
        F("adventureFame", 0x04, "u16", evidence="冒險家名聲 (house.js / land.js)"),
        F("countryStanding", 0x06, count=7, evidence="對 7 國聲望/功績"),
        F("rank", 0x0D, evidence="爵位 0..9 (palace.js)"),
     ]},
    {"name": "persons", "ds": 0x12B6, "stride": 0x32, "count": 120, "accessor": "seg0:5bf8",
     "note": "人物 (主角、提督、船長、夥伴)",
     "fields": [
        F("givenName", 0x00, "str", size=13, evidence="0FEA:185a7 由 NAME.TBL 隨機抽名字寫入 rec+0"),
        F("familyName", 0x0D, "str", size=13, evidence="0FEA:185a7 寫入 rec+0Dh"),
        F("portrait", 0x1A, "u16", evidence="seg0:7d39: bit14-15 ≠ 0 → 拼合頭像部件字, 否則為具名頭像編號"),
        F("stats", 0x1C, count=8, evidence="8 項能力值 (航海術/運用術/劍術/魅力/運氣/直覺/勇氣/統率等)"),
        F("navLevel", 0x24, evidence="0FEA:1d302 MESSAGE #398「航海水平」印 rec+24h"),
        F("battleLevel", 0x25, evidence="0FEA:1d31e MESSAGE #399「戰鬥水平」印 rec+25h"),
        F("navExp", 0x26, "u16", evidence="航海經驗值"),
        F("battleExp", 0x28, "u16", evidence="戰鬥經驗值"),
        F("age", 0x2A, evidence="年齡 (0FEA:186b1 生成 20..35)"),
        F("loyalty", 0x2B, evidence="忠誠度 (wharf 加薪判定 < 30)"),
        F("fleet", 0x2C, evidence="0FEA:162f1 [rec+2Ch] → 艦隊表 (seg0:5c28); FE/FF = 無艦隊", ref="fleets"),
        F("stayPort", 0x2D, evidence="停留港口 (0xFF = 不在特定港)"),
        F("role", 0x2E, evidence="職務/薪水等級 (commands.js / buildings.js)"),
        F("flags", 0x2F, evidence="人物旗標 (bit4 隱藏/不可交談, bit5 性格/AI 等)"),
        F("skills", 0x30, evidence="技能位元 (測量/地圖/砲術/交涉/會計)"),
        F("face", 0x31, evidence="國籍與拼合頭像種類 (低4位=國籍/頭像種類, bit4/5 狀態)"),
     ]},
    {"name": "nobles", "ds": 0x2A26, "stride": 0x16, "count": 20, "accessor": "seg0:5c08",
     "note": "劇情人物與住宅主人 (0..9 住宅收藏家/製圖/學校, 10..15 各國國王)",
     "fields": [
        F("name", 0x00, "str", size=0x11, evidence="記錄開頭為名稱字串"),
        F("kind", 0x11, evidence="住宅種類 0=收藏家 1=製圖 2=測量校 3=砲術校 FF=國王"),
        F("portrait", 0x12, "u16", evidence="KAO 具名頭像編號"),
        F("flags", 0x14, evidence="合約旗標 (bit4 已簽約, 低2位酬金等級)"),
        F("port", 0x15, evidence="所在港口", ref="ports"),
     ]},
    {"name": "barmaids", "ds": 0x2BDE, "stride": 0x13, "count": 34, "accessor": "seg0:5c18",
     "note": "酒吧女郎 (前 30 人有效; 有 0x12 bytes 尾隨資料在 2E64)",
     "fields": [
        F("name", 0x00, "str", size=0x0D, evidence="記錄開頭為名稱字串"),
        F("age", 0x0D, evidence="芳齡 (RE_NOTES 17.8)"),
        F("port", 0x0E, evidence="所在港口", ref="ports"),
        F("affection", 0x0F, evidence="好感度 (0..100)"),
        F("quest", 0x10, evidence="調查委託 (低4位=國家, 高4位=種類, FF=無)"),
        F("questDays", 0x11, evidence="調查剩餘天數"),
        F("flags", 0x12, evidence="旗標 (bit3 在店, bit4-5 性格, bit6 登場)"),
     ]},
    {"name": "fleets", "ds": 0x2E76, "stride": 0x85, "count": 70, "accessor": "seg0:5c28",
     "note": "70 支艦隊 (RE_NOTES 29.4)",
     "fields": [
        F("x", 0x00, "u16", evidence="世界座標 X"),
        F("y", 0x02, "u16", evidence="世界座標 Y"),
        F("destX", 0x04, "u16", evidence="目的地 X"),
        F("destY", 0x06, "u16", evidence="目的地 Y"),
        F("midX", 0x08, "u16", evidence="中途點 X"),
        F("midY", 0x0A, "u16", evidence="中途點 Y"),
        F("routeFlags", 0x0C, "u16", evidence="路線旗標 (RE_NOTES 28.4)"),
        F("routePts", 0x10, "u16", count=4, evidence="自動航行路線地點 (最多 4 點)"),
        F("subX", 0x18, evidence="格內位置 X"),
        F("subY", 0x19, evidence="格內位置 Y"),
        F("dir", 0x1A, evidence="航向 0..7"),
        F("mission", 0x1B, evidence="任務 0..10"),
        F("target", 0x1C, evidence="任務對象 (港口或人物)"),
        F("cargoGood", 0x21, evidence="商船載運商品"),
        F("cargoAmt", 0x22, "u16", evidence="商船載運數量"),
        F("funds", 0x24, "u16", evidence="艦隊資金"),
        F("homePort", 0x26, evidence="母港", ref="ports"),
        F("stayDays", 0x27, evidence="港口停留天數"),
        F("strength", 0x28, evidence="戰力評估 (18299)"),
        F("flags", 0x29, evidence="旗標 (bit0 出航中, bit4 在港, bit5 到達/停住, bit6 劇本)"),
        F("admiral", 0x2A, evidence="提督人物編號", ref="persons"),
        F("ships", 0x2B, "struct", count=10, size=9, evidence="seg0:5c58: 艦隊 10 艘船位", fields=SHIP_SLOT_FIELDS),
     ]},
    {"name": "t52d4", "ds": 0x52D4, "stride": 0x1E, "count": 40, "accessor": "seg0:5c38",
     "note": "船員配置 / 補給與載貨表 (0..9 主角艦隊, 10..39 船塢船)",
     "fields": [
        F("water", 0x00, "u16", evidence="水 (單位: 1/10 桶)"),
        F("food", 0x02, "u16", evidence="糧食 (單位: 1/10 桶)"),
        F("material", 0x04, "u16", evidence="資材"),
        F("ammo", 0x06, "u16", evidence="砲彈"),
        F("navRatio", 0x08, evidence="駕駛水手比例 (%)"),
        F("lookRatio", 0x09, evidence="瞭望水手比例 (%)"),
        F("loadTotal", 0x0A, "u16", evidence="總載重 (seg0:5db1)"),
        F("cargoAmts", 0x0C, "u16", count=5, evidence="5 格商品數量 (buildings.js cargoUsed)"),
        F("cargoGoods", 0x16, count=5, evidence="5 格商品編號 (FF=空)"),
        F("captain", 0x1B, evidence="船長人物編號 (或 港|0x80 表示在該港船塢/造船中)"),
        F("morale", 0x1C, evidence="士氣 0..100"),
        F("figurehead", 0x1D, evidence="船首像 0..10"),
     ]},
    {"name": "dockSlots", "ds": 0x5784, "stride": 0x09, "count": 30, "accessor": "seg0:5c58",
     "note": "船塢船位 10..39 (seg0:5c58: 0x572A + 9×編號), 與 fleets.ships 同格式",
     "fields": SHIP_SLOT_FIELDS},
    {"name": "ships", "ds": 0x5892, "stride": 0x16, "count": 65, "accessor": "seg0:5c7a",
     "note": "#0..39 個別船隻 (類型 FF = 未使用); #40..64 為 25 種船型範本",
     "fields": [
        F("name", 0x00, "str", size=0x0F, evidence="船名 (範本為船種名)"),
        F("type", 0x0F, evidence="0FEA:148d4 [rec+0Fh] → 船種表 (seg0:5c8a); FF = 空欄", ref="shipTypes"),
        F("flags", 0x10, evidence="船隻旗標 / 材質 (bit4 特殊船型/外觀)"),
        F("maxGuns", 0x11, evidence="最大武裝數"),
        F("maxCrew", 0x12, "u16", evidence="最大水手數"),
        F("maxCargo", 0x14, "u16", evidence="最大載貨量"),
     ]},
    {"name": "shipTypes", "ds": 0x5E28, "stride": 0x0C, "count": 25, "accessor": "seg0:5c8a",
     "note": "25 種船的規格; 船種名見 ships #40..64, 說明見 MESSAGE #168..192",
     "fields": [
        F("shipClass", 0x00, evidence="船種分類"),
        F("durability", 0x01, evidence="基準耐久 (初始耐久 = 9×此值/10)"),
        F("turn", 0x02, evidence="基準轉向力"),
        F("propulsion", 0x03, evidence="基準推進力"),
        F("maxCrewDiv10", 0x04, evidence="最多人員 / 10"),
        F("minCrew", 0x05, evidence="必要水手數"),
        F("capacity", 0x06, "u16", evidence="總載重量"),
        F("maxGuns", 0x08, evidence="最大武器數"),
        F("buildLevel", 0x09, evidence="造船所需工業等級"),
        F("price", 0x0A, "u16", evidence="基準造價"),
     ]},
    {"name": "ports", "ds": 0x5F54, "stride": 0x16, "count": 130, "accessor": "seg0:5c9a",
     "note": "#0..99 港口 (對應 PORTMAP / CHIP_NO 100 張), #100..129 補給港",
     "fields": [
        F("x", 0x00, "u16", evidence="世界座標 X"),
        F("y", 0x02, "u16", evidence="世界座標 Y"),
        F("name", 0x04, "str", size=0x11, evidence="0FEA:16b07 存檔一覽印 rec+4"),
        F("region", 0x15, evidence="所屬國與屬性 (低3位=屬國/頭像種類, bit3 同盟/翻倍收益等)"),
     ]},
    {"name": "portEconomy", "ds": 0x6A80, "stride": 0x25, "count": 100, "accessor": "seg0:5caa",
     "note": "100 個港口的經濟、物價與商店資料",
     "fields": [
        F("commerce", 0x00, "u16", evidence="商業價值"),
        F("commerceInvest", 0x02, "u16", evidence="商業投資累計 (上限 50000)"),
        F("industry", 0x04, "u16", evidence="工業價值"),
        F("industryInvest", 0x06, "u16", evidence="工業投資累計"),
        F("influence", 0x08, count=6, evidence="6 國支持度 (合計 100)"),
        F("prices", 0x0E, count=10, evidence="10 類商品物價指數 (0..100, 顯示為 +50)"),
        F("specialtyBase", 0x18, "u16", evidence="特產基準價"),
        F("specialtyGood", 0x1A, evidence="特產商品編號 (FF=無)"),
        F("specialtyLevel", 0x1B, evidence="特產出現所需商業等級"),
        F("regionGroup", 0x1C, evidence="地區群組 0..7 (王宮勢力狀況/BGM)"),
        F("shopItems", 0x1D, count=4, evidence="道具店商品 (一般3項+夜市第4項, FF=無)"),
        F("priceRegion", 0x21, evidence="物價地區編號 0..12 (指向 t78f4)"),
        F("liquor", 0x24, evidence="酒館酒類編號 0..13"),
     ]},
    {"name": "t78f4", "ds": 0x78F4, "stride": 0x80, "count": 13, "accessor": "seg0:5cba",
     "note": "13 個物價地區的商品基準價表 (market.js)",
     "fields": [
        F("sellBase", 0x00, "u16", count=46, evidence="46 種商品賣價基準"),
        F("buyBase", 0x5C, "u16", count=9, evidence="9 種本區可買商品的買價基準"),
        F("buyGoods", 0x6E, count=9, evidence="9 種本區可買商品編號"),
        F("buyLevels", 0x77, count=9, evidence="9 種商品所需商業等級"),
     ]},
    {"name": "t7f74", "ds": 0x7F74, "stride": 0x08, "count": 3, "accessor": "seg0:5cc4",
     "note": "造船廠中古船快取表 (最近到過的 3 港; RE_NOTES 20.11)",
     "fields": [
        F("shipTypes", 0x00, count=5, evidence="5 格中古船船型 (FF=空)"),
        F("port", 0x05, evidence="所屬港口", ref="ports"),
     ]},
    {"name": "discoveries", "ds": 0x7F8C, "stride": 0x07, "count": 100, "accessor": "seg0:5cce",
     "note": "100 個發現物, 名稱與說明在 COLONY.DAT (100 × 177 bytes)",
     "fields": [
        F("x", 0x00, "u16", evidence="世界座標 X"),
        F("y", 0x02, "u16", evidence="世界座標 Y"),
        F("item", 0x04, evidence="對應寶物道具編號"),
        F("importance", 0x05, evidence="重要度 (0..100)"),
        F("flags", 0x06, evidence="旗標 (低3位=種類, bit5=已知, bit7=已發現)"),
     ]},
    {"name": "items", "ds": 0x8248, "stride": 0x14, "count": 100, "accessor": "seg0:5cde",
     "note": "道具 (說明見 ITEM.MES 100 筆)",
     "fields": [
        F("name", 0x00, "str", size=0x0F, evidence="道具名"),
        F("icon", 0x0F, evidence="KAO 道具小圖偏移 (+0x55)"),
        F("priceDiv100", 0x10, "u16", evidence="價格 / 100"),
        F("power", 0x12, evidence="攻防數值 / 地圖對應發現物編號"),
        F("kindFlags", 0x13, evidence="低4位=道具種類, bit4=已裝備"),
     ]},
]

GLOBALS = [
    {"name": "options", "ds": 0x0CA4, "type": "u8", "evidence": "環境設定位元 (bit0動畫, bit1結局, bit2BGM, bit3效果音, bit6劇本)"},
    {"name": "seaSpeed", "ds": 0x0CA6, "type": "u8", "evidence": "海上速度延遲 0..10 (0最快, 10最慢)"},
    {"name": "mouseSens", "ds": 0x0CA8, "type": "u8", "evidence": "滑鼠靈敏度 0..4"},
    {"name": "seaScroll", "ds": 0x0CA9, "type": "u8", "evidence": "海上移動值 0..10"},
    {"name": "year", "ds": 0x0CAA, "type": "u8", "evidence": "年 (相對 1500; 0FEA:1681a 複製到 [0532])"},
    {"name": "month", "ds": 0x0CAB, "type": "u8", "evidence": "月 0..11"},
    {"name": "day", "ds": 0x0CAC, "type": "u8", "evidence": "日 0..30"},
    {"name": "time", "ds": 0x0CAD, "type": "u8", "evidence": "時刻 0..71 (調色盤時段)"},
    {"name": "port", "ds": 0x0CAE, "type": "u8", "evidence": "目前港口, FF = 海上"},
    {"name": "lastPort", "ds": 0x0CAF, "type": "u8", "evidence": "上次所在港口"},
    {"name": "dailyFlags", "ds": 0x0CB0, "type": "u8", "evidence": "每日重設旗標 (bit1造船廠被拒, bit6女郎見聞等)"},
    {"name": "portFlags", "ds": 0x0CB1, "type": "u8", "evidence": "港內狀態旗標"},
    {"name": "weather", "ds": 0x0CB3, "type": "u8", "evidence": "天候 (0..5)"},
    {"name": "portViewX", "ds": 0x0CB4, "type": "u16", "evidence": "港內地圖視窗左上 X"},
    {"name": "portViewY", "ds": 0x0CB6, "type": "u16", "evidence": "港內地圖視窗左上 Y"},
    {"name": "heroWinX", "ds": 0x0CB8, "type": "u16", "evidence": "主角在港內視窗的 X"},
    {"name": "heroWinY", "ds": 0x0CBA, "type": "u16", "evidence": "主角在港內視窗的 Y"},
    {"name": "heroChap", "ds": 0x0CD4, "type": "u8", "evidence": "主角專屬劇本當前章"},
    {"name": "heroSec", "ds": 0x0CD5, "type": "u8", "evidence": "主角專屬劇本當前節"},
    {"name": "commonChap", "ds": 0x0D5E, "type": "u8", "evidence": "共用劇本 (工作) 當前章"},
    {"name": "commonSec", "ds": 0x0D5F, "type": "u8", "evidence": "共用劇本 (工作) 當前節"},
    {"name": "seaFlags", "ds": 0x1004, "type": "u8", "evidence": "海上狀態旗標低位元組"},
    {"name": "seaFlags2", "ds": 0x1005, "type": "u8", "evidence": "海上狀態旗標高位元組 (bit3/4上陸, bit5停船)"},
    {"name": "seaViewX", "ds": 0x1006, "type": "u16", "evidence": "世界地圖視窗左上 X"},
    {"name": "seaViewY", "ds": 0x1008, "type": "u16", "evidence": "世界地圖視窗左上 Y"},
    {"name": "money", "ds": 0x12AE, "type": "u32", "evidence": "所持現金 (32 位元, 上限 6 億)"},
    {"name": "bankQuotient", "ds": 0x12B2, "type": "u16", "evidence": "銀行餘額 / 100 (有號 16 位元, 負為借款)"},
    {"name": "bankRem", "ds": 0x12B4, "type": "u8", "evidence": "銀行餘額餘數 (0..100)"},
    {"name": "hero", "ds": 0x12B5, "type": "u8", "evidence": "主角編號 0..5"},
    {"name": "discoveryId", "ds": 0x8246, "type": "u8", "evidence": "當前選中/發現物編號 (FF=無)"},
]

# 读档时 DS:8A18..8D18 (0x300 bytes) 读入缓冲 [0c8e] 而非 DS (0FEA:16c45): 48 笔 × 16 bytes 航海日志/交易记录
TAIL = {"name": "buffer0c8e", "ds": 0x8A18, "size": 0x300, "note": "航海日誌 / 交易記錄緩衝 [0c8e] (48 筆 × 16 bytes)"}

# MAIN.EXE DGROUP 内的常数名称表 (不在存盘中): (名称, 指针表 DS, 笔数, 引用处)
NAME_TABLES = [
    ("goods", 0x0728, 46, "0FEA:149b6"), ("goodsCategories", 0x078E, 10, "0FEA:14c54"), ("liquors", 0x07A2, 14, "0FEA:25f48"),
    ("cannons", 0x07CC, 8, "0FEA:14cd9"), ("crewRoles", 0x081E, 6, "0FEA:1eca1"), ("countries", 0x08DE, 7, "seg0:65e7"),
    ("skills", 0x08EC, 5, "0FEA:16488"), ("stats", 0x08F6, 7, "0FEA:1bc97"), ("shipSlots", 0x091C, 10, "0FEA:b09e"),
    ("hullMaterials", 0x0930, 6, "0FEA:14c9f"), ("figureheads", 0x093E, 10, "(指標表緊接其後, 無直接引用)"),
    ("discoveryCategories", 0x0952, 8, "seg2e09:34833"), ("itemCategories", 0x0964, 13, "seg0:2b98"),
]
FIXED_NAME_TABLES = [("titles", 0x082A, 9, 10, "0FEA:1cab0"), ("ottomanTitles", 0x0884, 9, 10, "0FEA:1caa6")]


# ---------------------------------------------------------------------------
def schema():
    return {"stateBase": STATE_BASE, "stateEnd": STATE_END, "loadSize": 0x8A18 - STATE_BASE,
            "globals": GLOBALS, "tables": TABLES, "tail": TAIL}


def _ftype_size(f):
    if f["type"] == "str":
        return f["size"]
    if f["type"] == "struct":
        return f["size"] * f.get("count", 1)
    w = {"u8": 1, "u16": 2, "u32": 4}[f["type"]]
    return w * f.get("count", 1)


def _spans(fields, size):
    """回傳 [(off, field|None, length)], None 表示未知區段"""
    out = []
    p = 0
    for f in sorted(fields, key=lambda f: f["off"]):
        if f["off"] > p:
            out.append((p, None, f["off"] - p))
        n = _ftype_size(f)
        out.append((f["off"], f, n))
        p = f["off"] + n
    if p < size:
        out.append((p, None, size - p))
    return out


def decode_record(b, fields, size, codec):
    rec = {}
    for off, f, n in _spans(fields, size):
        raw = b[off:off + n]
        if f is None:
            rec["u_%02x" % off] = raw.hex()
            continue
        t, c = f["type"], f.get("count")
        if t == "str":
            k = raw.find(b"\0")
            k = len(raw) if k < 0 else k
            rec[f["name"]] = codec.decode(raw[:k])
            if any(raw[k:]):
                rec[f["name"] + "Tail"] = raw[k:].hex()
        elif t == "struct":
            rec[f["name"]] = [decode_record(raw[i * f["size"]:(i + 1) * f["size"]], f["fields"], f["size"], codec) for i in range(c)]
        elif t == "u8":
            rec[f["name"]] = list(raw) if c else raw[0]
        elif t == "u16":
            v = [struct.unpack("<H", raw[i * 2:i * 2 + 2])[0] for i in range(c or 1)]
            rec[f["name"]] = v if c else v[0]
        elif t == "u32":
            v = [struct.unpack("<I", raw[i * 4:i * 4 + 4])[0] for i in range(c or 1)]
            rec[f["name"]] = v if c else v[0]
    return rec


def encode_record(rec, fields, size, codec):
    out = bytearray(size)
    for off, f, n in _spans(fields, size):
        if f is None:
            out[off:off + n] = bytes.fromhex(rec["u_%02x" % off])
            continue
        t, c, v = f["type"], f.get("count"), rec[f["name"]]
        if t == "str":
            e = codec.encode(v)
            tail = bytes.fromhex(rec.get(f["name"] + "Tail", ""))
            assert len(e) + len(tail) <= n, (f["name"], v)
            out[off:off + len(e)] = e
            out[off + len(e):off + len(e) + len(tail)] = tail
        elif t == "struct":
            for i in range(c):
                out[off + i * f["size"]:off + (i + 1) * f["size"]] = encode_record(v[i], f["fields"], f["size"], codec)
        elif t == "u8":
            out[off:off + n] = bytes(v) if c else bytes([v])
        elif t == "u16":
            vs = v if c else [v]
            for i, x in enumerate(vs):
                out[off + i * 2:off + i * 2 + 2] = struct.pack("<H", x)
        elif t == "u32":
            vs = v if c else [v]
            for i, x in enumerate(vs):
                out[off + i * 4:off + i * 4 + 4] = struct.pack("<I", x)
    return bytes(out)


def _read_global(sl, g):
    t = g.get("type", "u8")
    if t == "u32":
        return struct.unpack("<I", sl(g["ds"], 4))[0]
    if t == "u16":
        return struct.unpack("<H", sl(g["ds"], 2))[0]
    return sl(g["ds"], 1)[0]


def _write_global(put, g, val):
    t = g.get("type", "u8")
    if t == "u32":
        put(g["ds"], struct.pack("<I", val & 0xffffffff))
    elif t == "u16":
        put(g["ds"], struct.pack("<H", val & 0xffff))
    else:
        put(g["ds"], bytes([val & 0xff]))


def export_state(b, codec):
    """state bytes (0x8074 或 0x7D74/0x7D75) -> dict"""
    full = bytes(b) + bytes(max(0, (STATE_END - STATE_BASE) - len(b)))
    sl = lambda ds, n: full[ds - STATE_BASE:ds - STATE_BASE + n]
    out = {"format": "uw2-state-1", "sourceLength": len(b), "globals": {}, "tables": {}, "gaps": {}}
    for g in GLOBALS:
        out["globals"][g["name"]] = _read_global(sl, g)
    p = STATE_BASE
    for t in TABLES:
        if t["ds"] > p:
            out["gaps"]["%04x" % p] = sl(p, t["ds"] - p).hex()
        out["tables"][t["name"]] = [decode_record(sl(t["ds"] + i * t["stride"], t["stride"]), t["fields"], t["stride"], codec) for i in range(t["count"])]
        p = t["ds"] + t["count"] * t["stride"]
    if p < TAIL["ds"]:
        out["gaps"]["%04x" % p] = sl(p, TAIL["ds"] - p).hex()
    out["tail"] = sl(TAIL["ds"], TAIL["size"]).hex()
    return out


def import_state(d, codec):
    buf = bytearray(STATE_END - STATE_BASE)
    put = lambda ds, bb: buf.__setitem__(slice(ds - STATE_BASE, ds - STATE_BASE + len(bb)), bb)
    for k, v in d["gaps"].items():
        put(int(k, 16), bytes.fromhex(v))
    for t in TABLES:
        for i, rec in enumerate(d["tables"][t["name"]]):
            put(t["ds"] + i * t["stride"], encode_record(rec, t["fields"], t["stride"], codec))
    put(TAIL["ds"], bytes.fromhex(d["tail"]))
    for g in GLOBALS:
        _write_global(put, g, d["globals"][g["name"]])
    return bytes(buf[:d.get("sourceLength", len(buf))])


def export_names(main_exe_image, codec):
    """MAIN.EXE 載入映像 -> 常數名稱表 dict"""
    DSL = 0x38150
    rd16 = lambda o: struct.unpack("<H", main_exe_image[DSL + o:DSL + o + 2])[0]

    def cstr(o):
        e = DSL + o
        while main_exe_image[e]:
            e += 1
        return codec.decode(main_exe_image[DSL + o:e])

    out = {}
    for name, tbl, n, ref in NAME_TABLES:
        out[name] = {"ds": "%04x" % tbl, "ref": ref, "items": [cstr(rd16(tbl + i * 2)) for i in range(n)]}
    for name, base, stride, n, ref in FIXED_NAME_TABLES:
        out[name] = {"ds": "%04x" % base, "stride": stride, "ref": ref,
                     "items": [codec.decode(main_exe_image[DSL + base + i * stride:DSL + base + (i + 1) * stride].split(b"\0")[0]) for i in range(n)]}
    return out


if __name__ == "__main__":
    import sys
    if sys.argv[1] == "schema":
        json.dump(schema(), open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    elif sys.argv[1] == "export":
        import os
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from extract import TextCodec
        codec = TextCodec(sys.argv[4])
        data = open(sys.argv[2], "rb").read()
        json.dump(export_state(data, codec), open(sys.argv[3], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
