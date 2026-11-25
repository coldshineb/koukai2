# extract_newgame.py — 从 MAIN.EXE 取出「开始新航海」用到的常数表 → web/assets/data/newgame.json, mapnodes.bin
# 用法: python extract_newgame.py <sea2 目录> <web/assets 目录>
# 各表地址见 docs/RE_NOTES.md 第 14 节。
import json, os, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from uw2lib import ls_unpack
DS = 0x38150          # DGROUP 在加载映像中的线性地址 (与 re_env.py 相同)
IMG = b""
def dsbytes(o, n): return IMG[DS + o:DS + o + n]

def u16(o): return struct.unpack("<H", dsbytes(o, 2))[0]
def words(o, n): return [u16(o + 2 * i) for i in range(n)]
def cstr(o, maxlen=64):
    b = dsbytes(o, maxlen); return b[:b.index(0)] if 0 in b else b
def hexs(b): return b.hex()

def main(sea2, assets):
    global IMG
    ex = open(os.path.join(sea2, "MAIN.EXE"), "rb").read()
    IMG = ex[struct.unpack("<H", ex[8:10])[0] * 16:]
    out = {}
    # 16532: 6 位主角头像位置 DS:a33c (x 像素, y)
    out["portraits"] = [list(struct.unpack("<HH", dsbytes(0xa33c + i * 4, 4))) for i in range(6)]
    # 16ee 调色盘循环: 表 DS:a32c (8 个指针 → 各 8 个 word: 颜色 8..15, 格式 0x0GRB), 速度 8 (每 9 个 BIOS tick 换一格)
    ptrs = words(0xa32c, 8)
    out["cycle"] = {"speed": 8, "first": 8, "frames": [words(p, 8) for p in ptrs], "ptrs": ptrs}
    # 1637a: 主角介绍消息编号 DS:a36e, 技能 DS:a374 → 技能名表 DS:08ec
    out["heroMessage"] = list(dsbytes(0xa36e, 6))
    out["heroSkill"] = list(dsbytes(0xa374, 6))
    out["skillNames"] = [hexs(cstr(p)) for p in words(0x08ec, 8)]
    S = {"all": 0xa364, "d3": 0xa369,
         "kbColor2": 0xb652, "kbSpaces": 0xb656, "kbColor0": 0xb65b, "kbPrev": 0xb65f, "kbNext": 0xb668,
         "nameBg7": 0xb714, "markOld": 0xb718, "markNew": 0xb71e, "erase": 0xb727, "blank": 0xb72a, "slot": 0xb754}
    out["strings"] = {k: hexs(cstr(v)) for k, v in S.items()}
    out["strings"]["kbDot"] = hexs(dsbytes(0xb66c, 3))            # 3 行 1bpp 点阵
    out["labels"] = [hexs(cstr(o)) for o in (0xb738, 0xb73f, 0xb746, 0xb74d)]   # 名字？ 姓氏？ 船名？ 暱称？
    # 30735 键盘: 各「笔画」格 (光标 10..29) 的字码范围: start..gapFrom 之后跳到 gapTo..end (见 3027e)
    out["keyboard"] = {
        "start": words(0xb670, 20), "gapTo": words(0xb698, 20), "gapFrom": words(0xb6c0, 20), "end": words(0xb6e8, 20),
        "eisu": [u16(0xb710), u16(0xb712)],        # 光标 1「英数」: b70e+2 / b710+2
    }
    os.makedirs(os.path.join(assets, "data"), exist_ok=True)
    with open(os.path.join(assets, "data", "newgame.json"), "w", encoding="utf-8") as f: json.dump(out, f, ensure_ascii=False, indent=1)
    # 1667a: DATA1.LZW 第 5 项 = 地点数, 第 4 项 = 地点表 (每笔 16 bytes, +0 x&7fff, +2 y); 1fd9:333a 用来标记已探索地点
    parts = ls_unpack(open(os.path.join(sea2, "DATA1.LZW"), "rb").read())
    n = struct.unpack("<H", parts[5][:2])[0]
    with open(os.path.join(assets, "data", "mapnodes.bin"), "wb") as f: f.write(parts[4][:n * 16])
    print("newgame.json ok; mapnodes", n)

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
