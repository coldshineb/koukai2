r"""cycle_fit.py — 執行速度耗時模型的擬合 (RE_NOTES 第 32.6 節): 量測資料 → web/src/core/cpucost_table.js
資料: tools/work/cycle_dataset.npz (各路線 cycle_measure.js (S.CM.features = 1) + 路線 + port_tests.js + cycle_collect.js 的輸出合併;
  最初 11 條路線的收集腳本沒有留下, 之後的路線以 --add 加入, 收集方式見 RE_NOTES 32.8)
  X[段, 特徵] = 移植版每段裡各方法的呼叫次數 / 工作量 (名稱 "類別.方法", 加 "#a" = 面積, "#p" = 長度, "!" = 軟體游標畫/擦),
  y[段] = 原版同一段的週期數 (DOSBox 0.72 core=normal 規則, tools/emu/cycles.js), RT[段] = 路線名。
模型: y ≈ X·w, w ≥ 0; 加權最小平方 (權重 1/√(y + 30000)); 「每次呼叫的固定係數」上限 CAP 週期, 只有 WHITELIST 例外
  (只出現幾次的小函式不能代替別處的花費; 整畫面 / 載入 / 固定大小的動畫才是一次呼叫很貴)。
解法: 有上下界的最小平方 (法方程式上的座標下降), 收斂到相對改善 < 1e-10。
用法: python tools/emu/cycle_fit.py            擬合 → tools/work/cycle_fit.json、web/src/core/cpucost_table.js, 並印出各路線 / 各場景的誤差
      python tools/emu/cycle_fit.py --report   只用目前的 cycle_fit.json 印誤差
      python tools/emu/cycle_fit.py --add a.json b.json ...   把 cycle_collect.js 的輸出 (路線名 = 檔內 route) 併入資料集 (依特徵名對齊;
                                               原資料集先另存為 cycle_dataset_<段數>.npz), 之後照常擬合"""
import os, sys, json
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
WORK = os.path.join(ROOT, "tools", "work")
DATA = os.path.join(WORK, "cycle_dataset.npz")
OUT_JSON = os.path.join(WORK, "cycle_fit.json")
OUT_JS = os.path.join(ROOT, "web", "src", "core", "cpucost_table.js")
CAP = 15000
# 每次调用可以很贵的方法: 进港、出海、换图档、标题、新游戏各画面、头像、数据表画面、战后、结束处理、固定大小的画面动画
WHITELIST = {
    "PortScene.enter", "SeaScene.enterSea", "SeaScene.decodeRegion", "SeaScene.seaPanel", "SeaScene.sprite", "Graph.useFile",
    "Title.titleMenu", "NewGame.drawPortraits", "NewGame.info", "NewGame.confirm", "Kao.blit3", "Kao.drawNamed", "Kao.drawComposed",
    "Buildings.table", "Buildings.shipData", "Commands.press", "Commands.release", "NavalBattle.after", "NavalBattle.allyCells",
    "NavalBattle.markTargets", "GameClock.ending",
    "SeaScene.item=",          # 849a 换 WORLDMAP 项 (海上跨过分区时加载并解压下一项; 32.9)
    "Buildings.wipe",          # seg0:2260 出航前的逐点擦除 (栏 12..59 × 384 行 × 16 步, 开着动画选项时), 约 246 万周期 (32.8)
}

# 单独量测的系数 (数据集里没有、或只有一两段无法拟合的项目), 拟合后直接写入: 名称 → (周期, 来源)
FIXED = {
    "SeaScene.item=": (5312760.0, "32.9: 里斯本出港向西 (tools/emu/cycle_realtime.js 同一路線的測試模式, 每 400 次輸入查詢一個空動作),"
                                  " 跨過 x = 0 換到 WORLDMAP 第 2 項那一段原版 5779612 週期, 減去記帳表對同一段的預測 466852"),
}


def is_fixed(n):
    return not (n.endswith("#a") or n.endswith("#p") or n.endswith("!"))


def load():
    z = np.load(DATA, allow_pickle=True)
    return z["X"].astype(np.float64), z["y"].astype(np.float64), z["RT"].astype(str), [str(n) for n in z["names"]]


