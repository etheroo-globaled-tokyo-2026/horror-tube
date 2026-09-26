# Sui betting 4: Web betting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The remote places real bets, the TV shows the real pool, OK collects real winnings, and deposits land where `/tx` can spend them.

**Architecture:** The UI stays as it is: hold A/B on the remote to bet, VOL ± for the stake, OK to collect, the coin box for money. Only the handlers behind it change. A new `apps/web/betting.ts` builds kinds with `@horror-tube/betting` and sends them through the existing `/tx` helper. IDs come from `GET /betting` (plan 3). Spec: `docs/superpowers/specs/2026-09-26-sui-betting-design.md`.

**Tech Stack:** Vite 7, `@mysten/sui`, valibot (web convention), `tsx --test`.

## Where it goes (main as of `f572a81`)

| What | Where now | Change |
| --- | --- | --- |
| Hold A/B to bet | `main.ts` `holdStart` → 8 ticks → clicks `#h-bet` | None |
| Bet handler | `game.ts` `act === "bet"` → `postBet(side, S.amt)` (off-chain `POST /bet`), `S.credit -= S.amt` | `placeBet(wallet, S.poolId, side, units)` through `/tx`; no local credit change |
| Round state | `round-client.ts` `ServerRoundState`, `game.ts` `applyRoundState` | Add `battleId`, `poolId`; delete `postBet` |
| Bet screen | `main.ts` `S.phase === "bet"` block: `pays ×odds`, `HOLD A OR B TO BET`, hint `STAKE VOL ± · BET HOLD A / B` | `OPENING THE BOOK` while `poolId` is null; odds net of the fee |
| Odds | `odds.ts` `formatPoolOdds(S.pool, side)` | Subtract the fee from the losing side |
| Settle screen | `main.ts` settle block: `PRESS OK TO COLLECT`, `YOU LOST` from `S.claim` / `S.result` | Values come from the wallet's tickets |
| Collect | `main.ts` `ok()` → `#h-claim` → `game.ts` `act === "claim"` (adds to local credit) | `claimAll(wallet)` through `/tx` |
| Credit | `main.ts` `chainCredit` sync adds deltas to `S.credit` | `S.credit` = the coin box balance |
| Deposit | `coinbox.ts` `deposit()` → `usdcTransfer` (coin objects `/tx` can't spend) | `send_funds` into the address balance |
| Wallet | `main.ts` `mountCoinBox` → `getGameWallet()`; `game.ts` has no wallet | `mountCoinBox` calls `setWallet(wallet)` in `game.ts` |

---

### Task 1: Deposits into the address balance

**Files:** Modify `apps/web/wallet.ts`, `apps/web/coinbox.ts`, `apps/web/tests/wallet.test.ts`

- [x] Failing test: `usdcDeposit(to, units).getData()` has one `0x2::coin::send_funds` MoveCall, USDC type argument, `to` as the address input.
- [x] `wallet.ts`:

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

- [x] `coinbox.ts` `deposit()`: `usdcDeposit(wallet.address, toUsdcUnits(dollars))`.
- [ ] Manual: deposit 5 USDC from Slush, open the drawer → the coin return succeeds.
- [x] Commit: `fix: deposit USDC into the game wallet's address balance`.

### Task 2: `betting.ts`

**Files:** Create `apps/web/betting.ts`, `apps/web/tests/betting.test.ts`; modify `apps/web/package.json`, `apps/web/wallet.ts`

- [x] `"@horror-tube/betting": "workspace:*"`.
- [x] `wallet.ts`: extract `sendUsdc`'s body into `export async function runKind(wallet: GameWallet, tx: Transaction, fetchImpl: typeof fetch = fetch): Promise<string>` (sender, `onlyTransactionKind`, `assumeSufficientAddressBalances`, POST `/tx`, wait, return the digest); `sendUsdc` calls it.
- [x] Failing tests (fake `fetch`): `placeBet` posts one `/tx` whose kind (`Transaction.fromKind`) calls `<package>::betting::bet` with the side.
- [ ] Test: `claimable` sums `payout` over finished pools' tickets and ignores open ones.
- [x] `betting.ts`:

```ts
import { betTx, claimTx, getPool, listTickets, payout, PoolStatus, type ContractIds, type Ticket } from "@horror-tube/betting";
import * as v from "valibot";
import { runKind, type GameWallet } from "./wallet.ts";

const BettingIds = v.object({ packageId: v.string(), houseId: v.string(), coinType: v.string(), feeBps: v.number() });
export type BettingIds = v.InferOutput<typeof BettingIds>;

export async function fetchBettingIds(fetchImpl: typeof fetch = fetch): Promise<BettingIds> {
  const res = await fetchImpl("/betting");
  if (!res.ok) throw new Error(`GET /betting failed: HTTP ${String(res.status)} ${await res.text()}`);
  return v.parse(BettingIds, await res.json());
}

export const placeBet = (wallet: GameWallet, ids: ContractIds, poolId: string, side: 0 | 1, units: bigint, fetchImpl: typeof fetch = fetch) =>
  runKind(wallet, betTx(ids, poolId, side, units), fetchImpl);

export async function claimable(wallet: GameWallet, ids: ContractIds): Promise<{ tickets: Ticket[]; units: bigint; lost: bigint }> {
  const tickets: Ticket[] = [];
  let units = 0n;
  let lost = 0n;
  for (const ticket of await listTickets(wallet.client, ids, wallet.address)) {
    const pool = await getPool(wallet.client, ticket.poolId);
    if (pool === null || pool.status === PoolStatus.open) continue;
    const owed = payout(pool, ticket);
    tickets.push(ticket);
    units += owed;
    if (owed === 0n) lost += ticket.stake;
  }
  return { tickets, units, lost };
}

export const claimAll = (wallet: GameWallet, ids: ContractIds, tickets: Ticket[], fetchImpl: typeof fetch = fetch) =>
  runKind(wallet, claimTx(ids, tickets), fetchImpl);
```

- [x] Tests and typecheck pass. Commit: `feat: web betting calls through /tx`.

### Task 3: Real bets, odds and collect in the round

**Files:** Modify `apps/web/game.ts`, `apps/web/main.ts`, `apps/web/round-client.ts`, `apps/web/odds.ts`, `apps/web/tests/round-client.test.ts`, `apps/web/DESIGN.md`

- [x] `round-client.ts`: `ServerRoundState` gains `battleId: string | null`, `poolId: string | null`; delete `postBet` and its tests.
- [x] `game.ts`: `S.poolId`, `S.battleId` set in `applyRoundState`; `setWallet(wallet)` and `setBettingIds(ids)` (called from `mountCoinBox` after `fetchBettingIds()`).
- [x] `act === "bet"`: guard `S.poolId`, wallet and IDs; `await placeBet(wallet, ids, S.poolId, side, toUsdcUnits(S.amt))`; set `S.bet` after it resolves; log `BET … · <digest first 8>`; errors → `note("BET REJECTED. …", "bad")`. Delete `S.credit -= S.amt`.
- [x] `main.ts` bet block and hint: while `S.poolId === null` show `OPENING THE BOOK` and ignore `holdStart`.
- [x] `odds.ts`: `formatPoolOdds(pool, side, feeBps)` = `(a + b − loser × feeBps / 10000) / side`; update its callers and test.
- [x] Collect: on `fight → settle` in `applyRoundState` and once after the wallet mounts, run `claimable` → `S.claim = fromUsdcUnits(units)`, `S.result = −fromUsdcUnits(lost)` when nothing is owed. `act === "claim"` → `claimAll(wallet, ids, tickets)`, then `S.claim = 0`; errors → `note`.
- [x] `main.ts` `chainCredit` sync: `S.credit = usdc`.
- [x] `DESIGN.md`: bets and claims are on Sui; delete "Bets simulated today".
- [ ] Manual on testnet: two browsers, two World ID sessions, one bet per side; the winner collects, the loser sees `YOU LOST`, the TV pool matches the pool object (`pnpm betting:pool <battleId>`).
- [x] Commit: `feat: bets and claims in the live round`.
