// ui/shell.ts — 阶段 4 现代高清 DOM/CSS 壳层 (倍速 / 暂停 / 独立音量 / 存盘管理 / 全屏幕)
import type { GameRuntime, GameSpeed } from "../core/runtime.ts";
import { ModernSaveModal } from "./save_modal.ts";
import type { SaveModalBridge } from "./save_modal.ts";
import { openTutorialModal } from "./tutorial_modal.ts";
import { closeExpeditionWindow } from "./expedition_window.ts";

export interface ModernShellDeps {
  runtime: GameRuntime;
  saveBridge: Omit<SaveModalBridge, "onToast">;
  expeditionEnabled?: boolean;
  onToggleExpedition?: () => void;
}

export class ModernShell {
  readonly runtime: GameRuntime;
  readonly saveModal: ModernSaveModal;
  readonly overlay: HTMLElement;
  private pauseBadge: HTMLElement;
  private expeditionBtn: HTMLButtonElement | null = null;
  private expeditionEnabled = false;
  private onToggleExpedition: (() => void) | null = null;
  private toastTimer: number | null = null;
  private toastEl: HTMLElement | null = null;

  constructor(deps: ModernShellDeps) {
    this.runtime = deps.runtime;
    this.expeditionEnabled = Boolean(deps.expeditionEnabled);
    this.onToggleExpedition = deps.onToggleExpedition ?? null;
    this.overlay = document.getElementById("uw2-overlay") as HTMLElement;
    this.saveModal = new ModernSaveModal({
      ...deps.saveBridge,
      onToast: msg => this.showToast(msg),
    });

    this.pauseBadge = document.createElement("div");
    this.pauseBadge.className = "uw2-pause-badge";
    this.pauseBadge.textContent = "已暂停";
    this.pauseBadge.style.display = "none";
    document.getElementById("uw2-stage")?.appendChild(this.pauseBadge);

    this.mountTopbar();
    this.bindHotkeys();
  }

  private mountTopbar(): void {
    const bar = document.getElementById("uw2-topbar");
    if (!bar) return;

    const brand = document.createElement("div");
    brand.className = "uw2-brand";
    brand.textContent = "大航海时代 II";

    const controls = document.createElement("div");
    controls.className = "uw2-controls";

    // 倍速控制组
    const speedGroup = document.createElement("div");
    speedGroup.className = "uw2-group";
    const speedButtons = new Map<GameSpeed, HTMLButtonElement>();
    const speedSpecs: Array<[GameSpeed, string]> = [[0, "暂停"], [1, "1×"], [2, "2×"], [4, "4×"]];
    for (const [sp, label] of speedSpecs) {
      const btn = document.createElement("button");
      btn.className = "uw2-btn";
      btn.textContent = label;
      btn.addEventListener("click", () => this.runtime.setSpeed(sp));
      speedButtons.set(sp, btn);
      speedGroup.appendChild(btn);
    }

    // BGM 独立音量
    const bgmWrap = document.createElement("div");
    bgmWrap.className = "uw2-slider-wrap";
    const bgmMute = document.createElement("button");
    bgmMute.className = "uw2-btn";
    bgmMute.textContent = "音乐";
    bgmMute.addEventListener("click", () => this.runtime.toggleBgmMute());
    const bgmSlider = document.createElement("input");
    bgmSlider.type = "range"; bgmSlider.min = "0"; bgmSlider.max = "100"; bgmSlider.className = "uw2-slider";
    bgmSlider.addEventListener("input", () => this.runtime.setBgmVolume(Number(bgmSlider.value) / 100));
    bgmWrap.append(bgmMute, bgmSlider);

    // SFX 独立音量
    const sfxWrap = document.createElement("div");
    sfxWrap.className = "uw2-slider-wrap";
    const sfxMute = document.createElement("button");
    sfxMute.className = "uw2-btn";
    sfxMute.textContent = "音效";
    sfxMute.addEventListener("click", () => this.runtime.toggleSfxMute());
    const sfxSlider = document.createElement("input");
    sfxSlider.type = "range"; sfxSlider.min = "0"; sfxSlider.max = "100"; sfxSlider.className = "uw2-slider";
    sfxSlider.addEventListener("input", () => this.runtime.setSfxVolume(Number(sfxSlider.value) / 100));
    sfxWrap.append(sfxMute, sfxSlider);

    // 存盘管理与全屏幕
    const utilGroup = document.createElement("div");
    utilGroup.className = "uw2-group";

    const tutBtn = document.createElement("button");
    tutBtn.className = "uw2-btn";
    tutBtn.textContent = "航海教程";
    tutBtn.addEventListener("click", () => { void openTutorialModal(); });

    const expBtn = document.createElement("button");
    expBtn.className = "uw2-btn uw2-btn-exp";
    expBtn.textContent = "航海统筹";
    expBtn.title = "打开独立航海统筹浮窗 (F8)";
    expBtn.style.display = this.expeditionEnabled ? "inline-flex" : "none";
    expBtn.addEventListener("click", () => this.onToggleExpedition?.());
    this.expeditionBtn = expBtn;

    const saveBtn = document.createElement("button");
    saveBtn.className = "uw2-btn uw2-btn-primary";
    saveBtn.textContent = "存档管理";
    saveBtn.addEventListener("click", () => this.saveModal.open());

    const fsBtn = document.createElement("button");
    fsBtn.className = "uw2-btn";
    fsBtn.textContent = "全屏";
    fsBtn.addEventListener("click", () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
      else document.exitFullscreen?.().catch(() => {});
    });

