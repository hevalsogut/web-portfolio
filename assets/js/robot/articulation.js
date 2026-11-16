/* ============================================================
   Talk to Robot: articulation
   Turns letters into vocal-tract shapes. Each vowel is a tongue
   position (index along the tract, how close it rises to the
   palate) plus lip rounding; each consonant adds a constriction
   on top of the neighbouring vowel's tongue shape, with voicing,
   nasal airflow and turbulence noise.
   Spelling is read the Turkish way (one letter, one sound), which
   also gives a fair robotic read of most English words.
   ============================================================ */

import { N, BLADE_START, TIP_START, LIP_START, restDiameter } from "./voice-dsp.js";

/* ---------- vowels ---------- */
// ti: tongue index (12 = back/pharynx, 28 = front/palate)
// td: tongue diameter (2.0 = high, close to palate; 3.4 = low, open)
// lips: lip opening when rounded (null = spread / neutral)
// Tuned by grid search so F1/F2 land on Turkish vowel formants
// (a 700/1250, e 500/1850, ı 380/1450, i 300/2250, o 500/900,
//  ö 460/1550, u 330/850, ü 320/1750 Hz).
export const VOWELS = {
  a: { ti: 18, td: 2.65, lips: null },
  e: { ti: 26, td: 2.95, lips: null },
  ı: { ti: 22, td: 2.05, lips: null },
  i: { ti: 27, td: 2.2, lips: null },
  o: { ti: 17, td: 2.35, lips: 0.7 },
  ö: { ti: 25, td: 2.8, lips: 1.1 },
  u: { ti: 17, td: 2.35, lips: 0.5 },
  ü: { ti: 28, td: 2.5, lips: 0.9 },
};
export const NEUTRAL = { ti: 18, td: 2.9, lips: null };

/* ---------- consonants ----------
   at: constriction index, d: constriction diameter,
   voice: voicing 0..1, nasal: open velum, noise: turbulence amount,
   breath: aspiration (h), dur: ms, post: phoneme appended after release */
const LIPS = 41;
const ALV = 35.5;
const POST = 33.5;
const VEL = 23;

export const CONSONANTS = {
  b: { at: LIPS, d: 0, voice: 0.6, dur: 60 },
  p: { at: LIPS, d: 0, voice: 0, dur: 75, post: "ʰ" },
  m: { at: LIPS, d: 0, voice: 1, nasal: true, dur: 75 },
  f: { at: LIPS, d: 0.42, voice: 0, noise: 1.6, dur: 110 },
  v: { at: LIPS, d: 0.55, voice: 1, noise: 0.4, dur: 60 },
  d: { at: ALV, d: 0, voice: 0.6, dur: 55 },
  t: { at: ALV, d: 0, voice: 0, dur: 70, post: "ʰ" },
  n: { at: ALV, d: 0, voice: 1, nasal: true, dur: 70 },
  s: { at: ALV + 1, d: 0.4, voice: 0, noise: 2.2, dur: 125 },
  z: { at: ALV + 1, d: 0.45, voice: 1, noise: 1.4, dur: 95 },
  ş: { at: POST, d: 0.42, voice: 0, noise: 2.2, lips: 0.9, dur: 125 },
  j: { at: POST, d: 0.45, voice: 1, noise: 1.4, lips: 0.9, dur: 95 },
  "tʃ": { at: POST, d: 0, voice: 0, dur: 55 },
  "dʒ": { at: POST, d: 0, voice: 0.6, dur: 50 },
  k: { at: VEL, d: 0, voice: 0, dur: 80, post: "ʰ" },
  g: { at: VEL, d: 0, voice: 0.6, dur: 55 },
  l: { at: ALV - 1, d: 0.75, voice: 1, dur: 60 },
  r: { at: ALV, d: 0.34, voice: 1, noise: 0.5, dur: 55 },
  y: { glide: { ti: 27, td: 2.02 }, voice: 1, dur: 55 },
  h: { breath: 1, voice: 0, dur: 75 },
  "ʰ": { breath: 0.7, voice: 0, dur: 35 },
};

/* letters that expand into more than one phoneme */
const LETTER_PHONES = {
  ç: ["tʃ", "ş"],
  c: ["dʒ", "j"],
  ğ: [],
  q: ["k"],
  w: ["v"],
  x: ["k", "s"],
};

const VOWEL_SET = new Set(Object.keys(VOWELS));
export const isVowel = (ch) => VOWEL_SET.has(ch);

/* ---------- build a target tract shape ---------- */
function applyConstriction(d, index, diameter) {
  let width;
  if (index < 25) width = 10;
  else if (index >= TIP_START) width = 5;
  else width = 10 - (5 * (index - 25)) / (TIP_START - 25);
  const intIndex = Math.round(index);
  for (let k = -Math.ceil(width) - 1; k < width + 1; k++) {
    const i = intIndex + k;
    if (i < 0 || i >= N) continue;
    const relpos = Math.abs(i - index) - 0.5;
    let shrink;
    if (relpos <= 0) shrink = 0;
    else if (relpos > width) shrink = 1;
    else shrink = 0.5 * (1 - Math.cos((Math.PI * relpos) / width));
    if (diameter < d[i]) d[i] = diameter + (d[i] - diameter) * shrink;
  }
}

