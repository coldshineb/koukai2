// game/story_lifter.ts — 基于原版剧本 VM 指令集与内存映射的语义提升器 (Base 工具)
// 阶段 1: 控制流结构化 (自然循环 + IPDOM/共享汇合 + labeled block)
// 阶段 2: 活跃变量分析 + 安全语义融合 (u8零扩展加载、addr/get_field/set_field/alu_field、say对话聚合、set/calc/when)
import {
  BUILDING_LABELS,
  SPECIAL_PORT_LABELS,
  STORY_FORMAT_VERSION,
  SYS_VALUE_LABELS,
  describeKindField,
  formatCondExpr,
  formatFieldTarget,
  formatOperand,
  type StoryAluFn,
  type StoryChapter,
  type StoryCond,
  type StoryDoc,
  type StoryHandler,
  type StoryOperand,
  type StorySection,
  type StoryStep,
  type StoryTrigger,
} from "./story_schema.ts";

export interface RawScenarioIns {
  at: number;
  op: number;
  n: number;
  k: string;
  [key: string]: any;
}

export interface RawScenarioDoc {
  file?: string;
  chapters: Array<{ sections: Array<{ index: [number, number, number][]; code: RawScenarioIns[] } | null> } | null>;
}

export interface StoryMetadataLookup {
  portNames?: readonly string[];
  personNames?: readonly string[];
  faceSpeakers?: Readonly<Record<number, string>>;
  barmaidNames?: readonly string[];
}

const STORY_TITLES: readonly string[] = [
  "公共剧本 (SNR0)",
  "约翰·法雷尔 (SNR1)",
  "卡特琳娜·艾兰茨 (SNR2)",
  "奥托·斯宾诺拉 (SNR3)",
  "恩斯特·洛佩斯 (SNR4)",
  "皮耶德·康迪 (SNR5)",
  "阿兰·维斯特 (SNR6)",
];

