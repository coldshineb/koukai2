// main.js — 游戏进入点 (对应原版 MAIN.EXE main, 0FEA:6304)
// 架构: 游戏逻辑是一个 async 程序, 所有等待输入/计时的循环都 await sys.poll();
//       画面由 requestAnimationFrame 呈现 (原版直接写 VRAM, 随写随显)。
// 与原版的差异: 依需求移除说明书密码确认 (2e09:7cec)。
// 片头: web/src/game/opening.js (OPEN.EXE)。
import { Screen, SCREEN_W, CANVAS_H } from "./core/screen.js";
import { Font } from "./core/font.js";
import { Sys, Rng, Timer } from "./core/sys.js";
import { bindInput } from "./core/input.js";
import { BGM } from "./core/audio.js";
import { SfxPort } from "./core/sfx.js";
import { loadJSON, loadBinary } from "./core/assets.js";
import { Palette, paletteTables } from "./core/palette.js";
import { createUI } from "./ui/index.js";
import { GameState } from "./game/state.js";
import { TextCodec, encodeState } from "./game/data.js";
import { SaveFile } from "./game/savefile.js";
import { Title } from "./game/title.js";
import { GameClock } from "./game/clock.js";
import { Opening, loadOpeningData } from "./game/opening.js";
// 运行速度 (RE_NOTES 第 32 节): 原版在 DOSBox cycles=10500 下的耗时记帐 (?cycles=N 换基准, ?cycles=0 关闭)
import { CPU, installCostModel } from "./core/cpucost.js";
import { TextConsole } from "./ui/console.js";
import { WindowSystem } from "./ui/window.js";
import { MenuSystem } from "./ui/menu.js";
import { Graph } from "./ui/graph.js";
import { GraphDat } from "./gfx/graphdec.js";
import { Kao } from "./gfx/kao.js";
import { WorldMap } from "./gfx/worldmap.js";
import { PlanarBuf } from "./gfx/duelanim.js";
import { ListSelect } from "./ui/listsel.js";
import { CellSelect } from "./ui/cellsel.js";
import { NameInput } from "./ui/nameinput.js";
import { NumPad } from "./ui/numpad.js";
import { NewGame } from "./game/newgame.js";
import { Scenario } from "./game/scenario.js";
import { FleetAI } from "./game/fleetai.js";
import { Monthly } from "./game/monthly.js";
import { PortScene } from "./scenes/port.js";
import { Buildings } from "./scenes/buildings.js";
import { Commands } from "./scenes/commands.js";
import { PortMove } from "./scenes/portmove.js";
import { Market } from "./scenes/market.js";
import { Gamble } from "./scenes/gamble.js";
import { Palace } from "./scenes/palace.js";
import { Office } from "./scenes/office.js";
import { House } from "./scenes/house.js";
import { Bank } from "./scenes/bank.js";
import { ItemShop } from "./scenes/itemshop.js";
import { SeaScene } from "./scenes/sea.js";
import { NavalBattle } from "./scenes/battle.js";
import { Duel } from "./scenes/duel.js";
import { Ending, loadEndingData } from "./game/ending.js";      // END.EXE (结局)
import { MainExit } from "./game/endgame.js";
const COST_CLASSES = { Screen, Font, Sys, Rng, Timer, TextConsole, WindowSystem, MenuSystem, Graph, GraphDat, Kao, WorldMap, PlanarBuf, Palette,
  ListSelect, CellSelect, NameInput, NumPad, GameState, Title, NewGame, Scenario, GameClock, FleetAI, Monthly,
  PortScene, Buildings, Commands, PortMove, Market, Gamble, Palace, Office, House, Bank, ItemShop, SeaScene, NavalBattle, Duel };
CPU.configure(location.search);

const ASSETS = "./assets";
const canvas = document.getElementById("screen");
// 画面大小: index.html 的 CSS 依窗口等比缩放 (4:3, 不限整数倍); 鼠标座标由 input.js 依实际显示大小换算

const scr = new Screen(canvas);
const sys = new Sys();
bindInput(canvas, sys);
// 新游戏初值: assets/data/world.json (结构化 JSON) → 原版 0x8074 bytes 状态 (DATA1.LZW #15 的内容)
const [schema, charmap, world] = await Promise.all(["schema", "../font/charmap", "world"].map(n => loadJSON(`${ASSETS}/data/${n}.json`)));
const codec = new TextCodec(charmap);
const initState = encodeState(world, schema, codec);
const state = new GameState(initState, schema);
const ctx = {
  scr, sys, ASSETS, state, initState, schema, codec,
  names: await loadJSON(ASSETS + "/data/names.json"),
  font: await new Font().load(ASSETS),
  bgm: await new BGM(ASSETS).init(),
  // FM 效果音 (RE_NOTES 第 35 节): FMDRV 效果音声部 + OPL2 合成 (AudioWorklet); ?sfxvol=N 调整音量 (默认 2 = OPL 单声道峰值约 −12 dBFS)
  sfx: new SfxPort("./src/core/sfx_worklet.js", { gain: +(new URLSearchParams(location.search).get("sfxvol") ?? 2) }),
  options: { get animate() { return !!(state.options & 1); } },   // 环境设置「动画效果」 [0ca4] bit0
  portMove: new URLSearchParams(location.search).get("portmove") !== "0",   // 扩充功能 (非原版): 航海术「港内移动」, ?portmove=0 关闭
};
ctx.palettes = (await loadJSON(ASSETS + "/data/palettes.json")).palettes;
ctx.newgameData = await loadJSON(ASSETS + "/data/newgame.json");     // 开始新航海用常数表 (tools/extract_newgame.py)
ctx.mapNodes = await loadBinary(ASSETS + "/data/mapnodes.bin");      // DATA1.LZW #4 地点表
ctx.palette = new Palette(scr, sys, paletteTables({ palettes: ctx.palettes }));
ctx.palette.writeDAC();                // 开机时目前调色盘为全黑
Object.assign(ctx, await createUI(ctx));
ctx.sfx.state = state;                 // 9804 依 [0ca4] bit3 (效果音开关)
addEventListener("pointerdown", () => { ctx.bgm.resume(); ctx.sfx.resume(); });
addEventListener("keydown", () => { ctx.bgm.resume(); ctx.sfx.resume(); });

