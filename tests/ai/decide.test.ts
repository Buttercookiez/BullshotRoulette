import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { decide } from "../../src/ai/decide";
import type {
  Action,
  ItemType,
  PlayerView,
  RoundType,
} from "../../src/engine/types";

// The AI's `self` in any AI-turn view is always "AI"; "the Player" is the
// opponent target "PLAYER".
const SELF = "AI" as const;
const PLAYER = "PLAYER" as const;

const ITEM_TYPES: ItemType[] = [
  "MAGNIFYING_GLASS",
  "SPEED_LOADER",
  "MEDKIT",
  "HANDCUFFS",
  "INVERTER",
  "HOLLOW_POINT",
];

const arbItems: fc.Arbitrary<ReadonlyArray<ItemType>> = fc.array(
  fc.constantFrom(...ITEM_TYPES),
  { maxLength: 4 },
);

const arbKnown: fc.Arbitrary<RoundType | null> = fc.constantFrom<
  RoundType | null
>("LIVE", "BLANK", null);

/**
 * Build a valid AI-turn `PlayerView`. `self` is constant "AI" and the opponent
 * is the Player. Round counts are non-negative with
 * `roundsRemaining === liveRemaining + blankRemaining`. All other fields are
 * filled with valid in-range values.
 */
const arbView: fc.Arbitrary<PlayerView> = fc
  .record({
    live: fc.nat({ max: 6 }),
    blank: fc.nat({ max: 6 }),
    selfHp: fc.integer({ min: 0, max: 6 }),
    opponentHp: fc.integer({ min: 0, max: 6 }),
    selfItems: arbItems,
    opponentItems: arbItems,
    maxSpinsPerTurn: fc.integer({ min: 1, max: 3 }),
    spinsUsedThisTurn: fc.integer({ min: 0, max: 3 }),
    knownCurrentChamber: arbKnown,
  })
  .map(
    (r): PlayerView => ({
      phase: "AI_THINKING",
      self: SELF,
      selfHp: r.selfHp,
      opponentHp: r.opponentHp,
      selfItems: r.selfItems,
      opponentItems: r.opponentItems,
      liveRemaining: r.live,
      blankRemaining: r.blank,
      roundsRemaining: r.live + r.blank,
      spinsUsedThisTurn: r.spinsUsedThisTurn,
      maxSpinsPerTurn: r.maxSpinsPerTurn,
      knownCurrentChamber: r.knownCurrentChamber,
    }),
  );

/** A SHOOT action with a target that is one of the two valid participants. */
function isLegalShoot(action: Action): boolean {
  return (
    action.kind === "SHOOT" &&
    (action.target === "AI" || action.target === "PLAYER")
  );
}

describe("AI decide", () => {
  // Feature: revolver-roulette, Property 20: The AI always returns a single legal action
  it("always returns a single legal SHOOT action with a valid target", () => {
    fc.assert(
      fc.property(arbView, (view) => {
        const action = decide(view);
        // Exactly one Action of kind SHOOT with a valid target. `decide` only
        // emits SHOOT, so a structural legality check is sufficient.
        expect(action.kind).toBe("SHOOT");
        expect(isLegalShoot(action)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: revolver-roulette, Property 21: AI shoots the Player when all remaining Rounds are Blank
  it("shoots the Player when all remaining Rounds are Blank", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }), // blank count (rounds remain)
        arbKnown,
        (blank, known) => {
          const view: PlayerView = {
            phase: "AI_THINKING",
            self: SELF,
            selfHp: 3,
            opponentHp: 3,
            selfItems: [],
            opponentItems: [],
            liveRemaining: 0,
            blankRemaining: blank,
            roundsRemaining: blank,
            spinsUsedThisTurn: 0,
            maxSpinsPerTurn: 1,
            knownCurrentChamber: known,
          };
          const action = decide(view);
          expect(action).toEqual({ kind: "SHOOT", target: PLAYER });
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: revolver-roulette, Property 22: AI shoots the Player when all remaining Rounds are Live
  it("shoots the Player when all remaining Rounds are Live", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }), // live count (rounds remain)
        arbKnown,
        (live, known) => {
          const view: PlayerView = {
            phase: "AI_THINKING",
            self: SELF,
            selfHp: 3,
            opponentHp: 3,
            selfItems: [],
            opponentItems: [],
            liveRemaining: live,
            blankRemaining: 0,
            roundsRemaining: live,
            spinsUsedThisTurn: 0,
            maxSpinsPerTurn: 1,
            knownCurrentChamber: known,
          };
          const action = decide(view);
          expect(action).toEqual({ kind: "SHOOT", target: PLAYER });
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: revolver-roulette, Property 23: AI shoots itself on a known Blank when Live Rounds remain
  it("shoots itself on a known Blank when Live Rounds remain", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }), // live remaining (so not all blank)
        fc.integer({ min: 1, max: 6 }), // blank remaining (so not all live)
        (live, blank) => {
          const view: PlayerView = {
            phase: "AI_THINKING",
            self: SELF,
            selfHp: 3,
            opponentHp: 3,
            selfItems: [],
            opponentItems: [],
            liveRemaining: live,
            blankRemaining: blank,
            roundsRemaining: live + blank,
            spinsUsedThisTurn: 0,
            maxSpinsPerTurn: 1,
            knownCurrentChamber: "BLANK",
          };
          const action = decide(view);
          expect(action).toEqual({ kind: "SHOOT", target: SELF });
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: revolver-roulette, Property 24: AI defaults to shooting the Player
  it("defaults to shooting the Player when no other condition holds", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }), // live remaining (not all blank)
        fc.integer({ min: 1, max: 6 }), // blank remaining (not all live)
        // Default applies when the Current Chamber is not a known Blank:
        // either unknown (null) or a known Live.
        fc.constantFrom<RoundType | null>("LIVE", null),
        (live, blank, known) => {
          const view: PlayerView = {
            phase: "AI_THINKING",
            self: SELF,
            selfHp: 3,
            opponentHp: 3,
            selfItems: [],
            opponentItems: [],
            liveRemaining: live,
            blankRemaining: blank,
            roundsRemaining: live + blank,
            spinsUsedThisTurn: 0,
            maxSpinsPerTurn: 1,
            knownCurrentChamber: known,
          };
          // None of the conditions for Properties 21-23 hold: rounds are mixed
          // (both live and blank remain) and the chamber is not a known Blank.
          const action = decide(view);
          expect(action).toEqual({ kind: "SHOOT", target: PLAYER });
        },
      ),
      { numRuns: 200 },
    );
  });
});
