"""片頭差分測試用: 把需要的檔案打包成 tools/work/_sandbox_open.zip (排除規則同 pack_sandbox.py, 另外只帶片頭用到的原版檔),
供沒有本機 Node 的執行環境解開後執行。原始檔一律以本專案資料夾為準, 解開的副本只用來執行。
用法: python tools/emu/pack_sandbox_open.py"""
import os, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "tools", "work", "_sandbox_open.zip")
SEA2 = ("OPEN.EXE", "OPGRAPH.LZW", "1.PAT", "2.PAT", "FMDRV.COM", "KOUKAI2.COM")
KEEP_WORK = ("rom8x8.bin", "ui_bundle.js")


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


def main():
    n = 0
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for dp, dn, fn in os.walk(ROOT):
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
