// modern/dom_gamble.ts — 現代羊皮紙酒館賭博工作台（二十一點 + 撲克骰子，100% 沿用原版洗牌/判定/賠率）
import { createDomModal, hasDom } from "./dom_ui.ts";

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

  // 二十一點狀態
  let bjDeck: number[] = [];
  let bjPlayer: number[] = [];
  let bjDealer: number[] = [];
  let bjPhase: "bet" | "play" | "done" = "bet";
  let bjBet = Math.min(100, gamble.maxBet());
  let bjMsg = "请下注后开始发牌。";

  // 撲克骰子狀態
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

  return new Promise(resolve => {
    const h = createDomModal({
      title: "酒馆赌博",
      size: "md",
      cancelable: true,
      closeLabel: "离开",
      onCancel: () => resolve(),
    });

    const cashBadge = document.createElement("span");
    cashBadge.className = "uw2-badge";
    h.headerRight.prepend(cashBadge);

    const toolbar = document.createElement("div");
    toolbar.className = "uw2-modal-toolbar";
    h.modal.insertBefore(toolbar, h.body);

    const render = () => {
      cashBadge.textContent = `金块 ${gamble.bars} · 金币 ${gamble.gold}`;
      toolbar.innerHTML = "";
      ["二十一点", "扑克骰子"].forEach((lb, i) => {
        const b = document.createElement("button");
        b.className = `uw2-btn uw2-tab-btn ${i === activeTab ? "active" : ""}`;
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
          box.innerHTML = `<div style="font-weight:700;color:var(--uw2-ink);">${bjMsg}</div>`;
          if (maxBet < 10) {
            box.innerHTML += `<div style="color:var(--uw2-danger);">金币不足 10，无法继续下注。</div>`;
          } else {
            const label = document.createElement("div");
            label.style.cssText = "display:flex;justify-content:space-between;font-weight:700;";
            label.innerHTML = `<span>下注金额</span><span>${bjBet} 金币（上限 ${maxBet}）</span>`;
            const slider = document.createElement("input");
            slider.type = "range";
            slider.className = "uw2-slider";
            slider.style.width = "100%";
            slider.min = "10";
            slider.max = String(maxBet);
            slider.step = "10";
            slider.value = String(bjBet);
            slider.addEventListener("input", () => {
              bjBet = Number(slider.value);
              label.innerHTML = `<span>下注金额</span><span>${bjBet} 金币（上限 ${maxBet}）</span>`;
            });
            const startBtn = document.createElement("button");
            startBtn.className = "uw2-btn uw2-btn-primary";
            startBtn.style.alignSelf = "flex-end";
            startBtn.style.padding = "8px 24px";
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
            box.append(label, slider, startBtn);
          }
          h.body.appendChild(box);
        } else {
          const dealerArea = document.createElement("div");
          dealerArea.className = "uw2-action-box";
          const dShow = bjPhase === "done";
          dealerArea.innerHTML =
            `<div class="uw2-pane-title">庄家 ${dShow ? `（${handSum(bjDealer)} 点）` : ""}</div>` +
            `<div class="uw2-card-row">${bjDealer.map((c, idx) => cardHtml(c, !dShow && idx === 0)).join("")}</div>`;

          const playerArea = document.createElement("div");
          playerArea.className = "uw2-action-box";
          playerArea.innerHTML =
            `<div class="uw2-pane-title">我方（${handSum(bjPlayer)} 点 · 赌注 ${bjBet}）</div>` +
            `<div class="uw2-card-row">${bjPlayer.map(c => cardHtml(c, false)).join("")}</div>`;

          const msgEl = document.createElement("div");
          msgEl.style.cssText = "font-weight:700;font-size:15px;color:var(--uw2-ink);padding:4px 2px;";
          msgEl.textContent = bjMsg;

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
          h.body.append(dealerArea, playerArea, msgEl, actions);
        }
      } else {
        if (dcPhase === "bet") {
          dcBet = Math.max(10, Math.min(maxBet, dcBet));
          const box = document.createElement("div");
          box.className = "uw2-action-box";
          box.innerHTML = `<div style="font-weight:700;color:var(--uw2-ink);">${dcMsg}</div>`;
          if (maxBet < 10) {
            box.innerHTML += `<div style="color:var(--uw2-danger);">金币不足 10，无法继续下注。</div>`;
          } else {
            const label = document.createElement("div");
            label.style.cssText = "display:flex;justify-content:space-between;font-weight:700;";
            label.innerHTML = `<span>下注金额</span><span>${dcBet} 金币（上限 ${maxBet}）</span>`;
            const slider = document.createElement("input");
            slider.type = "range";
            slider.className = "uw2-slider";
            slider.style.width = "100%";
            slider.min = "10";
            slider.max = String(maxBet);
            slider.step = "10";
            slider.value = String(dcBet);
            slider.addEventListener("input", () => {
              dcBet = Number(slider.value);
              label.innerHTML = `<span>下注金额</span><span>${dcBet} 金币（上限 ${maxBet}）</span>`;
            });
            const startBtn = document.createElement("button");
            startBtn.className = "uw2-btn uw2-btn-primary";
            startBtn.style.alignSelf = "flex-end";
            startBtn.style.padding = "8px 24px";
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
            box.append(label, slider, startBtn);
          }
          h.body.appendChild(box);
        } else {
          const playerBox = document.createElement("div");
          playerBox.className = "uw2-action-box";
          const pRank = evalDiceRank(dcPlayer);
          const pTitle = document.createElement("div");
          pTitle.className = "uw2-pane-title";
          pTitle.textContent = `我方 · ${HAND_NAMES[pRank]}（赌注 ${dcBet} · 剩余重掷 ${dcRerolls} 次）`;
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
          playerBox.append(pTitle, dRow);
          h.body.appendChild(playerBox);

          if (dcPhase === "done") {
            const oppBox = document.createElement("div");
            oppBox.className = "uw2-action-box";
            oppBox.innerHTML =
              `<div style="display:flex;justify-content:space-between;font-size:14px;"><span>对手 A：${dcOpp1.map(v => DICE_FACE[v]).join(" ")}</span><strong>${HAND_NAMES[evalDiceRank(dcOpp1)]}</strong></div>` +
              `<div style="display:flex;justify-content:space-between;font-size:14px;"><span>对手 B：${dcOpp2.map(v => DICE_FACE[v]).join(" ")}</span><strong>${HAND_NAMES[evalDiceRank(dcOpp2)]}</strong></div>`;
            h.body.appendChild(oppBox);
          }

          const msgEl = document.createElement("div");
          msgEl.style.cssText = "font-weight:700;font-size:15px;color:var(--uw2-ink);padding:4px 2px;";
          msgEl.textContent = dcMsg;

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
          h.body.append(msgEl, actions);
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
