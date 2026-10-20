# tymbal · design

A playable insect voice for every animal that sings with tymbals: cicadas, tymbal moths and the
leafhoppers, planthoppers and treehoppers. MIDI in, stereo audio out. Each voice is a pair of
ribbed tymbals that store muscle energy and release it as a train of resonant clicks, plus the
body that turns those clicks into a sound: a cicada's abdomen, a bladder cicada's swollen
balloon, open air, or the plant stem a leafhopper drums on.

Labels: **[Decided]** you chose it, **[Proposed]** suggested and not yet confirmed, **[Open]**
still to decide. Sources for every number are in `research.md`.

---

## 1. What it is

- An **AU/VST3 instrument for macOS** plus a standalone app, like Throat, Dolphin and Syrinx.
  [Decided]
- **Source and body in one plugin.** Unlike Throat → mouth-tube and Syrinx → beak-tube there is no
  separate body effect: the tymbal and its body are modelled together. [Decided]
- **All tymbal families**: cicadas, tymbal moths and hoppers, brought into hearing range. The
  families share one engine; what differs is the body type, the number of ribs and the scaling.
  Stridulation (crickets, katydids, grasshoppers) is out. [Decided]
- **Name: tymbal**, lowercase like mouth-tube and krill. [Decided]
- **Two play modes**: the note sets the carrier (Carrier mode), or the note sets the pulse rate
  (Rate mode). [Decided]
- **Engine: a hybrid event model.** Ribs are scheduled events that ring resonators; the body's
  phase can pull each rib's exact moment, which is how real cicadas sing pure tones. No continuum
  mechanics. [Proposed] A physical snap-through mode stays an option for after the listening
  round. [Open]
- Built the bytebent way: JavaScript reference engine and browser bench first, then the C++
  port, then the JUCE plugin. [Decided]
- Plugin code and accent colour: [Open]. Proposed: `Tymb`, orange (no other Creature uses it).

## 2. Signal flow

```
MIDI ─► notes, play mode ─► song (echemes, phrases) ─► muscle clocks L, R
                                                          │
                                   ┌──────────────────────┴──────────────────────┐
                                   ▼                                             ▼
                          left tymbal: ribs ─► resonator                right tymbal: ribs ─► resonator
                                   │   ▲                                         │   ▲
                                   └───┼──────────────► body ◄───────────────────┘   │
                                       └──── lock: body phase sets each rib's moment ┘
                                                          │
                                       body type: Helmholtz · Bladder · Open · Plant
                                                          │
                                         direct tymbal leak ─► Time / guard ─► out
```

The tymbals drive the body one way (a linear chain, so it stays stable and cheap). The body acts
back only through timing: its phase decides when a rib buckles. That one path is enough for
coherent trains and pure tones, as in the papers.

## 3. The tymbal

### What it does

A tymbal is a domed membrane with a row of long ribs and a tymbal plate pulled by a large muscle.
As the muscle pulls, energy is stored in resilin; the ribs then buckle inwards one at a time, from
the plate forwards, each into a V. Every buckle is a click: a small fast inward step followed by
a larger rebound and a near-exponential decay, "as a hammer blow might excite a bell"
(Bennet-Clark 1997). When the muscle relaxes, a resilin pad pops the tymbal back out, ribs in
reverse order, with one quieter, higher click.

### In the engine

Each tymbal is a **state machine** (OUT → loading → rib 1 IN → … → rib n IN → held → OUT) driving
**one two-pole resonator that retunes with the state**. [Proposed]

- **Ribs.** Each recruited rib is an event. At its moment the resonator is set to that rib's
  frequency and Q and struck with an asymmetric excitation: a short inward half-wave (about 20 µs
  in *Cyclochila*) then the rebound. The first two or three cycles are nonlinear: the frequency
  starts low and rises 150–350 Hz (about 4–8%) as the click decays. In the engine each click first
  runs in its own short transient, 7.5% low and recovering with a time constant of 1.5 cycles,
  then merges into the tymbal's resonator after four time constants. Applied to the whole
  resonator instead, a coherent train that keeps building would sit a semitone flat.
  [Decided, batch 03]
