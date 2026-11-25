"""build_hd_textures.py — 生成《八方旅人》风格 HD-2D 港口 PBR 材质图集
为每个港口图集 (portchip_0..6) 与角色图集 (chars) 生成 4× 分辨率贴图：
  - portchip_{s}.png      : 高质感真彩漫反射贴图 (Albedo，保留锐利石砖/瓦片/木纹/草叶颗粒感)
  - portchip_{s}_nrm.png  : 切线空间凹凸法线 (RGB) + 物理高程遮挡高度 (A，用于实时斜向太阳投影)
  - portchip_{s}_mat.png  : 材质属性掩膜 (R=水体动态反射遮罩, G=夜景发光窗户/灯火, B=高光/湿润度, A=漫反射保留度)
  - chars.png / chars_nrm.png : 4× 清晰轮廓角色与法线高光贴图
"""
import json
import math
import os
from PIL import Image
import numpy as np
from scipy.ndimage import binary_closing, binary_fill_holes, gaussian_filter, label, sobel

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART_SHEETS = os.path.join(ROOT, "web", "assets", "art", "sheets")
HD_SHEETS = os.path.join(ROOT, "web", "assets", "art", "hd", "sheets")
PORTCHIP_JSON = os.path.join(ROOT, "web", "assets", "data", "portchip.json")

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

# 更有厚重感与电影感的基础色调（适度压暗过亮色，给 HDR Bloom 与实时太阳光照留出动态范围）
MODERN_GROUND_PAL = np.array([
    [16, 15, 22],     # 0: 深暖炭黑结构线/门洞阴影
    [26, 78, 198],    # 1: 皇家钴蓝
    [194, 78, 22],    # 2: 暖红褐
    [194, 104, 156],  # 3: 紫粉
    [28, 152, 96],    # 4: 翠青
    [48, 156, 224],   # 5: 晴蓝
    [232, 156, 84],   # 6: 暖琥珀灯火/皮肤
    [226, 214, 194],  # 7: 暖象牙石膏
    [106, 114, 130],  # 8: 温润青石板灰
    [14, 62, 132],    # 9: 深港湾蓝
    [162, 114, 58],   # 10: 暖赭土/木梁
    [212, 178, 110],  # 11: 暖砂岩/日光木纹
    [54, 136, 206],   # 12: 亮波蓝/窗玻璃
    [34, 108, 66],    # 13: 浓草地暗部/铜绿瓦暗部
    [54, 152, 78],    # 14: 鲜草坪
    [230, 218, 198],  # 15: 日光石膏高光
], dtype=np.float32)

MODERN_SPRITE_PAL = np.array([
    [18, 16, 24],     # 0: 锐利暗描边
    [28, 84, 210],    # 1: 皇家蓝阴影
    [196, 82, 24],    # 2: 皮革棕红
    [202, 110, 162],  # 3: 玫瑰饰边
    [26, 162, 102],   # 4: 翠绿衣饰
    [48, 166, 238],   # 5: 亮海蓝外衣 (主角约翰)
    [240, 168, 104],  # 6: 暖肤色
    [238, 226, 208],  # 7: 象牙白衬衫
    [110, 116, 136],  # 8: 蓝灰阴影
    [24, 78, 182],    # 9: 深蓝
    [154, 92, 34],    # 10: 棕皮革/褐发
    [226, 182, 100],  # 11: 金发/暖高光
    [54, 142, 235],   # 12: 浅蓝
    [34, 112, 92],    # 13: 深绿
    [48, 166, 96],    # 14: 翠绿
    [240, 228, 210],  # 15: 亮象牙白
], dtype=np.float32)

# 建筑专用色盘：将原版暗蓝青阴影 index 13 压成沉稳石青瓦灰，消除木门和灰墙里跳眼的鲜绿点
MODERN_ARCH_PAL = MODERN_GROUND_PAL.copy()
MODERN_ARCH_PAL[13] = [44, 72, 74]
MODERN_ARCH_PAL[14] = [52, 136, 96]

