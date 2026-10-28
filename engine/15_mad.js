/* ============================================================
   字面工房 — MAD choreography layer (word-level, beat-driven)
   ------------------------------------------------------------
   The old planner gives every lyric *line* one little show:
   layout + enter + hold + exit + transition. That is the grammar
   of a cut-style subtitle template, not of a MAD / 文字PV.

   This layer keeps the same renderer, but rebuilds the lyric part
   of the plan as a chain of *words*:
     · word timings (enhanced LRC, a hand-edited sheet, or estimated
       from characters + punctuation and snapped to real onsets)
     · one hard cut per word, no exits, no transitions, no empty gaps
     · ten actions that land on the syllable: hit / step / through /
       mask / slot / track / echo / slice / stroke / match
     · sections decide the intensity (verse → pre → chorus → outro)
     · a repeated chorus reuses the same action sequence
   ============================================================ */
(() => {
'use strict';

const E = J.E;
const MAD = J.MAD = { version: 2, actions: [] };
const DEG = J.DEG;

/* ---------------- words ---------------- */

const LOC = { 'zh-Hans': 'zh-Hans', 'zh-Hant': 'zh-Hant', 'zh-Hant-TW': 'zh-Hant', ja: 'ja', ko: 'ko', en: 'en' };
const FUNC = new Set([...'的了在是我你不就也都还很又而把被给让着过吗呢吧啊呀哦嗯这那个一上下里中和与或但要会能可没有到从对为以之其她它们之乎者也而且然后所以因为如果虽然但是']);
const EMO = new Set([...'爱梦光夜星泪风花心痛死生永远黎明凤凰自由孤独温柔拥抱吻别离殇破碎燃烧沉默呐喊海天空雨雪月日火冰灵魂信仰希望绝望回忆青春少年故乡远方']);
const PUNCT = /^[、。，．,.!?！？…‥・「」『』（）()【】〈〉《》〔〕\[\]'"“”‘’ー〜～:：;；\-—―~]+$/;

function rawSegments(text, lang) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  if (lang === 'en' || !/[\u3000-\u9fff\uac00-\ud7af]/.test(t)) {
    return t.split(/\s+/).filter(Boolean).map(s => ({ text: s, punct: false }));
  }
  let arr = null;
  try { arr = [...new Intl.Segmenter(LOC[lang] || 'zh-Hans', { granularity: 'word' }).segment(t)].map(x => x.segment); } catch (e) {}
  if (!arr || !arr.length) arr = J.chunkText(t);
  const out = [];
  for (const s of arr) {
    if (!s) continue;
    if (!s.trim()) { if (out.length) out[out.length - 1].text += s; continue; }
    if (PUNCT.test(s) && out.length) { out[out.length - 1].text += s; out[out.length - 1].punct = true; continue; }
    out.push({ text: s, punct: false });
  }
  if (out.length === 1 && [...t.replace(/\s/g, '')].length > 5) {
    const chunks = J.chunkText(t);
    if (chunks.length > 1) return chunks.map(s => ({ text: s, punct: PUNCT.test(s.slice(-1)) }));
  }
  return out;
}

const isFunc = (w) => {
  const s = String(w || '').replace(/[^\u3400-\u9fff\uac00-\ud7af]/g, '');
  if (!s) return false;
  if (FUNC.has(s)) return true;
  return [...s].every(c => FUNC.has(c));
};
const isEmo = (w) => [...String(w || '')].some(c => EMO.has(c));

MAD.words = (text, lang) => rawSegments(text, lang).map(w => {
  const clean = w.text.replace(/\s+/g, '');
  return {
    text: w.text,
    clean,
    func: isFunc(clean),
    emo: isEmo(clean),
    punct: !!w.punct,
    n: [...clean].length || 1,
  };
});

/* ---------------- timing ---------------- */

function nearest(list, t, maxDt) {
  if (!list || !list.length) return null;
  let lo = 0, hi = list.length - 1, i = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m] <= t) { i = m; lo = m + 1; } else hi = m - 1; }
  let best = null, bd = maxDt;
  for (const k of [i, i + 1]) {
    if (k < 0 || k >= list.length) continue;
    const d = Math.abs(list[k] - t);
    if (d < bd) { bd = d; best = list[k]; }
  }
  return best;
}
function snapTime(t, min, onsets, beats) {
  let best = nearest(beats, t, 0.055);
  const o = nearest((onsets || []).map(x => x.t), t, 0.085);
  if (o != null) best = o;                 // a real drum hit wins over the grid
  return best == null ? t : Math.max(min, best);
}
function onsetNear(onsets, t, dt) {
  if (!onsets || !onsets.length) return null;
  let best = null, bd = dt;
  for (const o of onsets) { const d = Math.abs(o.t - t); if (d < bd) { bd = d; best = o; } }
  return best;
}

