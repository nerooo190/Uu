// Reads the layout and images the port needs from a Visual Pinball X table.
// JavaScript twin of tools/vpx_extract.py (same output shape as data/table.json).
import { CFB } from './cfb.js';

const TYPES = ('Wall Flipper Timer Plunger TextBox Bumper Trigger Light Kicker Decal Gate '
  + 'Spinner Ramp Table LightCenter DragPoint Collection DispReel LightSeq '
  + 'Primitive Flasher Rubber HitTarget').split(' ');
const STRING_TAGS = new Set(['MATR', 'IMAG', 'SURF', 'SIMA', 'TOMA', 'SLMA']);
const KEEP = new Set(['Wall', 'Ramp', 'Flipper', 'Bumper', 'Kicker', 'HitTarget', 'Trigger', 'Gate',
  'Spinner', 'Plunger', 'Light', 'Rubber']);
const IMAGE_MAGIC = [
  [[0x52, 0x49, 0x46, 0x46], 'webp', 'image/webp'], [[0x89, 0x50, 0x4e, 0x47], 'png', 'image/png'],
  [[0xff, 0xd8, 0xff], 'jpg', 'image/jpeg'],
];

const latin1 = (b) => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; };
const r = (x, n) => { const k = 10 ** n; return Math.round(x * k) / k; };

function indexOf(hay, needle, from = 0) {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
const tagBytes = (s) => [...s].map((c) => c.charCodeAt(0));

function parseItem(d) {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  let p = 4;
  const props = {}, pts = [];
  let cur = null;
  while (p + 8 <= d.length) {
    const ln = dv.getUint32(p, true);
    const tag = latin1(d.subarray(p + 4, p + 8));
    const v = d.subarray(p + 8, p + 4 + ln);
    p += 4 + ln;
    if (tag === 'DPNT') { cur = {}; continue; }
    if (tag === 'ENDB') {
      if (cur !== null) { pts.push(cur); cur = null; continue; }
      break;
    }
    const tgt = cur === null ? props : cur;
    const vv = new DataView(v.buffer, v.byteOffset, v.byteLength);
    if (tag === 'NAME') tgt[tag] = new TextDecoder('utf-16le').decode(v.subarray(4));
    else if (STRING_TAGS.has(tag) && v.length > 4) tgt[tag] = latin1(v.subarray(4));
    else if (v.length === 4) tgt[tag] = [r(vv.getFloat32(0, true), 4), vv.getInt32(0, true)];
    else if (v.length === 8) tgt[tag] = [r(vv.getFloat32(0, true), 3), r(vv.getFloat32(4, true), 3)];
    else if (v.length === 16 && (tag === 'VPOS' || tag === 'VSIZ')) {
      tgt[tag] = [0, 4, 8, 12].map((o) => r(vv.getFloat32(o, true), 3));
    }
  }
  return { props, pts };
}

function readName(d) {
  const i = indexOf(d, tagBytes('NAME'));
  const n = new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(i + 4, true);
  return latin1(d.subarray(i + 8, i + 8 + n));
}

// bytes: the .vpx file. Returns { table, images } where table matches data/table.json
// and images maps an image name to { bytes, mime }.
export function parseVpx(bytes, wantedImages = ['pf', 'upperpf', 'pf-metals', 'plastics']) {
  const cfb = new CFB(bytes);
  const gd = cfb.read('GameStg/GameData');
  if (!gd) throw new Error('This does not look like a VPX table (GameData missing)');
  const gv = new DataView(gd.buffer, gd.byteOffset, gd.byteLength);
  const gfloat = (tag) => gv.getFloat32(indexOf(gd, tagBytes(tag)) + 4, true);
  const table = { left: gfloat('LEFT'), top: gfloat('TOPX'), right: gfloat('RGHT'), bottom: gfloat('BOTM'), items: [] };

  for (let k = 0; k < 4096; k++) {
    const d = cfb.read(`GameStg/GameItem${k}`);
    if (!d) break;
    const t = new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(0, true);
    if (t >= TYPES.length || !KEEP.has(TYPES[t])) continue;
    const { props, pts } = parseItem(d);
    table.items.push({ type: TYPES[t], name: props.NAME || '', p: props, pts });
  }

  const images = {};
  const want = new Set(wantedImages);
  for (let k = 0; k < 4096 && want.size; k++) {
    const d = cfb.read(`GameStg/Image${k}`);
    if (!d) break;
    const name = readName(d);
    if (!want.has(name)) continue;
    const body = d.subarray(indexOf(d, tagBytes('JPEG')) + 4);
    for (const [magic, ext, mime] of IMAGE_MAGIC) {
      const m = indexOf(body, magic);
      if (m >= 0) { images[name] = { bytes: body.subarray(m), ext, mime }; want.delete(name); break; }
    }
  }
  return { table, images };
}
