import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { applyItem } from "../../src/engine/items";
import { fire } from "../../src/engine/shot";
import { createMatch, DEFAULT_CONFIG, ALL_ITEM_TYPES } from "../../src/engine/lifecycle";
import type {
  Chamber,
  DamageMultiplier,
  GameState,
  ItemType,
  ParticipantId,
  RoundType,
} from "../../src/engine/types";
import { SeededRng } from "../../src/rng/rng";

// ---------------------------------------------------------------------------
// Test helpers: build a GameState with a known Cylinder and known inventories
// so a specific Round sits at the Current Chamber and the active Participant
// holds chosen Items. Starts from createMatch then overrides as in shot.test.
// ---------------------------------------------------------------------------

function baseState(seed: number): GameState {
  return createMatch(DEFAULT_CONFIG, new SeededRng(seed)).state;
}

function opponentOf(id: ParticipantId): ParticipantId {
  return id === "PLAYER" ? "AI" : "PLAYER";
}

interface Overrides {
  chambers: Chamber[];
  currentIndex?: number;
  active?: ParticipantId;
  playerHp?: number;
  aiHp?: number;
  playerItems?: ItemType[];
  aiItems?: ItemType[];
  playerMultiplier?: DamageMultiplier;
  aiMultiplier?: DamageMultiplier;
  playerRevealed?: RoundType | null;
  aiRevealed?: RoundType | null;
  skipNextTurnOf?: ParticipantId | null;
}

function makeState(seed: number, o: Overrides): GameState {
  const s = baseState(seed);
  const currentIndex = o.currentIndex ?? 0;
  return {
    ...s,
    cylinder: { chambers: o.chambers.slice(), currentIndex, size: o.chambers.length },
    activeParticipant: o.active ?? "PLAYER",
    skipNextTurnOf: o.skipNextTurnOf ?? null,
    participants: {
      PLAYER: {
        ...s.participants.PLAYER,
        hp: o.playerHp ?? s.participants.PLAYER.hp,
        items: o.playerItems ?? s.participants.PLAYER.items,
        damageMultiplier: o.playerMultiplier ?? 1,
        revealedCurrentChamber: o.playerRevealed ?? null,
      },
      AI: {
        ...s.participants.AI,
        hp: o.aiHp ?? s.participants.AI.hp,
        items: o.aiItems ?? s.participants.AI.items,
        damageMultiplier: o.aiMultiplier ?? 1,
        revealedCurrentChamber: o.aiRevealed ?? null,
      },
    },
  };
}

const itemType = fc.constantFrom<ItemType>(...ALL_ITEM_TYPES);
const participantId = fc.constantFrom<ParticipantId>("PLAYER", "AI");
const roundType = fc.constantFrom<RoundType>("LIVE", "BLANK");

