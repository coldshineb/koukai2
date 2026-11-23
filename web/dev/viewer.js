import { Screen, SCREEN_W, SCREEN_H } from "../src/core/screen.js";
import { loadIndexed, loadJSON, b64bytes, loadBinary } from "../src/core/assets.js";
import { Font } from "../src/core/font.js";
import { TextConsole } from "../src/ui/console.js";
import { WindowSystem } from "../src/ui/window.js";
import { decodeGraph, graphOffsets, graphSize } from "../src/gfx/graphdec.js";
import { Kao, PARTS } from "../src/gfx/kao.js";

const A = "../assets";
const $ = id => document.getElementById(id);
const scr = new Screen($("c"));
const font = await new Font().load(A);
const pals = (await loadJSON(A + "/data/palettes.json")).palettes;
const pchip = await loadJSON(A + "/data/portchip.json");
const pmaps = await loadJSON(A + "/data/portmaps.json");
const bgm = await loadJSON(A + "/data/bgm.json");
const frameGfx = await loadBinary(A + "/gfx/ui_frame.bin");
const sets = await Promise.all([0, 1, 2, 3, 4, 5, 6].map(i => loadIndexed(`${A}/gfx/portchip${i}.png`)));
const kao = new Kao(await loadBinary(A + "/gfx/KAO.LZW"));
const texts = {}, gfiles = {};

pals.forEach((p, i) => $("pal").add(new Option(`${p.name || "#" + i}  DS:${p.ds.toString(16)}`, i)));
$("pal").value = pals.findIndex(p => p.name === "day");
Object.entries(bgm.tracks).forEach(([k, f]) => $("bgm").add(new Option(`${k}: ${f}`, f)));
$("bgm").onchange = () => { $("player").src = "../bgm/" + $("bgm").value; $("player").play(); };