# 仅对“真正纯大面积平铺”的沙地/草坪/水体做棋盘格消噪，保留砖块与木门肌理
GROUND_DITHER_PAIRS = {
    (10, 11), (11, 10),
    (11, 15), (15, 11),
    (11, 7), (7, 11),
    (13, 14), (14, 13),
    (9, 12), (12, 9),
    (8, 15), (15, 8),
    (8, 7), (7, 8),
}

# 建筑只去除大块白灰粉墙、蓝灰瓦顶与门扇的阴影点阵，保留石砖与木门框结构
ARCH_DITHER_PAIRS = {
    (11, 15), (15, 11),
    (11, 7), (7, 11),
    (12, 15), (15, 12),
    (12, 7), (7, 12),
    (13, 14), (14, 13),
    (8, 13), (13, 8),
    (10, 13), (13, 10),
    (9, 12), (12, 9),
    (0, 10), (10, 0),
    (0, 13), (13, 0),
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
    """生成带物理凹凸高度场的多材质无缝周期贴图（石板路/砂砾、草簇、水底与微岩理）"""
    yy, xx = np.mgrid[0:sz, 0:sz].astype(np.float32)

    # 1. 地中海铺石广场 (4x4 错缝石板：物理凹凸高度 + 矿物砂粒颜色起伏)
    row_idx = np.floor(yy / 16.0)
    ox = (xx + (row_idx % 2) * 8.0) % 16.0
    oy = yy % 16.0
    # 到石板边缘距离 (0..8) -> 倒角斜坡营造真实立体感
    dx = np.minimum(ox, 16.0 - ox)
    dy = np.minimum(oy, 16.0 - oy)
    edge_d = np.minimum(dx, dy)
    bevel = np.clip(edge_d / 2.2, 0.0, 1.0)
    grout = 1.0 - bevel
    # 每块石板给一点微小的暖冷色调随机偏移
    cell_id = (row_idx % 4) * 4 + (np.floor((xx + (row_idx % 2) * 8.0) / 16.0) % 4)
    tile_tone = np.sin(cell_id * 12.9898) * 0.5
    sand_grain = periodic_noise(sz, (6, 12, 22), seed=107)
    sand_broad = periodic_noise(sz, (2, 4), seed=109)

    sand_albedo = (
        tile_tone * 6.5
        + sand_broad * 5.0
        + sand_grain * 4.8
        - grout * 16.0
    )[:, :, None] * np.array([1.04, 0.96, 0.78], dtype=np.float32)
    sand_height = np.clip(0.55 * bevel + 0.16 * sand_grain + 0.12 * sand_broad, 0.0, 1.0)

    # 2. 锐利有层次的草簇质感 (并非一片糊绿)
    g_clump = periodic_noise(sz, (4, 8), seed=205)
    g_blade = periodic_noise(sz, (12, 22, 30), seed=208)
    grass_albedo = (g_clump * 10.5 + g_blade * 9.0)[:, :, None] * np.array([0.75, 1.18, 0.56], dtype=np.float32)
    grass_height = np.clip(0.45 + 0.35 * g_clump + 0.25 * g_blade, 0.0, 1.0)

    # 3. 港湾深水底色 (波动留给 WebGL2 实时着色器，保留柔和水深过渡)
    w_deep = periodic_noise(sz, (2, 4), seed=303)
    water_albedo = (w_deep * 6.0)[:, :, None] * np.array([0.45, 0.85, 1.2], dtype=np.float32)

    # 4. 建筑石材与木纹细微肌理 (不破坏砖块，补充表面粗糙微颗粒)
    arch_grain = periodic_noise(sz, (8, 16, 26), seed=407)
    arch_albedo = (arch_grain * 5.5)[:, :, None] * np.array([1.0, 0.98, 0.93], dtype=np.float32)

    return sand_albedo, sand_height, grass_albedo, grass_height, water_albedo, arch_albedo

def dedither_tile_rgb(
    idx_tile: np.ndarray,
    pal_rgb: np.ndarray,
    dither_pairs: set,
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
            if not matches:
                continue
            diag_same = 0
            for dy, dx in ((-1, -1), (-1, 1), (1, -1), (1, 1)):
                pos = get_px(y + dy, x + dx)
                if pos is not None and int(clean_idx[pos[0], pos[1]]) == ci:
                    diag_same += 1
            avg_nb = np.mean([rgb for _, rgb in matches], axis=0)
            if (len(matches) >= 2 and diag_same >= 1) or len(matches) >= 3:
                out[y, x] = base[y, x] * 0.50 + avg_nb * 0.50
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

def process_portchip_sheet(set_idx: int, p1: int, p2: int, p3: int, mats):
    src_path = os.path.join(ART_SHEETS, f"portchip_{set_idx}.png")
    rgba = np.array(Image.open(src_path).convert("RGBA"))
    idx_all = extract_indices(rgba, prefer_map=True)
    H, W = idx_all.shape
    tile_sz = 16
    hd_tile = 64
    cols, rows = W // tile_sz, H // tile_sz

    sand_alb, sand_hgt, grass_alb, grass_hgt, water_alb, arch_alb = mats

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
            # 仅把真正连片水域 (连通域>=14像素且主要包含深水色 9, 排除石砖高亮蓝点与王宫蓝鹰盾牌) 识别为动态水面
            lbl_arr, n_comp = label(is_blue, structure=np.ones((3, 3), dtype=np.int32))
            water_base = np.zeros_like(is_blue)
            for cid in range(1, n_comp + 1):
                comp_m = (lbl_arr == cid)
                area = int(np.sum(comp_m))
                deep_cnt = int(np.sum(comp_m & (tile_idx == 9)))
                if area >= 14 and deep_cnt >= 6:
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
            is_grass_shadow_tile = (t_id < p2) and (c0_cnt >= 90) and uniq_idx.issubset({0, 13, 14})
            is_sand_shadow_tile = (t_id < p2) and (c0_cnt >= 90) and (
                uniq_idx.issubset({0, 8, 10, 11, 15}) or uniq_idx.issubset({0, 10, 13})
            )
            is_ground_shadow_tile = is_grass_shadow_tile or is_sand_shadow_tile

            # 行1 (t_id >= 16) 且位于 < p2 的多黑线建筑底座/门扇 (如门下半格 22, 23 / 屋顶 26) 归为建筑，但排除纯地面墙影 (21, 27 等)
            is_arch_walk = (t_id >= 16) and (t_id < p2) and (c0_cnt >= 25) and not np.any(is_water) and not is_ground_shadow_tile
            is_walk = (t_id < p2) and not is_arch_walk
            is_tree_tile = (t_id >= p2) and (int(np.sum((tile_idx == 13) | (tile_idx == 14))) >= 120) and not np.any(is_water) and (c0_cnt >= 8)
            is_shore_tile = (t_id >= p2) and np.any(is_water) and (int(np.sum((tile_idx == 13) | (tile_idx == 14))) >= 18)

            sem[is_water] = 1
            if is_ground_shadow_tile:
                # 原版建筑左侧的纯黑硬块投影：还原为平坦草坪/砂地，把真实投影完全交给 WebGL2 实时太阳光影！
                sem[:, :] = 3 if is_grass_shadow_tile else 2
            elif is_walk:
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
                sem[outer_grass] = 3
            else:
                if np.any(is_water):
                    sem[((tile_idx == 13) | (tile_idx == 14)) & ~is_water] = 3
                    blk_pad = np.pad((tile_idx == 0).astype(np.int32), ((1, 1), (1, 1)), mode="edge")
                    blk_near = sum(blk_pad[dy:dy + tile_sz, dx:dx + tile_sz] for dy in range(3) for dx in range(3))
                    sem[((tile_idx == 10) | (tile_idx == 11)) & (blk_near == 0) & ~is_water] = 2
            if not is_ground_shadow_tile:
                sem[tile_idx == 0] = 0
            sem[is_water] = 1

            # 1) Albedo: 地面、海岸草坡与树格使用草地色盘，其余实体建筑使用建筑色盘（含门下半格 22/23）
            pairs = GROUND_DITHER_PAIRS if (is_walk or is_shore_tile or is_tree_tile) else ARCH_DITHER_PAIRS
            tile_pal = MODERN_GROUND_PAL if (is_walk or is_tree_tile or is_shore_tile) else MODERN_ARCH_PAL
            base_16 = dedither_tile_rgb(tile_idx, tile_pal, pairs, is_water=is_water, wrap_edges=(is_walk and t_id < p1 and not is_ground_shadow_tile))
            if is_ground_shadow_tile:
                if is_grass_shadow_tile:
                    fill_col = MODERN_GROUND_PAL[13] * 0.45 + MODERN_GROUND_PAL[14] * 0.55
                else:
                    fill_col = MODERN_GROUND_PAL[10] * 0.45 + MODERN_GROUND_PAL[11] * 0.55
                base_16[tile_idx == 0] = fill_col
            if pure_water_ripple_tile:
                # 153 等水上影波纹格：只保留柔和深暗水波层次，不生成刺眼黑刺团块
                dark_ripple = (tile_idx == 0) | (tile_idx == 8)
                base_16[dark_ripple] = MODERN_GROUND_PAL[9] * 0.72 + np.array([4.0, 12.0, 28.0], dtype=np.float32)
            if is_walk or np.any(is_water) or is_tree_tile:
                smooth_16 = base_16.copy()
                for m_val, alpha, sig in ((1, 0.88, 0.95), (2, 0.85, 0.85), (3, 0.78, 0.78)):
                    m = (sem == m_val).astype(np.float32)
                    if np.sum(m) < 4:
                        continue
                    mode = "wrap" if (is_walk and t_id < p1) else "nearest"
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

            # 对地面/水域去高频网格，对建筑主体只做极轻微抗毛刺 (sigma=0.38, mix=0.22) 保留石块锐度
            final64 = up64.copy()
            for m_val, sigma, mix in ((1, 1.8, 0.88), (2, 1.8, 0.90), (3, 1.5, 0.84), (4, 0.42, 0.25)):
                m = (sem64 == m_val).astype(np.float32)
                if np.sum(m) < 16:
                    continue
                mode = "wrap" if ((is_walk and t_id < p1) or m_val == 1) else "nearest"
                denom = np.maximum(1e-4, gaussian_filter(m, sigma=sigma, mode=mode))
                for ch in range(3):
                    num = gaussian_filter(up64[:, :, ch] * m, sigma=sigma, mode=mode)
                    final64[:, :, ch] = np.where(m > 0.5, up64[:, :, ch] * (1.0 - mix) + (num / denom) * mix, final64[:, :, ch])

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

            # 叠加上高对比度立体铺石 / 草簇 / 石砖颗粒
            final64 = (
                final64
                + m_water[:, :, None] * water_alb
                + m_sand[:, :, None] * sand_alb
                + m_grass[:, :, None] * grass_alb
                + m_arch[:, :, None] * arch_alb
            )

            # 2) 法线贴图高度场 + 物理高程 Elevation（用于实时光影与方向投影）
            lum = (0.299 * final64[:, :, 0] + 0.587 * final64[:, :, 1] + 0.114 * final64[:, :, 2]) / 255.0
            # 黑描边凹陷深度 (砖缝/窗格缝/瓦片缝)，亮部凸起 -> 产生强烈的立体雕刻法线！
            arch_bump = np.where(sem64 == 0, 0.08, 0.35 + 0.65 * lum)
            micro_height = (
                m_sand * sand_hgt * 0.65
                + m_grass * grass_hgt * 0.72
                + m_arch * arch_bump
                + m_water * 0.10
            )
            micro_height = gaussian_filter(micro_height, sigma=0.75, mode="nearest")

            # 物理高程：地上行走层 (~0.00)，纯水波纹 (~0.00)，半阻挡石栏 (~0.32)，实心建筑/门框/树冠/船体 (~0.85)
            # 闭运算前必须 edge 外扩，防止边缘被 scipy 默认清零而让屋顶/墙砖产生黑线格子！
            def edge_close(mask_bool: np.ndarray, k: int) -> np.ndarray:
                p = np.pad(mask_bool, ((k, k), (k, k)), mode="edge")
                c = binary_closing(p, structure=np.ones((k * 2 - 1, k * 2 - 1), dtype=bool))
                return c[k:-k, k:-k]

            if (is_walk and not is_arch_walk) or pure_water_ripple_tile:
                tile_elev = np.zeros_like(micro_height)
            elif is_tree_tile:
                # 仅树木剪影内部填洞隆起（绝不到图块方框边！）
                tree_raw = (sem64 == 4) | (sem64 == 0)
                tree_filled = binary_fill_holes(tree_raw) | tree_raw
                tile_elev = gaussian_filter(np.where(tree_filled, 0.72, 0.0).astype(np.float32), sigma=1.4, mode="nearest")
            elif t_id < p2 and not is_arch_walk:
                solid_m = edge_close((sem64 == 4) | (sem64 == 0), 4) & (sem64 != 1)
                tile_elev = gaussian_filter(np.where(solid_m, 0.34, 0.0).astype(np.float32), sigma=1.4, mode="nearest")
            else:
                caster_raw = (sem64 == 4) | (sem64 == 0)
                solid_m = edge_close(caster_raw, 4) & (sem64 != 1)
                base_e = np.where(solid_m, 0.85, 0.0)
                tile_elev = gaussian_filter(base_e.astype(np.float32), sigma=1.4, mode="nearest")

            nrm_tile = height_to_normal_rgba(micro_height, tile_elev, strength=3.4)

            # 3) 材质掩膜 (_mat.png): R=Water, G=Emissive窗户灯火, B=高光镜面度, A=Shadow接收
            em_16 = detect_emissive_windows(tile_idx, t_id, p2, is_water)
            em_64 = np.repeat(np.repeat(em_16, 4, axis=0), 4, axis=1)
            em_64 = np.clip(gaussian_filter(em_64, sigma=1.4, mode="nearest") * 1.15, 0.0, 1.0)
            em_64 = np.where(em_64 > 0.12, em_64, 0.0)

            spec = np.where(
                m_water > 0.5, 0.92,
                np.where(em_64 > 0.25, 0.80,
                np.where(sem64 == 4, np.clip(lum * 0.65, 0.12, 0.65),
                np.where(sem64 == 2, 0.22, 0.08)))
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

    for r in range(rows):
        for c in range(cols):
            tile_idx = idx_all[r * tile_sz:(r + 1) * tile_sz, c * tile_sz:(c + 1) * tile_sz]
            alpha32 = (tile_idx < 16).astype(np.float32)
            base32 = dedither_tile_rgb(np.where(tile_idx < 16, tile_idx, 0), MODERN_SPRITE_PAL, SPRITE_DITHER_PAIRS)
            base_rgba = np.dstack([base32, alpha32 * 255.0])

            # 保持八方旅人式清晰立体轮廓 (仅 4x EPX + 极轻量内抗锯齿)
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
    mats = make_tactile_materials(64)
    for s, bounds in enumerate(meta["tilesets"]):
        _, p1, p2, p3 = bounds
        out_p = process_portchip_sheet(s, p1, p2, p3, mats)
        print(f"Generated PBR set for portchip_{s}: {os.path.relpath(out_p, ROOT)} (+ _nrm / _mat)")
    out_c = process_chars_sheet()
    print(f"Generated PBR set for chars: {os.path.relpath(out_c, ROOT)} (+ _nrm)")

if __name__ == "__main__":
    main()
