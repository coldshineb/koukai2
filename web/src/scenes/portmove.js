// scenes/portmove.js — 港內移動: **非原版的擴充功能（仿《大航海時代外傳》）**
// 依使用者說明, 外傳的港內移動是瞬移: 選了建築就把主角放到門口, 再走原版「站在門口 → 進門」的流程 (1b1a3 → 1b6ba)。
// 只在 ctx.portMove 為真時出現 (main.js: 瀏覽器預設開啟, 網址 ?portmove=0 關閉; 測試環境 tools/emu 不設定 → 關閉, 選單與原版相同)。
// 規則與驗證見 docs/RE_NOTES.md 第 33 節:
//   - 航海術選單 (commands.js nav) 最後多一項「港內移動」, 海上變灰; 開啟時整個選單上移一行 (y=0xc8, 框底與原版 6 項時相同)。
//   - 清單: 本港入口表 (DS:0904) 不是 (255,255) 的建築, 名稱 = 原版海港地圖的 MENU #0x3a (7 號住宅原版是「非玩家」, 改用字庫的「住宅」)。
//   - 不能瞬移 (灰色): 白天從目前位置走不到那扇門 — 障礙 = 地形、衛兵 (站立行人種類 2, 6172 回傳 7) ±1 格、營業中的其他門。
//     一般行人不擋; 夜間 6172 沒有碰撞, 只看地形。
//   - 瞬移: 視窗照進港規則 (8c53) vx = ex − 12、vy = ey − 13 (夾在 0..0x48), 主角站在門上; 不推進行人、不耗亂數、不改時刻。
//   - 白天、門沒開、門口那格正好有行人時 (原版會互卡, 每按一次方向鍵就交談 / 再顯示「關門了」, 33.6), 先把那個行人挪到最近的空格。
const PM_W = 96, PM_LAST = 0x5e;
const pmClamp = v => (v < 0 ? 0 : v > 0x48 ? 0x48 : v);

