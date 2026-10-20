// Reference engine tests. Run: node tests/engine-test.js
'use strict';
const path = require('path');
const { TymbalEngine, PARAMS, core } = require(path.join(__dirname, '..', 'reference', 'tymbal-engine.js'));

let failed = 0, passed = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
  if (ok) passed++; else failed++;
}

const SR = 48000, DELAY = 16;     // FIR group delay in host samples (63.5 oversampled)
function render(seconds, params, opts) {
  opts = opts || {};
  const e = new TymbalEngine(SR, opts.seed || 1234);
  for (const k in params) e.setParam(k, params[k]);
  const n = Math.round(SR * seconds);
  const L = new Float32Array(n), R = new Float32Array(n);
  const bl = opts.block || 128;
  const tl = new Float32Array(bl), tr = new Float32Array(bl);
  const notes = opts.notes || [[60, 127, 0, seconds]];
  // note events at their exact sample: a host block is split where an event falls
  const ev = [];
  for (const [note, vel, t0, t1] of notes) { ev.push([Math.round(t0 * SR), note, vel]); if (t1 < seconds) ev.push([Math.round(t1 * SR), note, 0]); }
  ev.sort((a, b) => a[0] - b[0]);
  let k = 0;
  for (let i = 0; i < n;) {
    while (k < ev.length && ev[k][0] <= i) { if (ev[k][2] > 0) e.noteOn(ev[k][1], ev[k][2]); else e.noteOff(ev[k][1]); k++; }
    let m = Math.min(bl, n - i);
    if (k < ev.length) m = Math.min(m, ev[k][0] - i);
    e.process(tl, tr, m);
    L.set(tl.subarray(0, m), i); R.set(tr.subarray(0, m), i);
    i += m;
  }
  return { e, L, R };
}
const dB = (x) => 20 * Math.log10(x);
const st = (a, b) => 12 * Math.log2(a / b);

// one isolated pulse in x[s0, s1): peak, frequency from zero crossings after the nonlinear start,
// Q from the log decrement of the positive peaks
function analysePulse(x, s0, s1) {
  let pk = 0, pi = s0;
  for (let i = s0; i < s1; i++) if (Math.abs(x[i]) > pk) { pk = Math.abs(x[i]); pi = i; }
  // upward zero crossings (interpolated) after the peak
  const zc = [];
  for (let i = pi; i < s1 - 1; i++) if (x[i] <= 0 && x[i + 1] > 0) zc.push(i + x[i] / (x[i] - x[i + 1]));
  // skip 2 cycles of the nonlinear start, use the next 8
  const use = zc.slice(2, 10);
  const f = use.length > 2 ? SR * (use.length - 1) / (use[use.length - 1] - use[0]) : NaN;
  // positive peaks between those crossings
  const peaks = [];
  for (let c = 0; c + 1 < use.length; c++) { let m = 0; for (let i = Math.floor(use[c]); i < Math.ceil(use[c + 1]); i++) m = Math.max(m, x[i]); peaks.push(m); }
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  peaks.forEach((p, i) => { const y = Math.log(p); sx += i; sy += y; sxx += i * i; sxy += i * y; });
  const nP = peaks.length, slope = (nP * sxy - sx * sy) / (nP * sxx - sx * sx);
  return { peak: pk, f, Q: Math.PI / -slope, at: pi };
}
// count separate clicks: onsets where the envelope rises past a threshold after falling below half of it
function countClicks(x, s0, s1, thr) {
  let n = 0, armed = true;
  const env = new Float32Array(s1 - s0);
  let a = 0;
  for (let i = s0; i < s1; i++) { a = Math.max(Math.abs(x[i]), a * 0.97); env[i - s0] = a; }
  for (let i = 0; i < env.length; i++) {
    if (armed && env[i] > thr) { n++; armed = false; }
    else if (!armed && env[i] < thr * 0.5) armed = true;
  }
  return n;
}

// ---------- Cyclochila, Table 2 of Bennet-Clark 1997 (unloaded tymbal, slow apodeme pull) ----------
// rib 2 is the carrier: middle C plays C8 = 4186 Hz ≈ 4.19 kHz. Ribs 4 ms apart so each pulse is
// measured on its own, as in the paper's slow pulls.
const TABLE2 = { f: [4370, 4190, 3920, 3170], level: [1, 1.01, 0.83, 0.39], outF: 6540, outLevel: 0.34 };
const CYC = {
  rate: 4, spacing: 4, ribs: 4, recruit: 4, hold: 0.5,
  first: st(4370, 4190), tilt: st(3170, 4190), firstlevel: dB(1 / 1.01), taper: dB(0.39 / 1.01),
  tymbalq: 10, outratio: 6540 / 4190, outlevel: dB(0.34 / 1.01), attack: 0.001, sustain: 1, scatter: 0,
  body: 2, pair: 1, stiffness: 1, jitter: 0,   // the abdomenless preparation: Open body, one tymbal, no lock; strokes exactly on time
};
{
  const { L } = render(0.6, CYC);
  const s0 = Math.round(0.25 * SR) + DELAY;                 // second stroke: full effort
  const sp = 4e-3 * SR;
  const pulses = [0, 1, 2, 3].map(k => analysePulse(L, s0 + Math.round(k * sp) - 4, s0 + Math.round((k + 1) * sp) - 8));
  const out = analysePulse(L, Math.round((0.25 + 0.125) * SR) + DELAY - 4, Math.round((0.25 + 0.125) * SR) + DELAY + 300);
  const p1 = pulses[0].peak;
  pulses.forEach((p, k) => {
    const ef = Math.abs(p.f / TABLE2.f[k] - 1);
    check(`Cyclochila rib ${k + 1}: ${(p.f / 1000).toFixed(3)} kHz against ${(TABLE2.f[k] / 1000).toFixed(2)}`, ef < 0.03, (ef * 100).toFixed(1) + '%');
    const el = dB(p.peak / p1) - dB(TABLE2.level[k]);
    check(`Cyclochila rib ${k + 1} level ${(p.peak / p1).toFixed(2)} against ${TABLE2.level[k]}`, Math.abs(el) < 1, el.toFixed(2) + ' dB');
  });
  const eo = Math.abs(out.f / TABLE2.outF - 1), lo = dB(out.peak / p1) - dB(TABLE2.outLevel);
  check(`Cyclochila OUT: ${(out.f / 1000).toFixed(2)} kHz against 6.54`, eo < 0.03, (eo * 100).toFixed(1) + '%');
  check(`Cyclochila OUT level ${(out.peak / p1).toFixed(2)} against 0.34 (about 10 dB down)`, Math.abs(lo) < 1, lo.toFixed(2) + ' dB');
  // Q rises as frequency falls: Q·f about constant (Bennet-Clark 1997, Fig. 6B)
  const all = pulses.concat([out]);
  const qf = all.map(p => p.Q * p.f), mean = qf.reduce((a, b) => a + b) / qf.length;
  const spread = Math.max(...qf.map(v => Math.abs(v / mean - 1)));
  check('Q follows 1/f across ribs and OUT', spread < 0.12,
    'Q ' + all.map(p => p.Q.toFixed(1)).join(', ') + '; Q·f within ' + (spread * 100).toFixed(0) + '%');
  check('IN Q about 10, OUT Q about 6', Math.abs(pulses[0].Q - 10) < 2 && Math.abs(out.Q - 6.4) < 1.5,
    `IN ${pulses[0].Q.toFixed(1)}, OUT ${out.Q.toFixed(1)}`);
  // pulse shape: a smaller first rarefaction, then the larger compression
  {
    // first compression peak within the first 1.5 cycles; the rarefaction before it
    const s = s0 - 4, cyc = Math.round(SR / 4190);
    let maxV = 0, maxI = s;
    for (let i = s; i < s + Math.round(1.5 * cyc); i++) if (L[i] > maxV) { maxV = L[i]; maxI = i; }
    let minV = 0, minI = s;
    for (let i = s; i < maxI; i++) if (L[i] < minV) { minV = L[i]; minI = i; }
    check('IN pulse starts with a smaller rarefaction, then the compression', minV < 0 && -minV < 0.8 * maxV,
      `rarefaction ${(-minV / maxV).toFixed(2)} of the compression, ${((maxI - minI) / SR * 1e6).toFixed(0)} µs apart`);
  }
  // frequency rises through the decay (nonlinear start): first cycles lower than the late ones
  {
    // crossings after the first compression peak: the first cycle against cycles 7–11
    const s = s0 - 4, cyc = Math.round(SR / 4190);
    let maxV = 0, maxI = s;
    for (let i = s; i < s + Math.round(1.5 * cyc); i++) if (L[i] > maxV) { maxV = L[i]; maxI = i; }
    const zc = [];
    for (let i = maxI; i < maxI + 200; i++) if (L[i] > 0 && L[i + 1] <= 0) zc.push(i + L[i] / (L[i] - L[i + 1]));
    const early = SR / (zc[1] - zc[0]), late = SR * 4 / (zc[11] - zc[7]);
    check('frequency rises through the decay (150–350 Hz at 4.3 kHz)', late - early > 100 && late - early < 400,
      `${early.toFixed(0)} → ${late.toFixed(0)} Hz, +${(late - early).toFixed(0)}`);
  }
}

