"""git_commit.py — 不需要外部 git 程式的「git add -A && git commit」(純 Python, 產生標準 git 物件 / 索引 / 參照)。
用法: python tools/git_commit.py "提交說明"          (在任何目錄執行皆可; 倉庫 = 本檔上一層)
      python tools/git_commit.py --init                 (建立 .git; 已存在則略過)
規則: 依 .gitignore 排除 (支援「名稱/」目錄、「*.ext」、「a/b」根目錄相對路徑, # 註解); 工作樹與上次提交相同時不提交。
產生的倉庫可直接用一般 git 操作 (git log / status / diff)。只寫 loose 物件; 讀取 HEAD 時也支援 packed-refs。"""
import os, sys, time, zlib, hashlib, struct, fnmatch

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
GIT = os.path.join(ROOT, ".git")
AUTHOR = "Xiaolvshu <sb.xhsgdby@gmail.com>"


def init():
    if os.path.exists(GIT):
        return False
    for d in ("objects/info", "objects/pack", "refs/heads", "refs/tags", "info"):
        os.makedirs(os.path.join(GIT, d))
    open(os.path.join(GIT, "HEAD"), "w", newline="\n").write("ref: refs/heads/main\n")
    open(os.path.join(GIT, "config"), "w", newline="\n").write(
        "[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = false\n\tlogallrefupdates = true\n"
        "\tsymlinks = false\n\tignorecase = true\n[user]\n\tname = Xiaolvshu\n\temail = sb.xhsgdby@gmail.com\n")
    open(os.path.join(GIT, "description"), "w", newline="\n").write("uw2_remake\n")
    return True


def ignore_rules():
    p = os.path.join(ROOT, ".gitignore"); rules = [".git/"]
    if os.path.exists(p):
        rules += [l.strip() for l in open(p, encoding="utf-8") if l.strip() and not l.lstrip().startswith("#")]
    return rules


def ignored(rel, is_dir, rules):
    name = rel.rsplit("/", 1)[-1]
    for r in rules:
        d = r.endswith("/"); pat = r.rstrip("/")
        if d and not is_dir:
            continue
        if pat.startswith("/") or "/" in pat:
            if fnmatch.fnmatchcase(rel, pat.lstrip("/")):
                return True
        elif fnmatch.fnmatchcase(name, pat):
            return True
    return False


def files():
    rules, out = ignore_rules(), []
    for dp, dn, fn in os.walk(ROOT):
        rd = os.path.relpath(dp, ROOT).replace("\\", "/"); rd = "" if rd == "." else rd + "/"
        dn[:] = sorted(d for d in dn if not ignored(rd + d, True, rules))
        out += [rd + f for f in fn if not ignored(rd + f, False, rules)]
    return sorted(out, key=lambda s: s.encode("utf-8"))


def put(kind, data):
    raw = kind.encode() + b" " + str(len(data)).encode() + b"\0" + data
    h = hashlib.sha1(raw).hexdigest(); p = os.path.join(GIT, "objects", h[:2], h[2:])
    if not os.path.exists(p):
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, "wb").write(zlib.compress(raw))
    return h


def write_tree(entries):                 # entries: {path: sha}
    root = {}
    for path, h in entries.items():
        node = root; parts = path.split("/")
        for d in parts[:-1]:
            node = node.setdefault(d, {})
        node[parts[-1]] = h
    def build(node):
        items = []
        for name, v in node.items():
            if isinstance(v, dict):
                items.append((name.encode() + b"/", b"40000 " + name.encode() + b"\0" + bytes.fromhex(build(v))))
            else:
                items.append((name.encode(), b"100644 " + name.encode() + b"\0" + bytes.fromhex(v)))
        return put("tree", b"".join(e for _, e in sorted(items)))
    return build(root)


def write_index(rows):                   # rows: [(path, sha, stat)]
    body = [b"DIRC" + struct.pack(">II", 2, len(rows))]
    for path, h, s in rows:
        pb = path.encode("utf-8")
        e = struct.pack(">IIIIIIIIII", int(s.st_ctime) & 0xffffffff, s.st_ctime_ns % 10**9, int(s.st_mtime) & 0xffffffff,
                        s.st_mtime_ns % 10**9, 0, 0, 0o100644, 0, 0, s.st_size & 0xffffffff)
        e += bytes.fromhex(h) + struct.pack(">H", min(len(pb), 0xfff)) + pb
        e += b"\0" * (8 - len(e) % 8)
        body.append(e)
    data = b"".join(body)
    open(os.path.join(GIT, "index"), "wb").write(data + hashlib.sha1(data).digest())


def head_ref():
    h = open(os.path.join(GIT, "HEAD"), encoding="utf-8").read().strip()
    return h[5:] if h.startswith("ref: ") else None


def read_ref(ref):
    p = os.path.join(GIT, *ref.split("/"))
    if os.path.exists(p):
        return open(p, encoding="utf-8").read().strip()
    pr = os.path.join(GIT, "packed-refs")
    if os.path.exists(pr):
        for l in open(pr, encoding="utf-8"):
            if l.strip().endswith(" " + ref):
                return l.split()[0]
    return None


def commit_tree_of(sha):
    p = os.path.join(GIT, "objects", sha[:2], sha[2:])
    if not os.path.exists(p):
        return None                      # 已被打包: 視為不同, 照常提交
    raw = zlib.decompress(open(p, "rb").read()); body = raw[raw.index(b"\0") + 1:]
    return body.split(b"\n", 1)[0][5:].decode()


def commit(msg):
    ref = head_ref() or "refs/heads/main"; parent = read_ref(ref)
    rows = []
    for rel in files():
        p = os.path.join(ROOT, *rel.split("/"))
        rows.append((rel, put("blob", open(p, "rb").read()), os.stat(p)))
    tree = write_tree({r: h for r, h, _ in rows})
    write_index(rows)
    if parent and commit_tree_of(parent) == tree:
        print("沒有變更, 不提交"); return parent
    t = int(time.time()); off = -time.altzone if time.localtime(t).tm_isdst > 0 else -time.timezone
    tz = "%s%02d%02d" % ("+" if off >= 0 else "-", abs(off) // 3600, abs(off) % 3600 // 60)
    who = f"{AUTHOR} {t} {tz}"
    body = f"tree {tree}\n" + (f"parent {parent}\n" if parent else "") + f"author {who}\ncommitter {who}\n\n{msg.rstrip()}\n"
    c = put("commit", body.encode("utf-8"))
    p = os.path.join(GIT, *ref.split("/")); os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "w", newline="\n").write(c + "\n")
    lg = os.path.join(GIT, "logs", *ref.split("/")); os.makedirs(os.path.dirname(lg), exist_ok=True)
    line = f"{parent or '0' * 40} {c} {who}\tcommit{'' if parent else ' (initial)'}: {msg.splitlines()[0]}\n"
    for q in (lg, os.path.join(GIT, "logs", "HEAD")):
        open(q, "a", encoding="utf-8", newline="\n").write(line)
    print(f"[{ref.split('/')[-1]} {c[:7]}] {msg.splitlines()[0]}  ({len(rows)} 個檔案)")
    return c


def main(argv):
    if argv[:1] == ["--init"]:
        print("已建立 .git" if init() else ".git 已存在"); return
    if not os.path.exists(GIT):
        init()
    commit(argv[0] if argv else "update")


if __name__ == "__main__":
    main(sys.argv[1:])
