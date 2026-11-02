import { MAX_VOICES, type SfxId } from './sfx-registry';
import { MUSIC_TRACKS, SFX_SAMPLES, audioUrl, type MusicTrack } from './assets';

/**
 * Web Audio engine (Tech §9.9): Master → Music / SFX / UI / Ambience buses, voice limits,
 * ±5% pitch & ±2 dB variation, stereo pan, ducking, and adaptive music crossfaded over 1.5 s.
 *
 * Sounds come from recorded CC0 assets (src/audio/assets.ts, credits in public/audio/CREDITS.md),
 * loaded lazily after the first user gesture. Until they arrive — or if a file fails to load —
 * the original procedural synth (SFX + 3-layer generative score) plays instead, so the game is
 * never silent and works offline from a bare dist/ folder.
 */
type Bus = 'music' | 'sfx' | 'ui' | 'ambience';

const UI_SFX = new Set<SfxId>(['click', 'hover', 'illegal', 'coin']);

/** Ducking applied when these play (−dB, seconds). */
const DUCK: Partial<Record<SfxId, [number, number]>> = {
  coreHit: [4, 0.4], waveStart: [5, 1.6], waveClear: [6, 1.2], victory: [8, 3.5], defeat: [8, 3],
};

/** A decoded sample with its leading/trailing silence trimmed off (MP3 encoder padding, fades). */
interface Clip { buf: AudioBuffer; start: number; end: number }

