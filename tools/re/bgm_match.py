"""BGM 對齊: 以 fm_songs.json 的音符合成正弦波旋律, 與 PS 版 mp3 比對旋律, 產生得分矩陣與最佳對應。
需要 numpy 與 ffmpeg (ffmpeg-python)。本機沒有 ffmpeg 時可在雲端執行: 先把 mp3、fm_songs.json 複製過去,
exec 前設定全域 MP3_DIR / FM_JSON / OUT_JSON (預設為專案內路徑)。輸出 OUT_JSON (預設 tools/work/bgm_match.json)。

共同前處理:
  FM 曲: 依 FMDRV 時間 (tempo_map) 把第一遍的每個音合成為正弦波 (+2 倍頻諧波 0.3), 振幅依 音色載波 TL + 音量衰減
         (TL 每級 0.75 dB, 音量 v 使 TL += v/2), 簡單包絡; F7 滑音照做。只取前 QUERY_MAX 秒 (75 秒)。
  mp3:   ffmpeg 解碼為 11025 Hz 單聲道, 取前 REF_MAX 秒 (300 秒)。
  chroma: STFT 4096 點, 80..3000 Hz 依音高類別加總 (靠近半音中心的頻格權重大), log 壓縮, 3 格平滑。
方法 A (dtw): hop 2048 (0.186 秒), L2 正規化; 子序列 DTW (查詢 = FM, 參考 = mp3 任意區段), 步進 (1,1)(2,1)(1,2)
         → 速度比 0.5..2; 成本 1 − cos, 12 個移調取最小; 距離 = 路徑成本 / 查詢長度 (越小越像)。
方法 B (rigid, 主要依據): hop 1024 (0.093 秒), 每格減去平均後正規化 (隨機 ≈ 0); 對 49 個固定速度比 (0.5..2 等比)
         把 FM chroma 伸縮, 以 FFT 同時對「時間位移 × 12 個移調」做互相關, 取 重疊 ≥ 90% 的最大平均 cos (越大越像)。
         兩邊都是固定速度的音序器演奏, 正確對應會在單一速度比/移調下整段吻合, 比 DTW 更有鑑別力。
方法 C (half): 把 FM 查詢切成前後兩半, 各自用方法 B 找最佳 mp3; 兩半結果相同、速度比/移調一致 → 可信。
方法 D (jingle): FM #12 (2.8 秒勝利短曲) 與 PS 的兩首短曲 (#12 1.7 秒、#13 2.9 秒) 頭尾對齊比較
         (去掉前後靜音後各重取樣成 48 格, 12 個移調的平均相關 / 全域 DTW)。短曲在長曲中隨處都能找到相似和弦終止, 不參與 A/B 的排名。
"""
import os, json, math
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
g = globals()
MP3_DIR = g.get("MP3_DIR") or os.path.join(ROOT, "web", "bgm")
FM_JSON = g.get("FM_JSON") or os.path.join(ROOT, "web", "assets", "data", "fm_songs.json")
OUT_JSON = g.get("OUT_JSON") or os.path.join(ROOT, "tools", "work", "bgm_match.json")
SR = 11025
NFFT = 4096
QUERY_MAX = g.get("QUERY_MAX", 75.0)
REF_MAX = g.get("REF_MAX", 300.0)
PIT_HZ = 1193182 / 4096
JINGLES = ("ps1_12.mp3", "ps1_13.mp3")
RATIOS = np.geomspace(0.5, 2.0, 49)
NAMES = "C C# D D# E F F# G G# A A# B".split()


def tick_seconds(tempo_map):
    """tick → 秒 (FMDRV: 每 tick 65536/(291.304×速度×180) 秒)"""
    tm = sorted(tempo_map)
    def f(t):
        s, pt, pv = 0.0, 0, 120
        for tt, v in tm:
            if tt > t:
                break
            s += (tt - pt) * 65536 / (PIT_HZ * pv * 180); pt, pv = tt, v
        return s + (t - pt) * 65536 / (PIT_HZ * pv * 180)
    return f


