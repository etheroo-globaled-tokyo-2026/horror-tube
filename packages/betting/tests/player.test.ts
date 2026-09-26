import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { POLL_MS, waitForBetPhase } from "../src/cli/game-api.js";
import {
  formatUsdc,
  parsePlayerArgs,
  parseUsdc,
  sideIndex,
  sideLetter,
} from "../src/cli/player-args.js";

const gameUrl = "http://game.test";

function round(phase: string, poolId: string | null = null) {
  return {
    round: 7,
    phase,
    battleId: poolId === null ? null : "battle-7",
    poolId,
    fighters: phase === "vote" ? null : [3, 9],
  };
}

function fakeGame(responses: Response[]) {
  const urls: string[] = [];
  const logs: string[] = [];
  const sleeps: number[] = [];
  let now = 0;
  const fetch = async (input: string | URL | Request): Promise<Response> => {
    urls.push(String(input));
    const response = responses[Math.min(urls.length, responses.length) - 1];
    if (response === undefined) throw new Error("fakeGame needs at least one response.");
    return response.clone();
  };
  const wait = (timeoutMs: number) =>
    waitForBetPhase(gameUrl, timeoutMs, {
      fetch,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
      log: (line) => logs.push(line),
    });
  return { urls, logs, sleeps, wait };
}

const json = (body: ReturnType<typeof round>): Response => Response.json(body);

describe("parsePlayerArgs", () => {
  it("reads the game URL, command, side, amount and flags", () => {
    assert.deepEqual(
      parsePlayerArgs([
        "http://localhost:8787/",
        "bet",
        "b",
        "1.5",
        "--wallet",
        "second",
        "--timeout",
        "3",
      ]),
      {
        gameUrl: "http://localhost:8787",
        walletId: "second",
        timeoutMs: 180_000,
        command: { name: "bet", side: 1, units: 1_500_000n },
      },
    );
    assert.deepEqual(parsePlayerArgs(["https://game.test", "collect"]).command, {
      name: "collect",
    });
  });

  it("names what is wrong with bad arguments", () => {
    const cases: [string[], RegExp][] = [
      [[], /Missing <game-url>/u],
      [["localhost:8787", "address"], /not an http\(s\) game URL/u],
      [[gameUrl], /Missing <command>/u],
      [[gameUrl, "deposit"], /Unknown command "deposit"/u],
      [[gameUrl, "address", "extra"], /address takes no arguments/u],
      [[gameUrl, "bet", "A"], /bet needs <A\|B> <usdc>/u],
      [[gameUrl, "bet", "C", "1"], /Side must be A or B/u],
      [[gameUrl, "bet", "A", "1.0000001"], /at most 6 decimals/u],
      [[gameUrl, "bet", "A", "0"], /more than 0/u],
      [[gameUrl, "address", "--timeout", "0"], /--timeout must be a positive number/u],
      [[gameUrl, "address", "--wallet", " "], /--wallet needs a wallet id/u],
      [[gameUrl, "address", "--walet", "x"], /Unknown option '--walet'/u],
    ];
    for (const [argv, message] of cases)
      assert.throws(() => parsePlayerArgs(argv), message, argv.join(" "));
  });
});

describe("sides and amounts", () => {
  it("maps side letters to pool sides and back", () => {
    for (const [letter, side] of [
      ["A", 0],
      ["a", 0],
      ["B", 1],
      ["b", 1],
    ] as const) {
      assert.equal(sideIndex(letter), side);
      assert.equal(sideLetter(BigInt(side)), letter.toUpperCase());
    }
  });

  it("converts USDC to base units and back", () => {
    assert.equal(parseUsdc("2"), 2_000_000n);
    assert.equal(parseUsdc("0.03"), 30_000n);
    for (const usdc of ["2", "0.03", "1.5", "0.000001", "12.345678"])
      assert.equal(formatUsdc(parseUsdc(usdc)), usdc);
  });
});

describe("waitForBetPhase", () => {
  it("polls /round until the bet phase has a pool, logging each new phase once", async () => {
    const game = fakeGame([
      json(round("vote")),
      json(round("vote")),
      json(round("countdown")),
      json(round("bet")),
      json(round("bet", "0xpool")),
    ]);
    assert.deepEqual(await game.wait(60_000), {
      round: 7,
      battleId: "battle-7",
      poolId: "0xpool",
      fighters: [3, 9],
    });
    assert.deepEqual(game.urls, Array(5).fill(`${gameUrl}/round`));
    assert.deepEqual(game.sleeps, Array(4).fill(POLL_MS));
    assert.equal(game.logs.length, 3);
  });

  it("times out after the deadline, naming the last phase it saw", async () => {
    const game = fakeGame([json(round("fight"))]);
    const timeoutMs = 5 * POLL_MS;
    await assert.rejects(game.wait(timeoutMs), /Timed out .* last saw round 7 is in fight/u);
    assert.equal(game.urls.length, timeoutMs / POLL_MS + 1);
  });

  it("fails with the HTTP status and body, or the parse error", async () => {
    await assert.rejects(
      fakeGame([new Response("game loop is restarting", { status: 503 })]).wait(60_000),
      /GET http:\/\/game\.test\/round failed: HTTP 503 game loop is restarting/u,
    );
    await assert.rejects(
      fakeGame([Response.json({ round: 7 })]).wait(60_000),
      /returned an unexpected body: .*phase/su,
    );
  });
});