// ---------- coherent train at song speed ----------
{
  const p = Object.assign({}, CYC, { spacing: 0.6, recruit: 3, rate: 117 });
  const { L } = render(0.2, p);
  let nan = false, pk = 0; for (const x of L) { if (!Number.isFinite(x)) nan = true; pk = Math.max(pk, Math.abs(x)); }
  check('song speed (117 Hz, ribs 0.6 ms apart): finite, peak below clipping', !nan && pk < 0.9 && pk > 0.05, 'peak ' + pk.toFixed(2));
}

// ---------- recruitment follows effort ----------
{
  const p = Object.assign({}, CYC, { recruit: 4, tymbalq: 6 });
  const loud = render(0.6, p), soft = render(0.6, p, { notes: [[60, 20, 0, 0.6]] });
  const s0 = Math.round(0.25 * SR), s1 = s0 + Math.round(0.02 * SR);
  const nl = countClicks(loud.L, s0, s1, 0.01), ns = countClicks(soft.L, s0, s1, 0.005);
  check('effort recruits ribs: loud stroke 4 clicks, soft stroke fewer', nl === 4 && ns < 4, `loud ${nl}, soft ${ns}`);
}

// ---------- the muscle lets go: ribs after the OUT moment are not recruited ----------
{
  const p = Object.assign({}, CYC, { rate: 50, hold: 0.25, recruit: 4, tymbalq: 6 });  // 20 ms cycle, OUT at 5 ms: ribs at 0, 4 ms only
  const { e, L } = render(0.12, p);
  const s0 = Math.round(0.04 * SR), s1 = s0 + Math.round(0.0045 * SR);
  const n = countClicks(L, s0, s1, 0.01);
  check('ribs past the OUT moment do not buckle', n === 2, n + ' IN clicks in a 5 ms hold');
}

// ---------- OUT clicks: ribs popping out in reverse order ----------
{
  const p = Object.assign({}, CYC, { outclicks: 1, outspeed: 0.5, tymbalq: 6 });
  const { L } = render(0.6, p);
  const s0 = Math.round(0.375 * SR), s1 = s0 + Math.round(0.012 * SR);
  const n = countClicks(L, s0, s1, 0.01);
  check('Out clicks 1: four ribs pop out, then the plate', n === 5, n + ' OUT clicks');
}

// ---------- Heat: muscle speeds up, carrier stays ----------
{
  const strokeTimes = (heat) => {
    const e = new TymbalEngine(SR, 1);
    for (const k in CYC) e.setParam(k, CYC[k]);
    e.setParam('rate', 90); e.setParam('heat', heat); e.setParam('spacing', 1.5); e.setParam('ribs', 9); e.setParam('recruit', 9);
    e.onsets = [];
    const L = new Float32Array(128), R = new Float32Array(128);
    e.noteOn(60, 127);
    const times = [];
    for (let i = 0; i < SR * 0.5; i += 128) { const before = e.onsets.length; e.process(L, R, 128); if (e.onsets.length > before) times.push(i); }
    return { strokes: times.length, carrier: e.info.carrier, spacing: e.spacingS / e.heatF / e.srOS * 1000 };
  };
  const cold = strokeTimes(20), hot = strokeTimes(35);
  const ratio = cold.spacing / hot.spacing;
  check('Heat 20 → 35 °C speeds rib spacing by 1.85× (M. cassini 650 → 1200 Hz)', Math.abs(ratio - 1.846) < 0.01, ratio.toFixed(3) + '×');
  check('Heat speeds the muscle: more strokes per second', hot.strokes > cold.strokes * 1.7, `${cold.strokes} → ${hot.strokes} strokes in 0.5 s`);
  check('Heat leaves the carrier alone', cold.carrier === hot.carrier, cold.carrier.toFixed(1) + ' Hz');
}

