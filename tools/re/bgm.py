"""BGM 播放呼叫的反組譯: 0:9670(曲目) / 0:96eb(重播旗標) / 0:9712(淡出) / 0:9739(是否播放中) 與所有呼叫者所在函式。
輸出 tools/work/re_bgm.txt。用法: python tools/re/bgm.py   (RE_DEPTH 預設 0)"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_walk.py"), encoding="utf-8").read())
try:
    DEPTH
except NameError:
    DEPTH = int(os.environ.get("RE_DEPTH", "0"))
try:
    EXTRA
except NameError:
    EXTRA = []
API = {0x9670: "playSong(AL=曲目)", 0x96eb: "setRepeat(AL)", 0x9712: "fade(AL)", 0x9739: "isPlaying()"}
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    print("DS:8c20 曲目→FMDRV 樂曲:", list(dsbytes(0x8c20, 24)))
    for a in API:
        walk(a, 0, API[a])
    for tgt, nm in API.items():
        print(f"\n##### 呼叫 {tgt:05x} {nm}")
        for p in callers(tgt):
            print(f"  {p:05x} (函式 {func_start(p) or 0:05x}): " + " | ".join(f"{i.mn} {','.join(i.ops)}" for i in prev_ins(p, 5)))
    fs = sorted({func_start(p) for t in (0x9670, 0x9712) for p in callers(t)} - {None, 0x9670}) + EXTRA
    for f in fs:
        walk(f, DEPTH, "BGM 呼叫者")
open(os.path.join(HERE, "..", "work", "re_bgm.txt"), "w", encoding="utf-8").write(buf.getvalue())
print(buf.getvalue()[:3000])
