// modern/presenter.ts — ModernPresenter (階段 4 現代高清 DOM/CSS 互動組件庫，實作 IGameUI)
// 供階段 5 逐場景從 640×400 幀緩衝切換至現代高清介面使用。
import type { IGameUI } from "../ui/protocol.ts";

export class ModernGameUI implements IGameUI {
  readonly root: HTMLElement;
  readonly c: any;
  private currentText = "";

  constructor(root: HTMLElement, ctx: any) {
    this.root = root;
    this.c = ctx;
  }

  private decodeBytes(bytes: Uint8Array): string {
    if (!this.c?.codec) return "";
    let end = bytes.indexOf(0);
    if (end < 0) end = bytes.length;
    return this.c.codec.decode(bytes.subarray(0, end)).replace(/\{[0-9A-F]{2}\}/g, "").trim();
  }

  showMessage(msgId: number, ...args: unknown[]): void {
    // 過渡期保留底層 msgId 紀錄；階段 5 各場景會直接傳語意文字
    this.currentText = args.length ? `[#${msgId}] ${args.map(String).join(" ")}` : `[#${msgId}]`;
  }

  showDialogText(text: string): Promise<void> {
    this.currentText = text;
    return this.waitPrompt();
  }

  waitPrompt(): Promise<void> {
    return new Promise(resolve => {
      document.body.dataset.uw2Modal = "open";
      const box = document.createElement("div");
      box.className = "uw2-card uw2-dialog";
      box.innerHTML = `<div class="uw2-dialog-text"></div>`;
      (box.querySelector(".uw2-dialog-text") as HTMLElement).textContent = this.currentText;

      const actions = document.createElement("div");
      actions.className = "uw2-dialog-actions";
      const ok = document.createElement("button");
      ok.className = "uw2-btn uw2-btn-primary";
      ok.textContent = "继续";
      actions.appendChild(ok);
      box.appendChild(actions);

      const finish = () => {
        window.removeEventListener("keydown", onKey);
        box.remove();
        delete document.body.dataset.uw2Modal;
        resolve();
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " " || e.key === "Escape") { e.preventDefault(); finish(); }
      };
      ok.addEventListener("click", finish);
      window.addEventListener("keydown", onKey);
      this.root.appendChild(box);
      ok.focus();
    });
  }

  confirmYesNo(promptText?: string): Promise<boolean> {
    return new Promise(resolve => {
      document.body.dataset.uw2Modal = "open";
      const box = document.createElement("div");
      box.className = "uw2-card uw2-dialog";
      if (promptText || this.currentText) {
        const t = document.createElement("div");
        t.className = "uw2-dialog-text";
        t.textContent = promptText ?? this.currentText;
        box.appendChild(t);
      }

      const actions = document.createElement("div");
      actions.className = "uw2-dialog-actions";
      const btnNo = document.createElement("button");
      btnNo.className = "uw2-btn";
      btnNo.style.color = "var(--uw2-ink)";
      btnNo.textContent = "否 (Esc)";
      const btnYes = document.createElement("button");
      btnYes.className = "uw2-btn uw2-btn-primary";
      btnYes.textContent = "是 (Enter)";
      actions.append(btnNo, btnYes);
      box.appendChild(actions);

      const finish = (val: boolean) => {
        window.removeEventListener("keydown", onKey);
        box.remove();
        delete document.body.dataset.uw2Modal;
        resolve(val);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === "y" || e.key === "Y") { e.preventDefault(); finish(true); }
        else if (e.key === "Escape" || e.key === "n" || e.key === "N") { e.preventDefault(); finish(false); }
      };
      btnYes.addEventListener("click", () => finish(true));
      btnNo.addEventListener("click", () => finish(false));
      window.addEventListener("keydown", onKey);
      this.root.appendChild(box);
      btnYes.focus();
    });
  }

  selectMenu(_x: number, _y: number, items: Uint8Array[], cancelable: number): Promise<number> {
    const labels = items.map(it => this.decodeBytes(it));
    return this.selectMenuLabels(labels, !!cancelable);
  }

  selectMenuLabels(labels: string[], cancelable = true): Promise<number> {
    return new Promise(resolve => {
      document.body.dataset.uw2Modal = "open";
      const list = document.createElement("div");
      list.className = "uw2-card uw2-menu-list";
      let focusIdx = 0;

      const btns = labels.map((lbl, idx) => {
        const b = document.createElement("button");
        b.className = "uw2-menu-item" + (idx === 0 ? " focused" : "");
        b.textContent = lbl;
        b.addEventListener("mouseenter", () => setFocus(idx));
        b.addEventListener("click", () => finish(idx));
        list.appendChild(b);
        return b;
      });

      const setFocus = (i: number) => {
        btns[focusIdx]?.classList.remove("focused");
        focusIdx = (i + btns.length) % btns.length;
        btns[focusIdx]?.classList.add("focused");
        btns[focusIdx]?.scrollIntoView({ block: "nearest" });
      };

      const finish = (val: number) => {
        window.removeEventListener("keydown", onKey);
        list.remove();
        delete document.body.dataset.uw2Modal;
        resolve(val);
      };

      const onKey = (e: KeyboardEvent) => {
        if (e.key === "ArrowDown") { e.preventDefault(); setFocus(focusIdx + 1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setFocus(focusIdx - 1); }
        else if (e.key === "Enter") { e.preventDefault(); finish(focusIdx); }
        else if (e.key === "Escape" && cancelable) { e.preventDefault(); finish(0xff); }
      };

      window.addEventListener("keydown", onKey);
      this.root.appendChild(list);
    });
  }

  async selectList(kind: number, count: number): Promise<number> {
    return this.c?.listSel ? this.c.listSel.select(kind, count) : -1;
  }

  inputNumber(min: number, max: number): Promise<number> {
    return new Promise(resolve => {
      document.body.dataset.uw2Modal = "open";
      const box = document.createElement("div");
      box.className = "uw2-card uw2-numpad";

      const num = document.createElement("input");
      num.type = "number";
      num.min = String(min);
      num.max = String(max);
      num.value = String(min);

      const range = document.createElement("input");
      range.type = "range";
      range.min = String(min);
      range.max = String(max);
      range.value = String(min);
      range.className = "uw2-slider";
      range.style.width = "100%";

      const sync = (v: number) => {
        const clamped = Math.max(min, Math.min(max, Math.trunc(v) || 0));
        num.value = String(clamped);
        range.value = String(clamped);
      };
      num.addEventListener("input", () => sync(Number(num.value)));
      range.addEventListener("input", () => sync(Number(range.value)));

      const quick = document.createElement("div");
      quick.className = "uw2-group";
      for (const [label, val] of [["最小", min], ["一半", Math.trunc((min + max) / 2)], ["最大", max]] as const) {
        const b = document.createElement("button");
        b.className = "uw2-btn";
        b.style.color = "var(--uw2-ink)";
        b.style.borderColor = "rgba(61,40,23,0.28)";
        b.textContent = label;
        b.addEventListener("click", () => sync(val));
        quick.appendChild(b);
      }

      const actions = document.createElement("div");
      actions.className = "uw2-dialog-actions";
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "uw2-btn";
      cancelBtn.style.color = "var(--uw2-ink)";
      cancelBtn.textContent = "取消";
      const okBtn = document.createElement("button");
      okBtn.className = "uw2-btn uw2-btn-primary";
      okBtn.textContent = "确认";
      actions.append(cancelBtn, okBtn);

      box.append(num, range, quick, actions);

      const finish = (v: number) => {
        window.removeEventListener("keydown", onKey);
        box.remove();
        delete document.body.dataset.uw2Modal;
        resolve(v < 0 ? 0 : v);
      };
      const cancelVal = min > 0 ? min : 0;
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Enter") { e.preventDefault(); finish(Math.max(min, Math.min(max, Math.trunc(Number(num.value)) || 0))); }
        else if (e.key === "Escape") { e.preventDefault(); finish(cancelVal); }
      };
      cancelBtn.addEventListener("click", () => finish(cancelVal));
      okBtn.addEventListener("click", () => finish(Math.max(min, Math.min(max, Math.trunc(Number(num.value)) || 0))));
      window.addEventListener("keydown", onKey);
      this.root.appendChild(box);
      num.focus();
      num.select();
    });
  }

  inputName(opts: { title: string; defaultValue?: string; maxBytes: number; encode: (s: string) => Uint8Array }): Promise<{ status: 1 | 2 | 3; bytes?: Uint8Array }> {
    return new Promise(resolve => {
      document.body.dataset.uw2Modal = "open";
      const box = document.createElement("div");
      box.className = "uw2-card uw2-numpad";

      const title = document.createElement("div");
      title.style.fontWeight = "700";
      title.style.fontSize = "15px";
      title.textContent = opts.title;

      const inp = document.createElement("input");
      inp.type = "text";
      inp.value = opts.defaultValue ?? "";
      inp.placeholder = "支持直接输入中文或英文";
      inp.style.width = "100%";
      inp.style.padding = "8px 12px";
      inp.style.fontSize = "16px";
      inp.style.border = "1px solid var(--uw2-gold)";
      inp.style.borderRadius = "6px";
      inp.style.background = "#fffdf6";
      inp.style.color = "var(--uw2-ink)";

      const statusEl = document.createElement("div");
      statusEl.style.fontSize = "12px";
      statusEl.style.color = "var(--uw2-ink-muted)";

      const tryEncode = (val: string): { ok: boolean; bytes?: Uint8Array; err?: string } => {
        const trimmed = val.trim();
        if (!trimmed) return { ok: true, bytes: new Uint8Array(0) };
        try {
          const b = opts.encode(trimmed);
          if (b.length > opts.maxBytes) return { ok: false, err: `超过长度上限 (${b.length}/${opts.maxBytes} 字节)` };
          return { ok: true, bytes: b };
        } catch (e: any) {
          return { ok: false, err: `包含字库不支持的字符 (${e?.message ?? ""})` };
        }
      };

      const updateStatus = () => {
        const r = tryEncode(inp.value);
        if (r.ok) {
          statusEl.style.color = "var(--uw2-ink-muted)";
          statusEl.textContent = `${r.bytes?.length ?? 0} / ${opts.maxBytes} 字节`;
        } else {
          statusEl.style.color = "var(--uw2-danger)";
          statusEl.textContent = r.err ?? "输入无效";
        }
      };
      inp.addEventListener("input", updateStatus);

      const actions = document.createElement("div");
      actions.className = "uw2-dialog-actions";
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "uw2-btn";
      cancelBtn.style.color = "var(--uw2-ink)";
      cancelBtn.textContent = "取消 (Esc)";
      const okBtn = document.createElement("button");
      okBtn.className = "uw2-btn uw2-btn-primary";
      okBtn.textContent = "确认 (Enter)";
      actions.append(cancelBtn, okBtn);

      box.append(title, inp, statusEl, actions);

      const finish = (res: { status: 1 | 2 | 3; bytes?: Uint8Array }) => {
        window.removeEventListener("keydown", onKey);
        box.remove();
        delete document.body.dataset.uw2Modal;
        resolve(res);
      };
      const submit = () => {
        const r = tryEncode(inp.value);
        if (!r.ok) { updateStatus(); return; }
        if (!r.bytes || r.bytes.length === 0) finish({ status: 3 });
        else finish({ status: 1, bytes: r.bytes });
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.isComposing) return;
        if (e.key === "Enter") { e.preventDefault(); submit(); }
        else if (e.key === "Escape") { e.preventDefault(); finish({ status: 2 }); }
      };
      cancelBtn.addEventListener("click", () => finish({ status: 2 }));
      okBtn.addEventListener("click", submit);
      window.addEventListener("keydown", onKey);
      this.root.appendChild(box);
      updateStatus();
      inp.focus();
      inp.select();
    });
  }

  async fadeBlack(): Promise<void> { await this.c?.palette?.fadeBlack?.(); }
  async fadeToTarget(): Promise<void> { await this.c?.palette?.fadeToTarget?.(); }
  playMusic(song: number): void { this.c?.bgm?.playSong?.(song); }
  refreshPanels(): void { /* 由階段 5 現代 HUD 響應式更新 */ }
}
