"""snr2json.py — SNR*.DAT 劇本程式 → web/assets/scenario/snrN.json (並逐位元組往返驗證)
格式見 docs/RE_NOTES.md 第 18 節。解碼方式: 每節從事件索引的各入口沿控制流遞迴解碼 (條件跳躍兩邊、FE 只走目標、F2 與不合法指令停止),
VM 一次載入 0x4000 bytes, 所以解碼可以越過本節結尾 (那部分只用來執行, 往返比對只看本節範圍)。
用法: python tools/snr2json.py <sea2 目錄> <web/assets 目錄>
JSON:
  {"file": "SNR0.DAT", "chapters": [null | {"at": 章起點, "sections": [
     {"at": 節起點, "len": 本節長度, "index": [[港, 建築, 入口], ...],
      "code": [指令...], "raw": [[相對偏移, "未解碼位元組 hex"], ...]}]}]}
  指令 (at = 節內相對偏移, op = 原始 op byte):
    {"at", "op", "k": "mov",  "a": "word"|"byte"|"sys", "dst": 運算元, "src": 運算元}
    {"at", "op", "k": "alu",  "fn": "add"|"sub"|"mul"|"div"|"or"|"and"|"shr"|"shl", "dst", "src"}
    {"at", "op", "k": "jmp_if_not", "cmp": "eq"|"ne"|"ge"|"le", "dst", "src", "to": 目標}   (條件成立往下執行, 不成立跳到 to)
    {"at", "op", "k": 命令名, 其餘為命令參數}
  運算元: {"var": n} 變數 / {"ptr": n} 變數所指位址 / {"flag": n} 旗標 / {"imm": v} 立即值 / {"sys": n} 系統值
"""
import json, os, struct, sys

# 命令 C0..FF: (名称, 参数格式) — b = byte, w = 大端 word, v = 变量编号 (byte)
CMDS = {
    0xc0: ("win_open", "b"), 0xc3: ("win_close", ""), 0xc4: ("win_close_all", ""), 0xc5: ("win_select", "b"),
    0xc7: ("wait_key", ""), 0xc8: ("msg", "w"), 0xc9: ("menu", "vw"), 0xca: ("music", "b"), 0xcb: ("picture", "wwb"),
    0xcc: ("face", "w"), 0xcd: ("face_var", "v"), 0xd0: ("addr_var", "vbvb"), 0xdc: ("addr", "vbbb"), 0xd1: ("d1", "v"),
    0xd4: ("msg_expand", "w"), 0xe2: ("cargo_load", "vv"), 0xe3: ("cargo_unload", "vv"), 0xe4: ("money_set", "v"),
    0xe6: ("money_add", "v"), 0xe7: ("money_sub", "v"), 0xe8: ("duel", "b"), 0xe9: ("yes_no", "b"), 0xea: ("money_div10000", "v"),
    0xeb: ("random", "vw"), 0xec: ("seed_set", "v"), 0xed: ("seed_get", "v"), 0xee: ("cargo_free", "v"),
    0xf0: ("next_section", ""), 0xf1: ("next_chapter", ""), 0xf2: ("stop", ""), 0xf4: ("ending", "b"), 0xf8: ("return0", ""),
    0xf9: ("ship_new", "bb"), 0xfa: ("ship_name", "bw"), 0xfb: ("crew_join", "b"), 0xfc: ("barmaid_love", "bb"),
    0xfe: ("goto", "w"), 0xff: ("nop", ""),
}
ARGNAMES = {
    "win_open": ["win"], "win_select": ["win"], "msg": ["msg"], "menu": ["var", "msg"], "music": ["song"],
    "picture": ["x", "y", "pic"], "face": ["face"], "face_var": ["var"], "addr": ["var", "kind", "index", "field"],
    "addr_var": ["var", "kind", "index_var", "field"], "d1": ["var"], "msg_expand": ["msg"], "cargo_load": ["var_goods", "var_amount"],
    "cargo_unload": ["var_goods", "var_amount"], "money_set": ["var"], "money_add": ["var"], "money_sub": ["var"], "duel": ["person"],
    "yes_no": ["flag"], "money_div10000": ["var"], "random": ["var", "range"], "seed_set": ["var"], "seed_get": ["var"],
    "cargo_free": ["var"], "ending": ["code"], "ship_new": ["type", "b2"], "ship_name": ["b1", "msg"], "crew_join": ["person"],
    "barmaid_love": ["girl", "amount"], "goto": ["to"],
}
ALU = {0: "add", 1: "sub", 2: "mul", 3: "div", 0x20: "or", 0x21: "and", 0x22: "shr", 0x23: "shl"}
CMP = ["eq", "ne", "ge", "le"]
SRC_MODE = ["var", "ptr", "flag", "imm"]
DST_MODE = ["var", "ptr", "flag"]
BUF = 0x4000


