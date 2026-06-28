// Feature: revolver-roulette, Property 26: Tension volume rises monotonically and peaks at one Round remaining
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { tensionVolume } from "../../src/audio/tension";

describe("tensionVolume (Property 26 — Validates Requirement 9.7)", () => {
  it("always returns a volume in [0, 1]", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10, max: 100 }),
        fc.integer({ min: -10, max: 100 }),
        (roundsRemaining, roundsTotal) => {
          const v = tensionVolume(roundsRemaining, roundsTotal);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("is non-decreasing as roundsRemaining decreases for a fixed roundsTotal", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), (roundsTotal) => {
        // Walk remaining from total down to 1; volume must never decrease.
        let previous = -Infinity;
        for (let remaining = roundsTotal; remaining >= 1; remaining--) {
          const v = tensionVolume(remaining, roundsTotal);
          expect(v).toBeGreaterThanOrEqual(previous);
          previous = v;
        }
      }),
      { numRuns: 100 },
    );
  });

  it("equals the maximum (1) when exactly 1 Round remains", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), (roundsTotal) => {
        expect(tensionVolume(1, roundsTotal)).toBe(1);
      }),
      { numRuns: 100 },
    );
  });

  it("is at its minimum (and > 0) when the cylinder is full", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), (roundsTotal) => {
        const full = tensionVolume(roundsTotal, roundsTotal);
        expect(full).toBeGreaterThan(0);
        // Full is the minimum over the valid remaining range [1, total].
        for (let remaining = roundsTotal; remaining >= 1; remaining--) {
          expect(tensionVolume(remaining, roundsTotal)).toBeGreaterThanOrEqual(full);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("handles degenerate roundsTotal gracefully by clamping", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -5, max: 5 }),
        fc.integer({ min: -5, max: 0 }),
        (roundsRemaining, roundsTotal) => {
          const v = tensionVolume(roundsRemaining, roundsTotal);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});
