// Test presets: bench and tests only, not the plugin build.
// phrase: [note, start s, length s]. Carrier mode: middle C (60) plays C8 = 4186 Hz; Transpose and
// Detune place each species' carrier. switchAt changes one parameter partway through a render.
'use strict';
const st = (f) => 12 * Math.log2(f / 4186.01);           // semitones from C8 to f
function place(f) { const s = st(f), t = Math.round(s); return { transpose: t, detune: Math.round((s - t) * 100) }; }

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
    name: '04 Magicicada cassini',
    note: 'Young & Josephson 1983: about 9 sub-pulses per stroke at about 1 kHz, a stiff tymbal, broad tuning around 6 kHz; muscles alternate at 90 Hz.',
    params: CASSINI,
    phrase: [[60, 0, 1.5]],
  },
  {
    name: '05 Magicicada septendecim',
    note: 'A slack tymbal and thick eardrums (Membrane 1: body Q about 24): every rib and stroke locks to the ringing, an unbroken 1.3 kHz tone modulated at 136 Hz.',
    params: SEPTENDECIM,
    phrase: [[60, 0, 2.5]],
  },
  {
    name: '06 Cystosoma, bimodal pulses',
    note: 'Bennet-Clark & Young 1998: the second tymbal a quarter cycle late, rib 1 high and quiet, ribs 2–3 at 850 Hz; the trailing ribs lock to the leading side\'s resonance. Bladder body comes in batch 07 (Helmholtz for now).',
    params: Object.assign(place(850), { rate: 40, lrphase: 0.25, ribs: 4, recruit: 3, first: 4, lead: 4.5, spacing: 0.9, tilt: -4, firstlevel: -5, taper: -6, tymbalq: 15, bodyq: 9, stiffness: 0.2, outratio: 2, outlevel: -12, hold: 0.7, attack: 0.02 }),
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
    name: '08 Moth sketch (Bertholdia, slowed by hand)',
    note: 'Preview for batch 06: 21 striations 0.57 ms apart sweeping down, a pause, then the passive half-cycle; about 6 kHz, no body. Time scaling comes later.',
    params: Object.assign(place(6000), { rate: 4.2, ribs: 21, recruit: 21, spacing: 0.57, tilt: -18, first: 6, taper: -4, tymbalq: 8, outratio: 1, outlevel: -3, outclicks: 1, outspeed: 1, hold: 0.5, body: 2, pair: 1, stiffness: 0.8, attack: 0.001, sustain: 1 }),
    phrase: [[60, 0, 1.5]],
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
];

if (typeof module !== 'undefined' && module.exports) module.exports = { PRESETS };
else (typeof globalThis !== 'undefined' ? globalThis : this).TYMBAL_PRESETS = PRESETS;
