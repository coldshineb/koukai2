"""FM 效果音 第二部分 (RE_NOTES 第 35 節): FMDRV.COM 的 IRQ0 (01d0) / 08ce / 11a6 計時、軟體 LFO (0f66..1110)、音量 (079a / 096a)、
頻率 (07ca / 0bd2)、常駐初始化 (132b / 12cf / 1267 / 06f0) 的反組譯, 以及 MAIN.EXE 9768 / 97a4 / 9804 / 9836 / 9888 本體與 23 個呼叫處的前後文。
輸出 tools/work/re_sfx2.txt。用法: python tools/re/sfx2.py"""
import os, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(HERE))).replace("\\", "/")
exec(open(os.path.join(HERE, "..", "re_env.py"), encoding="utf-8").read())
exec(open(os.path.join(HERE, "..", "re_tools.py"), encoding="utf-8").read())
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    raw = open(os.path.join(HERE, "..", "work", "sea2", "FMDRV.COM"), "rb").read()
    fb = b"\0" * 0x100 + raw + b"\0" * 16
    print("== FMDRV.COM")
    for a, b, why in [(0x01d0, 0x0245, "IRQ0 (291.304 Hz): [0120] += 36h 進位 → [011e]; 每 16 次轉 BIOS; 08ce"),
                      (0x08ce, 0x0932, "08ce: [011c] 樂曲 tick (0c79) / [011e] 效果音計時 (11a6)"),
                      (0x11a6, 0x1251, "11a6: 6 個聲部 滑音 (0fac / 103d) 或 LFO (1110); [05ce]++"),
                      (0x0f66, 0x100c, "LFO 波形 0f66 / 0f7f 鋸齒 / 0f88 三角 / 0fac 單次 / 0fc1 方波 / 0fe2 隨機 (跳躍表 DS:100c)"),
                      (0x1016, 0x11a6, "1016 波形分派 / 1030 音高 / 103d 頻率 / 10a5 音量 / 1110 LFO 狀態機"),
                      (0x0963, 0x09c7, "0963 / 096a 音量"), (0x079a, 0x07fb, "079a TL / 07ca A0-B0"),
                      (0x1267, 0x1294, "1267 初始化"), (0x12cf, 0x12e0, "12cf"), (0x132b, 0x1372, "132b OPL 偵測"),
                      (0x08a3, 0x08ce, "08a3 聲部記錄重設")]:
        print(f"\n---- {a:04x}..{b:04x} {why}")
        for i in disasm(fb, a, b): print(i)
    print("\nDS:05e6", [hex(x) for x in struct.unpack("<13H", fb[0x5e6:0x600])])
    print("DS:0600", [hex(x) for x in struct.unpack("<16H", fb[0x600:0x620])])
    print("DS:0620", [hex(x) for x in struct.unpack("<24H", fb[0x620:0x650])])
    print("DS:100c", [hex(x) for x in struct.unpack("<5H", fb[0x100c:0x1016])])
    for v in range(6):
        o = 0x48c + 0x2e * v; print(f"聲部 {v} DS:{o:04x} +26/+27 =", fb[o + 0x26], fb[o + 0x27])
    print("\n== MAIN.EXE 9768..98f7")
    for i in disasm(code, 0x9768, 0x98f7): print(i)
    print("\n== MAIN.EXE 呼叫處前後文")
    for a, b in [(0x8670, 0x8694), (0xc8f8, 0xc920), (0xce48, 0xce70), (0xd2e0, 0xd300), (0xd3c0, 0xd3d8), (0x122d8, 0x12306), (0x16c90, 0x16cc0),
                 (0x19a36, 0x19a52), (0x19e20, 0x19e3a), (0x1bcc0, 0x1bcf8), (0x1bd2c, 0x1bd3c), (0x213c5, 0x2141e), (0x29780, 0x297c4), (0x349f8, 0x34a20)]:
        print(f"-- {a:05x}")
        for i in disasm(code, a, b): print(i)
open(os.path.join(HERE, "..", "work", "re_sfx2.txt"), "w", encoding="utf-8").write(buf.getvalue())
print(len(buf.getvalue()))
