// core/prefs.ts — 跨存档全局用户偏好与复刻扩展开关 (保存于 localStorage "uw2.prefs.v1")
// 所有「原版限制解除 / Bug 修复」开关默认全部关闭，以确保默认游玩及 tools/emu 差分测试与原版 100% 一致。
import { GameConst } from "../model/flags.ts";

export type BgmPackId = "ps1" | "cd30";

export interface UserPrefs {
  bgmPack: BgmPackId;
  unlock1552: boolean;
  unlockCashCap: boolean;
  fixItemShopNight: boolean;
  fixPalaceHeroCaptain: boolean;
  fixScoutSpeedArgs: boolean;
}

export const PREFS_STORAGE_KEY = "uw2.prefs.v1";

export const DEFAULT_PREFS: Readonly<UserPrefs> = Object.freeze({
  bgmPack: "ps1",
  unlock1552: false,
  unlockCashCap: false,
  fixItemShopNight: false,
  fixPalaceHeroCaptain: false,
  fixScoutSpeedArgs: false,
});

export function createDefaultPrefs(): UserPrefs {
  return { ...DEFAULT_PREFS };
}

export function loadPrefs(): UserPrefs {
  const out = createDefaultPrefs();
  if (typeof localStorage === "undefined") return out;
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return out;
    const parsed = JSON.parse(raw) as Partial<UserPrefs>;
    if (parsed.bgmPack === "ps1" || parsed.bgmPack === "cd30") out.bgmPack = parsed.bgmPack;
    out.unlock1552 = Boolean(parsed.unlock1552);
    out.unlockCashCap = Boolean(parsed.unlockCashCap);
    out.fixItemShopNight = Boolean(parsed.fixItemShopNight);
    out.fixPalaceHeroCaptain = Boolean(parsed.fixPalaceHeroCaptain);
    out.fixScoutSpeedArgs = Boolean(parsed.fixScoutSpeedArgs);
  } catch {
    // 忽略损坏的本地存储
  }
  return out;
}

export function savePrefs(prefs: UserPrefs): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // 忽略容量限制等写入错误
  }
}

/** 取得当前规则下的现金硬上限：默认 6 亿，开启 unlockCashCap 时放宽至 20 亿 (有符号 i32 安全范围) */
export function getCashCap(ctx: { prefs?: Partial<UserPrefs> } | null | undefined): number {
  return ctx?.prefs?.unlockCashCap ? GameConst.MAX_CASH_UNLOCKED : GameConst.MAX_CASH;
}

/** 将现金变动钳位到 [0, getCashCap(ctx)]（使用浮点加法避免 i32 位运算提前溢出） */
export function addCashClamped(curCash: number, delta: number, ctx: { prefs?: Partial<UserPrefs> } | null | undefined): number {
  const cap = getCashCap(ctx);
  const next = curCash + delta;
  return next > cap ? cap : next | 0;
}

export interface RuleToggleMeta {
  key: Exclude<keyof UserPrefs, "bgmPack">;
  label: string;
  hint: string;
}

export const RULE_TOGGLES: readonly RuleToggleMeta[] = [
  {
    key: "unlock1552",
    label: "解除 1552 年结档",
    hint: "跨越 1552 年底时不触发强制退休结局，可继续无限年航海",
  },
  {
    key: "unlockCashCap",
    label: "放宽现金硬上限",
    hint: "将随身现金上限由 6 亿提升至 20 亿金币",
  },
  {
    key: "fixItemShopNight",
    label: "修复道具店夜市问候",
    hint: "改为在真实夜市营业时段 (凌晨 2:00–3:00) 触发特殊夜市问候",
  },
  {
    key: "fixPalaceHeroCaptain",
    label: "修复王宫援船船长判定",
    hint: "不再因空船位初值 0 误判约翰已任船长，使王宫援助船计入其可用船长",
  },
  {
    key: "fixScoutSpeedArgs",
    label: "修复侦察船速参数顺序",
    hint: "纠正侦察情报计算船速时风向/风力与海流方向/强度传反的原版缺陷",
  },
];
