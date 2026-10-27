/* ============================================================
   字面工房 — 极简 ZIP（只存储、不压缩）

   工程包要能"一个文件给出去、双击能解开"，所以自己写一个最小的 zip：
   只用 store（不压缩），Windows / macOS 自带解压都能打开。
   ============================================================ */
(() => {
'use strict';

let TBL = null;
function crcTable() {
  if (TBL) return TBL;
  TBL = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    TBL[n] = c >>> 0;
  }
  return TBL;
}
function crc32(u8) {
  const t = crcTable();
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = t[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* files: [{ name, data:Uint8Array }] → Uint8Array（整个 zip） */
function zip(files) {
  const enc = new TextEncoder();
  const now = new Date();
  const time = ((now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)) & 0xFFFF;
  const date = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;
  const parts = [], central = [];
  let off = 0, csize = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
    const crc = crc32(data);

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034B50, true);
    lh.setUint16(4, 20, true);           // version
    lh.setUint16(6, 0x0800, true);       // UTF-8 文件名
    lh.setUint16(8, 0, true);            // store
    lh.setUint16(10, time, true); lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014B50, true);
    ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true); ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), name);

    off += 30 + name.length + data.length;
    csize += 46 + name.length;
  }
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054B50, true);
  eocd.setUint16(8, files.length, true); eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, csize, true); eocd.setUint32(16, off, true);
  const head = new Uint8Array(eocd.buffer);

  let total = 0;
  for (const p of parts) total += p.length;
  for (const p of central) total += p.length;
  total += head.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const x of parts) { out.set(x, p); p += x.length; }
  for (const x of central) { out.set(x, p); p += x.length; }
  out.set(head, p);
  return out;
}

/* dataURL → Uint8Array */
function dataURLBytes(url) {
  const i = String(url || '').indexOf(',');
  if (i < 0) return new Uint8Array(0);
  const bin = atob(url.slice(i + 1));
  const u8 = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
  return u8;
}

/* 读 zip（只认自己写的 store 格式；EOCD → 中央目录 → 本地头） */
function unzip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  const min = Math.max(0, u8.length - 65558);
  for (let i = u8.length - 22; i >= min; i--) {
    if (dv.getUint32(i, true) === 0x06054B50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是 zip 文件');
  const n = dv.getUint16(eocd + 10, true), cdOff = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder('utf-8');
  const out = {};
  let p = cdOff;
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014B50) break;
    const method = dv.getUint16(p + 10, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const usize = dv.getUint32(p + 24, true), lho = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    const lnl = dv.getUint16(lho + 26, true), lel = dv.getUint16(lho + 28, true);
    const start = lho + 30 + lnl + lel;
    if (method === 0) out[name] = u8.subarray(start, start + usize);
    p += 46 + nl + el + cl;
  }
  return out;
}
function bytesB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
window.ZIP = { zip, unzip, bytesB64, dataURLBytes, crc32 };
})();
