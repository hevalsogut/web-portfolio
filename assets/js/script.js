/* Heval Söğüt — portfolio interactions */
(() => {
  "use strict";

  document.documentElement.classList.add("js");

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------
     Scroll reveals
     ------------------------------------------------------------ */
  const revealEls = document.querySelectorAll(".reveal");
  if (reducedMotion || !("IntersectionObserver" in window)) {
    revealEls.forEach((el) => el.classList.add("is-in"));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 }
    );
    revealEls.forEach((el) => io.observe(el));
  }

  /* ------------------------------------------------------------
     Mobile menu
     ------------------------------------------------------------ */
  const toggle = document.querySelector(".nav-toggle");
  const menu = document.getElementById("mobile-menu");
  if (toggle && menu) {
    const setOpen = (open) => {
      toggle.setAttribute("aria-expanded", String(open));
      menu.hidden = !open;
      document.body.style.overflow = open ? "hidden" : "";
    };
    toggle.addEventListener("click", () =>
      setOpen(toggle.getAttribute("aria-expanded") !== "true")
    );
    menu.querySelectorAll("a").forEach((a) =>
      a.addEventListener("click", () => setOpen(false))
    );
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !menu.hidden) setOpen(false);
    });
  }

  /* ------------------------------------------------------------
     Custom cursor (fine pointers, motion allowed)
     ------------------------------------------------------------ */
  const cursor = document.querySelector(".cursor");
  if (cursor && !reducedMotion && window.matchMedia("(pointer: fine)").matches) {
    const dot = cursor.querySelector(".cursor-dot");
    const ring = cursor.querySelector(".cursor-ring");
    let mx = -100, my = -100, rx = -100, ry = -100;

    window.addEventListener("pointermove", (e) => {
      mx = e.clientX;
      my = e.clientY;
    }, { passive: true });

    const loop = () => {
      rx += (mx - rx) * 0.16;
      ry += (my - ry) * 0.16;
      dot.style.transform = `translate(${mx}px, ${my}px) translate(-50%, -50%)`;
      ring.style.transform = `translate(${rx}px, ${ry}px) translate(-50%, -50%)`;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    document.querySelectorAll("a, button").forEach((el) => {
      el.addEventListener("pointerenter", () => cursor.classList.add("is-hover"));
      el.addEventListener("pointerleave", () => cursor.classList.remove("is-hover"));
    });
  }

  /* ------------------------------------------------------------
     Hero pipeline canvas — a DAG with light packets flowing
     through it: INGEST → EMBED → INDEX → RETRIEVE → GENERATE
     ------------------------------------------------------------ */
  const canvas = document.getElementById("pipeline");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const ACID = "198, 242, 34";
  const GRAY = "154, 160, 166";

  // Node layout in unit space (x: 0–1, y: 0–1), biased to the right
  // half so the hero text stays readable on desktop.
  const NODES = [
    { id: "src-a",   x: 0.52, y: 0.16, r: 3, label: "" },
    { id: "src-b",   x: 0.50, y: 0.46, r: 3, label: "" },
    { id: "src-c",   x: 0.54, y: 0.78, r: 3, label: "" },
    { id: "ingest",  x: 0.63, y: 0.42, r: 5, label: "INGEST" },
    { id: "embed",   x: 0.72, y: 0.24, r: 5, label: "EMBED" },
    { id: "index",   x: 0.80, y: 0.50, r: 5, label: "INDEX" },
    { id: "retrieve",x: 0.87, y: 0.30, r: 5, label: "RETRIEVE" },
    { id: "generate",x: 0.93, y: 0.58, r: 6, label: "GENERATE" },
    { id: "out",     x: 0.965,y: 0.82, r: 3, label: "" },
  ];
  const EDGES = [
    ["src-a", "ingest"], ["src-b", "ingest"], ["src-c", "ingest"],
    ["ingest", "embed"], ["embed", "index"], ["index", "retrieve"],
    ["retrieve", "generate"], ["index", "generate"], ["generate", "out"],
  ];

  const byId = Object.fromEntries(NODES.map((n) => [n.id, n]));
  let W = 0, H = 0, dpr = 1;
  let mouseX = -1e4, mouseY = -1e4;

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener("resize", resize);

  window.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
  }, { passive: true });

  // On narrow screens spread the graph across the full width,
  // since the text stacks above it visually anyway.
  const px = (n) => (W < 760 ? (n.x - 0.45) / 0.55 * 0.9 * W + 0.05 * W : n.x * W);
  const py = (n) => n.y * H;

  // Packets travelling along edges
  const packets = EDGES.map((e, i) => ({
    edge: e,
    t: (i * 0.37) % 1,
    speed: 0.0022 + (i % 3) * 0.0009,
  }));

  const drawStatic = () => {
    ctx.clearRect(0, 0, W, H);

    // edges
    ctx.lineWidth = 1;
    for (const [a, b] of EDGES) {
      const na = byId[a], nb = byId[b];
      ctx.strokeStyle = `rgba(${GRAY}, 0.18)`;
      ctx.beginPath();
      ctx.moveTo(px(na), py(na));
      ctx.lineTo(px(nb), py(nb));
      ctx.stroke();
    }

    // nodes
    for (const n of NODES) {
      const x = px(n), y = py(n);
      const d = Math.hypot(x - mouseX, y - mouseY);
      const near = Math.max(0, 1 - d / 180);
      const major = !!n.label;

      ctx.beginPath();
      ctx.arc(x, y, n.r + near * 2, 0, Math.PI * 2);
      if (major) {
        ctx.strokeStyle = `rgba(${ACID}, ${0.55 + near * 0.45})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 1.8, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${ACID}, ${0.7 + near * 0.3})`;
        ctx.fill();
      } else {
        ctx.fillStyle = `rgba(${GRAY}, ${0.4 + near * 0.5})`;
        ctx.fill();
      }

      if (n.label && W >= 600) {
        ctx.font = "500 10px 'JetBrains Mono', monospace";
        ctx.fillStyle = `rgba(${GRAY}, ${0.55 + near * 0.45})`;
        ctx.textAlign = "center";
        ctx.fillText(n.label, x, y - n.r - 9);
      }
    }
  };

  if (reducedMotion) {
    // Single static frame — the structure without the motion.
    drawStatic();
    window.addEventListener("resize", drawStatic);
    return;
  }

  let rafId;
  const frame = () => {
    drawStatic();

    for (const p of packets) {
      p.t += p.speed;
      if (p.t > 1) p.t -= 1;
      const na = byId[p.edge[0]], nb = byId[p.edge[1]];
      const x = px(na) + (px(nb) - px(na)) * p.t;
      const y = py(na) + (py(nb) - py(na)) * p.t;
      // fade in/out at the ends of the edge
      const a = Math.min(1, Math.min(p.t, 1 - p.t) * 6);

      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${ACID}, ${a})`;
      ctx.shadowColor = `rgba(${ACID}, 0.8)`;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    rafId = requestAnimationFrame(frame);
  };

  // Pause when the hero is off-screen or the tab is hidden.
  const start = () => { if (!rafId) rafId = requestAnimationFrame(frame); };
  const stop = () => { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } };

  new IntersectionObserver(
    ([entry]) => (entry.isIntersecting ? start() : stop())
  ).observe(canvas);

  document.addEventListener("visibilitychange", () =>
    document.hidden ? stop() : start()
  );
})();
