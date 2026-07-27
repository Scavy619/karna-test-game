/**
 * Procedural sound effects via WebAudio — no audio files needed.
 * Every sound is synthesized (oscillators + noise bursts), which keeps the
 * game fully self-contained. Swap these for real samples later by loading
 * files into buffers and keeping the same play() names.
 */
type SoundName =
  | 'click' | 'chop' | 'pick' | 'rustle' | 'splash' | 'deposit' | 'build'
  | 'complete' | 'research' | 'swordHit' | 'death' | 'spawn' | 'story'
  | 'victory' | 'defeat' | 'ageUp' | 'arrow';

const THROTTLE_MS: Partial<Record<SoundName, number>> = {
  chop: 180, pick: 180, rustle: 180, splash: 200, swordHit: 120, build: 150, arrow: 150,
};

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lastPlay = new Map<string, number>();
  muted = false;

  /** Call once; audio unlocks on the first user click (browser policy). */
  init(): void {
    const unlock = () => {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.35;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  play(name: SoundName): void {
    if (this.muted || !this.ctx || !this.master || this.ctx.state !== 'running') return;
    const now = performance.now();
    const throttle = THROTTLE_MS[name] ?? 60;
    const last = this.lastPlay.get(name) ?? 0;
    if (now - last < throttle) return;
    this.lastPlay.set(name, now);

    const t = this.ctx.currentTime;
    switch (name) {
      case 'click':   this.tone(880, 0.04, 'square', 0.15, t); break;
      case 'chop':    this.noise(0.07, 500, 0.5, t); break;
      case 'pick':    this.noise(0.05, 2400, 0.35, t); this.tone(1300, 0.04, 'sine', 0.1, t); break;
      case 'rustle':  this.noise(0.1, 900, 0.25, t); break;
      case 'splash':  this.noise(0.16, 600, 0.35, t); this.tone(300, 0.12, 'sine', 0.12, t, 180); break;
      case 'deposit': this.tone(660, 0.06, 'sine', 0.2, t); this.tone(880, 0.07, 'sine', 0.2, t + 0.06); break;
      case 'build':   this.noise(0.04, 700, 0.4, t); break;
      case 'complete':
        [523, 659, 784].forEach((f, i) => this.tone(f, 0.14, 'sine', 0.22, t + i * 0.09));
        break;
      case 'research':
        this.tone(880, 0.5, 'sine', 0.2, t);
        this.tone(1760, 0.4, 'sine', 0.08, t);
        break;
      case 'ageUp':
        [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.22, t + i * 0.11));
        break;
      case 'swordHit': this.noise(0.07, 3200, 0.4, t); this.tone(190, 0.08, 'square', 0.12, t); break;
      case 'arrow':    this.noise(0.09, 4500, 0.25, t); this.tone(900, 0.1, 'sine', 0.1, t, 300); break;
      case 'death':    this.tone(300, 0.35, 'sawtooth', 0.15, t, 80); break;
      case 'spawn':    this.tone(440, 0.1, 'sine', 0.2, t, 660); break;
      case 'story':    this.tone(196, 1.0, 'sine', 0.25, t); this.tone(392, 0.8, 'sine', 0.1, t); break;
      case 'victory':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.25, t + i * 0.14));
        break;
      case 'defeat':
        [392, 311, 262].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.2, t + i * 0.2));
        break;
    }
  }

  /** A simple enveloped oscillator. Optional glide to endFreq. */
  private tone(freq: number, dur: number, type: OscillatorType, vol: number, when: number, endFreq?: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), when + dur);
    gain.gain.setValueAtTime(vol, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + dur);
    osc.connect(gain).connect(this.master!);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }

  /** Band-filtered noise burst (chops, hits, splashes). */
  private noise(dur: number, freq: number, vol: number, when: number): void {
    const ctx = this.ctx!;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.value = vol;
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(when);
  }
}

export const Sfx = new SoundEngine();
