---
name: clear-safari-entry
description: Use when a Horror Tube player must see the waiver again in Safari, Forget Me left a wallet session, ht.verified skips the gate, or an agent is about to paste localStorage.removeItem for the waiver.
---

# Clear the Safari waiver entry

The browser entry and the World ID proof are different. This clears only the browser entry.

## Run

```bash
scripts/clear-safari-entry.sh --url https://<app-host>
scripts/clear-safari-entry.sh --url https://<app-host> --apply
```

`--url` is required. Take the origin from the Safari tab that has the game, or from the deployed app's URL. Do not invent a host. The command has no default URL.

The first command is a dry run. `--apply` removes the keys and reloads. A dry run is not a reset. Report the script's output. Do not say the entry was cleared unless the output contains `waiver is showing`.

Safari must have Develop > Allow JavaScript from Apple Events turned on. If the script says Safari refused, stop and ask the operator to turn that on. Do not paste `localStorage.removeItem` lines into chat instead.

## Keys

| Key | Left in place |
| --- | --- |
| `ht.verified` | Reload skips the waiver and enters the room |
| `horror-tube.wallet-session` | The coin box still opens for the last person |
| `horror-tube.payout-address` | Coin return still targets the last payer |

Forget Me removes only `ht.verified`.

## World ID

These keys are not the unique-human proof. World keeps one proof for action `enter-room`. After `--apply`, the same World ID fails the Orb scan again. Say that in the result. A different World ID can pass. Do not say the Orb entry was reset.
