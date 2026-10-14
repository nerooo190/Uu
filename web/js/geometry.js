// Geometry helpers: drag-point splines and small vector utilities.
// Table units are VPX units (952 x 1974); y grows downwards.

export const BALL_R = 25;
export const BALL_H = 50;

// Expand VPX drag points ({x,y,smooth}) into a polyline. Smooth points get a
// Hermite curve through their neighbours; sharp points stay corners.
export function spline(pts, closed) {
  const n = pts.length;
  const out = [];
  const get = (i) => {
    if (closed) return pts[((i % n) + n) % n];
    return pts[Math.max(0, Math.min(n - 1, i))];
  };
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    out.push({ x: p1.x, y: p1.y, i });
    if (!(p1.smooth || p2.smooth)) continue;
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(2, Math.min(24, Math.ceil(len / 10)));
    const t1x = p1.smooth ? (p2.x - p0.x) / 2 : dx;
    const t1y = p1.smooth ? (p2.y - p0.y) / 2 : dy;
    const t2x = p2.smooth ? (p3.x - p1.x) / 2 : dx;
    const t2y = p2.smooth ? (p3.y - p1.y) / 2 : dy;
    for (let s = 1; s < steps; s++) {
      const u = s / steps, u2 = u * u, u3 = u2 * u;
      const h1 = 2 * u3 - 3 * u2 + 1, h2 = u3 - 2 * u2 + u;
      const h3 = -2 * u3 + 3 * u2, h4 = u3 - u2;
      out.push({
        x: h1 * p1.x + h2 * t1x + h3 * p2.x + h4 * t2x,
        y: h1 * p1.y + h2 * t1y + h3 * p2.y + h4 * t2y,
        i,
      });
    }
  }
  if (!closed) out.push({ x: pts[n - 1].x, y: pts[n - 1].y, i: n - 1 });
  return out;
}

export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function closestOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: ax + dx * t, y: ay + dy * t, t };
}

export const rad = (deg) => (deg * Math.PI) / 180;
