# extract_port.py — 港口場景用到的原始資料 → web/assets
#   data/za_dat.bin   ZA_DAT.DAT 原樣 (101 港 × 24 bytes: 12 個建築入口 (x,y); 讀入 DS:0904, seg0:88a7)
#   gfx/transit.bin   TRANSIT.DAT 原樣 (船首像 2b119)
#   data/windcur.bin  WINDCUR.DAT 原樣 (3 × 450: 夏季風向 / 冬季風向 / 海流, 1fd9:333a 前的 1667a 讀入 [0400]/[0404])
#   gfx/char.bin      CHAR.LZW: 主角 #0..5 各 0x1400 + #6 (0x3C00) 依序相接
#                     (seg0:88e9 把 #主角 讀到 [06ce]:0, #6 讀到 [06ce]:1400; 精靈格式見 RE_NOTES 第 15 節)
#   gfx/compass.bin   DATA1.LZW #6 (3840 bytes; seg0:8c53 讀到 [0c86]+0x3EA0, 羅盤指針 8 張 5 欄×24 行)
#   gfx/portchip.bin  PORTCHIP.LZW 14 項原樣相接 (7 組 × (0x7800 圖塊 + 4 bytes 參數))
#   gfx/portmap.bin   PORTMAP.LZW 101 張 × 0x2400 相接
# 用法: python extract_port.py <sea2 目錄> <web/assets 目錄>
import json, os, struct, sys

DS = 0x38150          # DGROUP 在 MAIN.EXE 載入映像中的線性位址 (與 re_env.py 相同)
def ds_tables(sea2):
    ex = open(os.path.join(sea2, "MAIN.EXE"), "rb").read(); img = ex[struct.unpack("<H", ex[8:10])[0] * 16:]
    b = lambda o, n: img[DS + o:DS + o + n]
    u16 = lambda o: struct.unpack("<H", b(o, 2))[0]
    def cs(o):
        t = b(o, 64); return t[:t.index(0)].hex()
    ptrs = lambda o, n: [cs(u16(o + 2 * i)) for i in range(n)]
    return {
        # seg0:869f 左右面板
        "fmt": {k: cs(v) for k, v in {"color": 0x8ba2, "year": 0x8ba9, "date": 0x8baf, "clock": 0x8bb6, "fame": 0x8bc4,
                "money": 0x8bc8, "empty": 0x8bd0, "supply": 0x8bd1, "portName": 0x8bd8, "economy": 0x8bde,
                "colony": 0x8b0c, "ally": 0x8b13, "color2": 0xa60a}.items()},
        "months": ptrs(0x8af0, 12),                     # DS:8af0
        "nations": ptrs(0x08de, 7),                     # DS:08de
        "goods": ptrs(0x0728, 46),                      # DS:0728
        "buttons": [list(struct.unpack("<4h", b(0xa59e + i * 9, 8))) + [b(0xa59e + i * 9 + 8, 1)[0]] for i in range(12)],  # DS:a59e
        "daysInMonth": list(b(0xa250, 12)),             # DS:a250
        "titleFame": [u16(0xb49a + 2 * i) for i in range(10)],   # DS:b49a 各爵位晉升所需聲望 (占卜師 事業運)
        # 酒館 (1fd9:78f5 及子功能, 見 RE_NOTES 第 17 節)
        "tavern": {
            "liquors": ptrs(0x07a2, 14),                # DS:07a2 酒名 (港口經濟 +24 為編號)
            "liquorPrice": list(b(0x07be, 14)),         # DS:07be 每杯價格
            "titles": [cs(0x082a + 9 * i) for i in range(10)],        # DS:082a 爵位
            "ottomanTitles": [cs(0x0884 + 9 * i) for i in range(10)], # DS:0884 奧斯曼官階 (主角 5)
            "stats": ptrs(0x08f6, 7),                   # DS:08f6 能力名
            "crewRoles": ptrs(0x081c, 7),               # DS:081c 人物 +2e 職務 (0 = 無)
            "fmt": {k: cs(v) for k, v in {"girlName": 0x8b6a, "talk2": 0x8b88, "talk3": 0x8b72, "shipName": 0xaef2,
                    "captain": 0xaef8, "crewHdr": 0xaf07, "crew": 0xaf1d, "need": 0xaf2f, "personRow": 0xa1a6}.items()},
        },
        # 碼頭 (1fd9:8993 及子功能, 見 RE_NOTES 第 19 節)
        "wharf": {k: cs(v) for k, v in {"winColor": 0xafa4, "departHdr": 0xafab, "departRow": 0xafd4, "unloadAsk": 0xaff6,
                  "supplyColor": 0xb008, "supplyRow": 0xb00f, "load": 0xb024, "unload": 0xb02d, "supplyHdr": 0xb036}.items()},
        # 造船廠 / 船塢 (RE_NOTES 第 20 節): 2af30 船隻資料、27f34 船塢列表、清單種類 0 的列格式 (DS:a17e)
        "shipyard": {k: cs(v) for k, v in {"name": 0xb316, "durability": 0xb32f, "load": 0xb33e, "crew": 0xb357, "need": 0xb371,
                     "guns": 0xb38a, "dockColor": 0xb055, "dockRow": 0xb05c, "dockTitle": 0xb06f, "listRow0": 0xa17e}.items()},
        # 造新船 / 買舊船 / 改造 (RE_NOTES 20.6..20.8)
        "build": {
            "levels": [list(b(0xb268 + 8 * lv, 8)) for lv in range(11)],   # DS:b268 造船等級 (港口經濟 +22) 可造船型, FF 結束
            "typeMsg": [u16(0xb2c0 + 2 * i) for i in range(25)],          # DS:b2c0 船型說明訊息
            # 清單種類 15/16/17 列格式讀 DS:0930 / 093c / 07cc 指標表; 材質數超過 6 時原版接著讀到 093c 表 (照搬)
            "materials": ptrs(0x0930, 17),
            "figureheads": ptrs(0x093c, 11),
            "cannons": ptrs(0x07cc, 8),
            "cannonPrice": [u16(0x080c + 2 * i) for i in range(8)],       # DS:080c 每門砲價格
            "fmt": {k: cs(v) for k, v in {"durNum": 0xb2fa, "designNums": 0xb304, "crewRange": 0xb396,
                    "gunRange": 0xb3a3, "dockFull": 0xb3ae}.items()},
        },
        # 酒館 酒吧女郎 (1fd9:7337 及子功能, RE_NOTES 17.8)
        "bargirl": {
            "discCats": ptrs(0x0952, 8),                # DS:0952 發現物種類 (2e09:681c 發現物資料)
            "itemTypes": ptrs(0x0962, 14),              # DS:0962 隨身物種類 (29340 道具資料)
            "surveyRange": list(b(0xaf52, 4)),          # DS:af52 調查結果: 種類 k 的艦隊編號 [k]..[k+1]
            "fmt": {k: cs(v) for k, v in {"discHdr": 0xb910, "s": 0xb917, "cat": 0xb91a, "imp": 0xb921, "itemHdr": 0xb0e4,
                    "equip": 0xb0ed, "atk": 0xb0fa, "def": 0xb10a, "color0": 0xb11a}.items()},
        },
        # 折抵舊船剩餘貨物重新分配 (0fea:e788 / fe57, RE_NOTES 20.9)
        "leftover": {
            "speedRate": list(b(0x06d8, 25)),                               # DS:06d8 船型速度係數 (1c0a8)
            "gunWeight": [struct.unpack("<h", b(0x07dc + 2 * i, 2))[0] for i in range(8)],   # DS:07dc 每門砲重量 ×10 (seg0:5db1)
            "supplies": ptrs(0xa8f4, 4),                                    # DS:a8f4 水 / 糧食 / 資材 / 彈藥
            "fmt": {k: cs(v) for k, v in {"fleetHdr": 0xa80e, "fleetRow": 0xa834, "fleetGone": 0xa84e, "title": 0xa8fc,
                    "num": 0xa90d, "shipName": 0xa911}.items()},
        },
    }

