/* Heval Söğüt — 3D neural-network background
   Scroll is a journey into the network: it begins as a small core
   behind the hero, then branches grow outward (BFS from a root
   neuron, like dendrites extending), the camera dollies forward
   into the cloud, energy rises, and more signals fire.
   Each page section owns one neuron: entering the section turns
   the camera toward it, flares it with a pulsing ring, converges
   signals on it, and floats its designation label beside it. */
import * as THREE from "./vendor/three.module.min.js";

(() => {
  "use strict";

  const canvas = document.getElementById("neural-bg");
  if (!canvas) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const ACID = new THREE.Color("#C6F222");
  const GRAY = new THREE.Color("#9AA0A6");

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
  const CAM_FAR = 46;   // hero: outside, observing
  const CAM_NEAR = 21;  // page end: inside the cloud
  camera.position.z = CAM_FAR;

  const group = new THREE.Group();
  scene.add(group);

  /* ------------------------------------------------------------
     Build the network: nodes scattered in a flattened ellipsoid,
     each wired to its nearest neighbours.
     ------------------------------------------------------------ */
  const NODE_COUNT = 150;
  const RADII = { x: 36, y: 19, z: 17 };
  const MAX_LINK_DIST = 12;
  const LINKS_PER_NODE = 3;

  // Deterministic PRNG so the layout is identical on every visit.
  let seed = 20260611;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const nodes = [];
  while (nodes.length < NODE_COUNT) {
    const x = (rand() * 2 - 1), y = (rand() * 2 - 1), z = (rand() * 2 - 1);
    if (x * x + y * y + z * z > 1) continue;
    nodes.push(new THREE.Vector3(x * RADII.x, y * RADII.y, z * RADII.z));
  }

  const edges = [];
  const edgeSet = new Set();
  const adj = Array.from({ length: NODE_COUNT }, () => []);
  for (let i = 0; i < nodes.length; i++) {
    const dists = [];
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const d = nodes[i].distanceTo(nodes[j]);
      if (d < MAX_LINK_DIST) dists.push([d, j]);
    }
    dists.sort((a, b) => a[0] - b[0]);
    for (const [, j] of dists.slice(0, LINKS_PER_NODE)) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push([i, j]);
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }

  // Edges incident to each node — used to converge pulses on the
  // active section neuron.
  const incident = Array.from({ length: NODE_COUNT }, () => []);
  edges.forEach((e, i) => { incident[e[0]].push(i); incident[e[1]].push(i); });

  /* ------------------------------------------------------------
     Growth order: BFS from the neuron nearest the centre, so the
     network grows outward like dendrites as you scroll. Each node
     gets a birth time in [0, 1]; each edge inherits its child's.
     ------------------------------------------------------------ */
  let root = 0, best = Infinity;
  nodes.forEach((p, i) => {
    const d = p.length();
    if (d < best) { best = d; root = i; }
  });

  const depth = new Array(NODE_COUNT).fill(-1);
  depth[root] = 0;
  const queue = [root];
  let maxDepth = 0;
  while (queue.length) {
    const i = queue.shift();
    for (const j of adj[i]) {
      if (depth[j] === -1) {
        depth[j] = depth[i] + 1;
        maxDepth = Math.max(maxDepth, depth[j]);
        queue.push(j);
      }
    }
  }
  // Disconnected islands join at the end of the growth.
  const birth = nodes.map((_, i) => {
    const d = depth[i] === -1 ? maxDepth : depth[i];
    return Math.min(1, d / maxDepth + (rand() - 0.5) * 0.08);
  });

  /* ------------------------------------------------------------
     Scroll mapping. The hero shows the young core; the full
     network exists by the time the footer arrives.
     ------------------------------------------------------------ */
  const GROWTH_MIN = 0.46;
  const growthAt = (p) => GROWTH_MIN + (1.04 - GROWTH_MIN) * p;

  const scrollProgress = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
  };

  /* ------------------------------------------------------------
     Section neurons: one designated neuron per page section.
     Each is picked on the growth frontier of the moment its
     section scrolls in, far from the previously chosen ones.
     ------------------------------------------------------------ */
  // ndc: where this section's neuron parks on screen, tuned per
  // section so it never hides behind opaque content (e.g. the
  // skills cards fill the middle of the viewport).
  const SECTION_DEFS = [
    { id: "about",      num: "01", name: "ABOUT",      ndc: { x: 0.05, y: 0.45 } },
    { id: "experience", num: "02", name: "EXPERIENCE", ndc: { x: 0.55, y: 0.25 } },
    { id: "skills",     num: "03", name: "SKILLS",     ndc: { x: 0.45, y: 0.62 } },
    { id: "projects",   num: "04", name: "PROJECTS",   ndc: { x: 0.55, y: 0.10 } },
    { id: "contact",    num: "05", name: "CONTACT",    ndc: { x: 0.50, y: 0.15 } },
  ];
  const secEls = SECTION_DEFS.map((d) => document.getElementById(d.id));

  // Scroll progress at which each section takes over.
  let secStarts = SECTION_DEFS.map(() => 1);
  const computeSecStarts = () => {
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    secStarts = secEls.map((el) =>
      el ? Math.min(1, Math.max(0, (el.offsetTop - window.innerHeight * 0.45) / max)) : 1
    );
  };
  computeSecStarts();
  window.addEventListener("load", computeSecStarts);

  const sectionNode = [];
  for (let k = 0; k < SECTION_DEFS.length; k++) {
    // must already be grown shortly after the section appears,
    // ideally right on the frontier (newly grown = newly "thought")
    const g = growthAt(Math.min(1, secStarts[k] + 0.04));
    let bestI = root, bestScore = -Infinity;
    for (let i = 0; i < NODE_COUNT; i++) {
      if (birth[i] > g - 0.05) continue;
      let minD = nodes[i].length(); // distance from root area
      for (const prev of sectionNode) {
        minD = Math.min(minD, nodes[i].distanceTo(nodes[prev]));
      }
      const score = minD + birth[i] * 20;
      if (score > bestScore) { bestScore = score; bestI = i; }
    }
    sectionNode.push(bestI);
  }

  /* ------------------------------------------------------------
     The journey: one continuous polyline along network edges,
     root → 01 → 02 → … → 05, found with BFS. A shining head
     travels it as you scroll, pausing on each section's neuron;
     behind it the way stays faintly lit.
     ------------------------------------------------------------ */
  const shortestPath = (a, b) => {
    if (a === b) return [a];
    const prev = new Array(NODE_COUNT).fill(-1);
    const q = [a];
    prev[a] = a;
    while (q.length) {
      const i = q.shift();
      if (i === b) break;
      for (const j of adj[i]) {
        if (prev[j] === -1) { prev[j] = i; q.push(j); }
      }
    }
    if (prev[b] === -1) return null;
    const path = [b];
    while (path[path.length - 1] !== a) path.push(prev[path[path.length - 1]]);
    return path.reverse();
  };

  const journeyPts = []; // group-local points along the whole route
  const journeyJ = [];   // journey coordinate: neuron k sits at J = k+1
  {
    let from = root;
    sectionNode.forEach((s, k) => {
      const path = shortestPath(from, s) || [from, s];
      const pts = path.map((i) => nodes[i]);
      let total = 0;
      const cum = pts.map((p, i) => (total += i ? p.distanceTo(pts[i - 1]) : 0));
      pts.forEach((p, i) => {
        journeyPts.push(p);
        journeyJ.push(k + (total > 0 ? cum[i] / total : 1));
      });
      from = s;
    });
  }
  const J_END = sectionNode.length;

  const sampleJourney = (J, out) => {
    let i = 1;
    while (i < journeyJ.length - 1 && journeyJ[i] < J) i++;
    const a = journeyJ[i - 1], b = journeyJ[i];
    const t = b > a ? Math.min(1, Math.max(0, (J - a) / (b - a))) : 0;
    out.lerpVectors(journeyPts[i - 1], journeyPts[i], t);
  };

  /* ------------------------------------------------------------
     Shared shader chunk: fade with view depth — the far side
     dissolves into the dark, and things about to hit the camera
     fade out instead of ballooning.
     ------------------------------------------------------------ */
  const depthFade = `
    float depthFade(float viewZ) {
      return smoothstep(95.0, 32.0, viewZ) * smoothstep(2.5, 9.0, viewZ);
    }
  `;

  /* ---------------- neurons (points) ---------------- */
  const nodePos = new Float32Array(NODE_COUNT * 3);
  const nodeSize = new Float32Array(NODE_COUNT);
  const nodeAcid = new Float32Array(NODE_COUNT); // 1 = acid hub, 0 = gray
  const nodeBirth = new Float32Array(NODE_COUNT);
  const nodeSec = new Float32Array(NODE_COUNT).fill(-1);
  nodes.forEach((p, i) => {
    nodePos.set([p.x, p.y, p.z], i * 3);
    const hub = rand() < 0.18;
    nodeAcid[i] = hub ? 1 : 0;
    nodeSize[i] = hub ? 2.6 + rand() * 1.4 : 1.1 + rand() * 0.9;
    nodeBirth[i] = birth[i];
  });
  sectionNode.forEach((i, k) => {
    nodeSec[i] = k;
    nodeAcid[i] = 1;
    nodeSize[i] = 3.4;
  });

  const nodeGeo = new THREE.BufferGeometry();
  nodeGeo.setAttribute("position", new THREE.BufferAttribute(nodePos, 3));
  nodeGeo.setAttribute("aSize", new THREE.BufferAttribute(nodeSize, 1));
  nodeGeo.setAttribute("aAcid", new THREE.BufferAttribute(nodeAcid, 1));
  nodeGeo.setAttribute("aBirth", new THREE.BufferAttribute(nodeBirth, 1));
  nodeGeo.setAttribute("aSec", new THREE.BufferAttribute(nodeSec, 1));

  const secAct = new Float32Array(SECTION_DEFS.length); // activation per section

  const nodeMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uAcid: { value: ACID },
      uGray: { value: GRAY },
      uTime: { value: 0 },
      uGrowth: { value: 0 },
      uEnergy: { value: 0 },
      uSecAct: { value: secAct },
    },
    vertexShader: `
      attribute float aSize;
      attribute float aAcid;
      attribute float aBirth;
      attribute float aSec;
      varying float vAcid;
      varying float vFade;
      varying float vEnergy;
      varying float vAct;
      uniform float uTime;
      uniform float uGrowth;
      uniform float uEnergy;
      uniform float uSecAct[${SECTION_DEFS.length}];
      ${depthFade}
      void main() {
        vAcid = aAcid;
        vAct = aSec > -0.5 ? uSecAct[int(aSec + 0.5)] : 0.0;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFade = depthFade(-mv.z);
        // birth: pop in with a brief overshoot as growth passes us
        float g = smoothstep(aBirth, aBirth + 0.06, uGrowth);
        float pop = 1.0 + 0.6 * sin(min(g, 1.0) * 3.14159) * (1.0 - g);
        vEnergy = uEnergy;
        // hubs breathe slowly, out of phase; faster when energised
        float pulse = aAcid * 0.35 * sin(uTime * (1.4 + uEnergy * 1.2) + position.x + position.y * 2.0);
        // the active section neuron swells to make room for its ring
        float size = (aSize + pulse) * g * pop * (1.0 + vAct * 1.8) * (140.0 / -mv.z);
        gl_PointSize = min(size, 64.0);
        vFade *= g;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying float vAcid;
      varying float vFade;
      varying float vEnergy;
      varying float vAct;
      uniform vec3 uAcid;
      uniform vec3 uGray;
      uniform float uTime;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv) * 2.0;
        float core = smoothstep(0.5, 0.0, d);
        float halo = smoothstep(1.0, 0.2, d) * (0.35 + vEnergy * 0.25);
        // pulsing targeting-ring around the active section neuron
        float ringR = 0.62 + 0.16 * sin(uTime * 2.4);
        float ring = smoothstep(0.12, 0.02, abs(d - ringR)) * vAct;
        vec3 col = mix(uGray, uAcid, max(vAcid, vAct));
        float a = (core + halo) * vFade * mix(0.5, 0.9 + vEnergy * 0.1, vAcid)
                + ring * 0.85 * vFade;
        if (a < 0.01) discard;
        gl_FragColor = vec4(col, a);
      }
    `,
  });
  group.add(new THREE.Points(nodeGeo, nodeMat));

  /* ---------------- synapses (growing lines) ----------------
     Each edge is oriented parent → child and clipped in the
     fragment shader, so branches visibly extend outward. */
  const linePos = new Float32Array(edges.length * 2 * 3);
  const lineEnd = new Float32Array(edges.length * 2);   // 0 at parent, 1 at child
  const lineBirth = new Float32Array(edges.length * 2); // when this edge starts growing
  edges.forEach(([a, b], i) => {
    const parent = birth[a] <= birth[b] ? a : b;
    const child = parent === a ? b : a;
    linePos.set([nodes[parent].x, nodes[parent].y, nodes[parent].z], i * 6);
    linePos.set([nodes[child].x, nodes[child].y, nodes[child].z], i * 6 + 3);
    lineEnd[i * 2] = 0;
    lineEnd[i * 2 + 1] = 1;
    lineBirth[i * 2] = lineBirth[i * 2 + 1] = birth[parent];
  });
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
  lineGeo.setAttribute("aEnd", new THREE.BufferAttribute(lineEnd, 1));
  lineGeo.setAttribute("aBirth", new THREE.BufferAttribute(lineBirth, 1));

  const lineMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uGray: { value: GRAY },
      uAcid: { value: ACID },
      uGrowth: { value: 0 },
      uEnergy: { value: 0 },
    },
    vertexShader: `
      attribute float aEnd;
      attribute float aBirth;
      varying float vFade;
      varying float vEnd;
      varying float vBirth;
      ${depthFade}
      void main() {
        vEnd = aEnd;
        vBirth = aBirth;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFade = depthFade(-mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying float vFade;
      varying float vEnd;
      varying float vBirth;
      uniform vec3 uGray;
      uniform vec3 uAcid;
      uniform float uGrowth;
      uniform float uEnergy;
      void main() {
        // how far along this edge the growth front has reached
        float reach = clamp((uGrowth - vBirth) * 9.0, 0.0, 1.0);
        if (vEnd > reach) discard;
        // glowing acid tip right at the growth front
        float tip = smoothstep(0.25, 0.0, reach - vEnd) * step(reach, 0.999);
        vec3 col = mix(uGray, uAcid, tip);
        float a = (0.15 + uEnergy * 0.12 + tip * 0.5) * vFade;
        gl_FragColor = vec4(col, a);
      }
    `,
  });
  group.add(new THREE.LineSegments(lineGeo, lineMat));

  /* ---------------- signal pulses ----------------
     Only travel along edges that have already grown; more of them
     wake up as energy rises, and they bias toward the synapses of
     the active section neuron — thoughts converging on it. */
  const PULSE_COUNT = 40;
  const edgeBirth = edges.map(([a, b]) => Math.max(birth[a], birth[b]));
  const pulses = Array.from({ length: PULSE_COUNT }, (_, i) => ({
    edge: 0,
    t: rand(),
    speed: 0.16 + rand() * 0.3, // edge-lengths per second
    active: i / PULSE_COUNT,    // wakes when energy passes this
  }));

  const pickEdge = (growth, focusNode) => {
    if (focusNode >= 0 && Math.random() < 0.22) {
      const local = incident[focusNode].filter((i) => edgeBirth[i] <= growth);
      if (local.length) return local[(Math.random() * local.length) | 0];
    }
    for (let tries = 0; tries < 12; tries++) {
      const i = (Math.random() * edges.length) | 0;
      if (edgeBirth[i] <= growth) return i;
    }
    return 0;
  };
  pulses.forEach((p) => { p.edge = pickEdge(GROWTH_MIN, -1); });

  const pulsePos = new Float32Array(PULSE_COUNT * 3);
  const pulseAlpha = new Float32Array(PULSE_COUNT);
  const pulseGeo = new THREE.BufferGeometry();
  pulseGeo.setAttribute("position", new THREE.BufferAttribute(pulsePos, 3));
  pulseGeo.setAttribute("aAlpha", new THREE.BufferAttribute(pulseAlpha, 1));
  const pulsePosAttr = pulseGeo.getAttribute("position");
  const pulseAlphaAttr = pulseGeo.getAttribute("aAlpha");

  const pulseMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uAcid: { value: ACID } },
    vertexShader: `
      attribute float aAlpha;
      varying float vFade;
      varying float vAlpha;
      ${depthFade}
      void main() {
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFade = depthFade(-mv.z);
        gl_PointSize = min(3.2 * (140.0 / -mv.z), 26.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying float vFade;
      varying float vAlpha;
      uniform vec3 uAcid;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv) * 2.0;
        float glow = smoothstep(1.0, 0.0, d);
        float a = glow * glow * vFade * vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uAcid, a);
      }
    `,
  });
  group.add(new THREE.Points(pulseGeo, pulseMat));

  const updatePulses = (dt, growth, energy, focusNode) => {
    const v = new THREE.Vector3();
    pulses.forEach((p, i) => {
      const awake = p.active <= 0.25 + energy * 0.75;
      if (awake) {
        p.t += p.speed * dt;
        if (p.t > 1) {
          p.t = 0;
          p.edge = pickEdge(growth, focusNode);
        }
      }
      const [a, b] = edges[p.edge];
      v.lerpVectors(nodes[a], nodes[b], p.t);
      pulsePosAttr.setXYZ(i, v.x, v.y, v.z);
      // fade near the edge ends, hide while asleep or edge ungrown
      const ends = Math.min(1, Math.min(p.t, 1 - p.t) * 5);
      pulseAlphaAttr.setX(i, awake && edgeBirth[p.edge] <= growth ? ends : 0);
    });
    pulsePosAttr.needsUpdate = true;
    pulseAlphaAttr.needsUpdate = true;
  };

  /* ---------------- distant dust ----------------
     A far shell of faint particles that parallaxes slower than the
     network — gives the dolly real depth. */
  const DUST_COUNT = 220;
  const dustPos = new Float32Array(DUST_COUNT * 3);
  for (let i = 0; i < DUST_COUNT; i++) {
    const r = 70 + rand() * 60;
    const th = rand() * Math.PI * 2;
    const ph = Math.acos(rand() * 2 - 1);
    dustPos.set([
      r * Math.sin(ph) * Math.cos(th),
      r * Math.cos(ph) * 0.6,
      r * Math.sin(ph) * Math.sin(th),
    ], i * 3);
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({
    color: GRAY,
    size: 0.5,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  scene.add(dust);

  /* ---------------- journey path + comet head ---------------- */
  const jPos = new Float32Array(journeyPts.length * 3);
  journeyPts.forEach((p, i) => jPos.set([p.x, p.y, p.z], i * 3));
  const journeyGeo = new THREE.BufferGeometry();
  journeyGeo.setAttribute("position", new THREE.BufferAttribute(jPos, 3));
  journeyGeo.setAttribute("aJ", new THREE.BufferAttribute(new Float32Array(journeyJ), 1));

  const journeyMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uAcid: { value: ACID },
      uHead: { value: 0 },
    },
    vertexShader: `
      attribute float aJ;
      varying float vJ;
      varying float vFade;
      ${depthFade}
      void main() {
        vJ = aJ;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFade = depthFade(-mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying float vJ;
      varying float vFade;
      uniform vec3 uAcid;
      uniform float uHead;
      void main() {
        float d = uHead - vJ;        // >0 behind the head
        float head = exp(-d * d * 240.0);          // bright comet
        float visited = smoothstep(0.0, 0.1, d) * 0.26; // lit trail
        float a = (visited + head * 0.95) * vFade;
        if (a < 0.012) discard;
        gl_FragColor = vec4(uAcid, a);
      }
    `,
  });
  group.add(new THREE.Line(journeyGeo, journeyMat));

  const headGeo = new THREE.BufferGeometry();
  headGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
  const headMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uAcid: { value: ACID } },
    vertexShader: `
      varying float vFade;
      ${depthFade}
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFade = depthFade(-mv.z);
        gl_PointSize = min(6.5 * (140.0 / -mv.z), 44.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying float vFade;
      uniform vec3 uAcid;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv) * 2.0;
        float glow = smoothstep(1.0, 0.0, d);
        float a = glow * glow * vFade;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uAcid, a);
      }
    `,
  });
  const headPoint = new THREE.Points(headGeo, headMat);
  group.add(headPoint);

  /* ---------------- section neuron labels ----------------
     Tiny mono designations that float beside the active neuron,
     projected from 3D every frame. */
  let labelEls = [];
  if (!reducedMotion) {
    const wrap = document.createElement("div");
    wrap.className = "neuron-labels";
    wrap.setAttribute("aria-hidden", "true");
    labelEls = SECTION_DEFS.map((d) => {
      const s = document.createElement("span");
      s.className = "neuron-label";
      s.innerHTML = `<b>${d.num}</b>${d.name}`;
      wrap.appendChild(s);
      return s;
    });
    document.body.appendChild(wrap);
  }

  /* ------------------------------------------------------------
     Sizing, scroll, parallax, animation loop
     ------------------------------------------------------------ */
  const resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    computeSecStarts();
  };
  resize();
  window.addEventListener("resize", resize);

  let targetRX = 0, targetRY = 0;
  if (!reducedMotion && window.matchMedia("(pointer: fine)").matches) {
    window.addEventListener("pointermove", (e) => {
      targetRY = (e.clientX / window.innerWidth - 0.5) * 0.22;
      targetRX = (e.clientY / window.innerHeight - 0.5) * 0.14;
    }, { passive: true });
  }

  if (reducedMotion) {
    // Static frame, mid-journey: grown network, no motion.
    nodeMat.uniforms.uGrowth.value = 1.04;
    lineMat.uniforms.uGrowth.value = 1.04;
    nodeMat.uniforms.uEnergy.value = 0.5;
    lineMat.uniforms.uEnergy.value = 0.5;
    journeyMat.uniforms.uHead.value = J_END;
    const headAt = new THREE.Vector3();
    sampleJourney(J_END, headAt);
    headPoint.position.copy(headAt);
    updatePulses(0, 1.04, 0.5, -1);
    renderer.render(scene, camera);
    window.addEventListener("resize", () => renderer.render(scene, camera));
    return;
  }

  const clock = new THREE.Clock();
  let baseY = 0;
  let prog = scrollProgress(); // smoothed scroll progress
  let headSm = -1;             // smoothed journey-head position
  let rafId = null;
  const _world = new THREE.Vector3();
  const _ray = new THREE.Vector3();
  const _anchorPt = new THREE.Vector3();
  const _groupTarget = new THREE.Vector3();
  const _v = new THREE.Vector3();

  const frame = () => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    prog += (scrollProgress() - prog) * Math.min(1, dt * 4.5);
    const growth = growthAt(prog);
    const energy = prog;

    // which section owns the viewport right now (-1 = hero)
    let activeIdx = -1;
    for (let k = 0; k < secStarts.length; k++) {
      if (prog >= secStarts[k]) activeIdx = k;
    }
    for (let k = 0; k < secAct.length; k++) {
      secAct[k] += ((k === activeIdx ? 1 : 0) - secAct[k]) * Math.min(1, dt * 3);
    }

    // camera dolly: glide into the cloud as the page descends
    camera.position.z = CAM_FAR + (CAM_NEAR - CAM_FAR) * prog;
    camera.position.y = Math.sin(prog * Math.PI) * 2.5;

    baseY += dt * 0.03; // slow perpetual drift
    const scrollSpin = prog * 0.55;
    group.rotation.y += (baseY + scrollSpin + targetRY - group.rotation.y) * 0.05;
    group.rotation.x += (Math.sin(t * 0.07) * 0.06 - prog * 0.1 + targetRX - group.rotation.x) * 0.05;
    dust.rotation.y = (group.rotation.y - baseY) * 0.35 + baseY * 0.4;
    group.updateMatrixWorld();

    // journey head: rests on the current neuron, sets off late in
    // the section, arrives as the next section takes over
    let headJ, travel = 0;
    const nextK = activeIdx + 1;
    if (nextK >= sectionNode.length) {
      headJ = J_END;
    } else {
      const s0 = activeIdx < 0 ? 0 : secStarts[activeIdx];
      const s1 = secStarts[nextK];
      const local = s1 > s0 ? (prog - s0) / (s1 - s0) : 1;
      travel = THREE.MathUtils.smoothstep(local, 0.45, 0.98);
      headJ = activeIdx + 1 + travel;
    }
    headSm = headSm < 0 ? headJ : headSm + (headJ - headSm) * Math.min(1, dt * 3);
    journeyMat.uniforms.uHead.value = headSm;
    sampleJourney(headSm, _v);
    headPoint.position.copy(_v);

    // glide the whole network so the journey head — and therefore
    // the neuron it rests on — stays at the on-screen anchor. While
    // the comet travels, the anchor eases between the two sections'
    // parking spots, so the camera follows it along the branches.
    const HERO_NDC = { x: 0.30, y: 0.05 };
    const fromNdc = activeIdx >= 0 ? SECTION_DEFS[activeIdx].ndc : HERO_NDC;
    const toNdc = SECTION_DEFS[Math.min(nextK, SECTION_DEFS.length - 1)].ndc;
    let ax, ay;
    if (window.innerWidth < 760) {
      ax = 0.30; ay = -0.30;
    } else {
      ax = fromNdc.x + (toNdc.x - fromNdc.x) * travel;
      ay = fromNdc.y + (toNdc.y - fromNdc.y) * travel;
    }
    _world.copy(_v).applyMatrix4(group.matrixWorld);
    _ray.set(ax, ay, 0.5).unproject(camera).sub(camera.position).normalize();
    _anchorPt.copy(camera.position).addScaledVector(_ray, 27);
    _groupTarget.copy(group.position).add(_anchorPt).sub(_world);
    group.position.lerp(_groupTarget, Math.min(1, dt * 2.0));
    group.updateMatrixWorld();

    // float each label beside its neuron while its section is live
    labelEls.forEach((el, k) => {
      const a = secAct[k];
      if (a < 0.02) { el.style.opacity = "0"; return; }
      _v.copy(nodes[sectionNode[k]]).applyMatrix4(group.matrixWorld).project(camera);
      if (_v.z > 1) { el.style.opacity = "0"; return; }
      const x = (_v.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-_v.y * 0.5 + 0.5) * window.innerHeight;
      el.style.opacity = String(a * 0.95);
      el.style.transform = `translate(${x + 18}px, ${y - 10}px)`;
    });

    nodeMat.uniforms.uTime.value = t;
    nodeMat.uniforms.uGrowth.value = growth;
    nodeMat.uniforms.uEnergy.value = energy;
    lineMat.uniforms.uGrowth.value = growth;
    lineMat.uniforms.uEnergy.value = energy;
    updatePulses(dt, growth, energy, activeIdx >= 0 ? sectionNode[activeIdx] : -1);

    renderer.render(scene, camera);
    rafId = requestAnimationFrame(frame);
  };

  const start = () => { if (!rafId) { clock.getDelta(); rafId = requestAnimationFrame(frame); } };
  const stop = () => { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } };

  document.addEventListener("visibilitychange", () =>
    document.hidden ? stop() : start()
  );
  start();
})();