export class PortMove {
  static enabled(ctx) { return !!ctx.portMove; }
  static label(ctx) { return ctx.font.encode("港內移動{00}"); }
  static present(p, k) { const x = p.door[k * 2], y = p.door[k * 2 + 1]; return !(x === 0xff && y === 0xff) && x <= PM_LAST && y <= PM_LAST; }
  static walkable(p, x, y) { return x >= 0 && y >= 0 && x <= PM_LAST && y <= PM_LAST && !p.blockedAt((y + 1) * PM_W + x); }
  // 衛兵: 站立行人 4..7 中 6172 會回傳 7 的 (種類 2); 夜間 6172 不判斷碰撞 → 沒有衛兵
  static guards(p) {
    const g = [];
    if (p.night()) return g;
    for (let b = 4; b < 8; b++) { const n = p.npc(b); if (n.d === 2 && n.x !== 0xff) g.push(n); }
    return g;
  }
  // 能否從主角目前位置走到入口 k (4 方向 BFS; 主角每步只走上下左右一格, 66be 被擋住時也只橫移一格)
  static reachable(p, k) {
    const G = PortMove.guards(p), tx = p.door[k * 2], ty = p.door[k * 2 + 1];
    const nearGuard = (x, y) => G.some(n => n.x - 1 <= x && n.x + 1 >= x && n.y - 1 <= y && n.y + 1 >= y);
    const openDoor = new Set();
    for (let j = 0; j < 12; j++) if (j !== k && PortMove.present(p, j) && p.isOpen(j)) openDoor.add(p.door[j * 2 + 1] * PM_W + p.door[j * 2]);
    if (!PortMove.walkable(p, tx, ty) || nearGuard(tx, ty)) return false;
    const sx = p.hx + p.vx, sy = p.hy + p.vy;
    if (sx === tx && sy === ty) return true;
    const seen = new Uint8Array(PM_W * PM_W), q = [sy * PM_W + sx];
    seen[q[0]] = 1;
    for (let h = 0; h < q.length; h++) {
      const x = q[h] % PM_W, y = (q[h] / PM_W) | 0;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nx = x + dx, ny = y + dy, i = ny * PM_W + nx;
        if (!PortMove.walkable(p, nx, ny) || seen[i] || nearGuard(nx, ny)) continue;
        if (nx === tx && ny === ty) return true;
        seen[i] = 1;
        if (openDoor.has(i)) continue;                                 // 踩到營業中的門會直接進去 (出來時回到門下一格)
        q.push(i);
      }
    }
    return false;
  }
  // 本港的建築與能否瞬移 (打開清單時依當時的時刻、衛兵位置判斷)
  static facilities(p) {
    const lab = p.c.menuItems(0x3a), out = [];
    for (let k = 0; k < 12; k++) {
      if (!PortMove.present(p, k)) continue;
      out.push({ k, name: k === 7 ? p.c.font.encode("住宅{00}") : lab[k], ok: PortMove.reachable(p, k) });
    }
    return out;
  }
  // 航海術選單「港內移動」: 右側直式選單 (20b0c) 於 y=0x30; 選了 → 記下目標, 回傳 1 (結束航海術選單, 由 port.js walk 瞬移); 取消 → 0
  static async choose(cmds) {
    const p = cmds.p, menu = cmds.c.menu, list = PortMove.facilities(p);
    if (!list.length) return 0;
    let dis = 0; list.forEach((e, i) => { if (!e.ok) dis |= 1 << i; });
    menu.disabled = dis;
    const r = await cmds.popMenu(0x30, list.map(e => e.name));
    if (r === 0xff || !list[r]?.ok) return 0;
    p.pmTarget = list[r].k;
    return 1;
  }
  // 瞬移到入口 k: 主角座標 = 入口, 視窗照 8c53 的規則, [bdba]; 然後 1b1a3 (清快取、畫地圖、主角朝下)。之後由呼叫端照原版進門 (1b6ba)
  static teleport(p, k) {
    const ex = p.door[k * 2], ey = p.door[k * 2 + 1];
    if (!p.night() && !p.isOpen(k)) PortMove.clearDoor(p, ex, ey);
    const vx = pmClamp(ex - 12), vy = pmClamp(ey - 13);
    p.vx = vx; p.vy = vy; p.hx = ex - vx; p.hy = ey - vy;
    p.bdba = vy * PM_W + vx;
    p.redraw();                                                        // 0fea:b303 = 1b1a3
  }
  // 門口那一格的行人挪到最近的空格 (4 方向 BFS, 上/右/下/左; 地形可走、x,y < 0x5e、離主角 ≥ 3 格 (切比雪夫距離)、不在其他行人 ±1)
  static clearDoor(p, ex, ey) {
    for (let b = 0; b < 8; b++) {
      const n = p.npc(b);
      if (n.x !== ex || n.y !== ey) continue;
      const free = (x, y) => {
        if (x >= 0x5e || y >= 0x5e) return false;
        if (Math.abs(x - ex) <= 2 && Math.abs(y - ey) <= 2) return false;   // 主角往任何方向走第一步都不會撞到 (目標格 ±1)
        for (let o = 0; o < 8; o++) { if (o === b) continue; const m = p.npc(o); if (m.x - 1 <= x && m.x + 1 >= x && m.y - 1 <= y && m.y + 1 >= y) return false; }
        return true;
      };
      const seen = new Uint8Array(PM_W * PM_W), q = [ey * PM_W + ex];
      seen[q[0]] = 1;
      for (let h = 0; h < q.length; h++) {
        const x = q[h] % PM_W, y = (q[h] / PM_W) | 0;
        if (h && free(x, y)) { p.setNpc(b, 0, x); p.setNpc(b, 1, y); break; }
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const nx = x + dx, ny = y + dy, i = ny * PM_W + nx;
          if (!PortMove.walkable(p, nx, ny) || seen[i]) continue;
          seen[i] = 1; q.push(i);
        }
      }
    }
  }
}
