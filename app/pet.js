/* ============================================================
   字面工房 — 桌面宠物

   右下角的一只小小助理：会自己冒气泡说话，点一下 = 捏（会抗议），
   按住可以拖着走。整个人是内联 SVG 画的（不依赖任何图片文件，
   离线 / 单文件版都能用），眼睛还会跟着鼠标转。

   对外接口： window.PET = { say, pinch, show, hide, reset }
   状态（开关 / 大小 / 安静 / 位置）记在 localStorage。
   ============================================================ */
(() => {
'use strict';

const $ = s => document.querySelector(s);
const KEY = 'studio.pet.v1';
const BASE_W = 138;                 // 100% 时的宽度（px）

const LINES = {
  pinch: ['别捏我！', '你干什么！', '不要碰我！', '哼，我要生气了！', '呜…不许捏脸', '再捏就咬你了哦', '喂！很痒的'],
  idle: ['今天的字幕也要漂漂亮亮的', '这句要不要试试拍立得？', '导出前先完整看一遍哦', '别一直盯着时间线啦', '哼，才不是特意来陪你的',
    '累了就歇一会儿，我在这儿呢', '效果库里「翻页」那个挺好看的', '要不要换一套配色试试？', '左栏的效果库点开看看嘛'],
  drag: ['放我下来…', '我自己会走！', '这里视野不错'],
};

const state = { on: true, size: 100, quiet: false, x: null, y: null };
try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) || '{}') || {}); } catch (e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };

const pick = a => a[Math.floor(Math.random() * a.length)];

/* ───────── 小人 ───────── */
const HAIR = '#3B4A7E', HAIR_D = '#303E6C', SKIN = '#FFE3D0', DRESS = '#2B3358';
const SVG = `
<svg class="pet-svg" viewBox="0 0 220 250" width="220" height="250" style="display:block;width:100%;height:auto" aria-hidden="true">
  <g class="pet-bob">
    <!-- 后发 -->
    <path d="M110 24c38 0 66 26 68 60 1 24-2 44-8 60-4 11-12 18-24 18H74c-12 0-20-7-24-18-6-16-9-36-8-60 2-34 30-60 68-60z" fill="${HAIR}"/>
    <!-- 身体 -->
    <path d="M110 146c-26 0-46 12-52 30l-8 34c-2 9 3 16 12 16h96c9 0 14-7 12-16l-8-34c-6-18-26-30-52-30z" fill="${DRESS}"/>
    <!-- 围裙 -->
    <path d="M110 160c14 0 24 7 27 18l6 30c1 6-3 10-9 10H86c-6 0-10-4-9-10l6-30c3-11 13-18 27-18z" fill="#FAFBFF"/>
    <path d="M110 160c14 0 24 7 27 18" fill="none" stroke="#E7ECF7" stroke-width="2"/>
    <!-- 领结 -->
    <path d="M110 154l-17-9v13l17 5 17-5v-13z" fill="#5B8DEF"/>
    <circle cx="110" cy="155" r="4.6" fill="#7CA6F5"/>
    <!-- 脸 -->
    <ellipse cx="110" cy="100" rx="56" ry="52" fill="${SKIN}"/>
    <!-- 眼睛（会跟着鼠标转） -->
    <g class="pet-eyes">
      <g class="pet-eye">
        <ellipse cx="88" cy="104" rx="12.5" ry="15" fill="#2A3A6B"/>
        <circle cx="84" cy="98" r="4.4" fill="#FFFFFF" opacity=".95"/>
        <circle cx="92" cy="110" r="2.2" fill="#93ACEA" opacity=".85"/>
        <path d="M75.5 92.5q12.5-8 25 0" fill="none" stroke="#2A3A6B" stroke-width="3.2" stroke-linecap="round"/>
      </g>
      <g class="pet-eye">
        <ellipse cx="132" cy="104" rx="12.5" ry="15" fill="#2A3A6B"/>
        <circle cx="128" cy="98" r="4.4" fill="#FFFFFF" opacity=".95"/>
        <circle cx="136" cy="110" r="2.2" fill="#93ACEA" opacity=".85"/>
        <path d="M119.5 92.5q12.5-8 25 0" fill="none" stroke="#2A3A6B" stroke-width="3.2" stroke-linecap="round"/>
      </g>
    </g>
    <!-- 腮红 / 嘴 -->
    <ellipse cx="70" cy="122" rx="10" ry="5.5" fill="#FFAFC5" opacity=".55"/>
    <ellipse cx="150" cy="122" rx="10" ry="5.5" fill="#FFAFC5" opacity=".55"/>
    <path class="pet-mouth" d="M103 127q7 7 14 0" fill="none" stroke="#B4553F" stroke-width="2.4" stroke-linecap="round"/>
    <!-- 刘海 -->
    <path d="M110 44c31 0 55 21 58 48l-10 2-6-16-6 18-8-20-8 20-8-20-8 20-8-18-6 16-10-2c3-27 27-48 58-48z" fill="${HAIR}"/>
    <!-- 侧发 -->
    <path d="M56 86c-7 26-5 49 3 66 3 8 10 6 10-2 0-21 2-39 6-54z" fill="${HAIR_D}"/>
    <path d="M164 86c7 26 5 49-3 66-3 8-10 6-10-2 0-21-2-39-6-54z" fill="${HAIR_D}"/>
    <!-- 呆毛 -->
    <path d="M112 46c1-13 12-19 21-13" fill="none" stroke="${HAIR}" stroke-width="5" stroke-linecap="round"/>
    <!-- 女仆发带 -->
    <path d="M64 72q46-32 92 0" fill="none" stroke="#FFFFFF" stroke-width="11" stroke-linecap="round"/>
    <g fill="#FFFFFF">
      <circle cx="68" cy="72" r="7"/><circle cx="81" cy="63" r="7"/><circle cx="95" cy="57" r="7"/>
      <circle cx="110" cy="55" r="7"/><circle cx="125" cy="57" r="7"/><circle cx="139" cy="63" r="7"/>
      <circle cx="152" cy="72" r="7"/>
    </g>
    <g fill="#DCE6FA">
      <circle cx="81" cy="63" r="2.6"/><circle cx="110" cy="55" r="2.6"/><circle cx="139" cy="63" r="2.6"/>
    </g>
  </g>
</svg>`;

