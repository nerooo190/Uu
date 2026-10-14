// The browser-side VPX reader must produce the same table.json as tools/vpx_extract.py.
// Usage: node web/tests/vpx.mjs [path/to/table.vpx]   (default: the file used to create web/data)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';
import { parseVpx } from '../js/vpx/vpx.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const vpx = process.argv[2];
const ref = path.join(here, '..', 'data', 'table.json');
if (!vpx || !fs.existsSync(vpx) || !fs.existsSync(ref)) { console.log('skipped: pass a .vpx path and generate web/data first'); process.exit(0); }

const t0 = Date.now();
const { table, images } = parseVpx(fs.readFileSync(vpx));
const want = JSON.parse(fs.readFileSync(ref));
assert.equal(table.items.length, want.items.length, 'item count');
for (const k of ['left', 'top', 'right', 'bottom']) assert.equal(table[k], want[k], k);

const close = (a, b, where) => {
  if (Array.isArray(a)) { assert.ok(Array.isArray(b) && a.length === b.length, where); a.forEach((x, i) => close(x, b[i], where + '[' + i + ']')); }
  else if (typeof a === 'number') assert.ok(Math.abs(a - b) <= 1.5e-3, `${where}: ${a} vs ${b}`);
  else if (a && typeof a === 'object') { assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), where + ' keys'); for (const k of Object.keys(a)) close(a[k], b[k], where + '.' + k); }
  else assert.equal(a, b, where);
};
table.items.forEach((it, i) => close(it, want.items[i], `item ${i} ${want.items[i].name}`));
for (const name of ['pf', 'upperpf', 'pf-metals', 'plastics']) {
  const f = path.join(here, '..', 'assets', name.replace(/[^A-Za-z0-9_-]/g, '_') + '.' + (images[name]?.ext || 'webp'));
  assert.ok(images[name], 'missing image ' + name);
  if (fs.existsSync(f)) assert.ok(Buffer.from(images[name].bytes).equals(fs.readFileSync(f)), 'image bytes differ: ' + name);
}
console.log(`vpx parity OK: ${table.items.length} items, ${Object.keys(images).length} images, ${Date.now() - t0} ms`);
