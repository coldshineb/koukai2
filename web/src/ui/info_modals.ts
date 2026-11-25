// ui/info_modals.ts — 随身物一体化工作台与队形变更面板（从 ui/info_hub.ts 拆分）
import { ItemFlag } from "../model/flags.ts";
import { heroOrDockSlot } from "../model/world_helpers.ts";
import { createDomModal, preserveScroll } from "./modals.ts";
import { UI_STR } from "./strings.ts";
import { decodeCleanCstr, toSimp } from "./text_util.ts";

/** 随身物一体化工作台：左侧道具清单 + 右侧高清道具插图、属性、原版说明与佩戴/使用按钮 */
export async function runDomBelongings(cmd: any): Promise<void> {
  const c = cmd.c, m = cmd.st.model, b = cmd.b, art = c.art;
  const dec = (bts: Uint8Array) => decodeCleanCstr(c.codec, bts);
  const title = UI_STR.belongingsTitle;
  const actLabels = [...UI_STR.belongingsActions];

  let selIdx = 0;

  for (;;) {
    const n = cmd.itemList();
    if (!n) return;
    const itemIds: number[] = [];
    for (let i = 0; i < n; i++) itemIds.push(c.persons[i] & 0xff);
    if (selIdx >= itemIds.length) selIdx = Math.max(0, itemIds.length - 1);

    const action = await new Promise<{ type: "close" | "equip" | "use"; it?: number }>(resolve => {
      let settled = false;
      const done = (v: { type: "close" | "equip" | "use"; it?: number }) => {
        if (settled) return;
        settled = true;
        h.close();
        resolve(v);
      };

      const h = createDomModal({
        title,
        size: "wide",
        cancelable: true,
        closeLabel: "关闭",
        onCancel: () => done({ type: "close" }),
      });

      const render = () => {
        preserveScroll(h.body, () => {
          h.body.innerHTML = "";
          const split = document.createElement("div");
          split.className = "uw2-split narrow-left";

          const left = document.createElement("div");
          left.className = "uw2-list-col";
          itemIds.forEach((it, i) => {
            const item = m.item(it);
            const eq = !!(item.kindFlags & ItemFlag.EQUIPPED);
            const btn = document.createElement("button");
            btn.className = `uw2-row-card ${i === selIdx ? "selected" : ""}`;
            btn.innerHTML = `<span style="font-weight:700;">${dec(item.nameBytes)}</span><span style="color:#8a5d17;font-weight:700;">${eq ? "★" : ""}</span>`;
            btn.addEventListener("click", () => { selIdx = i; render(); });
            left.appendChild(btn);
          });

          const right = document.createElement("div");
          right.className = "uw2-action-box";
          const it = itemIds[selIdx];
          const item = m.item(it);
          const imgUrl = art?.discoveryUrl?.(item.icon + 0x55);
          const itemType = item.kindFlags & ItemFlag.KIND_MASK;
          const itemVal = item.power;
          const isEquipped = !!(item.kindFlags & ItemFlag.EQUIPPED);
          const typeName = b.BG?.itemTypes?.[itemType] ? dec(b.BG.itemTypes[itemType]) : "";
          const lvItems = c.menuItems(0x22);
          const lines: string[] = [
            `${dec(item.nameBytes)}${typeName ? `（${typeName}）` : ""}${isEquipped ? "  [已装备]" : ""}`,
          ];
          if (itemType <= 3) {
            const gIdx = itemVal >= 0x23 ? 4 : Math.max(0, Math.min(4, Math.trunc((itemVal - 5) / 6)));
            lines.push(`攻击力：${dec(lvItems[gIdx] ?? Uint8Array.of(0))}`);
          } else if (itemType === 6) {
            const gIdx = itemVal > 0x28 ? 4 : Math.max(0, Math.min(4, Math.trunc((itemVal - 10) / 10)));
            lines.push(`防御力：${dec(lvItems[gIdx] ?? Uint8Array.of(0))}`);
          }
          const rawDesc = c.portAssets?.itemMes?.[it];
          if (rawDesc) lines.push(toSimp(String(rawDesc).replace(/\s+/g, " ").trim()));

          const head = document.createElement("div");
          head.style.cssText = "display:flex;gap:16px;align-items:flex-start;";
          if (imgUrl) {
            const img = document.createElement("img");
            img.src = imgUrl;
            img.style.cssText = "width:96px;height:96px;object-fit:contain;border-radius:8px;border:1px solid var(--uw2-gold);background:#141c2b;image-rendering:pixelated;flex-shrink:0;";
            head.appendChild(img);
          }
          const col = document.createElement("div");
          col.style.cssText = "flex:1;display:flex;flex-direction:column;gap:6px;";
          lines.forEach((l, idx) => {
            const d = document.createElement("div");
            d.style.cssText = idx === 0 ? "font-size:18px;font-weight:700;color:var(--uw2-ink);" : "font-size:14px;line-height:1.65;color:var(--uw2-ink);";
            d.textContent = l;
            col.appendChild(d);
          });
          head.appendChild(col);

          const btnRow = document.createElement("div");
          btnRow.className = "uw2-dialog-actions";
          const eqBtn = document.createElement("button");
          eqBtn.className = "uw2-btn uw2-btn-primary";
          eqBtn.style.padding = "8px 22px";
          eqBtn.textContent = actLabels[0];
          eqBtn.addEventListener("click", () => done({ type: "equip", it }));

          const useBtn = document.createElement("button");
          useBtn.className = "uw2-step-btn";
          useBtn.style.padding = "8px 22px";
          useBtn.textContent = actLabels[1];
          useBtn.addEventListener("click", () => done({ type: "use", it }));

          btnRow.append(eqBtn, useBtn);
          right.append(head, btnRow);

          split.append(left, right);
          h.body.appendChild(split);
        }, true);
      };

      render();
    });

    if (action.type === "close") return;
    if (action.type === "equip" && action.it !== undefined) await cmd.equip(action.it);
    else if (action.type === "use" && action.it !== undefined) await cmd.use(action.it);
  }
}

