# Sui betting 3: Server operator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The game server opens, closes, settles and cancels a Sui pool for every battle, serves the betting IDs, and pushes the pool in `RoundState`.

**Architecture:** `apps/server` depends on `@horror-tube/betting` (built package). A `BettingSync` watches `GameLoop` state each tick and calls the operator. The battle queue's existing settle port calls `operator.settle`. Bets and claims keep using the `/tx` + Shinami path. Spec: `docs/superpowers/specs/2026-09-26-sui-betting-design.md`.

**Tech Stack:** Node 22, `node:http`, valibot (server convention), `@horror-tube/betting`, `tsx --test`.

**Where things are on main:** `/bet` route `apps/server/src/server.ts` (`POST /bet` → `opts.game.bet`); `GameLoop.bet` in `src/game/loop.ts`; battle queue via `GameLoop.attachAgentResult(insert)` (the agent supplies `insert.battleId`) and `writeQueuedEns` → `settleQueuedBattle`; the settle port `settleBattle(battleId)` in `src/ens-chain-write.ts` throws "not implemented… Set SKIP_BATTLE_SETTLEMENT=1".

---

### Task 1: Dependency and env

**Files:** Modify `apps/server/package.json`, `apps/server/src/index.ts`, `.env.example`, CI `docker` job, `terraform/app.tf`, `terraform/variables.tf`, `terraform/README.md`

- [ ] `"@horror-tube/betting": "workspace:*"`; `pnpm install`.
- [ ] `index.ts`: `readBettingConfig()`, `readKeypair("SUI_OPERATOR_PRIVATE_KEY")`, `requiredEnv("SUI_OPERATOR_CAP_ID")` next to the other env reads; `createOperator(createChain(client, signer), config, cap)`. Missing values fail at startup, naming the variable.
- [ ] CI `docker` job: pass `SUI_NETWORK`, `SUI_GRPC_URL`, `SUI_USDC_TYPE`, `BETTING_PACKAGE_ID`, `BETTING_HOUSE_ID`, `SUI_OPERATOR_CAP_ID` (public, from the deploy) and a throwaway operator key generated in the job:

```bash
SUI_OPERATOR_PRIVATE_KEY="$(docker run --rm --entrypoint node -w /app/apps/server horror-tube:ci -e 'import("@mysten/sui/keypairs/ed25519").then((m) => console.log(m.Ed25519Keypair.generate().getSecretKey()))')"
```

- [ ] Terraform: one `env` block per variable, `RUN_TIME`; `SECRET` for the operator key, `GENERAL` for the rest; a `variable` each (no default); README rows and `export TF_VAR_…` lines.
- [ ] Commit: `feat: server reads the Sui betting config`.

### Task 2: Battle ID, pool and fee in `RoundState`; delete off-chain bets

**Files:** Modify `apps/server/src/types.ts`, `src/game/loop.ts`, `src/server.ts`, `tests/game-loop.test.ts`, `tests/server.test.ts`, `docs/game-loop.md`

- [ ] Failing tests: entering `bet` sets a fresh non-empty `battleId` (different next bout) and `poolId: null`; `setPool(battleId, poolId, totals)` updates `poolId` and `pool` only for the live battle; `attachAgentResult` with another `battleId` throws; after settle → vote both reset to `null`.
- [ ] `RoundState`: `battleId: string | null`, `poolId: string | null`; `pool` = totals in USDC base units.
- [ ] `GameLoop`: `battleId = randomUUID()` wherever the phase becomes `bet` (`closeVoting` and the rotation path); `setPool`; `attachAgentResult` requires `insert.battleId === this.battleId` (the fight pipeline gets the ID from `RoundState`).
- [ ] Delete `GameLoop.bet`, the `POST /bet` route and their tests.
- [ ] `docs/game-loop.md` "Server contract": the new fields; `bet(side, amount)` → "bets go to Sui through `/tx`"; the operator table from the spec.
- [ ] Commit: `feat: battle and pool IDs in the round state`.

### Task 3: `GET /betting`

**Files:** Modify `apps/server/src/server.ts`, `tests/server.test.ts`, `apps/web/vite.config.ts` (proxy `/betting` like `/round`)

- [ ] Failing test: `GET /betting` → `200 { packageId, houseId, coinType, feeBps }`.
- [ ] Route returns the config (`feeBps` read once from the house at startup with `getObject`; fail startup if the house is missing).
- [ ] Commit: `feat: serve the betting IDs`.

### Task 4: `BettingSync`

**Files:** Create `apps/server/src/betting-sync.ts`, `tests/betting-sync.test.ts`; modify `src/index.ts`

- [ ] Failing tests with a fake operator (records calls; can fail once) and plain `RoundState` objects:
  - phase `bet` with a new `battleId` → one `openPool(battleId, now + videoTimeout)`; then `setPool` gets the pool ID and totals.
  - `bet` → `fight` → one `closeBetting`.
  - `bet` with `error` set → one `cancel`.
  - an operator failure is logged with the battle ID and retried after the backoff, not every tick.
- [ ] `createBettingSync({ operator, game, videoTimeoutMs, now, log })` → `observe(state)`. Per battle `{ opened, closed, cancelled, inFlight, retryAt }`; at most one operator call per battle at a time; during `bet`, `operator.read(battleId)` every 2 s → `game.setPool(battleId, poolId, [Number(a), Number(b)])`.
- [ ] `index.ts`: `sync.observe(game.getState())` in the existing tick.
- [ ] Commit: `feat: drive Sui pools from the game loop`.

### Task 5: Settle through the battle queue

**Files:** Modify `packages/fight/src/battle-queue.ts` and tests, `apps/server/src/ens-chain-write.ts`, `apps/server/src/env.ts`, `.env.example`

- [ ] `ChainWritePorts.settleBattle(battleId)` → `settleBattle(battleId: string, winningSide: 0 | 1)`. `settleQueuedBattle` passes `record.winnerSubname === record.fighterASubname ? 0 : 1` and throws when the winner is neither fighter. Update fight tests.
- [ ] `ens-chain-write.ts` `settleBattle`: replace the "not implemented" throw with `operator.settle(battleId, side)`, returning the settle digest (stored in `settlement_tx_hash`). `operator.settle` returns the digest.
- [ ] Delete `SKIP_BATTLE_SETTLEMENT` (`readSkipBattleSettlement`, the loop option, `.env.example`, logs).
- [ ] Commit: `feat: settle Sui pools from the battle queue`.

### Task 6: Policy accepts real bet and claim kinds

**Files:** Create or modify `apps/server/tests/tx-policy.test.ts`

- [ ] Build kinds offline with `betTx`/`claimTx` (house and pool as `Inputs.SharedObjectRef`, ticket as `Inputs.ObjectRef`, sender set, `tx.build({ onlyTransactionKind: true, assumeSufficientAddressBalances: true })`). `assertSponsorableKind(toBase64(kind), sender, usdcType, packageId)` passes for both and throws 403 for the bet against another package ID.
- [ ] If the bet is rejected, allow the `redeem_funds` USDC coin as an argument of a betting-package call in `tx-policy.ts`, with that test case.
- [ ] Commit: `test: tx policy accepts betting kinds`.
