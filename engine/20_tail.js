/* ============================================================
   字面工房 — 收尾：不让片尾留一条空尾巴
   ------------------------------------------------------------
   The audio often runs a second or two past the last lyric. The old
   planner left that as an empty stretch (or a tiny ambient cut with no
   type), so the timeline showed a bare tail. This final wrapper:
     · small tail (≤ 4 s): extend the last content cut to the project end,
       keep its camera moving, and remove the overlapping ambient cut;
     · longer tail: keep a real ambient cut and give it a moving camera /
       decoration instead of a blank frame.
   It runs after sentence/stage/MAD, so it works in free-library mode too.
   ============================================================ */
(() => {
'use strict';

const TAIL_MERGE = 4.0;

J.fillTail = (project, plan) => {
  if (!plan || !Array.isArray(plan.cuts) || !plan.cuts.length) return plan;
  const dur = +plan.duration || 0;
  if (!(dur > 0.2)) return plan;
  const content = plan.cuts
    .filter(c => c && c.line >= 0 && c.text && !c.ambient && c.end <= dur + 0.1)
    .sort((a, b) => a.end - b.end);
  const last = content[content.length - 1];
  if (!last) return plan;
  const tail = dur - last.end;
  if (tail <= 0.08) return plan;

  if (tail <= TAIL_MERGE) {
    // merge the small tail into the last content shot
    plan.cuts = plan.cuts.filter(c => !(c.ambient && c.start >= last.end - 0.05));
    last.end = dur;
    last.dur = Math.max(0.02, last.end - last.start);
    last.exit = 'cut'; last.outDur = 0;
    if (last.cam === 'still') {
      last.cam = J.CAMERA.slowPush ? 'slowPush' : 'push';
      last.camP = {};
    }
    // one quiet motion accent at the join, never a new type block
    if (!plan.events.some(e => e.type === 'zoom' && Math.abs(e.t - (last.end - 0.45)) < 0.2)) {
      plan.events.push({ t: Math.max(last.start + 0.1, last.end - 0.45), type: 'zoom', amp: 0.35, dur: 3 / 24 });
    }
    plan.events.sort((a, b) => a.t - b.t);
    const ln = plan.lines && plan.lines[last.line];
    if (ln) { ln.end = Math.max(ln.end || 0, dur); ln.visEnd = Math.max(ln.visEnd || 0, dur); }
    last.tailMerged = true;
  } else {
    // long instrumental tail: keep an ambient shot, but give it life
    let amb = plan.cuts.find(c => c.ambient && c.end > last.end + 0.1);
    if (!amb) {
      const r = J.rng(J.h(plan.seed | 0, 0x5441494c));
      const bgs = (J.BG_ORDER || []).filter(k => k !== 'none' && J.BG && J.BG[k]);
      const bg = bgs.length ? bgs[r.int(0, bgs.length - 1)] : 'none';
      amb = {
        text: '', lineText: '', line: -1, start: last.end, end: dur,
        layout: 'interlude', ambient: true, enter: 'blur', exit: 'blur',
        hold: 'still', inDur: 0.28, outDur: 0.28,
        params: { variant: 'ambient', showTitle: false },
        decor: [], scheme: (last.scheme | 0), seed: J.h(plan.seed | 0, 0x5441494c),
        bg: J.BG[bg] ? bg : 'none', bgP: {}, cam: J.CAMERA.driftDiag ? 'driftDiag' : 'push', camP: {},
        trans: null, transP: {}, transDur: 0,
      };
      plan.cuts.push(amb);
      plan.cuts.sort((a, b) => a.start - b.start);
      plan.cuts.forEach((c, i) => { c.index = i; c.dur = Math.max(0.02, c.end - c.start); });
    }
    if (amb) {
      amb.cam = J.CAMERA.driftDiag ? 'driftDiag' : 'push';
      if (!amb.decor || !amb.decor.length) {
        const keys = (J.DECOR_ORDER || []).filter(k => J.DECOR && J.DECOR[k] && J.DECOR[k].subtle);
        if (keys.length) {
          const r = J.rng(J.h(plan.seed | 0, 0x5441494c, 2));
          amb.decor = [{ id: keys[r.int(0, keys.length - 1)], seed: r.int(1, 1e9), n: 2, right: false, low: false, accent: false, corner: true, big: false, mode: 'count', from: 0, to: 99, v: 1, r: r() }];
        }
      }
      amb.tailMerged = false;
    }
  }
  return plan;
};

const prev = J.plan;
J.plan = function (project, audio) {
  const plan = prev(project, audio);
  try { return J.fillTail(project, plan); }
  catch (e) { console.warn('tail fill failed', e); return plan; }
};
})();
