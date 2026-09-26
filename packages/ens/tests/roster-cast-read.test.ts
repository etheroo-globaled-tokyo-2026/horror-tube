import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type Address,
  type Hex,
  decodeFunctionData,
  encodeAbiParameters,
  getAddress,
  keccak256,
  parseAbi,
  stringToBytes,
  toHex,
} from "viem";

import { castLabels, labelsFromCastEntries } from "../scripts/cast-labels.js";
import { loadCharacterSheets, readRosterFromChain } from "../scripts/roster.js";

const SUBREGISTRY = getAddress("0x1111111111111111111111111111111111111111");
const RESOLVER = getAddress("0x2222222222222222222222222222222222222222");
const ETH_REGISTRY = getAddress("0x3333333333333333333333333333333333333333");
const OWNER_A = getAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const OWNER_B = getAddress("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

const textResolverAbi = parseAbi([
  "function text(bytes32 node, string key) view returns (string)",
]);

function labelId(label: string): bigint {
  return BigInt(keccak256(stringToBytes(label)));
}

function dnsEncodeName(name: string): Hex {
  const labels = name.split(".");
  const bytes: number[] = [];
  for (const label of labels) {
    const encoded = new TextEncoder().encode(label);
    bytes.push(encoded.length);
    bytes.push(...encoded);
  }
  bytes.push(0);
  return toHex(Uint8Array.from(bytes));
}

function encodeText(value: string): Hex {
  return encodeAbiParameters([{ type: "string" }], [value]);
}

type FakeClient = {
  readContract: (args: {
    address: Address;
    functionName: string;
    args?: readonly unknown[];
  }) => Promise<unknown>;
  getLogs: () => Promise<unknown>;
  getTransaction: () => Promise<unknown>;
  getBlockNumber: () => Promise<bigint>;
};

function makeSheetFake(options: {
  labels: readonly string[];
  ensLabel: string;
  owners: ReadonlyMap<string, Address>;
  texts: ReadonlyMap<string, ReadonlyMap<string, string>>;
  trackDiscovery?: { getLogs: number; getTransaction: number; getBlockNumber: number };
  failGetState?: ReadonlySet<string>;
  statusByLabel?: ReadonlyMap<string, number>;
}): { client: FakeClient; maxInFlight: () => number } {
  let inFlight = 0;
  let maxInFlight = 0;
  const discovery = options.trackDiscovery ?? {
    getLogs: 0,
    getTransaction: 0,
    getBlockNumber: 0,
  };
  const idToLabel = new Map(options.labels.map((label) => [labelId(label), label]));
  const dnsToLabel = new Map(
    options.labels.map((label) => [
      dnsEncodeName(`${label}.${options.ensLabel}.eth`).toLowerCase(),
      label,
    ]),
  );

  const client: FakeClient = {
    async readContract(args) {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      try {
        if (args.functionName === "getSubregistry") {
          return SUBREGISTRY;
        }
        if (args.functionName === "getResolver") {
          return RESOLVER;
        }
        if (args.functionName === "getState") {
          const id = args.args?.[0] as bigint;
          const label = idToLabel.get(id);
          if (label === undefined) {
            throw new Error(`unexpected getState id ${String(id)}`);
          }
          if (options.failGetState?.has(label)) {
            throw new Error(`stub getState failed for ${label}`);
          }
          const owner = options.owners.get(label);
          if (owner === undefined) {
            throw new Error(`no owner stub for ${label}`);
          }
          return {
            status: options.statusByLabel?.get(label) ?? 2,
            expiry: 0n,
            latestOwner: owner,
            tokenId: 0n,
            resource: 0n,
          };
        }
        if (args.functionName === "resolve") {
          const dnsName = String(args.args?.[0]).toLowerCase() as Hex;
          const data = args.args?.[1] as Hex;
          const label = dnsToLabel.get(dnsName);
          if (label === undefined) {
            throw new Error(`unexpected resolve dnsName ${dnsName}`);
          }
          const decoded = decodeFunctionData({ abi: textResolverAbi, data });
          if (decoded.functionName !== "text") {
            throw new Error(`unexpected resolve selector ${decoded.functionName}`);
          }
          const key = decoded.args[1] as string;
          const value = options.texts.get(label)?.get(key);
          if (value === undefined) {
            throw new Error(`no text stub for ${label}.${key}`);
          }
          return encodeText(value);
        }
        throw new Error(`unexpected readContract ${args.functionName}`);
      } finally {
        inFlight -= 1;
      }
    },
    async getLogs() {
      discovery.getLogs += 1;
      throw new Error("getLogs must not be called on the cast roster path");
    },
    async getTransaction() {
      discovery.getTransaction += 1;
      throw new Error("getTransaction must not be called on the cast roster path");
    },
    async getBlockNumber() {
      discovery.getBlockNumber += 1;
      throw new Error("getBlockNumber must not be called on the cast roster path");
    },
  };

  return { client, maxInFlight: () => maxInFlight };
}

function stubTexts(label: string): Map<string, string> {
  return new Map([
    ["display_name", `${label} Name`],
    ["look", `${label} look`],
    ["brief", `${label} brief`],
    ["injury_places", '["head"]'],
    ["injuries", "[]"],
    ["status", "alive"],
    ["icon", `https://cdn.example/${label}.png`],
  ]);
}

describe("cast labels (unit, no network)", () => {
  it("fails when entry count and label count differ", () => {
    assert.throws(
      () =>
        labelsFromCastEntries([
          { label: "jason", source: "https://example.com/a" },
          { source: "https://example.com/b" },
        ]),
      /cast entry count \(2\) and label count \(1\) differ/,
    );
  });

  it("fails when a label is repeated", () => {
    assert.throws(
      () =>
        labelsFromCastEntries([
          { label: "jason", source: "https://example.com/a" },
          { label: "jason", source: "https://example.com/b" },
        ]),
      /cast labels: duplicate label jason/,
    );
  });
});

describe("loadCharacterSheets concurrency (unit, no network)", () => {
  it("starts every getState and text resolve before awaiting (2 labels => max in-flight 16)", async () => {
    const labels = ["alpha", "beta"] as const;
    const ensLabel = "horrortube";
    const { client, maxInFlight } = makeSheetFake({
      labels,
      ensLabel,
      owners: new Map([
        ["alpha", OWNER_A],
        ["beta", OWNER_B],
      ]),
      texts: new Map([
        ["alpha", stubTexts("alpha")],
        ["beta", stubTexts("beta")],
      ]),
    });

    const sheets = await loadCharacterSheets(
      client as never,
      ensLabel,
      SUBREGISTRY,
      RESOLVER,
      labels,
    );

    assert.equal(maxInFlight(), 16);
    assert.equal(sheets.length, 2);
    assert.equal(sheets[0]!.label, "alpha");
    assert.equal(sheets[0]!.owner, OWNER_A);
    assert.equal(sheets[0]!.display_name, "alpha Name");
    assert.equal(sheets[0]!.look, "alpha look");
    assert.equal(sheets[0]!.brief, "alpha brief");
    assert.deepEqual(sheets[0]!.injury_places, ["head"]);
    assert.deepEqual(sheets[0]!.injuries, []);
    assert.equal(sheets[0]!.status, "alive");
    assert.equal(sheets[0]!.icon, "https://cdn.example/alpha.png");
    assert.equal(sheets[1]!.label, "beta");
    assert.equal(sheets[1]!.owner, OWNER_B);
    assert.equal(sheets[1]!.display_name, "beta Name");
  });

  it("names an unregistered label instead of returning its owner", async () => {
    const labels = ["alpha"] as const;
    const ensLabel = "horrortube";
    const { client } = makeSheetFake({
      labels,
      ensLabel,
      owners: new Map([["alpha", OWNER_A]]),
      texts: new Map([["alpha", stubTexts("alpha")]]),
      statusByLabel: new Map([["alpha", 0]]),
    });

    await assert.rejects(
      () => loadCharacterSheets(client as never, ensLabel, SUBREGISTRY, RESOLVER, labels),
      /UserRegistry\.getState\(alpha\) status 0 is not registered under horrortube\.eth/,
    );
  });

  it("rejects with the failed label and does not leave the other reads unhandled", async () => {
    const labels = ["alpha", "beta"] as const;
    const ensLabel = "horrortube";
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", onRejection);
    try {
      const { client } = makeSheetFake({
        labels,
        ensLabel,
        owners: new Map([
          ["alpha", OWNER_A],
          ["beta", OWNER_B],
        ]),
        texts: new Map([
          ["alpha", stubTexts("alpha")],
          ["beta", stubTexts("beta")],
        ]),
        failGetState: new Set(["alpha", "beta"]),
      });

      await assert.rejects(
        () => loadCharacterSheets(client as never, ensLabel, SUBREGISTRY, RESOLVER, labels),
        /UserRegistry\.getState\((alpha|beta)\) failed/,
      );
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      assert.deepEqual(rejections, []);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });
});

describe("readRosterFromChain (unit, no network)", () => {
  it("reads cast labels and does not call getLogs or getTransaction", async () => {
    const labels = castLabels();
    const ensLabel = "horrortube";
    const discovery = { getLogs: 0, getTransaction: 0, getBlockNumber: 0 };
    const texts = new Map(labels.map((label) => [label, stubTexts(label)]));
    const owners = new Map(labels.map((label) => [label, OWNER_A] as const));
    const { client } = makeSheetFake({
      labels,
      ensLabel,
      owners,
      texts,
      trackDiscovery: discovery,
    });

    const roster = await readRosterFromChain(
      ensLabel,
      "http://rpc.invalid",
      ETH_REGISTRY,
      client as never,
    );

    assert.equal(discovery.getLogs, 0);
    assert.equal(discovery.getTransaction, 0);
    assert.equal(discovery.getBlockNumber, 0);
    assert.equal(roster.parentName, "horrortube.eth");
    assert.deepEqual(
      roster.sheets.map((sheet) => sheet.label),
      labels,
    );
  });
});
