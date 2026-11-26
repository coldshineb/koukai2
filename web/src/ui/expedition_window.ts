// ui/expedition_window.ts — 独立可拖拽「航海统筹面板」浮窗（需在环境设置中开启，F8 或顶部栏入口呼出）
// 提供港口快速传送、当前存档未发现村落与补给港核查、主角数值/金币/声望/舰队与全体航海家资料编辑。
import { DiscoveryFlag, GameConst, ShipSlotFlag, SkillFlag } from "../model/flags.ts";
import { DS } from "../model/schema_views.ts";
import {
  WorldConst,
  fleetShipSlot,
  heroFleet,
  heroOrDockSlot,
  personRawBytes,
  toS16,
  writeShipName,
} from "../model/world_helpers.ts";
import { calcCargoUsed, calcShipLoadTotal } from "../domain/fleet.ts";
import { getCashCap } from "../core/prefs.ts";
import { ListSelect } from "./dos/listsel.js";
import { getPersonPortraitSrc, hasDom } from "./modals.ts";
import { decodeCleanCstr, toSimp } from "./text_util.ts";

type TabId = "ports" | "villages" | "hero" | "navigators" | "ships";
type PortFilter = "all" | "normal" | "supply" | "found" | "unfound";
type VillageFilter = "unfound_active" | "sea_found" | "known_unrep" | "supply_unfound" | "all_disc";
type NavFilter = "party" | "free" | "admirals" | "all";
type ShipFilter = "fleet" | "dock" | "all_slots";

interface WinState {
  root: HTMLElement | null;
  ctx: any;
  activeTab: TabId;
  collapsed: boolean;
  portSearch: string;
  portFilter: PortFilter;
  villageSearch: string;
  villageFilter: VillageFilter;
  selectedVillageIdx: number | null;
  navSearch: string;
  navFilter: NavFilter;
  selectedPersonId: number;
  shipFilter: ShipFilter;
  selectedShipSlot: number;
  newShipType: number;
  colonyFallback: string[] | null;
  loadingColony: boolean;
  posX: number | null;
  posY: number | null;
}

const state: WinState = {
  root: null,
  ctx: null,
  activeTab: "ports",
  collapsed: false,
  portSearch: "",
  portFilter: "all",
  villageSearch: "",
  villageFilter: "unfound_active",
  selectedVillageIdx: null,
  navSearch: "",
  navFilter: "party",
  selectedPersonId: 0,
  shipFilter: "fleet",
  selectedShipSlot: 0,
  newShipType: 0,
  colonyFallback: null,
  loadingColony: false,
  posX: null,
  posY: null,
};

const STAT_LABELS = ["统御力", "航海术", "知识", "直觉", "勇气", "剑术", "魅力", "运气"];
const SKILL_ITEMS: Array<[number, string]> = [
  [SkillFlag.SURVEY, "测量"],
  [SkillFlag.CARTOGRAPHY, "地图制作"],
  [SkillFlag.GUNNERY, "砲术"],
  [SkillFlag.ACCOUNTING, "会计"],
  [SkillFlag.NEGOTIATE, "交涉"],
];
const COUNTRY_NAMES = ["葡萄牙", "西班牙", "奥斯曼帝国", "英国", "意大利", "荷兰", "无所属/海盗"];
const ROLE_NAMES = ["提督", "船长", "助手", "会计", "水手长", "水手"];
const RANK_NAMES = ["无爵位", "士爵", "准爵士", "爵士", "准男爵", "男爵", "子爵", "伯爵", "侯爵", "公爵"];
const DISC_KIND_NAMES = ["遗迹/历史", "村落/部族", "生物", "植物", "地质奇观", "海兽/传闻", "珍宝", "秘境"];

function formatLatLon(x: number, y: number): { lat: string; lon: string; full: string } {
  const sx = ((Math.round(x) % 0x870) + 0x870) % 0x870;
  const sy = Math.round(y);
  let si = (sx + 0x7bd) % 0x870;
  let ew = "东经";
  if (si > 0x438) {
    ew = "西经";
    si = 0x870 - si;
  }
  const lonDeg = Math.round(si / 6);
  const dLat = 0x280 - sy;
  const ns = dLat >= 0 ? "北纬" : "南纬";
  const latDeg = Math.round(Math.abs(dLat) * 8 / 0x39);
  return { lat: `${ns}${latDeg}°`, lon: `${ew}${lonDeg}°`, full: `${ns}${latDeg}° ${ew}${lonDeg}°` };
}

function decText(ctx: any, bts: Uint8Array): string {
  if (!ctx?.codec) return "";
  return toSimp(decodeCleanCstr(ctx.codec, bts));
}

function getColonyEntry(ctx: any, id: number): { name: string; desc: string } {
  if (ctx?.portAssets?.colony && ctx?.codec) {
    const rec = ListSelect.colonyRec(ctx, id);
    const name = toSimp(decodeCleanCstr(ctx.codec, rec));
    const desc = toSimp(decodeCleanCstr(ctx.codec, rec.subarray(0x10)));
    return { name: name || `地点 #${id}`, desc };
  }
  if (state.colonyFallback && state.colonyFallback[id]) {
    const raw = state.colonyFallback[id];
    const parts = raw.split("{00}");
    const name = toSimp((parts[0] ?? "").trim());
    const descRaw = (parts[1] ?? "").replace(/^\s*\d+\S?\s*/, "").trim();
    const desc = toSimp(descRaw.replace(/\{00\}.*$/s, "").trim());
    return { name: name || `地点 #${id}`, desc };
  }
  return { name: `地点 #${id}`, desc: "" };
}

function ensureColonyData(ctx: any): void {
  if (ctx?.portAssets?.colony || state.colonyFallback || state.loadingColony) return;
  state.loadingColony = true;
  const assets = ctx?.ASSETS || "./assets";
  fetch(`${assets}/text/colony.json`)
    .then(r => (r.ok ? r.json() : null))
    .then(arr => {
      if (Array.isArray(arr)) state.colonyFallback = arr;
      refreshExpeditionWindow();
    })
    .catch(() => {})
    .finally(() => {
      state.loadingColony = false;
    });
}

function syncGameVisuals(ctx: any, msg?: string): void {
  const scene = ctx?.clock?.portScene;
  if (scene) {
    if (scene.port !== GameConst.EMPTY_SLOT) scene.panels();
    else scene.seaPanel();
    if (ctx.scr) ctx.scr.dirty = true;
  }
  if (msg) ctx?.shell?.showToast?.(msg);
}

function getBankTotal(m: any): number {
  const g = m.globals;
  return toS16(g.bankQuotient) * 10000 + toS16(g.bankRem);
}

function setBankTotal(m: any, total: number): void {
  const clamped = Math.max(-10_000_000, Math.min(200_000_000, Math.trunc(total)));
  const q = Math.trunc(clamped / 10000);
  const r = clamped - q * 10000;
  m.globals.bankQuotient = q & 0xffff;
  m.globals.bankRem = r & 0xffff;
}

function isPersonInParty(m: any, pid: number): boolean {
  for (let i = 0; i < GameConst.PARTY_SLOTS; i++) {
    if (m.partyCrew(i) === pid) return true;
  }
  return false;
}

function setPersonInParty(m: any, pid: number, wantInParty: boolean): boolean {
  if (pid === m.globals.hero) return false;
  const p = m.person(pid);
  if (wantInParty) {
    if (isPersonInParty(m, pid)) return true;
    for (let i = 0; i < GameConst.PARTY_SLOTS; i++) {
      if (m.partyCrew(i) === GameConst.EMPTY_SLOT) {
        m.setPartyCrew(i, pid);
        p.stayPort = GameConst.EMPTY_SLOT;
        p.fleet = m.heroPerson().fleet;
        if (p.role > 5) p.role = 5;
        return true;
      }
    }
    return false;
  } else {
    for (let i = 0; i < GameConst.PARTY_SLOTS; i++) {
      if (m.partyCrew(i) === pid) {
        for (let k = i; k < GameConst.PARTY_SLOTS - 1; k++) {
          m.setPartyCrew(k, m.partyCrew(k + 1));
        }
        m.setPartyCrew(GameConst.PARTY_SLOTS - 1, GameConst.EMPTY_SLOT);
        p.fleet = 0xfe;
        return true;
      }
    }
    return false;
  }
}

export function isExpeditionWindowOpen(): boolean {
  return Boolean(state.root && state.root.isConnected);
}

export function closeExpeditionWindow(): void {
  if (state.root) {
    state.root.remove();
    state.root = null;
  }
}

export function refreshExpeditionWindow(): void {
  if (!isExpeditionWindowOpen() || !state.ctx) return;
  renderContents();
}

export function toggleExpeditionWindow(ctx: any): void {
  if (!ctx?.prefs?.expeditionConsole) return;
  if (isExpeditionWindowOpen()) {
    closeExpeditionWindow();
    return;
  }
  openExpeditionWindow(ctx);
}

export function openExpeditionWindow(ctx: any): void {
  if (!hasDom() || !ctx?.prefs?.expeditionConsole) return;
  state.ctx = ctx;
  ensureColonyData(ctx);
  if (state.root && state.root.isConnected) {
    state.collapsed = false;
    renderContents();
    return;
  }

  const win = document.createElement("div");
  win.className = "uw2-card uw2-float-win";
  win.addEventListener("pointerdown", e => e.stopPropagation());
  win.addEventListener("mousedown", e => e.stopPropagation());
  win.addEventListener("click", e => e.stopPropagation());
  win.addEventListener("wheel", e => e.stopPropagation(), { passive: true });
  win.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeExpeditionWindow();
    } else if (e.key !== "F8") {
      e.stopPropagation();
    }
  });

  if (state.posX === null || state.posY === null) {
    const w = Math.min(920, window.innerWidth - 36);
    const h = Math.min(640, window.innerHeight - 64);
    state.posX = Math.max(12, Math.round((window.innerWidth - w) / 2));
    state.posY = Math.max(46, Math.round((window.innerHeight - h) / 2));
  }
  win.style.left = `${state.posX}px`;
  win.style.top = `${state.posY}px`;

  document.body.appendChild(win);
  state.root = win;
  renderContents();
}

