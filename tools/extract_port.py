# extract_port.py — 港口场景用到的原始数据 → web/assets
#   data/za_dat.bin   ZA_DAT.DAT 原样 (101 港 × 24 bytes: 12 个建筑入口 (x,y); 读入 DS:0904, seg0:88a7)
#   gfx/transit.bin   TRANSIT.DAT 原样 (船首像 2b119)
#   data/windcur.bin  WINDCUR.DAT 原样 (3 × 450: 夏季风向 / 冬季风向 / 海流, 1fd9:333a 前的 1667a 读入 [0400]/[0404])
#   gfx/char.bin      CHAR.LZW: 主角 #0..5 各 0x1400 + #6 (0x3C00) 依序相接
#                     (seg0:88e9 把 #主角 读到 [06ce]:0, #6 读到 [06ce]:1400; 精灵格式见 RE_NOTES 第 15 节)
#   gfx/compass.bin   DATA1.LZW #6 (3840 bytes; seg0:8c53 读到 [0c86]+0x3EA0, 罗盘指针 8 张 5 栏×24 行)
#   gfx/portchip.bin  PORTCHIP.LZW 14 项原样相接 (7 组 × (0x7800 图块 + 4 bytes 参数))
#   gfx/portmap.bin   PORTMAP.LZW 101 张 × 0x2400 相接
# 用法: python extract_port.py <sea2 目录> <web/assets 目录>
import json, os, struct, sys

