/* Talk to Robot: AudioWorklet host for the voice engine.
   Receives articulation messages from the page and posts the
   current tract shape back about 60 times a second for drawing. */

import { VoiceDSP, N } from "./voice-dsp.js";

class RobotVoice extends AudioWorkletProcessor {
  constructor() {
    super();
    this.dsp = new VoiceDSP(sampleRate);
    this.blocks = 0;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    const d = this.dsp;
    switch (m.type) {
      case "frame":
        if (m.shape) d.setTarget(m.shape, m.velum);
        if (m.voice !== undefined) d.targetVoice = m.voice;
        if (m.breath !== undefined) d.targetBreath = m.breath;
        if (m.noise) d.setNoise(m.noise);
        break;
      case "pitch":
        d.targetFreq = m.freq;
        if (m.jump) d.freq = m.freq;
        break;
      case "params":
        if (m.tense !== undefined) d.targetTense = m.tense;
        if (m.vibrato !== undefined) d.vibratoDepth = m.vibrato;
        if (m.glide !== undefined) d.glide = m.glide;
        if (m.volume !== undefined) d.volume = m.volume;
        break;
      case "silence":
        d.targetVoice = 0;
        d.targetBreath = 0;
        d.setNoise([]);
        break;
    }
  }

  process(inputs, outputs) {
    const ch = outputs[0][0];
    if (!ch) return true;
    this.dsp.process(ch);
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(ch);

    let sum = 0;
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
    this.level = Math.max(Math.sqrt(sum / ch.length), (this.level || 0) * 0.9);

    if (++this.blocks % 6 === 0) {
      const d = this.dsp;
      const shape = new Float32Array(N);
      for (let i = 0; i < N; i++) shape[i] = d.diameter[i];
      this.port.postMessage(
        { shape, velum: d.noseD[0], voice: d.voice, breath: d.breath, freq: d.freq, level: this.level },
        [shape.buffer]
      );
      this.level = 0;
    }
    return true;
  }
}

registerProcessor("robot-voice", RobotVoice);
