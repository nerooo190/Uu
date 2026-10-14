// Browser entry: loads the extracted table, runs the fixed-step loop, draws it.
import { buildTable } from './build.js';
import { World } from './physics.js';
import { Game } from './game.js';
import { sound } from './audio.js';
import { BALL_R, rad } from './geometry.js';

const $ = (id) => document.getElementById(id);
const canvas = $('c');
const ctx = canvas.getContext('2d');

const IMAGES = {};
const WANTED = ['pf', 'upperpf', 'pf-metals', 'plastics'];
let T, world, game;
let debug = false;
const DEBUG_PARAM = new URLSearchParams(location.search);

async function loadImage(name) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = `assets/${name}.webp`;
  });
}

async function init() {
  const [json, ...imgs] = await Promise.all([
    fetch('data/table.json').then((r) => r.json()),
    ...WANTED.map(loadImage),
  ]);
  WANTED.forEach((n, i) => (IMAGES[n] = imgs[i]));
  T = buildTable(json);
  world = new World(T);
  game = new Game(world, T, { sound });
  window.__bk = { T, world, game };
  bindInput();
  resize();
  addEventListener('resize', resize);
  $('loading').remove();
  if (DEBUG_PARAM.has('debug')) debug = true;
  if (DEBUG_PARAM.has('autostart')) game.startGame();
  requestAnimationFrame(frame);
}

function resize() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.max(200, Math.round(r.width * dpr));
  canvas.height = Math.max(400, Math.round(r.height * dpr));
}

// ---- input ------------------------------------------------------------------

const KEYS = {
  KeyZ: ['flip', 'L'], ArrowLeft: ['flip', 'L'], ShiftLeft: ['flip', 'L'],
  Slash: ['flip', 'R'], ArrowRight: ['flip', 'R'], ShiftRight: ['flip', 'R'],
  KeyA: ['magna', 'L'], ControlLeft: ['magna', 'L'],
  Quote: ['magna', 'R'], ControlRight: ['magna', 'R'],
  Enter: ['plunger'], Space: ['plunger'], ArrowDown: ['plunger'],
};

function bindInput() {
  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'Digit1' || e.code === 'Numpad1') { if (game.phase === 'attract') game.startGame(); return; }
    if (e.code === 'KeyD') { debug = !debug; return; }
    if (e.code === 'KeyQ') { game.nudge(-1); return; }
    if (e.code === 'KeyE') { game.nudge(1); return; }
    const k = KEYS[e.code];
    if (!k) return;
    e.preventDefault();
    if (k[0] === 'flip') game.flipper(k[1], true);
    else if (k[0] === 'magna') game.magnaKey(k[1], true);
    else game.plunger(true);
  });
  addEventListener('keyup', (e) => {
    const k = KEYS[e.code];
    if (!k) return;
    if (k[0] === 'flip') game.flipper(k[1], false);
    else if (k[0] === 'plunger') game.plunger(false);
  });
  const hold = (id, down, up) => {
    const el = $(id);
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); down(); });
    el.addEventListener('pointerup', up);
    el.addEventListener('pointerleave', up);
  };
  hold('tL', () => game.flipper('L', true), () => game.flipper('L', false));
  hold('tR', () => game.flipper('R', true), () => game.flipper('R', false));
  hold('tP', () => { if (game.phase === 'attract') game.startGame(); else game.plunger(true); }, () => game.plunger(false));
}

// ---- loop -------------------------------------------------------------------

let last = 0;
function frame(ts) {
  const dt = Math.min(0.05, last ? (ts - last) / 1000 : 0.016);
  last = ts;
  world.step(dt);
  game.update(dt);
  for (const b of T.bumpers) b.lit = Math.max(0, b.lit - dt * 6);
  draw();
  updateHud();
  requestAnimationFrame(frame);
}

// ---- drawing ----------------------------------------------------------------

const lowerBlue = '#3b82f6', upperOrange = '#f59e0b';

