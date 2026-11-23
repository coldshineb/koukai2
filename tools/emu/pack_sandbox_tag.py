"""把差分測試需要的檔案打包成 tools/work/_sandbox_<TAG>.zip (每次用不同的 TAG, 避免複製到雲端時讀到舊檔)。
合併腳本 / 開機腳本產生到 tools/work/ui_bundle_<TAG>.js、emu_boot_<TAG>.js, 在 zip 內以 tools/work/ui_bundle.js、emu_boot.js 的名稱放入
(開機腳本以 session.BOOT_W (預設 WORKSPACE_DIR) 為 uw2_remake 的上一層)。不含 .git、web/bgm、tools/work 內除 sea2 / rom8x8.bin / newgame.bin 以外的內容。
用法: python tools/emu/pack_sandbox_tag.py <TAG>      之後刪除: python tools/emu/pack_sandbox_tag.py <TAG> --clean"""
import os, sys, zipfile, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
WORK = os.path.join(ROOT, "tools", "work")
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


def outputs(tag):
    return [os.path.join(WORK, n) for n in (f"_sandbox_{tag}.zip", f"ui_bundle_{tag}.js", f"emu_boot_{tag}.js")]


def main(tag):
    out, ub, eb = outputs(tag)
    g = {"__name__": "make_test_bundle"}
    exec(open(os.path.join(HERE, "make_test_bundle.py"), encoding="utf-8").read(), g)
    g["bundle"](ROOT, g["MODS"], ub, g["NAMES"])
    files = ["x86emu.js", "dosenv.js", "harness.js", "harness_menu.js", "boot_title.js", "boot_port.js"]
    open(eb, "w", encoding="utf-8").write("\n;\n".join([open(os.path.join(HERE, f), encoding="utf-8").read() for f in files] + [BOOT]))
    n = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for dp, dn, fn in os.walk(ROOT):
            if ".git" in dn:
                dn.remove(".git")
            for f in fn:
                p = os.path.join(dp, f)
                rel = os.path.relpath(p, ROOT)
                if p in (out, ub, eb) or not want(rel):
                    continue
                z.write(p, "uw2_remake/" + rel.replace("\\", "/"))
                n += 1
        z.write(ub, "uw2_remake/tools/work/ui_bundle.js")
        z.write(eb, "uw2_remake/tools/work/emu_boot.js")
    print(n + 2, "files ->", out, os.path.getsize(out), "bytes md5", hashlib.md5(open(out, "rb").read()).hexdigest())


def clean(tag):
    for p in outputs(tag):
        if os.path.exists(p):
            os.remove(p); print("removed", p)


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[2] == "--clean":
        clean(sys.argv[1])
    else:
        main(sys.argv[1])
