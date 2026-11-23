"""第二批港口建築 (王宮 / 事務所 / 住宅 / 銀行 / 道具店) 用的 MAIN.EXE 常數 → web/assets/data/buildings2.json
可重複執行: python tools/extract_buildings2.py   (需要 tools/work/sea2/MAIN.EXE)
字串以原版位元組的十六進位存放 (不含結尾 0), 由 web/src/scenes/*.js 以 hex 解回。"""
import os, json, struct
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ex = open(os.path.join(ROOT, "tools", "work", "sea2", "MAIN.EXE"), "rb").read()
code = ex[struct.unpack("<H", ex[8:10])[0] * 16:]
DS = 0x38150
def cb(o):
    b = bytearray()
    while code[DS + o + len(b)]: b.append(code[DS + o + len(b)])
    return bytes(b)
def h(o): return cb(o).hex()
def w16(o): return struct.unpack("<H", code[DS + o:DS + o + 2])[0]
def ptrs(o, n): return [h(w16(o + 2 * i)) for i in range(n)]
def raw(o, n): return list(code[DS + o:DS + o + n])
out = {
    "nations": ptrs(0x08de, 7),            # DS:08de 國名指標表
    "stats": ptrs(0x08f6, 8),              # DS:08f6 能力名指標表 (住宅 0x2f0 / 0x2e9)
    "jobs": [h(0xb40a), h(0xb413), h(0xb41c), h(0xb425), h(0xb42e)],   # 事務所 工作介紹 2ce01 的 5 種工作名
    "fmt": {
        "kingName": h(0x8b62),             # seg0:7e60 「〔%s〕\n」
        "kingTalk": h(0x8b80),             # seg0:7fa8 ESC C0 01 ESC B7
        "color": h(0x8b88),                # seg0:7ffc
        "nColor": h(0xb437),               # 2cf1e
        "income": h(0xb43e), "minus": h(0xb455), "num4": h(0xb459),
        "friendHdr": h(0xb460), "allyHdr": h(0xb469), "nation14": h(0xb473),
        "minus2": h(0xb479), "num4b": h(0xb47d), "ally": h(0xb484), "block": h(0xb487),
        "ld": h(0xb211), "ld2": h(0xb215), "ld3": h(0xb219),   # 道具店 %ld
        "portRow": h(0xb226),              # 王宮 勢力狀況 29eb1
    },
    "mapSkills": raw(0xb4c8, 3),           # 住宅 技能學習 2d93a 要檢查的能力 (主角 +1c + i)
    "measureSkills": raw(0xb4dc, 3),       # 住宅 種類 2 測量 2ddb6
    "gunSkills": raw(0xb4e0, 3),           # 住宅 種類 3 砲術 2def5
    "regionDiv": raw(0xb244, 8),           # 王宮 勢力狀況 29fe7 收益除數
}
dst = os.path.join(ROOT, "web", "assets", "data", "buildings2.json")
open(dst, "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False, indent=1))
print("wrote", dst)
