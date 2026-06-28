// AI decision function for the Revolver Roulette single-player prototype.
//
// `decide` is a PURE function over the public `PlayerView` only. It never
// inspects hidden state (the ordered chamber classifications), uses no
// randomness, and produces no side effects. For any given view it returns
// exactly one `Action` — a `SHOOT` in the baseline rules below — mirroring
// Requirement 6 precisely.
//
// Decision order (first matching rule wins), per Requirement 6 / the design's
// AI Decision Algorithm:
//   1. All remaining Rounds are Blank (live == 0, rounds remain) -> SHOOT(Player) [6.3]
//   2. All remaining Rounds are Live  (blank == 0, rounds remain) -> SHOOT(Player) [6.4]
//   3. Known Blank in the Current Chamber and Live Rounds remain  -> SHOOT(self)   [6.5]
//   4. Otherwise (default)                                        -> SHOOT(Player) [6.6]

import type { Action, ParticipantId, PlayerView } from "../engine/types";

/** The other Participant relative to `id`. */
function opponentOf(id: ParticipantId): ParticipantId {
  return id === "PLAYER" ? "AI" : "PLAYER";
}

/**
 * Choose the AI's action for the given public view.
 *
 * Pure, deterministic, and non-cheating: reads only `view`, returns exactly one
 * `Action`. `view.self` is the acting Participant (the AI on its turn); "the
 * Player" target is the non-self Participant.
 */
export function decide(view: PlayerView): Action {
  const player = opponentOf(view.self); // "the Player": the opponent of self.

  // Req 6.3: all remaining Rounds are Blank -> shoot the Player (harmless,
  // advances the cylinder and passes the turn).
  if (view.liveRemaining === 0 && view.roundsRemaining > 0) {
    return { kind: "SHOOT", target: player };
  }

  // Req 6.4: all remaining Rounds are Live -> shoot the Player.
  if (view.blankRemaining === 0 && view.roundsRemaining > 0) {
    return { kind: "SHOOT", target: player };
  }

  // Req 6.5: confirmed Blank in the Current Chamber while Live Rounds remain
  // -> shoot self (a safe self-shot keeps the turn).
  if (view.knownCurrentChamber === "BLANK" && view.liveRemaining > 0) {
    return { kind: "SHOOT", target: view.self };
  }

  // Req 6.6: default -> shoot the Player.
  return { kind: "SHOOT", target: player };
}
