/* ============================================================
   Talk to Robot: page controller
   Keyboard and on-screen piano -> sung syllables; text box ->
   spoken phrases; live readouts, pitch trace and spectrum.
   ============================================================ */

import { Performer } from "./performer.js";
import { HeadView } from "./head-view.js";
import { toSyllables, frameFor } from "./articulation.js";

const $ = (s) => document.querySelector(s);

/* physical key -> semitone above the octave's C (layout independent) */
const KEYS = [
  ["KeyA", 0, "A"], ["KeyW", 1, "W"], ["KeyS", 2, "S"], ["KeyE", 3, "E"], ["KeyD", 4, "D"],
  ["KeyF", 5, "F"], ["KeyT", 6, "T"], ["KeyG", 7, "G"], ["KeyY", 8, "Y"], ["KeyH", 9, "H"],
  ["KeyU", 10, "U"], ["KeyJ", 11, "J"], ["KeyK", 12, "K"], ["KeyO", 13, "O"], ["KeyL", 14, "L"],
  ["KeyP", 15, "P"], ["Semicolon", 16, ";"],
];
const KEY_SEMI = new Map(KEYS.map(([code, semi]) => [code, semi]));
const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const BLACK = new Set([1, 3, 6, 8, 10]);

const robot = new Performer();
const view = new HeadView($("#stage"));

let octave = 3;
let syllables = [];
let lyricIndex = 0;
let lastPhone = null;
const held = []; // stack of { code, semi }

/* ---------- helpers ---------- */
const midiOf = (semi) => 12 * (octave + 1) + semi;
const freqOf = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
const noteName = (midi) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
const typing = (el) => el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && el.type === "text") || el.isContentEditable);

/* ---------- wake ---------- */
const wakeBtn = $("#wake");
const stageWrap = $(".rb-stage");

async function wake() {
  if (robot.running) return;
  wakeBtn.disabled = true;
  wakeBtn.querySelector("span").textContent = "Waking up…";
  try {
    await robot.start();
    pushParams();
    stageWrap.classList.add("is-awake");
    $("#status").textContent = "Robot is awake. Play the keys.";
  } catch (err) {
    console.error(err);
    wakeBtn.disabled = false;
    wakeBtn.querySelector("span").textContent = "Audio failed. Try again";
    $("#status").textContent = "This browser could not start the audio engine.";
  }
}
wakeBtn.addEventListener("click", wake);

/* ---------- lyrics ---------- */
const lyricsEl = $("#lyrics");
const chipsEl = $("#chips");
const songEl = $("#song");

/* Default songs: an original, plus a public-domain nursery rhyme.
   English is respelled the Turkish way so the robot reads it right. */
const SONGS = {
  robot: "Bip bop, ben bir robotum,\nKalbim yok ama şarkım var.\nTuşa bas, sesim yükselsin,\nGel birlikte söyleyelim.\nLa la la, lay lay lom.",
  twinkle: "Tüvinkıl, tüvinkıl, litıl star,\nHav ay vandır vat yu ar.\nAp ıbav dı vörld so hay,\nLayk ı dayımınd in dı skay.",
  hello: "Helo! Ay em e robot.\nPley mi vit yor kibord,\nend ay vil sing for yu.",
};

songEl.addEventListener("change", () => {
  const text = SONGS[songEl.value];
  if (text === undefined) return;
  lyricsEl.value = text;
  lyricIndex = 0;
  parseLyrics();
});

function parseLyrics() {
  syllables = toSyllables(lyricsEl.value);
  if (lyricIndex >= syllables.length) lyricIndex = 0;
  renderChips();
}

function renderChips() {
  chipsEl.textContent = "";
  const frag = document.createDocumentFragment();
  syllables.forEach((s, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rb-chip";
    if (s.wordEnd) b.classList.add("is-word-end");
    b.textContent = s.text;
    b.dataset.i = i;
    b.title = "Sing from here";
    frag.appendChild(b);
  });
  chipsEl.appendChild(frag);
  markChips();
}

