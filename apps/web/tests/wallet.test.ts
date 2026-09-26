import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bcs } from "@mysten/sui/bcs";
import { fromBase64, normalizeStructTag, normalizeSuiAddress } from "@mysten/sui/utils";

import {
  USDC_TYPE,
  WALLET_SESSION_KEY,
  type SessionStore,
  fromUsdcUnits,
  getGameWallet,
  openGameWallet,
  toUsdcUnits,
  usdcDeposit,
  usdcTransfer,
} from "../wallet.ts";

const ADDRESS = `0x${"11".repeat(32)}`;

function memoryStore(): SessionStore {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

function jsonResponse(
  status: number,
  body: { session: string } | { address: string } | { error: string },
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Shinami game wallet", () => {
  it("stores the session from the waiver proof and reuses that address", async () => {
    const store = memoryStore();
    const seen: string[] = [];
    const proof = JSON.stringify({ proof: "orb" });
    const fetchImpl: typeof fetch = async (input, init) => {
      const path = String(input);
      seen.push(path);
      const headers = new Headers(init?.headers);
      if (path === "/auth/world-id") {
        assert.equal(headers.get("authorization"), null);
        assert.equal(init?.body, proof);
        return jsonResponse(200, { session: "signed-session" });
      }
      assert.equal(headers.get("authorization"), "Bearer signed-session");
      return jsonResponse(200, { address: ADDRESS });
    };
    const opened = await openGameWallet(proof, store, fetchImpl);
    const again = await getGameWallet(store, fetchImpl);
    assert.equal(opened.address, ADDRESS);
    assert.equal(again.address, ADDRESS);
    assert.equal(store.getItem(WALLET_SESSION_KEY), "signed-session");
    assert.deepEqual(seen, ["/auth/world-id", "/wallet", "/wallet"]);
  });

  it("refuses to open a wallet before the waiver session exists", async () => {
    await assert.rejects(() => getGameWallet(memoryStore(), fetch), /waiver scan/u);
  });

  it("surfaces the server error when the session is rejected", async () => {
    const store = memoryStore();
    store.setItem(WALLET_SESSION_KEY, "expired");
    const fetchImpl: typeof fetch = async () =>
      jsonResponse(401, { error: "Session is not valid. Call POST /auth/world-id." });
    await assert.rejects(() => getGameWallet(store, fetchImpl), /Session is not valid/u);
  });

  it("converts dollars to USDC units and back", () => {
    assert.equal(toUsdcUnits(12.5), 12_500_000n);
    assert.equal(toUsdcUnits(0.1 + 0.2), 300_000n);
    assert.equal(fromUsdcUnits(20_000_000n), 20);
  });

  it("builds one USDC transfer to the given address", () => {
    const to = "0x" + "ab".repeat(32);
    const data = usdcTransfer(to, 5_000_000n).getData();
    assert.deepEqual(
      data.commands.map((command) => command.$kind),
      ["$Intent", "TransferObjects"],
    );
  });

  it("deposits USDC into the recipient's address balance with send_funds", () => {
    const to = "0x" + "ab".repeat(32);
    const data = usdcDeposit(to, 5_000_000n).getData();
    const calls = data.commands.flatMap((command) =>
      command.MoveCall === undefined ? [] : [command.MoveCall],
    );
    assert.equal(calls.length, 1);
    const [call] = calls;
    assert.ok(call);
    assert.equal(
      `${normalizeSuiAddress(call.package)}::${call.module}::${call.function}`,
      `${normalizeSuiAddress("0x2")}::coin::send_funds`,
    );
    assert.deepEqual(call.typeArguments.map(normalizeStructTag), [normalizeStructTag(USDC_TYPE)]);
    const recipient = call.arguments[1];
    assert.ok(recipient?.$kind === "Input");
    const input = data.inputs[recipient.Input];
    assert.ok(input?.$kind === "Pure");
    assert.equal(normalizeSuiAddress(bcs.Address.parse(fromBase64(input.Pure.bytes))), to);
  });
});
