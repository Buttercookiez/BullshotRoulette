import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { loadCylinder, shuffleRemaining, remainingCounts } from "../../src/engine/cylinder";
import type { Cylinder } from "../../src/engine/types";
import { SeededRng } from "../../src/rng/rng";

describe("shuffleRemaining", () => {
  const validComposition = fc
    .record({
      live: fc.integer({ min: 1, max: 5 }),
      blank: fc.integer({ min: 1, max: 5 }),
    })
    .filter(({ live, blank }) => {
      const total = live + blank;
      return total >= 2 && total <= 6;
    });

  // Fire `n` rounds from a cylinder using the simple model: empty the current
  // chamber and advance currentIndex to the next loaded chamber.
  function fireRounds(cylinder: Cylinder, n: number): Cylinder {
    const chambers = cylinder.chambers.slice();
    let currentIndex = cylinder.currentIndex;
    let fired = 0;
    while (fired < n && currentIndex < chambers.length) {
      if (chambers[currentIndex] !== null && chambers[currentIndex] !== undefined) {
        chambers[currentIndex] = null;
        fired++;
      }
      currentIndex++;
      while (
        currentIndex < chambers.length &&
        (chambers[currentIndex] === null || chambers[currentIndex] === undefined)
      ) {
        currentIndex++;
      }
    }
    return { chambers, currentIndex, size: cylinder.size };
  }

  // Feature: revolver-roulette, Property 2: Shuffle preserves composition and is uniform
  it("preserves the live/blank multiset and points the Current Chamber at the first remaining round", () => {
    fc.assert(
      fc.property(
        validComposition,
        fc.integer(),
        fc.integer(),
        fc.nat(),
        ({ live, blank }, loadSeed, spinSeed, fireCount) => {
          const loaded = loadCylinder(live, blank, new SeededRng(loadSeed));
          const total = live + blank;

          // Fire some rounds (0..total-1) so a non-trivial subset remains.
          const fired = fireRounds(loaded, fireCount % total);
          const before = remainingCounts(fired);

          const spun = shuffleRemaining(fired, new SeededRng(spinSeed));
          const after = remainingCounts(spun);

          // Multiset of remaining Live/Blank rounds is preserved.
          expect(after.live).toBe(before.live);
          expect(after.blank).toBe(before.blank);

          // Size is preserved.
          expect(spun.size).toBe(total);

          // The Current Chamber becomes the first remaining round of the new
          // order: currentIndex is 0 and (when rounds remain) chamber 0 is loaded.
          expect(spun.currentIndex).toBe(0);
          const remainingTotal = after.live + after.blank;
          if (remainingTotal > 0) {
            expect(spun.chambers[0] === "LIVE" || spun.chambers[0] === "BLANK").toBe(true);
            // Remaining rounds are compacted to the front: no gaps among them.
            for (let i = 0; i < remainingTotal; i++) {
              expect(spun.chambers[i] === "LIVE" || spun.chambers[i] === "BLANK").toBe(true);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: revolver-roulette, Property 2: Shuffle preserves composition and is uniform
  it("produces an approximately uniform distribution of orderings (sanity check)", () => {
    // For a 2-live / 1-blank cylinder there are 3 distinct orderings of the
    // remaining rounds (positions of the single blank). Over many seeds every
    // ordering should appear with non-trivial frequency.
    const blankPositionCounts = [0, 0, 0];
    const runs = 3000;
    for (let seed = 0; seed < runs; seed++) {
      const spun = shuffleRemaining(loadCylinder(2, 1, new SeededRng(seed)), new SeededRng(seed * 7 + 1));
      const blankIndex = spun.chambers.findIndex((c) => c === "BLANK");
      expect(blankIndex).toBeGreaterThanOrEqual(0);
      blankPositionCounts[blankIndex] = (blankPositionCounts[blankIndex] ?? 0) + 1;
    }
    // Each of the 3 positions should get roughly 1/3 of the runs; allow a wide
    // band so this is a sanity check, not a brittle statistical test.
    const expected = runs / 3;
    for (const count of blankPositionCounts) {
      expect(count).toBeGreaterThan(expected * 0.7);
      expect(count).toBeLessThan(expected * 1.3);
    }
  });
});
