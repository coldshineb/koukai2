// graph.js — 现代纯 PNG 图像渲染器 (由 ArtRegistry 读取 web/assets/art/ 标准 PNG，取代原版 GRAPH.DAT / GRAPH2.DAT / EVENT*.DAT)
export class Graph {
  constructor(scr, art = null) {
    this.scr = scr;
    this.art = art;
    this.curFile = "GRAPH.DAT";
    this.files = {};
  }
  async load(_base, names = ["GRAPH.DAT", "GRAPH2.DAT"]) {
    this.curFile = names[0] || "GRAPH.DAT";
    if (this.art) {
      // 预载常用主界面外框与背景，确保首帧无闪烁
      const preload = [];
      for (const idx of [2, 3, 4, 5, 0x17, 0x19, 0x1a, 0x1b, 0x3c, 0x3e]) {
        const e = this.art.graphEntry("GRAPH.DAT", idx);
        if (e) preload.push(`${this.art.baseUrl}/${e.path}`);
      }
      const g2 = this.art.graphEntry("GRAPH2.DAT", 1);
      if (g2) preload.push(`${this.art.baseUrl}/${g2.path}`);
      await this.art.preloadUrls(preload);
    }
    return this;
  }
  useFile(name) {
    this.curFile = name;
  }
  async ensure(_base, name, _path = name) {
    this.curFile = name;
    if (this.art) {
      const m = /^EVENT(\d)\.DAT$/i.exec(name);
      if (m) {
        const list = this.art.manifest?.events?.[`event${m[1]}`] ?? [];
        await this.art.preloadUrls(list.map(e => `${this.art.baseUrl}/${e.path}`));
      }
    }
    return {
      draw: (_fb, idx, x, y) => this.drawFrom(name, idx, x, y),
      draw8: (_fb, idx, x, y) => this.drawFrom(name, idx, x, y),
    };
  }
  drawFrom(fileName, n, x, y) {
    if (!this.art) return -1;
    const entry = this.art.graphEntry(fileName, n);
    if (!entry) return -1;
    this.art.drawEntry(this.scr, entry, x, y);
    return 0;
  }
  draw(n, x, y) {
    return this.drawFrom(this.curFile, n, x, y);
  }
  draw8(n, x, y) {
    return this.drawFrom(this.curFile, n, x, y);
  }
}
