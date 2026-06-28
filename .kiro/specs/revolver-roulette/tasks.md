# Implementation Plan: Revolver Roulette (Single-Player Prototype)

## Overview

This plan implements the single-player prototype milestone as a TypeScript project built with Vite, tested with Vitest and fast-check. It follows the design's strict separation between the pure, deterministic core (Rules_Engine, AI decision function, tension-volume mapping) and the side-effecting presentation layers (PixiJS renderer, Howler.js audio).

Work proceeds in waves: project scaffolding and shared types first, then the pure `Rules_Engine` built up function-by-function with its property-based tests, then the AI decision function and the `Game_Controller` state machine, then the renderer and audio systems with their smoke/integration tests, and finally end-to-end wiring and integration tests.

Property-based tests (fast-check, `numRuns >= 100`, seeded RNG) cover the 26 correctness properties for the pure layers. Each PBT sub-task names the property it validates and is tagged in code as `// Feature: revolver-roulette, Property N: ...`. Presentation behavior is covered by example, integration, and smoke tests per the Testing Strategy.

## Tasks

- [x] 1. Scaffold project and define shared data models
  - [x] 1.1 Set up the TypeScript project and tooling
    - Initialize a Vite + TypeScript project with `strict` mode enabled
    - Add and configure Vitest and fast-check as dev dependencies
    - Add PixiJS and Howler.js as runtime dependencies
    - Create the source layout: `src/engine/`, `src/ai/`, `src/controller/`, `src/render/`, `src/audio/`, `src/rng/`, and a parallel `tests/` (or co-located `*.test.ts`) structure
    - Add npm scripts for `dev`, `build`, and `test` (using `vitest --run` for single-execution test runs)
    - _Requirements: 8.1_

  - [x] 1.2 Define core data models and types
    - Implement `RoundType`, `Chamber`, `Cylinder`, `ParticipantId`, `Participant`, `ItemType`, `GameConfig`, `Phase`, and `GameState` as immutable TypeScript types/interfaces
    - Implement the `Action`, `GameEvent`, `EngineResult`, and `RejectionReason` types
    - Implement the `PlayerView` interface
    - _Requirements: 1.1, 1.6, 2.1, 5.1, 5.9_

  - [x] 1.3 Implement the injectable seedable PRNG
    - Define the `RNG` interface (`next()`, `nextInt(n)`)
    - Implement a deterministic seedable PRNG (e.g., a small LCG/xorshift) used by the engine and a `seededRng()` helper for tests
    - Ensure the engine never calls `Math.random` directly; randomness flows only through the injected `RNG`
    - _Requirements: 1.2, 4.2_

  - [x]* 1.4 Write unit tests for the seedable PRNG
    - Verify the same seed reproduces the same sequence and that `nextInt(n)` stays within `[0, n)`
    - _Requirements: 1.2, 4.2_

- [x] 2. Implement Cylinder loading and shuffling
  - [x] 2.1 Implement `loadCylinder`, `shuffleRemaining`, and `remainingCounts`
    - `loadCylinder(liveCount, blankCount, rng)` builds a uniformly shuffled valid cylinder (size 2–6, ≥1 live, ≥1 blank, one round per chamber)
    - `shuffleRemaining(cylinder, rng)` uniformly permutes remaining rounds, preserves live/blank multiset, and sets the Current Chamber to the first remaining round
    - `remainingCounts(cylinder)` derives visible live/blank counts from unfired chambers
    - Reject invalid compositions without creating partial state and reselect a valid composition
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 4.2_

  - [x]* 2.2 Write property test for valid Round_Set loading
    - **Property 1: Loading always produces a valid Round_Set**
    - **Validates: Requirements 1.1, 1.3, 1.4, 1.7, 5.5, 7.1, 7.3**

  - [x]* 2.3 Write property test for shuffle composition and uniformity
    - **Property 2: Shuffle preserves composition and is uniform**
    - **Validates: Requirements 1.2, 4.2**

- [x] 3. Implement Match and Round_Set lifecycle
  - [x] 3.1 Implement `createMatch`, `loadRoundSet`, `isMatchOver`, and `winnerOf`
    - `createMatch(config, rng)` initializes both Participants' HP to the starting value, loads the first Round_Set, grants starting items (capped at 4), assigns the first Turn to the Player, and emits `ROUND_SET_LOADED`
    - `loadRoundSet(state, rng)` reloads the cylinder as a new Round_Set, retains current HP, and declares no winner
    - `isMatchOver`/`winnerOf` report match end and the winning Participant
    - _Requirements: 1.7, 2.1, 5.1, 7.1, 7.2, 7.3_

  - [x]* 3.2 Write property test for item-grant inventory cap
    - **Property 13: Item grant respects the inventory cap**
    - **Validates: Requirements 5.1**

