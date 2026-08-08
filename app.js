"use strict";

/* =========================================================================
   SimpleSynthSeq
   64x64 step sequencer, rows = tracks (FM-synth voices), columns = steps.
   Parameters are edited per row (track) for now. The step-cell data model
   already reserves an `override` slot for future per-button parameter
   overrides (e.g. per-step tone), see makeStep() below.
   ========================================================================= */

const TRACK_COUNT = 64;
const STEP_COUNT = 64; // fixed storage size per track; pattern length only limits playback/display
const PATTERN_LENGTHS = [16, 32, 64];
const DEFAULT_PATTERN_LENGTH = 16;
const STEPS_PER_BEAT = 4; // 16th notes; every 4th step = a beat, every 16th = a bar
const STORAGE_KEY = "simplesynthseq-state-v1";

// ---------------------------------------------------------------------
// FM voice presets. Each is a full parameter set applied to a track.
// Engine = 2-op FM carrier/modulator + an optional filtered noise layer,
// with an amplitude envelope (A/D/S/R) and an optional pitch envelope
// (pitch drop, useful for kicks/toms).
// ---------------------------------------------------------------------
const PRESETS = {
  custom: {
    label: "Brugerdefineret", color: "#7a8092",
    carrierWave: "sine", modWave: "sine", freq: 220, modRatio: 1, modIndex: 0,
    pitchEnvAmount: 0, pitchEnvDecay: 0.05,
    attack: 0.001, decay: 0.2, sustain: 0, release: 0.1,
    noiseLevel: 0, noiseFilterType: "lowpass", noiseFilterFreq: 4000, noiseFilterQ: 1,
    volume: 0.7, pan: 0,
  },
  kick: {
    label: "Kick", color: "#f9a13a",
    carrierWave: "sine", modWave: "sine", freq: 55, modRatio: 1, modIndex: 40,
    pitchEnvAmount: 130, pitchEnvDecay: 0.045,
    attack: 0.001, decay: 0.28, sustain: 0, release: 0.05,
    noiseLevel: 0, noiseFilterType: "lowpass", noiseFilterFreq: 200, noiseFilterQ: 1,
    volume: 0.95, pan: 0,
  },
  snare: {
    label: "Snare", color: "#6d8dfd",
    carrierWave: "triangle", modWave: "square", freq: 190, modRatio: 1.5, modIndex: 55,
    pitchEnvAmount: 40, pitchEnvDecay: 0.02,
    attack: 0.001, decay: 0.13, sustain: 0, release: 0.05,
    noiseLevel: 0.55, noiseFilterType: "bandpass", noiseFilterFreq: 1800, noiseFilterQ: 0.8,
    volume: 0.85, pan: 0,
  },
  hihatClosed: {
    label: "Hi-hat lukket", color: "#3fb8b0",
    carrierWave: "square", modWave: "square", freq: 400, modRatio: 3.1, modIndex: 93,
    pitchEnvAmount: -283, pitchEnvDecay: 0.02,
    attack: 0.001, decay: 0.045, sustain: 0, release: 0.02,
    noiseLevel: 0.92, noiseFilterType: "highpass", noiseFilterFreq: 890, noiseFilterQ: 0.7,
    volume: 0.6, pan: 0,
  },
  hihatOpen: {
    label: "Hi-hat åben", color: "#57d6cd",
    carrierWave: "square", modWave: "square", freq: 400, modRatio: 3.1, modIndex: 20,
    pitchEnvAmount: 0, pitchEnvDecay: 0.02,
    attack: 0.001, decay: 0.28, sustain: 0, release: 0.12,
    noiseLevel: 0.7, noiseFilterType: "highpass", noiseFilterFreq: 7000, noiseFilterQ: 0.7,
    volume: 0.6, pan: 0,
  },
  clap: {
    label: "Clap", color: "#e069c4",
    carrierWave: "triangle", modWave: "sine", freq: 250, modRatio: 2, modIndex: 30,
    pitchEnvAmount: 0, pitchEnvDecay: 0.02,
    attack: 0.001, decay: 0.18, sustain: 0, release: 0.08,
    noiseLevel: 0.7, noiseFilterType: "bandpass", noiseFilterFreq: 1200, noiseFilterQ: 1.2,
    volume: 0.75, pan: 0,
  },
  tom: {
    label: "Tom", color: "#9b6df9",
    carrierWave: "sine", modWave: "sine", freq: 110, modRatio: 1, modIndex: 30,
    pitchEnvAmount: 70, pitchEnvDecay: 0.08,
    attack: 0.001, decay: 0.32, sustain: 0, release: 0.1,
    noiseLevel: 0.05, noiseFilterType: "lowpass", noiseFilterFreq: 2000, noiseFilterQ: 1,
    volume: 0.8, pan: 0,
  },
  cowbell: {
    label: "Cowbell", color: "#e0c93f",
    carrierWave: "square", modWave: "square", freq: 540, modRatio: 1.48, modIndex: 8,
    pitchEnvAmount: 0, pitchEnvDecay: 0.02,
    attack: 0.001, decay: 0.3, sustain: 0, release: 0.1,
    noiseLevel: 0, noiseFilterType: "bandpass", noiseFilterFreq: 800, noiseFilterQ: 1,
    volume: 0.6, pan: 0,
  },
  rimshot: {
    label: "Rimshot", color: "#4fd48a",
    carrierWave: "square", modWave: "square", freq: 400, modRatio: 2, modIndex: 50,
    pitchEnvAmount: 0, pitchEnvDecay: 0.02,
    attack: 0.001, decay: 0.06, sustain: 0, release: 0.03,
    noiseLevel: 0.3, noiseFilterType: "bandpass", noiseFilterFreq: 2500, noiseFilterQ: 1.5,
    volume: 0.7, pan: 0,
  },
};

