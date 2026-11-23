r"""mml2json.py — KOEI「OPL-II Sound Driver 3.11」(FMDRV.COM) 樂曲資料 → JSON (可逆), 並依 FMDRV 的邏輯逐 tick 模擬。
用法: python tools/mml2json.py            → web/assets/data/fm_songs.json (D2.MML 22 曲 + OPEN.EXE / END.EXE 內嵌曲)
      exec 後可直接呼叫 parse_blob / simulate / encode_blob

== 資料格式 (依 FMDRV.COM 反組譯, 位址為 COM 載入後的 IP, 詳見 docs/RE_NOTES.md 第 23 節) ==
樂曲表: AH=00 以 ES:DX 登記資料起點 [0484]; 樂曲 n (1 起算) 的表項在 起點 + 10×(n−1), 5 個 u16:
        FM 聲部 1..4 與節奏聲部 (0 = 不使用), 各為「相對於該表項位址」的偏移 (02a2)。D2.MML 共 22 項 (220 bytes)。
FM 聲部命令 (0b92, 跳躍表 0b44):
  00..5F n L G     音符 n, 長度 L tick, 閘門 G tick (G=0 → 休止符; G>L → 連結/圓滑, 下個音不重新觸鍵)
  60..BF           音符 (b−60h), 沿用上一個 L, G
  C0..CF           無動作            D0  迴圈開始 (只有一層)     D1..DF  迴圈結束, 再跳回 (b&0F) 次 (共演奏 n+1 次)
  E0..ED x         略過 (本驅動不用)  EE x  AM 深度 (BD bit7)     EF x  VIB 深度 (BD bit6)
  F0 v             音量 (衰減量 0..127, 越大越小聲)              F1 p  速度 (OPN Timer-B 值 → 78125/(18·(256−p)))
  F2 t             速度 t (每分鐘四分音符數; 四分音符 = 48 tick)  F3 x  略過
  F4 w             音色 (資料位於 本命令位址 + w, 22 bytes)       F5/F6 x y  略過
  F7 s t           滑音: 下一個音在 t+1 tick 內往 s 半音 (有號, |s|≤12) 滑動
  F8 / F9          軟體 LFO 開 / 關    FA..FC 無動作   FD  迴圈最後一次時跳出   FE  全曲循環點   FF  聲部結束 (重播旗標開時跳回循環點)
節奏聲部命令 (0ecb, 跳躍表 0e8c): 00..7F = 鼓組遮罩 (bit0 HH,1 CYM,2 TOM,3 SD,4 BD; bit5 → 後跟長度; bit6 → 後跟音量),
  80..9F v 鼓組音量, A0..CF 無動作, D0..DF 迴圈, E0..EF x 略過, F0 v 音量, F1 x 略過, F2 t 速度, F3 x 略過, F4 w 節奏音色,
  F5..F7 x y 略過, F8..FC 無動作, FD/FE/FF 同 FM。
音高 (0bd2): k = n + 音色移調 (音色 byte 0Bh, 有號) + 全域移調; 八度 = k÷12 (0..7, 超過 7 鉗在 7), 半音 = k mod 12;
  F-Number 表 (0620): 157 16B 181 198 1B0 1CA 1E5 202 220 241 263 287 (C..B); 頻率 = F × 49716 / 2^(20−八度) → k=48 約 C4。
時間: IRQ0 291.304 Hz (PIT 4096 分頻), 每次累加 速度×180 (07fb), 16 位元溢位 = 1 tick → tick/秒 = 291.304×速度×180/65536。
  開始播放時速度 = 120 (02a2 → 07fb(78h))。每 tick 依序處理 FM 聲部 1..4 (0b6e) 與節奏聲部 (0eb6)。
  每聲部: 長度計數 −1, 到 0 時讀下一批命令直到音符; 否則閘門計數 −1, 到 0 時放開鍵。
"""
import os, sys, json, struct, math

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
SEA2 = os.path.join(HERE, "work", "sea2")
FNUM = [0x157, 0x16B, 0x181, 0x198, 0x1B0, 0x1CA, 0x1E5, 0x202, 0x220, 0x241, 0x263, 0x287]
PIT_HZ = 1193182 / 4096
INST_SIZE = 22

