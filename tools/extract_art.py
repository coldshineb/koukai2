"""extract_art.py — 將原版 DOS 二進位美術包提取為現代標準 PNG + manifest.json (批次 A)

提取範圍 (批次 A):
  - KAO.LZW #0..127    -> web/assets/art/portraits/named/portrait_000..127.png (64x80)
  - KAO.LZW #128..255  -> web/assets/art/discoveries/disc_000..127.png (48x48)
  - GRAPH.DAT #6..21   -> web/assets/art/buildings/building_00..15.png (136x112)
  - GRAPH.DAT #28..52  -> web/assets/art/ships/ship_00..24.png (128x96)
  - transit.bin        -> web/assets/art/figureheads/figurehead_00..12.png (48x48)
  - event/EVENT0..6    -> web/assets/art/events/event{h}_{i:02d}.png (32 張)
  - GRAPH/GRAPH2 背景  -> web/assets/art/backgrounds/{hero_select,worldmap,duel_bg,gamble_bg}.png
  - 清單               -> web/assets/art/manifest.json
"""
import json, os, subprocess
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, "web", "assets", "art")


def dac8(v4):
    """4-bit -> 6-bit VGA DAC -> 8-bit RGB (與 core/screen.js dac8 相同)"""
    return round((v4 & 15) * 4 * 255 / 63)


def load_palettes():
    js = """
const fs = require('fs');
require('./tools/work/ui_bundle.js');
const raw = JSON.parse(fs.readFileSync('web/assets/data/palettes.json', 'utf8'));
const tabs = globalThis.UI.paletteTables(raw);
const out = {};
for (const [k, v] of Object.entries(tabs)) out[k] = Array.from(v);
process.stdout.write(JSON.stringify(out));
"""
    p = subprocess.run(["node", "-e", js], cwd=ROOT, capture_output=True, text=True, check=True)
    tabs = json.loads(p.stdout)
    rgb = {}
    for name, arr in tabs.items():
        cols = []
        for i in range(16):
            b, r, g = dac8(arr[i * 3]), dac8(arr[i * 3 + 1]), dac8(arr[i * 3 + 2])
            cols.append((r, g, b, 255))
        rgb[name] = cols
    return rgb


def save_indexed_png(path, w, h, pixels, pal_rgba):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im = Image.new("RGBA", (w, h))
    buf = bytearray(w * h * 4)
    for i, c in enumerate(pixels):
        r, g, b, a = pal_rgba[c & 15]
        o = i * 4
        buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = a
    im.frombytes(bytes(buf))
    im.save(path, optimize=True)


def run_node_dump(script):
    p = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, check=True)
    return p.stdout


def extract_kao(pals, manifest):
    """KAO.LZW: #0..127 具名頭像 (64x80), #128..255 發現物/道具圖 (48x48)"""
    js = r"""
const fs = require('fs');
require('./tools/work/ui_bundle.js');
const U = globalThis.UI;
const kao = new U.Kao(new Uint8Array(fs.readFileSync('web/assets/gfx/KAO.LZW')));
const chunks = [];
for (let i = 0; i < 128; i++) {
  const fb = new Uint8Array(640 * 400);
  const scr = { fb, dirty: false, inBounds: () => true };
  kao.drawNamed(scr, i, 0, 0);
  const out = new Uint8Array(64 * 80);
  for (let y = 0; y < 80; y++) out.set(fb.subarray(y * 640, y * 640 + 64), y * 64);
  chunks.push(Buffer.from(out));
}
for (let i = 0; i < 128; i++) {
  const fb = new Uint8Array(640 * 400);
  const scr = { fb, dirty: false, inBounds: () => true };
  kao.drawItem(scr, i, 0, 0);
  const out = new Uint8Array(48 * 48);
  for (let y = 0; y < 48; y++) out.set(fb.subarray(y * 640, y * 640 + 48), y * 48);
  chunks.push(Buffer.from(out));
}
process.stdout.write(Buffer.concat(chunks));
"""
    raw = run_node_dump(js)
    pal = pals["day"]
    off = 0
    for i in range(128):
        rel = f"portraits/named/portrait_{i:03d}.png"
        save_indexed_png(os.path.join(ART, rel), 64, 80, raw[off : off + 64 * 80], pal)
        manifest["portraits"][str(i)] = {"path": rel, "w": 64, "h": 80}
        off += 64 * 80
    for i in range(128):
        rel = f"discoveries/disc_{i:03d}.png"
        save_indexed_png(os.path.join(ART, rel), 48, 48, raw[off : off + 48 * 48], pal)
        manifest["discoveries"][str(i)] = {"path": rel, "w": 48, "h": 48}
        off += 48 * 48
    print("[KAO.LZW] 128 named portraits + 128 discovery icons extracted")


