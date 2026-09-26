import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createBattleBettingPorts,
  stakeWeiForUnits,
  type BattleBettingPorts,
} from "../src/battle-betting.js";

describe("createBattleBettingPorts", () => {
  it("fails closed when BATTLE_BETTING_ADDRESS is missing", () => {
    assert.throws(
      () =>
        createBattleBettingPorts({
          SEPOLIA_RPC_URL: "https://example.invalid",
          AGENT_PRIVATE_KEY:
            "0x1111111111111111111111111111111111111111111111111111111111111111",
        }),
      /BATTLE_BETTING_ADDRESS is required\. Set it in \.env\. See \.env\.example\./u,
    );
  });

  it("fails closed when SEPOLIA_RPC_URL is missing", () => {
    assert.throws(
      () =>
        createBattleBettingPorts({
          BATTLE_BETTING_ADDRESS: "0x683e87b20857DA293477C5ee3DF682d7d8FDDb4C",
          AGENT_PRIVATE_KEY:
            "0x1111111111111111111111111111111111111111111111111111111111111111",
        }),
      /SEPOLIA_RPC_URL is required\. Set it in \.env\. See \.env\.example\./u,
    );
  });

  it("fails closed when AGENT_PRIVATE_KEY is missing", () => {
    assert.throws(
      () =>
        createBattleBettingPorts({
          BATTLE_BETTING_ADDRESS: "0x683e87b20857DA293477C5ee3DF682d7d8FDDb4C",
          SEPOLIA_RPC_URL: "https://example.invalid",
        }),
      /AGENT_PRIVATE_KEY is required\. Set it in \.env\. See \.env\.example\./u,
    );
  });

  it("rejects a non-address BATTLE_BETTING_ADDRESS", () => {
    assert.throws(
      () =>
        createBattleBettingPorts({
          BATTLE_BETTING_ADDRESS: "not-an-address",
          SEPOLIA_RPC_URL: "https://example.invalid",
          AGENT_PRIVATE_KEY:
            "0x1111111111111111111111111111111111111111111111111111111111111111",
        }),
      /BATTLE_BETTING_ADDRESS must be a 0x-prefixed 20-byte address/u,
    );
  });
});

describe("stakeWeiForUnits", () => {
  it("multiplies minBet by stake units", async () => {
    const ports: Pick<BattleBettingPorts, "minBet"> = {
      async minBet() {
        return 10_000_000_000_000n;
      },
    };
    assert.equal(await stakeWeiForUnits(ports, 1), 10_000_000_000_000n);
    assert.equal(await stakeWeiForUnits(ports, 3), 30_000_000_000_000n);
  });

  it("rejects non-integer or non-positive units", async () => {
    const ports: Pick<BattleBettingPorts, "minBet"> = {
      async minBet() {
        return 1n;
      },
    };
    await assert.rejects(
      () => stakeWeiForUnits(ports, 1.5),
      /positive integer stake unit/u,
    );
    await assert.rejects(
      () => stakeWeiForUnits(ports, 0),
      /positive integer stake unit/u,
    );
  });
});
