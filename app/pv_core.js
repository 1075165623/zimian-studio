/* PV_CORE — PV专区场景渲染核心，供主时间线/主播放器调用。 */
window.PV_CORE = (() => {
'use strict';
let ctx = null;
let S = null;
const W = 1920, H = 1080, DUR = 44;
const C = {
  blue: '#6175C7', blueD: '#40549F', blueL: '#8E9CDC',
  ink: '#303B68', paper: '#F7F7F8', white: '#FFFFFF',
  red: '#B63848', gold: '#D9AE62', black: '#0B0D14',
};
const SERIF = '"Noto Serif SC", serif';
const SANS = '"Noto Sans SC", sans-serif';
const COND = '"ZCOOL QingKe HuangYou", "Noto Sans SC", sans-serif';
const $ = s => document.querySelector(s);
const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
const easeOut = x => 1 - Math.pow(1 - clamp(x), 3);
const easeInOut = x => { x = clamp(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };


const DEFAULTS = {
  title: '明知故犯',
  sub: '冷空气的气味，掺杂些许心碎',
  lyrics: [
    '冷空气的气味', '掺杂些许 心碎', '机会', '先说了',
    '的不安', '你负', '你对我的', 'I WANNA MAKE YOU CRY',
    'I love you', '我爱的是你', '明知故犯',
  ],
  credits: [
    'T. 人名 01', 'T. 人名 02', 'T. 人名 03', 'T. 人名 04',
    'T. 人名 05', 'T. 人名 06', 'T. 人名 07',
    'T.01 明知故犯', '和声：T. 人名（和声）',
  ],
};

/* 12 幅固定构图，44 秒 */
const SCENES = [
  { s: 0, e: 4, kind: 'cover', ly: 0, credit: null, label: 'COVER' },
  { s: 4, e: 7, kind: 'spot', ly: 0, ci: 0, en: 'COLD AIR', credit: 0, label: '01 / COLD AIR' },
  { s: 7, e: 10, kind: 'heart', ly: 1, ci: 1, en: 'QIAO QUE', credit: 1, label: '02 / QIAO QUE' },
  { s: 10, e: 13, kind: 'duo', ly: 2, ci: 2, ci2: 3, en: 'WILL', credit: 2, label: '03 / WILL' },
  { s: 13, e: 16, kind: 'card', ly: 3, ci: 4, en: 'T.W', credit: 4, label: '04 / T.W' },
  { s: 16, e: 19.5, kind: 'group', ly: 4, ci: 5, en: 'YOU', credit: 5, label: '05 / YOU' },
  { s: 19.5, e: 23, kind: 'dark', ly: 5, ci: 6, en: 'I WANNA MAKE YOU CRY', credit: 6, label: '06 / DARK' },
  { s: 23, e: 27, kind: 'cry', ly: 6, ci: 2, en: 'CRY', credit: 2, label: '07 / CRY' },
  { s: 27, e: 31, kind: 'lineup', ly: 7, ci: 0, en: 'I LOVE YOU', credit: 7, label: '08 / LINEUP' },
  { s: 31, e: 36, kind: 'frames', ly: 8, ci: 0, en: 'MING ZHI GU FAN', credit: 7, label: '09 / FRAMES' },
  { s: 36, e: 40, kind: 'outline', ly: 9, ci: 1, en: 'MINGZHI GUFAN', credit: 0, label: '10 / OUTLINE' },
  { s: 40, e: 44, kind: 'end', ly: 10, credit: null, en: '明知故犯', label: 'END' },
];

function lyric(i) {
  const a = S.lyrics.length ? S.lyrics : DEFAULTS.lyrics;
  return (a[i] || a[a.length - 1] || '').trim();
}
function credit(i) {
  if (i == null) return '';
  const a = S.credits.length ? S.credits : DEFAULTS.credits;
  return (a[i] || '').trim();
}
function creditLine(sc) {
  const s = credit(sc.credit);
  if (!s) return '';
  return /^T\.|^和声|^演唱|^作词|^作曲|^staff/i.test(s) ? s : 'T. ' + s;
}

/* ───────────── 基础绘制 ───────────── */
function rr(x, y, w, h, r, fill, alpha = 1, stroke, lw = 2) {
  ctx.save(); ctx.globalAlpha = alpha;
  const q = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + q, y); ctx.arcTo(x + w, y, x + w, y + h, q);
  ctx.arcTo(x + w, y + h, x, y + h, q); ctx.arcTo(x, y + h, x, y, q);
  ctx.arcTo(x, y, x + w, y, q); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  ctx.restore();
}
function line(x1, y1, x2, y2, color = C.blue, alpha = .4, lw = 2) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
}
function paper(light = true) {
  ctx.fillStyle = light ? C.paper : '#10121D'; ctx.fillRect(0, 0, W, H);
  if (!light) return;
  ctx.save();
  for (let gx = 0; gx <= W; gx += 54) {
    ctx.globalAlpha = gx % 270 === 0 ? .28 : .13;
    ctx.strokeStyle = C.blue; ctx.lineWidth = gx % 270 === 0 ? 1.5 : 1;
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
  }
  for (let gy = 0; gy <= H; gy += 54) {
    ctx.globalAlpha = gy % 270 === 0 ? .28 : .13;
    ctx.strokeStyle = C.blue; ctx.lineWidth = gy % 270 === 0 ? 1.5 : 1;
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
  }
  // faint paper grain
  ctx.globalAlpha = .05; ctx.fillStyle = C.blue;
  for (let i = 0; i < 900; i++) {
    const x = (i * 137.13) % W, y = (i * 91.7) % H;
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  ctx.restore();
}
function dots(x, y, w, h, gap = 22, color = C.blue, alpha = .35) {
  ctx.save(); ctx.fillStyle = color; ctx.globalAlpha = alpha;
  for (let yy = y; yy < y + h; yy += gap) for (let xx = x; xx < x + w; xx += gap) {
    ctx.beginPath(); ctx.arc(xx, yy, 2.4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
function orbit(cx, cy, rx, ry, rot = -.12, color = C.blueL, alpha = .7, lw = 15) {
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot); ctx.globalAlpha = alpha;
  ctx.strokeStyle = color; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = lw * .28; ctx.strokeStyle = '#fff'; ctx.globalAlpha = alpha * .8; ctx.stroke();
  ctx.restore();
}
function sparkle(x, y, r, color = '#fff', alpha = .9) {
  ctx.save(); ctx.translate(x, y); ctx.globalAlpha = alpha; ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * .24, -r * .24); ctx.lineTo(r, 0);
  ctx.lineTo(r * .24, r * .24); ctx.lineTo(0, r); ctx.lineTo(-r * .24, r * .24);
  ctx.lineTo(-r, 0); ctx.lineTo(-r * .24, -r * .24); ctx.closePath(); ctx.fill(); ctx.restore();
}
function imgAsset(src) { return PV_ASSETS.image(src); }

/* ───────────── 文字 ───────────── */
function drawText(text, x, y, opt = {}) {
  if (!text) return 0;
  const size = opt.size || 80, font = opt.font || SERIF, weight = opt.weight || 900;
  const color = opt.color || C.blue, align = opt.align || 'left';
  const p = opt.p == null ? 1 : clamp(opt.p);
  if (p <= .001) return 0;
  ctx.save(); ctx.translate(x, y); ctx.rotate((opt.rot || 0) * Math.PI / 180);
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  ctx.letterSpacing = ((opt.track || 0) * size).toFixed(2) + 'px';
  ctx.globalAlpha = (opt.alpha == null ? 1 : opt.alpha) * clamp(p * 2.2);
  const tw = ctx.measureText(text).width;
  if (p < 1) {
    const x0 = align === 'center' ? -tw / 2 - 20 : align === 'right' ? -tw - 20 : -20;
    ctx.beginPath(); ctx.rect(x0, -size * 1.25, tw + 40, size * 1.7 * easeOut(p)); ctx.clip();
    ctx.translate(0, (1 - easeOut(p)) * size * .72);
  }
  if (opt.stroke) { ctx.strokeStyle = opt.strokeColor || '#fff'; ctx.lineWidth = opt.stroke; ctx.strokeText(text, 0, 0); }
  ctx.fillStyle = color; ctx.fillText(text, 0, 0);
  ctx.restore();
  return tw;
}
function giant(text, x, y, size, color = C.blue, opt = {}) {
  if (!text) return;
  const p = opt.p == null ? 1 : clamp(opt.p);
  if (p <= .001) return;
  ctx.save(); ctx.translate(x, y); ctx.transform(.72, 0, -.14, 1, 0, 0);
  ctx.globalAlpha = opt.alpha == null ? 1 : opt.alpha;
  ctx.font = `${opt.weight || 400} ${size}px ${COND}`;
  ctx.textAlign = opt.align || 'left'; ctx.textBaseline = 'alphabetic';
  ctx.letterSpacing = ((opt.track || 0) * size).toFixed(2) + 'px';
  const tw = ctx.measureText(text).width;
  if (p < 1) {
    const x0 = ctx.textAlign === 'center' ? -tw / 2 - 10 : ctx.textAlign === 'right' ? -tw : 0;
    ctx.beginPath(); ctx.rect(x0, -size * 1.1, tw + 20, size * 1.45 * easeOut(p)); ctx.clip();
    ctx.translate((1 - easeOut(p)) * -size * .4, 0);
  }
  if (opt.fill === false) {
    ctx.strokeStyle = color; ctx.lineWidth = opt.stroke || Math.max(2, size * .025); ctx.strokeText(text, 0, 0);
  } else {
    if (opt.stroke) { ctx.strokeStyle = opt.strokeColor || '#fff'; ctx.lineWidth = opt.stroke; ctx.strokeText(text, 0, 0); }
    ctx.fillStyle = color; ctx.fillText(text, 0, 0);
  }
  ctx.restore();
}
function vertical(text, x, y, size, color = C.blue, p = 1, font = SERIF) {
  const chars = [...String(text)];
  chars.forEach((ch, i) => drawText(ch, x, y + i * size * .96, {
    size, font, weight: 900, color, align: 'center', p: clamp(p * 1.3 - i * .08),
  }));
}
function hud(sc, dark) {
  const col = dark ? '#F0F2FA' : C.blue;
  ctx.save(); ctx.globalAlpha = .92; ctx.strokeStyle = col; ctx.lineWidth = 1.5;
  line(28, 62, W - 28, 62, col, .55, 1.2);
  line(28, H - 62, W - 28, H - 62, col, .55, 1.2);
  // diamond + TCG-LI
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(54, 36); ctx.lineTo(65, 48); ctx.lineTo(54, 60); ctx.lineTo(43, 48); ctx.closePath(); ctx.fill();
  drawText('TCG-LI', W / 2, 54, { size: 25, font: SERIF, weight: 500, color: col, align: 'center', track: .16, alpha: .95 });
  drawText('T.01', 150, 54, { size: 22, font: SERIF, weight: 500, color: col, align: 'left', track: .12, alpha: .85 });
  drawText('···', W - 54, 54, { size: 26, font: SANS, weight: 500, color: col, align: 'right', track: .08, alpha: .8 });
  // bottom corners
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = col; ctx.globalAlpha = .65;
    ctx.beginPath();
    const x = 54 + i * 16;
    ctx.moveTo(x, H - 48); ctx.lineTo(x + 9, H - 54); ctx.lineTo(x + 9, H - 42); ctx.closePath(); ctx.fill();
  }
  drawText('LYRIC ' + String((sc.ly | 0) + 1).padStart(2, '0') + ' / 12', W - 54, H - 44, {
    size: 20, font: SERIF, weight: 500, color: col, align: 'right', track: .13, alpha: .8,
  });
  const cr = creditLine(sc);
  if (cr) {
    const size = Math.min(28, (W * .46) / Math.max(1, cr.length) / .62);
    drawText(cr, W / 2, H - 38, { size, font: SERIF, weight: 500, color: dark ? '#fff' : C.ink, align: 'center', track: .08, alpha: .9 });
  }
  ctx.restore();
}

/* ───────────── 立绘 ───────────── */
function pvMediaAt(i) { return (window.J && J.PV_MEDIA && J.PV_MEDIA[i]) || null; }
function charImage(i) {
  const m = pvMediaAt(i);
  return (m && m.pvImg) || S.custom[i] || PV_ASSETS.image(PV_ASSETS.portrait(i));
}
function drawChar(i, cx, bottom, h, opt = {}) {
  const im = charImage(i);
  if (!im || !im.complete || !im.naturalWidth) return { x: cx - h * .3, y: bottom - h, w: h * .6, h };
  const media = pvMediaAt(i);
  const us = media ? Math.max(.2, +media.scale || 1) : 1;
  const ux = media ? (+media.x || .5) : .5, uy = media ? (+media.y || .5) : .5;
  cx += (ux - .5) * W * .60;
  bottom += (uy - .5) * H * .42;
  h *= us;
  const custom = !!((media && media.pvImg) || S.custom[i]);
  let dw, dh, top;
  if (custom) {
    // Uploaded art is never squashed. Crop to the upper body (head + torso),
    // cover the slot width, and anchor the crop's top to the slot's top.
    const cropH = im.naturalHeight * .58;
    const targetW = Math.max(opt.maxW || h * .62, h * .36);
    const targetH = h;
    const scale = Math.max(targetW / im.naturalWidth, targetH / cropH);
    dw = im.naturalWidth * scale; dh = cropH * scale;
    top = -targetH;
  } else {
    const ar = im.naturalWidth / im.naturalHeight;
    dw = h * ar; dh = h;
    if (opt.maxW && dw > opt.maxW) { dw = opt.maxW; dh = dw / ar; }
    top = -dh;
  }
  ctx.save();
  if (opt.clip) {
    ctx.beginPath(); ctx.rect(opt.clip.x, opt.clip.y, opt.clip.w, opt.clip.h); ctx.clip();
  }
  ctx.globalAlpha = opt.alpha == null ? 1 : opt.alpha;
  ctx.translate(cx, bottom); ctx.rotate((opt.rot || 0) * Math.PI / 180);
  if (opt.shadow !== false) {
    ctx.shadowColor = 'rgba(23,30,64,.20)'; ctx.shadowBlur = h * .045; ctx.shadowOffsetY = h * .018;
  }
  if (opt.tint) ctx.filter = 'grayscale(.15) brightness(.95)';
  if (custom) {
    // draw the 0..58% source crop into the destination box, preserving aspect
    try { ctx.drawImage(im, 0, 0, im.naturalWidth, im.naturalHeight * .58, -dw / 2, top, dw, dh); } catch (e) {}
  } else {
    try { ctx.drawImage(im, -dw / 2, top, dw, dh); } catch (e) {}
  }
  ctx.restore();
  return { x: cx - dw / 2, y: bottom + top, w: dw, h: dh };
}
function headCrop(i, x, y, w, h, opt = {}) {
  const im = charImage(i);
  if (!im || !im.complete || !im.naturalWidth) return;
  const iw = im.naturalWidth, ih = im.naturalHeight;
  const srcH = ih * .62, srcAspect = iw / srcH, dstAspect = w / h;
  let sw = iw, sh = srcH, sx = 0, sy = 0;
  if (srcAspect > dstAspect) { sw = srcH * dstAspect; sx = (iw - sw) / 2; }
  else { sh = Math.min(srcH, iw / dstAspect); sw = sh * dstAspect; sx = (iw - sw) / 2; }
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.globalAlpha = opt.alpha == null ? 1 : opt.alpha;
  if (opt.gray) ctx.filter = 'grayscale(.8) contrast(.95)';
  try { ctx.drawImage(im, sx, sy, sw, sh, x, y, w, h); } catch (e) {}
  if (opt.tint) { ctx.globalAlpha = .28; ctx.fillStyle = opt.tint; ctx.fillRect(x, y, w, h); }
  ctx.restore();
  if (opt.border !== false) {
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 4; ctx.strokeRect(x, y, w, h); ctx.restore();
  }
}
function card(x, y, w, h, i, opt = {}) {
  rr(x, y, w, h, opt.r == null ? 18 : opt.r, opt.fill || 'rgba(255,255,255,.78)', opt.alpha == null ? 1 : opt.alpha, opt.stroke || 'rgba(97,117,199,.55)', 2);
  if (opt.blue) rr(x + 8, y + 8, w - 16, h - 16, 14, C.blue, .92);
  drawChar(i, x + w / 2, y + h - 8, h * (opt.scale || .96), {
    alpha: opt.charAlpha == null ? 1 : opt.charAlpha, maxW: w * .98, tint: opt.tint,
    clip: { x: x + 8, y: y + 8, w: w - 16, h: h - 12 },
  });
  if (opt.label) drawText(opt.label, x + 16, y + 32, { size: 18, font: SERIF, weight: 500, color: opt.dark ? '#fff' : C.ink, track: .12, alpha: .8 });
}

/* ───────────── 场景 ───────────── */
function cover(lt) {
  paper();
  const p = easeOut(lt / .8);
  // blue arches
  for (let i = 0; i < 7; i++) {
    const x = W * (.035 + i * .137), h = H * (.20 + (i % 3) * .035);
    rr(x, H - h - 40, W * .125, h + 60, 90, C.blue, .75 * p);
  }
  orbit(W * .5, H * .43, W * .3, H * .2, -.16, C.blueL, .55 * p, 13);
  // title
  // title is a separate editable overlay (see titleOverlay)
  // seven portraits
  for (let i = 0; i < 7; i++) {
    drawChar(i, W * (.075 + i * .142), H - 22, H * .46, { alpha: p, maxW: W * .14 });
  }
  drawText(S.sub, 64, H * .48, { size: 27, font: SERIF, weight: 500, color: C.blue, track: .06, alpha: .85 * p });
  sparkle(W * .86, H * .18, 18, '#fff', .9 * p);
  hud(SCENES[0], false);
}
function spot(lt) {
  paper();
  const p = easeOut(lt / .7);
  rr(0, 0, W * .54, H, 0, C.blue, .92 * p);
  // faint crop heads
  headCrop(0, W * .58, H * .04, W * .17, H * .33, { gray: true, alpha: .13, border: false });
  headCrop(2, W * .78, H * .04, W * .17, H * .33, { gray: true, alpha: .11, border: false });
  headCrop(5, W * .68, H * .42, W * .18, H * .34, { gray: true, alpha: .08, border: false });
  orbit(W * .42, H * .48, W * .3, H * .19, -.18, '#fff', .22 * p, 5);
  drawChar(SCENES[1].ci, W * .64, H - 8, H * .91, { alpha: p, maxW: W * .42 });
  giant(SCENES[1].en, 48, H * .86, 345, '#fff', { p, alpha: .96 });
  const ly = lyric(SCENES[1].ly);
  drawText(ly, 72, H * .40, { size: 132, font: SERIF, weight: 900, color: '#fff', track: .02, p: clamp((lt - .25) / .6), alpha: .95 });
  drawText('MING ZHI GU FAN', 76, H * .92, { size: 22, font: SERIF, weight: 500, color: '#fff', track: .22, alpha: .55 * p });
  sparkle(W * .55, H * .2, 12, '#fff', .7 * p);
  hud(SCENES[1], false);
}
function heart(lt) {
  paper();
  const p = easeOut(lt / .7);
  // eye strip
  [[0, .02], [2, .35], [4, .68]].forEach(([i, x], k) => {
    headCrop(i, W * x, 0, W * .33, H * .33, { gray: true, tint: C.blue, alpha: p * (.95 - k * .12), border: false });
  });
  line(0, H * .33, W, H * .33, C.blue, .6 * p, 2);
  dots(24, H * .39, W * .24, H * .34, 20, C.blue, .4 * p);
  drawChar(SCENES[2].ci, W * .51, H - 10, H * .78, { alpha: p, maxW: W * .38 });
  giant(SCENES[2].en, 38, H * .90, 355, C.blue, { p, alpha: .92 });
  const ly = lyric(SCENES[2].ly).split(/\s+/);
  drawText(ly[0] || '', W * .15, H * .49, { size: 110, font: SERIF, weight: 900, color: C.ink, p: clamp((lt - .2) / .5), track: .04 });
  if (ly[1]) drawText(ly.slice(1).join(''), W * .72, H * .36, { size: 108, font: SERIF, weight: 900, color: C.ink, p: clamp((lt - .45) / .5), track: .04 });
  // rose
  const rose = imgAsset(PV_ASSETS.rose);
  if (rose && rose.complete) ctx.drawImage(rose, W * .21, H * .56, W * .075, H * .16);
  sparkle(W * .87, H * .27, 20, '#fff', .8 * p);
  drawText('T. 01', W * .05, H * .84, { size: 20, font: SERIF, color: C.blue, track: .14, alpha: .7 });
  hud(SCENES[2], false);
}
function duo(lt) {
  paper();
  const p = easeOut(lt / .7);
  rr(W * .37, 0, W * .63, H, 0, C.blue, .94 * p);
  drawChar(SCENES[3].ci, W * .55, H - 8, H * .78, { alpha: p, maxW: W * .27 });
  drawChar(SCENES[3].ci2, W * .80, H - 8, H * .82, { alpha: p, maxW: W * .27 });
  giant(SCENES[3].en, 46, H * .78, 430, '#fff', { p, alpha: .95 });
  drawText(lyric(SCENES[3].ly), 76, H * .36, { size: 150, font: SERIF, weight: 900, color: C.ink, p, track: .02 });
  orbit(W * .5, H * .46, W * .26, H * .18, .1, '#fff', .3 * p, 7);
  drawText('T. 02  /  T. 03', 76, H * .89, { size: 20, font: SERIF, color: C.blue, track: .12, alpha: .65 });
  hud(SCENES[3], false);
}
function cardScene(lt) {
  paper();
  const p = easeOut(lt / .7);
  rr(W * .36, H * .12, W * .48, H * .70, 32, C.blue, .93 * p);
  rr(W * .38, H * .14, W * .44, H * .66, 26, 'rgba(255,255,255,.12)', .8 * p, 'rgba(255,255,255,.55)', 2);
  drawChar(SCENES[4].ci, W * .60, H - 12, H * .79, { alpha: p, maxW: W * .38 });
  giant(SCENES[4].en, 54, H * .75, 470, C.blue, { p, fill: false, stroke: 4, alpha: .9 });
  drawText(lyric(SCENES[4].ly), 78, H * .37, { size: 142, font: SERIF, weight: 900, color: C.ink, p });
  dots(W * .04, H * .47, W * .2, H * .25, 18, C.blue, .3);
  const rose = imgAsset(PV_ASSETS.rose);
  if (rose && rose.complete) ctx.drawImage(rose, W * .29, H * .52, 90, 130);
  sparkle(W * .86, H * .22, 18, '#fff', .8 * p);
  hud(SCENES[4], false);
}
function group(lt) {
  paper();
  const p = easeOut(lt / .7);
  rr(0, H * .34, W, H * .24, 0, C.blue, .88 * p);
  for (let i = 0; i < 5; i++) {
    card(W * (.035 + i * .19), H * .26, W * .172, H * .57, i, { r: 14, fill: 'rgba(255,255,255,.9)', blue: true, scale: .88, dark: true });
  }
  giant(SCENES[5].en, 44, H * .86, 390, C.blue, { p, alpha: .9 });
  drawText(lyric(SCENES[5].ly), 70, H * .21, { size: 132, font: SERIF, weight: 900, color: C.ink, p });
  orbit(W * .62, H * .34, W * .3, H * .12, -.1, '#fff', .35 * p, 5);
  hud(SCENES[5], false);
}
function darkScene(lt) {
  ctx.fillStyle = C.black; ctx.fillRect(0, 0, W, H);
  const p = easeOut(lt / .8);
  // constellation
  ctx.save(); ctx.strokeStyle = 'rgba(142,156,220,.45)'; ctx.lineWidth = 1.4;
  const pts = [[.1,.2],[.22,.12],[.3,.28],[.45,.18],[.58,.3],[.72,.14],[.84,.26],[.9,.42],[.78,.55],[.62,.46],[.5,.62],[.36,.52],[.2,.66],[.08,.5]];
  pts.forEach(([x,y], i) => {
    ctx.globalAlpha = .55 * p; ctx.beginPath(); ctx.arc(W*x,H*y,3.2,0,7); ctx.fillStyle='#fff'; ctx.fill();
    if (i) { ctx.beginPath(); ctx.moveTo(W*pts[i-1][0],H*pts[i-1][1]); ctx.lineTo(W*x,H*y); ctx.stroke(); }
  });
  ctx.restore();
  orbit(W * .5, H * .5, W * .3, H * .2, -.2, C.blueL, .35 * p, 8);
  drawChar(SCENES[6].ci, W * .5, H - 20, H * .86, { alpha: .82 * p, maxW: W * .35, tint: true });
  giant(SCENES[6].en, W * .07, H * .70, 172, '#fff', { p, fill: false, stroke: 3, alpha: .92 });
  drawText(lyric(SCENES[6].ly), W * .08, H * .34, { size: 54, font: SERIF, weight: 500, color: '#fff', track: .18, alpha: .65 * p });
  sparkle(W * .78, H * .23, 26, '#fff', .9 * p);
  hud(SCENES[6], true);
}
function cry(lt) {
  ctx.fillStyle = '#080A11'; ctx.fillRect(0, 0, W, H);
  const p = easeOut(lt / .7);
  headCrop(SCENES[7].ci, W * .55, H * .04, W * .42, H * .82, { gray: true, tint: '#6175C7', alpha: .9 * p });
  giant(SCENES[7].en, W * .04, H * .75, 520, '#fff', { p, alpha: .96 });
  rr(W * .03, H * .24, W * .48, H * .045, 8, C.blue, .9 * p);
  drawText(lyric(SCENES[7].ly), W * .06, H * .30, { size: 46, font: SERIF, weight: 500, color: '#fff', track: .12, alpha: .8 });
  line(W * .03, H * .88, W * .5, H * .88, '#fff', .4 * p, 1.5);
  hud(SCENES[7], true);
}
function lineup(lt) {
  paper();
  const p = easeOut(lt / .7);
  for (let i = 0; i < 7; i++) {
    rr(W * (.025 + i * .137), H * .30, W * .125, H * .48, 10, 'rgba(97,117,199,.12)', .8 * p, 'rgba(97,117,199,.35)', 1.5);
    drawChar(i, W * (.0875 + i * .137), H * .78, H * .42, { alpha: p, maxW: W * .12 });
  }
  giant(SCENES[8].en, W * .04, H * .22, 245, C.blue, { p, alpha: .9 });
  drawText(lyric(SCENES[8].ly), W * .50, H * .86, { size: 64, font: SERIF, weight: 900, color: C.ink, align: 'center', track: .04, p });
  orbit(W * .5, H * .56, W * .35, H * .12, -.05, C.blueL, .45 * p, 4);
  hud(SCENES[8], false);
}
function frames(lt) {
  paper();
  const p = easeOut(lt / .8);
  giant(SCENES[9].en, W * .04, H * .17, 124, C.blue, { p, alpha: .93 });
  for (let k = 0; k < 3; k++) {
    const x = W * (.06 + k * .30), w = W * .26, h = H * .43;
    card(x, H * .28, w, h, [0, 2, 4][k], { r: 20, fill: 'rgba(255,255,255,.82)', blue: true, scale: .82, dark: true });
    drawText('0' + (k + 1), x + w - 40, H * .67, { size: 18, font: SERIF, color: '#fff', track: .1, align: 'right' });
  }
  drawText(lyric(SCENES[9].ly), W * .06, H * .84, { size: 62, font: SERIF, weight: 900, color: C.ink, track: .02, p });
  drawText('T.01  /  MING ZHI GU FAN', W * .94, H * .88, { size: 18, font: SERIF, color: C.blue, align: 'right', track: .12, alpha: .7 });
  hud(SCENES[9], false);
}
function outline(lt) {
  paper();
  const p = easeOut(lt / .8);
  giant(SCENES[10].en, W * .03, H * .77, 188, C.blue, { p, fill: false, stroke: 6, alpha: .9 });
  for (let k = 0; k < 4; k++) {
    const x = W * (.04 + k * .235), w = W * .21, h = H * .38;
    rr(x, H * .12, w, h, 14, 'rgba(255,255,255,.85)', .85 * p, 'rgba(97,117,199,.4)', 1.5);
    drawChar(k + 2, x + w / 2, H * .48, H * .33, { alpha: p, maxW: w * .94 });
    drawText('T.0' + (k + 1), x + 12, H * .46, { size: 16, font: SERIF, color: C.blue, track: .12, alpha: .65 });
  }
  drawText(lyric(SCENES[10].ly), W * .05, H * .09, { size: 42, font: SERIF, weight: 500, color: C.ink, track: .14, p });
  hud(SCENES[10], false);
}
function end(lt) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#1B2340'); g.addColorStop(.55, '#303B68'); g.addColorStop(1, '#0B0D14');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const p = easeOut(lt / 1);
  for (let i = 0; i < 7; i++) {
    drawChar(i, W * (.10 + i * .135), H - 10, H * .47, { alpha: .45 * p, maxW: W * .13, tint: true });
  }
  orbit(W * .5, H * .4, W * .33, H * .17, -.12, C.blueL, .4 * p, 7);
  drawText(S.sub, W * .5, H * .44, { size: 30, font: SERIF, weight: 500, color: '#D9DEEE', align: 'center', track: .1, alpha: .8 * p });
  // editable staff block on a quiet navy plate (no overlap with portraits)
  const lines = (S.credits.length ? S.credits : DEFAULTS.credits).slice(0, 9);
  rr(48, H * .565, W * .30, H * .36, 6, 'rgba(9,13,28,.68)', .86 * p, 'rgba(201,210,240,.32)', 1);
  ctx.save(); ctx.globalAlpha = .9 * p;
  lines.forEach((ln, i) => drawText(ln, W * .065, H * .615 + i * 29, {
    size: 21, font: SERIF, weight: 500, color: i >= 7 ? '#C9D2F0' : '#fff', track: .07, alpha: .9,
  }));
  ctx.restore();
  drawText('PV TEMPLATE / TCG-LI', W * .93, H * .88, { size: 18, font: SERIF, weight: 500, color: '#C9D2F0', align: 'right', track: .16, alpha: .65 });
  sparkle(W * .85, H * .24, 24, '#fff', .85 * p);
  hud(SCENES[11], true);
}

function titleOverlay(sc) {
  if (S.titleOn === false || !S.title) return;
  if (sc.kind !== 'cover' && sc.kind !== 'end') return;
  const x = W * (S.titleX == null ? .5 : +S.titleX);
  const y = H * (S.titleY == null ? .22 : +S.titleY);
  const color = sc.kind === 'end' ? '#fff' : C.blue;
  const size = sc.kind === 'end' ? 150 : 210;
  drawText(S.title, x, y, {
    size, font: SERIF, weight: 900, color, align: 'center',
    track: .16, p: 1, alpha: .96,
  });
}
function draw() {
  const sc = SCENES.find(x => S.t >= x.s && S.t < x.e) || SCENES[SCENES.length - 1];
  const lt = Math.max(0, S.t - sc.s), dur = sc.e - sc.s;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  const z = 1.005 + .012 * easeInOut(lt / Math.max(.1, dur));
  ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2);
  switch (sc.kind) {
    case 'cover': cover(lt); break;
    case 'spot': spot(lt); break;
    case 'heart': heart(lt); break;
    case 'duo': duo(lt); break;
    case 'card': cardScene(lt); break;
    case 'group': group(lt); break;
    case 'dark': darkScene(lt); break;
    case 'cry': cry(lt); break;
    case 'lineup': lineup(lt); break;
    case 'frames': frames(lt); break;
    case 'outline': outline(lt); break;
    default: end(lt);
  }
  ctx.restore();
  titleOverlay(sc);
  // hard-cut flash
  if (lt < .12) {
    ctx.save(); ctx.globalAlpha = (1 - lt / .12) * .6; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.restore();
  }
  ctx.save(); ctx.globalAlpha = .1; ctx.strokeStyle = C.blue; ctx.lineWidth = 2;
  const bx = 24 + (lt * 7) % 30;
  ctx.strokeRect(bx, 22, W - bx * 2, H - 44);
  ctx.restore();
}


function render(canvasCtx, t, state, sceneIndex, sceneStart) {
  ctx = canvasCtx;
  S = state;
  if (!S) return;
  if (sceneIndex != null && SCENES[sceneIndex]) {
    S.t = SCENES[sceneIndex].s + Math.max(0, t - (sceneStart || 0));
  } else S.t = t;
  draw();
}
return { render, defaults: DEFAULTS, scenes: SCENES, W, H, DUR };
})();