- **Rib table.** Frequency, Q and level per rib come from a few controls fitted to the measured
  sequences:

  | Species | Rib 1 | Rib 2 | Rib 3 | Rib 4 | OUT |
  |---|---|---|---|---|---|
  | *Cyclochila* (unloaded tymbal) | 4.37 kHz, level 1 | 4.19 kHz, 1.01 | 3.92 kHz, 0.83 | 3.17 kHz, 0.39 | 6.54 kHz, 0.34 |
  | *Cystosoma* (muscle-driven) | 1.03–1.11 kHz, 4–6 dB below ribs 2–3 | 830–870 Hz | 830–870 Hz | 630–750 Hz, weak | 1.6–1.9 kHz |

  - `first`: rib 1's pitch against the carrier (*Cyclochila* about +0.3 st, *Cystosoma* about +4 st).
  - `tilt`: how far the later ribs fall, accelerating towards the last (*Cyclochila* −5 st across
    ribs 2–4).
  - `firstlevel` and `taper`: rib 1's level, and the fade across the rest.
  - **Q follows 1/f**: lower ribs ring longer (Bennet-Clark 1997, Fig. 6B). `tymbalq` sets the Q
    at the carrier. The loaded tymbal in the intact insect has about half the unloaded Q:
    Q = 9.3 measured, against 13–20 unloaded.
- **Recruitment.** `ribs` is how many the tymbal has (*Cyclochila* 4, *Cystosoma* 7, *Magicicada*
  11–12, moths up to about 24 striations); `recruit` is how many buckle per stroke. In calling
  song *Cyclochila* buckles two or three, all four only in protest song. Effort (velocity × the
  envelope) recruits fewer ribs when low. [Proposed]
- **Spacing.** Rib moments come from `spacing` (the gap between ribs) and `lead` (an extra gap
  after rib 1). Measured: *Cyclochila* in song 2–3 carrier cycles, 0.5–0.7 ms; *M. cassini*
  0.8–1.5 ms (sub-pulses at 650–1200 Hz); *Cystosoma* 4–6 ms from rib 1 to rib 2, then rib 3
  straight after; *Neotibicen* (distress call) about 1.2–1.7 ms.
- **The OUT click.** One click at `outratio` × the carrier (*Cyclochila* 1.5×, *Cystosoma* about
  2×), lower Q (about 6 against 10), `outlevel` −10 dB at the tymbal (Table 2: 0.34). In the
  radiated song it ends up more than 20–30 dB down because the body rejects its frequency, so
  that gap is not a control: it comes out of the body. With `outclicks` above 0, some of the ribs
  also click on the way out, in reverse order and faster (`outspeed`): three small clicks in
  0.23 ms after a 2.9 ms buckling wave in *Neotibicen*; a full passive half-cycle in moths.
- **Rest tuning.** At rest a *Cyclochila* tymbal resonates near 5.5–6 kHz and is 12–24 dB
  "deaf" at the song frequency, so the resting tymbal does not drain the body while the other one
  plays. The retuning resonator gives this for free.
- **Tune.** `tune` offsets the tymbal from the body. At 0 they match and the song is loud and
  pure. Detuned, the body still rings at its own pitch but clicks no longer feed it well: the
  amplitude dips and the waveform turns ragged, as when *Cystosoma*'s higher rib 1 strikes the
  already-ringing abdomen.

## 4. The lock

The central idea, from three of the papers:

- In *Cyclochila*, when ribs follow quickly, "the next pulse tended to start on the inward-going
  half-cycle of its predecessor and to produce a coherent waveform" (Bennet-Clark 1997).
- *M. septendecim* sings an unbroken pure tone at 1.3 kHz, Q 25, with no pulses, using a tymbal
  almost identical to *M. cassini*'s pulsed one. The difference is stiffness: a slack tymbal lets
  the resonator's phase decide the exact moment of each buckle, on a scale of microseconds,
  while the nerve decides the timing in milliseconds (Young & Josephson 1983).
- The coupled trailing tymbal of *Cystosoma* buckles in phase with the resonance the leading one
  set up (Bennet-Clark & Young 1998).

**In the engine** [Decided, batch 03]: each rib (rib 1 included) has a nominal moment from the
muscle and spacing. Half a period before it, the engine reads the reference resonator's amplitude
and phase (exactly, from its complex state) and predicts the nearest moment when a click would
add in phase. The rib is pulled towards that moment by at most the **lock window**.

