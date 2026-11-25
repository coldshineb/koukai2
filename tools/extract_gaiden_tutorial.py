# tools/extract_gaiden_tutorial.py — 从《大航海时代外传》Win95 简中版光盘镜像 (KGDW95.bin / KOUKAIGD.EXE) 提取全部 42 篇建筑老人教程 + 60 条航海小贴士
import json
import struct
import sys
from pathlib import Path

DEFAULT_BIN = r"E:\下载\[大航海时代外传][大航海時代外伝][19981115][Win95][简中][光盘镜像]\[大航海时代外传][大航海時代外伝][19981115][Win95][简中][光盘镜像]\KGDW95.bin"
DELTA = 0x45B000 - 0x59E00  # .data VA - raw offset in KOUKAIGD.EXE

def read_iso_file(f, lba, size):
    out = bytearray()
    rem, cur = size, lba
    while rem > 0:
        f.seek(cur * 2352 + 16)
        chunk = f.read(min(2048, rem))
        out.extend(chunk)
        rem -= len(chunk)
        cur += 1
    return bytes(out)

def read_cstr(exe, va):
    off = va - DELTA
    z = exe.find(b"\x00", off, off + 2048)
    if z < 0:
        return ""
    return exe[off:z].decode("gb18030")

def parse_esc_segments(text):
    """将原版 \x1bC2...\x1bC0 红色高亮控制码解析为分段数组，便于现代 UI 精确高亮呈现"""
    segs = []
    i = 0
    n = len(text)
    hi = False
    buf = []
    while i < n:
        if text[i] == "\x1b" and i + 2 < n and text[i + 1] == "C":
            if buf:
                segs.append({"t": "".join(buf), "hi": hi})
                buf = []
            hi = (text[i + 2] != "0")
            i += 3
            continue
        buf.append(text[i])
        i += 1
    if buf:
        segs.append({"t": "".join(buf), "hi": hi})
    return segs

def main():
    bin_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_BIN
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parent.parent / "web" / "assets" / "data" / "tutorial.json"

    with open(bin_path, "rb") as f:
        exe = read_iso_file(f, 17055, 581120)

    # 验证 0x5b9a0..0x5ba78 教程正文指针表与标题指针表
    # 正文指针表：0x5b9a0..0x5ba48 (42 个指针，对应 0x5de98..0x5ba78，倒序存放!)
    # 先自动扫描 0x5b8e0..0x5ba78 找到两组各 42 个连续字符串指针
    title_ptrs = []
    body_ptrs = []
    for off in range(0x5b8e0, 0x5ba78, 4):
        va = struct.unpack_from("<I", exe, off)[0]
        if 0x45b000 <= va < 0x486200:
            raw = va - DELTA
            if 0x5df80 <= raw <= 0x5e2a0:
                title_ptrs.append((off, va, read_cstr(exe, va)))
            elif 0x5ba70 <= raw <= 0x5df80:
                body_ptrs.append((off, va, read_cstr(exe, va)))

    assert len(title_ptrs) == 42, f"Expected 42 titles, got {len(title_ptrs)}"
    assert len(body_ptrs) == 42, f"Expected 42 bodies, got {len(body_ptrs)}"

    # 按标题和正文配对（两者在原表内严格一一对应）
    entries = []
    for (_, _, title), (_, _, body) in zip(title_ptrs, body_ptrs):
        # 修正原版中唯一一处明显错别字「适合海盗的职」→「适合海盗的船」
        if title == "适合海盗的职":
            title = "适合海盗的船"
        # 将全角省略号 ┅┅ 规范为 ……
        clean_body = body.replace("┅┅", "……")
        entries.append({
            "title": title,
            "segments": parse_esc_segments(clean_body),
        })

    # 4 大建筑分类（与外传原版 4 处入口严格一致：交易所 8 篇、酒馆 9 篇、造船厂 14 篇、码头 11 篇）
    greetings = [
        read_cstr(exe, struct.unpack_from("<I", exe, 0x621fc)[0]),  # 交易所老人
        read_cstr(exe, struct.unpack_from("<I", exe, 0x62204)[0]),  # 酒馆醉汉
        read_cstr(exe, struct.unpack_from("<I", exe, 0x6220c)[0]),  # 造船厂船爱好者
        read_cstr(exe, struct.unpack_from("<I", exe, 0x62214)[0]),  # 码头老人
    ]

    categories = [
        {
            "id": "market",
            "name": "交易所 · 经商窍门",
            "npc": "老人",
            "greeting": greetings[0].replace("§老人§\n", "").replace("\n", ""),
            "entries": entries[0:8],
        },
        {
            "id": "tavern",
            "name": "酒馆 · 情报与成长",
            "npc": "醉汉",
            "greeting": greetings[1].replace("§醉汉§\n", "").replace("\n", ""),
            "entries": entries[8:17],
        },
        {
            "id": "shipyard",
            "name": "造船厂 · 舰船知识",
            "npc": "船爱好者",
            "greeting": greetings[2].replace("§船爱好者§\n", "").replace("\n", ""),
            "entries": entries[17:31],
        },
        {
            "id": "wharf",
            "name": "码头 · 安全航海",
            "npc": "老人",
            "greeting": greetings[3].replace("§老人§\n", "").replace("\n", ""),
            "entries": entries[31:42],
        },
    ]

    # 提取 60 条原版航海小贴士 (0x61df4..0x61fcc，每项 8 字节)
    tips = []
    for off in range(0x61df4, 0x61fd4, 8):
        va = struct.unpack_from("<I", exe, off)[0]
        if 0x45b000 <= va < 0x486200:
            s = read_cstr(exe, va).replace("\n", "")
            if s:
                tips.append(s)

    doc = {
        "source": "《大航海时代外传》Win95 简体中文版 (KOUKAIGD.EXE)",
        "categories": categories,
        "tips": tips,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Extracted {len(entries)} lectures across {len(categories)} categories + {len(tips)} tips -> {out_path}")
    for cat in categories:
        print(f"  [{cat['id']}] {cat['name']} ({len(cat['entries'])}篇): {cat['entries'][0]['title']} ... {cat['entries'][-1]['title']}")

if __name__ == "__main__":
    main()
