// Minimal reader for OLE2 / Compound File Binary containers (what a .vpx is).
// Supports v3/v4 headers, FAT/DIFAT chains and the mini stream. Read-only.

const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export class CFB {
  constructor(bytes) {
    this.d = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.v = new DataView(this.d.buffer, this.d.byteOffset, this.d.byteLength);
    for (let i = 0; i < 8; i++) if (this.d[i] !== MAGIC[i]) throw new Error('not an OLE2 compound file');
    const shift = this.v.getUint16(0x1e, true);
    this.ss = 1 << shift;
    this.mss = 1 << this.v.getUint16(0x20, true);
    this.cutoff = this.v.getUint32(0x38, true);
    this.readFat();
    this.readDirectory();
    this.readMiniFat();
  }

  sector(id) {
    const off = (id + 1) * this.ss;
    if (off + this.ss > this.d.length + this.ss) throw new Error('sector out of range');
    return this.d.subarray(off, Math.min(off + this.ss, this.d.length));
  }

  readFat() {
    const v = this.v;
    const fatIds = [];
    for (let i = 0; i < 109; i++) {
      const id = v.getUint32(0x4c + i * 4, true);
      if (id === FREESECT) break;
      fatIds.push(id);
    }
    let dif = v.getUint32(0x44, true);
    let difCount = v.getUint32(0x48, true);
    const perDif = this.ss / 4 - 1;
    while (difCount-- > 0 && dif !== ENDOFCHAIN && dif !== FREESECT) {
      const s = this.sector(dif);
      const sv = new DataView(s.buffer, s.byteOffset, s.byteLength);
      for (let i = 0; i < perDif; i++) { const id = sv.getUint32(i * 4, true); if (id !== FREESECT) fatIds.push(id); }
      dif = sv.getUint32(perDif * 4, true);
    }
    const perFat = this.ss / 4;
    this.fat = new Uint32Array(fatIds.length * perFat);
    fatIds.forEach((id, n) => {
      const s = this.sector(id);
      const sv = new DataView(s.buffer, s.byteOffset, s.byteLength);
      for (let i = 0; i < perFat; i++) this.fat[n * perFat + i] = sv.getUint32(i * 4, true);
    });
  }

  chain(start, table = this.fat) {
    const out = [];
    let id = start;
    const guard = table.length + 2;
    while (id !== ENDOFCHAIN && id !== FREESECT && out.length < guard) { out.push(id); id = table[id]; }
    return out;
  }

  readChain(start, size) {
    const ids = this.chain(start);
    const out = new Uint8Array(ids.length * this.ss);
    ids.forEach((id, i) => out.set(this.sector(id), i * this.ss));
    return size === undefined ? out : out.subarray(0, size);
  }

  readDirectory() {
    const raw = this.readChain(this.v.getUint32(0x30, true));
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    this.entries = [];
    for (let o = 0; o + 128 <= raw.length; o += 128) {
      const nlen = dv.getUint16(o + 64, true);
      const name = new TextDecoder('utf-16le').decode(raw.subarray(o, o + Math.max(0, nlen - 2)));
      this.entries.push({
        name, type: raw[o + 66],
        left: dv.getUint32(o + 68, true), right: dv.getUint32(o + 72, true), child: dv.getUint32(o + 76, true),
        start: dv.getUint32(o + 116, true), size: dv.getUint32(o + 120, true),
      });
    }
    this.root = this.entries[0];
    this.index = new Map();
  }

  readMiniFat() {
    const first = this.v.getUint32(0x3c, true);
    const raw = first === ENDOFCHAIN ? new Uint8Array(0) : this.readChain(first);
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    this.miniFat = new Uint32Array(raw.length / 4);
    for (let i = 0; i < this.miniFat.length; i++) this.miniFat[i] = dv.getUint32(i * 4, true);
    this.miniStream = null;
  }

  children(entry) {
    const out = [];
    const walk = (id) => {
      if (id === FREESECT || id >= this.entries.length) return;
      const e = this.entries[id];
      walk(e.left); out.push(e); walk(e.right);
    };
    walk(entry.child);
    return out;
  }

  lookup(path) {
    const key = path.toLowerCase();
    if (this.index.has(key)) return this.index.get(key);
    let cur = this.root;
    for (const part of path.split('/')) {
      cur = cur && this.children(cur).find((e) => e.name.toLowerCase() === part.toLowerCase());
      if (!cur) break;
    }
    this.index.set(key, cur || null);
    return cur || null;
  }

  has(path) { const e = this.lookup(path); return !!e && e.type === 2; }

  read(path) {
    const e = this.lookup(path);
    if (!e || e.type !== 2) return null;
    if (e.size >= this.cutoff) return this.readChain(e.start, e.size);
    if (!this.miniStream) this.miniStream = this.readChain(this.root.start, this.root.size);
    const out = new Uint8Array(e.size);
    const ids = this.chain(e.start, this.miniFat);
    for (let i = 0; i < ids.length; i++) {
      const src = this.miniStream.subarray(ids[i] * this.mss, ids[i] * this.mss + this.mss);
      const dst = i * this.mss;
      if (dst >= e.size) break;
      out.set(src.subarray(0, Math.min(src.length, e.size - dst)), dst);
    }
    return out;
  }
}