let root = null, bubbleEl = null, bodyEl = null, hideTimer = 0, idleTimer = 0, blinkTimer = 0;
let dragging = false, dragMoved = false, dragOff = { x: 0, y: 0 }, downPt = { x: 0, y: 0 };

function build() {
  if (root) return root;
  root = document.createElement('div');
  root.className = 'pet';
  root.id = 'petRoot';
  // 关键定位写成内联：万一样式表是旧缓存（还没有 .pet 规则），她也照样站在右下角
  root.style.cssText = 'position:fixed;z-index:70;right:14px;bottom:32px;cursor:grab;touch-action:none;user-select:none;';
  root.innerHTML = `<div class="pet-bubble" id="petBubble" aria-live="polite"></div><div class="pet-ink">${SVG}</div>`;
  document.body.appendChild(root);
  bubbleEl = root.querySelector('#petBubble');
  bodyEl = root.querySelector('.pet-ink');

  root.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);

  // 眼睛跟着鼠标
  window.addEventListener('mousemove', e => {
    if (!root || root.hidden) return;
    const r = root.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height * 0.42;
    const dx = J.clamp((e.clientX - cx) / 90, -1, 1), dy = J.clamp((e.clientY - cy) / 90, -1, 1);
    root.querySelectorAll('.pet-eye').forEach(g => {
      g.style.transform = `translate(${(dx * 3.2).toFixed(2)}px, ${(dy * 3).toFixed(2)}px)`;
    });
  }, { passive: true });

  applyAll();
  scheduleIdle();
  scheduleBlink();
  return root;
}

function applyAll() {
  if (!root) return;
  const w = Math.round(BASE_W * state.size / 100);
  root.style.width = w + 'px';
  root.style.setProperty('--pet-w', w + 'px');
  root.hidden = !state.on;
  place();
}

function place() {
  if (!root) return;
  if (state.x == null || state.y == null) {
    root.style.left = '';
    root.style.top = '';
    root.style.right = '14px';
    root.style.bottom = 'calc(var(--bb-h, 26px) + 8px)';
  } else {
    const w = root.offsetWidth || BASE_W, h = root.offsetHeight || 170;
    const x = J.clamp(state.x, 4, Math.max(4, innerWidth - w - 4));
    const y = J.clamp(state.y, 4, Math.max(4, innerHeight - h - 4));
    root.style.left = x + 'px';
    root.style.top = y + 'px';
    root.style.right = 'auto';
    root.style.bottom = 'auto';
  }
}

