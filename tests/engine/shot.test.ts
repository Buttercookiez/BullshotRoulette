import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { fire } from "../../src/engine/shot";
import { createMatch, DEFAULT_CONFIG } from "../../src/engine/lifecycle";
import { remainingCounts } from "../../src/engine/cylinder";
import type {
  Chamber,
  DamageMultiplier,
  GameState,
  ParticipantId,
  RoundType,
} from "../../src/engine/types";
import { SeededRng } from "../../src/rng/rng";

// ---------------------------------------------------------------------------
// Test helpers: build a GameState with a known Cylinder so a specific Round
// sits at the Current Chamber and HP / multipliers are deterministic.
// ---------------------------------------------------------------------------

/** A fresh, fully-loaded base state from createMatch (Player to act). */
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
  playerMultiplier?: DamageMultiplier;
  aiMultiplier?: DamageMultiplier;
  skipNextTurnOf?: ParticipantId | null;
  spinsUsedThisTurn?: number;
}

/** Build a GameState with a specific Cylinder and participant attributes. */
function makeState(seed: number, o: Overrides): GameState {
  const s = baseState(seed);
  const currentIndex = o.currentIndex ?? 0;
  return {
    ...s,
    cylinder: { chambers: o.chambers.slice(), currentIndex, size: o.chambers.length },
    activeParticipant: o.active ?? "PLAYER",
    spinsUsedThisTurn: o.spinsUsedThisTurn ?? 0,
    skipNextTurnOf: o.skipNextTurnOf ?? null,
    participants: {
      PLAYER: {
        ...s.participants.PLAYER,
        hp: o.playerHp ?? s.participants.PLAYER.hp,
        damageMultiplier: o.playerMultiplier ?? 1,
      },
      AI: {
        ...s.participants.AI,
        hp: o.aiHp ?? s.participants.AI.hp,
        damageMultiplier: o.aiMultiplier ?? 1,
      },
    },
  };
}

const roundType = fc.constantFrom<RoundType>("LIVE", "BLANK");
const participantId = fc.constantFrom<ParticipantId>("PLAYER", "AI");
const multiplier = fc.constantFrom<DamageMultiplier>(1, 2);