DS = 0x38150          # DGROUP 在 MAIN.EXE 加载映像中的线性地址 (与 re_env.py 相同)
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
        "titleFame": [u16(0xb49a + 2 * i) for i in range(10)],   # DS:b49a 各爵位晋升所需声望 (占卜师 事业运)
        # 酒馆 (1fd9:78f5 及子功能, 见 RE_NOTES 第 17 节)
        "tavern": {
            "liquors": ptrs(0x07a2, 14),                # DS:07a2 酒名 (港口经济 +24 为编号)
            "liquorPrice": list(b(0x07be, 14)),         # DS:07be 每杯价格
            "titles": [cs(0x082a + 9 * i) for i in range(10)],        # DS:082a 爵位
            "ottomanTitles": [cs(0x0884 + 9 * i) for i in range(10)], # DS:0884 奥斯曼官阶 (主角 5)
            "stats": ptrs(0x08f6, 7),                   # DS:08f6 能力名
            "crewRoles": ptrs(0x081c, 7),               # DS:081c 人物 +2e 职务 (0 = 无)
            "fmt": {k: cs(v) for k, v in {"girlName": 0x8b6a, "talk2": 0x8b88, "talk3": 0x8b72, "shipName": 0xaef2,
                    "captain": 0xaef8, "crewHdr": 0xaf07, "crew": 0xaf1d, "need": 0xaf2f, "personRow": 0xa1a6}.items()},
        },
        # 码头 (1fd9:8993 及子功能, 见 RE_NOTES 第 19 节)
        "wharf": {k: cs(v) for k, v in {"winColor": 0xafa4, "departHdr": 0xafab, "departRow": 0xafd4, "unloadAsk": 0xaff6,
                  "supplyColor": 0xb008, "supplyRow": 0xb00f, "load": 0xb024, "unload": 0xb02d, "supplyHdr": 0xb036}.items()},
        # 造船厂 / 船坞 (RE_NOTES 第 20 节): 2af30 船只数据、27f34 船坞列表、清单种类 0 的列格式 (DS:a17e)
        "shipyard": {k: cs(v) for k, v in {"name": 0xb316, "durability": 0xb32f, "load": 0xb33e, "crew": 0xb357, "need": 0xb371,
                     "guns": 0xb38a, "dockColor": 0xb055, "dockRow": 0xb05c, "dockTitle": 0xb06f, "listRow0": 0xa17e}.items()},
        # 造新船 / 买旧船 / 改造 (RE_NOTES 20.6..20.8)
        "build": {
            "levels": [list(b(0xb268 + 8 * lv, 8)) for lv in range(11)],   # DS:b268 造船等级 (港口经济 +22) 可造船型, FF 结束
            "typeMsg": [u16(0xb2c0 + 2 * i) for i in range(25)],          # DS:b2c0 船型说明消息
            # 清单种类 15/16/17 列格式读 DS:0930 / 093c / 07cc 指针表; 材质数超过 6 时原版接着读到 093c 表 (照搬)
            "materials": ptrs(0x0930, 17),
            "figureheads": ptrs(0x093c, 11),
            "cannons": ptrs(0x07cc, 8),
            "cannonPrice": [u16(0x080c + 2 * i) for i in range(8)],       # DS:080c 每门砲价格
            "fmt": {k: cs(v) for k, v in {"durNum": 0xb2fa, "designNums": 0xb304, "crewRange": 0xb396,
                    "gunRange": 0xb3a3, "dockFull": 0xb3ae}.items()},
        },
        # 酒馆 酒吧女郎 (1fd9:7337 及子功能, RE_NOTES 17.8)
        "bargirl": {
            "discCats": ptrs(0x0952, 8),                # DS:0952 发现物种类 (2e09:681c 发现物数据)
            "itemTypes": ptrs(0x0962, 14),              # DS:0962 随身物种类 (29340 道具数据)
            "surveyRange": list(b(0xaf52, 4)),          # DS:af52 调查结果: 种类 k 的舰队编号 [k]..[k+1]
            "fmt": {k: cs(v) for k, v in {"discHdr": 0xb910, "s": 0xb917, "cat": 0xb91a, "imp": 0xb921, "itemHdr": 0xb0e4,
                    "equip": 0xb0ed, "atk": 0xb0fa, "def": 0xb10a, "color0": 0xb11a}.items()},
        },
        # 交易所 (1fd9:52f9 及子功能, RE_NOTES 21)
        "market": {
            "cats": ptrs(0x078e, 10),                   # DS:078e 商品分类名 (物价清单 / 0x97)
            "catEnd": list(b(0x0784, 10)),              # DS:0784 各分类最后一个商品 + 1 (2441e)
            "fmt": {k: cs(v) for k, v in {"buyHdr": 0xae52, "buyRow": 0xae67, "buyRow2": 0xae70, "sellHdr": 0xae79, "sellRow": 0xae96,
                    "priceHdr": 0xaea5, "name": 0xaebf, "n5": 0xaec5, "none": 0xaec9, "n5b": 0xaecf, "sp5": 0xaed3, "listCap": 0xa19d}.items()},
        },
        # 酒馆 赌博 (1fd9:7491: 二十一点 2e8ed / 骰子 2fc60, RE_NOTES 17.9)
        "gamble": {
            "items": [cs(0xaf72), cs(0xaf7b)],                                  # DS:af72 / af7b 子菜单
            "ranks": [cs(0xb4f6 + o) for o in (0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 21, 23, 25)],   # DS:b4f6.. 牌面 A..K
            "hands": ptrs(0xb5b8, 7),                                           # DS:b5b8 骰子牌型名
            "fmt": {k: cs(v) for k, v in {"card": 0xb511, "bet": 0xb51c, "deal": 0xb534, "stand": 0xb539, "n4": 0xb53e,
                    "d": 0xb548, "reset": 0xb54b, "keep": 0xb552, "blank4": 0xb557, "blank14": 0xb570, "hand": 0xb5a8}.items()},
        },
        # 折抵旧船剩余货物重新分配 (0fea:e788 / fe57, RE_NOTES 20.9)
        "leftover": {
            "speedRate": list(b(0x06d8, 25)),                               # DS:06d8 船型速度系数 (1c0a8)
            "gunWeight": [struct.unpack("<h", b(0x07dc + 2 * i, 2))[0] for i in range(8)],   # DS:07dc 每门砲重量 ×10 (seg0:5db1)
            "supplies": ptrs(0xa8f4, 4),                                    # DS:a8f4 水 / 粮食 / 资材 / 弹药
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
    wr("gfx/transit.bin", rd("TRANSIT.DAT"))   # 船首像 (2b119: 偏移 0x1980 + 0x480×船首像, 6 栏 × 48 行 平面交错)
    ch = ls_unpack(rd("CHAR.LZW")); assert [len(p) for p in ch] == [0x1400] * 6 + [0x3c00]
    wr("gfx/char.bin", b"".join(ch))
    d1 = ls_unpack(rd("DATA1.LZW")); assert len(d1[6]) == 0xf00
    wr("gfx/compass.bin", d1[6])
    assert len(d1[9]) == 0x15c0
    wr("gfx/gamble.bin", d1[9])          # 赌博: 扑克牌 (4 花色 + 背面, 各 0x300) 与骰子 (6 面, 各 0x120, 偏移 0xf00)
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
