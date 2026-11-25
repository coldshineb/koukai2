// tavern.js — 酒馆 (饮酒叙话 / 航海者闲聊 / 酒吧女郎 / 雇用水手 / 解雇水手 / 赌博分派)
import { ListSelect } from "../ui/dos/listsel.js";
import { Gamble } from "./gamble.js";
import { DiscoveryFlag, FleetFlag, GameConst, ItemFlag, ShipSlotFlag } from "../model/flags.ts";
import {
  WorldConst,
  barmaidByAddr,
  getCountryMonthlyExtra,
  getWorkState,
  heroShipSlot,
  personByAddr,
  setPartySalaryUnit,
} from "../model/world_helpers.ts";
import { domS16, domUmin16 } from "../domain/economy.ts";
import { captureConsoleText, decodeCleanCstr } from "../ui/text_util.ts";
import { runDomInfoLines } from "../ui/modals.ts";
import { hasDom } from "../ui/modals.ts";
import { runDomTavernWorkbench } from "../ui/buildings/tavern.ts";

class TavernMixin {
  // 27592 / 275d2 本港的酒吧女郎 (m.barmaid(i))
  tavernGirlA() {
    const m = this.m;
    if (m.heroPerson().face & 0x10) return 0;
    for (let i = 0; i < 0x1e; i++) {
      const bm = m.barmaid(i), f = bm.flags;
      if (bm.port === this.port && (f & 8) && (f & 0x40)) return bm.addr;
    }
    return 0;
  }
  tavernGirl() {
    const m = this.m, heroFace = m.heroPerson().face;
    for (let i = 0; i < 0x1e; i++) {
      const bm = m.barmaid(i), f = bm.flags;
      if (bm.port === this.port && (f & 8) && !(f & 0x40)) {
        if ((heroFace & 0x10) && !(f & 1)) return 0;
        return bm.addr;
      }
    }
    return 0;
  }
  async tavern() {
    const { menu, palette } = this.c, m = this.m, g = m.globals, hero = m.heroPerson();
    this.tvA = Math.trunc(hero.getStats(6) / 3) & 0xff;                     // [aee8]
    const girlA = this.tavernGirlA();                                        // [aeec]
    this.girl = this.tavernGirl();                                           // [aeee]
    const drink = this.T.liquors[m.portEconomy(this.port).liquor];
    if (hasDom() && this.c.codec) {
      if (this.noEvent()) {
        if (girlA) {
          this.talkGirl(0x61, m.barmaid(0).addr);
          this.talkMessage2(0x11, hero.givenNameBytes, drink);
          await this.wait(); await this.closeTalk();
        }
        if (this.girl) await this.girlHello();
      }
      await runDomTavernWorkbench(this, drink, () => (this.gambleG ??= new Gamble(this)).run());
      return;
    }
    if (this.noEvent()) {
      if (girlA) {
        this.talkGirl(0x61, m.barmaid(0).addr);
        this.talkMessage2(0x11, hero.givenNameBytes, drink);
        await this.wait(); await this.closeTalk();
      } else this.greet(0x12, drink);
      if (this.girl) await this.girlHello();
    }
    const items = this.c.menuItems(15);
    let sel;
    do {
      if (g.dailyFlags & 1) menu.disabled |= 1;
      if (!this.girl) menu.disabled |= 0x10;
      if (!this.fleetShips()) menu.disabled |= 3;
      sel = await this.menu(items);
      if (sel !== 0xff) await [() => this.hire(), () => this.dismiss(), () => this.drink(),
        () => this.chat(), () => this.barGirl(), () => (this.gambleG ??= new Gamble(this)).run()][sel]();
      this.after();
    } while (sel !== 0xff);
    palette.selectTimePalette(g.time, false, g.weather);                     // 0fea:98ce
  }
  tvTodo(n) { this.todo(n); }
  // ================= 酒馆: 饮酒叙话 1fd9:5f16 =================
  async drink() {
    const m = this.m, eco = m.portEconomy(this.port), k = eco.liquor, price = this.T.liquorPrice[k];
    this.greet(0x13, this.T.liquors[k], price);
    let si = (this.money % 10000) & 0xffff;                                // _lmod
    if (this.money >= 10000) si = (si + 10000) & 0xffff;
    const v = await this.numpad.input(0, domUmin16(50, Math.trunc(domS16(si) / price)));
    if (!v) return;
    const heat = Math.trunc(((v * 200) & 0xffff) / eco.commerce);            // div word [商业价值]
    const d = Math.trunc(domS16(heat * m.heroPerson().getStats(6)) / 10) + this.tvA;
    this.tvA = domUmin16(100, d);
    this.payMoney(domS16(price * v));
    await this.rumor(heat);
  }
  // 25d99 传闻 (heat = 饮酒量换算)
  async rumor(heat) {
    const m = this.m, g = m.globals, w = getWorkState(m), eco = m.portEconomy(this.port);
    const { message, sys } = this.c, H = m.heroPerson(), D = m.heroInfo(), kinds = this.c.menuItems(10);
    const fames = [D.tradeFame, D.pirateFame, D.adventureFame];
    let fame = 0, di = 0;
    for (let i = 0; i < 3; i++) if (fames[i] > fame) { di = i; fame = fames[i]; }
    this.randomTalk();
    if (fame < 1000) message(0x24);
    else if (fame < 5000) message(0x84, kinds[di], H.givenNameBytes, H.familyNameBytes);
    else message(0x85, H.givenNameBytes, H.familyNameBytes);
    await this.wait();
    let done = false;
    if (g.commonChap) done = await this.rumorScenario();
    else if ((w.flags & 3) && !(w.flags & 4)) { await this.rumorNation(); w.flags |= 2; done = true; }
    if (!done) {
      let found = -1;
      if (sys.rng.random(200) < H.getStats(7))
        for (let i = 0; i < 7; i++) {
          if (!sys.rng.random(3)) continue;
          const v = getCountryMonthlyExtra(m.country(i)).policy;
          if (v === 3 || v === 7) { found = i; break; }
        }
      if (found >= 0) { this.talkClear(); message(0x25); message(0x28, this.p.nations[found]); await this.wait(); }
      else if (sys.rng.random((0x514 - 12 * heat) & 0xffff) > eco.commerce) await this.rumorPort();
      else await this.rumorTrade();
    }
    await this.closeTalk();
  }
  // 25d56 本国的消息
  async rumorNation() {
    const { message } = this.c;
    this.talkClear(); message(0x199); message(0x19a + (this.m.heroPerson().face & 15)); message(0x1a0);
    await this.wait();
  }
  // 25a99 随机邻近港口 (本港 ± random(5), 跳过 +15 bit4 的港) 的情报, 最多试 10 次
  async rumorPort() {
    const m = this.m, rng = this.c.sys.rng, port = this.port;
    for (let n = 0; n < 10; n++) {
      const a = rng.random(5), b = rng.random(2);
      if (!b && a > port) continue;
      if (b && a + port > 0x63) continue;
      const q = (b ? port + a : port - a) & 0xff;
      if (m.port(q).region & WorldConst.PORT_DISCOVERED_BIT) continue;
      return this.portInfo(q);
    }
  }
  // 25a1a 港口 q 的位置与特产
  async portInfo(q) {
    const m = this.m, { message } = this.c, P = m.port(q), E = m.portEconomy(q);
    this.talkClear();
    message(0x25);
    this.latLong(P.x, P.y);
    message(0x82, P.nameBytes);
    await this.wait();
    this.talkClear();
    if (E.specialtyGood !== GameConst.EMPTY_SLOT) message(0x83, this.p.goods[E.specialtyGood]); else message(0x2e6);
    await this.wait();
  }
  // 253b4 座标 → 纬度 (北/南 0x7e/0x7f) 与经度 (东/西 0x80/0x81)
  latLong(x, y) {
    const { message } = this.c, v = domS16(0x280 - domS16(y));
    let di = 0x80, si = (domS16(x) + 0x7bd) % 0x870;
    if (si > 0x438) { di = 0x81; si = 0x870 - si; }
    message(v >= 0 ? 0x7e : 0x7f, Math.trunc(domS16(Math.abs(v) << 3) / 0x39));
    message(di, Math.trunc(si / 6));
  }
  // 25ba4 随机舰队 (0x52d4 + 0x1e×random(10)) 的 +16..+1a 商品; 试 50 次都没有就改说港口情报
  async rumorTrade() {
    const m = this.m, rng = this.c.sys.rng;
    let cs = null, k = 0;
    for (let n = 0; n < 0x32; n++) { cs = m.crewSlot(rng.random(10)); k = rng.random(5); if (cs.getCargoGoods(k) !== GameConst.EMPTY_SLOT) break; }
    if (cs && cs.getCargoGoods(k) !== GameConst.EMPTY_SLOT) await this.rumorGoods(cs.getCargoGoods(k)); else await this.rumorPort();
  }
  // 25b17 商品 g 最贵的地区 (物价表, 8 区)
  async rumorGoods(g) {
    const m = this.m, rng = this.c.sys.rng, { message } = this.c;
    let top = 0, best = 0;
    for (let r = 0; r < 8; r++) { const v = domS16(m.regionPrice(r).getSellBase(g)); if (v > top && rng.random(8)) { top = v; best = r; } }
    this.talkClear(); message(0x34e, this.p.goods[g]); message(0x181 + best); message(0x34f);
    await this.wait();
  }
  // 25c01 剧本进行中 ([0d5e]) 的特别传闻
  async rumorScenario() {
    const m = this.m, w = getWorkState(m), { message } = this.c;
    const ev = domS16(w.curKind), who = w.targetPerson, item = w.targetItemWord;
    if (ev === 0x0b && who !== 0xff)
      for (let i = 0; i < GameConst.INV_SLOTS; i++) { const v = m.inventory(i); if (((v - item) & 0xff) === 0xf6 || v === (item & 0xff)) return false; }
    if (!((ev === 0x0b && who !== 0xff) || ev === 5)) return false;
    if (domS16(who) % 3 !== this.port % 3) return false;
    const M = m.person(who & 0xff);
    if (M.stayPort !== GameConst.EMPTY_SLOT) {
      const P = m.port(M.stayPort);
      this.talkClear(); message(0x257, M.givenNameBytes, M.familyNameBytes, P.nameBytes); await this.wait();
      this.talkClear(); message(0x258, P.nameBytes); this.latLong(P.x, P.y); message(0x259);
    } else {
      const kinds = this.c.menuItems(11), f = M.fleet, r = f % 10;
      this.talkClear(); message(0x25a, M.givenNameBytes, M.familyNameBytes, this.p.nations[Math.trunc(f / 10)], kinds[r ? Math.trunc(r / 5) + 1 : 0]);
      await this.wait();
      this.talkClear(); message(0x25b);
    }
    await this.wait();
    return true;
  }
  // ================= 酒馆: 与航海者闲聊 1fd9:68ff =================
  async chat() {
    const list = (this.c.listSel ??= new ListSelect(this.c));
    for (;;) {
      const n = await this.chatList();
      if (!n) return;
      this.after();                                                        // 268d4
      const r = await list.select(0x86, n);
      const who = r === -1 ? 0xff : this.c.persons[r] & 0xff;
      if (who === 0xff) return;
      this.mate = this.m.person(who).addr;                                 // [aeea]
      this.talkPerson(who);
      this.mateNo = who;                                                   // [bb38]
      await this.chatMenu();
      await this.closeTalk();
    }
  }
  // 0fea:3048 = 12ee8: 本港人物中 +2f bit4 的 (酒馆里的航海者); 都没有时 [0538] = FF 并返回原数量
  tavernPersons() {
    const m = this.m, L = this.portPersonsAll(), keep = L.filter(n => m.person(n).flags & 0x10);
    if (!keep.length) { this.setPersons(L); this.c.persons[0] = 0xff; return L.length; }
    this.setPersons(keep); return keep.length;
  }
  // 26890
  async chatList() {
    const { message } = this.c, n = this.tavernPersons();
    if (n && this.c.persons[0] !== 0xff) return n;
    if (this.tvA >= 0x32) { this.randomTalk(); message(0x26); } else { this.crewSpeaks(); message(0x27); }
    await this.wait(); await this.closeTalk();
    return 0;
  }
  // 2682c
  async chatMenu() {
    if (!(await this.chatIntro())) return;
    const items = this.c.menuItems(12).slice(0, 3);                      // 「决斗」不在酒馆 (bl = 3)
    let sel;
    do {
      sel = await this.menu(items);
      if (sel !== 0xff && !(await [() => this.treat(), () => this.mateInfo(), () => this.mateHire(1)][sel]())) sel = 0xff;
    } while (sel !== 0xff);
  }
  // 26000 对象的自我介绍; 返回 0 = 已是自己的船员
  async chatIntro() {
    const m = this.m, { message, sys } = this.c, M = personByAddr(m, this.mate);
    this.aef0 = 0;
    if (m.heroPerson().fleet === M.fleet) { const r = sys.rng.random(3); message(r === 0 ? 0x86 : r === 1 ? 0x87 : 0x88); await this.wait(); return 0; }
    const f = M.fleet;
    if (f < 0x46 && f >= 0x3c) { message(0x35b + sys.rng.random(2)); await this.wait(); this.aef0 = 1; return 1; }
    message(0x29); await this.wait();
    this.talkClear();
    if (f === GameConst.EMPTY_SLOT) message(0x2b);
    else {
      const kinds = this.c.menuItems(11), r = f % 10, kind = kinds[r ? Math.trunc(r / 5) + 1 : 0], nation = this.p.nations[Math.trunc(f / 10)];
      message(0x2a);
      if (M.role === 1) message(0x89, nation, kind, M.givenNameBytes);
      else message(0x8a, nation, kind, this.T.crewRoles[M.role], M.givenNameBytes);
    }
    await this.wait();
    return 1;
  }
  // [0d5e] 剧本中, 对象是剧本人物时: 返回 null = 没有剧本动作
  async mateScenario(needItem) {
    const m = this.m, w = getWorkState(m), ev = domS16(w.curKind);
    if (!m.globals.commonChap || (w.targetPerson & 0xff) !== this.mateNo) return null;
    if (ev === 0x0b && (!needItem || w.targetItemWord)) { this.talkPerson(this.mateNo); await this.questItem(); await this.closeTalk(); return 1; }
    if (ev === 5 && w.targetItemWord) return this.questReward();
    return null;
  }
  // 2633b 请客喝酒
  async treat() {
    const m = this.m, { message } = this.c, k = m.portEconomy(this.port).liquor, price = this.T.liquorPrice[k];
    const M = personByAddr(m, this.mate), H = m.heroPerson();
    if (this.money < price) { this.talkClear(); message(0x4c); await this.wait(); return 1; }
    this.payMoney(price);
    const sc = await this.mateScenario(true); if (sc !== null) return sc;
    this.talkClear();
    let mul;
    if (!((H.flags ^ M.flags) & 3)) { message(0x331 * this.aef0 + 0x2c); mul = 3; } else { message(0x330 * this.aef0 + 0x2d); mul = 1; }
    await this.wait();
    M.loyalty = domUmin16(((M.flags & 0x40 ? 2 : 1) * 6 * mul + M.loyalty) & 0xffff, 100);
    let mx = 0, di = 0;
    for (let i = 0; i < 5; i++) if (M.getStats(i) > mx) { di = i; mx = M.getStats(i); }
    if (M.loyalty > 0x1e && mx > 0x4b) { this.talkClear(); message(0x2e); message(0x8b, this.T.stats[di]); await this.wait(); }
    return 1;
  }
  // 264a0 航海者情报: 附近港口 (本港 + random(8) − random(4)) 停留的人物
  async mateInfo() {
    const m = this.m, { message, sys } = this.c;
    const sc = await this.mateScenario(false); if (sc !== null) return sc;
    let q = domUmin16(0x63, sys.rng.random(8) + this.port);
    q = (q - domUmin16(sys.rng.random(4), q)) & 0xff;
    let i = 0, rec = null;
    for (; i < WorldConst.TOTAL_PERSONS; i++) {
      const p = m.person(i);
      if (p.stayPort === q && (p.face & 0x20)) { rec = p; break; }
    }
    const P = m.port(q);
    this.talkClear();
    if (q === this.port) message(0x2f, this.T.liquors[m.portEconomy(this.port).liquor]);
    else if (i !== WorldConst.TOTAL_PERSONS) message(0x23a, P.nameBytes, rec.familyNameBytes);
    else message(0x23b, P.nameBytes);
    await this.wait();
    return 1;
  }
  // 26708 雇用 (strict: 需要好感 > 30)
  async mateHire(strict) {
    const m = this.m, { message, sys } = this.c, M = personByAddr(m, this.mate), H = m.heroPerson();
    const sc = await this.mateScenario(false); if (sc !== null) return sc;
    this.talkTop(m.globals.hero); message(0x30); await this.wait(); await this.closeTalk();
    if (!(await this.mateHireCheck(strict))) return 1;
    let mx = 0, di = 0;
    for (let i = 0; i < 7; i++) if (M.getStats(i) > mx) { di = i; mx = M.getStats(i); }
    const worth = domS16(M.getStats(di) * (M.navLevel + M.battleLevel));
    let need = domS16(H.getStats(di) * (H.navLevel + H.battleLevel));
    need = (need + Math.trunc(domS16(need * m.heroInfo().rank) / 10)) & 0xffff;
    if (((sys.rng.random(0x14) + worth) & 0xffff) < need) return this.mateFee(worth);
    this.talkClear(); message(0x91); await this.wait();
    return 1;
  }
  // 265bd
  async mateHireCheck(strict) {
    const m = this.m, { message } = this.c, M = personByAddr(m, this.mate);
    const no = async n => { this.talkClear(); message(n); await this.wait(); return 0; };
    if (M.role) return no(0x31);
    let free = false; for (let i = 0; i < GameConst.PARTY_SLOTS; i++) if (m.partyCrew(i) === GameConst.EMPTY_SLOT) free = true;
    if (!free) return no(0x8c);
    if (strict && M.loyalty <= 0x1e) return no(0x8d);
    return 1;
  }
  // 26628 谈薪水; 返回 0 = 已雇用 (结束菜单)
  async mateFee(worth) {
    const m = this.m, { message, menu, sys } = this.c, M = personByAddr(m, this.mate);
    const r = sys.rng.random(3);
    const fee = (domUmin16(Math.trunc(worth / 400) + r + 1, 0x14) * 10) & 0xff;
    this.talkClear(); message(0x8e, fee);
    if (!(await menu.yesNo())) { this.talkClear(); message(0x8f); await this.wait(); return 1; }
    this.talkClear(); message(0x90); await this.wait();
    M.stayPort = GameConst.EMPTY_SLOT; M.fleet = m.heroPerson().fleet; M.role = 6;
    M.loyalty = domUmin16(M.loyalty + 10, 100);
    for (let i = 0; i < GameConst.PARTY_SLOTS; i++) if (m.partyCrew(i) === GameConst.EMPTY_SLOT) { m.setPartyCrew(i, this.mateNo); setPartySalaryUnit(m, i, Math.trunc(fee / 10)); break; }
    return 0;
  }
  // 2614f 剧本: 向对象买剧本道具 [0d8c] (1000 金)
  async questItem() {
    const m = this.m, { message, menu } = this.c, item = getWorkState(m).targetItem;
    const end = async n => { message(n); await this.wait(); };
    for (let i = 0; i < GameConst.INV_SLOTS; i++) if (((m.inventory(i) - item) & 0xff) === 0xf6) return end(0x36f);
    message(0x25c, m.item(item).nameBytes); await this.wait();
    this.talkClear(); message(0x25d);
    if (!(await menu.yesNo())) return;
    if (this.money < 1000) { this.talkClear(); return end(0x25f); }
    this.talkClear(); message(0x25e); await this.wait();
    for (let i = 0; i < GameConst.INV_SLOTS; i++) if (m.inventory(i) === GameConst.EMPTY_SLOT) {
      const v = (item - 10) & 0xff; m.setInventory(i, v);
      m.discovery(m.item(v).power).flags |= DiscoveryFlag.KNOWN;
      this.money = (this.money - 1000) | 0; this.p.panels();
      return;
    }
    this.talkClear(); return end(0x370);
  }
  // 26246 剧本: 交付后的报酬 (或被骗)
  async questReward() {
    const m = this.m, w = getWorkState(m), { message, sys } = this.c, M = personByAddr(m, this.mate), H = m.heroPerson();
    this.talkTop(m.globals.hero); message(0x260, M.givenNameBytes, M.familyNameBytes); await this.wait();
    if (sys.rng.random(100) > H.getStats(7) && !sys.rng.random(3)) {
      this.talkClear(); message(0x262); await this.wait();
      this.talkClearTop(); message(0x265); await this.wait(); await this.closeTalk();
      M.stayPort = M.stayPort >= 0x2a ? sys.rng.random(0x3a) + 0x2a : sys.rng.random(0x2a);
      return 0;
    }
    const n = domS16(w.rewardScale);
    this.talkClear(); message(0x261, domS16(5 * n)); await this.wait();
    this.talkClearTop(); message(0x266); await this.wait(); await this.closeTalk();
    this.money = (this.money + 50000 * n) | 0;
    w.targetItemWord = 0; this.p.panels();
    return 1;
  }

