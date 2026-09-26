# Sui betting 5: Retire Sepolia BattleBetting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the Sepolia betting contract and everything that exists only for it.

**Architecture:** Starts after `pnpm betting:e2e` passes (plan 2). One commit.

**Tech Stack:** git.

---

### Task 1: Delete

- [ ] `git rm -r packages/contracts` (removes both submodules). Remove their `.gitmodules` entries; delete the file if empty.
- [ ] `.github/workflows/ci.yml`: delete the `contracts` job.
- [ ] `Dockerfile`: delete the `packages/contracts/package.json` copy.
- [ ] Root `package.json`: delete the `contracts:*` scripts.
- [ ] `.oxlintrc.json`, `.oxfmtrc.json`, `.gitignore`: delete `packages/contracts` entries.
- [ ] `.env.example`: delete `OPERATOR_ADDRESS`, `TREASURY_ADDRESS`, `MIN_BET_WEI`, `BATTLE_BETTING_ADDRESS` (keep `BET_FEE_BPS`: the Sui deploy reads it).
- [ ] `docs/battle-betting.md` → `docs/sui-betting.md`: package location, objects, economics, roles and keys, env table, deploy steps, `pnpm betting:*` commands, testnet IDs. Durable facts only, from the spec.
- [ ] `docs/PLAN.md`: the "Betting contract" row, the "Smart contract" bullet, flow steps 7, 8 and 10, the ENS prize row "The contract pays out from ENS state", and the "Betting" section → Sui, linking `docs/sui-betting.md`.
- [ ] Delete merged work docs: `docs/superpowers/specs/2026-09-26-battle-betting-design.md`, `docs/superpowers/plans/2026-09-26-battle-betting.md`.
- [ ] `rg -n -i "BattleBetting|packages/contracts|forge|MIN_BET_WEI"` → hits only in applied migrations. `pnpm install`, `pnpm test`, `pnpm typecheck`, `pnpm lint` pass.
- [ ] Commit: `chore: retire the Sepolia betting contract`.
