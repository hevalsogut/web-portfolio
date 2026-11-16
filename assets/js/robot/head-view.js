/* ============================================================
   Talk to Robot: head view
   A robot head in profile with its voice box cut open.
   The vocal tract is drawn straight from the engine's 44
   diameters: the back wall (pharynx, palate, upper lip) is
   fixed, and the front wall (tongue root, tongue, lower lip)
   sits one diameter away from it. The jaw plate swings on its
   hinge with the mouth opening, the soft palate opens for m/n,
   and the eye, antenna and level meter react to the sound.
   Units: "u" = one tract segment; origin at the centre of the
   pharynx-to-mouth bend; y points down.
   ============================================================ */

import { N, NOSE_START } from "./voice-dsp.js";

const RW = 24 / Math.PI; // radius of the bend (12 segments over a quarter turn)
const DS = 1.6;          // drawn width per diameter unit
const HINGE = [-2.5, -11];

const COL = {
  steel: "132, 176, 222",
  tract: "198, 242, 34",
  jaw: "255, 107, 91",
  nose: "167, 139, 250",
};

const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* back wall point and inward normal at position s along the tract */
function wall(s) {
  if (s <= 13) return { x: -RW, y: 13 - s, nx: 1, ny: 0 };
  if (s <= 25) {
    const th = Math.PI + ((s - 13) / 12) * (Math.PI / 2);
    const c = Math.cos(th), si = Math.sin(th);
    return { x: RW * c, y: RW * si, nx: -c, ny: -si };
  }
  return { x: s - 25, y: -RW, nx: 0, ny: 1 };
}

/* ---------- robot geometry: [x, y, cornerRadius] ---------- */
const SHELL = [
  [-12, -3, 1.5], [-15, -8, 2], [-15, -29, 3], [-10, -35.5, 3], [10, -35.5, 3],
  [17.5, -30, 2], [18.5, -24.5, 0.6], [21.2, -23.6, 0.6], [21.2, -17.6, 0.6],
  [19.6, -16.6, 0.5], [22.6, -12.6, 0.8], [20.8, -10.4, 0.5], [21.1, -8.4, 0.5],
  [19.9, -7.7, 0.3], [4, -9.2, 1], [-2.5, -12.6, 1], [-6.5, -5, 1],
];
const JAW = [
  [-4.6, -11.4, 1], [-4.2, -3.2, 1.5], [-0.8, 1.6, 2], [17, 1.9, 1.6],
  [21.3, -1, 1], [21.3, -5.9, 0.8], [19.8, -7.35, 0.4], [9, -6.8, 1.5], [0.5, -9.6, 1],
];
const NECK = [[-11.5, -4.5, 0.5], [-10.5, 17, 0], [5.5, 17, 0], [5.5, 3, 1], [1.5, -1.5, 1]];

function rotate([x, y, r], a) {
  const dx = x - HINGE[0], dy = y - HINGE[1];
  const c = Math.cos(a), s = Math.sin(a);
  return [HINGE[0] + dx * c - dy * s, HINGE[1] + dx * s + dy * c, r];
}

/* closed polygon with rounded corners */
function roundPoly(path, pts) {
  const n = pts.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const s = mid(pts[n - 1], pts[0]);
  path.moveTo(s[0], s[1]);
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const m = mid(p, q);
    path.arcTo(p[0], p[1], m[0], m[1], p[2] || 0);
  }
  path.closePath();
  return path;
}

/* smooth open curve through points (Catmull-Rom) */
function curve(ctx, pts) {
  const n = pts.length;
  const p = (i) => pts[Math.max(0, Math.min(n - 1, i))];
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < n - 1; i++) {
    const p0 = p(i - 1), p1 = p(i), p2 = p(i + 1), p3 = p(i + 2);
    ctx.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
      p2[0], p2[1]
    );
  }
}

function glowStroke(ctx, path, rgb, width, alpha = 0.9) {
  ctx.strokeStyle = `rgba(${rgb}, ${alpha * 0.22})`;
  ctx.lineWidth = width * 4;
  ctx.stroke(path);
  ctx.strokeStyle = `rgba(${rgb}, ${alpha})`;
  ctx.lineWidth = width;
  ctx.stroke(path);
}

function bolt(ctx, x, y, r, rgb, alpha = 0.7) {
  ctx.fillStyle = `rgba(${rgb}, ${alpha * 0.25})`;
  ctx.strokeStyle = `rgba(${rgb}, ${alpha})`;
  ctx.lineWidth = 0.1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - r * 0.55, y); ctx.lineTo(x + r * 0.55, y);
  ctx.stroke();
}

