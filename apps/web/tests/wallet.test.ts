import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";

import {
  BURNER_KEY_STORAGE_KEY,
  type KeyStore,
  getGameWallet,
  loadBurnerKeypair,
} from "../wallet.ts";

function memoryStore(): KeyStore {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

describe("sui burner wallet", () => {
  it("creates one key and reuses it", async () => {
    const store = memoryStore();
    const first = await getGameWallet(store);
    const second = await getGameWallet(store);
    assert.equal(second.address, first.address);
    assert.match(store.getItem(BURNER_KEY_STORAGE_KEY) ?? "", /^suiprivkey1/u);
  });

  it("signs with no wallet prompt", async () => {
    const wallet = await getGameWallet(memoryStore());
    const message = new TextEncoder().encode("bet");
    const { signature } = await wallet.signer.signPersonalMessage(message);
    const publicKey = await verifyPersonalMessageSignature(message, signature);
    assert.equal(publicKey.toSuiAddress(), wallet.address);
  });

  it("refuses to overwrite a broken stored key", () => {
    const store = memoryStore();
    store.setItem(BURNER_KEY_STORAGE_KEY, "not-a-key");
    assert.throws(() => loadBurnerKeypair(store), /Refusing to overwrite/u);
    assert.equal(store.getItem(BURNER_KEY_STORAGE_KEY), "not-a-key");
  });
});
