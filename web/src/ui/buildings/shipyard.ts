// ui/buildings/shipyard.ts — 造船厂一体化工作台与剩余货物分配弹窗
import { GameConst, ShipSlotFlag } from "../../model/flags.ts";
import { getPortEcoExtra, heroOrDockSlot, setPortBuildDays, writeShipName } from "../../model/world_helpers.ts";
import { domS16 } from "../../domain/economy.ts";
import { decodeCleanCstr } from "../text_util.ts";
import { getBuildingArtUrl, preserveScroll } from "../modals.ts";
import { UI_STR } from "../strings.ts";
import { capMsg, createWorkbenchShell, fmtMoneyPill, plUmin, renderUnifiedInvestPane } from "./shared.ts";
import {
  mountNegotiateAndNameBox,
  mountShipDesignControls,
  renderShipHeader,
  runDomLeftoversModal,
  type ShipyardDesignState,
  type ShipyardHaggleState,
} from "./shipyard_parts.ts";

export { runDomLeftoversModal };
// ============================================================================
// 8. 造船厂一体化工作台 (Shipyard — 6 分页全部内置操作，零层叠弹窗)
// ============================================================================
export async function runDomShipyardWorkbench(b: any): Promise<void> {
  const c = b.c, m = b.st.model, codec = c.codec, art = c.art;
  const portName = decodeCleanCstr(codec, m.port(b.port).nameBytes);
  const tabLabels = [...UI_STR.shipyardTabs];
  const remodelLabels = [...UI_STR.remodelTabs];
  const initGreet = capMsg(c, 0x4d);

  // 依原版 rmFigure / rmGuns 规则：每次切换到「船首像」或「武装」子分页时都进行 1/20 稀有品判定（与原版反复进出子菜单刷彩蛋完全一致）
  const eco = m.portEconomy(b.port), ecoEx = getPortEcoExtra(eco), hero = m.heroPerson(), rng = c.sys.rng;
  let figCount = Math.min(8, Math.trunc(eco.commerce / 100) + 1);
  let gunCount = Math.min(6, Math.trunc(((eco.industry + eco.commerce) & 0xffff) / 200) + 1);
  let specialNotice = "";
  const rollFigureheads = () => {
    figCount = Math.min(8, Math.trunc(eco.commerce / 100) + 1);
    if (eco.industry > 800 && eco.commerce > 800 && hero.getStats(7) > 80 && !rng.random(20)) {
      figCount++;
      if (rng.random(hero.getStats(7)) >= 90) figCount++;
      specialNotice = capMsg(c, 0x10a);
      return true;
    }
    return false;
  };
  const rollGuns = () => {
    gunCount = Math.min(6, Math.trunc(((eco.industry + eco.commerce) & 0xffff) / 200) + 1);
    if (eco.industry > 900 && eco.commerce > 900 && hero.getStats(7) > 90 && !rng.random(20)) {
      gunCount++;
      specialNotice = capMsg(c, 0x10a);
      return true;
    }
    return false;
  };

  let tab = 0; // 0:造新船, 1:买旧船, 2:修理, 3:卖船, 4:改造, 5:工业投资
  let selIdx = 0;
  let rmSub = 0; // 0:船首像, 1:武装, 2:积载比例变更, 3:船名变更
  let selFig = 1;
  let selGun = 1;
  let gunQty = 1;
  let investAmt = 1000;
  let investReply = "";
  let replaceSlot = -1;
  let newMat = 0;
  const designState: ShipyardDesignState = { crew: -1, guns: -1 };
  const haggleState: ShipyardHaggleState = {
    customShipName: "",
    lastNameKey: "",
    offerPrice: -1,
    lastPriceKey: "",
    haggleOpen: false,
    haggleAccRand: 5,
  };
  let notice = specialNotice || initGreet;

  const hexToU8 = (s: string) => Uint8Array.from([...(s.match(/../g) || []).map(h => parseInt(h, 16)), 0]);
  const matTab = (c.portAssets?.data?.build?.materials || []).map(hexToU8);
  const figTab = (c.portAssets?.data?.build?.figureheads || []).map(hexToU8);

  const encodeShipNameSafe = (txt: string, fallback: Uint8Array): Uint8Array => {
    const trimmed = txt.trim();
    if (!trimmed) return fallback;
    try {
      return c.font.encode(trimmed);
    } catch {
      return fallback;
    }
  };

  for (;;) {
    let pendingLeftovers: null | { goods: number[]; amt: number[] } = null;
    let kickedOut = false;

    await new Promise<void>(resolve => {
      let settled = false;

      const done = () => {
        if (settled) return;
        settled = true;
        shell.h.close();
        resolve();
      };

      const shell = createWorkbenchShell(`${portName} · 造船厂`, b.money, done, getBuildingArtUrl(c, 2, b.p));

      const getFleetSlots = () => {
        const n = b.fleetShips();
        return Array.from({ length: n }, (_, i) => c.persons[i] & 0xff);
      };

      const getBuildableTypes = () => {
        const ind = eco.industry;
        const row = b.BT.levels[ecoEx.shipRegion];
        const out: number[] = [];
        for (let i = 0; i < 8; i++) {
          const t = row[i];
          if (t === GameConst.EMPTY_SLOT) break;
          if (((10 * m.shipType(t).shipClass) & 0xffff) <= ind) out.push(t);
        }
        return out;
      };

      const getUsedShips = () => {
        const cache = m.usedShipCache(0);
        const out: { cacheIdx: number; type: number }[] = [];
        for (let i = 0; i < 5; i++) {
          const t = cache.getShipTypes(i);
          if (t !== GameConst.EMPTY_SLOT) out.push({ cacheIdx: i, type: t });
        }
        return out;
      };

      const getFreeFleetSlot = () => {
        for (let i = 0; i < GameConst.FLEET_SHIPS; i++) {
          const f = b.slotState(i);
          if (f !== ShipSlotFlag.ACTIVE && f !== ShipSlotFlag.BUILDING) return i;
        }
        return -1;
      };

      const allocShipRecord = (slotIdx: number, typeId: number, tmpl: any, stype: any, isTrade: boolean, captainId: number, nameBytes: Uint8Array) => {
        const S = heroOrDockSlot(m, slotIdx), M = m.crewSlot(slotIdx);
        let n = 0;
        for (let i = 0; i < 0x28; i++) if (m.ship(i).type === GameConst.EMPTY_SLOT) { n = i; break; }
        const si = m.ship(n);
        si.maxGuns = stype.maxGuns;
        si.type = typeId;
        si.flags = tmpl.flags;
        si.maxCrew = tmpl.maxCrew;
        si.maxCargo = (stype.capacity - si.maxGuns - si.maxCrew) & 0xffff;
        const d = Math.trunc(9 * stype.durability / 10) & 0xffff;
        S.maxDurability = (d - Math.trunc((d & 0xff) / 15)) & 0xff;
        S.durability = S.maxDurability;
        S.turn = stype.turn;
        S.propulsion = stype.propulsion;
        S.guns = plUmin(S.guns, isTrade ? si.maxGuns : 0);
        S.crew = plUmin(S.crew, isTrade ? si.maxCrew : 0);
        S.ship = n;
        if (!isTrade) S.flags = ShipSlotFlag.ACTIVE;
        M.water = 0; M.food = 0; M.material = 0; M.ammo = 0;
        M.navRatio = 0x19; M.lookRatio = 0x32; M.captain = captainId;
        M.loadTotal = 0; M.figurehead = 0;
        for (let k = 0; k < GameConst.CARGO_SLOTS; k++) { M.setCargoGoods(k, GameConst.EMPTY_SLOT); M.setCargoAmts(k, 0); }
        writeShipName(si, nameBytes);
        return { S, M, si };
      };

      const render = () => preserveScroll(shell.h.body, () => {
        shell.moneyPill.textContent = fmtMoneyPill(b.money);
        shell.toastEl.textContent = notice;

        const usedList = getUsedShips();
        const fleetSlots = getFleetSlots();

        shell.toolbar.innerHTML = "";
        tabLabels.forEach((lbl, idx) => {
          const btn = document.createElement("button");
          btn.className = `uw2-btn uw2-tab-btn ${tab === idx ? "active" : ""}`;
          btn.disabled = (idx === 1 && usedList.length === 0) || ((idx === 2 || idx === 3 || idx === 4) && fleetSlots.length === 0);
          btn.textContent = lbl;
          btn.addEventListener("click", () => {
            tab = idx; selIdx = 0; replaceSlot = -1; designState.crew = -1; designState.guns = -1;
            if (tab === 4) {
              if (rmSub === 0 && rollFigureheads()) notice = specialNotice;
              else if (rmSub === 1 && rollGuns()) notice = specialNotice;
            }
            render();
          });
          shell.toolbar.appendChild(btn);
        });

        shell.h.body.innerHTML = "";
        const split = document.createElement("div");
        split.className = "uw2-split";
        const left = document.createElement("div");
        left.className = "uw2-pane";
        const right = document.createElement("div");
        right.className = "uw2-pane";

        if (tab === 0) {
          // ---- 0. 造新船 & 交船（全部就地完成，零层叠弹窗） ----
          const buildDays = ecoEx.buildDays;
          const types = getBuildableTypes();
          if (selIdx >= types.length) selIdx = Math.max(0, types.length - 1);

          const lt = document.createElement("div");
          lt.className = "uw2-pane-title";
          lt.textContent = buildDays !== GameConst.EMPTY_SLOT ? `建造中（剩余 ${buildDays} 天）` : `可建造船型（工业 ${eco.industry}）`;
          left.appendChild(lt);

          const list = document.createElement("div");
          list.className = "uw2-list-col";
          list.style.maxHeight = "390px";
          types.forEach((t, idx) => {
            const tmpl = m.ship(t + 40);
            const stype = m.shipType(t);
            const basePrice = domS16(stype.price);
            const row = document.createElement("button");
            row.className = `uw2-row-card ${idx === selIdx ? "selected" : ""}`;
            row.style.cssText = "display:flex;justify-content:space-between;align-items:center;";
            row.innerHTML = `<span class="uw2-item-name">${decodeCleanCstr(codec, tmpl.nameBytes)}</span><span class="uw2-item-price">${basePrice.toLocaleString()} 金币</span>`;
            row.addEventListener("click", () => { selIdx = idx; designState.crew = -1; designState.guns = -1; render(); });
            list.appendChild(row);
          });
          left.appendChild(list);

          const rt = document.createElement("div");
          rt.className = "uw2-pane-title";
          rt.textContent = tabLabels[0];
          right.appendChild(rt);

          const box = document.createElement("div");
          box.className = "uw2-action-box";
          if (buildDays !== GameConst.EMPTY_SLOT) {
            const p = document.createElement("div");
            p.style.cssText = "font-size:14px;color:var(--uw2-ink);";
            p.textContent = buildDays > 0 ? capMsg(c, 0x105, buildDays) : capMsg(c, 0x106, 0);
            box.appendChild(p);
            if (buildDays === 0) {
              const needMate = !b.findMate();
              const fleetFull = fleetSlots.length >= 10;
              const needPickReplace = needMate || fleetFull;
              if (needPickReplace) {
                const warn = document.createElement("div");
                warn.className = "uw2-speech-box";
                warn.textContent = needMate ? capMsg(c, 0xa6) : capMsg(c, 0xa7);
                box.appendChild(warn);
                if (replaceSlot < 0 || !fleetSlots.includes(replaceSlot)) replaceSlot = fleetSlots[0] ?? -1;
                const repRow = document.createElement("div");
                repRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;align-items:center;";
                fleetSlots.forEach(fs => {
                  const sNm = decodeCleanCstr(codec, m.ship(heroOrDockSlot(m, fs).ship).nameBytes);
                  const rb = document.createElement("button");
                  rb.className = `uw2-btn ${replaceSlot === fs ? "active" : ""}`;
                  rb.textContent = `替换 ${sNm}`;
                  rb.addEventListener("click", () => { replaceSlot = fs; render(); });
                  repRow.appendChild(rb);
                });
                box.appendChild(repRow);
              }
              const delBtn = document.createElement("button");
              delBtn.className = "uw2-btn uw2-btn-primary";
              delBtn.style.alignSelf = "flex-start";
              delBtn.textContent = "领取新船";
              delBtn.addEventListener("click", () => {
                let buildSlot = 0;
                for (let i = 0; i < 0x28; i++) {
                  if (m.crewSlot(i).captain === (b.port | 0x80) && b.slotState(i) === ShipSlotFlag.BUILDING) { buildSlot = i; break; }
                }
                let targetSlot = getFreeFleetSlot();
                let tradeIn = -1;
                let capId = b.findMate() ? b.b2f7 : m.globals.hero;
                if (needPickReplace) {
                  if (replaceSlot < 0) return;
                  tradeIn = replaceSlot;
                  targetSlot = replaceSlot;
                  capId = m.crewSlot(replaceSlot).captain;
                }
                const S = heroOrDockSlot(m, buildSlot), M = m.crewSlot(buildSlot);
                S.flags = (S.flags & 0xdf) | ShipSlotFlag.ACTIVE;
                M.captain = capId;
                if (capId !== m.globals.hero) m.person(capId).role = 2;
                setPortBuildDays(eco, GameConst.EMPTY_SLOT);
                if (targetSlot >= 0 && targetSlot !== buildSlot) b.swapSlots(buildSlot, targetSlot);
                if (tradeIn >= 0) {
                  b.b2f4 = buildSlot;
                  b.b2f5 = GameConst.EMPTY_SLOT;
                  const leftData = { goods: new Array(9).fill(0xff), amt: new Array(9).fill(0) };
                  b.transfer(1, leftData);
                  b.sellDone();
                  b.compactSlots();
                  if (leftData.goods[0] !== 0xff) { pendingLeftovers = leftData; done(); return; }
                } else {
                  b.compactSlots();
                }
                m.person(capId).role = capId !== m.globals.hero ? 2 : 1;
                b.fleetRecalc();
                b.p.panels();
                notice = capMsg(c, 0xfa);
                replaceSlot = -1;
                render();
              });
              box.appendChild(delBtn);
            }
          } else if (types.length) {
            const t = types[selIdx];
            const tmpl = m.ship(t + 40);
            const stype = m.shipType(t);
            const matCount = t === 0x18 ? 6 : Math.trunc((eco.industry - plUmin(500, eco.industry)) / 200) + 3;
            if (newMat >= matCount) newMat = matCount - 1;
            if (newMat < 0) newMat = 0;

            const durVal = plUmin(Math.trunc((newMat + 8) * stype.durability / 10), 100);
            const buildTime = Math.trunc((((100 - Math.trunc(eco.industry / 50)) & 0xffff) * stype.durability) / 100) & 0xff;
            const base = domS16(stype.price);
            const matPrice = (Math.trunc(base * 4 / 5) + Math.trunc(base * newMat / 10)) & 0xffff;
            const listPrice = Math.imul(Math.trunc(Math.imul(b.priceIndex() + 50, matPrice) / 100), 10) | 0;

            renderShipHeader(art, box, t, decodeCleanCstr(codec, tmpl.nameBytes), `耐久 ${durVal} · 转向 ${stype.turn} · 推进 ${stype.propulsion} · 工期 ${buildTime} 天`);
            const desc = document.createElement("div");
            desc.className = "uw2-speech-box";
            desc.textContent = capMsg(c, b.BT.typeMsg[t]);
            box.appendChild(desc);

            b.freeSlots();
            const hasDockSlot = domS16(c.persons[0]) >= 10;
            if (!hasDockSlot) {
              const full = document.createElement("div");
              full.style.cssText = "font-size:13px;font-weight:700;color:#a13626;";
              full.textContent = decodeCleanCstr(codec, b.BT.fmt.dockFull);
              box.appendChild(full);
            } else {
              const buildSlot = c.persons[0];
              const matRow = document.createElement("div");
              matRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;align-items:center;";
              const mLbl = document.createElement("span");
              mLbl.style.cssText = "font-size:12px;font-weight:700;color:var(--uw2-ink-muted);";
              mLbl.textContent = "材质";
              matRow.appendChild(mLbl);
              for (let mi = 0; mi < matCount; mi++) {
                const mName = matTab[mi] ? decodeCleanCstr(codec, matTab[mi]) : `材质#${mi}`;
                const mb = document.createElement("button");
                mb.className = `uw2-btn ${newMat === mi ? "active" : ""}`;
                mb.style.cssText = "padding:4px 10px;font-size:12px;";
                mb.textContent = mName;
                mb.addEventListener("click", () => { newMat = mi; render(); });
                matRow.appendChild(mb);
              }
              box.appendChild(matRow);

              mountShipDesignControls(box, stype, designState);
              mountNegotiateAndNameBox({
                b,
                state: haggleState,
                box,
                priceKey: `new_${t}_${newMat}`,
                defaultName: decodeCleanCstr(codec, tmpl.nameBytes),
                listPrice,
                tradeInSlot: -1,
                submitLabel: `签约造船 (${buildTime}天)`,
                onNotice: msg => { notice = msg; },
                onKickout: () => { kickedOut = true; done(); },
                onRender: render,
                onCommit: (offer, avail, nameTxt) => {
                  b.money = (avail - offer) | 0;
                  b.b2f4 = GameConst.EMPTY_SLOT;
                  b.b2f6 = buildSlot;
                  b.b2f7 = b.port | 0x80;
                  const { S, M, si } = allocShipRecord(buildSlot, t, tmpl, stype, false, b.port | 0x80, encodeShipNameSafe(nameTxt, tmpl.nameBytes));
                  S.flags = ShipSlotFlag.BUILDING;
                  si.flags = (si.flags & 0xf8) | newMat;
                  S.maxDurability = durVal;
                  S.durability = durVal;
                  si.maxCrew = designState.crew;
                  si.maxGuns = designState.guns;
                  si.maxCargo = Math.max(0, stype.capacity - designState.crew - designState.guns);
                  S.crew = plUmin(S.crew, si.maxCrew);
                  S.guns = plUmin(S.guns, si.maxGuns);
                  M.captain = b.port | 0x80;
                  setPortBuildDays(eco, buildTime);
                  b.p.panels();
                  notice = capMsg(c, 0x106, getPortEcoExtra(eco).buildDays);
                  render();
                },
              });
            }
          } else {
            box.textContent = capMsg(c, 0xfb);
          }
          right.appendChild(box);
        } else if (tab === 1) {
          // ---- 1. 买旧船（全部就地完成，零层叠弹窗） ----
          if (selIdx >= usedList.length) selIdx = Math.max(0, usedList.length - 1);
          const lt = document.createElement("div");
          lt.className = "uw2-pane-title";
          lt.textContent = tabLabels[1];
          left.appendChild(lt);

          const list = document.createElement("div");
          list.className = "uw2-list-col";
          usedList.forEach((u, idx) => {
            const tmpl = m.ship(u.type + 40);
            const price = m.shipType(u.type).price;
            const row = document.createElement("button");
            row.className = `uw2-row-card ${idx === selIdx ? "selected" : ""}`;
            row.style.cssText = "display:flex;justify-content:space-between;align-items:center;";
            row.innerHTML = `<span class="uw2-item-name">${decodeCleanCstr(codec, tmpl.nameBytes)}</span><span class="uw2-item-price">${price.toLocaleString()} 金币</span>`;
            row.addEventListener("click", () => { selIdx = idx; render(); });
            list.appendChild(row);
          });
          left.appendChild(list);

          const rt = document.createElement("div");
          rt.className = "uw2-pane-title";
          rt.textContent = "舰船详情";
          right.appendChild(rt);

          const box = document.createElement("div");
          box.className = "uw2-action-box";
          if (usedList.length) {
            const u = usedList[selIdx];
            const tmpl = m.ship(u.type + 40);
            const stype = m.shipType(u.type);
            const d0 = Math.trunc(9 * stype.durability / 10) & 0xffff;
            const usedDur = (d0 - Math.trunc((d0 & 0xff) / 15)) & 0xff;
            renderShipHeader(art, box, u.type, decodeCleanCstr(codec, tmpl.nameBytes), `耐久 ${usedDur} · 转向 ${stype.turn} · 推进 ${stype.propulsion} · 容量 ${stype.capacity}`);
            const desc = document.createElement("div");
            desc.className = "uw2-speech-box";
            desc.textContent = capMsg(c, b.BT.typeMsg[u.type]);
            box.appendChild(desc);

            const hasMate = !!b.findMate();
            const needReplace = !hasMate || fleetSlots.length >= 10;
            if (needReplace) {
              const warn = document.createElement("div");
              warn.style.cssText = "font-size:13px;font-weight:700;color:#8a4f11;";
              warn.textContent = !hasMate ? capMsg(c, 0xa6) : capMsg(c, 0xa7);
              box.appendChild(warn);
              if (replaceSlot < 0 || !fleetSlots.includes(replaceSlot)) replaceSlot = fleetSlots[0] ?? -1;
              const repRow = document.createElement("div");
              repRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;";
              fleetSlots.forEach(fs => {
                const sNm = decodeCleanCstr(codec, m.ship(heroOrDockSlot(m, fs).ship).nameBytes);
                const rb = document.createElement("button");
                rb.className = `uw2-btn ${replaceSlot === fs ? "active" : ""}`;
                rb.textContent = `替换 ${sNm}`;
                rb.addEventListener("click", () => { replaceSlot = fs; render(); });
                repRow.appendChild(rb);
              });
              box.appendChild(repRow);
            }

            const tradeInSlot = needReplace ? replaceSlot : -1;
            const listPrice = Math.imul(Math.trunc(Math.imul(b.priceIndex() + 50, stype.price) / 100), 10) | 0;

            mountNegotiateAndNameBox({
              b,
              state: haggleState,
              box,
              priceKey: `used_${u.cacheIdx}_${u.type}_${tradeInSlot}`,
              defaultName: decodeCleanCstr(codec, tmpl.nameBytes),
              listPrice,
              tradeInSlot,
              submitLabel: tabLabels[1],
              onNotice: msg => { notice = msg; },
              onKickout: () => { kickedOut = true; done(); },
              onRender: render,
              onCommit: (offer, avail, nameTxt) => {
                const targetSlot = needReplace ? replaceSlot : getFreeFleetSlot();
                if (targetSlot < 0) return;
                const capId = needReplace ? m.crewSlot(replaceSlot).captain : b.b2f7;
                b.money = (avail - offer) | 0;
                b.b2f4 = needReplace ? replaceSlot : GameConst.EMPTY_SLOT;
                b.b2f6 = targetSlot;
                b.b2f7 = capId;
                const leftData = { goods: new Array(9).fill(0xff), amt: new Array(9).fill(0) };
                if (b.b2f4 !== GameConst.EMPTY_SLOT) b.transfer(0, leftData);
                allocShipRecord(targetSlot, u.type, tmpl, stype, b.b2f4 !== GameConst.EMPTY_SLOT, capId, encodeShipNameSafe(nameTxt, tmpl.nameBytes));
                if (capId !== m.globals.hero) m.person(capId).role = 2;
                m.usedShipCache(0).setShipTypes(u.cacheIdx, GameConst.EMPTY_SLOT);
                b.fleetRecalc();
                b.p.panels();
                if (leftData.goods[0] !== 0xff) { pendingLeftovers = leftData; done(); return; }
                notice = decodeCleanCstr(codec, tmpl.nameBytes);
                replaceSlot = -1;
                render();
              },
            });
          }
          right.appendChild(box);
        } else if (tab === 2) {
          // ---- 2. 修理（全部就地完成，零弹窗） ----
          if (selIdx >= fleetSlots.length) selIdx = Math.max(0, fleetSlots.length - 1);
          const lt = document.createElement("div");
          lt.className = "uw2-pane-title";
          lt.textContent = "自舰队";
          left.appendChild(lt);

          const list = document.createElement("div");
          list.className = "uw2-list-col";
          fleetSlots.forEach((slot, idx) => {
            const slotView = heroOrDockSlot(m, slot), ship = m.ship(slotView.ship), stype = m.shipType(ship.type);
            const dmg = domS16(slotView.maxDurability - slotView.durability - slotView.turn - slotView.propulsion + stype.turn + stype.propulsion);
            const cost = dmg > 0 ? domS16(dmg * 20) : 0;
            const row = document.createElement("button");
            row.className = `uw2-row-card ${idx === selIdx ? "selected" : ""}`;
            row.style.cssText = "display:flex;justify-content:space-between;align-items:center;";
            row.innerHTML =
              `<span class="uw2-item-name">${decodeCleanCstr(codec, ship.nameBytes)}</span>` +
              `<span class="uw2-item-price ${cost ? "err" : "ok"}">${cost ? `${cost.toLocaleString()} 金币` : "完好"}</span>`;
            row.addEventListener("click", () => { selIdx = idx; render(); });
            list.appendChild(row);
          });
          left.appendChild(list);

          const rt = document.createElement("div");
          rt.className = "uw2-pane-title";
          rt.textContent = tabLabels[2];
          right.appendChild(rt);

          const box = document.createElement("div");
          box.className = "uw2-action-box";
          if (fleetSlots.length) {
            const slot = fleetSlots[selIdx];
            const slotView = heroOrDockSlot(m, slot), ship = m.ship(slotView.ship), stype = m.shipType(ship.type);
            const dur = slotView.durability, maxDur = slotView.maxDurability;
            const turn = slotView.turn, prop = slotView.propulsion;
            const dmg = domS16(maxDur - dur - turn - prop + stype.turn + stype.propulsion);
            const cost = dmg > 0 ? domS16(dmg * 20) : 0;
            renderShipHeader(art, box, ship.type, decodeCleanCstr(codec, ship.nameBytes), `耐久 ${dur}/${maxDur} · 转向 ${turn}/${stype.turn} · 推进 ${prop}/${stype.propulsion}`);

            const p = document.createElement("div");
            p.style.cssText = "font-size:14px;color:var(--uw2-ink);";
            p.textContent = cost ? capMsg(c, 0xcd, cost) : capMsg(c, 0xcc);
            box.appendChild(p);

            const repBtn = document.createElement("button");
            repBtn.className = "uw2-btn uw2-btn-primary";
            repBtn.style.alignSelf = "flex-start";
            repBtn.disabled = cost <= 0;
            repBtn.textContent = cost ? `${tabLabels[2]}（${cost.toLocaleString()} 金币）` : tabLabels[2];
            repBtn.addEventListener("click", () => {
              if (cost > b.money) { notice = capMsg(c, 0xcf); render(); return; }
              b.money = (b.money - cost) | 0;
              slotView.durability = maxDur;
              slotView.turn = stype.turn;
              slotView.propulsion = stype.propulsion;
              b.p.panels();
              notice = capMsg(c, 0xcc);
              render();
            });
            box.appendChild(repBtn);
          }
          right.appendChild(box);
        } else if (tab === 3) {
          // ---- 3. 卖船（全部就地完成，零弹窗） ----
          if (selIdx >= fleetSlots.length) selIdx = Math.max(0, fleetSlots.length - 1);
          const lt = document.createElement("div");
          lt.className = "uw2-pane-title";
          lt.textContent = "自舰队";
          left.appendChild(lt);

          const list = document.createElement("div");
          list.className = "uw2-list-col";
          fleetSlots.forEach((slot, idx) => {
            const ship = m.ship(heroOrDockSlot(m, slot).ship);
            const val = Math.trunc(b.shipPrice(slot) / 2);
            const row = document.createElement("button");
            row.className = `uw2-row-card ${idx === selIdx ? "selected" : ""}`;
            row.style.cssText = "display:flex;justify-content:space-between;align-items:center;";
            row.innerHTML = `<span class="uw2-item-name">${decodeCleanCstr(codec, ship.nameBytes)}</span><span class="uw2-item-price">${val.toLocaleString()} 金币</span>`;
            row.addEventListener("click", () => { selIdx = idx; replaceSlot = -1; render(); });
            list.appendChild(row);
          });
          left.appendChild(list);

          const rt = document.createElement("div");
          rt.className = "uw2-pane-title";
          rt.textContent = tabLabels[3];
          right.appendChild(rt);

          const box = document.createElement("div");
          box.className = "uw2-action-box";
          if (fleetSlots.length <= 1) {
            box.textContent = capMsg(c, 0xd0);
          } else {
            const slot = fleetSlots[selIdx];
            const slotView = heroOrDockSlot(m, slot), cs = m.crewSlot(slot), ship = m.ship(slotView.ship);
            const val = Math.trunc(b.shipPrice(slot) / 2);
            const isHeroShip = cs.captain === m.globals.hero;
            renderShipHeader(art, box, ship.type, decodeCleanCstr(codec, ship.nameBytes), `载货 ${b.cargoUsed(slot)} · 水手 ${slotView.crew}/${ship.maxCrew}`);

            const p = document.createElement("div");
            p.style.cssText = "font-size:14px;color:var(--uw2-ink);";
            p.textContent = capMsg(c, 0xd5, val);
            box.appendChild(p);

            if (isHeroShip) {
              const others = fleetSlots.filter(s => s !== slot);
              if (replaceSlot < 0 || !others.includes(replaceSlot)) replaceSlot = others[0];
              const repRow = document.createElement("div");
              repRow.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;align-items:center;";
              const lbl = document.createElement("span");
              lbl.style.cssText = "font-size:13px;font-weight:700;color:var(--uw2-ink-muted);";
              lbl.textContent = capMsg(c, 0xd2);
              repRow.appendChild(lbl);
              others.forEach(os => {
                const oShip = m.ship(heroOrDockSlot(m, os).ship);
                const ob = document.createElement("button");
                ob.className = `uw2-btn ${replaceSlot === os ? "active" : ""}`;
                ob.textContent = decodeCleanCstr(codec, oShip.nameBytes);
                ob.addEventListener("click", () => { replaceSlot = os; render(); });
                repRow.appendChild(ob);
              });
              box.appendChild(repRow);
            }

            const sellBtn = document.createElement("button");
            sellBtn.className = "uw2-btn uw2-btn-primary";
            sellBtn.style.alignSelf = "flex-start";
            sellBtn.textContent = `${tabLabels[3]}（${val.toLocaleString()} 金币）`;
            sellBtn.addEventListener("click", () => {
              b.b2f4 = slot;
              b.b2f5 = isHeroShip ? replaceSlot : GameConst.EMPTY_SLOT;
              b.sellDone();
              selIdx = 0;
              replaceSlot = -1;
              render();
            });
            box.appendChild(sellBtn);
          }
          right.appendChild(box);
        } else if (tab === 4) {
          // ---- 4. 改造（船首像 / 武装 / 积载比例变更 / 船名变更，全部内置分页） ----
          if (selIdx >= fleetSlots.length) selIdx = Math.max(0, fleetSlots.length - 1);
          const lt = document.createElement("div");
          lt.className = "uw2-pane-title";
          lt.textContent = "自舰队";
          left.appendChild(lt);

          const list = document.createElement("div");
          list.className = "uw2-list-col";
          fleetSlots.forEach((slot, idx) => {
            const slotView = heroOrDockSlot(m, slot), ship = m.ship(slotView.ship);
            const row = document.createElement("button");
            row.className = `uw2-row-card ${idx === selIdx ? "selected" : ""}`;
            row.style.cssText = "display:flex;justify-content:space-between;align-items:center;";
            row.innerHTML = `<span class="uw2-item-name">${decodeCleanCstr(codec, ship.nameBytes)}</span><span class="uw2-item-meta">火炮 ${slotView.guns}/${ship.maxGuns}</span>`;
            row.addEventListener("click", () => { selIdx = idx; render(); });
            list.appendChild(row);
          });
          left.appendChild(list);

          const rt = document.createElement("div");
          rt.className = "uw2-pane-title";
          rt.textContent = tabLabels[4];
          right.appendChild(rt);

          const box = document.createElement("div");
          box.className = "uw2-action-box";

          const subBar = document.createElement("div");
          subBar.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;";
          remodelLabels.forEach((rl, ri) => {
            const sb = document.createElement("button");
            sb.className = `uw2-btn ${rmSub === ri ? "active" : ""}`;
            sb.textContent = rl;
            sb.addEventListener("click", () => {
              rmSub = ri;
              if (ri === 0 && rollFigureheads()) notice = specialNotice;
              else if (ri === 1 && rollGuns()) notice = specialNotice;
              render();
            });
            subBar.appendChild(sb);
          });
          box.appendChild(subBar);

          const slot = fleetSlots[selIdx];
          const slotView = heroOrDockSlot(m, slot), cs = m.crewSlot(slot), ship = m.ship(slotView.ship);

          if (rmSub === 0) {
            // 船首像
            if (selFig > figCount) selFig = 1;
            const fGrid = document.createElement("div");
            fGrid.style.cssText = "display:grid;grid-template-columns:repeat(2,1fr);gap:6px;";
            for (let v = 1; v <= figCount; v++) {
              const nm = figTab[v] ? decodeCleanCstr(codec, figTab[v]) : `#${v}`;
              const price = v * v * 500;
              const fb = document.createElement("button");
              fb.className = `uw2-row-card ${selFig === v ? "selected" : ""}`;
              fb.style.cssText = "display:flex;justify-content:space-between;padding:7px 10px;font-size:13px;";
              fb.innerHTML = `<span>${nm}</span><span style="color:#7c5216;">${price.toLocaleString()}</span>`;
              fb.addEventListener("click", () => { selFig = v; render(); });
              fGrid.appendChild(fb);
            }
            box.appendChild(fGrid);

            const price = selFig * selFig * 500;
            const okBtn = document.createElement("button");
            okBtn.className = "uw2-btn uw2-btn-primary";
            okBtn.style.alignSelf = "flex-start";
            okBtn.textContent = `${remodelLabels[0]}（${price.toLocaleString()} 金币）`;
            okBtn.addEventListener("click", () => {
              if (b.money < price) { notice = capMsg(c, 0xcf); render(); return; }
              b.money = (b.money - price) | 0;
              cs.figurehead = selFig;
              b.p.panels();
              notice = figTab[selFig] ? decodeCleanCstr(codec, figTab[selFig]) : "";
              render();
            });
            box.appendChild(okBtn);
          } else if (rmSub === 1) {
            // 武装
            if (selGun > gunCount) selGun = 1;
            const gGrid = document.createElement("div");
            gGrid.style.cssText = "display:grid;grid-template-columns:repeat(2,1fr);gap:6px;";
            for (let v = 1; v <= gunCount; v++) {
              const nm = decodeCleanCstr(codec, b.BT.cannons[v]);
              const unitP = domS16(b.BT.cannonPrice[v]);
              const gb = document.createElement("button");
              gb.className = `uw2-row-card ${selGun === v ? "selected" : ""}`;
              gb.style.cssText = "display:flex;justify-content:space-between;padding:7px 10px;font-size:13px;";
              gb.innerHTML = `<span>${nm}</span><span style="color:#7c5216;">${unitP.toLocaleString()}</span>`;
              gb.addEventListener("click", () => { selGun = v; render(); });
              gGrid.appendChild(gb);
            }
            box.appendChild(gGrid);

            const same = (slotView.flags & ShipSlotFlag.CANNON_MASK) === selGun;
            const maxG = ship.maxGuns;
            const curG = slotView.guns;
            const room = same ? Math.max(0, maxG - curG) : maxG;
            if (gunQty > room) gunQty = room;
            if (gunQty < 1 && room > 0) gunQty = 1;

            if (room <= 0) {
              const emp = document.createElement("div");
              emp.style.fontSize = "13px";
              emp.textContent = maxG === 0 ? capMsg(c, 0x3fd) : capMsg(c, 0x3fc);
              box.appendChild(emp);
            } else {
              const unitP = domS16(b.BT.cannonPrice[selGun]);
              const sRow = document.createElement("div");
              sRow.style.cssText = "display:flex;align-items:center;gap:10px;";
              const sl = document.createElement("input");
              sl.type = "range";
              sl.className = "uw2-slider";
              sl.style.flex = "1";
              sl.min = "1";
              sl.max = String(room);
              sl.value = String(gunQty);
              const valSp = document.createElement("span");
              valSp.style.cssText = "font-size:13px;font-weight:700;min-width:110px;text-align:right;";
              const syncG = () => { valSp.textContent = `${gunQty} 门（${(gunQty * unitP).toLocaleString()} 金币）`; };
              sl.addEventListener("input", () => { gunQty = Number(sl.value); syncG(); });
              syncG();
              sRow.append(sl, valSp);
              box.appendChild(sRow);

              const buyG = document.createElement("button");
              buyG.className = "uw2-btn uw2-btn-primary";
              buyG.style.alignSelf = "flex-start";
              buyG.textContent = remodelLabels[1];
              buyG.addEventListener("click", () => {
                const total = Math.imul(gunQty, unitP) | 0;
                if (total > b.money) { notice = capMsg(c, 0xcf); render(); return; }
                b.money = (b.money - total) | 0;
                const nextQ = same ? (curG + gunQty) & 0xff : gunQty & 0xff;
                slotView.guns = nextQ;
                slotView.flags = (slotView.flags & ~ShipSlotFlag.CANNON_MASK) | (selGun & 0xff);
                b.p.panels();
                notice = `${decodeCleanCstr(codec, b.BT.cannons[selGun])} × ${nextQ}`;
                render();
              });
              box.appendChild(buyG);
            }
          } else if (rmSub === 2) {
            // 积载比例变更（就地滑杆调整，零弹窗）
            const stype = m.shipType(ship.type);
            const cost = domS16(stype.price);
            const p = document.createElement("div");
            p.style.fontSize = "14px";
            p.textContent = `${capMsg(c, 0x112, cost)}（当前载货 ${b.cargoUsed(slot)}/${ship.maxCargo}）`;
            box.appendChild(p);
            mountShipDesignControls(box, stype, designState, ship.maxCrew, ship.maxGuns);
            const btn = document.createElement("button");
            btn.className = "uw2-btn uw2-btn-primary";
            btn.style.alignSelf = "flex-start";
            btn.textContent = `${remodelLabels[2]}（${cost.toLocaleString()} 金币）`;
            btn.addEventListener("click", () => {
              if (cost > b.money) { notice = capMsg(c, 0xcf); render(); return; }
              const nextCargo = Math.max(0, stype.capacity - designState.crew - designState.guns);
              if (domS16(b.cargoUsed(slot)) > domS16(nextCargo)) { notice = capMsg(c, 0x14); render(); return; }
              b.money = (b.money - cost) | 0;
              ship.maxCargo = nextCargo;
              ship.maxCrew = designState.crew;
              ship.maxGuns = designState.guns;
              slotView.crew = plUmin(slotView.crew, ship.maxCrew);
              slotView.guns = plUmin(slotView.guns, ship.maxGuns);
              b.p.panels();
              notice = `${decodeCleanCstr(codec, ship.nameBytes)}：载货 ${nextCargo} · 水手 ${designState.crew} · 火炮 ${designState.guns}`;
              render();
            });
            box.appendChild(btn);
          } else {
            // 船名变更（就地输入改名）
            const curName = decodeCleanCstr(codec, ship.nameBytes);
            const inp = document.createElement("input");
            inp.type = "text";
            inp.maxLength = 7;
            inp.value = curName;
            inp.style.cssText = "width:100%;padding:8px 12px;font-size:16px;font-weight:700;border:1px solid var(--uw2-gold);border-radius:6px;background:#fffdf6;color:var(--uw2-ink);";
            const btn = document.createElement("button");
            btn.className = "uw2-btn uw2-btn-primary";
            btn.style.alignSelf = "flex-start";
            btn.textContent = remodelLabels[3];
            btn.addEventListener("click", () => {
              const nv = inp.value.trim();
              if (!nv) return;
              try {
                writeShipName(ship, c.font.encode(nv));
                b.p.panels();
                notice = nv;
                render();
              } catch { /* 字库未收录字符保留原名 */ }
            });
            box.append(inp, btn);
          }
          right.appendChild(box);
        } else {
          // ---- 5. 工业投资（与交易所商业投资 1:1 统一面板） ----
          shell.toastEl.textContent = "";
          const curInv = eco.industryInvest;
          const capAmt = b.money >= GameConst.MAX_INVEST ? GameConst.MAX_INVEST : b.money & 0xffff;
          const maxInv = b.isCapital() ? 0 : Math.min(capAmt, Math.max(0, GameConst.MAX_INVEST - curInv));
          if (investAmt > maxInv) investAmt = maxInv;
          const blockMsg = b.isCapital() ? capMsg(c, 2) : curInv >= GameConst.MAX_INVEST ? (investReply || capMsg(c, 7)) : "";
          renderUnifiedInvestPane({
            container: shell.h.body,
            leftTitle: "港口工业",
            rightTitle: tabLabels[5],
            statLabel: "工业价值",
            statValue: eco.industry,
            investLabel: "本月工业投资",
            curInvest: curInv,
            maxInvest: maxInv,
            amount: investAmt,
            blockMsg,
            promptMsg: investReply || capMsg(c, 8),
            confirmLabel: tabLabels[5],
            onAmountChange: v => { investAmt = v; },
            onConfirm: v => {
              if (v <= 0) { investReply = capMsg(c, 0x0d); render(); return; }
              eco.industryInvest += v;
              b.investSupport(v);
              b.investOwner();
              b.money = (b.money - v) | 0;
              b.p.panels();
              investReply = capMsg(c, v < 500 ? 0x0e : v < 10000 ? 0x0f : 0x10);
              investAmt = 0;
              render();
            },
          });
          return;
        }

        split.append(left, right);
        shell.h.body.appendChild(split);
      });

      render();
    });

    if (kickedOut) {
      b.greet(0xc5);
      await b.wait();
      await b.closeTalk();
      break;
    }
    if (!pendingLeftovers) break;
    await b.leftovers(pendingLeftovers);
    b.after();
    if (m.globals.dailyFlags & 2) break;
  }
}
