// modern/hud.ts — 階段 5 現代側邊高清 HUD (港口資訊 + 一鍵港內直達 + 海上狀態 + F1-F4 快捷鍵)
import { PortMove } from "../scenes/portmove.js";
import { DS } from "../model/schema_views.ts";
import { stripEscBytes, toSimp } from "../canvas_ui/text_util.ts";

const BUILDING_NAMES = [
  "交易所", "酒馆", "造船厂", "码头",
  "旅馆", "王宫", "事务所", "住宅",
  "银行", "道具店", "教会", "占卜师",
];

const CMD_KEYS: Array<[string, number]> = [
  ["情报 F1", 0x3b],
  ["经营 F2", 0x3c],
  ["命令 F3", 0x3d],
  ["航海术 F4", 0x3e],
];

export interface SeaHudSnapshot {
  crewSum: number;
  maxCrewSum: number;
  minDur: number;
  water: number;
  food: number;
  lumber: number;
  ammo: number;
  daysAtSea: number;
  loadPct: number;
}

export class ModernHud {
  readonly root: HTMLElement;
  readonly ctx: any;
  private mode: "none" | "port" | "sea" = "none";

  constructor(ctx: any) {
    this.ctx = ctx;
    this.root = document.getElementById("uw2-sidepanel") as HTMLElement;
  }

  hide(): void {
    this.mode = "none";
    if (this.root) this.root.hidden = true;
  }

  private decodeBytes(bytes: Uint8Array): string {
    if (!this.ctx?.codec) return "";
    return toSimp(this.ctx.codec.decode(stripEscBytes(bytes)).replace(/\{[0-9A-F]{2}\}/g, "").trim());
  }

  private makeCmdSection(): HTMLElement {
    const sec = document.createElement("div");
    sec.className = "uw2-hud-section";
    sec.innerHTML = `<div class="uw2-hud-heading"><span>快捷指令</span></div>`;
    const grid = document.createElement("div");
    grid.className = "uw2-hud-btn-grid";
    for (const [label, scan] of CMD_KEYS) {
      const b = document.createElement("button");
      b.className = "uw2-btn";
      b.textContent = label;
      b.addEventListener("click", () => this.ctx.sys.pushKey(scan, 0));
      grid.appendChild(b);
    }
    sec.appendChild(grid);
    return sec;
  }

