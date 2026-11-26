// office.js — 事务所 (MAIN.EXE 1fd9:d40f = 线性 2d19f, 处理函数表 DS:a612[6]); 见 RE_NOTES 25
// MENU #1 (工作介绍/各国情报), 子功能 DS:b48a = 2ce01 / 2d0b1
// 共用剧本 SNR0 的工作状态: globals.commonChap / commonSec / WorkDS.*
import { Scenario, ENV_COMMON } from "../game/scenario.js";
import { GameConst, TreatyFlag } from "../model/flags.ts";
import { getCountryExtra, getWorkState } from "../model/world_helpers.ts";
import { getBuildingArtUrl, hasDom } from "../ui/modals.ts";
import { runDomOfficeWorkbench } from "../ui/buildings/office.ts";

const ofHex = s => { const b = Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16))), o = new Uint8Array(b.length + 1); o.set(b); return o; };
const ofS16 = v => (v << 16) >> 16;

export class Office {
  constructor(b) {
    this.b = b; const D = b.p.P.data.bld2;
    this.F = Object.fromEntries(Object.entries(D.fmt).map(([k, v]) => [k, ofHex(v)]));
    this.jobs = D.jobs.map(ofHex); this.nations = D.nations.map(ofHex);
  }
  get c() { return this.b.c; }
  get st() { return this.b.st; }
  get m() { return this.b.st.model; }
  portName(q) { return this.m.port(q & 0xff).nameBytes; }

