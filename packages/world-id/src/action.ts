import { requireEnv } from "./env.js";

function requireId(kind: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new Error(`${kind} is required for the World ID action.`);
  }
  return trimmed;
}

export type PracticeSlot = 1 | 2 | 3 | 4 | 5;
export type GateSlot = PracticeSlot | "judge";

export type GateActions = {
  practice: [string, string, string, string, string];
  judge: string;
};

function rejectWhitespace(name: string, action: string): void {
  if (/\s/u.test(action)) {
    throw new Error(`${name} must not contain whitespace. See .env.example.`);
  }
}

export function readGateActions(env: NodeJS.ProcessEnv = process.env): GateActions {
  const raw = requireEnv("WORLD_ID_PRACTICE_ACTIONS", env.WORLD_ID_PRACTICE_ACTIONS);
  const practice = raw.split(",").map((part) => part.trim());
  const [first, second, third, fourth, fifth] = practice;
  if (
    practice.length !== 5 ||
    first === undefined ||
    second === undefined ||
    third === undefined ||
    fourth === undefined ||
    fifth === undefined ||
    first === "" ||
    second === "" ||
    third === "" ||
    fourth === "" ||
    fifth === ""
  ) {
    throw new Error(
      "WORLD_ID_PRACTICE_ACTIONS must be five comma-separated actions. See .env.example.",
    );
  }
  const actions: [string, string, string, string, string] = [first, second, third, fourth, fifth];
  for (const action of actions) rejectWhitespace("WORLD_ID_PRACTICE_ACTIONS", action);
  if (new Set(actions).size !== 5) {
    throw new Error("WORLD_ID_PRACTICE_ACTIONS must be five different actions. See .env.example.");
  }
  const judge = requireEnv("WORLD_ID_JUDGE_ACTION", env.WORLD_ID_JUDGE_ACTION);
  rejectWhitespace("WORLD_ID_JUDGE_ACTION", judge);
  if (actions.includes(judge)) {
    throw new Error(
      "WORLD_ID_JUDGE_ACTION must be different from the practice actions. See .env.example.",
    );
  }
  return { practice: actions, judge };
}

export function actionForSlot(slot: GateSlot, env: NodeJS.ProcessEnv = process.env): string {
  const actions = readGateActions(env);
  if (slot === "judge") return actions.judge;
  const action = actions.practice[slot - 1];
  if (action === undefined) {
    throw new Error(`Practice slot must be 1, 2, 3, 4, or 5. Got: ${String(slot)}.`);
  }
  return action;
}

export function assertAllowedAction(action: string, env: NodeJS.ProcessEnv = process.env): void {
  const actions = readGateActions(env);
  if (action === actions.judge || actions.practice.includes(action)) return;
  throw new Error(`World ID action is not a practice or judge action. Got: ${action}.`);
}

export function voteActionForRound(roundId: string): string {
  return `vote-round-${requireId("roundId", roundId)}`;
}

export function stakeActionForBattle(battleId: string): string {
  return `stake-battle-${requireId("battleId", battleId)}`;
}
