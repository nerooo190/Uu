// Motorola 6800 / 6808 CPU core (the 6808 is a 6800 without the on-chip ROM
// or its own interrupt differences; same instruction set).
// Written from the public 6800 programming manual.

const CYC = new Uint8Array(256); // base cycle counts, 0 = undefined opcode
const setC = (ops, c) => { for (const o of ops) CYC[o] = c; };

setC([0x01, 0x06, 0x07, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x16, 0x17, 0x19, 0x1b], 2);
setC([0x08, 0x09, 0x30, 0x31, 0x34, 0x35], 4);
setC([0x20, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f], 4);
setC([0x32, 0x33, 0x36, 0x37], 4);
CYC[0x39] = 5; CYC[0x3b] = 10; CYC[0x3e] = 9; CYC[0x3f] = 12;
for (const base of [0x40, 0x50]) setC([0, 3, 4, 6, 7, 8, 9, 0xa, 0xc, 0xd, 0xf].map((v) => base + v), 2);
setC([0x60, 0x63, 0x64, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x6c, 0x6d, 0x6f], 7);
setC([0x70, 0x73, 0x74, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x7c, 0x7d, 0x7f], 6);
CYC[0x6d] = 7; CYC[0x7d] = 6; CYC[0x6e] = 4; CYC[0x7e] = 3;
// A/B accumulator groups
for (const hi of [0x80, 0xc0]) {
  const alu = [0, 1, 2, 4, 5, 6, 8, 9, 0xa, 0xb];
  for (const o of alu) { CYC[hi + o] = 2; CYC[hi + 0x10 + o] = 3; CYC[hi + 0x20 + o] = 5; CYC[hi + 0x30 + o] = 4; }
  CYC[hi + 0x17] = 4; CYC[hi + 0x27] = 6; CYC[hi + 0x37] = 5; // STA
}
// CPX / LDS / LDX (16-bit loads and compares)
for (const [o, c] of [[0x8c, 3], [0x9c, 4], [0xac, 6], [0xbc, 5], [0x8e, 3], [0x9e, 4], [0xae, 6], [0xbe, 5],
  [0xce, 3], [0xde, 4], [0xee, 6], [0xfe, 5]]) CYC[o] = c;
// STS / STX
for (const [o, c] of [[0x9f, 5], [0xaf, 7], [0xbf, 6], [0xdf, 5], [0xef, 7], [0xff, 6]]) CYC[o] = c;
CYC[0x8d] = 8; CYC[0xad] = 8; CYC[0xbd] = 9;

export class M6800 {
  constructor(read, write) {
    this.read = read; this.write = write;
    this.a = 0; this.b = 0; this.x = 0; this.sp = 0; this.pc = 0;
    this.h = 0; this.i = 1; this.n = 0; this.z = 0; this.v = 0; this.c = 0;
    this.irq = false; this.nmi = false; this.nmiPrev = false;
    this.halted = false; // WAI
    this.cycles = 0;
    this.trace = null;
  }

  reset() {
    this.i = 1; this.halted = false;
    this.pc = (this.read(0xfffe) << 8) | this.read(0xffff);
  }

  get cc() { return 0xc0 | (this.h << 5) | (this.i << 4) | (this.n << 3) | (this.z << 2) | (this.v << 1) | this.c; }
  set cc(v) { this.h = (v >> 5) & 1; this.i = (v >> 4) & 1; this.n = (v >> 3) & 1; this.z = (v >> 2) & 1; this.v = (v >> 1) & 1; this.c = v & 1; }

  push(v) { this.write(this.sp, v & 255); this.sp = (this.sp - 1) & 0xffff; }
  pull() { this.sp = (this.sp + 1) & 0xffff; return this.read(this.sp); }

  pushState() {
    this.push(this.pc); this.push(this.pc >> 8);
    this.push(this.x); this.push(this.x >> 8);
    this.push(this.a); this.push(this.b); this.push(this.cc);
  }

  vector(addr) { this.pc = (this.read(addr) << 8) | this.read(addr + 1); }

