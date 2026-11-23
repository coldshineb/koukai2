# extract_event.py — 劇情插圖 (劇本命令 CB, MAIN.EXE 331e4 → 31e81, docs/RE_NOTES.md 第 31 節) 用到的原始資料 → web/assets
#   gfx/event/EVENT0..6.DAT   原樣複製 (GRAPH.DAT 格式: u32 大端偏移表 + 16 色圖; 遊戲用 EVENT{主角+1}.DAT, 檔名字元 DS:0a89 由 1681a 寫入)
# 用法: python extract_event.py <sea2 目錄> <web/assets 目錄>
import os, shutil, sys

FILES = [f"EVENT{i}.DAT" for i in range(7)]


def main(sea2, assets):
    os.makedirs(os.path.join(assets, "gfx", "event"), exist_ok=True)
    for f in FILES:
        shutil.copyfile(os.path.join(sea2, f), os.path.join(assets, "gfx", "event", f))
    print(len(FILES), "files -> gfx/event")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
