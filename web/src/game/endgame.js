// endgame.js — MAIN.EXE 1764f (0fea:77af) 的结局分支: code 0..5 = 剧本结局 (剧本命令 F4), 0x0f = 爵位 9 (王宫 2ac50) (RE_NOTES 34.1 / 34.8)
// 原版: 对话窗口 0x2ea → 保存进度 (16ee2 → 16cf0) → 淡黑 → 175ca 收尾 → INT 65h 把 主角名字符串、国籍 ×2、核对值 交给 KOUKAI2.COM → 结束码 1
//   → KOUKAI2.COM 运行 END.EXE (game/ending.js)。网页版以 MainExit 例外带着同样的参数离开游戏循环, 由 main.js 接着运行结局。
import { Commands } from "../scenes/commands.js";
import { GameConst, OptionFlag } from "../model/flags.ts";
import { hasDom, runDomStoryCard } from "../ui/modals.ts";
import { hideDomBattleHud } from "../ui/battle_hud.ts";
import { captureConsoleText, toSimp } from "../ui/text_util.ts";

export class MainExit extends Error {
  constructor(code, params) { super("main exit " + code); Object.defineProperty(this, "name", { value: "MainExit" }); this.mainExit = true; this.code = code; this.params = params; }
}

// scene: 目前的 PortScene / SeaScene (存盘画面用它的 Commands)
export async function mainEnding(scene, code) {
  const c = scene.c, { scr, con, palette, win, message, menu } = c, m = c.state.model, g = m.globals;
  // 1764f 共同开头: 9888 效果音放键, 99f2 淡黑 ([03ea] ≠ 0 时不动作), 07f7 清画面, 443c(0, 0), DS:a3d0 (ESC C7 ESC B0)
  c.sfx?.off();
  await palette.fadeBlack();
  scr.clear(0);
  con.setCursor(0, 0); con.puts(Uint8Array.of(0x1b, 0x43, 0x37, 0x1b, 0x42, 0x30, 0));
  while (win.stack.length) await win.close();                       // 796d 直到 [0536] = 0
  scr.wideRenderer = null;
  scr._battleHudActive = false;
  scr.wideDialog = null;
  scr.wideOverlays.length = 0;
  c.sys._battleViewport = null;
  hideDomBattleHud();
  scr.clear(0);                                                     // 07f7
  if (hasDom() && c.codec) {
    const txt = toSimp(captureConsoleText(c, () => message(0x2ea)));
    await runDomStoryCard(c.art, null, txt, "伟大航程的终点", "保存通关存档");
  } else {
    await palette.fadeToTarget();                                   // 99e8
    await win.open(0x17, 0x78, 0x22, 0x78, 1);                      // 74f7(0x17, 0x78, 0x22, 0x78, 1)
    message(0x2ea);
    await menu.waitPrompt();                                        // 147ab
    await win.close();                                              // 796d
  }
  if (g.port !== GameConst.EMPTY_SLOT) g.lastPort = 0x82;
  g.options &= ~OptionFlag.ENDING_READY;
  if (code !== 0x0f) g.options &= ~OptionFlag.SCENARIO;
  await (scene.commands ??= new Commands(scene)).save(code === 0x0f ? 3 : 2);   // 16ee2 → 16cf0 (取消也照样继续)
  await palette.fadeBlack();                                        // 99f2
  // 175ca(code): 9712(0x14) 音乐淡出, 07f7 清画面, [03ea] = 0, 174b5 / 1743 (调色盘循环停止) / 168a 收尾
  c.bgm?.fadeOut?.();
  scr.clear(0);
  palette.ending = 0;
  palette.stopCycle?.();
  // DS:bb14 = 主角名 + DS:a3d7 (" ") + 姓; KOUKAI2.COM (AH=01) 拷贝 0x15 bytes
  const hero = m.heroPerson(), z = a => { const b = Array.from(a), i = b.indexOf(0); return i < 0 ? b : b.slice(0, i); };   // 4d1a / 4d31 strcpy / strcat
  const s = [...z(hero.givenNameBytes), 0x20, ...z(hero.familyNameBytes), 0];
  const name = new Uint8Array(0x15); name.set(s.slice(0, 0x15));
  let cd = code, nation = 0;
  if (code === 0x0f) { cd = 0x100 | g.hero; nation = hero.face & 0x0f; }
  const chk = (((cd << 7) | nation) ^ 0x1565) & 0xffff;
  throw new MainExit(code, { v3: nation, v4: nation, v5: chk, name });   // INT 65h AH=1 / 3 / 4 / 5, 2f6e, 3531(1)
}