class Bad(Exception):
    pass


def decode_one(b, p):
    """回傳 (指令 dict, 長度); 不合法時 k = "bad" """
    op = b[p]
    cls = op >> 6
    rb = lambda k: b[p + k]
    rw = lambda k: (b[p + k] << 8) | b[p + k + 1]
    if cls == 0:
        a, s, d = op & 3, (op >> 2) & 3, (op >> 4) & 3
        if a == 2 or d == 3 or (d < 2 and s == 2) or (d == 2 and s == 0) or (d == 2 and a != 0):
            return {"k": "bad"}, 1
        dst, src = rb(1), rb(2)
        if a == 3:
            return {"k": "mov", "a": "sys", "dst": {DST_MODE[d]: dst}, "src": {"sys": src}}, 3
        n = 3
        if s == 3 and a == 0 and d != 2:
            src = (src << 8) | rb(3); n = 4
        return {"k": "mov", "a": "word" if a == 0 else "byte", "dst": {DST_MODE[d]: dst}, "src": {SRC_MODE[s]: src}}, n
    if cls == 1:
        fn, d, s = op & 0x23, (op >> 4) & 1, (op >> 2) & 3
        return {"k": "alu", "fn": ALU[fn], "dst": {DST_MODE[d]: rb(1)}, "src": {SRC_MODE[s]: rb(2)}}, 3
    if cls == 2:
        c, s, d = op & 3, (op >> 2) & 3, (op >> 4) & 3
        if d == 3 or (d == 2 and s < 2) or (d == 2 and c >= 2):
            return {"k": "bad"}, 1
        if d == 2:
            if s == 2:
                return {"k": "jmp_if_not", "cmp": CMP[c], "dst": {"flag": rb(1)}, "src": {"flag": rb(2)}, "to": rw(3)}, 5
            return {"k": "jmp_if_not", "cmp": CMP[c], "dst": {"flag": rb(1)}, "src": {"imm": c & 1}, "to": rw(2)}, 4
        return {"k": "jmp_if_not", "cmp": CMP[c], "dst": {DST_MODE[d]: rb(1)}, "src": {SRC_MODE[s]: rb(2)}, "to": rw(3)}, 5
    if op not in CMDS:
        return {"k": "bad"}, 1
    name, fmt = CMDS[op]
    ins, k, vals = {"k": name}, 1, []
    for f in fmt:
        if f == "w":
            vals.append(rw(k)); k += 2
        else:
            vals.append(rb(k)); k += 1
    for nm, v in zip(ARGNAMES.get(name, []), vals):
        ins[nm] = v
    return ins, k


