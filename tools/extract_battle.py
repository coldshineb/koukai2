# extract_battle.py — 海战 (MAIN.EXE 10f7e 以下, docs/RE_NOTES.md 第 30 节) 用到的原始数据 → web/assets
#   gfx/hdat.bin       HDAT.PUT 原样 (0x7b88 bytes; 0be20 读到 [03ee]:0): 战场图块 13 张 × 0x200 (32×32, 4 平面交错) 起于 0,
#                      船的图 0x1a00 + (种类 × 6 + 方向) × 0x280 (前 0x80 = 1bpp 遮罩 4 栏 × 32 行, 后 0x200 = 4 平面图像)
#   data/battle.json   DS 常数:
#     ds       DS:9bfe..9d2f 的初始内容 (小地图点阵 9bfe、调色盘循环 9c2e..9c75、战场调色盘 9c76、面板字符串 9ca6..9d2e);
#              海战的 DS 工作区 (8e14..9e5f) 以 MAIN.EXE 的初始值开始, 这一段是其中唯一非 0 的部分
#     t07ec    DS:07ec 每种 船 +8 & 7 的值 (word 表, 取低字节): 0f259 → 船 +15
#     t07fc    DS:07fc 同上 (word 表): 0f259 的倍率
#     coast    0ebce 依 8 邻格的陆地比特 (bit7 左上 .. bit0 右下) 选海岸图块的分歧链 (ec77..ed4d, 以 dec / sub / jcc 逐一比较),
#              由 MAIN.EXE 的机器码直接求值: {字节合: 图块值}, 其他组合不改
#     ds["8cd6"]  DS:8cd6..8e13 (情报 / 信号 / 作战的字符串 8cd6..8de7、远程函数表; 8cd6..8d17 虽在存盘区的地址范围内,
#                 移植版的状态在 8a18 起放交易记录, 所以字符串放在 DS 镜像)
#     shipNames   DS:091c 船链序号的名称 (旗舰、１号舰 … ９号舰), 10 个 C 字符串
#     str         DS:a779 / a780 (1c652 对方船只数据的色码与「\n%s\n」)
# 用法: python extract_battle.py <sea2 目录> <web/assets 目录>
import json, os, shutil, struct, sys

DS = 0x38150          # DGROUP 在 MAIN.EXE 加载映像中的线性地址 (与 re_env.py 相同)


def coast_table(img):
    """0ebce 的分歧鏈: AX = 鄰格位元組合 (0..255), 從 ec77 執行到寫入圖塊的區塊 (8b5ef4 8bc6 b93400 f7e9 8bf8 c681148e XX) 或預設 (8b5ef4 e9)"""
    WRITE = bytes.fromhex("8b5ef48bc6b93400f7e98bf8c681148e")
    out = {}
    for v in range(256):
        ax, p, zf, sf, of = v, 0xec77, False, False, False
        for _ in range(400):
            op = img[p]
            if op == 0x48:                                   # dec ax
                a, b = ax, 1; ax = (ax - 1) & 0xffff; p += 1
            elif op == 0x2d:                                 # sub ax, imm16
                a, b = ax, struct.unpack("<H", img[p + 1:p + 3])[0]; ax = (ax - b) & 0xffff; p += 3
            else:
                if op == 0xe9: t = (p + 3 + struct.unpack("<h", img[p + 1:p + 3])[0]) & 0xfffff; take = True
                elif op == 0xeb: t = p + 2 + struct.unpack("<b", img[p + 1:p + 2])[0]; take = True
                else:
                    t = p + 2 + struct.unpack("<b", img[p + 1:p + 2])[0]
                    take = {0x75: not zf, 0x74: zf, 0x7d: sf == of, 0x7c: sf != of, 0x7f: (not zf) and sf == of, 0x7e: zf or sf != of}[op]
                if not take:
                    p += 2; continue
                if img[t:t + 16] == WRITE:
                    out[v] = img[t + 16]; break
                if img[t:t + 4] == bytes.fromhex("8b5ef4e9"):
                    break
                p = t; continue
            r = (a - b) & 0xffff; zf = r == 0; sf = bool(r & 0x8000)
            sa = a - (0x10000 if a & 0x8000 else 0); of = not (-32768 <= sa - b <= 32767)
        else:
            raise RuntimeError("coast chain")
    return out


def main(sea2, assets):
    ex = open(os.path.join(sea2, "MAIN.EXE"), "rb").read(); img = ex[struct.unpack("<H", ex[8:10])[0] * 16:]
    b = lambda o, n: img[DS + o:DS + o + n]
    os.makedirs(os.path.join(assets, "gfx"), exist_ok=True)
    shutil.copyfile(os.path.join(sea2, "HDAT.PUT"), os.path.join(assets, "gfx", "hdat.bin"))
    cs = lambda o: img[DS + o:img.index(b"\0", DS + o)].hex()          # DS 上的 C 字符串
    w = lambda o: struct.unpack("<H", b(o, 2))[0]
    J = {
        "ds": {"9bfe": b(0x9bfe, 0x9d30 - 0x9bfe).hex(), "8cd6": b(0x8cd6, 0x8e14 - 0x8cd6).hex()},
        "t07ec": [b(0x07ec + 2 * i, 1)[0] for i in range(8)],
        "t07fc": [b(0x07fc + 2 * i, 1)[0] for i in range(8)],
        "coast": {str(k): v for k, v in sorted(coast_table(img).items())},
        "shipNames": [cs(w(0x091c + 2 * i)) for i in range(10)],
        "str": {"a779": cs(0xa779), "a780": cs(0xa780)},
    }
    json.dump(J, open(os.path.join(assets, "data", "battle.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("battle.json", len(J["coast"]), "coast entries; hdat.bin", os.path.getsize(os.path.join(assets, "gfx", "hdat.bin")))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