function polyPath(poly) {
  ctx.beginPath();
  poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

function drawTable(img, alpha = 1) {
  if (img) { ctx.globalAlpha = alpha; ctx.drawImage(img, 0, 0, T.width, T.height); ctx.globalAlpha = 1; }
}

function drawBall(b) {
  if (b.held) return;
  const h = b.z / 80;                 // 0 lower level, 1 upper level
  const ox = -h * 6, oy = -h * 10;    // slight parallax lift for the upper level
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(b.x + 8 + h * 10, b.y + 10 + h * 14, BALL_R, BALL_R * 0.92, 0, 0, 7);
  ctx.fill();
  const g = ctx.createRadialGradient(b.x + ox - 8, b.y + oy - 9, 2, b.x + ox, b.y + oy, BALL_R + 2);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, '#c4c8d0'); g.addColorStop(0.8, '#5a5e68'); g.addColorStop(1, '#23252b');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(b.x + ox, b.y + oy, BALL_R, 0, 7); ctx.fill();
}

function drawTarget(t) {
  ctx.beginPath();
  t.c.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.closePath();
  const left = t.x < T.width / 2 + 40 && t.sw !== 37 && t.sw !== 38 && t.sw !== 39 && t.sw < 31;
  if (t.dropped) { ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fill(); }
  else {
    ctx.fillStyle = left ? '#2a5fc8' : '#d98a14';
    ctx.fill();
    ctx.strokeStyle = '#fff8'; ctx.lineWidth = 2; ctx.stroke();
  }
}

function drawFlipper(f) {
  const phi = rad(f.ang - 90);
  const tx = f.x + Math.cos(phi) * f.len, ty = f.y + Math.sin(phi) * f.len;
  const nx = -Math.sin(phi), ny = Math.cos(phi);
  ctx.beginPath();
  ctx.moveTo(f.x + nx * f.r0, f.y + ny * f.r0);
  ctx.lineTo(tx + nx * f.r1, ty + ny * f.r1);
  ctx.arc(tx, ty, f.r1, phi + Math.PI / 2, phi - Math.PI / 2, true);
  ctx.lineTo(f.x - nx * f.r0, f.y - ny * f.r0);
  ctx.arc(f.x, f.y, f.r0, phi - Math.PI / 2, phi + Math.PI / 2, true);
  ctx.closePath();
  ctx.fillStyle = f.up ? '#fff4d2' : '#e9dfc0';
  ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = '#a3261b'; ctx.stroke();
  ctx.beginPath(); ctx.arc(f.x, f.y, f.r0 * 0.35, 0, 7); ctx.fillStyle = '#6b1a12'; ctx.fill();
}

function drawBumper(k) {
  const g = ctx.createRadialGradient(k.x, k.y, 4, k.x, k.y, k.r);
  const flash = k.lit;
  g.addColorStop(0, flash > 0.2 ? '#fff6b0' : '#f1e3c4');
  g.addColorStop(0.6, flash > 0.2 ? '#ffb43a' : '#b7a98c');
  g.addColorStop(1, '#4b3a22');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(k.x, k.y, k.r, 0, 7); ctx.fill();
  ctx.lineWidth = 5; ctx.strokeStyle = '#2a1d10'; ctx.stroke();
}

