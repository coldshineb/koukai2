# 《大航海时代 II》DOS 原版 1:1 复刻基线版（`legacy` 分支）

本项目基于《大航海时代 II》（DOS 繁体中文版）完整逆向分析打造，采用 **TypeScript + ES Modules + Vite + 原生 VGA 12h 像素帧缓冲渲染管线**，以 **100% 逐像素、逐字节还原原版 DOS 画面与运行逻辑** 为目标，并配有自研 16 位 x86 + VGA 模拟器的自动化差分回归测试套件。

> - **分支定位**：`legacy` 为忠实还原原版 `640×400` 像素画面、DOS 耗时节奏与二进制资源格式的基线分支；若需要 16:9 宽屏视野、高清羊皮纸 DOM 界面、30 周年 CD 音轨切换及规则扩展开关，请切换至 `main` 分支。
> - **技术手册**：[docs/RE_NOTES.md](docs/RE_NOTES.md) 收录了原版 `MAIN.EXE` / `OPEN.EXE` / `END.EXE` / `FMDRV.COM` 的逐行逆向公式、内存地址、指令剧本与文件格式规范。

---

## 与 `main` 分支的技术架构差异

| 维度 | `legacy` 分支（本分支） | `main` 分支 |
| --- | --- | --- |
| **显示与渲染** | 单一 `<canvas>` 模拟原版 **VGA Mode 12h（`640×400` 游戏区 + 上下 40 行黑边，`640×480` 4:3 等比锐利缩放）**，4 位平面图块解码 + 6-bit DAC 调色盘 LUT | 自适应宽屏视口渲染器 + 1:1 离屏舞台合成 + 现代 DOM 浮层混合渲染 |
| **UI 交互层** | `IGameUI` / `IScenarioHost` 的 `LegacyGameUI` / `LegacyScenarioHost` 实现，还原原版点阵字控制台（`1.pat`/`2.pat` + BIOS `8×8`→`8×16`）、像素边框窗口与键盘/鼠标菜单 | 现代羊皮纸 DOM 工作台、HUD 控制栏、可视化存档/教程/情报总览面板 |
| **资源加载方式** | 直接加载原版二进制平面/压缩包（`GRAPH.DAT`、`KAO.LZW`、`MESSAGE.DAT`、`portchip.bin` 等），前端实时 LS11 解压与图像解码 | 离线预提取与高清化后的 `web/assets/art/` 索引图集与文本 JSON |
| **剧情虚拟机** | `Scenario` VM 直接解释底层反编译剧本 `snr0..6.json`（搭配 `ScenarioMemoryAdapter` 对接 `DS` 地址空间） | 提升至结构化高阶剧本 `story0..6.json`（`uw2-story-v1`） |
| **运行节奏控制** | `cpucost.js` 虚拟时钟耗时记帐模型，还原原版 DOSBox `cycles=10500` 的指令耗时与画面延迟呈现（支持 `?cycles=N` / `?cycles=0`） | 现代 `requestAnimationFrame` 帧率驱动循环 |
| **背景音乐** | 仓库内附带 PS1 版 MP3 音轨（`web/bgm/ps1_01..27.mp3`） | 仓库内附带 PS1 版与 30 周年 CD 版双音源实时切换 |
| **开发与回归工具** | 保留 `web/dev/` 资源查看器与 UI 沙盒；支持基于 x86 + VGA 模拟器的 `test:fast` / `test:all` 差分回归 | 移除 `web/dev/`，以纯 JS/TS 领域、剧本与存档单元测试为主 |

---

## 核心特性

### 1. 原版 VGA 12h 像素渲染与实时二进制解码
- **原版显存模型**（`web/src/core/screen.js`、`palette.js`、`font.js`）：使用 `640×400` 4-bit 索引帧缓冲 + `Y_OFFSET=40` 上下黑边输出至 `640×480` 画布；内置原版时段/天候调色盘渐变与淡入淡出、全角 `14×14` 点阵（`1.pat` / `2.pat`）与半角 `8×16` 字体渲染，包含 `OPEN.EXE`（640×480 全区片头）与 `END.EXE` 结局演出。
- **前端原生解码器**（`web/src/core/ls11.js`、`web/src/gfx/`）：直接在浏览器端解压 LS11 与平面图形格式（`GRAPH.DAT` / `GRAPH2.DAT` / `EVENT*.DAT`、`KAO.LZW` 头像拼合、`worldmap.bin` 世界地图、海战与单挑动画帧）。