describe("applyItem — Items system", () => {
  // Feature: revolver-roulette, Property 12: Non-shot actions retain the Turn
  it("keeps the active Participant unchanged when any held Item is used", () => {
    fc.assert(
      fc.property(
        itemType,
        participantId,
        roundType, // round at the Current Chamber (loaded)
        fc.integer(),
        (item, active, round, seed) => {
          // Two loaded Rounds so Speed_Loader still operates on a sane state and
          // no shot occurs here. The active Participant holds the item.
          const chambers: Chamber[] = [round, "BLANK"];
          const state = makeState(seed, {
            chambers,
            active,
            playerItems: active === "PLAYER" ? [item] : [],
            aiItems: active === "AI" ? [item] : [],
          });

          const result = applyItem(state, item, new SeededRng(seed ^ 0x11));

          // The Turn is retained: the active Participant never changes, and no
          // TURN_PASSED event is emitted by an Item use.
          expect(result.rejected).toBeUndefined();
          expect(result.state.activeParticipant).toBe(active);
          expect(result.events.some((e) => e.type === "TURN_PASSED")).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: revolver-roulette, Property 14: Using an Item removes exactly that Item
  it("reduces the count of the used Item by exactly one and total inventory by one", () => {
    // SPEED_LOADER is excluded here: it triggers a new Round_Set which grants a
    // fresh set of Items (Req 5.1/5.5), changing the inventory size beyond the
    // single removal this property isolates. Its removal is exercised by the
    // turn-retention property above; the removal semantics (Req 5.3) are tested
    // here for the other five Item types and via the same removal code path.
    const nonReloadItem = fc.constantFrom<ItemType>(
      ...ALL_ITEM_TYPES.filter((i) => i !== "SPEED_LOADER"),
    );
    // A non-empty inventory of valid items, plus the chosen item guaranteed present.
    fc.assert(
      fc.property(
        nonReloadItem,
        fc.array(itemType, { minLength: 0, maxLength: 3 }),
        participantId,
        roundType,
        fc.integer(),
        (item, rest, active, round, seed) => {
          const inventory = [item, ...rest]; // guaranteed to hold `item`
          const chambers: Chamber[] = [round, "BLANK"];
          const state = makeState(seed, {
            chambers,
            active,
            playerItems: active === "PLAYER" ? inventory : [],
            aiItems: active === "AI" ? inventory : [],
          });

          const before = state.participants[active].items;
          const countBefore = before.filter((i) => i === item).length;

          const result = applyItem(state, item, new SeededRng(seed ^ 0x22));
          const after = result.state.participants[active].items;
          const countAfter = after.filter((i) => i === item).length;

          // Exactly one instance of the used item removed.
          expect(countAfter).toBe(countBefore - 1);
          // Total inventory size reduced by exactly one.
          expect(after.length).toBe(before.length - 1);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: revolver-roulette, Property 15: Magnifying_Glass reveals only to the user
  it("sets the user's revealed Current Chamber to the true classification and leaves the opponent's unchanged", () => {
    fc.assert(
      fc.property(
        participantId,
        roundType,
        fc.integer(),
        (active, round, seed) => {
          const opp = opponentOf(active);
          const chambers: Chamber[] = [round, "BLANK"]; // loaded Current Chamber
          const state = makeState(seed, {
            chambers,
            active,
            playerItems: active === "PLAYER" ? ["MAGNIFYING_GLASS"] : [],
            aiItems: active === "AI" ? ["MAGNIFYING_GLASS"] : [],
            playerRevealed: null,
            aiRevealed: null,
          });

          const result = applyItem(state, "MAGNIFYING_GLASS", new SeededRng(seed ^ 0x33));

          // The user learns the true classification of the Current Chamber.
          expect(result.state.participants[active].revealedCurrentChamber).toBe(round);
          // The opponent's revealed knowledge is unchanged (still null).
          expect(result.state.participants[opp].revealedCurrentChamber).toBe(null);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: revolver-roulette, Property 16: Medkit heals up to the cap
  it("sets the user's HP to min(hp + 1, startingHp)", () => {
    fc.assert(
      fc.property(
        participantId,
        fc.integer({ min: 0, max: DEFAULT_CONFIG.startingHp }),
        fc.integer(),
        (active, hp, seed) => {
          const chambers: Chamber[] = ["BLANK", "BLANK"];
          const state = makeState(seed, {
            chambers,
            active,
            playerHp: active === "PLAYER" ? hp : DEFAULT_CONFIG.startingHp,
            aiHp: active === "AI" ? hp : DEFAULT_CONFIG.startingHp,
            playerItems: active === "PLAYER" ? ["MEDKIT"] : [],
            aiItems: active === "AI" ? ["MEDKIT"] : [],
          });

          const result = applyItem(state, "MEDKIT", new SeededRng(seed ^ 0x44));
          const expected = Math.min(hp + 1, DEFAULT_CONFIG.startingHp);

          expect(result.state.participants[active].hp).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: revolver-roulette, Property 17: Handcuffs skips exactly one opponent Turn
  it("skips exactly one opponent Turn, after which normal alternation resumes", () => {
    fc.assert(
      fc.property(
        participantId,
        fc.integer(),
        (active, seed) => {
          const opp = opponentOf(active);
          // All-Blank chambers so shots never deal damage / end the Match and
          // each shot at the opponent passes the Turn. Plenty of rounds so no
          // reload interferes with the alternation we are checking.
          const chambers: Chamber[] = new Array<Chamber>(6).fill("BLANK");
          const state = makeState(seed, {
            chambers,
            active,
            playerHp: DEFAULT_CONFIG.startingHp,
            aiHp: DEFAULT_CONFIG.startingHp,
            playerItems: active === "PLAYER" ? ["HANDCUFFS"] : [],
            aiItems: active === "AI" ? ["HANDCUFFS"] : [],
          });

          // Use Handcuffs: the opponent's next Turn is flagged for skipping.
          const cuffed = applyItem(state, "HANDCUFFS", new SeededRng(seed ^ 0x55));
          expect(cuffed.state.skipNextTurnOf).toBe(opp);
          expect(cuffed.state.activeParticipant).toBe(active);

          // Fire at the opponent: the Turn would pass to the opponent, but the
          // pending skip consumes it and returns the Turn to the active firer.
          const shot1 = fire(cuffed.state, opp, new SeededRng(seed ^ 0x56));
          expect(shot1.events.some((e) => e.type === "TURN_SKIPPED" && e.participant === opp)).toBe(true);
          expect(shot1.state.activeParticipant).toBe(active);
          // The skip flag is consumed exactly once.
          expect(shot1.state.skipNextTurnOf).toBe(null);

          // Fire again at the opponent: now normal alternation resumes — the
          // Turn passes to the opponent and no further skip occurs.
          const shot2 = fire(shot1.state, opp, new SeededRng(seed ^ 0x57));
          expect(shot2.events.some((e) => e.type === "TURN_SKIPPED")).toBe(false);
          expect(shot2.state.activeParticipant).toBe(opp);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: revolver-roulette, Property 18: Inverter flips the Current Chamber and is an involution
  it("flips the Current Chamber's classification, and applying it twice restores the original", () => {
    fc.assert(
      fc.property(
        participantId,
        roundType,
        fc.integer(),
        (active, round, seed) => {
          const idx = 0;
          const chambers: Chamber[] = [round, "LIVE", "BLANK"];
          const state = makeState(seed, {
            chambers,
            currentIndex: idx,
            active,
            // Two Inverters so we can apply it twice from the same user.
            playerItems: active === "PLAYER" ? ["INVERTER", "INVERTER"] : [],
            aiItems: active === "AI" ? ["INVERTER", "INVERTER"] : [],
          });

          const once = applyItem(state, "INVERTER", new SeededRng(seed ^ 0x66));
          const flipped = once.state.cylinder.chambers[idx];
          // The Current Chamber's Round is the opposite classification.
          expect(flipped).toBe(round === "LIVE" ? "BLANK" : "LIVE");

          const twice = applyItem(once.state, "INVERTER", new SeededRng(seed ^ 0x67));
          // Applying the Inverter twice restores the original classification.
          expect(twice.state.cylinder.chambers[idx]).toBe(round);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: revolver-roulette, Property 19: Hollow_Point sets the Damage_Multiplier to 2
  it("sets the user's Damage_Multiplier to 2", () => {
    fc.assert(
      fc.property(
        participantId,
        fc.constantFrom<DamageMultiplier>(1, 2),
        fc.integer(),
        (active, startMult, seed) => {
          const chambers: Chamber[] = ["LIVE", "BLANK"];
          const state = makeState(seed, {
            chambers,
            active,
            playerItems: active === "PLAYER" ? ["HOLLOW_POINT"] : [],
            aiItems: active === "AI" ? ["HOLLOW_POINT"] : [],
            playerMultiplier: active === "PLAYER" ? startMult : 1,
            aiMultiplier: active === "AI" ? startMult : 1,
          });

          const result = applyItem(state, "HOLLOW_POINT", new SeededRng(seed ^ 0x77));

          expect(result.state.participants[active].damageMultiplier).toBe(2);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Requirement 5.13: using an Item not held is a state-preserving no-op.
  it("rejects using an Item the user does not hold without changing state", () => {
    fc.assert(
      fc.property(
        itemType,
        participantId,
        fc.integer(),
        (item, active, seed) => {
          const chambers: Chamber[] = ["LIVE", "BLANK"];
          // Neither participant holds any items.
          const state = makeState(seed, {
            chambers,
            active,
            playerItems: [],
            aiItems: [],
          });

          const result = applyItem(state, item, new SeededRng(seed ^ 0x88));

          expect(result.rejected).toBe("ITEM_NOT_HELD");
          expect(result.events.length).toBe(0);
          // State is returned unchanged (same reference).
          expect(result.state).toBe(state);
        },
      ),
      { numRuns: 200 },
    );
  });
});
