import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

import { createBattleBettingPorts } from "../src/battle-betting.js";
import { createEnsChainWritePorts } from "../src/ens-chain-write.js";

describe("createBattleBettingPorts", () => {
  const base = {
    SUI_NETWORK: "testnet",
    SUI_GRPC_URL: "https://fullnode.testnet.sui.io:443",
    BETTING_PACKAGE_ID:
      "0xc451dc1ad607c088b96ebc9b29cdff892a2e13c9275346838664391851213daf",
    BETTING_HOUSE_ID:
      "0xa116a4711f6cf51515ba5551c4c5b78b4fc85882a3941ccdc43f65a7dfc68892",
    SUI_USDC_TYPE:
      "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
    SUI_OPERATOR_CAP_ID:
      "0x9719983f791ebd479c0127299aaa685a1e02e63fce330e9587e543d7d5b46847",
  };
  const operatorKey = Ed25519Keypair.generate().getSecretKey();

  it("fails closed when BETTING_PACKAGE_ID is missing", () => {
    assert.throws(
      () =>
        createBattleBettingPorts({
          ...base,
          BETTING_PACKAGE_ID: "",
          SUI_OPERATOR_PRIVATE_KEY: operatorKey,
        }),
      /BETTING_PACKAGE_ID is required\. Set it in \.env\. See \.env\.example\./u,
    );
  });

  it("fails closed when SUI_OPERATOR_PRIVATE_KEY is missing", () => {
    assert.throws(
      () => createBattleBettingPorts({ ...base }),
      /SUI_OPERATOR_PRIVATE_KEY is required\. Set it in \.env\. See \.env\.example\./u,
    );
  });

  it("fails closed when SUI_OPERATOR_CAP_ID is missing", () => {
    assert.throws(
      () =>
        createBattleBettingPorts({
          ...base,
          SUI_OPERATOR_CAP_ID: "",
          SUI_OPERATOR_PRIVATE_KEY: operatorKey,
        }),
      /SUI_OPERATOR_CAP_ID is required\. Set it in \.env\. See \.env\.example\./u,
    );
  });
});

describe("settleBattle", () => {
  it("returns the Sui settle digest, not the battle id", async () => {
    const ports = createEnsChainWritePorts({}, { settle: async () => "SettleDigest111" });
    assert.equal(await ports.settleBattle("battle-1", 0), "SettleDigest111");
  });
});