// Default row-to-preset assignment for the first tracks so the app is
// useful out of the box; remaining tracks default to "custom" (silent
// until programmed).
const DEFAULT_TRACK_PRESETS = [
  "kick", "snare", "hihatClosed", "hihatOpen", "clap", "tom", "cowbell", "rimshot",
];

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------

function makeStep() {
  // `override` is reserved for future per-button parameter overrides
  // (e.g. a per-step tone/pitch), not yet used by the UI.
  return { on: false, velocity: 1, override: null };
}

function makeTrack(index) {
  const presetKey = DEFAULT_TRACK_PRESETS[index] || "custom";
  const preset = PRESETS[presetKey];
  return {
    id: index,
    name: preset.label + (DEFAULT_TRACK_PRESETS[index] ? "" : ` ${index + 1}`),
    preset: presetKey,
    params: { ...preset },
    mute: false,
    solo: false,
    volume: preset.volume,
    steps: Array.from({ length: STEP_COUNT }, makeStep),
  };
}

function makeDefaultState() {
  return {
    bpm: 120,
    patternLength: DEFAULT_PATTERN_LENGTH,
    tracks: Array.from({ length: TRACK_COUNT }, (_, i) => makeTrack(i)),
  };
}

let state = loadState() || makeDefaultState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.tracks) || parsed.tracks.length !== TRACK_COUNT) return null;
    if (!PATTERN_LENGTHS.includes(parsed.patternLength)) parsed.patternLength = DEFAULT_PATTERN_LENGTH;
    // Basic shape check passed; trust the rest.
    return parsed;
  } catch (e) {
    console.warn("Kunne ikke indlæse gemt tilstand", e);
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
      console.warn("Kunne ikke gemme tilstand", e);
    }
  }, 400);
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

