// canvas_ui/wide_fleet_hub.ts — 現代一體化 16:9 艦隊經營大面板（左選船、右切 艦船與船長 / 水手與比例 / 人事變更 / 積載）
// 零套娃彈窗、零 DOM、100% 原版文本與底層狀態同步（直接呼叫 Commands / Buildings 方法）。
import { VIEW_W, VIEW_H } from "../core/screen.js";
import { DS, OFF } from "../model/schema_views.ts";
import { domS16 } from "../domain/economy.ts";
import { decodeCleanCstr, UI_FONT, MONO_FONT } from "./text_util.ts";

interface Rect { x: number; y: number; w: number; h: number; }
const hit = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBtn(ctx: CanvasRenderingContext2D, r: Rect, label: string, { primary = false, active = false, disabled = false, danger = false, hover = false } = {}) {
  roundRect(ctx, r.x, r.y, r.w, r.h, 7);
  if (disabled) {
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
  } else if (primary) {
    ctx.fillStyle = hover ? "#f2d282" : "#e2bc6b";
    ctx.fill();
    ctx.strokeStyle = "#fff1c7";
  } else if (danger) {
    ctx.fillStyle = hover ? "rgba(218, 78, 78, 0.42)" : "rgba(218, 78, 78, 0.22)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 130, 130, 0.78)";
  } else if (active) {
    ctx.fillStyle = "rgba(218, 178, 102, 0.34)";
    ctx.fill();
    ctx.strokeStyle = "#f0cf85";
  } else {
    ctx.fillStyle = hover ? "rgba(218, 178, 102, 0.24)" : "rgba(255,255,255,0.07)";
    ctx.fill();
    ctx.strokeStyle = hover ? "rgba(240,206,132,0.88)" : "rgba(214,174,96,0.38)";
  }
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.font = `700 13px ${UI_FONT}`;
  ctx.fillStyle = disabled ? "rgba(180,174,158,0.38)" : primary ? "#1b1206" : danger ? "#ffb8b8" : "#fff4d6";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 0.5, r.w - 8);
}

