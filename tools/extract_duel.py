# extract_duel.py — 一骑打 (MAIN.EXE 12998 以下, docs/RE_NOTES.md 30.16..30.18) 用到的原始数据 → web/assets
#   gfx/duel/DATA1.LZW   DATA1.LZW 原样 (#0 / #1 甲板背景、#2 / #3 船舷前景; 12612 以 71f4 解到 [03ee])
#   gfx/duel/IAP1..6.LZW 主角那方的动画 (文件名字符 [0aff] = '1' + 主角编号), IAE1.LZW 对手的动画; 原样拷贝 (LS10, 35 项 = 7 组动作 × 5)
#   data/duel.json       DS 常数:
#     ds        DS:9d44..a170 的初始内容 (一骑打的工作区与字符串 a034..a12e; 移植版放在海战的 DS 镜像, 与原版同地址)
#     attack    DS:a086 的 3 个近指针所指的字符串 (11394 攻击菜单「劈刺 / 横斩 / 力劈」)
#     defend    DS:a0ba 同上 (113dc 防守菜单「化解 / 力敌 / 闪躲」)
# 用法: python extract_duel.py <sea2 目录> <web/assets 目录>
import json, os, shutil, struct, sys

DS = 0x38150          # DGROUP 在 MAIN.EXE 加载映像中的线性地址 (与 re_env.py 相同)
FILES = ["DATA1.LZW", "IAE1.LZW"] + [f"IAP{i}.LZW" for i in range(1, 7)]


def main(sea2, assets):
    ex = open(os.path.join(sea2, "MAIN.EXE"), "rb").read(); img = ex[struct.unpack("<H", ex[8:10])[0] * 16:]
    b = lambda o, n: img[DS + o:DS + o + n]
    w = lambda o: struct.unpack("<H", b(o, 2))[0]
    cs = lambda o: img[DS + o:img.index(b"\0", DS + o)].hex()
    os.makedirs(os.path.join(assets, "gfx", "duel"), exist_ok=True)
    for f in FILES:
        shutil.copyfile(os.path.join(sea2, f), os.path.join(assets, "gfx", "duel", f))
    J = {
        "ds": {"9d44": b(0x9d44, 0xa170 - 0x9d44).hex()},
        "attack": [cs(w(0xa086 + 2 * i)) for i in range(3)],
        "defend": [cs(w(0xa0ba + 2 * i)) for i in range(3)],
    }
    json.dump(J, open(os.path.join(assets, "data", "duel.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("duel.json", len(J["ds"]["9d44"]) // 2, "bytes of DS;", len(FILES), "files -> gfx/duel")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
