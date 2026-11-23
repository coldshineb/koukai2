// dev/data.js — 遊戲資料檢視器 (開發用): 新遊戲初值或 KOUKAI2.DAT 任一格, 依 schema 分表顯示
import { loadJSON, loadBinary } from "../src/core/assets.js";
import { TextCodec, decodeState } from "../src/game/data.js";

const A = "../assets", $ = id => document.getElementById(id);
const [schema, charmap, world, names] = await Promise.all([loadJSON(A + "/data/schema.json"), loadJSON(A + "/font/charmap.json"), loadJSON(A + "/data/world.json"), loadJSON(A + "/data/names.json")]);
const codec = new TextCodec(charmap);
const save = await loadBinary(A + "/save/KOUKAI2.DAT").catch(() => null);
if (save) for (let i = 0; i < 10; i++) if (save[1 + i * 15]) $("src").add(new Option(`KOUKAI2.DAT 第 ${i + 1} 格 ${codec.decode(save.subarray(1 + i * 15, 1 + i * 15 + 11))}`, i));
let data = world, cur = "globals";
const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const fmt = v => Array.isArray(v) ? (typeof v[0] === "object" ? v.map(r => r.ship ?? "?").join(",") : v.join(",")) : v;
function lookup(f, v) {        // 參照欄位顯示對應名稱
  if (v === 0xff || v === 0xfe || f.ref == null) return "";
  const t = data.tables[f.ref]; if (!t || !t[v]) return "";
  const r = t[v]; return r.name ?? (r.givenName ? r.givenName + "•" + r.familyName : "");
}
function show() {
  const m = $("main");
  if (cur === "globals") {
    m.innerHTML = `<h3>全域變數</h3><table><tr><th>名稱</th><th>DS</th><th>值</th><th>依據</th></tr>` +
      schema.globals.map(g => `<tr><td>${g.name}</td><td>${g.ds.toString(16)}</td><td>${data.globals[g.name]}</td><td>${esc(g.evidence)}</td></tr>`).join("") + "</table>";
    return;
  }
  if (cur.startsWith("names:")) {
    const n = names[cur.slice(6)];
    m.innerHTML = `<h3>${cur.slice(6)} (DS:${n.ds})</h3><table>` + n.items.map((s, i) => `<tr><td>${i}</td><td>${esc(s)}</td></tr>`).join("") + "</table>";
    return;
  }
  const t = schema.tables.find(t => t.name === cur), rows = data.tables[cur];
  const cols = Object.keys(rows[0]);
  const fdef = Object.fromEntries(t.fields.map(f => [f.name, f]));
  m.innerHTML = `<h3>${t.name}  DS:${t.ds.toString(16)}  ${t.count} × ${t.stride.toString(16)}h  (${t.accessor})</h3>` +
    `<div class="note">${esc(t.note ?? "")}\n` + t.fields.map(f => `+${f.off.toString(16)} ${f.name}: ${esc(f.evidence)} [${f.confidence}]`).join("\n") + "</div>" +
    `<table><tr><th>#</th>${cols.map(c => `<th>${c}</th>`).join("")}</tr>` +
    rows.map((r, i) => `<tr><td>${i}</td>${cols.map(c => {
      const f = fdef[c], v = r[c], extra = f ? lookup(f, v) : "";
      return `<td class="${c.startsWith("u_") || c.endsWith("Tail") ? "u" : ""}">${esc(fmt(v))}${extra ? " " + esc(extra) : ""}</td>`;
    }).join("")}</tr>`).join("") + "</table>";
}
function list() {
  const items = [["globals", "全域變數"], ...schema.tables.map(t => [t.name, `${t.name} (${t.count})`]), ...Object.keys(names).map(k => ["names:" + k, "名稱表 " + k])];
  $("list").innerHTML = items.map(([k, l]) => `<button data-k="${k}" class="${k === cur ? "on" : ""}">${l}</button>`).join("");
  $("list").querySelectorAll("button").forEach(b => b.onclick = () => { cur = b.dataset.k; list(); show(); });
}
$("src").onchange = () => {
  const v = $("src").value;
  data = v === "world" ? world : decodeState(save.subarray(0x97 + v * 0x8074, 0x97 + (+v + 1) * 0x8074), schema, codec);
  show();
};
list(); show();
