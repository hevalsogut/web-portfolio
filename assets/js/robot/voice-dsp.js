/* ============================================================
   Talk to Robot: articulatory voice engine
   A glottal source (Liljencrants-Fant pulse + breath noise) feeding
   a 44-segment Kelly-Lochbaum waveguide vocal tract with a nasal
   branch. The tract shape is a list of tube diameters from the
   glottis (index 0) to the lips (index 43); moving those
   diameters is what makes vowels and consonants.
   Pure DSP: no Web Audio here, so it also runs in Node for tests.
   ============================================================ */

export const N = 44;
export const NOSE_LEN = 28;
export const NOSE_START = N - NOSE_LEN + 1; // 17: where the velum joins
export const BLADE_START = 10;
export const TIP_START = 32;
export const LIP_START = 39;

const GLOTTAL_REFLECTION = 0.75;
const LIP_REFLECTION = -0.85;
const FADE = 0.999;
const MOVEMENT_SPEED = 18; // diameter units per second

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const moveTowards = (cur, target, up, down) =>
  cur < target ? Math.min(cur + up, target) : Math.max(cur - down, target);

/* Rest shape of the tube: narrow larynx, wider pharynx and mouth */
export function restDiameter(i) {
  if (i < 7 * N / 44 - 0.5) return 0.6;
  if (i < 12 * N / 44 - 0.5) return 1.1;
  return 1.5;
}

