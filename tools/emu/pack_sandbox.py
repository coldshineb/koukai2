"""把差分測試需要的檔案打包成 tools/work/_sandbox.zip (不含 web/bgm 與 tools/work 內的分析輸出),
供沒有本機 Node 的執行環境解開後執行。所有原始檔仍以本專案資料夾為準, 解開的副本只用來執行、不在那裡修改。
用法: python tools/emu/pack_sandbox.py"""
import os, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "tools", "work", "_sandbox.zip")
KEEP_WORK = ("sea2", "rom8x8.bin", "newgame.bin")


def want(rel):
    parts = rel.replace("\\", "/").split("/")
    if parts[:2] == ["web", "bgm"] or "__pycache__" in parts:
        return False
    if parts[:2] == ["tools", "work"]:
        return len(parts) > 2 and parts[2] in KEEP_WORK
    return True


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
