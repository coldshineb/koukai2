// main.js — 遊戲進入點 (對應原版 MAIN.EXE main, 0FEA:6304)
// 架構: 遊戲邏輯是一個 async 程式, 所有等待輸入/計時的迴圈都 await sys.poll();
//       畫面由 requestAnimationFrame 呈現 (原版直接寫 VRAM, 隨寫隨顯)。
// 與原版的差異: 依需求移除說明書密碼確認 (2e09:7cec)。
// 片頭: web/src/game/opening.js (OPEN.EXE)。
import { Screen, SCREEN_W, CANVAS_H } from "./core/screen.js";
import { Font } from "./core/font.js";
import { Sys } from "./core/sys.js";
import { bindInput } from "./core/input.js";
import { BGM } from "./core/audio.js";
import { loadJSON, loadBinary } from "./core/assets.js";
import { Palette, paletteTables } from "./core/palette.js";
import { createUI } from "./ui/index.js";
import { GameState } from "./game/state.js";
import { TextCodec, encodeState } from "./game/data.js";
import { Title } from "./game/title.js";
import { GameClock } from "./game/clock.js";
import { Opening, loadOpeningData } from "./game/opening.js";

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
  options: { get animate() { return !!(state.options & 1); } },   // 環境設定「動畫效果」 [0ca4] bit0
  portMove: new URLSearchParams(location.search).get("portmove") !== "0",   // 擴充功能 (非原版): 航海術「港內移動」, ?portmove=0 關閉
};
ctx.palettes = (await loadJSON(ASSETS + "/data/palettes.json")).palettes;
ctx.newgameData = await loadJSON(ASSETS + "/data/newgame.json");     // 開始新航海用常數表 (tools/extract_newgame.py)
ctx.mapNodes = await loadBinary(ASSETS + "/data/mapnodes.bin");      // DATA1.LZW #4 地點表
ctx.palette = new Palette(scr, sys, paletteTables({ palettes: ctx.palettes }));
ctx.palette.writeDAC();                // 開機時目前調色盤為全黑
Object.assign(ctx, await createUI(ctx));
addEventListener("pointerdown", () => ctx.bgm.resume());
addEventListener("keydown", () => ctx.bgm.resume());

function frame() {
  const m = sys.mouse;
  // [03d6] 位元組計數 (0→1 時畫出游標)
  scr.cursor = { visible: m.present && m.visible > 0 && m.visible < 0x80, x: m.x, y: m.y, gfx: ctx.gfx, shape: m.shape };
  scr.present();
  if (!ctx.halted) requestAnimationFrame(frame); else { scr.cursor = null; scr.dirty = true; scr.present(); }
}
requestAnimationFrame(frame);

(async () => {
  // KOUKAI2.COM: FMDRV.COM → OPEN.EXE (片頭) → MAIN.EXE; 片頭播完或被跳過 (OPEN.EXE 結束) 後進入標題
  await new Opening(ctx, await loadOpeningData(ASSETS, loadBinary, loadJSON)).run();
  if (ctx.halted) return;
  // OPEN.EXE 結束時以 AH=02 淡出音樂; MAIN.EXE 的 9670 (標題曲) 在前曲仍播放 (AH=03) 時等它停止才播放 → 等淡出完成
  await ctx.bgm.stopped();
  const r = await new Title(ctx).run();          // 17546 → 171a2 → 標題選單
  if (ctx.halted || r !== 1) return;
  await new GameClock(ctx).run();                // 17546 後半 (1721f 進港) + 1623a 主迴圈
})();
