// save/format.ts — 現代 JSON 存檔格式 (uw2-save-v2)
// 特色:
//   - 以具名業務欄位 (globals / tables) 儲存遊戲狀態，不含雜亂的 u_xx 十六進位欄位
//   - 支援完整存檔摘要 (主角、日期、港口、資金、現實保存時間) 與自動存檔槽
//   - 階段 3–4 過渡期可選擇攜帶 _compat 以達成與原版位元組 100% 無損往返；
//     純語意 JSON (不含 _compat) 亦可直接套疊於新遊戲初值 (baseState) 載入遊玩。
import { decodeState, encodeState } from "../game/data.js";
import { DS } from "../model/schema_views.ts";
import { GameConst } from "../model/flags.ts";

export const SAVE_FORMAT_V2 = "uw2-save-v2" as const;
export const SAVE_VERSION_V2 = 2 as const;
export const SAVE_SLOTS_COUNT = 10;

export interface SaveSlotSummary {
  heroId: number;
  heroName: string;
  dateStr: string;
  year: number;
  month: number;
  day: number;
  time: number;
  portId: number;
  portName: string;
  money: number;
  flag: number;
  savedAt: string;
}

export interface SaveCompatLayer {
  sourceLength: number;
  gaps: Record<string, string>;
  tail: string;
  /** 每個表中尚未具名化的殘留位元組 (僅供階段 3–4 與原版引擎逐位元組相容) */
  unknownFields?: Record<string, Record<number, Record<string, string>>>;
}

export interface SaveStateV2 {
  globals: Record<string, number>;
  tables: Record<string, Record<string, unknown>[]>;
  _compat?: SaveCompatLayer;
}

export interface SaveSlotV2 {
  slotIndex: number | "auto";
  summary: SaveSlotSummary;
  /** 原版 15 bytes 標頭 (供階段 3–4 原版 640×400 讀檔列表顯示用) */
  headerHex?: string;
  state: SaveStateV2;
}

export interface SaveBundleV2 {
  format: typeof SAVE_FORMAT_V2;
  version: typeof SAVE_VERSION_V2;
  heroId: number;
  updatedAt: string;
  slots: Array<SaveSlotV2 | null>;
  autoSave?: SaveSlotV2 | null;
}

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

function hexToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

/** 遞迴分離具名欄位與 u_xx / *Tail 原版殘留欄位 */
function splitRecordUnknowns(
  rec: Record<string, unknown>,
  prefix = "",
  unkOut: Record<string, string> = {},
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    if ((k.startsWith("u_") || k.endsWith("Tail")) && typeof v === "string") {
      unkOut[prefix + k] = v;
    } else if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0] !== null) {
      clean[k] = v.map((item, idx) =>
        splitRecordUnknowns(item as Record<string, unknown>, `${prefix}${k}[${idx}].`, unkOut),
      );
    } else {
      clean[k] = v;
    }
  }
  return clean;
}

/** 遞迴將 _compat 中的殘留欄位合併回記錄 */
function mergeRecordUnknowns(
  clean: Record<string, unknown>,
  unk: Record<string, string> | undefined,
  prefix = "",
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(clean)) {
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0] !== null) {
      out[k] = v.map((item, idx) =>
        mergeRecordUnknowns(item as Record<string, unknown>, unk, `${prefix}${k}[${idx}].`),
      );
    } else {
      out[k] = v;
    }
  }
  if (unk) {
    for (const [uk, uv] of Object.entries(unk)) {
      if (uk.startsWith(prefix)) {
        const rest = uk.slice(prefix.length);
        if (!rest.includes(".") && !rest.includes("[")) out[rest] = uv;
      }
    }
  }
  return out;
}

/** 將 0x8074 bytes 遊戲狀態轉換為現代 uw2-save-v2 具名狀態物件 */
export function stateBytesToV2(
  bytes: Uint8Array,
  schema: any,
  codec: any,
  opts: { includeCompat?: boolean } = {},
): SaveStateV2 {
  const includeCompat = opts.includeCompat ?? true;
  const raw: any = decodeState(bytes, schema, codec);
  const tables: Record<string, Record<string, unknown>[]> = {};
  const unknownFields: Record<string, Record<number, Record<string, string>>> = {};

  for (const [tName, rows] of Object.entries(raw.tables as Record<string, Record<string, unknown>[]>)) {
    const cleanRows: Record<string, unknown>[] = [];
    for (let i = 0; i < rows.length; i++) {
      const unk: Record<string, string> = {};
      cleanRows.push(splitRecordUnknowns(rows[i], "", unk));
      if (includeCompat && Object.keys(unk).length > 0) {
        (unknownFields[tName] ??= {})[i] = unk;
      }
    }
    tables[tName] = cleanRows;
  }

  const out: SaveStateV2 = { globals: { ...raw.globals }, tables };
  if (includeCompat) {
    out._compat = {
      sourceLength: raw.sourceLength,
      gaps: raw.gaps,
      tail: raw.tail,
      ...(Object.keys(unknownFields).length > 0 ? { unknownFields } : {}),
    };
  }
  return out;
}

