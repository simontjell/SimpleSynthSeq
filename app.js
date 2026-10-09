"use strict";

/* =========================================================================
   SimpleSynthSeq
   Compact step sequencer: starts with 6 tracks (kick, snare, closed
   hi-hat, piano, melody, bass), up to 64 steps each; more tracks can be
   added/removed from the toolbar/row header. Parameters are edited per
   row (track), including a per-track feedback delay (delaySteps/
   delayFeedback/delayMix — see getTrackDelay()) for dub-style echoes and
   a per-track algorithmic reverb (reverbDecay/reverbMix — see
   getTrackReverb()) for space/depth.
   Each step reserves an `override` slot for a per-step tone, chord
   override (see CHORD_TYPES), and a micro-timing "nudge" (see
   stepPitchRatio()/resolveChordIntervals()/scheduleStep()) so individual
   hits can be swung/humanized for groove; a global state.swing adds the
   same shuffle feel across the whole pattern (see scheduleStep()).
   A .mid file can be imported (see parseMidi()/midiToTracks(), example.mid
   in the repo root) — General MIDI program numbers / percussion notes are
   mapped onto PRESETS, the same instrument library any track's Preset
   dropdown offers.
   ========================================================================= */

const INITIAL_TRACK_COUNT = 6; // how many tracks a brand-new state starts with; more can be added/removed in the UI
// Per-track step storage size. Normally 64 (pattern length only limits
// playback/display within it), but a MIDI import can need much more room
// to fit the whole file — both this and PATTERN_LENGTHS then grow to fit
// (see midiToTracks()/registerPatternLength()) rather than truncating.
let STEP_COUNT = 64;
let PATTERN_LENGTHS = [16, 32, 64];
const DEFAULT_PATTERN_LENGTH = 64; // needs all 4 bars for the default pattern's chord changes
const MAX_SWING = 75; // percent
const DEFAULT_SWING = 12; // a light, reggae-appropriate shuffle out of the box

// Register a pattern length (e.g. from a MIDI import) as a valid, selectable
// value if it isn't already, keeping the length dropdown/validation in sync.
function registerPatternLength(steps) {
  if (!PATTERN_LENGTHS.includes(steps)) {
    PATTERN_LENGTHS.push(steps);
    PATTERN_LENGTHS.sort((a, b) => a - b);
  }
}
const STEPS_PER_BEAT = 4; // 16th notes; every 4th step = a beat, every 16th = a bar
// v2: track layout changed from 64 generic drum rows to the fixed
// kick/snare/hihat/piano set below — bump the key so any old save (which
// could otherwise get stuck mid-migration, as happened during dev hot
// reload) is cleanly ignored instead of loaded half-converted.
const STORAGE_KEY = "simplesynthseq-state-v2";

