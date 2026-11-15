// Synthesised sound (WebAudio, no files): charge hum, launch whoosh, burst boom, pinch tick.

export class Sfx {
  private master: GainNode;
  private humGain: GainNode;
  private humFilter: BiquadFilterNode;
  private oscs: OscillatorNode[] = [];
  private lfoGain: GainNode;
  private noise: AudioBuffer;
  private muted = false;

  constructor(readonly ctx: AudioContext) {
    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(ctx.destination);

    this.humFilter = ctx.createBiquadFilter();
    this.humFilter.type = 'lowpass';
    this.humFilter.frequency.value = 400;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    this.humFilter.connect(this.humGain).connect(this.master);

    const types: OscillatorType[] = ['sawtooth', 'sine', 'triangle'];
    const detune = [0, 0, 7];
    const mult = [1, 0.5, 2.003];
    types.forEach((type, i) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 80 * mult[i]!;
      o.detune.value = detune[i]!;
      const g = ctx.createGain();
      g.gain.value = type === 'sawtooth' ? 0.35 : 0.5;
      o.connect(g).connect(this.humFilter);
      o.start();
      this.oscs.push(o);
    });
    // slow tremolo
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.5;
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = 0;
    lfo.connect(this.lfoGain).connect(this.humGain.gain);
    lfo.start();

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(m ? 0 : 0.55, t, 0.04);
  }

  resume(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  suspend(): void {
    if (this.ctx.state === 'running') void this.ctx.suspend();
  }

  /** 0..1 charge energy and merge amount: pitch and volume rise with it. */
  setCharge(level: number, merged = 0): void {
    const t = this.ctx.currentTime;
    const f = 70 + level * 85 + merged * 22;
    this.oscs.forEach((o, i) => o.frequency.setTargetAtTime(f * [1, 0.5, 2.003][i]!, t, 0.08));
    this.humFilter.frequency.setTargetAtTime(260 + level * 900, t, 0.1);
    const vol = level < 0.01 ? 0 : 0.03 + 0.07 * level + 0.03 * merged;
    this.humGain.gain.setTargetAtTime(vol, t, 0.1);
    this.lfoGain.gain.setTargetAtTime(vol * 0.18, t, 0.1);
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  whoosh(): void {
    const { ctx } = this;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(260, t);
    bp.frequency.exponentialRampToValueAtTime(3200, t + 0.38);
    const g = ctx.createGain();
    this.env(g, t, 0.5, 0.12, 0.3);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.6);
  }

  boom(power = 1): void {
    const { ctx } = this;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(34, t + 0.55);
    const g = ctx.createGain();
    this.env(g, t, 0.75 * Math.min(1.3, power), 0.006, 0.8);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 1);

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3000, t);
    lp.frequency.exponentialRampToValueAtTime(200, t + 0.5);
    const ng = ctx.createGain();
    this.env(ng, t, 0.4, 0.004, 0.5);
    src.connect(lp).connect(ng).connect(this.master);
    src.start(t);
    src.stop(t + 0.7);
  }

  tick(): void {
    const { ctx } = this;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1100, t);
    o.frequency.exponentialRampToValueAtTime(1900, t + 0.05);
    const g = ctx.createGain();
    this.env(g, t, 0.28, 0.003, 0.07);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.12);
  }

  /** Short descending suck for the fist implosion. */
  implode(): void {
    const { ctx } = this;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.22);
    const g = ctx.createGain();
    this.env(g, t, 0.22, 0.01, 0.22);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.3);
  }

  dispose(): void {
    for (const o of this.oscs) {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
    }
    void this.ctx.close();
  }
}
