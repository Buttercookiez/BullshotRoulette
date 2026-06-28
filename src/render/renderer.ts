// Renderer (Requirement 8): a PixiJS-backed 2.5D "paper diorama" renderer for
// Revolver Roulette, rendered dark, grimy and deadly per the approved mockup
// and the `paper-diorama-ui` skill.
//
// Design constraints honoured here:
//   - The renderer is presentation-only. It reads `GameState` and reacts to
//     `GameEvent`s but owns no rules and NEVER mutates the state it is given.
//   - PixiJS v8's `Application.init` is async, so `init` returns a Promise of a
//     Result; on a WebGL/context failure it resolves to a typed error and the
//     caller shows the "rendering unavailable" overlay while the Match state is
//     left intact (Req 8.5).
//   - A post-processing filter chain (film grain, scanlines, vignette,
//     chromatic aberration, dim-flicker) is attached to the stage root and
//     animated every ticker frame (Req 8.1-8.3). See `./filters`.
//   - HUD/feedback are derived from pure mappings in `./viewModel`, which is
//     what lets the renderer be unit-tested without a GPU.
//
// Scene art is drawn entirely with PixiJS `Graphics`/`Text` as stylized
// placeholders (no sprite assets exist yet) matching the mockup palette:
// near-black base, a sickly-green accent, and blood-red HP.

import {
  Application,
  Container,
  Graphics,
  Text,
} from "pixi.js";
import type { GameEvent, GameState, ParticipantId } from "../engine/types";
import {
  buildFilterChainDescriptor,
  createPostFilters,
  type FilterChainDescriptor,
  type PostFilterChain,
} from "./filters";
import {
  FEEDBACK_MAX_DELAY_MS,
  participantName,
  toFeedbackDescriptor,
  toHudViewModel,
  type FeedbackDescriptor,
  type HudViewModel,
} from "./viewModel";

// Re-export the pure helpers so callers/tests can reach them from one module.
export {
  buildFilterChainDescriptor,
  toHudViewModel,
  toFeedbackDescriptor,
  FEEDBACK_MAX_DELAY_MS,
};
export type { FilterChainDescriptor, HudViewModel, FeedbackDescriptor };

// ---------------------------------------------------------------------------
// Result types (Req 8.5)
// ---------------------------------------------------------------------------

/** A render initialization failure (WebGL/canvas context could not be created). */
export type RenderInitError = { kind: "RENDER_INIT_FAILED"; message: string };

/** A minimal success/failure result type used by `Renderer.init`. */
export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

// ---------------------------------------------------------------------------
// Palette (dark & deadly)
// ---------------------------------------------------------------------------

const COLOR = {
  bg0: 0x050507,
  paper: 0x1b1f24,
  paperLight: 0x2a3038,
  edge: 0x070809,
  outline: 0x000000,
  accent: 0x7ec850, // sickly green
  blood: 0x8e2b22, // HP red
  bloodDim: 0x3f120e,
  bone: 0xcdc6b8,
  muted: 0x6b6f76,
} as const;

const DEFAULT_WIDTH = 960;
const DEFAULT_HEIGHT = 600;

// ---------------------------------------------------------------------------
// Injectable PixiJS Application surface
// ---------------------------------------------------------------------------

/** The minimal Ticker surface the renderer drives. */
export interface TickerLike {
  add(fn: (ticker: unknown) => void): unknown;
  remove(fn: (ticker: unknown) => void): unknown;
  start(): void;
  stop(): void;
  maxFPS: number;
  minFPS: number;
}

/** The minimal stage container surface the renderer touches. */
export interface StageLike {
  filters: unknown;
  addChild(child: unknown): unknown;
  removeChildren(): unknown;
  sortableChildren: boolean;
}

/**
 * The minimal PixiJS `Application` surface the renderer depends on. The real
 * `Application` structurally satisfies this; tests inject a fake whose `init`
 * throws to exercise the failure path (Req 8.5) without ever creating WebGL.
 */
