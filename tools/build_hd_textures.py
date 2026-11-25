"""build_hd_textures.py — 生成港内 4× 真彩 HD-2D 贴图集 (portchip_0..6 + chars)

管线设计：
1. 从原版 16 色索引图集 (256x240 / 256x288) 精确还原每个像素的 VGA 色号 (0..15 / 255 透明)。
2. 材质与结构语义分离：
   - 识别水体 (含水内 1px 孤立黑点波纹)、草地、沙石路面、建筑墙体/屋顶、系泊帆船及看板。
   - 仅对同材质交错棋盘格做智能去抖动 (De-dithering)，保留建筑线条、窗框、缆绳与徽章轮廓。
3. 4× 矢量保边平滑放大 (双层 EPX/Scale2x + 局部反走样) 至每格 64x64 (角色 128x128)。
4. 叠加世界坐标连续的 64x64 周期无缝材质纹理（水波光影、地中海石板/砂砾、草地植被与木石质感）与柔和 AO 阴影，输出真彩 RGBA PNG 至 web/assets/art/hd/sheets/。
"""
import json
import math
import os
from PIL import Image
import numpy as np
from scipy.ndimage import gaussian_filter

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

# 现代真彩基础材质色盘（严格对齐 DAY_PAL_RGB 各色号真意，去除生硬 4-bit 量化感）
MODERN_GROUND_PAL = np.array([
    [18, 17, 24],     # 0: 深邃暖黑描边/阴角
    [24, 82, 208],    # 1: 皇家钴蓝 (徽章/盾牌/服装)
    [206, 84, 24],    # 2: 暖赭红褐 (皮革/木饰)
    [206, 110, 164],  # 3: 玫瑰紫
    [28, 162, 102],   # 4: 翠青绿
    [52, 168, 236],   # 5: 晴空亮蓝
    [238, 166, 98],   # 6: 暖蜜桃/琥珀金
    [242, 230, 210],  # 7: 暖象牙白
    [116, 124, 140],  # 8: 温润石板灰
    [20, 78, 158],    # 9: 深海钴蓝 (港内水深基色)
    [176, 126, 66],   # 10: 暖赭土 / 铺石阴影
    [228, 194, 122],  # 11: 暖石灰砂 / 日照木石
    [68, 154, 224],   # 12: 晴波浅蓝
    [38, 122, 74],    # 13: 浓绿草坪暗部
    [62, 168, 86],    # 14: 生机翠绿草坪
    [244, 233, 214],  # 15: 暖白石膏高光 / 浪花
], dtype=np.float32)

MODERN_ARCH_PAL = MODERN_GROUND_PAL.copy()

MODERN_SPRITE_PAL = np.array([
    [20, 18, 24],     # 0: 干净暗褐黑描边
    [28, 84, 212],    # 1: 皇家海蓝外套阴影/斗篷
    [198, 82, 24],    # 2: 暖红褐皮革/靴子/红发
    [204, 112, 166],  # 3: 紫粉饰边
    [26, 164, 104],   # 4: 翠绿衣饰
    [48, 168, 240],   # 5: 亮海蓝外衣 (约翰主角主色)
    [242, 170, 106],  # 6: 暖肤色/金棕发
    [245, 232, 214],  # 7: 暖象牙白衬衫/裤装
    [112, 118, 138],  # 8: 蓝灰裤装阴影
    [24, 78, 182],    # 9: 深海蓝服饰
    [156, 94, 34],    # 10: 棕皮革/褐发
    [230, 186, 104],  # 11: 金发/草帽/暖皮亮部
    [54, 142, 235],   # 12: 浅蓝外套/护肩
    [34, 112, 92],    # 13: 深松绿外套
    [48, 168, 98],    # 14: 翠绿衣饰
    [246, 234, 216],  # 15: 高光象牙白
], dtype=np.float32)

