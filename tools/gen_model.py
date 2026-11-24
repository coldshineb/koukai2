"""
gen_model.py — 從 web/assets/data/schema.json 自動產生強型別具名存取層 web/src/model/schema_views.ts
用法: python tools/gen_model.py
"""
import json, os, re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCHEMA_PATH = os.path.join(ROOT, "web", "assets", "data", "schema.json")
OUT_PATH = os.path.join(ROOT, "web", "src", "model", "schema_views.ts")

CLASS_NAMES = {
    "countries": ("CountryView", "country"),
    "heroData": ("HeroDataView", "heroData"),
    "persons": ("PersonView", "person"),
    "nobles": ("NobleView", "noble"),
    "barmaids": ("BarmaidView", "barmaid"),
    "fleets": ("FleetView", "fleet"),
    "t52d4": ("CrewSlotView", "crewSlot"),
    "dockSlots": ("ShipSlotView", "dockSlot"),
    "ships": ("ShipView", "ship"),
    "shipTypes": ("ShipTypeView", "shipType"),
    "ports": ("PortView", "port"),
    "portEconomy": ("PortEconomyView", "portEconomy"),
    "t78f4": ("RegionPriceView", "regionPrice"),
    "t7f74": ("UsedShipCacheView", "usedShipCache"),
    "discoveries": ("DiscoveryView", "discovery"),
    "items": ("ItemView", "item"),
}


def cap(s):
    return s[0].upper() + s[1:]


def emit_field_methods(f, indent="  "):
    name = f["name"]
    off = f["off"]
    t = f["type"]
    cnt = f.get("count")
    ev = f.get("evidence", "").replace("*/", "* /")
    lines = []
    doc = f"{indent}/** +0x{off:02x}: {ev} */" if ev else ""
    if t == "str":
        if doc:
            lines.append(doc)
        lines.append(f"{indent}get {name}Bytes(): Uint8Array {{ return this.st.cstr(this.addr + 0x{off:02x}); }}")
    elif t == "struct":
        # fleets.ships -> ShipSlotView
        if doc:
            lines.append(doc)
        lines.append(f"{indent}shipSlot(k: number): ShipSlotView {{ return new ShipSlotView(this.st, this.addr + 0x{off:02x} + k * 0x{f['size']:02x}); }}")
    elif cnt:
        if doc:
            lines.append(doc)
        if t == "u8":
            lines.append(f"{indent}get{cap(name)}(k: number): number {{ return this.st.u8(this.addr + 0x{off:02x} + k); }}")
            lines.append(f"{indent}set{cap(name)}(k: number, v: number): void {{ this.st.set8(this.addr + 0x{off:02x} + k, v); }}")
        elif t == "u16":
            lines.append(f"{indent}get{cap(name)}(k: number): number {{ return this.st.u16(this.addr + 0x{off:02x} + k * 2); }}")
            lines.append(f"{indent}set{cap(name)}(k: number, v: number): void {{ this.st.set16(this.addr + 0x{off:02x} + k * 2, v); }}")
    else:
        if doc:
            lines.append(doc)
        if t == "u8":
            lines.append(f"{indent}get {name}(): number {{ return this.st.u8(this.addr + 0x{off:02x}); }}")
            lines.append(f"{indent}set {name}(v: number) {{ this.st.set8(this.addr + 0x{off:02x}, v); }}")
        elif t == "u16":
            lines.append(f"{indent}get {name}(): number {{ return this.st.u16(this.addr + 0x{off:02x}); }}")
            lines.append(f"{indent}set {name}(v: number) {{ this.st.set16(this.addr + 0x{off:02x}, v); }}")
    return lines