  // Executes one instruction (or services an interrupt). Returns cycles used.
  step() {
    if (this.nmi && !this.nmiPrev) {
      this.nmiPrev = true;
      if (!this.halted) this.pushState(); // WAI already pushed the state
      this.halted = false; this.i = 1; this.vector(0xfffc);
      this.cycles += 12; return 12;
    }
    this.nmiPrev = this.nmi;
    if (this.irq && !this.i) {
      if (!this.halted) this.pushState();
      this.halted = false; this.i = 1; this.vector(0xfff8);
      this.cycles += 12; return 12;
    }
    if (this.halted) { this.cycles += 4; return 4; }
    if (this.trace) this.trace(this);
    const op = this.read(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    const c = this.exec(op);
    this.cycles += c;
    return c;
  }

  fetch() { const v = this.read(this.pc); this.pc = (this.pc + 1) & 0xffff; return v; }
  fetch16() { const h = this.fetch(); return (h << 8) | this.fetch(); }
  rd16(a) { return (this.read(a) << 8) | this.read((a + 1) & 0xffff); }
  wr16(a, v) { this.write(a, (v >> 8) & 255); this.write((a + 1) & 0xffff, v & 255); }

  nz8(r) { this.n = (r >> 7) & 1; this.z = r === 0 ? 1 : 0; }
  nz16(r) { this.n = (r >> 15) & 1; this.z = r === 0 ? 1 : 0; }

  // effective address for a mode: 1 direct, 2 indexed, 3 extended
  ea(mode) {
    if (mode === 1) return this.fetch();
    if (mode === 2) return (this.x + this.fetch()) & 0xffff;
    return this.fetch16();
  }

  // 8-bit ALU helpers; return new accumulator value (or undefined for compare/test)
  add8(a, m, cin) {
    const r = a + m + cin;
    this.h = ((a & 15) + (m & 15) + cin) > 15 ? 1 : 0;
    this.c = r > 255 ? 1 : 0;
    const r8 = r & 255;
    this.v = (((a ^ r8) & (m ^ r8)) >> 7) & 1;
    this.nz8(r8);
    return r8;
  }

  sub8(a, m, cin) {
    const r = a - m - cin;
    this.c = r < 0 ? 1 : 0;
    const r8 = r & 255;
    this.v = (((a ^ m) & (a ^ r8)) >> 7) & 1;
    this.nz8(r8);
    return r8;
  }

  // shared read-modify-write operations; op is the low nibble of the opcode
  rmw(op, v) {
    let r;
    switch (op) {
      case 0x0: r = this.sub8(0, v, 0); break; // NEG
      case 0x3: r = (~v) & 255; this.nz8(r); this.v = 0; this.c = 1; break; // COM
      case 0x4: this.c = v & 1; r = v >> 1; this.nz8(r); this.v = this.n ^ this.c; break; // LSR
      case 0x6: { const cin = this.c; this.c = v & 1; r = (v >> 1) | (cin << 7); this.nz8(r); this.v = this.n ^ this.c; break; } // ROR
      case 0x7: this.c = v & 1; r = (v >> 1) | (v & 0x80); this.nz8(r); this.v = this.n ^ this.c; break; // ASR
      case 0x8: this.c = (v >> 7) & 1; r = (v << 1) & 255; this.nz8(r); this.v = this.n ^ this.c; break; // ASL
      case 0x9: { const cin = this.c; this.c = (v >> 7) & 1; r = ((v << 1) | cin) & 255; this.nz8(r); this.v = this.n ^ this.c; break; } // ROL
      case 0xa: r = (v - 1) & 255; this.nz8(r); this.v = v === 0x80 ? 1 : 0; break; // DEC
      case 0xc: r = (v + 1) & 255; this.nz8(r); this.v = v === 0x7f ? 1 : 0; break; // INC
      case 0xd: this.nz8(v); this.v = 0; this.c = 0; return null; // TST
      case 0xf: r = 0; this.n = 0; this.z = 1; this.v = 0; this.c = 0; break; // CLR
      default: throw new Error('bad rmw ' + op);
    }
    return r;
  }

  branch(cond) {
    const off = this.fetch();
    if (cond) this.pc = (this.pc + (off < 128 ? off : off - 256)) & 0xffff;
  }

  exec(op) {
    const cyc = CYC[op];
    if (!cyc) throw new Error(`undefined opcode ${op.toString(16)} at ${((this.pc - 1) & 0xffff).toString(16)}`);
    const hi = op >> 4;
    // read-modify-write groups
    if (hi === 4 || hi === 5) {
      const lo = op & 15;
      const r = this.rmw(lo, hi === 4 ? this.a : this.b);
      if (r !== null) { if (hi === 4) this.a = r; else this.b = r; }
      return cyc;
    }
    if ((hi === 6 || hi === 7) && op !== 0x6e && op !== 0x7e) {
      const addr = this.ea(hi === 6 ? 2 : 3);
      const r = this.rmw(op & 15, this.read(addr));
      if (r !== null) this.write(addr, r);
      return cyc;
    }
    if (op === 0x6e) { this.pc = this.ea(2); return cyc; }
    if (op === 0x7e) { this.pc = this.fetch16(); return cyc; }

    if (hi === 2) { // branches
      switch (op) {
        case 0x20: this.branch(true); break;
        case 0x22: this.branch(!(this.c | this.z)); break;
        case 0x23: this.branch(this.c | this.z); break;
        case 0x24: this.branch(!this.c); break;
        case 0x25: this.branch(this.c); break;
        case 0x26: this.branch(!this.z); break;
        case 0x27: this.branch(this.z); break;
        case 0x28: this.branch(!this.v); break;
        case 0x29: this.branch(this.v); break;
        case 0x2a: this.branch(!this.n); break;
        case 0x2b: this.branch(this.n); break;
        case 0x2c: this.branch(!(this.n ^ this.v)); break;
        case 0x2d: this.branch(this.n ^ this.v); break;
        case 0x2e: this.branch(!(this.z | (this.n ^ this.v))); break;
        case 0x2f: this.branch(this.z | (this.n ^ this.v)); break;
        default: throw new Error('bad branch');
      }
      return cyc;
    }

    switch (op) {
      case 0x01: return cyc;
      case 0x06: this.cc = this.a; return cyc;
      case 0x07: this.a = this.cc; return cyc;
      case 0x08: this.x = (this.x + 1) & 0xffff; this.z = this.x === 0 ? 1 : 0; return cyc;
      case 0x09: this.x = (this.x - 1) & 0xffff; this.z = this.x === 0 ? 1 : 0; return cyc;
      case 0x0a: this.v = 0; return cyc;
      case 0x0b: this.v = 1; return cyc;
      case 0x0c: this.c = 0; return cyc;
      case 0x0d: this.c = 1; return cyc;
      case 0x0e: this.i = 0; return cyc;
      case 0x0f: this.i = 1; return cyc;
      case 0x10: this.a = this.sub8(this.a, this.b, 0); return cyc;
      case 0x11: this.sub8(this.a, this.b, 0); return cyc;
      case 0x16: this.b = this.a; this.nz8(this.b); this.v = 0; return cyc;
      case 0x17: this.a = this.b; this.nz8(this.a); this.v = 0; return cyc;
      case 0x19: { // DAA
        let corr = 0;
        const lo = this.a & 15, hiN = this.a >> 4;
        if (this.h || lo > 9) corr |= 0x06;
        if (this.c || hiN > 9 || (hiN > 8 && lo > 9)) corr |= 0x60;
        const r = this.a + corr;
        if (r > 255) this.c = 1;
        this.a = r & 255; this.nz8(this.a);
        return cyc;
      }
      case 0x1b: this.a = this.add8(this.a, this.b, 0); return cyc;
      case 0x30: this.x = (this.sp + 1) & 0xffff; return cyc;
      case 0x31: this.sp = (this.sp + 1) & 0xffff; return cyc;
      case 0x32: this.a = this.pull(); return cyc;
      case 0x33: this.b = this.pull(); return cyc;
      case 0x34: this.sp = (this.sp - 1) & 0xffff; return cyc;
      case 0x35: this.sp = (this.x - 1) & 0xffff; return cyc;
      case 0x36: this.push(this.a); return cyc;
      case 0x37: this.push(this.b); return cyc;
      case 0x39: { const h = this.pull(); this.pc = (h << 8) | this.pull(); return cyc; }
      case 0x3b: { // RTI
        this.cc = this.pull(); this.b = this.pull(); this.a = this.pull();
        const xh = this.pull(); this.x = (xh << 8) | this.pull();
        const ph = this.pull(); this.pc = (ph << 8) | this.pull();
        return cyc;
      }
      case 0x3e: this.halted = true; this.pushState(); return cyc; // WAI
      case 0x3f: this.pushState(); this.i = 1; this.vector(0xfffa); return cyc; // SWI
      default:
    }

    // 0x80-0xFF memory-reference groups
    const mode = (op >> 4) & 3 || 0; // 0 imm, 1 direct, 2 indexed, 3 extended (for 8x/9x/Ax/Bx and Cx..Fx)
    const lo = op & 15;
    const isB = op >= 0xc0;
    const group = op & 0x0f;

    if (op === 0x8d) { const off = this.fetch(); this.push(this.pc); this.push(this.pc >> 8); this.pc = (this.pc + (off < 128 ? off : off - 256)) & 0xffff; return cyc; }
    if (op === 0xad || op === 0xbd) {
      const addr = op === 0xad ? this.ea(2) : this.fetch16();
      this.push(this.pc); this.push(this.pc >> 8); this.pc = addr; return cyc;
    }
    // 16-bit ops
    if (lo === 0xc && !isB) { // CPX
      const m = mode === 0 ? this.fetch16() : this.rd16(this.ea(mode));
      const r = this.x - m;
      this.n = (r >> 15) & 1; this.z = (r & 0xffff) === 0 ? 1 : 0;
      this.v = (((this.x ^ m) & (this.x ^ r)) >> 15) & 1;
      return cyc;
    }
    if (lo === 0xe) { // LDS (8x-Bx) / LDX (Cx-Fx)
      const m = mode === 0 ? this.fetch16() : this.rd16(this.ea(mode));
      if (isB) this.x = m; else this.sp = m;
      this.nz16(m); this.v = 0;
      return cyc;
    }
    if (lo === 0xf && op !== 0x8f && op !== 0xcf) { // STS / STX
      const addr = this.ea(mode);
      const v = isB ? this.x : this.sp;
      this.wr16(addr, v); this.nz16(v); this.v = 0;
      return cyc;
    }

    const acc = isB ? this.b : this.a;
    if (lo === 7) { // STA
      const addr = this.ea(mode);
      this.write(addr, acc); this.nz8(acc); this.v = 0;
      return cyc;
    }
    const m = mode === 0 ? this.fetch() : this.read(this.ea(mode));
    let r;
    switch (group) {
      case 0x0: r = this.sub8(acc, m, 0); break;
      case 0x1: this.sub8(acc, m, 0); return cyc;
      case 0x2: r = this.sub8(acc, m, this.c); break;
      case 0x4: r = acc & m; this.nz8(r); this.v = 0; break;
      case 0x5: this.nz8(acc & m); this.v = 0; return cyc;
      case 0x6: r = m; this.nz8(r); this.v = 0; break;
      case 0x8: r = acc ^ m; this.nz8(r); this.v = 0; break;
      case 0x9: r = this.add8(acc, m, this.c); break;
      case 0xa: r = acc | m; this.nz8(r); this.v = 0; break;
      case 0xb: r = this.add8(acc, m, 0); break;
      default: throw new Error(`unhandled opcode ${op.toString(16)}`);
    }
    if (isB) this.b = r; else this.a = r;
    return cyc;
  }
}
