import assert from "node:assert/strict";
import { it } from "node:test";
import { poolId } from "../src/ids.js";

it("derives the same pool ID as Move", () => {
  assert.equal(
    poolId({ packageId: "0x0", houseId: "0x1234" }, "0b7c7c1e-2f3a-4d5e-8f90-123456789abc"),
    "0x6f246af362345df932f4f23a43e8c86692cdbb6b085c390d39af9ad3fbebe311",
  );
});