- **Window:** ±½ carrier period × (1 − Stiffness). A rib whose in-phase moment lies outside the
  window is still pulled as far as the window allows.
- **Gate:** the reference must still be at least ¼ of its peak since the last click. In
  Bennet-Clark's preparations a rib that came while the last pulse was above about ⅓ of its peak
  locked; below about ¼ locking broke down; at 1/10 it was gone. (The abstract says 1/10; the
  results put the break at ¼.) Measured against a longer-held peak, *Cyclochila*'s second and third
  ribs failed the gate while the body was still building up.
- **Aim:** a click's slow start leaves it about 0.7 rad behind a linear click once its transient is
  over, so the lock aims half that early, the click's average phase over its transient.
- **Reference:** the body's main mode; with an Open body, the tymbal's own ringing.
- **Pitch keeper:** locked tones would still drift (−11 cents for *M. septendecim* without it,
  +6 aiming the full lag early): the tymbal's ringing, its rib tilt and its transients pull the body
  off its note. While at least half the recent ribs lock, the keeper compares the body's phase
  advance over each block with the note's and retunes body and tymbals together (5% of the error
  per block, at most ±0.1 octave). Pulsed songs, which lock less, are left alone: their pitch is
  set by the body and ribs, not by one frequency. In Carrier mode, locked tones stay within 1 cent.
- Locked ribs show in the live view.

What it gives, checked against the measured Qs (the time for a click to fall to ¼ is
Q × ln 4 / π cycles):

| Species | Ring to ¼ | Gap to next rib or stroke | Result |
|---|---|---|---|
| *Cyclochila*, Q 9.3 at 4.3 kHz | about 0.95 ms | 0.5–0.7 ms | ribs lock: a long coherent pulse |
| *M. cassini*, Q 5 at 6 kHz | about 0.37 ms | 0.8–1.5 ms | never locks: 9 separate sub-pulses |
| *Cystosoma*, Q 14–17 at 850 Hz | about 7.8 ms | 4–6 ms | ribs and tymbals lock: one bimodal pulse |
| *M. septendecim*, Q 25 at 1.3 kHz | about 8.5 ms | 7.4 ms between strokes | strokes lock too: an unbroken tone |

When clicks land out of phase, the sound gets double-humped envelopes and sidebands at the carrier
± 1/(click interval) (Bennet-Clark & Young 1992, Figs 15–16). That is the ragged side of the
sound, reached with high Stiffness, Scatter or a detuned `tune`.

- **Stiffness** (0 slack … 1 stiff) sets the window, and, as the tensor muscle does in
  *Cystosoma*, a stiffer tymbal clicks louder (9 dB across the range, 0 dB at 0.6) and shortens
  Lead (× 1.6 − Stiffness) (Simmons & Young 1978, read through the brief). Default 0.6. [Decided,
  batch 03]
- **Scatter** randomises each rib's nominal moment by up to one carrier period, seeded. De Jong's
  synthesis turned *Hyalessa*'s harmonic song noisy by randomising buckle timing.

## 5. The body

The body is a resonator chain driven by the tymbals. Its main mode is the carrier: in Carrier
mode the note sets it, in Rate mode the `carrier` knob. **Every geometry control acts relative to
that carrier**, so the note stays in tune while the controls change Q, level, colour and small
pitch movements. [Proposed]

**Body types** (`body`) [Proposed]:

| Type | Animal | What it is |
|---|---|---|
| Helmholtz | Most cicadas (*Cyclochila*, *Magicicada*, *Macrotristria*) | Air sac as the cavity, the two thin eardrums as the neck. Sound radiates from the eardrums. |
| Bladder | Bladder cicadas (*Cystosoma*, *Chlorocysta*) | One air sac shared by three thin panels (both sides of tergites 3–5 and the sternites) that move in phase. |
| Open | *Tympanistalna*, moths | No tuned cavity: the tymbal radiates directly, broadband. |
| Plant | Leafhoppers, planthoppers, treehoppers, *Tettigarcta* | The signal travels through a stem. |