function triggerVoice(track, time) {
  const p = track.params;
  const ctx = audioCtx;

  const audible = isAudible(track);
  if (!audible) return;

  const out = ctx.createGain();
  out.gain.value = track.volume;
  const panner = ctx.createStereoPanner();
  panner.pan.value = p.pan || 0;
  out.connect(panner).connect(masterGain);

  const attack = Math.max(0.001, p.attack);
  const decay = Math.max(0.001, p.decay);
  const release = Math.max(0.001, p.release);
  const sustainLevel = Math.min(1, Math.max(0, p.sustain));
  const noteEnd = time + attack + decay + release;
  const stopTime = noteEnd + 0.05;

  // --- FM carrier + modulator ---
  const carrier = ctx.createOscillator();
  carrier.type = p.carrierWave;
  const baseFreq = Math.max(1, p.freq);
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
  triggerVoice(track, audioCtx.currentTime + 0.02);
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
  while (nextStepTime < audioCtx.currentTime + SCHEDULE_AHEAD_S) {
    scheduleStep(currentStep, nextStepTime);
    nextStepTime += secondsPerStep();
    currentStep = (currentStep + 1) % state.patternLength;
  }
  schedulerTimer = setTimeout(schedulerTick, LOOKAHEAD_MS);
}

function scheduleStep(stepIndex, time) {
  for (const track of state.tracks) {
    const step = track.steps[stepIndex];
    if (step && step.on) triggerVoice(track, time);
  }
  const delayMs = Math.max(0, (time - audioCtx.currentTime) * 1000);
  setTimeout(() => setPlayheadColumn(stepIndex), delayMs);
}

function start() {
  ensureAudio();
  if (audioCtx.state === "suspended") audioCtx.resume();
  if (playing) return;
  playing = true;
  currentStep = 0;
  nextStepTime = audioCtx.currentTime + 0.05;
  schedulerTick();
  updatePlayButton();
}

function stop() {
  playing = false;
  clearTimeout(schedulerTimer);
  updatePlayButton();
  setPlayheadColumn(-1);
}

