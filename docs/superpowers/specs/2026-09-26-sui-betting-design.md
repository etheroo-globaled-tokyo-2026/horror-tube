# Sui betting

Parimutuel betting on Horror Tube battles, on Sui testnet, in USDC. Sui holds only money: pools, bets,
payouts and fees. Battle state (fighters, votes, winner, damage) stays in ENS and Postgres. Players bet
from the Shinami Invisible Wallet they already have (`/wallet`, `/tx`), and Shinami's Gas Station pays
the gas. Replaces the Sepolia `BattleBetting` contract.

## Decisions

| Topic | Decision |
| --- | --- |
| On Sui | `House` (config, treasury), one `Pool` per battle, one `Ticket` per bet |
| Off Sui | Fighters, votes, winner and damage: ENS and Postgres (`rounds`, `battle_results`) |
| Pool key | The battle's database ID as text (`battle_results.battle_id`). A pool's object ID derives from house + battle ID (`sui::derived_object`), so the app finds a pool with no indexer and a battle can't get two pools. A Move test and a TS test pin both sides to one vector |
| Sides | Side 0 = `fighters[0]` (`fighter_a`), side 1 = `fighters[1]` (`fighter_b`) |
| Coin | `SUI_USDC_TYPE` (Circle testnet USDC or our test USDC, 6 decimals) |
| Economics | 2% of the losing side, locked per pool, max 10%. Refunds when cancelled or one-sided. Min bet 0.03 USDC. The admin changes fee and min |
| Winner | The server's operator settles with the winning side from the battle queue's settle step (`ChainWritePorts.settleBattle`) |
| Wallet and gas | Main's existing path: the web builds a tx kind, `POST /tx` checks it with `tx-policy.ts` (betting-package calls are already allowed) and runs Shinami `executeGaslessTransaction`. No burner, no sponsor of our own |
| Gate | `/tx` with the World ID session: players bet from their Shinami wallets through it. The Move package doesn't enforce this; a wallet that calls `bet` directly can bet. Future on-chain option: a non-transferable pass minted to verified wallets |
| USDC location | `/tx` spends USDC from the address balance only (`assumeSufficientAddressBalances`). So `claim` pays with `coin::send_funds`, and coin-box deposits switch from `transferObjects` to `coin::send_funds` |
| Roles | `AdminCap` on the laptop (fees, config, operator caps, treasury). `OperatorCap` on the server (open, close, settle, cancel; revocable). A second operator cap for the laptop e2e |
| Upgrades | None: the publish transaction makes the `UpgradeCap` immutable, since the package has no version check and an upgrade could add code that empties the pools. A fix ships as a new publish and a new house |
| Package | `packages/betting`: Move in `move/`; TS client in `src/`, built to `dist` like `@horror-tube/world-id` |
| Deploy | A TS CLI publishes the bytecode from `sui move build --dump-bytecode-as-base64` with the admin key from `.env` |
| Sepolia | `BattleBetting` is deleted once the Sui e2e passes |

## Where data lives

| Data | Home |
| --- | --- |
| Characters: look, brief, status, injuries, icon | ENS subnames (Sepolia) |
| Rounds, votes, battle results | Postgres |
| Live round state | Game server memory (`GameLoop`) |
| Pools, bets, fees, payouts | Sui testnet, `horror_tube::betting` |
| Player keys | Shinami Invisible Wallets, one per World ID nullifier |

## Flow

```
apps/web (World ID session)       apps/server                                Sui testnet
build bet / claim tx kind ─POST /tx─► tx-policy → Shinami gasless ──────────► House<USDC>  (shared)
                                                                              Pool #battle (shared, derived ID)
                                      GameLoop + battle queue                 Ticket       (owned by the player)
                                      operator key: open/close/settle/cancel ►
RoundState ◄── battleId, poolId, pool totals ◄── operator reads the pool
```

## Move package `horror_tube::betting`

Code and unit tests: `packages/betting/move`.

| Object | Ownership | Fields |
| --- | --- | --- |
| `AdminCap` | Owned by the publisher | — |
| `OperatorCap` | Owned by the server; valid while its ID is in `house.operators` | `house_id` |
| `House<T>` | Shared | `fee_bps`, `min_bet`, `operators: VecSet<ID>`, `treasury: Balance<T>` |
| `Pool<T>` | Shared, ID derived from `PoolKey(battle_id)` | `house_id`, `battle_id: String`, `closes_at_ms`, `fee_bps` (locked), `status` (0 open, 1 settled, 2 cancelled), `winning_side`, `fee`, `totals: [u64; 2]`, `pot` |
| `Ticket<T>` | Owned by the bettor | `pool_id`, `side`, `stake` |

