/**
 * audio.js
 * Procedural Web Audio API sound engine for Satoru Gojo's Cursed Techniques.
 * Generates custom synthesized audio for Blue, Red, Charging Purple, and Purple Launch.
 * Includes master volume, smooth fade-in/out, and mute toggle.
 */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.isMuted = false;
    this.initialized = false;

    // Active sound sources
    this.blueHumNode = null;
    this.blueGain = null;

    this.redNoiseNode = null;
    this.redGain = null;

    this.chargeOsc1 = null;
    this.chargeOsc2 = null;
    this.chargeGain = null;
    this.chargeFilter = null;
  }

  /**
   * Initializes the AudioContext after user gesture (browser autoplay policy)
   */
  init() {
    if (this.initialized) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContext();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.75, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      this.initialized = true;
    } catch (err) {
      console.warn('Web Audio API not supported or blocked:', err);
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.masterGain && this.ctx) {
      const target = this.isMuted ? 0 : 0.75;
      this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
    }
    return this.isMuted;
  }

  setMute(mute) {
    this.isMuted = mute;
    if (this.masterGain && this.ctx) {
      const target = this.isMuted ? 0 : 0.75;
      this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
    }
  }

  // ==========================================
  // BLUE: Low Gravitational Singularity Hum
  // ==========================================
  startBlueHum() {
    if (!this.initialized || this.blueHumNode) return;
    this.resume();

    const now = this.ctx.currentTime;
    // Sub-bass sine + triangle with low-frequency harmonic drone
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const subOsc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(65, now); // C2

    osc2.type = 'sawtooth';
    osc2.frequency.setValueAtTime(65.5, now); // slight detune for gravitational beating

    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(32.7, now); // sub-octave C1

    // Lowpass filter for deep muffled gravitational presence
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(140, now);
    filter.Q.setValueAtTime(4.0, now);

    // LFO to create a subtle "breathing/pulsing" effect
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(2.5, now); // 2.5 Hz pulse
    lfoGain.gain.setValueAtTime(30, now);
    lfo.connect(filter.frequency);
    lfo.start(now);

    osc1.connect(filter);
    osc2.connect(filter);
    subOsc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.5, now + 0.3);

    osc1.start(now);
    osc2.start(now);
    subOsc.start(now);

    this.blueHumNode = { osc1, osc2, subOsc, lfo, filter };
    this.blueGain = gain;
  }

  stopBlueHum() {
    if (!this.blueHumNode || !this.ctx) return;
    const now = this.ctx.currentTime;
    const nodes = this.blueHumNode;
    const gain = this.blueGain;

    this.blueHumNode = null;
    this.blueGain = null;

    gain.gain.setTargetAtTime(0.0001, now, 0.15);
    setTimeout(() => {
      try {
        nodes.osc1.stop();
        nodes.osc2.stop();
        nodes.subOsc.stop();
        nodes.lfo.stop();
        nodes.osc1.disconnect();
        nodes.osc2.disconnect();
        nodes.subOsc.disconnect();
        nodes.lfo.disconnect();
        nodes.filter.disconnect();
        gain.disconnect();
      } catch (e) {}
    }, 200);
  }

  // ==========================================
  // RED: Sharp Energy Pulse / Shockwave Zap
  // ==========================================
  playRedPulse() {
    if (!this.initialized) return;
    this.resume();

    const now = this.ctx.currentTime;

    // High energy zap: fast pitch sweep down with resonant bandpass
    const osc = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.25);

    osc2.type = 'square';
    osc2.frequency.setValueAtTime(1760, now);
    osc2.frequency.exponentialRampToValueAtTime(220, now + 0.2);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200, now);
    filter.frequency.exponentialRampToValueAtTime(300, now + 0.25);
    filter.Q.setValueAtTime(6.0, now);

    gain.gain.setValueAtTime(0.6, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc2.start(now);
    osc.stop(now + 0.32);
    osc2.stop(now + 0.32);
  }

  startRedCrackle() {
    if (!this.initialized || this.redNoiseNode) return;
    this.resume();

    const now = this.ctx.currentTime;
    // White noise buffer for unstable crackling energy
    const bufferSize = this.ctx.sampleRate * 1;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.5;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(1800, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.15);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    noise.start(now);

    this.redNoiseNode = { noise, filter };
    this.redGain = gain;
  }

  stopRedCrackle() {
    if (!this.redNoiseNode || !this.ctx) return;
    const now = this.ctx.currentTime;
    const nodes = this.redNoiseNode;
    const gain = this.redGain;

    this.redNoiseNode = null;
    this.redGain = null;

    gain.gain.setTargetAtTime(0.0001, now, 0.1);
    setTimeout(() => {
      try {
        nodes.noise.stop();
        nodes.noise.disconnect();
        nodes.filter.disconnect();
        gain.disconnect();
      } catch (e) {}
    }, 150);
  }

  // ==========================================
  // HOLLOW PURPLE: Charge & Collision Rising Sound
  // ==========================================
  startPurpleCharge() {
    if (!this.initialized || this.chargeOsc1) return;
    this.resume();

    const now = this.ctx.currentTime;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const sub = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(110, now);
    osc1.frequency.exponentialRampToValueAtTime(520, now + 2.0); // Rising pitch

    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(220, now);
    osc2.frequency.exponentialRampToValueAtTime(1040, now + 2.0);

    sub.type = 'triangle';
    sub.frequency.setValueAtTime(55, now);
    sub.frequency.exponentialRampToValueAtTime(180, now + 2.0);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(300, now);
    filter.frequency.exponentialRampToValueAtTime(3500, now + 2.0);
    filter.Q.setValueAtTime(5.0, now);

    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.7, now + 1.8);

    osc1.connect(filter);
    osc2.connect(filter);
    sub.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc1.start(now);
    osc2.start(now);
    sub.start(now);

    this.chargeOsc1 = osc1;
    this.chargeOsc2 = osc2;
    this.chargeGain = gain;
    this.chargeFilter = filter;
    this.chargeSub = sub;
  }

  stopPurpleCharge() {
    if (!this.chargeOsc1 || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc1 = this.chargeOsc1;
    const osc2 = this.chargeOsc2;
    const sub = this.chargeSub;
    const gain = this.chargeGain;
    const filter = this.chargeFilter;

    this.chargeOsc1 = null;
    this.chargeOsc2 = null;
    this.chargeSub = null;
    this.chargeGain = null;
    this.chargeFilter = null;

    gain.gain.setTargetAtTime(0.0001, now, 0.1);
    setTimeout(() => {
      try {
        osc1.stop();
        osc2.stop();
        sub.stop();
        osc1.disconnect();
        osc2.disconnect();
        sub.disconnect();
        filter.disconnect();
        gain.disconnect();
      } catch (e) {}
    }, 150);
  }

  // ==========================================
  // HOLLOW PURPLE: Massive Release / Bass Impact
  // ==========================================
  playPurpleLaunch() {
    if (!this.initialized) return;
    this.resume();

    const now = this.ctx.currentTime;

    // 1. Thunderous sub-bass drop (808-style impact)
    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(140, now);
    sub.frequency.exponentialRampToValueAtTime(28, now + 0.8); // Drop deep to sub-bass

    subGain.gain.setValueAtTime(1.0, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

    sub.connect(subGain);
    subGain.connect(this.masterGain);

    sub.start(now);
    sub.stop(now + 1.25);

    // 2. High-speed rushing whoosh (filtered noise blast)
    const bufferSize = this.ctx.sampleRate * 1.5;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(3200, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(200, now + 1.2);
    noiseFilter.Q.setValueAtTime(2.5, now);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.8, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 1.4);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain);

    noise.start(now);
    noise.stop(now + 1.45);
  }
}

export const soundEngine = new SoundEngine();
