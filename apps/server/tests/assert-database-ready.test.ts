import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertDatabaseReady } from "../src/db/assert-database-ready.js";

describe("assertDatabaseReady", () => {
  it("fails when DATABASE_URL is missing", async () => {
    await assert.rejects(
      () => assertDatabaseReady({}),
      /DATABASE_URL/u,
    );
  });

  it("fails when DATABASE_CA_CERT is missing", async () => {
    await assert.rejects(
      () =>
        assertDatabaseReady({
          DATABASE_URL: "postgres://u:p@localhost:5432/db",
        }),
      /DATABASE_CA_CERT/u,
    );
  });
});
