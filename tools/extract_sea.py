# extract_sea.py — 出海與航海用的資料 → web/assets (可重複執行; 不改 tools/extract_port.py)
#   gfx/worldmap.bin   WORLDMAP.LZW 3 項解碼後的格碼: 每項 45 列 × 30 欄個「海域格」(24×24 地圖格), 每格 12×12 個碼 (1 碼 = 2×2 地圖格)
#                      排列: 項 k (0..2) → 格 i = 列×30 + 欄 → 144 bytes (12 行 × 12), 共 3 × 1350 × 144 bytes
#   gfx/seachip.bin    DATA1.LZW #11 (海上圖塊 128 塊 × 128 bytes + 船隻精靈 32×32, 每個 512 bytes), 載入到 [03ee]
#   gfx/seacompass.bin DATA1.LZW #7 (海上羅盤指針 18 × 512 bytes), 載入到 [0c86]+0x3ea0
#   data/sea.json      DATA1 #10 (海岸自動接邊表, [03f8], 512 bytes)、#12 (港口 / 發現物座標雜湊表, [06d0], 512 bytes)、
#                      #18 (格碼 → 2×2 圖塊, [03fc], 1024 bytes), 以及 MAIN.EXE DGROUP 內的表與字串 (見 TABLES / STR)
# WORLDMAP.LZW 格式 (MAIN.EXE 1fd9:2d89 = 線性 22b19 解碼, 見 docs/RE_NOTES.md 第 27 節):
#   每項開頭 1350 個 u16le 偏移 (相對於表尾 0xa8c), 依 列×30+欄 排列; 各格資料在檔中依序相連 (原版一次讀 3 格時直接往下讀)。
#   每格: 1 byte b; b&0x7f = 範本編號 (0x78..0x7d, 範本在 DS:6734 + 編號×0x90 = DS:aab4 起, 每個 144 bytes);
#         b&0x80 = 0 時接著 18 bytes 位元遮罩 (144 位元, 每 byte 高位元在前), 遮罩位元 1 的位置由資料流依序取 1 byte, 0 的位置用範本;
#         b&0x80 = 1 時整格就是範本。編號 < 0x78 時原版整格不寫 (保留緩衝原有內容) — 檔案中沒有這種格 (本工具檢查)。
# 用法: python tools/extract_sea.py <sea2 目錄> <web/assets 目錄>   (或 exec 後呼叫 main(sea2, assets))
import json, os, struct, sys

DS = 0x38150
HERE = os.path.dirname(os.path.abspath(__file__))

# MAIN.EXE DGROUP 內的表 (位址, 長度, 型別 b=byte / h=int16 / w=uint16)
TABLES = {
    "templates": (0xaab4, 6 * 0x90, "b"),     # 22b19 格範本 0x78..0x7d
    "windSpeed": (0x06d8, 0x80, "b"),         # 8067 / 314eb 風向差 k 的速度係數: DS:06d8 + 8k + 船型帆種
    "dirX": (0x0718, 8, "sb"), "dirY": (0x0720, 8, "sb"),   # 31728 8 方位的位移向量
    "shipDir": (0x8b20, 8, "b"),              # 6cfc 方位 → 精靈方向
    "buttons": (0xa9d8, 13 * 9, "b"),         # 21008 海上畫面按鈕 (x, y, w, h 為 int16, +8 按鍵)
}
STR = {
    "dateColor": 0x8b8f, "n5": 0x8b96, "n5b": 0x8b9a, "n3": 0x8b9e, "day2": 0x8b28, "month": 0x8b32, "speed": 0x8b1a,
    "dialNum": 0x8c1a,
    "captain": 0xb758, "foundPort": 0xb75f, "foundVillage": 0xb76b,   # 30b34 發現
}
PTRS = {"months": (0x8af0, 12)}                                       # 71c6 月份字串


def ls_unpack(b):
    exec(open(os.path.join(HERE, "uw2lib.py"), encoding="utf-8").read(), g := {})
    return g["ls_unpack"](b)


def decode_item(e, templates):
    """回傳 1350 格 × 144 碼 與 各格資料結尾位置 (檢查格資料相連)"""
    offs = struct.unpack("<1350H", e[:2700])
    out = bytearray(1350 * 144)
    ends = []
    for i, o in enumerate(offs):
        p = 0xa8c + o
        b = e[p]; p += 1
        k = b & 0x7f
        assert k >= 0x78 and k - 0x78 < 6, f"格 {i}: 範本 {k:#x}"
        t = templates[(k - 0x78) * 0x90:(k - 0x78 + 1) * 0x90]
        if b & 0x80:
            mask = bytes(18)
        else:
            mask = e[p:p + 18]; p += 18
        cell = bytearray(144)
        for j in range(144):
            if (mask[j >> 3] << (j & 7)) & 0x80:
                cell[j] = e[p]; p += 1
            else:
                cell[j] = t[j]
        out[i * 144:(i + 1) * 144] = cell
        ends.append(p)
    # 第 i 格的資料結尾 = 第 i+1 格的開頭 (依序相連), 最後一格的結尾 = 項目長度
    for i in range(1349):
        assert ends[i] == 0xa8c + offs[i + 1], f"格 {i} 結尾 {ends[i]:#x} != 下一格 {0xa8c + offs[i + 1]:#x}"
    assert ends[-1] == len(e), (ends[-1], len(e))
    return bytes(out)


def main(sea2, assets):
    ex = open(os.path.join(sea2, "MAIN.EXE"), "rb").read(); img = ex[struct.unpack("<H", ex[8:10])[0] * 16:]
    b = lambda o, n: img[DS + o:DS + o + n]
    wm = ls_unpack(open(os.path.join(sea2, "WORLDMAP.LZW"), "rb").read())
    d1 = ls_unpack(open(os.path.join(sea2, "DATA1.LZW"), "rb").read())
    tpl = b(*TABLES["templates"][:2])
    codes = b"".join(decode_item(e, tpl) for e in wm)
    open(os.path.join(assets, "gfx", "worldmap.bin"), "wb").write(codes)
    open(os.path.join(assets, "gfx", "seachip.bin"), "wb").write(d1[11])
    open(os.path.join(assets, "gfx", "seacompass.bin"), "wb").write(d1[7])
    tab = {}
    for k, (o, n, t) in TABLES.items():
        raw = b(o, n)
        tab[k] = list(raw) if t == "b" else [x - 256 if x > 127 else x for x in raw] if t == "sb" else raw.hex()
    def cs(o):
        t = b(o, 256); return t[:t.index(0)].hex()
    u16 = lambda o: struct.unpack("<H", b(o, 2))[0]
    out = {"autotile": list(d1[10]), "hash": list(d1[12]), "codeTiles": list(d1[18]), "tab": tab,
           "nodeCount": struct.unpack("<H", d1[5][:2])[0],           # DATA1 #5 = [bd7e] 地點數 (#4 = 地點表 [0c96])
           "str": {k: cs(v) for k, v in STR.items()}}
    for k, (o, n) in PTRS.items():
        out[k] = [cs(u16(o + 2 * i)) for i in range(n)]
    p = os.path.join(assets, "data", "sea.json")
    json.dump(out, open(p, "w", encoding="utf-8"), ensure_ascii=False)
    print("->", p, "worldmap", len(codes), "bytes; seachip", len(d1[11]), "seacompass", len(d1[7]))
    return out


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