/** 现代队形变更面板：上移 / 下移 / 置顶实时调整舰队顺序，一键确定写回原版槽位 */
export function runDomFormation(cmd: any, title: string): Promise<void> {
  const c = cmd.c, m = cmd.st.model, b = cmd.b, art = c.art;
  const dec = (bts: Uint8Array) => decodeCleanCstr(c.codec, bts);
  const n = b.fleetShips();
  if (n <= 1) return Promise.resolve();

  const oldSlots: number[] = [];
  for (let i = 0; i < n; i++) oldSlots.push(c.persons[i] & 0xff);
  const order = [...oldSlots];

  return new Promise(resolve => {
    let settled = false;
    const finish = (apply: boolean) => {
      if (settled) return;
      settled = true;
      h.close();
      if (apply) {
        const oldArr = new Array(10).fill(0xff);
        const nwArr = new Array(10).fill(0xff);
        for (let i = 0; i < order.length; i++) { oldArr[i] = oldSlots[i]; nwArr[i] = order[i]; }
        cmd.fmApply(oldArr, nwArr);
      }
      resolve();
    };

    const h = createDomModal({
      title: title || "队形变更",
      size: "md",
      cancelable: true,
      closeLabel: "关闭",
      onCancel: () => finish(false),
    });

    const footer = document.createElement("div");
    footer.className = "uw2-modal-footer";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "uw2-btn";
    cancelBtn.style.padding = "7px 22px";
    cancelBtn.textContent = "取消";
    cancelBtn.addEventListener("click", () => finish(false));

    const okBtn = document.createElement("button");
    okBtn.className = "uw2-btn uw2-btn-primary";
    okBtn.style.padding = "7px 22px";
    okBtn.textContent = "确定";
    okBtn.addEventListener("click", () => finish(true));

    footer.append(cancelBtn, okBtn);
    h.modal.appendChild(footer);

    const render = () => {
      preserveScroll(h.body, () => {
        h.body.innerHTML = "";
        const list = document.createElement("div");
        list.className = "uw2-list-col";
        list.style.maxHeight = "440px";

        order.forEach((slot, idx) => {
          const slotView = heroOrDockSlot(m, slot), cs = m.crewSlot(slot);
          const ship = m.ship(slotView.ship);
          const typeId = ship.type;
          const capId = cs.captain;
          const capName = (capId & 0x80) ? "----" : dec(m.person(capId).givenNameBytes);
          const dur = slotView.durability, maxDur = slotView.maxDurability;
          const crew = slotView.crew, spd = (b.shipSpeed(slot) + 1) >> 1;

          const card = document.createElement("div");
          card.className = "uw2-slot-card";
          card.style.gap = "12px";

          const num = document.createElement("span");
          num.style.cssText = "width:26px;font-size:16px;font-weight:700;color:#8a5d17;text-align:center;";
          num.textContent = String(idx + 1);
          card.appendChild(num);

          const shipUrl = art?.shipUrl?.(typeId);
          if (shipUrl) {
            const img = document.createElement("img");
            img.src = shipUrl;
            img.style.cssText = "width:64px;height:42px;object-fit:contain;border-radius:4px;background:#0e1b30;border:1px solid var(--uw2-gold);padding:2px;flex-shrink:0;";
            card.appendChild(img);
          }

          const info = document.createElement("div");
          info.style.cssText = "flex:1;min-width:0;";
          info.innerHTML = `<div class="uw2-slot-title">${dec(ship.nameBytes)}</div><div class="uw2-slot-sub">${capName} · 耐久 ${dur}/${maxDur} · 水手 ${crew} · ${spd}kt</div>`;
          card.appendChild(info);

          const ctrl = document.createElement("div");
          ctrl.className = "uw2-step-row";

          const mkBtn = (lb: string, dis: boolean, fn: () => void) => {
            const btn = document.createElement("button");
            btn.className = "uw2-step-btn";
            btn.disabled = dis;
            btn.textContent = lb;
            btn.addEventListener("click", fn);
            return btn;
          };

          ctrl.append(
            mkBtn("置顶", idx === 0, () => {
              const [x] = order.splice(idx, 1);
              order.unshift(x);
              render();
            }),
            mkBtn("↑", idx === 0, () => {
              [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
              render();
            }),
            mkBtn("↓", idx === order.length - 1, () => {
              [order[idx + 1], order[idx]] = [order[idx], order[idx + 1]];
              render();
            }),
          );
          card.appendChild(ctrl);
          list.appendChild(card);
        });
        h.body.appendChild(list);
      }, true);
    };

    render();
  });
}
