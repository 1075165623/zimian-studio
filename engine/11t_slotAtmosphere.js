/* ============================================================
   字面工房 — 可嵌套版式的「环境层」

   带 slot 的版式（拍立得 / 信纸 / 杂志 / 竖排刊头 …）本身要把画面
   中央让给素材，容易显得四周空。这里给所有 slot 版式自动补一层
   会呼吸的版面装饰：巨大裁切字、竖排边字、色带、圆环、网点、细线、
   角标和粒子，全部随播放头缓慢移动。

   由 05b_registry.js 在注册 slot:layout 时包一层：
     before render → J.slotAtmosphere()
     after  render → J.slotAtmosphereFront()
   只画在 main pass，不参与色差重影 / 背景预渲染。
   ============================================================ */
(() => {
  'use strict';

  const MONO = 'mono';
  const clean = s => String(s || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[*/!]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const fontOf = env => {
    const p = env && env.cut && env.cut.params;
    return (p && p.font) || 'gothic_bold';
  };
  const timeOf = env => env && (env.t != null ? env.t : env.lt) || 0;
  const hitSlot = (env, x0, y0, x1, y1) => {
    const rs = env && env._slotRects;
    if (!rs || !rs.length) return false;
    for (const r of rs) if (x1 > r.x0 && x0 < r.x1 && y1 > r.y0 && y0 < r.y1) return true;
    return false;
  };
  const glyph = (env, ch, x, y, size, rot, color, alpha, outline, font) => {
    if (!(alpha > 0.002)) return;
    const ctx = env.ctx;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot || 0);
    ctx.font = J.fontCSS(font || fontOf(env), size);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalAlpha = alpha;
    if (outline) { ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, size * 0.012); ctx.strokeText(ch, 0, 0); }
    else { ctx.fillStyle = color; ctx.fillText(ch, 0, 0); }
    ctx.restore();
  };
  const vtext = (env, text, x, y, size, alpha, color, down) => {
    if (!(alpha > 0.002)) return;
    const ctx = env.ctx;
    ctx.save();
    ctx.translate(x, y); ctx.rotate((down ? 90 : -90) * J.DEG);
    ctx.font = J.fontCSS(fontOf(env), size);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.globalAlpha = alpha; ctx.fillStyle = color;
    const n = Math.min(text.length, 26);
    for (let i = 0; i < n; i++) ctx.fillText(text[i], 0, i * size * 1.12);
    ctx.restore();
  };

  /* 版式自己的内容画之前：铺一层有构图的「满」底纹 */
  J.slotAtmosphere = env => {
    if (!env || env.pass !== 'main' || env.bgOnly) return;
    const { W, H, ctx, sc } = env;
    if (!(W > 10) || !(H > 10) || !ctx) return;
    const t = timeOf(env);
    const text = clean(env.cut && env.cut.text) || 'TYPE / MOTION';
    const chars = text.replace(/\s/g, '') || 'A';
    const font = fontOf(env);
    const acc = sc.accent || sc.fg;
    const acc2 = sc.accent2 || acc;
    const fg = sc.fg || sc.ink || '#ffffff';
    const seed = (env.cut && env.cut.seed) || 1;
    const rng = J.rng(J.sid(text + '|' + ((env.cut && env.cut.line) | 0)));

    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();

    // 1. 底色微渐变 + 两块慢慢漂移的斜色带
    const wash = ctx.createLinearGradient(0, 0, W, H);
    wash.addColorStop(0, J.rgba(acc, 0.055));
    wash.addColorStop(0.55, 'rgba(0,0,0,0)');
    wash.addColorStop(1, J.rgba(acc2, 0.045));
    ctx.fillStyle = wash; ctx.fillRect(0, 0, W, H);

    const band = (cx, cy, w, h, rot, color, alpha) => {
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(rot * J.DEG);
      ctx.globalAlpha = alpha; ctx.fillStyle = color;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.restore();
    };
    band(W * 0.72, H * 0.28 + Math.sin(t * 0.09) * H * 0.01, W * 1.1, H * 0.16, -14, acc, 0.045);
    band(W * 0.18, H * 0.82 + Math.cos(t * 0.07) * H * 0.008, W * 0.8, H * 0.055, 7, acc2, 0.055);

    // 2. 巨大裁切字：一到两个，压在纸/素材后面，只做版面骨架
    const big = Math.min(W, H) * 0.64;
    glyph(env, chars[0] || 'A', W * 0.13 - Math.sin(t * 0.06) * W * 0.008, H * 0.54, big,
      (-9 + Math.sin(t * 0.05) * 2) * J.DEG, fg, 0.045, false, font);
    const g2 = chars[1] || chars[0] || 'A';
    glyph(env, g2, W * 0.88 + Math.cos(t * 0.07) * W * 0.006, H * 0.86, big * 0.52,
      (10 + Math.cos(t * 0.06) * 3) * J.DEG, acc, 0.05, true, font);

    // 3. 左右竖排边字：像书脊 / 页边的过版字
    vtext(env, text + text, W * 0.032, H * 0.10, Math.max(8, H * 0.026), 0.13, fg, true);
    vtext(env, text + text, W * 0.968, H * 0.11, Math.max(8, H * 0.026), 0.10, acc2, true);

    // 4. 细网格：把空场变成版面，不是空白
    ctx.globalAlpha = 0.045; ctx.strokeStyle = fg; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 6; i++) {
      const x = W * i / 6;
      ctx.moveTo(x, 0); ctx.lineTo(x, H);
    }
    for (let i = 1; i < 4; i++) {
      const y = H * i / 4;
      ctx.moveTo(0, y); ctx.lineTo(W, y);
    }
    ctx.stroke();

    // 5. 角上的网点：给一 corner 一点印刷质感
    const dot = Math.max(1, Math.min(W, H) * 0.0021);
    const gx = W * (0.08 + rng.range(0, 0.025)), gy = H * (0.82 + rng.range(0, 0.02));
    ctx.globalAlpha = 0.11; ctx.fillStyle = acc2;
    for (let r = 0; r < 6; r++) for (let c = 0; c < 10; c++) {
      if (J.r(seed, r, c, 7) < 0.4) continue;
      ctx.beginPath();
      ctx.arc(gx + c * dot * 4.4, gy - r * dot * 4.4, dot * (0.7 + 0.5 * J.r(seed, r, c, 8)), 0, J.TAU);
      ctx.fill();
    }

    // 6. 圆环 / 弧线：在空处慢慢转
    const ringR = Math.min(W, H) * (0.2 + Math.sin(t * 0.14) * 0.01);
    const rings = [[W * 0.78, H * 0.2, acc2], [W * 0.15, H * 0.7, acc]];
    rings.forEach((p, i) => {
      ctx.globalAlpha = 0.07 + i * 0.015;
      ctx.strokeStyle = p[2]; ctx.lineWidth = Math.max(1.2, Math.min(W, H) * 0.002);
      ctx.beginPath();
      ctx.arc(p[0], p[1], ringR * (0.7 + i * 0.2), t * (0.16 + i * 0.05) + i, t * (0.16 + i * 0.05) + i + 2.1);
      ctx.stroke();
    });

    // 7. 小 mono 信息，保持「制作中版面」的手感
    const mono = Math.max(7, Math.min(W, H) * 0.012);
    ctx.globalAlpha = 0.30;
    ctx.font = J.fontCSS(MONO, mono); ctx.fillStyle = fg;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('TYPE / ' + String(((env.cut && env.cut.line) | 0) + 1).padStart(2, '0'), W * 0.032, H * 0.055);
    ctx.fillText('MOTION / ' + Math.round(t * 10).toString().padStart(4, '0'), W * 0.968, H * 0.945);
    ctx.restore();
  };

  /* 版式内容画完之后：只在边缘补动态，避开素材框 */
  J.slotAtmosphereFront = env => {
    if (!env || env.pass !== 'main' || env.bgOnly) return;
    const { W, H, ctx, sc } = env;
    if (!(W > 10) || !(H > 10) || !ctx) return;
    const t = timeOf(env);
    const text = clean(env.cut && env.cut.text) || 'TYPE / MOTION';
    const acc = sc.accent || sc.fg;
    const acc2 = sc.accent2 || acc;
    const fg = sc.fg || sc.ink || '#ffffff';
    const m = Math.min(W, H) * 0.035;
    const size = Math.max(7, H * 0.032);

    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();

    // 1. 上下边带：过版小字，慢慢横移
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H * 0.06); ctx.rect(0, H * 0.94, W, H * 0.06); ctx.clip();
    ctx.font = J.fontCSS(fontOf(env), size);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (let side = 0; side < 2; side++) {
      const y = side ? H - H * 0.03 : H * 0.03;
      const drift = ((t * 14 * (side ? -1 : 1)) % (W * 0.7));
      for (let col = -1; col < 5; col++) {
        const x = col * W * 0.58 + drift;
        if (hitSlot(env, x, y - size, x + W * 0.55, y + size)) continue;
        ctx.globalAlpha = side ? 0.075 : 0.095;
        ctx.fillStyle = (col + side) % 3 === 0 ? acc : fg;
        ctx.fillText(text + '　' + text + '　', x, y);
      }
    }
    ctx.restore();

    // 2. 四角框线：像印刷裁切线
    ctx.globalAlpha = 0.30;
    ctx.strokeStyle = fg; ctx.lineWidth = 1;
    const L = Math.min(W, H) * 0.035;
    ctx.beginPath();
    ctx.moveTo(m, m + L); ctx.lineTo(m, m); ctx.lineTo(m + L, m);
    ctx.moveTo(W - m - L, m); ctx.lineTo(W - m, m); ctx.lineTo(W - m, m + L);
    ctx.moveTo(m, H - m - L); ctx.lineTo(m, H - m); ctx.lineTo(m + L, H - m);
    ctx.moveTo(W - m - L, H - m); ctx.lineTo(W - m, H - m); ctx.lineTo(W - m, H - m - L);
    ctx.stroke();

    // 3. 空处的大圆环 / 弧线，避开素材
    const ringR = Math.min(W, H) * (0.13 + Math.sin(t * 0.15) * 0.012);
    [[W * 0.82, H * 0.22], [W * 0.2, H * 0.8]].forEach((p, i) => {
      if (hitSlot(env, p[0] - ringR, p[1] - ringR, p[0] + ringR, p[1] + ringR)) return;
      ctx.globalAlpha = 0.11 + i * 0.02;
      ctx.strokeStyle = i ? acc : acc2; ctx.lineWidth = Math.max(1.2, Math.min(W, H) * 0.002);
      ctx.beginPath(); ctx.arc(p[0], p[1], ringR, t * 0.15 + i, t * 0.15 + i + 2.0); ctx.stroke();
    });

    // 4. 小粒子 / 十字：边缘一直有东西在动
    const rng = J.rng(J.sid(text + '|front|' + ((env.cut && env.cut.line) | 0)));
    ctx.globalAlpha = 0.4;
    for (let i = 0; i < 12; i++) {
      const px = (rng.range(0.04, 0.96) + Math.sin(t * 0.07 + i) * 0.014) * W;
      const py = (rng.range(0.05, 0.95) + Math.cos(t * 0.06 + i * 1.7) * 0.01) * H;
      if (hitSlot(env, px - 8, py - 8, px + 8, py + 8)) continue;
      const s = Math.max(1, Math.min(W, H) * (0.0016 + rng.range(0, 0.0018)));
      ctx.fillStyle = i % 4 === 0 ? acc : fg;
      ctx.beginPath(); ctx.arc(px, py, s, 0, J.TAU); ctx.fill();
      if (i % 5 === 0) {
        ctx.globalAlpha = 0.28; ctx.strokeStyle = acc;
        ctx.beginPath(); ctx.moveTo(px - s * 4, py); ctx.lineTo(px + s * 4, py);
        ctx.moveTo(px, py - s * 4); ctx.lineTo(px, py + s * 4); ctx.stroke();
        ctx.globalAlpha = 0.4;
      }
    }

    // 5. 底部呼吸线
    ctx.globalAlpha = 0.10 + 0.04 * (0.5 + 0.5 * Math.sin(t * 0.9));
    ctx.fillStyle = acc;
    ctx.fillRect(m, H - H * 0.045, W * (0.10 + 0.03 * Math.sin(t * 0.45)), Math.max(1, H * 0.0015));
    ctx.restore();
  };
})();

