// game/monthly.js — 月末 18ff5 / 年末 16126 (MAIN.EXE 0fea 段 178a8..18ff5、16126), 依 docs/RE_NOTES.md 第 29.2–29.3 节
// 港口与海上共用; 与舰队 AI (fleetai.js) 共用 18299 战力、33921 去港 与运行期变量 [c2ea]
import { faUmin, faUmax, faLdiv, faLmul } from "./fleetai.js";
import { FleetFlag, GameConst, ShipSlotFlag, TreatyFlag } from "../model/flags.ts";
import {
  fleetByAddr,
  fleetShipSlot,
  getCountryExtra,
  getCountryMonthlyExtra,
  getPartySalaryUnit,
  getPersonByte,
  setFleetOfficer,
  setHeroMoney,
  writePersonNamePart,
} from "../model/world_helpers.ts";

const moS16 = v => (v << 16) >> 16;
const moWarned = new Set();
const moTodo = n => { if (!moWarned.has(n)) { moWarned.add(n); console.warn("尚未移植: " + n); } };

export class Monthly {
  constructor(ai) { this.ai = ai; }
  get c() { return this.ai.c; }
  get m() { return this.ai.m; }
  get T() { return this.ai.T; }
  rnd(n) { return this.ai.rnd(n); }
  present(slot) { return this.ai.present(slot); }

  // 18ff5 月末
  async monthEnd() {
    if (this.c.palette.ending) return;                                           // [03ea] ≠ 0
    this.season();                                                               // 178a8
    this.interest();                                                             // 17929
    this.economy();                                                              // 179e8
    this.power(); this.enemies(); this.policy(); this.targets();                 // 18add: 17a80, 17fbc (17c19 / 17d82 / 17edb)
    this.diplomacy();                                                            //        181ed
    this.reinforce(0x182df); this.reinforce(0x183d3); this.reinforce(0x184c8); this.launch(); this.aid();   // 18ac8
    this.persons(); this.rivals(); this.upgrade(); await this.salary();          // 18fe4: 18aee, 18c58, 18cfb, 18e7f
    this.m.globals.day = 0;                                                      // 下个月从 1 号开始
  }
  // 16126 年末
  yearEnd() {
    const m = this.m, rt = this.c.rt;
    m.globals.month = 0;                                                         // [0caa] (存盘的年) 不更新
    rt.year = (rt.year + 1) & 0xff;
    if (rt.year > 0x34) this.c.palette.ending = 0x10;                            // 1552 年 → 游戏结束
    this.ai.sea.seaYear();                                                       // 71ad
    for (let p = 0; p < 120; p++) { const pv = m.person(p); pv.age = pv.age + 1; }
    for (let g = 0; g < 30; g++) { const bm = m.barmaid(g); bm.age = bm.age + 1; }
  }

