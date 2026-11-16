import type { Era } from '../era/EraSystem';
import type { GameEvent } from '../sim/Game';

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Pip's theme: four bars of eighth notes (0 = rest). One melody, three arrangements. */
const MELODY = [
  76, 79, 84, 83, 81, 79, 76, 79,
  77, 81, 79, 76, 74, 76, 72, 0,
  76, 79, 84, 86, 88, 86, 84, 81,
  79, 81, 77, 74, 72, 0, 74, 76,
];
const MELODY_B = [
  72, 0, 76, 79, 81, 0, 79, 76,
  77, 0, 81, 84, 83, 81, 79, 0,
  81, 0, 84, 81, 79, 76, 77, 79,
  74, 76, 77, 79, 72, 0, 0, 0,
];
const CHORDS = [
  [60, 64, 67],
  [65, 69, 72],
  [69, 72, 76],
  [67, 71, 74],
];
const BASS = [
  [36, 36, 43, 43],
  [41, 41, 48, 41],
  [45, 45, 40, 45],
  [43, 43, 38, 43],
];

/** Neon Verge: the same theme, minor and slow, over a pulsing bass. */
const CITY_CHORDS = [
  [57, 60, 64],
  [53, 57, 60],
  [55, 59, 62],
  [52, 55, 59],
];
const CITY_BASS = [33, 29, 31, 28];

interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  release?: number;
  dest?: AudioNode;
  detune?: number;
  filter?: number;
  q?: number;
  slideTo?: number;
  vibrato?: number;
}

