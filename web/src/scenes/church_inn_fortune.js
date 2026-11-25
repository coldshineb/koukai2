// church_inn_fortune.js — 旅馆 (4) / 教会 (10) / 占卜师 (11)
import { GameConst } from "../model/flags.ts";
import { WorldConst } from "../model/world_helpers.ts";
import { hasDom } from "../ui/modals.ts";
import { runDomInnWorkbench, runDomChurchWorkbench, runDomFortuneWorkbench } from "../ui/buildings_panel.ts";

const cifHex = s => { const b = Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16))), o = new Uint8Array(b.length + 1); o.set(b); return o; };
const B_SUPPORT_FMT = Uint8Array.of(0x25, 0x2d, 0x31, 0x34, 0x73, 0x20, 0x25, 0x33, 0x64, 0x25, 0x25, 0); // DS:b0ba "%-14s %3d%%"
const B_STAR = Uint8Array.of(0x2a, 0);                                           // DS:b0c6
const B_SUPPORT_HDR = cifHex("9361995398f8"), B_ALLY_HDR = cifHex("946da357a0aa"); // DS:b0ac「支持度」/ b0b3「同盟港」

class ChurchInnFortuneMixin {
  // ================= 4 旅馆 1fd9:8f84 =================
  async inn() {
    const { sys } = this.c, m = this.m;
    this.c.randomParts = sys.rng.random(0x3fff) | 0xc000;              // [bdc6]
    if (hasDom() && this.c.codec) {
      await runDomInnWorkbench(this);
      return;
    }
    if (this.noEvent()) this.greet(0x42);
    const items = this.c.menuItems(4);
    let sel;
    do {
      for (let i = 0; i < WorldConst.TOTAL_COUNTRIES; i++) if (m.country(i).capitalPort === this.port) this.c.menu.disabled = 2;
      sel = await this.menu(items);
      if (sel !== 0xff) await [() => this.innChat(), () => this.innSupport(), () => this.innSleep()][sel]();
      this.after();
    } while (sel !== 0xff && sel !== 2);
  }
  // 1fd9:8e73 (线性 28c03) 与航海者闲聊: 清单 0x86 → 对象发言 (7f06) → 28a7b → 796d, 直到没有人或 Esc
  async innChat() {
    const list = this.listSel();
    for (let n = await this.innChatList(); n; n = await this.innChatList()) {
      this.after();                                                        // 0fea:b6e0
      const r = await list.select(0x86, n);
      if (r === -1) return;
      const who = this.c.persons[r] & 0xff;
      this.talkPerson(who);
      await this.innTalk(who);
      await this.closeTalk();
    }
  }
  // 28a7b 旅馆的航海者: 同舰队 → 0x45..0x47; 舰队 0x3c..0x45 → 0x35b/0x35c; 否则 0x48 → 自我介绍 (0x49 船长 / 0x4a 其他 / 0x4b 无所属)
  //   → MENU #3 前两项 (航海者情报 264a0 / 雇用 26708 (不要求好感)), DS:b0a4
  async innTalk(n) {
    const m = this.m, { message, sys } = this.c, hero = m.heroPerson(), mate = m.person(n);
    this.mateNo = n; this.mate = mate.addr;                               // [b0a2]→[bb38], [bd8c]→[aeea]
    const f = mate.fleet;
    if (hero.fleet === f) { message(0x45 + sys.rng.random(3)); await this.wait(); return 0; }
    if (f < 0x46 && f >= 0x3c) { message(0x35b + sys.rng.random(2)); await this.wait(); return 1; }
    message(0x48); await this.wait();
    this.talkClear();
    if (f === GameConst.EMPTY_SLOT) message(0x4b);
    else {
      const kinds = this.c.menuItems(2), r = f % 10, kind = kinds[r ? Math.trunc(r / 5) + 1 : 0], nation = this.p.nations[Math.trunc(f / 10)];
      if (mate.role === 1) message(0x49, nation, kind, mate.givenNameBytes);
      else message(0x4a, nation, kind, this.T.crewRoles[mate.role], mate.givenNameBytes);
    }
    const sel = await this.menu(this.c.menuItems(3).slice(0, 2));            // 「决斗」不在旅馆 (bl = 2)
    if (sel !== 0xff) await [() => this.mateInfo(), () => this.mateHire(0)][sel]();
    return 1;
  }
  // 28a16
  async innChatList() {
    const { win } = this.c;
    const n = this.portPersons();
    if (n && this.c.persons[0] !== 0xff) return n;
    if (!n) { this.crewSpeaks(); this.c.message(0x43); }
    else { this.talkFace(this.m.port(this.port).region & 7, this.c.randomParts); this.c.message(0x44); }
    await this.wait();
    await win.close();
    return 0;
  }
  // 1fd9:8ec3 海港支持度
  async innSupport() {
    const { con, printf } = this.c, m = this.m, eco = m.portEconomy(this.port), port = m.port(this.port);
    this.table();
    con.setCursor(0x23, 0x98); con.puts(B_SUPPORT_HDR);
    con.setCursor(0x2b, 0x98); con.puts(B_ALLY_HDR);
    for (let i = 0; i < WorldConst.TOTAL_COUNTRIES; i++) {
      con.setCursor(0x15, (i + 11) << 4);
      printf(B_SUPPORT_FMT, this.p.nations[i], eco.getInfluence(i));
      if ((port.region & WorldConst.PORT_OWNER_MASK) === i) { con.setCursor(0x2d, (i + 11) << 4); con.puts(B_STAR); }
    }
    await this.wait();
  }
  // 1fd9:8eb8 就寝
  async innSleep() { this.m.globals.dailyFlags |= 0x80; await this.c.palette.fadeBlack(); }
  // ================= 10 教会 1fd9:cede =================
  async church() {
    const m = this.m;
    this.worship = 1;                                                    // [c2d2]
    const nation = m.heroPerson().face & 15;
    this.mosque = this.p.colonyChurch() ? 1 : 0;                         // [bda0] = CHIP_NO.DAT[港] == 2
    if (!this.mosque && nation === 2) { this.greet(0x5a); await this.wait(); return; }
    if (this.mosque && nation !== 2) { this.greet(0x322); await this.wait(); return; }
    const base = this.mosque * 0x2c8, items = this.c.menuItems(7);    // 2cbdb
    if (hasDom() && this.c.codec) {
      await runDomChurchWorkbench(this, base);
      return;
    }
    if (this.noEvent()) this.greet(base + 0x5b);
    let sel;
    do {
      sel = await this.menu(items);
      if (sel !== 0xff) await [() => this.pray(base), () => this.donate(base)][sel]();
      this.after();
    } while (sel !== 0xff);
    this.greet(base + 0x60);
    await this.wait();
    this.after();
  }
  async pray(base) {                                                     // 1fd9:ccfa
    this.greet(base + 0x5c);
    if (this.worship) {
      const hero = this.m.heroPerson(), v = this.c.sys.rng.random(2) + hero.getStats(7);
      hero.setStats(7, Math.min(100, v));
      this.worship = 0;
    }
    await this.wait();
  }
  async donate(base) {                                                   // 1fd9:cd40
    this.greet(base + 0x5d);
    const amt = await this.numpad.input(0, this.money);
    if (!amt) return;
    const ratio = Math.trunc(this.money / amt) | 0;
    if (ratio > 10) this.greet(base + 0x5e);
    else {
      this.greet(base + 0x5f);
      const r = ((this.c.sys.rng.random(5) + 1) * 100) & 0xffff;
      if (amt >= r) { const hero = this.m.heroPerson(); hero.setStats(7, Math.min(100, (hero.getStats(7) - ratio + 0x0b) & 0xffff)); }
    }
    this.money = (this.money - amt) | 0;
    await this.wait();
  }
  // ================= 11 占卜师 1fd9:d647 =================
  async fortune() {
    if (hasDom() && this.c.codec) {
      await runDomFortuneWorkbench(this);
      return;
    }
    const { menu } = this.c;
    if (this.noEvent()) this.greet(0x12a);
    const items = this.c.menuItems(17);
    let sel;
    do {
      if (!this.crewCount()) menu.disabled |= 8;                         // 0fea:2f1b
      if (this.m.globals.hero === 1) menu.disabled |= 4;
      sel = await this.menu(items);
      if (sel !== 0xff) {
        this.greet(0x12b);
        if (await menu.yesNo()) {
          if (this.money < 0x32) { this.greet(0x12c); await this.wait(); sel = 0xff; }
          else {
            this.money = (this.money - 0x32) | 0;
            this.greet(0x12d); await this.wait();
            await [() => this.fLife(), () => this.fCareer(), () => this.fLove(), () => this.fFriend()][sel]();
          }
        }
      }
      this.after();
    } while (sel !== 0xff);
  }
  // 0fea:2f1b = 12dbb: 舰队船员 [2e1b] → [0538]
  crewCount() {
    const m = this.m, L = [];
    for (let i = 0; i < GameConst.PARTY_SLOTS; i++) { const v = m.partyCrew(i); if (v !== GameConst.EMPTY_SLOT) L.push(v); }
    this.setPersons(L); return L.length;
  }
  async fLife() { this.greet(Math.trunc(this.m.heroPerson().getStats(7) / 0x19) + 0x12e); await this.wait(); }   // 1fd9:d480
  // 0fea:bce4 = 1bb84 下一级所需经验 = min(等级, 18)² × 30
  static expNeed(lv) { const m = Math.min(lv, 0x12); return (m * m * 30) & 0xffff; }
  async fCareer() {                                                      // 1fd9:d49f
    const m = this.m, hero = m.heroPerson(), hd = m.heroInfo();
    this.greet(0x221, (Buildings.expNeed(hero.navLevel) - hero.navExp) << 16 >> 16); await this.wait();
    this.greet(0x222, (Buildings.expNeed(hero.battleLevel) - hero.battleExp) << 16 >> 16); await this.wait();
    if ((hero.face & 15) === 6) return;
    const fame = Math.max(hd.tradeFame, hd.pirateFame, hd.adventureFame);
    const need = this.p.P.data.titleFame[hd.rank];                       // DS:b49a
    if (need > fame) this.greet(0x223, (need - fame) & 0xffff); else this.greet(0x2f2);
    await this.wait();
  }
  async fLove() {                                                        // 1fd9:d559
    const m = this.m; let found = -1, rec = null;
    for (let i = 0; i < 0x1e; i++) {
      const bm = m.barmaid(i);
      if (bm.port === this.port && (bm.flags & 8) && !(bm.flags & 0x40)) { found = i; rec = bm; break; }
    }
    if (found < 0) this.greet(0x149);
    else if (rec.affection >= 0x50) this.greet(0x146, rec.nameBytes);
    else this.greet(rec.affection >= 0x32 ? 0x147 : 0x148);
    await this.wait();
  }
  // 1fd9:d5d4 (线性 2d364) 朋友运: 船员清单 0x89 → 0x4e + 运气 (+23) / 25, 0x319 + 忠诚 (+2b) / 25
  async fFriend() {
    this.greet(0x318); await this.wait();
    const n = this.crewCount();
    if (!n) return;
    const r = await this.listSel().select(0x89, n);
    if (r === -1) return;
    const p = this.m.person(this.c.persons[r] & 0xff);
    this.greet(0x4e + Math.trunc(p.getStats(7) / 0x19)); await this.wait();
    this.greet(0x319 + Math.trunc(p.loyalty / 0x19)); await this.wait();
  }
}

export function installChurchInnFortune(proto) {
  const desc = Object.getOwnPropertyDescriptors(ChurchInnFortuneMixin.prototype);
  delete desc.constructor;
  Object.defineProperties(proto, desc);
}