  updatePort(portScene: any): void {
    if (!this.root) return;
    this.mode = "port";
    this.root.hidden = false;

    const m = this.ctx.state.model;
    const g = m.globals;
    const rt = this.ctx.rt ?? { year: g.year, month: g.month, day: g.day, time: g.time };
    const portId = g.port;
    const portName = portId < 130 ? this.decodeBytes(m.port(portId).nameBytes) : "港口";
    const year = 1500 + (rt.year & 0xff);
    const month = (rt.month & 0xff) + 1;
    const day = (rt.day & 0xff) + 1;
    const hour = ((Math.floor(rt.time / 3) + 11) % 12) + 1;
    const min = String((rt.time % 3) * 20).padStart(2, "0");
    const ampm = rt.time >= 0x24 ? "PM" : "AM";

    const hd = m.heroInfo();
    const fame = Math.max(hd.tradeFame, hd.pirateFame, hd.adventureFame);
    const money = g.money | 0;
    const ingots = Math.trunc(money / 10000);
    const coins = money % 10000;

    const infoSec = document.createElement("div");
    infoSec.className = "uw2-hud-section";
    infoSec.innerHTML = `
      <div class="uw2-hud-heading"><span>${portName}</span><span>${hour}:${min} ${ampm}</span></div>
      <div class="uw2-hud-grid">
        <div class="uw2-hud-kv"><span>日期</span><strong>${year}/${month}/${day}</strong></div>
        <div class="uw2-hud-kv"><span>声望</span><strong>${fame}</strong></div>
        <div class="uw2-hud-kv"><span>金块</span><strong>${ingots.toLocaleString("zh-CN")}</strong></div>
        <div class="uw2-hud-kv"><span>金币</span><strong>${coins.toLocaleString("zh-CN")}</strong></div>
      </div>
    `;

    if (portId < 100) {
      const E = m.portEconomy(portId);
      let sum = 0;
      for (let i = 0; i < 10; i++) sum += E.getPrices(i);
      const avgPrice = Math.trunc(sum / 10) + 50;
      const ecoGrid = document.createElement("div");
      ecoGrid.className = "uw2-hud-grid";
      ecoGrid.innerHTML = `
        <div class="uw2-hud-kv"><span>商业</span><strong>${E.commerce}</strong></div>
        <div class="uw2-hud-kv"><span>工业</span><strong>${E.industry}</strong></div>
        <div class="uw2-hud-kv"><span>物价</span><strong>${avgPrice}%</strong></div>
      `;
      infoSec.appendChild(ecoGrid);
    }

    // 一鍵港內移動 (直接重用 PortMove 可達性與瞬移機制)
    const navSec = document.createElement("div");
    navSec.className = "uw2-hud-section";
    navSec.innerHTML = `<div class="uw2-hud-heading"><span>港内直达</span></div>`;
    const bldGrid = document.createElement("div");
    bldGrid.className = "uw2-hud-btn-grid";

    for (let k = 0; k < 12; k++) {
      if (!PortMove.present(portScene, k)) continue;
      const ok = PortMove.reachable(portScene, k);
      const b = document.createElement("button");
      b.className = "uw2-btn";
      b.textContent = BUILDING_NAMES[k];
      b.disabled = !ok;
      b.addEventListener("click", () => {
        if (!PortMove.reachable(portScene, k)) return;
        portScene.pmTarget = k;
        // 喚醒港口步行迴圈立刻處理 pmTarget
        this.ctx.sys.pushKey(0, 0);
      });
      bldGrid.appendChild(b);
    }
    navSec.appendChild(bldGrid);

    this.root.replaceChildren(infoSec, navSec, this.makeCmdSection());
  }

  updateSea(snap: SeaHudSnapshot): void {
    if (!this.root) return;
    this.mode = "sea";
    this.root.hidden = false;

    const st = this.ctx.state;
    const rt = this.ctx.rt ?? { year: st.u8(DS.YEAR), month: st.u8(DS.MONTH), day: st.u8(DS.DAY), time: st.u8(DS.TIME) };
    const year = 1500 + (rt.year & 0xff);
    const month = (rt.month & 0xff) + 1;
    const day = (rt.day & 0xff) + 1;

    const seaSec = document.createElement("div");
    seaSec.className = "uw2-hud-section";
    seaSec.innerHTML = `
      <div class="uw2-hud-heading"><span>航海状态</span><span>第 ${snap.daysAtSea} 天</span></div>
      <div class="uw2-hud-grid">
        <div class="uw2-hud-kv"><span>日期</span><strong>${year}/${month}/${day}</strong></div>
        <div class="uw2-hud-kv"><span>载重</span><strong>${snap.loadPct}%</strong></div>
        <div class="uw2-hud-kv"><span>耐久</span><strong>${snap.minDur}</strong></div>
        <div class="uw2-hud-kv"><span>水手</span><strong>${snap.crewSum}/${snap.maxCrewSum}</strong></div>
      </div>
    `;

    const supSec = document.createElement("div");
    supSec.className = "uw2-hud-section";
    supSec.innerHTML = `
      <div class="uw2-hud-heading"><span>舰队补给</span></div>
      <div class="uw2-hud-grid">
        <div class="uw2-hud-kv"><span>饮水</span><strong>${Math.trunc(snap.water / 10)}</strong></div>
        <div class="uw2-hud-kv"><span>粮食</span><strong>${Math.trunc(snap.food / 10)}</strong></div>
        <div class="uw2-hud-kv"><span>资材</span><strong>${snap.lumber}</strong></div>
        <div class="uw2-hud-kv"><span>炮弹</span><strong>${snap.ammo}</strong></div>
      </div>
    `;

    this.root.replaceChildren(seaSec, supSec, this.makeCmdSection());
  }
}
