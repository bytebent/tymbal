/*
 * tymbal engine · bytebent
 *
 * An insect tymbal voice. Each voice has two tymbals and a body. A tymbal is a state machine
 * (OUT → rib 1 IN → … → rib n IN → OUT) driving one resonator that retunes with the state: each
 * rib that buckles strikes it at its own frequency and Q, and when the muscle relaxes the tymbal
 * pops out with one quieter, higher click (Bennet-Clark 1997; Young & Bennet-Clark 1995). Both
 * tymbals drive the body, a resonator at the carrier. The body acts back only through timing: its
 * phase can pull the moment each rib buckles (the lock), which is how a slack tymbal sings a pure
 * tone (Young & Josephson 1983). See design.md.
 *
 * Resonators are complex one-poles: z ← z · r·e^{iω}, output Re(z). A click adds a phasor at its
 * exact sub-sample time. The start phase gives the measured shape: a short, small inward
 * half-wave, then a larger rebound. Each click first runs in a short transient whose frequency
 * starts 7.5% low and rises over a few cycles (Bennet-Clark 1997: +150–350 Hz through the decay),
 * then merges into the tymbal's resonator, so the nonlinear start never pulls the pitch.
 *
 * Batch 03: two tymbals, Helmholtz and Open bodies, the lock, Carrier mode. Every parameter of the
 * design is in the table; the ones a later batch builds are accepted and ignored until then.
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
  const KAPPA = 0.075;          // a click's frequency starts 7.5% low (Bennet-Clark 1997: +150–350 Hz through the decay)
  const TRANS_CYC = 1.5;        // … and recovers with this time constant, in cycles; merged after 4 time constants
  const TRANS_LAG = KAPPA * TWO_PI * TRANS_CYC * (1 - Math.exp(-4));   // phase a click has lost when it merges (rad)
  const LOCK_AIM = 0.5 * TRANS_LAG;    // the lock aims this early: the click's mean phase over its transient
  // pitch keeper: while ribs lock, the body's measured phase advance is held to the note
  const KEEP_RATE = 0.05;       // share of the error corrected per block (about 13 ms at 48 kHz)
  const KEEP_MAX = 0.1;         // octaves
  const KEEP_LOCKED = 0.5;      // acts only while at least this share of recent ribs lock
  const A_REF = 0.25;           // click amplitude at full effort
  const OUTRIB_DB = -6;         // ribs popping out, against the OUT plate click
  const HEAT_BASE = 1.846;      // M. cassini sub-pulses 650 → 1200 Hz from 20 to 35 °C (Young & Josephson 1983)
  const STOP_EFFORT = 0.01;     // below this the muscle stops
  // the lock (Bennet-Clark 1997: locked above about ⅓ of the last pulse's peak, broken below ¼)
  const LOCK_GATE = 0.25;
  const PEAK_TAU = 0.03;        // s, slow release of that peak (it restarts at every click)
  // Helmholtz body (Bennet-Clark & Young 1992, Table 2: model opercula removed vs a 0.5–1 mm gap)
  const AP_F_CLOSED = 3.54 / 4.33, AP_Q_CLOSED = 5.2 / 7.8, AP_DB_CLOSED = 56.2 - 65.6;
  const MEMBRANE_Q = 3;         // Q × (1 + 3·Membrane): M. septendecim's Q 25 against about 6
  const MEMBRANE_DB = -6;
  const CAVITY_RATIOS = [1.75, 2.1];   // weak model resonances near 7.5 and 9 kHz above 4.3 kHz
  const BODY_GAIN = 2.5;        // body output against the bare tymbal (tuned by level, see tests.md)
  const STIFF_DB = 9;           // click level from Stiffness 0 to 1 (louder when stiff), 0 dB at 0.6

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
  const BODY_HELMHOLTZ = 0, BODY_BLADDER = 1, BODY_OPEN = 2, BODY_PLANT = 3;

  /* ---------- one tymbal: muscle clock, rib events, retuning resonator ---------- */
  class Tymbal {
    constructor(v, side) {
      this.v = v; this.side = side;
      this.evT = new Float64Array(MAX_EV);     // absolute time, oversampled samples (moved by the lock)
      this.evKind = new Uint8Array(MAX_EV);
      this.evRib = new Uint8Array(MAX_EV);     // rib index (1-based), or the rib left IN after a pop
      this.evA = new Float64Array(MAX_EV);     // amplitude
      this.evDec = new Uint8Array(MAX_EV);     // 1 once the lock has set its moment
      this.reset();
    }
    reset() {
      this.zr = 0; this.zi = 0;                  // the tymbal's resonator
      this.wr = 0; this.wi = 0;                  // the newest click's nonlinear transient
      this.weps = 0; this.wdec = 1; this.wleft = 0;
      this.om = 0; this.rr = 0; this.cr = 1; this.ci = 0;   // ω, r, r·cos ω, r·sin ω
      this.nEv = 0; this.iEv = 0;
      this.nextStroke = Infinity;
      this.state = 0;                            // ribs currently IN (0 = OUT)
      this.lastF = 0; this.lastQ = 0;
      this.strokes = 0; this.pk2 = 0;
    }
    energy() { return this.zr * this.zr + this.zi * this.zi + this.wr * this.wr + this.wi * this.wi; }

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
      const sp = e.spacingS / e.heatF, ld = e.leadS * e.leadF / e.heatF;
      const tOut = T0 + e.hold * cycle;
      const tEnd = T0 + cycle - 1;
      const A = A_REF * effort * e.stiffGain * (this.side ? e.asymG : 1);
      const sc = e.scatter * v.periodS;         // up to one carrier period either way
      let n = 0, nIn = 0;
      for (let k = 1; k <= nWant; k++) {
        let t = k === 1 ? T0 : T0 + ld + (k - 1) * sp;
        if (k > 1 && t >= tOut - 1) break;      // the muscle lets go before this rib buckles
        if (sc > 0) t += sc * (2 * v.rand() - 1);
        if (n > 0 && t <= this.evT[n - 1]) t = this.evT[n - 1] + 1;
        this.evT[n] = t; this.evKind[n] = EV_IN; this.evRib[n] = k; this.evA[n] = A * e.ribGain[k]; this.evDec[n] = 0; n++; nIn = k;
      }
      // popping out: the recruited ribs in reverse order, then the plate
      const nPop = Math.round(e.outclicks * nIn);
      const osp = Math.max(1, sp * e.outspeed);
      let t = Math.max(tOut, this.evT[n - 1] + 1);
      for (let j = 0; j < nPop; j++) {
        const k = nIn - j;                       // rib k pops out; ribs 1..k−1 stay IN
        if (t >= tEnd) break;
        this.evT[n] = t; this.evKind[n] = EV_OUTRIB; this.evRib[n] = k - 1; this.evA[n] = A * e.outGain * dbToGain(OUTRIB_DB); this.evDec[n] = 1; n++;
        t += osp;
      }
      if (t >= tEnd) t = Math.max(this.evT[n - 1] + 1, tEnd - 1);
      this.evT[n] = t; this.evKind[n] = EV_OUT; this.evRib[n] = 0; this.evA[n] = A * e.outGain; this.evDec[n] = 1; n++;
      this.nEv = n; this.iEv = 0;
      this.nextStroke = T0 + cycle;
      this.strokes++;
    }

    // when this tymbal next needs attention: an IN rib is decided half a period before its moment
    nextTime() {
      const i = this.iEv;
      if (i < this.nEv) return this.evDec[i] ? this.evT[i] : this.evT[i] - this.v.halfT;
      return this.nextStroke;
    }

    // handle what is due; sNow = time of the last output sample, d = event time − sNow (0 < d ≤ 1)
    step(sNow, d) {
      const v = this.v;
      if (this.iEv >= this.nEv) {                // a new stroke is due
        if (!v.muscleOn || !v.e.tymOn[this.side]) { this.nextStroke = Infinity; return; }
        this.stroke(this.nextStroke);
        return;
      }
      const i = this.iEv;
      if (!this.evDec[i]) { v.decide(this, i, sNow); this.evDec[i] = 1; return; }
      this.fire(d);
    }

    fire(d) {
      const v = this.v, e = v.e;
      const i = this.iEv++;
      const kind = this.evKind[i], k = this.evRib[i];
      let f, Q, phase;
      if (kind === EV_IN) { f = e.ribF[k]; Q = e.ribQ[k]; phase = CLICK_PHASE; this.state = k; e.stats.ins++; }
      else if (kind === EV_OUTRIB) { f = k > 0 ? e.ribF[k] : e.outF; Q = k > 0 ? e.ribQ[k] : e.outQ; phase = CLICK_PHASE + Math.PI; this.state = k; }
      else { f = e.outF; Q = e.outQ; phase = CLICK_PHASE + Math.PI; this.state = 0; }
      if (this.side) { f *= e.asymF; Q /= e.asymF; }
      // the lock gate compares with the peak since the last click (Bennet-Clark 1997: the preceding pulse)
      v.pk2 = v.b0r * v.b0r + v.b0i * v.b0i;
      this.pk2 = (this.zr + this.wr) * (this.zr + this.wr) + (this.zi + this.wi) * (this.zi + this.wi);
      // the previous click's transient is over: merge it into the resonator
      if (this.wleft > 0) { this.zr += this.wr; this.zi += this.wi; this.wr = this.wi = 0; this.wleft = 0; }
      this.retune(f, Q);
      // amplitude so the first full lobe peaks at evA: it comes 0.35 cycle after the start
      const a = this.evA[i] * Math.exp(Math.PI * 0.35 / Q);
      // the phasor a·e^{iφ} belongs to the event time; step it back d samples to the last output sample
      const back = Math.pow(this.rr, -d), th = phase - this.om * d;
      this.wr = a * back * Math.cos(th);
      this.wi = a * back * Math.sin(th);
      // its frequency starts KAPPA low and recovers over TRANS_CYC cycles
      const tau = TRANS_CYC * TWO_PI / this.om;
      this.weps = KAPPA * this.om; this.wdec = Math.exp(-1 / tau); this.wleft = Math.ceil(4 * tau);
      if (e.onsets && kind === EV_IN && k === 1) e.onsets.push(this.side);
    }

    // run over [j0, j1) of the block: add the complex output to sRe/sIm, the panned real output to dL/dR
    advance(j0, j1, sRe, sIm, dL, dR, gL, gR) {
      let zr = this.zr, zi = this.zi, wr = this.wr, wi = this.wi, eps = this.weps, left = this.wleft, pk2 = this.pk2;
      const cr = this.cr, ci = this.ci, dec = this.wdec, pdec = this.v.e.pkDec;
      for (let j = j0; j < j1; j++) {
        const nr = zr * cr - zi * ci; zi = zr * ci + zi * cr; zr = nr;
        let ur = zr, ui = zi;
        if (left > 0) {
          // rotate by r·e^{i(ω − ε)}
          const ca = 1 - 0.5 * eps * eps, rr = cr * ca + ci * eps, ri = ci * ca - cr * eps;
          const nw = wr * rr - wi * ri; wi = wr * ri + wi * rr; wr = nw;
          eps *= dec;
          if (--left === 0) { zr += wr; zi += wi; wr = 0; wi = 0; }
          ur = zr + wr; ui = zi + wi;
        }
        sRe[j] += ur; sIm[j] += ui; dL[j] += ur * gL; dR[j] += ur * gR;
        const a2 = ur * ur + ui * ui; pk2 *= pdec; if (a2 > pk2) pk2 = a2;
      }
      if (zr * zr + zi * zi < 1e-30) { zr = 0; zi = 0; }
      this.zr = zr; this.zi = zi; this.wr = wr; this.wi = wi; this.weps = eps; this.wleft = left; this.pk2 = pk2;
    }
  }

  /* ---------- one voice: two tymbals and a body ---------- */
  class Voice {
    constructor(e, seed) {
      this.e = e;
      this.seed = (seed >>> 0) || 1;
      this.tym = [new Tymbal(this, 0), new Tymbal(this, 1)];
      const n = BLOCK * OS;
      this.sRe = new Float64Array(n); this.sIm = new Float64Array(n);
      this.dL = new Float64Array(n); this.dR = new Float64Array(n);
      this.reset();
    }
    reset() {
      this.rng = this.seed;
      this.stage = 0; this.env = 0; this.note = -1; this.held = false; this.vel = 1; this.age = 0;
      this.logF = Math.log2(4186); this.glideLeft = 0; this.glideStep = 0;
      this.effortNow = 0; this.muscleOn = false; this.fNow = 0;
      this.periodS = 1; this.halfT = 0;
      this.kc = 0; this.lockFrac = 0; this.omNote = 0;   // pitch keeper: correction (octaves), recent lock share
      // body: main mode b0 and two cavity modes, a low-pass, the peak the lock gate uses
      this.b0r = this.b0i = this.b1r = this.b1i = this.b2r = this.b2i = 0; this.lp = 0; this.pk2 = 0;
      this.om0 = 0; this.r0 = 0; this.c0r = 1; this.c0i = 0; this.g0 = 0;
      this.c1r = 1; this.c1i = 0; this.g1 = 0; this.c2r = 1; this.c2i = 0; this.g2 = 0;
      this.kLP = 1; this.bodyLevel = 1;
      for (const t of this.tym) t.reset();
    }
    rand() {
      let x = this.rng;
      x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
      this.rng = x;
      return x / 4294967296;
    }
    active() { return this.stage !== 0; }
    bodyEnergy() { return this.b0r * this.b0r + this.b0i * this.b0i + this.b1r * this.b1r + this.b1i * this.b1i + this.b2r * this.b2r + this.b2i * this.b2i + this.lp * this.lp; }

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
      const T0 = e.osTimeBase, cycle = e.srOS / (e.rateNow * e.heatF);
      if (fresh) {
        this.env = 0;
        for (const t of this.tym) t.reset();
        this.b0r = this.b0i = this.b1r = this.b1i = this.b2r = this.b2i = 0; this.lp = 0; this.pk2 = 0;
        this.kc = 0; this.lockFrac = 0;
        e.voicePitch(this);
        for (const t of this.tym) t.retune(e.outF, e.outQ);
      }
      this.muscleOn = true;
      // the left tymbal starts with the next block, the right one Lr phase of a cycle later
      for (const t of this.tym) {
        if (t.iEv < t.nEv || t.nextStroke !== Infinity) continue;
        t.nextStroke = T0 + (t.side ? e.lrphase * cycle : 0);
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

    // the lock: move rib i of tymbal tym towards the next moment its click adds in phase with the
    // reference (the body's main mode, or with an Open body the tymbal's own ringing)
    decide(tym, i, sNow) {
      const e = this.e;
      let xr, xi, om, r, pk2;
      if (e.bodyOn) { xr = this.b0r; xi = this.b0i; om = this.om0; r = this.r0; pk2 = this.pk2; }
      else { xr = tym.zr + tym.wr; xi = tym.zi + tym.wi; om = tym.om; r = tym.rr; pk2 = tym.pk2; }
      const tn = tym.evT[i];
      let t = tn, locked = 0;
      if (pk2 > 1e-24 && om > 0 && e.lockW > 0) {
        const ph = Math.atan2(xi, xr) + om * (tn - sNow);
        // aim a little early: averaged over its slow start, the click is in phase with the reference
        let dph = CLICK_PHASE - LOCK_AIM - ph; dph -= TWO_PI * Math.round(dph / TWO_PI);
        const tstar = tn + dph / om;
        const amp2 = (xr * xr + xi * xi) * Math.pow(r, 2 * (tstar - sNow));
        if (amp2 >= LOCK_GATE * LOCK_GATE * pk2) {
          const w = e.lockW * Math.PI / om;      // up to half a period, less as Stiffness rises
          t = tn + clamp(tstar - tn, -w, w);
          if (Math.abs(tstar - tn) <= w + 1e-9) { e.stats.locked++; locked = 1; }
        }
      }
      this.lockFrac += 0.05 * (locked - this.lockFrac);
      tym.evT[i] = Math.max(t, sNow + 1e-6);
    }

    // pitch keeper: compare the body's phase advance over the block with the note's
    keep(s0r, s0i, nOS) {
      const e = this.e;
      if (!e.bodyOn || this.lockFrac < KEEP_LOCKED) { this.kc *= 0.995; return; }
      const a0 = s0r * s0r + s0i * s0i, a1 = this.b0r * this.b0r + this.b0i * this.b0i;
      if (a0 < 1e-12 || a1 < 1e-12 || a1 < 1e-4 * this.pk2) return;
      // advance = arg(b_end · conj(b_start)), against the note's ω over the block (both wrapped)
      const adv = Math.atan2(this.b0i * s0r - this.b0r * s0i, this.b0r * s0r + this.b0i * s0i);
      let err = adv - this.omNote * nOS; err -= TWO_PI * Math.round(err / TWO_PI);
      err = clamp(err, -0.3, 0.3);
      this.kc = clamp(this.kc - KEEP_RATE * err / (this.omNote * nOS) / Math.LN2, -KEEP_MAX, KEEP_MAX);
    }

    // run tymbals and body over [j0, j1)
    run(j0, j1, oL, oR) {
      const e = this.e;
      for (const t of this.tym) t.advance(j0, j1, this.sRe, this.sIm, this.dL, this.dR, e.panL[t.side], e.panR[t.side]);
      const sRe = this.sRe, sIm = this.sIm, dL = this.dL, dR = this.dR;
      if (!e.bodyOn) {
        for (let j = j0; j < j1; j++) { oL[j] += dL[j]; oR[j] += dR[j]; }
        return;
      }
      let b0r = this.b0r, b0i = this.b0i, b1r = this.b1r, b1i = this.b1i, b2r = this.b2r, b2i = this.b2i, lp = this.lp, pk2 = this.pk2;
      const c0r = this.c0r, c0i = this.c0i, g0 = this.g0, c1r = this.c1r, c1i = this.c1i, g1 = this.g1, c2r = this.c2r, c2i = this.c2i, g2 = this.g2;
      const k = this.kLP, lvl = this.bodyLevel, dir = e.direct, pdec = e.pkDec;
      for (let j = j0; j < j1; j++) {
        const ur = sRe[j], ui = sIm[j];
        let n = b0r * c0r - b0i * c0i + g0 * ur; b0i = b0r * c0i + b0i * c0r + g0 * ui; b0r = n;
        n = b1r * c1r - b1i * c1i + g1 * ur; b1i = b1r * c1i + b1i * c1r + g1 * ui; b1r = n;
        n = b2r * c2r - b2i * c2i + g2 * ur; b2i = b2r * c2i + b2i * c2r + g2 * ui; b2r = n;
        lp += k * (b0r + b1r + b2r - lp);
        const y = lp * lvl;
        oL[j] += y + dir * dL[j]; oR[j] += y + dir * dR[j];
        const a2 = b0r * b0r + b0i * b0i; pk2 *= pdec; if (a2 > pk2) pk2 = a2;
      }
      this.b0r = b0r; this.b0i = b0i; this.b1r = b1r; this.b1i = b1i; this.b2r = b2r; this.b2i = b2i; this.lp = lp; this.pk2 = pk2;
    }

    render(nOS, oL, oR) {
      const e = this.e;
      if (this.glideLeft > 0) { this.logF += this.glideStep; this.glideLeft--; }
      this.stepEnvelope();
      e.voicePitch(this);
      const t0 = e.osTimeBase;
      this.sRe.fill(0); this.sIm.fill(0); this.dL.fill(0); this.dR.fill(0);
      // a tymbal switched back on by Pair starts with this block
      for (const t of this.tym) if (this.muscleOn && e.tymOn[t.side] && t.iEv >= t.nEv && t.nextStroke === Infinity) t.nextStroke = t0;
      const s0r = this.b0r, s0i = this.b0i;
      let j = 0;
      for (;;) {
        let tb = Infinity, which = null;
        for (const t of this.tym) { const x = t.nextTime(); if (x < tb) { tb = x; which = t; } }
        const rel = tb - t0;
        if (rel >= nOS) { this.run(j, nOS, oL, oR); break; }
        const upto = Math.min(nOS, Math.max(j, Math.ceil(rel)));
        if (upto > j) { this.run(j, upto, oL, oR); j = upto; }
        if (j >= nOS) break;
        which.step(t0 + j - 1, clamp(rel - (j - 1), 1e-9, 1));
      }
      this.keep(s0r, s0i, nOS);
      // done: the muscle has stopped and everything has rung out
      const busy = this.tym.some(t => t.iEv < t.nEv);
      if (!this.muscleOn && !busy && this.tym[0].energy() + this.tym[1].energy() + this.bodyEnergy() < 1e-14) {
        this.stage = 0; this.note = -1; this.held = false;
        for (const t of this.tym) t.reset();
      }
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
      this.osL = new Float32Array(BLOCK * OS); this.osR = new Float32Array(BLOCK * OS);
      this.blkL = new Float32Array(BLOCK); this.blkR = new Float32Array(BLOCK); this.blkPos = BLOCK;
      this.ribF = new Float64Array(MAX_RIBS + 1); this.ribQ = new Float64Array(MAX_RIBS + 1); this.ribGain = new Float64Array(MAX_RIBS + 1);
      this.panL = new Float64Array(2); this.panR = new Float64Array(2); this.tymOn = new Uint8Array(2);
      this.ageCounter = 0; this.quietBlocks = 0;
      this.stack = [];
      this.bendNorm = 0; this.tempo = 120;
      this.dc = { xl: 0, yl: 0, xr: 0, yr: 0, R: 1 - 2 * Math.PI * 10 / sampleRate };
      this.osTimeBase = 0; this.onsets = null;
      this.stats = { ins: 0, locked: 0 };
      this.pkDec = Math.exp(-2 / (PEAK_TAU * this.srOS));
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
      // Stiffness: the lock window, click level and Lead (the tensor muscle in Cystosoma)
      const stiff = P[PINDEX.stiffness];
      this.lockW = 1 - stiff;
      this.stiffGain = dbToGain(STIFF_DB * (stiff - 0.6));
      this.leadF = 1.6 - stiff;
      this.scatter = P[PINDEX.scatter];
      // the two tymbals
      this.lrphase = P[PINDEX.lrphase];
      const pair = Math.round(P[PINDEX.pair]);
      this.tymOn[0] = pair !== 2 ? 1 : 0; this.tymOn[1] = pair !== 1 ? 1 : 0;
      const asym = P[PINDEX.asym];
      this.asymF = Math.pow(2, asym * 0.5 / 12); this.asymG = dbToGain(-6 * asym);
      const sp = P[PINDEX.spread];
      for (let s = 0; s < 2; s++) {
        const pan = 0.5 + (s ? 0.25 : -0.25) * sp;
        this.panL[s] = Math.cos(pan * Math.PI / 2) * Math.SQRT2; this.panR[s] = Math.sin(pan * Math.PI / 2) * Math.SQRT2;
      }
      // body: Bladder sounds as Helmholtz until batch 07, Plant as Open until batch 06
      const bt = Math.round(P[PINDEX.body]);
      this.bodyOn = bt === BODY_HELMHOLTZ || bt === BODY_BLADDER;
      this.direct = P[PINDEX.direct];
      // rib levels: rib 2 is the reference (0 dB); later ribs follow taper along u²
      const n = this.ribs, taper = P[PINDEX.taper];
      this.ribGain[1] = dbToGain(P[PINDEX.firstlevel]);
      for (let k = 2; k <= n; k++) { const u = n > 2 ? (k - 2) / (n - 2) : 0; this.ribGain[k] = dbToGain(taper * u * u); }
    }

    // a voice's carrier: rib frequencies and Qs (rib 2 sits on the tuned carrier, rib 1 at First,
    // later ribs fall along tilt·u²; Q follows 1/f) and its body's coefficients
    voicePitch(v) {
      const P = this.m;
      let f = Math.pow(2, v.logF + this.bendOct);
      while (f > F_CAP) f *= 0.5;
      if (f < F_MIN) f = F_MIN;
      this.fCarrier = f;
      v.omNote = TWO_PI * f / this.srOS;
      f *= Math.pow(2, v.kc);                    // the pitch keeper's correction
      const ft = f * Math.pow(2, P[PINDEX.tune] / 12), q0 = P[PINDEX.tymbalq];
      const n = this.ribs, tilt = P[PINDEX.tilt];
      this.ribF[1] = ft * Math.pow(2, P[PINDEX.first] / 12);
      for (let k = 2; k <= n; k++) { const u = n > 2 ? (k - 2) / (n - 2) : 0; this.ribF[k] = ft * Math.pow(2, tilt * u * u / 12); }
      for (let k = 1; k <= n; k++) this.ribQ[k] = q0 * ft / this.ribF[k];
      this.outF = ft * P[PINDEX.outratio];
      this.outQ = q0 * ft / this.outF;
      // Helmholtz body: Aperture moves pitch, Q and level as the opercula do; Membrane raises Q
      const ap = P[PINDEX.aperture], mem = P[PINDEX.membrane];
      const fb = f * Math.pow(AP_F_CLOSED, 1 - ap);
      const qb = P[PINDEX.bodyq] * (AP_Q_CLOSED + (1 - AP_Q_CLOSED) * ap) * (1 + MEMBRANE_Q * mem);
      v.periodS = this.srOS / fb;
      v.halfT = 0.5 * v.periodS;
      const mode = (fr, q, lvl) => {
        const om = TWO_PI * Math.min(fr, 0.45 * this.srOS) / this.srOS, r = Math.exp(-Math.PI * fr / (q * this.srOS));
        return [r * Math.cos(om), r * Math.sin(om), (1 - r) * lvl, om, r];
      };
      let c = mode(fb, qb, 1);
      v.c0r = c[0]; v.c0i = c[1]; v.g0 = c[2]; v.om0 = c[3]; v.r0 = c[4];
      const cav = dbToGain(-25 + 25 * P[PINDEX.cavity]);
      c = mode(fb * CAVITY_RATIOS[0], qb, cav); v.c1r = c[0]; v.c1i = c[1]; v.g1 = c[2];
      c = mode(fb * CAVITY_RATIOS[1], qb, cav); v.c2r = c[0]; v.c2i = c[1]; v.g2 = c[2];
      v.kLP = 1 - Math.exp(-TWO_PI * Math.min(2 * fb, 0.4 * this.srOS) / this.srOS);
      v.bodyLevel = BODY_GAIN * dbToGain(AP_DB_CLOSED * Math.pow(1 - ap, 1.5) + MEMBRANE_DB * mem);
    }

    processBlock() {
      const d = this.dc;
      const any = this.voices.some(v => v.stage !== 0);
      if (!any && this.quietBlocks > 1 && Math.abs(d.yl) + Math.abs(d.xl) + Math.abs(d.yr) + Math.abs(d.xr) < 1e-12) {
        this.blkL.fill(0); this.blkR.fill(0); d.xl = d.yl = d.xr = d.yr = 0;
        this.osTimeBase += BLOCK * OS;
        this.info.voices = 0; this.info.idle = true;
        return;
      }
      this.m.set(this.p);
      this.updateControls();
      const nOS = BLOCK * OS, oL = this.osL, oR = this.osR;
      oL.fill(0); oR.fill(0);
      let count = 0, newest = -1;
      for (const v of this.voices) if (v.stage !== 0) {
        v.render(nOS, oL, oR);
        count++;
        if (v.age > newest) { newest = v.age; this.info.carrier = v.fNow; this.info.rib = v.tym[0].state; this.info.f = v.tym[0].lastF; this.info.q = v.tym[0].lastQ; }
      }
      this.osTimeBase += nOS;
      this.info.voices = count; this.info.idle = false;
      this.quietBlocks = count === 0 ? this.quietBlocks + 1 : 0;
      // decimate (symmetric FIR) both channels, DC block, volume, clip
      const L = FIR_LEN, H = FIR_LEN / 2, h = this.fir, hl = this.histL, hr = this.histR, vol = this.vol;
      let hw = this.hw;
      for (let j = 0, o = 0; j < BLOCK; j++) {
        for (let q = 0; q < OS; q++, o++) {
          hl[hw] = hl[hw + L] = oL[o]; hr[hw] = hr[hw + L] = oR[o];
          hw = hw + 1 === L ? 0 : hw + 1;
        }
        let al = 0, ar = 0;
        for (let t = 0, u = hw + L - 1; t < H; t++, u--) { const c = h[t], a = hw + t; al += c * (hl[a] + hl[u]); ar += c * (hr[a] + hr[u]); }
        const yl = al - d.xl + d.R * d.yl; d.xl = al; d.yl = yl;
        const yr = ar - d.xr + d.R * d.yr; d.xr = ar; d.yr = yr;
        const sl = yl * vol, sr = yr * vol;
        this.blkL[j] = sl > 1 ? 1 : sl < -1 ? -1 : sl;
        this.blkR[j] = sr > 1 ? 1 : sr < -1 ? -1 : sr;
      }
      this.hw = hw;
      if (Math.abs(d.yl) < 1e-20) d.yl = 0;
      if (Math.abs(d.yr) < 1e-20) d.yr = 0;
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
  const core = { CLICK_PHASE, KAPPA, TRANS_CYC, TRANS_LAG, LOCK_AIM, A_REF, HEAT_BASE, OUTRIB_DB, LOCK_GATE, BODY_GAIN, AP_F_CLOSED, AP_Q_CLOSED, AP_DB_CLOSED };
  if (typeof module !== 'undefined' && module.exports) module.exports = { TymbalEngine, PARAMS, core };
  else root.TymbalEngine = TymbalEngine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
