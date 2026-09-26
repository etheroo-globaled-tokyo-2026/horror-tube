import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";
import { readKeypair, readKeypairs, readNetwork, requiredEnv } from "../src/env.js";

function assertNamedError(run: () => void, name: string, secret?: string): void {
  let error: Error | undefined;
  try {
    run();
  } catch (caught) {
    if (caught instanceof Error) error = caught;
  }
  assert.ok(error !== undefined, `expected an Error naming ${name}`);
  assert.match(error.message, new RegExp(`^${name} `, "u"));
  assert.match(error.message, /See \.env\.example\./u);
  if (secret !== undefined) {
    assert.ok(!error.message.includes(secret), "error message leaks the key");
    assert.equal(error.cause, undefined);
  }
}

describe("requiredEnv", () => {
  it("treats unset, blank, and whitespace-only as missing", () => {
    for (const value of [undefined, "", "   "])
      assertNamedError(() => requiredEnv("GAME_PORT", { GAME_PORT: value }), "GAME_PORT");
  });

  it("returns the trimmed value", () => {
    assert.equal(requiredEnv("X", { X: "  hi  " }), "hi");
  });
});

describe("readNetwork", () => {
  it("names SUI_NETWORK when the value is not a Sui network", () => {
    assertNamedError(() => readNetwork({ SUI_NETWORK: "devnet" }), "SUI_NETWORK");
  });
});

describe("readKeypair", () => {
  const name = "SUI_OPERATOR_PRIVATE_KEY";
  const read = (value: string) => readKeypair(name, { [name]: value });

  it("reads a valid Ed25519 key", () => {
    const keypair = Ed25519Keypair.generate();
    assert.equal(read(keypair.getSecretKey()).toSuiAddress(), keypair.toSuiAddress());
  });

  it("names the variable without echoing a malformed key", () => {
    const valid = Ed25519Keypair.generate().getSecretKey();
    const last = valid.at(-1) === "q" ? "p" : "q";
    const malformed = [
      valid.replace("suiprivkey1", "suiprivkey2"),
      `${valid.slice(0, -1)}${last}`,
      Secp256k1Keypair.generate().getSecretKey(),
    ];
    for (const value of malformed) assertNamedError(() => read(value), name, value);
  });
});

describe("readKeypairs", () => {
  const name = "HOUSE_BOT_SUI_PRIVATE_KEYS";
  const read = (value: string | undefined) => readKeypairs(name, { [name]: value });

  it("reads one signer per comma-separated key", () => {
    const keys = [Ed25519Keypair.generate(), Ed25519Keypair.generate()];
    assert.deepEqual(
      read(keys.map((k) => ` ${k.getSecretKey()} `).join(",")).map((k) => k.toSuiAddress()),
      keys.map((k) => k.toSuiAddress()),
    );
  });

  it("names the variable when missing, and the entry when one is blank or malformed", () => {
    const valid = Ed25519Keypair.generate().getSecretKey();
    const malformed = valid.replace("suiprivkey1", "suiprivkey2");
    assertNamedError(() => read(undefined), name);
    assertNamedError(() => read(`${valid},`), `${name} entry 2`);
    assertNamedError(() => read(`${valid},${malformed}`), `${name} entry 2`, malformed);
  });

  it("refuses the same key twice", () => {
    const valid = Ed25519Keypair.generate().getSecretKey();
    assertNamedError(() => read(`${valid},${valid}`), name, valid);
  });
});
