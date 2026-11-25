// ui/buildings/itemshop.ts — 道具店一体化工作台
import { GameConst, ItemFlag } from "../../model/flags.ts";
import { addCashClamped } from "../../core/prefs.ts";
import { captureConsoleText, decodeCleanCstr, toSimp } from "../text_util.ts";
import { createDomModal, getBuildingArtUrl, mountBuildingBanner, preserveScroll } from "../modals.ts";
import { UI_STR } from "../strings.ts";
import { capMsg, fmtMoneyPill, plS16 } from "./shared.ts";

export async function runDomItemShopWorkbench(shop: any): Promise<void> {
  const b = shop.b, m = shop.m, c = shop.c;
  const { codec, art, sys, message, printf } = c;
  const t = c.rt.time;
  const isNightGreet = c.prefs?.fixItemShopNight ? (t >= 6 && t < 9) : (t >= 12 && t < 18);
  const initGreet = capMsg(c, isNightGreet ? 0x2fc : 0xeb);
  const tabLabels = [...UI_STR.itemShopTabs];
  const portName = decodeCleanCstr(codec, m.port(b.port).nameBytes);

  return new Promise(resolve => {
    let settled = false;
    let tab = 0; // 0 = 买进, 1 = 卖出
    let selIdx = 0;
    let notice = initGreet;
    let haggleState: { it: number; price: number } | null = null;

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
      closeLabel: "关闭",
      onCancel: done,
    });

    const moneyPill = document.createElement("span");
    moneyPill.className = "uw2-pill";
    h.headerRight.prepend(moneyPill);

    const toolbar = mountBuildingBanner(h.modal, h.body, getBuildingArtUrl(c, 9, b.p));

    const footer = document.createElement("div");
    footer.className = "uw2-modal-footer";
    const toastEl = document.createElement("span");
    toastEl.style.cssText = "font-size:13px;font-weight:600;color:#247544;";
    footer.appendChild(toastEl);
    h.modal.appendChild(footer);

    const getList = () => {
      if (tab === 0) {
        const n = shop.shopList();
        return Array.from({ length: n }, (_, i) => c.persons[i] & 0xff);
      }
      const n = shop.invList();
      return Array.from({ length: n }, (_, i) => c.persons[i] & 0xff);
    };

    const isOwnedNonTool = (it: number) => {
      const item = m.item(it);
      if ((item.kindFlags & ItemFlag.KIND_MASK) >= 3) return false; // ItemKind.NAVI_TOOL
      for (let i = 0; i < GameConst.INV_SLOTS; i++) if (m.inventory(i) === it) return true;
      return false;
    };

    const render = () => preserveScroll(h.body, () => {
      moneyPill.textContent = fmtMoneyPill(shop.money);
      toastEl.textContent = notice;

      toolbar.innerHTML = "";
      tabLabels.forEach((lbl: string, idx: number) => {
        const btn = document.createElement("button");
        btn.className = `uw2-btn uw2-tab-btn ${tab === idx ? "active" : ""}`;
        btn.textContent = lbl || (idx === 0 ? "买进" : "卖出");
        btn.addEventListener("click", () => {
          tab = idx;
          selIdx = 0;
          haggleState = null;
          render();
        });
        toolbar.appendChild(btn);
      });

      h.body.innerHTML = "";

      const listIds = getList();
      if (selIdx >= listIds.length) selIdx = Math.max(0, listIds.length - 1);

      const split = document.createElement("div");
      split.className = "uw2-split";

      const left = document.createElement("div");
      left.className = "uw2-pane";
      const leftTitle = document.createElement("div");
      leftTitle.className = "uw2-pane-title";
      leftTitle.textContent = tab === 0 ? "本店商品" : "随身物品";
      left.appendChild(leftTitle);

      const listWrap = document.createElement("div");
      listWrap.className = "uw2-list-col";
      listWrap.style.maxHeight = "410px";

      if (!listIds.length) {
        const empty = document.createElement("div");
        empty.className = "uw2-empty";
        empty.textContent = tab === 1 ? capMsg(c, 0xf3) : "暂无商品";
        listWrap.appendChild(empty);
      } else {
        listIds.forEach((it, idx) => {
          const item = m.item(it);
          const name = decodeCleanCstr(codec, item.nameBytes);
          const price = tab === 0
            ? Math.imul(100, plS16(item.priceDiv100))
            : Math.imul(plS16(Math.trunc(plS16(item.priceDiv100) / 2)), 100);
          const equipped = !!(item.kindFlags & ItemFlag.EQUIPPED);
          const owned = tab === 0 && isOwnedNonTool(it);

          const row = document.createElement("button");
          row.className = `uw2-row-card ${idx === selIdx ? "selected" : ""}`;
          row.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:10px;";

          const leftTxt = document.createElement("span");
          leftTxt.className = "uw2-item-name";
          leftTxt.textContent = name + (equipped ? " [装备中]" : owned ? " [已持有]" : "");

          const rightTxt = document.createElement("span");
          rightTxt.className = "uw2-item-price";
          rightTxt.textContent = tab === 1 && item.power === 0 ? "不可出售" : `${price.toLocaleString()} 金币`;

          row.append(leftTxt, rightTxt);
          row.addEventListener("click", () => { selIdx = idx; haggleState = null; render(); });
          listWrap.appendChild(row);
        });
      }
      left.appendChild(listWrap);

      const right = document.createElement("div");
      right.className = "uw2-pane";
      const rightTitle = document.createElement("div");
      rightTitle.className = "uw2-pane-title";
      rightTitle.textContent = "物品详情";
      right.appendChild(rightTitle);

      const detail = document.createElement("div");
      detail.className = "uw2-action-box";

      if (listIds.length) {
        const it = listIds[selIdx];
        const item = m.item(it);
        const name = decodeCleanCstr(codec, item.nameBytes);
        const imgUrl = art?.discoveryUrl?.(item.icon + 0x55) ?? null;
        const infoLines = captureConsoleText(c, () => b.itemInfo(it, 0)).split("\n").map(s => toSimp(s.trim())).filter(Boolean);

        const head = document.createElement("div");
        head.style.cssText = "display:flex;align-items:center;gap:12px;";
        if (imgUrl) {
          const img = document.createElement("img");
          img.src = imgUrl;
          img.style.cssText = "width:64px;height:64px;object-fit:contain;border-radius:8px;border:1px solid rgba(154,119,56,0.4);background:#fffdf6;";
          head.appendChild(img);
        }
        const titleBox = document.createElement("div");
        titleBox.innerHTML = `<div class="uw2-detail-title">${name}</div>`;
        head.appendChild(titleBox);
        detail.appendChild(head);

        if (infoLines.length) {
          const infoBox = document.createElement("div");
          infoBox.className = "uw2-speech-box";
          infoBox.textContent = infoLines.join("\n");
          detail.appendChild(infoBox);
        }

        if (tab === 0) {
          const price = Math.imul(100, plS16(item.priceDiv100));
          const owned = isOwnedNonTool(it);
          const full = shop.invList() >= GameConst.INV_SLOTS;
          const ask = toSimp(captureConsoleText(c, () => { message(0xf0, item.nameBytes); printf(shop.F.ld, price); message(0xf1); }).trim());
          const pAsk = document.createElement("div");
          pAsk.style.cssText = "font-size:14px;font-weight:600;color:var(--uw2-ink);";
          pAsk.textContent = ask;
          detail.appendChild(pAsk);

          const buyBtn = document.createElement("button");
          buyBtn.className = "uw2-btn uw2-btn-primary";
          buyBtn.style.cssText = "padding:9px 22px;align-self:flex-start;";
          buyBtn.textContent = `购买 (${price.toLocaleString()} 金币)`;
          buyBtn.addEventListener("click", () => {
            if (shop.money === 0) { notice = capMsg(c, 0xec); render(); return; }
            if (full) { notice = capMsg(c, 0xed); render(); return; }
            if (owned) { notice = capMsg(c, 0x14c); render(); return; }
            if (price > shop.money) { notice = capMsg(c, 0xef); render(); return; }
            shop.money = (shop.money - price) | 0;
            for (let i = 0; i < GameConst.INV_SLOTS; i++) {
              if (m.inventory(i) === GameConst.EMPTY_SLOT) { m.setInventory(i, it); break; }
            }
            b.p.panels();
            notice = capMsg(c, 0xf2);
            render();
          });
          detail.appendChild(buyBtn);
        } else {
          const equipped = !!(item.kindFlags & ItemFlag.EQUIPPED);
          const basePrice = Math.imul(plS16(Math.trunc(plS16(item.priceDiv100) / 2)), 100);
          const activePrice = haggleState && haggleState.it === it ? haggleState.price : basePrice;

          const ask = haggleState && haggleState.it === it
            ? toSimp(captureConsoleText(c, () => { message(0xf6); printf(shop.F.ld3, activePrice); message(0xf7); }).trim())
            : toSimp(captureConsoleText(c, () => { message(0xf5, item.nameBytes); printf(shop.F.ld2, activePrice); message(0xf7); }).trim());
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
            if (equipped) { notice = capMsg(c, 0x14d); render(); return; }
            if (item.power === 0) { notice = capMsg(c, 0x3a1); render(); return; }
            shop.money = addCashClamped(shop.money, activePrice, c);
            for (let i = 0; i < GameConst.INV_SLOTS; i++) {
              if (m.inventory(i) === it) { m.setInventory(i, GameConst.EMPTY_SLOT); break; }
            }
            haggleState = null;
            b.p.panels();
            notice = capMsg(c, 0xf8);
            render();
          });
          btnRow.appendChild(sellBtn);

          if (!equipped && item.power !== 0 && !(haggleState && haggleState.it === it)) {
            const hagBtn = document.createElement("button");
            hagBtn.className = "uw2-btn";
            hagBtn.style.padding = "9px 16px";
            hagBtn.textContent = "议价";
            hagBtn.addEventListener("click", () => {
              const hero = m.heroPerson();
              if (sys.rng.random(100) <= hero.getStats(7)) {
                const boosted = (basePrice + Math.trunc(Math.imul(basePrice, hero.getStats(6)) / 200)) | 0;
                haggleState = { it, price: boosted };
              } else {
                notice = capMsg(c, 0xf8);
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
