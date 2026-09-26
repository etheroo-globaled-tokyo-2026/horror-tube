# Sui betting

Parimutuel bets on Horror Tube battles, in USDC on Sui testnet. Sui holds only the money: pools, bets,
payouts and fees. Fighters, votes, the winner and damage stay in ENS and Postgres.

## IDs

Every deploy makes new IDs, so the live ones are in `.env`, not here. The public betting ones are also GitHub
repository variables of the same names.

| Variable              | What                                                 | Comes from                       |
| --------------------- | ---------------------------------------------------- | -------------------------------- |
| `BETTING_PACKAGE_ID`  | The published `horror_tube::betting` package         | `pnpm betting:deploy`            |
| `BETTING_HOUSE_ID`    | The house for `SUI_USDC_TYPE`                        | `pnpm betting:deploy`            |
| `SUI_OPERATOR_CAP_ID` | The server's operator cap                            | `pnpm betting:deploy`            |
| `SUI_USDC_TYPE`       | The house's coin: Circle's testnet USDC or test USDC | Set before `pnpm betting:deploy` |
| `TEST_USDC_TYPE`      | The test USDC coin type (`<package>::usdc::USDC`)    | `pnpm test-usdc:deploy`          |
| `TEST_USDC_FAUCET_ID` | The shared faucet that mints test USDC               | `pnpm test-usdc:deploy`          |

`pnpm betting:deploy` also prints `SUI_ADMIN_CAP_ID` and `SUI_E2E_OPERATOR_CAP_ID`, which stay in `.env`.

## Code

| Path                                | What                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `packages/betting/move`             | Move package `horror_tube::betting` and its tests                                                             |
| `packages/betting/src`              | `@horror-tube/betting`, built to `dist`: env, pool IDs, object readers, payout mirror, transactions, operator |
| `packages/betting/src/cli`          | `deploy`, `pool`, `e2e`, `player`                                                                             |
| `packages/test-usdc`                | `test_usdc::usdc`, a free testnet stand-in for USDC with no value, and its CLIs                               |
| `apps/server/src/battle-betting.ts` | The server's operator                                                                                         |
| `apps/server/src/tx-policy.ts`      | What `POST /tx` pays gas for: USDC to the coin box, or calls into the betting package                         |
| `apps/web/betting.ts`               | Bet and claim transactions, winnings                                                                          |

## Objects

| Object        | Owner                                                            | Fields                                                                                                                                     |
| ------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `AdminCap`    | Admin key                                                        | —                                                                                                                                          |
| `OperatorCap` | Server's operator key; a second one on the admin key for the e2e | `house_id`. Valid while its ID is in `house.operators`                                                                                     |
| `House<T>`    | Shared, one per coin type                                        | `fee_bps`, `min_bet`, `operators`, `treasury`                                                                                              |
| `Pool<T>`     | Shared, one per battle                                           | `battle_id`, `closes_at_ms`, `fee_bps` (locked at open), `status` (0 open, 1 settled, 2 cancelled), `winning_side`, `fee`, `totals`, `pot` |
| `Ticket<T>`   | Bettor                                                           | `pool_id`, `side`, `stake`                                                                                                                 |

- A pool's ID derives from its house and its battle ID (`sui::derived_object`), so the app finds a pool without an
  indexer and a battle can't get two pools. `poolId()` in `packages/betting/src/ids.ts` derives the same ID; a
  Move test and a TS test pin both to one vector.
- The battle ID is a UUID the server makes when betting opens; `battle_results.battle_id` stores it.
- Side 0 is `fighters[0]` (fighter A), side 1 is `fighters[1]` (fighter B).
- The package can't be upgraded: the publish transaction makes its `UpgradeCap` immutable, because an upgrade could
  add code that empties the pools. A fix ships as a new publish and a new house.

| Function                                                                                                      | Caller                 | Effect                                                     |
| ------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------- |
| `create_house<T>`, `issue_operator_cap`, `revoke_operator_cap`, `set_fee_bps`, `set_min_bet`, `withdraw_fees` | Admin                  | Config, operators, treasury                                |
| `open_pool(house, cap, battle_id, closes_at_ms, clock)`                                                       | Operator               | Shares the pool and locks the house's fee into it          |
| `bet(house, pool, side, coin, clock)`                                                                         | Player, via `POST /tx` | Adds the stake and sends the player a ticket               |
| `close_betting(house, cap, pool, clock)`                                                                      | Operator               | Ends betting now                                           |
| `settle(house, cap, pool, winning_side, clock)`                                                               | Operator               | After betting closes; moves the fee to the treasury        |
| `cancel(house, cap, pool)`                                                                                    | Operator               | Every ticket refunds                                       |
| `claim(pool, ticket)`                                                                                         | Ticket holder          | Pays into the holder's address balance, deletes the ticket |

