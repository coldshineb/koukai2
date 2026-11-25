// scenario.js — 剧本事件 VM (MAIN.EXE 2e09 段 31c04..33725 的移植, 见 docs/RE_NOTES.md 第 18 节)
// 数据: assets/scenario/snrN.json (tools/snr2json.py 由 SNR*.DAT 解码, 逐字节往返验证), 消息: assets/text/snrN.json,
//       VM 常数: assets/scenario/vm.json (发言窗口表 DS:b814、文字颜色 DS:b894、随机数种子初值 DS:b890)
// 两个运行环境: 共用剧本 SNR0 (章 [0d5e], 标志 0d60, 变量 0d68) 与主角专属 SNR{主角+1} (章 [0cd4], 标志 0cd6, 变量 0cde)。
// 内存: 剧本以 DS 地址读写游戏数据 (D0/DC 取得记录地址后间接访问); 0x0ca4..0x8d18 对应 GameState, 其他地址见 rd8/wr8。
import { loadJSON } from "../core/assets.js";
import { duelFromScenario } from "../scenes/duel.js";
import { mainEnding } from "./endgame.js";
import { DS } from "../model/schema_views.ts";
import { FleetFlag, GameConst, OptionFlag, ShipSlotFlag, WorkDS } from "../model/flags.ts";
import {
  fleetShipSlot,
  heroFleet,
  setHeroMoney,
  setPortBuildDays,
  writeShipName,
} from "../model/world_helpers.ts";
import { LegacyScenarioHost } from "../ui/dos/legacy_presenter.ts";
import { ScenarioMemoryAdapter, SC_STRLEN } from "./scenario_adapter.ts";
import { calcCargoUsed, calcShipFreeCargo } from "../domain/fleet.ts";

const scS16 = v => (v << 16) >> 16;
const scUmin = (a, b) => ((a & 0xffff) > (b & 0xffff) ? b & 0xffff : a & 0xffff);   // seg0:4d7c
const scHex = h => Uint8Array.from((h.match(/../g) || []).map(x => parseInt(x, 16)));
export const ENV_COMMON = { name: "SNR0", ch: DS.COMMON_CHAP, flags: 0x0d60, vars: WorkDS.KINDS, event: 0x0de6, portMax: 0x82, addTime: false };
export const ENV_HERO = { name: "SNRn", ch: DS.HERO_CHAP, flags: 0x0cd6, vars: 0x0cde, event: 0x0d5c, portMax: 0x64, addTime: true };
const scWarned = new Set();
const scTodo = n => { if (!scWarned.has(n)) { scWarned.add(n); console.warn("尚未移植: " + n); } };

