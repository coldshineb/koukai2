// game/story_runner.ts — 语义化剧情 JSON (uw2-story-v1) 的直接执行引擎
// 支持高层融合指令 (say / get_field / set_field / alu_field / set / calc / when) 与结构化流程树。
import { GameConst, ShipSlotFlag } from "../model/flags.ts";
import { getCashCap } from "../core/prefs.ts";
import {
  fleetShipSlot,
  heroFleet,
  setHeroMoney,
  setPortBuildDays,
  writeShipName,
} from "../model/world_helpers.ts";
import { calcCargoUsed, calcShipFreeCargo } from "../domain/fleet.ts";
import type { IScenarioHost, ScenarioWindowDef } from "../ui/dos/protocol.ts";
import { ScenarioMemoryAdapter, SC_STRLEN, type ScenarioEnv } from "./scenario_adapter.ts";
import {
  parseFieldTarget,
  parseOperandToken,
  parseWhenExpr,
  type StoryAluFn,
  type StoryCond,
  type StoryDoc,
  type StoryHandler,
  type StoryOperand,
  type StorySection,
  type StoryStep,
} from "./story_schema.ts";

const srS16 = (v: number): number => (v << 16) >> 16;
const srUmin = (a: number, b: number): number => ((a & 0xffff) > (b & 0xffff) ? b & 0xffff : a & 0xffff);

type ExecSignal =
  | { readonly type: "none" }
  | { readonly type: "stop" }
  | { readonly type: "break" }
  | { readonly type: "continue" }
  | { readonly type: "exit"; readonly target: string };

const SIG_NONE: ExecSignal = { type: "none" };
const SIG_STOP: ExecSignal = { type: "stop" };
const SIG_BREAK: ExecSignal = { type: "break" };
const SIG_CONTINUE: ExecSignal = { type: "continue" };

export class StoryRunner {
  readonly c: any;
  readonly mem: ScenarioMemoryAdapter;
  readonly host: IScenarioHost;
  readonly onWarn: (msg: string) => void;

  vm: { windows: ScenarioWindowDef[]; textColor: string; seed0: number } | null = null;
  textColor = new Uint8Array(0);
  seed = 0;

  cur = -1;
  readonly stack: [number, number] = [0xff, 0xff];
  count = 0;

  env!: ScenarioEnv;
  chap = 0;
  sec = 0;
  section: StorySection | null = null;
  handler: StoryHandler | null = null;
  b876 = 0;
  nextSec = 0;
  nextChap = 0;
  ret = 1;
  duelHpFn: (() => number) | null = null;
  scenarioRef: any = null;

  constructor(
    ctx: any,
    mem: ScenarioMemoryAdapter,
    host: IScenarioHost,
    onWarn: (msg: string) => void,
    duelHpFn: (() => number) | null = null,
    scenarioRef: any = null,
  ) {
    this.c = ctx;
    this.mem = mem;
    this.host = host;
    this.onWarn = onWarn;
    this.duelHpFn = duelHpFn;
    this.scenarioRef = scenarioRef;
  }

  get m() { return this.c.state.model; }
  get str() { return this.mem.str; }
  get money(): number { return this.m.globals.money; }
  set money(v: number) { setHeroMoney(this.m, v, getCashCap(this.c)); }

  setVmConfig(vm: { windows: ScenarioWindowDef[]; textColor: string; seed0: number }): void {
    this.vm = vm;
    this.seed = vm.seed0 >>> 0;
    this.textColor = Uint8Array.from((vm.textColor.match(/../g) || []).map(x => parseInt(x, 16)));
  }

  // ---------------- 变量 / 标志 / 内存读写 ----------------
  rd8(a: number): number { return this.mem.rd8(a); }
  wr8(a: number, v: number): void { this.mem.wr8(a, v); }
  rd16(a: number): number { return this.mem.rd16(a); }
  wr16(a: number, v: number): void { this.mem.wr16(a, v); }
  varAddr(i: number): number { return this.env.vars + 2 * i; }
  getVar(i: number): number { return this.rd16(this.varAddr(i)); }
  setVar(i: number, v: number): void { this.wr16(this.varAddr(i), v); }
  getFlag(i: number): number { return (this.rd8(this.env.flags + (i >> 3)) >> (i & 7)) & 1; }
  setFlag(i: number, on: boolean | number): void {
    const a = this.env.flags + (i >> 3), m = 1 << (i & 7);
    this.wr8(a, on ? this.rd8(a) | m : this.rd8(a) & ~m);
  }

