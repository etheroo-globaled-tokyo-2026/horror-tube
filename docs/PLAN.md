# Horror Tube

A battle royale of famous horror movie characters. AI makes each fight as a video.
Verified humans vote on who fights next (free). Users bet on who wins (paid).

ETHGlobal Tokyo 2026. Target prizes: **World** (IDKit) and **ENS** (ENSv2).

## Art direction

Based on *FAITH: The Unholy Trinity* (https://store.steampowered.com/app/1179080/FAITH_The_Unholy_Trinity/).

- Black background.
- Thin, glowing line art in one color per subject (blood red, cold blue, rust brown).
- Rough, low-res, pixel look, like an old computer. No gradients, no glossy UI.

## Core loop

1. **Enter**: the user proves with World ID (Orb) that they are a real human and 18+.
2. **Campaign**: the user picks a video series, for example chainsaw, shotgun, evil doll, or spiders.
3. **Reset**: all character ENS subnames go back to `alive`.
4. **Vote (free)**: verified humans vote on the next two fighters. One vote per human per round.
5. **Bet (paid)**: users bet on which of the two fighters wins.
6. **Fight**: the LLM writes the chapter and a video model makes it:
   `LLM_CALL_VIDEO(prompt, chapter, len_in_seconds, last_video_object)`.
   The prompt uses the campaign, the living characters, and the battle rules.
   The last video goes in so the story continues.
7. **Parley screen**: the video streams, and the chapter ends on the face-off.
8. **Payout**: `payout(winner_wallets, amount)` pays the users who bet on the winner.
9. **Dead pool**: the loser's ENS subname moves to the dead pool (`status=dead`).
10. Go back to step 4 until one character is left.

## Battle rules

- Heroes cannot kill heroes. ENSv2 Enhanced Access Control enforces this rule, not only the prompt.
- Only living characters can fight.
- The winner is locked **before** the video plays, so bets are fair and people can check them.
  (Open: which source picks the winner. Options: commit-reveal of the LLM result, or onchain randomness.)

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
- A link to World's rule that Orb users must be 18+ (TODO: find the exact docs link).

Links:
- https://docs.world.org/world-id/idkit/integrate
- https://docs.world.org/world-id/idkit/credentials
- https://docs.world.org/world-id/credentials/1 (Proof of Human)
- https://docs.world.org/world-id/idkit/verification-flows
- https://developer.worldcoin.org

## ENS: ENSv2 on Sepolia (prize "Best Use of ENSv2", $3k / $2k / $1k)

ENS holds the game state of the characters. It is central to the game, not decoration.

| Game concept | ENSv2 feature |
|---|---|
| Each character, e.g. `jason.horrortube.eth` | Subname in our own subname registry |
| `status`, `side` (hero/villain), `kills`, `campaign` | Text records on a Permissioned Resolver |
| Heroes cannot kill heroes | Enhanced Access Control roles: a hero role cannot edit another hero's `status` |
| Loser goes to the dead pool | Move or alias the subname under `deadpool.horrortube.eth`, or revoke it |
| New campaign resets everyone | Reset the `status` records to `alive` |
| Bonus: fighters as AI agents | Each character is an agent namespace with its own permissions (ENSIP-25/26) |

**Requirements:** ENSv2 on Sepolia, no hard-coded values, a live demo link, and open-source code.

Links:
- https://docs.ens.domains/ensv2/overview/
- https://docs.ens.domains/ensv2/permissioned-registry
- https://docs.ens.domains/ensv2/permissioned-resolver/
- https://docs.ens.domains/ensv2/enhanced-access-control/
- https://docs.ens.domains/ensv2/tutorial-contract-developers/
- https://docs.ens.domains/ensip/25/ and https://docs.ens.domains/ensip/26/ (agents)

## Betting

- A simple pool contract on Sepolia with test ETH. Real money is not necessary for the demo.
- The pool per fight closes when the video starts.
- Winners share the pool in proportion to their bets.

## Out of scope

- World mini app (this is a regular web app).
- World ID for Agents prize and Continuity Track prizes.

## Risks

- Famous characters are protected by copyright. This is OK for a hackathon demo, but not for a public launch.
- ENSv2 is in beta on Sepolia. Expect changes and bugs.