# 可安全去抖动的同材质色对（仅当局部呈现 2x2 棋盘交错时融合）
PORT_DITHER_PAIRS = {
    (10, 11), (11, 10),
    (11, 15), (15, 11),
    (11, 7), (7, 11),
    (10, 15), (15, 10),
    (10, 7), (7, 10),
    (13, 14), (14, 13),
    (9, 12), (12, 9),
    (12, 15), (15, 12),
    (12, 7), (7, 12),
    (8, 13), (13, 8),
    (8, 10), (10, 8),
    (8, 11), (11, 8),
    (8, 15), (15, 8),
    (8, 7), (7, 8),
    (13, 15), (15, 13),
    (13, 7), (7, 13),
    (0, 8), (8, 0),
    (0, 10), (10, 0),
    (0, 13), (13, 0),
}

SPRITE_DITHER_PAIRS = {
    (8, 12), (12, 8),
    (9, 12), (12, 9),
    (10, 11), (11, 10),
    (6, 11), (11, 6),
    (6, 7), (7, 6),
    (6, 15), (15, 6),
    (8, 15), (15, 8),
    (8, 7), (7, 8),
    (13, 14), (14, 13),
    (12, 15), (15, 12),
    (12, 7), (7, 12),
    (8, 9), (9, 8),
    (10, 6), (6, 10),
    (11, 15), (15, 11),
    (11, 7), (7, 11),
}

MAP_PAL_ORDER = [0, 8, 9, 10, 11, 12, 13, 14, 15, 1, 2, 3, 4, 5, 6, 7]

def extract_indices(rgba: np.ndarray, prefer_map: bool = True):
    """把 PNG RGBA 像素映射回原版 16 色索引 (0..15) 与透明度 (255)"""
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
    """向量化 2× EPX (Scale2x) 保边放大，支持 float32 RGBA/RGB 数组"""
    h, w, c = img.shape
    p = np.pad(img, ((1, 1), (1, 1), (0, 0)), mode="edge")
    P = p[1:-1, 1:-1]
    A = p[:-2, 1:-1]
    B = p[1:-1, 2:]
    C = p[1:-1, :-2]
    D = p[2:, 1:-1]

    # 对近似色容忍微小差异以适配柔和过渡区域
    eq = lambda u, v: np.max(np.abs(u - v), axis=2) < 10.0
    neq_AD = ~eq(A, D)
    neq_CB = ~eq(C, B)
    cond = neq_AD & neq_CB

    out = np.empty((h * 2, w * 2, c), dtype=img.dtype)
    p1 = np.where((cond & eq(C, A))[:, :, None], C, P)
    p2 = np.where((cond & eq(A, B))[:, :, None], B, P)
    p3 = np.where((cond & eq(D, C))[:, :, None], C, P)
    p4 = np.where((cond & eq(B, D))[:, :, None], B, P)
    out[0::2, 0::2] = p1
    out[0::2, 1::2] = p2
    out[1::2, 0::2] = p3
    out[1::2, 1::2] = p4
    return out

def epx_2x_mask(mask: np.ndarray) -> np.ndarray:
    """二值/类别掩膜 2× Scale2x 放大，与彩色层轮廓严格同步"""
    h, w = mask.shape
    p = np.pad(mask, ((1, 1), (1, 1)), mode="edge")
    P = p[1:-1, 1:-1]
    A, B, C, D = p[:-2, 1:-1], p[1:-1, 2:], p[1:-1, :-2], p[2:, 1:-1]
    cond = (A != D) & (C != B)
    out = np.empty((h * 2, w * 2), dtype=mask.dtype)
    out[0::2, 0::2] = np.where(cond & (C == A), C, P)
    out[0::2, 1::2] = np.where(cond & (A == B), B, P)
    out[1::2, 0::2] = np.where(cond & (D == C), C, P)
    out[1::2, 1::2] = np.where(cond & (B == D), B, P)
    return out

def periodic_noise(sz: int, freqs=(2, 4, 8), seed=42) -> np.ndarray:
    """生成严格 [0, sz) 周期平滑 2D 噪声，确保相邻图块接缝处 100% 连续无断层"""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:sz, 0:sz].astype(np.float32) * (2.0 * math.pi / sz)
    acc = np.zeros((sz, sz), dtype=np.float32)
    weight_sum = 0.0
    for idx_f, freq in enumerate(freqs):
        w = 1.0 / (1.0 + idx_f * 0.85)
        for _ in range(4):
            kx = int(rng.integers(1, freq + 1)) * (1 if rng.random() > 0.5 else -1)
            ky = int(rng.integers(1, freq + 1)) * (1 if rng.random() > 0.5 else -1)
            ph = float(rng.uniform(0, 2.0 * math.pi))
            acc += w * np.sin(kx * xx + ky * yy + ph)
        weight_sum += w * 4.0
    acc /= max(1e-5, weight_sum)
    # 归一化到大约 [-1, 1]
    m = np.max(np.abs(acc))
    return acc / max(1e-5, m)

