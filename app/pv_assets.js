/* PV专区 — vector assets (SVG data URLs). No external image files. */
window.PV_ASSETS = (() => {
  const enc = s => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 1000" width="600" height="1000">`;
  const hair = [
    // 0 short ink bob
    'M176 300 C170 180 230 118 306 120 C396 122 448 196 432 306 C420 388 392 410 380 350 C368 290 350 258 310 250 C260 240 226 282 218 350 C210 410 184 386 176 300Z',
    // 1 red swept spikes
    'M170 298 C160 196 210 120 300 116 C400 112 456 190 438 296 C430 340 412 320 404 270 C390 194 358 178 320 184 C276 190 244 224 228 286 C216 332 196 344 188 336 C180 330 172 316 170 298Z M236 170 L286 120 L314 178Z',
    // 2 long navy hair
    'M166 320 C160 186 220 112 306 112 C404 112 454 192 438 326 C430 400 442 510 412 570 C392 612 376 526 380 430 C384 350 356 294 310 286 C260 278 224 320 220 410 C216 520 198 608 178 570 C154 522 172 410 166 320Z',
    // 3 black short, angular
    'M174 300 C170 182 222 114 310 116 C398 118 448 190 434 300 C428 350 404 338 396 292 C386 228 360 202 318 202 C268 202 238 238 226 304 C216 358 190 362 182 338 C178 326 176 314 174 300Z',
    // 4 blue long fringe
    'M164 310 C160 176 224 108 310 108 C402 108 452 190 438 310 C430 380 438 480 420 550 C404 610 380 540 384 438 C388 350 360 300 310 292 C258 284 226 326 220 410 C214 500 198 580 180 548 C160 512 168 410 164 310Z M220 220 C260 160 350 150 392 210 C350 185 282 185 238 232Z',
    // 5 black curly
    'M172 306 C164 182 224 112 306 112 C400 112 448 186 436 306 C430 356 412 352 406 310 C400 270 382 248 350 242 C340 238 328 248 318 242 C296 230 274 238 260 252 C240 272 232 300 226 330 C216 380 196 370 188 356 C180 342 176 324 172 306Z',
    // 6 blond side part
    'M170 302 C164 184 220 112 306 112 C396 112 452 184 438 304 C430 362 410 340 402 304 C390 250 360 218 316 214 C272 210 244 242 232 300 C222 350 198 366 188 344 C180 330 174 318 170 302Z M318 130 L380 176 L330 198Z',
  ];
  const coat = ['#3A3E56', '#262A38', '#334B78', '#15161C', '#5A6378', '#222536', '#6A513B'];
  const shirt = ['#8D3340', '#2C3D6B', '#A7C0DA', '#C9CFDA', '#1E2433', '#9FB6D8', '#E6D7C5'];
  const skin = '#AEB9DD';
  const portrait = i => {
    const h = hair[i % hair.length], co = coat[i % coat.length], sh = shirt[i % shirt.length];
    const rose = i % 3 === 0 ? `<g transform="translate(402 560) scale(.42)"><path d="M0 0 C-60 10 -76 76 -22 96 C-70 120 -48 176 4 160 C58 176 82 112 34 92 C84 70 58 4 8 20Z" fill="#D9AE62" stroke="#FFF" stroke-width="8"/><circle cx="4" cy="84" r="24" fill="#8E5B30"/></g>` : '';
    return enc(`${head}<defs><linearGradient id="s${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sh}"/><stop offset="1" stop-color="#121522"/></linearGradient></defs>
      <g stroke="#FFFFFF" stroke-width="11" stroke-linejoin="round">
        <path d="M118 1000 C104 800 142 606 220 548 C252 526 348 526 380 548 C460 610 496 804 482 1000Z" fill="${co}"/>
        <path d="M244 536 L356 536 L372 640 L228 640Z" fill="${skin}"/>
        <path d="M216 572 L286 700 L300 676 L314 700 L384 572 L346 544 L300 614 L254 544Z" fill="url(#s${i})"/>
        <ellipse cx="300" cy="352" rx="126" ry="158" fill="${skin}"/>
        <path d="${h}" fill="${i % 2 ? '#8D2F38' : i % 3 === 0 ? '#171923' : '#2A355E'}"/>
        ${rose}
      </g>
      <path d="M120 1000 C104 800 142 606 220 548" fill="none" stroke="#FFFFFF" stroke-width="4" opacity=".55"/>
    </svg>`);
  };
  const rose = enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 460" width="300" height="460">
    <g stroke="#FFF" stroke-width="7" stroke-linejoin="round">
      <path d="M150 180 C146 280 146 360 142 450" fill="none" stroke="#5E6B3E" stroke-width="12"/>
      <path d="M148 300 C110 276 82 282 60 312 C96 326 126 318 148 300Z" fill="#6E7D4B"/>
      <path d="M150 342 C190 312 218 320 240 350 C204 368 176 360 150 342Z" fill="#6E7D4B"/>
      <path d="M150 190 C92 184 58 132 92 92 C120 58 180 64 204 104 C238 146 198 190 150 190Z" fill="#B93242"/>
      <path d="M156 178 C112 170 94 132 118 110 C144 86 186 96 198 126 C210 156 190 176 156 178Z" fill="#D9AE62"/>
      <path d="M158 162 C136 156 130 136 144 126 C160 114 184 124 184 140 C184 154 172 162 158 162Z" fill="#8D2F38"/>
    </g></svg>`);
  const sparkle = enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120"><path d="M60 0 L69 49 L120 60 L69 71 L60 120 L51 71 L0 60 L51 49Z" fill="#FFFFFF" stroke="#5C70C4" stroke-width="3"/></svg>`);
  const sprig = enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 260" width="300" height="260"><g fill="none" stroke="#5C70C4" stroke-width="4" stroke-linecap="round"><path d="M20 240 C86 204 138 142 190 28"/><path d="M92 180 C72 150 38 150 18 166 C40 192 70 198 92 180Z"/><path d="M132 126 C158 106 190 116 204 138 C176 154 148 148 132 126Z"/><path d="M166 84 C182 58 212 56 232 72 C214 94 188 100 166 84Z"/><path d="M118 166 C146 164 166 184 168 208 C138 210 120 190 118 166Z"/></g></svg>`);
  const frames = enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300"><g fill="none" stroke="#5C70C4" stroke-width="3"><rect x="8" y="8" width="384" height="284" rx="8"/><rect x="22" y="22" width="356" height="256" rx="4"/><path d="M22 40 H378 M22 260 H378"/></g><g fill="#5C70C4"><circle cx="32" cy="31" r="4"/><circle cx="368" cy="31" r="4"/><circle cx="32" cy="269" r="4"/><circle cx="368" cy="269" r="4"/></g></svg>`);

  const cache = new Map();
  const image = src => {
    if (cache.has(src)) return cache.get(src);
    const im = new Image(); im.decoding = 'async'; im.src = src; cache.set(src, im); return im;
  };
  const portraits = Array.from({ length: 7 }, (_, i) => portrait(i));
  return {
    portrait: i => portraits[i % portraits.length],
    portraits, rose, sparkle, sprig, frames,
    image,
    preload() {
      const all = [...portraits, rose, sparkle, sprig, frames].map(image);
      return Promise.all(all.map(im => im.complete && im.naturalWidth ? 1 : new Promise(r => { im.onload = r; im.onerror = r; })));
    },
  };
})();
