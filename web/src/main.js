// main.js — 現代混合引擎入口 (階段 4: 移除 DOS cpucost / 軟體游標，接入現代倍速、獨立音量與高清 DOM/CSS 殼層)
import { Screen } from "./core/screen.js";
import { Font } from "./core/font.js";
import { Sys } from "./core/sys.js";
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
import { Ending, loadEndingData } from "./game/ending.js";
import { MainExit, mainEnding } from "./game/endgame.js";
import { duelFromScenario } from "./scenes/duel.js";
import { GameRuntime } from "./modern/runtime.ts";
import { ModernShell } from "./modern/shell.ts";
import { ModernGameUI } from "./modern/presenter.ts";
import { ModernHud } from "./modern/hud.ts";
import { ModernScenarioHost } from "./modern/scenario_host.ts";
import { ArtRegistry } from "./modern/assets_art.ts";

const ASSETS = "./assets";
const canvas = document.getElementById("screen");

const scr = new Screen(canvas);
const sys = new Sys();
bindInput(canvas, sys);

// 載入結構化遊戲資料 (world.json -> GameState)
const [schema, charmap, world] = await Promise.all(["schema", "../font/charmap", "world"].map(n => loadJSON(`${ASSETS}/data/${n}.json`)));
const codec = new TextCodec(charmap);
const initState = encodeState(world, schema, codec);
const state = new GameState(initState, schema);

const ctx = {
  scr, sys, ASSETS, state, initState, schema, codec,
  art: await new ArtRegistry(ASSETS).load(),
  names: await loadJSON(ASSETS + "/data/names.json"),
  font: await new Font().load(ASSETS),
  bgm: await new BGM(ASSETS).init(),
  sfx: new SfxPort("./src/core/sfx_worklet.js", { gain: +(new URLSearchParams(location.search).get("sfxvol") ?? 2) }),
  options: { get animate() { return !!(state.options & 1); } },
  portMove: new URLSearchParams(location.search).get("portmove") !== "0",
};
ctx.palettes = (await loadJSON(ASSETS + "/data/palettes.json")).palettes;
ctx.newgameData = await loadJSON(ASSETS + "/data/newgame.json");
ctx.mapNodes = await loadBinary(ASSETS + "/data/mapnodes.bin");
ctx.palette = new Palette(scr, sys, paletteTables({ palettes: ctx.palettes }));
ctx.palette.writeDAC();
Object.assign(ctx, await createUI(ctx));
ctx.sfx.state = state;

addEventListener("pointerdown", () => { ctx.bgm.resume(); ctx.sfx.resume(); });
addEventListener("keydown", () => { ctx.bgm.resume(); ctx.sfx.resume(); });

// 現代存檔存取橋接 (uw2-save-v2 JSON + 只讀匯入原版 KOUKAI2.DAT)
async function ensureSaveFile() {
  return (ctx.saveFile ??= await SaveFile.open(ASSETS, initState, schema, codec));
}

const runtime = new GameRuntime({ sys, bgm: ctx.bgm, sfx: ctx.sfx });
const shell = new ModernShell({
  runtime,
  saveBridge: {
    getSlots: async () => (await ensureSaveFile()).store?.bundle.slots ?? [],
    getAutoSave: async () => (await ensureSaveFile()).store?.bundle.autoSave ?? null,
    exportJson: async (slotIndex, stripCompat = false) => {
      const f = await ensureSaveFile();
      return f.exportJson({ pretty: true, stripCompat, ...(typeof slotIndex === "number" ? { slotIndex } : {}) });
    },
    importBuffer: async (buf, targetSlot) => (await ensureSaveFile()).importBuffer(buf, targetSlot),
  },
});
ctx.runtime = runtime;
ctx.shell = shell;
ctx.modernUI = new ModernGameUI(shell.overlay, ctx);
ctx.hud = new ModernHud(ctx);
ctx.scenarioHost = new ModernScenarioHost(ctx, shell.overlay, () => ctx.events?.scene, {
  runDuel: (sc, person) => duelFromScenario(sc, person),
  triggerEnding: (scene, code) => mainEnding(scene, code),
});

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

// 原生 60fps 呈現迴圈 (無 DOS 虛擬時鐘節流與軟體游標)
scr.cursor = null;
function frame() {
  scr.present();
  if (!ctx.halted) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

(async () => {
  await new Opening(ctx, await loadOpeningData(ASSETS, loadBinary, loadJSON)).run();
  if (ctx.halted) return;
  await ctx.bgm.stopped();
  const r = await new Title(ctx).run();
  if (ctx.halted || r !== 1) return;
  try {
    await new GameClock(ctx).run();
  } catch (e) {
    if (!(e instanceof MainExit)) throw e;
    ctx.bgm.optionOff = null;
    const end = await loadEndingData(ASSETS, loadBinary, loadJSON);
    await new Ending({ scr, sys, bgm: ctx.bgm, font: ctx.font }, end).run(e.params);
    ctx.halted = true;
  }
})();