  evalSrc(o: StoryOperand): { w: number; b: number } {
    if ("var" in o) { const a = this.varAddr(o.var); return { w: this.rd16(a), b: this.rd8(a) }; }
    if ("ptr" in o) { const a = this.getVar(o.ptr); return { w: this.rd16(a), b: this.rd8(a) }; }
    if ("flag" in o) { const v = this.getFlag(o.flag) ? 0xffff : 0; return { w: v, b: v & 0xff }; }
    if ("imm" in o) return { w: o.imm & 0xffff, b: o.imm & 0xff };
    return { w: 0, b: 0 };
  }

  dstAddr(o: StoryOperand): number {
    return "var" in o ? this.varAddr(o.var) : this.getVar((o as { ptr: number }).ptr);
  }

  evalCond(c: StoryCond): boolean {
    if ("op" in c) {
      if (c.op === "not") return !this.evalCond(c.expr);
      if (c.op === "and") return c.args.every(a => this.evalCond(a));
      return c.args.some(a => this.evalCond(a));
    }
    let res: boolean;
    if ("flag" in c.dst) {
      const a = this.getFlag(c.dst.flag);
      const b = "flag" in c.src ? this.getFlag(c.src.flag) : (c.src as { imm: number }).imm;
      res = a === b;
    } else {
      const s = this.evalSrc(c.src).w;
      const d = this.rd16(this.dstAddr(c.dst));
      switch (c.cmp) {
        case "eq": res = s === d; break;
        case "ne": res = s !== d; break;
        case "ge": res = s <= d; break;
        default: res = s >= d; break;
      }
    }
    return c.not ? !res : res;
  }

  private applyAlu(fn: StoryAluFn, di: number, si: number, step: StoryStep): number {
    switch (fn) {
      case "add": return di + si;
      case "sub": return di - si;
      case "mul": return Math.imul(di, si);
      case "div":
        if (si) return Math.trunc((di & 0xffff) / si);
        console.error("劇本除以 0", step);
        return 0xffff;
      case "or": return di | si;
      case "and": return di & si;
      case "shr": return (di & 0xffff) >>> (si & 7);
      case "shl": return di << (si & 7);
    }
  }

  private resolveTargetAddr(target: string): number {
    const parsed = parseFieldTarget(target);
    const idx = "var" in parsed.index ? this.getVar(parsed.index.var) & 0xff : parsed.index.imm;
    return this.mem.recordAddr(parsed.kind, idx, parsed.field);
  }

  private execMov(size: "word" | "byte" | "sys", dst: StoryOperand, src: StoryOperand): void {
    if (size === "sys") {
      const n = (src as { sys: number }).sys, r = this.c.rt;
      if (n === 0) {
        const a = this.dstAddr(dst);
        for (let i = 0; ; i++) { const b = this.str[i]; this.wr8(a + i, b); if (!b) break; }
        return;
      }
      let v = 0;
      switch (n) {
        case 1: { const fl = heroFleet(this.m); v = Math.trunc(srS16(fl.x) / 24) + Math.trunc(srS16(fl.y) / 24) * 90; break; }
        case 2: v = r.year; break;
        case 3: v = r.month; break;
        case 4: v = r.day; break;
        case 5: v = this.m.globals.port; break;
        case 6: v = this.duelHpFn ? this.duelHpFn() : 0; break;
        case 7: v = r.time; break;
      }
      this.setVar("var" in dst ? dst.var : (dst as { ptr: number }).ptr, v);
      return;
    }
    const s = this.evalSrc(src);
    if ("flag" in dst) { this.setFlag(dst.flag, s.w !== 0); return; }
    const a = this.dstAddr(dst);
    if (size === "word") this.wr16(a, s.w);
    else if ("var" in dst) this.wr16(a, s.b);
    else this.wr8(a, s.b);
  }

  // ---------------- 文本编码与 $dNN/$n/$s/$rNN 展开 ----------------
  encodeText(text: string): Uint8Array {
    return this.c.font.encode(text ?? "{00}");
  }

