// Pure presentation mappings for the Revolver Roulette renderer.
//
// These functions translate authoritative engine data (`GameState`, `GameEvent`)
// into small, plain "view-model" / "feedback descriptor" objects the renderer
// draws and animates from. They are deliberately PURE: no PixiJS, no DOM, no
// mutation of their inputs. That makes the renderer's wiring (Task 14.3)
// unit-testable without a WebGL context — the tests assert these descriptors
// rather than pixels.
//
// The renderer stays driven entirely by `GameState`; it contains no rules
// logic. HP pip counts satisfy Req 2.6, the item belt satisfies Req 5.11, and
// the round/shell counts and turn/winner banners mirror the mockup HUD.

import type {
  GameEvent,
  GameState,
  ItemType,
  ParticipantId,
  Phase,
} from "../engine/types";
import { remainingCounts } from "../engine/cylinder";

// ---------------------------------------------------------------------------
// HUD view-model
// ---------------------------------------------------------------------------

/** A participant's HP shown as filled/lost pips (Req 2.6). */
export interface HpView {
  /** Current HP — the number of filled pips. */
  readonly current: number;
  /** Starting HP — the total number of pip slots. */
  readonly max: number;
}

/** One participant's HUD slice: ID-card HP and item belt (Req 2.6, 5.11). */
export interface ParticipantHudView {
  readonly id: ParticipantId;
  readonly hp: HpView;
  /** Items held, drawn as the item belt; length is capped by the engine at 4. */
  readonly items: ReadonlyArray<ItemType>;
}

/** The complete HUD projection consumed by the renderer each frame. */
export interface HudViewModel {
  readonly phase: Phase;
  /** The active-turn banner text. */
  readonly banner: string;
  readonly activeParticipant: ParticipantId;
  readonly player: ParticipantHudView;
  readonly dealer: ParticipantHudView;
  /** Visible remaining Live count (shell tokens). */
  readonly liveRemaining: number;
  /** Visible remaining Blank count (shell tokens). */
  readonly blankRemaining: number;
  /** Total remaining rounds in the cylinder. */
  readonly roundsRemaining: number;
  /** The winner, or null while the Match is in progress. */
  readonly winner: ParticipantId | null;
  /** True once the Match is over (winner display, Req 7.4). */
  readonly matchOver: boolean;
}

/** Human-facing display name for a participant. */
export function participantName(id: ParticipantId): string {
  return id === "PLAYER" ? "YOU" : "DEALER";
}

function bannerFor(state: GameState): string {
  if (state.winner !== null) {
    return `${participantName(state.winner)} WINS`;
  }
  switch (state.phase) {
    case "MATCH_INTRO":
      return "LOAD THE CYLINDER";
    case "PLAYER_TURN":
      return "YOUR TURN";
    case "AI_THINKING":
      return "DEALER'S TURN";
    case "RESOLVING":
      return state.activeParticipant === "PLAYER" ? "YOUR TURN" : "DEALER'S TURN";
    case "ROUND_SET_RELOAD":
      return "RELOADING";
    case "MATCH_OVER":
      return "MATCH OVER";
    default:
      return "";
  }
}

/**
 * Project `state` into the renderer's HUD view-model. Pure: it reads the state
 * and never mutates it. HP pips come from each Participant's hp vs. the starting
 * value (Req 2.6); the item belt comes from each Participant's items (Req 5.11);
 * shell/round counts come from the visible cylinder counts; the banner reflects
 * the active turn and the winner display on match end (Req 7.4).
 */
export function toHudViewModel(state: GameState): HudViewModel {
  const counts = remainingCounts(state.cylinder);
  const startingHp = state.config.startingHp;
  const player = state.participants.PLAYER;
  const dealer = state.participants.AI;

  return {
    phase: state.phase,
    banner: bannerFor(state),
    activeParticipant: state.activeParticipant,
    player: {
      id: "PLAYER",
      hp: { current: player.hp, max: startingHp },
      items: player.items,
    },
    dealer: {
      id: "AI",
      hp: { current: dealer.hp, max: startingHp },
      items: dealer.items,
    },
    liveRemaining: counts.live,
    blankRemaining: counts.blank,
    roundsRemaining: counts.live + counts.blank,
    winner: state.winner,
    matchOver: state.phase === "MATCH_OVER" || state.winner !== null,
  };
}

// ---------------------------------------------------------------------------
// Action-feedback descriptors (Req 8.4)
// ---------------------------------------------------------------------------

/**
 * The maximum delay, in milliseconds, before an action's visual response must
 * begin (Requirement 8.4). Every feedback descriptor's `delayMs` is bounded by
 * this; the renderer applies feedback on the very next ticker frame.
 */
export const FEEDBACK_MAX_DELAY_MS = 200;

/** The visual flavour of a feedback animation. */
export type FeedbackKind =
  | "muzzle-flash" // LIVE_FIRED
  | "recoil" // SHOT_STARTED, BLANK_FIRED
  | "hud-pulse" // HP_CHANGED, ITEM_USED
  | "cylinder-spin" // SPUN
  | "reload" // ROUND_SET_LOADED
  | "turn-pass" // TURN_PASSED, TURN_SKIPPED
  | "match-over" // MATCH_OVER
  | "none";

/** A short, declarative description of an action's visual response (Req 8.4). */
export interface FeedbackDescriptor {
  readonly kind: FeedbackKind;
  /** Delay before the first visible frame; always <= FEEDBACK_MAX_DELAY_MS. */
  readonly delayMs: number;
  /** Total tween duration in milliseconds. */
  readonly durationMs: number;
  /** The shot target, when the event names one. */
  readonly target?: ParticipantId;
  /** The affected participant (HP pulse / item use), when applicable. */
  readonly participant?: ParticipantId;
}

/**
 * Map a `GameEvent` to a feedback descriptor. Pure. Every descriptor begins
 * immediately (`delayMs: 0 <= 200`) so the renderer's first visible response
 * lands well within the 200 ms budget (Req 8.4).
 */
export function toFeedbackDescriptor(event: GameEvent): FeedbackDescriptor {
  switch (event.type) {
    case "LIVE_FIRED":
      return { kind: "muzzle-flash", delayMs: 0, durationMs: 180, target: event.target };
    case "BLANK_FIRED":
      return { kind: "recoil", delayMs: 0, durationMs: 120, target: event.target };
    case "SHOT_STARTED":
      return { kind: "recoil", delayMs: 0, durationMs: 120, target: event.target };
    case "HP_CHANGED":
      return { kind: "hud-pulse", delayMs: 0, durationMs: 160, participant: event.participant };
    case "ITEM_USED":
      return { kind: "hud-pulse", delayMs: 0, durationMs: 160, participant: event.by };
    case "SPUN":
      return { kind: "cylinder-spin", delayMs: 0, durationMs: 200 };
    case "ROUND_SET_LOADED":
      return { kind: "reload", delayMs: 0, durationMs: 200 };
    case "TURN_PASSED":
      return { kind: "turn-pass", delayMs: 0, durationMs: 150, participant: event.to };
    case "TURN_SKIPPED":
      return { kind: "turn-pass", delayMs: 0, durationMs: 150, participant: event.participant };
    case "MATCH_OVER":
      return { kind: "match-over", delayMs: 0, durationMs: 200, participant: event.winner };
    default:
      return { kind: "none", delayMs: 0, durationMs: 0 };
  }
}