def main(sea2, assets, ls_unpack):
    rd = lambda n: open(os.path.join(sea2, n), "rb").read()
    os.makedirs(os.path.join(assets, "data"), exist_ok=True); os.makedirs(os.path.join(assets, "gfx"), exist_ok=True)
    wr = lambda p, b: open(os.path.join(assets, p), "wb").write(b)
    wr("data/za_dat.bin", rd("ZA_DAT.DAT"))
    wr("data/windcur.bin", rd("WINDCUR.DAT"))
    wr("gfx/transit.bin", rd("TRANSIT.DAT"))   # 船首像 (2b119: 偏移 0x1980 + 0x480×船首像, 6 欄 × 48 行 平面交錯)
    ch = ls_unpack(rd("CHAR.LZW")); assert [len(p) for p in ch] == [0x1400] * 6 + [0x3c00]
    wr("gfx/char.bin", b"".join(ch))
    d1 = ls_unpack(rd("DATA1.LZW")); assert len(d1[6]) == 0xf00
    wr("gfx/compass.bin", d1[6])
    pc = ls_unpack(rd("PORTCHIP.LZW")); assert len(pc) == 14
    wr("gfx/portchip.bin", b"".join(pc))
    pm = ls_unpack(rd("PORTMAP.LZW")); assert all(len(p) == 0x2400 for p in pm)
    wr("gfx/portmap.bin", b"".join(pm))
    json.dump(ds_tables(sea2), open(os.path.join(assets, "data", "port.json"), "w", encoding="utf-8"), indent=1)
    print("port assets ok:", len(pm), "maps")

if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from uw2lib import ls_unpack
    main(sys.argv[1], sys.argv[2], ls_unpack)
