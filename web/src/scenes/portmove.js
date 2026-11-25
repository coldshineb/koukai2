// scenes/portmove.js — 港内移动: **非原版的扩充功能（仿《大航海时代外传》）**
// 依用户说明, 外传的港内移动是瞬移: 选了建筑就把主角放到门口, 再走原版「站在门口 → 进门」的流程 (1b1a3 → 1b6ba)。
// 只在 ctx.portMove 为真时出现 (main.js: 浏览器默认打开, 网址 ?portmove=0 关闭; 测试环境 tools/emu 不设置 → 关闭, 菜单与原版相同)。
// 规则与验证见 docs/RE_NOTES.md 第 33 节:
//   - 航海术菜单 (commands.js nav) 最后多一项「港内移动」, 海上变灰; 打开时整个菜单上移一行 (y=0xc8, 框底与原版 6 项时相同)。
//   - 清单: 本港入口表 (DS:0904) 不是 (255,255) 的建筑, 名称 = 原版海港地图的 MENU #0x3a (7 号住宅原版是「非玩家」, 改用字库的「住宅」)。
//   - 不能瞬移 (灰色): 白天从目前位置走不到那扇门 — 障碍 = 地形、卫兵 (站立行人种类 2, 6172 返回 7) ±1 格、营业中的其他门。
//     一般行人不挡; 夜间 6172 没有碰撞, 只看地形。
//   - 瞬移: 窗口照进港规则 (8c53) vx = ex − 12、vy = ey − 13 (夹在 0..0x48), 主角站在门上; 不推进行人、不耗随机数、不改时刻。
//   - 白天、门没开、门口那格正好有行人时 (原版会互卡, 每按一次方向键就交谈 / 再显示「关门了」, 33.6), 先把那个行人挪到最近的空格。
const PM_W = 96, PM_LAST = 0x5e;
const pmClamp = v => (v < 0 ? 0 : v > 0x48 ? 0x48 : v);

export class PortMove {
  static enabled(ctx) { return !!ctx.portMove; }
  static label(ctx) { return ctx.font.encode("港內移動{00}"); }
  static present(p, k) { const x = p.door[k * 2], y = p.door[k * 2 + 1]; return !(x === 0xff && y === 0xff) && x <= PM_LAST && y <= PM_LAST; }
  static walkable(p, x, y) { return x >= 0 && y >= 0 && x <= PM_LAST && y <= PM_LAST && !p.blockedAt((y + 1) * PM_W + x); }
  // 卫兵: 站立行人 4..7 中 6172 会返回 7 的 (种类 2); 夜间 6172 不判断碰撞 → 没有卫兵
  static guards(p) {
    const g = [];
    if (p.night()) return g;
    for (let b = 4; b < 8; b++) { const n = p.npc(b); if (n.d === 2 && n.x !== 0xff) g.push(n); }
    return g;
  }
  // 能否从主角目前位置走到入口 k (4 方向 BFS; 主角每步只走上下左右一格, 66be 被挡住时也只横移一格)
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
        if (openDoor.has(i)) continue;                                 // 踩到营业中的门会直接进去 (出来时回到门下一格)
        q.push(i);
      }
    }
    return false;
  }
  // 本港的建筑与能否瞬移 (打开清单时依当时的时刻、卫兵位置判断)
  static facilities(p) {
    const lab = p.c.menuItems(0x3a), out = [];
    for (let k = 0; k < 12; k++) {
      if (!PortMove.present(p, k)) continue;
      out.push({ k, name: k === 7 ? p.c.font.encode("住宅{00}") : lab[k], ok: PortMove.reachable(p, k) });
    }
    return out;
  }
  // 航海术菜单「港内移动」: 右侧直式菜单 (20b0c) 于 y=0x30; 选了 → 记下目标, 返回 1 (结束航海术菜单, 由 port.js walk 瞬移); 取消 → 0
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
  // 瞬移到入口 k: 主角座标 = 入口, 窗口照 8c53 的规则, [bdba]; 然后 1b1a3 (清缓存、画地图、主角朝下)。之后由调用端照原版进门 (1b6ba)
  static teleport(p, k) {
    const ex = p.door[k * 2], ey = p.door[k * 2 + 1];
    if (!p.night() && !p.isOpen(k)) PortMove.clearDoor(p, ex, ey);
    const vx = pmClamp(ex - 12), vy = pmClamp(ey - 13);
    p.vx = vx; p.vy = vy; p.hx = ex - vx; p.hy = ey - vy;
    p.bdba = vy * PM_W + vx;
    p.redraw();                                                        // 0fea:b303 = 1b1a3
  }
  // 门口那一格的行人挪到最近的空格 (4 方向 BFS, 上/右/下/左; 地形可走、x,y < 0x5e、离主角 ≥ 3 格 (切比雪夫距离)、不在其他行人 ±1)
  static clearDoor(p, ex, ey) {
    for (let b = 0; b < 8; b++) {
      const n = p.npc(b);
      if (n.x !== ex || n.y !== ey) continue;
      const free = (x, y) => {
        if (x >= 0x5e || y >= 0x5e) return false;
        if (Math.abs(x - ex) <= 2 && Math.abs(y - ey) <= 2) return false;   // 主角往任何方向走第一步都不会撞到 (目标格 ±1)
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
