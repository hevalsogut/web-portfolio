/* ============================================================
   Talk to Robot: performer
   Owns the AudioContext and turns syllables into a timed series
   of articulation frames: onset consonants, a held vowel, coda
   consonants, then rest. Emits "phone" events so the UI can show
   what the robot is saying.
   ============================================================ */

import { VOWELS, NEUTRAL, frameFor, consonantDur, postPhone, isVowel } from "./articulation.js";

const WORKLET_URL = "/assets/js/robot/voice-worklet.js";

export class Performer extends EventTarget {
  constructor() {
    super();
    this.ctx = null;
    this.node = null;
    this.analyser = null;
    this.state = null;
    this.timers = new Set();
    this.vowelAt = 0;
    this.current = null; // syllable being sung
    this.speed = 1;
    this.ready = null;
  }

  /* ---------- audio setup (needs a user gesture) ---------- */
  start() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: "interactive" });
      await this.ctx.audioWorklet.addModule(WORKLET_URL);
      this.node = new AudioWorkletNode(this.ctx, "robot-voice", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.6;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.ratio.value = 4;
      this.node.connect(comp).connect(this.ctx.destination);
      comp.connect(this.analyser);
      this.node.port.onmessage = (e) => { this.state = e.data; };
      if (this.ctx.state !== "running") await this.ctx.resume();
    })();
    return this.ready;
  }

  get running() { return !!this.node; }

  post(msg) { if (this.node) this.node.port.postMessage(msg); }

  setParams(p) { this.post({ type: "params", ...p }); }

  pitch(freq, jump = false) { this.post({ type: "pitch", freq, jump }); }

  /* ---------- timing helpers ---------- */
  at(ms, fn) {
    const id = setTimeout(() => { this.timers.delete(id); fn(); }, ms);
    this.timers.add(id);
  }
  clear() {
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
  }

  /* ---------- articulation ---------- */
  say(phone, vowelCtx, label) {
    const f = frameFor(phone, vowelCtx);
    if (!f) return;
    this.post({ type: "frame", shape: f.shape, velum: f.velum, voice: f.voice, breath: f.breath, noise: f.noise });
    this.emit({ phone, label, info: f.info });
  }

  rest(vowelCtx) {
    const f = frameFor(vowelCtx ? vowelKey(vowelCtx) : "ə", vowelCtx) || frameFor("e");
    this.post({ type: "frame", shape: f.shape, velum: 0.01, voice: 0, breath: 0, noise: [] });
    this.emit({ phone: null, label: null, info: f.info });
  }

  emit(detail) { this.dispatchEvent(new CustomEvent("phone", { detail })); }

  /* Schedule onset consonants starting at t, return when the nucleus starts */
  scheduleOnset(syl, t0, scale) {
    const v = VOWELS[syl.nucleus] || NEUTRAL;
    let t = t0;
    for (const ph of syl.onset) {
      this.at(t, () => this.say(ph, v, syl.text));
      t += consonantDur(ph) * scale;
      const post = postPhone(ph);
      if (post) {
        this.at(t, () => this.say(post, v, syl.text));
        t += consonantDur(post) * scale;
      }
    }
    if (syl.nucleus) this.at(t, () => this.say(syl.nucleus, v, syl.text));
    return t;
  }

  scheduleCoda(syl, t0, scale) {
    const v = VOWELS[syl.nucleus] || NEUTRAL;
    let t = t0;
    for (const ph of syl.coda) {
      this.at(t, () => this.say(ph, v, syl.text));
      t += consonantDur(ph) * scale;
      const post = postPhone(ph);
      if (post) {
        this.at(t, () => this.say(post, v, syl.text));
        t += consonantDur(post) * scale;
      }
    }
    return t;
  }

  /* ---------- keyboard singing ---------- */
  sing(syl, freq) {
    this.clear();
    const legato = this.current !== null;
    this.pitch(freq, !legato);
    this.current = syl;
    const t = this.scheduleOnset(syl, 0, 0.85);
    this.vowelAt = performance.now() + t;
  }

  /* Change pitch on the held vowel without a new syllable */
  bend(freq) { this.pitch(freq); }

  release() {
    const syl = this.current;
    this.current = null;
    if (!syl) return;
    // let the vowel sound for at least a moment, even on a quick tap
    const wait = Math.max(0, this.vowelAt - performance.now()) + 70;
    const end = this.scheduleCoda(syl, wait, 0.85);
    this.at(end, () => this.rest(VOWELS[syl.nucleus]));
  }

  /* ---------- text to speech, robot style ---------- */
  speak(syllables, { base = 118 } = {}) {
    this.stop();
    if (!syllables.length) return;
    const scale = 1 / this.speed;
    let t = 0;
    // phrase boundaries for pitch declination
    let phraseStart = 0;
    syllables.forEach((syl, i) => {
      if (i > 0 && syllables[i - 1].pause >= 400) phraseStart = i;
      let end = i;
      while (end < syllables.length - 1 && syllables[end].pause < 400) end++;
      const len = Math.max(1, end - phraseStart);
      const pos = (i - phraseStart) / len;
      let f = base * (1.12 - 0.22 * pos);
      if (syl.wordEnd) f *= 1.08; // Turkish words lean on the last syllable
      if (syl.question && i === end) f *= 1.35;

      this.at(t, () => this.pitch(f, i === phraseStart));
      this.at(t, () => this.dispatchEvent(new CustomEvent("syllable", { detail: { index: i } })));
      t = this.scheduleOnset(syl, t, scale);
      t += (syl.wordEnd ? 200 : 150) * scale;
      t = this.scheduleCoda(syl, t, scale);
      if (syl.pause) {
        const v = VOWELS[syl.nucleus];
        this.at(t, () => this.rest(v));
        t += syl.pause * scale;
      }
    });
    const last = syllables[syllables.length - 1];
    this.at(t, () => {
      this.rest(VOWELS[last.nucleus]);
      this.dispatchEvent(new CustomEvent("syllable", { detail: { index: -1 } }));
    });
  }

  stop() {
    this.clear();
    this.current = null;
    this.post({ type: "silence" });
    this.emit({ phone: null, label: null, info: null });
  }
}

function vowelKey(shape) {
  for (const [k, v] of Object.entries(VOWELS)) if (v === shape) return k;
  return "e";
}

export { isVowel };
