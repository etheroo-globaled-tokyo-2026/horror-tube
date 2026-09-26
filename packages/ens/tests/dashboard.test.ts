import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeFunctionData, type Hex } from "viem";

import { userRegistryAbi } from "../scripts/abis.js";
import {
  MAX_LOG_CHUNK_BLOCKS,
  MAX_RECENT_LOG_CHUNKS,
  MIN_LOG_BLOCK,
  DASHBOARD_PORT,
  characterSheetFromTexts,
  decodeRegisterLabel,
  ensAppUrl,
  parseDashboardPort,
  parseListenerPids,
  recentLogScanChunks,
  renderDashboardHtml,
  sepoliaAddressUrl,
  type CharacterSheet,
} from "../scripts/dashboard.js";

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

describe("dashboard recent log windows (unit, no network)", () => {
  it("walks backward in chunks of at most 49999 blocks from head", () => {
    const latest = 11_785_000n;
    const chunks = recentLogScanChunks(latest);
    assert.equal(chunks.length, MAX_RECENT_LOG_CHUNKS);
    assert.equal(chunks[0]!.toBlock, latest);
    assert.equal(chunks[0]!.fromBlock, latest - (MAX_LOG_CHUNK_BLOCKS - 1n));
    for (const chunk of chunks) {
      const span = chunk.toBlock - chunk.fromBlock + 1n;
      assert.ok(span <= MAX_LOG_CHUNK_BLOCKS);
      assert.ok(chunk.fromBlock >= MIN_LOG_BLOCK);
    }
    assert.equal(chunks[1]!.toBlock, chunks[0]!.fromBlock - 1n);
    assert.equal(
      chunks[3]!.fromBlock,
      latest - 4n * MAX_LOG_CHUNK_BLOCKS + 1n,
    );
  });

  it("never includes block 0 when head is near genesis", () => {
    const chunks = recentLogScanChunks(100n, 4, 49999n);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]!.fromBlock, MIN_LOG_BLOCK);
    assert.equal(chunks[0]!.toBlock, 100n);
  });
});

describe("dashboard HTML (unit, no network)", () => {
  it("rendered HTML escapes < and quotes in look/brief", () => {
    const owner = "0x3B9Fd8d65B008709c9DF511295F56980E7C32D02";
    const sheet: CharacterSheet = {
      label: "pinhead",
      display_name: "Pinhead",
      name: "pinhead.horrortube.eth",
      owner,
      look: `<script>alert("x")</script>`,
      brief: `He said "boo" & left`,
      injuries: [],
      status: "alive",
      icon: "",
    };
    const html = renderDashboardHtml("horrortube.eth", [sheet]);
    assert.equal(html.includes("<script>"), false);
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(html.includes("&quot;boo&quot;"));
    assert.ok(html.includes("&amp; left"));
    assert.ok(html.includes(`href="${ensAppUrl(sheet.name)}"`));
    assert.ok(html.includes(`href="${sepoliaAddressUrl(owner)}"`));
    assert.ok(html.includes(owner));
    assert.ok(html.includes("<dt>injuries</dt><dd>none</dd>"));
  });

  it("uses display_name as title, ENS name as link, and separate injury lines", () => {
    const sheet: CharacterSheet = {
      label: "art",
      display_name: "Art the Clown",
      name: "art.horrortube.eth",
      owner: "0x3B9Fd8d65B008709c9DF511295F56980E7C32D02",
      look: "A clown.",
      brief: "Stalks silently.",
      injuries: ["ripped left sleeve", "slower swing"],
      status: "alive",
      icon: "",
    };
    const html = renderDashboardHtml("horrortube.eth", [sheet]);
    assert.ok(html.includes("<h2>Art the Clown</h2>"));
    assert.ok(
      html.includes(
        `<a href="${ensAppUrl(sheet.name)}">${sheet.name}</a>`,
      ),
    );
    assert.ok(html.includes("<li>ripped left sleeve</li>"));
    assert.ok(html.includes("<li>slower swing</li>"));
  });

  it("fails closed for invalid injuries and blank display_name", () => {
    const owner = "0x3B9Fd8d65B008709c9DF511295F56980E7C32D02";
    const texts = {
      display_name: "Pinhead",
      look: "Pale figure.",
      brief: "Summons chains.",
      injuries: "scar on cheek",
      status: "alive",
      icon: "",
    };
    assert.throws(
      () =>
        characterSheetFromTexts(
          "pinhead",
          "pinhead.horrortube.eth",
          owner,
          texts,
        ),
      /pinhead.*"scar on cheek"/u,
    );
    assert.throws(
      () =>
        characterSheetFromTexts(
          "pinhead",
          "pinhead.horrortube.eth",
          owner,
          { ...texts, display_name: " ", injuries: "[]" },
        ),
      /pinhead.*display_name/u,
    );
  });
});

describe("dashboard env (unit, no network)", () => {
  it("blank DASHBOARD_PORT uses the fixed port", () => {
    assert.equal(DASHBOARD_PORT, 8130);
    assert.equal(parseDashboardPort(undefined), 8130);
    assert.equal(parseDashboardPort(""), 8130);
    assert.equal(parseDashboardPort("   "), 8130);
  });

  it("DASHBOARD_PORT overrides the fixed port", () => {
    assert.equal(parseDashboardPort("9000"), 9000);
  });

  it("a non-numeric DASHBOARD_PORT fails and names the variable", () => {
    assert.throws(() => parseDashboardPort("nope"), /DASHBOARD_PORT/u);
  });

  it("listener pid output skips blanks and this process", () => {
    assert.deepEqual(parseListenerPids("\n42\n\n99\n", 99), [42]);
  });

  it("a non-pid lsof line fails", () => {
    assert.throws(() => parseListenerPids("nope\n", 1), /lsof/u);
  });
});

