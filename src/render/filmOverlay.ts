// Film overlay (Phase 1 visual remake): a DOM-based post layer that sits over
// the WebGL canvas — animated film grain, a heavy vignette and CRT scanlines
// for the analog-horror look. Pure presentation: pointer-events pass through,
// no game state is read, and it is a no-op without a DOM (tests, SSR).

const STYLE_ID = "rr-film-overlay-style";
const FILM_CLASS = "rr-film";
const SCAN_CLASS = "rr-scanlines";

// A tiny tileable fractal-noise SVG, data-URI encoded (no asset request).
const NOISE_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E";

const CSS = `
.${FILM_CLASS} {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 5;
  overflow: hidden;
}
.${FILM_CLASS}::before {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at center, transparent 55%, rgba(0, 0, 0, 0.55) 100%);
}
.${FILM_CLASS}::after {
  content: "";
  position: absolute;
  inset: -100%;
  background-image: url("${NOISE_URL}");
  opacity: 0.07;
  animation: rr-grain 0.45s steps(4) infinite;
}
@keyframes rr-grain {
  0% { transform: translate(0, 0); }
  25% { transform: translate(-3%, 2%); }
  50% { transform: translate(2%, -3%); }
  75% { transform: translate(-2%, -2%); }
  100% { transform: translate(3%, 3%); }
}
.${SCAN_CLASS} {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 6;
  background: repeating-linear-gradient(
    0deg,
    rgba(0, 0, 0, 0.12),
    rgba(0, 0, 0, 0.12) 1px,
    transparent 1px,
    transparent 3px
  );
  mix-blend-mode: multiply;
}
`;

/**
 * Install the film overlay above the game canvas. Idempotent — calling it
 * twice adds nothing. Returns a disposer that removes the overlay again.
 */
export function installFilmOverlay(): () => void {
  if (typeof document === "undefined") return () => {};
  if (document.getElementById(STYLE_ID)) return () => {};

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);

  const film = document.createElement("div");
  film.className = FILM_CLASS;
  film.setAttribute("aria-hidden", "true");
  document.body.appendChild(film);

  const scan = document.createElement("div");
  scan.className = SCAN_CLASS;
  scan.setAttribute("aria-hidden", "true");
  document.body.appendChild(scan);

  return () => {
    style.remove();
    film.remove();
    scan.remove();
  };
}
