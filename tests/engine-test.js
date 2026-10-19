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
  const n = countClicks(L, s0, s1, 0.004);
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

// ---------- every parameter in range at its default ----------
check('parameter table: defaults inside their ranges', PARAMS.every(p => p.def >= p.min && p.def <= p.max), PARAMS.length + ' parameters');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
