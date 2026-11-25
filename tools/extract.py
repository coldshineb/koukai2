"""
extract.py — 從原版資料檔提取全部資源到 web/assets
用法 (在 tools 目錄的上層):  python tools/extract.py <sea2目錄> <輸出assets目錄>
"""
import json, struct, base64, os
import numpy as np
from PIL import Image

class TextCodec:
    """原版位元組 <-> JSON 字串 (可逆)
       0x0A -> "\\n"; 可列印 ASCII 原樣; 雙位元組字 -> Unicode;
       其他控制碼 -> {XX}; 非標準字碼(別名) -> {#XXXX}"""
    def __init__(self, charmap_path):
        cm = json.load(open(charmap_path, encoding="utf-8"))
        self.c2u = {r[0]: r[3] for r in cm["table"]}
        self.u2c = {r[3]: r[0] for r in cm["table"]}
    def decode(self, bs):
        out = []; i = 0; n = len(bs)
        while i < n:
            c = bs[i]
            if c >= 0x81 and i + 1 < n:
                cd = (c << 8) | bs[i + 1]
                out.append(self.c2u[cd] if cd in self.c2u else "{#%04X}" % cd); i += 2
            elif c == 0x0a: out.append("\n"); i += 1
            elif 0x20 <= c < 0x7f and c not in (0x7b, 0x7d): out.append(chr(c)); i += 1
            else: out.append("{%02X}" % c); i += 1
        return "".join(out)
    def encode(self, s):
        out = bytearray(); i = 0
        while i < len(s):
            ch = s[i]
            if ch == "{":
                j = s.index("}", i); tok = s[i + 1:j]
                if tok[0] == "#": v = int(tok[1:], 16); out += bytes([v >> 8, v & 0xff])
                else: out.append(int(tok, 16))
                i = j + 1; continue
            if ch == "\n": out.append(0x0a)
            elif ord(ch) < 0x80: out.append(ord(ch))
            else: cd = self.u2c[ch]; out += bytes([cd >> 8, cd & 0xff])
            i += 1
        return bytes(out)

def be16_table(b, end):
    return [struct.unpack(">H", b[i:i + 2])[0] for i in range(0, end, 2)]

def split_strings(blob):
    """以 0x00 結尾切分 (保留結尾以便可逆)"""
    parts = []; cur = bytearray()
    for x in blob:
        cur.append(x)
        if x == 0: parts.append(bytes(cur)); cur = bytearray()
    if cur: parts.append(bytes(cur))
    return parts

def save_indexed(idx, path):
    """索引色存成灰階 PNG: 像素值 = 索引*17 (0..15 -> 0..255), 執行時再套調色盤"""
    Image.fromarray((idx.astype(np.uint8) * 17)).save(path, optimize=True)

