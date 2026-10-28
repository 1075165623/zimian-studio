/* ============================================================
   字面工房 — 场景层：克制的背景 / 句级镜头 / 句间转场
   ------------------------------------------------------------
   Backgrounds are chosen by the section in 18_sentence.js, not at
   random. They all read the absolute time env.t, so a background
   does not restart when a word cut changes.
   ============================================================ */
(() => {
'use strict';
const E = J.E;

const bg = (key, def) => J.register('bg', key, def, 'scene');
const cam = (key, def) => { J.CAMERA[key] = Object.assign({ name: key }, def); if (!J.CAMERA_ORDER.includes(key)) J.CAMERA_ORDER.push(key); };
const trans = (key, def) => { J.TRANS[key] = Object.assign({ name: key }, def); if (!J.TRANS_ORDER.includes(key)) J.TRANS_ORDER.push(key); };

/* ---------------- backgrounds ---------------- */

bg('lyricWall', {
  name: '歌词墙', subtle: true,
  draw(env) {
    const { ctx, W, H, sc } = env, t = env.t || 0;
    const lines = (env.plan.lines || []).filter(l => l.text).slice(0, 10);
    const size = H * 0.052;
    ctx.save(); ctx.globalAlpha = 0.042;
    lines.forEach((l, i) => {
      const dir = i % 2 ? 1 : -1;
      const x = W * 0.5 + dir * ((t * 7 + i * 37) % (W * 0.45));
      const y = H * (0.12 + i * 0.085);
      ctx.font = J.fontCSS ? J.fontCSS('gothic_med', size) : `${size}px sans-serif`;
      ctx.fillStyle = sc.sub; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(l.text).slice(0, 18), x, y);
    });
    ctx.restore();
  },
});

bg('splitBlocks', {
  name: '色块分割',
  draw(env) {
    const { W, H, sc } = env, t = env.t || 0;
    const a = 0.10 + 0.02 * Math.sin(t * 0.7);
    env.rect(-W * 0.02, 0, W * 0.18, H, sc.accent, a, false);
    env.rect(W * 0.86, H * 0.18, W * 0.16, H * 0.82, sc.accent2, a * 0.8, false);
    env.rect(W * 0.18, H * 0.84, W * 0.55, H * 0.10, sc.sub, 0.09, false);
  },
});

bg('gridCross', {
  name: '网格十字',
  draw(env) {
    const { W, H, sc, ctx } = env;
    ctx.save(); ctx.globalAlpha = 0.10; ctx.strokeStyle = sc.sub; ctx.lineWidth = 1;
    for (let i = 1; i < 12; i++) { const x = W * i / 12; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let j = 1; j < 8; j++) { const y = H * j / 8; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.globalAlpha = 0.18;
    for (let i = 1; i < 12; i += 2) for (let j = 1; j < 8; j += 2) {
      const x = W * i / 12, y = H * j / 8, r = Math.min(W, H) * 0.012;
      ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke();
    }
    ctx.restore();
  },
});

bg('beatRings', {
  name: '节拍同心圆',
  draw(env) {
    const { W, H, sc, ctx } = env, t = env.t || 0;
    const b = env.beat || null;
    const pulse = b ? Math.exp(-b.since * 13) : 0;
    const cx = W * 0.5, cy = H * 0.5, u = Math.min(W, H);
    ctx.save();
    for (let i = 0; i < 5; i++) {
      const r = u * (0.18 + i * 0.09) * (1 + 0.035 * pulse);
      ctx.globalAlpha = (0.10 - i * 0.014) * (1 + pulse * 1.5);
      ctx.strokeStyle = i % 2 ? sc.accent : sc.sub; ctx.lineWidth = Math.max(1, u * 0.002);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, J.TAU); ctx.stroke();
    }
    ctx.restore();
  },
});

bg('speedLines', {
  name: '速度线',
  draw(env) {
    const { W, H, sc, ctx } = env, t = env.t || 0;
    ctx.save(); ctx.globalAlpha = 0.10; ctx.strokeStyle = sc.fg; ctx.lineWidth = Math.max(1, Math.min(W, H) * 0.0016);
    for (let i = 0; i < 34; i++) {
      const a = i / 34 * J.TAU + Math.sin(t * 0.2 + i) * 0.05;
      const r0 = Math.min(W, H) * (0.55 + J.r(i, 7) * 0.15), r1 = r0 + Math.min(W, H) * (0.18 + J.r(i, 8) * 0.22);
      ctx.beginPath(); ctx.moveTo(W / 2 + Math.cos(a) * r0, H / 2 + Math.sin(a) * r0);
      ctx.lineTo(W / 2 + Math.cos(a) * r1, H / 2 + Math.sin(a) * r1); ctx.stroke();
    }
    ctx.restore();
  },
});

bg('timecode', {
  name: '时间码',
  draw(env) {
    const { W, H, sc, ctx } = env, t = env.t || 0, u = Math.min(W, H);
    ctx.save();
    ctx.globalAlpha = 0.16; ctx.fillStyle = sc.fg; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.font = J.fontCSS ? J.fontCSS('mono', u * 0.024) : `${u * 0.024}px monospace`;
    ctx.fillText(J.fmtTime(t, 24), W * 0.94, H * 0.92);
    ctx.textAlign = 'left'; ctx.globalAlpha = 0.10;
    ctx.fillText('SCENE  ' + String((env.cut.line | 0) + 1).padStart(2, '0'), W * 0.06, H * 0.90);
    ctx.restore();
  },
});

bg('inkLine', {
  name: '手绘线',
  draw(env) {
    const { W, H, sc, ctx } = env, t = env.t || 0;
    const p = (t * 0.9) % 2;
    const e = p < 1 ? E.outExpo(p) : 1;
    ctx.save(); ctx.globalAlpha = 0.18; ctx.strokeStyle = sc.accent; ctx.lineWidth = Math.max(1, H * 0.003);
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const x = W * (0.10 + i / 24 * 0.80 * e);
      const y = H * (0.74 + Math.sin(i * 0.9 + t * 1.2) * 0.012);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke(); ctx.restore();
  },
});

bg('leak', {
  name: '漏光',
  draw(env) {
    const { W, H, sc, ctx } = env, t = env.t || 0;
    ctx.save();
    const g = ctx.createRadialGradient(W * 0.78, H * 0.18, 0, W * 0.78, H * 0.18, Math.hypot(W, H) * 0.6);
    g.addColorStop(0, J.rgba(sc.accent, 0.18 + 0.04 * Math.sin(t * 0.5))); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const g2 = ctx.createRadialGradient(W * 0.16, H * 0.80, 0, W * 0.16, H * 0.80, Math.hypot(W, H) * 0.5);
    g2.addColorStop(0, J.rgba(sc.accent2, 0.12)); g2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  },
});

bg('softField', {
  name: '柔和渐变',
  draw(env) {
    const { W, H, sc, ctx } = env;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, J.rgba(sc.accent, 0.08)); g.addColorStop(0.5, 'rgba(0,0,0,0)'); g.addColorStop(1, J.rgba(sc.accent2, 0.10));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  },
});

