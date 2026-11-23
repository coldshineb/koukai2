# 大航海時代II 現代化移植

## 目錄
```
uw2_remake/
├── start.bat            啟動本機伺服器並打開遊戲
├── tools/               資源提取與逆向工具 (Python)
│   ├── git_commit.py    不需外部 git 的提交工具 (python tools/git_commit.py "說明")
│   ├── uw2lib.py        LS11 解壓 / 平面圖形 / 調色盤 / 字型字碼規則
│   ├── build_charmap.py 原版字碼 ↔ Unicode 對照表
│   ├── extract.py       一鍵提取全部資源到 web/assets (含 extract_newgame.py / extract_port.py)
│   ├── dis86.py         自寫 16 位元 x86 反組譯器
│   ├── re_env.py / re_tools.py / re_local.py  反組譯環境與輔助函式
│   ├── re/              各功能的逆向分析腳本 (python tools/re/<名稱>.py), 輸出到 tools/work/
│   ├── emu/             x86 + VGA 模擬器與差分測試 (node tools/emu/run_local.js <測試>.js)
│   └── work/            分析與測試的工作檔 (原版檔案副本 sea2/、反組譯輸出、測試截圖), 可隨時刪除重建
├── docs/RE_NOTES.md     逆向分析筆記 (格式, 位址, 待辦)
└── web/                 網頁版 (原生 ES Modules, 無需建置)
    ├── index.html       遊戲
    ├── dev/viewer.html  資源檢視器 (開發用)
    ├── src/             引擎與遊戲邏輯 (JS)
    ├── assets/          提取出的資源 (PNG / JSON)
    └── bgm/             PS 版音樂
```

## 執行
瀏覽器不允許從 file:// 載入模組，必須經本機伺服器開啟。雙擊 `start.bat` 即可（需要 Python 3）。
也可以用任何靜態伺服器，例如在 `web` 目錄下執行 `npx serve`。

- 遊戲：http://localhost:8080/
- 資源檢視器：http://localhost:8080/dev/viewer.html

## 重新提取資源
```
python tools/extract.py <sea2目錄> web/assets
```
重建字碼表另需 GNU Unifont 15.1.05 的 hex 檔，僅用於比對字形；遊戲本身不使用它。

## 版本管理
每移植完一項功能提交一次。`.gitignore` 排除 `tools/work/` 與 `web/bgm/`。
可用一般的 git 操作，也可用 `python tools/git_commit.py "說明"`（等同 `git add -A && git commit`）。