  expandText(text: string): void {
    const b = this.encodeText(text), H = this.m.heroPerson().addr, out: number[] = [];
    const cstr = (a: number) => {
      for (let i = a; ; i++) {
        const v = this.rd8(i);
        if (!v) break;
        out.push(v);
      }
    };
    for (let i = 0; i < b.length && b[i]; ) {
      if (b[i] >= 0x80) { out.push(b[i], b[i + 1]); i += 2; continue; }
      if (b[i] !== 0x24) { out.push(b[i++]); continue; }
      const e = b[i + 1];
      i += 2;
      if (e === 0x64) {
        const k = (b[i] - 0x30) * 10 + b[i + 1] - 0x30;
        i += 2;
        for (const ch of String(this.getVar(k))) out.push(ch.charCodeAt(0));
      } else if (e === 0x6e) cstr(H);
      else if (e === 0x73) cstr(H + 0x0d);
      else if (e === 0x72) {
        const k = (b[i] - 0x30) * 10 + b[i + 1] - 0x30;
        i += 2;
        cstr(this.getVar(k));
      } else out.push(e);
    }
    this.str.fill(0);
    this.str.set(out.slice(0, SC_STRLEN - 1));
  }

  // ---------------- 发言窗口 ----------------
  W(i: number): ScenarioWindowDef { return this.vm!.windows[i]; }
  clearText(): void { this.host.clearWindowText(this.W(this.cur)); }
  selectWin(): void { this.host.selectWindow(this.W(this.cur), this.textColor); }
  openTop(): void {
    const id = this.stack[this.count - 1];
    this.host.openWindow(id, this.W(this.cur));
    if (id !== 3) this.selectWin();
  }
  winOpen(b: number): void {
    if (b >= 4) return;
    if (this.cur >= 0 && this.cur !== 3) this.clearText();
    this.cur = b;
    if (this.stack[0] === b || this.stack[1] === b) { this.selectWin(); return; }
    if (this.count >= 2) return;
    this.stack[this.count++] = b;
    this.openTop();
  }
  async closeTop(): Promise<void> {
    const id = this.stack[this.count - 1];
    if (id === 0) this.cur = id;
    await this.host.closeWindow(id, this.W(id));
    this.count--;
    this.stack[this.count] = 0xff;
  }
  async closeAll(): Promise<void> {
    while (this.count) await this.closeTop();
    this.cur = -1;
  }

  // ---------------- 舰队辅助 ----------------
  slotView(i: number) { return fleetShipSlot(heroFleet(this.m), i); }
  active(i: number): boolean { return (this.slotView(i).flags & ShipSlotFlag.STATE_MASK) === ShipSlotFlag.ACTIVE; }
  used(i: number): number {
    const cs = this.m.crewSlot(i);
    const goods = Array.from({ length: GameConst.CARGO_SLOTS }, (_, k) => cs.getCargoGoods(k));
    const amts = Array.from({ length: GameConst.CARGO_SLOTS }, (_, k) => cs.getCargoAmts(k));
    return calcCargoUsed(cs.water, cs.food, cs.material, cs.ammo, goods, amts);
  }
  free(i: number): number { return calcShipFreeCargo(this.m.ship(this.slotView(i).ship).maxCargo, this.used(i)); }
  captainCandidate(): number {
    const m = this.m, L: number[] = [];
    let k = 0;
    for (; k < GameConst.FLEET_SHIPS; k++) if (m.crewSlot(k).captain === m.globals.hero) break;
    if (k === GameConst.FLEET_SHIPS) L.push(m.globals.hero);
    for (let i = 0; i < GameConst.PARTY_SLOTS; i++) {
      const n = m.partyCrew(i);
      if (n !== GameConst.EMPTY_SLOT && m.person(n).role > 2) L.push(n);
    }
    this.c.persons ??= [];
    for (let i = 0; i < L.length; i++) this.c.persons[i] = L[i];
    return this.c.persons[0] & 0xff;
  }
  panels(): void { this.host.refreshPanels(); }

  // ---------------- 章节与触发匹配 ----------------
  matchTrigger(doc: StoryDoc, env: ScenarioEnv, port: number, building: number): boolean {
    if (this.chap === 0xff) { this.section = null; return false; }
    const ch = doc.chapters[this.chap];
    if (!ch) { this.chap = 0xff; this.section = null; return false; }
    const sec = ch.sections[this.sec];
    if (!sec) {
      this.onWarn(`劇本 ${doc.id} 章 ${this.chap} 節 ${this.sec} 不存在`);
      this.section = null;
      return false;
    }
    this.section = sec;
    for (const tr of sec.triggers) {
      if (!(tr.port === port || (port < env.portMax && tr.port === 0xa3))) continue;
      if (!(tr.building === building || tr.building === 0xff)) continue;
      const h = sec.handlers[tr.handler];
      if (!h) continue;
      this.handler = h;
      return true;
    }
    return false;
  }

