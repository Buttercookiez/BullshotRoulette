import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { SeededRng, seededRng } from "../../src/rng/rng";

describe("SeededRng", () => {
  it("reproduces the same sequence for the same seed", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const a = new SeededRng(seed);
        const b = new SeededRng(seed);
        for (let i = 0; i < 50; i++) {
          expect(a.next()).toBe(b.next());
        }
      }),
      { numRuns: 100 },
    );
  });

  it("produces next() values in [0, 1)", () => {
    const rng = seededRng(123);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("produces nextInt(n) values in [0, n)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000 }), fc.integer(), (n, seed) => {
        const rng = new SeededRng(seed);
        for (let i = 0; i < 20; i++) {
          const v = rng.nextInt(n);
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(n);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("throws on a non-positive bound", () => {
    const rng = seededRng();
    expect(() => rng.nextInt(0)).toThrow(RangeError);
    expect(() => rng.nextInt(-1)).toThrow(RangeError);
  });

  it("two different seeds generally differ", () => {
    const a = new SeededRng(1);
    const b = new SeededRng(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });
});
