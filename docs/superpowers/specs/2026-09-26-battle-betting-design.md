# Battle betting contract

Parimutuel betting on Horror Tube battles. One contract, `BattleBetting`, on
Eth Sepolia, holds every battle. Bets are in Sepolia ETH. The winner comes from
ENS: the fighter whose `status` text record is `dead` lost.

## Decisions

| Topic       | Decision                                                                        | Why                                                                                          |
| ----------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Chain       | Eth Sepolia only                                                                | ENSv2 is on Sepolia. World ID proofs are checked on our server, so nothing needs World Chain |
| Contracts   | One contract for all battles                                                    | One address for the app; no per-battle deploys                                               |
| Winner      | Read from ENS, not sent by the backend                                          | ENS is the only record of who died, so bets can't disagree with the game                     |
| World ID    | Gate stays in the app (PR #21); any wallet can bet                              | Sepolia has no World ID 4 verifier; a contract-side gate can come later with a redeploy      |
| Fee         | 2% of the losing side, taken at settlement                                      | A winning bet always returns at least its stake                                              |
| Minimum bet | `0.00001 ETH` at deploy (about 2.7¢ at $2,689, 2026-09-26); admin can change it | "A few cents"; ETH price moves                                                               |
| Roles       | Admin and operator                                                              | The backend's hot key can open and cancel battles but can't touch fees or treasury money     |
| Upgrades    | None; redeploy to change                                                        | Greenfield, nothing depends on the address yet                                               |

## Battle lifecycle

| Step              | Who                     | Call                                       | Effect                                                                                                                      |
| ----------------- | ----------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 1                 | Operator                | `openBattle(fighterA, fighterB, closesAt)` | `closesAt` must be in the future. New battle id (1, 2, 3, …); betting opens; the current fee rate is locked into the battle |
| 2                 | Anyone                  | `placeBet(battleId, fighter)` + ETH        | Adds to the caller's stake on fighter 0 or 1 while `block.timestamp < closesAt`                                             |
| 3                 | —                       | —                                          | Betting closes by time; no transaction                                                                                      |
| 4                 | Backend's ENS agent key | ENS `setText`                              | Loser's `status` becomes `dead` (PLAN.md step 10)                                                                           |
| 5                 | Anyone                  | `settleBattle(battleId)`                   | Allowed once `block.timestamp >= closesAt`. Reads both fighters' `status`; exactly one `dead` → the other fighter wins      |
| 6                 | Each bettor             | `claim(battleId)`                          | Pays winnings or a refund, once per bettor per battle                                                                       |
| any time before 5 | Operator                | `cancelBattle(battleId)`                   | Battle cancelled; everyone can claim a full refund                                                                          |

Statuses: `Open` → `Settled` or `Cancelled`. Settling or cancelling a battle that
is not `Open` reverts.

## Bets and payouts

- A bet must be at least `minBet`. A wallet may bet more than once and on both
  fighters; its stakes add up per fighter.
- `W` = total staked on the winner, `L` = total staked on the loser.
- Normal case (`W > 0` and `L > 0`): `fee = L × feeBps / 10_000`. A winning stake
  `s` pays `s × (W + L − fee) / W`, rounded down. Losers get nothing.
- Refund cases, no fee: the battle was cancelled, or it settled with `W == 0` or
  `L == 0`. Everyone gets back all their stakes in that battle.
- Rounding leaves at most 1 wei per winning bettor in the contract. It is not
  swept.
- `claim` with nothing owed reverts `NothingToClaim`; a second claim reverts
  `AlreadyClaimed`. Payouts use a plain call with all gas, so smart accounts can
  receive them.

Worked example: Alice 0.03 and Bob 0.01 on Jason, Carol 0.04 on Freddy, Jason
wins. Fee = 2% × 0.04 = 0.0008. Alice gets 0.0594, Bob 0.0198, Carol nothing.

## Roles and treasury

| Role                         | Holder at deploy         | Can                                                                                          |
| ---------------------------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| Admin (`DEFAULT_ADMIN_ROLE`) | Deployer (`PRIVATE_KEY`) | `setFeeBps` (max 1000 = 10%), `setTreasury`, `setMinBet`, `withdrawFees`, grant/revoke roles |
| Operator (`OPERATOR_ROLE`)   | `OPERATOR_ADDRESS`       | `openBattle`, `cancelBattle`                                                                 |

- Fees accrue in `accruedFees`, counted apart from bettors' money.
  `withdrawFees()` sends all of it to `treasury` and reverts
  `NothingToWithdraw` when it is zero. Paying the treasury at settlement would
  let a treasury that rejects ETH block settlement.
- Setter limits: fee at most 1000 bps, treasury not the zero address, minimum
  bet above zero. The constructor applies the same limits and also rejects a
  zero admin, operator or resolver address.
- A new fee rate applies only to battles opened after the change.
- Nobody can pick a winner or move bettors' stakes.

## Reading ENS

- The constructor takes `ENS_LABEL` (e.g. `horrortube`). The parent name is
  `<ENS_LABEL>.eth`; a fighter's name is `<fighter>.<ENS_LABEL>.eth`.
- Fighter node = `keccak256(parentNode, keccak256(fighter))`. The contract builds
  the DNS-encoded name itself, so the name and node can't disagree.
- Lookup: `UniversalResolverV2.resolve(dnsName, text(node, "status"))`, then
  decode a string. Only the exact value `dead` means dead.
- The resolver address is `UniversalResolverV2` from
  `packages/ens/scripts/pin/sepolia-addresses.md`, the pinned ENS deployment. The upgradeable
  `0xeEeE…` proxy is not used, so an ENS upgrade can't change what the contract
  reads mid-battle.
- Fighter labels passed to `openBattle` must be 1–63 bytes of `a-z`, `0-9`, `-`,
  and the two must differ. Anything else can't form a valid ENS name.
- Settle errors: `NoFighterDead`, `BothFightersDead` (operator cancels),
  `EnsLookupFailed(battleId, fighter, reason)` carrying ENS's revert data.

Checked on Sepolia on 2026-09-26: `horrortube.eth` resolves through the pinned
resolver; the unregistered `jason.horrortube.eth` returns an empty `status`
through the parent's resolver instead of an error; the test wallet owns
`horrortube.eth` and may `setText` on its resolver.

### Rules for the backend

1. Open battles only for registered fighters. An unregistered name reads as
   alive, so its battle can never settle and must be cancelled.
2. Mark the loser `dead` only after `closesAt`. Earlier, the result is public
   on chain while bets are open.
3. Never set `status` on the resolver's default record (root name `0x00`).
   Every name without its own record reads the default, so every unregistered
   fighter would read `dead`.
4. Call `settleBattle` after the ENS update. Anyone may call it.

## Events and reads

- Events: `BattleOpened(battleId, fighterA, fighterB, closesAt, feeBps)`,
  `BetPlaced(battleId, bettor, fighter, amount)`,
  `BattleSettled(battleId, winner, fee)`, `BattleCancelled(battleId)`,
  `Claimed(battleId, bettor, amount)`, `FeesWithdrawn(treasury, amount)`,
  `FeeBpsSet`, `TreasurySet`, `MinBetSet`.
- Views: `getBattle(battleId)` (fighters, `closesAt`, `feeBps`, status, winner,
  totals), `stakesOf(battleId, bettor)`, `claimable(battleId, bettor)`,
  `fighterNode(fighter)`.

Issue #6 tables that move on chain: `battles` (battle record), `stakes` (stakes
per wallet per fighter), `settlements` (settle transaction and event). The World
ID `nullifier` and `characters_cache` stay off chain.

