// modern/dom_ui.ts — 與「讀取進度 (save_modal.ts)」1:1 同套視覺的現代羊皮紙 HTML/CSS 彈層元件庫
// 所有遊戲內選單、清單、確認框、數字輸入、情報卡、控制面板與底部對話欄皆共用本套元件。
// 嚴格遵守：100% 原版遊戲文本、支援多層巢狀彈窗 (modalDepth)、Node 測試環境自動回退無副作用。

let modalDepth = 0;
const modalStack: HTMLElement[] = [];
const composedCache = new Map<string, string>();

export function hasDom(): boolean {
  return typeof document !== "undefined" && !!document.body;
}

/** 重繪彈窗內容時自動保留所有清單與捲動區的位置，避免點擊項目後跳回頂部 */
export function preserveScroll(root: HTMLElement, fn: () => void, keep = true) {
  const sels = [".uw2-list-col", ".uw2-wharf-grid", ".uw2-slot-list", ".uw2-pane"];
  const bodyTop = keep ? root.scrollTop : 0;
  const saved = keep
    ? sels.map(s => Array.from(root.querySelectorAll<HTMLElement>(s)).map(el => el.scrollTop))
    : [];
  fn();
  if (keep) {
    const restore = () => {
      root.scrollTop = bodyTop;
      sels.forEach((s, si) => {
        const next = root.querySelectorAll<HTMLElement>(s);
        const arr = saved[si];
        for (let i = 0; i < Math.min(arr.length, next.length); i++) {
          if (arr[i] > 0) next[i].scrollTop = arr[i];
        }
      });
    };
    restore();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(restore);
  }
}

/** 渲染 5 層拼合隨機頭像 (kao_parts_a..e.png)，快取命中時同步回傳 dataURL */
export function getComposedPortraitCached(type: number, parts: number): string | null {
  const s = Math.max(0, Math.min(6, type & 0xffff));
  return composedCache.get(`${s}_${parts & 0xffff}`) ?? null;
}

export async function getComposedPortraitSrc(art: any, type: number, parts: number): Promise<string | null> {
  if (!art || !hasDom()) return null;
  const s = Math.max(0, Math.min(6, type & 0xffff));
  const p = parts & 0xffff;
  const key = `${s}_${p}`;
  if (composedCache.has(key)) return composedCache.get(key)!;

  const layers: [string, number, number][] = [
    ["a", p & 7, 0],
    ["b", (p >> 3) & 7, 33],
    ["c", (p >> 8) & 7, 21],
    ["d", (p >> 6) & 3, 29],
    ["e", (p >> 11) & 7, 45],
  ];
  const imgs = await Promise.all(
    layers.map(async ([k]) => {
      const meta = art.kaoPartSheet?.(k);
      if (!meta) return null;
      const url = `${art.baseUrl}/${meta.path}`;
      return art.getImage?.(url) || (await art.loadImage?.(url).catch(() => null));
    }),
  );
  const cv = document.createElement("canvas");
  cv.width = 64;
  cv.height = 80;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#141c2b";
  ctx.fillRect(0, 0, 64, 80);
  ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < layers.length; i++) {
    const [k, idx, yOff] = layers[i];
    const meta = art.kaoPartSheet?.(k);
    const img = imgs[i];
    if (!meta || !img) continue;
    const scaleX = (img.naturalWidth || meta.w) / meta.w;
    const scaleY = (img.naturalHeight || meta.h) / meta.h;
    ctx.drawImage(img, idx * meta.tileW * scaleX, s * meta.tileH * scaleY, meta.tileW * scaleX, meta.tileH * scaleY, 0, yOff, meta.tileW, meta.tileH);
  }
  const dataUrl = cv.toDataURL();
  composedCache.set(key, dataUrl);
  return dataUrl;
}

