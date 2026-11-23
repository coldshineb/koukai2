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
  const msg = await loadBinary(ctx.ASSETS + "/text/MESSAGE.DAT");
  const menuText = await loadJSON(ctx.ASSETS + "/text/menu.json");
  const sys = ctx.sys;
  const con = new TextConsole(ctx.scr, ctx.font, { beep: () => {}, wait: n => sys.waitSpeed(n) });
  const win = new WindowSystem(ctx.scr, con, gfx, { wait: n => sys.waitTicks(n), options: ctx.options, sys });
  const graph = await new Graph(ctx.scr).load(ctx.ASSETS);
  const kao = new Kao(await loadBinary(ctx.ASSETS + "/gfx/KAO.LZW"));
  const menu = new MenuSystem({ sys, scr: ctx.scr, con, win, gfx, graph });
  // 2e09:56ee 輸出 MESSAGE.DAT 第 n 條 (printf 格式)
  const message = (n, ...args) => {
    const off = (msg[n * 2] << 8) | msg[n * 2 + 1];
    cprintf(msg.subarray(off, off + 256), args, ch => con.putc(ch));
  };
  const printf = (fmt, ...args) => cprintf(typeof fmt === "string" ? ctx.font.encode(fmt + "\0") : fmt, args, ch => con.putc(ch));
  // 2e09:57aa 讀 MENU.DAT 第 n 條: {寬}{項數} + 各項字串 → 位元組陣列 (各含結尾 0)
  // 開頭 2 bytes = {寬}{項數}; 寬為 0x0A 時 menu.json 寫成 "\n" 而不是 "{0A}"
  const menuItems = n => menuText[n].replace(/^(?:\{[0-9A-F]{2}\}|[^{]){2}/, "").split("{00}").slice(0, -1).map(s => ctx.font.encode(s + "{00}"));
  return { con, win, graph, kao, menu, gfx, message, printf, menuItems };
}
