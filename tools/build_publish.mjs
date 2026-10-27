/* 字面工房 — 发布打包脚本
   把引擎 + 界面打成两种可以直接给人的东西：
     1) dist/site/                 静态站点（上传到任何静态空间 / GitHub Pages / Netlify…）
     2) dist/TCG-PV工厂.html          单文件版（所有 js/css 内联，双击就能用，方便微信/邮件直接发）
   用法：node tools/build_publish.mjs
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const SITE = path.join(DIST, 'site');

const r = p => fs.readFileSync(p, 'utf8');
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const copyDir = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
};

/* ---------- 1. 静态站点 ---------- */
fs.rmSync(SITE, { recursive: true, force: true });
copyDir(path.join(ROOT, 'app'), path.join(SITE, 'app'));
copyDir(path.join(ROOT, 'engine'), path.join(SITE, 'engine'));
copyDir(path.join(ROOT, 'vendor'), path.join(SITE, 'vendor'));
for (const f of ['index.html', 'LICENSE-JIZURA.txt', '使用说明.md']) fs.copyFileSync(path.join(ROOT, f), path.join(SITE, f));

/* ---------- 2. 单文件版 ---------- */
let html = r(path.join(ROOT, 'index.html'));

// CSS 内联（href 上可能带 ?v= 版本号，取文件时要去掉）
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, href) => {
  const css = r(path.join(ROOT, href.split('?')[0]));
  return '<style>\n' + css + '\n</style>';
});

// JS 内联（保持原来的顺序：全都是老式全局脚本，顺序就是依赖顺序）
let inlined = 0;
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => {
  const js = r(path.join(ROOT, src.split('?')[0])).replace(/<\/script/gi, '<\\/script');
  inlined++;
  return '<script>/* ' + src + ' */\n' + js + '\n</script>';
});

w(path.join(DIST, 'TCG-PV工厂.html'), html);

/* ---------- 3. 报告 ---------- */
const size = p => (fs.statSync(p).size / 1024).toFixed(0) + ' KB';
const count = d => fs.readdirSync(d).length;
console.log('site  →', SITE);
console.log('        engine ' + count(path.join(SITE, 'engine')) + ' 个文件 / app ' + count(path.join(SITE, 'app')) + ' 个文件');
console.log('single→', path.join(DIST, 'TCG-PV工厂.html'), '(内联 ' + inlined + ' 个脚本, ' + size(path.join(DIST, 'TCG-PV工厂.html')) + ')');
