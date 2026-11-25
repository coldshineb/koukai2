// ui/legacy_presenter.ts — 原版 640×400 渲染管线的 IGameUI / IScenarioHost 适配器
import type { IGameUI, IScenarioHost, ScenarioWindowDef } from "./protocol.ts";
import { DS } from "../model/schema_views.ts";
import { GameConst } from "../model/flags.ts";

/** 桥接现有 ctx (Screen / WindowSystem / MenuSystem / NumPad / ListSelect) */
export class LegacyGameUI implements IGameUI {
  readonly c: any;
  scene: any;
  constructor(ctx: any, scene?: any) {
    this.c = ctx;
    this.scene = scene ?? null;
  }
  showMessage(msgId: number, ...args: unknown[]): void {
    this.c.message(msgId, ...args);
  }
  async waitPrompt(): Promise<void> {
    await this.c.menu.waitPrompt();
  }
  async confirmYesNo(): Promise<boolean> {
    return !!(await this.c.menu.yesNo());
  }
  async selectMenu(x: number, y: number, items: Uint8Array[], cancelable: number): Promise<number> {
    return this.c.menu.listMenu(x, y, items, cancelable);
  }
  async selectList(kind: number, count: number): Promise<number> {
    return this.c.listSel.select(kind, count);
  }
  async inputNumber(min: number, max: number): Promise<number> {
    return this.c.numpad.input(min, max);
  }
  async fadeBlack(): Promise<void> {
    await this.c.palette.fadeBlack();
  }
  async fadeToTarget(): Promise<void> {
    await this.c.palette.fadeToTarget();
  }
  playMusic(song: number): void {
    this.c.bgm.playSong(song);
  }
  refreshPanels(): void {
    this.scene?.panels?.();
  }
}

export interface LegacyScenarioDeps {
  runDuel: (scenario: any, person: number) => Promise<void>;
  triggerEnding: (scene: any, code: number) => Promise<void>;
}

/** 剧本 VM 的原版 640×400 宿主实现 (100% 保持原版逐像素与随机数行为) */
export class LegacyScenarioHost implements IScenarioHost {
  readonly c: any;
  readonly getScene: () => any;
  readonly deps: LegacyScenarioDeps;

  constructor(ctx: any, getScene: () => any, deps: LegacyScenarioDeps) {
    this.c = ctx;
    this.getScene = getScene;
    this.deps = deps;
  }
  clearWindowText(w: ScenarioWindowDef): void {
    this.c.scr.fillCols(w.textX, w.textY, w.textW, w.textH, 7);
  }
  selectWindow(w: ScenarioWindowDef, textColor: Uint8Array): void {
    const { con } = this.c;
    con.left = w.textX;
    con.right = w.textW + w.textX - 2;
    con.setCursor(w.textX, w.textY);
    this.clearWindowText(w);
    con.puts(textColor);
  }
  openWindow(id: number, w: ScenarioWindowDef): void {
    const { win } = this.c;
    if (id !== 0) win.save(w.x, w.y, w.w, w.h);
    win.frame(w.x, w.y, w.w, w.h, 0);
  }
  async closeWindow(id: number, w: ScenarioWindowDef): Promise<void> {
    if (id !== 0) await this.c.win.close();
    else this.clearWindowText(w);
  }
  drawFace(faceId: number, w: ScenarioWindowDef): void {
    this.c.kao.drawNamed(this.c.scr, faceId & 0xff, w.faceX, w.faceY);
  }
  showText(bytes: Uint8Array): void {
    this.c.con.puts(bytes);
  }
  async waitKey(): Promise<void> {
    await this.c.menu.waitPrompt();
  }
  async selectMenu(items: Uint8Array[]): Promise<number> {
    return this.c.menu.listMenu(0x3c, 0x50, items, 0);
  }
  async confirmYesNo(): Promise<boolean> {
    return !!(await this.c.menu.yesNo());
  }
  playMusic(song: number): void {
    this.c.bgm.playSong(song);
  }
  async showPicture(x: number, y: number, pic: number): Promise<void> {
    const { graph, state } = this.c;
    const name = this.c.eventFile ?? `EVENT${state.hero + 1}.DAT`;
    const g = await graph.ensure(this.c.ASSETS, name, "event/" + name);
    g.draw(this.c.scr.fb, pic, x, y);
    this.c.scr.dirty = true;
    graph.useFile("GRAPH.DAT");
  }
  refreshPanels(): void {
    if (this.c.state.u8(DS.PORT) !== GameConst.EMPTY_SLOT) this.getScene()?.panels?.();
  }
  recalcFleetStrength(fleetAddr: number): boolean {
    const ai = this.getScene()?.ai;
    if (!ai) return false;
    ai.strength(fleetAddr);
    return true;
  }
  resumeFleet(fleetAddr: number): boolean {
    const ai = this.getScene()?.ai;
    if (!ai) return false;
    ai.resume(fleetAddr);
    return true;
  }
  async runDuel(scenario: any, person: number): Promise<void> {
    await this.deps.runDuel(scenario, person);
  }
  async triggerEnding(code: number): Promise<void> {
    await this.deps.triggerEnding(this.getScene(), code & 0xff);
  }
}