  // ================= 入口 2d19f =================
  async run() {
    if (hasDom() && this.c.codec) {
      await runDomOfficeWorkbench(this);
      return;
    }
    const b = this.b;
    if (b.noEvent()) b.greet(0x55);
    let sel;
    do {
      sel = await b.menu(this.c.menuItems(1).slice(0, 2));
      if (sel !== 0xff) await [() => this.jobsMenu(), () => this.nationInfo()][sel]();
      b.after();
    } while (sel !== 0xff);
  }
  // 剧本 2e09:5481 / 53f0 (共用 SNR0)
  async event(building) {
    if (this.c.noEvents) return 0;
    const sc = (this.c.events ??= new Scenario(this.c)); sc.scene = this.b.p;
    if (!(await sc.check(ENV_COMMON, this.b.port, building))) return 0;
    this.c.scenarioFallbackArtUrl = hasDom() ? getBuildingArtUrl(this.c, building, this.b.p) : null;
    try {
      await sc.run(ENV_COMMON);
    } finally {
      this.c.scenarioFallbackArtUrl = null;
    }
    return 1;
  }
  // 2ce01 工作介绍
  async jobsMenu() {
    const b = this.b, m = this.m, g = m.globals, w = getWorkState(m);
    if (g.commonChap) {                                                          // 正在运行工作
      if (ofS16(w.curKind) < 6) {
        const tp = w.targetPort & 0xff;
        if (tp === b.port) b.greet(0x3a3); else b.greet(0x152, this.portName(tp));
        await b.wait(); return;
      }
      return this.jobHint();
    }
    if ((w.flags & 3) === 3) {
      b.greet(0x19a + (m.heroPerson().face & 0x0f)); this.c.message(0x3a4);      // 「某国王好像正在找你」
      await b.wait(); return;
    }
    const kind = [], items = [];
    for (let i = 0; i < 3; i++) { kind[i] = w.kindAt(i) & 0xff; items[i] = this.jobs[kind[i]]; }
    let sel;
    do {
      sel = await b.menu(items);
      if (sel === 0xff) break;
      g.commonSec = (kind[sel] + 1) & 0xff;
      w.curParam = w.paramAt(sel);
      if (await this.event(6)) g.commonChap = w.curKind & 0xff;
      g.commonSec = 0;
    } while (!g.commonChap);
  }
  // 2ccb8 运行工作中的提示 (只有工作种类 0x0b 且还没拿到目标道具时)
  async jobHint() {
    const b = this.b, m = this.m, w = getWorkState(m), { sys } = this.c;
    let dx = 1;
    if (w.curKind === 0x0b) {
      const t = w.targetItem;
      for (let i = 0; i < GameConst.INV_SLOTS; i++) { const v = m.inventory(i); if (((v - t) & 0xff) === 0xf6 || v === t) { dx = 0; break; } }
    }
    if (!dx || w.curKind !== 0x0b) { b.greet(0x253); await b.wait(); return; }
    if (w.targetPort === 0xff) w.targetPort = sys.rng.random(0x2a);
    const item = m.item(w.targetItem).nameBytes;
    if ((w.targetPort & 0xff) === b.port) {
      if (w.targetPerson === 0xff) {
        const far = sys.rng.random(w.randRange + 1) !== 0;                      // 0 = 欧洲港 (< 0x2a) 的人物
        for (;;) {
          w.targetPerson = sys.rng.random(0x29) + 0x4f;
          const q = m.person(w.targetPerson & 0xff).stayPort;
          if (q === 0xff) continue;
          if (far ? q >= 0x2a : q < 0x2a) break;
        }
      }
      const p = m.person(w.targetPerson & 0xff);
      b.greet(0x254, item, p.givenNameBytes, p.familyNameBytes); await b.wait();
      b.greet(0x255); await b.wait(); return;
    }
    const q = w.targetPort & 0xff, port = m.port(q);
    b.greet(0x256, item, port.nameBytes); await b.wait();
    b.greet(0x258, port.nameBytes);
    b.latLong(port.x, port.y);                                                   // 253b4
    this.c.message(0x259);
    await b.wait();
  }
  // 2d0b1 各国情报 (100 枚金币)
  async nationInfo() {
    const b = this.b, m = this.m;
    b.greet(0xa2);
    const n = await b.menu(this.nations.slice(0, 6));
    if (n === 0xff) return;
    const cx = getCountryExtra(m.country(n));
    b.greet(0x56);
    if (!(await this.c.menu.yesNo())) { b.greet(0x57); await b.wait(); return; }
    if (b.money < 100) { b.greet(0xa3); await b.wait(); return; }
    b.money = (b.money - 100) | 0;
    b.p.panels();                                                                // 8894
    b.table();                                                                   // 0fea:b6bc
    this.nationTable(n);
    const rival = cx.rival;
    if (rival < 7) b.greet(0x58, this.nations[n], this.nations[rival]);
    else b.greet(0x355, this.nations[n]);
    await b.wait();
    b.greet(0x59, this.portName(cx.keyPort));
    await b.wait();
  }
  // 2cf1e 国家表: 收益、主角对该国的贡献度 (100 − 声望, 不足 100 时以色 2 显示)、对其他 5 国的友好关系 (30 − 值) 与同盟/封锁
  nationTable(n) {
    const m = this.m, { con, printf } = this.c, F = this.F, country = m.country(n), hd = m.heroInfo();
    con.puts(F.nColor);
    con.setCursor(0x15, 0x90);
    printf(F.income, country.power);
    const standing = hd.getCountryStanding(n);
    if (standing < 100) con.puts(F.minus);
    printf(F.num4, Math.abs(ofS16(100 - standing)));
    con.setCursor(0x15, 0xa0); con.puts(F.friendHdr);
    con.setCursor(0x28, 0xb0); con.puts(F.allyHdr);
    let row = 0;
    for (let i = 0; i < 6; i++) {
      if (i === n) continue;
      const y = (row + 12) << 4;
      con.setCursor(0x15, y);
      printf(F.nation14, this.nations[i]);
      const rel = country.getRelations(i);
      if (rel < 0x1e) con.puts(F.minus2);
      printf(F.num4b, Math.abs(ofS16(0x1e - rel)));
      const treaty = country.getTreaties(i);
      if (treaty & TreatyFlag.ALLY) { con.setCursor(0x29, y); con.puts(F.ally); }
      if (treaty & TreatyFlag.BLOCKADE) { con.setCursor(0x2e, y); con.puts(F.block); }
      row++;
    }
  }
}
