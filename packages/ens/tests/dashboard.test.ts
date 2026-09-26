import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, type Hex } from "viem";

import { userRegistryAbi } from "../scripts/abis.js";
import {
  decodeRegisterLabel,
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
        env: { ...process.env, DASHBOARD_PORT: "" },
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