describe("fire — Shot Action resolution", () => {
  // Feature: revolver-roulette, Property 4: Damage resolution is correct
  it("applies Live damage min(hp, multiplier) clamped at zero, leaves Blank harmless, and consumes only multiplied Live shots", () => {
    fc.assert(
      fc.property(
        roundType,
        participantId, // active / firer
        fc.boolean(), // shoot self?
        multiplier, // firer multiplier
        fc.integer({ min: 1, max: DEFAULT_CONFIG.startingHp }), // target hp
        fc.integer(),
        (round, firer, shootSelf, mult, targetHp, seed) => {
          const target = shootSelf ? firer : opponentOf(firer);

          // Two loaded Rounds so firing one never empties the Cylinder (keeps
          // the damage logic isolated from reloads). The chosen Round sits at
          // the Current Chamber; a Blank backs it up.
          const chambers: Chamber[] = [round, "BLANK"];

          const state = makeState(seed, {
            chambers,
            active: firer,
            playerHp: firer === "PLAYER" ? undefined : DEFAULT_CONFIG.startingHp,
            aiHp: firer === "AI" ? undefined : DEFAULT_CONFIG.startingHp,
            // Set the firer's multiplier; place target hp on the target.
            playerMultiplier: firer === "PLAYER" ? mult : 1,
            aiMultiplier: firer === "AI" ? mult : 1,
          });

          // Override the target's HP precisely.
          const withHp: GameState = {
            ...state,
            participants: {
              ...state.participants,
              [target]: { ...state.participants[target], hp: targetHp },
            },
          };

          const before = withHp.participants[target].hp;
          const otherId = opponentOf(target);
          const otherBefore = withHp.participants[otherId].hp;

          const result = fire(withHp, target, new SeededRng(seed ^ 0x55));
          const after = result.state.participants[target].hp;
          const firerMultAfter = result.state.participants[firer].damageMultiplier;

          if (round === "LIVE") {
            const expectedDamage = Math.min(before, mult);
            expect(after).toBe(before - expectedDamage);
            expect(after).toBeGreaterThanOrEqual(0);
            // The firer's multiplier is always 1 after a Live shot (reset when
            // it was >1; already 1 otherwise).
            expect(firerMultAfter).toBe(1);
          } else {
            // Blank: target HP unchanged, and the firer keeps its multiplier.
            expect(after).toBe(before);
            expect(firerMultAfter).toBe(mult);
          }

          // The non-target participant's HP is never touched by the shot
          // (unless self-shot, in which case otherId is the firer's opponent).
          if (otherId !== target) {
            expect(result.state.participants[otherId].hp).toBe(otherBefore);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  // Feature: revolver-roulette, Property 5: Reaching zero HP ends the Match with the correct winner
  it("ends the Match and declares the surviving Participant the winner when the target reaches zero HP", () => {
    fc.assert(
      fc.property(
        participantId, // firer
        fc.boolean(), // shoot self?
        multiplier,
        fc.integer(),
        (firer, shootSelf, mult, seed) => {
          const target = shootSelf ? firer : opponentOf(firer);
          // Target HP at or below the damage so a Live shot is lethal.
          const targetHp = mult; // min(hp, mult) === hp -> 0

          const chambers: Chamber[] = ["LIVE", "BLANK"];
          const state = makeState(seed, {
            chambers,
            active: firer,
            playerMultiplier: firer === "PLAYER" ? mult : 1,
            aiMultiplier: firer === "AI" ? mult : 1,
          });
          const withHp: GameState = {
            ...state,
            participants: {
              ...state.participants,
              [target]: { ...state.participants[target], hp: targetHp },
            },
          };

          const result = fire(withHp, target, new SeededRng(seed ^ 0x99));

          expect(result.state.participants[target].hp).toBe(0);
          expect(result.state.phase).toBe("MATCH_OVER");
          // The winner is the Participant still standing (the other one).
          expect(result.state.winner).toBe(opponentOf(target));
          expect(result.events.some((e) => e.type === "MATCH_OVER")).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: revolver-roulette, Property 6: Firing advances the Current Chamber
  it("empties the fired Chamber and advances the Current Chamber to the next loaded Chamber", () => {
    fc.assert(
      fc.property(
        // At least 2 loaded Rounds so firing one never empties the Cylinder
        // (which would replace it via reload).
        fc.integer({ min: 2, max: 6 }),
        participantId,
        fc.boolean(),
        fc.integer(),
        (loaded, firer, shootSelf, seed) => {
          const target = shootSelf ? firer : opponentOf(firer);
          // All Blanks => no HP change, no match end, no reload interference.
          const chambers: Chamber[] = new Array<Chamber>(loaded).fill("BLANK");

          const state = makeState(seed, { chambers, active: firer });
          const oldIndex = state.cylinder.currentIndex;

          const result = fire(state, target, new SeededRng(seed ^ 0x1234));
          const cyl = result.state.cylinder;

          // The just-fired Chamber is emptied.
          expect(cyl.chambers[oldIndex]).toBe(null);

          // The Current Chamber advanced to the next loaded Chamber in order.
          let expected = oldIndex + 1;
          while (
            expected < cyl.chambers.length &&
            (cyl.chambers[expected] === null || cyl.chambers[expected] === undefined)
          ) {
            expected++;
          }
          expect(cyl.currentIndex).toBe(expected);
          // With >= 2 loaded Rounds there is still a loaded Chamber.
          expect(cyl.chambers[cyl.currentIndex]).toBe("BLANK");
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: revolver-roulette, Property 7: Shot turn-transition rules hold
  it("retains the Turn on a self-blank and passes it on a self-live or any opponent shot (non-match-ending)", () => {
    fc.assert(
      fc.property(
        roundType,
        participantId, // firer
        fc.boolean(), // shoot self?
        fc.integer(),
        (round, firer, shootSelf, seed) => {
          const target = shootSelf ? firer : opponentOf(firer);

          // Full HP and damage of at most 1 (multiplier 1) so the shot never
          // ends the Match (startingHp default 4 > 1). Two loaded Rounds so no
          // reload occurs. No pending Handcuffs skip.
          const chambers: Chamber[] = [round, "BLANK"];
          const state = makeState(seed, {
            chambers,
            active: firer,
            playerHp: DEFAULT_CONFIG.startingHp,
            aiHp: DEFAULT_CONFIG.startingHp,
            skipNextTurnOf: null,
          });

          const result = fire(state, target, new SeededRng(seed ^ 0x7));
          const active = result.state.activeParticipant;

          // Sanity: this case does not end the Match.
          expect(result.state.phase).not.toBe("MATCH_OVER");

          if (shootSelf && round === "BLANK") {
            // Self-blank retains the Turn (Req 3.4).
            expect(active).toBe(firer);
            expect(result.events.some((e) => e.type === "TURN_PASSED")).toBe(false);
          } else {
            // Self-live (Req 3.5) or any opponent shot (Req 3.6) passes the Turn.
            expect(active).toBe(opponentOf(firer));
            expect(
              result.events.some(
                (e) => e.type === "TURN_PASSED" && e.to === opponentOf(firer),
              ),
            ).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: revolver-roulette, Property 8: Shooting an empty cylinder triggers reload without firing
  it("rejects a Shot Action on an empty Cylinder without firing and reloads a valid new Round_Set", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }), // number of (empty) chambers
        participantId,
        fc.boolean(),
        fc.integer(),
        (slots, firer, shootSelf, seed) => {
          const target = shootSelf ? firer : opponentOf(firer);
          // An entirely empty Cylinder: no loaded Round at the Current Chamber.
          const chambers: Chamber[] = new Array<Chamber>(slots).fill(null);

          const state = makeState(seed, { chambers, active: firer });
          const playerHpBefore = state.participants.PLAYER.hp;
          const aiHpBefore = state.participants.AI.hp;

          const result = fire(state, target, new SeededRng(seed ^ 0xabcd));

          // Rejected without firing.
          expect(result.rejected).toBe("EMPTY_CYLINDER");
          expect(result.events.some((e) => e.type === "LIVE_FIRED")).toBe(false);
          expect(result.events.some((e) => e.type === "BLANK_FIRED")).toBe(false);
          expect(result.events.some((e) => e.type === "SHOT_STARTED")).toBe(false);

          // HP is unchanged (no Round was fired).
          expect(result.state.participants.PLAYER.hp).toBe(playerHpBefore);
          expect(result.state.participants.AI.hp).toBe(aiHpBefore);

          // A valid new Round_Set was loaded.
          expect(result.events.some((e) => e.type === "ROUND_SET_LOADED")).toBe(true);
          const cyl = result.state.cylinder;
          expect(cyl.size).toBeGreaterThanOrEqual(2);
          expect(cyl.size).toBeLessThanOrEqual(6);
          const counts = remainingCounts(cyl);
          expect(counts.live).toBeGreaterThanOrEqual(1);
          expect(counts.blank).toBeGreaterThanOrEqual(1);
          expect(counts.live + counts.blank).toBe(cyl.size);
        },
      ),
      { numRuns: 200 },
    );
  });
});