/** 渲染任意人物頭像（同時支援具名頭像 kao_NNN.png 與 5 層拼合隨機頭像 kao_parts_a..e.png） */
export async function getPersonPortraitSrc(art: any, rec: Uint8Array): Promise<string | null> {
  if (!art || !rec || rec.length < 0x32) return null;
  const parts = rec[0x1a] | (rec[0x1b] << 8);
  if (!(rec[0x1b] & 0xc0)) {
    return art.portraitUrl?.(parts & 0x7f) ?? null;
  }
  return getComposedPortraitSrc(art, rec[0x31] & 15, parts);
}

function pushModalLock() {
  modalDepth++;
  document.body.dataset.uw2Modal = "open";
}

function popModalLock() {
  modalDepth = Math.max(0, modalDepth - 1);
  if (modalDepth === 0) delete document.body.dataset.uw2Modal;
}

export interface DomModalHandle {
  backdrop: HTMLElement;
  modal: HTMLElement;
  header: HTMLElement;
  headerRight: HTMLElement;
  titleEl: HTMLElement;
  body: HTMLElement;
  close: () => void;
}

export function createDomModal(opts: {
  title: string;
  size?: "sm" | "md" | "wide";
  cancelable?: boolean;
  closeLabel?: string;
  onCancel?: () => void;
}): DomModalHandle {
  pushModalLock();
  const zIndex = 100 + modalDepth * 10;

  const backdrop = document.createElement("div");
  backdrop.className = "uw2-modal-backdrop";
  backdrop.style.zIndex = String(zIndex);

  const modal = document.createElement("div");
  modal.className = `uw2-card uw2-modal ${opts.size ? `uw2-modal-${opts.size}` : ""}`;

  const header = document.createElement("div");
  header.className = "uw2-modal-header";

  const titleEl = document.createElement("span");
  titleEl.className = "uw2-modal-title";
  titleEl.textContent = opts.title;

  const headerRight = document.createElement("div");
  headerRight.className = "uw2-modal-header-right";

  const cancelable = opts.cancelable !== false;
  let closed = false;
  const doClose = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener("keydown", onKey, true);
    const idx = modalStack.lastIndexOf(backdrop);
    if (idx >= 0) modalStack.splice(idx, 1);
    backdrop.remove();
    popModalLock();
  };

  if (cancelable) {
    const closeBtn = document.createElement("button");
    closeBtn.className = "uw2-btn";
    closeBtn.textContent = opts.closeLabel ?? "关闭";
    closeBtn.addEventListener("click", () => { doClose(); opts.onCancel?.(); });
    headerRight.appendChild(closeBtn);
    backdrop.addEventListener("click", e => {
      if (e.target === backdrop) { doClose(); opts.onCancel?.(); }
    });
  }

  // 原版大航海時代 II 右鍵返回/關閉手感：在最頂層彈窗內任意處右鍵即等同 Esc 返回
  backdrop.addEventListener("contextmenu", e => {
    e.preventDefault();
    e.stopPropagation();
    if (cancelable && modalStack[modalStack.length - 1] === backdrop) {
      doClose();
      opts.onCancel?.();
    }
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && cancelable && modalStack[modalStack.length - 1] === backdrop) {
      e.preventDefault();
      e.stopImmediatePropagation();
      doClose();
      opts.onCancel?.();
    }
  };
  window.addEventListener("keydown", onKey, true);

  header.append(titleEl, headerRight);
  const body = document.createElement("div");
  body.className = "uw2-modal-body";
  modal.append(header, body);
  backdrop.appendChild(modal);
  modalStack.push(backdrop);
  document.body.appendChild(backdrop);

  return { backdrop, modal, header, headerRight, titleEl, body, close: doClose };
}

