# re_tools.py — 反組譯輔助 (由 re_local.py / tools/re/*.py 載入; 需先 exec re_env.py)
#   dumpc(a, b)  反組譯並加註已知函式名與 DS 字串
#   dstr(o)      DS:o 的字串 (原版字碼 → Unicode)
#   cbytes(o)    DS:o 的 C 字串原始位元組 (不含結尾 0)
#   cd(a, b)     同 dumpc 但只做位址修正與字串加註
TOOLS = os.path.join(W, "uw2_remake", "tools")
NAMES = {
    "2e09:56ee": "message", "2e09:57aa": "loadMenu", "2e09:569a": "message2", "0fea:490b": "wait",
    "0000:4dc4": "random", "0000:5c9a": "portRec", "0000:5caa": "portEco", "0000:5bf8": "personRec",
    "0000:5bde": "nationRec", "0000:8f03": "greet", "0000:7f06": "talkPerson", "0000:796d": "closeTalk",
    "0000:909b": "crewSpeaks", "0000:7e35": "talkFace", "0000:7f6e": "talk7f6e", "0fea:47fc": "yesNo?",
    "0fea:b5ce": "bMenu", "0fea:b6e0": "bAfter", "0fea:b6bc": "bTable", "0000:443c": "setCursor",
    "0000:4b9c": "puts", "0000:4bad": "printf", "0fea:5bd0": "personSelect", "0000:592a": "numpad",
    "0000:7358": "frame", "0000:50c4": "winSave", "0000:99f2": "fadeOut",
}


def dumpc(a, b, buf=None):
    for i in disasm(buf if buf is not None else code, a, b):
        t = _fmt(i)
        for k, v in NAMES.items():
            if k in t:
                t += "  ; " + v
        print(t)


SEGS = [0x2e09, 0x1fd9, 0x0fea, 0]
_C2U = {}


def dstr(o, n=96):
    """DS:o 的字串 (原版字碼 → Unicode)"""
    if not _C2U:
        cm = json.load(open(os.path.join(TOOLS, "..", "web", "assets", "font", "charmap.json"), encoding="utf-8"))
        for e in cm["table"]:
            _C2U[int(e[0], 16) if isinstance(e[0], str) else e[0]] = e[3]
    b, s, i = code[DS + o:DS + o + n], "", 0
    while i < len(b) and b[i]:
        k = (b[i] << 8) | (b[i + 1] if i + 1 < len(b) else 0)
        if b[i] >= 0x80 and k in _C2U:
            s, i = s + str(_C2U[k]), i + 2
        else:
            s, i = s + (chr(b[i]) if 32 <= b[i] < 127 else "{%02X}" % b[i]), i + 1
    return s


def _fmt(i):
    """段內近跳躍/呼叫目標依 64K 回繞修正; DS 字串常數加註"""
    ops = list(i.ops)
    if i.target is not None and "far" not in i.mn + " ".join(ops):
        bs = next(s for s in SEGS if s * 16 <= i.addr) * 16
        nt = bs + ((i.target - bs) & 0xffff)
        if nt != i.target:
            ops = [o.replace(format(i.target, "x"), format(nt, "x")) for o in ops]
    t = f"{i.addr:05x} {i.mn} {', '.join(ops)}"
    for m in re.finditer(r"\b0?([0-9a-f]{4})h\b", t[6:]):
        v = int(m.group(1), 16)
        if 0xa600 <= v < 0xbd00:
            s = dstr(v)
            if s and re.search(r"[^\x00-\x7f]|%", s):
                t += '  ; "' + s + '"'
    return t




def cd(a, b, buf=None):
    for i in disasm(buf if buf is not None else code, a, b):
        print(_fmt(i))


def cbytes(o):
    b = bytearray()
    while code[DS + o + len(b)]:
        b.append(code[DS + o + len(b)])
    return bytes(b)


def w16(o):
    return struct.unpack("<H", dsbytes(o, 2))[0]


def farptr(o):
    off, seg = struct.unpack("<HH", dsbytes(o, 4))
    return seg * 16 + off