### 2. 强类型状态层与业务/UI 协议解耦
- **状态视图与纯领域层**（`web/src/model/`、`web/src/domain/`）：以结构化 `world.json` 与 `schema.json` 编码生成原版 `0x8074` 字节状态快照（`DS:0CA4..8D18`），通过 `schema_views.ts`（`DS` / `OFF` 具名偏移表）与 `flags.ts` 消除魔法偏移量，并将银行/物价/航速公式抽离为无框架依赖的纯 TypeScript 领域模块（`economy.ts`、`fleet.ts`）。
- **解耦接口**（`web/src/ui/protocol.ts`、`legacy_presenter.ts`、`game/scenario_adapter.ts`）：业务场景与底层 `snr0..6.json` 剧本虚拟机分别通过 `IGameUI` 与 `ScenarioMemoryAdapter` / `IScenarioHost` 运行，可独立脱离浏览器做 Node 单元测试与 DOS 差分回归。

### 3. DOS 耗时记帐模型与扩展入口
- **DOSBox 周期模拟**（`web/src/core/cpucost.js`、`cpucost_table.js`）：根据逆向测得的指令周期表模拟在 DOSBox `cycles=10500` 下的卡顿重叠、IRQ0 音乐中断占用及画面快照延后刷新。
  - 可通过 URL 查询参数调整：`?cycles=0` 关闭 CPU 耗时模拟（仅保留原版计时器等待），或 `?cycles=N` 指定基准速率。
- **港内直达扩展**：保留可选扩展指令「港内移动」（`scenes/portmove.js`），可通过 `?portmove=0` 关闭以严格对齐原版。

### 4. 原生 OPL2 音效合成与 PS1 版音乐
- **BGM 播放**（`web/src/core/audio.js`、`web/assets/data/bgm.json`）：按原版曲目表 `DS:8c20` 映射至内置 PS1 版 MP3（`web/bgm/ps1_01..27.mp3`，支持淡出等待与一次性短曲）。
- **OPL2 FM 音效**（`web/src/core/opl.js`、`sfx.js`、`sfx_worklet.js`）：使用 Web Audio `AudioWorklet` 实时合成原版 `FMDRV` 航行、暴风雨与战斗音效，支持 `?sfxvol=N` 调节输出增益。

### 5. 现代 JSON 存档与原版存档迁移
- **结构化 `uw2-save-v2` 存档库**（`web/src/save/format.ts`、`store.ts`）：以具名 `globals` / `tables` 保存至浏览器 `localStorage["uw2.saves.v2"]`，包含 1 个自动存档槽与 10 个手动槽位，支持保留或剥离 `_compat` 字段，确保与原版二进制状态 `0x8074` 字节级无损往返。
- **旧档自动迁移与控制台工具**（`web/src/save/legacy_import.ts`、`web/src/main.js`）：首次启动时自动只读迁移旧版 `localStorage["uw2.KOUKAI2.DAT"]` 或默认读取 `web/assets/save/KOUKAI2.DAT`；浏览器全局暴露 `UW2Save`（`list()`、`exportJson()`、`downloadJson()`、`importFile()`）供命令行导出或导入 `.json` / `KOUKAI2.DAT`。

---

## 快速开始

### 环境要求
- **Node.js**（建议 18+）与 **npm**
- 若需运行 `test:prep`、差分回归或从原版文件重新解包资源，需 **Python 3**

### 启动开发服务器
> 注意：本分支源码已混合使用 `.ts` 与 `.js`（ES Modules），**必须通过 Vite 开发服务器或先构建后预览运行**，无法直接用纯静态文件服务器运行未转译的 `.ts` 模块。

```bash
cd uw2_remake
npm install
npm run dev
```
Windows 环境下也可直接双击根目录的 [`start.bat`](start.bat)，会自动打开浏览器并启动 `npm run dev`。

- 游戏入口：`http://localhost:8080/`
- 资源查看器：`http://localhost:8080/dev/viewer.html`
- UI 沙盒测试：`http://localhost:8080/dev/ui_test.html`
- 数据查看器：`http://localhost:8080/dev/data.html`

### 类型检查与生产构建
```bash
# TypeScript 类型检查
npm run typecheck

# 构建生产包到 dist/
npm run build

# 本地预览生产构建结果
npm run preview
```

---

## 测试与 DOS 差分回归套件

### 1. 日常纯 JS/TS 单元测试（不依赖原版 DOS 可执行文件）
```bash
# 领域公式（经济/舰船）、ScenarioMemoryAdapter 与世界编解码单测（42 项）
npm run test:domain

# uw2-save-v2 现代 JSON 存档与 KOUKAI2.DAT 往返一致性测试（36 项）
npm run test:save

# 准备测试前置打包数据并校验世界/存档初值编码一致性（12 项）
npm run test:prep
npm run test:data
```