// ---------------------------------------------------------------------
// FM voice presets. Each is a full parameter set applied to a track.
// Engine = 2-op FM carrier/modulator + an optional filtered noise layer,
// with an amplitude envelope (A/D/S/R) and an optional pitch envelope
// (pitch drop, useful for kicks/toms).
// ---------------------------------------------------------------------
const PRESETS = {
  custom: {
    label: "Custom", color: "#7a8092",
    carrierWave: "sine", modWave: "sine", freq: 220, modRatio: 1, modIndex: 0,
    modIndexDecay: 0, modIndexSustainRatio: 0.3,
    pitchEnvAmount: 0, pitchEnvDecay: 0.05,
    attack: 0.001, decay: 0.2, sustain: 0, release: 0.1,
    noiseLevel: 0, noiseFilterType: "lowpass", noiseFilterFreq: 4000, noiseFilterQ: 1,
    volume: 0.7, pan: 0,
    delaySteps: 0, delayFeedback: 0.35, delayMix: 0,
    reverbDecay: 1.6, reverbMix: 0,
  },
  kick: {
    label: "Kick", color: "#f9a13a",
    carrierWave: "sine", modWave: "sine", freq: 55, modRatio: 1, modIndex: 40,
    modIndexDecay: 0, modIndexSustainRatio: 0.3,
    pitchEnvAmount: 130, pitchEnvDecay: 0.045,
    attack: 0.001, decay: 0.28, sustain: 0, release: 0.05,
    noiseLevel: 0, noiseFilterType: "lowpass", noiseFilterFreq: 200, noiseFilterQ: 1,
    volume: 0.95, pan: 0,
    delaySteps: 0, delayFeedback: 0.35, delayMix: 0,
    reverbDecay: 1.6, reverbMix: 0,
  },
  snare: {
    label: "Snare", color: "#6d8dfd",
    carrierWave: "triangle", modWave: "square", freq: 190, modRatio: 1.5, modIndex: 55,
    modIndexDecay: 0, modIndexSustainRatio: 0.3,
    pitchEnvAmount: 40, pitchEnvDecay: 0.02,
    attack: 0.001, decay: 0.13, sustain: 0, release: 0.05,
    noiseLevel: 0.55, noiseFilterType: "bandpass", noiseFilterFreq: 1800, noiseFilterQ: 0.8,
    volume: 0.85, pan: 0,
    delaySteps: 0, delayFeedback: 0.35, delayMix: 0,
    reverbDecay: 1.8, reverbMix: 0.08,
  },
  hihatClosed: {
    label: "Hi-hat closed", color: "#3fb8b0",
    carrierWave: "square", modWave: "square", freq: 400, modRatio: 3.1, modIndex: 93,
    modIndexDecay: 0, modIndexSustainRatio: 0.3,
    pitchEnvAmount: -283, pitchEnvDecay: 0.02,
    attack: 0.001, decay: 0.045, sustain: 0, release: 0.02,
    noiseLevel: 0.92, noiseFilterType: "highpass", noiseFilterFreq: 890, noiseFilterQ: 0.7,
    volume: 0.6, pan: 0,
    delaySteps: 0, delayFeedback: 0.35, delayMix: 0,
    reverbDecay: 1.6, reverbMix: 0,
  },
  piano: {
    label: "Piano", color: "#c77dff",
    // 2-op FM electric piano: a sine carrier/modulator pair where the
    // modulation index starts bright (the "hammer" transient) and decays
    // fast down to a mellow sustain ratio, which is what keeps a 2-op FM
    // tone from sounding like a flat, static "beep".
    carrierWave: "sine", modWave: "sine", freq: 261.63, modRatio: 1, modIndex: 260,
    modIndexDecay: 0.35, modIndexSustainRatio: 0.16,
    pitchEnvAmount: 0, pitchEnvDecay: 0.02,
    attack: 0.004, decay: 0.9, sustain: 0.1, release: 0.9,
    noiseLevel: 0, noiseFilterType: "highpass", noiseFilterFreq: 3500, noiseFilterQ: 1,
    volume: 0.8, pan: 0,
    // A touch of dub-style slapback on the skank — 2 steps (an 8th note at
    // this grid) with noticeable feedback, mixed in low — plus a lush hall
    // so the chords bloom instead of stopping dead ("der skal nok også
    // være reverb på akkorderne").
    delaySteps: 2, delayFeedback: 0.4, delayMix: 0.22,
    reverbDecay: 2.4, reverbMix: 0.3,
  },
  melody: {
    label: "Melody", color: "#4cc9f0",
    // A warmer, more sustained lead voice (vs. the piano's percussive
    // pluck): triangle carrier for softer harmonics, a slower mod-index
    // settle, and a much higher sustain so single notes "sing" through.
    carrierWave: "triangle", modWave: "sine", freq: 261.63, modRatio: 2, modIndex: 60,
    modIndexDecay: 0.15, modIndexSustainRatio: 0.4,
    pitchEnvAmount: 0, pitchEnvDecay: 0.02,
    attack: 0.012, decay: 0.15, sustain: 0.55, release: 0.35,
    noiseLevel: 0, noiseFilterType: "lowpass", noiseFilterFreq: 4000, noiseFilterQ: 1,
    volume: 0.7, pan: 0,
    delaySteps: 0, delayFeedback: 0.35, delayMix: 0,
    reverbDecay: 2, reverbMix: 0.2,
  },
  hihatOpen: {
    label: "Hi-hat open", color: "#57d6cd",
    carrierWave: "square", modWave: "square", freq: 400, modRatio: 3.1, modIndex: 20,
    modIndexDecay: 0, modIndexSustainRatio: 0.3,
    pitchEnvAmount: 0, pitchEnvDecay: 0.02,
    attack: 0.001, decay: 0.28, sustain: 0, release: 0.12,
    noiseLevel: 0.7, noiseFilterType: "highpass", noiseFilterFreq: 7000, noiseFilterQ: 0.7,
    volume: 0.6, pan: 0,
    delaySteps: 0, delayFeedback: 0.35, delayMix: 0,
    reverbDecay: 1.6, reverbMix: 0,
  },
  clap: {
    label: "Clap", color: "#e069c4",
    carrierWave: "triangle", modWave: "sine", freq: 250, modRatio: 2, modIndex: 30,
    modIndexDecay: 0, modIndexSustainRatio: 0.3,
    pitchEnvAmount: 0, pitchEnvDecay: 0.02,
    attack: 0.001, decay: 0.18, sustain: 0, release: 0.08,
    noiseLevel: 0.7, noiseFilterType: "bandpass", noiseFilterFreq: 1200, noiseFilterQ: 1.2,
    volume: 0.75, pan: 0,
    delaySteps: 0, delayFeedback: 0.35, delayMix: 0,
    reverbDecay: 1.8, reverbMix: 0.15,
  },
  tom: {
    label: "Tom", color: "#9b6df9",
    carrierWave: "sine", modWave: "sine", freq: 110, modRatio: 1, modIndex: 30,
    modIndexDecay: 0, modIndexSustainRatio: 0.3,
    pitchEnvAmount: 70, pitchEnvDecay: 0.08,
    attack: 0.001, decay: 0.32, sustain: 0, release: 0.1,
    noiseLevel: 0.05, noiseFilterType: "lowpass", noiseFilterFreq: 2000, noiseFilterQ: 1,
    volume: 0.8, pan: 0,
    delaySteps: 0, delayFeedback: 0.35, delayMix: 0,
    reverbDecay: 1.6, reverbMix: 0.1,
  },
  cowbell: {
    label: "Cowbell", color: "#e0c93f",
    carrierWave: "square", modWave: "square", freq: 540, modRatio: 1.48, modIndex: 8,
    modIndexDecay: 0, modIndexSustainRatio: 0.3,
    pitchEnvAmount: 0, pitchEnvDecay: 0.02,
    attack: 0.001, decay: 0.3, sustain: 0, release: 0.1,
    noiseLevel: 0, noiseFilterType: "bandpass", noiseFilterFreq: 800, noiseFilterQ: 1,
    volume: 0.6, pan: 0,
    delaySteps: 0, delayFeedback: 0.35, delayMix: 0,
    reverbDecay: 1.6, reverbMix: 0,
  },
  rimshot: {
    label: "Rimshot", color: "#4fd48a",
    carrierWave: "square", modWave: "square", freq: 400, modRatio: 2, modIndex: 50,
    modIndexDecay: 0, modIndexSustainRatio: 0.3,
    pitchEnvAmount: 0, pitchEnvDecay: 0.02,
    attack: 0.001, decay: 0.06, sustain: 0, release: 0.03,
    noiseLevel: 0.3, noiseFilterType: "bandpass", noiseFilterFreq: 2500, noiseFilterQ: 1.5,
    volume: 0.7, pan: 0,
    delaySteps: 0, delayFeedback: 0.35, delayMix: 0,
    reverbDecay: 1.6, reverbMix: 0,
  },
  bass: {
    label: "Bass", color: "#d62828",
    // Clean sine-ish 2-op FM sub with just a little growl and a tiny pitch
    // pluck on the attack (classic synth/fingered-bass character), kept dry
    // (no delay/reverb) so the low end stays tight instead of turning to mud.
    carrierWave: "sine", modWave: "sine", freq: 65.41, modRatio: 1, modIndex: 8,
    modIndexDecay: 0.08, modIndexSustainRatio: 0.3,
    pitchEnvAmount: 20, pitchEnvDecay: 0.03,
    attack: 0.005, decay: 0.25, sustain: 0.35, release: 0.15,
    noiseLevel: 0, noiseFilterType: "lowpass", noiseFilterFreq: 4000, noiseFilterQ: 1,
    volume: 0.9, pan: 0,
    delaySteps: 0, delayFeedback: 0.35, delayMix: 0,
    reverbDecay: 1.6, reverbMix: 0,
  },
  // The following round out a small General-MIDI-inspired instrument
  // family library (see GM_PROGRAM_FAMILY_PRESET/GM_DRUM_MAP below), so a
  // MIDI import always has a reasonable preset to fall back on — and they
  // work standalone too, just pick them from any track's Preset dropdown.
  bells: {
    label: "Bells", color: "#ffd23f",
    carrierWave: "sine", modWave: "sine", freq: 523.25, modRatio: 3.5, modIndex: 150,
    modIndexDecay: 0.3, modIndexSustainRatio: 0.1,
    pitchEnvAmount: 0, pitchEnvDecay: 0.02,
    attack: 0.002, decay: 1.2, sustain: 0.05, release: 0.8,
    noiseLevel: 0, noiseFilterType: "lowpass", noiseFilterFreq: 4000, noiseFilterQ: 1,
    volume: 0.6, pan: 0,
    delaySteps: 3, delayFeedback: 0.3, delayMix: 0.15,
    reverbDecay: 2, reverbMix: 0.2,
  },
  organ: {
    label: "Organ", color: "#8338ec",
    carrierWave: "square", modWave: "sine", freq: 261.63, modRatio: 2, modIndex: 15,
    modIndexDecay: 0, modIndexSustainRatio: 0.3,
    pitchEnvAmount: 0, pitchEnvDecay: 0.02,
    attack: 0.01, decay: 0.05, sustain: 0.9, release: 0.1,
    noiseLevel: 0, noiseFilterType: "lowpass", noiseFilterFreq: 4000, noiseFilterQ: 1,
    volume: 0.65, pan: 0,
    delaySteps: 0, delayFeedback: 0.35, delayMix: 0,
    reverbDecay: 1.8, reverbMix: 0.1,
  },
  guitar: {
    label: "Guitar", color: "#fb8500",
    carrierWave: "triangle", modWave: "square", freq: 220, modRatio: 1.5, modIndex: 25,
    modIndexDecay: 0.1, modIndexSustainRatio: 0.3,
    pitchEnvAmount: 0, pitchEnvDecay: 0.02,
    attack: 0.002, decay: 0.5, sustain: 0.15, release: 0.3,
    noiseLevel: 0.08, noiseFilterType: "highpass", noiseFilterFreq: 3000, noiseFilterQ: 1,
    volume: 0.7, pan: 0,
    delaySteps: 0, delayFeedback: 0.35, delayMix: 0,
    reverbDecay: 1.6, reverbMix: 0.05,
  },
  strings: {
    label: "Strings", color: "#3a86ff",
    carrierWave: "sawtooth", modWave: "sine", freq: 220, modRatio: 2, modIndex: 10,
    modIndexDecay: 0, modIndexSustainRatio: 0.3,
    pitchEnvAmount: 0, pitchEnvDecay: 0.02,
    attack: 0.25, decay: 0.3, sustain: 0.75, release: 0.6,
    noiseLevel: 0, noiseFilterType: "lowpass", noiseFilterFreq: 4000, noiseFilterQ: 1,
    volume: 0.6, pan: 0,
    delaySteps: 0, delayFeedback: 0.35, delayMix: 0,
    reverbDecay: 2.2, reverbMix: 0.22,
  },
  brass: {
    label: "Brass", color: "#ff5400",
    carrierWave: "sawtooth", modWave: "square", freq: 220, modRatio: 1, modIndex: 45,
    modIndexDecay: 0.08, modIndexSustainRatio: 0.5,
    pitchEnvAmount: 15, pitchEnvDecay: 0.04,
    attack: 0.02, decay: 0.15, sustain: 0.6, release: 0.15,
    noiseLevel: 0, noiseFilterType: "lowpass", noiseFilterFreq: 4000, noiseFilterQ: 1,
    volume: 0.7, pan: 0,
    delaySteps: 0, delayFeedback: 0.35, delayMix: 0,
    reverbDecay: 1.6, reverbMix: 0.1,
  },
  reed: {
    label: "Reed", color: "#06d6a0",
    carrierWave: "square", modWave: "sine", freq: 220, modRatio: 1, modIndex: 20,
    modIndexDecay: 0.05, modIndexSustainRatio: 0.6,
    pitchEnvAmount: 0, pitchEnvDecay: 0.02,
    attack: 0.04, decay: 0.1, sustain: 0.7, release: 0.2,
    noiseLevel: 0.03, noiseFilterType: "bandpass", noiseFilterFreq: 1500, noiseFilterQ: 2,
    volume: 0.6, pan: 0,
    delaySteps: 0, delayFeedback: 0.35, delayMix: 0,
    reverbDecay: 1.7, reverbMix: 0.12,
  },
  flute: {
    label: "Flute", color: "#90e0ef",
    carrierWave: "sine", modWave: "sine", freq: 523.25, modRatio: 2, modIndex: 3,
    modIndexDecay: 0, modIndexSustainRatio: 0.3,
    pitchEnvAmount: 0, pitchEnvDecay: 0.02,
    attack: 0.06, decay: 0.1, sustain: 0.8, release: 0.2,
    noiseLevel: 0.1, noiseFilterType: "bandpass", noiseFilterFreq: 3000, noiseFilterQ: 1.5,
    volume: 0.55, pan: 0,
    delaySteps: 0, delayFeedback: 0.35, delayMix: 0,
    reverbDecay: 1.8, reverbMix: 0.15,
  },
  pad: {
    label: "Pad", color: "#a663cc",
    carrierWave: "sawtooth", modWave: "triangle", freq: 220, modRatio: 1.5, modIndex: 6,
    modIndexDecay: 0, modIndexSustainRatio: 0.3,
    pitchEnvAmount: 0, pitchEnvDecay: 0.02,
    attack: 0.8, decay: 0.4, sustain: 0.7, release: 1.5,
    noiseLevel: 0, noiseFilterType: "lowpass", noiseFilterFreq: 4000, noiseFilterQ: 1,
    volume: 0.5, pan: 0,
    delaySteps: 0, delayFeedback: 0.35, delayMix: 0,
    reverbDecay: 2.5, reverbMix: 0.25,
  },
  crash: {
    label: "Crash", color: "#f4a261",
    carrierWave: "square", modWave: "square", freq: 400, modRatio: 2.8, modIndex: 15,
    modIndexDecay: 0, modIndexSustainRatio: 0.3,
    pitchEnvAmount: 0, pitchEnvDecay: 0.02,
    attack: 0.001, decay: 1.4, sustain: 0, release: 0.8,
    noiseLevel: 0.9, noiseFilterType: "highpass", noiseFilterFreq: 6000, noiseFilterQ: 0.6,
    volume: 0.6, pan: 0,
    delaySteps: 0, delayFeedback: 0.35, delayMix: 0,
    reverbDecay: 1.8, reverbMix: 0.1,
  },
  ride: {
    label: "Ride", color: "#e9c46a",
    carrierWave: "square", modWave: "square", freq: 500, modRatio: 3.4, modIndex: 12,
    modIndexDecay: 0, modIndexSustainRatio: 0.3,
    pitchEnvAmount: 0, pitchEnvDecay: 0.02,
    attack: 0.001, decay: 0.5, sustain: 0.05, release: 0.4,
    noiseLevel: 0.4, noiseFilterType: "highpass", noiseFilterFreq: 8000, noiseFilterQ: 0.8,
    volume: 0.5, pan: 0,
    delaySteps: 0, delayFeedback: 0.35, delayMix: 0,
    reverbDecay: 1.6, reverbMix: 0.08,
  },
};

// Row-to-preset assignment for a brand-new state's initial tracks; tracks
// added later via "Add track" default to "custom" (silent, index-named).
const DEFAULT_TRACK_PRESETS = ["kick", "snare", "hihatClosed", "piano", "melody", "bass"];

// A ready-to-play starter pattern baked into a fresh/empty state, so the
// app isn't silent out of the box: a reggae "one drop" — kick + snare
// together on beat 3 (not beat 1), steady closed hi-hat 8ths, and the
// piano comping the classic C - G - Am - F progression on the off-beat
// "skank", one chord per bar across all 4 bars (needs the 64-step pattern
// length — see DEFAULT_PATTERN_LENGTH below). Step indices are 0-based.
const BAR_STEPS = 16;
const BARS = 4;
function everyBar(offsetsWithinBar) {
  return Array.from({ length: BARS }, (_, bar) => offsetsWithinBar.map((o) => bar * BAR_STEPS + o)).flat();
}

const ONE_DROP_OFFSETS = [8]; // beat 3 of the bar
const HIHAT_OFFSETS = [0, 2, 4, 6, 8, 10, 12, 14]; // straight 8ths
const SKANK_OFFSETS = [2, 6, 10, 14]; // the "and" of each beat

const BASS_OFFSETS = [0, 6, 8]; // root on beat 1, a syncopated pickup, then locks with the kick+snare drop on beat 3

const DEFAULT_TRACK_STEPS = {
  0: everyBar(ONE_DROP_OFFSETS), // Kick
  1: everyBar(ONE_DROP_OFFSETS), // Snare — one-drop: lands with the kick, not on beat 1
  2: everyBar(HIHAT_OFFSETS), // Hi-hat lukket
  3: everyBar(SKANK_OFFSETS), // Piano — chord stabs, see CHORD_PROGRESSION below
  // 4 (Melody) is intentionally left empty/unprogrammed — dial in your own
  // tune via right-click → note/octave on each step you turn on.
  5: everyBar(BASS_OFFSETS), // Bass — rolling root-note line, see CHORD_PROGRESSION below
};
const DEFAULT_TRACK_VOLUMES = { 0: 0.9, 1: 0.5, 2: 0.15, 3: 0.65, 4: 0.5, 5: 0.8 };