// ---------- Carrier mode pitch ----------
{
  const e = new TymbalEngine(SR, 1);
  e.noteOn(60, 100);
  const L = new Float32Array(128), R = new Float32Array(128);
  e.process(L, R, 128);
  check('Carrier mode: middle C sets the carrier to C8 (4186 Hz)', Math.abs(e.info.carrier - 4186.01) < 0.1, e.info.carrier.toFixed(2) + ' Hz');
  e.noteOff(60); e.setParam('transpose', 24); e.noteOn(60, 100); e.process(L, R, 128);
  check('carrier above 16 kHz drops an octave (C10 → C9)', Math.abs(e.info.carrier - 8372.02) < 0.1, e.info.carrier.toFixed(1) + ' Hz');
}

// ---------- same output at any buffer size ----------
{
  const p = Object.assign({}, CYC, { rate: 117, spacing: 0.6, recruit: 3, outclicks: 0.5 });
  const notes = [[60, 100, 0, 0.15], [64, 90, 0.1, 0.25]];
  const ref = render(0.3, p, { block: 1, notes }).L;
  let same = true;
  for (const bl of [64, 1000]) { const x = render(0.3, p, { block: bl, notes }).L; for (let i = 0; i < x.length; i++) if (x[i] !== ref[i]) { same = false; break; } }
  check('same output at buffer sizes 1, 64, 1000', same);
}

// ---------- release ends in silence, engine goes idle ----------
{
  const { e, L } = render(1.0, Object.assign({}, CYC, { rate: 117, spacing: 0.6 }), { notes: [[60, 100, 0, 0.2]] });
  let tail = 0; for (let i = Math.round(0.8 * SR); i < L.length; i++) tail = Math.max(tail, Math.abs(L[i]));
  check('release ends in silence; the engine goes idle', tail === 0 && e.info.voices === 0, 'tail ' + tail);
}

// ================= batch 03: body, two tymbals, the lock =================
const placeAt = (f) => { const s = st(f, 4186.01), t = Math.round(s); return { transpose: t, detune: Math.round((s - t) * 100) }; };
// spectrum magnitude (dB) at frequency f over x[a, b), Hann window
function specDb(x, a, b, f, rect) {
  let re = 0, im = 0; const n = b - a, w = 2 * Math.PI * f / SR;
  for (let i = 0; i < n; i++) { const h = rect ? 1 : 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n), v = x[a + i] * h; re += v * Math.cos(w * i); im += v * Math.sin(w * i); }
  return 10 * Math.log10(re * re + im * im + 1e-30);
}
// cycle-by-cycle positive peaks after the onset (the envelope), from a zero-crossing pass
function cyclePeaks(x, a, b) {
  const zc = []; for (let i = a; i < b - 1; i++) if (x[i] <= 0 && x[i + 1] > 0) zc.push(i);
  const pk = []; for (let c = 0; c + 1 < zc.length; c++) { let m = 0; for (let i = zc[c]; i < zc[c + 1]; i++) m = Math.max(m, x[i]); pk.push(m); }
  return { zc, pk };
}
// deepest dip between the envelope's first rise and its later maximum, as a share of the smaller side
function worstDip(pk) {
  let worst = 1;
  for (let i = 1; i < pk.length - 1; i++) {
    const left = Math.max(...pk.slice(0, i)), right = Math.max(...pk.slice(i + 1));
    const side = Math.min(left, right);
    if (side > 0.2 * Math.max(...pk)) worst = Math.min(worst, pk[i] / side);
  }
  return worst;
}
function sustained(p, seconds, vel) {
  const e = new TymbalEngine(SR, 7);
  for (const k in p) e.setParam(k, p[k]);
  e.noteOn(60, vel || 110);
  const n = Math.round(SR * seconds), L = new Float32Array(n), R = new Float32Array(n);
  e.process(L, R, n);
  return { e, L, R };
}
// precise pitch of a steady stretch: zero crossings, least-squares slope
function zcPitch(x, a, b) {
  const zc = []; for (let i = a; i < b - 1; i++) if (x[i] <= 0 && x[i + 1] > 0) zc.push(i + x[i] / (x[i] - x[i + 1]));
  let sx = 0, sy = 0, sxx = 0, sxy = 0; const n = zc.length;
  zc.forEach((t, k) => { sx += k; sy += t; sxx += k * k; sxy += k * t; });
  const per = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  let worst = 0; for (let k = 1; k < n; k++) worst = Math.max(worst, Math.abs((zc[k] - zc[k - 1]) / per - 1));
  return { f: SR / per, worst };
}

const SEPT = Object.assign(placeAt(1300), { rate: 68, ribs: 12, recruit: 4, spacing: 0.77, tymbalq: 12, tilt: -1, taper: -2, stiffness: 0.1, outlevel: -16, membrane: 1, cavity: 0.1, attack: 0.1, sustain: 1 });
const CASS = Object.assign(placeAt(6000), { rate: 90, ribs: 12, recruit: 9, spacing: 1.02, hold: 0.92, tymbalq: 4, bodyq: 3, tilt: -1, taper: -3, outratio: 1.4, stiffness: 0.9, attack: 0.02, sustain: 1 });
const CYCS = { rate: 117, spacing: 0.6, ribs: 4, recruit: 3, first: 0.73, tilt: -4.83, firstlevel: -0.09, taper: -8.27, tymbalq: 9.3, outratio: 1.561, outlevel: -9.45, stiffness: 0.3, bodyq: 3.4, attack: 0.02, sustain: 1 };

// ---------- coupled Q: tymbal Q 9.3 into air sac Q 3.4 (Young & Bennet-Clark 1995, Table 1) ----------
{
  const qOf = (extra) => {
    const p = Object.assign(placeAt(4300), { ribs: 1, recruit: 1, first: 0, rate: 2, tymbalq: 9.3, bodyq: 3.4, cavity: 0, direct: 0, pair: 1, stiffness: 1, scatter: 0, outlevel: -40, attack: 0.001, sustain: 1 }, extra);
    const { L } = sustained(p, 0.1);
    const n = Math.round(0.05 * SR), db = [];
    let best = -1e9, fb = 0;
    for (let f = 2000; f <= 7000; f += 5) {
      let re = 0, im = 0; const w = 2 * Math.PI * f / SR;
      for (let i = 0; i < n; i++) { re += L[i] * Math.cos(w * i); im += L[i] * Math.sin(w * i); }
      const v = 10 * Math.log10(re * re + im * im); db.push([f, v]); if (v > best) { best = v; fb = f; }
    }
    const lo = db.filter(([f, v]) => f < fb && v < best - 3).pop()[0], hi = db.find(([f, v]) => f > fb && v < best - 3)[0];
    return fb / (hi - lo);
  };
  const chain = qOf({}), tym = qOf({ body: 2 }), sac = qOf({ tymbalq: 2 });
  check('tymbal and air sac together are tuned more sharply than either (Table 1: 9.3 and 3.4 give 12.5)', chain > tym && chain > sac && chain > 9.3 && chain < 15,
    `tymbal ${tym.toFixed(1)}, sac ${sac.toFixed(1)}, both ${chain.toFixed(1)}; a passive chain of the two cannot ring longer than the tymbal, so 12.5 is out of reach`);
}

