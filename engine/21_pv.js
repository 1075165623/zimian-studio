/* ============================================================
   PV专区 — 主时间线导演层
   PV 不是独立页面：它把 12 个分镜直接写进主 J.plan，主播放器、
   主时间线、主音频、逐行列表全部照常使用。
   ============================================================ */
(() => {
  if (!window.PV_CORE) return;
  const CORE = window.PV_CORE;
  const SCENES = CORE.scenes;

  J.PV_DEFAULT_STATE = () => ({
    title: '明知故犯',
    sub: '冷空气的气味，掺杂些许心碎',
    lyrics: CORE.defaults.lyrics.slice(),
    credits: CORE.defaults.credits.slice(),
    titleOn: true, titleX: .5, titleY: .22,
  });
  J.PV_IMAGES = [];
  J.PV_MEDIA = [];

  J.pvPlan = (project, audio) => {
    const pv = Object.assign(J.PV_DEFAULT_STATE(), project.pvState || {});
    // The right-side PV panel no longer owns lyrics: use the main lyric /
    // subtitle input, and the real audio duration when one is loaded.
    let rows = [];
    let tm = null;
    try {
      const parsed = J.parseLyrics(project.lyrics || '');
      rows = (parsed.lines || []).map((x, i) => ({ ...x, ti: i })).filter(x => x && !x.interlude && String(x.text || '').trim());
      tm = J.computeTiming(project, parsed, audio || null);
    } catch (e) {}
    if (!rows.length) rows = CORE.defaults.lyrics.map(text => ({ text }));
    const lyrics = rows.map(x => String(x.text || '').trim());
    const credits = Array.isArray(pv.credits) ? pv.credits : CORE.defaults.credits;
    const state = {
      title: pv.title || '明知故犯', sub: pv.sub || '', lyrics, credits,
      custom: J.PV_IMAGES || [], titleOn: pv.titleOn !== false,
      titleX: pv.titleX == null ? .5 : +pv.titleX, titleY: pv.titleY == null ? .22 : +pv.titleY,
    };
    const W = 1920, H = 1080;
    const audioDur = audio && +audio.duration > 0 ? +audio.duration : 0;
    const total = audioDur || +((tm && tm.duration) || CORE.DUR || 44);
    const style = J.resolveStyle ? J.resolveStyle(project) : null;
    const plan = {
      W, H, duration: total, total, lines: [], cuts: [], events: [],
      beats: [], onsets: [], style, fx: project.fx || {}, seed: project.seed | 0,
      choreo: false, pv: true, mad: null, stages: {}, sentences: [],
    };
    const n = Math.min(SCENES.length, rows.length);
    // With a full 12-line subtitle sheet, the PV blocks follow the real
    // subtitle times. With a shorter sheet, distribute the 12 fixed PV
    // compositions across the real duration; no overlapping text blocks.
    const useLineTimes = !!(tm && tm.starts && rows.length >= SCENES.length);
    SCENES.forEach((sc, i) => {
      let s, e;
      if (useLineTimes && tm.starts[rows[i].ti] != null) {
        const ti = rows[i].ti;
        s = Math.max(0, +tm.starts[ti]);
        e = Math.max(s + .2, +tm.ends[ti] || s + 1);
      } else {
        s = total * sc.s / (CORE.DUR || 44);
        e = total * sc.e / (CORE.DUR || 44);
      }
      if (i === SCENES.length - 1) e = total;
      e = Math.min(total, e);
      if (!(e > s)) e = Math.min(total, s + .2);
      const text = (lyrics[i] || '').trim();
      plan.lines.push({
        index: i, text, start: s, end: e, visEnd: e,
        note: null, impact: false, emph: [], chunks: text ? [text] : [], seed: i + 1,
      });
      plan.cuts.push({
        text, lineText: text, note: null, line: i, start: s, end: e,
        dur: e - s, layout: 'pv', enter: 'cut', exit: 'cut', hold: 'still',
        inDur: .04, outDur: 0, params: { scene: i, pvState: state },
        decor: [], scheme: 0, seed: i + 1, emph: false, words: text ? [text] : [],
        stagger: 0, treat: 'none', treatP: {}, bg: 'none', bgP: {},
        cam: 'still', camP: {}, trans: null, transP: {}, transDur: 0,
        pv: true,
      });
    });
    return plan;
  };

  J.register('layout', 'pv', {
    name: 'PV专区', cn: 'PV专区', fits: () => true, special: true,
    render(env) {
      const P = env.cut.params || {};
      const state = P.pvState || {
        title: '明知故犯', sub: '', lyrics: CORE.defaults.lyrics,
        credits: CORE.defaults.credits, custom: J.PV_IMAGES || [],
      };
      try { CORE.render(env.ctx, env.t, state, P.scene, env.cut.start); }
      catch (e) { console.warn('PV render', e); }
      return { x0: 0, y0: 0, x1: env.W, y1: env.H };
    },
  }, 'pv');

  const prev = J.plan;
  J.plan = function (project, audio) {
    if (project && project.pvMode) return J.pvPlan(project, audio);
    return prev(project, audio);
  };
})();
