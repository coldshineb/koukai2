// itemshop.js — 道具店 (MAIN.EXE 1fd9:a06e = 線性 29dfe, 處理函式表 DS:a612[9]); 見 RE_NOTES 25
// MENU #5 (買進/賣出), 子功能 DS:b21e = 29afb / 29c4a
// 商品: 港口經濟記錄 shopItems (0fea:3257 = 130f7: 一般 3 項, 時刻 [0535] 為 6..8 (夜間 2:00–3:00) 時 4 項, 跳過 FF)
// 隨身物: DS:2e57 (20 格, FF = 空), 道具記錄 items (+0 名稱, +10 價格/100, +12 數值, +13 低 4 位 種類 / bit4 已裝備)
// 原版怪行為 (照搬): 問候判斷夜市用的是 12 ≤ [0535] < 18 (而營業時間是 2:00–3:00 = 6..8 與 8:00–20:00), 所以「夜市」問候 0x2fc 實際上不會出現
import { GameConst, ItemFlag, ItemKind, MenuId } from "../model/flags.ts";
import { DS } from "../model/schema_views.ts";
import { captureConsoleText, decodeCleanCstr, toSimp } from "../canvas_ui/text_util.ts";
import { runWideInfoLinesModal } from "../canvas_ui/wide_panels.ts";
import { createDomModal, hasDom, preserveScroll } from "../modern/dom_ui.ts";

const isHex = s => { const b = Uint8Array.from((s.match(/../g) || []).map(h => parseInt(h, 16))), o = new Uint8Array(b.length + 1); o.set(b); return o; };
const isS16 = v => (v << 16) >> 16;

export class ItemShop {
  constructor(b) { this.b = b; this.F = Object.fromEntries(Object.entries(b.p.P.data.bld2.fmt).map(([k, v]) => [k, isHex(v)])); }
  get c() { return this.b.c; }
  get st() { return this.b.st; }
  get m() { return this.b.st.model; }
  get money() { return this.b.money; } set money(v) { this.b.money = v; }

