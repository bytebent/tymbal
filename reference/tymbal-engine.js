/*
 * tymbal engine · bytebent
 *
 * An insect tymbal voice. Each tymbal is a state machine (OUT → rib 1 IN → … → rib n IN → OUT)
 * driving one resonator that retunes with the state. Each rib that buckles strikes the resonator
 * at its own frequency and Q; when the muscle relaxes the tymbal pops out with one quieter,
 * higher click (Bennet-Clark 1997; Young & Bennet-Clark 1995). See design.md.
 *
 * The resonator is a complex one-pole: z ← z · r·e^{iω}, output Re(z). A click adds a phasor at
 * its exact sub-sample time. The start phase gives the measured shape: a short, small inward
 * half-wave, then a larger rebound. The frequency falls slightly with amplitude, so a click starts
 * low and rises as it decays (150–350 Hz at 4.3 kHz).
 *
 * Batch 02: one tymbal (left), Carrier mode, no body yet. Every parameter of the design is in the
 * table; the ones a later batch builds are accepted and ignored until then.
 *
 * Everything runs at 4× the host rate in fixed 32-sample blocks and is decimated with a
 * windowed-sinc FIR, as in Throat, Dolphin and Syrinx. process() never allocates. Same seed, same
 * notes: same output, at any host buffer size.
 *
 * Works in an AudioWorklet and in Node (module.exports) for offline tests.
 */
