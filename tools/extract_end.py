"""extract_end.py — 結局 (END.EXE) 用資源: 可重複產生
  web/assets/data/ending.json : END.EXE DGROUP (段 08dd) 的初值區 DS:0000..1ec9 原樣位元組 (結局文字、調色盤、座標表、
                                各結局的序幕/名單文字指標表等), 結局程式以原版 DS 偏移存取; 另附可讀文字 (只供人閱讀, 程式不使用)
  web/assets/gfx/END_PUT.DAT  : 原樣複製 (視窗框、頭像、▽ 等點陣, 0x9fa0 bytes, 00dbb 一次讀入)
  ENDGRP.DAT 與 EVENT0..6.DAT 已在 web/assets/gfx (tools/extract.py / extract_event.py)
用法: python tools/extract_end.py [sea2目錄] [assets目錄]   (預設 tools/work/sea2 與 web/assets)"""
import os, sys, json, struct
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

DS = 0x8dd0                    # DGROUP 08dd (入口 6741: mov di, 8ddh → ss = ds)


def main(sea2=None, assets=None):
    sea2 = sea2 or os.path.join(ROOT, "tools", "work", "sea2")
    assets = assets or os.path.join(ROOT, "web", "assets")
    ex = open(os.path.join(sea2, "END.EXE"), "rb").read()
    code = ex[struct.unpack("<H", ex[8:10])[0] * 16:]
    ds = code[DS:]                                     # 初值区到映像结尾 (之后是未初始化区, 程序启动时为 0)
    cm = json.load(open(os.path.join(assets, "font", "charmap.json"), encoding="utf-8"))
    c2u = {r[0]: r[3] for r in cm["table"]}

    def dec(o):
        e = ds.index(b"\0", o); bs = ds[o:e]; out = []; i = 0
        while i < len(bs):
            c = bs[i]
            if (0x81 <= c <= 0xaf or 0xb0 <= c <= 0xd8) and i + 1 < len(bs):
                cd = c << 8 | bs[i + 1]; out.append(c2u.get(cd, "{#%04X}" % cd)); i += 2
            elif c == 0x0a: out.append("\n"); i += 1
            elif 0x20 <= c < 0x7f: out.append(chr(c)); i += 1
            else: out.append("{%02X}" % c); i += 1
        return "".join(out)
    # 可读文字: 1a9e 起的序幕文字指针表 (6 主角 × 5 段 × 9 行)
    w16 = lambda o: struct.unpack("<H", ds[o:o + 2])[0]
    readable = {"prologue (DS:1a9e)": [[[dec(w16(0x1a9e + 2 * ((h * 5 + k) * 9 + i))) for i in range(9)] for k in range(5)] for h in range(6)]}
    out = {"note": "END.EXE DGROUP 初值區原樣位元組 (ds = DS:0000..%04x, hex); readable 只供閱讀" % len(ds),
           "dsBase": 0, "ds": ds.hex(), "readable": readable}
    D = os.path.join(assets, "data"); os.makedirs(D, exist_ok=True)
    json.dump(out, open(os.path.join(D, "ending.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    G = os.path.join(assets, "gfx"); os.makedirs(G, exist_ok=True)
    open(os.path.join(G, "END_PUT.DAT"), "wb").write(open(os.path.join(sea2, "END_PUT.DAT"), "rb").read())
    print("ending.json ds", hex(len(ds)), "END_PUT.DAT", os.path.getsize(os.path.join(G, "END_PUT.DAT")))


if __name__ == "__main__":
    main(*(sys.argv[1:3]))
