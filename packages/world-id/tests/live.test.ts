import assert from "node:assert/strict";
import test from "node:test";

import { hashSignal } from "@worldcoin/idkit-core/hashing";

import { loadWorldIdEnv, verifyProofOfHuman, voteActionForRound } from "../src/index.js";

const live = process.env.WORLD_ID_LIVE_TEST === "1";

test(
  "live /api/v4/verify rejects a well-formed forged Proof of Human",
  { skip: live ? false : "set WORLD_ID_LIVE_TEST=1 and World ID vars from .env to run" },
  async () => {
    const worldId = loadWorldIdEnv();
    const action = voteActionForRound(`live-${String(Date.now())}`);
    const signal = "0x1111111111111111111111111111111111111111";
    const forged = {
      protocol_version: "4.0",
      nonce: "0x0001d87e7b3fb86dc1cc6cea19984557ec6915b92b795eae7e207402cbc1bee0",
      action,
      environment: worldId.environment,
      responses: [
        {
          identifier: "proof_of_human",
          signal_hash: hashSignal(signal),
          proof: ["0x1", "0x2", "0x3", "0x4", "0x5"],
          nullifier: "0x2bf8406809dcefb1486dadc96c0a897db9bab002053054cf64272db512c6fbd8",
          issuer_schema_id: 1,
          expires_at_min: Math.floor(Date.now() / 1000) + 3600,
        },
      ],
    };
    await assert.rejects(
      verifyProofOfHuman({
        rpId: worldId.rpId,
        environment: worldId.environment,
        action,
        signal,
        idkitResult: forged,
        fetch: (url, init) => globalThis.fetch(url, init),
      }),
      (error: Error) => {
        console.log(`live verify rejected forged proof: ${error.message}`);
        assert.match(error.message, /World ID verify failed .* HTTP 4\d\d/);
        return true;
      },
    );
  },
);
