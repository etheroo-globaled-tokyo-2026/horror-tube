import type { GameState } from "./game.ts";

export type HintNote = Pick<GameState, "phase" | "note" | "noteKind">;

export const esc = (text: string): string =>
  text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export const errorHint = (state: HintNote): string | null =>
  state.phase !== "gate" && state.noteKind === "bad" && state.note !== "" ? esc(state.note) : null;
