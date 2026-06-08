/* ============================================================
   NAVBAR — glass effect on scroll
============================================================ */
const navbar = document.getElementById('navbar');

window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 50);
}, { passive: true });

/* ============================================================
   SMOOTH SCROLL (easeInOutCubic, 1.1 s)
============================================================ */
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    const target = document.querySelector(this.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    smoothScrollTo(target, 1100);
  });
});

function smoothScrollTo(el, duration) {
  const start    = window.pageYOffset;
  const distance = el.getBoundingClientRect().top;
  let   startTime = null;

  function ease(t, b, c, d) {
    t /= d / 2;
    if (t < 1) return c / 2 * t * t * t + b;
    t -= 2;
    return c / 2 * (t * t * t + 2) + b;
  }

  function step(now) {
    if (!startTime) startTime = now;
    const elapsed = now - startTime;
    window.scrollTo(0, ease(elapsed, start, distance, duration));
    if (elapsed < duration) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

/* ============================================================
   FADE-IN ON SCROLL (staggered siblings)
============================================================ */
const fadeObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;

    const el       = entry.target;
    const siblings = Array.from(el.parentElement.querySelectorAll('.fade-in'));
    const idx      = siblings.indexOf(el);

    setTimeout(() => el.classList.add('visible'), idx * 75);
    fadeObserver.unobserve(el);
  });
}, { threshold: 0.1, rootMargin: '0px 0px -36px 0px' });

document.querySelectorAll('.fade-in').forEach(el => fadeObserver.observe(el));

/* ============================================================
   TERMINAL TYPEWRITER (hero prompt)
============================================================ */
const typedEl  = document.getElementById('typed-command');
const commands = [
  'whoami',
  'cat about.md',
  'ls ./projects',
  'python rag_pipeline.py',
  'n8n start --tunnel',
  'git log --oneline',
];

let cmdIdx   = 0;
let charIdx  = 0;
let deleting = false;
let speed    = 130;

function typeCmd() {
  if (!typedEl) return;
  const cmd = commands[cmdIdx];

  if (deleting) {
    typedEl.textContent = cmd.slice(0, charIdx - 1);
    charIdx--;
    speed = 55;
  } else {
    typedEl.textContent = cmd.slice(0, charIdx + 1);
    charIdx++;
    speed = 130;
  }

  if (!deleting && charIdx === cmd.length) {
    deleting = true;
    speed = 2400;
  } else if (deleting && charIdx === 0) {
    deleting = false;
    cmdIdx   = (cmdIdx + 1) % commands.length;
    speed    = 480;
  }

  setTimeout(typeCmd, speed);
}

typeCmd();

/* ============================================================
   ACTIVE NAV LINK HIGHLIGHT
============================================================ */
const navLinks = document.querySelectorAll('.nav-link');
const sections = document.querySelectorAll('section[id]');

const navObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const id = entry.target.id;
    navLinks.forEach(link => {
      const matches = link.getAttribute('href') === `#${id}`;
      link.classList.toggle('active', matches);
    });
  });
}, { threshold: 0.35 });

sections.forEach(s => navObserver.observe(s));
