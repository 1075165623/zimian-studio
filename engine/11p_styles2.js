/* ============================================================
   TCG-PV工厂 — 追加配色（30 套）
   每套只写「两个渐变端色 + 墨色 + 两个强调色」，其余（sub / dim / 反色版）
   在载入时按对比度算出来，所以三十套彼此不撞色，字也一定看得清。
   ============================================================ */
(() => {
'use strict';

/* [key, 名字, 描述, 亮端, 暗端, 墨色, 强调1, 强调2, kind]
   kind: 'round' 圆体 / 'pop' 黑体 / 'mincho' 明朝 / 'mono' 等宽 */
const P = [
  ['sakuraMilk', '樱花牛乳', '奶油白配樱花粉，甜而不腻', '#FFF6FA', '#FFD3E4', '#40243A', '#FF5C9A', '#3ED2B0', 'round'],
  ['mintSoda', '薄荷汽水', '冰薄荷到气泡蓝，夏日感', '#E8FFF8', '#C2E6FF', '#123A46', '#FF7A59', '#1FA8D8', 'round'],
  ['peachCream', '蜜桃奶油', '杏桃渐层，软乎乎的暖调', '#FFF3E2', '#FFD3C4', '#4A2A18', '#FF6B5A', '#FFB347', 'round'],
  ['lemonSoda', '柠檬苏打', '柠檬黄到青柠，亮点是深绿字', '#FFFCE0', '#E9FFB8', '#2A3A0A', '#FF7A00', '#00A87E', 'pop'],
  ['grapeJelly', '葡萄果冻', '葡萄紫渐变，果冻质感', '#F3E6FF', '#D9C2FF', '#33194D', '#FF4FA8', '#7C4DFF', 'round'],
  ['saltBlue', '海盐蓝', '雾面海盐，冷静的通透感', '#EFF7FF', '#C9DCEC', '#17303F', '#FF6B6B', '#2C7BE5', 'mincho'],
  ['matchaLatte', '抹茶拿铁', '抹茶绿配奶白，日系咖啡店', '#FBFFF2', '#DCECC0', '#26330F', '#C05621', '#5B8C2A', 'mincho'],
  ['caramelPudding', '焦糖布丁', '焦糖橙到奶油，暖色高光', '#FFF6E8', '#F7D3A1', '#3D2410', '#D9480F', '#B7791F', 'round'],
  ['strawberryDaifuku', '草莓大福', '粉白撞一点朱红，和菓子色', '#FFF2F4', '#FFD6DE', '#4A1F2A', '#E03131', '#F06595', 'round'],
  ['limeFizz', '青柠气泡', '青柠黄绿，活泼到跳起来', '#F8FFE6', '#D6FF9E', '#22330A', '#FF4D8D', '#00B8A9', 'pop'],
  ['cloudCotton', '云朵棉花', '白到浅蓝，像天空的棉花糖', '#FFFFFF', '#D8E9FF', '#1B2A44', '#FF7BA9', '#5AA9FF', 'round'],
  ['auroraPurple', '极光紫', '紫到青的极光带', '#EFE6FF', '#BEE9FF', '#231448', '#FF5FD2', '#22D3EE', 'pop'],
  ['coralSunset', '珊瑚日落', '珊瑚橘到暮紫，黄昏海边', '#FFE9DE', '#E6C6F0', '#3A1D2E', '#FF6B35', '#7C3AED', 'mincho'],
  ['deepSea', '深海', '深蓝底荧光字，深海发光生物', '#0A2A3D', '#031018', '#7DF9FF', '#FF6BD6', '#7DF9FF', 'pop'],
  ['yozakura', '夜樱', '深紫夜空下的樱花', '#2A1030', '#120616', '#FFD9EC', '#FF5C9A', '#9B7BFF', 'mincho'],
  ['cyberMint', '电子薄荷', '荧光薄荷配紫，赛博甜心', '#07120F', '#0E2A24', '#A6FFCB', '#FF2E88', '#00FFC6', 'pop'],
  ['neonPeach', '霓虹桃', '桃子霓虹，夜店感的粉橘', '#1A0A12', '#2A0E1A', '#FFD3C4', '#FF6B9A', '#FFC14D', 'pop'],
  ['pixelDusk', '像素黄昏', '黄昏渐变 + 深蓝字，复古游戏', '#FFE1B8', '#C9B6FF', '#241A3A', '#FF8A3D', '#4C6FFF', 'pop'],
  ['roseNoir', '墨黑玫瑰', '近黑底，玫瑰金点缀', '#141014', '#241820', '#F2D9DE', '#E8A0B4', '#8A6B7A', 'mincho'],
  ['creamCoffee', '奶油咖啡', '咖啡奶泡，温柔的美式复古', '#FBF3E8', '#E4CDB4', '#2E2016', '#B45309', '#6F4E37', 'mincho'],
  ['forestMoss', '森林苔', '苔绿与米色，森系', '#F4F7EC', '#C9D8B0', '#22301A', '#C05621', '#4C7A34', 'mincho'],
  ['desertGold', '沙漠金', '沙丘金到砖红', '#FFF6E0', '#F2CFA0', '#3A2610', '#C2410C', '#A16207', 'pop'],
  ['glacierGray', '冰川灰', '冷灰蓝，极简高级', '#F7FAFC', '#D5DEE8', '#1A202C', '#FF5C8A', '#3182CE', 'pop'],
  ['ashSakura', '灰樱', '灰度底 + 一抹樱粉，克制', '#F5F2F4', '#DDD6DC', '#2A2228', '#D6336C', '#7048E8', 'mincho'],
  ['blueberryYogurt', '蓝莓酸奶', '酸奶白配蓝莓紫', '#F6F4FF', '#D6D2FF', '#241B4A', '#FF6B6B', '#5F3DC4', 'round'],
  ['dragonFruit', '火龙果', '玫红撞籽黑，热带感', '#FFECF5', '#FFC2DE', '#3A0B22', '#E8318A', '#0B7285', 'pop'],
  ['vanillaSky', '香草天空', '香草白到晴空蓝', '#FFFDF5', '#CFE8FF', '#1C2B45', '#FF8C42', '#1C7ED6', 'round'],
  ['mintChoco', '薄荷巧克力', '巧克力底 + 薄荷字', '#1B1410', '#2E2118', '#C7F9E4', '#63E6BE', '#D9A066', 'pop'],
  ['lemonTea', '柠檬茶', '茶底柠檬光，暖黄', '#FFFBE6', '#F0DFA8', '#3A2E0B', '#D9480F', '#2F9E44', 'mincho'],
  ['lavenderField', '薰衣草田', '薰衣草紫，安静的花田', '#F6F1FF', '#D9C8F5', '#2B1B4A', '#E64980', '#7048E8', 'mincho'],
];

const FONTS = {
  round: { display: ['round', 'pop', 'gothic_black'], serif: ['mincho_bold'], body: ['round', 'gothic_bold'], mono: ['mono'] },
  pop: { display: ['pop', 'gothic_black', 'dela'], serif: ['mincho_bold'], body: ['gothic_bold'], mono: ['mono'] },
  mincho: { display: ['mincho_black', 'mincho_bold', 'shippori'], serif: ['mincho_light'], body: ['mincho', 'gothic_med'], mono: ['mono'] },
};
const DECOR_SETS = [
  { twinkle: 1.4, sparks: 1.2, shapes: 1, lightLeak: 1, petals: 1.1 },
  { bokeh: 1.4, lightLeak: 1.3, twinkle: 0.9, constellation: 0.8 },
  { heartsStars: 1.5, confetti: 1.2, twinkle: 1.1, shapes: 0.8 },
  { leaders: 1.2, counter: 1, stripes: 0.8, arrows: 0.6 },
  { tapePieces: 1.4, scribbleUnder: 1.1, plusGrid: 0.9, guides: 0.6 },
  { risingParticles: 1.3, waveLine: 1, blobs: 0.8, halftonePatch: 0.7 },
];
/* 新加的「画面框」版式权重：让素材一进来就有很多不同样子 */
const FRAME_BIAS = {
  bigPicture: 1.7, tapePhoto: 1.6, filmStripFrame: 1.5, screenFrame: 1.4, phoneFrame: 1.4,
  comicPanel: 1.5, posterWall: 1.4, doubleFrame: 1.3, circlePortrait: 1.3, windowFrame: 1.3,
  idCard: 1.2, polaroidStack: 1.5, albumFrame: 1.3,
  polaroid: 1.2, letterPaper: 1.2, postcard: 1.1, stampSheet: 0.9, calendar: 0.9, vinyl: 0.9, cassette: 0.8, magazine: 0.8,
};

const darken = (h, t) => J.mix(h, '#0B0B12', t);

for (let i = 0; i < P.length; i++) {
  const [k, name, desc, c1, c2, fg, acc, acc2, kind] = P[i];
  if (J.STYLES[k]) continue;
  const bg = J.mix(c1, c2, 0.5);
  const light = {
    bg, fg, sub: J.mix(fg, bg, 0.42), accent: acc, accent2: acc2, ink: fg,
    dim: J.mix(bg, fg, 0.07), ghostA: acc, ghostB: acc2, bgGrad: [c1, c2],
  };
  // 反色版：同一个色相压暗，字反白——每句之间会自动换，一 subtype 片子就不会一直一个调子
  const d1 = darken(c1, 0.82), d2 = darken(c2, 0.7);
  const dFg = J.contrast('#FFFFFF', J.mix(d1, d2, 0.5)) > 3 ? '#FFFFFF' : J.mix('#FFFFFF', bg, 0.25);
  const dark = {
    bg: J.mix(d1, d2, 0.5), fg: dFg, sub: J.mix(dFg, J.mix(d1, d2, 0.5), 0.45),
    accent: acc, accent2: acc2, ink: dFg, dim: J.mix(J.mix(d1, d2, 0.5), '#FFFFFF', 0.06),
    ghostA: acc, ghostB: acc2, bgGrad: [d1, d2],
  };
  J.STYLES[k] = {
    name, desc, moods: ['pop', 'emotional', 'calm'],
    schemes: i % 4 === 3 ? [light, light, dark] : (i % 3 === 2 ? [light, dark, light] : [light, light, dark]),
    fonts: FONTS[kind],
    texture: { grain: 0.28, paper: 0, scan: 0 }, ghost: 0.34,
    bias: {
      layout: Object.assign({ gloss: 1.5, wave: 1.3, pill: 1.2, huge: 1.1, bubbles: 1.1, center: 1, stickerBomb: 0.4, swissGrid: 0.3, justified: 0.4 }, FRAME_BIAS),
      enter: { pop: 1.7, drop: 1.4, blur: 1.3, spin: 1.1, zoom: 1.1, assemble: 0.5, scramble: 0.3, slice: 0.3 },
      exit: { scatter: 1.4, shrink: 1.3, blur: 1.3, drift: 1.1, explode: 0.6, glitch: 0.3 },
      treat: { softShadow: 1.4, outline: 1.2, glow: 1.1, gradientV: 1.1, halftone: 0.3 },
      bg: { bokehBg: 1.4, gradientSweep: 1.4, particlesBg: 1.3, sunburst: 0.12, splitH: 0.7, tvBars: 0.1, retroGrid: 0.4 },
      cam: { dollyIn: 1.2, driftDiag: 1.1, handheld: 1, bounce: 0.5 },
      fx: { lightSweep: 1.2, filmBurn: 0.6, strobe: 0.4, posterize: 0.2 },
    },
    decor: DECOR_SETS[i % DECOR_SETS.length],
    hud: false, glow: 1 + (i % 5) * 0.12,
  };
  J.STYLE_ORDER.push(k);
}

/* 把新配色紧跟在默认风格后面，风格格子前半屏就都是新的 */
const added = P.map(p => p[0]).filter(k => J.STYLES[k]);
const rest = J.STYLE_ORDER.filter(k => added.indexOf(k) < 0);
const at = rest.indexOf('tcg');
const nextOrder = at >= 0 ? rest.slice(0, at + 1).concat(added, rest.slice(at + 1)) : added.concat(rest);
J.STYLE_ORDER.length = 0;
for (const k of nextOrder) J.STYLE_ORDER.push(k);
})();
