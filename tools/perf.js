// Performance benchmark for the reference engine. Run: node tools/perf.js [seconds]
// Prints how much of one CPU core each scenario needs to run in real time at 48 kHz, and the
// clicks per second the voices fire (IN ribs and OUT clicks).
// This is the JS reference; the C++ port will be faster, but the ratios between scenarios carry over.
// Each scenario runs in a fresh Node process, so one scenario's JIT state cannot slow another.
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const { TymbalEngine } = require(path.join(__dirname, '..', 'reference', 'tymbal-engine.js'));
const { PRESETS } = require(path.join(__dirname, '..', 'reference', 'presets.js'));

const SR = 48000, SECS = +process.argv[2] || 3, BL = 128;
const preset = (n) => PRESETS.find(p => p.name.startsWith(n)).params;
const chord = [48, 52, 55, 60, 64, 67, 72, 76];
// the heaviest settings: every rib on, ribs as close and the muscle as fast as the knobs allow,
// every rib clicking on the way out too, both cavity modes loud, a slack tymbal so every rib runs the lock
const WORST = { ribs: 24, recruit: 24, spacing: 0.05, rate: 600, hold: 0.95, outclicks: 1, outspeed: 0.05, cavity: 1, direct: 1, stiffness: 0, scatter: 1, jitter: 1, rubato: 1, attack: 0.001, sustain: 1 };
const SCENARIOS = [
  ['Silent (no notes)', {}, []],
  ['1 voice, defaults', {}, [60]],
  ['1 voice, Cyclochila calling song (02)', preset('02'), [60]],
  ['1 voice, M. septendecim, locked tone (05)', preset('05'), [60]],
  ['1 voice, M. cassini phrase (04)', preset('04'), [60]],
  ['1 voice, Open body (01 at song speed)', Object.assign({}, preset('01'), { rate: 117, spacing: 0.6 }), [60]],
  ['1 voice, Async (13)', preset('13'), [60]],
  ['1 voice, Rate mode at C6 (14)', preset('14'), [84]],
  ['1 voice, worst case', WORST, [60]],
  ['8 voices, defaults', { mode: 1 }, chord],
  ['8 voices, Cyclochila calling song', Object.assign({}, preset('02'), { mode: 1 }), chord],
  ['8 voices, worst case', Object.assign({}, WORST, { mode: 1 }), chord],
];

function run(params, notes) {
  const e = new TymbalEngine(SR, 1234);
  e.setParam('sustain', 1);
  for (const k in params) e.setParam(k, params[k]);
  for (const n of notes) e.noteOn(n, 110);
  const L = new Float32Array(BL), R = new Float32Array(BL);
  for (let i = 0; i < SR * 0.5; i += BL) e.process(L, R, BL);          // warm up the JIT and the song
  const total = Math.round(SR * SECS / BL) * BL;
  const ins0 = e.stats.ins, clicks0 = e.voices.reduce((a, v) => a + v.tym[0].strokes + v.tym[1].strokes, 0);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < total; i += BL) e.process(L, R, BL);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const ins = (e.stats.ins - ins0) / (total / SR);
  const strokes = (e.voices.reduce((a, v) => a + v.tym[0].strokes + v.tym[1].strokes, 0) - clicks0) / (total / SR);
  return [ms / (total / SR * 1000), ins, strokes];
}

// child: run one scenario (best of two) and print its numbers as JSON
const one = process.argv.indexOf('--one');
if (one >= 0) {
  const [, p, notes] = SCENARIOS[+process.argv[one + 1]];
  const a = run(p, notes.slice()), b = run(p, notes.slice());
  console.log(JSON.stringify([Math.min(a[0], b[0]), a[1], a[2]]));
  process.exit(0);
}
const rows = SCENARIOS.map(([name], i) => [name].concat(JSON.parse(execFileSync(process.execPath, [__filename, String(SECS), '--one', String(i)]).toString())));
const w = Math.max(...rows.map(r => r[0].length));
console.log('Scenario'.padEnd(w) + '   core   IN clicks/s   strokes/s');
for (const [name, share, ins, strokes] of rows)
  console.log(name.padEnd(w) + ' ' + (share * 100).toFixed(2).padStart(6) + '%' + ins.toFixed(0).padStart(13) + strokes.toFixed(0).padStart(12));
