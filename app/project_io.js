/* ============================================================
   字面工房 — 工程存档

   · 自动存档：工程（歌词 / 风格 / 编排 / 时间 / 素材片段）每几秒写进 localStorage，
     图片数据写进 IndexedDB；下次打开自动接着上次。
   · 下载工程：存成一个 .json（图片以 dataURL 内含），换电脑 / 换浏览器打开也能还原。
   · 打开工程：选 .json → 写进存档 → 重载页面 → 直接接着做。
   ============================================================ */
(() => {
'use strict';
const LS = 'studio.proj.v1';
const DB = 'studio-db', STORE = 'kv';
const $ = s => document.querySelector(s);

/* ───── 开机前：把上次的工程读出来，交给 app/studio.js 的 boot() ───── */
let restore = null;
try {
  const raw = localStorage.getItem(LS);
  if (raw) restore = JSON.parse(raw);
} catch (e) {}
window.__RESTORE__ = (restore && restore.project) ? restore : null;

/* ───── IndexedDB：只放图片（dataURL），体积大 ───── */
function openDB() {
  return new Promise((res, rej) => {
    let r;
    try { r = indexedDB.open(DB, 1); } catch (e) { return rej(e); }
    r.onupgradeneeded = () => { try { r.result.createObjectStore(STORE); } catch (e) {} };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(key) {
  try {
    const db = await openDB();
    return await new Promise((res) => {
      const t = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      t.onsuccess = () => res(t.result);
      t.onerror = () => res(null);
    });
  } catch (e) { return null; }
}
async function idbSet(key, val) {
  try {
    const db = await openDB();
    return await new Promise((res) => {
      const t = db.transaction(STORE, 'readwrite').objectStore(STORE).put(val, key);
      t.onsuccess = () => res(true);
      t.onerror = () => res(false);
    });
  } catch (e) { return false; }
}

/* ───── 图片 → dataURL（缩到最长边 1400，够用又不至于太大） ───── */
function assetData(a) {
  if (!a || a.kind === 'video' || !a.img) return null;
  const iw = a.iw || a.img.naturalWidth || a.img.width || 1200;
  const ih = a.ih || a.img.naturalHeight || a.img.height || 1200;
  const k = Math.min(1, 1400 / Math.max(iw, ih));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(iw * k));
  c.height = Math.max(1, Math.round(ih * k));
  try {
    const x = c.getContext('2d');
    x.drawImage(a.img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  } catch (e) { return null; }
}

function collectAssets() {
  const out = [];
  const S = window.STUDIO;
  if (!S || !S.assets) return out;
  for (const id in S.assets) {
    const a = S.assets[id];
    if (!a) continue;
    const data = assetData(a);
    if (data) out.push({ id, kind: a.kind || 'image', iw: a.iw, ih: a.ih, total: a.total, data });
  }
  return out;
}

/* ───── 存 / 恢复 ───── */
let lastSig = '';

function snapshot() {
  const S = window.STUDIO;
  if (!S || !S.api || !S.api.projectSnapshot) return null;
  return S.api.projectSnapshot();
}

async function save(auto) {
  const snap = snapshot();
  if (!snap) return false;
  const sig = JSON.stringify(snap.project).length + '/' + snap.media.length + '/' + Object.keys(window.STUDIO.assets || {}).length;
  if (auto && sig === lastSig) return false;
  lastSig = sig;
  try { localStorage.setItem(LS, JSON.stringify(snap)); } catch (e) {}
  await idbSet('assets', collectAssets());
  const f = window.STUDIO.audioFile;
  if (f) { try { await idbSet('audio', { name: f.name, type: f.type, buf: await f.arrayBuffer() }); } catch (e) {} }
  stamp(snap.at);
  return true;
}

const fileToDataURL = f => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(f); });

/* 下载成文件（图片一起打包） */
async function download() {
  const snap = snapshot();
  if (!snap) return;
  if (!window.ZIP) { toast('打包模块没加载，先刷新一次页面'); return; }
  const S = window.STUDIO;
  const assets = collectAssets();
  const f = S.audioFile;
  const pack = JSON.parse(JSON.stringify(snap));
  pack.app = 'TCG-PV工厂';
  pack.kind = 'project';
  pack.assets = assets.map(a => ({ id: a.id, kind: a.kind, iw: a.iw, ih: a.ih, total: a.total, file: 'img/' + a.id + '.png' }));
  pack.audio = f ? { name: f.name, file: 'audio/' + f.name } : null;
  pack.lyricsFile = '字幕/歌词.txt';
  const enc = new TextEncoder();
  const files = [{ name: '工程.json', data: enc.encode(JSON.stringify(pack)) }];
  for (const a of assets) files.push({ name: 'img/' + a.id + '.png', data: window.ZIP.dataURLBytes(a.data) });
  if (f) { try { files.push({ name: 'audio/' + f.name, data: new Uint8Array(await f.arrayBuffer()) }); } catch (e) {} }
  files.push({ name: '字幕/歌词.txt', data: enc.encode(S.project.lyrics || '') });
  const bytes = window.ZIP.zip(files);
  const blob = new Blob([bytes], { type: 'application/zip' });
  const a = document.createElement('a');
  const d = new Date();
  const name = 'TCG-PV工程_' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '_' +
    String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + '.zip';
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  toast('已打包：' + name + '（' + Math.round(bytes.length / 1024) + ' KB，含音频 / 图片 / 字幕）');
}

/* 打开文件：写进存档后重载，boot() 会直接按这份工程起来 */
async function openFile(file) {
  try {
    let pack = null;
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (head[0] === 0x50 && head[1] === 0x4B) {              // zip 工程包：解包 + 把图片/音频还原成 dataURL
      const entries = window.ZIP.unzip(new Uint8Array(await file.arrayBuffer()));
      const main = entries['工程.json'];
      if (!main) throw new Error('包里没有 工程.json');
      pack = JSON.parse(new TextDecoder().decode(main));
      pack.assets = (pack.assets || []).map(a => {
        const e = entries[a.file];
        return e ? Object.assign({}, a, { data: 'data:image/png;base64,' + window.ZIP.bytesB64(e) }) : a;
      });
      if (pack.audio && entries[pack.audio.file]) {
        const ext = (pack.audio.file.split('.').pop() || 'wav').toLowerCase();
        pack.audio = { name: pack.audio.name, data: 'data:audio/' + ext + ';base64,' + window.ZIP.bytesB64(entries[pack.audio.file]) };
      }
    } else {
      pack = JSON.parse(await file.text());
    }
    if (!pack || !pack.project) throw new Error('不是工程文件');
    localStorage.setItem(LS, JSON.stringify({ v: 1, at: Date.now(), project: pack.project, media: pack.media || [] }));
    await idbSet('assets', pack.assets || []);
    if (pack.audio && pack.audio.data) {                 // 音频也一起带走
      try {
        const blob = await (await fetch(pack.audio.data)).blob();
        await idbSet('audio', { name: pack.audio.name || '音频', type: blob.type || 'audio/wav', buf: await blob.arrayBuffer() });
      } catch (e) {}
    }
    toast('正在打开工程…');
    setTimeout(() => location.reload(), 400);
  } catch (e) {
    toast('打不开：' + (e && e.message || e));
  }
}

/* 把 IndexedDB 里的图片补回内存（开机后跑一次） */
async function hydrate() {
  const S = window.STUDIO;
  if (!S || !S.api) return;
  const list = await idbGet('assets');
  const imgs = Array.isArray(list) ? list : [];
  let n = 0;
  for (const a of imgs) {
    if (!a || !a.data) continue;
    const img = new Image();
    img.src = a.data;
    S.assets[a.id] = { id: a.id, kind: a.kind || 'image', img, iw: a.iw, ih: a.ih, total: a.total };
    n++;
  }
  for (const m of S.media) {
    const a = S.assets[m.assetId];
    if (a) { m.img = a.img; m.iw = m.iw || a.iw; m.ih = m.ih || a.ih; }
  }
  if (n) {
    try { S.api.replan(); S.api.syncMediaList(); S.api.syncMediaState(); } catch (e) {}
    toast('已恢复上次的工程 · ' + n + ' 张素材');
  }
  // 音频：从存档里取回原文件，走一遍正常的载入流程（BPM / 波形 / 卡点都回来）
  const au = await idbGet('audio');
  if (au && au.buf) {
    try {
      const file = new File([au.buf], au.name || '音频', { type: au.type || 'audio/wav' });
      await S.api.loadAudioFile(file);
      toast('已恢复工程音频 · ' + (au.name || ''));
    } catch (e) { console.warn('audio restore', e); }
  }
}

/* ───── 界面 ───── */
function stamp(t) {
  const el = $('#projAt');
  if (!el) return;
  const d = new Date(t || Date.now());
  el.textContent = '已存 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
}

function toast(msg) {
  const S = window.STUDIO;
  if (S && S.api && S.api.toast) S.api.toast(msg);
  else console.log(msg);
}

function bind() {
  const btn = $('#btnProjSave');
  if (btn) btn.onclick = download;
  const inp = $('#projFile');
  const openBtn = $('#btnProjOpen');
  if (openBtn && inp) openBtn.onclick = () => inp.click();
  if (inp) inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) openFile(f); inp.value = ''; };
  const clr = $('#btnProjClear');
  if (clr) clr.onclick = () => {
    if (!confirm('清空当前工程？会回到内置示例（存档也会删掉）')) return;
    try { localStorage.removeItem(LS); } catch (e) {}
    idbSet('assets', []);
    location.reload();
  };
  stamp(restore && restore.at);
}

/* 自动存档：每 3 秒比对一次，有变化就写 */
function autosaveLoop() {
  setInterval(() => { save(true).catch(() => {}); }, 3000);
  window.addEventListener('beforeunload', () => { try { save(true); } catch (e) {} });
}

function bootIo() {
  bind();
  hydrate();
  autosaveLoop();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(bootIo, 600));
else setTimeout(bootIo, 600);
})();