def bvls(X, y, ub, sweeps=20000, tol=1e-10):
    s = 1.0 / np.sqrt(y + 30000.0)
    Xs = X * s[:, None]; ys = y * s
    G = Xs.T @ Xs; b = Xs.T @ ys
    n = len(b); w = np.zeros(n); g = -b.copy()          # g = G w − b
    d = np.diag(G).copy(); act = np.where(d > 0)[0]
    f0 = None
    for it in range(sweeps):
        for j in act:
            nw = min(max(w[j] - g[j] / d[j], 0.0), ub[j])
            if nw != w[j]:
                g += G[:, j] * (nw - w[j]); w[j] = nw
        if it % 20 == 19:
            f = 0.5 * w @ (g + b) - b @ w                 # 0.5 wᵀGw − bᵀw (Gw = g + b)
            if f0 is not None and abs(f0 - f) <= tol * abs(f):
                break
            f0 = f
    return w


def table_js(names, w):
    rows = {}
    for n, v in zip(names, w):
        if round(float(v), 2) <= 0:
            continue
        key = "n"
        if n.endswith("#a"): key, n = "a", n[:-2]
        elif n.endswith("#p"): key, n = "p", n[:-2]
        elif n.endswith("!"): key, n = "t", n[:-1]
        cls, m = n.split(".", 1)
        rows.setdefault((cls, m), {})[key] = round(float(v), 2)
    out = ["// cpucost_table.js — 由 tools/emu/cycle_fit.py 依量測資料擬合產生 (RE_NOTES 第 32 節); 請勿手改",
           "// 每項 [類別, 方法, {n: 每次呼叫的週期, a: 每單位工作量 (面積) 的週期, p: 每單位長度的週期, t: 軟體游標畫/擦一次的週期}]",
           "// 工作量的定義見 core/cpucost.js COST_FEATURES。量測: DOSBox 0.72 core=normal 的週期 (tools/emu/cycles.js), 11 條路線、47461 段。",
           "export const COST_TABLE = ["]
    for (cls, m) in sorted(rows):
        k = rows[(cls, m)]
        out.append(f'  ["{cls}", "{m}", {json.dumps({x: k[x] for x in "napt" if x in k}, separators=(",", ":"))}],')
    out.append("];")
    return "\n".join(out) + "\n"


def phases(X, y, RT, names):
    """每段的場景: 新遊戲 (每條路線的前 763 段: 標題 → 開始新航海)、港口、海上、海戰、其他"""
    pos = np.zeros(len(y), int)
    for r in np.unique(RT):
        ii = np.where(RT == r)[0]; pos[ii] = np.arange(len(ii))
    col = lambda k: X[:, names.index(k)]
    tag = np.where(pos < 763, "newgame", "other").astype(object)
    for r in np.unique(RT):
        ii = np.where(RT == r)[0]
        es = np.nonzero(col("SeaScene.enterSea")[ii])[0]; nb = np.nonzero(col("NavalBattle.run")[ii])[0]; na = np.nonzero(col("NavalBattle.after")[ii])[0]
        if len(es):
            tag[ii[763:es[0]]] = "port→depart"; tag[ii[es[0]:]] = "sea"
        if len(nb):
            tag[ii[nb[0]:(na[0] + 1 if len(na) else len(ii))]] = "battle"
    return tag, pos


