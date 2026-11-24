// main.js — 遊戲進入點 (對應原版 MAIN.EXE main, 0FEA:6304)
// 架構: 遊戲邏輯是一個 async 程式, 所有等待輸入/計時的迴圈都 await sys.poll();
//       畫面由 requestAnimationFrame 呈現 (原版直接寫 VRAM, 隨寫隨顯)。
// 與原版的差異: 依需求移除說明書密碼確認 (2e09:7cec)。
// 片頭: web/src/game/opening.js (OPEN.EXE)。
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
// 執行速度 (RE_NOTES 第 32 節): 原版在 DOSBox cycles=10500 下的耗時記帳 (?cycles=N 換基準, ?cycles=0 關閉)
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
import { Ending, loadEndingData } from "./game/ending.js";      // END.EXE (結局)
import { MainExit } from "./game/endgame.js";
const COST_CLASSES = { Screen, Font, Sys, Rng, Timer, TextConsole, WindowSystem, MenuSystem, Graph, GraphDat, Kao, WorldMap, PlanarBuf, Palette,
  ListSelect, CellSelect, NameInput, NumPad, GameState, Title, NewGame, Scenario, GameClock, FleetAI, Monthly,
  PortScene, Buildings, Commands, PortMove, Market, Gamble, Palace, Office, House, Bank, ItemShop, SeaScene, NavalBattle, Duel };
CPU.configure(location.search);

const ASSETS = "./assets";
const canvas = document.getElementById("screen");
// 畫面大小: index.html 的 CSS 依視窗等比縮放 (4:3, 不限整數倍); 滑鼠座標由 input.js 依實際顯示大小換算

const scr = new Screen(canvas);
const sys = new Sys();
bindInput(canvas, sys);
// 新遊戲初值: assets/data/world.json (結構化 JSON) → 原版 0x8074 bytes 狀態 (DATA1.LZW #15 的內容)
const [schema, charmap, world] = await Promise.all(["schema", "../font/charmap", "world"].map(n => loadJSON(`${ASSETS}/data/${n}.json`)));
const codec = new TextCodec(charmap);
const initState = encodeState(world, schema, codec);
const state = new GameState(initState, schema);
const ctx = {
  scr, sys, ASSETS, state, initState, schema, codec,
  names: await loadJSON(ASSETS + "/data/names.json"),
  font: await new Font().load(ASSETS),
  bgm: await new BGM(ASSETS).init(),
  // FM 效果音 (RE_NOTES 第 35 節): FMDRV 效果音聲部 + OPL2 合成 (AudioWorklet); ?sfxvol=N 調整音量 (預設 2 = OPL 單聲道峰值約 −12 dBFS)
  sfx: new SfxPort("./src/core/sfx_worklet.js", { gain: +(new URLSearchParams(location.search).get("sfxvol") ?? 2) }),
  options: { get animate() { return !!(state.options & 1); } },   // 環境設定「動畫效果」 [0ca4] bit0
  portMove: new URLSearchParams(location.search).get("portmove") !== "0",   // 擴充功能 (非原版): 航海術「港內移動」, ?portmove=0 關閉
};
ctx.palettes = (await loadJSON(ASSETS + "/data/palettes.json")).palettes;
ctx.newgameData = await loadJSON(ASSETS + "/data/newgame.json");     // 開始新航海用常數表 (tools/extract_newgame.py)
ctx.mapNodes = await loadBinary(ASSETS + "/data/mapnodes.bin");      // DATA1.LZW #4 地點表
ctx.palette = new Palette(scr, sys, paletteTables({ palettes: ctx.palettes }));
ctx.palette.writeDAC();                // 開機時目前調色盤為全黑
Object.assign(ctx, await createUI(ctx));
ctx.sfx.state = state;                 // 9804 依 [0ca4] bit3 (效果音開關)
addEventListener("pointerdown", () => { ctx.bgm.resume(); ctx.sfx.resume(); });
addEventListener("keydown", () => { ctx.bgm.resume(); ctx.sfx.resume(); });

// 階段 3 現代 JSON 存檔匯入/匯出瀏覽器橋接 (供開發者與階段 5 現代存檔管理介面呼叫)
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
CPU.musicProbe = () => !!(ctx.bgm.el && ctx.bgm.cur && !ctx.bgm.el.paused);   // FMDRV 播放中的 IRQ0 佔用 (32.3)

// 執行速度 (RE_NOTES 32.9 A): 程式超前虛擬時鐘而睡的期間, 剛畫好的畫面要等到虛擬時間到了才顯示 (快照), 之前維持舊畫面
CPU.capture = () => ({ fb: scr.fb.slice(), lut: scr.lut.slice(), full: scr.full ? scr.full.slice() : null });
function presentSnap(s) {
  const fb = scr.fb, lut = scr.lut, full = scr.full;
  scr.fb = s.fb; scr.lut = s.lut; scr.full = s.full; scr.dirty = true; scr.present();
  scr.fb = fb; scr.lut = lut; scr.full = full; scr.dirty = true;
}
function frame() {
  const m = sys.mouse;
  // [03d6] 位元組計數 (0→1 時畫出游標)
  scr.cursor = { visible: m.present && m.visible > 0 && m.visible < 0x80, x: m.x, y: m.y, gfx: ctx.gfx, shape: m.shape };
  const g = CPU.frameGate();
  if (g === "live") scr.present(); else if (g) presentSnap(g.snap);
  if (!ctx.halted) requestAnimationFrame(frame); else { scr.cursor = null; scr.dirty = true; scr.present(); }
}
requestAnimationFrame(frame);

(async () => {
  // KOUKAI2.COM: FMDRV.COM → OPEN.EXE (片頭) → MAIN.EXE; 片頭播完或被跳過 (OPEN.EXE 結束) 後進入標題
  await new Opening(ctx, await loadOpeningData(ASSETS, loadBinary, loadJSON)).run();
  if (ctx.halted) return;
  // MAIN.EXE 起: 依記帳表記帳, 虛擬時鐘從現在開始 (片頭是另一個程式 OPEN.EXE, 沒有量測, 不記帳)
  if (CPU.khz) installCostModel(COST_CLASSES);
  CPU.start();
  // OPEN.EXE 結束時以 AH=02 淡出音樂; MAIN.EXE 的 9670 (標題曲) 在前曲仍播放 (AH=03) 時等它停止才播放 → 等淡出完成
  await ctx.bgm.stopped();
  const r = await new Title(ctx).run();          // 17546 → 171a2 → 標題選單
  if (ctx.halted || r !== 1) return;
  try {
    await new GameClock(ctx).run();              // 17546 後半 (1721f 進港) + 1623a 主迴圈
  } catch (e) {
    if (!(e instanceof MainExit)) throw e;
    // MAIN.EXE 以結束碼 1 結束 → KOUKAI2.COM 執行 END.EXE (INT 65h 的值 = e.params); 結局播完回到 DOS
    ctx.bgm.optionOff = null;                    // END.EXE 是另一個程式, 不看 MAIN.EXE 的 [0ca4] BGM 開關 (core/audio.js 9670)
    const end = await loadEndingData(ASSETS, loadBinary, loadJSON);
    await new Ending({ scr, sys, bgm: ctx.bgm, font: ctx.font }, end).run(e.params);
    ctx.halted = true;
  }
})();
