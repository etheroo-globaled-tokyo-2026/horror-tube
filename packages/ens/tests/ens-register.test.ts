import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { getAddress } from "viem";

import {
  BANNED_OLD_ADDRESSES,
  PIN_DEPLOYED_AT,
  parsePinAddressesFromMarkdown,
  rejectBannedAddress,
} from "../scripts/pin.js";
import {
  type CommitState,
  parseCommand,
  parseCommitState,
  parseDuration,
  parseLabel,
  parsePaymentChoice,
  readEnv,
  requiredEnv,
} from "../scripts/register-eth-label.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const goodPinMarkdown = readFileSync(
  join(repoRoot, "scripts", "pin", "sepolia-addresses.md"),
  "utf8",
);

describe("pin loader (unit, no network)", () => {
  it("loads the checked-in pin address table", () => {
    const pin = parsePinAddressesFromMarkdown(goodPinMarkdown);
    assert.equal(pin.ETHRegistrar, getAddress("0xabe76f6c8dfced81aa5a2bb8034202a7136b94ca"));
  });

  it("rejects a mismatched Deployed at timestamp", () => {
    const mismatched = goodPinMarkdown.replace(PIN_DEPLOYED_AT, "2000-01-01T00:00:00.000Z");
    assert.throws(() => parsePinAddressesFromMarkdown(mismatched), /DISAGREEMENT/u);
  });

  it("rejects banned older registrar addresses in the markdown", () => {
    for (const banned of BANNED_OLD_ADDRESSES) {
      const poisoned = goodPinMarkdown.replace(
        "0xabe76f6c8dfced81aa5a2bb8034202a7136b94ca",
        banned,
      );
      assert.throws(() => parsePinAddressesFromMarkdown(poisoned), /banned/u);
    }
  });

  it("rejectBannedAddress rejects banned older registrar addresses", () => {
    for (const banned of BANNED_OLD_ADDRESSES) {
      assert.throws(() => rejectBannedAddress("ETHRegistrar", getAddress(banned)), /banned/u);
    }
  });
});

describe("label parser (unit, no network)", () => {
  it("rejects blank ENS_LABEL", () => {
    assert.throws(() => parseLabel(undefined), /ENS_LABEL/u);
    assert.throws(() => parseLabel(""), /ENS_LABEL/u);
    assert.throws(() => parseLabel("   "), /ENS_LABEL/u);
  });

  it("rejects a full name like foo.eth", () => {
    assert.throws(() => parseLabel("foo.eth"), /ENS_LABEL/u);
  });

  it("rejects uppercase", () => {
    assert.throws(() => parseLabel("Foo"), /ENS_LABEL/u);
    assert.throws(() => parseLabel("HORRORTUBE"), /ENS_LABEL/u);
  });

  it("accepts a lowercase label", () => {
    assert.equal(parseLabel("horrortube"), "horrortube");
  });
});

describe("required env and command (unit, no network)", () => {
  it("missing or blank SEPOLIA_RPC_URL fails and names the variable", () => {
    assert.throws(() => requiredEnv("SEPOLIA_RPC_URL", {}), /SEPOLIA_RPC_URL/u);
    assert.throws(
      () => requiredEnv("SEPOLIA_RPC_URL", { SEPOLIA_RPC_URL: "  " }),
      /SEPOLIA_RPC_URL/u,
    );
  });

  it("missing or blank PAYMENT_TOKEN fails and names the variable", () => {
    assert.throws(() => requiredEnv("PAYMENT_TOKEN", {}), /PAYMENT_TOKEN/u);
    assert.throws(() => requiredEnv("PAYMENT_TOKEN", { PAYMENT_TOKEN: "" }), /PAYMENT_TOKEN/u);
    assert.throws(() => parsePaymentChoice("ETH"), /PAYMENT_TOKEN/u);
  });

  it("missing or blank DURATION_SECONDS fails and names the variable", () => {
    assert.throws(() => requiredEnv("DURATION_SECONDS", {}), /DURATION_SECONDS/u);
    assert.throws(
      () => requiredEnv("DURATION_SECONDS", { DURATION_SECONDS: " " }),
      /DURATION_SECONDS/u,
    );
    assert.throws(() => parseDuration("not-a-number"), /DURATION_SECONDS/u);
  });

  it("check needs only SEPOLIA_RPC_URL", () => {
    const config = readEnv(["tsx", "script.ts", "check"], {
      SEPOLIA_RPC_URL: "http://rpc.invalid",
    });
    assert.equal(config.write, null);
  });

  it("write commands fail by name without PRIVATE_KEY", () => {
    assert.throws(
      () =>
        readEnv(["tsx", "script.ts", "full"], {
          SEPOLIA_RPC_URL: "http://rpc.invalid",
          PAYMENT_TOKEN: "MockDAI",
          DURATION_SECONDS: "2419200",
        }),
      /PRIVATE_KEY/u,
    );
  });

  it("missing or blank command fails and names the requirement", () => {
    assert.throws(() => parseCommand(["tsx", "script.ts"]), /Command/u);
    assert.throws(() => parseCommand(["tsx", "script.ts", "  "]), /Command/u);
  });
});

