/* ============================================================
   字面工房 STUDIO — 界面逻辑
   引擎（engine/*.js）负责「文字怎么动」，这里负责：
   1. 素材：音频分析、字幕 / LRC 导入、播放同步
   2. 把界面上调的东西写进 project，J.plan() 算出时间线并画出来
   3. 逐行覆盖、导出
   4. 版面：折叠分区、拖动改宽高
   ============================================================ */
(() => {
'use strict';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const SAMPLE = `在*黑夜*里睁开眼
光从*裂缝*中涌进来
你听见没有
我们*就是*黎明本身!

灯一盏一盏地熄灭
剩下心跳在数拍子
别说太晚了
*现在*就出发`;

const S = {
  project: null,
  plan: null,
  renderer: new J.Renderer(),
  t: 0, playing: false, t0: 0,
  need: true, slow: false,
  openLine: -1,
  exporting: null,
  fontsKey: '',
  audio: null, audioSeq: 0,
  lastCues: null, lastCuesName: '',
  taste: 'mid',
  media: [],          // 素材片段 clip：[{ id, assetId, kind(image|gif|video), name, start, dur, x, y, scale, rot, opacity, lane, front, kf:{x,y,scale,rot,opacity:[{t,v,e}]} }]
  assets: {},         // 素材的真实数据（位图 / 视频元素），删除片段后仍保留，撤销才能找回
  mediaSeq: 0,
  autoKey: false,     // 自动记录关键帧
  kfEase: 'inout',    // 新关键帧默认缓动
  beatCfg: { len: 'auto', inAnim: 'auto', pulse: true, layout: 'slot' },   // 导入时的自动落位设置（默认：融进版式）
  mediaSel: -1,       // 当前选中的素材下标
  tlPps: 60,          // 时间线缩放：每秒占多少像素（8~600）
  tlScroll: 0,        // 时间线横向滚动偏移（像素）
  snap: true,         // 吸附开关（N）
};

/* ───────────────────── 音频播放（WebAudio，导出不加任何处理） ───────────────────── */

const AP = {
  ctx: null, src: null, gain: null, startAt: 0, base: 0, vol: 0.8,
  play(buffer, offset) {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.stop();
    if (!this.gain) { this.gain = this.ctx.createGain(); this.gain.connect(this.ctx.destination); this.applyVol(); }
    const s = this.ctx.createBufferSource();
    s.buffer = buffer; s.connect(this.gain);
    const off = J.clamp(offset, 0, Math.max(0, buffer.duration - 0.01));
    s.start(0, off);
    this.src = s; this.startAt = this.ctx.currentTime; this.base = off;
  },
  stop() {
    if (!this.src) return;
    try { this.src.stop(); } catch (e) {}
    try { this.src.disconnect(); } catch (e) {}
    this.src = null;
  },
  time() { return this.ctx ? this.base + (this.ctx.currentTime - this.startAt) : 0; },
  setVol(v) { this.vol = J.clamp(v, 0, 1); this.applyVol(); },
  applyVol() { if (this.gain) this.gain.gain.value = this.vol * this.vol; },
};

/* ───────────────────────── 初始化 ───────────────────────── */

function boot() {
  const p = J.defaultProject();
  Object.assign(p, {
    lyrics: SAMPLE,
    style: 'tcg',                       // 默认：二次元渐层（TCG 糖果）
    lang: 'zh-Hans',
    aspect: '16:9',
    res: 1080,
    fps: 24,
    // 每次打开换一副编排：不再永远是同一张画面
    seed: ((Date.now() ^ (Math.random() * 1e9)) >>> 0),
    extra: false,
    typo: true,
    kinetic: true,
    horror: false,
    wa: true,
    unify: false,
    typeset: false,
    variety: 0.45,
    what: true,
    includeAudio: true,
    audioName: '',
    overrides: {},
    slotLines: [],          // 有素材要「进版式」的歌词行：planner 会优先给这些行挑能放素材的版式
    timing: { bpm: 96, offset: 0.4, snap: true, tail: 0.9, lineTimes: {}, lineDurs: {}, lineEnds: {}, lineScale: 1 },
  });
  p.fx = Object.assign(p.fx, { motion: 0.65, density: 0.5, decor: 0.45, glitch: 0.45, texture: 0.55, chroma: 0.34 });
  p.more = true;

  // 深链接：?style=mxMorning&aspect=9:16&seed=123&extra=1
  const q = new URLSearchParams(location.search);
  if (q.get('style') && J.STYLES[q.get('style')]) p.style = q.get('style');
  if (q.get('aspect')) p.aspect = q.get('aspect');
  if (q.get('seed')) p.seed = +q.get('seed') || p.seed;
  if (q.get('extra')) p.extra = q.get('extra') === '1';
  if (q.get('variety') != null && q.get('variety') !== '') p.variety = J.clamp(+q.get('variety') || 0, 0, 1);
  S.project = p;

  $('#lyrics').value = p.lyrics;
  $('#bpm').value = p.timing.bpm;
  $$('#segAspect button').forEach(b => b.classList.toggle('on', b.dataset.v === p.aspect));
  const vEl0 = $('#variety');
  if (vEl0) { vEl0.value = Math.round(p.variety * 100); $('#oVariety').textContent = p.variety.toFixed(2); }
  if ([...$('#selRes').options].some(o => +o.value === p.res)) $('#selRes').value = p.res;
  if ([...$('#selFps').options].some(o => +o.value === p.fps)) $('#selFps').value = p.fps;
  $('#swExtra').checked = !!p.extra;

  buildStyleGrid();
  buildFontSelects();
  initFolds();
  initResizers();
  bind();
  bindMediaCard();
  syncMediaUI();
  syncSubState();
  syncMediaState();

  // 效果库（app/catalog.js）用这几个入口；先挂上再生成，出问题也不会让整页卡死
  S.api = { replan, setOverride, toast, targetLine, applySubText, parseCues, cuesToLrc, loadAudioFile, drawWave, loadMediaFile, addImageFiles, dropFiles, exportPNG, tlGeom, drawTimeline, removeMedia, selectMedia, draw, drawMediaOverlay, drawMediaUnder, undo, redo };

  replan();
  commit(); syncHistBtns();          // 历史的第 0 步：刚打开时的样子

  if (S.plan && S.plan.cuts.length) {
    const c = S.plan.cuts[0];
    // 停在第一句排好版的中段（不是入场刚开始那一帧），一进来看到的是一张完整的画面
    seek(J.clamp(c.start + (c.end - c.start) * 0.55, 0, S.plan.duration - 0.1));
  }
  requestAnimationFrame(tick);
  if (window.ResizeObserver) new ResizeObserver(() => { sizeCanvas(); S.need = true; }).observe($('#viewport'));
  window.addEventListener('resize', () => { sizeCanvas(); S.need = true; drawTimeline(); });
}

/* 给引擎的音频信息：有音频就用它的长度与波形能量，拍点按当前 BPM 重建 */
function audioLike() {
  const T = S.project.timing;
  if (S.audio) {
    const a = Object.assign({}, S.audio);
    if (T.bpm > 0) a.beats = J.beatGrid(T.bpm, T.offset || 0, S.audio.duration);
    return a;
  }
  if (T.bpm > 0) return { beats: J.beatGrid(T.bpm, T.offset || 0, 600) };
  return null;
}

function replan() {
  try {
    syncSlotLines();                  // 先让编排知道哪几行有素材要「进版式」（撤销 / 重新载入之后也算得对）
    S.plan = J.plan(S.project, audioLike());
  } catch (e) {
    console.error(e);
    toast('生成失败：' + (e && e.message || e));
    return;
  }
  if (S.t > S.plan.duration) S.t = 0;
  syncSlotClips();                    // 融入版式的素材：重新贴到它那一句上（时间 / 插槽名跟着新版式走）
  sizeCanvas();
  buildLineList();
  drawTimeline();
  updateTime();
  updateSums();
  ensureFonts();
  S.need = true;
}

/* ───────────────────────── 字体 ───────────────────────── */

function ensureFonts() {
  const txt = S.project.lyrics + ' 0123456789';
  const keys = J.fontsOfPlan(S.plan);
  const key = txt + '|' + keys.join(',') + '|' + J.lang;
  if (key === S.fontsKey) return;
  S.fontsKey = key;
  J.ensureFonts(txt, keys).then(() => { S.need = true; }).catch(() => {});
}

function buildFontSelects() {
  const opts = ['<option value="">跟随风格</option>']
    .concat(J.LOCAL_FONT_PICKS.map(f => `<option value="${f.key}">${f.name}　${f.note}</option>`));
  for (const id of ['#fDisplay', '#fSerif', '#fBody']) $(id).innerHTML = opts.join('');
}

/* ───────────────────────── 风格 ───────────────────────── */

function buildStyleGrid() {
  const box = $('#styleGrid');
  box.innerHTML = '';
  for (const k of J.STYLE_ORDER) {
    const st = J.STYLES[k]; if (!st) continue;
    const sc = (st.schemes && st.schemes[0]) || {};
    const el = document.createElement('div');
    el.className = 'st' + (k === S.project.style ? ' on' : '');
    el.dataset.k = k;
    el.title = (st.name || k) + (st.desc ? ' — ' + st.desc : '');
    el.innerHTML = `<div class="st-swatch">
        <i style="background:${sc.bg || '#111'}"></i>
        <i style="background:${sc.fg || '#fff'}"></i>
        <i style="background:${sc.accent || '#888'}"></i>
      </div><div class="st-name">${st.name || k}</div>`;
    el.onclick = () => {
      S.project.style = k;
      $$('.st').forEach(e => e.classList.toggle('on', e.dataset.k === k));
      updateSums();
      replan();
    };
    box.appendChild(el);
  }
}

/* ───────────────────────── 逐行手法 ───────────────────────── */

const GROUPS = [
  ['layout', '构图'], ['enter', '入场'], ['hold', '滞留'], ['exit', '退场'],
  ['decor', '装饰'], ['treat', '质感'],
];

function techOfLine(li) {
  const cs = S.plan.cuts.filter(c => c.line === li);
  if (!cs.length) return null;
  const c = cs[0];
  return { layout: c.layout, enter: c.enter, hold: c.hold, exit: c.exit, treat: c.treat, decor: (c.decor || []).map(d => d.id)[0] };
}

function buildLineList() {
  const box = $('#lineList');
  box.innerHTML = '';
  const ov = S.project.overrides || {};
  S.plan.lines.forEach((ln, li) => {
    if (ln.interlude) return;
    const cur = techOfLine(li) || {};
    const mine = ov[li] || {};
    const row = document.createElement('div');
    row.className = 'line' + (S.openLine === li ? ' open' : '');
    row.dataset.i = li;

    const tags = GROUPS.slice(0, 4).map(([g]) => {
      const key = cur[g];
      const d = key && J.registry(g)[key];
      const custom = mine[g];
      return `<span class="tag${custom ? ' custom' : ''}">${d ? d.name : '—'}</span>`;
    }).join('');

    row.innerHTML = `<div class="lr-head">
        <span class="lr-no">${String(li + 1).padStart(2, '0')}</span>
        <span class="lr-text">${escapeHtml(ln.text || '')}</span>
        <span class="lr-tags">${tags}</span>
      </div>
      <div class="lr-body">
        <div class="lr-grid">
          ${GROUPS.map(([g, label]) => `<label>${label}<select data-g="${g}"></select></label>`).join('')}
        </div>
        <div class="lr-acts">
          <button class="btn" data-act="rand">换一套</button>
          <button class="btn" data-act="clear">恢复自动</button>
        </div>
      </div>`;

    for (const sel of row.querySelectorAll('select[data-g]')) {
      const g = sel.dataset.g;
      sel.innerHTML = '<option value="">自动</option>' +
        J.order(g).map(k => `<option value="${k}">${escapeHtml(J.registry(g)[k].name)}</option>`).join('');
      sel.value = mine[g] || '';
      sel.onchange = () => {
        const v = sel.value;
        setOverride(li, g, g === 'decor' ? (v ? [v] : null) : (v || null));
      };
    }

    row.querySelector('.lr-head').onclick = () => {
      const willOpen = S.openLine !== li;
      S.openLine = willOpen ? li : -1;
      $$('.line').forEach(e => e.classList.toggle('open', willOpen && +e.dataset.i === li));
      if (willOpen) seek(S.plan.lines[li].start + 0.01);
      updateSums();
    };
    row.querySelector('[data-act=rand]').onclick = e => { e.stopPropagation(); randomizeLine(li); };
    row.querySelector('[data-act=clear]').onclick = e => {
      e.stopPropagation();
      delete S.project.overrides[li];
      replan();
    };
    box.appendChild(row);
  });
  markNowLine();
}

function setOverride(li, g, val) {
  const o = S.project.overrides[li] || (S.project.overrides[li] = {});
  if (val == null) delete o[g]; else o[g] = val;
  if (!Object.keys(o).length) delete S.project.overrides[li];
  replan();
}

const RAND_POOL = { layout: null, enter: null, hold: null, exit: null, decor: null, treat: null };
function randomizeLine(li) {
  const seed = (Date.now() ^ (li * 2654435761)) >>> 0;
  const rng = J.rng(seed);
  const o = S.project.overrides[li] || (S.project.overrides[li] = {});
  const pickFrom = g => {
    const pool = RAND_POOL[g] || (RAND_POOL[g] = J.order(g).filter(k => J.randomOk(S.project, g, k)));
    const cur = (techOfLine(li) || {})[g];
    const rest = pool.filter(k => k !== cur);
    return rng.pick(rest.length ? rest : pool);
  };
  o.layout = pickFrom('layout');
  o.enter = pickFrom('enter');
  o.exit = pickFrom('exit');
  S.openLine = li;
  replan();
  toast('第 ' + (li + 1) + ' 行：' + J.registry('layout')[o.layout].name);
}

/* 现在该改哪一行：优先界面上展开的那行，否则跟着播放头 */
function targetLine() {
  if (S.openLine >= 0) return S.openLine;
  const c = S.plan && J.cutAt(S.plan, S.t);
  return c && c.line >= 0 ? c.line : -1;
}

function markNowLine() {
  const now = S.plan && J.cutAt(S.plan, S.t);
  const li = now ? now.line : -1;
  $$('.line').forEach(e => e.classList.toggle('now', +e.dataset.i === li));
  const cap = $('#lineCap');
  if (now && S.plan.lines[li]) {
    cap.textContent = '第 ' + (li + 1) + ' 行 · ' +
      (J.registry('layout')[now.layout] ? J.registry('layout')[now.layout].name : now.layout) + ' / ' +
      (J.registry('enter')[now.enter] ? J.registry('enter')[now.enter].name : now.enter);
  } else if (cap) cap.textContent = '';
}

/* ───────────────────────── 画布 ───────────────────────── */

function sizeCanvas() {
  const vp = $('#viewport'), c = $('#view');
  if (!S.plan || !vp.clientWidth) return;
  const ar = S.plan.W / S.plan.H;
  const pad = 30;
  const maxW = Math.max(240, vp.clientWidth - pad);
  const maxH = Math.max(135, vp.clientHeight - pad);
  let cssW = maxW * viewScale, cssH = cssW / ar;
  if (cssH > maxH * viewScale) { cssH = maxH * viewScale; cssW = cssH * ar; }
  if (cssW > maxW) { cssW = maxW; cssH = cssW / ar; }
  if (cssH > maxH) { cssH = maxH; cssW = cssH * ar; }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pw = Math.round(Math.min(S.plan.W, cssW * dpr));
  const ph = Math.round(pw / ar);
  c.width = pw; c.height = ph;
  c.style.width = Math.round(cssW) + 'px';
  c.style.height = Math.round(cssH) + 'px';
  S.need = true;
  if (S.plan) { try { draw(); } catch (e) {} }
}

function draw() {
  const c = $('#view');
  if (!c.width || !S.plan) return;
  const ctx = c.getContext('2d');
  const t0 = performance.now();
  S.renderer.frame(ctx, S.plan, S.t, { scale: c.width / S.plan.W, fast: S.playing && S.slow, overlay: drawMediaOverlay, underlay: drawMediaUnder, slot: paintSlot });
  const dt = performance.now() - t0;
  S.slow = S.playing ? (dt > 32 ? true : dt < 14 ? false : S.slow) : false;
}

function tick(now) {
  requestAnimationFrame(tick);
  if (S.exporting) return;
  if (S.playing) {
    let t = S.audio ? AP.time() : Math.max(0, (now - S.t0) / 1000);
    if (t >= S.plan.duration - 1e-3) {
      if ($('#loop').checked) { seek(0); t = 0; } else { t = S.plan.duration - 1e-3; pause(); }
    }
    S.t = t;
    S.need = true;
  }
  if (S.need) {
    S.need = false;
    syncVideos(S.t, S.playing);
    draw();
    updateTime();
    markNowLine();
    // 播放时时间线不用 60fps 全量重画（缩略图 + 波形很费），大约 22fps 足够跟手
    if (!S.playing || now - tick._tl > 45) { tick._tl = now; drawTimeline(); if (S.mediaSel >= 0) syncMediaInsp(); }
    else S.need = true;                      // 让下一帧继续补画时间线
  }
}
tick._tl = 0;

function updateTime() {
  $('#tNow').textContent = fmt(S.t);
  $('#tAll').textContent = fmt(S.plan ? S.plan.duration : 0);
}
const fmt = t => {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60), s = t % 60;
  return String(m).padStart(2, '0') + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
};

/* ───────────────────────── 播放 ───────────────────────── */

function play() {
  S.playing = true; S.t0 = performance.now() - S.t * 1000;
  if (S.audio) AP.play(S.audio.buffer, S.t);
  $('#btnPlay').classList.add('playing');
  setPlayIcon(true);
}
function pause() {
  S.playing = false;
  if (S.audio) AP.stop();
  $('#btnPlay').classList.remove('playing');
  setPlayIcon(false);
  syncVideos(S.t, false);
}
function setPlayIcon(playing) {
  $('#btnPlay').innerHTML = playing
    ? '<svg viewBox="0 0 24 24" width="18" height="18"><rect x="7" y="5" width="3.4" height="14" rx="1" fill="currentColor"/><rect x="13.6" y="5" width="3.4" height="14" rx="1" fill="currentColor"/></svg>'
    : '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M8 5.2v13.6L19 12z" fill="currentColor"/></svg>';
}
function seek(t) {
  S.t = J.clamp(t, 0, S.plan.duration - 0.001);
  S.t0 = performance.now() - S.t * 1000;
  if (S.audio && S.playing) AP.play(S.audio.buffer, S.t);
  S.need = true;
}

/* ───────────────────────── 时间线（多轨道，剪映式） ───────────────────────── */

/* 轨道从上到下：时间标尺 → 文字 → 图 1 / 图 2 … → 音频
   · 横向：S.tlPps = 每秒像素（8~600），滚动交给 .tl-scroll，画面由钉在上面的 canvas 画
     （画布永远只有窗口那么大，所以放大到每秒 600px 也不会超出浏览器画布上限）
   · 纵向：轨道多到放不下时 .tl-scroll 竖向滚动，标尺和左侧标题列钉住不动
   · 每张图片素材各占一条图片轨道：越靠上的轨道盖住下面的 */
const TL = {
  labelW: 54, rulerH: 24, laneH: 34, textMin: 34, textMax: 64, audioH: 26, pad: 6,
  maxLane: 12, sel: null, hot: null,
};

function tlLanes() {
  let n = 0;
  for (const m of S.media) n = Math.max(n, (m.lane | 0) + 1);
  return S.media.length ? J.clamp(n, 1, TL.maxLane) : 0;
}

function tlGeom() {
  const cv = $('#tl'), scroll = $('#tlScroll');
  if (!cv || !scroll || !S.plan) return null;
  const vw = scroll.clientWidth, vh = scroll.clientHeight;
  if (!vw || !vh) return null;
  const dur = Math.max(0.001, S.plan.duration);
  const pps = J.clamp(S.tlPps || 60, 8, 600);
  const lanes = tlLanes();
  const hasAudio = !!S.audio;
  const audioH = hasAudio ? TL.audioH : 0;
  const fixed = TL.rulerH + TL.pad + lanes * TL.laneH + (hasAudio ? TL.pad + audioH : 0) + TL.pad;
  const textH = J.clamp(vh - fixed, TL.textMin, TL.textMax);
  const contentH = Math.max(vh, fixed + textH);
  const contentW = Math.max(vw, TL.labelW + pps * dur + 24);
  const sl = scroll.scrollLeft, st = scroll.scrollTop;
  const textTop = TL.rulerH + TL.pad - st;
  const textBot = textTop + textH;
  const lanesTop = textBot + TL.pad;
  const audioTop = lanesTop + lanes * TL.laneH + (hasAudio ? TL.pad : 0);
  return {
    cv, scroll, plan: S.plan, P: S.plan,
    vw, vh, dur, pps, lanes, hasAudio, audioH, contentW, contentH, sl, st,
    textTop, textBot, textH, lanesTop, audioTop,
    laneTop: i => lanesTop + i * TL.laneH,
    X: t => TL.labelW + t * pps - sl,
    unX: x => J.clamp((x + sl - TL.labelW) / pps, 0, dur),
    seen: (xa, xb) => xb > TL.labelW + 2 && xa < vw - 2,
  };
}

function drawTimeline() {
  try { drawTimelineRaw(); }
  catch (e) {
    if (!drawTimeline._warned) { drawTimeline._warned = true; console.error('时间线绘制出错（已拦下，页面继续可用）', e); }
  }
}

/* 时间线配色：整条时间线用深色底，轨道里的块用高饱和颜色（文字 = 蓝，图片 = 橙，视频 = 紫，GIF = 粉，音频 = 绿），
   和背景拉开明度差；播放头用红色，不会和蓝色文字块混在一起 */
const TC = {
  bg: '#12161E', textBg: '#1A202B', laneA: '#171C26', laneB: '#1D2431', line: '#2B3446',
  audioBg: '#10231F', grid: '#242C3B', beat: '#303A50', bar: '#4A5875',
  ruler: '#0C0F15', rulerTx: '#B4BFD6', tick: '#5A6682', label: '#0C0F15',
  head: '#FF4D6A',
  text: '#4C6FFF', textManual: '#6A88FF', textSel: '#A7BAFF', textHot: '#6482FF', inter: '#3B4254',
  kinds: { image: '#F59E0B', video: '#A855F7', gif: '#EC4899' },
};

function diamond(ctx, x, y, r, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke();
}

function drawTimelineRaw() {
  const G = tlGeom();
  if (!G) return;
  const cv = G.cv;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.round(G.vw), H = Math.round(G.vh);
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  }
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  // 只给滚动条撑出尺寸（不画东西）
  const inner = $('#tlInner');
  if (inner) {
    const cw = Math.ceil(G.contentW) + 'px', ch = Math.ceil(G.contentH) + 'px';
    if (inner.style.width !== cw) inner.style.width = cw;
    if (inner.style.height !== ch) inner.style.height = ch;
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = TC.bg; ctx.fillRect(0, 0, W, H);

  // ── 轨道底色 ──
  const band = (y, h, fill) => {
    if (h <= 0) return;
    ctx.fillStyle = fill; ctx.fillRect(TL.labelW, y, W - TL.labelW, h);
    ctx.strokeStyle = TC.line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(TL.labelW, Math.round(y + h) + .5); ctx.lineTo(W, Math.round(y + h) + .5); ctx.stroke();
  };
  band(G.textTop, G.textH, TC.textBg);
  for (let i = 0; i < G.lanes; i++) band(G.laneTop(i), TL.laneH, i % 2 ? TC.laneB : TC.laneA);
  if (G.hasAudio) band(G.audioTop, G.audioH, TC.audioBg);

  // ── 时间网格 + 拍点线（卡拍的参照） ──
  const step = niceStep(G.dur, G.pps);
  const T0 = S.project.timing || {};
  ctx.save();
  ctx.beginPath(); ctx.rect(TL.labelW, TL.rulerH, W - TL.labelW, H - TL.rulerH); ctx.clip();
  for (let t = 0; t <= G.dur + 1e-6; t += step) {
    const x = Math.round(G.X(t)) + .5;
    if (x < TL.labelW || x > W) continue;
    ctx.strokeStyle = TC.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, TL.rulerH); ctx.lineTo(x, H); ctx.stroke();
  }
  if (T0.bpm > 0) {
    const b = 60 / T0.bpm, off = T0.offset || 0;
    if (b * G.pps >= 5) {
      for (let n = 0, t = off; t <= G.dur + 1e-6 && n < 4000; n++, t += b) {
        const x = Math.round(G.X(t)) + .5;
        if (x < TL.labelW || x > W) continue;
        const strong = n % 4 === 0;
        ctx.strokeStyle = strong ? TC.bar : TC.beat; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, TL.rulerH + (strong ? 0 : 6)); ctx.lineTo(x, H); ctx.stroke();
      }
    }
  }
  ctx.restore();

  // ── 文字轨道 ──
  ctx.save();
  ctx.beginPath(); ctx.rect(TL.labelW, G.textTop - 1, W - TL.labelW, G.textH + 2); ctx.clip();
  const L = G.P.lines || [];
  const T = S.project.timing || {};
  for (let i = 0; i < L.length; i++) {
    const ln = L[i];
    const e = ln.visEnd != null ? ln.visEnd : ln.end;
    const xa = G.X(ln.start), xb = G.X(e);
    if (!G.seen(xa, xb)) continue;
    const bw = Math.max(2, xb - xa);
    const y = G.textTop + 2, bh = Math.max(10, G.textH - 4);
    const sel = !!(TL.sel && TL.sel.kind === 'text' && TL.sel.i === i);
    const hot = !!(TL.hot && TL.hot.kind === 'text' && TL.hot.i === i);
    const manual = (T.lineDurs && T.lineDurs[i] != null) || (T.lineTimes && T.lineTimes[i] != null) || (T.lineEnds && T.lineEnds[i] != null);
    const inter = !!ln.interlude;
    ctx.fillStyle = inter ? TC.inter : sel ? TC.textSel : hot ? TC.textHot : manual ? TC.textManual : TC.text;
    roundRect(ctx, xa, y, bw, bh, 4); ctx.fill();
    ctx.strokeStyle = sel ? '#FFFFFF' : 'rgba(255,255,255,.28)';
    ctx.lineWidth = sel ? 2 : 1;
    roundRect(ctx, xa, y, bw, bh, 4); ctx.stroke();
    if (bw > 14) {
      ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.fillRect(xa + 1.5, y + 3, 2.5, bh - 6);
      ctx.fillRect(xb - 4, y + 3, 2.5, bh - 6);
    }
    if (bw > 20) {
      ctx.save();
      ctx.beginPath(); ctx.rect(xa + 6, y, Math.max(0, bw - 12), bh); ctx.clip();
      ctx.fillStyle = sel ? '#101828' : inter ? '#C9CFDD' : '#FFFFFF';
      ctx.font = '600 11px system-ui,"Microsoft YaHei"'; ctx.textBaseline = 'middle';
      ctx.fillText(inter ? '♪ 间奏' : (ln.text || ''), xa + 8, y + bh / 2 + .5);
      ctx.restore();
    }
  }
  ctx.restore();

  // ── 素材轨道（缩略图铺满块内，颜色按类型区分，下方画关键帧 ◆） ──
  S.media.forEach((m, i) => {
    if (!G.lanes) return;
    const lane = J.clamp(m.lane | 0, 0, Math.max(0, G.lanes - 1));
    const xa = G.X(m.start), xb = G.X(m.start + m.dur);
    if (!G.seen(xa, xb)) return;
    const bw = Math.max(3, xb - xa);
    const y = G.laneTop(lane) + 3, bh = TL.laneH - 6;
    const sel = S.mediaSel === i || !!(TL.sel && TL.sel.kind === 'media' && TL.sel.i === i);
    const bound = !!(m.inLayout && !m.orphan);        // 融进版式：时间由那一句歌词决定
    const kc = bound ? '#C4B5FD' : (TC.kinds[m.kind || 'image'] || TC.kinds.image);
    const img = m.img;
    ctx.save();
    roundRect(ctx, xa, y, bw, bh, 4); ctx.clip();
    ctx.fillStyle = '#20150A'; ctx.fillRect(xa, y, bw, bh);
    const siw = img && (img.width || img.naturalWidth), sih = img && (img.height || img.naturalHeight);
    if (img && siw && sih) {
      const k = Math.max(bw / siw, bh / sih);
      const sw = bw / k, sh = bh / k;
      try { ctx.drawImage(img, (siw - sw) / 2, (sih - sh) / 2, sw, sh, xa, y, bw, bh); } catch (err) {}
    }
    ctx.fillStyle = 'rgba(8,10,16,.50)'; ctx.fillRect(xa, y, bw, bh);       // 压暗，白字才读得清
    ctx.globalAlpha = 0.32; ctx.fillStyle = kc; ctx.fillRect(xa, y, bw, bh); ctx.globalAlpha = 1;
    ctx.fillStyle = kc; ctx.fillRect(xa, y, bw, 3);                          // 顶部类型色条
    if (bw > 22) {
      ctx.save();
      ctx.beginPath(); ctx.rect(xa + 4, y, Math.max(0, bw - 8), bh); ctx.clip();
      ctx.fillStyle = '#FFFFFF'; ctx.font = '600 10.5px system-ui,"Microsoft YaHei"'; ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = 3;
      const pre = m.kind === 'video' ? '▶ ' : m.kind === 'gif' ? 'GIF ' : '';
      ctx.fillText((bound ? '▣ ' : pre) + (m.name || '素材'), xa + 7, y + bh * 0.38);
      ctx.restore();
    }
    if (bw > 70) {   // 压在字下面 / 盖在字上面 / 融在版式里
      const tag = bound ? '版式' : m.front ? '前' : '后';
      ctx.font = '9px system-ui,"Microsoft YaHei"';
      const tw = ctx.measureText(tag).width + 9;
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      roundRect(ctx, xb - tw - 5, y + 6, tw, 13, 4); ctx.fill();
      ctx.fillStyle = bound ? '#6D28D9' : m.front ? '#B23A48' : '#8A5A2B';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(tag, xb - tw / 2 - 5, y + 12.5);
      ctx.textAlign = 'left';
    }
    ctx.restore();
    ctx.strokeStyle = sel ? '#FFFFFF' : kc; ctx.lineWidth = sel ? 2 : 1.2;
    roundRect(ctx, xa, y, bw, bh, 4); ctx.stroke();
    if (bw > 14) {
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.fillRect(xa + 1.5, y + 6, 2.5, bh - 10);
      ctx.fillRect(xb - 4, y + 6, 2.5, bh - 10);
    }
    // 关键帧 ◆
    if (bw > 24 && hasKeys(m)) {
      for (const kt of kfTimes(m)) {
        const kx = G.X(m.start + kt);
        if (kx < xa - 1 || kx > xb + 1) continue;
        const near = Math.abs((S.t - m.start) - kt) < 0.04;
        diamond(ctx, kx, y + bh - 7, near ? 5.2 : 4.2, near ? '#FFE066' : '#FFFFFF', '#101828');
      }
    }
  });

  // ── 音频轨道（波形按音频真实长度画，不再拉满整条时间线） ──
  if (G.hasAudio && S.audio) {
    const a = S.audio;
    const y0 = G.audioTop + 3, y1 = G.audioTop + G.audioH - 3;
    const mid = (y0 + y1) / 2;
    const adur = Math.max(0.1, a.duration || G.dur);
    const xa = G.X(0), xb = G.X(Math.min(adur, G.dur));
    const bw = Math.max(2, xb - xa);
    ctx.fillStyle = '#0F3D33';
    roundRect(ctx, Math.max(xa, TL.labelW), y0, bw - Math.max(0, TL.labelW - xa), y1 - y0, 4); ctx.fill();
    if (a.peaks && a.peaks.length) {
      const pk = a.peaks, n = pk.length;
      ctx.save();
      ctx.beginPath(); ctx.rect(Math.max(xa, TL.labelW), y0, Math.max(0, bw - Math.max(0, TL.labelW - xa)), y1 - y0); ctx.clip();
      for (let x = Math.max(TL.labelW, Math.floor(xa)); x < Math.min(W, xb); x++) {
        const t0 = (x - xa) / G.pps, t1 = (x + 1 - xa) / G.pps;
        const i0 = J.clamp(Math.floor(t0 / adur * n), 0, n - 1), i1 = J.clamp(Math.ceil(t1 / adur * n), i0 + 1, n);
        let mx = 0;
        for (let k = i0; k < i1; k++) if (pk[k] > mx) mx = pk[k];
        const hh = Math.max(0.8, mx * (y1 - y0) / 2);
        ctx.fillStyle = '#34D399';
        ctx.fillRect(x, mid - hh, 1, hh * 2);
      }
      ctx.restore();
    }
    if (bw > 40) {
      ctx.save();
      ctx.beginPath(); ctx.rect(Math.max(xa, TL.labelW) + 5, y0, Math.max(0, bw - 10), y1 - y0); ctx.clip();
      ctx.fillStyle = '#D1FAE5'; ctx.font = '600 10px system-ui,"Microsoft YaHei"'; ctx.textBaseline = 'middle';
      ctx.fillText(a.name || '音频', Math.max(xa, TL.labelW) + 7, (y0 + y1) / 2 + .5);
      ctx.restore();
    }
  }

  // ── 时间标尺（钉在顶部） ──
  ctx.fillStyle = TC.ruler; ctx.fillRect(0, 0, W, TL.rulerH);
  ctx.strokeStyle = TC.line; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, TL.rulerH + .5); ctx.lineTo(W, TL.rulerH + .5); ctx.stroke();
  ctx.save();
  ctx.beginPath(); ctx.rect(TL.labelW, 0, W - TL.labelW, TL.rulerH); ctx.clip();
  ctx.font = '10px system-ui,"Microsoft YaHei"'; ctx.textBaseline = 'middle';
  for (let t = 0; t <= G.dur + 1e-6; t += step) {
    const x = G.X(t);
    if (x < TL.labelW - 32 || x > W) continue;
    ctx.fillStyle = TC.rulerTx;
    ctx.fillText(fmtTick(t, step), x + 4, TL.rulerH / 2);
    ctx.strokeStyle = TC.tick;
    ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, TL.rulerH - 6); ctx.lineTo(Math.round(x) + .5, TL.rulerH); ctx.stroke();
  }
  ctx.restore();

  // ── 吸附提示线（拖动时吸到目标的那一瞬间亮一条黄线） ──
  if (tlSnapGuide != null) {
    const gx = Math.round(G.X(tlSnapGuide)) + .5;
    ctx.strokeStyle = '#FFD84D'; ctx.lineWidth = 1.4; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(gx, TL.rulerH); ctx.lineTo(gx, H); ctx.stroke(); ctx.setLineDash([]);
  }

  // ── 播放头 ──
  const px = G.X(S.t);
  if (px >= TL.labelW - 1 && px <= W + 1) {
    ctx.strokeStyle = TC.head; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(Math.round(px) + .5, TL.rulerH - 4); ctx.lineTo(Math.round(px) + .5, H); ctx.stroke();
    ctx.fillStyle = TC.head;
    ctx.beginPath();
    ctx.moveTo(px - 5.5, TL.rulerH - 10); ctx.lineTo(px + 5.5, TL.rulerH - 10); ctx.lineTo(px, TL.rulerH - 1);
    ctx.closePath(); ctx.fill();
  }

  // ── 左侧轨道标题列（钉在左边，盖住滚过去的内容） ──
  ctx.fillStyle = TC.label; ctx.fillRect(0, 0, TL.labelW, H);
  ctx.strokeStyle = TC.line; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(TL.labelW + .5, 0); ctx.lineTo(TL.labelW + .5, H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, TL.rulerH + .5); ctx.lineTo(TL.labelW, TL.rulerH + .5); ctx.stroke();
  ctx.fillStyle = '#FF8FA3'; ctx.font = '700 10.5px system-ui,"Microsoft YaHei"'; ctx.textBaseline = 'middle';
  ctx.fillText(fmt(S.t), 7, TL.rulerH / 2);

  ctx.save();
  ctx.beginPath(); ctx.rect(0, TL.rulerH + 1, TL.labelW, H - TL.rulerH); ctx.clip();
  trackLabel(ctx, G, '文字', G.textTop, G.textH, '#8FA8FF');
  for (let i = 0; i < G.lanes; i++) trackLabel(ctx, G, '图' + (i + 1), G.laneTop(i), TL.laneH, '#FBBF24');
  if (G.hasAudio) trackLabel(ctx, G, '音频', G.audioTop, G.audioH, '#34D399');
  ctx.restore();
}

