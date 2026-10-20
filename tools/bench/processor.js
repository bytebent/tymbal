/* AudioWorklet wrapper: tymbal engine → stereo output. Runs after tymbal-engine.js. */
class TymbalProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.eng = new TymbalEngine(sampleRate, 1234);
    this.vizEvery = Math.round(sampleRate / 30);
    this.vizCount = 0;
    this.seen = 0;                                  // clicks already sent to the page
    this.env = [];                                  // output peak per render quantum since the last post
    // DSP load: time spent in the engine / length of audio produced. performance.now() where the
    // worklet has it; otherwise Date.now(), whose 1 ms steps average out over half a second
    this.hiRes = typeof performance !== 'undefined' && typeof performance.now === 'function';
    this.clock = this.hiRes ? () => performance.now() : () => Date.now();
    this.busyMs = 0; this.audioMs = 0; this.load = 0; this.peak = 0; this.winPeak = 0; this.peakAge = 0;
    this.port.onmessage = (e) => {
      const m = e.data, eng = this.eng;
      if (m.t === 'p') eng.setParam(m.id, m.v);
      else if (m.t === 'many') { for (const k in m.p) eng.setParam(k, m.p[k]); }
      else if (m.t === 'on') eng.noteOn(m.n, m.v);
      else if (m.t === 'off') eng.noteOff(m.n);
      else if (m.t === 'bend') eng.setBend(m.v);
      else if (m.t === 'at') eng.setAftertouch(m.v);
      else if (m.t === 'tempo') eng.setTempo(m.v);
      else if (m.t === 'panic') eng.allNotesOff();
    };
    this.port.postMessage({ t: 'ready', sr: sampleRate, latency: TymbalEngine.LATENCY });
  }
  process(inputs, outputs) {
    const out = outputs[0], l = out[0], r = out[1] || null, n = l.length;
    const t0 = this.clock();
    this.eng.process(l, r, n);
    const spent = this.clock() - t0, len = n / sampleRate * 1000;
    this.busyMs += spent; this.audioMs += len;
    if (this.hiRes && spent / len > this.winPeak) this.winPeak = spent / len;
    if (this.audioMs >= 500) {
      this.load = this.busyMs / this.audioMs; this.busyMs = 0; this.audioMs = 0;
      // peak: the slowest single callback, held for 2 s
      if (this.winPeak >= this.peak || ++this.peakAge >= 4) { this.peak = this.winPeak; this.peakAge = 0; }
      this.winPeak = 0;
    }
    let pk = 0; for (let i = 0; i < n; i++) { const a = Math.abs(l[i]); if (a > pk) pk = a; if (r) { const b = Math.abs(r[i]); if (b > pk) pk = b; } }
    this.env.push(pk);
    this.vizCount += n;
    if (this.vizCount >= this.vizEvery) {
      this.vizCount = 0;
      const e = this.eng, N = TymbalEngine.VIEW_N;
      // the clicks since the last post (at most the ring's length): time (s), side, kind
      const from = Math.max(this.seen, e.vN - N), clicks = [];
      for (let k = from; k < e.vN; k++) { const i = k & (N - 1); clicks.push(e.vT[i] / e.srOS, e.vS[i], e.vK[i]); }
      this.seen = e.vN;
      const info = e.info;
      this.port.postMessage({ t: 'stat', now: e.osTimeBase / e.srOS, voices: info.voices, idle: !!info.idle, load: this.load, peak: this.hiRes ? this.peak : -1,
        carrier: info.carrier, pulses: info.pulses, lock: info.lock, keeper: info.keeper, time: info.time, effort: info.effort, clicks, env: this.env, envDt: n / sampleRate });
      this.env = [];
    }
    return true;
  }
}
registerProcessor('tymbal-processor', TymbalProcessor);