describe("commit-state label mismatch (unit, no network)", () => {
  it("fails when the label in the file does not match ENS_LABEL", () => {
    const state: CommitState = {
      label: "otherlabel",
      owner: getAddress("0x1111111111111111111111111111111111111111"),
      secret: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      subregistry: getAddress("0x0000000000000000000000000000000000000000"),
      resolver: getAddress("0x0000000000000000000000000000000000000000"),
      duration: "2419200",
      referrer: "0x0000000000000000000000000000000000000000000000000000000000000000",
      paymentToken: getAddress("0x2222222222222222222222222222222222222222"),
      commitment: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      commitTxHash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      commitTime: 1,
    };
    assert.throws(
      () => parseCommitState(state, "expectedlabel", "/tmp/fake-commit-state.json"),
      /expectedlabel/u,
    );
  });
});

function missingEnv(names: readonly string[]): string[] {
  return names.filter((name) => (process.env[name] ?? "").trim() === "");
}

function assertNoKeyValueLeak(output: string): void {
  const key = process.env.PRIVATE_KEY?.trim().replace(/^0x/u, "").toLowerCase();
  if (key === undefined || key === "") {
    return;
  }
  assert.ok(!output.toLowerCase().includes(key), "output contains the PRIVATE_KEY value");
}

function parseStatus(stdout: string): string {
  const match = /"getStatus": "([A-Z_()0-9]+)"/u.exec(stdout);
  assert.ok(match !== null, `expected getStatus in stdout:\n${stdout}`);
  return match[1];
}

function runRegisterScript(
  command: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");
    const child = spawn(tsxBin, [join(repoRoot, "scripts", "register-eth-label.ts"), command], {
      cwd: repoRoot,
      env: process.env,
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
}

describe("smoke: Sepolia check only", () => {
  it("returns AVAILABLE or REGISTERED for ENS_LABEL and prints the pin commit", async (t) => {
    const missing = missingEnv(["ENS_LABEL", "SEPOLIA_RPC_URL"]);
    if (missing.length > 0) {
      t.skip(`Smoke needs ${missing.join(", ")}. Runs Sepolia check only.`);
      return;
    }

    const result = await runRegisterScript("check");
    assert.equal(result.code, 0, `check failed:\nstdout=${result.stdout}\nstderr=${result.stderr}`);
    assertNoKeyValueLeak(result.stdout + result.stderr);
    assert.match(result.stdout, /71a3b7339dbc55ab47667abdfe8303bac4f4c24e/u);
    const status = parseStatus(result.stdout);
    assert.ok(
      status === "AVAILABLE" || status === "REGISTERED",
      `expected AVAILABLE or REGISTERED, got ${status}`,
    );
    console.log(`smoke ${process.env.ENS_LABEL}.eth status=${status}`);
  });
});

describe("e2e: commit, wait, approve, register, check REGISTERED", () => {
  it("registers ENS_LABEL on Sepolia when ENS_E2E=1 and secrets are set", async (t) => {
    if (process.env.ENS_E2E !== "1") {
      t.skip("E2E needs ENS_E2E=1. Leaves the name registered.");
      return;
    }
    const missing = missingEnv([
      "ENS_LABEL",
      "SEPOLIA_RPC_URL",
      "PAYMENT_TOKEN",
      "DURATION_SECONDS",
      "PRIVATE_KEY",
    ]);
    assert.deepEqual(missing, [], `ENS_E2E=1 but ${missing.join(", ")} not set`);

    const full = await runRegisterScript("full");
    assert.equal(full.code, 0, `full failed:\nstdout=${full.stdout}\nstderr=${full.stderr}`);
    assertNoKeyValueLeak(full.stdout + full.stderr);

    const check = await runRegisterScript("check");
    assert.equal(
      check.code,
      0,
      `post-register check failed:\nstdout=${check.stdout}\nstderr=${check.stderr}`,
    );
    assertNoKeyValueLeak(check.stdout + check.stderr);
    assert.equal(parseStatus(check.stdout), "REGISTERED");
  });
});
