/* ============================================================
   字面工房 — 形状图层（色块 / 蜂窝 / 网点 / 噪点）

   垫在背景之上、文字之下的一层「拼贴」：
   每种形状各画 2–3 块，块与块互相压着，随时间极慢地漂移
   （幅度 / 相位 / 速度都由 plan.seed 定死，同一版每次播放都一样）。

   UI 在「文字层」卡片里：勾哪几种形状、多少、漂移多慢。
   ============================================================ */
(() => {
'use strict';

const KINDS = ['block', 'honey', 'dots', 'noise'];

/* 每块的位置 / 尺寸 / 相位：一次性算好挂在 plan 上，每帧只算漂移 */
function blocksOf(plan, cfg) {
  const seed = (plan.seed | 0) || 1, W = plan.W, H = plan.H;
  const on = KINDS.filter(k => cfg.shapes && cfg.shapes[k]);
  const out = [];
  let bi = 0;
  for (const kind of on) {
    const n = kind === 'block' ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const s = seed + bi * 977;
      const wide = kind === 'block';
      const w = J.rr(wide ? 0.16 : 0.24, wide ? 0.44 : 0.56, s, 1) * W;
      const h = J.rr(wide ? 0.10 : 0.14, wide ? 0.34 : 0.42, s, 2) * H;
      out.push({
        kind,
        x: J.rr(-0.04, 0.92, s, 3) * W,
        y: J.rr(-0.04, 0.9, s, 4) * H,
        w, h,
        rot: J.rs(s, 5) * 9 * J.DEG,
        ph: J.rr(0, J.TAU, s, 6),
        sp: J.rr(0.09, 0.26, s, 7),
        ci: Math.floor(J.r(s, 8) * 3),
      });
      bi++;
    }
  }
  return out;
}

/* 网点 / 噪点用的贴图（按颜色 + 尺寸缓存） */
const patCache = new Map();
function patOf(kind, color, cell) {
  const key = kind + color + cell;
  let rec = patCache.get(key);
  if (rec) return rec;
  const px = Math.max(8, Math.round(cell));
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const c = cv.getContext('2d');
  c.fillStyle = color;
  if (kind === 'dots') {
    c.beginPath(); c.arc(px / 2, px / 2, px * 0.19, 0, J.TAU); c.fill();
  } else {
    // 噪点：一小格随机麻点，用同一张图平铺，省钱
    const n = Math.round(px * px * 0.07);
    for (let i = 0; i < n; i++) c.fillRect(Math.random() * px, Math.random() * px, Math.random() < 0.75 ? 1 : 2, 1);
  }
  rec = { cv, px };
  if (patCache.size > 40) patCache.clear();
  patCache.set(key, rec);
  return rec;
}

function patternFor(ctx, kind, color, cell, scale) {
  const k = Math.min(3, Math.max(1, scale || 1));
  const { cv, px } = patOf(kind, color, cell * k);
  const pat = ctx.createPattern(cv, 'repeat');
  try { if (pat && pat.setTransform && k !== 1) pat.setTransform(new DOMMatrix().scale(1 / k)); } catch (e) {}
  return pat;
}

function rr(ctx, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(w, 0, w, h, r); ctx.arcTo(w, h, 0, h, r);
  ctx.arcTo(0, h, 0, 0, r); ctx.arcTo(0, 0, w, 0, r);
  ctx.closePath();
}

/* 一块形状：clip 到圆角矩形里再画纹理 */
function drawBlock(ctx, b, col, alpha, t, scale) {
  const { w, h } = b;
  ctx.save();
  ctx.translate(b.x, b.y);
  if (b.rot) ctx.rotate(b.rot);
  rr(ctx, w, h, Math.min(w, h) * 0.055);
  ctx.clip();
  if (b.kind === 'block') {
    ctx.globalAlpha = alpha * 1.25; ctx.fillStyle = col;
    ctx.fillRect(0, 0, w, h);
  } else if (b.kind === 'honey') {
    // 蜂窝：一圈圈六边形描边，半径跟块的大小走
    const R = Math.max(14, Math.min(w, h) * 0.075), dx = R * 1.5, dy = R * Math.sqrt(3) / 2;
    ctx.globalAlpha = alpha * 1.7; ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, R * 0.055);
    ctx.beginPath();
    for (let row = -1; row * dy < h + dy; row++) {
      for (let cx = -1; cx * dx < w + dx * 2; cx++) {
        const x = cx * dx * 2 + (row & 1 ? dx : 0), y = row * dy;
        for (let k = 0; k < 6; k++) {
          const a = (60 * k - 30) * J.DEG, px = x + Math.cos(a) * R, py = y + Math.sin(a) * R;
          k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath();
      }
    }
    ctx.stroke();
  } else if (b.kind === 'dots') {
    ctx.globalAlpha = alpha * 1.9;
    ctx.fillStyle = patternFor(ctx, 'dots', col, Math.max(9, Math.min(w, h) * 0.05), scale);
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.globalAlpha = alpha * 2.6;
    ctx.fillStyle = patternFor(ctx, 'noise', col, 96, scale);
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

/* 每帧调用：背景之后、文字之前 */
J.drawShapes = (ctx, plan, sc, t, scale) => {
  const cfg = plan && plan.text;
  if (!cfg || !cfg.shapes) return;
  const on = KINDS.filter(k => cfg.shapes[k]);
  if (!on.length) return;
  let blocks = plan._shapeBlocks;
  if (!blocks || blocks._sig !== on.join(',')) {
    blocks = blocksOf(plan, cfg);
    blocks._sig = on.join(',');
    plan._shapeBlocks = blocks;
  }
  if (!blocks.length) return;
  const amt = cfg.amt == null ? 0.45 : J.clamp(cfg.amt);
  const drift = cfg.drift == null ? 0.5 : J.clamp(cfg.drift);
  const alpha = 0.05 + amt * 0.19;
  const palette = [sc.accent, sc.accent2 || sc.accent, sc.fg];
  const amp = (0.003 + drift * 0.02) * plan.W;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  for (const b of blocks) {
    const x = b.x + Math.sin(t * b.sp + b.ph) * amp;
    const y = b.y + Math.cos(t * b.sp * 0.82 + b.ph * 1.7) * amp * 0.72;
    drawBlock(ctx, { x, y, w: b.w, h: b.h, rot: b.rot, kind: b.kind }, palette[b.ci] || sc.accent, alpha, t, scale || 1);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
};
})();