// ---------------- 1. 現代選單彈窗 (取代 listMenu) ----------------
export function runDomMenu(
  items: string[],
  disabledMask: number,
  cancelable: boolean,
  title = "",
  promptText = "",
  portrait?: DomDialogPortrait,
): Promise<number> {
  return new Promise(resolve => {
    let settled = false;
    const done = (v: number) => { if (settled) return; settled = true; h.close(); resolve(v); };

    const h = createDomModal({
      title: title || items[0] || "",
      size: "sm",
      cancelable,
      onCancel: () => done(0xff),
    });

    if (promptText) {
      const box = document.createElement("div");
      box.style.cssText = "padding:8px 10px;border-radius:8px;background:rgba(255,252,242,0.72);border:1px solid rgba(154,119,56,0.26);";
      appendModalPrompt(box, promptText, portrait, "uw2-dialog-text");
      h.body.appendChild(box);
    }

    const list = document.createElement("div");
    list.className = "uw2-list-col";
    items.forEach((label, i) => {
      const btn = document.createElement("button");
      btn.className = "uw2-row-card";
      btn.disabled = !!(disabledMask & (1 << i));
      btn.textContent = label;
      btn.addEventListener("click", () => done(i));
      list.appendChild(btn);
    });
    h.body.appendChild(list);
  });
}

export interface DomDialogPortrait {
  art?: any;
  portraitId?: number | null;
  portraitComposed?: { type: number; parts: number } | null;
}

function appendModalPrompt(container: HTMLElement, promptText: string, portrait?: DomDialogPortrait, textClass = "uw2-dialog-text") {
  const pc = portrait?.portraitComposed ?? null;
  const pid = portrait?.portraitId ?? null;
  const art = portrait?.art;
  const hasPortrait = !!(pc || (pid !== null && pid >= 0 && pid < 128 && art?.portraitUrl?.(pid)));
  if (!promptText && !hasPortrait) return;

  const row = document.createElement("div");
  row.className = hasPortrait ? "uw2-modal-prompt-row" : "";

  if (pc && art) {
    const img = document.createElement("img");
    img.className = "uw2-portrait-img";
    const cached = getComposedPortraitCached(pc.type, pc.parts);
    if (cached) img.src = cached;
    else void getComposedPortraitSrc(art, pc.type, pc.parts).then(src => { if (src) img.src = src; });
    row.appendChild(img);
  } else if (pid !== null && pid >= 0 && pid < 128 && art?.portraitUrl) {
    const url = art.portraitUrl(pid);
    if (url) {
      const img = document.createElement("img");
      img.className = "uw2-portrait-img";
      img.src = url;
      row.appendChild(img);
    }
  }

  if (promptText) {
    const p = document.createElement("div");
    p.className = textClass;
    p.textContent = promptText;
    row.appendChild(p);
  }
  container.appendChild(row);
}

// ---------------- 2. 現代確認彈窗 (取代 yesNo) ----------------
export function runDomYesNo(promptText: string, yesLabel: string, noLabel: string, portrait?: DomDialogPortrait): Promise<number> {
  return new Promise(resolve => {
    let settled = false;
    const done = (v: number) => { if (settled) return; settled = true; h.close(); resolve(v); };

    const h = createDomModal({
      title: `${yesLabel} / ${noLabel}`,
      size: "sm",
      cancelable: true,
      onCancel: () => done(0),
    });

    appendModalPrompt(h.body, promptText, portrait, "uw2-dialog-text");

    const row = document.createElement("div");
    row.className = "uw2-dialog-actions";
    const noBtn = document.createElement("button");
    noBtn.className = "uw2-step-btn";
    noBtn.style.padding = "8px 22px";
    noBtn.textContent = noLabel;
    noBtn.addEventListener("click", () => done(0));

    const yesBtn = document.createElement("button");
    yesBtn.className = "uw2-btn uw2-btn-primary";
    yesBtn.style.padding = "8px 24px";
    yesBtn.textContent = yesLabel;
    yesBtn.addEventListener("click", () => done(1));

    row.append(noBtn, yesBtn);
    h.body.appendChild(row);
    yesBtn.focus();
  });
}

