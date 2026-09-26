# Battle betting contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `BattleBetting` (parimutuel battle bets settled from ENS `status`) with Foundry config, unit/fuzz/fork tests, and a live Sepolia deploy.

**Architecture:** One contract holds every battle. The operator opens battles, anyone bets ETH until `closesAt`, anyone settles by reading both fighters' ENS `status` through the pinned `UniversalResolverV2`, bettors pull payouts, and the admin controls fee, treasury and minimum bet. Behaviour is defined in `docs/superpowers/specs/2026-09-26-battle-betting-design.md`; this plan does not restate it.

**Tech Stack:** Foundry (forge 1.5, solc 0.8.37), OpenZeppelin v5.7.0, forge-std v1.16.2, Eth Sepolia, ENSv2 beta.

---

## Files

| Path                                                         | Responsibility                                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `foundry.toml`                                               | Paths into `contracts/`, solc, remappings, `sepolia` RPC, `fork` profile, read access to `scripts/pin` |
| `contracts/src/BattleBetting.sol`                            | The contract                                                                                           |
| `contracts/script/PinnedEns.sol`                             | Reads a contract address from `scripts/pin/sepolia-addresses.md`                                       |
| `contracts/script/DeployBattleBetting.s.sol`                 | Reads `.env`, deploys, logs the address                                                                |
| `contracts/test/unit/StandInUniversalResolver.sol`           | Test resolver: per-node `status`, optional revert, checks the DNS name matches the node                |
| `contracts/test/unit/BattleBetting.t.sol`                    | Unit and fuzz tests                                                                                    |
| `contracts/test/fork/BattleBettingEns.t.sol`                 | Settles against real Sepolia ENS on a fork                                                             |
| `contracts/lib/`                                             | forge-std, openzeppelin-contracts (git submodules)                                                     |
| `docs/battle-betting.md`                                     | Durable doc                                                                                            |
| `docs/PLAN.md`, `.env.example`, `.gitignore`, `package.json` | Small edits                                                                                            |

## Task 1: Worktree and Foundry scaffolding

