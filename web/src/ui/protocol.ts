// ui/protocol.ts — 语意化 UI 与剧本宿主交互界面 (解耦业务逻辑与 640×400 / 现代高清渲染)

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
 * 通用语意化游戏 UI 界面:
 * - 阶段 2–3 由 LegacyGameUI 实现 (对接原版 640×400 帧缓冲, 通过全部原版差分回归)
 * - 阶段 4–5 由 ModernGameUI 实现 (对接现代高清 DOM/CSS + Canvas)
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
 * 剧本 VM (game/scenario.js) 与宿主引擎之间的桥接界面:
 * 使 snr0..6.json 剧本解释器完全不直接依赖像素帧缓冲或特定场景实现。
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
