// Williams System 6/7 sound + speech board: 6808 CPU, PIA, 8-bit DAC and an
// HC-55516 CVSD speech decoder. Produces mono audio samples.
import { M6800 } from './cpu6800.js';
import { PIA6821 } from './pia6821.js';

export const CPU_HZ = 3579545 / 4;

// Continuously Variable Slope Delta decoder (HC-55516 style).
class CVSD {
  constructor(rate = 16000) {
    this.shift = 0; this.integ = 0; this.filter = 0.0416;
    this.leak = Math.exp(-1 / (0.001 * rate));
    this.decay = Math.exp(-1 / (0.004 * rate));
    this.charge = Math.exp(-1 / (0.004 * rate));
    this.fmin = 0.0416; this.fmax = 1.0954;
  }

  digit(bit) {
    this.shift = ((this.shift << 1) | bit) & 0xff;
    this.integ += bit ? this.filter : -this.filter;
    this.integ *= this.leak;
    const t = this.shift & 7;
    if (t === 0 || t === 7) {
      this.filter = this.fmax - (this.fmax - this.filter) * this.charge;
      if (this.filter > this.fmax) this.filter = this.fmax;
    } else {
      this.filter *= this.decay;
      if (this.filter < this.fmin) this.filter = this.fmin;
    }
  }
}

export class SoundBoard67 {
  constructor(roms, audioRate = 44100) {
    // roms: { sound: Uint8Array(0x800), speech: [ic7, ic5, ic6, ic4] (0x1000 each) }
    this.mem = new Uint8Array(0x10000);
    for (const base of [0x7000, 0x7800, 0xf000, 0xf800]) this.mem.set(roms.sound.subarray(0, 0x800), base);
    const sp = roms.speech || [];
    [[0x3000, 0xb000], [0x4000, 0xc000], [0x5000, 0xd000], [0x6000, 0xe000]].forEach(([a, b], i) => {
      if (sp[i]) { this.mem.set(sp[i].subarray(0, 0x1000), a); this.mem.set(sp[i].subarray(0, 0x1000), b); }
    });
    this.ram = new Uint8Array(0x80);
    this.cmd = 0x1f;
    this.dacLevel = 0;
    this.speechData = 0; this.speechClk = 0;
    this.cvsd = new CVSD(16000);
    this.speechLevel = 0;
    this.dips = 0;

    this.pia = new PIA6821({
      inB: () => this.cmd,
      outA: (v) => { this.dacLevel = v; },
      outCA2: (l) => { this.speechData = l; },
      outCB2: (l) => {
        if (l && !this.speechClk) { this.cvsd.digit(this.speechData); this.speechLevel = this.cvsd.integ; }
        this.speechClk = l;
      },
      irq: (s) => { this.cpu.irq = !!s; },
    });
    this.cpu = new M6800((a) => this.read(a), (a, v) => this.write(a, v));
    this.cpu.reset();

    this.audioRate = audioRate;
    this.samplePeriod = CPU_HZ / audioRate;
    this.accum = 0; this.accTime = 0;
    this.hpPrev = 0; this.hpOut = 0;
    this.out = [];
    this.cycles = 0;
  }

  read(a) {
    a &= 0xffff;
    if (a < 0x80) return this.ram[a];
    if ((a & 0x7ffc) === 0x0400) return this.pia.read(a & 3);
    return this.mem[a];
  }

  write(a, v) {
    a &= 0xffff;
    if (a < 0x80) { this.ram[a] = v; return; }
    if ((a & 0x7ffc) === 0x0400) this.pia.write(a & 3, v);
  }

  // command from the CPU board: 5 bits, 0x1f = idle
  command(data) {
    this.cmd = (data & 0x1f) | ((this.dips & 7) << 5);
    this.pia.setCB1((this.cmd & 0x1f) !== 0x1f ? 1 : 0);
  }

  // run until the sound CPU has executed `cycles` more cycles
  run(cycles) {
    const target = this.cycles + cycles;
    while (this.cycles < target) {
      const c = this.cpu.step();
      this.cycles += c;
      const level = (this.dacLevel - 128) / 128 * 0.5 + this.speechLevel * 0.35;
      this.accum += level * c; this.accTime += c;
      while (this.accTime >= this.samplePeriod) {
        // emit one sample; carry the remainder of the interval
        const over = this.accTime - this.samplePeriod;
        const sample = (this.accum - level * over) / this.samplePeriod;
        this.accum = level * over; this.accTime = over;
        // one-pole high-pass (removes the DAC's DC offset)
        const y = sample - this.hpPrev + 0.9985 * this.hpOut;
        this.hpPrev = sample; this.hpOut = y;
        this.out.push(y);
      }
    }
  }

  takeAudio() { const o = this.out; this.out = []; return o; }
}
