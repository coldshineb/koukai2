// ui/save_modal.ts — 现代无限槽位存盘工作台（IndexedDB 本地保存 + 导出 JSON + 导入 JSON/原版 KOUKAI2.DAT 自由选槽）
import type { SaveSlotV2 } from "../save/format.ts";
import type { InspectedImport } from "../save/store.ts";
import { createDomModal, preserveScroll } from "./modals.ts";

export interface SaveModalBridge {
  getSlots: () => Promise<Array<SaveSlotV2 | null>>;
  getAutoSave: () => Promise<SaveSlotV2 | null>;
  deleteSlot: (slotIndex: number) => Promise<void>;
  exportJson: (slotIndex?: number, stripCompat?: boolean) => Promise<string>;
  inspectImportBuffer: (buf: ArrayBuffer) => Promise<InspectedImport>;
  importSlots: (items: Array<{ slot: SaveSlotV2; targetIndex: number }>, heroId?: number) => Promise<number>;
  importBuffer: (buf: ArrayBuffer, targetSlot?: number) => Promise<{ kind: string; importedSlots: number }>;
  onToast: (msg: string) => void;
}

function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function formatSavedAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export type SaveModalMode = "manage" | "load" | "save";

interface PendingImportState {
  fileName: string;
  inspected: InspectedImport;
  selected: boolean[];
  targetMode: "append" | "slot";
  targetStart: number;
}

export class ModernSaveModal {
  private readonly bridge: SaveModalBridge;
  private active = false;

  constructor(bridge: SaveModalBridge) {
    this.bridge = bridge;
  }

