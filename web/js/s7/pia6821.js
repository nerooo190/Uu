// Motorola 6821 PIA. Port outputs and CA2/CB2 outputs are reported through
// callbacks so the board can wire them to lamps, solenoids, displays, sound.

export class PIA6821 {
  constructor(cfg = {}) {
    this.inA = cfg.inA || (() => 0xff);   // peripheral data read on port A (input pins)
    this.inB = cfg.inB || (() => 0xff);
    this.outA = cfg.outA || null;          // (value)
    this.outB = cfg.outB || null;
    this.outCA2 = cfg.outCA2 || null;      // (level)
    this.outCB2 = cfg.outCB2 || null;
    this.irqChanged = cfg.irq || null;     // (state)
    this.reset();
  }

  reset() {
    this.ora = 0; this.ddra = 0; this.cra = 0;
    this.orb = 0; this.ddrb = 0; this.crb = 0;
    this.ca1 = 0; this.ca2in = 0; this.cb1 = 0; this.cb2in = 0;
    this.ca2out = 0; this.cb2out = 0;
    this.irqState = false;
  }

  irqLine() {
    const a = ((this.cra & 0x80) && (this.cra & 0x01)) || ((this.cra & 0x40) && (this.cra & 0x08) && !(this.cra & 0x20));
    const b = ((this.crb & 0x80) && (this.crb & 0x01)) || ((this.crb & 0x40) && (this.crb & 0x08) && !(this.crb & 0x20));
    return !!(a || b);
  }

  updateIrq() {
    const s = this.irqLine();
    if (s !== this.irqState) { this.irqState = s; this.irqChanged && this.irqChanged(s); }
  }

  // ---- peripheral side inputs ----
  setCA1(level) {
    level = level ? 1 : 0;
    if (level !== this.ca1) {
      const rising = level === 1;
      if (rising === !!(this.cra & 0x02)) { this.cra |= 0x80; this.updateIrq(); }
    }
    this.ca1 = level;
  }

  setCB1(level) {
    level = level ? 1 : 0;
    if (level !== this.cb1) {
      const rising = level === 1;
      if (rising === !!(this.crb & 0x02)) { this.crb |= 0x80; this.updateIrq(); }
    }
    this.cb1 = level;
  }

  portA() {
    const out = this.ora & this.ddra;
    return out | (this.inA() & ~this.ddra & 0xff);
  }

  portB() {
    const out = this.orb & this.ddrb;
    return out | (this.inB() & ~this.ddrb & 0xff);
  }

  read(reg) {
    switch (reg & 3) {
      case 0:
        if (!(this.cra & 0x04)) return this.ddra;
        this.cra &= 0x3f; this.updateIrq();
        return this.portA();
      case 1: return this.cra;
      case 2:
        if (!(this.crb & 0x04)) return this.ddrb;
        this.crb &= 0x3f; this.updateIrq();
        return this.portB();
      default: return this.crb;
    }
  }

  write(reg, v) {
    v &= 0xff;
    switch (reg & 3) {
      case 0:
        if (!(this.cra & 0x04)) this.ddra = v;
        else { this.ora = v; this.outA && this.outA(this.ora & this.ddra, this.ora); }
        break;
      case 1:
        this.cra = (this.cra & 0xc0) | (v & 0x3f);
        this.setCA2FromControl();
        this.updateIrq();
        break;
      case 2:
        if (!(this.crb & 0x04)) this.ddrb = v;
        else { this.orb = v; this.outB && this.outB(this.orb & this.ddrb, this.orb); }
        break;
      default:
        this.crb = (this.crb & 0xc0) | (v & 0x3f);
        this.setCB2FromControl();
        this.updateIrq();
    }
  }

  setCA2FromControl() {
    if (this.cra & 0x20) { // output mode
      let lvl = this.ca2out;
      if (this.cra & 0x10) lvl = (this.cra >> 3) & 1; // manual
      else lvl = 1;
      if (lvl !== this.ca2out || this.ca2init !== true) { this.ca2out = lvl; this.ca2init = true; this.outCA2 && this.outCA2(lvl); }
    }
  }

  setCB2FromControl() {
    if (this.crb & 0x20) {
      let lvl = this.cb2out;
      if (this.crb & 0x10) lvl = (this.crb >> 3) & 1;
      else lvl = 1;
      if (lvl !== this.cb2out || this.cb2init !== true) { this.cb2out = lvl; this.cb2init = true; this.outCB2 && this.outCB2(lvl); }
    }
  }
}