// One chord per bar (semitone offset from the piano's own C4 root + a
// chord-mode shape), applied as a per-step override on the piano's skank
// hits. Bar 0 (C) needs no override — it already matches the track's own
// default chord (major triad, root pitch).
const CHORD_PROGRESSION = [
  { semitones: 0, chordType: "major", chordIntervals: [0, 4, 7] }, // C
  { semitones: 7, chordType: "major", chordIntervals: [0, 4, 7] }, // G
  { semitones: 9, chordType: "minor", chordIntervals: [0, 3, 7] }, // Am
  { semitones: 5, chordType: "major", chordIntervals: [0, 4, 7] }, // F
];
function buildPianoStepOverrides() {
  const overrides = {};
  CHORD_PROGRESSION.forEach((chord, bar) => {
    if (!chord.semitones) return;
    for (const offset of SKANK_OFFSETS) {
      overrides[bar * BAR_STEPS + offset] = { semitones: chord.semitones, chordType: chord.chordType, chordIntervals: chord.chordIntervals };
    }
  });
  return overrides;
}

// The bassline just pedals each bar's chord root (reusing CHORD_PROGRESSION
// rather than duplicating it) — a classic simple, effective reggae bass.
function buildBassStepOverrides() {
  const overrides = {};
  CHORD_PROGRESSION.forEach((chord, bar) => {
    if (!chord.semitones) return;
    for (const offset of BASS_OFFSETS) {
      overrides[bar * BAR_STEPS + offset] = { semitones: chord.semitones };
    }
  });
  return overrides;
}

const DEFAULT_STEP_OVERRIDES = { 3: buildPianoStepOverrides(), 5: buildBassStepOverrides() };
const DEFAULT_TRACK_CHORD = { 3: { chordMode: true, chordType: "major", chordIntervals: CHORD_PROGRESSION[0].chordIntervals } };

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------

function makeStep(on) {
  // `override` carries a per-step tone/chord/timing override (see
  // openToneEditor()). `velocity` (0-1) scales this hit's gain — the UI
  // doesn't expose it yet, but MIDI import (see midiToTracks()) sets it
  // from each note's MIDI velocity.
  return { on: !!on, velocity: 1, override: null };
}

// Pad `track.steps` with off steps if it's shorter than `length` — e.g. a
// track added via "Add track" after a MIDI import grew the pattern well
// past the usual 64-step storage. Without this, rendering a too-short
// track throws (track.steps[i] undefined) and silently aborts the whole
// re-render, which looked like "nothing happens" when adding a track.
function ensureTrackCapacity(track, length) {
  while (track.steps.length < length) track.steps.push(makeStep(false));
}

function makeTrack(index) {
  const presetKey = DEFAULT_TRACK_PRESETS[index] || "custom";
  const preset = PRESETS[presetKey];
  const onSteps = new Set(DEFAULT_TRACK_STEPS[index] || []);
  const stepOverrides = DEFAULT_STEP_OVERRIDES[index] || {};
  const chordDefaults = DEFAULT_TRACK_CHORD[index] || { chordMode: false, chordType: "major", chordIntervals: null };
  return {
    id: index,
    name: preset.label + (DEFAULT_TRACK_PRESETS[index] ? "" : ` ${index + 1}`),
    preset: presetKey,
    params: { ...preset },
    mute: false,
    solo: false,
    volume: index in DEFAULT_TRACK_VOLUMES ? DEFAULT_TRACK_VOLUMES[index] : preset.volume,
    steps: Array.from({ length: STEP_COUNT }, (_, i) => {
      const step = makeStep(onSteps.has(i));
      if (stepOverrides[i]) step.override = stepOverrides[i];
      return step;
    }),
    // Chord mode: when on, every lit step plays chordIntervals (semitone
    // offsets from the step's note) together instead of a single note.
    chordMode: chordDefaults.chordMode,
    chordType: chordDefaults.chordType,
    chordIntervals: chordDefaults.chordIntervals,
  };
}

function makeDefaultState() {
  return {
    bpm: 78,
    patternLength: DEFAULT_PATTERN_LENGTH,
    swing: DEFAULT_SWING,
    tracks: Array.from({ length: INITIAL_TRACK_COUNT }, (_, i) => makeTrack(i)),
  };
}

let state = loadState() || makeDefaultState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.tracks) || !parsed.tracks.length) return null;
    if (!Number.isInteger(parsed.patternLength) || parsed.patternLength < 1) {
      parsed.patternLength = DEFAULT_PATTERN_LENGTH;
    }
    if (typeof parsed.swing !== "number" || !Number.isFinite(parsed.swing)) parsed.swing = 0;
    parsed.swing = Math.min(MAX_SWING, Math.max(0, parsed.swing));
    // A track can carry more steps than the built-in STEP_COUNT (e.g. a
    // previously imported MIDI file) — bring STEP_COUNT/PATTERN_LENGTHS back
    // up to match whatever was actually saved, so a newly added track or the
    // length dropdown stay consistent with it after a reload.
    const maxStoredSteps = parsed.tracks.reduce((max, t) => Math.max(max, Array.isArray(t.steps) ? t.steps.length : 0), STEP_COUNT);
    if (maxStoredSteps > STEP_COUNT) STEP_COUNT = maxStoredSteps;
    if (parsed.patternLength > STEP_COUNT) STEP_COUNT = parsed.patternLength;
    registerPatternLength(parsed.patternLength);
    // Track count is user-adjustable (see "Add track" / "Remove track"), so
    // a saved track list is trusted at whatever length it has — no forced
    // reshaping here. STORAGE_KEY is bumped instead whenever the track/step
    // shape itself changes incompatibly.
    return parsed;
  } catch (e) {
    console.warn("Could not load saved state", e);
    return null;
  }
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Could not save state", e);
    }
  }, 400);
}

// ---------------------------------------------------------------------
// MIDI import
// ---------------------------------------------------------------------
// A small, dependency-free Standard MIDI File (SMF) reader + a converter
// that maps it onto this sequencer's model: quantized to the 16th-note
// grid, capped at STEP_COUNT steps (one loop — this is a step sequencer,
// not a linear song player, so only the first ~4 bars of a longer file
// are imported), with simultaneous notes on the same step folded into a
// chord-mode override (see openToneEditor()'s chord picker) and each
// MIDI channel/track's General MIDI program mapped to the closest preset
// in PRESETS (see GM_PROGRAM_FAMILY/gmProgramToPreset() and GM_DRUM_MAP
// for channel 10 percussion) — the same presets are picked from any
// track's normal Preset dropdown, MIDI import or not.

function parseMidi(buffer) {
  const view = new DataView(buffer);
  const len = view.byteLength;
  let pos = 0;

  function u8() { return view.getUint8(pos++); }
  function str(n) {
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(view.getUint8(pos + i));
    pos += n;
    return s;
  }
  function u16() { const v = view.getUint16(pos); pos += 2; return v; }
  function u32() { const v = view.getUint32(pos); pos += 4; return v; }
  function varLen() {
    let value = 0, b;
    do { b = u8(); value = (value << 7) | (b & 0x7f); } while (b & 0x80);
    return value;
  }

  if (str(4) !== "MThd") throw new Error("Not a valid MIDI file (missing MThd header).");
  const headerLen = u32();
  u16(); // format — not needed: each MTrk is handled independently regardless of 0/1/2
  const numTracks = u16();
  const division = u16();
  if (division & 0x8000) throw new Error("SMPTE time-based MIDI files are not supported.");
  const ticksPerQuarter = division;
  pos += headerLen - 6; // skip any nonstandard extra header bytes

  let tempo = 500000; // microseconds per quarter note (default 120 BPM if the file never sets one)
  const tracks = [];

  for (let t = 0; t < numTracks && pos < len; t++) {
    if (str(4) !== "MTrk") throw new Error(`Invalid track chunk (no. ${t + 1}) in the MIDI file.`);
    const trackLen = u32();
    const trackEnd = pos + trackLen;
    let tick = 0;
    let runningStatus = 0;
    let name = "";
    const events = [];

    while (pos < trackEnd) {
      tick += varLen();
      let status = view.getUint8(pos);
      if (status & 0x80) { pos++; runningStatus = status; } else { status = runningStatus; }

      if (status === 0xff) {
        const metaType = u8();
        const metaLen = varLen();
        if (metaType === 0x51 && metaLen === 3) {
          tempo = (u8() << 16) | (u8() << 8) | u8();
        } else if (metaType === 0x03) {
          name = str(metaLen);
        } else {
          pos += metaLen;
        }
        // Per spec, meta events cancel running status — a byte belonging to
        // the *next* event is never allowed to reuse this 0xff as if it
        // were a channel-voice status. Without this reset, any file with a
        // tempo/marker/etc. event in the middle of note data (extremely
        // common) desyncs the reader for everything after it: notes get
        // misread as bogus meta events, corrupting pitch/timing or causing
        // the track to bail out early (see "Unrecognized status" below).
        runningStatus = 0;
      } else if (status === 0xf0 || status === 0xf7) {
        pos += varLen();
        runningStatus = 0; // sysex cancels running status too
      } else if (status >= 0xf1 && status <= 0xf6) {
        // System Common (rare in an SMF, but well-defined) — skip its
        // fixed number of data bytes instead of treating it as unknown.
        pos += status === 0xf2 ? 2 : status === 0xf6 ? 0 : 1;
        runningStatus = 0;
      } else if (status >= 0xf8) {
        // System Real-Time: single byte, no data, doesn't touch running status.
      } else {
        const type = status & 0xf0;
        const channel = status & 0x0f;
        if (type === 0x90 || type === 0x80) {
          const note = u8(), velocity = u8();
          if (type === 0x90 && velocity > 0) events.push({ tick, type: "noteOn", channel, note, velocity });
          else events.push({ tick, type: "noteOff", channel, note });
        } else if (type === 0xc0) {
          events.push({ tick, type: "programChange", channel, program: u8() });
        } else if (type === 0xd0) {
          pos += 1; // channel aftertouch
        } else if (type === 0xa0 || type === 0xb0 || type === 0xe0) {
          pos += 2; // poly aftertouch / control change / pitch bend
        } else {
          // Genuinely unrecognized — every other byte value is accounted
          // for above, so this should be unreachable on a well-formed
          // file. Bail out of this track rather than risk mis-reading the
          // rest of it at a wrong offset.
          pos = trackEnd;
        }
      }
    }
    pos = trackEnd; // stay chunk-aligned even if a track read short/long
    tracks.push({ name, events });
  }

  return { ticksPerQuarter, tempo, tracks };
}

// General MIDI program number (0-127) -> closest PRESETS key, bucketed by
// the 16 official GM instrument families.
function gmProgramToPreset(program) {
  if (program <= 7) return "piano";
  if (program <= 15) return "bells"; // chromatic percussion
  if (program <= 23) return "organ";
  if (program <= 31) return "guitar";
  if (program <= 39) return "bass";
  if (program <= 55) return "strings"; // strings + ensemble
  if (program <= 63) return "brass";
  if (program <= 71) return "reed";
  if (program <= 79) return "flute"; // pipe
  if (program <= 87) return "melody"; // synth lead
  if (program <= 103) return "pad"; // synth pad + synth effects
  if (program <= 111) return "guitar"; // ethnic (closest plucked-string family)
  if (program <= 119) return "bells"; // percussive
  return "custom"; // sound effects — too varied to model meaningfully
}

