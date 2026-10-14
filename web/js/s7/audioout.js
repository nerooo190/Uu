// Plays the emulated sound board through a ring buffer + ScriptProcessor.
export class AudioOut {
  constructor() { this.ctx = null; this.ring = new Float32Array(44100); this.r = 0; this.w = 0; this.fill = 0; this.muted = false; }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ sampleRate: 44100 });
      const node = this.ctx.createScriptProcessor(1024, 0, 1);
      node.onaudioprocess = (e) => {
        const out = e.outputBuffer.getChannelData(0);
        for (let i = 0; i < out.length; i++) {
          if (this.fill > 0 && !this.muted) { out[i] = this.ring[this.r]; this.r = (this.r + 1) % this.ring.length; this.fill--; }
          else out[i] = 0;
        }
      };
      node.connect(this.ctx.destination);
      this.node = node;
    } catch (e) { this.ctx = null; }
  }

  push(samples) {
    if (!this.ctx) return;
    for (let i = 0; i < samples.length; i++) {
      if (this.fill >= this.ring.length) break;
      this.ring[this.w] = Math.max(-1, Math.min(1, samples[i] * 0.8));
      this.w = (this.w + 1) % this.ring.length; this.fill++;
    }
    // keep latency low: drop old audio if the buffer grows beyond ~250 ms
    if (this.fill > 11025) { const drop = this.fill - 4410; this.r = (this.r + drop) % this.ring.length; this.fill -= drop; }
  }
}
