// game/story_lifter.ts — 基于原版剧本 VM 指令集与内存映射的语义提升器 (Base 工具)
// 将 snrN.json 字节码 + text/snrN.json + world.json 离线或运行期无损提升为可读且直接可执行的 StoryDoc。
import {
  BUILDING_LABELS,
  SPECIAL_PORT_LABELS,
  STORY_FORMAT_VERSION,
  SYS_VALUE_LABELS,
  describeKindField,
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
    if (st.op === "msg" && st.text) {
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
    case "mov": {
      const step: StoryStep = {
        op: "mov",
        size: ins.a,
        dst: ins.dst as StoryOperand,
        src: ins.src as StoryOperand,
        ...(ins.a === "sys" && SYS_VALUE_LABELS[ins.src?.sys] ? { note: SYS_VALUE_LABELS[ins.src.sys] } : {}),
      };
      return step;
    }
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
  // Scan if any step references exit(targetLabel); if so, wrap preceding prefix up to the label insertion point
  // Note: during sequential structuring, exits are resolved at the region where `u === targetAt`.
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

export function liftEntryControlFlow(
  code: readonly RawScenarioIns[],
  entryAt: number,
  mes: readonly string[],
  meta?: StoryMetadataLookup,
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
      // Whenever control reaches `u`, any earlier step inside `steps` targeting `exit(L_u)` needs a `block` around `steps`!
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

        // Clean up: if `then` is empty while `else` is non-empty, invert condition
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

  return build(entryAt, new Set(), null, null, null, null);
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
