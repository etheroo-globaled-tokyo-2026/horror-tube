# Character card text keys (video prompt)

Smallest ENS text set for a video LLM (not vision). Not product copy.

## Keys

| Key        | Who writes                         | Required | Purpose |
| ---------- | ---------------------------------- | -------- | ------- |
| `display_name` | roster key at import           | yes      | Human-readable character name shown to people. |
| `look`     | roster key at import               | yes      | Visible body, costume, silhouette. One sentence. |
| `brief`    | roster key at import               | yes      | One short lore line the fight can act on. |
| `injuries` | `agent.horrortube.eth` after fight | yes\*    | LLM-written carried damage for the next clip. |
| `status`   | `agent.horrortube.eth` on death    | yes\*    | `dead` removes the name from selection. |
| `icon`     | roster key at import               | no       | HTTPS URL string to the CDN portrait. |

\*At import: `injuries` is the string `[]`, meaning unhurt; `status` is `alive`. `dead` removes the name from selection (the name must still be `REGISTERED`). `""` is only allowed for legacy `status`.

Drop: `strength`, `intelligence`, `luck`, `role`. Do not store bets, odds, HP, or numeric combat stats on ENS.

## Writing values

### `look`

Camera-ready body, costume, silhouette when healthy. No stats.

### `brief`

One action-usable lore line. Not a biography.

### `injuries`

Replaced after each win with a JSON array of the current damage the winner carries. `[]` means unhurt. Each array item is one non-empty injury description or short label. The injury writer is an LLM that does not look at an image. On loss set `status` = `dead`; do not add death to `injuries`.

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

- Roster key: `display_name`, `look`, `brief`, `icon`. Cannot set `status` or `injuries`.
- Agent: `status`, `injuries` only. Cannot rewrite `display_name`, `look`, or `brief`.
