"""海戰 第二批分析: 玩家指令 (DS:8df4 遠程函式表 8 項) 與 情報 子選單 (DS:8d36 7 項) — 這些是以函式表間接呼叫, battle.py 的展開看不到。
先略過 battle.py 已展開的函式 (tools/work/re_battle_size_10f7e.txt), 再各自展開 (深度 12)。
輸出 tools/work/re_battle_cmds.txt (8 個指令) 與 tools/work/re_battle_info.txt (情報 7 項), 並印出每項的條數。
用法: python tools/re/battle2.py   (先執行 battle.py 產生 re_battle_size_10f7e.txt: exec 時放 DEPTH = 12、OUT = "re_battle_size_10f7e.txt")"""
import os, io, re, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_walk.py"), encoding="utf-8").read())
WORK = os.path.join(HERE, "..", "work")
for m in re.finditer(r"========== (\w+)\s", open(os.path.join(WORK, "re_battle_size_10f7e.txt"), encoding="utf-8").read()):
    _done.add(int(m.group(1), 16))


def table(o, n):
    return [w16(o + 2 + 4 * i) * 16 + w16(o + 4 * i) for i in range(n)]


def run(roots, out):
    buf = io.StringIO()
    for a, name in roots:
        b = io.StringIO()
        with contextlib.redirect_stdout(b):
            walk(a, 12, name)
        t = b.getvalue(); buf.write(t)
        print(f"{name:10s} {a:05x}  {len([l for l in t.split(chr(10)) if re.match(r'^[0-9a-f]{5} ', l)])} 條")
    open(os.path.join(WORK, out), "w", encoding="utf-8").write(buf.getvalue())


CMDS = ["移動", "攻擊", "情報", "信號", "作戰", "停船", "隨身物", "撤離"]       # MENU #0x32
run(list(zip(table(0x8df4, 8), CMDS)), "re_battle_cmds.txt")
INFO = ["我艦隊", "我艦隊人物", "我艦隊艦船", "敵艦隊", "敵艦隊人物", "敵艦隊艦船", "作戰一覽"]   # MENU #0x33
run(list(zip(table(0x8d36, 7), INFO)), "re_battle_info.txt")
