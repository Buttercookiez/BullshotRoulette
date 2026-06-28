// Cylinder loading and shuffling for the Revolver Roulette rules engine.
//
// All functions here are PURE: they operate on the immutable `Cylinder` type,
// produce new objects rather than mutating, and draw randomness only from the
// injected `RNG`. They never call `Math.random` directly.

import type { Chamber, Cylinder, RoundType } from "./types";
import type { RNG } from "../rng/rng";

/**
 * Fisher-Yates uniform shuffle of an array in place, drawing swap indices from
 * the injected RNG. Every permutation is equally likely. Mutates and returns
 * the same array; callers own a private copy so this stays referentially pure.
 */
function shuffleInPlace<T>(arr: T[], rng: RNG): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    // Non-null assertions: i and j are always valid indices in [0, length).
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Build a valid, uniformly shuffled Cylinder for a new Round_Set.
 *
 * The composition must satisfy: total = liveCount + blankCount in [2, 6], with
 * liveCount >= 1 and blankCount >= 1. An invalid composition throws a clear
 * Error and produces no partial state (Requirements 1.1, 1.3). The rounds are
 * placed one per chamber and uniformly shuffled (Requirement 1.2), with the
 * Current Chamber at index 0.
 */
export function loadCylinder(
  liveCount: number,
  blankCount: number,
  rng: RNG,
): Cylinder {
  if (!Number.isInteger(liveCount) || !Number.isInteger(blankCount)) {
    throw new Error(
      `Invalid Cylinder composition: liveCount and blankCount must be integers, got live=${liveCount}, blank=${blankCount}`,
    );
  }
  if (liveCount < 1 || blankCount < 1) {
    throw new Error(
      `Invalid Cylinder composition: need at least 1 Live and 1 Blank Round, got live=${liveCount}, blank=${blankCount}`,
    );
  }
  const total = liveCount + blankCount;
  if (total < 2 || total > 6) {
    throw new Error(
      `Invalid Cylinder composition: total Rounds must be in [2, 6], got ${total} (live=${liveCount}, blank=${blankCount})`,
    );
  }

  const rounds: RoundType[] = [];
  for (let i = 0; i < liveCount; i++) rounds.push("LIVE");
  for (let i = 0; i < blankCount; i++) rounds.push("BLANK");
  shuffleInPlace(rounds, rng);

  const chambers: Chamber[] = rounds.slice();
  return {
    chambers,
    currentIndex: 0,
    size: total,
  };
}

/**
 * Uniformly permute only the rounds still to be fired (the non-null chambers),
 * preserving the Live/Blank multiset (Requirement 4.2). The remaining rounds
 * are compacted to the front of a fresh chambers array and the Current Chamber
 * is set to index 0 — the first remaining round of the new order. Already-fired
 * positions become `null`. Returns a new Cylinder; the input is untouched.
 */
export function shuffleRemaining(cylinder: Cylinder, rng: RNG): Cylinder {
  const remaining: RoundType[] = [];
  for (let i = 0; i < cylinder.chambers.length; i++) {
    const round = cylinder.chambers[i];
    if (round !== null && round !== undefined) {
      remaining.push(round);
    }
  }

  shuffleInPlace(remaining, rng);

  const chambers: Chamber[] = new Array<Chamber>(cylinder.size).fill(null);
  for (let i = 0; i < remaining.length; i++) {
    chambers[i] = remaining[i]!;
  }

  return {
    chambers,
    currentIndex: 0,
    size: cylinder.size,
  };
}

/**
 * Count the Live and Blank Rounds still to be fired: the non-null chambers from
 * `currentIndex` onward (Requirement 1.5). These are the visible counts shown
 * to both Participants and used by the AI.
 */
export function remainingCounts(cylinder: Cylinder): {
  live: number;
  blank: number;
} {
  let live = 0;
  let blank = 0;
  for (let i = cylinder.currentIndex; i < cylinder.chambers.length; i++) {
    const round = cylinder.chambers[i];
    if (round === "LIVE") live++;
    else if (round === "BLANK") blank++;
  }
  return { live, blank };
}