function drawRamps() {
  for (const r of T.ramps) {
    const s = r.samples;
    ctx.beginPath();
    s.forEach((q, i) => {
      const x = q.x - q.ty * q.hw, y = q.y + q.tx * q.hw;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    for (let i = s.length - 1; i >= 0; i--) {
      const q = s[i];
      ctx.lineTo(q.x + q.ty * q.hw, q.y - q.tx * q.hw);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(205,210,225,0.07)'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(235,238,250,0.45)'; ctx.stroke();
  }
}

function drawPlunger() {
  const p = world.plunger;
  ctx.fillStyle = '#9aa0ab';
  ctx.fillRect(p.x - 6, p.y, 12, 130);
  ctx.fillStyle = '#d8dbe3';
  ctx.fillRect(p.x - 15, p.y, 30, 10);
}

function drawDebug() {
  ctx.lineWidth = 1.5;
  for (const s of T.segs) {
    ctx.strokeStyle = s.ramp ? '#22d37a' : s.zlo < 40 ? '#3aa0ff' : '#ff4d4d';
    ctx.beginPath(); ctx.moveTo(s.ax, s.ay); ctx.lineTo(s.bx, s.by); ctx.stroke();
  }
  ctx.strokeStyle = '#ffe14a'; polyPath(T.plateau.poly); ctx.stroke();
  ctx.strokeStyle = '#2ff'; ctx.fillStyle = '#2ff'; ctx.font = '18px monospace';
  for (const t of T.triggers) { ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, 7); ctx.stroke(); ctx.fillText(t.name, t.x + t.r, t.y); }
  ctx.strokeStyle = '#f90'; ctx.fillStyle = '#f90';
  for (const k of T.kickers) { ctx.beginPath(); ctx.arc(k.x, k.y, k.r, 0, 7); ctx.stroke(); ctx.fillText(k.name, k.x + k.r, k.y); }
}

function draw() {
  const sc = canvas.width / T.width;
  ctx.setTransform(sc, 0, 0, sc, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, T.width, T.height);
  drawTable(IMAGES.pf);

  const lower = (x, y) => !T.upperAt(x, y);
  for (const t of T.targets) if (t.z === 0 && lower(t.x, t.y)) drawTarget(t);
  for (const b of world.balls) if (b.z < 40) drawBall(b);

  // upper playfield surface (the lower level runs underneath it)
  ctx.save();
  polyPath(T.plateau.poly);
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 10;
  ctx.fillStyle = '#000'; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.clip();
  drawTable(IMAGES.upperpf);
  ctx.restore();

  for (const v of T.visuals) {
    if (v.image !== 'pf-metals' || !IMAGES['pf-metals']) continue;
    ctx.save(); polyPath(v.poly); ctx.clip(); drawTable(IMAGES['pf-metals']); ctx.restore();
  }
  for (const v of T.visuals) {
    if (v.image !== 'plastics' || !IMAGES.plastics || v.z > 100) continue;
    ctx.save(); polyPath(v.poly); ctx.clip(); drawTable(IMAGES.plastics); ctx.restore();
  }

  drawRamps();
  for (const t of T.targets) if (t.z > 0 || !lower(t.x, t.y)) drawTarget(t);
  for (const k of T.bumpers) drawBumper(k);
  drawPlunger();
  for (const f of T.flippers) drawFlipper(f);
  for (const b of world.balls) if (b.z >= 40) drawBall(b);
  if (debug) drawDebug();
}

// ---- HUD --------------------------------------------------------------------

let chipsKey = '';
function updateHud() {
  $('score').textContent = game.score.toLocaleString('en-US');
  $('ball').textContent = game.phase === 'attract' ? '-' : `${game.ball} / 3`;
  $('high').textContent = game.high.toLocaleString('en-US');
  $('bonus').textContent = `${game.bonus}k x ${game.mult}`;
  $('msg').textContent = game.message;
  const chips = [
    ...game.banks.map((b) => [`${b.id} ${b.hit.size}/3 (${b.done})`, b.hit.size ? 'on' : '']),
    [`MAGNA L`, game.magna.L ? 'on' : ''],
    [`MAGNA R`, game.magna.R ? 'on' : ''],
    [`MYSTERY`, game.lit.mystery > 0 ? 'on' : ''],
    [`SPINNER`, game.lit.spinner > 0 ? 'on' : ''],
    [`LOCKS ${game.locked.length}/3`, game.locked.length ? 'on' : ''],
    [game.multiball ? 'MULTIBALL' : 'MULTIBALL', game.multiball ? 'done' : ''],
    [`EXTRA BALL`, game.lit.extraUpper || game.lit.extraLower ? 'on' : ''],
  ];
  const key = JSON.stringify(chips);
  if (key !== chipsKey) {
    chipsKey = key;
    $('chips').innerHTML = chips.map(([t, c]) => `<span class="chip ${c}">${t}</span>`).join('');
  }
}

init();
