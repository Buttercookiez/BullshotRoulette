// The authoritative engine reducer for the Revolver Roulette rules engine.
//
// `reduce` is the single entry point the Game_Controller uses to advance the
// game: it takes the current immutable `GameState`, an `Action` (produced by
// either the human UI or the AI), and the injected `RNG`, and returns a typed
// `EngineResult`. Like every other engine function it is PURE — it produces new
// state rather than mutating, and draws randomness only from `rng`.
//
// Crucially, the engine NEVER throws on gameplay input (design "Error
// Handling"). Illegal actions are returned as state-preserving no-ops with a
// `RejectionReason`; any unexpected internal error is also converted into a
// rejected result rather than propagated. This guarantees the game can never
// crash from bad input.
//
// `reduce` stays thin: it is a dispatcher plus the match-over guard and the
// new-match reset. The hard work (and the invariants HP >= 0, inventory <=
// maxItems, spins <= maxSpinsPerTurn, exactly one Round per loaded Chamber)
// already lives in and is maintained by the sub-functions it delegates to
// (`fire`, `spin`, `applyItem`, `createMatch`), so it relies on them rather
// than re-validating.

import type { Action, EngineResult, GameState } from "./types";
import type { RNG } from "../rng/rng";
import { createMatch, isMatchOver } from "./lifecycle";
import { fire } from "./shot";
import { spin } from "./spin";
import { applyItem } from "./items";

/**
 * The single authoritative transition function (design "Rules_Engine"). Given a
 * `GameState`, an `Action`, and an `RNG`, it returns the resulting
 * `EngineResult`. It never throws on gameplay input.
 *
 * Behavior summary:
 *   - Match-over guard: when the Match is already over (phase `MATCH_OVER` or
 *     either Participant at zero HP), the ONLY accepted action is
 *     `START_NEW_MATCH`. Any other action is rejected with `MATCH_OVER` and the
 *     `GameState` is returned unchanged (no events).
 *   - Dispatch (Match in progress):
 *       - `SHOOT`     -> `fire(state, target, rng)`     (Req 3.1, 3.2, ...)
 *       - `SPIN`      -> `spin(state, rng)`             (Req 4.x)
 *       - `USE_ITEM`  -> `applyItem(state, item, rng)`  (Req 5.x)
 *       - `START_NEW_MATCH` -> a fresh Match reset (Req 7.5, 7.6, 2.1, 7.2).
 *   - Turn / phase legality (Req 3.8): the engine is participant-agnostic — it
 *     always acts on behalf of `state.activeParticipant`, and the
 *     Game_Controller decides WHO is allowed to act (it ignores out-of-turn
 *     human input). The reducer does not re-implement a "not your turn" check
 *     here; doing so would duplicate the controller's responsibility and the
 *     structural validation the sub-functions already perform (empty cylinder,
 *     spin limits, item-not-held). It DOES enforce the match-over guard, since
 *     that is a whole-engine invariant rather than a turn-ownership question.
 *   - Defensive wrapper: any unexpected thrown error from a handler is caught
 *     and converted into a rejected `INVALID_ACTION` result carrying the
 *     ORIGINAL `state`, so the engine never throws on gameplay input.
 */
export function reduce(state: GameState, action: Action, rng: RNG): EngineResult {
  try {
    // START_NEW_MATCH is always permitted, including (and especially) when the
    // Match is over. It is the documented escape hatch from MATCH_OVER.
    if (action.kind === "START_NEW_MATCH") {
      return startNewMatch(state, rng);
    }

    // Match-over guard (Req 7.5): once the Match is over, gameplay actions are
    // rejected as state-preserving no-ops until a new Match is started.
    if (state.phase === "MATCH_OVER" || isMatchOver(state)) {
      return { state, events: [], rejected: "MATCH_OVER" };
    }

    // Dispatch to the appropriate pure handler. Each handler validates its own
    // preconditions and maintains the engine invariants, returning a rejected
    // EngineResult (never throwing) for illegal-but-expected gameplay input.
    switch (action.kind) {
      case "SHOOT":
        return fire(state, action.target, rng);
      case "SPIN":
        return spin(state, rng);
      case "USE_ITEM":
        return applyItem(state, action.item, rng);
    }
  } catch {
    // Defensive: the engine must not throw on gameplay input. Any unexpected
    // internal error becomes a rejected no-op preserving the original state.
    return { state, events: [], rejected: "INVALID_ACTION" };
  }

  // Unreachable for the typed Action union, but keeps the function total and
  // guards against malformed input slipping past the type system at runtime.
  return { state, events: [], rejected: "INVALID_ACTION" };
}

/**
 * Reset to a brand-new Match (Requirements 7.5, 7.6, 2.1, 7.2).
 *
 * The cleanest implementation is to DELEGATE to `createMatch(state.config,
 * rng)`: that helper already establishes every initial value the requirement
 * demands, so re-deriving them here would only risk drift. Specifically,
 * `createMatch` resets both Participants' HP to `config.startingHp`, grants a
 * fresh Item set per Requirement 5 (capped at `maxItems`), sets every
 * `damageMultiplier` back to 1 and `revealedCurrentChamber` to `null`, loads a
 * valid new Cylinder, makes the Player the Active_Participant in phase
 * `PLAYER_TURN`, and zeroes `spinsUsedThisTurn`, `skipNextTurnOf`, `winner`, and
 * `roundSetIndex`. The current `config` is carried forward so a new Match uses
 * the same tunables as the one just finished.
 */
function startNewMatch(state: GameState, rng: RNG): EngineResult {
  return createMatch(state.config, rng);
}
