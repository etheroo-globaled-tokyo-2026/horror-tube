# Sui betting 4: Web betting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The web game deposits into the wallet's address balance, places real bets and claims winnings, all through main's `/tx`.

**Architecture:** `apps/web/betting.ts` builds kinds with `@horror-tube/betting` builders and sends them with the existing `/tx` helper in `wallet.ts`. Package and house IDs come from Vite env. Spec: `docs/superpowers/specs/2026-09-26-sui-betting-design.md`.

**Tech Stack:** Vite 7, `@mysten/sui`, valibot (web convention), `tsx --test`.

---

### Task 1: Deposits into the address balance

**Files:** Modify `apps/web/wallet.ts`, `apps/web/coinbox.ts`, `apps/web/tests/wallet.test.ts`

- [ ] Failing test: `usdcDeposit(to, units).getData()` has one `0x2::coin::send_funds` MoveCall with USDC as its type argument and `to` as the address input.
- [ ] `wallet.ts`:

```ts
export function usdcDeposit(to: string, units: bigint): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: "0x2::coin::send_funds",
    typeArguments: [USDC_TYPE],
    arguments: [coinWithBalance({ type: USDC_TYPE, balance: units, useGasCoin: false }), tx.pure.address(to)],
  });
  return tx;
}
```

- [ ] `coinbox.ts` `deposit()`: `usdcDeposit(wallet.address, …)` instead of `usdcTransfer`.
- [ ] Manual: deposit 5 USDC from Slush, then open the drawer → the coin return succeeds.
- [ ] Commit: `fix: deposit USDC into the game wallet's address balance`.

### Task 2: `betting.ts`

**Files:** Create `apps/web/betting.ts`, `apps/web/tests/betting.test.ts`; modify `apps/web/package.json`, `apps/web/wallet.ts`, `.env.example`, CI `docker` job, `Dockerfile` build args, `terraform/app.tf`

- [ ] `"@horror-tube/betting": "workspace:*"`.
- [ ] Build-time env: `VITE_BETTING_PACKAGE_ID`, `VITE_BETTING_HOUSE_ID` (same values as the server's), added like `VITE_SEPOLIA_RPC_URL` in `.env.example`, the Dockerfile `ARG`/`ENV` and required-check, CI `--build-arg`, Terraform `BUILD_TIME` env.
- [ ] `wallet.ts`: extract the body of `sendUsdc` into `export async function runKind(wallet, tx, fetchImpl = fetch): Promise<string>` (set sender, build with `client: wallet.client`, `onlyTransactionKind: true`, `assumeSufficientAddressBalances: true`, POST `/tx`, wait, return the digest). `sendUsdc` calls it.
- [ ] Failing test: `placeBet` sends one `/tx` whose kind calls `<package>::betting::bet` with side and amount (fake `fetch` capturing the body; decode with `Transaction.fromKind`).
- [ ] `betting.ts`:

```ts
import { betTx, claimTx, getPool, listTickets, PoolStatus, type ContractIds } from "@horror-tube/betting";
import { runKind, USDC_TYPE, type GameWallet } from "./wallet.ts";

function contractIds(): ContractIds {
  const packageId = import.meta.env.VITE_BETTING_PACKAGE_ID;
  const houseId = import.meta.env.VITE_BETTING_HOUSE_ID;
  if (!packageId || !houseId)
    throw new Error("VITE_BETTING_PACKAGE_ID and VITE_BETTING_HOUSE_ID are required at build time. See .env.example.");
  return { packageId, houseId, coinType: USDC_TYPE };
}

export const placeBet = (wallet: GameWallet, poolId: string, side: 0 | 1, units: bigint, fetchImpl: typeof fetch = fetch) =>
  runKind(wallet, betTx(contractIds(), poolId, side, units), fetchImpl);

export async function claimAll(wallet: GameWallet): Promise<number> {
  const ids = contractIds();
  const finished = [];
  for (const ticket of await listTickets(wallet.client, ids, wallet.address)) {
    const pool = await getPool(wallet.client, ticket.poolId);
    if (pool !== null && pool.status !== PoolStatus.open) finished.push(ticket);
  }
  if (finished.length > 0) await runKind(wallet, claimTx(ids, finished));
  return finished.length;
}
```

- [ ] Tests and typecheck pass. Commit: `feat: web bets and claims through /tx`.

### Task 3: Real bets in the round

**Files:** Modify `apps/web/game.ts`, `apps/web/main.ts`

- [ ] `act === "bet"`: needs `state.poolId`; `placeBet(wallet, state.poolId, side, toUsdcUnits(S.amt))`; set `S.bet` only after it resolves; a thrown message goes to `log(…, "t-lost")` and `note(…)`. No local credit change: the meter reads the chain.
- [ ] BET shows as unavailable until `poolId` is set ("OPENING THE BOOK").
- [ ] Odds: `odds([BigInt(pool[0]), BigInt(pool[1])], 200n, side)` from `@horror-tube/betting` over `RoundState.pool`; fee bps from `VITE_BET_FEE_BPS`, added with the other build-time env.
- [ ] Settle: delete the local payout math; show COLLECT when `claimAll` has something to claim; `act === "claim"` → `claimAll`.
- [ ] Delete the simulated pool growth.
- [ ] Manual on testnet: two browsers, two World ID sessions, one bet per side; the winner collects, the loser sees the loss, the pool on chain matches the TV.
- [ ] Commit: `feat: bets and claims in the live round`.
