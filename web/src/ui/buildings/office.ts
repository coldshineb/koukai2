// ui/buildings/office.ts — 事务所一体化工作台
import { TreatyFlag } from "../../model/flags.ts";
import { getCountryExtra, getWorkState, setWorkCurParam } from "../../model/world_helpers.ts";
import { captureConsoleText, decodeCleanCstr, toSimp } from "../text_util.ts";
import { getBuildingArtUrl, preserveScroll } from "../modals.ts";
import { UI_STR } from "../strings.ts";
import { capMsg, createWorkbenchShell, fmtMoneyPill, plS16 } from "./shared.ts";
// ============================================================================
// 3. 事务所一体化工作台 (Office — 补齐原先不可见的各国情报表)
// ============================================================================
export async function runDomOfficeWorkbench(office: any): Promise<void> {
  const b = office.b, c = office.c, m = office.m, g = m.globals, codec = c.codec;
  const portName = decodeCleanCstr(codec, m.port(b.port).nameBytes);
  const tabLabels = [...UI_STR.officeTabs];
  const nationNames = office.nations.slice(0, 6).map((raw: Uint8Array) => decodeCleanCstr(codec, raw).replace(/\s+/g, ""));
  const initGreet = capMsg(c, 0x55);

  let tab = 0; // 0: 工作介绍, 1: 各国情报
  let selNation = 0;
  let paidNation = -1;
  let notice = initGreet;

  for (;;) {
    let pickJobIdx = -1;
    let askJobHint = false;

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
          btn.addEventListener("click", () => { tab = idx; render(); });
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

          const box = document.createElement("div");
          box.className = "uw2-action-box";

          const wk = getWorkState(m);
          if (g.commonChap) {
            const p = document.createElement("div");
            p.style.cssText = "font-size:14px;color:var(--uw2-ink);line-height:1.6;";
            if (plS16(wk.curKind) < 6) {
              const tp = wk.targetPort & 0xff;
              p.textContent = tp === b.port ? capMsg(c, 0x3a3) : capMsg(c, 0x152, office.portName(tp));
            } else {
              p.textContent = "当前已有正在执行的委托。";
              const hintBtn = document.createElement("button");
              hintBtn.className = "uw2-btn uw2-btn-primary";
              hintBtn.style.alignSelf = "flex-start";
              hintBtn.textContent = "询问委托线索";
              hintBtn.addEventListener("click", () => { askJobHint = true; done(); });
              box.append(p, hintBtn);
            }
            if (!box.contains(p)) box.appendChild(p);
            const empty = document.createElement("div");
            empty.className = "uw2-empty";
            empty.textContent = "请先完成当前委托";
            left.appendChild(empty);
          } else if ((wk.flags & 3) === 3) {
            const msg = toSimp(captureConsoleText(c, () => {
              c.message(0x19a + (m.heroPerson().face & 0x0f));
              c.message(0x3a4);
            }).trim());
            const p = document.createElement("div");
            p.style.cssText = "font-size:14px;color:var(--uw2-ink);";
            p.textContent = msg;
            box.appendChild(p);
          } else {
            const list = document.createElement("div");
            list.className = "uw2-list-col";
            for (let i = 0; i < 3; i++) {
              const k = wk.kindAt(i) & 0xff;
              const btn = document.createElement("button");
              btn.className = "uw2-row-card";
              btn.textContent = decodeCleanCstr(codec, office.jobs[k]);
              btn.addEventListener("click", () => { pickJobIdx = i; done(); });
              list.appendChild(btn);
            }
            left.appendChild(list);
            const tip = document.createElement("div");
            tip.style.cssText = "font-size:14px;color:var(--uw2-ink-muted);";
            tip.textContent = initGreet;
            box.appendChild(tip);
          }
          right.appendChild(box);
        } else {
          const lt = document.createElement("div");
          lt.className = "uw2-pane-title";
          lt.textContent = "选择国家（100 金币）";
          left.appendChild(lt);

          const list = document.createElement("div");
          list.className = "uw2-list-col";
          nationNames.forEach((nn: string, idx: number) => {
            const btn = document.createElement("button");
            btn.className = `uw2-row-card ${idx === selNation ? "selected" : ""}`;
            btn.textContent = nn;
            btn.addEventListener("click", () => { selNation = idx; render(); });
            list.appendChild(btn);
          });
          left.appendChild(list);

          const rt = document.createElement("div");
          rt.className = "uw2-pane-title";
          rt.textContent = `${nationNames[selNation]} · 国家情报`;
          right.appendChild(rt);

          const box = document.createElement("div");
          box.className = "uw2-action-box";

          if (paidNation !== selNation) {
            const p = document.createElement("div");
            p.style.cssText = "font-size:14px;color:var(--uw2-ink);";
            p.textContent = capMsg(c, 0x56);
            const payBtn = document.createElement("button");
            payBtn.className = "uw2-btn uw2-btn-primary";
            payBtn.style.alignSelf = "flex-start";
            payBtn.textContent = "支付 100 金币查看情报";
            payBtn.addEventListener("click", () => {
              if (b.money < 100) { notice = capMsg(c, 0xa3); render(); return; }
              b.money = (b.money - 100) | 0;
              b.p.panels();
              paidNation = selNation;
              render();
            });
            box.append(p, payBtn);
          } else {
            const country = m.country(selNation);
            const ce = getCountryExtra(country);
            const hd = m.heroInfo();
            const standing = hd.getCountryStanding(selNation);
            const contrib = 100 - standing;
            const rival = ce.rival;
            const keyPortId = ce.keyPort;
            const keyPort = decodeCleanCstr(codec, office.portName(keyPortId));
            const rivalTxt = rival < 7
              ? capMsg(c, 0x58, office.nations[selNation], office.nations[rival])
              : capMsg(c, 0x355, office.nations[selNation]);
            const portTxt = capMsg(c, 0x59, office.portName(keyPortId));

            const top = document.createElement("div");
            top.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;";
            top.innerHTML =
              `<div>国力收益：<strong>${country.power}</strong></div>` +
              `<div>贡献度：<strong style="color:${standing < 100 ? "#b83d3d" : "#247544"};">${standing < 100 ? "-" : ""}${Math.abs(plS16(contrib))}</strong></div>` +
              `<div style="grid-column:1/-1;color:var(--uw2-ink-muted);">${rivalTxt} ${portTxt}（${keyPort}）</div>`;
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
                `<span style="font-size:12px;color:#7c5216;font-weight:700;">${tags.join(" · ") || "普通"}</span>`;
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

    if (askJobHint) {
      await office.jobHint();
      b.after();
      continue;
    }
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
