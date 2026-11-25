// modern/scenario_host.ts — 阶段 5 现代高清剧情对话宿主 (实现 IScenarioHost)
// 保留原版事件插图 (EVENT*.DAT)、一骑打、音乐与结局，将剧情对话窗口、头像、菜单与是/否改以现代高清羊皮纸卡片呈现。
import type { IScenarioHost, ScenarioWindowDef } from "../ui/dos/protocol.ts";
import { DS } from "../model/schema_views.ts";
import { GameConst } from "../model/flags.ts";
import { stripEscBytes, toSimp } from "../ui/text_util.ts";
import { runDomMenu, runDomYesNo } from "../ui/dom_ui.ts";

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
  private readonly windowFaces = new Map<ScenarioWindowDef, number | null>();
  private curFaceId: number | null = null;

  constructor(ctx: any, root: HTMLElement, getScene: () => any, deps: ModernScenarioDeps) {
    this.c = ctx;
    this.root = root;
    this.getScene = getScene;
    this.deps = deps;
  }

  private decodeBytes(bytes: Uint8Array): string {
    if (!this.c?.codec) return "";
    const clean = stripEscBytes(bytes);
    return toSimp(this.c.codec.decode(clean).replace(/\{[0-9A-F]{2}\}/g, "").trim());
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
    this.curFaceId = null;
    this.windowFaces.clear();
  }

  private syncPortrait(faceId: number | null): void {
    this.curFaceId = faceId;
    const img = this.portraitImg;
    if (!img) return;
    if (faceId !== null && faceId >= 0 && faceId < 128) {
      const url = this.c?.art?.portraitUrl?.(faceId);
      if (url) {
        img.src = url;
        img.style.display = "block";
        return;
      }
    }
    img.removeAttribute("src");
    img.style.display = "none";
  }

  openWindow(id: number, w: ScenarioWindowDef): void {
    // 窗口 3 为剧情插图大框 (EVENT*.DAT)，照原版在主 Canvas 绘制外框
    if (id === 3) {
      this.activePictureWin = true;
      this.c.win.save(w.x, w.y, w.w, w.h);
      this.c.win.frame(w.x, w.y, w.w, w.h, 0);
      return;
    }
    this.ensureCard();
    this.windowFaces.set(w, null);
    this.syncPortrait(null);
  }

  async closeWindow(id: number, w: ScenarioWindowDef): Promise<void> {
    if (id === 3 && this.activePictureWin) {
      this.activePictureWin = false;
      await this.c.win.close();
      return;
    }
    this.windowFaces.delete(w);
    this.destroyCard();
  }

  clearWindowText(_w: ScenarioWindowDef): void {
    this.buffer = "";
    if (this.textEl) this.textEl.textContent = "";
  }

  selectWindow(w: ScenarioWindowDef, _textColor: Uint8Array): void {
    this.ensureCard();
    this.clearWindowText(w);
    this.syncPortrait(this.windowFaces.get(w) ?? null);
  }

  drawFace(faceId: number, w: ScenarioWindowDef): void {
    this.ensureCard();
    const fid = faceId & 0xff;
    this.windowFaces.set(w, fid);
    this.syncPortrait(fid);
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

  async selectMenu(items: Uint8Array[]): Promise<number> {
    const labels = items.map(it => this.decodeBytes(it).replace(/[\s\u3000]+/g, ""));
    const card = this.cardEl;
    if (card) card.style.display = "none";
    try {
      return await runDomMenu(labels, 0, false, "请选择", this.buffer, {
        art: this.c.art,
        portraitId: this.curFaceId,
      });
    } finally {
      if (card) card.style.display = "";
    }
  }

  async confirmYesNo(): Promise<boolean> {
    const card = this.cardEl;
    if (card) card.style.display = "none";
    try {
      return !!(await runDomYesNo(this.buffer, "是", "否", {
        art: this.c.art,
        portraitId: this.curFaceId,
      }));
    } finally {
      if (card) card.style.display = "";
    }
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