def synth_fm(song, insts, max_sec=QUERY_MAX, only_ch=None):
    f = tick_seconds(song["tempo_map"])
    total = min(f(song["check"]["pass1_ticks"][0]), max_sec)
    n = int(total * SR) + SR
    y = np.zeros(n, np.float32)
    for c in song["channels"]:
        if not c or (only_ch is not None and c["ch"] not in only_ch):
            continue
        for (t0, ln, key, hz, inst, vol, bend, flag) in c["notes"]:
            if flag == "drum" or not hz:
                continue
            s0 = f(t0)
            if s0 >= total:
                continue
            s1 = min(f(t0 + max(ln, 1)), total)
            a, b = int(s0 * SR), int(s1 * SR)
            if b <= a:
                continue
            tl = (insts.get(inst, {}).get("carTL", 0) or 0) + (vol or 0) / 2
            amp = 10 ** (-0.75 * tl / 20)
            tt = np.arange(b - a) / SR
            if bend:                                      # F7 滑音: 在 bend[1] tick 内滑到 ±bend[0] 半音
                bd = max(f(t0 + bend[1]) - s0, 1e-3)
                ratio = 2 ** (bend[0] / 12 * np.clip(tt / bd, 0, 1))
                ph = 2 * np.pi * hz * np.cumsum(ratio) / SR
            else:
                ph = 2 * np.pi * hz * tt
            env = np.minimum(1, tt / 0.01) * (0.6 + 0.4 * np.exp(-tt / 0.3))
            rel = np.minimum(1, (tt[-1] - tt) / 0.02 + 1e-9) if len(tt) > 1 else 1
            y[a:b] += (amp * env * rel * (np.sin(ph) + 0.3 * np.sin(2 * ph))).astype(np.float32)
    m = np.abs(y).max()
    return (y / m if m > 0 else y)[:int(total * SR)]


def decode_mp3(path, max_sec=REF_MAX):
    """ffmpeg 解碼為 11025 Hz 單聲道 (經暫存 wav; 雲端的 ffmpeg 沒有 s16le 原始格式)"""
    import ffmpeg, wave, tempfile
    tmp = os.path.join(tempfile.gettempdir(), "bgm_match_tmp.wav")
    (ffmpeg.input(path, t=max_sec).output(tmp, format="wav", acodec="pcm_s16le", ac=1, ar=SR)
     .overwrite_output().run(capture_stdout=True, capture_stderr=True))
    w = wave.open(tmp); raw = w.readframes(w.getnframes()); w.close()
    os.remove(tmp)
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768


_W = None


def chroma_raw(y, hop):
    global _W
    if _W is None:
        fr = np.fft.rfftfreq(NFFT, 1 / SR)
        W = np.zeros((12, len(fr)), np.float32)
        midi = 69 + 12 * np.log2(np.maximum(fr, 1) / 440)
        for k in np.nonzero((fr >= 80) & (fr <= 3000))[0]:
            m = midi[k]
            W[int(np.round(m)) % 12, k] += max(0.0, 1 - abs(m - np.round(m)) * 2)
        _W = W
    if len(y) < NFFT:
        y = np.pad(y, (0, NFFT - len(y)))
    win = np.hanning(NFFT).astype(np.float32)
    nfr = 1 + (len(y) - NFFT) // hop
    out = np.empty((nfr, 12), np.float32)
    for a in range(0, nfr, 512):                           # 分批, 省内存
        idx = np.arange(NFFT)[None, :] + hop * np.arange(a, min(nfr, a + 512))[:, None]
        out[a:a + len(idx)] = np.abs(np.fft.rfft(y[idx] * win, axis=1)).astype(np.float32) @ _W.T
    C = np.log1p(100 * out / (out.max() + 1e-9))
    k = np.ones(3) / 3
    C = np.stack([np.convolve(C[:, i], k, mode="same") for i in range(12)], 1)
    return C, np.linalg.norm(C, axis=1)


def chroma_dtw(y):
    C, e = chroma_raw(y, 2048)
    return C / np.maximum(e[:, None], 1e-6), e


def chroma_rigid(y, hop=1024):
    C, e = chroma_raw(y, hop)
    C = C - C.mean(1, keepdims=True)
    C /= np.maximum(np.linalg.norm(C, axis=1, keepdims=True), 1e-6)
    C[e < 1e-3 * (e.max() + 1e-9)] = 0                     # 静音格
    return C