class Bandpass {
  constructor(freq, q, sr) {
    const w = (2 * Math.PI * freq) / sr;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b2 = -alpha / a0;
    this.a1 = (-2 * Math.cos(w)) / a0;
    this.a2 = (1 - alpha) / a0;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
  process(x) {
    const y = this.b0 * x + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

export class VoiceDSP {
  constructor(sampleRate) {
    this.sr = sampleRate;

    /* ---- controls (targets, set from outside) ---- */
    this.targetFreq = 120;
    this.targetTense = 0.72;
    this.targetVoice = 0;       // 0..1 voicing
    this.targetBreath = 0;      // 0..1 extra aspiration (for h)
    this.glide = 0.04;          // pitch glide time constant, seconds
    this.vibratoDepth = 0;      // fraction of pitch
    this.vibratoRate = 5.5;
    this.volume = 0.8;

    /* ---- glottis state ---- */
    this.freq = 120;
    this.tense = 0.72;
    this.voice = 0;
    this.breath = 0;
    this.timeInWave = 0;
    this.totalTime = 0;
    this.setupWaveform();

    /* ---- tract state ---- */
    this.diameter = new Float64Array(N);
    this.targetDiameter = new Float64Array(N);
    for (let i = 0; i < N; i++) this.diameter[i] = this.targetDiameter[i] = restDiameter(i);
    this.R = new Float64Array(N);
    this.L = new Float64Array(N);
    this.jR = new Float64Array(N + 1);
    this.jL = new Float64Array(N + 1);
    this.A = new Float64Array(N);
    this.reflection = new Float64Array(N + 1);
    this.newReflection = new Float64Array(N + 1);
    this.reflLeft = this.reflRight = this.reflNose = 0;
    this.newReflLeft = this.newReflRight = this.newReflNose = 0;

    this.noseR = new Float64Array(NOSE_LEN);
    this.noseL = new Float64Array(NOSE_LEN);
    this.noseJR = new Float64Array(NOSE_LEN + 1);
    this.noseJL = new Float64Array(NOSE_LEN + 1);
    this.noseD = new Float64Array(NOSE_LEN);
    this.noseA = new Float64Array(NOSE_LEN);
    this.noseReflection = new Float64Array(NOSE_LEN + 1);
    for (let i = 0; i < NOSE_LEN; i++) {
      let d = 2 * (i / NOSE_LEN);
      d = d < 1 ? 0.4 + 1.6 * d : 0.5 + 1.5 * (2 - d);
      this.noseD[i] = Math.min(d, 1.9);
    }
    this.velumTarget = 0.01;
    this.noseD[0] = 0.01;

    this.lipOut = 0;
    this.noseOut = 0;
    this.lastObstruction = -1;
    this.transients = [];

    /* noise sources: index -> { amt, target } */
    this.noise = new Map();

    this.aspFilter = new Bandpass(500, 0.5, sampleRate);
    this.fricFilter = new Bandpass(1000, 0.5, sampleRate);

    this.calculateReflections();
    this.calculateNoseReflections();
    this.reflection.set(this.newReflection);
    this.reflLeft = this.newReflLeft;
    this.reflRight = this.newReflRight;
    this.reflNose = this.newReflNose;
  }

  /* ---------- public control ---------- */
  setTarget(diameters, velum) {
    for (let i = 0; i < N; i++) this.targetDiameter[i] = Math.max(0, diameters[i]);
    if (velum !== undefined) this.velumTarget = velum;
  }
  setNoise(sources) {
    const keep = new Set();
    for (const s of sources) {
      const key = Math.round(s.index * 4) / 4;
      keep.add(key);
      const cur = this.noise.get(key);
      if (cur) cur.target = s.amt; else this.noise.set(key, { amt: 0, target: s.amt });
    }
    for (const [k, v] of this.noise) if (!keep.has(k)) v.target = 0;
  }

  /* ---------- glottis: LF model ---------- */
  setupWaveform() {
    let f = this.freq;
    if (this.vibratoDepth > 0) {
      f *= 1 + this.vibratoDepth * Math.sin(2 * Math.PI * this.totalTime * this.vibratoRate);
    }
    this.waveLen = 1 / f;
    let Rd = 3 * (1 - this.tense);
    Rd = clamp(Rd, 0.5, 2.7);
    const Ra = -0.01 + 0.048 * Rd;
    const Rk = 0.224 + 0.118 * Rd;
    const Rg = (Rk / 4) * (0.5 + 1.2 * Rk) / (0.11 * Rd - Ra * (0.5 + 1.2 * Rk));
    const Ta = Ra;
    const Tp = 1 / (2 * Rg);
    const Te = Tp + Tp * Rk;
    const epsilon = 1 / Ta;
    const shift = Math.exp(-epsilon * (1 - Te));
    const delta = 1 - shift;
    let rhs = (1 / epsilon) * (shift - 1) + (1 - Te) * shift;
    rhs /= delta;
    const lower = -(Te - Tp) / 2 + rhs;
    const upper = -lower;
    const omega = Math.PI / Tp;
    const s = Math.sin(omega * Te);
    const y = (-Math.PI * s * upper) / (Tp * 2);
    const z = Math.log(y);
    const alpha = z / (Tp / 2 - Te);
    const E0 = -1 / (s * Math.exp(alpha * Te));
    Object.assign(this, { lfAlpha: alpha, lfE0: E0, lfEps: epsilon, lfShift: shift, lfDelta: delta, lfTe: Te, lfOmega: omega });
  }

  lfWave(t) {
    if (t > this.lfTe) return (-Math.exp(-this.lfEps * (t - this.lfTe)) + this.lfShift) / this.lfDelta;
    return this.lfE0 * Math.exp(this.lfAlpha * t) * Math.sin(this.lfOmega * t);
  }

  noiseModulator() {
    const voiced = 0.1 + 0.2 * Math.max(0, Math.sin((2 * Math.PI * this.timeInWave) / this.waveLen));
    const k = this.tense * this.voice;
    return k * voiced + (1 - k) * 0.3;
  }

  glottisStep(aspNoise) {
    const dt = 1 / this.sr;
    this.timeInWave += dt;
    this.totalTime += dt;
    if (this.timeInWave > this.waveLen) {
      this.timeInWave -= this.waveLen;
      this.setupWaveform();
    }
    const loud = Math.pow(this.tense, 0.25);
    let out = this.lfWave(this.timeInWave / this.waveLen) * this.voice * loud;
    const asp =
      (this.voice * (1 - Math.sqrt(this.tense)) * 0.2 + this.breath * 0.35) *
      this.noiseModulator() * aspNoise;
    out += asp;
    return out;
  }

  /* ---------- tract ---------- */
  reshape(dt) {
    const amount = dt * MOVEMENT_SPEED;
    let newLast = -1;
    for (let i = 0; i < N; i++) {
      const d = this.diameter[i];
      const t = this.targetDiameter[i];
      if (d <= 0) newLast = i;
      let slow;
      if (i < NOSE_START) slow = 0.6;
      else if (i >= TIP_START) slow = 1.0;
      else slow = 0.6 + 0.4 * (i - NOSE_START) / (TIP_START - NOSE_START);
      this.diameter[i] = moveTowards(d, t, slow * amount, 2 * amount);
    }
    if (this.lastObstruction > -1 && newLast === -1 && this.noseA[0] < 0.05) {
      this.transients.push({ pos: this.lastObstruction, time: 0, life: 0.2, strength: 0.3, exp: 200 });
    }
    this.lastObstruction = newLast;
    this.noseD[0] = moveTowards(this.noseD[0], this.velumTarget, amount * 0.25, amount * 0.1);
    this.noseA[0] = this.noseD[0] * this.noseD[0];
  }

  calculateReflections() {
    for (let i = 0; i < N; i++) this.A[i] = this.diameter[i] * this.diameter[i];
    for (let i = 1; i < N; i++) {
      this.reflection[i] = this.newReflection[i];
      this.newReflection[i] = this.A[i] === 0 ? 0.999 : (this.A[i - 1] - this.A[i]) / (this.A[i - 1] + this.A[i]);
    }
    this.reflLeft = this.newReflLeft;
    this.reflRight = this.newReflRight;
    this.reflNose = this.newReflNose;
    const sum = this.A[NOSE_START] + this.A[NOSE_START + 1] + this.noseA[0];
    this.newReflLeft = (2 * this.A[NOSE_START] - sum) / sum;
    this.newReflRight = (2 * this.A[NOSE_START + 1] - sum) / sum;
    this.newReflNose = (2 * this.noseA[0] - sum) / sum;
  }

  calculateNoseReflections() {
    for (let i = 0; i < NOSE_LEN; i++) this.noseA[i] = this.noseD[i] * this.noseD[i];
    for (let i = 1; i < NOSE_LEN; i++) {
      this.noseReflection[i] = (this.noseA[i - 1] - this.noseA[i]) / (this.noseA[i - 1] + this.noseA[i]);
    }
  }

  addTurbulence(noise, index, diameter) {
    const i = Math.floor(index);
    if (i < 0 || i + 2 >= N) return;
    const delta = index - i;
    const thin = clamp(8 * (0.7 - diameter), 0, 1);
    const open = clamp(30 * (diameter - 0.3), 0, 1);
    const n0 = noise * (1 - delta) * thin * open;
    const n1 = noise * delta * thin * open;
    this.R[i + 1] += n0 / 2; this.L[i + 1] += n0 / 2;
    this.R[i + 2] += n1 / 2; this.L[i + 2] += n1 / 2;
  }

  tractStep(glottal, fric, lambda) {
    // plosive release clicks
    for (let k = this.transients.length - 1; k >= 0; k--) {
      const tr = this.transients[k];
      const amp = tr.strength * Math.pow(2, -tr.exp * tr.time);
      this.R[tr.pos] += amp / 2;
      this.L[tr.pos] += amp / 2;
      tr.time += 1 / (this.sr * 2);
      if (tr.time > tr.life) this.transients.splice(k, 1);
    }
    // turbulence at constrictions
    if (this.noise.size) {
      const mod = this.noiseModulator();
      for (const [index, src] of this.noise) {
        if (src.amt < 0.001) continue;
        const i = Math.floor(index);
        const d = this.diameter[i] * (1 - (index - i)) + this.diameter[Math.min(i + 1, N - 1)] * (index - i);
        this.addTurbulence(0.66 * fric * src.amt * mod, index, d);
      }
    }

    this.jR[0] = this.L[0] * GLOTTAL_REFLECTION + glottal;
    this.jL[N] = this.R[N - 1] * LIP_REFLECTION;
    for (let i = 1; i < N; i++) {
      const r = this.reflection[i] * (1 - lambda) + this.newReflection[i] * lambda;
      const w = r * (this.R[i - 1] + this.L[i]);
      this.jR[i] = this.R[i - 1] - w;
      this.jL[i] = this.L[i] + w;
    }
    const i = NOSE_START;
    let r = this.newReflLeft * (1 - lambda) + this.reflLeft * lambda;
    this.jL[i] = r * this.R[i - 1] + (1 + r) * (this.noseL[0] + this.L[i]);
    r = this.newReflRight * (1 - lambda) + this.reflRight * lambda;
    this.jR[i] = r * this.L[i] + (1 + r) * (this.R[i - 1] + this.noseL[0]);
    r = this.newReflNose * (1 - lambda) + this.reflNose * lambda;
    this.noseJR[0] = r * this.noseL[0] + (1 + r) * (this.L[i] + this.R[i - 1]);

    for (let k = 0; k < N; k++) {
      this.R[k] = this.jR[k] * FADE;
      this.L[k] = this.jL[k + 1] * FADE;
    }
    this.lipOut = this.R[N - 1];

    this.noseJL[NOSE_LEN] = this.noseR[NOSE_LEN - 1] * LIP_REFLECTION;
    for (let k = 1; k < NOSE_LEN; k++) {
      const w = this.noseReflection[k] * (this.noseR[k - 1] + this.noseL[k]);
      this.noseJR[k] = this.noseR[k - 1] - w;
      this.noseJL[k] = this.noseL[k] + w;
    }
    for (let k = 0; k < NOSE_LEN; k++) {
      this.noseR[k] = this.noseJR[k] * FADE;
      this.noseL[k] = this.noseJL[k + 1] * FADE;
    }
    this.noseOut = this.noseR[NOSE_LEN - 1];
  }

  /* ---------- render one block ---------- */
  process(out) {
    const frames = out.length;
    const dt = frames / this.sr;
    this.reshape(dt);
    this.calculateReflections();
    this.calculateNoseReflections();

    // per-sample smoothing coefficients
    const kVoice = 1 - Math.exp(-1 / (this.sr * (this.targetVoice > this.voice ? 0.012 : 0.03)));
    const kBreath = 1 - Math.exp(-1 / (this.sr * 0.015));
    const kFreq = 1 - Math.exp(-1 / (this.sr * Math.max(0.002, this.glide)));
    const kTense = 1 - Math.exp(-1 / (this.sr * 0.05));
    const kNoise = 1 - Math.exp(-1 / (this.sr * 0.025));

    for (let j = 0; j < frames; j++) {
      this.voice += (this.targetVoice - this.voice) * kVoice;
      this.breath += (this.targetBreath - this.breath) * kBreath;
      this.freq += (this.targetFreq - this.freq) * kFreq;
      this.tense += (this.targetTense - this.tense) * kTense;
      for (const src of this.noise.values()) src.amt += (src.target - src.amt) * kNoise;

      const lambda1 = j / frames;
      const lambda2 = (j + 0.5) / frames;
      const asp = this.aspFilter.process(Math.random() * 2 - 1);
      const fric = this.fricFilter.process(Math.random() * 2 - 1);
      const g = this.glottisStep(asp);

      let v = 0;
      this.tractStep(g, fric, lambda1);
      v += this.lipOut + this.noseOut;
      this.tractStep(g, fric, lambda2);
      v += this.lipOut + this.noseOut;
      out[j] = v * 0.125 * this.volume;
    }

    for (const [k, src] of this.noise) if (src.target === 0 && src.amt < 0.001) this.noise.delete(k);
  }
}