function attachDrag(head: HTMLElement, win: HTMLElement): void {
  let dragging = false;
  let sx = 0, sy = 0, ox = 0, oy = 0;
  head.addEventListener("pointerdown", e => {
    if ((e.target as HTMLElement)?.closest("button")) return;
    dragging = true;
    sx = e.clientX;
    sy = e.clientY;
    const rect = win.getBoundingClientRect();
    ox = rect.left;
    oy = rect.top;
    head.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  head.addEventListener("pointermove", e => {
    if (!dragging) return;
    const nx = Math.max(8, Math.min(window.innerWidth - 160, ox + (e.clientX - sx)));
    const ny = Math.max(42, Math.min(window.innerHeight - 52, oy + (e.clientY - sy)));
    state.posX = nx;
    state.posY = ny;
    win.style.left = `${nx}px`;
    win.style.top = `${ny}px`;
  });
  const stop = () => { dragging = false; };
  head.addEventListener("pointerup", stop);
  head.addEventListener("pointercancel", stop);
}

function renderContents(): void {
  const win = state.root;
  const ctx = state.ctx;
  if (!win || !ctx?.state?.model) return;
  const m = ctx.state.model;
  const g = m.globals;
  const fl = heroFleet(m);
  const rt = ctx.rt ?? { year: g.year, month: g.month, day: g.day };

  const prevFocus = document.activeElement instanceof HTMLInputElement ? document.activeElement.dataset.uw2Field : undefined;
  win.classList.toggle("collapsed", state.collapsed);

  const head = document.createElement("div");
  head.className = "uw2-float-head";
  const titleWrap = document.createElement("div");
  titleWrap.className = "uw2-float-title-wrap";
  const titleEl = document.createElement("span");
  titleEl.className = "uw2-float-title";
  titleEl.textContent = "航海统筹面板";
  const statusEl = document.createElement("span");
  statusEl.className = "uw2-float-status";
  const portTxt = g.port !== GameConst.EMPTY_SLOT
    ? `停泊：${decText(ctx, m.port(g.port).nameBytes)} (#${g.port})`
    : `航行海域：${formatLatLon(toS16(fl.x), toS16(fl.y)).full}`;
  statusEl.textContent = `${1500 + (rt.year & 0xff) + 1}年${(rt.month & 0xff) + 1}月${(rt.day & 0xff) + 1}日 · ${portTxt}`;
  titleWrap.append(titleEl, statusEl);

  const headBtns = document.createElement("div");
  headBtns.className = "uw2-float-head-btns";
  const minBtn = document.createElement("button");
  minBtn.type = "button";
  minBtn.className = "uw2-btn";
  minBtn.textContent = state.collapsed ? "展开" : "收起";
  minBtn.addEventListener("click", () => { state.collapsed = !state.collapsed; renderContents(); });
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "uw2-modal-close";
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", () => closeExpeditionWindow());
  headBtns.append(minBtn, closeBtn);
  head.append(titleWrap, headBtns);
  attachDrag(head, win);

  if (state.collapsed) {
    win.replaceChildren(head);
    return;
  }

  const tabs = document.createElement("div");
  tabs.className = "uw2-modal-toolbar";
  const tabDefs: Array<[TabId, string]> = [
    ["ports", "港口传送"],
    ["villages", "未发现村落"],
    ["hero", "主角与金币"],
    ["navigators", "航海家与舰队"],
    ["ships", "船舰与积载"],
  ];
  for (const [id, label] of tabDefs) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `uw2-btn uw2-tab-btn ${state.activeTab === id ? "active" : ""}`;
    b.textContent = label;
    b.addEventListener("click", () => { state.activeTab = id; renderContents(); });
    tabs.appendChild(b);
  }

  const body = document.createElement("div");
  body.className = "uw2-float-body";
  const oldScroll = win.querySelector(".uw2-float-body")?.scrollTop ?? 0;

  if (state.activeTab === "ports") renderPortsTab(body, ctx);
  else if (state.activeTab === "villages") renderVillagesTab(body, ctx);
  else if (state.activeTab === "hero") renderHeroTab(body, ctx);
  else if (state.activeTab === "navigators") renderNavigatorsTab(body, ctx);
  else renderShipsTab(body, ctx);

  win.replaceChildren(head, tabs, body);
  body.scrollTop = oldScroll;

  if (prevFocus) {
    const inp = win.querySelector<HTMLInputElement>(`input[data-uw2-field="${prevFocus}"]`);
    if (inp) {
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
    }
  }
}

function makeChipRow<T extends string>(
  items: Array<[T, string]>,
  cur: T,
  onPick: (v: T) => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "uw2-chip-row";
  for (const [val, label] of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `uw2-btn ${cur === val ? "active" : ""}`;
    btn.textContent = label;
    btn.addEventListener("click", () => onPick(val));
    row.appendChild(btn);
  }
  return row;
}

function renderPortsTab(root: HTMLElement, ctx: any): void {
  const m = ctx.state.model;
  const g = m.globals;
  const scene = ctx.clock?.portScene;

  const ctrl = document.createElement("div");
  ctrl.className = "uw2-exp-ctrl";
  const search = document.createElement("input");
  search.type = "text";
  search.className = "uw2-input";
  search.dataset.uw2Field = "portSearch";
  search.placeholder = "搜索港名或编号（如 里斯本 / 0 / 长崎 / 100）";
  search.value = state.portSearch;
  search.addEventListener("input", () => { state.portSearch = search.value; renderContents(); });

  const chips = makeChipRow<PortFilter>(
    [
      ["all", "全部 (130)"],
      ["normal", "普通港 (0–99)"],
      ["supply", "补给港 (100–129)"],
      ["found", "已发现"],
      ["unfound", "未发现"],
    ],
    state.portFilter,
    v => { state.portFilter = v; renderContents(); },
  );
  ctrl.append(search, chips);

  const q = state.portSearch.trim().toLowerCase();
  const rows: Array<{
    id: number; name: string; supply: boolean; found: boolean; nation: number;
    x: number; y: number; latlon: string;
  }> = [];
  for (let i = 0; i < WorldConst.TOTAL_PORTS; i++) {
    const pv = m.port(i);
    const name = decText(ctx, pv.nameBytes);
    const supply = i >= WorldConst.NORMAL_PORTS;
    const found = (pv.region & 0x30) !== 0;
    const nation = pv.region & 7;
    if (state.portFilter === "normal" && supply) continue;
    if (state.portFilter === "supply" && !supply) continue;
    if (state.portFilter === "found" && !found) continue;
    if (state.portFilter === "unfound" && found) continue;
    if (q && !name.toLowerCase().includes(q) && !String(i).includes(q)) continue;
    const wx = toS16(pv.x), wy = toS16(pv.y);
    rows.push({
      id: i, name, supply, found, nation,
      x: wx, y: wy, latlon: formatLatLon(wx, wy).full,
    });
  }

  const list = document.createElement("div");
  list.className = "uw2-list-col uw2-exp-list";
  for (const r of rows) {
    const card = document.createElement("div");
    card.className = `uw2-exp-row ${g.port === r.id ? "current" : ""}`;
    const info = document.createElement("div");
    info.className = "uw2-exp-row-main";
    const natLabel = r.supply ? "补给港" : (COUNTRY_NAMES[r.nation] ?? "无所属");
    info.innerHTML = `<div class="uw2-exp-row-title">#${r.id} ${r.name} <span class="uw2-badge">${natLabel}</span> ${r.found ? '<span class="uw2-badge ok">已发现</span>' : '<span class="uw2-badge muted">未发现</span>'}</div>`
      + `<div class="uw2-slot-sub">${r.latlon} · 座标 (${r.x}, ${r.y})</div>`;

    const acts = document.createElement("div");
    acts.className = "uw2-group";
    const btnIn = document.createElement("button");
    btnIn.type = "button";
    btnIn.className = "uw2-btn uw2-btn-primary";
    btnIn.textContent = "传送进港";
    btnIn.disabled = !scene;
    btnIn.addEventListener("click", () => {
      if (!scene) return;
      scene.teleportToPort(r.id);
      syncGameVisuals(ctx, `已传送进入 ${r.name}`);
      renderContents();
    });

    const btnSea = document.createElement("button");
    btnSea.type = "button";
    btnSea.className = "uw2-btn";
    btnSea.textContent = "港外海域";
    btnSea.disabled = !scene;
    btnSea.addEventListener("click", () => {
      if (!scene) return;
      scene.teleportToSeaNear(r.x, r.y);
      syncGameVisuals(ctx, `已传送至 ${r.name} 附近海域`);
      renderContents();
    });

    acts.append(btnIn, btnSea);
    card.append(info, acts);
    list.appendChild(card);
  }
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "uw2-tut-empty";
    empty.textContent = "没有符合条件的港口";
    list.appendChild(empty);
  }

  root.append(ctrl, list);
}

