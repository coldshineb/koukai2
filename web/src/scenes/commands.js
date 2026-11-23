// commands.js — 港口畫面右側 4 個指令按鈕 (MAIN.EXE 0FEA:1b8c8 → DS:a642 遠程函式表) 與其在港內可用的子功能
//   按鈕 8..11: 情報 1fd9:0e33 (線性 20bc3) / 經營 1fd9:0fdc (20d6c) / 命令 1fd9:10a8 (20e38) / 航海術 1fd9:119e (20f2e)
//   (1b8c8 以 DS:[a622 + di×4] 取函式, di = 8..11, 所以表其實在 DS:a642; a622 起是建築處理表 a612 的第 4 項)
//   分析: tools/re/commands.py → tools/work/re_cmd_*.txt; 常數: tools/extract_commands.py → assets/data/commands.json
//   結論與未移植部分: docs/RE_NOTES.md 第 25 節
// 共用:
//   1b8c8   按下按鈕: 隱藏游標 → seg0:9396(n) 按鈕凹下圖 → 處理函式 → seg0:937e(n) 還原 → 顯示游標
//   20b0c   右側選單: 0fea:44c4 = 14364 帶陰影直式選單, x = 0x4a − 最長項目字數, 可取消; [a158] = 項目數
//   20b40   結束時重畫地圖視窗 (2103 + 1fac, 主角不重畫) → 99e8 淡入 → 清鍵盤緩衝
import { Buildings } from "./buildings.js";
import { Title } from "../game/title.js";

const cmHex = s => { const b = Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16))), o = new Uint8Array(b.length + 1); o.set(b); return o; };
const cmStrlen = s => { let n = 0; while (n < s.length && s[n]) n++; return n; };
const cmUmin = (a, b) => ((a & 0xffff) > (b & 0xffff) ? b & 0xffff : a & 0xffff);     // seg0:4d7c (無號)
const cmWarned = new Set();
const cmTodo = n => { if (!cmWarned.has(n)) { cmWarned.add(n); console.warn("尚未移植: " + n); } };

export class Commands {
  constructor(scene) {
    this.p = scene; this.c = scene.c;
    const J = scene.P.commands;                                         // assets/data/commands.json
    this.S = Object.fromEntries(Object.entries(J.str).map(([k, v]) => [k, cmHex(v)]));
    this.c.persons ??= new Array(0x50).fill(0);
    this.c.barColors ??= [0, 0];                                       // DS:bafa / bafc (BSS 初值 0, seg0:9376 設定)
  }
  get st() { return this.c.state; }
  get b() { return this.p.buildings ??= new Buildings(this.p); }
  get rt() { return this.c.rt; }

