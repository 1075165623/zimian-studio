/* ============================================================
   app/mov_muxer.js
   把一串 PNG 帧封成带透明通道的 QuickTime 影片（.mov）

   · 容器：QuickTime（ftyp 'qt  '）
   · 编码：'png ' 视频采样，逐帧无损，保留 Alpha
   · 结构：ftyp + mdat + moov（mvhd / trak / mdia / minf / stbl）
   · vmhd 的 graphicsmode 用 0x0040（blend），配合 depth=32，
     剪映 / Premiere / AE / ffmpeg 都按「带透明」处理

   用法：J.movFromPNG({ width, height, fps, frames: [Blob 或 Uint8Array, ...] }) → Blob
   （frames 直接放 Blob 最省内存：浏览器会把大 Blob 落到磁盘，不会全塞在 JS 堆里）
   ============================================================ */
(() => {
'use strict';

const TE = new TextEncoder();
const tag = s => TE.encode(s);
/* Uint8Array 用 length，Blob 用 size */
const sizeOf = f => (f && typeof f.size === 'number' ? f.size : f.length);

const u8 = (...a) => new Uint8Array(a);
function u16(n) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n & 0xffff); return b; }
function u32(n) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0); return b; }
const zero = n => new Uint8Array(n);

/* 组装一个 box：4 字节长度 + 4 字节类型 + 内容 */
function box(type, parts) {
  let len = 8;
  for (const p of parts) len += p.length;
  if (len > 0xfffffff0) throw new Error('单个 box 太大（超过 4GB）');
  const out = new Uint8Array(len);
  new DataView(out.buffer).setUint32(0, len);
  out.set(tag(type), 4);
  let o = 8;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
/* full box：多 4 字节 version + flags */
function full(type, version, flags, parts) {
  return box(type, [u8(version, (flags >>> 16) & 255, (flags >>> 8) & 255, flags & 255)].concat(parts));
}
/* 单位矩阵 0x00010000 / 0x00010000 / 0x40000000 */
function matrix() {
  const b = new Uint8Array(36);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, 0x00010000);
  dv.setUint32(16, 0x00010000);
  dv.setUint32(32, 0x40000000);
  return b;
}

J.movFromPNG = ({ width, height, fps = 24, frames, timescale = 600 }) => {
  const n = frames ? frames.length : 0;
  if (!n) throw new Error('没有可写入的帧');
  const w = Math.round(width), h = Math.round(height);
  if (!w || !h) throw new Error('画幅不对');
  // 600 能被 24 / 25 / 30 / 50 / 60 整除，帧长一定是整数
  const delta = Math.max(1, Math.round(timescale / (fps || 24)));
  const duration = delta * n;

  const ftyp = box('ftyp', [tag('qt  '), u32(0x00000200), tag('qt  ')]);

  /* ---- 采样描述：'png ' 视觉采样条目 ---- */
  const sampleEntry = box('png ', [
    zero(6), u16(1),            // reserved / data_reference_index
    u16(0), u16(0), zero(12),   // pre_defined / reserved / pre_defined
    u16(w), u16(h),             // 宽高
    u32(0x00480000), u32(0x00480000),   // 72 dpi
    u32(0),                     // reserved
    u16(1),                     // frame_count
    zero(32),                   // compressorname（长度 0）
    u16(32),                    // depth = 32 → 带 Alpha
    u16(0xffff),                // pre_defined
  ]);

  /* ---- 采样表 ---- */
  const stsd = full('stsd', 0, 0, [u32(1), sampleEntry]);
  const stts = full('stts', 0, 0, [u32(1), u32(n), u32(delta)]);          // 每帧一样长
  const stsc = full('stsc', 0, 0, [u32(1), u32(1), u32(n), u32(1)]);      // 一整个 chunk
  const stszParts = [u32(0), u32(n)];
  for (const f of frames) stszParts.push(u32(sizeOf(f)));
  const stsz = full('stsz', 0, 0, stszParts);
  // 数据紧跟在 ftyp + mdat 头之后
  const mdatDataOffset = ftyp.length + 8;
  const stco = full('stco', 0, 0, [u32(1), u32(mdatDataOffset)]);
  const stbl = box('stbl', [stsd, stts, stsc, stsz, stco]);

  const dref = full('dref', 0, 0, [u32(1), full('url ', 0, 1, [])]);      // 自带数据
  const dinf = box('dinf', [dref]);
  const vmhd = full('vmhd', 0, 1, [u16(0x0040), u16(0), u16(0), u16(0)]); // graphicsmode = blend
  const minf = box('minf', [vmhd, dinf, stbl]);

  const hdlr = full('hdlr', 0, 0, [u32(0), tag('vide'), zero(12), tag('VideoHandler\0')]);
  const mdhd = full('mdhd', 0, 0, [u32(0), u32(0), u32(timescale), u32(duration), u16(0x55c4), u16(0)]);
  const mdia = box('mdia', [mdhd, hdlr, minf]);

  const tkhd = full('tkhd', 0, 3, [
    u32(0), u32(0), u32(1), u32(0), u32(duration), zero(8),
    u16(0), u16(0), u16(0), u16(0),        // layer / alternate_group / volume / reserved
    matrix(), u32(w << 16), u32(h << 16),
  ]);
  const trak = box('trak', [tkhd, mdia]);

  const mvhd = full('mvhd', 0, 0, [
    u32(0), u32(0), u32(timescale), u32(duration),
    u32(0x00010000), u16(0x0100), u16(0), zero(8),
    matrix(), zero(24), u32(2),
  ]);
  const moov = box('moov', [mvhd, trak]);

  /* ---- mdat ---- */
  let payload = 0;
  for (const f of frames) payload += sizeOf(f);
  if (payload + mdatDataOffset + moov.length > 0xffffffff) throw new Error('文件超过 4GB，缩短时长或降低分辨率再导');
  const mdatHead = new Uint8Array(8);
  new DataView(mdatHead.buffer).setUint32(0, payload + 8);
  mdatHead.set(tag('mdat'), 4);

  return new Blob([ftyp, mdatHead, ...frames, moov], { type: 'video/quicktime' });
};
})();
