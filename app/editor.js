/* ============================================================
   字面工房 · 剪辑台（NLE）
   ------------------------------------------------------------
   把「字面 PV」的引擎变成一个真正的剪辑器：

   · 文档模型：多轨道 + 片段（文字 / 图片 / 视频 / 音频 / PV 层）
   · 时间线：拖拽、裁切、分割、波纹删除、吸附、缩放、框选、转场
   · 合成器：视频 / 图片 / 文字（引擎渲染，带手法库动画）/ 关键帧
   · 音频：多轨预览播放 + 离线混音导出
   · 导出：WebCodecs MP4（H.264 + AAC），可取消、带进度
   · 存档：localStorage（文档）+ IndexedDB（素材二进制）

   依赖：engine/*.js（J）、vendor/mp4-muxer.min.js、app/labels_zh.js
   ============================================================ */
(() => {
'use strict';

/* ───────────────────────── 小工具 ───────────────────────── */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, k) => a + (b - a) * k;
const rnd = (n) => Math.random().toString(36).slice(2, 2 + n);
const uid = (p) => (p || 'c') + '_' + Date.now().toString(36).slice(-4) + rnd(4);
const isNum = (v) => typeof v === 'number' && isFinite(v);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));

/* 时间码：00:00.000 */
function tc(t, withMs) {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60), s = t - m * 60;
  return String(m).padStart(2, '0') + ':' + (s < 10 ? '0' : '') + (withMs === false ? Math.floor(s).toString().padStart(2, '0') : s.toFixed(3).padStart(6, '0'));
}
/* 时间码 → 秒：支持 1:23.4 / 83.4 / 00:01:23 */
function tcParse(str) {
  const s = String(str || '').trim();
  if (!s) return 0;
  const parts = s.split(':').map(p => parseFloat(p) || 0);
  if (parts.length === 1) return Math.max(0, parts[0]);
  if (parts.length === 2) return Math.max(0, parts[0] * 60 + parts[1]);
  return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
}
function durTxt(d) {
  d = Math.max(0, d || 0);
  if (d < 60) return d.toFixed(d < 10 ? 1 : 1) + 's';
  return Math.floor(d / 60) + '分' + String(Math.round(d % 60)).padStart(2, '0') + '秒';
}
const easeFns = {
  linear: k => k,
  inout: k => k * k * (3 - 2 * k),
  out: k => 1 - Math.pow(1 - k, 3),
  in: k => k * k * k,
  back: k => { const c = 1.70158; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); },
  hold: k => 0,
};
const ease = (name, k) => (easeFns[name] || easeFns.inout)(clamp(k, 0, 1));

/* 片段类型 → 颜色 */
const KIND = {
  text: { c: '#5b8cff', c2: '#3f65d8', label: '文字', ic: '文' },
  video: { c: '#a855f7', c2: '#7c3aed', label: '视频', ic: '▶' },
  image: { c: '#f5a524', c2: '#c47f0d', label: '图片', ic: '▣' },
  audio: { c: '#22c55e', c2: '#148a45', label: '音频', ic: '♫' },
  pv: { c: '#ff4d8d', c2: '#d02a66', label: 'PV 层', ic: '✦' },
};
const BLENDS = ['normal', 'screen', 'multiply', 'overlay', 'soft-light', 'hard-light', 'color-dodge', 'difference', 'luminosity'];
const TRANS_LIST = [
  ['none', '无'], ['fade', '淡入'], ['dissolve', '溶解'], ['dip', '黑场过渡'], ['white', '白闪'],
  ['slideL', '左滑入'], ['slideR', '右滑入'], ['slideU', '上滑入'], ['slideD', '下滑入'],
  ['wipeL', '左擦除'], ['wipeR', '右擦除'], ['iris', '圆形展开'], ['zoomIn', '推近淡入'],
  ['zoomOut', '拉远淡入'], ['blurIn', '模糊淡入'], ['whip', '急甩'], ['flash', '闪光切入'],
];

/* ───────────────────────── 全局状态 ───────────────────────── */
const ED = {
  open: false,
  doc: null,
  sel: [],                  // 选中的 clip id（多选）
  t: 0,
  playing: false,
  assets: {},               // id → { id, kind, name, blob, url, img, el, dur, w, h, peaks }
  assetSeq: 0,
  pps: 70,                  // 时间线缩放 px/秒
  snap: true,
  snapBeat: false,
  kfEase: 'inout',
  kfAuto: false,
  hist: { stack: [], i: -1, limit: 80 },
  dur: 60,
  designW: 1920, designH: 1080,
  outW: 1920, outH: 1080,
  previewScale: 1,          // 监视器显示比例
  quality: 'high',
  renderer: null,
  dirty: false,
  clipboard: null,
  tlDrag: null,
  mkSel: null,
  snapGuide: null,
  snapLabel: '',
  menuAt: null,
  exportAbort: null,
  exporting: false,
  lastFrame: 0,
  volume: 0.9,
  loop: false,
  loopStarted: false,
};
window.ED = ED;

const LS_DOC = 'studio.editor.doc.v1';
const LS_PREF = 'studio.editor.pref.v1';
const DB_NAME = 'studio-edit-db';
const DB_STORE = 'assets';

/* ───────────────────────── 文档模型 ───────────────────────── */
function trackDef(kind, name, h) {
  return { id: uid('trk'), kind, name: name || KIND[kind].label, h: h || (kind === 'audio' ? 42 : kind === 'text' ? 48 : 56), mute: false, hide: false, lock: false, vol: 1 };
}
function newDoc() {
  return {
    v: 1,
    name: '未命名剪辑',
    aspect: '16:9', res: 1080, fps: 30,
    bg: '#0d1017',
    bgStyle: 'solid',
    style: 'noir',
    lang: 'zh-Hans',
    bpm: 96,
    tracks: [
      trackDef('text', '文字'),
      trackDef('video', '视频'),
      trackDef('video', '画中画'),
      trackDef('audio', '音乐'),
      trackDef('audio', '音效'),
    ],
    clips: [],
    markers: [],
    inPoint: 0,
    outPoint: 0,
  };
}
function defaultClip(kind, patch) {
  const base = {
    id: uid(kind), track: '', kind,
    asset: null, name: '',
    start: 0, dur: kind === 'audio' ? 8 : 4, in: 0, speed: 1,
    x: 0, y: 0, scale: 1, rot: 0, opacity: 1, blend: 'normal', fit: 'cover',
    f: { b: 1, c: 1, s: 1, hue: 0, blur: 0, sepia: 0 },
    vol: 1, fadeIn: 0, fadeOut: 0,
    transIn: { type: 'none', dur: 0.45 },
    transOut: { type: 'none', dur: 0.45 },
    kf: { x: [], y: [], scale: [], rot: [], opacity: [], vol: [] },
    text: '', style: '', font: '', sizeScale: 1,
    solid: null,
    fx: { layout: 'center', enter: 'cut', hold: 'still', exit: 'cut', treat: 'none', bg: 'none', cam: 'push', decor: [] },
    inDur: 0, outDur: 0,
    pv: null,
  };
  return Object.assign(base, patch || {});
}
/* 可视轨道顺序：tracks 数组从上到下；合成时从下往上画 */
const visualTracks = () => (ED.doc ? ED.doc.tracks : []).slice().reverse().filter(t => t.kind !== 'audio');
const audioTracks = () => (ED.doc ? ED.doc.tracks : []).filter(t => t.kind === 'audio');

function trackById(id) { return ED.doc.tracks.find(t => t.id === id) || null; }
function clipById(id) { return (ED.doc && ED.doc.clips.find(c => c.id === id)) || null; }
function selClips() { return ED.sel.map(clipById).filter(Boolean); }
function selClip() { return ED.sel.length === 1 ? clipById(ED.sel[0]) : null; }
const isAudio = (c) => !!c && c.kind === 'audio';
const isVisual = (c) => !!c && c.kind !== 'audio';
const clipEnd = (c) => c.start + c.dur;

function recalcDur() {
  let maxEnd = 0;
  for (const c of ED.doc.clips) maxEnd = Math.max(maxEnd, clipEnd(c));
  ED.dur = Math.max(24, Math.ceil(maxEnd + 6));
  ED.doc.duration = maxEnd;
  if (ED.t > ED.dur) ED.t = Math.max(0, ED.dur - 1);
}
function designSizes() {
  const [dw, dh] = J.designSize(ED.doc.aspect);
  ED.designW = dw; ED.designH = dh;
  const [ow, oh] = J.outputSize({ aspect: ED.doc.aspect, res: ED.doc.res });
  ED.outW = ow; ED.outH = oh;
}
function timelineEnd() {
  let m = 0;
  for (const c of ED.doc.clips) m = Math.max(m, clipEnd(c));
  return Math.max(m, 1 / ED.doc.fps);
}

/* ───────────────────────── 撤销 / 重做 ───────────────────────── */
function snapshot(label) {
  const snap = { doc: clone(ED.doc), sel: ED.sel.slice(), t: ED.t, label: label || '' };
  const h = ED.hist;
  if (h.i >= 0 && h.stack[h.i] && h.stack[h.i].label === '编辑中') h.stack.pop();
  else if (h.i < h.stack.length - 1) h.stack = h.stack.slice(0, h.i + 1);
  h.stack.push(snap);
  if (h.stack.length > h.limit) h.stack.shift();
  h.i = h.stack.length - 1;
  syncHistButtons();
  markDirty();
}
function restoreSnap(s) {
  if (!s) return;
  ED.doc = clone(s.doc);
  ED.sel = (s.sel || []).filter(clipById);
  ED.t = clamp(s.t || 0, 0, ED.dur);
  designSizes(); recalcDur();
  syncDocInputs(); renderBinInsp(); requestRedraw(); drawTimeline();
}
function undo() {
  const h = ED.hist;
  if (h.i <= 0) return toast('没有可撤销的操作');
  h.i--; restoreSnap(h.stack[h.i]); syncHistButtons(); markDirty();
  toast('已撤销');
}
function redo() {
  const h = ED.hist;
  if (h.i >= h.stack.length - 1) return toast('没有可重做的操作');
  h.i++; restoreSnap(h.stack[h.i]); syncHistButtons(); markDirty();
  toast('已重做');
}
function syncHistButtons() {
  const h = ED.hist;
  const a = $('#edUndo'), b = $('#edRedo');
  if (a) a.disabled = h.i <= 0;
  if (b) b.disabled = h.i >= h.stack.length - 1;
}
let dirtyTimer = 0;
function markDirty() {
  ED.dirty = true;
  clearTimeout(dirtyTimer);
  dirtyTimer = setTimeout(() => { saveLocal(); ED.dirty = false; }, 900);
}

/* ───────────────────────── 本地存档 ───────────────────────── */
function saveLocal() {
  if (!ED.doc) return;
  try {
    const d = clone(ED.doc);
    d.assets = Object.values(ED.assets).map(a => ({ id: a.id, kind: a.kind, name: a.name, dur: a.dur, w: a.w, h: a.h }));
    localStorage.setItem(LS_DOC, JSON.stringify(d));
    localStorage.setItem(LS_PREF, JSON.stringify({ pps: ED.pps, snap: ED.snap, snapBeat: ED.snapBeat, volume: ED.volume }));
  } catch (e) { /* 配额满了也不能影响编辑 */ }
}
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(LS_PREF) || '{}');
    if (isNum(p.pps)) ED.pps = clamp(p.pps, 12, 420);
    if (p.snap != null) ED.snap = !!p.snap;
    if (p.snapBeat != null) ED.snapBeat = !!p.snapBeat;
    if (isNum(p.volume)) ED.volume = clamp(p.volume, 0, 1);
  } catch (e) {}
}

/* IndexedDB：素材二进制 */
function idbOpen() {
  return new Promise((res, rej) => {
    let r;
    try { r = indexedDB.open(DB_NAME, 1); } catch (e) { return rej(e); }
    r.onupgradeneeded = () => { try { r.result.createObjectStore(DB_STORE); } catch (e) {} };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbPut(key, val) {
  try {
    const db = await idbOpen();
    return await new Promise((res) => {
      const t = db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).put(val, key);
      t.onsuccess = () => res(true); t.onerror = () => res(false);
    });
  } catch (e) { return false; }
}
async function idbGet(key) {
  try {
    const db = await idbOpen();
    return await new Promise((res) => {
      const t = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
      t.onsuccess = () => res(t.result || null); t.onerror = () => res(null);
    });
  } catch (e) { return null; }
}
async function idbDel(key) {
  try {
    const db = await idbOpen();
    return await new Promise((res) => {
      const t = db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).delete(key);
      t.onsuccess = () => res(true); t.onerror = () => res(false);
    });
  } catch (e) { return false; }
}
async function idbAll() {
  try {
    const db = await idbOpen();
    return await new Promise((res) => {
      const t = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).getAllKeys();
      t.onsuccess = () => res(t.result || []); t.onerror = () => res([]);
    });
  } catch (e) { return []; }
}

/* ───────────────────────── 素材加载 ───────────────────────── */
function assetKindOf(file) {
  const t = (file.type || '').toLowerCase();
  const n = (file.name || '').toLowerCase();
  if (t.startsWith('video/') || /\.(mp4|webm|mov|m4v|mkv|avi)$/.test(n)) return 'video';
  if (t.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/.test(n)) return 'audio';
  if (t.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif|bmp|svg)$/.test(n)) return 'image';
  return null;
}
function peaksOf(buffer, n) {
  const ch = buffer.numberOfChannels;
  const len = buffer.length;
  const buckets = Math.max(64, n || 900);
  const out = new Float32Array(buckets);
  const step = Math.max(1, Math.floor(len / buckets));
  for (let c = 0; c < ch; c++) {
    const d = buffer.getChannelData(c);
    for (let b = 0; b < buckets; b++) {
      const s0 = b * step, s1 = Math.min(len, s0 + step);
      let mx = 0;
      for (let i = s0; i < s1; i += 2) { const v = Math.abs(d[i]); if (v > mx) mx = v; }
      if (mx > out[b]) out[b] = mx;
    }
  }
  for (let b = 0; b < buckets; b++) out[b] = Math.min(1, Math.pow(out[b], 0.85));
  return out;
}
function videoThumb(el) {
  return new Promise((res) => {
    try {
      const w = 320, h = Math.max(2, Math.round(w * (el.videoHeight || 9) / (el.videoWidth || 16)));
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const x = cv.getContext('2d');
      const draw = () => { try { x.drawImage(el, 0, 0, w, h); res(cv.toDataURL('image/jpeg', 0.7)); } catch (e) { res(null); } };
      if (el.readyState >= 2) draw();
      else {
        const once = () => { el.removeEventListener('loadeddata', once); try { el.currentTime = Math.min(0.15, (el.duration || 1) * 0.05); } catch (e) {} draw(); };
        el.addEventListener('loadeddata', once, { once: true });
        setTimeout(draw, 2500);
      }
    } catch (e) { res(null); }
  });
}
async function addAsset(blob, name, opts) {
  const kind = (opts && opts.kind) || assetKindOf({ type: blob.type, name });
  if (!kind) return null;
  const id = (opts && opts.id) || 'as_' + Date.now().toString(36) + rnd(4);
  const a = { id, kind, name: name || (kind === 'audio' ? '音频' : kind === 'video' ? '视频' : '图片'), blob, url: URL.createObjectURL(blob), dur: 0, w: 0, h: 0, peaks: null, thumb: null };
  try {
    if (kind === 'image') {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = a.url; });
      a.img = img; a.w = img.naturalWidth || 1280; a.h = img.naturalHeight || 720; a.dur = 4; a.thumb = a.url;
    } else if (kind === 'video') {
      const v = document.createElement('video');
      v.src = a.url; v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
      await new Promise((res) => { v.addEventListener('loadedmetadata', res, { once: true }); v.addEventListener('error', res, { once: true }); setTimeout(res, 8000); });
      a.el = v; a.w = v.videoWidth || 1280; a.h = v.videoHeight || 720; a.dur = isFinite(v.duration) ? v.duration : 5;
      a.thumb = await videoThumb(v);
    } else if (kind === 'audio') {
      const ctx = audioCtx();
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
      a.buf = buf; a.dur = buf.duration; a.peaks = peaksOf(buf, 1200); a.w = 0; a.h = 0;
    }
  } catch (e) { console.warn('素材读取失败', name, e); }
  if (!a.dur) a.dur = kind === 'audio' || kind === 'video' ? 5 : 4;
  ED.assets[id] = a;
  await idbPut(id, { blob, name: a.name, kind });
  return a;
}
async function addFiles(files, opts) {
  const list = [...files].filter(f => assetKindOf(f));
  if (!list.length) return [];
  list.sort((x, y) => x.name.localeCompare(y.name, 'zh-Hans-CN', { numeric: true }));
  const out = [];
  for (const f of list) {
    toast('读取 ' + f.name + ' …');
    const a = await addAsset(f, f.name, opts);
    if (a) out.push(a);
  }
  renderBin();
  if (out.length) toast('已导入 ' + out.length + ' 个素材');
  return out;
}

/* 从工程文件 / dataURL 恢复素材 */
async function restoreAssets() {
  const metas = ED.doc.assets || [];
  for (const m of metas) {
    if (ED.assets[m.id]) continue;
    const rec = await idbGet(m.id);
    if (!rec || !rec.blob) continue;
    const a = await addAsset(rec.blob, m.name || m.id, { kind: m.kind, id: m.id });
    if (a) ED.assets[m.id] = a;
  }
}
function assetOf(clip) { return clip && clip.asset ? ED.assets[clip.asset] || null : null; }

/* ───────────────────────── 音频上下文 ───────────────────────── */
let _actx = null;
function audioCtx() {
  if (!_actx) _actx = new (window.AudioContext || window.webkitAudioContext)();
  if (_actx.state === 'suspended') _actx.resume().catch(() => {});
  return _actx;
}

/* ───────────────────────── 关键帧 ───────────────────────── */
const KF_PROPS = [
  ['x', '位置 X', 'px'], ['y', '位置 Y', 'px'], ['scale', '缩放', '×'],
  ['rot', '旋转', '°'], ['opacity', '不透明度', '%'], ['vol', '音量', '%'],
];
function kfList(clip, prop) {
  if (!clip.kf) clip.kf = {};
  if (!clip.kf[prop]) clip.kf[prop] = [];
  return clip.kf[prop];
}
function hasKeys(clip, prop) {
  if (!clip.kf) return false;
  if (prop) return !!(clip.kf[prop] && clip.kf[prop].length);
  return Object.values(clip.kf).some(a => a && a.length);
}
function kfTimes(clip) {
  const set = new Set();
  if (clip.kf) for (const k of Object.keys(clip.kf)) for (const f of clip.kf[k]) set.add(+f.t.toFixed(4));
  return [...set].sort((a, b) => a - b);
}
function kfVal(clip, prop, lt, def) {
  const ks = clip.kf && clip.kf[prop];
  if (!ks || !ks.length) return def;
  if (lt <= ks[0].t) return ks[0].v;
  const last = ks[ks.length - 1];
  if (lt >= last.t) return last.v;
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i], b = ks[i + 1];
    if (lt >= a.t && lt <= b.t) {
      const k = (lt - a.t) / Math.max(1e-6, b.t - a.t);
      return lerp(a.v, b.v, ease(a.e || 'inout', k));
    }
  }
  return def;
}
function upsertKey(clip, prop, t, v, e) {
  const ks = kfList(clip, prop);
  t = Math.max(0, Math.min(clip.dur, t));
  const near = ks.findIndex(k => Math.abs(k.t - t) < 0.02);
  if (near >= 0) ks[near] = { t, v, e: e || ks[near].e || ED.kfEase };
  else ks.push({ t, v, e: e || ED.kfEase });
  ks.sort((a, b) => a.t - b.t);
}
function delKeyAt(clip, prop, t) {
  const ks = clip.kf && clip.kf[prop]; if (!ks) return false;
  const i = ks.findIndex(k => Math.abs(k.t - t) < 0.06);
  if (i < 0) return false;
  ks.splice(i, 1);
  return true;
}
function clipProp(clip, prop, lt) {
  if (prop === 'opacity') return kfVal(clip, 'opacity', lt, clip.opacity) * (clip.fadeIn || clip.fadeOut ? 1 : 1);
  if (prop === 'vol') return kfVal(clip, 'vol', lt, clip.vol);
  return kfVal(clip, prop, lt, clip[prop]);
}
/* 片段在本地时间 lt 的最终变换（含关键帧） */
function transformAt(clip, lt) {
  const fadeIn = clip.fadeIn || 0, fadeOut = clip.fadeOut || 0;
  let op = kfVal(clip, 'opacity', lt, clip.opacity);
  if (fadeIn > 0 && lt < fadeIn) op *= lt / fadeIn;
  if (fadeOut > 0 && lt > clip.dur - fadeOut) op *= Math.max(0, (clip.dur - lt) / fadeOut);
  return {
    x: kfVal(clip, 'x', lt, clip.x),
    y: kfVal(clip, 'y', lt, clip.y),
    scale: kfVal(clip, 'scale', lt, clip.scale),
    rot: kfVal(clip, 'rot', lt, clip.rot),
    opacity: clamp(op, 0, 1),
  };
}

/* ============================================================
   文字渲染：把「手法库」变成片段上的动画效果
   ------------------------------------------------------------
   每个文字片段 / PV 片段编译成一张 mini plan，交给 J.Renderer 画到
   透明离屏画布上，再按片段变换合成到主画面。手法库里的
   构图(layout) / 入场(enter) / 停留(hold) / 退场(exit) /
   质感(treat) / 背景(bg) / 镜头(cam) / 装饰(decor) 全部可用。
   ============================================================ */
const planCache = new Map();     // clipId → { key, plan }
const layerCache = new Map();    // clipId → { cv, w, h, key }  可复用的离屏画布

function seedOf(str) { return J.sid(String(str)) >>> 0; }

function buildClipPlan(clip) {
  const W = ED.designW, H = ED.designH;
  const F = clip.fx || {};
  const dur = Math.max(0.2, clip.dur);
  const proj = {
    style: clip.style || ED.doc.style || 'noir',
    aspect: ED.doc.aspect, res: ED.doc.res, fps: ED.doc.fps,
    lang: ED.doc.lang || 'auto',
    fonts: clip.font ? { display: clip.font, serif: clip.font, body: clip.font } : (ED.doc.fonts || {}),
  };
  const st = J.resolveStyle(proj);
  const fx = Object.assign({}, J.defaultProject().fx, {
    motion: 0.7, glitch: 0.32, chroma: 0.26, decor: 0.55, density: 0.55,
    texture: 0.5, flash: true, onTwos: false, koma: 0, motionBlur: 0,
    hud: 'off', bgSwitch: 0, hideNo: false, hideTime: false,
  });
  let text = String(clip.text == null ? '' : clip.text).replace(/\r/g, '');
  if (!text.trim()) text = ' ';
  const F2 = Object.assign({ layout: 'center', enter: 'cut', hold: 'still', exit: 'cut', treat: 'none', bg: 'none', cam: 'push', decor: [], scheme: 0, seed: 1 }, F);
  let layout = J.LAYOUTS[F2.layout] && !J.LAYOUTS[F2.layout].special ? F2.layout : 'center';
  let enter = J.ENTER[F2.enter] ? F2.enter : 'cut';
  let hold = J.HOLD[F2.hold] ? F2.hold : 'still';
  let exit = J.EXIT[F2.exit] ? F2.exit : 'cut';
  if (!J.TREAT[F2.treat]) F2.treat = 'none';
  if (!J.BG[F2.bg]) F2.bg = 'none';
  if (!J.CAMERA[F2.cam]) F2.cam = 'push';
  const n = [...text.replace(/\s+/g, '')].length;
  const seedKey = clip.id + ':' + F2.layout + ':' + F2.seed;
  const rng = J.rng(seedOf(seedKey));
  const LD = J.LAYOUTS[layout];
  let params = {};
  try { params = (LD.plan && LD.plan(rng, { text, n, W, H, dur }, st)) || {}; } catch (e) { params = {}; }
  let inDur = enter === 'cut' ? 0.12 : 0.5;
  try { if (J.ENTER[enter].inDur) inDur = J.ENTER[enter].inDur(dur, n); } catch (e) {}
  let outDur = exit === 'cut' ? 0 : 0.45;
  try { if (J.EXIT[exit].outDur) outDur = J.EXIT[exit].outDur(dur, n); } catch (e) {}
  if (clip.inDur > 0) inDur = clip.inDur;
  if (clip.outDur > 0) outDur = clip.outDur;
  if (inDur + outDur > dur * 0.9) { const k = dur * 0.9 / Math.max(0.1, inDur + outDur); inDur *= k; outDur *= k; }
  const decor = [];
  for (const dk of (F2.decor || [])) {
    if (!J.DECOR[dk]) continue;
    let dp = {};
    try { dp = (J.DECOR[dk].plan && J.DECOR[dk].plan(rng, st)) || {}; } catch (e) {}
    decor.push({ key: dk, P: dp });
  }
  const treatP = (J.TREAT[F2.treat] && J.TREAT[F2.treat].plan) ? (J.TREAT[F2.treat].plan(rng, st) || {}) : {};
  const bgP = (J.BG[F2.bg] && J.BG[F2.bg].plan) ? (J.BG[F2.bg].plan(rng, st) || {}) : {};
  const camP = (J.CAMERA[F2.cam] && J.CAMERA[F2.cam].plan) ? (J.CAMERA[F2.cam].plan(rng, st) || {}) : {};
  const cut = Object.assign({
    hold: 'still', inDur: 0.3, outDur: 0.25, stagger: 0.04, decor: [], params: {},
    scheme: 0, emph: false, words: [], note: null, treat: 'none', treatP: {},
    bg: 'none', bgP: {}, cam: 'push', camP: {},
  }, {
    text, lineText: text, line: 0, start: 0, end: dur,
    layout, enter, hold, exit, inDur, outDur, params, decor,
    scheme: clamp(F2.scheme | 0, 0, Math.max(0, st.schemes.length - 1)),
    seed: J.h(seedOf(seedKey), 9),
    words: J.chunkText ? J.chunkText(text) : [],
    treat: F2.treat, treatP, bg: F2.bg, bgP, cam: F2.cam, camP,
  });
  cut.dur = dur;
  cut.index = 0;
  return {
    version: 1, generator: 'zimian-editor', title: '', artist: '',
    W, H, fps: ED.doc.fps, duration: dur,
    styleKey: proj.style, style: st, fx, lines: [], cuts: [cut],
    events: [], beats: [], hud: false, keyBg: null,
    lang: proj.lang, typeset: true, text: null,
  };
}

