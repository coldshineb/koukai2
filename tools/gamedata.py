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
    if count: d["count"] = count
    d.update(kw); return d

# 名稱代號 (MAIN.EXE DGROUP 常數表, 見 NAME_TABLES): 欄位以 "ref" 註明對應的名稱表
TABLES = [
    {"name": "countries", "ds": 0x117A, "stride": 0x20, "count": 7, "accessor": "seg0:5bde",
     "note": "6 國 + 海盜 (與名稱表 countries 同序)",
     "fields": [
        F("capitalPort", 0x0A, evidence="0FEA:18786 [rec+0Ah] → 港口表 (seg0:5c9a)", ref="ports"),
        F("relations", 0x0B, count=7, evidence="對角線為 100 (各國對自己); 推定為國與國的友好度", conf="inferred"),
     ]},
    {"name": "heroData", "ds": 0x125A, "stride": 0x0E, "count": 6, "accessor": "seg0:5be8",
     "note": "6 筆, 與主角數相同; 用途待查",
     "fields": [
        F("countryStanding", 0x06, count=7, evidence="初值全為 100, 7 筆對應 7 國; 推定", conf="inferred"),
     ]},
    {"name": "persons", "ds": 0x12B6, "stride": 0x32, "count": 120, "accessor": "seg0:5bf8",
     "note": "人物 (主角、提督、船長、夥伴)",
     "fields": [
        F("givenName", 0x00, "str", size=13, evidence="0FEA:185a7 由 NAME.TBL 隨機抽名字寫入 rec+0"),
        F("familyName", 0x0D, "str", size=13, evidence="0FEA:185a7 寫入 rec+0Dh"),
        F("portrait", 0x1A, "u16", evidence="seg0:7d39: bit14-15 ≠ 0 → 拼合頭像部件字, 否則為具名頭像編號"),
        F("stats", 0x1C, count=8, evidence="0FEA:186b4 生成 8 個 60..94 的值; 名稱對應待確認", conf="inferred"),
        F("navLevel", 0x24, evidence="0FEA:1d302 MESSAGE #398「航海水平」印 rec+24h"),
        F("battleLevel", 0x25, evidence="0FEA:1d31e MESSAGE #399「戰鬥水平」印 rec+25h"),
        F("navExp", 0x26, "u16", evidence="生成時與 +28h 一起清 0; 推定為經驗值", conf="inferred"),
        F("battleExp", 0x28, "u16", evidence="同上", conf="inferred"),
        F("age", 0x2A, evidence="0FEA:186b1 生成 20..35; 推定為年齡", conf="inferred"),
        F("fleet", 0x2C, evidence="0FEA:162f1 [rec+2Ch] → 艦隊表 (seg0:5c28); 初值中有 10 人為 FE (推定 = 不屬於任何艦隊)", ref="fleets"),
        F("face", 0x31, evidence="seg0:7d39 低 4 位元 = 拼合頭像種類; 0FEA:1875b 生成時 |= 20h"),
     ]},
    {"name": "nobles", "ds": 0x2A26, "stride": 0x16, "count": 20, "accessor": "seg0:5c08",
     "note": "劇情人物 (國王、貴族、總督等) — 名稱首筆為「執事…」「…伯爵」「…公爵」",
     "fields": [F("name", 0x00, "str", size=0x11, evidence="記錄開頭為名稱字串")]},
    {"name": "barmaids", "ds": 0x2BDE, "stride": 0x13, "count": 34, "accessor": "seg0:5c18",
     "note": "酒吧女郎 (34 人; 有 0x12 bytes 尾隨資料在 2E64)",
     "fields": [F("name", 0x00, "str", size=0x0D, evidence="記錄開頭為名稱字串")]},
    {"name": "fleets", "ds": 0x2E76, "stride": 0x85, "count": 70, "accessor": "seg0:5c28",
     "fields": [
        F("x", 0x00, "u16", evidence="0FEA:187a7 由港口 +0/+2 複製到艦隊 +0/+2 (出港時位置)"),
        F("y", 0x02, "u16", evidence="同上"),
        F("ships", 0x2B, "struct", count=10, size=9, evidence="seg0:5c58: 編號 <10 時 = [c2d4]+2Bh+9×編號 (所屬艦隊的 10 艘)",
          fields=[F("ship", 0x07, evidence="0FEA:148c1 [slot+7] → 船隻表 (seg0:5c7a)", ref="ships")]),
     ]},
    {"name": "t52d4", "ds": 0x52D4, "stride": 0x1E, "count": 40, "accessor": "seg0:5c38", "note": "用途待查 (107 處引用)", "fields": []},
    {"name": "dockSlots", "ds": 0x5784, "stride": 0x09, "count": 30, "accessor": "seg0:5c58",
     "note": "船隻欄位編號 10..39 (seg0:5c58: 0x572A + 9×編號), 與 fleets.ships 同格式; 推定為寄放在港口的船",
     "fields": [F("ship", 0x07, evidence="同 fleets.ships", ref="ships")]},
    {"name": "ships", "ds": 0x5892, "stride": 0x16, "count": 65, "accessor": "seg0:5c7a",
     "note": "#0..39 個別船隻 (初值名稱為「１」..「40」, 類型 FF = 未使用); #40..64 為 25 種船的範本 (名稱 = 船種名)",
     "fields": [
        F("name", 0x00, "str", size=0x0F, evidence="範本記錄的名稱即船種名 (如 #64 為「關船」)"),
        F("type", 0x0F, evidence="0FEA:148d4 [rec+0Fh] → 船種表 (seg0:5c8a); FF = 空欄", ref="shipTypes"),
     ]},
    {"name": "shipTypes", "ds": 0x5E28, "stride": 0x0C, "count": 25, "accessor": "seg0:5c8a",
     "note": "25 種船的規格; 船種名見 ships #40..64, 說明見 MESSAGE #168..192",
     "fields": [F("price", 0x0A, "u16", evidence="數值隨船種遞增 (120 .. 32000); 推定為價格", conf="inferred")]},
    {"name": "ports", "ds": 0x5F54, "stride": 0x16, "count": 130, "accessor": "seg0:5c9a",
     "note": "#0..99 港口 (對應 PORTMAP / CHIP_NO 100 張), #100..129 待查 (推定為補給港)",
     "fields": [
        F("x", 0x00, "u16", evidence="0FEA:187a7 出港時複製到艦隊座標"),
        F("y", 0x02, "u16", evidence="同上"),
        F("name", 0x04, "str", size=0x11, evidence="0FEA:16b07 存檔一覽印 rec+4"),
        F("region", 0x15, evidence="0FEA:28a42 低 3 位元 = 港口 NPC 頭像種類"),
     ]},
    {"name": "portEconomy", "ds": 0x6A80, "stride": 0x25, "count": 100, "accessor": "seg0:5caa",
     "note": "100 筆, 與港口數相同; 推定為港口經濟資料",
     "fields": [
        F("influence", 0x08, count=6, evidence="各港 6 個值中屬國那一國為 100 (里斯本=葡萄牙…); 推定為 6 國支持度", conf="inferred"),
        F("prices", 0x0E, count=10, evidence="10 個 45..55 附近的值, 與 10 種商品類別同數; 推定為各類物價指數", conf="inferred"),
     ]},
    {"name": "t78f4", "ds": 0x78F4, "stride": 0x80, "count": 13, "accessor": "seg0:5cba", "note": "13 × 64 個 u16, 用途待查", "fields": []},
    {"name": "t7f74", "ds": 0x7F74, "stride": 0x08, "count": 3, "accessor": "seg0:5cc4", "note": "用途待查", "fields": []},
    {"name": "discoveries", "ds": 0x7F8C, "stride": 0x07, "count": 100, "accessor": "seg0:5cce",
     "note": "100 個發現物, 名稱與說明在 COLONY.DAT (100 × 177 bytes)",
     "fields": [
        F("x", 0x00, "u16", evidence="座標值域與港口相同; 推定為世界座標", conf="inferred"),
        F("y", 0x02, "u16", evidence="同上", conf="inferred"),
        F("flags", 0x06, evidence="0FEA:1685e 對 98 筆設 bit7; 推定 bit7 = 已發現", conf="inferred"),
     ]},
    {"name": "items", "ds": 0x8248, "stride": 0x14, "count": 100, "accessor": "seg0:5cde",
     "note": "道具 (說明見 ITEM.MES 100 筆)",
     "fields": [F("name", 0x00, "str", size=0x0F, evidence="記錄開頭為道具名 (匕首、短劍…); +0Fh 起為數值 (存檔中有非 0 值)")]},
]
GLOBALS = [
    {"name": "options", "ds": 0x0CA4, "type": "u8", "evidence": "環境設定位元 (1 動畫效果, 4 背景音樂, …); 0FEA:16c5e 讀檔修正"},
    {"name": "year", "ds": 0x0CAA, "type": "u8", "evidence": "0FEA:1681a 複製到 [0532]"},
    {"name": "month", "ds": 0x0CAB, "type": "u8", "evidence": "→ [0533], main 以它為月迴圈起點"},
    {"name": "day", "ds": 0x0CAC, "type": "u8", "evidence": "→ [0534]"},
    {"name": "time", "ds": 0x0CAD, "type": "u8", "evidence": "→ [0535]; 調色盤時段 (0FEA:1975a)"},
    {"name": "port", "ds": 0x0CAE, "type": "u8", "evidence": "目前港口, FF = 海上 (0FEA:1721f)"},
    {"name": "weather", "ds": 0x0CB3, "type": "u8", "evidence": "天候 (0FEA:1976e)"},
    {"name": "hero", "ds": 0x12B5, "type": "u8", "evidence": "主角編號 0..5 (0FEA:162e4)"},
]
# 讀檔時 DS:8A18..8D18 (0x300 bytes) 讀入緩衝 [0c8e] 而非 DS (0FEA:16c45)
TAIL = {"name": "buffer0c8e", "ds": 0x8A18, "size": 0x300, "note": "讀檔時讀入記憶體緩衝 [0c8e]; 用途待查"}

