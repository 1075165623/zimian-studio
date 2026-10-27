/* ============================================================
   粉色大肥鱼-文字PV — 画面框版式（frames）
   这一包全部是「素材优先」的构图：画面里一定有一个大物件（相框 / 胶片 / 屏幕 /
   漫画格 / 海报 / 证件 / 拍立得堆），素材印在物件里，歌词只待在留白处（下沿 /
   侧边 / 说明条），绝不压在照片中间。
   全部带 slot: true → planner 会给「有素材的行」优先挑它们。
   ============================================================ */
(() => {
'use strict';

/* ---------- 小工具（各 pack 的 helper 都是局部的，这里自带一份） ---------- */
const U = env => Math.min(env.W, env.H);
const isPort = env => env.H > env.W * 1.08;
const clamp = J.clamp;
const lightest = sc => {
  let best = null, bl = -1;
  for (const c of [sc.paper, sc.bg, sc.fg, sc.sub, sc.accent2, sc.accent]) {
    if (typeof c !== 'string') continue;
    const l = J.lum(c);
    if (l > bl) { bl = l; best = c; }
  }
  return best || '#ffffff';
};
const inkOn = (sc, col) => (J.contrast(sc.fg, col) >= J.contrast(sc.bg, col) ? sc.fg : sc.bg);
const paper = sc => {
  const fill = lightest(sc);
  return { fill, text: inkOn(sc, fill), line: J.mix(fill, inkOn(sc, fill), 0.22), edge: J.contrast(fill, sc.bg) < 1.35 };
};
const tin = (env, d = 0, len = 0.4) => J.E.outCubic(clamp((env.lt - d) / Math.max(0.01, len)));
const lineNo = env => ('0' + (Math.max(0, env.cut.line | 0) + 1)).slice(-2);

const MC = document.createElement('canvas').getContext('2d');
function wrapTo(text, font, size, maxW, maxLines) {
  MC.font = J.fontCSS(font, size);
  const lines = [];
  let cur = '';
  for (const ch of String(text || ' ')) {
    if (ch === '\n') { lines.push(cur); cur = ''; continue; }
    const test = cur + ch;
    if (cur && MC.measureText(test).width > maxW) {
      lines.push(cur); cur = ch;
      if (lines.length >= maxLines) return lines;
    } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [' '];
}
/* 在 (maxW × maxH) 里找最大能放下的字号 */
function fit(env, text, font, maxW, maxH, maxLines, maxSize) {
  let size = Math.min(maxSize || 999, maxH / Math.max(1, maxLines) / 1.15);
  let lines = wrapTo(text, font, size, maxW, maxLines);
  for (let i = 0; i < 26; i++) {
    const h = lines.length * size * 1.16;
    if (h <= maxH && lines.length <= maxLines) break;
    size *= 0.9;
    if (size < 7) break;
    lines = wrapTo(text, font, size, maxW, maxLines);
  }
  return { text: lines.join('\n'), size: Math.max(7, size), lines: lines.length };
}
function softShadow(env, x, y, w, h, r, a, d) {
  const ctx = env.ctx;
  ctx.save();
  try { ctx.filter = 'blur(' + Math.max(2, d * 0.5).toFixed(1) + 'px)'; } catch (e) {}
  ctx.globalAlpha = a * 0.26;
  ctx.fillStyle = '#0E1018';
  J.roundPath(ctx, x + d * 0.05, y + d * 0.28, w, h, r);
  ctx.fill();
  try { ctx.filter = 'none'; } catch (e) {}
  ctx.restore();
}
/* 半透明胶带 */
function tape(env, x, y, w, h, rot, a, tint) {
  const ctx = env.ctx;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot * J.DEG);
  ctx.globalAlpha = a * 0.72;
  ctx.fillStyle = tint || 'rgba(255,255,255,0.85)';
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.globalAlpha = a * 0.22;
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.fillRect(-w / 2, -h / 2, w, h * 0.35);
  ctx.restore();
}
/* 齿孔 / 网点之类的点缀 */
function dots(env, x, y, w, h, step, r, col, a) {
  const ctx = env.ctx;
  ctx.save();
  ctx.globalAlpha = a; ctx.fillStyle = col;
  for (let yy = y; yy < y + h; yy += step) for (let xx = x; xx < x + w; xx += step) {
    ctx.beginPath(); ctx.arc(xx, yy, r, 0, J.TAU); ctx.fill();
  }
  ctx.restore();
}

/* ============================================================
   版面装饰层：只画在四周边带里（不碰中间的素材），
   细线 / 刻度 / 竖排英文 / 大号幽灵数字 / 色块 / 网点 / 胶带 / 圆环
   —— 每个 cut 按 seed 换一套，同一支片子里不会每帧都一样。
   ============================================================ */
/* 满幅装饰层：画在主体之前，铺满整个画面（主体盖住中间），
   这样卡片左右上下那些空档里也有东西：大色块 / 圆环 / 斜带 / 网点 / 竖排字 / 罗盘刻度 */
function decorFull(env, a, sc) {
  const { W, H, ctx } = env, u = U(env) / 1080;
  const C = paper(sc);
  const ink = C.text, acc = sc.accent, acc2 = sc.accent2 || sc.accent;
  const mono = 'mono';
  const v = (env.cut.seed >>> 0) % 5;
  const s1 = Math.max(9, u * 15);
  const no = lineNo(env);

  // ① 大块面：斜色带 / 大圆 / 旋转方块（低透明度，做底纹）
  if (v === 0 || v === 2) {
    ctx.save();
    ctx.globalAlpha = a * 0.10; ctx.fillStyle = acc;
    ctx.translate(W * 0.5, H * 0.5); ctx.rotate((-22 + v * 6) * J.DEG);
    ctx.fillRect(-W, -H * 0.16, W * 2, H * 0.3);
    ctx.globalAlpha = a * 0.07; ctx.fillStyle = acc2;
    ctx.fillRect(-W, H * 0.12, W * 2, H * 0.1);
    ctx.restore();
  }
  if (v === 1 || v === 4) {
    ctx.save(); ctx.globalAlpha = a * 0.16; ctx.strokeStyle = acc2; ctx.lineWidth = Math.max(2, u * 5);
    ctx.beginPath(); ctx.arc(W * 0.12, H * 0.24, Math.min(W, H) * 0.26, 0, J.TAU); ctx.stroke();
    ctx.globalAlpha = a * 0.1; ctx.fillStyle = acc;
    ctx.beginPath(); ctx.arc(W * 0.93, H * 0.82, Math.min(W, H) * 0.2, 0, J.TAU); ctx.fill();
    ctx.restore();
  }
  if (v === 3) {
    ctx.save(); ctx.globalAlpha = a * 0.12; ctx.fillStyle = acc;
    ctx.translate(W * 0.9, H * 0.18); ctx.rotate(18 * J.DEG); ctx.fillRect(-u * 90, -u * 90, u * 180, u * 180);
    ctx.globalAlpha = a * 0.08; ctx.fillStyle = acc2; ctx.fillRect(-u * 60, -u * 60, u * 120, u * 120);
    ctx.restore();
  }

  // ② 网点块（三处随机）
  dots(env, W * 0.06, H * 0.62, W * 0.1, H * 0.22, Math.max(6, u * 11), Math.max(1, u * 1.6), ink, a * 0.22);
  dots(env, W * 0.85, H * 0.12, W * 0.09, H * 0.18, Math.max(6, u * 11), Math.max(1, u * 1.6), acc, a * 0.3);

  // ③ 左右竖排大字（贯穿整幅，最显眼的一层）
  const LW = 'TYPEMOTION'.split(''), RW = 'LYRICMOVIE2026'.split('');
  LW.forEach((ch, i) => env.draw({ text: ch, font: mono, size: Math.max(10, u * 17), x: W * 0.032, y: H * 0.18 + i * u * 30, align: 'center', color: ink, alpha: a * 0.5, ghost: false }));
  RW.forEach((ch, i) => env.draw({ text: ch, font: mono, size: Math.max(10, u * 17), x: W * 0.968, y: H * 0.14 + i * u * 30, align: 'center', color: ink, alpha: a * 0.42, ghost: false }));

  // ④ 上下标尺 + 刻度
  const topY = H * 0.075, botY = H * 0.925;
  [topY, botY].forEach((yy, k) => {
    env.line([[W * 0.05, yy], [W * 0.95, yy]], ink, Math.max(1, u * 1.2), a * 0.28, false);
    for (let i = 0; i <= 18; i++) {
      const x = W * 0.05 + W * 0.9 * i / 18;
      env.line([[x, yy], [x, yy + (k ? -1 : 1) * (i % 3 ? u * 5 : u * 11)]], ink, Math.max(1, u), a * 0.3, false);
    }
  });
  env.draw({ text: 'TYPE  /  MOTION  /  PV WORK', font: mono, size: s1, track: 0.34, x: W * 0.05, y: topY - u * 26, align: 'left', color: ink, alpha: a * 0.6, ghost: false });
  env.draw({ text: 'SCENE ' + no + '   ' + J.fmtTime(env.cut.start), font: mono, size: s1, track: 0.12, x: W * 0.95, y: topY - u * 26, align: 'right', color: ink, alpha: a * 0.55, ghost: false });

  // ⑤ 幽灵大数字
  env.draw({ text: no, font: 'gothic_black', size: u * 210, x: v % 2 ? W * 0.06 : W * 0.94, y: H * 0.78, align: v % 2 ? 'left' : 'right', color: ink, alpha: a * 0.09, ghost: false });

  // ⑥ 角落色块 + 反白小字
  const bw = Math.min(W * 0.3, u * 320), bh = u * 44;
  const bx = v % 2 ? W * 0.05 : W * 0.95 - bw, by = botY - bh * 1.6;
  env.rect(bx, by, bw, bh, acc, a * 0.85, false);
  env.draw({ text: 'PV / ' + no + '   ' + J.fmtTime(env.cut.start), font: mono, size: Math.max(9, u * 13), track: 0.12, x: bx + bw * 0.05, y: by + bh * 0.6, align: 'left', color: inkOn(sc, acc), alpha: a, ghost: false });

  // ⑦ 十字标记 + 小方块
  [[0.18, 0.2], [0.82, 0.72], [0.24, 0.86]].forEach(([px, py], i) => {
    const cx = W * px, cy = H * py, r = u * 9;
    env.line([[cx - r, cy], [cx + r, cy]], acc, Math.max(1, u * 1.6), a * 0.55, false);
    env.line([[cx, cy - r], [cx, cy + r]], acc, Math.max(1, u * 1.6), a * 0.55, false);
  });
  env.draw({ text: 'TYPE & MOTION  ·  ' + (env.cut.layout || '').toUpperCase(), font: mono, size: Math.max(8, u * 11), track: 0.28, x: W * 0.05, y: botY + u * 22, align: 'left', color: ink, alpha: a * 0.45, ghost: false });
}
function decorKit(env, a, sc) {
  const { W, H, ctx } = env, u = U(env) / 1080;
  const C = paper(sc);
  const ink = C.text, acc = sc.accent, acc2 = sc.accent2 || sc.accent;
  const mono = 'mono';
  const band = Math.min(W, H) * 0.135;
  const v = (env.cut.seed >>> 0) % 6;
  const s1 = Math.max(9, u * 15), s2 = Math.max(10, u * 19);
  const no = lineNo(env);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.rect(band, band, W - band * 2, H - band * 2);
  try { ctx.clip('evenodd'); } catch (e) { ctx.restore(); return; }

  // ① 顶部标尺：一条细线 + 刻度
  const ry = band * 0.62;
  env.line([[band, ry], [W - band, ry]], ink, Math.max(1, u * 1.2), a * 0.3, false);
  for (let i = 0; i <= 12; i++) {
    const x = band + (W - band * 2) * i / 12;
    env.line([[x, ry], [x, ry - (i % 3 ? u * 5 : u * 10)]], ink, Math.max(1, u), a * 0.3, false);
  }
  env.draw({ text: 'TYPE  /  MOTION', font: mono, size: s1, track: 0.34, x: band, y: ry - u * 34, align: 'left', color: ink, alpha: a * 0.55, ghost: false });
  env.draw({ text: 'SCENE ' + no + ' / ' + J.fmtTime(env.cut.start), font: mono, size: s1, track: 0.1, x: W - band, y: ry - u * 34, align: 'right', color: ink, alpha: a * 0.5, ghost: false });

  // 左/右竖排英文（每个变体都有，保证两侧不空）
  const LW = 'TYPE·MOTION'.split(''), RW = 'LYRIC·MOVIE·2026'.split('');
  LW.forEach((ch, i) => env.draw({ text: ch, font: mono, size: s1, x: band * 0.4, y: H * 0.26 + i * s1 * 1.5, align: 'center', color: ink, alpha: a * 0.42, ghost: false }));
  RW.forEach((ch, i) => env.draw({ text: ch, font: mono, size: Math.max(8, u * 12), x: W - band * 0.4, y: H * 0.2 + i * Math.max(8, u * 12) * 1.45, align: 'center', color: ink, alpha: a * 0.34, ghost: false }));
  // 底部细线 + 时间
  env.line([[band * 0.15, H - band * 0.55], [W - band * 0.15, H - band * 0.55]], ink, Math.max(1, u * 1.2), a * 0.25, false);
  if (v === 0 || v === 3) {
    // ② 左边缘竖排英文（一个字一格）
    const word = (v === 0 ? 'MOTION' : 'FRAME').split('');
    word.forEach((ch, i) => {
      env.draw({ text: ch, font: mono, size: s2, x: band * 0.42, y: H * 0.34 + i * s2 * 1.55, align: 'center', color: ink, alpha: a * 0.5, ghost: false });
    });
    env.line([[band * 0.72, H * 0.3], [band * 0.72, H * 0.3 + word.length * s2 * 1.55 + u * 10]], acc, Math.max(1, u * 2), a * 0.5, false);
  }
  if (v === 1 || v === 4) {
    // ③ 大号幽灵数字
    env.draw({ text: no, font: 'gothic_black', size: u * (v === 1 ? 190 : 130), x: v === 1 ? W - band * 0.9 : band * 0.9, y: H - band * 0.55, align: v === 1 ? 'right' : 'left', color: ink, alpha: a * 0.1, ghost: false });
  }
  if (v === 2 || v === 5) {
    // ④ 色块 + 反白小字
    const bw = Math.min(W * 0.3, u * 340), bh = u * 46;
    const bx = v === 2 ? band * 0.25 : W - band * 0.25 - bw, by = H - band * 0.25 - bh;
    env.rect(bx, by, bw, bh, acc, a * 0.9, false);
    env.draw({ text: 'PV / ' + no + '  ' + J.fmtTime(env.cut.start), font: mono, size: s1, track: 0.12, x: bx + bw * 0.06, y: by + bh * 0.58, align: 'left', color: inkOn(sc, acc), alpha: a, ghost: false });
  }
  if (v === 3) {
    // ⑤ 网点块
    dots(env, band * 0.2, H * 0.62, band * 0.8, H * 0.2, Math.max(5, u * 9), Math.max(1, u * 1.5), ink, a * 0.3);
  }
  if (v === 5) {
    // ⑥ 胶带 + 圆环
    tape(env, band * 0.5, band * 0.9, u * 150, u * 34, -24, a, J.rgba(acc2, 0.5));
    env.circle(W - band * 0.55, H * 0.3, u * 26, null, null, 0, 0, false);
    ctx.save(); ctx.beginPath(); ctx.arc(W - band * 0.55, H * 0.3, u * 26, 0, J.TAU);
    ctx.strokeStyle = ink; ctx.globalAlpha = a * 0.4; ctx.lineWidth = Math.max(1, u * 2); ctx.stroke(); ctx.restore();
  }
  // ⑦ 右下角：小方块 + 一行英文
  env.rect(W - band * 0.75, H - band * 0.75, u * 22, u * 22, ink, a * 0.22, false);
  env.draw({ text: 'TYPE & MOTION', font: mono, size: Math.max(8, u * 11), track: 0.3, x: band, y: H - band * 0.3, align: 'left', color: ink, alpha: a * 0.35, ghost: false });
  ctx.restore();
}
/* 版面四周的「版式标记」：细线 + 刻度 + 英文小字 + 小方块 —— 让画面不只剩一张照片 */
function marginalia(env, a, C, sc, tag) {
  const { W, H } = env, u = U(env) / 1080;
  const pad = U(env) * 0.032, ink = C.text, acc = sc.accent;
  const lw = Math.max(1, u * 1.1);
  env.line([[pad, H * 0.13], [pad, H * 0.87]], ink, lw, a * 0.24, false);
  env.line([[W - pad, H * 0.13], [W - pad, H * 0.87]], ink, lw, a * 0.24, false);
  for (let i = 0; i < 6; i++) {
    const y = H * 0.13 + (H * 0.74) * i / 5;
    env.line([[pad - u * 4, y], [pad, y]], ink, lw, a * 0.3, false);
    env.line([[W - pad, y], [W - pad + u * 4, y]], ink, lw, a * 0.3, false);
  }
  const mono = 'mono', s1 = Math.max(9, u * 15);
  env.draw({ text: 'STUDIO', font: mono, size: s1, track: 0.34, x: pad + u * 7, y: H * 0.075, align: 'left', color: ink, alpha: a * 0.55, ghost: false });
  env.draw({ text: (tag || 'FRAME') + ' ' + lineNo(env), font: mono, size: s1, track: 0.22, x: W - pad - u * 7, y: H * 0.075, align: 'right', color: ink, alpha: a * 0.55, ghost: false });
  env.draw({ text: J.fmtTime(env.cut.start), font: mono, size: Math.max(8, u * 12), x: pad + u * 7, y: H * 0.94, align: 'left', color: ink, alpha: a * 0.4, ghost: false });
  env.draw({ text: 'PV / 2026', font: mono, size: Math.max(8, u * 12), x: W - pad - u * 7, y: H * 0.94, align: 'right', color: ink, alpha: a * 0.4, ghost: false });
  env.rect(pad + u * 5, H * 0.895, u * 9, u * 9, acc, a * 0.7, false);
  env.rect(W - pad - u * 14, H * 0.895, u * 9, u * 9, ink, a * 0.3, false);
}

function base(env, d = 0, len = 0.4) {
  const out = 1 - J.E.inCubic(env.pOut);
  const a = clamp(tin(env, d, len) * 1.7) * out;
  return a <= 0.01 ? 0 : a;
}
const FONTS = {
  display: st => st && st.fonts && st.fonts.display ? st.fonts.display : ['gothic_black'],
  body: st => st && st.fonts && st.fonts.body ? st.fonts.body : ['gothic_med'],
  mono: st => st && st.fonts && st.fonts.mono ? st.fonts.mono : ['mono'],
};
const pickFont = (rng, st, role) => rng.pick(FONTS[role](st));

/* ======================================================================
   1  bigPicture — 大幅装裱：整张照片配纸卡与下沿说明
   ====================================================================== */
J.register('layout', 'bigPicture', {
  name: '装裱大幅', tags: ['emotional', 'calm', 'pop'], w: 0.9, ae: 'center', slot: true, needsMaterial: true, slots: ['photo'], fits: n => n >= 1 && n <= 24,
  plan: (rng, cut, st) => ({ font: pickFont(rng, st, 'display'), mono: pickFont(rng, st, 'mono'), pad: rng.range(0.022, 0.04), band: rng.range(0.14, 0.19) }),
  render(env) {
    const { W, H, sc, ctx } = env, u = U(env) / 1080, p = env.cut.params;
    const a = base(env); if (!a) return null;
    decorFull(env, a, sc);
    const C = paper(sc);
    const m = U(env) * 0.045, band = H * p.band;
    const x = m, y = m, w = W - m * 2, h = H - m * 2;
    const ein = J.E.outCubic(clamp(env.lt / 0.45));
    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.scale(0.965 + 0.035 * ein, 0.965 + 0.035 * ein); ctx.translate(-W / 2, -H / 2);
    softShadow(env, x, y, w, h, U(env) * 0.006, a, u * 22);
    env.rect(x, y, w, h, C.fill, a, false);
    if (C.edge) env.line([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]], C.line, Math.max(1, u * 1.4), a * 0.8, false);
    const pad = U(env) * p.pad;
    const px = x + pad, py = y + pad, pw = w - pad * 2, ph = h - pad * 2 - band;
    // 装裱是「整张照片放进去」，不裁切 —— 人像不会被切掉头
    env.slot('photo', px, py, pw, ph, { tone: 'photo', alpha: a, fit: 'contain', paper: C.fill });
    env.line([[px, py + ph + pad * 0.5], [px + pw, py + ph + pad * 0.5]], C.line, Math.max(1, u * 1.4), a * 0.5, false);
    marginalia(env, a, C, sc, 'PRINT');
    const fb = fit(env, env.cut.text, p.font, pw * 0.92, band * 0.66, 1, U(env) * 0.085);
    const bb = J.mainDraw(env, { text: fb.text, font: p.font, size: fb.size, x: px, y: py + ph + band * 0.52, align: 'left', color: C.text });
    env.draw({ text: 'No.' + lineNo(env), font: p.mono, size: U(env) * 0.019, x: px + pw, y: py + ph + band * 0.76, align: 'right', color: C.text, alpha: a * 0.55, ghost: false });
    ctx.restore();
    return bb;
  },
});

/* ======================================================================
   2  tapePhoto — 胶带贴照：卡片占满画面，字写在卡片下沿
   ====================================================================== */
J.register('layout', 'tapePhoto', {
  name: '胶带照片', tags: ['emotional', 'pop', 'calm'], w: 0.9, ae: 'labels', slot: true, needsMaterial: true, slots: ['photo'], fits: n => n >= 1 && n <= 20,
  plan: (rng, cut, st) => ({ font: pickFont(rng, st, 'display'), mono: pickFont(rng, st, 'mono'), tilt: rng.range(-5, 5), tape: rng.chance(0.85), band: rng.range(0.12, 0.16) }),
  render(env) {
    const { W, H, sc, ctx } = env, u = U(env) / 1080, p = env.cut.params, C = paper(sc);
    const a = base(env); if (!a) return null;
    decorFull(env, a, sc);
    const ein = J.E.outCubic(clamp(env.lt / 0.4));
    const fw = Math.min(W * 0.8, H * 0.74), fh = Math.min(H * 0.92, fw * 1.28);
    const band = fh * p.band;
    const cx = W / 2, cy = H / 2;
    const rot = p.tilt + (1 - ein) * 9;
    ctx.save();
    ctx.translate(cx, cy + (1 - ein) * H * 0.03); ctx.rotate(rot * J.DEG);
    softShadow(env, -fw / 2, -fh / 2, fw, fh, u * 4, a, u * 26);
    env.rect(-fw / 2, -fh / 2, fw, fh, C.fill, a, false);
    const pad = fw * 0.045;
    const pw = fw - pad * 2, ph = fh - pad * 2 - band;
    env.slot('photo', -pw / 2, -fh / 2 + pad, pw, ph, { tone: 'photo', alpha: a });
    const fb = fit(env, env.cut.text, p.font, pw * 0.94, band * 0.7, 1, fw * 0.085);
    const bb = J.mainDraw(env, { text: fb.text, font: p.font, size: fb.size, x: -pw / 2, y: -fh / 2 + pad + ph + band * 0.55, align: 'left', color: C.text });
    env.draw({ text: '— ' + lineNo(env), font: p.mono, size: fw * 0.028, x: pw / 2, y: -fh / 2 + pad + ph + band * 0.62, align: 'right', color: C.text, alpha: a * 0.6, ghost: false });
    marginalia(env, a, C, sc, 'TAPE');
    if (p.tape) {
      tape(env, -fw / 2 + fw * 0.14, -fh / 2 + fw * 0.01, fw * 0.3, fw * 0.075, -38, a, J.rgba(sc.accent, 0.55));
      tape(env, fw / 2 - fw * 0.12, -fh / 2 - fw * 0.01, fw * 0.26, fw * 0.07, 34, a, J.rgba(sc.accent2, 0.5));
    }
    ctx.restore();
    return bb;
  },
});

/* ======================================================================
   3  filmStripFrame — 胶片：横向一条，齿孔包边，字写在片基上
   ====================================================================== */
J.register('layout', 'filmStripFrame', {
  name: '胶片框', tags: ['emotional', 'pop', 'glitch'], w: 0.85, ae: 'labels', slot: true, needsMaterial: true, slots: ['photo'], fits: n => n >= 1 && n <= 22,
  plan: (rng, cut, st) => ({ font: pickFont(rng, st, 'display'), tilt: rng.range(-2.5, 2.5), val: rng.int(100, 999) }),
  render(env) {
    const { W, H, sc, ctx } = env, u = U(env) / 1080, p = env.cut.params;
    const a = base(env); if (!a) return null;
    decorFull(env, a, sc);
    const stripH = H * 0.72, baseH = stripH * 0.2, photoH = stripH * 0.6;
    const cx = W / 2, cy = H * 0.47;
    const rot = p.tilt + (1 - J.E.outCubic(clamp(env.lt / 0.45))) * 4;
    const filmC = '#14141A', holeC = J.mix(filmC, sc.bg, 0.55);
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(rot * J.DEG);
    softShadow(env, -W * 0.56, -stripH / 2, W * 1.12, stripH, u * 6, a, u * 24);
    env.rect(-W * 0.56, -stripH / 2, W * 1.12, stripH, filmC, a, false);
    // 齿孔
    const holeW = W * 0.018, holeH = stripH * 0.075;
    for (let i = -12; i <= 12; i++) {
      const hx = -W * 0.56 + W * 0.035 + i * W * 0.045;
      if (hx > W * 0.56) break;
      if (hx < -W * 0.56) continue;
      env.rect(hx, -stripH / 2 + stripH * 0.035, holeW, holeH, holeC, a, false);
      env.rect(hx, stripH / 2 - stripH * 0.035 - holeH, holeW, holeH, holeC, a, false);
    }
    // 画面
    const px = -W * 0.42, py = -photoH / 2, pw = W * 0.84, ph = photoH;
    env.slot('photo', px, py, pw, ph, { tone: 'photo', alpha: a });
    // 片基上的字
    const fb = fit(env, env.cut.text, p.font, W * 0.52, baseH * 0.62, 1, U(env) * 0.062);
    const bb = J.mainDraw(env, { text: fb.text, font: p.font, size: fb.size, x: px, y: ph / 2 - baseH * 0.12, align: 'left', color: paper(sc).fill });
    env.draw({ text: 'KODAK ' + p.val + '  ·  ' + lineNo(env) + 'A', font: 'mono', size: U(env) * 0.019, x: px + pw, y: ph / 2 - baseH * 0.2, align: 'right', color: J.mix(filmC, '#FFFFFF', 0.6), alpha: a * 0.8, ghost: false });
    ctx.restore();
    return bb;
  },
});

/* ======================================================================
   4  screenFrame — 荧幕：显示器外框，字在屏幕下面的控制台条
   ====================================================================== */
J.register('layout', 'screenFrame', {
  name: '荧幕', tags: ['pop', 'glitch', 'emotional'], w: 0.85, ae: 'center', slot: true, needsMaterial: true, slots: ['photo'], fits: n => n >= 1 && n <= 20,
  plan: (rng, cut, st) => ({ font: pickFont(rng, st, 'display'), bezel: rng.pick(['ink', 'accent', 'dark']), scan: rng.chance(0.6) }),
  render(env) {
    const { W, H, sc, ctx } = env, u = U(env) / 1080, p = env.cut.params, C = paper(sc);
    const a = base(env); if (!a) return null;
    decorFull(env, a, sc);
    const fw = Math.min(W * 0.9, H * 1.36), fh = fw * 0.66;
    const cx = W / 2, cy = H * 0.44;
    const bezC = p.bezel === 'accent' ? sc.accent : p.bezel === 'dark' ? J.mix(sc.bg, '#000000', 0.35) : sc.ink;
    const bezT = J.contrast('#FFFFFF', bezC) > J.contrast('#111111', bezC) ? '#FFFFFF' : '#111111';
    const ein = J.E.outCubic(clamp(env.lt / 0.45));
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(0.96 + 0.04 * ein, 0.96 + 0.04 * ein); ctx.translate(-cx, -cy);
    softShadow(env, cx - fw / 2, cy - fh / 2, fw, fh, fw * 0.03, a, u * 24);
    env.rrect(cx - fw / 2, cy - fh / 2, fw, fh, fw * 0.03, bezC, a, false);
    const pad = fw * 0.028;
    const sx = cx - fw / 2 + pad, sy = cy - fh / 2 + pad, sw = fw - pad * 2, sh = fh - pad * 2 - fh * 0.12;
    env.rect(sx, sy, sw, sh, '#0A0A10', a, false);
    env.slot('photo', sx + sw * 0.015, sy + sh * 0.02, sw * 0.97, sh * 0.96, { tone: 'photo', alpha: a });
    if (p.scan) {
      ctx.save(); ctx.globalAlpha = a * 0.16; ctx.fillStyle = '#000';
      for (let yy = sy; yy < sy + sh; yy += Math.max(3, u * 5)) ctx.fillRect(sx, yy, sw, Math.max(1, u * 1.4));
      ctx.restore();
    }
    marginalia(env, a, C, sc, 'SCREEN');
    // 控制台条：字在这里
    const bandY = sy + sh + fh * 0.02, bandH = fh * 0.085;
    env.rect(sx, bandY, sw, bandH, J.mix(bezC, '#000000', 0.25), a, false);
    const fb = fit(env, env.cut.text, p.font, sw * 0.74, bandH * 0.72, 1, U(env) * 0.05);
    const bb = J.mainDraw(env, { text: fb.text, font: p.font, size: fb.size, x: sx + sw * 0.03, y: bandY + bandH * 0.56, align: 'left', color: bezT });
    env.circle(sx + sw * 0.94, bandY + bandH * 0.5, bandH * 0.22, J.rgba('#FF4D4D', 0.9), null, 0, a, false);
    env.draw({ text: 'CH ' + lineNo(env), font: 'mono', size: bandH * 0.4, x: sx + sw * 0.9, y: bandY + bandH * 0.62, align: 'right', color: bezT, alpha: a * 0.7, ghost: false });
    ctx.restore();
    return bb;
  },
});

/* ======================================================================
   5  comicPanel — 漫画格：粗框 + 说明框，字绝不进格子
   ====================================================================== */
J.register('layout', 'comicPanel', {
  name: '漫画格', tags: ['pop', 'graphic'], w: 0.85, ae: 'tile', slot: true, needsMaterial: true, slots: ['photo'], fits: n => n >= 1 && n <= 18,
  plan: (rng, cut, st) => ({ font: pickFont(rng, st, 'display'), tilt: rng.range(-2, 2), side: rng.chance(0.5) ? 1 : -1 }),
  render(env) {
    const { W, H, sc, ctx } = env, u = U(env) / 1080, p = env.cut.params, C = paper(sc);
    const a = base(env); if (!a) return null;
    decorFull(env, a, sc);
    const m = U(env) * 0.05, gut = U(env) * 0.012;
    const pw = W - m * 2 - gut * 2, ph = H - m * 2 - gut * 2;
    const rot = p.tilt + (1 - J.E.outCubic(clamp(env.lt / 0.4))) * 3;
    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.rotate(rot * J.DEG); ctx.translate(-W / 2, -H / 2);
    env.rect(m, m, W - m * 2, H - m * 2, '#0C0C10', a, false);
    env.rect(m + gut, m + gut, pw, ph, C.fill, a, false);
    env.slot('photo', m + gut * 2, m + gut * 2, pw - gut * 2, ph - gut * 2, { tone: 'photo', alpha: a });
    marginalia(env, a, C, sc, 'PANEL');
    // 说明框：压在右下角的白框，黑边
    const bwd = Math.min(W * 0.46, U(env) * 0.72), bhd = U(env) * 0.2;
    const bx = p.side > 0 ? W - m - bwd - gut * 2 : m + gut * 2, by = H - m - bhd - gut * 2;
    env.rect(bx, by, bwd, bhd, C.fill, a, false);
    env.line([[bx, by], [bx + bwd, by], [bx + bwd, by + bhd], [bx, by + bhd], [bx, by]], '#0C0C10', Math.max(2, u * 2.4), a, false);
    const fb = fit(env, env.cut.text, p.font, bwd * 0.86, bhd * 0.68, 2, bhd * 0.42);
    const bb = J.mainDraw(env, { text: fb.text, font: p.font, size: fb.size, x: bx + bwd * 0.07, y: by + bhd * 0.55, align: 'left', color: C.text, lead: 1.1 });
    // 网点角
    dots(env, m + gut * 2, m + gut * 2, U(env) * 0.16, U(env) * 0.1, Math.max(4, u * 9), Math.max(1, u * 1.6), '#FFFFFF', a * 0.22);
    ctx.restore();
    return bb;
  },
});

/* ======================================================================
   6  posterWall — 海报上墙：贴纸胶带 + 下沿手写
   ====================================================================== */
J.register('layout', 'posterWall', {
  name: '海报上墙', tags: ['pop', 'emotional'], w: 0.9, ae: 'center', slot: true, needsMaterial: true, slots: ['photo'], fits: n => n >= 1 && n <= 20,
  plan: (rng, cut, st) => ({ font: pickFont(rng, st, 'display'), tilt: rng.range(-3, 3), band: rng.range(0.13, 0.17) }),
  render(env) {
    const { W, H, sc, ctx } = env, u = U(env) / 1080, p = env.cut.params, C = paper(sc);
    const a = base(env); if (!a) return null;
    decorFull(env, a, sc);
    const ein = J.E.outCubic(clamp(env.lt / 0.42));
    const wide = W / H > 1.35;
    const pw = wide ? Math.min(W * 0.86, H * 1.22) : Math.min(W * 0.82, H * 0.64);
    const ph = wide ? pw / 1.36 : Math.min(H * 0.92, pw * 1.3);
    const cx = W / 2, cy = H * 0.48;
    const rot = p.tilt + (1 - ein) * 6;
    ctx.save();
    ctx.translate(cx, cy + (1 - ein) * H * 0.04); ctx.rotate(rot * J.DEG);
    softShadow(env, -pw / 2, -ph / 2, pw, ph, u * 3, a, u * 24);
    env.rect(-pw / 2, -ph / 2, pw, ph, C.fill, a, false);
    const pad = pw * 0.05, band = ph * p.band;
    const iw = pw - pad * 2, ih = ph - pad * 2 - band;
    env.slot('photo', -iw / 2, -ph / 2 + pad, iw, ih, { tone: 'photo', alpha: a });
    const fb = fit(env, env.cut.text, p.font, iw, band * 0.72, 1, pw * 0.075);
    const bb = J.mainDraw(env, { text: fb.text, font: p.font, size: fb.size, x: -iw / 2, y: -ph / 2 + pad + ih + band * 0.58, align: 'left', color: C.text });
    env.draw({ text: lineNo(env) + ' / ' + env.cut.layout.toUpperCase(), font: 'mono', size: pw * 0.024, x: iw / 2, y: -ph / 2 + pad + ih + band * 0.64, align: 'right', color: C.text, alpha: a * 0.55, ghost: false });
    tape(env, 0, -ph / 2 + ph * 0.005, pw * 0.34, ph * 0.032, -3, a, J.rgba(sc.accent, 0.45));
    marginalia(env, a, C, sc, 'POSTER');
    ctx.restore();
    return bb;
  },
});

/* ======================================================================
   7  albumFrame — 专辑封面：方块封面 + 底部曲名条
   ====================================================================== */
J.register('layout', 'albumFrame', {
  name: '专辑封面', tags: ['pop', 'emotional', 'calm'], w: 0.85, ae: 'ring', slot: true, needsMaterial: true, slots: ['photo'], fits: n => n >= 1 && n <= 18,
  plan: (rng, cut, st) => ({ font: pickFont(rng, st, 'display'), tilt: rng.range(-4, 4), side: rng.chance(0.5) ? 1 : -1 }),
  render(env) {
    const { W, H, sc, ctx } = env, u = U(env) / 1080, p = env.cut.params, C = paper(sc);
    const a = base(env); if (!a) return null;
    decorFull(env, a, sc);
    const port = isPort(env);
    const S = port ? Math.min(W * 0.84, H * 0.52) : Math.min(H * 0.84, W * 0.5);
    const cx = port ? W / 2 : W * 0.64, cy = port ? H * 0.34 : H * 0.5;
    const rot = p.tilt + (1 - J.E.outCubic(clamp(env.lt / 0.45))) * 8;
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(rot * J.DEG);
    softShadow(env, -S / 2, -S / 2, S, S, u * 3, a, u * 26);
    env.slot('photo', -S / 2, -S / 2, S, S, { tone: 'print', alpha: a });
    // 底部曲名条
    const bandH = S * 0.17;
    env.rect(-S / 2, S / 2 - bandH, S, bandH, J.rgba(sc.bg, 0.82), a, false);
    env.draw({ text: 'SIDE A · ' + lineNo(env), font: 'mono', size: S * 0.032, x: -S * 0.45, y: S / 2 - bandH * 0.62, align: 'left', color: sc.fg, alpha: a * 0.75, ghost: false });
    env.line([[-S * 0.45, -S * 0.455], [S * 0.45, -S * 0.455]], sc.fg, Math.max(1, u * 1.2), a * 0.35, false);
    ctx.restore();
    marginalia(env, a, C, sc, 'ALBUM');
    // 歌词在左边，不压封面
    const tw = port ? W * 0.8 : W * 0.34, th = port ? H * 0.16 : H * 0.4;
    const tx = port ? W * 0.1 : W * 0.06, ty = port ? H * 0.66 : H * 0.5 - th / 2;
    const fb = fit(env, env.cut.text, p.font, tw, th, port ? 2 : 3, U(env) * 0.1);
    const bb = J.mainDraw(env, { text: fb.text, font: p.font, size: fb.size, x: tx, y: ty + th * 0.36, align: 'left', color: C.text, lead: 1.08 });
    env.line([[tx, ty + th * 0.9], [tx + tw * 0.5, ty + th * 0.9]], C.text, Math.max(1, u * 1.6), a * 0.35, false);
    return bb;
  },
});

/* ======================================================================
   8  circlePortrait — 圆形头像：大圆 + 环，字在右侧
   ====================================================================== */
J.register('layout', 'circlePortrait', {
  name: '圆形头像', tags: ['emotional', 'calm', 'pop'], w: 0.85, ae: 'ring', slot: true, needsMaterial: true, slots: ['photo'], fits: n => n >= 1 && n <= 22,
  plan: (rng, cut, st) => ({ font: pickFont(rng, st, 'display'), dot: rng.chance(0.5), ring: rng.chance(0.7) }),
  render(env) {
    const { W, H, sc, ctx } = env, u = U(env) / 1080, p = env.cut.params, C = paper(sc);
    const a = base(env); if (!a) return null;
    decorFull(env, a, sc);
    const port = isPort(env);
    const R = Math.min(H * 0.36, W * 0.32);
    const cx = port ? W / 2 : W * 0.3, cy = port ? H * 0.34 : H * 0.5;
    const ein = J.E.outCubic(clamp(env.lt / 0.45));
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(0.92 + 0.08 * ein, 0.92 + 0.08 * ein); ctx.translate(-cx, -cy);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R + u * 10, 0, J.TAU);
    ctx.globalAlpha = a * 0.16; ctx.fillStyle = '#101018'; ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, J.TAU); ctx.clip();
    env.slot('photo', cx - R, cy - R, R * 2, R * 2, { tone: 'photo', alpha: a });
    ctx.restore();
    if (p.ring) {
      ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = C.fill; ctx.lineWidth = Math.max(3, u * 8);
      ctx.beginPath(); ctx.arc(cx, cy, R + u * 5, 0, J.TAU); ctx.stroke();
      ctx.strokeStyle = sc.accent; ctx.lineWidth = Math.max(1.5, u * 2.4);
      ctx.beginPath(); ctx.arc(cx, cy, R + u * 14, 0, J.TAU); ctx.stroke();
      ctx.restore();
    }
    // 字在右侧 / 下方
    const tw = port ? W * 0.78 : W * 0.42, th = port ? H * 0.22 : H * 0.34;
    const tx = port ? W * 0.11 : W * 0.58, ty = port ? cy + R + H * 0.08 : H * 0.5 - th / 2;
    const fb = fit(env, env.cut.text, p.font, tw, th, 2, U(env) * 0.11);
    const bb = J.mainDraw(env, { text: fb.text, font: p.font, size: fb.size, x: tx, y: ty + th * 0.42, align: 'left', color: C.text, lead: 1.08 });
    env.draw({ text: 'PORTRAIT ' + lineNo(env), font: 'mono', size: U(env) * 0.019, x: tx, y: ty + th * 0.86, align: 'left', color: C.text, alpha: a * 0.5, ghost: false });
    if (p.dot) dots(env, port ? W * 0.08 : W * 0.55, port ? H * 0.79 : H * 0.72, tw, H * 0.12, Math.max(6, u * 13), Math.max(1, u * 2), sc.accent, a * 0.25);
    ctx.restore();
    return bb;
  },
});

