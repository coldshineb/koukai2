"""旅館 與航海者閒聊 1fd9:8e73 (線性 28c03) 與 占卜師 朋友運 1fd9:d5d4 (線性 2d364)。輸出 tools/work/re_innfriend.txt。
用法: python tools/re/innfriend.py   (RE_DEPTH 預設 2)"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_walk.py"), encoding="utf-8").read())
try:
    DEPTH
except NameError:
    DEPTH = int(os.environ.get("RE_DEPTH", "2"))
KNOWN.update({0x28a16: "innChatList", 0x26000: "chatIntro", 0x2682c: "chatMenu"})
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    walk(0x28c03, DEPTH, "旅館 與航海者閒聊")
    walk(0x2d364, DEPTH, "占卜師 朋友運")
open(os.path.join(HERE, "..", "work", "re_innfriend.txt"), "w", encoding="utf-8").write(buf.getvalue())
t = buf.getvalue()
import re as R2
for m in R2.finditer(r"========== (\w+)\s+(.*?)\n", t):
    print(m.group(1), m.group(2)[:60])