def make_seamless_materials(tile_hd: int = 64):
    """生成 64x64 周期无缝材质变化层（砂石地面 / 翠绿草坪 / 港湾水波 / 砖石建筑纹理）"""
    yy, xx = np.mgrid[0:tile_hd, 0:tile_hd].astype(np.float32)
    t_x = xx * (2.0 * math.pi / tile_hd)
    t_y = yy * (2.0 * math.pi / tile_hd)

    # 1. 地中海砂石广场纹理 (细腻天然石灰砂砾肌理，无斜条纹和硬网格感)
    n_sand_broad = periodic_noise(tile_hd, (4, 8), seed=101)
    n_sand_fine = periodic_noise(tile_hd, (12, 22), seed=103)
    sand_val = n_sand_broad * 3.2 + n_sand_fine * 3.0
    sand_delta = sand_val[:, :, None] * np.array([1.02, 0.96, 0.82], dtype=np.float32)

    # 2. 草坪植被纹理 (柔和草叶群落明暗变化)
    n_grass_clump = periodic_noise(tile_hd, (2, 4, 6), seed=201)
    n_grass_blade = periodic_noise(tile_hd, (10, 20, 28), seed=202)
    grass_delta = (n_grass_clump * 9.0 + n_grass_blade * 5.5)[:, :, None] * np.array([0.75, 1.15, 0.58], dtype=np.float32)

    # 3. 港湾深水波纹纹理 (柔和斜向流波 + 浅水亮斑，彻底取代生硬锯齿波点)
    wave1 = np.sin(2.0 * t_y + 1.0 * t_x + 0.85 * periodic_noise(tile_hd, (1, 2), seed=301))
    wave2 = np.sin(4.0 * t_y - 2.0 * t_x + 0.65 * periodic_noise(tile_hd, (2, 3), seed=302))
    caustic = np.maximum(0.0, wave1 * 0.62 + wave2 * 0.38) ** 2.1
    trough = np.maximum(0.0, -(wave1 * 0.62 + wave2 * 0.38))
    water_delta = (caustic * 30.0 - trough * 15.0)[:, :, None] * np.array([0.58, 0.95, 1.28], dtype=np.float32)

    # 4. 建筑灰浆/石砖细微肌理
    n_stone = periodic_noise(tile_hd, (4, 8, 14), seed=401)
    stone_delta = (n_stone * 5.0)[:, :, None] * np.array([1.0, 0.98, 0.94], dtype=np.float32)

    return sand_delta, grass_delta, water_delta, stone_delta

def dedither_tile_rgb(
    idx_tile: np.ndarray,
    pal_rgb: np.ndarray,
    dither_pairs: set,
    is_water: np.ndarray | None = None,
    wrap_edges: bool = False,
) -> np.ndarray:
    """对单个 16x16/32x32 图块做严格 50/50 棋盘格消除，彻底去除对角点阵网格"""
    h, w = idx_tile.shape
    base = pal_rgb[np.clip(idx_tile, 0, 15)].copy()
    out = base.copy()

    clean_idx = idx_tile.copy()
    if is_water is not None:
        water_speck = is_water & ((clean_idx == 0) | (clean_idx == 8))
        out[water_speck] = pal_rgb[9] * 0.85 + pal_rgb[8] * 0.15
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
                    ni = int(clean_idx[ny, nx])
                    nb.append((ni, base[ny, nx]))
            matches = [(ni, rgb) for ni, rgb in nb if (ci, ni) in dither_pairs]
            if not matches:
                continue

            # 统计对角同色数 + 正交异色配对数，精准判定真棋盘抖动区域并取严格 50/50 均值
            diag_same = 0
            for dy, dx in ((-1, -1), (-1, 1), (1, -1), (1, 1)):
                pos = get_px(y + dy, x + dx)
                if pos is not None:
                    ny, nx = pos
                    if int(clean_idx[ny, nx]) == ci:
                        diag_same += 1

            avg_nb = np.mean([rgb for _, rgb in matches], axis=0)
            # 恰好构成棋盘 (正交>=2个配对且对角>=1个同色) 或 正交>=3个配对 -> 彻底替换为 50/50 均色
            if (len(matches) >= 2 and diag_same >= 1) or len(matches) >= 3:
                out[y, x] = base[y, x] * 0.50 + avg_nb * 0.50
            elif len(matches) == 2:
                # 仅上下或左右夹心 (例如细条纹壁饰 / 2x1 阶梯抖动)
                out[y, x] = base[y, x] * 0.65 + avg_nb * 0.35
    return out

