import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { errorHint, type HintNote } from "../hint.ts";

describe("errorHint", () => {
  const rejected: HintNote = { phase: "bet", note: `BET REJECTED. <img src=x onerror="pwn()">`, noteKind: "bad" };

  it("shows a bad note in the room, escaped", () => {
    const hint = errorHint(rejected);
    assert.ok(hint !== null && hint.startsWith("BET REJECTED."));
    assert.equal(hint.includes("<"), false);
    assert.equal(hint.includes('"'), false);
  });

  it("leaves the gate and ordinary notes to their own hints", () => {
    assert.equal(errorHint({ ...rejected, phase: "gate" }), null);
    assert.equal(errorHint({ ...rejected, noteKind: "" }), null);
    assert.equal(errorHint({ ...rejected, note: "" }), null);
  });
});
