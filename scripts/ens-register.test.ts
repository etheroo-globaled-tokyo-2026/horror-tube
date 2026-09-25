/*
 * WARNING: ENS e2e leaves the .eth name registered. ETHRegistrar at this pin has no safe unregister for a second-level .eth name. Tear-down is out of scope.
 *
 * Unit tests: no network. Always run.
 * Smoke: Sepolia `check` only. Skips unless ENS_LABEL and SEPOLIA_RPC_URL are set.
 *   Does not mint or register. Never prints PRIVATE_KEY.
 * E2E: gated behind ENS_E2E=1 plus ENS_LABEL, SEPOLIA_RPC_URL, PAYMENT_TOKEN,
 *   DURATION_SECONDS, PRIVATE_KEY. Flow: commit, wait MIN_COMMITMENT_AGE, approve,
 *   register, check REGISTERED. Do not run in normal test/CI. Label comes from ENS_LABEL.
 */

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
} from "./pin.js";
import {
  type CommitState,
  parseCommand,
  parseCommitState,
  parseDuration,
  parseLabel,
  parsePaymentChoice,
  requiredEnv,
} from "./register-eth-label.js";

const here = dirname(fileURLToPath(import.meta.url));
const goodPinMarkdown = readFileSync(
  join(here, "pin", "sepolia-addresses.md"),
  "utf8",
);

function assertThrowsNamed(run: () => void, named: string): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof Error, `expected Error mentioning ${named}`);
  assert.match(caught.message, new RegExp(named, "u"));
}

describe("pin loader (unit, no network)", () => {
  it("loads the checked-in pin address table", () => {
    const pin = parsePinAddressesFromMarkdown(goodPinMarkdown);
    assert.equal(
      pin.ETHRegistrar,
      getAddress("0xabe76f6c8dfced81aa5a2bb8034202a7136b94ca"),
    );
  });

  it("rejects a mismatched Deployed at timestamp", () => {
    const mismatched = goodPinMarkdown.replace(
      PIN_DEPLOYED_AT,
      "2000-01-01T00:00:00.000Z",
    );
    assertThrowsNamed(
      () => parsePinAddressesFromMarkdown(mismatched),
      "DISAGREEMENT",
    );
  });

  it("rejects banned older registrar addresses in the markdown", () => {
    for (const banned of BANNED_OLD_ADDRESSES) {
      const poisoned = goodPinMarkdown.replace(
        "0xabe76f6c8dfced81aa5a2bb8034202a7136b94ca",
        banned,
      );
      assertThrowsNamed(
        () => parsePinAddressesFromMarkdown(poisoned),
        "banned",
      );
    }
  });

  it("rejectBannedAddress rejects banned older registrar addresses", () => {
    for (const banned of BANNED_OLD_ADDRESSES) {
      assertThrowsNamed(
        () => rejectBannedAddress("ETHRegistrar", getAddress(banned)),
        "banned",
      );
    }
  });
});

describe("label parser (unit, no network)", () => {
  it("rejects blank ENS_LABEL", () => {
    assertThrowsNamed(() => parseLabel(undefined), "ENS_LABEL");
    assertThrowsNamed(() => parseLabel(""), "ENS_LABEL");
    assertThrowsNamed(() => parseLabel("   "), "ENS_LABEL");
  });

  it("rejects a full name like foo.eth", () => {
    assertThrowsNamed(() => parseLabel("foo.eth"), "ENS_LABEL");
  });

  it("rejects uppercase", () => {
    assertThrowsNamed(() => parseLabel("Foo"), "ENS_LABEL");
    assertThrowsNamed(() => parseLabel("HORRORTUBE"), "ENS_LABEL");
  });

  it("accepts a lowercase label", () => {
    assert.equal(parseLabel("horrortube"), "horrortube");
  });
});

describe("required env and command (unit, no network)", () => {
  it("missing or blank SEPOLIA_RPC_URL fails and names the variable", () => {
    assertThrowsNamed(
      () => requiredEnv("SEPOLIA_RPC_URL", {}),
      "SEPOLIA_RPC_URL",
    );
    assertThrowsNamed(
      () => requiredEnv("SEPOLIA_RPC_URL", { SEPOLIA_RPC_URL: "  " }),
      "SEPOLIA_RPC_URL",
    );
  });

  it("missing or blank PAYMENT_TOKEN fails and names the variable", () => {
    assertThrowsNamed(() => requiredEnv("PAYMENT_TOKEN", {}), "PAYMENT_TOKEN");
    assertThrowsNamed(
      () => requiredEnv("PAYMENT_TOKEN", { PAYMENT_TOKEN: "" }),
      "PAYMENT_TOKEN",
    );
    assertThrowsNamed(() => parsePaymentChoice("ETH"), "PAYMENT_TOKEN");
  });

  it("missing or blank DURATION_SECONDS fails and names the variable", () => {
    assertThrowsNamed(
      () => requiredEnv("DURATION_SECONDS", {}),
      "DURATION_SECONDS",
    );
    assertThrowsNamed(
      () => requiredEnv("DURATION_SECONDS", { DURATION_SECONDS: " " }),
      "DURATION_SECONDS",
    );
    assertThrowsNamed(() => parseDuration("not-a-number"), "DURATION_SECONDS");
  });

  it("missing or blank command fails and names the requirement", () => {
    assertThrowsNamed(() => parseCommand(["tsx", "script.ts"]), "Command");
    assertThrowsNamed(
      () => parseCommand(["tsx", "script.ts", "  "]),
      "Command",
    );
  });
});