/** 將 uw2-save-v2 狀態物件還原為 0x8074 bytes (供階段 3–4 執行期使用) */
export function v2ToStateBytes(
  v2: SaveStateV2,
  schema: any,
  codec: any,
  baseStateBytes?: Uint8Array,
): Uint8Array {
  // 若無 _compat (純語意 JSON 存檔), 以 baseStateBytes (world.json 初值) 作為底層填充
  let compat = v2._compat;
  if (!compat) {
    if (!baseStateBytes) throw new Error("v2ToStateBytes: pure uw2-save-v2 requires baseStateBytes");
    const baseV2 = stateBytesToV2(baseStateBytes, schema, codec, { includeCompat: true });
    compat = baseV2._compat!;
  }

  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const [tName, rows] of Object.entries(v2.tables)) {
    const tUnk = compat.unknownFields?.[tName];
    tables[tName] = rows.map((row, i) => mergeRecordUnknowns(row, tUnk?.[i]));
  }

  const doc = {
    format: "uw2-state-1",
    sourceLength: compat.sourceLength,
    globals: v2.globals,
    tables,
    gaps: compat.gaps,
    tail: compat.tail,
  };
  return encodeState(doc, schema, codec);
}

/** 從具名狀態建立可讀存檔摘要 */
export function buildSaveSummary(
  state: SaveStateV2,
  header15?: Uint8Array,
  savedAt: string = new Date().toISOString(),
): SaveSlotSummary {
  const g = state.globals;
  const heroId = (g.hero ?? 0) & 0xff;
  const persons = state.tables.persons ?? [];
  const heroRec = persons[heroId] as Record<string, unknown> | undefined;
  const given = typeof heroRec?.givenName === "string" ? heroRec.givenName : "";
  const family = typeof heroRec?.familyName === "string" ? heroRec.familyName : "";
  const heroName = (given && family ? `${given} ${family}` : given || family).trim();

  const year = 1500 + ((g.year ?? 0) & 0xff);
  const month = ((g.month ?? 0) & 0xff) + 1;
  const day = ((g.day ?? 0) & 0xff) + 1;
  const time = (g.time ?? 0) & 0xff;
  const portId = header15 ? header15[12] : ((g.port ?? GameConst.EMPTY_SLOT) & 0xff);
  const flag = header15 ? header15[13] : 0;

  let portName = "海上";
  if (portId !== GameConst.EMPTY_SLOT) {
    const ports = state.tables.ports ?? [];
    const pRec = ports[portId] as Record<string, unknown> | undefined;
    portName = typeof pRec?.name === "string" && pRec.name ? pRec.name : `Port #${portId}`;
  }

  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return {
    heroId,
    heroName,
    dateStr,
    year,
    month,
    day,
    time,
    portId,
    portName,
    money: (g.money ?? 0) | 0,
    flag,
    savedAt,
  };
}

/** 封裝單一存檔槽為 SaveSlotV2 */
export function createSaveSlotV2(
  slotIndex: number | "auto",
  stateBytes: Uint8Array,
  header15: Uint8Array | undefined,
  schema: any,
  codec: any,
  opts: { includeCompat?: boolean; savedAt?: string } = {},
): SaveSlotV2 {
  const state = stateBytesToV2(stateBytes, schema, codec, { includeCompat: opts.includeCompat ?? true });
  const summary = buildSaveSummary(state, header15, opts.savedAt);
  return {
    slotIndex,
    summary,
    ...(header15 ? { headerHex: bytesToHex(header15.subarray(0, 15)) } : {}),
    state,
  };
}

/** 從 SaveSlotV2 重建原版 15 bytes 標頭 (供原版 640×400 介面顯示) */
export function slotV2ToLegacyHeader(slot: SaveSlotV2 | null): Uint8Array {
  const out = new Uint8Array(15);
  if (!slot) return out;
  if (slot.headerHex && slot.headerHex.length === 30) {
    out.set(hexToBytes(slot.headerHex));
    return out;
  }
  const s = slot.summary;
  const d = s.day, m = s.month, y = s.year;
  const str = `${d < 10 ? " " : ""}${d}/${m < 10 ? " " : ""}${m}/${y}`;
  for (let i = 0; i < 11 && i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  out[12] = s.portId & 0xff;
  out[13] = s.flag & 0xff;
  return out;
}

export function createEmptyBundleV2(heroId = 0): SaveBundleV2 {
  return {
    format: SAVE_FORMAT_V2,
    version: SAVE_VERSION_V2,
    heroId: heroId & 0xff,
    updatedAt: new Date().toISOString(),
    slots: Array.from({ length: SAVE_SLOTS_COUNT }, () => null),
    autoSave: null,
  };
}

export function isSaveBundleV2(obj: unknown): obj is SaveBundleV2 {
  if (!obj || typeof obj !== "object") return false;
  const b = obj as Record<string, unknown>;
  return b.format === SAVE_FORMAT_V2 && b.version === SAVE_VERSION_V2 && Array.isArray(b.slots);
}

/** 驗證並標準化外部 JSON 存檔 (支援整包 SaveBundleV2 或單一 SaveSlotV2) */
export function parseSaveJsonV2(text: string): SaveBundleV2 | SaveSlotV2 {
  const parsed = JSON.parse(text);
  if (isSaveBundleV2(parsed)) {
    const slots: Array<SaveSlotV2 | null> = Array.from({ length: SAVE_SLOTS_COUNT }, (_, i) => parsed.slots[i] ?? null);
    return { ...parsed, slots };
  }
  if (parsed && typeof parsed === "object" && parsed.state && parsed.summary) {
    return parsed as SaveSlotV2;
  }
  throw new Error("不支援的 JSON 存檔格式 (預期 uw2-save-v2)");
}

export function getHeroFromStateBytes(stateBytes: Uint8Array): number {
  return stateBytes[DS.HERO - DS.STATE_BASE] & 0xff;
}