function markChips(sounding = -1) {
  for (const c of chipsEl.children) {
    const i = Number(c.dataset.i);
    c.classList.toggle("is-next", i === lyricIndex && sounding < 0);
    c.classList.toggle("is-on", i === sounding);
  }
  const target = chipsEl.children[sounding >= 0 ? sounding : lyricIndex];
  if (target) {
    const top = target.offsetTop - chipsEl.offsetTop;
    if (top < chipsEl.scrollTop || top > chipsEl.scrollTop + chipsEl.clientHeight - 30) {
      chipsEl.scrollTop = top - 8;
    }
  }
}

chipsEl.addEventListener("click", (e) => {
  const b = e.target.closest(".rb-chip");
  if (!b) return;
  lyricIndex = Number(b.dataset.i);
  markChips();
});

let parseTimer = 0;
lyricsEl.addEventListener("input", () => {
  songEl.value = "custom";
  clearTimeout(parseTimer);
  parseTimer = setTimeout(parseLyrics, 150);
});

/* ---------- singing from keys ---------- */
async function noteOn(code) {
  const semi = KEY_SEMI.get(code);
  if (semi === undefined || held.some((h) => h.code === code)) return;
  if (!robot.running) await wake();
  if (!robot.running) return;
  held.push({ code, semi });
  setKeyDown(code, true);

  const midi = midiOf(semi);
  const syl = syllables.length ? syllables[lyricIndex % syllables.length] : { text: "la", onset: ["l"], nucleus: "a", coda: [] };
  const sounding = syllables.length ? lyricIndex % syllables.length : -1;
  robot.sing(syl, freqOf(midi));
  view.setLabel(syl.text);
  if (syllables.length) lyricIndex = (lyricIndex + 1) % syllables.length;
  markChips(sounding);
}

function noteOff(code) {
  const at = held.findIndex((h) => h.code === code);
  if (at < 0) return;
  const wasTop = at === held.length - 1;
  held.splice(at, 1);
  setKeyDown(code, false);
  if (!wasTop) return;
  if (held.length) {
    robot.bend(freqOf(midiOf(held[held.length - 1].semi)));
  } else {
    robot.release();
    markChips();
  }
}

function releaseAll() {
  for (const h of [...held]) noteOff(h.code);
}

document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (typing(document.activeElement)) {
    if (e.key === "Escape") document.activeElement.blur();
    return;
  }
  if (KEY_SEMI.has(e.code)) {
    e.preventDefault();
    if (!e.repeat) noteOn(e.code);
    return;
  }
  switch (e.code) {
    case "KeyZ": e.preventDefault(); setOctave(octave - 1); break;
    case "KeyX": e.preventDefault(); setOctave(octave + 1); break;
    case "Enter": e.preventDefault(); lyricIndex = 0; markChips(); break;
    case "Escape": releaseAll(); robot.stop(); break;
  }
});
document.addEventListener("keyup", (e) => { if (KEY_SEMI.has(e.code)) noteOff(e.code); });
window.addEventListener("blur", releaseAll);
document.addEventListener("visibilitychange", () => { if (document.hidden) releaseAll(); });

/* ---------- on-screen piano ---------- */
const piano = $("#piano");
const keyEls = new Map();