**Helmholtz.** The resonant frequency is f₀ = (c/2π)·√(A / (L·V)), with A the two eardrums'
area, L = 16r/3π and V the air-sac volume. For *Cyclochila* (V 1.93 ml, A 86 mm²) that gives
4.56 kHz against a 4.3 kHz song; the formula also predicts *Macrotristria* and *M. cassini*.
Measured body Q is 5.5–7.6. Presets use the formula to place the carrier in Rate mode.

- `bodyq`: the body's Q. Default 6.
- `aperture` (the opercula, the lids over the eardrums): opening them raises the frequency and
  the level. Model cicada: from a 0.5–1 mm gap to fully open the frequency went 3.54 → 4.33 kHz,
  the level +10 dB, the Q 5.2 → 7.8. A dead cicada body: 3.7 → 4.7 kHz. Real cicadas move their
  abdomen and opercula while singing (*Tibicen*), so Aperture is the natural thing to put on an
  LFO or aftertouch. [Proposed]
- `membrane` (eardrum thickness): thick eardrums add mass to the neck, which lowers the frequency
  and raises Q. Covering a 4.3 kHz model's holes with glove rubber or paper took it down to
  1–2.4 kHz; *M. septendecim*'s thick eardrums explain its 1.3 kHz song against a 4.4 kHz
  prediction, and its Q of 25. In Carrier mode the note keeps the pitch, so Membrane mainly raises
  Q and lowers the level. [Proposed]
- `cavity` (shape): longer cavities wake higher cavity modes. In short, round models they were
  about 15 dB down; in long ones they matched or beat the main one, an impure tone. Modes at about
  1.75× and 2.1× the carrier (7.5 and 9 kHz above 4.3 kHz in the model), plus a low-pass above
  about 2 × the carrier. [Proposed]

**Bladder.** The air sac is the spring, the thin panels are the mass (Fletcher & Hill 1978,
confirmed by Bennet-Clark & Young 1998).

- **Extension** (`extend`): stretching the abdomen from rest (32–34 mm) to singing length
  (39–42 mm) doubles the amplitude and raises Q from 4 to 9. The frequency rises slightly too
  (815 Hz at 34 mm, 900 Hz at 41 mm), the opposite of what the larger volume alone would do.
- **Split** (`split`): the panels are loosely coupled through the shared sac. Loading one side
  let each region ring at its own frequency, so Split detunes the three panels for beating and
  double peaks. [Proposed]
- The left and right panels radiate in phase; the engine places them left and right in stereo,
  with the ventral panel (10 dB quieter, about three times the area) in the centre. [Proposed]

**Open.** The tymbal resonator goes straight out. In *T. gastrica* the tymbal, eardrums and body
wall all radiate, and the cavity does not act as a Helmholtz resonator. Moths have no body
resonator at all.

**Plant.** Hopper signals travel as bending waves in stems, which are dispersive: higher
frequencies travel faster. The engine runs the tymbal through an all-pass chain (smearing that
grows with `distance`) and one to three stem modes around `stem` (default 250 Hz), with a
contact-microphone colour. In *S. titanus* signals rose from about 200 to 250 Hz across leaf
gaps. [Proposed; numbers from the brief]

**Direct leak** (`direct`): how much tymbal sound radiates without the body. In *Cyclochila*'s
song the 6 kHz components are at least 30 dB below the 4 kHz peak, so the default is small.
Open uses the tymbal only.

**Measured system Q.** In *Cyclochila* the tymbal (Q 9.3) driving the air sac (Q 3.4) radiates
with Q 12.5, about the sum; song pulses measure Q 6–15 depending on whether the clicks were
coherent. A passive chain of two resonators cannot ring longer than its longer-ringing part, so
the engine gets Q 9.9 from the same two (sharper than either, as measured, but not 12.5). Longer
song pulses come from coherent clicks, which the lock provides.

**How the Helmholtz body is built** (batch 03): a complex one-pole at the carrier, driven by both
tymbals, plus two cavity modes at 1.75× and 2.1× (−25 dB at Cavity 0, 0 dB at 1) and a one-pole
low-pass at 2 × the carrier. Each mode has unity gain at its peak. Closing Aperture fully: pitch
× 0.818, Q × 0.667, level −9.4 dB (the model's 0.5–1 mm gap against open; Bennet-Clark & Young
1992, Table 2), with the level following (1 − Aperture)^1.5. Membrane: Q × (1 + 3·Membrane),
level −6 dB at 1. In song the radiated pitch stays with the tymbal when the opercula close: the
air sac goes out of tune with it and the song gets about 10 dB quieter rather than lower. Until
their batches, Bladder sounds as Helmholtz and Plant as Open.

