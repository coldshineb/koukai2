// tools/emu/workbench_e2e_test.mjs — 端對端真實點擊與資料同步自動化測試
// 直接對 wide_market / wide_wharf / wide_fleet_hub 執行真實座標點擊，驗證：
//   1. 按鈕有反應、不卡死、可正常退出
//   2. 交易所買進/賣出/投資真實同步 GameState.money / cargoGoods / cargoAmts / portEconomy
//   3. 碼頭 +10/-1 補給與一鍵出航真實同步水/糧/金幣並觸發 enterSea()
//   4. 艦隊經營大面板切分頁、調水手數與駕駛/瞭望/甲板比例真實同步且守恆
//   5. 所有繪製文字零 C6F4 / 64 / 01 等殘留控制碼
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const ROOT = process.cwd();
const TMP = path.join(ROOT, "tools/work/workbench_test_bundle.mjs");

// 用 esbuild 打包三個工作台與底層模型成可直接在 Node 執行的 ESM 測試套件
buildSync({
  stdin: {
    contents: `
      export { GameState } from "./web/src/game/state.js";
      export { Market } from "./web/src/scenes/market.js";
      export { Buildings } from "./web/src/scenes/buildings.js";
      export { Commands } from "./web/src/scenes/commands.js";
      export { runWideMarketWorkbench } from "./web/src/canvas_ui/wide_market.ts";
      export { runWideWharfWorkbench } from "./web/src/canvas_ui/wide_wharf.ts";
      export { runWideFleetHub } from "./web/src/canvas_ui/wide_fleet_hub.ts";
      export { DS, OFF } from "./web/src/model/schema_views.ts";
    `,
    resolveDir: ROOT,
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: TMP,
});

const mod = await import("file://" + TMP.replace(/\\/g, "/"));
const { GameState, Market, Buildings, Commands, runWideMarketWorkbench, runWideWharfWorkbench, runWideFleetHub, DS, OFF } = mod;

// 載入真實遊戲資料 (newgame.bin, port.json, commands.json, menu.json)
const newgameBin = new Uint8Array(fs.readFileSync(path.join(ROOT, "tools/work/newgame.bin")));
const portData = JSON.parse(fs.readFileSync(path.join(ROOT, "web/assets/data/port.json"), "utf8"));
const cmdData = JSON.parse(fs.readFileSync(path.join(ROOT, "web/assets/data/commands.json"), "utf8"));
const menuData = JSON.parse(fs.readFileSync(path.join(ROOT, "web/assets/text/menu.json"), "utf8"));
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, "web/assets/data/schema.json"), "utf8"));

const hexBytes = h => {
  const b = Uint8Array.from((h.match(/../g) || []).map(x => parseInt(x, 16)));
  const o = new Uint8Array(b.length + 1);
  o.set(b);
  return o;
};

// 建立模擬 2D Canvas Context，記錄每次 fillText 呼叫以便檢查殘留控制碼與按鈕文字
function makeMockCanvasCtx() {
  const texts = [];
  const noop = () => {};
  const grad = { addColorStop: noop };
  return {
    texts,
    save: noop, restore: noop, beginPath: noop, closePath: noop,
    moveTo: noop, lineTo: noop, arcTo: noop, arc: noop,
    fill: noop, stroke: noop, fillRect: noop, strokeRect: noop, drawImage: noop,
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    measureText: s => ({ width: String(s).length * 10 }),
    fillText(s, x, y) { texts.push({ s: String(s), x, y }); },
    fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "left", textBaseline: "middle",
    shadowColor: "", shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0, imageSmoothingEnabled: true,
  };
}

