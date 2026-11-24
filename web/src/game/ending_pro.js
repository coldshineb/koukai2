// ending_pro.js — 結局序幕: 各主角劇本結局的對話 (END.EXE DS:0e00 far 函式表 01008 / 0113e / 01192 / 01415 / 012c7 / 01509)
//   由 tools/re/ending_pro.py 自反組譯逐句產生 (函式本身只有 push / mov / call, 沒有分支); 文字在 ending.json 的 DS。
//   e = Ending 實例: talkTop = 3c01 (上方視窗, 頭像, printf), talkBottom = 3c7f (下方視窗), closeAll = 3cfd, put = 3fd6, setCursor = 1b09, printf = 215b, prompt = 0f34。
export const PROLOGUES = [
  async e => {                                                    // 0: 01008
    await e.talkBottom(0x0, 0x52c);
    await e.talkTop(0xc, 0x541);
    await e.talkBottom(0x0, 0x558);
    await e.talkTop(0xc, 0x573);
    await e.talkBottom(0x0, 0x5a7);
    await e.talkTop(0xc, 0x5e4);
    await e.talkTop(0xc, 0x5e9);
    await e.talkBottom(0xd, 0x5f0);
    await e.talkTop(0xc, 0x5f5, e.str(0x1fc6));
    await e.talkBottom(0xd, 0x616);
    await e.talkTop(0xc, 0x62b);
    await e.talkTop(0xc, 0x638, e.str(0x1fc6));
    await e.talkTop(0xc, 0x668);
    await e.talkBottom(0x0, 0x671);
    await e.closeAll();
    e.put(0x1c, 0x60, 0x18, 0x90, 0x0, e.ptr(e.w(0x1fde)), 0x0);
    e.sw(0xe2c, 0x36);
    e.sw(0xe2a, 0x18);
    e.setCursor(0x18, 0xf8);
    e.sw(0xe28, 0x14);
    await e.printf(0x678, e.str(0x1fc6), e.str(0x202e));
    await e.prompt();
  },
  async e => {                                                    // 1: 0113e
    e.put(0x1c, 0x60, 0x18, 0x90, 0x0, e.ptr(e.w(0x1fde)), 0x0);
    e.sw(0xe2c, 0x36);
    e.sw(0xe2a, 0x18);
    e.setCursor(0x18, 0xf8);
    e.sw(0xe28, 0x14);
    await e.printf(0x6e2, e.str(0x1fc6));
    await e.prompt();
  },
  async e => {                                                    // 2: 01192
    await e.talkTop(0xf, 0x74d, e.str(0x1fc6));
    await e.talkBottom(0x2, 0x779);
    await e.talkBottom(0xe, 0x7ab);
    await e.talkTop(0xf, 0x7be);
    await e.talkBottom(0xe, 0x7d1);
    await e.talkTop(0xf, 0x7f9, e.str(0x1fc6));
    await e.talkBottom(0x2, 0x806);
    await e.talkTop(0xf, 0x813);
    await e.talkBottom(0x2, 0x826);
    await e.talkBottom(0x2, 0x85f);
    await e.talkBottom(0xe, 0x893);
    await e.talkTop(0xf, 0x8a4);
    await e.talkTop(0xf, 0x8b5);
    await e.talkBottom(0x2, 0x8f9);
    await e.closeAll();
    e.put(0x1c, 0x60, 0x18, 0x90, 0x0, e.ptr(e.w(0x1fd6)), 0x0);
    e.sw(0xe2c, 0x36);
    e.sw(0xe2a, 0x18);
    e.setCursor(0x18, 0xf8);
    e.sw(0xe28, 0x14);
    await e.printf(0x904, e.str(0x1fc6));
    await e.prompt();
  },
  async e => {                                                    // 3: 01415
    await e.talkBottom(0x3, 0xb90);
    await e.talkTop(0x10, 0xbb0, e.str(0x1fc6));
    await e.talkBottom(0x3, 0xbbf);
    await e.talkTop(0x10, 0xbea);
    await e.talkBottom(0x3, 0xbf1);
    await e.talkTop(0x10, 0xc0d);
    await e.talkBottom(0x3, 0xc16);
    await e.talkTop(0x10, 0xc38);
    await e.talkBottom(0x3, 0xc45);
    await e.talkTop(0x10, 0xc4e);
    await e.closeAll();
    e.put(0x1c, 0x60, 0x18, 0x90, 0x0, e.ptr(e.w(0x1fde)), 0x0);
    e.sw(0xe2c, 0x36);
    e.sw(0xe2a, 0x18);
    e.setCursor(0x18, 0xf8);
    e.sw(0xe28, 0x14);
    await e.printf(0xc57, e.str(0x1fc6));
    await e.prompt();
  },
  async e => {                                                    // 4: 012c7
    await e.talkBottom(0x4, 0x963, e.str(0x1fc6), e.str(0x202e));
    await e.talkTop(0x12, 0x99f);
    await e.talkBottom(0x4, 0x9ba);
    await e.talkTop(0x12, 0x9e5);
    await e.talkBottom(0x4, 0x9f0);
    await e.talkTop(0x12, 0xa38);
    await e.talkBottom(0x4, 0xa49);
    await e.talkTop(0x12, 0xa73);
    await e.closeAll();
    await e.talkTop(0x11, 0xa8a);
    await e.talkBottom(0x14, 0xab2);
    await e.talkTop(0x11, 0xad5);
    await e.talkBottom(0x13, 0xaeb);
    await e.talkTop(0x11, 0xb17);
    await e.talkBottom(0x4, 0xb1e);
    await e.closeAll();
    // 4bdc 關檔 [025a]
    e.openEvent(e.b(0x04e1) - 0x30);                              // 0e2c("B:EVENT*.DAT") — '*' = 00000 最後寫入的字元
    e.drawGraph(0x5, 0xe0, 0x60);
    // 4bdc 關檔 [025a]
    e.file = e.data.endgrp;                                        // 0e2c("A:ENDGRP.DAT")
    e.sw(0xe2c, 0x36);
    e.sw(0xe2a, 0x18);
    e.setCursor(0x18, 0xf8);
    e.sw(0xe28, 0x14);
    await e.printf(0xb35, e.str(0x1fc6));
    await e.prompt();
  },
  async e => {                                                    // 5: 01509
    e.put(0x1c, 0x60, 0x18, 0x90, 0x0, e.ptr(e.w(0x1fde)), 0x0);
    e.sw(0xe2c, 0x36);
    e.sw(0xe2a, 0x18);
    e.setCursor(0x18, 0xf8);
    e.sw(0xe28, 0x14);
    await e.printf(0xcac, e.str(0x1fc6));
    await e.prompt();
  },
];
