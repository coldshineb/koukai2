"""一騎打分析 (續): duel.py 沒有展開到的畫面函式與 2e09 段的檔案 / 緩衝函式 → tools/work/re_duel2.txt
  237c (畫布 → 交錯緩衝)、03d2、1195f / 11847 / 11713 / 11522 / 11675 (格與船舷)、2e09:71c5 / 71f4 / 750e / 752b (LS 檔讀取與逐項解碼)、2e09:7cb4、
  4dc4 (random)、2e09:7030 / 7c37 (釋放)
用法: python tools/re/duel2.py"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
g = {"__file__": os.path.join(HERE, "dis_at.py"), "ADDRS": [], "DEPTH": 0, "__name__": "duel2"}
with contextlib.redirect_stdout(io.StringIO()):
    exec(open(os.path.join(HERE, "dis_at.py"), encoding="utf-8").read(), g)
S2E09 = 0x2e090
ADDRS = [0x237c, 0x03d2, 0x1195f, 0x11847, 0x11713, 0x11522, 0x11675, S2E09 + 0x71c5, S2E09 + 0x71f4, S2E09 + 0x750e, S2E09 + 0x752b,
         S2E09 + 0x7cb4, 0x4dc4, S2E09 + 0x7030, S2E09 + 0x7c37]
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    for a in ADDRS:
        g["walk"](a, 0, "duel2")
open(os.path.join(HERE, "..", "work", "re_duel2.txt"), "w", encoding="utf-8").write(buf.getvalue())
print(len(buf.getvalue()), "chars -> tools/work/re_duel2.txt")