function drawWorldPins(
  canvas: HTMLCanvasElement,
  ctx: any,
  pins: Array<{ x: number; y: number; key: number; color: string }>,
  selectedKey: number | null,
): void {
  const c2d = canvas.getContext("2d");
  if (!c2d) return;
  const W = canvas.width, H = canvas.height;
  c2d.fillStyle = "#0a1c36";
  c2d.fillRect(0, 0, W, H);

  const mapEntry = ctx.art?.graphEntry?.("GRAPH.DAT", 0x19);
  const mapUrl = mapEntry ? `${ctx.art.baseUrl}/${mapEntry.path}` : null;
  const img = mapUrl ? ctx.art.getImage(mapUrl) : null;
  const paintOverlay = () => {
    const m = ctx.state.model;
    const fl = heroFleet(m);
    const toPx = (wx: number, wy: number): [number, number] => {
      const gx = (((wx + 720) % 2160) / 2160) * W;
      const gy = (Math.max(0, Math.min(1080, wy)) / 1080) * H;
      return [gx, gy];
    };
    for (const pin of pins) {
      const [px, py] = toPx(pin.x, pin.y);
      c2d.fillStyle = pin.color;
      c2d.beginPath();
      c2d.arc(px, py, selectedKey === pin.key ? 4.2 : 2.6, 0, Math.PI * 2);
      c2d.fill();
      if (selectedKey === pin.key) {
        c2d.strokeStyle = "#ffffff";
        c2d.lineWidth = 1.5;
        c2d.beginPath();
        c2d.arc(px, py, 7, 0, Math.PI * 2);
        c2d.stroke();
      }
    }
    const [hx, hy] = toPx(toS16(fl.x), toS16(fl.y));
    c2d.fillStyle = "#ff4d4d";
    c2d.strokeStyle = "#ffffff";
    c2d.lineWidth = 1.5;
    c2d.beginPath();
    c2d.arc(hx, hy, 4, 0, Math.PI * 2);
    c2d.fill();
    c2d.stroke();
  };

  if (img && img.complete && (img.naturalWidth || img.width) > 0) {
    c2d.drawImage(img, 0, 0, W, H);
    c2d.fillStyle = "rgba(8, 22, 42, 0.30)";
    c2d.fillRect(0, 0, W, H);
    paintOverlay();
  } else {
    if (mapUrl) void ctx.art?.loadImage?.(mapUrl).then(() => paintOverlay()).catch(() => {});
    paintOverlay();
  }
}

function renderVillagesTab(root: HTMLElement, ctx: any): void {
  const m = ctx.state.model;
  const fl = heroFleet(m);
  const fx = toS16(fl.x), fy = toS16(fl.y);
  const scene = ctx.clock?.portScene;

  let unfoundActive = 0, seaFound = 0, knownUnrep = 0, supplyUnfound = 0;
  for (let i = 0; i < WorldConst.TOTAL_DISCOVERIES; i++) {
    const f = m.discovery(i).flags;
    if (!(f & 0xc0)) unfoundActive++;
    else if ((f & 0x40) && !(f & DiscoveryFlag.KNOWN) && !(f & DiscoveryFlag.FOUND)) seaFound++;
    if ((f & DiscoveryFlag.KNOWN) && !(f & DiscoveryFlag.FOUND)) knownUnrep++;
  }
  for (let i = WorldConst.NORMAL_PORTS; i < WorldConst.TOTAL_PORTS; i++) {
    if (!(m.port(i).region & 0x30)) supplyUnfound++;
  }

  const ctrl = document.createElement("div");
  ctrl.className = "uw2-exp-ctrl";
  const search = document.createElement("input");
  search.type = "text";
  search.className = "uw2-input";
  search.dataset.uw2Field = "villageSearch";
  search.placeholder = "搜索村落、发现物名称、坐标或编号";
  search.value = state.villageSearch;
  search.addEventListener("input", () => { state.villageSearch = search.value; renderContents(); });

  const chips = makeChipRow<VillageFilter>(
    [
      ["unfound_active", `本局未发现 (${unfoundActive})`],
      ["sea_found", `已发现待登岸 (${seaFound})`],
      ["known_unrep", `已调查未上报 (${knownUnrep})`],
      ["supply_unfound", `未发现补给港 (${supplyUnfound})`],
      ["all_disc", "全部地点 (100)"],
    ],
    state.villageFilter,
    v => { state.villageFilter = v; state.selectedVillageIdx = null; renderContents(); },
  );
  ctrl.append(search, chips);

  const q = state.villageSearch.trim().toLowerCase();
  const entries: Array<{
    key: number; isSupply: boolean; id: number; name: string; cat: string;
    imp: number; flags: number; x: number; y: number; latlon: string; dist: number; desc: string;
    statusText: string; statusCls: string;
  }> = [];

  if (state.villageFilter === "supply_unfound") {
    for (let i = WorldConst.NORMAL_PORTS; i < WorldConst.TOTAL_PORTS; i++) {
      const pv = m.port(i);
      if (pv.region & 0x30) continue;
      const name = decText(ctx, pv.nameBytes);
      if (q && !name.toLowerCase().includes(q) && !String(i).includes(q)) continue;
      const wx = toS16(pv.x), wy = toS16(pv.y);
      const dx = Math.min(Math.abs(wx - fx), 0x870 - Math.abs(wx - fx));
      const dist = Math.round(Math.hypot(dx, wy - fy));
      entries.push({
        key: 1000 + i, isSupply: true, id: i, name, cat: "补给港/聚落", imp: 0, flags: pv.region,
        x: wx, y: wy, latlon: formatLatLon(wx, wy).full, dist, desc: `未发现的补给港 #${i}`,
        statusText: "未发现", statusCls: "muted",
      });
    }
  } else {
    for (let i = 0; i < WorldConst.TOTAL_DISCOVERIES; i++) {
      const d = m.discovery(i);
      const f = d.flags;
      const isSeaFoundOnly = (f & 0x40) !== 0 && !(f & DiscoveryFlag.KNOWN) && !(f & DiscoveryFlag.FOUND);
      const isKnownUnrep = (f & DiscoveryFlag.KNOWN) !== 0 && !(f & DiscoveryFlag.FOUND);
      const isUnfoundActive = !(f & 0xc0);
      if (state.villageFilter === "unfound_active" && !isUnfoundActive) continue;
      if (state.villageFilter === "sea_found" && !isSeaFoundOnly) continue;
      if (state.villageFilter === "known_unrep" && !isKnownUnrep) continue;

      const { name, desc } = getColonyEntry(ctx, i);
      if (q && !name.toLowerCase().includes(q) && !desc.toLowerCase().includes(q) && !String(i).includes(q)) continue;
      const wx = toS16(d.x), wy = toS16(d.y);
      const dx = Math.min(Math.abs(wx - fx), 0x870 - Math.abs(wx - fx));
      const dist = Math.round(Math.hypot(dx, wy - fy));
      let statusText = "未发现";
      let statusCls = "muted";
      if (f & DiscoveryFlag.FOUND) { statusText = "已结案/未启用"; statusCls = "dim"; }
      else if (f & DiscoveryFlag.KNOWN) { statusText = "已调查"; statusCls = "ok"; }
      else if (f & 0x40) { statusText = "已发现村落"; statusCls = "warn"; }

      entries.push({
        key: i, isSupply: false, id: i, name, cat: DISC_KIND_NAMES[f & DiscoveryFlag.KIND_MASK] ?? "未知",
        imp: d.importance, flags: f, x: wx, y: wy, latlon: formatLatLon(wx, wy).full, dist, desc,
        statusText, statusCls,
      });
    }
  }
  entries.sort((a, b) => a.dist - b.dist);

  const split = document.createElement("div");
  split.className = "uw2-split";

  const left = document.createElement("div");
  left.className = "uw2-list-col uw2-exp-list";
  for (const e of entries) {
    const card = document.createElement("div");
    card.className = `uw2-exp-row ${state.selectedVillageIdx === e.key ? "current" : ""}`;
    card.style.cursor = "pointer";
    card.addEventListener("click", () => { state.selectedVillageIdx = e.key; renderContents(); });
    const info = document.createElement("div");
    info.className = "uw2-exp-row-main";
    info.innerHTML = `<div class="uw2-exp-row-title">#${e.id} ${e.name} <span class="uw2-badge">${e.cat}</span> <span class="uw2-badge ${e.statusCls}">${e.statusText}</span></div>`
      + `<div class="uw2-slot-sub">${e.latlon} · (${e.x}, ${e.y}) · 距当前 ${e.dist} 格</div>`;

    const acts = document.createElement("div");
    acts.className = "uw2-group";
    const goBtn = document.createElement("button");
    goBtn.type = "button";
    goBtn.className = "uw2-btn uw2-btn-primary";
    goBtn.textContent = "传至附近";
    goBtn.disabled = !scene;
    goBtn.addEventListener("click", ev => {
      ev.stopPropagation();
      if (!scene) return;
      state.selectedVillageIdx = e.key;
      scene.teleportToSeaNear(e.x, e.y);
      syncGameVisuals(ctx, `已传送至 ${e.name} 附近海域 (${e.latlon})`);
      renderContents();
    });
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "uw2-btn";
    if (e.isSupply) {
      toggleBtn.textContent = "标记已发现";
      toggleBtn.addEventListener("click", ev => {
        ev.stopPropagation();
        m.port(e.id).region |= 0x50;
        syncGameVisuals(ctx, `已将补给港 ${e.name} 设为已发现`);
        renderContents();
      });
    } else {
      const isFound = (e.flags & 0xc0) !== 0;
      toggleBtn.textContent = isFound ? "重置未发现" : "设为已发现";
      toggleBtn.addEventListener("click", ev => {
        ev.stopPropagation();
        const dv = m.discovery(e.id);
        if (isFound) dv.flags = dv.flags & 0x07;
        else dv.flags |= 0x40 | DiscoveryFlag.KNOWN;
        syncGameVisuals(ctx, `已更新 ${e.name} 状态`);
        renderContents();
      });
    }
    acts.append(goBtn, toggleBtn);
    card.append(info, acts);
    left.appendChild(card);
  }
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "uw2-tut-empty";
    empty.textContent = "当前筛选下无未发现村落或地点";
    left.appendChild(empty);
  }

  const right = document.createElement("div");
  right.className = "uw2-pane";
  const mapCard = document.createElement("div");
  mapCard.className = "uw2-action-box";
  const mapCanvas = document.createElement("canvas");
  mapCanvas.width = 360;
  mapCanvas.height = 180;
  mapCanvas.style.cssText = "width:100%;height:auto;border-radius:6px;border:1px solid var(--uw2-gold);display:block;";
  drawWorldPins(
    mapCanvas,
    ctx,
    entries.map(e => ({ x: e.x, y: e.y, key: e.key, color: e.isSupply ? "#48c2ff" : "#ffd24d" })),
    state.selectedVillageIdx,
  );
  const mapNote = document.createElement("div");
  mapNote.className = "uw2-slot-sub";
  mapNote.textContent = "红圈：当前舰队 · 金点：筛选村落/地点 · 白框：当前选中目标";
  mapCard.append(mapCanvas, mapNote);

  const detailCard = document.createElement("div");
  detailCard.className = "uw2-action-box";
  const sel = entries.find(e => e.key === state.selectedVillageIdx) ?? entries[0];
  if (sel) {
    detailCard.innerHTML = `<div class="uw2-pane-title">#${sel.id} ${sel.name}</div>`
      + `<div class="uw2-slot-sub">类型：${sel.cat} · 重要度：${sel.imp} · ${sel.latlon} (${sel.x}, ${sel.y})</div>`
      + `<div style="font-size:13px;line-height:1.6;color:var(--uw2-ink);margin-top:6px;">${sel.desc || "暂无描述说明"}</div>`;
  } else {
    detailCard.textContent = "点击左侧列表条目查看坐标详情";
  }

  right.append(mapCard, detailCard);
  split.append(left, right);
  root.append(ctrl, split);
}