/* PV 片段：把主站工程整体当作一层 */
function buildPVPlan(clip) {
  const p = Object.assign(J.defaultProject(), clip.pv || {});
  p.aspect = ED.doc.aspect; p.res = ED.doc.res; p.fps = ED.doc.fps;
  p.genre = null; p.freeLibrary = true;
  p.enabled = p.enabled || {};
  for (const g of J.GROUP_KEYS) { p.enabled[g] = p.enabled[g] || {}; for (const k of J.order(g)) if (p.enabled[g][k] == null) p.enabled[g][k] = true; }
  const plan = J.plan(p, null);
  return plan;
}

function planFor(clip) {
  const isPV = clip.kind === 'pv';
  const key = isPV
    ? 'pv|' + [clip.pv && clip.pv.style, clip.pv && clip.pv.seed, (clip.pv && clip.pv.lyrics || '').length, clip.dur, ED.doc.aspect, ED.doc.fps, clip.pv && clip.pv.timing && clip.pv.timing.bpm].join('|')
    : JSON.stringify([clip.text, clip.style, clip.font, clip.fx, clip.inDur, clip.outDur, clip.dur, ED.doc.aspect, ED.doc.fps, ED.doc.lang, ED.doc.res]);
  const hit = planCache.get(clip.id);
  if (hit && hit.key === key) return hit.plan;
  let plan = null;
  try { plan = isPV ? buildPVPlan(clip) : buildClipPlan(clip); }
  catch (e) { console.error('手法编译失败', clip.name, e); plan = buildClipPlan(Object.assign({}, clip, { fx: { layout: 'center' }, text: clip.text || ' ' })); }
  planCache.set(clip.id, { key, plan });
  if (J.fontsOfPlan && J.ensureFonts) {
    try {
      J.ensureFonts(isPV ? (clip.pv && clip.pv.lyrics) || '字' : clip.text || '字', J.fontsOfPlan(plan))
        .then(() => { layerCache.delete(clip.id); requestRedraw(); })
        .catch(() => {});
    } catch (e) {}
  }
  return plan;
}

/* 把片段渲染成一张（带透明通道的）画布 */
function clipLayer(clip, lt, pw, ph, fast) {
  pw = Math.max(2, Math.round(pw)); ph = Math.max(2, Math.round(ph));
  const plan = planFor(clip);
  const pk = (planCache.get(clip.id) || {}).key || '';
  let rec = layerCache.get(clip.id);
  if (!rec || rec.w !== pw || rec.h !== ph || rec.key !== pk) {
    const cv = document.createElement('canvas'); cv.width = pw; cv.height = ph;
    rec = { cv, w: pw, h: ph, key: pk };
    layerCache.set(clip.id, rec);
  }
  const ctx = rec.cv.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  ctx.clearRect(0, 0, pw, ph);
  const R = ED.renderer || (ED.renderer = new J.Renderer());
  const scale = pw / plan.W;
  const isPV = clip.kind === 'pv';
  try {
    R.frame(ctx, plan, clamp(lt, 0, Math.max(0.001, clip.dur - 0.002)), {
      scale, transparent: !isPV, noHud: true, noMotionBlur: true,
      fast: !!fast, noGhost: !!fast,
    });
  } catch (e) { console.warn('文字渲染失败', e); }
  if (layerCache.size > 14) { for (const k of layerCache.keys()) { if (k !== clip.id) { layerCache.delete(k); break; } } }
  return rec.cv;
}
/* 预热：让手法里用到的字体先量好字宽（避免第一次播放时字跳一下） */
function warmupClip(clip) {
  try { const plan = planFor(clip); if (J.fontsOfPlan && J.ensureFonts) J.ensureFonts(clip.text || '字', J.fontsOfPlan(plan)).catch(() => {}); } catch (e) {}
}
function invalidateClip(id) {
  planCache.delete(id);
  layerCache.delete(id);
}

/* ============================================================
   合成器
   ============================================================ */
function filterCss(f) {
  f = f || {};
  const parts = [];
  if (f.b != null && f.b !== 1) parts.push('brightness(' + f.b + ')');
  if (f.c != null && f.c !== 1) parts.push('contrast(' + f.c + ')');
  if (f.s != null && f.s !== 1) parts.push('saturate(' + f.s + ')');
  if (f.hue) parts.push('hue-rotate(' + f.hue + 'deg)');
  if (f.blur) parts.push('blur(' + f.blur + 'px)');
  if (f.sepia) parts.push('sepia(' + f.sepia + ')');
  return parts.length ? parts.join(' ') : 'none';
}

function drawBackground(ctx, outW, outH) {
  const doc = ED.doc;
  if (doc.bgStyle === 'grad') {
    const g = ctx.createLinearGradient(0, 0, outW * 0.4, outH);
    g.addColorStop(0, doc.bg || '#111');
    g.addColorStop(1, doc.bg2 || '#000');
    ctx.fillStyle = g;
  } else ctx.fillStyle = doc.bg || '#000';
  ctx.fillRect(0, 0, outW, outH);
}

function fitRect(a, fit, W, H) {
  const iw = a.w || W, ih = a.h || H;
  if (fit === 'stretch') return { w: W, h: H };
  if (fit === 'contain') { const s = Math.min(W / iw, H / ih); return { w: iw * s, h: ih * s }; }
  if (fit === 'raw') return { w: iw, h: ih };
  const s = Math.max(W / iw, H / ih);
  return { w: iw * s, h: ih * s };
}

/* 视频素材逐帧定位（导出 / 暂停时精确，播放时只纠偏） */
function videoTarget(clip, lt) { return clip.in + Math.max(0, lt) * (clip.speed || 1); }
function seekVideo(el, t) {
  return new Promise((res) => {
    if (!el) return res();
    const want = clamp(t, 0, Math.max(0, (el.duration || 1) - 0.04));
    if (Math.abs(el.currentTime - want) < 0.008 && el.readyState >= 2) return res();
    let done = false;
    const fin = () => { if (done) return; done = true; el.removeEventListener('seeked', fin); requestRedraw(); res(); };
    el.addEventListener('seeked', fin);
    try { el.currentTime = want; } catch (e) { fin(); }
    setTimeout(fin, 420);
  });
}
async function prepareFrame(t) {
  const jobs = [];
  for (const c of ED.doc.clips) {
    if (c.kind !== 'video') continue;
    if (t < c.start - 0.001 || t >= clipEnd(c)) continue;
    const a = assetOf(c);
    if (a && a.el) jobs.push(seekVideo(a.el, videoTarget(c, t - c.start)));
  }
  if (jobs.length) await Promise.all(jobs);
}

/* 单个视觉片段的绘制（不含转场） */
function drawVisualClip(ctx, clip, lt, outW, outH, k, alphaMul, fast) {
  const tr = transformAt(clip, lt);
  const op = tr.opacity * (alphaMul == null ? 1 : alphaMul);
  if (op <= 0.002) return;
  if (clip.kind === 'text' || clip.kind === 'pv') {
    const layer = clipLayer(clip, lt, outW, outH, fast);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = clamp(op, 0, 1);
    if (clip.blend && clip.blend !== 'normal') ctx.globalCompositeOperation = clip.blend;
    ctx.translate(outW / 2 + tr.x * k, outH / 2 + tr.y * k);
    if (tr.rot) ctx.rotate(tr.rot * Math.PI / 180);
    ctx.scale(Math.max(0.01, tr.scale), Math.max(0.01, tr.scale));
    ctx.drawImage(layer, -outW / 2, -outH / 2, outW, outH);
    ctx.restore();
    return;
  }
  const a = assetOf(clip);
  if (!a && clip.solid) {
    ctx.save();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.globalAlpha = clamp(op, 0, 1);
    if (clip.blend && clip.blend !== 'normal') ctx.globalCompositeOperation = clip.blend;
    ctx.fillStyle = clip.solid;
    ctx.translate(ED.designW / 2 + tr.x, ED.designH / 2 + tr.y);
    if (tr.rot) ctx.rotate(tr.rot * Math.PI / 180);
    ctx.scale(Math.max(0.01, tr.scale), Math.max(0.01, tr.scale));
    ctx.fillRect(-ED.designW / 2, -ED.designH / 2, ED.designW, ED.designH);
    ctx.restore();
    return;
  }
  const src = a && (a.el || a.img);
  if (!src || (a.el && a.el.readyState < 2)) {
    // 素材还没准备好：画一个占位框，避免用户以为片段丢了
    ctx.save();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.globalAlpha = op * 0.5;
    ctx.fillStyle = '#1a2230'; ctx.fillRect(ED.designW * 0.25, ED.designH * 0.25, ED.designW * 0.5, ED.designH * 0.5);
    ctx.fillStyle = '#8b96ab'; ctx.font = '600 ' + Math.round(ED.designH * 0.028) + 'px system-ui,sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(clip.name || '素材加载中…', ED.designW / 2, ED.designH / 2);
    ctx.restore();
    return;
  }
  const r = fitRect(a, clip.fit, ED.designW, ED.designH);
  ctx.save();
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.globalAlpha = clamp(op, 0, 1);
  if (clip.blend && clip.blend !== 'normal') ctx.globalCompositeOperation = clip.blend;
  const filt = filterCss(clip.f);
  if (filt !== 'none') ctx.filter = filt;
  ctx.translate(ED.designW / 2 + tr.x, ED.designH / 2 + tr.y);
  if (tr.rot) ctx.rotate(tr.rot * Math.PI / 180);
  ctx.scale(Math.max(0.01, tr.scale), Math.max(0.01, tr.scale));
  try { ctx.drawImage(src, -r.w / 2, -r.h / 2, r.w, r.h); } catch (e) {}
  ctx.restore();
}

/* 转场进度 → 视觉参数 */
function transApply(ctx, type, prog, outW, outH) {
  const p = clamp(prog, 0, 1);
  const r = { alpha: 1, dx: 0, dy: 0, scale: 1, blur: 0, overlay: null, overlayAlpha: 0, clipPath: null };
  switch (type) {
    case 'fade': case 'dissolve': r.alpha = p; break;
    case 'dip': r.alpha = p; r.overlay = '#000'; r.overlayAlpha = 1 - Math.abs(p * 2 - 1); break;
    case 'white': r.alpha = p; r.overlay = '#fff'; r.overlayAlpha = 1 - Math.abs(p * 2 - 1); break;
    case 'flash': r.alpha = p; r.overlay = '#fff'; r.overlayAlpha = (1 - p) * 0.85; break;
    case 'slideL': r.dx = -(1 - p) * outW; break;
    case 'slideR': r.dx = (1 - p) * outW; break;
    case 'slideU': r.dy = -(1 - p) * outH; break;
    case 'slideD': r.dy = (1 - p) * outH; break;
    case 'whip': r.dx = (1 - p) * outW * 0.65; r.blur = (1 - p) * 22; break;
    case 'zoomIn': r.alpha = p; r.scale = lerp(1.25, 1, p); break;
    case 'zoomOut': r.alpha = p; r.scale = lerp(0.8, 1, p); break;
    case 'blurIn': r.alpha = p; r.blur = (1 - p) * 26; break;
    case 'wipeL': r.clipPath = c => c.rect(-2, -2, outW * p + 2, outH + 4); break;
    case 'wipeR': r.clipPath = c => c.rect(outW * (1 - p), -2, outW * p + 2, outH + 4); break;
    case 'iris': r.clipPath = c => c.arc(outW / 2, outH / 2, Math.hypot(outW, outH) * 0.52 * p, 0, Math.PI * 2); break;
    default: break;
  }
  return r;
}

function drawClipAt(ctx, clip, lt, outW, outH, k, alphaMul, fast) {
  drawVisualClip(ctx, clip, lt, outW, outH, k, alphaMul, fast);
}

/* 一条轨道在 t 时刻的画面（含转场 / 交叉溶解） */
function drawTrackAt(ctx, track, t, outW, outH, k, fast) {
  const clips = ED.doc.clips.filter(c => c.track === track.id && isVisual(c) && t >= c.start - 1e-6 && t < clipEnd(c) - 1e-6);
  if (!clips.length) return;
  clips.sort((a, b) => a.start - b.start);
  for (const c of clips) {
    const lt = t - c.start;
    const tin = c.transIn && c.transIn.type && c.transIn.type !== 'none' ? c.transIn : null;
    let prev = null;
    if (tin && lt < (tin.dur || 0.4)) {
      const pool = ED.doc.clips.filter(x => x.track === track.id && x.id !== c.id && clipEnd(x) <= c.start + 0.14 && clipEnd(x) > c.start - 3);
      pool.sort((a, b) => clipEnd(b) - clipEnd(a));
      prev = pool[0] || null;
    }
    const prog = tin ? clamp(lt / Math.max(0.05, tin.dur || 0.4), 0, 1) : 1;
    const tout = c.transOut && c.transOut.type && c.transOut.type !== 'none' ? c.transOut : null;
    let outMul = 1;
    if (tout) {
      const td = tout.dur || 0.4, r = clipEnd(c) - t;
      if (r < td) outMul = clamp(r / Math.max(0.05, td), 0, 1);
    }
    if (tin && prog < 1) {
      const q = transApply(ctx, tin.type, prog, outW, outH);
      const needPrev = (prev && (q.alpha < 1 || q.overlay || q.clipPath));
      if (needPrev) drawClipAt(ctx, prev, Math.max(0, prev.dur - 0.001), outW, outH, k, 1, fast);
      ctx.save();
      if (q.clipPath) { ctx.beginPath(); q.clipPath(ctx); ctx.clip(); }
      if (q.overlay && q.overlayAlpha > 0.01) {
        ctx.globalAlpha = q.overlayAlpha; ctx.fillStyle = q.overlay;
        ctx.fillRect(-2, -2, outW + 4, outH + 4); ctx.globalAlpha = 1;
      }
      if (q.dx || q.dy) ctx.translate(q.dx, q.dy);
      if (q.scale !== 1) { ctx.translate(outW / 2, outH / 2); ctx.scale(q.scale, q.scale); ctx.translate(-outW / 2, -outH / 2); }
      if (q.blur > 0.5) ctx.filter = 'blur(' + q.blur.toFixed(1) + 'px)';
      drawClipAt(ctx, c, lt, outW, outH, k, q.alpha * outMul, fast);
      ctx.restore();
    } else {
      drawClipAt(ctx, c, lt, outW, outH, k, outMul, fast);
    }
    // 出点转场的覆盖色
    if (tout && clipEnd(c) - t < (tout.dur || 0.4) && (tout.type === 'dip' || tout.type === 'white')) {
      const r = 1 - (clipEnd(c) - t) / (tout.dur || 0.4);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = clamp(r * 0.9, 0, 1);
      ctx.fillStyle = tout.type === 'white' ? '#fff' : '#000';
      ctx.fillRect(0, 0, outW, outH); ctx.restore();
    }
  }
}

let _lastComposeMs = 0;
function renderFrame(ctx, t, outW, outH, opt) {
  opt = opt || {};
  const t0 = performance.now();
  const k = outW / ED.designW;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  ctx.clearRect(0, 0, outW, outH);
  if (!opt.transparent) drawBackground(ctx, outW, outH);
  for (const tr of visualTracks()) {
    if (tr.hide) continue;
    ctx.save();
    drawTrackAt(ctx, tr, t, outW, outH, k, opt.fast);
    ctx.restore();
  }
  ctx.restore();
  _lastComposeMs = performance.now() - t0;
}
ED.renderFrame = renderFrame;
ED.prepareFrame = prepareFrame;
ED.planFor = planFor;

/* ============================================================
   音频：预览播放 + 离线混音
   ============================================================ */
const PLAY = {
  ctx: null, master: null, nodes: [], startAt: 0, baseT: 0, rate: 1,
  ensure() {
    if (!this.ctx) {
      this.ctx = audioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = ED.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.master) this.master.gain.value = ED.volume;
    return this.ctx;
  },
  stop() {
    for (const n of this.nodes) { try { n.stop(); } catch (e) {} try { n.disconnect(); } catch (e) {} }
    this.nodes = [];
  },
  envAt(clip, lt) {
    let v = kfVal(clip, 'vol', lt, clip.vol);
    const fi = clip.fadeIn || 0, fo = clip.fadeOut || 0;
    if (fi > 0 && lt < fi) v *= lt / fi;
    if (fo > 0 && lt > clip.dur - fo) v *= Math.max(0, (clip.dur - lt) / fo);
    return clamp(v, 0, 1);
  },
  schedule(t) {
    const ctx = this.ensure();
    this.stop();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime + 0.04;
    this.startAt = now; this.baseT = t;
    const end = ED.dur;
    for (const clip of ED.doc.clips) {
      if (clip.kind !== 'audio') continue;
      const a = assetOf(clip);
      if (!a || !a.buf) continue;
      const tr = trackById(clip.track);
      if (tr && tr.mute) continue;
      if (clipEnd(clip) <= t || clip.start >= end) continue;
      const skip = Math.max(0, t - clip.start);
      const when = now + Math.max(0, clip.start - t);
      const dur = clip.dur - skip;
      if (dur <= 0.02) continue;
      const src = ctx.createBufferSource();
      src.buffer = a.buf;
      src.playbackRate.value = clip.speed || 1;
      const g = ctx.createGain();
      // 包络（淡入淡出 + 音量关键帧）—— 采样成曲线
      const N = Math.max(2, Math.min(600, Math.ceil(dur / 0.02)));
      const curve = new Float32Array(N);
      for (let i = 0; i < N; i++) curve[i] = this.envAt(clip, skip + dur * i / (N - 1)) * (tr && tr.vol != null ? tr.vol : 1);
      try { g.gain.setValueCurveAtTime(curve, when, Math.max(0.02, dur)); }
      catch (e) { g.gain.value = clip.vol; }
      src.connect(g); g.connect(this.master);
      try { src.start(when, clip.in + skip * (clip.speed || 1), dur); } catch (e) {}
      this.nodes.push(src);
    }
  },
  time() { return this.ctx ? this.baseT + (this.ctx.currentTime - this.startAt) : ED.t; },
};
ED.PLAY = PLAY;

async function mixAudio(t0, dur, sr) {
  sr = sr || 48000;
  const OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OC(2, Math.max(1, Math.ceil(dur * sr)), sr);
  const master = ctx.createGain();
  master.gain.value = 1;      // 导出不受预览音量影响，保留原始电平
  master.connect(ctx.destination);
  let any = false;
  for (const clip of ED.doc.clips) {
    if (clip.kind !== 'audio') continue;
    const a = assetOf(clip);
    if (!a || !a.buf) continue;
    const tr = trackById(clip.track);
    if (tr && tr.mute) continue;
    if (clipEnd(clip) <= t0 || clip.start >= t0 + dur) continue;
    const skip = Math.max(0, t0 - clip.start);
    const when = Math.max(0, clip.start - t0);
    const playDur = Math.min(clip.dur - skip, dur - when);
    if (playDur <= 0.02) continue;
    any = true;
    const src = ctx.createBufferSource();
    src.buffer = a.buf;
    src.playbackRate.value = clip.speed || 1;
    const g = ctx.createGain();
    const N = Math.max(2, Math.min(4000, Math.ceil(playDur / 0.02)));
    const curve = new Float32Array(N);
    for (let i = 0; i < N; i++) curve[i] = PLAY.envAt(clip, skip + playDur * i / (N - 1)) * (tr && tr.vol != null ? tr.vol : 1);
    try { g.gain.setValueCurveAtTime(curve, when, Math.max(0.02, playDur)); } catch (e) { g.gain.value = clip.vol; }
    src.connect(g); g.connect(master);
    try { src.start(when, clip.in + skip * (clip.speed || 1), playDur); } catch (e) {}
  }
  const buf = await ctx.startRendering();
  return any ? buf : null;
}
ED.mixAudio = mixAudio;

/* ============================================================
   时间线：绘制
   ============================================================ */
const TL = { head: 132, ruler: 26, pad: 8, gap: 2, minDur: 0.05 };
const TC = {
  bg: '#0b0e14', ruler: '#080b10', trackA: '#11151d', trackB: '#0e1219', trackHead: '#0c1017',
  line: '#1e2634', grid: '#18202c', beat: '#1f2b3d', bar: '#2c3d55',
  ink: '#dbe3f2', dim: '#7d899f', dim2: '#4d586d', play: '#ff6a2b',
};

