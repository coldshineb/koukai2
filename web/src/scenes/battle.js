// scenes/battle.js — 海战 (MAIN.EXE 10f7e 以下; docs/RE_NOTES.md 第 30 节)
// 由 SeaScene.navalBattle(al, dl, bl, arg) 调用: new NavalBattle(sea).run(al, dl, bl, arg)
// 原版的海战工作区都在 DS (不在存盘内), 这里以「原版 DS 地址」访问, 方便与反汇编逐条对照、与模拟器的内存逐字节比对:
//   W = DS 镜像 (Uint8Array 0x10000, 只用 8e14 以后; 初值 = MAIN.EXE 的 DS:9bfe..9d2f, 存在 ctx.battleDS, 与原版一样跨场海战保留)
//   DS 0ca4..8d17 (存盘区) 一律读写 GameState
//   8e14  战场地图 0x34 栏 × 0x30 列 (bit7 陆地, bit5/6 船 (偶数 / 奇数方), 低 5 比特 = 图块)
//   97d4..97df  三个战场缓冲的远指针 (0f08a, [0c8a] 的 EMS / 一般内存; 移植版不用, 比对时略过)
//   97e0  4 方 × 8 bytes: +0 旗舰 (船链开头)  +2 目前的船  +4 舰队记录  +6 指挥者  +7 船数
//         方 0 = AL (攻方)、1 = DL (守方)、2 = BL (攻方援军)、3 = 堆栈参数 (守方援军); 地图以方 1 的舰队为中心
//   9800  战场上的船 4 方 × 10 × 0x18: +0 船长 (人物记录)  +2 船位 (舰队 +2b + 9i)  +4 位置 (列 × 0x34 + 栏)  +6/+8 下一艘
//         +0a 方向 (0..5)  +0c 状态 (bit6 沉没, 0x20 旗舰 …)  +0d 标志 (bit7/6 攻守, bit4-5 方, 低 4 比特 = 船链中的序号)
//         +0e 砲数  +10..+14 各距离的命中率  +15 射程  +16 战力  +17 士气
//   9bc0 目前这一方 (97e0 + 8k)  9bc2 目前的船  9bef/9bf0 窗口左上 (栏 / 列)  9bf2..9bf7 风力表  9bf8 风向  9bf9 风力
//   9bfb 结束原因 (0 = 继续; 1 日落, 2/3/9 对话后不打, 4/5 一方全灭, 8 剧本)  9c2a/9c2c  9d3e 主角在攻方  9d40/9d42 双方战力
// 一骑打 12998 以下: scenes/duel.js (RE_NOTES 30.16..30.18)
import { Scenario, ENV_COMMON, ENV_HERO } from "../game/scenario.js";
import { duelInBattle } from "./duel.js";
import {
  WorldConst,
  appendTradeLog,
  fleetByAddr,
  fleetShipSlot,
  getCountryExtra,
  getFleetOfficer,
  getWorkState,
  heroShipSlot,
  personByAddr,
  personRawBytes,
  shipSlotByAddr,
  toggleSpritePhase,
} from "../model/world_helpers.ts";
import { hasDom, runDomStoryCard } from "../ui/modals.ts";
import { BATTLE_VIEWPORT, renderWideBattle, hideDomBattleHud, runDomBattleFleetModal, runDomBattlePersonModal, runDomBattleCrewModal, runDomBattleShipModal, runDomBattleOrdersModal, runDomBattleSignal, runDomBattleShipOrders } from "../ui/battle_hud.ts";
import { captureConsoleText, createEscStripper, toSimp } from "../ui/text_util.ts";

const btHex = s => Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16)));
const btS16 = v => (v << 16) >> 16;
const btS8 = v => (v << 24) >> 24;
const btIdiv = (a, b) => Math.trunc(a / b);                       // 有号除法 (向零取整)
const btImod = (a, b) => a - Math.trunc(a / b) * b;               // 有号余数 (与被除数同号)
const btUmin = (a, b) => ((a & 0xffff) > (b & 0xffff) ? b & 0xffff : a & 0xffff);   // seg0:4d7c
const btUmax = (a, b) => ((a & 0xffff) < (b & 0xffff) ? b & 0xffff : a & 0xffff);   // seg0:4d87
const btUdiv32 = (a, b) => Math.floor((a >>> 0) / (b >>> 0)) >>> 0;   // seg0:38ba (32 比特无号除法)
const btSdiv32 = (a, b) => Math.trunc((a | 0) / (b | 0)) | 0;        // seg0:3722 (32 比特有号除法)
const btMul32 = (a, b) => Math.imul(a | 0, b | 0) >>> 0;            // seg0:37bc (32 比特乘法, 取低 32 比特)
const btWarned = new Set();
const btTodo = n => { if (!btWarned.has(n)) { btWarned.add(n); console.warn("尚未移植: " + n); } };

export class NavalBattle {
  constructor(sea) {
    this.sea = sea; this.c = sea.c;
    const J = sea.P.battle;                                               // assets/data/battle.json (tools/extract_battle.py)
    this.J = J; this.hd = sea.P.hdat;                                     // HDAT.PUT = [03ee]:0
    this.coast = new Map(Object.entries(J.coast).map(([k, v]) => [+k, v]));
    if (!this.c.battleDS) {                                               // DS 工作区: MAIN.EXE 的初值
      const W = new Uint8Array(0x10000); for (const [a, h] of Object.entries(J.ds)) W.set(btHex(h), parseInt(a, 16)); this.c.battleDS = W;
    }
    this.W = this.c.battleDS;
  }
  get st() { return this.c.state; }
  get m() { return this.c.state.model; }
  // ---- DS 访问: 存盘区走 GameState (供 battle_hud 兼容层), 其他走 W ----
  u8(a) { a &= 0xffff; return a >= 0x0ca4 && a < 0x8d18 ? this.st.u8(a) : this.W[a]; }
  u16(a) { return this.u8(a) | (this.u8(a + 1) << 8); }
  s16(a) { return btS16(this.u16(a)); }
  set8(a, v) { a &= 0xffff; if (a >= 0x0ca4 && a < 0x8d18) this.st.set8(a, v); else this.W[a] = v & 0xff; }
  set16(a, v) { this.set8(a, v & 0xff); this.set8(a + 1, (v >> 8) & 0xff); }
  or8(a, v) { this.set8(a, this.u8(a) | v); }
  and8(a, v) { this.set8(a, this.u8(a) & v); }
  ds(a) { const W = this.W; let e = a; while (W[e]) e++; return W.subarray(a, e + 1); }   // DS 上的 C 字符串 (含结尾 0)
  cstr(a) { return a >= 0x0ca4 && a < 0x8d18 ? this.st.cstr(a) : this.ds(a); }
  rnd(n) { n &= 0xffff; return n ? this.c.sys.rng.random(n) & 0xffff : 0; }                // seg0:4dc4 (n = 0 时不取随机数)
  get heroFleet() { return this.sea.fleet; }                                                // [c2d4]
  pos(B) { const p = this.s16(B + 4); return [btImod(p, 0x34), btIdiv(p, 0x34)]; }       // 位置 → (栏, 列)
  mapAt(x, y) { return (0x8e14 + y * 0x34 + x) & 0xffff; }

  // ================= 10f7e 海战 =================
  async run(al, dl, bl, arg) {
    const m = this.m, ws = getWorkState(m), hero = m.globals.hero;
    const enemy = hero === al ? dl : al;
    ws.commonBattleTarget = enemy; ws.heroBattleTarget = enemy;
    // 0be20: HDAT.PUT → [03ee]:0 (移植版直接使用资源 hdat.bin)
    this.set8(0x9bfb, 0);
    const ally = { a: bl & 0xff, d: arg & 0xff };
    await this.allies(al, dl, ally);                                    // 10e68
    const si = await this.open(al, dl, ally.a, ally.d);                // fcf9
    if (this.u8(0x9bfb) === 0) await this.mainLoop();                  // fe9a
    const other = hero === al ? dl : al;
    await this.after(si, other);                                       // 10bdf
    await this.backToSea();                                            // bd26 / ff5c / 19ba1 / 851f
  }

  // 10e68 援军: 主角不是海盗 (+31 & 0f ≠ 6) 时, 附近 (12fea(2)) 的舰队中, 不是双方指挥者、+2c % 10 ≥ 5 (护卫舰队) 且与某方同国的加入
  async allies(al, dl, ally) {
    const wm = this.m, n = this.sea.nearFleets(2);
    const nA = Math.floor(wm.person(al).fleet / 10), nD = Math.floor(wm.person(dl).fleet / 10);
    if ((wm.heroPerson().face & 0x0f) === 6) return;
    for (let di = 0; di < n; di++) {
      const p = this.c.persons[di];
      if (p === dl || p === al) continue;
      const R = wm.person(p), f = R.fleet;
      if (f % 10 < 5) continue;
      let m;
      if (ally.d === 0xff && Math.floor(f / 10) === nD) { ally.d = p; m = 0x30b; }
      else if (ally.a === 0xff && Math.floor(f / 10) === nA) { ally.a = p; m = 0x30c; }
      else continue;
      if (this.c.scr.wideRenderer) this.sea.b.beginWideTalk(null);
      else this.c.win.shadowedSaved(0x14, 0x80, 0x1e, 0x60, 0);
      this.c.message(m, R.givenNameBytes, R.familyNameBytes);
      await this.c.menu.waitPrompt();
      await this.c.win.close();
    }
  }

  // ================= fcf9 开战 =================
  async open(al, dl, bl, arg) {
    const { palette, bgm, sys, scr, con, codec } = this.c, ws = getWorkState(this.m);
    scr.wideDialog = null;
    scr.wideOverlays.length = 0;
    await palette.fadeBlack();                                          // 99f2（先在原海上画面淡黑，避免未初始化的战场层闪现原版 UI）
    bgm.playSong(0x10);                                                 // 9670(0x10)
    this.sea.cursor = 0x2570; sys.setCursorShape(0x2570);               // [06d6] = 0x2570, 5050
    const di = this.setup(al, dl, bl, arg);                             // f84d
    this.drawPanel();                                                   // c581
    this.drawField();                                                   // c5ff
    if (hasDom()) {
      scr.wideRenderer = (ctx, s) => renderWideBattle(ctx, s, this);
      scr._battleHudActive = true;
      scr._battleMsg = () => this._wideMsg || "";
      sys._battleViewport = BATTLE_VIEWPORT;
      this._msgRaw = [];
      this._wideMsg = "";
      if (!this._origBattlePutc && codec) {
        const orig = con.putc.bind(con);
        const strip = createEscStripper(b => {
          this._msgRaw.push(b);
          this._wideMsg = codec.decode(Uint8Array.from(this._msgRaw)).replace(/\{[0-9A-F]{2}\}/g, "").trim();
          scr.dirty = true;
        });
        this._origBattlePutc = con.putc;
        con.putc = ch => {
          if (con.left === 0x36 && con.right === 0x4b && con.x >= 0x35 && con.y >= 0x148 && !this.sea.b._wideTalk) strip(ch);
          return orig(ch);
        };
      }
    } else {
      scr.wideRenderer = null;
    }
    await this.fadeIn();                                                // bcfa
    // 剧本: 2e09:55c2(0xa1, [0d56]) / 2e09:5546、2e09:5481(0xa1, [0de0]) / 2e09:53f0 — 剧本要求时 [9bfb] = 8, 不打
    let si = 0;
    if (!this.c.noEvents) {
      const sc = (this.c.events ??= new Scenario(this.c)); sc.scene = this.sea;
      const no = () => { this.set8(0x9bfb, 8); return 0xffff; };
      if ((await sc.check(ENV_HERO, 0xa1, ws.heroBattleTarget & 0xff)) && !(await sc.run(ENV_HERO))) return no();
      si = await sc.check(ENV_COMMON, 0xa1, ws.commonBattleTarget & 0xff);
      if (si && !(await sc.run(ENV_COMMON))) return no();
    }
    if (ws.commonEvent === 0 && ws.heroEvent === 0) {
      if (await this.parley(si)) return 0xffff;                         // fcdb
    }
    await this.desert();                                                // f89e
    this.drawShips();                                                   // c0ad
    this.set8(0x9c2a, 100); this.set16(0x9c2c, 0);
    return di;
  }

  // f84d 编成
  setup(al, dl, bl, arg) {
    const hero = this.m.globals.hero;
    this.set8(0x97e6, al); this.set8(0x97ee, dl); this.set8(0x97f6, bl); this.set8(0x97fe, arg);
    this.set16(0x9d3e, hero === al || hero === bl ? 1 : 0);
    const si = this.sides();                                            // f58a
    this.makeMap();                                                     // f08a
    this.place();                                                       // f754
    this.viewOrigin();                                                  // f82c
    return si;
  }
  // f58a 4 方的舰队: [9d40] / [9d42] = 主角方 / 对方 的战力 (舰队 +28) 总和; 返回 非主角方的 Σ 船位 +3
  sides() {
    const m = this.m;
    let di = 0; this.set16(0x9d42, 0); this.set16(0x9d40, 0);
    const A = this.u16(0x9d3e);
    for (let k = 0; k < 4; k++) {
      const E = 0x97e0 + 8 * k;
      if (this.u8(E + 6) !== 0xff) {
        const F = m.fleet(m.person(this.u8(E + 6)).fleet);
        this.set16(E + 4, F.addr);
        this.fleetPower(F.addr);                                        // 0fea:83f9
        const mine = (A && !(k & 1)) || (!A && (k & 1));
        const w = mine ? 0x9d40 : 0x9d42;
        this.set16(w, this.u16(w) + F.strength);
        this.set8(E + 7, this.ships(E, k));                             // f3dd
        this.set16(E + 2, this.u16(E));
        di = (di + this.crewSum(E)) & 0xffff;                           // f568
      } else {
        this.set16(E + 4, 0); this.set8(E + 7, 0); this.set16(E, 0); this.set16(E + 2, 0);
      }
    }
    return di;
  }
  // 0fea:83f9 = 18299: 舰队 +28 = (Σ 在的船 +2 + 4) / 5; 总和 0 → +29 &= FE
  fleetPower(fAddr) {
    const F = fleetByAddr(this.m, fAddr); let sum = 0;
    for (let i = 0; i < 10; i++) { const S = fleetShipSlot(F, i); if ((S.flags & 0x30) === 0x10) sum += S.durability; }
    F.strength = Math.trunc((sum + 4) / 5);
    if (!sum) F.flags &= 0xfe;
  }
  // f568 船链的 Σ 船位 +3 (开头的船 +0d bit7 = 主角方时 0)
  crewSum(E) {
    const m = this.m;
    let dx = 0, si = this.u16(E);
    if (this.u8(si + 0x0d) & 0x80) return 0;
    for (; si; si = this.u16(si + 8)) dx += shipSlotByAddr(m, this.u16(si + 2)).maxDurability;
    return dx & 0xffff;
  }
  // f3dd 一方的船 (DS:9800 + 0xf0 × k): 舰队的 10 个船位
  ships(E, k) {
    const m = this.m, F = fleetByAddr(m, this.u16(E + 4)), A = this.u16(0x9d3e), hf = this.heroFleet;
    let si = 0x9800 + ((0xf0 * k) & 0xffff), first = 1, cnt = 0;
    const mine = (A && !(k & 1)) || (!A && (k & 1));
    const fl = mine ? (F.addr === hf ? 0x80 : 0xc0) : k >= 2 ? 0x40 : 0;
    for (let i = 0; i < 10; i++, si += 0x18) {
      const S = fleetShipSlot(F, i);
      if ((S.flags & 0x30) === 0x10) {
        const cap = F.addr === hf ? m.crewSlot(i).captain : this.u8(E + 6);
        this.set8(si + 0x0d, ((k << 4) | fl | i) & 0xff);
        this.set16(si, m.person(cap).addr); this.set16(si + 2, S.addr); this.set16(si + 4, 0); this.set16(si + 6, 0); this.set16(si + 8, 0);
        this.set8(si + 0x0a, 0); this.set8(si + 0x0b, 0);
        let mo;
        // 主角舰队: 100 − 船员 +8 − 船员 +9; 原版第二次调用 5c38 时 AL 还是 +9 的值, 所以 +8 取的是「船员 (+9 的值)」的 (照搬)
        if (F.addr === hf) { const v9 = m.crewSlot(i).lookRatio; mo = (100 - m.crewSlot(v9).navRatio - v9) & 0xff; }
        else mo = m.ship(S.ship).flags & 0x10 ? 0x19 : 0x32;
        this.set8(si + 0x17, mo);
        this.shipStats(si, E, first);                                    // f259
        this.set8(si + 0x0c, this.shipFlags(si));                        // f0c6
        first = 0; cnt++;
      } else {
        this.set8(si + 0x0d, 0);
        for (const o of [0, 2, 4, 6, 8]) this.set16(si + o, 0);
        this.set8(si + 0x0a, 0); this.set8(si + 0x0b, 0); this.set8(si + 0x0c, 0); this.set16(si + 0x0e, 0);
        for (const o of [0x15, 0x14, 0x13, 0x12, 0x11, 0x10, 0x16]) this.set8(si + o, 0);
      }
    }
    this.chain(E, k);                                                   // f13f
    return cnt & 0xff;
  }
  // eb9e 船位 S 在主角舰队中的序号 (找不到 → 0)
  heroSlotIndex(B) {
    const m = this.m, sAddr = this.u16(B + 2);
    for (let i = 0; i < 10; i++) if (heroShipSlot(m, i).addr === sAddr) return i;
    return 0;
  }
  // f259 砲数 / 射程 / 命中率 / 战力
  shipStats(si, E, first) {
    const m = this.m, slot = shipSlotByAddr(m, this.u16(si + 2));
    const T = [0, 0, 0, 0, 0, 0, 0x0a, 0, 0, 0, 0, 0x0a, 9, 0, 0, 0, 0x0a, 9, 8, 0, 0, 0x0a, 9, 8, 7];
    let mul;
    if (this.u16(E + 4) === this.heroFleet) {
      this.set16(si + 0x0e, m.crewSlot(this.heroSlotIndex(si)).ammo);
      mul = 3;
    } else {
      const R = m.ship(slot.ship);
      const b1 = Math.floor(m.shipType(R.type).maxGuns / 5);
      const f = personByAddr(m, this.u16(si)).fleet;
      if ((f % 10 === 0 || f % 10 >= 5) && (R.flags & 0x10)) this.set16(si + 0x0e, b1); else this.set16(si + 0x0e, 0);
      this.set16(si + 0x0e, (this.u16(si + 0x0e) + (this.rnd(b1) & 0xff)) & 0xffff);
      mul = first ? 3 : 2;
    }
    const g = slot.flags & 7;
    let r = this.J.t07ec[g];
    this.set8(si + 0x15, r);
    if (r) r--;
    for (let i = 0; i < 5; i++) this.set8(si + 0x10 + i, (T[5 * r + i] * this.J.t07fc[g]) & 0xff);
    const P = personByAddr(m, this.u16(si)), a = P.battleLevel, b = P.getStats(5);
    this.set8(si + 0x16, Math.floor(((Math.floor((a * b) / 100) + (b >> 1)) * mul) / 3));
  }
  // f0c6 +0c: random(50) > 船长 +20 → 2, 否则 3; 有砲且船 +10 bit4 → |0x10; 舰队 % 10 在 1..4 且国籍 ≠ 6 → |8
  shipFlags(si) {
    const m = this.m, P = personByAddr(m, this.u16(si));
    let v = this.rnd(0x32) > P.getStats(4) ? 2 : 3;
    if (this.u16(si + 0x0e) && (m.ship(shipSlotByAddr(m, this.u16(si + 2)).ship).flags & 0x10)) v |= 0x10;
    const f = P.fleet;
    if (f % 10 !== 0 && Math.floor(f / 10) !== 6 && f % 10 < 5) v |= 8;
    return v;
  }
  // f13f 船链: 旗舰 (主角舰队 = 主角的船; 其他 = 船位 +3 最大的第一艘) 开头, 其余依船位顺序; +0c = 0x22; +0d 低 4 比特重新编号
  chain(E, k) {
    const m = this.m, hero = m.globals.hero, base = 0x9800 + ((0xf0 * k) & 0xffff), list = [];
    let flag = 0, best = 0;
    for (let i = 0, si = base; i < 10; i++, si += 0x18) {
      const S = this.u16(si + 2);
      if (!S) continue;
      const slot = shipSlotByAddr(m, S);
      if ((slot.flags & 0x30) !== 0x10) continue;
      list.push(i);
      if (this.u16(E + 4) === this.heroFleet) { if (m.crewSlot(i).captain === hero) flag = i; }
      else if (slot.maxDurability > best) { flag = i; best = slot.maxDurability; }
    }
    const head = (base + 0x18 * flag) & 0xffff;
    this.set16(E, head);
    this.set8(head + 0x0c, 2); this.or8(head + 0x0c, 0x20);
    let si = head, j = 0;
    while (list.length > j) {
      if (list[j] === flag) j++;
      if (list.length > j) { this.set16(si + 8, (base + 0x18 * list[j]) & 0xffff); j++; si = this.u16(si + 8); }
      else { this.set16(si + 8, 0); break; }
    }
    let n = 0;
    for (si = this.u16(E); si; si = this.u16(si + 8)) { this.and8(si + 0x0d, 0xf0); this.or8(si + 0x0d, n); n++; }
  }