describe("commit-state label mismatch (unit, no network)", () => {
  it("fails when the label in the file does not match ENS_LABEL", () => {
    const state: CommitState = {
      label: "otherlabel",
      owner: getAddress("0x1111111111111111111111111111111111111111"),
      secret:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      subregistry: getAddress("0x0000000000000000000000000000000000000000"),
      resolver: getAddress("0x0000000000000000000000000000000000000000"),
      duration: "2419200",
      referrer:
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      paymentToken: getAddress("0x2222222222222222222222222222222222222222"),
      commitment:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      commitTxHash:
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      commitTime: 1,
    };
    assertThrowsNamed(
      () =>
        parseCommitState(state, "expectedlabel", "/tmp/fake-commit-state.json"),
      "expectedlabel",
    );
  });
});

function envPresent(name: string): boolean {
  const value = process.env[name];
  return value !== undefined && value.trim() !== "";
}

function runRegisterScript(
  command: string,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const tsxBin = join(here, "..", "node_modules", ".bin", "tsx");
    const child = spawn(
      tsxBin,
      [join(here, "register-eth-label.ts"), command],
      {
        cwd: join(here, ".."),
        env: env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
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
    if (!envPresent("ENS_LABEL") || !envPresent("SEPOLIA_RPC_URL")) {
      t.skip(
        "Skip unless ENS_LABEL and SEPOLIA_RPC_URL are set. Smoke hits Sepolia check only; does not mint or register.",
      );
      return;
    }

    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.PRIVATE_KEY;

    const result = await runRegisterScript("check", env);
    assert.equal(
      result.code,
      0,
      `check failed:\nstdout=${result.stdout}\nstderr=${result.stderr}`,
    );
    assert.doesNotMatch(result.stdout, /PRIVATE_KEY/u);
    assert.doesNotMatch(result.stderr, /PRIVATE_KEY/u);
    assert.match(
      result.stdout,
      /71a3b7339dbc55ab47667abdfe8303bac4f4c24e/u,
    );
    const statusMatch = /AVAILABLE|REGISTERED/u.exec(result.stdout);
    assert.ok(
      statusMatch !== null,
      `expected AVAILABLE or REGISTERED in stdout:\n${result.stdout}`,
    );
    console.log(`smoke status=${statusMatch[0]}`);
  });
});

describe("e2e: commit, wait, approve, register, check REGISTERED", () => {
  it("registers ENS_LABEL on Sepolia when ENS_E2E=1 and secrets are set", async (t) => {
    const required = [
      "ENS_E2E",
      "ENS_LABEL",
      "SEPOLIA_RPC_URL",
      "PAYMENT_TOKEN",
      "DURATION_SECONDS",
      "PRIVATE_KEY",
    ] as const;
    for (const name of required) {
      if (!envPresent(name)) {
        t.skip(
          `E2E gated behind ENS_E2E=1 plus ENS_LABEL, SEPOLIA_RPC_URL, PAYMENT_TOKEN, DURATION_SECONDS, PRIVATE_KEY. Missing ${name}. ETHRegistrar has no safe unregister for a .eth name; a successful e2e leaves the name registered.`,
        );
        return;
      }
    }
    if (process.env.ENS_E2E !== "1") {
      t.skip(
        "E2E gated behind ENS_E2E=1. Set ENS_E2E=1 plus secrets to run. Leaves the name registered (no safe unregister on this pin).",
      );
      return;
    }

    const env: NodeJS.ProcessEnv = { ...process.env };
    const full = await runRegisterScript("full", env);
    assert.equal(
      full.code,
      0,
      `full failed:\nstdout=${full.stdout}\nstderr=${full.stderr}`,
    );
    assert.doesNotMatch(full.stdout, /PRIVATE_KEY/u);
    assert.doesNotMatch(full.stderr, /PRIVATE_KEY/u);
    assert.match(full.stdout, /REGISTERED/u);

    const check = await runRegisterScript("check", env);
    assert.equal(
      check.code,
      0,
      `post-register check failed:\nstdout=${check.stdout}\nstderr=${check.stderr}`,
    );
    assert.match(check.stdout, /REGISTERED/u);
  });
});