// GM percussion key map (channel 10 note number) -> [preset key, name].
// Anything not listed falls back to "custom" with a generic name.
const GM_DRUM_MAP = {
  35: ["kick", "Bass drum"], 36: ["kick", "Kick"],
  37: ["rimshot", "Rimshot"], 58: ["rimshot", "Vibraslap"],
  38: ["snare", "Snare"], 40: ["snare", "Snare (electric)"],
  39: ["clap", "Clap"],
  41: ["tom", "Tom (low)"], 43: ["tom", "Tom (high-low)"], 45: ["tom", "Tom (low-mid)"],
  47: ["tom", "Tom (mid)"], 48: ["tom", "Tom (mid-high)"], 50: ["tom", "Tom (high)"],
  42: ["hihatClosed", "Hi-hat closed"], 44: ["hihatClosed", "Hi-hat (pedal)"], 54: ["hihatClosed", "Tambourine"],
  46: ["hihatOpen", "Hi-hat open"],
  49: ["crash", "Crash"], 52: ["crash", "Crash (chinese)"], 55: ["crash", "Splash"], 57: ["crash", "Crash 2"],
  51: ["ride", "Ride"], 53: ["ride", "Ride (bell)"], 59: ["ride", "Ride 2"],
  56: ["cowbell", "Cowbell"],
};

// Convert a parsed MIDI file into { bpm, tracks, truncated }, where `tracks`
// is a ready-to-use array of sequencer track objects.
const MAX_IMPORT_STEPS = 4096; // ~8-9 min at 120 BPM — a safety ceiling, not the normal case

function midiToTracks(midi) {
  const ticksPerStep = midi.ticksPerQuarter / STEPS_PER_BEAT;
  const bpm = Math.round(60000000 / (midi.tempo || 500000));

  // Import the *whole* file rather than looping just the first bars: size
  // the pattern to the file's actual last event instead of capping at the
  // usual 64-step storage. Only MAX_IMPORT_STEPS acts as a hard safety cap.
  let maxTick = 0;
  for (const track of midi.tracks) {
    for (const ev of track.events) if (ev.tick > maxTick) maxTick = ev.tick;
  }
  // +1 so a note landing (after rounding, same as quantize() below) exactly
  // on the last step index isn't excluded by a stepIndex < stepCount check.
  const neededSteps = Math.max(1, Math.round(maxTick / ticksPerStep) + 1);
  const stepCount = Math.min(MAX_IMPORT_STEPS, neededSteps);
  const truncated = neededSteps > MAX_IMPORT_STEPS;

  // Bucket note-on events by (MIDI track index, channel) — this correctly
  // splits both a format-1 file (one instrument per track) and a format-0
  // file (everything interleaved in one track, split apart by channel).
  const buckets = new Map();
  midi.tracks.forEach((track, trackIndex) => {
    const channelPrograms = new Map(); // per-channel, since one MTrk can hold several channels
    const localBuckets = new Map();
    for (const ev of track.events) {
      if (ev.type === "programChange") {
        channelPrograms.set(ev.channel, ev.program);
        continue;
      }
      if (ev.type !== "noteOn") continue;
      let bucket = localBuckets.get(ev.channel);
      if (!bucket) {
        bucket = { channel: ev.channel, name: track.name, notes: [] };
        localBuckets.set(ev.channel, bucket);
      }
      bucket.program = channelPrograms.get(ev.channel) || 0;
      bucket.notes.push({ tick: ev.tick, note: ev.note, velocity: ev.velocity });
    }
    for (const [channel, bucket] of localBuckets) buckets.set(`${trackIndex}:${channel}`, bucket);
  });

  function quantize(tick) {
    const stepIndex = Math.round(tick / ticksPerStep);
    return stepIndex < stepCount ? stepIndex : -1; // only drops notes if the safety cap above actually kicked in
  }

  function melodicBucketToTrack(bucket) {
    const presetKey = gmProgramToPreset(bucket.program);
    const preset = PRESETS[presetKey];
    const rootMidi = Math.round(freqToMidi(preset.freq));
    const byStep = new Map();
    for (const n of bucket.notes) {
      const stepIndex = quantize(n.tick);
      if (stepIndex < 0) continue;
      if (!byStep.has(stepIndex)) byStep.set(stepIndex, []);
      byStep.get(stepIndex).push(n);
    }
    if (!byStep.size) return null;
    const hasChords = [...byStep.values()].some((notes) => notes.length > 1);

    const track = makeTrack(0);
    track.preset = presetKey;
    track.params = { ...preset };
    track.name = bucket.name || preset.label;
    track.volume = preset.volume;
    track.chordMode = hasChords;
    track.chordType = "custom";
    track.chordIntervals = [0];
    track.steps = Array.from({ length: stepCount }, () => makeStep(false));

    for (const [stepIndex, notes] of byStep) {
      const pitches = notes.map((n) => n.note).sort((a, b) => a - b);
      const lowest = pitches[0];
      const semis = lowest - rootMidi;
      const step = track.steps[stepIndex];
      step.on = true;
      step.velocity = Math.min(1, Math.max(0.05, Math.max(...notes.map((n) => n.velocity)) / 127));
      if (hasChords) {
        step.override = { ...(semis ? { semitones: semis } : {}), chordType: "custom", chordIntervals: pitches.map((p) => p - lowest) };
      } else if (semis) {
        step.override = { semitones: semis };
      }
    }
    return track;
  }

  function drumBucketToTracks(bucket) {
    const byNote = new Map();
    for (const n of bucket.notes) {
      const stepIndex = quantize(n.tick);
      if (stepIndex < 0) continue;
      if (!byNote.has(n.note)) byNote.set(n.note, []);
      byNote.get(n.note).push({ ...n, stepIndex });
    }
    const result = [];
    for (const [gmNote, hits] of byNote) {
      const [presetKey, name] = GM_DRUM_MAP[gmNote] || ["custom", `Trommenode ${gmNote}`];
      const preset = PRESETS[presetKey];
      const track = makeTrack(0);
      track.preset = presetKey;
      track.params = { ...preset };
      track.name = name;
      track.volume = preset.volume;
      track.steps = Array.from({ length: stepCount }, () => makeStep(false));
      for (const hit of hits) {
        const step = track.steps[hit.stepIndex];
        step.on = true;
        step.velocity = Math.min(1, Math.max(0.05, hit.velocity / 127));
      }
      result.push(track);
    }
    return result;
  }

  const tracks = [];
  for (const bucket of buckets.values()) {
    if (!bucket.notes.length) continue;
    if (bucket.channel === 9) tracks.push(...drumBucketToTracks(bucket));
    else {
      const track = melodicBucketToTrack(bucket);
      if (track) tracks.push(track);
    }
  }
  return { bpm, tracks, truncated, stepCount };
}

// ---------------------------------------------------------------------
// Audio engine
// ---------------------------------------------------------------------

let audioCtx = null;
let masterGain = null;
let noiseBuffer = null;

function ensureAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.9;
  masterGain.connect(audioCtx.destination);
  noiseBuffer = createNoiseBuffer(audioCtx);
}

function createNoiseBuffer(ctx) {
  const seconds = 2;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// ---------------------------------------------------------------------
// Per-track delay (dub-style echo). One persistent delay+feedback loop per
// track — built lazily so the feedback tail keeps ringing correctly across
// separate hits, instead of a fresh (and feedback-less) delay per note.
// Delay time is expressed in steps (synced to BPM) rather than raw seconds
// so the echo stays in time with the groove as the tempo changes.
// ---------------------------------------------------------------------

const MAX_DELAY_SECONDS = 4; // covers delaySteps up to 8 even at the slowest allowed BPM (40)
const trackDelayNodes = new Map(); // track.id -> { delayNode, feedbackGain, wetGain }

function getTrackDelay(track) {
  let fx = trackDelayNodes.get(track.id);
  if (!fx) {
    const delayNode = audioCtx.createDelay(MAX_DELAY_SECONDS);
    const feedbackGain = audioCtx.createGain();
    const wetGain = audioCtx.createGain();
    delayNode.connect(feedbackGain).connect(delayNode); // feedback loop
    delayNode.connect(wetGain).connect(masterGain);
    fx = { delayNode, feedbackGain, wetGain };
    trackDelayNodes.set(track.id, fx);
  }
  return fx;
}

// ---------------------------------------------------------------------
// Per-track reverb. Not just "reverb on the chords" — every track/preset
// gets the same reverbDecay/reverbMix send (see PRESETS), same as delay
// above; the piano/melody just default to a non-zero mix since that's
// where it's most useful. No impulse-response file needed: the classic
// algorithmic trick is a burst of noise shaped by a power-curve decay,
// fed through a ConvolverNode.
// ---------------------------------------------------------------------

function createReverbImpulse(ctx, seconds) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < impulse.numberOfChannels; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
    }
  }
  return impulse;
}

const trackReverbNodes = new Map(); // track.id -> { convolver, wetGain, decaySeconds }

function getTrackReverb(track, decaySeconds) {
  let fx = trackReverbNodes.get(track.id);
  if (!fx || fx.decaySeconds !== decaySeconds) {
    // Rebuilding the impulse response is the "expensive" part, but this
    // only runs when a note actually triggers with a changed decay value
    // — not while dragging the slider — so it never jitters playback.
    if (fx) fx.convolver.disconnect();
    const convolver = audioCtx.createConvolver();
    convolver.buffer = createReverbImpulse(audioCtx, decaySeconds);
    const wetGain = audioCtx.createGain();
    convolver.connect(wetGain).connect(masterGain);
    fx = { convolver, wetGain, decaySeconds };
    trackReverbNodes.set(track.id, fx);
  }
  return fx;
}

// A step's `override` (see makeStep()) can carry a semitone offset applied
// on top of the track's base frequency, so an individual lit step can play
// a different note than the rest of the row. `extraSemis` layers a further
// offset on top — used to fan a single step out into a chord (see
// scheduleStep()).
function stepPitchRatio(step, extraSemis) {
  const semis = (step && step.override && typeof step.override.semitones === "number" ? step.override.semitones : 0) + (extraSemis || 0);
  return Math.pow(2, semis / 12);
}

