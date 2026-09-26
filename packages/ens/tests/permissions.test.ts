import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  type Address,
  type Hex,
  createPublicClient,
  createWalletClient,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
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
      // retry
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`anvil RPC at ${url} did not become ready`);
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

describe("permissioned resolver roles (local anvil, pinned bytecode)", () => {
  let anvil: ChildProcess | undefined;
  let rpcUrl: string;
  let resolver: Address;
  let publicClient: ReturnType<typeof createPublicClient>;

  before(async () => {
    assert.match(CONTRACTS_V2_COMMIT, /^71a3b733/u);
    const factoryPin = JSON.parse(
      readFileSync(join(pinDir, "VerifiableFactory.json"), "utf8"),
    ) as { bytecode: Hex; contractsV2Commit: string };
    const implPin = JSON.parse(
      readFileSync(join(pinDir, "PermissionedResolverImpl.json"), "utf8"),
    ) as { bytecode: Hex; contractsV2Commit: string };
    assert.equal(factoryPin.contractsV2Commit, CONTRACTS_V2_COMMIT);
    assert.equal(implPin.contractsV2Commit, CONTRACTS_V2_COMMIT);

    const port = 18545;
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

    await grantTextSetterRoles({
      publicClient,
      walletClient: wallet,
      resolver,
      account: agent.address,
      keys: [...AGENT_TEXT_KEYS],
    });
    await grantTextSetterRoles({
      publicClient,
      walletClient: wallet,
      resolver,
      account: roster.address,
      keys: [...ROSTER_TEXT_KEYS],
    });
  });

  after(() => {
    anvil?.kill("SIGTERM");
  });

  async function setTextAs(
    key: Hex,
    textKey: string,
    value: string,
  ): Promise<"ok" | "revert"> {
    const account = privateKeyToAccount(key);
    const wallet = createWalletClient({
      account,
      chain: foundry,
      transport: http(rpcUrl),
    });
    const dnsName = dnsEncodeName("fighter.test.eth");
    try {
      const hash = await wallet.writeContract({
        address: resolver,
        abi: permissionedResolverAbi,
        functionName: "setText",
        args: [dnsName, textKey, value],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return receipt.status === "success" ? "ok" : "revert";
    } catch {
      return "revert";
    }
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

  it("agent can set status and injuries only", async () => {
    assert.equal(await setTextAs(AGENT_KEY, "status", "alive"), "ok");
    assert.equal(await setTextAs(AGENT_KEY, "injuries", "[]"), "ok");
    assert.equal(await setTextAs(AGENT_KEY, "look", "x"), "revert");
    assert.equal(await setTextAs(AGENT_KEY, "brief", "x"), "revert");
    assert.equal(await setTextAs(AGENT_KEY, "icon", "https://x.example/a.png"), "revert");
  });

  it("roster can set look, brief, and icon only", async () => {
    assert.equal(await setTextAs(ROSTER_KEY, "look", "body"), "ok");
    assert.equal(await setTextAs(ROSTER_KEY, "brief", "lore"), "ok");
    assert.equal(await setTextAs(ROSTER_KEY, "icon", "https://x.example/a.png"), "ok");
    assert.equal(await setTextAs(ROSTER_KEY, "status", "dead"), "revert");
    assert.equal(await setTextAs(ROSTER_KEY, "injuries", "[]"), "revert");
  });

  it("a third non-bootstrap key reverts on all five text keys", async () => {
    assert.notEqual(third.address, bootstrap.address);
    for (const key of ["status", "injuries", "look", "brief", "icon"]) {
      assert.equal(await setTextAs(THIRD_KEY, key, "x"), "revert", key);
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