def subseq_dtw(Q, R):
    """方法 A。回傳 (平均成本, 移調, 起點格, 終點格, 速度比)"""
    N, M = len(Q), len(R)
    res = []
    for sh in range(12):
        C = 1 - np.roll(Q, sh, axis=1) @ R.T
        INF = 1e9
        D = np.full((N, M), INF, np.float32); S = np.zeros((N, M), np.int32)
        D[0] = C[0]; S[0] = np.arange(M)
        for i in range(1, N):
            c1 = np.full(M, INF, np.float32); c1[1:] = D[i - 1, :-1]; s1 = np.zeros(M, np.int32); s1[1:] = S[i - 1, :-1]
            c2 = np.full(M, INF, np.float32); s2 = np.zeros(M, np.int32)
            if i >= 2:
                c2[1:] = D[i - 2, :-1] + C[i - 1, 1:]; s2[1:] = S[i - 2, :-1]
            c3 = np.full(M, INF, np.float32); c3[2:] = D[i - 1, :-2] + C[i, 1:-1]; s3 = np.zeros(M, np.int32); s3[2:] = S[i - 1, :-2]
            st = np.stack([c1, c2, c3]); a = st.argmin(0)
            D[i] = C[i] + st[a, np.arange(M)]
            S[i] = np.choose(a, [s1, s2, s3])
        j = int(D[-1].argmin())
        res.append((float(D[-1, j]) / N, sh, int(S[-1, j]), j))
    cost, sh, j0, j = min(res)
    return cost, sh, j0, j, (j - j0 + 1) / N


def rigid(Q, R, fps, ratios=RATIOS, min_ov=0.9):
    """方法 B。回傳 (最大平均 cos, {速度比, 參考起點秒, 移調 (PS = FM + 移調 半音)})"""
    N, M = len(Q), len(R)
    best = (-9.0, None)
    ones_r = (np.abs(R).sum(1) > 0).astype(float)
    cache = {}
    for r in ratios:
        Nr = max(4, int(round(N * r)))
        q = Q[np.minimum((np.arange(Nr) / r).astype(int), N - 1)]
        L = 1 << int(np.ceil(np.log2(Nr + M)))
        if L not in cache:
            cache[L] = (np.fft.fft(np.fft.fft(R, n=L, axis=0), axis=1), np.fft.fft(ones_r, n=L))
        Rr, Fo = cache[L]
        qt = np.fft.fft(q[::-1], n=L, axis=0)                  # 时间: 反转后卷积 = 互相关
        qtp = np.conj(np.fft.fft(np.conj(qt), axis=1))         # 音高: 循环互相关
        X = np.real(np.fft.ifft(np.fft.ifft(qtp * Rr, axis=1), axis=0))
        ones_q = (np.abs(q).sum(1) > 0).astype(float)
        ov = np.real(np.fft.ifft(np.fft.fft(ones_q[::-1], n=L) * Fo))
        ok = ov >= max(min_ov * min(ones_q.sum(), ones_r.sum()), 3)
        sc = np.where(ok[:, None], X / np.maximum(ov[:, None], 1), -9)
        k = np.unravel_index(sc.argmax(), sc.shape)
        if sc.max() > best[0]:
            best = (float(sc.max()), {"ratio": round(float(r), 4), "ref_start": round(float((k[0] - (Nr - 1)) / fps), 2),
                                      "shift": int(k[1])})
    return best


def jingle_cmp(y_fm, y_ps):
    """方法 D: 頭尾對齊比較 (回傳 平均相關最大值/移調, 全域 DTW 最小值/移調)"""
    def tc(y):
        C, e = chroma_raw(y, 256)
        keep = np.nonzero(e > 0.2 * e.max())[0]
        C = C[keep[0]:keep[-1] + 1]
        C = C - C.mean(1, keepdims=True); C /= np.maximum(np.linalg.norm(C, axis=1, keepdims=True), 1e-6)
        return C[np.round(np.linspace(0, len(C) - 1, 48)).astype(int)], len(C) * 256 / SR
    a, la = tc(y_fm); b, lb = tc(y_ps)
    corr = [float((a * np.roll(b, -sh, axis=1)).sum(1).mean()) for sh in range(12)]
    def gdtw(A, B):
        Cm = 1 - A @ B.T; N, M = Cm.shape; D = np.full((N + 1, M + 1), 1e9); D[0, 0] = 0
        for i in range(1, N + 1):
            for j in range(1, M + 1):
                D[i, j] = Cm[i - 1, j - 1] + min(D[i - 1, j - 1], D[i - 1, j], D[i, j - 1])
        return D[N, M] / (N + M)
    dt = [gdtw(a, np.roll(b, -sh, axis=1)) for sh in range(12)]
    return {"fm_sec": round(la, 2), "ps_sec": round(lb, 2), "corr": round(max(corr), 3), "corr_shift": int(np.argmax(corr)),
            "dtw": round(min(dt), 3), "dtw_shift": int(np.argmin(dt)), "corr_by_shift": [round(c, 3) for c in corr]}


