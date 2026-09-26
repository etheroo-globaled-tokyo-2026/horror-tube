import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, type Address, type Hex, type PublicClient } from "viem";

import { userRegistryAbi } from "../scripts/abis.js";
import {
  decodeRegisterLabel,
  findContractBirthBlock,
  findTransferLogStartBlock,
  isPrunedHistoricalStateError,
  renderDashboardHtml,
  type CharacterSheet,
} from "../scripts/dashboard.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("dashboard register calldata (unit, no network)", () => {
  it("decoding a register calldata returns the label", () => {
    const input = encodeFunctionData({
      abi: userRegistryAbi,
      functionName: "register",
      args: [
        "pinhead",
        "0x1111111111111111111111111111111111111111",
        "0x0000000000000000000000000000000000000000",
        "0x2222222222222222222222222222222222222222",
        1n,
        1234567890n,
      ],
    });
    assert.equal(decodeRegisterLabel(input), "pinhead");
  });

  it("a non-register selector is ignored", () => {
    const other: Hex =
      "0xabcdef010000000000000000000000000000000000000000000000000000000000000000";
    assert.equal(decodeRegisterLabel(other), null);
  });
});

describe("dashboard HTML (unit, no network)", () => {
  it("rendered HTML escapes < and quotes in look/brief", () => {
    const sheet: CharacterSheet = {
      label: "pinhead",
      name: "pinhead.horrortube.eth",
      look: `<script>alert("x")</script>`,
      brief: `He said "boo" & left`,
      injuries: "",
      status: "alive",
      icon: "",
    };
    const html = renderDashboardHtml("horrortube.eth", [sheet]);
    assert.equal(html.includes("<script>"), false);
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(html.includes("&quot;boo&quot;"));
    assert.ok(html.includes("&amp; left"));
  });
});

describe("dashboard env (unit, no network)", () => {
  it("spawning with DASHBOARD_PORT empty exits and names the variable", async () => {
    const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");
    const result = await new Promise<{
      code: number | null;
      stdout: string;
      stderr: string;
    }>((resolvePromise, rejectPromise) => {
      const child = spawn(tsxBin, [join(repoRoot, "scripts", "dashboard.ts")], {
        cwd: repoRoot,
        env: {
          ...process.env,
          ENS_LABEL: "horrortube",
          SEPOLIA_RPC_URL: "http://127.0.0.1:1",
          DASHBOARD_PORT: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", rejectPromise);
      child.on("close", (code) => {
        resolvePromise({ code, stdout, stderr });
      });
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /DASHBOARD_PORT/u);
  });
});

const SUBREGISTRY = "0x0000000000000000000000000000000000000001" as Address;

function discoveryClient(behavior: {
  latest: bigint;
  codeFrom?: bigint;
  failBelow?: bigint;
  failMessage?: string;
  logsInRange?: { from: bigint; to: bigint; hash: Hex }[];
}): PublicClient {
  return {
    async getBlockNumber() {
      return behavior.latest;
    },
    async getBytecode(args: { blockNumber?: bigint }) {
      const block = args.blockNumber ?? behavior.latest;
      if (behavior.failBelow !== undefined && block < behavior.failBelow) {
        throw new Error(behavior.failMessage ?? "historical state is not available");
      }
      if (behavior.codeFrom !== undefined && block >= behavior.codeFrom) {
        return "0x1234" as Hex;
      }
      return "0x";
    },
    async getLogs(args: { fromBlock?: bigint; toBlock?: bigint }) {
      const from = args.fromBlock ?? 0n;
      const to = args.toBlock ?? behavior.latest;
      return (behavior.logsInRange ?? [])
        .filter((log) => log.from <= to && log.to >= from)
        .map((log) => ({ transactionHash: log.hash }));
    },
  } as PublicClient;
}

describe("pruned historical state (unit, no network)", () => {
  it("recognizes pruned-state errors and rejects unrelated RPC failures", () => {
    assert.equal(
      isPrunedHistoricalStateError("missing trie node: historical state is not available"),
      true,
    );
    assert.equal(isPrunedHistoricalStateError("state pruned"), true);
    assert.equal(isPrunedHistoricalStateError("history has been pruned"), true);
    assert.equal(isPrunedHistoricalStateError("RPC method is not available"), false);
    assert.equal(isPrunedHistoricalStateError("Unknown block 10"), false);
  });

  it("finds the birth block when historical bytecode reads succeed", async () => {
    const birth = await findContractBirthBlock(
      discoveryClient({ latest: 100n, codeFrom: 40n }),
      SUBREGISTRY,
    );
    assert.equal(birth, 40n);
    const start = await findTransferLogStartBlock(
      discoveryClient({ latest: 100n, codeFrom: 40n }),
      SUBREGISTRY,
    );
    assert.equal(start, 40n);
  });

  it("propagates a getBytecode failure that is not pruned state", async () => {
    await assert.rejects(
      () =>
        findContractBirthBlock(
          discoveryClient({
            latest: 100n,
            failBelow: 101n,
            failMessage: "RPC method is not available",
          }),
          SUBREGISTRY,
        ),
      /RPC method is not available/u,
    );
  });

  it("walks TransferSingle logs backward when history is pruned", async () => {
    const hash =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex;
    const start = await findTransferLogStartBlock(
      discoveryClient({
        latest: 50000n,
        codeFrom: 50000n,
        failBelow: 50000n,
        logsInRange: [{ from: 10000n, to: 49999n, hash }],
      }),
      SUBREGISTRY,
    );
    assert.equal(start, 10000n);
  });
});
