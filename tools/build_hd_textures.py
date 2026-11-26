"""build_hd_textures.py — 生成大航海时代 II HD-2D 港口 PBR 材质图集
为每个港口图集 (portchip_0..6) 与角色图集 (chars) 生成 4× 分辨率贴图：
  - portchip_{s}.png      : 高质感真彩漫反射贴图 (Albedo，保留锐利石砖/瓦片/木纹/草叶颗粒感)
  - portchip_{s}_nrm.png  : 切线空间凹凸法线 (RGB) + 物理高程遮挡高度 (A，用于实时斜向太阳投影)
  - portchip_{s}_mat.png  : 材质属性掩膜 (R=水体动态反射遮罩, G=夜景发光窗户/灯火, B=高光/湿润度, A=漫反射保留度)
  - chars.png / chars_nrm.png : 4× 清晰轮廓角色与法线高光贴图
"""
import json
import math
import os
from collections import deque
from PIL import Image
import numpy as np
from scipy.ndimage import binary_closing, binary_dilation, binary_fill_holes, gaussian_filter, label, sobel

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART_SHEETS = os.path.join(ROOT, "web", "assets", "art", "sheets")
HD_SHEETS = os.path.join(ROOT, "web", "assets", "art", "hd", "sheets")
PORTCHIP_JSON = os.path.join(ROOT, "web", "assets", "data", "portchip.json")
PORTMAP_JSON = os.path.join(ROOT, "web", "assets", "data", "portmap.json")

DAY_PAL_RAW = [
    0, 0, 0,   13, 0, 4,   0, 13, 4,   10, 13, 6,
    6, 0, 10,  15, 0, 10,  6, 15, 10,  13, 15, 14,
    9, 7, 7,   12, 0, 4,   0, 10, 6,   5, 14, 11,
    15, 0, 8,  6, 0, 7,    6, 0, 11,   13, 15, 14,
]

def dac8(v4: int) -> int:
    return round((v4 & 15) * 4 * 255 / 63)

DAY_PAL_RGB = np.array([
    (dac8(DAY_PAL_RAW[i * 3 + 1]), dac8(DAY_PAL_RAW[i * 3 + 2]), dac8(DAY_PAL_RAW[i * 3]))
    for i in range(16)
], dtype=np.uint8)

# 温润自然的现代物理色盘：抬升结构线至深炭棕、收敛过曝象牙白与荧光绿，与实时光影保持同一明度动态范围
MODERN_GROUND_PAL = np.array([
    [42, 36, 36],     # 0: 深暖炭褐结构线/地缝阴影
    [28, 82, 188],    # 1: 皇家钴蓝
    [184, 78, 30],    # 2: 暖红陶褐
    [186, 104, 150],  # 3: 紫粉
    [34, 140, 88],    # 4: 翠青
    [54, 152, 212],   # 5: 晴蓝
    [224, 152, 84],   # 6: 暖琥珀灯火/皮肤
    [214, 202, 180],  # 7: 暖石灰石膏
    [108, 112, 120],  # 8: 温润石灰青石灰
    [16, 66, 136],    # 9: 深港湾蓝
    [154, 108, 56],   # 10: 暖赭土/实木
    [204, 172, 112],  # 11: 暖砂岩/沙滩金
    [58, 134, 196],   # 12: 亮波蓝/窗玻璃
    [36, 98, 56],     # 13: 浓草地暗部/深林绿
    [62, 134, 68],    # 14: 自然日照草坪
    [222, 210, 188],  # 15: 暖白石膏高光
], dtype=np.float32)

MODERN_SPRITE_PAL = np.array([
    [26, 22, 28],     # 0: 沉稳轮廓描边
    [30, 86, 204],    # 1: 皇家蓝阴影
    [190, 82, 28],    # 2: 皮革棕红
    [196, 108, 156],  # 3: 玫瑰饰边
    [32, 154, 96],    # 4: 翠绿衣饰
    [52, 162, 228],   # 5: 亮海蓝外衣
    [234, 164, 102],  # 6: 暖肤色
    [230, 218, 198],  # 7: 象牙白衬衫
    [110, 114, 130],  # 8: 暖蓝灰阴影
    [26, 78, 178],    # 9: 深蓝
    [150, 92, 38],    # 10: 棕皮革/褐发
    [220, 178, 102],  # 11: 金发/暖高光
    [58, 140, 224],   # 12: 浅蓝
    [38, 112, 90],    # 13: 深绿
    [54, 158, 94],    # 14: 翠绿
    [234, 222, 202],  # 15: 亮象牙白
], dtype=np.float32)

# 建筑专用色盘：抬升黑色隙缝至暖深岩褐 [46, 40, 38] 以便实时阴影与天光渗入，压制 index 13 为氧化铜绿灰
MODERN_ARCH_PAL = MODERN_GROUND_PAL.copy()
MODERN_ARCH_PAL[0] = [46, 40, 38]
MODERN_ARCH_PAL[13] = [56, 74, 76]
MODERN_ARCH_PAL[14] = [64, 134, 88]

# 仅对“真正纯大面积平铺”的沙地/草坪/水体做棋盘格消噪，保留砖块与木门肌理
GROUND_DITHER_PAIRS = {
    (10, 11), (11, 10),
    (11, 15), (15, 11),
    (11, 7), (7, 11),
    (13, 14), (14, 13),
    (9, 12), (12, 9),
    (8, 15), (15, 8),
    (8, 7), (7, 8),
    (8, 11), (11, 8),
    (8, 10), (10, 8),
}

# 建筑平滑消除白墙/瓦顶/石壁/木船的颗粒抖动点阵
ARCH_DITHER_PAIRS = {
    (11, 15), (15, 11),
    (11, 7), (7, 11),
    (12, 15), (15, 12),
    (12, 7), (7, 12),
    (13, 14), (14, 13),
    (8, 13), (13, 8),
    (10, 13), (13, 10),
    (9, 12), (12, 9),
    (8, 10), (10, 8),
    (8, 11), (11, 8),
    (10, 11), (11, 10),
    (10, 15), (15, 10),
    (8, 15), (15, 8),
}

# 高对比暗点棋盘（如瓦背/拱廊/船壳中交替的 0-x 点阵）：仅在严格 2×2 棋盘围合时才混融，绝不模糊 1px 直线窗框或桅杆描边
STRONG_ARCH_CHECKER_PAIRS = {
    (0, 8), (8, 0),
    (0, 10), (10, 0),
    (0, 13), (13, 0),
    (0, 11), (11, 0),
    (0, 12), (12, 0),
    (0, 15), (15, 0),
}

SPRITE_DITHER_PAIRS = {
    (8, 12), (12, 8),
    (9, 12), (12, 9),
    (10, 11), (11, 10),
    (6, 11), (11, 6),
    (8, 15), (15, 8),
    (13, 14), (14, 13),
    (8, 9), (9, 8),
}

MAP_PAL_ORDER = [0, 8, 9, 10, 11, 12, 13, 14, 15, 1, 2, 3, 4, 5, 6, 7]

def extract_indices(rgba: np.ndarray, prefer_map: bool = True):
    h, w, _ = rgba.shape
    idx = np.full((h, w), 255, dtype=np.uint8)
    opaque = rgba[:, :, 3] >= 128
    rgb = rgba[:, :, :3].astype(np.int32)
    order = MAP_PAL_ORDER if prefer_map else list(range(16))
    pal = DAY_PAL_RGB[order].astype(np.int32)
    diff = rgb[:, :, None, :] - pal[None, None, :, :]
    dist = np.sum(diff * diff, axis=3)
    best_pos = np.argmin(dist, axis=2)
    best = np.array(order, dtype=np.uint8)[best_pos]
    idx[opaque] = best[opaque]
    return idx

def epx_2x_rgb(img: np.ndarray) -> np.ndarray:
    h, w, c = img.shape
    p = np.pad(img, ((1, 1), (1, 1), (0, 0)), mode="edge")
    P, A, B, C, D = p[1:-1, 1:-1], p[:-2, 1:-1], p[1:-1, 2:], p[1:-1, :-2], p[2:, 1:-1]
    eq = lambda u, v: np.max(np.abs(u - v), axis=2) < 8.0
    cond = (~eq(A, D)) & (~eq(C, B))
    out = np.empty((h * 2, w * 2, c), dtype=img.dtype)
    out[0::2, 0::2] = np.where((cond & eq(C, A))[:, :, None], C, P)
    out[0::2, 1::2] = np.where((cond & eq(A, B))[:, :, None], B, P)
    out[1::2, 0::2] = np.where((cond & eq(D, C))[:, :, None], C, P)
    out[1::2, 1::2] = np.where((cond & eq(B, D))[:, :, None], B, P)
    return out