  advanceSectionOrChapter(doc: StoryDoc): void {
    if (this.nextSec) {
      this.sec = (this.sec + 1) & 0xff;
      if (this.chap !== 0xff) {
        const ch = doc.chapters[this.chap];
        if (!ch) this.chap = 0xff;
        else {
          const sec = ch.sections[this.sec];
          if (!sec) this.onWarn(`劇本 ${doc.id} 章 ${this.chap} 節 ${this.sec} 不存在`);
          else this.section = sec;
        }
      }
    }
    if (this.nextChap) {
      this.chap = (this.chap + 1) & 0xff;
      this.sec = 0;
      for (let i = 0; i < 4; i++) this.wr8(this.env.flags + i, 0);
      if (this.chap !== 0xff) {
        const ch = doc.chapters[this.chap];
        if (!ch) this.chap = 0xff;
        else {
          const sec = ch.sections[0];
          if (!sec) this.onWarn(`劇本 ${doc.id} 章 ${this.chap} 節 0 不存在`);
          else this.section = sec;
        }
      }
    }
  }

  // ---------------- 执行剧情动作树 ----------------
  async runHandler(doc: StoryDoc, env: ScenarioEnv): Promise<number> {
    const hero = this.m.heroPerson(), r = this.c.rt, old = this.mem.getChapter(env).chap;
    let v = Math.imul(Math.imul(srS16(hero.navExp) + hero.navLevel, r.month), r.year) + r.day;
    if (env.addTime) v += r.time;
    this.seed = (v << 8) >>> 0;

    this.nextSec = 0;
    this.nextChap = 0;
    this.ret = 1;
    if (this.handler) {
      await this.execSteps(this.handler.steps);
    }
    await this.closeAll();
    this.advanceSectionOrChapter(doc);

    if (env.addTime === false && this.chap !== old) this.mem.setChapter(env, 0, 0);
    else this.mem.setChapter(env, this.chap, this.sec);
    return this.ret;
  }

  private async execSteps(steps: readonly StoryStep[]): Promise<ExecSignal> {
    for (const step of steps) {
      const sig = await this.execOne(step);
      if (sig.type !== "none") return sig;
    }
    return SIG_NONE;
  }