export interface PixiAppLike {
  init(options?: Record<string, unknown>): Promise<void>;
  readonly stage: StageLike;
  readonly canvas: HTMLCanvasElement;
  readonly ticker: TickerLike;
  destroy(rendererDestroyOptions?: unknown, options?: unknown): void;
}

/** Factory producing a fresh (un-initialized) Application-like object. */
export type PixiAppFactory = () => PixiAppLike;

const defaultAppFactory: PixiAppFactory = () =>
  new Application() as unknown as PixiAppLike;

/** Construction options for {@link Renderer}. */
export interface RendererOptions {
  /** Override the Application constructor (tests inject a failing/mock app). */
  readonly appFactory?: PixiAppFactory;
  /** Canvas width in pixels (default 960). */
  readonly width?: number;
  /** Canvas height in pixels (default 600). */
  readonly height?: number;
  /** Time source (ms); defaults to performance.now/Date.now. Injectable for tests. */
  readonly now?: () => number;
}

// ---------------------------------------------------------------------------
// The Renderer interface (from the design)
// ---------------------------------------------------------------------------

export interface IRenderer {
  init(canvasOrContainer: HTMLCanvasElement | HTMLElement): Promise<Result<void, RenderInitError>>;
  render(state: GameState): void;
  playActionFeedback(event: GameEvent): void;
  start(): void;
  stop(): void;
  showRenderUnavailable(): void;
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Internal scene-graph handles
// ---------------------------------------------------------------------------

interface SceneHandles {
  readonly bgLayer: Container;
  readonly dioramaLayer: Container;
  readonly actorLayer: Container;
  readonly hudLayer: Container;
  // Mutable visuals updated from state each render():
  readonly banner: Text;
  readonly winner: Text;
  readonly playerHp: Graphics;
  readonly dealerHp: Graphics;
  readonly playerItems: Graphics;
  readonly dealerItems: Graphics;
  readonly shells: Graphics;
  readonly gunLabel: Text;
  readonly muzzleFlash: Graphics;
  readonly cylinder: Container;
}

interface ActiveFeedback {
  readonly descriptor: FeedbackDescriptor;
  readonly startMs: number;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export class Renderer implements IRenderer {
  private readonly createApp: PixiAppFactory;
  private readonly width: number;
  private readonly height: number;
  private readonly now: () => number;

  private app: PixiAppLike | undefined;
  private scene: SceneHandles | undefined;
  private post: PostFilterChain | undefined;
  private running = false;
  private startMs = 0;
  private overlay: HTMLElement | undefined;
  private activeFeedback: ActiveFeedback | undefined;

  // Bound once so the same reference can be removed from the ticker later.
  private readonly tick = (_ticker: unknown): void => this.onTick();

  constructor(options: RendererOptions = {}) {
    this.createApp = options.appFactory ?? defaultAppFactory;
    this.width = options.width ?? DEFAULT_WIDTH;
    this.height = options.height ?? DEFAULT_HEIGHT;
    this.now = options.now ?? defaultNow;
  }

  /**
   * Initialize PixiJS (async in v8). On any failure constructing the WebGL/
   * canvas context, resolve to a typed error result; the caller stops the loop
   * and calls {@link showRenderUnavailable}. The provided GameState (if any) is
   * never touched here (Req 8.5).
   */
  async init(
    canvasOrContainer: HTMLCanvasElement | HTMLElement,
  ): Promise<Result<void, RenderInitError>> {
    try {
      const app = this.createApp();
      const isCanvas =
        typeof HTMLCanvasElement !== "undefined" &&
        canvasOrContainer instanceof HTMLCanvasElement;

      const options: Record<string, unknown> = {
        width: this.width,
        height: this.height,
        background: COLOR.bg0,
        antialias: false,
        autoStart: false,
      };
      if (isCanvas) {
        options.canvas = canvasOrContainer;
      }

      await app.init(options);

      // When given a container (not a canvas), attach the created canvas to it.
      if (!isCanvas) {
        try {
          (canvasOrContainer as HTMLElement).appendChild(app.canvas);
        } catch {
          // Non-fatal: the renderer can still run headless-ish for tests.
        }
      }

      this.app = app;
      this.buildScene(app);
      return { ok: true, value: undefined };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: { kind: "RENDER_INIT_FAILED", message } };
    }
  }

