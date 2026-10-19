# tymbal · build plan

Reference engine and bench first, then the C++ port and the plugin. Design: `design.md`.

Each batch ends with passing tests and a commit authored as
`bytebent <bytebent@users.noreply.github.com>`. Nothing moves to the next batch until you've
checked the one before where it says **You**.

## Layout

```
reference/
  tymbal-engine.js   the reference engine; defines the sound
  presets.js         test presets (bench and tests only)
source/
  TymbalDSP.h        C++ port, no JUCE
  PluginProcessor.*  JUCE instrument: MIDI in, stereo out
  PluginEditor.*     web-view host
  PresetManager.h    saving and loading presets
ui/index.html        interface (also opens in a browser)
tests/               engine-test.js, compare.js + dsp_cli.cpp, plugin_test.cpp
tools/
  bench/             bench template, AudioWorklet wrapper, build script → tymbal.html
  perf.js            CPU per scenario
  render-presets.js  every test preset to a WAV
packaging/           Mac installer
.github/workflows/   CI: tests, universal binary, auval, pluginval strictness 7
```

## Batches

| # | Batch | Contents | Check | State |
|---|---|---|---|---|
| 01 | **Setup** | `README.md`, `design.md`, `plan.md`, `research.md`, `.gitignore`. | | Done |
| 02 | **Tymbal core** | One tymbal: state machine, retuning resonator, asymmetric excitation and the amplitude-dependent start, rib table (`first`, `tilt`, `firstlevel`, `taper`, Q ∝ 1/f), recruitment, spacing and lead, OUT click and `outclicks`, Heat. Event writer and scheduler from Dolphin. Test runner. | Tests: an isolated *Cyclochila* stroke reproduces Table 2 of Bennet-Clark 1997 (rib frequencies within 3%, levels within 1 dB, OUT about 10 dB down at 1.5×); per-rib Q follows 1/f; same output at any buffer size · **You:** listen to single strokes | Done: 26 tests; ribs within 0.8% and 0.7 dB of Table 2, OUT 6.55 kHz at −0.6 dB; Q·f within 5% · **You:** listen to presets 01–08 |
| 03 | **Body and lock** | Helmholtz body (`bodyq`, `aperture`, `membrane`, `cavity`, low-pass), Open body, direct leak, the lock with its window and ¼ gate, Stiffness, Scatter, `tune`. Both tymbals and `lrphase`. | Tests: tymbal Q 9.3 into body Q 3.4 radiates with Q 12.5 ± 20%; three clicks 450 µs apart into a 4.3 kHz body give one smooth pulse, 760 µs a double-humped one (Bennet-Clark & Young 1992, Figs 14–15); *M. cassini* keeps 9 separate sub-pulses, *Cyclochila* ribs lock, *M. septendecim* strokes lock into a tone with no phase break; sidebands at carrier ± 1/interval; Carrier mode in tune within 1 cent at Tune 0 · **You:** listen to the four lock cases | |
| 04 | **Muscles and song** | Sync and Async drive, `rate`, `hold`, `pair`, `asym`, effort from velocity and envelope, Rate mode, the song modes with `start`, `intro`, `fall`, jitter, rubato and tempo sync. | Tests: *Cystosoma* gives bimodal pulses of 20–25 ms with the second tymbal 5–7 ms late; *M. cassini* phrase moves from about 20 to 180 pulses/s; *C. orni* echemes 84–116 ms; Rate mode pulse rate within 1 cent of the note; timing exact at any buffer size · **You:** listen to presets 01–09 | |
| 05 | **Cost** | `perf.js`: defaults, the worst case (24 ribs, short spacing, high rate, every body mode, 8 voices). Decides the Poly voice count. | Numbers in the README | |
| 06 | **Moths and hoppers** | Many-rib wave and passive half-cycle presets, `time` and `link`, the guard, the Plant body (dispersion, stem modes, contact colour). | Tests: *Bertholdia* at ×8 gives 21.5 clicks per half-cycle near 6 kHz and 236 ms cycles; nothing leaves 20 Hz–16 kHz at any Time or note; hopper presets sit in 50–900 Hz · **You:** listen to presets 10–15 | |
| 07 | **Bladder and chorus** | Bladder body (three panels, `extend`, `split`, stereo placement), `spread`, voice coupling (Free, Sync, Alternate), `onsets()` for krill. | Tests: Extend 0 → 1 doubles the level and raises Q from about 4 to 9; coupled voices in Sync converge within a few phrases · **You:** listen | |
| 08 | **Bench** | `tymbal.html`: keyboard as on the other benches, test presets, live view with lock ticks, DSP meter. | **You:** first listening round; decide LFOs, Trigger mode, the snap-through option, `link` and the test presets that ship | |
| 09 | **C++ port** | `TymbalDSP.h`, `dsp_cli.cpp`, `compare.js`. | Tests: C++ matches the reference | |
| 10 | **Plugin** | JUCE wrapper, web-view UI, presets, installer, CI. Plugin code and colour decided. | CI green · **You:** play it in a host | |
| 11 | **Listening round** | Tuning defaults and ranges from what you hear. | **You** | |
