# Sui betting 1: Move package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the Move package's tests in CI and review it before the first publish.

**Architecture:** `packages/betting/move` (module `horror_tube::betting`) and its tests are on main and pass. Spec: `docs/superpowers/specs/2026-09-26-sui-betting-design.md`.

**Tech Stack:** Sui Move 2024, Sui CLI `testnet-v1.80.1`, GitHub Actions.

---

### Task 1: CI job

**Files:** Modify `.github/workflows/ci.yml` (add a job after `server`)

- [x] Add:

```yaml
  betting-move:
    runs-on: ubuntu-latest
    env:
      SUI_RELEASE: testnet-v1.80.1
    steps:
      - uses: actions/checkout@v4
      - id: sui-cache
        uses: actions/cache@v4
        with:
          path: ~/.local/bin/sui
          key: sui-${{ env.SUI_RELEASE }}-ubuntu-x86_64
      - name: Install Sui CLI
        if: steps.sui-cache.outputs.cache-hit != 'true'
        run: |
          mkdir -p "$HOME/.local/bin"
          curl -sSfL "https://github.com/MystenLabs/sui/releases/download/${SUI_RELEASE}/sui-${SUI_RELEASE}-ubuntu-x86_64.tgz" \
            | tar -xz -C "$HOME/.local/bin" ./sui
      - run: echo "$HOME/.local/bin" >> "$GITHUB_PATH"
      - run: sui move test --path packages/betting/move
```

The release archive is about 1.1 GB, so the extracted `sui` binary is cached under the release key.

- [ ] The job passes on the PR.
- [x] Commit: `ci: run Move betting tests`.

### Task 2: Security review

- [x] Invoke the `move-security` skill on `packages/betting/move/sources/betting.move`. Check at least: every operator function calls `assert_operator`; every pool access checks `assert_owns` or the ticket's `pool_id`; a ticket can't be paid twice (`redeem` deletes it); a pool can't settle twice (`status == OPEN`); `mul_div` can't overflow (`stake ≤ W`); `withdraw_fees` needs `AdminCap`; both caps have `store` (holders can transfer them: accepted).
- [x] Fix real findings with a failing Move test first; list accepted ones in the PR body.
- [x] Commit: `fix: <finding>` per fix. No code defects found; `test: pin betting settle, cancel and house guards` covers the unguarded checks.