def decode_graph_entry(dat_rel, idx):
    js = f"""
const fs = require('fs');
require('./tools/work/ui_bundle.js');
const U = globalThis.UI;
const g = new U.GraphDat(new Uint8Array(fs.readFileSync('{dat_rel}')));
const sz = U.graphSize(g.dat, g.offsets[{idx}]);
const fb = new Uint8Array(640 * 400);
g.draw(fb, {idx}, 0, 0);
const out = new Uint8Array(sz.w * sz.h);
for (let y = 0; y < sz.h; y++) out.set(fb.subarray(y * 640, y * 640 + sz.w), y * sz.w);
const hdr = Buffer.alloc(4); hdr.writeUInt16LE(sz.w, 0); hdr.writeUInt16LE(sz.h, 2);
process.stdout.write(Buffer.concat([hdr, Buffer.from(out)]));
"""
    raw = run_node_dump(js)
    w = int.from_bytes(raw[0:2], "little")
    h = int.from_bytes(raw[2:4], "little")
    return w, h, raw[4:]


def extract_graph_art(pals, manifest):
    # 1) Buildings: GRAPH.DAT #6..#21
    for i in range(16):
        w, h, px = decode_graph_entry("web/assets/gfx/GRAPH.DAT", 6 + i)
        rel = f"buildings/building_{i:02d}.png"
        save_indexed_png(os.path.join(ART, rel), w, h, px, pals["day"])
        manifest["buildings"][str(i)] = {"path": rel, "w": w, "h": h}
    print("[GRAPH.DAT] 16 building interiors extracted")

    # 2) Ships: GRAPH.DAT #28..#52
    for i in range(25):
        w, h, px = decode_graph_entry("web/assets/gfx/GRAPH.DAT", 28 + i)
        rel = f"ships/ship_{i:02d}.png"
        save_indexed_png(os.path.join(ART, rel), w, h, px, pals["ships"])
        manifest["ships"][str(i)] = {"path": rel, "w": w, "h": h}
    print("[GRAPH.DAT] 25 ship illustrations extracted")

    # 3) Backgrounds
    bgs = [
        ("duel_bg", "web/assets/gfx/GRAPH.DAT", 23, "battle"),
        ("worldmap", "web/assets/gfx/GRAPH.DAT", 25, "chart"),
        ("gamble_bg", "web/assets/gfx/GRAPH.DAT", 27, "day"),
        ("hero_select", "web/assets/gfx/GRAPH2.DAT", 1, "heroSelect"),
    ]
    for name, dat, idx, pal_name in bgs:
        w, h, px = decode_graph_entry(dat, idx)
        rel = f"backgrounds/{name}.png"
        save_indexed_png(os.path.join(ART, rel), w, h, px, pals[pal_name])
        manifest["backgrounds"][name] = {"path": rel, "w": w, "h": h}
    print("[GRAPH/GRAPH2] 4 full-screen backgrounds extracted")

    # 4) Complete GRAPH.DAT (#0..64) & GRAPH2.DAT (#0..1) index for pure-PNG Graph renderer
    g1_reuse = {}
    for i in range(16):
        g1_reuse[6 + i] = manifest["buildings"][str(i)]
    for i in range(25):
        g1_reuse[28 + i] = manifest["ships"][str(i)]
    g1_reuse[23] = manifest["backgrounds"]["duel_bg"]
    g1_reuse[25] = manifest["backgrounds"]["worldmap"]
    g1_reuse[27] = manifest["backgrounds"]["gamble_bg"]
    g1_8col = {0, 2, 3, 4, 5, 62}
    g1_pal = {26: "battle"}

    js_g1 = r"""
const fs = require('fs');
require('./tools/work/ui_bundle.js');
const U = globalThis.UI;
const dat = new Uint8Array(fs.readFileSync('web/assets/gfx/GRAPH.DAT'));
const g = new U.GraphDat(dat);
const col8 = new Set([0, 2, 3, 4, 5, 62]);
const chunks = [Buffer.from([g.offsets.length])];
for (let i = 0; i < g.offsets.length; i++) {
  const off = g.offsets[i];
  const sz = U.graphSize(dat, off);
  const fb = new Uint8Array(640 * 400);
  U.decodeGraph(fb, dat, 0, 0, !col8.has(i), off);
  const out = new Uint8Array(sz.w * sz.h);
  for (let y = 0; y < sz.h; y++) out.set(fb.subarray(y * 640, y * 640 + sz.w), y * sz.w);
  const hdr = Buffer.alloc(4); hdr.writeUInt16LE(sz.w, 0); hdr.writeUInt16LE(sz.h, 2);
  chunks.push(hdr, Buffer.from(out));
}
process.stdout.write(Buffer.concat(chunks));
"""
    raw_g1 = run_node_dump(js_g1)
    cnt_g1 = raw_g1[0]
    p = 1
    g1_list = []
    extra_g1 = 0
    for i in range(cnt_g1):
        w = int.from_bytes(raw_g1[p : p + 2], "little")
        h = int.from_bytes(raw_g1[p + 2 : p + 4], "little")
        p += 4
        px = raw_g1[p : p + w * h]
        p += w * h
        if i in g1_reuse:
            g1_list.append(g1_reuse[i])
        else:
            rel = f"graph/g1_{i:02d}.png"
            pal_name = g1_pal.get(i, "day")
            save_indexed_png(os.path.join(ART, rel), w, h, px, pals[pal_name])
            g1_list.append({"path": rel, "w": w, "h": h})
            extra_g1 += 1
    manifest["graph"]["GRAPH.DAT"] = g1_list

    w2, h2, px2 = decode_graph_entry("web/assets/gfx/GRAPH2.DAT", 0)
    rel_g2_0 = "graph/g2_00.png"
    save_indexed_png(os.path.join(ART, rel_g2_0), w2, h2, px2, pals["heroSelect"])
    manifest["graph"]["GRAPH2.DAT"] = [
        {"path": rel_g2_0, "w": w2, "h": h2},
        manifest["backgrounds"]["hero_select"],
    ]
    print(f"[GRAPH/GRAPH2] {extra_g1 + 1} additional UI/event graphics extracted (full index ready)")


