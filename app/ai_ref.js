/* ============================================================
   AI 版式参考：上传一张参考图 → 调你自己的模型 → 读出骨架 → 套一个相近的版式
   · Key / 接口地址 / 模型名只存在这台电脑的 localStorage，不上传、不进代码
   · 先按 OpenAI 兼容的多模态格式发（image_url + base64）；模型不吃图就自动降级成本地摘要
   ============================================================ */
(() => {
'use strict';
const $ = s => document.querySelector(s);
const LS = 'tcgpv.ai';
const cfg = Object.assign({ base: 'https://api.deepseek.com', model: 'deepseek-flash', key: '' },
  JSON.parse(localStorage.getItem(LS) || '{}'));
// 旧值迁移：之前填的那个名字官方不认，自动换成 deepseek-flash
if (!/^deepseek-(flash|v4-pro|chat|reasoner)/.test(cfg.model || '')) cfg.model = 'deepseek-flash';
const saveCfg = () => localStorage.setItem(LS, JSON.stringify(cfg));

/* 让模型挑的版式（都是「素材能进画面、字不压脸」的那些） */
const PICKS = () => (window.J && J.slotLayouts ? J.slotLayouts() : []).filter(k => !(J.LAYOUTS[k] && J.LAYOUTS[k].needsMaterial) || true);

function css() {
  if ($('#aiCss')) return;
  const s = document.createElement('style');
  s.id = 'aiCss';
  s.textContent = `
  .ai-mask{position:fixed;inset:0;background:rgba(16,20,32,.45);z-index:9998;display:grid;place-items:center}
  .ai-box{width:min(760px,92vw);max-height:88vh;overflow:auto;background:#fff;border-radius:16px;padding:16px 18px;box-shadow:0 24px 60px rgba(0,0,0,.28);font-size:12px;color:#1F2A3C}
  .ai-box h3{margin:0 0 10px;font-size:15px}
  .ai-row{display:flex;gap:8px;align-items:center;margin:6px 0}
  .ai-row label{flex:0 0 64px;color:#6B7280;font-size:11px}
  .ai-row input,.ai-row select{flex:1;height:28px;border:1px solid #E3E7EF;border-radius:8px;padding:0 8px;font-size:12px}
  .ai-drop{border:1.5px dashed #D7CFEA;border-radius:12px;padding:14px;text-align:center;color:#6B5B95;background:#FBF9FF;cursor:pointer}
  .ai-drop img{max-height:180px;border-radius:8px;display:block;margin:8px auto 0}
  .ai-acts{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
  .ai-out{white-space:pre-wrap;background:#F7F8FB;border-radius:10px;padding:10px;margin-top:10px;max-height:200px;overflow:auto;font-size:11px;color:#334155}
  .ai-btn{height:28px;padding:0 14px;border-radius:8px;border:1px solid #E3E7EF;background:#fff;cursor:pointer}
  .ai-btn.p{background:#6D28D9;border-color:#6D28D9;color:#fff}
  `;
  document.head.appendChild(s);
}

function buildPrompt(keys) {
  return [
    '你是文字 PV / 杂志排版的版式分析器。看这张参考图，只输出 JSON，不要解释。',
    '只输出这个 JSON（数值是 0~1 的比例，用不到的字段省略）：',
    '{"bgText":{"size":0.42,"x":0.5,"y":0.5,"angle":0,"alpha":0.8},"subject":{"x":0.04,"y":0.04,"w":0.46,"h":0.92,"fit":"contain","outline":"#7FE3D4"},"rails":[{"x":0.9,"w":0.06,"h":0.88,"squares":7}],"lyric":{"zone":"bottom-left","w":0.4,"size":0.07},"decor":{"rules":true,"dots":true,"verticalText":"TCG-PV","caps":true,"sign":"T.01"},"palette":["#FFF6FA","#FF9FC2"]}',
    '规则：subject 是人物/照片的位置；bgText 是背后的大字；有竖长条就写 rails；字绝不能落在 subject 里。',
    '可选 layout key：' + keys.join(', '),
    '判断标准：图占多大、字在哪一侧、装饰是什么类型、整体明暗。',
    '如果参考图是「人物 + 背后超大号文字 + 侧边竖条/胶囊」这一类，选 refPanel。',
  ].join('\n');
}

/* 模型不吃图时的降级：把图压成 32×32，算主色与明暗分布 */
function thumbStats(img) {
  const c = document.createElement('canvas'); c.width = 32; c.height = 32;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, 32, 32);
  const d = g.getImageData(0, 0, 32, 32).data;
  let r = 0, gg = 0, b = 0, lum = 0, leftL = 0, rightL = 0, cnt = 0;
  for (let i = 0; i < d.length; i += 4) {
    const x = (i / 4) % 32;
    r += d[i]; gg += d[i + 1]; b += d[i + 2];
    const L = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    lum += L; if (x < 16) leftL += L; else rightL += L; cnt++;
  }
  const hex = v => Math.round(v).toString(16).padStart(2, '0');
  return { color: '#' + hex(r / cnt) + hex(gg / cnt) + hex(b / cnt), lum: +(lum / cnt).toFixed(2), left: +(leftL / (cnt / 2)).toFixed(2), right: +(rightL / (cnt / 2)).toFixed(2) };
}

let curImg = null, curData = '';

function modal() {
  css();
  const mask = document.createElement('div');
  mask.className = 'ai-mask';
  mask.innerHTML = `
    <div class="ai-box">
      <h3>AI 版式参考</h3>
      <div class="ai-drop" id="aiDrop">点这里选一张参考图（或把图拖进来）<input type="file" id="aiFile" accept="image/*" hidden></div>
      <div class="ai-row"><label>接口</label><input id="aiBase" value="${cfg.base}" placeholder="https://api.deepseek.com"></div>
      <div class="ai-row"><label>模型</label><input id="aiModel" value="${cfg.model}" list="aiModels" placeholder="deepseek-flash"><datalist id="aiModels"><option value="deepseek-flash"></option><option value="deepseek-v4-pro"></option></datalist></div>
      <div class="ai-row"><label>Key</label><input id="aiKey" type="password" value="${cfg.key}" placeholder="sk-...（只存本机）"></div>
      <div class="ai-out" id="aiOut">选图 → 填好接口/模型/Key → 点「解析」。</div>
      <div class="ai-acts">
        <button class="ai-btn" id="aiClose">关闭</button>
        <button class="ai-btn" id="aiRun">解析</button>
        <button class="ai-btn p" id="aiApply" disabled>套到这一句</button>
      </div>
    </div>`;
  document.body.appendChild(mask);
  const drop = mask.querySelector('#aiDrop'), file = mask.querySelector('#aiFile'), out = mask.querySelector('#aiOut');
  const pick = f => {
    if (!f || !/^image\//.test(f.type)) return;
    const r = new FileReader();
    r.onload = () => { curData = r.result; curImg = new Image(); curImg.onload = () => { drop.innerHTML = '已选：' + f.name + '<img src="' + curData + '">'; drop.appendChild(file); }; curImg.src = curData; };
    r.readAsDataURL(f);
  };
  drop.onclick = () => file.click();
  file.onchange = () => pick(file.files[0]);
  drop.ondragover = e => e.preventDefault();
  drop.ondrop = e => { e.preventDefault(); pick(e.dataTransfer.files[0]); };
  mask.querySelector('#aiClose').onclick = () => mask.remove();
  mask.querySelector('#aiRun').onclick = async () => {
    cfg.base = mask.querySelector('#aiBase').value.trim().replace(/\/+$/, '');
    cfg.model = mask.querySelector('#aiModel').value.trim();
    cfg.key = mask.querySelector('#aiKey').value.trim();
    saveCfg();
    if (!curData) { out.textContent = '先选一张参考图。'; return; }
    if (!cfg.key) { out.textContent = '填一下 Key（只存这台电脑，不会上传到别处）。'; return; }
    out.textContent = '解析中…';
    const keys = PICKS();
    const prompt = buildPrompt(keys);
    const sys = { role: 'system', content: '你是版式分析器，只输出 JSON。' };
    const call = async (content) => {
      const r = await fetch(cfg.base + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key },
        body: JSON.stringify({ model: cfg.model, temperature: 0.2, messages: [sys, { role: 'user', content }] }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
      return j.choices[0].message.content;
    };
    let text = '';
    try {
      text = await call([{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: curData } }]);
    } catch (e) {
      // 降级：不给图，只给本地摘要
      const st = thumbStats(curImg);
      out.textContent = '模型不收图片（' + e.message + '），改用本地摘要重试…';
      try { text = await call(prompt + '\n参考图摘要：主色 ' + st.color + '，亮度 ' + st.lum + '，左半亮度 ' + st.left + '，右半亮度 ' + st.right + '（无法看图，请按亮度判断明暗与左右重心）'); }
      catch (e2) { out.textContent = '调用失败：' + (e2.message || e2); return; }
    }
    let spec = null;
    try { spec = JSON.parse(String(text).replace(/^```json\s*|```$/g, '').trim()); } catch (e) { spec = null; }
    if (!spec) { out.textContent = '模型没返回 JSON，原文：\n' + text; return; }
    out.textContent = JSON.stringify(spec, null, 2);
    const btn = mask.querySelector('#aiApply');
    btn.disabled = false;
    btn.onclick = () => {
      const S = window.STUDIO;
      const line = S.api.targetLine();
      if (line < 0) { out.textContent = '播放头不在歌词行上。'; return; }
      const genKey = 'aiGen' + Date.now().toString(36);
      const S2 = S; const sp = spec;
      J.register('layout', genKey, { name: 'AI 生成', tags: ['pop'], w: 1, slot: true, needsMaterial: true, slots: ['photo'], fits: () => true, plan: () => ({}), render(env) { J.drawSpec(env, sp); return null; } }, 'ai');
      S2.api.setOverride(line, 'layout', genKey);
      out.textContent = '已按参考图给第 ' + (line + 1) + ' 行生成了一版构图。';
      mask.remove();
    };
  };
}

function addButton() {
  const bar = document.querySelector('.topbar .tb-right, .topbar');
  if (!bar || $('#btnAiRef')) return;
  const b = document.createElement('button');
  b.className = 'btn ghost';
  b.id = 'btnAiRef';
  b.textContent = 'AI 参考';
  b.title = '上传一张排版参考图，让模型读出版式并套到当前这一句';
  b.onclick = modal;
  bar.appendChild(b);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addButton);
else addButton();
})();