    utilGroup.append(expBtn, tutBtn, saveBtn, fsBtn);
    controls.append(speedGroup, bgmWrap, sfxWrap, utilGroup);
    bar.replaceChildren(brand, controls);

    this.runtime.subscribe(s => {
      for (const [sp, btn] of speedButtons) btn.classList.toggle("active", s.speed === sp);
      this.pauseBadge.style.display = s.speed === 0 ? "block" : "none";
      bgmMute.classList.toggle("active", !s.bgmMuted);
      bgmSlider.value = String(Math.round((s.bgmMuted ? 0 : s.bgmVolume) * 100));
      sfxMute.classList.toggle("active", !s.sfxMuted);
      sfxSlider.value = String(Math.round((s.sfxMuted ? 0 : s.sfxVolume) * 100));
    });
  }

  syncExpeditionTool(enabled: boolean): void {
    this.expeditionEnabled = enabled;
    if (this.expeditionBtn) {
      this.expeditionBtn.style.display = enabled ? "inline-flex" : "none";
    }
    if (!enabled) closeExpeditionWindow();
  }

  private bindHotkeys(): void {
    window.addEventListener("keydown", e => {
      const blocked = document.body.dataset.uw2Modal === "open" || document.body.dataset.uw2DialogChoice === "open";
      if (e.key === "F8" && this.expeditionEnabled && !blocked) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.onToggleExpedition?.();
        return;
      }
      if (blocked) return;
      if (!e.altKey) return;
      if (e.code === "KeyP") { e.preventDefault(); this.runtime.togglePause(); }
      else if (e.code === "Digit1") { e.preventDefault(); this.runtime.setSpeed(1); }
      else if (e.code === "Digit2") { e.preventDefault(); this.runtime.setSpeed(2); }
      else if (e.code === "Digit4") { e.preventDefault(); this.runtime.setSpeed(4); }
    }, true);
  }

  showToast(msg: string, ms = 2400): void {
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    if (!this.toastEl) {
      this.toastEl = document.createElement("div");
      this.toastEl.className = "uw2-toast";
      document.body.appendChild(this.toastEl);
    }
    this.toastEl.textContent = msg;
    this.toastTimer = window.setTimeout(() => {
      this.toastEl?.remove();
      this.toastEl = null;
      this.toastTimer = null;
    }, ms);
  }
}
