"""出海與航海移植用的測試副本: 同 pack_sandbox.py, 但輸出 tools/work/_sandbox_sea.zip (與其他工作的 _sandbox.zip 分開)。
不含 .git、web/bgm、tools/work 內除 sea2 / rom8x8.bin / newgame.bin / emu_boot.js / ui_bundle.js 以外的內容。
用法: python tools/emu/pack_sandbox_sea.py (或在 exec 時於 globals 放 __file__ 後呼叫 main())"""
import os, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "tools", "work", "_sandbox_sea.zip")
KEEP_WORK = ("sea2", "rom8x8.bin", "newgame.bin", "emu_boot.js", "ui_bundle.js")   # emu_boot.js 由 make_sandbox_boot.py 產生, ui_bundle.js 由 make_test_bundle.py 產生


def want(rel):
    parts = rel.replace("\\", "/").split("/")
    if parts[:2] == ["web", "bgm"] or "__pycache__" in parts or parts[0] == ".git":
        return False
    if parts[:2] == ["tools", "work"]:
        return len(parts) > 2 and parts[2] in KEEP_WORK
    return True


def main():
    n = 0
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for dp, dn, fn in os.walk(ROOT):
            if ".git" in dn:
                dn.remove(".git")
            for f in fn:
                p = os.path.join(dp, f)
                rel = os.path.relpath(p, ROOT)
                if p == OUT or not want(rel):
                    continue
                z.write(p, "uw2_remake/" + rel.replace("\\", "/"))
                n += 1
    print(n, "files ->", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
