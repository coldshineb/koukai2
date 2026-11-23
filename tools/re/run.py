"""在本機執行 tools/re/ 下的分析腳本 (給不能使用 __file__ 的執行器用): python tools/re/run.py <名稱>
一般情況直接 python tools/re/<名稱>.py 即可。"""
import os, sys
HERE = os.path.dirname(os.path.abspath(sys.argv[0]))
for name in sys.argv[1:]:
    p = os.path.join(HERE, name if name.endswith(".py") else name + ".py")
    src = open(p, encoding="utf-8").read().replace("HERE = os.path.dirname(os.path.abspath(__file__))", "HERE = " + repr(HERE))
    exec(compile(src, p, "exec"), {"__name__": "__main__"})
