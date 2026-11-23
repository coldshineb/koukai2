"""海戰 / 一騎打 / 交涉移植用的測試副本: 輸出 tools/work/_sandbox_battle.zip (與其他工作的 zip 分開)。
合併腳本與開機腳本產生到 tools/work/ui_bundle_battle.js、emu_boot_battle.js (不覆寫其他工作正在用的 ui_bundle.js / emu_boot.js),
在 zip 內以 tools/work/ui_bundle.js、emu_boot.js 的名稱放入。開機腳本以 session.BOOT_W (預設 WORKSPACE_DIR) 為 uw2_remake 的上一層。
不含 .git、web/bgm、tools/work 內除 sea2 / rom8x8.bin / newgame.bin 以外的內容。
用法: python tools/emu/pack_sandbox_battle.py"""
import os, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
WORK = os.path.join(ROOT, "tools", "work")
OUT = os.path.join(WORK, "_sandbox_battle.zip")
KEEP_WORK = ("sea2", "rom8x8.bin", "newgame.bin")
BOOT = (";(function(){const t0=Date.now(); const W=session.BOOT_W||WORKSPACE_DIR; session.boot(W); session.bootTitle();"
        " console.log('[boot] '+((Date.now()-t0)/1000).toFixed(1)+'s');})();\n")


def want(rel):
    parts = rel.replace("\\", "/").split("/")
    if parts[:2] == ["web", "bgm"] or "__pycache__" in parts or parts[0] == ".git":
        return False
    if parts[:2] == ["tools", "work"]:
        return len(parts) > 2 and parts[2] in KEEP_WORK
    return True


def main():
    g = {"__name__": "make_test_bundle"}
    exec(open(os.path.join(HERE, "make_test_bundle.py"), encoding="utf-8").read(), g)
    ub = os.path.join(WORK, "ui_bundle_battle.js")
    g["bundle"](ROOT, g["MODS"], ub, g["NAMES"])
    files = ["x86emu.js", "dosenv.js", "harness.js", "harness_menu.js", "boot_title.js", "boot_port.js"]
    eb = os.path.join(WORK, "emu_boot_battle.js")
    open(eb, "w", encoding="utf-8").write("\n;\n".join([open(os.path.join(HERE, f), encoding="utf-8").read() for f in files] + [BOOT]))
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
        z.write(ub, "uw2_remake/tools/work/ui_bundle.js")
        z.write(eb, "uw2_remake/tools/work/emu_boot.js")
    print(n + 2, "files ->", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
