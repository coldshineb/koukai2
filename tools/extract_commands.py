# extract_commands.py — 港口指令按鈕 (情報 / 經營 / 命令 / 航海術, 1b8c8 → DS:a642 表) 用到的 MAIN.EXE 常數 → web/assets/data/commands.json
#   字串一律存原版位元組的十六進位 (不含結尾 0), 由 scenes/commands.js 以 cmHex() 轉回。可重複執行。
#   分析腳本: tools/re/commands.py → tools/work/re_cmd_*.txt; 結論: docs/RE_NOTES.md 第 26 節
# 用法: python tools/extract_commands.py <sea2 目錄> <web/assets 目錄>   (或 exec 後呼叫 main(sea2, assets))
import json, os, struct, sys

DS = 0x38150          # DGROUP 在 MAIN.EXE 載入映像中的線性位址 (與 re_env.py 相同)

STR = {
    # 航海術 隨身物 29a4c (294d5 佩戴 / 299f5 使用 / 2962f 用不了)
    "noEquip": 0xb11e, "unequip": 0xb12f, "equipped": 0xb13a,
    "kDefense": 0xb145, "kWeapon": 0xb14a, "kShield": 0xb14f, "kArmor": 0xb152, "kThing": 0xb155, "cantUse": 0xb15c,
    "hour": 0xb16b, "minute": 0xb170, "farSight": 0xb176, "meow": 0xb185,
    "ratGone": 0xb18c, "noTrouble": 0xb199, "stormNight": 0xb1b0, "stormDay": 0xb1c9, "noTrouble2": 0xb1e2,
    "scurvyCured": 0xb1f9, "good": 0xb208,
    # 停船 20ee3
    "move": 0xa9c9, "stop": 0xa9d0,
    # 功能 215bd: 環境設定 214cf / 結束遊戲 2157f
    "on": 0xaa5e, "off": 0xaa65, "optAnim": 0xaa6c, "optBgm": 0xaa75, "optMouse": 0xaa7c, "optSeaMove": 0xaa87,
    "optSeaSpeed": 0xaa92, "fmtS": 0xaa9b, "quitAsk": 0xaa9f,
    # 存檔 16cf0: 日期字串中段
    "saveYear": 0xa39e,
    # 1764f 結束畫面
    "endColor": 0xa3d0,
    # 命令: 隊形變更 20587 (2029f / 202f7)、糧食分配 208af (206dd / 20848)、酬金設定 20933
    "fmNum": 0xa973, "fmColor": 0xa979, "fmShip": 0xa980, "fmBlank": 0xa987,
    "rtColor": 0xa9b3, "rtColor2": 0xa998, "water": 0xa99f, "food": 0xa9a2, "pct": 0xa9a7, "wageRange": 0xa9ba,
    # 經營: 人事變更 1ea99 / 1eae1、水手編組 1ed8c / 1edcc、水手比例 1f141 / 1f036
    "pAssist": 0xa857, "pAccount": 0xa864, "pBosun": 0xa871, "pPad0": 0xa881, "pPad1": 0xa883, "pPad2": 0xa885,
    "slColor": 0xa887, "slRest": 0xa88e, "slColor2": 0xa89b, "slNum": 0xa8a2,
    "rColor": 0xa8cc, "rDrive": 0xa8d3, "rWatch": 0xa8d8, "rDeck": 0xa8dd, "rNum": 0xa8a8,
    # 情報: 自艦隊 1d0e8、艦船 1c1a3、人物 1c839、主公 1cc11; 清單種類 1 的列格式 149b0
    "fvColor": 0xa79c, "siColor": 0xa760, "n4": 0xa767, "siClass": 0xa76b, "siHi": 0xa771, "siMid": 0xa775,
    "piColor": 0xa785, "piStat": 0xa78c, "piTitle": 0xa794, "n3": 0xa798, "lsPad1": 0xa197, "lsTotal1": 0xa199,
    # 航海日誌 1e31e、海港地圖 1dfaf
    "logDate": 0xa7f6, "logPrev": 0xa803, "logNext": 0xa808, "pmColor": 0xa7e8, "pmColor2": 0xa7ef,
}
BYTES = {
    "fleetPos": (0xa7a4, 20),        # 1d0e8 艦隊一覽各船圖位置 (欄, 列×16)
    "windSpeed": (0x06d8, 0x80),     # 1d0e8 風向差 k 的速度表: DS:06d8 + 8k + 船型
    "goodsCat": (0x0784, 10),        # 1fd9:468e (2441e) 商品分類界線
}
WORDS = {
    "gunA": (0x07ec, 8), "gunB": (0x07fc, 8),   # 1d0e8 砲種的戰力係數
    "gunW": (0x07dc, 8),                        # 1c1a3 砲種重量 (0x378)
}
PTRS = {
    "skills": (0x08ec, 5),           # 1c839 技能名 (測量/地圖製作/砲術/會計/交涉)
}
# 注意: seg0:92f7 百分比條的顏色 DS:bafa / bafc 在 BSS (不在檔案內), 由 seg0:9376 設定 (初值 0)


def main(sea2, assets):
    ex = open(os.path.join(sea2, "MAIN.EXE"), "rb").read(); img = ex[struct.unpack("<H", ex[8:10])[0] * 16:]
    b = lambda o, n: img[DS + o:DS + o + n]

    def cs(o):
        t = b(o, 256); return t[:t.index(0)].hex()
    u16 = lambda o: struct.unpack("<H", b(o, 2))[0]
    out = {"str": {k: cs(v) for k, v in STR.items()},
           "tab": {**{k: list(b(o, n)) for k, (o, n) in BYTES.items()},
                   **{k: [u16(o + 2 * i) for i in range(n)] for k, (o, n) in WORDS.items()}},
           "ptr": {k: [cs(u16(o + 2 * i)) for i in range(n)] for k, (o, n) in PTRS.items()}}
    p = os.path.join(assets, "data", "commands.json")
    json.dump(out, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("->", p, len(out["str"]), "strings")
    return out


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
