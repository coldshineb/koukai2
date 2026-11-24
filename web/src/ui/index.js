// ui/index.js — 建立原版 UI 系統 (文字主控台 + 視窗 + 選單 + GRAPH 圖像 + 頭像)
import { loadBinary, loadJSON } from "../core/assets.js";
import { TextConsole } from "./console.js";
import { WindowSystem } from "./window.js";
import { MenuSystem } from "./menu.js";
import { Graph } from "./graph.js";
import { cprintf } from "./printf.js";
import { Kao } from "../gfx/kao.js";

export async function createUI(ctx) {
  const gfx = await loadBinary(ctx.ASSETS + "/gfx/ui_frame.bin");
  const msgText = await loadJSON(ctx.ASSETS + "/text/message.json");
  const menuText = await loadJSON(ctx.ASSETS + "/text/menu.json");
  const sys = ctx.sys;
  const con = new TextConsole(ctx.scr, ctx.font, { beep: () => {}, wait: n => sys.waitSpeed(n) });
  const win = new WindowSystem(ctx.scr, con, gfx, { wait: n => sys.waitTicks(n), options: ctx.options, sys });
  ctx.scr.winStackRef = win.stack;
  ctx.scr.wideArt = ctx.art;
  const graph = await new Graph(ctx.scr, ctx.art).load(ctx.ASSETS);
  const kao = new Kao(ctx.art);
  const menu = new MenuSystem({ sys, scr: ctx.scr, con, win, gfx, graph, codec: ctx.codec });
  // 2e09:56ee 輸出 message.json 第 n 條 (printf 格式)，取代原版二進位 MESSAGE.DAT
  const msgCache = new Map();
  const encodeMessage = n => {
    let buf = msgCache.get(n);
    if (!buf) {
      const raw = msgText[n] ?? "";
      buf = ctx.font.encode(raw.endsWith("{00}") ? raw : raw + "{00}");
      msgCache.set(n, buf);
    }
    return buf;
  };
  const message = (n, ...args) => {
    cprintf(encodeMessage(n), args, ch => con.putc(ch));
  };
  const messageText = n => (msgText[n] ?? "").replace(/\{[0-9A-F]{2}\}/g, "");
  const printf = (fmt, ...args) => cprintf(typeof fmt === "string" ? ctx.font.encode(fmt + "\0") : fmt, args, ch => con.putc(ch));
  // 2e09:57aa 讀 MENU.DAT 第 n 條: {寬}{項數} + 各項字串 → 位元組陣列 (各含結尾 0)
  // 開頭 2 bytes = {寬}{項數}; 寬為 0x0A 時 menu.json 寫成 "\n" 而不是 "{0A}"
  const menuItems = n => menuText[n].replace(/^(?:\{[0-9A-F]{2}\}|[^{]){2}/, "").split("{00}").slice(0, -1).map(s => ctx.font.encode(s + "{00}"));
  return { con, win, graph, kao, menu, gfx, message, messageText, printf, menuItems };
}
