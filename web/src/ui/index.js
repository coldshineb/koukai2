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
  // 2e09:56ee 输出 message.json 第 n 条 (printf 格式)，取代原版二进位 MESSAGE.DAT
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
  // 2e09:57aa 读 MENU.DAT 第 n 条: {宽}{项数} + 各项字符串 → 字节数组 (各含结尾 0)
  // 开头 2 bytes = {宽}{项数}; 宽为 0x0A 时 menu.json 写成 "\n" 而不是 "{0A}"
  const menuItems = n => menuText[n].replace(/^(?:\{[0-9A-F]{2}\}|[^{]){2}/, "").split("{00}").slice(0, -1).map(s => ctx.font.encode(s + "{00}"));
  return { con, win, graph, kao, menu, gfx, message, messageText, printf, menuItems };
}