export function buildShape({ ti, td, lips, at, d: cd }) {
  const d = new Float32Array(N);
  for (let i = 0; i < N; i++) d[i] = restDiameter(i);
  for (let i = BLADE_START; i < LIP_START; i++) {
    const t = (1.1 * Math.PI * (ti - i)) / (TIP_START - BLADE_START);
    const fixed = 2 + (td - 2) / 1.5;
    let curve = (1.5 - fixed + 1.7) * Math.cos(t);
    if (i === LIP_START - 1) curve *= 0.8;
    if (i === BLADE_START || i === LIP_START - 2) curve *= 0.94;
    d[i] = 1.5 - curve;
  }
  if (lips != null) {
    for (let i = LIP_START; i < N; i++) {
      const k = i === LIP_START ? 0.5 : 1;
      d[i] = Math.min(d[i], lips * k + d[i] * (1 - k));
    }
  }
  if (at != null) applyConstriction(d, at, cd);
  return d;
}

/* One articulation frame, ready to send to the engine */
export function frameFor(phone, vowelCtx) {
  const v = vowelCtx || NEUTRAL;
  if (isVowel(phone)) {
    const sh = VOWELS[phone];
    return {
      shape: buildShape(sh), velum: 0.01, voice: 1, breath: 0, noise: [],
      info: { vowel: phone, ti: sh.ti, td: sh.td },
    };
  }
  const c = CONSONANTS[phone];
  if (!c) return null;
  const tongue = c.glide || v;
  const lips = c.lips ?? v.lips ?? null;
  const shape = buildShape({ ti: tongue.ti, td: tongue.td, lips, at: c.at, d: c.d });
  const noise = [];
  if (c.at != null) noise.push({ index: c.at, amt: c.noise ?? 0.6 });
  return {
    shape,
    velum: c.nasal ? 0.4 : 0.01,
    voice: c.voice ?? 0,
    breath: c.breath ?? 0,
    noise,
    info: { vowel: vowelLabel(v), ti: tongue.ti, td: tongue.td },
  };
}

function vowelLabel(v) {
  for (const [k, s] of Object.entries(VOWELS)) if (s === v) return k;
  return "ə";
}

/* ---------- text -> syllables ---------- */
export function normalize(text) {
  return text
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .toLocaleLowerCase("tr")
    .replace(/[âà]/g, "a")
    .replace(/[îì]/g, "i")
    .replace(/[ûù]/g, "u")
    .replace(/[é]/g, "e");
}

const LETTER_RE = /[a-zçğıöşü]/;

/* Split into words and punctuation, then each word into syllables
   by the Turkish rule: one vowel per syllable; between two vowels a
   single consonant starts the next syllable, a cluster splits
   before its last consonant. */
export function toSyllables(text) {
  const t = normalize(text);
  const out = [];
  let word = "";
  const flush = () => {
    if (!word) return;
    const syls = syllabifyWord(word);
    syls.forEach((s, i) => out.push({ text: s, wordEnd: i === syls.length - 1, pause: 0 }));
    word = "";
  };
  for (const ch of t) {
    if (LETTER_RE.test(ch)) { word += ch; continue; }
    flush();
    const last = out[out.length - 1];
    if (!last) continue;
    if (/[.!?;:\n]/.test(ch)) { last.pause = Math.max(last.pause, 420); if (ch === "?") last.question = true; }
    else if (/[,–—-]/.test(ch)) last.pause = Math.max(last.pause, 220);
  }
  flush();
  return out.map((s) => ({ ...s, ...splitSyllable(s.text) }));
}

export function syllabifyWord(w) {
  const chars = [...w];
  const vpos = chars.map((c, i) => (isVowel(c) ? i : -1)).filter((i) => i >= 0);
  if (vpos.length < 2) return [w];
  const cuts = [];
  for (let k = 1; k < vpos.length; k++) {
    const cons = vpos[k] - vpos[k - 1] - 1;
    cuts.push(cons === 0 ? vpos[k] : vpos[k] - 1);
  }
  const syls = [];
  let start = 0;
  for (const c of cuts) { syls.push(chars.slice(start, c).join("")); start = c; }
  syls.push(chars.slice(start).join(""));
  return syls;
}

/* onset consonants, nucleus vowel, coda consonants, as phoneme ids */
export function splitSyllable(syl) {
  const chars = [...syl];
  const vi = chars.findIndex(isVowel);
  const toPhones = (arr) => arr.flatMap((c) => LETTER_PHONES[c] ?? (CONSONANTS[c] ? [c] : []));
  if (vi < 0) {
    // no vowel ("hmm", "pst"): sustain the last consonant as the nucleus
    const ph = toPhones(chars);
    return { onset: ph.slice(0, -1), nucleus: ph[ph.length - 1] || null, coda: [] };
  }
  return {
    onset: toPhones(chars.slice(0, vi)),
    nucleus: chars[vi],
    coda: toPhones(chars.slice(vi + 1)),
  };
}

export function consonantDur(phone) {
  return CONSONANTS[phone]?.dur ?? 60;
}
export function postPhone(phone) {
  return CONSONANTS[phone]?.post;
}