// ---------------- 3. 現代清單彈窗 (取代 ListSelect 21 種清單) ----------------
export function runDomList(title: string, rows: string[]): Promise<number> {
  return new Promise(resolve => {
    let settled = false;
    const done = (v: number) => { if (settled) return; settled = true; h.close(); resolve(v); };

    const h = createDomModal({
      title,
      size: "md",
      cancelable: true,
      onCancel: () => done(-1),
    });

    const list = document.createElement("div");
    list.className = "uw2-list-col";
    rows.forEach((txt, i) => {
      const btn = document.createElement("button");
      btn.className = "uw2-row-card";
      btn.textContent = txt;
      btn.addEventListener("click", () => done(i));
      list.appendChild(btn);
    });
    h.body.appendChild(list);
  });
}

// ---------------- 4. 現代數字輸入彈窗 (取代 NumPad) ----------------
export function runDomNumPad(min: number, max: number, promptText = "", portrait?: DomDialogPortrait): Promise<number> {
  return new Promise(resolve => {
    let settled = false;
    const clamp = (v: number) => Math.max(min, Math.min(max, Math.trunc(v || 0)));
    let value = clamp(min);
    const done = (v: number) => { if (settled) return; settled = true; h.close(); resolve(v); };

    const h = createDomModal({
      title: "请输入数量",
      size: "sm",
      cancelable: true,
      onCancel: () => done(min),
    });

    appendModalPrompt(h.body, promptText, portrait, "uw2-dialog-text");

    const input = document.createElement("input");
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.value = String(value);
    input.style.cssText = "width:100%;padding:8px 12px;font-size:20px;font-weight:700;border:1px solid var(--uw2-gold);border-radius:6px;background:#fffdf6;color:var(--uw2-ink);";

    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "uw2-slider";
    slider.min = String(min);
    slider.max = String(max);
    slider.value = String(value);
    slider.style.width = "100%";

    const sync = (v: number) => {
      value = clamp(v);
      input.value = String(value);
      slider.value = String(value);
    };
    input.addEventListener("input", () => sync(Number(input.value)));
    slider.addEventListener("input", () => sync(Number(slider.value)));

    const span = max - min;
    const stepDefs: [string, () => void][] = [];
    if (span >= 200) stepDefs.push(["-100", () => sync(value - 100)]);
    if (span >= 20) stepDefs.push(["-10", () => sync(value - 10)]);
    stepDefs.push(["-1", () => sync(value - 1)]);
    stepDefs.push(["+1", () => sync(value + 1)]);
    if (span >= 20) stepDefs.push(["+10", () => sync(value + 10)]);
    if (span >= 200) stepDefs.push(["+100", () => sync(value + 100)]);
    stepDefs.push(["最大", () => sync(max)]);

    const steps = document.createElement("div");
    steps.className = "uw2-step-row";
    steps.style.flexWrap = "wrap";
    for (const [lb, fn] of stepDefs) {
      const b = document.createElement("button");
      b.className = "uw2-step-btn";
      b.textContent = lb;
      b.addEventListener("click", fn);
      steps.appendChild(b);
    }

    const actions = document.createElement("div");
    actions.className = "uw2-dialog-actions";
    const okBtn = document.createElement("button");
    okBtn.className = "uw2-btn uw2-btn-primary";
    okBtn.style.padding = "8px 26px";
    okBtn.textContent = "确定";
    okBtn.addEventListener("click", () => done(value));
    actions.appendChild(okBtn);

    h.body.append(input, slider, steps, actions);
    input.focus();
    input.select();
  });
}