def extract_kao_parts(pals, manifest):
    """KAO.LZW 檔尾 7 組隨機頭像部件 (A..E) -> 5 張 PNG 圖集 (C/D/E 含透明通道)"""
    dat = open(os.path.join(ROOT, "web", "assets", "gfx", "KAO.LZW"), "rb").read()
    PARTS_BASE = 0x476A2
    PARTS_SET = 0x60C0
    specs = [
        ("a", 0x318, 8, 33, False),
        ("b", 0x468, 8, 47, False),
        ("c", 0x1B0, 8, 18, True),
        ("d", 0x240, 4, 24, True),
        ("e", 0x1C8, 8, 19, True),
    ]
    pal = pals["day"]
    for key, size, cols, h, transparent in specs:
        rows = 7
        sw, sh = cols * 64, rows * h
        rgba = bytearray(sw * sh * 4)
        for s in range(rows):
            base = PARTS_BASE + s * PARTS_SET
            for k2, sz2, n2, _, _ in specs:
                if k2 == key:
                    break
                base += sz2 * n2
            for idx in range(cols):
                off = base + idx * size
                gx, gy = idx * 64, s * h
                for r in range(h):
                    for c in range(8):
                        pos = off + (r * 8 + c) * 3
                        b0 = dat[pos] if pos < len(dat) else 0
                        b1 = dat[pos + 1] if pos + 1 < len(dat) else 0
                        b2 = dat[pos + 2] if pos + 2 < len(dat) else 0
                        for i in range(8):
                            shb = 7 - i
                            col_idx = ((b0 >> shb) & 1) | (((b1 >> shb) & 1) << 1) | (((b2 >> shb) & 1) << 2)
                            if transparent and col_idx == 0:
                                continue
                            pr, pg, pb, pa = pal[col_idx]
                            dst = ((gy + r) * sw + (gx + c * 8 + i)) * 4
                            rgba[dst] = pr; rgba[dst + 1] = pg; rgba[dst + 2] = pb; rgba[dst + 3] = pa
        rel = f"portraits/parts/part_{key}.png"
        save_rgba_png(os.path.join(ART, rel), sw, sh, rgba)
        manifest["kaoParts"][key] = {
            "path": rel, "w": sw, "h": sh,
            "tileW": 64, "tileH": h, "cols": cols, "rows": rows, "count": rows * cols,
        }
    print("[KAO.LZW] 5 random-portrait composer sheets extracted")


def extract_hud_buttons(pals, manifest):
    """transit.bin 0x4b00 起 4 個 24x80 (3 平面) 右側指令按下圖"""
    dat = open(os.path.join(ROOT, "web", "assets", "gfx", "transit.bin"), "rb").read()
    pal = pals["day"]
    sw, sh = 4 * 24, 80
    out = bytearray(sw * sh)
    for n in range(4):
        o = 0x4B00 + 0x2D0 * n
        for r in range(80):
            for c in range(3):
                k = o + (r * 3 + c) * 3
                p0, p1, p2 = dat[k], dat[k + 1], dat[k + 2]
                for i in range(8):
                    shb = 7 - i
                    col_idx = ((p0 >> shb) & 1) | (((p1 >> shb) & 1) << 1) | (((p2 >> shb) & 1) << 2)
                    out[r * sw + n * 24 + c * 8 + i] = col_idx
    rel = "sheets/hud_buttons.png"
    save_indexed_png(os.path.join(ART, rel), sw, sh, out, pal)
    manifest["sheets"]["hud_buttons"] = {
        "path": rel, "w": sw, "h": sh,
        "tileW": 24, "tileH": 80, "cols": 4, "rows": 1, "count": 4,
    }
    print("[transit.bin] 4 pressed HUD button sprites extracted")


