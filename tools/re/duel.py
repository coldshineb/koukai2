"""一騎打分析: 海戰接舷 / 指令「攻擊」的入口 0fea:2d1a = 12bba (AX = 1 玩家發起 / 0 電腦發起) 與劇本命令 E8 0fea:2ca9 = 12b49,
本體 12998 以下全部展開 (沿用 battle3.py 的跳躍表辨認) → tools/work/re_duel.txt
用法: python tools/re/duel.py"""
import os
HERE = os.path.dirname(os.path.abspath(__file__))
ROOTS = [0x12bba, 0x12b49]
OUT = "re_duel.txt"
DEPTH = 4                                    # 展開深度 (太深會跑很久)
NAMES = {0x12bba: "一騎打入口 (海戰)", 0x12b49: "劇本 E8 一騎打", 0x12998: "一騎打本體"}
# 已移植、與一騎打無關的海戰函式不展開
SKIP = {0xbd26, 0xbe20, 0xc581, 0xbcfa, 0x07f7, 0x99f2, 0x99ce, 0x16ee, 0x1743, 0x5998, 0x5b5d, 0x0906, 0x03d2}
exec(open(os.path.join(HERE, "battle3.py"), encoding="utf-8").read())
