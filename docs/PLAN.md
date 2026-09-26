# Horror Tube

A battle royale of famous horror movie characters. AI makes each fight as a video.
Verified humans vote on who fights next (free). Users bet on who wins (paid).

ETHGlobal Tokyo 2026. Target prizes: **World** (IDKit), **ENS** (ENSv2) and **Sui** (DeFi & Payments).

## Status (2026-09-26)

| Part                         | Status                                                                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web game (`apps/web`)        | Built. The room, TV, remote, shelf, and coin box. The client applies server `RoundState` (`applyRoundState` / `connectToServerRound`); it does not own the loop timers. |
| World ID                     | Live. Waiver signs an IDKit 4.0 Orb proof for practice slots 1–5 or the judge action; the server verifies at `POST /world-id/verify`. |
| Wallet                       | Built. Sui testnet burner in the browser. A real USDC deposit is tested. The coin return is not.                                                          |
| ENS parent and subnames      | Built. `horrortube.eth` on Sepolia ENSv2, subnames with text records, register/remove/icon CLIs (`docs/roster-json.md`).                                  |
| Characters in the game       | Built. The game reads every character from ENS at page load (`apps/web/DESIGN.md`, "Characters (ENS)").                                                   |
| Character dashboard          | Built. `pnpm dashboard`.                                                                                                                                  |
| Betting contract             | Built on Sepolia: `BattleBetting` (`docs/battle-betting.md`). The game does not call it yet. `POST /bet` only adds to the in-memory pool. A Sui port is being scoped. |
| Game server                  | Built (`apps/server`). Vote→bet→fight→settle holding loop; battle-result queue schema and settle state machine land with #60. |
| Story LLM and video pipeline | Built in `@horror-tube/fight` (narration + fal). Live bout path not fully wired to fal from the server yet.                  |
| ENS writes after a fight     | After betting closes and the fight duration elapses, the server writes winner `injuries` then loser `status=dead` from `battle_results`. `SKIP_BATTLE_SETTLEMENT=1` skips `settleBattle`. A failed write stays on the round error. `POST /retry-settle` runs the pending steps again. |

## Art direction

See `apps/web/DESIGN.md`.

## Components

- **ENS name**: character state (subnames and text records) on Sepolia. The web game reads its characters from here.
- **Database**: Managed Postgres (`DATABASE_URL`). Holds seasons/rounds/votes and the battle-result queue (`battle_results`). Not Durable Objects.
- **Smart contract**: `BattleBetting` on Eth Sepolia takes ETH bets and settles from ENS. Built; see [battle-betting.md](battle-betting.md). Moving the betting pool to a Move package on Sui testnet is being scoped.
- **Wallet**: a burner wallet in the browser now (`apps/web/wallet.ts`), a server wallet per World ID human later (our own keys, then Shinami). Sui testnet, USDC. No wallet popups for bets. See "The wallet" in `apps/web/DESIGN.md`.
- **Frontend host**: Vercel or similar.

## Flow

1. **Log in**: the user logs in to the web app with World ID. This proves that they are a real human and 18+.
   This happens in the room: the user signs a waiver on the table, and the TV shows the World ID QR code. With no Orb, the waiver burns and the user sees "not eligible". See "Onboarding: the waiver" in `apps/web/DESIGN.md`.
2. **Wallet**: the app makes a burner wallet (Sui testnet) for the user. There is no wallet popup, now or at bet time. `check_funds(wallet)` checks that the wallet has enough USDC to bet.
   Deposits go through the coin box (see `apps/web/DESIGN.md`). Later: a gas sponsor (a small server with a SUI key) pays the gas for deposits, bets and withdrawals, so players need only USDC, never SUI. Not built yet: a faucet (the backend sends testnet SUI for gas and the first USDC, one time per World ID nullifier).
   There is no wallet screen: after World ID, the user goes straight to the TV. Money lives on the coin box in the room. A real deposit is tested; the coin return is not.
3. **Vote (free)**: everyone votes for the next fighters. Dead characters cannot get votes. The full rules (quorum, winner stays on) are in `docs/game-loop.md`.
4. **Load characters**: the web game reads every subname under `<ENS_LABEL>.eth` at page load, with `look`, `brief`, `injuries`, `status`, and `icon` (keys: `docs/character-card-fields.md`). Built.
5. **Permission check**: do the fighters miss capabilities from past battles? (Open: see question 1. The game shows no capabilities now.)
6. **Story**: the LLM gets the story prompt, the character state, and lore text for each character (from the database or fandom.com).
   The LLM picks the winner and the winner's damage, and writes them as the last line of the turn.
   The server stores the winner and damage in the database, **not onchain**.
7. **Open betting**: the backend's operator wallet calls `openBattle` with the two fighters and the countdown end. Voting closes and betting opens.
8. **Countdown and bet**: users bet on the outcome (paid) until the countdown ends. Today `POST /bet` adds the amount to the in-memory pool. The app does not call `BattleBetting`, and USDC is not debited on-chain.
   The video model makes the video from the LLM text **during** the countdown, so it is ready when betting ends.
