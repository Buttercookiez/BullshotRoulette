// PlayerView projection for the Revolver Roulette rules engine.
//
// This module exposes a single PURE function, `toPlayerView`, that projects the
// authoritative, hidden-order `GameState` down to the public, non-cheating
// `PlayerView` for one Participant. The projection deliberately exposes only
// the information the requirements declare visible:
//
//   - the count of remaining Live and Blank Rounds (Requirements 1.4, 1.5),
//   - both Participants' HP and held Items,
//   - turn/spin metadata, and
//   - this Participant's own privately-revealed Current Chamber knowledge.
//
// It NEVER exposes the ordered chamber classifications (Requirement 1.6) nor
// the opponent's privately-revealed knowledge. Counts are derived from the
// unfired chambers via `remainingCounts`, exactly the values shown to both
// Participants.

import type {
  GameState,
  ParticipantId,
  PlayerView,
} from "./types";
import { remainingCounts } from "./cylinder";

/** The other Participant in the Match. */
function opponentOf(id: ParticipantId): ParticipantId {
  return id === "PLAYER" ? "AI" : "PLAYER";
}

/**
 * Project `state` to the public `PlayerView` for `participant`.
 *
 * Pure and non-cheating: remaining Live/Blank/total counts are derived from the
 * unfired chambers (the same visible counts shown to both Participants); the
 * per-chamber order and classifications are never included. `knownCurrentChamber`
 * carries ONLY this Participant's own `revealedCurrentChamber` value (set by
 * Magnifying_Glass and invalidated elsewhere by Shot/Spin); the opponent's
 * revealed knowledge is never surfaced.
 */
export function toPlayerView(
  state: GameState,
  participant: ParticipantId,
): PlayerView {
  const self = state.participants[participant];
  const opponent = state.participants[opponentOf(participant)];

  // Visible counts derived from unfired chambers — never the hidden order.
  const counts = remainingCounts(state.cylinder);

  return {
    phase: state.phase,
    self: participant,
    selfHp: self.hp,
    opponentHp: opponent.hp,
    selfItems: self.items,
    opponentItems: opponent.items,
    liveRemaining: counts.live,
    blankRemaining: counts.blank,
    roundsRemaining: counts.live + counts.blank,
    spinsUsedThisTurn: state.spinsUsedThisTurn,
    maxSpinsPerTurn: state.config.maxSpinsPerTurn,
    // Expose only THIS Participant's own revealed knowledge.
    knownCurrentChamber: self.revealedCurrentChamber,
  };
}