function niceStep(dur, pps) {
  const target = 76 / Math.max(1, pps);
  const steps = [0.04, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  for (const s of steps) if (s >= target) return s;
  return 600;
}
function tickTxt(t, step) {
  const m = Math.floor(t / 60), s = t - m * 60;
  if (step < 1) return m + ':' + (s < 10 ? '0' : '') + s.toFixed(step < 0.2 ? 2 : 1);
  return m + ':' + String(Math.floor(s)).padStart(2, '0');
}
function rr(ctx, x, y, w, h, r) {
  w = Math.max(0, w); h = Math.max(0, h);
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function tlGeom() {
  const cv = $('#edTl'), scroll = $('#edTlScroll');
  if (!cv || !scroll || !ED.doc) return null;
  const vw = scroll.clientWidth, vh = scroll.clientHeight;
  if (!vw || !vh) return null;
  const pps = ED.pps;
  const dur = ED.dur;
  let y = TL.ruler + TL.pad;
  const rows = ED.doc.tracks.map(tr => { const r = { tr, y, h: tr.h || 56 }; y += r.h + TL.gap; return r; });
  const contentW = Math.max(vw, TL.head + dur * pps + 90);
  const contentH = Math.max(vh, y + 60);
  const sl = scroll.scrollLeft, st = scroll.scrollTop;
  return {
    cv, scroll, vw, vh, pps, dur, contentW, contentH, sl, st, rows,
    X: t => TL.head + t * pps - sl,
    unX: x => clamp((x + sl - TL.head) / pps, 0, Math.max(0.001, dur)),
    rowY: r => r.y - st,
    rowAt: y => rows.find(r => y >= r.y - st - TL.pad && y < r.y - st + r.h + TL.pad),
    contentEnd: y,
  };
}

function tlInnerSize(G) {
  const inner = $('#edTlInner');
  if (!inner) return;
  const w = Math.ceil(G.contentW + 40) + 'px', h = Math.ceil(G.contentH + 20) + 'px';
  if (inner.style.width !== w) inner.style.width = w;
  if (inner.style.height !== h) inner.style.height = h;
}

let tlNeed = true;
function requestRedraw() { tlNeed = true; }
function drawTimeline() {
  const G = tlGeom();
  if (!G) return;
  tlInnerSize(G);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.round(G.vw), H = Math.round(G.vh);
  const cv = G.cv;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = TC.bg; ctx.fillRect(0, 0, W, H);

  const doc = ED.doc;
  const step = niceStep(G.dur, G.pps);

  // 轨道底色
  for (const row of G.rows) {
    const y = G.rowY(row), h = row.h;
    if (y + h < TL.ruler || y > H) continue;
    const isAudioT = row.tr.kind === 'audio';
    ctx.fillStyle = isAudioT ? '#0a1410' : (row.tr.kind === 'text' ? '#0f131b' : '#0e1219');
    ctx.fillRect(TL.head, y, W - TL.head, h);
    if (row.tr.hide) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(TL.head, y, W - TL.head, h); }
    ctx.strokeStyle = TC.line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(TL.head, Math.round(y + h) + .5); ctx.lineTo(W, Math.round(y + h) + .5); ctx.stroke();
  }

  // 时间网格 + 拍点
  ctx.save();
  ctx.beginPath(); ctx.rect(TL.head, TL.ruler, W - TL.head, H - TL.ruler); ctx.clip();
  for (let t = 0; t <= G.dur + 1e-6; t += step) {
    const x = Math.round(G.X(t)) + .5;
    if (x < TL.head || x > W) continue;
    ctx.strokeStyle = TC.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, TL.ruler); ctx.lineTo(x, H); ctx.stroke();
  }
  const bpm = doc.bpm > 0 ? doc.bpm : 0;
  if (bpm && bpm / 60 * G.pps >= 7) {
    const b = 60 / bpm;
    for (let n = 0, t = 0; t <= G.dur && n < 5000; n++, t += b) {
      const x = Math.round(G.X(t)) + .5;
      if (x < TL.head || x > W) continue;
      ctx.strokeStyle = n % 4 === 0 ? TC.bar : TC.beat; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, TL.ruler + (n % 4 ? 7 : 0)); ctx.lineTo(x, H); ctx.stroke();
    }
  }
  ctx.restore();

  // 片段
  for (const row of G.rows) {
    const y = G.rowY(row), h = row.h;
    if (y + h < TL.ruler - 2 || y > H) continue;
    const clips = doc.clips.filter(c => c.track === row.tr.id).sort((a, b) => a.start - b.start);
    for (const c of clips) drawClipBlock(ctx, G, c, row, y, h);
  }

  // 框选
  if (ED.mkSel) {
    const m = ED.mkSel;
    const x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1);
    const y0 = Math.min(m.y0, m.y1), y1 = Math.max(m.y0, m.y1);
    ctx.fillStyle = 'rgba(91,140,255,.16)'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = '#7ba2ff'; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
    ctx.strokeRect(Math.round(x0) + .5, Math.round(y0) + .5, x1 - x0, y1 - y0);
    ctx.setLineDash([]);
  }

  // 吸附提示
  if (ED.snapGuide != null) {
    const gx = Math.round(G.X(ED.snapGuide)) + .5;
    if (gx > TL.head && gx < W) {
      ctx.strokeStyle = '#ffd84d'; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(gx, TL.ruler); ctx.lineTo(gx, H); ctx.stroke(); ctx.setLineDash([]);
      if (ED.snapLabel) {
        ctx.font = '600 9.5px system-ui,"Microsoft YaHei"';
        const tw = ctx.measureText(ED.snapLabel).width + 10;
        const tx = clamp(gx - tw / 2, TL.head + 2, W - tw - 2);
        ctx.fillStyle = 'rgba(10,13,19,.92)'; rr(ctx, tx, TL.ruler + 3, tw, 15, 4); ctx.fill();
        ctx.fillStyle = '#ffd84d'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(ED.snapLabel, tx + tw / 2, TL.ruler + 11);
        ctx.textAlign = 'left';
      }
    }
  }

  // 标尺
  ctx.fillStyle = TC.ruler; ctx.fillRect(0, 0, W, TL.ruler);
  ctx.strokeStyle = TC.line; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, TL.ruler + .5); ctx.lineTo(W, TL.ruler + .5); ctx.stroke();
  ctx.save();
  ctx.beginPath(); ctx.rect(TL.head, 0, W - TL.head, TL.ruler); ctx.clip();
  ctx.font = '10px "SFMono-Regular",Consolas,monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  for (let t = 0; t <= G.dur + 1e-6; t += step) {
    const x = G.X(t);
    if (x < TL.head - 40 || x > W) continue;
    ctx.fillStyle = '#93a0b8';
    ctx.fillText(tickTxt(t, step), x + 4, TL.ruler / 2 + 1);
    ctx.strokeStyle = '#3a465c';
    ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, TL.ruler - 6); ctx.lineTo(Math.round(x) + .5, TL.ruler); ctx.stroke();
  }
  // 标记
  for (const mk of doc.markers || []) {
    const x = Math.round(G.X(mk.t)) + .5;
    if (x < TL.head || x > W) continue;
    ctx.fillStyle = mk.color || '#38e1c6';
    ctx.beginPath(); ctx.moveTo(x - 5, TL.ruler - 13); ctx.lineTo(x + 5, TL.ruler - 13); ctx.lineTo(x + 5, TL.ruler - 7); ctx.lineTo(x, TL.ruler - 3); ctx.lineTo(x - 5, TL.ruler - 7); ctx.closePath(); ctx.fill();
  }
  // 入出点
  const inP = doc.inPoint, outP = doc.outPoint;
  if (outP > inP + 0.02) {
    const xa = G.X(inP), xb = G.X(outP);
    ctx.fillStyle = 'rgba(255,106,43,.10)'; ctx.fillRect(xa, 0, xb - xa, TL.ruler);
    ctx.fillStyle = '#ff8a52';
    ctx.fillRect(Math.round(xa), 0, 2, TL.ruler); ctx.fillRect(Math.round(xb) - 2, 0, 2, TL.ruler);
  }
  ctx.restore();

  // 播放头
  const px = G.X(ED.t);
  if (px >= TL.head - 1 && px <= W + 1) {
    ctx.strokeStyle = TC.play; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(Math.round(px) + .5, TL.ruler - 4); ctx.lineTo(Math.round(px) + .5, H); ctx.stroke();
    ctx.fillStyle = TC.play;
    ctx.beginPath();
    ctx.moveTo(px - 5.5, TL.ruler - 11); ctx.lineTo(px + 5.5, TL.ruler - 11); ctx.lineTo(px, TL.ruler - 1);
    ctx.closePath(); ctx.fill();
  }

  // 轨道头（固定列）
  ctx.fillStyle = TC.trackHead; ctx.fillRect(0, 0, TL.head, H);
  ctx.strokeStyle = TC.line; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(TL.head + .5, 0); ctx.lineTo(TL.head + .5, H); ctx.stroke();
  ctx.fillStyle = '#ff9d6e'; ctx.font = '700 11px "SFMono-Regular",Consolas,monospace';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(tc(ED.t, false), 9, TL.ruler / 2);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, TL.ruler + 1, TL.head, H - TL.ruler); ctx.clip();
  for (const row of G.rows) drawTrackHead(ctx, G, row);
  ctx.restore();
}

function drawTrackHead(ctx, G, row) {
  const y = G.rowY(row), h = row.h;
  if (y + h < TL.ruler || y > G.vh) return;
  const tr = row.tr;
  const kc = tr.kind === 'audio' ? '#22c55e' : tr.kind === 'text' ? '#5b8cff' : '#a855f7';
  ctx.fillStyle = TC.trackHead; ctx.fillRect(0, y, TL.head, h);
  ctx.fillStyle = kc; ctx.globalAlpha = 0.16; ctx.fillRect(0, y, 3, h); ctx.globalAlpha = 1;
  ctx.fillStyle = kc; ctx.fillRect(0, y, 3, h);
  ctx.font = '600 11.5px system-ui,"Microsoft YaHei"'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillStyle = tr.hide ? '#5c6879' : '#c8d2e4';
  ctx.fillText(tr.name || KIND[tr.kind].label, 11, y + Math.min(h / 2, 19));
  ctx.font = '9.5px system-ui,"Microsoft YaHei"'; ctx.fillStyle = '#5c6879';
  const n = ED.doc.clips.filter(c => c.track === tr.id).length;
  ctx.fillText(KIND[tr.kind].label + ' · ' + n + ' 段', 11, y + Math.min(h - 8, 35));
  // 三个小按钮：静音 / 隐藏 / 锁定
  const btns = trackButtons(row).map(b => Object.assign({}, b, { y: b.y - G.st }));
  for (const b of btns) {
    const on = !!tr[b.key];
    ctx.fillStyle = on ? (b.key === 'mute' ? '#7a2a2a' : b.key === 'hide' ? '#3a2d13' : '#2a3550') : '#161c27';
    rr(ctx, b.x, b.y, b.w, b.h, 4); ctx.fill();
    ctx.strokeStyle = on ? (b.key === 'mute' ? '#ef4444' : '#f5a524') : '#26303f'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = on ? (b.key === 'mute' ? '#ff9c9c' : '#ffd28a') : '#6b778c';
    ctx.font = '9px system-ui,"Microsoft YaHei"'; ctx.textAlign = 'center';
    ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + .5);
    ctx.textAlign = 'left';
  }
}
function trackButtons(row) {
  const tr = row.tr;
  const bw = 22, bh = 16, gap = 3;
  const y = row.y + (row.h - bh) / 2;
  const x0 = TL.head - 8 - bw * 3 - gap * 2;
  return [
    { key: 'mute', label: '静', x: x0, y, w: bw, h: bh },
    { key: 'hide', label: '藏', x: x0 + bw + gap, y, w: bw, h: bh },
    { key: 'lock', label: '锁', x: x0 + (bw + gap) * 2, y, w: bw, h: bh },
  ];
}

function thumbImg(a) {
  if (!a || !a.thumb) return null;
  if (a._thumbEl && a._thumbEl.src === a.thumb) return a._thumbEl;
  const im = new Image(); im.src = a.thumb; a._thumbEl = im;
  return im;
}

