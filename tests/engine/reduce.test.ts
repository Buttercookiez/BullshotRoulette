import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { reduce } from "../../src/engine/reduce";
import { createMatch, DEFAULT_CONFIG } from "../../src/engine/lifecycle";
import { remainingCounts } from "../../src/engine/cylinder";
import type { Action, GameConfig, GameState } from "../../src/engine/types";
import { SeededRng } from "../../src/rng/rng";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** A valid GameConfig over the requirement-bounded ranges. */
const arbConfig: fc.Arbitrary<GameConfig> = fc
  .record({
    startingHp: fc.integer({ min: 2, max: 6 }),
    minRounds: fc.integer({ min: 2, max: 6 }),
    extraRounds: fc.integer({ min: 0, max: 4 }),
    itemsPerRoundSet: fc.integer({ min: 0, max: 4 }),
    maxSpinsPerTurn: fc.integer({ min: 1, max: 3 }),
  })
  .map(({ startingHp, minRounds, extraRounds, itemsPerRoundSet, maxSpinsPerTurn }) => {
    const maxRounds = Math.min(6, minRounds + extraRounds);
    return {
      startingHp,
      minRounds,
      maxRounds,
      itemsPerRoundSet,
      maxItems: 4,
      maxSpinsPerTurn,
    } satisfies GameConfig;
  });

const arbAction: fc.Arbitrary<Action> = fc.oneof(
  fc.constantFrom<Action>(
    { kind: "SHOOT", target: "PLAYER" },
    { kind: "SHOOT", target: "AI" },
    { kind: "SPIN" },
  ),
  fc.constantFrom(
    "MAGNIFYING_GLASS",
    "SPEED_LOADER",
    "MEDKIT",
    "HANDCUFFS",
    "INVERTER",
    "HOLLOW_POINT",
  ).map((item) => ({ kind: "USE_ITEM", item }) as Action),
);

/**
 * Drive an arbitrary (reachable-ish) state by applying a sequence of actions
 * through `reduce` from a fresh Match. This produces a variety of mid-match,
 * reloaded, and match-over states to start a new Match from.
 */
function reachableState(config: GameConfig, seed: number, actions: Action[]): GameState {
  const rng = new SeededRng(seed);
  let state = createMatch(config, rng).state;
  for (const action of actions) {
    state = reduce(state, action, rng).state;
  }
  return state;
}

// ---------------------------------------------------------------------------
// Property 25
// ---------------------------------------------------------------------------

describe("reduce — START_NEW_MATCH reset", () => {
  // Feature: revolver-roulette, Property 25: Starting a new Match resets all state to initial values
  it("resets all state to initial values from any reachable or over state", () => {
    fc.assert(
      fc.property(
        arbConfig,
        fc.integer(),
        fc.array(arbAction, { minLength: 0, maxLength: 30 }),
        fc.integer(),
        (config, seed, actions, resetSeed) => {
          const start = reachableState(config, seed, actions);

          const result = reduce(start, { kind: "START_NEW_MATCH" }, new SeededRng(resetSeed));
          const next = result.state;

          // Not a rejection — START_NEW_MATCH is always accepted.
          expect(result.rejected).toBeUndefined();

          // Both Participants restored to the configured starting HP (Req 2.1).
          expect(next.participants.PLAYER.hp).toBe(config.startingHp);
          expect(next.participants.AI.hp).toBe(config.startingHp);

          // Damage_Multipliers reset to 1, revealed knowledge cleared.
          expect(next.participants.PLAYER.damageMultiplier).toBe(1);
          expect(next.participants.AI.damageMultiplier).toBe(1);
          expect(next.participants.PLAYER.revealedCurrentChamber).toBeNull();
          expect(next.participants.AI.revealedCurrentChamber).toBeNull();

          // Inventory reset per Requirement 5: capped at maxItems.
          expect(next.participants.PLAYER.items.length).toBeLessThanOrEqual(config.maxItems);
          expect(next.participants.AI.items.length).toBeLessThanOrEqual(config.maxItems);

          // Turn assignment and phase reset to the Player's first turn (Req 7.2).
          expect(next.activeParticipant).toBe("PLAYER");
          expect(next.phase).toBe("PLAYER_TURN");

          // Match progress counters reset.
          expect(next.winner).toBeNull();
          expect(next.spinsUsedThisTurn).toBe(0);
          expect(next.skipNextTurnOf).toBeNull();
          expect(next.roundSetIndex).toBe(0);

          // A valid new Cylinder: size 2..6 with >=1 live and >=1 blank.
          expect(next.cylinder.size).toBeGreaterThanOrEqual(2);
          expect(next.cylinder.size).toBeLessThanOrEqual(6);
          const counts = remainingCounts(next.cylinder);
          expect(counts.live).toBeGreaterThanOrEqual(1);
          expect(counts.blank).toBeGreaterThanOrEqual(1);
          expect(counts.live + counts.blank).toBe(next.cylinder.size);

          // A ROUND_SET_LOADED event accompanies the reset.
          expect(result.events.some((e) => e.type === "ROUND_SET_LOADED")).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  // reduce() never throws on a MATCH_OVER state for non-START actions; it
  // returns a state-preserving rejected "MATCH_OVER" (design Error Handling).
  it("rejects non-START actions when the Match is over, preserving state", () => {
    fc.assert(
      fc.property(arbAction, fc.integer(), (action, seed) => {
        // A clearly match-over state: AI defeated, winner declared.
        const base = createMatch(DEFAULT_CONFIG, new SeededRng(seed)).state;
        const over: GameState = {
          ...base,
          phase: "MATCH_OVER",
          winner: "PLAYER",
          participants: {
            ...base.participants,
            AI: { ...base.participants.AI, hp: 0 },
          },
        };

        const result = reduce(over, action, new SeededRng(seed ^ 0x5a5a));

        expect(result.rejected).toBe("MATCH_OVER");
        expect(result.events).toEqual([]);
        // State is preserved unchanged (referential identity).
        expect(result.state).toBe(over);
      }),
      { numRuns: 200 },
    );
  });
});