FM_LEN = {}
for b in range(0x60, 0x100):
    FM_LEN[b] = 1
for b in range(0xE0, 0xEE):
    FM_LEN[b] = 2
FM_LEN.update({0xEE: 2, 0xEF: 2, 0xF0: 2, 0xF1: 2, 0xF2: 2, 0xF3: 2, 0xF4: 3, 0xF5: 3, 0xF6: 3, 0xF7: 3})
RH_LEN = {}
for b in range(0x80, 0x100):
    RH_LEN[b] = 1
for b in range(0x80, 0xA0):
    RH_LEN[b] = 2
for b in range(0xE0, 0xF0):
    RH_LEN[b] = 2
RH_LEN.update({0xF0: 2, 0xF1: 2, 0xF2: 2, 0xF3: 2, 0xF4: 3, 0xF5: 3, 0xF6: 3, 0xF7: 3})


def s8(v):
    return v - 256 if v > 127 else v


def ev_len(d, p, kind):
    b = d[p]
    if kind == "fm":
        return 3 if b < 0x60 else FM_LEN[b]
    if b < 0x80:
        return 1 + (1 if b & 0x20 else 0) + (1 if b & 0x40 else 0)
    return RH_LEN[b]


def decode_ev(d, p, kind):
    """一個命令 → [位址, 原始 hex, 名稱, 參數...]"""
    n = ev_len(d, p, kind); raw = d[p:p + n]; b = raw[0]
    if kind == "fm":
        if b < 0x60:
            return [p, raw.hex(), "note", b, raw[1], raw[2]]
        if b < 0xC0:
            return [p, raw.hex(), "note", b - 0x60]
    else:
        if b < 0x80:
            q, a = 1, []
            if b & 0x20:
                a.append(["len", raw[q]]); q += 1
            if b & 0x40:
                a.append(["vol", raw[q]]); q += 1
            return [p, raw.hex(), "drum", b & 0x1F] + a
        if b < 0xA0:
            return [p, raw.hex(), "drumvol", b & 0x1F, raw[1]]
    if 0xC0 <= b < 0xD0 or (kind == "rh" and 0xA0 <= b < 0xD0) or 0xFA <= b <= 0xFC or (kind == "rh" and b in (0xF8, 0xF9)):
        return [p, raw.hex(), "nop"]
    if b == 0xD0:
        return [p, raw.hex(), "loop"]
    if 0xD1 <= b <= 0xDF:
        return [p, raw.hex(), "next", b & 0x0F]
    if 0xE0 <= b <= 0xED or (kind == "rh" and b in (0xEE, 0xEF)) or b == 0xF3 or (kind == "rh" and b == 0xF1):
        return [p, raw.hex(), "ign"] + list(raw[1:])
    if b == 0xEE:
        return [p, raw.hex(), "am", raw[1]]
    if b == 0xEF:
        return [p, raw.hex(), "vib", raw[1]]
    if b == 0xF0:
        return [p, raw.hex(), "vol", raw[1]]
    if b == 0xF1:
        return [p, raw.hex(), "tempoB", raw[1], tempo_b(raw[1])]
    if b == 0xF2:
        return [p, raw.hex(), "tempo", raw[1]]
    if b == 0xF4:
        w = struct.unpack("<H", raw[1:3])[0]
        return [p, raw.hex(), "inst", (p + w) & 0xFFFF]
    if b in (0xF5, 0xF6) or (kind == "rh" and b == 0xF7):
        return [p, raw.hex(), "ign"] + list(raw[1:])
    if b == 0xF7:
        return [p, raw.hex(), "bend", s8(raw[1]), raw[2]]
    if b == 0xF8:
        return [p, raw.hex(), "lfo_on"]
    if b == 0xF9:
        return [p, raw.hex(), "lfo_off"]
    if b == 0xFD:
        return [p, raw.hex(), "break"]
    if b == 0xFE:
        return [p, raw.hex(), "segno"]
    if b == 0xFF:
        return [p, raw.hex(), "end"]
    raise ValueError(f"unknown {b:02x} at {p:x}")