/* 左侧轨道标题：小圆点 + 名字 */
function trackLabel(ctx, G, text, y, h, color) {
  if (h <= 0) return;
  const cy = y + h / 2;
  if (cy < TL.rulerH - 4 || cy > G.vh + 4) return;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(11, cy, 3, 0, Math.PI * 2); ctx.fill();
  ctx.font = '600 10.5px system-ui,"Microsoft YaHei"'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 19, cy + .5);
}

/* 根据缩放选合适的刻度步长 */
function niceStep(dur, pps) {
  const target = 74 / Math.max(1, pps);      // 每 74px 一个主刻度
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  for (const s of steps) if (s >= target) return s;
  return 600;
}

function fmtTick(t, step) {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60), s = t - m * 60;
  if (step < 1) return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  return m + ':' + String(Math.floor(s)).padStart(2, '0');
}

function roundRect(ctx, x, y, w, h, r) {
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

/* 命中检测（屏幕坐标）：返回 {kind:'text'|'media'|'empty'|'ruler', i, edge} */
function tlHit(G, x, y) {
  if (x < TL.labelW) return null;
  if (y >= G.textTop && y <= G.textBot) {
    const L = G.P.lines || [];
    for (let i = L.length - 1; i >= 0; i--) {
      const ln = L[i];
      const e = ln.visEnd != null ? ln.visEnd : ln.end;
      const xa = G.X(ln.start), xb = G.X(e);
      if (x >= xa - 1 && x <= xb + 1) {
        if (xb - xa > 12 && x <= xa + 5) return { kind: 'text', i, edge: 'left' };
        if (xb - xa > 12 && x >= xb - 6) return { kind: 'text', i, edge: 'right' };
        return { kind: 'text', i, edge: 'body' };
      }
    }
    return { kind: 'empty' };
  }
  if (G.lanes) {
    const lane = Math.floor((y - G.lanesTop) / TL.laneH);
    if (lane >= 0 && lane < G.lanes) {
      for (let i = S.media.length - 1; i >= 0; i--) {
        const m = S.media[i];
        if (J.clamp(m.lane | 0, 0, G.lanes - 1) !== lane) continue;
        const xa = G.X(m.start), xb = G.X(m.start + m.dur);
        if (x >= xa - 1 && x <= xb + 1) {
          // 块下半部分的 ◆ = 关键帧：可以点（跳到那里）也可以左右拖（改时间）
          if (xb - xa > 24 && hasKeys(m) && y >= G.laneTop(lane) + TL.laneH - 16) {
            for (const kt of kfTimes(m)) {
              if (Math.abs(x - G.X(m.start + kt)) <= 6) return { kind: 'kf', i, t: kt };
            }
          }
          if (xb - xa > 12 && x <= xa + 5) return { kind: 'media', i, edge: 'left' };
          if (xb - xa > 12 && x >= xb - 6) return { kind: 'media', i, edge: 'right' };
          return { kind: 'media', i, edge: 'body' };
        }
      }
      return { kind: 'empty' };
    }
  }
  if (G.hasAudio && y >= G.audioTop && y <= G.audioTop + G.audioH) return { kind: 'empty' };
  return { kind: 'ruler' };
}

/* 吸附：对齐到最近的节拍；没有 BPM 就对齐到 0.1s */
/* 磁吸：拖动时只有「离目标 9 像素以内」才会吸过去，平时按帧（1/fps 秒）自由移动。
   吸附目标：播放头、0、全曲结尾、拍点、其他素材 / 文字行的头尾。按住 Alt = 完全自由。 */
let tlSnapGuide = null, tlAlt = false;
function snapCands(excl) {
  const c = [0, S.t];
  if (S.plan) {
    c.push(S.plan.duration);
    (S.plan.lines || []).forEach((ln, i) => {
      if (excl && excl.kind === 'text' && excl.i === i) return;
      c.push(ln.start); c.push(ln.visEnd != null ? ln.visEnd : ln.end);
    });
  }
  S.media.forEach((m, i) => {
    if (excl && excl.kind === 'media' && excl.i === i) return;
    c.push(m.start, m.start + m.dur);
  });
  return c;
}
/* start = 想要的起点；dur > 0 时头和尾都可以吸（整块平移）；dur = 0 时只吸这一个点（拖边缘） */
function magSnapSpan(start, dur, excl) {
  const fps = S.plan ? S.plan.fps : 24;
  const fr = x => Math.round(x * fps) / fps;
  tlSnapGuide = null;
  if (!S.snap || tlAlt) return fr(start);
  const G = tlGeom(), tol = 9 / (G ? G.pps : 60);
  const cands = snapCands(excl);
  const T = S.project.timing;
  if (T.bpm > 0) {
    const b = 60 / T.bpm, off = T.offset || 0;
    for (const e of dur > 0 ? [start, start + dur] : [start]) cands.push(off + Math.round((e - off) / b) * b);
  }
  let best = null, bd = tol;
  for (const e of dur > 0 ? [0, dur] : [0]) {
    for (const c of cands) { const d = Math.abs(start + e - c); if (d < bd) { bd = d; best = { s: c - e, g: c }; } }
  }
  if (best) { tlSnapGuide = best.g; return best.s; }
  return fr(start);
}

/* 导入时的自动落位：对齐拍点（这是「自动」，不是拖动） */
function tlSnap(t) {
  if (!S.snap) return Math.round(t * 100) / 100;
  const bpm = S.project.timing.bpm, off = S.project.timing.offset || 0;
  if (bpm > 0) { const b = 60 / bpm; return Math.max(0, Math.round((t - off) / b) * b + off); }   // 对齐真正的拍点（含起拍偏移）
  return Math.round(t * 10) / 10;
}

function bindTimeline() {
  const cv = $('#tl');
  const scroll = $('#tlScroll');
  let drag = null;
  let scrollRaf = 0;

  const local = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  // 滚动后重画（标题列 / 标尺要钉住）
  scroll.addEventListener('scroll', () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; drawTimeline(); });
  });

  cv.addEventListener('pointerdown', e => {
    if (!S.plan || (e.button != null && e.button !== 0)) return;
    const G = tlGeom(); if (!G) return;
    const p = local(e);
    const hit = tlHit(G, p.x, p.y);
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}

    if (hit && hit.kind === 'kf') {
      const km = S.media[hit.i];
      S.mediaSel = hit.i; TL.sel = { kind: 'media', i: hit.i };
      syncMediaList();
      pause();
      const refs = [];
      for (const k of KPROPS) for (const q of km.kf[k]) if (Math.abs(q.t - hit.t) < 0.0015) refs.push(q);
      drag = { kfDrag: true, i: hit.i, refs, t0: hit.t, x0: p.x, pps: G.pps, moved: false };
      seek(km.start + hit.t);
    } else if (hit && (hit.kind === 'text' || hit.kind === 'media')) {
      const i = hit.i;
      let base;
      if (hit.kind === 'text') {
        const ln = S.plan.lines[i];
        const end = ln.visEnd != null ? ln.visEnd : ln.end;
        base = { start: ln.start, end, dur: Math.max(0.3, end - ln.start), next: i + 1 < S.plan.lines.length ? S.plan.lines[i + 1].start : null, lane: 0 };
        pause();
      } else {
        const m = S.media[i];
        S.mediaSel = i;
        syncMediaList();
        pause();
        if (m.inLayout && !m.orphan) {           // 融进版式：时间是这一句歌词的，不能在时间线上随便拖
          TL.sel = { kind: 'media', i };
          syncMediaInsp();
          drawTimeline();
          toast('它融在这一句的版式里，时长跟着歌词走 —— 想自由拖动先点「改成自由层」');
          return;
        }
        base = { start: m.start, dur: m.dur, lane: m.lane | 0 };
      }
      TL.sel = { kind: hit.kind, i };
      drag = { hit, x0: p.x, y0: p.y, pps: G.pps, laneH: TL.laneH, base, moved: false, lane0: base.lane | 0 };
      if (hit.kind === 'text') seek(base.start + 0.01);
    } else if (hit) {
      drag = { scrub: true };
      pause(); seek(G.unX(p.x));
    }
    drawTimeline();
  });

  cv.addEventListener('pointermove', e => {
    if (!S.plan) return;
    const p = local(e);
    if (!drag) {
      const G = tlGeom(); if (!G) return;
      const hit = tlHit(G, p.x, p.y);
      const changed = JSON.stringify(hit) !== JSON.stringify(TL.hot);
      TL.hot = hit;
      cv.style.cursor = !hit ? 'default'
        : hit.kind === 'text' || hit.kind === 'media'
          ? (hit.edge === 'body' ? 'grab' : 'ew-resize')
          : hit.kind === 'kf' ? 'ew-resize' : hit.kind === 'ruler' ? 'col-resize' : 'default';
      if (changed) drawTimeline();
      return;
    }
    if (drag.scrub) {
      const G2 = tlGeom();
      if (G2) seek(G2.unX(p.x));
      return;
    }
    if (drag.kfDrag) {
      const km = S.media[drag.i];
      if (!km) { drag = null; return; }
      const dx = p.x - drag.x0;
      if (Math.abs(dx) > 2) drag.moved = true;
      const nt = J.clamp(drag.t0 + dx / drag.pps, 0, km.dur);
      for (const q of drag.refs) q.t = +nt.toFixed(3);
      for (const k of KPROPS) km.kf[k].sort((a, b) => a.t - b.t);
      seek(km.start + nt);
      S.need = true; drawTimeline(); syncMediaInsp();
      return;
    }

    tlAlt = e.altKey;
    const G = tlGeom(); if (!G) return;
    const dx = p.x - drag.x0, dy = p.y - drag.y0;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
    const dt = dx / drag.pps;
    const h = drag.hit, b = drag.base;

    if (h.kind === 'text') {
      const i = h.i;
      const T = S.project.timing;
      if (h.edge === 'body') {
        const s = Math.max(0, magSnapSpan(b.start + dt, b.dur, { kind: 'text', i }));
        T.lineTimes[i] = s;
        T.lineEnds[i] = s + b.dur;                 // 整块平移，长度不变
        T.lineDurs[i] = b.dur;
      } else if (h.edge === 'right') {
        const e = Math.max(b.start + 0.3, magSnapSpan(b.start + b.dur + dt, 0, { kind: 'text', i }));
        const cap = b.next != null ? Math.max(b.start + 0.3, b.next) : (G.dur || e);
        T.lineEnds[i] = Math.min(e, cap);
        T.lineDurs[i] = T.lineEnds[i] - b.start;
      } else {
        const s = J.clamp(magSnapSpan(b.start + dt, 0, { kind: 'text', i }), 0, b.end - 0.3);
        T.lineTimes[i] = s;
        T.lineEnds[i] = b.end;
        T.lineDurs[i] = b.end - s;
      }
      clearTimeout(bindTimeline._t);
      bindTimeline._t = setTimeout(replan, 90);
    } else if (h.kind === 'media') {
      const m = S.media[h.i];
      if (!m) { drag = null; return; }
      if (m.inLayout && !m.orphan) { drag = null; return; }
      if (h.edge === 'body') {
        m.start = J.clamp(magSnapSpan(b.start + dt, b.dur, { kind: 'media', i: h.i }), 0, Math.max(0, G.dur - 0.2));
        // 上下拖动换轨道
        m.lane = J.clamp(drag.lane0 + Math.round(dy / drag.laneH), 0, TL.maxLane);
      } else if (h.edge === 'right') {
        m.dur = J.clamp(magSnapSpan(b.start + b.dur + dt, 0, { kind: 'media', i: h.i }) - m.start, 0.3, Math.max(0.3, G.dur - m.start));
      } else {
        const s = J.clamp(magSnapSpan(b.start + dt, 0, { kind: 'media', i: h.i }), 0, b.start + b.dur - 0.3);
        m.start = s;
        m.dur = b.start + b.dur - s;
      }
      S.need = true;
    }
    drawTimeline();
    syncMediaInsp();
  });

  const end = e => {
    if (drag && (drag.moved || drag.kfDrag)) setTimeout(commit, 60);
    if (drag && drag.hit) {
      const h = drag.hit;
      if (h.kind === 'text') {
        clearTimeout(bindTimeline._t);
        replan();
      }
    }
    drag = null;
    tlSnapGuide = null;
    drawTimeline();
    syncMediaInsp();
    try { cv.releasePointerCapture(e.pointerId); } catch (err) {}
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);

  // 滚轮：Ctrl / ⌘ 缩放（以鼠标所在时间为锚点），Shift 竖向滚动，其余横向滚动
  cv.addEventListener('wheel', e => {
    if (!S.plan) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const G = tlGeom(); if (!G) return;
      const r = cv.getBoundingClientRect();
      const ax = e.clientX - r.left;
      const anchorT = (ax + scroll.scrollLeft - TL.labelW) / G.pps;
      const k = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      S.tlPps = J.clamp(G.pps * k, 8, 600);
      drawTimeline();
      scroll.scrollLeft = Math.max(0, anchorT * S.tlPps - (ax - TL.labelW));
      drawTimeline();
    } else if (e.shiftKey) {
      scroll.scrollTop += e.deltaY;
    } else {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      scroll.scrollLeft += d;
    }
  }, { passive: false });

  // 缩放按钮（以可视区中心为锚点）
  const zoom = k => {
    const G = tlGeom(); if (!G) return;
    const midT = (scroll.scrollLeft + (G.vw - TL.labelW) / 2) / G.pps;
    S.tlPps = J.clamp(G.pps * k, 8, 600);
    drawTimeline();
    scroll.scrollLeft = Math.max(0, midT * S.tlPps - (G.vw - TL.labelW) / 2);
    drawTimeline();
  };
  $('#btnZoomIn').onclick = () => zoom(1.25);
  $('#btnZoomOut').onclick = () => zoom(1 / 1.25);
  $('#btnZoomFit').onclick = fitTimeline;
  const snapTag = $('#tlSnapTag');
  snapTag.onclick = () => {
    S.snap = !S.snap;
    snapTag.classList.toggle('off', !S.snap);
    snapTag.textContent = S.snap ? '吸附' : '自由';
    toast(S.snap ? '吸附：拖动会对齐节拍' : '不吸附，可以随便摆');
  };

  // 把图片直接拖到时间线上：落在哪一秒就从哪一秒开始
  const dropHint = $('#tlDrop');
  const showDrop = on => { if (dropHint) dropHint.hidden = !on; };
  cv.addEventListener('dragenter', e => { if (isFileDrag(e)) showDrop(true); });
  cv.addEventListener('dragover', e => {
    if (!isFileDrag(e)) return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    showDrop(true);
  });
  cv.addEventListener('dragleave', e => { if (!cv.contains(e.relatedTarget)) showDrop(false); });
  cv.addEventListener('drop', async e => {
    if (!isFileDrag(e)) return;
    e.preventDefault(); e.stopPropagation();
    showDrop(false);
    const G = tlGeom();
    const r = cv.getBoundingClientRect();
    const t = G ? G.unX(e.clientX - r.left) : S.t;
    await dropFiles([...(e.dataTransfer.files || [])], { start: t });
  });
}

