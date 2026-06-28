// Application entry point — the composition root for the Revolver Roulette
// single-player prototype.
//
// This file contains NO game rules. It only WIRES the pieces together:
//   - constructs a GameController (the only stateful coordinator),
//   - constructs the Renderer (PixiJS) and AudioSystem (Howler),
//   - subscribes the Renderer to state changes and drives renderer feedback +
//     audio from the controller's event stream,
//   - builds the player control panel and routes its clicks into
//     `controller.submitPlayerAction`,
//   - starts the Match.
//
// All authoritative game logic lives in the pure engine reached through the
// controller; this module never inspects or mutates state for rules purposes.

import { GameController } from "./controller/gameController";
import { Renderer } from "./render/renderer";
import { AudioSystem } from "./audio/audioSystem";
import { DEFAULT_CONFIG } from "./engine/lifecycle";
import { remainingCounts } from "./engine/cylinder";
import { SeededRng, SystemRng, type RNG } from "./rng/rng";
import { ActionPanel } from "./app/controls";

/**
 * Resolve the randomness source. By default play is non-deterministic
 * (`SystemRng`). For reproducible sessions a seed may be supplied via the URL
 * query, e.g. `?seed=123`, which selects a deterministic `SeededRng`.
 */
function resolveRng(): RNG {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("seed");
    if (raw !== null && raw.trim() !== "") {
      const seed = Number.parseInt(raw, 10);
      if (Number.isFinite(seed)) {
        return new SeededRng(seed);
      }
    }
  } catch {
    // Ignore malformed location/search; fall through to the system RNG.
  }
  return new SystemRng();
}

/** Build the page layout: a canvas host for the renderer and a controls host. */
function buildLayout(app: HTMLElement): {
  canvasHost: HTMLElement;
  controlsHost: HTMLElement;
} {
  app.textContent = "";

  const root = document.createElement("div");
  root.className = "rr-root";
  root.style.position = "relative";
  root.style.display = "flex";
  root.style.flexDirection = "column";
  root.style.alignItems = "center";
  root.style.gap = "12px";

  const canvasHost = document.createElement("div");
  canvasHost.className = "rr-canvas-host";

  const controlsHost = document.createElement("div");
  controlsHost.className = "rr-controls-host";

  root.append(canvasHost, controlsHost);
  app.appendChild(root);

  return { canvasHost, controlsHost };
}

/** Construct, wire, and start the game. Resolves once the Match has begun. */
async function bootstrap(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;

  const { canvasHost, controlsHost } = buildLayout(app);

  // --- Core + presentation systems -------------------------------------
  const controller = new GameController({ rng: resolveRng() });
  const renderer = new Renderer();
  const audio = new AudioSystem();
  audio.init();

  // The ambient drone (Requirement 9.1) must start on a USER GESTURE: browsers
  // block audio autoplay until the user first interacts with the page. We latch
  // it to the first control interaction below.
  let ambientStarted = false;
  const startAmbientOnce = (): void => {
    if (ambientStarted) return;
    ambientStarted = true;
    audio.startAmbient();
  };

  // --- Player controls --------------------------------------------------
  const panel = new ActionPanel({
    onAction: (action) => controller.submitPlayerAction(action),
    onInteract: () => {
      startAmbientOnce(); // first user gesture unlocks/starts ambient audio
      audio.playUiBlip(); // UI blip on every control interaction (Req 9.6)
    },
  });
  panel.mount(controlsHost);

  // --- Wire the controller's outputs to presentation -------------------
  // State changes drive the Renderer and refresh the control affordances.
  controller.onStateChange((state) => {
    renderer.render(state);
    panel.update(state);
  });

  // Events drive renderer action-feedback and all audio. Tension is derived
  // from the live cylinder: remaining (live + blank) over the loaded size.
  controller.onEvents((events) => {
    for (const event of events) {
      renderer.playActionFeedback(event);
    }
    audio.handleEvents(events);

    const { cylinder } = controller.getState();
    const counts = remainingCounts(cylinder);
    audio.setTension(counts.live + counts.blank, cylinder.size);
  });

  // --- Renderer init (async; degrades gracefully) ----------------------
  // If the WebGL/canvas context cannot be created, show the "unavailable"
  // overlay but keep running: the game logic and controls still work (Req 8.5).
  const result = await renderer.init(canvasHost);
  if (!result.ok) {
    renderer.showRenderUnavailable();
  } else {
    renderer.start();
  }

  // --- Begin the Match --------------------------------------------------
  // Started AFTER the renderer is initialized so the initial state's first
  // render is not lost.
  controller.start(DEFAULT_CONFIG);
}

void bootstrap();
