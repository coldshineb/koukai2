# extract_sea.py — 出海與航海用的資料 → web/assets (可重複執行; 不改 tools/extract_port.py)
#   gfx/worldmap.bin   WORLDMAP.LZW 3 項解碼後的格碼: 每項 45 列 × 30 欄個「海域格」(24×24 地圖格), 每格 12×12 個碼 (1 碼 = 2×2 地圖格)
#                      排列: 項 k (0..2) → 格 i = 列×30 + 欄 → 144 bytes (12 行 × 12), 共 3 × 1350 × 144 bytes
#   gfx/seachip.bin    DATA1.LZW #11 (海上圖塊 128 塊 × 128 bytes + 船隻精靈 32×32, 每個 512 bytes), 載入到 [03ee]
#   gfx/seacompass.bin DATA1.LZW #7 (海上羅盤指針 18 × 512 bytes), 載入到 [0c86]+0x3ea0
#   data/sea.json      DATA1 #10 (海岸自動接邊表, [03f8], 512 bytes)、#12 (港口 / 發現物座標雜湊表, [06d0], 512 bytes)、
#                      #18 (格碼 → 2×2 圖塊, [03fc], 1024 bytes), 以及 MAIN.EXE DGROUP 內的表與字串 (見 TABLES / STR)
#   (WORLDMAP 的格式與解碼見 tools/extract_worldmap.py)
# 用法: python tools/extract_sea.py <sea2 目錄> <web/assets 目錄>   (或 exec 後呼叫 main(sea2, assets))
import json, os, struct, sys

DS = 0x38150
HERE = os.path.dirname(os.path.abspath(__file__))

# MAIN.EXE DGROUP 內的表 (位址, 長度, 型別 b=byte / h=int16 / w=uint16)
TABLES = {
    "windSpeed": (0x06d8, 0x80, "b"),         # 8067 / 314eb 風向差 k 的速度係數: DS:06d8 + 8k + 船型帆種
    "dirX": (0x0718, 8, "sb"), "dirY": (0x0720, 8, "sb"),   # 31728 8 方位的位移向量
    "shipDir": (0x8b20, 8, "b"),              # 6cfc 方位 → 精靈方向
    "buttons": (0xa9d8, 13 * 9, "b"),         # 21008 海上畫面按鈕 (x, y, w, h 為 int16, +8 按鍵)
    "path8": (0xae18, 24, "sb"),              # 23872 / 23a97 8 方向 (dx, dy, 成本)
    "dir3": (0xae38, 9, "b"),                 # 23a97 (3dy + dx + 4) → 方位
    "dock12": (0xa6e8, 24, "sb"),             # 1bf79 靠港時檢查的 12 個相對位置 (dx, dy)
    "usedShips": (0xa67e, 0x58, "b"),         # 1bd16 各地區 (E +22) 的中古船候選 8 種
    "usedShips2": (0xa6d6, 18, "b"),          # 1bd16 依商業值的另外 2 種
    "landDX": (0xb92e, 16, "h"), "landDY": (0xb93e, 16, "h"),   # 34ec7 上陸的 8 個位置
    "shrink": (0xa7b8, 16, "b"),              # 1d8ac 4 像素 → 2 像素 (取第 0 與第 3 個)
    "chartX": (0xa7c8, 16, "b"),              # 1dd76 地圖類隨身物的 X 記號 (a7c8 / a7cf)
}
STR = {
    "dateColor": 0x8b8f, "n5": 0x8b96, "n5b": 0x8b9a, "n3": 0x8b9e, "day2": 0x8b28, "month": 0x8b32, "speed": 0x8b1a,
    "dialNum": 0x8c1a,
    "captain": 0xb758, "foundPort": 0xb75f, "foundVillage": 0xb76b,   # 30b34 發現
    "assistant": 0xa652, "captainT": 0xa657, "levelUp": 0xa65c, "listSep": 0xa672, "rise": 0xa677,   # 1bc14 升級
    "move": 0xa9c9, "stop": 0xa9d0,                                    # 20ee3 停船 / 出航
    # 1feae 偵察 (艦隊資料: 名•姓 / 國名+種類 / 速度 / 航向 / 船名「%-14s」/ 換行)、1fd9c 港口、3119b 指定目的地
    "scName": 0xa93b, "scNation": 0xa943, "scSpeed": 0xa949, "scHead": 0xa95b, "scShip": 0xa96b, "nl": 0xa971,
    "scPort": 0xa92a, "destPrompt": 0xb7be,
    "seaEvent": 0xb777,                                                # 30e9f 海上特殊地點「船長！不得了啦！快看海面上！」
    "landDur": 0xb8e2, "landTurn": 0xb8e7, "landProp": 0xb8ec, "landHdr": 0xb8f1,   # 340f5 / 341cd 修理視窗 (RE_NOTES 36.4)
    "landV1": 0xb8f8, "landV2": 0xb900, "landV3": 0xb908,               # 341cd 「%3d/%3d」× 3
    "lsMark": 0xa183, "lsShip": 0xa187, "lsColor0": 0xa18c, "lsPad": 0xa1c5, "lsWater": 0xa1c7,   # 清單種類 0x0a (148c1) / 0x0b (14bc1)
}
PTRS = {"months": (0x8af0, 12), "statNames": (0x08f6, 4)}               # 71c6 月份字串 / 1bc14 能力名