/* 在播放头处分割当前行（Ctrl+B）：把当前行在播放头位置拆成两行 */
function splitAtPlayhead() {
  if (!S.plan) return;
  const li = targetLine();
  if (li < 0) { toast('先把播放头移到要分割的那一行'); return; }
  const ln = S.plan.lines[li];
  const t = S.t;
  const end = ln.visEnd != null ? ln.visEnd : ln.end;
  if (t <= ln.start + 0.3 || t >= end - 0.3) { toast('播放头要停在这一行中间才能分割'); return; }
  // 文字行不能在时间线上拆成两行（一行对应一句歌词），这里把这块在播放头处剪短
  S.project.timing.lineEnds[li] = t;
  S.project.timing.lineDurs[li] = t - ln.start;
  toast('已把这一行剪到 ' + (t - ln.start).toFixed(1) + 's');
  replan();
}


/* ───────────────────────── 素材：音频 ───────────────────────── */

async function loadAudioFile(file) {
  const my = ++S.audioSeq;
  const sum = $('#sumMedia');
  if (sum) sum.textContent = '解析中…';
  $('#dropAudio').classList.add('over');
  try {
    const a = await J.analyzeAudio(file);
    if (my !== S.audioSeq) return;
    S.audio = a;
    S.project.audioName = file.name;
    S.project.includeAudio = true;
    if (a.bpm > 0) {
      S.project.timing.bpm = Math.round(a.bpm);
      $('#bpm').value = S.project.timing.bpm;
      $('#bpmAuto').hidden = false;
    }
    syncMediaUI();
    replan();
    toast('音频已载入 · ' + fmtClock(a.duration) + ' · 约 ' + a.bpm + ' BPM');
  } catch (e) {
    console.error(e);
    if (my === S.audioSeq) { syncMediaUI(); }
    toast('音频读不出来：' + (e && e.message || e) + '（换 mp3 / wav 试试）');
  } finally {
    $('#dropAudio').classList.remove('over');
    if (my === S.audioSeq) syncMediaUI();
  }
}

function syncMediaUI() {
  const a = S.audio;
  $('#audioCard').hidden = !a;
  $('#bpmAuto').hidden = !(a && a.bpm > 0);
  if (a) {
    $('#audioName').textContent = a.name || S.project.audioName || '音频';
    $('#audioMeta').innerHTML = `<span>${fmtClock(a.duration)}</span><span><b>${a.bpm}</b> BPM</span><span>${(a.sampleRate / 1000).toFixed(1)} kHz</span>`;
    $('#sumMedia').textContent = (a.name || '音频') + ' · ' + fmtClock(a.duration);
    drawWave();
  } else {
    $('#sumMedia').textContent = '未导入';
    const cv = $('#wave'); if (cv) { const c = cv.getContext('2d'); c && c.clearRect(0, 0, cv.width, cv.height); }
  }
}

function drawWave() {
  const cv = $('#wave');
  if (!cv || !S.audio) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(80, cv.clientWidth), h = 36;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const pk = S.audio.peaks, n = pk.length, mid = h / 2;
  const dur = S.audio.duration || 1;
  for (let x = 0; x < w; x++) {
    const i0 = Math.floor(x / w * n), i1 = Math.max(i0 + 1, Math.floor((x + 1) / w * n));
    let m = 0;
    for (let i = i0; i < i1; i++) if (pk[i] > m) m = pk[i];
    const hh = Math.max(1, Math.min(mid - 1, m * mid));
    const played = (x / w) * dur <= S.t;
    ctx.fillStyle = played ? '#0D9488' : '#B7E3DC';
    ctx.fillRect(x, mid - hh, 1, hh * 2);
  }
}

/* ───────────────────────── 撤销 / 重做 ─────────────────────────
   快照式历史：每次操作结束（松开鼠标 / 改完数值 / 增删素材…）就把
   「素材片段 + 文字行时间 + 逐行手法 + 歌词」存一份，Ctrl+Z / Ctrl+Shift+Z 在快照之间跳。
   素材的真实数据（位图 / 视频）放在 S.assets 里不会被删，所以删掉的素材也能完整找回。 */

const H = { stack: [], i: -1, lock: false, max: 120 };
const NONSER = new Set(['img', 'url', 'el', 'frames']);

function snapState() {
  const p = S.project, T = p.timing || {};
  return JSON.stringify({
    media: S.media.map(m => { const o = {}; for (const k in m) if (!NONSER.has(k) && k[0] !== '_') o[k] = m[k]; return o; }),
    sel: S.mediaSel,
    lt: { lineTimes: T.lineTimes || {}, lineDurs: T.lineDurs || {}, lineEnds: T.lineEnds || {} },
    overrides: p.overrides || {},
    lyrics: p.lyrics,
  });
}

function commit() {
  if (H.lock || !S.project) return;
  const s = snapState();
  if (H.stack[H.i] === s) return;
  H.stack.length = H.i + 1;
  H.stack.push(s);
  if (H.stack.length > H.max) H.stack.shift();
  H.i = H.stack.length - 1;
  syncHistBtns();
}

function rehydrate(o) {
  const a = S.assets[o.assetId];
  if (!a) return null;
  return Object.assign({}, o, { img: a.img, url: a.url, el: a.el, frames: a.frames });
}

function restoreState(str) {
  const d = JSON.parse(str), p = S.project;
  H.lock = true;
  try {
    S.media = d.media.map(rehydrate).filter(Boolean);
    S.mediaSel = Math.min(d.sel, S.media.length - 1);
    TL.sel = S.mediaSel >= 0 ? { kind: 'media', i: S.mediaSel } : null;
    p.timing.lineTimes = d.lt.lineTimes;
    p.timing.lineDurs = d.lt.lineDurs;
    p.timing.lineEnds = d.lt.lineEnds;
    p.overrides = d.overrides;
    if (p.lyrics !== d.lyrics) { p.lyrics = d.lyrics; $('#lyrics').value = d.lyrics; }
    replan();
    syncSubState();
    syncMediaList();
    S.need = true;
    drawTimeline();
  } finally { H.lock = false; }
}

function undo() {
  commit();                                  // 先把还没记下的改动存起来，撤销才不会丢它
  if (H.i <= 0) { toast('没有可以撤销的操作了'); return; }
  H.i--;
  restoreState(H.stack[H.i]);
  H.stack[H.i] = snapState();
  syncHistBtns();
  toast('已撤销（Ctrl+Shift+Z 重做）');
}
function redo() {
  if (H.i >= H.stack.length - 1) { toast('没有可以重做的操作'); return; }
  H.i++;
  restoreState(H.stack[H.i]);
  H.stack[H.i] = snapState();
  syncHistBtns();
  toast('已重做');
}
function syncHistBtns() {
  const u = $('#btnUndo'), r = $('#btnRedo');
  if (u) u.disabled = H.i <= 0;
  if (r) r.disabled = H.i >= H.stack.length - 1;
}

/* ───────────────────────── 素材：图片 / GIF / 视频（片段 clip） ─────────────────────────
   每个素材是时间线上的一个片段：位置 x / y、大小 scale、旋转 rot、不透明度 opacity
   都可以打关键帧（时间相对片段起点）。没有关键帧的属性就用静态值。 */