// 阶段 3 现代 JSON 存盘导入/导出浏览器桥接 (供开发者与阶段 5 现代存盘管理界面调用)
async function ensureSaveFile() {
  return (ctx.saveFile ??= await SaveFile.open(ASSETS, initState, schema, codec));
}
globalThis.UW2Save = {
  async list() { const f = await ensureSaveFile(); return f.store?.bundle.slots.map(s => s?.summary ?? null) ?? []; },
  async exportJson(slotIndex, stripCompat = false) {
    const f = await ensureSaveFile();
    return f.exportJson({ pretty: true, stripCompat, ...(typeof slotIndex === "number" ? { slotIndex } : {}) });
  },
  async downloadJson(slotIndex, stripCompat = false) {
    const text = await this.exportJson(slotIndex, stripCompat);
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = typeof slotIndex === "number" ? `uw2-slot-${slotIndex + 1}.json` : "uw2-saves-v2.json";
    a.click();
    URL.revokeObjectURL(a.href);
  },
  async importFile(targetSlot) {
    const f = await ensureSaveFile();
    return new Promise((resolve, reject) => {
      const inp = document.createElement("input");
      inp.type = "file"; inp.accept = ".json,.dat,.DAT";
      inp.onchange = async () => {
        try {
          const file = inp.files?.[0];
          if (!file) { resolve(null); return; }
          const buf = await file.arrayBuffer();
          resolve(f.importBuffer(buf, targetSlot));
        } catch (e) { reject(e); }
      };
      inp.click();
    });
  },
};
CPU.musicProbe = () => !!(ctx.bgm.el && ctx.bgm.cur && !ctx.bgm.el.paused);   // FMDRV 播放中的 IRQ0 占用 (32.3)

// 运行速度 (RE_NOTES 32.9 A): 程序超前虚拟时钟而睡的期间, 刚画好的画面要等到虚拟时间到了才显示 (快照), 之前维持旧画面
CPU.capture = () => ({ fb: scr.fb.slice(), lut: scr.lut.slice(), full: scr.full ? scr.full.slice() : null });
function presentSnap(s) {
  const fb = scr.fb, lut = scr.lut, full = scr.full;
  scr.fb = s.fb; scr.lut = s.lut; scr.full = s.full; scr.dirty = true; scr.present();
  scr.fb = fb; scr.lut = lut; scr.full = full; scr.dirty = true;
}
function frame() {
  const m = sys.mouse;
  // [03d6] 字节计数 (0→1 时画出光标)
  scr.cursor = { visible: m.present && m.visible > 0 && m.visible < 0x80, x: m.x, y: m.y, gfx: ctx.gfx, shape: m.shape };
  const g = CPU.frameGate();
  if (g === "live") scr.present(); else if (g) presentSnap(g.snap);
  if (!ctx.halted) requestAnimationFrame(frame); else { scr.cursor = null; scr.dirty = true; scr.present(); }
}
requestAnimationFrame(frame);

(async () => {
  // KOUKAI2.COM: FMDRV.COM → OPEN.EXE (片头) → MAIN.EXE; 片头播完或被跳过 (OPEN.EXE 结束) 后进入标题
  await new Opening(ctx, await loadOpeningData(ASSETS, loadBinary, loadJSON)).run();
  if (ctx.halted) return;
  // MAIN.EXE 起: 依记帐表记帐, 虚拟时钟从现在开始 (片头是另一个程序 OPEN.EXE, 没有量测, 不记帐)
  if (CPU.khz) installCostModel(COST_CLASSES);
  CPU.start();
  // OPEN.EXE 结束时以 AH=02 淡出音乐; MAIN.EXE 的 9670 (标题曲) 在前曲仍播放 (AH=03) 时等它停止才播放 → 等淡出完成
  await ctx.bgm.stopped();
  const r = await new Title(ctx).run();          // 17546 → 171a2 → 标题菜单
  if (ctx.halted || r !== 1) return;
  try {
    await new GameClock(ctx).run();              // 17546 后半 (1721f 进港) + 1623a 主循环
  } catch (e) {
    if (!(e instanceof MainExit)) throw e;
    // MAIN.EXE 以结束码 1 结束 → KOUKAI2.COM 运行 END.EXE (INT 65h 的值 = e.params); 结局播完回到 DOS
    ctx.bgm.optionOff = null;                    // END.EXE 是另一个程序, 不看 MAIN.EXE 的 [0ca4] BGM 开关 (core/audio.js 9670)
    const end = await loadEndingData(ASSETS, loadBinary, loadJSON);
    await new Ending({ scr, sys, bgm: ctx.bgm, font: ctx.font }, end).run(e.params);
    ctx.halted = true;
  }
})();
