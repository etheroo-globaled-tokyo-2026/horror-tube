import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, describe, it } from "node:test";

import { createGameServer, listenGameServer } from "../src/server.js";
import type { VerifyFetch } from "@horror-tube/world-id";

const SIGNING_KEY = `0x${"ab".repeat(32)}`;
const TEST_ENV: NodeJS.ProcessEnv = {
  WORLD_ID_APP_ID: "app_unit_test",
  WORLD_ID_RP_ID: "rp_unit_test",
  WORLD_ID_SIGNING_KEY: SIGNING_KEY,
  WORLD_ID_ENVIRONMENT: "production",
  WORLD_ID_PRACTICE_ACTIONS: "enter-room,enter-room-2,enter-room-3,enter-room-4,enter-room-5",
  WORLD_ID_JUDGE_ACTION: "enter-room-judge",
};

describe("World ID HTTP", () => {
  const servers: ReturnType<typeof createServer>[] = [];

  after(async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
          }),
      ),
    );
  });

  async function start(fetchImpl?: VerifyFetch): Promise<string> {
    const server = createGameServer({
      port: 0,
      host: "127.0.0.1",
      worldId: { env: TEST_ENV, fetch: fetchImpl },
    });
    servers.push(server);
    await listenGameServer(server, { port: 0, host: "127.0.0.1" });
    const addr = server.address() as AddressInfo;
    return `http://127.0.0.1:${String(addr.port)}`;
  }

  it("POST /world-id/request signs the practice or judge action for that slot", async () => {
    const base = await start();
    const res = await fetch(`${base}/world-id/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slot: 1 }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      app_id: string;
      action: string;
      environment: string;
      allow_legacy_proofs: boolean;
      rp_context: { rp_id: string; signature: string; nonce: string };
    };
    assert.equal(body.app_id, "app_unit_test");
    assert.equal(body.action, "enter-room");
    assert.equal(body.environment, "production");
    assert.equal(body.allow_legacy_proofs, false);
    assert.equal(body.rp_context.rp_id, "rp_unit_test");
    assert.ok(body.rp_context.signature.startsWith("0x"));
    assert.ok(body.rp_context.nonce.startsWith("0x"));
    const judge = await fetch(`${base}/world-id/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slot: "judge" }),
    });
    assert.equal(judge.status, 200);
    const judgeBody = (await judge.json()) as { action: string };
    assert.equal(judgeBody.action, "enter-room-judge");
    const bad = await fetch(`${base}/world-id/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slot: 9 }),
    });
    assert.equal(bad.status, 400);
    assert.match(await bad.text(), /slot must be/);
  });

  it("POST /world-id/verify rejects non-JSON before calling the portal", async () => {
    let called = false;
    const fetchImpl: VerifyFetch = async () => {
      called = true;
      throw new Error("portal must not be called");
    };
    const base = await start(fetchImpl);
    const res = await fetch(`${base}/world-id/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });
    assert.equal(res.status, 400);
    assert.match(await res.text(), /Body must be JSON/);
    assert.equal(called, false);
  });

  it("POST /world-id/verify rejects a legacy proof without calling the portal", async () => {
    let called = false;
    const fetchImpl: VerifyFetch = async () => {
      called = true;
      throw new Error("portal must not be called");
    };
    const base = await start(fetchImpl);
    const res = await fetch(`${base}/world-id/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        protocol_version: "3.0",
        nonce: "0xabc",
        action: "enter-room",
        environment: "production",
        responses: [
          {
            identifier: "proof_of_human",
            proof: ["0x1", "0x2", "0x3", "0x4", "0x5"],
            nullifier: "0x2bf8406809dcefb1486dadc96c0a897db9bab002053054cf64272db512c6fbd8",
            issuer_schema_id: 1,
            expires_at_min: 1756166400,
          },
        ],
      }),
    });
    assert.equal(res.status, 401);
    assert.match(await res.text(), /legacy proofs are rejected/);
    assert.equal(called, false);
  });

  it("POST /world-id/verify fails closed when the portal rejects the proof", async () => {
    const fetchImpl: VerifyFetch = async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ success: false, detail: "invalid proof" }),
    });
    const base = await start(fetchImpl);
    const res = await fetch(`${base}/world-id/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        protocol_version: "4.0",
        nonce: "0xabc",
        action: "enter-room",
        environment: "production",
        responses: [
          {
            identifier: "proof_of_human",
            proof: ["0x1", "0x2", "0x3", "0x4", "0x5"],
            nullifier: "0x2bf8406809dcefb1486dadc96c0a897db9bab002053054cf64272db512c6fbd8",
            issuer_schema_id: 1,
            expires_at_min: 1756166400,
          },
        ],
      }),
    });
    assert.equal(res.status, 401);
    assert.match(await res.text(), /World ID verify failed/);
  });
});
