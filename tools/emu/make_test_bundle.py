"""把 web/src 的 ES/TS 模組去掉 import/export 後合併成一個腳本, 供沙盒/Node 差分測試載入"""
import os, re, subprocess, sys


def _strip_ts(root, code, filename):
    """用專案內安裝的 esbuild 將單一 .ts 檔案轉成純 JS (保留程式碼結構、零型別殘留)"""
    js = (
        "const esbuild=require('esbuild');"
        "let s='';process.stdin.setEncoding('utf8');"
        "process.stdin.on('data',c=>s+=c);"
        "process.stdin.on('end',()=>{"
        "const r=esbuild.transformSync(s,{loader:'ts',target:'es2022',sourcefile:process.argv[1]});"
        "process.stdout.write(r.code);"
        "});"
    )
    p = subprocess.run(
        ["node", "-e", js, filename],
        input=code, text=True, capture_output=True, cwd=root, encoding="utf-8",
    )
    if p.returncode != 0:
        raise RuntimeError(f"esbuild failed on {filename}:\n{p.stderr}")
    return p.stdout


def bundle(root, mods, out, names):
    src = []
    for m in mods:
        path = f"{root}/web/src/{m}"
        s = open(path, encoding="utf-8").read()
        if m.endswith(".ts"):
            s = _strip_ts(root, s, m)
        s = re.sub(r"^import .*?;\s*$", "", s, flags=re.M)
        s = re.sub(r"^export (const|class|function|async function|let) ", r"\1 ", s, flags=re.M)
        src.append(s)
    src.append("(typeof session!=='undefined'?session:globalThis).UI={" + ",".join(names) + "};")
    open(out, "w", encoding="utf-8").write("(function(){\n" + "\n".join(src) + "\n})();\n")


MODS = ["model/flags.ts","model/schema_views.ts","domain/economy.ts","domain/fleet.ts","ui/protocol.ts","ui/legacy_presenter.ts","game/scenario_adapter.ts","core/opl.js","core/sfx.js","core/cpucost_table.js","core/cpucost.js","core/screen.js","core/font.js","core/sys.js","ui/console.js","ui/window.js","ui/printf.js","ui/menu.js","gfx/graphdec.js","core/palette.js","core/ls11.js","gfx/kao.js","gfx/worldmap.js","ui/graph.js","game/data.js","save/format.ts","save/legacy_import.ts","save/store.ts","game/state.js","game/savefile.js","ui/nameinput.js","game/newgame.js","ui/numpad.js","ui/listsel.js","ui/cellsel.js","gfx/duelanim.js","scenes/duel.js","game/scenario.js","scenes/gamble.js","scenes/market.js","scenes/palace.js","scenes/office.js","scenes/house.js","scenes/bank.js","scenes/itemshop.js","scenes/tavern.js","scenes/wharf.js","scenes/shipyard.js","scenes/church_inn_fortune.js","scenes/buildings.js","scenes/portmove.js","scenes/commands.js","game/endgame.js","scenes/port.js","scenes/negotiate.js","scenes/battle.js","scenes/land.js","scenes/sea.js","game/fleetai.js","game/monthly.js","game/clock.js","game/title.js","game/opening.js","game/ending_pro.js","game/ending.js"]
NAMES = ["WorldModel","DS","OFF","GameConst","WorkDS","SkillFlag","NobleFlag","TreatyFlag","OptionFlag","BuildingId","ShipSlotFlag","FleetFlag","SeaFlag2","DiscoveryFlag","ItemFlag","ItemKind","MenuId","domS16","domUmin16","domUmax16","decodeBankBalance","encodeBankBalance","calcDepositLimit","canTakeLoan","calcLoanLimit","goodsCategory","hasTradeLicense","calcBuyPrice","calcSellPrice","calcHaggleBounds","calcBuyPriceShift","calcSellPriceShift","clampPriceIndexUp","clampPriceIndexDown","calcCargoUsed","calcShipFreeCargo","calcShipLoadTotal","calcShipSpeed","LegacyGameUI","LegacyScenarioHost","ScenarioMemoryAdapter","SAVE_FORMAT_V2","SAVE_VERSION_V2","stateBytesToV2","v2ToStateBytes","buildSaveSummary","createSaveSlotV2","slotV2ToLegacyHeader","createEmptyBundleV2","isSaveBundleV2","parseSaveJsonV2","isLegacyKoukaiDat","parseLegacyHeaders","importLegacySave","SaveStore","OPL3","FmDriver","SFX_VOICES","SfxPort","CPU","COST_TABLE","installCostModel","Screen","Font","TextConsole","WindowSystem","codeToGlyph","Sys","Rng","Timer","cprintf","MenuSystem","decodeGraph","graphOffsets","GraphDat","graphSize","Palette","paletteTables","PALETTE_ADDR","lsEntries","lsDecode","lsUnpack","Kao","PARTS","Graph","GameState","SaveFile","Title","PortScene","Buildings","Commands","PortMove","Gamble","Market","Palace","Office","House","Bank","ItemShop","NumPad","ListSelect","CellSelect","Scenario","ENV_COMMON","ENV_HERO","GameClock","loadPortAssets","NewGame","NameInput","kbValid","STATE_LOAD_SIZE","TextCodec","decodeState","encodeState","recordAddr","Opening","OpVGA","OpeningExit","opCodeToGlyph","loadOpeningData","SeaScene","WorldMap","marketTradeLog","FleetAI","Monthly","NavalBattle","Land","Duel","PlanarBuf","Ending","PROLOGUES","MainExit","mainEnding"]
if __name__ == "__main__":
    bundle(sys.argv[1], MODS, sys.argv[2], NAMES)
