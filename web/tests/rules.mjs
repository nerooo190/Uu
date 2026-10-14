// Scenario test for the game rules: node web/tests/rules.mjs
import assert from 'assert';
import { buildTable } from '../js/build.js';
import { World } from '../js/physics.js';
import { Game } from '../js/game.js';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const here = path.dirname(fileURLToPath(import.meta.url));
const dataFile = path.join(here, '..', 'data', 'table.json');
if (!fs.existsSync(dataFile)) { console.error('web/data/table.json missing - run tools/vpx_extract.py first'); process.exit(2); }
const load = () => JSON.parse(fs.readFileSync(dataFile));
const T = buildTable(load());
const w = new World(T); const g = new Game(w, T, {});
const run = (sec) => { for (let i = 0; i < sec * 60; i++) { w.step(1/60); g.update(1/60); } };
const kick = (role) => T.kickers.find(k => k.role === role);
g.startGame(); run(1);
assert.equal(g.phase, 'play'); assert.equal(w.balls.length, 1); console.log('start ok, ball at', w.balls[0].x|0, w.balls[0].y|0);

// bank LL: three target hits
for (const sw of [25,26,27]) w.events.push({ type: 'target', sw });
run(0.1);
const ll = g.banks.find(b => b.id === 'LL');
assert.equal(ll.done, 1); assert.ok(g.magna.R && !g.magna.L); console.log('bank ok, score', g.score, 'magna', g.magna);
run(1); assert.ok(T.targets.filter(t => [25,26,27].includes(t.sw)).every(t => !t.dropped)); console.log('bank reset ok');

// lock 1 and 2: ball placed in LockMech
const lock = kick('lock');
for (let n = 1; n <= 2; n++) {
  const b = w.addBall(lock.x, lock.y, 80, 0, 0);
  run(0.1);
  assert.equal(g.locked.length, n, 'locked ' + n); console.log('locked', n, 'msg:', g.message, 'balls', w.balls.length);
}
// saucer ball with locks present -> multiball
const sauc = kick('saucer');
w.addBall(sauc.x, sauc.y, 0, 0, 0); run(0.2);
assert.ok(g.locked.length >= 2); run(3);
assert.ok(g.multiball, 'multiball'); console.log('multiball ok, balls in play:', g.inPlay(), 'msg', g.message);

// drain everything -> ball end -> next ball
const drain = kick('drain');
for (const b of [...w.balls]) { if (!b.held) { b.x = drain.x; b.y = drain.y; b.z = 0; b.vx = b.vy = 0; } }
run(0.3);
console.log('after drain: phase', g.phase, 'ball', g.ball, 'msg', g.message);
run(4);
console.log('next:', g.phase, 'ball', g.ball, 'balls', w.balls.length);
assert.equal(g.ball, 2);
// finish the game
for (let k = 0; k < 3; k++) {
  run(0.5);
  for (const b of [...w.balls]) { b.x = drain.x; b.y = drain.y; b.z = 0; b.vx = b.vy = 0; }
  run(5);
}
console.log('end state', g.phase, g.message, 'score', g.score);
assert.equal(g.phase, 'attract');
console.log('rules: OK');
