// graph.js — GRAPH 格式圖像 (原版 seg0:5b5d 16 色 / seg0:5a91 8 色); 目前檔案 = 原版的 [03d8]
import { loadBinary } from "../core/assets.js";
import { GraphDat } from "../gfx/graphdec.js";

export class Graph {
  constructor(scr) { this.scr = scr; this.files = {}; }
  async load(base, names = ["GRAPH.DAT", "GRAPH2.DAT"]) {
    for (const n of names) this.files[n] = new GraphDat(await loadBinary(`${base}/gfx/${n}`));
    this.g = this.files[names[0]]; return this;
  }
  useFile(name) { this.g = this.files[name]; }
  draw(n, x, y) { const r = this.g.draw(this.scr.fb, n, x, y); this.scr.dirty = true; return r; }
  draw8(n, x, y) { const r = this.g.draw8(this.scr.fb, n, x, y); this.scr.dirty = true; return r; }
}