def epx_2x_mask(mask: np.ndarray) -> np.ndarray:
    h, w = mask.shape
    p = np.pad(mask, ((1, 1), (1, 1)), mode="edge")
    P, A, B, C, D = p[1:-1, 1:-1], p[:-2, 1:-1], p[1:-1, 2:], p[1:-1, :-2], p[2:, 1:-1]
    cond = (A != D) & (C != B)
    out = np.empty((h * 2, w * 2), dtype=mask.dtype)
    out[0::2, 0::2] = np.where(cond & (C == A), C, P)
    out[0::2, 1::2] = np.where(cond & (A == B), B, P)
    out[1::2, 0::2] = np.where(cond & (D == C), C, P)
    out[1::2, 1::2] = np.where(cond & (B == D), B, P)
    return out

def periodic_noise(sz: int, freqs=(4, 8, 16), seed=42) -> np.ndarray:
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:sz, 0:sz].astype(np.float32) * (2.0 * math.pi / sz)
    acc = np.zeros((sz, sz), dtype=np.float32)
    wsum = 0.0
    for idx_f, freq in enumerate(freqs):
        w = 1.0 / (1.0 + idx_f * 0.75)
        n_dir = 10
        for _ in range(n_dir):
            kx = int(rng.integers(1, freq + 1)) * (1 if rng.random() > 0.5 else -1)
            ky = int(rng.integers(1, freq + 1)) * (1 if rng.random() > 0.5 else -1)
            ph = float(rng.uniform(0, 2.0 * math.pi))
            acc += w * np.sin(kx * xx + ky * yy + ph)
        wsum += w * n_dir
    acc /= max(1e-5, wsum)
    m = np.max(np.abs(acc))
    return acc / max(1e-5, m)

def make_tactile_materials(sz: int = 64):
    """生成区分石板广场、风蚀沙滩/荒漠、自然草簇、海床与建筑风化岩木理的物理高度与微色差贴图"""
    yy, xx = np.mgrid[0:sz, 0:sz].astype(np.float32)

    # 1A. 港口石砌广场/码头铺砖 (错缝方石，柔和风化浅缝隙与温润冷暖块差，仅用于砖石广场格)
    row_idx = np.floor(yy / 16.0)
    ox = (xx + (row_idx % 2) * 8.0) % 16.0
    oy = yy % 16.0
    dx = np.minimum(ox, 16.0 - ox)
    dy = np.minimum(oy, 16.0 - oy)
    edge_d = np.minimum(dx, dy)
    bevel = np.clip(edge_d / 2.6, 0.0, 1.0)
    grout = (1.0 - bevel) ** 1.4
    cell_id = (row_idx % 4) * 4 + (np.floor((xx + (row_idx % 2) * 8.0) / 16.0) % 4)
    tile_tone = np.sin(cell_id * 12.9898) * 0.5
    stone_grain = periodic_noise(sz, (6, 14, 24), seed=107)
    stone_broad = periodic_noise(sz, (2, 4), seed=109)

    plaza_albedo = (
        tile_tone * 5.2
        + stone_broad * 4.5
        + stone_grain * 4.2
        - grout * 10.5
    )[:, :, None] * np.array([1.02, 0.96, 0.84], dtype=np.float32)
    plaza_height = np.clip(0.56 * bevel + 0.14 * stone_grain + 0.12 * stone_broad, 0.0, 1.0)

    # 1B. 自然沙滩/沙漠土路 (风吹微沙波与矿物砂粒，绝无人工瓷砖方格线条)
    wind_phase = (xx * 0.55 + yy * 0.85) * (2.0 * math.pi / sz) * 3.0
    dune_ripple = np.sin(wind_phase + stone_broad * 1.6) * 0.5
    sand_fine = periodic_noise(sz, (8, 16, 28), seed=113)
    sand_albedo = (
        dune_ripple * 3.4
        + stone_broad * 5.5
        + sand_fine * 3.8
    )[:, :, None] * np.array([1.05, 0.96, 0.78], dtype=np.float32)
    sand_height = np.clip(0.45 + 0.22 * dune_ripple + 0.18 * stone_broad + 0.14 * sand_fine, 0.0, 1.0)

    # 2. 自然植物草坪肌理 (柔和团簇起伏与细腻草叶方向微颗粒)
    g_clump = periodic_noise(sz, (3, 7), seed=205)
    g_blade = periodic_noise(sz, (12, 22, 30), seed=208)
    grass_albedo = (g_clump * 8.5 + g_blade * 5.8)[:, :, None] * np.array([0.82, 1.10, 0.62], dtype=np.float32)
    grass_height = np.clip(0.45 + 0.34 * g_clump + 0.22 * g_blade, 0.0, 1.0)

    # 3. 港湾深水底色 (波动由 WebGL2 实时着色器主导)
    w_deep = periodic_noise(sz, (2, 4), seed=303)
    water_albedo = (w_deep * 5.0)[:, :, None] * np.array([0.45, 0.85, 1.2], dtype=np.float32)

    # 4. 建筑石材/木质/灰泥柔和微风化颗粒 (低频温和起伏，无噪点刺毛)
    arch_macro = periodic_noise(sz, (3, 7), seed=401)
    arch_grain = periodic_noise(sz, (10, 18), seed=407)
    arch_albedo = (arch_macro * 4.2 + arch_grain * 3.2)[:, :, None] * np.array([1.0, 0.97, 0.91], dtype=np.float32)
    arch_detail_h = (arch_macro * 0.08 + arch_grain * 0.05).astype(np.float32)

    return plaza_albedo, plaza_height, sand_albedo, sand_height, grass_albedo, grass_height, water_albedo, arch_albedo, arch_detail_h

def bilateral_tile_rgb(
    rgb: np.ndarray,
    mask: np.ndarray,
    sigma_s: float = 1.2,
    sigma_c: float = 34.0,
    radius: int = 2,
) -> np.ndarray:
    """向量化 5×5 保边双边滤波：抹平建筑/瓦片/船体 4× 放大锯齿与色斑，同时保持窗框、砖缝与屋檐锐利"""
    if not np.any(mask):
        return rgb
    h, w, _ = rgb.shape
    pad = radius
    p_rgb = np.pad(rgb, ((pad, pad), (pad, pad), (0, 0)), mode="edge")
    p_msk = np.pad(mask.astype(np.float32), ((pad, pad), (pad, pad)), mode="constant", constant_values=0.0)
    num = np.zeros_like(rgb, dtype=np.float32)
    den = np.zeros((h, w), dtype=np.float32)
    inv_2s2 = 1.0 / (2.0 * sigma_s * sigma_s)
    inv_2c2 = 1.0 / (2.0 * sigma_c * sigma_c)
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            ws = math.exp(-(dy * dy + dx * dx) * inv_2s2)
            nb = p_rgb[pad + dy:pad + dy + h, pad + dx:pad + dx + w]
            nm = p_msk[pad + dy:pad + dy + h, pad + dx:pad + dx + w]
            diff = nb - rgb
            dc2 = np.sum(diff * diff, axis=2) / 3.0
            wt = ws * np.exp(-dc2 * inv_2c2) * nm
            num += nb * wt[:, :, None]
            den += wt
    out = np.where((den > 1e-4)[:, :, None] & mask[:, :, None], num / np.maximum(den[:, :, None], 1e-4), rgb)
    return out

