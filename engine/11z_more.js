/* ============================================================
   字面工房 — 本作新增（more）
   · 4 个入场、4 个滞留、6 个转场
   · 4 套中文向配色
   全部走官方 J.register，不改动引擎核心。
   ============================================================ */
(() => {
'use strict';
const E = J.E, clamp = J.clamp, lerp = J.lerp, TAU = J.TAU, DEG = J.DEG;
const PK = 'more';
const reg = (g, k, d) => J.register(g, k, d, PK);

const oQuart = x => 1 - Math.pow(1 - clamp(x), 4);
const oQuint = x => 1 - Math.pow(1 - clamp(x), 5);
const bell = x => Math.sin(clamp(x) * Math.PI);

const glyphN = it => [...String(it.text || '').replace(/\s/g, '')].length;
const colOf = it => (typeof it.color === 'string' && it.color[0] === '#' ? it.color : '#FFFFFF');

/* ══════════════════ 入场 ══════════════════ */

/* 幕布掀起：每个字像被从下往上拉起一块幕布 */
reg('enter', 'mxCurtainLift', {
  name: '幕布掀起', tags: ['editorial', 'calm', 'pop', 'graphic'], w: 1.1, ae: 'wipe',
  apply(env, it, p) {
    const size = it.size;
    it.charFns.push((i, g, n) => {
      const k = n > 1 ? i / (n - 1) : 0;
      const q = clamp((p - 0.42 * k) / 0.58);
      if (q <= 0) return { hide: true };
      const e = oQuint(q);
      return {
        clipY: [0.66 - 1.34 * e, 0.66],
        dy: (1 - e) * size * 0.22,
        a: q < 0.25 ? q / 0.25 : 1,
      };
    });
  },
});

/* 三连重击：从很大缩下来，中途被打断两次 */
reg('enter', 'mxPunchIn', {
  name: '三连重击', tags: ['pop', 'graphic', 'glitch'], w: 0.9, ae: 'zoom',
  apply(env, it, p) {
    const K = 3, x = p * K, k = Math.min(K - 1, Math.floor(x)), f = x - k;
    const e = E.outExpo(clamp(f * 1.25));
    const from = [1.82, 1.34, 1.11][k];
    const s = lerp(from, 1, e);
    it.sx = (it.sx || 1) * s;
    it.sy = (it.sy || 1) * s;
    it.alpha = (it.alpha ?? 1) * (p < 0.08 ? clamp(p / 0.08) : 1);
  },
});

/* 声波立起：像均衡器一样从一条线里长出来，左右错拍 */
reg('enter', 'mxEqRise', {
  name: '声波立起', tags: ['pop', 'kinetic', 'graphic'], w: 0.85, ae: 'pop',
  apply(env, it, p) {
    const size = it.size, seed = it.seed | 0;
    it.charFns.push((i, g, n) => {
      const k = n > 1 ? i / (n - 1) : 0;
      const jitter = J.r(seed, i, 11) * 0.16;
      const q = clamp((p - k * 0.4 - jitter) / 0.6);
      if (q <= 0) return { hide: true };
      const e = E.outBack(q, 1.5);
      return { sy: 0.05 + 0.95 * e, dy: (1 - e) * size * 0.42, a: q < 0.3 ? q / 0.3 : 1 };
    });
  },
});

/* 逐步显影：分四档打开，像老显示器一行行把字刷出来 */
reg('enter', 'mxMosaicSolve', {
  name: '逐步显影', tags: ['glitch', 'graphic', 'editorial'], w: 0.8, ae: 'slice',
  apply(env, it, p) {
    const size = it.size, S = 4;
    it.charFns.push((i, g, n) => {
      const k = n > 1 ? i / (n - 1) : 0;
      const raw = clamp((p - 0.3 * k) / 0.7);
      const q = Math.floor(raw * S) / S;
      if (raw <= 0) return { hide: true };
      return { clipX: [-0.72 * q, 0.72 * q], blur: (1 - q) * size * 0.05, a: raw < 0.12 ? raw / 0.12 : 1 };
    });
  },
});

/* ══════════════════ 滞留 ══════════════════ */

/* 视差倾斜：整行像一块慢慢扭动的布 */
reg('hold', 'mxParallaxTilt', {
  name: '视差倾斜', tags: ['calm', 'emotional', 'editorial', 'graphic'], w: 0.9, ae: 'drift',
  apply(env, it, amt) {
    const m = amt * (env.fx.motion ?? 0.7), t = env.lt;
    if (m < 0.02) return;
    const size = it.size;
    it.charFns.push((i, g, n) => {
      const k = n > 1 ? (i / (n - 1)) * 2 - 1 : 0;
      return {
        rot: Math.sin(t * 1.5 + k * 1.9) * 5.2 * m * Math.abs(k),
        skew: k * 11 * m * Math.sin(t * 0.85 + 0.6),
        dy: k * k * size * 0.045 * m,
      };
    });
  },
});

/* 阶梯旋转：每 1/4 秒才换一次角度，像定格动画在转 */
reg('hold', 'mxStepRotate', {
  name: '阶梯旋转', tags: ['glitch', 'pop', 'graphic'], w: 0.8, ae: 'jitter',
  apply(env, it, amt) {
    const m = amt * (env.fx.motion ?? 0.7);
    if (m < 0.02) return;
    const tick = Math.floor(env.lt * 4), seed = it.seed | 0, size = it.size;
    it.charFns.push((i) => ({
      rot: Math.round(J.rs(seed, i, tick, 21) * 2) * 2.8 * m,
      dy: Math.round(J.rs(seed, i, tick, 22)) * size * 0.03 * m,
    }));
  },
});

/* 微手持：机位像被一只手托着，只有极小的滑移（比 jitter 顺、比 drift 细） */
reg('hold', 'mxMicroHandheld', {
  name: '微手持', tags: ['calm', 'emotional', 'editorial', 'pop'], w: 1.05, ae: 'drift',
  apply(env, it, amt) {
    const m = amt * (env.fx.motion ?? 0.7);
    if (m < 0.02) return;
    const size = it.size, t = env.ltb;
    const nx = J.noise1(t * 0.62, 17), ny = J.noise1(t * 0.53 + 31, 23);
    it.x += nx * size * 0.085 * m;
    it.y += ny * size * 0.105 * m;
    it.rot = (it.rot || 0) + nx * 1.1 * m;
  },
});

/* 涟漪过：每隔一秒多有一道脉冲顺着字序走过去，字被轻轻顶一下 */
reg('hold', 'mxRipplePass', {
  name: '涟漪过', tags: ['calm', 'pop', 'graphic', 'emotional'], w: 0.95, ae: 'wave',
  apply(env, it, amt) {
    const m = amt * (env.fx.motion ?? 0.7);
    if (m < 0.02) return;
    const size = it.size, per = 1.15, ph = (env.lt / per) % 1;
    it.charFns.push((i, g, n) => {
      const k = n > 1 ? i / (n - 1) : 0;
      const d = Math.exp(-Math.pow((k - ph) / 0.17, 2));
      if (d < 0.02) return null;
      return { s: 1 + 0.145 * d * m, dy: -size * 0.05 * d * m, rot: d * 3 * m };
    });
  },
});

/* ══════════════════ 转场 ══════════════════ */

const trReg = (k, d) => reg('trans', k, Object.assign({}, d, {
  draw(ctx, A, B, p, I) {
    ctx.save();
    try {
      if (!(p > 0)) ctx.drawImage(A, 0, 0);
      else if (p >= 1) ctx.drawImage(B, 0, 0);
      else d.draw(ctx, A, B, p, I, I.P || {});
    } finally { ctx.restore(); }
  },
}));

/* 帘片推进：竖条一片片把新画面推上来，前后错开 */
trReg('mxSlatPush', {
  name: '帘片推进', tags: ['graphic', 'pop', 'editorial'], w: 1, dur: 0.42, ae: 'sliceShift',
  plan: rng => ({ n: rng.int(5, 9), dir: rng.chance(0.5) ? 1 : -1, from: rng.chance(0.6) ? 'down' : 'side' }),
  draw(ctx, A, B, p, I, P) {
    const { cw, ch } = I, n = P.n || 6, w = cw / n, dry = 0.34;
    ctx.drawImage(A, 0, 0);
    for (let i = 0; i < n; i++) {
      const d = (i / Math.max(1, n - 1)) * dry;
      const q = oQuart(clamp((p - d) / (1 - dry)));
      if (q <= 0) continue;
      const x = i * w;
      ctx.save();
      ctx.beginPath(); ctx.rect(x, 0, w + 1, ch); ctx.clip();
      if (P.from === 'down') ctx.drawImage(B, x, -(1 - q) * ch);
      else ctx.drawImage(B, x - (P.dir >= 0 ? 1 : -1) * (1 - q) * cw * 0.6, 0);
      ctx.restore();
    }
  },
});

/* 墨波扩散：从一点漾开的圆把新画面盖过来 */
trReg('mxInkRipple', {
  name: '墨波扩散', tags: ['emotional', 'calm', 'pop'], w: 0.9, dur: 0.5, ae: 'irisOpen',
  plan: rng => ({ cx: rng.range(0.32, 0.68), cy: rng.range(0.36, 0.64), wob: rng.range(3, 7), ring: rng.chance(0.7) }),
  draw(ctx, A, B, p, I, P) {
    const { cw, ch } = I, e = E.inOutCubic(p);
    const cx = cw * (P.cx ?? 0.5), cy = ch * (P.cy ?? 0.5);
    const R = Math.hypot(cw, ch) * 0.62 * e + 1;
    const N = 84, seed = (I.seed | 0) || 7;
    const path = rr => {
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * TAU;
        const wob = 1 + 0.055 * Math.sin(a * (P.wob || 5) + seed * 0.001) + 0.03 * Math.sin(a * ((P.wob || 5) * 2.3));
        const x = cx + Math.cos(a) * rr * wob, y = cy + Math.sin(a) * rr * wob;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
    };
    ctx.drawImage(A, 0, 0);
    ctx.save(); path(R); ctx.clip(); ctx.drawImage(B, 0, 0); ctx.restore();
    if (P.ring && R > 2) {
      ctx.save();
      ctx.globalAlpha = bell(p) * 0.9;
      ctx.strokeStyle = (I.sc && I.sc.accent) || '#ffffff';
      ctx.lineWidth = Math.max(1.5, Math.hypot(cw, ch) * 0.004);
      path(R); ctx.stroke();
      ctx.globalAlpha = bell(p) * 0.4;
      path(R * 0.965); ctx.stroke();
      ctx.restore();
    }
  },
});

/* 翻页：像翻一张纸，旧画面被卷入、新画面在下面等着 */
trReg('mxPageTurn', {
  name: '翻页', tags: ['editorial', 'calm', 'emotional'], w: 1, dur: 0.46, ae: 'wipe',
  plan: rng => ({ dir: rng.chance(0.5) ? 1 : -1, curl: rng.range(0.05, 0.13) }),
  draw(ctx, A, B, p, I, P) {
    const { cw, ch } = I, e = E.inOutCubic(p), dir = P.dir >= 0 ? 1 : -1;
    const fold = cw * e;
    ctx.save();
    if (dir < 0) { ctx.translate(cw, 0); ctx.scale(-1, 1); }          // mirrored page turn
    ctx.drawImage(B, 0, 0);                                          // the page underneath
    ctx.save();
    ctx.beginPath(); ctx.rect(fold, 0, cw - fold + 1, ch); ctx.clip();
    ctx.drawImage(A, 0, 0);                                          // what is still lying flat
    ctx.restore();
    // shadow cast onto the page underneath + the folded edge itself
    const sw = cw * (P.curl || 0.09);
    const g = ctx.createLinearGradient(fold, 0, fold + sw, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.42)'); g.addColorStop(0.45, 'rgba(0,0,0,0.13)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(fold, 0, sw, ch);
    const g2 = ctx.createLinearGradient(fold - sw * 0.5, 0, fold, 0);
    g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(1, 'rgba(255,255,255,0.16)');
    ctx.fillStyle = g2; ctx.fillRect(fold - sw * 0.5, 0, sw * 0.5, ch);
    ctx.restore();
  },
});

/* 网点溶解：印厂式的半调网点一格一格吃掉旧画面 */
trReg('mxDotDissolve', {
  name: '网点溶解', tags: ['graphic', 'editorial', 'pop'], w: 0.95, dur: 0.5, ae: 'block',
  plan: rng => ({ cols: rng.int(16, 26), jit: rng.range(0.2, 0.45), sweep: rng.range(0.35, 0.7) }),
  draw(ctx, A, B, p, I, P) {
    const { cw, ch } = I, cols = P.cols || 20, cell = cw / cols, rows = Math.ceil(ch / cell) + 1;
    const seed = (I.seed | 0) || 5, jit = P.jit ?? 0.3, sweep = P.sweep ?? 0.5;
    ctx.drawImage(A, 0, 0);
    ctx.save();
    ctx.beginPath();
    const h = cell * 0.5;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const th = J.clamp((x / cols) * sweep + J.r(seed, x, y, 9) * jit, 0, 0.97);
      const q = clamp((p - th) / (1 - th));
      if (q <= 0) continue;
      const r = cell * 0.72 * E.outCubic(q) * 1.42 + 0.6;
      const cx = x * cell + h, cy = y * cell + h;
      ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, TAU);
    }
    ctx.clip();
    ctx.drawImage(B, 0, 0);
    ctx.restore();
  },
});

