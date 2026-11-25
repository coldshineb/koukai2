"""extract_open.py — 片頭 (OPEN.EXE) 用資源: 可重複產生
  web/assets/gfx/opgraph/00..13.dat : OPGRAPH.LZW 的 14 項 (LS10 解壓, 原樣; 與 tools/extract.py 相同, 這裡一併核對/重寫)
  web/assets/gfx/opgraph/tail.dat   : OPGRAPH.LZW 檔尾未壓縮部分 (最後一項之後, 原版以 lseek+read 直接按檔案偏移讀取)
  web/assets/data/opening.json      : OPEN.EXE DGROUP 的常數區 (DS:00f6..0b9a: 調色盤表、片頭文字、各場景座標表) 原樣位元組,
                                      片頭程式以原版 DS 偏移存取; 另附文字的可讀版本 (只供人閱讀, 程式不使用)
用法: python tools/extract_open.py [sea2目錄] [assets目錄]   (預設 tools/work/sea2 與 web/assets)"""
import os, sys, json, struct
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
exec(open(os.path.join(HERE, "uw2lib.py"), encoding="utf-8").read())

DS = 0xa0b0                    # DGROUP 0a0b
DS_LO, DS_HI = 0x00f6, 0x0b9a  # 常数区: 0f6 起为 13 组调色盘 (每组 48 bytes), 0366/0468 等是变量 (程序不读这里的值), 0469..0898 文字, 0898.. 表格; 0b9a 起是场景函数表


def main(sea2=None, assets=None):
    sea2 = sea2 or os.path.join(ROOT, "tools", "work", "sea2")
    assets = assets or os.path.join(ROOT, "web", "assets")
    lz = open(os.path.join(sea2, "OPGRAPH.LZW"), "rb").read()
    ex = open(os.path.join(sea2, "OPEN.EXE"), "rb").read()
    code = ex[struct.unpack("<H", ex[8:10])[0] * 16:]
    parts = ls_unpack(lz)
    G = os.path.join(assets, "gfx", "opgraph"); os.makedirs(G, exist_ok=True)
    same = 0
    for i, pt in enumerate(parts):
        p = os.path.join(G, f"{i:02d}.dat")
        if os.path.exists(p) and open(p, "rb").read() == bytes(pt): same += 1
        open(p, "wb").write(bytes(pt))
    # 最后一项的结尾 = 未压缩档尾的起点
    end, p = 0, 0x110
    while True:
        cl, ul, of = struct.unpack(">III", lz[p:p + 12])
        if cl == 0: break
        end = max(end, of + cl); p += 12
    open(os.path.join(G, "tail.dat"), "wb").write(lz[end:])
    ds = code[DS + DS_LO:DS + DS_HI]
    # 可读文字 (DS:0898 / DS:08ae 两个 11 项指针表)
    cm = json.load(open(os.path.join(assets, "font", "charmap.json"), encoding="utf-8"))
    c2u = {r[0]: r[3] for r in cm["table"]}
    def dec(o):
        e = code.index(b"\0", DS + o); bs = code[DS + o:e]; out = []; i = 0
        while i < len(bs):
            c = bs[i]
            if 0x81 <= c <= 0xd8 and i + 1 < len(bs):
                cd = c << 8 | bs[i + 1]; out.append(c2u.get(cd, "{#%04X}" % cd)); i += 2
            elif c == 0x0a: out.append("\n"); i += 1
            else: out.append("{%02X}" % c); i += 1
        return "".join(out)
    w16 = lambda o: struct.unpack("<H", code[DS + o:DS + o + 2])[0]
    text = {"text1 (DS:0898)": [dec(w16(0x898 + 2 * i)) for i in range(11)], "text2 (DS:08ae)": [dec(w16(0x8ae + 2 * i)) for i in range(11)]}
    out = {"note": "OPEN.EXE DGROUP 常數區原樣位元組 (ds = DS:%04x..%04x, hex); tailStart = OPGRAPH.LZW 未壓縮檔尾起點; readable 只供閱讀" % (DS_LO, DS_HI),
           "dsBase": DS_LO, "ds": ds.hex(), "tailStart": end, "readable": text}
    D = os.path.join(assets, "data"); os.makedirs(D, exist_ok=True)
    json.dump(out, open(os.path.join(D, "opening.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"opgraph {len(parts)} 項 (與既有檔相同 {same}), tail {len(lz) - end} bytes @0x{end:x}, ds {len(ds)} bytes")
    return out


if __name__ == "__main__":
    main(*sys.argv[1:3])
