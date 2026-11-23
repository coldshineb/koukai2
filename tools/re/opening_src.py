"""片頭 OPEN.EXE: 以精簡格式列出指定函式的完整反組譯 (略去 nop / push cs, call 目標附上名稱), 供逐句翻譯。
輸出 tools/work/re_open_src.txt。用法: python tools/re/opening_src.py"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env_open.py"), encoding="utf-8").read())
NAMES = {0x9072: "seg", 0x8be3: "loadEntry", 0x504e: "graphOfs", 0x4905: "dec4", 0x492d: "dec3", 0x03ce: "put4", 0x055e: "put3",
         0x4980: "playSong", 0x50a2: "fadeIn2a6_2d6", 0x4fd5: "waitEsc", 0x50cd: "fadeOutSlow", 0x50e4: "fadeOut", 0x0810: "cls",
         0x4836: "timerZero", 0x4846: "timerAdd", 0x485d: "wait", 0x4f0d: "waitSkip", 0x4d0d: "palStep", 0x4bc8: "palCycleStep",
         0x2aec: "put3stride", 0x2b5e: "scrollCopy", 0x2c15: "planeFill", 0x2d0e: "border", 0x00aa: "lseek", 0x005b: "read",
         0x4f6d: "fadeSkip", 0x4de2: "palSet306", 0x4dd9: "palSetF6", 0x4dbc: "palFade1", 0x0837: "planeSel", 0x091f: "fillRect",
         0x29fe: "getImage", 0x2775: "ditherPut", 0x5d49: "textToBuf", 0x4f31: "waitAddSkip", 0x28f3: "planeCopy", 0x2a5e: "clear3",
         0x51a9: "dissolve", 0x2843: "ditherPlane", 0x4506: "abs", 0x532c: "fadeOutSkipCls", 0x2aaf: "clearPlane3", 0x4a0b: "musicFade",
         0x49e4: "musicFlag"}
try:
    FUNCS
except NameError:
    FUNCS = None
if FUNCS is None:
    FUNCS = [struct.unpack("<HH", code[DS + 0xb9a + 4 * k:DS + 0xb9e + 4 * k]) for k in range(12)]
    FUNCS = [sg * 16 + o for o, sg in FUNCS]
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    for a in FUNCS:
        print(f"\n########## {a:05x} {NAMES.get(a, '')}")
        for i in body(a):
            if i.mn == "nop" or (i.mn == "push" and i.ops == ["cs"]): continue
            s = fmt(i)[0:]
            if i.mn == "call" and i.target is not None:
                s += "    ; " + NAMES.get(i.target & 0xffff, "")
            print(s)
open(os.path.join(HERE, "..", "work", "re_open_src.txt"), "w", encoding="utf-8").write(buf.getvalue())
print(len(buf.getvalue()))
