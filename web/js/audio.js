// Tiny WebAudio synth: the original's sample set is not reused, these are
// generated placeholder sounds.
let ctx = null;

const PRESETS = {
  flipUp: { f: 140, t: 0.05, type: 'square', g: 0.08 },
  flipDown: { f: 90, t: 0.04, type: 'square', g: 0.04 },
  bumper: { f: 520, f2: 260, t: 0.12, type: 'triangle', g: 0.18 },
  sling: { f: 300, f2: 120, t: 0.08, type: 'sawtooth', g: 0.12 },
  drop: { f: 200, f2: 80, t: 0.14, type: 'square', g: 0.12 },
  reset: { f: 160, f2: 320, t: 0.18, type: 'square', g: 0.1 },
  bank: { f: 440, f2: 880, t: 0.35, type: 'triangle', g: 0.18 },
  spin: { f: 700, t: 0.03, type: 'square', g: 0.05 },
  lane: { f: 660, t: 0.08, type: 'sine', g: 0.12 },
  ramp: { f: 380, f2: 760, t: 0.2, type: 'sine', g: 0.12 },
  lock: { f: 120, f2: 60, t: 0.3, type: 'sawtooth', g: 0.2 },
  saucer: { f: 180, f2: 90, t: 0.2, type: 'square', g: 0.12 },
  kick: { f: 90, f2: 200, t: 0.12, type: 'sawtooth', g: 0.18 },
  plunger: { f: 100, f2: 50, t: 0.18, type: 'sawtooth', g: 0.2 },
  drain: { f: 220, f2: 55, t: 0.7, type: 'sine', g: 0.2 },
  nudge: { f: 70, t: 0.1, type: 'sine', g: 0.15 },
};

export function sound(name) {
  const p = PRESETS[name];
  if (!p) return;
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const o = ctx.createOscillator(), g = ctx.createGain();
    const t0 = ctx.currentTime;
    o.type = p.type;
    o.frequency.setValueAtTime(p.f, t0);
    if (p.f2) o.frequency.exponentialRampToValueAtTime(p.f2, t0 + p.t);
    g.gain.setValueAtTime(p.g, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + p.t);
    o.connect(g).connect(ctx.destination);
    o.start(t0);
    o.stop(t0 + p.t + 0.02);
  } catch (e) { /* audio unavailable */ }
}
