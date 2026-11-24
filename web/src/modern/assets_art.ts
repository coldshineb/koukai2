// modern/assets_art.ts — 現代標準 PNG 美術資源註冊表 (對應 web/assets/art/manifest.json)
// 任何單張 PNG (頭像/建築/船型/船首像/發現物/劇情插圖/背景) 皆可直接替換為高清重繪版本，無需重新打包二進位檔。
import { loadJSON } from "../core/assets.js";

export interface ArtEntry {
  path: string;
  w: number;
  h: number;
}

export interface ArtSheetEntry extends ArtEntry {
  tileW: number;
  tileH: number;
  cols: number;
  rows: number;
  count: number;
}

export interface ArtManifest {
  format: "uw2-art-v1";
  portraits: Record<string, ArtEntry>;
  discoveries: Record<string, ArtEntry>;
  buildings: Record<string, ArtEntry>;
  ships: Record<string, ArtEntry>;
  figureheads: Record<string, ArtEntry>;
  events: Record<string, ArtEntry[]>;
  backgrounds: Record<string, ArtEntry>;
  sheets?: Record<string, ArtSheetEntry>;
}

export class ArtRegistry {
  readonly baseUrl: string;
  manifest: ArtManifest | null = null;

  constructor(assetsBase: string) {
    this.baseUrl = assetsBase.replace(/\/+$/, "") + "/art";
  }

  async load(): Promise<this> {
    try {
      this.manifest = await loadJSON(this.baseUrl + "/manifest.json");
    } catch (e) {
      console.warn("載入 art/manifest.json 失敗:", e);
    }
    return this;
  }

  private resolve(entry?: ArtEntry | null): string | null {
    return entry ? `${this.baseUrl}/${entry.path}` : null;
  }

  portraitUrl(faceId: number): string | null {
    return this.resolve(this.manifest?.portraits[String(faceId & 0xff)]);
  }

  discoveryUrl(id: number): string | null {
    return this.resolve(this.manifest?.discoveries[String(id & 0xff)]);
  }

  buildingUrl(id: number): string | null {
    return this.resolve(this.manifest?.buildings[String(id & 0xff)]);
  }

  shipUrl(typeId: number): string | null {
    return this.resolve(this.manifest?.ships[String(typeId & 0xff)]);
  }

  figureheadUrl(id: number): string | null {
    return this.resolve(this.manifest?.figureheads[String(id & 0xff)]);
  }

  eventUrl(heroNo: number, picId: number): string | null {
    const key = `event${heroNo}`;
    return this.resolve(this.manifest?.events[key]?.[picId]);
  }

  backgroundUrl(name: string): string | null {
    return this.resolve(this.manifest?.backgrounds[name]);
  }

  sheet(name: string): ArtSheetEntry | null {
    return this.manifest?.sheets?.[name] ?? null;
  }

  sheetUrl(name: string): string | null {
    return this.resolve(this.sheet(name));
  }
}
