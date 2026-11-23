"""劇情插圖分析 (docs/RE_NOTES.md 第 31 節) → tools/work/re_event_pic.txt
  1. 劇本命令跳躍表 2e09:5055 的 CB 項 (331e4) 與 31e81 / 5b5d 展開; DS:0a82 / 0a90 檔名字串; 寫入檔名字元 [0a89] 的位置 (1681a 結尾) 與 1681a 的呼叫者
  2. EVENT0..6.DAT 偏移表: 張數、各張寬高與資料長度
  3. 七個劇本 (web/assets/scenario/snrN.json) 中所有 CB 的位置、參數、所在節的事件索引, 以及沒有被用到的插圖
用法: python tools/re/event_pic.py"""
import os, io, sys, json, struct, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
g = {"__file__": os.path.join(HERE, "dis_at.py"), "ADDRS": [], "DEPTH": 0, "__name__": "event_pic"}
with contextlib.redirect_stdout(io.StringIO()):
    exec(open(os.path.join(HERE, "dis_at.py"), encoding="utf-8").read(), g)
code, walk = g["code"], g["walk"]
SEA2 = os.path.join(os.path.dirname(ROOT), "Uncharted.Waters.2.CHS.Green", "sea2")

buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    jt = 0x2e090 + 0x5055
    ents = [struct.unpack("<H", code[jt + 2 * i:jt + 2 * i + 2])[0] for i in range(64)]
    cb = 0x2e090 + ents[0xcb - 0xc0]
    print("劇本命令跳躍表 2e09:5055: CB =", hex(cb))
    print("DS:0a82 =", repr(g["dstr"](0x0a82)), " DS:0a90 =", repr(g["dstr"](0x0a90)))
    print("寫入 [0a89]:", [hex(x) for x in g["find_imm"](0x0a89)], " 1681a 的呼叫者:", [hex(c) for c in g["callers"](0x1681a)])
    g["dump"](0x1684b, 0x16854)
    walk(cb, 2, "CB 事件插圖")
    print()
    print("========== EVENT*.DAT")
    for n in range(7):
        d = open(os.path.join(SEA2, f"EVENT{n}.DAT"), "rb").read()
        k = struct.unpack(">I", d[:4])[0] // 4
        offs = [struct.unpack(">I", d[4 * i:4 * i + 4])[0] for i in range(k)] + [len(d)]
        print(f"EVENT{n}.DAT {len(d)} bytes, {k} 張:", [(struct.unpack("<HH", d[offs[i]:offs[i] + 4]), offs[i + 1] - offs[i]) for i in range(k)])
    print()
    print("========== 劇本中的 CB")
    counts = {n: 0 for n in range(7)}
    for n in range(7):
        doc = json.load(open(os.path.join(ROOT, "web", "assets", "scenario", f"snr{n}.json"), encoding="utf-8"))
        used = set()
        for ci, ch in enumerate(doc["chapters"]):
            if not ch: continue
            for si, sec in enumerate(ch["sections"]):
                if not sec: continue
                for ins in sec["code"]:
                    if ins.get("k") != "picture": continue
                    counts[n] += 1; used.add(ins["pic"])
                    ent = max([e for e in sec["index"] if e[2] <= ins["at"]] or [[None, None, None]], key=lambda e: e[2] if e[2] is not None else -1)
                    print(f"SNR{n} 章 {ci} 節 {si} PC {ins['at']}: CB {ins['x']} {ins['y']} {ins['pic']}   前一個事件入口 {ent}")
        if n:
            d = open(os.path.join(SEA2, f"EVENT{n}.DAT"), "rb").read(); k = struct.unpack(">I", d[:4])[0] // 4
            print(f"  EVENT{n}.DAT 沒有被用到的張: {sorted(set(range(k)) - used)}; 超出範圍: {sorted(p for p in used if p >= k)}")
    print("各劇本 CB 數:", counts)
out = buf.getvalue()
os.makedirs(os.path.join(ROOT, "tools", "work"), exist_ok=True)
open(os.path.join(ROOT, "tools", "work", "re_event_pic.txt"), "w", encoding="utf-8").write(out)
print(out[-3000:])
