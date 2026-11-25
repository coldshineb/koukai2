# 大航海时代 II · 现代复刻版（Uncharted Waters II Remake）

基于《大航海时代 II》（DOS 繁体中文版）完整逆向分析打造的现代化 Web 重制版，采用 **TypeScript + ES Modules + Vite + Canvas 2D / DOM 混合架构**，在忠实保留原版航海、贸易、海战、单挑、探索与七位主角全剧情逻辑的前提下，提供 16:9 宽屏全视野、简体中文高清界面、双版本原声热切换、现代 JSON 存档以及可选的规则扩展与原版缺陷修复开关。

> - 分支说明：`main` 为现代化宽屏与高清 DOM UI 主线；`legacy` 为早期对照原版画面的基线分支。
> - 技术手册：[docs/RE_NOTES.md](docs/RE_NOTES.md) 收录了原版 `MAIN.EXE` / `OPEN.EXE` / `END.EXE` / `FMDRV.COM` 的逐行逆向公式、内存地址与文件格式规范。

---

## 核心特性

### 1. 16:9 宽屏无缝混合渲染与原版时段着色
- **港口与全球海面视口**（`web/src/renderer/world.ts`）：以 `1280×720` 全屏铺满渲染港口地图（`96×96`）与全球无缝海面（`2160×1080`，`24×24` 分块缓存并支持经度 0/2160 跨界环绕），在 1:1 整数像素离屏舞台合成后再整帧贴屏，消除 HiDPI 缩放下的图块接缝。
- **原版 16 色时段调色盘**：完整还原黎明、白天、黄昏、夜晚与海上阴天调色盘，实时重映射地表图块与精灵配色。
- **过场与战斗演出**：包含 `OPEN.EXE` 片头演出、`title.js` 标题选单、海战视口、单挑甲板、上陆探索与 `END.EXE` 通关结局演出（结局播完后自动清理状态并回到主菜单）。

### 2. 现代高清羊皮纸 DOM 交互系统
- **顶部控制栏**（`web/src/ui/shell.ts`）：支持游戏速度切换（暂停 / `1×` / `2×` / `4×`）、BGM 与 SFX 独立静音/音量滑杆、内置图文《航海教程》（含外传教学）、存档管理及全屏幕切换。
- **全建筑一体化工作台**（`web/src/ui/buildings/`）：
  - **交易所**（`market.ts`）：买进/卖出、杀价与物价行情、商业投资与行情波动。
  - **酒馆**（`tavern.ts` + `gamble.ts`）：水手雇佣/解雇、饮酒传闻、在港航海者情报与劝诱、酒吧女郎、二十一点与骰子赌博。
  - **造船厂**（`shipyard.ts` + `shipyard_parts.ts`）：造新船、买旧船、修理、卖船、改造（船首像/武装/积载比例/船名）与工业投资。
  - **码头 / 旅馆 / 银行 / 道具店 / 教会 / 占卜师 / 王宫 / 事务所 / 住宅**：全套对应工作台 + 港内直达面板（`PortMove`）。
- **情报与经营总览**：
  - **情报面板**（`info_hub.ts`、`info_maps.ts`、`info_modals.ts`）：自舰队、舰船、人物、主公、积载详情/一览、发现物、可缩放与右键返回的海港地图/世界航海图、航海日志。
  - **经营面板**（`fleet_panel.ts`、`info_modals.ts`）：船长变更、水手比例、人事变更、积载分配与舰队队形顺序调整。
- **海战、单挑与海域交互**（`battle_hud.ts`、`duel_hud.ts`、`sea_modals.ts`）：专属海战指令/舰船详情/信号/掠夺界面、单挑攻防出招界面、藏宝图/探索弹窗，以及与亚格相机同步的海面目标选择（`cellsel.js`）。
- **剧情脚本与统一对白手感**（`story_lifter.ts`、`story_runner.ts`、`scenario_host.ts`）：7 套结构化高阶剧本（`story0..6.json`，格式 `uw2-story-v1`）与全对白统一为右下角跳动 `▼` 提示，支持左键、右键及 `Enter` / `Space` / `Esc` 推进，并防止右键尾随事件误关后续弹窗。

### 3. 双版本音乐包热切换与原生 FM 音效
- **BGM 版本实时切换**（`web/src/core/audio.js`、`web/assets/data/bgm.json`）：
  - **PS1 版**：全 27 首 PS 版音轨（`web/bgm/ps1_01..27.mp3`）。
  - **30 周年 CD 版**：收录官方 30 周年纪念原声碟《大航海时代 II》12 首重编曲（`web/bgm/cd30/cd30_01..12.mp3`，标题选单 `SONG_TITLE=3` 与约翰海上曲目 `4` 均对应《Caprice for Lute》），其余未重编曲目自动回退 PS1 版。