/* ======================================================================
   9  windowFrame — 窗景：窗框 + 十字窗棂，字写在窗台
   ====================================================================== */
J.register('layout', 'windowFrame', {
  name: '窗景', tags: ['emotional', 'calm'], w: 0.85, ae: 'center', slot: true, needsMaterial: true, slots: ['photo'], fits: n => n >= 1 && n <= 20,
  plan: (rng, cut, st) => ({ font: pickFont(rng, st, 'display'), bars: rng.pick([1, 1, 2]), stool: rng.range(0.13, 0.17) }),
  render(env) {
    const { W, H, sc, ctx } = env, u = U(env) / 1080, p = env.cut.params, C = paper(sc);
    const a = base(env); if (!a) return null;
    decorFull(env, a, sc);
    const m = U(env) * 0.05;
    const ww = W - m * 2, wh = H - m * 2 - H * p.stool;
    const x = m, y = m;
    softShadow(env, x - u * 8, y - u * 8, ww + u * 16, wh + u * 16, u * 3, a, u * 16);
    env.rect(x - u * 8, y - u * 8, ww + u * 16, wh + u * 16, C.fill, a, false);
    env.slot('photo', x, y, ww, wh, { tone: 'photo', alpha: a });
    // 窗棂
    const frameC = C.fill;
    const bw = Math.max(3, u * 9);
    env.rect(x + ww / 2 - bw / 2, y, bw, wh, frameC, a, false);
    if (p.bars > 1) env.rect(x, y + wh / 2 - bw / 2, ww, bw, frameC, a, false);
    env.line([[x, y], [x + ww, y], [x + ww, y + wh], [x, y + wh], [x, y]], frameC, bw, a, false);
    marginalia(env, a, C, sc, 'WINDOW');
    // 字在窗台
    const sy = y + wh + u * 10, sh = H * p.stool - u * 20;
    const fb = fit(env, env.cut.text, p.font, ww, sh * 0.72, 1, H * 0.075);
    const bb = J.mainDraw(env, { text: fb.text, font: p.font, size: fb.size, x: m, y: sy + sh * 0.5, align: 'left', color: C.text });
    env.line([[m, sy + sh * 0.92], [W - m, sy + sh * 0.92]], C.text, Math.max(1, u * 1.4), a * 0.3, false);
    return bb;
  },
});

