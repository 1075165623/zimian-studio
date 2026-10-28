/* ============================================================
   字面工房 — 嵌套舞台（media stage）
   ------------------------------------------------------------
   Instead of "video as a dumb full-bleed background", a line with
   material gets a designed stage: photo panel, window, top band,
   full-bleed with a text column, or an offset card. The stage is
   stable for the whole line; word-level cuts only move inside its
   text zone. The media itself is drawn by app/studio.js
   (paintStageMedia), because only the app knows the decoded asset.

   This file also adds typographic zones for lines without material,
   so not every word sits in the exact centre of the frame.
   ============================================================ */
(() => {
'use strict';

const LAND = [
  { key: 'split',  style: 'card',   panel: { x: 0.045, y: 0.07, w: 0.40, h: 0.86 }, text: { x: 0.485, y: 0.13, w: 0.47, h: 0.74 }, align: 'left' },
  { key: 'window', style: 'window', panel: { x: 0.06,  y: 0.10, w: 0.36, h: 0.76 }, text: { x: 0.455, y: 0.17, w: 0.49, h: 0.66 }, align: 'left' },
  { key: 'band',   style: 'band',   panel: { x: 0.04,  y: 0.05, w: 0.92, h: 0.47 }, text: { x: 0.07,  y: 0.57, w: 0.86, h: 0.34 }, align: 'center' },
  { key: 'bleed',  style: 'bleed',  panel: { x: 0, y: 0, w: 1, h: 1 },             text: { x: 0.07,  y: 0.25, w: 0.46, h: 0.50 }, align: 'left' },
  { key: 'offset', style: 'card',   panel: { x: 0.065, y: 0.17, w: 0.33, h: 0.66 }, text: { x: 0.43,  y: 0.21, w: 0.52, h: 0.58 }, align: 'left' },
];
const PORT = [
  { key: 'top',    style: 'card',   panel: { x: 0.05, y: 0.05, w: 0.90, h: 0.46 }, text: { x: 0.07, y: 0.56, w: 0.86, h: 0.34 }, align: 'center' },
  { key: 'window', style: 'window', panel: { x: 0.12, y: 0.08, w: 0.76, h: 0.38 }, text: { x: 0.08, y: 0.50, w: 0.84, h: 0.40 }, align: 'center' },
  { key: 'bleed',  style: 'bleed',  panel: { x: 0, y: 0, w: 1, h: 1 },             text: { x: 0.08, y: 0.33, w: 0.84, h: 0.32 }, align: 'center' },
  { key: 'bottom', style: 'card',   panel: { x: 0.06, y: 0.50, w: 0.88, h: 0.42 }, text: { x: 0.08, y: 0.09, w: 0.84, h: 0.34 }, align: 'center' },
];
/* typographic-only zones: no photo, just a chosen place for the type */
const TYPE = [
  { key: 'hero',  style: 'type', text: { x: 0.08, y: 0.24, w: 0.84, h: 0.52 }, align: 'center' },
  { key: 'left',  style: 'type', text: { x: 0.07, y: 0.23, w: 0.57, h: 0.55 }, align: 'left' },
  { key: 'lower', style: 'type', text: { x: 0.08, y: 0.53, w: 0.84, h: 0.33 }, align: 'center' },
  { key: 'right', style: 'type', text: { x: 0.37, y: 0.23, w: 0.57, h: 0.55 }, align: 'right' },
];

const clone = o => JSON.parse(JSON.stringify(o));
J.STAGES = { LAND, PORT, TYPE };
J.stageFor = (plan, li, hasMedia, seed) => {
  const port = plan.H > plan.W * 1.06;
  const arr = hasMedia ? (port ? PORT : LAND) : TYPE;
  return clone(arr[J.h(seed | 0, li + 1, hasMedia ? 0x53544147 : 0x54595045) % arr.length]);
};

J.applyStages = (project, plan) => {
  if (!plan || !plan.lines || !plan.cuts) return plan;
  const have = new Set(project.slotLines || []);
  const W = plan.W, H = plan.H;
  plan.stages = plan.stages || {};
  plan.lines.forEach((ln, li) => {
    if (ln.interlude || !ln.text) return;
    const cuts = plan.cuts.filter(c => c.line === li);
    if (!cuts.length) return;
    const withMedia = have.has(li);
    if (!plan.choreo && !withMedia) return;              // hand-journal no-media page stays as designed
    const stage = J.stageFor(plan, li, withMedia, plan.seed | 0);
    plan.stages[li] = stage;
    for (const cut of cuts) {
      cut.stage = stage;
      cut.textZone = stage.text || null;
      if (cut.layout === 'mad') {
        const z = stage.text, P = cut.params || {};
        const slotPos = [[0.5, 0.50], [0.33, 0.40], [0.67, 0.60], [0.5, 0.28], [0.5, 0.72]];
        const q = slotPos[(cut.wordIndex || 0) % slotPos.length];
        cut.pos = { x: z.x + z.w * q[0], y: z.y + z.h * q[1] };
        const font = P.font || (plan.style.fonts.display && plan.style.fonts.display[0]) || 'gothic_black';
        const base = Math.min(J.fitSize(cut.text, font, z.w * W * 0.88, z.h * H * 0.88, { track: P.track || 0.03 }), H * (stage.style === 'type' ? 0.33 : 0.28));
        cut.size = Math.max(12, base * (P.sizeK || 1));
        cut.params = Object.assign({}, P, { font, pos: cut.pos, sizeK: P.sizeK || 1 });
      } else if (withMedia && cut.layout !== 'mad') {
        // journal material line: the stage underlay draws the card/photo,
        // this layout only places the line's type.
        cut.layout = 'stage';
        cut.params = Object.assign({}, cut.params, { font: (plan.style.fonts.display && plan.style.fonts.display[0]) || 'gothic_black' });
        cut.enter = 'cut'; cut.exit = 'cut'; cut.outDur = 0; cut.inDur = 0.12; cut.hold = 'still';
      }
    }
  });
  return plan;
};

/* line-level type for staged journal material */
J.LAYOUTS.stage = {
  name: '舞台文字', cn: '舞台文字', fits: () => true, special: true,
  plan: () => ({}),
  render(env) {
    const cut = env.cut, st = cut.stage, z = st && st.text;
    if (!z) return null;
    const { W, H, sc } = env, P = cut.params || {};
    const font = P.font || (env.st.fonts.display && env.st.fonts.display[0]) || 'gothic_black';
    const size = Math.min(J.fitSize(cut.text, font, z.w * W * 0.92, z.h * H * 0.9, { track: 0.02 }), H * 0.30);
    const left = st.align === 'left', right = st.align === 'right';
    const x = left ? z.x + z.w * 0.02 : right ? z.x + z.w * 0.98 : z.x + z.w / 2;
    return J.mainDraw(env, {
      text: cut.text, font, size, x, y: z.y + z.h / 2,
      color: sc.fg, track: 0.02, lead: 1.18,
      align: left ? 'left' : right ? 'right' : 'center', mi: 0,
    });
  },
};

/* 15_mad already wraps J.plan; wrap it once more so every genre gets stages. */
const prevPlan = J.plan;
J.plan = function (project, audio) {
  const plan = prevPlan(project, audio);
  try { return J.applyStages(project, plan); }
  catch (e) { console.warn('stage layout failed', e); return plan; }
};
})();
