// Shot Action resolution for the Revolver Roulette rules engine.
//
// All functions here are PURE: they operate on the immutable `GameState` and
// related types, produce new objects rather than mutating, and draw randomness
// only from the injected `RNG` (needed because emptying the Cylinder triggers a
// reload as a new Round_Set). They never call `Math.random` directly.
//
// Cylinder representation (consistent with cylinder.ts):
//   - `chambers` is a fixed-length array; a `null` entry is a fired/emptied
//     Chamber. `currentIndex` points at the Current Chamber (the next Round to
//     fire). `remainingCounts` scans from `currentIndex` onward.
//   - Firing sets the Current Chamber to `null` and advances `currentIndex` to
//     the next non-null Chamber in order (Requirement 3.3). When no later
//     Chamber is loaded, `currentIndex` advances to `chambers.length`, so the
//     Cylinder reads as empty (no loaded Round remains).

import type {
  Chamber,
  Cylinder,
  EngineResult,
  GameEvent,
  GameState,
  Participant,
  ParticipantId,
} from "./types";
import type { RNG } from "../rng/rng";
import { loadRoundSet } from "./lifecycle";

/** The other Participant in the Match. */
function opponentOf(id: ParticipantId): ParticipantId {
  return id === "PLAYER" ? "AI" : "PLAYER";
}

/** The Round currently at the Current Chamber, or `null` if none is loaded. */
function currentChamber(cylinder: Cylinder): Chamber {
  if (cylinder.currentIndex < 0 || cylinder.currentIndex >= cylinder.chambers.length) {
    return null;
  }
  return cylinder.chambers[cylinder.currentIndex] ?? null;
}

/**
 * Empty the Current Chamber and advance `currentIndex` to the next loaded
 * Chamber in order (Requirement 3.3). If no later Chamber is loaded,
 * `currentIndex` becomes `chambers.length`, marking the Cylinder empty.
 * Returns a new Cylinder; the input is untouched.
 */
function advanceAfterFire(cylinder: Cylinder): Cylinder {
  const chambers: Chamber[] = cylinder.chambers.slice();
  chambers[cylinder.currentIndex] = null;

  let next = cylinder.currentIndex + 1;
  while (
    next < chambers.length &&
    (chambers[next] === null || chambers[next] === undefined)
  ) {
    next++;
  }

  return {
    chambers,
    currentIndex: next,
    size: cylinder.size,
  };
}

/**
 * Fire the Round at the Current Chamber at `target`, on behalf of
 * `state.activeParticipant` (Requirements 2.2-2.5, 3.2-3.7, 5.10, 7.3, 7.4).
 *
 * Behavior summary:
 *   - No loaded Round at the Current Chamber: reject without firing
 *     (`EMPTY_CYLINDER`) and trigger a reload as a new Round_Set; HP unchanged.
 *   - LIVE: reduce the target's HP by `min(targetHp, 1 * firerMultiplier)`
 *     (clamped at 0); reset the firer's Damage_Multiplier to 1 after a
 *     multiplied shot.
 *   - BLANK: HP unchanged; the firer's Damage_Multiplier is not consumed.
 *   - After firing: empty the fired Chamber, advance the Current Chamber, clear
 *     both Participants' revealed Current-Chamber knowledge, apply the
 *     turn-transition rules (self-blank keeps the Turn; self-live and any
 *     opponent shot pass it, honoring a pending Handcuffs skip), end the Match
 *     on zero HP, and reload when the Cylinder is now empty.
 *
 * Pure: randomness only via `rng`. Returns an `EngineResult`.
 */