## Repo layout and config

Workspace package `@horror-tube/contracts` in `packages/contracts/`:

```
foundry.toml
src/BattleBetting.sol
script/DeployBattleBetting.s.sol
script/E2eBattleBetting.s.sol     real transactions against a deployment
script/PinnedEns.sol              reads addresses from packages/ens/scripts/pin/sepolia-addresses.md
test/unit/                        unit and fuzz tests, stand-in resolver
test/fork/BattleBettingEns.t.sol  Sepolia fork test against real ENS
lib/                              forge-std v1.16.2, OpenZeppelin v5.7.0 (git submodules)
broadcast/                        committed deploy records
```

- Compiler: solc 0.8.37.
- Foundry only loads `.env` from the directory it runs in and the one holding
  `foundry.toml` (tested). The package scripts that need `.env` run forge from the
  repo root with `--root packages/contracts`; `forge test` needs no `.env`.
- `.env` is gitignored (`.env`, `.env.*`, except `.env.example`).
- `[rpc_endpoints] sepolia = "${SEPOLIA_RPC_URL}"`.
- `fs_permissions` allows reading `../ens/scripts/pin`.
- CI job `contracts`: `forge fmt --check` and `forge test` on Foundry v1.5.1.
- Env vars, all required; a missing or blank one stops the script with its name:

