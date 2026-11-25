// modern/runtime.ts — 现代网页引擎运行期控制器 (倍速 / 暂停 / 独立 BGM 与 SFX 音量持久化)

export type GameSpeed = 0 | 1 | 2 | 4;

export interface ModernSettings {
  speed: GameSpeed;
  bgmVolume: number;
  bgmMuted: boolean;
  sfxVolume: number;
  sfxMuted: boolean;
}

const SETTINGS_KEY = "uw2.settings.v2";

const DEFAULT_SETTINGS: ModernSettings = {
  speed: 1,
  bgmVolume: 0.8,
  bgmMuted: false,
  sfxVolume: 0.8,
  sfxMuted: false,
};

function readSettings(): ModernSettings {
  if (typeof window === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const p = JSON.parse(raw);
    const speed: GameSpeed = p.speed === 0 || p.speed === 1 || p.speed === 2 || p.speed === 4 ? p.speed : 1;
    return {
      speed,
      bgmVolume: typeof p.bgmVolume === "number" ? Math.max(0, Math.min(1, p.bgmVolume)) : 0.8,
      bgmMuted: !!p.bgmMuted,
      sfxVolume: typeof p.sfxVolume === "number" ? Math.max(0, Math.min(1, p.sfxVolume)) : 0.8,
      sfxMuted: !!p.sfxMuted,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export class GameRuntime {
  settings: ModernSettings;
  private lastActiveSpeed: GameSpeed = 1;
  private listeners = new Set<(s: ModernSettings) => void>();
  readonly sys: any;
  readonly bgm: any;
  readonly sfx: any;

  constructor(deps: { sys: any; bgm: any; sfx: any }) {
    this.sys = deps.sys;
    this.bgm = deps.bgm;
    this.sfx = deps.sfx;
    this.settings = readSettings();
    if (this.settings.speed > 0) this.lastActiveSpeed = this.settings.speed;
    this.applyAll();
  }

  private persist(): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch { /* ignore quota */ }
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.settings);
  }

  subscribe(fn: (s: ModernSettings) => void): () => void {
    this.listeners.add(fn);
    fn(this.settings);
    return () => this.listeners.delete(fn);
  }

  private applyAll(): void {
    if (this.sys) this.sys.timeScale = this.settings.speed;
    this.bgm?.setVolume?.(this.settings.bgmVolume);
    this.bgm?.setMuted?.(this.settings.bgmMuted);
    this.sfx?.setVolume?.(this.settings.sfxVolume);
    this.sfx?.setMuted?.(this.settings.sfxMuted);
  }

  setSpeed(speed: GameSpeed): void {
    if (speed > 0) this.lastActiveSpeed = speed;
    this.settings = { ...this.settings, speed };
    if (this.sys) this.sys.timeScale = speed;
    this.persist();
    this.emit();
  }

  togglePause(): void {
    this.setSpeed(this.settings.speed === 0 ? this.lastActiveSpeed : 0);
  }

  setBgmVolume(v: number): void {
    const bgmVolume = Math.max(0, Math.min(1, v));
    this.settings = { ...this.settings, bgmVolume, bgmMuted: bgmVolume === 0 ? true : false };
    this.bgm?.setVolume?.(bgmVolume);
    this.bgm?.setMuted?.(this.settings.bgmMuted);
    this.persist();
    this.emit();
  }

  toggleBgmMute(): void {
    const bgmMuted = !this.settings.bgmMuted;
    this.settings = { ...this.settings, bgmMuted };
    this.bgm?.setMuted?.(bgmMuted);
    this.persist();
    this.emit();
  }

  setSfxVolume(v: number): void {
    const sfxVolume = Math.max(0, Math.min(1, v));
    this.settings = { ...this.settings, sfxVolume, sfxMuted: sfxVolume === 0 ? true : false };
    this.sfx?.setVolume?.(sfxVolume);
    this.sfx?.setMuted?.(this.settings.sfxMuted);
    this.persist();
    this.emit();
  }

  toggleSfxMute(): void {
    const sfxMuted = !this.settings.sfxMuted;
    this.settings = { ...this.settings, sfxMuted };
    this.sfx?.setMuted?.(sfxMuted);
    this.persist();
    this.emit();
  }
}
