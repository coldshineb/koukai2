"""劇本事件 (SNR0..6) 中的音樂命令 CA b (31e67: 9670(b), b=0x15 時再 96eb(0) 只播一次) 一覽, 附前後訊息。
輸出 tools/work/re_bgm_scenario.txt。用法: python tools/re/bgm_scenario.py"""
import os, json
from collections import defaultdict
HERE = os.path.dirname(os.path.abspath(__file__))
A = os.path.join(HERE, "..", "..", "web", "assets")
uses = defaultdict(list)
out = []
for n in range(7):
    doc = json.load(open(os.path.join(A, "scenario", f"snr{n}.json"), encoding="utf-8"))
    mes = json.load(open(os.path.join(A, "text", f"snr{n}.json"), encoding="utf-8"))
    for ci, ch in enumerate(doc["chapters"]):
        for si, sec in enumerate((ch or {}).get("sections", []) or []):
            code = (sec or {}).get("code", [])
            for k, op in enumerate(code):
                if op.get("k") != "music":
                    continue
                def txt(rng):
                    r = []
                    for o in rng:
                        if o.get("k") == "msg" and o.get("msg") is not None and o["msg"] < len(mes):
                            r.append(mes[o["msg"]].replace("{00}", "").replace("\n", " ")[:60])
                        elif o.get("k") in ("duel", "battle", "picture", "person_scene"):
                            r.append(f"<{o['k']}>")
                    return r
                before = txt(code[max(0, k - 6):k])[-2:]
                after = txt(code[k + 1:k + 12])[:2]
                uses[op["song"]].append((n, ci, si, op["at"]))
                out.append(f"曲目 {op['song']:2d} (0x{op['song']:02x})  SNR{n} 章{ci} 節{si} @{op['at']}\n    前: {before}\n    後: {after}")
summary = [f"曲目 {s:2d} (0x{s:02x}): {len(v)} 處  " + ", ".join(f"SNR{a}/{b}/{c}" for a, b, c, _ in v[:12]) for s, v in sorted(uses.items())]
open(os.path.join(HERE, "..", "work", "re_bgm_scenario.txt"), "w", encoding="utf-8").write("\n".join(summary) + "\n\n" + "\n".join(out) + "\n")
print("\n".join(summary))