function cleanPreview(s: string): string {
  return s
    .replace(/\{[0-9A-Fa-f]{2}\}/g, "")
    .replace(/\{#[0-9A-Fa-f]{4}\}/g, "")
    .replace(/\r?\n+/g, " ")
    .trim();
}

function splitMenuOptions(text: string): string[] {
  const cleaned = text.replace(/\{00\}$/, "");
  return cleaned.split("\n").map(s => s.replace(/\{[0-9A-Fa-f]{2}\}/g, "").trim());
}

function summarizeSteps(steps: readonly StoryStep[]): string {
  for (const st of steps) {
    if ((st.op === "say" || st.op === "msg") && st.text) {
      const p = cleanPreview(st.text);
      if (p) return p.length > 42 ? p.slice(0, 42) + "…" : p;
    }
    if (st.op === "duel") return `触发单挑 (${st.personName ?? "#" + st.person})`;
    if (st.op === "ending") return `触发结局 #${st.code}`;
    if (st.op === "ship_new") return `建造新船 (船型 #${st.type})`;
    if (st.op === "crew_join") return `船员入队 (${st.personName ?? "#" + st.person})`;
    if (st.op === "if") {
      const s = summarizeSteps(st.then) || (st.else ? summarizeSteps(st.else) : "");
      if (s) return s;
    } else if (st.op === "loop" || st.op === "block") {
      const s = summarizeSteps(st.body);
      if (s) return s;
    }
  }
  return "状态检查 / 事件调度";
}

function formatPortLabel(port: number, meta?: StoryMetadataLookup): string {
  if (SPECIAL_PORT_LABELS[port]) return SPECIAL_PORT_LABELS[port];
  const nm = meta?.portNames?.[port];
  return nm ? `${nm} (#${port})` : `港口 #${port}`;
}

function formatBuildingLabel(port: number, building: number): string {
  if (port === 160) return building === 255 ? "任意出航天数" : `出海第 ${building} 天`;
  if (port === 161 || port === 162) return building === 255 ? "任意海战目标" : `海战目标 #${building}`;
  return BUILDING_LABELS[building] ?? `场所 #${building}`;
}

function convertInstruction(ins: RawScenarioIns, mes: readonly string[], meta?: StoryMetadataLookup): StoryStep {
  const msgText = (id: number): string => mes[id] ?? "{00}";
  switch (ins.k) {
    case "win_open": return { op: "win_open", win: ins.win };
    case "win_close": return { op: "win_close" };
    case "win_close_all": return { op: "win_close_all" };
    case "win_select": return { op: "win_select", win: ins.win };
    case "face": {
      const face = ins.face & 0xffff;
      const speaker = meta?.faceSpeakers?.[face & 0xff];
      return speaker ? { op: "face", face, speaker } : { op: "face", face };
    }
    case "face_var": return { op: "face_var", var: ins.var };
    case "msg": return { op: "msg", msg: ins.msg, text: msgText(ins.msg) };
    case "msg_expand": return { op: "msg_expand", msg: ins.msg, text: msgText(ins.msg) };
    case "wait_key": return { op: "wait_key" };
    case "menu": {
      const text = msgText(ins.msg);
      return { op: "menu", var: ins.var, msg: ins.msg, text, options: splitMenuOptions(text) };
    }
    case "music": return { op: "music", song: ins.song };
    case "picture": return { op: "picture", x: ins.x, y: ins.y, pic: ins.pic };
    case "yes_no": return { op: "yes_no", flag: ins.flag };
    case "addr":
      return {
        op: "addr",
        var: ins.var,
        kind: ins.kind,
        index: ins.index,
        field: ins.field,
        ref: describeKindField(ins.kind, ins.field),
      };
    case "addr_var":
      return {
        op: "addr_var",
        var: ins.var,
        kind: ins.kind,
        indexVar: ins.index_var,
        field: ins.field,
        ref: describeKindField(ins.kind, ins.field),
      };
    case "mov":
      return {
        op: "mov",
        size: ins.a,
        dst: ins.dst as StoryOperand,
        src: ins.src as StoryOperand,
        ...(ins.a === "sys" && SYS_VALUE_LABELS[ins.src?.sys] ? { note: SYS_VALUE_LABELS[ins.src.sys] } : {}),
      };
    case "alu":
      return { op: "alu", fn: ins.fn, dst: ins.dst as StoryOperand, src: ins.src as StoryOperand };
    case "random": return { op: "random", var: ins.var, range: ins.range };
    case "seed_set": return { op: "seed_set", var: ins.var };
    case "seed_get": return { op: "seed_get", var: ins.var };
    case "money_set": return { op: "money_set", var: ins.var };
    case "money_add": return { op: "money_add", var: ins.var };
    case "money_sub": return { op: "money_sub", var: ins.var };
    case "money_div10000": return { op: "money_div10000", var: ins.var };
    case "cargo_free": return { op: "cargo_free", var: ins.var };
    case "cargo_load": return { op: "cargo_load", varGoods: ins.var_goods, varAmount: ins.var_amount };
    case "cargo_unload": return { op: "cargo_unload", varGoods: ins.var_goods, varAmount: ins.var_amount };
    case "ship_new": return { op: "ship_new", type: ins.type, b2: ins.b2 };
    case "ship_name": return { op: "ship_name", b1: ins.b1, msg: ins.msg, text: msgText(ins.msg) };
    case "crew_join": {
      const personName = meta?.personNames?.[ins.person];
      return personName ? { op: "crew_join", person: ins.person, personName } : { op: "crew_join", person: ins.person };
    }
    case "barmaid_love": {
      const girlName = meta?.barmaidNames?.[ins.girl];
      return girlName ? { op: "barmaid_love", girl: ins.girl, girlName, amount: ins.amount } : { op: "barmaid_love", girl: ins.girl, amount: ins.amount };
    }
    case "d1": return { op: "d1", var: ins.var };
    case "duel": {
      const personName = meta?.personNames?.[ins.person];
      return personName ? { op: "duel", person: ins.person, personName } : { op: "duel", person: ins.person };
    }
    case "ending": return { op: "ending", code: ins.code };
    case "next_section": return { op: "next_section" };
    case "next_chapter": return { op: "next_chapter" };
    case "return0": return { op: "return0" };
    case "stop": return { op: "stop" };
    case "nop": return { op: "nop" };
    default:
      throw new Error(`Unsupported scenario opcode during lifting: ${ins.k} at ${ins.at}`);
  }
}

function negateCond(cond: StoryCond): StoryCond {
  if ("cmp" in cond) {
    if (cond.cmp === "eq" && !cond.not) return { cmp: "ne", dst: cond.dst, src: cond.src };
    if (cond.cmp === "ne" && !cond.not) return { cmp: "eq", dst: cond.dst, src: cond.src };
    if (cond.not) return { cmp: cond.cmp, dst: cond.dst, src: cond.src };
    return { cmp: cond.cmp, dst: cond.dst, src: cond.src, not: true };
  }
  if (cond.op === "not") return cond.expr;
  return { op: "not", expr: cond };
}

function wrapBlockIfNeeded(steps: StoryStep[], targetLabel: string): void {
  let needed = false;
  const walk = (arr: readonly StoryStep[]) => {
    for (const s of arr) {
      if (s.op === "exit" && s.target === targetLabel) { needed = true; return; }
      if (s.op === "if") { walk(s.then); if (s.else) walk(s.else); }
      else if (s.op === "loop" || s.op === "block") walk(s.body);
      if (needed) return;
    }
  };
  walk(steps);
  if (!needed) return;
  const inner = steps.splice(0, steps.length);
  steps.push({ op: "block", label: targetLabel, body: inner });
}

// ---------------- 阶段 2: 活跃变量分析 + 语义融合 ----------------

function addTextVarRefs(text: string, reads: Set<number>): void {
  for (const m of text.matchAll(/\$(?:d|r)(\d\d)/g)) {
    reads.add(parseInt(m[1], 10));
  }
}

function collectOperandReads(o: StoryOperand, reads: Set<number>): void {
  if ("var" in o) reads.add(o.var);
  else if ("ptr" in o) reads.add(o.ptr);
}

function collectCondReads(c: StoryCond, reads: Set<number>): void {
  if ("op" in c) {
    if (c.op === "not") collectCondReads(c.expr, reads);
    else for (const a of c.args) collectCondReads(a, reads);
    return;
  }
  collectOperandReads(c.dst, reads);
  collectOperandReads(c.src, reads);
}

function stepEffects(s: StoryStep): { reads: Set<number>; writes: Set<number> } {
  const reads = new Set<number>();
  const writes = new Set<number>();
  switch (s.op) {
    case "if":
      if (s.cond) collectCondReads(s.cond, reads);
      break;
    case "face_var":
    case "seed_set":
    case "money_set":
    case "money_add":
    case "money_sub":
    case "d1":
      reads.add(s.var);
      break;
    case "msg":
    case "msg_expand":
    case "ship_name":
      addTextVarRefs(s.text, reads);
      break;
    case "menu":
    case "random":
    case "seed_get":
    case "money_div10000":
    case "cargo_free":
      writes.add(s.var);
      break;
    case "addr":
      writes.add(s.var);
      break;
    case "addr_var":
      reads.add(s.indexVar);
      writes.add(s.var);
      break;
    case "cargo_load":
      reads.add(s.varGoods);
      reads.add(s.varAmount);
      break;
    case "cargo_unload":
      reads.add(s.varGoods);
      reads.add(s.varAmount);
      writes.add(s.varAmount);
      break;
    case "mov":
      if (s.size === "sys") {
        if ("sys" in s.src && s.src.sys === 0) {
          if ("var" in s.dst) reads.add(s.dst.var);
          else if ("ptr" in s.dst) reads.add(s.dst.ptr);
        } else if ("var" in s.dst) {
          writes.add(s.dst.var);
        } else if ("ptr" in s.dst) {
          writes.add(s.dst.ptr);
        }
      } else {
        collectOperandReads(s.src, reads);
        if ("var" in s.dst) {
          if (s.size === "byte") reads.add(s.dst.var);
          writes.add(s.dst.var);
        } else if ("ptr" in s.dst) {
          reads.add(s.dst.ptr);
        }
      }
      break;
    case "alu":
      collectOperandReads(s.src, reads);
      if ("var" in s.dst) {
        reads.add(s.dst.var);
        writes.add(s.dst.var);
      } else if ("ptr" in s.dst) {
        reads.add(s.dst.ptr);
      }
      break;
  }
  return { reads, writes };
}

type LiveMap = Map<StoryStep, Set<number>>;

function computeLiveness(root: readonly StoryStep[]): LiveMap {
  const liveOutMap: LiveMap = new Map();
  const blockExits = new Map<string, Set<number>>();

  const analyzeSeq = (
    seq: readonly StoryStep[],
    afterLive: Set<number>,
    loopHeaderLive: Set<number> | null,
    loopExitLive: Set<number> | null,
  ): Set<number> => {
    let live = new Set(afterLive);
    for (let i = seq.length - 1; i >= 0; i--) {
      const s = seq[i];
      liveOutMap.set(s, new Set(live));
      if (s.op === "stop" || s.op === "ending") {
        live = new Set();
        const { reads } = stepEffects(s);
        for (const v of reads) live.add(v);
      } else if (s.op === "break") {
        live = new Set(loopExitLive ?? afterLive);
      } else if (s.op === "continue") {
        live = new Set(loopHeaderLive ?? afterLive);
      } else if (s.op === "exit") {
        live = new Set(blockExits.get(s.target) ?? afterLive);
      } else if (s.op === "block") {
        blockExits.set(s.label, new Set(live));
        live = analyzeSeq(s.body, live, loopHeaderLive, loopExitLive);
      } else if (s.op === "loop") {
        const afterLoop = new Set(live);
        let headLive = new Set(afterLoop);
        for (let iter = 0; iter < 8; iter++) {
          const nextHead = analyzeSeq(s.body, headLive, headLive, afterLoop);
          if (nextHead.size === headLive.size && [...nextHead].every(x => headLive.has(x))) break;
          headLive = nextHead;
        }
        live = headLive;
      } else if (s.op === "if") {
        const tIn = analyzeSeq(s.then, live, loopHeaderLive, loopExitLive);
        const fIn = s.else ? analyzeSeq(s.else, live, loopHeaderLive, loopExitLive) : new Set(live);
        const merged = new Set(tIn);
        for (const v of fIn) merged.add(v);
        if (s.cond) collectCondReads(s.cond, merged);
        live = merged;
      } else {
        const { reads, writes } = stepEffects(s);
        for (const w of writes) live.delete(w);
        for (const r of reads) live.add(r);
      }
    }
    return live;
  };

  analyzeSeq(root, new Set(), null, null);
  return liveOutMap;
}

interface PtrBinding {
  readonly kind: number;
  readonly indexExpr: number | string;
  readonly indexVarNum: number | null;
  field: number;
}

type IntermediateStep =
  | StoryStep
  | { readonly op: "__u8_load"; readonly var: number; readonly ptr: number; readonly origZero: StoryStep; readonly origLoad: StoryStep };

function fuseFieldOpsInSeq(steps: readonly StoryStep[], liveOut: LiveMap): StoryStep[] {
  // Recurse into nested structures first
  const childrenDone: StoryStep[] = steps.map(s => {
    if (s.op === "if") {
      return {
        ...s,
        then: fuseFieldOpsInSeq(s.then, liveOut),
        ...(s.else ? { else: fuseFieldOpsInSeq(s.else, liveOut) } : {}),
      };
    }
    if (s.op === "loop" || s.op === "block") {
      return { ...s, body: fuseFieldOpsInSeq(s.body, liveOut) };
    }
    return s;
  });

  // Pass A: collapse zero-extended u8 load: mov(word, vX, 0) + mov(byte, vX, *vP)
  const passA: IntermediateStep[] = [];
  for (let i = 0; i < childrenDone.length; i++) {
    const a = childrenDone[i], b = childrenDone[i + 1];
    if (
      a?.op === "mov" && a.size === "word" && "var" in a.dst && "imm" in a.src && a.src.imm === 0 &&
      b?.op === "mov" && b.size === "byte" && "var" in b.dst && b.dst.var === a.dst.var && "ptr" in b.src
    ) {
      passA.push({ op: "__u8_load", var: b.dst.var, ptr: b.src.ptr, origZero: a, origLoad: b });
      i++;
    } else {
      passA.push(a);
    }
  }

  // Pass B: track dead pointer registers & fuse addr + dereferences into get_field/set_field/alu_field
  const out: IntermediateStep[] = [];
  let i = 0;
  while (i < passA.length) {
    const cur = passA[i];
    if (cur.op === "addr" || cur.op === "addr_var") {
      const pVar = cur.var;
      const idxVarNum = cur.op === "addr_var" ? cur.indexVar : null;
      const binding: PtrBinding = {
        kind: cur.kind,
        indexExpr: cur.op === "addr_var" ? `v${cur.indexVar}` : cur.index,
        indexVarNum: idxVarNum,
        field: cur.field,
      };

      // Check how far we can safely eliminate pVar within this straight-line slice
      // Eligible span ends at step j where !liveOut(orig(j)).has(pVar), or right before pVar is overwritten,
      // provided NO step in [i+1..j] reads pVar as a non-ptr value or modifies indexVarNum.
      let safeEnd = -1;
      let fieldDelta = binding.field;
      const traceBindings: number[] = []; // field value at each index i+1..j
      let ok = true;
      for (let j = i + 1; j < passA.length; j++) {
        const sj = passA[j];
        if (sj.op === "if" || sj.op === "loop" || sj.op === "block" || sj.op === "exit" || sj.op === "break" || sj.op === "continue" || sj.op === "stop" || sj.op === "ending") {
          ok = false;
          break;
        }
        traceBindings.push(fieldDelta);
        // If idxVarNum is written, invalidate!
        const origForLive = sj.op === "__u8_load" ? sj.origLoad : sj;
        const eff = stepEffects(origForLive);
        if (idxVarNum !== null && eff.writes.has(idxVarNum)) { ok = false; break; }

        // Check if sj uses pVar safely:
        const isSafePtrAdd = sj.op === "alu" && sj.fn === "add" && "var" in sj.dst && sj.dst.var === pVar && "imm" in sj.src;
        const isSafeLoad = (sj.op === "__u8_load" && sj.ptr === pVar && sj.var !== pVar) ||
          (sj.op === "mov" && (sj.size === "word" || sj.size === "byte") && "var" in sj.dst && sj.dst.var !== pVar && "ptr" in sj.src && sj.src.ptr === pVar);
        const isSafeStore = sj.op === "mov" && (sj.size === "word" || sj.size === "byte") && "ptr" in sj.dst && sj.dst.ptr === pVar &&
          !("var" in sj.src && sj.src.var === pVar) && !("ptr" in sj.src && sj.src.ptr === pVar);
        const usesNonPtr = (sj.op !== "__u8_load" && (eff.reads.has(pVar) && !isSafePtrAdd && !isSafeLoad && !isSafeStore));
        if (usesNonPtr) { ok = false; break; }

        if (isSafePtrAdd) {
          fieldDelta += (sj.src as { imm: number }).imm;
        } else if (!isSafeLoad && !isSafeStore) {
          if (eff.writes.has(pVar)) {
            if (safeEnd >= i + 1) break;
            ok = false;
            break;
          }
        }

        const live = liveOut.get(origForLive);
        if (live && !live.has(pVar)) {
          safeEnd = j;
          if (j + 1 < passA.length) {
            const nextSj = passA[j + 1];
            const nextIsPtrOp = (nextSj.op === "alu" && nextSj.fn === "add" && "var" in nextSj.dst && nextSj.dst.var === pVar && "imm" in nextSj.src) ||
              (nextSj.op === "__u8_load" && nextSj.ptr === pVar && nextSj.var !== pVar) ||
              (nextSj.op === "mov" && (nextSj.size === "word" || nextSj.size === "byte") && "var" in nextSj.dst && nextSj.dst.var !== pVar && "ptr" in nextSj.src && nextSj.src.ptr === pVar) ||
              (nextSj.op === "mov" && (nextSj.size === "word" || nextSj.size === "byte") && "ptr" in nextSj.dst && nextSj.dst.ptr === pVar);
            if (!nextIsPtrOp) break;
          } else {
            break;
          }
        }
      }

      if (ok && safeEnd >= i + 1) {
        let curField = binding.field;
        for (let j = i + 1; j <= safeEnd; j++) {
          const sj = passA[j];
          if (sj.op === "alu" && sj.fn === "add" && "var" in sj.dst && sj.dst.var === pVar && "imm" in sj.src) {
            curField += sj.src.imm;
            continue;
          }
          if (sj.op === "__u8_load" && sj.ptr === pVar) {
            const { target, note } = formatFieldTarget(binding.kind, curField, binding.indexExpr);
            out.push({ op: "get_field", to: `v${sj.var}`, from: target, size: "u8", note });
            continue;
          }
          if (sj.op === "mov" && (sj.size === "word" || sj.size === "byte") && "var" in sj.dst && "ptr" in sj.src && sj.src.ptr === pVar) {
            const { target, note } = formatFieldTarget(binding.kind, curField, binding.indexExpr);
            out.push({ op: "get_field", to: `v${sj.dst.var}`, from: target, size: sj.size === "byte" ? "u8_lo" : "u16", note });
            continue;
          }
          if (sj.op === "mov" && (sj.size === "word" || sj.size === "byte") && "ptr" in sj.dst && sj.dst.ptr === pVar) {
            const { target, note } = formatFieldTarget(binding.kind, curField, binding.indexExpr);
            out.push({
              op: "set_field",
              target,
              value: formatOperand(sj.src),
              size: sj.size === "byte" ? "u8" : "u16",
              note,
            });
            continue;
          }
          out.push(sj);
        }
        i = safeEnd + 1;
        continue;
      }
    }
    out.push(cur);
    i++;
  }

  return simplifyRemaining(out);
}

// 简洁化：重新对 Pass B 结果做一次全局活跃分析，精确融合 get_field+alu+set_field 与简化 mov/alu/if/say
function postSimplify(root: readonly StoryStep[], liveOut: LiveMap): StoryStep[] {
  const recurse = (arr: readonly StoryStep[]): StoryStep[] => {
    const mapped = arr.map(s => {
      if (s.op === "if") {
        return {
          ...s,
          then: recurse(s.then),
          ...(s.else ? { else: recurse(s.else) } : {}),
        };
      }
      if (s.op === "loop" || s.op === "block") return { ...s, body: recurse(s.body) };
      return s;
    });

    // 1) Collapse get_field + alu + set_field when tmpVar is dead after set_field
    const collapsed: StoryStep[] = [];
    for (let i = 0; i < mapped.length; i++) {
      const s0 = mapped[i], s1 = mapped[i + 1], s2 = mapped[i + 2];
      if (
        s0?.op === "get_field" && (s0.size === "u8" || s0.size === "u16") &&
        s1?.op === "alu" && "var" in s1.dst && `v${s1.dst.var}` === s0.to &&
        !(("var" in s1.src && s1.src.var === s1.dst.var) || ("ptr" in s1.src && s1.src.ptr === s1.dst.var)) &&
        s2?.op === "set_field" && s2.target === s0.from && s2.value === s0.to && s2.size === s0.size
      ) {
        const tmpVar = s1.dst.var;
        const idxMatch = s0.from.match(/\[(v\d+)\]/);
        const sameIdx = idxMatch && idxMatch[1] === s0.to;
        const liveAfterS2 = liveOut.get(s2);
        if (!sameIdx && liveAfterS2 && !liveAfterS2.has(tmpVar)) {
          const val = formatOperand(s1.src);
          const symMap: Record<StoryAluFn, string> = { add: "+=", sub: "-=", mul: "*=", div: "/=", or: "|=", and: "&=", shr: ">>=", shl: "<<=" };
          collapsed.push({
            op: "alu_field",
            target: s0.from,
            fn: s1.fn,
            value: val,
            size: s0.size,
            note: `${s0.note ?? s0.from} ${symMap[s1.fn]} ${val}`,
          });
          i += 2;
          continue;
        }
      }
      collapsed.push(s0);
    }

    // 2) Collapse (win_open w!=3)? + (face|face_var)? + msg + (wait_key)? -> say
    const withSay: StoryStep[] = [];
    for (let i = 0; i < collapsed.length; i++) {
      let win: number | undefined;
      let face: number | undefined;
      let speaker: string | undefined;
      let faceVar: number | undefined;
      let j = i;
      const cur = collapsed[j];
      if (cur.op === "win_open" && cur.win !== 3) {
        win = cur.win;
        j++;
      }
      if (j < collapsed.length && collapsed[j].op === "face") {
        const f = collapsed[j] as Extract<StoryStep, { op: "face" }>;
        face = f.face;
        speaker = f.speaker;
        j++;
      } else if (j < collapsed.length && collapsed[j].op === "face_var") {
        faceVar = (collapsed[j] as Extract<StoryStep, { op: "face_var" }>).var;
        j++;
      }
      if (j < collapsed.length && collapsed[j].op === "msg") {
        const m = collapsed[j] as Extract<StoryStep, { op: "msg" }>;
        j++;
        let wait = false;
        if (j < collapsed.length && collapsed[j].op === "wait_key") {
          wait = true;
          j++;
        }
        withSay.push({
          op: "say",
          ...(win !== undefined ? { win } : {}),
          ...(face !== undefined ? { face } : {}),
          ...(speaker !== undefined ? { speaker } : {}),
          ...(faceVar !== undefined ? { faceVar } : {}),
          msg: m.msg,
          text: m.text,
          ...(wait ? { wait: true } : {}),
        });
        i = j - 1;
        continue;
      }
      withSay.push(collapsed[i]);
    }

    // 3) Format remaining mov / alu / if into clean set / calc / when
    return withSay.map((s): StoryStep => {
      if (s.op === "if" && s.cond) {
        return {
          op: "if",
          when: formatCondExpr(s.cond),
          then: s.then,
          ...(s.else ? { else: s.else } : {}),
        };
      }
      if (s.op === "mov") {
        return {
          op: "set",
          dst: String(formatOperand(s.dst)),
          value: formatOperand(s.src),
          ...(s.size === "byte" ? { size: "u8" as const } : {}),
          ...(s.note ? { note: s.note } : {}),
        };
      }
      if (s.op === "alu") {
        return {
          op: "calc",
          dst: String(formatOperand(s.dst)),
          fn: s.fn,
          value: formatOperand(s.src),
        };
      }
      return s;
    });
  };
  return recurse(root);
}

function simplifyRemaining(arr: readonly IntermediateStep[]): StoryStep[] {
  return arr.map((s): StoryStep => {
    if (s.op === "__u8_load") {
      return {
        op: "set",
        dst: `v${s.var}`,
        value: `*v${s.ptr}`,
        ptrLoad: "u8",
      };
    }
    return s;
  });
}

function stepEffectsExtended(s: StoryStep, reads: Set<number>, writes: Set<number>): void {
  const { reads: r0, writes: w0 } = stepEffects(s);
  for (const x of r0) reads.add(x);
  for (const x of w0) writes.add(x);

  const scanTok = (tok: string | number, isWrite: boolean) => {
    if (typeof tok !== "string") return;
    if (/^v\d+$/.test(tok)) {
      const n = parseInt(tok.slice(1), 10);
      if (isWrite) writes.add(n);
      else reads.add(n);
    } else if (/^\*v\d+$/.test(tok)) {
      reads.add(parseInt(tok.slice(2), 10));
    }
  };
  const scanField = (target: string) => {
    const m = target.match(/\[(v\d+)\]/);
    if (m) reads.add(parseInt(m[1].slice(1), 10));
  };

  if (s.op === "get_field") {
    scanField(s.from);
    scanTok(s.to, true);
  } else if (s.op === "set_field") {
    scanField(s.target);
    scanTok(s.value, false);
  } else if (s.op === "alu_field") {
    scanField(s.target);
    scanTok(s.value, false);
  } else if (s.op === "set") {
    scanTok(s.value, false);
    if (s.dst.startsWith("*")) scanTok(s.dst, false);
    else if (s.dst.startsWith("v")) {
      if (s.size === "u8") scanTok(s.dst, false);
      scanTok(s.dst, true);
    }
  } else if (s.op === "calc") {
    scanTok(s.value, false);
    scanTok(s.dst, false);
    if (s.dst.startsWith("v")) scanTok(s.dst, true);
  } else if (s.op === "say") {
    if (s.faceVar !== undefined) reads.add(s.faceVar);
    addTextVarRefs(s.text, reads);
  }
}

function computeExtendedLiveness(root: readonly StoryStep[]): LiveMap {
  const liveOutMap: LiveMap = new Map();
  const blockExits = new Map<string, Set<number>>();

  const analyzeSeq = (
    seq: readonly StoryStep[],
    afterLive: Set<number>,
    loopHeaderLive: Set<number> | null,
    loopExitLive: Set<number> | null,
  ): Set<number> => {
    let live = new Set(afterLive);
    for (let i = seq.length - 1; i >= 0; i--) {
      const s = seq[i];
      liveOutMap.set(s, new Set(live));
      if (s.op === "stop" || s.op === "ending") {
        live = new Set();
        const w = new Set<number>();
        stepEffectsExtended(s, live, w);
      } else if (s.op === "break") {
        live = new Set(loopExitLive ?? afterLive);
      } else if (s.op === "continue") {
        live = new Set(loopHeaderLive ?? afterLive);
      } else if (s.op === "exit") {
        live = new Set(blockExits.get(s.target) ?? afterLive);
      } else if (s.op === "block") {
        blockExits.set(s.label, new Set(live));
        live = analyzeSeq(s.body, live, loopHeaderLive, loopExitLive);
      } else if (s.op === "loop") {
        const afterLoop = new Set(live);
        let headLive = new Set(afterLoop);
        for (let iter = 0; iter < 8; iter++) {
          const nextHead = analyzeSeq(s.body, headLive, headLive, afterLoop);
          if (nextHead.size === headLive.size && [...nextHead].every(x => headLive.has(x))) break;
          headLive = nextHead;
        }
        live = headLive;
      } else if (s.op === "if") {
        const tIn = analyzeSeq(s.then, live, loopHeaderLive, loopExitLive);
        const fIn = s.else ? analyzeSeq(s.else, live, loopHeaderLive, loopExitLive) : new Set(live);
        const merged = new Set(tIn);
        for (const v of fIn) merged.add(v);
        if (s.cond) collectCondReads(s.cond, merged);
        live = merged;
      } else {
        const reads = new Set<number>(), writes = new Set<number>();
        stepEffectsExtended(s, reads, writes);
        for (const w of writes) live.delete(w);
        for (const r of reads) live.add(r);
      }
    }
    return live;
  };

  analyzeSeq(root, new Set(), null, null);
  return liveOutMap;
}

export function liftEntryControlFlow(
  code: readonly RawScenarioIns[],
  entryAt: number,
  mes: readonly string[],
  meta?: StoryMetadataLookup,
  options?: { rawAstOnly?: boolean },
): StoryStep[] {
  const atIdx = new Map<number, number>();
  for (let i = 0; i < code.length; i++) atIdx.set(code[i].at, i);
  if (!atIdx.has(entryAt)) return [];

  // 1. Collect reachable nodes, forward/backward edges
  const reach = new Set<number>();
  const succs = new Map<number, number[]>();
  const preds = new Map<number, Set<number>>();
  const stack = [entryAt];
  while (stack.length) {
    const u = stack.pop()!;
    if (reach.has(u) || !atIdx.has(u)) continue;
    reach.add(u);
    const idx = atIdx.get(u)!;
    const ins = code[idx];
    const nxt = idx + 1 < code.length ? code[idx + 1].at : null;
    const out: number[] = [];
    if (ins.k === "stop" || ins.k === "ending") {
      // terminal
    } else if (ins.k === "goto") {
      out.push(ins.to);
    } else if (ins.k === "jmp_if_not") {
      if (nxt !== null) out.push(nxt);
      out.push(ins.to);
    } else if (nxt !== null) {
      out.push(nxt);
    }
    succs.set(u, out);
    for (const v of out) {
      let ps = preds.get(v);
      if (!ps) preds.set(v, (ps = new Set()));
      ps.add(u);
      stack.push(v);
    }
  }

  // 2. Natural loops (back edge u -> h where h <= u)
  const loops = new Map<number, Set<number>>();
  for (const u of reach) {
    for (const h of succs.get(u) ?? []) {
      if (h <= u) {
        let body = loops.get(h);
        if (!body) loops.set(h, (body = new Set([h])));
        body.add(u);
        const w = u !== h ? [u] : [];
        while (w.length) {
          const x = w.pop()!;
          for (const p of preds.get(x) ?? []) {
            if (reach.has(p) && !body.has(p)) {
              body.add(p);
              w.push(p);
            }
          }
        }
      }
    }
  }

  const loopExits = new Map<number, number | null>();
  for (const [h, body] of loops) {
    let minExt: number | null = null;
    for (const u of body) {
      for (const v of succs.get(u) ?? []) {
        if (!body.has(v) && (minExt === null || v < minExt)) minExt = v;
      }
    }
    loopExits.set(h, minExt);
  }

  // 3. Forward DAG post-dominators
  const SINK = -1;
  const fwdSuccs = new Map<number, number[]>();
  for (const u of reach) {
    fwdSuccs.set(u, (succs.get(u) ?? []).filter(v => v > u));
  }
  const postdom = new Map<number, Set<number>>();
  const sortedDesc = [...reach].sort((a, b) => b - a);
  for (const u of sortedDesc) {
    const f = fwdSuccs.get(u)!;
    if (!f.length) {
      postdom.set(u, new Set([u, SINK]));
    } else {
      let inter: Set<number> | null = null;
      for (const v of f) {
        const pv = postdom.get(v)!;
        if (inter === null) inter = new Set(pv);
        else {
          for (const x of inter) if (!pv.has(x)) inter.delete(x);
        }
      }
      inter!.add(u);
      postdom.set(u, inter!);
    }
  }

  const reachBefore = (start: number | null, limit: number): Set<number> => {
    const vis = new Set<number>();
    if (start === null) return vis;
    const st = [start];
    while (st.length) {
      const x = st.pop()!;
      if (x >= limit || vis.has(x) || !reach.has(x)) continue;
      vis.add(x);
      for (const v of fwdSuccs.get(x) ?? []) st.push(v);
    }
    return vis;
  };

  const labelFor = (at: number) => `L_${at}`;

  const build = (
    uStart: number | null,
    stopSet: Set<number>,
    curLoopH: number | null,
    curLoopExit: number | null,
    loopOuterStop: Set<number> | null,
    ownMerge: number | null,
  ): StoryStep[] => {
    const steps: StoryStep[] = [];
    let u = uStart;
    while (u !== null && !stopSet.has(u)) {
      wrapBlockIfNeeded(steps, labelFor(u));

      if (loops.has(u) && u !== curLoopH) {
        const lexit = loopExits.get(u) ?? null;
        const lstop = new Set(stopSet);
        if (lexit !== null) lstop.add(lexit);
        const body = build(u, lstop, u, lexit, stopSet, null);
        steps.push({ op: "loop", body });
        u = lexit;
        continue;
      }

      const idx = atIdx.get(u);
      if (idx === undefined) break;
      const ins = code[idx];
      const nxt = idx + 1 < code.length ? code[idx + 1].at : null;

      if (ins.k === "stop" || ins.k === "ending") {
        steps.push(convertInstruction(ins, mes, meta));
        break;
      }

      if (ins.k === "goto") {
        const to: number = ins.to;
        if (curLoopH !== null && to === curLoopH) {
          steps.push({ op: "continue" });
          break;
        }
        if (curLoopExit !== null && to === curLoopExit) {
          steps.push({ op: "break" });
          break;
        }
        if (stopSet.has(to)) {
          steps.push({ op: "exit", target: labelFor(to) });
          break;
        }
        u = to;
        continue;
      }

      if (ins.k === "jmp_if_not") {
        const to: number = ins.to;
        const cond: StoryCond = { cmp: ins.cmp, dst: ins.dst, src: ins.src };
        let lim = Infinity;
        for (const s of stopSet) if (s < lim) lim = s;

        let ipdom: number | null = null;
        for (const c of postdom.get(u)!) {
          if (c !== u && c !== SINK && c <= lim) {
            if (ipdom === null || c < ipdom) ipdom = c;
          }
        }

        const tReach = reachBefore(nxt, lim);
        const fReach = to > u ? reachBefore(to, lim) : new Set<number>();
        let sharedMin: number | null = null;
        if (ipdom === null) {
          for (const x of tReach) {
            if (fReach.has(x) && (sharedMin === null || x < sharedMin)) sharedMin = x;
          }
        }

        const merge = ipdom ?? sharedMin;
        const subStop = new Set(stopSet);
        if (merge !== null) subStop.add(merge);

        const tBranch = nxt !== null ? build(nxt, subStop, curLoopH, curLoopExit, loopOuterStop, merge) : [];
        let fBranch: StoryStep[] = [];
        if (curLoopH !== null && to === curLoopH) {
          fBranch = [{ op: "continue" }];
        } else if (curLoopExit !== null && to === curLoopExit) {
          fBranch = [{ op: "break" }];
        } else if (to === merge) {
          fBranch = [];
        } else if (stopSet.has(to)) {
          fBranch = [{ op: "exit", target: labelFor(to) }];
        } else {
          fBranch = build(to, subStop, curLoopH, curLoopExit, loopOuterStop, merge);
        }

        if (merge !== null) {
          const mLabel = labelFor(merge);
          const stripTrailingMergeExit = (arr: StoryStep[]) => {
            while (arr.length && arr[arr.length - 1].op === "exit" && (arr[arr.length - 1] as any).target === mLabel) {
              arr.pop();
            }
          };
          stripTrailingMergeExit(tBranch);
          stripTrailingMergeExit(fBranch);
        }

        if (!tBranch.length && fBranch.length) {
          steps.push({ op: "if", cond: negateCond(cond), then: fBranch });
        } else if (fBranch.length) {
          steps.push({ op: "if", cond, then: tBranch, else: fBranch });
        } else {
          steps.push({ op: "if", cond, then: tBranch });
        }

        u = merge;
        continue;
      }

      steps.push(convertInstruction(ins, mes, meta));
      u = nxt;
    }
    if (curLoopH !== null && u !== null && u !== ownMerge) {
      const last = steps[steps.length - 1];
      const isTerm = last && (last.op === "break" || last.op === "continue" || last.op === "stop" || last.op === "ending" || last.op === "exit");
      if (!isTerm) {
        if (curLoopExit !== null && u === curLoopExit) {
          steps.push({ op: "break" });
        } else if (loopOuterStop && loopOuterStop.has(u)) {
          steps.push({ op: "exit", target: labelFor(u) });
        }
      }
    }
    return steps;
  };

  const rawAst = build(entryAt, new Set(), null, null, null, null);
  if (options?.rawAstOnly) return rawAst;

  const live1 = computeLiveness(rawAst);
  const fusedFields = fuseFieldOpsInSeq(rawAst, live1);
  const live2 = computeExtendedLiveness(fusedFields);
  return postSimplify(fusedFields, live2);
}

export function liftScenarioToStory(
  id: number,
  rawDoc: RawScenarioDoc,
  mes: readonly string[],
  meta?: StoryMetadataLookup,
): StoryDoc {
  const chapters: Array<StoryChapter | null> = rawDoc.chapters.map((ch, ci) => {
    if (!ch) return null;
    const sections: Array<StorySection | null> = ch.sections.map((sec, si) => {
      if (!sec) return null;
      const handlers: Record<string, StoryHandler> = {};
      const triggers: StoryTrigger[] = [];
      for (const [port, building, w] of sec.index) {
        const handlerId = `h_${w}`;
        if (!handlers[handlerId]) {
          const steps = liftEntryControlFlow(sec.code, w, mes, meta);
          handlers[handlerId] = {
            entryAt: w,
            summary: summarizeSteps(steps),
            steps,
          };
        }
        triggers.push({
          port,
          portLabel: formatPortLabel(port, meta),
          building,
          buildingLabel: formatBuildingLabel(port, building),
          handler: handlerId,
          summary: handlers[handlerId].summary,
        });
      }
      return { section: si, triggers, handlers };
    });
    return { chapter: ci, sections };
  });

  return {
    format: STORY_FORMAT_VERSION,
    id,
    title: STORY_TITLES[id] ?? `剧本 #${id}`,
    chapters,
  };
}
