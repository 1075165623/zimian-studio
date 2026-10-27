/* ============================================================
   TCG-PV工厂 — 构图参数渲染器（spec → 画面）
   一套参数就能画出任意参考图的骨架：大字 / 素材框 / 竖条 / 装饰 / 歌词位。
   25 个新「版式」全部是这里的预设（PRESETS），不再是 25 段硬编码。
   ============================================================ */
(() => {
'use strict';
const U = env => Math.min(env.W, env.H);
const lightest = sc => {
  let best = null, bl = -1;
  for (const c of [sc.paper, sc.bg, sc.fg, sc.sub, sc.accent2, sc.accent]) {
    if (typeof c !== 'string') continue;
    const l = J.lum(c); if (l > bl) { bl = l; best = c; }
  }
  return best || '#fff';
};
const inkOn = (sc, col) => (J.contrast(sc.fg, col) >= J.contrast(sc.bg, col) ? sc.fg : sc.bg);
const lineNo = env => ('0' + (Math.max(0, env.cut.line | 0) + 1)).slice(-2);
const tin = (env, d = 0, len = 0.4) => J.E.outCubic(J.clamp((env.lt - d) / Math.max(0.01, len)));
const MC = document.createElement('canvas').getContext('2d');
function wrapTo(text, font, size, maxW, maxLines) {
  MC.font = J.fontCSS(font, size);
  const lines = []; let cur = '';
  for (const ch of String(text || ' ')) {
    const t = cur + ch;
    if (cur && MC.measureText(t).width > maxW) { lines.push(cur); cur = ch; if (lines.length >= maxLines) return lines; }
    else cur = t;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [' '];
}
function fit(env, text, font, maxW, maxH, maxLines, maxSize) {
  let size = Math.min(maxSize || 999, maxH / Math.max(1, maxLines) / 1.15);
  let lines = wrapTo(text, font, size, maxW, maxLines);
  for (let i = 0; i < 24; i++) {
    if (lines.length * size * 1.16 <= maxH) break;
    size *= 0.9; if (size < 7) break;
    lines = wrapTo(text, font, size, maxW, maxLines);
  }
  return { text: lines.join('\n'), size: Math.max(7, size) };
}

/* ---------- 核心：按参数画 ---------- */
J.drawSpec = (env, spec) => {
  const { W, H, sc, ctx } = env, u = U(env) / 1080;
  const a = J.clamp(tin(env, 0, 0.4) * 1.7) * (1 - J.E.inCubic(env.pOut));
  if (a <= 0.01) return;
  const mono = 'mono', pal = spec.palette || [];
  const fgCol = inkOn(sc, sc.bg);
  const band = U(env) * 0.06;

  // 背景染色
  if (pal[0]) { ctx.save(); ctx.globalAlpha = a * 0.5; ctx.fillStyle = pal[0]; ctx.fillRect(0, 0, W, H); ctx.restore(); }

  // ① 背后的大字
  const bt = spec.bgText;
  if (bt && bt.text !== false) {
    const size = U(env) * (bt.size || 0.4);
    ctx.save();
    ctx.globalAlpha = a * (bt.alpha == null ? 0.85 : bt.alpha);
    ctx.translate(W * (bt.x == null ? 0.5 : bt.x), H * (bt.y == null ? 0.5 : bt.y));
    if (bt.angle) ctx.rotate(bt.angle * J.DEG);
    J.mainDraw(env, { text: env.cut.text, font: 'gothic_black', size, x: 0, y: 0, lead: 0.95, track: 0.02, color: bt.color || pal[1] || sc.accent, plain: true });
    ctx.restore();
  }

  // ② 素材框
  const s = spec.subject || {};
  const sx = W * (s.x == null ? 0.06 : s.x), sy = H * (s.y == null ? 0.04 : s.y);
  const sw = W * (s.w == null ? 0.46 : s.w), sh = H * (s.h == null ? 0.92 : s.h);
  ctx.save();
  ctx.beginPath(); ctx.rect(sx, sy, sw, sh); ctx.clip();
  env.slot('photo', sx, sy, sw, sh, { tone: s.tone || 'photo', alpha: a, fit: s.fit === 'cover' ? 'cover' : 'contain', paper: sc.bg });
  ctx.restore();
  if (s.outline) {
    ctx.save(); ctx.globalAlpha = a * 0.8; ctx.strokeStyle = s.outline; ctx.lineWidth = Math.max(2, u * (s.outlineW || 3));
    ctx.strokeRect(sx + u * 4, sy + u * 4, sw - u * 8, sh - u * 8); ctx.restore();
  }

  // ③ 竖条 / 胶囊
  (spec.rails || []).forEach(r => {
    const rx = W * r.x, ry = H * (r.y == null ? 0.05 : r.y), rw = W * r.w, rh = H * (r.h == null ? 0.9 : r.h);
    env.rrect(rx, ry, rw, rh, rw / 2, J.rgba(r.color || pal[1] || sc.accent, 0.5), a, false);
    const n = r.squares == null ? 6 : r.squares;
    for (let i = 0; i < n; i++) {
      const ss = rw * 0.42, syy = ry + rh * (0.07 + i * (0.86 / Math.max(1, n - 1)));
      env.rrect(rx + (rw - ss) / 2, syy, ss, ss, ss * 0.2, J.rgba(sc.bg, 0.92), a, false);
    }
  });

  // ④ 装饰
  const d = spec.decor || {};
  if (d.rules !== false) {
    env.line([[band, H * 0.085], [W - band, H * 0.085]], fgCol, Math.max(1, u * 1.2), a * 0.28, false);
    for (let i = 0; i <= 16; i++) { const x = band + (W - band * 2) * i / 16; env.line([[x, H * 0.085], [x, H * 0.085 - (i % 4 ? u * 5 : u * 11)]], fgCol, Math.max(1, u), a * 0.28, false); }
  }
  if (d.verticalText) {
    (d.verticalText || 'TCG-PV').split('').forEach((ch, i) => env.draw({ text: ch, font: mono, size: Math.max(9, u * 15), x: band * 0.55, y: H * 0.2 + i * u * 28, align: 'center', color: fgCol, alpha: a * 0.45, ghost: false }));
  }
  if (d.dots) {
    const step = Math.max(6, u * 11);
    for (let y = H * 0.62; y < H * 0.86; y += step) for (let x = W - band * 1.6; x < W - band * 0.3; x += step) env.circle(x, y, Math.max(1, u * 1.6), fgCol, null, 0, a * 0.22, false);
  }
  (d.blocks || []).forEach(b => env.rect(W * b.x, H * b.y, W * b.w, H * b.h, b.color || sc.accent, a * (b.alpha == null ? 0.85 : b.alpha), false));
  if (d.caps) env.draw({ text: (d.capsText || 'MOST IS WHEN YOU TALK ABOUT ZODIAC COMPATIBILITY.'), font: mono, size: Math.max(9, u * 13), track: 0.12, x: sx + sw * 0.06, y: sy + sh * 0.1, align: 'left', color: fgCol, alpha: a * 0.5, ghost: false });
  env.draw({ text: 'SCENE ' + lineNo(env) + '  ·  ' + J.fmtTime(env.cut.start), font: mono, size: Math.max(9, u * 12), track: 0.14, x: band, y: H * 0.95, align: 'left', color: fgCol, alpha: a * 0.45, ghost: false });

  // ⑤ 歌词
  const ly = spec.lyric || {};
  const zone = ly.zone || 'bottom-left';
  const tw = W * (ly.w || 0.4), th = H * (ly.h || 0.18);
  let lx = W * 0.06, lyy = H * 0.78;
  if (zone === 'bottom-right') { lx = W * 0.94 - tw; lyy = H * 0.78; }
  else if (zone === 'top-left') { lx = W * 0.06; lyy = H * 0.1; }
  else if (zone === 'top-right') { lx = W * 0.94 - tw; lyy = H * 0.1; }
  else if (zone === 'center') { lx = W * 0.5 - tw / 2; lyy = H * 0.6; }
  const fb = fit(env, env.cut.text, 'gothic_black', tw, th, ly.lines || 2, U(env) * (ly.size || 0.075));
  J.mainDraw(env, { text: fb.text, font: 'gothic_black', size: fb.size, x: lx, y: lyy, align: 'left', lead: 1.06, color: ly.color || fgCol, noHold: true });
  if (d.sign) env.draw({ text: d.sign + '  ·  TCG-PV', font: mono, size: Math.max(9, u * 14), track: 0.2, x: W * 0.5, y: H * 0.96, align: 'center', color: pal[1] || sc.accent, alpha: a * 0.7, ghost: false });
};

/* ---------- 25 个预设（15 + 25 = 40 个可放素材的版式） ---------- */
const R = (x, w, y, h, extra) => Object.assign({ x, y: y == null ? 0.05 : y, w, h: h == null ? 0.9 : h }, extra || {});
const PRESETS = [
  ['specSplit', '左右分栏', { subject: R(0.03, 0.44), bgText: { size: 0.3, x: 0.72, y: 0.45, alpha: 0.5 }, lyric: { zone: 'bottom-right' }, decor: { rules: true, verticalText: 'SPLIT', caps: true }, palette: [] }],
  ['specSplitR', '右图左字', { subject: R(0.53, 0.44), bgText: { size: 0.26, x: 0.25, y: 0.4, alpha: 0.45 }, lyric: { zone: 'bottom-left' }, decor: { rules: true, verticalText: 'MIRROR' }, palette: [] }],
  ['specBigType', '大字压人', { subject: R(0.04, 0.5), bgText: { size: 0.46, x: 0.62, y: 0.5, alpha: 0.8, angle: -6 }, rails: [{ x: 0.9, y: 0.06, w: 0.06, h: 0.88, squares: 7 }], lyric: { zone: 'bottom-left', size: 0.055 }, decor: { caps: true, sign: 'T.01', verticalText: 'TCGPV' }, palette: [] }],
  ['specStrip3', '三联竖条', { subject: R(0.05, 0.28, 0.06, 0.86), bgText: { size: 0.2, x: 0.5, y: 0.16, alpha: 0.35 }, rails: [{ x: 0.36, y: 0.12, w: 0.05, h: 0.76, squares: 5 }, { x: 0.59, y: 0.12, w: 0.05, h: 0.76, squares: 5 }], lyric: { zone: 'bottom-right', w: 0.34 }, decor: { rules: true }, palette: [] }],
  ['specPosterTop', '海报压顶', { subject: R(0.12, 0.76, 0.18, 0.6), bgText: { size: 0.18, x: 0.5, y: 0.06, alpha: 0.5 }, lyric: { zone: 'bottom-left', w: 0.6, size: 0.07 }, decor: { rules: true, caps: false, verticalText: 'POSTER' }, palette: [] }],
  ['specFullBleed', '满幅压字', { subject: R(0, 1, 0, 1, { fit: 'cover' }), bgText: false, lyric: { zone: 'bottom-left', w: 0.5, size: 0.1 }, decor: { rules: true, verticalText: 'FULL' }, palette: [] }],
  ['specCardRight', '右侧卡片', { subject: R(0.58, 0.36, 0.16, 0.66), bgText: { size: 0.22, x: 0.24, y: 0.3, alpha: 0.4 }, lyric: { zone: 'top-left', w: 0.46 }, decor: { rules: true, dots: true }, palette: [] }],
  ['specCircleSide', '圆形侧栏', { subject: R(0.62, 0.34, 0.2, 0.6), bgText: { size: 0.16, x: 0.28, y: 0.72, alpha: 0.5 }, lyric: { zone: 'top-left', w: 0.5, size: 0.08 }, decor: { rules: true, caps: true, verticalText: 'CIRCLE' }, palette: [] }],
  ['specTicket', '票根', { subject: R(0.08, 0.36, 0.3, 0.4), bgText: { size: 0.14, x: 0.6, y: 0.42, alpha: 0.5 }, rails: [{ x: 0.88, y: 0.3, w: 0.05, h: 0.4, squares: 4 }], lyric: { zone: 'bottom-right', w: 0.34, size: 0.06 }, decor: { rules: true, sign: 'T.' }, palette: [] }],
  ['specMagazine', '杂志封面', { subject: R(0.06, 0.5, 0.22, 0.74), bgText: { size: 0.14, x: 0.72, y: 0.12, alpha: 0.6 }, lyric: { zone: 'top-left', w: 0.4, size: 0.05 }, decor: { rules: true, caps: true, verticalText: 'ISSUE 01' }, palette: [] }],
  ['specPolaroidWall', '拍立得墙', { subject: R(0.34, 0.32, 0.16, 0.62), bgText: false, lyric: { zone: 'bottom-left', w: 0.28, size: 0.055 }, decor: { rules: true, dots: true, verticalText: 'WALL', sign: 'T.02' }, palette: [] }],
  ['specFilmStrip', '胶片条', { subject: R(0.0, 1, 0.3, 0.4, { fit: 'cover' }), bgText: { size: 0.12, x: 0.5, y: 0.14, alpha: 0.5 }, lyric: { zone: 'bottom-left', w: 0.5, size: 0.06 }, decor: { rules: true, verticalText: 'FILM' }, palette: [] }],
  ['specIDCard', '证件横幅', { subject: R(0.06, 0.24, 0.26, 0.44), bgText: false, lyric: { zone: 'center', w: 0.42, size: 0.07 }, decor: { rules: true, caps: true, blocks: [{ x: 0.06, y: 0.06, w: 0.88, h: 0.08 }] }, palette: [] }],
  ['specComic', '漫画分格', { subject: R(0.05, 0.9, 0.06, 0.62, { fit: 'cover' }), bgText: false, lyric: { zone: 'bottom-left', w: 0.46, size: 0.06 }, decor: { rules: true, dots: true, caps: false }, palette: [] }],
  ['specWindow', '窗景侧光', { subject: R(0.16, 0.68, 0.08, 0.66), bgText: { size: 0.1, x: 0.5, y: 0.83, alpha: 0.45 }, lyric: { zone: 'bottom-right', w: 0.4, size: 0.055 }, decor: { rules: true, verticalText: 'WINDOW' }, palette: [] }],
  ['specRail', '胶囊栏', { subject: R(0.04, 0.5, 0.05, 0.9), rails: [{ x: 0.9, y: 0.05, w: 0.06, h: 0.9, squares: 8 }], bgText: { size: 0.24, x: 0.7, y: 0.5, alpha: 0.4 }, lyric: { zone: 'bottom-left', w: 0.4, size: 0.06 }, decor: { caps: true }, palette: [] }],
  ['specStack', '三层叠放', { subject: R(0.2, 0.42, 0.12, 0.7), bgText: { size: 0.16, x: 0.76, y: 0.72, alpha: 0.4 }, lyric: { zone: 'top-left', w: 0.34, size: 0.05 }, decor: { rules: true, blocks: [{ x: 0.68, y: 0.08, w: 0.26, h: 0.04 }] }, palette: [] }],
  ['specDuo', '双联', { subject: R(0.04, 0.44, 0.08, 0.8), bgText: { size: 0.1, x: 0.5, y: 0.92, alpha: 0.4 }, lyric: { zone: 'top-right', w: 0.34, size: 0.05 }, decor: { rules: true, verticalText: 'DIARY' }, palette: [] }],
  ['specBanner', '横幅标题', { subject: R(0.08, 0.84, 0.2, 0.5, { fit: 'cover' }), bgText: false, lyric: { zone: 'bottom-left', w: 0.7, size: 0.08 }, decor: { rules: true, blocks: [{ x: 0.08, y: 0.08, w: 0.84, h: 0.06 }] }, palette: [] }],
  ['specCorner', '角贴', { subject: R(0.34, 0.44, 0.2, 0.58), bgText: { size: 0.2, x: 0.12, y: 0.16, alpha: 0.35 }, lyric: { zone: 'bottom-left', w: 0.3, size: 0.055 }, decor: { rules: true, dots: true, caps: true }, palette: [] }],
  ['specVertical', '竖排刊头', { subject: R(0.56, 0.4, 0.06, 0.88), bgText: { size: 0.12, x: 0.2, y: 0.5, alpha: 0.4 }, lyric: { zone: 'top-left', w: 0.44, size: 0.045 }, decor: { rules: true, verticalText: 'TCG-PV' }, palette: [] }],
  ['specSticker', '贴纸叠图', { subject: R(0.28, 0.36, 0.24, 0.52), bgText: { size: 0.26, x: 0.5, y: 0.1, alpha: 0.45 }, lyric: { zone: 'bottom-left', w: 0.4, size: 0.06 }, decor: { rules: true, sign: 'T.03', verticalText: 'STICKER' }, palette: [] }],
  ['specBackCover', '封底', { subject: R(0.12, 0.3, 0.22, 0.5), bgText: { size: 0.14, x: 0.62, y: 0.3, alpha: 0.4 }, lyric: { zone: 'bottom-right', w: 0.4, size: 0.05 }, decor: { rules: true, blocks: [{ x: 0.12, y: 0.86, w: 0.76, h: 0.006, color: null }], sign: 'T.04' }, palette: [] }],
  ['specBleedText', '满幅压字二', { subject: R(0, 1, 0, 1, { fit: 'cover' }), bgText: { size: 0.34, x: 0.62, y: 0.66, alpha: 0.7, angle: 4 }, lyric: { zone: 'top-left', w: 0.44, size: 0.07 }, decor: { rules: true, verticalText: 'BLEED' }, palette: [] }],
  ['specSplit2', '上下分割', { subject: R(0.06, 0.88, 0.06, 0.46, { fit: 'cover' }), bgText: { size: 0.16, x: 0.3, y: 0.78, alpha: 0.4 }, lyric: { zone: 'bottom-right', w: 0.44, size: 0.07 }, decor: { rules: true, caps: true }, palette: [] }],
];

for (const [key, name, spec] of PRESETS) {
  if (J.LAYOUTS[key]) continue;
  J.register('layout', key, {
    name, tags: ['pop', 'emotional', 'calm'], w: 0.85, ae: 'center', slot: true, needsMaterial: true, slots: ['photo'],
    fits: n => n >= 1 && n <= 26,
    plan: () => ({}),
    render(env) { J.drawSpec(env, spec); return null; },
  }, 'spec');
}
})();