  // 178a8 3 月底 / 9 月底换季: 重读风向表 (夏 / 冬), 随身物 0x23..0x28 消失
  season() {
    const md = this.m, m = this.c.rt.month;
    if (m % 6 !== 2) return;
    this.c.windOffset = m === 2 ? 0 : 0x1c2;
    for (let i = 0; i < GameConst.INV_SLOTS; i++) {
      const v = md.inventory(i);
      if (v >= 0x23 && v <= 0x28) md.setInventory(i, GameConst.EMPTY_SLOT);
    }
  }
  // 17929 银行利息 (存款 3%、借款 10%)
  interest() {
    const g = this.m.globals, q0 = moS16(g.bankQuotient), bal = (Math.imul(100, q0) + g.bankRem) | 0;
    let nb = (bal + faLdiv(faLmul(bal, q0 >= 0 ? 3 : 10), 100)) | 0;
    if (nb > 1000000) nb = 1000000; else if (nb < -1000000) nb = -1000000;
    const q = nb >= 0 ? faLdiv(nb, 100) : faLdiv(nb - 99, 100);
    g.bankQuotient = q & 0xffff; g.bankRem = ((q & 0xff) * 0x9c + (nb & 0xff)) & 0xff;
  }
  // 179e8 本月投资 → 商业 / 工业值, 物价指数向 50 回归
  economy() {
    const m = this.m;
    for (let p = 0; p < 100; p++) {
      const eco = m.portEconomy(p);
      eco.commerce = faUmin(1000, eco.commerce + Math.trunc(eco.commerceInvest / 300));
      eco.industry = faUmin(1000, eco.industry + Math.trunc(eco.industryInvest / 300));
      eco.industryInvest = 0; eco.commerceInvest = 0;
      for (let i = 0; i < 10; i++) { const r = this.rnd(5) + 1, v = eco.getPrices(i); eco.setPrices(i, v > 50 ? v - r : v + r); }
    }
  }
  // 17a80 国力 N +0
  power() {
    const m = this.m, A = new Uint16Array(64), B = new Uint16Array(64), D = this.T.powerDiv;
    for (let p = 0; p < 100; p++) {
      const port = m.port(p), eco = m.portEconomy(p), k = (((port.region & 7) << 3) + eco.regionGroup) & 63;
      A[k] += eco.industry;
      B[k] += Math.imul(port.region & 8 ? 2 : 1, eco.commerce);
    }
    let total = 0;
    for (let n = 0; n < 6; n++) {
      const a = k => A[n * 8 + k], b = k => Math.trunc(B[n * 8 + k] / D[k]);
      let v = b(0);
      for (let k = 4; k < 8; k++) { if (a(k) >= 300) v += b(k); else break; }
      for (let k = 1; k < 3; k++) if (a(k) >= 300) v += b(k);
      if ((a(2) >= 300 || a(4) >= 300) && a(3) >= 300) v += b(3);
      m.country(n).power = v & 0xffff; total += moS16(v);
    }
    m.country(6).power = faLdiv(total, 6) & 0xffff;
  }
  // 17c19 敌对国 N +2 (7 = 主角)
  enemies() {
    const m = this.m, hd = m.heroInfo();
    for (let i = 0; i < 6; i++) {
      const ci = m.country(i), ce = getCountryExtra(ci), cm = getCountryMonthlyExtra(ci);
      let best = 7, min = 0xffff;
      for (let j = 0; j < 7; j++) {
        if (j === i) continue;
        const v = faLdiv(faLmul(ci.getRelations(j), moS16(m.country(j).power)), 100) & 0xffff;
        if (v < min) { min = v; best = j; }
      }
      const cx = Math.abs(moS16(200 - hd.getCountryStanding(i)));
      const r = (this.rnd(180 - cm.aggressiveness) + 100) & 0xffff;
      ce.rival = r < cx ? 7 : best;
    }
    const c6 = m.country(6), ce6 = getCountryExtra(c6); let best = 0, max = 0;
    for (let d = 0; d < 6; d++) {
      const v = Math.imul((100 - c6.getRelations(d)) & 0xffff, m.country(d).power) & 0xffff;
      if (v > max) { max = v; best = d; }
    }
    const cx = Math.abs(moS16(200 - hd.getCountryStanding(6)));
    ce6.rival = this.rnd(50) + 100 < cx ? 7 : best;
  }
  // 17d82 方针 N +3
  policy() {
    const m = this.m, heroFace = m.heroPerson().face;
    for (let i = 0; i < 6; i++) {
      const ci = m.country(i), ce = getCountryExtra(ci), cm = getCountryMonthlyExtra(ci);
      let t = ce.rival;
      if (t >= 7) t = heroFace & 0x0f;
      const pt = moS16(m.country(t).power), pi = moS16(ci.power);
      if (this.rnd(pt >= pi ? 120 : 90) < cm.aggressiveness) cm.policy = pt > pi ? 4 : 5;
      else cm.policy = this.rnd(3);
    }
    const c6 = m.country(6);
    getCountryMonthlyExtra(c6).policy = getCountryExtra(c6).rival === 7 ? 7 : 8;
  }
  // 17edb 目标港 N +4
  targets() {
    const m = this.m, heroNat = () => m.heroPerson().face;
    const nat = port => port.region & 7, cap = n => m.country(n).capitalPort;
    const fns = [
      (i, p, port) => nat(port) === 6,                                             // 17e06 无所属
      (i, p, port, ci) => nat(port) === i && ci.capitalPort !== p,                 // 17e20 本国的非首都
      (i, p) => p >= 0x4b && p <= 0x5c,                                            // 17e46
      (i, p, port) => !((port.region ^ heroNat()) & 7) && cap(nat(port)) !== p,    // 17e5b 主角国籍的非首都
      (i, p, port, ci) => { const r = getCountryExtra(ci).rival, t = r === 7 ? heroNat() & 0x0f : r; return nat(port) === t && cap(nat(port)) !== p; },   // 17e94
    ];
    const FN = [fns[0], fns[1], fns[2], fns[3], fns[4], fns[4], fns[0]], NEXT = [1, 2, 2, 0, 0, 0, 1];
    for (let i = 0; i < 6; i++) {
      const ci = m.country(i), ce = getCountryExtra(ci), cm = getCountryMonthlyExtra(ci);
      let pick = GameConst.EMPTY_SLOT, found = 0, act = cm.policy, guard = 0;
      while (pick === GameConst.EMPTY_SLOT) {
        if (act > 6 || ++guard > 10000) { moTodo("17edb 找不到目標港 (原版無限迴圈)"); break; }
        for (let p = 0; pick === GameConst.EMPTY_SLOT && p < 100; p++) if (FN[act](i, p, m.port(p), ci)) { found = 1; if (this.rnd(5) === 0) pick = p; }
        if (!found) act = NEXT[act];
      }
      ce.keyPort = pick;
    }
  }
  // 181ed 外交 (6 × 6)
  diplomacy() {
    const m = this.m;
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
      if (i === j) { m.country(i).setTreaties(j, 0); continue; }
      this.relState(i, j); this.relAct(i, j);
    }
  }
  // 17fc9 i 对 j 的关系
  relState(i, j) {
    const m = this.m, ci = m.country(i), cj = m.country(j), pi = moS16(ci.power), pj = moS16(cj.power);
    const cls = Math.trunc(pi / 2) > pj ? 0 : Math.trunc(pj / 2) > pi ? 1 : pj < pi ? 2 : 3;
    const f = ci.getTreaties(j), fc = f & TreatyFlag.ALLY ? 0 : f & TreatyFlag.BLOCKADE ? 1 : 2, rel = ci.getRelations(j);
    let v = this.T.diplo[3 * (4 * Math.trunc((rel + 9) / 40) + cls) + fc] ?? 0;
    switch (v) {
      case 7: v = this.rnd(100) < rel ? 3 : 0; break;
      case 8: v = this.rnd(100) <= rel ? 0 : 2; break;
      case 9: v = this.rnd(20) + 30 <= rel ? 0 : 2; break;
      case 10: v = this.rnd(10) + 30 > rel ? 2 : 0; break;
    }
    ci.setTreaties(j, (f & 0xf0) | v);
  }
  // 18162 关系 1 → 友好度上升 (双方相同); 4 → 依国力比 夺港 180d0
  relAct(i, j) {
    const m = this.m, ci = m.country(i), cj = m.country(j), f = ci.getTreaties(j);
    if (f === 1) { const v = (cj.getRelations(i) + this.rnd(5) + 3) & 0xff; cj.setRelations(i, v); ci.setRelations(j, v); }
    else if (f === 4) {
      const pj = moS16(cj.power), lim = pj ? faUmin(faLdiv(faLmul(10, moS16(ci.power)), pj), 50) : 50;
      if (this.rnd(50) < lim) this.capture(i, j);
    }
  }
  // 180d0 由港 99 往下第一个 j 国、非 j 首都的港归 i
  capture(i, j) {
    const m = this.m, capJ = m.country(j).capitalPort;
    for (let p = 99; p >= 0; p--) {
      const port = m.port(p);
      if ((port.region & 7) !== j || capJ === p) continue;
      port.region = (port.region & 0xf8) | i;
      m.portEconomy(p).setInfluence(i, this.rnd(10) + 80);
      getCountryMonthlyExtra(m.country(i)).setCapturedPort(i, p);
      return;
    }
  }
  // 18238 船位 slot 依范本船初始化 (k: +8 的耐久等级)
  initSlot(k, slot) {
    const m = this.m, ship = m.ship(slot.ship), stype = m.shipType(ship.type);
    slot.maxDurability = stype.durability; slot.durability = stype.durability; slot.turn = stype.turn; slot.propulsion = stype.propulsion;
    slot.guns = ship.maxGuns;
    const r = this.rnd(3);
    slot.flags = ((r - 3 * k + 4) & 0xff) | ShipSlotFlag.ACTIVE;
    slot.crew = ship.maxCrew;
  }
  // 182df / 183d3 / 184c8 各国舰队补船
  reinforce(which) {
    const m = this.m;
    const cfg = { 0x182df: [50, 1, 5, this.T.fleetA, 0x28, 0], 0x183d3: [75, 5, 7, this.T.fleetB, 0x30, 1], 0x184c8: [75, 7, 10, this.T.fleetC, 0x28, 1] }[which];
    const [div, k0, k1, tab, add, kk] = cfg;
    for (let n = 0; n < 7; n++) {
      const pw = moS16(m.country(n).power);
      let cnt = (Math.trunc(pw / div) + 5) | 0, tier = Math.trunc(pw / 500); if (tier >= 3) tier = 2;
      const ship = () => ((tab[n * 3 + tier] ?? 0) >> (this.rnd(3) * 4)) & 0x0f;
      let k = k0, flIdx = (10 * n + k0) & 0xff;
      if (which === 0x184c8) {                                                   // 循环 (数量 − 1) 次, 每支补满空位
        while ((cnt = (cnt - 1) & 0xffff) !== 0 && k < k1) {
          const fl = m.fleet(flIdx);
          for (let j = 0; j < GameConst.FLEET_SHIPS; j++) {
            const sv = fleetShipSlot(fl, j);
            if (!this.present(sv)) { sv.ship = ship() + add; this.initSlot(kk, sv); }
            if (fl.flags & FleetFlag.AT_SEA) break;
          }
          this.ai.strength(fl); flIdx++; k++;
        }
        continue;
      }
      while (cnt !== 0 && k < k1) {                                              // 182df / 183d3: 总共补 数量 艘
        const fl = m.fleet(flIdx);
        for (let j = 0; cnt !== 0 && j < GameConst.FLEET_SHIPS; j++) {
          const sv = fleetShipSlot(fl, j);
          if (!this.present(sv)) { sv.ship = ship() + add; this.initSlot(kk, sv); cnt = (cnt - 1) | 0; }
          if (fl.flags & FleetFlag.AT_SEA) break;
        }
        this.ai.strength(fl); flIdx++; k++;
      }
    }
  }
  // 1897e 船够多 (≥ random(2) + 4) 的港内舰队派提督出港
  launch() {
    const m = this.m;
    for (let k = 0; k < 70; k++) {
      const fl = m.fleet(k);
      if (k % 10 === 0 || (fl.flags & FleetFlag.AT_SEA)) continue;
      let c = 0; for (let j = 0; j < GameConst.FLEET_SHIPS; j++) if (this.present(fleetShipSlot(fl, j))) c++;
      if (this.rnd(2) + 4 <= c) this.assign(k);
    }
  }
  // 18824 选提督 (或产生新人物) → 18772 出港
  assign(k) {
    const m = this.m, nat = Math.trunc(k / 10), free = () => { for (let q = 6; q < 120; q++) if (!(m.person(q).face & 0x20)) return q; return GameConst.EMPTY_SLOT; };
    let p = GameConst.EMPTY_SLOT;
    if (k < 60) {
      if (this.rnd(2) === 0) {
        for (let q = 6; q < 120; q++) { const pv = m.person(q), f = pv.face; if ((f & 0x0f) === nat && !(f & 0x10) && (f & 0x20) && pv.fleet === GameConst.EMPTY_SLOT) { p = q; break; } }
      } else { const q = free(); if (q !== GameConst.EMPTY_SLOT) { this.newPerson(q, nat, this.rnd(2)); p = q; } }
    } else if (this.rnd(2) === 0) {
      for (let q = 6; q < 120; q++) { const pv = m.person(q); if (pv.fleet === GameConst.EMPTY_SLOT && (pv.flags & 3) >= 2 && (pv.face & 0x20)) { p = q; break; } }
    } else { const q = free(); if (q !== GameConst.EMPTY_SLOT) { this.newPerson(q, this.rnd(6), 2); p = q; } }
    if (p === GameConst.EMPTY_SLOT) return;
    const pv = m.person(p); pv.fleet = k; pv.stayPort = GameConst.EMPTY_SLOT; pv.role = 1;
    this.launchFleet(nat, k, p);
  }
  // 18772 舰队 k 由首都出港 (任务 0)
  launchFleet(n, k, p) {
    const m = this.m, ci = m.country(n), capital = ci.capitalPort, port = m.port(capital), fl = m.fleet(k);
    this.ai.v.c2ea = k;
    fl.x = port.x; fl.y = port.y;
    this.ai.goPort(0, capital, fl);
    fl.funds = this.rnd(3) + Math.trunc(moS16(ci.power) / 10) + 1;
    fl.cargoGood = GameConst.EMPTY_SLOT; fl.cargoAmt = 0;
    for (let i = 0; i < 4; i++) setFleetOfficer(fl, i, GameConst.EMPTY_SLOT);
    fl.homePort = capital; fl.stayDays = this.rnd(10) + 5; fl.flags = 0x31; fl.admiral = p;
    this.ai.strength(fl);
  }
  // 185a7 新人物 (NAME.TBL 6 国 × 16 笔 × 26 bytes: 名 13 + 姓 13)
  newPerson(p, nat, kind) {
    const m = this.m, pv = m.person(p), NT = (this.c.nameTbl ??= Uint8Array.from(this.c.portAssets.fleet.names.match(/../g).map(h => parseInt(h, 16))));
    const eq = (a, b) => { for (let i = 0; ; i++) { const x = a[i] ?? 0, y = b[i] ?? 0; if (x !== y) return false; if (!x) return true; } };
    for (;;) {
      const o1 = (this.rnd(16) + nat * 16) * 26; writePersonNamePart(pv, false, NT, o1);
      const o2 = (this.rnd(16) + nat * 16) * 26 + 13; writePersonNamePart(pv, true, NT, o2);
      let dup = false;
      for (let q = 0; q < 120 && !dup; q++) {
        if (q === p) continue;
        const rv = m.person(q);
        if (eq(rv.familyNameBytes, pv.familyNameBytes) && eq(rv.givenNameBytes, pv.givenNameBytes)) dup = true;
      }
      if (!dup) break;
    }
    pv.age = this.rnd(16) + 20;
    for (let i = 0; i < 8; i++) pv.setStats(i, this.rnd(0x23) + 0x3c);
    {
      const lo = this.rnd(5) + 8, v = this.rnd(4) + pv.navLevel + 2;
      pv.navLevel = faUmin(faUmax(v, lo), 100);
    }
    {
      const lo = this.rnd(5) + 8, v = this.rnd(4) + pv.battleLevel + 2;
      pv.battleLevel = faUmin(faUmax(v, lo), 100);
    }
    pv.battleExp = 0; pv.navExp = 0;
    pv.flags = (this.rnd(16) << 4) + kind;
    pv.skills = this.rnd(16);
    pv.face = nat | 0x20;
    pv.portrait = this.rnd(0x3fff) | 0xc000;
  }
  // 189f6 主角对各国声望 → 援助 (N +5..+8)
  aid() {
    const m = this.m, hd = m.heroInfo();
    for (let n = 0; n < 6; n++) {
      const ci = m.country(n), cm = getCountryMonthlyExtra(ci), s = hd.getCountryStanding(n);
      if (s >= 0x82) {
        const pw = faLmul(hd.rank, moS16(ci.power));
        ci.aidMoneyK = faUmin((ci.aidMoneyK + faLdiv(pw, 3000)) & 0xff, 100);
        cm.aidExtra = faUmin((cm.aidExtra + faLdiv(pw, 1000)) & 0xff, 100);
        const t = faLdiv(pw, 4000); ci.aidShipType = faUmin(t, 7); ci.aidShipCount = ci.aidShipCount + faUmin(t, 10);
      } else if (s < 0x46) { ci.aidMoneyK = 0; cm.aidExtra = 0; ci.aidShipType = GameConst.EMPTY_SLOT; ci.aidShipCount = 0; }
    }
  }
  // 18aee 人物 6..119: 流浪、空记录产生新人物
  persons() {
    const m = this.m;
    for (let p = 6; p < 120; p++) {
      const pv = m.person(p), f = pv.face;
      if (f & 0x20) {
        if (!(f & 0x40) && pv.fleet === GameConst.EMPTY_SLOT && pv.stayPort !== GameConst.EMPTY_SLOT && this.rnd(3) === 0) {
          const v = this.rnd(5) + pv.stayPort - 2; pv.stayPort = v < 0 ? 0 : v > 0x60 ? 0x60 : v;
        }
      } else if (this.rnd(3) === 0) {
        const kind = this.rnd(3), nat = this.rnd(6);
        this.newPerson(p, nat, kind);
        pv.stayPort = this.rnd(0x2a); pv.fleet = GameConst.EMPTY_SLOT;
      }
    }
  }
  // 18c58 对手 (主角 0..5 与人物 60) 追上主角的等级 (循环变量到 6 时改成 60, 但记录指针已指到第 6 号人物, 原版如此)
  rivals() {
    const m = this.m, hr = m.heroPerson(), hero = m.globals.hero;
    for (let i = 0; i < 7; i++) {
      const rec = m.person(i);
      const di = i === 6 ? 0x3c : i;
      if (di === hero) continue;
      if (hr.navLevel > rec.navLevel) {
        const r = this.rnd(2), d = (hr.navLevel - rec.navLevel + r + 1) & 0xffff;
        rec.navLevel = rec.navLevel + d; this.grow(di, d, 0);
      }
      if (hr.battleLevel > rec.battleLevel) {
        const r = this.rnd(2), d = (Math.trunc((hr.battleLevel - rec.battleLevel) / 2) + r + 1) & 0xffff;
        rec.battleLevel = rec.battleLevel + d; this.grow(di, d, 1);
      }
    }
  }
  // 18b97 能力成长 d 次 (do-while)
  grow(p, d, kind) {
    const pv = this.m.person(p), up = (idx, n) => pv.setStats(idx, faUmin(this.rnd(n) + pv.getStats(idx), 100));
    let n = d & 0xffff;
    do {
      up(0, 3);
      if (kind) { up(4, 5); up(5, 5); } else { up(1, 5); up(2, 5); up(3, 5); }
      n = (n - 1) & 0xffff;
    } while (n);
  }
  // 18cfb 对手与提督换船
  upgrade() {
    const m = this.m, hf = fleetByAddr(m, this.ai.heroFleet), hero = m.globals.hero;
    this.ai.strength(hf);
    const tier = Math.trunc(m.heroInfo().rank / 5);
    for (let p = 0; p < 120; p++) {
      const pv = m.person(p), fk = pv.fleet;
      if (p === hero) continue;
      if (p >= 6) {
        if (!(pv.flags & 4) || !(pv.face & 0x20) || pv.role !== 1) continue;
        if (fk < 60 && fk % 10 < 5) continue;
      }
      if (fk >= 70) continue;
      const fl = m.fleet(fk); this.ai.strength(fl);
      if (fl.strength >= hf.strength && this.rnd(3) === 0) continue;
      const c = p < 6 ? [0, 1, 2, 0, 0, 3][p] : fk % 10 >= 7 ? 2 : 1;
      let min = GameConst.EMPTY_SLOT, di = GameConst.EMPTY_SLOT;
      for (let j = 0; j < GameConst.FLEET_SHIPS; j++) {
        const sv = fleetShipSlot(fl, j);
        if (!this.present(sv)) { di = j; break; }
        if (sv.ship < min) { min = sv.ship; di = j; }
      }
      if (di === GameConst.EMPTY_SLOT) return;                                   // 原版直接结束整个函数
      const sv = fleetShipSlot(fl, di);
      sv.ship = (((this.T.upgrade[c] ?? 0) >> ((tier * 4) & 31)) & 0x0f) + 0x31;
      this.initSlot(1, sv); this.ai.strength(fl);
    }
  }
  // 18e7f 薪水与忠诚
  async salary() {
    const m = this.m, { sys, message, menu, win, con } = this.c;
    let total = 0;
    for (let i = 0; i < GameConst.PARTY_SLOTS; i++) if (m.partyCrew(i) !== GameConst.EMPTY_SLOT) total += getPartySalaryUnit(m, i);
    total = faLmul(total, 10);
    const gold = m.globals.money;
    let msg;
    if (total !== 0 && total > gold) {
      for (let i = 0; i < GameConst.PARTY_SLOTS; i++) {
        const n = m.partyCrew(i);
        if (n !== GameConst.EMPTY_SLOT) { const pv = m.person(n); pv.face = pv.face | 0x80; }
      }
      msg = 0x23c;
    } else { setHeroMoney(m, (gold - total) | 0); msg = 0x23e; }
    const h1c = m.heroPerson().getStats(0);
    for (let i = 0; i < GameConst.PARTY_SLOTS; i++) {
      const n = m.partyCrew(i); if (n === GameConst.EMPTY_SLOT) continue;
      const pv = m.person(n); let mx = 0;
      for (let j = 0; j < 8; j++) if (pv.getStats(j) > mx) mx = pv.getStats(j);
      if (pv.loyalty === 100) continue;
      const v = (pv.loyalty + getPartySalaryUnit(m, i) * 2 - mx + h1c) & 0xffff;   // 负数时 4d87 的无号 max 变成大数 → min 成 100
      pv.loyalty = faUmin(faUmax(0, v), 100);
    }
    if (!(m.globals.weather & 0x0f) && total !== 0 && m.globals.port === GameConst.EMPTY_SLOT) {
      sys.mouseHide();
      this.ai.sea.b.crewSpeaks([4, 3, 5, 2, 6]);                                // seg0:9076
      message(msg, total);
      await menu.waitPrompt();                                                   // 0fea:490b
      await win.close();                                                         // 796d
      con.right = 0x50;                                                          // [8a22]
      sys.mouseShow();
    }
  }
}
