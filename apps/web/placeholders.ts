// Placeholder vote and bet screens. The final UI replaces these roots: delete [data-placeholder].
import { $, S, applyRoundState, submitBet } from "./game.ts";
import {
  placeholderView,
  type BetView,
  type TallyLine,
  type VoteView,
} from "./placeholder-view.ts";
import { STAKES } from "./room-state.ts";
import { postVote } from "./round-client.ts";

const voteRoot = $('[data-placeholder="vote"]');
const betRoot = $('[data-placeholder="bet"]');
const failure = { vote: "", bet: "" };
let voteKey = "";
let betKey = "";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  className = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className !== "") node.className = className;
  return node;
}

function part(root: HTMLElement, name: string): HTMLElement {
  const node = root.querySelector<HTMLElement>(`[data-part="${name}"]`);
  if (node === null) throw new Error(`placeholder part ${name} is missing`);
  return node;
}

function frame(root: HTMLElement, title: string, parts: string[]): void {
  root.replaceChildren(el("h2", `PLACEHOLDER · ${title}`));
  for (const name of parts) {
    const node = el("div");
    node.dataset.part = name;
    root.append(node);
  }
  const error = el("p", "", "err");
  error.dataset.part = "error";
  const dismiss = el("button", "Dismiss");
  dismiss.dataset.part = "dismiss";
  root.append(error, dismiss);
}

function showTally(root: HTMLElement, tally: TallyLine[] | null): void {
  const box = part(root, "tally");
  if (tally === null) {
    box.replaceChildren(el("p", "Stored tally: not written yet."));
    return;
  }
  const list = el("ol");
  for (const line of tally) list.append(el("li", `${line.name}: ${String(line.votes)}`));
  box.replaceChildren(el("p", "Stored tally (Postgres):"), list);
}

function showFailure(root: HTMLElement, screen: "vote" | "bet"): void {
  part(root, "error").textContent = failure[screen];
  part(root, "dismiss").hidden = failure[screen] === "";
}

function buildVote(view: VoteView): void {
  frame(voteRoot, "VOTING PERIOD", ["picks", "tally", "submit"]);
  const picks = part(voteRoot, "picks");
  for (const c of view.candidates) {
    const label = el("label");
    const box = el("input");
    box.type = "checkbox";
    box.value = String(c.id);
    const count = el("span");
    count.dataset.count = String(c.id);
    label.append(box, ` ${c.name} `, count);
    picks.append(label, el("br"));
  }
  const send = el("button", "Submit vote");
  send.addEventListener("click", () => {
    const chosen = [...picks.querySelectorAll<HTMLInputElement>("input:checked")].map((b) =>
      Number(b.value),
    );
    failure.vote = "";
    renderPlaceholders();
    postVote(chosen)
      .then((state) => {
        S.cast = "submitted";
        applyRoundState(state);
      })
      .catch((error: unknown) => {
        failure.vote = `VOTE REJECTED. ${error instanceof Error ? error.message : String(error)}`;
        renderPlaceholders();
      });
  });
  part(voteRoot, "submit").replaceChildren(send);
  part(voteRoot, "dismiss").addEventListener("click", () => {
    failure.vote = "";
    renderPlaceholders();
  });
}

function buildBet(view: BetView): void {
  frame(betRoot, "BETTING PERIOD", ["closes", "sides", "stake", "tally", "submit"]);
  const sides = part(betRoot, "sides");
  view.sides.forEach((side, i) => {
    const label = el("label");
    const radio = el("input");
    radio.type = "radio";
    radio.name = "placeholder-side";
    radio.value = String(i);
    radio.checked = i === 0;
    const pool = el("span");
    pool.dataset.pool = String(i);
    label.append(radio, ` ${i === 0 ? "A" : "B"} ${side.name} `, pool);
    sides.append(label, el("br"));
  });
  const stake = el("select");
  for (const amount of STAKES) {
    const option = el("option", `${String(amount)} USDC`);
    option.value = String(amount);
    stake.append(option);
  }
  part(betRoot, "stake").replaceChildren(el("span", "Stake "), stake);
  const send = el("button", "Submit bet");
  send.addEventListener("click", () => {
    const side = sides.querySelector<HTMLInputElement>("input:checked")?.value === "1" ? 1 : 0;
    failure.bet = "";
    renderPlaceholders();
    submitBet(side, Number(stake.value)).catch((error: unknown) => {
      failure.bet = `BET REJECTED. ${error instanceof Error ? error.message : String(error)}`;
      renderPlaceholders();
    });
  });
  part(betRoot, "submit").replaceChildren(send);
  part(betRoot, "dismiss").addEventListener("click", () => {
    failure.bet = "";
    renderPlaceholders();
  });
}

/** Server phase picks the screen; a screen holding a rejection stays up until dismissed. */
export function renderPlaceholders(): void {
  const view = placeholderView(S);
  const vote = view?.screen === "vote" ? view : null;
  const bet = view?.screen === "bet" ? view : null;

  if (vote !== null) {
    const key = `${String(S.round)}:${vote.candidates.map((c) => c.id).join(",")}`;
    if (key !== voteKey) {
      buildVote(vote);
      voteKey = key;
    }
    for (const c of vote.candidates) {
      const count = voteRoot.querySelector<HTMLElement>(`[data-count="${String(c.id)}"]`);
      if (count !== null) count.textContent = `(${String(c.votes)} stored)`;
    }
    showTally(voteRoot, vote.tally);
  }
  if (voteKey !== "") showFailure(voteRoot, "vote");
  voteRoot.hidden = vote === null && failure.vote === "";

  if (bet !== null) {
    const key = `${String(S.round)}:${String(S.battleId)}`;
    if (key !== betKey) {
      buildBet(bet);
      betKey = key;
    }
    part(betRoot, "closes").textContent =
      `Betting closes at (stored betting_closes_at): ${bet.closesAt}`;
    bet.sides.forEach((side, i) => {
      const pool = betRoot.querySelector<HTMLElement>(`[data-pool="${String(i)}"]`);
      if (pool !== null) pool.textContent = `(pool ${side.usdc} USDC)`;
    });
    showTally(betRoot, bet.tally);
  }
  if (betKey !== "") showFailure(betRoot, "bet");
  betRoot.hidden = bet === null && failure.bet === "";
}
