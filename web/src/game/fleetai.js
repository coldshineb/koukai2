// game/fleetai.js — 其他舰队 AI (MAIN.EXE: 每天一支 0fea 段 1ac19、海上每个时刻 1afe8、区域改变 seg0:6aae、任务 2e09 段 3407f / 33921 / 339e9)
// 依 docs/RE_NOTES.md 第 29.4–29.8 节。路线 (241c2)、自动航行方向 (313b1)、中途点 (23a97)、舰队速度 (1acbf)、陆地 (3135c)、区域 (2317c) 沿用 scenes/sea.js 已移植的函数。
// 运行期变量 (DS, 不在存盘): [c2ea] 目前处理的舰队、[bdb8] 任务的国家 (只在 3407f 写入)、[bd7c] 任务中的舰队 → ctx.aiVars
// 尚未移植 (主控台警告): 海战本体 10f7e (第 30 节, 经 SeaScene.navalBattle 调用)

import { DS } from "../model/schema_views.ts";
import { FleetFlag, GameConst, ShipSlotFlag } from "../model/flags.ts";
import {
  fleetByAddr,
  fleetShipSlot,
  getCountryExtra,
  getCountryMonthlyExtra,
  getFleetOfficer,
  getPersonByte,
  getSeaEnv,
  setFleetOfficer,
  shipSlotByAddr,
} from "../model/world_helpers.ts";
const faS16 = v => (v << 16) >> 16, faS8 = v => (v << 24) >> 24, faU16 = v => v & 0xffff;
export const faUmin = (a, b) => (faU16(a) > faU16(b) ? faU16(b) : faU16(a));          // seg0:4d7c
export const faUmax = (a, b) => (faU16(a) < faU16(b) ? faU16(b) : faU16(a));          // seg0:4d87
export const faLdiv = (a, b) => ((b | 0) === 0 ? 0 : Math.trunc((a | 0) / (b | 0)) | 0);   // seg0:3722 _ldiv (向零取整)
export const faLmul = (a, b) => Math.imul(a | 0, b | 0);                       // seg0:37bc _lmul (低 32 比特)
const faIdiv = (a, b) => Math.trunc(faS16(a) / faS16(b));                          // cwd; idiv (16 比特)
const faImod = (a, b) => faS16(a) % b;                                           // idiv 的余数 (正负号同被除数)
const faSgn = v => (v < 0 ? -1 : v > 0 ? 1 : 0);                               // seg0:4dde
const faWarned = new Set();
const faTodo = n => { if (!faWarned.has(n)) { faWarned.add(n); console.warn("尚未移植: " + n); } };

export const faFleet = k => DS.TBL_FLEET + ((0x85 * (k & 0xff)) & 0xffff);     // seg0:5c28
export const faNation = n => DS.TBL_COUNTRY + ((n & 0xff) << 5);                   // seg0:5bde
export const faPort = n => DS.TBL_PORT + 0x16 * (n & 0xff);                     // seg0:5c9a
export const faEcon = n => DS.TBL_PORT_ECONOMY + 0x25 * (n & 0xff);                     // seg0:5caa
// 23d7b 的 12 个相对位置 (与 23e19 相同)
const faSpot12 = [0, -2, 0, 2, 2, 0, -2, 0, -1, -2, 1, -2, 2, -1, 2, 1, -1, 2, 1, 2, -2, -1, -2, 1];

export class FleetAI {
  constructor(sea) { this.sea = sea; }
  get c() { return this.sea.c; }
  get st() { return this.sea.st; }
  get m() { return this.sea.st.model; }
  get v() { return (this.c.aiVars ??= { c2ea: 0, bdb8: 0, bd7c: 0 }); }   // DS:c2ea / bdb8 / bd7c
  get T() { return this.c.portAssets.fleet.tab; }                          // assets/data/fleet.json (tools/extract_fleet.py)
  rnd(n) { n &= 0xffff; return n ? this.c.sys.rng.random(n) : 0; }        // seg0:4dc4: n = 0 时直接返回 0 (不取随机数)
  _fv(F) { return typeof F === "number" ? fleetByAddr(this.m, F) : F; }
  get hero() { return this.m.globals.hero; }
  get heroFleet() { return this.sea.fleet; }                               // [c2d4] (地址, 供 sea / battle 比较)
  get heroRank() { return this.m.heroInfo().rank; }
  present(S) { const sv = typeof S === "number" ? shipSlotByAddr(this.m, S) : S; return (sv.flags & ShipSlotFlag.STATE_MASK) === ShipSlotFlag.ACTIVE; }
  inRegion(F) { const fl = this._fv(F); return this.sea.inRegion(fl.x, fl.y); }
  inRegionMid(fl) { return this.sea.inRegion(fl.midX, fl.midY); }
  sameXY(a, b) { return a.x === b.x && a.y === b.y ? 1 : 0; }
  sameDest(fl) { return fl.destX === fl.x && fl.destY === fl.y ? 1 : 0; }
  land(x, y) { return this.sea.landAt(x, y); }                             // 2e09:32cc = 3135c
  goodsCat(g) { const L = this.T.goodsCat; for (let i = 0; i < 10; i++) if (L[i] > (g & 0xff)) return i; return 0; }   // 1fd9:468e = 2441e