export function runDomStoryCard(
  art: any,
  graphId: number | null,
  text: string,
  title = "",
  buttonLabel = "继续",
): Promise<void> {
  if (!hasDom()) return Promise.resolve();
  return new Promise(resolve => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      h.close();
      resolve();
    };
    const h = createDomModal({
      title: title || "航海日志",
      size: "md",
      cancelable: true,
      closeLabel: "关闭",
      onCancel: () => done(),
    });
    if (graphId !== null && art) {
      const entry = art.graphEntry?.("GRAPH.DAT", graphId);
      if (entry) {
        const img = document.createElement("img");
        img.src = `${art.baseUrl}/${entry.path}`;
        img.style.cssText = "width:100%;max-height:240px;object-fit:contain;border-radius:8px;border:1px solid var(--uw2-gold);background:#0c1728;image-rendering:pixelated;";
        h.body.appendChild(img);
      }
    }
    const body = document.createElement("div");
    body.style.cssText = "font-size:16px;line-height:1.75;color:var(--uw2-ink);white-space:pre-wrap;padding:6px 4px;";
    body.textContent = text;
    h.body.appendChild(body);

    const actions = document.createElement("div");
    actions.className = "uw2-dialog-actions";
    const btn = document.createElement("button");
    btn.className = "uw2-btn uw2-btn-primary";
    btn.style.padding = "8px 28px";
    btn.textContent = buttonLabel;
    btn.addEventListener("click", () => done());
    actions.appendChild(btn);
    h.body.appendChild(actions);
    btn.focus();
  });
}

// ---------------- 5. 現代資訊卡片彈窗 (積載/發現物/隨身物/皇宮港口表，支援可選插圖) ----------------
export function runDomInfoLines(
  title: string,
  lines: string[],
  actionLabels?: string[],
  imageUrl?: string | null,
): Promise<number> {
  return new Promise(resolve => {
    let settled = false;
    const done = (v: number) => { if (settled) return; settled = true; h.close(); resolve(v); };

    const h = createDomModal({
      title,
      size: "md",
      cancelable: true,
      onCancel: () => done(-1),
    });

    const box = document.createElement("div");
    box.className = "uw2-action-box";
    if (imageUrl) {
      const wrap = document.createElement("div");
      wrap.style.cssText = "display:flex;gap:14px;align-items:flex-start;";
      const img = document.createElement("img");
      img.src = imageUrl;
      img.style.cssText = "width:96px;height:96px;object-fit:contain;border-radius:8px;border:1px solid var(--uw2-gold);background:#141c2b;image-rendering:pixelated;flex-shrink:0;";
      const col = document.createElement("div");
      col.style.cssText = "flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;";
      for (const line of lines) {
        const div = document.createElement("div");
        div.style.cssText = "font-size:15px;line-height:1.55;color:var(--uw2-ink);";
        div.textContent = line || "\u00a0";
        col.appendChild(div);
      }
      wrap.append(img, col);
      box.appendChild(wrap);
    } else {
      for (const line of lines) {
        const div = document.createElement("div");
        div.style.cssText = "font-size:15px;line-height:1.55;color:var(--uw2-ink);";
        div.textContent = line || "\u00a0";
        box.appendChild(div);
      }
    }
    h.body.appendChild(box);

    if (actionLabels?.length) {
      const row = document.createElement("div");
      row.className = "uw2-dialog-actions";
      actionLabels.forEach((lb, i) => {
        const btn = document.createElement("button");
        btn.className = i === 0 ? "uw2-btn uw2-btn-primary" : "uw2-step-btn";
        btn.style.padding = "8px 20px";
        btn.textContent = lb;
        btn.addEventListener("click", () => done(i));
        row.appendChild(btn);
      });
      h.body.appendChild(row);
    }
  });
}

