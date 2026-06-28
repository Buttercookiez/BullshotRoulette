import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { toPlayerView } from "../../src/engine/view";
import { createMatch } from "../../src/engine/lifecycle";
import type {
  Chamber,
  Cylinder,
  GameConfig,
  GameState,
  ParticipantId,
  RoundType,
} from "../../src/engine/types";
import { SeededRng } from "../../src/rng/rng";

// The exact, whitelisted set of keys a PlayerView is allowed to expose. If the
// projection ever leaks a new field (e.g. the chambers array), this set check
// fails — that is the guard against exposing the hidden order.
const ALLOWED_VIEW_KEYS = [
  "phase",
  "self",
  "selfHp",
  "opponentHp",
  "selfItems",
  "opponentItems",
  "liveRemaining",
  "blankRemaining",
  "roundsRemaining",
  "spinsUsedThisTurn",
  "maxSpinsPerTurn",
  "knownCurrentChamber",
].sort();

// A valid GameConfig honoring the requirements' ranges.
const arbConfig: fc.Arbitrary<GameConfig> = fc
  .record({
    startingHp: fc.integer({ min: 2, max: 6 }),
    minRounds: fc.integer({ min: 2, max: 6 }),
    maxRounds: fc.integer({ min: 2, max: 6 }),
    itemsPerRoundSet: fc.integer({ min: 0, max: 4 }),
    maxSpinsPerTurn: fc.integer({ min: 1, max: 3 }),
  })
  .filter((c) => c.minRounds <= c.maxRounds)
  .map((c) => ({ ...c, maxItems: 4 }));

const arbRevealed: fc.Arbitrary<RoundType | null> = fc.constantFrom<
  RoundType | null
>("LIVE", "BLANK", null);

const arbParticipant: fc.Arbitrary<ParticipantId> = fc.constantFrom<ParticipantId>(
  "PLAYER",
  "AI",
);

/**
 * Fire `n` rounds from a cylinder using the engine's firing model: empty the
 * Current Chamber and advance `currentIndex` to the next loaded chamber. This
 * builds reachable mid-Round_Set cylinders for the projection to recount.
 */
function fireRounds(cylinder: Cylinder, n: number): Cylinder {
  const chambers: Chamber[] = cylinder.chambers.slice();
  let currentIndex = cylinder.currentIndex;
  let fired = 0;
  while (fired < n && currentIndex < chambers.length) {
    if (chambers[currentIndex] != null) {
      chambers[currentIndex] = null;
      fired++;
    }
    currentIndex++;
    while (currentIndex < chambers.length && chambers[currentIndex] == null) {
      currentIndex++;
    }
  }
  return { chambers, currentIndex, size: cylinder.size };
}

/** Independent recount of unfired chambers from currentIndex onward. */
function recountUnfired(cylinder: Cylinder): { live: number; blank: number } {
  let live = 0;
  let blank = 0;
  for (let i = cylinder.currentIndex; i < cylinder.chambers.length; i++) {
    const r = cylinder.chambers[i];
    if (r === "LIVE") live++;
    else if (r === "BLANK") blank++;
  }
  return { live, blank };
}

describe("toPlayerView", () => {
  // Feature: revolver-roulette, Property 3: PlayerView exposes accurate counts but never the hidden order
  it("reports accurate remaining counts, never the hidden order, and only the projected participant's revealed knowledge", () => {
    fc.assert(
      fc.property(
        arbConfig,
        fc.integer(),
        fc.nat(),
        arbParticipant,
        arbRevealed,
        arbRevealed,
        (config, seed, fireCount, viewer, selfRevealed, oppRevealed) => {
          // Build a reachable state via createMatch, then fire some rounds and
          // set each participant's private revealed knowledge independently.
          const base = createMatch(config, new SeededRng(seed)).state;
          const firedCylinder = fireRounds(
            base.cylinder,
            fireCount % (base.cylinder.size + 1),
          );

          const opponent: ParticipantId = viewer === "PLAYER" ? "AI" : "PLAYER";
          const state: GameState = {
            ...base,
            cylinder: firedCylinder,
            participants: {
              ...base.participants,
              [viewer]: {
                ...base.participants[viewer],
                revealedCurrentChamber: selfRevealed,
              },
              [opponent]: {
                ...base.participants[opponent],
                revealedCurrentChamber: oppRevealed,
              },
            },
          };

          const view = toPlayerView(state, viewer);

          // Counts equal a direct recount of unfired chambers.
          const recount = recountUnfired(firedCylinder);
          expect(view.liveRemaining).toBe(recount.live);
          expect(view.blankRemaining).toBe(recount.blank);

          // roundsRemaining is the sum of remaining live + blank.
          expect(view.roundsRemaining).toBe(recount.live + recount.blank);
          expect(view.roundsRemaining).toBe(
            view.liveRemaining + view.blankRemaining,
          );

          // The view exposes exactly the whitelisted keys — no per-chamber
          // order/classification array is ever attached.
          expect(Object.keys(view).sort()).toEqual(ALLOWED_VIEW_KEYS);

          // No array-valued property leaks the chambers array: chambers can
          // contain `null` (fired) entries, which item inventories never do.
          for (const value of Object.values(view)) {
            if (Array.isArray(value)) {
              expect(value).not.toContain(null);
              expect(value).not.toEqual(firedCylinder.chambers);
            }
          }

          // knownCurrentChamber reflects ONLY the projected participant's own
          // revealed value: null unless set, equal to it when set.
          expect(view.knownCurrentChamber).toBe(selfRevealed);

          // The opponent's revealed knowledge never appears. When the viewer
          // revealed nothing but the opponent did, the view stays null.
          if (selfRevealed === null) {
            expect(view.knownCurrentChamber).toBeNull();
          }

          // Identity/HP/item projection is from the correct participants.
          expect(view.self).toBe(viewer);
          expect(view.selfHp).toBe(state.participants[viewer].hp);
          expect(view.opponentHp).toBe(state.participants[opponent].hp);
          expect(view.selfItems).toEqual(state.participants[viewer].items);
          expect(view.opponentItems).toEqual(
            state.participants[opponent].items,
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});