export class Scenario {
  constructor(ctx) {
    this.c = ctx;
    this.mem = ctx.scenarioMemory ?? new ScenarioMemoryAdapter(ctx, scTodo);
    this.host = ctx.scenarioHost ?? new LegacyScenarioHost(ctx, () => this.scene, {
      runDuel: (sc, person) => duelFromScenario(sc, person),
      triggerEnding: (scene, code) => mainEnding(scene, code),
    });
    this.files = {};
    this.cur = -1; this.stack = [0xff, 0xff]; this.count = 0;   // [b874] / [b878..b879] / [b877]
    this.section = null;                           // 共用的 0x4000 bytes 剧本缓冲 ([0c8c]) 目前内容
  }
  get st() { return this.c.state; }
  get m() { return this.c.state.model; }
  get extra() { return this.mem.extra; }
  get str() { return this.mem.str; }
  async init() {
    if (this.vm) return this;
    const D = this.c.scenarioData;                 // 测试时直接提供 { vm, snr: {n: doc}, mes: {n: [...]} }
    this.vm = D?.vm ?? await loadJSON(this.c.ASSETS + "/scenario/vm.json");
    this.seed = this.vm.seed0 >>> 0;               // [b890]
    this.textColor = scHex(this.vm.textColor);
    return this;
  }
  async file(n) {
    if (this.files[n]) return this.files[n];
    const D = this.c.scenarioData;
    const doc = D?.snr?.[n] ?? await loadJSON(`${this.c.ASSETS}/scenario/snr${n}.json`);
    const mes = D?.mes?.[n] ?? await loadJSON(`${this.c.ASSETS}/text/snr${n}.json`);
    for (const ch of doc.chapters) if (ch) for (const sec of ch.sections) if (sec) sec.map = new Map(sec.code.map(i => [i.at, i]));
    return (this.files[n] = { doc, mes });
  }
  // ---------------- 内存 (委派给 ScenarioMemoryAdapter) ----------------
  rd8(a) { return this.mem.rd8(a); }
  wr8(a, v) { this.mem.wr8(a, v); }
  rd16(a) { return this.mem.rd16(a); }
  wr16(a, v) { this.mem.wr16(a, v); }
  varAddr(i) { return this.env.vars + 2 * i; }
  getVar(i) { return this.rd16(this.varAddr(i)); }
  setVar(i, v) { this.wr16(this.varAddr(i), v); }
  getFlag(i) { return (this.rd8(this.env.flags + (i >> 3)) >> (i & 7)) & 1; }
  setFlag(i, on) { const a = this.env.flags + (i >> 3), m = 1 << (i & 7); this.wr8(a, on ? this.rd8(a) | m : this.rd8(a) & ~m); }
  // 32b88 来源操作数: 返回 { w: 字值, b: 低字节 }
  src(o) {
    if ("var" in o) { const a = this.varAddr(o.var); return { w: this.rd16(a), b: this.rd8(a) }; }
    if ("ptr" in o) { const a = this.getVar(o.ptr); return { w: this.rd16(a), b: this.rd8(a) }; }
    if ("flag" in o) { const v = this.getFlag(o.flag) ? 0xffff : 0; return { w: v, b: v & 0xff }; }
    return { w: o.imm & 0xffff, b: o.imm & 0xff };
  }
  // 32bf3 目的地址 (var / ptr)
  dstAddr(o) { return "var" in o ? this.varAddr(o.var) : this.getVar(o.ptr); }

