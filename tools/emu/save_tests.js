// save_tests.js — 现代 uw2-save-v2 JSON 存盘格式、只读 KOUKAI2.DAT 导入器与 SaveStore 单元测试
(function () {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "../..");
  if (typeof session === "undefined" && typeof globalThis.UI === "undefined") {
    require(path.resolve(ROOT, "tools/work/ui_bundle.js"));
  }
  const U = (typeof session !== "undefined" ? session : globalThis).UI;
  const A = path.resolve(ROOT, "web/assets");
  const schema = JSON.parse(fs.readFileSync(path.join(A, "data/schema.json"), "utf8"));
  const codec = new U.TextCodec(JSON.parse(fs.readFileSync(path.join(A, "font/charmap.json"), "utf8")));
  const newgame = new Uint8Array(fs.readFileSync(path.resolve(ROOT, "tools/work/newgame.bin")));
  const k2 = new Uint8Array(fs.readFileSync(path.resolve(ROOT, "tools/work/sea2/KOUKAI2.DAT")));

  let passed = 0, failed = 0;
  function check(name, cond, detail) {
    if (cond) { passed++; console.log("OK   " + name); }
    else { failed++; console.error("FAIL " + name + (detail !== undefined ? " -> " + JSON.stringify(detail) : "")); }
  }
  const eqBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  function hasUnknownKeys(obj) {
    if (!obj || typeof obj !== "object") return false;
    if (Array.isArray(obj)) return obj.some(hasUnknownKeys);
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith("u_") || k.endsWith("Tail")) return true;
      if (hasUnknownKeys(v)) return true;
    }
    return false;
  }

  // ---- 1. uw2-save-v2 clean named JSON + exact roundtrip ----
  {
    const v2 = U.stateBytesToV2(newgame, schema, codec, { includeCompat: true });
    check("v2 tables contain zero u_xx / *Tail keys", !hasUnknownKeys(v2.tables));
    check("v2 exact roundtrip == newgame.bin", eqBytes(U.v2ToStateBytes(v2, schema, codec), newgame));

    // Pure semantic JSON (no _compat) overlaid onto baseState
    const pure = U.stateBytesToV2(newgame, schema, codec, { includeCompat: false });
    check("pure v2 has no _compat", pure._compat === undefined);
    check("pure v2 overlaid onto baseState == newgame.bin", eqBytes(U.v2ToStateBytes(pure, schema, codec, newgame), newgame));

    // Mutate named field in pure JSON and verify encoded bytes reflect change
    pure.globals.money = 123456;
    const mutatedBytes = U.v2ToStateBytes(pure, schema, codec, newgame);
    const st = new U.GameState(mutatedBytes, schema);
    check("pure v2 mutated globals.money reflected in GameState", st.model.globals.money === 123456, st.model.globals.money);
  }

  // ---- 2. Read-only KOUKAI2.DAT importer ----
  {
    check("isLegacyKoukaiDat accepts real KOUKAI2.DAT", U.isLegacyKoukaiDat(k2));
    check("isLegacyKoukaiDat rejects invalid length", !U.isLegacyKoukaiDat(new Uint8Array(100)));

    const hdrs = U.parseLegacyHeaders(k2);
    check("parseLegacyHeaders returns 10 slots", hdrs.length === 10);

    const bundle = U.importLegacySave(k2, schema, codec);
    check("importLegacySave returns uw2-save-v2 bundle", U.isSaveBundleV2(bundle));

    let occupiedCount = 0;
    for (let i = 0; i < 10; i++) {
      const slot = bundle.slots[i];
      if (!hdrs[i].occupied) {
        check(`KOUKAI2.DAT slot ${i} empty -> null`, slot === null);
        continue;
      }
      occupiedCount++;
      check(`KOUKAI2.DAT slot ${i} has readable summary`, slot !== null && slot.summary.year >= 1500 && slot.summary.portName.length > 0, slot?.summary);
      // Full JSON serialization roundtrip -> byte-identical to original KOUKAI2.DAT slot
      const jsonRoundtrip = JSON.parse(JSON.stringify(slot));
      const rebuilt = U.v2ToStateBytes(jsonRoundtrip.state, schema, codec);
      const orig = k2.subarray(0x97 + i * 0x8074, 0x97 + (i + 1) * 0x8074);
      check(`KOUKAI2.DAT slot ${i} JSON roundtrip byte-identical`, eqBytes(rebuilt, orig));
    }
    check("KOUKAI2.DAT imported at least 1 occupied slot", occupiedCount > 0, occupiedCount);
  }

  // ---- 3. SaveStore & SaveFile JSON persistence / import / export ----
  {
    const bundle = U.createEmptyBundleV2(0);
    const store = new U.SaveStore(bundle, schema, codec, newgame);

    // Import KOUKAI2.DAT into SaveStore
    const impDat = store.importBuffer(k2);
    check("SaveStore.importBuffer detects legacy-dat", impDat.kind === "legacy-dat" && impDat.importedSlots > 0, impDat);

    // Export clean JSON (stripped _compat) and re-import into a fresh store
    const cleanJson = store.exportJson({ pretty: false, stripCompat: true });
    const parsedClean = JSON.parse(cleanJson);
    check("exportJson(stripCompat) removes _compat", parsedClean.slots.every(s => !s || s.state._compat === undefined));

    const store2 = new U.SaveStore(U.createEmptyBundleV2(0), schema, codec, newgame);
    const impJson = store2.importBuffer(new TextEncoder().encode(cleanJson));
    check("SaveStore.importBuffer detects json-bundle", impJson.kind === "json-bundle" && impJson.importedSlots === impDat.importedSlots, impJson);

    // Auto-save roundtrip
    store2.saveAuto(newgame);
    const autoBytes = store2.loadAutoBytes();
    check("SaveStore autoSave roundtrip == newgame.bin", autoBytes !== null && eqBytes(autoBytes, newgame));

    // SaveFile backed by SaveStore
    const sf = new U.SaveFile(new Uint8Array(U.FILE_SIZE || 328991), store2);
    const h15 = new Uint8Array(15);
    h15[0] = 0x31; h15[1] = 0x37; h15[2] = 0x2f; h15[12] = 0; h15[13] = 1;
    sf.writeSlot(9, h15, newgame);
    check("SaveFile(store).slot(9) roundtrip == newgame.bin", eqBytes(sf.slot(9), newgame));
    check("SaveFile(store).header(9)[0] == '1'", sf.header(9)[0] === 0x31);
  }

  console.log(`[save_tests] passed=${passed} failed=${failed}`);
  if (failed > 0) process.exit(1);
})();
