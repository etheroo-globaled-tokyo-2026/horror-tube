# Sui betting 2: TS client, CLIs, deploy, e2e Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A TypeScript client for `horror_tube::betting`, CLIs to find the gas owner and deploy, and a testnet e2e that proves the gasless money path.

**Architecture:** `packages/betting` becomes a built workspace package exactly like `packages/world-id` (`exports` → `types: ./src/index.ts`, `import: ./dist/index.js`, `tsc -p tsconfig.build.json`). Objects are parsed from BCS. Player transactions go through Shinami `executeGaslessTransaction`, as main's `/tx` does. Spec: `docs/superpowers/specs/2026-09-26-sui-betting-design.md`.

**Tech Stack:** TypeScript 7, `@mysten/sui` ^2.33.0 (`SuiGrpcClient`), `@shinami/clients` ^0.12.0, zod, `tsx --test`.

**Repo rules:** no comments in TS (oxlint `anti-slop/no-comments`), no `typeof` checks, parse input at the boundary, missing config fails naming the variable, relative imports use `.js` (NodeNext, like world-id).

---

## Files

| File | Responsibility |
| --- | --- |
| `packages/betting/package.json`, `tsconfig.json`, `tsconfig.build.json` | Package (copy world-id's shape) |
| `src/env.ts` | Env parsing, keys, client |
| `src/ids.ts` | Pool ID derivation |
| `src/objects.ts` | BCS layouts, `getPool`, `listTickets` |
| `src/payout.ts` | Payout mirror, odds |
| `src/transactions.ts` | Transaction builders |
| `src/execute.ts` | Execute + wait; created-object lookup |
| `src/operator.ts` | Idempotent, serialized operator calls |
| `src/index.ts` | Re-exports the above |
| `src/cli/gas-owner.ts`, `deploy.ts`, `pool.ts`, `e2e.ts`, `shinami.ts` | CLIs; `shinami.ts` is the e2e's gasless wallet |
| `tests/ids.test.ts`, `tests/payout.test.ts` | Unit tests |

### Task 1: Package

**Files:** Create `packages/betting/package.json`, `tsconfig.json`, `tsconfig.build.json`; modify root `package.json`, `Dockerfile`

- [x] `package.json`:

```json
{
  "name": "@horror-tube/betting",
  "private": true,
  "type": "module",
  "exports": {
    ".": { "types": "./src/index.ts", "import": "./dist/index.js", "default": "./dist/index.js" }
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "sui move test --path move && tsx --test tests/*.test.ts",
    "typecheck": "tsc --noEmit",
    "gas-owner": "tsx --env-file=../../.env src/cli/gas-owner.ts",
    "deploy": "tsx --env-file=../../.env src/cli/deploy.ts",
    "pool": "tsx --env-file=../../.env src/cli/pool.ts",
    "e2e": "tsx --env-file=../../.env src/cli/e2e.ts"
  },
  "dependencies": { "@mysten/sui": "^2.33.0", "zod": "^4.6.5" },
  "devDependencies": {
    "@shinami/clients": "^0.12.0",
    "@types/node": "^26.6.2",
    "tsx": "^4.23.15",
    "typescript": "7.0.2"
  }
}
```

- [x] `tsconfig.json` and `tsconfig.build.json`: copy `packages/world-id`'s; the build config excludes `tests` and `src/cli`.
- [x] Root `package.json`: `betting:gas-owner`, `betting:deploy`, `betting:pool`, `betting:e2e` → `pnpm --filter @horror-tube/betting run <name>`.
- [x] `Dockerfile`: copy `packages/betting/package.json` before install; `RUN pnpm --filter @horror-tube/betting build` before the server build; in the runtime stage copy `packages/betting/{package.json,dist,node_modules}` like `packages/fight`.
- [x] `pnpm install`. Commit: `feat: add the betting package`.

### Task 2: IDs, objects, payout

**Files:** Create `src/env.ts`, `src/ids.ts`, `src/objects.ts`, `src/payout.ts`, `src/index.ts`, `tests/ids.test.ts`, `tests/payout.test.ts`

- [x] Failing tests. `tests/ids.test.ts` (vector from the Move test `pool_address_matches_the_typescript_sdk`; Move test builds use package address `0x0`):

```ts
import assert from "node:assert/strict";
import { it } from "node:test";
import { poolId } from "../src/ids.js";

it("derives the same pool ID as Move", () => {
  assert.equal(
    poolId({ packageId: "0x0", houseId: "0x1234" }, "0b7c7c1e-2f3a-4d5e-8f90-123456789abc"),
    "0x6f246af362345df932f4f23a43e8c86692cdbb6b085c390d39af9ad3fbebe311",
  );
});
```

`tests/payout.test.ts` (Move worked example: 30 + 10 USDC on side 0, 40 on side 1, 2% fee):

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PoolStatus, type Pool, type Ticket } from "../src/objects.js";
import { payout, poolFee } from "../src/payout.js";