def report(X, y, RT, names, w, label=""):
    P = X @ w; within = np.abs(P - y) <= 0.05 * y
    def line(m, name):
        E = y[m].sum(); Q = P[m].sum(); big = m & (y >= 5000)
        print(f"  {name:28s} {int(m.sum()):6d} 段  原版 {E / 10.5e6:7.2f} 秒  模型 {Q / 10.5e6:7.2f} 秒  誤差 {100 * (Q - E) / max(E, 1):+6.2f}%"
              f"  | ≥5000 週期的段 ±5% 內 {100 * within[big].mean() if big.any() else 0:5.1f}% (週期加權 {100 * (y * within)[big].sum() / max(y[big].sum(), 1):5.1f}%)")
    print(f"== {label}")
    for r in np.unique(RT):
        line(RT == r, r)
    tag, pos = phases(X, y, RT, names)
    for t in ["newgame", "port→depart", "sea", "battle", "other"]:
        line(tag == t, "[" + t + "]")
    # 海上每个时刻 (SeaScene.seaTick 之间)
    st = X[:, names.index("SeaScene.seaTick")]
    for r in ["sea0", "sea5idle"]:
        ii = np.where((RT == r) & (tag == "sea"))[0]; gs = []; cur = []
        for i in ii:
            if st[i] > 0 and cur: gs.append(cur); cur = []
            cur.append(i)
        if cur: gs.append(cur)
        e = np.array([y[g].sum() for g in gs[1:]]); q = np.array([P[g].sum() for g in gs[1:]]); rr = (q - e) / e
        print(f"  海上每個時刻 {r}: {len(e)} 個, 中位數 {100 * np.median(rr):+.2f}%, ±2% 內 {100 * (np.abs(rr) <= .02).mean():.0f}%, 範圍 {100 * rr.min():+.2f}%..{100 * rr.max():+.2f}%")
    return P


def add(paths):
    X, y, RT, names = load()
    np.savez_compressed(os.path.join(WORK, f"cycle_dataset_{len(y)}.npz"), X=X.astype(np.float32), y=y, RT=RT, names=np.array(names))
    idx = {n: i for i, n in enumerate(names)}
    blocks = []
    for p in paths:
        d = json.load(open(p, encoding="utf-8"))
        if d["route"] in set(RT):
            print("略過 (已在資料集裡):", d["route"]); continue
        for n in d["names"]:
            if n not in idx:
                idx[n] = len(names); names.append(n)
        blocks.append(d)
    X2 = np.zeros((len(y), len(names)), np.float32); X2[:, :X.shape[1]] = X
    xs, ys, rs = [X2], [y], [RT]
    for d in blocks:
        B = np.zeros((len(d["rows"]), len(names)), np.float32)
        for r, row in enumerate(d["rows"]):
            fv = row[3]
            for k in range(0, len(fv), 2):
                B[r, idx[d["names"][fv[k]]]] += fv[k + 1]
        xs.append(B); ys.append(np.array([row[0] for row in d["rows"]], float)); rs.append(np.array([d["route"]] * len(d["rows"])))
        print("加入", d["route"], len(d["rows"]), "段, 原版", round(ys[-1].sum() / 10.5e6, 2), "秒")
    np.savez_compressed(DATA, X=np.concatenate(xs), y=np.concatenate(ys), RT=np.concatenate(rs), names=np.array(names))


def main(argv):
    if argv[:1] == ["--add"]:
        add(argv[1:]); argv = []
    X, y, RT, names = load()
    if "--report" in argv:
        w = np.array(json.load(open(OUT_JSON, encoding="utf-8"))["w"]); report(X, y, RT, names, w, "cycle_fit.json"); return
    ub = np.array([np.inf if (not is_fixed(n) or n in WHITELIST) else CAP for n in names])
    w = bvls(X, y, ub)
    for n, (c, _) in FIXED.items():                      # 单独量测的系数
        if n not in names:
            names.append(n); X = np.hstack([X, np.zeros((len(y), 1))]); w = np.append(w, 0.0); ub = np.append(ub, np.inf)
        w[names.index(n)] = c
    wu = bvls(X, y, np.full(len(names), np.inf))
    for n, (c, _) in FIXED.items(): wu[names.index(n)] = c
    old = json.load(open(OUT_JSON, encoding="utf-8")) if os.path.exists(OUT_JSON) else None
    if old:
        ow = dict(zip(old["names"], old["w"])); report(X, y, RT, names, np.array([ow.get(n, 0.0) for n in names]), "舊的 cycle_fit.json")
    report(X, y, RT, names, w, "新擬合")
    json.dump({"names": names, "w": [float(v) for v in w], "w_uncapped": [float(v) for v in wu], "cap": CAP, "whitelist": sorted(WHITELIST)},
              open(OUT_JSON, "w", encoding="utf-8"), ensure_ascii=False)
    open(OUT_JS, "w", encoding="utf-8", newline="\n").write(table_js(names, w))
    print("非零項", int((w > 0).sum()), "→", OUT_JS)


if __name__ == "__main__":
    main(sys.argv[1:])