/* 尺线：一条带刻度的尺子扫过去，新画面在被量过的地方出现 */
trReg('mxRulerWipe', {
  name: '尺线', tags: ['editorial', 'graphic', 'calm'], w: 0.85, dur: 0.44, ae: 'wipe',
  plan: rng => ({ from: rng.chance(0.72) ? 'left' : 'right' }),
  draw(ctx, A, B, p, I, P) {
    const { cw, ch } = I, e = E.inOutCubic(p), rev = P.from === 'right';
    const x = (rev ? 1 - e : e) * cw;
    ctx.drawImage(A, 0, 0);
    ctx.save();
    ctx.beginPath();
    if (rev) ctx.rect(x, 0, cw - x + 1, ch); else ctx.rect(-1, 0, x + 1, ch);
    ctx.clip(); ctx.drawImage(B, 0, 0); ctx.restore();
    const lw = Math.max(1, ch * 0.0022), sg = rev ? 1 : -1;
    ctx.save();
    ctx.globalAlpha = 1 - J.smooth(0.82, 1, p);
    ctx.strokeStyle = (I.sc && I.sc.fg) || '#FFFFFF'; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke();
    const n = Math.max(10, Math.round(28));
    for (let i = 0; i <= n; i++) {
      const y = (i / n) * ch, L = (i % 5 ? 0.014 : 0.032) * ch;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + sg * L, y); ctx.stroke();
    }
    ctx.restore();
  },
});

