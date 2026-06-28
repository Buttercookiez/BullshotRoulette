import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { spin } from "../../src/engine/spin";
import { createMatch, DEFAULT_CONFIG } from "../../src/engine/lifecycle";
import { remainingCounts } from "../../src/engine/cylinder";
import type {
  Chamber,
  GameConfig,
  GameState,
  ParticipantId,
  RoundType,
} from "../../src/engine/types";
import { SeededRng } from "../../src/rng/rng";

// ---------------------------------------------------------------------------
// Test helpers: build a GameState with a known Cylinder and a known per-Turn
// spin count, mirroring the approach used in shot.test.ts. We start from
// createMatch and override the cylinder / participants / spinsUsedThisTurn.
// ---------------------------------------------------------------------------

/** A fresh, fully-loaded base state from createMatch (Player to act). */
function baseState(seed: number, config: GameConfig = DEFAULT_CONFIG): GameState {
  return createMatch(config, new SeededRng(seed)).state;
}

interface Overrides {
  chambers: Chamber[];
  currentIndex?: number;
  active?: ParticipantId;
  spinsUsedThisTurn?: number;
  maxSpinsPerTurn?: number;
  playerRevealed?: RoundType | null;
  aiRevealed?: RoundType | null;
}

/** Build a GameState with a specific Cylinder, spin count, and revealed state. */
function makeState(seed: number, o: Overrides): GameState {
  const config: GameConfig = {
    ...DEFAULT_CONFIG,
    maxSpinsPerTurn: o.maxSpinsPerTurn ?? DEFAULT_CONFIG.maxSpinsPerTurn,
  };
  const s = baseState(seed, config);
  const currentIndex = o.currentIndex ?? 0;
  return {
    ...s,
    config,
    cylinder: {
      chambers: o.chambers.slice(),
      currentIndex,
      size: o.chambers.length,
    },
    activeParticipant: o.active ?? "PLAYER",
    spinsUsedThisTurn: o.spinsUsedThisTurn ?? 0,
    participants: {
      PLAYER: {
        ...s.participants.PLAYER,
        revealedCurrentChamber: o.playerRevealed ?? null,
      },
      AI: {
        ...s.participants.AI,
        revealedCurrentChamber: o.aiRevealed ?? null,
      },
    },
  };
}

const participantId = fc.constantFrom<ParticipantId>("PLAYER", "AI");
const roundType = fc.constantFrom<RoundType>("LIVE", "BLANK");

/**
 * An arbitrary array of chambers (loaded Rounds, no fired/null slots so the
 * remaining count equals the array length) with at least 2 Rounds so a Spin is
 * legal. Bounded to the [2, 6] Cylinder size range.
 */
const loadedChambers = (min: number) =>
  fc
    .array(roundType, { minLength: min, maxLength: 6 })
    .map((rs) => rs.slice() as Chamber[]);