/* ======================================================================
   10  idCard — 证件：卡面左边照片，右边字 + 条码
   ====================================================================== */
J.register('layout', 'idCard', {
  name: '证件卡', tags: ['pop', 'graphic', 'glitch'], w: 0.8, ae: 'labels', slot: true, needsMaterial: true, slots: ['photo'], fits: n => n >= 1 && n <= 16,
  plan: (rng, cut, st) => ({ font: pickFont(rng, st, 'display'), tilt: rng.range(-4, 4), band: rng.pick(['accent', 'ink']) }),
  render(env) {
    const { W, H, sc, ctx } = env, u = U(env) / 1080, p = env.cut.params, C = paper(sc);
    const a = base(env); if (!a) return null;
    decorFull(env, a, sc);
    const cw = Math.min(W * 0.84, H * 1.7), ch = cw * 0.56;
    const cx = W / 2, cy = H * 0.5;
    const rot = p.tilt + (1 - J.E.outCubic(clamp(env.lt / 0.45))) * 7;
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(rot * J.DEG);
    softShadow(env, -cw / 2, -ch / 2, cw, ch, cw * 0.02, a, u * 24);
    env.rrect(-cw / 2, -ch / 2, cw, ch, cw * 0.02, C.fill, a, false);
    const bandC = p.band === 'accent' ? sc.accent : sc.ink;
    env.rect(-cw / 2, -ch / 2, cw, ch * 0.13, bandC, a, false);
    env.draw({ text: 'TYPE  /  MOTION  PASS', font: 'mono', size: ch * 0.055, track: 0.3, x: -cw * 0.44, y: -ch / 2 + ch * 0.085, align: 'left', color: inkOn(sc, bandC), alpha: a * 0.9, ghost: false });
    const ph = ch * 0.56, pw = ph * 0.78;
    const px = -cw * 0.44, py = -ch * 0.28;
    env.rect(px - u * 3, py - u * 3, pw + u * 6, ph + u * 6, C.line, a, false);
    env.slot('photo', px, py, pw, ph, { tone: 'photo', alpha: a });
    const tx = px + pw + cw * 0.05, tw = cw * 0.42, th = ch * 0.34;
    const fb = fit(env, env.cut.text, p.font, tw, th, 2, ch * 0.16);
    const bb = J.mainDraw(env, { text: fb.text, font: p.font, size: fb.size, x: tx, y: py + th * 0.36, align: 'left', color: C.text, lead: 1.06 });
    // 条码
    const by = ch * 0.24, bw = cw * 0.4, bh = ch * 0.12;
    for (let i = 0; i < 26; i++) {
      const wbx = px + i * (bw / 26);
      env.rect(wbx, by, Math.max(1, (bw / 26) * (i % 3 ? 0.45 : 0.8)), bh, C.text, a * (i % 4 ? 0.8 : 0.45), false);
    }
    env.draw({ text: 'No.' + lineNo(env) + '   ' + J.fmtTime(env.cut.start), font: 'mono', size: ch * 0.05, x: -cw * 0.44, y: ch * 0.42, align: 'left', color: C.text, alpha: a * 0.6, ghost: false });
    ctx.restore();
    return bb;
  },
});

