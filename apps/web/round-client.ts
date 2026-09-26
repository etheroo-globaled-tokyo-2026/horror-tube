/** Same-origin RoundState client (docs/game-loop.md). No second host. */

import type { RoundState } from "../server/src/types.ts";

import { WALLET_SESSION_KEY, type SessionStore } from "./wallet.ts";

export type ServerRoundState = RoundState;

export type RoundListener = (state: ServerRoundState) => void;

function apiUrl(path: string): string {
  // Same origin as the App Platform app (or Vite proxy in local dev).
  return path.startsWith("/") ? path : `/${path}`;
}

export async function fetchRoundState(): Promise<ServerRoundState> {
  const res = await fetch(apiUrl("/round"));
  if (!res.ok) {
    throw new Error(
      `GET /round failed: HTTP ${String(res.status)} ${res.statusText}`,
    );
  }
  return (await res.json()) as ServerRoundState;
}

export function connectRoundEvents(onState: RoundListener): () => void {
  const source = new EventSource(apiUrl("/events"));
  const onRound = (ev: MessageEvent<string>): void => {
    const state = JSON.parse(ev.data) as ServerRoundState;
    onState(state);
  };
  source.addEventListener("round", onRound as EventListener);
  source.onerror = () => {
    console.error("EventSource /events error", source.readyState);
  };
  return () => {
    source.removeEventListener("round", onRound as EventListener);
    source.close();
  };
}

function storedSession(store: SessionStore): string {
  const session = store.getItem(WALLET_SESSION_KEY);
  if (session === null || session.trim() === "") {
    throw new Error("World ID session is required. Finish the waiver scan first.");
  }
  return session;
}

async function postWithSession(
  path: "/playback-start",
  payload: { battleId: string },
  store: SessionStore,
): Promise<ServerRoundState> {
  const session = storedSession(store);
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session}`,
    },
    body: JSON.stringify(payload),
  });
  const body = (await res.json()) as {
    ok?: boolean;
    error?: string;
    state?: ServerRoundState;
  };
  if (!res.ok || body.ok === false) {
    throw new Error(
      body.error ?? `POST ${path} failed: HTTP ${String(res.status)}`,
    );
  }
  if (body.state === undefined) {
    throw new Error(`POST ${path} response missing state.`);
  }
  return body.state;
}

/** Tell the server this room's fight video started playing; it stores betting_closes_at. */
export function postPlaybackStart(
  battleId: string,
  store: SessionStore = localStorage,
): Promise<ServerRoundState> {
  return postWithSession("/playback-start", { battleId }, store);
}
