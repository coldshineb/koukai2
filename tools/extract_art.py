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

    # 3) Sea tiles (128 tiles of 16x16, sequential 4-plane)
    manifest["sheets"]["seachip"] = extract_seq_tile_sheet(
        "web/assets/gfx/seachip.bin", 0, 128, 16, pals["day"], "sheets/seachip.png"
    )
    print("[seachip.bin] 128 sea terrain tiles extracted")

    # 4) Compasses
    manifest["sheets"]["compass"] = extract_planar_sheet(
        "web/assets/gfx/compass.bin", 0, 8, 5, 24, 4, pals["day"], "sheets/compass.png"
    )
    manifest["sheets"]["seacompass"] = extract_planar_sheet(
        "web/assets/gfx/seacompass.bin", 0, 18, 4, 32, 9, pals["day"], "sheets/seacompass.png"
    )
    print("[compass/seacompass] compass sheets extracted")

    # 5) Naval battle sprites (61 tiles of 32x32)
    manifest["sheets"]["naval_battle"] = extract_planar_sheet(
        "web/assets/gfx/hdat.bin", 0, 61, 4, 32, 8, pals["battle"], "sheets/naval_battle.png"
    )
    print("[hdat.bin] 61 naval battle sprites extracted")

    # 6) Gamble cards (5 x 32x48) & dice (6 x 24x24)
    manifest["sheets"]["gamble_cards"] = extract_planar_sheet(
        "web/assets/gfx/gamble.bin", 0, 5, 4, 48, 5, pals["day"], "sheets/gamble_cards.png"
    )
    manifest["sheets"]["gamble_dice"] = extract_planar_sheet(
        "web/assets/gfx/gamble.bin", 0x0f00, 6, 3, 24, 6, pals["day"], "sheets/gamble_dice.png"
    )
    print("[gamble.bin] cards & dice sheets extracted")


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
    }
    extract_kao(pals, manifest)
    extract_graph_art(pals, manifest)
    extract_events(pals, manifest)
    extract_figureheads(pals, manifest)
    extract_sheets(pals, manifest)
    os.makedirs(ART, exist_ok=True)
    mpath = os.path.join(ART, "manifest.json")
    with open(mpath, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print(f"[manifest.json] written to {mpath}")


if __name__ == "__main__":
    main()
