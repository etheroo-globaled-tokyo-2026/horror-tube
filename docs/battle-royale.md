# Horror Tube battle royale

Working notes. Not a commit message. Do not treat this file as shipped product copy.

## Pivot

The product is a battle royale, matching the Excalidraw board (https://excalidraw.com/#json=HrUC23lpjwUd7CcAqqbFD,zxGoEc4mEhGHmJ3jCCHorQ).

- Frontend shows re-runs and the active battle video. Viewers bet on which of the two characters the LLM will pick as the winner. The side with more bets does not decide the battle.
- Video playback is assumed to stay on the AI site for now.
- The battle contract holds stakes and pays the winning side. DigitalOcean Managed PostgreSQL stores the settled outcome for the app. Bets, odds, and payouts stay off ENS.
- Character icons for the dashboard go on a CDN. DigitalOcean Spaces can serve objects through the Spaces CDN. Icons are public web assets, not ENS records.
- ENS parent name: `horrortube.eth`.

## ENS death name

Research: [ENS death-name research](fb72ea2f-728e-4b3a-9d3b-d56882350a07). Sources were ENSv2 docs via Tavily and Context7 library `/ensdomains/docs`.

Decision for now: keep one stable name, `character.horrortube.eth`. On death, write a text record (`status` = `dead`) with `ROLE_SET_TEXT` granted only for that key. The name token and the other card records stay.

Why not a move:

- ENSv2 has no reparent that keeps the same token and resolver records.
- `unregister` on `character.horrortube.eth` plus `register` of the same label under `dead.horrortube.eth` is a new registration and a new namehash. Records do not follow unless they are copied, or the new name is linked with `linkToNode` or `linkToRecord`. At commit `71a3b733` the resolver has no `setAlias`.
- Pointing both parents at the same subregistry is a namespace alias. Indexing says the child is both names at once and they share a token id. That does not mean "dead."
- `safeTransferFrom` changes the owner inside one registry. It does not change the parent.

`character.living.horrortube.eth` / `character.dead.horrortube.eth` is only worth it if the name string itself must be the status. That path is unregister plus a new register, not a move.

`unregister` leaves the text bytes on the resolver and stops the registry from returning that resolver. The next read falls through to the parent. The prompt builder must fail that read. A parent wildcard must not supply the next battle's card.

## Character permissions

The bounty text to satisfy: own subname registry, Enhanced Access Control, a Permissioned Resolver per subname, a narrow text-record grant, and an agent as a named identity. Namespace aliasing and emancipation are not the death mechanic.

`horrortube.eth` deploys its own UserRegistry and is linked to it with `setSubregistry` and `setParent`. Each living character is a label in that registry (`character.horrortube.eth`). Registration does not deploy a resolver. One account can deploy many resolvers. Deploy one Permissioned Resolver per character from `PermissionedResolverImpl` and set it on that name. `grantSetterRoles` ignores the name and keys the grant by `keccak256` of the text key, so a grant covers every name on that resolver.

The battle app owns every character. A user does not. For a battle, the app selects two registered names from the roster. The app reads those text records and sends them upstream as lore for the battle-video prompt. Bettors get no ENS roles. The user bets on the outcome of the pair the app selected.

Text keys on the card: `brief`, `strength`, `intelligence`, `luck`, `role`, `injuries`, `status`. Icon URL may be a text record; the image bytes stay on Spaces. `injuries` is the damage the winner carries into the next battle (a broken limb, and so on). The prompt builder reads it with the card. It does not rewrite `strength`, `intelligence`, `luck`, `brief`, or `role`.

The app account owns the name tokens. Each character still has its own resolver.

Grants are split by key across app-held keys. The deployments page pins Sepolia ENSv2 beta to contracts-v2 commit `71a3b733` (15 September 2026). That deployment's `PermissionedResolverImpl` is `0x14f09fd05d4585759e54844dc9b00147131cf243`, and its ABI has `grantSetterRoles(bytes setter, address account)`, not `authorizeTextRoles`. Do not grant root `ROLE_SET_TEXT`.

One admin key, neither the roster key nor the agent, alone holds `ROLE_SET_TEXT_ADMIN`, `ROLE_UPGRADE`, `ROLE_LINK`, and `ROLE_SET_RESOLVER` on that character. Those four can grant `status` to themselves, replace the resolver code, detach the card, or point the name at another resolver.

- The roster key may `setText` `brief`, `strength`, `intelligence`, `luck`, and `role` when a character is added. It cannot set `status` or `injuries`.
- `agent.horrortube.eth` may `setText` `status` and `injuries` only, after the LLM names the winner. Death is `status` = `dead` on the loser. On the winner, the agent writes the LLM's damage into `injuries`. The agent cannot edit `brief`, `strength`, `intelligence`, `luck`, or `role`.
- No key gets root `ROLE_SET_TEXT`.

Users never write ENS. The permission demo is that the video agent cannot rewrite the original card, and the roster key cannot mark a character dead or invent their wounds. The next prompt reads the card plus `injuries`. The prompt builder reads the character resolver directly. If resolution falls through to the parent wildcard, fail the prompt. A dead or empty name must not enter the next battle through the parent resolver.

The registration bitmap is granted to the token owner, the app, not to the agent. Put `ROLE_UNREGISTER_ADMIN` in that bitmap. After register, the app grants `ROLE_UNREGISTER` to `agent.horrortube.eth`. That grant regenerates the token id, so later calls look the name up by labelhash. The agent calls `unregister` only when the character must leave the registry.

Transfer: leave `ROLE_CAN_TRANSFER_ADMIN` out of the registration bitmap. That is what makes the character non-transferable. `unsafeTransfer` skips the emancipation check, so leaving dangerous root roles in place does not block a transfer. Do not emancipate the character registry for the demo.

Do not use a shared subregistry to alias `living` and `dead`. Record linking (`linkToNode` or `linkToRecord`) is only for pointing a second name at an existing card, not for killing a character.

Still to show for the prize, and not built yet: `agent.horrortube.eth` registered with an address record and a reverse name, so the address that writes `status` is that name. An expiry on a character, and one transferable or forever name beside the non-transferable roster. A `champion.horrortube.eth` label linked to the current winner's card, if we want aliasing on screen. `horrortube.eth` itself is not confirmed registered on this Sepolia deployment.

## Betting

The app selects two registered characters and reads their cards into the LLM prompt. The LLM decides the winner. Bettors stake on which name they think the LLM will pick. The pool pays the bets that match that pick.

The battle contract holds the stakes and pays the side that matches the LLM's winner. It does not tally votes. Only the battle agent may submit that winner and the winner's damage. A bettor cannot settle the battle. After that submission, the agent sets `status` = `dead` on the losing name and writes the damage into `injuries` on the winner.

PostgreSQL stores the settled outcome for the app. ENS does not store bets, odds, or payouts.

## World ID

Source: [World ID bet gate](e2845e0a-22fa-4639-80a5-c57516118ce2). Current docs are IDKit 4.x. Context7's IDKit package still shows the old widget API.

The trust moment is placing the stake. Gate that action with Proof of Human only. One nullifier per human per battle stops one person from staking through many wallets. The bounty rewards the minimum sufficient credential, so Proof of Human and an age check on the same button weakens the entry.

Age is a different question: whether this person may wager at all. It is not Sybil resistance. Leave it out of the IDKit demo unless Identity Check is actually usable during the hackathon, and then narrate it as a separate gate.

Flow: the wallet connects, the user chooses a side and an amount, the server signs the request, IDKit runs in the browser with the wallet as the signal, the server posts the proof to `POST /api/v4/verify/{rp_id}`, stores the nullifier, then allows the stake. The signing key stays on the server. Do not store biometrics or the proof blob. Demo cancellation: if the user declines IDKit, the stake does not open. World ID for Agents is a separate prize and is out of this path.
