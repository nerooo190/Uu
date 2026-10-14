// Monte-Carlo shots from the flippers: reachability and no-stuck-ball check.
// Monte-Carlo: random shots from several spots; report which features get reached.
import { buildTable } from '../js/build.js';
import { World } from '../js/physics.js';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const here = path.dirname(fileURLToPath(import.meta.url));
const dataFile = path.join(here, '..', 'data', 'table.json');
if (!fs.existsSync(dataFile)) { console.error('web/data/table.json missing - run tools/vpx_extract.py first'); process.exit(2); }
const load = () => JSON.parse(fs.readFileSync(dataFile));
const T = buildTable(load());
console.log('ramps(floor):', T.ramps.map(r => r.name).join(','));
const seeds = [ // [x,y,z,label]
  [300,1560,0,'lowerL'], [560,1560,0,'lowerR'], [520,570,80,'upperL'], [760,580,80,'upperR'] ];
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const stats = {};
const bump = (k) => (stats[k] = (stats[k] || 0) + 1);
let maxZ = 0, stuck = 0, runs = 0;
for (const [sx, sy, sz, label] of seeds) {
  for (let n = 0; n < 150; n++) {
    const w = new World(T);
    const ang = -Math.PI / 2 + (rnd() - 0.5) * 2.2;
    const sp = 1500 + rnd() * 3500;
    const b = w.addBall(sx + (rnd() - 0.5) * 80, sy, sz, Math.cos(ang) * sp, Math.sin(ang) * sp);
    const seen = new Set(); let lastMove = 0, lx = b.x, ly = b.y;
    for (let i = 0; i < 60 * 12; i++) {
      w.step(1 / 60);
      if (i % 30 === 0) {
        if (Math.hypot(b.x - lx, b.y - ly) > 5) lastMove = i; lx = b.x; ly = b.y;
      }
      if (b.z > maxZ) maxZ = b.z;
      if (b.z > 20 && b.z < 70) seen.add('onRamp');
      if (b.z >= 70 && label.startsWith('lower')) seen.add('reachedUpper');
      if (b.z < 10 && label.startsWith('upper')) seen.add('fellToLower');
      for (const e of w.events.splice(0)) seen.add(e.type + (e.name ? ':' + e.name : '') + (e.sw ? ':' + e.sw : '') + (e.kicker ? ':' + e.kicker.name : ''));
      if (b.held && b.held.role === 'drain') break;
    }
    if (!b.held && 60 * 12 - lastMove > 300) stuck++;
    runs++;
    for (const k of seen) bump(label + ' ' + k);
  }
}
if (stuck > 0) { console.log('FAIL: balls came to rest', stuck); process.exitCode = 1; }
console.log('runs', runs, 'maxZ', maxZ.toFixed(1), 'stuck(no move 5s+)', stuck);
for (const k of Object.keys(stats).sort()) console.log(k.padEnd(40), stats[k]);
