"""效果音 / 上陸探索的差分測試用: 把需要的檔案打包成 tools/work/_sandbox_sfx_<TAG>.zip, 供沒有本機 Node 的執行環境解開後執行 (RE_NOTES 35.6)。
內容: web/src、web/assets (data / gfx / text / scenario / font)、tools/emu/*.js、tools/work/sea2 (MAIN.EXE 路線與 FMDRV.COM 用到的原版檔)、rom8x8.bin、newgame.bin;
打包時另產生 tools/work/emu_boot.js (make_sandbox_boot.py)、ui_bundle.js (make_test_bundle.py)、runf.js (make_runf.py), 只放進 zip。
解開到執行環境的 WORKSPACE_DIR 之後: 依序執行 emu_boot.js → ui_bundle.js → runf.js, 再 await session.RUNF["…"]()。
用法: python tools/emu/pack_sandbox_sfx.py <TAG>       刪除: python tools/emu/pack_sandbox_sfx.py <TAG> --clean"""
import os, sys, zipfile, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
WORK = os.path.join(ROOT, "tools", "work")
SEA2_SKIP = ("END.EXE", "ENDGRP.DAT", "END_PUT.DAT", "OPEN.EXE", "OPGRAPH.LZW", "hr022.ico", "PLAY.BAT", "MEM.TXT", "OUT.TXT", "PASS")
KEEP_WORK = ("rom8x8.bin", "newgame.bin")
ASSETS = ("data", "gfx", "text", "scenario", "font")


def want(rel):
    parts = rel.replace("\\", "/").split("/")
    if "__pycache__" in parts or parts[0] == ".git":
        return False
    if parts[:2] == ["web", "src"]:
        return True
    if parts[:2] == ["web", "assets"]:
        return len(parts) > 2 and parts[2] in ASSETS
    if parts[:2] == ["tools", "emu"]:
        return parts[-1].endswith(".js")
    if parts[:3] == ["tools", "work", "sea2"]:
        return len(parts) == 4 and parts[3] not in SEA2_SKIP and not parts[3].endswith(".txt")
    if parts[:2] == ["tools", "work"]:
        return len(parts) == 3 and parts[2] in KEEP_WORK
    return False


def outputs(tag):
    return [os.path.join(WORK, f"_sandbox_sfx_{tag}.zip")] + [os.path.join(WORK, f"_sandbox_sfx_{tag}_{n}") for n in ("emu_boot.js", "ui_bundle.js", "runf.js")]


def main(tag):
    out, boot, ub, rf = outputs(tag)
    g = {"__name__": "x"}
    exec(open(os.path.join(HERE, "make_test_bundle.py"), encoding="utf-8").read(), g)
    g["bundle"](ROOT, g["MODS"], ub, g["NAMES"])
    g = {"__name__": "x", "__file__": os.path.join(HERE, "make_sandbox_boot.py")}
    exec(open(os.path.join(HERE, "make_sandbox_boot.py"), encoding="utf-8").read(), g)
    parts = [open(os.path.join(HERE, f), encoding="utf-8").read() for f in g["FILES"]] + [g["BOOT"]]
    open(boot, "w", encoding="utf-8").write("\n;\n".join(parts))
    g = {"__name__": "x", "__file__": os.path.join(HERE, "make_runf.py")}
    exec(open(os.path.join(HERE, "make_runf.py"), encoding="utf-8").read(), g)
    g["build"](rf)
    n = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for dp, dn, fn in os.walk(ROOT):
            if ".git" in dn:
                dn.remove(".git")
            for f in fn:
                p = os.path.join(dp, f)
                rel = os.path.relpath(p, ROOT)
                if p in outputs(tag) or not want(rel):
                    continue
                z.write(p, "uw2_remake/" + rel.replace("\\", "/"))
                n += 1
        for p, name in ((boot, "emu_boot.js"), (ub, "ui_bundle.js"), (rf, "runf.js")):
            z.write(p, "uw2_remake/tools/work/" + name)
            os.remove(p)
    print(n + 3, "files ->", out, os.path.getsize(out), "bytes md5", hashlib.md5(open(out, "rb").read()).hexdigest())


def clean(tag):
    for p in outputs(tag):
        if os.path.exists(p):
            os.remove(p); print("removed", p)


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[2] == "--clean":
        clean(sys.argv[1])
    else:
        main(sys.argv[1])