  // ================= 1b8c8 後半: 指令按鈕 n (0..3) =================
  async button(n) {
    const { sys } = this.c;
    sys.mouseHide();
    this.press(n);                                                     // seg0:9396
    switch (n) {
      case 0: await this.info(); break;
      case 1: await this.manage(); break;
      case 2: await this.order(); break;
      case 3: await this.nav(); break;
    }
    this.release(n);                                                   // seg0:937e
    sys.mouseShow();
  }
  // seg0:9396 按鈕凹下: 先以 2929 保存 (0x4d 欄, y = 0x48 + 0x50n) 3 欄 × 0x50 行 4 平面;
  //   動畫效果開: TRANSIT.DAT 0x4b00 + 0x2d0n 的 0x2d0 bytes 以 seg0:055e (044d 模式 0: 每欄 3 bytes = 平面 0..2, 平面 3 不動) 貼上
  //   關: seg0:063e 以 [0c86]+0 (全 FF) 模式 0x107 (XOR 色 7) 反白
  press(n) {
    const { scr, gfx } = this.c, y = 0x48 + 0x50 * n, fb = scr.fb;
    this.pressSave = new Uint8Array(24 * 0x50);
    for (let r = 0; r < 0x50; r++) this.pressSave.set(fb.subarray((y + r) * 640 + 0x4d * 8, (y + r) * 640 + 0x50 * 8), r * 24);
    if (this.st.options & 1) {
      const src = this.p.P.transit, o = 0x4b00 + 0x2d0 * n;
      for (let r = 0; r < 0x50; r++) for (let c = 0; c < 3; c++) {
        const k = o + (r * 3 + c) * 3, p0 = src[k], p1 = src[k + 1], p2 = src[k + 2];
        for (let i = 0; i < 8; i++) {
          const sh = 7 - i, a = (y + r) * 640 + (0x4d + c) * 8 + i;
          fb[a] = (fb[a] & 8) | ((p0 >> sh) & 1) | (((p1 >> sh) & 1) << 1) | (((p2 >> sh) & 1) << 2);
        }
      }
      scr.dirty = true;
    } else scr.glyphMode(0x4d, y, 3, 0x50, gfx.subarray(0), 0x107);
  }
  // seg0:937e 還原 (2997)
  release(n) {
    const { scr } = this.c, y = 0x48 + 0x50 * n;
    if (!this.pressSave) return;
    for (let r = 0; r < 0x50; r++) scr.fb.set(this.pressSave.subarray(r * 24, r * 24 + 24), (y + r) * 640 + 0x4d * 8);
    scr.dirty = true;
  }
  // 20b0c 右側選單 (y, 項目)
  async popMenu(y, items) {
    const m = this.c.menu;
    m.count = items.length;                                            // [a158]
    let w = 0; for (const s of items) w = Math.max(w, cmStrlen(s));    // 13847
    return m.listMenu(0x4a - w, y, items, 1);
  }
  // 20b40 重畫地圖視窗 (不畫主角) → 淡入 → 清鍵盤
  async redrawMap() {
    const p = this.p;
    p.clearCache(); p.drawMap();
    await this.c.palette.fadeToTarget();
    this.c.sys.flush();
  }
  // 1721f 依目前位置重新進入港口 (8c53) 或海上 (851f)
  async reenter() {
    if (this.st.port !== 0xff) await this.p.enter(); else cmTodo("出海畫面 (851f)");
  }
  // 1b39a 時間迴圈中止旗標
  abort() { const r = this.rt; return r.month >= 0xf0 || r.day >= 0xf0 || r.time >= 0xf0; }
  // 小訊息視窗 294bf: 7849(0x12, 0x30, 0x1c, 0x60)
  smallWin() { this.c.win.shadowedSaved(0x12, 0x30, 0x1c, 0x60, 0); }
  async waitClose() { await this.c.menu.waitPrompt(); await this.c.win.close(); }   // 0fea:490b + 796d

  // ================= 情報 1fd9:0e33 (20bc3) =================
  async info() { cmTodo("情報 (20bc3)"); }
  // ================= 經營 1fd9:0fdc (20d6c) =================
  async manage() { cmTodo("經營 (20d6c)"); }
  // ================= 命令 1fd9:10a8 (20e38) =================
  async order() { cmTodo("命令 (20e38)"); }

