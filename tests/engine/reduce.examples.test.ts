import { describe, it, expect } from "vitest";
import { reduce } from "../../src/engine/reduce";
import { createMatch, DEFAULT_CONFIG } from "../../src/engine/lifecycle";
import type {
  Chamber,
  GameConfig,
  GameState,
  ItemType,
  ParticipantId,
} from "../../src/engine/types";
import { SeededRng } from "../../src/rng/rng";

// ---------------------------------------------------------------------------
// Concrete-example helpers (these are NOT property tests).
//
// We build a deterministic GameState with a precisely-known Cylinder and
// participant attributes so each scenario exercises exactly one behavior.
// ---------------------------------------------------------------------------

interface Overrides {
  chambers: Chamber[];
  currentIndex?: number;
  active?: ParticipantId;
  playerHp?: number;
  aiHp?: number;
  playerItems?: ItemType[];
  aiItems?: ItemType[];
  config?: GameConfig;
  skipNextTurnOf?: ParticipantId | null;
}

function makeState(seed: number, o: Overrides): GameState {
  const config = o.config ?? DEFAULT_CONFIG;
  const s = createMatch(config, new SeededRng(seed)).state;
  return {
    ...s,
    cylinder: {
      chambers: o.chambers.slice(),
      currentIndex: o.currentIndex ?? 0,
      size: o.chambers.length,
    },
    activeParticipant: o.active ?? "PLAYER",
    skipNextTurnOf: o.skipNextTurnOf ?? null,
    participants: {
      PLAYER: {
        ...s.participants.PLAYER,
        hp: o.playerHp ?? s.participants.PLAYER.hp,
        items: o.playerItems ?? s.participants.PLAYER.items,
        damageMultiplier: 1,
        revealedCurrentChamber: null,
      },
      AI: {
        ...s.participants.AI,
        hp: o.aiHp ?? s.participants.AI.hp,
        items: o.aiItems ?? s.participants.AI.items,
        damageMultiplier: 1,
        revealedCurrentChamber: null,
      },
    },
  };
}

const RNG = () => new SeededRng(12345);

