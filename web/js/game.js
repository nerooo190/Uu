// Game rules. The original runs Williams' System 7 ROM through PinMAME, which
// cannot be shipped here, so the rules are rebuilt from the table's rule text
// (see data/rules.txt) and are an approximation of the original scoring.

const BANKS = [
  { id: 'LL', sw: [25, 26, 27] },
  { id: 'LR', sw: [29, 30, 31] },
  { id: 'UL', sw: [33, 34, 35] },
  { id: 'UR', sw: [37, 38, 39] },
];
const BANK_TIME = 12;      // seconds to finish a bank (adjustable in the original)
const MAGNA_TIME = 4;      // seconds a Magna-Save stays on
const LIT_TIME = 8;        // mystery / spinner lit time
const BALLS_PER_GAME = 3;

export class Game {
  constructor(world, T, hooks = {}) {
    this.w = world;
    this.T = T;
    this.hooks = hooks;
    this.timers = [];
    this.phase = 'attract';
    this.score = 0;
    this.high = 0;
    try { this.high = +localStorage.getItem('bk_high') || 0; } catch (e) { /* no storage */ }
    this.message = 'PRESS 1 TO START';
    this.reset();
  }

  reset() {
    this.ball = 0;
    this.bonus = 0;
    this.mult = 1;
    this.magna = { L: false, R: false };
    this.lit = { mystery: 0, spinner: 0, extraUpper: false, extraLower: false };
    this.banks = BANKS.map((b) => ({ ...b, hit: new Set(), timer: 0, done: 0 }));
    this.locked = [];
    this.multiball = false;
    this.tilt = false;
    this.nudges = [];
    this.pendingExtra = 0;
    this.shootAgain = false;
  }

  // ---- flow -----------------------------------------------------------------

  startGame() {
    this.w.balls.length = 0;
    this.reset();
    this.score = 0;
    this.phase = 'play';
    this.ball = 1;
    this.beginBall();
  }

  beginBall() {
    this.tilt = false;
    this.bonus = 0;
    this.mult = 1;
    this.locked = [];
    this.multiball = false;
    this.lit.mystery = this.lit.spinner = 0;
    this.resetTargets();
    for (const b of this.banks) { b.hit.clear(); b.timer = 0; }
    this.say(`BALL ${this.ball}`);
    this.serve();
  }

  serve() {
    const b = this.w.addBall(896, 1690, 0, 0, 0);
    b.plunger = true;
    return b;
  }

  inPlay() {
    return this.w.balls.filter((b) => !b.held || b.held.role === 'saucer').length;
  }

  endBall() {
    this.phase = 'bonus';
    for (const b of this.locked) this.w.balls.splice(this.w.balls.indexOf(b), 1);
    this.locked = [];
    const total = this.bonus * 1000 * this.mult;
    this.say(total ? `BONUS ${this.bonus} x ${this.mult} = ${total}` : 'NO BONUS');
    this.addScore(total, true);
    this.after(2.2, () => {
      this.w.balls.length = 0;
      if (this.pendingExtra > 0) {
        this.pendingExtra--;
        this.say('SHOOT AGAIN');
        this.phase = 'play';
        this.beginBall();
      } else if (this.ball >= BALLS_PER_GAME) {
        this.phase = 'attract';
        if (this.score > this.high) {
          this.high = this.score;
          try { localStorage.setItem('bk_high', String(this.high)); } catch (e) { /* ignore */ }
          this.say('NEW HIGH SCORE');
        } else this.say('GAME OVER - PRESS 1');
      } else {
        this.ball++;
        this.phase = 'play';
        this.beginBall();
      }
    });
  }

  // ---- input ----------------------------------------------------------------

  flipper(side, down) {
    if (this.phase !== 'play' || this.tilt) down = false;
    this.w.setFlipper(side, down);
    this.hooks.sound?.(down ? 'flipUp' : 'flipDown');
  }

