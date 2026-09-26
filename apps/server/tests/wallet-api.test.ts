import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, describe, it } from "node:test";

import { coinWithBalance, Inputs, Transaction } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import * as v from "valibot";

import { HttpError } from "../src/http-error.js";
import { issueSession, readSession, walletSecret } from "../src/human-session.js";
import { createGameServer, listenGameServer } from "../src/server.js";
import type { ShinamiPort } from "../src/shinami-port.js";
import { assertDepositKind, assertSponsorableKind, betPoolIds } from "../src/tx-policy.js";
import { createWalletHandler, createWalletHandlerFromEnv } from "../src/wallet-handler.js";
import { baseUrl } from "./base-url.js";

const PEPPER = "test-pepper";
const NULLIFIER = "11256099";
const USDC = "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC";
const COIN_BOX = `0x${"11".repeat(32)}`;
const OTHER = `0x${"22".repeat(32)}`;
const PACKAGE_ID = `0x${"33".repeat(32)}`;
const HOUSE_ID = `0x${"55".repeat(32)}`;
const POOL_ID = `0x${"66".repeat(32)}`;
const PAYER = `0x${"77".repeat(32)}`;
const PAYER_COIN = `0x${"88".repeat(32)}`;
const WALLET = `0x${"44".repeat(32)}`;

const shared = (objectId: string, mutable: boolean) =>
  Inputs.SharedObjectRef({ objectId, initialSharedVersion: 1, mutable });

function betKind(sender: string): Promise<string> {
  return kind(sender, (tx) => {
    tx.moveCall({
      target: `${PACKAGE_ID}::betting::bet`,
      typeArguments: [USDC],
      arguments: [
        tx.object(shared(HOUSE_ID, false)),
        tx.object(shared(POOL_ID, true)),
        tx.pure.u64(0),
        coinWithBalance({ type: USDC, balance: 30_000n, useGasCoin: false }),
        tx.object(shared("0x6", false)),
      ],
    });
  });
}

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

function depositKind(to: string, fill: (tx: Transaction) => void = () => {}): Promise<string> {
  return kind(PAYER, (tx) => {
    tx.moveCall({
      target: "0x2::coin::send_funds",
      typeArguments: [USDC],
      arguments: [
        coinWithBalance({ type: USDC, balance: 1_000_000n, useGasCoin: false }),
        tx.pure.address(to),
      ],
    });
    fill(tx);
  });
}

function status(expected: number): (err: HttpError) => boolean {
  return (err: HttpError) => err instanceof HttpError && err.status === expected;
}