def main():
    schema = json.load(open(SCHEMA_PATH, encoding="utf-8"))
    out = [
        "// schema_views.ts — 由 tools/gen_model.py 依 assets/data/schema.json 自動產生; 請勿手改",
        "// 零拷貝強型別具名存取層: 過渡期底層直接讀寫原版 GameState.b (Uint8Array), 確保差分回歸 100% 一致。",
        "",
        "export interface StateBuffer {",
        "  readonly b: Uint8Array;",
        "  u8(ds: number): number;",
        "  set8(ds: number, v: number): void;",
        "  u16(ds: number): number;",
        "  set16(ds: number, v: number): void;",
        "  bytes(ds: number, n: number): Uint8Array;",
        "  cstr(ds: number): Uint8Array;",
        "}",
        "",
        "/** 原版 DGROUP 位址常數 (供過渡期對照與劇本 VM 橋接使用) */",
        "export const DS = {",
        "  STATE_BASE: 0x0ca4,",
        "  STATE_END: 0x8d18,",
        "  NPCS: 0x0cbc,            // 港內行人 (8 × 3 bytes)",
        "  WIND_CUR: 0x0cb2,        // 海流 (u8)",
        "  EXPLORE_LOC: 0x1046,     // 已探索地點位元表",
        "  COOLDOWN_10A6: 0x10a6,   // 每日倒數計數器",
        "  DAYS_AT_SEA: 0x2e18,     // 出港天數 (u8)",
        "  PARTY_CREW: 0x2e1b,      // 同伴人物編號 (30 格, FF=空)",
        "  INVENTORY: 0x2e57,       // 主角隨身物道具編號 (20 格, FF=空)",
        "  TRADE_LOGS: 0x8a18,      // 航海日誌 / 交易記錄 (48 筆 × 16 bytes)",
    ]
    for g in schema["globals"]:
        const_name = re.sub(r"([A-Z])", r"_\1", g["name"]).upper()
        out.append(f"  {const_name}: 0x{g['ds']:04x},")
    for t in schema["tables"]:
        cls, method = CLASS_NAMES[t["name"]]
        const_name = re.sub(r"([A-Z])", r"_\1", method).upper()
        out.append(f"  TBL_{const_name}: 0x{t['ds']:04x},")
    out.append("} as const;")
    out.append("")

    # Table field offset constants (OFF.<TABLE>.<FIELD>)
    out.append("/** 各資料表欄位偏移常數 (由 schema.json 自動產生, 供高效能/指標運算模組具名化使用) */")
    out.append("export const OFF = {")
    seen_off = set()
    for t in schema["tables"]:
        _, method = CLASS_NAMES[t["name"]]
        tkey = re.sub(r"([A-Z])", r"_\1", method).upper()
        if tkey in seen_off:
            continue
        seen_off.add(tkey)
        out.append(f"  {tkey}: {{")
        for f in t["fields"]:
            fkey = re.sub(r"([A-Z])", r"_\1", f["name"]).upper()
            out.append(f"    {fkey}: 0x{f['off']:02x},")
        out.append("  },")
    out.append("} as const;")
    out.append("")

    # GlobalsView
    out.append("export class GlobalsView {")
    out.append("  readonly st: StateBuffer;")
    out.append("  constructor(st: StateBuffer) { this.st = st; }")
    for g in schema["globals"]:
        name, ds, typ = g["name"], g["ds"], g.get("type", "u8")
        ev = g.get("evidence", "").replace("*/", "* /")
        out.append(f"  /** DS:0x{ds:04x}: {ev} */")
        if typ == "u32":
            out.append(f"  get {name}(): number {{ return (this.st.u16(0x{ds:04x}) | (this.st.u16(0x{ds + 2:04x}) << 16)) | 0; }}")
            out.append(f"  set {name}(v: number) {{ this.st.set16(0x{ds:04x}, v & 0xffff); this.st.set16(0x{ds + 2:04x}, (v >>> 16) & 0xffff); }}")
        elif typ == "u16":
            out.append(f"  get {name}(): number {{ return this.st.u16(0x{ds:04x}); }}")
            out.append(f"  set {name}(v: number) {{ this.st.set16(0x{ds:04x}, v); }}")
        else:
            out.append(f"  get {name}(): number {{ return this.st.u8(0x{ds:04x}); }}")
            out.append(f"  set {name}(v: number) {{ this.st.set8(0x{ds:04x}, v); }}")
    out.append("  /** 銀行餘額 = 100 × (有號 bankQuotient) + bankRem (負數表示借款) */")
    out.append("  get bankBalance(): number { const q = (this.bankQuotient << 16) >> 16; return (Math.imul(100, q) + this.bankRem) | 0; }")
    out.append("}")
    out.append("")

    # Table View classes
    emitted_classes = set()
    for t in schema["tables"]:
        cls, _ = CLASS_NAMES[t["name"]]
        if cls in emitted_classes:
            continue
        emitted_classes.add(cls)
        note = t.get("note", "").replace("*/", "* /")
        out.append(f"/** {t['name']} (DS:0x{t['ds']:04x}, {t['count']} × 0x{t['stride']:02x}): {note} */")
        out.append(f"export class {cls} {{")
        out.append("  readonly st: StateBuffer;")
        out.append("  readonly addr: number;")
        out.append("  constructor(st: StateBuffer, addr: number) { this.st = st; this.addr = addr; }")
        for f in t["fields"]:
            out.extend(emit_field_methods(f))
        out.append("}")
        out.append("")

    # WorldModel facade
    out.append("export class WorldModel {")
    out.append("  readonly st: StateBuffer;")
    out.append("  readonly globals: GlobalsView;")
    out.append("  constructor(st: StateBuffer) { this.st = st; this.globals = new GlobalsView(st); }")
    for t in schema["tables"]:
        cls, method = CLASS_NAMES[t["name"]]
        out.append(f"  {method}(i: number): {cls} {{ return new {cls}(this.st, 0x{t['ds']:04x} + (i & 0xff) * 0x{t['stride']:02x}); }}")
    out.append("  /** 目前主角的人物記錄 */")
    out.append("  heroPerson(): PersonView { return this.person(this.globals.hero); }")
    out.append("  /** 目前主角的名聲 / 聲望 / 爵位記錄 */")
    out.append("  heroInfo(): HeroDataView { return this.heroData(this.globals.hero); }")
    out.append("  /** 目前所在港口 (海上時為 0xFF) */")
    out.append("  currentPort(): PortView { return this.port(this.globals.port); }")
    out.append("  /** 目前所在港口的經濟資料 */")
    out.append("  currentPortEconomy(): PortEconomyView { return this.portEconomy(this.globals.port); }")
    out.append("  /** 隨身物第 slot 格 (0..19, 0xFF=空) */")
    out.append("  inventory(slot: number): number { return this.st.u8(DS.INVENTORY + slot); }")
    out.append("  setInventory(slot: number, itemId: number): void { this.st.set8(DS.INVENTORY + slot, itemId); }")
    out.append("  /** 同伴欄位第 slot 格 (0..29, 0xFF=空) */")
    out.append("  partyCrew(slot: number): number { return this.st.u8(DS.PARTY_CREW + slot); }")
    out.append("  setPartyCrew(slot: number, personId: number): void { this.st.set8(DS.PARTY_CREW + slot, personId); }")
    out.append("}")
    out.append("")

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    open(OUT_PATH, "w", encoding="utf-8", newline="\r\n").write("\n".join(out))
    print(f"generated {OUT_PATH} ({len(out)} lines, {len(emitted_classes)} view classes)")


if __name__ == "__main__":
    main()