  // 0fea:83f9 = 18299 战力: +28 = (Σ 在的船 +2 + 4) / 5; 总和 0 → +29 &= FE
  strength(F) {
    const fl = this._fv(F); let s = 0;
    for (let i = 0; i < GameConst.FLEET_SHIPS; i++) { const sv = fleetShipSlot(fl, i); if ((sv.flags & ShipSlotFlag.STATE_MASK) === ShipSlotFlag.ACTIVE) s += sv.durability; }
    fl.strength = faIdiv(s + 4, 5) & 0xff;
    if (!s) fl.flags = fl.flags & ~FleetFlag.AT_SEA;
  }
  // 1a75a 舰队解散: 提督离开 (具名人物 9/10 概率到港 random(42), 其他记录释放)
  release(fl) {
    fl.flags = fl.flags & ~FleetFlag.AT_SEA;
    const pv = this.m.person(fl.admiral);
    pv.role = 0; pv.fleet = GameConst.EMPTY_SLOT;
    if (!(getPersonByte(pv, 0x1b) & 0xc0) && this.rnd(10)) pv.stayPort = this.rnd(0x2a);
    else { pv.stayPort = GameConst.EMPTY_SLOT; pv.face = pv.face & 0xdf; }
    fl.admiral = GameConst.EMPTY_SLOT;
  }
  // 3384e 同组在海上 (非 +29 bit4) 的舰队够多: 商船 (k%10 = 1..4) ≥ 2 支、0 / 5..6 组 (5, 6 号) ≥ 1、7..9 组 ≥ 1
  groupBusy() {
    const m = this.m, k = this.v.c2ea & 0xff, sub = k % 10, base = k - sub;
    const cnt = (a, b) => { let n = 0; for (let j = a; j < b; j++) if (!(m.fleet(base + j).flags & FleetFlag.IN_PORT)) n++; return n; };
    if (sub >= 1 && sub < 5) return cnt(1, 5) >= 2 ? 1 : 0;
    if (sub < 7) return cnt(5, 7) ? 1 : 0;
    return cnt(7, 10) ? 1 : 0;
  }
  idle(fl) { fl.mission = 0; fl.target = fl.homePort; fl.stayDays = 5; }   // 33962
  // 1fd9:3feb = 23d7b 舰队周围第 i 个位置在区域内且不是陆地 → 该位置
  seaSpot(i, fl) {
    const x = (fl.x + faSpot12[2 * i]) & 0xffff, y = (fl.y + faSpot12[2 * i + 1]) & 0xffff;
    return this.sea.inRegion(x, y) && !this.land(x, y) ? { x, y } : null;
  }
  // 在港且在区域内 → 位置换成附近的海面 (都不行返回 0)
  leavePort(fl) {
    if (!(fl.flags & FleetFlag.IN_PORT) || !this.sea.inRegion(fl.x, fl.y)) return 1;
    for (let i = 0; i < 12; i++) { const W = this.seaSpot(i, fl); if (W) { fl.x = W.x; fl.y = W.y; return 1; } }
    return 0;
  }
  // 2e09:5891 = 33921 去港 (a = 任务, FF = 不改)
  goPort(a, portId, F) {
    const fl = this._fv(F), port = this.m.port(portId);
    if (!(a & 0xffff)) { fl.destX = port.x; fl.destY = port.y; }
    if (!(fl.flags & FleetFlag.SCENARIO) && this.groupBusy() && (a & 0xffff)) return this.idle(fl);
    if (!this.leavePort(fl)) return this.idle(fl);
    if ((a & 0xff) !== GameConst.EMPTY_SLOT) fl.mission = a;
    fl.target = portId; fl.destX = port.x; fl.destY = port.y;
    fl.routeFlags = 0x4000; fl.flags = fl.flags & ~(FleetFlag.IN_PORT | FleetFlag.ARRIVED);
  }
  // 2e09:5959 = 339e9 追踪舰队 t
  chaseFleet(a, t, fl) {
    const targetFl = this.m.fleet(t);
    if (!(fl.flags & FleetFlag.SCENARIO) && this.groupBusy()) return this.idle(fl);
    if (!(targetFl.flags & FleetFlag.AT_SEA)) return this.goPort(0, fl.homePort, fl);
    if (!this.leavePort(fl)) return this.idle(fl);
    if ((a & 0xff) !== GameConst.EMPTY_SLOT) fl.mission = a;
    fl.target = targetFl.admiral; fl.destX = targetFl.x; fl.destY = targetFl.y;
    fl.routeFlags = 0x4000; fl.flags = fl.flags & ~(FleetFlag.IN_PORT | FleetFlag.ARRIVED);
  }
  // 33aaf 剧本 D1: 依任务恢复目的地
  resume(F) {
    const m = this.m, fl = this._fv(F), b = fl.mission;
    if (b <= 3 || b === 9) return this.goPort(GameConst.EMPTY_SLOT, fl.target, fl);
    if (b === 4) { if (this.heroRank) this.chaseFleet(GameConst.EMPTY_SLOT, m.heroPerson().fleet, fl); return; }
    this.chaseFleet(GameConst.EMPTY_SLOT, m.person(fl.target).fleet, fl);
  }
  // 对象人物的舰队位置 → 目的地 (+0c = 区域内 ? 0x6000 : 0x4000)
  followTarget(fl, clear) {
    const m = this.m, gFl = m.fleet(m.person(fl.target).fleet);
    fl.destX = gFl.x; fl.destY = gFl.y;
    fl.routeFlags = this.sea.inRegion(fl.x, fl.y) ? 0x6000 : 0x4000;
    if (clear) fl.flags = fl.flags & ~(FleetFlag.IN_PORT | FleetFlag.ARRIVED);
  }