  private async execOne(step: StoryStep): Promise<ExecSignal> {
    switch (step.op) {
      case "if": {
        const cond = step.when ? parseWhenExpr(step.when) : step.cond!;
        if (this.evalCond(cond)) return this.execSteps(step.then);
        return step.else ? this.execSteps(step.else) : SIG_NONE;
      }
      case "loop": {
        for (;;) {
          const sig = await this.execSteps(step.body);
          if (sig.type === "continue") continue;
          if (sig.type === "break") return SIG_NONE;
          if (sig.type !== "none") return sig;
        }
      }
      case "break": return SIG_BREAK;
      case "continue": return SIG_CONTINUE;
      case "block": {
        const sig = await this.execSteps(step.body);
        if (sig.type === "exit" && sig.target === step.label) return SIG_NONE;
        return sig;
      }
      case "exit": return { type: "exit", target: step.target };
      case "stop": return SIG_STOP;
      case "nop": return SIG_NONE;
      case "next_section": this.nextSec = 1; return SIG_NONE;
      case "next_chapter": this.nextChap = 1; return SIG_NONE;
      case "return0": this.ret = 0; return SIG_NONE;

      // 融合高层对话步骤
      case "say": {
        if (step.win !== undefined) this.winOpen(step.win);
        if (this.cur >= 0) {
          if (step.face !== undefined) this.host.drawFace(step.face & 0xff, this.W(this.cur));
          else if (step.faceVar !== undefined) this.host.drawFace(this.getVar(step.faceVar) & 0xff, this.W(this.cur));
        }
        this.expandText(step.text);
        this.host.showText(this.str);
        if (step.wait) await this.host.waitKey();
        return SIG_NONE;
      }

      // 融合高层字段读取/写入/原地算术
      case "get_field": {
        const addr = this.resolveTargetAddr(step.from);
        const dstOp = parseOperandToken(step.to) as { var: number };
        if (step.size === "u8_lo") {
          this.setVar(dstOp.var, (this.getVar(dstOp.var) & 0xff00) | this.rd8(addr));
        } else {
          const val = step.size === "u8" ? this.rd8(addr) : this.rd16(addr);
          this.setVar(dstOp.var, val);
        }
        return SIG_NONE;
      }
      case "set_field": {
        const addr = this.resolveTargetAddr(step.target);
        const srcOp = parseOperandToken(step.value);
        const sv = this.evalSrc(srcOp);
        if (step.size === "u8") this.wr8(addr, sv.b);
        else this.wr16(addr, sv.w);
        return SIG_NONE;
      }
      case "alu_field": {
        const addr = this.resolveTargetAddr(step.target);
        const srcOp = parseOperandToken(step.value);
        const sv = this.evalSrc(srcOp);
        const di = step.size === "u8" ? this.rd8(addr) : this.rd16(addr);
        const si = "var" in srcOp ? sv.w : sv.b;
        const next = this.applyAlu(step.fn, di, si, step);
        if (step.size === "u8") this.wr8(addr, next);
        else this.wr16(addr, next);
        return SIG_NONE;
      }

      // 简化变量/指针操作
      case "set": {
        const dstOp = parseOperandToken(step.dst);
        if (step.ptrLoad === "u8") {
          const ptrOp = parseOperandToken(step.value) as { ptr: number };
          const val = this.rd8(this.getVar(ptrOp.ptr));
          this.setVar((dstOp as { var: number }).var, val);
          return SIG_NONE;
        }
        const srcOp = parseOperandToken(step.value);
        const sz: "word" | "byte" | "sys" = "sys" in srcOp ? "sys" : step.size === "u8" ? "byte" : "word";
        this.execMov(sz, dstOp, srcOp);
        return SIG_NONE;
      }
      case "calc": {
        const dstOp = parseOperandToken(step.dst);
        const srcOp = parseOperandToken(step.value);
        const byteDst = "ptr" in dstOp, a = this.dstAddr(dstOp), sv = this.evalSrc(srcOp);
        const di = byteDst ? this.rd8(a) : this.rd16(a);
        const si = "var" in srcOp ? sv.w : sv.b;
        const next = this.applyAlu(step.fn, di, si, step);
        if (byteDst) this.wr8(a, next);
        else this.wr16(a, next);
        return SIG_NONE;
      }

      case "win_open": this.winOpen(step.win); return SIG_NONE;
      case "win_close":
        if (this.count) await this.closeTop();
        this.cur = this.count ? this.stack[this.count - 1] : -1;
        return SIG_NONE;
      case "win_close_all": await this.closeAll(); return SIG_NONE;
      case "win_select":
        if (step.win < 4 && (this.stack[0] === step.win || this.stack[1] === step.win)) {
          this.cur = step.win;
          this.selectWin();
        }
        return SIG_NONE;
      case "face":
        if (this.cur >= 0) this.host.drawFace(step.face & 0xff, this.W(this.cur));
        return SIG_NONE;
      case "face_var":
        if (this.cur >= 0) this.host.drawFace(this.getVar(step.var) & 0xff, this.W(this.cur));
        return SIG_NONE;
      case "msg":
        this.expandText(step.text);
        this.host.showText(this.str);
        return SIG_NONE;
      case "msg_expand":
        this.expandText(step.text);
        return SIG_NONE;
      case "wait_key":
        await this.host.waitKey();
        return SIG_NONE;
      case "menu": {
        const b = this.encodeText(step.text), items: Uint8Array[] = [];
        let cur: number[] = [];
        for (let i = 0; i < SC_STRLEN && i < b.length; i++) {
          if (!b[i]) break;
          if (b[i] === 0x0a) { items.push(Uint8Array.from([...cur, 0])); cur = []; continue; }
          cur.push(b[i]);
        }
        items.push(Uint8Array.from([...cur, 0]));
        const r = await this.host.selectMenu(items);
        this.setVar(step.var, r & 0xff);
        return SIG_NONE;
      }
      case "music": this.host.playMusic(step.song); return SIG_NONE;
      case "picture": await this.host.showPicture(step.x, step.y, step.pic); return SIG_NONE;
      case "yes_no": this.setFlag(step.flag, await this.host.confirmYesNo()); return SIG_NONE;

      case "addr":
        this.setVar(step.var, this.mem.recordAddr(step.kind, step.index, step.field));
        return SIG_NONE;
      case "addr_var":
        this.setVar(step.var, this.mem.recordAddr(step.kind, this.getVar(step.indexVar) & 0xff, step.field));
        return SIG_NONE;
      case "mov":
        this.execMov(step.size, step.dst, step.src);
        return SIG_NONE;
      case "alu": {
        const byteDst = "ptr" in step.dst, a = this.dstAddr(step.dst), sv = this.evalSrc(step.src);
        const di = byteDst ? this.rd8(a) : this.rd16(a);
        const si = "var" in step.src ? sv.w : sv.b;
        const next = this.applyAlu(step.fn, di, si, step);
        if (byteDst) this.wr8(a, next);
        else this.wr16(a, next);
        return SIG_NONE;
      }
      case "random":
        if (!step.range) { this.setVar(step.var, 0); return SIG_NONE; }
        this.seed = (Math.imul(this.seed, 0x5d588b65) + 1) >>> 0;
        this.setVar(step.var, ((this.seed >>> 8) & 0x7fff) % step.range);
        return SIG_NONE;
      case "seed_set": this.seed = (srS16(this.getVar(step.var)) << 8) >>> 0; return SIG_NONE;
      case "seed_get": this.setVar(step.var, (this.seed >>> 8) & 0xffff); return SIG_NONE;

      case "money_set": this.money = srS16(this.getVar(step.var)); this.panels(); return SIG_NONE;
      case "money_add": this.money = (this.money + srS16(this.getVar(step.var))) | 0; this.panels(); return SIG_NONE;
      case "money_sub": {
        const x = srS16(this.getVar(step.var)) >>> 0, cur = this.money >>> 0;
        this.money = x >= cur ? 0 : (cur - x) | 0;
        this.panels();
        return SIG_NONE;
      }
      case "money_div10000": this.setVar(step.var, Math.trunc(this.money / 10000)); return SIG_NONE;

      case "cargo_free":
        this.setVar(step.var, 0);
        for (let i = 0; i < GameConst.FLEET_SHIPS; i++) if (this.active(i)) this.setVar(step.var, this.getVar(step.var) + this.free(i));
        return SIG_NONE;
      case "cargo_load": {
        const m = this.m, g = this.getVar(step.varGoods) & 0xff;
        let amt = this.getVar(step.varAmount);
        for (let i = 0; i < GameConst.FLEET_SHIPS && amt; i++) {
          if (!this.active(i)) continue;
          const free = this.free(i);
          if (!free) continue;
          const cs = m.crewSlot(i);
          let found: number = GameConst.EMPTY_SLOT;
          for (let k = 0; k < GameConst.CARGO_SLOTS; k++) {
            if (cs.getCargoGoods(k) === g) { found = k; break; }
            if (cs.getCargoGoods(k) === GameConst.EMPTY_SLOT && found === GameConst.EMPTY_SLOT) { found = k; cs.setCargoAmts(k, 0); }
          }
          if (found === GameConst.EMPTY_SLOT) continue;
          cs.setCargoGoods(found, g);
          const add = srUmin(amt, free);
          cs.setCargoAmts(found, cs.getCargoAmts(found) + add);
          amt = (amt - add) & 0xffff;
        }
        return SIG_NONE;
      }
      case "cargo_unload": {
        const m = this.m, g = this.getVar(step.varGoods) & 0xff;
        let want = this.getVar(step.varAmount);
        this.setVar(step.varAmount, 0);
        for (let i = 0; i < GameConst.FLEET_SHIPS; i++) {
          if (!this.active(i)) continue;
          const cs = m.crewSlot(i);
          for (let k = 0; k < GameConst.CARGO_SLOTS; k++) {
            if (cs.getCargoGoods(k) !== g) continue;
            const have = cs.getCargoAmts(k), take = srUmin(want, have), nextAmt = (have - take) & 0xffff;
            cs.setCargoAmts(k, nextAmt);
            want = (want - take) & 0xffff;
            if (!nextAmt) cs.setCargoGoods(k, GameConst.EMPTY_SLOT);
            this.setVar(step.varAmount, this.getVar(step.varAmount) + nextAmt);
          }
        }
        return SIG_NONE;
      }

      case "ship_new": {
        const m = this.m, stype = m.shipType(step.type), tmpl = m.ship(step.type + 0x28);
        let slot = 0;
        for (; slot < GameConst.FLEET_SHIPS; slot++) {
          const f = this.slotView(slot).flags & ShipSlotFlag.STATE_MASK;
          if (f !== ShipSlotFlag.ACTIVE && f !== ShipSlotFlag.BUILDING) break;
        }
        const sv = this.slotView(slot);
        const cs = slot < GameConst.FLEET_SHIPS ? m.crewSlot(slot) : null;
        if (!cs) this.onWarn("劇本新船: 艦隊已滿");
        let n = 0;
        for (; n < 0x28; n++) if (m.ship(n).type === GameConst.EMPTY_SLOT) break;
        if (n === 0x28) n = 0;
        const ship = m.ship(n), crew = Math.trunc(9 * stype.durability / 10);
        sv.maxDurability = crew; sv.durability = crew; sv.turn = stype.turn; sv.propulsion = stype.propulsion;
        sv.guns = 0; sv.crew = 0; sv.ship = n; sv.flags = ShipSlotFlag.BUILDING;
        if (cs) {
          cs.water = 0; cs.food = 0; cs.material = 0; cs.ammo = 0;
          cs.navRatio = 0x19; cs.lookRatio = 0x32; cs.captain = m.globals.port | 0x80; cs.loadTotal = 0;
          for (let k = 0; k < GameConst.CARGO_SLOTS; k++) { cs.setCargoGoods(k, GameConst.EMPTY_SLOT); cs.setCargoAmts(k, 0); }
        }
        ship.maxGuns = tmpl.maxGuns; ship.type = step.type; ship.flags = tmpl.flags; ship.maxCrew = tmpl.maxCrew;
        ship.maxCargo = stype.capacity - ship.maxGuns - ship.maxCrew;
        setPortBuildDays(m.portEconomy(m.globals.port), 0);
        return SIG_NONE;
      }
      case "ship_name": {
        const m = this.m;
        this.expandText(step.text);
        const cap = this.captainCandidate();
        let slot = 0;
        for (; slot < GameConst.FLEET_SHIPS; slot++) if ((this.slotView(slot).flags & ShipSlotFlag.STATE_MASK) === ShipSlotFlag.BUILDING) break;
        const sv = this.slotView(slot), cs = slot < GameConst.FLEET_SHIPS ? m.crewSlot(slot) : null, ship = m.ship(sv.ship);
        sv.flags = (sv.flags & ~ShipSlotFlag.BUILDING) | ShipSlotFlag.ACTIVE;
        if (cs) {
          cs.captain = cap;
          m.person(cap).role = cap === m.globals.hero ? 1 : 2;
        }
        setPortBuildDays(m.portEconomy(m.globals.port), GameConst.EMPTY_SLOT);
        writeShipName(ship, this.str);
        const fl = heroFleet(m);
        if (!this.host.recalcFleetStrength(fl.addr)) this.onWarn("劇本新船命名後的 0fea:83f9 (艦隊重算)");
        return SIG_NONE;
      }
      case "crew_join": {
        const m = this.m;
        for (let i = 0; i < GameConst.PARTY_SLOTS; i++) if (m.partyCrew(i) === GameConst.EMPTY_SLOT) { m.setPartyCrew(i, step.person); break; }
        const pv = m.person(step.person), hv = m.heroPerson();
        pv.role = 6; pv.fleet = hv.fleet; pv.stayPort = hv.stayPort;
        return SIG_NONE;
      }
      case "barmaid_love": {
        const bm = this.m.barmaid(step.girl);
        bm.affection = srUmin(bm.affection + step.amount, 100);
        return SIG_NONE;
      }
      case "d1": {
        const k = this.getVar(step.var) & 0xff;
        if (!this.host.resumeFleet(this.m.fleet(k).addr)) this.onWarn("劇本命令 D1 (艦隊移動 33aaf)");
        return SIG_NONE;
      }
      case "duel":
        await this.host.runDuel(this.scenarioRef ?? this, step.person);
        return SIG_NONE;
      case "ending":
        await this.host.triggerEnding(step.code & 0xff);
        return SIG_STOP;
    }
  }
}
