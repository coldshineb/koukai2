// ui/buildings/office.ts — 事务所一体化工作台
import { GameConst, TreatyFlag } from "../../model/flags.ts";
import { getCountryExtra, getWorkState, setWorkCurParam } from "../../model/world_helpers.ts";
import { captureConsoleText, decodeCleanCstr, toSimp } from "../text_util.ts";
import { getBuildingArtUrl, preserveScroll } from "../modals.ts";
import { UI_STR } from "../strings.ts";
import { capMsg, createWorkbenchShell, fmtMoneyPill, plS16 } from "./shared.ts";

/** 解析当前正在执行的国王委托提示（对应 office.js jobHint 原文，仅输出原版台词）。 */
function resolveJobHintText(office: any): string {
  const b = office.b, c = office.c, m = office.m, sys = c.sys;
  const wk = getWorkState(m);
  let dx = 1;
  if (wk.curKind === 0x0b) {
    const t = wk.targetItem;
    for (let i = 0; i < GameConst.INV_SLOTS; i++) {
      const v = m.inventory(i);
      if (((v - t) & 0xff) === 0xf6 || v === t) { dx = 0; break; }
    }
  }
  if (!dx || wk.curKind !== 0x0b) return capMsg(c, 0x253);
  if (wk.targetPort === 0xff) wk.targetPort = sys.rng.random(0x2a);
  const item = m.item(wk.targetItem).nameBytes;
  if ((wk.targetPort & 0xff) === b.port) {
    if (wk.targetPerson === 0xff) {
      const far = sys.rng.random(wk.randRange + 1) !== 0;
      for (;;) {
        wk.targetPerson = sys.rng.random(0x29) + 0x4f;
        const q = m.person(wk.targetPerson & 0xff).stayPort;
        if (q === 0xff) continue;
        if (far ? q >= 0x2a : q < 0x2a) break;
      }
    }
    const p = m.person(wk.targetPerson & 0xff);
    return `${capMsg(c, 0x254, item, p.givenNameBytes, p.familyNameBytes)}\n${capMsg(c, 0x255)}`;
  }
  const q = wk.targetPort & 0xff, port = m.port(q);
  const posMsg = toSimp(captureConsoleText(c, () => {
    c.message(0x258, port.nameBytes);
    b.latLong(port.x, port.y);
    c.message(0x259);
  }).trim());
  return `${capMsg(c, 0x256, item, port.nameBytes)}\n${posMsg}`;
}

