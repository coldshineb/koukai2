// modern/save_modal.ts — 現代 JSON 存檔管理面板 (支援 10 槽位 + 自動存檔 + 匯入 KOUKAI2.DAT / .json + 匯出 .json)
import type { SaveSlotV2 } from "../save/format.ts";

export interface SaveModalBridge {
  getSlots: () => Promise<Array<SaveSlotV2 | null>>;
  getAutoSave: () => Promise<SaveSlotV2 | null>;
  exportJson: (slotIndex?: number, stripCompat?: boolean) => Promise<string>;
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
    return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export class ModernSaveModal {
  private readonly bridge: SaveModalBridge;
  private backdrop: HTMLElement | null = null;
  private onKeyDownBound: ((e: KeyboardEvent) => void) | null = null;

  constructor(bridge: SaveModalBridge) {
    this.bridge = bridge;
  }

  async open(): Promise<void> {
    if (this.backdrop) return;
    document.body.dataset.uw2Modal = "open";

    const backdrop = document.createElement("div");
    backdrop.className = "uw2-modal-backdrop";
    backdrop.addEventListener("click", e => { if (e.target === backdrop) this.close(); });

    const modal = document.createElement("div");
    modal.className = "uw2-card uw2-modal";

    const header = document.createElement("div");
    header.className = "uw2-modal-header";
    header.innerHTML = `<span class="uw2-modal-title">存档管理 (uw2-save-v2)</span>`;
    const closeBtn = document.createElement("button");
    closeBtn.className = "uw2-btn";
    closeBtn.textContent = "关闭";
    closeBtn.addEventListener("click", () => this.close());
    header.appendChild(closeBtn);

    const toolbar = document.createElement("div");
    toolbar.className = "uw2-modal-toolbar";

    const importBtn = document.createElement("button");
    importBtn.className = "uw2-btn uw2-btn-primary";
    importBtn.textContent = "导入存档 (.json / KOUKAI2.DAT)";
    importBtn.addEventListener("click", () => this.pickAndImport());

    const exportAllBtn = document.createElement("button");
    exportAllBtn.className = "uw2-btn";
    exportAllBtn.textContent = "导出全部 (.json)";
    exportAllBtn.addEventListener("click", async () => {
      try {
        const text = await this.bridge.exportJson(undefined, false);
        downloadText("uw2-saves-v2.json", text);
        this.bridge.onToast("已导出全部存档 (uw2-saves-v2.json)");
      } catch (e: any) {
        this.bridge.onToast("导出失败: " + (e?.message ?? e));
      }
    });

    toolbar.append(importBtn, exportAllBtn);

    const list = document.createElement("div");
    list.className = "uw2-slot-list";

    modal.append(header, toolbar, list);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    this.backdrop = backdrop;

    this.onKeyDownBound = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); this.close(); }
    };
    window.addEventListener("keydown", this.onKeyDownBound);

    await this.renderSlots(list);
  }

  private async renderSlots(list: HTMLElement): Promise<void> {
    list.innerHTML = "";
    const [slots, auto] = await Promise.all([this.bridge.getSlots(), this.bridge.getAutoSave()]);

    if (auto) list.appendChild(this.makeCard("自动", auto, null));
    for (let i = 0; i < slots.length; i++) {
      list.appendChild(this.makeCard(`槽位 ${i + 1}`, slots[i], i));
    }
  }

  private makeCard(label: string, slot: SaveSlotV2 | null, slotIndex: number | null): HTMLElement {
    const card = document.createElement("div");
    card.className = "uw2-slot-card" + (slot ? "" : " empty");

    const meta = document.createElement("div");
    meta.className = "uw2-slot-meta";

    if (!slot) {
      meta.innerHTML = `<div class="uw2-slot-title">${label}</div><div class="uw2-slot-sub">空槽位</div>`;
      card.appendChild(meta);
      return card;
    }

    const s = slot.summary;
    const gold = s.money.toLocaleString("zh-CN");
    const saved = formatSavedAt(s.savedAt);
    meta.innerHTML = `
      <div class="uw2-slot-title">${label} · ${s.heroName || "主角 #" + (s.heroId + 1)}</div>
      <div class="uw2-slot-sub">${s.dateStr} · ${s.portName} · 金币 ${gold}${saved ? " · " + saved : ""}</div>
    `;
    card.appendChild(meta);

    if (slotIndex !== null) {
      const expBtn = document.createElement("button");
      expBtn.className = "uw2-btn";
      expBtn.style.color = "var(--uw2-ink)";
      expBtn.style.borderColor = "rgba(61,40,23,0.28)";
      expBtn.textContent = "导出";
      expBtn.addEventListener("click", async () => {
        try {
          const text = await this.bridge.exportJson(slotIndex, false);
          downloadText(`uw2-slot-${slotIndex + 1}.json`, text);
          this.bridge.onToast(`已导出槽位 ${slotIndex + 1}`);
        } catch (e: any) {
          this.bridge.onToast("导出失败: " + (e?.message ?? e));
        }
      });
      card.appendChild(expBtn);
    }

    return card;
  }

  private pickAndImport(): void {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".json,.dat,.DAT";
    inp.onchange = async () => {
      const file = inp.files?.[0];
      if (!file) return;
      try {
        const buf = await file.arrayBuffer();
        const res = await this.bridge.importBuffer(buf);
        const label = res.kind === "legacy-dat" ? "原版 KOUKAI2.DAT" : "JSON 存档";
        this.bridge.onToast(`成功导入${label}（${res.importedSlots} 个槽位）`);
        const list = this.backdrop?.querySelector(".uw2-slot-list") as HTMLElement | null;
        if (list) await this.renderSlots(list);
      } catch (e: any) {
        this.bridge.onToast("导入失败: " + (e?.message ?? e));
      }
    };
    inp.click();
  }

  close(): void {
    if (this.onKeyDownBound) {
      window.removeEventListener("keydown", this.onKeyDownBound);
      this.onKeyDownBound = null;
    }
    this.backdrop?.remove();
    this.backdrop = null;
    delete document.body.dataset.uw2Modal;
  }
}
