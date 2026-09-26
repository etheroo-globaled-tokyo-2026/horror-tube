import * as v from "valibot";

import type { RoundState } from "../server/src/types.ts";

import { WALLET_SESSION_KEY, type SessionStore } from "./wallet.ts";

export type ServerRoundState = RoundState;

export type RoundListener = (state: ServerRoundState) => void;

const NumberPair = v.tuple([v.number(), v.number()]);

const RoundStateSchema = v.object({
  round: v.number(),
  phase: v.picklist(["vote", "countdown", "bet", "fight", "settle", "over"]),
  endsAt: v.nullable(v.number()),
  champion: v.nullable(v.number()),
  slots: v.picklist([1, 2]),
  voters: v.number(),
  quorum: v.number(),
  votes: v.record(v.pipe(v.string(), v.digits()), v.number()),
  tally: v.nullable(
    v.array(v.object({ id: v.number(), votes: v.number(), reachedAt: v.number() })),
  ),
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
  chars: v.array(
    v.object({ id: v.number(), alive: v.boolean(), kills: v.number(), damage: v.number() }),
  ),
}) satisfies v.GenericSchema<RoundState>;

const SessionPostResponse = v.object({
  ok: v.optional(v.boolean()),
  error: v.optional(v.string()),
  state: v.optional(RoundStateSchema),
});

function parseRoundState(source: string, json: string): ServerRoundState {
  const parsed = v.safeParse(RoundStateSchema, JSON.parse(json));
  if (!parsed.success) {
    throw new Error(`${source} sent an invalid RoundState: ${v.summarize(parsed.issues)}`);
  }
  return parsed.output;
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

function storedVoteSession(store: SessionStore): string {
  const session = store.getItem(WALLET_SESSION_KEY);
  if (session === null || session.trim() === "") {
    throw new Error("World ID session is required. Finish the waiver scan first.");
  }
  return session;
}

async function postWithSession(
  path: "/vote" | "/playback-start",
  payload: { picks: number[] } | { battleId: string },
  store: SessionStore,
): Promise<ServerRoundState> {
  const session = storedVoteSession(store);
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
    throw new Error(body.error ?? `POST ${path} failed: HTTP ${String(res.status)}`);
  }
  if (body.state === undefined) {
    throw new Error(`POST ${path} response missing state.`);
  }
  return body.state;
}

export function postVote(
  picks: number[],
  store: SessionStore = localStorage,
): Promise<ServerRoundState> {
  return postWithSession("/vote", { picks }, store);
}

export function postPlaybackStart(
  battleId: string,
  store: SessionStore = localStorage,
): Promise<ServerRoundState> {
  return postWithSession("/playback-start", { battleId }, store);
}