function makeNumEditor(
  label: string,
  val: number,
  min: number,
  max: number,
  onCommit: (next: number) => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "uw2-exp-field";
  const lb = document.createElement("label");
  lb.textContent = label;
  const inp = document.createElement("input");
  inp.type = "number";
  inp.className = "uw2-input uw2-num-inp";
  inp.min = String(min);
  inp.max = String(max);
  inp.value = String(val);
  inp.addEventListener("change", () => {
    const n = Math.max(min, Math.min(max, Math.trunc(Number(inp.value) || 0)));
    inp.value = String(n);
    onCommit(n);
  });
  row.append(lb, inp);
  return row;
}

function renderHeroTab(root: HTMLElement, ctx: any): void {
  const m = ctx.state.model;
  const g = m.globals;
  const hd = m.heroInfo();
  const hero = m.heroPerson();
  const cap = getCashCap(ctx);

  const grid = document.createElement("div");
  grid.className = "uw2-exp-grid";

  // 1. 资金与银行
  const finBox = document.createElement("div");
  finBox.className = "uw2-action-box";
  const curCash = g.money;
  const curBank = getBankTotal(m);
  finBox.innerHTML = `<div class="uw2-pane-title">资金与存款（现金上限 ${cap.toLocaleString()}）</div>`;

  const cashRow = document.createElement("div");
  cashRow.className = "uw2-exp-inline";
  const cashInp = document.createElement("input");
  cashInp.type = "number";
  cashInp.className = "uw2-input";
  cashInp.min = "0";
  cashInp.max = String(cap);
  cashInp.value = String(curCash);
  const cashApply = document.createElement("button");
  cashApply.type = "button";
  cashApply.className = "uw2-btn uw2-btn-primary";
  cashApply.textContent = "应用现金";
  cashApply.addEventListener("click", () => {
    const v = Math.max(0, Math.min(cap, Math.trunc(Number(cashInp.value) || 0)));
    g.money = v | 0;
    syncGameVisuals(ctx, `已设置随身现金为 ${v.toLocaleString()}`);
    renderContents();
  });
  cashRow.append(cashInp, cashApply);

  const presets = document.createElement("div");
  presets.className = "uw2-chip-row";
  for (const [lb, addVal] of [["+10万", 100_000], ["+100万", 1_000_000], ["+1000万", 10_000_000], ["设为上限", cap]] as const) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "uw2-btn";
    b.textContent = lb;
    b.addEventListener("click", () => {
      const next = addVal === cap ? cap : Math.min(cap, g.money + addVal);
      g.money = next | 0;
      syncGameVisuals(ctx, `随身现金已更新为 ${next.toLocaleString()}`);
      renderContents();
    });
    presets.appendChild(b);
  }

  const bankRow = document.createElement("div");
  bankRow.className = "uw2-exp-inline";
  const bankInp = document.createElement("input");
  bankInp.type = "number";
  bankInp.className = "uw2-input";
  bankInp.value = String(curBank);
  const bankApply = document.createElement("button");
  bankApply.type = "button";
  bankApply.className = "uw2-btn";
  bankApply.textContent = "设银行存款";
  bankApply.addEventListener("click", () => {
    const next = Math.trunc(Number(bankInp.value) || 0);
    setBankTotal(m, next);
    syncGameVisuals(ctx, `银行存款已调整为 ${getBankTotal(m).toLocaleString()}`);
    renderContents();
  });
  bankRow.append(bankInp, bankApply);
  finBox.append(cashRow, presets, bankRow);

  // 2. 爵位、名声与各国功绩
  const fameBox = document.createElement("div");
  fameBox.className = "uw2-action-box";
  fameBox.innerHTML = `<div class="uw2-pane-title">爵位、名声与各国声望</div>`;
  const rankRow = document.createElement("div");
  rankRow.className = "uw2-exp-field";
  const rankLbl = document.createElement("label");
  rankLbl.textContent = "爵位";
  const rankSel = document.createElement("select");
  rankSel.className = "uw2-input";
  RANK_NAMES.forEach((rn, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    opt.textContent = `${idx}: ${rn}`;
    if (hd.rank === idx) opt.selected = true;
    rankSel.appendChild(opt);
  });
  rankSel.addEventListener("change", () => {
    hd.rank = Number(rankSel.value) & 0xff;
    syncGameVisuals(ctx, `爵位已改为 ${RANK_NAMES[hd.rank] ?? hd.rank}`);
    renderContents();
  });
  rankRow.append(rankLbl, rankSel);

  const fameGrid = document.createElement("div");
  fameGrid.className = "uw2-exp-fields";
  fameGrid.append(
    makeNumEditor("商业名声", hd.tradeFame, 0, 50000, v => { hd.tradeFame = v; syncGameVisuals(ctx); renderContents(); }),
    makeNumEditor("海盗名声", hd.pirateFame, 0, 50000, v => { hd.pirateFame = v; syncGameVisuals(ctx); renderContents(); }),
    makeNumEditor("冒险名声", hd.adventureFame, 0, 50000, v => { hd.adventureFame = v; syncGameVisuals(ctx); renderContents(); }),
  );
  const standGrid = document.createElement("div");
  standGrid.className = "uw2-exp-fields";
  for (let i = 0; i < 6; i++) {
    standGrid.appendChild(
      makeNumEditor(COUNTRY_NAMES[i], hd.getCountryStanding(i), 0, 200, v => {
        hd.setCountryStanding(i, v & 0xff);
        syncGameVisuals(ctx);
      }),
    );
  }
  fameBox.append(rankRow, fameGrid, standGrid);

  // 3. 主角自身能力与等级
  const heroStatBox = document.createElement("div");
  heroStatBox.className = "uw2-action-box";
  heroStatBox.innerHTML = `<div class="uw2-pane-title">主角属性 (${decText(ctx, hero.givenNameBytes)})</div>`;
  const hGrid = document.createElement("div");
  hGrid.className = "uw2-exp-fields";
  hGrid.append(
    makeNumEditor("航海等级", hero.navLevel, 1, 100, v => { hero.navLevel = v; syncGameVisuals(ctx); }),
    makeNumEditor("战斗等级", hero.battleLevel, 1, 100, v => { hero.battleLevel = v; syncGameVisuals(ctx); }),
    makeNumEditor("航海经验", hero.navExp, 0, 65000, v => { hero.navExp = v; syncGameVisuals(ctx); }),
    makeNumEditor("战斗经验", hero.battleExp, 0, 65000, v => { hero.battleExp = v; syncGameVisuals(ctx); }),
  );
  for (let i = 0; i < 8; i++) {
    hGrid.appendChild(
      makeNumEditor(STAT_LABELS[i], hero.getStats(i), 1, 100, v => { hero.setStats(i, v & 0xff); syncGameVisuals(ctx); }),
    );
  }
  const hSkills = document.createElement("div");
  hSkills.className = "uw2-chip-row";
  for (const [bit, label] of SKILL_ITEMS) {
    const lbl = document.createElement("label");
    lbl.className = "uw2-exp-check";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = (hero.skills & bit) !== 0;
    cb.addEventListener("change", () => {
      if (cb.checked) hero.skills |= bit;
      else hero.skills &= ~bit;
      syncGameVisuals(ctx);
    });
    lbl.append(cb, document.createTextNode(label));
    hSkills.appendChild(lbl);
  }
  const boostBtn = document.createElement("button");
  boostBtn.type = "button";
  boostBtn.className = "uw2-btn";
  boostBtn.textContent = "主角全属性 100 · 全技能 · 等级 50";
  boostBtn.addEventListener("click", () => {
    for (let i = 0; i < 8; i++) hero.setStats(i, 100);
    hero.navLevel = Math.max(hero.navLevel, 50);
    hero.battleLevel = Math.max(hero.battleLevel, 50);
    hero.skills |= 0x1f;
    syncGameVisuals(ctx, "已强化主角全属性与技能");
    renderContents();
  });
  heroStatBox.append(hGrid, hSkills, boostBtn);

  // 4. 舰队一键整备
  const fleetBox = document.createElement("div");
  fleetBox.className = "uw2-action-box";
  fleetBox.innerHTML = `<div class="uw2-pane-title">当前舰队快速整备</div>`;
  const fleetActions = document.createElement("div");
  fleetActions.className = "uw2-chip-row";
  const fl = heroFleet(m);

  const repairBtn = document.createElement("button");
  repairBtn.type = "button";
  repairBtn.className = "uw2-btn uw2-btn-primary";
  repairBtn.textContent = "全舰满耐久修复";
  repairBtn.addEventListener("click", () => {
    let fixed = 0;
    for (let i = 0; i < GameConst.FLEET_SHIPS; i++) {
      const s = fleetShipSlot(fl, i);
      if ((s.flags & ShipSlotFlag.STATE_MASK) !== ShipSlotFlag.ACTIVE) continue;
      s.durability = s.maxDurability;
      fixed++;
    }
    syncGameVisuals(ctx, `已修复当前舰队 ${fixed} 艘船只耐久`);
  });

  const supplyBtn = document.createElement("button");
  supplyBtn.type = "button";
  supplyBtn.className = "uw2-btn";
  supplyBtn.textContent = "补满水手·水粮·弹药·资材";
  supplyBtn.addEventListener("click", () => {
    let count = 0;
    for (let i = 0; i < GameConst.FLEET_SHIPS; i++) {
      const s = fleetShipSlot(fl, i);
      if ((s.flags & ShipSlotFlag.STATE_MASK) !== ShipSlotFlag.ACTIVE) continue;
      const ship = m.ship(s.ship);
      const cs = m.crewSlot(i);
      s.crew = ship.maxCrew;
      s.guns = ship.maxGuns;
      const freeSpace = Math.max(40, ship.maxCargo);
      const each = Math.min(250, Math.floor(freeSpace / 2));
      cs.water = Math.max(cs.water, each * 5);
      cs.food = Math.max(cs.food, each * 5);
      cs.ammo = Math.max(cs.ammo, Math.min(200, ship.maxGuns * 2));
      cs.material = Math.max(cs.material, 40);
      cs.morale = 100;
      count++;
    }
    syncGameVisuals(ctx, `已补充 ${count} 艘现役船水手与物资`);
  });

  const exploreBtn = document.createElement("button");
  exploreBtn.type = "button";
  exploreBtn.className = "uw2-btn";
  exploreBtn.textContent = "补满行动力 / 清异常天候";
  exploreBtn.addEventListener("click", () => {
    m.globals.weather = 0;
    m.st.set8(DS.DAYS_AT_SEA, 0);
    syncGameVisuals(ctx, "当前天候已转晴并重置出航天数");
  });

  fleetActions.append(repairBtn, supplyBtn, exploreBtn);
  fleetBox.append(fleetActions);

  grid.append(finBox, fameBox, heroStatBox, fleetBox);
  root.appendChild(grid);
}

