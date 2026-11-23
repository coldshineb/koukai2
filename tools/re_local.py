"""本機逆向環境: python tools/re_local.py "dump(0x28723, 0x28800)"  (先執行 tools/emu/prep_local.py 準備 tools/work/sea2)"""
import os, sys
sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(HERE)).replace("\\", "/")
exec(open(os.path.join(HERE, "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "re_tools.py"), encoding="utf-8").read())

for _a in sys.argv[1:]:
    exec(_a)
