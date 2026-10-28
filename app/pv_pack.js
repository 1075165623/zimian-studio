/* ============================================================
   PV专区 — 新手法包
   这些不是独立于高级手法库的另一套渲染器：构图里用到的蓝色网格、
   轨道线、星芒、手绘玫瑰、闪切/蓝擦/滑切/镜头漂移都注册进 J 的
   decor / trans / cam 表，和 928 个旧手法共用同一套库。
   PV 模板是这一包的默认导演组合。
   ============================================================ */
(() => {
  if (!window.J) return;
  const J = window.J;

  const blue = (env, a = 1) => (env.sc && env.sc.blue) || `rgba(97,117,199,${a})`;

  J.register('decor', 'pvGrid', {
    name: 'PV·网格纸', cn: 'PV·网格纸', w: .5, subtle: true,
    draw(env) {
      const { ctx, W, H } = env; ctx.save();
      ctx.strokeStyle = '#6175C7';
      for (let x = 0; x <= W; x += 48) { ctx.globalAlpha = x % 240 === 0 ? .22 : .10; ctx.lineWidth = x % 240 === 0 ? 1.5 : 1; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y <= H; y += 48) { ctx.globalAlpha = y % 240 === 0 ? .22 : .10; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      ctx.restore();
    },
  });
  J.register('decor', 'pvOrbit', {
    name: 'PV·轨道线', cn: 'PV·轨道线', w: .45, subtle: true,
    draw(env) {
      const { ctx, W, H } = env; ctx.save();
      ctx.translate(W * .5, H * .46); ctx.rotate(-.16);
      ctx.strokeStyle = 'rgba(142,156,220,.7)'; ctx.lineWidth = Math.max(2, Math.min(W, H) * .006);
      ctx.beginPath(); ctx.ellipse(0, 0, W * .31, H * .19, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
    },
  });
  J.register('decor', 'pvSpark', {
    name: 'PV·星芒', cn: 'PV·星芒', w: .35, subtle: true,
    draw(env) {
      const { ctx, W, H } = env; const r = Math.min(W, H) * .026, x = W * .84, y = H * .18;
      ctx.save(); ctx.translate(x, y); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#6175C7'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * .22, -r * .22); ctx.lineTo(r, 0); ctx.lineTo(r * .22, r * .22); ctx.lineTo(0, r); ctx.lineTo(-r * .22, r * .22); ctx.lineTo(-r, 0); ctx.lineTo(-r * .22, -r * .22); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    },
  });
  J.register('decor', 'pvRose', {
    name: 'PV·手绘玫瑰', cn: 'PV·手绘玫瑰', w: .3, subtle: false,
    draw(env) {
      const { ctx, W, H } = env, u = Math.min(W, H), x = W * .22, y = H * .62;
      ctx.save(); ctx.translate(x, y); ctx.lineWidth = Math.max(2, u * .004); ctx.strokeStyle = '#fff'; ctx.fillStyle = '#D9AE62';
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.ellipse(0, 0, u * (.035 + i * .004), u * (.027 + i * .003), i * 1.1, 0, 7); ctx.fill(); ctx.stroke(); }
      ctx.restore();
    },
  });
  J.register('decor', 'pvDots', {
    name: 'PV·网点', cn: 'PV·网点', w: .4, subtle: true,
    draw(env) {
      const { ctx, W, H } = env; ctx.save(); ctx.fillStyle = '#6175C7';
      for (let y = H * .34; y < H * .72; y += 22) for (let x = 28; x < W * .25; x += 22) { ctx.globalAlpha = .28; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 7); ctx.fill(); }
      ctx.restore();
    },
  });
  J.register('decor', 'pvFrame', {
    name: 'PV·注册框', cn: 'PV·注册框', w: .25, subtle: true,
    draw(env) {
      const { ctx, W, H } = env; ctx.save(); ctx.strokeStyle = 'rgba(97,117,199,.45)'; ctx.lineWidth = 1.5;
      ctx.strokeRect(26, 74, W - 52, H - 148);
      for (const [x, y] of [[26, 74], [W - 26, 74], [26, H - 74], [W - 26, H - 74]]) { ctx.beginPath(); ctx.moveTo(x - 10, y); ctx.lineTo(x + 10, y); ctx.moveTo(x, y - 10); ctx.lineTo(x, y + 10); ctx.stroke(); }
      ctx.restore();
    },
  });

  J.register('trans', 'pvFlashCut', {
    name: 'PV·白闪硬切', cn: 'PV·白闪硬切', w: .6, dur: .14,
    draw(ctx, A, B, p, info) {
      ctx.drawImage(B, 0, 0);
      if (p < .45) { ctx.save(); ctx.globalAlpha = (1 - p / .45) * .9; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, info.cw, info.ch); ctx.restore(); }
    },
  });
  J.register('trans', 'pvBlueWipe', {
    name: 'PV·蓝块擦除', cn: 'PV·蓝块擦除', w: .5, dur: .22,
    draw(ctx, A, B, p, info) {
      const { cw, ch } = info; ctx.drawImage(A, 0, 0);
      const e = 1 - Math.pow(1 - p, 3);
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, cw * e, ch); ctx.clip(); ctx.drawImage(B, 0, 0); ctx.restore();
      ctx.save(); ctx.globalAlpha = (1 - e) * .8; ctx.fillStyle = '#6175C7'; ctx.fillRect(cw * e - cw * .08, 0, cw * .08, ch); ctx.restore();
    },
  });
  J.register('trans', 'pvSlideCut', {
    name: 'PV·横向滑切', cn: 'PV·横向滑切', w: .45, dur: .18,
    draw(ctx, A, B, p, info) {
      const { cw, ch } = info, e = 1 - Math.pow(1 - p, 3);
      ctx.globalAlpha = 1 - e; ctx.drawImage(A, -e * cw * .3, 0);
      ctx.globalAlpha = e; ctx.drawImage(B, (1 - e) * cw * .3, 0); ctx.globalAlpha = 1;
    },
  });

  J.register('cam', 'pvDrift', {
    name: 'PV·慢漂移', cn: 'PV·慢漂移', w: .5,
    get(env) {
      const u = (env.lt || 0) / Math.max(.5, env.cut.dur || 1);
      return { s: 1 + .018 * u, x: (u - .5) * env.W * .015, y: (u - .5) * env.H * .01 };
    },
  });
  J.register('cam', 'pvPush', {
    name: 'PV·缓推', cn: 'PV·缓推', w: .45,
    get(env) { return { s: 1 + .028 * Math.min(1, (env.lt || 0) / Math.max(.4, env.cut.dur || 1)) }; },
  });

  window.PV_PACK = {
    name: 'PV专区',
    techniques: ['pvGrid', 'pvOrbit', 'pvSpark', 'pvRose', 'pvDots', 'pvFrame', 'pvFlashCut', 'pvBlueWipe', 'pvSlideCut', 'pvDrift', 'pvPush'],
    note: 'PV 模板默认导演组合；这些手法与旧库共用同一套 J registry。',
  };
})();
