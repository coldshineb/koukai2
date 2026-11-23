r"""git_fix_author.py — 用本機 git 的全域設定 (user.name / user.email) 重寫既有提交的作者與提交者, 並把暫存的快照補成提交。
內容 (tree)、時間、說明都不變, 只換身份; 之後 main 指向新的歷史。舊物件保留 (不刪除)。
用法: python tools/git_fix_author.py          (在本機執行; 讀取 %USERPROFILE%\.gitconfig 等, 與 git 相同)
      python tools/git_fix_author.py --dry    只列出將要做的事"""
import os, sys, zlib, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import git_commit as G


def read_obj(h):
    raw = zlib.decompress(open(os.path.join(G.GIT, "objects", h[:2], h[2:]), "rb").read())
    return raw[raw.index(b"\0") + 1:]


def parse(body):
    head, msg = body.split(b"\n\n", 1)
    f = {"parent": []}
    for l in head.split(b"\n"):
        k, v = l.split(b" ", 1)
        if k == b"parent": f["parent"].append(v.decode())
        else: f[k.decode()] = v.decode()
    return f, msg.decode("utf-8")


def main(argv):
    me = G.identity()
    if not me:
        print("讀不到 git 的 user.name / user.email, 請先設定: git config --global user.name ... / user.email ..."); return 1
    ref = G.head_ref() or "refs/heads/main"
    tip = G.read_ref(ref); chain = []
    while tip:
        f, msg = parse(read_obj(tip)); chain.append((tip, f, msg)); tip = f["parent"][0] if f["parent"] else None
    chain.reverse(); pend = G.read_pending()
    print(f"身份: {me}\n既有提交 {len(chain)} 個, 待補快照 {len(pend)} 個")
    if "--dry" in argv:
        for _, f, msg in chain: print("  重寫", f["author"].rsplit(" ", 2)[0], "→", me, "|", msg.splitlines()[0])
        for p in pend: print("  補交", p["msg"].splitlines()[0])
        return 0
    parent = None
    for _, f, msg in chain:
        t, tz = f["committer"].rsplit(" ", 2)[1:]
        at, atz = f["author"].rsplit(" ", 2)[1:]
        parent = G.make_commit(ref, parent, f["tree"], me, int(t), tz, msg, author=f"{me} {at} {atz}")
    for p in pend:
        parent = G.make_commit(ref, parent, p["tree"], me, p["time"], p["tz"], p["msg"])
    if os.path.exists(G.PENDING): os.remove(G.PENDING)
    print("完成。可用 git log --format=\"%h %an <%ae> %s\" 確認")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
