// Tiny WebAudio sound kit. Must be initialised from a user tap (iOS rule).
export class Sfx {
  constructor() { this.ctx = null; this.muted = false; this.master = null; }
  init() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain(); this.master.gain.value = .7; this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state !== 'running') this.ctx.resume();
      // unlock iOS with a silent buffer
      const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource();
      s.buffer = b; s.connect(this.ctx.destination); s.start(0);
    } catch (e) { /* sound is optional */ }
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : .7; }
  tone(f, dur = .15, type = 'sine', vol = .3, slideTo = null, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + .05);
  }
  noise(dur = .15, vol = .3, freq = 1200, q = 1, sweepTo = null, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay, n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const s = this.ctx.createBufferSource(); s.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q; f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t);
  }
  pop(pitch = 1) { this.tone(500 * pitch, .12, 'sine', .35, 1100 * pitch); this.noise(.08, .25, 3000, .8); }
  gold() { [660, 880, 1320].forEach((f, i) => this.tone(f, .18, 'triangle', .3, null, i * .07)); }
  catch_() { this.tone(520, .1, 'triangle', .3); this.tone(780, .12, 'triangle', .3, null, .06); }
  toss() { this.noise(.25, .25, 500, 1.2, 2500); this.tone(300, .2, 'sine', .15, 700); }
  flick() { this.noise(.2, .3, 800, 1.2, 4000); this.tone(500, .2, 'triangle', .25, 1000); }
  miss() { this.tone(300, .35, 'sawtooth', .2, 90); }
  strike() { this.tone(220, .3, 'square', .18, 110); this.tone(160, .3, 'square', .15, 80, .15); }
  swing() { this.noise(.18, .25, 600, 1, 2500); }
  hit() { this.noise(.07, .6, 2200, .5); this.tone(180, .2, 'square', .35, 60); }
  pitch() { this.noise(.3, .12, 400, 2, 900); }
  cheer() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, .2, 'triangle', .3, null, i * .1)); }
  tick() { this.tone(700, .08, 'square', .12); }
  go() { this.tone(880, .3, 'triangle', .3); }
  over() { [523, 440, 349, 262].forEach((f, i) => this.tone(f, .22, 'triangle', .28, null, i * .15)); }

  /* ---- v8+ games ---- */
  roll(d = 1) { this.noise(d, .2, 170, 1.5, 280); }
  pins(n = 10) { for (let i = 0; i < Math.min(9, n); i++) { this.noise(.12 + Math.random() * .2, .4, 1500 + Math.random() * 2500, 1.2, null, i * .045); this.tone(300 + Math.random() * 500, .1, 'square', .1, null, i * .045); } }
  swish() { this.noise(.3, .3, 2500, .7, 5200); }
  rim() { this.tone(900, .12, 'triangle', .3, 500); this.tone(1200, .1, 'sine', .2, 700, .04); }
  bounce() { this.tone(150, .12, 'sine', .4, 70); }
  punch() { this.noise(.09, .55, 500, .8); this.tone(110, .18, 'sine', .5, 50); }
  block() { this.tone(260, .1, 'square', .2, 160); }
  ouch() { this.tone(300, .3, 'sawtooth', .25, 110); }
  bell() { [1320, 1760].forEach((f, i) => this.tone(f, .7, 'sine', .25, null, i * .02)); }
  whoosh() { this.noise(.25, .25, 400, 1, 2200); }
  thwack() { this.noise(.07, .5, 2800, .6); this.tone(220, .12, 'triangle', .4, 120); }
  plop() { this.tone(500, .15, 'sine', .35, 150); }
  cup() { this.tone(200, .1, 'sine', .4, 120); this.tone(800, .2, 'triangle', .25, null, .1); }
  /* ---- stadium crowd (looped filtered noise that swells/groans) ---- */
  crowdStart(base = .05) {
    if (!this.ctx || this.crowd) return;
    const c = this.ctx, n = c.sampleRate * 2, buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0; // pink-ish noise
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; b0 = .99765 * b0 + w * .099; b1 = .963 * b1 + w * .2965; b2 = .57 * b2 + w * 1.05; d[i] = (b0 + b1 + b2 + w * .18) * .25; }
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = .5;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2500;
    const g = c.createGain(); g.gain.value = base;
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = .6; lg.gain.value = base * .35; lfo.connect(lg); lg.connect(g.gain);
    src.connect(bp); bp.connect(lp); lp.connect(g); g.connect(this.master); src.start(); lfo.start();
    this.crowd = { src, bp, g, lfo, base };
  }
  crowdLevel(level = 1, dur = 1.6) { // swell then decay back to murmur
    const k = this.crowd; if (!k || this.muted) return; const t = this.ctx.currentTime;
    k.g.gain.cancelScheduledValues(t); k.g.gain.setValueAtTime(Math.max(k.g.gain.value, .001), t);
    k.g.gain.linearRampToValueAtTime(k.base + .22 * level, t + .15); k.g.gain.exponentialRampToValueAtTime(k.base, t + .15 + dur);
    k.bp.frequency.cancelScheduledValues(t); k.bp.frequency.setValueAtTime(700, t); k.bp.frequency.linearRampToValueAtTime(1100 + 500 * level, t + .2); k.bp.frequency.exponentialRampToValueAtTime(700, t + .2 + dur);
  }
  crowdCheer(level = 1) { this.crowdLevel(level, 1.2 + level * 1.4); if (level > .6) { [0, .12, .24].forEach((d, i) => this.tone(1500 + i * 300, .25, 'sine', .05, 2400, d)); } }
  crowdGroan() {
    const k = this.crowd; if (k && !this.muted) { const t = this.ctx.currentTime; k.g.gain.cancelScheduledValues(t); k.g.gain.setValueAtTime(Math.max(k.g.gain.value, .001), t); k.g.gain.linearRampToValueAtTime(k.base + .08, t + .2); k.g.gain.exponentialRampToValueAtTime(k.base, t + 1.4); k.bp.frequency.cancelScheduledValues(t); k.bp.frequency.setValueAtTime(600, t); k.bp.frequency.exponentialRampToValueAtTime(250, t + 1.2); }
    // a few descending "awww" voices
    [0, .08, .15].forEach((d, i) => { this.tone(300 + i * 40, .9, 'sawtooth', .035, 140 + i * 15, d); });
  }
  crowdStop() {
    const k = this.crowd; if (!k) return; this.crowd = null; const t = this.ctx.currentTime;
    try { k.g.gain.cancelScheduledValues(t); k.g.gain.setValueAtTime(Math.max(k.g.gain.value, .001), t); k.g.gain.exponentialRampToValueAtTime(.0001, t + .4); k.src.stop(t + .5); k.lfo.stop(t + .5); } catch (e) { /* already stopped */ }
  }

  /* ---- animal fly-by sounds ---- */
  chirp() { [0, .09, .2].forEach((d, i) => this.tone(2400 + i * 300, .07, 'triangle', .06, 3200, d)); }
  screech() { this.noise(.5, .12, 2500, 3, 1200); this.tone(2200, .5, 'sawtooth', .05, 900); }
  oink() { this.tone(190, .16, 'sawtooth', .09, 120); this.tone(180, .18, 'sawtooth', .09, 110, .2); }
  squeak() { [0, .08].forEach(d => this.tone(3200, .06, 'square', .03, 4200, d)); }
  roar() { this.noise(.9, .22, 300, 1, 120); this.tone(110, .9, 'sawtooth', .1, 55); }
  flutter() { [0, .12, .24].forEach((d, i) => this.tone(1800 + i * 200, .08, 'sine', .03, null, d)); }
  /* ---- football ---- */
  whistle() { this.tone(2600, .35, 'sine', .12, 2500); this.tone(2650, .3, 'sine', .1, 2600, .4); }
  thud() { this.noise(.12, .5, 300, .8); this.tone(90, .2, 'sine', .35, 50); }
  kick() { this.noise(.06, .5, 900, .6); this.tone(140, .18, 'sine', .45, 60); }
  throwSfx() { this.noise(.22, .22, 700, 1.2, 3000); }
  catchBall() { this.tone(440, .08, 'triangle', .3); this.noise(.05, .25, 1500, .8); }
}