- **OPL2 FM 音效合成**（`web/src/core/opl.js`、`sfx.js`、`sfx_worklet.js`）：使用 AudioWorklet 实时合成原版暴风雨、航行与战斗效果音。

### 4. 现代 JSON 存档与原版存档导入
- **跨会话本地存储**（`web/src/save/store.ts`、`format.ts`）：采用结构化 `uw2-save-v2` JSON 格式，提供 1 个自动存档位与 10 个手动槽位，支持导出/导入 `.json` 存档包（可选择剥离 `_compat` 字段）。
- **DOS 原版存档兼容**（`web/src/save/legacy_import.ts`）：支持直接读取导入原版 `KOUKAI2.DAT`（仓库在 `web/assets/save/KOUKAI2.DAT` 附带示例档用于兼容测试与导入体验）。

### 5. 跨存档全局设定与可选开关（默认全关）
所有复刻扩展均持久化在 `localStorage`（键名 `uw2.prefs.v1`，`web/src/core/prefs.ts`），**默认全部关闭**以保持与原版完全一致的游戏规则与手感度：
- **规则扩展与原版缺陷修复（5 项独立开关）**：
  1. `unlock1552` — 解除 1552 年底强制退休结档限制，可无限年继续航海。
  2. `unlockCashCap` — 将随身现金硬上限由 6 亿提升至 20 亿金币（安全避免有符号 i32 溢出）。
  3. `fixItemShopNight` — 修正道具店特殊夜市问候条件，改为在真实夜市时段（02:00–03:00）触发。
  4. `fixPalaceHeroCaptain` — 修正王宫船舶援助中空船位初值 `0` 误判约翰已任船长的原版缺陷。
  5. `fixScoutSpeedArgs` — 修正海上「侦察」预测敌舰航速时风向/风力与海流参数传反的缺陷。
- **实验性视觉开关（2 项独立开关）**：
  1. `smoothMove` — 角色/NPC 步行与海面舰队 60fps 连续插值移动（海上因原版时钟多段等待，节奏仍有一定波动）。
  2. `smoothCamera` — 港口与海面镜头缓动跟随。

---

## 快速开始

### 环境要求
- **Node.js**（建议 18+）与 **npm**
- 若需运行测试前置生成脚本（`test:prep`）或从原版重新解包资源，另需 **Python 3**

### 启动开发服务器
```bash
cd uw2_remake
npm install
npm run dev
```
Windows 环境下也可直接双击根目录的 [`start.bat`](start.bat)，会自动打开浏览器并运行 `npm run dev`。

- 游戏入口：`http://localhost:8080/`

### 类型检查与生产构建
```bash
# 严格 TypeScript 检查（含未使用局部变量检查）
npx tsc --noEmit --noUnusedLocals

# 构建生产包到 dist/
npm run build

# 本地预览生产构建结果
npm run preview
```

---

## 测试套件

运行下列测试前，`package.json` 中的 `test:prep` 会准备局部运行数据；构建与全套纯 JS/TS 单测均不依赖原版 DOS 商业文件即可运行：

```bash
# 1. 领域逻辑、规则开关、全局偏好与二进制 JSON 解码单测（60 项）
npm run test:domain

# 2. 7 位主角剧本结构（uw2-story-v1）与剧情虚拟机单测（20 项）
npm run test:story

# 3. 现代 JSON 存档（uw2-save-v2）与原版 KOUKAI2.DAT 往返一致性测试（36 项）
npm run test:save

# 4. 世界初值编码 / 解码一致性测试（12 项）
npm run test:prep
npm run test:data
```

> 注：`package.json` 中的 `test:fast` 与 `test:all` 为早期逆向阶段配合 `tools/emu/` 与 DOS 模拟器使用的对照入口（需另备原版程序目录于 `tools/work/sea2/`），日常现代版开发以 `npx tsc --noEmit --noUnusedLocals`、`npm run build` 及以上 4 套单测为主。

---

## 目录结构