function drawClipBlock(ctx, G, c, row, y0, h) {
  const xa = G.X(c.start), xb = G.X(clipEnd(c));
  if (xb < TL.head - 2 || xa > G.vw + 2) return;
  const bw = Math.max(3, xb - xa);
  const x = Math.max(TL.head, xa);
  const w = Math.min(G.vw, xb) - x;
  if (w <= 0) return;
  const y = y0 + 3, hh = h - 6;
  const meta = KIND[c.kind] || KIND.image;
  const sel = ED.sel.includes(c.id);
  const hover = ED.hoverId === c.id;
  ctx.save();
  rr(ctx, x, y, Math.max(2, w), hh, 5); ctx.clip();
  const g = ctx.createLinearGradient(0, y, 0, y + hh);
  g.addColorStop(0, meta.c); g.addColorStop(1, meta.c2);
  ctx.globalAlpha = sel ? 1 : hover ? 0.96 : 0.88;
  ctx.fillStyle = g; ctx.fillRect(x, y, w, hh);
  ctx.globalAlpha = 1;
  // 缩略图 / 波形
  if (c.kind === 'video' || c.kind === 'image' || c.kind === 'pv') {
    const a = assetOf(c);
    const im = c.kind === 'pv' ? null : thumbImg(a);
    if (im && im.complete && im.naturalWidth) {
      const tw = Math.max(1, hh * 1.78);
      ctx.globalAlpha = 0.42;
      for (let tx = x; tx < x + w; tx += tw) {
        const s = Math.max(tw / im.naturalWidth, hh / im.naturalHeight);
        const sw = tw / s, sh = hh / s;
        try { ctx.drawImage(im, (im.naturalWidth - sw) / 2, (im.naturalHeight - sh) / 2, sw, sh, tx, y, Math.min(tw, x + w - tx), hh); } catch (e) {}
      }
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = 'rgba(6,9,14,.38)'; ctx.fillRect(x, y, w, hh);
  } else if (c.kind === 'audio') {
    const a = assetOf(c);
    ctx.fillStyle = 'rgba(4,20,14,.5)'; ctx.fillRect(x, y, w, hh);
    if (a && a.peaks) {
      const mid = y + hh / 2;
      const total = Math.max(0.001, a.dur);
      ctx.fillStyle = 'rgba(190,255,220,.9)';
      const px = Math.max(1, Math.floor(w / 2));
      for (let i = 0; i < px; i++) {
        const t0 = c.in + (c.dur * i / px) * (c.speed || 1);
        const k0 = clamp(t0 / total, 0, 1);
        const k1 = clamp((c.in + (c.dur * (i + 1) / px) * (c.speed || 1)) / total, 0, 1);
        let mx = 0;
        for (let q = Math.floor(k0 * a.peaks.length); q <= Math.ceil(k1 * a.peaks.length); q++) { const v = a.peaks[clamp(q, 0, a.peaks.length - 1)] || 0; if (v > mx) mx = v; }
        const hgt = Math.max(1, mx * (hh - 8) * 0.5);
        ctx.fillRect(x + i * (w / px), mid - hgt, Math.max(1, w / px - 0.4), hgt * 2);
      }
    }
  } else if (c.kind === 'text') {
    const L = J.LAYOUTS[c.fx && c.fx.layout];
    const lab = (L && L.name) || '文字';
    ctx.fillStyle = 'rgba(255,255,255,.07)';
    ctx.fillRect(x, y, w, hh);
    ctx.globalAlpha = 0.20; ctx.fillStyle = '#fff';
    ctx.font = '700 ' + Math.round(hh * 0.9) + 'px "Microsoft YaHei",serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(lab, x + w - 6, y + hh / 2);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }
  // 名字
  ctx.font = '600 11px system-ui,"Microsoft YaHei"'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.shadowColor = 'rgba(0,0,0,.65)'; ctx.shadowBlur = 3;
  ctx.fillStyle = '#fff';
  const label = c.kind === 'text' ? ('文 ' + (c.text || '').split('\n')[0].slice(0, 22)) : c.kind === 'pv' ? ('PV 层 ' + (c.name || '')) : ((c.kind === 'audio' ? '♫ ' : '') + (c.name || ''));
  if (w > 30) ctx.fillText(label, x + 6, y + Math.min(hh / 2, 15));
  ctx.shadowBlur = 0;
  // 手法徽章
  if (c.kind === 'text' || c.kind === 'pv') {
    const chips = [];
    if (c.kind === 'text') {
      const L = J.LAYOUTS[c.fx && c.fx.layout], E1 = J.ENTER[c.fx && c.fx.enter], H1 = J.HOLD[c.fx && c.fx.hold], X1 = J.EXIT[c.fx && c.fx.exit];
      if (L) chips.push(L.name);
      if (E1 && c.fx.enter !== 'cut') chips.push(E1.name);
      if (H1 && c.fx.hold !== 'still') chips.push(H1.name);
      if (X1 && c.fx.exit !== 'cut') chips.push(X1.name);
      if (c.fx && c.fx.bg && c.fx.bg !== 'none' && J.BG[c.fx.bg]) chips.push('背景:' + J.BG[c.fx.bg].name);
      if (c.fx && c.fx.treat && c.fx.treat !== 'none' && J.TREAT[c.fx.treat]) chips.push(J.TREAT[c.fx.treat].name);
    }
    if (hasKeys(c)) chips.push('◆' + kfTimes(c).length);
    if (chips.length && w > 74 && hh > 26) {
      ctx.font = '9px system-ui,"Microsoft YaHei"';
      let cx = x + 6;
      const cy = y + 15 + 13;
      for (const s of chips.slice(0, 4)) {
        const tw = ctx.measureText(s).width + 9;
        if (cx + tw > x + w - 4) break;
        ctx.fillStyle = 'rgba(6,9,14,.45)'; rr(ctx, cx, cy - 6, tw, 13, 3); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.86)'; ctx.fillText(s, cx + 4.5, cy);
        cx += tw + 3;
      }
    }
  }
  // 音量 / 淡入淡出（音频）
  if (c.kind === 'audio' && w > 30) {
    const showFade = (f, fromLeft) => {
      if (!f) return;
      const fw = clamp(f / Math.max(0.001, c.dur) * w, 1, w);
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.beginPath();
      if (fromLeft) { ctx.moveTo(x, y); ctx.lineTo(x + fw, y); ctx.lineTo(x, y + hh); }
      else { ctx.moveTo(x + w, y); ctx.lineTo(x + w - fw, y); ctx.lineTo(x + w, y + hh); }
      ctx.closePath(); ctx.fill();
    };
    showFade(c.fadeIn, true); showFade(c.fadeOut, false);
  }
  // 关键帧 ◆
  if (hasKeys(c) && hh > 24) {
    for (const kt of kfTimes(c)) {
      const kx = G.X(c.start + kt);
      if (kx < x - 1 || kx > x + w + 1) continue;
      const near = Math.abs((ED.t - c.start) - kt) < 0.05;
      ctx.fillStyle = near ? '#ffe066' : 'rgba(255,255,255,.9)';
      ctx.strokeStyle = 'rgba(10,13,19,.8)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(kx, y + hh - 10); ctx.lineTo(kx + 3.4, y + hh - 6.5); ctx.lineTo(kx, y + hh - 3); ctx.lineTo(kx - 3.4, y + hh - 6.5);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }
  ctx.restore();

  // 转场标记
  if (c.transIn && c.transIn.type !== 'none' && w > 16) {
    ctx.fillStyle = '#ffd84d';
    ctx.beginPath(); ctx.moveTo(x + 1, y + 3); ctx.lineTo(x + 11, y + 3); ctx.lineTo(x + 1, y + 13); ctx.closePath(); ctx.fill();
  }
  if (c.transOut && c.transOut.type !== 'none' && w > 16) {
    ctx.fillStyle = '#ffd84d';
    ctx.beginPath(); ctx.moveTo(x + w - 1, y + 3); ctx.lineTo(x + w - 11, y + 3); ctx.lineTo(x + w - 1, y + 13); ctx.closePath(); ctx.fill();
  }
  // 边框
  ctx.strokeStyle = sel ? '#fff' : (hover ? 'rgba(255,255,255,.55)' : 'rgba(6,9,14,.55)');
  ctx.lineWidth = sel ? 2 : 1;
  rr(ctx, x + 0.5, y + 0.5, Math.max(2, w) - 1, hh - 1, 5); ctx.stroke();
  // 裁切把手
  if (sel && w > 8) {
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.fillRect(x + 1, y + 4, 2.5, hh - 8);
    ctx.fillRect(x + w - 3.5, y + 4, 2.5, hh - 8);
  }
}

/* 命中检测 */
function tlHit(x, y) {
  const G = tlGeom();
  if (!G) return null;
  if (y < TL.ruler) {
    if (x > TL.head) return { type: 'ruler', t: G.unX(x) };
    return { type: 'corner' };
  }
  if (x < TL.head) {
    const row = G.rowAt(y);
    if (!row) return null;
    for (const b of trackButtons(row)) {
      if (x >= b.x && x <= b.x + b.w && y >= G.rowY(row) + (row.h - b.h) / 2 && y <= G.rowY(row) + (row.h + b.h) / 2) return { type: 'trackbtn', key: b.key, track: row.tr };
    }
    return { type: 'trackhead', track: row.tr };
  }
  const row = G.rowAt(y);
  if (!row) return { type: 'empty' };
  const clips = ED.doc.clips.filter(c => c.track === row.tr.id);
  for (let i = clips.length - 1; i >= 0; i--) {
    const c = clips[i];
    const xa = G.X(c.start), xb = G.X(clipEnd(c));
    if (x < xa - 2 || x > xb + 2) continue;
    if (y < G.rowY(row) + 2 || y > G.rowY(row) + row.h - 2) continue;
    // 关键帧
    if (hasKeys(c) && row.h > 34 && y >= G.rowY(row) + row.h - 18) {
      for (const kt of kfTimes(c)) {
        if (Math.abs(x - G.X(c.start + kt)) <= 6) return { type: 'kf', clip: c, kt };
      }
    }
    const ez = Math.min(8, Math.max(3, (xb - xa) * 0.18));
    if (xb - xa > 10 && x <= xa + ez) return { type: 'clip', clip: c, zone: 'l', row };
    if (xb - xa > 10 && x >= xb - ez) return { type: 'clip', clip: c, zone: 'r', row };
    return { type: 'clip', clip: c, zone: 'body', row };
  }
  return { type: 'empty', row, t: G.unX(x) };
}

/* ============================================================
   时间线：编辑操作
   ============================================================ */
function frameRound(t) {
  const fps = ED.doc.fps || 30;
  return Math.round(t * fps) / fps;
}
function select(ids, primary) {
  ED.sel = (ids || []).filter(id => !!clipById(id));
  if (primary && ED.sel.includes(primary)) ED.sel = [primary].concat(ED.sel.filter(x => x !== primary));
  const only = ED.sel.length === 1 ? clipById(ED.sel[0]) : null;
  if (only) {
    if ((only.kind === 'text' || only.kind === 'pv') && ED.itab === 'basic') ED.itab = 'text';
    else if (only.kind === 'audio' && ED.itab === 'basic') ED.itab = 'audio';
  }
  ED.itab = ED.itab || 'basic';
  renderInspector(); drawTimeline(); requestRedraw();
}
function toggleSelect(id) {
  if (ED.sel.includes(id)) ED.sel = ED.sel.filter(x => x !== id);
  else ED.sel.push(id);
  renderInspector(); drawTimeline(); requestRedraw();
}
function snapCand(exclude) {
  const out = [0, ED.t];
  for (const c of ED.doc.clips) {
    if (exclude && exclude.includes(c.id)) continue;
    out.push(c.start, clipEnd(c));
  }
  for (const m of ED.doc.markers || []) out.push(m.t);
  if (ED.doc.outPoint > 0) out.push(ED.doc.outPoint);
  if (ED.snapBeat && ED.doc.bpm > 0) {
    const b = 60 / ED.doc.bpm;
    for (let t = 0; t < ED.dur; t += b) out.push(t);
  }
  return out;
}
function snapT(t, exclude, thrPx) {
  if (!ED.snap) { ED.snapGuide = null; return t; }
  const thr = (thrPx || 8) / ED.pps;
  let best = null, bd = 1e9;
  for (const s of snapCand(exclude)) {
    const d = Math.abs(s - t);
    if (d < bd) { bd = d; best = s; }
  }
  if (best != null && bd <= thr) {
    ED.snapGuide = best;
    ED.snapLabel = labelAt(best);
    return best;
  }
  ED.snapGuide = null; ED.snapLabel = '';
  return t;
}
function labelAt(t) {
  for (const c of ED.doc.clips) {
    if (Math.abs(c.start - t) < 1e-4) return '片段起点 ' + tc(t, false);
    if (Math.abs(clipEnd(c) - t) < 1e-4) return '片段终点 ' + tc(t, false);
  }
  if (Math.abs(ED.t - t) < 1e-4) return '播放头';
  for (const m of ED.doc.markers || []) if (Math.abs(m.t - t) < 1e-4) return '标记';
  if (ED.snapBeat && ED.doc.bpm > 0) {
    const b = 60 / ED.doc.bpm;
    if (Math.abs(Math.round(t / b) * b - t) < 1e-3) return '拍点';
  }
  return '起点';
}

function trackForKind(kind, preferId) {
  const want = kind === 'audio' ? 'audio' : kind === 'text' || kind === 'pv' ? 'text' : 'video';
  if (preferId) {
    const t = trackById(preferId);
    if (t && (want === 'audio' ? t.kind === 'audio' : t.kind !== 'audio')) return t;
  }
  let tr = ED.doc.tracks.find(t => want === 'text' ? t.kind === 'text' : want === 'audio' ? t.kind === 'audio' : t.kind === 'video');
  if (tr) return tr;
  // 没有这类轨道就自动补一条，不打断用户
  const nt = trackDef(want, want === 'audio' ? '音频' : want === 'text' ? '文字' : '视频');
  if (want === 'audio') ED.doc.tracks.push(nt);
  else if (want === 'text') {
    const i = ED.doc.tracks.findIndex(t => t.kind !== 'text');
    if (i < 0) ED.doc.tracks.push(nt); else ED.doc.tracks.splice(i, 0, nt);
  } else {
    const i = ED.doc.tracks.findIndex(t => t.kind === 'audio');
    if (i < 0) ED.doc.tracks.push(nt); else ED.doc.tracks.splice(i, 0, nt);
  }
  return nt;
}
function clipDurForAsset(a, kind) {
  if (kind === 'audio') return Math.min(a.dur || 5, 600);
  if (kind === 'video') return Math.min(a.dur || 5, 600);
  return 4;
}
function addClip(clip, opts) {
  ED.doc.clips.push(clip);
  recalcDur();
  if (!opts || opts.select !== false) select([clip.id]);
  markDirty(); requestRedraw(); drawTimeline();
  if (!opts || opts.snapshot !== false) snapshot('添加' + (KIND[clip.kind] ? KIND[clip.kind].label : '片段'));
  return clip;
}
function assetClip(trackId, assetId, start) {
  const a = ED.assets[assetId];
  if (!a) return null;
  const kind = a.kind === 'audio' ? 'audio' : a.kind === 'video' ? 'video' : 'image';
  const tr = trackForKind(kind, trackId);
  if (!tr) { toast('没有可用的轨道'); return null; }
  const c = defaultClip(kind, {
    track: tr.id, asset: assetId, name: a.name, start: Math.max(0, start), dur: clipDurForAsset(a, kind),
    in: 0, fit: 'cover',
  });
  if (kind === 'audio') { c.fit = 'cover'; }
  return c;
}
function addAssetAt(assetId, t, trackId) {
  const c = assetClip(trackId, assetId, t);
  if (!c) return;
  addClip(c);
  warmupAudio([c]);
  toast('已加入：' + c.name);
}
function addTextAt(t, trackId, text) {
  const tr = trackForKind('text', trackId);
  if (!tr) { toast('请先添加一条文字轨道'); return; }
  const c = defaultClip('text', {
    track: tr.id, name: '文字', start: Math.max(0, frameRound(t)), dur: 3.2,
    text: text || '双击改字',
    fx: { layout: 'center', enter: 'pop', hold: 'still', exit: 'cut', treat: 'none', bg: 'none', cam: 'push', decor: [], scheme: 0, seed: (Math.random() * 1e6) | 0 },
  });
  addClip(c);
  warmupClip(c);
  setTimeout(() => { const ta = $('#edText'); if (ta) { ta.focus(); ta.select(); } }, 60);
}
function addSolidAt(t, trackId, color) {
  const tr = trackForKind('image', trackId);
  if (!tr) { toast('没有可用的画面轨道'); return; }
  const c = defaultClip('image', {
    track: tr.id, name: '纯色', start: Math.max(0, frameRound(t)), dur: 4, solid: color || '#1b2233', fit: 'stretch',
  });
  addClip(c);
}
function addPVAt(t, trackId, projectSnapshot, name) {
  const tr = trackForKind('pv', trackId);
  if (!tr) { toast('请先添加一条文字轨道'); return; }
  const c = defaultClip('pv', {
    track: tr.id, name: name || '字面 PV', start: Math.max(0, frameRound(t)),
    dur: 20, pv: projectSnapshot,
  });
  addClip(c);
  try { const plan = planFor(c); c.dur = Math.max(1, plan.duration); recalcDur(); drawTimeline(); } catch (e) {}
}

function warmupAudio(clips) {
  // 解码已经在导入时做过，这里只是确认轨道状态
  for (const c of clips) if (c.kind === 'audio' && ED.playing) PLAY.schedule(ED.t);
}

function splitSelected() {
  const t = ED.t;
  let pool = selClips().filter(c => t > c.start + 0.02 && t < clipEnd(c) - 0.02);
  if (!pool.length) pool = ED.doc.clips.filter(c => t > c.start + 0.02 && t < clipEnd(c) - 0.02);
  if (!pool.length) { toast('播放头下没有可分割的片段'); return; }
  const newIds = [];
  for (const c of pool) {
    const left = t - c.start;
    const origDur = c.dur;
    const right = clone(c);
    right.id = uid('c');
    right.start = t;
    right.dur = origDur - left;
    right.in = (c.in || 0) + left * (c.speed || 1);
    right.transIn = { type: 'none', dur: (c.transIn && c.transIn.dur) || 0.4 };
    c.dur = Math.max(0.05, left);
    if (c.kf) {
      const splitKf = (kf, shift, maxT) => {
        for (const k of Object.keys(kf)) {
          kf[k] = (kf[k] || [])
            .map(p => ({ t: p.t - shift, v: p.v, e: p.e }))
            .filter(p => p.t >= -0.001 && p.t <= maxT + 0.001)
            .map(p => ({ t: Math.max(0, p.t), v: p.v, e: p.e }));
        }
      };
      right.kf = clone(c.kf);
      splitKf(c.kf, 0, left);
      splitKf(right.kf, left, right.dur);
    }
    ED.doc.clips.push(right);
    newIds.push(right.id);
    invalidateClip(c.id); invalidateClip(right.id);
  }
  recalcDur();
  select(newIds);
  snapshot('分割');
  markDirty(); requestRedraw(); drawTimeline();
  toast('已在 ' + tc(t, false) + ' 分割 ' + pool.length + ' 段');
}
function deleteSelected(ripple) {
  const ids = ED.sel.slice();
  if (!ids.length) return;
  const removed = ED.doc.clips.filter(c => ids.includes(c.id));
  ED.doc.clips = ED.doc.clips.filter(c => !ids.includes(c.id));
  if (ripple) {
    const byTrack = {};
    for (const c of removed) (byTrack[c.track] = byTrack[c.track] || []).push(c);
    for (const tid of Object.keys(byTrack)) {
      const spans = byTrack[tid].sort((a, b) => a.start - b.start);
      for (const c of ED.doc.clips) {
        if (c.track !== tid) continue;
        let shift = 0;
        for (const s of spans) if (s.start < c.start - 1e-6) shift += s.dur;
        c.start = Math.max(0, c.start - shift);
      }
    }
  }
  for (const c of removed) invalidateClip(c.id);
  ED.sel = [];
  recalcDur();
  snapshot(ripple ? '波纹删除' : '删除');
  markDirty(); renderInspector(); requestRedraw(); drawTimeline();
  toast(ripple ? '已波纹删除 ' + removed.length + ' 段' : '已删除 ' + removed.length + ' 段');
}
function copySelected() {
  const cs = selClips();
  if (!cs.length) return;
  const base = Math.min(...cs.map(c => c.start));
  ED.clipboard = cs.map(c => { const d = clone(c); d.start -= base; return d; });
  toast('已复制 ' + cs.length + ' 段');
}
function pasteClipboard() {
  if (!ED.clipboard || !ED.clipboard.length) { toast('剪贴板是空的'); return; }
  const ids = [];
  for (const src of ED.clipboard) {
    const d = clone(src);
    d.id = uid('c');
    d.start = frameRound(ED.t + src.start);
    const srcTrack = trackById(src.track);
    const okKind = srcTrack && ((src.kind === 'audio') === (srcTrack.kind === 'audio'));
    d.track = okKind ? srcTrack.id : (trackForKind(src.kind) || srcTrack || ED.doc.tracks[0]).id;
    d.kf = src.kf || {};
    ED.doc.clips.push(d); ids.push(d.id);
    invalidateClip(d.id);
  }
  recalcDur(); select(ids); snapshot('粘贴');
  markDirty(); requestRedraw(); drawTimeline();
  toast('已粘贴 ' + ids.length + ' 段');
}
function duplicateSelected() {
  const cs = selClips();
  if (!cs.length) return;
  const ids = [];
  for (const c of cs) {
    const d = clone(c);
    d.id = uid('c');
    d.start = clipEnd(c);
    d.transIn = { type: 'none', dur: 0.4 };
    ED.doc.clips.push(d); ids.push(d.id);
  }
  recalcDur(); select(ids); snapshot('复制片段');
  markDirty(); requestRedraw(); drawTimeline();
  toast('已复制 ' + ids.length + ' 段');
}
function setClipStart(c, start) {
  c.start = Math.max(0, frameRound(start));
}
function trimClipLeft(c, newStart) {
  const minS = 0;
  const maxS = clipEnd(c) - TL.minDur;
  newStart = clamp(newStart, minS, maxS);
  const delta = newStart - c.start;
  let din = delta * (c.speed || 1);
  if ((c.kind === 'video' || c.kind === 'audio')) {
    if (c.in + din < 0) { din = -c.in; newStart = c.start + din / (c.speed || 1); }
  }
  c.start = newStart;
  c.in = Math.max(0, c.in + din);
  c.dur = Math.max(TL.minDur, clipEnd(c) - newStart);
}
function trimClipRight(c, newEnd) {
  const minE = c.start + TL.minDur;
  newEnd = Math.max(minE, newEnd);
  let dur = newEnd - c.start;
  if (c.kind === 'video' || c.kind === 'audio') {
    const a = assetOf(c);
    if (a) {
      const maxDur = Math.max(TL.minDur, (a.dur - c.in) / (c.speed || 1));
      dur = Math.min(dur, maxDur);
    }
  }
  c.dur = dur;
}
function moveSelection(dt, targetTrack) {
  const single = ED.sel.length === 1;
  for (const c of selClips()) {
    if (!single || !targetTrack) { setClipStart(c, c.start + dt); continue; }
    const tr = trackById(targetTrack);
    if (tr && !tr.lock) {
      const ok = c.kind === 'audio' ? tr.kind === 'audio' : tr.kind !== 'audio';
      if (ok) c.track = tr.id;
    }
    setClipStart(c, c.start + dt);
  }
  recalcDur();
}

/* 时间线指针交互 */
function bindTimeline() {
  const cv = $('#edTl');
  if (!cv) return;
  let drag = null;

  const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const G_unX = (x) => { const G = tlGeom(); return G ? G.unX(x) : 0; };

  cv.addEventListener('pointerdown', (e) => {
    if (e.button === 2) return;
    const p = pos(e);
    const hit = tlHit(p.x, p.y);
    if (!hit) return;
    cv.setPointerCapture(e.pointerId);
    closeMenu();
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    if (hit.type === 'ruler') {
      if (e.altKey) {
        if (e.shiftKey) ED.doc.outPoint = hit.t; else ED.doc.inPoint = hit.t;
        drawTimeline(); toast(ED.doc.inPoint.toFixed(2) + ' – ' + ED.doc.outPoint.toFixed(2));
        return;
      }
      drag = { mode: 'scrub' };
      seek(hit.t);
      return;
    }
    if (hit.type === 'trackbtn') {
      const tr = hit.track;
      tr[hit.key] = !tr[hit.key];
      snapshot('轨道开关');
      markDirty(); drawTimeline(); requestRedraw();
      if (hit.key === 'mute' && ED.playing) PLAY.schedule(ED.t);
      return;
    }
    if (hit.type === 'trackhead') return;
    if (hit.type === 'kf') {
      if (!ED.sel.includes(hit.clip.id)) select([hit.clip.id]);
      drag = { mode: 'kf', clip: hit.clip, kt: hit.kt, x0: p.x, y0: p.y };
      return;
    }
    if (hit.type === 'clip') {
      const c = hit.clip;
      const tr = trackById(c.track);
      if (tr && tr.lock) { toast('轨道已锁定'); return; }
      if (additive) { toggleSelect(c.id); return; }
      if (!ED.sel.includes(c.id)) select([c.id]);
      // 点哪里就把播放头放到哪里（和剪映一样，立刻能看到这一段）
      if (hit.zone === 'body') seek(G_unX(p.x));
      if (hit.zone === 'l' || hit.zone === 'r') {
        drag = { mode: hit.zone === 'l' ? 'trimL' : 'trimR', x0: p.x, y0: p.y, ids: ED.sel.slice(), orig: {} };
        for (const id of ED.sel) { const x = clipById(id); if (x) drag.orig[id] = { start: x.start, dur: x.dur, in: x.in }; }
      } else {
        drag = { mode: 'move', x0: p.x, y0: p.y, ids: ED.sel.slice(), orig: {}, track0: {} };
        for (const id of ED.sel) { const x = clipById(id); if (x) { drag.orig[id] = { start: x.start, dur: x.dur, track: x.track }; } }
      }
      ED.tlDrag = drag;
      drawTimeline();
      return;
    }
    // 空白
    if (!additive) select([]);
    drag = { mode: 'marquee', x0: p.x, y0: p.y, x1: p.x, y1: p.y, add: additive };
    ED.mkSel = drag;
    drawTimeline();
  });

  cv.addEventListener('pointermove', (e) => {
    const p = pos(e);
    if (!drag) {
      const hit = tlHit(p.x, p.y);
      let hov = hit && hit.type === 'clip' ? hit.clip.id : null;
      if (hov !== ED.hoverId) { ED.hoverId = hov; drawTimeline(); }
      cv.style.cursor = !hit ? 'default' : hit.type === 'ruler' ? 'ew-resize'
        : hit.type === 'clip' ? (hit.zone === 'l' || hit.zone === 'r' ? 'col-resize' : 'grab')
          : hit.type === 'kf' ? 'pointer' : 'default';
      return;
    }
    const G = tlGeom();
    if (!G) return;
    if (drag.mode === 'scrub') { seek(G.unX(p.x)); return; }
    if (drag.mode === 'marquee') {
      drag.x1 = p.x; drag.y1 = p.y;
      const x0 = Math.min(drag.x0, drag.x1), x1 = Math.max(drag.x0, drag.x1);
      const y0 = Math.min(drag.y0, drag.y1), y1 = Math.max(drag.y0, drag.y1);
      const found = [];
      for (const row of G.rows) {
        const ry = G.rowY(row), rh = row.h;
        if (ry + rh < y0 || ry > y1) continue;
        for (const c of ED.doc.clips) {
          if (c.track !== row.tr.id) continue;
          const xa = G.X(c.start), xb = G.X(clipEnd(c));
          if (xb >= x0 && xa <= x1) found.push(c.id);
        }
      }
      ED.sel = drag.add ? [...new Set([...ED.sel, ...found])] : found;
      renderInspector();
      drawTimeline();
      return;
    }
    if (drag.mode === 'kf') {
      const c = drag.clip;
      const kt = Math.max(0, Math.min(c.dur, frameRound(drag.kt + (p.x - drag.x0) / ED.pps)));
      for (const k of Object.keys(c.kf || {})) {
        const arr = c.kf[k];
        const i = arr.findIndex(q => Math.abs(q.t - drag.kt) < 0.05);
        if (i >= 0) arr[i].t = kt;
      }
      drawTimeline(); requestRedraw();
      return;
    }
    const single = drag.ids.length === 1;
    if (drag.mode === 'move') {
      const dt0 = (p.x - drag.x0) / ED.pps;
      let dt = dt0;
      // 吸附：单段吸两边，多段吸主段的头尾
      const primary = clipById(drag.ids[0]);
      if (primary) {
        const po = drag.orig[primary.id];
        const wantS = po.start + dt0, wantE = po.start + po.dur + dt0;
        const s1 = snapT(wantS, drag.ids, 8), s2 = snapT(wantE, drag.ids, 8);
        if (Math.abs(s1 - wantS) < Math.abs(s2 - wantE) && !(dt0 < 0 && po.start + dt0 < 0)) dt = s1 - po.start;
        else dt = s2 - po.start - po.dur;
        if (!ED.snap) { ED.snapGuide = null; }
      }
      if (dt0 < 0) {
        for (const id of drag.ids) { const o = drag.orig[id]; if (o && o.start + dt < 0) dt = -o.start; }
      }
      let targetTrack = null;
      if (single) {
        const row = G.rowAt(p.y);
        if (row) targetTrack = row.tr.id;
      }
      for (const id of drag.ids) {
        const c = clipById(id); const o = drag.orig[id];
        if (!c || !o) continue;
        c.start = Math.max(0, frameRound(o.start + dt));
        if (single) {
          const tr = trackById(targetTrack);
          if (tr && !tr.lock) {
            const ok = c.kind === 'audio' ? tr.kind === 'audio' : tr.kind !== 'audio';
            if (ok) c.track = tr.id;
          }
        }
      }
      recalcDur();
      drawTimeline(); requestRedraw(); syncInspectorTime();
      return;
    }
    if (drag.mode === 'trimL' || drag.mode === 'trimR') {
      for (const id of drag.ids) {
        const c = clipById(id); const o = drag.orig[id];
        if (!c || !o) continue;
        const d = (p.x - drag.x0) / ED.pps;
        if (drag.mode === 'trimL') {
          let ns = snapT(o.start + d, drag.ids, 6);
          const din = (ns - o.start) * (c.speed || 1);
          if ((c.kind === 'video' || c.kind === 'audio') && o.in + din < 0) ns = o.start - o.in / (c.speed || 1);
          ns = clamp(ns, 0, o.start + o.dur - TL.minDur);
          c.start = frameRound(ns);
          c.in = Math.max(0, o.in + (c.start - o.start) * (c.speed || 1));
          c.dur = Math.max(TL.minDur, o.start + o.dur - c.start);
        } else {
          let ne = snapT(o.start + o.dur + d, drag.ids, 6);
          let dur = Math.max(TL.minDur, ne - c.start);
          const a = assetOf(c);
          if ((c.kind === 'video' || c.kind === 'audio') && a) dur = Math.min(dur, Math.max(TL.minDur, (a.dur - c.in) / (c.speed || 1)));
          c.dur = frameRound(dur);
        }
        invalidateClip(c.id);
      }
      recalcDur();
      drawTimeline(); requestRedraw(); syncInspectorTime();
    }
  });

  const finish = () => {
    if (!drag) return;
    const wasEdit = drag.mode === 'move' || drag.mode === 'trimL' || drag.mode === 'trimR' || drag.mode === 'kf';
    if (wasEdit) { snapshot(drag.mode === 'move' ? '移动片段' : drag.mode === 'kf' ? '移动关键帧' : '裁切片段'); markDirty(); }
    if (drag.mode === 'marquee') { ED.mkSel = null; ED.snapGuide = null; }
    drag = null; ED.tlDrag = null;
    ED.snapGuide = null;
    drawTimeline(); requestRedraw();
    if (wasEdit) renderInspector();
  };
  cv.addEventListener('pointerup', finish);
  cv.addEventListener('pointercancel', finish);
  cv.addEventListener('pointerleave', () => { if (!drag && ED.hoverId) { ED.hoverId = null; drawTimeline(); } });

  cv.addEventListener('dblclick', (e) => {
    const p = pos(e);
    const hit = tlHit(p.x, p.y);
    if (hit && hit.type === 'clip') {
      if (hit.clip.kind === 'text') { select([hit.clip.id]); showInspTab('text'); setTimeout(() => { const ta = $('#edText'); if (ta) { ta.focus(); ta.select(); } }, 50); }
      else if (hit.clip.kind === 'audio') { select([hit.clip.id]); showInspTab('audio'); }
      else { select([hit.clip.id]); showInspTab('basic'); }
      return;
    }
    if (hit && hit.type === 'empty' && hit.row) {
      const tr = hit.row.tr;
      if (tr.kind === 'text') { addTextAt(G_unX(p.x), tr.id); }
      else if (tr.kind === 'audio') { toast('把音频素材拖进来，或双击素材库里的音频'); }
    }
    function G_unX(x) { const G = tlGeom(); return G ? G.unX(x) : 0; }
  });

  cv.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const p = pos(e);
    const hit = tlHit(p.x, p.y);
    openMenu(e.clientX, e.clientY, hit, p.x);
  });

  // 缩放 / 滚动
  const scroll = $('#edTlScroll');
  cv.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left;
      const G = tlGeom(); if (!G) return;
      const tAt = G.unX(x);
      const f = e.deltaY < 0 ? 1.14 : 1 / 1.14;
      ED.pps = clamp(ED.pps * f, 10, 520);
      drawTimeline();
      scroll.scrollLeft = Math.max(0, TL.head + tAt * ED.pps - x);
      drawTimeline();
    } else if (e.shiftKey) {
      e.preventDefault();
      scroll.scrollLeft += e.deltaY || e.deltaX;
      drawTimeline();
    }
  }, { passive: false });

  scroll.addEventListener('scroll', () => { drawTimeline(); });
}

/* 右键菜单 */
function openMenu(cx, cy, hit, x) {
  const menu = $('#edMenu');
  if (!menu) return;
  const items = [];
  if (hit && hit.type === 'clip') {
    const c = hit.clip;
    if (!ED.sel.includes(c.id)) select([c.id]);
    const t = ED.t;
    if (t > c.start + 0.02 && t < clipEnd(c) - 0.02) items.push({ label: '在播放头分割', kbd: 'S', fn: splitSelected });
    items.push({ label: '复制片段', kbd: 'Ctrl+D', fn: duplicateSelected });
    items.push({ label: '剪切', kbd: 'Ctrl+X', fn: () => { copySelected(); deleteSelected(false); } });
    items.push({ label: '删除', kbd: 'Del', fn: () => deleteSelected(false) });
    items.push({ label: '波纹删除（补上空隙）', kbd: 'Shift+Del', fn: () => deleteSelected(true) });
    if (c.kind === 'text' || c.kind === 'pv') items.push({ label: '换一种随机手法', fn: () => { reRollFx(c); } });
    if (c.kind === 'audio') items.push({ label: '音量标准化', fn: () => { for (const s of selClips()) s.vol = 1; renderInspector(); requestRedraw(); markDirty(); } });
    if (c.kind === 'video' || c.kind === 'audio') {
      const a = assetOf(c);
      if (a) items.push({ label: '按素材原长铺开', fn: () => { c.dur = Math.max(0.1, (a.dur - c.in) / (c.speed || 1)); recalcDur(); drawTimeline(); requestRedraw(); snapshot('按原长'); } });
    }
    items.push({ sep: true });
    items.push({ label: '在播放头打标记', fn: addMarkerAtPlayhead });
  } else if (hit && hit.type === 'ruler') {
    items.push({ label: '设入点 (Alt+点)', fn: () => { ED.doc.inPoint = hit.t; drawTimeline(); } });
    items.push({ label: '设出点 (Alt+Shift+点)', fn: () => { ED.doc.outPoint = hit.t; drawTimeline(); } });
    items.push({ label: '清除入出点', fn: () => { ED.doc.inPoint = 0; ED.doc.outPoint = 0; drawTimeline(); } });
    items.push({ sep: true });
    items.push({ label: '在播放头打标记', fn: addMarkerAtPlayhead });
  } else if (hit && hit.type === 'empty' && hit.row) {
    const tr = hit.row.tr;
    if (tr.kind === 'text') items.push({ label: '在这里加文字', fn: () => addTextAt(G(), tr.id) });
    if (tr.kind !== 'audio') items.push({ label: '加纯色片段', fn: () => addSolidAt(G(), tr.id) });
    items.push({ label: '添加标记', fn: addMarkerAtPlayhead });
    items.push({ sep: true });
    items.push({ label: '添加轨道', fn: () => addTrack(tr.kind === 'audio' ? 'audio' : tr.kind === 'text' ? 'text' : 'video') });
    if (ED.doc.tracks.length > 1) items.push({ label: '删除这条轨道', fn: () => removeTrack(tr.id) });
    function G() { const Gg = tlGeom(); return Gg ? Gg.unX(x) : 0; }
  }
  if (!items.length) return;
  menu.innerHTML = items.map((it, i) => it.sep ? '<hr>' : '<button data-i="' + i + '">' + esc(it.label) + (it.kbd ? '<kbd>' + esc(it.kbd) + '</kbd>' : '') + '</button>').join('');
  menu._items = items;
  menu.classList.add('on');
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(cx, innerWidth - r.width - 8) + 'px';
  menu.style.top = Math.min(cy, innerHeight - r.height - 8) + 'px';
  $$('#edMenu button').forEach(b => {
    b.onclick = () => {
      const it = menu._items[+b.dataset.i];
      closeMenu();
      if (it && it.fn) { it.fn(); snapshot(it.label); markDirty(); }
    };
  });
}
function closeMenu() { const m = $('#edMenu'); if (m) m.classList.remove('on'); }
function addMarkerAtPlayhead() {
  ED.doc.markers.push({ t: ED.t, color: '#38e1c6' });
  drawTimeline(); markDirty();
  toast('已打标记 ' + tc(ED.t, false));
}
function reRollFx(c) {
  if (!c.fx) return;
  c.fx.seed = (Math.random() * 1e6) | 0;
  const L = Object.keys(J.LAYOUTS).filter(k => !J.LAYOUTS[k].special);
  const EN = Object.keys(J.ENTER), HO = Object.keys(J.HOLD), EX = Object.keys(J.EXIT);
  const DE = Object.keys(J.DECOR), BG = Object.keys(J.BG), TR = Object.keys(J.TREAT), CA = Object.keys(J.CAMERA);
  c.fx.layout = L[(Math.random() * L.length) | 0];
  c.fx.enter = EN[(Math.random() * EN.length) | 0];
  c.fx.hold = HO[(Math.random() * HO.length) | 0];
  c.fx.exit = EX[(Math.random() * EX.length) | 0];
  c.fx.decor = Math.random() < 0.5 ? [DE[(Math.random() * DE.length) | 0]] : [];
  c.fx.bg = Math.random() < 0.35 ? BG[(Math.random() * BG.length) | 0] : 'none';
  c.fx.treat = Math.random() < 0.4 ? TR[(Math.random() * TR.length) | 0] : 'none';
  c.fx.cam = CA[(Math.random() * CA.length) | 0];
  invalidateClip(c.id);
  renderInspector(); requestRedraw(); drawTimeline();
  toast('换了一套手法：' + (J.LAYOUTS[c.fx.layout] || {}).name);
}

/* 轨道操作 */
function addTrack(kind) {
  const tr = trackDef(kind, kind === 'audio' ? '音频' + (audioTracks().length + 1) : kind === 'text' ? '文字 ' + (ED.doc.tracks.filter(t => t.kind === 'text').length + 1) : '视频 ' + (ED.doc.tracks.filter(t => t.kind === 'video').length + 1));
  if (kind === 'text') {
    const firstNonText = ED.doc.tracks.findIndex(t => t.kind !== 'text');
    if (firstNonText < 0) ED.doc.tracks.push(tr); else ED.doc.tracks.splice(firstNonText, 0, tr);
  } else if (kind === 'audio') {
    ED.doc.tracks.push(tr);
  } else {
    const firstAudio = ED.doc.tracks.findIndex(t => t.kind === 'audio');
    if (firstAudio < 0) ED.doc.tracks.push(tr); else ED.doc.tracks.splice(firstAudio, 0, tr);
  }
  snapshot('添加轨道');
  markDirty(); drawTimeline();
  toast('已添加' + KIND[kind].label + '轨道');
}
function removeTrack(id) {
  const tr = trackById(id);
  if (!tr) return;
  ED.doc.tracks = ED.doc.tracks.filter(t => t.id !== id);
  ED.doc.clips = ED.doc.clips.filter(c => c.track !== id);
  ED.sel = ED.sel.filter(cid => !!clipById(cid));
  snapshot('删除轨道');
  recalcDur(); markDirty(); renderInspector(); drawTimeline(); requestRedraw();
}