  /**
   * Update the visuals from `state`. Pure-read with respect to the engine:
   * never mutates `state`. No-op if init has not succeeded (Req 8.5 keeps state
   * intact even when rendering is unavailable).
   */
  render(state: GameState): void {
    if (!this.scene) return;
    const vm = toHudViewModel(state);
    this.drawHud(this.scene, vm);
  }

  /**
   * Trigger a short visual response for an engine event. The feedback is queued
   * and applied on the very next ticker frame, so the first visible change
   * lands well within 200 ms (Req 8.4).
   */
  playActionFeedback(event: GameEvent): void {
    const descriptor = toFeedbackDescriptor(event);
    if (descriptor.kind === "none") return;
    this.activeFeedback = { descriptor, startMs: this.now() };
  }

  /** Begin the >=30 FPS ticker loop with the filter chain attached (Req 8.1-8.3). */
  start(): void {
    const app = this.app;
    if (!app || this.running) return;
    if (this.post) {
      app.stage.filters = this.post.filters;
    }
    app.ticker.minFPS = 30;
    app.ticker.maxFPS = 60;
    app.ticker.add(this.tick);
    app.ticker.start();
    this.running = true;
    this.startMs = this.now();
  }

  /** Stop the ticker loop. Safe to call when not running. */
  stop(): void {
    const app = this.app;
    if (!app || !this.running) return;
    app.ticker.remove(this.tick);
    app.ticker.stop();
    this.running = false;
  }

  /**
   * Present a simple DOM text overlay indicating rendering is unavailable
   * (Req 8.5). Never throws even if no DOM is present; never touches GameState.
   */
  showRenderUnavailable(): void {
    if (typeof document === "undefined" || !document.body) return;
    if (this.overlay) return;
    try {
      const el = document.createElement("div");
      el.setAttribute("data-render-unavailable", "true");
      el.textContent = "RENDERING UNAVAILABLE";
      el.style.position = "fixed";
      el.style.inset = "0";
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.justifyContent = "center";
      el.style.background = "#050507";
      el.style.color = "#8e2b22";
      el.style.fontFamily = "'Courier New', monospace";
      el.style.letterSpacing = "4px";
      el.style.zIndex = "9999";
      document.body.appendChild(el);
      this.overlay = el;
    } catch {
      // Swallow: showing the overlay must never throw.
    }
  }

  /** Tear down the ticker, the Pixi application and any overlay. */
  destroy(): void {
    this.stop();
    if (this.app) {
      try {
        this.app.destroy();
      } catch {
        // ignore teardown errors
      }
      this.app = undefined;
    }
    this.scene = undefined;
    this.post = undefined;
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
    this.overlay = undefined;
  }

  // -------------------------------------------------------------------------
  // Testing accessors
  // -------------------------------------------------------------------------

  /** The pure descriptor of the filter chain (names + brightness/flicker). */
  getFilterChainDescriptor(): FilterChainDescriptor {
    return buildFilterChainDescriptor();
  }

  /** Whether the ticker loop is currently running. */
  isRunning(): boolean {
    return this.running;
  }

  // -------------------------------------------------------------------------
  // Per-frame loop
  // -------------------------------------------------------------------------

  private onTick(): void {
    const elapsed = this.now() - this.startMs;
    if (this.post) {
      this.post.update(elapsed);
    }
    this.applyFeedback(elapsed);
  }

