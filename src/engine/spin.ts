// Spin Action resolution for the Revolver Roulette rules engine.
//
// All functions here are PURE: they operate on the immutable `GameState` and
// related types, produce new objects rather than mutating, and draw randomness
// only from the injected `RNG`. They never call `Math.random` directly.
//
// A Spin Action re-randomizes the order of the Rounds still in the Cylinder.
// It is legal only while at least 2 Rounds remain (Requirement 4.1) and the
// per-Turn Spin limit has not been reached (Requirement 4.5). On success it
// re-shuffles the remaining Rounds (the new Current Chamber becomes the first
// of the new order), invalidates every Participant's revealed Current-Chamber
// knowledge (Requirement 4.3), retains the Turn with the Active_Participant
// (Requirement 4.4), and increments the per-Turn spin counter.

import type {
  EngineResult,
  GameEvent,
  GameState,
  Participant,
  ParticipantId,
} from "./types";
import type { RNG } from "../rng/rng";
import { remainingCounts, shuffleRemaining } from "./cylinder";

/**
 * Whether a Spin Action is currently legal (Requirements 4.1, 4.5): at least 2
 * Rounds must remain in the Cylinder AND the per-Turn Spin limit must not yet
 * be reached. Pure and side-effect free; used by `spin` and reusable by the
 * cross-cutting reducer/illegal-action handling in a later task.
 */
export function canSpin(state: GameState): boolean {
  const { live, blank } = remainingCounts(state.cylinder);
  const remaining = live + blank;
  if (remaining < 2) return false;
  if (state.spinsUsedThisTurn >= state.config.maxSpinsPerTurn) return false;
  return true;
}

/**
 * Take a Spin Action on behalf of `state.activeParticipant`
 * (Requirements 4.1-4.6).
 *
 * Behavior summary:
 *   - Rejected (fewer than 2 Rounds remain, or the per-Turn Spin limit has been
 *     reached): return the `state` UNCHANGED with `rejected: "SPIN_NOT_ALLOWED"`
 *     and no events; the Turn is retained with the Active_Participant
 *     (Requirement 4.6).
 *   - Accepted: re-shuffle the remaining Rounds via `shuffleRemaining` (which
 *     also sets the Current Chamber to the first Round of the new order,
 *     Requirement 4.2), clear BOTH Participants' revealed Current-Chamber
 *     knowledge (Requirement 4.3), retain the Turn with the Active_Participant
 *     (Requirement 4.4), increment `spinsUsedThisTurn` (Requirement 4.5), and
 *     emit a `SPUN` event.
 *
 * Pure: randomness only via `rng`. Returns an `EngineResult`.
 */
export function spin(state: GameState, rng: RNG): EngineResult {
  // Requirement 4.6: reject as a state-preserving no-op when a Spin is not
  // allowed. The state is returned unchanged and the Turn is retained.
  if (!canSpin(state)) {
    return { state, events: [], rejected: "SPIN_NOT_ALLOWED" };
  }

  // Requirement 4.2: re-order all remaining Rounds; the new Current Chamber is
  // the first Round of the new order (handled by shuffleRemaining).
  const cylinder = shuffleRemaining(state.cylinder, rng);

  // Requirement 4.3: a Spin invalidates any revealed Current-Chamber knowledge
  // for BOTH Participants.
  const player: Participant = {
    ...state.participants.PLAYER,
    revealedCurrentChamber: null,
  };
  const ai: Participant = {
    ...state.participants.AI,
    revealedCurrentChamber: null,
  };
  const participants: Record<ParticipantId, Participant> = {
    PLAYER: player,
    AI: ai,
  };

  const newState: GameState = {
    ...state,
    cylinder,
    participants,
    // Requirement 4.4: the Active_Participant is unchanged.
    // Requirement 4.5: count this Spin against the per-Turn limit.
    spinsUsedThisTurn: state.spinsUsedThisTurn + 1,
  };

  const events: GameEvent[] = [{ type: "SPUN" }];

  return { state: newState, events };
}
