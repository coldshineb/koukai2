"""
uw2lib - 大航海時代II (繁體中文 DOS 版) 資源格式庫
全部格式均由 MAIN.EXE 逆向分析得出（見 docs/RE_NOTES.md）。
"""
import struct
import numpy as np

# ---------------------------------------------------------------------------
# LS10 / LS11 壓縮包 (光榮通用)
#   0x000  "LS10"/"LS11" + 12 bytes 0
#   0x010  256 bytes 字典
#   0x110  檔案表: {u32be 壓縮長, u32be 原長, u32be 偏移} * N, 以壓縮長=0 結束
#   資料: 位元流, 變長碼 code = bits(n+1) + 2^(n+1) - 2 (n = 前導 1 的個數)
#         code < 256 -> 輸出 dict[code]; 否則 距離 = code-256, 長度 = 下一碼 + 3
# ---------------------------------------------------------------------------
class _Bits:
    __slots__ = ("b", "p")
    def __init__(self, b, pos):
        self.b = b; self.p = pos * 8
    def bit(self):
        v = (self.b[self.p >> 3] >> (7 - (self.p & 7))) & 1
        self.p += 1
        return v
    def bits(self, n):
        v = 0
        for _ in range(n):
            v = (v << 1) | self.bit()
        return v

def _code(bs):
    n = 0
    while bs.bit():
        n += 1
    return bs.bits(n + 1) + (1 << (n + 1)) - 2

def ls_entries(b):
    p = 0x110; out = []
    while True:
        c, u, o = struct.unpack(">III", b[p:p + 12])
        if c == 0:
            break
        out.append((c, u, o)); p += 12
    return out

def ls_decode(b, dic, off, clen, ulen):
    if clen == ulen:
        return bytes(b[off:off + ulen])
    bs = _Bits(b, off); out = bytearray()
    while len(out) < ulen:
        c = _code(bs)
        if c < 256:
            out.append(dic[c])
        else:
            d = c - 256; n = _code(bs) + 3
            for _ in range(n):
                out.append(out[-d])
    return bytes(out[:ulen])

def ls_unpack(b):
    assert b[:3] == b"LS1", "not an LS10/LS11 archive"
    dic = b[16:272]
    return [ls_decode(b, dic, o, c, u) for c, u, o in ls_entries(b)]

# ---------------------------------------------------------------------------
# 平面圖形 (VGA 16 色 planar, 640x400, 每行 80 bytes)
#   "byte": 每 8 像素依序存 plane0..planeN-1 各 1 byte (通用 PUT 例程 seg0:02a7)
#   "seq" : 整塊先存 plane0 全部, 再 plane1 ... (港口圖塊 PORTCHIP)
# ---------------------------------------------------------------------------
def planar(data, w, h, nplanes, mode):
    a = np.frombuffer(data, np.uint8)
    bpr = w // 8
    idx = np.zeros((h, w), np.uint8)
    for pl in range(nplanes):
        if mode == "seq":
            plane = a[pl * bpr * h:(pl + 1) * bpr * h].reshape(h, bpr)
        elif mode == "row":
            plane = a[:h * bpr * nplanes].reshape(h, nplanes, bpr)[:, pl, :]
        elif mode == "byte":
            plane = a[:h * bpr * nplanes].reshape(h, bpr, nplanes)[:, :, pl]
        else:
            raise ValueError(mode)
        idx |= (np.unpackbits(plane, axis=1) << pl).astype(np.uint8)
    return idx

# ---------------------------------------------------------------------------
# 調色盤: 每色 3 bytes, 4bit/通道, 存放順序 (B, R, G) — seg0:159b set_palette
#   DAC: R=b1*4, G=b2*4, B=b0*4 (6bit) -> 8bit: (v<<2)|(v>>4)
# ---------------------------------------------------------------------------
def dac8(v4):
    v6 = v4 * 4
    return (v6 << 2) | (v6 >> 4)

def palette_rgb(raw):
    return [(dac8(raw[i * 3 + 1]), dac8(raw[i * 3 + 2]), dac8(raw[i * 3])) for i in range(len(raw) // 3)]

# ---------------------------------------------------------------------------
# 字型 1.pat / 2.pat: 14x14 點陣, 每字 28 bytes (每行 2 bytes), 每 18 字補齊 512 bytes
#   glyph_offset(n) = (n-1)*28 + ((n-1)//18)*8      (MAIN.EXE seg0:46e0)
#   字碼 -> 字序                                  (MAIN.EXE seg0:4554)
# ---------------------------------------------------------------------------
def _tidx(T):
    if 0x30 <= T <= 0x39: return T - 0x30
    if 0x41 <= T <= 0x5a: return T - 0x41 + 10
    if 0x61 <= T <= 0x7a: return T - 0x61 + 36
    if 0x80 <= T <= 0xfd: return T - 0x80 + 62
    return None

def code_to_glyph(code):
    """返回 (font_no, n), n 為 1 起算字序; 無效碼返回 None (遊戲改顯示 0x2228)"""
    L = code >> 8; T = code & 0xff
    if 0x8130 <= code <= 0xaf68:
        if L == 0x82:
            return (1, T - 0xa0 + 0xeb) if 0xa0 <= T <= 0xf3 else None
        t = _tidx(T)
        if t is None: return None
        if L == 0x81: return (1, t + 1)
        if L >= 0x92: return (1, (L - 0x92) * 188 + 591 + t)
        if L == 0x91: return None  # 原程式此處會溢位, 遊戲資料中不使用
        return (1, (L - 0x81) * 188 + 591 + t)
    if 0xb030 <= code <= 0xd8c3:
        t = _tidx(T)
        if t is None: return None
        return (2, (L - 0xb0) * 188 + t + 1)
    return None

def glyph_offset(n):
    return (n - 1) * 28 + ((n - 1) // 18) * 8

def glyph_bits(fontdata, n):
    o = glyph_offset(n)
    return np.unpackbits(np.frombuffer(fontdata[o:o + 28], np.uint8)).reshape(14, 16)

def glyph_count(fontdata):
    return (len(fontdata) // 512) * 18 + (len(fontdata) % 512) // 28
