// Full-stack test with the real game ROM (needs web/rom/bk_l4.zip and web/data/table.json):
// boots the ROM, inserts a coin, starts a game and lets a simple bot play.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildTable } from '../js/build.js';
import { World } from '../js/physics.js';
import { Cabinet } from '../js/cabinet.js';
import { loadRoms, createMachine, factoryInit } from '../js/s7/romboot.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const zip = path.join(here, '..', 'rom', 'bk_l4.zip');
const data = path.join(here, '..', 'data', 'table.json');
if (!fs.existsSync(zip) || !fs.existsSync(data)) { console.log('skipped: ROM or table data missing'); process.exit(0); }

const T = buildTable(JSON.parse(fs.readFileSync(data)));
const roms = await loadRoms(fs.readFileSync(zip));
const m = createMachine(roms);
for (const _ of factoryInit(m));
const world = new World(T);
const cab = new Cabinet(world, T, m);
const D = { 0x3f:'0',0x06:'1',0x5b:'2',0x4f:'3',0x66:'4',0x6d:'5',0x7d:'6',0x07:'7',0x7f:'8',0x6f:'9' };
const digs = (a, n) => Array.from({ length: n }, (_, i) => (m.segments[a + i] ? (D[m.segments[a + i] & 0x7f] ?? '?') : ' ')).join('');
const score = () => digs(1, 7).trim();
const ballNo = () => digs(8, 1).trim();
const log = (t) => console.log(`t=${(m.frame / 60).toFixed(0).padStart(3)}s ball=${ballNo()} score=${score()} bk=${world.balls.length} trough=${cab.troughCount} lock=${cab.locked.length} ${t || ''}`);

const frame = () => { m.runFrame(); m.sound.takeAudio(); world.step(1 / 60); cab.update(1 / 60); };
let lastScore = '', started = false, plungeAt = -1, pulls = 0, solSeen = new Set();
cab.onSol = (n, on) => { if (on) solSeen.add(n); };
for (let i = 0; i < 20 * 60; i++) frame();            // attract
log('attract');
cab.coin(); for (let i = 0; i < 60; i++) frame();
cab.start(); for (let i = 0; i < 120; i++) frame();
log('after start');
let rnd = 7; const rand = () => (rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
let flipTimer = 0;
for (let f = 0; f < 240 * 60; f++) {
  frame();
  // bot: plunge when the ball rests in the shooter lane
  if (m.getSwitch(45) && !world.plunger.pulling && !world.plunger.firing && plungeAt < 0) { world.pullPlunger(true); plungeAt = f + 40 + Math.floor(rand() * 20); }
  if (plungeAt > 0 && f >= plungeAt) { world.pullPlunger(false); plungeAt = -1; pulls++; }
  if (--flipTimer <= 0) { cab.flipper('L', rand() < 0.5); cab.flipper('R', rand() < 0.5); flipTimer = 6 + Math.floor(rand() * 20); }
  if (f % 1200 === 0) log();
}
log('end');
console.log('plunger shots', pulls, 'solenoids seen', [...solSeen].sort((a, b) => a - b).join(','), 'knocks', cab.knocks);
