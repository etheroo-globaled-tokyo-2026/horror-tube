# Horror Tube

A battle royale of famous horror movie characters. AI makes each fight as a video.
Verified humans vote on who fights next (free). Users bet on who wins (paid).

ETHGlobal Tokyo 2026. Target prizes: **World** (IDKit) and **ENS** (ENSv2).

## Art direction

Based on *FAITH: The Unholy Trinity* (https://store.steampowered.com/app/1179080/FAITH_The_Unholy_Trinity/).

- Black background.
- Thin, glowing line art in one color per subject (blood red, cold blue, rust brown).
- Rough, low-res, pixel look, like an old computer. No gradients, no glossy UI.

## Components

- **ENS name**: character state (subnames and text records) on Sepolia.
- **Database**: Cloudflare Durable Objects. Holds lore, battle results, and damage.
- **Smart contract**: the betting pool.
- **Frontend host**: Vercel or similar.

## Flow

1. **Log in**: the user logs in to the web app with World ID. This proves that they are a real human and 18+. The user can use a browser wallet.
2. **Connect wallet**: `check_funds(wallet)` checks that the wallet has enough test ETH to bet.
3. **Main screen**:
   - Top: the current battle. When no battle is live, the last battle plays again on a loop, with a very clear "REC" (camcorder recording) effect.
   - Below: a panel of living and dead characters. The panel uses the app's art style.
   - **Vote (free)**: everyone votes for the next fighters. The two living characters with the most votes fight. Dead characters cannot get votes.
4. **Load characters**: the two fighters load from their ENS subnames.
5. **Permission check**: do the fighters miss capabilities from past battles? (Open: see question 2.)
6. **Story**: the LLM gets the story prompt, the character state, and lore text for each character (from the database or fandom.com).
   The LLM picks the winner and the winner's damage, and writes them as the last line of the turn.
   The server stores the winner and damage in the database, **not onchain**.
7. **Open betting**: the contract state changes. Voting closes and betting opens for the next battle. (Open: see question 1.)
8. **Countdown and bet**: users bet on the outcome (paid) until the countdown ends.
   The video model makes the video from the LLM text **during** the countdown, so it is ready when betting ends.
9. **Show video**: the fight video plays at the top of the main screen.
10. **Update ENS**:
    - The loser's subname moves to the dead pool. (Open: see question 3.)
    - The winner takes damage. Its ENS text records update.
    - The contract reads the loser's ENS status. If it is `dead`, bets on the other fighter win, and the winners can claim.
11. Go back to the vote on the main screen (step 3), until one character is left.

**Known limit:** the server knows the winner while people bet, and the winner is only in the database. People must trust us. This is OK for the demo.

## Damage

- The database keeps the full damage history. ENS text records show only the current damage.
- The next story prompt includes the damage, so the character fights worse and looks hurt in the video.
- Damage can remove capabilities (step 5).

## Open questions

1. **What changes the contract state in step 7?** The diagram says "indexer", but an indexer usually only reads the chain.
   Default until we decide: our backend sends the transaction when it stores the story. One backend, one wallet, no real indexer.
2. **What is a "capability"?** A weapon, a body part, or a move? And can ENSv2 permissions describe it, or is it only a text record?
3. **What is the dead-pool name?** The diagram has two versions: `character.dead` and a move to a dead-pool parent name.

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
| `status`, `kills`, `damage` | Text records on a Permissioned Resolver |
| Capabilities lost to damage | Open: Enhanced Access Control roles, or a text record (open question 2) |
| Loser goes to the dead pool | Move or alias the subname (open question 3) |
| The contract pays out from ENS state | The betting contract reads the loser's `status` |
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
- Betting opens when voting closes. It closes when the countdown ends.
- Winners share the pool in proportion to their bets.

## Out of scope

- World mini app (this is a regular web app).
- World ID for Agents prize and Continuity Track prizes.

## Risks

- Famous characters are protected by copyright. This is OK for a hackathon demo, but not for a public launch.
- ENSv2 is in beta on Sepolia. Expect changes and bugs.
- fandom.com text is CC BY-SA. If we use it, we must credit the source.