const IMG_EXT = /\.(png|jpe?g|webp|gif|avif|bmp|svg)$/i;
const VID_EXT = /\.(mp4|webm|mov|m4v|ogv|mkv)$/i;
const isImageFile = f => !!f && (/^image\//.test(f.type || '') || IMG_EXT.test(f.name || ''));
const isVideoFile = f => !!f && (/^video\//.test(f.type || '') || VID_EXT.test(f.name || ''));
const isMediaFile = f => isImageFile(f) || isVideoFile(f);
const isFileDrag = e => !!(e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files'));

const KPROPS = ['x', 'y', 'scale', 'rot', 'opacity'];
const KDEF = { x: 0.5, y: 0.5, scale: 0.3, rot: 0, opacity: 1 };
const KNAME = { x: '横向位置', y: '纵向位置', scale: '大小', rot: '旋转', opacity: '不透明度' };
const EASE = {
  linear: x => x,
  in: J.E.inCubic,
  out: J.E.outCubic,
  inout: J.E.inOutCubic,
  back: x => J.E.outBack(x, 1.7),
  hold: () => 0,
};
const newKf = () => ({ x: [], y: [], scale: [], rot: [], opacity: [] });
const baseOf = (m, k) => (m[k] == null ? KDEF[k] : m[k]);
const hasKeys = m => !!m.kf && KPROPS.some(k => m.kf[k] && m.kf[k].length);

/* 某个属性在片段内 lt 秒处的值 */
function evalProp(m, k, lt) {
  const ks = m.kf && m.kf[k];
  if (!ks || !ks.length) return baseOf(m, k);
  if (lt <= ks[0].t) return ks[0].v;
  const last = ks[ks.length - 1];
  if (lt >= last.t) return last.v;
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i], b = ks[i + 1];
    if (lt < b.t) {
      const u = (lt - a.t) / Math.max(1e-6, b.t - a.t);
      const f = EASE[a.e] || EASE.inout;
      return a.v + (b.v - a.v) * f(u);
    }
  }
  return last.v;
}

/* 所有关键帧出现过的时间点（相对片段起点，去重） */
function kfTimes(m) {
  const set = new Set();
  if (m.kf) for (const k of KPROPS) for (const q of (m.kf[k] || [])) set.add(Math.round(q.t * 1000));
  return [...set].sort((a, b) => a - b).map(v => v / 1000);
}

function upsertKey(m, k, t, v, e) {
  const ks = m.kf[k];
  const ex = ks.find(q => Math.abs(q.t - t) < 0.04);
  if (ex) { ex.v = v; if (e) ex.e = e; }
  else { ks.push({ t: +t.toFixed(3), v, e: e || S.kfEase }); ks.sort((a, b) => a.t - b.t); }
}

/* 改一个属性：这个属性已有关键帧、或开了「自动记录」→ 在播放头处写关键帧；否则改静态值 */
function setProp(m, k, v) {
  const lt = J.clamp(S.t - m.start, 0, m.dur);
  if ((m.kf[k] && m.kf[k].length) || S.autoKey) upsertKey(m, k, lt, v);
  else m[k] = v;
}

function addKeyAll(m) {
  const lt = J.clamp(S.t - m.start, 0, m.dur);
  for (const k of KPROPS) upsertKey(m, k, lt, evalProp(m, k, lt));
}
function delKeyHere(m) {
  const lt = S.t - m.start;
  let n = 0;
  for (const k of KPROPS) {
    const ks = m.kf[k];
    if (!ks.length) continue;
    const v = evalProp(m, k, lt);
    const left = ks.filter(q => Math.abs(q.t - lt) >= 0.04);
    if (left.length !== ks.length) {
      n += ks.length - left.length;
      m.kf[k] = left;
      if (!left.length) m[k] = v;            // 关键帧删光了：把当前值留作静态值，画面不跳
    }
  }
  return n;
}
function jumpKey(m, dir) {
  const ts = kfTimes(m), lt = S.t - m.start;
  const t = dir > 0 ? ts.find(x => x > lt + 0.02) : [...ts].reverse().find(x => x < lt - 0.02);
  if (t == null) return false;
  seek(m.start + t);
  return true;
}

/* ── 解码：图片 / 动图 / 视频 ── */

/* 解码：优先 createImageBitmap（快）；SVG / 老浏览器退回 <img> */
async function decodeImage(file) {
  try {
    const bmp = await createImageBitmap(file);
    if (bmp && bmp.width && bmp.height) return { src: bmp, w: bmp.width, h: bmp.height, url: '' };
  } catch (e) { /* 换 <img> 再试 */ }
  const url = URL.createObjectURL(file);
  try {
    const im = new Image();
    im.src = url;
    if (im.decode) await im.decode();
    else await new Promise((res, rej) => { im.onload = res; im.onerror = () => rej(new Error('decode')); });
    const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
    if (!w || !h) throw new Error('空图片');
    return { src: im, w, h, url };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw new Error('不是能读的图片');
  }
}

/* 太大的图缩到 2400px 以内：预览 / 导出都更快，画面看不出来 */
function shrinkImage(src, w, h, max = 2400) {
  if (!(Math.max(w, h) > max)) return { src, w, h };
  const k = max / Math.max(w, h);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext('2d');
  if (g) {
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, c.width, c.height);
  }
  return { src: c, w: c.width, h: c.height };
}

/* 跳到视频的某一秒，等画面真的出来（带超时，防止卡死） */
function seekVideo(v, t) {
  return new Promise(res => {
    if (v.readyState >= 2 && !v.seeking && Math.abs(v.currentTime - t) < 0.0005) return res();
    let to = 0;
    const ok = () => { clearTimeout(to); v.removeEventListener('seeked', ok); res(); };
    to = setTimeout(ok, 2500);
    v.addEventListener('seeked', ok);
    try { v.currentTime = t; } catch (e) { ok(); }
  });
}

async function decodeVideo(file) {
  const src = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = 'auto'; v.loop = false;
  v.src = src;
  await new Promise((res, rej) => {
    v.onloadeddata = res;
    v.onerror = () => rej(new Error('浏览器读不了这个视频（建议用 mp4 H.264 或 webm）'));
  });
  const w = v.videoWidth, h = v.videoHeight;
  if (!w || !h) throw new Error('这个文件没有画面');
  const dur = isFinite(v.duration) && v.duration > 0 ? v.duration : 5;
  await seekVideo(v, Math.min(0.1, dur / 2));
  // 缩略图 / 列表小图
  const k = Math.min(1, 480 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  let thumb = '';
  try { thumb = c.toDataURL('image/jpeg', 0.7); } catch (e) {}
  v.addEventListener('seeked', () => { S.need = true; });     // 暂停时拖动播放头：画面到了再重画
  return { kind: 'video', el: v, src, img: c, iw: w, ih: h, dur, url: thumb };
}

/* GIF / 动态 WebP：用 ImageDecoder 拆成一帧一帧（Chrome / Edge）；不支持就退回第一帧静态图 */
async function decodeAnimated(file) {
  if (!window.ImageDecoder) return null;
  const gif = /gif/i.test(file.type || '') || /\.gif$/i.test(file.name || '');
  const webp = /webp/i.test(file.type || '') || /\.webp$/i.test(file.name || '');
  if (!gif && !webp) return null;
  let dec = null;
  try {
    dec = new ImageDecoder({ data: file.stream(), type: gif ? 'image/gif' : 'image/webp' });
    await dec.tracks.ready;
    const n = dec.tracks.selectedTrack.frameCount;
    if (!(n > 1)) { dec.close(); return null; }
    const frames = [];
    let total = 0;
    for (let i = 0; i < Math.min(n, 300); i++) {
      const r = await dec.decode({ frameIndex: i });
      const vf = r.image;
      const w0 = vf.displayWidth || vf.codedWidth;
      const bmp = w0 > 720
        ? await createImageBitmap(vf, { resizeWidth: 720, resizeQuality: 'high' })
        : await createImageBitmap(vf);
      const d = Math.max(0.02, (vf.duration || 100000) / 1e6);
      vf.close();
      frames.push({ img: bmp, d });
      total += d;
    }
    dec.close();
    const f0 = frames[0].img;
    return { kind: 'gif', frames, total, img: f0, iw: f0.width, ih: f0.height, url: URL.createObjectURL(file) };
  } catch (e) {
    try { dec && dec.close(); } catch (e2) {}
    return null;
  }
}

function registerAsset(a) {
  a.id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  S.assets[a.id] = a;
  return a;
}

/* ── 卡拍：每段默认多长 / 入场动画 ── */

const beatLen = () => { const b = S.project.timing.bpm; return b > 0 ? 60 / b : 0.5; };

function defaultDur(a) {
  const L = S.beatCfg.len, bpm = S.project.timing.bpm;
  if (L === 'auto') {
    if (a.kind === 'video') return a.dur;
    if (a.kind === 'gif') return Math.max(a.total, bpm > 0 ? beatLen() * 2 : 2);
    return bpm > 0 ? beatLen() * 2 : 2;
  }
  return beatLen() * (+L || 2);
}

/* ── 智能融入：丢进来就自动适配画面、跟着风格走、踩着拍子动 ──
   · 版式（autoFit）：算出位置 / 大小 / 边框 / 模糊底，写进素材里（之后都还能手改）
   · 融合度 blend：用当前这一幕的配色给素材罩一层，和歌词风格是一套
   · 踩拍律动 react：每个鼓点轻轻弹一下 + 缓慢推近（渲染时算，不占关键帧）
   · 入场 inM：弹入 / 缩放 / 滑入 / 旋转…（渲染时算，几十毫秒） */
const LAYOUT_NAME = { slot: '进版式', auto: '自动适配', cover: '铺满画面', fit: '完整 + 模糊底', card: '卡片', sticker: '贴纸', raw: '原样' };
const IN_AUTO = ['zoom', 'slideL', 'pop', 'slideR'];

function autoFit(m, layout, idx) {
  const PW = S.plan ? S.plan.W : 16, PH = S.plan ? S.plan.H : 9;
  const iw = m.iw || 1, ih = m.ih || 1;
  const fa = PW / PH, ma = iw / ih;
  const coverS = Math.max(1, (PH * iw) / (PW * ih)), containS = Math.min(1, (PH * iw) / (PW * ih));
  let L = layout || m.layout || 'auto';
  if (L === 'auto') L = Math.abs(Math.log(ma / fa)) < 0.14 ? 'cover' : 'fit';   // 比例接近 → 直接铺满；差得多 → 完整放进去 + 模糊底，不留黑边
  m.layout = L;
  m.x = 0.5; m.y = 0.5; m.rot = 0;
  m.fill = 'none'; m.border = 0; m.shadow = 0; m.radius = 0;
  const flip = ((idx == null ? S.media.indexOf(m) : idx) % 2) ? 1 : -1;
  switch (L) {
    case 'cover': m.scale = coverS; break;
    case 'fit': m.scale = containS; m.fill = 'blur'; break;
    case 'card': m.scale = containS * 0.7; m.border = Math.round(PW * 0.006); m.shadow = 1; m.radius = Math.round(PW * 0.004); m.rot = flip * 3; m.fill = 'blur'; break;
    case 'sticker': m.scale = Math.min(0.3, containS * 0.5); m.x = flip > 0 ? 0.8 : 0.2; m.y = 0.26; m.border = Math.round(PW * 0.005); m.shadow = 1; m.radius = Math.round(PW * 0.003); m.rot = flip * 5; break;
    default: m.scale = containS;
  }
  m.front = L === 'sticker';                  // 贴纸盖在字上，其余压在字下
}

function applyDefaultLook(m, idx) {
  const c = S.beatCfg;
  m.blend = 0.45;
  m.react = c.pulse ? 0.5 : 0;
  m.outFade = true;
  m.inM = c.inAnim === 'auto' ? IN_AUTO[idx % IN_AUTO.length] : c.inAnim;
  autoFit(m, c.layout, idx);
}

/* 片段范围内的每个拍点（相对片段起点） */
function clipBeats(m) {
  const T = S.project.timing, b = beatLen();
  if (!(T.bpm > 0)) return [];
  const off = T.offset || 0, out = [];
  let n = Math.ceil((m.start - off) / b - 1e-6);
  for (let bt = off + n * b; bt < m.start + m.dur - 0.02 && out.length < 400; bt += b) {
    out.push(Math.max(0, bt - m.start));
  }
  return out;
}

/* ── 预设动画：直接生成关键帧（之后还能手动改） ── */

function applyPreset(m, id, silent) {
  const D = m.dur, kf = m.kf, b = beatLen();
  const base = { x: baseOf(m, 'x'), y: baseOf(m, 'y'), scale: baseOf(m, 'scale'), rot: baseOf(m, 'rot'), opacity: baseOf(m, 'opacity') };
  const ti = Math.max(0.12, Math.min(D * 0.5, b * 0.5, 0.45));
  // 把 arr 写进某属性：先清掉 arr 时间范围内旧的关键帧
  const put = (k, arr) => {
    arr.sort((p, q) => p.t - q.t);
    const t0 = arr[0].t, t1 = arr[arr.length - 1].t;
    kf[k] = kf[k].filter(q => q.t < t0 - 1e-3 || q.t > t1 + 1e-3).concat(arr).sort((p, q) => p.t - q.t);
  };
  const K = (t, v, e) => ({ t: +Math.max(0, Math.min(D, t)).toFixed(3), v, e: e || 'inout' });
  let msg = '';
  switch (id) {
    case 'fadeIn': put('opacity', [K(0, 0, 'out'), K(ti, base.opacity, 'linear')]); msg = '淡入'; break;
    case 'fadeOut': put('opacity', [K(D - ti, base.opacity, 'in'), K(D, 0, 'linear')]); msg = '淡出'; break;
    case 'popIn':
      put('scale', [K(0, 0, 'back'), K(ti, base.scale, 'linear')]);
      put('opacity', [K(0, 0, 'out'), K(ti * 0.4, base.opacity, 'linear')]);
      msg = '弹入'; break;
    case 'slideL': put('x', [K(0, base.x - 0.6, 'out'), K(ti * 1.2, base.x, 'linear')]); msg = '左滑入'; break;
    case 'slideR': put('x', [K(0, base.x + 0.6, 'out'), K(ti * 1.2, base.x, 'linear')]); msg = '右滑入'; break;
    case 'slideU': put('y', [K(0, base.y - 0.6, 'out'), K(ti * 1.2, base.y, 'linear')]); msg = '上滑入'; break;
    case 'slideD': put('y', [K(0, base.y + 0.6, 'out'), K(ti * 1.2, base.y, 'linear')]); msg = '下滑入'; break;
    case 'spinIn':
      put('rot', [K(0, base.rot - 180, 'out'), K(ti * 1.4, base.rot, 'linear')]);
      put('scale', [K(0, base.scale * 0.2, 'out'), K(ti * 1.4, base.scale, 'linear')]);
      msg = '旋转入'; break;
    case 'shrinkOut':
      put('scale', [K(D - ti, base.scale, 'in'), K(D, 0, 'linear')]); msg = '缩小出'; break;
    case 'pulse': {
      const beats = clipBeats(m);
      if (!beats.length) { if (!silent) toast('先在顶部设一个 BPM（或导入音乐），才知道拍点在哪'); return; }
      const stride = b < 0.25 ? 2 : 1;
      const arr = [];
      beats.forEach((bt, i) => {
        if (i % stride) return;
        arr.push(K(bt, base.scale * 1.16, 'out'), K(bt + b * 0.75 * stride, base.scale, 'inout'));
      });
      if (arr[0].t > 0.001) arr.unshift(K(0, base.scale, 'out'));
      put('scale', arr);
      msg = '踩拍脉冲（' + beats.length + ' 个拍点）'; break;
    }
    case 'sway': {
      const beats = clipBeats(m);
      if (!beats.length) { if (!silent) toast('先在顶部设一个 BPM（或导入音乐），才知道拍点在哪'); return; }
      const arr = [K(0, base.rot, 'inout')];
      beats.forEach((bt, i) => { if (bt > 0.01) arr.push(K(bt, base.rot + (i % 2 ? -7 : 7), 'inout')); });
      arr.push(K(D, base.rot, 'inout'));
      put('rot', arr);
      msg = '踩拍摇摆'; break;
    }
    case 'pushIn': put('scale', [K(0, base.scale, 'linear'), K(D, base.scale * 1.2, 'linear')]); msg = '缓慢推近'; break;
    case 'pullOut': put('scale', [K(0, base.scale * 1.2, 'linear'), K(D, base.scale, 'linear')]); msg = '缓慢拉远'; break;
    case 'panLR': put('x', [K(0, base.x - 0.05, 'linear'), K(D, base.x + 0.05, 'linear')]); msg = '缓慢平移'; break;
    case 'clear':
      for (const k of KPROPS) kf[k] = [];            // 回到静态值（打关键帧之前设的那组）
      msg = '已清除全部关键帧'; break;
    default: return;
  }
  if (silent) return;
  S.need = true; drawTimeline(); syncMediaInsp(); commit();
  toast(msg + (id === 'clear' ? '' : ' · 时间线上的 ◆ 就是关键帧，可以拖'));
}

/* ── 添加素材 ── */

const mediaOverlap = (a, b) => a.start < b.start + b.dur - 0.02 && b.start < a.start + a.dur - 0.02;

/* 找一条这条素材不撞车的轨道 */
function freeLane(m) {
  for (let lane = 0; lane <= TL.maxLane; lane++) {
    let free = true;
    for (const o of S.media) {
      if (o === m) continue;
      if (J.clamp(o.lane | 0, 0, TL.maxLane) === lane && mediaOverlap(m, o)) { free = false; break; }
    }
    if (free) return lane;
  }
  return 0;
}

async function loadMediaFile(file, opt = {}) {
  try {
    let a = null;
    if (isVideoFile(file)) a = await decodeVideo(file);
    else {
      a = await decodeAnimated(file).catch(() => null);
      if (!a) {
        const dec = await decodeImage(file);
        const sh = shrinkImage(dec.src, dec.w, dec.h);
        if (!dec.url) dec.url = URL.createObjectURL(file);
        a = { kind: 'image', img: sh.src, iw: sh.w, ih: sh.h, url: dec.url };
      }
    }
    registerAsset(a);
    const planDur = S.plan ? S.plan.duration : 600;
    const maxStart = Math.max(0, planDur - 0.3);
    const want = +(opt.start != null ? opt.start : S.t) || 0;
    let st0 = Math.max(0, tlSnap(want));
    if (opt.after && st0 < want - 0.01 && S.project.timing.bpm > 0) st0 += beatLen();   // 接在上一段后面：向后取拍点，别压到上一段
    let start = J.clamp(st0, 0, maxStart);
    let dur = +opt.dur || defaultDur(a);
    if (S.beatCfg.len === 'line' && S.plan && !opt.dur) {            // 跟歌词行：起点对齐这一行，长度 = 这一行
      const cut = J.cutAt(S.plan, want + (opt.after ? 0.02 : 0));
      if (cut && cut.line >= 0 && cut.end - cut.start > 0.25) { st0 = cut.start; dur = cut.end - cut.start; start = J.clamp(st0, 0, maxStart); }
    }
    dur = J.clamp(dur, 0.3, Math.max(0.3, planDur - start));
    const m = {
      id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      assetId: a.id, kind: a.kind,
      name: file.name || '素材',
      start, dur, trim: 0, loop: true,
      x: 0.5, y: 0.5, scale: 0.3, rot: 0, opacity: 1,
      lane: 0,
      front: false,          // false = 压在歌词下面当背景，true = 盖在歌词上面当贴纸
      fade: false,
      layout: 'auto', fill: 'none', border: 0, shadow: 0, radius: 0, blend: 0, react: 0, inM: 'none', outFade: true,
      kf: newKf(),
      iw: a.iw, ih: a.ih,
      img: a.img, url: a.url, el: a.el, frames: a.frames,
    };
    m.lane = freeLane(m);
    S.media.push(m);
    S.mediaSel = S.media.length - 1;
    TL.sel = { kind: 'media', i: S.mediaSel };
    applyDefaultLook(m, S.media.length - 1);
    // 「进版式」：指定了歌词行 → 直接融进那一行的版式插槽（时间 = 这一句；这一句满了就往后一句）
    if (opt.line != null && opt.line >= 0) {
      if (!bindSlot(m, opt.line, { slot: opt.slot })) {
        const nl = nextLineAfter(opt.line);
        if (nl >= 0) bindSlot(m, nl, { slot: opt.slot });
      }
      S.mediaSel = S.media.length - 1;
    }
    m.lane = freeLane(m);
    syncMediaList();
    S.need = true;
    drawTimeline();
    return m;
  } catch (e) {
    console.error(e);
    toast('素材读不出来：' + (e && e.message || e));
    return null;
  }
}

/* 一次放进多张：默认排在播放头之后，一张接一张（起点吸附到拍点）
   「进版式」模式下：一张素材 = 一句歌词，时间自动等于那一句，并换上能放素材的版式 */
async function addImageFiles(files, opt = {}) {
  const list = [...files].filter(isMediaFile);
  if (!list.length) return 0;
  let t = Math.max(0, +(opt.start != null ? opt.start : S.t) || 0);
  let n = 0;
  const slotMode = opt.free !== true && S.beatCfg.layout === 'slot' && !!S.plan;
  let line = -1;
  if (slotMode) { const c = J.cutAt(S.plan, t); if (c && c.line >= 0) line = c.line; }
  let bound = 0;
  for (const f of list) {
    const m = await loadMediaFile(f, { start: t, after: n > 0, line: slotMode && line >= 0 ? line : -1 });
    if (m) {
      n++;
      t = m.start + m.dur;
      if (m.inLayout) { bound++; line = nextLineAfter(m.line); }
      else if (slotMode && line >= 0) line = nextLineAfter(line);
    }
  }
  if (n) {
    if (bound) replan();                 // 让这些行换成能放素材的版式（并重新贴合时间）
    S.need = true;
    syncMediaState();
    commit();
    if (bound) {
      const info = slotInfoOf(S.media[S.mediaSel] || null);
      toast('已融入 ' + bound + ' 个版面位' + (info && info.has ? ' · ' + info.tid : '') + ' · 时长跟着这一句走');
    } else {
      toast('加入 ' + n + ' 个素材 · 已按拍点排好，选中后可以打关键帧 / 套动画');
    }
  }
  return n;
}

/* 下一句歌词（用来把多张素材一张接一句地排） */
function nextLineAfter(line) {
  if (!S.plan) return -1;
  let best = -1;
  for (const c of S.plan.cuts) if (c.line > line && (best < 0 || c.line < best)) best = c.line;
  return best;
}

/* 拖进来的文件：音频 / 字幕 / 图片 / 视频各归各位 */
async function dropFiles(files, opt = {}) {
  const all = [...files];
  const audio = all.find(f => /^audio\//.test(f.type || '') || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name || ''));
  const sub = all.find(f => /\.(srt|lrc|vtt|txt)$/i.test(f.name || ''));
  const imgs = all.filter(isMediaFile);
  if (audio) await loadAudioFile(audio);
  if (sub) await importSubFile(sub);
  if (imgs.length) await addImageFiles(imgs, opt);
  if (!audio && !sub && !imgs.length) {
    const o = all[0];
    toast('「' + ((o && o.name) || '这个文件') + '」不支持：请放图片 / GIF / 视频（mp4、webm）、音频或 srt / lrc 字幕');
  }
  return imgs.length;
}

/* ── 视频同步（预览用）和逐帧定位（导出用） ── */

function videoTime(m, lt) {
  const d = m.el.duration || 1;
  const base = Math.max(0, lt) + (m.trim || 0);
  return m.loop === false ? Math.min(base, Math.max(0, d - 0.04)) : base % d;
}

/* 播放时让每个视频元素跟着时间线走；暂停时停在对应那一帧 */
function syncVideos(t, playing) {
  for (const m of S.media) {
    if (m.kind !== 'video' || !m.el) continue;
    const v = m.el, lt = t - m.start;
    const active = lt >= -0.02 && lt <= m.dur + 0.02;
    if (!active || S.exporting) { if (!v.paused) v.pause(); continue; }
    const vt = videoTime(m, lt);
    if (playing) {
      if (Math.abs(v.currentTime - vt) > 0.3) { try { v.currentTime = vt; } catch (e) {} }
      if (v.paused) { const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); }
    } else {
      if (!v.paused) v.pause();
      if (!v.seeking && Math.abs(v.currentTime - vt) > 0.02) { try { v.currentTime = vt; } catch (e) {} }
    }
  }
}

/* 导出时每一帧渲染之前调用：把用到的视频精确跳到这一帧 */
async function prepareFrame(t) {
  const jobs = [];
  for (const m of S.media) {
    if (m.kind !== 'video' || !m.el) continue;
    const lt = t - m.start;
    if (lt < -0.02 || lt > m.dur + 0.02) continue;
    jobs.push(seekVideo(m.el, videoTime(m, lt)));
  }
  if (jobs.length) await Promise.all(jobs);
}

/* ── 画面绘制 ── */

function sourceOf(m, lt) {
  if (m.kind === 'video' && m.el) return m.el.readyState >= 2 ? m.el : m.img;
  if (m.kind === 'gif' && m.frames && m.frames.length) {
    const a = S.assets[m.assetId] || {};
    let tt = a.total > 0 ? (m.loop === false ? Math.min(lt, a.total - 0.001) : lt % a.total) : 0;
    if (tt < 0) tt = 0;
    for (const f of m.frames) { if (tt < f.d) return f.img; tt -= f.d; }
    return m.frames[m.frames.length - 1].img;
  }
  return m.img;
}

/* 入场动作（渲染时算）：几十毫秒的短动作，让素材「冲」进画面而不是硬蹦出来 */
function motionIn(m, lt, W) {
  const o = { s: 1, dx: 0, rot: 0, a: 1 };
  const kind = m.inM || 'none';
  if (kind === 'none') return o;
  const ti = Math.max(0.1, Math.min(0.28, m.dur * 0.4));
  if (lt >= ti) return o;
  const u = J.clamp(lt / ti), e = J.E.outCubic(u), fa = Math.min(1, u * 3);
  switch (kind) {
    case 'pop': o.s = J.E.outBack(u, 2.2); o.a = Math.min(1, u * 4); break;
    case 'zoom': o.s = J.lerp(1.22, 1, e); o.a = fa; break;
    case 'fade': o.a = u; break;
    case 'slideL': o.dx = -(1 - e) * W * 0.45; o.a = fa; break;
    case 'slideR': o.dx = (1 - e) * W * 0.45; o.a = fa; break;
    case 'spin': o.rot = -(1 - e) * 80; o.s = J.lerp(0.55, 1, e); o.a = fa; break;
  }
  return o;
}

/* 模糊底：把素材缩成 48 像素宽再拉满画面 = 剪映那种「背景模糊」，画面永远没有黑边 */
function blurBackdrop(m, src, W, H) {
  const bw = 48, bh = Math.max(8, Math.round(48 * H / W));
  let c = m._bf;
  if (!c || c.width !== bw || c.height !== bh) { c = m._bf = document.createElement('canvas'); c.width = bw; c.height = bh; }
  const sw = src.videoWidth || src.naturalWidth || src.width, sh = src.videoHeight || src.naturalHeight || src.height;
  if (!sw || !sh) return null;
  const k = Math.max(bw / sw, bh / sh), dw = sw * k, dh = sh * k;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'low';
  try { g.drawImage(src, (bw - dw) / 2, (bh - dh) / 2, dw, dh); } catch (e) { return null; }
  return c;
}

let _fbScheme = null, _fbKey = '';
function fallbackScheme() {
  const k = S.project.style + '|' + JSON.stringify(S.project.colors || {});
  if (k !== _fbKey) { _fbKey = k; try { _fbScheme = J.resolveStyle(S.project).schemes[0]; } catch (e) { _fbScheme = { bg: '#111', fg: '#fff', accent: '#fff' }; } }
  return _fbScheme;
}

/* 把素材按时间叠到画面上（Renderer.frame 的两个回调：
   underlay = 压在歌词下面（默认，当背景用），overlay = 盖在歌词上面（当贴纸用））
   注意：这两个钩子拿到 ctx 的时候坐标系是「画布像素」，所以这里要自己把
   设计坐标（W×H）换算成画布像素。 */
function paintMedia(env, t, front) {
  if (!S.media.length) return;
  const ctx = env.ctx, W = env.W, H = env.H;
  const k = (ctx.canvas.width || W) / W || 1;
  const scheme = env.sc || fallbackScheme();
  const T = S.project.timing || {};
  const bl = T.bpm > 0 ? 60 / T.bpm : 0, off = T.offset || 0;
  ctx.save();
  ctx.setTransform(k, 0, 0, k, 0, 0);
  // 轨道号小的在上面：倒着画，最后画的盖在最上层
  const list = S.media.slice().sort((a, b) => (b.lane | 0) - (a.lane | 0));
  for (const m of list) {
    if (m.inLayout && !m.orphan) continue;          // 已经融进版式：由版式的插槽来画，不再当贴图浮在画面中间
    if ((m.front === true) !== front) continue;
    if (t < m.start - 1e-4 || t > m.start + m.dur + 1e-4) continue;
    const lt = t - m.start;
    const img = sourceOf(m, lt);
    if (!img) continue;
    const iw = m.iw || img.width, ih = m.ih || img.height;
    if (!iw || !ih) continue;
    // 踩拍律动：鼓点上轻轻弹一下 + 整段缓慢推近
    const react = m.react || 0;
    let kick = 0;
    if (react > 0 && bl > 0) { const ph = (((t - off) / bl) % 1 + 1) % 1; kick = Math.exp(-ph * 5.5); }
    const mi = motionIn(m, lt, W);
    const baseSc = J.clamp(evalProp(m, 'scale', lt), 0.005, 8);
    const sc = baseSc * (1 + 0.045 * react * kick) * (1 + 0.05 * react * (lt / Math.max(0.3, m.dur))) * mi.s;
    const cw = W * sc, ch = cw * ih / iw;
    const cx = evalProp(m, 'x', lt) * W + mi.dx, cy = evalProp(m, 'y', lt) * H;
    const rot = evalProp(m, 'rot', lt) + mi.rot;
    const opKeys = m.kf && m.kf.opacity && m.kf.opacity.length;
    const fade = (m.fade && !opKeys) ? J.clamp(Math.min(lt, m.dur - lt) / 0.22) : 1;
    const outF = (m.outFade !== false && m.dur > 0.4) ? J.clamp((m.dur - lt) / 0.08) : 1;
    const a = fade * outF * mi.a * J.clamp(evalProp(m, 'opacity', lt), 0, 1);
    if (a <= 0.002) continue;
    ctx.globalCompositeOperation = 'source-over';

    // ① 模糊底：素材没铺满画面时，用它自己的模糊放大版垫在后面
    const coverS = Math.max(1, (H * iw) / (W * ih));
    if (m.fill === 'blur' && baseSc < coverS * 0.995) {
      const bf = blurBackdrop(m, img, W, H);
      if (bf) {
        ctx.globalAlpha = a;
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bf, 0, 0, W, H);
        ctx.globalAlpha = a * 0.38; ctx.fillStyle = scheme.bg; ctx.fillRect(0, 0, W, H);    // 往当前配色的底色上靠，歌词更清楚
      }
    }

    // ② 素材本体（边框 / 阴影 / 圆角 / 配色融合）
    ctx.save();
    ctx.translate(cx, cy);
    if (rot) ctx.rotate(rot * Math.PI / 180);
    const bd = m.border || 0, rad = m.radius || 0;
    ctx.globalAlpha = a;
    if (bd > 0) {
      ctx.save();
      if (m.shadow) { ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 44 * k; ctx.shadowOffsetY = 16 * k; }
      ctx.fillStyle = scheme.fg;
      roundRect(ctx, -cw / 2 - bd, -ch / 2 - bd, cw + bd * 2, ch + bd * 2, rad + bd); ctx.fill();
      ctx.restore();
    }
    ctx.save();
    if (rad > 0 || bd > 0) { roundRect(ctx, -cw / 2, -ch / 2, cw, ch, rad); ctx.clip(); }
    try { ctx.drawImage(img, -cw / 2, -ch / 2, cw, ch); } catch (e) {}
    const bw2 = m.blend || 0;
    if (bw2 > 0) {                                      // 融合度：先柔光叠一层强调色，再往底色靠一点
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = a * Math.min(1, bw2 * 0.95); ctx.fillStyle = scheme.accent || scheme.fg;
      ctx.fillRect(-cw / 2, -ch / 2, cw, ch);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = a * bw2 * 0.28; ctx.fillStyle = scheme.bg;
      ctx.fillRect(-cw / 2, -ch / 2, cw, ch);
    }
    ctx.restore();
    ctx.restore();
  }
  ctx.restore();
}
const drawMediaOverlay = (env, t) => paintMedia(env, t, true);    // 文字之上
const drawMediaUnder = (env, t) => paintMedia(env, t, false);     // 文字之下

