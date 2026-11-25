// ui/index.js — 创建原版 UI 系统 (文字主控台 + 窗口 + 菜单 + GRAPH 图像 + 头像)
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
  // 2e09:56ee 输出 MESSAGE.DAT 第 n 条 (printf 格式)
  const message = (n, ...args) => {
    const off = (msg[n * 2] << 8) | msg[n * 2 + 1];
    cprintf(msg.subarray(off, off + 256), args, ch => con.putc(ch));
  };
  const printf = (fmt, ...args) => cprintf(typeof fmt === "string" ? ctx.font.encode(fmt + "\0") : fmt, args, ch => con.putc(ch));
  // 2e09:57aa 读 MENU.DAT 第 n 条: {宽}{项数} + 各项字符串 → 字节数组 (各含结尾 0)
  // 开头 2 bytes = {宽}{项数}; 宽为 0x0A 时 menu.json 写成 "\n" 而不是 "{0A}"
  const menuItems = n => menuText[n].replace(/^(?:\{[0-9A-F]{2}\}|[^{]){2}/, "").split("{00}").slice(0, -1).map(s => ctx.font.encode(s + "{00}"));
  return { con, win, graph, kao, menu, gfx, message, printf, menuItems };
}
