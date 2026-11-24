"""scenario_dump.py — 把 web/assets/scenario/snrN.json 印成可讀的清單 (含訊息開頭), 給驗證開場劇情用
用法: python tools/re/scenario_dump.py N 章 [節]  → 印到 stdout"""
import json, os, sys
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
A = os.path.join(ROOT, "web", "assets")
def operand(o):
    if not isinstance(o, dict): return str(o)
    (k, v), = o.items()
    return {"var": "v%d" % v if isinstance(v, int) else str(v), "flag": "F%d" % v if isinstance(v, int) else str(v), "imm": str(v), "ptr": "*v%s" % v, "sys": "sys%s" % v}.get(k, "%s:%s" % (k, v))
def dump(n, ch, sec=None, out=sys.stdout, mlen=40):
    d = json.load(open(os.path.join(A, "scenario", "snr%d.json" % n), encoding="utf-8"))
    M = json.load(open(os.path.join(A, "text", "snr%d.json" % n), encoding="utf-8"))
    c = d["chapters"][ch]
    if not c: print("no chapter", file=out); return
    for si, s in enumerate(c["sections"]):
        if sec is not None and si != sec: continue
        if not s: print("=== SNR%d ch%d sec%d (none)" % (n, ch, si), file=out); continue
        print("=== SNR%d ch%d sec%d index=%s" % (n, ch, si, s.get("index")), file=out)
        for i in s["code"]:
            k = i["k"]; extra = {a: b for a, b in i.items() if a not in ("at", "op", "n", "k")}
            if k == "msg" or "msg" in extra:
                mi = extra.get("msg"); t = M[mi].replace("\n", "/")[:mlen] if isinstance(mi, int) and mi < len(M) else ""
                print("%5d %s %s  「%s」" % (i["at"], k, extra, t), file=out)
            else:
                ex = " ".join("%s=%s" % (a, operand(b)) for a, b in extra.items())
                print("%5d %s %s" % (i["at"], k, ex), file=out)
if __name__ == "__main__":
    a = [int(x) for x in sys.argv[1:]]
    dump(a[0], a[1], a[2] if len(a) > 2 else None)