  private applyFeedback(_elapsed: number): void {
    const fb = this.activeFeedback;
    const scene = this.scene;
    if (!fb || !scene) return;

    const t = this.now() - fb.startMs;
    const dur = Math.max(1, fb.descriptor.durationMs);
    const progress = Math.min(1, t / dur);

    // Muzzle flash: a bright overlay that fades out across the tween.
    if (fb.descriptor.kind === "muzzle-flash") {
      scene.muzzleFlash.visible = true;
      scene.muzzleFlash.alpha = 1 - progress;
    } else if (fb.descriptor.kind === "recoil") {
      // A small vertical kick of the revolver, settling back over the tween.
      scene.cylinder.y = -Math.sin(progress * Math.PI) * 8;
    } else if (fb.descriptor.kind === "cylinder-spin") {
      scene.cylinder.rotation = progress * Math.PI * 2;
    }

    if (progress >= 1) {
      // Reset transient transforms once the tween completes.
      scene.muzzleFlash.visible = false;
      scene.cylinder.y = 0;
      scene.cylinder.rotation = 0;
      this.activeFeedback = undefined;
    }
  }

  // -------------------------------------------------------------------------
  // Scene construction (placeholder-first Graphics; matches the mockup)
  // -------------------------------------------------------------------------

  private buildScene(app: PixiAppLike): void {
    const w = this.width;
    const h = this.height;

    const bgLayer = new Container();
    const dioramaLayer = new Container();
    const actorLayer = new Container();
    actorLayer.sortableChildren = true;
    const hudLayer = new Container();

    // ---- Background: dark void + faint blood-red grid ----
    const bg = new Graphics();
    bg.rect(0, 0, w, h).fill({ color: COLOR.bg0 });
    drawBloodGrid(bg, w, h);
    bgLayer.addChild(bg);

    // ---- Diorama: tilted table top + thick beveled cardboard edge + shadows ----
    const cx = w / 2;
    const tableTop = h * 0.42;
    const tableW = 560;
    const tableH = 280;
    const diorama = new Graphics();
    // Beveled "cardboard" front edge (darker, sits below the top face).
    diorama
      .roundRect(cx - tableW / 2, tableTop + tableH - 26, tableW, 60, 22)
      .fill({ color: COLOR.edge })
      .stroke({ width: 3, color: COLOR.outline });
    // Top face of the table.
    diorama
      .roundRect(cx - tableW / 2, tableTop, tableW, tableH, 24)
      .fill({ color: COLOR.paper })
      .stroke({ width: 3, color: COLOR.outline });
    // Drop shadows beneath the actors.
    diorama.ellipse(cx, tableTop + 44, 78, 18).fill({ color: 0x000000, alpha: 0.55 });
    diorama.ellipse(cx, tableTop + tableH - 44, 78, 18).fill({ color: 0x000000, alpha: 0.55 });
    dioramaLayer.addChild(diorama);

    // ---- Actors: billboard dealer + player cards, revolver cylinder ----
    const dealer = makeActorCard("THE DEALER", COLOR.paperLight);
    dealer.x = cx;
    dealer.y = tableTop + 4;
    dealer.zIndex = Math.round(dealer.y);

    const player = makeActorCard("YOU", COLOR.paperLight);
    player.x = cx;
    player.y = tableTop + tableH - 4;
    player.zIndex = Math.round(player.y);

    const cylinder = makeCylinder();
    cylinder.x = cx;
    cylinder.y = tableTop + tableH / 2;
    const cylinderWrap = new Container();
    cylinderWrap.x = cylinder.x;
    cylinderWrap.y = cylinder.y;
    cylinder.x = 0;
    cylinder.y = 0;
    cylinderWrap.addChild(cylinder);
    cylinderWrap.zIndex = Math.round(tableTop + tableH / 2);

    const muzzleFlash = new Graphics();
    muzzleFlash.circle(0, 0, 46).fill({ color: 0xfff2c0, alpha: 0.9 });
    muzzleFlash.x = cx;
    muzzleFlash.y = tableTop + tableH / 2;
    muzzleFlash.visible = false;
    muzzleFlash.zIndex = 100000;

    actorLayer.addChild(dealer);
    actorLayer.addChild(player);
    actorLayer.addChild(cylinderWrap);
    actorLayer.addChild(muzzleFlash);

    // ---- HUD: ID cards (HP pips), item belts, banners, shells, gun label ----
    const title = makeText("REVOLVER ROULETTE", 18, COLOR.bone);
    title.anchor.set(0.5, 0);
    title.x = cx;
    title.y = 14;

    const banner = makeText("", 14, COLOR.accent);
    banner.anchor.set(0.5, 0);
    banner.x = cx;
    banner.y = 44;

    const winner = makeText("", 26, COLOR.accent);
    winner.anchor.set(0.5, 0.5);
    winner.x = cx;
    winner.y = h * 0.5;
    winner.visible = false;

    const playerLabel = makeText("YOU", 12, COLOR.bone);
    playerLabel.x = 22;
    playerLabel.y = 18;
    const dealerLabel = makeText("DEALER", 12, COLOR.bone);
    dealerLabel.anchor.set(1, 0);
    dealerLabel.x = w - 22;
    dealerLabel.y = 18;

    const playerHp = new Graphics();
    playerHp.x = 22;
    playerHp.y = 40;
    const dealerHp = new Graphics();
    dealerHp.x = w - 22;
    dealerHp.y = 40;

    const playerItems = new Graphics();
    playerItems.x = cx - 140;
    playerItems.y = h - 64;
    const dealerItems = new Graphics();
    dealerItems.x = cx + 20;
    dealerItems.y = h - 64;

    const shells = new Graphics();
    shells.x = cx;
    shells.y = tableTop + tableH * 0.74;

    const gunLabel = makeText("", 11, COLOR.accent);
    gunLabel.anchor.set(0.5, 0);
    gunLabel.x = cx;
    gunLabel.y = tableTop + tableH / 2 + 60;

    hudLayer.addChild(title);
    hudLayer.addChild(banner);
    hudLayer.addChild(winner);
    hudLayer.addChild(playerLabel);
    hudLayer.addChild(dealerLabel);
    hudLayer.addChild(playerHp);
    hudLayer.addChild(dealerHp);
    hudLayer.addChild(playerItems);
    hudLayer.addChild(dealerItems);
    hudLayer.addChild(shells);
    hudLayer.addChild(gunLabel);

    app.stage.addChild(bgLayer);
    app.stage.addChild(dioramaLayer);
    app.stage.addChild(actorLayer);
    app.stage.addChild(hudLayer);

    // Build and attach the post-processing filter chain to the stage root.
    this.post = createPostFilters();
    app.stage.filters = this.post.filters;

    this.scene = {
      bgLayer,
      dioramaLayer,
      actorLayer,
      hudLayer,
      banner,
      winner,
      playerHp,
      dealerHp,
      playerItems,
      dealerItems,
      shells,
      gunLabel,
      muzzleFlash,
      cylinder: cylinderWrap,
    };
  }

