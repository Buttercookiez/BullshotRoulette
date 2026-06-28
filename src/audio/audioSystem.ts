// Audio System (Requirement 9).
//
// Wraps Howler.js to provide the game's sound layers and one-shot SFX. The
// system subscribes to engine `GameEvent`s and coarse round-count state; it
// owns no game rules. Every sound is created with load/play error handlers that
// swallow failures so a missing or broken asset never interrupts gameplay
// (Requirement 9.8).
//
// The Howl constructor is injected (defaulting to the real Howler `Howl`) so
// tests can supply a mock factory and assert behavior without a real audio
// backend.

import { Howl, type HowlOptions } from "howler";
import type { GameEvent } from "../engine/types";
import { tensionVolume } from "./tension";

// ---------------------------------------------------------------------------
// Asset paths and volume constants
// ---------------------------------------------------------------------------

/** Base directory for audio assets (files may not exist yet; that's fine). */
const AUDIO_BASE = "/assets/audio/";

/**
 * Playback volume for the gunshot (Live Round). Defined as an explicit
 * constant and required to be strictly greater than the dry-click volume so a
 * Live Round always sounds louder than a Blank (Requirement 9.4).
 */
export const GUNSHOT_VOLUME = 1.0;

/** Playback volume for the dry click (Blank Round). Quieter than the gunshot. */
export const DRY_CLICK_VOLUME = 0.35;

// ---------------------------------------------------------------------------
// Injectable Howl factory
// ---------------------------------------------------------------------------

/**
 * The minimal surface of a Howl instance this system depends on. Both the real
 * Howler `Howl` and a test mock satisfy this, so the system can run without a
 * real audio backend.
 */
export interface HowlLike {
  play(spriteOrId?: string | number): number;
  stop(id?: number): unknown;
  unload(): unknown;
  volume(volume: number): unknown;
}

/** Creates a Howl-like sound from options. Injectable for tests. */
export type HowlFactory = (options: HowlOptions) => HowlLike;

/** The default factory uses the real Howler `Howl` constructor. */
const defaultHowlFactory: HowlFactory = (options) => new Howl(options);

/** Construction options for {@link AudioSystem}. */
export interface AudioSystemOptions {
  /** Override the Howl constructor. Defaults to the real Howler `Howl`. */
  readonly howlFactory?: HowlFactory;
}

// ---------------------------------------------------------------------------
// AudioSystem
// ---------------------------------------------------------------------------

export class AudioSystem {
  private readonly createHowl: HowlFactory;

  private ambient: HowlLike | undefined;
  private tension: HowlLike | undefined;
  private spinClicks: HowlLike | undefined;
  private hammerCock: HowlLike | undefined;
  private gunshot: HowlLike | undefined;
  private dryClick: HowlLike | undefined;
  private uiBlip: HowlLike | undefined;

  constructor(options: AudioSystemOptions = {}) {
    this.createHowl = options.howlFactory ?? defaultHowlFactory;
  }

  /**
   * Build all Howl instances. Looping layers (ambient drone, tension layer)
   * use `loop: true`; one-shot SFX are fire-and-forget. Every sound gets
   * load/play error handlers that log and swallow the failure (Requirement
   * 9.8). Safe to call once before playback.
   */
  init(): void {
    // Looping ambient drone (Requirement 9.1).
    this.ambient = this.makeHowl("ambient-drone.webm", { loop: true, volume: 0.6 });

    // Looping tension layer; starts silent and rises via setTension (Req 9.7).
    this.tension = this.makeHowl("tension-layer.webm", { loop: true, volume: 0 });

    // One-shot SFX (Requirements 9.2-9.6).
    this.spinClicks = this.makeHowl("spin-clicks.webm", { volume: 0.8 });
    this.hammerCock = this.makeHowl("hammer-cock.webm", { volume: 0.8 });
    this.gunshot = this.makeHowl("gunshot.webm", { volume: GUNSHOT_VOLUME });
    this.dryClick = this.makeHowl("dry-click.webm", { volume: DRY_CLICK_VOLUME });
    this.uiBlip = this.makeHowl("ui-blip.webm", { volume: 0.5 });
  }

  /** Start the looping ambient drone (and the silent tension layer). Req 9.1. */
  startAmbient(): void {
    this.safePlay(this.ambient);
    // Begin the tension bed silently so later volume changes are seamless.
    this.safePlay(this.tension);
  }

  /**
   * Map engine events to sounds (Requirements 9.2-9.5). UI interactions are
   * not GameEvents and are handled by {@link playUiBlip}.
   */
  handleEvents(events: readonly GameEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case "SPUN":
          this.safePlay(this.spinClicks); // Req 9.2
          break;
        case "SHOT_STARTED":
          this.safePlay(this.hammerCock); // Req 9.3
          break;
        case "LIVE_FIRED":
          this.safePlay(this.gunshot); // Req 9.4 (louder than dry click)
          break;
        case "BLANK_FIRED":
          this.safePlay(this.dryClick); // Req 9.5
          break;
        default:
          // Other events have no associated sound in this system.
          break;
      }
    }
  }

  /** Play the UI blip for a user-interface interaction (Requirement 9.6). */
  playUiBlip(): void {
    this.safePlay(this.uiBlip);
  }

  /**
   * Set the tension-layer volume from the remaining/total round counts using
   * the pure {@link tensionVolume} mapping (Requirement 9.7). The volume rises
   * as rounds deplete and peaks when one Round remains.
   */
  setTension(roundsRemaining: number, roundsTotal: number): void {
    const volume = tensionVolume(roundsRemaining, roundsTotal);
    if (!this.tension) return;
    try {
      this.tension.volume(volume);
    } catch (err) {
      console.warn("[audio] failed to set tension volume", err);
    }
  }

  /** Stop and unload every sound, releasing all audio resources. */
  stopAll(): void {
    for (const howl of [
      this.ambient,
      this.tension,
      this.spinClicks,
      this.hammerCock,
      this.gunshot,
      this.dryClick,
      this.uiBlip,
    ]) {
      this.safeStopAndUnload(howl);
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Create a Howl with shared error handlers. The `onloaderror`/`onplayerror`
   * handlers log a warning and swallow the failure so a missing or broken
   * asset never interrupts gameplay (Requirement 9.8).
   */
  private makeHowl(file: string, extra: Omit<HowlOptions, "src">): HowlLike {
    return this.createHowl({
      src: [`${AUDIO_BASE}${file}`],
      ...extra,
      onloaderror: (_id, error) => {
        console.warn(`[audio] failed to load ${file}`, error);
      },
      onplayerror: (_id, error) => {
        console.warn(`[audio] failed to play ${file}`, error);
      },
    });
  }

  /** Play a sound, swallowing any synchronous error (Requirement 9.8). */
  private safePlay(howl: HowlLike | undefined): void {
    if (!howl) return;
    try {
      howl.play();
    } catch (err) {
      console.warn("[audio] play threw", err);
    }
  }

  /** Stop a sound, swallowing any error. */
  private safeStopAndUnload(howl: HowlLike | undefined): void {
    if (!howl) return;
    try {
      howl.stop();
      howl.unload();
    } catch (err) {
      console.warn("[audio] stop/unload threw", err);
    }
  }
}
