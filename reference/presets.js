// Test presets: bench and tests only, not the plugin build.
// phrase: [note, start s, length s]. Carrier mode: middle C (60) plays C8 = 4186 Hz; Transpose and
// Detune place each species' carrier. switchAt changes one parameter partway through a render.
'use strict';
const st = (f) => 12 * Math.log2(f / 4186.01);           // semitones from C8 to f
function place(f) { const s = st(f), t = Math.round(s); return { transpose: t, detune: Math.round((s - t) * 100) }; }
// below 262 Hz Transpose runs out (−48 st): place the carrier with the note instead
function low(f) { const s = 12 * Math.log2(f / 261.626), t = Math.round(s); return { params: { transpose: -48, detune: Math.round((s - t) * 100) }, note: 60 + t }; }
const MOTH = { time: 8, body: 2, stiffness: 1, outratio: 1, outclicks: 1, outspeed: 1, hold: 0.5, attack: 0.001, sustain: 1 };
const S_TIT = low(234), S_TIT_M = low(255), TETT = low(400);

// Cyclochila australasiae, Bennet-Clark 1997 Table 2: rib 2 on the carrier (4.19 kHz)
const CYC_RIBS = { ribs: 4, first: 0.73, tilt: -4.83, firstlevel: -0.09, taper: -8.27, outratio: 1.561, outlevel: -9.45 };
const CASSINI = Object.assign(place(6000), { rate: 90, ribs: 12, recruit: 9, spacing: 1.02, hold: 0.92, tymbalq: 4, bodyq: 3, tilt: -1, taper: -3, outratio: 1.4, stiffness: 0.9, attack: 0.02, sustain: 1 });
const SEPTENDECIM = Object.assign(place(1300), { rate: 68, ribs: 12, recruit: 4, spacing: 0.77, tymbalq: 12, tilt: -1, taper: -2, stiffness: 0.1, outlevel: -16, membrane: 1, cavity: 0.1, attack: 0.15, sustain: 1 });

