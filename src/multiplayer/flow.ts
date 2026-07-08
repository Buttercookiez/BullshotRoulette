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
  wire: (controller: MultiplayerGameController, localParticipant?: "PLAYER" | "AI") => void;
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
  let matchEnded = false;
  let timesUpShown = false;

  caption.enqueue("SEARCHING", "Looking for an opponent...");

  // --- Disconnect indicator (top-centre) — shown when opponent goes silent --
  const disconnectEl = document.createElement("div");
  disconnectEl.style.cssText =
    "position:fixed;top:16px;left:50%;transform:translateX(-50%);" +
    "font-family:'Courier New',monospace;font-size:11px;letter-spacing:4px;" +
    "text-transform:uppercase;color:#6a5248;z-index:9999;" +
    "opacity:0;transition:opacity 0.6s;display:flex;flex-direction:column;" +
    "align-items:center;gap:8px;";
  const disconnectText = document.createElement("span");
  disconnectText.textContent = "OPPONENT MAY HAVE DISCONNECTED";
  disconnectEl.appendChild(disconnectText);
  // Forfeit button (only visible after 45s of silence).
  const forfeitBtn = document.createElement("button");
  forfeitBtn.textContent = "FORFEIT MATCH (TAKE WIN)";
  forfeitBtn.style.cssText =
    "font-family:'Courier New',monospace;font-size:10px;letter-spacing:3px;" +
    "text-transform:uppercase;color:#6a5248;background:transparent;" +
    "border:1px solid #2a1a18;padding:6px 14px;cursor:pointer;" +
    "transition:color 0.2s,border-color 0.2s;display:none;";
  forfeitBtn.addEventListener("mouseenter", () => {
    forfeitBtn.style.color = "#cc3333";
    forfeitBtn.style.borderColor = "#6a1010";
  });
  forfeitBtn.addEventListener("mouseleave", () => {
    forfeitBtn.style.color = "#6a5248";
    forfeitBtn.style.borderColor = "#2a1a18";
  });
  forfeitBtn.addEventListener("click", () => {
    // Claim the win by flagging the match as abandoned — reuse the existing
    // abandon-match edge function which marks the other side as the winner.
    const matchId = (window as any).__mpMatchId;
    if (matchId) {
      // Call submit-action with a special forfeit flag — for now we use
      // the client's `cancel` path which marks the other player as winner
      // via the existing abandon-match flow then shows the WIN screen.
      cleanup();
      caption.enqueue("OPPONENT FORFEITED", "They abandoned the match. You win.");
      setTimeout(() => { showResult(true); }, 1800);
    }
  });
  disconnectEl.appendChild(forfeitBtn);
  document.body.appendChild(disconnectEl);

  // --- AFK warning: shown to the ACTIVE player when their timer is near 0 --
  const afkWarnEl = document.createElement("div");
  afkWarnEl.style.cssText =
    "position:fixed;top:56px;left:50%;transform:translateX(-50%);" +
    "font-family:'Courier New',monospace;font-size:12px;letter-spacing:5px;" +
    "text-transform:uppercase;color:#cc2020;z-index:9999;pointer-events:none;" +
    "opacity:0;transition:opacity 0.3s;text-align:center;";
  afkWarnEl.textContent = "TAKE YOUR SHOT OR LOSE YOUR TURN";
  document.body.appendChild(afkWarnEl);

  // --- Post-match overlay: WIN / LOSE result + back-to-menu button ---------
  const resultEl = document.createElement("div");
  resultEl.style.cssText =
    "position:fixed;inset:0;display:none;flex-direction:column;align-items:center;" +
    "justify-content:center;gap:28px;z-index:10000;background:rgba(4,3,4,0.88);" +
    "font-family:'Courier New',monospace;";
  const resultTitle = document.createElement("div");
  resultTitle.style.cssText =
    "font-size:clamp(40px,7vw,72px);font-weight:900;letter-spacing:16px;" +
    "text-transform:uppercase;";
  const resultSub = document.createElement("div");
  resultSub.style.cssText =
    "font-size:13px;letter-spacing:5px;color:#6a6258;text-transform:uppercase;";
  const backBtn = document.createElement("button");
  backBtn.textContent = "BACK TO MENU";
  backBtn.style.cssText =
    "font-family:'Courier New',monospace;font-size:14px;font-weight:700;" +
    "letter-spacing:8px;text-transform:uppercase;color:#8a8276;" +
    "background:transparent;border:1px solid #2e2a26;padding:14px 32px;" +
    "cursor:pointer;margin-top:12px;transition:color 0.2s,border-color 0.2s;";
  backBtn.addEventListener("mouseenter", () => {
    backBtn.style.color = "#c02020";
    backBtn.style.borderColor = "#4a1010";
  });
  backBtn.addEventListener("mouseleave", () => {
    backBtn.style.color = "#8a8276";
    backBtn.style.borderColor = "#2e2a26";
  });
  backBtn.addEventListener("click", () => {
    // Tear everything down and show the landing page again.
    cleanup();
    const homeOverlay = document.getElementById("landing-page");
    if (homeOverlay) homeOverlay.classList.remove("rr-hidden");
  });
  resultEl.appendChild(resultTitle);
  resultEl.appendChild(resultSub);
  resultEl.appendChild(backBtn);
  document.body.appendChild(resultEl);

  const showResult = (youWon: boolean): void => {
    resultTitle.textContent = youWon ? "YOU WIN" : "YOU LOSE";
    resultTitle.style.color = youWon ? "#c8b8a8" : "#a01818";
    resultSub.textContent = youWon ? "The pot is yours." : "Better luck next time.";
    resultEl.style.display = "flex";
  };

  const cleanup = (): void => {
    cancelled = true;
    controller.dispose();
    [timerWrap, chatEl, disconnectEl, afkWarnEl, resultEl].forEach((el) => {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
  };

  // Turn-timer readout + progress bar (top-right).
  // The number appears only in the final 10s; the bar drains the whole 30s.
  const timerWrap = document.createElement("div");
  timerWrap.style.cssText =
    "position:fixed;top:16px;right:18px;display:flex;flex-direction:column;" +
    "align-items:flex-end;gap:5px;z-index:9999;pointer-events:none;" +
    "opacity:0;transition:opacity 0.3s;";
  const timerEl = document.createElement("div");
  timerEl.style.cssText =
    "font-family:'Courier New',monospace;font-size:28px;font-weight:700;" +
    "letter-spacing:4px;color:#cc3333;line-height:1;";
  const timerBar = document.createElement("div"); // track
  timerBar.style.cssText =
    "width:120px;height:2px;background:rgba(80,30,30,0.35);overflow:hidden;";
  const timerFill = document.createElement("div"); // fill
  timerFill.style.cssText =
    "height:100%;width:100%;background:#a01818;transform-origin:right;" +
    "transition:transform 1s linear,background 1s;";
  timerBar.appendChild(timerFill);
  timerWrap.appendChild(timerEl);
  timerWrap.appendChild(timerBar);
  document.body.appendChild(timerWrap);

  // --- Chat box (bottom-left): minimalist horror styling ------------------
  const chatEl = document.createElement("div");
  chatEl.style.cssText =
    "position:fixed;bottom:20px;left:20px;width:300px;z-index:9998;display:none;" +
    "flex-direction:column;gap:6px;font-family:'Courier New',monospace;";

  // Quick-chat preset buttons row.
  const quickRow = document.createElement("div");
  quickRow.style.cssText = "display:flex;gap:4px;flex-wrap:wrap;";
  const QUICK_PHRASES = ["nice shot", "your move", "good luck", "ha."];
  for (const phrase of QUICK_PHRASES) {
    const qb = document.createElement("button");
    qb.textContent = phrase;
    qb.style.cssText =
      "font-family:'Courier New',monospace;font-size:10px;letter-spacing:1px;" +
      "color:#6a6258;background:rgba(5,4,5,0.82);border:1px solid #1e1a18;" +
      "padding:4px 8px;cursor:pointer;text-transform:uppercase;" +
      "transition:color 0.15s,border-color 0.15s;";
    qb.addEventListener("mouseenter", () => { qb.style.color = "#b8b0a0"; qb.style.borderColor = "#4a1010"; });
    qb.addEventListener("mouseleave", () => { qb.style.color = "#6a6258"; qb.style.borderColor = "#1e1a18"; });
    qb.addEventListener("click", () => {
      controller.sendChat(phrase);
      pushChatLine("YOU", phrase);
    });
    quickRow.appendChild(qb);
  }

  const chatLog = document.createElement("div");
  chatLog.style.cssText =
    "max-height:140px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;" +
    "padding:8px;background:rgba(5,4,5,0.82);border:1px solid #1e1a18;" +
    "border-left:2px solid #4a1010;scrollbar-width:thin;";
  const chatInput = document.createElement("input");
  chatInput.type = "text";
  chatInput.maxLength = 200;
  chatInput.placeholder = "or type something...";
  chatInput.setAttribute("aria-label", "Chat message");
  chatInput.style.cssText =
    "background:rgba(5,4,5,0.82);border:1px solid #1e1a18;color:#b8b0a0;" +
    "font-family:'Courier New',monospace;font-size:12px;letter-spacing:1px;" +
    "padding:8px 10px;outline:none;";
  chatInput.addEventListener("focus", () => (chatInput.style.borderColor = "#4a1010"));
  chatInput.addEventListener("blur", () => (chatInput.style.borderColor = "#1e1a18"));
  chatEl.appendChild(quickRow);
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
      // Expose which seat WE occupy so the wire() can show correct captions.
      const localParticipant: "PLAYER" | "AI" = youAre === "player1" ? "PLAYER" : "AI";

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
        goesFirst
          ? "The coin favors you. Take the first shot."
          : "The coin chose them. Wait for their move.",
      );
      await wait(2500);
      if (cancelled) return;

      // Reveal the board (emits initial state + ROUND_SET_LOADED events).
      matchStarted = true;
      // Wire the shared presentation pipeline with the correct local seat.
      wire(controller, localParticipant);
      controller.beginMatch();
      chatEl.style.display = "flex"; // chat opens once the duel begins
      onMatchStart();
    },

    onChat: (text) => {
      if (cancelled) return;
      pushChatLine("THEM", text);
    },

    onMatchOver: (youWon) => {
      if (cancelled || matchEnded) return;
      matchEnded = true;
      timerWrap.style.opacity = "0";
      disconnectEl.style.opacity = "0";
      // Show the result overlay (with back-to-menu button) after a short delay
      // so the death animation has time to play.
      setTimeout(() => {
        if (!cancelled) showResult(youWon);
      }, 5500);
      onMatchEnd(youWon);
    },

    onTimerTick: (secondsLeft) => {
      if (cancelled || !matchStarted) return;
      // Heartbeat: server is alive while ticks arrive.
      lastTickMs = Date.now();
      // A new turn starts when the server pushes a full 30s deadline again.
      if (secondsLeft >= 29) { timesUpShown = false; }
      disconnectEl.style.opacity = "0";
      // Bar always visible once match starts; drains over 30s.
      const TURN_SECS = 30;
      const pct = Math.max(0, secondsLeft / TURN_SECS);
      timerWrap.style.opacity = "1";
      timerFill.style.transform = `scaleX(${pct})`;
      const isRed = secondsLeft <= 5;
      timerFill.style.background = isRed ? "#cc2020" : "#a01818";
      // Number only appears in the last 10s.
      if (secondsLeft <= 10) {
        timerEl.style.opacity = "1";
        timerEl.textContent = secondsLeft === 0 ? "—" : String(secondsLeft);
        timerEl.style.color = isRed ? "#ff0000" : "#cc3333";
      } else {
        timerEl.style.opacity = "0";
      }
      // When the clock hits zero, show a narration caption so the player knows
      // the server is about to auto-fire and pass the turn.
      if (secondsLeft === 0 && !timesUpShown) {
        timesUpShown = true;
        caption.enqueue("TIME'S UP", "The gun fires itself. The turn passes.");
      }
      // Show an "AFK" warning at 5s left so the player has a moment to act.
      if (secondsLeft <= 5 && secondsLeft > 0) {
        afkWarnEl.style.opacity = "1";
      } else {
        afkWarnEl.style.opacity = "0";
      }
    },
  });

  // Disconnect watchdog: if no tick arrives for 20s while a match is live,
  // surface the indicator so the player knows the opponent may have left.
  let lastTickMs = Date.now();
  const disconnectWatchdog = setInterval(() => {
    if (!matchStarted || matchEnded || cancelled) return;
    const silentMs = Date.now() - lastTickMs;
    const isDisconnected = silentMs > 20_000;
    disconnectEl.style.opacity = isDisconnected ? "1" : "0";
    // After 45s of silence, offer the forfeit button.
    forfeitBtn.style.display = silentMs > 45_000 ? "block" : "none";
  }, 2000);

  caption.enqueue("SEARCHING", "Looking for an opponent...");
  controller.joinQueue(betAmount).catch((err) => {
    console.error("[multiplayer] queue error:", err);
    caption.enqueue("CONNECTION LOST", "Could not reach matchmaking.");
  });

  return {
    cancel: () => {
      clearInterval(disconnectWatchdog);
      cleanup();
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