// ---------- coherent and antiphase clicks into a 4.3 kHz body (Bennet-Clark & Young 1992, Figs 14–15) ----------
{
  const env = (cycles) => {
    const p = Object.assign(placeAt(4300), { ribs: 3, recruit: 3, first: 0, tilt: 0, taper: 0, rate: 2, spacing: cycles / 4300 * 1000, tymbalq: 5.6, bodyq: 7, cavity: 0, direct: 0, pair: 1, stiffness: 1, scatter: 0, outlevel: -40, hold: 0.5, attack: 0.001, sustain: 1 });
    const { L } = sustained(p, 0.05);
    return cyclePeaks(L, 0, Math.round(0.006 * SR)).pk;
  };
  const coh = env(2), anti = env(3.5 + core.TRANS_LAG / (2 * Math.PI));   // each click ends TRANS_LAG behind a linear one
  const dc = worstDip(coh), da = worstDip(anti);
  check('three clicks two cycles apart build one smooth pulse', dc > 0.75, `deepest dip ${(dc * 100).toFixed(0)}% of the envelope around it`);
  check('three clicks arriving in antiphase give a humped pulse', da < 0.5, `deepest dip ${(da * 100).toFixed(0)}%`);
}

// ---------- the lock: three species ----------
{
  const s = sustained(SEPT, 1.2);
  const z = zcPitch(s.L, Math.round(0.5 * SR), Math.round(1.1 * SR));
  const cp = cyclePeaks(s.L, Math.round(0.5 * SR), Math.round(1.1 * SR)).pk;
  const depth = Math.min(...cp) / Math.max(...cp);
  const share = s.e.stats.locked / s.e.stats.ins;
  check('M. septendecim: ribs and strokes lock', share > 0.85, `${s.e.stats.locked} of ${s.e.stats.ins} ribs`);
  check('M. septendecim: an unbroken tone, no phase breaks', z.worst < 0.03 && depth > 0.4,
    `periods within ${(z.worst * 100).toFixed(1)}%, envelope never below ${(depth * 100).toFixed(0)}% of its peak`);
  check('Carrier mode in tune within 1 cent (pitch keeper)', Math.abs(1200 * Math.log2(z.f / 1300)) < 1, `${z.f.toFixed(2)} Hz, ${(1200 * Math.log2(z.f / 1300)).toFixed(2)} cents`);
  // Young & Josephson 1983, Fig. 3: bandwidth at 20 dB down 0.5 kHz or less; harmonic 30 dB or more down
  const a = Math.round(0.5 * SR), b = Math.round(1.1 * SR);
  const p0 = specDb(s.L, a, b, z.f);
  // the song is a line spectrum (lines 68 Hz apart): follow its envelope, the loudest line within ±80 Hz
  const envDb = (f) => { let m = -1e9; for (let g = f - 80; g <= f + 80; g += 10) m = Math.max(m, specDb(s.L, a, b, g)); return m; };
  let lo = z.f, hi = z.f;
  while (envDb(lo) > p0 - 20 && lo > 200) lo -= 20;
  while (envDb(hi) > p0 - 20 && hi < 4000) hi += 20;
  check('M. septendecim: 20 dB bandwidth 0.5 kHz or less (Young & Josephson: Q 25)', hi - lo <= 500, `${hi - lo} Hz across the envelope of its lines`);
  let h2 = -1e9; for (let f = 2 * z.f - 60; f <= 2 * z.f + 60; f += 5) h2 = Math.max(h2, specDb(s.L, a, b, f));
  check('M. septendecim: harmonic at 2.6 kHz 30 dB or more down', p0 - h2 >= 30, `${(p0 - h2).toFixed(1)} dB`);
  const stiff = sustained(Object.assign({}, SEPT, { stiffness: 1 }), 1.2);
  const zs = zcPitch(stiff.L, Math.round(0.5 * SR), Math.round(1.1 * SR));
  check('the same tymbal made stiff stops locking and breaks into pulses', stiff.e.stats.locked === 0 && zs.worst > 0.2,
    `${stiff.e.stats.locked} locked, periods off by up to ${(zs.worst * 100).toFixed(0)}%`);
}
{
  const c = sustained(Object.assign({}, CASS, { pair: 1 }), 0.6);        // one tymbal: the other's strokes would overlap (see tests.md)
  const share = c.e.stats.locked / c.e.stats.ins;
  // one stroke: count sub-pulses as envelope humps separated by dips below 30%
  const a = Math.round(Math.round(0.3 * 90) / 90 * SR) + DELAY, b = a + Math.round(SR / 90);
  const { pk } = cyclePeaks(c.L, a, b);
  let humps = 0, armed = true; const top = Math.max(...pk);
  for (const v of pk) { if (armed && v > 0.4 * top) { humps++; armed = false; } else if (!armed && v < 0.3 * top) armed = true; }
  check('M. cassini (stiff, Q 5): sub-pulses stay separate', share < 0.05 && humps >= 8 && humps <= 10, `${humps} sub-pulses per stroke, ${(share * 100).toFixed(1)}% of ribs locked`);
}
{
  const c = sustained(CYCS, 0.6), stiff = sustained(Object.assign({}, CYCS, { stiffness: 1 }), 0.6);
  const share23 = 1.5 * c.e.stats.locked / c.e.stats.ins;      // ribs 2–3 are two thirds of all ribs
  check('Cyclochila: most of ribs 2 and 3 lock onto the ringing (rib 1 follows the other side\'s pulse after it has died away)', share23 > 0.5 && stiff.e.stats.locked === 0,
    `${(share23 * 100).toFixed(0)}% of ribs 2–3 at Stiffness 0.3, none when stiff`);
}

