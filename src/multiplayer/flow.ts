// Multiplayer game flow: search → match → coin flip → play.

import { MultiplayerClient } from "./client";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";
import type { Action, GameEvent, GameState } from "../engine/types";
import type { Renderer3D } from "../render/renderer3d";
import type { AudioSystem } from "../audio/audioSystem";
import type { CaptionView } from "../app/caption";
import { captionFor } from "../app/captions";

export interface MultiplayerFlowDeps {
  renderer: Renderer3D;
  audio: AudioSystem;
  caption: CaptionView;
  playerId: string;
  betAmount: number;
  onMatchStart: () => void;
  onMatchEnd: (youWon: boolean) => void;
}

export function startMultiplayerFlow(deps: MultiplayerFlowDeps): { cancel: () => void; submitAction: (a: Action) => void } {
  const { renderer, audio, caption, playerId, betAmount, onMatchStart, onMatchEnd } = deps;

  let cancelled = false;
  let matchStarted = false;
  let youAre: "player1" | "player2" = "player1";

  // Turn timer display.
  const timerEl = document.createElement("div");
  timerEl.style.cssText =
    "position:fixed;top:20px;right:20px;font-family:'Courier New',monospace;" +
    "font-size:28px;font-weight:700;letter-spacing:4px;color:#cc3333;" +
    "z-index:9999;pointer-events:none;opacity:0;transition:opacity 0.3s;";
  document.body.appendChild(timerEl);

  const client = new MultiplayerClient({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    playerId,

    onStateChange: (state: GameState) => {
      if (cancelled) return;
      renderer.render(state);
    },

    onEvents: (events: GameEvent[]) => {
      if (cancelled) return;
      for (const event of events) {
        renderer.playActionFeedback(event);
        const cap = captionFor(event);
        if (cap) caption.enqueue(cap.title, cap.desc);
      }
      audio.handleEvents(events);
    },

    onTimerTick: (secondsLeft: number) => {
      if (cancelled || !matchStarted) return;
      if (secondsLeft <= 10) {
        timerEl.style.opacity = "1";
        timerEl.textContent = String(secondsLeft);
        timerEl.style.color = secondsLeft <= 5 ? "#ff0000" : "#cc3333";
      } else {
        timerEl.style.opacity = "0";
      }
    },

    onMatched: async (data) => {
      if (cancelled) return;
      youAre = data.youAre;

      // Tell the renderer which participant we control.
      const myParticipant = youAre === "player1" ? "PLAYER" : "AI";
      renderer.setLocalParticipant(myParticipant as "PLAYER" | "AI");

      caption.enqueue("OPPONENT FOUND", "The table awaits.");
      await new Promise((r) => setTimeout(r, 2000));
      if (cancelled) return;

      // Coin flip: the winner (first turn) sees it as heads.
      const youFirst = data.firstTurn === data.youAre;
      await renderer.playCoinFlip(
        youFirst,
        () => audio.playCoinFlipShimmer(),
        () => audio.playCoinFlipTable(),
      );
      if (cancelled) return;

      caption.enqueue(
        youFirst ? "YOU GO FIRST" : "THEY GO FIRST",
        youFirst ? "The coin chose you." : "The coin chose them.",
      );
      await new Promise((r) => setTimeout(r, 2500));
      if (cancelled) return;

      matchStarted = true;
      onMatchStart();
    },

    onMatchOver: (winnerId: string) => {
      if (cancelled) return;
      const youWon = winnerId === playerId;
      timerEl.style.opacity = "0";
      onMatchEnd(youWon);
    },
  });

  // Join the queue.
  caption.enqueue("SEARCHING", "Looking for an opponent...");
  client.joinQueue(betAmount).catch((err) => {
    console.error("[multiplayer] queue error:", err);
    caption.enqueue("ERROR", String(err));
  });

  return {
    cancel: () => {
      cancelled = true;
      client.cancelQueue();
      client.destroy();
      if (timerEl.parentNode) timerEl.parentNode.removeChild(timerEl);
    },
    submitAction: (action: Action) => {
      if (!matchStarted || cancelled) return;
      client.submitAction(action);
    },
  };
}