function renderNavigatorsTab(root: HTMLElement, ctx: any): void {
  const m = ctx.state.model;
  const g = m.globals;

  const partySet = new Set<number>([g.hero]);
  for (let i = 0; i < GameConst.PARTY_SLOTS; i++) {
    const pid = m.partyCrew(i);
    if (pid !== GameConst.EMPTY_SLOT) partySet.add(pid);
  }
  const admiralSet = new Set<number>();
  for (let f = 0; f < WorldConst.TOTAL_FLEETS; f++) {
    const fl = m.fleet(f);
    if (fl.admiral < WorldConst.TOTAL_PERSONS) admiralSet.add(fl.admiral);
  }

  const ctrl = document.createElement("div");
  ctrl.className = "uw2-exp-ctrl";
  const search = document.createElement("input");
  search.type = "text";
  search.className = "uw2-input";
  search.dataset.uw2Field = "navSearch";
  search.placeholder = "搜索航海家姓名或编号 (0–119)";
  search.value = state.navSearch;
  search.addEventListener("input", () => { state.navSearch = search.value; renderContents(); });

  const chips = makeChipRow<NavFilter>(
    [
      ["party", `我方在队 (${partySet.size})`],
      ["free", "港内在野航海士"],
      ["admirals", "各国提督"],
      ["all", "全部人物 (120)"],
    ],
    state.navFilter,
    v => { state.navFilter = v; renderContents(); },
  );
  ctrl.append(search, chips);

  const q = state.navSearch.trim().toLowerCase();
  const listIds: number[] = [];
  for (let pid = 0; pid < WorldConst.TOTAL_PERSONS; pid++) {
    const pv = m.person(pid);
    const inParty = partySet.has(pid);
    const stay = pv.stayPort;
    if (state.navFilter === "party" && !inParty) continue;
    if (state.navFilter === "free" && (inParty || stay >= WorldConst.NORMAL_PORTS)) continue;
    if (state.navFilter === "admirals" && !admiralSet.has(pid)) continue;
    const gn = decText(ctx, pv.givenNameBytes);
    const fn = decText(ctx, pv.familyNameBytes);
    const full = fn ? `${gn}·${fn}` : gn;
    if (q && !full.toLowerCase().includes(q) && !String(pid).includes(q)) continue;
    listIds.push(pid);
  }
  if (!listIds.includes(state.selectedPersonId) && listIds.length) {
    state.selectedPersonId = listIds[0];
  }

  const split = document.createElement("div");
  split.className = "uw2-split narrow-left";
  const left = document.createElement("div");
  left.className = "uw2-list-col uw2-exp-list";
  for (const pid of listIds) {
    const pv = m.person(pid);
    const gn = decText(ctx, pv.givenNameBytes);
    const fn = decText(ctx, pv.familyNameBytes);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `uw2-row-card ${pid === state.selectedPersonId ? "selected" : ""}`;
    const stayStr = partySet.has(pid)
      ? "在队"
      : pv.stayPort < WorldConst.NORMAL_PORTS
        ? decText(ctx, m.port(pv.stayPort).nameBytes)
        : `舰队#${pv.fleet}`;
    btn.innerHTML = `<span style="font-weight:700;">#${pid} ${fn ? `${gn}·${fn}` : gn}</span>`
      + `<span class="uw2-slot-sub">${ROLE_NAMES[pv.role] ?? "人物"} · ${stayStr} · 航${pv.navLevel}/战${pv.battleLevel}</span>`;
    btn.addEventListener("click", () => { state.selectedPersonId = pid; renderContents(); });
    left.appendChild(btn);
  }

  const right = document.createElement("div");
  right.className = "uw2-pane";
  const pid = state.selectedPersonId;
  if (pid >= 0 && pid < WorldConst.TOTAL_PERSONS) {
    const pv = m.person(pid);
    const gn = decText(ctx, pv.givenNameBytes);
    const fn = decText(ctx, pv.familyNameBytes);
    const inParty = partySet.has(pid);

    const headBox = document.createElement("div");
    headBox.className = "uw2-action-box";
    headBox.style.cssText = "flex-direction:row;align-items:center;gap:12px;";
    const img = document.createElement("img");
    img.className = "uw2-portrait-img";
    img.style.cssText = "width:64px;height:80px;";
    void getPersonPortraitSrc(ctx.art, personRawBytes(pv)).then(src => { if (src) img.src = src; });
    const hInfo = document.createElement("div");
    hInfo.style.cssText = "flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;";
    const title = document.createElement("div");
    title.className = "uw2-pane-title";
    title.textContent = `#${pid} ${fn ? `${gn}·${fn}` : gn}`;
    const btnRow = document.createElement("div");
    btnRow.className = "uw2-group";
    if (pid !== g.hero) {
      const partyBtn = document.createElement("button");
      partyBtn.type = "button";
      partyBtn.className = `uw2-btn ${inParty ? "" : "uw2-btn-primary"}`;
      partyBtn.textContent = inParty ? "移出我方队伍" : "召入我方队伍";
      partyBtn.addEventListener("click", () => {
        const ok = setPersonInParty(m, pid, !inParty);
        syncGameVisuals(ctx, ok ? `已将 ${gn} ${inParty ? "移出" : "召入"}我方队伍` : "队伍人数已满");
        renderContents();
      });
      btnRow.appendChild(partyBtn);
    }
    const maxBtn = document.createElement("button");
    maxBtn.type = "button";
    maxBtn.className = "uw2-btn";
    maxBtn.textContent = "全属性 100 · 全技能";
    maxBtn.addEventListener("click", () => {
      for (let i = 0; i < 8; i++) pv.setStats(i, 100);
      pv.skills |= 0x1f;
      pv.loyalty = 100;
      syncGameVisuals(ctx, `已强化航海家 ${gn}`);
      renderContents();
    });
    btnRow.appendChild(maxBtn);
    hInfo.append(title, btnRow);
    headBox.append(img, hInfo);

    const metaBox = document.createElement("div");
    metaBox.className = "uw2-action-box";
    const metaFields = document.createElement("div");
    metaFields.className = "uw2-exp-fields";

    // 国籍与职务
    const natField = document.createElement("div");
    natField.className = "uw2-exp-field";
    const natLbl = document.createElement("label"); natLbl.textContent = "国籍";
    const natSel = document.createElement("select"); natSel.className = "uw2-input";
    for (let i = 0; i < 7; i++) {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = COUNTRY_NAMES[i];
      if ((pv.face & 0x0f) === i) o.selected = true;
      natSel.appendChild(o);
    }
    natSel.addEventListener("change", () => {
      pv.face = (pv.face & 0xf0) | (Number(natSel.value) & 0x0f);
      syncGameVisuals(ctx);
    });
    natField.append(natLbl, natSel);

    const roleField = document.createElement("div");
    roleField.className = "uw2-exp-field";
    const roleLbl = document.createElement("label"); roleLbl.textContent = "职务";
    const roleSel = document.createElement("select"); roleSel.className = "uw2-input";
    ROLE_NAMES.forEach((rn, idx) => {
      const o = document.createElement("option");
      o.value = String(idx);
      o.textContent = rn;
      if (pv.role === idx) o.selected = true;
      roleSel.appendChild(o);
    });
    roleSel.addEventListener("change", () => {
      pv.role = Number(roleSel.value) & 0xff;
      syncGameVisuals(ctx);
    });
    roleField.append(roleLbl, roleSel);

    metaFields.append(
      natField,
      roleField,
      makeNumEditor("年龄", pv.age, 12, 99, v => { pv.age = v; }),
      makeNumEditor("忠诚度", pv.loyalty, 0, 100, v => { pv.loyalty = v; }),
      makeNumEditor("航海等级", pv.navLevel, 1, 100, v => { pv.navLevel = v; }),
      makeNumEditor("战斗等级", pv.battleLevel, 1, 100, v => { pv.battleLevel = v; }),
      makeNumEditor("航海经验", pv.navExp, 0, 65000, v => { pv.navExp = v; }),
      makeNumEditor("战斗经验", pv.battleExp, 0, 65000, v => { pv.battleExp = v; }),
      makeNumEditor("停留港ID (255海上)", pv.stayPort, 0, 255, v => { pv.stayPort = v; }),
      makeNumEditor("所属舰队ID", pv.fleet, 0, 255, v => { pv.fleet = v; }),
    );
    metaBox.appendChild(metaFields);

    const statBox = document.createElement("div");
    statBox.className = "uw2-action-box";
    const statFields = document.createElement("div");
    statFields.className = "uw2-exp-fields";
    for (let i = 0; i < 8; i++) {
      statFields.appendChild(makeNumEditor(STAT_LABELS[i], pv.getStats(i), 1, 100, v => { pv.setStats(i, v & 0xff); syncGameVisuals(ctx); }));
    }
    const skillsRow = document.createElement("div");
    skillsRow.className = "uw2-chip-row";
    for (const [bit, label] of SKILL_ITEMS) {
      const lbl = document.createElement("label");
      lbl.className = "uw2-exp-check";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = (pv.skills & bit) !== 0;
      cb.addEventListener("change", () => {
        if (cb.checked) pv.skills |= bit;
        else pv.skills &= ~bit;
        syncGameVisuals(ctx);
      });
      lbl.append(cb, document.createTextNode(label));
      skillsRow.appendChild(lbl);
    }
    statBox.append(statFields, skillsRow);
    right.append(headBox, metaBox, statBox);
  }

  split.append(left, right);
  root.append(ctrl, split);
}