## 6. Muscles

One muscle clock per voice drives both tymbals: each cycle it strokes the left tymbal, then the
right one `lrphase` into the same cycle, so Jitter and Rubato move both together and the phase
between them holds. A stroke that would start before the tymbal has finished its last one (its
OUT click) waits for it. [Decided, batch 04]

- `rate`: muscle cycles per second per tymbal, 1–600 Hz. *Cyclochila* about 117 (234 pulses/s
  with two tymbals alternating), *M. cassini* 90 (180 pulses/s), *M. septendecim* 68 (136),
  *Okanagana* 550 pulses/s, *Platypleura capitata* 389.
- `lrphase`: where the second tymbal fires in the first one's cycle. 0.5 alternates
  (*Cyclochila*, *Magicicada*: the OUT click of one lands on the IN click of the other). 0.25 is
  *Cystosoma*: the second tymbal starts 5–7 ms after the first, a quarter of the cycle, giving the
  bimodal 20–25 ms pulse. 0 fires both together (*Platypleura* protest song).
- `pair`: Both, Left or Right. *T. gastrica* always starts with the right tymbal; the sides
  differ in spectrum: `asym` raises the right tymbal by up to half a semitone and lowers it by up
  to 6 dB.
- `hold`: when in the cycle the muscle relaxes and the OUT click fires, as a share of the cycle.
  Default 0.5, so OUT lands with the other side's IN.
- `drive`: **Sync** (one nerve impulse, one stroke; Jitter on every stroke) or **Async** (one
  command sets off a burst of `burst` in-out cycles at the tymbal's own rate, as *Platypleura*'s
  fibrillar-type muscle is thought to). *Platypleura*'s asynchrony is inferred, not shown, and a
  2017 study of a relative found flight-muscle structure. In the engine a command comes every
  `burst` cycles; inside a burst the cycles are exactly even (Jitter moves whole bursts) and the
  force runs down by 60% across the burst (1, 0.85, 0.7, 0.55 at Burst 4), a muscle oscillation
  dying away until the next nerve impulse restarts it. Successive commands keep it going.
  [Decided, batch 04; the run-down is an estimate]
- **Heat** (`heat`, 20–40 °C, default 30): muscles speed up with temperature, the carrier does
  not. *M. cassini*'s sub-pulse rate goes from about 650 Hz at 20 °C to 1200 Hz at 35 °C while
  its 6 kHz carrier stays put; twitch rise time falls from 7.6 to 5.2 ms. Heat scales `rate`,
  `spacing` and `lead` by 1.846^((T − 30)/15) (Hold is a share of the cycle, so it follows). In
  Rate mode Heat leaves the rate alone, since the note sets it. [Decided, batch 04]

## 7. Play modes

