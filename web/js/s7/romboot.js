// Boots the System 7 machine from a ROM zip, including the one-time factory
// reset of the CMOS RAM (the ROM asks for the ADVANCE button on first start).
import { unzip, systemSevenRoms } from './rom.js';
import { S7Machine } from './s7machine.js';

export async function loadRoms(zipBytes) {
  const r = systemSevenRoms(await unzip(zipBytes));
  return { ic14: r.ic14, ic17: r.ic17, ic20: r.ic20, ic26: r.ic26, sound12: r.sound12,
    speech4: r.speech4, speech5: r.speech5, speech6: r.speech6, speech7: r.speech7 };
}

export function createMachine(roms, cmos, opts = {}) {
  const m = new S7Machine(roms, { cmos: cmos || undefined, ...opts });
  for (const n of [17, 18, 19]) m.setSwitch(n, true); // three balls in the trough
  m.special.updown = 1;                               // AUTO/UP
  return m;
}

// Generator: yields progress 0..1 while stepping the machine through the first-start test sequence.
export function* factoryInit(m) {
  const run = function* (sec) { for (let f = 0; f < Math.round(60 * sec); f++) { m.runFrame(); m.sound.takeAudio(); if (f % 30 === 0) yield; } };
  yield* run(3);
  const PULSES = 53;
  for (let i = 1; i <= PULSES; i++) {
    m.special.advance = 1; yield* run(0.25);
    m.special.advance = 0; yield* run(0.35);
    yield i / (PULSES + 1);
  }
  yield* run(6);
  m.special.advance = 0;
}

export const cmosToString = (cmos) => btoa(String.fromCharCode(...cmos));
export const cmosFromString = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