/* 甩叠：一个甩镜，新画面带着两三道拖影冲进来 */
trReg('mxWhipStack', {
  name: '甩叠', tags: ['pop', 'glitch', 'kinetic'], w: 0.95, dur: 0.3, ae: 'chroma',
  plan: rng => ({ dir: rng.chance(0.5) ? 1 : -1, n: rng.int(2, 3) }),
  draw(ctx, A, B, p, I, P) {
    const { cw, ch } = I, dir = P.dir >= 0 ? 1 : -1, n = P.n || 3;
    ctx.fillStyle = (I.sc && I.sc.bg) || '#000000'; ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(A, -dir * E.inExpo(p) * cw * 1.04, 0);
    const xb = dir * (1 - E.outExpo(clamp(p * 1.12))) * cw * 1.04;
    for (let k = n; k >= 1; k--) {
      ctx.save();
      ctx.globalAlpha = 0.2 * (1 - k / (n + 1)) * (1 - p);
      ctx.drawImage(B, xb + dir * k * cw * 0.075, 0);
      ctx.restore();
    }
    ctx.drawImage(B, xb, 0);
  },
});

/* ══════════════════ 配色 ══════════════════ */

function cloneStyle(from, key, name, desc, moods, cols) {
  const base = J.STYLES[from];
  if (!base) return;
  const st = JSON.parse(JSON.stringify(base));
  st.name = name; st.desc = desc; st.moods = moods;
  st.schemes = st.schemes.map((s, i) => Object.assign({}, s, cols[i % cols.length]));
  st.extra = false; st.set = null;
  if (!J.STYLES[key]) J.STYLE_ORDER.push(key);
  J.STYLES[key] = st;
}

