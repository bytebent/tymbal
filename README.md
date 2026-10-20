# tymbal

An insect voice synth by bytebent, for every animal that sings with tymbals: cicadas, tymbal moths
and leafhoppers. Each voice is a pair of ribbed tymbals that store muscle energy and release it
as a train of resonant clicks, one per rib, and the body those clicks drive: a cicada's tuned
abdomen, a bladder cicada's balloon, open air, or the plant stem a leafhopper drums on.

A stiff tymbal clicks on its own timing and sounds pulsed and buzzy. A slack one lets the body's
ringing decide the exact moment of each buckle, and the clicks merge into a pure tone, the way
the periodical cicada *Magicicada septendecim* sings. Most of the sound lives between those two.

Unlike Throat and mouth-tube or Syrinx and beak-tube, the source and the body are one plugin.

Status: **prototype, batch 07 of 11**. The reference engine has two tymbals whose ribs buckle one
by one and retune them, matching *Cyclochila*'s measured ribs (Bennet-Clark 1997) within 1% and
1 dB, and a body they drive. The lock lets the body's ringing time each rib: a slack
*Magicicada septendecim* sings an unbroken Q 25 tone, in tune within a cent, and turns pulsed when
made stiff. One muscle clock per voice sings echemes and phrases, Sync or Async, and in Rate mode
the note sets the pulse rate. Tymbal moths come into hearing range with Time (*Bertholdia*, the
moth that jams bat sonar, at ×8), leafhoppers and planthoppers sing through a plant stem, and the
bladder cicada sings through its swollen abdomen. Next: the bench, chorus, the C++ port and the
JUCE plugin.

## Try it

Needs Node 18 or newer. No packages to install.

```sh
node tests/engine-test.js        # engine tests
node tools/render-presets.js     # test presets → renders/*.wav
node tools/perf.js               # CPU per scenario
```

## Performance

`node tools/perf.js` prints how much of one CPU core each scenario needs at 48 kHz, each in a fresh
Node process. On a 2.8 GHz Xeon core, in JavaScript: about 2.4% for one voice (most of it the fixed
decimation filter), about 0.5% for each further voice, 6% for eight voices at the defaults and 22%
for eight voices at the worst case (24 ribs 0.05 ms apart at 600 strokes per second, about 26,000
clicks per second per voice). Poly has 8 voices. The C++ port will be lighter; the ratios carry
over.

## Files

- `design.md`: what tymbal is and how it works, with every parameter
- `plan.md`: build batches, in order
- `research.md`: the papers behind the design and the numbers taken from them
- `tests.md`: test results per batch, with pictures in `docs/tests/`

## Layout

- `reference/tymbal-engine.js`: the reference engine; defines the sound
- `reference/presets.js`: test presets (bench and tests only)
- `tests/engine-test.js`: engine tests
- `tools/render-presets.js`, `tools/perf.js`: preset renders, benchmark

Later (see `plan.md`):

- `source/TymbalDSP.h`: C++ port, real-time safe, no JUCE dependency
- `source/PluginProcessor.*`, `source/PluginEditor.*`, `ui/index.html`: JUCE instrument and its
  web-view interface
- `tools/bench/` (`tymbal.html`), the C++ comparison and plugin tests,
  `packaging/`, CI

## License note

The plugin will be built with [JUCE](https://juce.com) 8, which is available under the AGPLv3
or a commercial licence. Keeping this repository public and open source satisfies the AGPL.