function triggerVoice(track, time, step, extraSemis, gainScale) {
  const p = track.params;
  const ctx = audioCtx;

  const audible = isAudible(track);
  if (!audible) return;

  const velocity = step && typeof step.velocity === "number" ? step.velocity : 1;
  const out = ctx.createGain();
  out.gain.value = track.volume * (gainScale || 1) * velocity;
  const panner = ctx.createStereoPanner();
  panner.pan.value = p.pan || 0;
  out.connect(panner).connect(masterGain);

  if (p.delayMix > 0 && p.delaySteps > 0) {
    const fx = getTrackDelay(track);
    const delayTime = Math.min(MAX_DELAY_SECONDS - 0.05, Math.max(0.01, p.delaySteps * secondsPerStep()));
    fx.delayNode.delayTime.setValueAtTime(delayTime, time);
    fx.feedbackGain.gain.setValueAtTime(Math.min(0.95, Math.max(0, p.delayFeedback)), time);
    fx.wetGain.gain.setValueAtTime(Math.min(1, Math.max(0, p.delayMix)), time);
    out.connect(fx.delayNode); // send a copy of this hit into the track's delay bus
  }

  if (p.reverbMix > 0) {
    const decaySeconds = Math.min(6, Math.max(0.2, p.reverbDecay || 1.6));
    const reverbFx = getTrackReverb(track, decaySeconds);
    reverbFx.wetGain.gain.setValueAtTime(Math.min(1, Math.max(0, p.reverbMix)), time);
    out.connect(reverbFx.convolver);
  }

  const attack = Math.max(0.001, p.attack);
  const decay = Math.max(0.001, p.decay);
  const release = Math.max(0.001, p.release);
  const sustainLevel = Math.min(1, Math.max(0, p.sustain));
  const noteEnd = time + attack + decay + release;
  const stopTime = noteEnd + 0.05;

  // --- FM carrier + modulator ---
  const carrier = ctx.createOscillator();
  carrier.type = p.carrierWave;
  const baseFreq = Math.max(1, p.freq * stepPitchRatio(step, extraSemis));
  if (p.pitchEnvAmount) {
    const startFreq = Math.max(1, baseFreq + p.pitchEnvAmount);
    carrier.frequency.setValueAtTime(startFreq, time);
    carrier.frequency.exponentialRampToValueAtTime(baseFreq, time + Math.max(0.005, p.pitchEnvDecay));
  } else {
    carrier.frequency.setValueAtTime(baseFreq, time);
  }

  const modulator = ctx.createOscillator();
  modulator.type = p.modWave;
  modulator.frequency.setValueAtTime(baseFreq * p.modRatio, time);
  const modGain = ctx.createGain();
  modGain.gain.setValueAtTime(p.modIndex, time);
  if (p.modIndexDecay > 0 && p.modIndex > 0) {
    // Ramp the modulation index down after the strike instead of holding it
    // constant. A static index is what makes simple FM patches sound like a
    // flat "beep"; letting the harmonics collapse toward a mellower sustain
    // is what gives e.g. the piano voice its percussive, decaying timbre.
    const sustainIndex = Math.max(0.0001, p.modIndex * (p.modIndexSustainRatio ?? 0.25));
    modGain.gain.exponentialRampToValueAtTime(sustainIndex, time + p.modIndexDecay);
  }
  modulator.connect(modGain);
  modGain.connect(carrier.frequency);

  const ampEnv = ctx.createGain();
  ampEnv.gain.setValueAtTime(0, time);
  ampEnv.gain.linearRampToValueAtTime(1, time + attack);
  ampEnv.gain.linearRampToValueAtTime(sustainLevel, time + attack + decay);
  ampEnv.gain.linearRampToValueAtTime(0, noteEnd);

  carrier.connect(ampEnv);
  ampEnv.connect(out);
  carrier.start(time);
  carrier.stop(stopTime);
  modulator.start(time);
  modulator.stop(stopTime);

  // --- Noise layer ---
  if (p.noiseLevel > 0 && noiseBuffer) {
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuffer;
    noiseSrc.loop = true;
    noiseSrc.loopStart = 0;
    noiseSrc.loopEnd = noiseBuffer.duration;
    // Random start offset so repeated hits don't sound identical.
    const offset = Math.random() * (noiseBuffer.duration - 0.5);

    const filter = ctx.createBiquadFilter();
    filter.type = p.noiseFilterType;
    filter.frequency.value = p.noiseFilterFreq;
    filter.Q.value = p.noiseFilterQ;

    const noiseEnv = ctx.createGain();
    noiseEnv.gain.setValueAtTime(0, time);
    noiseEnv.gain.linearRampToValueAtTime(p.noiseLevel, time + attack);
    noiseEnv.gain.linearRampToValueAtTime(0, noteEnd);

    noiseSrc.connect(filter).connect(noiseEnv).connect(out);
    noiseSrc.start(time, offset);
    noiseSrc.stop(stopTime);
  }
}

function isAudible(track) {
  const anySolo = state.tracks.some((t) => t.solo);
  if (anySolo) return track.solo;
  return !track.mute;
}

function previewTrack(track) {
  ensureAudio();
  if (audioCtx.state === "suspended") audioCtx.resume();
  const time = audioCtx.currentTime + 0.02;
  const intervals = resolveChordIntervals(track, null); // no specific step, so just the track's own chord
  const gainScale = 1 / Math.sqrt(intervals.length);
  for (const interval of intervals) triggerVoice(track, time, null, interval, gainScale);
}

// ---------------------------------------------------------------------
// Scheduler (lookahead pattern)
// ---------------------------------------------------------------------

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_S = 0.1;

let playing = false;
let currentStep = 0;
let nextStepTime = 0;
let schedulerTimer = null;

function secondsPerStep() {
  return 60 / state.bpm / STEPS_PER_BEAT;
}

function schedulerTick() {
  try {
    while (nextStepTime < audioCtx.currentTime + SCHEDULE_AHEAD_S) {
      scheduleStep(currentStep, nextStepTime);
      nextStepTime += secondsPerStep();
      currentStep = (currentStep + 1) % state.patternLength;
    }
  } catch (e) {
    // Whatever went wrong, keep the transport itself alive — a scheduler
    // that quietly stops re-arming its own setTimeout is indistinguishable
    // from "no sound ever again" with nothing in the UI to explain why.
    console.error("Scheduler error", e);
  }
  schedulerTimer = setTimeout(schedulerTick, LOOKAHEAD_MS);
}

// The chord a given (chord-mode) hit plays: a step can override the
// track's chord (see the tone popover's chord-type picker); otherwise it
// falls back to the track's own chordIntervals, then to a plain major triad.
function resolveChordIntervals(track, step) {
  if (!track.chordMode) return [0];
  const stepIntervals = step && step.override && Array.isArray(step.override.chordIntervals) ? step.override.chordIntervals : null;
  if (stepIntervals && stepIntervals.length) return stepIntervals;
  if (Array.isArray(track.chordIntervals) && track.chordIntervals.length) return track.chordIntervals;
  return CHORD_TYPES.major.intervals;
}

function scheduleStep(stepIndex, time) {
  // Classic drum-machine swing: delay every 2nd 16th note (the "off" 8th)
  // by a fraction of a step, applied globally across all tracks.
  const swingOffset = state.swing && stepIndex % 2 === 1 ? (state.swing / 100) * secondsPerStep() : 0;
  for (const track of state.tracks) {
    const step = track.steps[stepIndex];
    if (!step || !step.on) continue;
    const intervals = resolveChordIntervals(track, step);
    // Chord notes are summed, so scale each voice down (by loudness, not
    // linearly) instead of letting a 3-4 note chord just come out ~3-4x
    // louder than a single hit on the same track.
    const gainScale = 1 / Math.sqrt(intervals.length);
    // Per-step micro-timing "nudge" (see the tone popover) layers on top of
    // the global swing — the playhead below still advances on the
    // unnudged/un-swung `time`, only the audio trigger moves.
    const nudge = step.override && typeof step.override.nudge === "number" ? step.override.nudge : 0;
    const offset = swingOffset + nudge * secondsPerStep();
    const hitTime = offset ? Math.max(audioCtx.currentTime + 0.001, time + offset) : time;
    for (const interval of intervals) {
      try {
        triggerVoice(track, hitTime, step, interval, gainScale);
      } catch (e) {
        // A single bad voice must never take the whole scheduler down with
        // it — schedulerTick()'s setTimeout chain would simply stop, and
        // every step after this one would silently never play again.
        console.error(`Kunne ikke afspille "${track.name}" (trin ${stepIndex})`, e);
      }
    }
  }
  const delayMs = Math.max(0, (time - audioCtx.currentTime) * 1000);
  setTimeout(() => setPlayheadColumn(stepIndex), delayMs);
}

function start() {
  ensureAudio();
  if (audioCtx.state === "suspended") audioCtx.resume();
  if (playing) return;
  playing = true;
  // Starts from currentStep as-is (0 by default, or wherever the ruler was
  // last clicked/dragged to — see seekTo()) rather than always rewinding.
  nextStepTime = audioCtx.currentTime + 0.05;
  schedulerTick();
  updatePlayButton();
}

function stop() {
  playing = false;
  clearTimeout(schedulerTimer);
  updatePlayButton();
}

// Move the playback position to `stepIndex` — clicking/dragging the ruler
// (see the stepsRuler pointer handlers below). While playing, the next
// scheduler tick picks the new position up almost immediately; while
// stopped, this just moves the visible playhead to where playback will
// resume from next.
function seekTo(stepIndex) {
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= state.patternLength) return;
  currentStep = stepIndex;
  if (playing) nextStepTime = audioCtx.currentTime + 0.02;
  setPlayheadColumn(stepIndex);
}

