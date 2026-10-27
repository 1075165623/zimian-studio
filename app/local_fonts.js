/* ============================================================
   本地字体层 —— 用 Windows 自带的中文字体替换 Google Fonts
   引擎原本按「角色」取字体（gothic_black / mincho / dela …），
   这里把这些角色重新指到本机字体上：
     · 完全离线可用，不会等 Google 的 5 秒超时
     · 中文显示效果反而更接近国内 PV / 歌词视频的观感
   注意：J.FONTS 里的 family 要带引号，LANG_FACES 里的不带（引擎会自己加），
   否则字体名会被拼成 ""黑体"" 而全部退回默认字体。
   ============================================================ */
(() => {
'use strict';

/* 角色 → [本机字体, 字重]。用英文字体名，DirectWrite 同样识别。 */
const LOCAL = {
  gothic_black:  ['SimHei',           400],
  gothic_bold:   ['Microsoft YaHei',  700],
  gothic_med:    ['Microsoft YaHei',  400],
  gothic_light:  ['Microsoft YaHei',  300],
  zenkaku:       ['SimHei',           400],
  sansui:        ['DengXian',         400],
  mincho_black:  ['STZhongsong',      700],
  mincho_bold:   ['STZhongsong',      400],
  mincho:        ['SimSun',           400],
  mincho_light:  ['FangSong',         400],
  tokumin:       ['STZhongsong',      400],
  shippori:      ['STZhongsong',      400],
  dela:          ['STHupo',           400],
  round:         ['YouYuan',          400],
  pop:           ['方正摩登体 简',     400],
  kiwi:          ['YouYuan',          400],
  klee:          ['FZShuTi',          400],
  brush:         ['STXingkai',        400],
  reggae:        ['STXinwei',         400],
  rampart:       ['STCaiyun',         400],
  potta:         ['STLiti',           400],
  dot:           ['方正摩登体 简',     400],
  mono:          ['Consolas',         400],
};

/* 界面里显示的名字 */
const LABEL = {
  gothic_black: '黑体', gothic_bold: '雅黑 粗', gothic_med: '雅黑 中', gothic_light: '雅黑 细',
  zenkaku: '黑体 全角', sansui: '等线',
  mincho_black: '中宋 粗', mincho_bold: '中宋', mincho: '宋体', mincho_light: '仿宋',
  tokumin: '中宋', shippori: '中宋',
  dela: '琥珀', round: '幼圆', pop: '摩登体', kiwi: '幼圆',
  klee: '舒体', brush: '行楷', reggae: '新魏', rampart: '彩云', potta: '隶书',
  dot: '摩登体', mono: '等宽',
};

const SERIF_KEYS = ['mincho_black', 'mincho_bold', 'mincho', 'mincho_light', 'tokumin', 'shippori', 'brush', 'potta'];
const FB_SANS  = '"Microsoft YaHei","SimHei",sans-serif';
const FB_SERIF = '"SimSun","STZhongsong",serif';

/* 1. style 自己的角色表：family 必须带引号 */
for (const [key, [family, weight]] of Object.entries(LOCAL)) {
  const f = J.FONTS[key];
  if (!f) continue;
  Object.assign(f, {
    label: LABEL[key] || family,
    family: '"' + family + '"',
    weight,
    fb: SERIF_KEYS.includes(key) ? FB_SERIF : FB_SANS,
    gf: null,
    local: family,
  });
}

/* 2. 中文语言面：family 不带引号（引擎会包一层），并清掉 gf 以免请求 Google */
const L = J.LANG_FACES && J.LANG_FACES['zh-Hans'];
if (L) {
  const F = (family, weight) => ({ family, weight, gf: null, local: family });
  L.sans = F('Microsoft YaHei', 500);
  L.serif = F('SimSun', 500);
  L.fbSans = FB_SANS;
  L.fbSerif = FB_SERIF;
  for (const key of Object.keys(L.map)) {
    const loc = LOCAL[key];
    if (loc) L.map[key] = F(loc[0], loc[1]);
  }
  // 其他语言面也不要去请求 Google（text 里若混了假名/拉丁，仍用本机字体兜住）
  for (const code of ['ja', 'zh-Hant', 'ko']) {
    const M = J.LANG_FACES[code];
    if (!M) continue;
    M.fbSans = FB_SANS;
    M.fbSerif = FB_SERIF;
    for (const key of Object.keys(M.map || {})) {
      const loc = LOCAL[key];
      if (loc) M.map[key] = { family: loc[0], weight: loc[1], gf: null, local: loc[0] };
    }
  }
}

/* 3. 完全不碰网络：只等本机字体就绪 */
J.ensureFonts = async (text, keys) => {
  if (!document.fonts || !document.fonts.load) return;
  const uniq = [...new Set([...(text || '字')])].join('') || '字';
  const list = (keys && keys.length ? keys : Object.keys(J.FONTS)).filter(k => J.FONTS[k]);
  const faces = list.map(k => (J.faceOf ? J.faceOf(k) : J.FONTS[k])).filter(Boolean);
  const seen = new Set(), jobs = [];
  for (const f of faces) {
    const fam = String(f.family || '').replace(/"/g, '').split(',')[0].trim();
    if (!fam) continue;
    const spec = `${f.weight || 400} 64px "${fam}"`;
    if (seen.has(spec)) continue;
    seen.add(spec);
    jobs.push(document.fonts.load(spec, uniq).catch(() => null));
  }
  await Promise.all(jobs);
  if (document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }
  J.glyphs.clear();
  J.metrics.clear();
};

/* 4. 给界面用：按气质分组的可选字体 */
J.LOCAL_FONT_PICKS = [
  { key: 'gothic_black', name: '黑体',   note: '方正、有分量' },
  { key: 'gothic_bold',  name: '雅黑粗', note: '干净、百搭' },
  { key: 'gothic_light', name: '雅黑细', note: '轻盈、文艺' },
  { key: 'mincho_black', name: '中宋粗', note: '衬线、有底气' },
  { key: 'mincho',       name: '宋体',   note: '古典、书面' },
  { key: 'mincho_light', name: '仿宋',   note: '纤细、手写感' },
  { key: 'dela',         name: '琥珀',   note: '圆胖、综艺' },
  { key: 'round',        name: '幼圆',   note: '可爱、亲和' },
  { key: 'brush',        name: '行楷',   note: '毛笔、情绪' },
  { key: 'reggae',       name: '新魏',   note: '刚硬、碑刻' },
  { key: 'rampart',      name: '彩云',   note: '空心描边' },
  { key: 'potta',        name: '隶书',   note: '古拙、稳' },
  { key: 'klee',         name: '舒体',   note: '随性、手写' },
  { key: 'pop',          name: '摩登体', note: '几何、未来' },
  { key: 'sansui',       name: '等线',   note: '中性、屏幕' },
];
})();