let camX = 0, camY = 0;
async function draw() {
  const mode = $("mode").value, idx = +$("idx").value;
  scr.setPaletteRaw(pals[+$("pal").value].raw);
  scr.clear(0);
  const con = new TextConsole(scr, font);
  const win = new WindowSystem(scr, con, frameGfx, { options: { animate: false } });
  if (mode === "port") {
    const m = b64bytes(pmaps.maps[Math.min(idx, pmaps.maps.length - 1)]);
    const ts = sets[pchip.chipNo[idx] ?? 0];
    const tx0 = camX >> 4, ty0 = camY >> 4;
    for (let ty = 0; ty <= SCREEN_H / 16; ty++) for (let tx = 0; tx <= SCREEN_W / 16; tx++) {
      const mx = tx0 + tx, my = ty0 + ty; if (mx >= 96 || my >= 96) continue;
      const t = m[my * 96 + mx];
      scr.blit(ts, (t % 16) * 16, (t >> 4) * 16, 16, 16, tx * 16 - (camX & 15), ty * 16 - (camY & 15));
    }
  } else if (mode === "kao") {          // 具名頭像 (KAO #0..127)
    for (let i = 0; i < 40; i++) { const n = idx + i; if (n >= 128) break; kao.drawNamed(scr, n, (i % 8) * 10 + 1, Math.floor(i / 8) * 80); }
  } else if (mode === "kaos") {         // 發現物圖 (KAO #128..255)
    for (let i = 0; i < 77; i++) { const n = idx + i; if (n >= 128) break; kao.drawItem(scr, n, (i % 11) * 7 + 1, Math.floor(i / 11) * 56 + 4); }
  } else if (mode === "kaoc") {         // 拼合頭像: 編號 = 種類 (0..6); 每列只改變一個部件
    const t = idx % 7;
    PARTS.forEach((P, row) => {
      const shift = [0, 3, 8, 6, 11][row];
      for (let v = 0; v < P.n; v++) kao.drawComposed(scr, t, 0xc000 | (v << shift), v * 10 + 1, row * 80);
    });
  } else if (mode === "chip") {
    const ts = sets[idx % 7]; scr.blit(ts, 0, 0, ts.w, ts.h, 0, 0);
  } else if (mode === "win") {
    scr.clear(1);
    win.frame(1, 8, 24, 120, 0); con.print("外框 0");
    win.frame(27, 8, 24, 120, 1); con.print("外框 1");
    win.frame(53, 8, 24, 120, 2); con.print("外框 2");
    win.shadowed(6, 160, 40, 96, idx % 3); con.print("陰影視窗");
    win.padded(50, 180, 26, 160, idx % 3);
    for (const m of [0, 1, 2, 3, 4]) { con.puts(Uint8Array.of(0x1b, 0x42, 0x30, 0x1b, 0x4d, 0x30 + m, 0x1b, 0x43, 0x32 + m, 0)); con.print("模式" + m + "\n"); }
  } else if (mode === "graph") {
    const fn = $("gfile").value;
    gfiles[fn] ??= await loadBinary(`${A}/gfx/${fn}`);
    const dat = gfiles[fn], offs = graphOffsets(dat), n = Math.min(idx, offs.length - 1);
    const next = n + 1 < offs.length ? offs[n + 1] : dat.length;
    // 開發檢視用: 以「16 色版本解碼長度是否剛好等於資料長度」判斷格式 (遊戲本身依呼叫點決定)
    const trial = new Uint8Array(640 * 400), is16 = decodeGraph(trial, dat, 0, 0, true, offs[n]) === next;
    const { w, h } = graphSize(dat, offs[n]);
    decodeGraph(scr.fb, dat, 0, 0, is16, offs[n]);
    scr.dirty = true;
    $("ginfo").textContent = `${fn} #${n}/${offs.length - 1}  ${w}x${h}  ${is16 ? "16色" : "8色"}`;
  } else if (mode === "event") {        // 劇情插圖: 和遊戲一樣畫在大框 (視窗 3) 裡的 (112, 24); EVENT{主角+1}.DAT 由劇本命令 CB 使用
    const fn = $("efile").value, k = +fn[5];
    gfiles["event/" + fn] ??= await loadBinary(`${A}/gfx/event/${fn}`);
    const dat = gfiles["event/" + fn], offs = graphOffsets(dat), n = Math.min(idx, offs.length - 1);
    const next = n + 1 < offs.length ? offs[n + 1] : dat.length;
    scr.clear(1);
    win.frame(0x0d, 0x10, 0x1a, 0xa0, 0);
    const end = decodeGraph(scr.fb, dat, 112, 24, true, offs[n]);
    scr.dirty = true;
    texts["snrdoc" + k] ??= k ? await loadJSON(`${A}/scenario/snr${k}.json`) : { chapters: [] };
    const uses = [];
    texts["snrdoc" + k].chapters.forEach((ch, ci) => ch && ch.sections.forEach((sec, si) => sec && sec.code.forEach(i => { if (i.k === "picture" && i.pic === n) uses.push(`章${ci}節${si} PC${i.at}`); })));
    const { w, h } = graphSize(dat, offs[n]);
    $("ginfo").textContent = `${fn} #${n}/${offs.length - 1}  ${w}x${h}  資料 ${end === next ? "剛好用完" : "長度不符 " + end + "/" + next}  ` +
      (k ? `SNR${k} 使用: ${uses.join(", ") || "無"}` : "(沒有劇本使用 EVENT0)");
  } else if (mode === "text") {
    const f = $("tfile").value;
    texts[f] ??= await loadJSON(`${A}/text/${f}.json`);
    con.lineH = 18; con.fg = 7;
    for (let i = idx; i < texts[f].length && con.y < SCREEN_H - 36; i++) {
      con.left = 0; con.x = 0; con.fg = 7; con.print(String(i).padStart(4, " ") + " ");
      con.left = 5; con.fg = 15 & 7; con.print(texts[f][i].replace(/\{00\}$/, "")); con.x = 1; con.newline();
    }
  } else if (mode === "font") {
    for (let i = 0; i < 39 * 24; i++) {
      const e = font.cm.table[idx * 64 + i]; if (!e) break;
      con.x = (i % 39) * 2; con.y = Math.floor(i / 39) * 16; con.drawChar(e[0]);
    }
  }
  scr.present();
}
for (const id of ["mode", "idx", "pal", "tfile", "gfile", "efile"]) $(id).onchange = draw;
addEventListener("keydown", e => {
  const s = 16;
  if (e.code === "ArrowLeft") camX = Math.max(0, camX - s);
  else if (e.code === "ArrowRight") camX = Math.min(96 * 16 - SCREEN_W, camX + s);
  else if (e.code === "ArrowUp") camY = Math.max(0, camY - s);
  else if (e.code === "ArrowDown") camY = Math.min(96 * 16 - SCREEN_H, camY + s);
  else if (e.code === "PageDown") $("idx").value = +$("idx").value + 1;
  else if (e.code === "PageUp") $("idx").value = Math.max(0, +$("idx").value - 1);
  else return;
  e.preventDefault(); draw();
});
draw();