/* ─────────────────── 素材插槽：让素材真的「进」到版面里 ───────────────────
   版式（信纸 / 拍立得 / 明信片 / 邮票…）在画自己那张纸的时候留了插槽
   （engine/12_slot.js）。素材一旦「融入」某一行：
   · 由那一行的版式来画 —— 纸怎么入场、怎么歪、怎么退场，图就跟着怎么走
   · 时间严格等于这一句歌词，整片重排后自动重新贴合（不再随便停在时间线上）
   · 关键帧仍然能用，只是变成「在这张纸里」的缩放 / 微移 / 微转        */

const LAYOUT_CN = k => (J.LAYOUTS[k] && (J.LAYOUTS[k].cn || J.LAYOUTS[k].name)) || k;

function cutOfLine(line) {
  if (!S.plan || line == null || line < 0) return null;
  for (const c of S.plan.cuts) if (c.line === line && c.end - c.start > 0.15) return c;
  return null;
}

function slotNamesOf(layout) {
  const L = J.LAYOUTS[layout];
  return (L && L.slots && L.slots.length) ? L.slots : ['photo'];
}

/* 播放头（或素材起点）落在哪一句歌词上 —— 放进版式时用它 */
function slotTargetLine(m) {
  if (!S.plan) return -1;
  let c = J.cutAt(S.plan, S.t);
  if (!c || c.line < 0) c = J.cutAt(S.plan, (m ? m.start : 0) + 0.02);
  return c && c.line >= 0 ? c.line : -1;
}

/* 这一行的版式还有哪个插槽空着（明信片有卡身 + 邮票两个） */
function freeSlotName(line, layout, except) {
  const names = slotNamesOf(layout);
  for (const n of names) {
    const taken = S.media.some(c => c !== except && c.inLayout && !c.orphan && c.line === line && (c.slotName || 'photo') === n);
    if (!taken) return n;
  }
  return null;
}

/* 把素材绑到某一行：位置交给版式的插槽，时间交给这一句歌词。这一行满了返回 null */
function bindSlot(m, line, opts = {}) {
  const cut = cutOfLine(line);
  if (!cut) return null;
  const name = opts.slot || freeSlotName(line, cut.layout, m);
  if (!name) return null;
  m.inLayout = true;
  m.orphan = false;
  m.line = line | 0;
  m.slotName = name;
  m.scale = 1; m.x = 0.5; m.y = 0.5; m.rot = 0; m.opacity = 1;
  m.blend = 0; m.border = 0; m.radius = 0; m.shadow = 0; m.fill = 'none'; m.react = 0; m.inM = 'none';
  m.front = false; m.fade = false; m.kf = newKf();
  m.layout = 'slot';
  m.start = cut.start;
  m.dur = Math.max(0.2, cut.end - cut.start);
  if (!Array.isArray(S.project.slotLines)) S.project.slotLines = [];
  if (!S.project.slotLines.includes(m.line)) S.project.slotLines.push(m.line);
  return m;
}

function unbindSlot(m) {
  m.inLayout = false; m.orphan = false; m.line = null; m.slotName = null;
  if (m.layout === 'slot') m.layout = 'auto';
  syncSlotLines();
  return m;
}

/* 由 S.media 反推「哪几行要版式插槽」，planner 会优先给这些行挑能放素材的版式 */
function syncSlotLines() {
  const lines = [];
  for (const m of S.media) if (m.inLayout && m.line != null && !lines.includes(m.line)) lines.push(m.line);
  S.project.slotLines = lines;
  return lines;
}

/* 每次重排之后调用：把融入版式的素材重新贴到它那一句上（整片重排、改风格、改时间都跟得上） */
function syncSlotClips() {
  if (!S.plan) return;
  if (!S.media.length) { if (Array.isArray(S.project.slotLines) && S.project.slotLines.length) S.project.slotLines = []; return; }
  for (const m of S.media) {
    if (!m.inLayout) continue;
    const cut = cutOfLine(m.line);
    const L = cut && J.LAYOUTS[cut.layout];
    if (!cut || !L || !L.slot) {                     // 这一句没了 / 换成了没有插槽的版式 → 先按自由层画
      if (!m.orphan) {
        m.orphan = true;
        if (!((m.scale || 0) < 0.9)) { m.scale = 0.32; m.x = 0.5; m.y = 0.5; m.rot = 0; }
      }
      continue;
    }
    m.orphan = false;
    const names = slotNamesOf(cut.layout);
    if (!names.includes(m.slotName)) m.slotName = names[0];
    m.start = cut.start;
    m.dur = Math.max(0.2, cut.end - cut.start);
  }
  syncSlotLines();
}

/* 版式在画插槽时回调它：把素材按 cover 裁进 [x,y,w,h]，跟着当前画布变换走 */
function paintSlot(slot) {
  if (!S.plan || !S.media.length || !slot) return false;
  const cut = slot.cut;
  if (!cut || cut.line < 0) return false;
  const t = slot.env && slot.env.t != null ? slot.env.t : S.t;
  const live = c => c.inLayout && !c.orphan && c.line === cut.line && t >= c.start - 0.03 && t <= c.start + c.dur + 0.03;
  let m = S.media.find(c => live(c) && (c.slotName || 'photo') === slot.name);
  if (!m) m = S.media.find(live);                                 // 版式换了、插槽名对不上：这一行的素材顶上
  if (!m) return false;
  const lt = t - m.start;
  const img = sourceOf(m, lt);
  if (!img) return false;
  const iw = m.iw || img.videoWidth || img.naturalWidth || img.width || 0;
  const ih = m.ih || img.videoHeight || img.naturalHeight || img.height || 0;
  if (!iw || !ih) return false;
  const tone = (J.SLOT_TONES && J.SLOT_TONES[slot.tone]) || { desat: 0, veil: 0, alpha: 1, zoom: 1.02 };
  const zoom = J.clamp(evalProp(m, 'scale', lt), 0.02, 6) * (tone.zoom || 1);
  const op = J.clamp(evalProp(m, 'opacity', lt), 0, 1) * slot.alpha * (tone.alpha == null ? 1 : tone.alpha);
  if (op <= 0.004 || zoom <= 0.005) return false;
  const ctx = slot.env.ctx;
  const pad = (slot.margin || 0) * Math.min(slot.w, slot.h);
  const vw = Math.max(1, slot.w - pad * 2), vh = Math.max(1, slot.h - pad * 2);
  const fitK = slot.fit === 'contain' ? Math.min(vw / iw, vh / ih) : Math.max(vw / iw, vh / ih);
  const k = fitK * zoom;
  const dw = iw * k, dh = ih * k;
  const rot = (evalProp(m, 'rot', lt) + (slot.rot || 0)) * J.DEG;
  const dx = slot.w / 2 + (evalProp(m, 'x', lt) - 0.5) * slot.w;
  const dy = slot.h / 2 + (evalProp(m, 'y', lt) - 0.5) * slot.h;
  ctx.save();
  ctx.setTransform(slot.m[0], slot.m[1], slot.m[2], slot.m[3], slot.m[4], slot.m[5]);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.translate(slot.x, slot.y);
  J.roundPath(ctx, 0, 0, slot.w, slot.h, slot.r);
  ctx.clip();
  if (slot.fit === 'contain') { ctx.globalAlpha = op; ctx.fillStyle = slot.paper; ctx.fillRect(0, 0, slot.w, slot.h); }
  try { if (tone.desat > 0.01) ctx.filter = 'saturate(' + (1 - tone.desat).toFixed(2) + ')'; } catch (e) {}
  ctx.globalAlpha = op;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.translate(dx, dy);
  if (rot) ctx.rotate(rot);
  try {
    const sw = img.videoWidth || img.naturalWidth || img.width, sh = img.videoHeight || img.naturalHeight || img.height;
    ctx.drawImage(img, 0, 0, sw, sh, -dw / 2, -dh / 2, dw, dh);
  } catch (e) { ctx.restore(); return false; }
  try { ctx.filter = 'none'; } catch (e) {}
  // 「印」在纸上：罩一层纸色 + 轻微压平，让它和这张纸是同一份材质
  const veil = tone.veil || 0;
  if (veil > 0.01) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = op * veil;
    ctx.fillStyle = slot.paper;
    ctx.fillRect(-dw / 2 - 2, -dh / 2 - 2, dw + 4, dh + 4);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = op * veil * 0.5;
    ctx.fillRect(-dw / 2 - 2, -dh / 2 - 2, dw + 4, dh + 4);
  }
  ctx.restore();
  return true;
}

