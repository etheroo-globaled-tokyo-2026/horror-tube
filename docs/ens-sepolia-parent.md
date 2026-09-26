# Register a label under `.eth` on Sepolia ENSv2 beta

One second-level name, `<ENS_LABEL>.eth`. Character subnames are in
`docs/roster-json.md`. The label comes from `ENS_LABEL`. The script does not
default it.

## Pin (source of truth)

| Item                | Value                                                                 |
| ------------------- | --------------------------------------------------------------------- |
| contracts-v2 commit | `71a3b7339dbc55ab47667abdfe8303bac4f4c24e`                            |
| Deployed at         | `2026-09-15T09:46:38.513Z`                                            |
| Address table       | `packages/ens/scripts/pin/sepolia-addresses.md` (copy of the pin raw) |

Contract addresses used by the register script (`ETHRegistrar`, `ETHRegistry`,
`MockDAI`, `MockUSDC`, `StandardRentPriceOracle`) live only in that address
table. Do not paste them elsewhere. Do not use older addresses
`0xdce5205a553573ffd47629327dddf36186022ffa` or
`0x7e4b2d59938930168024201752ee5503df402303`.

Minimal ABIs for the calls the script makes live in `packages/ens/scripts/abis.ts`.

## Registrar flow (from pin source)

`ETHRegistrar` at the pin is commit-reveal (`commit` then `register`), paid in
ERC-20 via `safeTransferFrom` — not ETH rent. Quote:
`contracts/src/registrar/ETHRegistrar.sol` at commit `71a3b733`
(`SafeERC20.safeTransferFrom(paymentToken, msg.sender, BENEFICIARY, base + premium)`).

`StandardRentPriceOracle.isPaymentToken` accepts pin `MockDAI` and `MockUSDC`
(verified on-chain against this deployment). On-chain reads for a 1-year term on
`horrortube` returned about `8` units of either token (plus tiny dust). Price
depends on the label. Premium was `0` while the name was freshly available. The
script always re-queries `getRegisterPrice` and fails if the wallet cannot pay
that exact total.

`MIN_COMMITMENT_AGE` on this deployment is `60` seconds.
`MAX_COMMITMENT_AGE` is `86400` seconds.
`MIN_REGISTER_DURATION` is `2419200` seconds (28 days).

## 1. Create a burner wallet (you do this)

Do not generate a key into this repo.

Foundry:

```bash
cast wallet new
```

Or create an account in a browser wallet on Sepolia and export the private key
only into your shell environment.

Copy the address. Keep the private key out of git.

## 2. Fund Sepolia ETH (gas)

Rent is not paid in ETH. You still need Sepolia ETH for gas (commit, approve,
register).

Working faucets researched for this draft:

| Source                   | URL                                                               | Notes                                       |
| ------------------------ | ----------------------------------------------------------------- | ------------------------------------------- |
| ETHGlobal faucet         | https://ethglobal.com/faucet                                      | Lists Ethereum Sepolia `0.05 ETH` (login)   |
| Google Cloud Web3 faucet | https://cloud.google.com/application/web3/faucet/ethereum/sepolia | Google account; rate-limited                |
| Sepolia PoW faucet       | https://sepolia-faucet.pk910.de                                   | Browser mining; no mainnet balance required |

## 3. Fund MockDAI or MockUSDC (registrar payment)

Pick one payment token from the pin and set `PAYMENT_TOKEN` to `MockDAI` or
`MockUSDC`. The script does not choose one for you.

Both are `MockERC20` at the pin (`contracts/test/mocks/MockERC20.sol`) with a
public `mint(address to, uint256 amount)`. Addresses are in
`packages/ens/scripts/pin/sepolia-addresses.md`.

```bash
# Example: mint 20 MockDAI (18 decimals) to your burner
# Replace MOCK_TOKEN with the MockDAI address from packages/ens/scripts/pin/sepolia-addresses.md
cast send "$MOCK_TOKEN" \
  "mint(address,uint256)" \
  YOUR_ADDRESS \
  20000000000000000000 \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --private-key "$PRIVATE_KEY"
```

```bash
# Or MockUSDC (6 decimals): mint 20 USDC
# Replace MOCK_TOKEN with the MockUSDC address from packages/ens/scripts/pin/sepolia-addresses.md
cast send "$MOCK_TOKEN" \
  "mint(address,uint256)" \
  YOUR_ADDRESS \
  20000000 \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --private-key "$PRIVATE_KEY"
```

Mint needs Sepolia ETH for gas first. The register script does not mint for you;
if the balance is short it exits with a verbose error.

## 4. Pass the key to the script

```bash
cp .env.example .env
# edit .env — set PRIVATE_KEY only in that local file (.gitignore already covers .env)
```

Env vars (names only in `.env.example`):

| Variable           | Role                                                                         |
| ------------------ | ---------------------------------------------------------------------------- |
| `ENS_LABEL`        | Required. One lowercase label, not a full name. Registers `<ENS_LABEL>.eth`. |
| `SEPOLIA_RPC_URL`  | Required. Sepolia HTTP RPC.                                                  |
| `PRIVATE_KEY`      | `commit` / `register` / `full` only. `0x` + 64 hex.                          |
| `PAYMENT_TOKEN`    | `commit` / `register` / `full` only. `MockDAI` or `MockUSDC`.                |
| `DURATION_SECONDS` | `commit` / `register` / `full` only. Integer `>= MIN_REGISTER_DURATION`.     |

## 5. Commands

```bash
pnpm install
pnpm ens:check
```

Check-only: reads ETHRegistry / ETHRegistrar for `$ENS_LABEL.eth`. Prints
`getStatus` and `AVAILABLE` or `TAKEN`. Needs only `ENS_LABEL` and
`SEPOLIA_RPC_URL`.

```bash
pnpm ens:register full
```

Requires funded `PRIVATE_KEY`. Runs commit, waits `MIN_COMMITMENT_AGE`, approves
the payment token, then `register`. Commitment secret is stored in
`packages/ens/scripts/.ens-commit-state/<ENS_LABEL>.json` (gitignored).

Split steps if you prefer:

```bash
pnpm ens:register commit
# wait >= 60s
pnpm ens:register register
```

A different `ENS_LABEL` is a different label under `.eth`, not a different
parent TLD. Each label keeps its own commit file.

## 6. Tests

```bash
pnpm test
```

Runs `packages/ens/tests/ens-register.test.ts`. Unit tests always run. The smoke test runs
`check` when `ENS_LABEL` and `SEPOLIA_RPC_URL` are set and fails if output
contains the `PRIVATE_KEY` value. The e2e runs `full` only with `ENS_E2E=1`,
fails if any write variable is missing, and leaves the name registered; this pin
has no unregister for a second-level `.eth` name.

## Out of scope for this draft

- Character labels beyond ensuring a UserRegistry on the parent (see
  `docs/roster-json.md` and `python -m roster register`)
- Character text-key grants (`grantSetterRoles` for roster/agent) live in
  `packages/ens/scripts/character-subnames.ts` / issue #61, not in the parent
  `.eth` register script
