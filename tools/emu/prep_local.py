"""準備本機差分測試所需的檔案 (全部放在 uw2_remake/tools/work/):
  <work>/sea2/*        原版檔案副本
  <work>/rom8x8.bin    BIOS 8x8 字型 (由 web/assets/font/rom8x8.png 還原, 128 字 x 8 bytes)
  <work>/newgame.bin   新遊戲初值 = DATA1.LZW 第 15 項
  <work>/ui_bundle.js  web/src 合併腳本
用法: python prep_local.py [W]   (W 預設為 uw2_remake 的上一層)"""
import os, sys, shutil, struct
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
W = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.dirname(ROOT)
SRC = os.path.join(W, "Uncharted.Waters.2.CHS.Green", "sea2")
TMP = os.path.join(ROOT, "tools", "work")


def ls_unpack(b):
    dic = b[16:272]
    be32 = lambda o: int.from_bytes(b[o:o + 4], "big")
    out, p = [], 0x110
    while True:
        cl, ul, of = be32(p), be32(p + 4), be32(p + 8)
        if not cl:
            break
        p += 12
        if cl == ul:
            out.append(bytes(b[of:of + ul]))
            continue
        o, bp = bytearray(), of * 8

        def bit():
            nonlocal bp
            v = (b[bp >> 3] >> (7 - (bp & 7))) & 1
            bp += 1
            return v

        def code():
            k = 0
            while bit():
                k += 1
            v = 0
            for _ in range(k + 1):
                v = (v << 1) | bit()
            return v + (1 << (k + 1)) - 2

        while len(o) < ul:
            cd = code()
            if cd < 256:
                o.append(dic[cd])
            else:
                dist, length = cd - 256, code() + 3
                for _ in range(length):
                    if len(o) >= ul:
                        break
                    o.append(o[-dist])
        out.append(bytes(o))
    return out


def rom_from_png(path):
    img = Image.open(path).convert("L")
    w, _ = img.size
    px = img.load()
    rows = [[px[x, y] for x in range(w)] for y in range(8)]
    bg = rows[0][0x20 * 8]
    rom = bytearray(1024)
    for ch in range(128):
        for y in range(8):
            v = 0
            for x in range(8):
                v = (v << 1) | (1 if rows[y][ch * 8 + x] != bg else 0)
            rom[ch * 8 + y] = v
    return bytes(rom)


def main():
    os.makedirs(os.path.join(TMP, "sea2"), exist_ok=True)
    for f in os.listdir(SRC):
        s = os.path.join(SRC, f)
        d = os.path.join(TMP, "sea2", f)
        if os.path.isfile(s) and (not os.path.exists(d) or os.path.getsize(d) != os.path.getsize(s)):
            shutil.copyfile(s, d)
    rom = rom_from_png(os.path.join(ROOT, "web", "assets", "font", "rom8x8.png"))
    open(os.path.join(TMP, "rom8x8.bin"), "wb").write(rom)
    d1 = ls_unpack(open(os.path.join(SRC, "DATA1.LZW"), "rb").read())
    main_exe = open(os.path.join(SRC, "MAIN.EXE"), "rb").read()
    img = main_exe[struct.unpack("<H", main_exe[8:10])[0] * 16:]
    newgame = bytes(d1[15]) + img[0x38150 + 0x0ca4 + len(d1[15]):0x38150 + 0x8d18]
    assert len(newgame) == 0x8074, hex(len(newgame))
    open(os.path.join(TMP, "newgame.bin"), "wb").write(newgame)
    sys.path.insert(0, HERE)
    import make_test_bundle as mb
    mb.bundle(ROOT, mb.MODS, os.path.join(TMP, "ui_bundle.js"), mb.NAMES)
    print("W =", W)
    print("rom8x8.bin  A row0..7:", rom[0x41 * 8:0x42 * 8].hex())
    print("newgame.bin", len(newgame), "bytes; DATA1 entries:", len(d1))


if __name__ == "__main__":
    main()