def dedither_tile_rgb(
    idx_tile: np.ndarray,
    pal_rgb: np.ndarray,
    dither_pairs: set,
    strict_pairs: set | None = None,
    is_water: np.ndarray | None = None,
    wrap_edges: bool = False,
) -> np.ndarray:
    h, w = idx_tile.shape
    base = pal_rgb[np.clip(idx_tile, 0, 15)].copy()
    out = base.copy()
    clean_idx = idx_tile.copy()
    if is_water is not None:
        water_speck = is_water & ((clean_idx == 0) | (clean_idx == 8))
        out[water_speck] = pal_rgb[9] * 0.88 + pal_rgb[8] * 0.12
        clean_idx[water_speck] = 9

    def get_px(yy, xx):
        if wrap_edges:
            return yy % h, xx % w
        if 0 <= yy < h and 0 <= xx < w:
            return yy, xx
        return None

    for y in range(h):
        for x in range(w):
            ci = int(clean_idx[y, x])
            if ci >= 16:
                continue
            nb = []
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                pos = get_px(y + dy, x + dx)
                if pos is not None:
                    ny, nx = pos
                    nb.append((int(clean_idx[ny, nx]), base[ny, nx]))
            matches = [(ni, rgb) for ni, rgb in nb if (ci, ni) in dither_pairs]
            strict_matches = [(ni, rgb) for ni, rgb in nb if strict_pairs and (ci, ni) in strict_pairs]
            if not matches and not strict_matches:
                continue
            diag_same = 0
            for dy, dx in ((-1, -1), (-1, 1), (1, -1), (1, 1)):
                pos = get_px(y + dy, x + dx)
                if pos is not None and int(clean_idx[pos[0], pos[1]]) == ci:
                    diag_same += 1
            if matches and ((len(matches) >= 2 and diag_same >= 1) or len(matches) >= 3):
                avg_nb = np.mean([rgb for _, rgb in matches], axis=0)
                out[y, x] = base[y, x] * 0.48 + avg_nb * 0.52
            elif strict_matches and (len(strict_matches) >= 3 and diag_same >= 2):
                avg_nb = np.mean([rgb for _, rgb in strict_matches], axis=0)
                out[y, x] = base[y, x] * 0.42 + avg_nb * 0.58
    return out

def height_to_normal_rgba(height: np.ndarray, elevation: np.ndarray, strength: float = 2.6) -> np.ndarray:
    """将微凹凸高度场转成切线空间法线 RGB，并与物理建筑高程 A 通道打包"""
    gx = sobel(height, axis=1, mode="nearest") * (strength / 8.0)
    gy = sobel(height, axis=0, mode="nearest") * (strength / 8.0)
    nx = -gx
    ny = gy  # WebGL 屏幕 Y 朝上对应正 Y
    nz = np.ones_like(height)
    norm = np.sqrt(nx * nx + ny * ny + nz * nz) + 1e-6
    nx /= norm
    ny /= norm
    nz /= norm
    out = np.empty((*height.shape, 4), dtype=np.uint8)
    out[:, :, 0] = np.clip(np.round((nx * 0.5 + 0.5) * 255.0), 0, 255).astype(np.uint8)
    out[:, :, 1] = np.clip(np.round((ny * 0.5 + 0.5) * 255.0), 0, 255).astype(np.uint8)
    out[:, :, 2] = np.clip(np.round((nz * 0.5 + 0.5) * 255.0), 0, 255).astype(np.uint8)
    out[:, :, 3] = np.clip(np.round(elevation * 255.0), 0, 255).astype(np.uint8)
    return out

def detect_emissive_windows(tile_idx: np.ndarray, t_id: int, p2: int, is_water: np.ndarray) -> np.ndarray:
    """识别建筑暖光门窗 (index 6) 与被暗框包裹的蓝玻璃窗格 (index 12)，用于在黄昏/夜晚亮起暖色灯火"""
    em = np.zeros_like(tile_idx, dtype=np.float32)
    if t_id < p2:
        return em
    # 1. 原版自带暖橙色玻璃/灯笼像素 (index 6) 且不在水面/看板大色块
    warm = (tile_idx == 6) & ~is_water
    em[warm] = 0.95
    # 2. 建筑冷蓝窗格 (index 12，不含成片水域): 上下左右 2px 内紧邻黑框/木框 (0/10)
    glass = (tile_idx == 12) & ~is_water
    if np.any(glass) and int(np.sum(is_water)) < 24:
        frame = (tile_idx == 0) | (tile_idx == 10)
        fpad = np.pad(frame.astype(np.int32), ((2, 2), (2, 2)), mode="constant", constant_values=0)
        fsum = sum(fpad[dy:dy + 16, dx:dx + 16] for dy in range(5) for dx in range(5))
        em[glass & (fsum >= 4)] = 0.85
    return em

def decode_portmap_grid(s: str) -> list[int]:
    out: list[int] = []
    for tok in s.split():
        if "*" in tok:
            v, n = tok.split("*")
            out.extend([int(v, 16)] * int(n))
        else:
            out.append(int(tok, 16))
    return out

