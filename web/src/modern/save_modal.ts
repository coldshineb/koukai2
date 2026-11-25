// modern/save_modal.ts — 現代無限槽位存檔工作台（瀏覽器本地 IndexedDB 儲存 + 匯出 JSON + 匯入 JSON/原版 KOUKAI2.DAT 自由選擇目標槽位）
import type { SaveSlotV2 } from "../save/format.ts";
import type { InspectedImport } from "../save/store.ts";
import { createDomModal, preserveScroll } from "./dom_ui.ts";

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
      let notice = "存档自动保存在浏览器本地，换设备可通过导出/导入 JSON 迁移。";
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
              notice = "该文件中没有可导入的有效存档。";
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
            notice = `已解析「${file.name}」，共 ${inspected.entries.length} 个存档，请选择导入槽位。`;
            render();
          } catch (e: any) {
            notice = "解析失败：" + (e?.message ?? e);
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
        countPill.textContent = `已存 ${usedCount} 份 · 不限槽位`;
        toastEl.textContent = notice;

        // 頂部工具列
        toolbar.innerHTML = "";
        if (mode === "save" && !pendingImport) {
          const newSaveBtn = document.createElement("button");
          newSaveBtn.className = "uw2-btn uw2-btn-primary";
          newSaveBtn.textContent = `+ 保存到新槽位 (槽位 ${nextAppendIndex() + 1})`;
          newSaveBtn.addEventListener("click", () => finish(nextAppendIndex()));
          toolbar.appendChild(newSaveBtn);
        }

        const importBtn = document.createElement("button");
        importBtn.className = `uw2-btn ${pendingImport ? "active" : ""}`;
        importBtn.style.cssText = "color:var(--uw2-ink);border-color:rgba(154,119,56,0.45);background:rgba(255,252,242,0.85);";
        importBtn.textContent = "导入存档 (.json / KOUKAI2.DAT)";
        importBtn.addEventListener("click", pickImportFile);
        toolbar.appendChild(importBtn);

        const exportAllBtn = document.createElement("button");
        exportAllBtn.className = "uw2-btn";
        exportAllBtn.style.cssText = "color:var(--uw2-ink);border-color:rgba(154,119,56,0.45);background:rgba(255,252,242,0.85);";
        exportAllBtn.disabled = usedCount === 0 && !cachedAuto;
        exportAllBtn.textContent = "导出全部 (.json)";
        exportAllBtn.addEventListener("click", async () => {
          try {
            const text = await this.bridge.exportJson(undefined, false);
            downloadText("uw2-saves-v2.json", text);
            notice = "已导出全部存档 (uw2-saves-v2.json)";
            this.bridge.onToast(notice);
            render();
          } catch (e: any) {
            notice = "导出失败：" + (e?.message ?? e);
            render();
          }
        });
        toolbar.appendChild(exportAllBtn);

        h.body.innerHTML = "";

        // ---- 匯入槽位挑選模式 ----
        if (pendingImport) {
          const imp = pendingImport;
          const kindLabel = imp.inspected.kind === "legacy-dat"
            ? "原版 KOUKAI2.DAT"
            : imp.inspected.kind === "json-bundle"
              ? "JSON 存档包"
              : "JSON 单槽存档";

          const split = document.createElement("div");
          split.className = "uw2-split";

          const left = document.createElement("div");
          left.className = "uw2-pane";
          const lt = document.createElement("div");
          lt.className = "uw2-pane-title";
          lt.textContent = `${kindLabel} · 勾选要导入的存档`;
          left.appendChild(lt);

          const list = document.createElement("div");
          list.className = "uw2-list-col";
          imp.inspected.entries.forEach((entry, idx) => {
            const s = entry.slot.summary;
            const row = document.createElement("button");
            row.className = `uw2-row-card ${imp.selected[idx] ? "selected" : ""}`;
            row.innerHTML =
              `<span class="uw2-item-name">${imp.selected[idx] ? "☑" : "☐"} 原槽位 ${entry.sourceIndex + 1} · ${s.heroName || "主角 #" + (s.heroId + 1)}</span>` +
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
          rt.textContent = "目标槽位设置";
          right.appendChild(rt);

          const box = document.createElement("div");
          box.className = "uw2-action-box";

          const chosenCount = imp.selected.filter(Boolean).length;
          const appendIdx = nextAppendIndex();

          const modeRow = document.createElement("div");
          modeRow.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;";
          const btnAppend = document.createElement("button");
          btnAppend.className = `uw2-tab-btn ${imp.targetMode === "append" ? "active" : ""}`;
          btnAppend.textContent = `追加到末尾新槽位（从槽位 ${appendIdx + 1} 起）`;
          btnAppend.addEventListener("click", () => {
            imp.targetMode = "append";
            imp.targetStart = appendIdx;
            render();
          });
          const btnSlot = document.createElement("button");
          btnSlot.className = `uw2-tab-btn ${imp.targetMode === "slot" ? "active" : ""}`;
          btnSlot.textContent = "指定目标槽位";
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
            lbl.textContent = chosenCount > 1 ? "起始槽位编号（可超过 10）" : "目标槽位编号（可超过 10）";
            const sel = document.createElement("select");
            sel.style.cssText = "padding:6px 10px;border:1px solid var(--uw2-gold);border-radius:6px;background:#fffdf6;color:var(--uw2-ink);font-size:13px;font-weight:700;";
            const maxOpt = Math.max(cachedSlots.length + 5, 15, imp.targetStart + 2);
            for (let i = 0; i < maxOpt; i++) {
              const ex = cachedSlots[i];
              const opt = document.createElement("option");
              opt.value = String(i);
              opt.textContent = ex
                ? `槽位 ${i + 1}（已有：${ex.summary.heroName} · ${ex.summary.dateStr}，将覆盖）`
                : `槽位 ${i + 1}（空槽位）`;
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
          const preview = document.createElement("div");
          preview.className = "uw2-speech-box";
          if (chosenCount === 0) {
            preview.textContent = "请至少勾选一个要导入的存档。";
          } else if (chosenCount === 1) {
            preview.textContent = `将把选中的 1 个存档导入到「槽位 ${startIdx + 1}」${cachedSlots[startIdx] ? "（覆盖现有存档）" : "（新槽位）"}。`;
          } else {
            preview.textContent = `将把选中的 ${chosenCount} 个存档依次导入到「槽位 ${startIdx + 1} ～ 槽位 ${startIdx + chosenCount}」。`;
          }
          box.appendChild(preview);

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
              notice = `成功导入 ${count} 个存档（槽位 ${startIdx + 1}${count > 1 ? `～${startIdx + count}` : ""}）。`;
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
          cancelImpBtn.textContent = "取消导入";
          cancelImpBtn.addEventListener("click", () => {
            pendingImport = null;
            notice = "已取消导入。";
            render();
          });
          actRow.append(okBtn, cancelImpBtn);
          box.appendChild(actRow);

          right.appendChild(box);
          split.append(left, right);
          h.body.appendChild(split);
          return;
        }

        // ---- 常規瀏覽 / 讀取 / 保存模式（左右雙欄統一工作台） ----
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
          addRow("auto", `自动存档 · ${s.heroName || "主角 #" + (s.heroId + 1)}`, `${s.dateStr} · ${s.portName}`);
        }

        const displayCount = Math.max(cachedSlots.length, mode === "save" ? 1 : 0);
        for (let i = 0; i < displayCount; i++) {
          const slot = cachedSlots[i];
          if (!slot && mode === "load") continue;
          if (!slot && mode === "manage" && i >= 10) continue;
          if (!slot) {
            addRow(i, `槽位 ${i + 1}`, "空槽位", true);
          } else {
            const s = slot.summary;
            addRow(i, `槽位 ${i + 1} · ${s.heroName || "主角 #" + (s.heroId + 1)}`, `${s.dateStr} · ${s.portName}`);
          }
        }

        if (mode === "save") {
          addRow("new", `+ 新建槽位 (槽位 ${nextAppendIndex() + 1})`, "追加保存", false);
        }

        if (list.childElementCount === 0) {
          const emptyBox = document.createElement("div");
          emptyBox.className = "uw2-speech-box";
          emptyBox.textContent = "暂无本地存档，可点击上方「导入存档」载入 .json 或原版 KOUKAI2.DAT。";
          list.appendChild(emptyBox);
        }
        left.appendChild(list);

        // 右欄：選中槽位詳情與操作按鈕
        const right = document.createElement("div");
        right.className = "uw2-pane";
        const rt = document.createElement("div");
        rt.className = "uw2-pane-title";
        rt.textContent = "存档详情";
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
          box.innerHTML =
            `<div class="uw2-detail-title">新建存档 · 槽位 ${idx + 1}</div>` +
            `<div class="uw2-speech-box">将把当前进度保存到新的「槽位 ${idx + 1}」，不覆盖任何已有存档。</div>`;
          const btn = document.createElement("button");
          btn.className = "uw2-btn uw2-btn-primary";
          btn.style.cssText = "padding:9px 24px;align-self:flex-start;";
          btn.textContent = `保存到槽位 ${idx + 1}`;
          btn.addEventListener("click", () => finish(idx));
          box.appendChild(btn);
        } else if (!curSlot) {
          const idx = typeof selKey === "number" ? selKey : 0;
          box.innerHTML =
            `<div class="uw2-detail-title">槽位 ${idx + 1}</div>` +
            `<div class="uw2-speech-box">当前为空槽位。</div>`;
          if (mode === "save") {
            const btn = document.createElement("button");
            btn.className = "uw2-btn uw2-btn-primary";
            btn.style.cssText = "padding:9px 24px;align-self:flex-start;";
            btn.textContent = `保存到槽位 ${idx + 1}`;
            btn.addEventListener("click", () => finish(idx));
            box.appendChild(btn);
          }
        } else {
          const s = curSlot.summary;
          const label = selKey === "auto" ? "自动存档" : `槽位 ${selKey + 1}`;
          const savedTime = formatSavedAt(s.savedAt);
          box.innerHTML =
            `<div class="uw2-detail-title">${label} · ${s.heroName || "主角 #" + (s.heroId + 1)}</div>` +
            `<div class="uw2-kv-row"><span class="uw2-kv-label">游戏日期</span><span class="uw2-kv-val">${s.dateStr}</span></div>` +
            `<div class="uw2-kv-row"><span class="uw2-kv-label">当前位置</span><span class="uw2-kv-val">${s.portName}</span></div>` +
            `<div class="uw2-kv-row"><span class="uw2-kv-label">持有资金</span><span class="uw2-item-price">金块 ${Math.trunc(s.money / 10000)} · 金币 ${(s.money % 10000).toLocaleString("zh-CN")}</span></div>` +
            (savedTime ? `<div class="uw2-kv-row"><span class="uw2-kv-label">保存时间</span><span class="uw2-kv-val">${savedTime}</span></div>` : "");

          const actRow = document.createElement("div");
          actRow.style.cssText = "display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;";

          if (mode === "load") {
            const loadBtn = document.createElement("button");
            loadBtn.className = "uw2-btn uw2-btn-primary";
            loadBtn.style.padding = "8px 24px";
            loadBtn.textContent = "读取此存档";
            loadBtn.addEventListener("click", () => finish(selKey as number | "auto"));
            actRow.appendChild(loadBtn);
          } else if (mode === "save" && typeof selKey === "number") {
            const saveBtn = document.createElement("button");
            saveBtn.className = "uw2-btn uw2-btn-primary";
            saveBtn.style.padding = "8px 24px";
            saveBtn.textContent = "覆盖保存";
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
                notice = `已导出槽位 ${idx + 1} (uw2-slot-${idx + 1}.json)`;
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
              notice = `已删除槽位 ${idx + 1}。`;
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
