"""劇本 VM: 2e09 段 32700..33720 (讀取指令 327b8/327cc/327f9, 載入 32a90, 主迴圈 333db) 與指令分派表。
輸出 tools/work/re_scenario_vm.txt"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())


def jump_tables(a, b):
    """找 a..b 內 'cs: jmp word [bx+tab]' (2e ff a7) 形式的跳躍表"""
    out = []
    for i in disasm(code, a, b):
        t = _fmt(i)
        if i.mn == "jmp" and "[bx+" in t and ("cs:" in t or "cs" in " ".join(i.ops)):
            out.append(i.addr)
    return out


buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    print("== 32600..33480")
    cd(0x32600, 0x33480)
    print("\n== 跳躍表候選", [hex(x) for x in jump_tables(0x32600, 0x33480)])
open(os.path.join(HERE, "..", "work", "re_scenario_vm.txt"), "w", encoding="utf-8").write(buf.getvalue())
print("ok", len(buf.getvalue().splitlines()), "lines")
