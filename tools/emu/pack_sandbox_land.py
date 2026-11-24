"""上陸探索 / 海上特殊地點的差分測試打包 (RE_NOTES 36): 分成兩包, 以免一次傳太大被中斷 —
  base: web/assets (data / gfx / text / scenario / font)、tools/work/sea2 (原版檔)、rom8x8.bin、newgame.bin  (內容不常變, 傳一次即可)
  code: web/src、tools/emu/*.js, 以及打包時產生的 tools/work/emu_boot.js / ui_bundle.js / runf.js  (每次改程式後重傳)
解開到執行環境的 WORKSPACE_DIR 之後 (兩包都解到同一處): 依序執行 emu_boot.js → ui_bundle.js → runf.js, 再 await session.RUNF["…"]()。
用法: python tools/emu/pack_sandbox_land.py <base|code> <TAG>       刪除: python tools/emu/pack_sandbox_land.py <base|code> <TAG> --clean"""
import os, sys, zipfile, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
WORK = os.path.join(ROOT, "tools", "work")
SEA2_SKIP = ("END.EXE", "ENDGRP.DAT", "END_PUT.DAT", "OPEN.EXE", "OPGRAPH.LZW", "hr022.ico", "PLAY.BAT", "MEM.TXT", "OUT.TXT", "PASS")
KEEP_WORK = ("rom8x8.bin", "newgame.bin")
ASSETS = ("data", "gfx", "text", "scenario", "font")


def want(rel, part):
    parts = rel.replace("\\", "/").split("/")
    if "__pycache__" in parts or parts[0] == ".git":
        return False
    if part == "code":
        if parts[:2] == ["web", "src"]:
            return True
        return parts[:2] == ["tools", "emu"] and parts[-1].endswith(".js")
    if parts[:2] == ["web", "assets"]:
        return len(parts) > 2 and parts[2] in ASSETS
    if parts[:3] == ["tools", "work", "sea2"]:
        return len(parts) == 4 and parts[3] not in SEA2_SKIP and not parts[3].endswith(".txt")
    if parts[:2] == ["tools", "work"]:
        return len(parts) == 3 and parts[2] in KEEP_WORK
    return False


def outputs(part, tag):
    base = os.path.join(WORK, f"_sandbox_land_{part}_{tag}")
    return [base + ".zip"] + ([base + "_" + n for n in ("emu_boot.js", "ui_bundle.js", "runf.js")] if part == "code" else [])


def main(part, tag):
    outs = outputs(part, tag); out = outs[0]
    extra = []
    if part == "code":
        _, boot, ub, rf = outs
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
        extra = [(boot, "emu_boot.js"), (ub, "ui_bundle.js"), (rf, "runf.js")]
    n = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for dp, dn, fn in os.walk(ROOT):
            if ".git" in dn:
                dn.remove(".git")
            for f in fn:
                p = os.path.join(dp, f)
                rel = os.path.relpath(p, ROOT)
                if p in outs or not want(rel, part):
                    continue
                z.write(p, "uw2_remake/" + rel.replace("\\", "/"))
                n += 1
        for p, name in extra:
            z.write(p, "uw2_remake/tools/work/" + name)
            os.remove(p)
    print(n + len(extra), "files ->", out, os.path.getsize(out), "bytes md5", hashlib.md5(open(out, "rb").read()).hexdigest())


def clean(part, tag):
    for p in outputs(part, tag):
        if os.path.exists(p):
            os.remove(p); print("removed", p)


if __name__ == "__main__":
    if len(sys.argv) > 3 and sys.argv[3] == "--clean":
        clean(sys.argv[1], sys.argv[2])
    else:
        main(sys.argv[1], sys.argv[2])