/* ---------------- cameras ---------------- */
cam('slowPush', { get: env => ({ s: 1 + 0.035 * (env.fx.motion ?? 0.7) * J.clamp(env.lt / Math.max(0.3, env.cut.dur)) }) });
cam('driftDiag', { get: env => { const u = env.lt / Math.max(0.4, env.cut.dur); return { s: 1 + 0.015 * u, x: (u - 0.5) * env.W * 0.02, y: (u - 0.5) * env.H * 0.015 }; } });
cam('breath', { get: env => ({ s: 1 + 0.012 * Math.sin(env.lt * 0.9) }) });
cam('beatPunch', { get: env => { const b = env.beat; const k = b ? Math.exp(-b.since * 12) : 0; return { s: 1 + 0.06 * k }; } });
cam('roll2', { get: env => ({ s: 1 + 0.01 * Math.sin(env.lt * 0.5), rot: 1.4 * Math.sin(env.lt * 0.55) }) });
cam('handheld', { get: env => ({ x: J.noise1(env.lt * 2.1, 11) * env.W * 0.008, y: J.noise1(env.lt * 1.7, 12) * env.H * 0.006, rot: J.noise1(env.lt * 1.2, 13) * 0.8 }) });

/* ---------------- sentence transitions ---------------- */
trans('flashCut', { dur: 0.18, draw(ctx, A, B, p, info) {
  ctx.drawImage(B, 0, 0);
  if (p < 0.32) { ctx.globalAlpha = (1 - p / 0.32) * 0.9; ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, info.cw, info.ch); ctx.globalAlpha = 1; }
} });
trans('blockWipe', { dur: 0.26, draw(ctx, A, B, p, info) {
  const { cw, ch } = info; ctx.drawImage(A, 0, 0);
  const e = E.outExpo(p), n = 5, bw = cw / n;
  ctx.save(); ctx.beginPath();
  for (let i = 0; i < n; i++) { const h = ch * J.clamp(e * 1.15 - i * 0.035); ctx.rect(i * bw, 0, bw + 1, h); }
  ctx.clip(); ctx.drawImage(B, 0, 0); ctx.restore();
} });
trans('whip', { dur: 0.22, draw(ctx, A, B, p, info) {
  const { cw, ch } = info, e = E.outExpo(p);
  ctx.globalAlpha = 1 - e * 0.8; ctx.drawImage(A, -e * cw * 0.30, 0);
  ctx.globalAlpha = e; ctx.drawImage(B, (1 - e) * cw * 0.30, 0); ctx.globalAlpha = 1;
} });
trans('zoomThrough', { dur: 0.24, draw(ctx, A, B, p, info) {
  const { cw, ch } = info, e = E.outExpo(p);
  const sa = 1 + 0.35 * e, sb = 1.35 - 0.35 * e;
  ctx.globalAlpha = 1 - e; ctx.drawImage(A, cw / 2 - cw * sa / 2, ch / 2 - ch * sa / 2, cw * sa, ch * sa);
  ctx.globalAlpha = e; ctx.drawImage(B, cw / 2 - cw * sb / 2, ch / 2 - ch * sb / 2, cw * sb, ch * sb); ctx.globalAlpha = 1;
} });
trans('sliceShift', { dur: 0.22, draw(ctx, A, B, p, info) {
  const { cw, ch } = info, e = E.outExpo(p), n = 8;
  ctx.drawImage(A, 0, 0);
  for (let i = 0; i < n; i++) {
    const y = ch * i / n, h = ch / n + 1;
    const dx = (i % 2 ? 1 : -1) * e * cw * 0.08 * (1 - e);
    ctx.save(); ctx.beginPath(); ctx.rect(0, y, cw, h); ctx.clip(); ctx.drawImage(B, dx, 0); ctx.restore();
  }
} });
trans('invertFlash', { dur: 0.16, draw(ctx, A, B, p, info) {
  ctx.drawImage(B, 0, 0);
  ctx.globalCompositeOperation = 'difference'; ctx.globalAlpha = Math.max(0, 1 - p * 2.2);
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, info.cw, info.ch);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
} });

/* Keep the full library order for the advanced library, while the auto
   planner stays restrained: none/push are the defaults; 18_sentence assigns
   scene keys directly. */
J.LIB_ORDER = J.LIB_ORDER || {};
for (const g of J.GROUP_KEYS) if (!J.LIB_ORDER[g] || !J.LIB_ORDER[g].length) J.LIB_ORDER[g] = J.order(g).slice();
J.libOrder = g => (J.LIB_ORDER && J.LIB_ORDER[g] && J.LIB_ORDER[g].length ? J.LIB_ORDER[g] : J.order(g));
J.BG_ORDER.length = 0; J.BG_ORDER.push('none');
J.CAMERA_ORDER.length = 0; J.CAMERA_ORDER.push('push', 'still');
J.TRANS_ORDER.length = 0;
})();