def ls_unpack(b):
    g = {}
    exec(open(os.path.join(HERE, "uw2lib.py"), encoding="utf-8").read(), g)
    return g["ls_unpack"](b)


def main(sea2, assets):
    ex = open(os.path.join(sea2, "MAIN.EXE"), "rb").read(); img = ex[struct.unpack("<H", ex[8:10])[0] * 16:]
    b = lambda o, n: img[DS + o:DS + o + n]
    d1 = ls_unpack(open(os.path.join(sea2, "DATA1.LZW"), "rb").read())
    wp = os.path.join(HERE, "extract_worldmap.py")
    g = {"__name__": "extract_worldmap", "__fi" + "le__": wp}
    exec(compile(open(wp, encoding="utf-8").read(), wp, "exec"), g)
    codes = g["decode_all"](sea2)
    open(os.path.join(assets, "gfx", "worldmap.bin"), "wb").write(codes)
    open(os.path.join(assets, "gfx", "seachip.bin"), "wb").write(d1[11])
    open(os.path.join(assets, "gfx", "seacompass.bin"), "wb").write(d1[7])
    tab = {}
    for k, (o, n, t) in TABLES.items():
        raw = b(o, n)
        tab[k] = list(raw) if t == "b" else [x - 256 if x > 127 else x for x in raw] if t == "sb" else list(struct.unpack("<%dh" % (n // 2), raw)) if t == "h" else raw.hex()
    def cs(o):
        t = b(o, 256); return t[:t.index(0)].hex()
    u16 = lambda o: struct.unpack("<H", b(o, 2))[0]
    out = {"autotile": list(d1[10]), "hash": list(d1[12]), "codeTiles": list(d1[18]), "tab": tab,
           "nodeCount": struct.unpack("<H", d1[5][:2])[0],           # DATA1 #5 = [bd7e] 地點數 (#4 = 地點表 [0c96])
           "str": {k: cs(v) for k, v in STR.items()}}
    for k, (o, n) in PTRS.items():
        out[k] = [cs(u16(o + 2 * i)) for i in range(n)]
    open(os.path.join(assets, "data", "monster.bin"), "wb").write(open(os.path.join(sea2, "MONSTER.DAT"), "rb").read())   # 31047 唯讀 (原樣)
    p = os.path.join(assets, "data", "sea.json")
    json.dump(out, open(p, "w", encoding="utf-8"), ensure_ascii=False)
    print("->", p, "worldmap", len(codes), "bytes; seachip", len(d1[11]), "seacompass", len(d1[7]))
    return out


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