  // ================= 任务 3407f (DS:b8ae) =================
  mission(fl) {
    const b = fl.mission;
    this.v.bd7c = fl.addr;
    if (b < 3 || b === 9) {
      this.v.bdb8 = Math.trunc((this.v.c2ea & 0xff) / 10);
      if (b === 0) this.m0(); else if (b === 1) this.m1(); else if (b === 2) this.m2();     // 3..10 = 空函数
    }
  }
  countdown() { const fl = fleetByAddr(this.m, this.v.bd7c); if (fl.stayDays) fl.stayDays = fl.stayDays - 1; return fl.stayDays; }   // 33c9d
  // 33cb4 任务 0 (母港): 卖货、补水手、补 +1d..+20、资金、下一个任务
  m0() {
    if (this.countdown()) return;
    const m = this.m, fl = fleetByAddr(m, this.v.bd7c);
    if (fl.cargoGood !== GameConst.EMPTY_SLOT) {
      const eco = m.portEconomy(fl.target), k = this.goodsCat(fl.cargoGood);
      for (let i = 0; i < 10; i++) { const d = this.rnd(3) + (k === i ? 2 : 0), p = eco.getPrices(i); eco.setPrices(i, p - faUmin(p, d)); }
    }
    for (let j = 0; j < GameConst.FLEET_SHIPS; j++) { const sv = fleetShipSlot(fl, j); sv.durability = sv.maxDurability; }
    for (let i = 0; i < 4; i++) {
      if (this.rnd((i + 1) * 2)) break;
      if (getFleetOfficer(fl, i) === GameConst.EMPTY_SLOT) setFleetOfficer(fl, i, this.rnd(20) + 0x32);
    }
    this.strength(fl);
    fl.funds = this.rnd(3) + faIdiv(m.country(this.v.bdb8).power, 10) + 1;
    fl.cargoGood = GameConst.EMPTY_SLOT; fl.cargoAmt = 0;
    fl.mission = this.nextMission();
    this.dispatch();
  }
  // 33c2d 在首都时依国家方针取新任务 (DS:b89c), 否则 0
  nextMission() {
    const m = this.m, ci = m.country(this.v.bdb8), fl = fleetByAddr(m, this.v.bd7c);
    if (fl.target !== ci.capitalPort) return 0;
    const sub = (this.v.c2ea & 0xff) % 10, sh = sub >= 1 && sub < 5 ? 8 : sub < 7 ? 4 : 0;
    return ((this.T.mission[getCountryMonthlyExtra(ci).policy] ?? 0) >> sh) & 0x0f;
  }
  // 33b0b 依任务设置目的地
  dispatch() {
    const m = this.m, ci = m.country(this.v.bdb8), ce = getCountryExtra(ci), cm = getCountryMonthlyExtra(ci), fl = fleetByAddr(m, this.v.bd7c);
    const t = ce.rival === 7 ? m.heroPerson().face & 0x0f : ce.rival;
    const chase = k => this.chaseFleet(GameConst.EMPTY_SLOT, k, fl);
    switch (fl.mission) {
      case 0: case 9: return this.goPort(GameConst.EMPTY_SLOT, fl.homePort, fl);
      case 1: case 2: return this.goPort(GameConst.EMPTY_SLOT, ce.keyPort, fl);
      case 4: return chase(m.heroPerson().fleet);
      case 5: case 6:
        switch (cm.policy) {
          case 3: case 7: return chase(m.heroPerson().fleet);
          case 4: case 8: return chase(this.heroRank > 2 ? this.rnd(5) + 10 * t : this.rnd(4) + 10 * t + 1);
          case 5: return chase(this.rnd(2) + 10 * t + 5);
          case 6: return chase(this.rnd(9) + 0x3d);
        }
        return;
      case 8: { const r = this.rnd(4); return chase(10 * this.v.bdb8 + r + 1); }
    }
  }
  // 33dbf 任务 1 投资 (不在首都、资金 ≥ 2)
  m1() {
    if (this.countdown()) return;
    const m = this.m, bd = this.v.bdb8, ci = m.country(bd), fl = fleetByAddr(m, this.v.bd7c), eco = m.portEconomy(fl.target);
    if (fl.funds >= 2 && fl.target !== ci.capitalPort) {
      const addCom = () => { const v = (fl.funds >>> 1) * 100 + eco.commerceInvest; eco.commerceInvest = v > GameConst.MAX_INVEST ? GameConst.MAX_INVEST : v; };
      const addInd = () => { const v = (fl.funds >>> 1) * 100 + eco.industryInvest; eco.industryInvest = v > GameConst.MAX_INVEST ? GameConst.MAX_INVEST : v; };
      if (eco.industry > eco.commerce) { if (eco.commerceInvest !== GameConst.MAX_INVEST) addCom(); else if (eco.industryInvest !== GameConst.MAX_INVEST) addInd(); }
      else if (eco.industryInvest !== GameConst.MAX_INVEST) addInd(); else if (eco.commerceInvest !== GameConst.MAX_INVEST) addCom();
      fl.funds = fl.funds - (fl.funds >>> 1);
      let s = 0; for (let n = 0; n < 6; n++) if (n !== bd && eco.getInfluence(n)) s += eco.getInfluence(n);
      const own = eco.getInfluence(bd), v = faUmin(Math.trunc(((6 * fl.funds) & 0xffff) / 10), 100 - own);
      eco.setInfluence(bd, own + v);
      let si = faUmin(v, s);
      while (si) for (let n = 0; n < 6 && si; n++) if (n !== bd && eco.getInfluence(n)) { eco.setInfluence(n, eco.getInfluence(n) - 1); si--; }
    }
    fl.mission = 0; this.dispatch();
  }
  // 33f48 任务 2 买货 (不在首都)
  m2() {
    if (this.countdown()) return;
    const m = this.m, ci = m.country(this.v.bdb8), fl = fleetByAddr(m, this.v.bd7c), eco = m.portEconomy(fl.target);
    if (fl.target !== ci.capitalPort) {
      const g = this.rnd(16) + 10, k = this.goodsCat(g);
      const base = faS16(m.regionPrice(eco.priceRegion).getSellBase(g));
      const price = faLdiv(faLmul(base, eco.getPrices(k) + 50), 100), cap = 100 * fl.funds;
      if (cap >= price) {
        const q = faUmin(faLdiv(cap, price), 1000), p = eco.getPrices(k);
        eco.setPrices(k, p + faUmin(this.rnd(3) + 3, 100 - p));
        fl.funds = fl.funds + faLdiv(faLmul(q, price), -100);
        fl.cargoGood = g; fl.cargoAmt = q;
      }
    }
    fl.mission = 0; this.dispatch();
  }