const PRESETS = [
  {
    name: '01 Cyclochila, slow pull (Table 2)',
    note: 'Bennet-Clark 1997, the unloaded tymbal of an abdomenless cicada: Open body, one tymbal, ribs 4 ms apart so each click stands alone; OUT 125 ms later.',
    params: Object.assign({}, CYC_RIBS, { rate: 4, spacing: 4, recruit: 4, hold: 0.5, tymbalq: 10, body: 2, pair: 1, stiffness: 1, attack: 0.001, sustain: 1 }),
    phrase: [[60, 0, 1.0]],
  },
  {
    name: '02 Cyclochila, calling song',
    note: 'Both tymbals alternating at 117 Hz (234 pulses/s), 3 ribs 0.6 ms apart, tymbal Q 9.3 into the air sac; ribs 2–3 lock onto the ringing.',
    params: Object.assign({}, CYC_RIBS, { rate: 117, spacing: 0.6, recruit: 3, tymbalq: 9.3, bodyq: 6, stiffness: 0.3, attack: 0.03 }),
    phrase: [[60, 0, 1.5]],
  },
  {
    name: '03 Cyclochila, protest',
    note: 'All four ribs, slower and irregular, OUT clicks of the ribs too, opercula half shut.',
    params: Object.assign({}, CYC_RIBS, { rate: 45, spacing: 0.7, recruit: 4, tymbalq: 9.3, bodyq: 6, stiffness: 0.6, scatter: 0.3, outclicks: 0.5, aperture: 0.5, attack: 0.01 }),
    phrase: [[60, 0, 1.2]],
  },
  {
    name: '04 Magicicada cassini, calling song',
    note: 'Young & Josephson 1983: phrases of isolated ticks at 15–30 pulses/s that break into a buzz at 170–200 (both muscles alternating at 90 Hz), about 9 sub-pulses per stroke, a stiff tymbal, broad tuning around 6 kHz. Phrase 2.5 s with a 1 s rest (estimates).',
    params: Object.assign({}, CASSINI, { song: 2, phrase: 2.5, rest: 1, intro: 0.4, start: 0.11, rubato: 0.2 }),
    phrase: [[60, 0, 7.0]],
  },
  {
    name: '05 Magicicada septendecim, calling song',
    note: 'A slack tymbal and thick eardrums (Membrane 1: body Q about 24): every rib and stroke locks, an unbroken 1.3 kHz tone modulated at 136 Hz, in phrases of 2–3 s about 1 s apart, each ending with a drop in level and pitch (Young & Josephson 1983; Fall 0.6 is an estimate).',
    params: Object.assign({}, SEPTENDECIM, { song: 2, phrase: 2.5, rest: 1, fall: 0.6, rubato: 0.15 }),
    phrase: [[60, 0, 9.5]],
  },
  {
    name: '06 Cystosoma, bimodal pulses',
    note: 'Bennet-Clark & Young 1998, Figs 4 and 12: the second tymbal a quarter cycle (6 ms) late; each tymbal\'s rib 1 is higher than the song, its ribs 2–3 at 850 Hz two cycles later. The trailing rib 1 lands out of tune on the ringing abdomen (the dip), its ribs 2–3 lock and build the second hump. Bladder body comes in batch 07 (Helmholtz for now).',
    params: Object.assign(place(850), { rate: 40, lrphase: 0.25, ribs: 4, recruit: 3, first: 5, lead: 1.7, spacing: 0.9, tilt: -4, taper: -6, tymbalq: 15, bodyq: 9, stiffness: 0.4, outratio: 2, outlevel: -12, hold: 0.7, attack: 0.02, rubato: 0.1 }),
    phrase: [[60, 0, 1.5]],
  },
  {
    name: '07 Heat: cassini from 20 to 35 °C',
    note: 'Sub-pulses speed from about 650 to 1200 Hz, the muscle with them; the 6 kHz carrier stays put.',
    params: Object.assign({}, CASSINI, { heat: 20 }),
    phrase: [[60, 0, 2.0]],
    switchAt: { time: 1.0, id: 'heat', value: 35 },
  },
  {
    name: '08 Bertholdia trigona, ×8',
    note: 'The tiger moth that jams bat sonar (Corcoran et al. 2009, 2010): 21.5 clicks over a 12.2 ms active half-cycle, a pause, the passive half-cycle, 29.5 ms per cycle; dominant 48.7 kHz, −15 dB from 21.9 to 83.1 kHz. Natural timing with Time ×8: a 236 ms cycle, about 6 kHz. Spread of rib pitches fitted to the band; one tymbal.',
    params: Object.assign(place(7600), MOTH, { rate: 1000 / 29.5, pair: 1, ribs: 22, recruit: 22, spacing: 0.57, first: 5, tilt: -9.5, taper: -3, tymbalq: 9, outlevel: -6 }),
    phrase: [[60, 0, 2.5]],
  },
  {
    name: '09 Cyclochila closing its opercula',
    note: 'Calling song; after 1 s the lids over the eardrums close. The air sac\'s own resonance drops to 0.82× (Bennet-Clark & Young 1992, Table 2), but the tymbal keeps driving at 4.2 kHz: the song gets about 10 dB quieter rather than lower.',
    params: Object.assign({}, CYC_RIBS, { rate: 117, spacing: 0.6, recruit: 3, tymbalq: 9.3, bodyq: 6, stiffness: 0.3, attack: 0.03 }),
    phrase: [[60, 0, 2.0]],
    switchAt: { time: 1.0, id: 'aperture', value: 0 },
  },
  {
    name: '10 septendecim, then stiff',
    note: 'The same animal; after 1.25 s its tymbal turns stiff: the lock lets go and the tone breaks into pulses.',
    params: SEPTENDECIM,
    phrase: [[60, 0, 2.5]],
    switchAt: { time: 1.25, id: 'stiffness', value: 1 },
  },
  {
    name: '11 Cicada orni',
    note: 'Echemes of 84–116 ms with gaps of 84–93 ms, about 5 per second, carrier 4.2–4.8 kHz (Bulgarian and Iberian recordings, via the brief). Muscle rate and rib timing are estimates.',
    params: Object.assign(place(4400), { song: 1, echeme: 0.105, gap: 0.08, rate: 100, ribs: 4, recruit: 3, spacing: 0.6, tilt: -3, taper: -5, tymbalq: 8, bodyq: 5, stiffness: 0.5, jitter: 0.2, rubato: 0.1, attack: 0.005 }),
    phrase: [[60, 0, 4.0]],
  },
  {
    name: '12 Lyristes plebejus (estimate)',
    note: 'About 5.8 echemes per second at 6.1 kHz (via the brief); echeme and gap lengths, muscle and ribs are estimates for listening.',
    params: Object.assign(place(6130), { song: 1, echeme: 0.12, gap: 0.052, rate: 150, ribs: 6, recruit: 4, spacing: 0.4, tilt: -2, taper: -4, tymbalq: 7, bodyq: 5, stiffness: 0.5, jitter: 0.1, rubato: 0.1, attack: 0.005 }),
    phrase: [[60, 0, 4.0]],
  },
  {
    name: '13 Platypleura capitata, Async (estimate)',
    note: 'Josephson & Young 1981: asynchronous tymbal muscles, 389 pulses/s, a burst of pulses for each nerve impulse; in protest song both muscles fire together. Carrier, burst length and ribs are estimates.',
    params: Object.assign(place(5000), { drive: 1, burst: 6, rate: 195, lrphase: 0.5, ribs: 4, recruit: 2, spacing: 0.35, tymbalq: 7, bodyq: 5, stiffness: 0.6, jitter: 0.1, attack: 0.01 }),
    phrase: [[60, 0, 1.5]],
    switchAt: { time: 0.75, id: 'lrphase', value: 0 },
  },
  {
    name: '14 Rate mode melody',
    note: 'The note sets the pulse rate (two tymbals alternating, each at half the note); the body stays at 4.3 kHz. Cyclochila\'s ribs, a little stiff so pulses stay evenly spaced.',
    params: Object.assign({}, CYC_RIBS, { playmode: 1, carrier: 4300, spacing: 0.6, recruit: 3, tymbalq: 9.3, bodyq: 6, stiffness: 0.8, asym: 0, glide: 0.04, attack: 0.02, release: 0.08 }),
    phrase: [[48, 0, 0.45], [55, 0.5, 0.45], [60, 1.0, 0.45], [64, 1.5, 0.45], [67, 2.0, 0.9], [60, 3.0, 0.9]],
  },
  {
    name: '15 Ticks',
    note: 'Echemes shorter than a muscle cycle: one stroke each, 5 per second (the ticks of M. cassini\'s phrase start, on their own).',
    params: Object.assign({}, CASSINI, { song: 1, echeme: 0.005, gap: 0.2, jitter: 0.3, rubato: 0.2 }),
    phrase: [[60, 0, 2.5]],
  },
  {
    name: '16 Cycnia tenera, ×8',
    note: 'Dogbane tiger moth (Corcoran et al. 2010; Fullard): 7.5 clicks per 6.5 ms half-cycle, 22.7 ms cycle, 63.5 kHz, in bursts of 1–20 cycles. Time ×8: 182 ms cycles at about 7.9 kHz. Burst lengths and gaps are estimates.',
    params: Object.assign(place(63500 / 8), MOTH, { rate: 1000 / 22.7, pair: 1, ribs: 8, recruit: 8, spacing: 0.87, first: 3, tilt: -7, taper: -2, tymbalq: 7, outlevel: -4, song: 1, echeme: 0.12, gap: 0.15, jitter: 0.2 }),
    phrase: [[60, 0, 4.0]],
  },
  {
    name: '17 Achroia grisella, ×8',
    note: 'Lesser wax moth, a pyraloid (Jang & Greenfield 1996; Snedden 1994): 100–150 µs pulses at 70–130 kHz in pairs, 80–100 pairs per second. Time ×8: about 11 pairs per second at 12.5 kHz. The gap inside a pair is an estimate.',
    params: Object.assign(place(100000 / 8), MOTH, { rate: 90, ribs: 1, recruit: 1, lrphase: 0.06, tymbalq: 8, outlevel: -14, outclicks: 0, jitter: 0.05 }),
    phrase: [[60, 0, 3.0]],
  },
  {
    name: '18 Scaphoideus titanus, female',
    note: 'Grapevine leafhopper (Mazzoni et al. 2009): vibrational pulses through the stem, about 23 per second at about 234 Hz, energy below 900 Hz. Plant body; pulse shape and stem are estimates.',
    params: Object.assign(S_TIT.params, { body: 3, rate: 23, pair: 1, ribs: 1, recruit: 1, tymbalq: 3, outlevel: -12, stem: 250, bodyq: 6, distance: 0.4, stiffness: 1, jitter: 0.08, attack: 0.002, sustain: 1 }),
    phrase: [[S_TIT.note, 0, 2.5]],
  },
  {
    name: '19 Scaphoideus titanus, male courtship',
    note: 'Pulse trains at about 82 per second at 255 Hz (Mazzoni et al. 2009); the four-part phrase is simplified to trains with pauses (estimates).',
    params: Object.assign(S_TIT_M.params, { body: 3, rate: 41, ribs: 2, recruit: 2, spacing: 3, tymbalq: 4, outlevel: -10, stem: 250, bodyq: 6, distance: 0.5, stiffness: 0.8, song: 1, echeme: 0.6, gap: 0.35, jitter: 0.08, rubato: 0.1, attack: 0.01 }),
    phrase: [[S_TIT_M.note, 0, 4.0]],
  },
  {
    name: '20 Planthopper snapping organ',
    note: 'Davranoglou et al. 2019: one cycle every 0.3–1 s, two elastic recoils per cycle, broadband 50–5000 Hz through the plant (Virant-Doberlet et al. 2023). Carrier, stem and the gap between recoils are estimates.',
    params: Object.assign(place(800), { body: 3, rate: 1.6, pair: 1, ribs: 1, recruit: 1, tymbalq: 2, outratio: 1.3, outlevel: -2, hold: 0.12, stem: 180, bodyq: 5, distance: 0.6, stiffness: 1, jitter: 0.15, attack: 0.001, sustain: 1 }),
    phrase: [[60, 0, 4.0]],
  },
  {
    name: '21 Tettigarcta (estimate)',
    note: 'The hairy cicada: primitive tymbals, no resonant air sac, faint signals carried by the substrate (Claridge, Morgan & Moulds 1999). No measured numbers: carrier, rate and ribs are guesses for listening.',
    params: Object.assign(TETT.params, { body: 3, rate: 30, ribs: 3, recruit: 3, spacing: 1.5, tilt: -3, tymbalq: 4, outlevel: -8, stem: 300, bodyq: 5, distance: 0.3, stiffness: 0.8, song: 1, echeme: 0.8, gap: 0.6, jitter: 0.1, attack: 0.01 }),
    phrase: [[TETT.note, 0, 4.0]],
  },
  {
    name: '22 Hopper purr, Rate mode',
    note: 'Small hoppers\' pure-tone vibrational signals follow muscle rate, rising with temperature (Tishechkin 2013): here the note sets the pulse rate, through a 200 Hz stem. For playing.',
    params: { playmode: 1, body: 3, carrier: 600, ribs: 2, recruit: 2, spacing: 0.8, tymbalq: 4, outlevel: -10, stem: 200, bodyq: 6, distance: 0.3, stiffness: 0.8, asym: 0, glide: 0.05, attack: 0.02, release: 0.1 },
    phrase: [[36, 0, 0.7], [43, 0.75, 0.7], [48, 1.5, 0.7], [41, 2.25, 1.2]],
  },
  {
    name: '23 Link: Bertholdia played down an octave',
    note: 'Link 1 makes Time follow the note like tape: an octave lower, every time doubles.',
    params: Object.assign(place(7600), MOTH, { rate: 1000 / 29.5, pair: 1, ribs: 22, recruit: 22, spacing: 0.57, first: 5, tilt: -9.5, taper: -3, tymbalq: 9, outlevel: -6, link: 1 }),
    phrase: [[60, 0, 1.2], [48, 1.3, 2.4]],
  },
];

if (typeof module !== 'undefined' && module.exports) module.exports = { PRESETS };
else (typeof globalThis !== 'undefined' ? globalThis : this).TYMBAL_PRESETS = PRESETS;