  // ================= 航海術 1fd9:119e (20f2e) =================
  // MENU #0x1d (委任/停船/靠港/登陸/隨身物/功能), [1005] bit5 (停船中) 時 #0x2e (第 2 項改為「出航」)
  // 停用: [1005] & 0x18 → 0..2; 在港 → 0..3; 沒有隨身物 → 4。選隨身物以外的項目 (或取消) 後結束; 功能回傳值決定是否結束
  async nav() {
    const st = this.st, { menu, palette } = this.c;
    const items = this.c.menuItems(st.u8(0x1005) & 0x20 ? 0x2e : 0x1d).slice(0, 6);
    let si = 0;
    while (!palette.ending) {                                          // 20fd9: [03ea] == 0
      if (si) break;
      if (st.u8(0x1005) & 0x18) menu.disabled |= 7;
      if (st.port !== 0xff) menu.disabled |= 0x0f;
      if (!this.itemList()) menu.disabled |= 0x10;
      const r = await this.popMenu(0xe0, items);
      switch (r) {
        case 0: cmTodo("委任 (2e09:3223)"); si = 1; break;             // 在港時停用
        case 1: cmTodo("停船 / 出航 (20ee3)"); si = 1; break;
        case 2: cmTodo("靠港 (1bf79)"); si = 1; break;
        case 3: cmTodo("登陸 (34ec7)"); si = 1; break;
        case 4: await this.belongings(); break;                         // 29a4c (不結束)
        case 5: si = await this.functions(); break;                     // 215bd
        default: si = 1;
      }
    }
    await this.redrawMap();                                            // 20b40
  }
  // 0fea:32a6 = 13146 隨身物 (DS:2e57, 20 格, FF = 空) → [0538], 回傳個數
  itemList() {
    const st = this.st, P = this.c.persons; let n = 0;
    for (let i = 0; i < 0x14; i++) { const v = st.u8(0x2e57 + i); if (v !== 0xff) P[n++] = v; }
    return n;
  }
  // 29a4c 隨身物: 清單 0x8d → 道具資料 (29497: 74f7(0x0c,0x80,0x30,0xb0,1) + 29340) → MENU #0x21 (佩戴/使用) 於 y=0x108
  async belongings() {
    const { win } = this.c, ls = this.b.listSel();
    for (;;) {
      const n = this.itemList();
      const items = this.c.menuItems(0x21).slice(0, 2);
      const si = await ls.select(0x8d, n);
      if (si === -1) break;
      const it = this.c.persons[si];
      await win.open(0x0c, 0x80, 0x30, 0xb0, 1);
      this.b.itemInfo(it, 1);
      const r = await this.popMenu(0x108, items);
      await win.close();
      if (r === 0) await this.equip(it);
      else if (r === 1) await this.use(it);
    }
  }
  // 294d5 佩戴: 種類 (+13 & 0f) ≥ 7 不能裝備; 已裝備 → 除去; 否則裝上:
  //   先除去所有已裝備的隨身物, 依種類記住各類最後一件 (0..3 武器 / 4,5 甲 / 6 盾), 本件取代它那一類, 再把 3 類各自裝回
  async equip(it) {
    const st = this.st, { con } = this.c, S = this.S, R = 0x8248 + it * 0x14, t = st.u8(R + 0x13) & 0x0f;
    if (t >= 7) { this.smallWin(); con.puts(S.noEquip); await this.waitClose(); return; }
    if (st.u8(R + 0x13) & 0x10) { this.smallWin(); con.puts(S.unequip); await this.waitClose(); st.set8(R + 0x13, st.u8(R + 0x13) & 0xef); return; }
    this.smallWin(); con.puts(S.equipped); await this.waitClose();
    const cat = k => (k <= 3 ? 0 : k <= 5 ? 1 : k === 6 ? 2 : -1), slot = [0xff, 0xff, 0xff];
    for (let i = 0; i < 0x14; i++) {
      const x = st.u8(0x2e57 + i); if (x === 0xff) continue;
      const Q = 0x8248 + x * 0x14; if (!(st.u8(Q + 0x13) & 0x10)) continue;
      st.set8(Q + 0x13, st.u8(Q + 0x13) & 0xef);
      const k = cat(st.u8(Q + 0x13) & 0x0f); if (k >= 0) slot[k] = x;
    }
    { const k = cat(t); if (k >= 0) slot[k] = it; }
    for (const x of slot) if (x !== 0xff) { const Q = 0x8248 + x * 0x14; st.set8(Q + 0x13, st.u8(Q + 0x13) | 0x10); }
  }
  // 299f5 使用: 種類 7 → 298a5 (位置), 8 → 29710 (道具), 9 → 29808 (藥品, 用後消失), 0x0c → 0fea:ded6 (地圖), 其他 → 2962f
  async use(it) {
    const st = this.st, R = 0x8248 + it * 0x14, t = st.u8(R + 0x13) & 0x0f;
    switch (t) {
      case 7: return this.useNavi(R);
      case 8: return this.useTool(it);
      case 9: return this.useMedicine(it);
      case 0x0c: cmTodo("地圖類隨身物 (0fea:ded6 = 1dd76, 世界地圖繪製)"); return;
      default: return this.cantUse(t);
    }
  }
  // 2962f 用不了: 0..3「武器」4「盾」5「防禦」+「武器」6「甲」其他「這東西」+「在這兒用不了．」(cs:98b9 跳躍表, 照搬)
  async cantUse(t) {
    const { con } = this.c, S = this.S;
    this.smallWin();
    if (t <= 3) con.puts(S.kWeapon);
    else if (t === 4) con.puts(S.kShield);
    else if (t === 5) { con.puts(S.kDefense); con.puts(S.kWeapon); }
    else if (t === 6) con.puts(S.kArmor);
    else con.puts(S.kThing);
    con.puts(S.cantUse);
    await this.waitClose();
  }
  // 298a5 種類 7 (測量用具): 在港 → MESSAGE 0x2f4; 海上的位置計算未移植 (在港時不會走到)
  async useNavi() {
    if (this.st.port !== 0xff) { this.smallWin(); this.c.message(0x2f4); await this.waitClose(); return; }
    cmTodo("海上測量位置 (298a5 後半)");
  }
  // 29710 種類 8: 編號 0x17 時刻 (29694), 0x19 喵嗚 (296f8), 0x18/0x1a..0x1c 看得很遠 (296e0), 其他用不了 (cs:9996 跳躍表)
  async useTool(it) {
    const { con, printf } = this.c, S = this.S, k = it - 0x17;
    if (k < 0 || k > 5) return this.cantUse(8);
    this.smallWin();
    if (k === 0) {
      const t = this.rt.time;
      printf(S.hour, Math.trunc(t / 3));
      if (t % 3) printf(S.minute, (t % 3) * 2);
    } else con.puts(k === 2 ? S.meow : S.farSight);
    await this.waitClose();
  }
  // 29808 種類 9: 0x29 老鼠藥 ([0cb3] bit4) / 0x2a 暴風雨 (29780, [0cb3] 低 4 位 = 1) / 0x2b 壞血病 ([0cb3] bit5) / 其他用不了;
  //   之後一律從隨身物中移除第一個同編號的格子 (連「用不了」的也被消耗, 照搬)
  async useMedicine(it) {
    const st = this.st, { con } = this.c, S = this.S;
    if (it === 0x29) {
      this.smallWin();
      if ((st.u8(0x0cb3) & 0x10) === 0x10) { st.set8(0x0cb3, st.u8(0x0cb3) & 0xef); con.puts(S.ratGone); } else con.puts(S.noTrouble);
      await this.waitClose();
    } else if (it === 0x2a) {
      this.smallWin();
      if ((st.u8(0x0cb3) & 0x0f) === 1) {
        st.set8(0x0cb3, st.u8(0x0cb3) & 0xf0);
        this.c.palette.selectTimePalette(this.rt.time, st.port === 0xff, st.weather);     // 0fea:98ce = 1976e
        con.puts(this.rt.time >= 0x0c && this.rt.time < 0x3c ? S.stormDay : S.stormNight);
      } else con.puts(S.noTrouble2);
      st.set8(0x10a6, this.c.sys.rng.random(6) + 0x0a);
      await this.waitClose();
    } else if (it === 0x2b) {
      this.smallWin();
      if ((st.u8(0x0cb3) & 0x20) === 0x20) { st.set8(0x0cb3, st.u8(0x0cb3) & 0xdf); con.puts(S.scurvyCured); } else con.puts(S.good);
      await this.waitClose();
    } else await this.cantUse(st.u8(0x8248 + it * 0x14 + 0x13) & 0x0f);
    for (let i = 0; i < 0x14; i++) if (st.u8(0x2e57 + i) === it) { st.set8(0x2e57 + i, 0xff); break; }
  }
  // 215bd 功能: MENU #0x14 (環境設定/儲存檔案/取出存檔/結束遊戲) 於 y=0xf8, 無停用項;
  //   讀檔成功 → [0533..0535] = F0 (時間迴圈中止) 並回傳 1 (結束航海術選單); 其他回到此選單, 取消回傳 0
  async functions() {
    const st = this.st, { menu, palette } = this.c, items = this.c.menuItems(0x14).slice(0, 4);
    while (!palette.ending) {
      menu.disabled = 0;
      const r = await this.popMenu(0xf8, items);
      switch (r) {
        case 0: {
          const o = st.options;
          await this.settings();
          if ((st.options ^ o) & 0x80) { this.release(3); await this.reenter(); this.press(3); }   // 環境設定不會改 bit7 (死碼, 照搬)
          break; }
        case 1:
          if (st.port !== 0xff) st.set8(0x0caf, 0x82);                   // 讀檔後重新讀入入口表但保留位置
          await this.saveLoad(0); break;
        case 2:
          if (await this.saveLoad(1)) { this.rt.time = this.rt.day = this.rt.month = 0xf0; return 1; }
          break;
        case 3: await this.quit(); break;
        default: return 0;
      }
    }
    return 0;
  }
  // 214cf 環境設定: 74f7(0x18,0x20,0x20,0xc0,1); 5 個標題 (0x1a, 0x30+32i) "%-s"; 2123a 按鈕與點擊區; 迴圈 21342 顯示 → 14524(10, 2 欄, 可取消+保留游標)
  //   項目 0,1 = 表示效果 ([0ca4] bit0), 2,3 = BGM (bit2), 4..9 = 3 個數值的 −/+ (滑鼠靈敏度 [0ca8] 0..4, 海上移動值 [0ca9] 0..10, 海上速度 [0ca6] 0..10)
  async settings() {
    const st = this.st, { win, con, printf, menu } = this.c, S = this.S;
    await win.open(0x18, 0x20, 0x20, 0xc0, 1);
    const L = [S.optAnim, S.optBgm, S.optMouse, S.optSeaMove, S.optSeaSpeed];
    for (let i = 0; i < 5; i++) { con.setCursor(0x1a, 0x30 + (i << 5)); printf(S.fmtS, L[i]); }
    this.settingsParts();
    let r;
    do {
      this.settingsValues();
      r = await menu.customMenu(menu.count, 2, 3);
      const h = r >> 1;
      if (h <= 1) await this.settingsToggle(r);
      else if (h <= 4) this.settingsStep(r - 4);
    } while (r !== 0xff);
    await win.close();
  }
  // 2123a 3 列 −/+ 按鈕 ([0c86]+0x390 / 0x410 於欄 0x26 / 0x31) 與 9216 數值框; 點擊區 0..3 (每列 2 個相同的區域, 照搬) 與 4..9
  settingsParts() {
    const { scr, gfx, menu } = this.c, R = menu.rects;
    for (let si = 0; si < 3; si++) {
      const y = 0x70 + (si << 5);
      scr.putPlanar(0x26, y, 2, 0x10, gfx, 0x390);
      scr.putPlanar(0x31, y, 2, 0x10, gfx, 0x410);
      this.barFrame(0x28, 0x74 + (si << 5));
    }
    let n = 0;
    for (let bx = 0; bx < 2; bx++) for (let k = 0; k < 2; k++) R[n++] = { x0: 0x130, x1: 0x160, y0: (bx << 5) + 0x30, y1: (bx << 5) + 0x40 };
    for (let di = 0; di < 3; di++) for (let bx = 0; bx < 2; bx++) { const x0 = bx * 0x58 + 0x130; R[n++] = { x0, x1: x0 + 0x10, y0: (di << 5) + 0x70, y1: (di << 5) + 0x80 }; }
    menu.count = n;                                                    // [a158] = 10
  }
  // 21342 ON/OFF 與 3 個百分比條
  settingsValues() {
    const st = this.st, { con } = this.c, S = this.S;
    for (let si = 0; si < 2; si++) { con.setCursor(0x26, 0x30 + (si << 5)); con.puts(st.options & (si ? 4 : 1) ? S.on : S.off); }
    for (let si = 0; si < 3; si++) {
      const v = si < 2 ? Math.trunc(100 * st.u8(0x0ca8 + si) / (si ? 10 : 4)) : 10 * st.u8(0x0ca6);
      this.bar(0x28, 0x74 + (si << 5), v);
    }
  }
  // 213c5: 0 表示效果; 1 BGM (有音源驅動 [03e4] 且 [8c1e] ≠ FF 時): 開 → 9670 重播目前曲目, 關 → 9888 + 9712(5) 淡出並等待
  async settingsToggle(r) {
    const st = this.st;
    if ((r >> 1) === 0) { st.options = st.options ^ 1; return; }
    if (this.c.noSoundDriver) return;
    st.options = st.options ^ 4;
    if (st.options & 4) this.p.portBgm(); else this.c.bgm.fadeOut();
  }
  // 21432: si = 項目 − 4; 奇數 +1 (不超過上限), 偶數 −1 (不低於 0); 之後 seg0:5022 以 ([0ca8]+2)×2 設定滑鼠速度
  settingsStep(si) {
    const st = this.st, max = si >= 2 ? 10 : 4, a = si < 4 ? 0x0ca8 + (si >> 1) : 0x0ca6, v = st.u8(a);
    if (si & 1) st.set8(a, v + cmUmin(max - v, 1)); else st.set8(a, v - cmUmin(v, 1));
    const m = (st.u8(0x0ca8) + 2) * 2; this.c.sys.mickeyRatio = [m, m];
  }
  // seg0:9216 數值框 (欄 x, y)
  barFrame(x, y) {
    const s = this.c.scr, si = (x << 3) + 4;
    s.fillCols(x + 1, y, 7, 8, 5);
    s.fillRectPxPlanes(si, y, si + 5, y + 7, 5, 4);
    s.fillRectPxPlanes(si + 0x38, y, si + 0x3d, y + 7, 5, 4);
    s.rectOutline(si, y, si + 0x3d, y + 7, 0);
    s.rectOutline(si + 5, y + 1, si + 0x38, y + 6, 0);
    s.line(si, y, si + 0x3d, y, 7);
    s.line(si, y, si, y + 7, 7);
    s.line(si + 5, y + 6, si + 0x38, y + 6, 7);
    s.line(si + 0x38, y + 1, si + 0x38, y + 6, 7);
  }
  // seg0:92f7 百分比條 (0..100 → 0..50 像素), 顏色 DS:bafa / bafc
  bar(x, y, v) {
    const s = this.c.scr, [ca, cb] = this.c.barColors;
    const si = Math.trunc((v < 0 ? 0 : v > 100 ? 100 : v) / 2), x8 = x << 3;
    if (si) s.fillRectPxPlanes(x8 + 0x0a, y + 2, x8 + si + 9, y + 5, ca, 4);
    if (si !== 50) s.fillRectPxPlanes(x8 + si + 0x0a, y + 2, x8 + 0x3b, y + 5, cb, 4);
  }
  // 0fea:7042 = 16ee2(mode): 0/2/3 存檔 (16cf0), 1 讀檔 (16b3f); 讀檔成功且 mode = 1 時 1721f 重新進港, 回傳 1
  async saveLoad(mode) {
    if (mode === 1) {
      const ok = await new Title(this.c).loadMenu();
      if (ok) { await this.reenter(); return 1; }
      return 0;
    }
    await this.save(mode);
    return 0;
  }
  // 16cf0 存檔: 16a03 存檔一覽 (標題「儲存進度」) → 14524(10,1,1) → 74f7(0x18,0x100,0x20,0x30,1) MESSAGE 0x3ba 是/否
  //   標頭 15 bytes: 日 (≤8 時十位為空白) "/" 月字串 (DS:8af0) "/15" 年 (+9,+10), +12 港, +13 = mode ([0ca4] 無 bit6 → 2, 無 bit1 → 3);
  //   [0caa..0cad] = 目前日期時刻, 寫入 DS:0CA4..8A18 + 緩衝 [0c8e] 0x300 bytes
  async save(mode) {
    const st = this.st, { win, con, menu, message } = this.c, f = this.c.saveFile, T = new Title(this.c);
    const hdr = f.headers();
    await T.slotList(hdr, 4);
    let flag = mode;
    if (!(st.options & 0x40)) flag = 2; else if (!(st.options & 2)) flag = 3;
    for (;;) {
      T.slotRects();
      const sel = await menu.customMenu(10, 1, 1);
      if (sel === 0xff) { await win.close(); return 0; }
      await win.open(0x18, 0x100, 0x20, 0x30, 1);
      con.setCursor(0x1a, 0x110); message(0x3ba);
      if (!await menu.yesNo()) { await win.close(); continue; }
      const h = new Uint8Array(15), rt = this.rt, d = rt.day;
      h[0] = d > 8 ? 0x30 + Math.trunc((d + 1) / 10) : 0x20;
      h[1] = 0x30 + (d + 1) % 10; h[2] = 0x2f;
      let k = 3;
      const cat = s => { for (let i = 0; s[i]; i++) h[k++] = s[i]; };   // strcat (4d31)
      cat(this.p.months[rt.month]); cat(this.S.saveYear);
      h[9] = (0x30 + Math.trunc((rt.year + 1) / 10)) & 0xff; h[10] = 0x30 + (rt.year + 1) % 10;
      h[12] = st.port; h[13] = flag;
      st.set8(0x0caa, rt.year); st.set8(0x0cab, rt.month); st.set8(0x0cac, rt.day); st.set8(0x0cad, rt.time);
      f.writeSlot(sel, h, st.b);
      await win.close(); await win.close();
      return 1;
    }
  }
  // 2157f 結束遊戲: 7849(0x11,0xa0,0x20,0x50,1)「可以結束嗎？」是 → 淡出, [03ea] = 0x88 (主迴圈結束後回到標題, 見 clock.js)
  async quit() {
    const { win, con, menu, palette } = this.c;
    win.shadowedSaved(0x11, 0xa0, 0x20, 0x50, 1);
    con.puts(this.S.quitAsk);
    const yes = await menu.yesNo();
    await win.close();
    if (!yes) return;
    await palette.fadeBlack();
    palette.ending = 0x88;
  }
}
