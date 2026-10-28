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
  tap: null,          // half-speed word tap: { line, words, i, starts }
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
  beatCfg: { len: 'auto', inAnim: 'auto', pulse: true, layout: 'slot', videoSpan: false },   // 导入：图片/视频默认进版式；想整段铺开再勾「视频按原片长铺开」
  mediaSel: -1,       // 当前选中的素材下标
  tlPps: 60,          // 时间线缩放：每秒占多少像素（8~600）
  tlScroll: 0,        // 时间线横向滚动偏移（像素）
  snap: true,         // 吸附开关（N）
  snapBeat: false,    // 额外吸附节拍（默认关，主要吸附素材 / 文字块 / 播放头）
};

/* ───────────────────── 音频播放（WebAudio，导出不加任何处理） ───────────────────── */

const AP = {
  ctx: null, src: null, gain: null, startAt: 0, base: 0, vol: 0.8, rate: 1,
  play(buffer, offset) {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.stop();
    if (!this.gain) { this.gain = this.ctx.createGain(); this.gain.connect(this.ctx.destination); this.applyVol(); }
    const s = this.ctx.createBufferSource();
    s.buffer = buffer; s.connect(this.gain);
    s.playbackRate.value = this.rate;
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
  time() { return this.ctx ? this.base + (this.ctx.currentTime - this.startAt) * this.rate : 0; },
  setRate(r) { this.rate = J.clamp(r, 0.25, 2); if (this.src) { try { this.src.playbackRate.value = this.rate; } catch (e) {} } },
  setVol(v) { this.vol = J.clamp(v, 0, 1); this.applyVol(); },
  applyVol() { if (this.gain) this.gain.gain.value = this.vol * this.vol; },
};

/* ───────────────────────── 初始化 ───────────────────────── */

function boot() {
  const p = J.defaultProject();
  const R = window.__RESTORE__;                 // 上次的工程（app/project_io.js 在解析阶段读好放这）
  if (R && R.project) {
    Object.assign(p, R.project);                // 直接恢复：歌词 / 风格 / 编排 / 时间 / 素材片段
  } else {
  Object.assign(p, {
    lyrics: SAMPLE,
    style: 'noir',                      // 默认：高反差黑白 + 一个强调色（MAD / 文字 PV 的底）
    genre: 'mad',                       // mad | lyric | journal —— 一键成片先选类型
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
    unify: true,                        // 重复副歌用同一套编排回来
    typeset: true,                      // 中文排版：虚词小一档、情感词大一档
    choreo: true,                       // 词级编舞（15_mad.js）
    garnish: false,                     // 两侧补白：手帐风才开，默认关
    variety: 0.35,
    what: true,
    includeAudio: true,
    audioName: '',
    overrides: {},
    slotLines: [],          // 有素材要「进版式」的歌词行：planner 会优先给这些行挑能放素材的版式
    timing: { bpm: 96, offset: 0.4, snap: true, tail: 0.9, lineTimes: {}, lineDurs: {}, lineEnds: {}, lineScale: 1, words: {} },
  });
  if (R) p.fx = Object.assign({}, J.defaultProject().fx, p.fx || {});          // old projects keep their feel, gain new fields
  else p.fx = Object.assign(p.fx, { motion: 0.72, density: 0.55, decor: 0.18, glitch: 0.35, texture: 0.5, chroma: 0.26, koma: 12, onTwos: true, motionBlur: 4 });
  p.timing = Object.assign({ words: {}, lineTimes: {}, lineDurs: {}, lineEnds: {} }, p.timing || {});
  if (!J.STYLES[p.style]) p.style = 'noir';      // old projects may point at a deleted style key
  // 背景层：形状图层 + 英文仅描边 / 实心+描边叠层（全部默认关，开了才改画面）
  p.text = { outlineEn: false, stack: 0, shapes: { block: false, honey: false, dots: false, noise: false }, amt: 0.45, size: 0.65, drift: 0.5 };
  p.more = true;
  }
  p.fx = Object.assign({}, J.defaultProject().fx, p.fx || {});
  p.text = Object.assign({ outlineEn: false, stack: 0, shapes: {}, amt: 0.45, size: 0.65, drift: 0.5 }, p.text || {});

  // 深链接：?style=mxMorning&aspect=9:16&seed=123&extra=1
  const q = new URLSearchParams(location.search);
  if (q.get('style') && J.STYLES[q.get('style')]) p.style = q.get('style');
  if (q.get('aspect')) p.aspect = q.get('aspect');
  if (q.get('seed')) p.seed = +q.get('seed') || p.seed;
  if (q.get('extra')) p.extra = q.get('extra') === '1';
  if (q.get('variety') != null && q.get('variety') !== '') p.variety = J.clamp(+q.get('variety') || 0, 0, 1);
  // No genre template: every project runs the full restored technique library.
  p.freeLibrary = true;
  p.genre = null;
  p.extra = true; p.wa = true; p.typo = true; p.kinetic = true; p.horror = true;
  p.enabled = libraryEnabled();
  S.project = p;
  if (R && R.media && R.media.length) S.media = R.media.slice();   // 归档里的素材片段（图片数据稍后从 IndexedDB 补）

  $('#lyrics').value = p.lyrics;
  $('#bpm').value = p.timing.bpm;
  $$('#segAspect button').forEach(b => b.classList.toggle('on', b.dataset.v === p.aspect));
  const vEl0 = $('#variety');
  if (vEl0) { vEl0.value = Math.round(p.variety * 100); $('#oVariety').textContent = p.variety.toFixed(2); }
  if ([...$('#selRes').options].some(o => +o.value === p.res)) $('#selRes').value = p.res;
  if ([...$('#selFps').options].some(o => +o.value === p.fps)) $('#selFps').value = p.fps;
  $('#swExtra').checked = !!p.extra;

  if ($('#motionBlur')) { $('#motionBlur').value = p.fx.motionBlur | 0; $('#oMotionBlur').textContent = p.fx.motionBlur | 0; }
  if ($('#segGenre')) $$('#segGenre button').forEach(b => b.classList.toggle('on', b.dataset.v === (p.genre || 'mad')));
  if ($('#segKoma')) $$('#segKoma button').forEach(b => b.classList.toggle('on', +b.dataset.v === (p.fx.koma || 0)));

  buildStyleGrid();
  buildFontSelects();
  initFolds();
  initResizers();
  bind();
  bindMediaCard();
  bindPv();
  syncMediaUI();
  syncSubState();
  syncMediaState();

  // 工程快照：能 JSON 化的都取出来（图片数据另外存）
  function projectSnapshot() {
    const media = S.media.map(m => { const o = {}; for (const k in m) if (k !== 'img' && k !== 'url' && k !== 'el' && k !== 'frames') o[k] = m[k]; return o; });
    return { v: 1, at: Date.now(), project: JSON.parse(JSON.stringify(S.project)), media };
  }

  // 对外接口（自动化测试 / 控制台调试用）
  S.api = { replan, setOverride, toast, targetLine, applySubText, parseCues, cuesToLrc, loadAudioFile, drawWave, loadMediaFile, addImageFiles, dropFiles, importDrop, filesFromDrop, sortDropFiles, exportPNG, tlGeom, drawTimeline, removeMedia, selectMedia, draw, drawMediaOverlay, drawMediaUnder, undo, redo, snapSlotDrop: dropSlotClip, syncMediaList, syncMediaState, projectSnapshot, applyGenre, wordSheet: () => (J.MAD && J.MAD.sheet ? J.MAD.sheet(S.plan) : '') };

  replan();
  commit(); syncHistBtns();          // 历史的第 0 步：刚打开时的样子

  if (S.plan && S.plan.cuts.length) {
    // 词级编舞下第一帧只是一个字；打开时停在一个「重击/残影」词的中段，先看到这一版的力度。
    const cs = S.plan.cuts;
    const c = cs.find(x => x.action === 'hit' || x.action === 'echo') || cs[Math.max(0, Math.floor(cs.length * 0.35))] || cs[0];
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
  J.ensureFonts(txt, keys).then(() => {
    // word sizes were measured before the embedded faces were ready; re-lay them once
    S.need = true;
    if (S.project && S.project.choreo !== false) replan();
  }).catch(() => {});
}

function buildFontSelects() {
  const opts = ['<option value="">跟随风格</option>']
    .concat(J.LOCAL_FONT_PICKS.map(f => `<option value="${f.key}">${f.name}　${f.note}</option>`));
  for (const id of ['#fDisplay', '#fSerif', '#fBody']) $(id).innerHTML = opts.join('');
}

/* ───────────────────────── 风格 ───────────────────────── */

/* 配色在界面上的中文名 / 气质（引擎内部仍用原 key） */
const STYLE_META = {
  noir: ['黑场橙', '黑白 + 琥珀，重击底子'],
  crimson: ['深红信号', '红黑 + 青绿，故障'],
  hud: ['暗夜 HUD', '炭灰 + 橙，仪器感'],
  specimen: ['标本纸', '墨黑 + 米色，抒情'],
  paper: ['纸与墨', '米白 + 洋红，手帐'],
  mono: ['单色 RGB', '灰阶 + RGB 重影'],
  mint: ['薄荷终端', '黑 + 荧光绿'],
  rouge: ['胭脂渐变', '灰 + 红渐变'],
  caution: ['警戒黄', '黄 + 红蓝，工业'],
  magenta: ['霓虹洋红', '高饱和粉 + 蓝'],
  transit: ['交通牌', '橄榄 + 黄，标识'],
  blueprint: ['蓝图', '鲜蓝 + 白 + 黑'],
};

/* 一键成片先选类型，而不是直接随机「浅底 + 彩字」 */
const GENRES = {
  mad: {
    label: '重击 MAD', style: 'noir', choreo: true, unify: true, typeset: true, garnish: false,
    fonts: { display: 'gothic_black', serif: 'mincho_black', body: 'round' },   // Noto Black + ZCOOL KuaiLe tags
    fx: { motion: 0.78, density: 0.6, decor: 0.12, glitch: 0.42, texture: 0.52, chroma: 0.30, motionBlur: 4, koma: 12, onTwos: true, flash: true },
  },
  lyric: {
    label: '抒情 PV', style: 'specimen', choreo: true, unify: true, typeset: true, garnish: false,
    fonts: { display: 'mincho_black', serif: 'mincho', body: 'klee' },           // Noto Serif 900 + LXGW WenKai
    fx: { motion: 0.46, density: 0.42, decor: 0.22, glitch: 0.06, texture: 0.72, chroma: 0.14, motionBlur: 2, koma: 12, onTwos: true, flash: true },
  },
  journal: {
    label: '手帐', style: 'paper', choreo: false, unify: false, typeset: false, garnish: false,
    fonts: { display: 'brush', serif: 'klee', body: 'klee' },                  // Ma Shan Zheng + LXGW WenKai
    fx: { motion: 0.32, density: 0.5, decor: 0.78, glitch: 0.02, texture: 0.9, chroma: 0.08, motionBlur: 0, koma: 0, onTwos: false, flash: false },
  },
};
function libraryEnabled() {
  return Object.fromEntries(J.GROUP_KEYS.map(g => [g, Object.fromEntries(
    (J.libOrder ? J.libOrder(g) : J.order(g)).map(k => [k, true])
  )]));
}
function freeReplan() {
  S.project.freeLibrary = true;
  S.project.genre = null;
  S.project.enabled = libraryEnabled();
  S.project.overrides = {};
  S.project.seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
  replan();
  toast('已用高级手法库重新编排');
}
function applyGenre(kind) {
  const G = GENRES[kind]; if (!G) return;
  S.project.genre = kind;
  S.project.style = G.style;
  S.project.choreo = G.choreo;
  S.project.unify = G.unify;
  S.project.typeset = G.typeset;
  S.project.garnish = G.garnish;
  S.project.fonts = S.project.fonts || {};
  for (const [role, key] of Object.entries(G.fonts)) S.project.fonts[role] = key;
  S.project.fx = Object.assign({}, S.project.fx, G.fx);
  // Each template owns a small, deliberate technique set. A one-click template
  // should not quietly re-enable the old 900-piece sampler.
  S.project.enabled = Object.fromEntries(J.GROUP_KEYS.map(g => [g, Object.fromEntries(J.order(g).map(k => [k, true]))]));
  if (kind === 'journal') {
    const only = (g, keys) => {
      const map = S.project.enabled[g] || (S.project.enabled[g] = {});
      for (const k of Object.keys(map)) map[k] = keys.includes(k);
    };
    only('layout', J.JOURNAL_LAYOUTS || ['journalText', 'journalPhoto']);
    only('enter', ['cut']);            // the journal layouts animate the page themselves
    only('exit', ['cut']);
    only('hold', ['still']);
    only('decor', []);
    only('bg', []);
    only('cam', ['push', 'still']);
    only('treat', ['none']);
    only('trans', []);
    S.project.fx.decor = 0;
    S.project.fx.glitch = 0;
  }
  S.fontsKey = '';
  $$('#segGenre button').forEach(b => b.classList.toggle('on', b.dataset.v === kind));
  $$('.st').forEach(b => b.classList.toggle('on', b.dataset.k === G.style));
  const mb = $('#motionBlur'); if (mb) { mb.value = G.fx.motionBlur; $('#oMotionBlur').textContent = G.fx.motionBlur; }
  $$('#segKoma button').forEach(b => b.classList.toggle('on', +b.dataset.v === (G.fx.koma || 0)));
  replan();
  toast('已套用「' + G.label + '」模板 · ' + (G.choreo ? '词级编舞' : '逐行版式'));
}

function buildStyleGrid() {
  const box = $('#styleGrid');
  box.innerHTML = '';
  // All 66 presets live in ONE fold; no “8 outside + 58 inside” split.
  const ALL = J.STYLE_ORDER.filter(k => J.STYLES[k]);
  const make = (k) => {
    const st = J.STYLES[k]; if (!st) return null;
    const sc = (st.schemes && st.schemes[0]) || {};
    const meta = STYLE_META[k] || [st.name || k, st.desc || ''];
    const el = document.createElement('div');
    el.className = 'st' + (k === S.project.style ? ' on' : '');
    el.dataset.k = k;
    el.title = meta[0] + ' — ' + meta[1];
    el.innerHTML = `<div class="st-swatch">
        <i style="background:${sc.bg || '#111'}"></i>
        <i style="background:${sc.fg || '#fff'}"></i>
        <i style="background:${sc.accent || '#888'}"></i>
      </div><span class="st-txt"><b class="st-name">${meta[0]}</b><small class="st-desc">${meta[1]}</small></span>`;
    el.onclick = () => {
      S.project.style = k;
      $$('.st').forEach(e => e.classList.toggle('on', e.dataset.k === k));
      updateSums();
      replan();
    };
    return el;
  };
  const more = document.createElement('details');
  more.className = 'style-more';
  more.innerHTML = '<summary>全部配色（' + ALL.length + '）</summary><div class="styles all"></div>';
  const moreGrid = more.querySelector('.styles');
  for (const k of ALL) { const el = make(k); if (el) moreGrid.appendChild(el); }
  box.appendChild(more);
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
        (J.libOrder ? J.libOrder(g) : J.order(g)).map(k => J.registry(g)[k] ? `<option value="${k}">${escapeHtml(J.registry(g)[k].name)}</option>` : '').join('');
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

function bindPv() {
  const load = $('#btnPvLoad'), exit = $('#btnPvExit'), live = $('#pvLive');
  if (!load || !live) return;
  const title = $('#pvTitleMain'), credits = $('#pvCreditsMain');
  const slots = $('#pvSlotsMain');
  const syncFields = () => {
    const st = S.project.pvState || J.PV_DEFAULT_STATE();
    title.value = st.title || '明知故犯';
    credits.value = (st.credits || []).join('\n');
  };
  const readFields = () => {
    const st = S.project.pvState || (S.project.pvState = J.PV_DEFAULT_STATE());
    st.title = title.value.trim() || '明知故犯';
    st.credits = credits.value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  };
  const buildSlots = () => {
    slots.innerHTML = '';
    for (let i = 0; i < 7; i++) {
      const lab = document.createElement('label');
      lab.className = 'pv-slot-mini';
      lab.title = 'PV 立绘 ' + (i + 1) + '：点击替换';
      const im = document.createElement('img');
      im.src = (J.PV_IMAGES[i] && J.PV_IMAGES[i].src) || PV_ASSETS.portrait(i);
      const num = document.createElement('b'); num.textContent = '0' + (i + 1);
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.hidden = true;
      inp.addEventListener('change', () => {
        const f = inp.files && inp.files[0]; if (!f) return;
        const img = new Image();
        img.onload = () => { J.PV_IMAGES[i] = img; S.need = true; buildSlots(); toast('PV 立绘 ' + (i + 1) + ' 已替换'); };
        img.src = URL.createObjectURL(f);
      });
      lab.append(im, num, inp); slots.appendChild(lab);
    }
  };
  const show = v => {
    live.hidden = !v;
    $('#btnPvLoad').textContent = v ? '重新载入' : '载入 PV 时间线';
    $('#btnPvExit').style.opacity = v ? '1' : '.55';
  };
  const loadPv = () => {
    S.project.pvMode = true;
    S.project.aspect = '16:9';
    S.project.pvState = J.PV_DEFAULT_STATE();
    J.PV_IMAGES = [];
    S.project.overrides = {};
    S.t = 0; S.playing = false;
    const card = load.closest('details'); if (card) card.open = true;
    show(true); syncFields(); buildSlots();
    replan();
    toast('PV 时间线已载入：12 个分镜 / 44 秒');
  };
  load.addEventListener('click', loadPv);
  exit.addEventListener('click', () => {
    S.project.pvMode = false;
    show(false);
    S.t = 0; S.playing = false;
    replan();
    toast('已退出 PV，回到普通编排');
  });
  title.addEventListener('input', () => { readFields(); replan(); });
  credits.addEventListener('input', () => { readFields(); replan(); });
  // 工程已经是 PV：打开控制区并填入当前文字
  if (S.project.pvMode) { show(true); syncFields(); buildSlots(); }
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

/* ── 半速逐词点拍 ──
   播放速度降到 0.5×，唱到每个词时按空格 / 点画面，记下这个词的起点。
   全部点完后写进 project.timing.words，恢复 1×。 */
function startTap() {
  if (!S.plan) return;
  if (S.tap) { tapWord(); return; }
  const li = targetLine();
  if (li < 0) { toast('先把播放头停到要点的歌词行上'); return; }
  const row = S.plan.mad && S.plan.mad.words ? S.plan.mad.words.find(x => x.line === li) : null;
  if (!row || !row.words.length) { toast('这一行没有可点的词'); return; }
  S.tap = { line: li, words: row.words.map(w => ({ w: w.w })), i: 0, starts: [] };
  S.openLine = li;
  AP.setRate(0.5);
  const line = S.plan.lines[li];
  seek(Math.max(0, line.start - 0.12));
  if (!S.playing) play();
  $('#btnWordTap').classList.add('on');
  $('#btnWordTap').textContent = '点拍中 ' + S.tap.i + '/' + S.tap.words.length;
  toast('半速点拍：唱到词就按空格 / 点画面；Esc 取消');
}
function tapWord() {
  if (!S.tap) return;
  const tap = S.tap;
  const t = Math.max(0, S.audio ? AP.time() : S.t);
  const last = tap.starts[tap.starts.length - 1];
  if (last != null && t <= last + 0.04) return;
  tap.starts.push(t);
  tap.i = tap.starts.length;
  $('#btnWordTap').textContent = '点拍中 ' + tap.i + '/' + tap.words.length;
  if (tap.i >= tap.words.length) finishTap();
}
function finishTap() {
  const tap = S.tap; if (!tap) return;
  const line = S.plan.lines[tap.line] || { end: tap.starts[tap.starts.length - 1] + 0.4 };
  const arr = tap.words.map((w, i) => ({
    w: w.w,
    start: +tap.starts[i].toFixed(3),
    end: +(i + 1 < tap.starts.length ? tap.starts[i + 1] : Math.max(tap.starts[i] + 0.3, line.end)).toFixed(3),
  }));
  S.project.timing.words[tap.line] = arr;
  S.tap = null;
  AP.setRate(1);
  pause();
  $('#btnWordTap').classList.remove('on');
  $('#btnWordTap').textContent = '半速点拍';
  replan();
  toast('第 ' + (tap.line + 1) + ' 行逐词时间已写入');
}
function cancelTap() {
  if (!S.tap) return;
  S.tap = null; AP.setRate(1); pause();
  $('#btnWordTap').classList.remove('on');
  $('#btnWordTap').textContent = '半速点拍';
  toast('已取消半速点拍');
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
  // Preview is capped: the export still renders at the chosen resolution, but the
  // on-screen canvas does not need 1920px while a video is playing on a laptop.
  const pw = Math.round(Math.min(S.plan.W, cssW * dpr, 1440));
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
  S.renderer.frame(ctx, S.plan, S.t, {
    scale: c.width / S.plan.W,
    fast: S.playing || S.slow,          // playing: skip bloom/chroma blur, keep the motion
    noMotionBlur: S.playing,            // sub-frames are for the export / paused stills
    overlay: drawMediaOverlay, underlay: drawMediaUnder, slot: paintSlot,
  });
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
  maxLane: 12, sel: null, hot: null, multi: [],
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
    const sel = !!(TL.sel && TL.sel.kind === 'text' && TL.sel.i === i) || tlHasSel('text', i);
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
  // 空档里的装饰段：在文字轨上画成虚线块，提醒这里不是空白
  for (const c of (G.P.cuts || [])) {
    if (!c.ambient) continue;
    const xa = G.X(c.start), xb = G.X(c.end);
    if (!G.seen(xa, xb)) continue;
    const bw = Math.max(2, xb - xa), y = G.textTop + 5, bh = Math.max(8, G.textH - 10);
    ctx.fillStyle = '#232B3A';
    roundRect(ctx, xa, y, bw, bh, 4); ctx.fill();
    ctx.save(); ctx.strokeStyle = '#4A5875'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    roundRect(ctx, xa + .5, y + .5, Math.max(1, bw - 1), bh - 1, 4); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
    if (bw > 34) {
      ctx.save(); ctx.beginPath(); ctx.rect(xa + 4, y, Math.max(0, bw - 8), bh); ctx.clip();
      ctx.fillStyle = '#A9B6D0'; ctx.font = '600 10.5px system-ui,"Microsoft YaHei"'; ctx.textBaseline = 'middle';
      ctx.fillText('✦ 装饰', xa + 7, y + bh / 2 + .5);
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
    const sel = S.mediaSel === i || (TL.sel && TL.sel.kind === 'media' && TL.sel.i === i) || tlHasSel('media', i);
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

  // ── 框选矩形 ──
  if (tlMarquee) {
    const x0 = Math.min(tlMarquee.x0, tlMarquee.x1), x1 = Math.max(tlMarquee.x0, tlMarquee.x1);
    const y0 = Math.min(tlMarquee.y0, tlMarquee.y1);
    let y1 = Math.max(tlMarquee.y0, tlMarquee.y1);
    if (y1 - y0 < 6) y1 = y0 + 6;                 // 只横向拖时也画成一条可见的选区
    ctx.save();
    ctx.fillStyle = 'rgba(76,111,255,.16)'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = '#8FA8FF'; ctx.lineWidth = 1.4; ctx.setLineDash([4, 3]);
    ctx.strokeRect(Math.round(x0) + .5, Math.round(y0) + .5, x1 - x0, y1 - y0);
    ctx.setLineDash([]); ctx.restore();
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

  // ── 吸附提示线（拖动时吸到目标的那一瞬间亮一条黄线，并标出吸到了什么） ──
  if (tlSnapGuide != null) {
    const gx = Math.round(G.X(tlSnapGuide)) + .5;
    ctx.strokeStyle = '#FFD84D'; ctx.lineWidth = 1.4; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(gx, TL.rulerH); ctx.lineTo(gx, H); ctx.stroke(); ctx.setLineDash([]);
    if (tlSnapLabel) {
      ctx.font = '600 9.5px system-ui,"Microsoft YaHei"'; ctx.textBaseline = 'middle';
      const tw = ctx.measureText(tlSnapLabel).width + 10;
      const tx = J.clamp(gx - tw / 2, TL.labelW + 2, W - tw - 2);
      ctx.fillStyle = 'rgba(14,18,26,.88)';
      roundRect(ctx, tx, TL.rulerH + 3, tw, 14, 4); ctx.fill();
      ctx.fillStyle = '#FFD84D'; ctx.textAlign = 'center';
      ctx.fillText(tlSnapLabel, tx + tw / 2, TL.rulerH + 10.5);
      ctx.textAlign = 'left';
    }
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

/* 吸附：和剪映一样，优先吸素材 / 文字块的边缘，其次播放头 / 片头片尾；
   节拍吸附单独用「拍点」开关（默认关），不会再把拖动死死拽到节拍上。
   磁吸范围按屏幕像素算（素材 9px，拍点 7px），缩放到多大都稳定。 */
let tlSnapGuide = null, tlSnapLabel = '', tlAlt = false;
let tlMarquee = null;                 // 框选矩形（画布坐标）
function snapCands(excl) {
  const ex = Array.isArray(excl) ? excl : (excl ? [excl] : []);
  const skipText = i => ex.some(s => s.kind === 'text' && s.i === i);
  const skipMedia = i => ex.some(s => s.kind === 'media' && s.i === i);
  const c = [{ t: 0, k: '片段头' }, { t: S.t, k: '播放头' }];
  if (S.plan) {
    c.push({ t: S.plan.duration, k: '片段尾' });
    (S.plan.lines || []).forEach((ln, i) => {
      if (skipText(i)) return;
      c.push({ t: ln.start, k: '文字' });
      c.push({ t: ln.visEnd != null ? ln.visEnd : ln.end, k: '文字' });
    });
  }
  S.media.forEach((m, i) => {
    if (skipMedia(i)) return;
    c.push({ t: m.start, k: '素材' });
    c.push({ t: m.start + m.dur, k: '素材' });
  });
  return c;
}
/* start = 想要的起点；dur > 0 时头和尾都可以吸（整块平移）；dur = 0 时只吸这一个点（拖边缘） */
function magSnapSpan(start, dur, excl) {
  tlSnapGuide = null; tlSnapLabel = '';
  const free = v => Math.round(v * 1000) / 1000;              // 不再强行对帧：可以拖到任意位置
  if (!S.snap || tlAlt) return free(start);
  const G = tlGeom(), pps = G ? G.pps : 60;
  const cands = snapCands(excl);
  let best = null, bd = 9 / pps;
  for (const e of (dur > 0 ? [0, dur] : [0])) {
    for (const c of cands) {
      const d = Math.abs(start + e - c.t);
      if (d < bd) { bd = d; best = { s: c.t - e, t: c.t, k: c.k }; }
    }
  }
  if (!best && S.snapBeat) {
    const T = S.project.timing || {};
    if (T.bpm > 0) {
      const b = 60 / T.bpm, off = T.offset || 0;
      bd = 7 / pps;
      for (const e of (dur > 0 ? [0, dur] : [0])) {
        const hit = off + Math.round((start + e - off) / b) * b;
        const d = Math.abs(start + e - hit);
        if (d < bd) { bd = d; best = { s: hit - e, t: hit, k: '拍点' }; }
      }
    }
  }
  if (best) { tlSnapGuide = best.t; tlSnapLabel = best.k; return free(best.s); }
  return free(start);
}

/* ── 时间线多选：框选 / Ctrl 点选 / Delete 批量删除 ── */
const tlHasSel = (kind, i) => TL.multi.some(s => s.kind === kind && s.i === i);
function tlSetSelection(list, primary) {
  TL.multi = (list || []).filter(s => s && (s.kind === 'text' || s.kind === 'media'));
  if (primary && TL.multi.some(s => s.kind === primary.kind && s.i === primary.i)) TL.sel = { kind: primary.kind, i: primary.i };
  else TL.sel = TL.multi.length ? Object.assign({}, TL.multi[TL.multi.length - 1]) : null;
  let pm = TL.sel && TL.sel.kind === 'media' ? TL.sel.i : -1;
  if (pm < 0) { const rev = TL.multi.filter(s => s.kind === 'media'); if (rev.length) pm = rev[rev.length - 1].i; }
  S.mediaSel = (pm >= 0 && S.media[pm]) ? pm : -1;
  syncMediaList(); drawTimeline(); syncMediaInsp();
}
function marqueePick(G, r) {
  const out = [];
  (G.P.lines || []).forEach((ln, i) => {
    const xa = G.X(ln.start), xb = G.X(ln.visEnd != null ? ln.visEnd : ln.end);
    if (xb >= r.x0 && xa <= r.x1 && G.textBot >= r.y0 && G.textTop <= r.y1) out.push({ kind: 'text', i });
  });
  S.media.forEach((m, i) => {
    const lane = J.clamp(m.lane | 0, 0, Math.max(0, G.lanes - 1));
    const xa = G.X(m.start), xb = G.X(m.start + m.dur);
    const ya = G.laneTop(lane), yb = ya + TL.laneH;
    if (xb >= r.x0 && xa <= r.x1 && yb >= r.y0 && ya <= r.y1) out.push({ kind: 'media', i });
  });
  return out;
}

/* 手动拖文字块时，先把其他行的当前时间冻结住：拖一行不会带着后面的行一起跑。
   以前只改 project.timing，画面要等松手才重排，所以文字块看起来「拖不动」。 */
function freezeTextTiming() {
  if (!S.plan) return;
  const T = S.project.timing;
  T.lineTimes = T.lineTimes || {};
  T.lineEnds = T.lineEnds || {};
  T.lineDurs = T.lineDurs || {};
  (S.plan.lines || []).forEach((ln, i) => {
    if (T.lineTimes[i] == null) T.lineTimes[i] = +(+ln.start).toFixed(3);
    const e = ln.visEnd != null ? ln.visEnd : ln.end;
    if (T.lineEnds[i] == null) T.lineEnds[i] = +(+e).toFixed(3);
    if (T.lineDurs[i] == null) T.lineDurs[i] = +Math.max(0.35, e - ln.start).toFixed(3);
  });
}
/* 拖动中的文字块：先直接改 plan.lines 让时间线立刻跟着走，再每 80ms 重排一次画面 */
function queueTextReplan() {
  if (queueTextReplan._t) return;
  queueTextReplan._t = setTimeout(() => { queueTextReplan._t = 0; replan(); }, 80);
}
function flushTextReplan() {
  if (queueTextReplan._t) { clearTimeout(queueTextReplan._t); queueTextReplan._t = 0; }
  replan();
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

    if (hit && (hit.kind === 'text' || hit.kind === 'media') && (e.ctrlKey || e.metaKey)) {
      const list = TL.multi.slice();
      const at = list.findIndex(s => s.kind === hit.kind && s.i === hit.i);
      if (at >= 0) list.splice(at, 1); else list.push({ kind: hit.kind, i: hit.i });
      tlSetSelection(list, at >= 0 ? (list[list.length - 1] || null) : { kind: hit.kind, i: hit.i });
      pause(); drawTimeline();
      return;
    }
    if (hit && hit.kind === 'kf') {
      const km = S.media[hit.i];
      S.mediaSel = hit.i; TL.sel = { kind: 'media', i: hit.i };
      TL.multi = [{ kind: 'media', i: hit.i }];
      syncMediaList();
      pause();
      const refs = [];
      for (const k of KPROPS) for (const q of km.kf[k]) if (Math.abs(q.t - hit.t) < 0.0015) refs.push(q);
      drag = { kfDrag: true, i: hit.i, refs, t0: hit.t, x0: p.x, pps: G.pps, moved: false };
      seek(km.start + hit.t);
    } else if (hit && (hit.kind === 'text' || hit.kind === 'media')) {
      const i = hit.i;
      if (!tlHasSel(hit.kind, i)) tlSetSelection([{ kind: hit.kind, i }], { kind: hit.kind, i });
      else {
        TL.sel = { kind: hit.kind, i };
        if (hit.kind === 'media') { S.mediaSel = i; syncMediaList(); syncMediaInsp(); }
      }
      let base;
      if (hit.kind === 'text') {
        const ln = S.plan.lines[i];
        const end = ln.visEnd != null ? ln.visEnd : ln.end;
        base = { start: ln.start, end, dur: Math.max(0.3, end - ln.start), lane: 0 };
        pause();
      } else {
        const m = S.media[i];
        pause();
        if (m.inLayout && !m.orphan) {           // 融进版式：也能拖 —— 松手时自动吸附到落点那一句（素材落在哪行就绑哪行）
          syncMediaInsp();
        }
        base = { start: m.start, dur: m.dur, lane: m.lane | 0 };
      }
      // 多选后拖动其中一条：整组一起平移（只对自由层素材，版式里的仍然单独拖）
      const gSel = hit.kind === 'media' && hit.edge === 'body'
        ? TL.multi.filter(s => s.kind === 'media').map(s => S.media[s.i]).filter(mm => mm && !mm.inLayout)
        : [];
      const allMediaSel = hit.kind === 'media' ? TL.multi.filter(s => s.kind === 'media').length : 0;
      const group = gSel.length > 1 && gSel.length === allMediaSel ? gSel.map(mm => ({ m: mm, start: mm.start, lane: mm.lane | 0 })) : null;
      TL.sel = { kind: hit.kind, i };
      drag = { hit, x0: p.x, y0: p.y, t0: G.unX(p.x), pps: G.pps, laneH: TL.laneH, base, moved: false, lane0: base.lane | 0, group, slot: hit.kind === 'media' && !!S.media[i].inLayout && !S.media[i].orphan };
      cv.style.cursor = 'grabbing';
      if (hit.kind === 'text') seek(base.start + 0.01);
    } else if (hit && hit.kind === 'ruler') {
      drag = { scrub: true };
      pause(); seek(G.unX(p.x));
    } else if (hit) {
      // 空白处：按住拖 = 框选；不拖 = 跳播放头
      drag = { marquee: true, x0: p.x, y0: p.y, x1: p.x, y1: p.y, moved: false };
      tlMarquee = null;
      pause();
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
    if (drag.marquee) {
      if (Math.abs(p.x - drag.x0) > 3 || Math.abs(p.y - drag.y0) > 3) drag.moved = true;
      drag.x1 = p.x; drag.y1 = p.y;
      tlMarquee = drag.moved ? { x0: drag.x0, y0: drag.y0, x1: p.x, y1: p.y } : null;
      drawTimeline();
      return;
    }

    tlAlt = e.altKey;
    let G = tlGeom(); if (!G) return;
    const dy = p.y - drag.y0;
    if (Math.abs(p.x - drag.x0) > 2 || Math.abs(dy) > 2) drag.moved = true;
    // 拖到时间线边缘时自动滚动，长片也能一口气拖过去
    const edge = 26;
    const sl0 = scroll.scrollLeft;
    if (p.x > G.vw - edge) scroll.scrollLeft += Math.min(22, p.x - (G.vw - edge));
    else if (p.x < TL.labelW + edge) scroll.scrollLeft = Math.max(0, scroll.scrollLeft - Math.min(22, TL.labelW + edge - p.x));
    if (scroll.scrollLeft !== sl0) G = tlGeom() || G;
    const dt = G.unX(p.x) - drag.t0;
    const h = drag.hit, b = drag.base;

    if (h.kind === 'text') {
      if (!drag.frozen) { freezeTextTiming(); drag.frozen = true; }
      const i = h.i;
      const T = S.project.timing;
      const ln = S.plan.lines[i];
      let s0 = b.start, e0 = b.end;
      if (h.edge === 'body') {
        s0 = J.clamp(magSnapSpan(b.start + dt, b.dur, { kind: 'text', i }), 0, Math.max(0, G.dur - 0.3));
        e0 = s0 + b.dur;                       // 整块平移，长度不变
      } else if (h.edge === 'right') {
        e0 = Math.max(b.start + 0.3, magSnapSpan(b.end + dt, 0, { kind: 'text', i }));
      } else {
        s0 = J.clamp(magSnapSpan(b.start + dt, 0, { kind: 'text', i }), 0, b.end - 0.3);
      }
      T.lineTimes[i] = +s0.toFixed(3);
      T.lineEnds[i] = +e0.toFixed(3);
      T.lineDurs[i] = +Math.max(0.3, e0 - s0).toFixed(3);
      if (ln) { ln.start = s0; ln.visEnd = e0; ln.end = Math.max(e0, ln.end); }   // 时间线立刻跟着手走
      queueTextReplan();
      S.need = true;
    } else if (h.kind === 'media') {
      const m = S.media[h.i];
      if (!m) { drag = null; return; }
      if (h.edge === 'body') {
        const laneDelta = Math.round(dy / drag.laneH);
        if (drag.group && drag.group.length > 1) {
          const ex = drag.group.map(g => ({ kind: 'media', i: S.media.indexOf(g.m) })).filter(x => x.i >= 0);
          const snapped = magSnapSpan(b.start + dt, b.dur, ex);
          const delta = snapped - b.start;
          for (const g of drag.group) {
            g.m.start = J.clamp(g.start + delta, 0, Math.max(0, G.dur - 0.2));
            g.m.lane = J.clamp(g.lane + laneDelta, 0, TL.maxLane);
          }
        } else {
          m.start = J.clamp(magSnapSpan(b.start + dt, b.dur, { kind: 'media', i: h.i }), 0, Math.max(0, G.dur - 0.2));
          // 上下拖动换轨道
          m.lane = J.clamp(drag.lane0 + laneDelta, 0, TL.maxLane);
          if (drag.slot && m.kind !== 'video' && !m.spanSlot) snapSlotLive(m);   // 普通图片融在版式里：吸到落点那一句；视频/跨句素材保持自由时长
        }
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
  });

  const end = e => {
    if (drag && drag.marquee) {
      const G = tlGeom();
      if (drag.moved && G) {
        const r = { x0: Math.min(drag.x0, drag.x1), y0: Math.min(drag.y0, drag.y1), x1: Math.max(drag.x0, drag.x1), y1: Math.max(drag.y0, drag.y1) };
        const list = marqueePick(G, r);
        tlSetSelection(list, list.length ? list[list.length - 1] : null);
        toast(list.length ? '框选了 ' + list.length + ' 段 · Delete 删除选中的素材 / Ctrl+点击 追加' : '框选没有选中任何东西');
      } else {
        tlSetSelection([], null);
        if (G) seek(G.unX(local(e).x));
      }
      tlMarquee = null;
      drag = null;
      cv.style.cursor = 'default';
      drawTimeline();
      try { cv.releasePointerCapture(e.pointerId); } catch (err) {}
      return;
    }
    if (drag && (drag.moved || drag.kfDrag)) setTimeout(commit, 60);
    if (drag && drag.hit) {
      const h = drag.hit;
      if (h.kind === 'text') {
        if (drag.moved) flushTextReplan();          // 松手：用最终时间重排一次画面
      } else if (h.kind === 'media' && drag.moved && drag.slot) {
        dropSlotClip(S.media[h.i]);              // 松手：素材落在哪一句，就绑到哪一句
      } else if (h.kind === 'media' && drag.moved) {
        const m = S.media[h.i];
        if (m && m.kind === 'video' && !m.inLayout) {
          // 自由视频拖到有版式的区间：自动嵌进覆盖到的每一句
          const lines = spanSlotTo(m);
          if (lines.length) {
            replan(); drawTimeline(); syncMediaList(); syncMediaInsp();
            toast('视频已嵌进 ' + lines.length + ' 句的卡片 · 按时间线连续播放');
          }
        }
      }
    }
    drag = null;
    tlSnapGuide = null; tlSnapLabel = '';
    tlMarquee = null;
    cv.style.cursor = 'default';
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
    snapTag.textContent = S.snap ? '吸附素材' : '自由';
    toast(S.snap ? '吸附：素材边缘 / 文字块 / 播放头' : '完全自由，不吸附（Alt 也可以临时关掉）');
  };
  const beatTag = $('#tlBeatTag');
  if (beatTag) beatTag.onclick = () => {
    S.snapBeat = !S.snapBeat;
    beatTag.classList.toggle('off', !S.snapBeat);
    toast(S.snapBeat ? '额外吸附节拍：拖动时也会吸到拍点' : '不再吸附节拍，只吸素材 / 文字块 / 播放头');
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
    await importDrop(e.dataTransfer, { start: t });
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
    S.audioFile = file;                 // 存工程时要把音频原文件一起打包
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
    TL.multi = S.mediaSel >= 0 ? [{ kind: 'media', i: S.mediaSel }] : [];
    tlMarquee = null;
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
const AUD_EXT = /\.(mp3|wav|m4a|aac|ogg|flac|opus|aiff?|wma)$/i;
const SUB_EXT = /\.(srt|lrc|vtt|txt)$/i;
const isImageFile = f => !!f && (/^image\//.test(f.type || '') || IMG_EXT.test(f.name || ''));
const isVideoFile = f => !!f && (/^video\//.test(f.type || '') || VID_EXT.test(f.name || ''));
const isAudioFile = f => !!f && (/^audio\//.test(f.type || '') || AUD_EXT.test(f.name || ''));
const isSubFile = f => !!f && SUB_EXT.test(f.name || '');
const isMediaFile = f => isImageFile(f) || isVideoFile(f);
// 文件夹里只认真正能用的：图片 / 视频 / 音频 / srt·lrc·vtt（.txt 太容易误伤，拖文件夹时不算）
const isFolderFile = f => isMediaFile(f) || isAudioFile(f) || /\.(srt|lrc|vtt)$/i.test(f.name || '');
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
    TL.multi = [{ kind: 'media', i: S.mediaSel }];
    applyDefaultLook(m, S.media.length - 1);
    // 视频整段铺开（可选项；默认关，视频会像图片一样先尝试嵌进版式）
    // A video dropped in "slot" mode must go into the current line's stage.
    // The old global "video spans the song" option used to bypass binding and
    // was the reason a fresh video looked like a dumb full-screen background.
    const spanVideo = a.kind === 'video' && opt.forceSlot !== true && opt.videoSpan === true && S.beatCfg.videoSpan === true;
    if (spanVideo) {
      m.inLayout = false; m.line = null; m.slotName = null;
      m.loop = false;
      m.trim = 0;
      m.trimEnd = +(a.dur || m.dur).toFixed(3);
      m.dur = J.clamp(a.dur || m.dur, 0.3, Math.max(0.3, planDur - m.start));
      autoFit(m, 'fit');
      m.blend = 0; m.react = 0; m.inM = 'fade';
      S.mediaSel = S.media.length - 1;
    } else if (opt.line != null && opt.line >= 0) {
      // 「进版式」：指定了歌词行 → 直接融进那一行的版式插槽（时间 = 这一句；这一句满了就往后一句）
      if (!bindSlot(m, opt.line, { slot: opt.slot, force: opt.forceSlot })) {
        // 视频：这一句放不了就退回自由层当背景（不模糊），不要跳到别的句子；图片仍按老规矩往后找空位
        if (a.kind !== 'video') {
          const nl = nextLineAfter(opt.line);
          if (nl >= 0) bindSlot(m, nl, { slot: opt.slot, force: opt.forceSlot });
        }
      }
      S.mediaSel = S.media.length - 1;
    }
    m.lane = freeLane(m);
    S.need = true;
    if (!opt.batch) { syncMediaList(); drawTimeline(); }   // 批量导入时先不重画，全部读完再统一刷新
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
  const list = sortDropFiles([...files]).filter(isMediaFile);
  if (!list.length) return 0;
  const total = list.length;
  let t = Math.max(0, +(opt.start != null ? opt.start : S.t) || 0);
  let n = 0;
  const slotMode = opt.free !== true && S.beatCfg.layout === 'slot' && !!S.plan;
  let line = -1;
  if (slotMode) {
    // 播放头落在前奏 / 间奏里时，从后面第一句歌词开始贴，而不是全部退成自由层
    let c = J.cutAt(S.plan, t);
    if (!c || c.line < 0) c = S.plan.cuts.find(q => q.line >= 0 && q.end > t);
    if (c && c.line >= 0) line = c.line;
  }
  let bound = 0;
  let skipped = 0;
  let lineDone = false;
  for (let idx = 0; idx < total; idx++) {
    if (slotMode && lineDone) { skipped = total - idx; break; }   // 歌词行用完了：别再堆到片尾
    const f = list[idx];
    if (total > 6 && (idx === 0 || (idx + 1) % 6 === 0)) {
      toast('正在排入素材 ' + (idx + 1) + ' / ' + total + '…');
      await new Promise(r => setTimeout(r, 0));      // 让进度提示先刷出来
    }
    const m = await loadMediaFile(f, { start: t, after: n > 0, batch: total > 1, line: slotMode && line >= 0 ? line : -1, forceSlot: slotMode });
    if (m) {
      n++;
      t = m.start + m.dur;
      if (m.inLayout) {
        bound++;
        line = nextLineAfter(m.line);
        if (line < 0) lineDone = true;
      } else if (m.kind === 'video' && S.beatCfg.videoSpan !== false) {
        // 视频按原片长铺开：后面的图从视频结束处那一段歌词继续贴
        const c = S.plan ? J.cutAt(S.plan, m.start + m.dur + 0.01) : null;
        line = c && c.line >= 0 ? c.line : -1;
        if (line < 0) lineDone = true;
      } else if (slotMode && line >= 0) {
        line = nextLineAfter(line);
        if (line < 0) lineDone = true;
      }
    }
  }
  if (n) {
    if (bound) replan();                 // 让这些行换成能放素材的版式（并重新贴合时间）
    S.need = true;
    syncMediaState();
    drawTimeline();
    commit();
    const head = opt.folder ? '文件夹：' : '';
    const capNote = opt.capped ? ' · 已到 ' + FOLDER_MAX + ' 个上限，先排这些' : '';
    if (skipped) {
      toast(head + '已排 ' + n + ' 个素材 · ' + skipped + ' 个没排（歌词行不够；把「版式」改成自由层就能按顺序全排）' + capNote);
    } else if (bound) {
      const info = slotInfoOf(S.media[S.mediaSel] || null);
      toast(head + '已融入 ' + bound + ' 个版面位' + (info && info.has ? ' · ' + info.tid : '') + ' · 时长跟着这一句走' + capNote);
    } else {
      toast(head + '加入 ' + n + ' 个素材 · 已按顺序排好' + capNote + ' · 选中后可以打关键帧 / 套动画');
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

/* ─────────────────── 文件夹：整个拖进来，自动排进时间线 ───────────────────
   浏览器拖放普通文件时只会给文件列表；文件夹必须通过 webkitGetAsEntry()
   一层一层读。这里把所有文件递归读出来，按「相对路径」自然排序
   （1、2、10 而不是 1、10、2），再交给 addImageFiles 一张接一张排。
   图片 / GIF / 视频之外，文件夹里的音频与 srt / lrc 也会自动认出来。 */

const FOLDER_MAX = 300;                 // 一次最多排多少个，防止误拖整个硬盘
const DROP_PATH_KEY = '__dropPath';

function isJunkName(n) {
  n = String(n || '');
  return !n || n[0] === '.' || /^~\$/i.test(n) || /^(thumbs\.db|desktop\.ini)$/i.test(n);
}

function readDirEntries(reader) {
  return new Promise((resolve, reject) => {
    const out = [];
    const next = () => reader.readEntries(batch => {
      if (!batch || !batch.length) return resolve(out);
      out.push(...batch);
      next();                              // readEntries 一次最多给 100 个，要反复读到空
    }, reject);
    next();
  });
}

function fileOfEntry(en) {
  return new Promise(resolve => {
    try { en.file(f => resolve(f), () => resolve(null)); } catch (e) { resolve(null); }
  });
}

async function walkEntry(en, out, depth) {
  if (!en || out.length >= FOLDER_MAX || depth > 16) return;
  if (en.isFile) {
    const f = await fileOfEntry(en);
    if (f && !isJunkName(f.name) && isFolderFile(f)) {
      try { f[DROP_PATH_KEY] = en.fullPath || f.name; } catch (e) { /* File 不可写就退回按名字排 */ }
      out.push(f);
    }
    return;
  }
  if (!en.isDirectory || isJunkName(en.name)) return;
  let kids = [];
  try { kids = await readDirEntries(en.createReader()); } catch (e) { return; }
  for (const k of kids) {
    if (out.length >= FOLDER_MAX) break;
    await walkEntry(k, out, depth + 1);
  }
}

const NAT_SORT = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });
const dropPath = f => f[DROP_PATH_KEY] || f.webkitRelativePath || f.name || '';
function sortDropFiles(files) {
  return [...files].sort((a, b) => NAT_SORT.compare(dropPath(a), dropPath(b)));
}

/* 从一次拖放里拿到文件：普通文件直接用，文件夹就递归读 */
async function filesFromDrop(dt) {
  const items = dt ? [...(dt.items || [])] : [];
  const entries = [];
  for (const it of items) {
    if (it.kind !== 'file' || !it.webkitGetAsEntry) continue;
    let en = null;
    try { en = it.webkitGetAsEntry(); } catch (e) { en = null; }
    if (en) entries.push(en);
  }
  const folder = entries.some(en => en.isDirectory);
  if (!folder) return { files: [...((dt && dt.files) || [])], folder: false, capped: false };

  const out = [];
  for (const en of entries) {
    await walkEntry(en, out, 0);
    if (out.length >= FOLDER_MAX) break;
  }
  return { files: sortDropFiles(out), folder: true, capped: out.length >= FOLDER_MAX };
}

/* 拖放的统一入口：先读文件夹，再分派给 dropFiles */
async function importDrop(dt, opt = {}) {
  let got;
  try { got = await filesFromDrop(dt); } catch (e) {
    console.error(e);
    toast('文件夹读不出来：' + (e && e.message || e) + '（用 Chrome / Edge 试试，或点「文件夹」按钮）');
    return 0;
  }
  if (!got.files.length) {
    toast(got.folder ? '这个文件夹里没有能用的素材（图片 / GIF / 视频 / 音频 / srt / lrc）' : '没有读到文件');
    return 0;
  }
  if (got.folder) {
    toast('文件夹：找到 ' + got.files.length + ' 个素材，正在按文件名顺序排进时间线…');
    await new Promise(r => setTimeout(r, 40));      // 先把提示画出来，再开始解码
  }
  return dropFiles(got.files, Object.assign({}, opt, { folder: got.folder, capped: got.capped }));
}

/* 拖进来的文件：音频 / 字幕 / 图片 / 视频各归各位 */
async function dropFiles(files, opt = {}) {
  const all = sortDropFiles([...files]);
  const audio = all.find(isAudioFile);
  // 文件夹里常混着 readme.txt / notes.txt：只在拖单个文件时把 .txt 当歌词，
  // 拖文件夹时只认 srt / lrc / vtt，免得随手替换掉用户已经排好的歌词。
  const sub = opt.folder
    ? all.find(f => /\.(srt|lrc|vtt)$/i.test(f.name || ''))
    : all.find(isSubFile);
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
  const a0 = S.assets[m.assetId] || {};
  const d = (m.el && isFinite(m.el.duration) && m.el.duration > 0) ? m.el.duration : (a0.dur || 1);
  const a = J.clamp(m.trim || 0, 0, Math.max(0, d - 0.05));
  const b = J.clamp(m.trimEnd != null ? +m.trimEnd : d, a + 0.02, d);
  const span = Math.max(0.02, b - a);
  if (m.loop === false) return Math.min(b - 0.001, a + Math.max(0, lt));
  return a + (Math.max(0, lt) % span);
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

/* 模糊底：把素材缩到很小的画布再拉满 = 剪映那种「背景模糊」，画面永远没有黑边
   amt 0~1：越大缩得越小，拉回来越糊 */
function blurBackdrop(m, src, W, H, amt) {
  const q = J.clamp(amt == null ? 0.5 : amt, 0, 1);
  const bw = Math.max(10, Math.round(J.lerp(96, 11, q))), bh = Math.max(8, Math.round(bw * H / W));
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
/* 嵌进版式的视频：在纸片后面铺一层同一帧的模糊视频（视频背景），
   只做背景，不碰插槽里的画面；图片素材不铺。 */
function paintSlotBackdrop(env, m, lt) {
  const ctx = env.ctx, W = env.W, H = env.H;
  const k = (ctx.canvas.width || W) / W || 1;
  const img = sourceOf(m, lt);
  if (!img) return;
  const bf = blurBackdrop(m, img, W, H, m.bgBlur == null ? 0.6 : m.bgBlur);
  if (!bf) return;
  const scheme = env.sc || fallbackScheme();
  ctx.save();
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.globalAlpha = 0.84;
  try { ctx.drawImage(bf, 0, 0, W, H); } catch (e) { ctx.restore(); return; }
  ctx.globalAlpha = 0.30;
  ctx.fillStyle = scheme.bg; ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/* 视频背景模式：
   auto  = 有卡片时模糊视频、没卡片时视频原样
   blur  = 一律模糊视频背景
   sharp = 一律视频原样（有卡片时卡片仍画在视频上）
   site  = 不铺视频背景，用网站 / 版式原本的背景 */
function videoBgMode(m) {
  return m.bgMode || (m.slotBg === false ? 'site' : 'auto');
}
function paintVideoBg(env, m, lt, hasSlot) {
  const mode = videoBgMode(m);
  if (mode === 'site') return;
  const blur = mode === 'blur' || (mode === 'auto' && hasSlot);
  if (blur) paintSlotBackdrop(env, m, lt);
  else paintDirectMedia(env, m, lt);
}

/* 跨句 / 无插槽段落：不做模糊，直接铺在文字后面 */
function paintDirectMedia(env, m, lt) {
  const ctx = env.ctx, W = env.W, H = env.H;
  const k = (ctx.canvas.width || W) / W || 1;
  const img = sourceOf(m, lt);
  if (!img) return;
  const iw = m.iw || img.videoWidth || img.naturalWidth || img.width || 0;
  const ih = m.ih || img.videoHeight || img.naturalHeight || img.height || 0;
  if (!iw || !ih) return;
  const sc = Math.max(W / iw, H / ih);
  const dw = iw * sc, dh = ih * sc;
  ctx.save();
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.globalAlpha = J.clamp(evalProp(m, 'opacity', lt), 0, 1);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = S.playing ? 'medium' : 'high';
  try { ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh); } catch (e) {}
  ctx.restore();
}

function paintMedia(env, t, front) {
  if (!S.media.length) return;
  const ctx = env.ctx, W = env.W, H = env.H;
  const k = (ctx.canvas.width || W) / W || 1;
  const scheme = env.sc || fallbackScheme();
  const stagedCut = !front && env.cut && env.cut.stage;
  const T = S.project.timing || {};
  const bl = T.bpm > 0 ? 60 / T.bpm : 0, off = T.offset || 0;
  ctx.save();
  ctx.setTransform(k, 0, 0, k, 0, 0);
  // 轨道号小的在上面：倒着画，最后画的盖在最上层
  const list = S.media.slice().sort((a, b) => (b.lane | 0) - (a.lane | 0));
  for (const m of list) {
    if (m.inLayout && !m.orphan) {
      if (stagedCut && (m.line === env.cut.line || (m.spanSlot && m.spanLines && m.spanLines.includes(env.cut.line)))) continue;   // drawn by paintStageMedia
      // 视频嵌进版式时：有插槽的段落铺模糊视频背景；没有插槽的段落不模糊，直接压在文字后面
      if (!front && t >= m.start - 1e-4 && t <= m.start + m.dur + 1e-4) {
        const cut = env.cut;
        const hasSlot = !!(cut && cut.line >= 0 && J.LAYOUTS[cut.layout] && J.LAYOUTS[cut.layout].slot);
        if (m.kind === 'video') paintVideoBg(env, m, t - m.start, hasSlot);
        else if (!hasSlot) paintDirectMedia(env, m, t - m.start);
        // full-bleed material sits under type: a quiet colour scrim keeps the word readable
        if (!hasSlot) {
          ctx.save(); ctx.setTransform(k, 0, 0, k, 0, 0);
          ctx.globalAlpha = 0.30; ctx.fillStyle = scheme.bg; ctx.fillRect(0, 0, W, H);
          ctx.restore();
        }
      }
      continue;                       // 已经融进版式：由版式的插槽来画，绝不再当贴图压在卡片底下
    }
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
/* 嵌套舞台：把素材画成构图的一部分，而不是一整块背景板。
   版式 / 文字区由 engine/17_stage.js 决定，这里只负责把当前这一句的
   图片或视频裁进照片窗 / 竖窗 / 横幅 / 满幅。 */
function drawCover(ctx, img, iw, ih, x, y, w, h) {
  if (!iw || !ih || !(w > 0) || !(h > 0)) return;
  const sa = iw / ih, pa = w / h;
  let dw, dh, dx, dy;
  if (sa > pa) { dh = h; dw = h * sa; dx = x + (w - dw) / 2; dy = y; }
  else { dw = w; dh = w / sa; dx = x; dy = y + (h - dh) / 2; }
  try { ctx.drawImage(img, dx, dy, dw, dh); } catch (e) {}
}
function paintStageMedia(env, t) {
  const cut = env && env.cut, stage = cut && cut.stage, panel = stage && stage.panel;
  if (!panel || !S.media.length || cut.line < 0) return false;
  const m = S.media.find(x => x.inLayout && !x.orphan &&
    (x.line === cut.line || (x.spanSlot && x.spanLines && x.spanLines.includes(cut.line))) &&
    t >= x.start - 0.04 && t <= x.start + x.dur + 0.04);
  if (!m) return false;
  const img = sourceOf(m, t - m.start);
  if (!img) return false;
  const ctx = env.ctx, W = env.W, H = env.H, sc = env.sc || fallbackScheme();
  const iw = m.iw || img.videoWidth || img.naturalWidth || img.width || 0;
  const ih = m.ih || img.videoHeight || img.naturalHeight || img.height || 0;
  if (!iw || !ih) return false;
  const x = panel.x * W, y = panel.y * H, w = panel.w * W, h = panel.h * H;
  const u = Math.min(W, H);
  const line = env.plan && env.plan.lines && env.plan.lines[cut.line];
  const lt = Math.max(0, t - (line ? line.start : cut.start));
  const enterA = J.clamp((lt - 0.02) / 0.34);
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = enterA;

  if (stage.style === 'bleed') {
    drawCover(ctx, img, iw, ih, 0, 0, W, H);
    // a colour scrim + a side gradient: the type keeps a quiet column
    ctx.fillStyle = J.rgba(sc.bg, 0.30); ctx.fillRect(0, 0, W, H);
    const left = (stage.text ? stage.text.x : 0.08) < 0.5;
    const g = ctx.createLinearGradient(left ? 0 : W, 0, left ? W * 0.78 : W * 0.22, 0);
    g.addColorStop(0, J.rgba(sc.bg, 0.74)); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.restore();
    return true;
  }

  if (stage.style === 'band') {
    const edge = Math.max(2, u * 0.0025);
    drawCover(ctx, img, iw, ih, x, y, w, h);
    ctx.fillStyle = J.rgba(sc.bg, 0.12); ctx.fillRect(x, y, w, h);
    ctx.fillStyle = sc.accent; ctx.fillRect(x + w * 0.08, y + h - edge * 1.5, w * 0.16, edge);
    ctx.restore();
    return true;
  }

  // card / window: a printed panel with the photo inset, never a sticker pile
  const isLight = J.lum(sc.bg) > 0.5;
  const paper = isLight ? J.mix(sc.bg, '#FFFFFF', 0.58) : J.mix(sc.bg, '#FFFFFF', 0.12);
  const radius = stage.style === 'window' ? Math.min(w, h) * 0.20 : Math.min(w, h) * 0.035;
  const inset = Math.min(w, h) * (stage.style === 'window' ? 0.035 : 0.045);
  ctx.shadowColor = 'rgba(0,0,0,0.28)'; ctx.shadowBlur = u * 0.045; ctx.shadowOffsetY = u * 0.016;
  ctx.fillStyle = paper;
  J.roundPath(ctx, x, y, w, h, radius); ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  const px = x + inset, py = y + inset, pw = w - inset * 2, ph = h - inset * 2;
  ctx.save();
  J.roundPath(ctx, px, py, pw, ph, Math.max(1, radius - inset * 0.35)); ctx.clip();
  drawCover(ctx, img, iw, ih, px, py, pw, ph);
  ctx.restore();
  ctx.strokeStyle = J.rgba(sc.fg, 0.15); ctx.lineWidth = Math.max(1, u * 0.0016);
  J.roundPath(ctx, px, py, pw, ph, Math.max(1, radius - inset * 0.35)); ctx.stroke();
  // one accent tick: a printer's mark, not scrapbooking
  ctx.fillStyle = sc.accent;
  ctx.fillRect(x + w * 0.07, y + h - inset * 0.55, w * 0.20, Math.max(2, u * 0.0032));
  ctx.restore();
  return true;
}

const drawMediaOverlay = (env, t) => paintMedia(env, t, true);    // 文字之上
const drawMediaUnder = (env, t) => { paintStageMedia(env, t); paintMedia(env, t, false); }; // 文字之下

/* ─────────────────── 素材插槽：让素材真的「进」到版面里 ───────────────────
   版式（信纸 / 拍立得 / 明信片 / 邮票…）在画自己那张纸的时候留了插槽
   （engine/12_slot.js）。素材一旦「融入」某一行：
   · 由那一行的版式来画 —— 纸怎么入场、怎么歪、怎么退场，图就跟着怎么走
   · 时间严格等于这一句歌词，整片重排后自动重新贴合（不再随便停在时间线上）
   · 关键帧仍然能用，只是变成「在这张纸里」的缩放 / 微移 / 微转        */

const LAYOUT_CN = k => (J.LAYOUTS[k] && (J.LAYOUTS[k].cn || J.LAYOUTS[k].name)) || k;

function cutOfLine(line) {
  if (!S.plan || line == null || line < 0) return null;
  let first = null, start = Infinity, end = -Infinity;
  for (const c of S.plan.cuts) {
    if (c.line !== line) continue;
    if (!first) first = c;
    start = Math.min(start, c.start); end = Math.max(end, c.end);
  }
  if (!first) return null;
  // A MAD line is made of word cuts, so use the whole line for the material's
  // lifetime and for the slot geometry — not the first 0.2 s word.
  return Object.assign({}, first, { start, end, dur: Math.max(0.05, end - start) });
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
  const lay = J.LAYOUTS[cut.layout];
  const hasSlot = !!(lay && lay.slot);
  // 批量导入时先「占位」：当前这一句可能还没被排成带插槽的版式，
  // 但先把行号占住，整批读完后统一 replan，planner 会给这些行挑带插槽的版式。
  if (!hasSlot && !opts.force) return null;
  const name = opts.slot || (hasSlot ? freeSlotName(line, cut.layout, m) : 'photo');
  if (!name) return null;
  m.inLayout = true;
  m.orphan = false;
  m.line = line | 0;
  m.spanSlot = false; m.spanLines = null;
  m.slotName = name;
  m.scale = 1; m.x = 0.5; m.y = 0.5; m.rot = 0; m.opacity = 1;
  m.blend = 0; m.border = 0; m.radius = 0; m.shadow = 0; m.fill = 'none'; m.react = 0; m.inM = 'none';
  m.front = false; m.fade = false; m.kf = newKf();
  m.layout = 'slot';
  if (m.kind === 'video') {
    m.slotFit = 'cover';
    if (m.bgMode == null) m.bgMode = 'auto';
    if (m.bgBlur == null) m.bgBlur = 0.6;
  }
  m.start = cut.start;
  m.dur = Math.max(0.2, cut.end - cut.start);
  if (!Array.isArray(S.project.slotLines)) S.project.slotLines = [];
  if (!S.project.slotLines.includes(m.line)) S.project.slotLines.push(m.line);
  return m;
}

function unbindSlot(m) {
  m.inLayout = false; m.orphan = false; m.line = null; m.slotName = null;
  m.spanSlot = false; m.spanLines = null;
  if (m.layout === 'slot') m.layout = 'auto';
  syncSlotLines();
  return m;
}

/* 拖完松手：把已经融进版式的素材重新绑到「落点那一句」（不重置大小 / 位置，只换句子和时长） */
function attachSlot(m, cut) {
  const names = slotNamesOf(cut.layout);
  const keep = m.slotName && names.includes(m.slotName) && freeSlotName(cut.line, cut.layout, m) === m.slotName;
  m.slotName = keep ? m.slotName : (freeSlotName(cut.line, cut.layout, m) || names[0] || 'photo');
  m.inLayout = true; m.orphan = false; m.line = cut.line | 0;
  m.spanSlot = false; m.spanLines = null;
  m.start = cut.start;
  m.dur = Math.max(0.2, cut.end - cut.start);
  if (!Array.isArray(S.project.slotLines)) S.project.slotLines = [];
  if (!S.project.slotLines.includes(m.line)) S.project.slotLines.push(m.line);
  return m;
}

/* 拖动中：起点落在哪一句，就先把时长贴到那一句（松手再真正绑） */
function snapSlotLive(m) {
  if (!S.plan) return;
  const cut = J.cutAt(S.plan, m.start + 0.005);
  if (!cut || cut.line < 0) return;
  const L = J.LAYOUTS[cut.layout];
  if (!L || !L.slot) return;
  m.start = cut.start;
  m.dur = Math.max(0.2, cut.end - cut.start);
}

/* 这一段时间覆盖了哪些歌词行（用于「一个视频跨好几句、每句都嵌进卡片」） */
function coveredLines(start, end) {
  const out = [];
  if (!S.plan) return out;
  for (const c of S.plan.cuts || []) {
    if (c.line == null || c.line < 0) continue;
    if (c.end > start + 0.05 && c.start < end - 0.05 && !out.includes(c.line)) out.push(c.line);
  }
  return out.sort((a, b) => a - b);
}

/* 把一段素材按它现在的时间范围，嵌进覆盖到的每一句版式里。
   · 时间不再被某一句锁死：拉多长、从哪里开始，就覆盖到哪些卡片
   · 视频用同一个元素连续播放（paintSlot 按全局时间取帧），不会每句重头开始
   · 没有任何可嵌套的行时退回自由层，不模糊，直接压文字后面 */
function slotLook(m) {
  m.scale = 1; m.x = 0.5; m.y = 0.5; m.rot = 0; m.opacity = 1;
  m.blend = 0; m.border = 0; m.radius = 0; m.shadow = 0; m.fill = 'none'; m.react = 0; m.inM = 'none';
  m.front = false; m.fade = false; m.kf = newKf();
  m.layout = 'slot';
  if (m.kind === 'video') {
    if (m.slotFit == null) m.slotFit = 'cover';
    if (m.bgMode == null && m.slotBg !== false) m.bgMode = 'auto';
    if (m.bgBlur == null) m.bgBlur = 0.6;
  }
}
function spanSlotTo(m) {
  if (!m || !S.plan) return [];
  const lines = coveredLines(m.start, m.start + m.dur);
  if (!lines.length) { unbindSlot(m); return []; }
  if (!m.inLayout) slotLook(m);
  m.inLayout = true; m.orphan = false;
  m.spanSlot = true; m.spanLines = lines; m.line = lines[0];
  if (!m.slotName) m.slotName = 'photo';
  syncSlotLines();
  return lines;
}

function dropSlotClip(m) {
  if (!m || !S.plan) return;
  // 已经在版式里 / 视频：保持当前 start + dur，覆盖到哪几句就嵌进哪几句
  if (m.inLayout || m.kind === 'video') {
    const lines = spanSlotTo(m);
    replan();
    if (lines.length && !m.orphan) toast('已嵌进第 ' + (lines[0] + 1) + (lines.length > 1 ? '–' + (lines[lines.length - 1] + 1) : '') + ' 句 · 视频连续播放');
    else toast('这里没有能放素材的版式 · 已退回自由层当背景');
    return;
  }
  const cut = J.cutAt(S.plan, m.start + 0.005);
  const L = cut && cut.line >= 0 ? J.LAYOUTS[cut.layout] : null;
  if (L && L.slot) {
    const moved = m.line !== cut.line || m.orphan;
    attachSlot(m, cut);
    replan();
    if (moved) toast('已吸附到第 ' + (cut.line + 1) + ' 句 · 时长跟着这一句走');
    return;
  }
  unbindSlot(m);
  replan();
  toast('这里没有能放素材的版式 · 先当自由层放着，选中后还能「放进这一句」');
}

/* 由 S.media 反推「哪几行要版式插槽」，planner 会优先给这些行挑能放素材的版式 */
function syncSlotLines() {
  const lines = [];
  for (const m of S.media) {
    if (!m.inLayout || m.orphan) continue;
    const ls = (m.spanSlot && Array.isArray(m.spanLines) && m.spanLines.length)
      ? m.spanLines
      : (m.line != null ? [m.line] : []);
    for (const l of ls) if (!lines.includes(l)) lines.push(l);
  }
  lines.sort((a, b) => a - b);
  S.project.slotLines = lines;
  return lines;
}

/* 每次重排之后调用：把融入版式的素材重新贴到它那一句上（整片重排、改风格、改时间都跟得上） */
function syncSlotClips() {
  if (!S.plan) return;
  if (!S.media.length) { if (Array.isArray(S.project.slotLines) && S.project.slotLines.length) S.project.slotLines = []; return; }
  for (const m of S.media) {
    if (!m.inLayout) continue;
    if (m.spanSlot) {                                 // 跨句素材：时间由自己决定，只重算覆盖到哪几句
      const lines = coveredLines(m.start, m.start + m.dur);
      m.spanLines = lines;
      let hasSlot = false;
      for (const l of lines) { const c = cutOfLine(l), L = c && J.LAYOUTS[c.layout]; if (L && L.slot) { hasSlot = true; break; } }
      m.orphan = !lines.length || !hasSlot;           // 一段都嵌不进去：退回自由层（视频不模糊，直接压文字后面）
      if (lines.length) m.line = lines[0];
      if (!m.slotName) m.slotName = 'photo';
      continue;
    }
    const cut = cutOfLine(m.line);
    const L = cut && J.LAYOUTS[cut.layout];
    if (cut && (cut.layout === 'mad' || cut.layout === 'sentence' || cut.layout === 'stage' || cut.stage)) {
      // word / sentence / stage layouts have no classic slot: the clip is
      // painted by paintStageMedia (card, window, band or full bleed)
      m.orphan = false;
      m.start = cut.start;
      m.dur = Math.max(0.2, cut.end - cut.start);
      continue;
    }
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
  const live = c => c.inLayout && !c.orphan && t >= c.start - 0.03 && t <= c.start + c.dur + 0.03 &&
    (c.spanSlot ? true : c.line === cut.line);
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
  const fit = m.slotFit === 'contain' || m.slotFit === 'cover' ? m.slotFit : slot.fit;
  const fitK = fit === 'contain' ? Math.min(vw / iw, vh / ih) : Math.max(vw / iw, vh / ih);
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
  if (fit === 'contain') { ctx.globalAlpha = op; ctx.fillStyle = slot.paper; ctx.fillRect(0, 0, slot.w, slot.h); }
  try { if (tone.desat > 0.01) ctx.filter = 'saturate(' + (1 - tone.desat).toFixed(2) + ')'; } catch (e) {}
  ctx.globalAlpha = op;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = S.playing ? 'medium' : 'high';
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
  if (m.spanSlot && m.spanLines && m.spanLines.length) {
    const a = m.spanLines[0], b = m.spanLines[m.spanLines.length - 1];
    return {
      line: a, layout: null, has: true,
      tid: '第 ' + (a + 1) + (b > a ? '–' + (b + 1) : '') + ' 句 · 共 ' + m.spanLines.length + ' 句 · ' + (m.kind === 'video' ? '视频连续播放' : '跨句嵌进卡片'),
    };
  }
  const cut = cutOfLine(m.line);
  if (!cut) return { line: m.line, layout: null, tid: '这一句已经不在时间线上了' };
  if (cut.stage) {
    return {
      line: m.line, layout: cut.layout, has: true,
      tid: '第 ' + (m.line + 1) + ' 句 · 舞台「' + (cut.stage.key || '') + '」',
    };
  }
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
      const multi = tlHasSel('media', i);
      item.className = 'media-item' + ((S.mediaSel === i || multi) ? ' on' : '') + (multi ? ' multi' : '');
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
      empty.textContent = '还没有素材。点上面的「选择」/「文件夹」，或者把图片、GIF、视频、整个文件夹直接拖进时间线或画面里。';
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
  TL.multi = [{ kind: 'media', i }];
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
  TL.multi = (TL.multi || [])
    .filter(s => !(s.kind === 'media' && s.i === i))
    .map(s => s.kind === 'media' && s.i > i ? { kind: 'media', i: s.i - 1 } : s);
  if (S.mediaSel >= S.media.length) S.mediaSel = S.media.length - 1;
  if (TL.sel && TL.sel.kind === 'media' && TL.sel.i === i) TL.sel = null;
  if (!TL.multi.length) S.mediaSel = -1;
  syncMediaList();
  drawTimeline();
  S.need = true;
  commit();
  toast('已删除素材 · 按 Ctrl+Z 可以撤销');
}

/* 选中素材的小面板：显示的是「播放头所在时刻」的值（有关键帧时会跟着变） */
let INSP_TAB = 'basic';
let INSP_SEL = -1;
function showInspTab(name) {
  const box = $('#mediaInsp');
  if (!box) return;
  const m = S.media[S.mediaSel];
  if (name === 'video' && (!m || m.kind !== 'video')) name = 'basic';
  INSP_TAB = name;
  $$('#mediaInsp .mi-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  $$('#mediaInsp .mi-pane').forEach(p => p.classList.toggle('on', p.dataset.pane === name));
}

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
  const th = $('#miThumb');
  if (th) {
    const u = m.url || '';
    if (th.dataset.src !== u) {
      th.dataset.src = u;
      th.innerHTML = '';
      if (u) { const im = document.createElement('img'); im.src = u; im.alt = ''; th.appendChild(im); }
      else th.textContent = '▣';
    }
  }
  const kd = $('#miKind'); if (kd) kd.textContent = KIND_TAG[m.kind] || '素材';
  if (INSP_SEL !== S.mediaSel) { INSP_SEL = S.mediaSel; INSP_TAB = 'basic'; }
  const vt = $('#miTabVideo'); if (vt) vt.hidden = m.kind !== 'video';
  if (m.kind !== 'video' && INSP_TAB === 'video') INSP_TAB = 'basic';
  showInspTab(INSP_TAB);
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
    if (inSlot) {
      if (m.spanSlot && m.spanLines && m.spanLines.length) {
        const a = m.spanLines[0], b = m.spanLines[m.spanLines.length - 1];
        sinfo.textContent = '第 ' + (a + 1) + (b > a ? '–' + (b + 1) : '') + ' 句 · ' + m.spanLines.length + ' 句';
      } else {
        sinfo.textContent = '第 ' + ((m.line | 0) + 1) + ' 句';
      }
    } else {
      sinfo.textContent = m.inLayout ? '这一句没有插槽' : '自由层';
    }
  }
  const sfit = $('#miSlotFit');
  if (sfit) {
    sfit.value = (m.slotFit === 'cover' || m.slotFit === 'contain') ? m.slotFit : 'auto';
    sfit.disabled = !inSlot;
  }
  // 融进版式之后：版式内的位置交给插槽；视频 / 跨句素材仍然可以改起点和时长
  const tr = $('#miTimeRow');
  if (tr) tr.hidden = inSlot && !(m.spanSlot || m.kind === 'video');
  ['#miStart', '#miDur'].forEach(sel => {
    const el = $(sel); if (el) el.disabled = inSlot && !(m.spanSlot || m.kind === 'video');
  });
  ['#miFront', '#miFit', '#miCenter', '#miUp', '#miDown'].forEach(sel => {
    const el = $(sel); if (el) { el.disabled = inSlot; el.hidden = inSlot; }
  });
  // 视频专属：入点 / 出点 / 整段铺开
  const vr = $('#miVideoRow');
  if (vr) vr.hidden = m.kind !== 'video';
  if (m.kind === 'video') {
    const av = S.assets[m.assetId] || {};
    const sd = +av.dur || 0;
    const a0 = J.clamp(+m.trim || 0, 0, Math.max(0, sd - 0.05));
    const b0 = J.clamp(m.trimEnd != null ? +m.trimEnd : sd, a0 + 0.02, Math.max(a0 + 0.02, sd));
    setVal('#miTrim', a0.toFixed(2));
    setVal('#miTrimEnd', b0.toFixed(2));
    const meta = $('#miVidMeta');
    if (meta) meta.textContent = sd > 0 ? '源 ' + sd.toFixed(1) + 's · 选段 ' + Math.max(0, b0 - a0).toFixed(1) + 's' : '—';
    const lp = $('#miLoop'); if (lp && lp.checked !== (m.loop !== false)) lp.checked = m.loop !== false;
    const bgm = $('#miVidBgMode');
    const bgs = $('#miVidBlur');
    const bgOn = !!(m.inLayout && !m.orphan);
    if (bgm) { bgm.value = videoBgMode(m); bgm.disabled = !bgOn; }
    if (bgs) {
      const v = Math.round((m.bgBlur == null ? 0.6 : m.bgBlur) * 100);
      bgs.value = v; bgs.disabled = !bgOn;
      const o = $('#oVidBlur'); if (o) o.textContent = v + '%';
    }
    const wb = $('#miVidWhole'); if (wb) wb.disabled = !(sd > 0);
  }
  // 关键帧
  const ak = $('#miAutoKey'); if (ak && ak.checked !== S.autoKey) ak.checked = S.autoKey;
  const info = $('#kfInfo');
  if (info) {
    const ts = kfTimes(m);
    const here = ts.some(x => Math.abs(x - (S.t - m.start)) < 0.04);
    info.textContent = ts.length ? ts.length + ' 个关键帧' + (here ? ' · 当前' : '') : '还没有关键帧';
  }
}

function syncMediaState() { syncMediaList(); }

function bindMediaCard() {
  const cur = () => S.media[S.mediaSel];
  const touch = () => { S.need = true; drawTimeline(); syncMediaInsp(); };
  $$('#mediaInsp .mi-tab').forEach(b => { b.onclick = () => showInspTab(b.dataset.tab); });
  const mc = $('#miClose');
  if (mc) mc.onclick = () => tlSetSelection([], null);
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
  const sfit = $('#miSlotFit');
  if (sfit) sfit.onchange = () => {
    const m = cur(); if (!m) return;
    m.slotFit = sfit.value === 'auto' ? null : sfit.value;
    S.need = true; commit();
  };
  const inn = $('#miIn');
  if (inn) inn.onchange = () => { const m = cur(); if (!m) return; m.inM = inn.value; touch(); commit(); };
  const num = (sel, fn) => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener('change', () => { const m = cur(); if (!m) return; fn(m, +el.value); touch(); commit(); });
  };
  const slotTimeChanged = (m) => {
    if (!m || !m.inLayout) return;
    const lines = spanSlotTo(m);
    if (!lines.length) unbindSlot(m);
    replan(); drawTimeline(); syncMediaList(); syncMediaInsp();
  };
  num('#miStart', (m, v) => { if (isFinite(v)) { m.start = J.clamp(v, 0, Math.max(0, (S.plan ? S.plan.duration : 600) - 0.2)); slotTimeChanged(m); } });
  num('#miDur', (m, v) => { if (isFinite(v)) { m.dur = J.clamp(v, 0.3, 600); slotTimeChanged(m); } });
  num('#miTrim', (m, v) => {
    const a = S.assets[m.assetId];
    if (isFinite(v) && a && a.dur) {
      m.trim = J.clamp(v, 0, Math.max(0, a.dur - 0.1));
      if (m.trimEnd == null) m.trimEnd = a.dur;
      if (+m.trimEnd < m.trim + 0.2) m.trimEnd = Math.min(a.dur, m.trim + 0.2);
    }
  });
  num('#miTrimEnd', (m, v) => {
    const a = S.assets[m.assetId];
    if (isFinite(v) && a && a.dur) {
      m.trimEnd = J.clamp(v, (+m.trim || 0) + 0.2, a.dur);
    }
  });
  const vidBtn = (sel, fn) => {
    const el = $(sel); if (!el) return;
    el.onclick = () => {
      const m = cur(); if (!m || m.kind !== 'video') return;
      const a = S.assets[m.assetId] || {};
      const d = +a.dur || 0;
      if (!(d > 0)) { toast('这个视频还没读出长度，换 mp4 / webm 试试'); return; }
      const planDur = S.plan ? S.plan.duration : d;
      fn(m, d, planDur);
      S.mediaSel = S.media.indexOf(m);
      S.need = true; replan(); drawTimeline(); syncMediaList(); syncMediaInsp(); commit();
    };
  };
  vidBtn('#miVidIn', (m, d) => {
    const src = (+m.trim || 0) + (S.t - m.start);
    if (S.t < m.start - 0.02 || S.t > m.start + m.dur + 0.02) { toast('先把播放头挪到这个视频里，再取入点'); return; }
    m.trim = J.clamp(src, 0, Math.max(0, d - 0.2));
    if (+m.trimEnd < m.trim + 0.2) m.trimEnd = Math.min(d, m.trim + 0.2);
    toast('视频入点 = ' + m.trim.toFixed(2) + 's');
  });
  vidBtn('#miVidOut', (m, d) => {
    const src = (+m.trim || 0) + (S.t - m.start);
    if (S.t < m.start - 0.02 || S.t > m.start + m.dur + 0.02) { toast('先把播放头挪到这个视频里，再取出点'); return; }
    m.trimEnd = J.clamp(src, (+m.trim || 0) + 0.2, d);
    toast('视频出点 = ' + m.trimEnd.toFixed(2) + 's');
  });
  vidBtn('#miVidWhole', (m, d, planDur) => {
    m.trim = 0; m.trimEnd = d; m.loop = false;
    // 整段视频放得下就自动挪到放得下的位置（优先保留原来的起点）
    const st = Math.max(0, Math.min(m.start, planDur - d));
    m.start = st;
    m.dur = Math.max(0.3, Math.min(d, planDur - st));
    const lines = spanSlotTo(m);
    if (!lines.length) { unbindSlot(m); autoFit(m, 'fit'); m.blend = 0; m.react = 0; }
    toast(lines.length
      ? '已按原片长嵌进 ' + lines.length + ' 句的卡片：' + m.dur.toFixed(1) + 's 完整播放，不循环'
      : '没有可嵌套的版式，已退回自由层：' + m.dur.toFixed(1) + 's 完整播放');
  });
  // 铺满整首：不再是「垫在底下」，而是把这一段嵌进覆盖到的每一句卡片里
  const spanWhole = (m) => {
    const planDur = S.plan ? S.plan.duration : 10;
    m.start = 0; m.dur = Math.max(0.3, planDur);
    m.loop = true;
    const lines = spanSlotTo(m);
    if (!lines.length) { unbindSlot(m); autoFit(m, 'cover'); m.front = false; m.react = 0; }
    return lines;
  };
  vidBtn('#miVidAll', (m, d, planDur) => {
    const lines = spanWhole(m);
    toast(lines.length
      ? '视频已铺满整首，并嵌进 ' + lines.length + ' 句的卡片里（连续播放）'
      : '没有可嵌套的版式，已退回自由层当整首背景');
  });
  const act = (sel, fn) => { const el = $(sel); if (el) el.onclick = () => { const m = cur(); if (!m) return; fn(m); S.need = true; drawTimeline(); syncMediaList(); commit(); }; };
  act('#miFit', m => { autoFit(m, 'cover'); toast('铺满画面'); });
  act('#miCenter', m => { setProp(m, 'x', 0.5); setProp(m, 'y', 0.5); toast('回到画面中央'); });
  act('#miFront', m => { m.front = !m.front; toast(m.front ? '这个素材盖在歌词上面（贴纸）' : '这个素材压到歌词下面（背景）'); });
  act('#miUp', m => { m.lane = J.clamp((m.lane | 0) - 1, 0, TL.maxLane); toast('上移一层（更靠前）'); });
  act('#miDown', m => { m.lane = J.clamp((m.lane | 0) + 1, 0, TL.maxLane); toast('下移一层（更靠后）'); });
  const timeAll = $('#miTimeAll');
  if (timeAll) timeAll.onclick = () => {
    const m = cur(); if (!m) return;
    const lines = spanWhole(m);
    S.need = true; replan(); drawTimeline(); syncMediaList(); syncMediaInsp(); commit();
    toast(lines.length
      ? (m.kind === 'video' ? '视频' : '图片') + '已铺满整首，并嵌进 ' + lines.length + ' 句的卡片里'
      : '没有可嵌套的版式，已退回自由层当整首背景');
  };

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
  const bgm = $('#miVidBgMode');
  if (bgm) bgm.onchange = () => {
    const m = cur(); if (!m) return;
    m.bgMode = bgm.value; S.need = true; commit();
  };
  const bgs = $('#miVidBlur');
  if (bgs) {
    bgs.addEventListener('input', () => {
      const m = cur(); if (!m) return;
      m.bgBlur = +bgs.value / 100;
      const o = $('#oVidBlur'); if (o) o.textContent = bgs.value + '%';
      S.need = true;
    });
    bgs.addEventListener('change', commit);
  }

  // ── 导入时自动卡拍的设置 ──
  const cl = $('#cfgLen'), ci = $('#cfgIn'), cp = $('#cfgPulse');
  if (cl) cl.onchange = () => { S.beatCfg.len = cl.value; };
  if (ci) ci.onchange = () => { S.beatCfg.inAnim = ci.value; };
  if (cp) cp.onchange = () => { S.beatCfg.pulse = cp.checked; };
  const cvsp = $('#cfgVideoSpan');
  if (cvsp) {
    cvsp.checked = S.beatCfg.videoSpan !== false;
    cvsp.onchange = () => {
      S.beatCfg.videoSpan = cvsp.checked;
      toast(cvsp.checked ? '之后拖进来的视频会按原片长铺开（不锁进一句歌词）' : '之后拖进来的视频会融进歌词版式（时间跟着这一句）');
    };
  }
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
  $('#sumStyle').textContent = (STYLE_META[p.style] && STYLE_META[p.style][0]) || (st && st.name) || p.style;
  const ov = Object.keys(p.overrides || {}).filter(k => p.overrides[k] && Object.keys(p.overrides[k]).length).length;
  $('#sumLines').textContent = ov ? ov + ' 行已指定' : '全部自动';
  $('#sumFeel').textContent = (TASTE[S.taste] && TASTE[S.taste].short) || '平衡';
  const sws = $$('.togs input');
  $('#sumSwitch').textContent = sws.filter(x => x.checked).length + ' / ' + sws.length;
  const fn = ['#fDisplay', '#fSerif', '#fBody'].map(id => { const s = $(id); return s.selectedIndex > 0 ? s.options[s.selectedIndex].text.split('　')[0] : ''; }).filter(Boolean);
  $('#sumFonts').textContent = fn.length ? fn.join(' / ') : '跟随风格';
  $('#sumLyrics').textContent = (S.plan ? S.plan.lines.filter(l => !l.interlude).length : '—') + ' 句' + (countTags() ? ' · 卡点' : '');
  const tl = S.project.text || {};
  const nShape = tl.shapes ? ['block', 'honey', 'dots', 'noise'].filter(k => tl.shapes[k]).length : 0;
  const tBits = [];
  if (nShape) tBits.push('背景 ' + nShape + ' 种');
  if (tl.stack) tBits.push('文字叠 ' + tl.stack + ' 层');
  if (tl.outlineEn) tBits.push('英文描边');
  $('#sumText').textContent = tBits.length ? tBits.join(' · ') : '关';
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
      ? '现在是用 http:// 打开的，浏览器不给导出视频。请用 https 网址访问，或把 dist/粉色大肥鱼-文字PV.html 下到本地双击打开'
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
    const name = '粉色大肥鱼-文字PV_' + p.aspect.replace(':', 'x') + '_' + size[0] + 'p_' + String(p.seed).slice(-4) + '.mp4';
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
    const name = '粉色大肥鱼-文字PV_透明_' + p.aspect.replace(':', 'x') + '_' + size0(p) + 'p_' + String(p.seed).slice(-4) + '.zip';
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
    const name = '粉色大肥鱼-文字PV_透明_' + p.aspect.replace(':', 'x') + '_' + w + 'p_' + String(p.seed).slice(-4) + '.mov';
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
  // 选择整个文件夹：里面的素材按文件名顺序自动排进时间线
  const folderBtn = $('#btnPickFolder');
  if (folderBtn) folderBtn.onclick = e => { e.stopPropagation(); pick('#fileFolder'); };
  const folderInput = $('#fileFolder');
  if (folderInput) folderInput.addEventListener('change', async e => {
    let files = sortDropFiles([...(e.target.files || [])].filter(isFolderFile));
    e.target.value = '';
    if (!files.length) { toast('这个文件夹里没有能用的素材（图片 / GIF / 视频 / 音频 / srt / lrc）'); return; }
    const capped = files.length > FOLDER_MAX;
    if (capped) files = files.slice(0, FOLDER_MAX);
    toast('文件夹：找到 ' + files.length + ' 个文件，正在按文件名顺序排进时间线…');
    await new Promise(r => setTimeout(r, 40));
    await dropFiles(files, { start: S.t, folder: true, capped });
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

  // 拖进来（整页都能接：文件夹 / 图片 / 视频 / 音频 / srt / lrc）
  window.addEventListener('dragover', e => { if (isFileDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  window.addEventListener('drop', async e => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    await importDrop(e.dataTransfer, { start: S.t });
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

  // 逐词时间：生成 / 应用 / 回到自动
  const wordSheet = () => (J.MAD && J.MAD.sheet ? J.MAD.sheet(S.plan) : '');
  $('#btnWordSheet').addEventListener('click', () => {
    const el = $('#wordSheet');
    el.value = wordSheet();
    toast('已生成逐词时间表：改完点「应用」；清空则回到自动估算');
  });
  $('#btnWordApply').addEventListener('click', () => {
    const txt = $('#wordSheet').value.trim();
    if (!txt) return;
    const words = J.MAD.parseSheet(txt);
    if (!Object.keys(words).length) { toast('时间表格式不对：每行需要 行号 / 词 / 起点 / 终点'); return; }
    S.project.timing.words = words;
    replan();
    toast('已应用 ' + Object.keys(words).length + ' 行的逐词时间');
  });
  $('#btnWordAuto').addEventListener('click', () => {
    S.project.timing.words = {};
    $('#wordSheet').value = '';
    replan();
    toast('逐词时间已回到自动：按字数和标点估算，并吸附鼓点');
  });
  $('#btnWordImport').addEventListener('click', () => $('#wordFile').click());
  $('#wordFile').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try {
      const r = J.MAD.parseWordFile(await f.text(), f.name);
      if (!r) { toast('这个逐字格式读不出来：支持 YRC / QRC / ASS 卡拉OK；KRC 是加密格式，请先合法解密'); return; }
      S.project.lyrics = r.lines.map(l => l.text).join('\n');
      S.project.timing.lineTimes = {};
      S.project.timing.words = {};
      r.lines.forEach((l, i) => {
        S.project.timing.lineTimes[i] = +l.start.toFixed(3);
        S.project.timing.words[i] = l.words.map(w => ({ w: w.w, start: +w.start.toFixed(3), end: +w.end.toFixed(3) }));
      });
      S.project.overrides = {};
      $('#lyrics').value = S.project.lyrics;
      replan();
      toast('已导入 ' + r.lines.length + ' 句逐字时间');
    } catch (err) { toast('逐字文件读取失败：' + (err && err.message || err)); }
    e.target.value = '';
  });
  $('#btnWordTap').addEventListener('click', () => startTap());
  window.addEventListener('keydown', e => {
    if (!S.tap) return;
    if (e.code === 'Space') { e.preventDefault(); e.stopImmediatePropagation(); tapWord(); }
    else if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancelTap(); }
  }, true);
  $('#viewport').addEventListener('pointerdown', e => {
    if (!S.tap) return;
    e.preventDefault(); e.stopPropagation(); tapWord();
  }, true);

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

  // 一键成片：先选类型（重击 MAD / 抒情 PV / 手帐），再各自套模板
  $('#segGenre').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    applyGenre(b.dataset.v);
  });

  // 动态模糊子帧数 / コマ打ち
  $('#motionBlur').addEventListener('input', e => {
    const v = +e.target.value | 0;
    S.project.fx.motionBlur = v;
    if (S.plan && S.plan.fx) S.plan.fx.motionBlur = v;
    $('#oMotionBlur').textContent = v;
    S.need = true;
  });
  $('#segKoma').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const v = +b.dataset.v | 0;
    S.project.fx.koma = v;
    S.project.fx.onTwos = v > 0;
    $$('#segKoma button').forEach(x => x.classList.toggle('on', x === b));
    replan();
    toast(v ? 'コマ打ち：每秒 ' + v + ' 张（' + (v === 12 ? '2 コマ' : v === 8 ? '3 コマ' : '1 コマ') + '）' : 'コマ打ち关闭：逐帧');
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

  // 背景层：形状图层 / 英文描边 / 叠层（只影响画面，不用重排）
  const TL = () => (S.project.text || (S.project.text = { outlineEn: false, stack: 0, shapes: {}, amt: 0.45, size: 0.65, drift: 0.5 }));
  const shapeIds = { block: '#shBlock', honey: '#shHoney', dots: '#shDots', noise: '#shNoise' };
  const syncTextUI = () => {
    const t = TL();
    $('#tlOutlineEn').checked = !!t.outlineEn;
    $$('#segStack button').forEach(b => b.classList.toggle('on', (+b.dataset.v | 0) === (t.stack | 0)));
    for (const k in shapeIds) { const el = $(shapeIds[k]); if (el) el.checked = !!(t.shapes && t.shapes[k]); }
    const amt = t.amt == null ? 0.45 : t.amt, drift = t.drift == null ? 0.5 : t.drift, size = t.size == null ? 0.65 : t.size;
    $('#shAmt').value = Math.round(amt * 100); $('#oShAmt').textContent = amt.toFixed(2);
    $('#shSize').value = Math.round(size * 100); $('#oShSize').textContent = size.toFixed(2);
    $('#shDrift').value = Math.round(drift * 100); $('#oShDrift').textContent = drift.toFixed(2);
  };
  syncTextUI();
  $('#tlOutlineEn').addEventListener('change', e => { TL().outlineEn = e.target.checked; S.need = true; updateSums(); });
  $('#segStack').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    TL().stack = +b.dataset.v | 0;
    $$('#segStack button').forEach(x => x.classList.toggle('on', x === b));
    S.need = true; updateSums();
  });
  for (const k in shapeIds) {
    const el = $(shapeIds[k]); if (!el) continue;
    el.addEventListener('change', () => {
      const t = TL(); t.shapes = t.shapes || {}; t.shapes[k] = el.checked;
      S.need = true; updateSums();
    });
  }
  const shSl = (id, key, out) => $(id).addEventListener('input', () => {
    const v = +$(id).value / 100; TL()[key] = v; $(out).textContent = v.toFixed(2); S.need = true;
  });
  shSl('#shAmt', 'amt', '#oShAmt');
  shSl('#shSize', 'size', '#oShSize');
  shSl('#shDrift', 'drift', '#oShDrift');

  // 播放
  $('#btnPlay').onclick = () => (S.playing ? pause() : play());

  $('#btnLeft').onclick = () => togglePanel('left');
  $('#btnRight').onclick = () => togglePanel('right');

  $('#btnOneShot').onclick = () => freeReplan();
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
    ? '<b>预览模式</b>：现在是用 <code>http://</code> 打开的，浏览器不允许导出视频。要出片请用 https 网址，或把 <b>dist/粉色大肥鱼-文字PV.html</b> 下到本地双击打开。'
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
    if (!mod && !shift && key === 'n') { e.preventDefault(); S.snap = !S.snap; const st = $('#tlSnapTag'); if (st) { st.classList.toggle('off', !S.snap); st.textContent = S.snap ? '吸附素材' : '自由'; } toast(S.snap ? '吸附已开启：素材 / 文字块 / 播放头' : '吸附已关闭'); return; } // 吸附 N
    if (!mod && !shift && key === 'b') { e.preventDefault(); S.snapBeat = !S.snapBeat; const bt = $('#tlBeatTag'); if (bt) bt.classList.toggle('off', !S.snapBeat); toast(S.snapBeat ? '拍点吸附已开启' : '拍点吸附已关闭'); return; } // 拍点吸附 B
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
  const ids = [...new Set((TL.multi || []).filter(s => s.kind === 'media').map(s => s.i))]
    .filter(i => S.media[i]).sort((a, b) => b - a);
  if (!ids.length && S.mediaSel >= 0 && S.media[S.mediaSel]) ids.push(S.mediaSel);
  if (ids.length) {
    pause();
    for (const i of ids) { const m = S.media[i]; if (m.el && !m.el.paused) m.el.pause(); }
    for (const i of ids) S.media.splice(i, 1);
    TL.multi = []; TL.sel = null; S.mediaSel = -1;
    syncMediaList(); drawTimeline(); S.need = true; commit();
    toast('已删除 ' + ids.length + ' 个素材 · 按 Ctrl+Z 可以撤销');
    return;
  }
  if ((TL.multi || []).some(s => s.kind === 'text') || (TL.sel && TL.sel.kind === 'text')) {
    toast('选中的文字块对应歌词行：要到左栏「歌词文案」删掉那一行');
    return;
  }
  toast('先框选或点一下要删的素材，再按 Delete（删错了 Ctrl+Z 撤销）');
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