  // ================= 每天一支 1ac19 =================
  // 1a6d8 任务 5..8 / 10: 对象的舰队位置 → 目的地 (不在区域内时 3/4 概率不更新); 对象不在 → 回母港
  retarget(fl) {
    const m = this.m, b = fl.mission;
    if (!((b >= 5 && b <= 8) || b === 10)) return;
    const cp = m.person(fl.target);
    if ((cp.face & 0x20) && cp.fleet !== GameConst.EMPTY_SLOT) {
      if (!this.sea.inRegion(fl.x, fl.y) && this.rnd(4)) return;
      this.followTarget(fl, false);
    } else this.goPort(0, fl.homePort, fl);
  }
  // 1a4a5 任务判断 (+29 bit6 时不做)
  decide(fl) {
    const m = this.m, k = this.v.c2ea & 0xff, nat = Math.trunc(k / 10), sub = k % 10;
    if (fl.flags & FleetFlag.SCENARIO) return;
    if (k > 60 || sub >= 5) {
      const pa = m.person(fl.admiral), b = fl.mission;
      if (b >= 4 && b <= 6) {                                                     // 1a550
        const gFl = m.fleet(m.person(fl.target).fleet);
        let home = gFl.stayDays !== 0;
        if (!home) { const bit = pa.flags & 0x20; home = this.rnd(sub <= 6 ? (bit ? 30 : 15) : (bit ? 60 : 30)) === 0; }
        if (home) this.goPort(0, fl.homePort, fl);
      } else if (b === 8 || b === 9) {                                            // 1a5cb
        if (this.c.rt.time % 12 === 0) for (let i = 0; i < 70; i++) {
          const gFl = m.fleet(i);
          if (!(gFl.flags & FleetFlag.AT_SEA) || gFl.addr === fl.addr || gFl.mission < 5 || gFl.mission >= 8) continue;
          if (Math.trunc(m.person(gFl.target).fleet / 10) !== nat) continue;
          if (this.rnd(pa.flags & 0x80 ? 2 : 1)) continue;
          this.chaseFleet(sub > 6 ? 6 : 5, i, fl);
        }
      }
    }
    // 1a502 海盗 (k > 60) 猎捕中、在区域内 → 改追随机一支商船 (或主角舰队)
    if (k > 60 && fl.mission === 4 && this.sea.inRegion(fl.x, fl.y) && this.rnd(m.person(fl.admiral).flags & 0x80 ? 3 : 2) === 0) {
      const L = (this.c.persons ??= []); let n = 0;
      for (let i = 0; i < 60; i++) {
        const gFl = m.fleet(i);
        if (gFl.admiral === this.hero && !this.heroRank) continue;
        const s = i % 10;
        if (!((s >= 1 && s < 5) || gFl.addr === this.heroFleet)) continue;
        if ((gFl.flags & FleetFlag.AT_SEA) && gFl.addr !== fl.addr) L[n++] = i; // DS:0538 (字)
      }
      this.chaseFleet(5, (L[this.rnd(n)] ?? 0) & 0xffff, fl);
    }
  }
  // 1aa79 同一个 24 格内的对象人物 (FF = 没有)
  cellTarget(fl) {
    const m = this.m, cell = (faIdiv(fl.x, 24) + Math.imul(faIdiv(fl.y, 24), 90)) & 0xffff, b = fl.mission;
    if (b < 4 || b > 7) return GameConst.EMPTY_SLOT;
    if (b === 4) {
      for (let i = 0; i < 60; i++) {
        const gFl = m.fleet(i);
        if (!(gFl.flags & FleetFlag.AT_SEA)) continue;
        if (((Math.imul(faIdiv(gFl.y, 24), 90) - cell) & 0xffff) !== (faIdiv(gFl.x, -24) & 0xffff)) continue;
        if (gFl.flags & (FleetFlag.IN_PORT | FleetFlag.SCENARIO)) continue;       // 原版的「k % 10 在 1..4」判断恒真
        if (fl.strength > gFl.strength) { fl.mission = 5; return gFl.admiral; }
      }
      return GameConst.EMPTY_SLOT;
    }
    const gFl = m.fleet(m.person(fl.target).fleet);
    if (!(gFl.flags & FleetFlag.AT_SEA)) { this.goPort(0, fl.homePort, fl); return GameConst.EMPTY_SLOT; }
    if (gFl.flags & (FleetFlag.IN_PORT | FleetFlag.SCENARIO)) return GameConst.EMPTY_SLOT;
    return ((faIdiv(gFl.x, 24) + Math.imul(faIdiv(gFl.y, 24), 90)) & 0xffff) === cell ? fl.target : GameConst.EMPTY_SLOT;
  }
  // 1ab8b 海上同一格的对象 (FF = 没有)
  contact(fl) {
    const m = this.m, b = fl.mission;
    if (b < 4 || b > 7) return GameConst.EMPTY_SLOT;
    if (b === 4) {
      const hFl = fleetByAddr(m, this.heroFleet);
      if (this.sameXY(hFl, fl)) { fl.mission = 5; return hFl.admiral; }
      return GameConst.EMPTY_SLOT;
    }
    const gFl = m.fleet(m.person(fl.target).fleet);
    if (!(gFl.flags & FleetFlag.AT_SEA)) { this.goPort(0, fl.homePort, fl); return GameConst.EMPTY_SLOT; }
    if (gFl.flags & (FleetFlag.IN_PORT | FleetFlag.SCENARIO)) return GameConst.EMPTY_SLOT;
    return this.sameXY(gFl, fl) ? fl.target : GameConst.EMPTY_SLOT;
  }
  // 1a7a8 交战 (只在时刻 0x12..0x35)
  async fight(di, fl) {
    const m = this.m, { sys } = this.c, pd = m.person(di), gFl = m.fleet(pd.fleet);
    let a = Math.trunc(fl.strength / 10);
    const b = Math.trunc(gFl.strength / 10), t = this.c.rt.time;
    if (t < 0x12 || t >= 0x36) return;
    const home = () => this.goPort(0, fl.homePort, fl);
    if (this.sea.inRegion(fl.x, fl.y)) {
      if (di === this.hero) {
        if (!(fl.flags & FleetFlag.SCENARIO) && !this.heroRank) return home();
        sys.mouseHide();
        if (this.sea.navalBattle) await this.sea.navalBattle(fl.admiral, di, GameConst.EMPTY_SLOT, GameConst.EMPTY_SLOT); else faTodo("海戰 (10f7e)");
        sys.mouseShow();
        if (!(fl.flags & FleetFlag.AT_SEA) || (fl.flags & FleetFlag.SCENARIO) || fl.mission === 7 || this.rnd(3)) return;
        return home();
      }
    } else {
      if (di === this.hero) return;
      if (this.rnd(150) < pd.getStats(1)) { if (fl.mission !== 7) home(); return; }
    }
    if (fl.mission !== 7) home();
    if ((gFl.flags & FleetFlag.SCENARIO) || !(gFl.flags & FleetFlag.AT_SEA) || (gFl.flags & FleetFlag.IN_PORT)) return;
    for (let j = 9; j >= 0; j--) {                                              // 攻方扣对象的水手 (由第 10 个船位往前)
      const sv = fleetShipSlot(gFl, j);
      if ((sv.flags & ShipSlotFlag.STATE_MASK) !== ShipSlotFlag.ACTIVE) continue;
      const s = sv.durability;
      if (s > a) { sv.durability = s - a; break; }
      a -= s; sv.flags = sv.flags & ~ShipSlotFlag.ACTIVE;
      const q = faIdiv(gFl.cargoAmt, 5); gFl.cargoAmt = gFl.cargoAmt - q;
      fl.cargoAmt = fl.cargoAmt + faUmin(1000 - fl.cargoAmt, q);
      fl.cargoGood = gFl.cargoGood;
      const q2 = Math.trunc(gFl.funds / 5); gFl.funds = gFl.funds - q2;
      fl.funds = fl.funds + faUmin(60000 - fl.funds, q2);
    }
    this.strength(gFl);
    if (!(gFl.flags & FleetFlag.AT_SEA)) { this.release(gFl); home(); }
    let c = b;
    for (let j = 9; j >= 0; j--) {                                              // 对象扣攻方
      const sv = fleetShipSlot(fl, j);
      if ((sv.flags & ShipSlotFlag.STATE_MASK) !== ShipSlotFlag.ACTIVE) continue;
      const s = sv.durability;
      if (s > c) { sv.durability = s - c; break; }
      c -= s; sv.flags = sv.flags & ~ShipSlotFlag.ACTIVE;
    }
    this.strength(fl);
    if (!(fl.flags & FleetFlag.AT_SEA)) this.release(fl);
    const bd = this.v.bdb8 & 0xff, tn = Math.trunc(pd.fleet / 10);              // 对象国籍 (提督已离开时 +2c = FF)
    let cbd = null;
    if (bd < 6) { cbd = m.country(bd); const d = this.rnd(2) + 2, r = cbd.getRelations(tn); cbd.setRelations(tn, r - faUmin(r, d)); }
    if (tn < 6) {
      const ct = m.country(tn);
      if (bd < 6) ct.setRelations(bd, cbd.getRelations(tn));
      else { const d = this.rnd(2) + 2, r = ct.getRelations(bd); ct.setRelations(bd, r - faUmin(r, d)); }
    }
  }
  // 0fea:a22a = 1a0ca 下一个点
  nextPoint(fl) {
    const sea = this.sea;
    if ((fl.routeFlags & 0x4000) && this.sameDest(fl) && !sea.route(fl.addr)) {
      if (!(fl.flags & FleetFlag.SCENARIO)) this.goPort(0, fl.homePort, fl);
      return { x: fl.x, y: fl.y };
    }
    if (fl.routeFlags & 0x8000) return { x: fl.midX, y: fl.midY };
    if (fl.routeFlags & 0x2000) return { x: fl.destX, y: fl.destY };
    const n = fl.getRoutePts(fl.routeFlags & 7);
    return { x: sea.nodeW(n, 0) & 0x7fff, y: sea.nodeW(n, 2) };
  }
  // 到了目的地: 任务 4 → random(10) = 0 时回母港; 5..8/10 → 换成对象位置; 其他 1a16d 进港
  atDest(fl, ai1ac19) {
    const b = fl.mission;
    if (b === 4) { if (ai1ac19 && !this.rnd(10)) this.goPort(0, fl.homePort, fl); return; }
    if ((b >= 5 && b <= 8) || b === 10) this.followTarget(fl, true);
    else this.arrive(fl);
  }
  // 1a1e0 一天跳到 T (T 在区域内时停在区域边上的海面入口)
  jump(T, fl) {
    const sea = this.sea, rg = sea.region & 0xffff;
    const left = faS16(Math.imul(((30 * (sea.item & 0xff)) & 0xffff) + rg % 30, 24)), top = faS16(Math.imul(Math.trunc(rg / 30), 24));
    const q = (a, b, c) => Math.trunc(faS16(Math.imul(faS16(a), faS16(b))) / faS16(c));     // imul 后 cwd: 只取乘积的低 16 比特
    const land = (x, y) => this.land(x & 0xffff, y & 0xffff), tx = faS16(T.x), ty = faS16(T.y);
    let si, y2;
    if (sea.inRegion(T.x, T.y)) {
      let di = faS16(fl.x); y2 = faS16(fl.y);
      if (Math.abs(faS16(fl.x - T.x)) >= 0x438) di = faS16(tx > di ? di + 0x870 : di - 0x870);
      if (left > di) {
        y2 = faS16(y2 + q(ty - y2, left - di, tx - di)); di = left;
        if (land(di, y2)) { y2 = top; while (faS16(top + 0x47) > y2 && land(di, y2)) y2 = faS16(y2 + 1); }
      } else if (!(faS16(left + 0x48) > di)) {
        y2 = faS16(y2 + q(ty - y2, left - di + 0x46, tx - di)); di = faS16(left + 0x46);
        if (land(di, y2)) { y2 = top; while (faS16(top + 0x47) > y2 && land(di, y2)) y2 = faS16(y2 + 1); }
      }
      if (y2 < top) {
        di = faS16(di + q(tx - di, top - y2, ty - y2)); y2 = top;
        if (!land(di, y2)) si = di;
        else { si = left; while (faS16(left + 0x47) > si && land(si, y2)) si = faS16(si + 1); }
      } else if (faS16(top + 0x48) > y2) si = di;
      else {
        di = faS16(di + q(tx - di, top - y2 + 0x46, ty - y2)); y2 = faS16(top + 0x46);
        if (!land(di, y2)) si = di;
        else { si = left; while (faS16(left + 0x47) > y2 && land(si, y2)) si = faS16(si + 1); }   // 原版这里比较的是 y, 不是 si
      }
    } else { si = tx; y2 = ty; }
    fl.x = faImod(si + 0x870, 0x870); fl.y = faImod(y2 + 0x438, 0x438);
    if (this.sameDest(fl)) this.atDest(fl, true);
    if (this.sea.inRegion(fl.x, fl.y)) sea.route(fl.addr);
  }
  // 1a16d 进港 / 到达
  arrive(fl) {
    const m = this.m, b = fl.mission;
    fl.flags = fl.flags | FleetFlag.IN_PORT | FleetFlag.ARRIVED;
    let pt = null;
    if (b <= 2 || b === 9) pt = m.port(fl.target);
    else if (b === 3) fl.flags = fl.flags & ~FleetFlag.IN_PORT;
    else if ((b >= 5 && b <= 8) || b === 10) pt = m.fleet(m.person(fl.target).fleet);
    if (pt) { fl.x = pt.x; fl.y = pt.y; }
    fl.stayDays = this.rnd(8) + 8;
    this.mission(fl);
  }
  // 1ac19 (调用前 [c2ea] = k)
  async daily(F) {
    const m = this.m, fl = this._fv(F);
    if (!(fl.flags & FleetFlag.AT_SEA)) return;
    if (m.globals.port === GameConst.EMPTY_SLOT && this.sea.inRegion(fl.x, fl.y)) { fl.routeFlags = fl.routeFlags | 0x8000; return; }
    if (fl.addr === this.heroFleet) return;
    this.retarget(fl);
    this.decide(fl);
    const di = this.cellTarget(fl);
    if (di !== GameConst.EMPTY_SLOT) { const tFl = m.fleet(m.person(di).fleet); if (!this.sea.inRegion(tFl.x, tFl.y)) await this.fight(di, fl); return; }
    if (fl.flags & FleetFlag.IN_PORT) { this.mission(fl); if (fl.flags & FleetFlag.IN_PORT) return; }
    if (this.sea.route(fl.addr)) this.jump(this.nextPoint(fl), fl);
  }