// ---------- sidebands at the carrier ± 1/click interval (Bennet-Clark & Young 1992, Fig. 16F) ----------
{
  const cyc3 = 3 + core.TRANS_LAG / (2 * Math.PI);          // three cycles after each click's slow start
  const p = Object.assign(placeAt(4400), { ribs: 3, recruit: 3, first: 0, tilt: 0, taper: 0, rate: 2, spacing: cyc3 / 4400 * 1000, tymbalq: 5.6, bodyq: 7, cavity: 0, direct: 0, pair: 1, stiffness: 1, scatter: 0, outlevel: -40, attack: 0.001, sustain: 1 });
  const { L } = sustained(p, 0.05);
  const a = 0, b = Math.round(0.02 * SR), fs = 4400 / cyc3;
  // a whole pulse inside the window, so no taper: the upper sideband is a lobe above the carrier
  // with a comb null between them
  const grid = []; for (let f = 4400; f <= 4400 + 1.6 * fs; f += 20) grid.push([f, specDb(L, a, b, f, true)]);
  let mx = -1e9, fm = 0; for (const [f, v] of grid) if (f > 4400 + 0.5 * fs && v > mx) { mx = v; fm = f; }
  const dip = Math.min(...grid.filter(([f]) => f < fm).map(x => x[1]));
  const off = (fm - 4400) / fs;
  check('clicks 3 cycles apart: a sideband lobe above the carrier, near + 1/interval (paper: + 1.45 kHz)', off > 0.6 && off < 1.2 && mx - dip > 6,
    `lobe at +${((fm - 4400) / 1000).toFixed(2)} kHz (${(off * 100).toFixed(0)}% of 1/interval; the resonators' skirts pull it in), ${(mx - dip).toFixed(0)} dB above the null`);
}

// ---------- opercula and eardrums ----------
{
  const tail = (extra) => {
    const p = Object.assign(placeAt(4300), { ribs: 1, recruit: 1, rate: 2, tymbalq: 2, bodyq: 7.8, cavity: 0, direct: 0, pair: 1, stiffness: 1, scatter: 0, outlevel: -40, attack: 0.001, sustain: 1 }, extra);
    const { L } = sustained(p, 0.05);
    const r = analysePulse(L, Math.round(0.0005 * SR), Math.round(0.006 * SR));
    let e2 = 0; for (let i = 0; i < Math.round(0.02 * SR); i++) e2 += L[i] * L[i];
    return Object.assign(r, { energy: e2 });
  };
  const open = tail({ aperture: 1 }), shut = tail({ aperture: 0 }), thick = tail({ membrane: 1 });
  const fr = shut.f / open.f, qr = shut.Q / open.Q, lv = 10 * Math.log10(shut.energy / open.energy);
  check('closed opercula: body pitch × 0.82 (model: 4.33 → 3.54 kHz)', Math.abs(fr - 0.818) < 0.02, fr.toFixed(3));
  check('closed opercula: Q × 0.67 (7.8 → 5.2)', Math.abs(qr - 0.667) < 0.1, `${open.Q.toFixed(1)} → ${shut.Q.toFixed(1)}`);
  check('closed opercula: about 10 dB quieter', lv < -7 && lv > -15, lv.toFixed(1) + ' dB');
  check('thick eardrums (Membrane 1): Q × 4, pitch held by the note', thick.Q / open.Q > 3 && Math.abs(thick.f / open.f - 1) < 0.02,
    `Q ${open.Q.toFixed(1)} → ${thick.Q.toFixed(1)}`);
}

// ---------- two tymbals ----------
{
  const e = new TymbalEngine(SR, 1);
  for (const [k, v] of Object.entries(Object.assign({}, CYCS, { rate: 100 }))) e.setParam(k, v);
  e.onsets = [];
  e.noteOn(60, 100);
  const L = new Float32Array(SR / 10), R = new Float32Array(SR / 10);
  e.process(L, R, L.length);
  // stroke times relative to the cycle they belong to (Jitter moves each cycle, not the phase within it)
  const lag = (ons) => { const out = []; for (let i = 1; i < ons.length; i++) if (ons[i][1] === 1 && ons[i - 1][1] === 0) out.push(ons[i][0] - ons[i - 1][0]); return out; };
  const cyc = (ons) => { const l = ons.filter(o => o[1] === 0); return (l[l.length - 1][0] - l[0][0]) / (l.length - 1); };
  const alt = e.onsets.every((o, i) => o[1] === i % 2);
  const ph = lag(e.onsets).map(x => x / cyc(e.onsets));
  const mean = ph.reduce((a, b) => a + b) / ph.length;
  check('Lr phase 0.5: the tymbals alternate, the right one half a cycle late', alt && Math.abs(mean - 0.5) < 0.02, `${e.onsets.length} strokes, at ${mean.toFixed(3)} of the cycle`);
  e.allNotesOff();
  const e2 = new TymbalEngine(SR, 1);
  for (const [k, v] of Object.entries(Object.assign({}, CYCS, { rate: 100, lrphase: 0.25 }))) e2.setParam(k, v);
  e2.onsets = [];
  e2.noteOn(60, 100); e2.process(L, R, L.length);
  const ph2 = lag(e2.onsets).map(x => x / cyc(e2.onsets)), m2 = ph2.reduce((a, b) => a + b) / ph2.length;
  check('Lr phase 0.25: the right tymbal a quarter cycle late (Cystosoma)', Math.abs(m2 - 0.25) < 0.02, `at ${m2.toFixed(3)} of the cycle`);
  const e3 = new TymbalEngine(SR, 1);
  for (const [k, v] of Object.entries(Object.assign({}, CYCS, { pair: 2 }))) e3.setParam(k, v);
  e3.onsets = []; e3.noteOn(60, 100); e3.process(L, R, L.length);
  check('Pair Right: only the right tymbal sings', e3.onsets.length > 5 && e3.onsets.every(o => o[1] === 1), e3.onsets.length + ' strokes');
  const sp = sustained(Object.assign({}, CYCS, { body: 2, spread: 1 }), 0.2);
  let dlr = 0; for (let i = 0; i < sp.L.length; i++) dlr = Math.max(dlr, Math.abs(sp.L[i] - sp.R[i]));
  check('Spread places the two tymbals left and right', dlr > 0.01, 'max L−R ' + dlr.toFixed(3));
}

// ---------- Tune and Scatter roughen the tone ----------
{
  const depthOf = (p) => { const s = sustained(p, 1.0); const cp = cyclePeaks(s.L, Math.round(0.5 * SR), Math.round(0.95 * SR)).pk; return Math.min(...cp) / Math.max(...cp); };
  const base = depthOf(SEPT), tuned = depthOf(Object.assign({}, SEPT, { tune: 3 })), scat = depthOf(Object.assign({}, SEPT, { scatter: 1, stiffness: 0.6 }));
  check('a detuned tymbal (Tune +3 st) feeds the body less evenly', tuned < base * 0.8, `envelope floor ${(base * 100).toFixed(0)}% → ${(tuned * 100).toFixed(0)}%`);
  check('Scatter breaks the tone up', scat < base * 0.8, `envelope floor ${(base * 100).toFixed(0)}% → ${(scat * 100).toFixed(0)}%`);
}

