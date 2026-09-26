import { z } from "zod";

export const POLL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 10_000;

const BettingIds = z.object({
  packageId: z.string().min(1),
  houseId: z.string().min(1),
  coinType: z.string().min(1),
  network: z.string().min(1),
  feeBps: z.number(),
});
export type BettingIds = z.infer<typeof BettingIds>;

const Round = z.object({
  round: z.number(),
  phase: z.string(),
  battleId: z.string().nullable(),
  poolId: z.string().nullable(),
  fighters: z.tuple([z.number(), z.number()]).nullable(),
});
export type Round = z.infer<typeof Round>;

export type OpenBout = {
  round: number;
  battleId: string;
  poolId: string;
  fighters: [number, number];
};

export type Poller = {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
};

async function getJson<T>(
  gameUrl: string,
  path: string,
  schema: z.ZodType<T>,
  fetchImpl: typeof fetch,
): Promise<T> {
  const url = new URL(path, gameUrl);
  let response: Response;
  let body: string;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    body = await response.text();
  } catch (error) {
    throw new Error(
      `GET ${url} failed: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  }
  if (!response.ok) throw new Error(`GET ${url} failed: HTTP ${response.status} ${body}`);
  let parsed: z.ZodSafeParseResult<T>;
  try {
    parsed = schema.safeParse(JSON.parse(body));
  } catch {
    throw new Error(
      `GET ${url} returned HTTP ${response.status} with a body that is not JSON: ${body}`,
    );
  }
  if (!parsed.success)
    throw new Error(
      `GET ${url} returned an unexpected body: ${z.prettifyError(parsed.error)}\nBody: ${body}`,
    );
  return parsed.data;
}

export const getBetting = (gameUrl: string, fetchImpl: typeof fetch): Promise<BettingIds> =>
  getJson(gameUrl, "/betting", BettingIds, fetchImpl);

export const getRound = (gameUrl: string, fetchImpl: typeof fetch): Promise<Round> =>
  getJson(gameUrl, "/round", Round, fetchImpl);

export async function waitForBetPhase(
  gameUrl: string,
  timeoutMs: number,
  poller: Poller,
): Promise<OpenBout> {
  const deadline = poller.now() + timeoutMs;
  let seen = "";
  for (;;) {
    const { round, phase, battleId, poolId, fighters } = await getRound(gameUrl, poller.fetch);
    if (phase === "bet" && battleId !== null && poolId !== null && fighters !== null)
      return { round, battleId, poolId, fighters };
    const status = `round ${round} is in ${phase}${phase === "bet" ? " with no pool yet" : ""}`;
    if (status !== seen) poller.log(`GET /round: ${status}; checking every ${POLL_MS / 1000} s…`);
    seen = status;
    if (poller.now() >= deadline)
      throw new Error(
        `Timed out after ${timeoutMs / 60_000} min waiting for a bet phase with a pool at ${gameUrl}; last saw ${status}.`,
      );
    await poller.sleep(POLL_MS);
  }
}
