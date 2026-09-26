import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  type Address,
  type Hex,
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  parseAbi,
} from "viem";
import { type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

import { permissionedResolverAbi } from "../scripts/abis.js";
import { CONTRACTS_V2_COMMIT } from "../scripts/pin.js";
import {
  loadAgentKey,
  loadBootstrapKey,
  loadRosterKey,
} from "../scripts/process-keys.js";
import {
  AGENT_TEXT_KEYS,
  ROSTER_TEXT_KEYS,
  assertWritePermissionGranted,
  buildSetTextSetter,
  grantTextSetterRoles,
} from "../scripts/grant-text-roles.js";
import { deployLocalPermissionedResolver } from "../scripts/local-permissioned-resolver.js";
import {
  classifyInjuriesRewrite,
  rewriteEmptyInjuriesValues,
} from "../scripts/rewrite-empty-injuries.js";

const here = dirname(fileURLToPath(import.meta.url));
const pinDir = join(here, "..", "scripts", "pin");

const BOOTSTRAP_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const ROSTER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const AGENT_KEY =
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;
const THIRD_KEY =
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as const;

const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const textResolverAbi = parseAbi([
  "function text(bytes32 node, string key) view returns (string)",
]);

const bootstrap = privateKeyToAccount(BOOTSTRAP_KEY);
const roster = privateKeyToAccount(ROSTER_KEY);
const agent = privateKeyToAccount(AGENT_KEY);
const third = privateKeyToAccount(THIRD_KEY);

function dnsEncodeName(name: string): Hex {
  const labels = name.split(".");
  const bytes: number[] = [];
  for (const label of labels) {
    const encoded = new TextEncoder().encode(label);
    bytes.push(encoded.length, ...encoded);
  }
  bytes.push(0);
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

async function waitForRpc(url: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_chainId",
          params: [],
        }),
      });
      if (res.ok) {
        return;
      }
    } catch {
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`anvil RPC at ${url} did not become ready`);
}

async function getFreeLocalPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address instanceof Object);
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  return address.port;
}

type ContractPin = { bytecode: Hex; contractsV2Commit: string };

function readContractPin(path: string): ContractPin {
  // SAFETY: every file under scripts/pin/ is a checked-in artifact with exactly this shape.
  return JSON.parse(readFileSync(path, "utf8")) as ContractPin;
}

describe("process key config (unit, no network)", () => {
  const bootstrapEnv = {
    PRIVATE_KEY: BOOTSTRAP_KEY,
    ROSTER_PRIVATE_KEY: ROSTER_KEY,
    AGENT_PRIVATE_KEY: AGENT_KEY,
  };

  it("loads three distinct identities from env", () => {
    const admin = loadBootstrapKey(bootstrapEnv);
    const rosterKey = loadRosterKey(bootstrapEnv);
    const agentKey = loadAgentKey(bootstrapEnv);
    assert.equal(admin.address, bootstrap.address);
    assert.equal(rosterKey.address, roster.address);
    assert.equal(agentKey.address, agent.address);
    assert.notEqual(admin.address, rosterKey.address);
    assert.notEqual(admin.address, agentKey.address);
    assert.notEqual(rosterKey.address, agentKey.address);
  });

  it("fails by name when ROSTER_PRIVATE_KEY is blank", () => {
    assert.throws(
      () => loadRosterKey({ ...bootstrapEnv, ROSTER_PRIVATE_KEY: "  " }),
      /ROSTER_PRIVATE_KEY/u,
    );
  });

  it("fails by name when AGENT_PRIVATE_KEY is missing", () => {
    const { AGENT_PRIVATE_KEY: _, ...rest } = bootstrapEnv;
    assert.throws(() => loadAgentKey(rest), /AGENT_PRIVATE_KEY/u);
  });

  it("rejects roster key when it is the bootstrap address", () => {
    assert.throws(
      () =>
        loadRosterKey({
          PRIVATE_KEY: BOOTSTRAP_KEY,
          ROSTER_PRIVATE_KEY: BOOTSTRAP_KEY,
          AGENT_PRIVATE_KEY: AGENT_KEY,
        }),
      /bootstrap\/admin address/u,
    );
  });

  it("rejects agent key when it is the bootstrap address", () => {
    assert.throws(
      () =>
        loadAgentKey({
          PRIVATE_KEY: BOOTSTRAP_KEY,
          ROSTER_PRIVATE_KEY: ROSTER_KEY,
          AGENT_PRIVATE_KEY: BOOTSTRAP_KEY,
        }),
      /bootstrap\/admin address/u,
    );
  });
});

