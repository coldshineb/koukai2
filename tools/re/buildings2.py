"""港口建築 第二批: 王宮 2aa6a / 事務所 2d19f / 住宅 2e034 / 8 號 292a1 / 道具店 29dfe, 入場被拒 1b5c1, 聲望警告 909b。
輸出 tools/work/re_bld2_<名稱>.txt。exec 時可設全域 ONLY = ["palace"] 只跑部分, RE_DEPTH (DEPTH) 預設 1, EXTRA = {名稱: [位址,...]} 追加。"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_walk.py"), encoding="utf-8").read())
def _lin(seg, off):          # 修正: 1fd9 段的远调用 = 0x1fd90 + off (re_walk.py 的版本用 0x20000)
    return seg * 16 + off
KNOWN.update({0x28d14: "inn", 0x2cc6e: "church", 0x2d3d7: "fortune"})
try: DEPTH
except NameError: DEPTH = int(os.environ.get("RE_DEPTH", "1"))
try: ONLY
except NameError: ONLY = None
try: EXTRA
except NameError: EXTRA = {}
JOBS = {"palace": [0x2aa6a], "office": [0x2d19f], "house": [0x2e034], "b8": [0x292a1], "itemshop": [0x29dfe],
        "enter": [0x1b5c1, 0x909b]}
for k, v in EXTRA.items(): JOBS[k] = v
for name, addrs in JOBS.items():
    if ONLY and name not in ONLY: continue
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        for a in addrs: walk(a, DEPTH, name)
    open(os.path.join(HERE, "..", "work", "re_bld2_" + name + ".txt"), "w", encoding="utf-8").write(buf.getvalue())
    print(name, len(buf.getvalue().splitlines()), "行")
