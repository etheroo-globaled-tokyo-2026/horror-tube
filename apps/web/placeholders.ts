import { $, S, submitBet } from "./game.ts";
import { placeholderView, type BetView, type PickView } from "./placeholder-view.ts";
import { STAKES } from "./room-state.ts";

const betRoot = $('[data-placeholder="bet"]');
const pickRoot = $('[data-placeholder="pick"]');
const failure = { bet: "", pick: "" };
let betKey = "";
let pickKey = "";

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
  root.replaceChildren(el("h2", title));
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

function showFailure(root: HTMLElement, text: string): void {
  part(root, "error").textContent = text;
  part(root, "dismiss").hidden = text === "";
}

function buildPick(view: PickView): void {
  frame(pickRoot, view.title, ["choices"]);
  const choices = part(pickRoot, "choices");
  for (const choice of view.choices) {
    const button = el("button", choice.name);
    button.dataset.act = view.act;
    button.dataset.id = String(choice.id);
    choices.append(button, el("br"));
  }
  part(pickRoot, "dismiss").addEventListener("click", () => {
    failure.pick = "";
    renderPlaceholders();
  });
}

function buildBet(view: BetView): void {
  frame(betRoot, "PLACE YOUR BET", ["closes", "sides", "stake", "submit"]);
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
  const send = el("button", "Place bet");
  send.addEventListener("click", () => {
    const side = sides.querySelector<HTMLInputElement>("input:checked")?.value === "1" ? 1 : 0;
    failure.bet = "";
    renderPlaceholders();
    submitBet(side, Number(stake.value)).catch((cause: unknown) => {
      failure.bet = `BET REJECTED. ${cause instanceof Error ? cause.message : String(cause)}`;
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
  const pick = view?.screen === "pick" ? view : null;
  const bet = view?.screen === "bet" ? view : null;

  if (pick !== null) {
    const key = `${S.phase}:${pick.choices.map((c) => String(c.id)).join(",")}`;
    if (key !== pickKey) {
      buildPick(pick);
      pickKey = key;
    }
  } else {
    pickKey = "";
  }
  if (pickKey !== "") showFailure(pickRoot, failure.pick);
  pickRoot.hidden = pick === null && failure.pick === "";

  if (bet !== null) {
    const key = `${String(S.round)}:${String(S.battleId)}`;
    if (key !== betKey) {
      buildBet(bet);
      betKey = key;
    }
    part(betRoot, "closes").textContent = `Betting closes: ${bet.closesAt}`;
    bet.sides.forEach((side, i) => {
      const pool = betRoot.querySelector<HTMLElement>(`[data-pool="${String(i)}"]`);
      if (pool !== null) pool.textContent = `(pool ${side.usdc} USDC)`;
    });
  }
  if (betKey !== "") showFailure(betRoot, failure.bet);
  betRoot.hidden = bet === null && failure.bet === "";
}