| Variable           | Use                                   |
| ------------------ | ------------------------------------- |
| `PRIVATE_KEY`      | Deployer; becomes admin               |
| `SEPOLIA_RPC_URL`  | Sepolia RPC for deploy and fork tests |
| `ENS_LABEL`        | Parent label (`horrortube`)           |
| `OPERATOR_ADDRESS` | Operator role                         |
| `TREASURY_ADDRESS` | Fee destination                       |
| `BET_FEE_BPS`      | Fee in basis points (`200`)           |
| `MIN_BET_WEI`      | Minimum bet (`10000000000000`)        |

For this deploy, operator and treasury are the test wallet
`0x3B9Fd8d65B008709c9DF511295F56980E7C32D02`.

pnpm scripts:

| Script                | Runs                                                                             |
| --------------------- | -------------------------------------------------------------------------------- |
| `contracts:test`      | `forge test` (unit and fuzz; fork tests excluded)                                |
| `contracts:test:fork` | `FOUNDRY_PROFILE=fork forge test` (fork tests only)                              |
| `contracts:deploy`    | `forge script` with `--rpc-url sepolia --broadcast --verify --verifier sourcify` |
| `contracts:e2e`       | `forge script` against `BATTLE_BETTING_ADDRESS` with `--broadcast`               |

## Testing

- **Unit tests** with a stand-in Universal Resolver whose `status` per node and
  revert behaviour the test sets:
  - Open: operator only; `closesAt` in the past; bad or duplicate labels; ids
    increment.
  - Bet: below minimum; at or after `closesAt`; unknown or non-open battle; bad
    fighter index; stakes add up; both fighters allowed.
  - Settle: before `closesAt`; neither dead; both dead; ENS revert wrapped with
    the fighter; either fighter dead picks the other; callable by anyone; not
    twice, not after cancel.
  - Payouts: the worked example; fee accrual; both refund cases pay back all
    stakes with no fee; loser `NothingToClaim`; double claim; `claimable` equals
    what `claim` pays.
  - Treasury: admin-only setters; fee cap; a battle keeps its opening fee;
    `withdrawFees` pays the current treasury.
  - `fighterNode("jason")` equals `vm.ensNamehash("jason.horrortube.eth")`.
- **Fuzz test**: random stakes from several wallets and a random loser. Total
  paid out plus fee never exceeds the pool, and what's left over is at most 1 wei
  per winning bettor.
- **Fork test** (profile `fork`, needs `SEPOLIA_RPC_URL`, fails if it is
  missing): deploy against the pinned resolver, open `jason` vs `freddy`, bet,
  warp past `closesAt`, confirm settle reverts `NoFighterDead`, impersonate the
  owner of `horrortube.eth` (from `ETHRegistry.findOwner`) to `setText` Freddy's
  `status` to `dead` on the resolver address that the Universal Resolver
  returns for Freddy's name, settle, confirm Jason won, claim.
- **Live deploy**: deploy to Sepolia with the test key, verify the source on
  Sourcify, and read admin, operator, treasury, fee, minimum bet and
  `fighterNode` back with `cast`.

## Docs

- New `docs/battle-betting.md`: lifecycle, payout rules, the backend rules,
  env vars, commands, deployed address.
- `docs/PLAN.md` Betting section: fee, minimum bet, ENS settlement.
- `.env.example`: new variable names, empty.

## Out of scope

- A World ID check in the contract (a server-signed bet pass is the likely
  follow-up).
- Registering character subnames (#23).
- ABI export, indexer, frontend and backend integration.
- Batch claims, sweeping rounding dust, upgradeability, other chains.

## Risks

- ENSv2 is beta. If ENS redeploys and `horrortube.eth` moves to the new stack,
  redeploy `BattleBetting` with the new pinned resolver.
- The server knows the winner while bets are open (accepted in PLAN.md).
