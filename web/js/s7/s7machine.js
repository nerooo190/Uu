// Williams System 7 CPU board: 6808, five PIAs, CMOS RAM, lamp/switch/display
// matrices and solenoid drivers. Wiring follows the public hardware
// description of the board; the original game ROM runs unmodified.
import { M6800 } from './cpu6800.js';
import { PIA6821 } from './pia6821.js';
import { SoundBoard67, CPU_HZ } from './snd67.js';

export const IRQ_PERIOD = 0x380 + 32;   // cycles between periodic interrupts
export const IRQ_WIDTH = 32;
export const FRAME_CYCLES = Math.round(CPU_HZ / 60);

const SEG7 = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0, 0, 0, 0, 0, 0];

export class S7Machine {
  // roms: { ic14, ic17, ic20, ic26, sound12, speech4, speech5, speech6, speech7 }
  constructor(roms, opts = {}) {
    this.rom = new Uint8Array(0x10000);
    const put = (data, base, mirror) => { this.rom.set(data, base); this.rom.set(data, mirror); };
    put(roms.ic14, 0xe000, 0x6000);
    put(roms.ic17, 0xf000, 0x7000);
    put(roms.ic20, 0xe800, 0x6800);
    put(roms.ic26, 0xd800, 0x5800);
    this.cmos = opts.cmos || new Uint8Array(0x100); // 0x0100-0x01ff, battery backed
    this.ram = new Uint8Array(0x400);               // 0x1000-0x13ff, also visible at 0x0000-0x00ff

    this.sound = new SoundBoard67({
      sound: roms.sound12,
      speech: [roms.speech7, roms.speech5, roms.speech6, roms.speech4],
    }, opts.audioRate || 44100);

    // switch matrix: index 1..8 = columns, bit = row. Switch n (1..64) -> column (n-1)>>3 + 1, bit (n-1)&7
    this.swMatrix = new Uint8Array(10);
    this.special = { advance: 0, updown: 0, enter: 0, cpuDiag: 0, soundDiag: 0 };
    this.swCol = 0;
    this.digSel = 0;
    this.lampRow = 0; this.lampCol = 0;
    this.tmpLamps = new Uint8Array(8);
    this.lamps = new Uint8Array(8);             // latched lamp matrix [col] = row bits
    this.tmpSeg = new Uint16Array(48);
    this.segments = new Uint16Array(48);
    this.solBits1 = 0; this.solBits2 = 0;
    this.ssEn = 0;
    this.ss = new Uint8Array(8);
    this.solenoids = 0;                          // bit n-1 = solenoid n (current)
    this.onSolenoid = opts.onSolenoid || null;   // (n, state)
    this.frame = 0;
    this.piaIrq = false;

    const irq = () => {
      this.piaIrq = this.pia.some((p) => p.irqState);
      if (this.piaIrq) this.cpu.irq = true; else if (!this.irqPulse) this.cpu.irq = false;
    };
    this.pia = [
      // PIA0 (2100): PA0-4 sound command, PB6/7 commas, CA2/CB2 special solenoids 8/7
      new PIA6821({
        outA: (v) => this.sound.command(v),
        outB: (v) => { if (v & 0x80) this.tmpSeg[1 + this.digSel] |= 0x80; if (v & 0x40) this.tmpSeg[21 + this.digSel] |= 0x80; },
        outCA2: (l) => this.setSS(l, 7), outCB2: (l) => this.setSS(l, 6), irq,
      }),
      // PIA1 (2200): PA solenoids 1-8, PB solenoids 9-16, CB2 game-on, CA2 special 5
      new PIA6821({
        outA: (v) => { if (v !== this.solBits1) { this.solBits1 = v; this.updateSol(); } },
        outB: (v) => { if (v !== this.solBits2) { this.solBits2 = v; this.updateSol(); } },
        outCA2: (l) => this.setSS(l, 4), outCB2: (l) => { this.ssEn = l; this.updateSol(); }, irq,
      }),
      // PIA2 (2400): PA lamp return, PB lamp strobe, CA2/CB2 special 2/1
      new PIA6821({
        outA: (v) => { this.lampRow = (~v) & 0xff; this.setLamp(); },
        outB: (v) => { this.lampCol = v; this.setLamp(); },
        outCA2: (l) => this.setSS(l, 1), outCB2: (l) => this.setSS(l, 0), irq,
      }),
      // PIA3 (2800): PA0-3 digit select + diag LED, PB BCD, dips on PA input
      new PIA6821({
        inA: () => this.dips(),
        outA: (v) => { this.digSel = v & 0x0f; },
        outB: (v) => {
          const hi = SEG7[v >> 4] & 0x7f, lo = SEG7[v & 15] & 0x7f;
          if (hi) { this.tmpSeg[this.digSel] = (this.tmpSeg[this.digSel] & 0x80) | hi; }
          if (lo) { this.tmpSeg[20 + this.digSel] = (this.tmpSeg[20 + this.digSel] & 0x80) | lo; }
        },
        outCB2: (l) => this.setSS(l, 5), irq,
      }),
      // PIA4 (3000): PA switch return, PB switch drive, CA2/CB2 special 4/3
      new PIA6821({
        inA: () => this.readSwitches(),
        outB: (v) => { this.swCol = v; },
        outCA2: (l) => this.setSS(l, 3), outCB2: (l) => this.setSS(l, 2), irq,
      }),
    ];

    this.cpu = new M6800((a) => this.read(a), (a, v) => this.write(a, v));
    this.cpu.reset();
    this.nextIrq = IRQ_PERIOD; this.irqClear = 0; this.irqPulse = false;
    this.soundDebt = 0;
    this.audio = [];
  }

