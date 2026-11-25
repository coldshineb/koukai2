// main.js — 现代混合引擎入口 (阶段 4: 移除 DOS cpucost / 软件光标，接入现代倍速、独立音量与高清 DOM/CSS 壳层)
import { Screen } from "./core/screen.js";
import { Font } from "./core/font.js";
import { Sys } from "./core/sys.js";
import { bindInput } from "./core/input.js";
import { BGM } from "./core/audio.js";
import { SfxPort } from "./core/sfx.js";
import { loadJSON, loadBinary } from "./core/assets.js";
import { Palette, paletteTables } from "./core/palette.js";
import { decodeMapNodesJson } from "./decoders/bin_json.ts";
import { createUI } from "./ui/dos/index.js";
import { GameState } from "./game/state.js";
import { TextCodec, encodeState } from "./game/data.js";
import { SaveFile } from "./save/savefile.js";
import { Title } from "./game/title.js";
import { hasDom } from "./ui/modals.ts";
import { GameClock } from "./game/clock.js";
import { Opening, loadOpeningData } from "./game/opening.js";
import { Ending, loadEndingData } from "./game/ending.js";
import { MainExit, mainEnding } from "./game/endgame.js";
import { duelFromScenario } from "./scenes/duel.js";
import { GameRuntime } from "./core/runtime.ts";
import { ModernShell } from "./ui/shell.ts";
import { ModernGameUI } from "./core/presenter.ts";
import { ModernScenarioHost } from "./core/scenario_host.ts";
import { ArtRegistry } from "./core/art_registry.ts";

const ASSETS = "./assets";
const canvas = document.getElementById("screen");

const scr = new Screen(canvas);
const sys = new Sys();
bindInput(canvas, sys);

// 加载结构化游戏数据 (world.json -> GameState)
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
  options: { get animate() { return !!(state.model.globals.options & 1); } },
  portMove: new URLSearchParams(location.search).get("portmove") !== "0",
};
ctx.palettes = (await loadJSON(ASSETS + "/data/palettes.json")).palettes;
ctx.newgameData = await loadJSON(ASSETS + "/data/newgame.json");
ctx.mapNodes = decodeMapNodesJson(await loadJSON(ASSETS + "/data/mapnodes.json"));
ctx.palette = new Palette(scr, sys, paletteTables({ palettes: ctx.palettes }));
ctx.palette.writeDAC();
Object.assign(ctx, await createUI(ctx));
ctx.sfx.state = state;

addEventListener("pointerdown", () => { ctx.bgm.resume(); ctx.sfx.resume(); });
addEventListener("keydown", () => { ctx.bgm.resume(); ctx.sfx.resume(); });

// 现代存盘访问桥接 (uw2-save-v2 JSON + 只读导入原版 KOUKAI2.DAT)
async function ensureSaveFile() {
  return (ctx.saveFile ??= await SaveFile.open(ASSETS, initState, schema, codec));
}

const runtime = new GameRuntime({ sys, bgm: ctx.bgm, sfx: ctx.sfx });
const shell = new ModernShell({
  runtime,
  saveBridge: {
    getSlots: async () => (await ensureSaveFile()).store?.bundle.slots ?? [],
    getAutoSave: async () => (await ensureSaveFile()).store?.bundle.autoSave ?? null,
    deleteSlot: async (slotIndex) => (await ensureSaveFile()).deleteSlot(slotIndex),
    exportJson: async (slotIndex, stripCompat = false) => {
      const f = await ensureSaveFile();
      return f.exportJson({ pretty: true, stripCompat, ...(typeof slotIndex === "number" ? { slotIndex } : {}) });
    },
    inspectImportBuffer: async (buf) => (await ensureSaveFile()).inspectImportBuffer(buf),
    importSlots: async (items, heroId) => (await ensureSaveFile()).importSlots(items, heroId),
    importBuffer: async (buf, targetSlot) => (await ensureSaveFile()).importBuffer(buf, targetSlot),
  },
});
ctx.runtime = runtime;
ctx.shell = shell;
ctx.modernUI = new ModernGameUI(shell.overlay, ctx);
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

// 原生 60fps 呈现循环 (无 DOS 虚拟时钟节流与软件光标)
scr.cursor = null;
function frame() {
  scr.present();
  if (!ctx.halted) requestAnimationFrame(frame);
}

(async () => {
  const opening = new Opening(ctx, await loadOpeningData(ASSETS, loadBinary, loadJSON, ctx.art));
  ctx.scr.full = opening.full;
  ctx.scr.setPaletteRaw(new Uint8Array(48));
  requestAnimationFrame(frame);
  await opening.run();
  if (ctx.halted) return;
  if (!(hasDom() && ctx.codec)) await ctx.bgm.stopped();
  const r = await new Title(ctx).run();
  if (ctx.halted || r !== 1) return;
  try {
    await new GameClock(ctx).run();
  } catch (e) {
    if (!(e instanceof MainExit)) throw e;
    ctx.bgm.optionOff = null;
    const end = await loadEndingData(ASSETS, loadBinary, loadJSON, ctx.art);
    await new Ending({ scr, sys, bgm: ctx.bgm, font: ctx.font }, end).run(e.params);
    ctx.halted = true;
  }
})();