cloneStyle('paper', 'mxMorning', '晨白', '米白底、墨黑字、一眼朱红的清晨感', ['calm', 'emotional', 'editorial'], [
  { bg: '#F4F1EA', fg: '#1C1B18', accent: '#D9482B', accent2: '#2B6E7E', ink: '#FFFFFF', dim: '#DED8CC', ghostA: '#E05A3A', ghostB: '#2E7F92' },
  { bg: '#FBF9F4', fg: '#23211C', accent: '#C93F22', accent2: '#3C7A88', ink: '#E8E4DA', dim: '#E6E0D4', ghostA: '#D9553A', ghostB: '#357F92' },
]);

cloneStyle('noir', 'mxNeonNight', '霓虹夜', '近黑底，青与洋红两盏灯互相打', ['pop', 'glitch', 'emotional'], [
  { bg: '#070A14', fg: '#EAF6FF', accent: '#38E8FF', accent2: '#FF3BA7', ink: '#101725', dim: '#1A2438', ghostA: '#FF2E88', ghostB: '#2EE6FF' },
  { bg: '#0A0716', fg: '#F4ECFF', accent: '#B84DFF', accent2: '#33F0C0', ink: '#170E28', dim: '#201636', ghostA: '#7A3BFF', ghostB: '#23F0C8' },
]);