- [x] 4. Implement PlayerView projection
  - [x] 4.1 Implement `toPlayerView(state, participant)`
    - Project visible live/blank/total remaining counts and both Participants' HP and items
    - Expose `knownCurrentChamber` only when that Participant revealed it and no Shot/Spin has occurred since; never expose hidden chamber order
    - _Requirements: 1.4, 1.5, 1.6, 2.6, 5.4, 5.11_

  - [x]* 4.2 Write property test for PlayerView accuracy and hidden order
    - **Property 3: PlayerView exposes accurate counts but never the hidden order**
    - **Validates: Requirements 1.5, 1.6**

- [x] 5. Implement Shot Action resolution
  - [x] 5.1 Implement `fire` and shot turn-transition logic
    - Fire the Current Chamber at the target, apply Live damage `min(currentHp, 1 * firerMultiplier)`, clamp HP at zero, leave HP unchanged on Blank
    - Reset the firer's Damage_Multiplier to 1 after a multiplied Live shot; do not consume the multiplier on a Blank
    - Empty the fired chamber and advance the Current Chamber to the next loaded chamber
    - Apply turn-passing rules (self-blank keeps turn; self-live and any opponent shot pass turn), end the Match on zero HP, and trigger reload when the cylinder is empty
    - Reject a Shot Action on an empty cylinder without firing and trigger a reload
    - Emit `SHOT_STARTED`, `LIVE_FIRED`/`BLANK_FIRED`, `HP_CHANGED`, `TURN_PASSED`, and `MATCH_OVER` events as appropriate
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 5.10, 7.3, 7.4_

  - [x]* 5.2 Write property test for damage resolution
    - **Property 4: Damage resolution is correct**
    - **Validates: Requirements 2.2, 2.3, 2.4, 3.2, 5.10**

  - [x]* 5.3 Write property test for match-end on zero HP
    - **Property 5: Reaching zero HP ends the Match with the correct winner**
    - **Validates: Requirements 2.5**

  - [x]* 5.4 Write property test for Current Chamber advancement
    - **Property 6: Firing advances the Current Chamber**
    - **Validates: Requirements 3.3**

  - [x]* 5.5 Write property test for shot turn-transition rules
    - **Property 7: Shot turn-transition rules hold**
    - **Validates: Requirements 3.4, 3.5, 3.6**

  - [x]* 5.6 Write property test for empty-cylinder shot reload
    - **Property 8: Shooting an empty cylinder triggers reload without firing**
    - **Validates: Requirements 3.7**

- [x] 6. Implement Spin Action and illegal-action handling
  - [x] 6.1 Implement Spin resolution and spin-limit enforcement
    - Allow a Spin only on the active Participant's turn when ≥2 rounds remain and the per-turn spin limit is not reached
    - Re-shuffle remaining rounds, set the Current Chamber to the first new round, invalidate all revealed knowledge, retain the turn, and increment `spinsUsedThisTurn`
    - Reject out-of-limit / too-few-rounds spins as state-preserving no-ops; reset `spinsUsedThisTurn` when the active Participant changes
    - Emit the `SPUN` event on success
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x]* 6.2 Write property test for spin invalidating revealed knowledge
    - **Property 10: Spin invalidates revealed knowledge**
    - **Validates: Requirements 4.3**

  - [x]* 6.3 Write property test for per-turn spin limit
    - **Property 11: Spin limit per Turn is enforced**
    - **Validates: Requirements 4.5**

  - [x]* 6.4 Write property test for illegal-action no-ops
    - **Property 9: Illegal actions are state-preserving no-ops**
    - **Validates: Requirements 3.8, 4.6, 5.13**

- [x] 7. Implement Items system
  - [x] 7.1 Implement `applyItem` for all six Item types
    - Remove the used Item from the user's inventory and retain the turn
    - Magnifying_Glass reveals the Current Chamber to the user only; Speed_Loader reloads a new Round_Set; Medkit heals `min(hp + 1, startingHp)`; Handcuffs sets `skipNextTurnOf` for the opponent; Inverter flips the Current Chamber's classification; Hollow_Point sets the user's Damage_Multiplier to 2
    - Reject use of an Item not held as a state-preserving no-op
    - Emit `ITEM_USED` (and `TURN_SKIPPED` when a handcuffed turn is consumed) events
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.12, 5.13_

  - [x]* 7.2 Write property test for non-shot actions retaining the turn
    - **Property 12: Non-shot actions retain the Turn**
    - **Validates: Requirements 4.4, 5.12**

  - [x]* 7.3 Write property test for item removal on use
    - **Property 14: Using an Item removes exactly that Item**
    - **Validates: Requirements 5.3**

  - [x]* 7.4 Write property test for Magnifying_Glass reveal scope
    - **Property 15: Magnifying_Glass reveals only to the user**
    - **Validates: Requirements 5.4**

  - [x]* 7.5 Write property test for Medkit healing cap
    - **Property 16: Medkit heals up to the cap**
    - **Validates: Requirements 5.6**

  - [x]* 7.6 Write property test for Handcuffs single-turn skip
    - **Property 17: Handcuffs skips exactly one opponent Turn**
    - **Validates: Requirements 5.7**

  - [x]* 7.7 Write property test for Inverter flip involution
    - **Property 18: Inverter flips the Current Chamber and is an involution**
    - **Validates: Requirements 5.8**

  - [x]* 7.8 Write property test for Hollow_Point multiplier
    - **Property 19: Hollow_Point sets the Damage_Multiplier to 2**
    - **Validates: Requirements 5.9**

