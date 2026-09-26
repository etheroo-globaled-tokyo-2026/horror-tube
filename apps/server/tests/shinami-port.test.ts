import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { gaslessDigest } from "../src/shinami-port.js";

describe("gaslessDigest", () => {
  it("reads the digest where Shinami returns it for the transaction.digest read mask", () => {
    const digest = "5e8i4h2hPbxi9VnuaYKze4CfAZgaHqECYpRDgsqBAveG";
    assert.equal(
      gaslessDigest({ transaction: { signatures: [], balanceChanges: [], transaction: { digest } } }),
      digest,
    );
  });

  it("names the failure when the response has no digest", () => {
    assert.throws(
      () => gaslessDigest({ transaction: { signatures: [], balanceChanges: [] } }),
      /returned no transaction digest/u,
    );
  });
});
