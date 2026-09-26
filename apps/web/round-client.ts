import * as v from "valibot";

import type { RoundState } from "../server/src/types.ts";

import { WALLET_SESSION_KEY, type SessionStore } from "./wallet.ts";

export type ServerRoundState = RoundState;

export type RoundListener = (state: ServerRoundState) => void;

const NumberPair = v.tuple([v.number(), v.number()]);

const RoundStateSchema = v.object({
  round: v.number(),
  phase: v.picklist(["waiting", "vote", "countdown", "bet", "fight", "settle", "over"]),
  endsAt: v.nullable(v.number()),
  champion: v.nullable(v.number()),
  voters: v.number(),
  quorum: v.number(),
  votes: NumberPair,
  tally: v.nullable(NumberPair),
  fighters: v.nullable(NumberPair),
  battleId: v.nullable(v.string()),
  poolId: v.nullable(v.string()),
  pool: NumberPair,
  winner: v.nullable(v.picklist([0, 1])),
  videoUrl: v.nullable(v.string()),
  videoStartedAt: v.nullable(v.number()),
  bettingClosesAt: v.nullable(v.number()),
  frameUrl: v.nullable(v.string()),
  error: v.nullable(v.string()),
  bots: v.array(
    v.object({
      address: v.string(),
      pick: v.nullable(v.number()),
      bet: v.nullable(
        v.object({ side: v.picklist([0, 1]), units: v.number(), digest: v.string() }),
      ),
      error: v.nullable(v.string()),
    }),
  ),
  chars: v.array(
    v.object({
      id: v.number(),
      label: v.string(),
      alive: v.boolean(),
      kills: v.number(),
      damage: v.number(),
    }),
  ),
}) satisfies v.GenericSchema<RoundState>;

const SessionPostResponse = v.object({
  ok: v.optional(v.boolean()),
  error: v.optional(v.string()),
  code: v.optional(v.string()),
  state: v.optional(RoundStateSchema),
});

export class SessionPostError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "SessionPostError";
  }
}

function parseRoundState(source: string, json: string): ServerRoundState {
  const parsed = v.safeParse(RoundStateSchema, JSON.parse(json));
  if (!parsed.success) {
    throw new Error(`${source} sent an invalid RoundState: ${v.summarize(parsed.issues)}`);
  }
  return parsed.output;
}

export async function fetchReplayVideoUrl(
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchImpl("/replay");
  let body: unknown;
  try {
    body = await res.json();
  } catch (cause) {
    throw new Error(
      `GET /replay returned non-JSON with HTTP ${String(res.status)}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  const parsed = v.safeParse(
    v.union([
      v.object({ videoUrl: v.pipe(v.string(), v.minLength(1)) }),
      v.object({ ok: v.literal(false), error: v.string() }),
    ]),
    body,
  );
  if (!parsed.success) {
    throw new Error(
      `GET /replay sent an unexpected body with HTTP ${String(res.status)}: ${v.summarize(parsed.issues)}`,
    );
  }
  const out = parsed.output;
  if ("error" in out) {
    throw new Error(out.error);
  }
  if (!res.ok) {
    throw new Error(`GET /replay failed: HTTP ${String(res.status)}`);
  }
  return out.videoUrl;
}

export async function fetchRoundState(): Promise<ServerRoundState> {
  const res = await fetch("/round");
  if (!res.ok) {
    throw new Error(`GET /round failed: HTTP ${String(res.status)} ${res.statusText}`);
  }
  return parseRoundState("GET /round", await res.text());
}

export function connectRoundEvents(onState: RoundListener): () => void {
  const source = new EventSource("/events");
  const onRound = (ev: Event): void => {
    if (!(ev instanceof MessageEvent)) {
      throw new Error(
        `EventSource /events "round" delivered a ${ev.constructor.name}, not a MessageEvent.`,
      );
    }
    onState(parseRoundState("EventSource /events round", String(ev.data)));
  };
  source.addEventListener("round", onRound);
  source.onerror = () => {
    console.error("EventSource /events error", source.readyState);
  };
  return () => {
    source.removeEventListener("round", onRound);
    source.close();
  };
}

export function withServerIds<T extends { label: string }>(
  sheets: T[],
  chars: ServerRoundState["chars"],
): (T & { id: number })[] {
  return chars.map((c) => {
    const sheet = sheets.find((s) => s.label === c.label);
    if (sheet === undefined) {
      throw new Error(
        `The game server lists ${c.label} as character ${String(c.id)}, but the ENS roster the room read has no ${c.label} (it has ${sheets.map((s) => s.label).join(", ")}).`,
      );
    }
    return { ...sheet, id: c.id };
  });
}

function storedSession(store: SessionStore): string {
  const session = store.getItem(WALLET_SESSION_KEY);
  if (session === null || session.trim() === "") {
    throw new Error("World ID session is required. Finish the waiver scan first.");
  }
  return session;
}

async function postWithSession(
  path: "/start" | "/vote" | "/playback-start",
  payload: Record<string, never> | { battleId: string } | { pick: number },
  store: SessionStore,
): Promise<ServerRoundState> {
  const session = storedSession(store);
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session}`,
    },
    body: JSON.stringify(payload),
  });
  const parsed = v.safeParse(SessionPostResponse, await res.json());
  if (!parsed.success) {
    throw new Error(
      `POST ${path} sent an unexpected body with HTTP ${String(res.status)}: ${v.summarize(parsed.issues)}`,
    );
  }
  const body = parsed.output;
  if (!res.ok || body.ok === false) {
    throw new SessionPostError(
      path,
      res.status,
      body.code,
      body.error ?? `POST ${path} failed: HTTP ${String(res.status)}`,
    );
  }
  if (body.state === undefined) {
    throw new Error(`POST ${path} response missing state.`);
  }
  return body.state;
}

export function postStart(store: SessionStore = localStorage): Promise<ServerRoundState> {
  return postWithSession("/start", {}, store);
}

export function postVote(pick: number, store: SessionStore = localStorage): Promise<ServerRoundState> {
  return postWithSession("/vote", { pick }, store);
}

export function postPlaybackStart(
  battleId: string,
  store: SessionStore = localStorage,
): Promise<ServerRoundState> {
  return postWithSession("/playback-start", { battleId }, store);
}