/* ======================================================================
   11  polaroidStack — 拍立得堆：三张散开，最前面那张印素材
   ====================================================================== */
J.register('layout', 'polaroidStack', {
  name: '拍立得堆', tags: ['emotional', 'pop', 'calm'], w: 0.9, ae: 'labels', slot: true, needsMaterial: true, slots: ['photo'], fits: n => n >= 1 && n <= 20,
  plan: (rng, cut, st) => ({ font: pickFont(rng, st, 'display'), tilt: rng.range(-4, 4), spread: rng.range(0.045, 0.075) }),
  render(env) {
    const { W, H, sc, ctx } = env, u = U(env) / 1080, p = env.cut.params, C = paper(sc);
    const a = base(env); if (!a) return null;
    decorFull(env, a, sc);
    const fw = isPort(env) ? Math.min(W * 0.7, H * 0.46) : Math.min(W * 0.44, H * 0.66), fh = fw * 1.2;
    const cx = W / 2, cy = H * 0.47;
    const ein = J.E.outCubic(clamp(env.lt / 0.45));
    const stack = [[-1, -8, 0.92], [1, 7, 0.96], [0, p.tilt, 1]];
    stack.forEach((s, i) => {
      const [dir, rot, k] = s;
      const front = i === 2;
      const ox = dir * fw * (isPort(env) ? p.spread : 0.5) * (1.06 - ein * 0.3);
      const oy = dir * fh * 0.05 * (1 - ein * 0.4);
      ctx.save();
      ctx.translate(cx + ox, cy + oy + (1 - ein) * H * 0.05); ctx.rotate(rot * J.DEG); ctx.scale(k, k);
      softShadow(env, -fw / 2, -fh / 2, fw, fh, u * 4, a, u * (front ? 26 : 16));
      env.rect(-fw / 2, -fh / 2, fw, fh, C.fill, a, false);
      const pad = fw * 0.05, iw = fw - pad * 2, ih = iw;
      const iy = -fh / 2 + pad;
      if (front) {
        env.slot('photo', -iw / 2, iy, iw, ih, { tone: 'photo', alpha: a });
        const fb = fit(env, env.cut.text, p.font, iw, fh - ih - pad * 2.4, 1, fw * 0.09);
        J.mainDraw(env, { text: fb.text, font: p.font, size: fb.size, x: -iw / 2, y: iy + ih + (fh - ih - pad) * 0.5, align: 'left', color: C.text });
      } else {
        env.rect(-iw / 2, iy, iw, ih, J.mix(C.fill, sc.sub, 0.22), a * 0.9, false);
      }
      ctx.restore();
    });
    return null;
  },
});
/* ======================================================================
   12  refPanel — 「大字号背景 + 人物 + 右侧胶囊条」：照参考图那种版式
   大字在最后面，人物压在大字上，字永远不挡脸。
   ====================================================================== */
