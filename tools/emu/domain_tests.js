// domain_tests.js — 纯 TS 领域层 (economy.ts / fleet.ts) 与 ScenarioMemoryAdapter 单元测试
(function () {
  if (typeof session === "undefined" && typeof globalThis.UI === "undefined") {
    const path = require("path");
    require(path.resolve(__dirname, "../work/ui_bundle.js"));
  }
  const U = (typeof session !== "undefined" ? session : globalThis).UI;
  let passed = 0, failed = 0;
  function check(name, cond, detail) {
    if (cond) { passed++; console.log("OK   " + name); }
    else { failed++; console.error("FAIL " + name + (detail !== undefined ? " -> " + JSON.stringify(detail) : "")); }
  }
  function eq(name, actual, expected) {
    check(name, actual === expected, { actual, expected });
  }

  // ---- 1. Bank balance encode / decode ----
  {
    const e1 = U.encodeBankBalance(12345, "normal");
    eq("bank normal encode quotient", e1.quotient, 123);
    eq("bank normal encode rem", e1.rem, 45);
    eq("bank normal decode roundtrip", U.decodeBankBalance(e1.quotient, e1.rem), 12345);

    // 原版贷款奇特性: -1000 存为 (quotient=-11, rem=100) -> 100 * -11 + 100 = -1000
    const e2 = U.encodeBankBalance(-1000, "loan");
    eq("bank loan -1000 quotient", U.domS16(e2.quotient), -11);
    eq("bank loan -1000 rem", e2.rem, 100);
    eq("bank loan -1000 decode", U.decodeBankBalance(e2.quotient, e2.rem), -1000);

    const e3 = U.encodeBankBalance(-1234, "loan");
    eq("bank loan -1234 decode", U.decodeBankBalance(e3.quotient, e3.rem), -1234);

    // 还款清零 vs 部分还款
    const e4 = U.encodeBankBalance(0, "repay");
    eq("bank repay 0 quotient", e4.quotient, 0);
    eq("bank repay 0 rem", e4.rem, 0);
    const e5 = U.encodeBankBalance(-500, "repay");
    eq("bank repay -500 decode", U.decodeBankBalance(e5.quotient, e5.rem), -500);

    // 存款与贷款上限
    eq("bank deposit limit capped by cash", U.calcDepositLimit(0, 0, 50000), 50000);
    eq("bank deposit limit capped by 1M", U.calcDepositLimit(9990, 50, 50000), 950);
    eq("bank canTakeLoan rank 0 at q=0", U.canTakeLoan(0, 0), true);
    eq("bank canTakeLoan rank 0 at q=-10", U.canTakeLoan(0, -10 & 0xffff), false);
    eq("bank loan limit rank 2 bal -500", U.calcLoanLimit(2, -500), 40500);
  }

  // ---- 2. Market pricing, license, haggle, price shifts ----
  {
    const catEnd = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
    eq("goodsCategory 0 -> 0", U.goodsCategory(0, catEnd), 0);
    eq("goodsCategory 14 -> 2", U.goodsCategory(14, catEnd), 2);
    eq("goodsCategory 99 -> 0", U.goodsCategory(99, catEnd), 0);

    eq("hasTradeLicense Portugal (0) with 0x23", U.hasTradeLicense(0, [0xff, 0x23, 0xff]), true);
    eq("hasTradeLicense Spain (1) without 0x24", U.hasTradeLicense(1, [0x23, 0xff]), false);
    eq("hasTradeLicense neutral region 6", U.hasTradeLicense(6, [0x29]), false);

    eq("calcBuyPrice licensed idx=50 base=200", U.calcBuyPrice(50, 200, true), 200);
    eq("calcBuyPrice unlicensed idx=50 base=200", U.calcBuyPrice(50, 200, false), 240);
    eq("calcSellPrice regular idx=50 base=200", U.calcSellPrice(50, 200, false), 200);
    eq("calcSellPrice specialty idx=50 base=200", U.calcSellPrice(50, 200, true), 100);

    const h = U.calcHaggleBounds(1000, 3);
    eq("calcHaggleBounds lo (bonus=3)", h.lo, 800);
    eq("calcHaggleBounds mid (bonus=3)", h.mid, 900);

    const bs = U.calcBuyPriceShift(3500, 500);
    eq("calcBuyPriceShift catDelta", bs.catDelta, 3);
    eq("calcBuyPriceShift allDelta", bs.allDelta, 3);
    eq("clampPriceIndexUp 98+5 -> 100", U.clampPriceIndexUp(98, 5), 100);
    eq("clampPriceIndexDown 3-10 -> 0", U.clampPriceIndexDown(3, 10), 0);
  }

  // ---- 3. Fleet cargo, loadTotal, shipSpeed ----
  {
    const used = U.calcCargoUsed(100, 200, 15, 25, [3, 0xff, 7, 0xff, 0xff], [40, 999, 60, 0, 0]);
    eq("calcCargoUsed ignores 0xff slots", used, 10 + 20 + 15 + 25 + 40 + 60);
    eq("calcShipFreeCargo 500 - 170", U.calcShipFreeCargo(500, used), 330);
    eq("calcShipLoadTotal", U.calcShipLoadTotal(170, 20, 10, 50), 170 + 20 + 50);

    const spdNormal = U.calcShipSpeed({
      speedRate: 15, propulsion: 50, sailRatio: 50, crew: 100, minCrew: 50,
      loadTotal: 100, capacity: 300, captainNavLevel: 5, captainSailing: 75,
    });
    check("calcShipSpeed normal in (0..40]", spdNormal > 0 && spdNormal <= 40, spdNormal);

    const spdFull = U.calcShipSpeed({
      speedRate: 15, propulsion: 50, sailRatio: 50, crew: 100, minCrew: 50,
      loadTotal: 300, capacity: 300, captainNavLevel: 5, captainSailing: 75,
    });
    check("calcShipSpeed full load slower than light load", spdFull < spdNormal, { spdFull, spdNormal });
  }

  // ---- 4. ScenarioMemoryAdapter ----
  {
    const st = new U.GameState();
    const rt = { year: 22, month: 5, day: 17, time: 9 };
    const todos = [];
    const mem = new U.ScenarioMemoryAdapter({ state: st, rt, persons: [0x1234, 0x5678] }, m => todos.push(m));
    mem.wr16(U.DS.MONEY, 0x4240);
    eq("ScenarioMemoryAdapter rd16 DS.MONEY", mem.rd16(U.DS.MONEY), 0x4240);
    eq("ScenarioMemoryAdapter rt year/month/day/time", mem.rd8(0x0532) * 100 + mem.rd8(0x0533), 2205);
    eq("ScenarioMemoryAdapter persons[0]", mem.rd16(0x0538), 0x1234);
    mem.wr8(0x041e, 0x41);
    eq("ScenarioMemoryAdapter str buffer", mem.str[0], 0x41);
    eq("ScenarioMemoryAdapter recordAddr country[2]+4", mem.recordAddr(0, 2, 4), (U.DS.TBL_COUNTRY + 2 * 0x20 + 4) & 0xffff);
    eq("ScenarioMemoryAdapter zero unexpected todos", todos.length, 0);
  }

  // ---- 5. Readable Data JSON Decoders (windcur/za_dat/monster/mapnodes/worldmap/portmap) ----
  {
    const fs = require("fs");
    const path = require("path");
    const {
      decodeWindCurJson,
      decodeZaDatJson,
      decodeMonsterJson,
      decodeMapNodesJson,
      decodeWorldMapJson,
      decodePortMapJson,
    } = require(path.resolve(__dirname, "../../web/src/decoders/bin_json.ts"));
    const dataDir = path.resolve(__dirname, "../../web/assets/data");
    const rd = (f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8"));
    eq("windcur.json decoded byte length", decodeWindCurJson(rd("windcur.json")).length, 1350);
    eq("za_dat.json decoded byte length", decodeZaDatJson(rd("za_dat.json")).length, 2424);
    eq("monster.json decoded byte length", decodeMonsterJson(rd("monster.json")).length, 200);
    eq("mapnodes.json decoded byte length", decodeMapNodesJson(rd("mapnodes.json")).length, 9952);
    eq("worldmap.json decoded byte length", decodeWorldMapJson(rd("worldmap.json")).length, 583200);
    eq("portmap.json decoded byte length", decodePortMapJson(rd("portmap.json")).length, 930816);
  }

  // ---- 6. UserPrefs defaults, cash cap unlock, hero captain bugfix, 1552 unlock, BGM packs ----
  {
    const fs = require("fs");
    const path = require("path");
    const prefs = U.createDefaultPrefs();
    eq("default prefs bgmPack == ps1", prefs.bgmPack, "ps1");
    eq("default prefs all rule toggles off",
      prefs.unlock1552 || prefs.unlockCashCap || prefs.fixItemShopNight || prefs.fixPalaceHeroCaptain || prefs.fixScoutSpeedArgs,
      false);
    eq("cash cap default == 600M", U.getCashCap({ prefs }), 600_000_000);
    eq("addCashClamped default clamps to 600M", U.addCashClamped(590_000_000, 50_000_000, { prefs }), 600_000_000);
    const unlocked = { prefs: { ...prefs, unlockCashCap: true } };
    eq("cash cap unlocked == 2B", U.getCashCap(unlocked), 2_000_000_000);
    eq("addCashClamped unlocked allows 1.5B without i32 wrap", U.addCashClamped(1_000_000_000, 500_000_000, unlocked), 1_500_000_000);
    eq("addCashClamped unlocked clamps to 2B", U.addCashClamped(1_900_000_000, 500_000_000, unlocked), 2_000_000_000);

    const st = new U.GameState();
    st.model.globals.hero = 0;
    st.model.heroPerson().fleet = 0;
    st.model.fleet(0).shipSlot(0).flags = 0x10;
    st.model.crewSlot(0).captain = 2; // hero not commanding slot 0
    // empty slot 1 has captain=0 (john) and flags=0
    eq("collectAvailableCaptains original skips hero 0 on empty slot", U.collectAvailableCaptains(st.model, false).includes(0), false);
    eq("collectAvailableCaptains fixed includes hero 0 on empty slot", U.collectAvailableCaptains(st.model, true).includes(0), true);

    const bgmJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../web/assets/data/bgm.json"), "utf8"));
    const bgmDir = path.resolve(__dirname, "../../web/bgm");
    const ps1Files = Object.values(bgmJson.songs).filter(Boolean);
    const cd30Files = Object.values(bgmJson.packs?.cd30 || {}).filter(Boolean);
    check("bgm ps1 files all exist", ps1Files.length >= 20 && ps1Files.every(f => fs.existsSync(path.join(bgmDir, f))));
    check("bgm cd30 files all exist", cd30Files.length === 12 && cd30Files.every(f => fs.existsSync(path.join(bgmDir, f))));
  }

  console.log(`[domain_tests] passed=${passed} failed=${failed}`);
  if (failed > 0) process.exit(1);
})();