/* 这一行现在是什么版式 / 有没有插槽 —— 面板上显示用 */
function slotInfoOf(m) {
  if (!m || !m.inLayout) return null;
  const cut = cutOfLine(m.line);
  if (!cut) return { line: m.line, layout: null, tid: '这一句已经不在时间线上了' };
  const L = J.LAYOUTS[cut.layout];
  const has = !!(L && L.slot);
  return {
    line: m.line,
    layout: cut.layout,
    tid: '第 ' + (m.line + 1) + ' 句 · ' + LAYOUT_CN(cut.layout) + (has ? '' : '（这一版没有插槽）'),
    has,
  };
}


const KIND_TAG = { image: '图', gif: 'GIF', video: '视频' };

function syncMediaList() {
  const box = $('#mediaList');
  const sum = $('#sumMedia2');
  if (sum) sum.textContent = S.media.length + ' 个';
  if (S.mediaSel >= S.media.length) S.mediaSel = S.media.length - 1;
  if (box) {
    box.innerHTML = '';
    S.media.forEach((m, i) => {
      const item = document.createElement('div');
      item.className = 'media-item' + (S.mediaSel === i ? ' on' : '');
      item.dataset.i = i;
      item.innerHTML =
        '<span class="mi-thumb">' + (m.url ? '<img src="' + m.url + '" alt="">' : '▣') + '</span>' +
        '<span class="mi-name"><i class="mi-kind k-' + (m.kind || 'image') + '">' + (KIND_TAG[m.kind] || '图') + '</i>' + escapeHtml(m.name || '素材') + '</span>' +
        '<span class="mi-lane' + (m.inLayout && !m.orphan ? ' slot' : '') + '" title="' + (m.inLayout && !m.orphan ? '融在版式里：时间跟着这一句歌词' : '所在轨道（上面的轨道盖住下面的）') + '">' + (m.inLayout && !m.orphan ? '版式' : '图' + (J.clamp(m.lane | 0, 0, TL.maxLane) + 1)) + '</span>' +
        '<button class="mi-del" title="删除素材（Ctrl+Z 可以撤销）">×</button>';
      item.onclick = e => { if (e.target.closest('.mi-del')) return; selectMedia(i); };
      item.querySelector('.mi-del').onclick = e => { e.stopPropagation(); removeMedia(i); };
      box.appendChild(item);
    });
    if (!S.media.length) {
      const empty = document.createElement('p');
      empty.className = 'tip tight';
      empty.textContent = '还没有素材。点上面的「选择」，或者把图片 / GIF / 视频直接拖进时间线或画面里。';
      box.appendChild(empty);
    }
  }
  syncMediaInsp();
}

function selectMedia(i) {
  const m = S.media[i];
  if (!m) return;
  S.mediaSel = i;
  TL.sel = { kind: 'media', i };
  syncMediaList();
  drawTimeline();
  if (S.playing) pause();
  seek(m.start + Math.min(m.dur * 0.5, 0.5));
  toast('已选中「' + (m.name || '素材') + '」· 画面上直接拖可以摆位置');
}

function removeMedia(i) {
  const m = S.media[i];
  if (!m) return;
  // 注意：不释放 url / 位图，素材数据还留在 S.assets 里，Ctrl+Z 才能把它完整找回来
  if (m.el && !m.el.paused) m.el.pause();
  S.media.splice(i, 1);
  if (S.mediaSel >= S.media.length) S.mediaSel = S.media.length - 1;
  if (TL.sel && TL.sel.kind === 'media' && TL.sel.i === i) TL.sel = null;
  syncMediaList();
  drawTimeline();
  S.need = true;
  commit();
  toast('已删除素材 · 按 Ctrl+Z 可以撤销');
}

/* 选中素材的小面板：显示的是「播放头所在时刻」的值（有关键帧时会跟着变） */
function syncMediaInsp() {
  const box = $('#mediaInsp');
  if (!box) return;
  const m = S.media[S.mediaSel];
  box.hidden = !m;
  if (!m) return;
  const lt = J.clamp(S.t - m.start, 0, m.dur);
  const sc = Math.round(J.clamp(evalProp(m, 'scale', lt), 0.02, 3) * 100);
  const op = Math.round(J.clamp(evalProp(m, 'opacity', lt), 0, 1) * 100);
  const rot = Math.round(J.clamp(evalProp(m, 'rot', lt), -180, 180));
  const name = $('#miSelName');
  if (name && name.textContent !== (m.name || '素材')) name.textContent = m.name || '素材';
  const setVal = (sel, v) => { const el = $(sel); if (el && document.activeElement !== el && el.value !== String(v)) el.value = v; };
  setVal('#miScale', sc);
  setVal('#miOpacity', op);
  setVal('#miRot', rot);
  setVal('#miStart', (+m.start).toFixed(2));
  setVal('#miDur', (+m.dur).toFixed(2));
  const os = $('#oMiScale'); if (os) os.textContent = sc + '%';
  const oo = $('#oMiOpacity'); if (oo) oo.textContent = op + '%';
  const orr = $('#oMiRot'); if (orr) orr.textContent = rot + '°';
  const fr = $('#miFront');
  if (fr) {
    const label = m.front ? '在字上' : '在字下';
    if (fr.textContent !== label) fr.textContent = label;
    fr.classList.toggle('on', !!m.front);
  }
  // 智能融入
  const setSel = (sel, v) => { const el = $(sel); if (el && document.activeElement !== el && el.value !== String(v)) el.value = v; };
  setSel('#miLayout', m.layout || 'auto');
  setSel('#miIn', m.inM || 'none');
  setVal('#miBlend', Math.round((m.blend || 0) * 100));
  setVal('#miReact', Math.round((m.react || 0) * 100));
  const ob = $('#oMiBlend'); if (ob) ob.textContent = Math.round((m.blend || 0) * 100) + '%';
  const orc = $('#oMiReact'); if (orc) orc.textContent = Math.round((m.react || 0) * 100) + '%';
  // 版面位：融在版式里 / 还是自由层
  const sbox = $('#miSlotBox'), sinfo = $('#miSlotInfo');
  const inSlot = !!(m.inLayout && !m.orphan);
  if (sbox) sbox.hidden = false;
  if (sinfo) {
    const info = slotInfoOf(m);
    sinfo.textContent = inSlot ? ((info && info.tid) || '在版式里') + ' · 时长跟着这一句'
      : m.inLayout ? '这一句暂时没有插槽 · 先按自由层画'
        : '自由层 · 浮在画面上';
  }
  // 融进版式之后：时间由歌词决定，前后 / 轨道 / 铺满都交给版式，面板上锁掉
  ['#miStart', '#miDur', '#miFront', '#miFit', '#miCenter', '#miUp', '#miDown'].forEach(sel => {
    const el = $(sel); if (el) el.disabled = inSlot;
  });
  const stip = $('#miSlotTip');
  if (stip) stip.textContent = inSlot
    ? '它现在是这一页纸的一部分：大小 = 在纸里放大 / 缩小，位置 / 旋转 = 在纸里微调（都可以打关键帧）。'
    : '点「放进这一句」把它融进这一句的版式（立绘印在信纸 / 拍立得上，跟着纸一起动）。';
  // 视频专属
  const vr = $('#miVideoRow');
  if (vr) vr.hidden = m.kind !== 'video';
  if (m.kind === 'video') {
    setVal('#miTrim', (+m.trim || 0).toFixed(2));
    const lp = $('#miLoop'); if (lp && lp.checked !== (m.loop !== false)) lp.checked = m.loop !== false;
  }
  // 关键帧
  const ak = $('#miAutoKey'); if (ak && ak.checked !== S.autoKey) ak.checked = S.autoKey;
  const info = $('#kfInfo');
  if (info) {
    const ts = kfTimes(m);
    const here = ts.some(x => Math.abs(x - (S.t - m.start)) < 0.04);
    info.textContent = ts.length
      ? ts.length + ' 个关键帧' + (here ? ' · 播放头正好在一个关键帧上' : '') + ' · 拖时间线上的 ◆ 改时间；在画面上拖 / 缩放就会写入关键帧'
      : '还没有关键帧。点「◆ 打关键帧」，把播放头挪到别处，再在画面上拖动 / 缩放，就做出动画了。也可以直接套下面的预设。';
  }
}

function syncMediaState() { syncMediaList(); }

function bindMediaCard() {
  const cur = () => S.media[S.mediaSel];
  const touch = () => { S.need = true; drawTimeline(); syncMediaInsp(); };
  const slide = (sel, fn) => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener('input', () => { const m = cur(); if (!m) return; fn(m, +el.value); touch(); });
    el.addEventListener('change', commit);
  };
  slide('#miScale', (m, v) => setProp(m, 'scale', J.clamp(v / 100, 0.02, 3)));
  slide('#miOpacity', (m, v) => setProp(m, 'opacity', J.clamp(v / 100, 0, 1)));
  slide('#miRot', (m, v) => setProp(m, 'rot', v));
  slide('#miBlend', (m, v) => { m.blend = J.clamp(v / 100, 0, 1); });
  slide('#miReact', (m, v) => { m.react = J.clamp(v / 100, 0, 1); });
  const lay = $('#miLayout');
  if (lay) lay.onchange = () => {
    const m = cur(); if (!m) return;
    if (lay.value === 'slot') {
      const line = slotTargetLine(m);
      if (line < 0) { toast('把播放头停在一句歌词上，才能把素材放进那一句的版式里'); syncMediaInsp(); return; }
      if (!bindSlot(m, line)) {
        const nl = nextLineAfter(line);
        if (nl < 0 || !bindSlot(m, nl)) { toast('这一句的版面已经放满了'); syncMediaInsp(); return; }
      }
      replan();
      S.need = true; drawTimeline(); syncMediaList(); syncMediaInsp(); commit();
      const info = slotInfoOf(m);
      toast('已融进「' + (info && info.tid ? info.tid : '这一句') + '」· 时长跟着这一句');
      return;
    }
    unbindSlot(m); autoFit(m, lay.value);
    touch(); syncMediaList(); commit();
    toast('版式：' + (LAYOUT_NAME[lay.value] || lay.value));
  };
  // ── 版面位：放进 / 换版式 / 退回自由层 ──
  const sb = $('#miSlotBind');
  if (sb) sb.onclick = () => {
    const m = cur(); if (!m) return;
    const line = slotTargetLine(m);
    if (line < 0) { toast('把播放头停在一句歌词上，才能放进那一句的版式里'); return; }
    if (!bindSlot(m, line)) {
      const nl = nextLineAfter(line);
      if (nl < 0 || !bindSlot(m, nl)) { toast('这一句的版面已经放满了'); return; }
    }
    replan();
    S.need = true; drawTimeline(); syncMediaList(); syncMediaInsp(); commit();
    const info = slotInfoOf(m);
    toast('已放进「' + (info && info.tid ? info.tid : '这一句') + '」· 时长跟着这一句');
  };
  const sr = $('#miSlotReroll');
  if (sr) sr.onclick = () => {
    const m = cur(); if (!m || !m.inLayout) return;
    const cur0 = (cutOfLine(m.line) || {}).layout;
    const pool = (J.slotLayouts ? J.slotLayouts() : []).filter(k => k !== cur0);
    if (!pool.length) { toast('没有别的版式可换了'); return; }
    const k = pool[Math.floor(Math.random() * pool.length)];
    setOverride(m.line, 'layout', k);
    S.need = true; drawTimeline(); syncMediaList(); syncMediaInsp(); commit();
    toast('这一句换成「' + LAYOUT_CN(k) + '」· 素材跟着新版式重新贴好');
  };
  const sf = $('#miSlotFree');
  if (sf) sf.onclick = () => {
    const m = cur(); if (!m) return;
    unbindSlot(m); autoFit(m, 'card');
    replan(); touch(); syncMediaList(); commit();
    toast('改回自由层：素材浮在画面上，可以随便摆位置和时长');
  };
  const inn = $('#miIn');
  if (inn) inn.onchange = () => { const m = cur(); if (!m) return; m.inM = inn.value; touch(); commit(); };
  const num = (sel, fn) => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener('change', () => { const m = cur(); if (!m) return; fn(m, +el.value); touch(); commit(); });
  };
  num('#miStart', (m, v) => { if (isFinite(v)) m.start = J.clamp(v, 0, Math.max(0, (S.plan ? S.plan.duration : 600) - 0.2)); });
  num('#miDur', (m, v) => { if (isFinite(v)) m.dur = J.clamp(v, 0.3, 600); });
  num('#miTrim', (m, v) => {
    const a = S.assets[m.assetId];
    if (isFinite(v) && a && a.dur) m.trim = J.clamp(v, 0, Math.max(0, a.dur - 0.1));
  });
  const act = (sel, fn) => { const el = $(sel); if (el) el.onclick = () => { const m = cur(); if (!m) return; fn(m); S.need = true; drawTimeline(); syncMediaList(); commit(); }; };
  act('#miFit', m => { autoFit(m, 'cover'); toast('铺满画面'); });
  act('#miCenter', m => { setProp(m, 'x', 0.5); setProp(m, 'y', 0.5); toast('回到画面中央'); });
  act('#miFront', m => { m.front = !m.front; toast(m.front ? '这个素材盖在歌词上面（贴纸）' : '这个素材压到歌词下面（背景）'); });
  act('#miUp', m => { m.lane = J.clamp((m.lane | 0) - 1, 0, TL.maxLane); toast('上移一层（更靠前）'); });
  act('#miDown', m => { m.lane = J.clamp((m.lane | 0) + 1, 0, TL.maxLane); toast('下移一层（更靠后）'); });

  // ── 关键帧 ──
  const kb = (id, fn) => { const el = $(id); if (el) el.onclick = () => { const m = cur(); if (!m) return; fn(m); }; };
  kb('#kfAdd', m => {
    if (S.t < m.start - 0.02 || S.t > m.start + m.dur + 0.02) { toast('播放头要停在这个素材的时间范围内才能打关键帧'); return; }
    addKeyAll(m); touch(); commit(); toast('已在 ' + fmt(S.t) + ' 打关键帧');
  });
  kb('#kfDel', m => {
    const n = delKeyHere(m); touch(); commit();
    toast(n ? '已删除这一处的关键帧' : '播放头这里没有关键帧');
  });
  kb('#kfPrev', m => { if (!jumpKey(m, -1)) toast('前面没有关键帧了'); });
  kb('#kfNext', m => { if (!jumpKey(m, 1)) toast('后面没有关键帧了'); });
  const ak = $('#miAutoKey');
  if (ak) ak.onchange = () => { S.autoKey = ak.checked; toast(S.autoKey ? '自动记录已开：改位置 / 大小 / 旋转 / 透明度都会写成关键帧' : '自动记录已关'); };
  const ez = $('#kfEase');
  if (ez) ez.onchange = () => {
    S.kfEase = ez.value;
    const m = cur();
    if (m) {
      const lt = S.t - m.start;
      for (const k of KPROPS) for (const q of m.kf[k]) if (Math.abs(q.t - lt) < 0.04) q.e = S.kfEase;
      touch(); commit();
    }
  };
  const ps = $('#kfPreset');
  if (ps) ps.onchange = () => { const id = ps.value; ps.value = ''; const m = cur(); if (m && id) applyPreset(m, id); };
  const lp = $('#miLoop');
  if (lp) lp.onchange = () => { const m = cur(); if (m) { m.loop = lp.checked; S.need = true; commit(); } };

  // ── 导入时自动卡拍的设置 ──
  const cl = $('#cfgLen'), ci = $('#cfgIn'), cp = $('#cfgPulse');
  if (cl) cl.onchange = () => { S.beatCfg.len = cl.value; };
  if (ci) ci.onchange = () => { S.beatCfg.inAnim = ci.value; };
  if (cp) cp.onchange = () => { S.beatCfg.pulse = cp.checked; };
  const cy = $('#cfgLayout');
  if (cy) cy.onchange = () => { S.beatCfg.layout = cy.value; };

  // 自定义配色：三个颜色 → 生成一套「自定义」风格
  const ca = $('#cApply');
  if (ca) ca.onclick = () => {
    const bg = ($('#cBg') || {}).value || '#FFD9EC';
    const fg = ($('#cFg') || {}).value || '#2A2350';
    const acc = ($('#cAcc') || {}).value || '#FF4D8D';
    const base = J.STYLES.tcg || J.STYLES[J.STYLE_ORDER[0]];
    const acc2 = J.mix(acc, bg, 0.3);
    const light = { bg, fg, sub: J.mix(fg, bg, 0.42), accent: acc, accent2: acc2, ink: fg, dim: J.mix(bg, fg, 0.07), ghostA: acc, ghostB: acc2, bgGrad: [bg, J.mix(bg, acc, 0.22)] };
    const darkBg = J.mix(bg, '#0B0B12', 0.84);
    const dark = { bg: darkBg, fg: '#FFFFFF', sub: J.mix('#FFFFFF', bg, 0.45), accent: acc, accent2: acc2, ink: '#FFFFFF', dim: J.mix(darkBg, '#FFFFFF', 0.06), ghostA: acc, ghostB: acc2, bgGrad: [J.mix(bg, '#0B0B12', 0.9), J.mix(acc, '#0B0B12', 0.55)] };
    J.STYLES.custom = Object.assign({}, base, { name: '自定义', desc: '你自己调的三个颜色', schemes: [light, light, dark] });
    if (J.STYLE_ORDER.indexOf('custom') < 0) J.STYLE_ORDER.unshift('custom');
    S.project.style = 'custom';
    buildStyleGrid();
    replan();
    toast('已套用自定义配色 ' + bg + ' / ' + fg + ' / ' + acc);
  };
}


/* ───────────────────────── 素材：字幕 ───────────────────────── */

const lrcStamp = t => {
  t = Math.max(0, t);
  const m = Math.floor(t / 60), s = t - m * 60;
  return String(m).padStart(2, '0') + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
};

function toSec(s) {
  const m = String(s == null ? '' : s).trim().match(/(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/);
  if (!m) return null;
  return (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3] + +('0.' + m[4]);
}

function detectKind(txt, name) {
  if (/-->/.test(txt)) return /^\s*WEBVTT/i.test(txt) ? 'vtt' : 'srt';
  if (/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(txt)) return 'lrc';
  const n = String(name || '').toLowerCase();
  if (n.endsWith('.srt') || n.endsWith('.vtt')) return 'srt';
  if (n.endsWith('.lrc')) return 'lrc';
  return 'plain';
}

/* SRT / VTT → [{t, e, text}] */
function parseCues(txt) {
  const out = [];
  const src = String(txt).replace(/\r/g, '').replace(/^\uFEFF/, '');
  for (let block of src.split(/\n{2,}/)) {
    if (/^\s*WEBVTT/i.test(block)) block = block.replace(/^\s*WEBVTT[^\n]*\n?/i, '');
    const lines = block.split('\n').map(x => x.trim()).filter(Boolean);
    if (!lines.length) continue;
    const ti = lines.findIndex(x => x.includes('-->'));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split('-->');
    const t = toSec(a), e = toSec(b);
    if (t == null) continue;
    let text = lines.slice(ti + 1).join(' ')
      .replace(/<[^>]*>/g, '')
      .replace(/\{[^}]*\}/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text || /^\[(音效|音乐|掌声|笑声|applause|music|sound)\]/i.test(text)) continue;
    out.push({ t, e, text });
  }
  out.sort((x, y) => x.t - y.t);
  // 同样的字连续重复（很多播放器会一行行刷）只留第一条
  return out.filter((c, i) => !i || c.text !== out[i - 1].text || c.t - out[i - 1].t > 0.4);
}