// ============================================================================
// 3. 事务所一体化工作台 (Office — 补齐原先不可见的各国情报表)
// ============================================================================
export async function runDomOfficeWorkbench(office: any): Promise<void> {
  const b = office.b, c = office.c, m = office.m, g = m.globals, codec = c.codec;
  const portName = decodeCleanCstr(codec, m.port(b.port).nameBytes);
  const tabLabels = [...UI_STR.officeTabs];
  const nationNames = office.nations.slice(0, 6).map((raw: Uint8Array) => decodeCleanCstr(codec, raw).replace(/\s+/g, ""));
  const initGreet = capMsg(c, 0x55);

  const nationLines = (sel: number) => {
    const ce = getCountryExtra(m.country(sel));
    const rival = ce.rival;
    const rivalTxt = rival < 7
      ? capMsg(c, 0x58, office.nations[sel], office.nations[rival])
      : capMsg(c, 0x355, office.nations[sel]);
    const portTxt = capMsg(c, 0x59, office.portName(ce.keyPort));
    return { rivalTxt, portTxt };
  };

  let tab = 0; // 0: 工作介绍, 1: 各国情报
  let selNation = 0;
  let paidNation = -1;
  let notice = initGreet;

  for (;;) {
    let pickJobIdx = -1;
    let cachedHintText: string | null = null;

    await new Promise<void>(resolve => {
      let settled = false;

      const done = () => {
        if (settled) return;
        settled = true;
        shell.h.close();
        resolve();
      };

      const shell = createWorkbenchShell(`${portName} · 事务所`, b.money, done, getBuildingArtUrl(c, 6, b.p));

      const render = () => preserveScroll(shell.h.body, () => {
        shell.moneyPill.textContent = fmtMoneyPill(b.money);
        shell.toastEl.textContent = notice;

        shell.toolbar.innerHTML = "";
        tabLabels.forEach((lbl: string, idx: number) => {
          const btn = document.createElement("button");
          btn.className = `uw2-btn uw2-tab-btn ${tab === idx ? "active" : ""}`;
          btn.textContent = lbl;
          btn.addEventListener("click", () => {
            tab = idx;
            if (tab === 1) {
              if (paidNation === selNation) {
                const { rivalTxt, portTxt } = nationLines(selNation);
                notice = `${rivalTxt}\n${portTxt}`;
              } else {
                notice = capMsg(c, 0xa2);
              }
            } else {
              notice = initGreet;
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
          const lt = document.createElement("div");
          lt.className = "uw2-pane-title";
          lt.textContent = "委托列表";
          left.appendChild(lt);

          const rt = document.createElement("div");
          rt.className = "uw2-pane-title";
          rt.textContent = "委托状态";
          right.appendChild(rt);

          const wk = getWorkState(m);
          const locked = Boolean(g.commonChap || (wk.flags & 3) === 3);

          const list = document.createElement("div");
          list.className = "uw2-list-col";
          for (let i = 0; i < 3; i++) {
            const k = wk.kindAt(i) & 0xff;
            const btn = document.createElement("button");
            btn.className = "uw2-row-card";
            btn.disabled = locked;
            btn.textContent = decodeCleanCstr(codec, office.jobs[k]);
            btn.addEventListener("click", () => { pickJobIdx = i; done(); });
            list.appendChild(btn);
          }
          left.appendChild(list);

          const box = document.createElement("div");
          box.className = "uw2-action-box";

          const p = document.createElement("div");
          p.style.cssText = "font-size:14px;color:var(--uw2-ink);line-height:1.6;white-space:pre-line;";

          if (g.commonChap) {
            if (plS16(wk.curKind) < 6) {
              const tp = wk.targetPort & 0xff;
              p.textContent = tp === b.port ? capMsg(c, 0x3a3) : capMsg(c, 0x152, office.portName(tp));
            } else {
              cachedHintText ??= resolveJobHintText(office);
              p.textContent = cachedHintText;
            }
          } else if ((wk.flags & 3) === 3) {
            p.textContent = toSimp(captureConsoleText(c, () => {
              c.message(0x19a + (m.heroPerson().face & 0x0f));
              c.message(0x3a4);
            }).trim());
          } else {
            p.style.color = "var(--uw2-ink-muted)";
            p.textContent = "—";
          }
          box.appendChild(p);
          right.appendChild(box);
        } else {
          const lt = document.createElement("div");
          lt.className = "uw2-pane-title";
          lt.textContent = "国家列表";
          left.appendChild(lt);

          const list = document.createElement("div");
          list.className = "uw2-list-col";
          nationNames.forEach((nn: string, idx: number) => {
            const btn = document.createElement("button");
            btn.className = `uw2-row-card ${idx === selNation ? "selected" : ""}`;
            btn.textContent = nn;
            btn.addEventListener("click", () => {
              selNation = idx;
              if (paidNation === selNation) {
                const { rivalTxt, portTxt } = nationLines(selNation);
                notice = `${rivalTxt}\n${portTxt}`;
              } else {
                notice = capMsg(c, 0xa2);
              }
              render();
            });
            list.appendChild(btn);
          });
          left.appendChild(list);

          const rt = document.createElement("div");
          rt.className = "uw2-pane-title";
          rt.textContent = `${nationNames[selNation]} · ${tabLabels[1]}`;
          right.appendChild(rt);

          const box = document.createElement("div");
          box.className = "uw2-action-box";

          if (paidNation !== selNation) {
            const cCard = document.createElement("div");
            cCard.className = "uw2-action-box";
            cCard.style.cssText = "padding:12px;border-radius:8px;background:rgba(255,252,242,0.85);border:1px solid rgba(154,119,56,0.34);";
            const p = document.createElement("div");
            p.style.cssText = "font-size:14px;color:var(--uw2-ink);";
            p.textContent = capMsg(c, 0x56);

            const actRow = document.createElement("div");
            actRow.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";

            const noBtn = document.createElement("button");
            noBtn.type = "button";
            noBtn.className = "uw2-btn";
            noBtn.textContent = "否";
            noBtn.addEventListener("click", () => {
              notice = capMsg(c, 0x57);
              render();
            });

            const yesBtn = document.createElement("button");
            yesBtn.type = "button";
            yesBtn.className = "uw2-btn uw2-btn-primary";
            yesBtn.textContent = "是";
            yesBtn.addEventListener("click", () => {
              if (b.money < 100) { notice = capMsg(c, 0xa3); render(); return; }
              b.money = (b.money - 100) | 0;
              b.p.panels();
              paidNation = selNation;
              const { rivalTxt, portTxt } = nationLines(selNation);
              notice = `${rivalTxt}\n${portTxt}`;
              render();
            });

            actRow.append(noBtn, yesBtn);
            cCard.append(p, actRow);
            box.appendChild(cCard);
          } else {
            const country = m.country(selNation);
            const hd = m.heroInfo();
            const standing = hd.getCountryStanding(selNation);
            const contrib = 100 - standing;
            const { rivalTxt, portTxt } = nationLines(selNation);

            const top = document.createElement("div");
            top.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;";
            top.innerHTML =
              `<div>国力收益：<strong>${country.power}</strong></div>` +
              `<div>贡献度：<strong style="color:${standing < 100 ? "#b83d3d" : "#247544"};">${standing < 100 ? "-" : ""}${Math.abs(plS16(contrib))}</strong></div>` +
              `<div style="grid-column:1/-1;color:var(--uw2-ink-muted);">${rivalTxt} ${portTxt}</div>`;
            box.appendChild(top);

            const relList = document.createElement("div");
            relList.className = "uw2-list-col";
            for (let i = 0; i < 6; i++) {
              if (i === selNation) continue;
              const rel = country.getRelations(i);
              const diff = plS16(0x1e - rel);
              const treaty = country.getTreaties(i);
              const tags: string[] = [];
              if (treaty & TreatyFlag.ALLY) tags.push("同盟");
              if (treaty & TreatyFlag.BLOCKADE) tags.push("封锁");
              const row = document.createElement("div");
              row.className = "uw2-slot-card";
              row.innerHTML =
                `<span style="font-weight:700;min-width:90px;">${nationNames[i]}</span>` +
                `<span style="font-size:13px;color:${rel < 0x1e ? "#b83d3d" : "#247544"};">友好度 ${rel < 0x1e ? "-" : ""}${Math.abs(diff)}</span>` +
                `<span style="font-size:12px;color:#7c5216;font-weight:700;">${tags.join(" · ") || "—"}</span>`;
              relList.appendChild(row);
            }
            box.appendChild(relList);
          }
          right.appendChild(box);
        }

        split.append(left, right);
        shell.h.body.appendChild(split);
      });

      render();
    });

    if (pickJobIdx >= 0) {
      const wk = getWorkState(m);
      const k = wk.kindAt(pickJobIdx) & 0xff;
      g.commonSec = (k + 1) & 0xff;
      setWorkCurParam(m, wk.paramAt(pickJobIdx));
      if (await office.event(6)) g.commonChap = getWorkState(m).curKind & 0xff;
      g.commonSec = 0;
      b.after();
      continue;
    }
    break;
  }
}
