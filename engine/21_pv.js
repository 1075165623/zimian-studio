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
  });
  J.PV_IMAGES = [];

  J.pvPlan = (project) => {
    const pv = Object.assign(J.PV_DEFAULT_STATE(), project.pvState || {});
    const lyrics = Array.isArray(pv.lyrics) ? pv.lyrics : CORE.defaults.lyrics;
    const credits = Array.isArray(pv.credits) ? pv.credits : CORE.defaults.credits;
    const state = { title: pv.title, sub: pv.sub, lyrics, credits, custom: J.PV_IMAGES || [] };
    const W = 1920, H = 1080, DUR = CORE.DUR || 44;
    const style = J.resolveStyle ? J.resolveStyle(project) : null;
    const plan = {
      W, H, duration: DUR, total: DUR, lines: [], cuts: [], events: [],
      beats: [], onsets: [], style, fx: project.fx || {}, seed: project.seed | 0,
      choreo: false, pv: true, mad: null, stages: {}, sentences: [],
    };
    SCENES.forEach((sc, i) => {
      const text = (lyrics[i] || lyrics[lyrics.length - 1] || '').trim();
      plan.lines.push({
        index: i, text, start: sc.s, end: sc.e, visEnd: sc.e,
        note: null, impact: false, emph: [], chunks: [text], seed: i + 1,
      });
      plan.cuts.push({
        text, lineText: text, note: null, line: i, start: sc.s, end: sc.e,
        dur: sc.e - sc.s, layout: 'pv', enter: 'cut', exit: 'cut', hold: 'still',
        inDur: .04, outDur: 0, params: { scene: i, pvState: state },
        decor: [], scheme: 0, seed: i + 1, emph: false, words: [text],
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
      try { CORE.render(env.ctx, env.t, state); }
      catch (e) { console.warn('PV render', e); }
      return { x0: 0, y0: 0, x1: env.W, y1: env.H };
    },
  }, 'pv');

  const prev = J.plan;
  J.plan = function (project, audio) {
    if (project && project.pvMode) return J.pvPlan(project);
    return prev(project, audio);
  };
})();