function buildPiano() {
  const whites = KEYS.filter(([, s]) => !BLACK.has(s % 12));
  piano.style.setProperty("--whites", whites.length);
  let wi = 0;
  for (const [code, semi, label] of KEYS) {
    const black = BLACK.has(semi % 12);
    const b = document.createElement("button");
    b.type = "button";
    b.className = `rb-key ${black ? "is-black" : "is-white"}`;
    b.dataset.code = code;
    if (black) b.style.setProperty("--at", wi);
    else b.style.setProperty("--i", wi++);
    b.innerHTML = `<span class="rb-key-letter">${label}</span><span class="rb-key-note"></span>`;
    keyEls.set(code, b);
    piano.appendChild(b);
  }
  labelPiano();

  const active = new Map(); // pointerId -> code
  piano.addEventListener("pointerdown", (e) => {
    const k = e.target.closest(".rb-key");
    if (!k) return;
    e.preventDefault();
    piano.setPointerCapture?.(e.pointerId);
    active.set(e.pointerId, k.dataset.code);
    noteOn(k.dataset.code);
  });
  piano.addEventListener("pointermove", (e) => {
    if (!active.has(e.pointerId)) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest(".rb-key");
    const prev = active.get(e.pointerId);
    if (el && el.dataset.code !== prev) {
      active.set(e.pointerId, el.dataset.code);
      noteOn(el.dataset.code);
      noteOff(prev);
    }
  });
  const up = (e) => {
    const code = active.get(e.pointerId);
    if (code) { active.delete(e.pointerId); noteOff(code); }
  };
  piano.addEventListener("pointerup", up);
  piano.addEventListener("pointercancel", up);
  piano.addEventListener("contextmenu", (e) => e.preventDefault());
}

function labelPiano() {
  for (const [code, semi] of KEYS) {
    const el = keyEls.get(code);
    const midi = midiOf(semi);
    el.querySelector(".rb-key-note").textContent = BLACK.has(semi % 12) ? "" : noteName(midi);
    el.setAttribute("aria-label", `${noteName(midi)}, key ${code.replace("Key", "")}`);
  }
}

function setKeyDown(code, down) {
  keyEls.get(code)?.classList.toggle("is-down", down);
}

/* ---------- octave ---------- */
function setOctave(o) {
  octave = Math.max(1, Math.min(5, o));
  $("#octave-val").textContent = `C${octave}`;
  labelPiano();
}
$("#octave-down").addEventListener("click", () => setOctave(octave - 1));
$("#octave-up").addEventListener("click", () => setOctave(octave + 1));

/* ---------- voice controls ---------- */
const controls = {
  tone: $("#tone"),
  vibrato: $("#vibrato"),
  glide: $("#glide"),
  volume: $("#volume"),
};
function pushParams() {
  robot.setParams({
    tense: Number(controls.tone.value) / 100,
    vibrato: Number(controls.vibrato.value) / 1000,
    glide: Number(controls.glide.value) / 1000,
    volume: Number(controls.volume.value) / 100,
  });
}
for (const el of Object.values(controls)) el.addEventListener("input", pushParams);

const PRESETS = {
  robot: { tone: 88, vibrato: 0, glide: 12 },
  singer: { tone: 66, vibrato: 14, glide: 60 },
  breathy: { tone: 42, vibrato: 6, glide: 40 },
};
document.querySelectorAll("[data-preset]").forEach((b) =>
  b.addEventListener("click", () => {
    const p = PRESETS[b.dataset.preset];
    for (const [k, v] of Object.entries(p)) controls[k].value = v;
    document.querySelectorAll("[data-preset]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    pushParams();
  })
);

/* ---------- speak ---------- */
$("#speak").addEventListener("click", async () => {
  await wake();
  if (!robot.running) return;
  parseLyrics();
  releaseAll();
  robot.speak(syllables, { base: 118 * Math.pow(2, octave - 3) });
});
$("#stop").addEventListener("click", () => { releaseAll(); robot.stop(); markChips(); });
$("#restart").addEventListener("click", () => { lyricIndex = 0; markChips(); });

robot.addEventListener("syllable", (e) => {
  const i = e.detail.index;
  if (i >= 0) { view.setLabel(syllables[i]?.text); markChips(i); }
  else markChips();
});
robot.addEventListener("phone", (e) => { lastPhone = e.detail; });

/* ---------- readouts and scopes ---------- */
const ro = {
  syl: $("#ro-syl"), vowel: $("#ro-vowel"), jaw: $("#ro-jaw"),
  lips: $("#ro-lips"), velum: $("#ro-velum"), pitch: $("#ro-pitch"),
};
const setText = (el, v) => { if (el.textContent !== v) el.textContent = v; };

const pitchCanvas = $("#pitch-graph");
const specCanvas = $("#spectrum");
const pitchHist = new Float32Array(240);
let specData = null;

function fit(canvas) {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: r.width, h: r.height };
}