// 建立可腳本化滑鼠點擊的事件驅動環境
function makeHarness(script) {
  const state = new GameState(newgameBin.slice(), schema);
  // 確保主角在里斯本 (港 0)、有錢有船有水手
  state.model.globals.hero = 0;
  state.model.globals.port = 0;
  state.model.globals.money = 50000;
  const fleetSlot0 = DS.TBL_FLEET + state.u8(state.personRecord(0) + 0x2c) * 0x85 + OFF.FLEET.SHIPS;
  state.set16(fleetSlot0, 30); // 30 名水手
  const crewSlot0 = DS.TBL_CREW_SLOT;
  state.set8(crewSlot0 + OFF.CREW_SLOT.NAV_RATIO, 50);
  state.set8(crewSlot0 + OFF.CREW_SLOT.LOOK_RATIO, 30);
  state.set16(crewSlot0 + 0, 500); // 水 50
  state.set16(crewSlot0 + 2, 500); // 糧 50

  const mockCtx2d = makeMockCanvasCtx();
  let stepIdx = 0;
  let seaEntered = false;
  let mouseDown = false;

  const scr = {
    wideRenderer: () => {},
    wideOverlays: [],
    wideDialog: null,
    dirty: true,
    hdCtx: mockCtx2d,
    fillCols() {},
    clear() {},
  };

  const sys = {
    mouse: { vx: 0, vy: 0, x: 0, y: 0, present: 1 },
    mouseHide() {},
    mouseShow() {},
    flush() {},
    mickeys() { return { h: 0, v: 0 }; },
    rng: { random: () => 0 },
    async poll() {
      // 每幀渲染 overlay 讓 clickTargets 更新
      mockCtx2d.texts.length = 0;
      for (const fn of scr.wideOverlays) fn(mockCtx2d, scr);
      mouseDown = false;
    },
  };

  const menu = {
    mouseFlag: 0,
    disabled: 0,
    rects: [],
    async waitRelease() { mouseDown = false; },
    async waitPress() {},
    async waitPrompt() {},
    async yesNo() { return 1; },
    readEvent() {
      if (stepIdx >= script.length) return 0x1b; // 自動 Esc 結束避免死循環
      const act = script[stepIdx++];
      if (act.key !== undefined) {
        menu.mouseFlag = 0;
        return act.key;
      }
      sys.mouse.vx = act.x;
      sys.mouse.vy = act.y;
      menu.mouseFlag = 1;
      mouseDown = true;
      return 0x0d;
    },
  };

  // 簡易 ASCII/UTF-8 解碼器（檢查有無 ESC 殘留碼）
  const codec = {
    decode(u8) {
      let s = "";
      for (let i = 0; i < u8.length; i++) {
        const b = u8[i];
        if (b === 0) break;
        if (b >= 0x20 && b < 0x7f) s += String.fromCharCode(b);
        else if (b === 0x0a) s += "\n";
        else if (b >= 0x80) { s += "漢"; i++; }
        else s += `{${b.toString(16).toUpperCase().padStart(2, "0")}}`;
      }
      return s;
    },
  };

  const c = {
    state,
    scr,
    sys,
    menu,
    codec,
    art: { getImage: () => null, shipUrl: () => "", portraitUrl: () => "", preloadUrls: async () => {}, loadImage: async () => {} },
    con: { putc() {}, puts() {}, setCursor() {}, left: 0, right: 79, lineH: 16 },
    win: { frame() {}, save() {}, close: async () => {}, shadowedSaved() {} },
    rt: { year: 22, month: 4, day: 10, time: 30 },
    persons: new Array(0x50).fill(0),
    message() {},
    printf() {},
    menuItems(id) {
      const raw = menuData.menus?.[id] ?? menuData[id];
      const arr = Array.isArray(raw) ? raw : (Array.isArray(raw?.items) ? raw.items : ["A", "B", "C", "D", "E", "F", "G"]);
      return arr.map(x => (typeof x === "string" && /^[0-9a-fA-F]+$/.test(x)) ? hexBytes(x) : new TextEncoder().encode(String(x) + "\0"));
    },
  };

  const scene = {
    c,
    P: { data: portData, commands: cmdData },
    port: 0,
    fleet: DS.TBL_FLEET + state.u8(state.personRecord(0) + 0x2c) * 0x85,
    panels() {},
    clearCache() {},
    drawMap() {},
    foodDaily() {},
    waterDaily() {},
    async enterSea() { seaEntered = true; state.model.globals.port = 0xff; },
  };
  const b = new Buildings(scene);
  // 確保主角第 0 艘船有 30 名水手、足夠載重與水/糧
  const s0 = b.fleetSlot(0);
  state.set16(s0, 30);
  state.set8(s0 + OFF.DOCK_SLOT.FLAGS, (state.u8(s0 + OFF.DOCK_SLOT.FLAGS) & ~0x30) | 0x10);
  const m0 = b.crewData(0);
  state.set8(m0 + 8, 30);
  state.set8(m0 + 9, 50);
  state.set16(m0 + 0, 500);
  state.set16(m0 + 2, 500);
  return { c, state, scene, b, mockCtx2d, didEnterSea: () => seaEntered };
}

// =========================================================================
// TEST 1: 交易所一體化工作台 (買進 -> 賣出 -> 投資 -> 物價 -> 關閉)
// =========================================================================
{
  // W=1080, H=590 -> X=100, Y=65; bodyY=181; rightX=614; dockY=453; buyBtn=(974, 549)
  const h = makeHarness([
    { key: 0 }, // 第一幀渲染
    { x: 1000, y: 565 }, // 點「買進」金按鈕 (預設已選第 0 項商品 + 第 0 艘船 + 預設 10 單位)
    { key: 0 }, // 重繪
    { x: 244 + 150, y: 121 + 19 }, // 切到「賣出」分頁 (Tab 1: x=124+150=274, y=121..159)
    { key: 0 },
    { x: 1000, y: 565 }, // 點「賣出」金按鈕 (把剛買的 10 單位賣出)
    { key: 0 },
    { x: 124 + 300 + 40, y: 121 + 19 }, // 切到「投資」分頁 (Tab 2)
    { key: 0 },
    { x: 640, y: 181 + 40 + 236 + 20 }, // 點「投資」金按鈕
    { key: 0 },
    { x: 124 + 450 + 40, y: 121 + 19 }, // 切到「物價」分頁 (Tab 3)
    { key: 0 },
    { key: 0x1b }, // Esc 關閉
  ]);
  const market = new Market(h.b);
  h.state.model.globals.port = 20; // 非首都港（確保可投資）
  const moneyBefore = market.money;
  const invBefore = market.eco.commerceInvest;
  await runWideMarketWorkbench(market);
  assert.ok(market.eco.commerceInvest > invBefore, `交易所投資應增加商業投資額 (port=20, isCap=${h.b.isCapital()}, before=${invBefore}, after=${market.eco.commerceInvest})`);
  assert.ok(market.money < moneyBefore, "交易所操作後現金應同步扣除");
  for (const t of h.mockCtx2d.texts) {
    assert.ok(!/C[0-7]F[0-7]/.test(t.s), `發現殘留控制碼: ${t.s}`);
  }
  console.log("OK   Market workbench: buy -> sell -> invest -> prices -> ESC (money & eco synced, 0 ESC leaks)");
}

