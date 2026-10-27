/* ============================================================
   字面工房 — 两侧补白（garnish）

   给「画面中间一张纸 / 一张照片、左右空荡荡」的版式用：
   竖排英文 + 色块 + 网点 + 编号，贴着左右两边排。

      J.garnishSides(env, { band: bb })

   band = 版式这一帧画出来的包围盒。有了它，补白只会画在纸外面
   （左／右两条带子里，越窄就自动减内容），不会压在纸上。
   只在横画幅、只在主画面上画一遍。
   ============================================================ */
(() => {
'use strict';

const F = env => (env.st.fonts.mono && env.st.fonts.mono[0]) || (env.st.fonts.body && env.st.fonts.body[0]) || 'gothic_med';
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;

function romaOf(env) {
  const t = String((env.cut && env.cut.text) || '').replace(/\s+/g, '');
  if (!t) return '';
  if (!CJK.test(t)) return t.toUpperCase();
  const r = J.romaji ? J.romaji(t) : null;
  return r ? r.toUpperCase() : '';
}

/* 网点条：越往下越小，像印出来的半调 */
function dots(ctx, x, y, w, h, r, col, a, rows, cols) {
  if (a <= 0.004 || w <= 0.5 || h <= 0.5) return;
  ctx.save();
  ctx.globalAlpha = a; ctx.fillStyle = col;
  ctx.beginPath();
  const sx = w / Math.max(1, cols - 1), sy = h / Math.max(1, rows - 1);
  for (let j = 0; j < rows; j++) {
    const k = 1 - j / Math.max(1, rows - 1);
    for (let i = 0; i < cols; i++) {
      const rr = r * (0.35 + k * 0.95);
      if (rr <= 0.2) continue;
      ctx.moveTo(x + i * sx + rr, y + j * sy);
      ctx.arc(x + i * sx, y + j * sy, rr, 0, J.TAU);
    }
  }
  ctx.fill();
  ctx.restore();
}

J.garnishSides = (env, o = {}) => {
  const { W, H, sc, ctx } = env;
  if (!W || !H || !sc) return;
  if (env.pass && env.pass !== 'main') return;                 // 只画一遍：补白不参与色差重影
  if (H > W * 1.06) return;                                    // 竖画幅：纸已经占满，不加
  const a0 = J.clamp((env.lt - 0.22) / 0.5) * (1 - J.clamp((env.pOut - 0.25) / 0.75));
  if (a0 <= 0.012) return;
  const a = a0 * (o.alpha == null ? 1 : o.alpha);
  const U = Math.min(W, H);

  // 纸的左右边界：给了包围盒就用它，没有就默认左右各 22%
  const bb = o.band || null;
  const pad = U * 0.018;
  const lEdge = bb ? J.clamp(bb.x0 - pad, 0, W) : W * 0.22;
  const rEdge = bb ? J.clamp(bb.x1 + pad, 0, W) : W * 0.78;
  const bands = [];
  if (lEdge > W * 0.075) bands.push({ dir: -1, x0: 0, x1: lEdge });
  if (W - rEdge > W * 0.075) bands.push({ dir: 1, x0: rEdge, x1: W });
  if (!bands.length) return;

  const label = (o.text != null ? String(o.text) : romaOf(env)) || 'MEMORY';
  const accent = o.color || sc.accent || sc.fg;
  const ink = J.lum(sc.bg || '#ffffff') < 0.5 ? (sc.fg || '#fff') : (sc.ink || sc.fg || '#111');
  const sub = sc.sub || ink;
  const num = 'No.' + String(Math.max(0, (env.cut.line | 0) + 1)).padStart(2, '0');
  const font = F(env);

  for (const b of bands) {
    const bw = b.x1 - b.x0;
    if (bw < U * 0.02) continue;
    const outer = b.dir < 0 ? b.x0 : b.x1;       // 贴画面外沿的那一边
    const cur = v => outer - b.dir * v;          // 从外沿往里量
    const seg = (d0, d1, y, h, col, al) =>
      env.rect(Math.min(cur(d0), cur(d1)), y, Math.abs(d1 - d0), h, col, al, false);

    // 按带子宽度排：英文 → 色块 → 网点，越窄字体越小、网点越少
    const tSize = Math.min(U * 0.030, Math.max(9, bw * 0.18));
    const tX = Math.max(tSize * 0.9, bw * 0.05);
    const barX0 = tX + tSize * 0.62 + bw * 0.03;
    const barW = Math.min(U * 0.026, Math.max(5, bw * 0.14));
    const dotsX0 = barX0 + barW + bw * 0.03;
    const dotsW = Math.min(bw * 0.28, U * 0.05);
    const wide = bw > U * 0.09;

    ctx.save();
    ctx.beginPath(); ctx.rect(b.x0, 0, bw, H); ctx.clip();

    // 竖排英文（自下而上）
    env.draw({
      text: label.slice(0, 20), font, size: tSize, x: cur(tX), y: H * 0.5,
      rot: b.dir < 0 ? -90 : 90, track: 0.34, color: ink, alpha: a * 0.85, ghost: false,
    });
    // 色块：一根竖条 + 一小块压在下面
    seg(barX0, barX0 + barW, H * 0.17, H * 0.34, accent, a * 0.92);
    if (wide) seg(barX0 + barW + U * 0.004, barX0 + barW + U * 0.004 + U * 0.012, H * 0.53, H * 0.09, ink, a * 0.7);
    // 网点
    if (dotsW > U * 0.012) dots(ctx, Math.min(cur(dotsX0), cur(dotsX0 + dotsW)), H * 0.6, dotsW, H * 0.25, Math.min(U * 0.0034, dotsW * 0.09), a * 0.95, accent, 13, 4);
    // 编号 + 一小段线
    env.draw({ text: num, font, size: Math.min(U * 0.016, tSize * 0.9), x: cur(tX), y: H * 0.135, align: 'center', track: 0.1, color: sub, alpha: a * 0.8, ghost: false });
    env.line([[cur(tX), H * 0.152], [cur(tX), H * 0.167]], sub, 1, a * 0.5, false);

    ctx.restore();
  }
};
})();
