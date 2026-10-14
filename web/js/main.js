// Browser entry: loads the extracted table, optionally boots the real game ROM
// (System 7 emulation), runs the fixed-step loop and draws everything.
import { buildTable } from './build.js';
import { World } from './physics.js';
import { Game } from './game.js';
import { Cabinet } from './cabinet.js';
import { sound } from './audio.js';
import { BALL_R, rad } from './geometry.js';
import { loadRoms, createMachine, factoryInit, cmosToString, cmosFromString } from './s7/romboot.js';
import { AudioOut } from './s7/audioout.js';
import { parseVpx } from './vpx/vpx.js';

const $ = (id) => document.getElementById(id);
const canvas = $('c');
const ctx = canvas.getContext('2d');
const lcd = $('lcd').getContext('2d');

const IMAGES = {};
const WANTED = ['pf', 'upperpf', 'pf-metals', 'plastics'];
let T, world, game, cab, machine;
let romMode = false;
let debug = false;
const params = new URLSearchParams(location.search);
const audioOut = new AudioOut();

function loadImage(src) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

// ---- local storage (IndexedDB) for the files the player supplies -------------------------

const idb = () => new Promise((res, rej) => {
  const rq = indexedDB.open('bk-port', 1);
  rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
  rq.onsuccess = () => res(rq.result);
  rq.onerror = () => rej(rq.error);
});
async function kvGet(key) {
  try { const db = await idb(); return await new Promise((res) => { const r = db.transaction('kv').objectStore('kv').get(key); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }); } catch (e) { return null; }
}
async function kvSet(key, val) {
  try { const db = await idb(); await new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(val, key); tx.oncomplete = res; tx.onerror = res; }); } catch (e) { /* ignore */ }
}
const asBytes = (v) => (v ? new Uint8Array(v) : null);

// Developer convenience: data/ and assets/ next to the page (made by tools/vpx_extract.py).
async function localTable() {
  if (params.has('setup')) return null;
  try {
    const r = await fetch('data/table.json');
    if (!r.ok) return null;
    const json = await r.json();
    const imgs = await Promise.all(WANTED.map((n) => loadImage(`assets/${n}.webp`)));
    return { json, imgs };
  } catch (e) { return null; }
}

async function localRom() {
  if (params.has('norom') || params.has('setup')) return null;
  try { const r = await fetch('rom/bk_l4.zip'); if (r.ok && /zip|octet/.test(r.headers.get('content-type') || 'zip')) return new Uint8Array(await r.arrayBuffer()); } catch (e) { /* none */ }
  return null;
}

// Setup screen: the table (.vpx) and the game ROM (.zip) are supplied by the player and
// stay in this browser; nothing is uploaded anywhere.
function setupScreen(have) {
  return new Promise((resolve) => {
    const state = { vpx: have.vpx, rom: have.rom, skipRom: false };
    const box = $('setup');
    $('loading').hidden = true;
    box.hidden = false;
    const refresh = () => {
      $('setupVpx').textContent = state.vpx ? 'Table file: ready' : 'Table file (.vpx): missing';
      $('setupVpx').className = state.vpx ? 'ok' : '';
      $('setupRom').textContent = state.rom ? 'Game ROM: ready' : 'Game ROM (bk_l4.zip): optional';
      $('setupRom').className = state.rom ? 'ok' : '';
      $('setupGo').disabled = !state.vpx;
    };
    const take = async (files) => {
      $('setupErr').textContent = '';
      for (const f of files) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const name = f.name.toLowerCase();
        try {
          if (name.endsWith('.vpx')) { parseVpx(bytes); state.vpx = bytes; }
          else if (name.endsWith('.zip')) { await loadRoms(bytes); state.rom = bytes; }
          else throw new Error('Unknown file type: ' + f.name);
        } catch (e) { $('setupErr').textContent = `${f.name}: ${e.message || e}`; }
      }
      refresh();
    };
    $('setupFile').onchange = (e) => take([...e.target.files]);
    box.ondragover = (e) => e.preventDefault();
    box.ondrop = (e) => { e.preventDefault(); take([...e.dataTransfer.files]); };
    $('setupSkip').onclick = () => { state.skipRom = true; state.rom = null; refresh(); };
    $('setupGo').onclick = () => { box.hidden = true; resolve(state); };
    refresh();
  });
}

// ---- init -------------------------------------------------------------------------------