J.register('layout', 'refPanel', {
  name: '大字背景', tags: ['pop', 'emotional', 'graphic'], w: 0.9, ae: 'center', slot: true, needsMaterial: true, slots: ['photo'], fits: n => n >= 1 && n <= 24,
  plan: (rng, cut, st) => ({ font: pickFont(rng, st, 'display'), side: rng.pick([1, 1, -1]), rail: rng.chance(0.8), caps: rng.chance(0.75), sign: rng.chance(0.5) }),
  render(env) {
    const { W, H, sc, ctx } = env, u = U(env) / 1080, p = env.cut.params, C = paper(sc);
    const a = base(env); if (!a) return null;
    decorFull(env, a, sc);
    const acc = sc.accent, acc2 = sc.accent2 || sc.accent;
    // ① 背后的大字：整句铺开，超出画面裁掉
    ctx.save();
    ctx.globalAlpha = a * 0.85;
    const big = Math.min(W * 0.5, H * 0.42);
    J.mainDraw(env, { text: env.cut.text, font: p.font, size: big, x: W * 0.5, y: H * 0.5, lead: 0.92, track: 0.02, color: J.mix(acc, sc.bg, 0.35), plain: true });
    ctx.restore();
    // ② 人物：左侧竖幅，压在大字上
    const pw = Math.min(W * 0.5, H * 0.96), ph = Math.min(H * 0.94, pw * 1.5);
    const px = p.side > 0 ? W * 0.04 : W - pw - W * 0.04, py = H * 0.5 - ph / 2;
    ctx.save();
    ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.clip();
    env.slot('photo', px, py, pw, ph, { tone: 'photo', alpha: a, fit: 'contain', paper: sc.bg });
    ctx.restore();
    // 轮廓光
    ctx.save(); ctx.globalAlpha = a * 0.55; ctx.strokeStyle = acc2; ctx.lineWidth = Math.max(2, u * 4);
    ctx.strokeRect(px + u * 3, py + u * 3, pw - u * 6, ph - u * 6); ctx.restore();
    // ③ 右侧胶囊条 + 方块
    if (p.rail) {
      const rw = W * 0.07, rx = p.side > 0 ? W - rw - W * 0.05 : W * 0.05, ry = H * 0.06, rh = H * 0.88;
      env.rrect(rx, ry, rw, rh, rw / 2, J.rgba(acc, 0.45), a, false);
      for (let i = 0; i < 7; i++) {
        const sy = ry + rh * (0.08 + i * 0.13), ss = rw * 0.42;
        env.rrect(rx + (rw - ss) / 2, sy, ss, ss, ss * 0.18, J.rgba(sc.bg, 0.9), a, false);
      }
    }
    // ④ 小号英文 + 签名
    if (p.caps) env.draw({ text: 'MOST IS WHEN YOU TALK ABOUT SOME ZODIAC COMPATIBILITY.', font: 'mono', size: Math.max(9, u * 14), track: 0.1, x: px + pw * 0.1, y: py + ph * 0.12, align: 'left', color: inkOn(sc, sc.bg), alpha: a * 0.55, ghost: false });
    if (p.sign) env.draw({ text: 'T.' + lineNo(env) + '  ·  TYPE', font: 'mono', size: Math.max(10, u * 16), track: 0.2, x: W * 0.46, y: H * 0.93, align: 'left', color: acc2, alpha: a * 0.8, ghost: false });
    return null;
  },
});
})();