/** Lightweight Web Audio synth: no samples, everything generated. */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicGain!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private sfxGain!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private delay!: DelayNode;
  private delaySend!: GainNode;
  private noise!: AudioBuffer;
  private timer: number | null = null;
  private nextTime = 0;
  private step = 0;
  private bar = 0;
  private loop = 0;
  private tempo = 112;
  era: Era = 0;
  private pendingEra: Era = 0;
  mystery = false;
  menu = false;
  /** Neon Verge arrangement (dark synth) instead of the meadow's. */
  city = false;
  /** 0..1 combat layer: drums and a driving bass come in while hostiles are awake. */
  combat = 0;
  private rainSrc: AudioBufferSourceNode | null = null;
  private rainGain: GainNode | null = null;
  musicVolume = 0.7;
  sfxVolume = 0.8;
  private playing = false;

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 18000;
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.musicVolume * 0.55;
    this.musicGain.connect(this.musicFilter).connect(this.master);
    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = this.sfxVolume * 0.6;
    this.sfxGain.connect(this.master);

    // Reverb from a generated impulse response.
    this.reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.4;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    this.reverb.buffer = ir;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.0;
    this.reverbSend.connect(this.reverb).connect(this.musicFilter);
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = (60 / this.tempo) * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    this.delay.connect(fb).connect(this.delay);
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 0;
    this.delaySend.connect(this.delay).connect(this.musicGain);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  }

  setVolumes(music: number, sfx: number) {
    this.musicVolume = music;
    this.sfxVolume = sfx;
    if (!this.ctx) return;
    this.musicGain.gain.setTargetAtTime(music * 0.55, this.ctx.currentTime, 0.1);
    this.sfxGain.gain.setTargetAtTime(sfx * 0.6, this.ctx.currentTime, 0.05);
  }

  setEra(e: Era) {
    this.pendingEra = e;
    if (!this.playing) this.applyEra(e);
  }

  private applyEra(e: Era) {
    this.era = e;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const reverb = [0, 0.12, 0.22, 0.1, 0.5, 0.8][e];
    const delay = [0, 0.18, 0.06, 0.12, 0.1, 0.16][e];
    this.reverbSend.gain.setTargetAtTime(reverb, t, 0.3);
    this.delaySend.gain.setTargetAtTime(delay, t, 0.3);
  }

  startMusic() {
    if (!this.ctx || this.playing) return;
    this.playing = true;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.bar = 0;
    this.applyEra(this.pendingEra);
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stopMusic() {
    this.playing = false;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  /** Muffle the music briefly (dimension shift). */
  duck(seconds = 1.1) {
    if (!this.ctx) return;
    const f = this.musicFilter.frequency;
    const t = this.ctx.currentTime;
    f.cancelScheduledValues(t);
    f.setValueAtTime(f.value, t);
    f.exponentialRampToValueAtTime(500, t + seconds * 0.45);
    f.exponentialRampToValueAtTime(18000, t + seconds);
  }

  private schedule() {
    const ctx = this.ctx!;
    const stepDur = 60 / this.tempo / 2;
    while (this.nextTime < ctx.currentTime + 0.12) {
      this.playStep(this.nextTime, stepDur);
      this.nextTime += stepDur;
      this.step++;
      if (this.step % 8 === 0) {
        this.bar = (this.bar + 1) % 4;
        if (this.bar === 0) this.loop++;
        if (this.pendingEra !== this.era) this.applyEra(this.pendingEra);
      }
    }
  }

  private playStep(t: number, sd: number) {
    const s = this.step % 8;
    const bar = this.bar;
    const mel = (this.loop % 2 === 1 ? MELODY_B : MELODY)[bar * 8 + s];
    const chord = CHORDS[bar];
    const quiet = this.menu ? 0.8 : 1;
    const lead = this.mystery ? 0 : quiet;
    const dest = this.musicGain;
    if (this.city) {
      this.playCity(t, sd, s, bar, mel, lead, dest);
      return;
    }
    void chord;
    switch (this.era) {
      case 0: {
        // Three channels, like the first consoles: pulse lead, triangle bass, noise.
        if (mel) this.tone(t, mtof(mel), sd * 0.85, { type: 'square', gain: 0.06 * lead, release: 0.03, dest });
        if (s % 2 === 0) this.tone(t, mtof(BASS[bar][s / 2]), sd * 1.7, { type: 'triangle', gain: 0.18, release: 0.03, dest });
        if (s === 0 || s === 4) this.noiseHit(t, 0.09, 0.09, 'lowpass', 900, dest);
        else if (s % 2 === 1) this.hat(t, 0.025, 7000, dest);
        break;
      }
      case 1: {
        if (mel) {
          this.tone(t, mtof(mel), sd * 0.95, { type: 'sawtooth', gain: 0.045 * lead, filter: 2600, attack: 0.01, release: 0.08, dest, vibrato: 5 });
          this.tone(t, mtof(mel), sd * 0.95, { type: 'sawtooth', gain: 0.03 * lead, filter: 2600, detune: 9, release: 0.08, dest: this.delaySend });
        }
        if (s % 2 === 0) this.tone(t, mtof(BASS[bar][s / 2]), sd * 1.8, { type: 'sawtooth', gain: 0.1, filter: 520, q: 4, release: 0.05, dest });
        if (s === 0) for (const n of chord) this.tone(t, mtof(n), sd * 7.5, { type: 'triangle', gain: 0.02, attack: 0.08, release: 0.3, dest });
        if (s === 0 || s === 4) this.kick(t, 0.5, dest);
        if (s === 2 || s === 6) this.snare(t, 0.12, dest);
        this.hat(t, s % 2 ? 0.03 : 0.015, 9000, dest);
        break;
      }
      case 2: {
        // Early 3D: FM bells, slap bass, a band-limited cartridge sound.
        if (mel) this.fm(t, mtof(mel), sd * 1.4, 3.5, 2.2, 0.05 * lead, this.delaySend);
        if (mel) this.fm(t, mtof(mel), sd * 1.2, 3.5, 2.2, 0.04 * lead, dest);
        if (s % 2 === 0) {
          this.tone(t, mtof(BASS[bar][s / 2]), sd * 0.9, { type: 'square', gain: 0.07, filter: 700, q: 6, release: 0.06, dest, slideTo: mtof(BASS[bar][s / 2]) * 0.98 });
        }
        if (s === 0 || s === 4) for (const n of chord) this.tone(t, mtof(n), sd * 3.6, { type: 'triangle', gain: 0.012, filter: 1800, attack: 0.03, release: 0.2, dest });
        if (s === 0 || s === 3 || s === 4) this.kick(t, 0.4, dest);
        if (s === 2 || s === 6) this.snare(t, 0.09, dest);
        if (s % 2 === 1) this.hat(t, 0.02, 6000, dest);
        break;
      }
      case 3: {
        // Stylized: marimba + pizzicato with a swing feel, a bouncy cartoon groove.
        const swing = s % 2 === 1 ? sd * 0.2 : 0;
        const tt = t + swing;
        if (mel) {
          this.tone(tt, mtof(mel), sd * 0.7, { type: 'sine', gain: 0.07 * lead, release: 0.18, dest });
          this.tone(tt, mtof(mel) * 4, sd * 0.15, { type: 'sine', gain: 0.012 * lead, release: 0.05, dest });
        }
        if (s % 2 === 0) this.tone(tt, mtof(BASS[bar][s / 2]), sd * 0.6, { type: 'triangle', gain: 0.16, release: 0.1, dest, filter: 900 });
        const pz = chord[(s + bar) % 3] + 12;
        if (s % 2 === 1) this.tone(tt, mtof(pz), sd * 0.25, { type: 'sawtooth', gain: 0.018, filter: 1600, release: 0.08, dest });
        if (s === 0 || s === 4) this.kick(tt, 0.32, dest);
        if (s === 2 || s === 6) this.noiseHit(tt, 0.06, 0.06, 'highpass', 3000, dest);
        if (s === 7) this.tone(tt, 1200, 0.05, { type: 'sine', gain: 0.03, slideTo: 2200, dest });
        break;
      }
      case 4: {
        if (s === 0) {
          for (const n of chord) {
            for (const d of [-7, 7]) this.tone(t, mtof(n - 12), sd * 8.2, { type: 'sawtooth', gain: 0.012, filter: 1100, attack: 0.5, release: 1.2, detune: d, dest });
          }
          this.tone(t, mtof(BASS[bar][0] - 12), sd * 7.8, { type: 'sine', gain: 0.16, attack: 0.05, release: 0.5, dest });
        }
        // plucked arpeggio into the reverb
        const arp = chord[(s * 2) % 3] + (s % 4 === 3 ? 24 : 12);
        this.tone(t, mtof(arp), sd * 0.6, { type: 'triangle', gain: 0.03, release: 0.25, dest: this.reverbSend });
        this.tone(t, mtof(arp), sd * 0.5, { type: 'triangle', gain: 0.022, release: 0.2, dest });
        if (mel && s % 2 === 0) {
          this.tone(t, mtof(mel), sd * 1.9, { type: 'sine', gain: 0.05 * lead, attack: 0.03, release: 0.4, dest, vibrato: 4 });
          this.tone(t, mtof(mel + 12), sd * 1.9, { type: 'triangle', gain: 0.012 * lead, attack: 0.05, release: 0.4, dest: this.reverbSend });
        }
        if (!this.mystery && (s === 0 || s === 5)) this.kick(t, 0.35, dest);
        if (!this.mystery && (s === 2 || s === 6)) this.snare(t, 0.05, this.reverbSend);
        if (s % 2 === 1) this.hat(t, 0.012, 11000, dest);
        if (this.mystery && s === 0 && bar % 2 === 0) this.tone(t, mtof(33), sd * 16, { type: 'sine', gain: 0.12, attack: 1, release: 2, dest });
        break;
      }
      case 5: {
        // Beyond: cinematic pads, sub, shimmer and a sparse piano-like lead in a vast space.
        if (s === 0) {
          for (const n of chord) {
            for (const d of [-9, 0, 9]) this.tone(t, mtof(n - 12), sd * 8.4, { type: 'sawtooth', gain: 0.008, filter: 760, attack: 1.2, release: 1.8, detune: d, dest });
          }
          this.tone(t, mtof(BASS[bar][0] - 24), sd * 8, { type: 'sine', gain: 0.2, attack: 0.3, release: 1.0, dest });
          this.tone(t, mtof(chord[2] + 24), sd * 8, { type: 'sine', gain: 0.012, attack: 1.5, release: 2, dest: this.reverbSend, vibrato: 3 });
        }
        if (mel && s % 4 === 0) {
          this.tone(t, mtof(mel), sd * 3.6, { type: 'triangle', gain: 0.045 * lead, attack: 0.004, release: 1.2, dest: this.reverbSend });
          this.tone(t, mtof(mel), sd * 2.4, { type: 'sine', gain: 0.04 * lead, attack: 0.004, release: 0.9, dest });
          this.tone(t, mtof(mel + 12), sd * 1.2, { type: 'sine', gain: 0.008 * lead, attack: 0.004, release: 0.6, dest });
        }
        if (s % 2 === 1) this.tone(t, mtof(chord[(s >> 1) % 3] + 36), sd * 0.4, { type: 'sine', gain: 0.006, release: 0.6, dest: this.reverbSend });
        if (!this.mystery && s === 0 && bar % 2 === 0) this.kick(t, 0.28, dest);
        if (s === 4) this.noiseHit(t, 0.5, 0.012, 'highpass', 8000, this.reverbSend);
        break;
      }
    }
  }

  /** Dark synth: detuned pads, a 16th-note bass pulse, the theme in a minor key, gated drums in combat. */
  private playCity(t: number, sd: number, s: number, bar: number, mel: number, lead: number, dest: AudioNode) {
    const chord = CITY_CHORDS[bar];
    const root = CITY_BASS[bar];
    const c = this.combat;
    if (s === 0) {
      for (const n of chord) for (const d of [-12, 0, 12]) this.tone(t, mtof(n - 12), sd * 8.3, { type: 'sawtooth', gain: 0.007, filter: 900, attack: 0.9, release: 1.4, detune: d, dest });
      this.tone(t, mtof(root - 12), sd * 8, { type: 'sine', gain: 0.18, attack: 0.1, release: 0.8, dest });
    }
    // 16th bass pulse: two per eighth
    const bassGain = 0.05 + c * 0.05;
    this.tone(t, mtof(root), sd * 0.4, { type: 'sawtooth', gain: bassGain, filter: 380 + c * 600, q: 6, release: 0.03, dest });
    this.tone(t + sd / 2, mtof(root + (s % 4 === 3 ? 12 : 0)), sd * 0.4, { type: 'sawtooth', gain: bassGain * 0.8, filter: 380 + c * 600, q: 6, release: 0.03, dest });
    // the theme, flattened into minor, sparse and far away
    if (mel && s % 2 === 0 && lead > 0) {
      const m = mel - 12 - ([64, 69, 71, 76, 81, 83].includes(mel - 12) ? 1 : 0);
      this.tone(t, mtof(m), sd * 1.6, { type: 'sawtooth', gain: 0.022, filter: 1800, attack: 0.02, release: 0.3, dest: this.delaySend, vibrato: 4 });
      this.tone(t, mtof(m), sd * 1.6, { type: 'triangle', gain: 0.03, attack: 0.02, release: 0.3, dest });
    }
    // arpeggio glints into the reverb
    if (s % 2 === 1) this.tone(t, mtof(chord[(s >> 1) % 3] + 24), sd * 0.3, { type: 'square', gain: 0.008, filter: 3000, release: 0.2, dest: this.reverbSend });
    if (c > 0.05) {
      if (s % 2 === 0) this.kick(t, 0.45 * c, dest);
      if (s === 2 || s === 6) this.snare(t, 0.11 * c, this.reverbSend);
      this.hat(t, 0.02 * c, 9000, dest);
      this.hat(t + sd / 2, 0.012 * c, 11000, dest);
    } else if (s === 0 && bar % 2 === 0) {
      this.kick(t, 0.2, dest);
    }
  }

  /** Rain and distant city hum, looped. */
  setRain(on: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (on && !this.rainSrc) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2400;
      bp.Q.value = 0.4;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 7000;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setTargetAtTime(0.11, ctx.currentTime, 1.2);
      src.connect(bp).connect(lp).connect(g).connect(this.sfxGain);
      src.start();
      this.rainSrc = src;
      this.rainGain = g;
    } else if (!on && this.rainSrc) {
      const src = this.rainSrc;
      this.rainGain!.gain.setTargetAtTime(0, ctx.currentTime, 0.6);
      window.setTimeout(() => src.stop(), 3000);
      this.rainSrc = null;
      this.rainGain = null;
    }
  }

  /** Muffle the music inside a Regress bubble. */
  setBubble(era: number) {
    if (!this.ctx) return;
    const f = this.musicFilter.frequency;
    f.setTargetAtTime(era < 0 ? 18000 : [1400, 2600, 4000, 6000, 12000, 18000][era] ?? 18000, this.ctx.currentTime, 0.15);
  }

  private tone(t: number, freq: number, dur: number, o: ToneOpts = {}) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slideTo), t + dur);
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    const peak = o.gain ?? 0.1;
    const atk = o.attack ?? 0.005;
    const rel = o.release ?? 0.05;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + atk);
    g.gain.setValueAtTime(peak, t + Math.max(atk, dur - rel));
    g.gain.linearRampToValueAtTime(0, t + dur + rel);
    let node: AudioNode = osc;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.filter;
      f.Q.value = o.q ?? 0.7;
      node.connect(f);
      node = f;
    }
    if (o.vibrato) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = o.vibrato;
      lg.gain.value = freq * 0.006;
      lfo.connect(lg).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + dur + rel + 0.05);
    }
    node.connect(g).connect(o.dest ?? this.sfxGain);
    osc.start(t);
    osc.stop(t + dur + rel + 0.05);
  }

  /** Two-operator FM voice (early-3D bells). */
  private fm(t: number, freq: number, dur: number, ratio: number, index: number, gain: number, dest: AudioNode) {
    const ctx = this.ctx!;
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const mg = ctx.createGain();
    const g = ctx.createGain();
    car.frequency.value = freq;
    mod.frequency.value = freq * ratio;
    mg.gain.setValueAtTime(freq * index, t);
    mg.gain.exponentialRampToValueAtTime(freq * 0.2, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    mod.connect(mg).connect(car.frequency);
    car.connect(g).connect(dest);
    car.start(t);
    mod.start(t);
    car.stop(t + dur + 0.05);
    mod.stop(t + dur + 0.05);
  }

  private noiseHit(t: number, dur: number, gain: number, filterType: BiquadFilterType, freq: number, dest: AudioNode, q = 1, sweepTo?: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private hat(t: number, gain: number, freq: number, dest: AudioNode) {
    this.noiseHit(t, 0.04, gain, 'highpass', freq, dest);
  }
  private snare(t: number, gain: number, dest: AudioNode) {
    this.noiseHit(t, 0.16, gain, 'bandpass', 1800, dest, 0.8);
    this.tone(t, 190, 0.06, { type: 'triangle', gain: gain * 0.8, dest, release: 0.04 });
  }
  private kick(t: number, gain: number, dest: AudioNode, chip = false) {
    this.tone(t, chip ? 120 : 150, 0.14, { type: chip ? 'square' : 'sine', gain: gain * (chip ? 0.25 : 1), slideTo: 45, release: 0.05, dest });
  }

  // ------------------------------------------------------------------ SFX

  sfx(name: string, value = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.005;
    const d = this.sfxGain;
    const wave: OscillatorType = (['square', 'sawtooth', 'triangle', 'triangle', 'sine', 'sine'] as const)[this.era];
    const soft = this.era >= 4;
    switch (name) {
      case 'jump':
        this.tone(t, 330, 0.13, { type: soft ? 'triangle' : 'square', gain: soft ? 0.12 : 0.06, slideTo: 760, filter: soft ? 3000 : undefined, dest: d });
        if (soft) this.tone(t, 180, 0.12, { type: 'sine', gain: 0.07, slideTo: 420, dest: d });
        break;
      case 'land':
        this.noiseHit(t, 0.09, 0.06 + Math.min(0.12, value * 0.005), 'lowpass', 900, d);
        if (value > 18) this.tone(t, 110, 0.1, { type: 'sine', gain: 0.12, slideTo: 60, dest: d });
        break;
      case 'step':
        this.noiseHit(t, 0.03, 0.025, 'bandpass', soft ? 2500 : 4000, d, 2);
        break;
      case 'collect': {
        const base = 84 + ((value % 5) as number);
        this.tone(t, mtof(base), 0.06, { type: wave === 'sawtooth' ? 'square' : wave, gain: 0.07, filter: 6000, dest: d });
        this.tone(t + 0.06, mtof(base + 7), 0.12, { type: wave === 'sawtooth' ? 'square' : wave, gain: 0.07, filter: 6000, dest: d });
        if (soft) this.tone(t + 0.06, mtof(base + 19), 0.25, { type: 'sine', gain: 0.03, dest: this.reverbSend });
        break;
      }
      case 'stomp':
        this.tone(t, 500, 0.12, { type: 'square', gain: 0.06, slideTo: 120, dest: d });
        this.noiseHit(t, 0.12, 0.1, 'lowpass', 1500, d);
        break;
      case 'hurt':
        this.tone(t, 420, 0.25, { type: 'sawtooth', gain: 0.06, slideTo: 140, filter: 2000, dest: d, vibrato: 18 });
        break;
      case 'shift': {
        const up = value > 0;
        this.noiseHit(t, 1.0, 0.12, 'bandpass', up ? 300 : 3000, d, 3, up ? 3000 : 300);
        for (let i = 0; i < 6; i++) {
          const n = up ? 72 + i * 4 : 96 - i * 4;
          this.tone(t + i * 0.09, mtof(n), 0.18, { type: 'sine', gain: 0.04, release: 0.15, dest: this.reverbSend });
          this.tone(t + i * 0.09, mtof(n), 0.12, { type: 'triangle', gain: 0.025, dest: d });
        }
        this.tone(t, up ? 80 : 160, 1.0, { type: 'sine', gain: 0.12, slideTo: up ? 160 : 70, attack: 0.1, release: 0.3, dest: d });
        this.duck();
        break;
      }
      case 'fizzle':
        this.tone(t, 220, 0.18, { type: 'square', gain: 0.04, slideTo: 90, filter: 1200, dest: d, vibrato: 30 });
        break;
      case 'era':
        for (let i = 0; i < 10; i++) this.tone(t + i * 0.07, mtof(60 + [0, 4, 7, 12, 16, 19, 24, 28, 31, 36][i]), 0.4, { type: 'triangle', gain: 0.045, release: 0.3, dest: this.reverbSend });
        this.noiseHit(t, 2.0, 0.05, 'bandpass', 400, d, 2, 6000);
        break;
      case 'shard':
      case 'device':
        for (let i = 0; i < 5; i++) this.tone(t + i * 0.1, mtof(72 + [0, 7, 12, 16, 19][i]), 0.5, { type: 'sine', gain: 0.06, release: 0.4, dest: d });
        break;
      case 'plate':
        this.tone(t, 70, 0.4, { type: 'sine', gain: 0.25, slideTo: 40, dest: d });
        this.noiseHit(t, 0.3, 0.15, 'lowpass', 500, d);
        break;
      case 'plank':
        this.tone(t, mtof(72 + value * 2), 0.18, { type: 'triangle', gain: 0.05, release: 0.2, dest: d });
        this.noiseHit(t, 0.06, 0.05, 'lowpass', 1200, d);
        break;
      case 'bridge':
        this.noiseHit(t, 2.6, 0.08, 'lowpass', 200, d, 1, 900);
        break;
      case 'bridgeDone':
        for (const [i, n] of [72, 76, 79, 84].entries()) this.tone(t + i * 0.08, mtof(n), 0.6, { type: 'triangle', gain: 0.06, release: 0.4, dest: d });
        this.tone(t, 55, 0.5, { type: 'sine', gain: 0.25, slideTo: 40, dest: d });
        break;
      case 'checkpoint':
        for (const [i, n] of [72, 76, 79, 84, 88].entries()) this.tone(t + i * 0.07, mtof(n), 0.3, { type: wave === 'sawtooth' ? 'square' : wave, gain: 0.05, filter: 5000, release: 0.2, dest: d });
        break;
      case 'gate':
        for (let i = 0; i < 14; i++) this.tone(t + i * 0.06, mtof(55 + i * 3), 1.4, { type: 'sine', gain: 0.035, release: 1.2, dest: this.reverbSend });
        this.noiseHit(t, 3.0, 0.08, 'bandpass', 200, d, 2, 9000);
        this.tone(t, 40, 3, { type: 'sine', gain: 0.3, slideTo: 80, attack: 0.5, release: 1, dest: d });
        break;
      case 'lamp':
        this.tone(t, 220, 0.6, { type: 'sine', gain: 0.1, slideTo: 880, dest: d });
        for (const [i, n] of [76, 79, 83, 88].entries()) this.tone(t + 0.3 + i * 0.09, mtof(n), 0.5, { type: 'triangle', gain: 0.05, release: 0.4, dest: this.reverbSend });
        break;
      case 'stairDone':
        for (const [i, n] of [72, 74, 76, 79, 81, 84].entries()) this.tone(t + i * 0.07, mtof(n), 0.35, { type: wave, gain: 0.05, filter: 5000, release: 0.25, dest: d });
        break;
      case 'finale':
        for (const [i, n] of [60, 64, 67, 72, 76, 79, 84].entries()) this.tone(t + i * 0.12, mtof(n), 1.2, { type: 'triangle', gain: 0.05, release: 0.8, dest: this.reverbSend });
        break;
      case 'push':
        this.noiseHit(t, 0.2, 0.05, 'lowpass', 300, d);
        break;
      case 'cubeReset':
        this.tone(t, 900, 0.3, { type: 'sine', gain: 0.06, slideTo: 300, dest: d });
        break;
      case 'antenna':
        this.tone(t, 1800, 0.05, { type: 'square', gain: 0.02, slideTo: 2600, dest: d });
        this.tone(t + 0.06, 1500, 0.05, { type: 'square', gain: 0.02, slideTo: 900, dest: d });
        break;
      case 'pixel':
        this.tone(t, 1760, 0.05, { type: 'square', gain: 0.03, dest: d });
        break;
      case 'beam':
        this.tone(t, 200, 1.0, { type: 'sawtooth', gain: 0.05, slideTo: 1600, filter: 2400, dest: d });
        break;
      case 'assemble':
        for (let i = 0; i < 8; i++) this.tone(t + i * 0.05, mtof(60 + i * 3), 0.07, { type: 'square', gain: 0.035, dest: d });
        break;
      case 'awake':
        this.tone(t, mtof(79), 0.08, { type: 'square', gain: 0.04, dest: d });
        this.tone(t + 0.1, mtof(84), 0.14, { type: 'square', gain: 0.04, dest: d });
        break;
      case 'hover':
        this.tone(t, 1320, 0.03, { type: 'triangle', gain: 0.025, dest: d });
        break;
      case 'click':
        this.tone(t, 880, 0.05, { type: 'square', gain: 0.03, slideTo: 1320, dest: d });
        break;
      case 'banner':
        this.tone(t, mtof(84), 0.1, { type: 'triangle', gain: 0.04, dest: d });
        this.tone(t + 0.1, mtof(91), 0.2, { type: 'triangle', gain: 0.04, dest: d });
        break;
      // --- the city
      case 'shot':
        this.noiseHit(t, 0.07, 0.12, 'bandpass', 2600, d, 1.4, 900);
        this.tone(t, 900, 0.07, { type: 'sawtooth', gain: 0.06, slideTo: 180, filter: 4000, dest: d });
        this.tone(t, 70, 0.08, { type: 'sine', gain: 0.12, slideTo: 40, dest: d });
        break;
      case 'charged':
        this.noiseHit(t, 0.35, 0.2, 'lowpass', 5000, d, 1, 300);
        this.tone(t, 1600, 0.3, { type: 'sawtooth', gain: 0.08, slideTo: 90, filter: 6000, dest: d });
        this.tone(t, 55, 0.4, { type: 'sine', gain: 0.25, slideTo: 30, dest: d });
        break;
      case 'enemyShot':
        this.tone(t, 1400, 0.09, { type: 'square', gain: 0.025, slideTo: 500, filter: 3000, dest: d });
        break;
      case 'hit':
        this.noiseHit(t, 0.05, 0.08, 'highpass', 3000, d);
        this.tone(t, 2200, 0.03, { type: 'square', gain: 0.03, dest: d });
        break;
      case 'shieldHit':
        this.tone(t, 300, 0.12, { type: 'sine', gain: 0.07, slideTo: 600, dest: d, vibrato: 30 });
        break;
      case 'armorHit':
        this.tone(t, 2800, 0.08, { type: 'triangle', gain: 0.05, dest: d });
        this.tone(t, 3900, 0.06, { type: 'triangle', gain: 0.03, dest: d });
        break;
      case 'enemyDown':
        this.noiseHit(t, value ? 1.4 : 0.45, value ? 0.35 : 0.18, 'lowpass', 3000, d, 1, 120);
        this.tone(t, 160, value ? 1 : 0.3, { type: 'sawtooth', gain: 0.1, slideTo: 30, filter: 1200, dest: d });
        for (let i = 0; i < 4; i++) this.tone(t + 0.05 + i * 0.04, mtof(96 - i * 5), 0.04, { type: 'square', gain: 0.02, dest: d });
        break;
      case 'overheat':
        this.noiseHit(t, 1.2, 0.08, 'highpass', 4000, d, 1, 900);
        this.tone(t, 800, 0.25, { type: 'square', gain: 0.03, slideTo: 200, dest: d });
        break;
      case 'vented':
        this.tone(t, mtof(79), 0.06, { type: 'sine', gain: 0.05, dest: d });
        this.tone(t + 0.07, mtof(86), 0.1, { type: 'sine', gain: 0.05, dest: d });
        break;
      case 'boltFizzle':
        this.tone(t, 600, 0.12, { type: 'square', gain: 0.03, slideTo: 80, dest: d });
        break;
      case 'slam':
        this.tone(t, 70, 0.6, { type: 'sine', gain: 0.4, slideTo: 25, dest: d });
        this.noiseHit(t, 0.6, 0.3, 'lowpass', 1200, d, 1, 100);
        break;
      case 'pulse':
        this.tone(t, 200, 0.8, { type: 'sawtooth', gain: 0.08, slideTo: 2000, filter: 3000, dest: d });
        break;
      case 'telegraph':
        this.tone(t, 1800, 0.25, { type: 'sine', gain: 0.025, slideTo: 2600, dest: d });
        break;
      case 'dash':
        this.noiseHit(t, 0.22, 0.12, 'bandpass', 900, d, 1, 4000);
        break;
      case 'bubbleOn':
        this.tone(t, 900, 0.35, { type: wave, gain: 0.06, slideTo: 220, filter: 3000, dest: d });
        this.tone(t, 450, 0.35, { type: 'sine', gain: 0.06, slideTo: 110, dest: d });
        break;
      case 'bubbleOff':
      case 'bubblePop':
        this.tone(t, 220, 0.3, { type: 'sine', gain: 0.06, slideTo: 900, dest: d });
        break;
      case 'line':
        this.tone(t, value === 1 ? mtof(67) : value === 2 ? mtof(88) : mtof(76), 0.05, { type: this.city ? 'sine' : wave, gain: 0.025, dest: d });
        break;
      case 'domeCrack':
        this.noiseHit(t, 1.6, 0.3, 'highpass', 1500, d, 1, 8000);
        for (let i = 0; i < 8; i++) this.tone(t + i * 0.07, 3000 + Math.random() * 3000, 0.05, { type: 'triangle', gain: 0.03, dest: d });
        break;
      case 'zone':
        this.tone(t, 40, 2.5, { type: 'sine', gain: 0.3, attack: 0.3, release: 1.5, dest: d });
        this.noiseHit(t, 2.5, 0.12, 'lowpass', 400, d, 1, 3000);
        break;
      case 'emitter':
        for (let i = 0; i < 5; i++) this.tone(t + i * 0.06, 200 + i * 160, 0.08, { type: 'sawtooth', gain: 0.04, filter: 2000, dest: d });
        this.tone(t + 0.35, 55, 0.6, { type: 'sine', gain: 0.25, dest: d });
        break;
      case 'pickup':
        this.tone(t, mtof(72), 0.08, { type: 'sine', gain: 0.06, dest: d });
        this.tone(t + 0.08, mtof(79), 0.14, { type: 'sine', gain: 0.06, dest: d });
        break;
      case 'shutter':
        this.noiseHit(t, 1.6, 0.12, 'lowpass', 600, d, 2);
        this.tone(t, 90, 1.5, { type: 'sawtooth', gain: 0.04, filter: 300, slideTo: 130, dest: d });
        break;
      case 'codeRead':
        for (let i = 0; i < 4; i++) this.tone(t + i * 0.09, mtof(84 + (i % 2) * 7), 0.06, { type: 'square', gain: 0.025, filter: 4000, dest: d });
        break;
      case 'door':
        this.tone(t, 60, 1.2, { type: 'sawtooth', gain: 0.06, filter: 400, slideTo: 40, dest: d });
        this.noiseHit(t, 1.2, 0.08, 'bandpass', 800, d, 1, 200);
        break;
      case 'coreChoice':
        for (const [i, n] of [60, 64, 67, 72, 76, 79].entries()) this.tone(t + i * 0.12, mtof(n), 2.5, { type: 'sine', gain: 0.05, attack: 0.05, release: 1.5, dest: d });
        break;
    }
  }

  /** Maps game events to sounds. */
  handle(e: GameEvent) {
    switch (e.type) {
      case 'jump':
      case 'land':
      case 'step':
      case 'collect':
      case 'stomp':
      case 'hurt':
      case 'fizzle':
      case 'shard':
      case 'device':
      case 'plate':
      case 'checkpoint':
      case 'finale':
      case 'cubeReset':
      case 'antenna':
      case 'assemble':
      case 'awake':
      case 'banner':
      case 'gate':
      case 'lamp':
      case 'stairDone':
        this.sfx(e.type, e.value ?? 0);
        break;
      case 'pushStart':
        this.sfx('push');
        break;
      case 'shiftStart':
        this.sfx('shift', e.text === '3d' ? 1 : -1);
        break;
      case 'eraStart':
        this.sfx('era');
        this.setEra((e.value ?? 0) as Era);
        break;
      case 'bridgeStart':
        this.sfx('bridge');
        for (let i = 0; i < 8; i++) window.setTimeout(() => this.sfx('plank', i), (0.25 + i * 0.24 + 0.85) * 1000 - 350);
        break;
      case 'bridgeDone':
        this.sfx('bridgeDone');
        break;
      case 'pixelBlink':
        this.sfx('pixel');
        break;
      case 'machineBeam':
        this.sfx('beam');
        break;
      case 'dash':
      case 'bubbleOn':
      case 'bubbleOff':
      case 'bubblePop':
      case 'domeCrack':
      case 'zone':
      case 'emitter':
      case 'pickup':
      case 'shutter':
      case 'codeRead':
      case 'door':
      case 'coreChoice':
        this.sfx(e.type);
        break;
      case 'line':
        this.sfx('line', e.text === 'PIP' ? 1 : e.text === 'SYSTEM' ? 2 : 0);
        break;
      case 'combat':
        if (e.combat === 'enemyDown') this.sfx('enemyDown', e.text === 'warden' ? 1 : 0);
        else if (e.combat === 'playerHit') this.sfx('hurt');
        else if (e.combat) this.sfx(e.combat === 'impact' ? 'hit' : e.combat);
        break;
    }
  }
}

export const audio = new AudioEngine();
