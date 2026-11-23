# extract_fleet.py — 月末 / 年末結算與艦隊 AI 用的常數表 → web/assets/data/fleet.json (可重複執行)
#   MAIN.EXE DGROUP 內的表 (見 TABLES; 用途見 docs/RE_NOTES.md 第 29 節)、DS:0000..0ca4 常數區 (dsLow) 與 NAME.TBL (185a7 新人物的名 / 姓: 6 國 × 16 筆 × 26 bytes = 名 13 + 姓 13)
# 用法: python tools/extract_fleet.py <sea2 目錄> <web/assets 目錄>   (或 exec 後呼叫 main(sea2, assets))
import json, os, struct, sys

DS = 0x38150

# (位址, 長度, 型別 b=byte / w=uint16 / raw=十六進位字串)
TABLES = {
    "powerDiv": (0xa3da, 8, "b"),         # 17a80 各地區商業值的除數
    "diplo": (0xa3fe, 84, "b"),           # 17fc9 外交表 [3·(4q + 局勢) + 旗標]; 原表 36 bytes, 友好度高時讀到後面的 a422 (照原樣多取)
    "fleetA": (0xa422, 42, "w"),          # 182df 商船 1..4 號補船 (3 × 國 + 等級, 4 位元 × 3 個候選)
    "fleetB": (0xa44c, 42, "w"),          # 183d3 艦隊 5..6 號
    "fleetC": (0xa476, 42, "w"),          # 184c8 7..9 號
    "upgrade": (0xa4a0, 4, "b"),          # 18cfb 換船 (種類 → 2 個 4 位元)
    "mission": (0xb89c, 18, "w"),         # 33c2d 首都出港後的新任務 (國家方針 N +3 → 3 組 4 位元)
    "goodsCat": (0x0784, 10, "b"),        # 2441e 商品編號 → 類別的區間
}


def main(sea2, assets):
    ex = open(os.path.join(sea2, "MAIN.EXE"), "rb").read(); img = ex[struct.unpack("<H", ex[8:10])[0] * 16:]
    tab = {}
    for k, (o, n, t) in TABLES.items():
        raw = img[DS + o:DS + o + n]
        tab[k] = list(raw) if t == "b" else list(struct.unpack("<%dH" % (n // 2), raw)) if t == "w" else raw.hex()
    names = open(os.path.join(sea2, "NAME.TBL"), "rb").read()
    # DS:0000..0ca4 (存檔區之前的常數區): 原版在表外讀取時用到 (例: 航向 FF 時 1ae55 讀 DS:0718+FF、1acbf 讀 DS:06d8 + 8k + 帆種)
    out = {"tab": tab, "names": names.hex(), "dsLow": img[DS:DS + 0x0ca4].hex()}
    p = os.path.join(assets, "data", "fleet.json")
    json.dump(out, open(p, "w", encoding="utf-8"), ensure_ascii=False)
    print("->", p, {k: len(v) for k, v in tab.items()}, "NAME.TBL", len(names), "bytes")
    return out


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
