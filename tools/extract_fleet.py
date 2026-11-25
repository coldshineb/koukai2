# extract_fleet.py — 月末 / 年末结算与舰队 AI 用的常数表 → web/assets/data/fleet.json (可重复运行)
#   MAIN.EXE DGROUP 内的表 (见 TABLES; 用途见 docs/RE_NOTES.md 第 29 节)、DS:0000..0ca4 常数区 (dsLow) 与 NAME.TBL (185a7 新人物的名 / 姓: 6 国 × 16 笔 × 26 bytes = 名 13 + 姓 13)
# 用法: python tools/extract_fleet.py <sea2 目录> <web/assets 目录>   (或 exec 后调用 main(sea2, assets))
import json, os, struct, sys

DS = 0x38150

# (地址, 长度, 类型 b=byte / w=uint16 / raw=十六进位字符串)
TABLES = {
    "powerDiv": (0xa3da, 8, "b"),         # 17a80 各地区商业值的除数
    "diplo": (0xa3fe, 84, "b"),           # 17fc9 外交表 [3·(4q + 局势) + 标志]; 原表 36 bytes, 友好度高时读到后面的 a422 (照原样多取)
    "fleetA": (0xa422, 42, "w"),          # 182df 商船 1..4 号补船 (3 × 国 + 等级, 4 比特 × 3 个候选)
    "fleetB": (0xa44c, 42, "w"),          # 183d3 舰队 5..6 号
    "fleetC": (0xa476, 42, "w"),          # 184c8 7..9 号
    "upgrade": (0xa4a0, 4, "b"),          # 18cfb 换船 (种类 → 2 个 4 比特)
    "mission": (0xb89c, 18, "w"),         # 33c2d 首都出港后的新任务 (国家方针 N +3 → 3 组 4 比特)
    "goodsCat": (0x0784, 10, "b"),        # 2441e 商品编号 → 类别的区间
}


def main(sea2, assets):
    ex = open(os.path.join(sea2, "MAIN.EXE"), "rb").read(); img = ex[struct.unpack("<H", ex[8:10])[0] * 16:]
    tab = {}
    for k, (o, n, t) in TABLES.items():
        raw = img[DS + o:DS + o + n]
        tab[k] = list(raw) if t == "b" else list(struct.unpack("<%dH" % (n // 2), raw)) if t == "w" else raw.hex()
    names = open(os.path.join(sea2, "NAME.TBL"), "rb").read()
    # DS:0000..0ca4 (存盘区之前的常数区): 原版在表外读取时用到 (例: 航向 FF 时 1ae55 读 DS:0718+FF、1acbf 读 DS:06d8 + 8k + 帆种)
    out = {"tab": tab, "names": names.hex(), "dsLow": img[DS:DS + 0x0ca4].hex()}
    p = os.path.join(assets, "data", "fleet.json")
    json.dump(out, open(p, "w", encoding="utf-8"), ensure_ascii=False)
    print("->", p, {k: len(v) for k, v in tab.items()}, "NAME.TBL", len(names), "bytes")
    return out


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