async function init() {
  let source = await localTable();
  let vpxBytes = null, romBytes = await localRom();
  if (!source) {
    vpxBytes = params.has('setup') ? null : asBytes(await kvGet('vpx'));
    if (!romBytes && !params.has('norom') && !params.has('setup')) romBytes = asBytes(await kvGet('rom'));
    const skipRom = params.has('norom') || !!(await kvGet('skiprom'));
    if (!vpxBytes || (!romBytes && !skipRom)) {
      const st = await setupScreen({ vpx: vpxBytes, rom: romBytes });
      vpxBytes = st.vpx; romBytes = st.rom;
      await kvSet('vpx', vpxBytes.buffer.slice(vpxBytes.byteOffset, vpxBytes.byteOffset + vpxBytes.byteLength));
      if (romBytes) { await kvSet('rom', romBytes.buffer.slice(romBytes.byteOffset, romBytes.byteOffset + romBytes.byteLength)); await kvSet('skiprom', false); }
      else await kvSet('skiprom', true);
    }
    $('loading').hidden = false;
    $('loading').textContent = 'READING TABLE';
    await new Promise((r) => setTimeout(r, 30));
    const parsed = parseVpx(vpxBytes);
    const imgs = await Promise.all(WANTED.map((n) => {
      const im = parsed.images[n];
      return im ? loadImage(URL.createObjectURL(new Blob([im.bytes], { type: im.mime }))) : null;
    }));
    source = { json: parsed.table, imgs };
  }
  WANTED.forEach((n, i) => (IMAGES[n] = source.imgs[i]));
  T = buildTable(source.json);
  world = new World(T);

  const zip = params.has('norom') ? null : romBytes;
  if (zip) {
    try {
      const roms = await loadRoms(zip);
      let saved = null;
      try { const s = localStorage.getItem('bk_cmos'); if (s) saved = cmosFromString(s); } catch (e) { /* ignore */ }
      machine = createMachine(roms, saved);
      if (!saved) await runFactoryInit();
      cab = new Cabinet(world, T, machine);
      cab.sounds = (n) => sound(n); // mechanical noises; the game's own sounds come from the emulated sound board
      romMode = true;
    } catch (e) { console.error(e); romMode = false; }
  }
  if (!romMode) game = new Game(world, T, { sound });
  document.body.classList.toggle('rom', romMode);
  window.__bk = { T, world, game, cab, machine, get romMode() { return romMode; } };
  bindInput();
  resize();
  addEventListener('resize', resize);
  addEventListener('beforeunload', saveCmos);
  setInterval(saveCmos, 5000);
  $('loading').remove();
  if (params.has('debug')) debug = true;
  if (params.has('autostart') && game) game.startGame();
  requestAnimationFrame(frame);
}

function runFactoryInit() {
  return new Promise((resolve) => {
    const gen = factoryInit(machine);
    $('loading').hidden = false;
    $('loading').textContent = 'FIRST START: RUNNING THE GAME\'S SELF TEST';
    const step = () => {
      const t0 = performance.now();
      let r;
      do { r = gen.next(); } while (!r.done && performance.now() - t0 < 12);
      if (r.done) { saveCmos(); resolve(); } else requestAnimationFrame(step);
    };
    step();
  });
}

function saveCmos() {
  if (!machine) return;
  try { localStorage.setItem('bk_cmos', cmosToString(machine.cmos)); } catch (e) { /* ignore */ }
}

function resize() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.max(200, Math.round(r.width * dpr));
  canvas.height = Math.max(400, Math.round(r.height * dpr));
}

// ---- input ------------------------------------------------------------------------------

const KEYS = {
  KeyZ: ['flip', 'L'], ArrowLeft: ['flip', 'L'], ShiftLeft: ['flip', 'L'],
  Slash: ['flip', 'R'], ArrowRight: ['flip', 'R'], ShiftRight: ['flip', 'R'],
  KeyA: ['magna', 'L'], ControlLeft: ['magna', 'L'],
  Quote: ['magna', 'R'], ControlRight: ['magna', 'R'],
  Enter: ['plunger'], Space: ['plunger'], ArrowDown: ['plunger'],
};

function credits() {
  const d = (i) => { const v = machine.segments[i] & 0x7f; return [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f].indexOf(v); };
  const a = d(20), b = d(28);
  return Math.max(0, a) * 10 + Math.max(0, b);
}

function startPressed() {
  if (!romMode) { if (game.phase === 'attract') game.startGame(); return; }
  if (credits() === 0) { cab.coin(); setTimeout(() => cab.start(), 600); } else cab.start();
}

function physicalNudge(dx) {
  for (const b of world.balls) if (!b.held) { b.vx += dx * 220; b.vy -= 90; }
  sound('nudge');
}