  // ---- memory ----------------------------------------------------------------

  read(a) {
    a &= 0xffff;
    if (a < 0x100) return this.ram[a];
    if (a < 0x200) return this.cmos[a - 0x100];
    if (a >= 0x1000 && a < 0x1400) return this.ram[a - 0x1000];
    if (a >= 0x2100 && a < 0x5000) {
      const reg = a & 3;
      switch (a & 0xfffc) {
        case 0x2100: return this.pia[0].read(reg);
        case 0x2200: return this.pia[1].read(reg);
        case 0x2400: return this.pia[2].read(reg);
        case 0x2800: return this.pia[3].read(reg);
        case 0x3000: return this.pia[4].read(reg);
        default: return 0xff;
      }
    }
    if (a >= 0x5000) return this.rom[a];
    return 0xff;
  }

  write(a, v) {
    a &= 0xffff; v &= 0xff;
    if (a < 0x100) { this.ram[a] = v; return; }
    if (a < 0x200) { this.cmos[a - 0x100] = v | 0xf0; return; }
    if (a >= 0x1000 && a < 0x1400) { this.ram[a - 0x1000] = v; return; }
    switch (a & 0xfffc) {
      case 0x2100: this.pia[0].write(a & 3, v); break;
      case 0x2200: this.pia[1].write(a & 3, v); break;
      case 0x2400: this.pia[2].write(a & 3, v); break;
      case 0x2800: this.pia[3].write(a & 3, v); break;
      case 0x3000: this.pia[4].write(a & 3, v); break;
      default:
    }
  }

  // ---- peripherals -------------------------------------------------------------

  setSwitch(n, on) {
    const col = ((n - 1) >> 3) + 1, bit = 1 << ((n - 1) & 7);
    if (on) this.swMatrix[col] |= bit; else this.swMatrix[col] &= ~bit;
  }

  getSwitch(n) { return !!(this.swMatrix[((n - 1) >> 3) + 1] & (1 << ((n - 1) & 7))); }

  readSwitches() {
    let r = 0;
    for (let c = 0; c < 8; c++) if (this.swCol & (1 << c)) r |= this.swMatrix[c + 1];
    return r;
  }

  dips() { // function dips are only returned while ENTER is held; none set -> 0xFF
    return 0xff;
  }

  setLamp() {
    for (let c = 0; c < 8; c++) if (this.lampCol & (1 << c)) this.tmpLamps[c] |= this.lampRow;
  }

  updateSol() {
    const bits = (this.solBits2 << 8) | this.solBits1;
    const old = this.solenoids & 0xffff;
    if (bits !== old) {
      for (let i = 0; i < 16; i++) {
        const nb = (bits >> i) & 1, ob = (old >> i) & 1;
        if (nb !== ob) this.onSolenoid && this.onSolenoid(i + 1, !!nb);
      }
      this.solenoids = (this.solenoids & ~0xffff) | bits;
    }
  }

  setSS(level, idx) {
    const on = this.ssEn && !(level & 1) ? 1 : 0;
    if (this.ss[idx] !== on) { this.ss[idx] = on; this.onSolenoid && this.onSolenoid(17 + idx, !!on); }
  }

  // ---- execution -----------------------------------------------------------------

  run(cycles) {
    const target = this.cpu.cycles + cycles;
    const cpu = this.cpu;
    while (cpu.cycles < target) {
      if (cpu.cycles >= this.nextIrq) {
        this.irqPulse = true; cpu.irq = true; this.irqClear = this.nextIrq + IRQ_WIDTH; this.nextIrq += IRQ_PERIOD;
        this.pia[3].setCA1(this.special.advance); this.pia[3].setCB1(this.special.updown);
      }
      if (this.irqPulse && cpu.cycles >= this.irqClear) {
        this.irqPulse = false;
        if (!this.piaIrq) { cpu.irq = false; this.pia[3].setCA1(0); this.pia[3].setCB1(0); }
      }
      cpu.step();
    }
  }

  // one 60 Hz frame of emulated time (CPU board + sound board), then latch the snapshots
  runFrame() {
    const slice = 128;
    let done = 0;
    while (done < FRAME_CYCLES) {
      const n = Math.min(slice, FRAME_CYCLES - done);
      this.run(n);
      this.sound.run(n);
      done += n;
    }
    this.frame++;
    if (this.frame % 2 === 0) {
      this.lamps.set(this.tmpLamps); this.tmpLamps.fill(0);
      this.segments.set(this.tmpSeg); this.tmpSeg.fill(0);
    }
    const a = this.sound.takeAudio();
    return a;
  }

  lampOn(n) { return !!(this.lamps[(n - 1) >> 3] & (1 << ((n - 1) & 7))); }
}
