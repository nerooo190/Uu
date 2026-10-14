// Minimal ZIP reader (central directory + deflate) for MAME-style ROM sets.
// Works in browsers and Node (both provide DecompressionStream).

const u16 = (d, o) => d[o] | (d[o + 1] << 8);
const u32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter();
  w.write(bytes); w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

export async function unzip(buf) {
  const d = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let eocd = -1;
  for (let i = d.length - 22; i >= 0; i--) if (u32(d, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  const count = u16(d, eocd + 10);
  let p = u32(d, eocd + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    if (u32(d, p) !== 0x02014b50) throw new Error('bad central directory');
    const method = u16(d, p + 10), csize = u32(d, p + 20), nlen = u16(d, p + 28), elen = u16(d, p + 30), clen = u16(d, p + 32);
    const lho = u32(d, p + 42);
    const name = new TextDecoder().decode(d.subarray(p + 46, p + 46 + nlen));
    const dataStart = lho + 30 + u16(d, lho + 26) + u16(d, lho + 28);
    const raw = d.subarray(dataStart, dataStart + csize);
    files[name.toLowerCase()] = method === 0 ? raw.slice() : await inflateRaw(raw);
    p += 46 + nlen + elen + clen;
  }
  return files;
}

// Picks the files System 7 needs out of a MAME ROM zip (bk_l4 style names).
export function systemSevenRoms(files) {
  const need = ['ic14.716', 'ic17.532', 'ic20.716', 'ic26.716', 'sound12.716', 'speech4.532', 'speech5.532', 'speech6.532', 'speech7.532'];
  const out = {};
  for (const n of need) {
    if (!files[n]) throw new Error('ROM set is missing ' + n);
    out[n.split('.')[0].replace('sound12', 'sound12')] = files[n];
  }
  return out;
}
