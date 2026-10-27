/* ============================================================
   字面工房 — 素材插槽（material slot）

   构图（11p_layouts*）在自己的 ctx.save() / translate() / rotate() 之后调用：

     env.slot('photo', x, y, w, h, { r, tone, alpha })

   (x, y, w, h) 用构图「当前」的局部坐标（设计像素）。渲染器会把这一层
   变换矩阵连同插槽几何交给 app/studio.js —— 素材于是被画进纸面 / 照片窗里，
   跟着这一页一起入场、倾斜、退场，而不是浮在画面中间。

   构图还可以在自己的定义上声明：  slots: ['photo']  （第一个 = 主插槽）
   slot: true 表示这一版能放素材（planner 会给「有素材的行」优先挑它们）。
   ============================================================ */
(() => {
'use strict';

/* 素材在纸上的"材质"：
   photo = 照片原色（拍立得那种）
   print = 印上去的（略褪色 + 罩一层纸色，和信纸 / 明信片同一张纸）
   wash  = 淡印 / 水洗（大面积垫底，字压在上面也看得清） */
J.SLOT_TONES = {
  photo: { desat: 0, veil: 0, alpha: 1, zoom: 1.02 },
  print: { desat: 0.26, veil: 0.18, alpha: 1, zoom: 1.04 },
  paper: { desat: 0.32, veil: 0.3, alpha: 0.94, zoom: 1.04 },
  wash: { desat: 0.5, veil: 0.42, alpha: 0.9, zoom: 1.06 },
};

/* env.slot(name, x, y, w, h, o) → true 表示这一格已经画上素材 */
J.slot = (env, name, x, y, w, h, o) => {
  o = o || {};
  const ctx = env && env.ctx;
  if (!ctx || !(w > 0.5) || !(h > 0.5)) return false;
  if (env.pass && env.pass !== 'main') return false;        // 色差重影的两遍不重画素材：省一半开销，也不会三层重影
  let m = null;
  try { m = ctx.getTransform(); } catch (e) { m = null; }
  if (!m) return false;
  const slot = {
    name: name || 'photo',
    x, y, w, h,
    r: Math.max(0, o.r || 0),
    rot: o.rot || 0,
    alpha: o.alpha == null ? 1 : J.clamp(o.alpha),
    tone: o.tone || 'photo',
    fit: o.fit || 'cover',
    margin: o.margin || 0,
    env, cut: env.cut,
    m: [m.a, m.b, m.c, m.d, m.e, m.f],
    paper: o.paper || (env.sc && (env.sc.paper || env.sc.bg)) || '#ffffff',
    ink: (env.sc && env.sc.fg) || '#000000',
  };
  if (slot.alpha <= 0.004) return false;
  // 记下插槽在画布上的包围盒：11t_slotAtmosphere 画边缘装饰时避开它，绝不盖住素材
  try {
    const a = slot.m[0], b = slot.m[1], c = slot.m[2], d = slot.m[3], e = slot.m[4], f = slot.m[5];
    const pt = (px, py) => [a * px + c * py + e, b * px + d * py + f];
    const p1 = pt(x, y), p2 = pt(x + w, y), p3 = pt(x + w, y + h), p4 = pt(x, y + h);
    const xs = [p1[0], p2[0], p3[0], p4[0]], ys = [p1[1], p2[1], p3[1], p4[1]];
    (env._slotRects || (env._slotRects = [])).push({
      x0: Math.min.apply(null, xs), y0: Math.min.apply(null, ys),
      x1: Math.max.apply(null, xs), y1: Math.max.apply(null, ys),
    });
  } catch (e) {}
  let hit = false;
  if (typeof env.slotPaint === 'function') {
    try { hit = !!env.slotPaint(slot); } catch (e) { console.warn('slot:' + slot.name, e); }
  }
  if (!hit && env.slotGuide) J.slotGuide(env, slot);
  return hit;
};

/* 效果库预览用：没有素材时画一个很淡的取景框，告诉用户「这一版能放素材」 */
J.slotGuide = (env, slot) => {
  const ctx = env.ctx, a = slot.alpha * (env.pass === 'main' ? 0.5 : 0.25);
  if (a <= 0.01) return;
  ctx.save();
  ctx.setTransform(slot.m[0], slot.m[1], slot.m[2], slot.m[3], slot.m[4], slot.m[5]);
  ctx.globalAlpha = a;
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = slot.ink; ctx.lineWidth = Math.max(1, Math.min(slot.w, slot.h) * 0.006);
  ctx.setLineDash([slot.w * 0.03, slot.w * 0.025]);
  roundPath(ctx, slot.x, slot.y, slot.w, slot.h, slot.r || Math.min(slot.w, slot.h) * 0.02);
  ctx.stroke();
  ctx.setLineDash([]);
  // 取景框的四角
  const L = Math.min(slot.w, slot.h) * 0.14, x0 = slot.x, y0 = slot.y, x1 = slot.x + slot.w, y1 = slot.y + slot.h;
  ctx.beginPath();
  ctx.moveTo(x0, y0 + L); ctx.lineTo(x0, y0); ctx.lineTo(x0 + L, y0);
  ctx.moveTo(x1 - L, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + L);
  ctx.moveTo(x1, y1 - L); ctx.lineTo(x1, y1); ctx.lineTo(x1 - L, y1);
  ctx.moveTo(x0 + L, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - L);
  ctx.stroke();
  ctx.restore();
};

/* 圆角矩形路径（局部坐标） */
function roundPath(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (!r) { ctx.rect(x, y, w, h); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
J.roundPath = roundPath;

/* 这一版式能放素材吗（planner / studio 用来挑版式） */
J.hasSlot = key => {
  const L = J.LAYOUTS && J.LAYOUTS[key];
  return !!(L && L.slot);
};
J.slotLayouts = () => (J.LAYOUT_ORDER || []).filter(k => J.hasSlot(k));
})();