/* ============================================================
   监视器 / 播放
   ============================================================ */
let needRedraw = true;
function requestRedraw() { needRedraw = true; }

function sizeMonitor() {
  const mon = $('#edMon'), cv = $('#edView');
  if (!mon || !cv) return;
  const pad = 28;
  const aw = Math.max(80, mon.clientWidth - pad), ah = Math.max(60, mon.clientHeight - pad);
  const ar = ED.designW / ED.designH;
  let w = aw, h = w / ar;
  if (h > ah) { h = ah; w = h * ar; }
  cv.style.width = Math.round(w) + 'px';
  cv.style.height = Math.round(h) + 'px';
  const maxW = 1180;
  const pxW = Math.max(160, Math.min(maxW, Math.round(w * Math.min(2, devicePixelRatio || 1))));
  const pxH = Math.round(pxW / ar);
  if (cv.width !== pxW || cv.height !== pxH) { cv.width = pxW; cv.height = pxH; layerCache.forEach(r => { r.w = 0; }); }
  needRedraw = true;
}

function drawMonitor() {
  const cv = $('#edView');
  if (!cv || !ED.doc) return;
  const ctx = cv.getContext('2d');
  try { renderFrame(ctx, ED.t, cv.width, cv.height); } catch (e) { console.error(e); }
  const tn = $('#edTimeNow'); if (tn) tn.textContent = tc(ED.t);
  const tf = $('#edFrameNo'); if (tf) tf.textContent = 'F ' + Math.round(ED.t * ED.doc.fps);
  const hint = $('#edMonHint');
  if (hint) hint.hidden = !!topClipAt(ED.t);
  updateTimeAll();
  const now = performance.now();
  if (!ED.playing || now - (drawMonitor._tl || 0) > 34) { drawMonitor._tl = now; drawTimeline(); }
}

function play() {
  if (ED.playing || !ED.doc) return;
  ED.playing = true;
  ED.playStartT = ED.t;
  ED.playStartWall = performance.now();
  PLAY.schedule(ED.t);
  const btn = $('#edPlay'); if (btn) { btn.classList.add('on'); btn.innerHTML = iconPause(); }
  syncVideoPlayback(true);
}
function pause() {
  if (!ED.playing) return;
  ED.playing = false;
  PLAY.stop();
  const btn = $('#edPlay'); if (btn) { btn.classList.remove('on'); btn.innerHTML = iconPlay(); }
  syncVideoPlayback(false);
  ensureVideoFrame();
  requestRedraw();
}
function togglePlay() { if (ED.playing) pause(); else play(); }
function seek(t) {
  ED.t = clamp(t, 0, Math.max(0, timelineEnd() - 0.001));
  if (ED.playing) {
    ED.playStartT = ED.t; ED.playStartWall = performance.now();
    PLAY.schedule(ED.t);
  }
  ensureVideoFrame();
  needRedraw = true;
}
function ensureVideoFrame() {
  for (const c of ED.doc.clips) {
    if (c.kind !== 'video') continue;
    const a = assetOf(c);
    if (!a || !a.el) continue;
    if (ED.t < c.start - 0.02 || ED.t >= clipEnd(c)) { try { a.el.pause(); } catch (e) {} continue; }
    if (ED.playing) continue;
    try { a.el.playbackRate = clamp(c.speed || 1, 0.25, 4); } catch (e) {}
    seekVideo(a.el, videoTarget(c, ED.t - c.start));
  }
}
let lastVideoSync = 0;
function syncVideoPlayback(playing) {
  const now = performance.now();
  if (playing && now - lastVideoSync < 180) return;
  lastVideoSync = now;
  for (const c of ED.doc.clips) {
    if (c.kind !== 'video') continue;
    const a = assetOf(c);
    if (!a || !a.el) continue;
    const active = ED.t >= c.start - 0.05 && ED.t < clipEnd(c);
    if (!active) { try { a.el.pause(); } catch (e) {} continue; }
    const want = videoTarget(c, ED.t - c.start);
    if (!playing) { try { a.el.pause(); } catch (e) {} seekVideo(a.el, want); continue; }
    try {
      a.el.muted = true;
      a.el.playbackRate = clamp(clip.speed || 1, 0.25, 4);
      if (Math.abs(a.el.currentTime - want) > 0.22) a.el.currentTime = clamp(want, 0, Math.max(0, (a.el.duration || 1) - 0.05));
      if (a.el.paused) { a.el.play().catch(() => {}); }
    } catch (e) {}
  }
}

function loopFrame() {
  if (!ED.open) return;
  const now = performance.now();
  if (ED.playing) {
    const wall = ED.playStartT + (now - ED.playStartWall) / 1000;
    const clock = PLAY.ctx && PLAY.ctx.state === 'running' ? PLAY.time() : wall;
    ED.t = Math.max(ED.playStartT, clock);
    const stopAt = ED.doc.outPoint > ED.doc.inPoint + 0.05 ? ED.doc.outPoint : timelineEnd();
    if (ED.t >= stopAt) {
      if (ED.loop) { seek(ED.doc.inPoint || 0); PLAY.schedule(ED.t); ED.playStartT = ED.t; ED.playStartWall = performance.now(); }
      else { ED.t = stopAt; pause(); }
    }
    syncVideoPlayback(true);
    needRedraw = true;
    // 播放头跑出视口时自动跟随
    const scroll = $('#edTlScroll');
    if (scroll) {
      const G = tlGeom();
      if (G) {
        const x = G.X(ED.t);
        if (x > G.vw - 30 || x < TL.head + 20) scroll.scrollLeft = Math.max(0, ED.t * ED.pps - (G.vw - TL.head) * 0.3);
      }
    }
  }
  if (needRedraw) { needRedraw = false; drawMonitor(); }
  requestAnimationFrame(loopFrame);
}

/* ============================================================
   导出 MP4（画面 + 混音）
   ============================================================ */
function iconPlay() { return '<svg viewBox="0 0 24 24" width="15" height="15"><path d="M8 5.2v13.6L19 12z" fill="currentColor"/></svg>'; }
function iconPause() { return '<svg viewBox="0 0 24 24" width="15" height="15"><rect x="7" y="5" width="3.6" height="14" rx="1" fill="currentColor"/><rect x="13.4" y="5" width="3.6" height="14" rx="1" fill="currentColor"/></svg>'; }

function exportRange() {
  const doc = ED.doc;
  const t0 = Math.max(0, doc.inPoint || 0);
  const t1 = doc.outPoint > t0 + 0.08 ? doc.outPoint : timelineEnd();
  return { t0, t1, dur: Math.max(0.2, t1 - t0) };
}

async function renderAudioForExport(t0, dur) {
  const buf = await mixAudio(t0, dur, 48000);
  return buf;
}

async function encodeAudio(muxer, buffer, dur, onProgress) {
  const ac = await J.pickAudioCodec(48000, 2);
  if (!ac) return null;
  const aenc = new AudioEncoder({
    output: (chunk, meta) => { try { muxer.addAudioChunk(chunk, meta); } catch (e) {} },
    error: (e) => { console.warn('audio encoder', e); },
  });
  aenc.configure({ codec: ac.codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 });
  const frames = buffer.length;
  const block = 4800;
  for (let off = 0; off < frames; off += block) {
    const n = Math.min(block, frames - off);
    const data = new Float32Array(n * 2);
    for (let c = 0; c < 2; c++) {
      const ch = buffer.numberOfChannels > c ? buffer.getChannelData(c) : buffer.getChannelData(0);
      data.set(ch.subarray(off, off + n), c * n);
    }
    const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(off * 1e6 / 48000), data });
    aenc.encode(ad); ad.close();
    if (aenc.encodeQueueSize > 12) await new Promise(r => setTimeout(r, 2));
    if (onProgress && (off / block) % 8 === 0) onProgress(off / frames);
  }
  await aenc.flush(); aenc.close();
  return ac;
}

async function exportVideo() {
  if (ED.exporting) { toast('正在导出，请稍候'); return; }
  if (!ED.doc.clips.length) { toast('时间线是空的'); return; }
  if (typeof VideoEncoder === 'undefined') { alert('这个浏览器不支持 WebCodecs 编码（请用 Chrome / Edge 最新版打开）。'); return; }
  if (ED.playing) pause();
  designSizes();
  const { t0, t1, dur } = exportRange();
  const w = ED.outW, h = ED.outH, fps = ED.doc.fps;
  const quality = ED.quality;
  const bitrate = J.videoBitrate(w, h, fps, quality);
  const attempts = await J.videoAttempts(w, h, fps, bitrate);
  if (!attempts.length) { alert('找不到可用的视频编码器。请换 Chrome / Edge，或降低分辨率。'); return; }
  const audioBuf = await renderAudioForExport(t0, dur);
  const ac = audioBuf ? await J.pickAudioCodec(48000, 2) : null;
  let attempt = 0, vc = attempts[0];
  ED.exporting = true;
  ED.exportAbort = { aborted: false };
  showExportModal('导出视频', w + '×' + h + ' · ' + fps + 'fps · ' + dur.toFixed(1) + ' 秒');
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { alpha: false });
  const totalFrames = Math.max(1, Math.round(dur * fps));
  let blob = null, lastErr = null;
  for (attempt = 0; attempt < attempts.length && !blob; attempt++) {
    vc = attempts[attempt];
    let muxer = null, venc = null;
    try {
      const target = new Mp4Muxer.ArrayBufferTarget();
      const mo = {
        target, fastStart: 'in-memory', firstTimestampBehavior: 'offset',
        video: { codec: vc.mux, width: w, height: h, frameRate: fps },
      };
      if (ac && audioBuf) mo.audio = { codec: ac.mux, numberOfChannels: 2, sampleRate: 48000 };
      muxer = new Mp4Muxer.Muxer(mo);
      let encErr = null;
      venc = new VideoEncoder({ output: (ch, meta) => { try { muxer.addVideoChunk(ch, meta); } catch (e) { encErr = e; } }, error: (e) => { encErr = e; } });
      venc.configure(Object.assign({}, vc.cfg, { latencyMode: 'quality' }));
      let outFrames = 0;
      const keyEvery = Math.max(1, Math.round(fps * 2));
      for (let i = 0; i < totalFrames; i++) {
        if (ED.exportAbort && ED.exportAbort.aborted) throw new Error('已取消');
        if (encErr) throw encErr;
        const t = t0 + i / fps;
        await prepareFrame(t);
        renderFrame(ctx, t, w, h);
        const vf = new VideoFrame(cv, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
        try { venc.encode(vf, { keyFrame: i % keyEvery === 0 }); } finally { vf.close(); }
        outFrames++;
        let spins = 0;
        while (venc.encodeQueueSize > 6 && !encErr) { await new Promise(r => setTimeout(r, 2)); if (!document.hidden && ++spins > 20000) throw new Error('编码器无响应'); }
        if (i % 2 === 0) setExportProgress((i / totalFrames) * 0.86, '画面 ' + (i + 1) + ' / ' + totalFrames);
      }
      await venc.flush();
      if (encErr) throw encErr;
      if (ac && audioBuf) {
        setExportProgress(0.9, '混音 / 音频编码');
        await encodeAudio(muxer, audioBuf, dur, k => setExportProgress(0.9 + k * 0.06, '音频编码'));
      }
      setExportProgress(0.98, '写出 MP4');
      muxer.finalize();
      blob = new Blob([target.buffer], { type: 'video/mp4' });
      if (!blob.size) throw new Error('导出的文件是空的');
    } catch (e) {
      lastErr = e;
      try { if (venc && venc.state !== 'closed') venc.close(); } catch (e2) {}
      if (ED.exportAbort && ED.exportAbort.aborted) break;
      console.warn('导出尝试失败', vc && vc.label, e);
    }
  }
  ED.exporting = false;
  if (!blob) {
    const wasAborted = !!(ED.exportAbort && ED.exportAbort.aborted);
    hideExportModal();
    if (wasAborted) { toast('已取消导出'); return; }
    alert('导出失败：' + (lastErr && lastErr.message || lastErr) + '\n\n试试降低分辨率 / 帧率，或用 Chrome 打开。');
    return;
  }
  setExportProgress(1, '完成');
  const base = (ED.doc.name || '字面剪辑').replace(/[\\/:*?"<>|]/g, '_');
  await new Promise(r => setTimeout(r, 220));
  await J.saveFile(base + '_' + Math.round(w) + 'x' + Math.round(h) + '.mp4', blob);
  hideExportModal();
  toast('导出完成 · ' + (blob.size / 1048576).toFixed(1) + ' MB' + (ac ? '（含音频）' : ''));
}

async function exportFramePNG() {
  const cv = document.createElement('canvas');
  cv.width = ED.outW; cv.height = ED.outH;
  const ctx = cv.getContext('2d');
  await prepareFrame(ED.t);
  renderFrame(ctx, ED.t, cv.width, cv.height);
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  await J.saveFile((ED.doc.name || 'frame') + '_' + tc(ED.t, false).replace(':', '-') + '.png', blob);
  toast('已导出当前帧 PNG');
}

/* 进度弹层 */
function showExportModal(title, sub) {
  const m = $('#edModal');
  if (!m) return;
  m.classList.add('on');
  $('#edModalTitle').textContent = title;
  $('#edModalSub').textContent = sub || '';
  $('#edModalBody').innerHTML = '<div class="ed-prog"><i id="edProgFill"></i></div><div class="ed-prog-lb" id="edProgLb">准备中…</div>';
  $('#edModalActs').innerHTML = '<button class="ed-btn" id="edModalCancel">取消</button>';
  $('#edModalCancel').onclick = () => { if (ED.exportAbort) ED.exportAbort.aborted = true; };
}
function setExportProgress(k, label) {
  const f = $('#edProgFill'), l = $('#edProgLb');
  if (f) f.style.width = Math.round(clamp(k, 0, 1) * 100) + '%';
  if (l && label) l.textContent = label + ' · ' + Math.round(clamp(k, 0, 1) * 100) + '%';
}
function hideExportModal() { const m = $('#edModal'); if (m) m.classList.remove('on'); ED.exportAbort = null; }

/* ============================================================
   工程存档（.json，可带走）
   ============================================================ */
function blobToDataURL(blob) {
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(blob); });
}
function dataURLToBlob(u) {
  const [head, b64] = String(u).split(',');
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64 || '');
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
async function saveProjectFile() {
  toast('正在打包工程（含素材）…');
  const assets = [];
  for (const a of Object.values(ED.assets)) {
    try {
      const data = await blobToDataURL(a.blob);
      assets.push({ id: a.id, name: a.name, kind: a.kind, data });
    } catch (e) {}
  }
  const out = { v: 1, at: Date.now(), doc: ED.doc, assets };
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  await J.saveFile((ED.doc.name || '字面剪辑') + '.zimedit.json', blob);
  toast('工程已保存（' + (blob.size / 1048576).toFixed(1) + ' MB）');
}
async function openProjectFile(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || !data.doc) throw new Error('不是剪辑台工程文件');
    ED.doc = Object.assign(newDoc(), data.doc);
    if (!ED.doc.tracks || !ED.doc.tracks.length) ED.doc.tracks = newDoc().tracks;
    ED.assets = {}; ED.sel = []; ED.t = 0; ED.clipboard = null;
    designSizes(); recalcDur();
    for (const a of data.assets || []) {
      if (!a.data) continue;
      const blob = dataURLToBlob(a.data);
      const rec = await addAsset(blob, a.name, { kind: a.kind });
      if (rec) { ED.assets[a.id] = rec; rec.id = a.id; }
    }
    syncDocInputs(); renderBin(); renderInspector(); drawTimeline(); requestRedraw();
    snapshot('打开工程'); markDirty();
    toast('工程已打开：' + ED.doc.name);
  } catch (e) { alert('打开失败：' + e.message); }
}

/* ============================================================
   界面外壳
   ============================================================ */
let built = false;
function buildShell() {
  if (built) return;
  const root = $('#ed');
  if (!root) return;
  root.innerHTML = `
  <header class="ed-top">
    <div class="ed-logo"><i>剪</i><div><b>字面剪</b><br><span>STUDIO EDIT</span></div></div>
    <input class="ed-name" id="edName" value="未命名剪辑" spellcheck="false" title="工程名">
    <div class="sep"></div>
    <button class="ed-btn sm icon" id="edUndo" title="撤销 Ctrl+Z">↶</button>
    <button class="ed-btn sm icon" id="edRedo" title="重做 Ctrl+Shift+Z">↷</button>
    <div class="sep"></div>
    <label class="f">画幅
      <select class="ed-sel" id="edAspect" style="width:78px">
        <option value="16:9">16:9</option><option value="9:16">9:16</option>
        <option value="1:1">1:1</option><option value="4:5">4:5</option>
        <option value="4:3">4:3</option><option value="21:9">21:9</option>
      </select></label>
    <label class="f">分辨率
      <select class="ed-sel" id="edRes" style="width:82px">
        <option value="720">720p</option><option value="1080">1080p</option><option value="1440">1440p</option>
      </select></label>
    <label class="f">帧率
      <select class="ed-sel" id="edFps" style="width:68px">
        <option value="24">24</option><option value="30">30</option><option value="60">60</option>
      </select></label>
    <div class="grow"></div>
    <button class="ed-btn" id="edOpenProj" title="打开 .zimedit.json 工程">打开工程</button>
    <button class="ed-btn" id="edSaveProj" title="打包成 json（素材一起带走）">保存工程</button>
    <button class="ed-btn" id="edHelp" title="快捷键与说明">?</button>
    <button class="ed-btn primary" id="edExportBtn" title="导出 MP4（Ctrl+E）">导出视频</button>
    <button class="ed-btn ghost" id="edClose" title="回到文字 PV 工房">← PV 工房</button>
  </header>
  <main class="ed-main">
    <aside class="ed-side ed-left">
      <div class="ed-side-head"><b>素材库</b><span class="sp"></span>
        <button class="ed-btn sm" id="edImport" title="导入图片 / 视频 / 音频（可多选，Ctrl+I）">＋ 导入</button>
      </div>
      <div class="ed-bin-body" id="edBin">
        <div class="ed-gen">
          <button data-gen="text"><i>文</i>新建文字</button>
          <button data-gen="solid"><i>▣</i>纯色底</button>
          <button data-gen="audio"><i>♫</i>导入音乐</button>
          <button data-gen="import"><i>＋</i>导入素材</button>
          <button data-gen="pv" style="grid-column:1/-1"><i>✦</i>带入 PV 工房的工程（整段编舞）</button>
        </div>
        <div class="ed-assets" id="edAssets"></div>
        <div class="ed-bin-empty" id="edBinEmpty">
          <b>把素材拖进来</b><br>
          图片 · 视频 · 音频 · 整段音乐<br>
          也可以直接拖到时间线上
        </div>
      </div>
      <input type="file" id="edFile" multiple accept="image/*,video/*,audio/*" hidden>
      <input type="file" id="edProjFile" accept=".json,application/json" hidden>
    </aside>
    <section class="ed-center">
      <div class="ed-mon-wrap">
        <div class="ed-mon" id="edMon">
          <canvas id="edView"></canvas>
          <div class="ed-mon-badge"><b>PROGRAM</b><span id="edMonSize"></span></div>
          <div class="ed-mon-hint" id="edMonHint" hidden>此处没有画面 · 把素材拖到时间线</div>
          <div class="ed-mon-tools">
            <button id="edFramePNG" title="导出当前帧 PNG">⤓</button>
          </div>
        </div>
        <div class="ed-play">
          <button class="go" id="edPlay" title="播放 / 暂停（空格）">${iconPlay()}</button>
          <div class="ed-time"><span class="now" id="edTimeNow">00:00.000</span><span class="sep">/</span><span class="all" id="edTimeAll">00:00.000</span></div>
          <span class="ed-frame" id="edFrameNo">F 0</span>
          <label class="check ed-row" style="margin:0"><input type="checkbox" id="edLoop"> 循环</label>
          <button class="ed-tool" id="edInBtn" title="把播放头设为入点（I）">入点</button>
          <button class="ed-tool" id="edOutBtn" title="把播放头设为出点（O）">出点</button>
          <button class="ed-tool" id="edInOutClear" title="清除入点 / 出点">×</button>
          <div class="grow"></div>
          <div class="ed-vol">♪<input type="range" id="edVol" min="0" max="100" value="90" style="width:76px" title="预览音量"></div>
          <select class="ed-sel" id="edQuality" style="width:92px" title="导出画质">
            <option value="high">高画质</option><option value="max">最高画质</option><option value="std">标准</option>
          </select>
        </div>
      </div>
      <div class="ed-tl" id="edTlBox">
        <div class="ed-tl-grip" id="edTlGrip" title="拖动调整时间线高度"></div>
        <div class="ed-tl-bar">
          <button class="ed-tool" id="edCut" title="在播放头分割（S）">✂ 分割</button>
          <button class="ed-tool" id="edDel" title="删除选中（Delete）">删除</button>
          <button class="ed-tool" id="edRipple" title="波纹删除：后面的片段自动补上（Shift+Delete）">波纹删</button>
          <button class="ed-tool" id="edDup" title="复制选中片段（Ctrl+D）">复制</button>
          <span class="grow"></span>
          <button class="ed-tool" id="edAddTextBtn" title="在播放头加一段文字（T）">＋文字</button>
          <button class="ed-tool" id="edAddTrackBtn" title="添加轨道">＋轨道</button>
          <button class="ed-tool on" id="edSnapBtn" title="吸附片段边缘 / 播放头（N）">吸附</button>
          <button class="ed-tool" id="edSnapBeatBtn" title="额外吸附节拍（B）">拍点</button>
          <input class="ed-zoom" id="edZoom" type="range" min="10" max="320" value="70" title="时间线缩放">
          <button class="ed-tool" id="edZoomFit" title="适配窗口（Shift+Z）">适配</button>
        </div>
        <div class="ed-tl-scroll" id="edTlScroll"><div class="ed-tl-inner" id="edTlInner"></div></div>
        <canvas id="edTl"></canvas>
        <div class="ed-tl-hint" id="edTlHint">拖动=移动 · 边缘=裁切 · 双击=改属性 · Ctrl+滚轮=缩放 · 右键=更多</div>
      </div>
    </section>
    <aside class="ed-side ed-right">
      <div class="ed-insp">
        <div class="ed-insp-head"><span class="dot" id="edSelDot"></span><span class="nm" id="edSelName">未选中</span><span class="kd" id="edSelKind"></span></div>
        <div class="ed-insp-tabs">
          <button class="ed-tab on" data-itab="basic">画面</button>
          <button class="ed-tab" data-itab="text">文字</button>
          <button class="ed-tab" data-itab="anim">动画</button>
          <button class="ed-tab" data-itab="fx">效果</button>
          <button class="ed-tab" data-itab="audio">音频</button>
        </div>
        <div class="ed-insp-body" id="edInsp"></div>
      </div>
    </aside>
  </main>
  <div class="ed-modal" id="edModal">
    <div class="ed-modal-box">
      <h3 id="edModalTitle">导出</h3>
      <p id="edModalSub"></p>
      <div id="edModalBody"></div>
      <div class="ed-modal-acts" id="edModalActs"></div>
    </div>
  </div>
  <div class="ed-menu" id="edMenu"></div>
  <div class="ed-toast" id="edToast"></div>`;
  built = true;
  sizeMonitor();
  drawTimeline();
}

function toast(msg, ms) {
  const t = $('#edToast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('on'), ms || 1900);
}

/* ───────── 素材库渲染 ───────── */
function renderBin() {
  const grid = $('#edAssets'), empty = $('#edBinEmpty');
  if (!grid) return;
  const list = Object.values(ED.assets);
  if (empty) empty.style.display = list.length ? 'none' : '';
  grid.innerHTML = list.map(a => `
    <div class="ed-asset" draggable="true" data-id="${a.id}" title="${esc(a.name)}｜点击加到播放头，或拖到时间线">
      <div class="th ${a.kind === 'audio' ? 'audio' : ''}" data-th="${a.id}">${a.kind === 'audio' ? '♫' : ''}</div>
      <span class="tag ${a.kind}">${KIND[a.kind] ? KIND[a.kind].label : a.kind}</span>
      <span class="dur">${durTxt(a.dur)}</span>
      <span class="nm">${esc(a.name)}</span>
      <button class="x" data-del="${a.id}" title="从素材库移除">×</button>
    </div>`).join('');
  for (const a of list) {
    if (a.kind === 'audio' || !a.thumb) continue;
    const el = grid.querySelector('[data-th="' + a.id + '"]');
    if (el) el.style.backgroundImage = 'url("' + a.thumb.replace(/"/g, '%22') + '")';
  }
  $$('#edAssets .ed-asset').forEach(el => {
    const id = el.dataset.id;
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-del]')) return;
      addAssetAt(id, ED.t);
    });
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/x-ed-asset', id);
      e.dataTransfer.effectAllowed = 'copy';
    });
    el.addEventListener('dblclick', () => { ED.inPoint = 0; addAssetAt(id, ED.t); });
  });
  $$('#edAssets [data-del]').forEach(b => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const id = b.dataset.del;
    const used = ED.doc.clips.filter(c => c.asset === id).length;
    if (used && !confirm('这个素材正在被 ' + used + ' 个片段使用，仍然移除吗？（片段会变成占位）')) return;
    delete ED.assets[id];
    await idbDel(id);
    renderBin(); requestRedraw(); drawTimeline();
  }));
}