def extract_events(pals, manifest):
    ev_dir = os.path.join(ROOT, "web", "assets", "gfx", "event")
    total = 0
    for fname in sorted(os.listdir(ev_dir)):
        if not fname.upper().endswith(".DAT"):
            continue
        hero_tag = fname.lower().replace(".dat", "")
        rel_dat = f"web/assets/gfx/event/{fname}"
        js = f"""
const fs = require('fs');
require('./tools/work/ui_bundle.js');
const g = new globalThis.UI.GraphDat(new Uint8Array(fs.readFileSync('{rel_dat}')));
process.stdout.write(String(g.offsets.length));
"""
        count = int(run_node_dump(js).decode())
        manifest["events"][hero_tag] = []
        for idx in range(count):
            w, h, px = decode_graph_entry(rel_dat, idx)
            rel = f"events/{hero_tag}_{idx:02d}.png"
            save_indexed_png(os.path.join(ART, rel), w, h, px, pals["day"])
            manifest["events"][hero_tag].append({"path": rel, "w": w, "h": h})
            total += 1
    print(f"[EVENT*.DAT] {total} story illustrations extracted")


def extract_figureheads(pals, manifest):
    """transit.bin: 0x1980 起每項 0x480 bytes (6 欄 × 48 行, 4 平面 16 色)"""
    js = r"""
const fs = require('fs');
require('./tools/work/ui_bundle.js');
const U = globalThis.UI;
const dat = new Uint8Array(fs.readFileSync('web/assets/gfx/transit.bin'));
const count = Math.floor((dat.length - 0x1980) / 0x480);
const chunks = [Buffer.from([count])];
for (let i = 0; i < count; i++) {
  const scr = new U.Screen(null);
  scr.putPlanar(0, 0, 6, 48, dat, 0x1980 + i * 0x480);
  const out = new Uint8Array(48 * 48);
  for (let y = 0; y < 48; y++) out.set(scr.fb.subarray(y * 640, y * 640 + 48), y * 48);
  chunks.push(Buffer.from(out));
}
process.stdout.write(Buffer.concat(chunks));
"""
    raw = run_node_dump(js)
    count = raw[0]
    pal = pals["ships"]
    for i in range(count):
        off = 1 + i * 48 * 48
        rel = f"figureheads/figurehead_{i:02d}.png"
        save_indexed_png(os.path.join(ART, rel), 48, 48, raw[off : off + 48 * 48], pal)
        manifest["figureheads"][str(i)] = {"path": rel, "w": 48, "h": 48}
    print(f"[transit.bin] {count} figureheads extracted")


def extract_planar_sheet(dat_rel, start_off, count, tile_cols, tile_h, grid_cols, pal_rgba, out_rel):
    """將連續 4 平面圖塊 (每塊 tile_cols*8 x tile_h, 大小 tile_cols*tile_h*4 bytes) 拼合為標準 PNG 圖集"""
    tile_w = tile_cols * 8
    tile_bytes = tile_cols * tile_h * 4
    grid_rows = (count + grid_cols - 1) // grid_cols
    sheet_w = grid_cols * tile_w
    sheet_h = grid_rows * tile_h
    js = f"""
const fs = require('fs');
require('./tools/work/ui_bundle.js');
const U = globalThis.UI;
const dat = new Uint8Array(fs.readFileSync('{dat_rel}'));
const sheet = new Uint8Array({sheet_w} * {sheet_h});
for (let i = 0; i < {count}; i++) {{
  const off = {start_off} + i * {tile_bytes};
  if (off + {tile_bytes} > dat.length) break;
  const scr = new U.Screen(null);
  scr.putPlanar(0, 0, {tile_cols}, {tile_h}, dat, off);
  const gx = (i % {grid_cols}) * {tile_w}, gy = Math.floor(i / {grid_cols}) * {tile_h};
  for (let y = 0; y < {tile_h}; y++) {{
    sheet.set(scr.fb.subarray(y * 640, y * 640 + {tile_w}), (gy + y) * {sheet_w} + gx);
  }}
}}
process.stdout.write(Buffer.from(sheet));
"""
    raw = run_node_dump(js)
    save_indexed_png(os.path.join(ART, out_rel), sheet_w, sheet_h, raw, pal_rgba)
    return {
        "path": out_rel,
        "w": sheet_w,
        "h": sheet_h,
        "tileW": tile_w,
        "tileH": tile_h,
        "cols": grid_cols,
        "rows": grid_rows,
        "count": count,
    }


