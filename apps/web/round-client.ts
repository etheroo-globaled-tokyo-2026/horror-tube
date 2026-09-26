/** Same-origin RoundState client (docs/game-loop.md). No second host. */

import { WALLET_SESSION_KEY, type SessionStore } from "./wallet.ts";

export type ServerPhase = "vote" | "countdown" | "bet" | "fight" | "settle" | "over";

export type ServerRoundState = {
  round: number;
  phase: ServerPhase;
  endsAt: number | null;
  champion: number | null;
  slots: 1 | 2;
  voters: number;
  quorum: number;
  votes: Record<number, number>;
  fighters: [number, number] | null;
  pool: [number, number];
  winner: 0 | 1 | null;
  videoUrl: string | null;
  error: string | null;
  chars: { id: number; alive: boolean; kills: number; damage: number }[];
};

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

function storedVoteSession(store: SessionStore): string {
  const session = store.getItem(WALLET_SESSION_KEY);
  if (session === null || session.trim() === "") {
    throw new Error("World ID session is required. Finish the waiver scan first.");
  }
  return session;
}

export async function postVote(
  picks: number[],
  store: SessionStore = localStorage,
): Promise<ServerRoundState> {
  const session = storedVoteSession(store);
  const res = await fetch(apiUrl("/vote"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session}`,
    },
    body: JSON.stringify({ picks }),
  });
  const body = (await res.json()) as {
    ok?: boolean;
    error?: string;
    state?: ServerRoundState;
  };
  if (!res.ok || body.ok === false) {
    throw new Error(
      body.error ?? `POST /vote failed: HTTP ${String(res.status)}`,
    );
  }
  if (body.state === undefined) {
    throw new Error("POST /vote response missing state.");
  }
  return body.state;
}

export async function postBet(
  side: 0 | 1,
  amount: number,
): Promise<ServerRoundState> {
  const res = await fetch(apiUrl("/bet"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ side, amount }),
  });
  const body = (await res.json()) as {
    ok?: boolean;
    error?: string;
    state?: ServerRoundState;
  };
  if (!res.ok || body.ok === false) {
    throw new Error(
      body.error ?? `POST /bet failed: HTTP ${String(res.status)}`,
    );
  }
  if (body.state === undefined) {
    throw new Error("POST /bet response missing state.");
  }
  return body.state;
}