  // ---------------- 事件检查 / 运行 ----------------
  // 2e09:5481 (共用) / 55c2 (主角): 返回 1 = 有事件 (PC 已设好)
  async check(env, port, building) {
    await this.init();
    const st = this.st;
    st.set16(env.event, 0);
    this.b876 = building;
    if (env === ENV_HERO && (this.m.globals.heroChap === GameConst.EMPTY_SLOT || !(this.m.globals.options & OptionFlag.SCENARIO))) return 0;
    this.env = env;
    this.fileNo = env === ENV_COMMON ? 0 : this.m.globals.hero + 1;
    this.F = await this.file(this.fileNo);
    this.chap = st.u8(env.ch); this.sec = st.u8(env.ch + 1);
    this.loadSection();
    if (!this.section) return 0;
    for (const [b1, b2, w] of this.section.index) {
      if (!(b1 === port || (port < env.portMax && b1 === 0xa3))) continue;
      if (!(b2 === building || b2 === 0xff)) continue;
      this.pc = w;
      return 1;
    }
    return 0;
  }
  // 32a90 加载目前章节 (章 = FF 或没有这章时保留缓冲原内容)
  loadSection() {
    if (this.chap === 0xff) return;
    const ch = this.F.doc.chapters[this.chap];
    if (!ch) { this.chap = 0xff; return; }
    const sec = ch.sections[this.sec];
    if (!sec) { scTodo(`劇本 ${this.F.doc.file} 章 ${this.chap} 節 ${this.sec} 不存在`); return; }
    this.section = sec; this.pc = 0;
  }
  // 2e09:53f0 / 5546
  async run(env) {
    const st = this.st, hero = this.m.heroPerson(), r = this.c.rt, old = st.u8(env.ch);
    let v = Math.imul(Math.imul(scS16(hero.navExp) + hero.navLevel, r.month), r.year) + r.day;
    if (env.addTime) v += r.time;
    this.seed = (v << 8) >>> 0;
    const ret = await this.exec();
    st.set8(env.ch, this.chap); st.set8(env.ch + 1, this.sec);
    if (env === ENV_COMMON && this.chap !== old) { st.set8(env.ch, 0); st.set8(env.ch + 1, 0); }
    return ret;
  }
  // 333db 主循环
  async exec() {
    this.nextSec = 0; this.nextChap = 0; this.ret = 1;
    for (;;) {
      const ins = this.section.map.get(this.pc);
      if (!ins) { console.error(`劇本 PC ${this.pc} 沒有解碼的指令`); break; }
      if (!(await this.step(ins))) break;
    }
    await this.closeAll();
    if (this.nextSec) { this.sec = (this.sec + 1) & 0xff; this.loadSection(); }
    if (this.nextChap) {
      this.chap = (this.chap + 1) & 0xff; this.sec = 0;
      for (let i = 0; i < 4; i++) this.wr8(this.env.flags + i, 0);
      this.loadSection();
    }
    return this.ret;
  }
  // 运行一条指令; 返回 false = 停止
  async step(ins) {
    const next = this.pc + ins.n;
    this.pc = next;
    switch (ins.k) {
      case "mov": this.mov(ins); return true;
      case "alu": this.alu(ins); return true;
      case "jmp_if_not": if (!this.cond(ins)) this.pc = ins.to; return true;
      case "goto": this.pc = ins.to; return true;
      case "stop": return false;
      case "nop": return true;
      case "next_section": this.nextSec = 1; return true;
      case "next_chapter": this.nextChap = 1; return true;
      case "return0": this.ret = 0; return true;
      case "bad": console.error("劇本不合法指令", ins); return false;
    }
    const fn = this["op_" + ins.k];
    if (!fn) { scTodo("劇本命令 " + ins.k); return true; }
    const r = await fn.call(this, ins);
    return r !== false;
  }
  // 32c39 类别 0
  mov(ins) {
    if (ins.a === "sys") {
      const n = ins.src.sys, r = this.c.rt;
      if (n === 0) { const a = this.dstAddr(ins.dst); for (let i = 0; ; i++) { const b = this.str[i]; this.wr8(a + i, b); if (!b) break; } return; }
      let v = 0;
      switch (n) {
        case 1: { const fl = heroFleet(this.m); v = Math.trunc(scS16(fl.x) / 24) + Math.trunc(scS16(fl.y) / 24) * 90; break; }
        case 2: v = r.year; break; case 3: v = r.month; break; case 4: v = r.day; break;
        case 5: v = this.m.globals.port; break; case 6: v = this.duelHp(); break; case 7: v = r.time; break;
      }
      this.setVar("var" in ins.dst ? ins.dst.var : ins.dst.ptr, v);
      return;
    }
    const s = this.src(ins.src);
    if ("flag" in ins.dst) { this.setFlag(ins.dst.flag, s.w !== 0); return; }
    const a = this.dstAddr(ins.dst);
    if (ins.a === "word") this.wr16(a, s.w);
    else if ("var" in ins.dst) this.wr16(a, s.b);
    else this.wr8(a, s.b);
  }
  // 32e23 类别 1
  alu(ins) {
    const byteDst = "ptr" in ins.dst, a = this.dstAddr(ins.dst), sv = this.src(ins.src);
    let di = byteDst ? this.rd8(a) : this.rd16(a);
    const si = "var" in ins.src ? sv.w : sv.b;
    switch (ins.fn) {
      case "add": di = di + si; break;
      case "sub": di = di - si; break;
      case "mul": di = Math.imul(di, si); break;
      case "div": if (si) di = Math.trunc((di & 0xffff) / si); else { di = 0xffff; console.error("劇本除以 0", ins); } break;
      case "or": di |= si; break;
      case "and": di &= si; break;
      case "shr": di = (di & 0xffff) >>> (si & 7); break;
      case "shl": di = di << (si & 7); break;
    }
    if (byteDst) this.wr8(a, di); else this.wr16(a, di);
  }
  // 32f5d 类别 2: 条件成立返回 true
  cond(ins) {
    if ("flag" in ins.dst) {
      const a = this.getFlag(ins.dst.flag), b = "flag" in ins.src ? this.getFlag(ins.src.flag) : ins.src.imm;
      return a === b;
    }
    const s = this.src(ins.src).w, d = this.rd16(this.dstAddr(ins.dst));
    switch (ins.cmp) { case "eq": return s === d; case "ne": return s !== d; case "ge": return s <= d; default: return s >= d; }
  }
  // ---------------- 消息 ----------------
  raw(n) { return this.c.font.encode(this.F.mes[n] ?? "{00}"); }      // 3280b 读第 n 条消息
  // 328a8 展开 $dNN / $n / $s / $rNN 到 DS:041e
  expand(n) {
    const b = this.raw(n), H = this.m.heroPerson().addr, out = [];
    const cstr = a => { for (let i = a; ; i++) { const v = this.rd8(i); if (!v) break; out.push(v); } };
    for (let i = 0; i < b.length && b[i]; ) {
      if (b[i] >= 0x80) { out.push(b[i], b[i + 1]); i += 2; continue; }
      if (b[i] !== 0x24) { out.push(b[i++]); continue; }
      const e = b[i + 1]; i += 2;
      if (e === 0x64) { const k = (b[i] - 0x30) * 10 + b[i + 1] - 0x30; i += 2; for (const ch of String(this.getVar(k))) out.push(ch.charCodeAt(0)); }
      else if (e === 0x6e) cstr(H);
      else if (e === 0x73) cstr(H + 0x0d);
      else if (e === 0x72) { const k = (b[i] - 0x30) * 10 + b[i + 1] - 0x30; i += 2; cstr(this.getVar(k)); }
      else out.push(e);
    }
    this.str.fill(0); this.str.set(out.slice(0, SC_STRLEN - 1));
  }
  // ---------------- 发言窗口 (31c04..31ed1, 委派给 IScenarioHost) ----------------
  W(i) { return this.vm.windows[i]; }
  clearText() { this.host.clearWindowText(this.W(this.cur)); }                                                      // 31c6d
  select() { this.host.selectWindow(this.W(this.cur), this.textColor); }                                            // 31c8a
  openTop() {                                                                                                       // 31cb3
    const id = this.stack[this.count - 1];
    this.host.openWindow(id, this.W(this.cur));
    if (id !== 3) this.select();
  }
  async op_win_open({ win: b }) {                                                                                  // 31d06
    if (b >= 4) return;
    if (this.cur >= 0 && this.cur !== 3) this.clearText();
    this.cur = b;
    if (this.stack[0] === b || this.stack[1] === b) { this.select(); return; }
    if (this.count >= 2) return;
    this.stack[this.count++] = b;
    this.openTop();
  }
  async closeTop() {
    const id = this.stack[this.count - 1];
    if (id === 0) this.cur = id;
    await this.host.closeWindow(id, this.W(id));
    this.count--; this.stack[this.count] = 0xff;
  }
  async op_win_close() {                                                                                           // 31d5e
    if (this.count) await this.closeTop();
    this.cur = this.count ? this.stack[this.count - 1] : -1;
  }
  async closeAll() { while (this.count) await this.closeTop(); this.cur = -1; }                                   // 31dbb
  async op_win_close_all() { await this.closeAll(); }
  async op_win_select({ win: b }) {                                                                                // 31e03
    if (b >= 4 || !(this.stack[0] === b || this.stack[1] === b)) return;
    this.cur = b; this.select();
  }
  async op_face({ face }) { if (this.cur >= 0) this.host.drawFace(face & 0xff, this.W(this.cur)); }               // 31ed1
  async op_face_var({ var: v }) { return this.op_face({ face: this.getVar(v) }); }
  async op_msg({ msg }) { this.expand(msg); this.host.showText(this.str); }                                       // 31e2e
  async op_msg_expand({ msg }) { this.expand(msg); }
  async op_wait_key() { await this.host.waitKey(); }                                                              // 0fea:490b
  // 329c6 + 31e38: 消息 (不展开) 以换行分成项目 → 0fea:44c4 (0x3c, 0x50), 不可取消
  async op_menu({ var: v, msg }) {
    const b = this.raw(msg), items = [];
    let cur = [];
    for (let i = 0; i < SC_STRLEN && i < b.length; i++) {
      if (!b[i]) break;
      if (b[i] === 0x0a) { items.push(Uint8Array.from([...cur, 0])); cur = []; continue; }
      cur.push(b[i]);
    }
    items.push(Uint8Array.from([...cur, 0]));
    const r = await this.host.selectMenu(items);
    this.setVar(v, r & 0xff);
  }
  async op_music({ song }) { this.host.playMusic(song); }    // 31e67: 9670(b); b=0x15 时 96eb(0) 关闭重播 = 只播一次 (bgm.json "once" 处理)
  async op_yes_no({ flag }) { this.setFlag(flag, await this.host.confirmYesNo()); }                               // 323df
  // ---------------- 数据 ----------------
  // 31f0b 记录地址
  recordAddr(kind, i, field) { return this.mem.recordAddr(kind, i, field); }
  colonyRead(i) { this.mem.colonyRead(i); }
  async op_addr({ var: v, kind, index, field }) { this.setVar(v, this.recordAddr(kind, index, field)); }
  async op_addr_var({ var: v, kind, index_var, field }) { this.setVar(v, this.recordAddr(kind, this.getVar(index_var) & 0xff, field)); }
  get money() { return this.m.globals.money; }
  set money(v) { setHeroMoney(this.m, v); }
  panels() { this.host.refreshPanels(); }                                                                          // seg0:8894
  async op_money_set({ var: v }) { this.money = scS16(this.getVar(v)); this.panels(); }                              // 322ac
  async op_money_add({ var: v }) { this.money = (this.money + scS16(this.getVar(v))) | 0; this.panels(); }          // 322e8
  async op_money_sub({ var: v }) {                                                                                 // 3232a
    const x = scS16(this.getVar(v)) >>> 0, m = this.money >>> 0;
    this.money = x >= m ? 0 : (m - x) | 0; this.panels();
  }
  async op_money_div10000({ var: v }) { this.setVar(v, Math.trunc(this.money / 10000)); }                          // 32426
  async op_random({ var: v, range }) {                                                                              // 32450
    if (!range) { this.setVar(v, 0); return; }
    this.seed = (Math.imul(this.seed, 0x5d588b65) + 1) >>> 0;
    this.setVar(v, ((this.seed >>> 8) & 0x7fff) % range);
  }
  async op_seed_set({ var: v }) { this.seed = (scS16(this.getVar(v)) << 8) >>> 0; }                                 // 324a4
  async op_seed_get({ var: v }) { this.setVar(v, (this.seed >>> 8) & 0xffff); }                                   // 324c2
  // 舰队
  slotView(i) { return fleetShipSlot(heroFleet(this.m), i); }
  active(i) { return (this.slotView(i).flags & ShipSlotFlag.STATE_MASK) === ShipSlotFlag.ACTIVE; }
  used(i) {                                                                                                         // seg0:5d36 船上已用的载货量
    const cs = this.m.crewSlot(i);
    const goods = Array.from({ length: GameConst.CARGO_SLOTS }, (_, k) => cs.getCargoGoods(k));
    const amts = Array.from({ length: GameConst.CARGO_SLOTS }, (_, k) => cs.getCargoAmts(k));
    return calcCargoUsed(cs.water, cs.food, cs.material, cs.ammo, goods, amts);
  }
  free(i) { return calcShipFreeCargo(this.m.ship(this.slotView(i).ship).maxCargo, this.used(i)); }
  async op_cargo_free({ var: v }) {                                                                                 // 324e7
    this.setVar(v, 0);
    for (let i = 0; i < GameConst.FLEET_SHIPS; i++) if (this.active(i)) this.setVar(v, this.getVar(v) + this.free(i));
  }
  async op_cargo_load({ var_goods, var_amount }) {                                                                  // 320d5
    const m = this.m, g = this.getVar(var_goods) & 0xff;
    let amt = this.getVar(var_amount);
    for (let i = 0; i < GameConst.FLEET_SHIPS && amt; i++) {
      if (!this.active(i)) continue;
      const free = this.free(i); if (!free) continue;
      const cs = m.crewSlot(i);
      let found = GameConst.EMPTY_SLOT;
      for (let k = 0; k < GameConst.CARGO_SLOTS; k++) {
        if (cs.getCargoGoods(k) === g) { found = k; break; }
        if (cs.getCargoGoods(k) === GameConst.EMPTY_SLOT && found === GameConst.EMPTY_SLOT) { found = k; cs.setCargoAmts(k, 0); }
      }
      if (found === GameConst.EMPTY_SLOT) continue;
      cs.setCargoGoods(found, g);
      const add = scUmin(amt, free);
      cs.setCargoAmts(found, cs.getCargoAmts(found) + add);
      amt = (amt - add) & 0xffff;
    }
  }
  async op_cargo_unload({ var_goods, var_amount }) {                                                                // 321e3
    const m = this.m, g = this.getVar(var_goods) & 0xff;
    let want = this.getVar(var_amount);
    this.setVar(var_amount, 0);
    for (let i = 0; i < GameConst.FLEET_SHIPS; i++) {
      if (!this.active(i)) continue;
      const cs = m.crewSlot(i);
      for (let k = 0; k < GameConst.CARGO_SLOTS; k++) {
        if (cs.getCargoGoods(k) !== g) continue;
        const have = cs.getCargoAmts(k), take = scUmin(want, have), nextAmt = (have - take) & 0xffff;
        cs.setCargoAmts(k, nextAmt); want = (want - take) & 0xffff;
        if (!nextAmt) cs.setCargoGoods(k, GameConst.EMPTY_SLOT);
        this.setVar(var_amount, this.getVar(var_amount) + nextAmt);
      }
    }
  }
  // 3254c 获得新船 (船型 type; 第二个参数未使用)
  async op_ship_new({ type }) {
    const m = this.m, stype = m.shipType(type), tmpl = m.ship(type + 0x28);
    let slot = 0;
    for (; slot < GameConst.FLEET_SHIPS; slot++) {
      const f = this.slotView(slot).flags & ShipSlotFlag.STATE_MASK;
      if (f !== ShipSlotFlag.ACTIVE && f !== ShipSlotFlag.BUILDING) break;
    }
    const sv = this.slotView(slot);
    const cs = slot < GameConst.FLEET_SHIPS ? m.crewSlot(slot) : null;
    if (!cs) scTodo("劇本新船: 艦隊已滿");
    let n = 0; for (; n < 0x28; n++) if (m.ship(n).type === GameConst.EMPTY_SLOT) break;
    if (n === 0x28) n = 0;
    const ship = m.ship(n), crew = Math.trunc(9 * stype.durability / 10);
    sv.maxDurability = crew; sv.durability = crew; sv.turn = stype.turn; sv.propulsion = stype.propulsion;
    sv.guns = 0; sv.crew = 0; sv.ship = n; sv.flags = ShipSlotFlag.BUILDING;
    if (cs) {
      cs.water = 0; cs.food = 0; cs.material = 0; cs.ammo = 0;
      cs.navRatio = 0x19; cs.lookRatio = 0x32; cs.captain = m.globals.port | 0x80; cs.loadTotal = 0;
      for (let k = 0; k < GameConst.CARGO_SLOTS; k++) { cs.setCargoGoods(k, GameConst.EMPTY_SLOT); cs.setCargoAmts(k, 0); }
    }
    ship.maxGuns = tmpl.maxGuns; ship.type = type; ship.flags = tmpl.flags; ship.maxCrew = tmpl.maxCrew;
    ship.maxCargo = stype.capacity - ship.maxGuns - ship.maxCrew;
    setPortBuildDays(m.portEconomy(m.globals.port), 0);
  }
  // 32694 新船命名 (名字 = 消息 msg 展开); 船长 = 0fea:2f43 名单第一人
  async op_ship_name({ msg }) {
    const m = this.m;
    this.expand(msg);
    const cap = this.captainCandidate();
    let slot = 0; for (; slot < GameConst.FLEET_SHIPS; slot++) if ((this.slotView(slot).flags & ShipSlotFlag.STATE_MASK) === ShipSlotFlag.BUILDING) break;
    const sv = this.slotView(slot), cs = slot < GameConst.FLEET_SHIPS ? m.crewSlot(slot) : null, ship = m.ship(sv.ship);
    sv.flags = (sv.flags & ~ShipSlotFlag.BUILDING) | ShipSlotFlag.ACTIVE;
    if (cs) {
      cs.captain = cap;
      m.person(cap).role = cap === m.globals.hero ? 1 : 2;
    }
    setPortBuildDays(m.portEconomy(m.globals.port), GameConst.EMPTY_SLOT);
    writeShipName(ship, this.str);
    const fl = heroFleet(m);
    if (!this.host.recalcFleetStrength(fl.addr)) scTodo("劇本新船命名後的 0fea:83f9 (艦隊重算)");                       // 0fea:83f9 = 18299
  }
  // 0fea:2f43 = 12de3: 主角没有担任任何船的船长时列入主角, 再列入职务 > 2 的船员 → [0538]; 名单为空时 [0538] 不变
  captainCandidate() {
    const m = this.m, L = [];
    let k = 0; for (; k < GameConst.FLEET_SHIPS; k++) if (m.crewSlot(k).captain === m.globals.hero) break;
    if (k === GameConst.FLEET_SHIPS) L.push(m.globals.hero);
    for (let i = 0; i < GameConst.PARTY_SLOTS; i++) { const n = m.partyCrew(i); if (n !== GameConst.EMPTY_SLOT && m.person(n).role > 2) L.push(n); }
    this.c.persons ??= [];
    for (let i = 0; i < L.length; i++) this.c.persons[i] = L[i];
    return this.c.persons[0] & 0xff;
  }
  async op_crew_join({ person }) {                                                                                  // 3273a
    const m = this.m;
    for (let i = 0; i < GameConst.PARTY_SLOTS; i++) if (m.partyCrew(i) === GameConst.EMPTY_SLOT) { m.setPartyCrew(i, person); break; }
    const pv = m.person(person), hv = m.heroPerson();
    pv.role = 6; pv.fleet = hv.fleet; pv.stayPort = hv.stayPort;
  }
  async op_barmaid_love({ girl, amount }) { const bm = this.m.barmaid(girl); bm.affection = scUmin(bm.affection + amount, 100); }   // 32790
  // 320ba D1 v: 变量的低字节 = 舰队编号 → 33aaf 依任务恢复目的地 (game/fleetai.js resume)
  async op_d1({ var: v }) { const k = this.getVar(v) & 0xff; if (!this.host.resumeFleet(this.m.fleet(k).addr)) scTodo("劇本命令 D1 (艦隊移動 33aaf)"); }
  // 32377 E8 一骑打: 31dbb → 0fea:2ca9(1, 主角, 对手) → 外框 / 8894 / 8ebc([b876]) / 99e8 (scenes/duel.js)
  async op_duel({ person }) { await this.host.runDuel(this, person); }
  // 系统变量 6 (32d4a) = [9c2a] 一骑打的体力条 (海战的 DS 镜像; 还没有时是 MAIN.EXE 的初值)
  duelHp() {
    if (this.c.battleDS) return this.c.battleDS[0x9c2a];
    const h = (this.scene?.P ?? {}).battle?.ds?.["9bfe"]; return h ? parseInt(h.substr((0x9c2a - 0x9bfe) * 2, 2), 16) : 0;
  }
  // 331e4 CB w1 w2 b → 31e81: 关闭 [03d8], 开 DS:0a82「EVENT*.DAT」(* = [0a89], 1681a 设为 '1' + 主角), seg0:5b5d 画第 b 张于 (w1, w2), 关闭, [03d8] = GRAPH.DAT
  //   (第 31 节; 不动调色盘, 画在前一条 C0 3 开的大框里)
  async op_picture({ x, y, pic }) { await this.host.showPicture(x, y, pic); }
  // 330c1 F4 b → 0fea:77af(b) 剧本结局 (b = 主角 0..5; game/endgame.js, 之后由 main.js 运行 END.EXE 的移植)
  async op_ending({ code }) { await this.host.triggerEnding(code & 0xff); return false; }
}
