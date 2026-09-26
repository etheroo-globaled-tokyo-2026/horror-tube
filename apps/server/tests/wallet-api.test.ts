import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, describe, it } from "node:test";

import { coinWithBalance, Transaction } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import * as v from "valibot";

import { HttpError } from "../src/http-error.js";
import { issueSession, readSession, walletSecret } from "../src/human-session.js";
import { createGameServer, listenGameServer } from "../src/server.js";
import type { ShinamiPort } from "../src/shinami-port.js";
import { assertSponsorableKind } from "../src/tx-policy.js";
import { createWalletHandler, createWalletHandlerFromEnv } from "../src/wallet-handler.js";

const PEPPER = "test-pepper";
const NULLIFIER = "11256099";
const USDC =
  "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC";
const COIN_BOX = `0x${"11".repeat(32)}`;
const OTHER = `0x${"22".repeat(32)}`;
const PACKAGE_ID = `0x${"33".repeat(32)}`;

async function kind(sender: string | undefined, fill: (tx: Transaction) => void): Promise<string> {
  const tx = new Transaction();
  if (sender !== undefined) tx.setSender(sender);
  fill(tx);
  const bytes = await tx.build({
    onlyTransactionKind: true,
    assumeSufficientAddressBalances: sender !== undefined,
  });
  return toBase64(bytes);
}

function status(expected: number): (err: HttpError) => boolean {
  return (err: HttpError) => err instanceof HttpError && err.status === expected;
}

const SessionJson = v.object({ session: v.string() });
const AddressJson = v.object({ address: v.string() });
const DigestJson = v.object({ digest: v.string() });
const ErrorJson = v.object({ error: v.string() });

function boundPort(server: Server): number {
  const address = server.address();
  if (address === null || v.is(v.string(), address)) {
    throw new Error("test server did not bind a TCP port");
  }
  return address.port;
}

describe("session", () => {
  it("round-trips the nullifier and rejects a tampered token", () => {
    const token = issueSession(NULLIFIER, PEPPER);
    assert.equal(readSession(token, PEPPER), NULLIFIER);
    assert.equal(walletSecret(NULLIFIER, PEPPER), walletSecret(NULLIFIER, PEPPER));
    assert.notEqual(walletSecret(NULLIFIER, PEPPER), walletSecret(NULLIFIER, "other"));
    assert.throws(() => readSession(`${token}x`, PEPPER), status(401));
  });
});

describe("transaction allowlist", () => {
  it("allows USDC sent to the coin box", async () => {
    const txKind = await kind(COIN_BOX, (tx) => {
      tx.transferObjects(
        [coinWithBalance({ type: USDC, balance: 1_000_000n, useGasCoin: false })],
        COIN_BOX,
      );
    });
    assert.doesNotThrow(() => assertSponsorableKind(txKind, COIN_BOX, USDC, PACKAGE_ID));
  });

  it("allows a call to the betting package", async () => {
    const txKind = await kind(undefined, (tx) => {
      tx.moveCall({
        target: `${PACKAGE_ID}::pool::bet`,
        arguments: [tx.pure.u64(1n)],
      });
    });
    assert.doesNotThrow(() => assertSponsorableKind(txKind, COIN_BOX, USDC, PACKAGE_ID));
  });

  it("allows a USDC payout when the change returns to the coin box", async () => {
    const txKind = await kind(COIN_BOX, (tx) => {
      tx.transferObjects(
        [coinWithBalance({ type: USDC, balance: 1n, useGasCoin: false })],
        OTHER,
      );
    });
    assert.doesNotThrow(() => assertSponsorableKind(txKind, COIN_BOX, USDC, PACKAGE_ID));
  });

  it("rejects a call to any other package", async () => {
    const txKind = await kind(undefined, (tx) => {
      tx.moveCall({ target: `${OTHER}::evil::drain`, arguments: [] });
    });
    assert.throws(() => assertSponsorableKind(txKind, COIN_BOX, USDC, PACKAGE_ID), status(403));
  });

  it("rejects a non-coin command", async () => {
    const txKind = await kind(undefined, (tx) => {
      tx.makeMoveVec({ elements: [] });
    });
    assert.throws(() => assertSponsorableKind(txKind, COIN_BOX, USDC, PACKAGE_ID), status(403));
  });

  it("names BETTING_PACKAGE_ID when a package call has no configured package", async () => {
    const txKind = await kind(undefined, (tx) => {
      tx.moveCall({ target: `${PACKAGE_ID}::pool::bet`, arguments: [] });
    });
    assert.throws(
      () => assertSponsorableKind(txKind, COIN_BOX, USDC, undefined),
      (err: HttpError) => status(500)(err) && /BETTING_PACKAGE_ID/u.test(err.message),
    );
  });
});

