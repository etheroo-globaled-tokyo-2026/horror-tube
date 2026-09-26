# Sui betting 3: Server operator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The game server opens, closes, settles and cancels a Sui pool for every battle, and pushes the pool's totals in `RoundState`.

**Architecture:** `apps/server` depends on `@horror-tube/betting` (built package). A `BettingSync` watches `GameLoop` state each tick and calls the operator; the battle queue's settle port calls `operator.settle`. Bets and claims keep using main's `/tx` + Shinami path. Spec: `docs/superpowers/specs/2026-09-26-sui-betting-design.md`.

**Tech Stack:** Node 22, `node:http`, valibot (server convention), `@horror-tube/betting`, `tsx --test`.

---

### Task 1: Dependency and env

**Files:** Modify `apps/server/package.json`, `apps/server/src/index.ts`, `.env.example`, CI `docker` job, `terraform/app.tf`, `terraform/variables.tf`, `terraform/README.md`

- [ ] `"@horror-tube/betting": "workspace:*"`; `pnpm install`.
- [ ] `index.ts`: `const betting = readBettingConfig();` next to the other env reads, plus `readKeypair("SUI_OPERATOR_PRIVATE_KEY")` and `requiredEnv("SUI_OPERATOR_CAP_ID")`; build `createOperator(createChain(client, signer), betting, cap)`. Missing values fail at startup, naming the variable.
- [ ] CI `docker` job: pass `SUI_NETWORK`, `SUI_GRPC_URL`, `SUI_USDC_TYPE`, `BETTING_PACKAGE_ID`, `BETTING_HOUSE_ID`, `SUI_OPERATOR_CAP_ID` (public, from the deploy) and a throwaway `SUI_OPERATOR_PRIVATE_KEY` generated in the job:

```bash
SUI_OPERATOR_PRIVATE_KEY="$(docker run --rm --entrypoint node -w /app/apps/server horror-tube:ci -e 'import("@mysten/sui/keypairs/ed25519").then((m) => console.log(m.Ed25519Keypair.generate().getSecretKey()))')"
```

- [ ] Terraform: one `env` block per variable, `RUN_TIME`; `SECRET` for the operator key, `GENERAL` for the rest; a `variable` each (no default); README table rows and `export TF_VAR_…` lines.
- [ ] Commit: `feat: server reads the Sui betting config`.

### Task 2: Battle ID and pool in `RoundState`

**Files:** Modify `apps/server/src/types.ts`, `apps/server/src/game/loop.ts`, `apps/server/tests/game-loop.test.ts`, `docs/game-loop.md`

- [ ] Failing tests in `game-loop.test.ts`: entering `bet` sets a fresh non-empty `battleId` (different for the next bout) and `poolId: null`; `setPool(battleId, poolId, totals)` updates `poolId` and `pool` only while that battle is live; after `settle` → `vote`, both reset to `null`.
- [ ] `RoundState`: add `battleId: string | null` and `poolId: string | null`; `pool` holds totals in USDC base units.
- [ ] `GameLoop`: set `battleId = randomUUID()` wherever the phase becomes `bet` (`closeVoting` and the rotation path); add `setPool`. Delete `bet(side, amount)`, its route in `server.ts` and its tests: bets are on chain.
- [ ] `docs/game-loop.md` "Server contract": the new fields; `bet(side, amount)` action replaced by "bets go to Sui through `/tx`"; the operator table from the spec.
- [ ] Tests pass. Commit: `feat: battle and pool IDs in the round state`.

### Task 3: `BettingSync`

**Files:** Create `apps/server/src/betting-sync.ts`, `apps/server/tests/betting-sync.test.ts`; modify `apps/server/src/index.ts`

- [ ] Failing tests with a fake operator (records calls; can be told to fail once) and plain `RoundState` objects:
  - phase `bet` with a new `battleId` → one `openPool(battleId, now + videoTimeout)`; then `setPool` gets the pool ID and totals.
  - `bet` → `fight` → one `closeBetting`.
  - `bet` with `error` set → one `cancel`.
  - an operator failure is logged with the battle ID and retried after the backoff, not every tick.
- [ ] `betting-sync.ts`: `createBettingSync({ operator, game, videoTimeoutMs, now, log })` returning `observe(state: RoundState)`. It keeps per-battle `{ opened, closed, cancelled, inFlight, retryAt }`, starts at most one operator call per battle at a time, and during `bet` reads `operator.read(battleId)` every 2 s and calls `game.setPool(battleId, poolId, [Number(a), Number(b)])`.
- [ ] `index.ts`: call `sync.observe(game.state())` in the existing tick.
- [ ] Tests pass. Commit: `feat: drive Sui pools from the game loop`.

### Task 4: Settle through the battle queue

**Files:** Modify `packages/fight/src/battle-queue.ts`, its tests, and the server's `ChainWritePorts` implementation

- [ ] `ChainWritePorts.settleBattle(battleId)` → `settleBattle(battleId: string, winningSide: 0 | 1)`. `settleQueuedBattle` passes `record.winnerSubname === record.fighterASubname ? 0 : 1` and throws when the winner is neither fighter. Update the fight package tests.
- [ ] Server port: `settleBattle: async (battleId, side) => { await operator.settle(battleId, side); return <settle digest> }`. Have `operator.settle` return the digest (the Sepolia hash's replacement in `settlement_tx_hash`).
- [ ] The queue's `battleId` must be `RoundState.battleId` for that bout. Wherever the server enqueues the battle result, pass it.
- [ ] Tests pass. Commit: `feat: settle Sui pools from the battle queue`.

### Task 5: Policy accepts real bet and claim kinds

**Files:** Modify `apps/server/tests/tx-policy.test.ts` (create it if missing)

- [ ] Build kinds offline with `betTx`/`claimTx` from `@horror-tube/betting`, the house, pool and ticket given as `Inputs.SharedObjectRef` / `Inputs.ObjectRef`, sender set, `tx.build({ onlyTransactionKind: true, assumeSufficientAddressBalances: true })`. Assert `assertSponsorableKind(toBase64(kind), sender, usdcType, packageId)` doesn't throw for both, and throws 403 for the same bet against another package ID.
- [ ] If a bet kind is rejected, change `tx-policy.ts` so that the USDC coin from `redeem_funds` may be an argument of a betting-package call, and add that case.
- [ ] Commit: `test: tx policy accepts betting kinds`.