def process_portchip_sheet(set_idx: int, p1: int, p2: int, p3: int, mats):
    src_path = os.path.join(ART_SHEETS, f"portchip_{set_idx}.png")
    rgba = np.array(Image.open(src_path).convert("RGBA"))
    idx_all = extract_indices(rgba, prefer_map=True)
    H, W = idx_all.shape  # 240 x 256
    tile_sz = 16
    hd_tile = 64
    cols, rows = W // tile_sz, H // tile_sz

    sand_delta, grass_delta, water_delta, stone_delta = mats
    hd_out = np.zeros((rows * hd_tile, cols * hd_tile, 4), dtype=np.uint8)

    for r in range(rows):
        for c in range(cols):
            t_id = r * cols + c
            tile_idx = idx_all[r * tile_sz:(r + 1) * tile_sz, c * tile_sz:(c + 1) * tile_sz]

            is_walk = t_id < p2
            pal = MODERN_GROUND_PAL if is_walk else MODERN_ARCH_PAL

            # 判定每像素语义：0=黑线, 1=水体, 2=砂石路面, 3=草地, 4=建筑/木/船/徽章
            sem = np.full((tile_sz, tile_sz), 4, dtype=np.uint8)
            is_blue = (tile_idx == 9) | (tile_idx == 12)
            # 统计 3x3 蓝水邻域数，定位被海面包裹的 1px 噪点
            blue_pad = np.pad(is_blue.astype(np.int32), ((1, 1), (1, 1)), mode="edge")
            blue_sum = sum(
                blue_pad[dy:dy + tile_sz, dx:dx + tile_sz]
                for dy in range(3) for dx in range(3)
            )
            is_water = is_blue | (((tile_idx == 0) | (tile_idx == 8)) & (blue_sum >= 5))

            sem[is_water] = 1
            if t_id < p2:
                # 地面图块的砂石与草坪识别
                is_grass = (tile_idx == 13) | (tile_idx == 14)
                is_sand = ((tile_idx == 10) | (tile_idx == 11) | (tile_idx == 15) | (tile_idx == 8)) & ~is_water & ~is_grass
                # 小木桶/看板(例如含 0 黑描边紧邻的多色块)避免当大面积沙地过度平滑
                sem[is_sand] = 2
                sem[is_grass] = 3
            else:
                # 非地面区域也可能出现海岸/草坪/行道树底草拼接格
                if np.any(is_water):
                    blk_pad = np.pad((tile_idx == 0).astype(np.int32), ((1, 1), (1, 1)), mode="edge")
                    blk_near = sum(blk_pad[dy:dy + tile_sz, dx:dx + tile_sz] for dy in range(3) for dx in range(3))
                    sem[((tile_idx == 13) | (tile_idx == 14)) & (blk_near == 0)] = 3
                    sem[((tile_idx == 10) | (tile_idx == 11)) & (blk_near == 0) & ~is_water] = 2
                elif int(np.sum(tile_idx == 14)) >= 70:
                    # 行道树/公园灌木格 (如 114): 亮绿草坪背景融入周围草坪质感
                    blk_pad = np.pad((tile_idx == 0).astype(np.int32), ((1, 1), (1, 1)), mode="edge")
                    blk_near = sum(blk_pad[dy:dy + tile_sz, dx:dx + tile_sz] for dy in range(3) for dx in range(3))
                    sem[(tile_idx == 14) & (blk_near == 0)] = 3

            sem[tile_idx == 0] = 0
            sem[is_water] = 1  # 确保水中噪点保持水体类别

            # Step A: 去抖动并生成光滑底色 (16x16x3); 地面块允许边界环形去抖动消除斜菱网格
            base_16 = dedither_tile_rgb(tile_idx, pal, PORT_DITHER_PAIRS, is_water=is_water, wrap_edges=(t_id < p1))

            # 对可无缝平铺的地面与水面区域做彻底去棋盘柔化（保留海岸线硬过渡）
            if t_id < p2 or np.any(is_water):
                smooth_16 = base_16.copy()
                for m_val, alpha, sig in ((1, 0.85, 0.90), (2, 0.82, 0.85), (3, 0.78, 0.80)):
                    m = (sem == m_val).astype(np.float32)
                    if np.sum(m) < 4:
                        continue
                    mode = "wrap" if t_id < p1 else "nearest"
                    denom = np.maximum(1e-4, gaussian_filter(m, sigma=sig, mode=mode))
                    for ch in range(3):
                        num = gaussian_filter(base_16[:, :, ch] * m, sigma=sig, mode=mode)
                        blended = num / denom
                        smooth_16[:, :, ch] = np.where(m > 0.5, base_16[:, :, ch] * (1.0 - alpha) + blended * alpha, smooth_16[:, :, ch])
                base_16 = smooth_16

            # Step B: 2× EPX -> 32x32, 再 2× EPX -> 64x64（保持建筑窗格/船只缆绳/轮廓锐利平顺）
            up32 = epx_2x_rgb(base_16)
            sem32 = epx_2x_mask(sem)
            up64 = epx_2x_rgb(up32)
            sem64 = epx_2x_mask(sem32)

            # 对同材质内部柔化消除残余点阵网格（严禁跨不同材质模糊边界！）
            final64 = up64.copy()
            for m_val, sigma, mix in ((1, 1.8, 0.88), (2, 1.8, 0.90), (3, 1.6, 0.86), (4, 0.72, 0.50)):
                m = (sem64 == m_val).astype(np.float32)
                if np.sum(m) < 16:
                    continue
                mode = "wrap" if (t_id < p1 or m_val == 1) else "nearest"
                denom = np.maximum(1e-4, gaussian_filter(m, sigma=sigma, mode=mode))
                for ch in range(3):
                    num = gaussian_filter(up64[:, :, ch] * m, sigma=sigma, mode=mode)
                    final64[:, :, ch] = np.where(m > 0.5, up64[:, :, ch] * (1.0 - mix) + (num / denom) * mix, final64[:, :, ch])

            # Step C: 叠加世界连续无缝的高清材质纹理（水波/砂石/草坪/砖石）
            m_water = (sem64 == 1)[:, :, None].astype(np.float32)
            m_sand = (sem64 == 2)[:, :, None].astype(np.float32)
            m_grass = (sem64 == 3)[:, :, None].astype(np.float32)
            m_arch = (sem64 == 4)[:, :, None].astype(np.float32)

            # 岸边浅海绿松石过渡光晕（在水与非水交界外侧 6px 内）
            non_water = (sem64 != 1).astype(np.float32)
            shore_glow = np.clip(gaussian_filter(non_water, sigma=2.6, mode="nearest") * 2.2, 0.0, 1.0) * (sem64 == 1)
            shore_tint = np.array([28.0, 138.0, 178.0], dtype=np.float32)[None, None, :]
            final64 = np.where(
                shore_glow[:, :, None] > 0.02,
                final64 * (1.0 - shore_glow[:, :, None] * 0.45) + shore_tint * (shore_glow[:, :, None] * 0.45),
                final64,
            )

            # 暗线邻近柔和环境光遮蔽 (AO)，让建筑屋檐、船身与拱门更有立体感
            dark_mask = (sem64 == 0).astype(np.float32)
            ao = np.clip(gaussian_filter(dark_mask, sigma=1.8, mode="nearest") * 0.52, 0.0, 0.34)
            final64 *= (1.0 - ao[:, :, None] * (sem64 != 0)[:, :, None])

            final64 = (
                final64
                + m_water * water_delta
                + m_sand * sand_delta
                + m_grass * grass_delta
                + m_arch * stone_delta
            )

            rgb_u8 = np.clip(np.round(final64), 0, 255).astype(np.uint8)
            dy, dx = r * hd_tile, c * hd_tile
            hd_out[dy:dy + hd_tile, dx:dx + hd_tile, :3] = rgb_u8
            hd_out[dy:dy + hd_tile, dx:dx + hd_tile, 3] = 255

    os.makedirs(HD_SHEETS, exist_ok=True)
    out_path = os.path.join(HD_SHEETS, f"portchip_{set_idx}.png")
    Image.fromarray(hd_out, mode="RGBA").save(out_path, optimize=True)
    return out_path