export async function runWideFleetHub(cmd: any): Promise<void> {
  const c = cmd.c;
  const st = cmd.st;
  const b = cmd.b;
  const { scr, sys, menu, codec, art } = c;
  const dec = (bts: Uint8Array) => decodeCleanCstr(codec, bts);

  // 原版 MENU #0x1b: [船長變更, 人事變更, 水手編組, 水手比例, 艦船銷毀, 積載分配]
  const m1b = c.menuItems(0x1b).slice(0, 6).map(dec);
  const tabLabels = [m1b[0], m1b[3], m1b[1], m1b[5]];
  const statLabels = c.menuItems(0x29).slice(0, 7).map(dec);
  const roleLabels = [dec(b.T.crewRoles[3]), dec(b.T.crewRoles[4]), dec(b.T.crewRoles[5])];

  const W = 1100, H = 600;
  const X = Math.round((VIEW_W - W) / 2), Y = Math.round((VIEW_H - H) / 2);
  const closeBtn: Rect = { x: X + W - 46, y: Y + 12, w: 32, h: 32 };

  let activeTab = 0; // 0=船長與艦船, 1=水手與比例, 2=人事變更, 3=積載
  let selShipIdx = 0;
  let pool = 0;
  let poolMorale = 0;
  let shouldClose = false;
  let pendingAction: (() => Promise<void>) | null = null;
  let toastText = "";
  let toastUntil = 0;
  const showToast = (msg: string) => {
    toastText = msg;
    toastUntil = (typeof performance !== "undefined" ? performance.now() : 0) + 2600;
    scr.dirty = true;
  };

  // 讀取艦隊現任 3 職位
  const scanPosts = () => {
    const posts = [0xff, 0xff, 0xff];
    for (let i = 0; i < 0x1e; i++) {
      const n = st.u8(DS.PARTY_CREW + i);
      if (n === 0xff) continue;
      const r = st.u8(st.personRecord(n) + 0x2e);
      if (r >= 3 && r <= 5) posts[r - 3] = n;
    }
    return posts;
  };

  const getShips = () => {
    const n = b.fleetShips();
    const out: {
      slot: number; name: string; typeId: number; capId: number; capName: string;
      crew: number; maxCrew: number; dur: number; maxDur: number; turn: number; prop: number;
      used: number; maxCargo: number; speed: number; navR: number; lookR: number;
    }[] = [];
    for (let i = 0; i < n; i++) {
      const slot = c.persons[i] & 0xff;
      const S = b.fleetSlot(slot), M = b.crewData(slot);
      const capId = st.u8(M + OFF.CREW_SLOT.CAPTAIN);
      if (capId & 0x80) continue;
      const ship = DS.TBL_SHIP + st.u8(S + OFF.DOCK_SLOT.SHIP) * 0x16;
      const typeId = st.u8(ship + 0x0f);
      out.push({
        slot,
        name: dec(st.cstr(ship)),
        typeId,
        capId,
        capName: dec(st.cstr(st.personRecord(capId))),
        crew: st.u16(S),
        maxCrew: st.u16(ship + 0x12),
        dur: st.u8(S + OFF.DOCK_SLOT.DURABILITY),
        maxDur: st.u8(S + OFF.DOCK_SLOT.MAX_DURABILITY),
        turn: st.u8(S + OFF.DOCK_SLOT.TURN),
        prop: st.u8(S + OFF.DOCK_SLOT.PROPULSION),
        used: domS16(b.cargoUsed(slot)),
        maxCargo: domS16(st.u16(ship + 0x14)),
        speed: (b.shipSpeed(slot) + 1) >> 1,
        navR: st.u8(M + OFF.CREW_SLOT.NAV_RATIO),
        lookR: st.u8(M + OFF.CREW_SLOT.LOOK_RATIO),
      });
    }
    return out;
  };

  // 預載所有船圖與職位頭像
  const initShips = getShips();
  const initPosts = scanPosts();
  void art?.preloadUrls?.([
    ...initShips.map(s => art.shipUrl(s.typeId)),
    ...initPosts.filter(p => p !== 0xff).map(p => art.portraitUrl(st.u8(st.personRecord(p) + 0x1a))),
  ]);

  const adjustSailors = (slot: number, delta: number) => {
    const M = b.crewData(slot), S = b.fleetSlot(slot);
    const ship = DS.TBL_SHIP + st.u8(S + OFF.DOCK_SLOT.SHIP) * 0x16;
    const cur = st.u16(S), maxCrew = st.u16(ship + 0x12), mor = st.u8(M + OFF.CREW_SLOT.MORALE);
    let next = cur + delta;
    if (next < 0) next = 0;
    if (next > Math.min(cur + pool, maxCrew)) next = Math.min(cur + pool, maxCrew);
    if (next === cur) return;
    st.set16(S, next);
    const prevPool = pool;
    pool = (pool - next + cur) & 0xffff;
    st.set8(M + OFF.CREW_SLOT.MORALE, 0);
    if (next) st.set8(M + OFF.CREW_SLOT.MORALE, cur < next ? Math.trunc((mor * cur + (next - cur) * poolMorale) / next) : mor);
    poolMorale = 0;
    if (pool) poolMorale = (cur < next ? poolMorale : Math.trunc((poolMorale * prevPool + (cur - next) * mor) / pool)) & 0xff;
    scr.dirty = true;
  };

  const stepRatio = (slot: number, r: number, times = 1) => {
    const M = b.crewData(slot);
    for (let k = 0; k < times; k++) {
      const a = st.u8(M + OFF.CREW_SLOT.NAV_RATIO), b9 = st.u8(M + OFF.CREW_SLOT.LOOK_RATIO), rest = (100 - a - b9) & 0xff;
      if (r <= 1) { const t = [b9, a, rest]; cmd.ratioStep(r, t); st.set8(M + OFF.CREW_SLOT.NAV_RATIO, t[1]); st.set8(M + OFF.CREW_SLOT.LOOK_RATIO, t[0]); }
      else if (r <= 3) { const t = [a, rest, b9]; cmd.ratioStep(r, t); st.set8(M + OFF.CREW_SLOT.NAV_RATIO, t[0]); st.set8(M + OFF.CREW_SLOT.LOOK_RATIO, t[2]); }
      else { const t = [rest, b9, a]; cmd.ratioStep(r, t); st.set8(M + OFF.CREW_SLOT.NAV_RATIO, t[2]); st.set8(M + OFF.CREW_SLOT.LOOK_RATIO, t[1]); }
    }
    scr.dirty = true;
  };

  let clickTargets: { rect: Rect; onClick: () => void }[] = [];

  const drawFn = (ctx: CanvasRenderingContext2D) => {
    clickTargets = [];
    const vx = sys.mouse?.vx ?? -1, vy = sys.mouse?.vy ?? -1;
    const ships = getShips();
    if (selShipIdx >= ships.length) selShipIdx = Math.max(0, ships.length - 1);
    const curShip = ships[selShipIdx];

    ctx.save();
    ctx.fillStyle = "rgba(4, 10, 20, 0.62)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.shadowColor = "rgba(0, 0, 0, 0.72)";
    ctx.shadowBlur = 32;
    ctx.shadowOffsetY = 12;
    roundRect(ctx, X, Y, W, H, 14);
    const bg = ctx.createLinearGradient(X, Y, X, Y + H);
    bg.addColorStop(0, "rgba(17, 33, 56, 0.98)");
    bg.addColorStop(1, "rgba(9, 19, 34, 0.99)");
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = "rgba(218, 178, 102, 0.85)";
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // 頂欄
    ctx.font = `700 19px ${UI_FONT}`;
    ctx.fillStyle = "#f7dfa4";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(dec(cmd.S.slRest) ? `${m1b[0].slice(0, 2)} / ${m1b[1].slice(0, 2)}` : m1b[0], X + 24, Y + 28);

    if (pool > 0) {
      ctx.font = `700 14px ${MONO_FONT}`;
      ctx.fillStyle = "#ffe184";
      ctx.textAlign = "right";
      ctx.fillText(`${dec(cmd.S.slRest)}: ${pool}`, X + W - 66, Y + 28);
    }

    drawBtn(ctx, closeBtn, "×", { hover: hit(closeBtn, vx, vy) });
    clickTargets.push({ rect: closeBtn, onClick: () => { shouldClose = true; } });

    // 分頁列
    const tabY = Y + 54, tabH = 36, tabW = 152;
    for (let i = 0; i < tabLabels.length; i++) {
      const tr: Rect = { x: X + 24 + i * (tabW + 10), y: tabY, w: tabW, h: tabH };
      drawBtn(ctx, tr, tabLabels[i], { active: i === activeTab, hover: hit(tr, vx, vy) });
      clickTargets.push({ rect: tr, onClick: () => { activeTab = i; scr.dirty = true; } });
    }

    ctx.strokeStyle = "rgba(218, 178, 102, 0.28)";
    ctx.beginPath();
    ctx.moveTo(X + 20, Y + 102);
    ctx.lineTo(X + W - 20, Y + 102);
    ctx.stroke();

    const bodyY = Y + 114;
    const leftX = X + 24, leftW = 286;
    const rightX = X + 330, rightW = W - 354;

    // 左欄：常駐艦隊船隻列表
    for (let i = 0; i < ships.length; i++) {
      const s = ships[i];
      const r: Rect = { x: leftX, y: bodyY + i * 44, w: leftW, h: 40 };
      const isSel = i === selShipIdx;
      roundRect(ctx, r.x, r.y, r.w, r.h, 8);
      ctx.fillStyle = isSel ? "rgba(218, 178, 102, 0.34)" : hit(r, vx, vy) ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.04)";
      ctx.fill();
      if (isSel) { ctx.strokeStyle = "#f0cf85"; ctx.lineWidth = 1.2; ctx.stroke(); }

      ctx.font = `700 14px ${UI_FONT}`;
      ctx.fillStyle = "#fff4d6";
      ctx.textAlign = "left";
      ctx.fillText(s.name, r.x + 12, r.y + 14, 170);

      ctx.font = `500 12px ${UI_FONT}`;
      ctx.fillStyle = "#b8c7d9";
      ctx.fillText(s.capName, r.x + 12, r.y + 30, 150);

      ctx.font = `600 12px ${MONO_FONT}`;
      ctx.fillStyle = "#f4d78e";
      ctx.textAlign = "right";
      ctx.fillText(`${s.crew}/${s.maxCrew}`, r.x + r.w - 10, r.y + 14);
      ctx.fillStyle = "#8de8a8";
      ctx.fillText(`${s.speed}`, r.x + r.w - 10, r.y + 30);

      clickTargets.push({ rect: r, onClick: () => { selShipIdx = i; scr.dirty = true; } });
    }

    // =================== TAB 0: 船長與艦船 ===================
    if (activeTab === 0 && curShip) {
      const shipImg = art?.getImage?.(art.shipUrl(curShip.typeId));
      const imgX = rightX, imgY = bodyY, imgW = 240, imgH = 160;
      roundRect(ctx, imgX, imgY, imgW, imgH, 10);
      ctx.fillStyle = "#091424";
      ctx.fill();
      ctx.strokeStyle = "rgba(218, 178, 102, 0.65)";
      ctx.stroke();
      if (shipImg) {
        ctx.imageSmoothingEnabled = (shipImg.naturalWidth || 96) > 96;
        ctx.drawImage(shipImg, imgX + 24, imgY + 16, 192, 128);
      }

      // 船名與船長操作區
      ctx.font = `700 20px ${UI_FONT}`;
      ctx.fillStyle = "#fff4d6";
      ctx.textAlign = "left";
      ctx.fillText(curShip.name, rightX + 264, bodyY + 24);

      ctx.font = `600 15px ${UI_FONT}`;
      ctx.fillStyle = "#d8c394";
      ctx.fillText(curShip.capName, rightX + 264, bodyY + 60);

      const capBtn: Rect = { x: rightX + 264, y: bodyY + 86, w: 148, h: 38 };
      drawBtn(ctx, capBtn, m1b[0], { primary: true, hover: hit(capBtn, vx, vy) });
      clickTargets.push({
        rect: capBtn,
        onClick: () => {
          pendingAction = async () => {
            const s = await b.listSel().select(0x89, b.captainPool());
            if (s !== -1) { cmd.setCaptain(curShip.slot, c.persons[s]); scr.dirty = true; }
          };
        },
      });

      const canScrap = ships.length > 1 && curShip.capId !== st.hero;
      const scrapBtn: Rect = { x: rightX + 426, y: bodyY + 86, w: 136, h: 38 };
      drawBtn(ctx, scrapBtn, m1b[4], { danger: true, disabled: !canScrap, hover: hit(scrapBtn, vx, vy) });
      if (canScrap) {
        clickTargets.push({
          rect: scrapBtn,
          onClick: () => {
            pendingAction = async () => {
              await cmd.scrapShip(curShip.slot);
              for (let i = 0; i < 10; i++) {
                const S = b.fleetSlot(i);
                if ((st.u8(S + OFF.DOCK_SLOT.FLAGS) & 0x30) === 0x10 && st.u8(b.crewData(i) + 0x1b) === 0xff) st.set8(S + OFF.DOCK_SLOT.FLAGS, 0);
              }
              scr.dirty = true;
            };
          },
        });
      }

      // 屬性條
      const bars: [string, number, number][] = [
        [statLabels[0], curShip.dur, curShip.maxDur || 100],
        [statLabels[1], curShip.turn, 100],
        [statLabels[2], curShip.prop, 100],
        [statLabels[3], curShip.crew, curShip.maxCrew || 1],
        [statLabels[5], curShip.used, curShip.maxCargo || 1],
      ];
      for (let i = 0; i < bars.length; i++) {
        const by = bodyY + 190 + i * 44;
        const [lb, v, mx] = bars[i];
        ctx.font = `600 14px ${UI_FONT}`;
        ctx.fillStyle = "#eadfc8";
        ctx.textAlign = "left";
        ctx.fillText(lb, rightX, by);
        ctx.font = `700 14px ${MONO_FONT}`;
        ctx.fillStyle = "#f4d78e";
        ctx.textAlign = "right";
        ctx.fillText(`${v} / ${mx}`, rightX + rightW - 8, by);

        roundRect(ctx, rightX, by + 12, rightW - 8, 12, 6);
        ctx.fillStyle = "rgba(255,255,255,0.09)";
        ctx.fill();
        const ratio = Math.max(0, Math.min(1, v / (mx || 1)));
        if (ratio > 0) {
          roundRect(ctx, rightX, by + 12, Math.max(8, (rightW - 8) * ratio), 12, 6);
          ctx.fillStyle = "#e2bc6b";
          ctx.fill();
        }
      }
    }

    // =================== TAB 1: 水手與比例 ===================
    else if (activeTab === 1 && curShip) {
      // 上半：水手編組
      const sBoxY = bodyY, sBoxH = 126;
      roundRect(ctx, rightX, sBoxY, rightW, sBoxH, 10);
      ctx.fillStyle = "rgba(8, 16, 30, 0.72)";
      ctx.fill();
      ctx.strokeStyle = "rgba(218, 178, 102, 0.36)";
      ctx.stroke();

      ctx.font = `700 16px ${UI_FONT}`;
      ctx.fillStyle = "#f7dfa4";
      ctx.textAlign = "left";
      ctx.fillText(`${m1b[2]}  —  ${curShip.name}`, rightX + 18, sBoxY + 28);

      ctx.font = `700 16px ${MONO_FONT}`;
      ctx.fillStyle = "#fff4d6";
      ctx.textAlign = "right";
      ctx.fillText(`${curShip.crew} / ${curShip.maxCrew}   (${dec(cmd.S.slRest)}: ${pool})`, rightX + rightW - 18, sBoxY + 28);

      const sBtns: [string, number][] = [["-10", -10], ["-1", -1], ["+1", 1], ["+10", 10]];
      for (let i = 0; i < sBtns.length; i++) {
        const br: Rect = { x: rightX + 18 + i * 86, y: sBoxY + 64, w: 76, h: 38 };
        drawBtn(ctx, br, sBtns[i][0], { hover: hit(br, vx, vy) });
        clickTargets.push({ rect: br, onClick: () => adjustSailors(curShip.slot, sBtns[i][1]) });
      }

      // 下半：駕駛 / 瞭望 / 甲板 比例
      const rBoxY = bodyY + 148, rBoxH = 266;
      roundRect(ctx, rightX, rBoxY, rightW, rBoxH, 10);
      ctx.fillStyle = "rgba(8, 16, 30, 0.72)";
      ctx.fill();
      ctx.strokeStyle = "rgba(218, 178, 102, 0.36)";
      ctx.stroke();

      ctx.font = `700 16px ${UI_FONT}`;
      ctx.fillStyle = "#f7dfa4";
      ctx.textAlign = "left";
      ctx.fillText(m1b[3], rightX + 18, rBoxY + 28);

      const ratios: [string, number, number, number][] = [
        [dec(cmd.S.rDrive), curShip.lookR, 0, 1],
        [dec(cmd.S.rWatch), curShip.navR, 2, 3],
        [dec(cmd.S.rDeck), Math.max(0, 100 - curShip.navR - curShip.lookR), 4, 5],
      ];
      for (let i = 0; i < 3; i++) {
        const [lb, pct, decAct, incAct] = ratios[i];
        const ry = rBoxY + 68 + i * 62;
        const people = Math.trunc((pct * curShip.crew) / 100);

        ctx.font = `700 15px ${UI_FONT}`;
        ctx.fillStyle = "#fff4d6";
        ctx.textAlign = "left";
        ctx.fillText(lb, rightX + 20, ry + 16);

        const bm5: Rect = { x: rightX + 120, y: ry, w: 42, h: 32 };
        const bm1: Rect = { x: rightX + 168, y: ry, w: 34, h: 32 };
        const barX = rightX + 214, barW = 290;
        const bp1: Rect = { x: rightX + 516, y: ry, w: 34, h: 32 };
        const bp5: Rect = { x: rightX + 556, y: ry, w: 42, h: 32 };

        drawBtn(ctx, bm5, "-5", { hover: hit(bm5, vx, vy) });
        drawBtn(ctx, bm1, "-", { hover: hit(bm1, vx, vy) });
        drawBtn(ctx, bp1, "+", { hover: hit(bp1, vx, vy) });
        drawBtn(ctx, bp5, "+5", { hover: hit(bp5, vx, vy) });

        roundRect(ctx, barX, ry + 8, barW, 16, 8);
        ctx.fillStyle = "rgba(255,255,255,0.1)";
        ctx.fill();
        if (pct > 0) {
          roundRect(ctx, barX, ry + 8, Math.max(8, (barW * pct) / 100), 16, 8);
          ctx.fillStyle = "#e2bc6b";
          ctx.fill();
        }

        ctx.font = `700 14px ${MONO_FONT}`;
        ctx.fillStyle = "#f4d78e";
        ctx.textAlign = "right";
        ctx.fillText(`${people} (${pct}%)`, rightX + rightW - 18, ry + 16);

        clickTargets.push({ rect: bm5, onClick: () => stepRatio(curShip.slot, decAct, 5) });
        clickTargets.push({ rect: bm1, onClick: () => stepRatio(curShip.slot, decAct, 1) });
        clickTargets.push({ rect: bp1, onClick: () => stepRatio(curShip.slot, incAct, 1) });
        clickTargets.push({ rect: bp5, onClick: () => stepRatio(curShip.slot, incAct, 5) });
      }
    }

    // =================== TAB 2: 人事變更 ===================
    else if (activeTab === 2) {
      const posts = scanPosts();
      const cardW = 228, cardH = 290, gap = 22;
      for (let k = 0; k < 3; k++) {
        const pid = posts[k];
        const r: Rect = { x: rightX + k * (cardW + gap), y: bodyY + 16, w: cardW, h: cardH };
        const isHov = hit(r, vx, vy);
        roundRect(ctx, r.x, r.y, r.w, r.h, 12);
        ctx.fillStyle = isHov ? "rgba(218, 178, 102, 0.22)" : "rgba(8, 16, 30, 0.78)";
        ctx.fill();
        ctx.strokeStyle = isHov ? "#f0cf85" : "rgba(214, 174, 96, 0.45)";
        ctx.lineWidth = isHov ? 2 : 1.2;
        ctx.stroke();

        ctx.font = `700 16px ${UI_FONT}`;
        ctx.fillStyle = "#f7dfa4";
        ctx.textAlign = "center";
        ctx.fillText(roleLabels[k], r.x + r.w / 2, r.y + 28);

        const px = r.x + Math.round((r.w - 112) / 2), py = r.y + 52;
        ctx.fillStyle = "#081220";
        ctx.fillRect(px, py, 112, 140);
        let pName = "----";
        if (pid !== 0xff) {
          const P = st.personRecord(pid);
          pName = dec(st.cstr(P));
          const face = st.u8(P + 0x1a);
          const img = face < 0x80 ? art?.getImage?.(art.portraitUrl(face)) : null;
          if (img) {
            ctx.imageSmoothingEnabled = (img.naturalWidth || 64) > 64;
            ctx.drawImage(img, px, py, 112, 140);
          }
        }
        ctx.strokeStyle = "rgba(214, 174, 96, 0.65)";
        ctx.strokeRect(px, py, 112, 140);

        ctx.font = `700 16px ${UI_FONT}`;
        ctx.fillStyle = "#fff4d6";
        ctx.fillText(pName, r.x + r.w / 2, r.y + 224, r.w - 16);

        const chgBtn: Rect = { x: r.x + 44, y: r.y + 244, w: r.w - 88, h: 32 };
        drawBtn(ctx, chgBtn, m1b[1].slice(2) || m1b[1], { primary: isHov, hover: isHov });

        clickTargets.push({
          rect: r,
          onClick: () => {
            pendingAction = async () => {
              cmd.posts = scanPosts();
              await cmd.setPost(k);
              const np = scanPosts()[k];
              if (np !== 0xff) {
                const f = st.u8(st.personRecord(np) + 0x1a);
                if (f < 0x80) void art?.loadImage?.(art.portraitUrl(f));
              }
              scr.dirty = true;
            };
          },
        });
      }
    }

    // =================== TAB 3: 積載 ===================
    else if (activeTab === 3 && curShip) {
      const M = b.crewData(curShip.slot);
      const supNames = b.LO.supplies.map(dec);
      const supVals = [
        Math.trunc(domS16(st.u16(M)) / 10),
        Math.trunc(domS16(st.u16(M + 2)) / 10),
        domS16(st.u16(M + 4)),
        domS16(st.u16(M + 6)),
      ];
      for (let k = 0; k < 4; k++) {
        const r: Rect = { x: rightX + k * 184, y: bodyY, w: 174, h: 64 };
        roundRect(ctx, r.x, r.y, r.w, r.h, 8);
        ctx.fillStyle = "rgba(8, 16, 30, 0.78)";
        ctx.fill();
        ctx.strokeStyle = "rgba(218, 178, 102, 0.36)";
        ctx.stroke();
        ctx.font = `600 13px ${UI_FONT}`;
        ctx.fillStyle = "#9ab2cc";
        ctx.textAlign = "center";
        ctx.fillText(supNames[k], r.x + r.w / 2, r.y + 20);
        ctx.font = `700 18px ${MONO_FONT}`;
        ctx.fillStyle = "#f4d78e";
        ctx.fillText(String(supVals[k]), r.x + r.w / 2, r.y + 44);
      }

      let rowIdx = 0;
      for (let k = 0; k < 5; k++) {
        const g = st.u8(M + OFF.CREW_SLOT.CARGO_GOODS + k);
        const amt = domS16(st.u16(M + OFF.CREW_SLOT.CARGO_AMTS + 2 * k));
        if (g >= 46 || amt <= 0) continue;
        const ry = bodyY + 84 + rowIdx * 46;
        roundRect(ctx, rightX, ry, rightW, 40, 8);
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.fill();
        ctx.font = `600 15px ${UI_FONT}`;
        ctx.fillStyle = "#fff4d6";
        ctx.textAlign = "left";
        ctx.fillText(dec(b.LO.goods[g]), rightX + 16, ry + 20);
        ctx.font = `700 15px ${MONO_FONT}`;
        ctx.fillStyle = "#f4d78e";
        ctx.textAlign = "right";
        ctx.fillText(`×${amt}`, rightX + rightW - 16, ry + 20);
        rowIdx++;
      }

      const distBtn: Rect = { x: rightX, y: bodyY + 340, w: 180, h: 40 };
      drawBtn(ctx, distBtn, m1b[5], { primary: true, disabled: ships.length < 2, hover: hit(distBtn, vx, vy) });
      if (ships.length >= 2) {
        clickTargets.push({
          rect: distBtn,
          onClick: () => {
            pendingAction = async () => { await cmd.wideDistribute(m1b[5]); };
          },
        });
      }
    }

    if (toastText && (typeof performance === "undefined" || performance.now() < toastUntil)) {
      ctx.font = `600 14px ${UI_FONT}`;
      ctx.fillStyle = "#ff8b8b";
      ctx.textAlign = "left";
      ctx.fillText(toastText, X + 26, Y + H - 22);
    }
    ctx.restore();
  };

  await menu.waitRelease();
  scr.wideDialog = null;
  scr.wideOverlays.push(drawFn);
  scr.dirty = true;
  try {
    for (;;) {
      const fn = pendingAction as (() => Promise<void>) | null;
      if (fn) {
        pendingAction = null;
        await fn();
        scr.dirty = true;
        continue;
      }
      if (shouldClose) {
        // 退出前檢查主角必須任船長（1e9d6）
        let heroCap = false;
        for (let i = 0; i < 10; i++) {
          if ((st.u8(b.fleetSlot(i) + 8) & 0x30) === 0x10 && st.u8(b.crewData(i) + 0x1b) === st.hero) { heroCap = true; break; }
        }
        if (!heroCap) {
          shouldClose = false;
          showToast(cmd.cap(() => c.message(0xe2)));
          continue;
        }
        break;
      }
      const ev = menu.readEvent();
      const vx = sys.mouse?.vx ?? -1, vy = sys.mouse?.vy ?? -1;
      if (ev === 0x1b || ev === 0x30) { shouldClose = true; continue; }
      if (ev === 0x0d && menu.mouseFlag) {
        if (vx < X || vx > X + W || vy < Y || vy > Y + H) { shouldClose = true; continue; }
        for (const t of clickTargets) {
          if (hit(t.rect, vx, vy)) { t.onClick(); break; }
        }
        await menu.waitRelease();
      }
      await sys.poll();
    }
  } finally {
    const idx = scr.wideOverlays.indexOf(drawFn);
    if (idx >= 0) scr.wideOverlays.splice(idx, 1);
    scr.dirty = true;
    await menu.waitRelease();
  }
}