(function (root) {
  'use strict';

  const OS = 4;                 // internal oversampling
  const BLOCK = 32;             // fixed internal block (host samples) = latency
  const FIR_LEN = 128;          // decimation filter taps (at 4x rate)
  const MAX_VOICES = 8;
  const MAX_RIBS = 24;
  const MAX_EV = 64;            // queued events per tymbal (one stroke: ≤ 24 IN, ≤ 25 OUT)
  const TWO_PI = 2 * Math.PI;
  const F_CAP = 16000;          // the carrier drops whole octaves above this
  const F_MIN = 20;
  const CLICK_PHASE = 1.3 * Math.PI;   // IN click: starts at cos = −0.59 (small rarefaction), rises to a full compression
  const KAPPA = 0.06;           // frequency falls 6% at full click amplitude (Bennet-Clark 1997: +150–350 Hz through the decay)
  const A_REF = 0.25;           // click amplitude at full effort
  const OUTRIB_DB = -6;         // ribs popping out, against the OUT plate click
  const HEAT_BASE = 1.846;      // M. cassini sub-pulses 650 → 1200 Hz from 20 to 35 °C (Young & Josephson 1983)
  const STOP_EFFORT = 0.01;     // below this the muscle stops

  // ids, defaults and ranges: the one table the C++ core and the UI copy.
  // log: the knob moves logarithmically; curve: knob position^curve; step: whole steps.
  const PARAMS = [
    // Play
    { id: 'playmode', def: 0, min: 0, max: 1, step: 1 },          // Carrier, Rate (batch 04)
    { id: 'carrier', def: 4300, min: 50, max: 16000, log: true }, // Hz, body pitch in Rate mode
    { id: 'transpose', def: 0, min: -48, max: 48, step: 1 },      // st (Carrier adds +4 octaves)
    { id: 'detune', def: 0, min: -100, max: 100 },                // cents
    { id: 'bendrange', def: 12, min: 2, max: 48, step: 1 },
    { id: 'glide', def: 0.02, min: 0, max: 2, curve: 3 },         // s, mono only
    { id: 'mode', def: 0, min: 0, max: 1, step: 1 },              // Mono, Poly
    // Muscle
    { id: 'rate', def: 117, min: 1, max: 600, log: true },        // cycles per second per tymbal
    { id: 'drive', def: 0, min: 0, max: 1, step: 1 },             // Sync, Async (batch 04)
    { id: 'burst', def: 4, min: 1, max: 16, step: 1 },
    { id: 'lrphase', def: 0.5, min: 0, max: 0.5 },                // batch 03
    { id: 'pair', def: 0, min: 0, max: 2, step: 1 },              // Both, Left, Right (batch 03)
    { id: 'asym', def: 0.1, min: 0, max: 1 },
    { id: 'hold', def: 0.5, min: 0.05, max: 0.95 },               // OUT click, share of the cycle
    { id: 'heat', def: 30, min: 20, max: 40 },                    // °C
    // Tymbal
    { id: 'ribs', def: 4, min: 1, max: MAX_RIBS, step: 1 },
    { id: 'recruit', def: 3, min: 1, max: MAX_RIBS, step: 1 },
    { id: 'spacing', def: 0.6, min: 0.05, max: 10, log: true },   // ms
    { id: 'lead', def: 0, min: 0, max: 10, curve: 2 },            // ms
    { id: 'first', def: 0, min: -12, max: 12 },                   // st, rib 1 against the carrier
    { id: 'tilt', def: -5, min: -36, max: 12 },                   // st, last rib against rib 2
    { id: 'firstlevel', def: 0, min: -12, max: 6 },               // dB
    { id: 'taper', def: -4, min: -24, max: 6 },                   // dB, last rib against rib 2
    { id: 'tymbalq', def: 9, min: 2, max: 40, log: true },        // Q at the carrier
    { id: 'tune', def: 0, min: -12, max: 12 },                    // st, tymbal against the body
    { id: 'stiffness', def: 0.6, min: 0, max: 1 },                // batch 03
    { id: 'scatter', def: 0.03, min: 0, max: 1 },                 // batch 03
    { id: 'outratio', def: 1.5, min: 1, max: 3 },
    { id: 'outlevel', def: -10, min: -40, max: 0 },               // dB
    { id: 'outclicks', def: 0, min: 0, max: 1 },
    { id: 'outspeed', def: 0.3, min: 0.05, max: 1, log: true },
    // Body (batch 03, 06, 07)
    { id: 'body', def: 0, min: 0, max: 3, step: 1 },              // Helmholtz, Bladder, Open, Plant
    { id: 'bodyq', def: 6, min: 1, max: 40, log: true },
    { id: 'aperture', def: 1, min: 0, max: 1 },
    { id: 'membrane', def: 0, min: 0, max: 1 },
    { id: 'cavity', def: 0.2, min: 0, max: 1 },
    { id: 'extend', def: 1, min: 0, max: 1 },
    { id: 'split', def: 0, min: 0, max: 1 },
    { id: 'distance', def: 0.3, min: 0, max: 1 },
    { id: 'stem', def: 250, min: 20, max: 2000, log: true },
    { id: 'direct', def: 0.03, min: 0, max: 1 },
    // Song (batch 04)
    { id: 'song', def: 0, min: 0, max: 2, step: 1 },              // Continuous, Echeme, Phrase
    { id: 'echeme', def: 0.1, min: 0.005, max: 5, log: true },    // s
    { id: 'gap', def: 0.09, min: 0, max: 5, curve: 2 },           // s
    { id: 'phrase', def: 3, min: 0.2, max: 30, log: true },       // s
    { id: 'rest', def: 1, min: 0, max: 10, curve: 2 },            // s
    { id: 'start', def: 1, min: 0.05, max: 1 },
    { id: 'intro', def: 0, min: 0, max: 0.9 },
    { id: 'fall', def: 0, min: 0, max: 1 },
    { id: 'jitter', def: 0.03, min: 0, max: 1 },
    { id: 'rubato', def: 0.1, min: 0, max: 1 },
    { id: 'sync', def: 0, min: 0, max: 1, step: 1 },
    // Scale (batch 06)
    { id: 'time', def: 1, min: 0.1, max: 32, log: true },
    { id: 'link', def: 0, min: 0, max: 1 },
    // Chorus (batch 07)
    { id: 'chorus', def: 0, min: 0, max: 2, step: 1 },            // Free, Sync, Alternate
    { id: 'coupling', def: 0, min: 0, max: 1 },
    // Envelope: shapes effort (click level and recruitment), sampled at each stroke
    { id: 'attack', def: 0.01, min: 0.001, max: 5, curve: 3 },
    { id: 'decay', def: 0.3, min: 0.001, max: 5, curve: 3 },
    { id: 'sustain', def: 0.9, min: 0, max: 1 },
    { id: 'release', def: 0.05, min: 0.001, max: 8, curve: 3 },
    // Output
    { id: 'spread', def: 0.3, min: 0, max: 1 },
    { id: 'volume', def: -6, min: -48, max: 6 },                  // dB
  ];
  const PINDEX = {};
  PARAMS.forEach((p, i) => { PINDEX[p.id] = i; });

  // knob position (0–1) ↔ value, as the UI's knobs move
  function toNorm(d, v) {
    if (d.log) return Math.log(v / d.min) / Math.log(d.max / d.min);
    const n = (v - d.min) / (d.max - d.min);
    return d.curve ? Math.pow(Math.max(0, n), 1 / d.curve) : n;
  }
  function fromNorm(d, n) {
    n = n < 0 ? 0 : n > 1 ? 1 : n;
    let v = d.log ? d.min * Math.pow(d.max / d.min, n) : d.min + (d.max - d.min) * (d.curve ? Math.pow(n, d.curve) : n);
    if (d.step) v = Math.round(v / d.step) * d.step;
    return v;
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  const dbToGain = (db) => Math.pow(10, db / 20);

  function makeFir() {
    const h = new Float32Array(FIR_LEN);
    const fc = 0.5 / OS * 0.92, M = (FIR_LEN - 1) / 2;
    let sum = 0;
    for (let n = 0; n < FIR_LEN; n++) {
      const x = n - M;
      const s = x === 0 ? 2 * fc : Math.sin(TWO_PI * fc * x) / (Math.PI * x);
      const a = TWO_PI * n / (FIR_LEN - 1);
      const w = 0.35875 - 0.48829 * Math.cos(a) + 0.14128 * Math.cos(2 * a) - 0.01168 * Math.cos(3 * a);
      h[n] = s * w; sum += h[n];
    }
    for (let n = 0; n < FIR_LEN; n++) h[n] /= sum;
    return h;
  }

  // event kinds
  const EV_IN = 1, EV_OUTRIB = 2, EV_OUT = 3;

  /* ---------- one tymbal: muscle clock, rib events, retuning resonator ---------- */
  class Tymbal {
    constructor(v, side) {
      this.v = v; this.side = side;
      this.evT = new Float64Array(MAX_EV);     // absolute time, oversampled samples
      this.evKind = new Uint8Array(MAX_EV);
      this.evRib = new Uint8Array(MAX_EV);     // rib index (1-based), or the rib left IN after a pop
      this.evA = new Float64Array(MAX_EV);     // amplitude
      this.reset();
    }
    reset() {
      this.zr = 0; this.zi = 0;
      this.om = 0; this.rr = 0; this.cr = 1; this.ci = 0;   // ω, r, r·cos ω, r·sin ω
      this.nEv = 0; this.iEv = 0;
      this.nextStroke = Infinity;
      this.state = 0;                            // ribs currently IN (0 = OUT)
      this.lastF = 0; this.lastQ = 0;            // for the readout and tests
      this.strokes = 0;
    }
    energy() { return this.zr * this.zr + this.zi * this.zi; }

    // set the resonator to frequency f (Hz) and quality Q, keeping its state (the tymbal retunes)
    retune(f, Q) {
      const e = this.v.e;
      const om = TWO_PI * f / e.srOS;
      const r = Math.exp(-Math.PI * f / (Q * e.srOS));
      this.om = om; this.rr = r; this.cr = r * Math.cos(om); this.ci = r * Math.sin(om);
      this.lastF = f; this.lastQ = Q;
    }

    // queue one stroke starting at absolute time T0: ribs in, then the OUT click(s)
    stroke(T0) {
      const v = this.v, e = v.e;
      const effort = v.effortNow;
      const cycle = e.srOS / (e.rateNow * e.heatF);
      const ribs = e.ribs;
      const nWant = Math.max(1, Math.min(ribs, Math.round(e.recruit * Math.sqrt(effort))));
      const sp = e.spacingS / e.heatF, ld = e.leadS / e.heatF;
      const tOut = T0 + e.hold * cycle;
      const tEnd = T0 + cycle - 1;
      const A = A_REF * effort;
      let n = 0, nIn = 0;
      for (let k = 1; k <= nWant; k++) {
        const t = k === 1 ? T0 : T0 + ld + (k - 1) * sp;
        if (k > 1 && t >= tOut - 1) break;      // the muscle lets go before this rib buckles
        this.evT[n] = t; this.evKind[n] = EV_IN; this.evRib[n] = k; this.evA[n] = A * e.ribGain[k]; n++; nIn = k;
      }
      // popping out: the recruited ribs in reverse order, then the plate
      const nPop = Math.round(e.outclicks * nIn);
      const osp = Math.max(1, sp * e.outspeed);
      let t = tOut;
      for (let j = 0; j < nPop; j++) {
        const k = nIn - j;                       // rib k pops out; ribs 1..k−1 stay IN
        if (t >= tEnd) break;
        this.evT[n] = t; this.evKind[n] = EV_OUTRIB; this.evRib[n] = k - 1; this.evA[n] = A * e.outGain * dbToGain(OUTRIB_DB); n++;
        t += osp;
      }
      if (t >= tEnd) t = tEnd - 1;
      this.evT[n] = t; this.evKind[n] = EV_OUT; this.evRib[n] = 0; this.evA[n] = A * e.outGain; n++;
      this.nEv = n; this.iEv = 0;
      this.nextStroke = T0 + cycle;
      this.strokes++;
    }

    nextTime() {
      if (this.iEv < this.nEv) return this.evT[this.iEv];
      return this.nextStroke;
    }

    // apply the event due now; d = how far past the last output sample it falls (0 < d ≤ 1)
    fire(d) {
      const v = this.v, e = v.e;
      if (this.iEv >= this.nEv) {                // a new stroke is due
        if (!v.muscleOn) { this.nextStroke = Infinity; return; }
        this.stroke(this.nextStroke);
        return;                                  // its first event is handled on the next pass
      }
      const i = this.iEv++;
      const kind = this.evKind[i], k = this.evRib[i];
      let f, Q, phase;
      if (kind === EV_IN) { f = e.ribF[k]; Q = e.ribQ[k]; phase = CLICK_PHASE; this.state = k; }
      else if (kind === EV_OUTRIB) { f = k > 0 ? e.ribF[k] : e.outF; Q = k > 0 ? e.ribQ[k] : e.outQ; phase = CLICK_PHASE + Math.PI; this.state = k; }
      else { f = e.outF; Q = e.outQ; phase = CLICK_PHASE + Math.PI; this.state = 0; }
      this.retune(f, Q);
      // amplitude so the first full lobe peaks at evA: it comes 0.35 cycle after the start
      const a = this.evA[i] * Math.exp(Math.PI * 0.35 / Q);
      // the phasor a·e^{iφ} belongs to the event time; step it back d samples to the last output sample
      const back = Math.pow(this.rr, -d), th = phase - this.om * d;
      this.zr += a * back * Math.cos(th);
      this.zi += a * back * Math.sin(th);
      if (e.onsets && kind === EV_IN && k === 1) e.onsets.push(this.side);
    }

    // run the resonator over [j0, j1) of the block, adding to out
    run(j0, j1, out, gain) {
      let zr = this.zr, zi = this.zi;
      const cr = this.cr, ci = this.ci, omK = this.om * KAPPA, inv = 1 / (A_REF * A_REF);
      for (let j = j0; j < j1; j++) {
        let m = (zr * zr + zi * zi) * inv; if (m > 1) m = 1;
        const eps = omK * m, ca = 1 - 0.5 * eps * eps;
        // rotate by r·e^{iω} · e^{−iε}
        const rr = cr * ca + ci * eps, ri = ci * ca - cr * eps;
        const nr = zr * rr - zi * ri; zi = zr * ri + zi * rr; zr = nr;
        out[j] += zr * gain;
      }
      if (zr * zr + zi * zi < 1e-30) { zr = 0; zi = 0; }
      this.zr = zr; this.zi = zi;
    }
  }

  /* ---------- one voice ---------- */
  class Voice {
    constructor(e, seed) {
      this.e = e;
      this.seed = (seed >>> 0) || 1;
      this.tym = [new Tymbal(this, 0), new Tymbal(this, 1)];
      this.reset();
    }
    reset() {
      this.rng = this.seed;
      this.stage = 0; this.env = 0; this.note = -1; this.held = false; this.vel = 1; this.age = 0;
      this.logF = Math.log2(4186); this.glideLeft = 0; this.glideStep = 0;
      this.effortNow = 0; this.muscleOn = false; this.fNow = 0;
      for (const t of this.tym) t.reset();
    }
    rand() {
      let x = this.rng;
      x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
      this.rng = x;
      return x / 4294967296;
    }
    active() { return this.stage !== 0; }

    pitchTarget(note) {
      const m = this.e.m;
      return Math.log2(440) + (note - 69 + 48 + m[PINDEX.transpose] + m[PINDEX.detune] / 100) / 12;
    }
    setTarget(note, glide) {
      const t = this.pitchTarget(note);
      const g = this.e.m[PINDEX.glide];
      if (glide && g > 0.0015) {
        const steps = Math.max(1, Math.round(g * this.e.sr / BLOCK));
        this.glideStep = (t - this.logF) / steps; this.glideLeft = steps;
      } else { this.logF = t; this.glideLeft = 0; }
      this.note = note;
    }
    trigger(vel) {
      const e = this.e;
      this.vel = 0.2 + 0.8 * clamp(vel / 127, 0, 1);
      const fresh = this.stage === 0;
      this.stage = 1; this.held = true; this.age = ++e.ageCounter;
      if (fresh) {
        this.env = 0;
        for (const t of this.tym) t.reset();
        this.muscleOn = true;
        // the first stroke starts with the next block
        this.tym[0].nextStroke = e.osTimeBase;
        e.voicePitch(this);
        this.tym[0].retune(e.outF, e.outQ);
      } else if (!this.muscleOn) {
        this.muscleOn = true;
        this.tym[0].nextStroke = Math.max(this.tym[0].nextStroke === Infinity ? e.osTimeBase : this.tym[0].nextStroke, e.osTimeBase);
      }
    }
    release() { if (this.stage !== 0) { this.stage = 4; this.held = false; } }

    // envelope, once per block: effort for the strokes that start in it
    stepEnvelope() {
      const e = this.e, m = e.m, dt = BLOCK / e.sr;
      const sus = m[PINDEX.sustain];
      if (this.stage === 1) { this.env += dt / Math.max(1e-4, m[PINDEX.attack]); if (this.env >= 1) { this.env = 1; this.stage = 2; } }
      else if (this.stage === 2) { this.env = sus + (this.env - sus) * Math.exp(-4 * dt / m[PINDEX.decay]); if (Math.abs(this.env - sus) < 1e-4) { this.env = sus; this.stage = 3; } }
      else if (this.stage === 4) { this.env *= Math.exp(-4 * dt / m[PINDEX.release]); }
      this.effortNow = this.env * this.vel;
      if (this.stage === 4 && this.effortNow < STOP_EFFORT) this.muscleOn = false;
    }

    render(nOS, out) {
      const e = this.e;
      if (this.glideLeft > 0) { this.logF += this.glideStep; this.glideLeft--; }
      this.stepEnvelope();
      e.voicePitch(this);
      const t0 = e.osTimeBase;
      const tym = this.tym[0];                   // batch 02: the left tymbal only
      let j = 0;
      for (;;) {
        const rel = tym.nextTime() - t0;
        if (rel >= nOS) { tym.run(j, nOS, out, 1); break; }
        // samples strictly before the event
        const upto = Math.min(nOS, Math.max(j, Math.ceil(rel)));
        if (upto > j) { tym.run(j, upto, out, 1); j = upto; }
        if (j >= nOS) break;
        const d = clamp(rel - (j - 1), 1e-9, 1);
        tym.fire(d);
      }
      // done: the muscle has stopped and the ringing has died away
      if (!this.muscleOn && tym.iEv >= tym.nEv && tym.energy() < 1e-14) { this.stage = 0; this.note = -1; this.held = false; tym.reset(); }
      this.fNow = e.fCarrier;
    }
  }

  /* ---------- engine ---------- */
  class TymbalEngine {
    constructor(sampleRate, seed) {
      this.sr = sampleRate; this.srOS = sampleRate * OS;
      this.p = new Float64Array(PARAMS.length);
      PARAMS.forEach((d, i) => { this.p[i] = d.def; });
      this.m = Float64Array.from(this.p);          // effective values (LFOs later)
      this.fir = makeFir();
      this.histL = new Float32Array(FIR_LEN * 2); this.histR = new Float32Array(FIR_LEN * 2); this.hw = 0;
      this.os = new Float32Array(BLOCK * OS);
      this.blkL = new Float32Array(BLOCK); this.blkR = new Float32Array(BLOCK); this.blkPos = BLOCK;
      this.ribF = new Float64Array(MAX_RIBS + 1); this.ribQ = new Float64Array(MAX_RIBS + 1); this.ribGain = new Float64Array(MAX_RIBS + 1);
      this.ageCounter = 0; this.quietBlocks = 0;
      this.stack = [];
      this.bendNorm = 0; this.tempo = 120;
      this.dc = { xl: 0, yl: 0, R: 1 - 2 * Math.PI * 10 / sampleRate };
      this.osTimeBase = 0; this.onsets = null;
      const base = (seed >>> 0) || 0x9e3779b9;
      this.voices = [];
      for (let i = 0; i < MAX_VOICES; i++) this.voices.push(new Voice(this, (base + i * 0x6d2b79f5) >>> 0));
      this.updateControls();
      this.info = { voices: 0, carrier: 0, rib: 0, f: 0, q: 0 };
    }

    static get LATENCY() { return BLOCK; }
    static get PARAMS() { return PARAMS; }

    setParam(id, v) {
      const i = PINDEX[id];
      if (i === undefined || !Number.isFinite(v)) return;
      const d = PARAMS[i];
      this.p[i] = clamp(d.step ? Math.round(v / d.step) * d.step : v, d.min, d.max);
      if (id === 'mode') this.allNotesOff();
    }
    getParam(id) { return this.p[PINDEX[id]]; }
    setBend(norm) { this.bendNorm = clamp(norm, -1, 1); }
    setTempo(bpm) { this.tempo = clamp(bpm, 20, 400); }

    noteOn(note, vel) {
      if (vel <= 0) { this.noteOff(note); return; }
      this.m.set(this.p); this.updateControls();
      if (this.p[PINDEX.mode] === 0) {
        const v = this.voices[0];
        const i = this.stack.indexOf(note); if (i >= 0) this.stack.splice(i, 1);
        this.stack.push(note);
        const legato = v.active() && v.held;
        v.setTarget(note, legato);
        if (!legato) v.trigger(vel);
        else v.vel = 0.2 + 0.8 * clamp(vel / 127, 0, 1);
        return;
      }
      for (const v of this.voices) if (v.active() && v.note === note) { v.setTarget(note, false); v.trigger(vel); return; }
      let pick = null;
      for (const v of this.voices) if (!v.active()) { pick = v; break; }
      if (!pick) { for (const v of this.voices) if (!v.held && (!pick || v.age < pick.age)) pick = v; }
      if (!pick) { for (const v of this.voices) if (!pick || v.age < pick.age) pick = v; }
      pick.setTarget(note, false);
      pick.trigger(vel);
    }
    noteOff(note) {
      if (this.p[PINDEX.mode] === 0) {
        const i = this.stack.indexOf(note); if (i >= 0) this.stack.splice(i, 1);
        const v = this.voices[0];
        if (!v.active() || v.note !== note) return;
        if (this.stack.length) v.setTarget(this.stack[this.stack.length - 1], true);
        else v.release();
        return;
      }
      for (const v of this.voices) if (v.note === note && v.held) v.release();
    }
    allNotesOff() { this.stack.length = 0; for (const v of this.voices) v.release(); }

    // per-block control values shared by all voices
    updateControls() {
      const P = this.m;
      this.heatF = Math.pow(HEAT_BASE, (P[PINDEX.heat] - 30) / 15);
      this.rateNow = P[PINDEX.rate];
      this.hold = P[PINDEX.hold];
      this.ribs = Math.round(P[PINDEX.ribs]);
      this.recruit = Math.min(this.ribs, Math.round(P[PINDEX.recruit]));
      this.spacingS = P[PINDEX.spacing] / 1000 * this.srOS;
      this.leadS = P[PINDEX.lead] / 1000 * this.srOS;
      this.outclicks = P[PINDEX.outclicks];
      this.outspeed = P[PINDEX.outspeed];
      this.outGain = dbToGain(P[PINDEX.outlevel]);
      this.vol = dbToGain(P[PINDEX.volume]);
      this.bendOct = this.bendNorm * P[PINDEX.bendrange] / 12;
      // rib levels: rib 2 is the reference (0 dB); later ribs follow taper along u²
      const n = this.ribs, taper = P[PINDEX.taper];
      this.ribGain[1] = dbToGain(P[PINDEX.firstlevel]);
      for (let k = 2; k <= n; k++) { const u = n > 2 ? (k - 2) / (n - 2) : 0; this.ribGain[k] = dbToGain(taper * u * u); }
    }

    // rib frequencies and Qs for a voice's carrier: rib 2 sits on the (tuned) carrier, rib 1 at
    // First, later ribs fall along tilt·u²; Q follows 1/f from Tymbal Q at the carrier
    voicePitch(v) {
      const P = this.m;
      let f = Math.pow(2, v.logF + this.bendOct);
      while (f > F_CAP) f *= 0.5;
      if (f < F_MIN) f = F_MIN;
      this.fCarrier = f;
      const ft = f * Math.pow(2, P[PINDEX.tune] / 12), q0 = P[PINDEX.tymbalq];
      const n = this.ribs, tilt = P[PINDEX.tilt];
      this.ribF[1] = ft * Math.pow(2, P[PINDEX.first] / 12);
      for (let k = 2; k <= n; k++) { const u = n > 2 ? (k - 2) / (n - 2) : 0; this.ribF[k] = ft * Math.pow(2, tilt * u * u / 12); }
      for (let k = 1; k <= n; k++) this.ribQ[k] = q0 * ft / this.ribF[k];
      this.outF = ft * P[PINDEX.outratio];
      this.outQ = q0 * ft / this.outF;
    }

    processBlock() {
      const d0 = this.dc;
      const any = this.voices.some(v => v.stage !== 0);
      if (!any && this.quietBlocks > 1 && Math.abs(d0.yl) < 1e-12 && Math.abs(d0.xl) < 1e-12) {
        this.blkL.fill(0); this.blkR.fill(0); d0.xl = d0.yl = 0;
        this.osTimeBase += BLOCK * OS;
        this.info.voices = 0; this.info.idle = true;
        return;
      }
      this.m.set(this.p);
      this.updateControls();
      const nOS = BLOCK * OS, o = this.os;
      o.fill(0);
      let count = 0, newest = -1;
      for (const v of this.voices) if (v.stage !== 0) {
        v.render(nOS, o);
        count++;
        if (v.age > newest) { newest = v.age; this.info.carrier = v.fNow; this.info.rib = v.tym[0].state; this.info.f = v.tym[0].lastF; this.info.q = v.tym[0].lastQ; }
      }
      this.osTimeBase += nOS;
      this.info.voices = count; this.info.idle = false;
      this.quietBlocks = count === 0 ? this.quietBlocks + 1 : 0;
      // decimate (symmetric FIR), DC block, volume, clip; batch 02 is mono, centred
      const L = FIR_LEN, H = FIR_LEN / 2, h = this.fir, hl = this.histL, vol = this.vol, d = this.dc;
      let hw = this.hw;
      for (let j = 0, k = 0; j < BLOCK; j++) {
        for (let q = 0; q < OS; q++, k++) { hl[hw] = hl[hw + L] = o[k]; hw = hw + 1 === L ? 0 : hw + 1; }
        let a = 0;
        for (let t = 0, u = hw + L - 1; t < H; t++, u--) a += h[t] * (hl[hw + t] + hl[u]);
        const y = a - d.xl + d.R * d.yl; d.xl = a; d.yl = y;
        let s = y * vol;
        s = s > 1 ? 1 : s < -1 ? -1 : s;
        this.blkL[j] = s; this.blkR[j] = s;
      }
      this.hw = hw;
      if (Math.abs(d.yl) < 1e-20) d.yl = 0;
    }

    // host calls with any n; work happens in fixed BLOCK chunks
    process(outL, outR, n) {
      let pos = this.blkPos;
      for (let j = 0; j < n; j++) {
        if (pos === BLOCK) { this.processBlock(); pos = 0; }
        outL[j] = this.blkL[pos];
        if (outR) outR[j] = this.blkR[pos];
        pos++;
      }
      this.blkPos = pos;
    }
  }

  TymbalEngine.BLOCK = BLOCK; TymbalEngine.OS = OS;
  TymbalEngine.toNorm = toNorm; TymbalEngine.fromNorm = fromNorm;
  const core = { CLICK_PHASE, KAPPA, A_REF, HEAT_BASE, OUTRIB_DB };
  if (typeof module !== 'undefined' && module.exports) module.exports = { TymbalEngine, PARAMS, core };
  else root.TymbalEngine = TymbalEngine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
