"""結局差分測試用: 把需要的檔案打包成 tools/work/_sandbox_end_<TAG>.zip (原版檔只帶結局用到的), 供沒有本機 Node 的執行環境解開後執行。
原始檔一律以本專案資料夾為準, 解開的副本只用來執行; 合併腳本 tools/work/ui_bundle.js 在打包時以 make_test_bundle.py 重新產生 (zip 內)。
用法: python tools/emu/pack_sandbox_end.py <TAG>       刪除: python tools/emu/pack_sandbox_end.py <TAG> --clean"""
import os, sys, zipfile, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
WORK = os.path.join(ROOT, "tools", "work")
SEA2 = ("END.EXE", "ENDGRP.DAT", "OPEN.EXE", "OPGRAPH.LZW", "1.PAT", "2.PAT", "FMDRV.COM", "KOUKAI2.COM", "D2.MML",
        "MAIN.EXE", "DATA1.LZW", "KAO.LZW", "GRAPH.DAT", "GRAPH2.DAT", "MESSAGE.DAT", "MENU.DAT", "KOUKAI2.DAT", "SNR0.DAT", "SNR1.DAT")
KEEP_WORK = ("rom8x8.bin",)


def want(rel):
    parts = rel.replace("\\", "/").split("/")
    if "__pycache__" in parts or parts[0] == ".git":
        return False
    if parts[0] == "web":
        return len(parts) > 1 and parts[1] in ("src", "assets")
    if parts[:2] == ["tools", "emu"]:
        return parts[-1].endswith(".js")
    if parts[:3] == ["tools", "work", "sea2"]:
        return len(parts) == 4 and parts[3] in SEA2
    if parts[:2] == ["tools", "work"]:
        return len(parts) == 3 and parts[2] in KEEP_WORK
    return False


def outputs(tag):
    return os.path.join(WORK, f"_sandbox_end_{tag}.zip"), os.path.join(WORK, f"ui_bundle_end_{tag}.js")


def main(tag):
    out, ub = outputs(tag)
    g = {"__name__": "make_test_bundle"}
    exec(open(os.path.join(HERE, "make_test_bundle.py"), encoding="utf-8").read(), g)
    g["bundle"](ROOT, g["MODS"], ub, g["NAMES"])
    n = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for dp, dn, fn in os.walk(ROOT):
            if ".git" in dn:
                dn.remove(".git")
            for f in fn:
                p = os.path.join(dp, f)
                rel = os.path.relpath(p, ROOT)
                if p in (out, ub) or not want(rel):
                    continue
                z.write(p, "uw2_remake/" + rel.replace("\\", "/"))
                n += 1
        z.write(ub, "uw2_remake/tools/work/ui_bundle.js")
    os.remove(ub)
    print(n + 1, "files ->", out, os.path.getsize(out), "bytes md5", hashlib.md5(open(out, "rb").read()).hexdigest())


def clean(tag):
    for p in outputs(tag):
        if os.path.exists(p):
            os.remove(p); print("removed", p)


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[2] == "--clean":
        clean(sys.argv[1])
    else:
        main(sys.argv[1])