function updatePlayButton() {
  playBtn.textContent = playing ? "■ Stop" : "▶ Play";
  playBtn.classList.toggle("playing", playing);
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

const stepsRuler = document.getElementById("stepsRuler");
const tracksContainer = document.getElementById("tracksContainer");
const playBtn = document.getElementById("playBtn");
const bpmInput = document.getElementById("bpmInput");
const lengthSelect = document.getElementById("lengthSelect");
const swingInput = document.getElementById("swingInput");
const addTrackBtn = document.getElementById("addTrackBtn");
const importMidiBtn = document.getElementById("importMidiBtn");
const midiFileInput = document.getElementById("midiFileInput");
const clearBtn = document.getElementById("clearBtn");
const resetBtn = document.getElementById("resetBtn");
const statusText = document.getElementById("statusText");

let openTrackId = null;

function renderRuler() {
  let html = "";
  for (let i = 0; i < state.patternLength; i++) {
    const classes = ["ruler-cell"];
    if (i % STEPS_PER_BEAT === 0) classes.push("beat");
    html += `<div class="${classes.join(" ")}" data-ruler-index="${i}">${i % STEPS_PER_BEAT === 0 ? i / STEPS_PER_BEAT + 1 : ""}</div>`;
  }
  stepsRuler.innerHTML = html;
}

function fieldHtml(track, key, label, opts) {
  const p = track.params;
  const val = p[key];
  if (opts.type === "select") {
    const options = opts.options
      .map((o) => `<option value="${o.value}" ${o.value === val ? "selected" : ""}>${o.label}</option>`)
      .join("");
    return `
      <div class="panel-field">
        <label>${label}</label>
        <select data-action="param" data-param="${key}" data-track="${track.id}">${options}</select>
      </div>`;
  }
  return `
    <div class="panel-field">
      <label>${label} <span class="val" data-val-for="${key}">${formatVal(val, opts)}</span></label>
      <input type="range" data-action="param" data-param="${key}" data-track="${track.id}"
        min="${opts.min}" max="${opts.max}" step="${opts.step}" value="${val}">
    </div>`;
}

function formatVal(v, opts) {
  const decimals = opts.decimals ?? 2;
  return Number(v).toFixed(decimals) + (opts.suffix || "");
}

function presetOptionsHtml(selected) {
  return Object.keys(PRESETS)
    .map((key) => `<option value="${key}" ${key === selected ? "selected" : ""}>${PRESETS[key].label}</option>`)
    .join("");
}

// ---------------------------------------------------------------------
// Note-name <-> frequency helpers, shared by the base-frequency field
// (below) and the per-step tone override popover.
// ---------------------------------------------------------------------

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function noteOptionsHtml(selected) {
  return NOTE_NAMES.map((n) => `<option value="${n}" ${n === selected ? "selected" : ""}>${n}</option>`).join("");
}
function freqToMidi(freq) {
  return 12 * Math.log2(freq / 440) + 69; // 440 Hz = A4 = MIDI 69
}
function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
function midiToNote(midi) {
  const rounded = Math.round(midi);
  return { name: NOTE_NAMES[((rounded % 12) + 12) % 12], octave: Math.floor(rounded / 12) - 1, midi: rounded };
}
function noteToMidi(name, octave) {
  return NOTE_NAMES.indexOf(name) + (octave + 1) * 12;
}

function freqNoteFieldHtml(track) {
  const note = midiToNote(freqToMidi(track.params.freq));
  return `
    <div class="panel-field">
      <label>Root note</label>
      <div class="panel-note-row">
        <select data-action="freq-note" data-track="${track.id}">${noteOptionsHtml(note.name)}</select>
        <input type="number" data-action="freq-octave" data-track="${track.id}" min="-1" max="9" step="1" value="${note.octave}">
      </div>
    </div>`;
}

// ---------------------------------------------------------------------
// Chord mode: when enabled on a track, every lit step plays a chord (a
// stack of notes, offset in semitones from the step's own note) instead
// of a single note. See scheduleStep()/previewTrack() for the playback
// side and CHORD_TYPES below for the built-in shapes.
// ---------------------------------------------------------------------

const CHORD_TYPES = {
  major: { label: "Major", intervals: [0, 4, 7] },
  minor: { label: "Minor", intervals: [0, 3, 7] },
  sus2: { label: "Sus2", intervals: [0, 2, 7] },
  sus4: { label: "Sus4", intervals: [0, 5, 7] },
  major7: { label: "Major 7", intervals: [0, 4, 7, 11] },
  minor7: { label: "Minor 7", intervals: [0, 3, 7, 10] },
  power: { label: "5th (power chord)", intervals: [0, 7] },
  octave: { label: "Octave", intervals: [0, 12] },
  custom: { label: "Custom", intervals: null },
};

function chordTypeOptionsHtml(selected) {
  return Object.keys(CHORD_TYPES)
    .map((key) => `<option value="${key}" ${key === selected ? "selected" : ""}>${CHORD_TYPES[key].label}</option>`)
    .join("");
}

function chordFieldsHtml(track) {
  const toggle = `
    <div class="panel-field">
      <label>Chord mode</label>
      <label class="chord-toggle">
        <input type="checkbox" data-action="chord-toggle" data-track="${track.id}" ${track.chordMode ? "checked" : ""}>
        Play a chord on every lit step
      </label>
    </div>`;
  if (!track.chordMode) return toggle;
  const intervals = Array.isArray(track.chordIntervals) ? track.chordIntervals : CHORD_TYPES.major.intervals;
  return `
    ${toggle}
    <div class="panel-field">
      <label>Chord type</label>
      <select data-action="chord-type" data-track="${track.id}">${chordTypeOptionsHtml(track.chordType)}</select>
    </div>
    <div class="panel-field">
      <label>Notes (semitones, comma-separated)</label>
      <input type="text" data-action="chord-intervals" data-track="${track.id}" value="${intervals.join(",")}">
    </div>`;
}

function panelHtml(track) {
  const p = track.params;
  return `
    <div class="panel-grid">
      <div class="panel-field">
        <label>Name</label>
        <input type="text" data-action="name" data-track="${track.id}" value="${escapeHtml(track.name)}">
      </div>
      <div class="panel-field">
        <label>Preset</label>
        <select data-action="preset" data-track="${track.id}">${presetOptionsHtml(track.preset)}</select>
      </div>
      ${chordFieldsHtml(track)}
      ${fieldHtml(track, "carrierWave", "Carrier wave", { type: "select", options: waveOptions() })}
      ${fieldHtml(track, "modWave", "Modulator wave", { type: "select", options: waveOptions() })}
      ${fieldHtml(track, "freq", "Base frequency (Hz)", { min: 20, max: 2000, step: 1, decimals: 0, suffix: " Hz" })}
      ${freqNoteFieldHtml(track)}
      ${fieldHtml(track, "modRatio", "Mod. ratio", { min: 0.1, max: 8, step: 0.01, decimals: 2 })}
      ${fieldHtml(track, "modIndex", "Mod. index", { min: 0, max: 400, step: 1, decimals: 0 })}
      ${fieldHtml(track, "modIndexDecay", "Mod. index decay (s)", { min: 0, max: 1, step: 0.005, decimals: 3 })}
      ${fieldHtml(track, "modIndexSustainRatio", "Mod. index sustain ratio", { min: 0, max: 1, step: 0.01, decimals: 2 })}
      ${fieldHtml(track, "pitchEnvAmount", "Pitch env amount (Hz)", { min: -500, max: 500, step: 1, decimals: 0 })}
      ${fieldHtml(track, "pitchEnvDecay", "Pitch env decay (s)", { min: 0.005, max: 1, step: 0.005, decimals: 3 })}
      ${fieldHtml(track, "attack", "Attack (s)", { min: 0.001, max: 1, step: 0.001, decimals: 3 })}
      ${fieldHtml(track, "decay", "Decay (s)", { min: 0.001, max: 2, step: 0.001, decimals: 3 })}
      ${fieldHtml(track, "sustain", "Sustain", { min: 0, max: 1, step: 0.01, decimals: 2 })}
      ${fieldHtml(track, "release", "Release (s)", { min: 0.001, max: 2, step: 0.001, decimals: 3 })}
      ${fieldHtml(track, "noiseLevel", "Noise level", { min: 0, max: 1, step: 0.01, decimals: 2 })}
      ${fieldHtml(track, "noiseFilterType", "Noise filter type", { type: "select", options: filterOptions() })}
      ${fieldHtml(track, "noiseFilterFreq", "Noise filter freq (Hz)", { min: 20, max: 15000, step: 10, decimals: 0, suffix: " Hz" })}
      ${fieldHtml(track, "noiseFilterQ", "Noise filter Q", { min: 0.1, max: 20, step: 0.1, decimals: 1 })}
      ${fieldHtml(track, "pan", "Panning", { min: -1, max: 1, step: 0.01, decimals: 2 })}
      ${fieldHtml(track, "delaySteps", "Delay (steps)", { min: 0, max: 8, step: 1, decimals: 0 })}
      ${fieldHtml(track, "delayFeedback", "Delay feedback", { min: 0, max: 0.95, step: 0.01, decimals: 2 })}
      ${fieldHtml(track, "delayMix", "Delay mix", { min: 0, max: 1, step: 0.01, decimals: 2 })}
      ${fieldHtml(track, "reverbDecay", "Reverb decay (s)", { min: 0.2, max: 4, step: 0.05, decimals: 2 })}
      ${fieldHtml(track, "reverbMix", "Reverb mix", { min: 0, max: 1, step: 0.01, decimals: 2 })}
    </div>
    <div class="panel-actions">
      <button data-action="preview" data-track="${track.id}">🔊 Test sound</button>
    </div>
  `;
}

function waveOptions() {
  return ["sine", "triangle", "square", "sawtooth"].map((w) => ({ value: w, label: w }));
}
function filterOptions() {
  return ["lowpass", "highpass", "bandpass"].map((w) => ({ value: w, label: w }));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function trackHtml(track) {
  const preset = PRESETS[track.preset] || PRESETS.custom;
  const isOpen = track.id === openTrackId;
  let stepsHtml = "";
  for (let i = 0; i < state.patternLength; i++) {
    const step = track.steps[i] || makeStep(false); // defensive: see ensureTrackCapacity()
    const classes = ["step-btn"];
    if (i % (STEPS_PER_BEAT * 4) === 0) classes.push("beat-marker");
    if (step.on) classes.push("on");
    const hasToneOverride = step.on && step.override && step.override.semitones;
    const hasChordOverride = step.on && step.override && step.override.chordType;
    const nudge = step.on && step.override && step.override.nudge ? step.override.nudge : 0;
    if (hasToneOverride || hasChordOverride || nudge) classes.push("has-override");
    if (nudge < 0) classes.push("nudge-early");
    if (nudge > 0) classes.push("nudge-late");
    const style = step.on ? ` style="background:${preset.color}"` : "";
    const toneBadge = hasToneOverride ? `<span class="tone-badge">${step.override.semitones > 0 ? "+" : ""}${step.override.semitones}</span>` : "";
    const chordBadge = hasChordOverride ? `<span class="chord-override-badge" title="${escapeHtml((CHORD_TYPES[step.override.chordType] && CHORD_TYPES[step.override.chordType].label) || "")}">♫</span>` : "";
    const title = step.on ? "Right-click to edit note/chord/groove" : "Click to turn the step on";
    stepsHtml += `<button class="${classes.join(" ")}" data-action="step" data-track="${track.id}" data-step="${i}"${style} title="${title}">${toneBadge}${chordBadge}</button>`;
  }
  return `
    <div class="track ${isOpen ? "open" : ""}" data-track-id="${track.id}">
      <div class="track-row">
        <div class="row-header">
          <div class="track-color" style="background:${preset.color}"></div>
          <div class="track-index">${track.id + 1}</div>
          <button class="track-name-btn" data-action="toggle-panel" data-track="${track.id}" title="Edit FM parameters">${track.chordMode ? '<span class="chord-indicator" title="Chord mode">♫</span>' : ""}${escapeHtml(track.name)}</button>
          <button class="mini-btn mute-btn ${track.mute ? "active" : ""}" data-action="mute" data-track="${track.id}" title="Mute">M</button>
          <button class="mini-btn solo-btn ${track.solo ? "active" : ""}" data-action="solo" data-track="${track.id}" title="Solo">S</button>
          <input class="vol-range" type="range" min="0" max="1" step="0.01" value="${track.volume}" data-action="volume" data-track="${track.id}" title="Lydstyrke">
          <button class="mini-btn clear-track-btn" data-action="clear-track" data-track="${track.id}" title="Clear this track (all steps)">C</button>
          <button class="mini-btn delete-btn" data-action="delete-track" data-track="${track.id}" title="Remove track">×</button>
        </div>
        <div class="steps">${stepsHtml}</div>
      </div>
      <div class="track-panel">${isOpen ? panelHtml(track) : ""}</div>
    </div>
  `;
}

function renderAll() {
  closeToneEditor(); // any open popover would otherwise point at a detached button
  renderRuler();
  state.tracks.forEach((t) => ensureTrackCapacity(t, state.patternLength));
  tracksContainer.innerHTML = state.tracks.map(trackHtml).join("");
  bpmInput.value = state.bpm;
  // Rebuilt from PATTERN_LENGTHS each time (not just the 3 default steps),
  // since a MIDI import can register a longer, non-standard length.
  lengthSelect.innerHTML = PATTERN_LENGTHS
    .map((n) => `<option value="${n}" ${n === state.patternLength ? "selected" : ""}>${n}</option>`)
    .join("");
  swingInput.value = state.swing;
}

function setPlayheadColumn(stepIndex) {
  document.querySelectorAll(".ruler-cell.playhead").forEach((el) => el.classList.remove("playhead"));
  document.querySelectorAll(".step-btn.playhead-col").forEach((el) => el.classList.remove("playhead-col"));
  if (stepIndex < 0) return;
  const ruler = stepsRuler.querySelector(`[data-ruler-index="${stepIndex}"]`);
  if (ruler) ruler.classList.add("playhead");
  document.querySelectorAll(`.step-btn[data-step="${stepIndex}"]`).forEach((el) => el.classList.add("playhead-col"));
}

// ---------------------------------------------------------------------
// Per-step tone override editor
// ---------------------------------------------------------------------
// Right-clicking a lit step opens a small popover to transpose that single
// hit up/down (in semitones) relative to the track's base pitch, using the
// `override` slot each step already reserves (see makeStep()). The offset
// can be dialed in either as a raw semitone number or as a note name +
// octave (e.g. "F#4"), kept in sync with each other. The note-math helpers
// (freqToMidi etc.) live in the Rendering section above since the track
// panel's base-frequency field uses them too.

let toneEditor = null; // { trackIndex, stepIndex, popoverEl, buttonEl }

function updateStepOverrideVisual(buttonEl, step) {
  const semis = step.on && step.override && step.override.semitones ? step.override.semitones : 0;
  const chordType = step.on && step.override && step.override.chordType;
  const nudge = step.on && step.override && step.override.nudge ? step.override.nudge : 0;
  buttonEl.classList.toggle("has-override", !!semis || !!chordType || !!nudge);
  buttonEl.classList.toggle("nudge-early", nudge < 0);
  buttonEl.classList.toggle("nudge-late", nudge > 0);

  let badge = buttonEl.querySelector(".tone-badge");
  if (semis) {
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "tone-badge";
      buttonEl.appendChild(badge);
    }
    badge.textContent = (semis > 0 ? "+" : "") + semis;
  } else if (badge) {
    badge.remove();
  }

  let chordBadge = buttonEl.querySelector(".chord-override-badge");
  if (chordType) {
    if (!chordBadge) {
      chordBadge = document.createElement("span");
      chordBadge.className = "chord-override-badge";
      chordBadge.textContent = "♫";
      buttonEl.appendChild(chordBadge);
    }
    chordBadge.title = (CHORD_TYPES[chordType] && CHORD_TYPES[chordType].label) || "";
  } else if (chordBadge) {
    chordBadge.remove();
  }
}

function closeToneEditor() {
  if (!toneEditor) return;
  toneEditor.popoverEl.remove();
  document.removeEventListener("mousedown", onToneEditorOutsideClick, true);
  document.removeEventListener("keydown", onToneEditorKeydown, true);
  toneEditor = null;
}

function onToneEditorOutsideClick(e) {
  if (toneEditor && !toneEditor.popoverEl.contains(e.target)) closeToneEditor();
}

function onToneEditorKeydown(e) {
  if (e.key === "Escape") closeToneEditor();
}

function openToneEditor(buttonEl, trackIndex, stepIndex) {
  closeToneEditor();
  const track = state.tracks[trackIndex];
  const step = track && track.steps[stepIndex];
  if (!step || !step.on) return;

  const current = step.override && typeof step.override.semitones === "number" ? step.override.semitones : 0;
  // The track's base pitch, rounded to the nearest equal-tempered note, is
  // the "root" that note-name + octave picks are expressed relative to.
  const rootMidi = Math.round(freqToMidi(track.params.freq));
  // undefined chordType = this step just inherits the track's chord.
  const stepChordType = step.override && step.override.chordType;
  const inheritedIntervals = Array.isArray(track.chordIntervals) && track.chordIntervals.length
    ? track.chordIntervals
    : CHORD_TYPES.major.intervals;
  const effectiveIntervals = (step.override && step.override.chordIntervals) || inheritedIntervals;

  const chordSectionHtml = track.chordMode ? `
    <div class="tone-popover-divider"></div>
    <div class="tone-popover-row">
      <select class="tone-chord-type">
        <option value="" ${!stepChordType ? "selected" : ""}>Track default (${CHORD_TYPES[track.chordType || "major"].label})</option>
        ${chordTypeOptionsHtml(stepChordType)}
      </select>
    </div>
    <div class="tone-popover-row">
      <input type="text" class="tone-chord-intervals" value="${effectiveIntervals.join(",")}" placeholder="e.g. 0,4,7" ${stepChordType ? "" : "disabled"}>
    </div>
  ` : "";

  const currentNudgePct = step.override && typeof step.override.nudge === "number" ? Math.round(step.override.nudge * 100) : 0;

  const pop = document.createElement("div");
  pop.className = "tone-popover";
  pop.innerHTML = `
    <div class="tone-popover-title">${escapeHtml(track.name)} · step ${stepIndex + 1}</div>
    <div class="tone-popover-row tone-note-row">
      <select class="tone-note">${noteOptionsHtml(midiToNote(rootMidi + current).name)}</select>
      <input type="number" class="tone-octave" min="-1" max="9" step="1">
      <span class="tone-note-hint">note + octave</span>
    </div>
    <div class="tone-popover-row">
      <input type="range" min="-24" max="24" step="1" value="${current}" class="tone-range">
    </div>
    <div class="tone-value"></div>
    ${chordSectionHtml}
    <div class="tone-popover-divider"></div>
    <div class="tone-popover-row">
      <input type="range" min="-45" max="45" step="1" value="${currentNudgePct}" class="tone-nudge">
    </div>
    <div class="tone-value tone-nudge-value"></div>
    <div class="tone-popover-actions">
      <button type="button" class="tone-reset">Reset note</button>
      <button type="button" class="tone-close">Close</button>
    </div>
  `;
  document.body.appendChild(pop);

  const rect = buttonEl.getBoundingClientRect();
  const left = Math.min(window.innerWidth - 256, Math.max(8, rect.left));
  const top = Math.min(window.innerHeight - (track.chordMode ? 250 : 170), rect.bottom + 6);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;

  const range = pop.querySelector(".tone-range");
  const noteSelect = pop.querySelector(".tone-note");
  const octaveInput = pop.querySelector(".tone-octave");
  const valueEl = pop.querySelector(".tone-value:not(.tone-nudge-value)");
  const chordTypeSelect = pop.querySelector(".tone-chord-type");
  const chordIntervalsInput = pop.querySelector(".tone-chord-intervals");
  const nudgeRange = pop.querySelector(".tone-nudge");
  const nudgeValueEl = pop.querySelector(".tone-nudge-value");

  // Merge `patch` into this step's override, dropping any field that lands
  // back at its "no override" value so the object collapses to null again
  // once nothing is left overridden (keeps has-override/badges accurate).
  function patchStepOverride(patch) {
    const merged = { ...(step.override || {}), ...patch };
    const cleaned = {};
    if (merged.semitones) cleaned.semitones = merged.semitones;
    if (merged.chordType) {
      cleaned.chordType = merged.chordType;
      cleaned.chordIntervals = merged.chordIntervals;
    }
    if (merged.nudge) cleaned.nudge = merged.nudge;
    step.override = Object.keys(cleaned).length ? cleaned : null;
    updateStepOverrideVisual(buttonEl, step);
    scheduleSave();
  }

  // Paint the three pitch controls (slider, note, octave) + the readout for
  // a given semitone offset, without touching the step data.
  function renderTone(semis) {
    range.value = semis;
    const note = midiToNote(rootMidi + semis);
    noteSelect.value = note.name;
    octaveInput.value = note.octave;
    const freq = midiToFreq(rootMidi + semis);
    valueEl.textContent = `${semis > 0 ? "+" : ""}${semis} semitones · ${note.name}${note.octave} (${freq.toFixed(1)} Hz)`;
  }
  function commitTone(rawSemis) {
    const semis = Math.max(-24, Math.min(24, Math.round(rawSemis)));
    renderTone(semis);
    patchStepOverride({ semitones: semis });
  }
  const commitFromNotePick = () => commitTone(noteToMidi(noteSelect.value, Number(octaveInput.value)) - rootMidi);

  renderTone(current);
  range.addEventListener("input", () => commitTone(Number(range.value)));
  noteSelect.addEventListener("change", commitFromNotePick);
  octaveInput.addEventListener("change", commitFromNotePick);
  pop.querySelector(".tone-reset").addEventListener("click", () => commitTone(0));
  pop.querySelector(".tone-close").addEventListener("click", closeToneEditor);

  if (chordTypeSelect) {
    chordTypeSelect.addEventListener("change", () => {
      const key = chordTypeSelect.value;
      if (!key) {
        chordIntervalsInput.disabled = true;
        chordIntervalsInput.value = inheritedIntervals.join(",");
        patchStepOverride({ chordType: null, chordIntervals: null });
        return;
      }
      chordIntervalsInput.disabled = false;
      const preset = CHORD_TYPES[key];
      const intervals = preset.intervals ? preset.intervals.slice() : effectiveIntervals;
      chordIntervalsInput.value = intervals.join(",");
      patchStepOverride({ chordType: key, chordIntervals: intervals });
    });
    chordIntervalsInput.addEventListener("change", () => {
      const parsed = chordIntervalsInput.value.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
      const intervals = parsed.length ? parsed : [0];
      chordTypeSelect.value = "custom";
      patchStepOverride({ chordType: "custom", chordIntervals: intervals });
    });
  }

  // Micro-timing "nudge": shifts just this hit earlier/later by a fraction
  // of a step, independent of pitch/chord — the classic drum-machine way
  // to add swing/groove without moving the note off the visible grid.
  function renderNudge(pct) {
    nudgeRange.value = pct;
    const dir = pct === 0 ? "on the grid" : pct < 0 ? "earlier" : "later";
    nudgeValueEl.textContent = `Groove: ${pct > 0 ? "+" : ""}${pct}% (${dir})`;
  }
  function commitNudge(rawPct) {
    const pct = Math.max(-45, Math.min(45, Math.round(rawPct)));
    renderNudge(pct);
    patchStepOverride({ nudge: pct ? pct / 100 : 0 });
  }
  renderNudge(currentNudgePct);
  nudgeRange.addEventListener("input", () => commitNudge(Number(nudgeRange.value)));

  toneEditor = { trackIndex, stepIndex, popoverEl: pop, buttonEl };
  // Defer outside-click binding a tick so the opening right-click doesn't
  // immediately trigger it.
  setTimeout(() => {
    document.addEventListener("mousedown", onToneEditorOutsideClick, true);
    document.addEventListener("keydown", onToneEditorKeydown, true);
  }, 0);
}

tracksContainer.addEventListener("contextmenu", (e) => {
  const el = e.target.closest(".step-btn");
  if (!el) return;
  e.preventDefault();
  const trackIndex = Number(el.dataset.track);
  const stepIndex = Number(el.dataset.step);
  const step = state.tracks[trackIndex] && state.tracks[trackIndex].steps[stepIndex];
  if (!step || !step.on) return; // only lit steps have a tone to edit
  openToneEditor(el, trackIndex, stepIndex);
});

// ---------------------------------------------------------------------
// Event delegation
// ---------------------------------------------------------------------

tracksContainer.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;
  const trackIndex = Number(el.dataset.track);
  const track = state.tracks[trackIndex];
  if (!track) return;

  if (action === "step") {
    const stepIndex = Number(el.dataset.step);
    const step = track.steps[stepIndex];
    step.on = !step.on;
    const preset = PRESETS[track.preset] || PRESETS.custom;
    el.classList.toggle("on", step.on);
    el.style.background = step.on ? preset.color : "";
    el.title = step.on ? "Right-click to edit note/chord/groove" : "Click to turn the step on";
    updateStepOverrideVisual(el, step);
    if (!step.on && toneEditor && toneEditor.trackIndex === trackIndex && toneEditor.stepIndex === stepIndex) {
      closeToneEditor();
    }
    scheduleSave();
  } else if (action === "mute") {
    track.mute = !track.mute;
    el.classList.toggle("active", track.mute);
    scheduleSave();
  } else if (action === "solo") {
    track.solo = !track.solo;
    el.classList.toggle("active", track.solo);
    scheduleSave();
  } else if (action === "toggle-panel") {
    openTrackId = openTrackId === trackIndex ? null : trackIndex;
    renderAll();
  } else if (action === "preview") {
    previewTrack(track);
  } else if (action === "delete-track") {
    if (state.tracks.length <= 1) return; // always keep at least one track
    if (!confirm(`Remove the track "${track.name}"?`)) return;
    state.tracks.splice(trackIndex, 1);
    state.tracks.forEach((t, i) => { t.id = i; });
    if (openTrackId === trackIndex) openTrackId = null;
    else if (openTrackId !== null && openTrackId > trackIndex) openTrackId -= 1;
    renderAll();
    statusText.textContent = `${state.tracks.length} tracks × ${state.patternLength} steps`;
    scheduleSave();
  } else if (action === "clear-track") {
    if (!track.steps.some((s) => s.on)) return; // nothing to clear
    if (!confirm(`Clear all steps in "${track.name}"?`)) return;
    for (const step of track.steps) {
      step.on = false;
      step.override = null;
    }
    renderAll();
    scheduleSave();
  }
});