  private drawHud(scene: SceneHandles, vm: HudViewModel): void {
    scene.banner.text = vm.banner;

    drawHpPips(scene.playerHp, vm.player.hp.current, vm.player.hp.max, false);
    drawHpPips(scene.dealerHp, vm.dealer.hp.current, vm.dealer.hp.max, true);

    drawItemBelt(scene.playerItems, vm.player.items.length);
    drawItemBelt(scene.dealerItems, vm.dealer.items.length);

    drawShells(scene.shells, vm.liveRemaining, vm.blankRemaining);
    scene.gunLabel.text = `${vm.liveRemaining} LIVE \u00b7 ${vm.blankRemaining} BLANK`;

    if (vm.matchOver && vm.winner !== null) {
      scene.winner.visible = true;
      scene.winner.text = `${participantName(vm.winner)} WINS`;
    } else {
      scene.winner.visible = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Drawing helpers (placeholder Graphics in the dark mockup palette)
// ---------------------------------------------------------------------------

function defaultNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function makeText(text: string, size: number, color: number): Text {
  return new Text({
    text,
    style: {
      fontFamily: "Courier New, monospace",
      fontSize: size,
      fill: color,
      letterSpacing: 2,
    },
  });
}

function drawBloodGrid(g: Graphics, w: number, h: number): void {
  const step = 54;
  for (let x = 0; x <= w; x += step) {
    g.moveTo(x, 0).lineTo(x, h);
  }
  for (let y = 0; y <= h; y += step) {
    g.moveTo(0, y).lineTo(w, y);
  }
  g.stroke({ width: 1, color: COLOR.blood, alpha: 0.06 });
}

function makeActorCard(name: string, color: number): Container {
  const c = new Container();
  const card = new Graphics();
  card
    .roundRect(-44, -120, 88, 116, 10)
    .fill({ color })
    .stroke({ width: 3, color: COLOR.outline });
  const plate = makeText(name, 11, COLOR.muted);
  plate.anchor.set(0.5, 0);
  plate.x = 0;
  plate.y = 2;
  c.addChild(card);
  c.addChild(plate);
  return c;
}

function makeCylinder(): Container {
  const c = new Container();
  const body = new Graphics();
  body
    .circle(0, 0, 44)
    .fill({ color: COLOR.paperLight })
    .stroke({ width: 4, color: COLOR.outline });
  body.circle(0, 0, 14).fill({ color: COLOR.edge }).stroke({ width: 2, color: COLOR.outline });
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const px = Math.cos(angle) * 28;
    const py = Math.sin(angle) * 28;
    body.circle(px, py, 7).fill({ color: 0x0a0c0f }).stroke({ width: 2, color: COLOR.outline });
  }
  c.addChild(body);
  return c;
}

function drawHpPips(g: Graphics, current: number, max: number, rightAligned: boolean): void {
  g.clear();
  const pip = 18;
  const gap = 6;
  for (let i = 0; i < max; i++) {
    const idx = rightAligned ? max - 1 - i : i;
    const x = idx * (pip + gap) * (rightAligned ? -1 : 1) - (rightAligned ? pip : 0);
    const filled = i < current;
    g.roundRect(x, 0, pip, pip, 4)
      .fill({ color: filled ? COLOR.blood : 0x1a1c1f })
      .stroke({ width: 2, color: COLOR.outline });
  }
}

function drawItemBelt(g: Graphics, count: number): void {
  g.clear();
  const slot = 44;
  const gap = 8;
  const capacity = 4;
  for (let i = 0; i < capacity; i++) {
    const x = i * (slot + gap);
    const used = i < count;
    g.roundRect(x, 0, slot, slot, 8)
      .fill({ color: COLOR.paper, alpha: used ? 1 : 0.35 })
      .stroke({ width: 2, color: used ? COLOR.accent : COLOR.outline });
  }
}

function drawShells(g: Graphics, live: number, blank: number): void {
  g.clear();
  const total = live + blank;
  if (total <= 0) return;
  const shellW = 12;
  const shellH = 22;
  const gap = 6;
  const startX = -((total * (shellW + gap)) / 2);
  for (let i = 0; i < total; i++) {
    const x = startX + i * (shellW + gap);
    const isLive = i < live;
    g.roundRect(x, 0, shellW, shellH, 3)
      .fill({ color: isLive ? COLOR.blood : COLOR.muted })
      .stroke({ width: 2, color: COLOR.outline });
  }
}

// Re-export ParticipantId is unnecessary; consumers import from engine/types.
export type { ParticipantId };
