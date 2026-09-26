import { $, S, submitBet } from "./game.ts";
import { placeholderView, type BetView } from "./placeholder-view.ts";
import { STAKES } from "./room-state.ts";

const betRoot = $('[data-placeholder="bet"]');
const failure = { bet: "" };
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

function showFailure(root: HTMLElement): void {
  part(root, "error").textContent = failure.bet;
  part(root, "dismiss").hidden = failure.bet === "";
}

function buildBet(view: BetView): void {
  frame(betRoot, "BETTING PERIOD", ["closes", "sides", "stake", "submit"]);
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

export function renderPlaceholders(): void {
  const view = placeholderView(S);
  const bet = view?.screen === "bet" ? view : null;

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
  }
  if (betKey !== "") showFailure(betRoot);
  betRoot.hidden = bet === null && failure.bet === "";
}