| Function | Caller | Effect |
| --- | --- | --- |
| `create_house<T>`, `issue_operator_cap`, `revoke_operator_cap`, `set_fee_bps`, `set_min_bet`, `withdraw_fees` | Admin | Config and treasury |
| `open_pool(house, cap, battle_id, closes_at_ms, clock)` | Operator | Shares the pool, locks the fee |
| `bet(house, pool, side, coin, clock)` | Player, through `/tx` | Adds the stake, sends a ticket to the player |
| `close_betting(house, cap, pool, clock)` | Operator | Ends betting now |
| `settle(house, cap, pool, winning_side, clock)` | Operator | Moves the fee to the treasury |
| `cancel(house, cap, pool)` | Operator | Every ticket refunds |
| `claim(pool, ticket)` | Ticket holder | Pays into the holder's address balance, deletes the ticket |

Payouts, with `W` on the winner and `L` on the loser: `fee = L × fee_bps / 10000`, only when both
sides have stakes. A winning ticket pays `stake × (W + L − fee) / W` (128-bit `mul_div`, rounded
down), a losing one 0; cancelled or one-sided pools refund every stake. Rounding dust stays in the pot.

## Game server

| Round event | Operator call |
| --- | --- |
| `GameLoop` enters `bet` (it assigns `battleId`) | `openPool(battleId, now + VIDEO_TIMEOUT_SECONDS)`; `RoundState.poolId` is set once the pool exists |
| `bet` → `fight` | `closeBetting(battleId)` |
| Video failed or timed out | `cancel(battleId)` |
| Battle queue settle step, after the ENS writes | `settle(battleId, side)` |

- Operator calls read the pool first and do nothing when it is already in the target state, so every
  step can retry. They run one at a time (one `OperatorCap`, one set of gas coins). Failures are
  logged with the battle ID and retried with backoff.
- `RoundState` gains `battleId: string | null` and `poolId: string | null`. During `bet` the server
  reads the pool every 2 s and fills `pool` with its totals in USDC base units. Tabs never poll pools
  (the public node allows about 100 requests per 30 s).
- `GameLoop.bet(side, amount)` and its route are deleted: bets are on chain.

## Web

- Bet: `tx.coin({ type: USDC, balance, useGasCoin: false })` into `betting::bet`, built as a kind
  with the wallet as sender and `assumeSufficientAddressBalances`, sent through main's `/tx` helper.
  BET is enabled once `RoundState.poolId` is set.
- Claim: list the wallet's `Ticket<USDC>` objects; claim every finished one in one `/tx`.
- Deposit: the coin box sends with `coin::send_funds` into the wallet's address balance.
- Odds come from `RoundState.pool`.

## Config (`.env`)

| Variable | Used by | Notes |
| --- | --- | --- |
| `SUI_USDC_TYPE`, `BETTING_PACKAGE_ID` | server, CLIs | Exist on main; `BETTING_PACKAGE_ID` printed by deploy |
| `BETTING_HOUSE_ID` | server, CLIs | Printed by deploy |
| `SUI_NETWORK`, `SUI_GRPC_URL` | server, CLIs | `testnet`, `https://fullnode.testnet.sui.io:443` |
| `BET_FEE_BPS`, `SUI_MIN_BET` | deploy | `200`, `30000` (0.03 USDC) |
| `SUI_ADMIN_PRIVATE_KEY`, `SUI_ADMIN_CAP_ID` | laptop | Publisher; holds `AdminCap`; funds the e2e wallet |
| `SUI_OPERATOR_PRIVATE_KEY`, `SUI_OPERATOR_CAP_ID` | server | Operator |
| `SUI_E2E_OPERATOR_CAP_ID` | laptop | Operator cap held by the admin, so e2e runs never contend with the server |
| `SHINAMI_ACCESS_KEY`, `WALLET_SECRET_PEPPER` | server | Exist on main. The key needs Gas Station, Wallet Services and Node Service |
| `SUI_E2E_WALLET_SECRET` | e2e | Random secret for the e2e's own Shinami wallet; not the players' pepper |

## What you set up