// ---------- the body path is buffer-size independent too ----------
{
  const notes = [[60, 100, 0, 0.2], [62, 90, 0.12, 0.3]];
  const ref = render(0.35, Object.assign({}, SEPT, { mode: 1 }), { block: 1, notes }).L;
  let same = true;
  for (const bl of [64, 777]) { const x = render(0.35, Object.assign({}, SEPT, { mode: 1 }), { block: bl, notes }).L; for (let i = 0; i < x.length; i++) if (x[i] !== ref[i]) { same = false; break; } }
  check('lock, keeper and body: same output at buffer sizes 1, 64, 777 (Poly, two notes)', same);
}

// ================= batch 04: muscles, song, Rate mode =================
function songRun(p, seconds, opts) {
  opts = opts || {};
  const e = new TymbalEngine(SR, opts.seed || 7);
  for (const k in p) e.setParam(k, p[k]);
  if (opts.tempo) e.setTempo(opts.tempo);
  e.onsets = [];
  e.noteOn(opts.note || 60, opts.vel || 110);
  const n = Math.round(SR * seconds), L = new Float32Array(n), R = new Float32Array(n);
  const bl = opts.block || n;
  const tl = new Float32Array(bl), tr = new Float32Array(bl);
  for (let i = 0; i < n; i += bl) { const m = Math.min(bl, n - i); e.process(tl, tr, m); L.set(tl.subarray(0, m), i); R.set(tr.subarray(0, m), i); }
  return { e, L, R };
}
// envelope maxima in steps of `step` samples
function stepEnv(x, a, b, step) { const out = []; for (let i = a; i < b; i += step) { let m = 0; for (let j = i; j < Math.min(i + step, x.length); j++) m = Math.max(m, Math.abs(x[j])); out.push(m); } return out; }
// sound segments from a 1 ms envelope: [start, end] in ms, split by at least `quietMs` below thr × max
function segments(x, quietMs, thrShare) {
  const ev = stepEnv(x, 0, x.length, SR / 1000), thr = thrShare * Math.max(...ev);
  const segs = []; let on = false, st = 0, quiet = 0;
  for (let i = 0; i < ev.length; i++) {
    if (ev[i] > thr) { if (!on) { on = true; st = i; } quiet = 0; }
    else if (on && ++quiet >= quietMs) { segs.push([st, i - quiet + 1]); on = false; }
  }
  return segs;
}
// pulse rate from the envelope's periodicity: correlation peak near the expected lag, refined at
// ever longer lags (an error of a fraction of a sample is divided by the number of periods)
function pulseRate(x, a, b, fGuess) {
  const env = new Float64Array(b - a); let y = 0; const k = 1 - Math.exp(-2 * Math.PI * 1500 / SR);
  for (let i = a; i < b; i++) { y += k * (Math.abs(x[i]) - y); env[i - a] = y; }
  let mean = 0; for (const v of env) mean += v; mean /= env.length; for (let i = 0; i < env.length; i++) env[i] -= mean;
  const n = env.length;
  const ac = (lag) => { let s = 0, p = 0, q = 0; for (let i = 0; i + lag < n; i++) { s += env[i] * env[i + lag]; p += env[i] * env[i]; q += env[i + lag] * env[i + lag]; } return s / Math.sqrt(p * q); };
  const peak = (from, to) => { let best = from, bv = -Infinity; for (let l = from; l <= to; l++) { const v = ac(l); if (v > bv) { bv = v; best = l; } } const y0 = ac(best - 1), y2 = ac(best + 1); return best + 0.5 * (y0 - y2) / (y0 - 2 * bv + y2); };
  let T = SR / fGuess;
  T = peak(Math.floor(T * 0.9), Math.ceil(T * 1.1));
  for (let m = 4; m * T < n / 2; m *= 4) T = peak(Math.round(m * T) - 2, Math.round(m * T) + 2) / m;
  return SR / T;
}

const CYSTO = Object.assign(placeAt(850), { rate: 40, lrphase: 0.25, ribs: 4, recruit: 3, first: 5, lead: 1.7, spacing: 0.9, tilt: -4, taper: -6, tymbalq: 15, bodyq: 9, stiffness: 0.4, outratio: 2, outlevel: -12, hold: 0.7, attack: 0.02, jitter: 0 });
const ORNI = Object.assign(placeAt(4300), { song: 1, echeme: 0.105, gap: 0.08, rate: 100, ribs: 4, recruit: 3, spacing: 0.6, tymbalq: 8, bodyq: 5, stiffness: 0.5, jitter: 0.2, attack: 0.005 });
const CASS_PHRASE = Object.assign({}, CASS, { song: 2, phrase: 2.5, rest: 1, intro: 0.4, start: 0.11 });

// ---------- Cystosoma: bimodal pulses (Bennet-Clark & Young 1998, Figs 4 and 12) ----------
{
  const { L, e } = songRun(Object.assign({}, CYSTO, { jitter: 0.03, rubato: 0.1 }), 2.0);
  const left = e.onsets.filter(o => o[1] === 0 && o[0] > 0.2 && o[0] < 1.9);
  const lag = e.onsets.filter(o => o[1] === 1 && o[0] > 0.2 && o[0] < 1.9).map((o, i) => (o[0] - left[i][0]) * 1000);
  let bimodal = 0; const seps = [], dips = [], durs = [];
  for (const [t] of left) {
    const a = Math.round(t * SR) + DELAY, ev = stepEnv(L, a, a + Math.round(0.025 * SR), SR / 2000);   // 0.5 ms steps
    const top = Math.max(...ev), iMax = ev.indexOf(top);
    // an earlier hump at least 3 ms before the largest, with a dip of 15% or more between them
    let i1 = -1, dip = 1;
    for (let i = 0; i < iMax - 6; i++) { const between = Math.min(...ev.slice(i + 1, iMax)); if (ev[i] >= between * 1.15 && (i1 < 0 || ev[i] > ev[i1])) { i1 = i; dip = between / ev[i]; } }
    if (i1 >= 0) { bimodal++; seps.push((iMax - i1) * 0.5); dips.push(dip); }
    const on = ev.findIndex(v => v > 0.1 * top), off = ev.length - 1 - [...ev].reverse().findIndex(v => v > 0.1 * top);
    durs.push((off - on) * 0.5);
  }
  const med = (x) => { const y = [...x].sort((p, q) => p - q); return y[y.length >> 1]; };
  check('Cystosoma: the second tymbal starts 5–7 ms after the first', lag.every(x => x >= 5 && x <= 7), `${Math.min(...lag).toFixed(2)}–${Math.max(...lag).toFixed(2)} ms`);
  check('Cystosoma: bimodal pulses, humps about 5–7 ms apart', bimodal >= 0.9 * left.length && med(seps) >= 4.5 && med(seps) <= 7,
    `${bimodal} of ${left.length} pulses, humps a median ${med(seps)} ms apart, dip to ${(med(dips) * 100).toFixed(0)}% of the first`);
  check('Cystosoma: pulses about 20–25 ms long (paper: 20–23 ms, above 10% of the peak)', med(durs) >= 18 && med(durs) <= 25, `median ${med(durs)} ms`);
}

