// assets.js — 載入提取後的資源 (索引 PNG / JSON)
const cache = new Map();

export async function loadBinary(url) {
  if (cache.has(url)) return cache.get(url);
  const p = fetch(url).then(r => { if (!r.ok) throw new Error(url + " " + r.status); return r.arrayBuffer(); }).then(b => new Uint8Array(b));
  cache.set(url, p); return p;
}

export async function loadJSON(url) {
  if (cache.has(url)) return cache.get(url);
  const p = fetch(url).then(r => { if (!r.ok) throw new Error(url + " " + r.status); return r.json(); });
  cache.set(url, p); return p;
}

async function loadImageData(url) {
  const img = new Image(); img.src = url; await img.decode();
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
  const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, img.width, img.height);
}

// 索引圖: PNG 灰階值 = 索引*17
export async function loadIndexed(url) {
  if (cache.has(url)) return cache.get(url);
  const p = loadImageData(url).then(id => {
    const d = new Uint8Array(id.width * id.height);
    for (let i = 0; i < d.length; i++) d[i] = Math.round(id.data[i * 4] / 17);
    return { w: id.width, h: id.height, data: d };
  });
  cache.set(url, p); return p;
}

// 1bit 點陣圖 (字型): 白=1
export async function loadBitmap(url) {
  if (cache.has(url)) return cache.get(url);
  const p = loadImageData(url).then(id => {
    const d = new Uint8Array(id.width * id.height);
    for (let i = 0; i < d.length; i++) d[i] = id.data[i * 4] > 127 ? 1 : 0;
    return { w: id.width, h: id.height, data: d };
  });
  cache.set(url, p); return p;
}

export function b64bytes(s) {
  const bin = atob(s); const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
