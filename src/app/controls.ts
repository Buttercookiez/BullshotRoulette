// Player control panel for the Revolver Roulette app shell.
//
// This module owns ONLY presentation/DOM concerns for the human player's
// controls. It contains NO game rules: it turns button clicks into `Action`
// objects handed to a callback (wired to `GameController.submitPlayerAction` in
// `main.ts`), and it re-skins itself from a read-only `GameState` snapshot via
// `update`. To decide which controls are enabled it uses only the pure,
// read-only engine helpers `isMatchOver`, `winnerOf`, and `remainingCounts`.

import type { Action, GameState, ItemType, ParticipantId } from "../engine/types";
import { isMatchOver, winnerOf } from "../engine/lifecycle";
import { remainingCounts } from "../engine/cylinder";

/** Callbacks the panel invokes in response to the player interacting with it. */
export interface ControlCallbacks {
  /** A control was activated and produced a game `Action` to submit. */
  readonly onAction: (action: Action) => void;
  /**
   * Any control was interacted with (a user gesture). `main.ts` uses this to
   * start the ambient audio on the FIRST gesture (browsers block autoplay until
   * a user interaction) and to play the UI blip sound on every interaction
   * (Requirement 9.6).
   */
  readonly onInteract: () => void;
}

/** The six Item types, in display order, paired with their button labels. */
const ITEM_ORDER: ReadonlyArray<readonly [ItemType, string]> = [
  ["MAGNIFYING_GLASS", "MAGNIFIER"],
  ["SPEED_LOADER", "SPEED LOADER"],
  ["MEDKIT", "MEDKIT"],
  ["HANDCUFFS", "HANDCUFFS"],
  ["INVERTER", "INVERTER"],
  ["HOLLOW_POINT", "HOLLOW POINT"],
];

/** Human-readable label for a participant, used in the status/winner line. */
function participantLabel(id: ParticipantId): string {
  return id === "PLAYER" ? "YOU" : "THE DEALER";
}

/** Count how many of each Item type a participant currently holds. */
function countItems(items: ReadonlyArray<ItemType>): Map<ItemType, number> {
  const counts = new Map<ItemType, number>();
  for (const item of items) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  return counts;
}

/**
 * The player's on-screen control panel: a status/info banner, shoot/spin action
 * buttons, one button per Item type, and a NEW MATCH control shown when the
 * Match is over. Construct it, `mount` it into a host element, then call
 * `update(state)` on every state change to refresh enable/disable state.
 */
export class ActionPanel {
  private readonly cb: ControlCallbacks;

  private readonly root: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly info: HTMLDivElement;
  private readonly shootSelfBtn: HTMLButtonElement;
  private readonly shootDealerBtn: HTMLButtonElement;
  private readonly spinBtn: HTMLButtonElement;
  private readonly itemButtons: Map<ItemType, HTMLButtonElement> = new Map();
  private readonly newMatchBtn: HTMLButtonElement;

  constructor(cb: ControlCallbacks) {
    this.cb = cb;

    this.root = el("div", "rr-controls");
    this.status = el("div", "rr-status");
    this.info = el("div", "rr-info");

    const actionRow = el("div", "rr-row");
    this.shootSelfBtn = this.makeActionButton("SHOOT SELF", { kind: "SHOOT", target: "PLAYER" });
    this.shootDealerBtn = this.makeActionButton("SHOOT DEALER", { kind: "SHOOT", target: "AI" });
    this.spinBtn = this.makeActionButton("SPIN", { kind: "SPIN" });
    actionRow.append(this.shootSelfBtn, this.shootDealerBtn, this.spinBtn);

    const itemRow = el("div", "rr-row rr-items");
    for (const [type, label] of ITEM_ORDER) {
      const btn = this.makeActionButton(label, { kind: "USE_ITEM", item: type });
      btn.classList.add("rr-item");
      this.itemButtons.set(type, btn);
      itemRow.append(btn);
    }

    const endRow = el("div", "rr-row");
    this.newMatchBtn = this.makeActionButton("NEW MATCH", { kind: "START_NEW_MATCH" });
    this.newMatchBtn.classList.add("rr-new-match");
    endRow.append(this.newMatchBtn);

    this.root.append(this.status, this.info, actionRow, itemRow, endRow);
  }

  /** Attach the panel's DOM to `host`. */
  mount(host: HTMLElement): void {
    host.appendChild(this.root);
  }

  /**
   * Re-skin all controls from a read-only `state` snapshot:
   *   - Action buttons are enabled only on the Player's Turn while the Match is
   *     in progress (Requirement 3.8 is enforced by the controller too, but a
   *     disabled control gives clearer feedback).
   *   - SPIN is additionally gated by the >=2-rounds rule and the per-Turn spin
   *     limit (Requirement 4.x) for honest affordance.
   *   - Item buttons appear only for Item types the Player actually holds
   *     (Requirement 5.11 surfaces inventory).
   *   - On Match over, the status line names the winner (Requirements 7.4) and
   *     the NEW MATCH control is shown (Requirements 7.5, 7.6).
   */
  update(state: GameState): void {
    const matchOver = isMatchOver(state);
    const playerTurn = !matchOver && state.activeParticipant === "PLAYER";
    const counts = remainingCounts(state.cylinder);
    const roundsRemaining = counts.live + counts.blank;

    const player = state.participants.PLAYER;
    const dealer = state.participants.AI;

    // Shoot/spin affordances.
    this.shootSelfBtn.disabled = !playerTurn || roundsRemaining === 0;
    this.shootDealerBtn.disabled = !playerTurn || roundsRemaining === 0;
    this.spinBtn.disabled =
      !playerTurn ||
      roundsRemaining < 2 ||
      state.spinsUsedThisTurn >= state.config.maxSpinsPerTurn;

    // Item buttons: visible only for held types, enabled only on the Player's
    // Turn (Requirement 5.11).
    const held = countItems(player.items);
    for (const [type, btn] of this.itemButtons) {
      const owned = held.get(type) ?? 0;
      btn.style.display = owned > 0 ? "" : "none";
      btn.disabled = !playerTurn || owned === 0;
      const [, label] = ITEM_ORDER.find(([t]) => t === type)!;
      btn.textContent = owned > 1 ? `${label} \u00d7${owned}` : label;
    }

    // Info line: HP for both, plus visible round composition (Requirements 2.6,
    // 5.11 are primarily the Renderer's job; this is a text fallback).
    this.info.textContent =
      `YOU ${player.hp} HP \u00b7 DEALER ${dealer.hp} HP \u00b7 ` +
      `${counts.live} LIVE / ${counts.blank} BLANK`;

    // Status line + NEW MATCH visibility.
    if (matchOver) {
      const winner = winnerOf(state);
      this.status.textContent =
        winner !== null ? `${participantLabel(winner)} WINS` : "MATCH OVER";
      this.newMatchBtn.style.display = "";
    } else {
      this.status.textContent = playerTurn ? "YOUR TURN" : "THE DEALER'S TURN";
      this.newMatchBtn.style.display = "none";
    }
  }

  /**
   * Build a button that, on click, notifies `onInteract` (UI blip + first-gesture
   * ambient start) and then submits `action`.
   */
  private makeActionButton(label: string, action: Action): HTMLButtonElement {
    const btn = el("button", "rr-btn");
    btn.type = "button";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      this.cb.onInteract();
      this.cb.onAction(action);
    });
    return btn;
  }
}

/** Tiny typed `document.createElement` helper that also sets a class name. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