cloneStyle('paper', 'mxXuan', '宣纸', '泛黄的纸、宿墨与印泥，适合慢歌', ['emotional', 'calm', 'editorial'], [
  { bg: '#EDE6D6', fg: '#17150F', accent: '#A6321E', accent2: '#3D4A3A', ink: '#FBF7EC', dim: '#DCD3BF', ghostA: '#B33A22', ghostB: '#4A5A44' },
  { bg: '#E6DDC9', fg: '#14120D', accent: '#8E2A18', accent2: '#33413A', ink: '#F7F1E3', dim: '#D3C9B3', ghostA: '#9E3220', ghostB: '#3F4F45' },
]);

cloneStyle('mint', 'mxSoda', '糖水', '奶油粉底配薄荷绿，甜但不腻', ['pop', 'calm'], [
  { bg: '#FFF3EF', fg: '#2A2030', accent: '#FF5E8A', accent2: '#3EC6B0', ink: '#FFFFFF', dim: '#F0DED8', ghostA: '#FF7FA3', ghostB: '#56D7C2' },
  { bg: '#F2FBF8', fg: '#22303A', accent: '#2FBFA8', accent2: '#FF7096', ink: '#FFFFFF', dim: '#DCEFEA', ghostA: '#3FD0BA', ghostB: '#FF88A8' },
]);

/* ══════════════════ 登记为一个独立开关 ══════════════════
   11q_sets.js 先于本文件加载，那时还没有 more 包，所以这里补登记：
   随机编排只在 project.more !== false 时使用这些条目（界面的「本作新增」开关） */
J.SETS.more = { on: true };
if (!J.SET_ORDER.includes('more')) J.SET_ORDER.push('more');
for (const g of J.GROUP_KEYS) for (const k of J.order(g)) {
  const d = J.registry(g)[k];
  if (d && d.pack === PK) { d.set = 'more'; d.extra = false; }
}
})();
