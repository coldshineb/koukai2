// title.js — 开机流程与标题菜单 (MAIN.EXE main 0FEA:6304, 160f1, 17546, 171a2, 170dc, 1706a, 16f68, 16b3f, 16a03, 17004, 175ca)
// 与原版的差异: 依需求移除说明书密码确认 (main 中的 2e09:7cec)。
import { GameState, STATE_LOAD_SIZE } from "./state.js";
import { SaveFile, SLOTS, HEADER_SIZE } from "./savefile.js";
import { NewGame } from "./newgame.js";
import { Commands } from "../scenes/commands.js";
import { loadPortAssets } from "../scenes/port.js";
import { GameConst, MenuId, OptionFlag } from "../model/flags.ts";

const ESC = 0x1b;
const STR_STAR = Uint8Array.of(ESC, 0x43, 0x32, 0x2a, ESC, 0x43, 0x30, 0);   // DS:a37a  ESC C2 * ESC C0
export const SONG_TITLE = 3;                                                  // 171a2: 9670(3)

export class Title {
  constructor(ctx) { this.ctx = ctx; }
  get c() { return this.ctx; }

  // 160f1 + 17546 前半: 初始化 (此时画面全黑, 淡入淡出不可见但仍占用时间)
  async init() {
    const { scr, palette, state } = this.c;
    state.options = 0xff;                 // [0ca4] = FF: 环境设置全开
    scr.clear(0);                         // 07f7
    await palette.fadeToTarget();         // 98f8 属性寄存器恒等 + 99e8
    await palette.fadeBlack();            // 16063 之后 99f2
    await palette.fadeToTarget();         // 17546 开头
    // 1752c: 鼠标初始化 (4e47) + 4f44(0x27F, 0x18F): 把鼠标移到右下角 (驱动座标 y 再加 40 行)
    //   之后是/否框在鼠标位于 (27F,18F) 时改跟随文字光标 (0FEA:146d4), 所以这一步会影响确认框的位置
    this.c.sys.setMousePos(0x27f, 0x18f);
    this.c.con.f29 = 1;                   // [8a29] = 1
    this.c.bgm.optionOff = () => !(this.c.state.options & OptionFlag.BGM);   // 9670 依 [0ca4] bit2 决定播不播 (core/audio.js)
  }
  // 171a2(1); restart = 171a2(0) (1757d: 功能「结束游戏」后回到标题: 不做 1752c, 以 DATA1 #15 重新加载初始状态代替 162fd)
  async run(restart = false) {
    if (!restart) await this.init();
    await this.c.palette.fadeToTarget();
    this.c.bgm.playSong(SONG_TITLE);
    if (restart) this.c.state.b.set(this.c.initState.subarray(0, this.c.state.b.length));
    else { this.c.palette.invert = 0; this.c.barColors = [2, 1]; }   // 162fd: [c2d6] = 0, seg0:9376(2, 1) 百分比条颜色 DS:bafa / bafc
    // 171f5: 期间 [03d8] = GRAPH2.DAT (是/否框也取自它; 与 GRAPH.DAT 第 0 张相同)
    this.c.graph.useFile("GRAPH2.DAT");
    this.c.saveFile ??= await SaveFile.open(this.c.ASSETS, this.c.initState, this.c.schema, this.c.codec);   // 170dc
    const r = await this.titleMenu();     // 1706a
    this.c.graph.useFile("GRAPH.DAT");    // 160bc
    return r;
  }
  // 1706a: 标题菜单循环, 处理函数表 DS:a3a2
  async titleMenu() {
    const { win, menu } = this.c, items = this.c.menuItems(MenuId.TITLE);
    const handlers = [() => this.cont(), () => this.newVoyage(), () => this.settings(), () => this.quit(items)];
    for (;;) {
      await win.open(0x18, 0x30, 0x20, 0x90, 0);
      const sel = await menu.inlineMenu(0x18, 0x30, items.slice(0, 4), 0, 0x20);
      await win.close();
      const r = await handlers[sel]();
      if (r) return r;
    }
  }
  // 16f68 继续航海进度
  async cont() { return this.loadMenu(); }
  // 16f96 开始新航海: 主角选择 (16564, 期间 [03d8] 仍是 GRAPH2.DAT) → 新游戏初始化 (16949)
  async newVoyage() { return new NewGame(this.c, this.c.newgameData, this.c.mapNodes).run(); }
  // 16ff2 环境设置: [8b1e] = 1 → 1fd9:173f (= 214cf, 与港口 / 海上同一个环境设置窗口, scenes/commands.js settings) → [8b1e] = 0, 返回 0 (回到标题菜单)
  //   [8b1e] (地图精灵的动画相位) 在 214cf 以下都没有被读, 之后进港 / 出海各场景另行初始化, 移植版不另外保存
  async settings() {
    this.c.portAssets ??= await loadPortAssets(this.c);
    await new Commands({ c: this.c, P: this.c.portAssets }).settings();
    return 0;
  }
  // 17004 结束游戏
  async quit(items) {
    const { win, con, menu } = this.c;
    await win.open(0x18, 0x30, 0x20, 0x50, 1);
    con.setCursor(0x1f, 0x40); con.puts(items[3]);
    con.setCursor(0x1a, 0x60); this.c.message(0x3be);
    const yes = await menu.yesNo();
    await win.close();
    if (!yes) return 0;
    await this.exitGame(0x80);
    return 0x80;
  }
  // 1764f(0x80) → 175ca: KOEI 标志画面, 等按键后淡出并结束程序
  async exitGame() {
    const { scr, palette, graph, sys, menu } = this.c;
    this.c.bgm.fadeOut();                                      // 9712(0x14)
    this.c.sfx?.off();                                         // 9888
    await palette.fadeBlack(); scr.clear(0);                   // 99f2, 07f7
    palette.ending = 0;                                        // [03ea] = 0
    graph.useFile("GRAPH.DAT");
    graph.draw(0x3c, 0xd8, 0x50);                              // 5b5d
    graph.draw8(0x3e, 0xa0, 0xc8);                             // 5a91
    await palette.fadeToTarget();
    sys.flush(); await menu.waitRelease(); await menu.waitPress();   // 131f9
    await palette.fadeBlack(); scr.clear(0);
    sys.mouseHide();
    this.c.halted = true;                                      // 原版此时回到 DOS
  }
  // 16a03: 存盘一览 (titleIndex: 0=继续航海进度, 4=保存进度)
  async slotList(hdr, titleIndex) {
    const { win, con, state } = this.c, items = this.c.menuItems(56);
    await win.open(0x19, 0x30, 0x1e, 0x120, 1);
    con.setCursor(0x1f, 0x40); con.puts(items[titleIndex]);
    for (let i = 0; i < SLOTS; i++) {
      con.setCursor(0x1a, (i + 6) << 4);
      const h = hdr.subarray(i * HEADER_SIZE, (i + 1) * HEADER_SIZE);
      if (h[0]) {
        con.puts(h);
        if (h[13] === 2 || h[13] === 3) con.puts(STR_STAR); else con.putc(0x20);
        if (h[12] === 0xff) con.print("海上"); else con.puts(state.portName(h[12]));      // DS:a382 / 港名
      } else this.c.printf("        KOEI Game %02d", i + 1);                           // DS:a387
    }
    con.setCursor(0x1c, 0x110); this.c.message(0x3b7);
  }
  // 169b8: 10 格的点击范围 + 窗口范围
  slotRects() {
    const R = this.c.menu.rects;
    for (let i = 0; i < SLOTS; i++) R[i] = { x0: 0xd0, x1: 0x1b0, y0: (i + 6) << 4, y1: ((i + 6) << 4) + 0x10 };
    R[SLOTS] = { x0: 0xd0, x1: 0x1b0, y0: 0x30, y1: 0x150 };
  }
  // 16b3f: 读档
  async loadMenu() {
    const { win, con, menu, sys } = this.c, f = this.c.saveFile;
    const hdr = f.headers();
    await this.slotList(hdr, 0);
    for (;;) {
      this.slotRects();
      const sel = await menu.customMenu(10, 1, 1);
      if (sel === 0xff) { await win.close(); return 0; }
      if (hdr[sel * HEADER_SIZE]) {
        await win.open(0x18, 0x100, 0x20, 0x30, 1);
        con.setCursor(0x1a, 0x110); this.c.message(0x3b8);
        if (await menu.yesNo()) { this.applyLoad(f.slot(sel)); await win.close(); await this.afterLoad(); await win.close(); return 1; }
        await win.close();
      } else {
        await win.open(0x19, 0x100, 0x1e, 0x30, 1);
        con.setCursor(0x1b, 0x110); this.c.message(0x3b9);
        await sys.waitTenths(10);
        await win.close();
      }
    }
  }
  // 16c02..16c96
  applyLoad(slot) {
    const st = this.c.state, g = st.model.globals;
    st.b.set(slot.subarray(0, STATE_LOAD_SIZE));
    this.c.buf0c8e = slot.slice(STATE_LOAD_SIZE);                 // 读入缓冲 [0c8e] 的 0x300 bytes
    st.b.set(this.c.buf0c8e, STATE_LOAD_SIZE);                    // (本移植版把它保存在状态镜像的同一位置)
    let o = g.options;
    if (!(o & (OptionFlag.SCENARIO | OptionFlag.ENDING_READY))) { g.heroChap = GameConst.EMPTY_SLOT; g.heroSec = 0; }
    else if (!(o & OptionFlag.ENDING_READY)) { o = (o | OptionFlag.SCENARIO) & ~OptionFlag.ENDING_READY; g.commonChap = 0; g.commonSec = 0; }
    else o |= OptionFlag.SCENARIO | OptionFlag.ENDING_READY;
    g.options = o;
    // 1681a: 日期拷贝到运行期变量 [0532..0535]
    this.c.rt = { year: g.year, month: g.month, day: g.day, time: g.time };
    // 1681a → 1667a: 风向表的季节; seg0:5022 鼠标速度
    this.c.windOffset = g.month >= 3 && g.month < 9 ? 0 : 0x1c2;
    this.c.eventFile = `EVENT${g.hero + 1}.DAT`;                         // 1681a 结尾: [0a89] = '1' + 主角 (剧情插图档)
    { const r = (g.mouseSens + 2) * 2; this.c.sys.mickeyRatio = [r, r]; }
  }
  // 16c99..16cd9: 9888 效果音放键; 暴风雨中 → 9768(DS:0c5a) + 9804(0x30)
  async afterLoad() {
    const g = this.c.state.model.globals, sfx = this.c.sfx;
    sfx?.off();
    if ((g.weather & 15) === 1) { sfx?.voice(0x0c5a); sfx?.note(0x30); }
    if (!(g.options & OptionFlag.BGM)) this.c.bgm.fadeOut();      // 背景音乐关闭时停止
  }
}
