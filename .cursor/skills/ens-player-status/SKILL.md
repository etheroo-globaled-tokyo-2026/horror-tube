---
name: ens-player-status
description: Use when checking whether Horror Tube players are alive or dead on ENS, when the room shelf disagrees with chain status, or when opening the character dashboard to read status text.
---

# ENS player status

Alive and dead live in the ENS text record `status` on each character subname. The room shelf is a copy. Read the chain.

## Chain read

From the repo root:

```bash
pnpm --filter @horror-tube/ens exec tsx scripts/character-subnames.ts list --out /tmp/ht-roster-status.json
python3 -c 'import json; d=json.load(open("/tmp/ht-roster-status.json"));
[print(k, repr(d[k]["status"])) for k in sorted(d)]'
```

`list` is read-only. It needs `ENS_LABEL` and `SEPOLIA_RPC_URL` in the repo-root `.env`. If either is missing or blank, stop and name the variable. Do not invent a label or an RPC URL.

The file is a JSON object keyed by label. Print `status` and stop there.

| status | meaning |
| --- | --- |
| `alive` | alive |
| `""` | alive |
| `dead` | dead |
| anything else | error; report the label and the value; do not treat it as alive or dead |

## Dashboard

Use this when a person needs to look, or when you need the same roster in a page.

From the repo root:

```bash
pnpm dashboard
```

Wait until stdout prints `http://127.0.0.1:<port>/`. That port is 8130 unless `DASHBOARD_PORT` is set. Open that URL.

If something is already listening on that port, open the URL. Starting `pnpm dashboard` stops the previous listener and takes the port.

Read the text of each `dd.status`:

```js
Array.from(document.querySelectorAll("dd.status")).map((e) => e.textContent.trim())
```

Every status line is colored with the CSS variable `--alive`. The color does not mean the character is alive.

The page is read-only. It does not need a private key.

## Do not

- Do not `register`, `restore`, `reset-text`, `apply-text`, or any other write of `status`.
- Do not use `packages/roster/roster/fixtures/` or a hand-written sheet in place of the chain read.
- Do not decide alive or dead from the room UI.