  // f08a 战场地图: 方 1 舰队周围 6 × 6 的海图格 (陆地 = 图块 ≥ 0x34) 放大 8 倍 → 8e14, 陆地边缘随机; ebce 海岸; f022 风
  makeMap() {
    const sea = this.sea, F1 = fleetByAddr(this.m, this.u16(0x97ec));
    const bx = btImod(btS16(F1.x), 0x2d0) - btS16(sea.bda6) - 2, by = btImod(btS16(F1.y), 0x438) - btS16(sea.bdaa) - 2;
    const g = new Uint8Array(36);
    for (let di = 0; di < 6; di++) for (let si = 0; si < 6; si++) g[di * 6 + si] = sea.seaBuf[((by + di) * 0x60 + bx + si) & 0xffff] >= 0x34 ? 0x84 : 1;
    for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 6; dx++)
      for (let r = dy * 8; r < (dy + 1) * 8; r++) for (let c = dx * 8 + 2; c < dx * 8 + 0x0a; c++) this.set8(0x8e14 + r * 0x34 + c, g[dy * 6 + dx]);
    for (let si = 0; si < 6; si++) for (let bxx = 0; bxx < 6; bxx++) {
      if (g[si * 6 + bxx] & 0x80) continue;
      const x0 = Math.max(0, bxx * 8 - 4) + 2, x1 = Math.min(0x30, bxx * 8 + 0x0c) + 2;
      const y0 = Math.max(0, si * 8 - 4), y1 = Math.min(0x30, si * 8 + 0x0c);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const cell = g[btIdiv(y, 8) * 6 + btIdiv(x, 8)];
        this.set8(0x8e14 + y * 0x34 + x, (cell & 0x80) && this.rnd(2) ? 0 : 1);
      }
    }
    for (let y = 0; y < 0x30; y++) {
      const r = 0x8e14 + y * 0x34;
      this.set8(r + 1, this.u8(r + 2)); this.set8(r, this.u8(r + 2));
      this.set8(r + 0x32, this.u8(r + 0x31)); this.set8(r + 0x33, this.u8(r + 0x31));
    }
    this.coastTiles();                                                  // ebce
    this.wind();                                                        // f022
  }
  // ebce 陆地格依 8 邻格 (bit7 = 左上 … bit0 = 右下, 该邻格不是陆地时置位; 超出地图以边缘代替) 换成海岸图块
  coastTiles() {
    for (let si = 0; si < 0x30; si++) for (let bx = 0; bx < 0x34; bx++) {
      if (!(this.u8(this.mapAt(bx, si)) & 0x80)) continue;
      let m = 0, bit = 0x80;
      for (let dy = si - 1; dy <= si + 1; dy++) {
        const yy = Math.min(Math.max(dy, 0), 0x2f);
        for (let dx = bx - 1; dx <= bx + 1; dx++) {
          const xx = Math.min(Math.max(dx, 0), 0x33);
          if (dy === si && dx === bx) continue;
          if (!(this.u8(0x8e14 + yy * 0x34 + xx) & 0x80)) m |= bit;
          bit >>= 1;
        }
      }
      const t = this.coast.get(m);
      if (t !== undefined) this.set8(this.mapAt(bx, si), t);
    }
  }
  // f022 风: [9bf9] = random(8) + 1, [9bf8] = random(8) × 5 / 7; [9bf2 + (i % 6)] (i = [9bf8] .. [9bf8] + 5) = 与风向的距离换算
  wind() {
    this.set8(0x9bf9, this.rnd(8) + 1);
    const di = Math.floor((this.rnd(8) * 5) / 7);
    this.set8(0x9bf8, di);
    for (let si = di; si < di + 6; si++) {
      const v = si - di > 3 ? di - si + 7 : si - di + 1;
      this.set8(0x9bf2 + btImod(si, 6), v);
    }
  }
  // f754 配置: 各方方向 (f63b), 以方 1 舰队的位置为准换算成 5 × 5 的格 → f66f
  place() {
    const m = this.m, B1 = fleetByAddr(m, this.u16(0x97ec)), x0 = btS16(B1.x), y0 = btS16(B1.y);
    for (let k = 0; k < 4; k++) {
      const E = 0x97e0 + 8 * k;
      if (!this.u16(E + 4)) continue;
      this.sideDir(E);                                                  // f63b
      const F = fleetByAddr(m, this.u16(E + 4));
      let gx = btS16(F.x) - x0 + 2; const cy = btS16(F.y) - y0 + 2;
      if (gx < 0) gx = 0;
      if (gx > 4) gx = 4;
      let gy = cy < 0 ? 0 : cy;                                         // 原版: cy ≥ 0 时 di = cy (再夹到 4), 否则 di = 0
      if (gy > 4) gy = 4;
      this.placeSide(E, gx * 8 + 0x0a, (gy + 1) * 8);                   // f66f
    }
  }
  // f63b 方向 = (舰队 +1a × 5 / 7) % 6
  sideDir(E) {
    const d = btImod(btIdiv((5 * fleetByAddr(this.m, this.u16(E + 4)).dir) & 0xffff, 7), 6);
    for (let si = this.u16(E); si; si = this.u16(si + 8)) this.set8(si + 0x0a, d);
  }
  inMap(x, y) { return x >= 0 && x < 0x34 && y >= 0 && y < 0x30; }      // d6dd
  side(B) { return this.u8(B + 0x0d) >> 4; }                            // d626
  // f66f 旗舰放在 (x, y) 附近 (±8 的空海格), 其余的船在旗舰 ±4 内 (找到空海格为止, 同一艘一直重抽); 地图格 |= 0x20 << (方 & 1)
  placeSide(E, cx, cy) {
    let x = cx, y = cy;
    while (!this.inMap(x, y) || (this.u8(this.mapAt(x, y)) & 0xe0)) { x = this.rnd(0x10) + cx - 8; y = this.rnd(0x10) + cy - 8; }
    let di = this.u16(E);
    const p = (0x34 * y + x) & 0xffff;
    this.set16(di + 4, p);
    const bit = 0x20 << (this.side(di) & 1);
    this.or8(0x8e14 + p, bit);
    for (di = this.u16(di + 8); di;) {
      const sx = this.rnd(8) + x - 4, sy = this.rnd(8) + y - 4;
      if (!this.inMap(sx, sy) || (this.u8(this.mapAt(sx, sy)) & 0xe0)) continue;
      const q = (0x34 * sy + sx) & 0xffff;
      this.set16(di + 4, q); this.or8(0x8e14 + q, bit);
      di = this.u16(di + 8);
    }
  }
  // f82c 窗口左上: 主角舰队那一方的旗舰 (f7e3: 栏 − 6 (0..0x27), 列 − 6 (0..0x24))
  viewOrigin() {
    for (let k = 0; k < 4; k++) {
      const E = 0x97e0 + 8 * k;
      if (this.u16(E + 4) === this.heroFleet) this.viewFor(this.u16(E));
    }
  }
  // f7e3 以船 B 为准的窗口左上: 栏 − 6 (0..0x27)、列 − 6 (0..0x24)
  viewFor(B) {
    const [x, y] = this.pos(B);
    this.set8(0x9bf0, 0); this.set8(0x9bef, 0);
    if (x > 6) { this.set8(0x9bef, x - 6); if (this.u8(0x9bef) > 0x27) this.set8(0x9bef, 0x27); }
    if (y > 6) { this.set8(0x9bf0, y - 6); if (this.u8(0x9bf0) > 0x24) this.set8(0x9bf0, 0x24); }
  }

  // ================= 画面 =================
  // c581 右侧面板: GRAPH.DAT #0x1a 于 (0x1a0, 0)、c327、小地图底色、风向盘 ([0c86] + 0x490 + 0x320 × ((15 × 风向 − 风向 / 3) / 10))、c2ee
  drawPanel() {
    const { graph, scr, gfx } = this.c;
    graph.draw(0x1a, 0x1a0, 0);
    this.status();                                                      // c327
    scr.fillCols(0x35, 8, 0x1a, 0xc0, 5);
    const w = this.u8(0x9bf8), si = (btIdiv(0x0f * w - Math.floor(w / 3), 10) * 0x320) & 0xffff;
    const dialIdx = Math.min(8, Math.max(0, Math.trunc(si / 0x320)));
    this.c.art?.drawSheetTile(scr, "dials", dialIdx, 0x37 * 8, 0xe6);
    this.msgArea();                                                     // c2ee
  }
  // c2ee 消息区: 0906(0x35, 0x148, 0x18, 0x38, 0), 左右边界 0x36 / 0x4b, 光标 (0x36, 0x150), 字符串 9cb8
  msgArea() {
    const { scr, con } = this.c;
    this._msgRaw = [];
    this._wideMsg = "";
    scr.fillCols(0x35, 0x148, 0x18, 0x38, 0);
    con.right = 0x4b; con.left = 0x36; con.setCursor(0x36, 0x150);
    con.puts(this.ds(0x9cb8));
  }
  // c327 状态: 主角旗舰的 耐久 / 水手 / 转向 / 推进 / 砲弹、船名、时辰
  status() {
    const { scr, con, printf } = this.c, m = this.m;
    con.left = 0x36; con.right = 0x4d;
    con.puts(this.ds(0x9cc0));
    let B = 0, di = null, R = null, T = null;
    for (let k = 0; k < 4; k++) {
      const E = 0x97e0 + 8 * k;
      if (this.u16(E + 4) !== this.heroFleet) continue;
      B = this.u16(E); di = shipSlotByAddr(m, this.u16(B + 2)); R = m.ship(di.ship); T = m.shipType(R.type);
      break;
    }
    scr.fillCols(0x3f, 0xe8, 0x0e, 0x50, 7);
    scr.fillCols(0x3b, 0x118, 1, 0x10, 7);
    scr.fillCols(0x3b, 0xd4, 1, 0x10, 7);
    con.setCursor(0x37, 0xd4); printf(this.ds(0x9cc8));
    con.setCursor(0x37, 0x118); con.puts(this.ds(0x9ccd));
    con.setCursor(0x3f, 0xe8); con.puts(this.ds(0x9cd2));
    con.setCursor(0x3f, 0xf8); con.puts(this.ds(0x9cd9));
    con.setCursor(0x3f, 0x108); con.puts(this.ds(0x9ce0));
    con.setCursor(0x3f, 0x118); con.puts(this.ds(0x9ce7));
    con.setCursor(0x3f, 0x128); con.puts(this.ds(0x9cee));
    con.setCursor(0x3e, 0xd8); printf(this.ds(0x9cf5), R.nameBytes);
    const t = this.c.rt.time & 0xff;
    con.setCursor(0x38, 0x128); printf(this.ds(0x9cfa), Math.floor(t / 3));
    con.setCursor(0x3b, 0x128); printf(this.ds(0x9cfe), (t % 3) * 0x14);
    con.setCursor(0x46, 0xe8); printf(this.ds(0x9d03), di.durability, di.maxDurability);
    con.setCursor(0x46, 0xf8); printf(this.ds(0x9d0b), di.crew, R.maxCrew);
    con.setCursor(0x46, 0x108); printf(this.ds(0x9d13), di.turn, T.turn);
    con.setCursor(0x46, 0x118); printf(this.ds(0x9d1b), di.propulsion, T.propulsion);
    con.setCursor(0x46, 0x128); printf(this.ds(0x9d23), this.u16(B + 0x0e));
  }
  // be86 (栏, 列) 在窗口内 (13 × 12)
  inView(x, y) {
    const ox = this.u8(0x9bef), oy = this.u8(0x9bf0);
    return ox <= x && ox + 0x0d > x && oy <= y && oy + 0x0c > y;
  }
  // c5ff = c2cf 窗口内所有图块 (c2a4 → c14e) + c0e6 小地图的陆地
  drawField() {
    for (let y = 0; y < 0x30; y++) for (let x = 0; x < 0x34; x++) if (this.inView(x, y)) this.tile(x, y);
    this.miniLand();
  }
  // 02a7 模式 1/2/3 (XOR/AND/OR) 的 4 平面交错图 (移植版的画面是索引像素: 4 个平面的运算 = 索引的比特运算)
  putOp(col, y, w, h, mode, src, off) {
    const scr = this.c.scr;
    if (mode === 0) return scr.putPlanar(col, y, w, h, src, off);
    if (!scr.inBounds(col, y, w, h)) return -1;
    const fb = scr.fb; let s = off;
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++, s += 4) {
      const o = (y + r) * 640 + (col + c) * 8, p0 = src[s], p1 = src[s + 1], p2 = src[s + 2], p3 = src[s + 3];
      for (let i = 0; i < 8; i++) {
        const b = 7 - i, v = ((p0 >> b) & 1) | (((p1 >> b) & 1) << 1) | (((p2 >> b) & 1) << 2) | (((p3 >> b) & 1) << 3);
        if (mode === 1) fb[o + i] ^= v; else if (mode === 2) fb[o + i] &= v; else fb[o + i] |= v;
      }
    }
    scr.dirty = true; return 0;
  }
  // c14e 一格图块 (naval_battle.png): 偶数栏整张 (最下一列再补下一列的上半); 奇数栏下移半格
  tile(x, y) {
    const { scr, art } = this.c;
    const cx = x - this.u8(0x9bef), si = y - this.u8(0x9bf0);
    const t = this.u8(this.mapAt(x, y)) & 0x1f;
    const belowT = this.u8(this.mapAt(x, btUmin(y + 1, 0x2f))) & 0x1f;
    const dx = cx * 32;
    if (x & 1) {
      if (si === 0) art?.drawSheetTile(scr, "naval_battle", t, dx, si << 5);
      else art?.drawSheetTile(scr, "naval_battle", t, dx, (si << 5) + 0x10, { syOff: 16, sh: 16 });
      art?.drawSheetTile(scr, "naval_battle", belowT, dx, (si + 1) << 5, { syOff: 0, sh: 16 });
    } else {
      art?.drawSheetTile(scr, "naval_battle", t, dx, si << 5);
      if (si === 0x0b) art?.drawSheetTile(scr, "naval_battle", belowT, dx, 0x180, { syOff: 0, sh: 16 });
    }
  }
  // c0e6 小地图的陆地: 0636 点阵 DS:9bfe + (栏 % 2) × 4, 模式 0x400 (色 0) 于 (0x35 + 栏 / 2, (列 + 2) × 4)
  miniLand() {
    for (let y = 0; y < 0x30; y++) for (let x = 0; x < 0x34; x++)
      if (this.u8(this.mapAt(x, y)) & 0x80) this.miniDot(x, y, 0x400);
  }
  miniDot(x, y, mode) { this.c.scr.glyphMode(0x35 + btIdiv(x, 2), (y + 2) * 4, 1, 4, this.W.subarray(0x9bfe + (x % 2) * 4), mode); }   // be49 / c0e6
  // c0ad 所有的船: c05d (战场) + beb7 (小地图)
  drawShips() {
    for (let k = 0; k < 4; k++) for (let si = this.u16(0x97e0 + 8 * k); si; si = this.u16(si + 8)) { this.drawShip(si); this.miniShip(si); }
  }
  // c05d: 在窗口内、船位 +2 (耐久) ≠ 0、未沉 (+0c bit6) → bf16
  drawShip(B) {
    const [x, y] = this.pos(B);
    if (!this.inView(x, y) || !shipSlotByAddr(this.m, this.u16(B + 2)).durability || (this.u8(B + 0x0c) & 0x40)) return;
    this.shipSprite(B, x, y);
  }
  // bf16 船的图: 种类 = (攻守 bit7 = 0 ? 1 : 0) + (船 +10 bit4 = 0 ? 2 : 0); 图 = 0x1a00 + (种类 × 6 + 方向) × 0x280:
  //   0x80 遮罩以 063e 模式 0x20f (AND) 画, 再以 02a7 模式 3 (OR) 叠上图像; 有水手 (船位 +0 ≠ 0) 时标上序号 (旗舰 C7, 其他 C1; 方 2/3 往右 3 栏)
  shipSprite(B, x, y) {
    const { scr, con, printf, art } = this.c, m = this.m, fl = this.u8(B + 0x0d);
    const S = shipSlotByAddr(m, this.u16(B + 2));
    const cx = x - this.u8(0x9bef), cy = y - this.u8(0x9bf0), dy = x % 2 === 1 ? 0x10 : 0;
    let di = fl & 0x80 ? 0 : 1;
    if (!(m.ship(S.ship).flags & 0x10)) di += 2;
    const idx = di * 6 + this.u8(B + 0x0a);
    const X = cx << 2, Y = (cy << 5) + dy;
    art?.drawSheetTile(scr, "battle_ships", idx, X * 8, Y, { transparent: true });
    if (!S.crew) return;
    con.puts(this.ds(this.u16(0x97e0 + ((fl & 0x30) >> 1)) === B ? 0x9ca6 : 0x9cad));
    con.setCursor((fl & 0x20 ? 3 : 0) + X, Y);
    printf(this.ds(0x9cb4), fl & 0x0f);
  }
  // beb7 小地图的船: 主角方 (bit7) 色 7 (bit6 时 6), 对方 色 2 (bit6 时 3)
  miniShip(B) {
    if (!shipSlotByAddr(this.m, this.u16(B + 2)).durability || (this.u8(B + 0x0c) & 0x40)) return;
    const [x, y] = this.pos(B), fl = this.u8(B + 0x0d);
    const c = fl & 0x80 ? (fl & 0x40 ? 6 : 7) : (fl & 0x40 ? 3 : 2);
    this.miniDot(x, y, 0x400 | c);
  }
  // bcfa 淡入战场调色盘 (DS:9c76), [03ea] = 0 且未反色时开始调色盘循环 16ee(DS:9c6e, 4, 0x10)
  async fadeIn() {
    const { palette } = this.c;
    await palette.fadeTo(palette.table("battle"));
    if (!palette.ending && !palette.invert) {
      const frames = [0, 1, 2, 3].map(i => { const p = this.u16(0x9c6e + 2 * i); return Array.from({ length: 8 }, (_, j) => this.u16(p + 2 * j)); });
      palette.startCycle(frames, 0x10);
    }
  }

  // ================= 开战前的对话 fcdb =================
  // f95d: 剧本窗口 n (2e09:3c76) + 头像 (2e09:3e62 = 31ef2: 目前窗口的头像位置画人物记录 R)
  async talkWin(n, R) {
    const P = typeof R === "number" ? personByAddr(this.m, R) : R;
    if (this.c.scr.wideRenderer && this.c.codec) {
      const id = Math.trunc(((P.addr - this.m.person(0).addr) & 0xffff) / WorldConst.PERSON_RECORD_SIZE);
      this.sea.b.beginWideTalk(this.sea.b.resolvePersonPortrait(id));
      return { op_win_close: async () => { this.sea.b.endWideTalk(); } };
    }
    const sc = (this.c.events ??= new Scenario(this.c)); await sc.init();
    await sc.op_win_open({ win: n });
    if (sc.cur >= 0) { const w = sc.W(sc.cur); this.c.kao.drawPerson(this.c.scr, personRawBytes(P), w.faceX, w.faceY); }
    return sc;
  }
  async closeAllWin() {
    if (this.c.scr.wideRenderer) { this.sea.b.endWideTalk(); return; }
    const sc = (this.c.events ??= new Scenario(this.c)); await sc.init(); await sc.closeAll();
  }   // 2e09:3d2b
  async parley(arg) {
    return this.u8(0x97e6) === this.m.globals.hero ? this.parleyHero(arg) : this.parleyEnemy();
  }
  // f972 主角开战: 对方是海盗 (舰队 / 10 = 6 或 +31 & 0f = 6) → 0x32b (剧本开战时 0x32a) …; 其他 → 0x32c, 对方 0x32e / 0x330 / 0x32f (是 → [9bfb] = 2, 不打)
  async parleyHero(arg) {
    const wm = this.m, { message, menu } = this.c, H = wm.heroPerson();
    let di = 0;
    const si = wm.person(this.u8(0x97ee));
    let f = si.fleet;
    if ((si.face & 0x0f) === 6) f = 0x3c;
    await this.talkWin(2, H);
    let m;
    if (Math.floor(f / 10) === 6) {
      message(arg ? 0x32a : 0x32b, si.givenNameBytes, si.familyNameBytes);
      await menu.waitPrompt();
      await this.talkWin(1, si);
      m = 0x32d;
    } else {
      message(0x32c); await menu.waitPrompt();
      await this.talkWin(1, si);
      if (f % 10 !== 0 && f % 10 < 5) {
        if (((this.u16(0x9d42) * 3) & 0xffff) >>> 1 < this.u16(0x9d40)) {
          message(0x32f);
          di = await menu.yesNo();
          if (di) this.set8(0x9bfb, 2);
          await this.closeAllWin();
          return di;
        }
        m = 0x330;
      } else m = 0x32e;
    }
    message(m); await menu.waitPrompt();
    await this.closeAllWin();
    return di;
  }
  // fa5b 对方开战: 对方说话 (海盗 0x331 / 任务 3 埋伏 0x332 / 其他 0x333) → 船员 909b: 0x334 (我方较弱) / 0x335 → MENU #0x36 (交战 / 撤离 / 投降)
  //   撤离: random(150) < 主角 +24 + +23 → 0x336, [9bfb] = 3 (不打); 否则 0x338 (照打)
  //   投降: 一般 → 0x339, 现金 × 2 / 3, 货物剩 2/3; 海盗 → 0x33a, 现金 < 1000 → 0x33b 现金 +1000 (原版如此), < 10000 → 0x33c, 否则 0x33d 现金 = 5000, 货物全失; [9bfb] = 9
  async parleyEnemy() {
    const wm = this.m, { message, menu } = this.c, b = this.sea.b, nations = this.nations, H = wm.heroPerson();
    let di = 0;
    const si = wm.person(this.u8(0x97e6));
    let f = si.fleet;
    if ((si.face & 0x0f) === 6) f = 0x3c;
    await this.talkWin(1, si);
    if (Math.floor(f / 10) === 6) message(0x331);
    else if (wm.fleet(f).mission === 3) message(0x332, H.familyNameBytes, nations[Math.floor(si.fleet / 10)]);
    else message(0x333, nations[H.face & 0x0f]);
    await menu.waitPrompt();
    b.crewSpeaks();                                                     // 909b
    message(((this.u16(0x9d40) * 3) & 0xffff) >>> 1 >= this.u16(0x9d42) ? 0x335 : 0x334);
    menu.wideMenuTitle = "战前抉择";
    const r = await menu.popupMenu(this.c.menuItems(0x36), 0);          // 2e09:57aa(0x36) + 0fea:46ec (3 项)
    menu.wideMenuTitle = "";
    await b.closeTalk();                                                // 796d
    if (r === 1) {
      b.crewSpeaks();
      const x = this.rnd(0x96);
      if (H.navLevel + H.getStats(7) > x) { message(0x336); this.set8(0x9bfb, 3); di = 1; }
      else message(0x338);
      await menu.waitPrompt(); await b.closeTalk();
    } else if (r === 2) {
      await this.talkWin(1, si);
      let keep;
      if (Math.floor(f / 10) !== 6) {
        message(0x339);
        b.money = Math.trunc(((b.money * 2) | 0) / 3);                  // seg0:3722
        keep = 2;
      } else {
        message(0x33a); await menu.waitPrompt();
        await this.talkWin(1, si);
        const m = b.money;
        if (m < 1000) { message(0x33b); b.money = m + 1000; }
        else if (m < 10000) message(0x33c);
        else { message(0x33d); b.money = 5000; }
        keep = 0;
      }
      await menu.waitPrompt();
      for (let i = 0; i < 10; i++) {
        if ((heroShipSlot(wm, i).flags & 0x30) !== 0x10) continue;
        const M = wm.crewSlot(i);
        for (let k = 0; k < 5; k++) {
          const v = btIdiv(btS16(M.getCargoAmts(k)) * keep, 3);
          M.setCargoAmts(k, v);
          if (!(v & 0xffff)) M.setCargoGoods(k, 0xff);
        }
      }
      this.set8(0x9bfb, 9); di = 1;
    }
    await this.closeAllWin();
    return di;
  }
  // f89e 双方战力差距大 ([9d40] + 20 ≤ [9d42]) 时, 主角方旗舰之后忠诚 (+2b) < 40 的船长带船离队:
  //   剧本窗口 2 + 头像, 0x313 + (+2f >> 6) (%s = +0d), 关闭窗口; eb3f 船长离开舰队 (船员栏清除、5deb 移除船、+2e = 0、+2c = FF、+2d = random(54) + 3); 从船链与地图移除
  async desert() {
    if (((this.u16(0x9d40) + 0x14) & 0xffff) > this.u16(0x9d42)) return;
    const m = this.m, { message, menu } = this.c;
    let E = 0x97e0;
    for (let dx = 0; dx < 4; dx++, E += 8) if (this.u16(E + 4) === this.heroFleet) break;
    let prev = this.u16(E);
    for (let si = this.u16(prev + 8); si; si = this.u16(prev + 8)) {
      const P = personByAddr(m, this.u16(si));
      if (P.loyalty >= 0x28) { prev = si; continue; }
      const sc = await this.talkWin(2, P);
      message(0x313 + (P.flags >> 6), P.familyNameBytes);
      await menu.waitPrompt();
      await sc.op_win_close();                                          // 2e09:3cce
      this.leave(this.heroSlotIndex(si));                               // eb9e → eb3f
      this.set16(prev + 8, this.u16(si + 8));
      this.and8(0x8e14 + this.u16(si + 4), 0x1f);
    }
  }
  // eb3f 主角舰队第 i 艘的船长离队
  leave(i) {
    const m = this.m, M = m.crewSlot(i), cap = M.captain, P = m.person(cap);
    for (let k = 0; k < 0x1e; k++) if (m.partyCrew(k) === cap) m.setPartyCrew(k, 0xff);
    this.sea.b.removeShip(i);                                           // seg0:5deb
    P.role = 0; P.fleet = 0xff; P.stayPort = this.rnd(0x36) + 3;
  }

  // ================= fe9a 主循环 =================
  async mainLoop() {
    const rt = this.c.rt;
    while ((rt.time & 0xff) < 0x3f) {
      for (let k = 0; k < 4; k++) { const E = 0x97e0 + 8 * k; this.set16(E + 2, this.u16(E)); }
      for (let di = 0; di < 10; di++) {
        for (let k = 0; k < 4; k++) {
          this.set16(0x9bc0, 0x97e0 + 8 * k);
          this.set16(0x9bc2, this.u16(0x97e0 + 8 * k + 2));
          if (!(await this.turn())) return;
        }
      }
      rt.time = (rt.time + 1) & 0xff;
    }
    this.set8(0x9bfb, 1);
  }
  // fdb8 一方行动
  async turn() {
    let si = 1;
    if (this.c.palette.ending || this.u8(0x9bfb)) return 0;
    const B = this.u16(0x9bc2);
    if (!B) return si;
    const S = shipSlotByAddr(this.m, this.u16(B + 2));
    if (S.durability && S.crew && !(this.u8(B + 0x0c) & 0x40)) {
      const E = this.u16(0x9bc0);
      if (this.u16(E + 4) === this.heroFleet && this.u16(E) === B) si = await this.playerTurn();   // b8b1
      else si = await this.cpuTurn();                                                               // a3ce
    }
    this.set16(this.u16(0x9bc0) + 2, this.u16(this.u16(0x9bc2) + 8));
    this.status();                                                      // c327
    await this.c.sys.waitTicks(8);                                      // 5998(8)
    return si;
  }
  // ================= a3ce 电脑行动 (RE_NOTES 30.10) =================
  // 三个远程缓冲 (0x34 × 0x30, 不在 DS): [97d4] = this.mv (bit4 可到达、bit7 + 低 4 比特 = 攻击方向)、[97d8] = mv2 (对方的威胁)、[97dc] = mv3 (攻击价值)
  get mv2() { return (this.c.battleMv2 ??= new Uint8Array(0x10000)); }
  get mv3() { return (this.c.battleMv3 ??= new Uint8Array(0x10000)); }
  // a3ce: 本船不活着 → 1; 9aaa 本方旗舰不健全 → 本船 +0c |= 8 (撤退); a263 三张图 → a238 目的地 → e54f 路径 → a2d5 照路径移动 → a2a7 攻击 → a35e
  async cpuTurn() {
    const cur = this.u16(0x9bc2);
    if (!this.alive(cur)) return 1;
    if (!this.flagHealthy()) this.or8(cur + 0x0c, 8);                  // 9aaa
    this.cpuMaps();                                                     // a263
    this.cpuGoal();                                                     // a238
    this.cpuPath();                                                     // e54f
    await this.runPath();                                               // a2d5
    await this.cpuAttack();                                             // a2a7
    return this.endCheck();                                             // a35e
  }
  // 9aaa 本方旗舰健全: 水手 > 船型 +12 × 4 / 10 (有号)、耐久 > 最大耐久 × 4 / 10 (的低字节)、未沉
  flagHealthy() {
    const B = this.u16(this.u16(0x9bc0)), S = shipSlotByAddr(this.m, this.u16(B + 2)), R = this.m.ship(S.ship);
    if (btIdiv(btS16((R.maxCrew << 2) & 0xffff), 10) >= btS16(S.crew)) return 0;
    if ((btIdiv(btS16((S.maxDurability << 2) & 0xffff), 10) & 0xff) >= S.durability) return 0;
    return this.u8(B + 0x0c) & 0x40 ? 0 : 1;
  }
  distTo(B, x, y) { const [bx, by] = this.pos(B); return this.dist(bx, by, x, y) & 0xff; }   // d5b6
  // a263 + e1c6: mv 填 0x0f、mv3 / mv2 填 0; 本船位置 |= 0x10; dd88 威胁; 本船的左前 / 正前 / 右前三个方向各 de1f(原地); df41 可到达; e18d 友船
  cpuMaps() {
    this.mvFill(0x0f); this.mv3.fill(0, 0x2000, 0x2000 + 0x9c0); this.mv2.fill(0, 0x2000, 0x2000 + 0x9c0);
    const cur = this.u16(0x9bc2), pts = this.movePts(cur), [x, y] = this.pos(cur), dir = this.u8(cur + 0x0a);
    this.mv[this.mvAt(this.s16(cur + 4))] |= 0x10;
    this.threat();                                                      // dd88
    for (let k = 5; k < 8; k++) this.attackVal(x, y, (dir + k) % 6);   // de1f
    this.cpuReach(this.u16(cur + 4), dir, pts, this.u8(cur + 0x0b));    // df41
    this.allyBlock();                                                   // e18d
  }
  // dd88 / dd14: 对方两方的每艘船 (不看死活) 周围 ±5 格: 距离 d ≠ 0 时, 在它的射界内 (d8ef) → mv2 += 它的命中率[d]; d = 1 → mv2 += 它的战力 +16 (字节相加)
  threat() {
    let E = this.enemySide(this.u16(0x9bc2));
    for (let k = 0; k < 2; k++, E = (E + 0x10) & 0xffff)
      for (let B = this.u16(E); B; B = this.u16(B + 8)) {
        const [x, y] = this.pos(B);
        for (let yy = y - 5; yy <= y + 5; yy++) for (let xx = x - 5; xx <= x + 5; xx++) {
          if (!this.inMap(xx, yy)) continue;
          const i = this.mvAt((0x34 * yy + xx) & 0xffff), d = this.dist(x, y, xx, yy) & 0xff;
          if (!d) continue;
          if (this.inRange(B, x, y, xx, yy, this.u8(B + 0x0a))) this.mv2[i] += this.u8(B + 0x0f + d);
          if (d === 1) this.mv2[i] += this.u8(B + 0x16);
        }
      }
  }
  // de1f(x, y, dir) 攻击价值: 本船 +0c 低 2 比特 = 0 → 不做; 砲船 (+0c bit4) 砲击 ×2 / 接舷 ×1, 否则 ×1 / ×2;
  //   对方的每艘船 T: 本船在 (x, y) 朝 dir 时 T 在射界内 → v = T 的命中率[距离] × 倍数 (低字节; 原版用的是目标自己的命中率); 相邻 → v = T 的战力 × 倍数;
  //   v ≥ mv3 → mv3 = v、mv = dir | 0x80 (整个字节盖掉)
  attackVal(x, y, dir) {
    const cur = this.u16(0x9bc2), f = this.u8(cur + 0x0c);
    if (!(f & 3)) return;
    const g = f & 0x10 ? 2 : 1, b = f & 0x10 ? 1 : 2, i = this.mvAt((0x34 * y + x) & 0xffff);
    let E = this.enemySide(cur);
    for (let k = 0; k < 2; k++, E = (E + 0x10) & 0xffff)
      for (let T = this.u16(E); T; T = this.u16(T + 8)) {
        const [tx, ty] = this.pos(T), d = this.dist(x, y, tx, ty) & 0xff;
        if (this.inRange(cur, x, y, tx, ty, dir)) {
          const v = (this.u8(T + 0x0f + d) * g) & 0xff;
          if (v >= this.mv3[i]) { this.mv3[i] = v; this.mv[i] = (dir | 0x80) & 0xff; }
        }
        if (d === 1) {
          const v = (this.u8(T + 0x16) * b) & 0xff;
          if (v >= this.mv3[i]) { this.mv3[i] = v; this.mv[i] = (dir | 0x80) & 0xff; }
        }
      }
  }
  // df41(p, dir, pts, mom) 可到达 (与 db20 同样的规则): 每个可走的邻格先 de1f(邻格, 新方向), 再把「目前这一格」|= 0x10, 然后递归
  //   (所以路径最后一格只有在它还有可走的邻格时才会被标成可到达, 照搬)
  cpuReach(p, dir, pts, mom) {
    const cur = this.u16(0x9bc2), m = btUmin(0x64, (this.inertia(cur) + mom) & 0xffff) & 0xff;
    for (let k = 5; k < 8; k++) {
      if (m < 0x32 && k !== 6) continue;                                // d786
      const nd = (k + dir) % 6, [nx, ny] = this.nb(p, nd), cost = this.stepCost(cur, nd, dir);
      if (!this.inMap(nx, ny) || (this.u8(this.mapAt(nx, ny)) & 0xe0) || cost > pts) continue;
      this.attackVal(nx, ny, nd);                                       // de1f
      this.mv[this.mvAt(p)] |= 0x10;
      this.cpuReach((0x34 * ny + nx) & 0xffff, nd, (pts - cost) & 0xff, k === 6 ? m : 0);
    }
  }
  // e18d / e065: 本方两方的每艘活船 B: 它正前方那格若可到达 → mv = 0x0f; 它的 6 个邻格中 5 个有船 (本船那格不算) 时, 剩下那格若可到达 → mv = 0x0f
  allyBlock() {
    const cur = this.u16(0x9bc2);
    let E = 0x97e0 + ((this.side(cur) & 1) << 3);                       // d641
    for (let k = 0; k < 2; k++, E = (E + 0x10) & 0xffff) for (let B = this.u16(E); B; B = this.u16(B + 8)) this.allyCells(B);
  }
  allyCells(B) {
    if (!this.alive(B)) return;
    const cur = this.u16(0x9bc2), [x, y] = this.pos(B), [cx, cy] = this.pos(cur);
    let free = 0, n = 0;
    for (let d = 0; d < 6; d++) {
      const [nx, ny] = this.nb((0x34 * y + x) & 0xffff, d), si = (0x34 * ny + nx) & 0xffff;
      if (!this.inMap(nx, ny)) continue;
      if ((this.u8(this.mapAt(nx, ny)) & 0xe0) && !(nx === cx && ny === cy)) n++;
      else free = si;
      if (this.u8(B + 0x0a) === d && (this.mv[this.mvAt(si)] & 0x10)) this.mv[this.mvAt(si)] = 0x0f;
    }
    if (n === 5 && (this.mv[this.mvAt(free)] & 0x10)) this.mv[this.mvAt(free)] = 0x0f;
  }
  // a238 目的地 [9bc4]: DS:8c96 远程函数表 [+0c & 0x0f]: 0/1 a17e、2/3 a145、4/5 a008、6/7 9fe7、8..15 9dc9 (撤退)
  cpuGoal() {
    const f = this.u8(this.u16(0x9bc2) + 0x0c) & 0x0f;
    if (f < 2) this.goalSafe();
    else if (f < 4) { const cur = this.u16(0x9bc2), T = this.u8(cur + 0x0c) & 0x80 ? this.u16(cur + 6) : this.u16(this.enemySide(cur)); this.approach(...this.pos(T)); }   // a145
    else if (f < 6) this.goalGuard();                                   // a008
    else if (f < 8) this.approach(...this.pos(this.u16(this.u16(0x9bc0))));   // 9fe7
    else this.goalFlee();                                               // 9dc9
  }
  // a17e: 可到达的格中 威胁 mv2 最小的; 相同时离本船最远的
  goalSafe() {
    const cur = this.u16(0x9bc2);
    let bt = 0xff, bd = 0, bx = 0, by = 0;
    for (let y = 0; y < 0x30; y++) for (let x = 0; x < 0x34; x++) {
      const i = 0x2000 + y * 0x34 + x;
      if (!(this.mv[i] & 0x10)) continue;
      const d = this.distTo(cur, x, y), t = this.mv2[i];
      if (t < bt || (t === bt && bd < d)) { bx = x; by = y; bd = d; bt = t; }
    }
    this.set16(0x9bc4, (by * 0x34 + bx) & 0xffff);
  }
  // 9eb3(tx, ty) 接近: 可到达的格中 max(到 (tx, ty) 的距离, 本船射程) 最小的; 相同时攻击价值 mv3 > 以目前最佳值换算的门槛; 再相同时离本船最远的
  approach(tx, ty) {
    const cur = this.u16(0x9bc2);
    let b9 = 0, b8 = 0, b7 = 0xff, bx = 0, by = 0;
    for (let y = 0; y < 0x30; y++) for (let x = 0; x < 0x34; x++) {
      const i = 0x2000 + y * 0x34 + x;
      if (!(this.mv[i] & 0x10)) continue;
      const d2 = btUmax(this.dist(x, y, tx, ty) & 0xff, this.u8(cur + 0x15)) & 0xff, d4 = this.distTo(cur, x, y), v3 = this.mv3[i];
      const a = Math.floor((((((0x0c - btUmin(d2, 0x0a)) & 0xffff) * b8) & 0xffff) * 0x0a & 0xffff) / 0x64) & 0xff;
      const b1 = (btIdiv(a + 9, 10) * 10) & 0xff;
      if (d2 < b7 || (d2 === b7 && (b1 < v3 || (b1 === v3 && b9 < d4)))) { bx = x; by = y; b8 = v3; b7 = d2; b9 = d4; }
    }
    this.set16(0x9bc4, (by * 0x34 + bx) & 0xffff);
  }
  // a008 护卫: 可到达的格中 到本方旗舰的距离最小的; 相同时威胁 mv2 < 门槛; 再相同时离本船最远的
  goalGuard() {
    const cur = this.u16(0x9bc2), [fx, fy] = this.pos(this.u16(this.u16(0x9bc0)));
    let b7 = 0xff, b8 = 0xff, b9 = 0, bx = 0, by = 0;
    for (let y = 0; y < 0x30; y++) for (let x = 0; x < 0x34; x++) {
      const i = 0x2000 + y * 0x34 + x;
      if (!(this.mv[i] & 0x10)) continue;
      const d2 = this.dist(x, y, fx, fy) & 0xff, d4 = this.distTo(cur, x, y), v3 = this.mv2[i];
      const a = Math.floor((((btUmin(d2, 0x0a) * b8) & 0xffff) * 0x0a & 0xffff) / 0x64) & 0xff;
      const b1 = (btIdiv(a + 9, 10) * 10) & 0xff;
      if (b7 > d2 || (b7 === d2 && (b1 > v3 || (b1 === v3 && b9 < d4)))) { bx = x; by = y; b8 = v3; b7 = d2; b9 = d4; }
    }
    this.set16(0x9bc4, (by * 0x34 + bx) & 0xffff);
  }
  // 9dc9 撤退: 本船已在地图边缘的海格 → e5fc 离开战场 (不设目的地); 否则 可到达的边缘海格中离本船最远的, 没有时 9b4d 离 12 个角落 / 边中点最近的格
  goalFlee() {
    const cur = this.u16(0x9bc2), [x0, y0] = this.pos(cur);
    if (this.edgeSea(x0, y0)) { this.leaveField(cur); return; }
    let be = 0, bex = 0, bey = 0;
    const o = { best: 0xff, x: 0, y: 0 };
    for (let y = 0; y < 0x30; y++) for (let x = 0; x < 0x34; x++) {
      if (!(this.mv[0x2000 + y * 0x34 + x] & 0x10)) continue;
      const d = this.distTo(cur, x, y);
      if (this.edgeSea(x, y)) { if (be < d) { bex = x; bey = y; be = d; } }
      else this.corner(x, y, o);
    }
    const tx = be ? bex : o.x, ty = be ? bey : o.y;
    this.set16(0x9bc4, (ty * 0x34 + tx) & 0xffff);
  }
  // 9b4d: 12 个点 (四角、上下边中点 0x19 / 0x1a、左右边中点 0x17 / 0x18); 距离 < 目前最佳且该点不是陆地 → 记下
  //   (原版判断陆地时栏列对调, 例如 (0x33, 0) 读 8e14 + 0x33 × 0x34 = 9870, 读到地图外的船记录, 照搬)
  corner(x, y, o) {
    const P = [[0, 0, 0x8e14], [0x33, 0, 0x9870], [0, 0x2f, 0x8e43], [0x33, 0x2f, 0x989f], [0x19, 0, 0x9328], [0x1a, 0, 0x935c], [0, 0x17, 0x8e2b], [0, 0x18, 0x8e2c],
      [0x33, 0x17, 0x9887], [0x33, 0x18, 0x9888], [0x19, 0x2f, 0x9357], [0x1a, 0x2f, 0x938b]];
    for (const [tx, ty, a] of P) { const d = this.dist(x, y, tx, ty) & 0xff; if (d < o.best && !(this.u8(a) & 0x80)) { o.x = x; o.y = y; o.best = d; } }
  }
  // e54f 路径: 9bc6 / 9d30 各 10 格填 0x0f、[9d3a] = 0x0f; 已在目的地 → 9bc6[0] = e447 (原地转向); 否则 e31f 找路
  cpuPath() {
    for (let i = 0; i < 0x0a; i++) { this.set8(0x9bc6 + i, 0x0f); this.set8(0x9d30 + i, 0x0f); }
    const cur = this.u16(0x9bc2), pts = this.movePts(cur);
    this.set8(0x9d3a, 0x0f);
    if (this.u16(cur + 4) === this.u16(0x9bc4)) this.set8(0x9bc6, this.faceDir());
    else this.pathRec(this.u16(cur + 4), this.u8(cur + 0x0a), pts, 0x9d30, this.u8(cur + 0x0b));
  }
  // e447: 本格 mv bit7 → 那个攻击方向; 否则 左前 / 正前 / 右前中离目标 (+0c bit7 ? +6 : 对方旗舰) 最近的方向
  faceDir() {
    const cur = this.u16(0x9bc2), v = this.mv[this.mvAt(this.s16(cur + 4))];
    if (v & 0x80) return v & 0x0f;
    const T = this.u8(cur + 0x0c) & 0x80 ? this.u16(cur + 6) : this.u16(this.enemySide(cur));
    const [tx, ty] = this.pos(T), dir = this.u8(cur + 0x0a), p = this.s16(cur + 4);
    let bd = 0xff, r = 0xff;
    for (let k = 5; k < 8; k++) { const nd = (dir + k) % 6, [nx, ny] = this.nb(p, nd), d = this.dist(nx, ny, tx, ty) & 0xff; if (d < bd) { bd = d; r = nd; } }
    return r;
  }
  // e31f 递归找所有走得到目的地的路 (规则同 db20, 不检查走过的格, 指针没有上限); 到达 → e2c9
  pathRec(p, dir, pts, ptr, mom) {
    if ((p & 0xffff) === this.u16(0x9bc4)) { this.pathEnd(p, dir); return; }
    const cur = this.u16(0x9bc2), m = btUmin(0x64, (this.inertia(cur) + mom) & 0xffff) & 0xff;
    for (let k = 5; k < 8; k++) {
      if (m < 0x32 && k !== 6) continue;
      const nd = (dir + k) % 6, [nx, ny] = this.nb(p, nd), cost = this.stepCost(cur, nd, dir);
      if (!this.inMap(nx, ny) || (this.u8(this.mapAt(nx, ny)) & 0xe0) || cost > pts) continue;
      this.set8(ptr, nd);
      this.pathRec((0x34 * ny + nx) & 0xffff, nd, (pts - cost) & 0xff, (ptr + 1) & 0xffff, k === 6 ? m : 0);
      this.set8(ptr, 0x0f);
    }
  }
  // e2c9: 目的地没有攻击方向 → 转弯次数 (e262) 比 [9d3a] 少才采用 (e2a4 拷贝到 9bc6); 有攻击方向 → 抵达方向相同就采用 (后找到的盖掉先前的)
  pathEnd(p, dir) {
    const n = this.turnsIn(), t = this.mv[this.mvAt(p)] & 0x0f;
    if (t === 0x0f) { if (n < this.u8(0x9d3a)) { this.copyPath(); this.set8(0x9d3a, n); } }
    else if (t === (dir & 0xff)) this.copyPath();
  }
  turnsIn() {                                                           // e262
    let prev = this.u8(this.u16(0x9bc2) + 0x0a), n = 0;
    for (let i = 0; this.u8(0x9d30 + i) < 6; i++) { if (i >= 0x0a) break; if (this.u8(0x9d30 + i) !== prev) n++; prev = this.u8(0x9d30 + i); }
    return n;
  }
  copyPath() { for (let i = 0; i < 0x0a; i++) this.set8(0x9bc6 + i, this.u8(0x9d30 + i)); }   // e2a4
  // a2a7: 本船活着且所在格 mv bit7 → eb22: eaad 选目标 ([9d3c]) → 1 砲击 e8cc / 2 接舷 e95e
  async cpuAttack() {
    const cur = this.u16(0x9bc2);
    if (!this.alive(cur) || !(this.mv[this.mvAt(this.s16(cur + 4))] & 0x80)) return;
    const r = this.pickCpuTarget();
    if (r === 1) await this.gunnery(this.u16(0x9d3c));
    else if (r === 2) await this.board(this.u16(0x9d3c));
  }
  // eaad: +0c bit7 时先试指定的目标 +6; 否则 (或不行时) 对方两方依序第一艘可打的
  pickCpuTarget() {
    const cur = this.u16(0x9bc2);
    if (this.u8(cur + 0x0c) & 0x80) { const r = this.canHit(this.u16(cur + 6)); if (r) { this.set16(0x9d3c, this.u16(cur + 6)); return r; } }
    let E = this.enemySide(cur);
    for (let k = 0; k < 2; k++, E = (E + 0x10) & 0xffff) for (let T = this.u16(E); T; T = this.u16(T + 8)) { const r = this.canHit(T); if (r) { this.set16(0x9d3c, T); return r; } }
    return 0;
  }
  // ea34: 目标活着; 砲船先看射界 (1) 再看相邻 (2), 其他船先看相邻再看射界
  canHit(T) {
    if (!this.alive(T)) return 0;
    const cur = this.u16(0x9bc2), [x, y] = this.pos(T), [cx, cy] = this.pos(cur);
    const gun = () => this.inRange(cur, cx, cy, x, y, this.u8(cur + 0x0a)), adj = () => (this.dist(cx, cy, x, y) & 0xff) === 1;
    if (this.u8(cur + 0x0c) & 0x10) return gun() ? 1 : adj() ? 2 : 0;
    return adj() ? 2 : gun() ? 1 : 0;
  }

  // ================= b8b1 玩家指令 =================
  async playerTurn() {
    const { menu } = this.c;
    for (;;) {
      this.set8(0x9bee, 0);
      const B = this.u16(0x9bc2);
      this.set16(0x9bd0, this.u16(B + 4)); this.set8(0x9be4, this.u8(B + 0x0a));
      const items = this.c.menuItems(0x32);
      this.enable();                                                    // b751
      menu.wideMenuTitle = "战斗指令";
      const r = await menu.popupMenu(items, 0);                         // 0fea:46ec (8 项, 不可取消)
      menu.wideMenuTitle = "";
      const ax = await this.command(r);                                 // DS:8df4 远程函数表
      if (ax) break;
    }
    return this.endCheck();                                             // a35e
  }
  async command(r) {
    switch (r) {
      case 0: return this.cmdMove();                                    // ad20
      case 1: return this.attack();                                     // ad38 = ac7d
      case 2: return this.cmdInfo();                                    // b258
      case 3: return this.cmdSignal();                                  // b30f
      case 4: return this.cmdOrders();                                  // b6db
      case 5: return this.cmdStop();                                    // b6f2
      case 6: await this.sea.commandsObj().belongings(); if (this.c.scr._battleHudActive) this.redraw(); return 0;     // b71b: 1fd9:9cbc = 29a4c 随身物 (commands.js), 返回 0
      case 7: return this.cmdRetreat();                                 // b723
    }
    return 0;
  }
  // ================= b258 情报 / b30f 信号 / b6db 作战 (RE_NOTES 30.15) =================
  shipName(k) { const v = btHex(this.J.shipNames[k & 0x0f] ?? ""), o = new Uint8Array(v.length + 1); o.set(v); return o; }   // DS:091c 船链名
  dstr(k) { const v = btHex(this.J.str[k]), o = new Uint8Array(v.length + 1); o.set(v); return o; }
  cursorCell(B) { const [x, y] = this.pos(B); return ((x - this.u8(0x9bef)) + (y - this.u8(0x9bf0)) * 0x0d) & 0xffff; }   // [a160] (customMenu 标志 1 时没有作用)
  // b258: MENU #0x33 → b19c → 0fea:46ec(7, 可取消) → DS:8d36 → c608 / bcfa; 取消 → 0
  async cmdInfo() {
    const { menu } = this.c;
    for (;;) {
      const allItems = this.c.menuItems(0x33);
      this.infoEnable();                                                // b19c
      if (this.c.scr._battleHudActive && hasDom()) {
        // 现代模式移除冗余的「本方舰船」(index 2)，舰队内已含所有船只信息
        const mapIdx = [0, 1, 3, 4, 5, 6];
        const filtered = mapIdx.map(i => allItems[i]);
        let dis = 0;
        mapIdx.forEach((orig, ni) => { if (menu.disabled & (1 << orig)) dis |= (1 << ni); });
        menu.disabled = dis;
        menu.wideMenuTitle = "情报";
        const r = await menu.popupMenu(filtered, 1);
        menu.wideMenuTitle = "";
        if (r === 0xff) return 0;
        const orig = mapIdx[r];
        await [() => this.fleetLook(this.m.globals.hero), () => this.infoCrew(), () => this.infoShips(), () => this.infoEnemyFleet(),
          () => this.infoEnemyPerson(), () => this.infoEnemyShip(), () => this.infoOrders()][orig]();
        continue;
      }
      menu.wideMenuTitle = "情报";
      const r = await menu.popupMenu(allItems, 1);
      menu.wideMenuTitle = "";
      if (r === 0xff) return 0;
      await [() => this.fleetLook(this.m.globals.hero), () => this.infoCrew(), () => this.infoShips(), () => this.infoEnemyFleet(),
        () => this.infoEnemyPerson(), () => this.infoEnemyShip(), () => this.infoOrders()][r]();   // ad9f / ada7 / addc / ae57 / aebc / af32 / b0bc
      this.redraw();                                                    // c608
      await this.fadeIn();                                              // bcfa
    }
  }
  // b19c [a14c]: bit5 主角舰队以外没有窗口内的活船, bit6 目前这艘之后本方没有活船
  infoEnable() {
    let dis = 0, vis = 0, n = 0;
    for (let k = 0; k < 4; k++) {
      const E = 0x97e0 + 8 * k;
      if (this.u16(E + 4) === this.heroFleet) continue;
      for (let B = this.u16(E); B; B = this.u16(B + 8)) { if (!this.alive(B)) continue; const [x, y] = this.pos(B); if (this.inView(x, y)) vis++; }
    }
    if (!(vis & 0xff)) dis |= 0x20;
    for (let B = this.u16(this.u16(0x9bc2) + 8); B; B = this.u16(B + 8)) if (this.alive(B)) n++;
    if (!(n & 0xff)) dis |= 0x40;
    this.c.menu.disabled = dis;
  }
  // ad3d 指挥者 p 的舰队一览 (0fea:d248 = 1d0e8)
  async fleetLook(p) {
    if (this.c.scr._battleHudActive && hasDom()) {
      await runDomBattleFleetModal(this, p);
      return;
    }
    const { con, palette } = this.c, m = this.m;
    const l = con.left, r = con.right;
    con.left = 0; con.right = 0x4f;
    await this.fadeOutField();                                          // bd26
    toggleSpritePhase(m);
    await this.sea.commandsObj().fleetView(m.person(p).fleet);
    await palette.fadeBlack();                                          // 99f2
    toggleSpritePhase(m);
    this.drawPanel(); this.drawField(); this.drawShips();               // c581 / c5ff / c0ad
    con.left = l; con.right = r;
    await this.fadeIn();                                                // bcfa
  }
  // ada7 人物 (主角 + 船员, 12d8c): 清单种类 6 → 1c839(人物, 6, 1)
  async infoCrew() {
    const b = this.sea.b, cm = this.sea.commandsObj(), n = b.captainPool();
    if (this.c.scr._battleHudActive && hasDom()) {
      const ids = [];
      for (let i = 0; i < n; i++) ids.push(this.c.persons[i] & 0xff);
      await runDomBattleCrewModal(this, ids, "舰队人物");
      return;
    }
    for (;;) {
      const r = await b.listSel().select(6, n);
      await b.closeTalk();                                              // 796d
      if (r === -1) return;
      cm.personInfo(this.c.persons[r] & 0xff, 6, 1);                    // 0fea:c999
    }
  }
  // addc 本方的船: 清单种类 0 → 舰船调色盘 → 1c1a3(船位, 6) → 490b → c2ee / c608 / bcfa
  async infoShips() {
    const { palette, menu } = this.c, b = this.sea.b, cm = this.sea.commandsObj(), P = this.c.persons;
    let n = 0;
    for (let B = this.u16(this.u16(0x9bc0)); B; B = this.u16(B + 8)) if (!(this.u8(B + 0x0c) & 0x40)) P[n++] = this.heroSlotIndex(B);   // eb9e
    for (;;) {
      const r = await b.listSel().select(0, n);
      await b.closeTalk();
      if (r === -1) return;
      if (this.c.scr._battleHudActive && hasDom()) {
        await runDomBattleShipModal(this, heroShipSlot(this.m, P[r] & 0xff).addr);
        continue;
      }
      if (!palette.invert) palette.stopCycle();                         // 1743
      palette.setTarget(palette.table("ships")); await palette.fadeToTarget();   // 98fe(a730), 99e8
      cm.shipInfo(P[r] & 0xff, 6);                                      // 0fea:c303
      await menu.waitPrompt();                                          // 490b
      this.msgArea(); this.redraw(); await this.fadeIn();
    }
  }
  // ae57 / aebc 共用: 主角舰队以外、舰队 ≠ 0 的各方的提督 → [0538]
  enemyCommanders() {
    const P = this.c.persons; let n = 0;
    for (let k = 0; k < 4; k++) { const F = this.u16(0x97e0 + 8 * k + 4); if (F === this.heroFleet || !F) continue; P[n++] = fleetByAddr(this.m, F).admiral; }
    return n;
  }
  // ae57 对方的舰队一览
  async infoEnemyFleet() {
    const b = this.sea.b, P = this.c.persons, n = this.enemyCommanders();
    if (n === 1) return this.fleetLook(P[0] & 0xff);
    for (;;) {
      const r = await b.listSel().select(6, n);
      await b.closeTalk();
      if (r === -1) return;
      await this.fleetLook(P[r] & 0xff);
    }
  }
  // aebc 对方的提督数据 1c839(人物, 6, 0)
  async infoEnemyPerson() {
    const b = this.sea.b, cm = this.sea.commandsObj(), P = this.c.persons, n = this.enemyCommanders();
    if (n === 1) {
      if (this.c.scr._battleHudActive && hasDom()) await runDomBattlePersonModal(this, P[0] & 0xff);
      else { cm.personInfo(P[0] & 0xff, 6, 0); await this.c.menu.waitPrompt(); }
      return;
    }
    for (;;) {
      const r = await b.listSel().select(6, n);
      await b.closeTalk();
      if (r === -1) return;
      if (this.c.scr._battleHudActive && hasDom()) await runDomBattlePersonModal(this, P[r] & 0xff);
      else cm.personInfo(P[r] & 0xff, 6, 0);
    }
  }
  // af32 对方的船: a65e 标记 → bc37 选格 → 1c652
  async infoEnemyShip() {
    const { palette, menu } = this.c;
    this.mvFill(0);                                                     // d3f7(0x9c0, 0, [97d4])
    for (;;) {
      if (!this.markOthers()) return;                                   // a65e
      const B = await this.pickOther();                                 // bc37
      this.msgArea();
      if (!B) return;
      const E = 0x97e0 + ((this.u8(B + 0x0d) & 0x30) >> 1), F = fleetByAddr(this.m, this.u16(E + 4)), idx = this.u8(B + 0x0d) & 0x0f;
      if (this.c.scr._battleHudActive && hasDom()) {
        await runDomBattleShipModal(this, this.u16(B + 2));
        this.redraw();
        continue;
      }
      if (!palette.invert) palette.stopCycle();
      palette.setTarget(palette.table("ships")); await palette.fadeToTarget();
      for (let i = 0; i < 10; i++) if (this.u16(B + 2) === fleetShipSlot(F, i).addr) this.enemyShipInfo(i, idx, F.admiral);   // 0fea:c7b2
      await menu.waitPrompt();                                          // 490b
      this.msgArea(); this.redraw(); await this.fadeIn();
    }
  }
  // a65e 主角舰队以外各方、窗口内的船 (只看 +0c bit6, 不看死活) → bd3f 2、缓冲 |= 0x80
  markOthers() {
    let any = 0;
    for (let k = 0; k < 4; k++) {
      const E = 0x97e0 + 8 * k;
      if (this.u16(E + 4) === this.heroFleet) continue;
      for (let B = this.u16(E); B; B = this.u16(B + 8)) {
        if (this.u8(B + 0x0c) & 0x40) continue;
        const [x, y] = this.pos(B);
        if (!this.inView(x, y)) continue;
        this.mark(x, y, 2); this.mv[this.mvAt(this.s16(B + 4))] |= 0x80; any = 1;
      }
    }
    return any;
  }
  // bc37 标记的格上、耐久 ≠ 0 的 (主角舰队以外的) 船; 取消 → 0
  async pickOther() {
    this.cellRects();                                                   // b916
    for (;;) {
      const c = await this.pickCell();                                  // b99c
      if (c === -1) return 0;
      if (!(this.mv[this.mvAt(c)] & 0x80)) continue;
      for (let k = 0; k < 4; k++) {
        const E = 0x97e0 + 8 * k;
        if (this.u16(E + 4) === this.heroFleet) continue;
        for (let B = this.u16(E); B; B = this.u16(B + 8)) if (this.s16(B + 4) === c && shipSlotByAddr(this.m, this.u16(B + 2)).durability) return B;
      }
    }
  }
  // 1c652 对方船只数据 (提督 cmdr 的舰队第 i 船位, 船链序号 idx)
  enemyShipInfo(i, idx, cmdr) {
    const m = this.m, { win, graph, con, message, printf, scr } = this.c, cm = this.sea.commandsObj(), T0 = cm.T;
    const lab = this.c.menuItems(0x29);                                 // 2e09:57aa(0x29)
    const P = m.person(cmdr), F = m.fleet(P.fleet), S = fleetShipSlot(F, i);
    const R = m.ship(S.ship), T = m.shipType(R.type);
    const cur = [S.durability, S.turn, S.propulsion, S.crew], max = [S.maxDurability, T.turn, T.propulsion, R.maxCrew];
    win.frame(6, 0x20, 0x29, 0x150, 0);                                 // 7358
    graph.draw(R.type + 0x1c, 8 << 3, 0x30);                            // 8050
    con.puts(this.dstr("a779"));
    scr.fillCols(0x1a, 0x80, 1, 0xe0, 2);                               // 0906
    con.left = 8; con.setCursor(8, 0x98);
    message(0x376, P.givenNameBytes);
    printf(this.dstr("a780"), this.shipName(idx));
    const k = S.flags & 7;
    message(0x377, T0.cannons[k]);
    con.left++; con.setCursor(con.left, -1);                            // 442c
    if (k) message(0x378, S.guns, R.maxGuns, btS16(T0.gunW[k] * S.guns));
    this.c.barColors = [2, 1];                                          // 9376(2, 1)
    for (let j = 0; j < 4; j++) {
      con.setCursor(0x1c, (j + 4) << 5); message(0x37f, lab[j], cur[j], max[j]);
      cm.barFrame(0x1e, (j << 5) + 0x94, 1);                            // 90c0
      cm.bar(0x1e, (j << 5) + 0x94, btSdiv32((100 * cur[j]) >>> 0, max[j] || 1), 1);   // 3722 / 91a1
    }
  }
  // b0bc 本方各船的命令一览 (窗口不保存背景)
  async infoOrders() {
    if (this.c.scr._battleHudActive && hasDom()) {
      await runDomBattleOrdersModal(this);
      return;
    }
    const { win, con, printf, menu } = this.c, m = this.m, flag = this.u16(this.u16(0x9bc0));
    let n = 0; for (let B = flag; B; B = this.u16(B + 8)) if (this.alive(B)) n++;
    win.frame(0, 0x20, 0x34, (n * 0x18 + 0x20) & 0xffff, 0);           // 7358
    printf(this.ds(0x8d22));
    let di = 0;
    for (let B = flag; B; B = this.u16(B + 8)) {
      if (!this.alive(B)) continue;
      const R = m.ship(shipSlotByAddr(m, this.u16(B + 2)).ship);
      con.setCursor(2, ((di + 2) * 0x18) & 0xffff);
      printf(this.ds(0x8d29), (this.u8(B + 0x0d) & 0x0f) + 1, R.nameBytes);
      con.setCursor(0x14, -1);                                          // 442c
      if (B === flag) printf(this.ds(0x8d31));
      else { this.orderA(B); this.orderB(B); }                          // affe / b03e
      di++;
    }
    await menu.waitPrompt();                                            // 490b
    this.msgArea();                                                     // c2ee
  }
  orderA(B) {                                                           // affe: 撤离 / 集结 / 分敢、攻势 / 守势
    const f = this.u8(B + 0x0c), pf = a => this.c.printf(this.ds(a));
    pf(f & 8 ? 0x8cd6 : f & 4 ? 0x8cdc : 0x8ce2); pf(f & 1 ? 0x8ce8 : 0x8cee);
  }
  orderB(B) {                                                           // b03e: 攻击 / 退避、砲击 / 肉搏、对象
    const f = this.u8(B + 0x0c), pf = (a, ...x) => this.c.printf(this.ds(a), ...x);
    pf(f & 2 ? 0x8cf4 : 0x8cfa); pf(f & 0x10 ? 0x8d00 : 0x8d08);
    if (f & 0x80) { const T = this.u16(B + 6); pf(this.u8(T + 0x0d) & 0x20 ? 0x8d10 : 0x8d13); pf(0x8d16, this.shipName(this.u8(T + 0x0d) & 0x0f)); }
    else pf(0x8d19);
  }
  // b30f 信号: 目前这艘 (旗舰) +0c bit3 / bit2 / bit0 切换 → 结束时抄给本方之后的每艘
  async cmdSignal() {
    const { con, menu, printf } = this.c, cur = this.u16(0x9bc2), R = menu.rects;
    if (this.c.scr._battleHudActive && hasDom()) {
      await runDomBattleSignal(this, cur);
      for (let B = this.u16(cur + 8); B; B = this.u16(B + 8)) {
        const f = this.u8(cur + 0x0c);
        this.set8(B + 0x0c, (this.u8(B + 0x0c) & 0xf0) | (f & 0x0d) | ((f & 1) << 1));
      }
      this.msgArea();
      return 0;
    }
    this.msgArea();                                                     // c2ee
    this.signalText(cur);                                               // b2b5
    for (let i = 0; i < 3; i++) R[i] = { x0: 0x1b8 + 0x30 * i, x1: 0x1d8 + 0x30 * i, y0: 0x170, y1: 0x180 };
    R[3] = { x0: 0x1a8, x1: 0x268, y0: 0x148, y1: 0x1e0 };
    for (;;) {
      con.bg = 0;                                                       // [8a28]
      con.setCursor(0x3e, 0x160); printf(this.ds(0x8d83));
      con.setCursor(0x36, 0x170); this.signalText(cur);
      menu.cur = this.cursorCell(cur);                                  // [a160]
      const r = (await menu.customMenu(3, 3, 1)) & 0xff;                // 0fea:4684
      if (r === 0xff) break;
      if (r < 3) this.set8(cur + 0x0c, this.u8(cur + 0x0c) ^ [8, 4, 1][r]);
    }
    for (let B = this.u16(cur + 8); B; B = this.u16(B + 8)) {
      const f = this.u8(cur + 0x0c);
      this.set8(B + 0x0c, (this.u8(B + 0x0c) & 0xf0) | (f & 0x0d) | ((f & 1) << 1));
    }
    this.msgArea();
    return 0;
  }
  // b2b5 信号的现况
  signalText(B) {
    const { con, printf } = this.c, f = this.u8(B + 0x0c);
    con.puts(this.ds(0x8d52));
    printf(this.ds(f & 8 ? 0x8d59 : 0x8d60)); printf(this.ds(f & 4 ? 0x8d67 : 0x8d6e)); printf(this.ds(f & 1 ? 0x8d75 : 0x8d7c));
    con.bg = 7;
  }
  // b6db 作战: b44a 选本方的船 → b61f, 直到取消
  async cmdOrders() {
    for (;;) { const B = await this.pickOwn(); if (!B) return 0; await this.shipOrders(B); }
  }
  // b44a: 缓冲 0 → a541 标记 → 0x305 → bb80 选格 → c2ee / c608
  async pickOwn() {
    this.mvFill(0);
    if (!this.markOwn()) return 0;                                      // a541
    this.msgArea(); this.c.message(0x305);
    const B = await this.pickOwnCell();                                 // bb80
    this.msgArea(); this.redraw();
    return B;
  }
  // a541 目前这艘之后、本方窗口内的活船 → bd3f 1、缓冲 |= 0x80
  markOwn() {
    let any = 0;
    for (let B = this.u16(this.u16(0x9bc2) + 8); B; B = this.u16(B + 8)) {
      if (!this.alive(B)) continue;
      const [x, y] = this.pos(B);
      if (!this.inView(x, y)) continue;
      this.mark(x, y, 1); this.mv[this.mvAt(this.s16(B + 4))] |= 0x80; any = 1;
    }
    return any;
  }
  // bb80 标记的格上 d52c 的本方船 (目前这艘之后); 取消 → 0
  async pickOwnCell() {
    this.cellRects();
    for (;;) {
      const c = await this.pickCell();
      if (c === -1) return 0;
      if (!(this.mv[this.mvAt(c)] & 0x80)) continue;
      for (let B = this.u16(this.u16(0x9bc2) + 8); B; B = this.u16(B + 8)) if (this.alive(B) && this.s16(B + 4) === c) return B;
    }
  }
  // b61f 一艘船的命令: 0 策略 (bit1, bit0 = bit1)、1 战术 (bit4)、2 对象 (bit7 + +6)
  async shipOrders(B) {
    if (this.c.scr._battleHudActive && hasDom()) {
      await runDomBattleShipOrders(this, B);
      this.msgArea();
      return;
    }
    const { menu } = this.c;
    this.msgArea();
    for (;;) {
      this.ordersText(B);                                               // b4a5
      menu.cur = this.cursorCell(this.u16(0x9bc2));
      const r = (await menu.customMenu(3, 1, 1)) & 0xff;                // 0fea:4684
      if (r === 0xff) break;
      if (r === 0) { this.set8(B + 0x0c, this.u8(B + 0x0c) ^ 2); this.and8(B + 0x0c, 0xfe); this.or8(B + 0x0c, (this.u8(B + 0x0c) & 2) >> 1); }
      else if (r === 1) this.set8(B + 0x0c, this.u8(B + 0x0c) ^ 0x10);
      else if (r === 2) {
        if (!(this.u8(B + 0x0c) & 0x80)) { this.or8(B + 0x0c, 0x80); this.set16(B + 6, await this.pickTargetFor()); }
        else { this.and8(B + 0x0c, 0x7f); this.set16(B + 6, 0); }
        if (!this.u16(B + 6)) this.and8(B + 0x0c, 0x7f);
      }
    }
    this.msgArea();
  }
  // b4a5 一艘船的命令现况与点击区
  ordersText(B) {
    const { con, printf, menu } = this.c, f = this.u8(B + 0x0c), R = menu.rects, pf = (a, ...x) => printf(this.ds(a), ...x);
    con.puts(this.ds(0x8d86));
    con.setCursor(0x36, 0x150); pf(0x8d8d); pf(f & 2 ? 0x8d94 : 0x8da1);
    con.setCursor(0x36, 0x160); pf(0x8dae); pf(f & 0x10 ? 0x8db5 : 0x8dc2);
    con.setCursor(0x36, 0x170); pf(0x8dcf);
    if (f & 0x80) { const T = this.u16(B + 6); pf(this.u8(T + 0x0d) & 0x20 ? 0x8dd6 : 0x8ddd); pf(0x8de4, this.shipName(this.u8(T + 0x0d) & 0x0f)); }
    else pf(0x8de7);
    for (let i = 0; i < 3; i++) R[i] = { x0: 0x1e0, x1: 0x240, y0: (i + 0x15) << 4, y1: ((i + 0x15) << 4) + 0x10 };
    R[3] = { x0: 0x1a8, x1: 0x268, y0: 0x148, y1: 0x1e0 };
    con.bg = 7;
  }
  // b5c4 指定对象: 缓冲 0 → a5c2 → 0x306 → bbcd → c2ee / c608
  async pickTargetFor() {
    this.mvFill(0);
    if (!this.markEnemyVis()) return 0;                                 // a5c2
    this.msgArea(); this.c.message(0x306);
    const T = await this.pickEnemyCell();                               // bbcd
    this.msgArea(); this.redraw();
    return T;
  }
  // a5c2 对方两方、窗口内的活船 → bd3f 2、缓冲 |= 0x80
  markEnemyVis() {
    let any = 0, E = this.enemySide(this.u16(0x9bc2));
    for (let k = 0; k < 2; k++, E += 0x10)
      for (let B = this.u16(E); B; B = this.u16(B + 8)) {
        if (!this.alive(B)) continue;
        const [x, y] = this.pos(B);
        if (!this.inView(x, y)) continue;
        this.mark(x, y, 2); this.mv[this.mvAt(this.s16(B + 4))] |= 0x80; any = 1;
      }
    return any;
  }
  // bbcd 标记的格上任何对方的船 (不看死活); 取消 → 0
  async pickEnemyCell() {
    this.cellRects();
    for (;;) {
      const c = await this.pickCell();
      if (c === -1) return 0;
      if (!(this.mv[this.mvAt(c)] & 0x80)) continue;
      let E = this.enemySide(this.u16(0x9bc2));
      for (let k = 0; k < 2; k++, E += 0x10) for (let B = this.u16(E); B; B = this.u16(B + 8)) if (this.s16(B + 4) === c) return B;
    }
  }

  // ================= ad20 移动 (RE_NOTES 30.6) =================
  // [97d4] 远程缓冲 0x34 × 0x30 (不在 DS): 移动 bit4 可到达 / bit7 第一步可到达; 转向 / 攻击 bit6 目标、bit1 射界内、bit0 相邻
  //   原版以 [97d4] + 位置 访问 (位置可能超出 0..0x9bf), 移植版在 64K 数组的 0x2000 处
  get mv() { return (this.c.battleMv ??= new Uint8Array(0x10000)); }
  mvAt(p) { return (0x2000 + btS16(p)) & 0xffff; }
  mvFill(v) { this.mv.fill(v & 0xff, 0x2000, 0x2000 + 0x9c0); }       // d3f7(0x9c0, v, [97d4])
  // DS:9c06 方向表 (6 × 3 word: dx、偶数栏 dy、奇数栏 dy): 位置 p 往方向 d 的邻格 (栏, 列)
  nb(p, d) {
    p = btS16(p); const x = btImod(p, 0x34), y = btIdiv(p, 0x34);
    return [x + this.s16(0x9c06 + 6 * d), y + this.s16(0x9c06 + 2 * (3 * d + (btImod(x, 2) === 0 ? 1 : 2)))];
  }
  abil(B, k) { return personByAddr(this.m, this.u16(B)).getStats(k); }               // d419: 船长 +1c + k
  // d745 惯性: s = (转向 × 船长 +1d) / 200 (有号), min(100, s + (船长 +24 × s) / 15)
  inertia(B) {
    const m = this.m, S = shipSlotByAddr(m, this.u16(B + 2)), P = personByAddr(m, this.u16(B));
    const si = btIdiv(btS16((S.turn * this.abil(B, 1)) & 0xffff), 200) & 0xffff;
    return btUmin(0x64, (Math.floor(((P.navLevel * si) & 0xffff) / 15) + si) & 0xffff);
  }
  // d792 移动力: s = ((推进 × 风力) << 3) / 150 + 20, s = s × 船长 +1d / 100, max(10, min(25, s + (船长 +24 × s) / 15))
  movePts(B) {
    const m = this.m, S = shipSlotByAddr(m, this.u16(B + 2)), P = personByAddr(m, this.u16(B));
    let si = Math.floor((((S.propulsion * this.u8(0x9bf9)) << 3) & 0xffff) / 0x96) + 0x14;
    si = Math.floor(((si * this.abil(B, 1)) & 0xffff) / 0x64);
    const a = btUmin(0x19, (Math.floor(((P.navLevel * si) & 0xffff) / 15) + si) & 0xffff);
    return (a >= 0x0a ? a : 0x0a) & 0xff;
  }
  // d6f6 一步的消耗 (新方向 nd, 原方向 dir)
  stepCost(B, nd, dir) {
    const S = shipSlotByAddr(this.m, this.u16(B + 2)), w = this.u8(0x9bf2 + (nd & 0xff));
    if ((nd & 0xff) === (dir & 0xff)) return (Math.floor((S.propulsion * w) / 0x64) + 5) & 0xff;
    if (w < 3) return 5;
    return (0x0a - Math.floor((5 * S.turn) / 0x64)) & 0xff;
  }
  // dc3c 可到达范围
  reach(B, p, dir, pts, mom) {
    this.mvFill(0x0f);
    this.mv[this.mvAt(p)] |= 0x10;
    this.reachRec(B, p, dir, pts, mom);                                 // db20
    for (let d = 5; d < 8; d++) {
      const [nx, ny] = this.nb(p, (d + dir) % 6), q = this.mvAt((ny * 0x34 + nx) & 0xffff);
      if (this.mv[q] & 0x10) this.mv[q] |= 0x80;
    }
  }
  // db20 递归: 惯性' < 50 时只看正前 (方向 + 6)
  reachRec(B, p, dir, pts, mom) {
    const m = btUmin(0x64, (this.inertia(B) + mom) & 0xffff) & 0xff;
    for (let d = 5; d < 8; d++) {
      if (m < 0x32 && d !== 6) continue;                                // d786
      const nd = (d + dir) % 6, [nx, ny] = this.nb(p, nd), cost = this.stepCost(B, nd, dir), q = (ny * 0x34 + nx) & 0xffff;
      if (!this.inMap(nx, ny) || (this.u8(this.mapAt(nx, ny)) & 0xe0) || cost > pts) continue;
      this.mv[this.mvAt(q)] |= 0x10;
      this.reachRec(B, q, nd, (pts - cost) & 0xff, d === 6 ? m : 0);
    }
  }
  // bd3f 标记图 (HD Canvas 六角框 / 方向标记，取代 hdat.bin 点阵)
  mark(x, y, t) {
    const { scr } = this.c;
    const dx = (x - this.u8(0x9bef)) * 32, dy = (y - this.u8(0x9bf0)) * 32 + (btImod(x, 2) === 0 ? 0 : 16);
    const di = t === 1 ? 2 : t === 3 ? 6 : t === 4 ? 3 : 4;
    if (scr.hdCtx) {
      const S = 2, ctx = scr.hdCtx;
      scr.bakeFbToHd(dx, dy, 32, 32);
      ctx.save();
      ctx.strokeStyle = scr.colorCss(di);
      ctx.lineWidth = 2 * S;
      ctx.strokeRect((dx + 3) * S, (dy + 3) * S, 26 * S, 26 * S);
      ctx.restore();
      scr.dirty = true;
    }
  }
  // a6f2 标出可到达的格、已走的路径、可攻击的船; 返回有没有第一步可到达 (bit7) 的格
  showReach() {
    const idx = this.u8(0x9bee), p = this.s16(0x9bd0 + 2 * idx), cx = btImod(p, 0x34), cy = btIdiv(p, 0x34);
    let any = 0;
    for (let y = this.u8(0x9bf0); this.u8(0x9bf0) + 0x0c > y; y++) for (let x = this.u8(0x9bef); this.u8(0x9bef) + 0x0d > x; x++) {
      const d = this.dist(cx, cy, x, y) & 0xff, v = this.mv[this.mvAt((y * 0x34 + x) & 0xffff)];
      if (!(v & 0x10) || !d) continue;
      if (v & 0x80) { this.mark(x, y, 1); any = 1; } else this.mark(x, y, 2);
    }
    for (let i = 1; i <= this.u8(0x9bee); i++) {
      const q = this.s16(0x9bd0 + 2 * i);
      this.mark(btImod(q, 0x34), btIdiv(q, 0x34), this.u8(0x9be4 + i) | 0x80);
    }
    this.markTargets();                                                 // a40a
    return any;
  }
  // a40a 两个敌方的活船: 射界内 → 标记 3、缓冲 |= 0x42; 相邻 → 标记 4、|= 0x41
  markTargets() {
    const idx = this.u8(0x9bee), p = this.s16(0x9bd0 + 2 * idx), x = btImod(p, 0x34), y = btIdiv(p, 0x34), dir = this.u8(0x9be4 + idx);
    const cur = this.u16(0x9bc2);
    let E = this.enemySide(cur), r = 0;
    for (let k = 0; k < 2; k++, E += 0x10) for (let si = this.u16(E); si; si = this.u16(si + 8)) {
      if (!this.alive(si) || (this.u8(si + 0x0c) & 0x40)) continue;
      const [ex, ey] = this.pos(si), q = this.mvAt(this.s16(si + 4));
      if (this.inRange(cur, x, y, ex, ey, dir)) { if (this.inView(ex, ey)) this.mark(ex, ey, 3); this.mv[q] |= 0x42; r = 1; }
      if ((this.dist(x, y, ex, ey) & 0xff) === 1) { if (this.inView(ex, ey)) this.mark(ex, ey, 4); this.mv[q] |= 0x41; r = 1; }
    }
    return r;
  }
  // b916 选格用的矩形 (DS:bdcc): 13 × 12 格 + 整个战场
  cellRects() {
    const R = this.c.menu.rects; let di = 0;
    for (let dy = 0; dy < 0x0c; dy++) for (let si = 0; si < 0x0d; si++, di++) {
      const y0 = (((this.u8(0x9bef) + si) % 2) ? 0x10 : 0) + (dy << 5);
      R[di] = { x0: si << 5, x1: (si << 5) + 0x20, y0, y1: y0 + 0x20 };
    }
    R[di] = { x0: 0, x1: 0x1a0, y0: 0, y1: 0x190 };
  }
  // b99c 选一格: [a160] = 目前位置 → 0fea:4684 (156 项、13 栏、可取消且保留光标); 返回位置, 取消 → −1
  async pickCell() {
    const menu = this.c.menu, p = this.s16(0x9bd0 + 2 * this.u8(0x9bee));
    menu.cur = (btImod(p, 0x34) + (btIdiv(p, 0x34) - this.u8(0x9bf0)) * 0x0d - this.u8(0x9bef)) & 0xffff;
    menu.hexX = this.u8(0x9bef);                                       // 13e0e 的斜向键读 DS:9bef
    const r = (await menu.customMenu(0x9c, 0x0d, 3)) & 0xff;
    if (r === 0xff) return -1;
    return btS16(((Math.floor(r / 0x0d) + this.u8(0x9bf0)) * 0x34 + r % 0x0d + this.u8(0x9bef)) & 0xffff);
  }
  // ba28 选方向: 目前位置 → 0x80, 左前 / 正前 / 右前中缓冲 bit7 的格 → 该方向, 取消 → 0xff
  async pickDir() {
    const idx = this.u8(0x9bee), p = this.s16(0x9bd0 + 2 * idx), dir = this.u8(0x9be4 + idx);
    this.cellRects();
    for (;;) {
      const c = await this.pickCell();
      if (c === -1) return 0xff;
      if (this.s16(0x9bd0 + 2 * this.u8(0x9bee)) === c) return 0x80;
      for (let d = 5; d < 8; d++) {
        const nd = (dir + d) % 6, [nx, ny] = this.nb(p, nd), q = btS16((ny * 0x34 + nx) & 0xffff);
        if (q === c && (this.mv[this.mvAt(q)] & 0x80)) return nd;
      }
    }
  }
  redraw() { this.drawField(); this.drawShips(); }                     // c608 = c5ff + c0ad
  // ad20 移动: a899 逐步移动 → 有移动时 ac7d; 否则 aaac 原地转向 → 有转向时 ac7d
  async cmdMove() {
    if (!(await this.moveSteps())) { if (!(await this.turnInPlace())) return 0; }
    await this.attack();
    return 1;
  }
  // a899 逐步移动 (区域变量: 惯性[i] = bp−22 + 2i、移动力[i] = bp−0e + i、选到的方向 bp−1; 以 L 模拟堆栈框)
  async moveSteps() {
    const L = new Uint8Array(0x30), F = k => 0x30 - k;
    const mom = i => L[F(0x22) + 2 * i] | (L[F(0x22) + 2 * i + 1] << 8), setMom = (i, v) => { L[F(0x22) + 2 * i] = v & 0xff; L[F(0x22) + 2 * i + 1] = (v >> 8) & 0xff; };
    const pts = i => L[F(0x0e) + i], setPts = (i, v) => { L[F(0x0e) + i] = v & 0xff; };
    for (;;) {
      for (let i = 0; i < 0x0a; i++) this.set8(0x9bc6 + i, 0x0f);       // 4c39
      this.set8(0x9bee, 0);
      let B = this.u16(0x9bc2);
      this.set16(0x9bd0, this.u16(B + 4)); this.set8(0x9be4, this.u8(B + 0x0a));
      setMom(0, this.u8(B + 0x0b));
      setPts(0, this.movePts(B));                                       // d792
      for (;;) {
        let idx = this.u8(0x9bee);
        this.reach(this.u16(0x9bc2), this.s16(0x9bd0 + 2 * idx), this.u8(0x9be4 + idx), pts(idx), mom(idx));   // dc3c
        if (!this.showReach()) break;                                   // a6f2
        this.msgArea(); this.c.message(0x2ff);
        L[F(1)] = await this.pickDir();                                 // ba28
        if (L[F(1)] === 0xff) { this.msgArea(); this.redraw(); break; }
        this.msgArea(); this.redraw();
        if (L[F(1)] === 0x80) {
          this.set8(0x9bc6 + this.u8(0x9bee), 0x0f);
          this.set8(0x9bee, this.u8(0x9bee) - btUmin(1, this.u8(0x9bee)));
          continue;
        }
        idx = this.u8(0x9bee);
        const r = L[F(1)], [nx, ny] = this.nb(this.s16(0x9bd0 + 2 * idx), r);
        this.set16(0x9bd2 + 2 * idx, (ny * 0x34 + nx) & 0xffff);         // 步 = 9 时盖到 9be4 / 9be5
        this.set8(0x9be5 + idx, L[F(1)]);                               // 步 = 9 时就是 [9bee]
        if (this.u8(0x9be4 + idx) !== L[F(1)]) setMom(this.u8(0x9bee) + 1, 0);
        else { const s = this.u8(0x9bee); B = this.u16(0x9bc2); setMom(s + 1, btUmin(0x64, (this.inertia(B) + mom(s)) & 0xffff) & 0xff); }
        const s = this.u8(0x9bee);
        setPts(s + 1, pts(s) - this.stepCost(this.u16(0x9bc2), L[F(1)], this.u8(0x9be4 + s)));
        this.set8(0x9bc6 + this.u8(0x9bee), L[F(1)]);
        const old = this.u8(0x9bee); L[F(2)] = old; this.set8(0x9bee, old + 1);
        if (old >= 9) break;
      }
      if (!this.u8(0x9bee)) return 0;
      this.showReach();
      this.msgArea(); this.c.message(0x300);
      const ok = await this.confirm();                                  // bca4
      this.msgArea(); this.redraw();
      if (ok) {
        this.set16(0x9bc4, this.u16(0x9bd0 + 2 * this.u8(0x9bee)));
        await this.runPath();                                           // a2d5
        await this.scrollTo();                                          // a80a
        return this.u8(0x9bee);
      }
    }
  }
  // a2d5 照 9bc6 的路径移动 (起点 ≠ 终点才真的移动)
  async runPath() {
    const di = this.s16(this.u16(0x9bc2) + 4) !== this.s16(0x9bc4) ? 1 : 0;
    for (let si = 0x9bc6, n = 0; this.u8(si) < 6 && n < 0x0a; si++, n++) {
      const B = this.u16(0x9bc2), old = this.u8(B + 0x0a);
      this.set8(B + 0x0a, this.u8(si));
      if (old !== this.u8(si) && di) this.set8(B + 0x0b, 0);
      else this.set8(B + 0x0b, btUmin(0x64, (this.inertia(B) + this.u8(B + 0x0b)) & 0xffff));
      await this.stepShip(di);                                          // c611
    }
  }
  // c611 目前的船往 +0a 方向移一格 (moved = 0 时原地重画)
  async stepShip(moved) {
    const B = this.u16(0x9bc2), p = this.s16(B + 4), si = btImod(p, 0x34), di = btIdiv(p, 0x34);
    let [nx, ny] = moved ? this.nb(p, this.u8(B + 0x0a)) : [si, di];
    this.set16(B + 4, (0x34 * ny + nx) & 0xffff);
    if (this.inView(si, di)) this.tile(si, di);                         // c2a4
    this.miniDot(si, di, 0x405);                                        // be49(色 5)
    this.drawShip(this.u16(0x9bc2));                                    // c05d
    this.miniShip(this.u16(0x9bc2));                                    // beb7
    await this.c.sys.waitTicks(8);
    const o = this.mapAt(si, di), a = this.u8(o) & 0xe0;
    this.and8(o, 0x1f);
    const n = (0x8e14 + ((0x34 * ny) & 0xffff) + nx) & 0xffff;
    this.and8(n, 0x1f); this.or8(n, a);
  }
  // a80a 窗口每次各轴移 1 格卷到以目前的船为准的位置
  async scrollTo() {
    const ox = this.u8(0x9bef), oy = this.u8(0x9bf0);
    this.viewFor(this.u16(0x9bc2));                                     // f7e3
    const tx = this.u8(0x9bef), ty = this.u8(0x9bf0);
    this.set8(0x9bef, ox); this.set8(0x9bf0, oy);
    while (this.u8(0x9bef) !== tx || this.u8(0x9bf0) !== ty) {
      if (this.u8(0x9bef) !== tx) this.set8(0x9bef, this.u8(0x9bef) < tx ? this.u8(0x9bef) + 1 : this.u8(0x9bef) - 1);
      if (this.u8(0x9bf0) !== ty) this.set8(0x9bf0, this.u8(0x9bf0) < ty ? this.u8(0x9bf0) + 1 : this.u8(0x9bf0) - 1);
      await this.c.sys.waitTicks(4);
      this.redraw();
    }
  }
  // aaac 原地转向: 左前 / 右前 (+5 / +7) 的邻格 |= 0x90 → 0x301 → ba28
  async turnInPlace() {
    let B = this.u16(0x9bc2);
    this.set8(0x9bee, 0); this.set16(0x9bd0, this.u16(B + 4)); this.set8(0x9be4, this.u8(B + 0x0a));
    this.mvFill(0);
    const p = this.s16(B + 4), dir = this.u8(B + 0x0a);
    for (let d = 5; d < 8; d += 2) {
      const [nx, ny] = this.nb(p, (dir + d) % 6);
      if (this.inMap(nx, ny)) this.mv[this.mvAt((ny * 0x34 + nx) & 0xffff)] |= 0x90;
    }
    this.showReach();
    this.msgArea(); this.c.message(0x301);
    const r = await this.pickDir();
    if (r & 0x80) { this.msgArea(); this.redraw(); return 0; }
    B = this.u16(0x9bc2); this.set8(B + 0x0a, r); this.set8(B + 0x0b, 0);
    this.msgArea(); this.redraw();
    await this.stepShip(0);
    await this.scrollTo();
    return 1;
  }
  // ac7d 攻击 (指令 攻击 ad38 也是它): 没有目标 → 0; 0x304 → bb0b 选目标 → 射界内 e8cc 砲击, 否则 abef (一骑打) / e95e 接舷
  async attack() {
    this.mvFill(0);
    this.set8(0x9bee, 0);
    const B = this.u16(0x9bc2);
    this.set16(0x9bd0, this.u16(B + 4)); this.set8(0x9be4, this.u8(B + 0x0a));
    if (!this.markTargets()) return 0;
    this.msgArea(); this.c.message(0x304);
    const T = await this.pickTarget();                                  // bb0b
    if (!T) { this.msgArea(); this.redraw(); return 0; }
    this.msgArea(); this.redraw();
    if (this.mv[this.mvAt(this.s16(T + 4))] & 2) await this.gunnery(T); // e8cc
    else if (!(await this.duelOffer(T))) await this.board(T);           // abef / e95e
    return 1;
  }
  // bb0b 选目标: 缓冲 & 0x43 且有敌方活船的格
  async pickTarget() {
    this.cellRects();
    for (;;) {
      const c = await this.pickCell();
      if (c === -1) return 0;
      if (!(this.mv[this.mvAt(c)] & 0x43)) continue;
      let E = this.enemySide(this.u16(0x9bc2));
      for (let k = 0; k < 2; k++, E += 0x10) for (let si = this.u16(E); si; si = this.u16(si + 8)) if (this.alive(si) && this.s16(si + 4) === c) return si;
    }
  }
  // abef 目标是敌方旗舰: 0x302 是否 → 是: random(主角 +23) + 本船水手 ≥ 目标水手 → 0fea:2d1a(1, 目标) 一骑打 (返回 1); 否则 0x303
  async duelOffer(T) {
    const E = this.enemySide(this.u16(0x9bc2));
    if (this.u16(E) !== T && this.u16(E + 0x10) !== T) return 0;
    this.msgArea(); this.c.message(0x302);
    if (await this.confirm()) {
      this.msgArea();
      const m = this.m, a = (this.rnd(m.heroPerson().getStats(7)) + shipSlotByAddr(m, this.u16(this.u16(0x9bc2) + 2)).crew) & 0xffff;
      if (a >= shipSlotByAddr(m, this.u16(T + 2)).crew) { await this.duel(1, T); return 1; }
      this.c.message(0x303); await this.c.menu.waitPrompt();
      this.msgArea();
    }
    this.msgArea();
    return 0;
  }
  // ================= e8cc 砲击 (RE_NOTES 30.8) =================
  // e8cc: e735 损伤 → cdcd 动画 → 目标耐久 = 0 → e679 击沉; 水手 = 0 → e6bb 无人船; 否则目前这方是主角舰队时 e616(本船船长, 10) → 本船 +0e (砲弹) − 1
  async gunnery(T) {
    this.damage(T);                                                     // e735
    await this.shotAnim(T);                                             // cdcd
    const S = shipSlotByAddr(this.m, this.u16(T + 2));
    if (!S.durability) this.sink(T);                                    // e679
    else if (!S.crew) this.unmanned(T);                                 // e6bb
    else if (this.u16(this.u16(0x9bc0) + 4) === this.heroFleet) this.gainExp(this.u16(this.u16(0x9bc2)), 0x0a);   // e616
    const B = this.u16(0x9bc2);
    this.set16(B + 0x0e, this.u16(B + 0x0e) - 1);
    this.c.probe?.("e8cc");                                             // 差分测试的快照点 (原版 e91a); 游戏中不做任何事
  }
  // d5e4 两艘船的六角格距离 (d54a)
  shipDist(A, B) { const [x, y] = this.pos(A), [tx, ty] = this.pos(B); return this.dist(x, y, tx, ty) & 0xff; }
  // d427 能力 +1c + k: 船长是主角 ([c2ce]) 时再与职务 3 / 5 的船员 (seg0:5cee) 比, 取较大
  bestAbil(B, k) {
    const m = this.m, P = personByAddr(m, this.u16(B));
    let v = P.getStats(k & 0xff);
    if (P.addr === m.heroPerson().addr) for (const role of [3, 5]) {
      const n = this.sea.b.roleMember(role);
      if (n !== 0xff) { const w = m.person(n).getStats(k & 0xff); if (w > v) v = w; }
    }
    return v;
  }
  // d48f 战斗等级 +25: 同上
  bestLevel(B) {
    const m = this.m, P = personByAddr(m, this.u16(B));
    let v = P.battleLevel;
    if (P.addr === m.heroPerson().addr) for (const role of [3, 5]) {
      const n = this.sea.b.roleMember(role);
      if (n !== 0xff) { const w = m.person(n).battleLevel; if (w > v) v = w; }
    }
    return v;
  }
  // d4e4 +30 bit2 (砲术): 船长有, 或船长是主角时职务 3 / 5 的船员有
  gunSkill(B) {
    const m = this.m, P = personByAddr(m, this.u16(B));
    if (P.skills & 4) return 1;
    if (P.addr !== m.heroPerson().addr) return 0;
    for (const role of [3, 5]) { const n = this.sea.b.roleMember(role); if (n !== 0xff && (m.person(n).skills & 4)) return 1; }
    return 0;
  }
  // d9de 砲击威力 (AL = 距离 d): 乘除都照原版的 16 / 32 比特宽度
  power(B, d) {
    const m = this.m, S = shipSlotByAddr(m, this.u16(B + 2)), P = personByAddr(m, this.u16(B));
    const a10 = this.bestAbil(B, 0), lv = this.bestLevel(B);
    const v8 = (btIdiv(btS16((this.bestAbil(B, 0) * lv) & 0xffff), 0x64) + (a10 >> 1)) & 0xffff;               // [bp-8]
    const m1 = btUdiv32((this.u8(B + 0x17) * btS16(S.crew)) >>> 0, 0x64) & 0xffff;                            // 士气 × 水手 / 100
    const guns = btUmin(S.guns >> 1, m1 >>> 1);                                                               // [bp-0a]
    const q = btUdiv32((this.u8(B + 0x0f + (d & 0xff)) * guns) >>> 0, 0x0a);                                  // 命中率[d] × m / 10
    const r = this.gunSkill(B) ? btUdiv32((q + 0x13) >>> 0, 0x14) : btUdiv32((q + 0x27) >>> 0, 0x28);
    let v = btUdiv32(btMul32(r, v8), 0x64) & 0xffff;
    v = btUdiv32(btMul32(v, (this.rnd(this.bestAbil(B, 5) >> 1) + 0x32) & 0xffff), 0x64) & 0xffff;
    v = btUmin(v, (this.rnd(P.battleLevel >> 1) + 0x32) & 0xffff);
    return btUmax(v, 1);
  }
  // e735 损伤: 威力 di; 种类 (bit0 最大耐久、bit1 推进、bit2 转向) 依威力以随机数表决定 (跳跃表 e782 / e7ea)
  damage(T) {
    const m = this.m, S = shipSlotByAddr(m, this.u16(T + 2)), cur = this.u16(0x9bc2);
    const d = this.shipDist(cur, T);
    const di = this.power(cur, d);
    let k = 0;
    if (di >= 0x0a || !this.rnd(5)) k = [1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 3, 3, 5, 5, 6, 6, 7][this.rnd(0x13)];
    if (di >= 0x14) k = [3, 3, 5, 5, 6, 6, 7][this.rnd(7)];
    if (di >= 0x28) k = 7;
    S.durability = S.durability - btUmin(S.durability, di);
    S.durability = btUmin(S.durability, S.maxDurability);
    { const v = (this.rnd(3) + (di >>> 1)) & 0xffff; S.crew = S.crew - btUmin(S.crew, v); }
    if (k & 1) {
      const t = m.shipType(m.ship(S.ship).type).durability >> 2;
      S.maxDurability = btUmax(t, (S.maxDurability - 1) & 0xffff);        // 4d87 (最大耐久 0 时是 FFFF → 写入 FF, 照搬)
    }
    if (k & 2) { const v = (this.rnd(3) + (di >>> 1)) & 0xffff; S.propulsion = S.propulsion - btUmin(S.propulsion, v); }
    if (k & 4) { const v = (this.rnd(3) + (di >>> 1)) & 0xffff; S.turn = S.turn - btUmin(S.turn, v); }
  }
  // 063e 遮罩 (模式 0x20f) + 3d2 图像 (模式 3), 都在 HDAT 段
  spr(col, y, w, h, mask, img) {
    this.c.scr.glyphMode(col, y, w, h, this.hd.subarray(mask & 0xffff), 0x20f);
    this.putOp(col, y, w, h, 3, this.hd, img & 0xffff);
  }
  restoreUnder() { this.c.win.closeNow(); }                            // c744: 还原 [0c88] 队列最上层的画面 (h > 16 且动画打开时分段还原, 结果相同)
  // cdcd 砲击动画: 两船任一在窗口内 → c853 砲弹; 目标在窗口内 → 效果音 9768(DS:0bec) + 9804(0x24) (不放键), 命中动画 4 + 4 + 4 格
  async shotAnim(T) {
    const B = this.u16(0x9bc2), [x0, y0] = this.pos(B), [tx, ty] = this.pos(T), { win, sys } = this.c;
    if (this.inView(x0, y0) || this.inView(tx, ty)) await this.trajectory(T);   // c853
    if (!this.inView(tx, ty)) return;
    this.c.sfx?.voice(0x0bec); this.c.sfx?.note(0x24);                // ce57: 9768(DS:0bec) + 9804(0x24)
    const col = ((tx - this.u8(0x9bef)) << 2) & 0xffff, y = ((((ty - this.u8(0x9bf0)) << 5) + (btImod(tx, 2) >= 1 ? 0x10 : 0))) & 0xffff;
    const both = async () => {
      const o = this.rnd(2) ? 0 : 2;
      for (let i = 0; i < 4; i++) {
        win.save(col, y, 4, 0x20);                                      // 50c4
        this.c.art?.drawSheetTile(this.c.scr, "battle_fx_lg", i, col * 8, y, { transparent: true });
        this.c.art?.drawSheetTile(this.c.scr, "battle_fx_sm", i, (col + o) * 8, y + 0x0c, { transparent: true });
        await sys.waitTicks(8);
        this.restoreUnder();                                            // c744
      }
    };
    await both();
    const r = this.u8(B + 0x15);
    if (r >= 4 && this.shipDist(T, B) === r) {                          // 射程 ≥ 4 且距离 = 射程: 只有小的那一组
      const o = this.rnd(2) ? 0 : 2;
      for (let i = 0; i < 4; i++) {
        win.save(col, y, 4, 0x20);
        this.c.art?.drawSheetTile(this.c.scr, "battle_fx_sm", i, (col + o) * 8, y + 0x0c, { transparent: true });
        await sys.waitTicks(8);
        this.restoreUnder();
      }
    } else {
      for (let i = 0; i < 4; i++) {
        win.save(col, y, 4, 0x20);
        this.c.art?.drawSheetTile(this.c.scr, "battle_fx_lg", i, col * 8, y, { transparent: true });
        await sys.waitTicks(8);
        this.restoreUnder();
      }
    }
    await both();
  }
  // c853 砲弹轨迹: 主轴每个计时单位走 1 点, 副轴以 32 比特定点抛物线 (0xe100 / d², 0x7080 / d, ×600); 每进入新的 8 × 8 点就存背景 (50c4)、
  //   不在射击者自己那格内时画砲弹 (HDAT 7b60 / 7b68, 1 栏 × 8 行), 换格时还原 (c744)
  async trajectory(T) {
    const B = this.u16(0x9bc2), { win, sys } = this.c;
    const [cx, cy] = this.pos(B), [tx, ty] = this.pos(T);
    const X0 = (cx << 5) & 0xffff, Y0 = ((cy << 5) + (btImod(cx, 2) >= 1 ? 0x10 : 0)) & 0xffff;
    const X1 = (tx << 5) & 0xffff, Y1 = ((ty << 5) + (btImod(tx, 2) >= 1 ? 0x10 : 0)) & 0xffff;
    const DX = X0 > X1 ? X0 - X1 : X1 - X0, DY = Y1 >= Y0 ? Y1 - Y0 : Y0 - Y1;
    let drawn = 0, pc, pr;                                              // [bp-2a], [bp-0c], [bp-0e]
    this.c.sfx?.voice(0x0bec); this.c.sfx?.note(0x24);                // c906: 9768(DS:0bec) + 9804(0x24) (不放键)
    const body = (x, y) => {
      const c = x >>> 3, r = y >>> 3;
      if (drawn && this.inView(pc >>> 2, pr >>> 2) && (pc !== c || pr !== r)) { this.restoreUnder(); drawn = 0; }
      if (drawn || !this.inView(c >>> 2, r >>> 2) || (pc === c && pr === r)) return;
      const col = (c - (this.u8(0x9bef) << 2) + 1) & 0xffff, yy = (y - (this.u8(0x9bf0) << 5) + 8) & 0xffff;
      win.save(col, yy, 1, 8); drawn = 1;                               // 50c4
      const inSrc = !(x + 8 < X0) && !(x + 8 >= X0 + 0x20) && !(y + 8 < Y0) && Y0 + 0x20 > y + 8;
      if (!inSrc) this.c.art?.drawSheetTile(this.c.scr, "battle_ball", 0, col * 8, yy, { transparent: true });
      pc = c; pr = r;
    };
    if (DY <= DX) {
      const Bq = btUdiv32(0xe100, (DX * DX) & 0xffff);                 // mul 之后高字节被清成 0 (照搬)
      let A = btUdiv32(0x7080, DX), acc = btMul32(Y0, 0x258);
      const slope = btS16(btSdiv32(btMul32(Y1 >= Y0 ? 0x258 : -0x258, DY), DX) & 0xffff);
      const step = X0 > X1 ? -1 : 1;
      let x = X0, y = Y0; pc = x >>> 3; pr = y >>> 3;
      for (;;) {
        body(x, y);
        if (x === X1) break;
        A = (A - Bq) >>> 0; acc = (acc + ((slope - A) | 0)) >>> 0;
        y = btUdiv32(acc, 0x258) & 0xffff;
        await sys.waitTicks(1);
        x = (x + step) & 0xffff;
      }
    } else {
      const Bq = btUdiv32(0xe100, (DY * DY) & 0xffff);
      let A = btUdiv32(0x7080, DY), acc = btMul32(0x258, X0);
      const slope = btS16(btSdiv32(btMul32(X0 > X1 ? -0x258 : 0x258, DX), DY) & 0xffff);
      const step = Y0 > Y1 ? -1 : 1;
      let x = X0, y = Y0; pc = x >>> 3; pr = y >>> 3;
      for (;;) {
        body(x, y);
        if (y === Y1) break;
        A = (A - Bq) >>> 0; acc = (acc + ((slope - A) | 0)) >>> 0;
        x = btUdiv32(acc, 0x258) & 0xffff;
        await sys.waitTicks(1);
        y = (y + step) & 0xffff;
      }
    }
    if (drawn && this.inView(pc >>> 2, pr >>> 2)) { await sys.waitTicks(1); this.restoreUnder(); }
  }
  // e616 战斗经验: 1bb9c(P +25 等级, P +28 经验, n) 的升级次数, 每次 +20 += random(3)、+21 += random(2) (上限 100)
  gainExp(pAddr, n) {
    const P = personByAddr(this.m, pAddr), c = this.levelUp(P, n);
    for (let i = 0; i < c; i++) {
      P.setStats(4, btUmin(0x64, this.rnd(3) + P.getStats(4)));
      P.setStats(5, btUmin(0x64, this.rnd(2) + P.getStats(5)));
    }
  }
  // 1bb9c 经验 += g; 足够时升级 (所需 = min(等级, 18)² × 30 (1bb84), 等级 100 时经验归零); 有升级时 P +1c..+1f 各 + min(random(3), 100 − 值)
  levelUp(P, g) {
    let n = 0;
    P.battleExp = (P.battleExp + g) & 0xffff;
    for (;;) {
      const lv = P.battleLevel, m = Math.min(lv, 0x12), need = btS16((m * m * 0x1e) & 0xffff);
      if (need > btS16(P.battleExp)) break;
      if (lv === 0x64) { P.battleExp = 0; break; }
      n++; P.battleExp = (P.battleExp - need) & 0xffff; P.battleLevel = lv + 1;
    }
    if (n) for (let i = 0; i < 4; i++) { const cur = P.getStats(i); P.setStats(i, cur + btUmin(this.rnd(3), (0x64 - cur) & 0xffff)); }
    return n;
  }
  // e679 击沉: 主角舰队打沉的 → e616(本船船长, 10 × 目标最大耐久); c6fa 擦掉; e5b1; 目标船位 +8 = 0 (船从舰队消失)
  sink(T) {
    const S = shipSlotByAddr(this.m, this.u16(T + 2));
    if (this.u16(this.u16(0x9bc0) + 4) === this.heroFleet) this.gainExp(this.u16(this.u16(0x9bc2)), (0x0a * S.maxDurability) & 0xffff);
    this.erase(T);                                                      // c6fa
    this.untarget(T);                                                   // e5b1
    S.flags = 0;
  }
  // e6bb 无人船: 地图格 &= 1f 后 |= 0x80 (变成障碍); 经验同上; e5b1; c0ad 重画所有的船
  unmanned(T) {
    const p = this.mapAt(...this.pos(T));
    this.and8(p, 0x1f); this.or8(p, 0x80);
    if (this.u16(this.u16(0x9bc0) + 4) === this.heroFleet) this.gainExp(this.u16(this.u16(0x9bc2)), (0x0a * shipSlotByAddr(this.m, this.u16(T + 2)).maxDurability) & 0xffff);
    this.untarget(T);
    this.drawShips();
  }
  // ================= e95e 接舷 (RE_NOTES 30.9) =================
  // 目前的船是本方旗舰且目标是主角舰队的旗舰 (= 电脑方的旗舰接舷主角): random(15) + 船长 +21 ≥ 主角 +21 且 船长 +23 ≥ random(目标水手) → 一骑打 (电脑发起;
  //   前后 [9c2a] = 200 − [9c2a]), 不接舷; 否则 e91f 白刃战 → d1eb 动画 → 目标水手 = 0 → e6bb 无人船, 否则目前这方是主角舰队时 e616(本船船长, 10)
  async board(T) {
    const cur = this.u16(0x9bc2), m = this.m;
    if (this.u16(this.u16(0x9bc0)) === cur) {
      const di = this.enemySide(cur), d2 = (di + 0x10) & 0xffff;
      if ((this.u16(di + 4) === this.heroFleet && this.u16(di) === T) || (this.u16(d2 + 4) === this.heroFleet && this.u16(d2) === T)) {
        const a = (this.rnd(0x0f) + this.abil(cur, 5)) & 0xffff;
        if (a >= m.heroPerson().getStats(5)) {
          const r = this.rnd(shipSlotByAddr(m, this.u16(T + 2)).crew);
          if (this.abil(cur, 7) >= r) {
            this.set8(0x9c2a, 0xc8 - this.u8(0x9c2a));
            await this.duel(0, T);                                      // 0fea:2d1a(0, T)
            this.set8(0x9c2a, 0xc8 - this.u8(0x9c2a));
            this.c.probe?.("e95e");
            return;
          }
        }
      }
    }
    this.melee(T);                                                      // e91f
    await this.boardAnim(T);                                            // d1eb
    if (!shipSlotByAddr(m, this.u16(T + 2)).crew) this.unmanned(T);     // e6bb
    else if (this.u16(this.u16(0x9bc0) + 4) === this.heroFleet) this.gainExp(this.u16(cur), 0x0a);   // e616
    this.c.probe?.("e95e");                                             // 差分测试的快照点 (原版 ea2e)
  }
  // e91f 白刃战: 目标水手 −= min(水手, d95e(本船)); 之后 本船水手 −= min(水手, d95e(目标)) (目标的威力以减少后的水手计算)
  melee(T) {
    const m = this.m, S = shipSlotByAddr(m, this.u16(T + 2)), cur = this.u16(0x9bc2);
    let p = this.meleePower(cur);
    S.crew = S.crew - btUmin(S.crew, p);
    const C = shipSlotByAddr(m, this.u16(cur + 2));
    p = this.meleePower(T);
    C.crew = C.crew - btUmin(C.crew, p);
  }
  // d95e 白刃战威力: di = (random(10) + 水手) × 士气 / 100 (32 比特无号); si = random(d427(5) / 2) + 50;
  //   a = 战力 +16 × di (imul, 有号) / 100; v = (a × si 的低 16 比特) / 100 (mul 之后 dx 被清成 0); max(1, min(50, v))
  meleePower(B) {
    const S = shipSlotByAddr(this.m, this.u16(B + 2));
    const di = btUdiv32((((this.rnd(0x0a) + S.crew) & 0xffff) * this.u8(B + 0x17)) >>> 0, 0x64) & 0xffff;
    const si = (this.rnd(this.bestAbil(B, 5) >> 1) + 0x32) & 0xffff;
    const a = btUdiv32((this.u8(B + 0x16) * btS16(di)) >>> 0, 0x64) & 0xffff;
    const v = Math.floor(((a * si) & 0xffff) / 0x64);
    return btUmax(btUmin(0x32, v), 1);
  }
  // d1eb 接舷动画: 两船都不在窗口内 → 不画; 否则 效果音 9768(DS:0c02) + 9804(0x30), 目标 → 本船 → 目标 各 8 格
  //   ([0c86] 段 0x2e20 + 0x280 × (0, 1, 2, 3, 1, 3, 0, 2)[i]: 图像 0x200 bytes、遮罩在其后; 每格 50c4 存背景 → 画 → 等 2 → c744); 最后 (9888) c05d 重画两船
  async boardAnim(T) {
    const cur = this.u16(0x9bc2), { win, sys, gfx } = this.c;
    const [cx, cy] = this.pos(cur), [tx, ty] = this.pos(T);
    if (!this.inView(cx, cy) && !this.inView(tx, ty)) return;
    this.c.sfx?.voice(0x0c02); this.c.sfx?.note(0x30);                // d2ea
    const tab = [0, 1, 2, 3, 1, 3, 0, 2];
    for (let k = 0; k < 3; k++) {
      const [x, y] = k % 2 ? [cx, cy] : [tx, ty];
      if (!this.inView(x, y)) continue;
      const col = ((x - this.u8(0x9bef)) << 2) & 0xffff, yy = ((((y - this.u8(0x9bf0)) << 5) + (btImod(x, 2) >= 1 ? 0x10 : 0))) & 0xffff;
      for (let i = 0; i < 8; i++) {
        win.save(col, yy, 4, 0x20);                                     // 50c4
        const o = (0x280 * tab[i] + 0x2e20) & 0xffff;
        this.c.scr.glyphMode(col, yy, 4, 0x20, gfx.subarray((o + 0x200) & 0xffff), 0x20f);
        this.putOp(col, yy, 4, 0x20, 3, gfx, o);
        await sys.waitTicks(2);
        this.restoreUnder();                                            // c744
      }
    }
    this.c.sfx?.off();                                                  // d3d0: 9888
    this.drawShip(T); this.drawShip(cur);                               // c05d
  }
  async duel(ax, T) {
    const { scr, sys } = this.c;
    const prevWide = scr.wideRenderer;
    const prevBv = sys._battleViewport;
    const prevActive = scr._battleHudActive;
    scr._battleHudActive = false;
    sys._battleViewport = null;
    hideDomBattleHud();
    try {
      return await duelInBattle(this, ax, T);
    } finally {
      scr.wideRenderer = prevWide;
      scr._battleHudActive = prevActive;
      sys._battleViewport = prevBv;
      scr.dirty = true;
    }
  }             // 0fea:2d1a = 12bba (scenes/duel.js)

  // b6f2 停船: c2ee → 0x307 → bca4 是否 → c2ee; 是 → 返回 1 (本回合结束)
  async cmdStop() {
    this.msgArea(); this.c.message(0x307);
    const r = await this.confirm();
    this.msgArea();
    return r ? 1 : 0;
  }
  // b723 撤离: c2ee → 0x308 → bca4 是否 → c2ee; 是 → e5fc (这艘船离开战场) 返回 1
  async cmdRetreat() {
    this.msgArea(); this.c.message(0x308);
    const r = await this.confirm();
    this.msgArea();
    if (!r) return 0;
    this.leaveField(this.u16(0x9bc2));                                  // e5fc
    return 1;
  }
  // bca4 是否: 暂时把文字范围设成 0..0x4f、光标 (0, 0xc8) 后 0fea:47fc, 再还原
  async confirm() {
    const con = this.c.con, l = con.left, r = con.right, x = con.x, y = con.y;
    con.right = 0x4f; con.left = 0; con.x = 0; con.y = 0xc8;
    const v = await this.c.menu.yesNo();
    con.left = l; con.right = r; con.x = x; con.y = y;
    return v;
  }
  // e5fc: c6fa 从战场擦掉 (窗口内重画该格、小地图色 5、地图格 &= 1f) → e5b1 对方两方以它为目标 (+0c bit7、+6) 的船解除 → +0c |= 0x40
  leaveField(B) {
    this.erase(B);                                                      // c6fa
    this.untarget(B);                                                   // e5b1
    this.or8(B + 0x0c, 0x40);
  }
  // e5b1 对方两方中以 B 为目标 (+0c bit7 且 +6 = B) 的船解除目标
  untarget(B) {
    let E = this.enemySide(B);
    for (let k = 0; k < 2; k++, E += 0x10)
      for (let bx = this.u16(E); bx; bx = this.u16(bx + 8))
        if ((this.u8(bx + 0x0c) & 0x80) && this.u16(bx + 6) === B) { this.set16(bx + 6, 0); this.and8(bx + 0x0c, 0x7f); }
  }
  // c6fa 擦掉一艘船
  erase(B) {
    const [x, y] = this.pos(B);
    if (this.inView(x, y)) this.tile(x, y);                             // c2a4 → c14e
    this.miniDot(x, y, 0x405);                                          // be49(色 5)
    this.and8(this.mapAt(x, y), 0x1f);
  }
  // b751 菜单的不可选项 ([a14c]): bit1 攻击 (没有可攻击的敌船: 射程内 d931 或相邻 d54a = 1)、bit3 信号 (本方没有其他活着的船)、
  //   bit4 作战 (其他船都不在窗口内)、bit6 随身物 (没有)、bit7 撤离 (不在地图边缘的海格)
  enable() {
    let dis = 0;
    const idx = this.u8(0x9bee), p = this.s16(0x9bd0 + 2 * idx), di = btImod(p, 0x34), y = btIdiv(p, 0x34), dir = this.u8(0x9be4 + idx);
    const cur = this.u16(0x9bc2);
    let E = this.enemySide(cur), n = 0;
    for (let k = 0; k < 2; k++, E += 0x10) {
      for (let si = this.u16(E); si; si = this.u16(si + 8)) {
        if (!this.alive(si) || (this.u8(si + 0x0c) & 0x40)) continue;
        const [ex, ey] = this.pos(si);
        if (this.inRange(cur, di, y, ex, ey, dir) || this.dist(di, y, ex, ey) === 1) n++;
      }
    }
    if (!n) dis |= 2;
    let alive = 0, vis = 0;
    for (let si = this.u16(cur + 8); si; si = this.u16(si + 8)) {
      if (!this.alive(si) || (this.u8(si + 0x0c) & 0x40)) continue;
      const [x, yy] = this.pos(si);
      if (this.inView(x, yy)) vis++;
      alive++;
    }
    if (!alive) dis |= 8;
    if (!vis) dis |= 0x10;
    if (!this.sea.commandsObj().itemList()) dis |= 0x40;               // 0fea:32a6
    if (!this.edgeSea(di, y)) dis |= 0x80;                              // 9afb
    this.c.menu.disabled = dis;
  }
  // d62e 对方的第一方: 方为偶数 → 97e8 (方 1), 奇数 → 97e0 (方 0); 再 +0x10 是其援军
  enemySide(B) { return 0x97e8 - ((this.side(B) & 1) << 3); }
  // d52c 活着: 船位 +0 (水手) ≠ 0、+2 (耐久) ≠ 0、未沉
  alive(B) { const S = shipSlotByAddr(this.m, this.u16(B + 2)); return S.crew !== 0 && S.durability !== 0 && !(this.u8(B + 0x0c) & 0x40); }
  // d931 射程内: 没有砲 (+0e = 0) → 否; 否则 d808(射程 = +15)
  inRange(B, x, y, tx, ty, dir) { return this.u16(B + 0x0e) ? this.arc(x, y, this.u8(B + 0x15), tx, ty, dir) : 0; }
  // d808 射界: 六角格距离 ≤ 射程且 ≠ 1, 并依方向 % 3 判断目标在船的侧面
  arc(x, y, range, tx, ty, dir) {
    const ay = btImod(x, 2) + y * 2, by = btImod(tx, 2) + ty * 2;
    const dx = tx > x ? tx - x : x - tx;
    const dy = by > ay ? by - ay : ay - by;
    const d = dy < dx ? dx : (((dy + dx) - ((dy + dx) < 0 ? -1 : 0)) >> 1);
    if (d > btS16(range) || d === 1) return 0;
    switch (dir % 3) {
      case 0: return dy <= dx ? 1 : 0;
      case 1: if (dy < dx) return 0; if (x >= tx && by <= ay) return 1; if (tx < x || by < ay) return 0; return 1;
      case 2: if (dy < dx) return 0; if (x >= tx && by >= ay) return 1; if (tx < x || by > ay) return 0; return 1;
    }
    return 0;
  }
  // d54a 六角格距离
  dist(x, y, tx, ty) {
    const ay = btImod(x, 2) + y * 2, by = btImod(tx, 2) + ty * 2;
    const dx = tx > x ? tx - x : x - tx;
    const dy = ay >= by ? ay - by : by - ay;
    let a = dy < dx ? dx : dy;
    a += dx;
    return (a - (a < 0 ? -1 : 0)) >> 1;
  }
  // 9afb 在地图边缘 (栏 0 / 0x33、列 0 / 0x2f) 的海格
  edgeSea(x, y) {
    if (x && y && x !== 0x33 && y !== 0x2f) return 0;
    return this.u8(this.mapAt(x, y)) & 0x80 ? 0 : 1;
  }
  // a35e 结束判定: 方 0 / 方 1 的旗舰不活着 → [9bfb] = 4 (主角那方被打败则 5); 旗舰沉没 (+0c bit6) 时再 −2
  endCheck() {
    if (this.u8(0x9bfb)) return 0;
    let E = 0x97e0;
    if (this.alive(this.u16(E))) {
      E = 0x97e8;
      if (this.alive(this.u16(E))) return 1;
      this.set8(0x9bfb, this.u16(E + 4) === this.heroFleet ? 5 : 4);
    } else this.set8(0x9bfb, this.u16(E + 4) === this.heroFleet ? 5 : 4);
    if (this.u8(this.u16(E) + 0x0c) & 0x40) this.set8(0x9bfb, this.u8(0x9bfb) - 2);
    return 0;
  }

  // ================= 10bdf 战后处理 =================
  // 10bdf(AX = fcf9 的返回值 si, DL = 对方指挥者) (RE_NOTES 30.12)
  async after(si, other) {
    const m = this.m, ws = getWorkState(m), b = this.sea.b;
    let E = 0x97e0, k = 0;
    for (; k < 4; k++, E += 8) if (this.u16(E + 4) === this.heroFleet) break;
    if (k < 4) for (let B = this.u16(E); B; B = this.u16(B + 8)) m.crewSlot(this.heroSlotIndex(B)).ammo = this.u16(B + 0x0e);   // eb9e → 船员配置 +6 = 剩余砲弹
    const r = this.u8(0x9bfb);
    if (r !== 5 && r !== 7) {
      for (let i = 0; i < 10; i++) {
        const M = m.crewSlot(i);
        if (M.captain >= 0x78) continue;
        if ((heroShipSlot(m, i).flags & 0x30) !== 0x10) { b.removeShip(i); continue; }          // 5deb (被击沉的船)
        if (!(r & 1)) this.gainExp(m.person(M.captain).addr, btIdiv(btS16(si), 5) & 0xffff);  // e616(船长, si / 5)
      }
    }
    await this.result(other);                                           // 10679
    if (this.c.palette.ending) return;                                  // [03ea] ≠ 0: 主角战败
    await this.repute();                                                // 10984
    const f = m.person(other).fleet;
    for (let k = 0; k < 4; k++) {
      const E = 0x97e0 + 8 * k, B = this.u16(E);
      this.set16(0x9bc2, B);
      if (!B) continue;
      const F = fleetByAddr(m, this.u16(E + 4));
      this.sea.ai.strength(F.addr);                                     // 18299
      if (F.addr === this.heroFleet) continue;
      const S = shipSlotByAddr(m, this.u16(B + 2));
      if ((S.flags & 0x30) === 0x10 && (personByAddr(m, this.u16(B)).face & 0x20) && S.crew && S.durability && this.u8(0x9bfb) !== 6) continue;
      this.dissolve(F.admiral);                                         // ff62
    }
    if (!this.c.noEvents) {                                             // 2e09:5525(0xa2, [0de0]) 共用 / 2e09:5678(0xa2, [0d56]) 主角
      const sc = (this.c.events ??= new Scenario(this.c)); sc.scene = this.sea;
      if (await sc.check(ENV_COMMON, 0xa2, ws.commonBattleTarget & 0xff)) await sc.run(ENV_COMMON);
      if (await sc.check(ENV_HERO, 0xa2, ws.heroBattleTarget & 0xff)) await sc.run(ENV_HERO);
    }
    if (ws.commonEvent || ws.heroEvent) return;
    const r2 = this.u8(0x9bfb);
    if (r2 !== 2 && r2 !== 4 && r2 !== 6) return;
    const s1 = r2 !== 2, h = f % 10;
    await this.talkWin(1, m.person(other));                             // 10642(1): 剧本窗口 1 + 对方头像
    this.c.message(Math.floor(f / 10) === 6 ? (s1 ? 0x33e : 0x342) : h && h < 5 ? (s1 ? 0x340 : 0x344) : (s1 ? 0x33f : 0x343));
    await this.c.menu.waitPrompt();                                     // 147ab
    await this.closeAllWin();                                           // 2e09:3d2b
  }
  // 国名 DS:08de (7 项)
  get nations() {
    return (this.sea.nationNames ??= this.sea.P.data.nations.map(h => { const v = btHex(h), o = new Uint8Array(v.length + 1); o.set(v); return o; }));
  }
  async scWin(n) { const sc = (this.c.events ??= new Scenario(this.c)); await sc.init(); await sc.op_win_open({ win: n }); return sc; }   // 2e09:3c76
  // 10679 结果消息 (跳跃表 106c0 以 [9bfb] 分支)
  async result(other) {
    const m = this.m, { message, menu, bgm, graph, win, rt, palette } = this.c, b = this.sea.b, H = m.heroPerson();
    const r = this.u8(0x9bfb);
    if (r === 8) return;
    let si = 3, loot = 0;
    const P = m.person(other), f = P.fleet, F = m.fleet(f);
    const say = async (n, ...a) => { message(n, ...a); await menu.waitPrompt(); await b.closeTalk(); };   // 消息 → 147ab → 796d
    const sayCard = async (picId, title, n, ...a) => {
      if (this.c.scr._battleHudActive && hasDom() && this.c.codec) {
        const txt = toSimp(captureConsoleText(this.c, () => message(n, ...a)));
        await runDomStoryCard(this.c.art, picId, txt, title);
        return;
      }
      if (picId !== null) graph.draw(picId, 0x78, 0x20);
      win.shadowedSaved(7, 0xb0, 0x26, 0x90, 0);
      await say(n, ...a);
    };
    const Y = (rt.year & 0xff) + 0x5dd, Mo = (rt.month & 0xff) + 1, D = (rt.day & 0xff) + 1;
    switch (r) {
      case 0: case 2: case 4: case 6: {
        appendTradeLog(m, rt, 2, f, 0, 0, 0);                           // 1e285 交易记录 种类 2 (海战)
        loot = r !== 2 ? 1 : 0;
        if (loot) {
          bgm.playSong(0x15);                                           // 9670(0x15) + 96eb(0): 胜利短曲只播一次
          await sayCard(0x35, "海战胜利", 0x341, H.givenNameBytes, H.familyNameBytes, this.nations[Math.floor(f / 10)], Y, Mo, D);
          bgm.playSong(0x11);
          si = 3;
        } else { await sayCard(0x36, "战斗结束", 0x235); si = 1; }
        if ((H.face & 0x0f) === 6) si *= 3;
        else { const c = this.classify(); if (c === 2) si <<= 1; else if (c === 3) si *= 3; else if (c === 4) si <<= 2; }
        const A = m.heroInfo(), lv = P.battleLevel;
        const v = ((((btUmin(lv, 0x1e) * btUmin(lv, 0x0f)) & 0xffff) * si) + 0xc8) & 0xffff;
        A.pirateFame = btUmin(0xc350, (A.pirateFame + v) & 0xffff);
        break;
      }
      case 1:
        appendTradeLog(m, rt, 2, f, 0, 0, 1); await sayCard(0x37, "日落休战", 0x233);
        break;
      case 3: case 9:
        if (r === 9 && !(F.flags & 0x40) && F.mission !== 7) this.sea.ai.goPort(0, F.homePort, F.addr);   // 2e09:5891 回母港
        appendTradeLog(m, rt, 2, f, 0, 0, 2); await sayCard(0x36, r === 3 ? "撤离战场" : "向敌投降", r === 3 ? 0x234 : 0x236);
        for (let i = 0; i < 10; i++) {
          if ((heroShipSlot(m, i).flags & 0x30) !== 0x10) continue;
          const C = m.person(m.crewSlot(i).captain);
          if (C.addr === H.addr || C.loyalty >= 0x28) continue;
          b.crewSpeaks(); await say(0x317, C.familyNameBytes);          // 909b
          this.leave(i);                                                // eb3f
        }
        break;
      case 5: case 7:
        bgm.playSong(0x14);
        await sayCard(0x38, "海战战败", 0x3f9, Y, Mo, D, H.givenNameBytes, H.familyNameBytes, H.givenNameBytes, H.familyNameBytes);
        await this.fadeOutField();                                      // bd26
        palette.ending = 0x1a;                                          // [03ea] = 0x1a → 1764f (clock.js ending)
        break;
    }
    if (loot) await this.loot();                                        // 10513
  }
  // fea0 战斗的分类: 主角有本国的私掠许可证 (随身物 = 国籍 + 0x1d) 时 1..6, 否则 0
  classify() {
    const m = this.m, hn = m.heroPerson().face & 0x0f, hero = m.globals.hero;
    let r = 0;
    for (let i = 0; i < 0x14; i++) if (((hn - m.inventory(i)) & 0xff) === 0xe3) r = 1;
    const on = Math.floor(m.person(this.u8(0x97e6) === hero ? this.u8(0x97ee) : this.u8(0x97e6)).fleet / 10);
    const NH = m.country(hn), NO = m.country(on);
    if (r) {
      if (NH.getRelations(on) <= 0x28) r = 2;
      if (NO.getTreaties(hn) & 0x10) r = 3;
      if (getCountryExtra(NH).rival === on) r = 4;
      if (NH.getRelations(on) >= 0x3c) r = 5;
      if (NH.getTreaties(on) & 0x20) r = 6;
    }
    return r;
  }
  // 10513 战利品: 金额 (舰队 +24 + 1) × 100、对方舰队 +1d 的道具 → 10138
  async loot() {
    const m = this.m, { message, menu, win } = this.c, b = this.sea.b;
    let E = 0;
    if (this.u16(0x97e4) === this.heroFleet) E = 0x97e8;
    if (this.u16(0x97ec) === this.heroFleet) E = 0x97e0;
    if (!E) return;
    let item = 0xff;
    const F = fleetByAddr(m, this.u16(E + 4));
    if (!(this.u8(this.u16(E) + 0x0d) & 0x80)) {
      const L = []; for (let i = 0; i < 0x14; i++) if (m.inventory(i) !== 0xff) L.push(m.inventory(i));
      b.setPersons(L);                                                  // 13146 → [0538]
      if (L.length < 0x14) item = getFleetOfficer(F, 0);
    }
    const money = (((F.funds + 1) & 0xffff) * 100) >>> 0;
    if (this.c.scr.wideRenderer) b.beginWideTalk(null);
    else win.shadowedSaved(0x14, 0x80, 0x1e, 0x60, 0);                       // 7849
    message(0x230, money);
    if (item !== 0xff) {
      message(0x231, m.item(item).nameBytes);                           // 5cde
      for (let i = 0; i < 0x14; i++) if (m.inventory(i) === 0xff) { m.setInventory(i, item); break; }
    }
    message(0x232);
    b.money = (b.money + money) | 0;
    await menu.waitPrompt(); await b.closeTalk();
    await this.capture(E);                                              // 10138
  }
  // 10138 剩余货物与掳获 (E = 对方那一方)
  async capture(E) {
    const m = this.m, { message, menu, palette, scr, win } = this.c, b = this.sea.b;
    const list = new Array(10).fill(0); let n = 0, t = 0;
    for (let B = this.u16(E); B; B = this.u16(B + 8)) {
      if (!shipSlotByAddr(m, this.u16(B + 2)).durability) continue;     // 耐久 0 (击沉)
      const [x, y] = this.pos(B);
      if (this.inView(x, y)) list[n++] = B;                             // be86
      t++;
    }
    if (!n) return;
    let cap = 0; for (let i = 0; i < n; i++) cap = (cap + m.ship(shipSlotByAddr(m, this.u16(list[i] + 2)).ship).maxCargo) & 0xffff;
    const f = m.person(this.u8(E + 6)).fleet, F = fleetByAddr(m, this.u16(E + 4));
    const g16 = () => btS16(F.cargoAmt);
    if (F.cargoGood !== 0xff) F.cargoAmt = btSdiv32(Math.imul(g16(), n), t) & 0xffff;   // 3722
    else if (this.rnd(2) && f % 10 && f % 10 < 5) {
      F.cargoAmt = cap;
      if (this.rnd(10)) F.cargoGood = this.rnd(6) + 10;
      else { F.cargoGood = this.rnd(7) + 0x1a; F.cargoAmt = btIdiv(g16(), 4) & 0xffff; }
      F.cargoAmt = btIdiv(g16(), 5) & 0xffff;
    } else F.cargoAmt = 0;
    const g = btIdiv(g16(), n) & 0xffff;
    const types = [0x80, 0x81, 0x82, 0x83, F.cargoGood, 0xff, 0xff, 0xff, 0xff], amt = new Array(9).fill(0);
    for (let i = 0; i < n; i++) {
      const B = list[i], sh = this.u16(B + 0x0e);
      const d = (m.ship(shipSlotByAddr(m, this.u16(B + 2)).ship).maxCargo - sh - g) & 0xffff;
      const pct = k => Math.floor(((k * d) & 0xffff) / 100);           // mul 后 sub dx,dx: 只取低 16 比特
      amt[0] = (amt[0] + pct(this.rnd(5) + 0x1e)) & 0xffff;
      amt[1] = (amt[1] + pct(this.rnd(5) + 0x1e)) & 0xffff;
      amt[2] = (amt[2] + pct(this.rnd(2) + 2)) & 0xffff;
      amt[3] = (amt[3] + sh) & 0xffff;
      amt[4] = (amt[4] + g) & 0xffff;
    }
    let has = 0; for (let k = 0; k < 9; k++) { if (!amt[k]) types[k] = 0xff; else has = 1; }
    const fs = b.fleetShips();                                          // 12c8a
    let left = btUmin(0x0a - fs, btUmin(b.crewList(), n)) & 0xff;      // 12de3
    const slots = new Array(10).fill(0), P = this.c.persons;
    while (left) {
      if (scr.wideRenderer) b.beginWideTalk(null);
      else await this.scWin(0);
      message(0x22e, n, left);
      b.crewList(); const capt = P[0] & 0xff;                           // 12de3: 第一位人选
      let j = 0;
      for (let i = 0; i < n; i++) {
        if (!list[i]) continue;
        const B = list[i]; list[i] = 0; list[j] = B; slots[j] = this.u16(B + 2); P[j] = shipSlotByAddr(m, slots[j]).ship; j++;
      }
      let sel, ok = 1;
      for (;;) {
        sel = await b.listSel().select(0x0e, j);                        // 15a70 清单种类 0x0e (船记录名)
        await b.closeTalk();                                            // 796d
        if (sel === -1) { ok = 0; break; }
        const ship = P[sel] & 0xff;
        if (scr._battleHudActive && hasDom()) {
          await runDomBattleShipModal(this, slots[sel], "俘获舰船");
          const yes = await menu.yesNo();
          if (yes) break;
          continue;
        }
        if (!palette.invert) palette.stopCycle();                       // 1743
        palette.setTarget(palette.table("ships")); await palette.fadeToTarget();   // 98fe(a730), 99e8
        win.save(0x0c, 0x80, 0x30, 0xb0);                               // 50c4
        scr.fillCols(0x0c, 0x80, 0x30, 0xb0, 8); scr.fillCols(0x0d, 0x88, 0x2e, 0xa0, 0x0f);   // 0906
        b.shipData(ship, 3, slots[sel]);                                // 1fd9:b1a0 = 2af30 (模式 3, 船位地址)
        const yes = await menu.yesNo();                                 // 1469c
        await b.closeTalk();                                            // 796d
        await this.fadeIn();                                            // bcfa
        if (yes) break;
      }
      if (ok) { await this.captureShip(slots[sel], capt); list[sel] = 0; left = (left - 1) & 0xff; continue; }   // ffc1
      if (scr.wideRenderer) b.beginWideTalk(null);
      else await this.scWin(0);
      message(0x22f);
      const stopCap = await menu.yesNo();
      if (scr.wideRenderer) await b.closeTalk();
      if (stopCap) break;
    }
    await this.closeAllWin();                                           // 2e09:3d2b
    if (has) { b.fleetTable(); await b.distribute(types, amt); }        // 1e628 / 1fcf7
  }
  // ffc1 掳获 S (对方船位) → 主角舰队第一个空船位 / 第一个空船记录; 新船长 capt
  async captureShip(sAddr, capt) {
    const m = this.m, b = this.sea.b, S = shipSlotByAddr(m, sAddr), R = m.ship(S.ship);
    let i = 0; for (; i < 10; i++) { const v = heroShipSlot(m, i).flags & 0x30; if (v !== 0x10 && v !== 0x20) break; }
    const D = i < 10 ? heroShipSlot(m, i) : m.dockSlot(i - 10), M = i < 10 ? m.crewSlot(i) : null;
    let n = 0;
    for (let k = 0; k < 0x28; k++) if (m.ship(k).type === 0xff) { n = k; break; }
    const N = m.ship(n);
    D.maxDurability = S.maxDurability; D.durability = S.durability; D.turn = S.turn; D.propulsion = S.propulsion; D.guns = S.guns;
    D.crew = btUmin(btIdiv(btS16(S.crew), 10) & 0xffff, R.maxCrew);
    D.ship = n; D.flags = S.flags;
    N.maxGuns = R.maxGuns; N.type = R.type; N.flags = R.flags;
    N.maxCrew = R.maxCrew; N.maxCargo = R.maxCargo;
    if (M) {
      M.water = 0; M.food = 0; M.material = 0; M.ammo = 0;
      M.navRatio = 0x19; M.lookRatio = 0x32; M.captain = capt; M.morale = 0x3c;
      M.loadTotal = 0;
      for (let k = 0; k < 5; k++) { M.setCargoGoods(k, 0xff); M.setCargoAmts(k, 0); }
    }
    m.person(capt).role = 2;
    await this.scWin(0); this.c.message(0x22d);
    const ni = b.nameInput();
    for (;;) { ni.prompt(2, 7); if ((await ni.run(N.addr, 7)) === 1) break; await b.closeTalk(); }   // 2e09:29a0 / 26a5
    await b.closeTalk();
  }
  // 10984 声望 ([9bfb] 为奇数时不做)
  async repute() {
    const m = this.m, { message, menu, win } = this.c, b = this.sea.b;
    if (this.u8(0x9bfb) & 1) return;
    const hero = m.globals.hero, H = m.heroPerson();
    const O = m.person(this.u8(0x97e6) === hero ? this.u8(0x97ee) : this.u8(0x97e6));
    const hn = H.face & 0x0f, on = Math.floor(O.fleet / 10);
    const NH = m.country(hn), NO = m.country(on);
    const x = btUmin(this.rnd(5) + 3, NH.getRelations(on));
    NH.setRelations(on, NH.getRelations(on) - x);
    NO.setRelations(hn, NH.getRelations(on));
    const D = m.heroInfo();                                             // 5be8: +6.. 各国声望
    let s, w;
    switch (this.classify()) {
      case 2: s = 2; w = 0x0a; break;
      case 3: s = 3; w = 6; break;
      case 4: s = 4; w = 3; break;
      case 5: s = -1; w = 0x5a; break;
      case 6: s = -1; w = 0x3c; break;
      default: s = 1; w = 0x1e;
    }
    if (on !== 6) {
      const v = Math.floor((((this.rnd(5) + 0x0a) * w) & 0xffff) / 0x1e);
      D.setCountryStanding(on, D.getCountryStanding(on) - btUmin(v, D.getCountryStanding(on)));
    }
    if (hn === 6) return;
    if (on !== hn) {
      if (s >= 0) D.setCountryStanding(hn, btUmin(0xc8, ((((this.rnd(5) + 5) * s) & 0xffff) + D.getCountryStanding(hn)) & 0xffff));
      else { const v = ((this.rnd(5) + 5) * -s) & 0xffff; D.setCountryStanding(hn, D.getCountryStanding(hn) - btUmin(v, D.getCountryStanding(hn))); }
      return;
    }
    D.setCountryStanding(hn, D.getCountryStanding(hn) - btUmin(this.rnd(5) + 0x0a, D.getCountryStanding(hn)));
    if (D.getCountryStanding(hn) <= 0x28) {
      if (this.c.scr.wideRenderer) b.beginWideTalk(null); else win.shadowedSaved(0x14, 0x80, 0x1e, 0x60, 0);
      message(0x238); await menu.waitPrompt(); await b.closeTalk();
      D.rank = 0; H.face = (H.face & 0xf0) | 6;                         // 变成海盗
    } else if (D.rank && D.getCountryStanding(hn) <= 0x46) {
      if (this.c.scr.wideRenderer) b.beginWideTalk(null); else win.shadowedSaved(0x14, 0x80, 0x1e, 0x60, 0);
      message(0x239); await menu.waitPrompt(); await b.closeTalk();
      D.rank = 0;
    } else return;
    m.globals.commonSec = 0; m.globals.commonChap = 0; getWorkState(m).flags &= 0xf8;
  }
  // ff62 解散指挥者 p 的舰队
  dissolve(p) {
    const m = this.m, P = m.person(p), F = m.fleet(P.fleet);
    F.strength = 0; F.flags &= 0xfe; F.admiral = 0xff;
    P.role = 0; P.fleet = 0xff; P.stayPort = this.rnd(0x2a);
    if (P.portrait & 0xc000) P.face &= 0xdf;                            // 注: 原版 [P+1b] & 0xc0 等价 portrait >> 8 & 0xc0
    for (let i = 0; i < 10; i++) fleetShipSlot(F, i).flags = 0;
  }
  // bd26: [03ea] = 0 且未反色 → 停止调色盘循环 (1743); 淡出 (99f2)
  async fadeOutField() {
    const { palette } = this.c;
    if (!palette.ending && !palette.invert) palette.stopCycle();
    await palette.fadeBlack();
  }
  // ff5c = 84de: 把 DS:09e4 的文件第 0xb 项重新解压到 [03ee] (被 HDAT.PUT 盖掉的缓冲; 移植版各资源各自保存, 不需要)
  // 19ba1: 主角舰队在的船各调用一次 5d8b (只计算, 不写回) → 0000:851f 回到海上画面
  async backToSea() {
    this.sea.b.endWideTalk();
    if (this._origBattlePutc) {
      this.c.con.putc = this._origBattlePutc;
      this._origBattlePutc = null;
    }
    this.c.scr._battleHudActive = false;
    this.c.scr._battleMsg = null;
    this.c.sys._battleViewport = null;
    hideDomBattleHud();
    await this.fadeOutField();                                          // bd26
    if (this.c.palette.ending) return;
    await this.sea.enterSea();
  }
}
