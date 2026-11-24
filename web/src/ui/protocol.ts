// ui/protocol.ts — 語意化 UI 與劇本宿主互動介面 (解耦業務邏輯與 640×400 / 現代高清渲染)

export interface ScenarioWindowDef {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly textX: number;
  readonly textY: number;
  readonly textW: number;
  readonly textH: number;
  readonly faceX: number;
  readonly faceY: number;
}

/**
 * 通用語意化遊戲 UI 介面:
 * - 階段 2–3 由 LegacyGameUI 實作 (對接原版 640×400 幀緩衝, 通過全部原版差分回歸)
 * - 階段 4–5 由 ModernGameUI 實作 (對接現代高清 DOM/CSS + Canvas)
 */
export interface IGameUI {
  showMessage(msgId: number, ...args: unknown[]): void;
  waitPrompt(): Promise<void>;
  confirmYesNo(): Promise<boolean>;
  selectMenu(x: number, y: number, items: Uint8Array[], cancelable: number): Promise<number>;
  selectList(kind: number, count: number): Promise<number>;
  inputNumber(min: number, max: number): Promise<number>;
  fadeBlack(): Promise<void>;
  fadeToTarget(): Promise<void>;
  playMusic(song: number): void;
  refreshPanels(): void;
}

/**
 * 劇本 VM (game/scenario.js) 與宿主引擎之間的橋接介面:
 * 使 snr0..6.json 劇本直譯器完全不直接依賴像素幀緩衝或特定場景實作。
 */
export interface IScenarioHost {
  openWindow(id: number, def: ScenarioWindowDef): void;
  closeWindow(id: number, def: ScenarioWindowDef): Promise<void>;
  clearWindowText(def: ScenarioWindowDef): void;
  selectWindow(def: ScenarioWindowDef, textColor: Uint8Array): void;
  drawFace(faceId: number, def: ScenarioWindowDef): void;
  showText(bytes: Uint8Array): void;
  waitKey(): Promise<void>;
  selectMenu(items: Uint8Array[]): Promise<number>;
  confirmYesNo(): Promise<boolean>;
  playMusic(song: number): void;
  showPicture(x: number, y: number, pic: number): Promise<void>;
  refreshPanels(): void;
  recalcFleetStrength(fleetAddr: number): boolean;
  resumeFleet(fleetAddr: number): boolean;
  runDuel(scenario: unknown, person: number): Promise<void>;
  triggerEnding(code: number): Promise<void>;
}
