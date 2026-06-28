import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { grantItems, ALL_ITEM_TYPES } from "../../src/engine/lifecycle";
import type { ItemType } from "../../src/engine/types";
import { SeededRng } from "../../src/rng/rng";

const MAX_ITEMS = 4;
const VALID_ITEMS = new Set<ItemType>(ALL_ITEM_TYPES);

describe("grantItems", () => {
  // An arbitrary pre-existing inventory of valid Item types, length 0..6.
  const inventory = fc.array(fc.constantFrom<ItemType>(...ALL_ITEM_TYPES), {
    minLength: 0,
    maxLength: 6,
  });

  // Feature: revolver-roulette, Property 13: Item grant respects the inventory cap
  it("never exceeds the cap, yields only valid items, and discards overflow", () => {
    fc.assert(
      fc.property(
        inventory,
        fc.integer({ min: 0, max: 4 }), // itemsPerRoundSet in [0, 4]
        fc.integer(),
        (existing, grantCount, seed) => {
          const rng = new SeededRng(seed);
          const result = grantItems(existing, grantCount, MAX_ITEMS, rng);

          // Inventory length is capped at the maximum (4).
          expect(result.length).toBeLessThanOrEqual(MAX_ITEMS);

          // Every item is one of the six valid Item types.
          for (const item of result) {
            expect(VALID_ITEMS.has(item)).toBe(true);
          }

          // Overflow beyond the cap is discarded: the resulting length is the
          // pre-existing-plus-granted total, clamped to the cap.
          const expectedLength = Math.min(existing.length + grantCount, MAX_ITEMS);
          expect(result.length).toBe(expectedLength);

          // When nothing is discarded, the existing items are preserved as a prefix.
          if (existing.length + grantCount <= MAX_ITEMS) {
            expect(result.slice(0, existing.length)).toEqual(existing);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
