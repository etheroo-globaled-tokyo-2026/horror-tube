# Roster JSON, plans, and character subname register/unregister

Part of #23: propose character sheets from Fandom, validate JSON, emit **plans**,
and **register/unregister** character subnames under `ENS_LABEL` on Sepolia ENSv2.

| Command       | Chain?  | Role                                                                 |
| ------------- | ------- | -------------------------------------------------------------------- |
| `propose`     | no      | Build roster JSON from Fandom `api.php`                              |
| `import`      | no      | Validate JSON and write an import **plan** (`chain_writes: false`)   |
| `plan-remove` | no      | Validate labels and write a removal **plan** (`chain_writes: false`) |
| `register`    | **yes** | Read chain text/status, then `UserRegistry.register` + `setText`     |
| `remove`      | **yes** | `UserRegistry.unregister` for each label                             |
| `icons`       | no      | Generate 100×100 face PNGs from each `look` via Together FLUX.1      |

`import` / `plan-remove` never send transactions. `register` / `remove` always hit
chain (after validating input). Do not confuse them.

Parent name comes from `ENS_LABEL` (`label.eth`). Character subnames are
`label.<ENS_LABEL>.eth`. Missing or blank `ENS_LABEL`, `SEPOLIA_RPC_URL`, or
`PRIVATE_KEY` fails with an error that names the variable. The CLI loads `.env`
via `python-dotenv` when present. `propose` does not require ENS env vars.
`icons` does not require ENS env vars; it requires `TOGETHER_API_KEY`,
`TOGETHER_IMAGE_MODEL`, and `TOGETHER_API_URL`.

## Schemas

Checked in under `packages/roster/roster/schemas/`:

| File                         | Shape                                |
| ---------------------------- | ------------------------------------ |
| `character.schema.json`      | One character object                 |
| `character-bulk.schema.json` | Non-empty array of character objects |

### Required fields (every key must be present)

| Key        | Rules                                                                         |
| ---------- | ----------------------------------------------------------------------------- |
| `label`    | Lowercase DNS label (`a-z0-9` and internal hyphens)                           |
| `look`     | Non-empty string                                                              |
| `brief`    | Non-empty string                                                              |
| `injuries` | String; use `""` when unhurt. **Missing key is an error** (no silent default) |
| `status`   | Must be present. New sheets use `alive`. `dead` is not selectable. `""` is only for names written before `alive` was the default |
| `icon`     | `""` or an `https://` URL. Missing key is an error                            |

**Forbidden keys:** `strength`, `intelligence`, `luck`, `role`.

Import accepts either one character object or a bulk array.

## Fixture

`packages/roster/roster/fixtures/sample-characters.json` is a **fixture** of two invented
characters for local tests. It is not live Fandom lore.

`packages/roster/roster/fixtures/fandom-api.json` holds real `villains.fandom.com` `api.php`
responses keyed by host and sorted query. Propose tests read it and never hit
the network.

## Commands

Install deps once, then run the commands below from `packages/roster/` with
`.venv/bin/python` (or activate `.venv`):

```bash
pnpm install
pnpm --filter @horror-tube/roster venv
```

### propose

Reads N pages through `https://<wiki>.fandom.com/api.php?action=parse` and
writes proposed roster JSON. It never fetches `/wiki/` HTML and never falls
through to another site. `--n` must equal the number of sources.

```bash
python3 -m roster propose \
  --n 1 \
  --source 'https://villains.fandom.com/wiki/Pinhead_(Hellraiser)' \
  --out /tmp/pinhead.json
```

### import (plan only)

```bash
ENS_LABEL=horrortube python3 -m roster import \
  --input roster/fixtures/sample-characters.json \
  --out /tmp/import-plan.json
```

Writes a normalized import plan. Does not submit a transaction.

### register (sends transactions)

Ensures the parent has a UserRegistry subregistry and PermissionedResolver
(deployed via pin `VerifiableFactory` if missing), reads chain status/text for
each label, then registers and writes `look` / `brief` / `injuries` / `status` /
`icon` via `setText`.

```bash
python3 -m roster register --input /tmp/one-character.json
```

If a label is already registered on chain, the command fails unless
`--on-existing=skip` or `--on-existing=restore` is passed. Chain text records
are the source of prior `status` / `injuries` (not only a local file).

- `skip`: leave chain unchanged and report the label
- `restore`: set `status` to `alive` and write `injuries` from the **input file**
  (the file must include `injuries` explicitly)

### plan-remove (plan only)

```bash
ENS_LABEL=horrortube python3 -m roster plan-remove \
  --input labels.json \
  --out /tmp/remove-plan.json
```

### icons (Together)

Reads `TOGETHER_API_KEY`, `TOGETHER_IMAGE_MODEL`, and `TOGETHER_API_URL` from
the environment. Missing or blank values fail. The model id is whatever
`TOGETHER_IMAGE_MODEL` is set to. Generates a square portrait at 1024×1024,
then writes a 100×100 PNG named `<label>.png`. Does not upload to Spaces and
does not change the `icon` URL on the sheet. Refuses a path under `fixtures`.

```bash
python3 -m roster propose \
  --n 1 \
  --source 'https://villains.fandom.com/wiki/Pinhead_(Hellraiser)' \
  --out /tmp/pinhead.json

python3 -m roster icons \
  --input /tmp/pinhead.json \
  --out-dir /tmp/horror-tube-icons
```

### remove (sends transactions)

```bash
python3 -m roster remove --input labels.json
```

`labels.json` is a JSON array of label strings. Sends `UserRegistry.unregister`
for each. Use `plan-remove` if you only want the JSON plan.

## Character sheet dashboard

Read-only local page that discovers registered subnames under `ENS_LABEL.eth`
and shows `look` / `brief` / `injuries` / `status` / `icon`. Needs
`ENS_LABEL` and `SEPOLIA_RPC_URL`. Listens on port 8130. Set `DASHBOARD_PORT`
in `.env` to use another port. Does not need `PRIVATE_KEY` and does not send
transactions.

```bash
pnpm --filter @horror-tube/ens dashboard
```

Then open `http://127.0.0.1:8130/`. If that port is already taken, this process stops the listener and binds it. Each name links to its ENS page, and the registry owner address links to Sepolia Etherscan. Each GET re-reads the chain.

## Tests

```bash
pnpm test
```