describe("wallet HTTP", () => {
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

  function fakeShinami(): ShinamiPort & { executed: string[]; created: number } {
    const executed: string[] = [];
    const state = { executed, created: 0, address: `0x${"44".repeat(32)}` };
    const port: ShinamiPort & { executed: string[]; created: number } = {
      executed: state.executed,
      created: 0,
      createSession(secret: string): Promise<string> {
        assert.equal(secret, walletSecret(NULLIFIER, PEPPER));
        return Promise.resolve("session-token");
      },
      createWallet(walletId: string, sessionToken: string): Promise<string> {
        assert.equal(walletId, NULLIFIER);
        assert.equal(sessionToken, "session-token");
        state.created += 1;
        port.created = state.created;
        if (state.created > 1) return Promise.reject(new Error("Wallet ID already exists"));
        return Promise.resolve(state.address);
      },
      getWallet(walletId: string): Promise<string> {
        assert.equal(walletId, NULLIFIER);
        return Promise.resolve(state.address);
      },
      executeGaslessTransaction(
        walletId: string,
        sessionToken: string,
        txKind: string,
      ): Promise<string> {
        assert.equal(walletId, NULLIFIER);
        assert.equal(sessionToken, "session-token");
        state.executed.push(txKind);
        return Promise.resolve("digest-1");
      },
    };
    return port;
  }

  async function start(shinami: ShinamiPort): Promise<string> {
    const server = createGameServer({
      port: 0,
      host: "127.0.0.1",
      wallet: createWalletHandler({
        pepper: PEPPER,
        usdcType: USDC,
        bettingPackageId: PACKAGE_ID,
        verifyProof: () => Promise.resolve(NULLIFIER),
        shinami,
      }),
    });
    servers.push(server);
    await listenGameServer(server, { port: 0, host: "127.0.0.1" });
    return `http://127.0.0.1:${String(boundPort(server))}`;
  }

  it("returns a session, then the same address, then a digest", async () => {
    const shinami = fakeShinami();
    const base = await start(shinami);
    const login = await fetch(`${base}/auth/world-id`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{\"ok\":true}",
    });
    assert.equal(login.status, 200);
    const session = v.parse(SessionJson, await login.json()).session;
    assert.equal(readSession(session, PEPPER), NULLIFIER);

    const first = await fetch(`${base}/wallet`, {
      method: "POST",
      headers: { authorization: `Bearer ${session}` },
    });
    assert.equal(first.status, 200);
    const created = v.parse(AddressJson, await first.json()).address;

    const second = await fetch(`${base}/wallet`, {
      method: "POST",
      headers: { authorization: `Bearer ${session}` },
    });
    assert.equal(second.status, 200);
    assert.equal(v.parse(AddressJson, await second.json()).address, created);

    const txKind = await kind(created, (tx) => {
      tx.transferObjects(
        [coinWithBalance({ type: USDC, balance: 1n, useGasCoin: false })],
        created,
      );
    });
    const paid = await fetch(`${base}/tx`, {
      method: "POST",
      headers: { authorization: `Bearer ${session}`, "content-type": "application/json" },
      body: JSON.stringify({ txKind }),
    });
    assert.equal(paid.status, 200);
    assert.deepEqual(v.parse(DigestJson, await paid.json()), { digest: "digest-1" });
    assert.equal(shinami.executed.length, 1);
  });

  it("returns 403 and does not execute a call to another package", async () => {
    const shinami = fakeShinami();
    const base = await start(shinami);
    const session = issueSession(NULLIFIER, PEPPER);
    const txKind = await kind(undefined, (tx) => {
      tx.moveCall({ target: `${OTHER}::evil::drain`, arguments: [] });
    });
    const res = await fetch(`${base}/tx`, {
      method: "POST",
      headers: { authorization: `Bearer ${session}`, "content-type": "application/json" },
      body: JSON.stringify({ txKind }),
    });
    assert.equal(res.status, 403);
    assert.match(v.parse(ErrorJson, await res.json()).error, /betting package/u);
    assert.equal(shinami.executed.length, 0);
  });

  it("returns 401 without a session", async () => {
    const base = await start(fakeShinami());
    const res = await fetch(`${base}/wallet`, { method: "POST" });
    assert.equal(res.status, 401);
  });

  it("tells the operator to create a Node Service key on a gasless auth error", async () => {
    const shinami = fakeShinami();
    shinami.executeGaslessTransaction = () => Promise.reject(new Error("Unauthorized invalid access key"));
    const base = await start(shinami);
    const session = issueSession(NULLIFIER, PEPPER);
    const txKind = await kind(undefined, (tx) => {
      tx.moveCall({ target: `${PACKAGE_ID}::pool::bet`, arguments: [] });
    });
    const res = await fetch(`${base}/tx`, {
      method: "POST",
      headers: { authorization: `Bearer ${session}`, "content-type": "application/json" },
      body: JSON.stringify({ txKind }),
    });
    assert.equal(res.status, 500);
    const error = v.parse(ErrorJson, await res.json()).error;
    assert.match(error, /Node Service key/u);
    assert.match(error, /invalid access key/u);
  });
});

describe("wallet env", () => {
  it("names SHINAMI_ACCESS_KEY when it is missing", () => {
    assert.throws(
      () => createWalletHandlerFromEnv({}),
      /SHINAMI_ACCESS_KEY is required\. Set it in \.env\. See \.env\.example\./u,
    );
  });
});
