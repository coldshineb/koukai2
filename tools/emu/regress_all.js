// regress_all.js — 全部差分測試的回歸 (RE_NOTES 32.8): 依序執行各路線 (設定檔 → … → port_tests.js) 與單元差分測試, 收集每項的結果行
// 前提: 已載入 emu_boot.js、ui_bundle.js, 且 tools/work/runf.js 已把 tools/emu/*.js 登記成 session.RUNF[檔名]() (tools/emu/make_runf.py)
// 用法: await session.RUNF["regress_all.js"]();  之後 await session.regress({ from: 0, to: 20, model: true })  → session.regResults
//   model: 先以 installCostModel 包裝移植版的類別方法 (記帳只累計 CPU.cyc), 確認測試模式不受耗時模型影響
"use strict";
(function () {
const S = session;
// extra: 每項另加的 session 設定 (函式 m => {...} 或物件); 海上 / 海戰的長路線一律 FB_HASH = 10 (只存雜湊, 比對一樣嚴格, 省記憶體)
const M = (route, varName, modes, chain = [], extra = {}) => modes.map(m => ({ name: `${route}${m ? ":" + m : ""}`,
  set: { ...(varName && m ? { [varName]: m } : {}), ...(typeof extra === "function" ? extra(m) : extra) }, files: [route + ".js", ...chain, "port_tests.js"] }));
const LONG = { FB_HASH: 10 };
const SEA = ["sea_depart_route.js"];
const LIST = [
  { name: "data_tests", files: ["data_tests.js"], plain: true },
  { name: "data_tests_event", files: ["data_tests_event.js"], plain: true },
  { name: "menu_tests", files: ["menu_tests.js"], plain: true },
  { name: "printf_tests", files: ["printf_tests.js"], plain: true },
  { name: "graph_tests", files: ["graph_tests.js"], plain: true },
  { name: "palette_tests", files: ["palette_tests.js"], plain: true },
  { name: "kao_tests", files: ["kao_tests.js"], plain: true },
  { name: "title_tests", files: ["title_tests.js"], plain: true },
  { name: "newgame_tests", files: ["newgame_tests.js"], plain: true },
  { name: "port (港口走路)", files: ["port_tests.js"] },
  ...M("tavern_route", null, [""]), ...M("tavern_route2", null, [""]), ...M("wharf_route", null, [""]), ...M("enter_route", null, [""]), ...M("event_route", null, [""]),
  ...M("cmd_info_route", "CMD_MODE", ["", "log", "map", "chart", "mapitem"]), ...M("cmd_manage_route", null, [""]),
  ...M("cmd_nav_route", "CMD_MODE", ["", "func", "mouse"]), ...M("cmd_order_route", null, [""]),
  ...M("bank_route", "BANK_MODE", ["main", "poor", "venice"]), ...M("bargirl_route", "GIRL_MODE", ["all", "poor", "report"]),
  ...M("gamble_route", "GAMBLE_MODE", ["bj", "dice", "poor"]),
  ...M("house_route", "HOUSE_MODE", ["collector", "collector0", "geo", "mapper", "school2", "school3"]),
  ...M("inn_route", "INN_MODE", ["chat", "friend", "none"]), ...M("itemshop_route", "SHOP_MODE", ["buy", "full", "night", "sell"]),
  ...M("market_route", "MARKET_MODE", ["lis", "bar", "big", "full"]), ...M("office_route", "OFFICE_MODE", ["main", "event", "status"]),
  ...M("palace_route", "PALACE_MODE", ["main", "arrest", "escape", "naturalize", "rank9"]),
  ...M("shipyard_route", "SY_MODE", ["dock", "yard"]), ...M("shipyard_route2", "SY2_MODE", ["build", "trade"]), ...M("shipyard_route3", "SY3_MODE", ["used", "empty"]),
  ...M("supply_route", "SUP_MODE", ["ok", "cancel", "dup"]),
  ...M("portmove_route", "PM_MODE", ["market", "tavern", "menu", "closed", "event", "guard", "guard_door", "night_guard", "overlap", "overlap_closed"]),
  { name: "sea_depart_route", files: ["sea_depart_route.js", "port_tests.js"], set: LONG },
  ...M("storm_route", "STORM_MODE", ["run", "start"], SEA, LONG),                                   // 海上暴風雨 (效果音 0c5a, RE_NOTES 35.6)
  { name: "worldmap_tests (接在出海之後)", files: ["worldmap_tests.js"], plain: true },
  ...M("land_route", "LAND_MODE", ["cant", "no", "leave", "camp", "repair", "nomat", "water", "water0", "treasure", "disc_ok", "disc_fail", "disc_native", "nofood",
    "ev0", "ev1", "ev2", "ev2b", "ev3", "ev4", "ev5", "ev5b", "ev6", "ev7", "ev8", "ev8b", "ev9"], SEA, LONG),               // 上陸探索 / 海上特殊地點 (RE_NOTES 36.10)
  ...M("sea5_route", "SEA5", ["navi", "navi2", "scout", "dest", "deleg", "deleg0", "chart", "mapitem"], SEA, m => (m === "scout" ? { CURSOR_LAG: 4 } : m === "chart" ? { CURSOR_LAG: 10 } : LONG)),   // scout / chart 照原設定不用 FB_HASH (雜湊模式的游標遮罩與完整比對不同, scout 會差 3 張)
  ...M("battle_route", "BATTLE", ["open", "stop", "tail", "gun_sink", "gun_unmanned", "board_unmanned", "cpu_long"], SEA, LONG),
  ...M("duel_route", "DUEL", ["cpu", "tail"], ["battle_route.js", ...SEA], LONG),
  ...M("nego_route", "NEGO", ["n8", "n1", "n3", "n4", "n5", "n11", "nff", "map", "maphave", "mapno", "mappoor"], SEA, LONG),
  ...M("fleet_route", "FLEET_MODE", ["month", "year", "launch", "misc", "pirate", "unpaid"], [], LONG), ...M("fleet_route", "FLEET_MODE", ["seamonth"], SEA, LONG),
  ...M("mouse_route", "MOUSE_MODE", ["list", "yesno", "walk"]),                                           // 滑鼠操作 (RE_NOTES 38)
  ...M("mouse_route", "MOUSE_MODE", ["popup"], ["battle_route.js", ...SEA], LONG), ...M("mouse_route", "MOUSE_MODE", ["sea"], SEA, LONG),
  ...M("title_settings_route", null, [""]),                                                                 // 標題選單 環境設定 (RE_NOTES 38.7)
];
S.REGRESS_LIST = LIST;
// 每項執行前把上一項設定的 session 大寫鍵 (路線設定) 清掉; S.QUIET 讓 port_tests 只印不一致的畫面與總計
S.regress = async (o = {}) => {
  const U = S.UI, base = S.__regBase ??= new Set(Object.keys(S));
  if (o.model && !S.__regModel) { U.installCostModel(U); S.__regModel = true; }
  const out = (S.regResults ??= []), log0 = console.log;
  for (let i = o.from ?? 0; i < Math.min(o.to ?? LIST.length, LIST.length); i++) {
    const T = LIST[i];
    for (const k of Object.keys(S)) if (!base.has(k) && /^[A-Z][A-Z0-9_]*$/.test(k)) delete S[k];
    Object.assign(S, T.set || {}); if (!T.plain) { S.QUIET = 1; S.SFX_LOG ??= 1; }      // 路線一律比對效果音呼叫 (RE_NOTES 35.6)
    const lines = [], t0 = Date.now(), c0 = U.CPU.cyc;
    console.log = (...a) => lines.push(a.join(" "));
    let err = null;
    try { for (const f of T.files) await S.RUNF[f](); } catch (e) { err = String(e && e.stack || e).split("\n").slice(0, 3).join(" | "); }
    finally { console.log = log0; }
    const text = lines.join("\n");
    const sum = (text.match(/\[summary\][^\n]*/g) || []).pop();
    const ok = (text.match(/^(OK|POK)\b/gm) || []).length, fail = (text.match(/^(FAIL|PFAIL)\b/gm) || []).length;
    const r = { i, name: T.name, sec: +((Date.now() - t0) / 1000).toFixed(1), summary: sum || (ok + fail ? `${ok}/${ok + fail} OK` : ""), err, cyc: U.CPU.cyc - c0,
      bad: text.split("\n").filter(l => /^(FAIL|PFAIL)/.test(l)).slice(0, 4), tail: sum ? "" : text.split("\n").slice(-3).join(" / ").slice(0, 300) };
    out.push(r);
    for (const k of ["lastRun", "emuShotsRef", "probeE", "probeJ", "cmLog", "watchLog"]) delete S[k];   // 釋放截圖 (長批次時避免記憶體不足)
    log0(`#${i} ${T.name}: ${r.summary}${err ? " ERROR " + err : ""} (${r.sec}s)${r.bad.length ? "\n    " + r.bad.join("\n    ") : ""}${r.tail ? "\n    " + r.tail : ""}`);
  }
  return out;
};
console.log(`[regress] ${LIST.length} 項`);
})();