def encode_one(ins):
    """指令 dict → bytes (往返驗證用)"""
    op, k = ins["op"], ins["k"]
    out = bytearray([op])
    val = lambda o: next(iter(o.values()))
    if k == "mov":
        if ins["a"] == "sys":
            out += bytes([val(ins["dst"]), val(ins["src"])])
        else:
            v = val(ins["src"])
            if "imm" in ins["src"] and ins["a"] == "word" and "flag" not in ins["dst"]:
                out += bytes([val(ins["dst"]), v >> 8, v & 255])
            else:
                out += bytes([val(ins["dst"]), v])
    elif k == "alu":
        out += bytes([val(ins["dst"]), val(ins["src"])])
    elif k == "jmp_if_not":
        out.append(val(ins["dst"]))
        if not ("flag" in ins["dst"] and "imm" in ins["src"]):
            out.append(val(ins["src"]))
        out += struct.pack(">H", ins["to"])
    elif k != "bad":
        fmt = CMDS[op][1]
        for f, nm in zip(fmt, ARGNAMES.get(k, [])):
            out += struct.pack(">H", ins[nm]) if f == "w" else bytes([ins[nm]])
    return bytes(out)


def decode_section(b, at, end):
    """b = 整個檔案; at = 節起點; end = 本節結尾 (下一節起點)"""
    win = b[at:at + BUF] + bytes(max(0, BUF - (len(b) - at)))
    index, p = [], 0
    while win[p] != 0xff:
        index.append([win[p], win[p + 1], (win[p + 2] << 8) | win[p + 3]]); p += 4
    idx_len = p + 1
    code, todo = {}, [e[2] for e in index]
    while todo:
        q = todo.pop()
        while 0 <= q < BUF - 8 and q not in code:
            ins, n = decode_one(win, q)
            ins = {"at": q, "op": win[q], "n": n, **ins}
            code[q] = ins
            k = ins["k"]
            if k == "jmp_if_not":
                todo.append(ins["to"])
            if k == "goto":
                todo.append(ins["to"]); break
            if k in ("stop", "bad"):
                break
            q += n
    # 本节范围内未被解码的字节
    covered = bytearray(end - at)
    for i in range(min(idx_len, len(covered))):
        covered[i] = 1
    for q, ins in code.items():
        n = len(encode_one(ins))
        for i in range(q, min(q + n, len(covered))):
            covered[i] = 1
    raw, i = [], 0
    while i < len(covered):
        if covered[i]:
            i += 1; continue
        j = i
        while j < len(covered) and not covered[j]:
            j += 1
        raw.append([i, win[i:j].hex()]); i = j
    return {"at": at, "len": end - at, "index": index, "code": [code[k] for k in sorted(code)], "raw": raw}


def rebuild_section(sec):
    out = bytearray(sec["len"])
    p = 0
    for e in sec["index"]:
        out[p:p + 4] = bytes([e[0], e[1], e[2] >> 8, e[2] & 255]); p += 4
    if p < len(out):
        out[p] = 0xff
    for ins in sec["code"]:
        bb = encode_one(ins)
        for i, v in enumerate(bb):
            if ins["at"] + i < len(out):
                out[ins["at"] + i] = v
    for off, h in sec["raw"]:
        bb = bytes.fromhex(h); out[off:off + len(bb)] = bb
    return bytes(out)


def convert(path):
    b = open(path, "rb").read()
    assert b[:4] == b"SNDT", path
    # 章表: 偏移 (章+4)*4, 直到第一个章起点
    starts, k = [], 0
    first = None
    while True:
        o = (k + 4) * 4
        if first is not None and o >= first:
            break
        v = struct.unpack(">I", b[o:o + 4])[0]
        starts.append(None if v == 0xffffffff else v)
        if v != 0xffffffff and first is None:
            first = v
        k += 1
    ends_all = sorted({s for s in starts if s is not None} | {len(b)})
    chapters = []
    for c, cs in enumerate(starts):
        if cs is None:
            chapters.append(None); continue
        cend = next(e for e in ends_all if e > cs)
        # 节表: u16 直到第一个节的相对偏移
        secs, j, sfirst = [], 0, None
        while True:
            if sfirst is not None and j * 2 >= sfirst:
                break
            v = struct.unpack(">H", b[cs + j * 2:cs + j * 2 + 2])[0]
            if v == 0xffff:
                secs.append(None)
            else:
                secs.append(v)
                if sfirst is None:
                    sfirst = v
            j += 1
        real = sorted({cs + v for v in secs if v is not None} | {cend})
        out = []
        for v in secs:
            if v is None:
                out.append(None); continue
            a = cs + v
            out.append(decode_section(b, a, next(e for e in real if e > a)))
        chapters.append({"at": cs, "table_len": sfirst, "sections": out})
    return b, {"file": os.path.basename(path), "len": len(b), "chapter_slots": len(starts), "chapters": chapters}


