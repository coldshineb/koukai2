"""
build_charmap.py — 建立 原版字碼 <-> 字型字序 <-> Unicode 對照表
原理:
  1.pat 字序 1..684 為符號區, 對應 Big5 A140-A3BF + 倚天擴充符號 (①..⑩ ⑴..⑽ ⅰ..ⅹ, 部首, 控制符號)
        字序 685..6085 為 Big5 常用字 (A440-C67E) 的筆畫序, 但光榮重新排過少數字的位置
        字序 6086 為額外字 "碁"
  2.pat 字序 1..7650 為 Big5 次常用字 (C940-F9D5, 去除重複的 兀 嗀), 同樣有少數字移位
  移位用 GNU Unifont 做字形相似度比對, 再以分段偏移 Viterbi 求解 (見 RE_NOTES.md)。
  由於遊戲畫面一律以原版點陣字繪製, 本表只要求「雙向唯一」, 即可 100% 還原原始位元組。
輸入:  sea2/1.PAT sea2/2.PAT, downloads/unifont-15.1.05.hex.gz
輸出:  web/assets/font/charmap.json
"""
import gzip, json, numpy as np
from PIL import Image, ImageFilter

def run(SEA2, UNIFONT, OUT, uw2):
    F = {1: open(f"{SEA2}/1.PAT", "rb").read(), 2: open(f"{SEA2}/2.PAT", "rb").read()}
    N1 = uw2.glyph_count(F[1]); N2 = uw2.glyph_count(F[2])

    def rowcodes(L):
        return [(L << 8) | t for t in list(range(0x40, 0x7f)) + list(range(0xa1, 0xff))]
    def b5(c):
        for enc in ("big5hkscs", "cp950", "big5"):
            try: return bytes([c >> 8, c & 0xff]).decode(enc)
            except Exception: pass
        return None
    L1 = [b5(c) for L in range(0xa4, 0xc7) for c in rowcodes(L) if c <= 0xc67e]
    L2 = [b5(c) for L in range(0xc9, 0xfa) for c in rowcodes(L) if c <= 0xf9d5 and c not in (0xc94a, 0xddfc)]
    SYM = [b5(c) or "\u0000" for L in (0xa1, 0xa2, 0xa3) for c in rowcodes(L) if c <= 0xa3bf]
    SYM += [chr(c) for c in range(0x2460, 0x246a)] + [chr(c) for c in range(0x2474, 0x247e)]
    SYM += [chr(c) for c in range(0x2170, 0x217a)] + [chr(c) for c in range(0x2f00, 0x2fd6)]
    SYM += [chr(c) for c in range(0x2400, 0x2420)] + ["\u2421"]

    uni = {}
    for line in gzip.open(UNIFONT, "rt"):
        cp, h = line.strip().split(":")
        if len(h) == 64:
            uni[int(cp, 16)] = np.unpackbits(np.frombuffer(bytes.fromhex(h), np.uint8)).reshape(16, 16)
    zero = np.zeros((16, 16), np.uint8)

    def f_bbox(bits):
        im = Image.fromarray((bits * 255).astype(np.uint8)); bb = im.getbbox()
        if not bb: return np.zeros(144, np.float32)
        im = im.crop(bb).resize((12, 12), Image.BILINEAR).filter(ImageFilter.GaussianBlur(0.8))
        v = np.asarray(im, np.float32).ravel(); v -= v.mean(); n = np.linalg.norm(v)
        return v / n if n else v
    def f_full(bits, src14):
        a = bits.astype(np.float32)
        if src14: a = np.pad(a[:, :15], ((1, 1), (0, 1)))[:, :16]
        im = Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0)).resize((16, 16), Image.BILINEAR)
        v = np.asarray(im, np.float32).ravel(); v -= v.mean(); n = np.linalg.norm(v)
        return v / n if n else v
    def feat(bits, src14):
        return np.concatenate([f_bbox(bits) * 0.6, f_full(bits, src14) * 0.8])
    G = {f: np.array([feat(uw2.glyph_bits(F[f], n), True) for n in range(1, (N1 if f == 1 else N2) + 1)]) for f in (1, 2)}
    def U(chars): return np.array([feat(uni.get(ord(c), zero), False) for c in chars])

    def viterbi(Gm, Um, R=6, pen=4.0):
        n = len(Gm); K = 2 * R + 1
        E = np.full((n, K), -1.0)
        for k in range(K):
            d = k - R; lo = max(0, -d); hi = min(n, len(Um) - d)
            if hi > lo: E[lo:hi, k] = (Gm[lo:hi] * Um[lo + d:hi + d]).sum(1)
        S = E[0].copy(); BP = np.zeros((n, K), np.int16)
        tr = -pen * (np.abs(np.arange(K)[:, None] - np.arange(K)[None, :]) > 0)
        for i in range(1, n):
            M = S[:, None] + tr; BP[i] = M.argmax(0); S = M.max(0) + E[i]
        k = int(S.argmax()); path = [0] * n
        for i in range(n - 1, -1, -1):
            path[i] = k - R; k = BP[i, k]
        return path
    def assign(Gm, Um, path):
        # 以 Viterbi 路徑為先驗, 在 ±W 範圍內做全域貪婪一對一匹配 (可處理相鄰字對調)
        n, m = len(Gm), len(Um); W = 3
        pairs = []
        for i, d in enumerate(path):
            c = i + d
            for j in range(max(0, c - W), min(m, c + W + 1)):
                pairs.append((float(Gm[i] @ Um[j]) - 0.03 * abs(j - c), i, j))
        pairs.sort(reverse=True)
        a = [None] * n; used = set()
        for s, i, j in pairs:
            if a[i] is None and j not in used and s > 0.2: a[i] = j; used.add(j)
        fg = [i for i in range(n) if a[i] is None]; fc = [j for j in range(m) if j not in used]
        pairs = sorted(((float(Gm[i] @ Um[j]), i, j) for i in fg for j in fc), reverse=True)
        fg = set(fg); fc = set(fc)
        for s, i, j in pairs:
            if i in fg and j in fc: a[i] = j; fg.discard(i); fc.discard(j)
        return a

    glyph_uni = {}
    U1 = U(L1); a1 = assign(G[1][684:684 + len(L1) + 1], U1, viterbi(G[1][684:684 + len(L1) + 1], U1))
    for i, j in enumerate(a1):
        if j is not None: glyph_uni[(1, 685 + i)] = L1[j]
    U2 = U(L2); a2 = assign(G[2], U2, viterbi(G[2], U2))
    for i, j in enumerate(a2):
        if j is not None: glyph_uni[(2, 1 + i)] = L2[j]
    US = U(SYM); ps = viterbi(G[1][:684], US, R=4, pen=2.0)
    for n in range(1, 685):
        glyph_uni[(1, n)] = SYM[(n - 1) + ps[n - 1]] if 0 <= (n - 1) + ps[n - 1] < len(SYM) else chr(0xE000 + n)
    # 目視校正 (見 RE_NOTES.md)
    glyph_uni[(1, 4398)] = "銬"; glyph_uni[(1, 4399)] = "銀"
    glyph_uni[(1, 6086)] = "碁"
    glyph_uni[(2, 6646)] = "\uF100"; glyph_uni[(2, 7592)] = "\uF101"   # 罕用字, 未確定
    # 第二輪目視校正 (2026-11): 相鄰兩字形對調, 以「字形 vs Unifont 交叉相似度」篩出後逐一目視確認
    SWAP_CODES = [(0x9389, 0xAEFB), (0xA6DB, 0xA6DD), (0xA4AD, 0xA4AE), (0x9A72, 0x9A73), (0xA58D, 0xA58E), (0xCA72, 0xCA73), (0xA390, 0xA391), (0xBDA7, 0xBDA8), (0xBFFB, 0xBFFC), (0xD133, 0xD134), (0xCB6F, 0xCB70), (0xD831, 0xD832), (0xD3B2, 0xD3B4), (0xD072, 0xD073), (0xD283, 0xD284), (0xCC89, 0xCC8A), (0xD09E, 0xD0A0), (0xB0EC, 0xB0ED), (0xD34D, 0xD350), (0xD7EB, 0xD7ED)]
    for a, b in SWAP_CODES:
        ga, gb = uw2.code_to_glyph(a), uw2.code_to_glyph(b)
        glyph_uni[ga], glyph_uni[gb] = glyph_uni[gb], glyph_uni[ga]

    # 字碼表
    entries = {}
    for L in range(0x81, 0xd9):
        for T in range(0x30, 0xff):
            cd = (L << 8) | T; g = uw2.code_to_glyph(cd)
            if g and g in glyph_uni: entries[cd] = g
    # 每個字形選一個標準碼 (優先 0x81,0x82,>=0x92,>=0xb0 的碼)
    def pri(c): L = c >> 8; return (0 if (L <= 0x82 or L >= 0x92) else 1, c)
    canon = {}
    for cd in sorted(entries, key=pri): canon.setdefault(entries[cd], cd)
    u2c = {}; table = []
    for g, cd in sorted(canon.items(), key=lambda kv: kv[1]):
        u = glyph_uni[g]
        if u in u2c or u == "\u0000":   # 重複字形 -> 以私用區碼表示, 保證可逆
            u = chr(0xE000 + g[1]) if g[0] == 1 else chr(0xF0000 + g[1])
        u2c[u] = cd; table.append([cd, g[0], g[1], u])
    alias = {cd: canon[g] for cd, g in entries.items() if canon[g] != cd}
    json.dump({"format": "code,font,glyph,unicode", "table": table,
               "alias": {f"{k:04X}": f"{v:04X}" for k, v in sorted(alias.items())}},
              open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    return table, alias
