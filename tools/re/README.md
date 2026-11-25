# tools/re — 各功能的逆向分析脚本
每个文件对应一个移植项目, 内容是当时用来反汇编/查表的指令, 留作复查。
运行方式 (在 uw2_remake 上一层目录):
```
python uw2_remake/tools/re/<文件名>.py
```
脚本开头 exec `tools/re_env.py` 与 `tools/re_tools.py` (需先运行 `tools/emu/prep_local.py` 准备 `tools/work/sea2`)。
输出写到 `tools/work/re_<文件名>.txt`。
