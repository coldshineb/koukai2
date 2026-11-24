// modern/scenario_host.ts — 階段 5 現代高清劇情對話宿主 (實作 IScenarioHost)
// 保留原版事件插圖 (EVENT*.DAT)、一騎打、音樂與結局，將劇情對話視窗、頭像、選單與是/否改以現代高清羊皮紙卡片呈現。
import type { IScenarioHost, ScenarioWindowDef } from "../ui/protocol.ts";
import { DS } from "../model/schema_views.ts";
import { GameConst } from "../model/flags.ts";

export interface ModernScenarioDeps {
  runDuel: (scenario: any, person: number) => Promise<void>;
  triggerEnding: (scene: any, code: number) => Promise<void>;
}

export class ModernScenarioHost implements IScenarioHost {
  readonly c: any;
  readonly root: HTMLElement;
  readonly getScene: () => any;
  readonly deps: ModernScenarioDeps;

  private cardEl: HTMLElement | null = null;
  private textEl: HTMLElement | null = null;
  private portraitImg: HTMLImageElement | null = null;
  private buffer = "";
  private activePictureWin = false;

  constructor(ctx: any, root: HTMLElement, getScene: () => any, deps: ModernScenarioDeps) {
    this.c = ctx;
    this.root = root;
    this.getScene = getScene;
    this.deps = deps;
  }

  private decodeBytes(bytes: Uint8Array): string {
    if (!this.c?.codec) return "";
    let end = bytes.indexOf(0);
    if (end < 0) end = bytes.length;
    return this.c.codec.decode(bytes.subarray(0, end)).replace(/\{[0-9A-F]{2}\}/g, "").trim();
  }

  private ensureCard(): void {
    if (this.cardEl) return;
    const card = document.createElement("div");
    card.className = "uw2-card uw2-scenario-card";

    const img = document.createElement("img");
    img.className = "uw2-portrait-canvas";
    img.alt = "";
    img.style.display = "none";

    const body = document.createElement("div");
    body.className = "uw2-scenario-body";

    const text = document.createElement("div");
    text.className = "uw2-dialog-text";

    body.appendChild(text);
    card.append(img, body);
    this.root.appendChild(card);

    this.cardEl = card;
    this.textEl = text;
    this.portraitImg = img;
  }

  private destroyCard(): void {
    this.cardEl?.remove();
    this.cardEl = null;
    this.textEl = null;
    this.portraitImg = null;
    this.buffer = "";
  }

  openWindow(id: number, w: ScenarioWindowDef): void {
    // 視窗 3 為劇情插圖大框 (EVENT*.DAT)，照原版在主 Canvas 繪製外框
    if (id === 3) {
      this.activePictureWin = true;
      this.c.win.save(w.x, w.y, w.w, w.h);
      this.c.win.frame(w.x, w.y, w.w, w.h, 0);
      return;
    }
    this.ensureCard();
  }

  async closeWindow(id: number, _w: ScenarioWindowDef): Promise<void> {
    if (id === 3 && this.activePictureWin) {
      this.activePictureWin = false;
      await this.c.win.close();
      return;
    }
    this.destroyCard();
  }

  clearWindowText(_w: ScenarioWindowDef): void {
    this.buffer = "";
    if (this.textEl) this.textEl.textContent = "";
  }

  selectWindow(_w: ScenarioWindowDef, _textColor: Uint8Array): void {
    this.ensureCard();
    this.clearWindowText(_w);
  }

  drawFace(faceId: number, _w: ScenarioWindowDef): void {
    this.ensureCard();
    const img = this.portraitImg;
    if (!img) return;
    const url = this.c?.art?.portraitUrl?.(faceId & 0xff);
    if (url) {
      img.src = url;
      img.style.display = "block";
    } else {
      img.style.display = "none";
    }
  }

  showText(bytes: Uint8Array): void {
    this.ensureCard();
    const s = this.decodeBytes(bytes);
    if (!s) return;
    this.buffer = this.buffer ? this.buffer + "\n" + s : s;
    if (this.textEl) this.textEl.textContent = this.buffer;
  }

  waitKey(): Promise<void> {
    this.ensureCard();
    return new Promise(resolve => {
      document.body.dataset.uw2Modal = "open";
      const body = this.cardEl?.querySelector(".uw2-scenario-body");
      const actions = document.createElement("div");
      actions.className = "uw2-dialog-actions";
      const ok = document.createElement("button");
      ok.className = "uw2-btn uw2-btn-primary";
      ok.textContent = "继续";
      actions.appendChild(ok);
      body?.appendChild(actions);

      const finish = () => {
        window.removeEventListener("keydown", onKey);
        actions.remove();
        delete document.body.dataset.uw2Modal;
        resolve();
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " " || e.key === "Escape") { e.preventDefault(); finish(); }
      };
      ok.addEventListener("click", finish);
      window.addEventListener("keydown", onKey);
      ok.focus();
    });
  }

  selectMenu(items: Uint8Array[]): Promise<number> {
    const labels = items.map(it => this.decodeBytes(it));
    return this.c.modernUI.selectMenuLabels(labels, false);
  }

  confirmYesNo(): Promise<boolean> {
    return this.c.modernUI.confirmYesNo("");
  }

  playMusic(song: number): void {
    this.c.bgm.playSong(song);
  }

  async showPicture(x: number, y: number, pic: number): Promise<void> {
    const { graph, state } = this.c;
    const name = this.c.eventFile ?? `EVENT${state.hero + 1}.DAT`;
    await graph.ensure(this.c.ASSETS, name, "event/" + name);
    graph.drawFrom(name, pic, x, y);
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
    this.destroyCard();
    await this.deps.runDuel(scenario, person);
  }

  async triggerEnding(code: number): Promise<void> {
    this.destroyCard();
    await this.deps.triggerEnding(this.getScene(), code & 0xff);
  }
}