tracksContainer.addEventListener("input", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;
  const trackIndex = Number(el.dataset.track);
  const track = state.tracks[trackIndex];
  if (!track) return;

  if (action === "volume") {
    track.volume = Number(el.value);
    scheduleSave();
  } else if (action === "name") {
    track.name = el.value;
    const btn = tracksContainer.querySelector(`.track-name-btn[data-track="${trackIndex}"]`);
    if (btn) {
      const chordBadge = track.chordMode ? '<span class="chord-indicator" title="Chord mode">♫</span>' : "";
      btn.innerHTML = chordBadge + escapeHtml(track.name || `Track ${trackIndex + 1}`);
    }
    scheduleSave();
  } else if (action === "preset") {
    track.preset = el.value;
    const preset = PRESETS[track.preset];
    track.params = { ...preset };
    track.volume = preset.volume;
    track.name = preset.label;
    openTrackId = trackIndex;
    renderAll();
    scheduleSave();
    return;
  } else if (action === "param") {
    const key = el.dataset.param;
    const isSelect = el.tagName === "SELECT";
    track.params[key] = isSelect ? el.value : Number(el.value);
    if (!isSelect) {
      const valEl = tracksContainer.querySelector(`[data-val-for="${key}"]`);
      if (valEl) {
        const numeric = el.step && el.step.includes(".") ? el.step.split(".")[1].length : 0;
        valEl.textContent = Number(el.value).toFixed(numeric);
      }
    }
    if (key === "freq") syncFreqNoteField(track.params.freq); // keep the note/octave picker in step with the Hz slider
    scheduleSave();
  } else if (action === "freq-note" || action === "freq-octave") {
    // Base frequency dialed in as a note name + octave instead of raw Hz.
    const noteSelect = tracksContainer.querySelector('select[data-action="freq-note"]');
    const octaveInput = tracksContainer.querySelector('input[data-action="freq-octave"]');
    if (!noteSelect || !octaveInput) return;
    // Always snap to the note's exact standard-tuning Hz — that precision is
    // the whole point of picking a note instead of dragging the (1 Hz step,
    // ~2000-value-wide) slider, which can easily land a couple Hz off.
    const targetMidi = noteToMidi(noteSelect.value, Number(octaveInput.value));
    const freq = Math.min(2000, Math.max(20, midiToFreq(targetMidi)));
    track.params.freq = Math.round(freq * 100) / 100;
    const freqSlider = tracksContainer.querySelector('input[data-param="freq"]');
    if (freqSlider) freqSlider.value = Math.round(track.params.freq);
    const freqValEl = tracksContainer.querySelector('[data-val-for="freq"]');
    if (freqValEl) freqValEl.textContent = `${Math.round(track.params.freq)} Hz`;
    scheduleSave();
  } else if (action === "chord-toggle") {
    track.chordMode = el.checked;
    if (track.chordMode && !Array.isArray(track.chordIntervals)) {
      track.chordIntervals = CHORD_TYPES[track.chordType || "major"].intervals.slice();
    }
    renderAll(); // show/hide the chord-type + tone fields
    scheduleSave();
  } else if (action === "chord-type") {
    track.chordType = el.value;
    const preset = CHORD_TYPES[el.value];
    if (preset && preset.intervals) {
      track.chordIntervals = preset.intervals.slice();
      renderAll(); // reflect the new tones in the text field
    }
    scheduleSave();
  } else if (action === "chord-intervals") {
    const parsed = el.value.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
    track.chordIntervals = parsed.length ? parsed : [0];
    track.chordType = "custom";
    scheduleSave();
  }
});