  plunger(down) {
    if (this.phase !== 'play') return;
    this.w.pullPlunger(down);
    if (!down) this.hooks.sound?.('plunger');
  }

  magnaKey(side, down) {
    const m = this.w.magnets.find((q) => q.side === side);
    if (!down) { return; }
    if (this.phase === 'play' && this.magna[side]) {
      this.magna[side] = false;
      m.on = true;
      this.say(`MAGNA-SAVE ${side === 'L' ? 'LEFT' : 'RIGHT'}`);
      this.after(MAGNA_TIME, () => { m.on = false; });
    }
  }

  nudge(dx) {
    if (this.phase !== 'play' || this.tilt) return;
    const now = this.w.time;
    this.nudges = this.nudges.filter((t) => now - t < 3);
    this.nudges.push(now);
    for (const b of this.w.balls) if (!b.held) { b.vx += dx * 220; b.vy -= 90; }
    this.hooks.sound?.('nudge');
    if (this.nudges.length > 3) {
      this.tilt = true;
      this.say('TILT');
      this.w.setFlipper('L', false); this.w.setFlipper('R', false);
    }
  }

  // ---- scoring and events ---------------------------------------------------------

  addScore(n, noMult) {
    const k = !noMult && this.multiball ? Math.max(1, this.inPlay()) : 1;
    this.score += n * k;
  }

  advance(n = 1) { this.bonus = Math.min(this.bonus + n, 39); if (this.bonus >= 9) this.mult = Math.min(5, 1 + Math.floor(this.bonus / 9)); }

  say(msg) { this.message = msg; this.messageAt = performance.now?.() ?? 0; }

  after(sec, fn) { this.timers.push({ t: sec, fn }); }

  resetTargets() { for (const t of this.T.targets) t.dropped = false; }

  update(dt) {
    for (const k of this.banks) {
      if (k.timer > 0) {
        k.timer -= dt;
        if (k.timer <= 0) { this.resetBank(k); }
      }
    }
    for (const key of ['mystery', 'spinner']) if (this.lit[key] > 0) this.lit[key] = Math.max(0, this.lit[key] - dt);
    for (const t of this.timers) t.t -= dt;
    const due = this.timers.filter((t) => t.t <= 0);
    this.timers = this.timers.filter((t) => t.t > 0);
    for (const t of due) t.fn();

    const ev = this.w.events.splice(0);
    for (const e of ev) this.handle(e);
  }

  resetBank(k) {
    k.hit.clear(); k.timer = 0;
    for (const t of this.T.targets) if (k.sw.includes(t.sw)) t.dropped = false;
    this.hooks.sound?.('reset');
  }

  handle(e) {
    if (this.phase !== 'play') return;
    const snd = this.hooks.sound;
    switch (e.type) {
      case 'bumper': this.addScore(100); snd?.('bumper'); break;
      case 'sling': this.addScore(10); snd?.('sling'); break;
      case 'flipperHit': break;
      case 'spin':
        this.addScore((this.lit.spinner > 0 ? 5000 : 100) * e.count);
        snd?.('spin');
        break;
      case 'target': this.onTarget(e.sw); break;
      case 'trigger': if (e.enter) this.onTrigger(e.name, e.ball); break;
      case 'upperEnter': this.addScore(500); snd?.('ramp'); break;
      case 'kickerHold': this.onKicker(e.kicker, e.ball); break;
      case 'drain': this.onDrain(e.ball); break;
      default:
    }
  }

  onTarget(sw) {
    this.addScore(100);
    this.hooks.sound?.('drop');
    const bank = this.banks.find((b) => b.sw.includes(sw));
    if (!bank) return;
    if (bank.hit.size === 0) bank.timer = BANK_TIME;
    bank.hit.add(sw);
    if (bank.hit.size === bank.sw.length) this.bankComplete(bank);
  }