9. **Show video**: the fight video plays from `RoundState.videoUrl`. There is no local demo clip.
10. **Update ENS**: after betting is closed and the fight duration has elapsed, the server writes winner `injuries`, then loser `status=dead`. The room shows the same outcome on in-memory `chars`. With `SKIP_BATTLE_SETTLEMENT=1` the server skips `settleBattle`; with `0` it calls `settleBattle` after the ENS writes. A failed ENS write stays on the round error and does not start the next bout. `POST /retry-settle` runs the pending ENS steps again. Moving the loser to a dead-pool name is still open (question 2).
11. Go back to the vote (step 3), until one character is left.

**Known limit:** the server knows the winner while people bet, and the winner is only in the database. People must trust us. This is OK for the demo.

## Damage

- The database keeps the full damage history. The ENS `injuries` text record shows only the current damage, as text.
- The next story prompt includes the damage, so the character fights worse and looks hurt in the video.
- Damage may remove capabilities (step 5, open question 1).

## Open questions

1. **What is a "capability"?** A weapon, a body part, or a move? And can ENSv2 permissions describe it, or is it only a text record?
2. **What is the dead-pool name?** The diagram has two versions: `character.dead` and a move to a dead-pool parent name.

## World: IDKit (prize "Best Use of IDKit", $5k, 2 × $2.5k)

**Trust moment:** horror content needs 18+, and a free vote needs one vote per human.

**Credential:** Orb Proof of Human only.

- A person must be 18+ to get Orb-verified. So one credential proves both "unique human" and "18+".
- This is the minimum sufficient credential. Passport/NFC is not necessary for age.
- Lower levels (Device, Selfie Check) do **not** prove 18+. Do not accept them.

**Rules:**

- Verify every proof on the **server**. Never trust the client result.
- Use the nullifier hash with the action `vote-round-<n>` to allow one vote per human per round.
- Fail path for the demo: a user who has no Orb, or who cancels, sees a "not eligible" screen and cannot enter or vote.

**Submission must include:**

- Why this moment needs trust, and why Orb is the minimum credential.
- A demo of one success and one fail path.
- A short debrief: time to first success, problems, missing docs, the one fix with the most impact.
- A link to World's rule that Orb users must be 18+:
  - https://support.world.org/hc/en-us/articles/29167917477907-What-is-the-minimum-age-to-obtain-a-World-ID
  - https://world.org/blog/policy/how-world-network-prevents-underage-access-and-usage
  - https://world.org/legal/user-terms-and-conditions (section 3, Eligibility)
  - Note: the World ID developer docs do not state this rule. Put it in the debrief as missing docs.

Links:

- https://docs.world.org/world-id/idkit/integrate
- https://docs.world.org/world-id/idkit/credentials
- https://docs.world.org/world-id/credentials/1 (Proof of Human)
- https://docs.world.org/world-id/idkit/verification-flows
- https://developer.worldcoin.org

## ENS: ENSv2 on Sepolia (prize "Best Use of ENSv2", $3k / $2k / $1k)

ENS holds the game state of the characters. It is central to the game, not decoration.

| Game concept                                  | ENSv2 feature                                                                                                                                |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Each character, e.g. `chucky.horrortube.eth`  | Subname in our own subname registry (UserRegistry)                                                                                           |
| `look`, `brief`, `injuries`, `status`, `icon` | Text records on a Permissioned Resolver (`docs/character-card-fields.md`)                                                                    |
| The game roster                               | The web game reads the subnames and text records from Sepolia. No hardcoded characters                                                       |
| Capabilities lost to damage                   | Open: Enhanced Access Control roles, or a text record (open question 1)                                                                      |
| Loser goes to the dead pool                   | Move or alias the subname (open question 2)                                                                                                  |
| The contract pays out from ENS state          | `BattleBetting` on Sepolia reads the loser's `status` itself. A Sui betting contract would be settled by the backend after it reads `status` |
| Bonus: fighters as AI agents                  | Each character is an agent namespace with its own permissions (ENSIP-25/26)                                                                  |

**Requirements:** ENSv2 on Sepolia, no hard-coded values, a live demo link, and open-source code.

Links:

- https://docs.ens.domains/ensv2/overview/
- https://docs.ens.domains/ensv2/permissioned-registry
- https://docs.ens.domains/ensv2/permissioned-resolver/
- https://docs.ens.domains/ensv2/enhanced-access-control/
- https://docs.ens.domains/ensv2/tutorial-contract-developers/
- https://docs.ens.domains/ensip/25/ and https://docs.ens.domains/ensip/26/ (agents)

## Betting

- `BattleBetting` on Sepolia takes bets in test ETH. Real money is not necessary for the demo. Details: [battle-betting.md](battle-betting.md).
- Betting opens when voting closes (`openBattle`). It closes when the fight video is ready (`closeBetting`), or at the battle's `closesAt` at the latest.
- Winners share the pool in proportion to their bets, after a 2% fee taken from the losing side. If nobody bet on the winner, all bets are refunded. The minimum bet is a few cents of ETH; the admin can change it.
- The contract settles from ENS: the fighter whose `status` is `dead` lost.
- Next: a pool Move contract on Sui testnet, paid in testnet USDC, is being scoped. In the room, `POST /bet` only grows the in-memory pool; it does not call `BattleBetting` or debit USDC on-chain.

## Out of scope

- World mini app (this is a regular web app).
- World ID for Agents prize and Continuity Track prizes.

## Risks

- Famous characters are protected by copyright. This is OK for a hackathon demo, but not for a public launch.
- ENSv2 is in beta on Sepolia. Expect changes and bugs.
- fandom.com text is CC BY-SA. If we use it, we must credit the source.