```text
uw2_remake/
├── package.json                 工程配置与测试脚本
├── tsconfig.json                TypeScript 编译检查配置
├── vite.config.ts               Vite 打包配置（root=web, port=8080, outDir=dist）
├── start.bat                    Windows 一键启动脚本
├── docs/
│   └── RE_NOTES.md              DOS 原版完整逆向技术手册
├── web/                         前端应用（游戏主体）
│   ├── index.html               页面入口
│   ├── bgm/                     背景音乐 MP3（已纳入版本管理）
│   │   ├── ps1_01..27.mp3       PS1 原声 27 首音轨
│   │   └── cd30/cd30_01..12.mp3 30 周年 CD 版 12 首重编曲
│   ├── assets/                  解包转换后的静态游戏资源
│   │   ├── art/                 高清化索引图集、头像、建筑、船只、事件与立绘（含 manifest.json）
│   │   ├── data/                世界、港口、航道节点、风向海流、BGM 映射、图块、教程等 JSON
│   │   ├── font/                原版字体点阵 PNG 与字码映射表（charmap.json）
│   │   ├── save/                示例原版存档 KOUKAI2.DAT
│   │   ├── scenario/            底层指令剧本（snr0..6.json）与高阶结构化剧本（story0..6.json）
│   │   └── text/                全部对话、道具与国情文本 JSON
│   └── src/
│       ├── main.js              引擎初始化、音频、存档桥、主循环调度
│       ├── core/                底层服务：Screen/Palette/Sys/Input/Audio/BGM/OPL2/SFX/Prefs/ScenarioHost
│       ├── model/               强类型状态视图（schema_views.ts）、枚举（flags.ts）、世界读写助手
│       ├── domain/              纯领域计算（经济物价、舰队载重与航速公式）
│       ├── decoders/            二进制 JSON 编解码与世界地图/头像拼合解码器
│       ├── renderer/            16:9 宽屏视口渲染器（港口/海面 world.ts、建筑 building.ts、标题 title.ts）
│       ├── save/                uw2-save-v2 读写、LocalStorage 持久化与 KOUKAI2.DAT 导入器
│       ├── game/                时间主循环、AI 舰队、月/年末结算、开场、标题、新建、剧本 VM、结局
│       ├── scenes/              港口、出海、建筑分发、海战、单挑、上陆、谈判、各建筑场景逻辑与指令集
│       └── ui/
│           ├── buildings/       12 类港内建筑现代工作台 DOM UI
│           ├── dos/             原版像素窗体/菜单/列表/海面选区协议适配器
│           ├── hud.ts           浮层 HUD（世界状态栏、指令栏、环境设置弹窗）
│           ├── info_*.ts        情报总览、交互海港/世界地图、队形与随身物弹窗
│           ├── fleet_panel.ts   舰队经营面板与人物/船只详情
│           ├── battle_hud.ts    海战侧栏与战利品/接舷操作面板
│           ├── duel_hud.ts      单挑出招与血条 HUD
│           ├── save_modal.ts    现代存取档与导入导出管理弹窗
│           ├── tutorial_modal.ts 航海教程阅读器
│           ├── modals.ts        通用羊皮纸弹窗、对白浮层与统一键鼠继续等待机制
│           └── theme.css        全套羊皮纸/深海蓝/古铜金设计系统样式
└── tools/                       离线资源提取、剧本提升与逆向工程工具链
    ├── extract*.py              原版 LZW / LS11 美术、地图、数据、音频提取脚本
    ├── uw2lib.py / gamedata.py  底层压缩解压、调色盘、字码与数据结构定义
    ├── build_charmap.py         原版双字节字码 ↔ Unicode 映射生成
    ├── snr2json.py / lift_stories.mjs  原版剧本反编译与高阶结构化转换器
    ├── dis86.py / re/           16 位 x86 反汇编器与各模块专项逆向脚本
    ├── emu/                     单测（domain/story/save/data）与早期 DOS 回归比对工具
    └── work/                    本地临时工作产物目录（已由 .gitignore 忽略）
```

---

## 资源重提取与剧本生成

仅当你修改了底层提取脚本或需要从原版文件重新生成 `web/assets` 时使用：

```bash
# 从原版目录一键提取美术、地图、数据、文本与底层剧本到 web/assets/
python tools/extract.py <sea2目录> web/assets

# 将底层 snr0..6.json 提升为结构化高阶剧本 story0..6.json
npm run lift:stories
```

---

## 提交规范

- 仓库使用 GPG 签名提交（已追踪全部 `web/bgm/` 音频资源，`.gitignore` 仅忽略 `node_modules/`、`dist/`、`tools/work/` 及本地临时文件）。
- 建议每次提交前至少运行：
  `npx tsc --noEmit --noUnusedLocals && npm run build && npm run test:domain && npm run test:story && npm run test:save`