function bindInput() {
  const flip = (side, down) => {
    if (!romMode) { game.flipper(side, down); return; }
    cab.flipper(side, down);
    if (cab.flippersLive()) sound(down ? 'flipUp' : 'flipDown');
  };
  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    audioOut.start();
    if (e.code === 'Digit1' || e.code === 'Numpad1') { startPressed(); return; }
    if (e.code === 'Digit5' || e.code === 'KeyC') { if (romMode) cab.coin(); return; }
    if (e.code === 'KeyD') { debug = !debug; return; }
    if (e.code === 'KeyN' && romMode) { machine.special.advance = 1; return; }
    if (e.code === 'KeyQ' || e.code === 'KeyE') {
      const dx = e.code === 'KeyQ' ? -1 : 1;
      if (romMode) { physicalNudge(dx); cab.nudge(); } else game.nudge(dx);
      return;
    }
    const k = KEYS[e.code];
    if (!k) return;
    e.preventDefault();
    if (k[0] === 'flip') flip(k[1], true);
    else if (k[0] === 'magna') { if (romMode) cab.magna(k[1], true); else game.magnaKey(k[1], true); }
    else if (romMode) world.pullPlunger(true); else game.plunger(true);
  });
  addEventListener('keyup', (e) => {
    if (e.code === 'KeyN' && romMode) { machine.special.advance = 0; return; }
    const k = KEYS[e.code];
    if (!k) return;
    if (k[0] === 'flip') flip(k[1], false);
    else if (k[0] === 'magna') { if (romMode) cab.magna(k[1], false); }
    else if (k[0] === 'plunger') { if (romMode) { world.pullPlunger(false); sound('plunger'); } else game.plunger(false); }
  });
  const hold = (id, down, up) => {
    const el = $(id);
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); audioOut.start(); down(); });
    el.addEventListener('pointerup', up);
    el.addEventListener('pointerleave', up);
  };
  hold('tL', () => flip('L', true), () => flip('L', false));
  hold('tR', () => flip('R', true), () => flip('R', false));
  hold('tP', () => {
    const idle = romMode ? credits() === 0 || !machine.ssEn : game.phase === 'attract';
    if (idle && !(romMode && machine.ssEn)) startPressed();
    else if (romMode) world.pullPlunger(true); else game.plunger(true);
  }, () => { if (romMode) world.pullPlunger(false); else game.plunger(false); });
}

// ---- loop -------------------------------------------------------------------------------

let last = 0, acc = 0;
function frame(ts) {
  const dt = Math.min(0.1, last ? (ts - last) / 1000 : 0.016);
  last = ts;
  if (romMode) {
    acc += dt;
    let n = 0;
    while (acc >= 1 / 60 && n < 4) {
      acc -= 1 / 60; n++;
      const samples = machine.runFrame();
      audioOut.push(samples);
      world.step(1 / 60);
      cab.update(1 / 60);
    }
    if (acc > 0.1) acc = 0;
  } else {
    world.step(dt);
    game.update(dt);
  }
  for (const b of T.bumpers) b.lit = Math.max(0, b.lit - dt * 6);
  draw();
  updateHud();
  requestAnimationFrame(frame);
}

// ---- drawing ----------------------------------------------------------------------------

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
  const h = b.z / 80;
  const ox = -h * 6, oy = -h * 10;
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
  const left = [25, 26, 27, 33, 34, 35].includes(t.sw); // blue on the left banks, orange on the right
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