  // 2761f 女郎招呼
  async girlHello() {
    const m = this.m;
    if (!(m.heroPerson().face & 0x10)) return;
    const g = barmaidByAddr(m, this.girl);
    this.talkGirl(Math.trunc((g.addr - m.barmaid(0).addr) / 0x13) + 0x61, g.addr);
    this.talkMessage2(g.quest !== GameConst.EMPTY_SLOT && g.questDays === 0 ? 0x133 : 0x134);
    await this.wait(); await this.closeTalk();
  }
  // ================= 酒馆: 酒吧女郎 1fd9:75a7 (RE_NOTES 17.8) =================
  // 先付 10 (不足 → 9076 + 0x93); MENU #14 (主角 +31 bit4 时没有前两项); 子功能 DS:af62 = 26941 / 26a64 / 26ece / 272c5
  // 女郎记录 m.barmaid(i): age(+0d), port(+0e), affection(+0f), quest(+10), questDays(+11), flags(+12)
  girlFace() { return Math.trunc((this.girl - this.m.barmaid(0).addr) / 0x13) + 0x61; }
  async barGirl() {
    const m = this.m, g = barmaidByAddr(m, this.girl), all = this.c.menuItems(14), items = [], kinds = [];
    if (!(m.heroPerson().face & 0x10)) { items.push(all[0], all[1]); kinds.push(0, 1); }
    items.push(all[2], all[3]); kinds.push(2, 3);
    this.greet(0x92, g.nameBytes);
    await this.wait();
    if (this.money < 10) { this.crewSpeaks([4, 3, 5, 2, 6]); this.c.message(0x93); await this.wait(); await this.closeTalk(); return; }
    this.money = this.money - 10;
    for (;;) {
      const sel = await this.menu(items);
      if (sel === 0xff) return;
      const k = kinds[sel];
      if (k !== 1) this.talkGirl(this.girlFace(), g.addr);
      await [() => this.girlVoyage(), () => this.girlGift(), () => this.girlSurvey(), () => this.girlInfo()][k]();
      if (k !== 1) await this.closeTalk();
    }
  }
  // 26941 航海见闻: 已知 (+6 bit5) 未发现 (+6 bit7) 的发现物 (90 笔) → 清单 0x12 → 发现物数据 → 好感 + (+5 / 10 + 1) (每天一次: dailyFlags bit6)
  async girlVoyage() {
    const m = this.m, gv = m.globals, g = barmaidByAddr(m, this.girl), lvl = (g.flags & 0x30) >> 4, L = [];
    const MSG = [0x13a, 0x13b, 0x13c, 0x13d, 0x13e, 0x13f, 0x140, 0x13b];
    for (let i = 0; i < 0x5a; i++) { const f = m.discovery(i).flags; if (!(f & DiscoveryFlag.FOUND) && (f & DiscoveryFlag.KNOWN)) L.push(i); }
    if (!L.length) { this.talkMessage2(0x138); await this.wait(); return; }
    this.setPersons(L);
    const r = await this.listSel().select(0x92, L.length);
    if (r === -1) return;
    const n = this.c.persons[r] & 0xff, d = m.discovery(n);
    await this.discInfo(n);
    let v = (Math.trunc(d.importance / 10) + 1) & 0xff;
    this.talkMessage2(0x139);
    if (lvl >= 2) { v = (v << 1) & 0xff; this.c.message(MSG[d.flags & DiscoveryFlag.KIND_MASK]); gv.dailyFlags &= 0xbf; }
    await this.wait();
    if (!(gv.dailyFlags & 0x40)) { g.affection = domUmin16(g.affection + v, 100); gv.dailyFlags |= 0x40; }
  }
  // 2e09:681c (348ac → 347a0) 发现物数据窗口: COLONY.DAT 第 n 笔 (+0 名称, +0f 图, +10 说明), 种类 DS:0952[+6 & 7], 重要度 MENU #0x22[+5 / 25]
  async discInfo(n) {
    const m = this.m, { con, printf, kao, scr, win, codec } = this.c, B = this.BG, d = m.discovery(n);
    m.globals.discoveryId = n;                                                     // 348ac: [8246] = 发现物编号
    const imp = this.c.menuItems(0x22), rec = ListSelect.colonyRec(this.c, n);
    if (scr.wideRenderer && codec) {
      const title = decodeCleanCstr(codec, rec);
      const catLine = captureConsoleText(this.c, () => printf(B.cat, B.discCats[d.flags & DiscoveryFlag.KIND_MASK]));
      const impLine = captureConsoleText(this.c, () => printf(B.imp, imp[Math.trunc(d.importance / 0x19)] ?? Uint8Array.of(0)));
      const desc = decodeCleanCstr(codec, rec.subarray(0x10));
      const descLines = [];
      for (let i = 0; i < desc.length; i += 24) descLines.push(desc.slice(i, i + 24));
      const imgUrl = this.c.art?.discoveryUrl?.(rec[0x0f]) ?? null;
      await runDomInfoLines(title, [catLine, impLine, "", ...descLines], undefined, imgUrl);
      return;
    }
    await win.open(0x0f, 0x20, 0x1c, 0xd0, 0);                              // seg0:74f7
    kao.drawItem(scr, rec[0x0f], 0x11, 0x30);                               // seg0:7d4c
    con.puts(B.discHdr);
    con.setCursor(0x18, 0x30); printf(B.s, rec);
    con.setCursor(0x20, 0x48); printf(B.cat, B.discCats[d.flags & DiscoveryFlag.KIND_MASK]);
    con.setCursor(0x18, 0x58); printf(B.imp, imp[Math.trunc(d.importance / 0x19)] ?? Uint8Array.of(0));
    con.left = 0x11; con.right = 0x28; con.lineH = 0x10;
    con.setCursor(0x13, 0x70); printf(B.s, rec.subarray(0x10));
    await this.wait(); await this.closeTalk();
    con.lineH = 0x18;
  }
  // 26a64 送她礼物: 随身物 (20 格) 中种类 0x0a / 0x0b 的 (0fea:32ca) → 清单 0x0d → 道具数据 → 是/否
  async girlGift() {
    const m = this.m, g = barmaidByAddr(m, this.girl), lvl = (g.flags & 0x30) >> 4, L = [];
    for (let i = 0; i < GameConst.INV_SLOTS; i++) {
      const it = m.inventory(i); if (it === GameConst.EMPTY_SLOT) continue;
      const t = m.item(it).kindFlags & ItemFlag.KIND_MASK;
      if (t === 0x0a || t === 0x0b) L.push(it);
    }
    if (!L.length) {
      this.talkGirl(this.girlFace(), g.addr);
      this.talkMessage2(g.flags & 1 ? 0x14a : 0x14b);
      await this.wait(); await this.closeTalk(); return;
    }
    this.setPersons(L);
    let it;
    for (;;) {
      const r = await this.listSel().select(0x8d, L.length);
      if (r === -1) return;
      it = this.c.persons[r] & 0xff;
      if (this.c.scr.wideRenderer && this.c.codec) {
        const item = m.item(it);
        const lines = captureConsoleText(this.c, () => this.itemInfo(it, 0)).split("\n").filter(Boolean);
        const title = decodeCleanCstr(this.c.codec, item.nameBytes);
        const imgUrl = this.c.art?.discoveryUrl?.(item.icon + 0x55) ?? null;
        if ((await runDomInfoLines(title, lines, ["是", "否"], imgUrl)) === 0) break;
      } else {
        this.table();                                                        // 0fea:b6bc
        this.itemInfo(it, 0);
        if (await this.c.menu.yesNo()) break;
      }
    }
    this.talkGirl(this.girlFace(), g.addr);
    const item = m.item(it), t = item.kindFlags & ItemFlag.KIND_MASK;
    this.talkMessage2(0x141);
    let add = domUmin16(item.power, 10), msg = 0;
    if (lvl === 0) { if (t === 0x0a) msg = 0x142; } else if (lvl === 1) { if (t === 0x0b) msg = 0x143; } else if (lvl === 3) msg = 0x144;
    if (msg) {
      this.c.message(msg); add = (add << 1) & 0xff;
      if (g.affection >= 0x50) { await this.wait(); this.talkMessage2(0x145); }
    }
    await this.wait();
    g.affection = domUmin16(g.affection + add, 100);
    for (let i = 0; i < GameConst.INV_SLOTS; i++) if (m.inventory(i) === it) { m.setInventory(i, GameConst.EMPTY_SLOT); break; }
    await this.closeTalk();
  }
  // 29340 道具数据 (随身物 it; flag ≠ 0 且已装备 (+13 bit4) 时加「装备」): 名称 (种类), 图 (KAO 小图 icon + 0x55), 攻击力 / 防御力 (MENU #0x22), ITEM.MES 说明
  itemInfo(it, flag) {
    const { con, printf, kao, scr, font } = this.c, B = this.BG, item = this.m.item(it), t = item.kindFlags & ItemFlag.KIND_MASK, v = item.power;
    const desc = font.encode(this.c.portAssets.itemMes[it]);
    con.setCursor(0x10, 0x90); printf(B.itemHdr, item.nameBytes, B.itemTypes[t]);
    if (!scr.wideRenderer) kao.drawItem(scr, item.icon + 0x55, 0x10, 0xc0);
    if (flag && (item.kindFlags & ItemFlag.EQUIPPED)) con.puts(B.equip);
    const lv = this.c.menuItems(0x22);
    con.setCursor(0x10, 0xa8);
    if (t <= 3) printf(B.atk, lv[v >= 0x23 ? 4 : Math.trunc((v - 5) / 6)]);
    if (t === 6) printf(B.def, lv[v > 0x28 ? 4 : Math.trunc((v - 10) / 10)]);
    con.puts(B.color0);
    con.right = 0x35; con.lineH = 0x10; con.left = 0x1e; con.setCursor(0x1e, 0xb0);
    con.puts(desc);
    con.lineH = 0x18;
  }
  // 26ece 调查结果: 已委托 → 还在调查 (0x219) 或报告 (26cb4); 未委托 → 好感需 ≥ 80 / (+12 bit0 + 1) (主角 +31 bit4 免) → 委托 (26bdc)
  async girlSurvey() {
    const m = this.m, g = barmaidByAddr(m, this.girl);
    if (g.quest !== GameConst.EMPTY_SLOT) {
      if (g.questDays) { this.talkMessage2(0x219); await this.wait(); } else await this.surveyReport();
      return;
    }
    const f = g.flags & 1;
    if (!(m.heroPerson().face & 0x10) && (Math.trunc(0x50 / (f + 1)) & 0xff) > g.affection) { this.talkMessage2(0x215); await this.wait(); return; }
    await this.surveyAsk();
  }
  // 26bdc 委托调查: 国家 (DS:08de) → 种类 (MENU #0x2c, 海盗为 #0x2d) → 天数 = random(3) + (110 − 好感) / ((主角 +31 bit4 + 1) × 5)
  async surveyAsk() {
    const m = this.m, g = barmaidByAddr(m, this.girl);
    this.talkMessage2(0x216);
    const n = await this.menu(this.BG.nations);
    if (n === 0xff) return;
    g.quest = n;
    this.talkMessage2(0x217);
    const k = await this.menu(this.c.menuItems(n === 6 ? 0x2d : 0x2c));
    if (k === 0xff) { g.quest = GameConst.EMPTY_SLOT; return; }
    g.quest |= k << 4;
    const r = this.c.sys.rng.random(3), div = ((m.heroPerson().face & 0x10) + 1) * 5;
    g.questDays = (r + Math.trunc(domS16(0x6e - g.affection) / div)) & 0xff;
    this.talkMessage2(0x218, g.questDays);
    await this.wait();
  }
  // 26cb4 调查报告: 该国舰队 nat×10 + [af52[k] .. af52[k+1]): 提督、任务、货物、位置
  async surveyReport() {
    const m = this.m, g = barmaidByAddr(m, this.girl), { message } = this.c, v = g.quest, nat = v & 0x0f, k = v >> 4;
    const items = this.c.menuItems(nat === 6 ? 0x2d : 0x2c);
    this.talkMessage2(0x21a); await this.wait();
    if (nat !== 6) { this.talkMessage2(0x21b, this.BG.nations[nat]); message(0x21c, items[k]); } else this.talkMessage2(0x21c, items[k]);
    await this.wait();
    const lo = this.BG.survey[k], hi = this.BG.survey[k + 1];
    for (let i = lo; i < hi; i++) {
      const F = m.fleet((nat * 10 + i) & 0xff);
      if (!(F.flags & FleetFlag.AT_SEA)) { message(0x22c, i - lo + 1); await this.wait(); continue; }
      const t = F.mission, q = F.target;
      const port = () => m.port(q).nameBytes, who = () => m.person(q).familyNameBytes;
      this.talkMessage2(0x21d, m.person(F.admiral).familyNameBytes);
      if (t <= 2) message(0x21e, port()); else if (t === 3) message(0x226, port()); else if (t === 4) message(0x227);
      else if (t <= 7) message(0x21f, who()); else if (t === 8) message(0x225, who()); else if (t === 9) message(0x224, port());
      await this.wait();
      if (F.cargoGood !== GameConst.EMPTY_SLOT) { this.talkMessage2(0x220, this.BG.goods[F.cargoGood]); await this.wait(); }
      this.talkMessage2(0x229); this.latLong(F.x, F.y); message(0x22a);
      await this.wait();
    }
    g.quest = GameConst.EMPTY_SLOT; g.questDays = GameConst.EMPTY_SLOT;
  }
  // 272c5 探听情报: MENU #0x0d (工作的情报 / 她的喜好 / 她的芳龄), 剧本进行中 ([0d5e] 且 [0d5f]) 才能选第一项; 子功能 DS:af56 = 26f2f / 27224 / 27299
  async girlInfo() {
    const g = this.m.globals, menu = this.c.menu, items = this.c.menuItems(0x0d);
    this.talkMessage2(0x18e);
    for (;;) {
      if (!g.commonChap || !g.commonSec) menu.disabled = 1;
      const sel = await this.menu(items);
      if (sel === 0xff) return;
      await [() => this.girlWork(), () => this.girlLikes(), () => this.girlAge()][sel]();
    }
  }
  // 27224 她的喜好: random(50) < 好感 → 0x195 + 性格, 好感 + (性格 & ~1) + 2
  async girlLikes() {
    const g = barmaidByAddr(this.m, this.girl), lvl = (g.flags & 0x30) >> 4, inc = (lvl & 0xfe) + 2;
    if (this.c.sys.rng.random(0x32) < g.affection) { this.talkMessage2(0x195 + lvl); g.affection = domUmin16(g.affection + inc, 100); }
    else this.talkMessage2(0x193);
    await this.wait();
  }
  // 27299 她的芳龄: 好感 > 80 才说
  async girlAge() {
    const g = barmaidByAddr(this.m, this.girl);
    if (g.affection > 0x50) this.talkMessage2(0x194, g.age); else this.talkMessage2(0x193);
    await this.wait();
  }
  // 26f2f 工作的情报 (剧本): [0d74] 目前的剧本任务, [0d8a] 目标港 / [0d8c] 目标 (道具 / 商品 / 国家)
  async girlWork() {
    const m = this.m, gv = m.globals, w = getWorkState(m), g = barmaidByAddr(m, this.girl);
    const { message, sys } = this.c, t = w.curKind, a = w.targetPerson & 0xff, c8 = w.targetItemWord;
    const end = async msg => { this.talkMessage2(msg); await this.wait(); };
    if (t === 0x0c || t === 4) return this.surveyAsk();
    if (t === 9) return end(0x24a);
    if (t === 0x0a) return end(0x24b);
    if (t === 0x0b) {
      for (let i = 0; i < GameConst.INV_SLOTS; i++) {
        const it = m.inventory(i);
        if (((it - c8) & 0xff) === 0xf6) { this.talkMessage2(0x3fa, m.item(it).nameBytes); return; }
        if (it === (c8 & 0xff)) {
          this.talkMessage2(0x3fb, m.item(it).nameBytes);
          if (!(gv.dailyFlags & 0x40)) { g.affection = domUmin16(g.affection + 10, 100); gv.dailyFlags |= 0x40; }
          return;
        }
      }
      return end(w.targetPerson === 0xff ? 0x24c : 0x24d);
    }
    if (t === 5) return end(0x24d);
    const P = m.port(a), E = m.portEconomy(a);
    const where = async () => { this.latLong(P.x, P.y); message(0x252); await this.wait(); };
    if (t === 3) { this.talkMessage2(0x24e); return where(); }
    if (t === 7 || t === 8) {
      if (a === gv.port) return end(0x249);
      this.talkMessage2(domS16(c8) >= 4 ? 0x250 : 0x24f, this.BG.nations[c8]);
      message(0x251, P.nameBytes); return where();
    }
    const lucky = () => { const r = sys.rng.random(0x96); return m.heroPerson().getStats(6) + g.affection > r || (m.heroPerson().face & 0x10); };
    if (t === 1) {
      if (a === gv.port) return end(0x249);
      if (!lucky()) return end(0x18f);
      this.talkMessage2(0x191, P.nameBytes); message(0x181 + E.priceRegion); message(0x192); await this.wait(); return;
    }
    if (t === 2 || t === 6) {
      if (!lucky()) return end(0x18f);
      let found = 0xff;
      for (let i = 0; i < 0x28; i++) { const e = m.portEconomy(i); if (e.specialtyGood === c8 && e.specialtyLevel * 10 <= domS16(e.commerce)) { found = i; break; } }
      if (found !== 0xff) { this.talkMessage2(0x190, this.BG.goods[c8], m.port(found).nameBytes); await this.wait(); return; }
      for (let k = 0x0c; k >= 0; k--) { const R = m.regionPrice(k); for (let j = 0; j < 9; j++) if (R.getBuyGoods(j) === c8) { found = k; break; } }
      if (found === 0xff) return end(0x18f);
      this.talkMessage2(0xca, this.BG.goods[c8]); message(0x181 + found); message(0xcb); await this.wait(); return;
    }
    await this.wait();
  }
  // 1fd9:591f 水手雇用
  async hire() {
    const m = this.m, free = new Array(10).fill(0);
    if (!(await this.hireCheck(free))) return;
    const n = await this.hireNegotiate(free);
    if (!n) return;
    await this.assignCrew(n);
    for (let i = 0; i < GameConst.FLEET_SHIPS; i++) {
      const S = heroShipSlot(m, i), M = m.crewSlot(i);
      if ((S.flags & ShipSlotFlag.STATE_MASK) !== ShipSlotFlag.ACTIVE) continue;
      const ship = m.ship(S.ship), old = ((ship.maxCrew - free[i]) << 16) >> 16, now = (S.crew << 16) >> 16;
      if (old >= now) continue;
      M.morale = Math.trunc(((now - old) * 0x3c + M.morale * old) / now);
    }
    m.globals.dailyFlags |= 1;
  }
  // 1fd9:59ce 水手解雇: 257d6(0), 之后水手数为 0 的船士气归 0
  async dismiss() {
    const m = this.m;
    await this.assignCrew(0);
    for (let i = 0; i < GameConst.FLEET_SHIPS; i++) { const S = heroShipSlot(m, i); if ((S.flags & ShipSlotFlag.STATE_MASK) === ShipSlotFlag.ACTIVE && !S.crew) m.crewSlot(i).morale = 0; }
  }
  // 25425 各船尚可补充的水手数
  roomCheck(free) {
    const m = this.m; let r = 0;
    for (let i = 0; i < GameConst.FLEET_SHIPS; i++) {
      free[i] = 0;
      const S = heroShipSlot(m, i);
      if ((S.flags & ShipSlotFlag.STATE_MASK) !== ShipSlotFlag.ACTIVE) continue;
      free[i] = (m.ship(S.ship).maxCrew - S.crew) & 0xffff;
      if (free[i]) r = 1;
    }
    return r;
  }
  // 25485
  async hireCheck(free) {
    const { menu } = this.c;
    if (!this.fleetShips()) return 0;
    const fail = async n => { this.crewSpeaks(); this.c.message(n); await this.wait(); await this.closeTalk(); return 0; };
    if (!this.roomCheck(free)) return fail(0x1d);
    if (this.money < 10) return fail(0x1e);
    if (this.tvA < 0x1e) {
      this.crewSpeaks(); this.c.message(0x1f); await this.wait();
      this.talkClear(); this.c.message(0x20);
      const ok = await menu.yesNo();
      await this.closeTalk();
      if (!ok) return 0;
    }
    return 1;
  }
  // 25568 交涉: 应募人数、工资、雇用数
  async hireNegotiate(free) {
    const m = this.m, g = m.globals, { message } = this.c, eco0 = m.portEconomy(this.port).commerce, A = this.tvA;
    const apps = Math.trunc(((A * eco0) >>> 0) / 500) & 0xffff;
    const rank = m.heroInfo().rank;
    let si = domUmin16(((rank + 1) * A) & 0xffff, apps);
    this.talkPerson(g.hero);
    message(0x21, m.heroPerson().givenNameBytes, (g.hero === 5 ? this.T.ottomanTitles : this.T.titles)[rank]);
    await this.wait(); await this.closeTalk();
    this.crewSpeaks();
    if (si >= 0x14) message(0x79, si);
    else if (si === 0) { message(0x7b); await this.wait(); await this.closeTalk(); return 0; }
    else message(0x7a, si);
    await this.wait();
    this.talkClear();
    const wage = Math.trunc(eco0 / 20) + 5;
    const byMoney = Math.trunc(this.money / wage) & 0xffff;
    const mx = domUmin16(byMoney, si);
    let sum = 0; for (let i = 0; i < 10; i++) sum = (sum + free[i]) & 0xffff;
    const lim = domUmin16(mx, sum);
    message(0x22); message(0x7c, wage); message(0x7d, lim);
    const v = await this.numpad.input(0, lim);
    await this.closeTalk();
    this.payMoney(((wage * v) << 16) >> 16);
    return v;
  }
  // 257d6 把水手分配到各船 (n = 新雇用人数; 0 = 水手解雇)
  async assignCrew(n) {
    const m = this.m, { menu, message } = this.c, list = (this.c.listSel ??= new ListSelect(this.c));
    const wage = Math.trunc(m.portEconomy(this.port).commerce / 20) + 5;
    let pool = n;
    const cnt = this.fleetShips();
    for (;;) {
      const r = await list.select(0x87, cnt);
      if (r === -1) {
        if (n === 0 || pool === 0) return;
        this.crewSpeaks(); message(0x23);
        if (await menu.yesNo()) { await this.closeTalk(); this.addMoney(((domUmin16(n, pool) * wage) << 16) >> 16); return; }
        await this.closeTalk();
        continue;
      }
      const slot = this.c.persons[r], S = heroShipSlot(m, slot), ship = m.ship(S.ship);
      if (n) { await this.shipInfo(slot); pool = (pool + S.crew) & 0xffff; }
      else { this.crewSpeaks(); message(0x359, ship.nameBytes, S.crew); pool = S.crew; }
      const v = await this.numpad.input(0, domUmin16(pool, ship.maxCrew));
      if (!n) {
        if (v === S.crew) { await this.closeTalk(); continue; }
        this.talkClear(); message(0x35a, (S.crew - v) & 0xffff);
        if (!(await menu.yesNo())) { await this.closeTalk(); continue; }
        await this.closeTalk();
      }
      S.crew = v; pool = (pool - v) & 0xffff;
      if (!n) continue;
      await this.shipInfo(slot);
      await this.wait();
    }
  }
  // 256eb 船只数据 (舰船调色盘)
}

export function installTavern(proto) {
  const desc = Object.getOwnPropertyDescriptors(TavernMixin.prototype);
  delete desc.constructor;
  Object.defineProperties(proto, desc);
}