function cuesToLrc(cues, withInst) {
  const rows = [];
  let prevEnd = null;
  for (const c of cues) {
    if (withInst && prevEnd != null && c.t - prevEnd >= 2.6) {
      const gap = Math.min(12, Math.max(1.5, c.t - prevEnd - 0.25));
      rows.push(`[${lrcStamp(prevEnd + 0.08)}][间奏 ${gap.toFixed(1)}]`);
    }
    rows.push(`[${lrcStamp(c.t)}]${c.text}`);
    prevEnd = c.e != null ? c.e : c.t + Math.max(1.2, c.text.length * 0.18);
  }
  return rows.join('\n');
}

/* LRC 的 [offset:±ms] 折进每个时间标签里 */
function applyLrcOffset(txt) {
  const m = txt.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]\s*$/im);
  let out = txt.replace(/^\s*\[offset:[^\]]*\]\s*$/gim, '');
  if (!m || !+m[1]) return out;
  const ms = +m[1];
  out = out.replace(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g, (all, mm, ss) => {
    const t = +mm * 60 + parseFloat(ss.replace(':', '.')) + ms / 1000;
    return '[' + lrcStamp(Math.max(0, t)) + ']';
  });
  return out;
}

async function importSubFile(file) {
  let txt = '';
  try { txt = await file.text(); } catch (e) { toast('读不了这个文件'); return; }
  applySubText(txt, file.name);
}

function applySubText(txt, name) {
  const kind = detectKind(txt, name);
  if (kind === 'srt' || kind === 'vtt') {
    const cues = parseCues(txt);
    if (!cues.length) { toast('没读出字幕条，确认是 srt / vtt 文件'); return; }
    S.lastCues = cues; S.lastCuesName = name || '';
    const lrc = cuesToLrc(cues, $('#autoInst').checked);
    setLyrics(lrc, '已导入 ' + cues.length + ' 条字幕，按字幕时间卡点');
    return;
  }
  if (kind === 'lrc') {
    S.lastCues = null;
    const lrc = applyLrcOffset(txt).trim();
    const n = (lrc.match(/^\s*\[\d+:\d+(?:[.:]\d+)?\]/gm) || []).length;
    setLyrics(lrc, '已导入 LRC：' + n + ' 行带时间');
    return;
  }
  S.lastCues = null;
  setLyrics(String(txt).trim(), '已导入纯文本歌词（按 BPM 估算节奏）');
}

function setLyrics(text, msg) {
  S.project.lyrics = text;
  S.project.overrides = {};
  S.project.timing.lineTimes = {};
  S.project.timing.lineDurs = {};
  S.project.timing.lineEnds = {};
  S.openLine = -1;
  $('#lyrics').value = text;
  replan();
  syncSubState();
  if (msg) toast(msg);
}

function stripTimeTags() {
  const raw = S.project.lyrics.replace(/^[ \t]*\[\d+:\d+(?:[.:]\d+)?\]/gm, '');
  if (raw === S.project.lyrics) { toast('现在没有时间标签'); return; }
  S.lastCues = null;
  setLyrics(raw.trim(), '已去掉时间标签，改回按 BPM 估算');
  $('#autoInst').checked = false;
}

const countTags = () => (String(S.project.lyrics).match(/^[ \t]*\[\d+:\d+(?:[.:]\d+)?\]/gm) || []).length;

function syncSubState() {
  const n = countTags();
  const box = $('#subState'), pill = $('#subPill');
  if (!box) return;
  box.hidden = !n;
  if (n) {
    const mode = S.lastCues ? '字幕时间' : 'LRC 时间';
    pill.textContent = mode + ' · ' + n + ' 行有准点';
  }
  const strip = $('#btnStripTime');
  if (strip) strip.disabled = !n;
  $('#sumLyrics').textContent = (S.plan ? S.plan.lines.filter(l => !l.interlude).length : '—') + ' 句' + (n ? ' · 卡点' : '');
}

/* ───────────────────────── 折叠分区 ───────────────────────── */

const FOLD_KEY = 'studio.folds.v1';

function initFolds() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(FOLD_KEY) || '{}') || {}; } catch (e) {}
  $$('details.card[data-fold]').forEach(d => {
    const k = d.dataset.fold;
    if (saved[k] != null) d.open = !!saved[k];
    d.addEventListener('toggle', () => {
      const o = {};
      $$('details.card[data-fold]').forEach(x => { o[x.dataset.fold] = x.open; });
      try { localStorage.setItem(FOLD_KEY, JSON.stringify(o)); } catch (e) {}
      requestAnimationFrame(() => { sizeCanvas(); drawTimeline(); });
      if (d.dataset.fold === 'media' && d.open) setTimeout(drawWave, 30);
    });
  });
}

function updateSums() {
  const p = S.project;
  const st = J.STYLES[p.style];
  $('#sumStyle').textContent = (st && st.name) || p.style;
  const ov = Object.keys(p.overrides || {}).filter(k => p.overrides[k] && Object.keys(p.overrides[k]).length).length;
  $('#sumLines').textContent = ov ? ov + ' 行已指定' : '全部自动';
  $('#sumFeel').textContent = (TASTE[S.taste] && TASTE[S.taste].short) || '平衡';
  const sws = $$('.togs input');
  $('#sumSwitch').textContent = sws.filter(x => x.checked).length + ' / ' + sws.length;
  const fn = ['#fDisplay', '#fSerif', '#fBody'].map(id => { const s = $(id); return s.selectedIndex > 0 ? s.options[s.selectedIndex].text.split('　')[0] : ''; }).filter(Boolean);
  $('#sumFonts').textContent = fn.length ? fn.join(' / ') : '跟随风格';
  $('#sumLyrics').textContent = (S.plan ? S.plan.lines.filter(l => !l.interlude).length : '—') + ' 句' + (countTags() ? ' · 卡点' : '');
}

/* ───────────────────────── 版面：拖动改宽高 ───────────────────────── */

const LAYOUT_KEY = 'studio.layout.v1';

function readLayout() { try { return JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') || {}; } catch (e) { return {}; } }
function saveLayout(obj) { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(obj || currentLayout())); } catch (e) {} }
function currentLayout() {
  const sh = $('#shell');
  return {
    left: parseInt(sh.style.getPropertyValue('--w-left')) || null,
    right: parseInt(sh.style.getPropertyValue('--w-right')) || null,
    tl: parseInt(sh.style.getPropertyValue('--h-tl')) || null,
    noLeft: document.body.classList.contains('no-left'),
    noRight: document.body.classList.contains('no-right'),
  };
}
function applyLayout(o) {
  const sh = $('#shell');
  if (o.left) sh.style.setProperty('--w-left', o.left + 'px');
  if (o.right) sh.style.setProperty('--w-right', o.right + 'px');
  if (o.tl) sh.style.setProperty('--h-tl', o.tl + 'px');
  document.body.classList.toggle('no-left', !!o.noLeft);
  document.body.classList.toggle('no-right', !!o.noRight);
  $('#btnLeft').setAttribute('aria-pressed', String(!o.noLeft));
  $('#btnRight').setAttribute('aria-pressed', String(!o.noRight));
}

function initResizers() {
  applyLayout(readLayout());
  const sh = $('#shell');

  $$('.rz').forEach(rz => {
    const side = rz.dataset.rz;
    rz.addEventListener('pointerdown', e => {
      e.preventDefault();
      const startX = e.clientX;
      const panel = side === 'left' ? $('#panelLeft') : $('#panelRight');
      const startW = panel.getBoundingClientRect().width;
      rz.classList.add('on');
      try { rz.setPointerCapture(e.pointerId); } catch (err) {}
      const move = ev => {
        const dx = side === 'left' ? ev.clientX - startX : startX - ev.clientX;
        const min = side === 'left' ? 250 : 268;
        const max = Math.min(side === 'left' ? 560 : 620, window.innerWidth * 0.5);
        const w = J.clamp(startW + dx, min, Math.max(min, max));
        sh.style.setProperty(side === 'left' ? '--w-left' : '--w-right', Math.round(w) + 'px');
        if (side === 'left') drawWave();
      };
      const up = () => {
        rz.classList.remove('on');
        rz.removeEventListener('pointermove', move);
        rz.removeEventListener('pointerup', up);
        rz.removeEventListener('pointercancel', up);
        saveLayout(); sizeCanvas(); drawTimeline();
        if (side === 'left') drawWave();
      };
      rz.addEventListener('pointermove', move);
      rz.addEventListener('pointerup', up);
      rz.addEventListener('pointercancel', up);
    });
    rz.addEventListener('dblclick', () => {
      sh.style.removeProperty(side === 'left' ? '--w-left' : '--w-right');
      saveLayout(); sizeCanvas(); drawTimeline();
    });
  });

  const grip = $('#rzTl'), wrap = $('#tlWrap');
  grip.addEventListener('pointerdown', e => {
    e.preventDefault();
    const startY = e.clientY, startH = wrap.getBoundingClientRect().height;
    grip.classList.add('on');
    try { grip.setPointerCapture(e.pointerId); } catch (err) {}
    const move = ev => {
      const maxH = Math.max(120, Math.min(460, window.innerHeight * 0.55));
      const h = J.clamp(startH - (ev.clientY - startY), 64, maxH);
      sh.style.setProperty('--h-tl', Math.round(h) + 'px');
      $('#tlHint').textContent = Math.round(h) + ' px';
      drawTimeline();
    };
    const up = () => {
      grip.classList.remove('on');
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      saveLayout(); drawTimeline();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('dblclick', () => {
    sh.style.removeProperty('--h-tl');
    $('#tlHint').textContent = '拖动这一条可以调高 / 调矮';
    saveLayout(); drawTimeline();
  });
}

function togglePanel(side) {
  const cls = 'no-' + side;
  document.body.classList.toggle(cls);
  const on = !document.body.classList.contains(cls);
  $('#btn' + (side === 'left' ? 'Left' : 'Right')).setAttribute('aria-pressed', String(on));
  saveLayout();
  requestAnimationFrame(() => { sizeCanvas(); drawTimeline(); });
}

/* ───────────────────────── 导出 ───────────────────────── */

async function doExport() {
  if (S.exporting) return;
  pause();
  const p = S.project;
  if (!window.VideoEncoder) {
    toast(!window.isSecureContext
      ? '现在是用 http:// 打开的，浏览器不给导出视频。请用 https 网址访问，或把 dist/字面工房.html 下到本地双击打开'
      : '这个浏览器不支持视频编码，请用 Chrome 或 Edge 打开');
    return;
  }
  const size = J.outputSize(p);

  const ac = new AbortController();
  S.exporting = { ac };
  $('#exportBar').hidden = false;
  $('#btnExport').disabled = true;
  const setBar = (k, msg) => {
    $('#ebFill').style.width = (J.clamp(k) * 100).toFixed(1) + '%';
    $('#ebLabel').textContent = msg || (Math.round(J.clamp(k) * 100) + '%');
  };
  setBar(0, '准备中…');

  try {
    const r = await J.exportMP4({
      plan: S.plan, project: p,
      audio: p.includeAudio !== false ? S.audio : null,
      quality: 'high',
      beforeFrame: prepareFrame,          // 视频素材：每一帧先精确跳到对应画面
      overlay: S.media.length ? drawMediaOverlay : null,
      underlay: S.media.length ? drawMediaUnder : null,
      slot: S.media.length ? paintSlot : null,
      onProgress: (k, msg) => setBar(k, msg || null),
      signal: ac.signal,
    });
    setBar(1, '写入文件…');
    const name = 'TCG-PV_' + p.aspect.replace(':', 'x') + '_' + size[0] + 'p_' + String(p.seed).slice(-4) + '.mp4';
    await J.saveFile(name, r.blob);
    setBar(1, '完成 · ' + Math.round((r.size || 0) / 1048576) + ' MB');
    toast('已导出 ' + name + (S.audio ? '（带音轨）' : ''));
    setTimeout(() => { $('#exportBar').hidden = true; }, 1800);
  } catch (e) {
    console.error(e);
    $('#ebLabel').textContent = '导出失败：' + (e && e.message || e);
    toast('导出失败：' + (e && e.message || e));
    setTimeout(() => { $('#exportBar').hidden = true; }, 4000);
  } finally {
    S.exporting = null;
    $('#btnExport').disabled = false;
  }
}

/* 透明背景导出：带 alpha 通道的 PNG 序列（zip），剪映 / AE / Premiere 可直接当透明素材导入 */
async function exportPNG() {
  if (S.exporting) return;
  pause();
  const p = S.project;
  const ac = new AbortController();
  S.exporting = { ac };
  $('#exportBar').hidden = false;
  $('#btnExport').disabled = true;
  const setBar = (k, msg) => {
    $('#ebFill').style.width = (J.clamp(k) * 100).toFixed(1) + '%';
    $('#ebLabel').textContent = msg || (Math.round(J.clamp(k) * 100) + '%');
  };
  setBar(0, '准备透明导出…');
  try {
    // 透明 PNG 序列分两层：back（背景图形+装饰）/ front（歌词+前景），叠起来还原画面
    const zip = await J.exportPNGZip({
      plan: S.plan, project: p,
      transparent: true, layers: true,
      beforeFrame: prepareFrame,
      overlay: S.media.length ? drawMediaOverlay : null,   // 盖在文字上面的图 → front 层
      underlay: S.media.length ? drawMediaUnder : null,    // 压在文字下面的图 → back 层
      slot: S.media.length ? paintSlot : null,             // 融在版式里的图 → 跟着那一页纸画
      onProgress: (k, msg) => setBar(k, msg || null),
      signal: ac.signal,
    });
    setBar(1, '写入文件…');
    const name = 'TCG-PV_透明_' + p.aspect.replace(':', 'x') + '_' + size0(p) + 'p_' + String(p.seed).slice(-4) + '.zip';
    await J.saveFile(name, zip);
    setBar(1, '完成');
    toast('已导出透明 PNG 序列：' + name + '（含 back / front 两层，剪映可导入）');
    setTimeout(() => { $('#exportBar').hidden = true; }, 2400);
  } catch (e) {
    console.error(e);
    $('#ebLabel').textContent = '透明导出失败：' + (e && e.message || e);
    toast('透明导出失败：' + (e && e.message || e));
    setTimeout(() => { $('#exportBar').hidden = true; }, 4000);
  } finally {
    S.exporting = null;
    $('#btnExport').disabled = false;
  }
}
const size0 = p => J.outputSize(p)[0];

/* ───────────────────────── 透明视频（MOV / QuickTime + PNG 编码 + Alpha） ─────────────────────────
   · 真正的透明视频文件（.mov），不是图片序列；剪映 / AE / Premiere 直接当透明素材叠在视频上
   · 浏览器里没有 ProRes / HEVC-Alpha 编码器，所以用 QuickTime 的 'png ' 编码：逐帧无损、保留 alpha
   · 画面分两层渲染（back = 背景图形 + 压字的图 / front = 歌词前景），再合成成一帧，等价于原来 zip 的两层叠起来
   · 文件会比较大（1080p 约 3~8 MB/秒），这是无损 + 透明的代价 */
async function exportMOV() {
  if (S.exporting) return;
  if (!J.movFromPNG) { toast('缺少 MOV 封装模块（app/mov_muxer.js 没加载）'); return; }
  pause();
  const p = S.project;
  const ac = new AbortController();
  S.exporting = { ac };
  $('#exportBar').hidden = false;
  $('#btnExport').disabled = true;
  const setBar = (k, msg) => {
    $('#ebFill').style.width = (J.clamp(k) * 100).toFixed(1) + '%';
    $('#ebLabel').textContent = msg || (Math.round(J.clamp(k) * 100) + '%');
  };
  setBar(0, '准备透明视频…');
  const t0 = performance.now();
  try {
    const [w, h] = J.outputSize(p);
    const fps = Math.max(1, p.fps || 24);
    const total = Math.max(1, Math.round(S.plan.duration * fps));
    const estMB = Math.round(total * w * h * 0.12 / 1048576);
    if (estMB > 2000) throw new Error('这段太长（' + total + ' 帧，预估 ' + estMB + 'MB），把分辨率降到 720p 或缩短歌词再导');

    const out = document.createElement('canvas'); out.width = w; out.height = h;
    const octx = out.getContext('2d');
    const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
    const tctx = tmp.getContext('2d');
    const R = new J.Renderer();
    const scale = w / S.plan.W;
    const ov = S.media.length ? drawMediaOverlay : null;
    const un = S.media.length ? drawMediaUnder : null;
    const frames = [];
    let bytes = 0;
    for (let i = 0; i < total; i++) {
      if (ac.signal.aborted) throw new Error('已取消');
      await prepareFrame(i / fps);
      // back 层：压在歌词下面的图 + 歌词后面的装饰（跳过整幅背景图形，避免给素材带一层暗角）
      R.frame(octx, S.plan, i / fps, { scale, transparent: true, layer: 'back', underlay: un, noBgGfx: true, slot: paintSlot });
      // front 层：歌词与前景（融在版式里的素材也在这一层，跟着那一页纸）
      R.frame(tctx, S.plan, i / fps, { scale, transparent: true, layer: 'front', overlay: ov, slot: paintSlot });
      octx.save(); octx.setTransform(1, 0, 0, 1, 0, 0); octx.globalAlpha = 1; octx.globalCompositeOperation = 'source-over';
      octx.drawImage(tmp, 0, 0); octx.restore();
      const blob = await new Promise(res => out.toBlob(res, 'image/png'));
      frames.push(blob);                       // Blob 会由浏览器管（大文件落磁盘），不占 JS 堆
      bytes += blob.size;
      if (i % 2 === 0) {
        setBar(i / total * 0.96, '渲染帧 ' + (i + 1) + '/' + total + ' · ' + Math.round(bytes / 1048576) + 'MB · ' + Math.round((performance.now() - t0) / 1000) + 's');
        await new Promise(res => setTimeout(res, 0));
      }
    }
    setBar(0.97, '封装 MOV…');
    const mov = J.movFromPNG({ width: w, height: h, fps, frames });
    const name = 'TCG-PV_透明_' + p.aspect.replace(':', 'x') + '_' + w + 'p_' + String(p.seed).slice(-4) + '.mov';
    await J.saveFile(name, mov);
    setBar(1, '完成 · ' + Math.round(mov.size / 1048576) + ' MB');
    toast('已导出透明视频 ' + name + '（带 Alpha，剪映直接导入）');
    setTimeout(() => { $('#exportBar').hidden = true; }, 2600);
  } catch (e) {
    console.error(e);
    $('#ebLabel').textContent = '透明导出失败：' + (e && e.message || e);
    toast('透明导出失败：' + (e && e.message || e));
    setTimeout(() => { $('#exportBar').hidden = true; }, 4200);
  } finally {
    S.exporting = null;
    $('#btnExport').disabled = false;
  }
}

/* ───────────────────────── 强度预设 ───────────────────────── */

const TASTE = {
  calm: { motion: 0.40, density: 0.40, decor: 0.24, glitch: 0.18, texture: 0.50, chroma: 0.12, variety: 0.22, extra: false, short: '克制', label: '克制：干净排版为主，全片同一套手法' },
  mid:  { motion: 0.65, density: 0.50, decor: 0.45, glitch: 0.45, texture: 0.55, chroma: 0.34, variety: 0.45, extra: false, short: '平衡', label: '平衡：有动势，但不抢字' },
  wild: { motion: 0.92, density: 0.70, decor: 0.78, glitch: 0.78, texture: 0.70, chroma: 0.62, variety: 0.85, extra: true, short: '奔放', label: '奔放：全部特效开放，每句都换花样' },
};

function applyTaste(k) {
  const T = TASTE[k]; if (!T) return;
  S.taste = k;
  for (const key of ['motion', 'density', 'decor', 'glitch', 'texture', 'chroma']) {
    S.project.fx[key] = T[key];
    const el = $('#' + key);
    if (el) { el.value = Math.round(T[key] * 100); const o = $('#o' + key[0].toUpperCase() + key.slice(1)); if (o) o.textContent = T[key].toFixed(2); }
  }
  S.project.variety = T.variety;
  const vEl = $('#variety');
  if (vEl) { vEl.value = Math.round(T.variety * 100); $('#oVariety').textContent = T.variety.toFixed(2); }
  S.project.extra = T.extra;
  const sw = $('#swExtra'); if (sw) sw.checked = T.extra;
  RAND_POOL.layout = RAND_POOL.enter = RAND_POOL.exit = RAND_POOL.hold = RAND_POOL.decor = RAND_POOL.treat = null;
  replan();
  toast(T.label);
}

/* ───────────────────────── 绑定 ───────────────────────── */

function bind() {
  let timer = 0;

  // 撤销历史：每次操作结束（松开鼠标 / 改完数值）自动存一步；相同的状态不会重复存
  document.addEventListener('pointerup', () => setTimeout(commit, 40), true);
  document.addEventListener('change', () => setTimeout(commit, 0), true);
  const bu = $('#btnUndo'), br = $('#btnRedo');
  if (bu) bu.onclick = undo;
  if (br) br.onclick = redo;

  // 文案
  $('#lyrics').addEventListener('input', e => {
    S.project.lyrics = e.target.value;
    clearTimeout(timer);
    timer = setTimeout(() => { S.project.overrides = {}; S.openLine = -1; replan(); syncSubState(); $('#autoInst').checked = countTags() ? $('#autoInst').checked : false; }, 420);
  });
  $('#btnSample').onclick = () => { S.lastCues = null; setLyrics(SAMPLE, '已载入示例'); };
  $('#btnStripTime').onclick = stripTimeTags;
  $('#btnSubClear').onclick = stripTimeTags;

  // 素材：音频 / 字幕
  const pick = (inputId) => { const i = $(inputId); if (i) i.click(); };
  $('#dropAudio').addEventListener('click', e => { if (e.target.closest('.btn')) return; pick('#fileAudio'); });
  $('#dropSub').addEventListener('click', e => { if (e.target.closest('.btn')) return; pick('#fileSub'); });
  $('#btnPickAudio').onclick = e => { e.stopPropagation(); pick('#fileAudio'); };
  $('#btnPickSub').onclick = e => { e.stopPropagation(); pick('#fileSub'); };
  $('#fileAudio').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) loadAudioFile(f); });
  $('#fileSub').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) importSubFile(f); });

  // 图片素材
  $('#dropMedia').addEventListener('click', e => { if (e.target.closest('.btn')) return; pick('#fileMedia'); });
  $('#btnPickMedia').onclick = e => { e.stopPropagation(); pick('#fileMedia'); };
  const addBtn = $('#btnAddMedia');
  if (addBtn) addBtn.onclick = () => pick('#fileMedia');
  $('#fileMedia').addEventListener('change', async e => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (files.length) await addImageFiles(files, { start: S.t });
  });
  $('#dropMedia').addEventListener('dragenter', () => $('#dropMedia').classList.add('over'));
  $('#dropMedia').addEventListener('dragleave', () => $('#dropMedia').classList.remove('over'));
  $('#dropMedia').addEventListener('drop', () => $('#dropMedia').classList.remove('over'));
  $('#btnAudioDel').onclick = e => {
    e.stopPropagation();
    S.audio = null; AP.stop();
    S.project.audioName = ''; S.project.includeAudio = true;
    syncMediaUI();
    replan();
    toast('已移除音频（导出的视频不再带音轨）');
  };
  $('#vol').addEventListener('input', e => AP.setVol(+e.target.value / 100));
  $('#autoInst').addEventListener('change', () => {
    if (!S.lastCues) return;
    setLyrics(cuesToLrc(S.lastCues, $('#autoInst').checked), $('#autoInst').checked ? '已按字幕空档插入间奏' : '已去掉自动间奏');
  });

  // 拖进来（整页都能接：图片 / 音频 / srt / lrc）
  window.addEventListener('dragover', e => { if (isFileDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  window.addEventListener('drop', async e => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    await dropFiles([...(e.dataTransfer.files || [])], { start: S.t });
  });
  for (const id of ['#dropAudio', '#dropSub', '#dropMedia']) {
    const el = $(id);
    el.addEventListener('dragenter', () => el.classList.add('over'));
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', () => el.classList.remove('over'));
  }

  // 节奏
  $('#bpm').addEventListener('change', e => {
    S.project.timing.bpm = Math.max(0, +e.target.value || 0);
    $('#bpmAuto').hidden = true;
    replan();
  });
  $('#lineScale').addEventListener('input', e => {
    const v = +e.target.value / 100;
    $('#oLineLen').textContent = v.toFixed(2) + '×';
    S.project.timing.lineScale = v;
    clearTimeout(timer); timer = setTimeout(replan, 200);
  });
  $('#offset').addEventListener('input', e => {
    const v = +e.target.value / 100;
    $('#oOffset').textContent = v.toFixed(2) + 's';
    S.project.timing.offset = v;
    clearTimeout(timer); timer = setTimeout(replan, 200);
  });
  $('#snap').addEventListener('change', e => { S.project.timing.snap = e.target.checked; replan(); });

  // 画幅 / 分辨率 / 帧率
  $('#segAspect').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#segAspect button').forEach(x => x.classList.toggle('on', x === b));
    S.project.aspect = b.dataset.v;
    replan();
  });
  $('#selRes').addEventListener('change', e => { S.project.res = +e.target.value; replan(); });
  $('#selFps').addEventListener('change', e => { S.project.fps = +e.target.value; replan(); });

  // 手感滑杆
  const sl = (id, key, out) => {
    const el = $(id);
    el.addEventListener('input', () => {
      const v = +el.value / 100;
      S.project.fx[key] = v;
      if (out) $(out).textContent = v.toFixed(2);
      S.need = true;
      clearTimeout(timer); timer = setTimeout(replan, 220);
    });
  };
  sl('#motion', 'motion', '#oMotion');
  sl('#density', 'density', '#oDensity');
  sl('#decor', 'decor', '#oDecor');
  sl('#glitch', 'glitch', '#oGlitch');
  sl('#texture', 'texture', '#oTexture');
  sl('#chroma', 'chroma', '#oChroma');

  const vEl = $('#variety');
  if (vEl) vEl.addEventListener('input', () => {
    const v = +vEl.value / 100;
    S.project.variety = v;
    $('#oVariety').textContent = v.toFixed(2);
    clearTimeout(timer); timer = setTimeout(replan, 200);
  });

  // 强度预设
  $('#segTaste').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#segTaste button').forEach(x => x.classList.toggle('on', x === b));
    applyTaste(b.dataset.v);
  });

  // 编排开关
  const sw = (id, key) => $(id).addEventListener('change', e => {
    S.project[key] = e.target.checked;
    RAND_POOL.layout = RAND_POOL.enter = RAND_POOL.exit = RAND_POOL.hold = RAND_POOL.decor = RAND_POOL.treat = null;
    replan();
  });
  sw('#swExtra', 'extra');
  sw('#swNew', 'more');
  sw('#swTypo', 'typo');
  sw('#swKinetic', 'kinetic');
  sw('#swUnify', 'unify');
  sw('#swTypeset', 'typeset');

  // 字体
  const fs = (id, role) => $(id).addEventListener('change', e => {
    const v = e.target.value;
    S.project.fonts = S.project.fonts || {};
    if (v) S.project.fonts[role] = v; else delete S.project.fonts[role];
    S.fontsKey = '';
    replan();
  });
  fs('#fDisplay', 'display'); fs('#fSerif', 'serif'); fs('#fBody', 'body');

  // 播放
  $('#btnPlay').onclick = () => (S.playing ? pause() : play());

  $('#btnLeft').onclick = () => togglePanel('left');
  $('#btnRight').onclick = () => togglePanel('right');

  $('#btnShuffleAll').onclick = () => {
    S.project.seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
    S.project.overrides = {};
    S.openLine = -1;
    replan();
    toast('整片重新编排');
  };
  $('#btnExport').onclick = doExport;
  // 透明导出默认出 MOV；Alt+点击 = 老办法（PNG 序列 zip）
  $('#btnExportPNG').onclick = e => (e.altKey ? exportPNG() : exportMOV());
  $('#btnCancelExport').onclick = () => { if (S.exporting) S.exporting.ac.abort(); };

  bindTimeline();
  bindViewportDrag();
  bindShortcuts();
  warnIfNoExport();
}

