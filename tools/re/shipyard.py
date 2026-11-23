"""造船廠 (港口建築 2, 1fd9:cc01) 入口、子功能表, 與船塢共用的船隻資料顯示 2af30 / 2b119、換位 203e9。
輸出 tools/work/re_shipyard.txt
用法 (在 uw2_remake 上一層): python uw2_remake/tools/re/shipyard.py"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())
MT = json.load(open(os.path.join(TOOLS, "..", "web", "assets", "text", "menu.json"), encoding="utf-8"))
SEG = 0x1fd90


def func(a, n=0xc00):
    """反組譯到下一個 push bp / mov bp,sp 之前"""
    end = code.find(b"\x55\x8b\xec", a + 3, a + n)
    end = end if end > 0 else a + n
    cd(a, end)
    return end


def menu_loads(a, b):
    """a..b 內 loadMenu (2e09:57aa) 前的 mov ax, n"""
    out = []
    ins = disasm(code, a, b)
    for k, i in enumerate(ins):
        if i.mn == "call" and "2e09:57aa" in _fmt(i):
            for j in range(k - 1, max(0, k - 5), -1):
                t = _fmt(ins[j])
                m = re.match(r"\w+ mov ax, 0?([0-9a-f]+)h", t)
                if m:
                    out.append(int(m.group(1), 16)); break
    return out


def far_tables(a, b):
    """a..b 內 'mov ax, word [bx+XXXX]' 後緊接 'mov dx, word [bx+XXXX+2]' 的 far 指標表"""
    out = []
    ins = disasm(code, a, b)
    for k in range(len(ins) - 1):
        m1 = re.search(r"mov ax, word \[bx\+([0-9a-f]+)h\]", _fmt(ins[k]))
        m2 = re.search(r"mov dx, word \[bx\+([0-9a-f]+)h\]", _fmt(ins[k + 1]))
        if m1 and m2 and int(m2.group(1), 16) == int(m1.group(1), 16) + 2:
            out.append(int(m1.group(1), 16))
    return out


buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    entry = SEG + 0xcc01
    print("========== 造船廠入口", hex(entry))
    end = func(entry, 0x800)
    for n in menu_loads(entry, end):
        print("== MENU", n, MT[n])
    for t in far_tables(entry, end):
        print("== 子功能表 DS:%04x" % t, [hex(farptr(t + 4 * i)) for i in range(8)])
    for name, a in [("2af30 船隻資料 (上半)", 0x2af30), ("2b119 船隻資料 (下半)", 0x2b119), ("203e9 船位交換", 0x203e9)]:
        print(f"\n========== {name} {a:05x}")
        func(a, 0x600)
open(os.path.join(HERE, "..", "work", "re_shipyard.txt"), "w", encoding="utf-8").write(buf.getvalue())
print("ok", len(buf.getvalue().splitlines()), "lines")
