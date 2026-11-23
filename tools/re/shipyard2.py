"""造船廠 6 個子功能 (DS:b3e2) 與其呼叫的 1fd9 段本地函式、0fea:83f9、seg0:5cc4、DS 字串。輸出 tools/work/re_shipyard2.txt"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())
MT = json.load(open(os.path.join(TOOLS, "..", "web", "assets", "text", "menu.json"), encoding="utf-8"))
SEG = 0x1fd90


def body(a, n=0x900):
    end = code.find(b"\x55\x8b\xec", a + 3, a + n)
    end = end if end > 0 else a + n
    return end, disasm(code, a, end)


SUBS = [farptr(0xb3e2 + 4 * i) for i in range(6)]
NAMES = ["造新船", "買舊船", "修理", "賣船", "改造", "工業投資"]
seen, queue = set(), [(f"子功能 {i} {NAMES[i]}", a) for i, a in enumerate(SUBS)]
queue += [("0fea:83f9", 0xfea0 + 0x83f9), ("seg0:5cc4", 0x5cc4), ("seg0:0ac4 檔名", None)]
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    print("== MENU #22", MT[22])
    print("== DS:0ac4", cbytes(0x0ac4))
    while queue:
        name, a = queue.pop(0)
        if a is None or a in seen:
            continue
        seen.add(a)
        end, ins = body(a)
        print(f"\n========== {name} {a:05x}..{end:05x}")
        for i in ins:
            t = _fmt(i)
            print(t)
            # 追 1fd9 段內 (0x1fd90..0x2e090) 與 seg0 小函式中尚未看過的呼叫
            if i.mn == "call" and i.target is not None and 0x1fd90 <= i.target < 0x2e090 and i.target not in seen and i.target not in (0x2af30, 0x2b119, 0x203e9):
                queue.append((f"呼叫自 {a:05x}", i.target))
            m = re.search(r"mov ax, 0?([0-9a-f]{4})h", t)
            if m and 0xb2f0 <= int(m.group(1), 16) < 0xb3e2:
                o = int(m.group(1), 16)
                print(f"        ; DS:{o:04x} = {dstr(o, 80)!r}")
    print("\n== DS 字串 b2f0..b3e2")
    o = 0xb2fa
    while o < 0xb3e2:
        b = cbytes(o)
        if b:
            print(f"DS:{o:04x}", b.hex(), "|", dstr(o, 96))
        o += len(b) + 1
open(os.path.join(HERE, "..", "work", "re_shipyard2.txt"), "w", encoding="utf-8").write(buf.getvalue())
print("ok", len(buf.getvalue().splitlines()), "lines", len(seen), "functions")
