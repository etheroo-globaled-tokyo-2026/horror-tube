# Character card text keys (video prompt)

Smallest ENS text set for a video LLM (not vision). Not product copy.

## Keys

| Key        | Who writes                         | Required | Purpose                                          |
| ---------- | ---------------------------------- | -------- | ------------------------------------------------ |
| `look`     | roster key at import               | yes      | Visible body, costume, silhouette. One sentence. |
| `brief`    | roster key at import               | yes      | One short lore line the fight can act on.        |
| `injuries` | `agent.horrortube.eth` after fight | yes\*    | LLM-written carried damage for the next clip.    |
| `status`   | `agent.horrortube.eth` on death    | yes\*    | `dead` removes the name from selection.          |
| `icon`     | roster key at import               | no       | HTTPS URL string to the CDN portrait.            |

Planned: `display_name` (roster key at import), the name the game shows. Until it exists, the game shows the label in caps.

\*At import: `injuries` blank means unhurt; `status` is `alive`. `dead` removes the name from selection (the name must still be `REGISTERED`). `""` is only for names written before `alive` was the default.

Drop: `strength`, `intelligence`, `luck`, `role`. Do not store bets, odds, HP, or numeric combat stats on ENS.

## Writing values

### `look`

Camera-ready body, costume, silhouette when healthy. No stats.

### `brief`

One action-usable lore line. Not a biography.

### `injuries`

Replaced after each win with the current damage the winner carries. Empty when unhurt. The injury writer is an LLM that does not look at an image. Each value names body part, appearance, and movement change if any. On loss set `status` = `dead`; do not use `injuries` to mean dead.

### `status`

New imports store `alive`. `dead` removes the name from selection. Omit `status` from the render prompt for living fighters.

## Icon (CDN URL on ENS)

Icon bytes live on a CDN (DigitalOcean Spaces). ENS stores only an HTTPS URL text record, key `icon`. The dashboard and the web game read that string, then fetch the image from the CDN. The CDN sends `access-control-allow-origin: *`, so the game can draw the image into its canvases.

Do not put image bytes or a contenthash on ENS for the icon. The web game loads every icon before the season starts. An empty or broken icon stops the game with an error that names the character (fill it with `python -m roster icons-chain`).

Measured 2026-09-26: reading the whole roster (7–8 names, 5 text records each) from a public Sepolia RPC takes about 0.4 s with one Multicall3 batch. It took about 1.5 s with one call at a time.

## Prompt assembly

```text
look: <look>
brief: <brief>
injuries: <injuries or "none">
```

Omit `status` when the name is already known living. Never send dropped RPG keys. `icon` is the face in the dashboard and the web game (and an optional reference if a path accepts a URL); it is not a substitute for `look`.

## What the web game shows

- Case file: `brief`, then `injuries` ("None." when empty). Not `look`: that is for the video model.
- `status` = `dead`: black-and-white face, crossed-off name. The character cannot get votes. `""` counts as alive. Any other value stops the game with an error.

## Permission split

- Roster key: `look`, `brief`, `icon`. Cannot set `status` or `injuries`.
- Agent: `status`, `injuries` only. Cannot rewrite `look` or `brief`.