describe("empty injuries rewrite classifier (unit, no network)", () => {
  it("rewrites exact empty string to []", () => {
    assert.deepEqual(classifyInjuriesRewrite(""), { action: "rewrite", next: "[]" });
  });

  it("skips an already-valid empty array", () => {
    assert.deepEqual(classifyInjuriesRewrite("[]"), { action: "skip" });
  });

  it("stops on a non-array value without coercing", () => {
    assert.deepEqual(classifyInjuriesRewrite("scar on cheek"), {
      action: "stop",
      raw: "scar on cheek",
    });
  });

  it("stops on invalid JSON", () => {
    assert.deepEqual(classifyInjuriesRewrite("["), { action: "stop", raw: "[" });
  });

  it("rewriteEmptyInjuriesValues rewrites only empty strings", () => {
    const result = rewriteEmptyInjuriesValues([
      { label: "a", injuries: "" },
      { label: "b", injuries: "[]" },
      { label: "c", injuries: '["x"]' },
    ]);
    assert.deepEqual(result.rewrites, [{ label: "a", next: "[]" }]);
    assert.deepEqual(result.skipped, ["b", "c"]);
    assert.equal(result.stop, undefined);
  });

  it("rewriteEmptyInjuriesValues stops on the first non-array", () => {
    const result = rewriteEmptyInjuriesValues([
      { label: "a", injuries: "" },
      { label: "b", injuries: "old scar" },
      { label: "c", injuries: "" },
    ]);
    assert.deepEqual(result.rewrites, [{ label: "a", next: "[]" }]);
    assert.deepEqual(result.stop, { label: "b", raw: "old scar" });
  });
});

describe("grant result assertion (unit, no network)", () => {
  const account = "0x0000000000000000000000000000000000000001";

  it("accepts a true grant result", () => {
    assert.doesNotThrow(() =>
      assertWritePermissionGranted(true, "status", account),
    );
  });

  it("rejects a false grant result with grant context", () => {
    assert.throws(
      () => assertWritePermissionGranted(false, "status", account),
      (error: Error) => {
        assert.match(
          error.message,
          /grantSetterRoles\(status, 0x0000000000000000000000000000000000000001\)/u,
        );
        assert.match(error.message, /did not grant write permission/u);
        assert.match(error.message, /result=false/u);
        return true;
      },
    );
  });
});

