// Multiplayer game flow: search → match → coin flip → play.
//
// This module only orchestrates the match lifecycle. It does NOT render or play
// audio itself — the `MultiplayerGameController` it creates is wired to the
// EXACT same presentation pipeline as single-player via the `wire` callback, so
// gameplay looks and feels identical. The only difference is a second real
// player instead of the AI, each seeing their own point of view.

import { MultiplayerGameController } from "./gameController";
import type { Action } from "../engine/types";
import type { Renderer3D } from "../render/renderer3d";
import type { AudioSystem } from "../audio/audioSystem";
import type { CaptionView } from "../app/caption";

export interface MultiplayerFlowDeps {
  renderer: Renderer3D;
  audio: AudioSystem;
  caption: CaptionView;
  playerId: string;
  betAmount: number;
  /** Attach the shared renderer/audio/caption presentation to the controller. */
  wire: (controller: MultiplayerGameController) => void;
  onMatchStart: () => void;
  onMatchEnd: (youWon: boolean) => void;
}

export function startMultiplayerFlow(deps: MultiplayerFlowDeps): {
  cancel: () => void;
  submitAction: (a: Action) => void;
} {
  const { renderer, audio, caption, playerId, betAmount, wire, onMatchStart, onMatchEnd } = deps;

  let cancelled = false;
  let matchStarted = false;

  caption.enqueue("SEARCHING", "Looking for an opponent...");

  // Turn-timer readout (top-right), only visible in the final 10 seconds.
  const timerEl = document.createElement("div");
  timerEl.style.cssText =
    "position:fixed;top:20px;right:20px;font-family:'Courier New',monospace;" +
    "font-size:28px;font-weight:700;letter-spacing:4px;color:#cc3333;" +
    "z-index:9999;pointer-events:none;opacity:0;transition:opacity 0.3s;";
  document.body.appendChild(timerEl);

  // --- Chat box (bottom-left): minimalist horror styling ------------------
  const chatEl = document.createElement("div");
  chatEl.style.cssText =
    "position:fixed;bottom:20px;left:20px;width:300px;z-index:9998;display:none;" +
    "flex-direction:column;gap:6px;font-family:'Courier New',monospace;";
  const chatLog = document.createElement("div");
  chatLog.style.cssText =
    "max-height:160px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;" +
    "padding:8px;background:rgba(5,4,5,0.82);border:1px solid #1e1a18;" +
    "border-left:2px solid #4a1010;scrollbar-width:thin;";
  const chatInput = document.createElement("input");
  chatInput.type = "text";
  chatInput.maxLength = 200;
  chatInput.placeholder = "say something...";
  chatInput.setAttribute("aria-label", "Chat message");
  chatInput.style.cssText =
    "background:rgba(5,4,5,0.82);border:1px solid #1e1a18;color:#b8b0a0;" +
    "font-family:'Courier New',monospace;font-size:12px;letter-spacing:1px;" +
    "padding:8px 10px;outline:none;";
  chatInput.addEventListener("focus", () => (chatInput.style.borderColor = "#4a1010"));
  chatInput.addEventListener("blur", () => (chatInput.style.borderColor = "#1e1a18"));
  chatEl.appendChild(chatLog);
  chatEl.appendChild(chatInput);
  document.body.appendChild(chatEl);

  const pushChatLine = (who: "YOU" | "THEM", text: string): void => {
    const line = document.createElement("div");
    line.style.cssText =
      "font-size:12px;line-height:1.5;letter-spacing:0.5px;word-break:break-word;" +
      (who === "YOU" ? "color:#8a8276;" : "color:#c02020;");
    const tag = document.createElement("span");
    tag.style.cssText = "font-weight:700;margin-right:6px;opacity:0.7;";
    tag.textContent = who === "YOU" ? "YOU" : "THEM";
    line.appendChild(tag);
    line.appendChild(document.createTextNode(text));
    chatLog.appendChild(line);
    // Cap the log at 40 lines, keep scrolled to the newest.
    while (chatLog.childNodes.length > 40) chatLog.removeChild(chatLog.firstChild!);
    chatLog.scrollTop = chatLog.scrollHeight;
  };

  chatInput.addEventListener("keydown", (e) => {
    // Don't let gameplay hotkeys fire while typing.
    e.stopPropagation();
    if (e.key !== "Enter") return;
    // CJK IME-safe: Enter may just confirm composition (229 = Safari quirk).
    if (e.isComposing || e.keyCode === 229) return;
    const text = chatInput.value.trim();
    if (!text) return;
    controller.sendChat(text);
    pushChatLine("YOU", text);
    chatInput.value = "";
  });

  const controller = new MultiplayerGameController({
    playerId,

    onMatched: async ({ matchId, youAre, coinResult }) => {
      if (cancelled) return;
      (window as any).__mpMatchId = matchId;

      // Second player controls the "AI" seat: mirror camera + swap targets.
      renderer.setLocalParticipant(youAre === "player1" ? "PLAYER" : "AI");

      caption.enqueue("MATCH ACCEPTED", "Flipping coin for first turn...");
      await wait(2000);
      if (cancelled) return;

      // Server-authoritative coin: both clients animate the SAME landing face
      // (`coinResult`), and the heads/tails pick is first-come-first-serve.
      const serverYouFirst = await renderer.playCoinFlip(
        coinResult,
        () => audio.playCoinFlipShimmer(),
        () => audio.playCoinFlipTable(),
        {
          submitPick: (pick) => controller.submitCoinPick(pick).then((r) => ({
            myPick: r.myPick,
            youFirst: r.youFirst,
          })),
          pollLock: () => controller.pollCoinLock(),
        },
      );
      if (cancelled) return;
      const goesFirst = serverYouFirst;

      caption.enqueue(
        goesFirst ? "YOU GO FIRST" : "THEY GO FIRST",
        goesFirst ? "The coin chose you." : "The coin chose them.",
      );
      await wait(2500);
      if (cancelled) return;

      // Reveal the board (emits initial state + ROUND_SET_LOADED events).
      matchStarted = true;
      controller.beginMatch();
      chatEl.style.display = "flex"; // chat opens once the duel begins
      onMatchStart();
    },

    onChat: (text) => {
      if (cancelled) return;
      pushChatLine("THEM", text);
    },

    onMatchOver: (youWon) => {
      if (cancelled) return;
      timerEl.style.opacity = "0";
      onMatchEnd(youWon);
    },

    onTimerTick: (secondsLeft) => {
      if (cancelled || !matchStarted) return;
      if (secondsLeft <= 10) {
        timerEl.style.opacity = "1";
        timerEl.textContent = String(secondsLeft);
        timerEl.style.color = secondsLeft <= 5 ? "#ff0000" : "#cc3333";
      } else {
        timerEl.style.opacity = "0";
      }
    },
  });

  // Wire the shared presentation pipeline (identical to single-player).
  wire(controller);

  caption.enqueue("SEARCHING", "Looking for an opponent...");
  controller.joinQueue(betAmount).catch((err) => {
    console.error("[multiplayer] queue error:", err);
    caption.enqueue("CONNECTION LOST", "Could not reach matchmaking.");
  });

  return {
    cancel: () => {
      cancelled = true;
      controller.dispose();
      if (timerEl.parentNode) timerEl.parentNode.removeChild(timerEl);
      if (chatEl.parentNode) chatEl.parentNode.removeChild(chatEl);
    },
    submitAction: (action: Action) => {
      if (!matchStarted || cancelled) return;
      controller.submitPlayerAction(action);
    },
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