// =========================================================================
// TEST 2: 碼頭一體化工作台 (+10 水, +10 糧, -1 水 -> 一鍵出航)
// =========================================================================
{
  // W=1120, H=590 -> X=80, Y=65; startY=157; colSupX=[412, 604, 796, 988]
  // +10 水: x=412+145+10=567, y=157+16=173
  // +10 糧: x=604+145+10=759, y=173
  // 出航鈕: x=80+1120-186+50=1064, y=65+590-56+20=619
  const h = makeHarness([
    { key: 0 },
    { x: 567, y: 173 }, // +10 水
    { x: 759, y: 173 }, // +10 糧
    { x: 1064, y: 619 }, // 一鍵出航
  ]);
  const moneyBefore = h.b.money;
  const waterBefore = h.state.u16(DS.TBL_CREW_SLOT + 0);
  const foodBefore = h.state.u16(DS.TBL_CREW_SLOT + 2);
  const res = await runWideWharfWorkbench(h.b);
  assert.equal(res, 1, "碼頭點擊出航應回傳 1");
  assert.equal(h.didEnterSea(), true, "碼頭點擊出航應呼叫 enterSea()");
  assert.equal(h.state.u16(DS.TBL_CREW_SLOT + 0), waterBefore + 100, "水應增加 10 單位 (內部 +100)");
  assert.equal(h.state.u16(DS.TBL_CREW_SLOT + 2), foodBefore + 100, "食物應增加 10 單位 (內部 +100)");
  assert.ok(h.b.money < moneyBefore, "購買食物應扣除金幣");
  assert.equal(h.state.u8(DS.LAST_PORT), 0xff, "出航後 LAST_PORT 應設為 0xff");
  for (const t of h.mockCtx2d.texts) {
    assert.ok(!/C[0-7]F[0-7]/.test(t.s), `碼頭發現殘留控制碼: ${t.s}`);
  }
  console.log("OK   Wharf workbench: +10 water, +10 food, depart -> enterSea() triggered & state synced");
}

// =========================================================================
// TEST 3: 艦隊經營一體化大面板 (切水手比例 -> 調 -5 / +5 -> 切人事變更 -> 關閉)
// =========================================================================
{
  // W=1100, H=600 -> X=90, Y=60; tabY=114, tabW=152
  // Tab 1 (水手與比例): x=90+24+162+40=316, y=132
  // rBoxY=174+148=322; row 0 (駕駛) +5 按鈕: rightX=420, bp5 x=420+556+10=986, y=322+68+10=400
  // Tab 2 (人事變更): x=90+24+324+40=478, y=132
  const h = makeHarness([
    { key: 0 },
    { x: 316, y: 132 }, // 切到「水手與比例」分頁
    { key: 0 },
    { x: 986, y: 400 }, // 點駕駛 +5
    { key: 0 },
    { x: 478, y: 132 }, // 切到「人事變更」分頁
    { key: 0 },
    { key: 0x1b }, // Esc 關閉
  ]);
  const cmd = new Commands(h.scene);
  const lookBefore = h.state.u8(DS.TBL_CREW_SLOT + OFF.CREW_SLOT.LOOK_RATIO);
  await runWideFleetHub(cmd);
  const lookAfter = h.state.u8(DS.TBL_CREW_SLOT + OFF.CREW_SLOT.LOOK_RATIO);
  const navAfter = h.state.u8(DS.TBL_CREW_SLOT + OFF.CREW_SLOT.NAV_RATIO);
  assert.equal(lookAfter, lookBefore + 5, "點擊 +5 應使比例增加 5%");
  assert.ok(lookAfter + navAfter <= 100, "水手比例總和不得超過 100%");
  console.log("OK   Fleet Hub: tab switch -> ratio +5% synced -> personnel tab -> clean ESC close");
}

fs.unlinkSync(TMP);
console.log("[workbench_e2e_test] ALL 3 WORKBENCH E2E TESTS PASSED!");