function distribute(words, line, onsets, beats, snap) {
  const t0 = +line.start, t1 = Math.max(t0 + 0.18, +line.end);
  const span = t1 - t0;
  const weights = words.map(w => {
    const n = Math.max(1, w.n || 1);
    let k = Math.pow(n, 0.86);
    if (w.func) k *= 0.78;
    if (w.emo) k *= 1.22;
    if (w.punct) k += 0.45;                // a little air after punctuation
    return k;
  });
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const times = [];
  let acc = 0;
  for (let i = 0; i < words.length; i++) {
    let s0 = t0 + span * acc / total;
    acc += weights[i];
    let s1 = t0 + span * acc / total;
    if (snap) s0 = i === 0 ? s0 : snapTime(s0, (times[i - 1] ? times[i - 1].start : t0) + 0.07, onsets, beats);
    times.push({ start: s0, end: s1 });
  }
  // minimum length + monotonic
  for (let i = 0; i < times.length; i++) {
    const minEnd = times[i].start + 0.075;
    if (times[i].end < minEnd) times[i].end = minEnd;
    if (i + 1 < times.length && times[i + 1].start < times[i].end) times[i + 1].start = times[i].end;
  }
  times[times.length - 1].end = Math.max(times[times.length - 1].end, t1);
  return times;
}

function explicitTimes(words, list) {
  if (!Array.isArray(list) || !list.length) return null;
  const norm = x => String(x == null ? '' : (x.w != null ? x.w : Array.isArray(x) ? x[0] : x)).replace(/\s+/g, '');
  const vals = list.map(x => {
    if (Array.isArray(x)) return { w: x[0], start: +x[1], end: +x[2] };
    return { w: x.w != null ? x.w : x.text, start: +(x.start != null ? x.start : x.t), end: +(x.end != null ? x.end : x.e) };
  }).filter(x => isFinite(x.start));
  if (!vals.length) return null;
  if (vals.length === words.length) return vals.map((v, i) => ({ start: v.start, end: isFinite(v.end) ? v.end : (vals[i + 1] ? vals[i + 1].start : v.start + 0.2) }));
  // match by the written word, still in order
  const out = []; let j = 0;
  for (const w of words) {
    let k = -1;
    for (let q = j; q < vals.length; q++) if (norm(vals[q].w) === norm(w.text)) { k = q; break; }
    if (k < 0) return null;
    out.push({ start: vals[k].start, end: isFinite(vals[k].end) ? vals[k].end : (vals[k + 1] ? vals[k + 1].start : vals[k].start + 0.2) });
    j = k + 1;
  }
  return out;
}

function lrcTimes(words, tags) {
  if (!Array.isArray(tags) || tags.length < 2) return null;
  const toks = [];
  for (let i = 0; i < tags.length; i++) {
    const t0 = +tags[i].t, t1 = i + 1 < tags.length ? +tags[i + 1].t : t0 + 0.5;
    const sub = MAD.words(tags[i].text, (J.lang || 'zh-Hans'));
    const tot = sub.reduce((a, w) => a + Math.max(1, w.n), 0) || 1;
    let acc = 0;
    for (const w of sub) {
      const a = t0 + (t1 - t0) * acc / tot; acc += Math.max(1, w.n);
      toks.push({ w: w.clean, start: a, end: t0 + (t1 - t0) * acc / tot });
    }
  }
  if (!toks.length) return null;
  return explicitTimes(words, toks.map(x => ({ w: x.w, start: x.start, end: x.end })));
}

MAD.wordTiming = (project, plan, audio) => {
  const snap = !(project.timing && project.timing.snap === false);
  const onsets = (audio && audio.onsets) || plan.onsets || [];
  const beats = plan.beats || [];
  const explicit = (project.timing && project.timing.words) || {};
  const out = [];
  plan.lines.forEach((ln, li) => {
    if (ln.interlude || !ln.text) { out.push(null); return; }
    let words = MAD.words(ln.text, plan.lang);
    if (!words.length) { out.push(null); return; }
    let times = explicitTimes(words, explicit[li] || explicit[String(li)]);
    if (!times && ln.wordLrc && ln.wordLrc.length) times = lrcTimes(words, ln.wordLrc);
    if (!times) times = distribute(words, ln, onsets, beats, snap);
    // merge sub-100 ms flashes (a lone 的 / 了 is one syllable, not a cut of its own)
    for (let i = 0; i < words.length - 1; i++) {
      if (times[i + 1].start - times[i].start < 0.105 && !words[i].punct) {
        words[i + 1].text = words[i].text + words[i + 1].text;
        words[i + 1].clean = words[i].clean + words[i + 1].clean;
        words[i + 1].func = words[i].func && words[i + 1].func;
        words[i + 1].emo = words[i].emo || words[i + 1].emo;
        words[i + 1].n = words[i].n + words[i + 1].n;
        times[i + 1].start = times[i].start;
        words.splice(i, 1); times.splice(i, 1); i--;
      }
    }
    // A lone 的/了/在/中 is a syllable, not a shot. Fold very short function
    // words into the neighbouring content word so the cut keeps a readable phrase.
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (!w.func || w.n > 1) continue;
      if (times[i].end - times[i].start > 0.24) continue;
      if (i > 0 && !words[i - 1].punct) {
        words[i - 1].text += w.text;
        words[i - 1].clean += w.clean;
        words[i - 1].n += w.n;
        words[i - 1].emo = words[i - 1].emo || w.emo;
        times[i - 1].end = times[i].end;
        words.splice(i, 1); times.splice(i, 1); i--;
      } else if (i + 1 < words.length) {
        words[i + 1].text = w.text + words[i + 1].text;
        words[i + 1].clean = w.clean + words[i + 1].clean;
        words[i + 1].n += w.n;
        times[i + 1].start = times[i].start;
        words.splice(i, 1); times.splice(i, 1); i--;
      }
    }
    for (let i = 0; i < times.length; i++) {
      if (i + 1 < times.length && times[i].end > times[i + 1].start) times[i].end = times[i + 1].start;
      if (times[i].end <= times[i].start) times[i].end = times[i].start + 0.075;
    }
    out.push({ line: li, start: ln.start, end: ln.end, words, times });
  });
  return out;
};

