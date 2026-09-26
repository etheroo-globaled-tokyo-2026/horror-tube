# Battle betting contract

`BattleBetting` (`contracts/src/BattleBetting.sol`) takes parimutuel bets on Horror Tube
battles in Sepolia ETH. It settles from ENS: the fighter whose `status` text record reads
`dead` lost.

## Deployment

| Network     | Contract                                                                                                                        | Deploy transaction                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Eth Sepolia | [`0x6420e9Af4F01Adc49178b8CfF708884AE763C674`](https://sepolia.etherscan.io/address/0x6420e9Af4F01Adc49178b8CfF708884AE763C674) | [`0x5c71…bc9d`](https://sepolia.etherscan.io/tx/0x5c7152478e208a8e6ee6edf8407296aece9a0a62d7627d0808775d9ab15cbc9d) |

- Source verified on Sourcify. Deploy records are in `contracts/broadcast/`.
- Parent name `horrortube.eth`; fighters are read at `<fighter>.horrortube.eth`.
- ENS reads go through `UniversalResolverV2` from `scripts/pin/sepolia-addresses.md`, not
  ENS's upgradeable proxy, so an ENS upgrade can't change what an open battle reads. If ENS
  redeploys and the parent name moves, redeploy this contract.
- The app picks the deployment through `BATTLE_BETTING_ADDRESS`.

## Battle lifecycle

| Step     | Who                     | Call                                       | Effect                                                                                       |
| -------- | ----------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 1        | Operator                | `openBattle(fighterA, fighterB, closesAt)` | New battle id (1, 2, 3, …); betting opens; the current fee rate is locked into the battle    |
| 2        | Anyone                  | `placeBet(battleId, fighter)` with ETH     | Adds to the caller's stake on fighter 0 or 1 until `closesAt`                                |
| 3        | Backend's ENS agent key | ENS `setText`                              | The loser's `status` becomes `dead`                                                          |
| 4        | Anyone                  | `settleBattle(battleId)`                   | After `closesAt`, reads both fighters' `status`; exactly one `dead` → the other fighter wins |
| 5        | Each bettor             | `claim(battleId)`                          | Pays winnings or a refund, once per bettor per battle                                        |
| Before 4 | Operator                | `cancelBattle(battleId)`                   | Everyone can claim a full refund                                                             |

Settling reverts with `NoFighterDead` (retry after the ENS update), `BothFightersDead`
(cancel the battle) or `EnsLookupFailed(battleId, fighter, reason)` carrying ENS's revert data.

## Payouts

- Bets must be at least `minBet`. Stakes add up per wallet per fighter; a wallet may back both.
- `W` = staked on the winner, `L` = staked on the loser, fee = `L × feeBps / 10000`. A winning
  stake `s` pays `s × (W + L − fee) / W`, so a winning bet never returns less than its stake.
  Losers get nothing.
- No fee and full refunds when the battle is cancelled or either fighter had no backers.
- Payouts round down; the remainder (at most 1 wei per winning bettor) stays in the contract.

Example: Alice 0.03 and Bob 0.01 on Jason, Carol 0.04 on Freddy, Jason wins. The fee is
0.0008; Alice gets 0.0594 and Bob 0.0198.

## Roles and treasury

| Role                         | Can                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| Admin (`DEFAULT_ADMIN_ROLE`) | `setFeeBps` (at most 1000 = 10%), `setTreasury`, `setMinBet`, `withdrawFees`, grant and revoke roles |
| Operator (`OPERATOR_ROLE`)   | `openBattle`, `cancelBattle`                                                                         |

- Fees accrue in `accruedFees` until the admin calls `withdrawFees()`, which sends them to
  `treasury`.
- A fee change applies only to battles opened after it.
- Nobody can pick a winner or move bettors' stakes.

## Rules for the backend

1. Open battles only for registered fighters. ENS answers an unregistered subname with an
   empty `status` through the parent's resolver, so it reads as alive and the battle can never
   settle.
2. Mark the loser `dead` only after `closesAt`; earlier, the result is public while bets are
   open.
3. Never set `status` on the resolver's default record (root name `0x00`). Every name without
   its own record reads the default, so every unregistered fighter would read `dead`.
4. Call `settleBattle` after the ENS update. Anyone may call it.
5. Fighter labels are 1–63 bytes of `a-z`, `0-9` and `-`.
6. Skip cancelled battles in the UI. `pnpm contracts:e2e` leaves cancelled `e2e-a` vs `e2e-b`
   battles on the deployment.

## Reading state

- Views: `getBattle(battleId)`, `stakesOf(battleId, bettor)`, `claimable(battleId, bettor)`,
  `fighterNode(fighter)`, `nextBattleId`, `accruedFees`, `feeBps`, `minBet`, `treasury`.
- Events: `BattleOpened`, `BetPlaced`, `BattleSettled`, `BattleCancelled`, `Claimed`,
  `FeesWithdrawn`, `FeeBpsSet`, `TreasurySet`, `MinBetSet`.

## Setup and commands

After cloning, run `git submodule update --init --recursive`; forge-std and OpenZeppelin are
submodules in `contracts/lib/`. `foundry.toml` sits at the repo root so Foundry reads the root
`.env`.

| Command                    | What it does                                                                                                                                                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm contracts:test`      | Unit and fuzz tests with a stand-in ENS resolver                                                                                                                                                                                                                |
| `pnpm contracts:test:fork` | Settles a battle on a Sepolia fork against the real ENS contracts                                                                                                                                                                                               |
| `pnpm contracts:deploy`    | Deploys with the `.env` settings and verifies the source on Sourcify                                                                                                                                                                                            |
| `pnpm contracts:e2e`       | Real transactions against `BATTLE_BETTING_ADDRESS`: checks its ENS settings and the wallet's operator role, then opens an `e2e-a` vs `e2e-b` battle, bets on both, cancels it and claims the refund. The same `forge script` without `--broadcast` simulates it |

## Environment

All are required by the commands that use them; a missing or blank value stops the command
with the variable's name.

| Variable                 | Used by                | Meaning                                                                |
| ------------------------ | ---------------------- | ---------------------------------------------------------------------- |
| `PRIVATE_KEY`            | deploy, e2e            | Deployer, who becomes admin; the e2e wallet, which must be an operator |
| `SEPOLIA_RPC_URL`        | deploy, fork test, e2e | Sepolia RPC                                                            |
| `ENS_LABEL`              | deploy, fork test, e2e | Parent label, e.g. `horrortube`                                        |
| `OPERATOR_ADDRESS`       | deploy                 | Gets `OPERATOR_ROLE`                                                   |
| `TREASURY_ADDRESS`       | deploy                 | Fee destination                                                        |
| `BET_FEE_BPS`            | deploy                 | Fee in basis points (`200` = 2%)                                       |
| `MIN_BET_WEI`            | deploy                 | Minimum bet in wei                                                     |
| `BATTLE_BETTING_ADDRESS` | e2e, app               | Deployment to use                                                      |
