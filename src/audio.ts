/**
 * Procedural piano-like tone (no audio files). Each pluck is a short hammer noise plus
 * slightly inharmonic partials that decay like a struck string — "物理定音合成", default piano timbre.
 *
 * Everything goes through one master gain and a gentle compressor so loud moments can't clip.
 * Level target: p90 about -29 dBFS while the bot is plucking (measure with `npm run loud`).
 */
export class Sound {
  /** Master gain while unmuted. Tuned so bot recitals sit near -29 dBFS p90. */
  static GAIN = 0.32;
  ctx: AudioContext | null = null;
  private master!: GainNode;
  muted = false;
  /** Incremented every time a note is started; used by tests and the loudness hook. */
  notes = 0;
  lastHz = 0;

  /** Call from a click or key press (browsers block audio until then). Safe to call again. */
  start() {
    if (this.ctx) { void this.ctx.resume(); return; }
    try { this.ctx = new AudioContext(); } catch { return; }
    const ctx = this.ctx;
    this.master = new GainNode(ctx, { gain: this.muted ? 0 : Sound.GAIN });
    this.master.connect(new DynamicsCompressorNode(ctx, { threshold: -18, ratio: 3.5, knee: 8, attack: 0.003, release: 0.18 })).connect(ctx.destination);
  }

  /**
   * Pluck a string at `hz`. `strength` 0..1 scales loudness and a little of the hammer.
   * Lower notes ring longer.
   */
  pluck(hz: number, strength = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const freq = Math.max(40, Math.min(4000, hz));
    const dur = Math.min(3.6, 0.45 + 220 / freq);
    const amp = 0.22 * Math.max(0.35, Math.min(1.2, strength));
    this.notes++;
    this.lastHz = freq;

    // hammer: a brief filtered noise burst
    const nLen = Math.floor(ctx.sampleRate * 0.03);
    const buf = ctx.createBuffer(1, nLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < nLen; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / nLen);
    const noise = new AudioBufferSourceNode(ctx, { buffer: buf });
    const ng = new GainNode(ctx, { gain: 0 });
    const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: Math.min(4000, freq * 4), Q: 0.7 });
    noise.connect(bp).connect(ng).connect(this.master);
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.18 * amp, t + 0.004);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    noise.start(t); noise.stop(t + 0.06);

    // inharmonic partials (piano strings are slightly stiff)
    const B = 0.00035;
    const partials = 8;
    for (let n = 1; n <= partials; n++) {
      const fn = freq * n * Math.sqrt(1 + B * n * n);
      if (fn > 14000) break;
      const g = new GainNode(ctx, { gain: 0 });
      const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 9000 - n * 700, Q: 0.4 });
      const type: OscillatorType = n === 1 ? 'triangle' : 'sine';
      const o = new OscillatorNode(ctx, { type, frequency: fn });
      o.connect(g).connect(lp).connect(this.master);
      const peak = amp * (n === 1 ? 0.55 : 0.42 / (n * Math.sqrt(n)));
      const decay = dur * (n === 1 ? 1 : 0.55 / Math.sqrt(n));
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.start(t); o.stop(t + decay + 0.05);
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : Sound.GAIN, this.ctx.currentTime, 0.05);
  }
}
