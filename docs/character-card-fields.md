# Character card text keys (video prompt)

Smallest ENS text set for a video LLM (not vision). Not product copy.

## Keys

| Key        | Who writes                         | Required | Purpose |
| ---------- | ---------------------------------- | -------- | ------- |
| `display_name` | roster key at import           | yes      | Human-readable character name shown to people. |
| `look`     | roster key at import               | yes      | Visible body, costume, silhouette. One sentence. |
| `brief`    | roster key at import               | yes      | One short lore line the fight can act on. |
| `injury_places` | roster key at import          | yes      | JSON list of places this character can be injured. |
| `injuries` | `agent.horrortube.eth` after fight | yes\*    | JSON list of damage the character is carrying now. |
| `status`   | `agent.horrortube.eth` on death    | yes\*    | `dead` removes the name from selection. |
| `icon`     | roster key at import               | no       | HTTPS URL string to the CDN portrait. |

\*At import: `injuries` is the string `[]`, meaning unhurt; `status` is `alive`. `dead` removes the name from selection (the name must still be `REGISTERED`). `""` is only allowed for legacy `status`.

Drop: `strength`, `intelligence`, `luck`, `role`. Do not store bets, odds, HP, or numeric combat stats on ENS.

## Writing values

### `look`

Camera-ready body, costume, silhouette when healthy. No stats.

### `brief`

One action-usable lore line. Not a biography.

### `injury_places`

JSON array of at least one place damage can land. Each item is descriptive text or a short label. The lists for the three roster batches are in `packages/roster/roster/injury_places.json`, taken from issues #11, #12, and #13. This is not current damage. `propose` uses that file for a known label and fails if the label is missing. It does not invent a place.

### `injuries`

Replaced after each win with a JSON array of the current damage the winner carries. `[]` means unhurt. Each array item is one non-empty injury description or short label, and it should name one of `injury_places` when that list is the reason the blow landed. The injury writer is an LLM that does not look at an image. On loss set `status` = `dead`; do not add death to `injuries`.

### `status`

New imports store `alive`. `dead` removes the name from selection. Omit `status` from the render prompt for living fighters.

## Icon (CDN URL on ENS)

Dashboard icon bytes live on a CDN (DigitalOcean Spaces). ENS stores only an HTTPS URL text record (suggested key: `icon`). The frontend reads that string, then fetches the image from the CDN.

Do not put image bytes or a contenthash on ENS for the icon. Cache the resolved URL in the app. A static placeholder while it loads is enough and is out of scope.

No ENSv2 Sepolia millisecond measurement was found. An April 2024 ENS forum sample (author calls it flawed) put ordinary onchain resolves around 0.77–0.89s: https://discuss.ens.domains/t/resolvers-latency/19136

## Prompt assembly

```text
name: <display_name>
look: <look>
brief: <brief>
injury_places:
- <place>
- <place>
injuries: none
```

For a non-empty injury list, replace `injuries: none` with one bullet per injury:

```text
injuries:
- <first injury>
- <second injury>
```

Omit `status` when the name is already known living. Never send dropped RPG keys. `icon` is for the dashboard (and optional reference if a path accepts a URL); it is not a substitute for `look`.

## Permission split

- Bootstrap/admin (`PRIVATE_KEY`): registration, `grantSetterRoles`, and import-time
  `display_name` / `injury_places` (roster key is not granted those setters).
- Roster key (`ROSTER_PRIVATE_KEY`): `look`, `brief`, `icon`. Cannot set `status` or `injuries`.
- Agent (`AGENT_PRIVATE_KEY`): `status`, `injuries` only. Cannot rewrite `look`, `brief`, or `icon`.