function updatePlayButton() {
  playBtn.textContent = playing ? "■ Stop" : "▶ Afspil";
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

function panelHtml(track) {
  const p = track.params;
  return `
    <div class="panel-grid">
      <div class="panel-field">
        <label>Navn</label>
        <input type="text" data-action="name" data-track="${track.id}" value="${escapeHtml(track.name)}">
      </div>
      <div class="panel-field">
        <label>Preset</label>
        <select data-action="preset" data-track="${track.id}">${presetOptionsHtml(track.preset)}</select>
      </div>
      ${fieldHtml(track, "carrierWave", "Bærebølge", { type: "select", options: waveOptions() })}
      ${fieldHtml(track, "modWave", "Modulator-bølge", { type: "select", options: waveOptions() })}
      ${fieldHtml(track, "freq", "Grundfrekvens (Hz)", { min: 20, max: 2000, step: 1, decimals: 0, suffix: " Hz" })}
      ${fieldHtml(track, "modRatio", "Mod. ratio", { min: 0.1, max: 8, step: 0.01, decimals: 2 })}
      ${fieldHtml(track, "modIndex", "Mod. index", { min: 0, max: 200, step: 1, decimals: 0 })}
      ${fieldHtml(track, "pitchEnvAmount", "Pitch-env mængde (Hz)", { min: -500, max: 500, step: 1, decimals: 0 })}
      ${fieldHtml(track, "pitchEnvDecay", "Pitch-env decay (s)", { min: 0.005, max: 1, step: 0.005, decimals: 3 })}
      ${fieldHtml(track, "attack", "Attack (s)", { min: 0.001, max: 1, step: 0.001, decimals: 3 })}
      ${fieldHtml(track, "decay", "Decay (s)", { min: 0.001, max: 2, step: 0.001, decimals: 3 })}
      ${fieldHtml(track, "sustain", "Sustain", { min: 0, max: 1, step: 0.01, decimals: 2 })}
      ${fieldHtml(track, "release", "Release (s)", { min: 0.001, max: 2, step: 0.001, decimals: 3 })}
      ${fieldHtml(track, "noiseLevel", "Støj-niveau", { min: 0, max: 1, step: 0.01, decimals: 2 })}
      ${fieldHtml(track, "noiseFilterType", "Støjfilter-type", { type: "select", options: filterOptions() })}
      ${fieldHtml(track, "noiseFilterFreq", "Støjfilter freq (Hz)", { min: 20, max: 15000, step: 10, decimals: 0, suffix: " Hz" })}
      ${fieldHtml(track, "noiseFilterQ", "Støjfilter Q", { min: 0.1, max: 20, step: 0.1, decimals: 1 })}
      ${fieldHtml(track, "pan", "Panorering", { min: -1, max: 1, step: 0.01, decimals: 2 })}
    </div>
    <div class="panel-actions">
      <button data-action="preview" data-track="${track.id}">🔊 Test lyd</button>
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
    const step = track.steps[i];
    const classes = ["step-btn"];
    if (i % (STEPS_PER_BEAT * 4) === 0) classes.push("beat-marker");
    if (step.on) classes.push("on");
    const style = step.on ? ` style="background:${preset.color}"` : "";
    stepsHtml += `<button class="${classes.join(" ")}" data-action="step" data-track="${track.id}" data-step="${i}"${style}></button>`;
  }
  return `
    <div class="track ${isOpen ? "open" : ""}" data-track-id="${track.id}">
      <div class="track-row">
        <div class="row-header">
          <div class="track-color" style="background:${preset.color}"></div>
          <div class="track-index">${track.id + 1}</div>
          <button class="track-name-btn" data-action="toggle-panel" data-track="${track.id}" title="Rediger FM-parametre">${escapeHtml(track.name)}</button>
          <button class="mini-btn mute-btn ${track.mute ? "active" : ""}" data-action="mute" data-track="${track.id}" title="Mute">M</button>
          <button class="mini-btn solo-btn ${track.solo ? "active" : ""}" data-action="solo" data-track="${track.id}" title="Solo">S</button>
          <input class="vol-range" type="range" min="0" max="1" step="0.01" value="${track.volume}" data-action="volume" data-track="${track.id}" title="Lydstyrke">
        </div>
        <div class="steps">${stepsHtml}</div>
      </div>
      <div class="track-panel">${isOpen ? panelHtml(track) : ""}</div>
    </div>
  `;
}

function renderAll() {
  renderRuler();
  tracksContainer.innerHTML = state.tracks.map(trackHtml).join("");
  bpmInput.value = state.bpm;
  lengthSelect.value = state.patternLength;
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
    if (btn) btn.textContent = track.name || `Spor ${trackIndex + 1}`;
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
    scheduleSave();
  }
});

// ---------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------

playBtn.addEventListener("click", () => {
  if (playing) stop();
  else start();
});

bpmInput.addEventListener("change", () => {
  const v = Number(bpmInput.value);
  state.bpm = Math.min(300, Math.max(40, v || 120));
  bpmInput.value = state.bpm;
  scheduleSave();
});

lengthSelect.addEventListener("change", () => {
  const v = Number(lengthSelect.value);
  state.patternLength = PATTERN_LENGTHS.includes(v) ? v : DEFAULT_PATTERN_LENGTH;
  currentStep = 0;
  setPlayheadColumn(-1);
  renderAll();
  statusText.textContent = `${TRACK_COUNT} spor × ${state.patternLength} skridt`;
  scheduleSave();
});

clearBtn.addEventListener("click", () => {
  if (!confirm("Ryd hele mønsteret (alle spor)?")) return;
  for (const track of state.tracks) {
    for (const step of track.steps) step.on = false;
  }
  renderAll();
  scheduleSave();
});

resetBtn.addEventListener("click", () => {
  if (!confirm("Nulstil alt til standardopsætning? Dette kan ikke fortrydes.")) return;
  localStorage.removeItem(STORAGE_KEY);
  state = makeDefaultState();
  openTrackId = null;
  currentStep = 0;
  stop();
  renderAll();
  statusText.textContent = `${TRACK_COUNT} spor × ${state.patternLength} skridt`;
});

window.addEventListener("beforeunload", () => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
});

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------

renderAll();
statusText.textContent = `${TRACK_COUNT} spor × ${state.patternLength} skridt`;