def main(do_dtw=True):
    fm = json.load(open(FM_JSON, encoding="utf-8"))
    d2 = next(f for f in fm["files"] if f["name"] == "D2.MML")
    insts = {i["off"]: i for i in d2["blob"]["instruments"]}
    mp3s = sorted(x for x in os.listdir(MP3_DIR) if x.lower().endswith(".mp3"))
    fA, fB = SR / 2048, SR / 1024
    ref, y_ps = {}, {}
    for m in mp3s:
        y = decode_mp3(os.path.join(MP3_DIR, m))
        ref[m] = {"A": chroma_dtw(y)[0], "B": chroma_rigid(y), "sec": len(y) / SR}
        if m in JINGLES:
            y_ps[m] = y[:SR * 20]
        print("mp3", m, round(len(y) / SR, 1), "秒")
    out = {"method": __doc__, "mp3": {m: {"sec": round(r["sec"], 2)} for m, r in ref.items()}, "songs": []}
    for s in d2["sim"]:
        y = synth_fm(s, insts)
        row = {"no": s["no"], "query_sec": round(len(y) / SR, 2), "pass1_sec": s["seconds_pass1"], "dtw": {}, "rigid": {}}
        QB = chroma_rigid(y)
        for m, r in ref.items():
            sc, info = rigid(QB, r["B"], fB)
            row["rigid"][m] = dict(score=round(sc, 4), **info)
        if do_dtw:
            QA, e = chroma_dtw(y)
            QA = QA[e > 1e-3] if (e > 1e-3).sum() > 4 else QA
            for m, r in ref.items():
                cost, sh, j0, j1, slope = subseq_dtw(QA, r["A"])
                row["dtw"][m] = {"dist": round(cost, 4), "shift": sh, "ref_start": round(j0 / fA, 1), "tempo_ratio": round(slope, 3)}
        cand = [m for m in mp3s if m not in JINGLES]
        rk = sorted(cand, key=lambda m: -row["rigid"][m]["score"])
        row["rigid_rank"] = [[m, row["rigid"][m]["score"]] for m in rk[:5]]
        row["rigid_margin"] = round(row["rigid"][rk[0]]["score"] - row["rigid"][rk[1]]["score"], 4)
        if do_dtw:
            rd = sorted(cand, key=lambda m: row["dtw"][m]["dist"])
            row["dtw_rank"] = [[m, row["dtw"][m]["dist"]] for m in rd[:5]]
        N = len(QB); h = N // 2; halves = {}
        for part, (a, b) in (("A", (0, h)), ("B", (h, N))):
            sc = {m: rigid(QB[a:b], ref[m]["B"], fB) for m in cand}
            top = sorted(sc, key=lambda m: -sc[m][0])
            halves[part] = {"best": top[0], "score": round(sc[top[0]][0], 4), **sc[top[0]][1],
                            "second": top[1], "second_score": round(sc[top[1]][0], 4)}
        row["halves"] = halves
        row["halves_agree"] = halves["A"]["best"] == halves["B"]["best"] == rk[0]
        if s["no"] == 12:
            row["jingle"] = {m: jingle_cmp(y, y_ps[m]) for m in JINGLES}
        out["songs"].append(row)
        print(f"FM #{s['no']:2d}: rigid " + "  ".join(f"{m[4:6]}={v:.3f}" for m, v in row["rigid_rank"][:3]) +
              f" | 兩半 {halves['A']['best'][4:6]}/{halves['B']['best'][4:6]}" +
              (f" | dtw {row['dtw_rank'][0][0][4:6]}" if do_dtw else "") +
              (f" | 短曲 " + ", ".join(f"{m[4:6]}: corr {v['corr']} sh{v['corr_shift']} dtw {v['dtw']} sh{v['dtw_shift']}" for m, v in row["jingle"].items()) if "jingle" in row else ""))
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    json.dump(out, open(OUT_JSON, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return out


if __name__ == "__main__":
    main()