const SessionJson = v.object({ session: v.string() });
const AddressJson = v.object({ address: v.string() });
const DigestJson = v.object({ digest: v.string() });
const ErrorJson = v.object({ error: v.string() });

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
      tx.transferObjects([coinWithBalance({ type: USDC, balance: 1n, useGasCoin: false })], OTHER);
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

  it("allows a deposit from the payer's address balance into the coin box", async () => {
    const txKind = await depositKind(COIN_BOX);
    assert.doesNotThrow(() => assertDepositKind(txKind, PAYER, COIN_BOX, USDC));
  });

  it("allows a deposit that merges and splits the payer's own coins", async () => {
    const txKind = await kind(undefined, (tx) => {
      const coin = tx.object(
        Inputs.ObjectRef({
          objectId: PAYER_COIN,
          version: "1",
          digest: "11111111111111111111111111111111",
        }),
      );
      tx.mergeCoins(coin, [
        tx.object(
          Inputs.ObjectRef({
            objectId: OTHER,
            version: "1",
            digest: "11111111111111111111111111111111",
          }),
        ),
      ]);
      const [paid] = tx.splitCoins(coin, [1_000_000n]);
      tx.moveCall({
        target: "0x2::coin::send_funds",
        typeArguments: [USDC],
        arguments: [paid, tx.pure.address(COIN_BOX)],
      });
    });
    assert.doesNotThrow(() => assertDepositKind(txKind, PAYER, COIN_BOX, USDC));
  });

  it("rejects a deposit that sends USDC anywhere but the coin box and the payer", async () => {
    const split = await depositKind(COIN_BOX, (tx) => {
      tx.moveCall({
        target: "0x2::coin::send_funds",
        typeArguments: [USDC],
        arguments: [
          coinWithBalance({ type: USDC, balance: 1n, useGasCoin: false }),
          tx.pure.address(OTHER),
        ],
      });
    });
    assert.throws(() => assertDepositKind(split, PAYER, COIN_BOX, USDC), status(403));
    const home = await depositKind(PAYER);
    assert.throws(() => assertDepositKind(home, PAYER, COIN_BOX, USDC), status(403));
  });

  it("rejects a deposit that also moves objects, calls a package, or spends the gas coin", async () => {
    const extras: ((tx: Transaction) => void)[] = [
      (tx) =>
        tx.transferObjects(
          [
            tx.object(
              Inputs.ObjectRef({
                objectId: PAYER_COIN,
                version: "1",
                digest: "11111111111111111111111111111111",
              }),
            ),
          ],
          OTHER,
        ),
      (tx) => tx.moveCall({ target: `${PACKAGE_ID}::pool::bet`, arguments: [] }),
      (tx) => tx.transferObjects([tx.splitCoins(tx.gas, [1n])], PAYER),
    ];
    for (const extra of extras) {
      const txKind = await depositKind(COIN_BOX, extra);
      assert.throws(() => assertDepositKind(txKind, PAYER, COIN_BOX, USDC), status(403));
    }
  });

  it("finds the pool of a betting::bet call", async () => {
    const txKind = await betKind(COIN_BOX);
    assert.doesNotThrow(() => assertSponsorableKind(txKind, COIN_BOX, USDC, PACKAGE_ID));
    assert.deepEqual(betPoolIds(txKind, PACKAGE_ID), [POOL_ID]);
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
    const state = { executed, created: 0, address: WALLET };
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
      sponsorTransaction(txKind: string, sender: string) {
        state.executed.push(txKind);
        return Promise.resolve({
          txBytes: `sponsored:${sender}`,
          signature: "sponsor-sig",
          digest: "digest-2",
        });
      },
    };
    return port;
  }

  async function start(
    shinami: ShinamiPort,
    assertBetAllowed: (poolId: string) => void = () => {},
  ): Promise<string> {
    const server = createGameServer({
      port: 0,
      host: "127.0.0.1",
      wallet: createWalletHandler({
        pepper: PEPPER,
        usdcType: USDC,
        bettingPackageId: PACKAGE_ID,
        verifyProof: () => Promise.resolve(NULLIFIER),
        shinami,
        assertBetAllowed,
      }),
    });
    servers.push(server);
    await listenGameServer(server, { port: 0, host: "127.0.0.1" });
    return baseUrl(server);
  }

  it("returns a session, then the same address, then a digest", async () => {
    const shinami = fakeShinami();
    const base = await start(shinami);
    const login = await fetch(`${base}/auth/world-id`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"ok":true}',
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

  it("returns 409 with the game's reason and does not execute a refused bet", async () => {
    const shinami = fakeShinami();
    const asked: string[] = [];
    const base = await start(shinami, (poolId) => {
      asked.push(poolId);
      throw new Error(
        "bet rejected: betting closed at 2026-09-26T00:00:05.000Z (betting_closes_at)",
      );
    });
    const res = await fetch(`${base}/tx`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${issueSession(NULLIFIER, PEPPER)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ txKind: await betKind(`0x${"44".repeat(32)}`) }),
    });
    assert.equal(res.status, 409);
    assert.match(
      v.parse(ErrorJson, await res.json()).error,
      /betting closed at 2026-09-26T00:00:05\.000Z/u,
    );
    assert.deepEqual(asked, [POOL_ID]);
    assert.equal(shinami.executed.length, 0);
  });

  it("sponsors a deposit into the session's wallet and refuses one into another wallet", async () => {
    const shinami = fakeShinami();
    const base = await start(shinami);
    const post = async (txKind: string) =>
      fetch(`${base}/sponsor-deposit`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${issueSession(NULLIFIER, PEPPER)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ txKind, sender: PAYER }),
      });

    const refused = await post(await depositKind(OTHER));
    assert.equal(refused.status, 403);
    assert.match(v.parse(ErrorJson, await refused.json()).error, /deposit/u);
    assert.equal(shinami.executed.length, 0);

    const sponsored = await post(await depositKind(WALLET));
    assert.equal(sponsored.status, 200);
    assert.deepEqual(await sponsored.json(), {
      txBytes: `sponsored:${PAYER}`,
      signature: "sponsor-sig",
    });
    assert.equal(shinami.executed.length, 1);

    shinami.sponsorTransaction = () =>
      Promise.reject(new Error("Invalid params InsufficientCoinBalance in command 0"));
    const failing = await post(await depositKind(WALLET));
    assert.equal(failing.status, 400);
    assert.match(v.parse(ErrorJson, await failing.json()).error, /InsufficientCoinBalance/u);
  });

  it("returns 401 without a session", async () => {
    const base = await start(fakeShinami());
    const res = await fetch(`${base}/wallet`, { method: "POST" });
    assert.equal(res.status, 401);
  });

  it("tells the operator to create a Node Service key on a gasless auth error", async () => {
    const shinami = fakeShinami();
    shinami.executeGaslessTransaction = () =>
      Promise.reject(new Error("Unauthorized invalid access key"));
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
      () => createWalletHandlerFromEnv({}, () => {}),
      /SHINAMI_ACCESS_KEY is required\. Set it in \.env\. See \.env\.example\./u,
    );
  });
});
