/* Heval Söğüt — portfolio interactions */
(() => {
  "use strict";

  document.documentElement.classList.add("js");

  const head = document.querySelector(".site-head");
  const toggle = document.querySelector(".nav-toggle");
  const menu = document.getElementById("mobile-menu");
  const main = document.getElementById("main");
  const foot = document.querySelector(".site-foot");

  /* ------------------------------------------------------------
     Header: solid background once the page has scrolled
     ------------------------------------------------------------ */
  const onScroll = () => head.classList.toggle("is-stuck", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ------------------------------------------------------------
     Mobile menu: inert page behind it, Escape closes, focus
     returns to the toggle
     ------------------------------------------------------------ */
  if (toggle && menu) {
    const setOpen = (open, restoreFocus) => {
      toggle.setAttribute("aria-expanded", String(open));
      menu.hidden = !open;
      head.classList.toggle("is-open", open);
      document.body.style.overflow = open ? "hidden" : "";
      [main, foot].forEach((el) => { if (el) el.inert = open; });
      if (open) {
        const first = menu.querySelector("a");
        if (first) first.focus();
      } else if (restoreFocus) {
        toggle.focus();
      }
    };
    toggle.addEventListener("click", () =>
      setOpen(toggle.getAttribute("aria-expanded") !== "true", true)
    );
    menu.querySelectorAll("a").forEach((a) =>
      a.addEventListener("click", () => setOpen(false, false))
    );
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !menu.hidden) setOpen(false, true);
    });
    window.matchMedia("(min-width: 880px)").addEventListener("change", (e) => {
      if (e.matches && !menu.hidden) setOpen(false, false);
    });
  }

  /* ------------------------------------------------------------
     Mark the nav link for the section currently in view
     ------------------------------------------------------------ */
  const links = [...document.querySelectorAll(".site-nav a")];
  const sections = links
    .map((a) => document.querySelector(a.getAttribute("href")))
    .filter(Boolean);

  if (sections.length && "IntersectionObserver" in window) {
    const visible = new Map();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => visible.set(e.target.id, e.isIntersecting));
      const current = sections.find((s) => visible.get(s.id));
      links.forEach((a) => {
        if (current && a.getAttribute("href") === `#${current.id}`) {
          a.setAttribute("aria-current", "true");
        } else {
          a.removeAttribute("aria-current");
        }
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    sections.forEach((s) => io.observe(s));
  }
})();
