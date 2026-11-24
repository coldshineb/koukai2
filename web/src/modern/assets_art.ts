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
  ending?: ArtEntry[];
  opening?: Record<string, ArtEntry[]>;
  graph?: Record<string, ArtEntry[]>;
  kaoParts?: Record<string, ArtSheetEntry>;
}

export class ArtRegistry {
  readonly baseUrl: string;
  manifest: ArtManifest | null = null;
  private images = new Map<string, HTMLImageElement>();
  private loading = new Map<string, Promise<HTMLImageElement | null>>();

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

  loadImage(url: string | null): Promise<HTMLImageElement | null> {
    if (!url || typeof Image === "undefined") return Promise.resolve(null);
    const cached = this.images.get(url);
    if (cached) return Promise.resolve(cached);
    let p = this.loading.get(url);
    if (!p) {
      p = new Promise<HTMLImageElement | null>(resolve => {
        const img = new Image();
        img.decoding = "async";
        img.onload = () => {
          this.images.set(url, img);
          this.loading.delete(url);
          resolve(img);
        };
        img.onerror = () => {
          this.loading.delete(url);
          resolve(null);
        };
        img.src = url;
      });
      this.loading.set(url, p);
    }
    return p;
  }

  getImage(url: string | null): HTMLImageElement | null {
    if (!url) return null;
    const cached = this.images.get(url);
    if (cached) return cached;
    void this.loadImage(url);
    return null;
  }

  async preloadUrls(urls: (string | null | undefined)[]): Promise<void> {
    await Promise.all(urls.filter((u): u is string => !!u).map(u => this.loadImage(u)));
  }

  // 直接將單張 PNG (支援任意倍數高清重繪版本) 繪製到 Screen 的 HD 2D 畫布
  drawEntry(
    scr: any,
    entry: ArtEntry | null | undefined,
    dx: number,
    dy: number,
    opts?: { dw?: number; dh?: number; transparent?: boolean; smooth?: boolean | null },
  ): boolean {
    if (!entry || !scr?.drawImage) return false;
    const url = this.resolve(entry);
    const dw = opts?.dw ?? entry.w;
    const dh = opts?.dh ?? entry.h;
    const drawNow = (img: HTMLImageElement) => {
      const sw = img.naturalWidth || entry.w;
      const sh = img.naturalHeight || entry.h;
      scr.drawImage(img, 0, 0, sw, sh, dx, dy, dw, dh, {
        transparent: opts?.transparent ?? false,
        smooth: opts?.smooth ?? null,
      });
    };
    const cached = this.images.get(url!);
    if (cached) {
      drawNow(cached);
      return true;
    }
    void this.loadImage(url).then(img => {
      if (img) drawNow(img);
    });
    return true;
  }

  // 直接將圖集切片繪製到 Screen 的 HD 2D 畫布 (自動適配高清重繪圖集的實際解析度)
  drawSheetTile(
    scr: any,
    sheetName: string,
    tileIdx: number,
    dx: number,
    dy: number,
    opts?: { dw?: number; dh?: number; transparent?: boolean; smooth?: boolean | null; sxOff?: number; syOff?: number; sw?: number; sh?: number },
  ): boolean {
    const meta = this.sheet(sheetName);
    if (!meta || !scr?.drawImage || tileIdx < 0 || tileIdx >= meta.count) return false;
    const url = this.resolve(meta);
    const dw = opts?.dw ?? opts?.sw ?? meta.tileW;
    const dh = opts?.dh ?? opts?.sh ?? meta.tileH;
    const col = tileIdx % meta.cols;
    const row = Math.floor(tileIdx / meta.cols);
    const drawNow = (img: HTMLImageElement) => {
      const scaleX = (img.naturalWidth || meta.w) / meta.w;
      const scaleY = (img.naturalHeight || meta.h) / meta.h;
      const sx = (col * meta.tileW + (opts?.sxOff ?? 0)) * scaleX;
      const sy = (row * meta.tileH + (opts?.syOff ?? 0)) * scaleY;
      const sw = (opts?.sw ?? meta.tileW) * scaleX;
      const sh = (opts?.sh ?? meta.tileH) * scaleY;
      scr.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh, {
        transparent: opts?.transparent ?? false,
        smooth: opts?.smooth ?? null,
      });
    };
    const cached = this.images.get(url!);
    if (cached) {
      drawNow(cached);
      return true;
    }
    void this.loadImage(url).then(img => {
      if (img) drawNow(img);
    });
    return true;
  }

  portraitEntry(faceId: number): ArtEntry | null {
    return this.manifest?.portraits[String(faceId & 0xff)] ?? null;
  }

  discoveryEntry(id: number): ArtEntry | null {
    return this.manifest?.discoveries[String(id & 0xff)] ?? null;
  }

  figureheadEntry(id: number): ArtEntry | null {
    return this.manifest?.figureheads[String(id & 0xff)] ?? null;
  }

  graphEntry(fileName: string, index: number): ArtEntry | null {
    const key = fileName.toUpperCase();
    const list = this.manifest?.graph?.[key];
    if (list?.[index]) return list[index];
    // 相容 EVENT0.DAT..EVENT6.DAT
    const m = /^EVENT(\d)\.DAT$/i.exec(fileName);
    if (m) return this.manifest?.events[`event${m[1]}`]?.[index] ?? null;
    return null;
  }

  kaoPartSheet(name: string): ArtSheetEntry | null {
    return this.manifest?.kaoParts?.[name] ?? null;
  }

  portraitUrl(faceId: number): string | null {
    return this.resolve(this.portraitEntry(faceId));
  }

  discoveryUrl(id: number): string | null {
    return this.resolve(this.discoveryEntry(id));
  }

  buildingUrl(id: number): string | null {
    return this.resolve(this.manifest?.buildings[String(id & 0xff)]);
  }

  shipUrl(typeId: number): string | null {
    return this.resolve(this.manifest?.ships[String(typeId & 0xff)]);
  }

  figureheadUrl(id: number): string | null {
    return this.resolve(this.figureheadEntry(id));
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

  endingUrl(index: number): string | null {
    return this.resolve(this.manifest?.ending?.[index]);
  }

  openingUrl(pack: number, index: number): string | null {
    const key = `op${String(pack).padStart(2, "0")}`;
    return this.resolve(this.manifest?.opening?.[key]?.[index]);
  }
}