function syncFreqNoteField(freq) {
  const note = midiToNote(freqToMidi(freq));
  const noteSelect = tracksContainer.querySelector('select[data-action="freq-note"]');
  const octaveInput = tracksContainer.querySelector('input[data-action="freq-octave"]');
  if (noteSelect) noteSelect.value = note.name;
  if (octaveInput) octaveInput.value = note.octave;
}

// ---------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------

playBtn.addEventListener("click", () => {
  if (playing) stop();
  else start();
});

// Click or drag across the ruler to seek — ensureAudio() first so seeking
// works even before the first Play press (audioCtx.currentTime is needed
// by seekTo()/start() alike).
let scrubbingRuler = false;
function rulerIndexAt(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  const cell = el && el.closest(".ruler-cell");
  return cell ? Number(cell.dataset.rulerIndex) : -1;
}
stepsRuler.addEventListener("pointerdown", (e) => {
  const index = rulerIndexAt(e.clientX, e.clientY);
  if (index < 0) return;
  ensureAudio();
  scrubbingRuler = true;
  seekTo(index);
});
stepsRuler.addEventListener("pointermove", (e) => {
  if (!scrubbingRuler) return;
  const index = rulerIndexAt(e.clientX, e.clientY);
  if (index >= 0) seekTo(index);
});
window.addEventListener("pointerup", () => { scrubbingRuler = false; });

document.addEventListener("keydown", (e) => {
  if (e.code !== "Space") return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return; // don't hijack typing/scrubbing
  e.preventDefault();
  if (playing) stop();
  else start();
});

bpmInput.addEventListener("change", () => {
  const v = Number(bpmInput.value);
  state.bpm = Math.min(300, Math.max(40, v || 78));
  bpmInput.value = state.bpm;
  scheduleSave();
});

lengthSelect.addEventListener("change", () => {
  const v = Number(lengthSelect.value);
  state.patternLength = PATTERN_LENGTHS.includes(v) ? v : DEFAULT_PATTERN_LENGTH;
  currentStep = 0;
  setPlayheadColumn(-1);
  renderAll();
  statusText.textContent = `${state.tracks.length} tracks × ${state.patternLength} steps`;
  scheduleSave();
});

swingInput.addEventListener("change", () => {
  const v = Number(swingInput.value);
  state.swing = Math.min(MAX_SWING, Math.max(0, Number.isFinite(v) ? v : 0));
  swingInput.value = state.swing;
  scheduleSave();
});

addTrackBtn.addEventListener("click", () => {
  const index = state.tracks.length;
  state.tracks.push(makeTrack(index));
  openTrackId = index; // jump straight to the new track's panel so it's ready to configure
  renderAll();
  statusText.textContent = `${state.tracks.length} tracks × ${state.patternLength} steps`;
  scheduleSave();
});

importMidiBtn.addEventListener("click", () => midiFileInput.click());

midiFileInput.addEventListener("change", async () => {
  const file = midiFileInput.files[0];
  midiFileInput.value = ""; // reset so picking the same file again still fires "change"
  if (!file) return;
  if (!confirm(`Import "${file.name}"? This replaces all current tracks and the pattern.`)) return;
  try {
    const buffer = await file.arrayBuffer();
    const midi = parseMidi(buffer);
    console.log(`[MIDI import] ${file.name}: ticksPerQuarter=${midi.ticksPerQuarter} tempo=${midi.tempo}us numTracks=${midi.tracks.length}`);
    midi.tracks.forEach((t, i) => console.log(`  MTrk ${i} "${t.name}": ${t.events.length} events`, t.events.slice(0, 5)));
    const { bpm, tracks, truncated, stepCount } = midiToTracks(midi);
    console.log(`[MIDI import] stepCount=${stepCount} truncated=${truncated} sequencer tracks=${tracks.length}`);
    tracks.forEach((t) => console.log(`  "${t.name}" preset=${t.preset} onSteps=${t.steps.filter((s) => s.on).length}/${t.steps.length}`));
    if (!tracks.length) {
      alert("No usable notes found in the MIDI file. Open the browser console (F12) for details.");
      return;
    }
    const totalCells = stepCount * tracks.length;
    if (totalCells > 5000) {
      const proceed = confirm(
        `This file becomes ${tracks.length} tracks × ${stepCount} steps (${totalCells.toLocaleString("en-US")} cells in total) — ` +
        `that is a very large sequencer grid and may make the page slow to scroll and interact with. Continue anyway?`
      );
      if (!proceed) return;
    }
    tracks.forEach((t, i) => { t.id = i; });
    stop();
    state.bpm = Math.min(300, Math.max(40, bpm || state.bpm));
    if (stepCount > STEP_COUNT) STEP_COUNT = stepCount; // so a track added later has room too
    registerPatternLength(stepCount);
    state.patternLength = stepCount; // the whole file's length, not just a loop-window subset of it
    state.tracks = tracks;
    openTrackId = null;
    renderAll();
    statusText.textContent = `${state.tracks.length} tracks × ${state.patternLength} steps — imported from ${file.name}` +
      (truncated ? ` (truncated to ${MAX_IMPORT_STEPS} steps — the file is unusually long)` : "");
    scheduleSave();
  } catch (err) {
    console.error(err);
    alert("Could not read the MIDI file: " + err.message);
  }
});

clearBtn.addEventListener("click", () => {
  if (!confirm("Clear the whole pattern (all tracks)?")) return;
  for (const track of state.tracks) {
    for (const step of track.steps) step.on = false;
  }
  renderAll();
  scheduleSave();
});

resetBtn.addEventListener("click", () => {
  if (!confirm("Reset everything to the default setup? This cannot be undone.")) return;
  localStorage.removeItem(STORAGE_KEY);
  STEP_COUNT = 64; // undo any growth from a previous MIDI import
  PATTERN_LENGTHS = [16, 32, 64];
  state = makeDefaultState();
  openTrackId = null;
  currentStep = 0;
  stop();
  renderAll();
  statusText.textContent = `${state.tracks.length} tracks × ${state.patternLength} steps`;
});

window.addEventListener("beforeunload", () => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
});

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------

renderAll();
statusText.textContent = `${state.tracks.length} tracks × ${state.patternLength} steps`;
