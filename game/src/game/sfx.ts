// Combat effects are synthesised; the background track is managed separately in bgm.ts.
// The filter throws away most of a noise's energy: measured, a hiss peaked some 30 dB under the tone it was meant to sit on, too far down to hear.
const HISS_GAIN = 4;
export class Sfx {
  private active = true;
  private context?: AudioContext;
  private master?: DynamicsCompressorNode;
  private output?: GainNode;
  private noise?: AudioBuffer;

  get enabled() { return this.active; }
  set enabled(enabled: boolean) {
    this.active = enabled;
    // Mute effects already ringing out as well as preventing new ones.
    this.output?.gain.setValueAtTime(enabled ? 1 : 0, this.context!.currentTime);
  }

  unlock() {
    if (!this.enabled) return;
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createDynamicsCompressor(); this.output = this.context.createGain();
      this.master.connect(this.output).connect(this.context.destination);
      const length = this.context.sampleRate * .7;
      this.noise = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    this.context.resume();
  }
  private envelope(duration: number, volume: number) {
    const g = this.context!.createGain(), now = this.context!.currentTime;
    g.gain.setValueAtTime(volume, now); g.gain.exponentialRampToValueAtTime(.001, now + duration); g.connect(this.master!);
    return g;
  }
  // A pitched body: the thump of a hit, the swell of the cast.
  tone(from: number, to: number, duration: number, volume: number, type: OscillatorType = 'triangle') {
    if (!this.enabled || !this.context) return;
    const o = this.context.createOscillator(), now = this.context.currentTime;
    o.type = type; o.frequency.setValueAtTime(from, now); o.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + duration);
    o.connect(this.envelope(duration, volume)); o.start(); o.stop(now + duration);
  }
  // Filtered noise: the crack of contact and the swish of the blade.
  hiss(from: number, to: number, duration: number, volume: number, filter: BiquadFilterType = 'bandpass') {
    if (!this.enabled || !this.context) return;
    const s = this.context.createBufferSource(), f = this.context.createBiquadFilter(), now = this.context.currentTime;
    s.buffer = this.noise!; s.loop = true; f.type = filter; f.Q.value = .8;
    f.frequency.setValueAtTime(from, now); f.frequency.exponentialRampToValueAtTime(Math.max(40, to), now + duration);
    s.connect(f).connect(this.envelope(duration, volume * HISS_GAIN)); s.start(0, Math.random() * .5); s.stop(now + duration);
  }
}
