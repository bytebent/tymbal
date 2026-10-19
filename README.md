# tymbal

An insect voice synth by bytebent, for every animal that sings with tymbals: cicadas, tymbal moths
and leafhoppers. Each voice is a pair of ribbed tymbals that store muscle energy and release it
as a train of resonant clicks, one per rib, and the body those clicks drive: a cicada's tuned
abdomen, a bladder cicada's balloon, open air, or the plant stem a leafhopper drums on.

A stiff tymbal clicks on its own timing and sounds pulsed and buzzy. A slack one lets the body's
ringing decide the exact moment of each buckle, and the clicks merge into a pure tone, the way
the periodical cicada *Magicicada septendecim* sings. Most of the sound lives between those two.

Unlike Throat and mouth-tube or Syrinx and beak-tube, the source and the body are one plugin.

Status: **prototype, batch 02 of 11**. The reference engine has the tymbal: ribs that buckle one
by one and retune it, the OUT click, recruitment, Heat. It matches the measured rib frequencies,
levels and Qs of *Cyclochila* (Bennet-Clark 1997) to within 1% and 1 dB. No body yet: that and the
lock come next, then the muscles and song, the moths and hoppers, the bench, the C++ port and the
JUCE plugin.

## Try it

Needs Node 18 or newer. No packages to install.

```sh
node tests/engine-test.js        # engine tests
node tools/render-presets.js     # test presets → renders/*.wav
```

## Files

- `design.md`: what tymbal is and how it works, with every parameter
- `plan.md`: build batches, in order
- `research.md`: the papers behind the design and the numbers taken from them
- `tests.md`: test results per batch, with pictures in `docs/tests/`

## Layout

- `reference/tymbal-engine.js`: the reference engine; defines the sound
- `reference/presets.js`: test presets (bench and tests only)
- `tests/engine-test.js`: engine tests
- `tools/render-presets.js`: preset renders

Later (see `plan.md`):

- `source/TymbalDSP.h`: C++ port, real-time safe, no JUCE dependency
- `source/PluginProcessor.*`, `source/PluginEditor.*`, `ui/index.html`: JUCE instrument and its
  web-view interface
- `tools/bench/` (`tymbal.html`), `tools/perf.js`, the C++ comparison and plugin tests,
  `packaging/`, CI

## License note

The plugin will be built with [JUCE](https://juce.com) 8, which is available under the AGPLv3
or a commercial licence. Keeping this repository public and open source satisfies the AGPL.
