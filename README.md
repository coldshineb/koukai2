# 《大航海时代 II》现代化移植

## 目录
```
uw2_remake/
├── start.bat            启动本地服务器并打开游戏
├── tools/               资源提取与逆向工具 (Python)
│   ├── git_commit.py    无需外部 git 的提交工具 (python tools/git_commit.py "说明")
│   ├── uw2lib.py        LS11 解压 / 平面图形 / 调色盘 / 字型字码规则
│   ├── build_charmap.py 原版字码 ↔ Unicode 对照表
│   ├── extract.py       一键提取全部资源到 web/assets (含 extract_newgame.py / extract_port.py)
│   ├── dis86.py         自写 16 位 x86 反汇编器
│   ├── re_env.py / re_tools.py / re_local.py  反汇编环境与辅助函数
│   ├── re/              各功能的逆向分析脚本 (python tools/re/<名称>.py)，输出到 tools/work/
│   ├── emu/             x86 + VGA 模拟器与差分测试 (node tools/emu/run_local.js <测试>.js)
│   └── work/            分析与测试的工作文件 (原版文件副本 sea2/、反汇编输出、测试截图)，可随时删除重建
├── docs/RE_NOTES.md     逆向分析技术手册 (格式、地址、公式、Flag 与原版特性)
└── web/                 网页版 (原生 ES Modules，无需构建)
    ├── index.html       游戏
    ├── dev/viewer.html  资源查看器 (开发用)
    ├── src/             引擎与游戏逻辑 (JS)
    ├── assets/          提取出的资源 (PNG / JSON)
    └── bgm/             PS 版音乐
```

## 运行
浏览器不允许从 `file://` 加载模块，必须经本地服务器打开。双击 `start.bat` 即可（需要 Python 3）。
也可以用任意静态服务器，例如在 `web` 目录下执行 `npx serve`。

- 游戏：http://localhost:8080/
- 资源查看器：http://localhost:8080/dev/viewer.html

## 重新提取资源
```
python tools/extract.py <sea2目录> web/assets
```
重建字码表另需 GNU Unifont 15.1.05 的 hex 文件，仅用于比对字形；游戏本身不使用它。

## 版本管理
每移植完一项功能提交一次。`.gitignore` 排除 `tools/work/` 与 `web/bgm/`。
可用一般的 git 操作，也可用 `python tools/git_commit.py "说明"`（等同 `git add -A && git commit`）。
提交者身份一律取自本机 git 配置（`git config --global user.name / user.email`），工具不写入也不猜测；读不到时只暂存快照，执行 `python tools/git_fix_author.py` 会用全局配置补成提交（并把旧提交的作者改成全局配置）。