def process_chars_sheet():
    """将 chars.png (256x288, 32x32 精灵格) 高清平滑放大至 4× (1024x1152, 每帧 128x128)"""
    src_path = os.path.join(ART_SHEETS, "chars.png")
    rgba = np.array(Image.open(src_path).convert("RGBA"))
    idx_all = extract_indices(rgba, prefer_map=False)
    H, W = idx_all.shape  # 288 x 256
    tile_sz = 32
    cols, rows = W // tile_sz, H // tile_sz
    hd_tile = 128
    hd_out = np.zeros((rows * hd_tile, cols * hd_tile, 4), dtype=np.uint8)

    for r in range(rows):
        for c in range(cols):
            tile_idx = idx_all[r * tile_sz:(r + 1) * tile_sz, c * tile_sz:(c + 1) * tile_sz]
            alpha32 = (tile_idx < 16).astype(np.float32)
            # 对人物阴影和服饰做轻微去抖动，同时保护黑描边与皮肤高光
            base32 = dedither_tile_rgb(np.where(tile_idx < 16, tile_idx, 0), MODERN_SPRITE_PAL, SPRITE_DITHER_PAIRS)
            base_rgba = np.dstack([base32, alpha32 * 255.0])

            # 使用透明通道参与 EPX 边缘判别，避免轮廓出现黑边污渍
            up64 = epx_2x_rgb(base_rgba)
            up128 = epx_2x_rgb(up64)

            # 对人物非黑线实心内部微柔化抗锯齿
            a128 = np.clip(up128[:, :, 3], 0, 255)
            solid = a128 >= 128
            rgb128 = up128[:, :, :3].copy()
            smooth = gaussian_filter(rgb128, sigma=(0.6, 0.6, 0.0), mode="nearest")
            rgb128 = np.where(solid[:, :, None], rgb128 * 0.72 + smooth * 0.28, rgb128)

            # 轻量抗锯齿边缘透明羽化 (仅 0.7px) 让人物自然融入高清地面
            a_soft = np.where(solid, 255.0, np.clip(gaussian_filter(solid.astype(np.float32), sigma=0.6) * 210.0, 0, 180))

            dy, dx = r * hd_tile, c * hd_tile
            hd_out[dy:dy + hd_tile, dx:dx + hd_tile, :3] = np.clip(np.round(rgb128), 0, 255).astype(np.uint8)
            hd_out[dy:dy + hd_tile, dx:dx + hd_tile, 3] = np.clip(np.round(a_soft), 0, 255).astype(np.uint8)

    out_path = os.path.join(HD_SHEETS, "chars.png")
    Image.fromarray(hd_out, mode="RGBA").save(out_path, optimize=True)
    return out_path

def main():
    meta = json.load(open(PORTCHIP_JSON, "r", encoding="utf-8"))
    mats = make_seamless_materials(64)
    for s, bounds in enumerate(meta["tilesets"]):
        _, p1, p2, p3 = bounds
        out_p = process_portchip_sheet(s, p1, p2, p3, mats)
        print(f"Generated {os.path.relpath(out_p, ROOT)}")
    out_c = process_chars_sheet()
    print(f"Generated {os.path.relpath(out_c, ROOT)}")

if __name__ == "__main__":
    main()
