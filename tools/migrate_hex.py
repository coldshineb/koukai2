"""
migrate_hex.py — 將 web/src 中明確的 DS 全域位址與表欄位偏移具名化為 DS.* / WorkDS.* / OFF.*
只處理程式碼段 (不改註解與字串), 保持 CRLF 換行符, 零語義變化。
用法: python tools/migrate_hex.py <file.js> [VAR=TABLE ...]
例如: python tools/migrate_hex.py web/src/game/fleetai.js F=FLEET E=PORT_ECONOMY N=COUNTRY
"""
import json, os, re, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCHEMA = json.load(open(os.path.join(ROOT, "web", "assets", "data", "schema.json"), encoding="utf-8"))

CLASS_METHOD = {
    "countries": "COUNTRY",
    "heroData": "HERO_DATA",
    "persons": "PERSON",
    "nobles": "NOBLE",
    "barmaids": "BARMAID",
    "fleets": "FLEET",
    "t52d4": "CREW_SLOT",
    "dockSlots": "DOCK_SLOT",
    "ships": "SHIP",
    "shipTypes": "SHIP_TYPE",
    "ports": "PORT",
    "portEconomy": "PORT_ECONOMY",
    "t78f4": "REGION_PRICE",
    "t7f74": "USED_SHIP_CACHE",
    "discoveries": "DISCOVERY",
    "items": "ITEM",
}

DS_MAP = {
    0x0ca4: "DS.OPTIONS",
    0x0ca6: "DS.SEA_SPEED",
    0x0ca8: "DS.MOUSE_SENS",
    0x0ca9: "DS.SEA_SCROLL",
    0x0caa: "DS.YEAR",
    0x0cab: "DS.MONTH",
    0x0cac: "DS.DAY",
    0x0cad: "DS.TIME",
    0x0cae: "DS.PORT",
    0x0caf: "DS.LAST_PORT",
    0x0cb0: "DS.DAILY_FLAGS",
    0x0cb1: "DS.PORT_FLAGS",
    0x0cb2: "DS.WIND_CUR",
    0x0cb3: "DS.WEATHER",
    0x0cb4: "DS.PORT_VIEW_X",
    0x0cb6: "DS.PORT_VIEW_Y",
    0x0cb8: "DS.HERO_WIN_X",
    0x0cba: "DS.HERO_WIN_Y",
    0x0cbc: "DS.NPCS",
    0x0cd4: "DS.HERO_CHAP",
    0x0cd5: "DS.HERO_SEC",
    0x0d5e: "DS.COMMON_CHAP",
    0x0d5f: "DS.COMMON_SEC",
    0x0d62: "WorkDS.FLAGS",
    0x0d68: "WorkDS.KINDS",
    0x0d6e: "WorkDS.PARAMS",
    0x0d74: "WorkDS.CUR_KIND",
    0x0d78: "WorkDS.CUR_PARAM",
    0x0d88: "WorkDS.TARGET_PORT",
    0x0d8a: "WorkDS.TARGET_PERSON",
    0x0d8c: "WorkDS.TARGET_ITEM",
    0x0d96: "WorkDS.RAND_RANGE",
    0x0da4: "WorkDS.ROYAL_CHAP",
    0x0de8: "WorkDS.EXPLORE_MAP",
    0x1004: "DS.SEA_FLAGS",
    0x1005: "DS.SEA_FLAGS2",
    0x1006: "DS.SEA_VIEW_X",
    0x1008: "DS.SEA_VIEW_Y",
    0x100e: "WorkDS.EXPLORE_TOTAL",
    0x1010: "WorkDS.EXPLORE_UNREP",
    0x1046: "DS.EXPLORE_LOC",
    0x10a6: "DS.COOLDOWN_10A6",
    0x117a: "DS.TBL_COUNTRY",
    0x125a: "DS.TBL_HERO_DATA",
    0x12ae: "DS.MONEY",
    0x12b2: "DS.BANK_QUOTIENT",
    0x12b4: "DS.BANK_REM",
    0x12b5: "DS.HERO",
    0x12b6: "DS.TBL_PERSON",
    0x2a26: "DS.TBL_NOBLE",
    0x2bde: "DS.TBL_BARMAID",
    0x2e18: "DS.DAYS_AT_SEA",
    0x2e1b: "DS.PARTY_CREW",
    0x2e57: "DS.INVENTORY",
    0x2e76: "DS.TBL_FLEET",
    0x52d4: "DS.TBL_CREW_SLOT",
    0x5784: "DS.TBL_DOCK_SLOT",
    0x5892: "DS.TBL_SHIP",
    0x5e28: "DS.TBL_SHIP_TYPE",
    0x5f54: "DS.TBL_PORT",
    0x6a80: "DS.TBL_PORT_ECONOMY",
    0x78f4: "DS.TBL_REGION_PRICE",
    0x7f74: "DS.TBL_USED_SHIP_CACHE",
    0x7f8c: "DS.TBL_DISCOVERY",
    0x8246: "DS.DISCOVERY_ID",
    0x8248: "DS.TBL_ITEM",
    0x8a18: "DS.TRADE_LOGS",
}