## Economics

- The fee is `fee_bps` of the losing side, at most 10%. Each pool keeps the fee it opened with, so the admin's
  changes apply to later pools. A pool with stakes on only one side takes no fee.
- Bets below `min_bet` (USDC base units, 6 decimals) abort.
- With `W` staked on the winner and `L` on the loser, `fee = L × fee_bps / 10000`. A winning ticket pays
  `stake × (W + L − fee) / W`, rounded down; a losing one pays 0. Cancelled and one-sided pools refund every stake.
  Rounding dust stays in the pot.
- Fees collect in the house treasury until the admin calls `withdraw_fees`.
- Example at 2%: 30 and 10 USDC on side 0, 40 on side 1, side 0 wins. The fee is 0.8; the winning tickets pay
  59.4 and 19.8.

## Roles and keys

| Role      | Key                                                  | Holds                            | Does                                                                                                |
| --------- | ---------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| Admin     | `SUI_ADMIN_PRIVATE_KEY`, laptop only                 | `AdminCap`, the e2e operator cap | Publishes, sets fee and minimum, issues and revokes operator caps, withdraws fees, funds the e2e    |
| Operator  | `SUI_OPERATOR_PRIVATE_KEY`, on the server            | `OperatorCap`                    | Opens, closes, settles and cancels pools; pays its own gas in SUI                                   |
| Player    | Shinami Invisible Wallet, one per World ID nullifier | `Ticket`s                        | Bets and claims through `POST /tx`; Shinami's Gas Station pays the gas                              |
| House bot | `HOUSE_BOT_SUI_PRIVATE_KEYS`, on the server          | `Ticket`s                        | Bets against the human stake and claims after settle; pays its own gas in SUI (`docs/game-loop.md`) |

- The admin, operator and house bot keys are in 1Password (paths in `.env.example`). If the operator key leaks, the admin revokes its cap and
  issues a new one.
- `POST /tx` requires the World ID session. The Move package doesn't check World ID: a wallet that calls `bet`
  directly can bet.
- The server knows the winner while people bet and declares it on chain. Players trust the operator.
- `POST /tx` spends USDC only from the wallet's address balance, so `claim` and coin-box deposits pay with
  `coin::send_funds`.

## Game server and web

| Round event                                    | Operator call                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| Betting opens                                  | `open_pool` for a new battle ID; sets `RoundState.battleId` and `poolId` |
| `betting_closes_at` passes                     | `close_betting`; the round enters `fight` once it succeeds               |
| Video failed or timed out                      | `cancel`                                                                 |
| Battle queue settle step, after the ENS writes | `settle` for the winner                                                  |

- Operator calls run one at a time and read the pool first; a pool already in the target state is left alone, so
  each step can retry.
- During `bet` the server reads the pool every 2 s into `RoundState.pool`, so tabs get live totals without reading
  the pool themselves.
- `GET /betting` gives the web `packageId`, `houseId`, `coinType`, `network` and `feeBps`; the server reads
  `feeBps` from the house at startup. The web uses `coinType` for the meter, deposits, the coin return and bets.
- The web builds bet and claim transactions as kinds with the player's wallet as sender and sends them through
  `POST /tx`, which refuses a bet unless it targets the live pool before `betting_closes_at`. Collect claims every
  finished ticket in one transaction.
- The loop's rules, including when betting closes, are in `docs/game-loop.md`.

## Environment

A missing or blank value stops the command or the server and names the variable.

