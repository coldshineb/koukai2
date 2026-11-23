r"""git_commit.py — 不需要外部 git 程式的「git add -A && git commit」(純 Python, 產生標準 git 物件 / 索引 / 參照)。
用法: python tools/git_commit.py "提交說明"          (在任何目錄執行皆可; 倉庫 = 本檔上一層)
      python tools/git_commit.py --init                 (建立 .git; 已存在則略過)
身份: 依 git 的設定 (系統 / 全域 / 倉庫 [user], 環境變數 GIT_AUTHOR_*); 讀不到時不建立提交, 只暫存快照到 .git/pending_commits,
      之後執行 python tools/git_fix_author.py 補成提交 (本工具不寫入也不猜測任何身份)。
規則: 依 .gitignore 排除 (支援「名稱/」目錄、「*.ext」、「a/b」根目錄相對路徑, # 註解); 工作樹與上次提交相同時不提交。
產生的倉庫可直接用一般 git 操作 (git log / status / diff)。只寫 loose 物件; 讀取 HEAD 時也支援 packed-refs。"""
import os, sys, time, zlib, hashlib, struct, fnmatch

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
GIT = os.path.join(ROOT, ".git")
PENDING = os.path.join(GIT, "pending_commits")      # 讀不到身份時暫存的快照 (tree + 時間 + 說明), 由 git_fix_author.py 補成提交


def _cfg_user(path):
    """讀 git 設定檔的 [user] name / email (含 [include] path)"""
    out = {}
    try:
        lines = open(path, encoding="utf-8", errors="replace").read().splitlines()
    except OSError:
        return out
    sec = ""
    for l in lines:
        l = l.strip()
        if not l or l[0] in "#;":
            continue
        if l.startswith("["):
            sec = l.strip("[]").strip().lower(); continue
        if "=" not in l:
            continue
        k, v = [x.strip() for x in l.split("=", 1)]
        v = v.strip('"')
        if sec == "user" and k.lower() in ("name", "email"):
            out[k.lower()] = v
        elif sec == "include" and k.lower() == "path":
            q = os.path.expanduser(v)
            if not os.path.isabs(q):
                q = os.path.join(os.path.dirname(path), q)
            out.update(_cfg_user(q))
    return out


def identity():
    """與 git 相同的優先序: 系統 < 全域 (XDG, ~/.gitconfig) < 倉庫; 環境變數 GIT_AUTHOR_* 最優先。讀不到回傳 None (不使用任何預設值)"""
    u = {}
    home = os.environ.get("HOME") or os.environ.get("USERPROFILE") or os.path.expanduser("~")
    xdg = os.environ.get("XDG_CONFIG_HOME") or os.path.join(home, ".config")
    files = [os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "Git", "etc", "gitconfig"), "/etc/gitconfig",
             os.path.join(xdg, "git", "config"), os.environ.get("GIT_CONFIG_GLOBAL") or os.path.join(home, ".gitconfig"),
             os.path.join(GIT, "config")]
    for f in files:
        u.update(_cfg_user(f))
    name = os.environ.get("GIT_AUTHOR_NAME") or u.get("name")
    email = os.environ.get("GIT_AUTHOR_EMAIL") or u.get("email")
    return f"{name} <{email}>" if name and email else None


def tz_of(t):
    off = -time.altzone if time.localtime(t).tm_isdst > 0 else -time.timezone
    return "%s%02d%02d" % ("+" if off >= 0 else "-", abs(off) // 3600, abs(off) % 3600 // 60)


def init():
    if os.path.exists(GIT):
        return False
    for d in ("objects/info", "objects/pack", "refs/heads", "refs/tags", "info"):
        os.makedirs(os.path.join(GIT, d))
    open(os.path.join(GIT, "HEAD"), "w", newline="\n").write("ref: refs/heads/main\n")
    open(os.path.join(GIT, "config"), "w", newline="\n").write(
        "[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = false\n\tlogallrefupdates = true\n"
        "\tsymlinks = false\n\tignorecase = true\n")
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
    pend = read_pending()
    last = pend[-1]["tree"] if pend else (commit_tree_of(parent) if parent else None)
    if last == tree:
        print("沒有變更, 不提交"); return parent
    t = int(time.time()); tz = tz_of(t)
    me = identity()
    if not me or pend:
        add_pending(tree, t, tz, msg)
        print(("讀不到 git 使用者設定 (user.name / user.email)" if not me else "前面還有待補的提交") +
              f", 已暫存快照 {tree[:7]}: {msg.splitlines()[0]}\n  在本機執行 python tools/git_fix_author.py 以全域設定補成提交")
        return None
    return make_commit(ref, parent, tree, me, t, tz, msg)


def read_pending():
    if not os.path.exists(PENDING):
        return []
    import json
    return [json.loads(l) for l in open(PENDING, encoding="utf-8") if l.strip()]


def add_pending(tree, t, tz, msg):
    import json
    open(PENDING, "a", encoding="utf-8", newline="\n").write(json.dumps({"tree": tree, "time": t, "tz": tz, "msg": msg}, ensure_ascii=False) + "\n")


def make_commit(ref, parent, tree, me, t, tz, msg, author=None):
    who = f"{me} {t} {tz}"
    body = f"tree {tree}\n" + (f"parent {parent}\n" if parent else "") + f"author {author or who}\ncommitter {who}\n\n{msg.rstrip()}\n"
    c = put("commit", body.encode("utf-8"))
    p = os.path.join(GIT, *ref.split("/")); os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "w", newline="\n").write(c + "\n")
    lg = os.path.join(GIT, "logs", *ref.split("/")); os.makedirs(os.path.dirname(lg), exist_ok=True)
    line = f"{parent or '0' * 40} {c} {who}\tcommit{'' if parent else ' (initial)'}: {msg.splitlines()[0]}\n"
    for q in (lg, os.path.join(GIT, "logs", "HEAD")):
        open(q, "a", encoding="utf-8", newline="\n").write(line)
    print(f"[{ref.split('/')[-1]} {c[:7]}] {msg.splitlines()[0]}")
    return c


def main(argv):
    if argv[:1] == ["--init"]:
        print("已建立 .git" if init() else ".git 已存在"); return
    if not os.path.exists(GIT):
        init()
    commit(argv[0] if argv else "update")


if __name__ == "__main__":
    main(sys.argv[1:])