/* ───────── 说话 ───────── */
function say(text, ms) {
  if (!root || root.hidden) return;
  bubbleEl.textContent = text;
  bubbleEl.classList.remove('on');
  void bubbleEl.offsetWidth;                       // 重启动画
  bubbleEl.classList.add('on');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => bubbleEl.classList.remove('on'), ms || 3600);
  // 气泡跑到屏幕上方了就翻到下面；贴边了就往回挪
  requestAnimationFrame(() => {
    const r = bubbleEl.getBoundingClientRect();
    bubbleEl.classList.toggle('down', r.top < 8);
    let dx = 0;
    if (r.left < 8) dx = 8 - r.left;
    else if (r.right > innerWidth - 8) dx = (innerWidth - 8) - r.right;
    bubbleEl.style.setProperty('--bx', dx.toFixed(1) + 'px');
  });
}

function pinch() {
  if (!root || root.hidden) return;
  root.classList.remove('pinch');
  void root.offsetWidth;
  root.classList.add('pinch');
  setTimeout(() => root.classList.remove('pinch'), 460);
  say(pick(LINES.pinch));
}

function scheduleIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (state.on && !state.quiet && !document.hidden && !root.classList.contains('pinch')) say(pick(LINES.idle));
    scheduleIdle();
  }, 20000 + Math.random() * 22000);
}

function scheduleBlink() {
  clearTimeout(blinkTimer);
  blinkTimer = setTimeout(() => {
    if (root && !root.hidden) root.classList.add('blink');
    setTimeout(() => root && root.classList.remove('blink'), 140);
    setTimeout(() => {
      if (root && !root.hidden) root.classList.add('blink');
      setTimeout(() => root && root.classList.remove('blink'), 120);
    }, 240);
    scheduleBlink();
  }, 2600 + Math.random() * 4200);
}

/* ───────── 拖 / 捏 ───────── */
function onDown(e) {
  if (e.button != null && e.button !== 0) return;
  e.preventDefault();
  const r = root.getBoundingClientRect();
  downPt = { x: e.clientX, y: e.clientY };
  dragOff = { x: e.clientX - r.left, y: e.clientY - r.top };
  dragging = true; dragMoved = false;
  root.classList.add('dragging');
  try { root.setPointerCapture(e.pointerId); } catch (err) {}
}

function onMove(e) {
  if (!dragging || !root) return;
  const dx = e.clientX - downPt.x, dy = e.clientY - downPt.y;
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragMoved = true;
  if (!dragMoved) return;
  state.x = e.clientX - dragOff.x;
  state.y = e.clientY - dragOff.y;
  place();
}

function onUp() {
  if (!dragging) return;
  dragging = false;
  if (root) root.classList.remove('dragging');
  if (dragMoved) {
    save();
    if (Math.random() < 0.35) say(pick(LINES.drag), 2400);
  } else {
    pinch();
  }
}

/* ───────── 面板 ───────── */
function bindPanel() {
  const on = $('#petOn'), size = $('#petSize'), quiet = $('#petQuiet'), sum = $('#sumPet');
  if (!on) return;
  on.checked = !!state.on;
  size.value = state.size;
  quiet.checked = !!state.quiet;
  const syncSum = () => { if (sum) sum.textContent = state.on ? Math.round(state.size) + '%' : '已隐藏'; };
  syncSum();
  on.addEventListener('change', () => { state.on = on.checked; save(); applyAll(); syncSum(); if (state.on) say('我又回来啦', 2200); });
  size.addEventListener('input', () => {
    state.size = +size.value || 100;
    $('#oPetSize').textContent = state.size + '%';
    applyAll(); syncSum(); save();
  });
  quiet.addEventListener('change', () => { state.quiet = quiet.checked; save(); });
  const p = $('#btnPetPinch'); if (p) p.onclick = pinch;
  const h = $('#btnPetHome'); if (h) h.onclick = () => { state.x = null; state.y = null; save(); place(); say('回家啦～', 2000); };
}

window.PET = { say, pinch, show: () => { state.on = true; save(); applyAll(); }, hide: () => { state.on = false; save(); applyAll(); }, reset: () => { state.x = null; state.y = null; save(); place(); } };

function boot() {
  bindPanel();
  build();
  if (state.on) setTimeout(() => say('唔…你来啦。需要我帮忙吗？', 4200), 1400);
  window.addEventListener('resize', () => place());
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})();