**Carrier** (default) [Decided]: the note sets the body's carrier. The tymbal follows through
`tune`. A fixed +4 octaves puts middle C at C8, 4186 Hz (*Cyclochila*'s rib 2); `transpose`
moves it. The muscle runs at `rate`.

**Rate** [Decided]: the note sets the heard pulse rate, which becomes the pitch, as in
leafhopper "pure-tone" vibrational signals whose frequency rises with temperature, a sign it
follows muscle rate rather than a resonance (Tishechkin 2013, via the brief). The body stays at
`carrier` (default 4.3 kHz), so the carrier becomes a formant-like colour over a buzz. With the
tymbals alternating (`lrphase` 0.5) each tymbal runs at half the note; at other phases the
two-tymbal pattern repeats at half the note too, which adds a sub-octave colour (and at 0, with
both firing together, the pitch drops an octave). With one tymbal (Pair) it runs at the note.
Middle C is 262 pulses/s, close to *Cyclochila*'s 234. Pitch bend, glide and Fall move the rate.
[Decided, batch 04]

Measured (batch 04): the stroke clock is exact (within 0.05 cent of the note across C3–G4). Ribs
that lock snap to the carrier's phase grid, which moves each pulse by up to half a carrier period;
when many ribs lock (slack tymbal, short spacing) this roughens the pulse timing and can shift the
heard pitch by some cents. A stiffer tymbal (0.8 in the melody preset) keeps pulses even.
[Open: listening round]

A Trigger mode (each note one stroke or phrase, for drums) can be added after the listening
round. [Open]

Common: Mono or Poly (8 voices) [Proposed, after the cost batch], glide, bend range, detune.
Velocity sets effort (level and recruitment); aftertouch opens Aperture from its setting towards
fully open (+10 dB from shut). [Decided, batch 04]

## 8. Song

A held key sings. `song` [Decided, batch 04]:

| Song | What a key does | Example |
|---|---|---|
| Continuous | Strokes at `rate` for as long as the key is held | *Cyclochila*, *M. septendecim* within a phrase |
| Echeme | Groups of strokes: `echeme` on, `gap` off | *Cicada orni*: echemes 84–116 ms, gaps 84–93 ms |
| Phrase | `phrase` seconds of song, `rest` silence; the rate can start low and the end can fall | *M. cassini*: 15–30 Hz then 170–200 Hz; *M. septendecim*: 2–3 s phrases with a drop in level and pitch at the end, about 1 s apart, about three times |

- A stroke sounds in an echeme or phrase only if its whole cycle fits before the sound part ends,
  except the first, which always sounds.
- `start` and `intro`: the starting rate as a share of `rate`, and how much of the phrase it
  lasts. Through the intro the rate is Start^(1 − u⁴): it stays near Start, then rises steeply at
  the intro's end, as *M. cassini*'s ticks break into the buzz. [Proposed]
- `fall`: over the last 30% of a phrase, level drops up to 12 dB and pitch up to 4 semitones
  (Fall 1), the carrier in Carrier mode, the rate in Rate mode. [Proposed: by ear]
- `jitter`: each stroke's cycle (and each echeme's length) varies by 0.3 × Jitter (one standard
  deviation, clipped at two). The average rate holds.
- `rubato`: a slow tempo drift (up to 20% at 1, one standard deviation) on rate, echemes and
  phrases, with a new target for each echeme or phrase (every 0.3 s in Continuous) and a 0.2 s
  glide. Default 0, since in Rate mode it bends the pitch. [Decided, batch 04]
- `sync`: echeme period (echeme + gap) snaps to the nearest of 16 bars … 1/32 beat, a phrase
  period (phrase + rest) to 1–64 beats in powers of two, keeping the sound share. Jitter and
  Rubato no longer move echemes and phrases. No host position yet: the grid starts at the note.
- Ticks (isolated strokes) are Echeme with one stroke per echeme.

## 9. Families and hearing range

| Family | Tymbal | Body | Time | Range |
|---|---|---|---|---|
| Cicadas | 2–12 ribs, coherent or pulsed | Helmholtz, Bladder or Open | Natural | Carriers 0.85–15 kHz: audible as they are |
| Tymbal moths | Many striations buckling as a wave: an active half-cycle of 1–21.5 clicks, a pause, a passive half-cycle | Open | Slowed | Natural carriers 28–130 kHz |
| Hoppers | Few ribs, or a two-recoil snapping organ | Plant | Natural | 50–5000 Hz: audible, but carried by plants, not air |

**Moths** use the same tymbal with many ribs, short spacing and full `outclicks`. Their
frequency sweep within a half-cycle (*Bertholdia*: 3.9 kHz per ms) is the rib tilt.

**Scaling.** Ultrasonic moths come into range like a time-expansion bat detector: slowing time
and lowering pitch by the same factor keeps the cycles per click, the clicks per half-cycle and
the sweep shape, so a moth sounds like a bigger moth, not a dull tick. Clicks are defined by Q
(cycles), so they keep their cycle count at any pitch already; only the timing needs scaling.
[Proposed]

- `time` (×0.1–×32) stretches all muscle, rib and song times. Moth presets use ×8: *Bertholdia*
  then has a 6.1 kHz carrier, about 560 clicks per second and 236 ms modulation cycles.