  bankComplete(bank) {
    bank.done++;
    bank.timer = 0;
    this.addScore(3000);
    this.advance(1);
    if (!this.magna.R) this.magna.R = true;
    else if (!this.magna.L) this.magna.L = true;
    const g = (id) => this.banks.find((b) => b.id === id).done;
    if ((g('UL') >= 3 && g('UR') >= 3) || (g('LL') >= 3 && g('LR') >= 3)) this.lit.extraUpper = true;
    if (this.banks.every((b) => b.done >= 3)) this.lit.extraLower = true;
    this.say(`BANK ${bank.id} COMPLETE`);
    this.hooks.sound?.('bank');
    this.after(0.8, () => this.resetBank(bank));
  }

  onTrigger(name, ball) {
    const s = this.hooks.sound;
    switch (name) {
      case 'sw16': // left return lane
        this.addScore(2000); this.advance(2); this.lit.mystery = LIT_TIME; this.say('MYSTERY SCORE LIT'); this.lowerExtra(); break;
      case 'sw15': // right return lane
        this.addScore(2000); this.advance(2); this.lit.spinner = LIT_TIME; this.say('SPINNER LIT'); this.lowerExtra(); break;
      case 'sw11': case 'sw12': // outlanes
        this.addScore(5000); this.advance(2); s?.('lane'); break;
      case 'sw14': // centre ramp
        if (this.lit.mystery > 0) {
          const v = (20 + Math.floor(Math.random() * 80)) * 1000;
          this.lit.mystery = 0; this.addScore(v); this.say(`MYSTERY SCORE ${v}`);
        } else this.addScore(1000);
        s?.('ramp');
        break;
      case 'sw23': this.addScore(1000); s?.('ramp'); break;
      case 'sw44':
        this.addScore(1000);
        if (this.lit.extraUpper) { this.lit.extraUpper = false; this.extraBall(); }
        s?.('lane');
        break;
      default:
    }
  }

  lowerExtra() {
    if (this.lit.extraLower) { this.lit.extraLower = false; this.extraBall(); }
  }

  extraBall() { this.pendingExtra++; this.say('EXTRA BALL'); this.hooks.sound?.('bank'); }

  onKicker(k, ball) {
    const s = this.hooks.sound;
    if (k.role === 'lock') {
      this.locked.push(ball);
      this.addScore(2000);
      s?.('lock');
      if (this.locked.length >= 3) return this.startMultiball();
      this.say(`BALL ${this.locked.length} LOCKED`);
      if (this.inPlay() === 0) this.after(0.6, () => this.serve());
    } else if (k.role === 'saucer') {
      this.addScore(5000);
      s?.('saucer');
      if (this.locked.length > 0) { this.after(0.6, () => this.startMultiball()); return; }
      this.after(1.2, () => { this.w.eject(k, 160, 900); s?.('kick'); });
    }
  }

  startMultiball() {
    this.multiball = true;
    this.say('MULTIBALL');
    this.hooks.sound?.('bank');
    const out = this.T.kickers.find((q) => q.role === 'lockOut');
    const saucer = this.T.kickers.find((q) => q.role === 'saucer');
    this.locked.forEach((b, i) => {
      this.after(0.5 + i * 0.9, () => {
        b.held = out;
        const ball = this.w.eject(out, 194, 450);
        if (ball) ball.inside.clear();
        this.hooks.sound?.('kick');
      });
    });
    this.locked = [];
    this.after(0.5, () => { this.w.eject(saucer, 160, 900); });
  }

  onDrain(ball) {
    this.w.balls.splice(this.w.balls.indexOf(ball), 1);
    this.hooks.sound?.('drain');
    if (this.multiball && this.inPlay() <= 1) this.multiball = false;
    if (this.inPlay() === 0 && this.locked.length === 0) this.endBall();
    else if (this.inPlay() === 0 && this.locked.length > 0) this.after(0.6, () => this.serve());
  }
}
