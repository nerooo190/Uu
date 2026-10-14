// Glue between the physics world and the emulated System 7 board: the ROM
// decides the rules, this module turns table events into switch closures and
// ROM solenoid pulses into actions on the table.

const SW = {
  tilt: 46, plumb: 1, credit: 3, coin: [4, 5, 6],
  magnaR: 9, magnaL: 10,
  outhole: 20, trough: [17, 18, 19], lock: [41, 42, 43],
  saucer: 24, bumper: 36, slingL: 21, slingR: 22, spinner: 13,
};

export class Cabinet {
  constructor(world, T, machine) {
    this.w = world; this.T = T; this.m = machine;
    this.troughCount = 3;
    this.outhole = [];          // balls sitting in the drain
    this.locked = [];           // balls held by the lock
    this.saucerBall = null;
    this.timers = [];
    this.keys = { L: false, R: false };
    this.gi = true;
    this.knocks = 0;
    this.sounds = null;
    this.trig = new Map();      // trigger name -> ball count inside
    machine.onSolenoid = (n, on) => this.solenoid(n, on);
    this.syncTrough();
    this.banks = [[25, 26, 27], [29, 30, 31], [33, 34, 35], [37, 38, 39]];
    this.nudges = [];
  }

  after(sec, fn) { this.timers.push({ t: sec, fn }); }

  pulse(sw, ms = 60) {
    this.m.setSwitch(sw, true);
    this.after(ms / 1000, () => this.m.setSwitch(sw, false));
  }

  syncTrough() {
    SW.trough.forEach((sw, i) => this.m.setSwitch(sw, this.troughCount > i));
  }

  syncLock() {
    SW.lock.forEach((sw, i) => this.m.setSwitch(sw, this.locked.length > i));
  }

  // ---- inputs from the player -----------------------------------------------------

  coin() { this.pulse(SW.coin[0], 120); }
  start() { this.pulse(SW.credit, 150); }

  flipper(side, down) {
    this.keys[side] = down;
    this.w.setFlipper(side, down && this.flippersLive());
  }

  flippersLive() { return !!this.m.ssEn && !this.tilted; }

  magna(side, down) { this.m.setSwitch(side === 'L' ? SW.magnaL : SW.magnaR, down); }

  nudge() {
    const now = this.w.time;
    this.nudges = this.nudges.filter((t) => now - t < 4);
    this.nudges.push(now);
    if (this.nudges.length >= 4 && !this.tilted) {
      this.tilted = true;
      this.pulse(SW.tilt, 300);
      this.w.setFlipper('L', false); this.w.setFlipper('R', false);
      this.after(8, () => { this.tilted = false; this.nudges = []; });
    }
  }

  // ---- ROM solenoids ------------------------------------------------------------------

  solenoid(n, on) {
    const T = this.T;
    if (n >= 2 && n <= 5 && on) { // drop target banks
      const bank = this.banks[n - 2];
      for (const t of T.targets) if (bank.includes(t.sw)) { t.dropped = false; this.m.setSwitch(t.sw, false); }
      this.snd('reset');
    } else if (n === 1 && on) { // outhole kick into the trough
      const b = this.outhole.shift();
      if (b) {
        this.after(0.25, () => {
          this.removeBall(b);
          this.troughCount++; this.syncTrough();
          this.m.setSwitch(SW.outhole, this.outhole.length > 0);
        });
        this.snd('kick');
      }
    } else if (n === 6 && on) { // trough release -> plunger lane
      if (this.troughCount > 0) {
        this.troughCount--; this.syncTrough();
        const k = T.kickers.find((q) => q.role === 'release');
        const b = this.w.addBall(k.x - 6, k.y, 0, 700, 0);
        b.skip = k;
        this.snd('kick');
      }
    } else if (n === 7 && on) { // lock release
      const k = T.kickers.find((q) => q.role === 'lockOut');
      const b = this.locked.shift();
      if (b) {
        b.held = null; b.x = k.x; b.y = k.y; b.z = k.z;
        b.vx = Math.sin(194 * Math.PI / 180) * 300; b.vy = -Math.cos(194 * Math.PI / 180) * 300;
        b.skip = k; this.syncLock(); this.snd('kick');
      }
    } else if (n === 8 && on) { // saucer eject
      const k = T.kickers.find((q) => q.role === 'saucer');
      const b = this.saucerBall;
      if (b) {
        this.saucerBall = null;
        b.held = null; b.x = k.x; b.y = k.y; b.z = k.z; b.skip = k;
        const a = 160 * Math.PI / 180;
        b.vx = Math.sin(a) * 900; b.vy = -Math.cos(a) * 900;
        this.m.setSwitch(SW.saucer, false); this.snd('kick');
      }
    } else if (n === 9) this.w.magnets[1].on = on;
    else if (n === 10) this.w.magnets[0].on = on;
    else if (n === 11) this.gi = !on;
    else if (n === 15 && on) { this.knocks++; this.snd('knock'); }
    if (this.onSol) this.onSol(n, on);
  }

  removeBall(b) {
    const i = this.w.balls.indexOf(b); if (i >= 0) this.w.balls.splice(i, 1);
    for (const name of b.inside) {
      const n = Math.max(0, (this.trig.get(name) || 0) - 1);
      this.trig.set(name, n);
      if (/^sw\d+$/.test(name)) this.m.setSwitch(+name.slice(2), n > 0);
    }
    b.inside.clear();
  }

  snd(name) { this.sounds && this.sounds(name); }

  // ---- physics events -> switches ---------------------------------------------------------

  handle(e) {
    const m = this.m;
    switch (e.type) {
      case 'bumper': this.pulse(SW.bumper, 50); this.snd('bumper'); break;
      case 'sling': this.pulse(e.side === 'L' ? SW.slingL : SW.slingR, 50); this.snd('sling'); break;
      case 'spin': {
        for (let i = 0; i < Math.min(e.count, 4); i++) this.after(i * 0.05, () => this.pulse(SW.spinner, 20));
        this.snd('spin');
        break;
      }
      case 'target': m.setSwitch(e.sw, true); this.snd('drop'); break;
      case 'trigger': {
        const n = (this.trig.get(e.name) || 0) + (e.enter ? 1 : -1);
        this.trig.set(e.name, Math.max(0, n));
        const num = +e.name.slice(2);
        if (/^sw\d+$/.test(e.name)) m.setSwitch(num, n > 0);
        break;
      }
      case 'drain': {
        this.outhole.push(e.ball);
        m.setSwitch(SW.outhole, true);
        this.snd('drain');
        break;
      }
      case 'kickerHold': {
        if (e.kicker.role === 'saucer') { this.saucerBall = e.ball; m.setSwitch(SW.saucer, true); this.snd('saucer'); }
        else if (e.kicker.role === 'lock') { this.locked.push(e.ball); this.syncLock(); this.snd('lock'); }
        break;
      }
      case 'upperEnter': this.snd('ramp'); break;
      default:
    }
  }

  update(dt) {
    for (const t of this.timers) t.t -= dt;
    const due = this.timers.filter((t) => t.t <= 0);
    if (due.length) this.timers = this.timers.filter((t) => t.t > 0);
    for (const t of due) t.fn();
    for (const e of this.w.events.splice(0)) this.handle(e);
    // flippers follow the buttons only while the game relay is on
    this.w.setFlipper('L', this.keys.L && this.flippersLive());
    this.w.setFlipper('R', this.keys.R && this.flippersLive());
  }

  // table lamp state for rendering: lamp number -> boolean
  lampOn(n) { return this.m.lampOn(n); }
}