def compute_portmap_context(meta: dict):
    """统计每个图块集在真实港内地图中的邻接关系，区分岸边系泊船与陆地建筑/道具周围的开放地面"""
    pm = json.load(open(PORTMAP_JSON, "r", encoding="utf-8"))
    chipno = meta["chipNo"]
    tilesets = meta["tilesets"]
    water_adj = [set() for _ in range(len(tilesets))]
    open_edges = [{} for _ in range(len(tilesets))]

    for s, bounds in enumerate(tilesets):
        _, p1, p2, _ = bounds
        rgba = np.array(Image.open(os.path.join(ART_SHEETS, f"portchip_{s}.png")).convert("RGBA"))
        idx = extract_indices(rgba, prefer_map=True)
        cols = idx.shape[1] // 16

        def get_t(tid: int) -> np.ndarray:
            r, c = divmod(tid, cols)
            return idx[r * 16:(r + 1) * 16, c * 16:(c + 1) * 16]

        walk_kind = {}
        pure_sea_tids = set()
        for tid in range(idx.shape[0] // 16 * cols):
            t = get_t(tid)
            u = set(np.unique(t).tolist())
            if 9 in u and u.issubset({0, 8, 9, 12}):
                pure_sea_tids.add(tid)
            if tid >= p1 or int(np.sum((t == 9) | (t == 12))) >= 40 or int(np.sum(t == 0)) >= 60:
                continue
            if u.issubset({13, 14}):
                walk_kind[tid] = ("grass", {13, 14})
            elif u.issubset({10, 11, 15, 7}):
                walk_kind[tid] = ("sand", {10, 11, 15})
            elif u.issubset({8, 11, 15}) and 11 in u:
                walk_kind[tid] = ("dither_sand", {8, 11, 15})
            elif u.issubset({8, 10, 11}) and 10 in u:
                walk_kind[tid] = ("dither_earth", {8, 10})
            elif u.issubset({0, 8, 10, 11, 13, 14, 15}):
                walk_kind[tid] = ("mixed", {10, 11, 13, 14, 15})

        adj_pairs = []  # (tid, ei, nb_tid)
        for pid, cs in enumerate(chipno):
            if cs != s or pid >= len(pm["ports"]):
                continue
            grid = decode_portmap_grid(pm["ports"][pid])
            for r in range(96):
                for c in range(96):
                    tid = grid[r * 96 + c]
                    if tid < p1:
                        continue
                    for ei, (dr, dc) in enumerate(((-1, 0), (0, 1), (1, 0), (0, -1))):
                        nr, nc = r + dr, c + dc
                        if not (0 <= nr < 96 and 0 <= nc < 96):
                            continue
                        nb = grid[nr * 96 + nc]
                        if nb in pure_sea_tids:
                            water_adj[s].add(tid)
                        if nb in walk_kind:
                            k, _ = walk_kind[nb]
                            nbt = get_t(nb)
                            nb_edge = set((nbt[15, :] if ei == 0 else (nbt[:, 0] if ei == 1 else (nbt[0, :] if ei == 2 else nbt[:, 15]))).tolist())
                            if k == "grass":
                                allowed = {13, 14}
                            elif k == "sand":
                                allowed = {10, 11, 15}
                            elif k == "dither_sand":
                                allowed = {8, 11, 15}
                            elif k == "dither_earth":
                                allowed = {8, 10}
                            else:
                                allowed = set()
                                if {13, 14}.issubset(nb_edge):
                                    allowed |= {13, 14}
                                if {11, 15}.issubset(nb_edge):
                                    allowed |= {10, 11, 15}
                            if allowed:
                                open_edges[s].setdefault(tid, {}).setdefault(ei, set()).update(allowed)
                        elif nb >= p2 and nb not in water_adj[s] and tid not in WALL_PLAQUE_SKIP_SAND.get(s, set()) and nb not in WALL_PLAQUE_SKIP_SAND.get(s, set()):
                            adj_pairs.append((tid, ei, nb))

        # 多轮传播开放地面边界（例如旱坞船中间的桅杆格 103/115 虽不直接邻接 tile 4，但两侧与 102/104 开放沙地相通）
        unique_adj = set(adj_pairs)
        for _ in range(2):
            changed = False
            for tid, ei, nb in unique_adj:
                if tid in water_adj[s] or nb in water_adj[s] or tid < p2:
                    continue
                nb_emap = open_edges[s].get(nb)
                if not nb_emap:
                    continue
                nb_arr = get_t(nb)
                # 检查 nb 朝向 tid 的边缘是否已有开放地面连通（例如从 nb 对侧开放沙地穿行到朝向 tid 的一侧）
                os_nb, og_nb = extract_outer_ground(nb_arr, s, nb, p2, nb_emap, np.zeros((16, 16), dtype=bool), False)
                bg_nb = os_nb | og_nb
                edge_bg_nb = bg_nb[15, :] if ei == 0 else (bg_nb[:, 0] if ei == 1 else (bg_nb[0, :] if ei == 2 else bg_nb[:, 15]))
                if int(np.sum(edge_bg_nb)) >= 3:
                    vals = set(nb_arr[15, edge_bg_nb].tolist() if ei == 0 else (nb_arr[edge_bg_nb, 0].tolist() if ei == 1 else (nb_arr[0, edge_bg_nb].tolist() if ei == 2 else nb_arr[edge_bg_nb, 15].tolist())))
                    cur = open_edges[s].setdefault(tid, {}).setdefault(ei, set())
                    if not vals.issubset(cur):
                        cur.update(vals)
                        changed = True
            if not changed:
                break
    return water_adj, open_edges

# 排除纯米白石膏墙体/招牌图块被误判为沙地（教堂顶十字架 s0:205/s1:53/s3:88 与清真寺尖塔 s2:155..178 均保留外围沙地剥离）
WALL_PLAQUE_SKIP_SAND = {
    0: {83},
    1: {129, 131},
    2: {56},
    3: {89, 169, 181, 189},
    4: {44, 45, 46, 47, 110},
    5: {54, 62, 97},
    6: {56, 157},
}

# 马赛克码头岸壁格：无论 open_edges 是否被相邻水域阻断，均严格剥离最底 y>=14 的地面砖边距（set 0/2 为 {11,15}，set 1 为 {8,10}），绝不向上侵蚀墙体
QUAY_APRON_TILES = {
    0: {108, 109, 130, 132},
    1: {103, 104, 129, 131},
    2: {81, 107, 109},
}

# 船帆/船艏与码头围墙重叠格：将前景船体 (ship_fg, elev=0.88) 与背景围墙 (bg_elev) 分离，使阴影仅由船体投射到围墙及地面
SHIP_OVER_WALL_BG = {
    0: {
        110: (14, 0.0), 111: (14, 0.0), 112: (14, 0.0),
        120: (14, 0.28), 121: (14, 0.28), 122: (14, 0.28),
        130: (108, 0.28), 131: (108, 0.28), 132: (108, 0.28),
    },
    1: {
        105: (14, 0.0), 106: (14, 0.0), 107: (14, 0.0),
        117: (14, 0.28), 118: (14, 0.28), 119: (14, 0.28),
        129: (103, 0.28), 130: (103, 0.28), 131: (103, 0.28),
    },
    2: {
        107: (81, 0.28), 108: (81, 0.28), 109: (81, 0.28),
    },
}

# 与重叠船体相邻的纯围墙/矮墙格保持统一的低矮高程 (0.28 < 0.36)，既不产生墙间假崖影，又能接收前景船帆投下的阴影
QUAY_PARAPET_ELEV = {
    0: {78: 0.28, 91: 0.28, 108: 0.28, 109: 0.28},
    1: {59: 0.28, 74: 0.28, 103: 0.28, 104: 0.28},
    2: {81: 0.28},
}

def extract_outer_ground(tile_idx: np.ndarray, set_idx: int, t_id: int, p2: int, edge_map: dict, is_water: np.ndarray, has_water_adj: bool):
    """从图块邻接步行地面的开放边界向内泛洪，剥离树冠、旱坞船、马车、沙漠斜顶与路缘外围的平地沙地/草地"""
    outer_sand = np.zeros_like(tile_idx, dtype=bool)
    outer_grass = np.zeros_like(tile_idx, dtype=bool)
    if t_id < p2 or np.any(is_water):
        return outer_sand, outer_grass

    if t_id in QUAY_APRON_TILES.get(set_idx, set()):
        apron_vals = (8, 10) if set_idx == 1 else (11, 15)
        if not np.any(tile_idx == 9):
            q2 = deque()
            ms2 = np.zeros_like(tile_idx, dtype=bool)
            run = []
            for x in range(16):
                if int(tile_idx[15, x]) in apron_vals:
                    run.append(x)
                else:
                    if len(run) >= 3:
                        for rx in run:
                            ms2[15, rx] = True
                            q2.append((15, rx))
                    run = []
            if len(run) >= 3:
                for rx in run:
                    ms2[15, rx] = True
                    q2.append((15, rx))
            while q2:
                cy, cx = q2.popleft()
                for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    ny, nx = cy + dy, cx + dx
                    if 14 <= ny < 16 and 0 <= nx < 16 and not ms2[ny, nx] and int(tile_idx[ny, nx]) in apron_vals:
                        ms2[ny, nx] = True
                        q2.append((ny, nx))
            if int(np.sum(ms2)) >= 6:
                outer_sand |= ms2
        return outer_sand, outer_grass

    if not edge_map:
        return outer_sand, outer_grass

    def flood_group(grp: set[int], allow_mask: np.ndarray | None = None) -> tuple[np.ndarray, set[int]]:
        q = deque()
        loc = np.zeros_like(tile_idx, dtype=bool)
        all_a: set[int] = set()
        valid = np.isin(tile_idx, list(grp)) if allow_mask is None else (np.isin(tile_idx, list(grp)) | allow_mask)
        for ei, allowed in edge_map.items():
            if not (grp & allowed):
                continue
            all_a |= allowed
            coords = [(0, x) for x in range(16)] if ei == 0 else ([(y, 15) for y in range(16)] if ei == 1 else ([(15, x) for x in range(16)] if ei == 2 else [(y, 0) for y in range(16)]))
            run = []
            for y, x in coords:
                if valid[y, x]:
                    run.append((y, x))
                else:
                    if len(run) >= 3:
                        for ry, rx in run:
                            if not loc[ry, rx]:
                                loc[ry, rx] = True
                                q.append((ry, rx))
                    run = []
            if len(run) >= 3:
                for ry, rx in run:
                    if not loc[ry, rx]:
                        loc[ry, rx] = True
                        q.append((ry, rx))
        while q:
            cy, cx = q.popleft()
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                ny, nx = cy + dy, cx + dx
                if 0 <= ny < 16 and 0 <= nx < 16 and not loc[ny, nx] and valid[ny, nx]:
                    loc[ny, nx] = True
                    q.append((ny, nx))
        return loc, all_a

    # 1) 外围草坪 ({13, 14})：不会出现在纯棕瓦屋顶里（排除无14且10占比过高的棕瓦）
    mg, ag = flood_group({13, 14})
    if int(np.sum(mg)) >= 12 and {13, 14}.issubset(ag) and int(np.sum(mg & (tile_idx == 14))) >= 3:
        outer_grass |= mg

    if t_id in WALL_PLAQUE_SKIP_SAND.get(set_idx, set()):
        return outer_sand, outer_grass

    # set 1 旱坞船体行 (141/153/165) 左侧假影 ({0, 8, 10}) 允许穿过非实心黑船壳的孤立棋盘 0 噪点
    checker_zero_mask = None
    if set_idx == 1 and t_id in (141, 153, 165):
        zpad = np.pad((tile_idx == 0).astype(np.int32), ((0, 0), (1, 1)), mode="constant", constant_values=0)
        z_lr = zpad[:, :-2] + zpad[:, 2:]
        checker_zero_mask = (tile_idx == 0) & (z_lr == 0)
        xs = np.arange(16)[None, :]
        checker_zero_mask &= (xs <= 6)

    # 2) 外围棋盘格砂土/泥地 ({8, 11, 15} 如旱坞船、马车、椰树影, {8, 10} 如 set 1 船与 set 5 马匹/篱笆)
    if not has_water_adj:
        for grp, core, col_b in (({8, 11, 15}, {8, 11}, 11), ({8, 10, 11}, {8, 10}, 10), ({8, 10}, {8, 10}, 10)):
            am = checker_zero_mask if (grp == {8, 10, 11} and checker_zero_mask is not None) else None
            md, ad = flood_group(grp, allow_mask=am)
            ok_edge = core.issubset(ad) or (grp == {8, 11, 15} and {11, 15}.issubset(ad))
            if int(np.sum(md)) >= 12 and ok_edge and int(np.sum(md & (tile_idx == 8))) >= 4 and int(np.sum(md & (tile_idx == col_b))) >= 4:
                outer_sand |= md

        # 3) 外围明沙 ({10, 11, 15} 如旱坞船、椰子树、沙漠斜屋顶、围栏)
        ms, a_s = flood_group({10, 11, 15})
        if int(np.sum(ms)) >= 12 and {11, 15}.issubset(a_s) and int(np.sum(ms & (tile_idx == 11))) >= 4 and int(np.sum(ms & (tile_idx == 15))) >= 4:
            outer_sand |= ms

    return outer_sand, outer_grass

def process_portchip_sheet(set_idx: int, p1: int, p2: int, p3: int, mats, water_adj_set: set, open_edge_map: dict):
    src_path = os.path.join(ART_SHEETS, f"portchip_{set_idx}.png")
    rgba = np.array(Image.open(src_path).convert("RGBA"))
    idx_all = extract_indices(rgba, prefer_map=True)
    H, W = idx_all.shape
    tile_sz = 16
    hd_tile = 64
    cols, rows = W // tile_sz, H // tile_sz

    plaza_alb, plaza_hgt, sand_alb, sand_hgt, grass_alb, grass_hgt, water_alb, arch_alb, arch_detail_h = mats
    ref_tid = 5 if set_idx == 1 else 4
    ref_r, ref_c = divmod(ref_tid, cols)
    ref_tile_idx = idx_all[ref_r * tile_sz:(ref_r + 1) * tile_sz, ref_c * tile_sz:(ref_c + 1) * tile_sz]
    stone_ref = np.mean(MODERN_GROUND_PAL[ref_tile_idx], axis=(0, 1)).astype(np.float32)

    alb_out = np.zeros((rows * hd_tile, cols * hd_tile, 4), dtype=np.uint8)
    nrm_out = np.zeros((rows * hd_tile, cols * hd_tile, 4), dtype=np.uint8)
    mat_out = np.zeros((rows * hd_tile, cols * hd_tile, 4), dtype=np.uint8)

    for r in range(rows):
        for c in range(cols):
            t_id = r * cols + c
            tile_idx = idx_all[r * tile_sz:(r + 1) * tile_sz, c * tile_sz:(c + 1) * tile_sz]
            is_walk = t_id < p2

            # 语义划分：0=结构黑线, 1=水体, 2=砂石路面, 3=草坪, 4=建筑/石墙/木船/树木
            sem = np.full((tile_sz, tile_sz), 4, dtype=np.uint8)
            is_blue = (tile_idx == 9) | (tile_idx == 12)
            # 仅把真正连片水域 (深水连通域>=14 且含>=6深水9；或紧邻纯海且贴边的浪花浅水 12 / 码头平唇，排除建筑蓝窗) 识别为动态水面
            lbl_arr, n_comp = label(is_blue, structure=np.ones((3, 3), dtype=np.int32))
            water_base = np.zeros_like(is_blue)
            c0_cnt_pre = int(np.sum(tile_idx == 0))
            c15_cnt_pre = int(np.sum(tile_idx == 15))
            c_ground_pre = int(np.sum((tile_idx == 8) | (tile_idx == 10) | (tile_idx == 11)))
            c_land_pre = c_ground_pre + int(np.sum((tile_idx == 13) | (tile_idx == 14)))
            for cid in range(1, n_comp + 1):
                comp_m = (lbl_arr == cid)
                area = int(np.sum(comp_m))
                deep_cnt = int(np.sum(comp_m & (tile_idx == 9)))
                touches_border = bool(np.any(comp_m[0, :] | comp_m[-1, :] | comp_m[:, 0] | comp_m[:, -1]))
                is_shallow_surf = (
                    (t_id in water_adj_set)
                    and touches_border
                    and (
                        (area >= 1 and c0_cnt_pre <= 36 and c15_cnt_pre >= 60 and c_land_pre >= 100)
                        or (area >= 3 and c0_cnt_pre <= 36 and c15_cnt_pre >= 40 and c_land_pre >= 80)
                        or (area >= 8 and c0_cnt_pre <= 32 and c_ground_pre >= 180)
                    )
                )
                if (area >= 14 and deep_cnt >= 6) or is_shallow_surf:
                    water_base |= comp_m

            # 检测“纯水上波纹/水面倒影影块” (如 153 号水面倒影黑波，仅有 0/8/9/12 无木/石/砖结构；或 105 号海浪白沫)
            non_water_solids = np.sum((tile_idx == 10) | (tile_idx == 11) | (tile_idx == 13) | (tile_idx == 14) | (tile_idx == 1) | (tile_idx == 6))
            pure_water_ripple_tile = (non_water_solids == 0 and int(np.sum(tile_idx == 9)) >= 80) or (
                int(np.sum(is_blue)) >= 140 and non_water_solids == 0
            )
            if pure_water_ripple_tile:
                is_water = np.ones_like(is_blue, dtype=bool)
            else:
                blue_pad = np.pad(water_base.astype(np.int32), ((1, 1), (1, 1)), mode="edge")
                blue_sum = sum(blue_pad[dy:dy + tile_sz, dx:dx + tile_sz] for dy in range(3) for dx in range(3))
                # 靠船体水面中孤立的 0/8 水面阴影（若 3x3 内无实体黄木/白帆且邻域多为深水）也转为柔和深水，避免池塘里飘黑杂草
                solid_hull = (tile_idx == 10) | (tile_idx == 11) | (tile_idx == 15) | (tile_idx == 13) | (tile_idx == 14)
                hull_pad = np.pad(solid_hull.astype(np.int32), ((1, 1), (1, 1)), mode="edge")
                hull_near = sum(hull_pad[dy:dy + tile_sz, dx:dx + tile_sz] for dy in range(3) for dx in range(3))
                is_water = water_base | (((tile_idx == 0) | (tile_idx == 8)) & (blue_sum >= 4) & (hull_near == 0))

            uniq_idx = set(np.unique(tile_idx).tolist())
            c0_cnt = int(np.sum(tile_idx == 0))
            is_grass_shadow_tile = (t_id < p2) and (c0_cnt >= 90) and (13 in uniq_idx) and uniq_idx.issubset({0, 10, 13, 14})
            is_sand_shadow_tile = (t_id < p2) and (c0_cnt >= 90) and (8 not in uniq_idx) and (13 not in uniq_idx) and uniq_idx.issubset({0, 10, 11, 15})
            is_stone_shadow_tile = (
                (t_id < p1 or (set_idx == 5 and t_id in (38, 39, 41, 45)))
                and (c0_cnt >= 36)
                and (8 in uniq_idx)
                and uniq_idx.issubset({0, 8, 10, 11})
            )
            is_ground_shadow_tile = is_grass_shadow_tile or is_sand_shadow_tile or is_stone_shadow_tile
            is_road_curb = (set_idx == 0) and (t_id in (18, 31, 32, 33, 38, 39, 40))
            is_ground_stair = (set_idx == 3 and t_id == 30) or (set_idx == 4 and t_id in (44, 45, 46, 47))

            # 行1 (t_id >= 16) 且位于 < p2 的多黑线大门下半格/深色屋檐瓦片归为立体建筑，但排除石板路面、台阶与纯地面墙影
            is_arch_walk = (t_id >= 16) and (t_id < p2) and (c0_cnt >= 85) and not np.any(is_water) and not is_ground_shadow_tile and not is_road_curb
            is_walk = (t_id < p2) and not is_arch_walk
            is_tree_tile = (t_id >= p2) and (int(np.sum((tile_idx == 13) | (tile_idx == 14))) >= 120) and not np.any(is_water) and (c0_cnt >= 8)
            is_shore_tile = (t_id >= p2) and np.any(is_water) and (int(np.sum((tile_idx == 13) | (tile_idx == 14))) >= 18)
            water_px = int(np.sum(is_water))
            is_flat_beach = (t_id >= p2) and (
                (
                    np.any(is_water)
                    and (
                        c0_cnt <= 20
                        or (c0_cnt <= 36 and int(np.sum((tile_idx == 8) | (tile_idx == 10) | (tile_idx == 11) | (tile_idx == 13) | (tile_idx == 14) | (tile_idx == 15))) >= 150)
                        or (water_px >= 90 and (c0_cnt <= 38 or (c0_cnt <= 44 and water_px >= 160)))
                    )
                )
                or (
                    (t_id in water_adj_set)
                    and (c0_cnt <= 48)
                    and uniq_idx.issubset({0, 8, 10, 11, 12, 15})
                    and (
                        int(np.sum((tile_idx == 8) | (tile_idx == 10) | (tile_idx == 11))) >= 180
                        or (c0_cnt <= 36 and int(np.sum((tile_idx == 11) | (tile_idx == 15))) >= 140)
                    )
                )
            )

            outer_sand, outer_grass = extract_outer_ground(
                tile_idx, set_idx, t_id, p2, open_edge_map.get(t_id, {}), is_water, t_id in water_adj_set
            )
            if set_idx == 5 and t_id == 35:
                outer_sand[10:, :] |= (tile_idx[10:, :] == 8) | (tile_idx[10:, :] == 10)
            if is_road_curb:
                outer_grass = outer_grass | ((tile_idx == 13) | (tile_idx == 14))
            outer_bg = outer_sand | outer_grass

            sem[is_water] = 1
            if is_ground_shadow_tile:
                # 原版建筑左侧投影格：保持平地高程 (elev=0)，避免突出墙体与二次阴影，同时保留与沙地影格 (9/11) 一致的柔和地面暗影
                if is_grass_shadow_tile:
                    sem[:, :] = 3
                    if 10 in uniq_idx:
                        sem[tile_idx == 10] = 2
                else:
                    sem[:, :] = 2
            elif is_walk and not is_road_curb:
                is_grass = (tile_idx == 13) | (tile_idx == 14)
                is_sand = ((tile_idx == 10) | (tile_idx == 11) | (tile_idx == 15) | (tile_idx == 8)) & ~is_water & ~is_grass
                sem[is_sand] = 2
                sem[is_grass] = 3
            elif is_tree_tile:
                # 仅把与图块外缘草坪 (13/14) 不连通的内部树冠与树干保留为遮挡实体，外围草地归入草坪 sem=3
                grass_mask = (tile_idx == 13) | (tile_idx == 14)
                lbl_g, _ = label(grass_mask, structure=np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], dtype=np.int32))
                border_ids = set(lbl_g[0, :].tolist()) | set(lbl_g[-1, :].tolist()) | set(lbl_g[:, 0].tolist()) | set(lbl_g[:, -1].tolist())
                border_ids.discard(0)
                outer_grass = np.isin(lbl_g, list(border_ids))
                outer_bg = outer_grass
                sem[outer_grass] = 3
            else:
                if is_flat_beach:
                    sem[((tile_idx == 13) | (tile_idx == 14)) & ~is_water] = 3
                    sem[((tile_idx == 8) | (tile_idx == 10) | (tile_idx == 11) | (tile_idx == 15)) & ~is_water] = 2
                elif np.any(is_water):
                    sem[((tile_idx == 13) | (tile_idx == 14)) & ~is_water] = 3
                    blk_pad = np.pad((tile_idx == 0).astype(np.int32), ((1, 1), (1, 1)), mode="edge")
                    blk_near = sum(blk_pad[dy:dy + tile_sz, dx:dx + tile_sz] for dy in range(3) for dx in range(3))
                    sem[((tile_idx == 10) | (tile_idx == 11) | (tile_idx == 15)) & (blk_near == 0) & ~is_water] = 2
                if np.any(outer_sand):
                    sem[outer_sand] = 2
                if np.any(outer_grass):
                    sem[outer_grass] = 3
            if not is_ground_shadow_tile:
                sem[(tile_idx == 0) & ~outer_sand] = 0
            sem[is_water] = 1

            # 1) Albedo: 地面、平坦海岸线与树格使用地面色盘；道具/船/尖塔/十字架/沙漠屋顶的外围裸露地面也使用地面色盘以无缝衔接铺石
            pairs = GROUND_DITHER_PAIRS if (is_walk or is_shore_tile or is_flat_beach or is_tree_tile) else ARCH_DITHER_PAIRS
            strict_pairs = None if (is_walk or is_shore_tile or is_flat_beach or is_tree_tile) else STRONG_ARCH_CHECKER_PAIRS
            if is_flat_beach:
                pairs = pairs | {(8, 11), (11, 8), (8, 10), (10, 8)}
            tile_pal = MODERN_GROUND_PAL if (is_walk or is_tree_tile or is_shore_tile or is_flat_beach or is_ground_stair) else MODERN_ARCH_PAL
            base_16 = dedither_tile_rgb(tile_idx, tile_pal, pairs, strict_pairs=strict_pairs, is_water=is_water, wrap_edges=(is_walk and t_id < p1 and not is_ground_shadow_tile and not is_road_curb))
            if is_flat_beach and set_idx == 1 and np.any((tile_idx == 8) & (sem == 2)):
                base_16[(tile_idx == 8) & (sem == 2)] = stone_ref
            if not (is_walk or is_tree_tile or is_shore_tile or is_flat_beach) and np.any(outer_bg):
                ext_pairs = GROUND_DITHER_PAIRS | {(8, 11), (11, 8), (8, 10), (10, 8)}
                base_ext = dedither_tile_rgb(tile_idx, MODERN_GROUND_PAL, ext_pairs, is_water=is_water, wrap_edges=False)
                if set_idx in (0, 2, 3, 4, 6) and np.any(outer_sand & (tile_idx == 8)):
                    # 清除旱坞船体 (set 0/2/3)、椰树等左侧原版 1993 {8,11} 灰格假影，由 WebGL2 实时光线统一投射斜影
                    clean_sand = MODERN_GROUND_PAL[11] * 0.48 + MODERN_GROUND_PAL[15] * 0.52
                    base_ext[outer_sand & ((tile_idx == 8) | (tile_idx == 10))] = clean_sand
                elif set_idx == 1 and t_id in (103, 104, 129, 131, 141, 153, 165) and np.any(outer_sand):
                    # 清除 set 1 码头岸壁与旱坞船体周围 {0, 8, 10} 灰/米砖假影或边距，匹配其邻接地砖 stone_ref
                    base_ext[outer_sand & ((tile_idx == 8) | (tile_idx == 0) | (tile_idx == 10))] = stone_ref
                base_16 = np.where(outer_bg[:, :, None], base_ext, base_16)
            if is_ground_shadow_tile:
                if is_grass_shadow_tile:
                    sunlit_grass = MODERN_GROUND_PAL[13] * 0.48 + MODERN_GROUND_PAL[14] * 0.52
                    fill_col = sunlit_grass * 0.56 + np.array([3.0, 8.0, 18.0], dtype=np.float32)
                    base_16[tile_idx == 0] = fill_col
                elif is_stone_shadow_tile:
                    # 将石砖暗影格 (set 1: 3/8/17, set 4: 11/16, set 5: 16/38/39/41/45) 的冷灰 {0, 8} 棋盘转为与对应图集石砖地面一致的柔和暗影
                    base_16[tile_idx == 0] = stone_ref * 0.66 + np.array([4.0, 7.0, 15.0], dtype=np.float32)
                    base_16[tile_idx == 8] = stone_ref * 0.84 + np.array([2.0, 4.0, 9.0], dtype=np.float32)
                else:
                    sunlit_sand = MODERN_GROUND_PAL[10] * 0.45 + MODERN_GROUND_PAL[11] * 0.55
                    fill_col = sunlit_sand * 0.68 + np.array([6.0, 8.0, 16.0], dtype=np.float32)
                    base_16[tile_idx == 0] = fill_col
            if pure_water_ripple_tile:
                # 153 等水上影波纹格：只保留柔和深暗水波层次，不生成刺眼黑刺团块
                dark_ripple = (tile_idx == 0) | (tile_idx == 8)
                base_16[dark_ripple] = MODERN_GROUND_PAL[9] * 0.72 + np.array([4.0, 12.0, 28.0], dtype=np.float32)
            if is_walk or np.any(is_water) or is_tree_tile or np.any(outer_bg):
                smooth_16 = base_16.copy()
                for m_val, alpha, sig in ((1, 0.88, 0.95), (2, 0.85, 0.85), (3, 0.78, 0.78)):
                    m = (sem == m_val).astype(np.float32)
                    if np.sum(m) < 4:
                        continue
                    mode = "wrap" if (is_walk and t_id < p1 and not is_ground_shadow_tile and not is_road_curb) else "nearest"
                    denom = np.maximum(1e-4, gaussian_filter(m, sigma=sig, mode=mode))
                    for ch in range(3):
                        num = gaussian_filter(base_16[:, :, ch] * m, sigma=sig, mode=mode)
                        smooth_16[:, :, ch] = np.where(m > 0.5, base_16[:, :, ch] * (1.0 - alpha) + (num / denom) * alpha, smooth_16[:, :, ch])
                base_16 = smooth_16

            # 4× 保边平滑放大
            up32 = epx_2x_rgb(base_16)
            sem32 = epx_2x_mask(sem)
            up64 = epx_2x_rgb(up32)
            sem64 = epx_2x_mask(sem32)

            # 识别真石板广场 vs 自然沙滩/荒漠：仅以砌石为底的图集 (Set 1/4/5) 且排除海滩/岸边及沙地投影格 (s4:10/15, s5:11/12)，才叠石板纹；纯沙/沙漠港 (Set 0/2/3/6) 一律保持自然沙砾肌理
            is_sand_only_shadow_in_stone_set = (set_idx == 4 and t_id in (10, 15)) or (set_idx == 5 and t_id in (11, 12))
            is_stone_plaza = (
                (set_idx in (1, 4, 5))
                and not is_flat_beach
                and not is_shore_tile
                and not is_sand_only_shadow_in_stone_set
                and ((not is_walk) or (8 in uniq_idx))
            )

            # 对地面/水域去高频网格，对建筑/屋檐/船只使用双边保边滤波将 1993 阶梯像素平滑为水彩绘本砖木质感
            final64 = up64.copy()
            for m_val, sigma, mix in ((1, 1.8, 0.88), (2, 1.8, 0.90), (3, 1.5, 0.84)):
                m = (sem64 == m_val).astype(np.float32)
                if np.sum(m) < 16:
                    continue
                mode = "wrap" if ((is_walk and t_id < p1 and not is_ground_shadow_tile) or m_val == 1) else "nearest"
                denom = np.maximum(1e-4, gaussian_filter(m, sigma=sigma, mode=mode))
                for ch in range(3):
                    num = gaussian_filter(up64[:, :, ch] * m, sigma=sigma, mode=mode)
                    final64[:, :, ch] = np.where(m > 0.5, up64[:, :, ch] * (1.0 - mix) + (num / denom) * mix, final64[:, :, ch])

            # 门洞/船舱真实空腔 (void_64) 保持深邃暗影，其余建筑实体 (sem64 == 4 | sem64 == 0) 做双边保边绘面平滑
            void_16 = np.zeros_like(tile_idx, dtype=bool)
            if not is_ground_shadow_tile and not pure_water_ripple_tile and c0_cnt >= 48:
                lbl_v, n_v = label(tile_idx == 0)
                for vid in range(1, n_v + 1):
                    vm = lbl_v == vid
                    if int(np.sum(vm)) >= 48:
                        void_16 |= vm
            void_64 = np.repeat(np.repeat(void_16, 4, axis=0), 4, axis=1)

            arch_paint_mask = ((sem64 == 4) | (sem64 == 0)) & ~void_64
            if np.any(arch_paint_mask):
                final64 = bilateral_tile_rgb(final64, arch_paint_mask, sigma_s=1.25, sigma_c=36.0, radius=2)
                final64 = bilateral_tile_rgb(final64, arch_paint_mask, sigma_s=1.05, sigma_c=28.0, radius=2)
            if np.any(void_64):
                final64[void_64] = np.array([22.0, 20.0, 26.0], dtype=np.float32)

            m_water = (sem64 == 1).astype(np.float32)
            m_sand = (sem64 == 2).astype(np.float32)
            m_grass = (sem64 == 3).astype(np.float32)
            m_arch = ((sem64 == 4) | (sem64 == 0)).astype(np.float32)

            # 岸边浅水青绿光学吸收
            non_water = (sem64 != 1).astype(np.float32)
            shore_glow = np.clip(gaussian_filter(non_water, sigma=2.5, mode="nearest") * 2.1, 0.0, 1.0) * m_water
            shore_tint = np.array([22.0, 118.0, 158.0], dtype=np.float32)[None, None, :]
            final64 = np.where(
                shore_glow[:, :, None] > 0.02,
                final64 * (1.0 - shore_glow[:, :, None] * 0.48) + shore_tint * (shore_glow[:, :, None] * 0.48),
                final64,
            )

            # 叠加区分材质的物理微肌理：砖石广场 vs 风蚀沙滩/荒漠 vs 草簇 vs 建筑岩木
            g_alb = plaza_alb if is_stone_plaza else sand_alb
            g_hgt = plaza_hgt if is_stone_plaza else sand_hgt
            final64 = (
                final64
                + m_water[:, :, None] * water_alb
                + m_sand[:, :, None] * g_alb
                + m_grass[:, :, None] * grass_alb
                + m_arch[:, :, None] * arch_alb
            )

            # 2) 法线贴图高度场：基于保边平滑后的温和明度起伏，消除原版锯齿与点阵黑洞高光噪点
            lum = (0.299 * final64[:, :, 0] + 0.587 * final64[:, :, 1] + 0.114 * final64[:, :, 2]) / 255.0
            smooth_lum = gaussian_filter(lum, sigma=0.85, mode="nearest")
            arch_bump = np.where(void_64, 0.04, np.clip(0.32 + 0.58 * smooth_lum + arch_detail_h, 0.05, 1.0))
            micro_height = (
                m_sand * g_hgt * (0.62 if is_stone_plaza else 0.46)
                + m_grass * grass_hgt * 0.58
                + m_arch * arch_bump
                + m_water * 0.10
            )
            micro_height = gaussian_filter(micro_height, sigma=0.85, mode="nearest")

            # 物理高程：地上行走层 (~0.00)，纯水波纹 (~0.00)，半阻挡石栏 (~0.32)，实心建筑/门框/树冠/船体 (~0.85)
            # 闭运算前必须 edge 外扩，防止边缘被 scipy 默认清零而让屋顶/墙砖产生黑线格子！
            def edge_close(mask_bool: np.ndarray, k: int) -> np.ndarray:
                p = np.pad(mask_bool, ((k, k), (k, k)), mode="edge")
                c = binary_closing(p, structure=np.ones((k * 2 - 1, k * 2 - 1), dtype=bool))
                return c[k:-k, k:-k]

            if (is_walk and not is_arch_walk) or pure_water_ripple_tile or is_road_curb or is_flat_beach or is_ground_stair:
                tile_elev = np.zeros_like(micro_height)
            elif is_tree_tile:
                # 仅树木剪影内部填洞隆起（绝不到图块方框边！）
                tree_raw = ((sem64 == 4) | (sem64 == 0)) & ~void_64
                tree_filled = binary_fill_holes(tree_raw) | tree_raw
                tile_elev = gaussian_filter(np.where(tree_filled, 0.72, 0.0).astype(np.float32), sigma=1.4, mode="nearest")
            elif t_id < p2 and not is_arch_walk:
                solid_m = edge_close(((sem64 == 4) | (sem64 == 0)) & ~void_64, 4) & (sem64 != 1) & ~void_64
                tile_elev = gaussian_filter(np.where(solid_m, 0.34, 0.0).astype(np.float32), sigma=1.4, mode="nearest")
            elif t_id in SHIP_OVER_WALL_BG.get(set_idx, {}):
                bg_tid, bg_elev = SHIP_OVER_WALL_BG[set_idx][t_id]
                br, bc = bg_tid // cols, bg_tid % cols
                bg_tile = idx_all[br * tile_sz:(br + 1) * tile_sz, bc * tile_sz:(bc + 1) * tile_sz]
                outer_bg_64 = np.repeat(np.repeat(outer_bg, 4, axis=0), 4, axis=1)
                ship_fg_16 = (tile_idx != bg_tile) & ~outer_bg & ~is_water
                ship_fg_64 = np.repeat(np.repeat(ship_fg_16, 4, axis=0), 4, axis=1)
                ship_fg_64 = edge_close(ship_fg_64, 3) & ~outer_bg_64 & (sem64 != 1)
                solid_wall = ~outer_bg_64 & (sem64 != 1)
                base_e = np.where(ship_fg_64, 0.88, np.where(solid_wall, bg_elev, 0.0))
                tile_elev = gaussian_filter(base_e.astype(np.float32), sigma=1.4, mode="nearest")
            elif t_id in QUAY_PARAPET_ELEV.get(set_idx, {}):
                p_elev = QUAY_PARAPET_ELEV[set_idx][t_id]
                outer_bg_64 = np.repeat(np.repeat(outer_bg, 4, axis=0), 4, axis=1)
                solid_wall = ~outer_bg_64 & (sem64 != 1)
                base_e = np.where(solid_wall, p_elev, 0.0)
                tile_elev = gaussian_filter(base_e.astype(np.float32), sigma=1.4, mode="nearest")
            else:
                caster_raw = ((sem64 == 4) | (sem64 == 0)) & ~void_64
                solid_m = edge_close(caster_raw, 4) & (sem64 != 1) & ~void_64
                base_e = np.where(solid_m, 0.85, 0.0)
                tile_elev = gaussian_filter(base_e.astype(np.float32), sigma=1.4, mode="nearest")

            nrm_tile = height_to_normal_rgba(micro_height, tile_elev, strength=2.6)

            # 3) 材质掩膜 (_mat.png): R=Water, G=Emissive窗户灯火, B=高光粗糙质感, A=Shadow接收
            em_16 = detect_emissive_windows(tile_idx, t_id, p2, is_water)
            em_64 = np.repeat(np.repeat(em_16, 4, axis=0), 4, axis=1)
            em_64 = np.clip(gaussian_filter(em_64, sigma=1.4, mode="nearest") * 1.15, 0.0, 1.0)
            em_64 = np.where(em_64 > 0.12, em_64, 0.0)

            spec = np.where(
                m_water > 0.5, 0.90,
                np.where(em_64 > 0.25, 0.78,
                np.where(sem64 == 4, np.clip(0.14 + smooth_lum * 0.24, 0.14, 0.36),
                np.where(sem64 == 2, 0.18 if is_stone_plaza else 0.07, 0.06)))
            )

            dy, dx = r * hd_tile, c * hd_tile
            alb_out[dy:dy + hd_tile, dx:dx + hd_tile, :3] = np.clip(np.round(final64), 0, 255).astype(np.uint8)
            alb_out[dy:dy + hd_tile, dx:dx + hd_tile, 3] = 255
            nrm_out[dy:dy + hd_tile, dx:dx + hd_tile] = nrm_tile
            mat_out[dy:dy + hd_tile, dx:dx + hd_tile, 0] = np.clip(np.round(m_water * 255.0), 0, 255).astype(np.uint8)
            mat_out[dy:dy + hd_tile, dx:dx + hd_tile, 1] = np.clip(np.round(em_64 * 255.0), 0, 255).astype(np.uint8)
            mat_out[dy:dy + hd_tile, dx:dx + hd_tile, 2] = np.clip(np.round(spec * 255.0), 0, 255).astype(np.uint8)
            mat_out[dy:dy + hd_tile, dx:dx + hd_tile, 3] = 255

    os.makedirs(HD_SHEETS, exist_ok=True)
    p_alb = os.path.join(HD_SHEETS, f"portchip_{set_idx}.png")
    p_nrm = os.path.join(HD_SHEETS, f"portchip_{set_idx}_nrm.png")
    p_mat = os.path.join(HD_SHEETS, f"portchip_{set_idx}_mat.png")
    Image.fromarray(alb_out, mode="RGBA").save(p_alb, optimize=True)
    Image.fromarray(nrm_out, mode="RGBA").save(p_nrm, optimize=True)
    Image.fromarray(mat_out, mode="RGBA").save(p_mat, optimize=True)
    return p_alb