- [x] 8. Wire the engine reducer and new-match reset
  - [x] 8.1 Implement the `reduce` dispatcher and `START_NEW_MATCH`
    - Dispatch `SHOOT`, `SPIN`, `USE_ITEM`, and `START_NEW_MATCH` actions to their handlers, returning a typed `EngineResult` (never throwing on gameplay input)
    - Implement `START_NEW_MATCH` to reset HP, inventories, Damage_Multipliers, the cylinder, and turn assignment to initial values
    - Enforce invariants (HP ≥ 0, inventory ≤ 4, spins ≤ max, one round per loaded chamber) at transition time
    - _Requirements: 3.1, 5.2, 7.5, 7.6, 2.1, 7.2_

  - [x]* 8.2 Write property test for new-match reset
    - **Property 25: Starting a new Match resets all state to initial values**
    - **Validates: Requirements 7.6, 2.1, 7.2**

  - [x]* 8.3 Write example/unit tests for representative engine scenarios
    - Player targets self or opponent on their turn; multiple sequential item uses in one turn; size-2 (1 live/1 blank) cylinder; healing at the HP cap; double-Inverter identity; Handcuffs then kept-turn self-blank then turn pass
    - _Requirements: 3.1, 5.2_

- [x] 9. Checkpoint - Ensure all engine tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement the AI decision function
  - [x] 10.1 Implement the pure `decide(view)` function
    - Apply the decision order: all-blank → SHOOT(PLAYER); all-live → SHOOT(PLAYER); known-blank with live remaining → SHOOT(AI); otherwise default SHOOT(PLAYER)
    - Operate only over `PlayerView`, never inspecting hidden state, and return exactly one legal `Action`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x]* 10.2 Write property test for AI legality
    - **Property 20: The AI always returns a single legal action**
    - **Validates: Requirements 6.1, 6.2**

  - [x]* 10.3 Write property test for AI shooting Player on all-blank
    - **Property 21: AI shoots the Player when all remaining Rounds are Blank**
    - **Validates: Requirements 6.3**

  - [x]* 10.4 Write property test for AI shooting Player on all-live
    - **Property 22: AI shoots the Player when all remaining Rounds are Live**
    - **Validates: Requirements 6.4**

  - [x]* 10.5 Write property test for AI self-shot on known blank
    - **Property 23: AI shoots itself on a known Blank when Live Rounds remain**
    - **Validates: Requirements 6.5**

  - [x]* 10.6 Write property test for AI default target
    - **Property 24: AI defaults to shooting the Player**
    - **Validates: Requirements 6.6**

- [x] 11. Implement the Game_Controller state machine
  - [x] 11.1 Implement the controller and turn/phase scheduling
    - Hold the current `GameState`, expose `start`, `submitPlayerAction`, `onStateChange`, `onEvents`, and `dispose`
    - Drive the phase state machine (MATCH_INTRO → PLAYER_TURN/AI_THINKING → RESOLVING → reload/over), ignoring player input when it is not the Player's turn
    - On AI turns, request `decide(view)`, validate via `reduce` (falling back to `SHOOT(PLAYER)` on rejection), and dispatch after a bounded delay never exceeding 3s
    - Push new state to state-change observers and emitted events to event observers
    - _Requirements: 3.8, 6.1, 6.2, 6.7, 7.2_

  - [x]* 11.2 Write integration test for AI think-time bound
    - Assert the AI action is dispatched within the bounded delay (≤ 3s) using fake timers
    - _Requirements: 6.7_

- [x] 12. Implement the tension-volume mapping
  - [x] 12.1 Implement the pure `tensionVolume(roundsRemaining, roundsTotal)` mapping
    - Compute a non-decreasing volume as remaining rounds decrease, clamped to `[0, 1]`, equal to maximum when exactly 1 round remains
    - _Requirements: 9.7_

  - [x]* 12.2 Write property test for tension-volume monotonicity
    - **Property 26: Tension volume rises monotonically and peaks at one Round remaining**
    - **Validates: Requirements 9.7**

