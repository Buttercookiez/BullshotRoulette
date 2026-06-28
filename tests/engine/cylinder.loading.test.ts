import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { loadCylinder, remainingCounts } from "../../src/engine/cylinder";
import { SeededRng } from "../../src/rng/rng";

describe("loadCylinder", () => {
  // A valid composition has total in [2, 6] with at least 1 Live and 1 Blank.
  const validComposition = fc
    .record({
      live: fc.integer({ min: 1, max: 5 }),
      blank: fc.integer({ min: 1, max: 5 }),
    })
    .filter(({ live, blank }) => {
      const total = live + blank;
      return total >= 2 && total <= 6;
    });

  // Feature: revolver-roulette, Property 1: Loading always produces a valid Round_Set
  it("always produces a valid Round_Set for any valid composition and seed", () => {
    fc.assert(
      fc.property(validComposition, fc.integer(), ({ live, blank }, seed) => {
        const rng = new SeededRng(seed);
        const cylinder = loadCylinder(live, blank, rng);
        const total = live + blank;

        // size in [2, 6] and equals the requested total.
        expect(cylinder.size).toBe(total);
        expect(cylinder.size).toBeGreaterThanOrEqual(2);
        expect(cylinder.size).toBeLessThanOrEqual(6);

        // Exactly one Round per Chamber: no nulls at load, length == size.
        expect(cylinder.chambers).toHaveLength(total);
        expect(cylinder.chambers.every((c) => c === "LIVE" || c === "BLANK")).toBe(true);

        // Live/Blank counts equal the true composition.
        const liveTrue = cylinder.chambers.filter((c) => c === "LIVE").length;
        const blankTrue = cylinder.chambers.filter((c) => c === "BLANK").length;
        expect(liveTrue).toBe(live);
        expect(blankTrue).toBe(blank);

        // Displayed remaining counts match the true composition at load.
        const counts = remainingCounts(cylinder);
        expect(counts.live).toBe(live);
        expect(counts.blank).toBe(blank);

        // Current Chamber starts at index 0.
        expect(cylinder.currentIndex).toBe(0);
      }),
      { numRuns: 200 },
    );
  });

  it("rejects invalid compositions without creating partial state", () => {
    const rng = new SeededRng(1);

    // Missing a Live or a Blank Round.
    expect(() => loadCylinder(0, 2, rng)).toThrow();
    expect(() => loadCylinder(2, 0, rng)).toThrow();
    expect(() => loadCylinder(0, 0, rng)).toThrow();

    // Total below the minimum of 2.
    expect(() => loadCylinder(1, 0, rng)).toThrow();

    // Total above the maximum of 6.
    expect(() => loadCylinder(4, 3, rng)).toThrow();
    expect(() => loadCylinder(6, 6, rng)).toThrow();

    // Negative / non-integer counts.
    expect(() => loadCylinder(-1, 2, rng)).toThrow();
    expect(() => loadCylinder(1.5, 1, rng)).toThrow();
  });

  // Feature: revolver-roulette, Property 1: Loading always produces a valid Round_Set
  it("rejects any out-of-range composition, accepts any in-range one", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 0, max: 8 }),
        fc.integer(),
        (live, blank, seed) => {
          const rng = new SeededRng(seed);
          const total = live + blank;
          const isValid = live >= 1 && blank >= 1 && total >= 2 && total <= 6;

          if (isValid) {
            const cylinder = loadCylinder(live, blank, rng);
            expect(cylinder.size).toBe(total);
          } else {
            expect(() => loadCylinder(live, blank, rng)).toThrow();
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