  // ================= 海上每个时刻 1afe8 =================
  // 1ae55 走一步 (没有海流): 挡住返回 1
  step(fl, dir, speed) {
    const sea = this.sea;
    const ex = faS8(sea.dsb(0x0718 + dir)), ey = faS8(sea.dsb(0x0720 + dir)), sp = faS8(speed);   // 路线失败时方向 = FF, 原版照样读 DS:0718 / 0720 表外
    const ax = (ex * sp) & 0xff, ay = (ey * sp) & 0xff;
    const nx = (ax + fl.subX) & 0xff, ny = (ay + fl.subY) & 0xff;
    let di = faImod(fl.x, 0x2d0), y2 = faS16(fl.y), b6 = 0, b7 = 0, out = 0;
    if (nx >= 0x3c) { if (faS8(ax) < 0) { di--; b6 = 0x3c; } else { di++; b6 = 0xc4; } }
    if (ny >= 0x3c) { if (faS8(ay) < 0) { y2--; b7 = 0x3c; } else { y2++; b7 = 0xc4; } }
    const bda6 = faS16(sea.bda6), bdaa = faS16(sea.bdaa);
    if (bda6 > di || !(faS16(bda6 + 0x48) > di)) { di = faS16(di + faSgn(faS8(ax))); y2 = faS16(fl.y); out = 1; }
    if (bdaa > y2 || !(faS16(bdaa + 0x48) > y2)) { di = faImod(fl.x, 0x2d0); y2 = faS16(y2 + faSgn(faS8(ay))); out = 1; }
    if (!out && this.land(di & 0xffff, y2 & 0xffff)) {
      if (this.land((fl.x + ex) & 0xffff, (fl.y + ey) & 0xffff)) return 1;
      fl.subX = nx; fl.subY = ny;
      if (b6) fl.subX = faS8(ax) > 0 ? 0x3b : 0;
      if (b7) fl.subY = faS8(ay) > 0 ? 0x3b : 0;
      return 0;
    }
    fl.x = faImod(di + faS16(Math.imul(sea.item & 0xff, 0x2d0)) + 0x870, 0x870);
    fl.y = faImod(y2 + 0x438, 0x438);
    fl.subX = nx + b6; fl.subY = ny + b7;
    return 0;
  }
  // 1afe8 每支舰队 (先查鼠标右键); 循环以全域 [c2ea] 判断结束 (舰队指针另外递增): 途中开战 → 回到海上 851f → 6aae 把 [c2ea] 设成 0x46 → 这一轮剩下的舰队不处理
  async seaTick() {
    const m = this.m, sea = this.sea, { sys, palette } = this.c;
    const { windDir: wDir, windStr: wStr, curDir: cDir, curStr: cStr } = getSeaEnv(m);
    let k = 0;
    for (this.v.c2ea = 0; !palette.ending && this.v.c2ea < 70; k++, this.v.c2ea = (this.v.c2ea + 1) & 0xff) {
      if (sys.mouseEvent() === 0x82) sea.a9c8 |= 1;
      const fl = m.fleet(k), F = fl.addr;
      if (F === this.heroFleet || !(fl.flags & FleetFlag.AT_SEA)) continue;
      if (this.c.noFleets) continue;                                          // 测试: 原版 1b048 改成不处理
      if (fl.flags & FleetFlag.IN_PORT) { if (this.c.rt.time === 0) this.mission(fl); if (fl.flags & FleetFlag.IN_PORT) continue; }
      if (this.land(fl.x, fl.y)) continue;
      if (m.globals.port !== GameConst.EMPTY_SLOT || !this.sea.inRegion(fl.x, fl.y)) { fl.routeFlags = fl.routeFlags & 0x7fff; continue; }
      const t = this.contact(fl);
      if (t !== GameConst.EMPTY_SLOT) { await this.fight(t, fl); continue; }
      if (this.sameDest(fl) && fl.mission !== 4) this.atDest(fl, false);
      let d = sea.autoSteer(F) & 0xff;                                        // 2e09:3321 = 313b1 (失败 = FF)
      if (d === 8) { fl.flags = fl.flags | FleetFlag.ARRIVED; continue; }
      fl.dir = d;
      const v = sea.fleetSpeed(F, wDir, wStr, cStr, cDir) & 0xff;            // 1acbf
      if (this.step(fl, d, v)) {
        d = (d + 1) & 7;
        if (this.step(fl, d, v)) { d = (d - 2) & 7; if (this.step(fl, d, v)) sea.pathStep(F, sea.pt(F + 0x08), 0); }   // 1fd9:44d8 = 24268
      }
    }
  }
  // 6aae 区域改变时: 区域内、出航中、非 bit5 的他舰队 — 在陆地上 → 1a0ca (结果不用); 中途点在区域内且是陆地 → 重新搜索路线
  regionChange() {
    const m = this.m;
    for (let k = 0; k < 70; k++) {
      this.v.c2ea = k;
      const fl = m.fleet(k);
      if (!(fl.flags & FleetFlag.AT_SEA) || !this.sea.inRegion(fl.x, fl.y) || (fl.flags & FleetFlag.ARRIVED) || fl.addr === this.heroFleet) continue;
      if (this.land(fl.x, fl.y)) this.nextPoint(fl);
      if (this.inRegionMid(fl) && this.land(fl.midX, fl.midY)) {
        fl.routeFlags = (fl.routeFlags & 0x100) | 0x4000;
      }
    }
    this.v.c2ea = 70;
  }
}
