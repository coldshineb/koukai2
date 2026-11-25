// ui/buildings/house.ts — 住宅一体化工作台
import { DiscoveryFlag, GameConst, NobleFlag, SkillFlag } from "../../model/flags.ts";
import { getWorkState, revealEntireWorldMap, setExploreUnrep } from "../../model/world_helpers.ts";
import { captureConsoleText, decodeCleanCstr, toSimp } from "../text_util.ts";
import { getBuildingArtUrl, preserveScroll, runDomStoryCard } from "../modals.ts";
import { ListSelect } from "../dos/listsel.js";
import { capMsg, createWorkbenchShell, fmtMoneyPill } from "./shared.ts";
// =========================================================================
// 9. 住宅一体化工作台 (House — 发现物收购 / 地图制作 / 测量技术 / 砲术)
// =========================================================================
export async function runDomHouseWorkbench(house: any): Promise<void> {
  const b = house.b, c = house.c, m = house.m, noble = house.noble;
  const { codec, art, sys } = c;
  const kind = noble.kind;
  const portName = decodeCleanCstr(codec, m.port(b.port).nameBytes);
  const nobleName = decodeCleanCstr(codec, noble.nameBytes);
  const hero = m.heroPerson();

  const hsS16 = (v: number) => (v << 16) >> 16;
  const hsUmin = (a: number, bv: number) => ((a & 0xffff) > (bv & 0xffff) ? bv & 0xffff : a & 0xffff);

  const tabLabels = kind === 0
    ? c.menuItems(0x18).slice(0, 3).map((x: Uint8Array) => decodeCleanCstr(codec, x))
    : kind === 1
      ? c.menuItems(0x19).slice(0, 4).map((x: Uint8Array) => decodeCleanCstr(codec, x))
      : [kind === 3 ? "炮术" : "测量技术"];

  const initGreet = (() => {
    if (kind === 0) return noble.flags & NobleFlag.CONTRACTED ? capMsg(c, 0x1de, hero.familyNameBytes) : capMsg(c, 0x1dd);
    if (kind === 1) return capMsg(c, noble.flags & NobleFlag.CONTRACTED ? 0x1ee : 0x1ed, hero.familyNameBytes);
    return capMsg(c, kind === 3 ? 0x2e7 : 0x2ee);
  })();

  let activeTab = 0;
  let selDiscIdx = 0;
  let reportedGeo = false;
  let speechText = "";
  let notice = initGreet;

  for (;;) {
    const pendingStory = await new Promise<{ txt: string } | null>(resolve => {
      let settled = false;
      const finish = (story: { txt: string } | null) => {
        if (settled) return;
        settled = true;
        shell.h.close();
        resolve(story);
      };

      const shell = createWorkbenchShell(`${portName} · 住宅`, house.money, () => finish(null), getBuildingArtUrl(c, 7, b.p));

      const hasTreasureMap = () => {
        for (let i = 0; i < GameConst.INV_SLOTS; i++) {
          const v = m.inventory(i);
          if (v >= 0x50 && v <= 0x59) return true;
        }
        return false;
      };

      const getReportableDiscs = () => {
        const out: number[] = [];
        for (let i = 0; i < 100; i++) {
          const f = m.discovery(i).flags;
          if (!(f & DiscoveryFlag.FOUND) && (f & DiscoveryFlag.KNOWN) && !(f & 0x10)) out.push(i);
        }
        return out;
      };

      const render = () => preserveScroll(shell.h.body, () => {
        shell.moneyPill.textContent = fmtMoneyPill(house.money);
        shell.toastEl.textContent = notice;

        shell.toolbar.innerHTML = "";
        tabLabels.forEach((lbl: string, idx: number) => {
          const btn = document.createElement("button");
          btn.className = `uw2-tab-btn ${activeTab === idx ? "active" : ""}`;
          btn.textContent = lbl;
          btn.addEventListener("click", () => { activeTab = idx; speechText = ""; render(); });
          shell.toolbar.appendChild(btn);
        });

        shell.h.body.innerHTML = "";
        const split = document.createElement("div");
        split.className = "uw2-split";

        const left = document.createElement("div");
        left.className = "uw2-pane";
        const right = document.createElement("div");
        right.className = "uw2-pane";

        // 左栏：主人头像与基本信息（或发现物报告清单）
        const profile = document.createElement("div");
        profile.style.cssText = "display:flex;gap:14px;align-items:center;";
        const url = art?.portraitUrl?.(noble.portrait);
        if (url) {
          const img = document.createElement("img");
          img.className = "uw2-portrait-img";
          img.src = url;
          profile.appendChild(img);
        }
        const meta = document.createElement("div");
        meta.style.cssText = "display:flex;flex-direction:column;gap:4px;";
        meta.innerHTML =
          `<div class="uw2-detail-title">${nobleName}</div>` +
          (kind <= 1
            ? `<div class="uw2-detail-sub">${noble.flags & NobleFlag.CONTRACTED ? "已签约" : "未签约"}</div>`
            : `<div class="uw2-detail-sub">${kind === 3 ? "炮术指导" : "测量技术指导"}</div>`);
        profile.appendChild(meta);
        left.appendChild(profile);

        if (kind === 0 && activeTab === 1) {
          const discs = getReportableDiscs();
          const lt = document.createElement("div");
          lt.className = "uw2-pane-title";
          lt.textContent = `${tabLabels[1]} (${discs.length})`;
          left.appendChild(lt);

          const list = document.createElement("div");
          list.className = "uw2-list-col";
          if (!discs.length) {
            const emp = document.createElement("div");
            emp.className = "uw2-speech-box";
            emp.textContent = capMsg(c, 0x1e4);
            list.appendChild(emp);
          } else {
            if (selDiscIdx >= discs.length) selDiscIdx = 0;
            discs.forEach((n, idx) => {
              const d = m.discovery(n), v = d.importance;
              const kMul = hsS16(Math.imul(5 - (noble.flags & NobleFlag.REWARD_MASK), v === 100 ? 4 : 1));
              const pay = Math.imul(Math.imul(kMul, v), 50);
              const name = decodeCleanCstr(codec, ListSelect.colonyRec(c, n));
              const row = document.createElement("button");
              row.className = `uw2-row-card ${idx === selDiscIdx ? "selected" : ""}`;
              row.innerHTML = `<span class="uw2-item-name">${name}</span><span class="uw2-item-price">${pay.toLocaleString()} 金币</span>`;
              row.addEventListener("click", () => { selDiscIdx = idx; speechText = ""; render(); });
              list.appendChild(row);
            });
          }
          left.appendChild(list);
        } else if (kind === 1) {
          const kvBox = document.createElement("div");
          kvBox.style.cssText = "display:flex;flex-direction:column;gap:8px;margin-top:8px;";
          const wk = getWorkState(m);
          const unrep = wk.exploreUnrep;
          const total = wk.exploreTotal;
          kvBox.innerHTML =
            `<div class="uw2-kv-row"><span class="uw2-kv-label">地图制作技能</span><span class="uw2-kv-val">${hero.skills & SkillFlag.CARTOGRAPHY ? "已习得" : "未习得"}</span></div>` +
            `<div class="uw2-kv-row"><span class="uw2-kv-label">未报告探索格数</span><span class="uw2-kv-val">${unrep}</span></div>` +
            `<div class="uw2-kv-row"><span class="uw2-kv-label">累计探索格数</span><span class="uw2-kv-val">${total} / 3300</span></div>`;
          left.appendChild(kvBox);
        } else if (kind >= 2) {
          const isGun = kind === 3;
          const req = isGun ? [75, 65, 80] : [70, 80, 70];
          const idxs = isGun ? house.D.gunSkills : house.D.measureSkills;
          const learned = !!(hero.skills & (isGun ? SkillFlag.GUNNERY : SkillFlag.SURVEY));
          const kvBox = document.createElement("div");
          kvBox.style.cssText = "display:flex;flex-direction:column;gap:8px;margin-top:8px;";
          let html = `<div class="uw2-kv-row"><span class="uw2-kv-label">状态</span><span class="uw2-kv-val">${learned ? "已习得" : "未习得"}</span></div>`;
          for (let i = 0; i < 3; i++) {
            const sName = decodeCleanCstr(codec, house.stats[idxs[i]]);
            const cur = hero.getStats(idxs[i]);
            html += `<div class="uw2-kv-row"><span class="uw2-kv-label">${sName}</span><span class="uw2-kv-val" style="color:${cur >= req[i] ? "#247544" : "#b83d3d"};">${cur} / ${req[i]}</span></div>`;
          }
          html += `<div class="uw2-kv-row"><span class="uw2-kv-label">学费</span><span class="uw2-item-price">${house.fee().toLocaleString()} 金币</span></div>`;
          kvBox.innerHTML = html;
          left.appendChild(kvBox);
        }

        // 右栏：对应页签的操作面板
        const rt = document.createElement("div");
        rt.className = "uw2-pane-title";
        rt.textContent = tabLabels[activeTab];
        right.appendChild(rt);

        if (kind === 0) {
          if (activeTab === 0) {
            const box = document.createElement("div");
            box.className = "uw2-speech-box";
            box.textContent = speechText || (noble.flags & NobleFlag.CONTRACTED
              ? capMsg(c, 0x1de, hero.familyNameBytes)
              : `${capMsg(c, 0x1e0, hero.familyNameBytes)} ${capMsg(c, 0x1e1)}`);
            right.appendChild(box);
            if (!(noble.flags & NobleFlag.CONTRACTED)) {
              const btn = document.createElement("button");
              btn.className = "uw2-btn uw2-btn-primary";
              btn.style.cssText = "padding:9px 22px;align-self:flex-start;";
              btn.textContent = tabLabels[0];
              btn.addEventListener("click", () => {
                for (let i = 0; i < 20; i++) { const n = m.noble(i); if (n.kind === 0) n.flags &= ~NobleFlag.CONTRACTED; }
                noble.flags |= NobleFlag.CONTRACTED;
                speechText = capMsg(c, 0x1e3);
                notice = speechText;
                render();
              });
              right.appendChild(btn);
            }
          } else if (activeTab === 1) {
            const discs = getReportableDiscs();
            if (!(noble.flags & NobleFlag.CONTRACTED)) {
              const box = document.createElement("div");
              box.className = "uw2-speech-box";
              box.textContent = capMsg(c, 0x1dd);
              right.appendChild(box);
            } else if (!discs.length) {
              const box = document.createElement("div");
              box.className = "uw2-speech-box";
              box.textContent = speechText || capMsg(c, 0x1e4);
              right.appendChild(box);
            } else {
              const n = discs[selDiscIdx] ?? discs[0];
              const d = m.discovery(n), v = d.importance;
              const kMul = hsS16(Math.imul(5 - (noble.flags & NobleFlag.REWARD_MASK), v === 100 ? 4 : 1));
              const pay = Math.imul(Math.imul(kMul, v), 50);
              const name = decodeCleanCstr(codec, ListSelect.colonyRec(c, n));
              const box = document.createElement("div");
              box.className = "uw2-speech-box";
              box.textContent = speechText || capMsg(c, 0x1e5);
              right.appendChild(box);

              const btn = document.createElement("button");
              btn.className = "uw2-btn uw2-btn-primary";
              btn.style.cssText = "padding:9px 22px;align-self:flex-start;";
              btn.textContent = `${tabLabels[1]}「${name}」（+${pay.toLocaleString()} 金币）`;
              btn.addEventListener("click", () => {
                const nameBytes = ListSelect.colonyRec(c, n);
                speechText = capMsg(c, 0x1e6 + Math.trunc(v / 25), nameBytes, pay);
                notice = speechText;
                let nextCash = (house.money + pay) | 0;
                if (nextCash > GameConst.MAX_CASH) nextCash = GameConst.MAX_CASH;
                house.money = nextCash;
                const hd = m.heroInfo(), add = ((v === 100 ? 15 : 8) * v) & 0xffff;
                hd.adventureFame = (hd.adventureFame + hsUmin((GameConst.MAX_FAME - hd.adventureFame) & 0xffff, add)) & 0xffff;
                d.flags |= 0x10;
                b.p.panels();
                render();
              });
              right.appendChild(btn);
            }
          } else {
            const box = document.createElement("div");
            box.className = "uw2-speech-box";
            box.textContent = speechText || (noble.flags & NobleFlag.CONTRACTED ? capMsg(c, 0x1de, hero.familyNameBytes) : capMsg(c, 0x1dd));
            right.appendChild(box);
            if (noble.flags & NobleFlag.CONTRACTED) {
              const btn = document.createElement("button");
              btn.className = "uw2-btn uw2-btn-primary";
              btn.style.cssText = "padding:9px 22px;align-self:flex-start;";
              btn.textContent = tabLabels[2];
              btn.addEventListener("click", () => {
                const dir = c.menuItems(0x30);
                let d: any = null;
                for (let i = 0; i < 50; i++) { const dc = m.discovery(i); if (!(dc.flags & DiscoveryFlag.FOUND) && !(dc.flags & 0x40)) { d = dc; break; } }
                if (!d) { speechText = capMsg(c, 0x1eb); notice = speechText; render(); return; }
                let ew, lon, ns, lat;
                if ((sys.rng.random(0x50) & 0xff) > hero.getStats(7)) {
                  const di = sys.rng.random(0x48);
                  ew = di >= 0x24 ? 1 : 0;
                  lon = hsS16(Math.imul(Math.abs(hsS16(di - 0x24)), 5));
                  const r = sys.rng.random(0x1b);
                  ns = r >= 0x32 ? 2 : 3;
                  lat = hsS16(Math.imul(Math.abs(hsS16(r - 10)), 5));
                } else {
                  ew = 0;
                  let di = (hsS16(d.x) + 0x7bd) % 0x870;
                  if (di > 0x438) { ew = 1; di = 0x870 - di; }
                  lon = Math.trunc(Math.trunc(di / 6) / 5) * 5;
                  const v = hsS16(0x280 - d.y);
                  ns = v >= 0 ? 2 : 3;
                  lat = hsS16(Math.imul(Math.trunc(Math.trunc(hsS16(Math.abs(v) << 3) / 0x39) / 5), 5));
                }
                speechText = capMsg(c, 0x1ec, dir[ew], lon, dir[ns], lat);
                notice = speechText;
                render();
              });
              right.appendChild(btn);
            }
          }
        } else if (kind === 1) {
          if (activeTab === 0) {
            const box = document.createElement("div");
            box.className = "uw2-speech-box";
            box.textContent = speechText || (noble.flags & NobleFlag.CONTRACTED ? capMsg(c, 0x1ee, hero.familyNameBytes) : capMsg(c, 0x1ef));
            right.appendChild(box);
            if (!(noble.flags & NobleFlag.CONTRACTED)) {
              const btn = document.createElement("button");
              btn.className = "uw2-btn uw2-btn-primary";
              btn.style.cssText = "padding:9px 22px;align-self:flex-start;";
              btn.textContent = tabLabels[0];
              btn.addEventListener("click", () => {
                if (!(hero.skills & SkillFlag.CARTOGRAPHY)) { speechText = capMsg(c, 0x1f0); notice = speechText; render(); return; }
                for (let i = 0; i < 20; i++) { const n = m.noble(i); if (n.kind === 1) n.flags &= ~NobleFlag.CONTRACTED; }
                noble.flags |= NobleFlag.CONTRACTED;
                setExploreUnrep(m, 0);
                speechText = capMsg(c, 0x1f4);
                notice = speechText;
                render();
              });
              right.appendChild(btn);
            }
          } else if (activeTab === 1) {
            const names = c.menuItems(0x2b);
            const fee = house.fee();
            const kv = document.createElement("div");
            kv.style.cssText = "display:flex;flex-direction:column;gap:6px;";
            let html = "";
            for (let i = 0; i < 3; i++) {
              const cur = hero.getStats(house.D.mapSkills[i]);
              html += `<div class="uw2-kv-row"><span class="uw2-kv-label">${decodeCleanCstr(codec, names[i])}</span><span class="uw2-kv-val" style="color:${cur >= 75 ? "#247544" : "#b83d3d"};">${cur} / 75</span></div>`;
            }
            html += `<div class="uw2-kv-row"><span class="uw2-kv-label">学费</span><span class="uw2-item-price">${fee.toLocaleString()} 金币</span></div>`;
            kv.innerHTML = html;
            right.appendChild(kv);

            const box = document.createElement("div");
            box.className = "uw2-speech-box";
            box.textContent = speechText || capMsg(c, 0x1f5);
            right.appendChild(box);

            if (!(hero.skills & SkillFlag.CARTOGRAPHY)) {
              const btn = document.createElement("button");
              btn.className = "uw2-btn uw2-btn-primary";
              btn.style.cssText = "padding:9px 22px;align-self:flex-start;";
              btn.textContent = `${tabLabels[1]}（${fee.toLocaleString()} 金币）`;
              btn.addEventListener("click", () => {
                for (let i = 0; i < 3; i++) {
                  if (hero.getStats(house.D.mapSkills[i]) < 75) {
                    speechText = capMsg(c, 0x1f6, names[i]);
                    notice = speechText;
                    render();
                    return;
                  }
                }
                if (house.money < fee) { speechText = capMsg(c, 0x1f8); notice = speechText; render(); return; }
                house.money = (house.money - fee) | 0;
                hero.skills |= SkillFlag.CARTOGRAPHY;
                b.p.panels();
                speechText = capMsg(c, 0x1f7, fee);
                notice = speechText;
                render();
              });
              right.appendChild(btn);
            }
          } else if (activeTab === 2) {
            const unrep = getWorkState(m).exploreUnrep;
            const pay = Math.imul(Math.imul(hsS16(5 - (noble.flags & NobleFlag.REWARD_MASK)), unrep), 20);
            const box = document.createElement("div");
            box.className = "uw2-speech-box";
            box.textContent = speechText || (unrep ? capMsg(c, 0x1fc, pay) : capMsg(c, 0x1fa));
            right.appendChild(box);
            if ((noble.flags & NobleFlag.CONTRACTED) && !reportedGeo && unrep > 0) {
              const btn = document.createElement("button");
              btn.className = "uw2-btn uw2-btn-primary";
              btn.style.cssText = "padding:9px 22px;align-self:flex-start;";
              btn.textContent = `${tabLabels[2]}（+${pay.toLocaleString()} 金币）`;
              btn.addEventListener("click", () => {
                reportedGeo = true;
                const total = getWorkState(m).exploreTotal;
                const hd = m.heroInfo();
                hd.adventureFame = (hd.adventureFame + hsUmin((GameConst.MAX_FAME - hd.adventureFame) & 0xffff, Math.imul(5, unrep))) & 0xffff;
                const room = (GameConst.MAX_CASH - house.money) | 0;
                house.money = (house.money + (room > pay ? pay : room)) | 0;
                setExploreUnrep(m, 0);
                b.p.panels();
                if (total >= 3300) {
                  revealEntireWorldMap(m);
                  const txt = capMsg(c, 0x1fb);
                  speechText = capMsg(c, 0x1fc, pay);
                  notice = speechText;
                  finish({ txt });
                  return;
                }
                speechText = `${capMsg(c, 0x1fc, pay)} ${capMsg(c, 0x1fd)}`;
                notice = speechText;
                render();
              });
              right.appendChild(btn);
            }
          } else {
            const hasMap = hasTreasureMap();
            const box = document.createElement("div");
            box.className = "uw2-speech-box";
            box.textContent = speechText || (hasMap ? capMsg(c, 0x311) : capMsg(c, 0x1fa));
            right.appendChild(box);
            if (hasMap) {
              const btn = document.createElement("button");
              btn.className = "uw2-btn uw2-btn-primary";
              btn.style.cssText = "padding:9px 22px;align-self:flex-start;";
              btn.textContent = `${tabLabels[3]}（20,000 金币）`;
              btn.addEventListener("click", () => {
                if (house.money <= 20000) { speechText = capMsg(c, 0xef); notice = speechText; render(); return; }
                let idx = 0;
                for (; idx < GameConst.INV_SLOTS; idx++) { const v = m.inventory(idx); if (v >= 0x50 && v <= 0x59) break; }
                const d = m.discovery(m.item(m.inventory(idx)).power);
                let si = (hsS16(d.x) + 0x7bd) % 0x870, di = hsS16(0x280 - d.y), ew = 0x80;
                if (si > 0x438) { ew = 0x81; si = 0x870 - si; }
                const ns = di >= 0 ? 0x7e : 0x7f;
                di = Math.trunc(hsS16(Math.abs(di) << 3) / 0x39);
                si = hsS16(Math.imul(Math.trunc(Math.trunc(si / 6) / 5) + sys.rng.random(2), 5));
                di = hsS16(Math.imul(Math.trunc(di / 5) + sys.rng.random(2), 5));
                house.money = (house.money - 20000) | 0;
                speechText = toSimp(captureConsoleText(c, () => {
                  c.message(0x30f); c.message(ns, di); c.message(ew, si); c.message(0x310);
                }).trim());
                notice = speechText;
                render();
              });
              right.appendChild(btn);
            }
          }
        } else {
          // 种类 2 测量技术 / 种类 3 砲术
          const isGun = kind === 3;
          const M = isGun
            ? { ask: 0x2e7, done: 0x2e8, lack: 0x2e9, poor: 0x2eb, ok: 0x2ec, bye: 0x2ed, bit: SkillFlag.GUNNERY, req: [75, 65, 80], idx: house.D.gunSkills }
            : { ask: 0x2ee, done: 0x2ef, lack: 0x2f0, poor: 0x1f8, ok: 0x1f9, bye: 0x2f1, bit: SkillFlag.SURVEY, req: [70, 80, 70], idx: house.D.measureSkills };
          const learned = !!(hero.skills & M.bit);
          const fee = house.fee();

          const box = document.createElement("div");
          box.className = "uw2-speech-box";
          box.textContent = speechText || (learned ? capMsg(c, M.done) : capMsg(c, M.ask));
          right.appendChild(box);

          if (!learned) {
            const btn = document.createElement("button");
            btn.className = "uw2-btn uw2-btn-primary";
            btn.style.cssText = "padding:9px 22px;align-self:flex-start;";
            btn.textContent = `${tabLabels[0]}（${fee.toLocaleString()} 金币）`;
            btn.addEventListener("click", () => {
              for (let i = 0; i < 3; i++) {
                if (hero.getStats(M.idx[i]) < M.req[i]) {
                  speechText = capMsg(c, M.lack, house.stats[M.idx[i]], M.req[i]);
                  notice = speechText;
                  render();
                  return;
                }
              }
              if (house.money < fee) { speechText = capMsg(c, M.poor); notice = speechText; render(); return; }
              house.money = (house.money - fee) | 0;
              hero.skills |= M.bit;
              b.p.panels();
              speechText = capMsg(c, M.bye);
              notice = speechText;
              render();
            });
            right.appendChild(btn);
          }
        }

        split.append(left, right);
        shell.h.body.appendChild(split);
      });

      render();
    });

    if (pendingStory) {
      await runDomStoryCard(art, 0x3f, pendingStory.txt, "世界地图完成");
      continue;
    }
    b.after();
    break;
  }
}