describe("spin — Spin Action resolution", () => {
  // Feature: revolver-roulette, Property 10: Spin invalidates revealed knowledge
  it("clears every Participant's revealed Current-Chamber knowledge after a Spin", () => {
    fc.assert(
      fc.property(
        loadedChambers(2),
        participantId, // active participant
        // Either Participant may have stale revealed knowledge going in.
        fc.option(roundType, { nil: null }),
        fc.option(roundType, { nil: null }),
        fc.integer(),
        (chambers, active, playerRevealed, aiRevealed, seed) => {
          const state = makeState(seed, {
            chambers,
            active,
            spinsUsedThisTurn: 0,
            maxSpinsPerTurn: 3, // ensure the spin is allowed
            playerRevealed,
            aiRevealed,
          });

          const result = spin(state, new SeededRng(seed ^ 0x10));

          // The Spin is accepted (>= 2 Rounds remain, under the limit).
          expect(result.rejected).toBeUndefined();
          // Both Participants' revealed knowledge is invalidated (Req 4.3).
          expect(result.state.participants.PLAYER.revealedCurrentChamber).toBe(null);
          expect(result.state.participants.AI.revealedCurrentChamber).toBe(null);
          // A SPUN event is emitted.
          expect(result.events.some((e) => e.type === "SPUN")).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: revolver-roulette, Property 11: Spin limit per Turn is enforced
  it("accepts at most maxSpinsPerTurn Spins in a Turn and rejects the next one", () => {
    fc.assert(
      fc.property(
        loadedChambers(2),
        participantId,
        fc.integer({ min: 1, max: 3 }), // maxSpinsPerTurn (Req 4.5 range)
        fc.integer(),
        (chambers, active, maxSpins, seed) => {
          // Drive repeated Spins from a fresh Turn (spinsUsedThisTurn = 0). The
          // chambers always keep >= 2 Rounds (shuffleRemaining preserves the
          // multiset and never fires), so the ONLY thing that can stop a Spin
          // here is the per-Turn limit.
          let state = makeState(seed, {
            chambers,
            active,
            spinsUsedThisTurn: 0,
            maxSpinsPerTurn: maxSpins,
          });

          let accepted = 0;
          const rng = new SeededRng(seed ^ 0x11);
          // Attempt more Spins than the limit allows.
          for (let i = 0; i < maxSpins + 2; i++) {
            const result = spin(state, rng);
            if (result.rejected === undefined) {
              accepted++;
              // A successful Spin retains the Turn (Req 4.4) and counts toward
              // the limit (Req 4.5).
              expect(result.state.activeParticipant).toBe(active);
              expect(result.state.spinsUsedThisTurn).toBe(accepted);
            } else {
              expect(result.rejected).toBe("SPIN_NOT_ALLOWED");
            }
            state = result.state;
          }

          // The number of accepted Spins never exceeds the configured maximum.
          expect(accepted).toBe(maxSpins);
          expect(accepted).toBeLessThanOrEqual(maxSpins);

          // The very next Spin beyond the limit is rejected as a no-op.
          const beyond = spin(state, rng);
          expect(beyond.rejected).toBe("SPIN_NOT_ALLOWED");
          expect(beyond.state).toBe(state);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: revolver-roulette, Property 9: Illegal actions are state-preserving no-ops
  //
  // Focus here on the Spin-related illegal cases (Req 4.6): a Spin when fewer
  // than 2 Rounds remain, and a Spin when the per-Turn limit has been reached.
  // Both must leave the GameState deeply unchanged and retain the Turn.
  //
  // NOTE: The out-of-turn Shot (Req 3.8) and item-not-held (Req 5.13) branches
  // of Property 9 are additionally covered once the cross-cutting reducer exists
  // in Task 8; those branches are out of scope for this engine module.
  it("rejects illegal Spins as deep no-ops that retain the Turn", () => {
    fc.assert(
      fc.property(
        participantId, // active participant
        fc.integer(),
        (active, seed) => {
          const snapshots: GameState[] = [];

          // Case A: fewer than 2 Rounds remain (a single loaded Round). Even
          // with spins available, the Spin is illegal (Req 4.1 / 4.6).
          const tooFew = makeState(seed, {
            chambers: ["LIVE"],
            active,
            spinsUsedThisTurn: 0,
            maxSpinsPerTurn: 3,
          });
          snapshots.push(tooFew);

          // Case B: an entirely empty Cylinder also has fewer than 2 Rounds.
          const empty = makeState(seed, {
            chambers: [null, null, null],
            active,
            spinsUsedThisTurn: 0,
            maxSpinsPerTurn: 3,
          });
          snapshots.push(empty);

          // Case C: the per-Turn Spin limit has been reached (Req 4.5 / 4.6),
          // even though plenty of Rounds remain.
          const limitReached = makeState(seed, {
            chambers: ["LIVE", "BLANK", "LIVE"],
            active,
            spinsUsedThisTurn: 2,
            maxSpinsPerTurn: 2,
          });
          snapshots.push(limitReached);

          for (const before of snapshots) {
            const snapshot = JSON.parse(JSON.stringify(before)) as GameState;
            const result = spin(before, new SeededRng(seed ^ 0x9));

            // Rejected with the documented reason and no events.
            expect(result.rejected).toBe("SPIN_NOT_ALLOWED");
            expect(result.events).toHaveLength(0);
            // The returned state is the SAME reference (no copy was made) and
            // is deeply equal to the pre-action snapshot.
            expect(result.state).toBe(before);
            expect(result.state).toEqual(snapshot);
            // The Turn is retained with the Active_Participant (Req 4.6).
            expect(result.state.activeParticipant).toBe(active);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Sanity: a successful Spin preserves the Live/Blank multiset and sets the
// Current Chamber to index 0 (the first Round of the new order). This backs the
// shuffle-related guarantees relied on by the properties above.
describe("spin — composition preservation", () => {
  it("preserves remaining counts and resets the Current Chamber to the front", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<RoundType>("LIVE", "BLANK"), {
          minLength: 2,
          maxLength: 6,
        }),
        fc.integer(),
        (rounds, seed) => {
          const chambers = rounds.slice() as Chamber[];
          const state = makeState(seed, {
            chambers,
            spinsUsedThisTurn: 0,
            maxSpinsPerTurn: 3,
          });
          const before = remainingCounts(state.cylinder);

          const result = spin(state, new SeededRng(seed ^ 0x42));
          const after = remainingCounts(result.state.cylinder);

          expect(after.live).toBe(before.live);
          expect(after.blank).toBe(before.blank);
          expect(result.state.cylinder.currentIndex).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
