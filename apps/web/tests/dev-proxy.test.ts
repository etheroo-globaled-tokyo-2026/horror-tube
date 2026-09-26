import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { API_PATHS } from "../../server/src/routes.ts";
import { devProxy } from "../dev-proxy.ts";

function forwarded(url: string): boolean {
  return Object.keys(devProxy("1")).some((pattern) => new RegExp(pattern).test(url));
}

describe("dev proxy", () => {
  it("forwards every game server route, with or without a query", () => {
    for (const path of API_PATHS) {
      assert.ok(forwarded(path), path);
      assert.ok(forwarded(`${path}?t=1`), `${path}?t=1`);
    }
  });

  it("leaves the room's own files to Vite", () => {
    for (const url of [
      "/",
      "/index.html",
      "/round-client.ts",
      "/wallet.ts",
      "/@vite/client",
      "/health/x",
    ]) {
      assert.equal(forwarded(url), false, url);
    }
  });
});
