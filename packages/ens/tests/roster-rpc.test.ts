import assert from "node:assert/strict";
import { createServer } from "node:http";
import { type AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import {
  type Address,
  type Hex,
  createPublicClient,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionResult,
  getAddress,
  http,
  isAddressEqual,
  multicall3Abi,
  parseAbi,
} from "viem";
import { sepolia } from "viem/chains";

import { ethRegistryAbi, permissionedResolverAbi, userRegistryAbi } from "../scripts/abis.js";
import { castLabels } from "../scripts/cast-labels.js";
import { readRosterFromChain, withRateLimitRetry } from "../scripts/roster.js";

const ENS_LABEL = "horrortube";
const ETH_REGISTRY = getAddress("0x3333333333333333333333333333333333333333");
const SUBREGISTRY = getAddress("0x1111111111111111111111111111111111111111");
const RESOLVER = getAddress("0x2222222222222222222222222222222222222222");
const OWNER = getAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const textAbi = parseAbi(["function text(bytes32 node, string key) view returns (string)"]);

function firstDnsLabel(dnsName: Hex): string {
  const bytes = Buffer.from(dnsName.slice(2), "hex");
  return bytes.subarray(1, 1 + (bytes[0] ?? 0)).toString("utf8");
}

function answerText(label: string, key: string): string {
  const texts = new Map([
    ["display_name", `${label} Name`],
    ["injury_places", '["head"]'],
    ["injuries", "[]"],
    ["status", "alive"],
    ["icon", `https://cdn.example/${label}.png`],
  ]);
  return texts.get(key) ?? `${label} ${key}`;
}

function answerCall(to: Address, data: Hex): Hex {
  if (isAddressEqual(to, ETH_REGISTRY)) {
    const call = decodeFunctionData({ abi: ethRegistryAbi, data });
    if (call.functionName === "getSubregistry" || call.functionName === "getResolver") {
      return encodeFunctionResult({
        abi: ethRegistryAbi,
        functionName: call.functionName,
        result: call.functionName === "getSubregistry" ? SUBREGISTRY : RESOLVER,
      });
    }
  }
  if (isAddressEqual(to, SUBREGISTRY)) {
    return encodeFunctionResult({
      abi: userRegistryAbi,
      functionName: "getState",
      result: { status: 2, expiry: 0n, latestOwner: OWNER, tokenId: 0n, resource: 0n },
    });
  }
  if (isAddressEqual(to, RESOLVER)) {
    const call = decodeFunctionData({ abi: permissionedResolverAbi, data });
    if (call.functionName === "resolve") {
      const [name, inner] = call.args;
      const key = decodeFunctionData({ abi: textAbi, data: inner }).args[1];
      return encodeFunctionResult({
        abi: permissionedResolverAbi,
        functionName: "resolve",
        result: encodeAbiParameters([{ type: "string" }], [answerText(firstDnsLabel(name), key)]),
      });
    }
  }
  throw new Error(`stub RPC: no call ${data.slice(0, 10)} at ${to}`);
}

function answerEthCall(to: Address, data: Hex): Hex {
  if (!isAddressEqual(to, sepolia.contracts.multicall3.address)) {
    return answerCall(to, data);
  }
  const call = decodeFunctionData({ abi: multicall3Abi, data });
  if (call.functionName !== "aggregate3") {
    throw new Error(`stub RPC: Multicall3 ${call.functionName} is not served`);
  }
  return encodeFunctionResult({
    abi: multicall3Abi,
    functionName: "aggregate3",
    result: call.args[0].map((c) => ({
      success: true,
      returnData: answerCall(c.target, c.callData),
    })),
  });
}

async function startStubRpc(): Promise<{
  url: string;
  reset: (rateLimited: number) => void;
  ethCalls: () => number;
  close: () => Promise<void>;
}> {
  let ethCalls = 0;
  let rateLimited = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      // SAFETY: viem's http transport sends one JSON-RPC object per request (http batch is off).
      const request = JSON.parse(body) as { id: number; method: string; params: unknown[] };
      res.setHeader("content-type", "application/json");
      if (rateLimited > 0) {
        rateLimited -= 1;
        res.statusCode = 429;
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            error: { code: -32005, message: "Rate limit exceeded." },
          }),
        );
        return;
      }
      if (request.method !== "eth_call") {
        res.statusCode = 400;
        res.end(`stub RPC: ${request.method} is not served`);
        return;
      }
      ethCalls += 1;
      // SAFETY: eth_call params are [{ to, data }, block] from viem's call action.
      const { to, data } = request.params[0] as { to: Address; data: Hex };
      res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: answerEthCall(to, data) }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  // SAFETY: a TCP server listening on a port reports an AddressInfo.
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    reset: (count) => {
      ethCalls = 0;
      rateLimited = count;
    },
    ethCalls: () => ethCalls,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

describe("roster reads over JSON-RPC (local stub node)", () => {
  let rpc: Awaited<ReturnType<typeof startStubRpc>>;
  before(async () => {
    rpc = await startStubRpc();
  });
  after(() => rpc.close());

  it("sends the whole cast as one Multicall3 eth_call after the parent read", async () => {
    rpc.reset(0);
    const roster = await readRosterFromChain(ENS_LABEL, rpc.url, ETH_REGISTRY);

    assert.deepEqual(
      roster.sheets.map((s) => [s.label, s.owner, s.display_name, s.icon]),
      castLabels().map((l) => [l, OWNER, `${l} Name`, `https://cdn.example/${l}.png`]),
    );
    assert.equal(rpc.ethCalls(), 2);
  });

  it("backs off and retries when the RPC answers HTTP 429", async () => {
    rpc.reset(2);
    const client = createPublicClient({
      chain: sepolia,
      transport: http(rpc.url, { retryCount: 0 }),
    });
    const waits: number[] = [];

    const subregistry = await withRateLimitRetry(
      "getSubregistry",
      () =>
        client.readContract({
          address: ETH_REGISTRY,
          abi: ethRegistryAbi,
          functionName: "getSubregistry",
          args: [ENS_LABEL],
        }),
      {
        sleep: async (ms) => {
          waits.push(ms);
        },
        initialBackoffMs: 1,
      },
    );

    assert.equal(subregistry, SUBREGISTRY);
    assert.equal(waits.length, 2);
  });
});