function expHexBytes(s: string): Uint8Array {
  const b = Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16)));
  const o = new Uint8Array(b.length + 1);
  o.set(b);
  return o;
}

function getShipHelperNames(ctx: any): {
  cannons: string[];
  figureheads: string[];
  goods: string[];
  gunWeight: number[];
} {
  const data = ctx?.portAssets?.data;
  const cannonsRaw: string[] = data?.build?.cannons ?? [];
  const figRaw: string[] = data?.build?.figureheads ?? [];
  const goodsRaw: string[] = data?.goods ?? [];
  const gunWeight: number[] = data?.leftover?.gunWeight ?? [0, 20, 13, 10, 15, 11, 4, 15];
  const cannons = Array.from({ length: 8 }, (_, i) =>
    (cannonsRaw[i] ? decText(ctx, expHexBytes(cannonsRaw[i])) : "") || (i === 0 ? "无武装" : `火炮 #${i}`),
  );
  const figureheads = Array.from({ length: 11 }, (_, i) =>
    i === 0
      ? "无船首像"
      : (figRaw[i - 1] ? decText(ctx, expHexBytes(figRaw[i - 1])) : "") || `船首像 #${i}`,
  );
  const goods = Array.from({ length: 46 }, (_, i) =>
    (goodsRaw[i] ? decText(ctx, expHexBytes(goodsRaw[i])) : "") || `商品 #${i}`,
  );
  return { cannons, figureheads, goods, gunWeight };
}

function computeSlotCargoUsed(m: any, slotIdx: number): number {
  const cs = m.crewSlot(slotIdx);
  const goods: number[] = [];
  const amts: number[] = [];
  for (let k = 0; k < GameConst.CARGO_SLOTS; k++) {
    goods.push(cs.getCargoGoods(k));
    amts.push(cs.getCargoAmts(k));
  }
  return calcCargoUsed(cs.water, cs.food, cs.material, cs.ammo, goods, amts);
}

function recalcShipSlotLoad(m: any, slotIdx: number, gunWeight: number[]): void {
  const slot = heroOrDockSlot(m, slotIdx);
  const cs = m.crewSlot(slotIdx);
  const used = computeSlotCargoUsed(m, slotIdx);
  cs.loadTotal = calcShipLoadTotal(used, gunWeight[slot.flags & 7] ?? 0, slot.guns, slot.crew);
}

function spawnShipIntoSlot(ctx: any, targetSlot: number, shipTypeId: number, gunWeight: number[]): boolean {
  const m = ctx.state.model;
  let shipRecIdx = -1;
  for (let i = 0; i < 40; i++) {
    if (m.ship(i).type === GameConst.EMPTY_SLOT) {
      shipRecIdx = i;
      break;
    }
  }
  if (shipRecIdx < 0) return false;
  const t = Math.max(0, Math.min(24, shipTypeId));
  const tmpl = m.ship(40 + t);
  const stype = m.shipType(t);
  const rec = m.ship(shipRecIdx);
  rec.type = t;
  rec.flags = tmpl.flags;
  rec.maxGuns = tmpl.maxGuns;
  rec.maxCrew = tmpl.maxCrew;
  rec.maxCargo = Math.max(0, stype.capacity - rec.maxGuns - rec.maxCrew);
  writeShipName(rec, tmpl.nameBytes);

  const d0 = Math.trunc((9 * stype.durability) / 10);
  const dur = Math.max(10, d0 - Math.trunc((d0 & 0xff) / 15));
  const slot = heroOrDockSlot(m, targetSlot);
  slot.ship = shipRecIdx;
  slot.flags = targetSlot < 10 ? ShipSlotFlag.ACTIVE : ShipSlotFlag.BUILDING;
  slot.maxDurability = dur & 0xff;
  slot.durability = dur & 0xff;
  slot.turn = stype.turn;
  slot.propulsion = stype.propulsion;
  slot.guns = 0;
  slot.crew = 0;

  let capId = m.globals.hero;
  if (targetSlot < 10) {
    const usedCaps = new Set<number>();
    for (let i = 0; i < GameConst.FLEET_SHIPS; i++) {
      if (i === targetSlot) continue;
      const ss = heroOrDockSlot(m, i);
      if ((ss.flags & ShipSlotFlag.STATE_MASK) === ShipSlotFlag.ACTIVE) usedCaps.add(m.crewSlot(i).captain);
    }
    if (usedCaps.has(capId)) {
      for (let i = 0; i < GameConst.PARTY_SLOTS; i++) {
        const p = m.partyCrew(i);
        if (p !== GameConst.EMPTY_SLOT && !usedCaps.has(p)) {
          capId = p;
          break;
        }
      }
    }
  } else {
    capId = 0x80;
  }

  const cs = m.crewSlot(targetSlot);
  cs.water = 0;
  cs.food = 0;
  cs.material = 0;
  cs.ammo = 0;
  cs.navRatio = 25;
  cs.lookRatio = 50;
  cs.morale = 100;
  cs.figurehead = 0;
  cs.captain = capId;
  for (let k = 0; k < GameConst.CARGO_SLOTS; k++) {
    cs.setCargoGoods(k, GameConst.EMPTY_SLOT);
    cs.setCargoAmts(k, 0);
  }
  recalcShipSlotLoad(m, targetSlot, gunWeight);
  return true;
}

