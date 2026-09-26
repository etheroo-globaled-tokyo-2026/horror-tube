import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createBattleBettingPorts } from "../src/battle-betting.js";

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

  it("fails closed when BETTING_PACKAGE_ID is missing", () => {
    assert.throws(
      () =>
        createBattleBettingPorts({
          ...base,
          BETTING_PACKAGE_ID: "",
          SUI_OPERATOR_PRIVATE_KEY:
            "suiprivkey1qz9uuwtjdetzztm8r84hmazeu3cj2uxwkd2utv7vs0qwmezpsdqpqzmfc7q",
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
          SUI_OPERATOR_PRIVATE_KEY:
            "suiprivkey1qz9uuwtjdetzztm8r84hmazeu3cj2uxwkd2utv7vs0qwmezpsdqpqzmfc7q",
        }),
      /SUI_OPERATOR_CAP_ID is required\. Set it in \.env\. See \.env\.example\./u,
    );
  });
});
