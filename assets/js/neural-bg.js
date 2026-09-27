/* Heval Söğüt — interactive neural-network background
   Plain WebGL (no library): neurons scattered in an ellipsoid, each
   wired to its nearest neighbours, with signals travelling along the
   synapses. The pointer lights up the neurons under it; hovering a
   neuron or clicking/tapping fires a cascade of signals from it.

   Performance: node, pulse and dust counts and the pixel ratio are
   tiered by screen size and CPU cores. Past the hero the canvas dims
   and rendering parks on a static frame until the hero is back in
   view; it also pauses while the tab is hidden. prefers-reduced-motion and
   Save-Data get a single static frame. */
(() => {
  "use strict";

  const canvas = document.getElementById("neural-bg");
  const hero = document.getElementById("top");
  if (!canvas || !hero) return;

  const root = document.documentElement;
  const fail = () => root.classList.add("no-webgl");

  const mqReduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const saveData = !!(navigator.connection && navigator.connection.saveData);
  const staticMode = mqReduced.matches || saveData;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  /* ------------------------------------------------------------
     Device tier
     ------------------------------------------------------------ */
  const vw = window.innerWidth;
  let tierIdx = vw < 640 ? 0 : vw < 1100 ? 1 : 2;
  if ((navigator.hardwareConcurrency || 8) <= 4) tierIdx = Math.max(0, tierIdx - 1);
  const TIERS = [
    { nodes: 64,  links: 2, pulses: 10, dust: 0,   dpr: 1.5,  aa: false },
    { nodes: 110, links: 3, pulses: 20, dust: 110, dpr: 1.75, aa: true },
    { nodes: 150, links: 3, pulses: 30, dust: 200, dpr: 2,    aa: true },
  ];
  const T = TIERS[tierIdx];

  let gl;
  try {
    gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: T.aa,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
      preserveDrawingBuffer: false,
    });
  } catch (e) { gl = null; }
  if (!gl) { fail(); return; }

  /* ------------------------------------------------------------
     Colours (linear 0..1)
     ------------------------------------------------------------ */
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const INK = hex("#0B0E13");
  const SIGNAL = hex("#C6F222");
  const GRAY = hex("#8C96A3");
  const LIGHT = hex("#D5DCE4");

  /* ------------------------------------------------------------
     Build the network (deterministic, same layout every visit)
     ------------------------------------------------------------ */
  let seed = 20260927;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const aspect0 = window.innerWidth / window.innerHeight;
  const RADII = aspect0 < 0.8 ? [18, 34, 14] : aspect0 < 1.3 ? [26, 24, 16] : [36, 19, 17];
  const N = T.nodes;
  const nodes = [];
  while (nodes.length < N) {
    const x = rand() * 2 - 1, y = rand() * 2 - 1, z = rand() * 2 - 1;
    if (x * x + y * y + z * z > 1) continue;
    nodes.push([x * RADII[0], y * RADII[1], z * RADII[2]]);
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  const edges = [];
  const adj = Array.from({ length: N }, () => []);
  {
    const seen = new Set();
    const maxLink = 13;
    for (let i = 0; i < N; i++) {
      const near = [];
      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        const d = dist(nodes[i], nodes[j]);
        if (d < maxLink) near.push([d, j]);
      }
      near.sort((a, b) => a[0] - b[0]);
      for (const [, j] of near.slice(0, T.links)) {
        const key = i < j ? i * N + j : j * N + i;
        if (seen.has(key)) continue;
        seen.add(key);
        adj[i].push([j, edges.length]);
        adj[j].push([i, edges.length]);
        edges.push([i, j]);
      }
    }
  }

  /* ------------------------------------------------------------
     GL helpers
     ------------------------------------------------------------ */
  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const program = (vs, fs) => {
    const p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name;
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u, a: (name) => gl.getAttribLocation(p, name) };
  };

  // Shared projection: rotate the model, offset it, then a simple
  // perspective camera looking down -z from u_camZ.
  const COMMON = `
    uniform mat3 u_rot;
    uniform vec3 u_off;
    uniform float u_camZ;
    uniform vec2 u_focal;
    uniform vec2 u_ptr;
    uniform float u_ptrOn;
    uniform float u_aspect;
    float depthFade(float z) {
      return smoothstep(115.0, 34.0, z) * smoothstep(2.5, 9.0, z);
    }
    vec4 project(vec3 pos, out float depth) {
      vec3 p = u_rot * pos + u_off;
      depth = u_camZ - p.z;
      return vec4(p.x * u_focal.x, p.y * u_focal.y, 0.0, depth);
    }
    float hover(vec4 clip) {
      vec2 ndc = clip.xy / max(clip.w, 0.001);
      vec2 d = (ndc - u_ptr) * vec2(u_aspect, 1.0);
      return smoothstep(0.34, 0.0, length(d)) * u_ptrOn;
    }
  `;

  let pointProg, lineProg;
  try {
    pointProg = program(`
      attribute vec3 a_pos;
      attribute float a_size;
      attribute float a_hub;
      attribute float a_alpha;
      uniform float u_px;
      uniform float u_time;
      uniform float u_hoverable;
      uniform float u_isSignal;
      uniform vec4 u_flash;
      varying float v_hub;
      varying float v_a;
      varying float v_mix;
      ${COMMON}
      void main() {
        float z;
        vec4 clip = project(a_pos, z);
        gl_Position = clip;
        float h = hover(clip) * u_hoverable;
        float f = u_flash.w * step(distance(a_pos, u_flash.xyz), 0.01);
        float breathe = a_hub * 0.3 * sin(u_time * 1.3 + a_pos.x + a_pos.y * 2.0);
        float s = (a_size + breathe) * (1.0 + h * 0.8 + f * 1.8);
        gl_PointSize = clamp(s * u_px / max(z, 0.001), 0.0, 64.0);
        v_hub = a_hub;
        v_mix = clamp(u_isSignal + h * 1.4 + f, 0.0, 1.0);
        v_a = a_alpha * depthFade(z) * (mix(0.55, 0.95, a_hub) + h * 0.6 + f);
      }
    `, `
      precision mediump float;
      uniform vec3 u_gray;
      uniform vec3 u_light;
      uniform vec3 u_signal;
      varying float v_a;
      varying float v_mix;
      varying float v_hub;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float core = smoothstep(0.5, 0.0, d);
        float halo = smoothstep(1.0, 0.2, d) * 0.35;
        float a = (core + halo) * v_a;
        if (a < 0.01) discard;
        gl_FragColor = vec4(mix(mix(u_gray, u_light, v_hub), u_signal, v_mix) * a, 1.0);
      }
    `);

    lineProg = program(`
      attribute vec3 a_pos;
      varying float v_a;
      varying float v_h;
      ${COMMON}
      void main() {
        float z;
        vec4 clip = project(a_pos, z);
        gl_Position = clip;
        v_h = hover(clip);
        v_a = depthFade(z) * (0.16 + v_h * 0.5);
      }
    `, `
      precision mediump float;
      uniform vec3 u_gray;
      uniform vec3 u_signal;
      varying float v_a;
      varying float v_h;
      void main() {
        gl_FragColor = vec4(mix(u_gray, u_signal, v_h * 0.85) * v_a, 1.0);
      }
    `);
  } catch (e) {
    fail();
    return;
  }

  /* ------------------------------------------------------------
     Buffers. Point layout (stride 6): x y z size hub alpha
     ------------------------------------------------------------ */
  const STRIDE = 6;
  const nodeData = new Float32Array(N * STRIDE);
  nodes.forEach((p, i) => {
    const hub = rand() < 0.18;
    nodeData.set([p[0], p[1], p[2], hub ? 2.6 + rand() * 1.4 : 1.1 + rand() * 0.9, hub ? 1 : 0, 1], i * STRIDE);
  });

  const lineData = new Float32Array(edges.length * 6);
  edges.forEach(([a, b], i) => {
    lineData.set(nodes[a], i * 6);
    lineData.set(nodes[b], i * 6 + 3);
  });

  const dustData = new Float32Array(T.dust * STRIDE);
  for (let i = 0; i < T.dust; i++) {
    const r = 70 + rand() * 60;
    const th = rand() * Math.PI * 2;
    const ph = Math.acos(rand() * 2 - 1);
    dustData.set([
      r * Math.sin(ph) * Math.cos(th),
      r * Math.cos(ph) * 0.6,
      r * Math.sin(ph) * Math.sin(th),
      3.2, 0, 0.35,
    ], i * STRIDE);
  }

  const MAX_PULSES = T.pulses + 48;
  const pulseData = new Float32Array(MAX_PULSES * STRIDE);

  const buffer = (data, usage) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage || gl.STATIC_DRAW);
    return b;
  };
  const nodeBuf = buffer(nodeData);
  const lineBuf = buffer(lineData);
  const dustBuf = T.dust ? buffer(dustData) : null;
  const pulseBuf = buffer(pulseData, gl.DYNAMIC_DRAW);

  const pA = {
    pos: pointProg.a("a_pos"), size: pointProg.a("a_size"),
    hub: pointProg.a("a_hub"), alpha: pointProg.a("a_alpha"),
  };
  const lA = { pos: lineProg.a("a_pos") };

  const bindPoints = (buf) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const F = 4;
    gl.enableVertexAttribArray(pA.pos);
    gl.vertexAttribPointer(pA.pos, 3, gl.FLOAT, false, STRIDE * F, 0);
    gl.enableVertexAttribArray(pA.size);
    gl.vertexAttribPointer(pA.size, 1, gl.FLOAT, false, STRIDE * F, 3 * F);
    gl.enableVertexAttribArray(pA.hub);
    gl.vertexAttribPointer(pA.hub, 1, gl.FLOAT, false, STRIDE * F, 4 * F);
    gl.enableVertexAttribArray(pA.alpha);
    gl.vertexAttribPointer(pA.alpha, 1, gl.FLOAT, false, STRIDE * F, 5 * F);
  };

  /* ------------------------------------------------------------
     View state
     ------------------------------------------------------------ */
  const FOCAL = 1 / Math.tan((50 * Math.PI) / 360);
  const view = {
    w: 1, h: 1, dpr: 1, aspect: 1, fx: FOCAL, fy: FOCAL,
    rx: 0, ry: 0, off: [0, 0, 0], camZ: 46,
  };
  const rot = new Float32Array(9);
  const baseRot = new Float32Array(9);

  // R = Rx * Ry, column-major for uniformMatrix3fv
  const setRot = (out, rx, ry) => {
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
    out[0] = cy;       out[1] = sx * sy;  out[2] = -cx * sy;
    out[3] = 0;        out[4] = cx;       out[5] = sx;
    out[6] = sy;       out[7] = -sx * cy; out[8] = cx * cy;
  };

  // Where the network's centre sits on screen (NDC), by layout.
  const anchor = () => {
    if (view.w >= 1024) return [0.42, 0.02];
    if (view.w >= 768) return [0.3, 0.05];
    return [0.0, 0.12];
  };

  const resize = () => {
    view.w = window.innerWidth;
    view.h = window.innerHeight;
    view.dpr = Math.min(window.devicePixelRatio || 1, T.dpr);
    view.aspect = view.w / view.h;
    canvas.width = Math.round(view.w * view.dpr);
    canvas.height = Math.round(view.h * view.dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    // landscape: fixed vertical FOV; portrait: fixed horizontal FOV
    if (view.aspect >= 1) { view.fx = FOCAL / view.aspect; view.fy = FOCAL; }
    else { view.fx = FOCAL; view.fy = FOCAL * view.aspect; }
  };

  /* ------------------------------------------------------------
     Pulses: ambient signals wander the network; bursts cascade
     outward from a neuron the visitor touched.
     ------------------------------------------------------------ */
  const pulses = [];
  const spawnAmbient = (p) => {
    p.e = (Math.random() * edges.length) | 0;
    p.dir = Math.random() < 0.5 ? 0 : 1;
    p.t = 0;
    p.speed = 0.18 + Math.random() * 0.3;
    return p;
  };
  for (let i = 0; i < T.pulses; i++) {
    const p = spawnAmbient({ burst: false, gen: 0 });
    p.t = Math.random();
    pulses.push(p);
  }

  const flash = { node: -1, amt: 0 };
  const fire = (from, maxEdges, gen) => {
    const out = adj[from].slice().sort(() => Math.random() - 0.5).slice(0, maxEdges);
    for (const [to, e] of out) {
      if (pulses.length >= MAX_PULSES) return;
      pulses.push({
        burst: true, gen, e,
        dir: edges[e][0] === from ? 0 : 1,
        t: 0, speed: 0.9 + Math.random() * 0.4,
        to,
      });
    }
  };
  const burst = (node, strong) => {
    flash.node = node;
    flash.amt = 1;
    fire(node, strong ? 6 : 2, strong ? 0 : 1);
  };

  const updatePulses = (dt) => {
    let n = 0;
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.t += p.speed * dt;
      if (p.t >= 1) {
        if (p.burst) {
          pulses.splice(i, 1);
          if (p.gen < 2 && Math.random() < 0.7) fire(p.to, 2, p.gen + 1);
          continue;
        }
        spawnAmbient(p);
      }
    }
    for (const p of pulses) {
      const [a, b] = edges[p.e];
      const A = nodes[p.dir ? b : a], B = nodes[p.dir ? a : b];
      const t = p.t;
      const ends = Math.min(1, Math.min(t, 1 - t) * 5);
      pulseData[n * STRIDE] = A[0] + (B[0] - A[0]) * t;
      pulseData[n * STRIDE + 1] = A[1] + (B[1] - A[1]) * t;
      pulseData[n * STRIDE + 2] = A[2] + (B[2] - A[2]) * t;
      pulseData[n * STRIDE + 3] = p.burst ? 3.8 : 3.0;
      pulseData[n * STRIDE + 4] = 1;
      pulseData[n * STRIDE + 5] = p.burst ? Math.max(ends, 0.5) : ends * 0.85;
      n++;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, pulseBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, pulseData.subarray(0, n * STRIDE));
    return n;
  };

  /* ------------------------------------------------------------
     CPU projection, for picking the neuron under the pointer
     ------------------------------------------------------------ */
  const toScreen = (p, out) => {
    const r = rot, o = view.off;
    const x = r[0] * p[0] + r[3] * p[1] + r[6] * p[2] + o[0];
    const y = r[1] * p[0] + r[4] * p[1] + r[7] * p[2] + o[1];
    const z = r[2] * p[0] + r[5] * p[1] + r[8] * p[2] + o[2];
    const depth = view.camZ - z;
    if (depth < 9) return false;
    out[0] = ((x * view.fx) / depth * 0.5 + 0.5) * view.w;
    out[1] = (0.5 - (y * view.fy) / depth * 0.5) * view.h;
    return true;
  };
  const nearestNode = (cx, cy, maxPx) => {
    const s = [0, 0];
    let best = -1, bestD = maxPx;
    for (let i = 0; i < N; i++) {
      if (!toScreen(nodes[i], s)) continue;
      const d = Math.hypot(s[0] - cx, s[1] - cy);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };

  /* ------------------------------------------------------------
     Draw
     ------------------------------------------------------------ */
  // x/y: rendered (smoothed) pointer; tx/ty: where it really is
  const ptr = { x: 0, y: 0, tx: 0, ty: 0, on: 0, target: 0 };
  let time = 0;

  const setCommon = (prog) => {
    gl.useProgram(prog.p);
    gl.uniformMatrix3fv(prog.u.u_rot, false, rot);
    gl.uniform3fv(prog.u.u_off, view.off);
    gl.uniform1f(prog.u.u_camZ, view.camZ);
    gl.uniform2f(prog.u.u_focal, view.fx, view.fy);
    gl.uniform2f(prog.u.u_ptr, ptr.x, ptr.y);
    gl.uniform1f(prog.u.u_ptrOn, ptr.on);
    gl.uniform1f(prog.u.u_aspect, view.aspect);
    gl.uniform3fv(prog.u.u_gray, GRAY);
    gl.uniform3fv(prog.u.u_signal, SIGNAL);
    if (prog.u.u_light) gl.uniform3fv(prog.u.u_light, LIGHT);
  };

  const draw = (pulseCount) => {
    gl.clearColor(INK[0], INK[1], INK[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    // synapses
    setCommon(lineProg);
    gl.disableVertexAttribArray(pA.size);
    gl.disableVertexAttribArray(pA.hub);
    gl.disableVertexAttribArray(pA.alpha);
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
    gl.enableVertexAttribArray(lA.pos);
    gl.vertexAttribPointer(lA.pos, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINES, 0, edges.length * 2);

    // points: dust (own slower rotation), neurons, pulses
    setCommon(pointProg);
    const pxScale = 140 * view.dpr * Math.min(1.15, Math.max(0.8, view.h / 900));
    gl.uniform1f(pointProg.u.u_px, pxScale);
    gl.uniform1f(pointProg.u.u_time, time);
    if (flash.node >= 0) {
      const f = nodes[flash.node];
      gl.uniform4f(pointProg.u.u_flash, f[0], f[1], f[2], flash.amt);
    } else {
      gl.uniform4f(pointProg.u.u_flash, 0, 0, 0, 0);
    }

    if (dustBuf) {
      gl.uniformMatrix3fv(pointProg.u.u_rot, false, baseRot);
      gl.uniform3f(pointProg.u.u_off, 0, 0, 0);
      gl.uniform1f(pointProg.u.u_hoverable, 0);
      bindPoints(dustBuf);
      gl.drawArrays(gl.POINTS, 0, T.dust);
      gl.uniformMatrix3fv(pointProg.u.u_rot, false, rot);
      gl.uniform3fv(pointProg.u.u_off, view.off);
    }

    gl.uniform1f(pointProg.u.u_isSignal, 0);
    gl.uniform1f(pointProg.u.u_hoverable, 1);
    bindPoints(nodeBuf);
    gl.drawArrays(gl.POINTS, 0, N);

    if (pulseCount) {
      gl.uniform1f(pointProg.u.u_hoverable, 0);
      gl.uniform1f(pointProg.u.u_isSignal, 1);
      bindPoints(pulseBuf);
      gl.drawArrays(gl.POINTS, 0, pulseCount);
    }
  };

  // Place the network centre at the layout anchor for the current camera.
  const placeNetwork = (heroP) => {
    const [ax, ay] = anchor();
    view.off[0] = (ax * view.camZ) / view.fx;
    view.off[1] = (ay * view.camZ) / view.fy + heroP * 8;
    view.off[2] = 0;
  };

  const heroProgress = () => {
    const h = hero.offsetHeight || view.h;
    return Math.min(1, Math.max(0, window.scrollY / (h * 0.85)));
  };
  const applyFade = (p) => { canvas.style.opacity = String(1 - 0.78 * p); };

  resize();

  /* ---------------- static (reduced motion / save-data) ---------------- */
  if (staticMode) {
    const render = () => {
      resize();
      view.rx = -0.08; view.ry = 0.35;
      setRot(rot, view.rx, view.ry);
      setRot(baseRot, 0, 0.14);
      placeNetwork(0);
      pulses.forEach((p) => { p.t = 0.5; });
      draw(updatePulses(0));
      applyFade(heroProgress());
    };
    render();
    window.addEventListener("resize", render);
    window.addEventListener("scroll", () => applyFade(heroProgress()), { passive: true });
    return;
  }

  /* ---------------- live ---------------- */
  root.classList.add("nn-live");

  let targetRX = 0, targetRY = 0;
  let lastHover = -1, lastHoverAt = 0;

  const overHero = (clientY) => clientY + window.scrollY < hero.offsetTop + hero.offsetHeight;
  const isInteractive = (el) => el && el.closest && el.closest("a, button, input, textarea, select, label");

  window.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    ptr.tx = (e.clientX / view.w) * 2 - 1;
    ptr.ty = 1 - (e.clientY / view.h) * 2;
    if (ptr.on < 0.02) { ptr.x = ptr.tx; ptr.y = ptr.ty; }
    ptr.target = overHero(e.clientY) ? 1 : 0;
    targetRY = (e.clientX / view.w - 0.5) * 0.22;
    targetRX = (e.clientY / view.h - 0.5) * 0.14;
    if (ptr.target && !isInteractive(e.target)) {
      const now = performance.now();
      if (now - lastHoverAt > 260) {
        const n = nearestNode(e.clientX, e.clientY, 22);
        if (n >= 0 && n !== lastHover) {
          lastHover = n;
          lastHoverAt = now;
          burst(n, false);
        }
      }
    }
    wake();
  }, { passive: true });

  document.addEventListener("pointerleave", () => { ptr.target = 0; });

  window.addEventListener("click", (e) => {
    if (!overHero(e.clientY) || isInteractive(e.target)) return;
    const n = nearestNode(e.clientX, e.clientY, finePointer ? 60 : 90);
    ptr.x = ptr.tx = (e.clientX / view.w) * 2 - 1;
    ptr.y = ptr.ty = 1 - (e.clientY / view.h) * 2;
    if (e.pointerType && e.pointerType !== "mouse") { ptr.on = 1; ptr.target = 0; }
    if (n >= 0) burst(n, true);
    wake();
  }, { passive: true });

  let rafId = 0;
  let last = 0;
  let baseY = 0;
  let heroSm = heroProgress();
  let parked = false;

  const frame = (now) => {
    rafId = 0;
    const dt = Math.min((now - (last || now)) / 1000, 0.05);
    last = now;

    const hp = heroProgress();
    heroSm += (hp - heroSm) * Math.min(1, dt * 6 || 1);
    applyFade(heroSm);

    // Past the hero the sections cover the network: park on the
    // last frame until the hero scrolls back into view.
    if (heroSm > 0.98 && hp > 0.98) {
      if (!parked) { parked = true; draw(updatePulses(0)); }
      return;
    }
    parked = false;
    const step = dt;
    time += step;

    const follow = Math.min(1, step * 10);
    ptr.x += (ptr.tx - ptr.x) * follow;
    ptr.y += (ptr.ty - ptr.y) * follow;
    ptr.on += (ptr.target - ptr.on) * Math.min(1, step * (ptr.target ? 5 : 1.6));
    flash.amt = Math.max(0, flash.amt - step * 1.6);
    if (flash.amt === 0) flash.node = -1;

    baseY += step * 0.03;
    view.ry += (baseY + heroSm * 0.4 + targetRY - view.ry) * Math.min(1, step * 3);
    view.rx += (Math.sin(time * 0.07) * 0.06 - heroSm * 0.08 + targetRX - view.rx) * Math.min(1, step * 3);
    setRot(rot, view.rx, view.ry);
    setRot(baseRot, 0, baseY * 0.4);
    view.camZ = 46 - 8 * heroSm;
    placeNetwork(heroSm);

    draw(updatePulses(step));
    rafId = requestAnimationFrame(frame);
  };

  function wake() {
    if (!rafId && !document.hidden) { last = 0; rafId = requestAnimationFrame(frame); }
  }
  const stop = () => { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } };

  window.addEventListener("scroll", wake, { passive: true });
  window.addEventListener("resize", () => { resize(); wake(); });
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : wake()));
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); stop(); fail(); root.classList.remove("nn-live"); });
  mqReduced.addEventListener("change", (e) => { if (e.matches) stop(); });

  wake();
})();