def run(SEA2, A, uw2, codec):
    rd = lambda f: open(f"{SEA2}/{f}", "rb").read()
    report = {}
    main = rd("MAIN.EXE"); hdr = struct.unpack("<H", main[8:10])[0] * 16; img = main[hdr:]
    # ---------------- 游戏数据 (结构化 JSON) -----------------
    # 新游戏初值 = DATA1.LZW #15 (0FEA:171c4 加载 DS:0CA4) + DGROUP 尾段; 结构见 tools/gamedata.py
    import gamedata
    d1 = uw2.ls_unpack(rd("DATA1.LZW"))
    newgame = bytes(d1[15]) + img[0x38150 + 0x0ca4 + len(d1[15]):0x38150 + 0x8d18]
    json.dump(gamedata.schema(), open(f"{A}/data/schema.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    world = gamedata.export_state(newgame, codec)
    world["source"] = "DATA1.LZW #15 (0FEA:171c4 載入 DS:0CA4) + MAIN.EXE DGROUP 0x8A19..0x8D18"
    json.dump(world, open(f"{A}/data/world.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(gamedata.export_names(img, codec), open(f"{A}/data/names.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    assert gamedata.import_state(world, codec) == newgame
    # ---------------- 调色盘 -----------------
    pref = [bytes.fromhex("0000000d0004000d040a0d0606000a0f000a060f0a0d0f0e"),
            bytes.fromhex("0000000d0004000d040c0f0406000a0f000a000f0a0d0f0e")]
    occ = sorted({k for p in pref for k in _findall(img, p)})
    PAL_NAMES = {0x8c36: "default", 0x8c66: "unused8c66", 0x9c76: "battle", 0xa2ac: "heroSelect", 0xa4ac: "night", 0xa4dc: "dawn",
                 0xa50c: "day", 0xa53c: "dusk", 0xa56c: "overcast", 0xa700: "chart", 0xa730: "ships"}
    pals = [{"imageOffset": k, "ds": k - 0x38150, "name": PAL_NAMES.get(k - 0x38150, ""), "raw": list(img[k:k + 48]),
             "rgb": uw2.palette_rgb(img[k:k + 48])} for k in occ]
    json.dump({"note": "raw=原版4bit值(B,R,G順序); rgb=VGA DAC換算", "palettes": pals},
              open(f"{A}/data/palettes.json", "w"), separators=(",", ":"))
    report["palettes"] = len(pals)
    # ---------------- 字体图集 -----------------
    for fno in (1, 2):
        fd = rd(f"{fno}.PAT"); n = uw2.glyph_count(fd); cols = 64; rows = (n + cols - 1) // cols
        atlas = np.zeros((rows * 14, cols * 16), np.uint8)
        for g in range(1, n + 1):
            r, c = divmod(g - 1, cols); atlas[r * 14:(r + 1) * 14, c * 16:(c + 1) * 16] = uw2.glyph_bits(fd, g)
        Image.fromarray(atlas * 255).convert("1").save(f"{A}/font/font{fno}.png", optimize=True)
        report[f"font{fno}"] = n
    # ---------------- LZW 包 -----------------
    arch = {f[:-4]: uw2.ls_unpack(rd(f)) for f in sorted(os.listdir(SEA2)) if f.upper().endswith(".LZW")}
    # 头像 KAO.LZW: 原样保留 (LS11 压缩包 256 项 + 档尾 7 组拼合部件), 由 web/src/gfx/kao.js 在运行时解码与拼合
    open(f"{A}/gfx/KAO.LZW", "wb").write(rd("KAO.LZW"))
    report["kao"] = len(arch["KAO"])
    # 港口图块 PORTCHIP: 7 组 x 240 块 16x16, 4 planes 依序; 每组附 4 bytes 参数
    meta = []
    for s in range(len(arch["PORTCHIP"]) // 2):
        d = arch["PORTCHIP"][2 * s]; n = len(d) // 128
        atlas = np.zeros((((n + 15) // 16) * 16, 256), np.uint8)
        for t in range(n):
            r, c = divmod(t, 16); atlas[r * 16:(r + 1) * 16, c * 16:(c + 1) * 16] = uw2.planar(d[t * 128:(t + 1) * 128], 16, 16, 4, "seq")
        save_indexed(atlas, f"{A}/gfx/portchip{s}.png"); meta.append(list(arch["PORTCHIP"][2 * s + 1]))
    json.dump({"tilesets": meta, "chipNo": list(rd("CHIP_NO.DAT"))}, open(f"{A}/data/portchip.json", "w"))
    # 港口地图 PORTMAP: 96x96 图块索引
    json.dump({"w": 96, "h": 96, "maps": [base64.b64encode(m).decode() for m in arch["PORTMAP"]]},
              open(f"{A}/data/portmaps.json", "w"))
    report["portmaps"] = len(arch["PORTMAP"])
    # 窗口外框图形 (DATA1 第 14 项, MAIN.EXE 加载到 [0c86]); 平面交错原始格式, 由 web/src/ui/window.js 直接使用
    open(f"{A}/gfx/ui_frame.bin", "wb").write(arch["DATA1"][14])
    # GRAPH.DAT 系列图像: 保留原始数据, 由 web/src/gfx/graphdec.js 在运行时解码 (与原版一样直接画到画面上)
    for fn in ("GRAPH.DAT", "GRAPH2.DAT", "ENDGRP.DAT"):
        open(f"{A}/gfx/{fn}", "wb").write(rd(fn))
    os.makedirs(f"{A}/gfx/opgraph", exist_ok=True)
    for i, pt in enumerate(arch["OPGRAPH"]):
        open(f"{A}/gfx/opgraph/{i:02d}.dat", "wb").write(pt)
    # 其余 LZW 包原样保存 (格式待逆向), 供后续转换
    os.makedirs(f"{A}/raw", exist_ok=True)
    for name, parts in arch.items():
        if name in ("KAO", "PORTCHIP", "PORTMAP", "OPGRAPH"): continue
        json.dump({"parts": [base64.b64encode(p).decode() for p in parts]}, open(f"{A}/raw/{name}.json", "w"))
    # ---------------- 文本 -----------------
    T = f"{A}/text"; os.makedirs(T, exist_ok=True); ok = {}
    def chk(name, orig, rebuilt): ok[name] = (orig == rebuilt)
    # MESSAGE.DAT / MENU.DAT : u16be 偏移表 + 字符串
    for fn, key in (("MESSAGE.DAT", "message"), ("MENU.DAT", "menu")):
        b = rd(fn); first = struct.unpack(">H", b[:2])[0]; offs = be16_table(b, first) + [len(b)]
        items = [codec.decode(b[offs[i]:offs[i + 1]]) for i in range(len(offs) - 1)]
        json.dump(items, open(f"{T}/{key}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        chk(fn, b[first:], b"".join(codec.encode(s) for s in items))
    # NAME.TBL: 13 bytes x 192
    b = rd("NAME.TBL"); names = [codec.decode(b[i:i + 13]) for i in range(0, len(b), 13)]
    json.dump(names, open(f"{T}/names.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    chk("NAME.TBL", b, b"".join(codec.encode(s) for s in names))
    # ITEM.MES: 145 bytes x 100
    b = rd("ITEM.MES"); its = [codec.decode(b[i:i + 145]) for i in range(0, len(b), 145)]
    json.dump(its, open(f"{T}/item_mes.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    chk("ITEM.MES", b, b"".join(codec.encode(s) for s in its))
    # COLONY.DAT: 177 bytes x 100 发现物 (+00 名称, +0F 图号 (KAO 小图), +10 说明; 2e09:66f3 读第 n 笔)
    b = rd("COLONY.DAT"); cols = [codec.decode(b[i:i + 0xb1]) for i in range(0, len(b), 0xb1)]
    json.dump(cols, open(f"{T}/colony.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    chk("COLONY.DAT", b, b"".join(codec.encode(s) for s in cols))
    # SNRn.MES: u32be 偏移表 + 字符串
    for k in range(7):
        b = rd(f"SNR{k}.MES"); first = struct.unpack(">I", b[:4])[0]
        offs = [struct.unpack(">I", b[i:i + 4])[0] for i in range(0, first, 4)] + [len(b)]
        items = [codec.decode(b[offs[i]:offs[i + 1]]) for i in range(len(offs) - 1)]
        json.dump(items, open(f"{T}/snr{k}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        chk(f"SNR{k}.MES", b[first:], b"".join(codec.encode(s) for s in items))
    open(f"{T}/MESSAGE.DAT", "wb").write(rd("MESSAGE.DAT"))   # printf 直接使用原始格式字符串
    report["text_roundtrip"] = ok
    return report

def _findall(b, p):
    out = []; s = 0
    while True:
        k = b.find(p, s)
        if k < 0: return out
        out.append(k); s = k + 1


if __name__ == "__main__":
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import uw2lib
    sea2, out = sys.argv[1], sys.argv[2]
    for d in ("font", "gfx", "text", "data"):
        os.makedirs(f"{out}/{d}", exist_ok=True)
    cm = f"{out}/font/charmap.json"
    if not os.path.exists(cm):
        import build_charmap
        build_charmap.run(sea2, sys.argv[3] if len(sys.argv) > 3 else "unifont-15.1.05.hex.gz", cm, uw2lib)
    print(run(sea2, out, uw2lib, TextCodec(cm)))
    import extract_newgame                  # 开始新航海用常数表 + DATA1 地点表
    extract_newgame.main(sea2, out)
    import extract_port                     # 港口场景原始数据
    extract_port.main(sea2, out, uw2lib.ls_unpack)
    import extract_battle                   # 海战: HDAT.PUT、DS 常数 (scenes/battle.js)
    extract_battle.main(sea2, out)
    import extract_duel                     # 一骑打: DATA1 / IAP / IAE 动画档、DS 常数 (scenes/duel.js)
    extract_duel.main(sea2, out)
    import extract_event                    # 剧情插图: EVENT0..6.DAT 原样 (剧本命令 CB, game/scenario.js)
    extract_event.main(sea2, out)