// ---------- M. cassini: phrase from about 20 to 180 pulses/s (Young & Josephson 1983) ----------
{
  const { e } = songRun(CASS_PHRASE, 4);
  const t = e.onsets.map(o => o[0]), rateIn = (a, b) => t.filter(x => x >= a && x < b).length / (b - a);
  const slow = rateIn(0.05, 0.75), fast = rateIn(1.2, 2.4), rest = rateIn(2.55, 3.45), next = rateIn(3.55, 4);
  check('M. cassini phrase: starts at 15–30 pulses/s', slow >= 15 && slow <= 30, slow.toFixed(1) + ' /s');
  check('M. cassini phrase: ends at 170–200 pulses/s', fast >= 170 && fast <= 200, fast.toFixed(1) + ' /s');
  check('M. cassini phrase: silent rest, then the next phrase starts slow again', rest === 0 && next >= 15 && next <= 30, `rest ${rest} /s, next phrase ${next.toFixed(1)} /s`);
}

// ---------- C. orni: echemes 84–116 ms, gaps 84–93 ms (Pinto-Juma et al., via the brief) ----------
{
  const { L } = songRun(ORNI, 4);
  const segs = segments(L, 15, 0.1).slice(1, -1);
  const lens = segs.map(s => s[1] - s[0]), gaps = segs.slice(1).map((s, i) => s[0] - segs[i][1]);
  const rate = (segs.length - 1) / ((segs[segs.length - 1][0] - segs[0][0]) / 1000);
  check('C. orni: echemes 84–116 ms, varied by Jitter', Math.min(...lens) >= 84 && Math.max(...lens) <= 116 && Math.max(...lens) - Math.min(...lens) > 8,
    `${lens.length} echemes, ${Math.min(...lens)}–${Math.max(...lens)} ms`);
  check('C. orni: gaps about 84–93 ms, 4.7–5.6 echemes/s', Math.min(...gaps) >= 80 && Math.max(...gaps) <= 100 && rate >= 4.7 && rate <= 5.6,
    `gaps ${Math.min(...gaps)}–${Math.max(...gaps)} ms, ${rate.toFixed(2)} echemes/s`);
}

// ---------- one stroke always sounds: Ticks ----------
{
  const { e } = songRun(Object.assign({}, CYCS, { song: 1, echeme: 0.005, gap: 0.2, jitter: 0 }), 1.1);
  const per = e.onsets.filter(o => o[1] === 0).map(o => o[0]);
  const gapsOk = per.slice(1).every((t, i) => Math.abs(t - per[i] - 0.205) < 1e-6);
  check('an echeme shorter than a muscle cycle still sounds one stroke (Ticks)', per.length === 6 && gapsOk, `${per.length} ticks, 205 ms apart`);
}

// ---------- Rate mode: the note sets the pulse rate ----------
{
  const base = Object.assign({}, CYCS, { playmode: 1, carrier: 4300, jitter: 0, asym: 0 });
  const results = [48, 60, 67].map(note => {
    const { L } = songRun(base, 1.0, { note });
    const want = 440 * Math.pow(2, (note - 69) / 12), got = pulseRate(L, Math.round(0.3 * SR), Math.round(0.95 * SR), want);
    return [note, want, got, 1200 * Math.log2(got / want)];
  });
  const worst = Math.max(...results.map(r => Math.abs(r[3])));
  check('Rate mode: pulse rate within 1 cent of the note (C3, C4, G4)', worst < 1, results.map(r => `${r[2].toFixed(2)} Hz (${r[3].toFixed(2)} c)`).join(', '));
  const { e } = songRun(base, 0.3);
  check('Rate mode: the body sits at the Carrier knob', Math.abs(e.info.carrier - 4300) < 0.01, e.info.carrier.toFixed(2) + ' Hz');
  // Heat: the stroke clock, and the sound with the lock off (locked ribs snap to the carrier's phase
  // grid, which moves each pulse by up to half a carrier period; see tests.md)
  const strokeRate = (r) => { const o = r.e.onsets.filter(x => x[0] > 0.3); return (o.length - 1) / (o[o.length - 1][0] - o[0][0]); };
  const hot = songRun(Object.assign({}, base, { heat: 38, stiffness: 1 }), 1.0), cold = songRun(Object.assign({}, base, { heat: 22, stiffness: 1 }), 1.0);
  const fh = pulseRate(hot.L, Math.round(0.3 * SR), Math.round(0.95 * SR), 261.6), fc = pulseRate(cold.L, Math.round(0.3 * SR), Math.round(0.95 * SR), 261.6);
  const sh = strokeRate(songRun(Object.assign({}, base, { heat: 38 }), 1.0)), scd = strokeRate(songRun(Object.assign({}, base, { heat: 22 }), 1.0));
  check('Rate mode: Heat leaves the pitch alone', Math.abs(1200 * Math.log2(fh / fc)) < 1 && Math.abs(1200 * Math.log2(sh / scd)) < 0.01,
    `strokes ${scd.toFixed(3)} → ${sh.toFixed(3)} /s; sound (no lock) ${fc.toFixed(2)} → ${fh.toFixed(2)} Hz`);
  const one = songRun(Object.assign({}, base, { pair: 1 }), 1.0), f1 = pulseRate(one.L, Math.round(0.3 * SR), Math.round(0.95 * SR), 261.6);
  check('Rate mode with one tymbal: it runs at the note itself', Math.abs(1200 * Math.log2(f1 / 261.63)) < 1, f1.toFixed(2) + ' Hz');
  const jit = songRun(Object.assign({}, base, { jitter: 0.03 }), 2.0), fj = pulseRate(jit.L, Math.round(0.3 * SR), Math.round(1.95 * SR), 261.6);
  check('Rate mode with the default Jitter: within 5 cents on average', Math.abs(1200 * Math.log2(fj / 261.63)) < 5, (1200 * Math.log2(fj / 261.63)).toFixed(2) + ' cents');
}