// ---------------- 6. 現代主公情報彈窗 ----------------
export function runDomLordInfo(data: {
  title: string;
  portraitUrl: string | null;
  moneyLines: string[];
  fameHeader: string;
  fameLines: { label: string; value: number }[];
  nations: { label: string; value: number; rawText: string }[];
}): Promise<void> {
  return new Promise(resolve => {
    const h = createDomModal({ title: data.title, size: "wide", cancelable: true, onCancel: () => resolve() });
    const split = document.createElement("div");
    split.className = "uw2-split";

    const left = document.createElement("div");
    left.className = "uw2-pane";

    const topCard = document.createElement("div");
    topCard.className = "uw2-action-box";
    topCard.style.flexDirection = "row";
    topCard.style.alignItems = "center";
    if (data.portraitUrl) {
      const img = document.createElement("img");
      img.className = "uw2-portrait-img";
      img.src = data.portraitUrl;
      topCard.appendChild(img);
    }
    const mCol = document.createElement("div");
    mCol.style.cssText = "display:flex;flex-direction:column;gap:4px;font-size:15px;font-weight:600;";
    for (const ml of data.moneyLines) {
      const d = document.createElement("div");
      d.textContent = ml;
      mCol.appendChild(d);
    }
    topCard.appendChild(mCol);
    left.appendChild(topCard);

    const fameBox = document.createElement("div");
    fameBox.className = "uw2-action-box";
    const fh = document.createElement("div");
    fh.className = "uw2-pane-title";
    fh.textContent = data.fameHeader;
    fameBox.appendChild(fh);
    for (const f of data.fameLines) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;flex-direction:column;gap:4px;";
      const lb = document.createElement("div");
      lb.style.fontSize = "14px";
      lb.style.fontWeight = "600";
      lb.textContent = f.label;
      const track = document.createElement("div");
      track.className = "uw2-bar-track";
      const fill = document.createElement("div");
      fill.className = "uw2-bar-fill";
      fill.style.width = `${Math.min(100, (f.value / 50000) * 100)}%`;
      track.appendChild(fill);
      row.append(lb, track);
      fameBox.appendChild(row);
    }
    left.appendChild(fameBox);

    const right = document.createElement("div");
    right.className = "uw2-pane";
    const natBox = document.createElement("div");
    natBox.className = "uw2-action-box";
    for (const nat of data.nations) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;flex-direction:column;gap:4px;";
      const hdr = document.createElement("div");
      hdr.style.cssText = "display:flex;justify-content:space-between;font-size:14px;font-weight:700;";
      const nSpan = document.createElement("span");
      nSpan.textContent = nat.label;
      const vSpan = document.createElement("span");
      vSpan.textContent = nat.rawText;
      vSpan.style.color = nat.value >= 100 ? "#247544" : "#b83d3d";
      hdr.append(nSpan, vSpan);
      const track = document.createElement("div");
      track.className = "uw2-bar-track";
      const fill = document.createElement("div");
      fill.className = `uw2-bar-fill ${nat.value >= 100 ? "green" : "red"}`;
      fill.style.width = `${Math.min(100, (nat.value / 200) * 100)}%`;
      track.appendChild(fill);
      row.append(hdr, track);
      natBox.appendChild(row);
    }
    right.appendChild(natBox);

    split.append(left, right);
    h.body.appendChild(split);
  });
}

// ---------------- 7. 現代航海日誌彈窗 ----------------
export function runDomLogBook(title: string, entries: { date: string; text: string }[]): Promise<void> {
  return new Promise(resolve => {
    const h = createDomModal({ title, size: "wide", cancelable: true, onCancel: () => resolve() });
    const list = document.createElement("div");
    list.className = "uw2-list-col";
    list.style.maxHeight = "520px";
    for (const e of [...entries].reverse()) {
      const card = document.createElement("div");
      card.className = "uw2-slot-card";
      const d = document.createElement("span");
      d.style.cssText = "font-weight:700;color:#8a5d17;white-space:nowrap;font-size:13px;";
      d.textContent = e.date;
      const t = document.createElement("span");
      t.style.cssText = "flex:1;font-size:14px;color:var(--uw2-ink);";
      t.textContent = e.text;
      card.append(d, t);
      list.appendChild(card);
    }
    h.body.appendChild(list);
  });
}