// light the playfield inserts the ROM switches on (lamp number == light name l<N>)
function drawLamps() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const L of T.lights) {
    if (!L.lamp || !cab.lampOn(L.lamp)) continue;
    const r = L.r * 0.55;
    const g = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, r);
    const c = L.color;
    g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0.75)`);
    g.addColorStop(0.5, `rgba(${c[0]},${c[1]},${c[2]},0.28)`);
    g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(L.x, L.y, r, 0, 7); ctx.fill();
  }
  ctx.restore();
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

  if (romMode) {
    // the table is dim until the ROM lights its inserts; GI relay off = darker still
    ctx.fillStyle = `rgba(0,0,0,${cab.gi ? 0.18 : 0.5})`;
    ctx.fillRect(0, 0, T.width, T.height);
    drawLamps();
  }

  drawRamps();
  for (const t of T.targets) if (t.z > 0 || !lower(t.x, t.y)) drawTarget(t);
  for (const k of T.bumpers) drawBumper(k);
  drawPlunger();
  for (const f of T.flippers) drawFlipper(f);
  for (const b of world.balls) if (b.z >= 40) drawBall(b);
  if (debug) drawDebug();
}

// ---- HUD --------------------------------------------------------------------------------

function drawDigit(c, x, y, w, h, mask, on) {
  const t = Math.max(2, w * 0.16);
  const segs = [
    [x + t, y, w - 2 * t, t], [x + w - t, y + t, t, h / 2 - t * 1.5], [x + w - t, y + h / 2 + t * 0.5, t, h / 2 - t * 1.5],
    [x + t, y + h - t, w - 2 * t, t], [x, y + h / 2 + t * 0.5, t, h / 2 - t * 1.5], [x, y + t, t, h / 2 - t * 1.5],
    [x + t, y + h / 2 - t / 2, w - 2 * t, t],
  ];
  segs.forEach((s, i) => { c.fillStyle = mask & (1 << i) ? on : 'rgba(255,120,40,0.07)'; c.fillRect(...s); });
  if (mask & 0x80) { c.fillStyle = on; c.fillRect(x + w + 1, y + h - t, t, t); }
}

function drawLcd() {
  const W = 260, H = 118;
  lcd.clearRect(0, 0, W, H);
  lcd.fillStyle = '#0a0503'; lcd.fillRect(0, 0, W, H);
  const on = '#ff9a3c';
  const dw = 11, dh = 20, gap = 4;
  const row = (start, count, x0, y0) => { for (let i = 0; i < count; i++) drawDigit(lcd, x0 + i * (dw + gap), y0, dw, dh, machine.segments[start + i] || 0, on); };
  // players: P1 (idx 1-7), P2 (9-15), P3 (21-27), P4 (29-35)
  row(1, 7, 4, 10); row(9, 7, 138, 10);
  row(21, 7, 4, 40); row(29, 7, 138, 40);
  lcd.fillStyle = '#8a8394'; lcd.font = '10px ui-monospace, monospace';
  lcd.fillText('P1', 4, 8); lcd.fillText('P2', 138, 8); lcd.fillText('P3', 4, 38); lcd.fillText('P4', 138, 38);
  // ball in play + credits (status digits)
  lcd.fillStyle = '#8a8394'; lcd.fillText('BALL', 4, 72); lcd.fillText('CREDITS', 138, 72);
  drawDigit(lcd, 4, 78, dw, dh, machine.segments[0] || 0, on); drawDigit(lcd, 4 + dw + gap, 78, dw, dh, machine.segments[8] || 0, on);
  drawDigit(lcd, 138, 78, dw, dh, machine.segments[20] || 0, on); drawDigit(lcd, 138 + dw + gap, 78, dw, dh, machine.segments[28] || 0, on);
}

let chipsKey = '';
function updateHud() {
  if (romMode) {
    drawLcd();
    const state = machine.ssEn ? 'GAME ON' : credits() > 0 ? 'PRESS 1 TO START' : 'PRESS 5 FOR A COIN, 1 TO START';
    $('msg').textContent = state;
    const chips = [
      ['GI', cab.gi ? 'on' : ''], ['MAGNA L', machine.getSwitch(10) ? 'on' : ''], ['MAGNA R', machine.getSwitch(9) ? 'on' : ''],
      [`TROUGH ${cab.troughCount}`, ''], [`LOCKED ${cab.locked.length}`, cab.locked.length ? 'on' : ''],
      ['GAME ROM RUNNING', 'done'],
    ];
    const key = JSON.stringify(chips);
    if (key !== chipsKey) { chipsKey = key; $('chips').innerHTML = chips.map(([t, c]) => `<span class="chip ${c}">${t}</span>`).join(''); }
    return;
  }
  $('score').textContent = game.score.toLocaleString('en-US');
  $('ball').textContent = game.phase === 'attract' ? '-' : `${game.ball} / 3`;
  $('high').textContent = game.high.toLocaleString('en-US');
  $('bonus').textContent = `${game.bonus}k x ${game.mult}`;
  $('msg').textContent = game.message;
  const chips = [
    ...game.banks.map((b) => [`${b.id} ${b.hit.size}/3 (${b.done})`, b.hit.size ? 'on' : '']),
    [`MAGNA L`, game.magna.L ? 'on' : ''], [`MAGNA R`, game.magna.R ? 'on' : ''],
    [`MYSTERY`, game.lit.mystery > 0 ? 'on' : ''], [`SPINNER`, game.lit.spinner > 0 ? 'on' : ''],
    [`LOCKS ${game.locked.length}/3`, game.locked.length ? 'on' : ''],
    ['MULTIBALL', game.multiball ? 'done' : ''], [`EXTRA BALL`, game.lit.extraUpper || game.lit.extraLower ? 'on' : ''],
  ];
  const key = JSON.stringify(chips);
  if (key !== chipsKey) { chipsKey = key; $('chips').innerHTML = chips.map(([t, c]) => `<span class="chip ${c}">${t}</span>`).join(''); }
}

init();