# MAIN.EXE DGROUP 內的常數名稱表 (不在存檔中): (名稱, 指標表 DS, 筆數, 引用處)
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
    if f["type"] == "str": return f["size"]
    if f["type"] == "struct": return f["size"] * f.get("count", 1)
    w = {"u8": 1, "u16": 2}[f["type"]]
    return w * f.get("count", 1)

def _spans(fields, size):
    """回傳 [(off, field|None, length)], None 表示未知區段"""
    out = []; p = 0
    for f in sorted(fields, key=lambda f: f["off"]):
        if f["off"] > p: out.append((p, None, f["off"] - p))
        n = _ftype_size(f); out.append((f["off"], f, n)); p = f["off"] + n
    if p < size: out.append((p, None, size - p))
    return out

def decode_record(b, fields, size, codec):
    rec = {}
    for off, f, n in _spans(fields, size):
        raw = b[off:off + n]
        if f is None: rec["u_%02x" % off] = raw.hex(); continue
        t, c = f["type"], f.get("count")
        if t == "str":
            k = raw.find(b"\0"); k = len(raw) if k < 0 else k
            rec[f["name"]] = codec.decode(raw[:k])
            if any(raw[k:]): rec[f["name"] + "Tail"] = raw[k:].hex()      # 結尾 0 之後的殘留位元組 (舊名稱等)
        elif t == "struct": rec[f["name"]] = [decode_record(raw[i * f["size"]:(i + 1) * f["size"]], f["fields"], f["size"], codec) for i in range(c)]
        elif t == "u8": rec[f["name"]] = list(raw) if c else raw[0]
        elif t == "u16":
            v = [struct.unpack("<H", raw[i * 2:i * 2 + 2])[0] for i in range(c or 1)]
            rec[f["name"]] = v if c else v[0]
    return rec