- `link` (0–1): how much time follows the note, around the preset's reference pitch. At 1, lower
  notes slow down like tape; at 0 timing stays put. Default 0. [Open: listening test]
- **Guard:** carriers above 16 kHz drop by octaves (as in Dolphin), and nothing goes below 20 Hz.

Hopper presets need no time scaling; their low carriers sit where the note puts them.

## 10. Chorus

Cicadas sing in choruses that synchronise or alternate: *M. cassini* choruses pulse every about
5 s, faster and more synchronised in bright light; *Tibicina haematodes* males compete to call
first and last. [Proposed, later batch]

- Voices in Poly, and krill creatures, can be coupled: a voice's phrase onset nudges the others'
  phrase phase (`coupling`), Sync pulls them together, Alternate pushes them apart. `chorus`:
  Free, Sync, Alternate.
- The engine reports phrase onsets so krill can couple creatures across the pond.

## 11. Parameters

All defaults are design values to tune by ear unless the text gives a source. Ranges may go past
nature. LFOs: [Open], decided after the listening round, as in Syrinx.

| Group | id | Range | Default | What it does |
|---|---|---|---|---|
| Play | `playmode` | Carrier, Rate | Carrier [Decided] | What the note sets |
| | `carrier` | 50 Hz–16 kHz, log | 4.3 kHz | Body pitch in Rate mode |
| | `transpose` | −48 to +48 st | 0 | Carrier mode adds +4 octaves on top |
| | `detune` | ±100 cents | 0 | |
| | `bendrange` | 2–48 st | 12 st | |
| | `glide` | 0–2 s | 20 ms | Mono only |
| | `mode` | Mono, Poly | Mono | Poly: 8 voices |
| Muscle | `rate` | 1–600 Hz, log | 117 Hz | Cycles per second per tymbal (Carrier mode) |
| | `drive` | Sync, Async | Sync | |
| | `burst` | 1–16 | 4 | Async: cycles per command |
| | `lrphase` | 0–0.5 | 0.5 | Second tymbal's place in the cycle |
| | `pair` | Both, Left, Right | Both | |
| | `asym` | 0–1 | 0.1 | Left and right differ in pitch and level |
| | `hold` | 0.05–0.95 | 0.5 | When the OUT click fires, share of the cycle |
| | `heat` | 20–40 °C | 30 °C | Muscle speed |
| Tymbal | `ribs` | 1–24 | 4 | Ribs on the tymbal |
| | `recruit` | 1–24 | 3 | Ribs that buckle per stroke |
| | `spacing` | 0.05–10 ms, log | 0.6 ms | Gap between ribs |
| | `lead` | 0–10 ms | 0 | Extra gap after rib 1 |
| | `first` | −12 to +12 st | 0 | Rib 1 against the carrier |
| | `tilt` | −36 to +12 st | −5 st | Pitch change across the later ribs |
| | `firstlevel` | −12 to +6 dB | 0 | Rib 1's level |
| | `taper` | −24 to +6 dB | −4 dB | Level change across the later ribs |
| | `tymbalq` | 2–40 | 9 | Q at the carrier (Q follows 1/f) |
| | `tune` | −12 to +12 st | 0 | Tymbal against the body |
| | `stiffness` | 0–1 | 0.6 | Lock window, click strength, Lead |
| | `scatter` | 0–1 | 0.03 | Random rib timing |
| | `outratio` | 1–3 | 1.5 | OUT click pitch, × carrier |
| | `outlevel` | −40 to 0 dB | −10 dB | OUT click level at the tymbal |
| | `outclicks` | 0–1 | 0 | Share of ribs that click on the way out |
| | `outspeed` | 0.05–1 | 0.3 | OUT rib spacing, × `spacing` |
| Body | `body` | Helmholtz, Bladder, Open, Plant | Helmholtz | |
| | `bodyq` | 1–40 | 6 | |
| | `aperture` | 0–1 | 1 | Opercula: closed lowers pitch, level and Q |
| | `membrane` | 0–1 | 0 | Eardrum thickness: higher Q, quieter |
| | `cavity` | 0–1 | 0.2 | Higher cavity modes |
| | `extend` | 0–1 | 1 | Bladder: abdomen extension |
| | `split` | 0–1 | 0 | Bladder: panels detune |
| | `distance` | 0–1 | 0.3 | Plant: dispersion |
| | `stem` | 20–2000 Hz, log | 250 Hz | Plant: stem mode |
| | `direct` | 0–1 | 0.03 | Tymbal leaking past the body |
| Song | `song` | Continuous, Echeme, Phrase | Continuous | |
| | `echeme` | 5 ms–5 s, log | 100 ms | Sound share of an echeme |
| | `gap` | 0–5 s | 90 ms | Silence between echemes |
| | `phrase` | 0.2–30 s | 3 s | |
| | `rest` | 0–10 s | 1 s | |
| | `start` | 0.05–1 | 1 | Starting rate, share of `rate` |
| | `intro` | 0–0.9 | 0 | Share of the phrase at the starting rate |
| | `fall` | 0–1 | 0 | Drop in level and pitch at the phrase end |
| | `jitter` | 0–1 | 0.03 | Per-stroke timing variation |
| | `rubato` | 0–1 | 0 | Slow timing drift |
| | `sync` | Off, On | Off | Song times from tempo |
| Scale | `time` | ×0.1–×32, log | ×1 | Stretches all timing |
| | `link` | 0–1 | 0 | Timing follows the note like tape |
| Chorus | `chorus` | Free, Sync, Alternate | Free | |
| | `coupling` | 0–1 | 0 | How strongly voices pull each other |
| Envelope | `attack` | 1 ms–5 s | 10 ms | Shapes effort: level and recruitment |
| | `decay` | 1 ms–5 s | 0.3 s | |
| | `sustain` | 0–1 | 0.9 | |
| | `release` | 1 ms–8 s | 50 ms | |
| Output | `spread` | 0–1 | 0.3 | Stereo width of tymbals, panels and voices |
| | `volume` | −48 to +6 dB | −6 dB | |