1. Shinami: the key and pepper already exist. In the dashboard, check the **Testnet** Gas Station fund
   has SUI (top it up at its deposit address from faucet.sui.io) and the key has Gas Station, Wallet
   Services and Node Service.
2. Run `sui keytool generate ed25519` twice (admin, operator). Save each in 1Password
   (`Horror Tube Sui admin`, `Horror Tube Sui operator`) and put them in `.env`.
3. faucet.sui.io: testnet SUI to both addresses. faucet.circle.com (Sui testnet): 20 USDC to the admin
   address.

## Test USDC (testnet only)

Circle's faucet gives 20 USDC per address every 2 hours behind a captcha, so testing can use our own
coin instead: `packages/test-usdc`, module `test_usdc::usdc`. It has no value.

- Coin `USDC`, 6 decimals, registered in Sui's coin registry. A shared `Faucet` owns the
  `TreasuryCap`, so anyone can mint: `mint` returns a coin, and `mint_to` sends to an address balance
  with `coin::send_funds` (where `/tx` spends from). Max 1,000 USDC per call.
- `pnpm test-usdc:deploy` publishes it and prints `TEST_USDC_TYPE` and `TEST_USDC_FAUCET_ID`.
  `pnpm test-usdc:mint <address> <units>` mints base units to that address balance and prints its
  new balance. `pnpm test-usdc:accounts <count> <usdc-min> <usdc-max> <sui-each>` (e.g. `20 500 2000 0.03`, a random whole amount each) creates
  keypairs, saves them to the gitignored `packages/test-usdc/accounts.json`, and in one transaction
  gives each the admin's SUI and freshly minted test USDC. The CLIs load `@horror-tube/betting` from
  `dist`, so run `pnpm --filter @horror-tube/betting build` first.
- Switch the game to it: set `SUI_USDC_TYPE` to the `TEST_USDC_TYPE` value and run
  `pnpm betting:deploy`, which creates its house for `SUI_USDC_TYPE` (it also publishes a new betting
  package, so replace every ID it prints). `apps/web/wallet.ts` hard-codes `USDC_TYPE`, which must match.
- Testnet only: the deploy CLI refuses any other `SUI_NETWORK`.

## Deploy, once

1. `pnpm betting:deploy`: publishes, creates the USDC house, issues both operator caps, prints the IDs
   for `.env`.
2. Gate: `pnpm betting:e2e` passes on testnet.

## Testing

- Move (`sui move test`): payouts, refunds, fee lock and cap, close and settle timing, operator
  revocation, a pool settles or cancels once and only through its own house, one pool per battle,
  derived IDs, a 20-round payout invariant.
- TS unit (`tsx --test`): pool ID derivation against the Move vector, the payout mirror, `tx-policy`
  accepting real bet and claim kinds, the operator's state machine with a fake chain.
- Live (`pnpm betting:e2e`): the admin moves USDC into a Shinami e2e wallet's address balance → open →
  two gasless bets → close → settle → gasless claim → the wallet's USDC moved by exactly `-fee`. It
  reads every ID from effects.

## Blockers

- **Battle ID in the loop**: `GameLoop` has no battle ID yet, and the battle queue isn't connected to
  it. Plan 3 adds `battleId` when betting opens; the queue must use the same ID.
- **Stranded deposits**: USDC deposited before the `send_funds` change sits in coin objects that `/tx`
  can't spend (probably the coin return too, today).

## Plans

| # | Plan | Needs |
| --- | --- | --- |
| 1 | `2026-09-26-sui-betting-1-move.md`: CI and security review of the Move package | — |
| 2 | `2026-09-26-sui-betting-2-client.md`: TS client, CLIs, deploy, e2e gate | 1, your setup |
| 3 | `2026-09-26-sui-betting-3-server.md`: operator in the game loop, settle port, policy tests | 2 |
| 4 | `2026-09-26-sui-betting-4-web.md`: deposits, bets and claims in the web | 3 |
| 5 | `2026-09-26-sui-betting-5-retire-sepolia.md`: delete `BattleBetting` | 2 |

## Risks

- **Operator trust**: the server knows the winner while people bet and declares it on Sui.
  `docs/PLAN.md` accepts this for the demo.
- **Public full node limits**: move to Shinami Node Service if the demo needs it.
- **Testnet reset**: rerun deploy.

## Out of scope

- Votes, rounds and character state on Sui.
- Mainnet, multisig custody, a pause switch.
- An indexer or database mirror of bets.
