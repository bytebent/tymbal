// Test presets: bench and tests only, not the plugin build.
// phrase: [note, start s, length s]. Carrier mode: middle C (60) plays C8 = 4186 Hz; Transpose and
// Detune place each species' carrier. Batch 02 has one tymbal and no body yet, so these are the
// bare tymbal: what the abdomen will shape from batch 03 on.
'use strict';
const st = (f) => 12 * Math.log2(f / 4186.01);           // semitones from C8 to f
function place(f) { const s = st(f), t = Math.round(s); return { transpose: t, detune: Math.round((s - t) * 100) }; }

const PRESETS = [
  {
    name: '01 Cyclochila, slow pull (Table 2)',
    note: 'Bennet-Clark 1997, unloaded tymbal: ribs 4 ms apart so each click stands alone; OUT 125 ms later.',
    params: { rate: 4, spacing: 4, ribs: 4, recruit: 4, hold: 0.5, first: 0.73, tilt: -4.83, firstlevel: -0.09, taper: -8.27, tymbalq: 10, outratio: 1.561, outlevel: -9.45, attack: 0.001, sustain: 1 },
    phrase: [[60, 0, 1.0]],
  },
  {
    name: '02 Cyclochila, song speed',
    note: 'One tymbal at 117 Hz, 3 ribs 0.6 ms apart (2–3 cycles), loaded Q 9.3. Batch 03 adds the second tymbal and the abdomen.',
    params: { rate: 117, spacing: 0.6, ribs: 4, recruit: 3, first: 0.73, tilt: -4.83, firstlevel: -0.09, taper: -8.27, tymbalq: 9.3, outratio: 1.561, outlevel: -9.45, attack: 0.03 },
    phrase: [[60, 0, 1.2]],
  },
  {
    name: '03 Cyclochila, protest',
    note: 'All four ribs, slower and louder, OUT clicks of the ribs too.',
    params: { rate: 45, spacing: 0.7, ribs: 4, recruit: 4, first: 0.73, tilt: -4.83, firstlevel: -0.09, taper: -8.27, tymbalq: 9.3, outratio: 1.561, outlevel: -9.45, outclicks: 0.5, attack: 0.01 },
    phrase: [[60, 0, 1.0]],
  },
  {
    name: '04 Magicicada cassini',
    note: 'Young & Josephson 1983: about 9 sub-pulses per stroke at 650–1200 Hz (1.02 ms at 30 °C), carrier 6 kHz, Q 5, muscle 90 Hz.',
    params: Object.assign(place(6000), { rate: 90, ribs: 12, recruit: 9, spacing: 1.02, hold: 0.92, tymbalq: 5, tilt: -1, taper: -3, outratio: 1.4, attack: 0.02, sustain: 1 }),
    phrase: [[60, 0, 1.2]],
  },
  {
    name: '05 Magicicada septendecim (no lock yet)',
    note: 'Carrier 1.3 kHz, a slack tymbal buckling in 3–4 stages, muscle 68 Hz. Without the body and the lock (batch 03) it stays pulsed.',
    params: Object.assign(place(1300), { rate: 68, ribs: 12, recruit: 4, spacing: 1.5, tymbalq: 12, tilt: -1, taper: -2, outratio: 1.4, outlevel: -16, attack: 0.15 }),
    phrase: [[60, 0, 1.5]],
  },
  {
    name: '06 Cystosoma, one tymbal',
    note: 'Bennet-Clark & Young 1998: rib 1 at about 1.07 kHz and 5 dB quieter, ribs 2–3 at 850 Hz 4–6 ms later, OUT near 1.7 kHz.',
    params: Object.assign(place(850), { rate: 40, ribs: 4, recruit: 3, first: 4, lead: 4.5, spacing: 0.9, tilt: -4, firstlevel: -5, taper: -6, tymbalq: 15, outratio: 2, outlevel: -12, hold: 0.7, attack: 0.02 }),
    phrase: [[60, 0, 1.2]],
  },
  {
    name: '07 Heat: cassini from 20 to 35 °C',
    note: 'Sub-pulses speed from about 650 to 1200 Hz, the muscle with them; the 6 kHz carrier stays put.',
    params: Object.assign(place(6000), { rate: 90, ribs: 12, recruit: 9, spacing: 1.02, hold: 0.92, tymbalq: 5, tilt: -1, taper: -3, outratio: 1.4, heat: 20, attack: 0.02, sustain: 1 }),
    phrase: [[60, 0, 2.0]],
    switchAt: { time: 1.0, id: 'heat', value: 35 },
  },
  {
    name: '08 Moth sketch (Bertholdia, slowed by hand)',
    note: 'Preview for batch 06: 21 striations 0.57 ms apart sweeping down, a pause, then the passive half-cycle; about 6 kHz. Time scaling comes later.',
    params: Object.assign(place(6000), { rate: 4.2, ribs: 21, recruit: 21, spacing: 0.57, tilt: -18, first: 6, taper: -4, tymbalq: 8, outratio: 1, outlevel: -3, outclicks: 1, outspeed: 1, hold: 0.5, attack: 0.001, sustain: 1 }),
    phrase: [[60, 0, 1.5]],
  },
];

if (typeof module !== 'undefined' && module.exports) module.exports = { PRESETS };
else (typeof globalThis !== 'undefined' ? globalThis : this).TYMBAL_PRESETS = PRESETS;