export class HeadView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = 1;
    this.label = "";
    this.labelAlpha = 0;
    this.t = 0;
    this.level = 0;
    this.meter = new Float32Array(7);
    this.shellPath = roundPoly(new Path2D(), SHELL);
    this.neckPath = roundPoly(new Path2D(), NECK);
    this.resize();
    if ("ResizeObserver" in window) new ResizeObserver(() => this.resize()).observe(canvas);
    else window.addEventListener("resize", () => this.resize());
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.u = Math.min(this.w / 52, this.h / 67);
    this.ox = this.w / 2 - 4 * this.u;
    this.oy = this.h / 2 + 14.5 * this.u;
  }

  setLabel(text) {
    if (text) { this.label = text; this.labelAlpha = 1; }
  }

  draw(state, dt) {
    const { ctx, u } = this;
    this.t += dt;
    const t = this.t;
    const d = state?.shape;
    const voice = state?.voice ?? 0;
    const velum = state?.velum ?? 0.01;
    const lvl = Math.min(1, (state?.level ?? 0) * 9);
    this.level += (lvl - this.level) * Math.min(1, dt * 18);
    const energy = Math.max(this.level, voice * 0.6);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.save();
    ctx.translate(this.ox, this.oy);
    ctx.scale(u, u);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // mouth opening drives the jaw
    let lip = 1.2;
    if (d) { lip = 0; for (let i = 39; i < N; i++) lip += d[i]; lip /= N - 39; }
    const jawA = Math.max(0, Math.min(0.22, 0.02 + lip * 0.085));
    const jawPath = roundPoly(new Path2D(), JAW.map((p) => rotate(p, jawA)));

    /* ---- antenna (behind the shell) ---- */
    this.drawAntenna(energy, t);

    /* ---- neck: segmented collar and cables ---- */
    ctx.strokeStyle = `rgba(${COL.jaw}, 0.35)`;
    ctx.lineWidth = 0.45;
    ctx.beginPath();
    curve(ctx, [[-12.5, -3], [-14.5, 5], [-13.2, 12], [-12.4, 17]]);
    ctx.stroke();
    ctx.strokeStyle = `rgba(${COL.nose}, 0.35)`;
    ctx.beginPath();
    curve(ctx, [[-11.5, -1.5], [-13, 6], [-11.8, 17]]);
    ctx.stroke();

    ctx.fillStyle = "rgba(20, 28, 40, 0.85)";
    ctx.fill(this.neckPath);
    ctx.save();
    ctx.clip(this.neckPath);
    ctx.strokeStyle = `rgba(${COL.steel}, 0.3)`;
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    for (let y = -3; y <= 17; y += 1.4) { ctx.moveTo(-12, y); ctx.lineTo(7, y + 0.5); }
    ctx.stroke();
    ctx.restore();
    glowStroke(ctx, this.neckPath, COL.steel, 0.14, 0.6);

    /* ---- shell ---- */
    const metal = ctx.createLinearGradient(0, -36, 6, 2);
    metal.addColorStop(0, "rgba(46, 62, 84, 0.92)");
    metal.addColorStop(0.55, "rgba(24, 33, 46, 0.92)");
    metal.addColorStop(1, "rgba(14, 19, 27, 0.92)");
    ctx.fillStyle = metal;
    ctx.fill(this.shellPath);

    ctx.save();
    ctx.clip(this.shellPath);
    // hologram scan lines
    ctx.strokeStyle = `rgba(${COL.steel}, 0.07)`;
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    for (let y = -36; y <= 0; y += 1.1) { ctx.moveTo(-16, y); ctx.lineTo(24, y); }
    ctx.stroke();
    // sweeping scanner beam
    if (!reduceMotion) {
      const sy = -36 + ((t * 6) % 40);
      const beam = ctx.createLinearGradient(0, sy - 2, 0, sy + 0.2);
      beam.addColorStop(0, `rgba(${COL.steel}, 0)`);
      beam.addColorStop(1, `rgba(${COL.steel}, 0.16)`);
      ctx.fillStyle = beam;
      ctx.fillRect(-16, sy - 2, 40, 2.2);
    }
    // panel seams
    ctx.strokeStyle = `rgba(${COL.steel}, 0.35)`;
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    ctx.moveTo(-15, -25); ctx.quadraticCurveTo(2, -27.5, 18.4, -25.5);
    ctx.moveTo(6, -35.5); ctx.lineTo(4.5, -25.9);
    ctx.moveTo(-15, -13); ctx.quadraticCurveTo(-9, -13.5, -8.5, -9);
    ctx.stroke();
    ctx.restore();
    for (const [x, y] of [[-12.5, -24.4], [-6, -25.7], [1, -26.4], [9, -26.6], [15.5, -26], [5.6, -32], [5, -28.5], [-12.6, -32.5], [-12.6, -6]]) {
      bolt(ctx, x, y, 0.42, COL.steel, 0.55);
    }
    glowStroke(ctx, this.shellPath, COL.steel, 0.16, 0.9);

    /* ---- level meter on the temple ---- */
    this.drawMeter(energy, t);

    /* ---- ear: speaker disc ---- */
    this.drawEar(energy, t);

    /* ---- visor and eye ---- */
    this.drawEye(energy, voice, t);

    /* ---- jaw plate ---- */
    ctx.fillStyle = "rgba(30, 40, 54, 0.78)";
    ctx.fill(jawPath);
    glowStroke(ctx, jawPath, COL.jaw, 0.14, 0.6);
    // piston from skull to jaw
    const pa = [-9, -8.5];
    const pb = rotate([-3.6, -4.2], jawA);
    const mx = pa[0] + (pb[0] - pa[0]) * 0.55, my = pa[1] + (pb[1] - pa[1]) * 0.55;
    ctx.strokeStyle = `rgba(${COL.jaw}, 0.55)`;
    ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(mx, my); ctx.stroke();
    ctx.strokeStyle = `rgba(${COL.jaw}, 0.9)`;
    ctx.lineWidth = 0.22;
    ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
    bolt(ctx, pa[0], pa[1], 0.45, COL.jaw, 0.8);
    bolt(ctx, pb[0], pb[1], 0.4, COL.jaw, 0.8);

    /* ---- nasal duct ---- */
    const vOpen = Math.max(0, Math.min(1, (velum - 0.01) / 0.39));
    const wv = wall(NOSE_START);
    ctx.strokeStyle = `rgba(${COL.nose}, ${0.2 + 0.7 * vOpen})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    curve(ctx, [[wv.x - 0.6, wv.y - 0.6], [-3.5, -9.7], [6, -10.1], [14, -10.5], [20.4, -11]]);
    ctx.stroke();

    /* ---- voice box: the vocal tract ---- */
    if (d) this.drawTract(d, voice, vOpen);

    /* ---- hinge ---- */
    ctx.save();
    ctx.translate(HINGE[0], HINGE[1]);
    ctx.rotate(jawA);
    ctx.fillStyle = "rgba(14, 19, 27, 0.95)";
    ctx.strokeStyle = `rgba(${COL.jaw}, 0.95)`;
    ctx.lineWidth = 0.18;
    ctx.beginPath(); ctx.arc(0, 0, 1.35, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-0.7, 0); ctx.lineTo(0.7, 0);
    ctx.moveTo(0, -0.7); ctx.lineTo(0, 0.7);
    ctx.stroke();
    ctx.restore();

    /* ---- current syllable, next to the mouth ---- */
    this.drawLabel(dt);

    ctx.restore();
  }

  drawAntenna(energy, t) {
    const { ctx } = this;
    ctx.fillStyle = "rgba(24, 33, 46, 0.95)";
    ctx.strokeStyle = `rgba(${COL.steel}, 0.8)`;
    ctx.lineWidth = 0.14;
    ctx.beginPath();
    ctx.roundRect(-2, -37.4, 4, 2.2, 0.5);
    ctx.fill(); ctx.stroke();
    ctx.lineWidth = 0.25;
    ctx.beginPath(); ctx.moveTo(0, -37.4); ctx.lineTo(2.2, -43); ctx.stroke();
    const tip = [2.2, -43.4];
    const glow = ctx.createRadialGradient(tip[0], tip[1], 0, tip[0], tip[1], 3.5);
    glow.addColorStop(0, `rgba(${COL.tract}, ${0.25 + 0.55 * energy})`);
    glow.addColorStop(1, `rgba(${COL.tract}, 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(tip[0], tip[1], 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(${COL.tract}, ${0.55 + 0.45 * energy})`;
    ctx.beginPath(); ctx.arc(tip[0], tip[1], 0.75, 0, Math.PI * 2); ctx.fill();
    if (!reduceMotion && energy > 0.05) {
      for (let k = 0; k < 3; k++) {
        const ph = (t * 1.2 + k / 3) % 1;
        ctx.strokeStyle = `rgba(${COL.tract}, ${(1 - ph) * 0.5 * energy})`;
        ctx.lineWidth = 0.12;
        ctx.beginPath();
        ctx.arc(tip[0], tip[1], 1.2 + ph * 4, -Math.PI * 0.9, -Math.PI * 0.1);
        ctx.stroke();
      }
    }
  }

  drawMeter(energy, t) {
    const { ctx, meter } = this;
    const x0 = 4.2, y0 = -14.2, bw = 0.7, gap = 0.35, hmax = 3.2;
    ctx.fillStyle = "rgba(9, 12, 17, 0.7)";
    ctx.strokeStyle = `rgba(${COL.steel}, 0.4)`;
    ctx.lineWidth = 0.1;
    ctx.beginPath();
    ctx.roundRect(x0 - 0.5, y0 - hmax - 0.5, meter.length * (bw + gap) + 0.65, hmax + 1, 0.4);
    ctx.fill(); ctx.stroke();
    for (let i = 0; i < meter.length; i++) {
      const wob = reduceMotion ? 0.8 : 0.55 + 0.45 * Math.sin(t * (7 + i * 2.3) + i);
      const target = energy * wob * (1 - Math.abs(i - 3) * 0.08);
      meter[i] += (target - meter[i]) * 0.35;
      const h = Math.max(0.15, meter[i] * hmax);
      ctx.fillStyle = `rgba(${COL.tract}, ${0.35 + 0.6 * meter[i]})`;
      ctx.fillRect(x0 + i * (bw + gap), y0 - h, bw, h);
    }
  }

  drawEar(energy, t) {
    const { ctx } = this;
    const cx = -6, cy = -19.5;
    ctx.fillStyle = "rgba(12, 16, 23, 0.9)";
    ctx.beginPath(); ctx.arc(cx, cy, 4.4, 0, Math.PI * 2); ctx.fill();
    const ring = new Path2D();
    ring.arc(cx, cy, 4.4, 0, Math.PI * 2);
    glowStroke(ctx, ring, COL.steel, 0.16, 0.85);
    // speaker cone pulses with the sound
    const pulse = 1 + energy * 0.12;
    ctx.strokeStyle = `rgba(${COL.steel}, 0.5)`;
    ctx.lineWidth = 0.12;
    for (const r of [3.2, 2.2]) {
      ctx.beginPath(); ctx.arc(cx, cy, r * pulse, 0, Math.PI * 2); ctx.stroke();
    }
    // rotating grille slots
    const rot = reduceMotion ? 0 : t * (0.3 + energy * 2);
    ctx.strokeStyle = `rgba(${COL.steel}, 0.45)`;
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = rot + (k * Math.PI) / 4;
      ctx.moveTo(cx + Math.cos(a) * 2.5, cy + Math.sin(a) * 2.5);
      ctx.lineTo(cx + Math.cos(a) * 3.0, cy + Math.sin(a) * 3.0);
    }
    ctx.stroke();
    ctx.fillStyle = `rgba(${COL.tract}, ${0.25 + 0.6 * energy})`;
    ctx.beginPath(); ctx.arc(cx, cy, 0.9, 0, Math.PI * 2); ctx.fill();
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      bolt(ctx, cx + Math.cos(a) * 3.85, cy + Math.sin(a) * 3.85, 0.25, COL.steel, 0.6);
    }
  }

  drawEye(energy, voice, t) {
    const { ctx } = this;
    // visor
    ctx.fillStyle = "rgba(6, 9, 13, 0.92)";
    ctx.strokeStyle = `rgba(${COL.steel}, 0.85)`;
    ctx.lineWidth = 0.14;
    ctx.beginPath();
    ctx.roundRect(11.2, -23.3, 10, 4.6, [1.2, 0.4, 0.4, 1.2]);
    ctx.fill(); ctx.stroke();
    // blink every few seconds
    let open = 1;
    const phase = t % 4.3;
    if (!reduceMotion && phase < 0.14) open = Math.abs(phase - 0.07) / 0.07;
    // the eye looks a little towards the mouth while singing
    const ex = 17.2 + voice * 0.4, ey = -21, ew = 2.6, eh = 1.05 * Math.max(0.08, open);
    const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, 5);
    g.addColorStop(0, `rgba(${COL.tract}, ${0.3 + 0.4 * energy})`);
    g.addColorStop(1, `rgba(${COL.tract}, 0)`);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(11.2, -23.3, 10, 4.6, [1.2, 0.4, 0.4, 1.2]);
    ctx.clip();
    ctx.fillStyle = g;
    ctx.fillRect(11, -24, 11, 6);
    ctx.fillStyle = `rgba(${COL.tract}, ${0.7 + 0.3 * energy})`;
    ctx.beginPath();
    ctx.ellipse(ex, ey, ew, eh, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(6, 9, 13, 0.85)";
    ctx.beginPath();
    ctx.ellipse(ex + 0.9, ey, 0.55, eh * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawTract(d, voice, vOpen) {
    const { ctx } = this;
    const back = [];
    const front = [];
    for (let i = 0; i <= N; i++) {
      const w = wall(i);
      const di = d[Math.min(N - 1, i)];
      back.push([w.x, w.y]);
      front.push([w.x + w.nx * di * DS, w.y + w.ny * di * DS]);
    }
    // airway
    ctx.fillStyle = `rgba(${COL.tract}, ${0.07 + voice * 0.13})`;
    ctx.beginPath();
    ctx.moveTo(back[0][0], back[0][1]);
    for (const p of back) ctx.lineTo(p[0], p[1]);
    for (let i = front.length - 1; i >= 0; i--) ctx.lineTo(front[i][0], front[i][1]);
    ctx.closePath();
    ctx.fill();

    // tongue body: a soft band just behind the moving wall
    const body = [];
    for (let i = 9; i <= 39; i++) {
      const w = wall(i);
      const off = d[i] * DS + 1.5;
      body.push([w.x + w.nx * off, w.y + w.ny * off]);
    }
    ctx.strokeStyle = `rgba(${COL.tract}, 0.16)`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    curve(ctx, body);
    ctx.stroke();

    // walls
    ctx.strokeStyle = `rgba(${COL.steel}, 0.8)`;
    ctx.lineWidth = 0.18;
    ctx.beginPath();
    curve(ctx, back);
    ctx.stroke();
    ctx.strokeStyle = `rgba(${COL.tract}, 0.25)`;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    curve(ctx, front);
    ctx.stroke();
    ctx.strokeStyle = `rgba(${COL.tract}, 0.95)`;
    ctx.lineWidth = 0.22;
    ctx.beginPath();
    curve(ctx, front);
    ctx.stroke();

    // soft palate flap
    const a = wall(NOSE_START - 2.5);
    const tip = wall(NOSE_START + 0.5);
    const drop = (1 - vOpen) * 1.1;
    ctx.strokeStyle = `rgba(${COL.nose}, 0.9)`;
    ctx.lineWidth = 0.35;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(
      (a.x + tip.x) / 2 + tip.nx * drop, (a.y + tip.y) / 2 + tip.ny * drop,
      tip.x + tip.nx * drop * 1.2 - vOpen * 0.8, tip.y + tip.ny * drop * 1.2 - vOpen * 1.4
    );
    ctx.stroke();

    // vocal folds
    const gl = wall(0.3);
    const buzz = voice * (0.5 + 0.5 * Math.sin(performance.now() / 18));
    ctx.fillStyle = `rgba(${COL.tract}, ${0.25 + 0.7 * buzz})`;
    ctx.beginPath();
    ctx.ellipse(gl.x + d[0] * DS * 0.5, gl.y, d[0] * DS * 0.55 + 0.3, 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawLabel(dt) {
    const { ctx } = this;
    this.labelAlpha = Math.max(0, this.labelAlpha - dt * 0.9);
    if (!this.label || this.labelAlpha <= 0.01) return;
    const fs = 2.6;
    ctx.font = `600 ${fs}px Geist, ui-sans-serif, system-ui, sans-serif`;
    const text = this.label.toLocaleUpperCase("tr");
    const tw = ctx.measureText(text).width;
    const lx = 23.5, ly = -3.5;
    ctx.globalAlpha = Math.min(1, this.labelAlpha * 1.4);
    ctx.fillStyle = "rgba(11, 14, 19, 0.8)";
    ctx.beginPath();
    ctx.roundRect(lx - 0.8, ly - fs * 0.85, tw + 1.6, fs * 1.25, 0.6);
    ctx.fill();
    ctx.fillStyle = `rgb(${COL.tract})`;
    ctx.fillText(text, lx, ly);
    ctx.globalAlpha = 1;
  }
}