  open(mode: SaveModalMode = "manage"): Promise<number | "auto" | null> {
    if (this.active) return Promise.resolve(null);
    this.active = true;

    return new Promise(resolve => {
      let settled = false;
      let selKey: number | "auto" | "new" = "auto";
      let notice = "";
      let pendingImport: PendingImportState | null = null;
      let cachedSlots: Array<SaveSlotV2 | null> = [];
      let cachedAuto: SaveSlotV2 | null = null;

      const finish = (result: number | "auto" | null) => {
        if (settled) return;
        settled = true;
        this.active = false;
        h.close();
        resolve(result);
      };

      const titleText = mode === "load" ? "读取进度" : mode === "save" ? "保存进度" : "存档管理";
      const h = createDomModal({
        title: titleText,
        size: "wide",
        cancelable: true,
        closeLabel: "关闭",
        onCancel: () => finish(null),
      });

      const countPill = document.createElement("span");
      countPill.className = "uw2-pill";
      h.headerRight.prepend(countPill);

      const toolbar = document.createElement("div");
      toolbar.className = "uw2-modal-toolbar";
      h.modal.insertBefore(toolbar, h.body);

      const footer = document.createElement("div");
      footer.className = "uw2-modal-footer";
      const toastEl = document.createElement("span");
      toastEl.style.cssText = "font-size:13px;font-weight:600;color:#247544;";
      footer.appendChild(toastEl);
      h.modal.appendChild(footer);

      const nextAppendIndex = () => {
        let lastUsed = -1;
        for (let i = 0; i < cachedSlots.length; i++) {
          if (cachedSlots[i]) lastUsed = i;
        }
        return lastUsed + 1;
      };

      const pickImportFile = () => {
        const inp = document.createElement("input");
        inp.type = "file";
        inp.accept = ".json,.dat,.DAT";
        inp.onchange = async () => {
          const file = inp.files?.[0];
          if (!file) return;
          try {
            const buf = await file.arrayBuffer();
            const inspected = await this.bridge.inspectImportBuffer(buf);
            if (!inspected.entries.length) {
              notice = "未找到有效存档";
              render();
              return;
            }
            pendingImport = {
              fileName: file.name,
              inspected,
              selected: inspected.entries.map(() => true),
              targetMode: "append",
              targetStart: nextAppendIndex(),
            };
            notice = `${file.name}（${inspected.entries.length} 份）`;
            render();
          } catch (e: any) {
            notice = "导入失败：" + (e?.message ?? e);
            render();
          }
        };
        inp.click();
      };

      const reloadData = async (pickDefault = false) => {
        const [slots, auto] = await Promise.all([this.bridge.getSlots(), this.bridge.getAutoSave()]);
        cachedSlots = slots;
        cachedAuto = auto;
        if (pickDefault) {
          if (mode === "load") {
            if (auto) selKey = "auto";
            else {
              const first = slots.findIndex(Boolean);
              selKey = first >= 0 ? first : 0;
            }
          } else if (mode === "save") {
            selKey = "new";
          } else {
            const first = slots.findIndex(Boolean);
            selKey = first >= 0 ? first : (auto ? "auto" : 0);
          }
        }
        render();
      };

      const render = () => preserveScroll(h.body, () => {
        const usedCount = cachedSlots.filter(Boolean).length;
        countPill.textContent = `存档 ${usedCount}`;
        toastEl.textContent = notice;

        // 顶部工具列（统一使用 uw2-tab-btn / uw2-btn-primary）
        toolbar.innerHTML = "";
        if (mode === "save" && !pendingImport) {
          const newSaveBtn = document.createElement("button");
          newSaveBtn.className = "uw2-btn uw2-btn-primary";
          newSaveBtn.textContent = `+ 新建存档 (槽位 ${nextAppendIndex() + 1})`;
          newSaveBtn.addEventListener("click", () => finish(nextAppendIndex()));
          toolbar.appendChild(newSaveBtn);
        }

        const importBtn = document.createElement("button");
        importBtn.className = `uw2-tab-btn ${pendingImport ? "active" : ""}`;
        importBtn.textContent = "导入存档";
        importBtn.addEventListener("click", pickImportFile);
        toolbar.appendChild(importBtn);

        const exportAllBtn = document.createElement("button");
        exportAllBtn.className = "uw2-tab-btn";
        exportAllBtn.disabled = usedCount === 0 && !cachedAuto;
        exportAllBtn.textContent = "导出全部";
        exportAllBtn.addEventListener("click", async () => {
          try {
            const text = await this.bridge.exportJson(undefined, false);
            downloadText("uw2-saves-v2.json", text);
            notice = "已导出 uw2-saves-v2.json";
            this.bridge.onToast(notice);
            render();
          } catch (e: any) {
            notice = "导出失败：" + (e?.message ?? e);
            render();
          }
        });
        toolbar.appendChild(exportAllBtn);

        h.body.innerHTML = "";

        // ---- 导入槽位挑选模式 ----
        if (pendingImport) {
          const imp = pendingImport;
          const kindLabel = imp.inspected.kind === "legacy-dat"
            ? "KOUKAI2.DAT"
            : imp.inspected.kind === "json-bundle"
              ? "JSON 存档包"
              : "JSON 存档";

          const split = document.createElement("div");
          split.className = "uw2-split";

          const left = document.createElement("div");
          left.className = "uw2-pane";
          const lt = document.createElement("div");
          lt.className = "uw2-pane-title";
          lt.textContent = kindLabel;
          left.appendChild(lt);

          const list = document.createElement("div");
          list.className = "uw2-list-col";
          imp.inspected.entries.forEach((entry, idx) => {
            const s = entry.slot.summary;
            const row = document.createElement("button");
            row.className = `uw2-row-card ${imp.selected[idx] ? "selected" : ""}`;
            row.innerHTML =
              `<span class="uw2-item-name">${imp.selected[idx] ? "☑" : "☐"} 槽位 ${entry.sourceIndex + 1} · ${s.heroName || "主角 #" + (s.heroId + 1)}</span>` +
              `<span class="uw2-item-meta">${s.dateStr} · ${s.portName}</span>`;
            row.addEventListener("click", () => {
              imp.selected[idx] = !imp.selected[idx];
              render();
            });
            list.appendChild(row);
          });
          left.appendChild(list);

          const right = document.createElement("div");
          right.className = "uw2-pane";
          const rt = document.createElement("div");
          rt.className = "uw2-pane-title";
          rt.textContent = "目标槽位";
          right.appendChild(rt);

          const box = document.createElement("div");
          box.className = "uw2-action-box";

          const chosenCount = imp.selected.filter(Boolean).length;
          const appendIdx = nextAppendIndex();

          const modeRow = document.createElement("div");
          modeRow.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;";
          const btnAppend = document.createElement("button");
          btnAppend.className = `uw2-tab-btn ${imp.targetMode === "append" ? "active" : ""}`;
          btnAppend.textContent = `追加到末尾（槽位 ${appendIdx + 1} 起）`;
          btnAppend.addEventListener("click", () => {
            imp.targetMode = "append";
            imp.targetStart = appendIdx;
            render();
          });
          const btnSlot = document.createElement("button");
          btnSlot.className = `uw2-tab-btn ${imp.targetMode === "slot" ? "active" : ""}`;
          btnSlot.textContent = "指定槽位";
          btnSlot.addEventListener("click", () => {
            imp.targetMode = "slot";
            render();
          });
          modeRow.append(btnAppend, btnSlot);
          box.appendChild(modeRow);

          if (imp.targetMode === "slot") {
            const pickRow = document.createElement("div");
            pickRow.className = "uw2-kv-row";
            const lbl = document.createElement("span");
            lbl.className = "uw2-kv-label";
            lbl.textContent = chosenCount > 1 ? "起始槽位" : "目标槽位";
            const sel = document.createElement("select");
            sel.style.cssText = "padding:6px 10px;border:1px solid var(--uw2-gold);border-radius:6px;background:#fffdf6;color:var(--uw2-ink);font-size:13px;font-weight:700;";
            const maxOpt = Math.max(cachedSlots.length + 5, 15, imp.targetStart + 2);
            for (let i = 0; i < maxOpt; i++) {
              const ex = cachedSlots[i];
              const opt = document.createElement("option");
              opt.value = String(i);
              opt.textContent = ex
                ? `槽位 ${i + 1} · ${ex.summary.heroName} (${ex.summary.dateStr})`
                : `槽位 ${i + 1}（空）`;
              if (i === imp.targetStart) opt.selected = true;
              sel.appendChild(opt);
            }
            sel.addEventListener("change", () => {
              imp.targetStart = Number(sel.value);
              render();
            });
            pickRow.append(lbl, sel);
            box.appendChild(pickRow);
          }

          const startIdx = imp.targetMode === "append" ? appendIdx : imp.targetStart;
          const rangeRow = document.createElement("div");
          rangeRow.className = "uw2-kv-row";
          rangeRow.innerHTML =
            `<span class="uw2-kv-label">导入范围</span>` +
            `<span class="uw2-kv-val">${chosenCount === 0 ? "—" : chosenCount === 1 ? `槽位 ${startIdx + 1}` : `槽位 ${startIdx + 1} ～ ${startIdx + chosenCount}`}</span>`;
          box.appendChild(rangeRow);

          const actRow = document.createElement("div");
          actRow.style.cssText = "display:flex;gap:10px;align-items:center;";
          const okBtn = document.createElement("button");
          okBtn.className = "uw2-btn uw2-btn-primary";
          okBtn.style.padding = "8px 22px";
          okBtn.disabled = chosenCount === 0;
          okBtn.textContent = `确认导入 (${chosenCount})`;
          okBtn.addEventListener("click", async () => {
            const items: Array<{ slot: SaveSlotV2; targetIndex: number }> = [];
            let offset = 0;
            imp.inspected.entries.forEach((entry, idx) => {
              if (!imp.selected[idx]) return;
              items.push({ slot: entry.slot, targetIndex: startIdx + offset });
              offset++;
            });
            try {
              const count = await this.bridge.importSlots(items, imp.inspected.heroId);
              pendingImport = null;
              selKey = startIdx;
              notice = `已导入 ${count} 份（槽位 ${startIdx + 1}${count > 1 ? `～${startIdx + count}` : ""}）`;
              this.bridge.onToast(notice);
              await reloadData(false);
            } catch (e: any) {
              notice = "导入失败：" + (e?.message ?? e);
              render();
            }
          });
          const cancelImpBtn = document.createElement("button");
          cancelImpBtn.className = "uw2-step-btn";
          cancelImpBtn.style.padding = "8px 18px";
          cancelImpBtn.textContent = "取消";
          cancelImpBtn.addEventListener("click", () => {
            pendingImport = null;
            notice = "";
            render();
          });
          actRow.append(okBtn, cancelImpBtn);
          box.appendChild(actRow);

          right.appendChild(box);
          split.append(left, right);
          h.body.appendChild(split);
          return;
        }

        // ---- 常规浏览 / 读取 / 保存模式 ----
        const split = document.createElement("div");
        split.className = "uw2-split";

        const left = document.createElement("div");
        left.className = "uw2-pane";
        const lt = document.createElement("div");
        lt.className = "uw2-pane-title";
        lt.textContent = "存档列表";
        left.appendChild(lt);

        const list = document.createElement("div");
        list.className = "uw2-list-col";
        list.style.maxHeight = "390px";

        const addRow = (key: number | "auto" | "new", nameHtml: string, metaText: string, empty = false) => {
          const row = document.createElement("button");
          row.className = `uw2-row-card ${selKey === key ? "selected" : ""}`;
          if (empty) row.style.opacity = "0.72";
          row.innerHTML = `<span class="uw2-item-name">${nameHtml}</span><span class="uw2-item-meta">${metaText}</span>`;
          row.addEventListener("click", () => { selKey = key; render(); });
          row.addEventListener("dblclick", () => {
            if (mode === "load" && !empty && key !== "new") finish(key);
            else if (mode === "save" && key !== "auto") finish(key === "new" ? nextAppendIndex() : key);
          });
          list.appendChild(row);
        };

        if (cachedAuto && mode !== "save") {
          const s = cachedAuto.summary;
          addRow("auto", `自动 · ${s.heroName || "主角 #" + (s.heroId + 1)}`, `${s.dateStr} · ${s.portName}`);
        }

        const displayCount = Math.max(cachedSlots.length, mode === "save" ? 1 : 0);
        for (let i = 0; i < displayCount; i++) {
          const slot = cachedSlots[i];
          if (!slot && mode === "load") continue;
          if (!slot && mode === "manage" && i >= 10) continue;
          if (!slot) {
            addRow(i, `槽位 ${i + 1}`, "空", true);
          } else {
            const s = slot.summary;
            addRow(i, `槽位 ${i + 1} · ${s.heroName || "主角 #" + (s.heroId + 1)}`, `${s.dateStr} · ${s.portName}`);
          }
        }

        if (mode === "save") {
          addRow("new", `+ 槽位 ${nextAppendIndex() + 1}`, "新建", false);
        }

        if (list.childElementCount === 0) {
          const emptyBox = document.createElement("div");
          emptyBox.className = "uw2-item-meta";
          emptyBox.style.padding = "12px 4px";
          emptyBox.textContent = "暂无存档";
          list.appendChild(emptyBox);
        }
        left.appendChild(list);

        const right = document.createElement("div");
        right.className = "uw2-pane";
        const rt = document.createElement("div");
        rt.className = "uw2-pane-title";
        rt.textContent = "详情";
        right.appendChild(rt);

        const box = document.createElement("div");
        box.className = "uw2-action-box";

        const curSlot: SaveSlotV2 | null = selKey === "auto"
          ? cachedAuto
          : selKey === "new"
            ? null
            : (cachedSlots[selKey] ?? null);

        if (selKey === "new") {
          const idx = nextAppendIndex();
          box.innerHTML = `<div class="uw2-detail-title">槽位 ${idx + 1}</div>`;
          const btn = document.createElement("button");
          btn.className = "uw2-btn uw2-btn-primary";
          btn.style.cssText = "padding:8px 24px;align-self:flex-start;";
          btn.textContent = "保存";
          btn.addEventListener("click", () => finish(idx));
          box.appendChild(btn);
        } else if (!curSlot) {
          const idx = typeof selKey === "number" ? selKey : 0;
          box.innerHTML = `<div class="uw2-detail-title">槽位 ${idx + 1}</div><div class="uw2-detail-sub">空槽位</div>`;
          if (mode === "save") {
            const btn = document.createElement("button");
            btn.className = "uw2-btn uw2-btn-primary";
            btn.style.cssText = "padding:8px 24px;align-self:flex-start;";
            btn.textContent = "保存";
            btn.addEventListener("click", () => finish(idx));
            box.appendChild(btn);
          }
        } else {
          const s = curSlot.summary;
          const label = selKey === "auto" ? "自动存档" : `槽位 ${selKey + 1}`;
          const savedTime = formatSavedAt(s.savedAt);
          box.innerHTML =
            `<div class="uw2-detail-title">${label} · ${s.heroName || "主角 #" + (s.heroId + 1)}</div>` +
            `<div class="uw2-kv-row"><span class="uw2-kv-label">日期</span><span class="uw2-kv-val">${s.dateStr}</span></div>` +
            `<div class="uw2-kv-row"><span class="uw2-kv-label">港口</span><span class="uw2-kv-val">${s.portName}</span></div>` +
            `<div class="uw2-kv-row"><span class="uw2-kv-label">资金</span><span class="uw2-item-price">金块 ${Math.trunc(s.money / 10000)} · 金币 ${(s.money % 10000).toLocaleString("zh-CN")}</span></div>` +
            (savedTime ? `<div class="uw2-kv-row"><span class="uw2-kv-label">保存</span><span class="uw2-kv-val">${savedTime}</span></div>` : "");

          const actRow = document.createElement("div");
          actRow.style.cssText = "display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;";

          if (mode === "load") {
            const loadBtn = document.createElement("button");
            loadBtn.className = "uw2-btn uw2-btn-primary";
            loadBtn.style.padding = "8px 24px";
            loadBtn.textContent = "读取";
            loadBtn.addEventListener("click", () => finish(selKey as number | "auto"));
            actRow.appendChild(loadBtn);
          } else if (mode === "save" && typeof selKey === "number") {
            const saveBtn = document.createElement("button");
            saveBtn.className = "uw2-btn uw2-btn-primary";
            saveBtn.style.padding = "8px 24px";
            saveBtn.textContent = "覆盖";
            saveBtn.addEventListener("click", () => finish(selKey as number));
            actRow.appendChild(saveBtn);
          }

          if (typeof selKey === "number") {
            const idx = selKey;
            const expBtn = document.createElement("button");
            expBtn.className = "uw2-step-btn";
            expBtn.style.padding = "8px 16px";
            expBtn.textContent = "导出 JSON";
            expBtn.addEventListener("click", async () => {
              try {
                const text = await this.bridge.exportJson(idx, false);
                downloadText(`uw2-slot-${idx + 1}.json`, text);
                notice = `已导出 uw2-slot-${idx + 1}.json`;
                this.bridge.onToast(notice);
                render();
              } catch (e: any) {
                notice = "导出失败：" + (e?.message ?? e);
                render();
              }
            });
            actRow.appendChild(expBtn);

            const delBtn = document.createElement("button");
            delBtn.className = "uw2-step-btn";
            delBtn.style.cssText = "padding:8px 16px;color:#b83d3d;border-color:rgba(184,61,61,0.35);";
            delBtn.textContent = "删除";
            delBtn.addEventListener("click", async () => {
              await this.bridge.deleteSlot(idx);
              notice = `已删除槽位 ${idx + 1}`;
              await reloadData(true);
            });
            actRow.appendChild(delBtn);
          }

          box.appendChild(actRow);
        }

        right.appendChild(box);
        split.append(left, right);
        h.body.appendChild(split);
      });

      void reloadData(true);
    });
  }
}