## 12. Test presets

For the bench and tests only, like Dolphin's; whether any ship is [Open]. One per archetype,
with the source of each number in `research.md`:

- Cicadas: *Cyclochila australasiae* (green grocer), *Magicicada cassini*, *M. septendecim*,
  *Cystosoma saundersii* (bladder), *Neotibicen canicularis* (dog-day, distress), *Cicada orni*,
  *Lyristes plebejus*, *Tympanistalna gastrica*, *Platypleura capitata* (Async).
- Moths: *Bertholdia trigona* (jams bat sonar), *Cycnia tenera*, *Achroia grisella* (wax moth).
- Hoppers: *Scaphoideus titanus* female and male, a planthopper snapping organ, *Tettigarcta*.
- Protest variants: all ribs recruited, erratic, less lock.

No higurashi (*Tanna japonensis*): its only numbers came from an AI-written encyclopedia.

## 13. Code architecture

Same rules as Throat, Dolphin and Syrinx:

- Everything runs at 4× the host rate in fixed 32-sample blocks and is decimated with a 128-tap
  windowed-sinc FIR. The block is the latency, reported to the host.
- `process()` never allocates. Parameters are read once per block; rib events are written at
  their exact sub-sample time, as Dolphin's clicks are.
- Each voice has its own seeded xorshift generator. Same seed and same notes give the same output
  at any host buffer size.
- The lock reads the reference resonator's state once per rib event and computes the next
  in-phase moment directly; there is no per-sample search.
- The C++ port is checked sample by sample against the reference, built with `-ffp-contract=off`.
- Idle voices, silent tymbals and unused body types do no work.
- Reuse from Dolphin: the note, glide and envelope handling, the event scheduler (Pattern and
  Coda become strokes and echemes), the sub-sample event writer, the FIR and the bench.
- **Estimated cost** (from the brief, to be measured in batch 05): a dozen to sixteen two-pole
  resonators per voice, well under 1% of a core per voice in C++, 1–3% in JavaScript.

Engine interface: `new TymbalEngine(sr, seed)`, `setParam`, `noteOn` / `noteOff`, `setBend`,
`setAftertouch`, `process(L, R, n)`, and `onsets()` for krill.

## 14. Live view

The black screen at the top shows, per tymbal, each rib as a tick on a time strip: lit when it
locked to the body, grey when it fired on its own nerve timing. Under it, the body's envelope.
Stiffness and Scatter show their effect directly. [Proposed]
