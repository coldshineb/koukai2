"""把 web/src 的 ES 模組去掉 import/export 後合併成一個腳本, 供沙盒/Node 差分測試載入"""
import re, sys
def bundle(root, mods, out, names):
    src = []
    for m in mods:
        s = open(f"{root}/web/src/{m}", encoding="utf-8").read()
        s = re.sub(r"^import .*?;\s*$", "", s, flags=re.M)
        s = re.sub(r"^export (const|class|function|async function|let) ", r"\1 ", s, flags=re.M)
        src.append(s)
    src.append("(typeof session!=='undefined'?session:globalThis).UI={" + ",".join(names) + "};")
    open(out, "w", encoding="utf-8").write("(function(){\n" + "\n".join(src) + "\n})();\n")
MODS = ["core/cpucost_table.js","core/cpucost.js","core/screen.js","core/font.js","core/sys.js","ui/console.js","ui/window.js","ui/printf.js","ui/menu.js","gfx/graphdec.js","core/palette.js","core/ls11.js","gfx/kao.js","gfx/worldmap.js","ui/graph.js","game/state.js","game/savefile.js","ui/nameinput.js","game/newgame.js","ui/numpad.js","ui/listsel.js","ui/cellsel.js","gfx/duelanim.js","scenes/duel.js","game/scenario.js","scenes/gamble.js","scenes/market.js","scenes/palace.js","scenes/office.js","scenes/house.js","scenes/bank.js","scenes/itemshop.js","scenes/buildings.js","scenes/portmove.js","scenes/commands.js","game/endgame.js","scenes/port.js","scenes/negotiate.js","scenes/battle.js","scenes/sea.js","game/fleetai.js","game/monthly.js","game/clock.js","game/title.js","game/data.js","game/opening.js","game/ending_pro.js","game/ending.js"]
NAMES = ["CPU","COST_TABLE","installCostModel","Screen","Font","TextConsole","WindowSystem","codeToGlyph","Sys","Rng","Timer","cprintf","MenuSystem","decodeGraph","graphOffsets","GraphDat","graphSize","Palette","paletteTables","PALETTE_ADDR","lsEntries","lsDecode","lsUnpack","Kao","PARTS","Graph","GameState","SaveFile","Title","PortScene","Buildings","Commands","PortMove","Gamble","Market","Palace","Office","House","Bank","ItemShop","NumPad","ListSelect","CellSelect","Scenario","ENV_COMMON","ENV_HERO","GameClock","loadPortAssets","NewGame","NameInput","kbValid","STATE_LOAD_SIZE","TextCodec","decodeState","encodeState","recordAddr","Opening","OpVGA","OpeningExit","opCodeToGlyph","loadOpeningData","SeaScene","WorldMap","marketTradeLog","FleetAI","Monthly","NavalBattle","Duel","PlanarBuf","Ending","PROLOGUES","MainExit","mainEnding"]
if __name__ == "__main__":
    bundle(sys.argv[1], MODS, sys.argv[2], NAMES)