def save_rgba_png(path, w, h, rgba_bytes):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im = Image.frombytes("RGBA", (w, h), bytes(rgba_bytes))
    im.save(path, optimize=True)


def extract_seq_tile_sheet(dat_rel, start_off, count, grid_cols, pal_rgba, out_rel):
    """4 平面依序排列的 16×16 圖塊 (每塊 128 bytes: 平面 0..3 各 32 bytes, 同 port.js tile())"""
    dat = open(os.path.join(ROOT, dat_rel), "rb").read()
    grid_rows = (count + grid_cols - 1) // grid_cols
    sw, sh = grid_cols * 16, grid_rows * 16
    out = bytearray(sw * sh)
    for t in range(count):
        o = start_off + t * 128
        if o + 128 > len(dat):
            break
        gx, gy = (t % grid_cols) * 16, (t // grid_cols) * 16
        for p in range(4):
            bit = 1 << p
            for r in range(16):
                row_off = (gy + r) * sw + gx
                for b in range(2):
                    v = dat[o + p * 32 + r * 2 + b]
                    for i in range(8):
                        if (v >> (7 - i)) & 1:
                            out[row_off + b * 8 + i] |= bit
    save_indexed_png(os.path.join(ART, out_rel), sw, sh, out, pal_rgba)
    return {
        "path": out_rel, "w": sw, "h": sh,
        "tileW": 16, "tileH": 16, "cols": grid_cols, "rows": grid_rows, "count": count,
    }


def extract_char_figures(dat_rel, pal_rgba, out_rel):
    """char.bin: 每幀 32×32 = 4 個 16×16 遮罩格 (每格 0xa0 bytes: 4 平面 128B + 遮罩 32B), 匯出含真實透明通道"""
    dat = open(os.path.join(ROOT, dat_rel), "rb").read()
    count = len(dat) // 0x280
    grid_cols = 8
    grid_rows = (count + grid_cols - 1) // grid_cols
    sw, sh = grid_cols * 32, grid_rows * 32
    rgba = bytearray(sw * sh * 4)
    quad_pos = [(0, 0, 0x000), (16, 0, 0x0a0), (0, 16, 0x140), (16, 16, 0x1e0)]
    for idx in range(count):
        base = idx * 0x280
        fx, fy = (idx % grid_cols) * 32, (idx // grid_cols) * 32
        for qx, qy, qoff in quad_pos:
            o = base + qoff
            for r in range(16):
                for b in range(2):
                    m = dat[o + 0x80 + r * 2 + b]
                    p0 = dat[o + r * 2 + b]
                    p1 = dat[o + 32 + r * 2 + b]
                    p2 = dat[o + 64 + r * 2 + b]
                    p3 = dat[o + 96 + r * 2 + b]
                    for i in range(8):
                        shb = 7 - i
                        if (m >> shb) & 1:
                            continue  # 透明像素
                        c = ((p0 >> shb) & 1) | (((p1 >> shb) & 1) << 1) | (((p2 >> shb) & 1) << 2) | (((p3 >> shb) & 1) << 3)
                        pr, pg, pb, pa = pal_rgba[c]
                        dst = ((fy + qy + r) * sw + (fx + qx + b * 8 + i)) * 4
                        rgba[dst] = pr; rgba[dst + 1] = pg; rgba[dst + 2] = pb; rgba[dst + 3] = pa
    save_rgba_png(os.path.join(ART, out_rel), sw, sh, rgba)
    return {
        "path": out_rel, "w": sw, "h": sh,
        "tileW": 32, "tileH": 32, "cols": grid_cols, "rows": grid_rows, "count": count,
    }


def extract_sea_ships(dat_rel, pal_rgba, out_rel):
    """seachip.bin 0x4000..0x7fff: 32 幀 32×32 海上船隻精靈 (每行 2 組 16px × [mask, p0, p1, p2], 真實透明)"""
    dat = open(os.path.join(ROOT, dat_rel), "rb").read()
    count = 32
    grid_cols, grid_rows = 8, 4
    sw, sh = grid_cols * 32, grid_rows * 32
    rgba = bytearray(sw * sh * 4)
    for idx in range(count):
        base = 0x4000 + idx * 0x200
        fx, fy = (idx % grid_cols) * 32, (idx // grid_cols) * 32
        for r in range(32):
            for h in range(2):
                o = base + r * 16 + h * 8
                for b in range(2):
                    m = dat[o + b]
                    p0 = dat[o + 2 + b]
                    p1 = dat[o + 4 + b]
                    p2 = dat[o + 6 + b]
                    for i in range(8):
                        shb = 7 - i
                        if (m >> shb) & 1:
                            continue  # 透明
                        c = ((p0 >> shb) & 1) | (((p1 >> shb) & 1) << 1) | (((p2 >> shb) & 1) << 2)
                        pr, pg, pb, pa = pal_rgba[c]
                        dst = ((fy + r) * sw + (fx + h * 16 + b * 8 + i)) * 4
                        rgba[dst] = pr; rgba[dst + 1] = pg; rgba[dst + 2] = pb; rgba[dst + 3] = pa
    save_rgba_png(os.path.join(ART, out_rel), sw, sh, rgba)
    return {
        "path": out_rel, "w": sw, "h": sh,
        "tileW": 32, "tileH": 32, "cols": grid_cols, "rows": grid_rows, "count": count,
    }


def extract_battle_ships(dat_rel, pal_rgba, out_rel):
    """hdat.bin 0x1a00..0x55ff: 24 幀 32×32 海戰船隻 (0x80 遮罩 + 0x200 4 平面交錯圖像, 真實透明)"""
    dat = open(os.path.join(ROOT, dat_rel), "rb").read()
    count = 24
    grid_cols, grid_rows = 6, 4
    sw, sh = grid_cols * 32, grid_rows * 32
    rgba = bytearray(sw * sh * 4)
    for idx in range(count):
        base = 0x1A00 + idx * 0x280
        fx, fy = (idx % grid_cols) * 32, (idx // grid_cols) * 32
        for r in range(32):
            for c in range(4):
                m = dat[base + r * 4 + c]
                po = base + 0x80 + (r * 4 + c) * 4
                b0, b1, b2, b3 = dat[po], dat[po + 1], dat[po + 2], dat[po + 3]
                for i in range(8):
                    shb = 7 - i
                    # 0x20f AND 遮罩: bit=0 代表透明保留背景, bit=1 代表先清再 OR 圖像? 檢查: 063e mode 2: if (!on) fb &= ~color
                    # 也就是 bit=1 的地方保持背景 (透明), bit=0 的地方清成 0 再 OR 圖像!
                    if (m >> shb) & 1:
                        continue
                    col_idx = ((b0 >> shb) & 1) | (((b1 >> shb) & 1) << 1) | (((b2 >> shb) & 1) << 2) | (((b3 >> shb) & 1) << 3)
                    pr, pg, pb, pa = pal_rgba[col_idx]
                    dst = ((fy + r) * sw + (fx + c * 8 + i)) * 4
                    rgba[dst] = pr; rgba[dst + 1] = pg; rgba[dst + 2] = pb; rgba[dst + 3] = pa
    save_rgba_png(os.path.join(ART, out_rel), sw, sh, rgba)
    return {
        "path": out_rel, "w": sw, "h": sh,
        "tileW": 32, "tileH": 32, "cols": grid_cols, "rows": grid_rows, "count": count,
    }


def extract_masked_planar_sheet(dat_rel, start_off, count, cols_w, h, stride, mask_bytes, grid_cols, pal_rgba, out_rel):
    """通用遮罩 + 4 平面交錯精靈表匯出 (與 battle.js spr() 0x20f + mode 3 相同)"""
    dat = open(os.path.join(ROOT, dat_rel), "rb").read()
    tile_w = cols_w * 8
    grid_rows = (count + grid_cols - 1) // grid_cols
    sw, sh = grid_cols * tile_w, grid_rows * h
    rgba = bytearray(sw * sh * 4)
    for idx in range(count):
        base = start_off + idx * stride
        fx, fy = (idx % grid_cols) * tile_w, (idx // grid_cols) * h
        for r in range(h):
            for c in range(cols_w):
                m = dat[base + r * cols_w + c]
                po = base + mask_bytes + (r * cols_w + c) * 4
                b0, b1, b2, b3 = dat[po], dat[po + 1], dat[po + 2], dat[po + 3]
                for i in range(8):
                    shb = 7 - i
                    if (m >> shb) & 1:
                        continue
                    col_idx = ((b0 >> shb) & 1) | (((b1 >> shb) & 1) << 1) | (((b2 >> shb) & 1) << 2) | (((b3 >> shb) & 1) << 3)
                    pr, pg, pb, pa = pal_rgba[col_idx]
                    dst = ((fy + r) * sw + (fx + c * 8 + i)) * 4
                    rgba[dst] = pr; rgba[dst + 1] = pg; rgba[dst + 2] = pb; rgba[dst + 3] = pa
    save_rgba_png(os.path.join(ART, out_rel), sw, sh, rgba)
    return {
        "path": out_rel, "w": sw, "h": sh,
        "tileW": tile_w, "tileH": h, "cols": grid_cols, "rows": grid_rows, "count": count,
    }


def extract_sheets(pals, manifest):
    """批次 B: 港口圖塊 / 主角與行人 (透明) / 海上圖塊 / 羅盤 / 海戰 / 賭博牌與骰子"""
    # 1) 7 sets of port tiles (240 tiles of 16x16 each, sequential 4-plane)
    for s in range(7):
        off = s * (0x7800 + 4)
        manifest["sheets"][f"portchip_{s}"] = extract_seq_tile_sheet(
            "web/assets/gfx/portchip.bin", off, 240, 16, pals["day"], f"sheets/portchip_{s}.png"
        )
    print("[portchip.bin] 7 port tileset sheets extracted")

    # 2) Hero & NPC sprites (72 sprites of 32x32 with alpha transparency)
    manifest["sheets"]["chars"] = extract_char_figures(
        "web/assets/gfx/char.bin", pals["day"], "sheets/chars.png"
    )
    print("[char.bin] 72 alpha-masked character sprites extracted")

    # 3) Sea tiles (128 tiles of 16x16, sequential 4-plane) + 32 transparent sea ships
    manifest["sheets"]["seachip"] = extract_seq_tile_sheet(
        "web/assets/gfx/seachip.bin", 0, 128, 16, pals["day"], "sheets/seachip.png"
    )
    manifest["sheets"]["sea_ships"] = extract_sea_ships(
        "web/assets/gfx/seachip.bin", pals["day"], "sheets/sea_ships.png"
    )
    print("[seachip.bin] 128 sea terrain tiles + 32 alpha-masked sea ships extracted")

    # 4) Compasses
    manifest["sheets"]["compass"] = extract_planar_sheet(
        "web/assets/gfx/compass.bin", 0, 8, 5, 24, 4, pals["day"], "sheets/compass.png"
    )
    manifest["sheets"]["seacompass"] = extract_planar_sheet(
        "web/assets/gfx/seacompass.bin", 0, 18, 4, 32, 9, pals["day"], "sheets/seacompass.png"
    )
    print("[compass/seacompass] compass sheets extracted")

    # 5) Naval battle tiles (13 x 32x32) + 24 battle ships + FX sprites
    manifest["sheets"]["naval_battle"] = extract_planar_sheet(
        "web/assets/gfx/hdat.bin", 0, 13, 4, 32, 8, pals["battle"], "sheets/naval_battle.png"
    )
    manifest["sheets"]["battle_ships"] = extract_battle_ships(
        "web/assets/gfx/hdat.bin", pals["battle"], "sheets/battle_ships.png"
    )
    manifest["sheets"]["battle_fx_lg"] = extract_masked_planar_sheet(
        "web/assets/gfx/hdat.bin", 0x6E40, 4, 4, 32, 0x280, 0x80, 4, pals["battle"], "sheets/battle_fx_lg.png"
    )
    manifest["sheets"]["battle_fx_sm"] = extract_masked_planar_sheet(
        "web/assets/gfx/hdat.bin", 0x7840, 4, 2, 20, 0xC8, 0x28, 4, pals["battle"], "sheets/battle_fx_sm.png"
    )
    manifest["sheets"]["battle_ball"] = extract_masked_planar_sheet(
        "web/assets/gfx/hdat.bin", 0x7B60, 1, 1, 8, 0x28, 0x08, 1, pals["battle"], "sheets/battle_ball.png"
    )
    print("[hdat.bin] 13 battle terrain hexes + 24 battle ships + 9 FX sprites extracted")

    # 6) Wind/Current/Heading dials (9 x 40x40) & Supply icons (4 x 16x32) from ui_frame.bin
    manifest["sheets"]["dials"] = extract_planar_sheet(
        "web/assets/gfx/ui_frame.bin", 0x0490, 9, 5, 40, 9, pals["day"], "sheets/dials.png"
    )
    manifest["sheets"]["supply_icons"] = extract_planar_sheet(
        "web/assets/gfx/ui_frame.bin", 0x20D0, 4, 2, 32, 4, pals["day"], "sheets/supply_icons.png"
    )
    print("[ui_frame.bin] 9 dial arrows + 4 supply icons extracted")

    # 6) Gamble cards (5 x 32x48) & dice (6 x 24x24)
    manifest["sheets"]["gamble_cards"] = extract_planar_sheet(
        "web/assets/gfx/gamble.bin", 0, 5, 4, 48, 5, pals["day"], "sheets/gamble_cards.png"
    )
    manifest["sheets"]["gamble_dice"] = extract_planar_sheet(
        "web/assets/gfx/gamble.bin", 0x0f00, 6, 3, 24, 6, pals["day"], "sheets/gamble_dice.png"
    )
    print("[gamble.bin] cards & dice sheets extracted")


def extract_ending_and_opening(pals, manifest):
    """批次 C: 結局 (ENDGRP.DAT 60 張) 與片頭 (opgraph/00..13.dat 107 張)"""
    # 1) ENDGRP.DAT (#0..58 16色 + #0x3a 固定偏移 0x61232 8色)
    js_end = r"""
const fs = require('fs');
require('./tools/work/ui_bundle.js');
const U = globalThis.UI;
const dat = new Uint8Array(fs.readFileSync('web/assets/gfx/ENDGRP.DAT'));
const g = new U.GraphDat(dat);
const items = [];
for (let i = 0; i < g.offsets.length; i++) items.push({ off: g.offsets[i], hasTable: true });
items.push({ off: 0x61232, hasTable: false });
const chunks = [Buffer.from([items.length])];
for (const it of items) {
  const sz = U.graphSize(dat, it.off);
  const fb = new Uint8Array(640 * 400);
  U.decodeGraph(fb, dat, 0, 0, it.hasTable, it.off);
  const out = new Uint8Array(sz.w * sz.h);
  for (let y = 0; y < sz.h; y++) out.set(fb.subarray(y * 640, y * 640 + sz.w), y * sz.w);
  const hdr = Buffer.alloc(4); hdr.writeUInt16LE(sz.w, 0); hdr.writeUInt16LE(sz.h, 2);
  chunks.push(hdr, Buffer.from(out));
}
process.stdout.write(Buffer.concat(chunks));
"""
    raw = run_node_dump(js_end)
    count = raw[0]
    pos = 1
    pal = pals["day"]
    for i in range(count):
        w = int.from_bytes(raw[pos : pos + 2], "little")
        h = int.from_bytes(raw[pos + 2 : pos + 4], "little")
        pos += 4
        px = raw[pos : pos + w * h]
        pos += w * h
        rel = f"ending/end_{i:02d}.png"
        save_indexed_png(os.path.join(ART, rel), w, h, px, pal)
        manifest["ending"].append({"path": rel, "w": w, "h": h})
    print(f"[ENDGRP.DAT] {count} ending graphics extracted")

    # 2) opgraph/00.dat..13.dat
    total_op = 0
    for pack in range(14):
        tag = f"op{pack:02d}"
        rel_dat = f"web/assets/gfx/opgraph/{pack:02d}.dat"
        js_op = f"""
const fs = require('fs');
require('./tools/work/ui_bundle.js');
const U = globalThis.UI;
const dat = new Uint8Array(fs.readFileSync('{rel_dat}'));
const g = new U.GraphDat(dat);
const chunks = [Buffer.from([g.offsets.length])];
for (let i = 0; i < g.offsets.length; i++) {{
  const off = g.offsets[i];
  const sz = U.graphSize(dat, off);
  const fb = new Uint8Array(640 * 400);
  U.decodeGraph(fb, dat, 0, 0, true, off);
  const out = new Uint8Array(sz.w * sz.h);
  for (let y = 0; y < sz.h; y++) out.set(fb.subarray(y * 640, y * 640 + sz.w), y * sz.w);
  const hdr = Buffer.alloc(4); hdr.writeUInt16LE(sz.w, 0); hdr.writeUInt16LE(sz.h, 2);
  chunks.push(hdr, Buffer.from(out));
}}
process.stdout.write(Buffer.concat(chunks));
"""
        raw_op = run_node_dump(js_op)
        cnt = raw_op[0]
        p = 1
        manifest["opening"][tag] = []
        for idx in range(cnt):
            w = int.from_bytes(raw_op[p : p + 2], "little")
            h = int.from_bytes(raw_op[p + 2 : p + 4], "little")
            p += 4
            px = raw_op[p : p + w * h]
            p += w * h
            rel = f"opening/{tag}_{idx:02d}.png"
            save_indexed_png(os.path.join(ART, rel), w, h, px, pal)
            manifest["opening"][tag].append({"path": rel, "w": w, "h": h})
            total_op += 1
    print(f"[opgraph/*.dat] {total_op} opening graphics extracted")


def main():
    pals = load_palettes()
    manifest = {
        "format": "uw2-art-v1",
        "portraits": {},
        "discoveries": {},
        "buildings": {},
        "ships": {},
        "figureheads": {},
        "events": {},
        "backgrounds": {},
        "sheets": {},
        "ending": [],
        "opening": {},
        "graph": {},
        "kaoParts": {},
    }
    extract_kao(pals, manifest)
    extract_kao_parts(pals, manifest)
    extract_graph_art(pals, manifest)
    extract_events(pals, manifest)
    extract_figureheads(pals, manifest)
    extract_hud_buttons(pals, manifest)
    extract_sheets(pals, manifest)
    extract_ending_and_opening(pals, manifest)
    os.makedirs(ART, exist_ok=True)
    mpath = os.path.join(ART, "manifest.json")
    with open(mpath, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print(f"[manifest.json] written to {mpath}")


if __name__ == "__main__":
    main()
