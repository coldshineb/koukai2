# extract_worldmap.py — WORLDMAP.LZW 解碼 (MAIN.EXE 1fd9:2d89 = 線性 22b19 的格解碼; 區域組合 / 海岸接邊在網頁端 web/src/gfx/worldmap.js)
# 檔案: LS11 壓縮包 3 項 (世界 2160 × 1080 地圖格, 每項 30 欄 × 45 列個 24×24 地圖格的「海域格」= 720 地圖格寬)
#   每項: 1350 個 u16le 偏移 (相對於 0xa8c = 表尾), 依 列×30+欄; 之後是各格的資料, 依序相連 (原版一次讀 3 格時從第 1 格的偏移直接往下讀)
#   每格 12 × 12 個碼 (1 碼 = 2×2 地圖格):
#     1 byte b: b&0x7f = 範本編號 (0x78..0x7d; 範本在 MAIN.EXE DS:6734 + 編號 × 0x90 = DS:aab4 起, 每個 144 碼; 0x7c = 全陸 (碼 15), 0x7d = 全海 (碼 0),
#               0x78..0x7b = 半陸半海); 編號 < 0x78 時原版整格不寫 (保留緩衝原內容) — 檔案中沒有這種格 (本工具檢查)
#     b&0x80 = 0: 接著 18 bytes 遮罩 (144 位元, 每 byte 高位元在前), 位元 1 的位置依序由資料流取 1 byte, 0 的位置用範本; b&0x80 = 1: 整格 = 範本
#   碼: < 0x10 = 陸/海 4 位元 (8 左上, 4 右上, 2 左下, 1 右下); 0x10/0x12 港口; 0x11 發現物; >= 0x13 由 DATA1 #18 取 2×2 圖塊
# 驗證: (1) 每格解碼後的結尾 = 下一格的偏移、最後一格的結尾 = 項目長度 (格式完全吻合, 沒有多餘或不足的位元組);
#       (2) tools/emu/worldmap_tests.js 以原版 22d62 (含海岸接邊、港口/發現物) 與網頁端解碼逐 byte 比對。
# 輸出: <assets>/gfx/worldmap.bin (3 × 1350 格 × 144 碼) 與 <work>/worldmap_overview.png (1080 × 540, 1 像素 = 1 碼: 黑 = 海, 灰 = 陸, 白 = 其他碼)
# 用法: python tools/extract_worldmap.py <sea2 目錄> <web/assets 目錄> [<輸出圖目錄>]   (或 exec 後呼叫 main(...); decode_all(...) 供 extract_sea.py 使用)
import os, struct, sys, zlib

DS = 0x38150
HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATES = (0xaab4, 6 * 0x90)


def ls_unpack(b):
    g = {}
    exec(open(os.path.join(HERE, "uw2lib.py"), encoding="utf-8").read(), g)
    return g["ls_unpack"](b)


def templates(sea2):
    ex = open(os.path.join(sea2, "MAIN.EXE"), "rb").read(); img = ex[struct.unpack("<H", ex[8:10])[0] * 16:]
    return img[DS + TEMPLATES[0]:DS + TEMPLATES[0] + TEMPLATES[1]]


def decode_item(e, tpl):
    """一項 → 1350 格 × 144 碼; 同時檢查各格資料首尾相連"""
    offs = struct.unpack("<1350H", e[:2700])
    out = bytearray(1350 * 144)
    ends = []
    for i, o in enumerate(offs):
        p = 0xa8c + o
        b = e[p]; p += 1
        k = b & 0x7f
        assert 0x78 <= k < 0x78 + 6, f"格 {i}: 範本 {k:#x}"
        t = tpl[(k - 0x78) * 0x90:(k - 0x77) * 0x90]
        if b & 0x80:
            mask = bytes(18)
        else:
            mask = e[p:p + 18]; p += 18
        for j in range(144):
            if (mask[j >> 3] << (j & 7)) & 0x80:
                out[i * 144 + j] = e[p]; p += 1
            else:
                out[i * 144 + j] = t[j]
        ends.append(p)
    for i in range(1349):
        assert ends[i] == 0xa8c + offs[i + 1], f"格 {i} 結尾 {ends[i]:#x} != 下一格 {0xa8c + offs[i + 1]:#x}"
    assert ends[-1] == len(e), (ends[-1], len(e))
    return bytes(out)


def decode_all(sea2):
    wm = ls_unpack(open(os.path.join(sea2, "WORLDMAP.LZW"), "rb").read())
    tpl = templates(sea2)
    return b"".join(decode_item(e, tpl) for e in wm)


def png_gray(path, w, h, pix):
    raw = b"".join(b"\x00" + bytes(pix[y * w:(y + 1) * w]) for y in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    open(path, "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def main(sea2, assets, work=None):
    codes = decode_all(sea2)
    open(os.path.join(assets, "gfx", "worldmap.bin"), "wb").write(codes)
    work = work or os.path.join(HERE, "work")
    W, H = 1080, 540
    pix = bytearray(W * H)
    for k in range(3):
        for i in range(1350):
            r, c = divmod(i, 30)
            for y in range(12):
                for x in range(12):
                    v = codes[(k * 1350 + i) * 144 + y * 12 + x]
                    pix[(r * 12 + y) * W + (k * 30 + c) * 12 + x] = 0 if v == 0 else 120 if v < 0x10 else 255
    png_gray(os.path.join(work, "worldmap_overview.png"), W, H, pix)
    print("worldmap", len(codes), "bytes, 4050 格首尾相連檢查通過")
    return codes


if __name__ == "__main__":
    main(*sys.argv[1:4])
