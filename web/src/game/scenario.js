// scenario.js — 剧情触发与执行引擎 (基于语义化 story0..6.json + StoryRunner；支持由原版 VM 指令集无损提升)
import { loadJSON } from "../core/assets.js";
import { duelFromScenario } from "../scenes/duel.js";
import { mainEnding } from "./endgame.js";
import { GameConst, OptionFlag } from "../model/flags.ts";
import { LegacyScenarioHost } from "../ui/dos/legacy_presenter.ts";
import { ENV_COMMON, ENV_HERO, ScenarioMemoryAdapter } from "./scenario_adapter.ts";
import { StoryRunner } from "./story_runner.ts";
import { liftScenarioToStory } from "./story_lifter.ts";

export { ENV_COMMON, ENV_HERO };

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
    this.runner = new StoryRunner(ctx, this.mem, this.host, scTodo, () => this.duelHp(), this);
    this.files = {};
    this.vm = null;
    this.F = null;
    this.env = ENV_COMMON;
    this.fileNo = 0;
  }

  get st() { return this.c.state; }
  get m() { return this.c.state.model; }
  get extra() { return this.mem.extra; }
  get str() { return this.mem.str; }
  get b876() { return this.runner.b876; }
  get chap() { return this.runner.chap; }
  set chap(v) { this.runner.chap = v; }
  get sec() { return this.runner.sec; }
  set sec(v) { this.runner.sec = v; }
  get seed() { return this.runner.seed; }
  set seed(v) { this.runner.seed = v; }

  async closeAll() { await this.runner.closeAll(); }
  panels() { this.runner.panels(); }

  duelHp() {
    if (this.c.battleDS) return this.c.battleDS[0x9c2a];
    const h = (this.scene?.P ?? {}).battle?.ds?.["9bfe"];
    return h ? parseInt(h.substr((0x9c2a - 0x9bfe) * 2, 2), 16) : 0;
  }

  async init() {
    if (this.vm) return this;
    const D = this.c.scenarioData;
    this.vm = D?.vm ?? await loadJSON(this.c.ASSETS + "/scenario/vm.json");
    this.runner.setVmConfig(this.vm);
    return this;
  }

  async file(n) {
    if (this.files[n]) return this.files[n];
    const D = this.c.scenarioData;
    let story = D?.story?.[n];
    if (!story) {
      if (D?.snr?.[n] && D?.mes?.[n]) {
        story = liftScenarioToStory(n, D.snr[n], D.mes[n]);
      } else {
        story = await loadJSON(`${this.c.ASSETS}/scenario/story${n}.json`);
      }
    }
    return (this.files[n] = story);
  }

  // 2e09:5481 (共用) / 55c2 (主角): 返回 1 = 有事件 (命中触发器并已选定 handler)
  async check(env, port, building) {
    await this.init();
    this.mem.clearEvent(env);
    this.runner.b876 = building;
    if (env === ENV_HERO && (this.m.globals.heroChap === GameConst.EMPTY_SLOT || !(this.m.globals.options & OptionFlag.SCENARIO))) return 0;
    this.env = env;
    this.runner.env = env;
    this.fileNo = env === ENV_COMMON ? 0 : this.m.globals.hero + 1;
    this.F = await this.file(this.fileNo);
    const { chap, sec } = this.mem.getChapter(env);
    this.runner.chap = chap;
    this.runner.sec = sec;
    return this.runner.matchTrigger(this.F, env, port, building) ? 1 : 0;
  }

  // 2e09:53f0 / 5546
  async run(env) {
    this.env = env;
    this.runner.env = env;
    return this.runner.runHandler(this.F, env);
  }
}