/* ───────── 属性面板 ───────── */
ED.itab = 'basic';
function showInspTab(name) {
  ED.itab = name;
  $$('.ed-insp-tabs .ed-tab').forEach(b => b.classList.toggle('on', b.dataset.itab === name));
  renderInspector();
}
function updateInspHead() {
  const c = selClip();
  const name = $('#edSelName'), kind = $('#edSelKind'), dot = $('#edSelDot');
  if (!name) return;
  if (!c) {
    name.textContent = ED.sel.length > 1 ? '已选 ' + ED.sel.length + ' 段' : '未选中片段';
    kind.textContent = '';
    dot.style.background = '#3a465c';
  } else {
    name.textContent = c.kind === 'text' ? ('“' + (c.text || '').split('\n')[0].slice(0, 18) + '”') : c.name || KIND[c.kind].label;
    kind.textContent = KIND[c.kind].label + ' · ' + c.dur.toFixed(2) + 's';
    dot.style.background = KIND[c.kind].c;
  }
}
function outTxt(prop, v, c) {
  if (prop === 'opacity' || prop === 'vol') return Math.round(v * 100) + '%';
  if (prop === 'scale') return (+v).toFixed(2) + '×';
  if (prop === 'rot') return Math.round(v) + '°';
  if (prop === 'x' || prop === 'y') return Math.round(v) + 'px';
  if (prop === 'f.b' || prop === 'f.c' || prop === 'f.s') return (+v).toFixed(2);
  if (prop === 'f.hue') return Math.round(v) + '°';
  if (prop === 'f.blur') return (+v).toFixed(1) + 'px';
  if (prop === 'f.sepia') return Math.round(v * 100) + '%';
  if (prop === 'start' || prop === 'dur' || prop === 'in') return tc(v);
  if (prop === 'fadeIn' || prop === 'fadeOut') return (+v).toFixed(2) + 's';
  if (prop === 'inDur' || prop === 'outDur') return (+v).toFixed(2) + 's';
  if (prop === 'speed') return (+v).toFixed(2) + '×';
  return String(v);
}
function rangeRow(label, prop, min, max, step, val, out) {
  return `<div class="ed-slider"><div class="lab">${label}<b data-out="${prop}">${out != null ? out : outTxt(prop, val)}</b></div>
    <input type="range" data-p="${prop}" min="${min}" max="${max}" step="${step}" value="${val}"></div>`;
}
function selRow(label, prop, options, val) {
  return `<div class="ed-row"><label>${label}</label><select class="ed-sel grow" data-p="${prop}">${options.map(o => `<option value="${esc(o[0])}"${String(o[0]) === String(val) ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select></div>`;
}
function regOptions(map, extra) {
  const out = extra ? extra.slice() : [];
  for (const k of Object.keys(map)) {
    const it = map[k];
    if (!it || it.special) continue;
    out.push([k, it.name || k]);
  }
  return out;
}
function styleOptions(cur) {
  const order = J.STYLE_ORDER || Object.keys(J.STYLES);
  return order.filter(k => J.STYLES[k]).map(k => [k, (J.STYLES[k].name || k)]);
}
function fontOptions(cur) {
  const out = [['', '跟随风格']];
  for (const f of (J.LOCAL_FONT_PICKS || [])) out.push([f.key, f.name]);
  return out;
}

function renderInspector() {
  const body = $('#edInsp');
  if (!body) return;
  $$('.ed-insp-tabs .ed-tab').forEach(b => b.classList.toggle('on', b.dataset.itab === ED.itab));
  updateInspHead();
  const clips = selClips();
  if (!clips.length) { body.innerHTML = emptyInspHTML(); bindInsp(); return; }
  if (clips.length > 1) { body.innerHTML = multiInspHTML(clips); bindInsp(); return; }
  const c = clips[0];
  const tab = ED.itab;
  let html = '';
  if (tab === 'basic') html = basicHTML(c);
  else if (tab === 'text') html = textHTML(c);
  else if (tab === 'anim') html = animHTML(c);
  else if (tab === 'fx') html = fxHTML(c);
  else if (tab === 'audio') html = audioHTML(c);
  body.innerHTML = html;
  bindInsp();
  drawAudioPreview(c);
}

function emptyInspHTML() {
  return `<div class="ed-empty-insp">
    <b>没有选中片段</b><br>
    点时间线上的片段 → 这里调属性。<br><br>
    <b>上手三步</b><br>
    1. 左边「新建文字」，双击时间线上的文字块改字<br>
    2. 右侧「文字」里挑版式 / 入场 / 退场，就是手法库<br>
    3. 拖入音乐，按空格听，按 <kbd>S</kbd> 分割、<kbd>Ctrl</kbd>+<kbd>E</kbd> 导出<br><br>
    <b>工程设置</b>
    <div class="ed-sec" style="margin-top:8px"><div class="ed-sec-body">
      <div class="ed-row"><label>背景色</label><input type="color" data-proj="bg" value="${esc(ED.doc.bg)}" class="ed-in" style="height:28px;padding:2px"></div>
      ${selRow('背景类型', '__bgStyle', [['solid', '纯色'], ['grad', '渐变']], ED.doc.bgStyle)}
      ${ED.doc.bgStyle === 'grad' ? '<div class="ed-row"><label>渐变到</label><input type="color" data-proj="bg2" value="' + esc(ED.doc.bg2 || '#000000') + '" class="ed-in" style="height:28px;padding:2px"></div>' : ''}
      <div class="ed-row"><label>BPM</label><input class="ed-in" type="number" data-proj="bpm" min="0" max="300" value="${ED.doc.bpm || 0}" style="width:78px"></div>
      <p class="ed-kfnote">BPM 用来画节拍线；开了「拍点」吸附后拖片段会吸到拍上。</p>
      <div class="ed-row"><label>轨道</label><span style="color:#8b96ab;font-size:11px">${ED.doc.tracks.length} 条</span></div>
      <div class="ed-row two" style="margin-top:9px">
        <button class="ed-btn" data-act="demoDoc">恢复示例</button>
        <button class="ed-btn" data-act="newDoc">新建空工程</button>
      </div>
    </div></div>
  </div>`;
}

function multiInspHTML(clips) {
  const kinds = [...new Set(clips.map(c => KIND[c.kind].label))].join(' / ');
  return `<div class="ed-empty-insp"><b>已选 ${clips.length} 段</b>（${esc(kinds)}）</div>
  <div class="ed-sec"><h4>批量</h4><div class="ed-sec-body">
    <div class="ed-row two">
      <button class="ed-btn" data-act="alignStart">起点对齐</button>
      <button class="ed-btn" data-act="alignEnd">终点对齐</button>
    </div>
    <div class="ed-row two">
      <button class="ed-btn" data-act="spaceEven">等距排列</button>
      <button class="ed-btn" data-act="dupSel">复制一份</button>
    </div>
    <div class="ed-row two">
      <button class="ed-btn" data-act="delSel">删除</button>
      <button class="ed-btn" data-act="rippleSel">波纹删除</button>
    </div>
    ${rangeRow('整体不透明度', 'opacity', 0, 1, 0.01, 1)}
    ${rangeRow('整体音量', 'vol', 0, 1, 0.01, 1)}
  </div></div>`;
}

function basicHTML(c) {
  const a = assetOf(c);
  const isAud = c.kind === 'audio';
  let html = `<div class="ed-cliphead">
    <div class="ic" style="color:${KIND[c.kind].c}">${KIND[c.kind].ic}</div>
    <div class="meta"><b>${esc(c.name || KIND[c.kind].label)}</b><small>${KIND[c.kind].label} · ${c.dur.toFixed(2)}s${a ? ' · 源 ' + a.dur.toFixed(1) + 's' : ''}${c.kind === 'image' && c.solid ? ' · 纯色' : ''}</small></div>
  </div>`;
  if (!isAud) {
    html += `<div class="ed-sec"><h4>变换</h4><div class="ed-sec-body">
      ${rangeRow('水平位置', 'x', -ED.designW, ED.designW, 1, c.x)}
      ${rangeRow('垂直位置', 'y', -ED.designH, ED.designH, 1, c.y)}
      ${rangeRow('缩放', 'scale', 0.02, 4, 0.01, c.scale)}
      ${rangeRow('旋转', 'rot', -180, 180, 0.5, c.rot)}
      ${rangeRow('不透明度', 'opacity', 0, 1, 0.01, c.opacity)}
      ${selRow('适配', 'fit', [['cover', '铺满（裁切）'], ['contain', '完整（留边）'], ['stretch', '拉伸'], ['raw', '原始像素']], c.fit)}
      ${selRow('混合模式', 'blend', BLENDS.map(b => [b, b === 'normal' ? '正常' : b]), c.blend)}
    </div></div>`;
  }
  html += `<div class="ed-sec"><h4>时间</h4><div class="ed-sec-body">
    <div class="ed-row two">
      <label>起点<input class="ed-in ed-tin" type="number" data-p="start" step="0.01" min="0" value="${c.start.toFixed(3)}"></label>
      <label>时长<input class="ed-in" type="number" data-p="dur" step="0.01" min="0.05" value="${c.dur.toFixed(3)}"></label>
    </div>
    ${c.kind === 'video' || c.kind === 'audio' ? `<div class="ed-row two"><label>源入点<input class="ed-in" type="number" data-p="in" step="0.01" min="0" value="${(c.in || 0).toFixed(3)}"></label>
    <label>速度<input class="ed-in" type="number" data-p="speed" step="0.05" min="0.25" max="4" value="${(c.speed || 1).toFixed(2)}"></label></div>` : ''}
    <div class="ed-kfnote">提示：拖时间线片段两端也能改起点 / 时长。</div>
  </div></div>`;
  html += `<div class="ed-sec"><h4>转场</h4><div class="ed-sec-body">
    ${selRow('入点', 'transIn.type', TRANS_LIST, c.transIn && c.transIn.type || 'none')}
    ${rangeRow('入点时长', 'transIn.dur', 0.05, 2, 0.05, c.transIn && c.transIn.dur || 0.45)}
    ${selRow('出点', 'transOut.type', TRANS_LIST, c.transOut && c.transOut.type || 'none')}
    ${rangeRow('出点时长', 'transOut.dur', 0.05, 2, 0.05, c.transOut && c.transOut.dur || 0.45)}
    <p class="ed-kfnote">同一轨道上与前一段相邻时，溶解类转场会直接交叉混；不然就是和背景 / 黑场过渡。</p>
  </div></div>`;
  if (!isAud) html += `<div class="ed-sec"><h4>滤镜</h4><div class="ed-sec-body">
    ${rangeRow('亮度', 'f.b', 0.2, 2, 0.01, c.f.b)}
    ${rangeRow('对比度', 'f.c', 0.2, 2.5, 0.01, c.f.c)}
    ${rangeRow('饱和度', 'f.s', 0, 2.5, 0.01, c.f.s)}
    ${rangeRow('色相', 'f.hue', -180, 180, 1, c.f.hue)}
    ${rangeRow('模糊', 'f.blur', 0, 24, 0.5, c.f.blur)}
    ${rangeRow('怀旧', 'f.sepia', 0, 1, 0.01, c.f.sepia)}
    <div class="ed-chips" style="margin-top:8px">
      <button class="ed-chip" data-act="filter:原片">原片</button>
      <button class="ed-chip" data-act="filter:黑白">黑白</button>
      <button class="ed-chip" data-act="filter:胶片">胶片</button>
      <button class="ed-chip" data-act="filter:冷调">冷调</button>
      <button class="ed-chip" data-act="filter:暖调">暖调</button>
      <button class="ed-chip" data-act="filter:故障">故障</button>
      <button class="ed-chip" data-act="filter:柔光">柔光</button>
    </div>
  </div></div>`;
  return html;
}

function textHTML(c) {
  if (c.kind === 'pv') {
    const lines = c.pv && c.pv.lyrics ? c.pv.lyrics.split('\n').filter(Boolean).length : 0;
    return `<div class="ed-empty-insp"><b>PV 层</b><br>从「文字 PV 工房」送上来的整段编舞，画面按原来的手法完整播放。<br>
      想在剪辑台里修改其中某一句：回到 PV 工房改，再送一次；或者在这里新建文字片段。</div>
      <div class="ed-sec"><h4>信息</h4><div class="ed-sec-body">
        <div class="ed-row"><label>歌词行</label><span style="font-size:12px;color:#cfd8ea">${lines} 行</span></div>
        ${selRow('配色', 'pvStyle', styleOptions(), c.pv && c.pv.style)}
        ${rangeRow('不透明度', 'opacity', 0, 1, 0.01, c.opacity)}
        ${rangeRow('缩放', 'scale', 0.02, 3, 0.01, c.scale)}
      </div></div>`;
  }
  const F = c.fx || {};
  const decorOpts = Object.keys(J.DECOR).map(k => `<label class="ed-chip${(F.decor || []).includes(k) ? ' on' : ''}"><input type="checkbox" data-decor="${k}" ${(F.decor || []).includes(k) ? 'checked' : ''} hidden>${esc((J.DECOR[k] && J.DECOR[k].name) || k)}</label>`).join('');
  return `<div class="ed-cliphead">
    <div class="ic" style="color:${KIND.text.c}">文</div>
    <div class="meta"><b>${esc((c.text || '').split('\n')[0].slice(0, 24) || '文字')}</b><small>文字片段 · ${c.dur.toFixed(2)}s</small></div>
    <button class="ed-btn sm" data-act="randomFx" title="随机换一套手法">🎲</button>
  </div>
  <div class="ed-sec"><h4>成套预设<span class="sp"></span><small>一次改一整条效果链</small></h4><div class="ed-sec-body"><div class="ed-chips">
    <button class="ed-chip" data-act="tp:重击标题">重击标题</button>
    <button class="ed-chip" data-act="tp:抒情字幕">抒情字幕</button>
    <button class="ed-chip" data-act="tp:手帐贴纸">手帐贴纸</button>
    <button class="ed-chip" data-act="tp:故障标题">故障标题</button>
    <button class="ed-chip" data-act="tp:电影字幕">电影字幕</button>
    <button class="ed-chip" data-act="tp:大字竖排">大字竖排</button>
    <button class="ed-chip" data-act="tp:复古海报">复古海报</button>
    <button class="ed-chip" data-act="tp:极简说明">极简说明</button>
  </div></div></div>
  <div class="ed-sec"><h4>内容</h4><div class="ed-sec-body">
    <textarea class="ed-ta" id="edText" data-p="text" spellcheck="false" placeholder="在这里写文字，回车换行">${esc(c.text || '')}</textarea>
    <div class="ed-row" style="margin-top:7px">
      <label>样式</label><select class="ed-sel grow" data-p="style">${styleOptions().map(o => `<option value="${o[0]}"${(c.style || ED.doc.style) === o[0] ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select>
    </div>
    <div class="ed-row"><label>字体</label><select class="ed-sel grow" data-p="font">${fontOptions().map(o => `<option value="${esc(o[0])}"${c.font === o[0] ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select></div>
  </div></div>
  <div class="ed-sec"><h4>手法 · 构图与动画</h4><div class="ed-sec-body">
    ${selRow('构图', 'fx.layout', regOptions(J.LAYOUTS), F.layout)}
    ${selRow('入场', 'fx.enter', regOptions(J.ENTER), F.enter)}
    ${selRow('停留', 'fx.hold', regOptions(J.HOLD), F.hold)}
    ${selRow('退场', 'fx.exit', regOptions(J.EXIT), F.exit)}
    ${selRow('质感', 'fx.treat', regOptions(J.TREAT, [['none', '无']]), F.treat)}
    ${selRow('背景', 'fx.bg', regOptions(J.BG, [['none', '无']]), F.bg)}
    ${selRow('镜头', 'fx.cam', regOptions(J.CAMERA), F.cam)}
    ${selRow('配色方案', 'fx.scheme', [['0', 'A'], ['1', 'B'], ['2', 'C'], ['3', 'D']], String(F.scheme || 0))}
    <div class="ed-row two">
      <label>入场时长<input class="ed-in" type="number" data-p="inDur" step="0.05" min="0" max="4" value="${c.inDur || 0}"></label>
      <label>退场时长<input class="ed-in" type="number" data-p="outDur" step="0.05" min="0" max="4" value="${c.outDur || 0}"></label>
    </div>
    <p class="ed-kfnote">0 = 跟手法本身（手法自己决定节奏）。</p>
  </div></div>
  <div class="ed-sec"><h4>装饰</h4><div class="ed-sec-body">
    <div class="ed-chips" style="max-height:150px;overflow:auto">${decorOpts}</div>
  </div></div>
  <div class="ed-sec"><h4>画面</h4><div class="ed-sec-body">
    ${rangeRow('缩放', 'scale', 0.05, 3, 0.01, c.scale)}
    ${rangeRow('不透明度', 'opacity', 0, 1, 0.01, c.opacity)}
    ${rangeRow('旋转', 'rot', -180, 180, 0.5, c.rot)}
    ${selRow('混合模式', 'blend', BLENDS.map(b => [b, b === 'normal' ? '正常' : b]), c.blend)}
    ${selRow('入场转场', 'transIn.type', TRANS_LIST, c.transIn && c.transIn.type || 'none')}
    ${selRow('退场转场', 'transOut.type', TRANS_LIST, c.transOut && c.transOut.type || 'none')}
  </div></div>`;
}

function animHTML(c) {
  const lt = Math.max(0, ED.t - c.start);
  const props = KF_PROPS.filter(p => c.kind !== 'audio' || p[0] === 'vol' || p[0] === 'opacity');
  const cur = ED.kfProp && props.some(p => p[0] === ED.kfProp) ? ED.kfProp : props[0][0];
  const val = cur === 'opacity' ? kfVal(c, 'opacity', lt, c.opacity) : cur === 'vol' ? kfVal(c, 'vol', lt, c.vol) : kfVal(c, cur, lt, c[cur]);
  const ks = (c.kf && c.kf[cur]) || [];
  const list = ks.map((k, i) => `<div class="ed-row" style="gap:5px"><span style="font:11px/1 monospace;color:#8b96ab">${tc(k.t)}</span>
    <span style="font:11px/1 monospace;color:#cfd8ea">${outTxt(cur, k.v)}</span><span class="grow"></span>
    <button class="ed-chip" data-act="kfDel:${i}">删</button></div>`).join('') || '<div class="ed-kfnote">这个属性还没有关键帧。</div>';
  return `<div class="ed-sec"><h4>关键帧<span class="sp"></span><small>${hasKeys(c) ? kfTimes(c).length + ' 个' : '无'}</small></h4><div class="ed-sec-body">
    <div class="ed-row"><label>属性</label><select class="ed-sel grow" id="edKfProp">${props.map(p => `<option value="${p[0]}"${p[0] === cur ? ' selected' : ''}>${p[1]}</option>`).join('')}</select></div>
    ${rangeRow('当前值', 'kfval', cur === 'opacity' || cur === 'vol' ? 0 : cur === 'scale' ? 0.02 : -1000, cur === 'opacity' || cur === 'vol' ? 1 : cur === 'scale' ? 4 : 1000, cur === 'opacity' || cur === 'vol' ? 0.01 : cur === 'scale' ? 0.01 : 1, val, outTxt(cur, val))}
    <div class="ed-kfbar" style="margin-top:8px">
      <button class="ed-btn sm" data-act="kfAdd">◆ 打关键帧</button>
      <button class="ed-btn sm" data-act="kfDelHere">◇ 删这里</button>
      <button class="ed-btn sm" data-act="kfPrev">◀</button>
      <button class="ed-btn sm" data-act="kfNext">▶</button>
    </div>
    <div class="ed-row" style="margin-top:8px"><label>过渡</label>
      <select class="ed-sel grow" id="edKfEase">${[['inout', '缓入缓出'], ['linear', '匀速'], ['out', '先快后慢'], ['in', '先慢后快'], ['back', '回弹'], ['hold', '瞬切']].map(o => `<option value="${o[0]}"${ED.kfEase === o[0] ? ' selected' : ''}>${o[1]}</option>`).join('')}</select>
    </div>
    <label class="ed-row" style="margin-top:8px;font-size:11.5px;color:#8b96ab"><input type="checkbox" id="edKfAuto" ${ED.kfAuto ? 'checked' : ''}> 自动记录（拖画面就写关键帧）</label>
    <div style="max-height:120px;overflow:auto;margin-top:8px">${list}</div>
  </div></div>
  <div class="ed-sec"><h4>一键动画</h4><div class="ed-sec-body"><div class="ed-chips">
    <button class="ed-chip" data-act="kfp:fadeIn">淡入</button>
    <button class="ed-chip" data-act="kfp:fadeOut">淡出</button>
    <button class="ed-chip" data-act="kfp:popIn">弹入</button>
    <button class="ed-chip" data-act="kfp:slideL">左滑入</button>
    <button class="ed-chip" data-act="kfp:slideR">右滑入</button>
    <button class="ed-chip" data-act="kfp:pushIn">缓慢推近</button>
    <button class="ed-chip" data-act="kfp:pullOut">缓慢拉远</button>
    <button class="ed-chip" data-act="kfp:panLR">左右平移</button>
    <button class="ed-chip" data-act="kfp:sway">摇摆</button>
    <button class="ed-chip" data-act="kfp:pulse">踩拍脉冲</button>
    <button class="ed-chip" data-act="kfp:clear">清空动画</button>
  </div><p class="ed-kfnote">文字片段的「停留 / 入场 / 退场」本身已经是手法库动画，关键帧适合给图片、视频做运镜。</p></div></div>`;
}

function fxHTML(c) {
  if (c.kind === 'text') {
    const groups = [
      ['构图', 'layout', J.LAYOUTS], ['入场', 'enter', J.ENTER], ['停留', 'hold', J.HOLD],
      ['退场', 'exit', J.EXIT], ['质感', 'treat', J.TREAT], ['背景', 'bg', J.BG],
      ['镜头', 'cam', J.CAMERA], ['装饰', 'decor', J.DECOR],
    ];
    const tab = ED.libTab || 'layout';
    const g = groups.find(x => x[1] === tab) || groups[0];
    const map = g[2];
    const keys = Object.keys(map).filter(k => map[k] && !map[k].special);
    let html = `<div class="ed-sec"><h4>手法库<span class="sp"></span><small>${keys.length} 个 · 点一下就用</small></h4><div class="ed-sec-body">
      <div class="ed-chips" id="edLibTabs" style="margin-bottom:7px">${groups.map(x => `<button class="ed-chip${x[1] === g[1] ? ' on' : ''}" data-libtab="${x[1]}">${x[0]}</button>`).join('')}</div>
      <div class="ed-lib-search"><input class="ed-in" id="edLibSearch" placeholder="搜索：翻页 / 网点 / 墨 / 巨大…" spellcheck="false">
      <button class="ed-btn sm" data-act="randomFx" title="随机换一套">🎲</button></div>
      <div class="ed-lib" id="edLibBox">`;
    for (const k of keys) {
      const on = g[1] === 'decor' ? (c.fx.decor || []).includes(k) : (c.fx[g[1]] === k);
      html += `<div class="ed-lib-i${on ? ' on' : ''}" data-lib="${g[1]}" data-key="${k}" title="${esc((map[k] && map[k].name) || k)}"><span>${esc((map[k] && map[k].name) || k)}</span><code>${esc(k)}</code></div>`;
    }
    html += `</div><p class="ed-kfnote">同一个文字片段可以同时叠：构图 + 入场 + 停留 + 退场 + 质感 + 背景 + 镜头 + 装饰，就是剪辑软件里的一条效果链。</p></div></div>`;
    return html;
  }
  if (c.kind === 'audio') return audioHTML(c);
  // 视频 / 图片
  return `<div class="ed-sec"><h4>画面风格</h4><div class="ed-sec-body">
    <p class="ed-kfnote">一键套一组滤镜（之后还能在「画面」里细调）。</p>
    <div class="ed-chips">
      <button class="ed-chip" data-act="filter:原片">原片</button>
      <button class="ed-chip" data-act="filter:黑白">黑白</button>
      <button class="ed-chip" data-act="filter:胶片">胶片</button>
      <button class="ed-chip" data-act="filter:冷调">冷调</button>
      <button class="ed-chip" data-act="filter:暖调">暖调</button>
      <button class="ed-chip" data-act="filter:故障">故障</button>
      <button class="ed-chip" data-act="filter:柔光">柔光</button>
      <button class="ed-chip" data-act="filter:褪色">褪色</button>
    </div>
  </div></div>
  <div class="ed-sec"><h4>运镜动画</h4><div class="ed-sec-body">
    <p class="ed-kfnote">给图片 / 视频做推拉摇移，和剪辑软件里的位置关键帧一样。</p>
    <div class="ed-chips">
      <button class="ed-chip" data-act="kfp:pushIn">缓慢推近</button>
      <button class="ed-chip" data-act="kfp:pullOut">缓慢拉远</button>
      <button class="ed-chip" data-act="kfp:panLR">左右平移</button>
      <button class="ed-chip" data-act="kfp:popIn">弹入</button>
      <button class="ed-chip" data-act="kfp:fadeIn">淡入</button>
      <button class="ed-chip" data-act="kfp:sway">轻微摇摆</button>
      <button class="ed-chip" data-act="kfp:pulse">踩拍脉冲</button>
      <button class="ed-chip" data-act="kfp:clear">清空动画</button>
    </div>
  </div></div>
  <div class="ed-sec"><h4>转场</h4><div class="ed-sec-body">
    ${selRow('入点', 'transIn.type', TRANS_LIST, c.transIn && c.transIn.type || 'none')}
    ${selRow('出点', 'transOut.type', TRANS_LIST, c.transOut && c.transOut.type || 'none')}
  </div></div>
  <div class="ed-sec"><h4>画面裁切</h4><div class="ed-sec-body">
    ${selRow('适配方式', 'fit', [['cover', '铺满（裁切）'], ['contain', '完整（留边）'], ['stretch', '拉伸'], ['raw', '原始像素']], c.fit)}
    ${rangeRow('缩放', 'scale', 0.02, 4, 0.01, c.scale)}
    ${rangeRow('不透明度', 'opacity', 0, 1, 0.01, c.opacity)}
  </div></div>`;
}

function audioHTML(c) {
  if (c.kind !== 'audio') return `<div class="ed-empty-insp">这个片段没有声音轨。<br>视频自带的声音请在时间线上单独放一条音频（把同一个视频拖到音频轨，或导入音频文件）。</div>`;
  return `<div class="ed-cliphead">
    <div class="ic" style="color:${KIND.audio.c}">♫</div>
    <div class="meta"><b>${esc(c.name || '音频')}</b><small>音频片段 · ${c.dur.toFixed(2)}s</small></div>
  </div>
  <div class="ed-sec"><h4>声音</h4><div class="ed-sec-body">
    <canvas id="edAudWave" height="56" style="width:100%;border-radius:6px;background:#0a1410;margin-bottom:8px"></canvas>
    ${rangeRow('音量', 'vol', 0, 1.6, 0.01, c.vol)}
    ${rangeRow('淡入', 'fadeIn', 0, Math.min(8, c.dur), 0.02, c.fadeIn)}
    ${rangeRow('淡出', 'fadeOut', 0, Math.min(8, c.dur), 0.02, c.fadeOut)}
    ${rangeRow('速度', 'speed', 0.5, 2, 0.01, c.speed || 1)}
    <div class="ed-row two">
      <label>源入点<input class="ed-in" type="number" data-p="in" step="0.01" min="0" value="${(c.in || 0).toFixed(3)}"></label>
      <label>时长<input class="ed-in" type="number" data-p="dur" step="0.01" min="0.05" value="${c.dur.toFixed(3)}"></label>
    </div>
    <div class="ed-row two" style="margin-top:8px">
      <button class="ed-btn" data-act="normalize">音量标准化</button>
      <button class="ed-btn" data-act="audToPlayhead">起点=播放头</button>
    </div>
  </div></div>
  <div class="ed-sec"><h4>提示</h4><div class="ed-sec-body">
    <p class="ed-kfnote">· 拖音频块两端裁切，拖动整体移动<br>· 音量关键帧在「动画」里加<br>· 导出时会自动混成 48kHz 立体声 AAC</p>
  </div></div>`;
}

function drawAudioPreview(c) {
  const cv = $('#edAudWave');
  if (!cv || c.kind !== 'audio') return;
  const a = assetOf(c);
  const w = cv.clientWidth || 280, h = cv.height;
  const dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = w * dpr; cv.height = h * dpr;
  const x = cv.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, w, h);
  x.fillStyle = '#0a1410'; x.fillRect(0, 0, w, h);
  if (!a || !a.peaks) return;
  const pk = a.peaks, n = pk.length, mid = h / 2;
  for (let i = 0; i < w; i++) {
    const t0 = c.in + (c.dur * i / w) * (c.speed || 1);
    const t1 = c.in + (c.dur * (i + 1) / w) * (c.speed || 1);
    let mx = 0;
    for (let q = Math.floor(t0 / a.dur * n); q <= Math.ceil(t1 / a.dur * n); q++) { const v = pk[clamp(q, 0, n - 1)] || 0; if (v > mx) mx = v; }
    const hh = Math.max(0.7, mx * (h - 6) * 0.5);
    x.fillStyle = '#3ee08f';
    x.fillRect(i, mid - hh, 1, hh * 2);
  }
  // 播放头
  const px = (ED.t - c.start) / c.dur * w;
  if (px >= 0 && px <= w) { x.fillStyle = '#ff6a2b'; x.fillRect(px, 0, 1.6, h); }
}

/* ───────── 属性绑定 ───────── */
function setPath(obj, path, val) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) { if (!o[parts[i]] || typeof o[parts[i]] !== 'object') o[parts[i]] = {}; o = o[parts[i]]; }
  o[parts[parts.length - 1]] = val;
}
function bindInsp() {
  const body = $('#edInsp');
  if (!body) return;
  $$('[data-p]', body).forEach(el => {
    const prop = el.dataset.p;
    const isRange = el.type === 'range';
    const isNum = isRange || el.type === 'number';
    const apply = (commit) => {
      const clips = selClips();
      let v = el.type === 'checkbox' ? el.checked : isNum ? +el.value : el.value;
      if (prop === 'pvStyle') {
        for (const c of clips) { if (c.pv) { c.pv.style = v; invalidateClip(c.id); } }
        requestRedraw(); markDirty(); if (commit) snapshot('改 PV 配色');
        return;
      }
      if (prop === 'kfval') {
        const kp = ED.kfProp || 'x';
        for (const c of clips) {
          const lt = Math.max(0, ED.t - c.start);
          const ks = kfList(c, kp);
          const hit = ks.find(k => Math.abs(k.t - lt) < 0.03);
          if (hit) hit.v = v;
          else {
            if (kp === 'opacity') c.opacity = v;
            else if (kp === 'vol') c.vol = v;
            else c[kp] = v;
            if (ED.kfAuto) upsertKey(c, kp, lt, v);
          }
        }
        const out = $('[data-out="kfval"]', body); if (out) out.textContent = outTxt(kp, v);
        requestRedraw(); drawTimeline(); markDirty(); if (commit) snapshot('调关键帧');
        return;
      }
      if (prop.startsWith('__')) {
        ED.doc[prop.slice(2)] = v;
        if (prop === '__bgStyle') renderInspector();
        requestRedraw(); markDirty(); if (commit) snapshot('工程设置');
        return;
      }
      if (!clips.length) return;
      for (const c of clips) {
        if (prop === 'kfval') {
          // 只改当前关键帧 / 预览值，取消处理
          ED.kfPreview = v;
          continue;
        }
        if (prop.startsWith('transIn.') || prop.startsWith('transOut.')) {
          const [t, k] = prop.split('.');
          c[t] = c[t] || { type: 'none', dur: 0.45 };
          c[t][k] = isNum ? v : v;
        } else {
          setPath(c, prop, v);
        }
        if (prop === 'text' || prop === 'style' || prop === 'font' || prop.startsWith('fx.')) invalidateClip(c.id);
        if (prop === 'dur') c.dur = Math.max(0.05, v);
        if (prop === 'start') c.start = Math.max(0, v);
        if (prop === 'fadeIn') c.fadeIn = clamp(v, 0, c.dur);
        if (prop === 'fadeOut') c.fadeOut = clamp(v, 0, c.dur);
      }
      const out = $('[data-out="' + prop + '"]', body);
      if (out) out.textContent = outTxt(prop, v, clips[0]);
      recalcDur();
      if (ED.kfAuto && (prop === 'x' || prop === 'y' || prop === 'scale' || prop === 'rot' || prop === 'opacity')) {
        for (const c of clips) upsertKey(c, prop, ED.t - c.start, v);
      }
      if (prop === 'start' || prop === 'dur' || prop === 'in') { drawTimeline(); }
      requestRedraw();
      markDirty();
      if (commit) snapshot('调整 ' + prop);
    };
    if (isRange) {
      el.addEventListener('input', () => apply(false));
      el.addEventListener('change', () => apply(true));
    } else {
      el.addEventListener('change', () => apply(true));
    }
  });
  // 文字内容单独处理（防抖）
  const ta = $('#edText', body);
  if (ta) {
    let tm = 0;
    ta.addEventListener('input', () => {
      const c = selClip(); if (!c) return;
      c.text = ta.value;
      c.name = (ta.value || '文字').split('\n')[0].slice(0, 20);
      invalidateClip(c.id);
      clearTimeout(tm);
      tm = setTimeout(() => { requestRedraw(); drawTimeline(); markDirty(); }, 180);
    });
    ta.addEventListener('change', () => snapshot('改文字'));
  }
  $$('[data-proj]', body).forEach(el => el.addEventListener('change', () => {
    const k = el.dataset.proj;
    ED.doc[k] = el.type === 'number' ? +el.value || 0 : el.value;
    requestRedraw(); drawTimeline(); markDirty(); snapshot('工程设置');
    if (k === 'bg' || k === 'bg2' || k === 'bpm') renderInspector();
  }));
  $$('[data-decor]', body).forEach(ch => ch.addEventListener('change', () => {
    const c = selClip(); if (!c) return;
    c.fx.decor = c.fx.decor || [];
    const k = ch.dataset.decor;
    if (ch.checked) { if (!c.fx.decor.includes(k)) c.fx.decor.push(k); }
    else c.fx.decor = c.fx.decor.filter(x => x !== k);
    ch.closest('.ed-chip').classList.toggle('on', ch.checked);
    invalidateClip(c.id); requestRedraw(); markDirty(); snapshot('装饰');
  }));
  const lib = $('#edLibBox', body);
  if (lib) {
    $$('#edLibTabs .ed-chip', body).forEach(b => b.addEventListener('click', () => {
      ED.libTab = b.dataset.libtab; renderInspector();
    }));
    lib.addEventListener('click', (e) => {
      const it = e.target.closest('[data-lib]');
      if (!it) return;
      const c = selClip(); if (!c || !c.fx) return;
      const group = it.dataset.lib, key = it.dataset.key;
      if (group === 'decor') {
        c.fx.decor = c.fx.decor || [];
        c.fx.decor = c.fx.decor.includes(key) ? c.fx.decor.filter(x => x !== key) : c.fx.decor.concat(key);
      } else c.fx[group] = key;
      invalidateClip(c.id);
      renderInspector(); requestRedraw(); drawTimeline();
      markDirty(); snapshot('套用手法');
      toast('已套用：' + ((J.LAYOUTS[key] || J.ENTER[key] || J.HOLD[key] || J.EXIT[key] || J.TREAT[key] || J.BG[key] || J.CAMERA[key] || J.DECOR[key] || {}).name || key));
    });
    const search = $('#edLibSearch', body);
    if (search) search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      $$('.ed-lib-i', lib).forEach(el => {
        const hit = !q || (el.textContent || '').toLowerCase().includes(q) || el.dataset.key.toLowerCase().includes(q);
        el.style.display = hit ? '' : 'none';
      });
      $$('.ed-lib-g', lib).forEach(g => { g.style.display = q ? 'none' : ''; });
    });
  }
  const kp = $('#edKfProp', body);
  if (kp) kp.addEventListener('change', () => { ED.kfProp = kp.value; renderInspector(); });
  const ke = $('#edKfEase', body);
  if (ke) ke.addEventListener('change', () => { ED.kfEase = ke.value; });
  const ka = $('#edKfAuto', body);
  if (ka) ka.addEventListener('change', () => { ED.kfAuto = ka.checked; toast(ED.kfAuto ? '自动记录已开：拖动画面会写关键帧' : '自动记录已关'); });
  $$('[data-act]', body).forEach(b => b.addEventListener('click', () => doAction(b.dataset.act, b)));
}

function doAction(act, btn) {
  const c = selClip();
  const clips = selClips();
  if (!act) return;
  const [cmd, arg] = act.split(':');
  const after = (label) => { renderInspector(); requestRedraw(); drawTimeline(); markDirty(); if (label) snapshot(label); };
  switch (cmd) {
    case 'randomFx': if (c) { reRollFx(c); snapshot('换手法'); } break;
    case 'filter': {
      const F = {
        '原片': { b: 1, c: 1, s: 1, hue: 0, blur: 0, sepia: 0 },
        '黑白': { b: 1.02, c: 1.22, s: 0, hue: 0, blur: 0, sepia: 0 },
        '胶片': { b: 1.04, c: 1.12, s: 0.86, hue: 8, blur: 0, sepia: 0.22 },
        '冷调': { b: 0.98, c: 1.08, s: 0.92, hue: -18, blur: 0, sepia: 0 },
        '暖调': { b: 1.06, c: 1.04, s: 1.12, hue: 12, blur: 0, sepia: 0.12 },
        '故障': { b: 1.1, c: 1.35, s: 1.35, hue: 6, blur: 0.6, sepia: 0 },
        '柔光': { b: 1.12, c: 0.94, s: 1.04, hue: 0, blur: 1.6, sepia: 0 },
        '褪色': { b: 1.1, c: 0.86, s: 0.7, hue: 0, blur: 0, sepia: 0.35 },
      }[arg] || {};
      for (const x of clips) x.f = Object.assign({}, x.f, F);
      after('套用滤镜 ' + arg);
      break;
    }
    case 'alignStart': if (clips.length) { const s = Math.min(...clips.map(x => x.start)); for (const x of clips) x.start = s; after('起点对齐'); } break;
    case 'alignEnd': if (clips.length) { const e = Math.max(...clips.map(clipEnd)); for (const x of clips) x.start = e - x.dur; after('终点对齐'); } break;
    case 'spaceEven': if (clips.length > 1) {
      const sorted = clips.slice().sort((a, b) => a.start - b.start);
      const s0 = sorted[0].start;
      let acc = s0;
      for (const x of sorted) { x.start = acc; acc += x.dur; }
      after('等距排列');
    } break;
    case 'dupSel': duplicateSelected(); break;
    case 'delSel': deleteSelected(false); break;
    case 'rippleSel': deleteSelected(true); break;
    case 'normalize': for (const x of clips) { x.vol = 1; x.fadeIn = 0; x.fadeOut = 0; } after('音量标准化'); toast('已回到 100%'); break;
    case 'audToPlayhead': if (c) { c.start = ED.t; after('对齐播放头'); } break;
    case 'kfAdd': if (c) {
      const prop = ED.kfProp || 'x';
      const lt = Math.max(0, ED.t - c.start);
      const v = prop === 'opacity' ? kfVal(c, 'opacity', lt, c.opacity) : kfVal(c, prop, lt, c[prop]);
      upsertKey(c, prop, lt, v);
      after('打关键帧'); toast('已打关键帧 ' + outTxt(prop, v));
    } break;
    case 'kfDelHere': if (c) {
      const prop = ED.kfProp || 'x';
      if (delKeyAt(c, prop, Math.max(0, ED.t - c.start))) { after('删关键帧'); toast('已删除'); }
      else toast('这里没有关键帧');
    } break;
    case 'kfDel': if (c) { const prop = ED.kfProp || 'x'; const arr = kfList(c, prop); arr.splice(+arg, 1); after('删关键帧'); } break;
    case 'kfPrev': case 'kfNext': if (c) {
      const ks = c.kf && c.kf[ED.kfProp || 'x'] || [];
      if (!ks.length) break;
      const lt = ED.t - c.start;
      const ts = ks.map(k => k.t);
      const target = cmd === 'kfNext' ? ts.find(t => t > lt + 0.02) : [...ts].reverse().find(t => t < lt - 0.02);
      if (target != null) seek(c.start + target);
    } break;
    case 'kfp': applyKfPreset(clips, arg); break;
    case 'tp': applyTextPreset(arg); break;
    case 'demoDoc': if (confirm('用示例片段替换当前时间线？（素材库不会清空）')) { ED.doc = starterDoc(); ED.sel = []; ED.t = 0; designSizes(); recalcDur(); syncDocInputs(); renderBin(); renderInspector(); drawTimeline(); requestRedraw(); snapshot('恢复示例'); toast('已恢复示例'); } break;
    case 'newDoc': if (confirm('新建空工程？当前时间线会被清空（素材库保留）。')) { ED.doc = newDoc(); ED.sel = []; ED.t = 0; designSizes(); recalcDur(); syncDocInputs(); renderBin(); renderInspector(); drawTimeline(); requestRedraw(); snapshot('新建工程'); toast('已新建空工程'); } break;
  }
}

/* 成套预设：一次改一整条效果链（构图 / 入场 / 停留 / 退场 / 质感 / 背景 / 镜头 / 装饰） */
const TEXT_PRESETS = {
  '重击标题': { style: 'noir', layout: 'huge', enter: 'assemble', hold: 'jitter', exit: 'cut', treat: 'none', bg: 'none', cam: 'beatPunch', decor: ['leaders'] },
  '抒情字幕': { style: 'specimen', layout: 'center', enter: 'blur', hold: 'drift', exit: 'drift', treat: 'paper', bg: 'none', cam: 'push', decor: ['lightLeak'] },
  '手帐贴纸': { style: 'paper', layout: 'polaroid', enter: 'pop', hold: 'breathe', exit: 'cut', treat: 'none', bg: 'none', cam: 'handheld', decor: ['tapePieces', 'scribbleUnder'] },
  '故障标题': { style: 'crimson', layout: 'glitchGrid', enter: 'scramble', hold: 'glitchtick', exit: 'glitch', treat: 'none', bg: 'none', cam: 'shakeHard', decor: ['glitchRects'] },
  '电影字幕': { style: 'noir', layout: 'subtitleBar', enter: 'wipe', hold: 'still', exit: 'cut', treat: 'none', bg: 'none', cam: 'push', decor: ['cropMarks'] },
  '大字竖排': { style: 'caution', layout: 'vcols', enter: 'wipe', hold: 'still', exit: 'cut', treat: 'none', bg: 'none', cam: 'push', decor: ['verticalStrip'] },
  '复古海报': { style: 'transit', layout: 'poster', enter: 'stamp', hold: 'still', exit: 'cut', treat: 'halftone', bg: 'none', cam: 'push', decor: ['halftonePatch', 'brackets'] },
  '极简说明': { style: 'specimen', layout: 'lowerThird', enter: 'wipe', hold: 'still', exit: 'cut', treat: 'none', bg: 'none', cam: 'push', decor: ['leaders', 'barcode'] },
};
const REG = { layout: 'LAYOUTS', enter: 'ENTER', hold: 'HOLD', exit: 'EXIT', treat: 'TREAT', bg: 'BG', cam: 'CAMERA' };
function applyTextPreset(name) {
  const c = selClip();
  if (!c || c.kind !== 'text') return;
  const P = TEXT_PRESETS[name];
  if (!P) return;
  if (P.style && J.STYLES[P.style]) c.style = P.style;
  if (!c.fx) c.fx = {};
  for (const k of Object.keys(REG)) if (P[k] && J[REG[k]] && J[REG[k]][P[k]]) c.fx[k] = P[k];
  c.fx.decor = (P.decor || []).filter(k => J.DECOR[k]);
  c.fx.seed = (Math.random() * 1e6) | 0;
  invalidateClip(c.id); renderInspector(); requestRedraw(); drawTimeline();
  markDirty(); snapshot('成套预设');
  toast('已套用预设：' + name + (P.style && J.STYLES[P.style] ? ' · ' + (J.STYLES[P.style].name || '') : ''));
}

/* 关键帧预设 */
function applyKfPreset(clips, name) {
  for (const c of clips) {
    if (!c.kf) c.kf = {};
    const d = c.dur;
    const base = { x: c.x, y: c.y, scale: c.scale, rot: c.rot, opacity: c.opacity, vol: c.vol };
    const set = (prop, arr) => { c.kf[prop] = arr; };
    if (name === 'clear') { c.kf = { x: [], y: [], scale: [], rot: [], opacity: [], vol: [] }; continue; }
    set('x', []); set('y', []); set('scale', []); set('rot', []); set('opacity', []);
    if (name === 'fadeIn') set('opacity', [{ t: 0, v: 0, e: 'out' }, { t: Math.min(0.8, d * 0.3), v: base.opacity, e: 'inout' }]);
    if (name === 'fadeOut') set('opacity', [{ t: Math.max(0, d - Math.min(0.8, d * 0.3)), v: base.opacity, e: 'inout' }, { t: d, v: 0, e: 'linear' }]);
    if (name === 'popIn') { set('opacity', [{ t: 0, v: 0, e: 'out' }, { t: 0.18, v: base.opacity, e: 'out' }]); set('scale', [{ t: 0, v: base.scale * 0.55, e: 'back' }, { t: 0.36, v: base.scale, e: 'inout' }]); }
    if (name === 'slideL') { set('x', [{ t: 0, v: base.x - ED.designW * 0.35, e: 'out' }, { t: Math.min(0.9, d * 0.4), v: base.x, e: 'inout' }]); set('opacity', [{ t: 0, v: 0, e: 'out' }, { t: 0.3, v: base.opacity, e: 'out' }]); }
    if (name === 'slideR') { set('x', [{ t: 0, v: base.x + ED.designW * 0.35, e: 'out' }, { t: Math.min(0.9, d * 0.4), v: base.x, e: 'inout' }]); set('opacity', [{ t: 0, v: 0, e: 'out' }, { t: 0.3, v: base.opacity, e: 'out' }]); }
    if (name === 'pushIn') set('scale', [{ t: 0, v: base.scale * 1.0, e: 'linear' }, { t: d, v: base.scale * 1.14, e: 'linear' }]);
    if (name === 'pullOut') set('scale', [{ t: 0, v: base.scale * 1.16, e: 'linear' }, { t: d, v: base.scale * 1.0, e: 'linear' }]);
    if (name === 'panLR') set('x', [{ t: 0, v: base.x - ED.designW * 0.05, e: 'inout' }, { t: d * 0.5, v: base.x + ED.designW * 0.05, e: 'inout' }, { t: d, v: base.x - ED.designW * 0.05, e: 'inout' }]);
    if (name === 'sway') set('rot', [{ t: 0, v: base.rot - 2.2, e: 'inout' }, { t: d * 0.5, v: base.rot + 2.2, e: 'inout' }, { t: d, v: base.rot - 2.2, e: 'inout' }]);
    if (name === 'pulse') {
      const beat = ED.doc.bpm > 0 ? 60 / ED.doc.bpm : 0.5;
      const arr = [];
      for (let t = 0, i = 0; t <= d && i < 64; t += beat, i++) arr.push({ t, v: base.scale * (i % 2 ? 1 : 1.06), e: 'inout' });
      set('scale', arr);
    }
  }
  renderInspector(); requestRedraw(); drawTimeline(); markDirty(); snapshot('动画预设');
  toast('已套用动画：' + name);
}

/* ============================================================
   工程设置 / 界面同步
   ============================================================ */
function syncDocInputs() {
  const d = ED.doc;
  const set = (sel, val) => { const el = $(sel); if (el && val != null) el.value = val; };
  set('#edName', d.name);
  set('#edAspect', d.aspect);
  set('#edRes', d.res);
  set('#edFps', d.fps);
  set('#edQuality', ED.quality);
  set('#edVol', Math.round(ED.volume * 100));
  set('#edZoom', Math.round(ED.pps));
  const loop = $('#edLoop'); if (loop) loop.checked = !!ED.loop;
  const sn = $('#edSnapBtn'); if (sn) sn.classList.toggle('on', ED.snap);
  const sb = $('#edSnapBeatBtn'); if (sb) sb.classList.toggle('on', ED.snapBeat);
  updateTimeAll();
}
function updateTimeAll() {
  const all = $('#edTimeAll'); if (all) all.textContent = tc(timelineEnd());
  const size = $('#edMonSize'); if (size && ED.doc) size.textContent = ED.outW + '×' + ED.outH + ' · ' + ED.doc.fps + 'fps';
}
function syncInspectorTime() {
  const c = selClip(); if (!c) return;
  const body = $('#edInsp'); if (!body) return;
  const s = $('[data-p="start"]', body); if (s) s.value = c.start.toFixed(3);
  const d = $('[data-p="dur"]', body); if (d) d.value = c.dur.toFixed(3);
  const k = $('#edSelKind'); if (k) k.textContent = KIND[c.kind].label + ' · ' + c.dur.toFixed(2) + 's';
  updateTimeAll();
}
const renderBinInsp = () => { renderBin(); renderInspector(); };

/* ============================================================
   事件绑定
   ============================================================ */
function bindUI() {
  // ── 顶栏 ──
  const name = $('#edName');
  if (name) {
    name.addEventListener('change', () => { ED.doc.name = name.value.trim() || '未命名剪辑'; markDirty(); toast('工程名：' + ED.doc.name); });
  }
  const aspect = $('#edAspect');
  if (aspect) aspect.addEventListener('change', () => {
    ED.doc.aspect = aspect.value; designSizes(); layerCache.clear(); sizeMonitor();
    requestRedraw(); drawTimeline(); updateTimeAll(); markDirty(); snapshot('改画幅');
  });
  const res = $('#edRes');
  if (res) res.addEventListener('change', () => { ED.doc.res = +res.value; designSizes(); sizeMonitor(); updateTimeAll(); markDirty(); });
  const fps = $('#edFps');
  if (fps) fps.addEventListener('change', () => { ED.doc.fps = +fps.value; layerCache.clear(); updateTimeAll(); requestRedraw(); markDirty(); snapshot('改帧率'); });
  const q = $('#edQuality');
  if (q) q.addEventListener('change', () => { ED.quality = q.value; });
  const vol = $('#edVol');
  if (vol) vol.addEventListener('input', () => { ED.volume = +vol.value / 100; PLAY.master && (PLAY.master.gain.value = ED.volume); });
  const loop = $('#edLoop');
  if (loop) loop.addEventListener('change', () => { ED.loop = loop.checked; });
  const inB = $('#edInBtn'), outB = $('#edOutBtn'), clrB = $('#edInOutClear');
  if (inB) inB.onclick = () => { ED.doc.inPoint = ED.t; drawTimeline(); toast('入点 ' + tc(ED.t)); };
  if (outB) outB.onclick = () => { ED.doc.outPoint = ED.t; drawTimeline(); toast('出点 ' + tc(ED.t)); };
  if (clrB) clrB.onclick = () => { ED.doc.inPoint = 0; ED.doc.outPoint = 0; drawTimeline(); toast('已清除入出点'); };

  $('#edUndo').onclick = undo;
  $('#edRedo').onclick = redo;
  $('#edExportBtn').onclick = () => exportVideo();
  $('#edSaveProj').onclick = () => saveProjectFile();
  $('#edOpenProj').onclick = () => $('#edProjFile').click();
  $('#edProjFile').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) openProjectFile(f); };
  $('#edHelp').onclick = showHelp;
  $('#edClose').onclick = () => closeEditor();

  // ── 素材 ──
  $('#edImport').onclick = () => $('#edFile').click();
  $('#edFile').onchange = async (e) => {
    const files = [...e.target.files]; e.target.value = '';
    const list = await addFiles(files);
    if (list.length) {
      // 导入后自动放到播放头
      let t = ED.t;
      for (const a of list) {
        const c = assetClip(null, a.id, t);
        if (c) { ED.doc.clips.push(c); t = clipEnd(c); }
      }
      recalcDur(); select([]); renderBin(); drawTimeline(); requestRedraw(); snapshot('导入素材');
    }
  };
  $$('#edBin [data-gen]').forEach(b => b.onclick = () => {
    const g = b.dataset.gen;
    if (g === 'text') addTextAt(ED.t);
    else if (g === 'solid') addSolidAt(ED.t);
    else if (g === 'import') $('#edFile').click();
    else if (g === 'audio') { const inp = $('#edFile'); inp.accept = 'audio/*'; inp.click(); setTimeout(() => inp.accept = 'image/*,video/*,audio/*', 800); }
    else if (g === 'pv') importPVFromStudio();
  });

  // ── 时间线工具条 ──
  $('#edCut').onclick = splitSelected;
  $('#edDel').onclick = () => deleteSelected(false);
  $('#edRipple').onclick = () => deleteSelected(true);
  $('#edDup').onclick = duplicateSelected;
  $('#edAddTextBtn').onclick = () => addTextAt(ED.t);
  $('#edAddTrackBtn').onclick = () => {
    const menu = $('#edMenu');
    const items = [
      { label: '＋ 文字轨道', fn: () => addTrack('text') },
      { label: '＋ 视频轨道', fn: () => addTrack('video') },
      { label: '＋ 音频轨道', fn: () => addTrack('audio') },
    ];
    menu.innerHTML = items.map((it, i) => '<button data-i="' + i + '">' + it.label + '</button>').join('');
    menu._items = items;
    menu.classList.add('on');
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, window.innerWidth - rect.width - 40) + 'px';
    menu.style.top = '210px';
    $$('#edMenu button').forEach(bb => bb.onclick = () => { closeMenu(); items[+bb.dataset.i].fn(); });
  };
  $('#edSnapBtn').onclick = () => { ED.snap = !ED.snap; $('#edSnapBtn').classList.toggle('on', ED.snap); drawTimeline(); toast(ED.snap ? '吸附开' : '吸附关'); };
  $('#edSnapBeatBtn').onclick = () => { ED.snapBeat = !ED.snapBeat; $('#edSnapBeatBtn').classList.toggle('on', ED.snapBeat); drawTimeline(); toast(ED.snapBeat ? '额外吸附节拍' : '不吸附节拍'); };
  $('#edZoom').oninput = (e) => { ED.pps = +e.target.value; drawTimeline(); };
  $('#edZoomFit').onclick = zoomFit;
  $('#edPlay').onclick = togglePlay;
  $('#edFramePNG').onclick = exportFramePNG;
  $('#edTlHint').textContent = '拖动=移动 · 边缘=裁切 · 双击=改属性 · Ctrl+滚轮=缩放 · 右键=更多';

  // ── 属性页签 ──
  $$('.ed-insp-tabs .ed-tab').forEach(b => b.onclick = () => showInspTab(b.dataset.itab));

  // ── 时间线高度 ──
  const grip = $('#edTlGrip'), tlBox = $('#edTlBox');
  if (grip && tlBox) {
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const h0 = tlBox.getBoundingClientRect().height, y0 = e.clientY;
      const mv = (ev) => {
        const h = clamp(h0 - (ev.clientY - y0), 150, Math.max(180, window.innerHeight - 330));
        tlBox.style.height = h + 'px'; tlBox.style.flexBasis = h + 'px';
        sizeMonitor(); drawTimeline();
      };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); sizeMonitor(); drawTimeline(); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    });
  }

  bindTimeline();
  bindMonitorDrag();
  bindDrop();
  bindShortcuts();
  document.addEventListener('paste', async (e) => {
    if (!ED.open) return;
    const items = [...((e.clipboardData && e.clipboardData.items) || [])];
    const files = items.filter(it => it.kind === 'file').map(it => it.getAsFile()).filter(Boolean);
    if (files.length) {
      e.preventDefault();
      const list = await addFiles(files);
      if (list.length) { addAssetAt(list[0].id, ED.t); renderBin(); }
      return;
    }
    // 纯文本 → 直接变成一段文字
    const tag = (e.target.tagName || '').toLowerCase();
    if (/^(input|textarea)$/.test(tag) || e.target.isContentEditable) return;
    const txt = e.clipboardData && e.clipboardData.getData('text/plain');
    if (txt && txt.trim()) {
      e.preventDefault();
      addTextAt(ED.t, null, txt.slice(0, 200));
    }
  });
  window.addEventListener('resize', () => { sizeMonitor(); drawTimeline(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('#edMenu')) closeMenu(); });
  document.addEventListener('contextmenu', (e) => { if (!e.target.closest('#edTl') && !e.target.closest('#edView')) closeMenu(); });
}

function zoomFit() {
  const scroll = $('#edTlScroll');
  if (!scroll) return;
  const dur = Math.max(2, timelineEnd());
  const w = scroll.clientWidth - TL.head - 40;
  ED.pps = clamp(w / dur, 10, 320);
  const z = $('#edZoom'); if (z) z.value = Math.round(ED.pps);
  scroll.scrollLeft = 0;
  drawTimeline();
}

/* 监视器里直接拖画面 */
function topClipAt(t) {
  const order = visualTracks(); // bottom → top，取最后一个命中的
  let found = null;
  for (const tr of order) {
    if (tr.hide) continue;
    for (const c of ED.doc.clips) {
      if (c.track !== tr.id) continue;
      if (t >= c.start - 1e-6 && t < clipEnd(c) - 1e-6) found = c;
    }
  }
  return found;
}
function bindMonitorDrag() {
  const cv = $('#edView');
  if (!cv) return;
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const c = topClipAt(ED.t);
    if (!c) return;
    select([c.id]);
    const rect = cv.getBoundingClientRect();
    const kx = ED.designW / rect.width;
    const s0 = { x: c.x, y: c.y, scale: c.scale, rot: c.rot };
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false, mode = 'move';
    cv.setPointerCapture(e.pointerId);
    const mv = (ev) => {
      const dx = (ev.clientX - x0) * kx, dy = (ev.clientY - y0) * kx;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      if (ev.altKey) { mode = 'scale'; c.scale = clamp(s0.scale * (1 + dy / 260), 0.05, 4); }
      else if (ev.ctrlKey || ev.metaKey) { mode = 'rot'; c.rot = s0.rot + dx * 0.2; }
      else { mode = 'move'; c.x = s0.x + dx; c.y = s0.y + dy; }
      requestRedraw();
    };
    const up = () => {
      cv.removeEventListener('pointermove', mv);
      cv.removeEventListener('pointerup', up);
      if (moved) {
        if (ED.kfAuto) {
          const lt = ED.t - c.start;
          upsertKey(c, mode === 'scale' ? 'scale' : mode === 'rot' ? 'rot' : 'x', lt, c.x);
          if (mode === 'move') upsertKey(c, 'y', lt, c.y);
          renderInspector();
        }
        snapshot('调整画面'); markDirty();
        toast('Alt+拖=缩放 · Ctrl+拖=旋转');
      }
    };
    cv.addEventListener('pointermove', mv);
    cv.addEventListener('pointerup', up);
  });
  cv.addEventListener('dblclick', () => { const c = topClipAt(ED.t); if (c) { select([c.id]); showInspTab(c.kind === 'text' ? 'text' : 'basic'); } });
  cv.addEventListener('wheel', (e) => {
    if (!e.altKey) return;
    e.preventDefault();
    const c = topClipAt(ED.t); if (!c) return;
    c.scale = clamp(c.scale * (e.deltaY < 0 ? 1.06 : 1 / 1.06), 0.05, 4);
    requestRedraw(); markDirty();
  }, { passive: false });
}

/* 拖素材到时间线 */
function bindDrop() {
  const box = $('#ed');
  if (!box) return;
  const tl = $('#edTlBox'), tlCv = $('#edTl');
  let hot = false;
  box.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('text/x-ed-asset') || e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!hot) { hot = true; if (tl) tl.classList.add('ed-drop-hot'); }
    }
  });
  box.addEventListener('dragleave', (e) => {
    if (e.target === box || !box.contains(e.relatedTarget)) { hot = false; if (tl) tl.classList.remove('ed-drop-hot'); }
  });
  box.addEventListener('drop', async (e) => {
    e.preventDefault(); hot = false;
    if (tl) tl.classList.remove('ed-drop-hot');
    let t = ED.t, trackId = null;
    if (tl && tlCv) {
      const r = tlCv.getBoundingClientRect();
      if (e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom) {
        const G = tlGeom();
        if (G) {
          t = G.unX(e.clientX - r.left);
          const row = G.rowAt(e.clientY - r.top);
          if (row) trackId = row.tr.id;
        }
      }
    }
    const id = e.dataTransfer.getData('text/x-ed-asset');
    if (id) { addAssetAt(id, t, trackId); return; }
    const files = [...(e.dataTransfer.files || [])];
    if (files.length) {
      const list = await addFiles(files);
      if (!list.length) return;
      let at = t;
      for (const a of list) {
        const c = assetClip(trackId, a.id, at);
        if (!c) continue;
        ED.doc.clips.push(c);
        at = clipEnd(c);
      }
      recalcDur(); renderBin(); select([]); drawTimeline(); requestRedraw(); snapshot('拖入素材');
      toast('已放入 ' + list.length + ' 个素材');
    }
  });
}

/* 键盘 */
function bindShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (!ED.open) return;
    const tag = (e.target.tagName || '').toLowerCase();
    const editing = /^(input|textarea|select)$/.test(tag) || e.target.isContentEditable;
    if (e.key === 'Escape') { closeMenu(); if (editing) e.target.blur(); return; }
    if (editing) return;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k === 'd') { e.preventDefault(); duplicateSelected(); return; }
    if (mod && k === 'c') { e.preventDefault(); copySelected(); return; }
    if (mod && k === 'x') { e.preventDefault(); copySelected(); deleteSelected(false); return; }
    if (mod && k === 'v') { e.preventDefault(); pasteClipboard(); return; }
    if (mod && k === 's') { e.preventDefault(); saveProjectFile(); return; }
    if (mod && k === 'e') { e.preventDefault(); exportVideo(); return; }
    if (mod && k === 'i') { e.preventDefault(); $('#edFile').click(); return; }
    if (mod && k === 'a') { e.preventDefault(); select(ED.doc.clips.map(c => c.id)); return; }
    if (mod && (k === '+' || k === '=')) { e.preventDefault(); ED.pps = clamp(ED.pps * 1.2, 10, 520); $('#edZoom').value = ED.pps; drawTimeline(); return; }
    if (mod && k === '-') { e.preventDefault(); ED.pps = clamp(ED.pps / 1.2, 10, 520); $('#edZoom').value = ED.pps; drawTimeline(); return; }
    if (e.code === 'Space') { e.preventDefault(); const ae = document.activeElement; if (ae && ae.tagName === 'BUTTON') ae.blur(); togglePlay(); return; }
    if (k === 's') { e.preventDefault(); splitSelected(); return; }
    if (k === 'delete' || k === 'backspace') { e.preventDefault(); deleteSelected(e.shiftKey); return; }
    if (k === 'arrowleft') { e.preventDefault(); seek(ED.t - (e.shiftKey ? 1 : 1 / ED.doc.fps)); return; }
    if (k === 'arrowright') { e.preventDefault(); seek(ED.t + (e.shiftKey ? 1 : 1 / ED.doc.fps)); return; }
    if (k === 'home') { e.preventDefault(); seek(0); return; }
    if (k === 'end') { e.preventDefault(); seek(timelineEnd()); return; }
    if (k === 'n') { ED.snap = !ED.snap; $('#edSnapBtn').classList.toggle('on', ED.snap); drawTimeline(); toast(ED.snap ? '吸附开' : '吸附关'); return; }
    if (k === 'b') { ED.snapBeat = !ED.snapBeat; $('#edSnapBeatBtn').classList.toggle('on', ED.snapBeat); drawTimeline(); return; }
    if (k === 'm') { addMarkerAtPlayhead(); return; }
    if (k === 'i') { ED.doc.inPoint = ED.t; drawTimeline(); toast('入点 ' + tc(ED.t, false)); return; }
    if (k === 'o') { ED.doc.outPoint = ED.t; drawTimeline(); toast('出点 ' + tc(ED.t, false)); return; }
    if (k === 't') { addTextAt(ED.t); return; }
    if (k === 'z' && e.shiftKey) { zoomFit(); return; }
    if (k === 'f') { if (topClipAt(ED.t)) { const c = topClipAt(ED.t); select([c.id]); } return; }
  });
}

/* 帮助 */
function showHelp() {
  const m = $('#edModal');
  if (!m) return;
  m.classList.add('on');
  $('#edModalTitle').textContent = '剪辑台 · 快捷键与用法';
  $('#edModalSub').textContent = '和剪映 / PR 一样的时间线：素材拖进来，切、拖、套手法、导出。';
  $('#edModalBody').innerHTML = `
    <div class="ed-keys">
      <kbd>空格</kbd><span>播放 / 暂停</span>
      <kbd>S</kbd><span>在播放头分割</span>
      <kbd>Delete</kbd><span>删除选中 · Shift+Delete 波纹删除</span>
      <kbd>Ctrl D</kbd><span>复制片段到后面</span>
      <kbd>Ctrl C / V / X</kbd><span>复制 / 粘贴 / 剪切</span>
      <kbd>Ctrl Z</kbd><span>撤销 · Ctrl+Shift+Z 重做</span>
      <kbd>← →</kbd><span>逐帧移动播放头（Shift=1 秒）</span>
      <kbd>Ctrl 滚轮</kbd><span>时间线缩放</span>
      <kbd>拖动边缘</kbd><span>裁切片段</span>
      <kbd>Alt 拖画面</kbd><span>缩放画面 · Ctrl+拖=旋转</span>
      <kbd>N / B</kbd><span>吸附开关 / 拍点吸附</span>
      <kbd>I / O</kbd><span>设入点 / 出点（只导出这一段）</span>
      <kbd>M</kbd><span>打标记</span>
      <kbd>Ctrl E</kbd><span>导出 MP4</span>
    </div>
    <p style="margin-top:14px">做法推荐：先把音乐拖到音频轨 → 按节拍切文字（S）→ 右侧「文字 / 效果」里套手法库 → 再给图片视频加运镜 → 导出。</p>`;
  $('#edModalActs').innerHTML = '<button class="ed-btn primary" id="edHelpOk">知道了</button>';
  $('#edHelpOk').onclick = hideExportModal;
}

/* ============================================================
   打开 / 关闭
   ============================================================ */
function starterDoc() {
  const d = newDoc();
  const tr = d.tracks.find(t => t.kind === 'text');
  const v1 = d.tracks.find(t => t.kind === 'video');
  d.clips.push(defaultClip('text', {
    track: tr.id, start: 0, dur: 3.4, name: '开场文字',
    text: '把想说的话\n剪成画面。',
    fx: { layout: 'center', enter: 'pop', hold: 'breathe', exit: 'cut', treat: 'none', bg: 'none', cam: 'push', decor: [], scheme: 0, seed: 7 },
  }));
  d.clips.push(defaultClip('text', {
    track: tr.id, start: 3.6, dur: 2.6, name: '第二句',
    text: '所有素材\n都可以拖进来',
    fx: { layout: 'condensed', enter: 'wipe', hold: 'drift', exit: 'cut', treat: 'none', bg: 'none', cam: 'push', decor: [], scheme: 0, seed: 21 },
  }));
  d.clips.push(defaultClip('text', {
    track: tr.id, start: 6.4, dur: 2.4, name: '提示',
    text: '双击文字块改字',
    fx: { layout: 'huge', enter: 'assemble', hold: 'still', exit: 'cut', treat: 'none', bg: 'none', cam: 'push', decor: [], scheme: 0, seed: 33 },
  }));
  return d;
}

async function openEditor(opts) {
  if (!built) { buildShell(); bindUI(); loadPrefs(); }
  ED.open = true;
  document.body.classList.add('ed-open');
  // PV 工房如果正在播放，先停下来，省得两边抢 CPU / 抢着出声
  try {
    const S0 = window.STUDIO;
    if (S0 && S0.playing) { const b = document.querySelector('#btnPlay'); if (b) b.click(); }
  } catch (e) {}
  let fresh = false;
  if (!ED.doc) {
    let doc = null;
    try { doc = JSON.parse(localStorage.getItem(LS_DOC) || 'null'); } catch (e) {}
    fresh = !(doc && doc.tracks && doc.tracks.length);
    ED.doc = !fresh ? Object.assign(newDoc(), doc) : starterDoc();
    designSizes(); recalcDur();
    try { await restoreAssets(); } catch (e) {}
    ED.hist = { stack: [], i: -1, limit: 80 };
    snapshot('打开');
  }
  if (!$('#edTlHint')) { /* 外壳已存在 */ }
  syncDocInputs(); renderBin(); renderInspector(); sizeMonitor(); drawTimeline(); requestRedraw();
  updateTimeAll();
  if (fresh && ED.doc.clips.length) { ED.t = Math.min(1.2, Math.max(0.2, timelineEnd() * 0.3)); ensureVideoFrame(); }
  if (!ED.loopStarted) { ED.loopStarted = true; requestAnimationFrame(loopFrame); }
  requestAnimationFrame(() => { sizeMonitor(); drawTimeline(); });
  if (opts && opts.pv) setTimeout(() => importPVFromStudio(opts.pv), 80);
}
function closeEditor() {
  pause();
  PLAY.stop();
  ED.open = false;
  document.body.classList.remove('ed-open');
  saveLocal();
  try { const st = window.STUDIO; if (st && st.api && st.api.draw) st.api.draw(); } catch (e) {}
}
async function importPVFromStudio(projectArg) {
  const S = window.STUDIO;
  const proj = projectArg || (S && S.project);
  if (!proj) { toast('没有可带入的 PV 工程'); return; }
  const p = JSON.parse(JSON.stringify(proj));
  delete p.assets;
  // 还是初始示例的话，直接让位给 PV（否则两段文字叠在一起）
  const demoOnly = ED.doc.clips.length > 0 && ED.doc.clips.length <= 3 && ED.doc.clips.every(c => c.kind === 'text') && !Object.keys(ED.assets).length;
  if (demoOnly) ED.doc.clips = [];
  // PV 是全屏画面，放在最下面一条视频轨当底片；上面的文字轨就是字幕
  let tr = ED.doc.tracks.find(t => t.name === 'PV 层');
  if (!tr) {
    tr = trackDef('video', 'PV 层', 56);
    const i = ED.doc.tracks.findIndex(t => t.kind === 'audio');
    if (i < 0) ED.doc.tracks.push(tr); else ED.doc.tracks.splice(i, 0, tr);
  }
  const c = defaultClip('pv', { track: tr.id, name: (p.title || '字面 PV'), start: Math.floor(ED.t), dur: 20, pv: p });
  ED.doc.clips.push(c);
  try { const plan = planFor(c); c.dur = Math.max(1, plan.duration); } catch (e) { console.warn(e); }
  // 把 PV 的音轨也带过来
  if (S && S.audio && S.audio.buffer && !ED.doc.clips.some(x => x.kind === 'audio' && x._fromPV)) {
    try {
      const blob = J.audioWav(S.audio.buffer, S.audio.duration, 0);
      const a = await addAsset(blob, (S.audio.name || 'PV 音频') + '.wav', { kind: 'audio' });
      if (a) {
        const at = trackForKind('audio');
        if (at) {
          const ac = defaultClip('audio', { track: at.id, asset: a.id, name: a.name, start: 0, dur: Math.min(a.dur, c.dur), in: 0 });
          ac._fromPV = true;
          ED.doc.clips.push(ac);
        }
      }
    } catch (e) { console.warn('PV 音频带入失败', e); }
  }
  recalcDur(); renderBin(); select([c.id]); drawTimeline(); requestRedraw(); markDirty(); snapshot('带入 PV 工程');
  toast('已带入 PV 工程（' + c.dur.toFixed(1) + ' 秒）· 在「PV 层」轨，上面可以继续加字幕');
}
ED.openEditor = openEditor;
ED.closeEditor = closeEditor;
ED.addTextAt = addTextAt;
ED.addAssetAt = addAssetAt;
ED.exportVideo = exportVideo;
ED.importPVFromStudio = importPVFromStudio;
ED.seek = seek;
ED.play = play;
ED.pause = pause;
ED.setDoc = (d) => { ED.doc = d; designSizes(); recalcDur(); syncDocInputs(); renderBin(); renderInspector(); drawTimeline(); requestRedraw(); };
ED.addFiles = addFiles;
ED.toast = toast;
ED.tlGeom = tlGeom;
ED.topClipAt = topClipAt;
ED.setPPs = (v) => { ED.pps = clamp(v, 10, 520); const z = $('#edZoom'); if (z) z.value = ED.pps; drawTimeline(); };
ED.renderInspector = renderInspector;
ED.drawTimeline = drawTimeline;
ED.planCache = planCache;
ED.layerCache = layerCache;
ED.buildClipPlan = buildClipPlan;
ED.select = select;
ED.splitSelected = splitSelected;
ED.deleteSelected = deleteSelected;
ED.duplicateSelected = duplicateSelected;
ED.undo = undo;
ED.redo = redo;
ED.addTrack = addTrack;
ED.applyKfPreset = applyKfPreset;
ED.exportFramePNG = exportFramePNG;
ED.saveLocal = saveLocal;
ED.reRollFx = reRollFx;

/* 主站按钮挂载：等 DOM 就绪 */
function mountEntry() {
  const btn = document.getElementById('btnEditor');
  if (btn) btn.addEventListener('click', () => openEditor());
  // 从地址栏直接进剪辑台：index.html?edit=1
  try {
    if (new URLSearchParams(location.search).get('edit') === '1') openEditor();
  } catch (e) {}
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountEntry);
else setTimeout(mountEntry, 0);

})();