/* 用 http:// 打开（比如局域网预览）时，浏览器不给 WebCodecs，导不出视频 —— 先说清楚，别等做完才发现 */
function warnIfNoExport() {
  if (window.VideoEncoder) return;
  const insecure = !window.isSecureContext;
  const el = document.createElement('div');
  el.className = 'insecure-bar';
  el.innerHTML = '<span>' + (insecure
    ? '<b>预览模式</b>：现在是用 <code>http://</code> 打开的，浏览器不允许导出视频。要出片请用 https 网址，或把 <b>dist/字面工房.html</b> 下到本地双击打开。'
    : '<b>这个浏览器不能导出视频</b>：请用 Chrome / Edge 最新版打开。') + '</span><button title="知道了">×</button>';
  el.querySelector('button').onclick = () => el.remove();
  document.body.appendChild(el);
}

/* 在预览画布上直接拖动选中的素材摆位
   · 拖到画面外面也可以（x/y 允许 -0.6 ~ 1.6）
   · 有关键帧（或开了「自动记录」）时：拖动 / 缩放会在播放头处写关键帧，做出动画
   · Shift + 拖动 = 只走横 / 竖一个方向；滚轮 = 缩放选中的素材（不要按 Ctrl）
   · 双击画面 = 选中素材回到正中 */
function bindViewportDrag() {
  const c = $('#view');
  let drag = null, wheelT = 0;
  const inRange = m => S.t >= m.start - 0.02 && S.t <= m.start + m.dur + 0.02;
  const stateOf = m => {
    const img = m.img; if (!img) return null;
    const iw = m.iw || img.width, ih = m.ih || img.height;
    if (!iw || !ih) return null;
    const lt = J.clamp(S.t - m.start, 0, m.dur);
    const sc = evalProp(m, 'scale', lt);
    return { w: sc, h: sc * ih / iw * (S.plan.W / S.plan.H), x: evalProp(m, 'x', lt), y: evalProp(m, 'y', lt) };
  };
  const rel = e => { const r = c.getBoundingClientRect(); return { px: (e.clientX - r.left) / r.width, py: (e.clientY - r.top) / r.height }; };

  c.addEventListener('pointerdown', e => {
    if (S.mediaSel < 0 || !S.media[S.mediaSel]) return;
    if (e.button != null && e.button !== 0) return;
    const m = S.media[S.mediaSel];
    if (!inRange(m)) return;
    const { px, py } = rel(e);
    const st = stateOf(m); if (!st) return;
    // 命中：素材矩形内（放宽 5%）；已经铺满整幅画面的图，画面任意处都能抓
    const coverX = st.w >= 0.95, coverY = st.h >= 0.95;
    const hitX = coverX || Math.abs(px - st.x) <= st.w / 2 + 0.05;
    const hitY = coverY || Math.abs(py - st.y) <= st.h / 2 + 0.05;
    if (!hitX || !hitY) return;
    if (S.playing) pause();
    drag = { m, startPx: px, startPy: py, startX: st.x, startY: st.y, lock: e.shiftKey };
    try { c.setPointerCapture(e.pointerId); } catch (err) {}
    c.style.cursor = 'grabbing';
    e.preventDefault();
  });
  c.addEventListener('pointermove', e => {
    if (!drag) {
      // 鼠标移到素材上时给个可以抓的手型
      const m = S.media[S.mediaSel];
      if (m && inRange(m)) {
        const st = stateOf(m);
        if (st) {
          const { px, py } = rel(e);
          c.style.cursor = Math.abs(px - st.x) <= st.w / 2 && Math.abs(py - st.y) <= st.h / 2 ? 'grab' : '';
        }
      }
      return;
    }
    const { px, py } = rel(e);
    let dx = px - drag.startPx, dy = py - drag.startPy;
    if (drag.lock) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    setProp(drag.m, 'x', J.clamp(drag.startX + dx, -0.6, 1.6));
    setProp(drag.m, 'y', J.clamp(drag.startY + dy, -0.6, 1.6));
    S.need = true;
    syncMediaInsp();
  });
  const end = e => {
    if (drag) { drag = null; commit(); }
    c.style.cursor = '';
    try { c.releasePointerCapture(e.pointerId); } catch (err) {}
  };
  c.addEventListener('pointerup', end);
  c.addEventListener('pointercancel', end);
  // 滚轮缩放选中素材
  c.addEventListener('wheel', e => {
    const m = S.media[S.mediaSel];
    if (!m || !inRange(m)) return;
    e.preventDefault();
    const lt = J.clamp(S.t - m.start, 0, m.dur);
    const k = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    setProp(m, 'scale', J.clamp(evalProp(m, 'scale', lt) * k, 0.02, 3));
    S.need = true;
    syncMediaInsp();
    drawTimeline();
    clearTimeout(wheelT); wheelT = setTimeout(commit, 400);
  }, { passive: false });
  // 双击 = 回正中
  c.addEventListener('dblclick', () => {
    const m = S.media[S.mediaSel];
    if (!m || !inRange(m)) return;
    setProp(m, 'x', 0.5); setProp(m, 'y', 0.5);
    S.need = true; syncMediaInsp(); drawTimeline(); commit();
    toast('素材回到画面中央');
  });
}

/* 剪映式快捷键（参照剪映快捷键面板：时间线 / 播放器 / 基础） */
function bindShortcuts() {
  document.addEventListener('keydown', e => {
    // 只有真正在输入文字的控件才算「正在打字」；滑块 / 复选框 / 按钮聚焦时，快捷键（撤销、删除…）照常生效
    const typing = e.target.matches('input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=button]),textarea,select,[contenteditable]');
    const mod = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const alt = e.altKey;
    const key = e.key.toLowerCase();

    // 退出全屏（Esc）—— 不拦截其他 Esc
    if (e.key === 'Escape') return;

    // ── 播放器 ──
    if (!mod && !alt && e.code === 'Space') {
      if (e.target.matches('input[type=checkbox],input[type=radio],button')) return;   // 空格留给按钮 / 复选框自己用
      if (!typing) { e.preventDefault(); S.playing ? pause() : play(); }
      return;
    }
    // 全屏
    if (mod && shift && key === 'f') {
      e.preventDefault(); toggleFullscreen(); return;
    }
    // 播放器缩放（画布缩放）—— 简化：缩放时间线 or 提示
    if (alt && shift && (key === '=' || key === '+')) { e.preventDefault(); setViewScale(1.15); return; }
    if (alt && shift && (key === '-' || key === '_')) { e.preventDefault(); setViewScale(1 / 1.15); return; }
    if (alt && shift && key === 'z') { e.preventDefault(); setViewScale(0); return; }  // 适配

    if (typing) return;

    // ── 删除：Delete / Backspace 直接删掉选中的素材（剪映同款）──
    if (!mod && !shift && !alt && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      deleteSelected();
      return;
    }

    // ── 时间线 ──
    if (mod && !shift && key === 'b') { e.preventDefault(); splitAtPlayhead(); return; }        // 分割 Ctrl+B
    if (mod && shift && key === 'b') { e.preventDefault(); toast('批量分割：先把要分的行在「逐行手法」里展开'); return; } // 批量分割
    if (!mod && !shift && key === 'a') { e.preventDefault(); toast('选择模式'); return; }       // 鼠标选择模式 A
    if (!mod && !shift && key === 'n') { e.preventDefault(); S.snap = !S.snap; const st = $('#tlSnapTag'); if (st) { st.classList.toggle('off', !S.snap); st.textContent = S.snap ? '吸附' : '自由'; } toast(S.snap ? '吸附已开启' : '吸附已关闭'); return; } // 吸附 N
    if (mod && !shift && (key === '=' || key === '+')) { e.preventDefault(); S.tlPps = J.clamp(S.tlPps * 1.25, 8, 600); drawTimeline(); return; }  // 轨道放大
    if (mod && !shift && (key === '-' || key === '_')) { e.preventDefault(); S.tlPps = J.clamp(S.tlPps / 1.25, 8, 600); drawTimeline(); return; } // 轨道缩小
    if (shift && !mod && key === 'z') { e.preventDefault(); fitTimeline(); return; }            // 全局预览缩放 Shift+Z
    if (shift && !mod && e.code === 'ArrowRight') { e.preventDefault(); seek(S.t + 1); return; } // 大幅前进
    if (shift && !mod && e.code === 'ArrowLeft') { e.preventDefault(); seek(S.t - 1); return; }  // 大幅后退

    // ── 基础 ──
    if (mod && !shift && key === 'z') { e.preventDefault(); undo(); return; }                  // 撤销 Ctrl+Z
    if (mod && shift && key === 'z') { e.preventDefault(); redo(); return; }                    // 重做 Ctrl+Shift+Z
    if (mod && !shift && key === 'y') { e.preventDefault(); redo(); return; }                   // 重做 Ctrl+Y
    if (mod && !shift && key === 'i') { e.preventDefault(); $('#fileMedia').click(); return; }  // 导入媒体 Ctrl+I
    if (mod && !shift && key === 'e') { e.preventDefault(); doExport(); return; }               // 导出 Ctrl+E
    if (mod && !shift && key === 'n') { e.preventDefault(); toast('新建草稿：刷新页面即得新工程'); return; } // 新建草稿
    if (!mod && !shift && key === 'tab') { e.preventDefault(); togglePanel('left'); return; }   // 切换素材面板 Tab
    if (mod && !shift && (e.key === 'Backspace' || e.key === 'Delete')) { e.preventDefault(); deleteSelected(); return; } // 删除

    // 普通方向键：逐帧
    if (alt && !mod && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {       // Alt+←/→：选中的素材逐帧微调（加 Shift = 10 帧）
      const nm = S.media[S.mediaSel];
      if (nm) {
        e.preventDefault();
        const f = (1 / (S.plan ? S.plan.fps : 24)) * (shift ? 10 : 1) * (e.code === 'ArrowLeft' ? -1 : 1);
        nm.start = J.clamp(+(nm.start + f).toFixed(4), 0, Math.max(0, S.plan.duration - 0.2));
        S.need = true; drawTimeline(); syncMediaInsp(); commit();
        return;
      }
    }
    if (!mod && e.code === 'ArrowRight' && !e.target.matches('input[type=range]')) { seek(S.t + 1 / S.project.fps * 4); }
    if (!mod && e.code === 'ArrowLeft' && !e.target.matches('input[type=range]')) { seek(S.t - 1 / S.project.fps * 4); }
  });
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
}

/* 画布缩放（播放器放大/缩小/适配） */
let viewScale = 1;
function setViewScale(k) {
  if (k === 0) { viewScale = 1; } else { viewScale = J.clamp(viewScale * k, 0.5, 2); }
  sizeCanvas();
  toast('画布缩放 ' + Math.round(viewScale * 100) + '%');
}

function fitTimeline() {
  const scroll = $('#tlScroll');
  if (!scroll || !S.plan) return;
  S.tlPps = J.clamp((scroll.clientWidth - TL.labelW) / S.plan.duration, 8, 600);
  scroll.scrollLeft = 0;
  drawTimeline();
}

/* 删除选中的素材（Delete / Backspace） */
function deleteSelected() {
  if (S.mediaSel >= 0 && S.media[S.mediaSel]) { removeMedia(S.mediaSel); return; }
  if (TL.sel && TL.sel.kind === 'text') { toast('文字块删不了：想删这一句，到左栏「歌词文案」删掉那一行'); return; }
  toast('先在时间线或素材列表里点一下要删的素材，再按 Delete（删错了 Ctrl+Z 撤销）');
}

/* ───────────────────────── 小工具 ───────────────────────── */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const fmtClock = t => {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return m + ':' + String(s).padStart(2, '0');
};

let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

window.STUDIO = S;
boot();
})();
