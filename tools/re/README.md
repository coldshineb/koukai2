# tools/re — 各功能的逆向分析腳本
每個檔案對應一個移植項目, 內容是當時用來反組譯/查表的指令, 留作複查。
執行方式 (在 uw2_remake 上一層目錄):
```
python uw2_remake/tools/re/<檔名>.py
```
腳本開頭 exec `tools/re_env.py` 與 `tools/re_tools.py` (需先執行 `tools/emu/prep_local.py` 準備 `tools/work/sea2`)。
輸出寫到 `tools/work/re_<檔名>.txt`。