  // ================= 入口 29dfe =================
  async run() {
    if (hasDom() && this.c.codec) {
      await this.runDomWorkbench();
      return;
    }
    const b = this.b, t = this.c.rt.time;
    if (b.noEvent()) b.greet(t >= 12 && t < 18 ? 0x2fc : 0xeb);
    const items = this.c.menuItems(MenuId.ITEM_SHOP).slice(0, 2);
    let sel;
    do {
      sel = await b.menu(items);
      if (sel !== 0xff) await [() => this.buy(), () => this.sell()][sel]();
      b.after();
    } while (sel !== 0xff);
  }
  // 現代單視窗雙欄道具店工作台（買進/賣出分頁直達，不再選單套選單）
  async runDomWorkbench() {
    const b = this.b, m = this.m, { codec, art, sys, message, printf } = this.c;
    const t = this.c.rt.time;
    const capMsg = (id, ...args) => toSimp(captureConsoleText(this.c, () => message(id, ...args)).trim());
    const initGreet = b.noEvent() ? capMsg(t >= 12 && t < 18 ? 0x2fc : 0xeb) : "";
    const tabLabels = this.c.menuItems(MenuId.ITEM_SHOP).slice(0, 2).map(raw => decodeCleanCstr(codec, raw).replace(/\s+/g, ""));
    const portName = decodeCleanCstr(codec, m.port(b.port).nameBytes);

    return new Promise(resolve => {
      let settled = false;
      let tab = 0; // 0 = 買進, 1 = 賣出
      let selIdx = 0;
      let notice = initGreet;
      let haggleState = null; // { it, price } when player declined first sell offer & shopkeeper counter-offered

      const done = () => {
        if (settled) return;
        settled = true;
        h.close();
        b.after();
        resolve();
      };

      const h = createDomModal({
        title: `${portName} · 道具店`,
        size: "wide",
        cancelable: true,
        closeLabel: "离开",
        onCancel: done,
      });

      const cashBadge = document.createElement("span");
      cashBadge.className = "uw2-badge";
      h.headerRight.prepend(cashBadge);

      const getList = () => {
        if (tab === 0) {
          const n = this.shopList();
          return Array.from({ length: n }, (_, i) => this.c.persons[i] & 0xff);
        }
        const n = this.invList();
        return Array.from({ length: n }, (_, i) => this.c.persons[i] & 0xff);
      };

      const isOwnedNonTool = it => {
        const item = m.item(it);
        if ((item.kindFlags & ItemFlag.KIND_MASK) >= ItemKind.NAVI_TOOL) return false;
        for (let i = 0; i < GameConst.INV_SLOTS; i++) if (m.inventory(i) === it) return true;
        return false;
      };

      const render = () => preserveScroll(h.body, () => {
        cashBadge.textContent = `金币 ${this.money.toLocaleString()}`;
        h.body.innerHTML = "";

        const topBar = document.createElement("div");
        topBar.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;flex-wrap:wrap;";

        const tabs = document.createElement("div");
        tabs.className = "uw2-tabs";
        tabLabels.forEach((lbl, idx) => {
          const btn = document.createElement("button");
          btn.className = `uw2-tab ${tab === idx ? "active" : ""}`;
          btn.textContent = lbl || (idx === 0 ? "买进" : "卖出");
          btn.addEventListener("click", () => {
            tab = idx;
            selIdx = 0;
            haggleState = null;
            render();
          });
          tabs.appendChild(btn);
        });
        topBar.appendChild(tabs);

        if (notice) {
          const noteEl = document.createElement("div");
          noteEl.style.cssText = "flex:1;min-width:220px;font-size:13px;color:var(--uw2-ink);padding:6px 10px;border-radius:6px;background:rgba(255,252,242,0.75);border:1px solid rgba(154,119,56,0.28);";
          noteEl.textContent = notice;
          topBar.appendChild(noteEl);
        }
        h.body.appendChild(topBar);

        const listIds = getList();
        if (selIdx >= listIds.length) selIdx = Math.max(0, listIds.length - 1);

        const split = document.createElement("div");
        split.className = "uw2-split";

        const left = document.createElement("div");
        left.className = "uw2-pane";
        const listWrap = document.createElement("div");
        listWrap.className = "uw2-list-col";
        listWrap.style.maxHeight = "410px";

        if (!listIds.length) {
          const empty = document.createElement("div");
          empty.className = "uw2-empty";
          empty.textContent = tab === 1 ? capMsg(0xf3) : "暂无商品";
          listWrap.appendChild(empty);
        } else {
          listIds.forEach((it, idx) => {
            const item = m.item(it);
            const name = decodeCleanCstr(codec, item.nameBytes);
            const price = tab === 0
              ? Math.imul(100, isS16(item.priceDiv100))
              : Math.imul(isS16(Math.trunc(isS16(item.priceDiv100) / 2)), 100);
            const equipped = !!(item.kindFlags & ItemFlag.EQUIPPED);
            const owned = tab === 0 && isOwnedNonTool(it);

            const row = document.createElement("button");
            row.className = `uw2-row-card ${idx === selIdx ? "selected" : ""}`;
            row.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:10px;";

            const leftTxt = document.createElement("span");
            leftTxt.style.fontWeight = "700";
            leftTxt.textContent = name + (equipped ? " [装备中]" : owned ? " [已持有]" : "");

            const rightTxt = document.createElement("span");
            rightTxt.style.cssText = "font-size:13px;font-weight:700;color:#7c5216;white-space:nowrap;";
            rightTxt.textContent = tab === 1 && item.power === 0 ? "不可出售" : `${price.toLocaleString()} 金币`;

            row.append(leftTxt, rightTxt);
            row.addEventListener("click", () => { selIdx = idx; haggleState = null; render(); });
            listWrap.appendChild(row);
          });
        }
        left.appendChild(listWrap);

        const right = document.createElement("div");
        right.className = "uw2-pane";
        const detail = document.createElement("div");
        detail.className = "uw2-action-box";

        if (listIds.length) {
          const it = listIds[selIdx];
          const item = m.item(it);
          const name = decodeCleanCstr(codec, item.nameBytes);
          const R = DS.TBL_ITEM + it * 0x14;
          const imgUrl = art?.discoveryUrl?.(this.st.u8(R + 0x0f) + 0x55) ?? null;
          const infoLines = captureConsoleText(this.c, () => b.itemInfo(it, 0)).split("\n").map(s => toSimp(s.trim())).filter(Boolean);

          const head = document.createElement("div");
          head.style.cssText = "display:flex;align-items:center;gap:12px;";
          if (imgUrl) {
            const img = document.createElement("img");
            img.src = imgUrl;
            img.style.cssText = "width:64px;height:64px;object-fit:contain;border-radius:8px;border:1px solid rgba(154,119,56,0.4);background:#fffdf6;";
            head.appendChild(img);
          }
          const titleBox = document.createElement("div");
          titleBox.innerHTML = `<div style="font-size:18px;font-weight:700;color:var(--uw2-ink);">${name}</div>`;
          head.appendChild(titleBox);
          detail.appendChild(head);

          if (infoLines.length) {
            const infoBox = document.createElement("div");
            infoBox.style.cssText = "font-size:13px;line-height:1.7;color:var(--uw2-ink);padding:8px 10px;border-radius:6px;background:rgba(255,252,242,0.7);border:1px solid rgba(154,119,56,0.22);";
            infoBox.textContent = infoLines.join("\n");
            detail.appendChild(infoBox);
          }

          if (tab === 0) {
            const price = Math.imul(100, isS16(item.priceDiv100));
            const owned = isOwnedNonTool(it);
            const full = this.invList() >= GameConst.INV_SLOTS;
            const ask = toSimp(captureConsoleText(this.c, () => { message(0xf0, item.nameBytes); printf(this.F.ld, price); message(0xf1); }).trim());
            const pAsk = document.createElement("div");
            pAsk.style.cssText = "font-size:14px;font-weight:600;color:var(--uw2-ink);";
            pAsk.textContent = ask;
            detail.appendChild(pAsk);

            const buyBtn = document.createElement("button");
            buyBtn.className = "uw2-btn uw2-btn-primary";
            buyBtn.style.cssText = "padding:9px 22px;align-self:flex-start;";
            buyBtn.textContent = `购买 (${price.toLocaleString()} 金币)`;
            buyBtn.addEventListener("click", () => {
              if (this.money === 0) { notice = capMsg(0xec); render(); return; }
              if (full) { notice = capMsg(0xed); render(); return; }
              if (owned) { notice = capMsg(0x14c); render(); return; }
              if (price > this.money) { notice = capMsg(0xef); render(); return; }
              this.money = (this.money - price) | 0;
              for (let i = 0; i < GameConst.INV_SLOTS; i++) {
                if (m.inventory(i) === GameConst.EMPTY_SLOT) { m.setInventory(i, it); break; }
              }
              this.b.p.panels();
              notice = capMsg(0xf2);
              render();
            });
            detail.appendChild(buyBtn);
          } else {
            const equipped = !!(item.kindFlags & ItemFlag.EQUIPPED);
            const basePrice = Math.imul(isS16(Math.trunc(isS16(item.priceDiv100) / 2)), 100);
            const activePrice = haggleState && haggleState.it === it ? haggleState.price : basePrice;

            const ask = haggleState && haggleState.it === it
              ? toSimp(captureConsoleText(this.c, () => { message(0xf6); printf(this.F.ld3, activePrice); message(0xf7); }).trim())
              : toSimp(captureConsoleText(this.c, () => { message(0xf5, item.nameBytes); printf(this.F.ld2, activePrice); message(0xf7); }).trim());
            const pAsk = document.createElement("div");
            pAsk.style.cssText = "font-size:14px;font-weight:600;color:var(--uw2-ink);";
            pAsk.textContent = ask;
            detail.appendChild(pAsk);

            const btnRow = document.createElement("div");
            btnRow.style.cssText = "display:flex;gap:10px;flex-wrap:wrap;";

            const sellBtn = document.createElement("button");
            sellBtn.className = "uw2-btn uw2-btn-primary";
            sellBtn.style.padding = "9px 22px";
            sellBtn.textContent = `卖出 (${activePrice.toLocaleString()} 金币)`;
            sellBtn.addEventListener("click", () => {
              if (equipped) { notice = capMsg(0x14d); render(); return; }
              if (item.power === 0) { notice = capMsg(0x3a1); render(); return; }
              let nextCash = (this.money + activePrice) | 0;
              if (nextCash >= GameConst.MAX_CASH) nextCash = GameConst.MAX_CASH;
              this.money = nextCash;
              for (let i = 0; i < GameConst.INV_SLOTS; i++) {
                if (m.inventory(i) === it) { m.setInventory(i, GameConst.EMPTY_SLOT); break; }
              }
              haggleState = null;
              this.b.p.panels();
              notice = capMsg(0xf8);
              render();
            });
            btnRow.appendChild(sellBtn);

            if (!equipped && item.power !== 0 && !(haggleState && haggleState.it === it)) {
              const hagBtn = document.createElement("button");
              hagBtn.className = "uw2-btn";
              hagBtn.style.padding = "9px 16px";
              hagBtn.textContent = "再议价";
              hagBtn.addEventListener("click", () => {
                const hero = m.heroPerson();
                if (sys.rng.random(100) <= hero.getStats(7)) {
                  const boosted = (basePrice + Math.trunc(Math.imul(basePrice, hero.getStats(6)) / 200)) | 0;
                  haggleState = { it, price: boosted };
                } else {
                  notice = capMsg(0xf8);
                }
                render();
              });
              btnRow.appendChild(hagBtn);
            }
            detail.appendChild(btnRow);
          }
        }
        right.appendChild(detail);
        split.append(left, right);
        h.body.appendChild(split);
      });

      render();
    });
  }
  // 130f7 本店商品 → [0538]
  shopList() {
    const eco = this.m.portEconomy(this.b.port), t = this.c.rt.time, n = t >= 6 && t < 9 ? 4 : 3, L = [];
    for (let i = 0; i < n; i++) { const v = eco.getShopItems(i); if (v !== GameConst.EMPTY_SLOT) L.push(v); }
    this.b.setPersons(L); return L.length;
  }
  // 0fea:32a6 = 13146 隨身物 → [0538]
  invList() {
    const m = this.m, L = [];
    for (let i = 0; i < GameConst.INV_SLOTS; i++) { const v = m.inventory(i); if (v !== GameConst.EMPTY_SLOT) L.push(v); }
    this.b.setPersons(L); return L.length;
  }
  // 29acd 能否再買: 沒錢 0xec / 已有 20 件 0xed
  async canBuy() {
    const b = this.b;
    if (this.money === 0) { b.greet(0xec); await b.wait(); return 0; }
    if (this.invList() === GameConst.INV_SLOTS) { b.greet(0xed); await b.wait(); return 0; }
    return 1;
  }
  // 29afb 買進
  async buy() {
    const b = this.b, m = this.m, { menu, printf, message } = this.c;
    let first = 1;
    for (;;) {
      b.table();                                                                // 0fea:b6bc
      if (!(await this.canBuy())) return;
      const n = this.shopList();
      b.greet(first ? 0xee : 0xf2);
      const di = await b.listSel().select(0x8d, n);
      if (di === -1) return;
      const it = this.c.persons[di] & 0xff, item = m.item(it);
      let owned = 0;
      for (let i = 0; i < GameConst.INV_SLOTS; i++) {
        if (m.inventory(i) === it && (item.kindFlags & ItemFlag.KIND_MASK) < ItemKind.NAVI_TOOL) { owned = 1; break; }
      }
      if (owned) { b.greet(0x14c); await b.wait(); continue; }
      const price = Math.imul(100, isS16(item.priceDiv100));
      if (this.c.scr.wideRenderer && this.c.codec) {
        const R = DS.TBL_ITEM + it * 0x14;
        const infoLines = captureConsoleText(this.c, () => b.itemInfo(it, 0)).split("\n").filter(Boolean);
        const ask = captureConsoleText(this.c, () => { message(0xf0, item.nameBytes); printf(this.F.ld, price); message(0xf1); });
        const imgUrl = this.c.art?.discoveryUrl?.(this.st.u8(R + 0x0f) + 0x55) ?? null;
        const ok = await runWideInfoLinesModal(this.c, decodeCleanCstr(this.c.codec, item.nameBytes), [...infoLines, "", ask], ["是", "否"], imgUrl);
        if (ok !== 0) continue;
      } else {
        b.itemInfo(it, 0);                                                        // 29340
        b.greet(0xf0, item.nameBytes); printf(this.F.ld, price); message(0xf1);
        if (!(await menu.yesNo())) continue;
      }
      if (price > this.money) { b.greet(0xef); await b.wait(); continue; }
      this.money = (this.money - price) | 0;
      for (let i = 0; i < GameConst.INV_SLOTS; i++) if (m.inventory(i) === GameConst.EMPTY_SLOT) { m.setInventory(i, it); first = 0; break; }
      this.b.p.panels();                                                        // 8894
    }
  }
  // 29c4a 賣出: 價格 = (價格/100 ÷ 2 向零取整) × 100; 拒絕時 random(100) ≤ 主角 +23 則加價 價格 × 主角 +22 / 200 再問一次
  async sell() {
    const b = this.b, m = this.m, { menu, printf, message, sys } = this.c;
    let first = 1;
    for (;;) {
      b.table();
      const n = this.invList();
      if (!n) { b.greet(0xf3); await b.wait(); return; }
      b.greet(first ? 0xf4 : 0xf8);
      const sel = await b.listSel().select(0x8d, n);
      if (sel === -1) return;
      const it = this.c.persons[sel] & 0xff, item = m.item(it);
      if (item.kindFlags & ItemFlag.EQUIPPED) { b.greet(0x14d); await b.wait(); continue; }
      let price = Math.imul(isS16(Math.trunc(isS16(item.priceDiv100) / 2)), 100);
      if (item.power === 0) { b.greet(0x3a1); await b.wait(); continue; }
      if (this.c.scr.wideRenderer && this.c.codec) {
        const R = DS.TBL_ITEM + it * 0x14;
        const infoLines = captureConsoleText(this.c, () => b.itemInfo(it, 0)).split("\n").filter(Boolean);
        const imgUrl = this.c.art?.discoveryUrl?.(this.st.u8(R + 0x0f) + 0x55) ?? null;
        const ask1 = captureConsoleText(this.c, () => { message(0xf5, item.nameBytes); printf(this.F.ld2, price); message(0xf7); });
        if ((await runWideInfoLinesModal(this.c, decodeCleanCstr(this.c.codec, item.nameBytes), [...infoLines, "", ask1], ["是", "否"], imgUrl)) !== 0) {
          const hero = m.heroPerson();
          if (sys.rng.random(100) > hero.getStats(7)) continue;
          price = (price + Math.trunc(Math.imul(price, hero.getStats(6)) / 200)) | 0;
          const ask2 = captureConsoleText(this.c, () => { message(0xf6); printf(this.F.ld3, price); message(0xf7); });
          if ((await runWideInfoLinesModal(this.c, decodeCleanCstr(this.c.codec, item.nameBytes), [...infoLines, "", ask2], ["是", "否"], imgUrl)) !== 0) continue;
        }
      } else {
        b.itemInfo(it, 0);
        b.greet(0xf5, item.nameBytes); printf(this.F.ld2, price); message(0xf7);
        if (!(await menu.yesNo())) {
          const hero = m.heroPerson();
          if (sys.rng.random(100) > hero.getStats(7)) continue;
          price = (price + Math.trunc(Math.imul(price, hero.getStats(6)) / 200)) | 0;
          b.greet(0xf6); printf(this.F.ld3, price); message(0xf7);
          if (!(await menu.yesNo())) continue;
        }
      }
      let nextCash = (this.money + price) | 0; if (nextCash >= GameConst.MAX_CASH) nextCash = GameConst.MAX_CASH;
      this.money = nextCash;
      for (let i = 0; i < GameConst.INV_SLOTS; i++) if (m.inventory(i) === it) { m.setInventory(i, GameConst.EMPTY_SLOT); first = 0; break; }
      this.b.p.panels();
    }
  }
}
