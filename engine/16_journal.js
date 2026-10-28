/* ============================================================
   字面工房 — 手帐风格包（clean journal layouts）
   ------------------------------------------------------------
   Replaces the old 911-item library's paper / polaroid / postcard
   corners with two deliberately quiet layouts:
     · journalText  — one paper page, one line, one accent tape
     · journalPhoto — one photo card with the lyric beside/below it
   No film strip, no ribbon, no fake stamps, no side garnish.
   ============================================================ */
(() => {
'use strict';
const E = J.E;

const U = env => Math.min(env.W, env.H);
const FONT = (st, roles) => J.fontsOf(st, roles)[0] || 'gothic_black';
const isPort = env => env.H > env.W * 1.06;

function tape(env, x, y, w, h, col, a, rot) {
  env.ctx.save();
  env.ctx.translate(x, y);
  env.ctx.rotate((rot || 0) * J.DEG);
  env.rect(-w / 2, -h / 2, w, h, col, a, false);
  env.ctx.restore();
}

function page(env) {
  const { W, H, sc, ctx } = env;
  const u = U(env), port = isPort(env);
  const w = port ? W * 0.84 : Math.min(W * 0.74, H * 1.08);
  const h = port ? Math.min(H * 0.7, w * 1.18) : H * 0.72;
  const e = J.clamp((env.lt - 0.03) / 0.42);
  const a = J.clamp(e * 2.2) * (1 - J.clamp((env.pOut - 0.35) / 0.65));
  if (a <= 0.003) return null;
  const rise = (1 - E.outCubic(e)) * u * 0.08;
  const rot = 0;
  ctx.save();
  ctx.translate(W / 2, H / 2 + rise);
  ctx.rotate(rot * J.DEG);
  ctx.globalAlpha = a;
  ctx.shadowColor = 'rgba(0,0,0,0.28)'; ctx.shadowBlur = u * 0.05; ctx.shadowOffsetY = u * 0.018;
  env.rrect(-w / 2, -h / 2, w, h, u * 0.008, J.mix(sc.bg, '#FFFFFF', 0.45), a, false);
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  // a hairline edge and two quiet registration marks
  env.rrect(-w / 2, -h / 2, w, h, u * 0.008, null, a, false, J.rgba(sc.fg, 0.16), Math.max(1, u * 0.0018));
  env.rect(-w * 0.42, -h * 0.39, w * 0.84, Math.max(1, u * 0.0012), J.rgba(sc.fg, 0.10), a, false);
  // one tape strip, not a scrapbook pile
  tape(env, 0, -h / 2 - u * 0.005, w * 0.22, u * 0.032, J.rgba(sc.accent, 0.50), a, -2.5);
  ctx.restore();
  return { x: W / 2, y: H / 2 + rise, w, h, a, rot };
}

const journalText = {
  name: '手帐·纸页', cn: '手帐·纸页', fits: () => true, portrait: 1.2, treat: 'safe',
  plan: (rng, cut, st) => ({ font: FONT(st, ['serif', 'display']), track: rng.range(0.015, 0.06) }),
  render(env) {
    if (env.pass && env.pass !== 'main') return null;   // no chromatic ghost on paper — it reads as blur
    const p = page(env);
    if (!p) return null;
    const { W, H, sc } = env, P = env.cut.params || {}, u = U(env);
    const maxW = p.w * 0.78, maxH = p.h * 0.5;
    const size = Math.min(J.fitSize(env.cut.text, P.font, maxW, maxH, { track: P.track, lead: 1.22 }), H * 0.2);
    const bb = J.mainDraw(env, {
      text: env.cut.text, font: P.font, size, x: W / 2, y: p.y - u * 0.02,
      color: sc.fg, track: P.track, lead: 1.22, align: 'center', mi: 0, alpha: p.a,
    });
    // secondary line only when there is a real translation
    if (env.cut.note && String(env.cut.note).trim() && String(env.cut.note).trim() !== env.cut.text) {
      env.draw({
        text: String(env.cut.note).trim(), font: FONT(env.st, ['body']), size: Math.max(11, u * 0.024),
        x: W / 2, y: H / 2 + p.h * 0.34, track: 0.16, color: sc.sub,
        alpha: 0.85 * J.clamp((env.lt - 0.2) / 0.4) * (1 - env.pOut), ghost: false,
      });
    }
    // a small, date-like mark — deliberately not the fake "No. 01" filler
    env.draw({
      text: J.fmtTime(env.cut.start), font: FONT(env.st, ['mono']), size: Math.max(9, u * 0.014),
      x: W / 2, y: H / 2 + p.h * 0.43, track: 0.2, color: sc.sub, alpha: 0.42 * p.a, ghost: false,
    });
    return bb;
  },
};

const journalPhoto = {
  name: '手帐·照片', cn: '手帐·照片', fits: () => true, portrait: 1.2, treat: 'safe',
  slot: true, slots: ['photo'], needsMaterial: true,
  plan: (rng, cut, st) => ({ font: FONT(st, ['serif', 'display']), track: rng.range(0.01, 0.05) }),
  render(env) {
    if (env.pass && env.pass !== 'main') return null;   // no chromatic ghost on paper — it reads as blur
    const { W, H, sc, ctx } = env, P = env.cut.params || {}, u = U(env), port = isPort(env);
    const cardW = port ? W * 0.82 : Math.min(W * 0.84, H * 1.25);
    const cardH = port ? H * 0.68 : H * 0.72;
    const e = J.clamp((env.lt - 0.03) / 0.42);
    const a = J.clamp(e * 2.2) * (1 - J.clamp((env.pOut - 0.35) / 0.65));
    if (a <= 0.003) return null;
    const rise = (1 - E.outCubic(e)) * u * 0.06;
    const rot = (env.cut.seed % 2 ? 1 : -1) * 1.2;
    ctx.save();
    ctx.translate(W / 2, H / 2 + rise);
    ctx.rotate(rot * J.DEG);
    ctx.shadowColor = 'rgba(0,0,0,0.30)'; ctx.shadowBlur = u * 0.055; ctx.shadowOffsetY = u * 0.018;
    env.rrect(-cardW / 2, -cardH / 2, cardW, cardH, u * 0.01, J.mix(sc.bg, '#FFFFFF', 0.52), a, false);
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    const pad = u * 0.032;
    const px = -cardW / 2 + pad, py = -cardH / 2 + pad;
    const pw = port ? cardW - pad * 2 : cardW * 0.48;
    const ph = port ? cardH * 0.54 : cardH - pad * 2;
    const filled = env.slot('photo', px, py, pw, ph, { tone: 'photo', alpha: a });
    if (!filled) {
      env.rect(px, py, pw, ph, J.mix(J.mix(sc.bg, sc.fg, 0.12), sc.accent, 0.10), a, false);
      env.line([[px + pw * 0.12, py + ph * 0.2], [px + pw * 0.88, py + ph * 0.8]], J.rgba(sc.fg, 0.16), Math.max(1, u * 0.002), a, false);
      env.line([[px + pw * 0.88, py + ph * 0.2], [px + pw * 0.12, py + ph * 0.8]], J.rgba(sc.fg, 0.16), Math.max(1, u * 0.002), a, false);
    }
    // white photo border, then the lyric panel
    env.rrect(px, py, pw, ph, u * 0.004, null, a, false, J.rgba(sc.fg, 0.18), Math.max(1, u * 0.0016));
    tape(env, px + pw * 0.5, py - u * 0.012, pw * 0.34, u * 0.036, J.rgba(sc.accent, 0.55), a, -2);
    const tx = port ? -cardW / 2 + pad : px + pw + pad * 0.9;
    const ty = port ? py + ph + pad * 0.8 : -cardH / 2 + pad;
    const tw = port ? cardW - pad * 2 : cardW / 2 - pad - tx;
    const th = port ? cardH - (ph + pad * 2.2) : cardH - pad * 2;
    const size = Math.min(J.fitSize(env.cut.text, P.font, tw, th * 0.7, { track: P.track, lead: 1.18 }), H * 0.19);
    const bb = J.mainDraw(env, {
      text: env.cut.text, font: P.font, size, x: tx, y: ty + th * 0.42,
      color: sc.fg, track: P.track, lead: 1.18, align: 'left', mi: 0, alpha: a,
    });
    if (env.cut.note && String(env.cut.note).trim() && String(env.cut.note).trim() !== env.cut.text) {
      env.draw({
        text: String(env.cut.note).trim(), font: FONT(env.st, ['body']), size: Math.max(10, u * 0.021),
        x: tx, y: ty + th * 0.82, track: 0.14, color: sc.sub, alpha: 0.8 * a, ghost: false,
      });
    }
    env.draw({
      text: J.fmtTime(env.cut.start), font: FONT(env.st, ['mono']), size: Math.max(8, u * 0.013),
      x: tx, y: ty + th * 0.94, track: 0.18, color: sc.sub, alpha: 0.38 * a, ghost: false,
    });
    ctx.restore();
    return bb;
  },
};

J.register('layout', 'journalText', journalText, 'journal');
J.register('layout', 'journalPhoto', journalPhoto, 'journal');

/* The visible auto-pick pool is deliberately tiny: paper, photo, and the
   neutral teaching fallback. The 911-item library is gone from the app. */
J.LAYOUT_ORDER.length = 0;
J.LAYOUT_ORDER.push('journalText', 'journalPhoto', 'center', 'title', 'interlude');
})();