function pool(status: number, totals: [bigint, bigint]): Pool {
  const base = { status, winningSide: 0n, totals, feeBps: 200n };
  return { id: "0x1", houseId: "0x2", battleId: "b", closesAtMs: 0n, pot: 0n, ...base, fee: poolFee(base) };
}
const ticket = (side: bigint, stake: bigint): Ticket => ({ id: "0x3", poolId: "0x1", side, stake });

describe("payout", () => {
  it("splits the pot among winners after the fee", () => {
    const settled = pool(PoolStatus.settled, [40_000_000n, 40_000_000n]);
    assert.equal(payout(settled, ticket(0n, 30_000_000n)), 59_400_000n);
    assert.equal(payout(settled, ticket(0n, 10_000_000n)), 19_800_000n);
    assert.equal(payout(settled, ticket(1n, 40_000_000n)), 0n);
  });
  it("refunds cancelled and one-sided pools", () => {
    assert.equal(payout(pool(PoolStatus.cancelled, [1n, 5n]), ticket(1n, 5n)), 5n);
    assert.equal(payout(pool(PoolStatus.settled, [0n, 5n]), ticket(1n, 5n)), 5n);
  });
  it("pays nothing while open", () => {
    assert.equal(payout(pool(PoolStatus.open, [5n, 5n]), ticket(0n, 5n)), 0n);
  });
});
```

- [x] Run `pnpm --filter @horror-tube/betting exec tsx --test tests/*.test.ts` → FAIL.
- [x] `src/env.ts`:

```ts
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { z } from "zod";

export type ContractIds = { packageId: string; houseId: string; coinType: string };
export type BettingConfig = ContractIds & { network: "testnet" | "mainnet"; grpcUrl: string };

export function requiredEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name]?.trim();
  if (value === undefined || value === "")
    throw new Error(`${name} is required. Set it in .env. See .env.example.`);
  return value;
}

export function readNetwork(env: NodeJS.ProcessEnv = process.env): BettingConfig["network"] {
  return z.enum(["testnet", "mainnet"]).parse(requiredEnv("SUI_NETWORK", env));
}

export function readBettingConfig(env: NodeJS.ProcessEnv = process.env): BettingConfig {
  return {
    network: readNetwork(env),
    grpcUrl: requiredEnv("SUI_GRPC_URL", env),
    packageId: requiredEnv("BETTING_PACKAGE_ID", env),
    houseId: requiredEnv("BETTING_HOUSE_ID", env),
    coinType: requiredEnv("SUI_USDC_TYPE", env),
  };
}

export function readUnits(name: string, env: NodeJS.ProcessEnv = process.env): bigint {
  const raw = requiredEnv(name, env);
  if (!/^[0-9]+$/u.test(raw)) throw new Error(`${name} must be a whole number. Got ${JSON.stringify(raw)}.`);
  return BigInt(raw);
}

export function readKeypair(name: string, env: NodeJS.ProcessEnv = process.env): Ed25519Keypair {
  return Ed25519Keypair.fromSecretKey(requiredEnv(name, env));
}

export function createClient(config: Pick<BettingConfig, "network" | "grpcUrl">): SuiGrpcClient {
  return new SuiGrpcClient({ network: config.network, baseUrl: config.grpcUrl });
}
```

- [x] `src/ids.ts`:

```ts
import { bcs } from "@mysten/sui/bcs";
import { deriveObjectID } from "@mysten/sui/utils";
import type { ContractIds } from "./env.js";

export function poolId(ids: Pick<ContractIds, "packageId" | "houseId">, battleId: string): string {
  return deriveObjectID(ids.houseId, `${ids.packageId}::betting::PoolKey`, bcs.string().serialize(battleId).toBytes());
}
```

- [x] `src/objects.ts`:

```ts
import { bcs } from "@mysten/sui/bcs";
import { ObjectError, type ClientWithCoreApi } from "@mysten/sui/client";
import type { ContractIds } from "./env.js";

export const PoolStatus = { open: 0, settled: 1, cancelled: 2 } as const;

const PoolBcs = bcs.struct("Pool", {
  id: bcs.Address,
  house_id: bcs.Address,
  battle_id: bcs.string(),
  closes_at_ms: bcs.u64(),
  fee_bps: bcs.u64(),
  status: bcs.u8(),
  winning_side: bcs.u64(),
  fee: bcs.u64(),
  totals: bcs.vector(bcs.u64()),
  pot: bcs.u64(),
});

const TicketBcs = bcs.struct("Ticket", { id: bcs.Address, pool_id: bcs.Address, side: bcs.u64(), stake: bcs.u64() });

export function parsePool(content: Uint8Array) {
  const raw = PoolBcs.parse(content);
  const [a, b] = raw.totals.map(BigInt);
  if (raw.totals.length !== 2 || a === undefined || b === undefined)
    throw new Error(`Pool ${raw.id} has ${raw.totals.length} totals, expected 2.`);
  return {
    id: raw.id,
    houseId: raw.house_id,
    battleId: raw.battle_id,
    closesAtMs: BigInt(raw.closes_at_ms),
    feeBps: BigInt(raw.fee_bps),
    status: raw.status,
    winningSide: BigInt(raw.winning_side),
    fee: BigInt(raw.fee),
    totals: [a, b] satisfies [bigint, bigint],
    pot: BigInt(raw.pot),
  };
}

export function parseTicket(content: Uint8Array) {
  const raw = TicketBcs.parse(content);
  return { id: raw.id, poolId: raw.pool_id, side: BigInt(raw.side), stake: BigInt(raw.stake) };
}

export type Pool = ReturnType<typeof parsePool>;
export type Ticket = ReturnType<typeof parseTicket>;

export async function getPool(client: ClientWithCoreApi, id: string): Promise<Pool | null> {
  try {
    const { object } = await client.core.getObject({ objectId: id, include: { content: true } });
    return parsePool(object.content);
  } catch (error) {
    if (error instanceof ObjectError && error.reason === "notFound") return null;
    throw error;
  }
}

export async function listTickets(
  client: ClientWithCoreApi,
  ids: Pick<ContractIds, "packageId" | "coinType">,
  owner: string,
): Promise<Ticket[]> {
  const tickets: Ticket[] = [];
  let cursor: string | null = null;
  do {
    const page = await client.core.listOwnedObjects({
      owner,
      type: `${ids.packageId}::betting::Ticket<${ids.coinType}>`,
      include: { content: true },
      cursor,
    });
    tickets.push(...page.objects.map((object) => parseTicket(object.content)));
    cursor = page.hasNextPage ? page.cursor : null;
  } while (cursor !== null);
  return tickets;
}
```

- [x] `src/payout.ts`:

```ts
import { PoolStatus, type Pool, type Ticket } from "./objects.js";

const BPS = 10_000n;

export function poolFee(pool: Pick<Pool, "totals" | "winningSide" | "feeBps">): bigint {
  const [a, b] = pool.totals;
  const loser = pool.winningSide === 0n ? b : a;
  return a === 0n || b === 0n ? 0n : (loser * pool.feeBps) / BPS;
}

export function payout(pool: Pool, ticket: Ticket): bigint {
  if (ticket.poolId !== pool.id) throw new Error(`Ticket ${ticket.id} is for pool ${ticket.poolId}, not ${pool.id}.`);
  if (pool.status === PoolStatus.open) return 0n;
  const [a, b] = pool.totals;
  const [winner, loser] = pool.winningSide === 0n ? [a, b] : [b, a];
  if (pool.status === PoolStatus.cancelled || winner === 0n || loser === 0n) return ticket.stake;
  if (ticket.side !== pool.winningSide) return 0n;
  return (ticket.stake * (winner + loser - pool.fee)) / winner;
}

export function odds(totals: [bigint, bigint], feeBps: bigint, side: 0 | 1): number {
  const mine = totals[side];
  const theirs = totals[side === 0 ? 1 : 0];
  if (mine === 0n || theirs === 0n) return 1;
  return Number(mine + theirs - (theirs * feeBps) / BPS) / Number(mine);
}
```

- [x] `src/index.ts`: `export * from` each of `env`, `ids`, `objects`, `payout`, `transactions`, `execute`, `operator` (`.js`).
- [x] Tests → PASS; `typecheck` clean. Commit: `feat: derive pool IDs and parse betting objects`.

### Task 3: Transactions, execute, operator

**Files:** Create `src/transactions.ts`, `src/execute.ts`, `src/operator.ts`, `tests/operator.test.ts`

- [x] `src/transactions.ts`: one builder per call, each `new Transaction()` + one `moveCall` with `typeArguments: [ids.coinType]`:
  - `betTx(ids, pool, side: 0 | 1, amount)` → `bet(house, pool, u64 side, tx.coin({ type: ids.coinType, balance: amount, useGasCoin: false }), tx.object.clock())`
  - `claimTx(ids, tickets: Ticket[])` → one `claim(pool, ticket)` per ticket
  - `openPoolTx(ids, cap, battleId: string, closesAtMs)` → `open_pool(house, cap, tx.pure.string(battleId), u64, clock)`
  - `closeBettingTx(ids, cap, pool)`, `settleTx(ids, cap, pool, side)`, `cancelTx(ids, cap, pool)`
  - `target(ids, name)` = `${ids.packageId}::betting::${name}`
- [x] `src/execute.ts`:

```ts
import type { SuiClientTypes } from "@mysten/sui/client";
import type { Signer } from "@mysten/sui/cryptography";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import type { Transaction } from "@mysten/sui/transactions";

export type Executed = SuiClientTypes.Transaction<{ effects: true; objectTypes: true }>;

export async function execute(client: SuiGrpcClient, signer: Signer, transaction: Transaction): Promise<Executed> {
  const result = await client.signAndExecuteTransaction({ transaction, signer, include: { effects: true, objectTypes: true } });
  if (result.$kind === "FailedTransaction")
    throw new Error(
      `Transaction ${result.FailedTransaction.digest} aborted: ${result.FailedTransaction.status.error?.message ?? "no error message"}`,
    );
  await client.waitForTransaction({ digest: result.Transaction.digest });
  return result.Transaction;
}

export function createdId(result: Executed, typeFragment: string): string {
  const ids = result.effects.changedObjects
    .filter((change) => change.idOperation === "Created" && result.objectTypes[change.objectId]?.includes(typeFragment))
    .map((change) => change.objectId);
  const [id] = ids;
  if (ids.length !== 1 || id === undefined)
    throw new Error(`Expected one created ${typeFragment} in ${result.digest}, found ${ids.length}.`);
  return id;
}

export function publishedPackageId(result: Executed): string {
  const change = result.effects.changedObjects.find((c) => c.outputState === "PackageWrite");
  if (change === undefined) throw new Error(`No package in ${result.digest}.`);
  return change.objectId;
}
```

- [x] `src/operator.ts`: `createOperator(chain: OperatorChain, ids, cap)` where `OperatorChain = { readPool(id): Promise<Pool | null>; run(tx: Transaction): Promise<void> }`, so the unit test passes a fake. `createChain(client, signer)` returns the real one (`getPool` + `execute`). Operations run through one promise queue:

```ts
export function createOperator(chain: OperatorChain, ids: ContractIds, cap: string) {
  let queue: Promise<void> = Promise.resolve();
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  const pool = (battleId: string): string => poolId(ids, battleId);
  const current = async (battleId: string): Promise<Pool> => {
    const found = await chain.readPool(pool(battleId));
    if (found === null) throw new Error(`No pool for battle ${battleId} (${pool(battleId)}).`);
    return found;
  };
  return {
    poolId: pool,
    read: current,
    openPool: (battleId: string, closesAtMs: bigint) =>
      serial(async () => {
        if ((await chain.readPool(pool(battleId))) === null) await chain.run(openPoolTx(ids, cap, battleId, closesAtMs));
      }),
    closeBetting: (battleId: string) =>
      serial(async () => {
        const found = await current(battleId);
        if (found.status === PoolStatus.open && found.closesAtMs > BigInt(Date.now()))
          await chain.run(closeBettingTx(ids, cap, pool(battleId)));
      }),
    settle: (battleId: string, side: 0 | 1) =>
      serial(async () => {
        const found = await current(battleId);
        if (found.status === PoolStatus.settled && found.winningSide === BigInt(side)) return;
        if (found.status !== PoolStatus.open)
          throw new Error(`Battle ${battleId}: pool status ${found.status}, cannot settle for side ${side}.`);
        await chain.run(settleTx(ids, cap, pool(battleId), side));
      }),
    cancel: (battleId: string) =>
      serial(async () => {
        const found = await current(battleId);
        if (found.status === PoolStatus.cancelled) return;
        if (found.status !== PoolStatus.open) throw new Error(`Battle ${battleId}: pool is settled, cannot cancel.`);
        await chain.run(cancelTx(ids, cap, pool(battleId)));
      }),
  };
}
```

- [x] `tests/operator.test.ts`: a fake chain holding one `Pool` in memory whose `run` applies the call's effect and counts runs. Cases: `openPool` twice runs once; `settle` on a settled pool for the same side runs nothing, for the other side throws; `cancel` on a settled pool throws; a failed `run` rejects that call and the next call still runs.
- [x] Tests, `typecheck`, `pnpm lint` pass (for `packages/betting`; the repo-wide run fails on files outside it). Commit: `feat: betting transactions and operator`.

### Task 4: CLIs

**Files:** Create `src/cli/shinami.ts`, `gas-owner.ts`, `deploy.ts`, `pool.ts`; modify `.env.example`

- [x] `.env.example`, append (comment above each, file style):

```
# Sui network for betting: testnet
SUI_NETWORK=
# Sui full node gRPC URL: https://fullnode.testnet.sui.io:443
SUI_GRPC_URL=
# Printed by pnpm betting:deploy
BETTING_HOUSE_ID=
# Minimum bet in USDC base units (30000 = 0.03 USDC). Read by pnpm betting:deploy
SUI_MIN_BET=
# Shinami Gas Station gas owner, printed by pnpm betting:gas-owner. Read by pnpm betting:deploy
SUI_BET_SPONSOR=
# 1password: op://Private/Horror Tube Sui admin/private key
# Publisher. Holds AdminCap and UpgradeCap. Funds the e2e wallet. Laptop only.
SUI_ADMIN_PRIVATE_KEY=
# Printed by pnpm betting:deploy
SUI_ADMIN_CAP_ID=
# 1password: op://Private/Horror Tube Sui operator/private key
SUI_OPERATOR_PRIVATE_KEY=
# Printed by pnpm betting:deploy
SUI_OPERATOR_CAP_ID=
# Printed by pnpm betting:deploy. Operator cap held by the admin key, for pnpm betting:e2e
SUI_E2E_OPERATOR_CAP_ID=
```

Change the `BET_FEE_BPS` comment to `Fee in basis points, taken from the losing side (200 = 2%). Read by pnpm betting:deploy`, and the `BETTING_PACKAGE_ID` comment to `Printed by pnpm betting:deploy`.

- [x] `src/cli/shinami.ts`: the e2e's gasless wallet, the same calls as `apps/server/src/shinami-port.ts`:

```ts
import { createHmac } from "node:crypto";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import type { Transaction } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import { KeyClient, ShinamiWalletSigner, WalletClient } from "@shinami/clients/sui";
import { requiredEnv } from "../env.js";

export async function gaslessWallet(client: SuiGrpcClient, walletId: string) {
  const key = requiredEnv("SHINAMI_ACCESS_KEY");
  const secret = createHmac("sha256", requiredEnv("WALLET_SECRET_PEPPER")).update(`cli:${walletId}`).digest("hex");
  const signer = new ShinamiWalletSigner(walletId, new WalletClient(key), secret, new KeyClient(key));
  const address = await signer.getAddress(true);
  return {
    address,
    run: async (tx: Transaction): Promise<string> => {
      tx.setSender(address);
      const kind = await tx.build({ client, onlyTransactionKind: true });
      const response = await signer.executeGaslessTransaction({ txKind: toBase64(kind) }, ["transaction.digest"]);
      const digest = response.transaction?.digest;
      if (digest === undefined) throw new Error("Shinami executeGaslessTransaction returned no digest.");
      await client.waitForTransaction({ digest });
      return digest;
    },
  };
}
```

- [x] `src/cli/gas-owner.ts`: `gaslessWallet(client, "horror-tube-gas-owner")`; three times run a tx with one `0x2::clock::timestamp_ms(tx.object.clock())` call; for each digest read `client.core.getTransaction({ digest, include: { transaction: true } })` and print `transaction.transaction.gasData.owner`. Print `SUI_BET_SPONSOR=<owner>` only when all three match; otherwise exit 1 naming the three owners.
- [x] `src/cli/deploy.ts`:

```ts
import { execFileSync } from "node:child_process";
import { Transaction } from "@mysten/sui/transactions";
import { z } from "zod";
import { createClient, readKeypair, readNetwork, readUnits, requiredEnv } from "../env.js";
import { createdId, execute, publishedPackageId } from "../execute.js";

const network = readNetwork();
const client = createClient({ network, grpcUrl: requiredEnv("SUI_GRPC_URL") });
const coinType = requiredEnv("SUI_USDC_TYPE");
const feeBps = readUnits("BET_FEE_BPS");
const minBet = readUnits("SUI_MIN_BET");
const sponsor = requiredEnv("SUI_BET_SPONSOR");
const admin = readKeypair("SUI_ADMIN_PRIVATE_KEY");
const operator = readKeypair("SUI_OPERATOR_PRIVATE_KEY").toSuiAddress();

console.log(`Building move/ for ${network}…`);
const build = z
  .object({ modules: z.array(z.string()), dependencies: z.array(z.string()) })
  .parse(
    JSON.parse(
      execFileSync("sui", ["move", "build", "--dump-bytecode-as-base64", "-e", network, "--path", "move"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      }),
    ),
  );

console.log(`Publishing from ${admin.toSuiAddress()}…`);
const publish = new Transaction();
publish.transferObjects([publish.publish(build)], admin.toSuiAddress());
const published = await execute(client, admin, publish);
const packageId = publishedPackageId(published);
const adminCap = createdId(published, "::betting::AdminCap");

console.log(`Creating the house (fee ${feeBps} bps, min bet ${minBet}, sponsor ${sponsor})…`);
const create = new Transaction();
create.moveCall({
  target: `${packageId}::betting::create_house`,
  typeArguments: [coinType],
  arguments: [create.object(adminCap), create.pure.u64(feeBps), create.pure.u64(minBet), create.pure.address(sponsor)],
});
const houseId = createdId(await execute(client, admin, create), "::betting::House<");

async function issueCap(holder: string): Promise<string> {
  console.log(`Issuing an operator cap to ${holder}…`);
  const tx = new Transaction();
  const cap = tx.moveCall({
    target: `${packageId}::betting::issue_operator_cap`,
    typeArguments: [coinType],
    arguments: [tx.object(houseId), tx.object(adminCap)],
  });
  tx.transferObjects([cap], holder);
  return createdId(await execute(client, admin, tx), "::betting::OperatorCap");
}
const operatorCap = await issueCap(operator);
const e2eCap = await issueCap(admin.toSuiAddress());

console.log(`\nAdd to .env:
BETTING_PACKAGE_ID=${packageId}
BETTING_HOUSE_ID=${houseId}
SUI_ADMIN_CAP_ID=${adminCap}
SUI_OPERATOR_CAP_ID=${operatorCap}
SUI_E2E_OPERATOR_CAP_ID=${e2eCap}`);
```

- [x] `src/cli/pool.ts` (`pnpm betting:pool <battleId>`): print the pool with bigints as decimal strings, or `No pool for battle <id>`.
- [x] Commit: `feat: betting gas-owner, deploy and pool CLIs`.

### Task 5: Deploy (after the operator's setup in the spec)

- [ ] `pnpm betting:gas-owner` → `SUI_BET_SPONSOR=…` into `.env`. On mismatch, stop and report.
- [ ] `.env`: `SUI_NETWORK=testnet`, `SUI_GRPC_URL=https://fullnode.testnet.sui.io:443`, `BET_FEE_BPS=200`, `SUI_MIN_BET=30000`.
- [ ] `pnpm betting:deploy` → paste the five printed lines into `.env`.

### Task 6: e2e gate

**Files:** Create `src/cli/e2e.ts`

- [x] `src/cli/e2e.ts`:

```ts
import assert from "node:assert/strict";
import { Transaction } from "@mysten/sui/transactions";
import { createClient, readBettingConfig, readKeypair, readUnits, requiredEnv } from "../env.js";
import { execute } from "../execute.js";
import { PoolStatus, getPool, listTickets } from "../objects.js";
import { createOperator } from "../operator.js";
import { payout } from "../payout.js";
import { betTx, claimTx } from "../transactions.js";
import { gaslessWallet } from "./shinami.js";

const config = readBettingConfig();
const client = createClient(config);
const admin = readKeypair("SUI_ADMIN_PRIVATE_KEY");
const minBet = readUnits("SUI_MIN_BET");
const operator = createOperator(
  { readPool: (id) => getPool(client, id), run: async (tx) => void (await execute(client, admin, tx)) },
  config,
  requiredEnv("SUI_E2E_OPERATOR_CAP_ID"),
);
const player = await gaslessWallet(client, "horror-tube-e2e");
const battleId = `e2e-${new Date().toISOString()}`;
const usdc = async (): Promise<bigint> =>
  BigInt((await client.core.getBalance({ owner: player.address, coinType: config.coinType })).balance.balance);

console.log(`Funding ${player.address} with ${3n * minBet} USDC in its address balance…`);
const fund = new Transaction();
fund.moveCall({
  target: "0x2::coin::send_funds",
  typeArguments: [config.coinType],
  arguments: [fund.coin({ type: config.coinType, balance: 3n * minBet, useGasCoin: false }), fund.pure.address(player.address)],
});
await execute(client, admin, fund);

const before = await usdc();
const pool = operator.poolId(battleId);
console.log(`Battle ${battleId}, pool ${pool}`);
await operator.openPool(battleId, BigInt(Date.now() + 10 * 60_000));
console.log(`bet side 0: ${await player.run(betTx(config, pool, 0, 2n * minBet))}`);
console.log(`bet side 1: ${await player.run(betTx(config, pool, 1, minBet))}`);
await assert.rejects(execute(client, admin, betTx(config, pool, 0, minBet)), /EBetNotSponsored|sponsor/u);

await operator.closeBetting(battleId);
await operator.settle(battleId, 0);
const settled = await operator.read(battleId);
assert.equal(settled.status, PoolStatus.settled);
const tickets = (await listTickets(client, config, player.address)).filter((t) => t.poolId === pool);
assert.equal(tickets.length, 2);
const owed = tickets.reduce((sum, ticket) => sum + payout(settled, ticket), 0n);
console.log(`claim: ${await player.run(claimTx(config, tickets))}`);

assert.equal((await usdc()) - before, owed - 3n * minBet);
assert.equal(owed - 3n * minBet, -settled.fee);
console.log(`e2e passed: fee ${settled.fee}, paid out ${owed}.`);
```

- [ ] `pnpm betting:e2e` ends with `e2e passed`. Paste its output and the published IDs in the PR body.
- [x] Commit: `test: testnet e2e for gasless betting`. Committed before running; the run above is still open.