| Variable                                 | Used by                                                                                     | Value                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `SUI_NETWORK`                            | server, CLIs                                                                                | `testnet`                                                                                          |
| `SUI_GRPC_URL`                           | server, CLIs                                                                                | `https://fullnode.testnet.sui.io:443`                                                              |
| `SUI_USDC_TYPE`                          | server, `betting:*`                                                                         | The house's coin type                                                                              |
| `BETTING_PACKAGE_ID`, `BETTING_HOUSE_ID` | server, `betting:pool`, `betting:e2e`                                                       | Printed by `pnpm betting:deploy`                                                                   |
| `BET_FEE_BPS`                            | `betting:deploy`                                                                            | Fee in basis points (`200` = 2%) for the new house                                                 |
| `SUI_MIN_BET`                            | `betting:deploy`, `betting:e2e`                                                             | Minimum bet in base units (`30000` = 0.03 USDC)                                                    |
| `SUI_ADMIN_PRIVATE_KEY`                  | `betting:deploy`, `betting:e2e`, `test-usdc:deploy`, `test-usdc:mint`, `test-usdc:accounts` | Laptop only                                                                                        |
| `SUI_ADMIN_CAP_ID`                       | admin calls                                                                                 | Printed by `pnpm betting:deploy`                                                                   |
| `SUI_OPERATOR_PRIVATE_KEY`               | server, `betting:deploy`                                                                    | Deploy sends the operator cap to its address                                                       |
| `SUI_OPERATOR_CAP_ID`                    | server                                                                                      | Printed by `pnpm betting:deploy`                                                                   |
| `HOUSE_BOT_SUI_PRIVATE_KEYS`             | server                                                                                      | Comma-separated keys, one per house bot; each needs SUI for gas and USDC in its address balance    |
| `HOUSE_BOT_STAKE_UNITS`                  | server                                                                                      | House bot stake per bout in base units; at least the House `min_bet`                               |
| `SUI_E2E_OPERATOR_CAP_ID`                | `betting:e2e`                                                                               | Printed by `pnpm betting:deploy`. Held by the admin key, so e2e runs never contend with the server |
| `SHINAMI_ACCESS_KEY`                     | server, `betting:e2e`, `betting:player`                                                     | Needs Gas Station, Wallet Services and Node Service; the Testnet Gas Station fund needs SUI        |
| `WALLET_SECRET_PEPPER`                   | server                                                                                      | Players' wallet secrets; losing it loses every wallet                                              |
| `SUI_E2E_WALLET_SECRET`                  | `betting:e2e`, `betting:player`                                                             | Secret for the CLIs' own Shinami wallets, not the players' pepper                                  |
| `TEST_USDC_TYPE`, `TEST_USDC_FAUCET_ID`  | `test-usdc:mint`, `test-usdc:accounts`; `test-usdc:send` reads the type                     | Printed by `pnpm test-usdc:deploy`                                                                 |

## Commands

| Command                                                                              | What it does                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm betting:deploy`                                                                | Publishes the package to `SUI_NETWORK` (immutable), creates the house for `SUI_USDC_TYPE` with `BET_FEE_BPS` and `SUI_MIN_BET`, issues the server's and the e2e's operator caps, prints the IDs for `.env`                  |
| `pnpm betting:pool <battleId>`                                                       | Prints the battle's pool, or that it has none                                                                                                                                                                               |
| `pnpm betting:e2e`                                                                   | Testnet run of the money path: the admin funds a Shinami e2e wallet, then open, two gasless bets, close, settle, a gasless claim; the wallet must lose exactly the fee                                                      |
| `pnpm betting:player <game-url> address\|collect\|bet <A\|B> <usdc> [--wallet <id>]` | A second player for testing bets alone: prints its Shinami wallet and balance, bets one side of the live bout once `GET /round` is in `bet` with a pool, or claims its finished tickets. Fund it with `pnpm test-usdc:mint` |
| `pnpm test-usdc:deploy`                                                              | Testnet only. Publishes `test_usdc`, registers the coin, prints `TEST_USDC_TYPE` and `TEST_USDC_FAUCET_ID`                                                                                                                  |
| `pnpm test-usdc:mint <address> <units>`                                              | Mints base units into the address balance and prints the new balance                                                                                                                                                        |
| `pnpm test-usdc:send <account-index> <to-address> <units>`                           | Sends test USDC from a saved account (1-based index into `packages/test-usdc/accounts.json`) to an address balance                                                                                                          |
| `pnpm test-usdc:accounts <count> <usdc-min> <usdc-max> <sui-each>`                   | Saves new keypairs to the gitignored `packages/test-usdc/accounts.json` (never overwrites it), then in one transaction sends each the admin's SUI and a random whole amount of test USDC                                    |
| `pnpm --filter @horror-tube/betting test`                                            | Move tests (`sui move test`) and the TS unit tests                                                                                                                                                                          |
| `pnpm --filter @horror-tube/test-usdc test`                                          | Move tests                                                                                                                                                                                                                  |

The `test-usdc:*` CLIs load `@horror-tube/betting` from `dist`, so run `pnpm --filter @horror-tube/betting build`
first.

## Deploy

1. Give the admin and operator addresses testnet SUI (faucet.sui.io), and the admin some of the house's coin: Circle
   USDC from faucet.circle.com, or test USDC from `pnpm test-usdc:mint` after `pnpm test-usdc:deploy`.
2. Set `SUI_USDC_TYPE` to the coin, then run `pnpm betting:deploy` and copy the printed IDs into `.env`.
3. `pnpm betting:e2e` must pass.
4. Put the public IDs in the GitHub repository variables and the app's env (`terraform/README.md`).

A testnet reset or a fix to the Move code means a new deploy. CI's `docker` job starts the server with public IDs
set in `.github/workflows/ci.yml` and a throwaway operator key; it sends no transactions.