def rebuild(doc, orig):
    """由 JSON 重建整個檔案 (檔頭/章表/節表直接由 JSON 的位置資訊產生)"""
    out = bytearray(doc["len"])
    out[:4] = b"SNDT"
    out[4:16] = orig[4:16]                       # 档头其余 12 bytes (固定 00 80 00 00 ...)
    for c, ch in enumerate(doc["chapters"]):
        o = (c + 4) * 4
        out[o:o + 4] = struct.pack(">I", 0xffffffff if ch is None else ch["at"])
        if ch is None:
            continue
        for j, sec in enumerate(ch["sections"]):
            out[ch["at"] + 2 * j:ch["at"] + 2 * j + 2] = struct.pack(">H", 0xffff if sec is None else sec["at"] - ch["at"])
        for sec in ch["sections"]:
            if sec:
                out[sec["at"]:sec["at"] + sec["len"]] = rebuild_section(sec)
    return bytes(out)


def vm_tables(sea2):
    """VM 用到的 MAIN.EXE DGROUP 常數: 發言視窗表 DS:b814 (4 × 12 word)、視窗文字顏色 DS:b894"""
    ex = open(os.path.join(sea2, "MAIN.EXE"), "rb").read()
    img = ex[struct.unpack("<H", ex[8:10])[0] * 16:]
    DS = 0x38150
    w = lambda o: struct.unpack("<h", img[DS + o:DS + o + 2])[0]
    keys = ["x", "y", "w", "h", "faceX", "faceY", "u0c", "u0e", "textX", "textY", "textW", "textH"]
    wins = [{k: w(0xb814 + 0x18 * i + 2 * j) for j, k in enumerate(keys)} for i in range(4)]
    cs = lambda o: img[DS + o:img.index(0, DS + o)].hex()
    return {"windows": wins, "textColor": cs(0xb894), "seed0": struct.unpack("<I", img[DS + 0xb890:DS + 0xb894])[0]}


def main(sea2, assets):
    os.makedirs(os.path.join(assets, "scenario"), exist_ok=True)
    json.dump(vm_tables(sea2), open(os.path.join(assets, "scenario", "vm.json"), "w"), indent=1)
    rep = {}
    for k in range(7):
        orig, doc = convert(os.path.join(sea2, f"SNR{k}.DAT"))
        rb = rebuild(doc, orig)
        diff = [i for i in range(len(orig)) if orig[i] != rb[i]]
        n = sum(len(s["code"]) for c in doc["chapters"] if c for s in c["sections"] if s)
        bad = sum(1 for c in doc["chapters"] if c for s in c["sections"] if s for i in s["code"] if i["k"] == "bad")
        json.dump(doc, open(os.path.join(assets, "scenario", f"snr{k}.json"), "w", encoding="utf-8"), separators=(",", ":"))
        rep[f"SNR{k}"] = {"chapters": sum(1 for c in doc["chapters"] if c), "instructions": n, "bad": bad,
                          "roundtrip_diff_bytes": len(diff), "first_diff": hex(diff[0]) if diff else None}
    return rep


if __name__ == "__main__":
    print(json.dumps(main(sys.argv[1], sys.argv[2]), indent=1))
