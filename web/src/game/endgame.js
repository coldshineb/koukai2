// endgame.js — MAIN.EXE 1764f (0fea:77af) 的結局分支: code 0..5 = 劇本結局 (劇本命令 F4), 0x0f = 爵位 9 (王宮 2ac50) (RE_NOTES 34.1 / 34.8)
// 原版: 對話視窗 0x2ea → 儲存進度 (16ee2 → 16cf0) → 淡黑 → 175ca 收尾 → INT 65h 把 主角名字串、國籍 ×2、核對值 交給 KOUKAI2.COM → 結束碼 1
//   → KOUKAI2.COM 執行 END.EXE (game/ending.js)。網頁版以 MainExit 例外帶著同樣的參數離開遊戲迴圈, 由 main.js 接著執行結局。
import { Commands } from "../scenes/commands.js";

export class MainExit extends Error {
  constructor(code, params) { super("main exit " + code); Object.defineProperty(this, "name", { value: "MainExit" }); this.mainExit = true; this.code = code; this.params = params; }
}

// scene: 目前的 PortScene / SeaScene (存檔畫面用它的 Commands)
export async function mainEnding(scene, code) {
  const c = scene.c, { scr, con, palette, win, message, menu } = c, st = c.state;
  // 1764f 共同開頭: 9888 效果音放鍵, 99f2 淡黑 ([03ea] ≠ 0 時不動作), 07f7 清畫面, 443c(0, 0), DS:a3d0 (ESC C7 ESC B0)
  c.sfx?.off();
  await palette.fadeBlack();
  scr.clear(0);
  con.setCursor(0, 0); con.puts(Uint8Array.of(0x1b, 0x43, 0x37, 0x1b, 0x42, 0x30, 0));
  while (win.stack.length) await win.close();                       // 796d 直到 [0536] = 0
  scr.clear(0);                                                     // 07f7
  await palette.fadeToTarget();                                     // 99e8
  await win.open(0x17, 0x78, 0x22, 0x78, 1);                        // 74f7(0x17, 0x78, 0x22, 0x78, 1)
  message(0x2ea);
  await menu.waitPrompt();                                          // 147ab
  await win.close();                                                // 796d
  if (st.u8(0x0cae) !== 0xff) st.set8(0x0caf, 0x82);
  st.set8(0x0ca4, st.u8(0x0ca4) & 0xfd);
  if (code !== 0x0f) st.set8(0x0ca4, st.u8(0x0ca4) & 0xbf);
  await (scene.commands ??= new Commands(scene)).save(code === 0x0f ? 3 : 2);   // 16ee2 → 16cf0 (取消也照樣繼續)
  await palette.fadeBlack();                                        // 99f2
  // 175ca(code): 9712(0x14) 音樂淡出, 07f7 清畫面, [03ea] = 0, 174b5 / 1743 (調色盤循環停止) / 168a 收尾
  c.bgm?.fadeOut?.();
  scr.clear(0);
  palette.ending = 0;
  palette.stopCycle?.();
  // DS:bb14 = 主角名 + DS:a3d7 (" ") + 姓; KOUKAI2.COM (AH=01) 複製 0x15 bytes
  const H = st.personRecord(st.u8(0x12b5)), z = a => { const b = Array.from(a), i = b.indexOf(0); return i < 0 ? b : b.slice(0, i); };   // 4d1a / 4d31 strcpy / strcat
  const s = [...z(st.cstr(H)), 0x20, ...z(st.cstr(H + 0x0d)), 0];
  const name = new Uint8Array(0x15); name.set(s.slice(0, 0x15));
  let cd = code, nation = 0;
  if (code === 0x0f) { cd = 0x100 | st.u8(0x12b5); nation = st.u8(H + 0x31) & 0x0f; }
  const chk = (((cd << 7) | nation) ^ 0x1565) & 0xffff;
  throw new MainExit(code, { v3: nation, v4: nation, v5: chk, name });   // INT 65h AH=1 / 3 / 4 / 5, 2f6e, 3531(1)
}