const LO = Math.log2(55), HI = Math.log2(1100);
function drawPitch(state) {
  pitchHist.copyWithin(0, 1);
  pitchHist[pitchHist.length - 1] = state && state.voice > 0.08 ? state.freq : 0;
  const { ctx, w, h } = fit(pitchCanvas);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(164, 173, 184, 0.14)";
  ctx.lineWidth = 1;
  ctx.font = "10px Geist Mono, ui-monospace, monospace";
  ctx.fillStyle = "rgba(164, 173, 184, 0.5)";
  for (let o = 2; o <= 5; o++) {
    const y = h - ((Math.log2(freqOf(12 * (o + 1))) - LO) / (HI - LO)) * h;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    ctx.fillText(`C${o}`, 4, y - 3);
  }
  ctx.strokeStyle = "#C6F222";
  ctx.lineWidth = 2;
  ctx.beginPath();
  let pen = false;
  for (let i = 0; i < pitchHist.length; i++) {
    const f = pitchHist[i];
    if (!f) { pen = false; continue; }
    const x = (i / (pitchHist.length - 1)) * w;
    const y = h - ((Math.log2(f) - LO) / (HI - LO)) * h;
    if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    pen = true;
  }
  ctx.stroke();
}

function drawSpectrum() {
  const { ctx, w, h } = fit(specCanvas);
  ctx.clearRect(0, 0, w, h);
  const an = robot.analyser;
  ctx.strokeStyle = "rgba(164, 173, 184, 0.14)";
  ctx.font = "10px Geist Mono, ui-monospace, monospace";
  ctx.fillStyle = "rgba(164, 173, 184, 0.5)";
  for (const k of [1, 2, 3, 4]) {
    const x = (k / 5) * w;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    ctx.fillText(`${k}k`, x + 3, h - 4);
  }
  if (!an) return;
  if (!specData) specData = new Uint8Array(an.frequencyBinCount);
  an.getByteFrequencyData(specData);
  const maxBin = Math.floor((5000 / (robot.ctx.sampleRate / 2)) * specData.length);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(198, 242, 34, 0.35)");
  grad.addColorStop(1, "rgba(198, 242, 34, 0)");
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let i = 0; i < maxBin; i++) {
    const x = (i / maxBin) * w;
    const y = h - (specData[i] / 255) * h * 0.95;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = "#C6F222";
  ctx.lineWidth = 1.25;
  ctx.stroke();
}

function updateReadouts(state) {
  if (lastPhone?.label) setText(ro.syl, lastPhone.label);
  if (lastPhone?.info) setText(ro.vowel, lastPhone.info.vowel);
  if (state?.shape) {
    const d = state.shape;
    let jaw = 0; for (let i = 33; i < 39; i++) jaw += d[i];
    let lips = 0; for (let i = 40; i < 44; i++) lips += d[i];
    setText(ro.jaw, (jaw / 6).toFixed(1));
    setText(ro.lips, (lips / 4).toFixed(1));
    const open = state.velum > 0.12;
    setText(ro.velum, open ? "OPEN" : "SHUT");
    ro.velum.classList.toggle("is-open", open);
    if (state.voice > 0.08) {
      const midi = 69 + 12 * Math.log2(state.freq / 440);
      setText(ro.pitch, `${noteName(Math.round(midi))} · ${Math.round(state.freq)} Hz`);
    }
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const state = robot.state;
  view.draw(state || idleState, dt);
  updateReadouts(state);
  drawPitch(state);
  drawSpectrum();
  requestAnimationFrame(frame);
}

/* a resting shape so the head is drawn before audio starts */
const idleState = { shape: frameFor("e").shape, velum: 0.01, voice: 0, freq: 120 };

/* ---------- boot ---------- */
buildPiano();
setOctave(3);
parseLyrics();
requestAnimationFrame(frame);
