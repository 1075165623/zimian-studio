/* ============================================================
   字面工房 — 效果库
   把引擎里全部手法（构图 / 入场 / 滞留 / 退场 / 装饰 / 质感 /
   背景 / 镜头 / 画面效果 / 转场）做成可预览的卡片墙：
   · 每张卡片是活的缩略图（只画屏幕上看得到的那几张）
   · 点一下 = 套用到「当前这一行」（展开的行，或播放头所在的行）
   · 卡片右上角的圆点 = 这个手法要不要参与自动编排
   ============================================================ */
(() => {
'use strict';
const S = window.STUDIO;
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const GROUPS = [
  ['layout', '构图'], ['enter', '入场'], ['hold', '滞留'], ['exit', '退场'],
  ['decor', '装饰'], ['treat', '质感'], ['bg', '背景'], ['cam', '镜头'],
  ['fx', '画面效果'], ['trans', '转场'],
];

const R = new J.Renderer();
const plans = new Map();
let raf = 0, last = 0, open = false;

/* ───────── 缩略图 ───────── */

function planFor(g, k) {
  const p = S.project;
  const id = [p.style, p.aspect, (p.fonts && JSON.stringify(p.fonts)) || '', g, k].join('|');
  let pl = plans.get(id);
  if (pl === undefined) {
    try { pl = J.previewPlan(S.project, g, k); } catch (e) { pl = null; console.warn('preview', g, k, e); }
    plans.set(id, pl);
    if (plans.size > 900) plans.delete(plans.keys().next().value);
  }
  return pl;
}

function timeFor(plan, g, now) {
  const c = plan.cuts[plan.cuts.length - 1];
  if (!c) return 0;
  const u = now / 1000;
  if (g === 'enter') return c.start + ((u % 1.5) / 1.5) * Math.max(0.3, c.inDur || 0.4);
  if (g === 'exit') { const od = Math.max(0.3, c.outDur || 0.5); return c.end - od + ((u % 1.5) / 1.5) * od; }
  if (g === 'trans') return c.start + ((u % 1.7) / 1.7) * (c.transDur || 0.35);
  if (g === 'fx') return u % 1.05;
  const span = Math.max(1.6, c.dur * 0.96);
  return c.start + ((u % span) / span) * (c.dur * 0.96);
}

function paint(cv) {
  const g = cv.dataset.g, k = cv.dataset.k, plan = planFor(g, k), ctx = cv.getContext('2d');
  if (!plan) { ctx.fillStyle = '#EDEFF3'; ctx.fillRect(0, 0, cv.width, cv.height); cv.dataset.err = 'plan null'; return; }
  try {
    // 构图卡片：能给素材留位置的版式（信纸 / 拍立得…）画一个淡淡的取景框，一眼看出"这一版能放素材"
    R.frame(ctx, plan, timeFor(plan, g, performance.now()), { scale: cv.width / plan.W, fast: true, noHud: true, noGhost: g !== 'fx', slotGuide: g === 'layout' });
  } catch (e) {
    ctx.fillStyle = '#F7F8FA'; ctx.fillRect(0, 0, cv.width, cv.height);
    cv.dataset.err = String(e && e.message || e);
    if (cv.parentNode) cv.parentNode.title = g + '/' + k + ' · ' + cv.dataset.err;
  }
  cv.dataset.ready = '1';
}

/* 只画「滚动容器里真的看得见」的卡片：比 IntersectionObserver 稳，
   因为卡片在 <details> 里、外面还有 backdrop-filter 的祖先，观察器不可靠 */
function visibleCvs() {
  const box = $('#libBody');
  if (!box) return [];
  const b = box.getBoundingClientRect(), out = [];
  for (const d of document.querySelectorAll('.lib-g[open]')) {
    for (const cv of d.querySelectorAll('canvas[data-k]')) {
      const r = cv.getBoundingClientRect();
      if (r.bottom > b.top - 60 && r.top < b.bottom + 60) out.push(cv);
    }
  }
  return out;
}

function kick() {
  if (raf) return;
  const step = now => {
    raf = 0;
    if (!open) return;
    if (now - last >= 110) {
      last = now;
      const vis = visibleCvs();
      for (let i = 0; i < vis.length; i++) paint(vis[i]);
    }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}

function teardown() {
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
}

/* ───────── 卡片墙 ───────── */

const sizeCache = {};
function thumbSize() {
  const a = S.project.aspect || '16:9';
  if (sizeCache[a]) return sizeCache[a];
  const [W, H] = J.designSize(a);
  const tw = W >= H ? 208 : 120;
  return (sizeCache[a] = [tw, Math.round(tw * H / W)]);
}

function currentValue(li, g) {
  const cs = S.plan && S.plan.cuts.filter(c => c.line === li);
  if (!cs || !cs.length) return null;
  return g === 'decor' ? (cs[0].decor || []).map(d => d.id)[0] || null : cs[0][g];
}

function fill(d, items, g) {
  if (d.dataset.built) return;
  d.dataset.built = '1';
  const grid = d.querySelector('.lib-grid');
  const tbl = J.registry(g), en = S.project.enabled[g] || (S.project.enabled[g] = {});
  const [tw, th] = thumbSize();
  const frag = document.createDocumentFragment();
  for (const k of items) {
    const def = tbl[k]; if (!def) continue;
    const card = document.createElement('div');
    card.className = 'lcard' + (def.pack === 'more' ? ' isNew' : '') + (en[k] === false ? ' isOff' : '') + (g === 'fx' ? ' noad' : '');
    card.dataset.g = g; card.dataset.k = k;
    card.title = (def.name || k) + (def.tags && def.tags.length ? '（' + def.tags.join(' / ') + '）' : '') + '\n' + k;
    card.innerHTML =
      `<canvas width="${tw}" height="${th}" data-g="${g}" data-k="${k}"></canvas>` +
      `<span class="lname">${esc(def.name || k)}</span>` +
      `<i class="ldot" title="参与自动编排"></i>`;
    frag.appendChild(card);
  }
  grid.appendChild(frag);
  kick();
}

function render(q) {
  teardown();
  const body = $('#libBody');
  body.innerHTML = '';
  q = (q || '').trim().toLowerCase();
  let total = 0;
  for (const [g, label] of GROUPS) {
    const tbl = J.registry(g);
    const items = J.order(g).filter(k => tbl[k] && !tbl[k].special);
    const shown = q ? items.filter(k => ((tbl[k].name || '') + ' ' + k).toLowerCase().includes(q)) : items;
    if (!shown.length) continue;
    total += shown.length;
    const en = S.project.enabled[g] || (S.project.enabled[g] = {});
    const onN = items.filter(k => en[k] !== false).length;
    const d = document.createElement('details');
    d.className = 'lib-g';
    d.open = !!q;
    d.dataset.g = g;
    d.innerHTML = `<summary><b>${label}</b><span class="lib-cnt">${onN} / ${items.length}</span>` +
      `<span class="lib-hint">${g === 'fx' ? '只能预览：调高「故障」时自动穿插，不能逐行指定' : '点卡片套用到当前行 · 圆点＝是否参与自动编排'}</span></summary><div class="lib-grid"></div>`;
    const shownIds = shown;
    d.addEventListener('toggle', () => { if (d.open) fill(d, shownIds, g); });
    body.appendChild(d);
    if (d.open) fill(d, shownIds, g);
  }
  $('#libCount').textContent = total + ' 个手法' + (q ? '（筛选结果）' : '');
  refreshActive();
  kick();
}

/* ───────── 应用 / 状态 ───────── */

function apply(g, k) {
  if (g === 'fx') { S.api.toast('画面效果不按行指定：调高「故障」滑杆时它会自动穿插'); return; }
  const li = S.api.targetLine();
  if (li < 0) { S.api.toast('先在上面点开一行歌词，再套用'); return; }
  S.api.setOverride(li, g, g === 'decor' ? [k] : k);
  refreshActive();
  S.api.toast((J.registry(g)[k].name || k) + ' → 第 ' + (li + 1) + ' 行');
}

function refreshActive() {
  const li = S.api.targetLine();
  const cur = {};
  for (const [g] of GROUPS) cur[g] = li >= 0 ? currentValue(li, g) : null;
  for (const card of document.querySelectorAll('.lcard')) {
    card.classList.toggle('on', cur[card.dataset.g] === card.dataset.k);
  }
  const cap = $('#libTarget');
  if (cap) {
    if (li >= 0 && S.plan && S.plan.lines[li]) {
      const t = String(S.plan.lines[li].text || '').slice(0, 18);
      cap.textContent = '第 ' + (li + 1) + ' 行　' + t;
    } else cap.textContent = '（先点开一行歌词）';
  }
}

function toggleEnable(g, k) {
  const en = S.project.enabled[g] || (S.project.enabled[g] = {});
  en[k] = en[k] === false;
  const card = document.querySelector(`.lcard[data-g="${g}"][data-k="${k}"]`);
  if (card) card.classList.toggle('isOff', en[k] === false);
  const d = card && card.closest('.lib-g');
  if (d) {
    const cnt = d.querySelector('.lib-cnt');
    const tbl = J.registry(g);
    const items = J.order(g).filter(x => tbl[x] && !tbl[x].special);
    if (cnt) cnt.textContent = items.filter(x => en[x] !== false).length + ' / ' + items.length;
  }
  S.api.replan();
}

/* ───────── 开合：左栏里的一张折叠卡片，不再是弹窗 ───────── */

const cardEl = () => document.getElementById('cardLib');

function build(box) {
  if (!box.dataset.built) {
    render('');
    box.dataset.built = '1';
    // 第一次展开：先把「构图」摊开，一进来就能看到卡片墙，而不是十个折条
    const g = box.querySelector('.lib-g');
    if (g) g.open = true;
  } else refreshActive();
}

function syncOpen() {
  const d = cardEl();
  open = !!(d && d.open);
  if (open) kick(); else teardown();
}

function openLib() {
  const d = cardEl(); if (!d) return;
  if (!d.open) d.open = true;                       // toggle 里会 build + syncOpen
  else { build(document.getElementById('libBody')); syncOpen(); }
  try { d.scrollIntoView({ block: 'nearest' }); } catch (e) {}
}

function closeLib() {
  const d = cardEl(); if (!d) return;
  if (d.open) d.open = false;
  syncOpen();
}

function bind() {
  const d = cardEl(), box = document.getElementById('libBody');
  if (!d || !box) return;

  d.addEventListener('toggle', () => {
    if (d.open) build(box);
    syncOpen();
  });
  if (d.open) { build(box); syncOpen(); }           // 上次离开时是展开的：直接接上

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && open) { e.stopPropagation(); closeLib(); }
  });

  let timer = 0;
  const search = $('#libSearch');
  if (search) search.addEventListener('input', e => {
    const q = e.target.value;
    clearTimeout(timer);
    timer = setTimeout(() => { box.dataset.built = ''; render(q); }, 220);
  });

  box.addEventListener('click', e => {
    const dot = e.target.closest('.ldot');
    if (dot) { const c = dot.closest('.lcard'); toggleEnable(c.dataset.g, c.dataset.k); e.stopPropagation(); return; }
    const card = e.target.closest('.lcard');
    if (card) apply(card.dataset.g, card.dataset.k);
  });
}

/* 画布上换行时，卡片墙跟着换「当前行」 */
let lastLine = -2;
setInterval(() => {
  if (!open || !S.api || !S.plan) return;
  const li = S.api.targetLine();
  if (li !== lastLine) { lastLine = li; refreshActive(); }
}, 400);

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
else bind();
window.LIB = { open: openLib, close: closeLib, render };

/* 深链接：?lib=1 展开左栏的效果库；?lib=翻页 直接按关键词筛 */
(() => {
  const q = new URLSearchParams(location.search);
  const v = q.get('lib');
  if (v == null || v === '0') return;
  const g = q.get('libg');
  setTimeout(() => {
    const d = cardEl(); if (!d) return;
    const s = $('#libSearch');
    if (s && v !== '1') s.value = v;
    const box = $('#libBody');
    if (!d.open) d.open = true;
    render(v === '1' ? '' : v);
    box.dataset.built = '1';
    if (!g) { const first = box.querySelector('.lib-g'); if (first) first.open = true; }
    syncOpen();
    openLib();
    if (g) {
      const grp = box.querySelector('.lib-g[data-g="' + g + '"]');
      if (grp) { grp.open = true; grp.scrollIntoView({ block: 'start' }); }
    }
  }, 300);
})();
})();
