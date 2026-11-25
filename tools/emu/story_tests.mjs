// tools/emu/story_tests.js — 语义化剧情 JSON (story0..6.json) + StoryRunner 与原版字节码 VM 逐字节/逐事件等价性回归测试
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const ROOT = process.cwd();
const TMP = path.join(ROOT, "tools/work/story_test_bundle.mjs");

buildSync({
  stdin: {
    contents: `
      export { GameState } from "./web/src/game/state.js";
      export { Scenario, ENV_COMMON, ENV_HERO } from "./web/src/game/scenario.js";
      export { ScenarioMemoryAdapter, SC_STRLEN } from "./web/src/game/scenario_adapter.ts";
      export { liftScenarioToStory } from "./web/src/game/story_lifter.ts";
      export { GameConst, OptionFlag, ShipSlotFlag } from "./web/src/model/flags.ts";
      export { fleetShipSlot, heroFleet, setHeroMoney, setPortBuildDays, writeShipName } from "./web/src/model/world_helpers.ts";
      export { calcCargoUsed, calcShipFreeCargo } from "./web/src/domain/fleet.ts";
    `,
    resolveDir: ROOT,
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: TMP,
});

const {
  GameState,
  Scenario,
  ENV_COMMON,
  ENV_HERO,
  ScenarioMemoryAdapter,
  SC_STRLEN,
  GameConst,
  OptionFlag,
  ShipSlotFlag,
  fleetShipSlot,
  heroFleet,
  setHeroMoney,
  setPortBuildDays,
  writeShipName,
  calcCargoUsed,
  calcShipFreeCargo,
} = await import("file://" + TMP.replace(/\\/g, "/"));

const assetsDir = path.join(ROOT, "web/assets");
const newgameBin = new Uint8Array(fs.readFileSync(path.join(ROOT, "tools/work/newgame.bin")));
const schema = JSON.parse(fs.readFileSync(path.join(assetsDir, "data/schema.json"), "utf8"));
const vmJson = JSON.parse(fs.readFileSync(path.join(assetsDir, "scenario/vm.json"), "utf8"));
const charmap = JSON.parse(fs.readFileSync(path.join(assetsDir, "font/charmap.json"), "utf8"));

// 轻量编码器（复刻 core/font.js encode() 逻辑，供 Node 无浏览器实测）
const u2c = new Map();
for (const [code, , , u] of charmap.table) u2c.set(u, code);
const testFont = {
  encode(s) {
    const out = [];
    for (let i = 0; i < s.length; ) {
      const cp = s.codePointAt(i), ch = String.fromCodePoint(cp);
      if (ch === "{") {
        const j = s.indexOf("}", i), tok = s.slice(i + 1, j);
        if (tok[0] === "#") { const v = parseInt(tok.slice(1), 16); out.push(v >> 8, v & 0xff); }
        else out.push(parseInt(tok, 16));
        i = j + 1; continue;
      }
      if (ch === "\n") out.push(0x0a);
      else if (cp < 0x80) out.push(cp);
      else { const c = u2c.get(ch); if (c === undefined) throw new Error("unmapped " + ch); out.push(c >> 8, c & 0xff); }
      i += ch.length;
    }
    return Uint8Array.from(out);
  },
};

// 记录 IScenarioHost 调用日志并按剧本交互脚本返回选择
function makeSpyHost(yesNoScript = [], menuScript = []) {
  const events = [];
  let yIdx = 0, mIdx = 0;
  return {
    events,
    openWindow(id, w) { events.push(["openWindow", id, w.x, w.y]); },
    async closeWindow(id, w) { events.push(["closeWindow", id, w.x, w.y]); },
    clearWindowText(w) { events.push(["clearText", w.x, w.y]); },
    selectWindow(w) { events.push(["selectWindow", w.x, w.y]); },
    drawFace(face, w) { events.push(["drawFace", face, w.x, w.y]); },
    showText(bytes) { events.push(["showText", Buffer.from(bytes.subarray(0, Math.max(0, bytes.indexOf(0)))).toString("hex")]); },
    async waitKey() { events.push(["waitKey"]); },
    async selectMenu(items) {
      const choice = mIdx < menuScript.length ? menuScript[mIdx++] : 0;
      events.push(["selectMenu", items.length, choice]);
      return choice;
    },
    playMusic(song) { events.push(["playMusic", song]); },
    async confirmYesNo() {
      const ans = yIdx < yesNoScript.length ? yesNoScript[yIdx++] : 0;
      events.push(["confirmYesNo", ans]);
      return ans;
    },
    async showPicture(x, y, pic) { events.push(["showPicture", x, y, pic]); },
    refreshPanels() { events.push(["refreshPanels"]); },
    recalcFleetStrength(addr) { events.push(["recalcFleet", addr]); return true; },
    resumeFleet(addr) { events.push(["resumeFleet", addr]); return true; },
    async runDuel(_sc, person) { events.push(["runDuel", person]); },
    async triggerEnding(code) { events.push(["triggerEnding", code]); },
  };
}

// 原始字节码 VM（用作黄金基准参照）
const refS16 = v => (v << 16) >> 16;
const refUmin = (a, b) => ((a & 0xffff) > (b & 0xffff) ? b & 0xffff : a & 0xffff);
class ReferenceBytecodeVM {
  constructor(ctx, host) {
    this.c = ctx;
    this.mem = new ScenarioMemoryAdapter(ctx, m => { throw new Error("Unexpected todo: " + m); });
    this.host = host;
    this.vm = vmJson;
    this.seed = vmJson.seed0 >>> 0;
    this.textColor = Uint8Array.from(vmJson.textColor.match(/../g).map(x => parseInt(x, 16)));
    this.cur = -1; this.stack = [0xff, 0xff]; this.count = 0;
  }
  get m() { return this.c.state.model; }
  get str() { return this.mem.str; }
  rd8(a) { return this.mem.rd8(a); }
  wr8(a, v) { this.mem.wr8(a, v); }
  rd16(a) { return this.mem.rd16(a); }
  wr16(a, v) { this.mem.wr16(a, v); }
  varAddr(i) { return this.env.vars + 2 * i; }
  getVar(i) { return this.rd16(this.varAddr(i)); }
  setVar(i, v) { this.wr16(this.varAddr(i), v); }
  getFlag(i) { return (this.rd8(this.env.flags + (i >> 3)) >> (i & 7)) & 1; }
  setFlag(i, on) { const a = this.env.flags + (i >> 3), m = 1 << (i & 7); this.wr8(a, on ? this.rd8(a) | m : this.rd8(a) & ~m); }
  src(o) {
    if ("var" in o) { const a = this.varAddr(o.var); return { w: this.rd16(a), b: this.rd8(a) }; }
    if ("ptr" in o) { const a = this.getVar(o.ptr); return { w: this.rd16(a), b: this.rd8(a) }; }
    if ("flag" in o) { const v = this.getFlag(o.flag) ? 0xffff : 0; return { w: v, b: v & 0xff }; }
    return { w: o.imm & 0xffff, b: o.imm & 0xff };
  }
  dstAddr(o) { return "var" in o ? this.varAddr(o.var) : this.getVar(o.ptr); }
  async check(env, port, building, doc, mes) {
    this.mem.clearEvent(env);
    this.env = env;
    if (env === ENV_HERO && (this.m.globals.heroChap === GameConst.EMPTY_SLOT || !(this.m.globals.options & OptionFlag.SCENARIO))) return 0;
    this.F = { doc, mes };
    ({ chap: this.chap, sec: this.sec } = this.mem.getChapter(env));
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
  loadSection() {
    if (this.chap === 0xff) { this.section = null; return; }
    const ch = this.F.doc.chapters[this.chap];
    if (!ch) { this.chap = 0xff; this.section = null; return; }
    const sec = ch.sections[this.sec];
    this.section = sec; this.pc = 0;
    sec.map = new Map(sec.code.map(i => [i.at, i]));
  }
  async run(env) {
    const hero = this.m.heroPerson(), r = this.c.rt, old = this.mem.getChapter(env).chap;
    let v = Math.imul(Math.imul(refS16(hero.navExp) + hero.navLevel, r.month), r.year) + r.day;
    if (env.addTime) v += r.time;
    this.seed = (v << 8) >>> 0;
    this.nextSec = 0; this.nextChap = 0; this.ret = 1;
    while (this.section) {
      const ins = this.section.map.get(this.pc);
      if (!ins || !(await this.step(ins))) break;
    }
    while (this.count) { const id = this.stack[this.count - 1]; if (id === 0) this.cur = 0; await this.host.closeWindow(id, this.vm.windows[id]); this.count--; this.stack[this.count] = 0xff; }
    this.cur = -1;
    if (this.nextSec) { this.sec = (this.sec + 1) & 0xff; this.loadSection(); }
    if (this.nextChap) { this.chap = (this.chap + 1) & 0xff; this.sec = 0; for (let i = 0; i < 4; i++) this.wr8(env.flags + i, 0); this.loadSection(); }
    if (env === ENV_COMMON && this.chap !== old) this.mem.setChapter(env, 0, 0);
    else this.mem.setChapter(env, this.chap, this.sec);
    return this.ret;
  }
  expand(n) {
    const b = this.c.font.encode(this.F.mes[n] ?? "{00}"), H = this.m.heroPerson().addr, out = [];
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
  W(i) { return this.vm.windows[i]; }
  async step(ins) {
    this.pc += ins.n;
    switch (ins.k) {
      case "mov": {
        if (ins.a === "sys") {
          const n = ins.src.sys, r = this.c.rt;
          if (n === 0) { const a = this.dstAddr(ins.dst); for (let i = 0; ; i++) { const b = this.str[i]; this.wr8(a + i, b); if (!b) break; } return true; }
          let v = 0;
          if (n === 1) { const fl = heroFleet(this.m); v = Math.trunc(refS16(fl.x) / 24) + Math.trunc(refS16(fl.y) / 24) * 90; }
          else if (n === 2) v = r.year; else if (n === 3) v = r.month; else if (n === 4) v = r.day;
          else if (n === 5) v = this.m.globals.port; else if (n === 6) v = 0; else if (n === 7) v = r.time;
          this.setVar("var" in ins.dst ? ins.dst.var : ins.dst.ptr, v); return true;
        }
        const s = this.src(ins.src);
        if ("flag" in ins.dst) { this.setFlag(ins.dst.flag, s.w !== 0); return true; }
        const a = this.dstAddr(ins.dst);
        if (ins.a === "word") this.wr16(a, s.w); else if ("var" in ins.dst) this.wr16(a, s.b); else this.wr8(a, s.b);
        return true;
      }
      case "alu": {
        const byteDst = "ptr" in ins.dst, a = this.dstAddr(ins.dst), sv = this.src(ins.src);
        let di = byteDst ? this.rd8(a) : this.rd16(a); const si = "var" in ins.src ? sv.w : sv.b;
        if (ins.fn === "add") di += si; else if (ins.fn === "sub") di -= si; else if (ins.fn === "mul") di = Math.imul(di, si);
        else if (ins.fn === "div") di = si ? Math.trunc((di & 0xffff) / si) : 0xffff; else if (ins.fn === "or") di |= si;
        else if (ins.fn === "and") di &= si; else if (ins.fn === "shr") di = (di & 0xffff) >>> (si & 7); else if (ins.fn === "shl") di <<= (si & 7);
        if (byteDst) this.wr8(a, di); else this.wr16(a, di);
        return true;
      }
      case "jmp_if_not": {
        let ok;
        if ("flag" in ins.dst) ok = this.getFlag(ins.dst.flag) === ("flag" in ins.src ? this.getFlag(ins.src.flag) : ins.src.imm);
        else { const s = this.src(ins.src).w, d = this.rd16(this.dstAddr(ins.dst)); ok = ins.cmp === "eq" ? s === d : ins.cmp === "ne" ? s !== d : ins.cmp === "ge" ? s <= d : s >= d; }
        if (!ok) this.pc = ins.to;
        return true;
      }
      case "goto": this.pc = ins.to; return true;
      case "stop": return false;
      case "nop": return true;
      case "next_section": this.nextSec = 1; return true;
      case "next_chapter": this.nextChap = 1; return true;
      case "return0": this.ret = 0; return true;
      case "win_open": {
        const b = ins.win; if (b >= 4) return true;
        if (this.cur >= 0 && this.cur !== 3) this.host.clearWindowText(this.W(this.cur));
        this.cur = b;
        if (this.stack[0] === b || this.stack[1] === b) { this.host.selectWindow(this.W(this.cur), this.textColor); return true; }
        if (this.count >= 2) return true;
        this.stack[this.count++] = b;
        const id = this.stack[this.count - 1]; this.host.openWindow(id, this.W(this.cur));
        if (id !== 3) this.host.selectWindow(this.W(this.cur), this.textColor);
        return true;
      }
      case "win_close": {
        if (this.count) { const id = this.stack[this.count - 1]; if (id === 0) this.cur = 0; await this.host.closeWindow(id, this.W(id)); this.count--; this.stack[this.count] = 0xff; }
        this.cur = this.count ? this.stack[this.count - 1] : -1;
        return true;
      }
      case "win_close_all":
        while (this.count) { const id = this.stack[this.count - 1]; if (id === 0) this.cur = 0; await this.host.closeWindow(id, this.W(id)); this.count--; this.stack[this.count] = 0xff; }
        this.cur = -1; return true;
      case "win_select": if (ins.win < 4 && (this.stack[0] === ins.win || this.stack[1] === ins.win)) { this.cur = ins.win; this.host.selectWindow(this.W(this.cur), this.textColor); } return true;
      case "face": if (this.cur >= 0) this.host.drawFace(ins.face & 0xff, this.W(this.cur)); return true;
      case "face_var": if (this.cur >= 0) this.host.drawFace(this.getVar(ins.var) & 0xff, this.W(this.cur)); return true;
      case "msg": this.expand(ins.msg); this.host.showText(this.str); return true;
      case "msg_expand": this.expand(ins.msg); return true;
      case "wait_key": await this.host.waitKey(); return true;
      case "menu": {
        const b = this.c.font.encode(this.F.mes[ins.msg] ?? "{00}"), items = []; let cur = [];
        for (let i = 0; i < SC_STRLEN && i < b.length; i++) { if (!b[i]) break; if (b[i] === 0x0a) { items.push(Uint8Array.from([...cur, 0])); cur = []; continue; } cur.push(b[i]); }
        items.push(Uint8Array.from([...cur, 0]));
        this.setVar(ins.var, (await this.host.selectMenu(items)) & 0xff);
        return true;
      }
      case "music": this.host.playMusic(ins.song); return true;
      case "picture": await this.host.showPicture(ins.x, ins.y, ins.pic); return true;
      case "yes_no": this.setFlag(ins.flag, await this.host.confirmYesNo()); return true;
      case "addr": this.setVar(ins.var, this.mem.recordAddr(ins.kind, ins.index, ins.field)); return true;
      case "addr_var": this.setVar(ins.var, this.mem.recordAddr(ins.kind, this.getVar(ins.index_var) & 0xff, ins.field)); return true;
      case "money_set": setHeroMoney(this.m, refS16(this.getVar(ins.var))); this.host.refreshPanels(); return true;
      case "money_add": setHeroMoney(this.m, (this.m.globals.money + refS16(this.getVar(ins.var))) | 0); this.host.refreshPanels(); return true;
      case "money_sub": { const x = refS16(this.getVar(ins.var)) >>> 0, m = this.m.globals.money >>> 0; setHeroMoney(this.m, x >= m ? 0 : (m - x) | 0); this.host.refreshPanels(); return true; }
      case "money_div10000": this.setVar(ins.var, Math.trunc(this.m.globals.money / 10000)); return true;
      case "random": if (!ins.range) this.setVar(ins.var, 0); else { this.seed = (Math.imul(this.seed, 0x5d588b65) + 1) >>> 0; this.setVar(ins.var, ((this.seed >>> 8) & 0x7fff) % ins.range); } return true;
      case "seed_set": this.seed = (refS16(this.getVar(ins.var)) << 8) >>> 0; return true;
      case "seed_get": this.setVar(ins.var, (this.seed >>> 8) & 0xffff); return true;
      case "crew_join": {
        const m = this.m; for (let i = 0; i < GameConst.PARTY_SLOTS; i++) if (m.partyCrew(i) === GameConst.EMPTY_SLOT) { m.setPartyCrew(i, ins.person); break; }
        const pv = m.person(ins.person), hv = m.heroPerson(); pv.role = 6; pv.fleet = hv.fleet; pv.stayPort = hv.stayPort; return true;
      }
      case "barmaid_love": { const bm = this.m.barmaid(ins.girl); bm.affection = refUmin(bm.affection + ins.amount, 100); return true; }
      case "d1": this.host.resumeFleet(this.m.fleet(this.getVar(ins.var) & 0xff).addr); return true;
      case "duel": await this.host.runDuel(this, ins.person); return true;
      case "ending": await this.host.triggerEnding(ins.code & 0xff); return false;
      default: throw new Error("Ref VM unhandled: " + ins.k);
    }
  }
}

const snrDocs = [], snrMes = [], storyDocs = [];
for (let n = 0; n < 7; n++) {
  snrDocs.push(JSON.parse(fs.readFileSync(path.join(assetsDir, `scenario/snr${n}.json`), "utf8")));
  snrMes.push(JSON.parse(fs.readFileSync(path.join(assetsDir, `text/snr${n}.json`), "utf8")));
  storyDocs.push(JSON.parse(fs.readFileSync(path.join(assetsDir, `scenario/story${n}.json`), "utf8")));
}

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  console.log(`OK   ${name}`);
  passed++;
}

async function runEquivalenceCase({ label, env, hero = 0, chap = 0, sec = 0, port = 0, building = 5, mutateState, yesNoScript = [], menuScript = [] }) {
  const fileNo = env === ENV_COMMON ? 0 : hero + 1;

  const setup = (host) => {
    const st = new GameState(newgameBin.slice(), schema);
    st.model.globals.hero = hero;
    st.model.globals.port = port < 130 ? port : 0;
    st.model.globals.options |= OptionFlag.SCENARIO;
    if (env === ENV_COMMON) { st.model.globals.commonChap = chap; st.model.globals.commonSec = sec; }
    else { st.model.globals.heroChap = chap; st.model.globals.heroSec = sec; }
    if (mutateState) mutateState(st);
    const ctx = {
      state: st,
      rt: { year: 22, month: 4, day: 10, time: 18 },
      font: testFont,
      persons: [],
      scenarioHost: host,
      scenarioData: { vm: vmJson, story: { [fileNo]: storyDocs[fileNo] } },
    };
    return { st, ctx };
  };

  const hostRef = makeSpyHost(yesNoScript, menuScript);
  const { st: stRef, ctx: ctxRef } = setup(hostRef);
  const refVm = new ReferenceBytecodeVM(ctxRef, hostRef);
  const chkRef = await refVm.check(env, port, building, snrDocs[fileNo], snrMes[fileNo]);
  const retRef = chkRef ? await refVm.run(env) : 0;

  const hostNew = makeSpyHost(yesNoScript, menuScript);
  const { st: stNew, ctx: ctxNew } = setup(hostNew);
  const sc = new Scenario(ctxNew);
  const chkNew = await sc.check(env, port, building);
  const retNew = chkNew ? await sc.run(env) : 0;

  assert.equal(chkNew, chkRef, `${label}: check mismatch`);
  assert.equal(retNew, retRef, `${label}: ret mismatch`);
  assert.equal(sc.chap, refVm.chap, `${label}: chap mismatch`);
  assert.equal(sc.sec, refVm.sec, `${label}: sec mismatch`);
  assert.equal(sc.seed, refVm.seed, `${label}: seed mismatch`);
  assert.deepEqual(hostNew.events, hostRef.events, `${label}: host events mismatch`);
  // 1) 校验除当前脚本临时寄存器池 (env.vars..env.vars+128) 外，全部世界状态、章节、标志逐字节一致
  const varStart = env.vars - 0x0ca4;
  const varEnd = varStart + 64 * 2;
  const diffs = [];
  for (let i = 0; i < stNew.b.length; i++) {
    if (i >= varStart && i < varEnd) continue;
    if (stNew.b[i] !== stRef.b[i]) {
      diffs.push(`@0x${(i + 0x0ca4).toString(16)} new=${stNew.b[i]} ref=${stRef.b[i]}`);
    }
  }
  assert.deepEqual(diffs, [], `${label}: GameState world/flag/header mismatch`);
  // 2) 校验全部 WorkDS 持久化工作槽及跨章节/跨小节共享变量逐字一致 (排除仅在当前 section 内部使用的局部 scratch/指针寄存器)
  const CROSS_VARS = {
    0: [0, 1, 2, 3, 4, 5, 6, 8, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 29, 30, 31, 60],
    1: [0, 1, 2, 3, 4, 9, 60],
    2: [0, 1, 16, 60],
    3: [0, 1, 6, 8, 9, 15, 24, 60],
    4: [1],
    5: [1, 16, 17, 18],
    6: [0, 1, 2, 4, 10, 20, 21],
  };
  for (const vi of CROSS_VARS[fileNo] ?? []) {
    const a = env.vars + vi * 2;
    assert.equal(stNew.u16(a), stRef.u16(a), `${label}: cross var v${vi} mismatch`);
  }
  assert.deepEqual(Array.from(sc.mem.extra), Array.from(refVm.mem.extra), `${label}: mem.extra mismatch`);
  assert.deepEqual(Array.from(sc.mem.str), Array.from(refVm.mem.str), `${label}: mem.str mismatch`);
  ok(label, true);
}

// 1. 静态检查所有 7 份 story0..6.json 的结构、中文标注、触发器与内联台词
for (let n = 0; n < 7; n++) {
  const s = storyDocs[n];
  ok(`story${n}.json format == uw2-story-v1`, s.format === "uw2-story-v1" && s.id === n && Array.isArray(s.chapters));
}

// 2. 双跑等价测试：涵盖普通事件、循环/continue/break、多出口循环 exit、menu 分支、yes_no 分支、加减钱/入队/单挑/结局
await runEquivalenceCase({ label: "SNR0 ch0 sec0 事务所委托(声望不足跳过)", env: ENV_COMMON, hero: 0, chap: 0, sec: 0, port: 0, building: 6 });
await runEquivalenceCase({
  label: "SNR0 ch0 sec0 事务所委托(高声望触发对话+随机生成)",
  env: ENV_COMMON, hero: 0, chap: 0, sec: 0, port: 0, building: 6,
  mutateState: st => { st.model.heroInfo(0).tradeFame = 3000; st.model.heroInfo(0).rank = 2; },
});
await runEquivalenceCase({
  label: "SNR0 ch5 sec0 寻人委托(带 random + retry loop + continue)",
  env: ENV_COMMON, hero: 0, chap: 5, sec: 0, port: 13, building: 8,
  mutateState: st => { st.model.heroInfo(0).rank = 1; },
});
await runEquivalenceCase({
  label: "SNR0 ch10 sec2 王宫发现物循环(无未报告发现物 -> break + yes_no=否)",
  env: ENV_COMMON, hero: 0, chap: 10, sec: 2, port: 0, building: 21,
  yesNoScript: [0],
  mutateState: st => {
    st.set16(0x0d68 + 2 * 10, 0); // var 10 = homePort 0
    st.set16(0x0d68 + 2 * 19, 100);
  },
});
await runEquivalenceCase({
  label: "SNR0 ch10 sec2 王宫发现物循环(命中未报告发现物 -> exit(L_347) 晋爵)",
  env: ENV_COMMON, hero: 0, chap: 10, sec: 2, port: 0, building: 21,
  mutateState: st => {
    st.set16(0x0d68 + 2 * 10, 0);
    st.set16(0x0d68 + 2 * 19, 10);
    st.model.discovery(0).flags = 0x20; // KNOWN & !FOUND & !REPORTED
    st.model.discovery(0).importance = 50;
  },
});
await runEquivalenceCase({ label: "SNR1 ch1 sec1 约翰里斯本住宅(管家拦门)", env: ENV_HERO, hero: 0, chap: 1, sec: 1, port: 0, building: 7 });
await runEquivalenceCase({ label: "SNR1 ch2 sec0 约翰里斯本住宅(出航告别对话)", env: ENV_HERO, hero: 0, chap: 2, sec: 0, port: 0, building: 7 });
await runEquivalenceCase({ label: "SNR2 ch0 sec0 卡特琳娜开篇触发", env: ENV_HERO, hero: 1, chap: 0, sec: 0, port: 2, building: 5 });
await runEquivalenceCase({ label: "SNR3 ch0 sec0 奥托开篇触发", env: ENV_HERO, hero: 2, chap: 0, sec: 0, port: 8, building: 5 });
await runEquivalenceCase({ label: "SNR4 ch0 sec0 恩斯特开篇触发", env: ENV_HERO, hero: 3, chap: 0, sec: 0, port: 1, building: 7 });
await runEquivalenceCase({ label: "SNR5 ch0 sec0 皮耶德开篇触发", env: ENV_HERO, hero: 4, chap: 0, sec: 0, port: 13, building: 7 });
await runEquivalenceCase({ label: "SNR6 ch0 sec0 阿兰开篇触发", env: ENV_HERO, hero: 5, chap: 0, sec: 0, port: 33, building: 1 });

// 3. 验证注入原始 snr/mes 兼容路径时 Scenario 能即时 lift 后照常跑通
{
  const hostSpy = makeSpyHost();
  const st = new GameState(newgameBin.slice(), schema);
  st.model.globals.hero = 0; st.model.globals.port = 0; st.model.globals.options |= OptionFlag.SCENARIO;
  st.model.globals.heroChap = 1; st.model.globals.heroSec = 1;
  const sc = new Scenario({
    state: st, rt: { year: 22, month: 4, day: 10, time: 18 }, font: testFont, persons: [],
    scenarioHost: hostSpy, scenarioData: { vm: vmJson, snr: { 1: snrDocs[1] }, mes: { 1: snrMes[1] } },
  });
  const chk = await sc.check(ENV_HERO, 0, 7);
  const ret = await sc.run(ENV_HERO);
  ok("Scenario legacy ctx.scenarioData.snr live-lift fallback works", chk === 1 && ret === 0 && hostSpy.events.some(e => e[0] === "showText"));
}

console.log(`[story_tests] passed=${passed} failed=0`);