- [ ] Worktree `.worktrees/battle-betting` on new branch `battle-betting` from `origin/main` (keeps the user's unpushed `main` commits out of the PR). Cherry-pick the spec commit, then `git reset --keep HEAD~1` on `main` so `main` is back where the user left it.
- [ ] `foundry.toml`:

```toml
[profile.default]
src = "contracts/src"
test = "contracts/test"
script = "contracts/script"
out = "contracts/out"
libs = ["contracts/lib"]
cache_path = "contracts/cache"
broadcast = "contracts/broadcast"
solc = "0.8.37"
optimizer = true
optimizer_runs = 200
remappings = [
  "forge-std/=contracts/lib/forge-std/src/",
  "@openzeppelin/contracts/=contracts/lib/openzeppelin-contracts/contracts/",
]
fs_permissions = [{ access = "read", path = "./scripts/pin" }]
no_match_path = "**/test/fork/**"

[profile.fork]
no_match_path = "**/test/unit/**"

[rpc_endpoints]
sepolia = "${SEPOLIA_RPC_URL}"
```

- [ ] `forge install foundry-rs/forge-std@v1.16.2 OpenZeppelin/openzeppelin-contracts@v5.7.0` (lands in `contracts/lib/`).
- [ ] `.gitignore` Foundry section: `contracts/out/`, `contracts/cache/`, `contracts/broadcast/*/31337/`, `contracts/broadcast/**/dry-run/`.
- [ ] `.env.example`: add `OPERATOR_ADDRESS=`, `TREASURY_ADDRESS=`, `BET_FEE_BPS=`, `MIN_BET_WEI=`.
- [ ] Root `.env` in the main checkout, copied into the worktree: `.env.example` names plus `ENS_LABEL=horrortube`, the test `PRIVATE_KEY`, `SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com`, operator and treasury `0x3B9Fd8d65B008709c9DF511295F56980E7C32D02`, `BET_FEE_BPS=200`, `MIN_BET_WEI=10000000000000`. Check: `git check-ignore -v .env` prints the `.env` rule in both checkouts.
- [ ] `package.json` scripts: `contracts:test` = `forge test`; `contracts:test:fork` = `FOUNDRY_PROFILE=fork forge test`; `contracts:deploy` = `forge script contracts/script/DeployBattleBetting.s.sol --rpc-url sepolia --broadcast --verify --verifier sourcify`.
- [ ] Commit `chore: add Foundry setup for contracts`.

## Task 2: BattleBetting and unit tests (TDD)

- [ ] Write the stand-in resolver and `BattleBetting.t.sol` first. Test helpers: `_open()`, `_bet(who, id, fighter, amount)`, `_kill(fighter)`, `_settleWithLoser(id, loser)`, `_claim(who, id) returns (paid)`. Cases are the spec's Testing list (open, bet, settle, payouts, treasury, `fighterNode` vs `vm.ensNamehash`, fuzz solvency).
- [ ] `forge test` fails to compile (no `BattleBetting`).
- [ ] Write `contracts/src/BattleBetting.sol`:

```solidity
contract BattleBetting is AccessControl, ReentrancyGuardTransient {
    enum Status { None, Open, Settled, Cancelled }
    struct Battle { string[2] fighters; uint64 closesAt; uint16 feeBps; Status status; uint8 winner; uint256[2] totals; }

    constructor(address admin, address operator, address treasury, uint16 feeBps, uint256 minBet,
        IUniversalResolver universalResolver, string memory ensLabel);

    function openBattle(string calldata fighterA, string calldata fighterB, uint64 closesAt) external returns (uint256); // operator
    function placeBet(uint256 battleId, uint8 fighter) external payable;
    function settleBattle(uint256 battleId) external;
    function cancelBattle(uint256 battleId) external; // operator
    function claim(uint256 battleId) external;
    function setFeeBps(uint16) external; function setTreasury(address) external; function setMinBet(uint256) external; // admin
    function withdrawFees() external; // admin
    function getBattle(uint256) external view returns (Battle memory);
    function stakesOf(uint256, address) external view returns (uint256[2] memory);
    function claimable(uint256, address) external view returns (uint256); // 0 when unfinished or claimed
    function fighterNode(string memory) public view returns (bytes32);
}
```

Labels (constructor `ensLabel`, both fighters): 1–63 bytes of `a-z0-9-`, else `InvalidLabel(label)`; equal fighters → `SameFighters`. Events and errors as named in the spec.
Owed amount: cancelled, or settled with `W == 0 || L == 0` → `stake[0] + stake[1]`; otherwise `stake[winner] * (W + L - L * feeBps / 10_000) / W`. Settle adds the same fee to `accruedFees` only when `W > 0 && L > 0`. ENS read: `universalResolver.resolve(dnsName(fighter), abi.encodeCall(ITextResolver.text, (fighterNode(fighter), "status")))` inside `try`, wrapping failures in `EnsLookupFailed(battleId, fighter, reason)`. `parentNode = keccak256(namehash("eth"), keccak256(ensLabel))`; `parentDnsName = len ‖ ensLabel ‖ 0x03 "eth" 0x00`; fighter DNS name = `len ‖ fighter ‖ parentDnsName`.

- [ ] `forge test` passes; `forge fmt`.
- [ ] Commit `feat: add BattleBetting contract with ENS settlement`.

## Task 3: Pinned ENS reader and deploy script

- [ ] `PinnedEns.addressOf(name)`: `vm.readFile("scripts/pin/sepolia-addresses.md")`, find the row starting `| <name> `, split on `[` and `]`, `vm.parseAddress`. Revert naming the missing contract and the file.
- [ ] `DeployBattleBetting.run()`: require each env var non-blank (revert `"<NAME> is required. Set it in .env. See .env.example."`), `BET_FEE_BPS <= type(uint16).max`, admin = `vm.addr(PRIVATE_KEY)`, resolver = `PinnedEns.addressOf("UniversalResolverV2")`, broadcast the constructor, log the address.
- [ ] Simulate without broadcasting: `forge script contracts/script/DeployBattleBetting.s.sol --rpc-url sepolia` succeeds and logs an address.
- [ ] Commit `feat: add BattleBetting deploy script`.

## Task 4: Fork test against Sepolia ENS

- [ ] `BattleBettingEns.t.sol`: `vm.createSelectFork(vm.rpcUrl("sepolia"))`; label from `ENS_LABEL`; resolver and `ETHRegistry` from `PinnedEns`; owner = `ETHRegistry.findOwner(label)`; deploy with this test as admin and operator; open `jason` vs `freddy`; bets from two wallets; warp to `closesAt`; expect `NoFighterDead`; get Freddy's resolver from `universalResolver.resolve(...)`; `vm.prank(owner)` then `setText(freddyDnsName, "status", "dead")`; settle; winner is 0; winner's claim pays pool minus fee, loser's claim reverts `NothingToClaim`.
- [ ] `FOUNDRY_PROFILE=fork forge test` passes; plain `forge test` does not run it.
- [ ] Commit `test: settle BattleBetting against Sepolia ENS on a fork`.

## Task 5: Live deploy

- [ ] `pnpm contracts:deploy`; record address, tx hash, block.
- [ ] Read back with `cast call`: `hasRole(DEFAULT_ADMIN_ROLE, deployer)`, `hasRole(OPERATOR_ROLE, operator)`, `treasury()`, `feeBps()`, `minBet()`, `fighterNode("jason")` equals `cast namehash jason.horrortube.eth`.
- [ ] Check Sourcify reports the contract verified.
- [ ] Inspect `contracts/broadcast/DeployBattleBetting.s.sol/11155111/run-latest.json` for secrets and local paths, then commit it: `chore: record BattleBetting Sepolia deployment`.

## Task 6: Docs

- [ ] `docs/battle-betting.md`: what it is, lifecycle, payouts, roles and treasury, backend rules, env vars, commands, deployment.
- [ ] `docs/PLAN.md`: Betting section (fee, minimum bet, ENS settlement, link); open question 1 answered (operator wallet opens battles); Database line says DigitalOcean Managed PostgreSQL.
- [ ] Commit `docs: document BattleBetting`.

## Task 7: Finish

- [ ] `forge test`, `FOUNDRY_PROFILE=fork forge test`, `forge fmt --check`, `forge build --sizes`.
- [ ] Squash into a few commits without AI attribution; push `battle-betting`; open the PR as neilei (`GH_TOKEN=$(gh auth token --user neilei) gh pr create …`).