// ---------------- 8. 現代滑條/開關控制彈窗 (環境設定 / 糧食分配 / 水手比例) ----------------
export function runDomControls(title: string, rows: {
  label: string;
  kind: "toggle" | "slider";
  getValueText: () => string;
  getRatio?: () => number;
  onMinus: () => void | Promise<void>;
  onPlus: () => void | Promise<void>;
}[]): Promise<void> {
  return new Promise(resolve => {
    const h = createDomModal({ title, size: "md", cancelable: true, onCancel: () => resolve() });
    const list = document.createElement("div");
    list.className = "uw2-list-col";

    const render = () => {
      const prevTop = list.scrollTop;
      list.innerHTML = "";
      for (const row of rows) {
        const card = document.createElement("div");
        card.className = "uw2-slot-card";

        const lb = document.createElement("span");
        lb.className = "uw2-slot-title";
        lb.textContent = row.label;

        const ctrl = document.createElement("div");
        ctrl.className = "uw2-step-row";

        if (row.kind === "toggle") {
          const btn = document.createElement("button");
          btn.className = "uw2-btn uw2-btn-primary";
          btn.textContent = row.getValueText();
          btn.addEventListener("click", async () => { await row.onPlus(); render(); });
          ctrl.appendChild(btn);
        } else {
          const bm = document.createElement("button");
          bm.className = "uw2-step-btn";
          bm.textContent = "-";
          bm.addEventListener("click", async () => { await row.onMinus(); render(); });

          const val = document.createElement("span");
          val.className = "uw2-sup-val";
          val.style.minWidth = "78px";
          val.textContent = row.getValueText();

          const bp = document.createElement("button");
          bp.className = "uw2-step-btn";
          bp.textContent = "+";
          bp.addEventListener("click", async () => { await row.onPlus(); render(); });

          ctrl.append(bm, val, bp);
        }
        card.append(lb, ctrl);
        list.appendChild(card);
      }
      list.scrollTop = prevTop;
    };
    render();
    h.body.appendChild(list);
  });
}

// ---------------- 9. 底部羊皮紙對話欄 (同步 wideDialog) ----------------
let dialogEl: HTMLElement | null = null;
let lastDialogKey = "";

export function syncDomDialog(
  art: any,
  d: { text: string; portraitId: number | null; portraitComposed?: { type: number; parts: number } | null; waiting: boolean } | null,
) {
  if (!hasDom()) return;
  const host = document.getElementById("uw2-overlay");
  if (!host) return;
  const pc = d?.portraitComposed ?? null;
  if (!d || (!d.text && d.portraitId === null && !pc)) {
    if (dialogEl) { dialogEl.remove(); dialogEl = null; lastDialogKey = ""; }
    return;
  }
  const pcKey = pc ? `${pc.type}_${pc.parts}` : "";
  const key = `${d.portraitId ?? ""}|${pcKey}|${d.waiting ? 1 : 0}|${d.text}`;
  if (key === lastDialogKey && dialogEl) return;
  lastDialogKey = key;

  if (!dialogEl) {
    dialogEl = document.createElement("div");
    dialogEl.className = "uw2-card uw2-dialog-floating";
    host.appendChild(dialogEl);
  }
  dialogEl.innerHTML = "";
  if (pc) {
    const img = document.createElement("img");
    img.className = "uw2-portrait-img";
    const cached = getComposedPortraitCached(pc.type, pc.parts);
    if (cached) {
      img.src = cached;
    } else {
      const expectKey = key;
      void getComposedPortraitSrc(art, pc.type, pc.parts).then(src => {
        if (src && lastDialogKey === expectKey) img.src = src;
      });
    }
    dialogEl.appendChild(img);
  } else if (d.portraitId !== null && d.portraitId >= 0 && d.portraitId < 128) {
    const url = art?.portraitUrl?.(d.portraitId);
    if (url) {
      const img = document.createElement("img");
      img.className = "uw2-portrait-img";
      img.src = url;
      dialogEl.appendChild(img);
    }
  }
  const txt = document.createElement("div");
  txt.className = "uw2-dialog-floating-text";
  txt.textContent = d.text;
  dialogEl.appendChild(txt);

  if (d.waiting) {
    const next = document.createElement("div");
    next.className = "uw2-dialog-next";
    next.textContent = "▼";
    dialogEl.appendChild(next);
  }
}
