import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, describe, it } from "node:test";

import * as v from "valibot";

import { readWorldIdProof } from "../src/env.js";
import { readSession } from "../src/human-session.js";
import { createGameServer, listenGameServer } from "../src/server.js";
import type { ShinamiPort } from "../src/shinami-port.js";
import { createWalletHandler } from "../src/wallet-handler.js";

const PEPPER = "proof-flag-pepper";
const USDC = "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC";

const SessionJson = v.object({ session: v.string() });
const ErrorJson = v.object({ error: v.string() });
const ConfigJson = v.object({ worldIdProof: v.boolean() });

function boundPort(server: Server): number {
  const address = server.address();
  if (address === null || v.is(v.string(), address)) {
    throw new Error("test server did not bind a TCP port");
  }
  return address.port;
}

describe("readWorldIdProof", () => {
  it("treats unset, blank, and 1 as proof on", () => {
    assert.equal(readWorldIdProof({}), true);
    assert.equal(readWorldIdProof({ WORLD_ID_PROOF: "" }), true);
    assert.equal(readWorldIdProof({ WORLD_ID_PROOF: "   " }), true);
    assert.equal(readWorldIdProof({ WORLD_ID_PROOF: "1" }), true);
  });

  it("treats 0 as proof off", () => {
    assert.equal(readWorldIdProof({ WORLD_ID_PROOF: "0" }), false);
  });

  it("throws and names WORLD_ID_PROOF for any other value", () => {
    assert.throws(
      () => readWorldIdProof({ WORLD_ID_PROOF: "yes" }),
      (err: Error) => {
        assert.match(err.message, /WORLD_ID_PROOF/u);
        assert.match(err.message, /"yes"/u);
        assert.match(err.message, /\.env\.example/u);
        return true;
      },
    );
  });
});

describe("GET /config", () => {
  const servers: Server[] = [];

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

  it("returns the worldIdProof flag", async () => {
    for (const flag of [true, false]) {
      const server = createGameServer({
        port: 0,
        host: "127.0.0.1",
        worldIdProof: flag,
      });
      servers.push(server);
      await listenGameServer(server, { port: 0, host: "127.0.0.1", worldIdProof: flag });
      const res = await fetch(`http://127.0.0.1:${String(boundPort(server))}/config`);
      assert.equal(res.status, 200);
      assert.deepEqual(v.parse(ConfigJson, await res.json()), { worldIdProof: flag });
    }
  });
});

describe("POST /auth/waiver", () => {
  const servers: Server[] = [];

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

  function unusedShinami(): ShinamiPort {
    return {
      createSession: () => Promise.reject(new Error("shinami unused")),
      createWallet: () => Promise.reject(new Error("shinami unused")),
      getWallet: () => Promise.reject(new Error("shinami unused")),
      executeGaslessTransaction: () => Promise.reject(new Error("shinami unused")),
    };
  }

  async function start(worldIdProof: boolean, verifyProof: () => Promise<string>): Promise<string> {
    const server = createGameServer({
      port: 0,
      host: "127.0.0.1",
      worldIdProof,
      wallet: createWalletHandler({
        pepper: PEPPER,
        usdcType: USDC,
        bettingPackageId: undefined,
        worldIdProof,
        verifyProof,
        shinami: unusedShinami(),
      }),
    });
    servers.push(server);
    await listenGameServer(server, { port: 0, host: "127.0.0.1", worldIdProof });
    return `http://127.0.0.1:${String(boundPort(server))}`;
  }

  it("when proof is off, returns a session that readSession accepts", async () => {
    let verifyCalls = 0;
    const base = await start(false, () => {
      verifyCalls += 1;
      return Promise.reject(new Error("verifyProof must not run for waiver"));
    });
    const res = await fetch(`${base}/auth/waiver`, { method: "POST" });
    assert.equal(res.status, 200);
    const session = v.parse(SessionJson, await res.json()).session;
    const nullifier = readSession(session, PEPPER);
    assert.match(nullifier, /^[0-9]+$/u);
    assert.equal(verifyCalls, 0);

    const again = await fetch(`${base}/auth/waiver`, { method: "POST" });
    const other = v.parse(SessionJson, await again.json()).session;
    assert.notEqual(readSession(other, PEPPER), nullifier);
  });

  it("when proof is on, errors and does not call verifyProof", async () => {
    let verifyCalls = 0;
    const base = await start(true, () => {
      verifyCalls += 1;
      return Promise.resolve("999");
    });
    const res = await fetch(`${base}/auth/waiver`, { method: "POST" });
    assert.equal(res.status, 400);
    const body = v.parse(ErrorJson, await res.json());
    assert.match(body.error, /WORLD_ID_PROOF|proof|Orb|waiver/iu);
    assert.equal(verifyCalls, 0);
  });
});