def tempo_b(p):
    return (78125 // (18 * (256 - p))) & 0xFF if p else (78125 // (18 * 256)) & 0xFF


def parse_stream(d, p, kind):
    """線性解碼到第一個 FF (迴圈/循環只會往回跳, FD 跳到迴圈結束之後, 都在這範圍內)"""
    evs = []
    while True:
        e = decode_ev(d, p, kind); evs.append(e); p += len(e[1]) // 2
        if e[2] == "end":
            return evs, p


def inst_info(d, o):
    r = d[o:o + INST_SIZE]
    return {"off": o, "hex": r.hex(), "mod20": r[0], "car23": r[1], "c0": r[2], "modTL": r[5] & 0x3F, "carTL": r[6] & 0x3F,
            "transpose": s8(r[11]), "connection": "add" if r[2] & 1 else "fm", "feedback": (r[2] >> 1) & 7,
            "lfo": {"speed": struct.unpack("<H", r[12:14])[0], "wave": r[14], "depth": s8(r[15]), "lfo_flag": r[21]}}


def parse_blob(d, nsongs, base=0, name="D2.MML"):
    """樂曲表在 d[base:], nsongs 項。回傳 dict (可逆: encode_blob 還原)"""
    songs, cover, insts = [], {}, {}
    for s in range(nsongs):
        e = base + 10 * s
        offs = struct.unpack("<5H", d[e:e + 10])
        chans = []
        for c, o in enumerate(offs):
            if not o:
                chans.append(None); continue
            kind = "fm" if c < 4 else "rh"
            p0 = (e + o) & 0xFFFF
            evs, p1 = parse_stream(d, p0, kind)
            for k in range(p0, p1):
                cover.setdefault(k, f"song{s + 1}.ch{c}")
            for ev in evs:
                if ev[2] == "inst":
                    insts[ev[3]] = inst_info(d, ev[3]) if kind == "fm" else {"off": ev[3], "hex": d[ev[3]:ev[3] + 22].hex(), "rhythm": True}
            chans.append({"ch": c, "kind": kind, "off": p0, "end": p1, "events": evs})
        songs.append({"no": s + 1, "table": e, "offsets": list(offs), "channels": chans})
    for o, i in insts.items():
        n = len(i["hex"]) // 2
        if i.get("rhythm"):
            n = 22
        for k in range(o, o + n):
            cover.setdefault(k, f"inst@{o:x}")
    lo = base + 10 * nsongs
    hi = max(cover) + 1 if cover else lo
    gaps, k = [], lo
    while k < hi:
        if k in cover:
            k += 1; continue
        j = k
        while j < hi and j not in cover:
            j += 1
        gaps.append({"off": k, "hex": d[k:j].hex()}); k = j
    return {"name": name, "base": base, "nsongs": nsongs, "end": hi, "songs": songs,
            "instruments": [insts[o] for o in sorted(insts)], "gaps": gaps}


def encode_blob(blob):
    """parse_blob 的逆運算: 由 JSON 重建原始位元組 (base..end)"""
    base, end = blob["base"], blob["end"]
    out = bytearray(end - base)
    def put(o, h):
        b = bytes.fromhex(h); out[o - base:o - base + len(b)] = b
    for s in blob["songs"]:
        put(s["table"], struct.pack("<5H", *s["offsets"]).hex())
        for c in s["channels"]:
            if c:
                for ev in c["events"]:
                    put(ev[0], ev[1])
    for i in blob["instruments"]:
        put(i["off"], i["hex"])
    for g in blob["gaps"]:
        put(g["off"], g["hex"])
    return bytes(out)


def key_freq(k):
    """0bd2..0c43: 音高 k (已含移調) → (記錄用音號, 八度, 半音, 頻率 Hz)"""
    if k < 0 or k > 255:
        o, s = 0, (k % 12)
    else:
        o, s = divmod(k, 12)
        if o > 7:
            o = 7
    f = FNUM[s] * 49716 / 2 ** (20 - o)
    return o, s, f


class Chan:
    def __init__(s, d, p, kind, inst_tr):
        s.d, s.p, s.kind, s.it = d, p, kind, inst_tr
        s.start = p; s.seg = p                      # [2] 循環點
        s.flags = 1; s.len = 0x30; s.gate = 0x2D; s.cnt = 1; s.gcnt = 0
        s.lcnt = 0; s.lstart = 0; s.lexit = 0
        s.tr = 0; s.vol = 0; s.inst = None; s.last = None; s.tie = False
        s.bend = None; s.key_on = False
        s.notes = []; s.cur = None
        s.passes = 0; s.seg_tick = None; s.end_ticks = []; s.done = False


def simulate(d, offs, base_tbl, passes=2, max_ticks=2_000_000, repeat=True):
    """依 FMDRV 逐 tick 模擬一首曲子。offs = 表項 5 個偏移, base_tbl = 表項位址。
    回傳每聲部的音符 (tick 起點, tick 長度, 音高 k, 頻率, 音色, 音量, 滑音) 與檢查資訊, 加上速度表。"""
    chans = []
    for c, o in enumerate(offs):
        chans.append(Chan(d, (base_tbl + o) & 0xFFFF, "fm" if c < 4 else "rh", 0) if o else None)
    tempo = 120; tempo_map = [(0, 120)]; tick = 0
    def tr_of(ch):
        return s8(d[ch.inst + 11]) if ch.inst is not None and ch.kind == "fm" else 0
    def close(ch, t):
        if ch.cur is not None:
            ch.cur[1] = t - ch.cur[0]; ch.notes.append(ch.cur); ch.cur = None
    def read(ch, t):
        nonlocal tempo
        p = ch.p
        while True:
            e = decode_ev(d, p, ch.kind); p += len(e[1]) // 2; op = e[2]
            if op == "note":
                n = e[3]
                if len(e) > 4:
                    ch.len, ch.gate = e[4], e[5]
                ch.cnt = ch.len or 256; ch.gcnt = ch.gate
                if ch.gate == 0:                                  # 休止符
                    close(ch, t); ch.last = None; ch.key_on = False
                else:
                    k = n + tr_of(ch) + ch.tr
                    o, sm, f = key_freq(k)
                    kk = k if 0 <= k <= 255 and k // 12 <= 7 else (o * 12 + sm)
                    if ch.tie and ch.last == kk and ch.cur is not None:
                        pass                                      # 0c1d: 同音連結, 不重新觸鍵
                    elif ch.tie and ch.cur is not None:
                        close(ch, t); ch.cur = [t, 0, kk, round(f, 3), ch.inst, ch.vol, ch.bend, "legato"]
                    else:
                        close(ch, t); ch.cur = [t, 0, kk, round(f, 3), ch.inst, ch.vol, ch.bend, ""]
                    ch.last = kk; ch.key_on = True; ch.bend = None
                ch.tie = ch.gate > ch.len
                ch.p = p; ch.flags &= ~1
                return
            if op == "drum":
                for a in e[4:]:
                    if a[0] == "len":
                        ch.len = a[1]
                ch.cnt = ch.len or 256
                if e[3]:
                    ch.notes.append([t, ch.len, e[3], 0, ch.inst, ch.vol, None, "drum"])
                ch.p = p; ch.flags &= ~1
                return
            if op == "loop":
                if ch.lstart == 0:
                    ch.lstart = p
            elif op == "next":
                if ch.lstart:
                    if ch.lcnt == 0:
                        ch.lcnt = e[3] + 1; ch.lexit = p
                    ch.lcnt -= 1
                    if ch.lcnt:
                        p = ch.lstart
                    else:
                        ch.lstart = 0
            elif op == "break":
                if ch.lcnt == 1:
                    ch.lcnt = 0; ch.lstart = 0; p = ch.lexit
            elif op == "segno":
                ch.seg = p; ch.seg_tick = t if ch.seg_tick is None else ch.seg_tick
            elif op == "end":
                close(ch, t); ch.key_on = False
                ch.end_ticks.append(t); ch.passes += 1
                if repeat and not (ch.flags & 1) and ch.passes < passes:
                    ch.len, ch.gate, ch.cnt, ch.gcnt, ch.lcnt, ch.lstart = 0x30, 0x2D, 1, 0, 0, 0
                    p = ch.seg; ch.tie = False; ch.last = None
                else:
                    ch.p = 0; ch.done = True; return
            elif op == "inst":
                ch.inst = e[3]
            elif op == "vol":
                ch.vol = e[3] & 0x7F
            elif op == "tempo":
                if e[3]:
                    tempo = e[3]; tempo_map.append((t, tempo))
            elif op == "tempoB":
                if e[4]:
                    tempo = e[4]; tempo_map.append((t, tempo))
            elif op == "bend":
                ch.bend = [e[3], e[4] + 1]
    while tick < max_ticks:
        alive = False
        for ch in chans:
            if ch is None or ch.done:
                continue
            alive = True
            ch.cnt -= 1
            if ch.cnt <= 0:
                read(ch, tick)
            elif ch.gcnt:
                ch.gcnt -= 1
                if ch.gcnt == 0 and ch.kind == "fm":
                    close(ch, tick); ch.key_on = False
        if not alive:
            break
        tick += 1
    # 時間換算
    def t2s(t):
        s, pt, pv = 0.0, 0, 120
        for (tt, v) in tempo_map:
            if tt >= t:
                break
            s += (tt - pt) / (PIT_HZ * pv * 180 / 65536); pt, pv = tt, v
        return s + (t - pt) / (PIT_HZ * pv * 180 / 65536)
    res = []
    for c, ch in enumerate(chans):
        if ch is None:
            res.append(None); continue
        res.append({"ch": c, "notes": ch.notes, "segno_tick": ch.seg_tick, "end_ticks": ch.end_ticks})
    return {"channels": res, "tempo_map": tempo_map, "ticks": tick, "t2s": t2s}


def song_check(sim):
    """FMDRV 邏輯驗證: 各聲部第一遍長度相同、循環段長度相同"""
    L = [c["end_ticks"] for c in sim["channels"] if c]
    first = [x[0] if x else None for x in L]
    loop = [(x[1] - x[0]) if len(x) > 1 else None for x in L]
    seg = [c["segno_tick"] for c in sim["channels"] if c]
    mx = max([x for x in loop if x] or [0])
    # 循環段長度可以不同, 只要都整除最長者 (例: D2 #1 第 3 聲部的 FE 在 D0 迴圈內, 重播時迴圈不再成立,
    # 只重複 192 tick 的迴圈本體; 第一遍是同一本體 ×8 = 1536, 音樂上仍同步)
    return {"pass1_ticks": first, "loop_ticks": loop, "segno_ticks": seg,
            "ok": len(set(first)) == 1 and all(x and mx % x == 0 for x in loop),
            "exact": len(set(first)) == 1 and len(set(loop)) == 1}


# OPEN.EXE / END.EXE 不讀 D2.MML, 樂曲資料內嵌於自己的 DGROUP (以 AH=00 登記, 位址 = 映像內線性位址; 映像從 EXE 標頭之後開始):
#   OPEN.EXE 08590: 1756(091a:0002) 登記 → 1 曲;  053eb: 4980(0) → AH=01 AL=1 (4980 送出 AL+1)
#   END.EXE  00ecb: 5ae2(0771:0002) 登記 → 2 曲;  01613: 359f(0) → 曲 1;  009b6: 359f(1) → 曲 2
EMBED = {"OPEN.EXE": (0x091a * 16 + 2, 1), "END.EXE": (0x0771 * 16 + 2, 2)}


def notes_json(blob, d, base):
    out = []
    for s in blob["songs"]:
        sim = simulate(d, s["offsets"], s["table"])
        chk = song_check(sim)
        t2s = sim["t2s"]
        chs = []
        for c in sim["channels"]:
            if not c:
                chs.append(None); continue
            p1c = c["end_ticks"][0] if c["end_ticks"] else 1 << 30
            chs.append({"ch": c["ch"], "notes": [[n[0], n[1], n[2], n[3], n[4], n[5], n[6], n[7]] for n in c["notes"] if n[0] < p1c]})
        p1 = chk["pass1_ticks"][0]; sg = chk["segno_ticks"][0]
        out.append({"no": s["no"], "check": chk, "tempo_map": sim["tempo_map"],
                    "seconds_pass1": round(t2s(p1), 3) if p1 is not None else None,
                    "seconds_segno": round(t2s(sg), 3) if sg is not None else None,
                    "seconds_loop": round(t2s(sim["channels"][0]["end_ticks"][1]) - t2s(p1), 3) if len(sim["channels"][0]["end_ticks"]) > 1 else None,
                    "channels": chs})
    return out


def build():
    d = open(os.path.join(SEA2, "D2.MML"), "rb").read()
    blob = parse_blob(d, 22, 0, "D2.MML")
    assert encode_blob(blob) == d[:blob["end"]], "D2.MML 還原不一致"
    res = {"note": "由 tools/mml2json.py 從 FMDRV.COM 樂曲資料解出 (格式見 docs/RE_NOTES.md 第 23 節)。"
                   "files[].blob 為逐命令原始資料 (events: [位址, 原始hex, 名稱, 參數...], 可由 encode_blob 逐位元組還原); "
                   "files[].sim 為依 FMDRV 邏輯逐 tick 模擬兩遍 (重播旗標開) 的檢查結果與第一遍的音符 (第二遍從 segno_tick 起重複; notes: [起點tick, 長度tick, 音高(48≈C4), 頻率Hz, 音色位址, 音量衰減, 滑音[半音,tick], 標記])。",
           "tick_hz_formula": "291.304 * tempo * 180 / 65536", "files": []}
    res["files"].append({"name": "D2.MML", "size": len(d), "blob": blob, "sim": notes_json(blob, d, 0)})
    for exe, (img, n) in EMBED.items():
        ex = open(os.path.join(SEA2, exe), "rb").read()
        hdr = struct.unpack("<H", ex[8:10])[0] * 16
        b = hdr + img
        blob = parse_blob(ex, n, b, exe)
        assert encode_blob(blob) == ex[b:blob["end"]], exe + " 還原不一致"
        res["files"].append({"name": exe, "file_off": b, "image_addr": img, "blob": blob, "sim": notes_json(blob, ex, b)})
    return res


if __name__ == "__main__":
    res = build()
    out = os.path.join(ROOT, "web", "assets", "data", "fm_songs.json")
    json.dump(res, open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    for f in res["files"]:
        print(f["name"], f.get("file_off", ""), "songs", len(f["sim"]))
        for s in f["sim"]:
            print(f"  #{s['no']:2d} ok={s['check']['ok']} pass1={s['check']['pass1_ticks']} loop={s['check']['loop_ticks']} "
                  f"segno={s['check']['segno_ticks']} {s['seconds_pass1']}s loop {s['seconds_loop']}s tempo={s['tempo_map'][:4]}")
    print("寫入", out, os.path.getsize(out))