describe("reduce — representative engine scenarios (Req 3.1, 5.2)", () => {
  it("lets the Player shoot the opponent on their turn (SHOOT AI)", () => {
    // A Live round at the current chamber; shooting AI deals 1 damage.
    const state = makeState(1, {
      chambers: ["LIVE", "BLANK"],
      active: "PLAYER",
      playerHp: 4,
      aiHp: 4,
    });
    const result = reduce(state, { kind: "SHOOT", target: "AI" }, RNG());

    expect(result.rejected).toBeUndefined();
    expect(result.state.participants.AI.hp).toBe(3);
    // Shooting the opponent passes the turn (Req 3.6).
    expect(result.state.activeParticipant).toBe("AI");
  });

  it("lets the Player shoot themselves on their turn (SHOOT PLAYER)", () => {
    // A Blank at the current chamber; a self-blank keeps the turn (Req 3.4).
    const state = makeState(2, {
      chambers: ["BLANK", "LIVE"],
      active: "PLAYER",
      playerHp: 4,
      aiHp: 4,
    });
    const result = reduce(state, { kind: "SHOOT", target: "PLAYER" }, RNG());

    expect(result.rejected).toBeUndefined();
    expect(result.state.participants.PLAYER.hp).toBe(4); // blank: unchanged
    expect(result.state.activeParticipant).toBe("PLAYER"); // turn retained
  });

  it("allows multiple sequential item uses in one turn, retaining the turn (Req 5.2, 5.12)", () => {
    const state = makeState(3, {
      chambers: ["LIVE", "BLANK"],
      active: "PLAYER",
      playerHp: 2, // below cap so MEDKIT has an effect
      playerItems: ["MAGNIFYING_GLASS", "HOLLOW_POINT"],
      config: { ...DEFAULT_CONFIG, startingHp: 4 },
    });

    const rng = RNG();
    const r1 = reduce(state, { kind: "USE_ITEM", item: "MAGNIFYING_GLASS" }, rng);
    expect(r1.rejected).toBeUndefined();
    expect(r1.state.activeParticipant).toBe("PLAYER");
    // Magnifying glass revealed the current (LIVE) chamber to the Player only.
    expect(r1.state.participants.PLAYER.revealedCurrentChamber).toBe("LIVE");

    const r2 = reduce(r1.state, { kind: "USE_ITEM", item: "HOLLOW_POINT" }, rng);
    expect(r2.rejected).toBeUndefined();
    expect(r2.state.activeParticipant).toBe("PLAYER"); // turn still retained
    expect(r2.state.participants.PLAYER.damageMultiplier).toBe(2);
    // Both items consumed.
    expect(r2.state.participants.PLAYER.items).toEqual([]);
  });

  it("handles a size-2 cylinder (1 live / 1 blank): live shot then blank shot empties + reloads", () => {
    const state = makeState(4, {
      chambers: ["LIVE", "BLANK"],
      active: "PLAYER",
      playerHp: 4,
      aiHp: 4,
    });
    const rng = RNG();

    // Fire the LIVE at AI -> 1 damage, turn passes to AI.
    const r1 = reduce(state, { kind: "SHOOT", target: "AI" }, rng);
    expect(r1.state.participants.AI.hp).toBe(3);
    expect(r1.state.activeParticipant).toBe("AI");
    // One chamber left (the BLANK), now current.
    expect(r1.state.cylinder.chambers[r1.state.cylinder.currentIndex]).toBe("BLANK");

    // AI fires the remaining BLANK at the Player; that empties the cylinder and
    // triggers an automatic reload to a fresh valid Round_Set (Req 7.3).
    const r2 = reduce(r1.state, { kind: "SHOOT", target: "PLAYER" }, rng);
    expect(r2.state.participants.PLAYER.hp).toBe(4); // blank harmless
    expect(r2.events.some((e) => e.type === "ROUND_SET_LOADED")).toBe(true);
    expect(r2.state.cylinder.size).toBeGreaterThanOrEqual(2);
  });

  it("is a no-op on HP when MEDKIT is used at the HP cap (Req 5.6)", () => {
    const state = makeState(5, {
      chambers: ["LIVE", "BLANK"],
      active: "PLAYER",
      playerHp: 4, // already at startingHp cap
      playerItems: ["MEDKIT"],
      config: { ...DEFAULT_CONFIG, startingHp: 4 },
    });
    const result = reduce(state, { kind: "USE_ITEM", item: "MEDKIT" }, RNG());

    expect(result.rejected).toBeUndefined();
    expect(result.state.participants.PLAYER.hp).toBe(4); // unchanged at the cap
    expect(result.state.participants.PLAYER.items).toEqual([]); // still consumed
  });

  it("treats a double Inverter as the identity on the current chamber (Req 5.8)", () => {
    const state = makeState(6, {
      chambers: ["LIVE", "BLANK"],
      active: "PLAYER",
      playerItems: ["INVERTER", "INVERTER"],
    });
    const rng = RNG();

    const r1 = reduce(state, { kind: "USE_ITEM", item: "INVERTER" }, rng);
    expect(r1.state.cylinder.chambers[0]).toBe("BLANK"); // flipped LIVE -> BLANK

    const r2 = reduce(r1.state, { kind: "USE_ITEM", item: "INVERTER" }, rng);
    expect(r2.state.cylinder.chambers[0]).toBe("LIVE"); // flipped back -> identity
    expect(r2.state.participants.PLAYER.items).toEqual([]);
  });

  it("Handcuffs then a kept-turn self-blank then a turn pass skips the opponent exactly once (Req 5.7)", () => {
    // Player holds Handcuffs. Chambers: BLANK (self-blank keeps turn), then LIVE
    // (fired at AI to pass the turn). With AI handcuffed, the turn returns to
    // the Player exactly once.
    const state = makeState(7, {
      chambers: ["BLANK", "LIVE", "BLANK"],
      active: "PLAYER",
      playerHp: 4,
      aiHp: 4,
      playerItems: ["HANDCUFFS"],
    });
    const rng = RNG();

    // Use Handcuffs: flags the AI's next turn to be skipped; turn retained.
    const r1 = reduce(state, { kind: "USE_ITEM", item: "HANDCUFFS" }, rng);
    expect(r1.state.skipNextTurnOf).toBe("AI");
    expect(r1.state.activeParticipant).toBe("PLAYER");

    // Self-blank: keeps the turn (Req 3.4), advances current chamber to LIVE.
    const r2 = reduce(r1.state, { kind: "SHOOT", target: "PLAYER" }, rng);
    expect(r2.state.activeParticipant).toBe("PLAYER");
    expect(r2.state.cylinder.chambers[r2.state.cylinder.currentIndex]).toBe("LIVE");

    // Fire LIVE at AI: normally passes the turn to AI, but AI is handcuffed, so
    // the skip is consumed and the turn returns to the Player.
    const r3 = reduce(r2.state, { kind: "SHOOT", target: "AI" }, rng);
    expect(r3.state.participants.AI.hp).toBe(3);
    expect(r3.events.some((e) => e.type === "TURN_SKIPPED" && e.participant === "AI")).toBe(true);
    expect(r3.state.activeParticipant).toBe("PLAYER"); // turn returned to Player
    expect(r3.state.skipNextTurnOf).toBeNull(); // skip consumed exactly once
  });
});