### 2. x86 + VGA 模拟器全量差分回归测试
通过自研 Node x86/VGA 模拟器同步运行原版 DOS 程序与 JS/TS 移植模块，逐帧比对画面像素与内存状态。需先将原版 DOS 程序副本置于 `tools/work/sea2/`（其中 `MAIN.EXE` 等文件由 `.gitignore` 排除的 `tools/work/` 托管）：

```bash
# 核心子系统快速回归（20 条代表路线）
npm run test:fast

# 全部回归路线（耗时长，覆盖所有场景与建筑物交互）
npm run test:all

# 按关键字或索引区间跑指定路线
node tools/emu/run_regress.js --filter port,market
```

---

## 目录结构

```text
uw2_remake/
├── package.json                 工程配置与测试/差分回归脚本
├── tsconfig.json                TypeScript 编译检查配置
├── vite.config.ts               Vite 配置（root=web, port=8080, outDir=dist）
├── start.bat                    Windows 一键启动脚本
├── docs/
│   └── RE_NOTES.md              DOS 原版完整逆向技术手册
├── web/                         前端应用（游戏主体）
│   ├── index.html               4:3 原版像素画布入口
│   ├── bgm/                     PS1 版背景音乐 MP3（ps1_01..27.mp3，已纳入版本管理）
│   ├── dev/                     开发辅助页（viewer / ui_test / data）
│   ├── assets/                  解包提取的原版静态与二进制资源
│   │   ├── data/                世界、港口、航道、风向海流、BGM 映射等数据
│   │   ├── font/                原版点阵字体 1.pat / 2.pat 及 charmap.json
│   │   ├── gfx/                 GRAPH.DAT、KAO.LZW、片头/结局/单挑及图块包
│   │   ├── raw/                 提取出的原始二进制数据表（DATA1/DATA2）
│   │   ├── save/                示例原版存档 KOUKAI2.DAT
│   │   ├── scenario/            反编译底层指令剧本（snr0..6.json 与 vm.json）
│   │   └── text/                MESSAGE.DAT、menu.json 及剧情文本 JSON
│   └── src/
│       ├── main.js              启动链（OPEN → MAIN → END）、虚拟时钟调度、UW2Save 桥
│       ├── core/                Screen/Palette/Font/Sys/Input/Audio/OPL2/SFX/CPUCost/LS11
│       ├── model/               强类型视图（schema_views.ts）与枚举常量（flags.ts）
│       ├── domain/              纯 TS 领域计算（economy.ts、fleet.ts）
│       ├── gfx/                 原版二进制图形解码器（GRAPH、KAO、WorldMap、DuelAnim）
│       ├── save/                uw2-save-v2 格式编解码、LocalStorage 存储、KOUKAI2.DAT 导入器
│       ├── game/                主时间循环、AI、开场/标题/新航程/结局与剧本 VM（scenario_adapter.ts）
│       ├── scenes/              港口、出海、海战、单挑、上陆、谈判、建筑模块与港内移动
│       └── ui/                  原版像素控制台/窗口/菜单/列表与 IGameUI 协议适配器
└── tools/                       离线提取、反汇编、模型生成与模拟器回归工具链
    ├── extract*.py              原版资产与剧本提取脚本（总入口 extract.py）
    ├── gen_model.py             根据 schema.json 自动生成 schema_views.ts
    ├── uw2lib.py / gamedata.py  LS11 解压、平面图形与数据结构定义
    ├── build_charmap.py         原版字码 ↔ Unicode 映射表生成器
    ├── snr2json.py / mml2json.py 剧本与 MML 音乐反编译脚本
    ├── dis86.py / re/           自研 16 位 x86 反汇编器与各模块专项逆向脚本
    ├── emu/                     x86 + VGA 模拟器、差分回归路由及单测脚本
    └── work/                    本地工作产物与原版副本目录（已由 .gitignore 忽略）
```

---

## 资源重提取与模型生成

仅当修改了底层解包脚本或状态 Schema 时需要重新生成：

```bash
# 从原版 DOS 程序目录提取全部资源到 web/assets/
python tools/extract.py <sea2目录> web/assets

# 根据 web/assets/data/schema.json 重新生成 web/src/model/schema_views.ts
python tools/gen_model.py
```

---

## 提交规范

- 已追踪全部 `web/bgm/ps1_01..27.mp3` 音频资源，`.gitignore` 仅排除 `tools/work/`、`node_modules/`、`dist/` 及 Python 缓存文件。
- 提交前建议至少运行：
  `npm run typecheck && npm run build && npm run test:domain && npm run test:save`