def process_chars_sheet():
    """生成锐利高质感 4× 角色雪碧图与凹凸法线图（配合 HD-2D 聚光、轮廓边缘光与地面脚底投影）"""
    src_path = os.path.join(ART_SHEETS, "chars.png")
    rgba = np.array(Image.open(src_path).convert("RGBA"))
    idx_all = extract_indices(rgba, prefer_map=False)
    H, W = idx_all.shape
    tile_sz = 32
    cols, rows = W // tile_sz, H // tile_sz
    hd_tile = 128

    hd_out = np.zeros((rows * hd_tile, cols * hd_tile, 4), dtype=np.uint8)
    nrm_out = np.zeros((rows * hd_tile, cols * hd_tile, 4), dtype=np.uint8)

    yy, xx = np.mgrid[0:hd_tile, 0:hd_tile].astype(np.float32)
    cx_norm = (xx - hd_tile * 0.5) / (hd_tile * 0.5)
    struct8 = np.ones((3, 3), dtype=bool)

    for r in range(rows):
        for c in range(cols):
            tile_idx = idx_all[r * tile_sz:(r + 1) * tile_sz, c * tile_sz:(c + 1) * tile_sz]
            body = (tile_idx > 0) & (tile_idx < 16)
            # 剔除原版角色贴图左侧/脚底自带的黑色投影块，仅保留紧贴主体像素 (8 邻域) 的 1px 轮廓与五官描边，避免与实时光影重叠成黑块
            keep_mask = body | ((tile_idx == 0) & binary_dilation(body, structure=struct8))
            alpha32 = keep_mask.astype(np.float32)
            base32 = dedither_tile_rgb(np.where(keep_mask, tile_idx, 0), MODERN_SPRITE_PAL, SPRITE_DITHER_PAIRS)
            base_rgba = np.dstack([base32, alpha32 * 255.0])

            # 保持清晰锐利的角色立体轮廓 (仅 4x EPX + 极轻量内抗锯齿)
            up64 = epx_2x_rgb(base_rgba)
            up128 = epx_2x_rgb(up64)

            solid = up128[:, :, 3] >= 128
            rgb128 = up128[:, :, :3].copy()
            smooth = gaussian_filter(rgb128, sigma=(0.45, 0.45, 0.0), mode="nearest")
            rgb128 = np.where(solid[:, :, None], rgb128 * 0.80 + smooth * 0.20, rgb128)
            a_soft = np.where(solid, 255.0, np.clip(gaussian_filter(solid.astype(np.float32), sigma=0.5) * 190.0, 0, 160))

            # 生成角色立体圆柱形+明暗凸起法线，让侧面轮廓在阳光/灯火下出现强边缘光
            lum = (0.299 * rgb128[:, :, 0] + 0.587 * rgb128[:, :, 1] + 0.114 * rgb128[:, :, 2]) / 255.0
            h_char = np.where(solid, 0.45 + 0.40 * lum - 0.18 * (cx_norm * cx_norm), 0.0)
            h_char = gaussian_filter(h_char, sigma=1.1, mode="nearest")
            nrm_char = height_to_normal_rgba(h_char, solid.astype(np.float32), strength=3.0)

            dy, dx = r * hd_tile, c * hd_tile
            hd_out[dy:dy + hd_tile, dx:dx + hd_tile, :3] = np.clip(np.round(rgb128), 0, 255).astype(np.uint8)
            hd_out[dy:dy + hd_tile, dx:dx + hd_tile, 3] = np.clip(np.round(a_soft), 0, 255).astype(np.uint8)
            nrm_out[dy:dy + hd_tile, dx:dx + hd_tile] = nrm_char

    p_alb = os.path.join(HD_SHEETS, "chars.png")
    p_nrm = os.path.join(HD_SHEETS, "chars_nrm.png")
    Image.fromarray(hd_out, mode="RGBA").save(p_alb, optimize=True)
    Image.fromarray(nrm_out, mode="RGBA").save(p_nrm, optimize=True)
    return p_alb

def main():
    meta = json.load(open(PORTCHIP_JSON, "r", encoding="utf-8"))
    water_adj, open_edges = compute_portmap_context(meta)
    mats = make_tactile_materials(64)
    for s, bounds in enumerate(meta["tilesets"]):
        _, p1, p2, p3 = bounds
        out_p = process_portchip_sheet(s, p1, p2, p3, mats, water_adj[s], open_edges[s])
        print(f"Generated PBR set for portchip_{s}: {os.path.relpath(out_p, ROOT)} (+ _nrm / _mat)")
    out_c = process_chars_sheet()
    print(f"Generated PBR set for chars: {os.path.relpath(out_c, ROOT)} (+ _nrm)")

if __name__ == "__main__":
    main()
