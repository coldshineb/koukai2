# extract_sea.py — 出海与航海用的数据 → web/assets (可重复运行; 不改 tools/extract_port.py)
#   gfx/worldmap.bin   WORLDMAP.LZW 3 项解码后的格码: 每项 45 列 × 30 栏个「海域格」(24×24 地图格), 每格 12×12 个码 (1 码 = 2×2 地图格)
#                      排列: 项 k (0..2) → 格 i = 列×30 + 栏 → 144 bytes (12 行 × 12), 共 3 × 1350 × 144 bytes
#   gfx/seachip.bin    DATA1.LZW #11 (海上图块 128 块 × 128 bytes + 船只精灵 32×32, 每个 512 bytes), 加载到 [03ee]
#   gfx/seacompass.bin DATA1.LZW #7 (海上罗盘指针 18 × 512 bytes), 加载到 [0c86]+0x3ea0
#   data/sea.json      DATA1 #10 (海岸自动接边表, [03f8], 512 bytes)、#12 (港口 / 发现物座标哈希表, [06d0], 512 bytes)、
#                      #18 (格码 → 2×2 图块, [03fc], 1024 bytes), 以及 MAIN.EXE DGROUP 内的表与字符串 (见 TABLES / STR)
#   (WORLDMAP 的格式与解码见 tools/extract_worldmap.py)
# 用法: python tools/extract_sea.py <sea2 目录> <web/assets 目录>   (或 exec 后调用 main(sea2, assets))
import json, os, struct, sys

DS = 0x38150
HERE = os.path.dirname(os.path.abspath(__file__))

# MAIN.EXE DGROUP 内的表 (地址, 长度, 类型 b=byte / h=int16 / w=uint16)
TABLES = {
    "windSpeed": (0x06d8, 0x80, "b"),         # 8067 / 314eb 风向差 k 的速度系数: DS:06d8 + 8k + 船型帆种
    "dirX": (0x0718, 8, "sb"), "dirY": (0x0720, 8, "sb"),   # 31728 8 方位的位移矢量
    "shipDir": (0x8b20, 8, "b"),              # 6cfc 方位 → 精灵方向
    "buttons": (0xa9d8, 13 * 9, "b"),         # 21008 海上画面按钮 (x, y, w, h 为 int16, +8 按键)
    "path8": (0xae18, 24, "sb"),              # 23872 / 23a97 8 方向 (dx, dy, 成本)
    "dir3": (0xae38, 9, "b"),                 # 23a97 (3dy + dx + 4) → 方位
    "dock12": (0xa6e8, 24, "sb"),             # 1bf79 靠港时检查的 12 个相对位置 (dx, dy)
    "usedShips": (0xa67e, 0x58, "b"),         # 1bd16 各地区 (E +22) 的中古船候选 8 种
    "usedShips2": (0xa6d6, 18, "b"),          # 1bd16 依商业值的另外 2 种
    "landDX": (0xb92e, 16, "h"), "landDY": (0xb93e, 16, "h"),   # 34ec7 上陆的 8 个位置
    "shrink": (0xa7b8, 16, "b"),              # 1d8ac 4 像素 → 2 像素 (取第 0 与第 3 个)
    "chartX": (0xa7c8, 16, "b"),              # 1dd76 地图类随身物的 X 记号 (a7c8 / a7cf)
}
STR = {
    "dateColor": 0x8b8f, "n5": 0x8b96, "n5b": 0x8b9a, "n3": 0x8b9e, "day2": 0x8b28, "month": 0x8b32, "speed": 0x8b1a,
    "dialNum": 0x8c1a,
    "captain": 0xb758, "foundPort": 0xb75f, "foundVillage": 0xb76b,   # 30b34 发现
    "assistant": 0xa652, "captainT": 0xa657, "levelUp": 0xa65c, "listSep": 0xa672, "rise": 0xa677,   # 1bc14 升级
    "move": 0xa9c9, "stop": 0xa9d0,                                    # 20ee3 停船 / 出航
    # 1feae 侦察 (舰队数据: 名•姓 / 国名+种类 / 速度 / 航向 / 船名「%-14s」/ 换行)、1fd9c 港口、3119b 指定目的地
    "scName": 0xa93b, "scNation": 0xa943, "scSpeed": 0xa949, "scHead": 0xa95b, "scShip": 0xa96b, "nl": 0xa971,
    "scPort": 0xa92a, "destPrompt": 0xb7be,
    "seaEvent": 0xb777,                                                # 30e9f 海上特殊地点「船长！不得了啦！快看海面上！」
    "landDur": 0xb8e2, "landTurn": 0xb8e7, "landProp": 0xb8ec, "landHdr": 0xb8f1,   # 340f5 / 341cd 修理窗口 (RE_NOTES 36.4)
    "landV1": 0xb8f8, "landV2": 0xb900, "landV3": 0xb908,               # 341cd 「%3d/%3d」× 3
    "lsMark": 0xa183, "lsShip": 0xa187, "lsColor0": 0xa18c, "lsPad": 0xa1c5, "lsWater": 0xa1c7,   # 清单种类 0x0a (148c1) / 0x0b (14bc1)
}
PTRS = {"months": (0x8af0, 12), "statNames": (0x08f6, 4)}               # 71c6 月份字符串 / 1bc14 能力名


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
           "nodeCount": struct.unpack("<H", d1[5][:2])[0],           # DATA1 #5 = [bd7e] 地点数 (#4 = 地点表 [0c96])
           "str": {k: cs(v) for k, v in STR.items()}}
    for k, (o, n) in PTRS.items():
        out[k] = [cs(u16(o + 2 * i)) for i in range(n)]
    open(os.path.join(assets, "data", "monster.bin"), "wb").write(open(os.path.join(sea2, "MONSTER.DAT"), "rb").read())   # 31047 唯读 (原样)
    p = os.path.join(assets, "data", "sea.json")
    json.dump(out, open(p, "w", encoding="utf-8"), ensure_ascii=False)
    print("->", p, "worldmap", len(codes), "bytes; seachip", len(d1[11]), "seacompass", len(d1[7]))
    return out


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
