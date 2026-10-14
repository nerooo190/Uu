// Turns the extracted VPX item list (data/table.json) into the physics model:
// collision segments with a z-range, ramp surfaces, and the dynamic elements.
import { spline, pointInPoly, BALL_H } from './geometry.js';

const F = (p, k, d = 0) => (p[k] ? p[k][0] : d);
const I = (p, k, d = 0) => (p[k] ? p[k][1] : d);

const UPPER_Z = 80; // height of the upper playfield surface

// Kicker roles. The VPX file names them; which level they sit on is not stored.
const KICKER_ROLE = {
  BallRelease: { role: 'release', z: 0 },
  Drain: { role: 'drain', z: 0 },
  sw24: { role: 'saucer', z: 0 },
  UpperEnter: { role: 'upperEnter', z: 0 },
  UpperExit: { role: 'upperExit', z: UPPER_Z },
  LockMech: { role: 'lock', z: UPPER_Z },
  LockOut: { role: 'lockOut', z: UPPER_Z },
};

export function buildTable(json) {
  const T = {
    width: json.right - json.left,
    height: json.bottom - json.top,
    segs: [],
    ramps: [],
    flippers: [],
    bumpers: [],
    kickers: [],
    targets: [],
    triggers: [],
    gates: [],
    lights: [],
    visuals: [],
    plateau: null,
    plunger: null,
    spinner: null,
    UPPER_Z,
  };

  const addSeg = (ax, ay, bx, by, zlo, zhi, e, extra) => {
    if (ax === bx && ay === by) return;
    T.segs.push({ ax, ay, bx, by, zlo, zhi, e, ...extra });
  };

  // Elements name the surface they stand on (SURF). Resolve it to a height.
  const surfaceTop = {};
  for (const item of json.items) {
    if (item.type === 'Wall') surfaceTop[item.name] = F(item.p, 'HTTP');
    else if (item.type === 'Ramp') surfaceTop[item.name] = Math.max(F(item.p, 'HTBT'), F(item.p, 'HTTP'));
  }
  const zOf = (p) => (typeof p.SURF === 'string' && p.SURF in surfaceTop ? surfaceTop[p.SURF] : 0);
  T.floors = [];

  const polyOf = (item, closed) =>
    spline(item.pts.map((q) => ({ x: q.VCEN[0], y: q.VCEN[1], smooth: !!I(q, 'SMTH') })), closed);

  for (const item of json.items) {
    const p = item.p;
    const name = item.name;
    switch (item.type) {
      case 'Wall': {
        const poly = polyOf(item, true);
        const zlo = F(p, 'HTBT'), zhi = F(p, 'HTTP');
        if (name === 'upperpf') T.plateau = { poly, z: zhi };
        if (I(p, 'CLDW') && I(p, 'VSBL') && p.IMAG && zhi - zlo <= 30 && zhi >= 70 && zhi <= 90) T.floors.push({ poly, z: zhi });
        if (I(p, 'VSBL') && p.IMAG) T.visuals.push({ name, image: p.IMAG, poly, z: zhi });
        if (!I(p, 'CLDW') || name === 'upperpf') break;
        const sling = /slingshot/i.test(name) ? (/left/i.test(name) ? 'L' : 'R') : null;
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], b = poly[(i + 1) % poly.length];
          addSeg(a.x, a.y, b.x, b.y, zlo, zhi, F(p, 'ELAS', 0.3), { sling });
        }
        break;
      }
      case 'Ramp': {
        const path = polyOf(item, false);
        let len = 0;
        const cum = [0];
        for (let i = 1; i < path.length; i++) {
          len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
          cum.push(len);
        }
        if (len < 1) break;
        const z0 = F(p, 'HTBT'), z1 = F(p, 'HTTP');
        const w0 = F(p, 'WDBT'), w1 = F(p, 'WDTP');
        const wl = F(p, 'WLHL'), wr = F(p, 'WLHR');
        const samples = path.map((q, i) => {
          const j = Math.min(i + 1, path.length - 1), k = Math.max(i - 1, 0);
          let tx = path[j].x - path[k].x, ty = path[j].y - path[k].y;
          const tl = Math.hypot(tx, ty) || 1;
          tx /= tl; ty /= tl;
          const fr = cum[i] / len;
          return { x: q.x, y: q.y, z: z0 + (z1 - z0) * fr, hw: (w0 + (w1 - w0) * fr) / 2, tx, ty };
        });
        const wide = Math.max(w0, w1) > 6;
        const ramp = { name, samples, wide, len, dzds: (z1 - z0) / len };
        if (wide && z0 !== z1 && I(p, 'TYPE') === 0 && I(p, 'CLDR')) T.ramps.push(ramp);
        const type = I(p, 'TYPE');
        if (type === 0 && I(p, 'CLDR')) {
          const e = F(p, 'ELAS', 0.3);
          const rail = (side, h) => {
            if (h <= 0) return;
            for (let i = 0; i + 1 < samples.length; i++) {
              const a = samples[i], b = samples[i + 1];
              const ax = a.x - a.ty * a.hw * side, ay = a.y + a.tx * a.hw * side;
              const bx = b.x - b.ty * b.hw * side, by = b.y + b.tx * b.hw * side;
              addSeg(ax, ay, bx, by, Math.min(a.z, b.z) - 1, Math.max(a.z, b.z) + h, e, { ramp: name });
            }
          };
          if (wide) { rail(1, wl); rail(-1, wr); }
          else rail(0, Math.max(wl, wr));
        }
        break;
      }
      case 'Flipper': {
                T.flippers.push({
          name, x: p.VCEN[0], y: p.VCEN[1], len: F(p, 'FLPR'), r0: F(p, 'BASR'), r1: F(p, 'ENDR'),
          angS: F(p, 'ANGS'), angE: F(p, 'ANGE'), e: F(p, 'ELAS', 0.6), fric: F(p, 'FRIC', 0.3),
          side: /^Left/.test(name) ? 'L' : 'R', z: zOf(p),
          ang: F(p, 'ANGS'), omega: 0, up: false,
        });
        break;
      }
      case 'Bumper':
        T.bumpers.push({ name, x: p.VCEN[0], y: p.VCEN[1], r: F(p, 'RADI', 45), z: zOf(p), lit: 0 });
        break;
      case 'Kicker': {
        const role = KICKER_ROLE[name];
        if (role) T.kickers.push({ name, x: p.VCEN[0], y: p.VCEN[1], r: F(p, 'RADI', 25), ...role, z: zOf(p) });
        break;
      }
      case 'HitTarget': {
        const [x, y, z] = p.VPOS, [sx, sy] = p.VSIZ;
        const rot = F(p, 'ROTZ') * Math.PI / 180;
        const cx = Math.cos(rot), cy = Math.sin(rot);
        const hw = sx / 2, ht = Math.min(sy, 14) / 2;
        const corner = (u, v) => [x + cx * u - cy * v, y + cy * u + cx * v];
        const c = [corner(-hw, -ht), corner(hw, -ht), corner(hw, ht), corner(-hw, ht)];
        T.targets.push({
          name, sw: +name.slice(2), x, y, rot, hw, c,
          z: z > 40 ? UPPER_Z : 0, dropped: false,
        });
        break;
      }
      case 'Trigger':
        T.triggers.push({ name, x: p.VCEN[0], y: p.VCEN[1], r: F(p, 'RADI', 25), z: zOf(p) });
        break;
      case 'Gate': {
        const rot = F(p, 'ROTA') * Math.PI / 180;
        const half = Math.min(F(p, 'LGTH', 100), 70) / 2;
        const x = p.VCEN[0], y = p.VCEN[1];
        T.gates.push({
          name, x, y, z: zOf(p), twoWay: !!I(p, 'TWWA'), ax: x - Math.cos(rot) * half, ay: y - Math.sin(rot) * half,
          bx: x + Math.cos(rot) * half, by: y + Math.sin(rot) * half,
          // passing direction: rotate "up the table" by the gate angle
          dx: Math.sin(rot), dy: -Math.cos(rot),
        });
        break;
      }
      case 'Spinner': {
        const rot = F(p, 'ROTA') * Math.PI / 180;
        const half = F(p, 'LGTH', 80) / 2;
        const x = p.VCEN[0], y = p.VCEN[1];
        T.spinner = {
          x, y, ax: x - Math.cos(rot) * half, ay: y - Math.sin(rot) * half,
          bx: x + Math.cos(rot) * half, by: y + Math.sin(rot) * half, rot,
        };
        break;
      }
      case 'Plunger':
        // The VPX plunger sits below the lane; the ball rests in the V-notch of
        // the invisible wall above it (apex ~ y 1805, where switch sw45 is).
        T.plunger = { x: p.VCEN[0], y: 1805, width: F(p, 'WDTH', 25), travel: 70 };
        break;
      case 'Light': {
        const rgb = (c) => [c & 255, (c >> 8) & 255, (c >> 16) & 255];
        T.lights.push({
          name, x: p.VCEN[0], y: p.VCEN[1], r: F(p, 'RADI', 50),
          color: rgb(I(p, 'COL2', 0xffffff)), edge: rgb(I(p, 'COLR', 0xffffff)),
          lamp: /^l(\d+)[a-z]?$/.test(name) ? +name.match(/^l(\d+)/)[1] : 0,
        });
        break;
      }
      default:
    }
  }

  T.visuals.sort((a, b) => a.z - b.z);
  T.surfaceZ = (x, y, zBall) => surfaceZ(T, x, y, zBall);
  T.upperAt = (x, y) => !!T.plateau && pointInPoly(x, y, T.plateau.poly);

  // uniform grid over the collision segments
  const CELL = 64;
  const gw = Math.ceil(T.width / CELL) + 2, gh = Math.ceil(T.height / CELL) + 2;
  const grid = new Array(gw * gh);
  T.segs.forEach((s, idx) => {
    const x0 = Math.floor(Math.min(s.ax, s.bx) / CELL) - 0, x1 = Math.floor(Math.max(s.ax, s.bx) / CELL);
    const y0 = Math.floor(Math.min(s.ay, s.by) / CELL) - 0, y1 = Math.floor(Math.max(s.ay, s.by) / CELL);
    for (let gx = Math.max(0, x0 - 1); gx <= Math.min(gw - 1, x1 + 1); gx++)
      for (let gy = Math.max(0, y0 - 1); gy <= Math.min(gh - 1, y1 + 1); gy++)
        (grid[gx + gy * gw] ||= []).push(idx);
  });
  T.query = (x, y) => {
    const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL);
    if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) return [];
    return grid[gx + gy * gw] || [];
  };
  return T;
}

// Height of the support under (x,y) that a ball at height zBall can stand on,
// plus the slope vector (dz/dx, dz/dy) when that support is a ramp.
function surfaceZ(T, x, y, zBall) {
  let best = 0, gx = 0, gy = 0;
  const reach = zBall + 14;
  for (const f of T.floors) {
    if (f.z <= reach && f.z > best && pointInPoly(x, y, f.poly)) { best = f.z; gx = 0; gy = 0; }
  }
  for (const r of T.ramps) {
    const s = r.samples;
    let bi = -1, bd = Infinity;
    for (let i = 0; i < s.length; i++) {
      const d = (s[i].x - x) ** 2 + (s[i].y - y) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    const q = s[bi];
    if (bd > (q.hw + 8) ** 2) continue;
    // lateral and along-path position relative to the nearest sample
    const along = (x - q.x) * q.tx + (y - q.y) * q.ty;
    if ((bi === 0 && along < -8) || (bi === s.length - 1 && along > 8)) continue;
    const z = q.z + along * r.dzds;
    if (z <= reach && z > best) { best = z; gx = q.tx * r.dzds; gy = q.ty * r.dzds; }
  }
  return { z: best, gx, gy };
}

export { BALL_H, UPPER_Z };