/* ---------------- sections ---------------- */

const normText = t => String(t || '').replace(/[\s、。，．,.!！?？…・「」『』（）()"'“”‘’~〜ー―-]/g, '');

MAD.sections = (plan, timing, audio) => {
  const lines = plan.lines;
  const counts = new Map();
  lines.forEach(l => { if (!l.interlude && l.text) { const k = normText(l.text); counts.set(k, (counts.get(k) || 0) + 1); } });
  const eRate = plan.energyRate || (audio && audio.energyRate) || 0;
  const energy = plan.energy || (audio && audio.energy) || null;
  const eOf = (ln) => {
    if (!energy || !eRate) return null;
    const a = Math.max(0, Math.floor(ln.start * eRate)), b = Math.min(energy.length, Math.ceil(ln.end * eRate));
    if (b <= a) return null;
    let s = 0; for (let i = a; i < b; i++) s += energy[i];
    return s / (b - a);
  };
  const vals = lines.map(l => l.interlude ? null : eOf(l)).filter(v => v != null).sort((a, b) => a - b);
  const q = p => vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] : 0;
  const secs = lines.map((ln, i) => {
    if (ln.interlude) return { kind: 'interlude', intensity: 0.08, energy: 0 };
    const e = eOf(ln);
    const key = normText(ln.text);
    const rep = (counts.get(key) || 0) >= 2;
    const pos = lines.length > 1 ? i / (lines.length - 1) : 0;
    return { kind: 'verse', intensity: 0, energy: e == null ? 0.5 : e, rep, key, pos };
  });
  // chorus: repeated line, ! line, or a strong line in the second half; no audio → repetition + !
  for (let i = 0; i < secs.length; i++) {
    const s = secs[i]; if (s.kind === 'interlude') continue;
    const strong = vals.length ? s.energy > q(0.60) : false;
    const chorus = !!(s.rep || (lines[i].impact) || (strong && (s.pos > 0.42 || s.rep)));
    if (chorus) s.kind = 'chorus';
    else if (s.pos > 0.86) s.kind = 'outro';
    else if (lines[i].gapBefore && i > 0) s.kind = 'bridge';
  }
  // pre-chorus: the line right before a chorus run
  for (let i = 0; i + 1 < secs.length; i++) {
    if (secs[i].kind === 'verse' && secs[i + 1].kind === 'chorus') secs[i].kind = 'pre';
  }
  for (const s of secs) {
    const base = { verse: 0.32, pre: 0.52, chorus: 0.78, bridge: 0.48, outro: 0.36, interlude: 0.08 }[s.kind] || 0.4;
    s.intensity = J.clamp(base + (s.kind === 'interlude' ? 0 : (s.energy - 0.45) * 0.28), 0, 1);
  }
  return secs;
};

/* ---------------- ten actions ---------------- */

const ACTION = {
  hit:    { label: '重击入场', enter: 'hit',        hold: 'still',      inDur: 0.20 },
  step:   { label: '逐字硬切', enter: 'stepIn',     hold: 'still',      inDur: 0 },       // inDur = whole word
  through:{ label: '穿字',     enter: 'rushIn',     hold: 'still',      inDur: 0.14 },
  mask:   { label: '遮罩条',   enter: 'maskBar',    hold: 'still',      inDur: 0.13 },
  slot:   { label: '老虎机',   enter: 'slotRoll',   hold: 'still',      inDur: 0 },       // inDur = whole word
  track:  { label: '字距爆开', enter: 'trackPop',   hold: 'still',      inDur: 0.24 },
  echo:   { label: '残影堆叠', enter: 'hit',        hold: 'echoSnap',   inDur: 0.16 },
  slice:  { label: '切片错位', enter: 'sliceHit',   hold: 'still',      inDur: 0.16 },
  stroke: { label: '描边闪切', enter: 'strokeFlash',hold: 'strokePulse',inDur: 0.22 },
  match:  { label: '匹配切',   enter: 'match',      hold: 'still',      inDur: 0.17 },
};
MAD.actions = Object.keys(ACTION);

const POOL = {
  verse:  ['step', 'mask', 'track', 'slot', 'step', 'mask', 'slice'],
  pre:    ['step', 'track', 'slice', 'stroke', 'mask', 'hit'],
  chorus: ['hit', 'echo', 'slice', 'track', 'slot', 'hit', 'stroke'],
  bridge: ['slot', 'mask', 'hit', 'echo', 'track'],
  outro:  ['echo', 'mask', 'step', 'track'],
};

function pickAction(sec, w, k, n, prev, rng) {
  let pool = (POOL[sec.kind] || POOL.verse).slice();
  if (w.func) pool = ['step', 'mask', 'track', 'step'];
  if (w.emo) pool = ['hit', 'echo', 'track', 'slice'];
  if (k === 0) pool = sec.kind === 'chorus' ? ['hit', 'echo', 'slice'] : sec.kind === 'pre' ? ['step', 'mask', 'track'] : ['mask', 'step', 'track'];
  if (n > 1 && k === n - 1 && (sec.kind === 'chorus' || sec.kind === 'pre')) pool = pool.concat(['through', 'through']);
  let a = pool[Math.floor(rng() * pool.length) % pool.length];
  if (a === prev) a = pool[(pool.indexOf(a) + 1) % pool.length];
  return a;
}

/* ---------------- positions ---------------- */
const POS = {
  verse:  [{ x: 0.50, y: 0.52 }, { x: 0.42, y: 0.45 }, { x: 0.58, y: 0.58 }, { x: 0.50, y: 0.38 }, { x: 0.62, y: 0.50 }],
  pre:    [{ x: 0.50, y: 0.50 }, { x: 0.34, y: 0.46 }, { x: 0.66, y: 0.54 }, { x: 0.50, y: 0.34 }],
  chorus: [{ x: 0.50, y: 0.50 }, { x: 0.28, y: 0.44 }, { x: 0.72, y: 0.56 }, { x: 0.50, y: 0.30 }, { x: 0.50, y: 0.68 }, { x: 0.22, y: 0.62 }, { x: 0.78, y: 0.38 }],
  bridge: [{ x: 0.50, y: 0.50 }, { x: 0.40, y: 0.60 }, { x: 0.60, y: 0.40 }],
  outro:  [{ x: 0.50, y: 0.52 }, { x: 0.50, y: 0.42 }, { x: 0.50, y: 0.62 }],
};
function posOf(sec, k, rng) {
  const arr = POS[sec.kind] || POS.verse;
  const p = arr[k % arr.length];
  return { x: J.clamp(p.x + (rng() - 0.5) * 0.035, 0.12, 0.88), y: J.clamp(p.y + (rng() - 0.5) * 0.03, 0.18, 0.82) };
}

/* ---------------- planning ---------------- */

MAD.apply = (project, audio, plan) => {
  if (!plan || !plan.cuts || !plan.lines) return plan;
  if (project.centerFree) return plan;                          // the two-band mode has its own geometry
  const W = plan.W, H = plan.H, st = plan.style, fx = plan.fx;
  const timing = MAD.wordTiming(project, plan, audio);
  const secs = MAD.sections(plan, timing, audio);
  const ov = project.overrides || {};
  const skip = plan.lines.map((ln, li) => {
    if (ln.interlude || !ln.text) return true;
    const o = ov[li] || {};
    return !!(o.lock || o.layout || o.enter || o.exit || o.hold || o.decor || o.treat || o.single || o.cuts || o.bg || o.cam || o.cutTech || o.cutLayouts);
  });
  const backupCuts = plan.cuts.slice(), backupEvents = plan.events.slice();
  const oldScheme = {};
  plan.cuts.forEach(c => { if (c.line >= 0 && oldScheme[c.line] == null) oldScheme[c.line] = c.scheme | 0; });
  const removed = new Set();
  plan.cuts.forEach(c => { if (c.line >= 0 && !skip[c.line]) removed.add(c); });
  if (!removed.size) return plan;
  // old accents that belonged to the removed cuts (and any lying inside those lines) go away
  const oldRanges = plan.lines.map((ln, li) => skip[li] ? null : [ln.start - 0.03, ln.end + 0.03]);
  plan.events = plan.events.filter(e => {
    const own = plan.evOwner && plan.evOwner.get(e);
    if (own && removed.has(own)) return false;
    for (const r of oldRanges) if (r && e.t >= r[0] && e.t <= r[1]) return false;
    return true;
  });
  plan.cuts = plan.cuts.filter(c => !removed.has(c));

  const keyCache = new Map();
  const newCuts = [];
  const forced = { hit: false, slot: false };
  const pushEv = (t, type, amp, dur, cut) => {
    const e = { t: Math.max(0, t), type, amp, dur };
    plan.events.push(e);
    if (plan.evOwner) plan.evOwner.set(e, cut);
  };
  const F = 1 / 24;
  let prevCut = plan.cuts.filter(c => c.start < (plan.lines[0] ? plan.lines[0].start : 0)).sort((a, b) => a.end - b.end).pop() || null;

  plan.lines.forEach((ln, li) => {
    if (skip[li]) return;
    const T = timing[li];
    if (!T || !T.words.length) return;
    const sec = secs[li] || { kind: 'verse', intensity: 0.4 };
    const rng = J.rng(J.h(project.seed, li + 1, 0x4d4144));
    const cacheKey = normText(ln.text) + '|' + sec.kind;
    let acts = keyCache.get(cacheKey);
    if (!acts) {
      acts = [];
      let prev = null;
      T.words.forEach((w, k) => {
        let a = pickAction(sec, w, k, T.words.length, prev, rng);
        // guarantee the vocabulary: stroke on a strong line, match between lines, slot now and then
        if (k === 1 && (sec.kind === 'pre' || sec.kind === 'chorus') && rng() < 0.55) a = 'stroke';
        if (k === 2 && sec.kind === 'chorus' && rng() < 0.45) a = 'slot';
        acts.push(a); prev = a;
      });
      if (sec.kind === 'chorus' && acts.length) {
        acts[0] = 'hit';
        if (acts.length > 2) acts[2] = 'echo';
        if (acts.length > 5) acts[4] = 'slice';
      }
      if (!forced.hit && (ln.impact || sec.kind === 'chorus') && acts.length) { acts[0] = 'hit'; forced.hit = true; }
      if (!forced.slot && acts.length > 2) { acts[2] = 'slot'; forced.slot = true; }
      if (acts.length > 1 && rng() < 0.5) acts[acts.length - 1] = 'through';
      keyCache.set(cacheKey, acts.slice());
    }
    const scheme = (st.schemes && st.schemes.length > 1 && sec.kind === 'chorus')
      ? ((oldScheme[li] || 0) + 1) % st.schemes.length
      : (oldScheme[li] != null ? oldScheme[li] : 0);
    let localPrev = prevCut;
    T.words.forEach((w, k) => {
      let cs = T.times[k].start;
      let ce = k + 1 < T.times.length ? T.times[k + 1].start : Math.max(ln.end, cs + 0.12);
      if (localPrev && cs < localPrev.end) cs = localPrev.end;   // hard cuts never overlap
      if (!(ce > cs)) ce = cs + 0.075;
      if (k === T.words.length - 1) ce = Math.max(ce, Math.min(plan.duration, ln.end));
      let action = acts[k];
      const matchable = k === 0 && localPrev && Math.abs(localPrev.end - cs) < 0.06 && sec.kind !== 'chorus' && rng() < 0.4;
      if (matchable) action = 'match';
      const A = ACTION[action] || ACTION.hit;
      const text = String(w.text || '').trim();
      if (!text) return;
      const sizeK = (w.func ? 0.82 : 1) * (w.emo ? 1.10 : 1) * (action === 'echo' ? 1.04 : 1);
      const font = (st.fonts.display && st.fonts.display[0]) || 'gothic_black';
      const probe = Math.min(J.fitSize(text, font, W * 0.82, H * 0.50, { track: 0.03 }), H * 0.44) * sizeK;
      const pos = action === 'mask' ? { x: 0.5, y: 0.5 } : posOf(sec, k, rng);
      const dur = ce - cs;
      const inDur = A.inDur > 0 ? Math.min(A.inDur, dur * 0.72) : dur;
      const cut = {
        text, lineText: ln.text, note: ln.note || null, line: li,
        start: cs, end: ce, dur, layout: 'mad',
        enter: A.enter, exit: 'cut', hold: (sec.kind === 'chorus' && A.hold === 'still') ? 'beatPulse' : A.hold, inDur, outDur: 0,
        params: { font, sizeK, pos, track: action === 'track' ? 0.08 : 0.03, action },
        decor: [], scheme, seed: J.h(ln.seed, k, 13), emph: !!w.emo || (ln.emph || []).some(x => text.includes(x) || String(x).includes(text)),
        recap: false, words: [text], stagger: 0, treat: 'none', treatP: {},
        bg: 'none', bgP: {}, cam: 'still', camP: {},
        trans: null, transP: {}, transDur: 0, utext: text, action,
        pos: { x: pos.x, y: pos.y }, size: probe, charTimes: [],
        wordIndex: k, wordCount: T.words.length,
      };
      // per-character times inside the word (step / slot)
      const chars = [...text.replace(/\s/g, '')];
      const n = Math.max(1, chars.length);
      for (let i = 0; i < n; i++) cut.charTimes.push(dur * i / n);
      // the previous word of the same line ends exactly where this one starts (hard cut, no exit)
      if (localPrev && Math.abs(localPrev.end - cs) < 0.08) { localPrev.exit = 'cut'; localPrev.outDur = 0; }
      // 穿字: the previous word rushes into the lens, this one comes out of it
      if (action === 'through' && localPrev) { localPrev.hold = 'rushOut'; }
      // 匹配切: start where the previous word rested
      if (action === 'match' && localPrev) {
        cut.enter = 'match';
        cut.matchFrom = { x: localPrev.pos.x, y: localPrev.pos.y, size: localPrev.size };
      }
      // accents: 1-frame flash, 2-frame shake, only on the words that carry the beat
      const strong = w.emo || ln.impact || sec.kind === 'chorus' && k === 0;
      if (action === 'hit' || action === 'echo') {
        if (k === 0 || strong || rng() < 0.35) pushEv(cs, 'flash', 0.72, F, cut);
        pushEv(cs, 'shake', 0.55 + sec.intensity * 0.5, 2 * F, cut);
        pushEv(cs, 'chroma', 0.7 + sec.intensity * 0.6, 2 * F, cut);
      } else if (action === 'slice') {
        pushEv(cs, 'shake', 0.45 + sec.intensity * 0.35, 2 * F, cut);
      } else if (action === 'stroke') {
        pushEv(cs, 'invert', 1, F, cut);
      }
      if (k === 0 && sec.kind === 'chorus') { pushEv(cs, 'flash', 0.9, 2 * F, cut); pushEv(cs, 'zoom', 0.7, 3 * F, cut); }
      const on = onsetNear((audio && audio.onsets) || plan.onsets, cs, 0.055);
      if (on && on.amp > 0.72) pushEv(cs, 'shake', 0.5 + on.amp * 0.6, 2 * F, cut);
      if (on && on.amp > 0.86 && sec.kind === 'chorus' && action !== 'hit' && action !== 'echo') pushEv(cs, 'flash', 0.55, F, cut);
      newCuts.push(cut);
      localPrev = cut;
      if (plan.evOwner && !cut._ownerSet) cut._ownerSet = true;
    });
    if (localPrev) prevCut = localPrev;
  });
  if (!newCuts.length) { plan.cuts = backupCuts; plan.events = backupEvents; return plan; }
  plan.cuts.push(...newCuts);
  plan.cuts.sort((a, b) => a.start - b.start);
  plan.cuts.forEach((c, i) => { c.index = i; delete c.durOwn; c.dur = Math.max(0.02, c.end - c.start); });
  plan.events.sort((a, b) => a.t - b.t);
  plan.choreo = true;
  plan.garnish = !!project.garnish;
  plan.onsets = (audio && audio.onsets) || plan.onsets || null;
  plan.mad = {
    version: 2,
    sections: secs.map((s, i) => ({ line: i, kind: s.kind, intensity: +s.intensity.toFixed(2) })),
    words: timing.filter(Boolean).map(t => ({ line: t.line, words: t.words.map((w, i) => ({ w: w.text, start: +t.times[i].start.toFixed(3), end: +t.times[i].end.toFixed(3), kind: w.func ? 'func' : w.emo ? 'emo' : 'content' })) })),
    actions: newCuts.map(c => c.action),
    onsets: plan.onsets ? plan.onsets.length : 0,
  };
  plan.duration = Math.max(plan.duration, ...plan.cuts.map(c => c.end), 0.1);
  return plan;
};

MAD.sheet = (plan) => {
  if (!plan || !plan.mad) return '';
  const out = [];
  for (const line of plan.mad.words) {
    for (const w of line.words) out.push([line.line + 1, w.w, w.start.toFixed(3), w.end.toFixed(3)].join('\t'));
  }
  return out.join('\n');
};
MAD.parseSheet = (text) => {
  const out = {};
  String(text || '').split(/\r?\n/).forEach(row => {
    const p = row.split(/[\t,|]/).map(x => x.trim());
    if (p.length < 4) return;
    const li = Math.max(1, parseInt(p[0], 10)) - 1;
    const w = p[1], s = +p[2], e = +p[3];
    if (!w || !isFinite(s) || !isFinite(e) || e <= s) return;
    (out[li] || (out[li] = [])).push({ w, start: s, end: e });
  });
  return out;
};

/* ---------------- renderer bits ---------------- */

/* camera: no slow push per word — every cut would otherwise jump its own scale */
J.CAMERA.still = { name: '固定', get: () => ({}) };

/* layout: one word, one visual focus, vertical centring follows the action's position */
J.LAYOUTS.mad = {
  name: '重击单词', fits: () => true, special: true,
  plan: () => ({}),
  render(env) {
    const cut = env.cut, P = cut.params || {}, W = env.W, H = env.H, sc = env.sc;
    const text = String(cut.text || '').replace(/\n/g, ' ');
    if (!text) return null;
    const font = P.font && J.FONTS[P.font] ? P.font : ((env.st.fonts.display && env.st.fonts.display[0]) || 'gothic_black');
    const pos = P.pos || cut.pos || { x: 0.5, y: 0.5 };
    const z = cut.stage && cut.stage.text ? cut.stage.text : null;
    const base = cut.size || Math.min(J.fitSize(text, font, W * 0.82, H * 0.50, { track: 0.03 }), H * 0.44);
    const size = Math.max(12, base * (P.sizeK || 1));
    const it = {
      text, font, size, x: W * pos.x, y: H * pos.y,
      color: cut.emph ? sc.accent : sc.fg, track: P.track == null ? 0.03 : P.track,
      lead: 1.14, alpha: 1, mi: 0,
      solid: true,
    };
    // a hard accent block behind the word on impact words (a flat colour field, no paper / collage)
    if (cut.action === 'hit' || cut.action === 'echo') {
      const m = J.measure(it);
      const k = J.clamp(env.pIn, 0, 1);
      const bw = m.w * (0.55 + 0.45 * k) + size * 0.35, bh = size * 0.18;
      env.rect(it.x - bw / 2, it.y + size * 0.52, bw, Math.max(2, bh), sc.accent, 0.92 * (1 - env.pOut), false);
    }
    if (cut.action === 'mask') {
      const m = J.measure(it);
      env.rect(it.x - m.w * 0.64, it.y - m.h * 0.75, m.w * 1.28, m.h * 1.5, sc.accent, 0.10 * (1 - env.pOut), false);
    }
    // 一颗巨大的底字：不是装饰，是把画面从「字幕」拉到「版面」的锚点。
    // 逐字硬切时底字也跟着逐字出现（不剧透）；老虎机/遮罩条不画，免得抢走揭示。
    if (!['slot', 'mask'].includes(cut.action)) {
      const ghost = {
        text, font, size: z ? Math.min(size * 2.2, z.w * 1.9) : size * 2.55,
        x: z ? z.x + z.w / 2 : W * 0.5, y: z ? z.y + z.h * 0.52 : H * 0.53, color: sc.accent,
        alpha: 0.055 * (1 - env.pOut), track: 0.01, mi: 99, ghost: false, noWeight: true,
      };
      if (cut.action === 'step' && cut.charTimes) {
        ghost.charFn = (i) => (env.lt < (cut.charTimes[i] || 0) - 1e-4 ? { hide: true } : null);
      }
      env.draw(ghost);
    }
    // a thin progress rule: it tells you where you are in the line without adding a caption
    if (env.pass === 'main' && cut.wordCount > 1) {
      const px = z ? z.x : W * 0.08, pw = z ? z.w : W * 0.84;
      const y = z ? Math.min(H * 0.94, z.y + z.h + H * 0.018) : H * 0.895;
      const prog = J.clamp(cut.wordIndex / Math.max(1, cut.wordCount - 1));
      env.rect(px, y, pw, Math.max(1, H * 0.0012), sc.fg, 0.14 * (1 - env.pOut), false);
      env.rect(px, y - H * 0.001, Math.max(2, pw * prog), Math.max(2, H * 0.0022), sc.accent, 0.88 * (1 - env.pOut), false);
    }
    it.matchFrom = cut.matchFrom || null;
    it.charTimes = cut.charTimes || null;
    const bb = J.mainDraw(env, it);
    cut._box = { x: it.x, y: it.y, size };
    // bilingual secondary track: only when the line has a translation after |
    if (cut.note && String(cut.note).trim() && String(cut.note).trim() !== text) {
      env.draw({
        text: String(cut.note).trim(), font: (env.st.fonts.body && env.st.fonts.body[0]) || 'gothic_med',
        size: Math.max(11, Math.min(H * 0.028, size * 0.24)), x: W / 2, y: Math.min(H * 0.93, it.y + size * 0.72),
        track: 0.16, color: sc.sub, alpha: 0.9 * J.clamp(env.pIn * 2), ghost: false,
      });
    }
    return bb;
  },
};

/* ---------------- ten entrances / holds ---------------- */

J.ENTER.hit = {
  name: '重击', apply(env, it, p) {
    const e = E.outBack(p, 1.15);
    it.size *= 1 + (1 - e) * 0.52;
    it.alpha = (it.alpha ?? 1) * (p > 0.001 ? 1 : 0);
    it.track = (it.track || 0) + (1 - e) * 0.015;
    it.blur = (it.blur || 0) + (1 - e) * 1.6;
  },
};
J.ENTER.stepIn = {
  name: '逐字', apply(env, it) {
    const ts = it.charTimes || [];
    it.charFns.push((i) => {
      const t = ts[i] != null ? ts[i] : (ts.length ? ts[ts.length - 1] + 0.06 * (i - ts.length + 1) : 0);
      return env.lt < t - 1e-4 ? { hide: true } : null;
    });
    it.alpha = 1;
  },
};
J.ENTER.rushIn = {
  name: '穿字入', apply(env, it, p) {
    const e = E.outExpo(p);
    it.size *= J.lerp(2.35, 1, e);
    it.blur = (it.blur || 0) + (1 - e) * 14;
    it.alpha = (it.alpha ?? 1) * Math.min(1, p * 4);
  },
};
J.ENTER.maskBar = {
  name: '遮罩条', apply(env, it, p) {
    const e = E.outExpo(J.clamp(p * 1.2));
    const m = it._m || (it._m = J.measure(it));
    const dir = (it.seed | 0) % 2 ? 1 : -1;
    const x0 = it.x - m.w / 2 - it.size * 0.35, x1 = it.x + m.w / 2 + it.size * 0.35;
    const edge = dir > 0 ? J.lerp(x0, x1, e) : J.lerp(x1, x0, e);
    it.clip = dir > 0 ? [x0 - 4000, edge] : [edge, x1 + 4000];
    it.wipeBar = e < 0.995 ? { x: edge, h: m.h * 1.25 + it.size * 0.2 } : null;
  },
};
J.ENTER.slotRoll = {
  name: '老虎机', apply(env, it) {
    const ts = it.charTimes || [];
    const pool = J.pool ? J.pool('reel') : '0123456789';
    it.charFns.push((i, g) => {
      const t0 = ts[i] != null ? ts[i] : 0;
      const local = env.lt - t0;
      if (local < 0) return { hide: true };
      const settle = 0.15 + (i % 4) * 0.025;
      if (local >= settle) return null;
      const k = local / settle;
      return {
        ch: pool[(Math.floor(env.t * 28) + i * 7) % pool.length],
        dy: (1 - k) * it.size * 0.85,
        clipY: [-0.62, 0.62],
        blur: (1 - k) * 4,
        a: 0.55 + 0.45 * k,
      };
    });
    it.alpha = 1;
  },
};
J.ENTER.trackPop = {
  name: '字距', apply(env, it, p) {
    const e = E.outExpo(p);
    it.track = (it.track || 0) + (1 - e) * 0.42;
    it.size *= 1 + (1 - e) * 0.05;
  },
};
J.ENTER.sliceHit = {
  name: '切片', apply(env, it, p) {
    const dx = Math.cos(p * Math.PI * 2.4) * it.size * 0.22 * (1 - p);
    it.bands = J.itemBands(env, it, 7, (i) => dx * (i % 2 ? 1 : -1));
  },
};
J.ENTER.strokeFlash = {
  name: '描边闪切', apply(env, it, p) {
    const on = env.step % 2 === 0 && p < 0.55;
    it.fill = !on;
    if (on) { it.stroke = Math.max(2, it.size * 0.032); it.strokeColor = env.sc.accent; }
    else it.stroke = 0;
  },
};
J.ENTER.match = {
  name: '匹配切', apply(env, it, p) {
    const from = it.matchFrom;
    if (!from) return;
    const e = E.outExpo(p), k = 1 - e;
    it.x += (from.x - it.x) * k;
    it.y += (from.y - it.y) * k;
    if (from.size && it.size > 0) it.size *= 1 + (from.size / it.size - 1) * k;
    it.blur = (it.blur || 0) + k * 5;
  },
};

J.HOLD.echoSnap = {
  name: '残影', apply(env, it) {
    const k = J.clamp((env.lt - 0.025) / 0.30);
    const n = Math.round(J.lerp(7, 0, k));
    if (n > 0) {
      it.echo = {
        n, dx: it.size * 0.045, dy: -it.size * 0.035,
        scale: 0.94, a: 0.48 * (1 - k), decay: 0.80,
        color: env.sc.accent, outline: false,
      };
    } else it.echo = null;
  },
};
J.HOLD.strokePulse = {
  name: '描边脉冲', apply(env, it) {
    if (env.lt < 0.20) {
      const on = env.step % 2 === 0;
      it.fill = !on;
      if (on) { it.stroke = Math.max(2, it.size * 0.03); it.strokeColor = env.sc.accent; }
      else it.stroke = 0;
    } else { it.fill = true; it.stroke = 0; }
  },
};
J.HOLD.beatPulse = {
  name: '踩拍微缩放', apply(env, it, amt) {
    const b = env.beat;
    const since = b ? b.since : 0;
    const k = Math.exp(-since * 16) * (b ? 1 : 0);
    it.size *= 1 + 0.035 * amt * k;
  },
};
J.HOLD.rushOut = {
  name: '穿字出', apply(env, it) {
    const cut = env.cut;
    const left = cut.end - (cut.start + env.lt);
    if (left > 0.16) return;
    const k = J.clamp((0.16 - left) / 0.16);
    const e = E.inExpo(k);
    it.size *= J.lerp(1, 2.6, e);
    it.blur = (it.blur || 0) + e * 16;
  },
};

/* ---------------- patch J.plan ---------------- */

const basePlan = J.plan;
J.plan = function (project, audio) {
  const plan = basePlan(project, audio);
  if (!project || project.choreo === false) return plan;
  const backup = { cuts: plan.cuts.slice(), events: plan.events.slice() };
  try { return MAD.apply(project, audio, plan); }
  catch (e) {
    console.warn('MAD choreography failed, falling back to line cuts', e);
    plan.cuts = backup.cuts; plan.events = backup.events;
    return plan;
  }
};
})();
