"""把 web/src 的 ES/TS 模組打包成一個 IIFE 腳本 (tools/work/ui_bundle.js), 供沙盒/Node 測試載入"""
import os, subprocess, sys

ENTRY_IMPORTS = """
export * from "./web/src/model/flags.ts";
export * from "./web/src/model/schema_views.ts";
export * from "./web/src/model/world_helpers.ts";
export * from "./web/src/domain/economy.ts";
export * from "./web/src/domain/fleet.ts";
export * from "./web/src/decoders/bin_json.ts";
export * from "./web/src/decoders/kao.js";
export * from "./web/src/decoders/png_index.ts";
export * from "./web/src/decoders/worldmap.js";
export * from "./web/src/ui/dos/protocol.ts";
export * from "./web/src/ui/dos/legacy_presenter.ts";
export * from "./web/src/ui/dos/console.js";
export * from "./web/src/ui/dos/window.js";
export * from "./web/src/ui/dos/printf.js";
export * from "./web/src/ui/dos/menu.js";
export * from "./web/src/ui/dos/graph.js";
export * from "./web/src/ui/dos/nameinput.js";
export * from "./web/src/ui/dos/numpad.js";
export * from "./web/src/ui/dos/listsel.js";
export * from "./web/src/ui/dos/cellsel.js";
export * from "./web/src/ui/sea_modals.ts";
export * from "./web/src/ui/info_maps.ts";
export * from "./web/src/ui/info_modals.ts";
export * from "./web/src/ui/info_hub.ts";
export * from "./web/src/ui/buildings/shipyard_parts.ts";
export * from "./web/src/ui/buildings/shipyard.ts";
export * from "./web/src/core/opl.js";
export * from "./web/src/core/sfx.js";
export * from "./web/src/core/screen.js";
export * from "./web/src/core/font.js";
export * from "./web/src/core/sys.js";
export * from "./web/src/core/palette.js";
export * from "./web/src/core/ls11.js";
export * from "./web/src/save/format.ts";
export * from "./web/src/save/legacy_import.ts";
export * from "./web/src/save/store.ts";
export * from "./web/src/save/savefile.js";
export * from "./web/src/game/data.js";
export * from "./web/src/game/state.js";
export * from "./web/src/game/scenario_adapter.ts";
export * from "./web/src/game/scenario.js";
export * from "./web/src/game/newgame.js";
export * from "./web/src/game/fleetai.js";
export * from "./web/src/game/monthly.js";
export * from "./web/src/game/clock.js";
export * from "./web/src/game/title.js";
export * from "./web/src/game/opening.js";
export * from "./web/src/game/ending_pro.js";
export * from "./web/src/game/ending.js";
export * from "./web/src/game/endgame.js";
export * from "./web/src/scenes/duel.js";
export * from "./web/src/scenes/gamble.js";
export * from "./web/src/scenes/market.js";
export * from "./web/src/scenes/palace.js";
export * from "./web/src/scenes/office.js";
export * from "./web/src/scenes/house.js";
export * from "./web/src/scenes/bank.js";
export * from "./web/src/scenes/itemshop.js";
export * from "./web/src/scenes/tavern.js";
export * from "./web/src/scenes/wharf.js";
export * from "./web/src/scenes/shipyard.js";
export * from "./web/src/scenes/church_inn_fortune.js";
export * from "./web/src/scenes/buildings.js";
export * from "./web/src/scenes/portmove.js";
export * from "./web/src/scenes/commands.js";
export * from "./web/src/scenes/port.js";
export * from "./web/src/scenes/negotiate.js";
export * from "./web/src/scenes/battle.js";
export * from "./web/src/scenes/land.js";
export * from "./web/src/scenes/sea.js";
"""


def bundle(root, _mods=None, out=None, _names=None):
    out_path = os.path.abspath(out)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    node_script = """
const esbuild = require('esbuild');
const out = process.argv[1];
let contents = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => contents += c);
process.stdin.on('end', () => {
  esbuild.buildSync({
    stdin: { contents, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true,
    format: 'iife',
    globalName: '__uw2_ui',
    platform: 'node',
    external: ['opencc-js'],
    footer: { js: "(typeof session!=='undefined'?session:globalThis).UI=__uw2_ui;" },
    outfile: out,
  });
});
"""
    p = subprocess.run(
        ["node", "-e", node_script, out_path],
        input=ENTRY_IMPORTS, text=True, capture_output=True, cwd=root, encoding="utf-8",
    )
    if p.returncode != 0:
        raise RuntimeError(f"esbuild bundle failed:\n{p.stderr}")


if __name__ == "__main__":
    bundle(sys.argv[1], None, sys.argv[2], None)