def encode_record(rec, fields, size, codec):
    out = bytearray(size)
    for off, f, n in _spans(fields, size):
        if f is None: out[off:off + n] = bytes.fromhex(rec["u_%02x" % off]); continue
        t, c, v = f["type"], f.get("count"), rec[f["name"]]
        if t == "str":
            e = codec.encode(v); tail = bytes.fromhex(rec.get(f["name"] + "Tail", ""))
            assert len(e) + len(tail) <= n, (f["name"], v); out[off:off + len(e)] = e; out[off + len(e):off + len(e) + len(tail)] = tail
        elif t == "struct":
            for i in range(c): out[off + i * f["size"]:off + (i + 1) * f["size"]] = encode_record(v[i], f["fields"], f["size"], codec)
        elif t == "u8": out[off:off + n] = bytes(v) if c else bytes([v])
        elif t == "u16":
            vs = v if c else [v]
            for i, x in enumerate(vs): out[off + i * 2:off + i * 2 + 2] = struct.pack("<H", x)
    return bytes(out)

def export_state(b, codec):
    """state bytes (0x8074 或 0x7D74/0x7D75) -> dict"""
    full = bytes(b) + bytes(max(0, (STATE_END - STATE_BASE) - len(b)))
    sl = lambda ds, n: full[ds - STATE_BASE:ds - STATE_BASE + n]
    out = {"format": "uw2-state-1", "sourceLength": len(b), "globals": {}, "tables": {}, "gaps": {}}
    for g in GLOBALS: out["globals"][g["name"]] = sl(g["ds"], 1)[0]
    # 區段: 全域區、表、表間空隙、尾段
    p = STATE_BASE
    for t in TABLES:
        if t["ds"] > p: out["gaps"]["%04x" % p] = sl(p, t["ds"] - p).hex()
        out["tables"][t["name"]] = [decode_record(sl(t["ds"] + i * t["stride"], t["stride"]), t["fields"], t["stride"], codec) for i in range(t["count"])]
        p = t["ds"] + t["count"] * t["stride"]
    if p < TAIL["ds"]: out["gaps"]["%04x" % p] = sl(p, TAIL["ds"] - p).hex()
    out["tail"] = sl(TAIL["ds"], TAIL["size"]).hex()
    return out

def import_state(d, codec):
    buf = bytearray(STATE_END - STATE_BASE)
    put = lambda ds, bb: buf.__setitem__(slice(ds - STATE_BASE, ds - STATE_BASE + len(bb)), bb)
    for k, v in d["gaps"].items(): put(int(k, 16), bytes.fromhex(v))
    for t in TABLES:
        for i, rec in enumerate(d["tables"][t["name"]]):
            put(t["ds"] + i * t["stride"], encode_record(rec, t["fields"], t["stride"], codec))
    put(TAIL["ds"], bytes.fromhex(d["tail"]))
    for g in GLOBALS: put(g["ds"], bytes([d["globals"][g["name"]]]))   # 全域值以 globals 為準 (也在 gaps 中)
    return bytes(buf[:d.get("sourceLength", len(buf))])

def export_names(main_exe_image, codec):
    """MAIN.EXE 載入映像 -> 常數名稱表 dict"""
    DSL = 0x38150
    rd16 = lambda o: struct.unpack("<H", main_exe_image[DSL + o:DSL + o + 2])[0]
    def cstr(o):
        e = DSL + o
        while main_exe_image[e]: e += 1
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
