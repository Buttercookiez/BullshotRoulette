import { describe, it, expect } from "vitest";
import { GameController } from "../../src/controller/gameController";
import { DEFAULT_CONFIG } from "../../src/engine/lifecycle";
import { SeededRng } from "../../src/rng/rng";
import type { GameEvent, GameState } from "../../src/engine/types";

// Integration test: drive a complete scripted human-vs-AI Match THROUGH THE
// CONTROLLER (never through main.ts/DOM) to completion, then start a fresh
// Match. Determinism comes from a seeded RNG plus an injected synchronous
// scheduler: the controller's `setTimeoutFn` runs the handler immediately, so
// every AI turn resolves inline with no real timers and no flakiness.
//
// This is an integration test (no property tag).
//
// _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

/**
 * A `setTimeout`-shaped function that invokes the handler synchronously and
 * returns a dummy handle. This collapses the controller's bounded AI think-time
 * delay to zero so AI turns run inline and deterministically under the test.
 */
function makeSynchronousScheduler() {
  let nextId = 1;
  const setTimeoutFn = (handler: () => void): ReturnType<typeof setTimeout> => {
    handler();
    return nextId++ as unknown as ReturnType<typeof setTimeout>;
  };
  const clearTimeoutFn = (): void => {
    // No-op: handlers have already run synchronously.
  };
  return { setTimeoutFn, clearTimeoutFn };
}

/** Build a controller wired with a seeded RNG and the synchronous scheduler. */
function makeController(seed: number): {
  controller: GameController;
  events: GameEvent[];
  states: GameState[];
} {
  const { setTimeoutFn, clearTimeoutFn } = makeSynchronousScheduler();
  const controller = new GameController({
    rng: new SeededRng(seed),
    aiDelayMs: 0,
    setTimeoutFn,
    clearTimeoutFn,
  });

  const events: GameEvent[] = [];
  const states: GameState[] = [];
  controller.onEvents((batch) => events.push(...batch));
  controller.onStateChange((s) => states.push(s));

  return { controller, events, states };
}

describe("full human-vs-AI Match (integration)", () => {
  it("reaches MATCH_OVER with a winner, reloads round-sets, and supports a new match", () => {
    const { controller, events } = makeController(0xc0ffee);

    controller.start(DEFAULT_CONFIG); // Req 7.1, 7.2: Player starts, full HP.

    const initial = controller.getState();
    expect(initial.activeParticipant).toBe("PLAYER");
    expect(initial.phase).toBe("PLAYER_TURN");
    expect(initial.participants.PLAYER.hp).toBe(DEFAULT_CONFIG.startingHp);
    expect(initial.participants.AI.hp).toBe(DEFAULT_CONFIG.startingHp);

    // Scripted player strategy: whenever it is the Player's turn, shoot the
    // Dealer. Each such shot passes the turn to the AI, whose turn runs inline
    // (synchronous scheduler). The match therefore advances every iteration.
    // A generous guard prevents an infinite loop if something regresses.
    let guard = 0;
    while (controller.getState().winner === null && guard < 1000) {
      guard++;
      if (controller.getState().activeParticipant === "PLAYER") {
        controller.submitPlayerAction({ kind: "SHOOT", target: "AI" });
      } else {
        // It is the AI's turn but it has not been scheduled to act (can happen
        // if a player self-shot kept the turn with the AI via reload edge
        // cases). Nudge with a no-op-safe player action that is ignored when it
        // is not the Player's turn; in practice the synchronous scheduler means
        // we never land here, but the guard keeps the loop honest.
        break;
      }
    }

    const finished = controller.getState();
    expect(finished.winner).not.toBeNull();
    expect(finished.phase).toBe("MATCH_OVER");
    expect(["PLAYER", "AI"]).toContain(finished.winner);

    // Req 2.5 / 7.4: the loser is at zero HP, the winner is still standing.
    const winnerHp = finished.participants[finished.winner!].hp;
    const loser = finished.winner === "PLAYER" ? "AI" : "PLAYER";
    expect(winnerHp).toBeGreaterThan(0);
    expect(finished.participants[loser].hp).toBe(0);

    // Req 7.3: the cylinder empties multiple times across a full match, each
    // emptying beginning a new Round_Set. We observe more than the single
    // initial ROUND_SET_LOADED (the one emitted by createMatch).
    const reloads = events.filter((e) => e.type === "ROUND_SET_LOADED");
    expect(reloads.length).toBeGreaterThanOrEqual(2);

    // A winner was declared exactly once (Req 2.5).
    const matchOverEvents = events.filter((e) => e.type === "MATCH_OVER");
    expect(matchOverEvents.length).toBe(1);

    // Req 7.5, 7.6: after MATCH_OVER, START_NEW_MATCH resets to a fresh match —
    // Player's turn, both at full HP, no winner, fresh cylinder.
    controller.submitPlayerAction({ kind: "START_NEW_MATCH" });
    const fresh = controller.getState();
    expect(fresh.activeParticipant).toBe("PLAYER");
    expect(fresh.phase).toBe("PLAYER_TURN");
    expect(fresh.winner).toBeNull();
    expect(fresh.participants.PLAYER.hp).toBe(DEFAULT_CONFIG.startingHp);
    expect(fresh.participants.AI.hp).toBe(DEFAULT_CONFIG.startingHp);
    expect(fresh.participants.PLAYER.damageMultiplier).toBe(1);
    expect(fresh.participants.AI.damageMultiplier).toBe(1);
    expect(fresh.roundSetIndex).toBe(0);

    controller.dispose();
  });

  it("is deterministic for a given seed (same winner across runs)", () => {
    const run = (): GameState => {
      const { controller } = makeController(12345);
      controller.start(DEFAULT_CONFIG);
      let guard = 0;
      while (
        controller.getState().winner === null &&
        controller.getState().activeParticipant === "PLAYER" &&
        guard < 1000
      ) {
        guard++;
        controller.submitPlayerAction({ kind: "SHOOT", target: "AI" });
      }
      const state = controller.getState();
      controller.dispose();
      return state;
    };

    const a = run();
    const b = run();
    expect(a.winner).not.toBeNull();
    expect(a.winner).toBe(b.winner);
    expect(a.participants.PLAYER.hp).toBe(b.participants.PLAYER.hp);
    expect(a.participants.AI.hp).toBe(b.participants.AI.hp);
  });
});