export function fire(
  state: GameState,
  target: ParticipantId,
  rng: RNG,
): EngineResult {
  const firerId = state.activeParticipant;
  const round = currentChamber(state.cylinder);

  // Requirement 3.7 / 7.3: no loaded Round remains. Reject the Shot Action
  // without firing and reload as a new Round_Set. No HP changes.
  if (round === null) {
    const reloaded = loadRoundSet(state, rng);
    return {
      state: reloaded.state,
      events: reloaded.events,
      rejected: "EMPTY_CYLINDER",
    };
  }

  const isLive = round === "LIVE";
  const firer = state.participants[firerId];
  const events: GameEvent[] = [{ type: "SHOT_STARTED", target }];

  // Start from copies of both Participants so updates compose correctly even
  // when the firer shoots themselves (firer === target).
  let player: Participant = { ...state.participants.PLAYER };
  let ai: Participant = { ...state.participants.AI };
  const getP = (id: ParticipantId): Participant => (id === "PLAYER" ? player : ai);
  const setP = (id: ParticipantId, p: Participant): void => {
    if (id === "PLAYER") player = p;
    else ai = p;
  };

  if (isLive) {
    // Requirement 2.2/2.4: base damage 1 * multiplier, clamped so HP never goes
    // below zero.
    const targetParticipant = getP(target);
    const damage = Math.min(targetParticipant.hp, 1 * firer.damageMultiplier);
    const newHp = targetParticipant.hp - damage;
    setP(target, { ...getP(target), hp: newHp });

    events.push({ type: "LIVE_FIRED", target, damage });
    events.push({ type: "HP_CHANGED", participant: target, hp: newHp });

    // Requirement 5.10: reset the firer's multiplier after a multiplied shot.
    if (firer.damageMultiplier > 1) {
      setP(firerId, { ...getP(firerId), damageMultiplier: 1 });
    }
  } else {
    // Requirement 2.3: a Blank leaves HP unchanged and does not consume the
    // firer's Damage_Multiplier.
    events.push({ type: "BLANK_FIRED", target });
  }

  // A Shot invalidates any revealed knowledge of the Current Chamber for BOTH
  // Participants (Requirement 5.4: revealed knowledge is valid only until the
  // next Shot or Spin).
  player = { ...player, revealedCurrentChamber: null };
  ai = { ...ai, revealedCurrentChamber: null };

  const participants: Record<ParticipantId, Participant> = { PLAYER: player, AI: ai };

  // Requirement 3.3: empty the fired Chamber and advance the Current Chamber.
  const firedCylinder = advanceAfterFire(state.cylinder);

  // Requirement 2.5 / 7.4: the Match ends when the target reaches zero HP; the
  // surviving Participant is declared the winner (the firer when shooting the
  // opponent; the opponent when a self-shot is lethal).
  const matchOver = participants[target].hp <= 0;

  let phase = state.phase;
  let winner = state.winner;
  let activeParticipant = firerId;
  let spinsUsedThisTurn = state.spinsUsedThisTurn;
  let skipNextTurnOf = state.skipNextTurnOf;

  if (matchOver) {
    winner = opponentOf(target);
    phase = "MATCH_OVER";
    events.push({ type: "MATCH_OVER", winner });
  } else {
    // Turn transitions (Requirements 3.4, 3.5, 3.6): a Blank fired at oneself
    // retains the Turn; a Live self-shot or any shot at the opponent passes it.
    const keepTurn = target === firerId && !isLive;
    if (!keepTurn) {
      let nextActive = opponentOf(firerId);

      // Handcuffs (Requirement 5.7): if the Turn would pass to a flagged
      // Participant, consume the flag, emit TURN_SKIPPED, and return the Turn to
      // the firer.
      if (skipNextTurnOf === nextActive) {
        skipNextTurnOf = null;
        events.push({ type: "TURN_SKIPPED", participant: nextActive });
        nextActive = firerId;
      }

      if (nextActive !== activeParticipant) {
        activeParticipant = nextActive;
        spinsUsedThisTurn = 0; // reset whenever the active Participant changes
        events.push({ type: "TURN_PASSED", to: nextActive });
      }
    }
  }

  const firedState: GameState = {
    ...state,
    phase,
    cylinder: firedCylinder,
    participants,
    activeParticipant,
    spinsUsedThisTurn,
    skipNextTurnOf,
    winner,
  };

  // Requirement 7.3: if the Cylinder is now empty and the Match is not over,
  // reload as a new Round_Set and include its ROUND_SET_LOADED event.
  if (!matchOver && currentChamber(firedCylinder) === null) {
    const reloaded = loadRoundSet(firedState, rng);
    return {
      state: reloaded.state,
      events: [...events, ...reloaded.events],
    };
  }

  return { state: firedState, events };
}