describe("permissioned resolver roles (local anvil, pinned bytecode)", () => {
  let anvil: ChildProcess | undefined;
  let rpcUrl: string;
  let resolver: Address;
  let publicClient: ReturnType<typeof createPublicClient>;

  before(async () => {
    assert.match(CONTRACTS_V2_COMMIT, /^71a3b733/u);
    const factoryPin = readContractPin(join(pinDir, "VerifiableFactory.json"));
    const implPin = readContractPin(join(pinDir, "PermissionedResolverImpl.json"));
    assert.equal(factoryPin.contractsV2Commit, CONTRACTS_V2_COMMIT);
    assert.equal(implPin.contractsV2Commit, CONTRACTS_V2_COMMIT);

    const port = await getFreeLocalPort();
    rpcUrl = `http://127.0.0.1:${port}`;
    anvil = spawn(
      "anvil",
      ["--port", String(port), "--chain-id", "31337", "--silent"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let anvilErr = "";
    anvil.stderr?.on("data", (chunk: Buffer) => {
      anvilErr += chunk.toString();
    });
    try {
      await waitForRpc(rpcUrl);
    } catch (error) {
      anvil.kill("SIGTERM");
      throw new Error(
        `Failed to start anvil for permission tests: ${error instanceof Error ? error.message : String(error)}. stderr=${anvilErr}. Install Foundry (anvil) — CI uses foundry-toolchain.`,
      );
    }

    publicClient = createPublicClient({
      chain: foundry,
      transport: http(rpcUrl),
    });
    const wallet = createWalletClient({
      account: bootstrap,
      chain: foundry,
      transport: http(rpcUrl),
    });

    resolver = await deployLocalPermissionedResolver({
      publicClient,
      walletClient: wallet,
      bootstrapAddress: bootstrap.address,
    });

    const chainId = await publicClient.getChainId();
    assert.equal(chainId, 31337);
    const head = await publicClient.getBlockNumber({ cacheTime: 0 });
    const txHashes: Hex[] = [];
    for (let n = 0n; n <= head; n += 1n) {
      txHashes.push(...(await publicClient.getBlock({ blockNumber: n })).transactions);
    }
    assert.equal(txHashes.length, 3);
    const [factoryReceipt, implReceipt, deployReceipt] = await Promise.all(
      txHashes.map((hash) => publicClient.getTransactionReceipt({ hash })),
    );
    const deployTx = deployReceipt.transactionHash;
    const blockNumber = deployReceipt.blockNumber;
    assert(factoryReceipt.contractAddress);
    assert(implReceipt.contractAddress);
    const factory = getAddress(factoryReceipt.contractAddress);
    assert(deployReceipt.to);
    assert.equal(getAddress(deployReceipt.to), factory);
    for (const receipt of [factoryReceipt, implReceipt, deployReceipt]) {
      assert.equal(getAddress(receipt.from), bootstrap.address);
    }
    console.log(
      `passFailLocation=${JSON.stringify({
        chainId,
        resolver,
        blockNumber: Number(blockNumber),
        deployTx,
        factory,
        implementation: getAddress(implReceipt.contractAddress),
        bootstrap: bootstrap.address,
        roster: roster.address,
        agent: agent.address,
        third: third.address,
      })}`,
    );

    assert.deepEqual(
      await grantTextSetterRoles({
        publicClient,
        walletClient: wallet,
        resolver,
        account: roster.address,
        keys: [...ROSTER_TEXT_KEYS],
      }),
      [true, true, true],
    );
    assert.deepEqual(
      await grantTextSetterRoles({
        publicClient,
        walletClient: wallet,
        resolver,
        account: agent.address,
        keys: [...AGENT_TEXT_KEYS],
      }),
      [true, true],
    );
  });

  after(() => {
    anvil?.kill("SIGTERM");
  });

  async function setTextAs(
    account: PrivateKeyAccount,
    name: string,
    textKey: string,
    value: string,
  ): Promise<"ok" | "revert"> {
    assert.ok(
      [bootstrap, roster, agent, third].includes(account),
      `setText signer ${account.address} is not one of the four test accounts`,
    );
    const wallet = createWalletClient({
      account,
      chain: foundry,
      transport: http(rpcUrl),
    });
    const dnsName = dnsEncodeName(name);
    const before = await readText(dnsName, textKey);
    try {
      const hash = await wallet.writeContract({
        address: resolver,
        abi: permissionedResolverAbi,
        functionName: "setText",
        args: [dnsName, textKey, value],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error(`setText(${textKey}) mined but reverted: ${hash}`);
      }
      assert.equal(getAddress(receipt.from), account.address);
    } catch (error) {
      const reverted =
        error instanceof BaseError &&
        error.walk((e) => e instanceof ContractFunctionRevertedError) !== null;
      if (!reverted) {
        throw error;
      }
      assert.equal(
        await readText(dnsName, textKey),
        before,
        `${textKey} changed after a reverted setText`,
      );
      return "revert";
    }
    assert.equal(await readText(dnsName, textKey), value, `${textKey} not stored`);
    return "ok";
  }

  async function readText(dnsName: Hex, textKey: string): Promise<string> {
    const encoded = await publicClient.readContract({
      address: resolver,
      abi: permissionedResolverAbi,
      functionName: "resolve",
      args: [
        dnsName,
        encodeFunctionData({
          abi: textResolverAbi,
          functionName: "text",
          args: [ZERO_BYTES32, textKey],
        }),
      ],
    });
    const [text] = decodeAbiParameters([{ type: "string" }], encoded);
    return text;
  }

  it("exposes grantSetterRoles on the pinned ABI used by grants", () => {
    const setter = buildSetTextSetter("status");
    assert.match(setter, /^0xc7279f88/u);
    assert.ok(
      permissionedResolverAbi.some(
        (entry) =>
          entry.type === "function" &&
          "name" in entry &&
          entry.name === "grantSetterRoles",
      ),
    );
    assert.ok(
      !JSON.stringify(permissionedResolverAbi).includes("authorizeTextRoles"),
    );
  });

  it("agent can overwrite status and injuries", async () => {
    const name = "agent-exercise.test.eth";
    assert.equal(await setTextAs(agent, name, "status", "alive"), "ok");
    assert.equal(await setTextAs(agent, name, "status", "dead"), "ok");
    assert.equal(await setTextAs(agent, name, "injuries", "[]"), "ok");
    assert.equal(
      await setTextAs(agent, name, "injuries", '["left arm"]'),
      "ok",
    );
  });

  it("roster can overwrite look, brief, and icon", async () => {
    const name = "roster-exercise.test.eth";
    assert.equal(await setTextAs(roster, name, "look", "tall"), "ok");
    assert.equal(await setTextAs(roster, name, "look", "scarred"), "ok");
    assert.equal(await setTextAs(roster, name, "brief", "lore"), "ok");
    assert.equal(await setTextAs(roster, name, "brief", "later lore"), "ok");
    assert.equal(
      await setTextAs(roster, name, "icon", "https://cdn.example/a.png"),
      "ok",
    );
    assert.equal(
      await setTextAs(roster, name, "icon", "https://cdn.example/b.png"),
      "ok",
    );
  });

  it("bootstrap can set all five card keys", async () => {
    const name = "bootstrap-exercise.test.eth";
    assert.equal(await setTextAs(bootstrap, name, "status", "alive"), "ok");
    assert.equal(await setTextAs(bootstrap, name, "injuries", "[]"), "ok");
    assert.equal(await setTextAs(bootstrap, name, "look", "admin-look"), "ok");
    assert.equal(
      await setTextAs(bootstrap, name, "brief", "admin-brief"),
      "ok",
    );
    assert.equal(
      await setTextAs(
        bootstrap,
        name,
        "icon",
        "https://cdn.example/admin.png",
      ),
      "ok",
    );
  });

  it("agent reverts on roster keys", async () => {
    const name = "agent-deny.test.eth";
    assert.equal(await setTextAs(agent, name, "look", "x"), "revert");
    assert.equal(await setTextAs(agent, name, "brief", "x"), "revert");
    assert.equal(
      await setTextAs(agent, name, "icon", "https://x.example/a.png"),
      "revert",
    );
  });

  it("roster reverts on agent keys", async () => {
    const name = "roster-deny.test.eth";
    assert.equal(await setTextAs(roster, name, "status", "dead"), "revert");
    assert.equal(await setTextAs(roster, name, "injuries", "[]"), "revert");
  });

  it("a third non-bootstrap key reverts on all five text keys", async () => {
    assert.notEqual(third.address, bootstrap.address);
    for (const key of ["status", "injuries", "look", "brief", "icon"]) {
      assert.equal(
        await setTextAs(third, "third-deny.test.eth", key, "x"),
        "revert",
        key,
      );
    }
  });

  it("fight and roster process config reject the bootstrap address", () => {
    assert.throws(
      () =>
        loadAgentKey({
          PRIVATE_KEY: BOOTSTRAP_KEY,
          ROSTER_PRIVATE_KEY: ROSTER_KEY,
          AGENT_PRIVATE_KEY: BOOTSTRAP_KEY,
        }),
      /AGENT_PRIVATE_KEY/u,
    );
    assert.throws(
      () =>
        loadRosterKey({
          PRIVATE_KEY: BOOTSTRAP_KEY,
          ROSTER_PRIVATE_KEY: BOOTSTRAP_KEY,
          AGENT_PRIVATE_KEY: AGENT_KEY,
        }),
      /ROSTER_PRIVATE_KEY/u,
    );
  });
});
