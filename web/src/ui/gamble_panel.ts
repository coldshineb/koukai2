// ui/gamble_panel.ts — 现代羊皮纸酒馆赌博工作台（二十一点 + 扑克骰子，含赌场插图与 NPC/主角头像，100% 沿用原版洗牌/判定/赔率）
import { createDomModal, getComposedPortraitSrc, getGraphArtUrl, getPersonPortraitSrc, hasDom, mountBuildingBanner } from "./modals.ts";

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const DICE_FACE = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
const HAND_NAMES = ["无牌型", "一对", "两对", "三条", "顺子", "葫芦", "四条", "五条"];

function cardHtml(c: number, hidden = false): string {
  if (hidden) return `<div class="uw2-card-tile back">★</div>`;
  const suit = Math.trunc(c / 13) & 3;
  const rank = c % 13;
  const red = suit === 1 || suit === 2;
  return `<div class="uw2-card-tile ${red ? "red" : ""}"><span>${SUITS[suit]}</span><strong>${RANKS[rank]}</strong></div>`;
}

export async function runDomGamble(gamble: any): Promise<void> {
  if (!hasDom()) return;
  let activeTab = 0; // 0 = 二十一点, 1 = 扑克骰子

  // 二十一点状态
  let bjDeck: number[] = [];
  let bjPlayer: number[] = [];
  let bjDealer: number[] = [];
  let bjPhase: "bet" | "play" | "done" = "bet";
  let bjBet = Math.min(100, gamble.maxBet());
  let bjMsg = "请下注后开始发牌。";

  // 扑克骰子状态
  let dcPhase: "bet" | "roll" | "done" = "bet";
  let dcBet = Math.min(100, gamble.maxBet());
  let dcRerolls = 2;
  let dcPlayer = [1, 2, 3, 4, 5];
  let dcHold = [false, false, false, false, false];
  let dcOpp1 = [1, 1, 1, 1, 1];
  let dcOpp2 = [1, 1, 1, 1, 1];
  let dcMsg = "请下注后掷骰。";

  const handSum = (cards: number[]) => {
    const vals = cards.map(c => Math.min((c % 13) + 1, 10));
    let s = 0, ace = 0;
    for (const v of vals) { if (v === 1) ace = 1; s += v; }
    return ace && s <= 11 ? s + 10 : s;
  };

  const evalDiceRank = (d: number[]) => {
    const cnt = new Array(7).fill(0);
    for (const v of d) cnt[v]++;
    const counts = cnt.filter(x => x > 0).sort((a, b) => b - a);
    const sorted = [...d].sort((a, b) => a - b);
    const isStraight = sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
    if (counts[0] === 5) return 7;
    if (counts[0] === 4) return 6;
    if (counts[0] === 3 && counts[1] === 2) return 5;
    if (isStraight) return 4;
    if (counts[0] === 3) return 3;
    if (counts[0] === 2 && counts[1] === 2) return 2;
    if (counts[0] === 2) return 1;
    return 0;
  };

  const rollFive = () => Array.from({ length: 5 }, () => gamble.rng.random(6) + 1);

  const art = gamble.c?.art;
  const heroRec = gamble.st.bytes(gamble.b.hero, 0x32);
  let heroPortraitUrl: string | null = null;
  let dealerPortraitUrl: string | null = null;
  let opp1PortraitUrl: string | null = null;
  let opp2PortraitUrl: string | null = null;

  const genRandomFace = () => ({
    type: gamble.rng.random(7),
    parts: (gamble.rng.random(0x3fff) | 0xc000) & 0xffff,
  });
  const dealerFace = genRandomFace();
  const opp1Face = genRandomFace();
  const opp2Face = genRandomFace();

  return new Promise(resolve => {
    const h = createDomModal({
      title: "酒馆 · 赌博",
      size: "wide",
      cancelable: true,
      closeLabel: "关闭",
      onCancel: () => resolve(),
    });

    const cashPill = document.createElement("span");
    cashPill.className = "uw2-pill";
    h.headerRight.prepend(cashPill);

    const toolbar = mountBuildingBanner(h.modal, h.body, getGraphArtUrl(gamble.c, 0x1b));

    const footer = document.createElement("div");
    footer.className = "uw2-modal-footer";
    const toastEl = document.createElement("span");
    toastEl.style.cssText = "font-size:13px;font-weight:600;color:#247544;";
    footer.appendChild(toastEl);
    h.modal.appendChild(footer);

    void Promise.all([
      getPersonPortraitSrc(art, heroRec).then(u => { heroPortraitUrl = u; }),
      getComposedPortraitSrc(art, dealerFace.type, dealerFace.parts).then(u => { dealerPortraitUrl = u; }),
      getComposedPortraitSrc(art, opp1Face.type, opp1Face.parts).then(u => { opp1PortraitUrl = u; }),
      getComposedPortraitSrc(art, opp2Face.type, opp2Face.parts).then(u => { opp2PortraitUrl = u; }),
    ]).then(() => render());

    const render = () => {
      cashPill.textContent = `金块 ${gamble.bars}  ·  金币 ${gamble.gold}`;
      toastEl.textContent = activeTab === 0 ? bjMsg : dcMsg;
      toolbar.innerHTML = "";
      ["二十一点", "扑克骰子"].forEach((lb, i) => {
        const b = document.createElement("button");
        b.className = `uw2-tab-btn ${i === activeTab ? "active" : ""}`;
        b.textContent = lb;
        b.addEventListener("click", () => {
          activeTab = i;
          bjPhase = "bet";
          dcPhase = "bet";
          render();
        });
        toolbar.appendChild(b);
      });

      h.body.innerHTML = "";
      const maxBet = gamble.maxBet();

      if (activeTab === 0) {
        if (bjPhase === "bet") {
          bjBet = Math.max(10, Math.min(maxBet, bjBet));
          const box = document.createElement("div");
          box.className = "uw2-action-box";
          if (maxBet < 10) {
            box.innerHTML = `<div class="uw2-speech-box" style="color:var(--uw2-danger);">金币不足 10，无法继续下注。</div>`;
          } else {
            const label = document.createElement("div");
            label.className = "uw2-kv-row";
            label.innerHTML = `<span class="uw2-kv-label">下注金额</span><span class="uw2-item-price">${bjBet.toLocaleString()} 金币（上限 ${maxBet.toLocaleString()}）</span>`;
            const slider = document.createElement("input");
            slider.type = "range";
            slider.className = "uw2-slider";
            slider.style.width = "100%";
            slider.min = "10";
            slider.max = String(maxBet);
            slider.step = "10";
            slider.value = String(bjBet);
            const syncBet = (v: number) => {
              bjBet = Math.max(10, Math.min(maxBet, Math.round(v / 10) * 10));
              slider.value = String(bjBet);
              label.innerHTML = `<span class="uw2-kv-label">下注金额</span><span class="uw2-item-price">${bjBet.toLocaleString()} 金币（上限 ${maxBet.toLocaleString()}）</span>`;
            };
            slider.addEventListener("input", () => syncBet(Number(slider.value)));
            const stepRow = document.createElement("div");
            stepRow.className = "uw2-step-row";
            for (const [lb, fn] of [
              ["-100", () => syncBet(bjBet - 100)],
              ["-10", () => syncBet(bjBet - 10)],
              ["+10", () => syncBet(bjBet + 10)],
              ["+100", () => syncBet(bjBet + 100)],
              ["MAX", () => syncBet(maxBet)],
            ] as const) {
              const qb = document.createElement("button");
              qb.className = "uw2-step-btn";
              qb.textContent = lb;
              qb.addEventListener("click", fn);
              stepRow.appendChild(qb);
            }
            const startBtn = document.createElement("button");
            startBtn.className = "uw2-btn uw2-btn-primary";
            startBtn.style.alignSelf = "flex-start";
            startBtn.style.padding = "8px 28px";
            startBtn.textContent = "发牌";
            startBtn.addEventListener("click", () => {
              gamble.money -= bjBet;
              bjDeck = gamble.shuffle();
              bjPlayer = [bjDeck[0], bjDeck[2]];
              bjDealer = [bjDeck[1], bjDeck[3]];
              bjPhase = "play";
              bjMsg = `当前点数：${handSum(bjPlayer)}`;
              if (handSum(bjPlayer) === 21) finishBj();
              else render();
            });
            box.append(label, slider, stepRow, startBtn);
          }
          h.body.appendChild(box);
        } else {
          const split = document.createElement("div");
          split.className = "uw2-split";
          const dealerArea = document.createElement("div");
          dealerArea.className = "uw2-pane";
          const dShow = bjPhase === "done";
          dealerArea.innerHTML =
            `<div class="uw2-gamble-actor">` +
              (dealerPortraitUrl ? `<img class="uw2-gamble-portrait" src="${dealerPortraitUrl}">` : "") +
              `<div class="uw2-pane-title" style="margin:0;">庄家 ${dShow ? `（${handSum(bjDealer)} 点）` : ""}</div>` +
            `</div>` +
            `<div class="uw2-action-box"><div class="uw2-card-row">${bjDealer.map((c, idx) => cardHtml(c, !dShow && idx === 0)).join("")}</div></div>`;

          const playerArea = document.createElement("div");
          playerArea.className = "uw2-pane";
          playerArea.innerHTML =
            `<div class="uw2-gamble-actor">` +
              (heroPortraitUrl ? `<img class="uw2-gamble-portrait" src="${heroPortraitUrl}">` : "") +
              `<div class="uw2-pane-title" style="margin:0;">我方（${handSum(bjPlayer)} 点 · 赌注 ${bjBet}）</div>` +
            `</div>` +
            `<div class="uw2-action-box"><div class="uw2-card-row">${bjPlayer.map(c => cardHtml(c, false)).join("")}</div></div>`;

          split.append(dealerArea, playerArea);

          const actions = document.createElement("div");
          actions.className = "uw2-dialog-actions";
          if (bjPhase === "play") {
            const hitBtn = document.createElement("button");
            hitBtn.className = "uw2-btn uw2-btn-primary";
            hitBtn.style.padding = "8px 22px";
            hitBtn.textContent = "要牌";
            hitBtn.addEventListener("click", () => {
              const nextIdx = bjPlayer.length + bjDealer.length;
              bjPlayer.push(bjDeck[nextIdx]);
              const pt = handSum(bjPlayer);
              if (pt >= 21 || bjPlayer.length >= 6) finishBj();
              else { bjMsg = `当前点数：${pt}`; render(); }
            });
            const standBtn = document.createElement("button");
            standBtn.className = "uw2-step-btn";
            standBtn.style.padding = "8px 22px";
            standBtn.textContent = "停牌";
            standBtn.addEventListener("click", () => finishBj());
            actions.append(standBtn, hitBtn);
          } else {
            const againBtn = document.createElement("button");
            againBtn.className = "uw2-btn uw2-btn-primary";
            againBtn.style.padding = "8px 24px";
            againBtn.textContent = "再来一局";
            againBtn.addEventListener("click", () => { bjPhase = "bet"; bjMsg = "请下注后开始发牌。"; render(); });
            actions.appendChild(againBtn);
          }
          h.body.append(split, actions);
        }
      } else {
        if (dcPhase === "bet") {
          dcBet = Math.max(10, Math.min(maxBet, dcBet));
          const box = document.createElement("div");
          box.className = "uw2-action-box";
          if (maxBet < 10) {
            box.innerHTML = `<div class="uw2-speech-box" style="color:var(--uw2-danger);">金币不足 10，无法继续下注。</div>`;
          } else {
            const label = document.createElement("div");
            label.className = "uw2-kv-row";
            label.innerHTML = `<span class="uw2-kv-label">下注金额</span><span class="uw2-item-price">${dcBet.toLocaleString()} 金币（上限 ${maxBet.toLocaleString()}）</span>`;
            const slider = document.createElement("input");
            slider.type = "range";
            slider.className = "uw2-slider";
            slider.style.width = "100%";
            slider.min = "10";
            slider.max = String(maxBet);
            slider.step = "10";
            slider.value = String(dcBet);
            const syncBet = (v: number) => {
              dcBet = Math.max(10, Math.min(maxBet, Math.round(v / 10) * 10));
              slider.value = String(dcBet);
              label.innerHTML = `<span class="uw2-kv-label">下注金额</span><span class="uw2-item-price">${dcBet.toLocaleString()} 金币（上限 ${maxBet.toLocaleString()}）</span>`;
            };
            slider.addEventListener("input", () => syncBet(Number(slider.value)));
            const stepRow = document.createElement("div");
            stepRow.className = "uw2-step-row";
            for (const [lb, fn] of [
              ["-100", () => syncBet(dcBet - 100)],
              ["-10", () => syncBet(dcBet - 10)],
              ["+10", () => syncBet(dcBet + 10)],
              ["+100", () => syncBet(dcBet + 100)],
              ["MAX", () => syncBet(maxBet)],
            ] as const) {
              const qb = document.createElement("button");
              qb.className = "uw2-step-btn";
              qb.textContent = lb;
              qb.addEventListener("click", fn);
              stepRow.appendChild(qb);
            }
            const startBtn = document.createElement("button");
            startBtn.className = "uw2-btn uw2-btn-primary";
            startBtn.style.alignSelf = "flex-start";
            startBtn.style.padding = "8px 28px";
            startBtn.textContent = "掷骰";
            startBtn.addEventListener("click", () => {
              gamble.money -= dcBet;
              dcPlayer = rollFive();
              dcOpp1 = rollFive();
              dcOpp2 = rollFive();
              dcHold = [false, false, false, false, false];
              dcRerolls = 2;
              dcPhase = "roll";
              dcMsg = "点击骰子可保留，再点重掷或直接开牌。";
              render();
            });
            box.append(label, slider, stepRow, startBtn);
          }
          h.body.appendChild(box);
        } else {
          const playerBox = document.createElement("div");
          playerBox.className = "uw2-action-box";
          const pRank = evalDiceRank(dcPlayer);
          const pActor = document.createElement("div");
          pActor.className = "uw2-gamble-actor";
          pActor.innerHTML =
            (heroPortraitUrl ? `<img class="uw2-gamble-portrait" src="${heroPortraitUrl}">` : "") +
            `<div class="uw2-pane-title" style="margin:0;">我方 · ${HAND_NAMES[pRank]}（赌注 ${dcBet} · 剩余重掷 ${dcRerolls} 次）</div>`;
          const dRow = document.createElement("div");
          dRow.className = "uw2-card-row";
          dcPlayer.forEach((v, idx) => {
            const btn = document.createElement("button");
            btn.className = `uw2-die-tile ${dcHold[idx] ? "held" : ""}`;
            btn.disabled = dcPhase !== "roll";
            btn.innerHTML = `<span class="uw2-die-face">${DICE_FACE[v]}</span><small>${dcHold[idx] ? "保留" : "重掷"}</small>`;
            btn.addEventListener("click", () => { dcHold[idx] = !dcHold[idx]; render(); });
            dRow.appendChild(btn);
          });
          playerBox.append(pActor, dRow);
          h.body.appendChild(playerBox);

          if (dcPhase === "done") {
            const oppBox = document.createElement("div");
            oppBox.className = "uw2-action-box";
            oppBox.innerHTML =
              `<div class="uw2-kv-row"><span style="display:flex;align-items:center;gap:10px;">${opp1PortraitUrl ? `<img class="uw2-gamble-portrait" style="width:40px;height:50px;" src="${opp1PortraitUrl}">` : ""}<span class="uw2-kv-label">对手 A：${dcOpp1.map(v => DICE_FACE[v]).join(" ")}</span></span><span class="uw2-kv-val">${HAND_NAMES[evalDiceRank(dcOpp1)]}</span></div>` +
              `<div class="uw2-kv-row"><span style="display:flex;align-items:center;gap:10px;">${opp2PortraitUrl ? `<img class="uw2-gamble-portrait" style="width:40px;height:50px;" src="${opp2PortraitUrl}">` : ""}<span class="uw2-kv-label">对手 B：${dcOpp2.map(v => DICE_FACE[v]).join(" ")}</span></span><span class="uw2-kv-val">${HAND_NAMES[evalDiceRank(dcOpp2)]}</span></div>`;
            h.body.appendChild(oppBox);
          }

          const actions = document.createElement("div");
          actions.className = "uw2-dialog-actions";
          if (dcPhase === "roll") {
            const rerollBtn = document.createElement("button");
            rerollBtn.className = "uw2-step-btn";
            rerollBtn.style.padding = "8px 20px";
            rerollBtn.disabled = dcRerolls <= 0;
            rerollBtn.textContent = "重掷未保留";
            rerollBtn.addEventListener("click", () => {
              if (dcRerolls <= 0) return;
              for (let i = 0; i < 5; i++) if (!dcHold[i]) dcPlayer[i] = gamble.rng.random(6) + 1;
              dcRerolls--;
              if (dcRerolls <= 0) finishDice();
              else render();
            });
            const showBtn = document.createElement("button");
            showBtn.className = "uw2-btn uw2-btn-primary";
            showBtn.style.padding = "8px 24px";
            showBtn.textContent = "开牌";
            showBtn.addEventListener("click", () => finishDice());
            actions.append(rerollBtn, showBtn);
          } else {
            const againBtn = document.createElement("button");
            againBtn.className = "uw2-btn uw2-btn-primary";
            againBtn.style.padding = "8px 24px";
            againBtn.textContent = "再来一局";
            againBtn.addEventListener("click", () => { dcPhase = "bet"; dcMsg = "请下注后掷骰。"; render(); });
            actions.appendChild(againBtn);
          }
          h.body.appendChild(actions);
        }
      }
    };

    const finishBj = () => {
      const pt = handSum(bjPlayer);
      if (pt <= 21) {
        let idx = bjPlayer.length + bjDealer.length;
        while (handSum(bjDealer) < 17 && bjDealer.length < 6 && idx < bjDeck.length) {
          bjDealer.push(bjDeck[idx++]);
        }
      }
      const dt = handSum(bjDealer);
      bjPhase = "done";
      if (pt > 21) {
        bjMsg = `爆牌（${pt} 点），输掉 ${bjBet} 金币。`;
      } else if (dt > 21 || pt > dt) {
        const winAmt = pt === 21 && bjPlayer.length === 2 ? Math.trunc(bjBet * 5 / 2) : bjBet * 2;
        gamble.money += winAmt;
        bjMsg = `获胜！赢得 ${winAmt - bjBet} 金币。`;
      } else if (pt === dt) {
        gamble.money += bjBet;
        bjMsg = `平局，退回赌注 ${bjBet} 金币。`;
      } else {
        bjMsg = `庄家胜（${dt} 点），输掉 ${bjBet} 金币。`;
      }
      gamble.b.p.panels();
      render();
    };

    const finishDice = () => {
      const pR = evalDiceRank(dcPlayer), o1R = evalDiceRank(dcOpp1), o2R = evalDiceRank(dcOpp2);
      const bestOpp = Math.max(o1R, o2R);
      dcPhase = "done";
      if (pR > bestOpp) {
        gamble.money += dcBet * 3;
        dcMsg = `大获全胜！赢得 ${dcBet * 2} 金币。`;
      } else if (pR === bestOpp) {
        const share = o1R === o2R ? dcBet : Math.trunc((dcBet * 3) / 2);
        gamble.money += share;
        dcMsg = `平分彩池，获得 ${share} 金币。`;
      } else {
        dcMsg = `落败，输掉 ${dcBet} 金币。`;
      }
      gamble.b.p.panels();
      render();
    };

    render();
  });
}