function renderShipsTab(root: HTMLElement, ctx: any): void {
  const m = ctx.state.model;
  const g = m.globals;
  const { cannons, figureheads, goods, gunWeight } = getShipHelperNames(ctx);

  let activeCount = 0;
  for (let i = 0; i < GameConst.FLEET_SHIPS; i++) {
    if ((heroOrDockSlot(m, i).flags & ShipSlotFlag.STATE_MASK) === ShipSlotFlag.ACTIVE) activeCount++;
  }
  const dockList: number[] = [];
  for (let i = 10; i < 40; i++) {
    if ((heroOrDockSlot(m, i).flags & ShipSlotFlag.STATE_MASK) !== 0) dockList.push(i);
  }

  const ctrl = document.createElement("div");
  ctrl.className = "uw2-exp-ctrl";
  const chips = makeChipRow<ShipFilter>(
    [
      ["fleet", `我方现役 (${activeCount})`],
      ["dock", `船坞/建造 (${dockList.length})`],
      ["all_slots", "舰队全船位 (10)"],
    ],
    state.shipFilter,
    v => { state.shipFilter = v; renderContents(); },
  );

  // 新增舰船快捷栏
  const addBar = document.createElement("div");
  addBar.className = "uw2-group";
  const typeSel = document.createElement("select");
  typeSel.className = "uw2-input";
  for (let t = 0; t < 25; t++) {
    const o = document.createElement("option");
    o.value = String(t);
    o.textContent = `${t}: ${decText(ctx, m.ship(40 + t).nameBytes) || `船型 #${t}`}`;
    if (state.newShipType === t) o.selected = true;
    typeSel.appendChild(o);
  }
  typeSel.addEventListener("change", () => { state.newShipType = Number(typeSel.value) || 0; });

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "uw2-btn uw2-btn-primary";
  addBtn.textContent = "新建加入舰队";
  addBtn.addEventListener("click", () => {
    let freeSlot = -1;
    for (let i = 0; i < GameConst.FLEET_SHIPS; i++) {
      if ((heroOrDockSlot(m, i).flags & ShipSlotFlag.STATE_MASK) === 0) {
        freeSlot = i;
        break;
      }
    }
    if (freeSlot < 0) {
      syncGameVisuals(ctx, "舰队 10 个船位已满，请先移除或清空一个船位");
      return;
    }
    if (!spawnShipIntoSlot(ctx, freeSlot, state.newShipType, gunWeight)) {
      syncGameVisuals(ctx, "全局船只记录池 (40 艘) 已满");
      return;
    }
    state.selectedShipSlot = freeSlot;
    if (state.shipFilter === "dock") state.shipFilter = "fleet";
    syncGameVisuals(ctx, `已在船位 #${freeSlot + 1} 新建舰船`);
    renderContents();
  });
  addBar.append(typeSel, addBtn);
  ctrl.append(chips, addBar);

  const visibleSlots: number[] = [];
  if (state.shipFilter === "fleet") {
    for (let i = 0; i < GameConst.FLEET_SHIPS; i++) {
      if ((heroOrDockSlot(m, i).flags & ShipSlotFlag.STATE_MASK) === ShipSlotFlag.ACTIVE) visibleSlots.push(i);
    }
  } else if (state.shipFilter === "dock") {
    visibleSlots.push(...dockList);
  } else {
    for (let i = 0; i < GameConst.FLEET_SHIPS; i++) visibleSlots.push(i);
  }
  if (!visibleSlots.includes(state.selectedShipSlot) && visibleSlots.length) {
    state.selectedShipSlot = visibleSlots[0];
  }

  const split = document.createElement("div");
  split.className = "uw2-split narrow-left";
  const left = document.createElement("div");
  left.className = "uw2-list-col uw2-exp-list";
  for (const sIdx of visibleSlots) {
    const slotView = heroOrDockSlot(m, sIdx);
    const hasShip = (slotView.flags & ShipSlotFlag.STATE_MASK) !== 0 && slotView.ship < 40;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `uw2-row-card ${sIdx === state.selectedShipSlot ? "selected" : ""}`;
    if (hasShip) {
      const rec = m.ship(slotView.ship);
      const sName = decText(ctx, rec.nameBytes) || `船只 #${slotView.ship}`;
      const tName = decText(ctx, m.ship(40 + rec.type).nameBytes);
      const cs = m.crewSlot(sIdx);
      const capName = cs.captain < WorldConst.TOTAL_PERSONS ? decText(ctx, m.person(cs.captain).givenNameBytes) : "保管中";
      btn.innerHTML = `<span style="font-weight:700;">#${sIdx + 1} ${sName}</span>`
        + `<span class="uw2-slot-sub">${tName} · 耐久${slotView.durability}/${slotView.maxDurability} · 水手${slotView.crew}/${rec.maxCrew} · ${capName}</span>`;
    } else {
      btn.innerHTML = `<span style="font-weight:700;">#${sIdx + 1}（空船位）</span><span class="uw2-slot-sub">可在此新增舰船</span>`;
    }
    btn.addEventListener("click", () => { state.selectedShipSlot = sIdx; renderContents(); });
    left.appendChild(btn);
  }
  if (!visibleSlots.length) {
    const empty = document.createElement("div");
    empty.className = "uw2-tut-empty";
    empty.textContent = "当前筛选下无舰船（可上方选择船型并点击「新建加入舰队」）";
    left.appendChild(empty);
  }

  const right = document.createElement("div");
  right.className = "uw2-pane";
  const sIdx = state.selectedShipSlot;
  const slotView = heroOrDockSlot(m, sIdx);
  const isOccupied = (slotView.flags & ShipSlotFlag.STATE_MASK) !== 0 && slotView.ship < 40;

  if (!visibleSlots.includes(sIdx)) {
    const emptyR = document.createElement("div");
    emptyR.className = "uw2-tut-empty";
    emptyR.textContent = "暂无选中船只";
    right.appendChild(emptyR);
  } else if (!isOccupied) {
    const box = document.createElement("div");
    box.className = "uw2-action-box";
    const info = document.createElement("div");
    info.className = "uw2-exp-sub";
    info.textContent = `船位 #${sIdx + 1} 当前为空，可使用上方所选船型直接配置一艘新船。`;
    const mkBtn = document.createElement("button");
    mkBtn.type = "button";
    mkBtn.className = "uw2-btn uw2-btn-primary";
    mkBtn.textContent = `在船位 #${sIdx + 1} 新建舰船`;
    mkBtn.addEventListener("click", () => {
      if (spawnShipIntoSlot(ctx, sIdx, state.newShipType, gunWeight)) {
        syncGameVisuals(ctx, `已在船位 #${sIdx + 1} 新建舰船`);
        renderContents();
      }
    });
    box.append(info, mkBtn);
    right.appendChild(box);
  } else {
    const rec = m.ship(slotView.ship);
    const cs = m.crewSlot(sIdx);
    const curShipName = decText(ctx, rec.nameBytes);

    // 1. 头部：船图、改名与快捷操作
    const headBox = document.createElement("div");
    headBox.className = "uw2-action-box";
    headBox.style.cssText = "flex-direction:row;align-items:center;gap:12px;";
    const shipImgUrl = ctx.art?.shipUrl?.(rec.type);
    if (shipImgUrl) {
      const img = document.createElement("img");
      img.src = shipImgUrl;
      img.style.cssText = "width:96px;height:72px;object-fit:contain;border-radius:8px;background:#102036;border:1px solid rgba(154,119,56,0.45);padding:4px;";
      headBox.appendChild(img);
    }
    const hRight = document.createElement("div");
    hRight.style.cssText = "flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;";
    const nameRow = document.createElement("div");
    nameRow.className = "uw2-group";
    const nameInp = document.createElement("input");
    nameInp.type = "text";
    nameInp.className = "uw2-input";
    nameInp.maxLength = 14;
    nameInp.value = curShipName;
    nameInp.style.maxWidth = "180px";
    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "uw2-btn";
    renameBtn.textContent = "改名";
    renameBtn.addEventListener("click", () => {
      const txt = nameInp.value.trim();
      if (!txt || !ctx.font) return;
      try {
        writeShipName(rec, ctx.font.encode(txt));
        syncGameVisuals(ctx, `已改名为 ${txt}`);
        renderContents();
      } catch {
        syncGameVisuals(ctx, "船名含字库未收录字符，未能改名");
      }
    });
    nameRow.append(nameInp, renameBtn);

    const actRow = document.createElement("div");
    actRow.className = "uw2-group";
    const fullBtn = document.createElement("button");
    fullBtn.type = "button";
    fullBtn.className = "uw2-btn uw2-btn-primary";
    fullBtn.textContent = "一键满状态";
    fullBtn.addEventListener("click", () => {
      slotView.durability = slotView.maxDurability;
      slotView.crew = rec.maxCrew;
      slotView.guns = rec.maxGuns;
      cs.morale = 100;
      const room = Math.max(0, rec.maxCargo - computeSlotCargoUsed(m, sIdx));
      if (room >= 20) {
        const share = Math.min(200, Math.floor(room / 3));
        cs.water += share * 10;
        cs.food += share * 10;
        cs.material += Math.min(40, room - share * 2);
      }
      recalcShipSlotLoad(m, sIdx, gunWeight);
      syncGameVisuals(ctx, `${curShipName || "舰船"} 已补满耐久、水手与武装`);
      renderContents();
    });

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "uw2-btn";
    resetBtn.textContent = "按船型重置上限";
    resetBtn.addEventListener("click", () => {
      const t = Math.max(0, Math.min(24, rec.type));
      const tmpl = m.ship(40 + t);
      const stype = m.shipType(t);
      rec.flags = tmpl.flags;
      rec.maxGuns = tmpl.maxGuns;
      rec.maxCrew = tmpl.maxCrew;
      rec.maxCargo = Math.max(0, stype.capacity - rec.maxGuns - rec.maxCrew);
      const d0 = Math.trunc((9 * stype.durability) / 10);
      const dur = Math.max(10, d0 - Math.trunc((d0 & 0xff) / 15));
      slotView.maxDurability = dur & 0xff;
      slotView.durability = dur & 0xff;
      slotView.turn = stype.turn;
      slotView.propulsion = stype.propulsion;
      recalcShipSlotLoad(m, sIdx, gunWeight);
      syncGameVisuals(ctx, "已按当前船型规格刷新上限与基准性能");
      renderContents();
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "uw2-btn";
    delBtn.textContent = "移除此船";
    delBtn.addEventListener("click", () => {
      rec.type = GameConst.EMPTY_SLOT;
      slotView.flags = 0;
      slotView.ship = GameConst.EMPTY_SLOT;
      slotView.crew = 0;
      slotView.guns = 0;
      cs.loadTotal = 0;
      syncGameVisuals(ctx, `已清空船位 #${sIdx + 1}`);
      renderContents();
    });

    actRow.append(fullBtn, resetBtn, delBtn);
    hRight.append(nameRow, actRow);
    headBox.appendChild(hRight);

    // 2. 船型、船长、武装与性能属性
    const specBox = document.createElement("div");
    specBox.className = "uw2-action-box";
    const specTitle = document.createElement("div");
    specTitle.className = "uw2-pane-title";
    specTitle.textContent = `船位 #${sIdx + 1} · 船体、武装与船员参数`;
    const specFields = document.createElement("div");
    specFields.className = "uw2-exp-fields";

    const shipTypeField = document.createElement("div");
    shipTypeField.className = "uw2-exp-field";
    const stl = document.createElement("label"); stl.textContent = "船种";
    const stSel = document.createElement("select"); stSel.className = "uw2-input";
    for (let t = 0; t < 25; t++) {
      const o = document.createElement("option");
      o.value = String(t);
      o.textContent = decText(ctx, m.ship(40 + t).nameBytes) || `船型 #${t}`;
      if (rec.type === t) o.selected = true;
      stSel.appendChild(o);
    }
    stSel.addEventListener("change", () => {
      rec.type = Number(stSel.value) & 0xff;
      syncGameVisuals(ctx);
      renderContents();
    });
    shipTypeField.append(stl, stSel);

    // 船长选项：主角 + 在队成员 + 当前船长
    const capCandidates = new Set<number>([g.hero]);
    for (let i = 0; i < GameConst.PARTY_SLOTS; i++) {
      const pid = m.partyCrew(i);
      if (pid !== GameConst.EMPTY_SLOT) capCandidates.add(pid);
    }
    if (cs.captain < WorldConst.TOTAL_PERSONS) capCandidates.add(cs.captain);
    const capField = document.createElement("div");
    capField.className = "uw2-exp-field";
    const capLbl = document.createElement("label"); capLbl.textContent = "船长";
    const capSel = document.createElement("select"); capSel.className = "uw2-input";
    if (cs.captain >= WorldConst.TOTAL_PERSONS) {
      const o = document.createElement("option");
      o.value = String(cs.captain);
      o.textContent = `保管/建造 (${cs.captain})`;
      o.selected = true;
      capSel.appendChild(o);
    }
    for (const pid of capCandidates) {
      const pv = m.person(pid);
      const o = document.createElement("option");
      o.value = String(pid);
      o.textContent = `#${pid} ${decText(ctx, pv.givenNameBytes)}`;
      if (cs.captain === pid) o.selected = true;
      capSel.appendChild(o);
    }
    capSel.addEventListener("change", () => {
      cs.captain = Number(capSel.value) & 0xff;
      syncGameVisuals(ctx);
    });
    capField.append(capLbl, capSel);

    const gunField = document.createElement("div");
    gunField.className = "uw2-exp-field";
    const gunLbl = document.createElement("label"); gunLbl.textContent = "炮种";
    const gunSel = document.createElement("select"); gunSel.className = "uw2-input";
    cannons.forEach((cn, idx) => {
      const o = document.createElement("option");
      o.value = String(idx);
      o.textContent = cn;
      if ((slotView.flags & ShipSlotFlag.CANNON_MASK) === idx) o.selected = true;
      gunSel.appendChild(o);
    });
    gunSel.addEventListener("change", () => {
      slotView.flags = (slotView.flags & ~ShipSlotFlag.CANNON_MASK) | (Number(gunSel.value) & ShipSlotFlag.CANNON_MASK);
      recalcShipSlotLoad(m, sIdx, gunWeight);
      syncGameVisuals(ctx);
      renderContents();
    });
    gunField.append(gunLbl, gunSel);

    const figField = document.createElement("div");
    figField.className = "uw2-exp-field";
    const figLbl = document.createElement("label"); figLbl.textContent = "船首像";
    const figSel = document.createElement("select"); figSel.className = "uw2-input";
    figureheads.forEach((fn, idx) => {
      const o = document.createElement("option");
      o.value = String(idx);
      o.textContent = fn;
      if (cs.figurehead === idx) o.selected = true;
      figSel.appendChild(o);
    });
    figSel.addEventListener("change", () => {
      cs.figurehead = Number(figSel.value) & 0xff;
      syncGameVisuals(ctx);
    });
    figField.append(figLbl, figSel);

    specFields.append(
      shipTypeField,
      capField,
      gunField,
      figField,
      makeNumEditor("当前耐久", slotView.durability, 0, 255, v => { slotView.durability = v; syncGameVisuals(ctx); }),
      makeNumEditor("最大耐久", slotView.maxDurability, 1, 255, v => { slotView.maxDurability = v; syncGameVisuals(ctx); }),
      makeNumEditor("转向力", slotView.turn, 0, 255, v => { slotView.turn = v; syncGameVisuals(ctx); }),
      makeNumEditor("推进力", slotView.propulsion, 0, 255, v => { slotView.propulsion = v; syncGameVisuals(ctx); }),
      makeNumEditor("当前水手", slotView.crew, 0, 9999, v => {
        slotView.crew = v;
        recalcShipSlotLoad(m, sIdx, gunWeight);
        syncGameVisuals(ctx);
      }),
      makeNumEditor("水手上限", rec.maxCrew, 1, 9999, v => { rec.maxCrew = v; syncGameVisuals(ctx); }),
      makeNumEditor("当前火炮", slotView.guns, 0, 255, v => {
        slotView.guns = v;
        recalcShipSlotLoad(m, sIdx, gunWeight);
        syncGameVisuals(ctx);
      }),
      makeNumEditor("火炮上限", rec.maxGuns, 0, 255, v => { rec.maxGuns = v; syncGameVisuals(ctx); }),
      makeNumEditor("货舱上限", rec.maxCargo, 0, 9999, v => { rec.maxCargo = v; syncGameVisuals(ctx); }),
      makeNumEditor("船体材质标志", rec.flags, 0, 255, v => { rec.flags = v; syncGameVisuals(ctx); }),
      makeNumEditor("水手士气", cs.morale, 0, 100, v => { cs.morale = v; syncGameVisuals(ctx); }),
      makeNumEditor("驾驶比例 %", cs.navRatio, 0, 100, v => { cs.navRatio = v; syncGameVisuals(ctx); }),
      makeNumEditor("瞭望比例 %", cs.lookRatio, 0, 100, v => { cs.lookRatio = v; syncGameVisuals(ctx); }),
    );
    specBox.append(specTitle, specFields);

    // 3. 补给与 5 格货舱
    const cargoBox = document.createElement("div");
    cargoBox.className = "uw2-action-box";
    const usedCargo = computeSlotCargoUsed(m, sIdx);
    const cargoTitle = document.createElement("div");
    cargoTitle.className = "uw2-pane-title";
    cargoTitle.textContent = `补给与货舱积载（已用 ${usedCargo} / ${rec.maxCargo} · 总载重 ${cs.loadTotal}）`;

    const supFields = document.createElement("div");
    supFields.className = "uw2-exp-fields";
    const updateSup = (fn: () => void) => {
      fn();
      recalcShipSlotLoad(m, sIdx, gunWeight);
      syncGameVisuals(ctx);
      renderContents();
    };
    supFields.append(
      makeNumEditor("水 (桶)", Math.floor(cs.water / 10), 0, 5000, v => updateSup(() => { cs.water = v * 10; })),
      makeNumEditor("粮食 (桶)", Math.floor(cs.food / 10), 0, 5000, v => updateSup(() => { cs.food = v * 10; })),
      makeNumEditor("资材", cs.material, 0, 5000, v => updateSup(() => { cs.material = v; })),
      makeNumEditor("炮弹", cs.ammo, 0, 5000, v => updateSup(() => { cs.ammo = v; })),
    );

    const holdWrap = document.createElement("div");
    holdWrap.style.cssText = "display:flex;flex-direction:column;gap:6px;margin-top:4px;";
    for (let k = 0; k < GameConst.CARGO_SLOTS; k++) {
      const row = document.createElement("div");
      row.className = "uw2-group";
      const lbl = document.createElement("span");
      lbl.style.cssText = "min-width:54px;font-size:12px;font-weight:700;";
      lbl.textContent = `货格 ${k + 1}`;
      const gSel = document.createElement("select");
      gSel.className = "uw2-input";
      const emptyOpt = document.createElement("option");
      emptyOpt.value = String(GameConst.EMPTY_SLOT);
      emptyOpt.textContent = "（空）";
      if (cs.getCargoGoods(k) === GameConst.EMPTY_SLOT) emptyOpt.selected = true;
      gSel.appendChild(emptyOpt);
      goods.forEach((gn, gi) => {
        const o = document.createElement("option");
        o.value = String(gi);
        o.textContent = gn;
        if (cs.getCargoGoods(k) === gi) o.selected = true;
        gSel.appendChild(o);
      });
      const amtInp = document.createElement("input");
      amtInp.type = "number";
      amtInp.min = "0";
      amtInp.max = "9999";
      amtInp.className = "uw2-input";
      amtInp.style.maxWidth = "96px";
      amtInp.value = String(cs.getCargoAmts(k));

      gSel.addEventListener("change", () => {
        const gv = Number(gSel.value) & 0xff;
        cs.setCargoGoods(k, gv);
        if (gv === GameConst.EMPTY_SLOT) cs.setCargoAmts(k, 0);
        else if (cs.getCargoAmts(k) <= 0) cs.setCargoAmts(k, 10);
        recalcShipSlotLoad(m, sIdx, gunWeight);
        syncGameVisuals(ctx);
        renderContents();
      });
      amtInp.addEventListener("change", () => {
        const av = Math.max(0, Math.min(9999, Math.round(Number(amtInp.value) || 0)));
        cs.setCargoAmts(k, av);
        if (av === 0) cs.setCargoGoods(k, GameConst.EMPTY_SLOT);
        recalcShipSlotLoad(m, sIdx, gunWeight);
        syncGameVisuals(ctx);
        renderContents();
      });
      row.append(lbl, gSel, amtInp);
      holdWrap.appendChild(row);
    }

    cargoBox.append(cargoTitle, supFields, holdWrap);
    right.append(headBox, specBox, cargoBox);
  }

  split.append(left, right);
  root.append(ctrl, split);
}