# TABLE_KEY -> { off: "OFF.TABLE.FIELD" }
OFF_MAPS = {}
for t in SCHEMA["tables"]:
    tk = CLASS_METHOD[t["name"]]
    m = OFF_MAPS.setdefault(tk, {})
    for f in t["fields"]:
        fk = re.sub(r"([A-Z])", r"_\1", f["name"]).upper()
        m[f["off"]] = f"OFF.{tk}.{fk}"


def split_comment(line):
    in_str = None
    esc = False
    i = 0
    while i < len(line):
        ch = line[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == in_str:
                in_str = None
        else:
            if ch in ("'", '"', "`"):
                in_str = ch
            elif ch == "/" and i + 1 < len(line) and line[i + 1] == "/":
                return line[:i], line[i:]
        i += 1
    return line, ""


def replace_code(code, var_tables):
    n = 0

    # 1. Replace known 4-hex DS addresses (0x0ca4..0x8a18) when standalone literal
    def repl_ds(m):
        nonlocal n
        v = int(m.group(0), 16)
        if v in DS_MAP:
            n += 1
            return DS_MAP[v]
        return m.group(0)

    code = re.sub(r"\b0x[0-9a-fA-F]{4}\b", repl_ds, code)

    # 2. Replace explicit table-pointer + offset: e.g., F + 0x29 -> F + OFF.FLEET.FLAGS
    for var, tk in var_tables.items():
        omap = OFF_MAPS[tk]

        def repl_off(m):
            nonlocal n
            off = int(m.group(2), 16) if m.group(2).startswith(("0x", "0X")) else int(m.group(2))
            if off in omap:
                n += 1
                return f"{m.group(1)} + {omap[off]}"
            return m.group(0)

        # Match `VAR + 0xNN` or `VAR + N` (only when followed by `)`, `,`, ` +`, ` -`, `]`, `;`, ` `)
        pat = rf"(?<!\.)\b({re.escape(var)})\s*\+\s*(0x[0-9a-fA-F]+|\d+)\b(?!\s*\*\s*)"
        code = re.sub(pat, repl_off, code)

    return code, n


def migrate_file(path, var_tables):
    raw = open(path, encoding="utf-8").read()
    crlf = "\r\n" in raw
    lines = raw.replace("\r\n", "\n").split("\n")
    total = 0
    out = []
    for line in lines:
        c, cm = split_comment(line)
        nc, k = replace_code(c, var_tables)
        total += k
        out.append(nc + cm)
    text = "\n".join(out)

    need_ds = "DS." in text
    need_off = "OFF." in text
    need_work = "WorkDS." in text
    imports = []
    sv_syms = [s for s, flag in [("DS", need_ds), ("OFF", need_off)] if flag]
    if sv_syms and "schema_views.ts" not in text:
        imports.append(f'import {{ {", ".join(sv_syms)} }} from "../model/schema_views.ts";')
    if need_work and "WorkDS" not in text.split("import")[0] and "flags.ts" not in text:
        imports.append('import { WorkDS } from "../model/flags.ts";')
    if imports:
        # Insert after last import line, or after leading comment block
        idx = 0
        for i, l in enumerate(out):
            if l.startswith("import "):
                idx = i + 1
        if idx == 0:
            while idx < len(out) and (out[idx].startswith("//") or out[idx].strip() == ""):
                idx += 1
        out = out[:idx] + imports + out[idx:]
        text = "\n".join(out)

    open(path, "w", encoding="utf-8", newline="\r\n" if crlf else "\n").write(text)
    print(f"{path}: {total} replacements (DS={need_ds}, OFF={need_off}, WorkDS={need_work})")


if __name__ == "__main__":
    p = sys.argv[1]
    vt = dict(a.split("=") for a in sys.argv[2:])
    migrate_file(p, vt)