// ---------- Async: one command per burst, the force runs down ----------
{
  const { e } = songRun(Object.assign({}, CYCS, { drive: 1, burst: 4, rate: 100, lrphase: 0, jitter: 0 }), 0.5);
  const a = e.onsets.filter(o => o[1] === 0).slice(4, 16).map(o => o[2]);
  const pat = a.map(x => x / a[0]);
  const want = [1, 0.85, 0.7, 0.55];
  const ok = pat.every((x, i) => Math.abs(x - want[i % 4]) < 0.01);
  check('Async (burst 4): force 1, 0.85, 0.7, 0.55, then the next command', ok, pat.map(x => x.toFixed(2)).join(' '));
  const syncR = songRun(Object.assign({}, CYCS, { rate: 100, jitter: 0 }), 0.5).e.onsets.filter(o => o[1] === 0).slice(4, 12).map(o => o[2]);
  check('Sync: every stroke at full force', syncR.every(x => Math.abs(x / syncR[0] - 1) < 1e-9));
}

// ---------- Fall: the end of a phrase drops in level and pitch (M. septendecim) ----------
{
  const p = Object.assign({}, SEPT, { song: 2, phrase: 2, rest: 1, fall: 1, jitter: 0 });
  const { L, e } = songRun(p, 2.2);
  const z0 = zcPitch(L, Math.round(0.6 * SR), Math.round(1.2 * SR)), z1 = zcPitch(L, Math.round(1.93 * SR), Math.round(1.99 * SR));
  const drop = 1200 * Math.log2(z1.f / z0.f);
  let a0 = 0, a1 = 0; for (let i = Math.round(0.6 * SR); i < Math.round(1.2 * SR); i++) a0 = Math.max(a0, Math.abs(L[i])); for (let i = Math.round(1.9 * SR); i < Math.round(1.99 * SR); i++) a1 = Math.max(a1, Math.abs(L[i]));
  check('Fall 1: pitch drops toward 4 semitones at the end of the phrase', drop < -300 && drop > -420, `${z0.f.toFixed(0)} → ${z1.f.toFixed(0)} Hz, ${drop.toFixed(0)} cents`);
  check('Fall 1: level drops at the end of the phrase', dB(a1 / a0) < -6, dB(a1 / a0).toFixed(1) + ' dB');
}

// ---------- Sync: echemes on a beat division ----------
{
  const { e } = songRun(Object.assign({}, ORNI, { sync: 1, rubato: 0.5 }), 2.0, { tempo: 120 });
  const firsts = []; let last = -1;
  for (const o of e.onsets) if (o[1] === 0 && o[0] - last > 0.03) { firsts.push(o[0]); last = o[0]; } else if (o[1] === 0) last = o[0];
  const per = firsts.slice(1).map((t, i) => t - firsts[i]);
  check('Sync at 120 bpm: echemes every third of a beat (0.188 s snaps to 0.1667), ignoring Rubato', per.every(x => Math.abs(x - 1 / 6) < 1e-6), `${per.length} periods, ${per[0].toFixed(4)} s`);
}

// ---------- Rubato drifts the tempo; Jitter does not move the average ----------
{
  const strokes = (rub, jit) => { const { e } = songRun(Object.assign({}, CYCS, { rubato: rub, jitter: jit }), 3.0); const l = e.onsets.filter(o => o[1] === 0).map(o => o[0]); return l.slice(1).map((t, i) => t - l[i]); };
  const sd = (x) => { const m = x.reduce((a, b) => a + b) / x.length; return Math.sqrt(x.reduce((a, b) => a + (b - m) * (b - m), 0) / x.length) / m; };
  const mean = (x) => x.reduce((a, b) => a + b) / x.length;
  const plain = strokes(0, 0), jit = strokes(0, 0.5), rub = strokes(1, 0);
  // slow drift: the mean period over successive 0.5 s windows moves
  const win = []; let acc = 0, tt = 0, cnt = 0; for (const d of rub) { acc += d; cnt++; tt += d; if (tt >= 0.5) { win.push(acc / cnt); acc = 0; cnt = 0; tt = 0; } }
  check('Jitter 0.5: strokes vary by about 15% but the average rate holds', Math.abs(sd(jit) - 0.15) < 0.04 && Math.abs(mean(jit) / mean(plain) - 1) < 0.02, `SD ${(sd(jit) * 100).toFixed(1)}%, mean ${(100 * (mean(jit) / mean(plain) - 1)).toFixed(2)}%`);
  check('Rubato 1: the tempo drifts slowly (0.5 s windows differ)', sd(win) > 0.04 && sd(rub.slice(0, 20)) < 0.08, `window SD ${(sd(win) * 100).toFixed(1)}%`);
}

// ---------- aftertouch opens the opercula ----------
{
  const lv = (at) => { const e = new TymbalEngine(SR, 7); for (const [k, v] of Object.entries(Object.assign({}, CYCS, { aperture: 0 }))) e.setParam(k, v); e.setAftertouch(at); e.noteOn(60, 110); const L = new Float32Array(SR / 2), R = new Float32Array(SR / 2); e.process(L, R, L.length); let s = 0; for (let i = SR / 4; i < L.length; i++) s += L[i] * L[i]; return 10 * Math.log10(s); };
  const shut = lv(0), open = lv(1);
  check('aftertouch opens the opercula: louder by about 10 dB', open - shut > 7 && open - shut < 14, (open - shut).toFixed(1) + ' dB');
}

// ---------- song timing is buffer-size independent ----------
{
  const p = Object.assign({}, CASS_PHRASE, { rubato: 0.5, jitter: 0.3, phrase: 0.6, rest: 0.2, mode: 1 });
  const notes = [[60, 100, 0, 0.7], [64, 90, 0.31, 0.9]];
  const ref = render(1.0, p, { block: 1, notes }).L;
  let same = true;
  for (const bl of [64, 999]) { const x = render(1.0, p, { block: bl, notes }).L; for (let i = 0; i < x.length; i++) if (x[i] !== ref[i]) { same = false; break; } }
  const p2 = Object.assign({}, CYCS, { drive: 1, burst: 3, jitter: 0.4, song: 1, echeme: 0.05, gap: 0.03, playmode: 1 });
  for (const bl of [64, 999]) { const a = render(0.6, p2, { block: 1, notes }).L, b = render(0.6, p2, { block: bl, notes }).L; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { same = false; break; } }
  check('song, Rubato, Jitter, Async and Rate mode: same output at buffer sizes 1, 64, 999', same);
}

// ---------- every parameter in range at its default ----------
check('parameter table: defaults inside their ranges', PARAMS.every(p => p.def >= p.min && p.def <= p.max), PARAMS.length + ' parameters');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