- [x] 13. Implement the Audio_System
  - [x] 13.1 Implement the Howler-based audio system
    - Implement `init`, `startAmbient` (looping drone), `handleEvents` (map `GameEvent`s to one-shot SFX), `setTension` (using `tensionVolume`), and `stopAll`
    - Map `SPUN`→spin clicks, `SHOT_STARTED`→hammer cock, `LIVE_FIRED`→gunshot (louder than blank), `BLANK_FIRED`→dry click, and UI interactions→UI blip
    - Attach per-`Howl` load/play error handlers that suppress a failed sound without interrupting gameplay
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

  - [x]* 13.2 Write integration tests for audio event mapping
    - With a mocked Howler, assert each `GameEvent` triggers the expected sound, gunshot volume exceeds dry-click volume, decreasing rounds raise tension volume monotonically, and a forced load/play error is swallowed
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

  - [x]* 13.3 Write smoke test for ambient audio configuration
    - Assert the ambient `Howl` is configured with `loop: true` and starts at Match begin
    - _Requirements: 9.1_

- [x] 14. Implement the Renderer
  - [x] 14.1 Implement the PixiJS renderer and post-processing filter chain
    - Implement `init` (returning an error result on context failure), `render`, `playActionFeedback`, `start`, `stop`, and `showRenderUnavailable`
    - Build the scene graph (background, participants, revolver/cylinder, HP and item HUD, round-count indicators) and run the ≥30 FPS ticker loop
    - Implement the GLSL filter chain (film grain, scanlines, vignette, chromatic aberration) plus a dim-flicker brightness filter with brightness ≤ 0.5 and flicker period within 100–1000 ms
    - Trigger action-feedback tweens (muzzle flash, recoil, HUD pulse) whose first visible frame lands within 200 ms
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 2.6, 5.11_

  - [x]* 14.2 Write smoke test for render loop and filter chain
    - Start the renderer against a test canvas; assert it initializes, sustains ≥30 FPS over a short sample, the filter chain contains film grain + scanlines + vignette + chromatic aberration, the brightness uniform is ≤ 0.5, and the flicker period is within 100–1000 ms
    - _Requirements: 8.1, 8.2, 8.3_

  - [x]* 14.3 Write integration test for renderer wiring and init failure
    - Assert an action event produces a visible tween promptly; simulate a failed context init and assert the loop stops, the overlay shows, and `GameState` is unchanged
    - _Requirements: 8.4, 8.5_

- [x] 15. Integration and final wiring
  - [x] 15.1 Wire UI input, controller, renderer, and audio into the app entry point
    - Create the app entry that constructs the controller with a seeded/real RNG, initializes the renderer and audio, subscribes the renderer to state changes and the audio system to events, and routes UI controls (shoot self/opponent, spin, use item, start new match) into `submitPlayerAction`
    - Display HP, items, round counts, the winner identity, and a "new match" control; emit UI-blip sounds on control interaction
    - _Requirements: 2.6, 5.11, 7.4, 7.5, 7.6, 9.6_

  - [x]* 15.2 Write integration test for a full Match loop
    - Drive a scripted human-vs-AI Match through the controller to a winner using a seeded RNG, asserting state transitions, reloads on empty cylinders, and match-over/new-match behavior
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 16. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP, but they encode the design's correctness guarantees and are recommended.
- Each task references specific requirements for traceability; property sub-tasks additionally name the design property they validate and must be tagged in code as `// Feature: revolver-roulette, Property N: ...`.
- All property-based tests use fast-check with a seeded `RNG` and run a minimum of 100 iterations (`numRuns >= 100`).
- The pure layers (Rules_Engine, AI `decide`, tension-volume mapping) are property-tested; presentation (renderer, audio) is covered by smoke and integration tests per the Testing Strategy.
- Checkpoints ensure incremental validation at the end of the engine work and at final wiring.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4", "2.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "3.1", "4.1"] },
    { "id": 4, "tasks": ["3.2", "4.2", "5.1", "12.1"] },
    { "id": 5, "tasks": ["5.2", "5.3", "5.4", "5.5", "5.6", "6.1", "12.2"] },
    { "id": 6, "tasks": ["6.2", "6.3", "6.4", "7.1"] },
    { "id": 7, "tasks": ["7.2", "7.3", "7.4", "7.5", "7.6", "7.7", "7.8", "8.1"] },
    { "id": 8, "tasks": ["8.2", "8.3", "10.1", "13.1", "14.1"] },
    { "id": 9, "tasks": ["10.2", "10.3", "10.4", "10.5", "10.6", "11.1", "13.2", "13.3", "14.2", "14.3"] },
    { "id": 10, "tasks": ["11.2", "15.1"] },
    { "id": 11, "tasks": ["15.2"] }
  ]
}
```
