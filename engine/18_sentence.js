/* ============================================================
   字面工房 — 整句版面（sentence layouts）
   ------------------------------------------------------------
   The word-cut mode is still used for the strongest chorus words.
   Verse / pre-chorus / bridge / most chorus lines now get ONE cut
   for the whole sentence:

     · all words have a fixed place in a real composition
     · words appear one by one on their syllable times
     · the current word is the accent; already sung words stay at
       secondary brightness; future words are still hidden
     · one main word, one secondary level, one function level
     · ten layouts (left hero, sandwich, stair, vertical, crop,
       overlap, labels, grid, center rule, ghost anchor)
   ============================================================ */
(() => {
'use strict';
const E = J.E;

const PALETTE = {
  verse:  ['leftHero', 'labels', 'centerRule'],
  pre:    ['sandwich', 'stair', 'grid'],
  chorus: ['cropGiant', 'overlap', 'ghostAnchor'],
  bridge: ['ghostAnchor', 'grid', 'labels'],
  outro:  ['centerRule', 'vertical'],
};
const SCENE = {
  verse:  { bgs: ['lyricWall', 'softField', 'gridCross'], cams: ['slowPush', 'driftDiag'] },
  pre:    { bgs: ['splitBlocks', 'gridCross', 'softField'], cams: ['driftDiag', 'breath'] },
  chorus: { bgs: ['speedLines', 'beatRings', 'leak'], cams: ['beatPunch', 'roll2'] },
  bridge: { bgs: ['timecode', 'inkLine', 'softField'], cams: ['handheld', 'breath'] },
  outro:  { bgs: ['softField', 'lyricWall'], cams: ['slowPush'] },
};
const BGS = ['lyricWall', 'splitBlocks', 'gridCross', 'beatRings', 'speedLines', 'timecode', 'inkLine', 'leak', 'softField'];
const CAMS = ['slowPush', 'driftDiag', 'breath', 'beatPunch', 'roll2', 'handheld'];
const TRANS = ['flashCut', 'blockWipe', 'whip', 'zoomThrough', 'sliceShift', 'invertFlash'];
const hasBg = k => !!(J.BG && J.BG[k]);
const hasCam = k => !!(J.CAMERA && J.CAMERA[k]);

const LEVEL = w => (w.kind === 'func' ? 3 : w.kind === 'emo' ? 1 : 2);
const weight = w => Math.pow(Math.max(1, [...String(w.w || w.text || '')].length), 0.9) * (w.kind === 'emo' ? 2.6 : w.kind === 'func' ? 0.55 : 1.35);

function mainIndex(words, line) {
  let best = 0, bs = -1;
  words.forEach((w, i) => {
    let s = weight(w);
    if (line.emph && line.emph.some(x => String(w.w || w.text).includes(x) || String(x).includes(w.w || w.text))) s *= 4;
    if (s > bs) { bs = s; best = i; }
  });
  return best;
}

function setup(env, cut) {
  const W = env.W, H = env.H, sc = env.sc, st = env.st;
  const z = cut.stage && cut.stage.text ? cut.stage.text : { x: 0.07, y: 0.20, w: 0.86, h: 0.60 };
  const X = z.x * W, Y = z.y * H, ZW = z.w * W, ZH = z.h * H;
  const words = (cut.params.words || []).slice();
  const main = cut.params.mainIndex | 0;
  const mainSize = Math.min(H * 0.64, ZH * 0.92);
  const subSize = mainSize * 0.42;
  const funcSize = mainSize * 0.20;
  const display = (st.fonts.display && st.fonts.display[0]) || 'gothic_black';
  const serif = (st.fonts.serif && st.fonts.serif[0]) || display;
  const body = (st.fonts.body && st.fonts.body[0]) || display;
  const mono = (st.fonts.mono && st.fonts.mono[0]) || body;
  const fit = (text, font, size, maxW, maxH) => Math.min(size, J.fitSize(text, font, maxW, maxH, { track: 0.02 }) || size);
  const items = [];
  const add = (i, x, y, size, font, align, o = {}) => {
    const w = words[i]; if (!w) return;
    const text = String(w.w || w.text || '');
    const lv = o.level || LEVEL(w);
    const fs = fit(text, font, size, o.maxW == null ? ZW * 0.9 : o.maxW, o.maxH == null ? ZH : o.maxH);
    items.push(Object.assign({
      i, word: w, text, x, y, size: fs, font, align: align || 'left', level: lv,
      color: lv === 1 ? sc.fg : sc.sub, track: lv === 1 ? 0.02 : 0.08,
      alpha: 1, fill: true, stroke: 0, rot: 0, vertical: false, tag: false,
    }, o));
  };
  return { W, H, sc, st, z, X, Y, ZW, ZH, words, main, mainSize, subSize, funcSize, display, serif, body, mono, fit, items, add };
}

function build(key, s) {
  const { X, Y, ZW, ZH, words, main, mainSize, subSize, funcSize, display, serif, body, mono, add, items } = s;
  const n = words.length;
  const others = words.map((w, i) => i).filter(i => i !== main);
  const content = others.filter(i => LEVEL(words[i]) !== 3);
  const funcs = others.filter(i => LEVEL(words[i]) === 3);
  const at = (i, k, len) => (len <= 1 ? 0.5 : k / (len - 1));

  if (key === 'leftHero') {
    add(main, X + ZW * 0.01, Y + ZH * 0.30, mainSize, display, 'left', { maxW: ZW * 0.72, level: 1 });
    content.forEach((i, k) => add(i, X + ZW * 0.58, Y + ZH * (0.22 + k * 0.16), subSize, serif, 'left', { level: 2, maxW: ZW * 0.40 }));
    funcs.forEach((i, k) => add(i, X + ZW * 0.01, Y + ZH * (0.78 + k * 0.07), funcSize, body, 'left', { level: 3 }));
    return items;
  }
  if (key === 'sandwich') {
    const big2 = content.length ? content[content.length - 1] : -1;
    add(main, X + ZW * 0.5, Y + ZH * 0.18, mainSize * 0.82, display, 'center', { maxW: ZW * 0.94, level: 1 });
    if (big2 >= 0) add(big2, X + ZW * 0.5, Y + ZH * 0.84, mainSize * 0.66, display, 'center', { maxW: ZW * 0.94, level: 1 });
    content.filter(i => i !== big2).forEach((i, k) => add(i, X + ZW * (0.18 + k * 0.30), Y + ZH * 0.50, subSize, serif, 'left', { level: 2, maxW: ZW * 0.34 }));
    funcs.forEach((i, k) => add(i, X + ZW * (0.08 + k * 0.18), Y + ZH * 0.66, funcSize, body, 'left', { level: 3 }));
    return items;
  }
  if (key === 'stair') {
    content.forEach((i, k) => add(i, X + ZW * (0.06 + k * 0.12), Y + ZH * (0.18 + k * 0.15), mainSize * Math.max(0.40, 0.88 - k * 0.10), display, 'left', { level: k === 0 ? 1 : 2, rot: -10, maxW: ZW * 0.50 }));
    funcs.forEach((i, k) => add(i, X + ZW * (0.10 + k * 0.12), Y + ZH * 0.88, funcSize, body, 'left', { level: 3 }));
    return items;
  }
  if (key === 'vertical') {
    add(main, X + ZW * 0.78, Y + ZH * 0.08, mainSize * 0.64, display, 'left', { vertical: true, level: 1, maxW: ZW * 0.28, maxH: ZH * 0.88 });
    content.forEach((i, k) => add(i, X + ZW * (0.56 - k * 0.14), Y + ZH * 0.06, subSize * 0.72, serif, 'left', { vertical: true, level: 2, maxH: ZH * 0.8 }));
    funcs.forEach((i, k) => add(i, X + ZW * (0.26 - k * 0.10), Y + ZH * 0.10, funcSize, body, 'left', { vertical: true, level: 3 }));
    return items;
  }
  if (key === 'cropGiant') {
    add(main, X - ZW * 0.06, Y + ZH * 0.52, mainSize * 1.45, display, 'left', { level: 1, maxW: ZW * 1.2, maxH: ZH * 1.7 });
    content.forEach((i, k) => add(i, X + ZW * (0.56 + (k % 2) * 0.25), Y + ZH * (0.20 + Math.floor(k / 2) * 0.18), subSize * 0.78, serif, 'left', { level: 2, maxW: ZW * 0.32 }));
    funcs.forEach((i, k) => add(i, X + ZW * 0.58, Y + ZH * (0.78 + k * 0.06), funcSize, body, 'left', { level: 3 }));
    return items;
  }
  if (key === 'overlap') {
    content.forEach((i, k) => add(i, X + ZW * 0.02, Y + ZH * (0.18 + k * 0.13), mainSize * 0.74, display, 'left', {
      level: k === 0 ? 1 : 2, fill: k % 2 === 0, stroke: k % 2 ? Math.max(1.5, mainSize * 0.012) : 0,
      strokeColor: s.sc.sub, maxW: ZW * 0.92,
    }));
    funcs.forEach((i, k) => add(i, X + ZW * 0.70, Y + ZH * (0.68 + k * 0.07), funcSize, body, 'left', { level: 3 }));
    return items;
  }
  if (key === 'labels') {
    add(main, X + ZW * 0.01, Y + ZH * 0.32, mainSize * 0.82, display, 'left', { level: 1, maxW: ZW * 0.66 });
    content.forEach((i, k) => add(i, X + ZW * 0.62, Y + ZH * (0.20 + k * 0.14), subSize * 0.72, body, 'left', { level: 2, tag: true, maxW: ZW * 0.34 }));
    funcs.forEach((i, k) => add(i, X + ZW * 0.02, Y + ZH * (0.80 + k * 0.07), funcSize, mono, 'left', { level: 3 }));
    return items;
  }
  if (key === 'grid') {
    const cols = n <= 3 ? n : Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
    const cw = ZW / cols, ch = ZH / rows;
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      const x = X + c * cw + cw / 2, y = Y + r * ch + ch / 2;
      add(i, x, y, subSize, LEVEL(words[i]) === 1 ? display : serif, 'center', { level: LEVEL(words[i]), maxW: cw * 0.9, maxH: ch * 0.8, cell: { x: X + c * cw, y: Y + r * ch, w: cw, h: ch } });
    }
    return items;
  }
  if (key === 'centerRule') {
    add(main, X + ZW * 0.5, Y + ZH * 0.40, mainSize * 0.92, display, 'center', { level: 1, maxW: ZW * 0.94 });
    content.forEach((i, k) => add(i, X + ZW * 0.5, Y + ZH * (0.60 + k * 0.10), subSize, serif, 'center', { level: 2, maxW: ZW * 0.86 }));
    funcs.forEach((i, k) => add(i, X + ZW * 0.5, Y + ZH * (0.85 + k * 0.05), funcSize, body, 'center', { level: 3 }));
    return items;
  }
  // ghostAnchor
  add(main, X + ZW * 0.5, Y + ZH * 0.44, mainSize * 0.80, display, 'center', { level: 1, maxW: ZW * 0.92 });
  content.forEach((i, k) => add(i, X + ZW * (0.12 + (k % 2) * 0.56), Y + ZH * (0.16 + Math.floor(k / 2) * 0.20), subSize * 0.80, serif, 'left', { level: 2, maxW: ZW * 0.34 }));
  funcs.forEach((i, k) => add(i, X + ZW * 0.12, Y + ZH * (0.82 + k * 0.05), funcSize, body, 'left', { level: 3 }));
  return items;
}

J.LAYOUTS.sentence = {
  name: '整句版面', cn: '整句版面', fits: () => true, special: true,
  plan: () => ({}),
  render(env) {
    const cut = env.cut, P = cut.params || {};
    if (!P.words || !P.words.length) return null;
    const s = setup(env, cut);
    const t = env.t != null ? env.t : cut.start + env.lt;
    // The giant anchor is only used by the two compositions that are built
    // around it; a translucent outline behind every layout reads as a ghost.
    if (!(cut.stage && cut.stage.panel) && (P.template === 'ghostAnchor' || P.template === 'cropGiant')) {
      const anchor = String(P.words[P.mainIndex | 0].w || P.words[P.mainIndex | 0].text || '');
      env.draw({ text: anchor, font: s.display, size: s.H * 0.92, x: s.W * 0.5, y: s.H * 0.54, align: 'center', color: s.sc.fg, alpha: 0.12, fill: true, ghost: false });
    }
    const items = build(P.template || 'leftHero', s);
    // fixed rules / grid / current-cell plates go in before the glyphs
    if (P.template === 'centerRule') {
      env.rect(s.X, s.Y + s.ZH * 0.27, s.ZW, Math.max(1, s.H * 0.0012), s.sc.sub, 0.35, false);
      env.rect(s.X, s.Y + s.ZH * 0.78, s.ZW, Math.max(1, s.H * 0.0012), s.sc.sub, 0.35, false);
    }
    // a quiet baseline makes every sentence frame read as a page, not a floating word
    env.rect(s.X, s.Y + s.ZH, s.ZW, Math.max(1, s.H * 0.0011), s.sc.sub, 0.22, false);
    if (P.template === 'grid') {
      for (const it of items) if (it.cell) {
        env.rect(it.cell.x, it.cell.y, it.cell.w, Math.max(1, s.H * 0.001), s.sc.fg, 0.12, false);
        env.rect(it.cell.x, it.cell.y, Math.max(1, s.H * 0.001), it.cell.h, s.sc.fg, 0.12, false);
      }
    }
    // current = the word with the latest start that has already begun
    let curIdx = -1, curStart = -Infinity;
    for (const it of items) {
      if (t >= it.word.start && it.word.start >= curStart) { curStart = it.word.start; curIdx = it.i; }
    }
    let bb = null;
    for (const it of items) {
      if (t < it.word.start - 1e-4) continue;   // words appear on their syllable, not as layout ghosts
      const cur = it.i === curIdx && t < (it.word.end || cut.end) + 0.22;
      const past = !cur;
      let a = cur ? 1 : 0.42;
      if (it.level === 1 && past) a = 0.55;
      let col = cur ? s.sc.accent : (it.level === 1 ? s.sc.fg : s.sc.sub);
      let fill = it.fill, stroke = it.stroke, strokeColor = it.strokeColor || s.sc.sub;
      if (cur && it.level === 1) { fill = true; stroke = 0; col = s.sc.accent; }
      if (it.tag) {
        const w = it.text.length * it.size * 0.62 + it.size * 0.5;
        env.rrect(it.x - it.size * 0.18, it.y - it.size * 0.52, w, it.size * 1.04, it.size * 0.10, cur ? s.sc.accent : s.sc.dim, cur ? 0.95 : 0.55, false);
        col = cur ? (J.lum(s.sc.accent) > 0.5 ? '#111111' : '#FFFFFF') : s.sc.fg;
      }
      const panel = cut.stage && cut.stage.panel;
      const overPhoto = panel && it.x - it.size * it.text.length * 0.3 < (panel.x + panel.w) * s.W && it.y > panel.y * s.H && it.y < (panel.y + panel.h) * s.H;
      const r = env.draw({
        text: it.text, font: it.font, size: it.size, x: it.x, y: it.y, align: it.align,
        color: col, alpha: a, track: it.track, rot: it.rot, vertical: it.vertical,
        fill, stroke, strokeColor, blend: overPhoto && cur ? 'difference' : null, ghost: false,
      });
      if (r) bb = J.unionBB(bb, r);
    }
    return bb;
  },
};

/* Replace word cuts with one sentence cut for the selected lines. */
J.applySentences = (project, plan) => {
  if (!plan || !plan.choreo || !plan.mad || !plan.mad.words) return plan;
  const secs = plan.mad.sections || [];
  const ov = project.overrides || {};
  const removed = new Set();
  const newCuts = [];
  const lineDone = new Set();
  plan.cuts.forEach(c => { if (c.line >= 0) lineDone.add(c.line); });
  const wordRows = new Map();
  for (const row of plan.mad.words) if (row && row.words) wordRows.set(row.line, row);
  const tplCache = new Map();
  const secSeen = new Map();

  plan.lines.forEach((ln, li) => {
    if (ln.interlude || !ln.text) return;
    const o = ov[li] || {};
    if (o.lock || o.layout || o.single || o.cuts) return;
    const row = wordRows.get(li); if (!row || !row.words.length) return;
    const sec = secs[li] || { kind: 'verse' };
    const si = secSeen.get(sec.kind) || 0;
    secSeen.set(sec.kind, si + 1);
    const scene = SCENE[sec.kind] || SCENE.verse;
    const sceneApply = (cut) => {
      const bk = scene.bgs[si % scene.bgs.length], ck2 = scene.cams[si % scene.cams.length];
      cut.bg = hasBg(bk) ? bk : 'none'; cut.bgP = { seed: J.h(plan.seed | 0, li, 0x4247) };
      cut.cam = hasCam(ck2) ? ck2 : 'still'; cut.camP = {};
    };
    // The strongest chorus line stays word-cut; everything else gets a sentence.
    if (sec.kind === 'chorus' && (ln.impact || row.words.length <= 2)) {
      for (const c of plan.cuts.filter(c => c.line === li)) {
        const bk = scene.bgs[si % scene.bgs.length];
        c.bg = hasBg(bk) ? bk : 'none'; c.bgP = { seed: J.h(plan.seed | 0, li, 0x4247) };
        c.cam = 'still'; c.camP = {};
      }
      return;
    }
    const old = plan.cuts.filter(c => c.line === li);
    if (!old.length) return;
    old.forEach(c => removed.add(c));
    const pal = PALETTE[sec.kind] || PALETTE.verse;
    const ck = String(ln.text).replace(/\s+/g, '') + '|' + sec.kind;
    let tkey = tplCache.get(ck);
    if (!tkey) {
      // cycle within the section instead of hash-modulo: that was why three
      // quarters of a verse kept getting the same composition
      tkey = pal[si % pal.length];
      tplCache.set(ck, tkey);
    }
    const words = row.words.map(w => ({ w: w.w, start: +w.start, end: +w.end, kind: w.kind }));
    const mi = mainIndex(words, ln);
    const stage = plan.stages && plan.stages[li] ? plan.stages[li] : null;
    const cut = {
      text: ln.text, lineText: ln.text, note: ln.note || null, line: li,
      start: Math.max(ln.start, words[0].start), end: Math.max(ln.end, words[words.length - 1].end),
      layout: 'sentence', enter: 'cut', exit: 'cut', hold: 'still', inDur: 0.08, outDur: 0,
      params: { template: tkey, words, mainIndex: mi, stage },
      decor: [], scheme: old[0].scheme | 0, seed: J.h(ln.seed, 0x53454e54),
      emph: !!ln.impact, words, stagger: 0, treat: 'none', treatP: {},
      bg: 'none', bgP: {}, cam: 'still', camP: {}, trans: null, transP: {}, transDur: 0,
      stage, sentence: true, utext: ln.text,
    };
    sceneApply(cut);
    cut.dur = cut.end - cut.start;
    newCuts.push(cut);
    plan.lines[li].sentence = true;
  });
  if (!newCuts.length) return plan;
  plan.events = plan.events.filter(e => {
    const own = plan.evOwner && plan.evOwner.get(e);
    if (own && removed.has(own)) return false;
    for (const c of newCuts) if (e.t >= c.start - 0.03 && e.t <= c.end + 0.03) return false;
    return true;
  });
  plan.cuts = plan.cuts.filter(c => !removed.has(c));
  plan.cuts.push(...newCuts);
  plan.cuts.sort((a, b) => a.start - b.start);
  plan.cuts.forEach((c, i) => { c.index = i; c.dur = Math.max(0.02, c.end - c.start); });
  // sentence-to-sentence joins only; word-to-word cuts stay hard
  for (let i = 1; i < plan.cuts.length; i++) {
    const a = plan.cuts[i - 1], b = plan.cuts[i];
    if (a.line < 0 || b.line < 0 || a.line === b.line) continue;
    if (Math.abs(a.end - b.start) > 0.06) continue;
    const ka = secs[a.line] && secs[a.line].kind, kb = secs[b.line] && secs[b.line].kind;
    if (ka === kb && !b.emph && b.line % 3) continue;
    const key = TRANS[J.h(plan.seed | 0, b.line + 1, 0x5452414e) % TRANS.length];
    if (!J.TRANS || !J.TRANS[key]) continue;
    b.trans = key; b.transP = {}; b.transDur = Math.min(0.18, J.TRANS[key].dur || 0.22);
    a.exit = 'cut'; a.outDur = 0;
  }
  plan.events.sort((a, b) => a.t - b.t);
  plan.sentences = newCuts.map(c => ({ line: c.line, template: c.params.template, start: +c.start.toFixed(2), end: +c.end.toFixed(2) }));
  return plan;
};

const prevPlan = J.plan;
J.plan = function (project, audio) {
  const plan = prevPlan(project, audio);
  try { return J.applySentences(project, plan); }
  catch (e) { console.warn('sentence layout failed', e); return plan; }
};
})();