function trimmed(buf: AudioBuffer, threshold = 0.002): Clip {
  const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  const loud = (i: number) => chans.some((d) => Math.abs(d[i]!) > threshold);
  let a = 0;
  while (a < buf.length - 1 && !loud(a)) a++;
  let b = buf.length - 1;
  while (b > a && !loud(b)) b--;
  return { buf, start: a / buf.sampleRate, end: (b + 1) / buf.sampleRate };
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses!: Record<Bus, GainNode>;
  private duck!: GainNode;
  /** SFX-volume path that bypasses the duck, so stingers don't duck themselves. */
  private stinger!: GainNode;
  private noiseBuf!: AudioBuffer;
  private voices = new Map<SfxId, number>();
  private layers!: { base: GainNode; combat: GainNode; tension: GainNode };
  private schedTimer: ReturnType<typeof setInterval> | null = null;
  private nextBeat = 0;
  private beat = 0;
  private volumes = { master: 0.8, music: 0.55, sfx: 0.8, ui: 0.7, ambience: 0.6 };
  private ambienceStarted = false;
  private assetsRequested = false;
  private samples = new Map<SfxId, { clips: Clip[]; gain: number; vary: boolean }>();
  private tracks: Partial<Record<MusicTrack, Clip>> = {};
  private trackGain!: Record<MusicTrack, GainNode>;
  private trackSrc: Partial<Record<MusicTrack, AudioBufferSourceNode>> = {};
  private recordedMusic = false;
  musicState: 'prepare' | 'combat' | 'tension' | 'silent' = 'silent';

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const c = this.ctx;
      this.master = c.createGain();
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.2;
      this.master.connect(comp).connect(c.destination);
      this.duck = c.createGain();
      this.duck.connect(this.master);
      this.buses = { music: c.createGain(), sfx: c.createGain(), ui: c.createGain(), ambience: c.createGain() };
      this.buses.music.connect(this.duck);
      this.buses.sfx.connect(this.duck);
      this.buses.ambience.connect(this.duck);
      this.buses.ui.connect(this.master);
      this.stinger = c.createGain();
      this.stinger.connect(this.master);
      this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.layers = { base: c.createGain(), combat: c.createGain(), tension: c.createGain() };
      for (const l of Object.values(this.layers)) { l.gain.value = 0; l.connect(this.buses.music); }
      this.trackGain = { prepare: c.createGain(), combat: c.createGain() };
      for (const g of Object.values(this.trackGain)) { g.gain.value = 0; g.connect(this.buses.music); }
      this.applyVolumes();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (!this.schedTimer && !this.recordedMusic) {
      this.nextBeat = this.ctx.currentTime + 0.1;
      this.schedTimer = setInterval(() => this.schedule(), 90);
    }
    if (!this.ambienceStarted) { this.ambienceStarted = true; this.startAmbience(); }
    if (!this.assetsRequested) { this.assetsRequested = true; void this.loadAssets(); }
  }

  // ------------------------------------------------------------------ recorded assets
  private async decode(path: string): Promise<Clip | null> {
    try {
      const res = await fetch(audioUrl(path));
      if (!res.ok) return null;
      const buf = await this.ctx!.decodeAudioData(await res.arrayBuffer());
      return trimmed(buf);
    } catch {
      return null; // missing file / decode error → keep the synth fallback for this sound
    }
  }

  private async loadAssets() {
    const sfx = Object.entries(SFX_SAMPLES) as [SfxId, NonNullable<(typeof SFX_SAMPLES)[SfxId]>][];
    await Promise.all(sfx.map(async ([id, def]) => {
      const clips = (await Promise.all(def.files.map((f) => this.decode(f)))).filter((c): c is Clip => !!c);
      if (clips.length) this.samples.set(id, { clips, gain: def.gain, vary: def.vary ?? false });
    }));
    // Music after SFX: it is the bigger download and the synth score covers the gap.
    const music = await Promise.all((Object.keys(MUSIC_TRACKS) as MusicTrack[]).map(async (k) => [k, await this.decode(MUSIC_TRACKS[k])] as const));
    if (music.every(([, c]) => !!c)) {
      for (const [k, c] of music) this.tracks[k] = c!;
      this.recordedMusic = true;
      // retire the generative score
      if (this.schedTimer) { clearInterval(this.schedTimer); this.schedTimer = null; }
      const t = this.ctx!.currentTime;
      for (const l of Object.values(this.layers)) l.gain.setTargetAtTime(0, t, 0.3);
      this.setMusic(this.musicState, true);
    }
  }

  /** True while recorded music (rather than the synth fallback) drives the score. */
  get usingRecordedMusic() { return this.recordedMusic; }

  setVolumes(v: typeof this.volumes) { this.volumes = { ...v }; this.applyVolumes(); }
  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    this.buses.music.gain.setTargetAtTime(this.volumes.music * 0.55, t, 0.05);
    this.buses.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    this.stinger.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    this.buses.ui.gain.setTargetAtTime(this.volumes.ui * 0.8, t, 0.05);
    this.buses.ambience.gain.setTargetAtTime(this.volumes.ambience * 0.5, t, 0.05);
  }

  setMusic(state: AudioEngine['musicState'], force = false) {
    const changed = state !== this.musicState;
    this.musicState = state;
    if (!this.ctx) return;
    if (this.recordedMusic) { if (changed || force) this.applyTracks(); return; }
    const t = this.ctx.currentTime;
    const target = {
      base: state === 'silent' ? 0 : 0.9,
      combat: state === 'combat' || state === 'tension' ? 0.85 : 0,
      tension: state === 'tension' ? 0.7 : 0,
    };
    for (const k of ['base', 'combat', 'tension'] as const) this.layers[k].gain.setTargetAtTime(target[k], t, 1.5 / 3);
  }

  /** Crossfade the looping recorded tracks to match `musicState` (1.5 s, Tech §9.9). */
  private applyTracks() {
    const c = this.ctx!;
    const t = c.currentTime;
    const s = this.musicState;
    const want: MusicTrack | null = s === 'prepare' ? 'prepare' : s === 'combat' || s === 'tension' ? 'combat' : null;
    for (const k of Object.keys(this.trackGain) as MusicTrack[]) {
      const g = this.trackGain[k];
      const src = this.trackSrc[k];
      if (k === want) {
        if (!src) {
          const clip = this.tracks[k]!;
          const n = c.createBufferSource();
          n.buffer = clip.buf;
          n.loop = true; n.loopStart = clip.start; n.loopEnd = clip.end;
          n.connect(g);
          n.start(t, clip.start);
          this.trackSrc[k] = n;
          g.gain.cancelScheduledValues(t);
          g.gain.setValueAtTime(0.0001, t);
        }
        g.gain.setTargetAtTime(1, t, 1.5 / 3);
        // low core HP: same battle theme pushed a little faster/higher for urgency
        this.trackSrc[k]!.playbackRate.setTargetAtTime(s === 'tension' ? 1.07 : 1, t, 0.6);
      } else if (src) {
        g.gain.cancelScheduledValues(t);
        g.gain.setTargetAtTime(0, t, 1.5 / 3);
        src.stop(t + 2.5);
        delete this.trackSrc[k];
      }
    }
  }

  /** Short duck of music+sfx (−4 dB for 0.4 s on core hit; −6 dB for stingers). */
  duckFor(db: number, sec: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = Math.pow(10, -db / 20);
    this.duck.gain.cancelScheduledValues(t);
    this.duck.gain.setTargetAtTime(g, t, 0.02);
    this.duck.gain.setTargetAtTime(1, t + sec, 0.15);
  }

  // ------------------------------------------------------------------ synthesis helpers
  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  private tone(dest: AudioNode, type: OscillatorType, f0: number, f1: number, t: number, a: number, d: number, peak: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + a + d);
    this.env(g, t, a, peak, d);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + a + d + 0.05);
  }
  private noise(dest: AudioNode, t: number, a: number, d: number, peak: number, filter: BiquadFilterType, f0: number, f1 = f0, q = 1) {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = filter; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + a + d);
    const g = c.createGain();
    this.env(g, t, a, peak, d);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random()); s.stop(t + a + d + 0.05);
  }

  /** Play a one-shot. `pan` in [-1,1] (screen x), `vol` multiplier. */
  play(id: SfxId, opts: { pan?: number; vol?: number } = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const max = MAX_VOICES[id] ?? 8;
    const cur = this.voices.get(id) ?? 0;
    if (cur >= max) return;
    this.voices.set(id, cur + 1);
    setTimeout(() => this.voices.set(id, Math.max(0, (this.voices.get(id) ?? 1) - 1)), 250);
    const c = this.ctx;
    const t = c.currentTime + 0.005;
    const p = 1 + (Math.random() - 0.5) * 0.1; // ±5% pitch
    const v = (opts.vol ?? 1) * Math.pow(10, ((Math.random() - 0.5) * 4) / 20); // ±2 dB
    const out = c.createGain();
    out.gain.value = v;
    const pan = c.createStereoPanner();
    pan.pan.value = Math.max(-0.6, Math.min(0.6, (opts.pan ?? 0) * 0.6));
    const duck = DUCK[id];
    out.connect(pan).connect(UI_SFX.has(id) ? this.buses.ui : duck ? this.stinger : this.buses.sfx);
    if (duck) this.duckFor(duck[0], duck[1]);
    const sample = this.samples.get(id);
    if (sample) {
      const clip = sample.clips[Math.floor(Math.random() * sample.clips.length)]!;
      const s = c.createBufferSource();
      s.buffer = clip.buf;
      s.playbackRate.value = sample.vary ? p : 1;
      out.gain.value = v * sample.gain;
      s.connect(out);
      s.start(t, clip.start, clip.end - clip.start);
      return;
    }
    switch (id) {
      case 'click': this.tone(out, 'triangle', 880 * p, 660 * p, t, 0.002, 0.06, 0.25); break;
      case 'hover': this.tone(out, 'sine', 1320 * p, 1320 * p, t, 0.002, 0.03, 0.06); break;
      case 'coin':
        this.tone(out, 'square', 1568 * p, 1568 * p, t, 0.002, 0.06, 0.06);
        this.tone(out, 'square', 2093 * p, 2093 * p, t + 0.06, 0.002, 0.12, 0.06); break;
      case 'illegal':
        this.tone(out, 'square', 196, 180, t, 0.005, 0.12, 0.12);
        this.tone(out, 'square', 156, 140, t + 0.11, 0.005, 0.16, 0.12); break;
      case 'build':
        for (let i = 0; i < 3; i++) { this.noise(out, t + i * 0.09, 0.002, 0.08, 0.5, 'lowpass', 900 + i * 300); this.tone(out, 'sine', (180 + i * 40) * p, 90, t + i * 0.09, 0.002, 0.09, 0.4); }
        this.tone(out, 'triangle', 784 * p, 784 * p, t + 0.3, 0.005, 0.25, 0.12); break;
      case 'upgrade':
        this.noise(out, t, 0.002, 0.05, 0.4, 'highpass', 2500);
        [784, 988, 1175, 1568].forEach((f, i) => this.tone(out, 'triangle', f * p, f * p, t + 0.05 + i * 0.06, 0.003, 0.3, 0.13)); break;
      case 'sell':
        [1319, 1568, 2093, 1760, 2349].forEach((f, i) => this.tone(out, 'square', f * p, f * p, t + i * 0.045, 0.002, 0.08, 0.05)); break;
      case 'raise':
        this.noise(out, t, 0.03, 0.28, 0.45, 'bandpass', 250 * p, 700 * p, 2);
        this.tone(out, 'sine', 70, 110, t, 0.02, 0.3, 0.35); break;
      case 'lower':
        this.noise(out, t, 0.02, 0.3, 0.45, 'bandpass', 600 * p, 180 * p, 2);
        this.tone(out, 'sine', 120, 55, t, 0.02, 0.3, 0.4); break;
      case 'wallPlace':
        this.tone(out, 'sine', 110 * p, 45, t, 0.002, 0.25, 0.7);
        this.noise(out, t, 0.002, 0.18, 0.5, 'lowpass', 1200, 300); break;
      case 'wallRemove': this.noise(out, t, 0.002, 0.25, 0.45, 'bandpass', 900 * p, 400, 1.5); break;
      case 'undo':
        this.tone(out, 'sine', 900 * p, 450 * p, t, 0.005, 0.18, 0.18);
        this.noise(out, t, 0.01, 0.15, 0.15, 'highpass', 3000, 1500); break;
      case 'arrowFire':
        this.noise(out, t, 0.002, 0.09, 0.4, 'bandpass', 2400 * p, 900 * p, 3);
        this.tone(out, 'triangle', 220 * p, 140 * p, t, 0.001, 0.07, 0.22); break;
      case 'arrowHit': this.noise(out, t, 0.001, 0.05, 0.35, 'bandpass', 1500 * p, 1500, 2); this.tone(out, 'square', 320 * p, 240, t, 0.001, 0.03, 0.08); break;
      case 'frostFire':
        [1760, 2637, 3520].forEach((f, i) => this.tone(out, 'sine', f * p, f * p * 1.01, t + i * 0.02, 0.003, 0.35, 0.07)); break;
      case 'frostHit':
        this.noise(out, t, 0.002, 0.2, 0.2, 'highpass', 5000 * p, 3000); this.tone(out, 'sine', 2093 * p, 1976 * p, t, 0.002, 0.2, 0.08); break;
      case 'cannonFire':
        this.tone(out, 'sine', 95 * p, 38, t, 0.002, 0.45, 0.9);
        this.noise(out, t, 0.002, 0.35, 0.7, 'lowpass', 1800, 200); break;
      case 'explosion':
        this.noise(out, t, 0.004, 0.6, 0.85, 'lowpass', 2400 * p, 120);
        this.tone(out, 'sine', 70 * p, 30, t, 0.004, 0.5, 0.7); break;
      case 'resist': this.tone(out, 'square', 1900 * p, 1700 * p, t, 0.001, 0.08, 0.08); this.tone(out, 'triangle', 2850 * p, 2850 * p, t, 0.001, 0.12, 0.05); break;
      case 'deathSlime':
        this.tone(out, 'sine', 520 * p, 180 * p, t, 0.004, 0.16, 0.35);
        this.noise(out, t + 0.02, 0.003, 0.12, 0.2, 'lowpass', 900, 300); break;
      case 'deathRunner':
        this.noise(out, t, 0.01, 0.3, 0.35, 'bandpass', 1500 * p, 4000 * p, 1.2);
        this.tone(out, 'triangle', 660 * p, 330 * p, t, 0.003, 0.12, 0.15); break;
      case 'deathGolem':
        for (let i = 0; i < 4; i++) this.noise(out, t + i * 0.07, 0.003, 0.16, 0.45, 'lowpass', 700 - i * 100, 200);
        this.tone(out, 'sine', 80 * p, 40, t, 0.004, 0.45, 0.6); break;
      case 'spawn': this.tone(out, 'sine', 220 * p, 440 * p, t, 0.05, 0.25, 0.08); this.noise(out, t, 0.05, 0.25, 0.06, 'bandpass', 600, 1800, 3); break;
      case 'blocked': this.tone(out, 'sine', 330, 300, t, 0.002, 0.08, 0.05); break;
      case 'coreHit':
        this.tone(out, 'sine', 110, 82, t, 0.002, 1.2, 0.8);
        this.tone(out, 'triangle', 220, 205, t, 0.002, 0.9, 0.35);
        this.noise(out, t, 0.001, 0.25, 0.5, 'highpass', 3000, 1200); break;
      case 'waveStart':
        this.tone(out, 'sawtooth', 196, 196, t, 0.08, 0.5, 0.18);
        this.tone(out, 'sawtooth', 294, 294, t + 0.42, 0.06, 0.8, 0.2);
        this.tone(out, 'sine', 98, 98, t, 0.1, 1.2, 0.25); break;
      case 'waveClear':
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(out, 'triangle', f, f, t + i * 0.08, 0.004, 0.5, 0.14)); break;
      case 'victory':
        [523, 659, 784, 1047, 784, 1047, 1319, 1568].forEach((f, i) => this.tone(out, 'triangle', f, f, t + i * 0.12, 0.004, i === 7 ? 1.4 : 0.35, 0.16)); break;
      case 'defeat':
        [392, 349, 311, 262].forEach((f, i) => this.tone(out, 'triangle', f, f * 0.98, t + i * 0.22, 0.01, 0.6, 0.18));
        this.tone(out, 'sine', 65, 45, t, 0.05, 2, 0.4); break;
    }
  }

  // ------------------------------------------------------------------ music
  /** Lookahead scheduler: 96 BPM, 8th-note grid, I–vi–IV–V in C (pentatonic melody). */
  private schedule() {
    const c = this.ctx;
    if (!c) return;
    const spb = 60 / 96 / 2;
    while (this.nextBeat < c.currentTime + 0.35) {
      this.playStep(this.beat, this.nextBeat, spb);
      this.nextBeat += spb;
      this.beat++;
    }
  }

  private playStep(step: number, t: number, spb: number) {
    const bar = Math.floor(step / 8) % 8;
    const s = step % 8;
    const chords = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62], [60, 64, 67], [57, 60, 64], [53, 57, 62], [55, 59, 62]];
    const ch = chords[bar]!;
    const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
    const L = this.layers;
    // base: pluck arpeggio + soft pad + occasional glockenspiel melody
    const arp = [0, 1, 2, 1, 0, 2, 1, 2];
    this.pluck(L.base, mtof(ch[arp[s]!]! + 12), t, 0.09);
    if (s === 0) for (const n of ch) this.pad(L.base, mtof(n), t, spb * 8, 0.035);
    const melody = [76, 79, 81, 79, 76, 74, 72, 74, 76, 79, 84, 81, 79, 76, 74, 72];
    if ((step % 4) === 0 && ((step >> 2) % 3 !== 2)) this.bell(L.base, mtof(melody[(step >> 2) % melody.length]!), t, 0.05);
    // combat: kick/hat/bass
    if (s % 4 === 0) this.kick(L.combat, t);
    if (s % 2 === 1) this.hat(L.combat, t);
    if (s === 4) this.snare(L.combat, t);
    if (s % 2 === 0) this.bass(L.combat, mtof(ch[0]! - 24), t, spb * 1.8);
    // tension: tremolo high minor second rubs
    if (s % 2 === 0) this.pad(L.tension, mtof(ch[0]! + 13), t, spb * 2, 0.025);
  }
  private pluck(dest: AudioNode, f: number, t: number, peak: number) { this.tone(dest, 'triangle', f, f, t, 0.003, 0.32, peak); }
  private bell(dest: AudioNode, f: number, t: number, peak: number) { this.tone(dest, 'sine', f, f, t, 0.002, 0.9, peak); this.tone(dest, 'sine', f * 2.76, f * 2.76, t, 0.002, 0.35, peak * 0.3); }
  private pad(dest: AudioNode, f: number, t: number, dur: number, peak: number) {
    const c = this.ctx!;
    for (const det of [-6, 6]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 1100;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + dur * 0.3);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(fl).connect(g).connect(dest);
      o.start(t); o.stop(t + dur + 0.05);
    }
  }
  private kick(dest: AudioNode, t: number) { this.tone(dest, 'sine', 140, 45, t, 0.002, 0.22, 0.5); }
  private hat(dest: AudioNode, t: number) { this.noise(dest, t, 0.001, 0.04, 0.08, 'highpass', 7000); }
  private snare(dest: AudioNode, t: number) { this.noise(dest, t, 0.001, 0.14, 0.22, 'bandpass', 1800, 1200, 0.8); }
  private bass(dest: AudioNode, f: number, t: number, dur: number) { this.tone(dest, 'triangle', f, f, t, 0.01, dur, 0.28); }

  private startAmbience() {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.6;
    const g = c.createGain(); g.gain.value = 0.18;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07;
    const lg = c.createGain(); lg.gain.value = 180;
    lfo.connect(lg).connect(f.frequency);
    s.connect(f).connect(g).connect(this.buses.ambience);
    s.start(); lfo.start();
    const chirp = () => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const base = 2400 + Math.random() * 1200;
      for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) this.tone(this.buses.ambience, 'sine', base, base * 1.25, t + i * 0.11, 0.01, 0.07, 0.035);
      setTimeout(chirp, 5000 + Math.random() * 9000);
    };
    setTimeout(chirp, 3000);
  }
}

export const audio = new AudioEngine();
