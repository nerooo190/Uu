// 2.5D pinball physics: circle-vs-segment collisions with a z-range per segment,
// ramp surfaces, flippers with angular velocity, kickers, targets and magnets.
// All units are VPX units (1 unit ~ 1/47 inch) and seconds.
import { BALL_R, BALL_H, closestOnSegment, rad } from './geometry.js';

const G_TILT = 1470;     // down-table acceleration of a rolling ball
const G_SLOPE = 12900;   // vertical gravity acting along ramp slopes
const G_FALL = 18150;    // free fall
const MAX_SPEED = 7500;
const SUBSTEP = 1 / 1200;
const FLIP_UP = 38;      // rad/s
const FLIP_DOWN = 22;

export class World {
  constructor(T) {
    this.T = T;
    this.balls = [];
    this.events = [];
    this.time = 0;
    this.magnets = [
      { x: 114.6, y: 1222.8, r: 70, on: false, side: 'L' },
      { x: 746.5, y: 1222.5, r: 70, on: false, side: 'R' },
    ];
    const pl = T.plunger;
    this.plunger = { x: pl.x, restY: pl.y - 4, pull: 0, pulling: false, vel: 0, y: pl.y - 4, hw: 16, firing: false };
    this.cool = new Map();
    for (const t of T.targets) {
      t.segs = [];
      for (let i = 0; i < 4; i++) {
        const a = t.c[i], b = t.c[(i + 1) % 4];
        t.segs.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1], zlo: t.z - 5, zhi: t.z + 55, e: 0.3 });
      }
    }
  }

  addBall(x, y, z = 0, vx = 0, vy = 0) {
    const b = { x, y, z, vx, vy, vz: 0, held: null, inside: new Set(), id: this.balls.length + 1, spin: 0 };
    this.balls.push(b);
    return b;
  }

  setFlipper(side, up) {
    for (const f of this.T.flippers) if (f.side === side) f.up = up;
  }

  pullPlunger(on) {
    const p = this.plunger;
    if (on) { p.pulling = true; }
    else if (p.pulling) {
      p.pulling = false;
      p.vel = -(1400 + 3600 * p.pull); // y is down: negative = launch up the lane
      p.firing = true;
    }
  }

  eject(kicker, angleDeg, speed) {
    const b = this.balls.find((q) => q.held === kicker);
    if (!b) return null;
    b.held = null;
    b.skip = kicker; // ignore this kicker until the ball has left it
    b.x = kicker.x; b.y = kicker.y; b.z = kicker.z;
    const a = rad(angleDeg);
    b.vx = Math.sin(a) * speed; b.vy = -Math.cos(a) * speed;
    return b;
  }

  step(dt) {
    let n = Math.max(1, Math.round(dt / SUBSTEP));
    const h = dt / n;
    while (n--) this.sub(h);
  }

  sub(dt) {
    this.time += dt;
    const T = this.T;
    for (const f of T.flippers) {
      const target = f.up ? f.angE : f.angS;
      const speed = (f.up ? FLIP_UP : FLIP_DOWN) * (180 / Math.PI);
      const d = target - f.ang;
      if (Math.abs(d) < 1e-6) { f.omega = 0; continue; }
      const stepA = Math.sign(d) * Math.min(Math.abs(d), speed * dt);
      f.ang += stepA;
      f.omega = stepA / dt * (Math.PI / 180);
    }
    const pl = this.plunger;
    if (pl.pulling) {
      pl.pull = Math.min(1, pl.pull + dt / 0.9);
      pl.y = pl.restY + pl.pull * 70;
      pl.vel = 0;
    } else if (pl.firing) {
      pl.y += pl.vel * dt;
      if (pl.vel < 0 && pl.y <= pl.restY - 40) pl.vel = 500; // overshoot, then come back
      if (pl.vel > 0 && pl.y >= pl.restY) { pl.y = pl.restY; pl.vel = 0; pl.pull = 0; pl.firing = false; }
    }

    for (const b of this.balls) if (!b.held) this.moveBall(b, dt);
  }

  moveBall(b, dt) {
    const T = this.T;
    let ax = 0, ay = G_TILT;
    const sf = T.surfaceZ(b.x, b.y, b.z);
    if (sf.z >= b.z - 0.5) { b.z = sf.z; b.vz = 0; }
    else if (b.z - sf.z < 6 && b.vz === 0) b.z = sf.z;
    else {
      b.vz -= G_FALL * dt;
      b.z += b.vz * dt;
      if (b.z <= sf.z) { b.z = sf.z; b.vz = 0; }
    }
    const onSurf = Math.abs(b.z - sf.z) < 1;
    if (onSurf && (sf.gx || sf.gy)) { ax -= G_SLOPE * sf.gx; ay -= G_SLOPE * sf.gy; }

    for (const m of this.magnets) {
      if (!m.on) continue;
      const dx = m.x - b.x, dy = m.y - b.y, d = Math.hypot(dx, dy);
      if (d < m.r && b.z < 40) {
        const k = 22000 * (1 - d / m.r);
        ax += (dx / (d || 1)) * k; ay += (dy / (d || 1)) * k;
        b.vx *= 1 - 3 * dt; b.vy *= 1 - 3 * dt;
      }
    }

    b.vx += ax * dt; b.vy += ay * dt;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > MAX_SPEED) { b.vx *= MAX_SPEED / sp; b.vy *= MAX_SPEED / sp; }
    b.vx *= 1 - 0.12 * dt; b.vy *= 1 - 0.12 * dt;
    const ox = b.x, oy = b.y;
    b.x += b.vx * dt; b.y += b.vy * dt;

    this.collideStatic(b);
    this.collideTargets(b);
    this.collideBumpers(b);
    for (const f of T.flippers) this.collideFlipper(b, f);
    this.collidePlunger(b);
    this.gates(b, ox, oy);
    this.zones(b);
  }

  // ---- collisions --------------------------------------------------------

  hitSeg(b, s, e) {
    const c = closestOnSegment(b.x, b.y, s.ax, s.ay, s.bx, s.by);
    let dx = b.x - c.x, dy = b.y - c.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= BALL_R * BALL_R) return null;
    let d = Math.sqrt(d2);
    if (d < 1e-6) { // centre exactly on the segment: pick the side the ball came from
      dx = -b.vy; dy = b.vx; d = Math.hypot(dx, dy) || 1;
    }
    const nx = dx / d, ny = dy / d;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      const el = -vn < 40 ? 0 : e;
      b.vx -= (1 + el) * vn * nx; b.vy -= (1 + el) * vn * ny;
    }
    const pen = BALL_R - d;
    b.x += nx * pen; b.y += ny * pen;
    return { nx, ny, vn };
  }

  inZ(s, b) {
    return s.zhi > b.z + 2 && s.zlo < b.z + BALL_H - 2;
  }

  collideStatic(b) {
    const T = this.T;
    for (const idx of T.query(b.x, b.y)) {
      const s = T.segs[idx];
      if (!this.inZ(s, b)) continue;
      const hit = this.hitSeg(b, s, s.e);
      if (hit && s.sling && -hit.vn > 120 && this.coolOk('sling' + s.sling, 0.12)) {
        b.vx += hit.nx * 1500; b.vy += hit.ny * 1500;
        this.events.push({ type: 'sling', side: s.sling });
      }
    }
  }

  collideTargets(b) {
    for (const t of this.T.targets) {
      if (t.dropped || Math.abs(b.z - t.z) > 30) continue;
      if (Math.hypot(b.x - t.x, b.y - t.y) > 60) continue;
      for (const s of t.segs) {
        const hit = this.hitSeg(b, s, 0.3);
        if (hit && -hit.vn > 150) {
          t.dropped = true;
          this.events.push({ type: 'target', sw: t.sw, target: t });
        }
      }
    }
  }

  collideBumpers(b) {
    for (const k of this.T.bumpers) {
      if (Math.abs(b.z - k.z) > 30) continue;
      const dx = b.x - k.x, dy = b.y - k.y, d = Math.hypot(dx, dy), rr = k.r + BALL_R;
      if (d >= rr) continue;
      const nx = dx / (d || 1), ny = dy / (d || 1);
      const vn = b.vx * nx + b.vy * ny;
      b.x = k.x + nx * rr; b.y = k.y + ny * rr;
      if (vn < 0) {
        b.vx -= 1.2 * vn * nx; b.vy -= 1.2 * vn * ny;
        if (this.coolOk('bumper', 0.08)) {
          b.vx += nx * 1100; b.vy += ny * 1100;
          k.lit = 1;
          this.events.push({ type: 'bumper' });
        }
      }
    }
  }

  collideFlipper(b, f) {
    if (Math.abs(b.z - f.z) > 30) return;
    const phi = rad(f.ang - 90);
    const tx = f.x + Math.cos(phi) * f.len, ty = f.y + Math.sin(phi) * f.len;
    const c = closestOnSegment(b.x, b.y, f.x, f.y, tx, ty);
    const rf = f.r0 + (f.r1 - f.r0) * c.t;
    let dx = b.x - c.x, dy = b.y - c.y;
    const d = Math.hypot(dx, dy);
    if (d >= BALL_R + rf) return;
    const nx = dx / (d || 1), ny = dy / (d || 1);
    const cpx = c.x + nx * rf, cpy = c.y + ny * rf;
    const rx = cpx - f.x, ry = cpy - f.y;
    const svx = f.omega * -ry, svy = f.omega * rx;
    const vrel = (b.vx - svx) * nx + (b.vy - svy) * ny;
    if (vrel < 0) {
      const el = -vrel < 60 ? 0 : f.e;
      b.vx -= (1 + el) * vrel * nx; b.vy -= (1 + el) * vrel * ny;
      if (-vrel > 300) this.events.push({ type: 'flipperHit', flipper: f });
    }
    const pen = BALL_R + rf - d;
    b.x += nx * pen; b.y += ny * pen;
  }

  collidePlunger(b) {
    const p = this.plunger;
    if (b.z > 20 || Math.abs(b.x - p.x) > p.hw + 10) return;
    const surf = p.y;
    if (b.y + BALL_R > surf && b.y < surf + 20) {
      b.y = surf - BALL_R;
      const rel = b.vy - p.vel;
      if (rel > 0) b.vy = p.vel + (p.vel < 0 ? -0.1 * Math.abs(rel) : 0);
    }
  }

  gates(b, ox, oy) {
    for (const g of this.T.gates) {
      if (Math.abs(b.z - g.z) > 40) continue;
      const c = closestOnSegment(b.x, b.y, g.ax, g.ay, g.bx, g.by);
      const d = Math.hypot(b.x - c.x, b.y - c.y);
      if (d >= BALL_R) continue;
      if (g.twoWay || b.vx * g.dx + b.vy * g.dy > 0) continue; // passing the open way
      this.hitSeg(b, { ax: g.ax, ay: g.ay, bx: g.bx, by: g.by }, 0.2);
    }
  }

  zones(b) {
    const T = this.T;
    for (const t of T.triggers) {
      const inLevel = Math.abs(b.z - t.z) < 40;
      const inside = inLevel && Math.hypot(b.x - t.x, b.y - t.y) < t.r;
      const was = b.inside.has(t.name);
      if (inside && !was) { b.inside.add(t.name); this.events.push({ type: 'trigger', name: t.name, enter: true, ball: b }); }
      else if (!inside && was) { b.inside.delete(t.name); this.events.push({ type: 'trigger', name: t.name, enter: false, ball: b }); }
    }
    const sp = T.spinner;
    if (sp && b.z < 40) {
      const c = closestOnSegment(b.x, b.y, sp.ax, sp.ay, sp.bx, sp.by);
      const d = Math.hypot(b.x - c.x, b.y - c.y);
      const near = d < BALL_R + 4;
      if (near && !b.inside.has('spinner')) {
        b.inside.add('spinner');
        this.events.push({ type: 'spin', count: Math.max(1, Math.round(Math.hypot(b.vx, b.vy) / 400)) });
      } else if (!near) b.inside.delete('spinner');
    }
    for (const k of T.kickers) {
      if (k.role === 'release' || k.role === 'upperExit' || k.role === 'lockOut') continue;
      if (Math.abs(b.z - k.z) > 30) continue;
      const d = Math.hypot(b.x - k.x, b.y - k.y);
      if (b.skip === k) { if (d > k.r) b.skip = null; continue; }
      if (d > k.r * 0.8) continue;
      if (k.role === 'upperEnter') {
        const exit = T.kickers.find((q) => q.role === 'upperExit');
        const speed = Math.abs(b.vy) / 4;
        b.x = exit.x; b.y = exit.y + 5; b.z = exit.z; b.vx = 0; b.vy = speed; b.vz = 0;
        this.events.push({ type: 'upperEnter' });
      } else if (k.role === 'drain') {
        b.held = k; this.events.push({ type: 'drain', ball: b });
      } else if (Math.hypot(b.vx, b.vy) < 2500 || k.role === 'saucer') {
        b.held = k; b.vx = b.vy = 0;
        this.events.push({ type: 'kickerHold', kicker: k, ball: b });
      }
    }
  }

  coolOk(key, secs) {
    const last = this.cool.get(key) ?? -1;
    if (this.time - last < secs) return false;
    this.cool.set(key, this.time);
    return true;
  }
}
