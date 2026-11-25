"""make_runf.py — 把 tools/emu/*.js (每個檔是一個立即執行函式) 登記成 session.RUNF[檔名]() 的單一腳本, 給不能 eval / vm 載入多檔的沙盒用
(沙盒每次只能執行一個檔: 先執行本腳本產生的 runf.js, 之後在同一個 session 裡 await session.RUNF["sea_depart_route.js"]() 等依序呼叫)。
每個檔: 在第一個以 "(" 開頭的行前加上 return, 包成 async 函式 → 呼叫時回傳該檔的結果 (async 的檔回傳 Promise, 可 await)。
用法: python tools/emu/make_runf.py [輸出檔]   (預設 tools/work/runf.js)"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SKIP = {"x86emu.js", "dosenv.js", "harness.js", "harness_menu.js", "boot_title.js", "boot_port.js", "run_local.js", "t.js"}   # 开机脚本 emu_boot.js 已含前 6 个


def build(out):
    parts = ["// runf.js — 由 tools/emu/make_runf.py 產生, 請勿手改", "(function () {", "const R = session.RUNF = session.RUNF || {};"]
    n = 0
    for f in sorted(os.listdir(HERE)):
        if not f.endswith(".js") or f in SKIP:
            continue
        lines = open(os.path.join(HERE, f), encoding="utf-8").read().replace("\r\n", "\n").split("\n")
        k = next((i for i, l in enumerate(lines) if l.startswith("(")), None)
        if k is None:
            continue
        lines[k] = "return " + lines[k]
        parts.append(f"R[{f!r}] = async function () {{\n" + "\n".join(lines) + "\n};")
        n += 1
    parts.append(f"console.log('[runf] {n} files');")
    parts.append("})();")
    open(out, "w", encoding="utf-8", newline="\n").write("\n".join(parts) + "\n")
    return n


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "work", "runf.js")
    print(build(out), "files ->", out)
