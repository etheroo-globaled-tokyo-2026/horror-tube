import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifyMessage } from "viem";
import { sepolia } from "viem/chains";

import { BURNER_KEY_STORAGE_KEY, getWalletClient, loadBurnerKey } from "../design/wallet.js";

class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  get length(): number {
    return this.items.size;
  }
  clear(): void {
    this.items.clear();
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

function memoryStore(): Storage {
  return new MemoryStorage();
}

describe("burner wallet", () => {
  it("creates one key and reuses it", async () => {
    const store = memoryStore();
    const first = await getWalletClient(store);
    const second = await getWalletClient(store);
    assert.equal(second.account.address, first.account.address);
    assert.equal(store.getItem(BURNER_KEY_STORAGE_KEY), loadBurnerKey(store));
  });

  it("targets Sepolia", async () => {
    const client = await getWalletClient(memoryStore());
    assert.equal(client.chain.id, sepolia.id);
  });

  it("signs with no wallet prompt", async () => {
    const client = await getWalletClient(memoryStore());
    const signature = await client.signMessage({ message: "bet" });
    assert.ok(await verifyMessage({ address: client.account.address, message: "bet", signature }));
  });

  it("refuses to overwrite a broken stored key", () => {
    const store = memoryStore();
    store.setItem(BURNER_KEY_STORAGE_KEY, "not-a-key");
    assert.throws(() => loadBurnerKey(store), /Refusing to overwrite/u);
    assert.equal(store.getItem(BURNER_KEY_STORAGE_KEY), "not-a-key");
  });
});
