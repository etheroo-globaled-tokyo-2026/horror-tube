# Roster JSON, plans, and character subname register/unregister

Part of #23: propose character sheets from Fandom, validate JSON, emit **plans**,
and **register/unregister** character subnames under `ENS_LABEL` on Sepolia ENSv2.

| Command        | Chain?  | Role                                                                 |
| -------------- | ------- | -------------------------------------------------------------------- |
| `sections`     | no      | Print Fandom `api.php` section headings as JSON                      |
| `propose`      | no      | Build roster JSON from Fandom `api.php`                              |
| `import`       | no      | Validate JSON and write an import **plan** (`chain_writes: false`)   |
| `plan-remove`  | no      | Validate labels and write a removal **plan** (`chain_writes: false`) |
| `register`     | **yes** | Read chain text/status, then `UserRegistry.register` + `setText`     |
| `remove`       | **yes** | `UserRegistry.unregister` for each label                             |
| `icons`        | no      | Generate face PNGs, upload to Spaces CDN, write `icon` URLs on the sheet |
| `icons-cache`  | no      | Explicitly regenerate icons from checked-in text and exact saved prompts |
| `icons-chain`  | **yes** | Fill empty on-chain `icon` from chain `look` (Spaces + setText icon only) |
| `wipe`         | **yes** | Unregister every character subname. Does not remove the parent `.eth` name |
| `redeploy`     | **yes** | Propose the 10 cast fighters, upload icons, and register them |

`import` / `plan-remove` never send transactions. `register` / `remove` /
`icons-chain` / `wipe` / `redeploy` always hit chain (after validating input).
Do not confuse them.

Parent name comes from `ENS_LABEL` (`label.eth`). Character subnames are
`label.<ENS_LABEL>.eth`. Missing or blank `ENS_LABEL`, `SEPOLIA_RPC_URL`, or
`PRIVATE_KEY` (bootstrap/admin), `ROSTER_PRIVATE_KEY` (look/brief/icon), or
`AGENT_PRIVATE_KEY` (status/injuries) fails with an error that names the variable.
The CLI loads the repo-root `.env`, not a `.env` in the working directory. A missing file is fine. `propose` does not require
ENS env vars. `icons` does not require ENS env vars; it requires `TOGETHER_API_KEY`,
`TOGETHER_IMAGE_MODEL`, `TOGETHER_API_URL`, `SPACES_ACCESS_KEY_ID`,
`SPACES_SECRET`, `SPACES_BUCKET`, `SPACES_CDN_HOST`, and `SPACES_ENDPOINT`.
Spaces uploads use those two Spaces keys only and ignore `AWS_PROFILE`.
`icons-chain` requires both the ENS write vars and the Together/Spaces vars.

Restricted keys must not be the bootstrap address. Roster and fight writers load
`ROSTER_PRIVATE_KEY` / `AGENT_PRIVATE_KEY` and refuse to run when that address
equals `PRIVATE_KEY`.

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
| `display_name` | Non-empty human-readable name; never defaulted from `label`               |
| `injury_places` | JSON array of at least one place this character can be injured. `propose` reads `injury_places.json` (issues #11, #12, #13) and fails if the label is missing |
| `look`     | Non-empty string                                                              |
| `brief`    | Non-empty string                                                              |
| `injuries` | String containing a JSON array of non-empty strings; use `"[]"` when unhurt. **Missing key is an error** |
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

When one article has the body and another has the fight kit, pass both pages
with `--n 1`. The look page must have a look heading and the brief page a brief
heading (the same headings `propose --source` accepts). Both titles must produce
the same label. A disambiguation URL fails. `cast.json` entries with
`look_source` / `brief_source` use the same path.

```bash
python3 -m roster sections \
  --source 'https://villains.fandom.com/wiki/Frankenstein%27s_Monster_(Universal_Monsters)'

python3 -m roster propose \
  --n 1 \
  --look-source 'https://villains.fandom.com/wiki/Frankenstein%27s_Monster_(Universal_Monsters)' \
  --brief-source 'https://villains.fandom.com/wiki/Frankenstein%27s_Monster_(Mary_Shelley)' \
  --out /tmp/frankenstein.json
```

`sections` prints headings only. Use it instead of an inline script. The roster
interpreter is Python 3.9, and a backslash inside an f-string expression is a
SyntaxError there.

To fetch all 10 entries in `roster/cast.json` and update the checked-in prompt
cache from that same live Fandom run:

```bash
python3 -m roster propose \
  --cast \
  --out /tmp/horror-tube-live-cast.json \
  --prompt-cache roster/icon-prompt-cache.json
```

`--prompt-cache` is accepted only with `--cast`. The cache records
`label`, `display_name`, the unmodified Fandom `look` and `brief`, the exact
image prompt, and separate look/brief source URLs. It does not call Together,
Spaces, or ENS.

### import (plan only)

```bash
ENS_LABEL=horrortube python3 -m roster import \
  --input roster/fixtures/sample-characters.json \
  --out /tmp/import-plan.json
```

Writes a normalized import plan. Does not submit a transaction.

### wipe and redeploy (sends transactions)

`wipe` unregisters every character subname under `ENS_LABEL`. It does not read text records and it does not remove the parent `.eth` name.

`redeploy` proposes the 10 fighters in `packages/roster/roster/cast.json` from live Fandom pages, uploads face icons, and registers them with `display_name`, `injury_places`, and `injuries`. It stops if a page has no look or brief section. It does not invent those fields.

```bash
python3 -m roster wipe
python3 -m roster redeploy
```

### register (sends transactions)

Ensures the parent has a UserRegistry subregistry and PermissionedResolver
(deployed via pin `VerifiableFactory` if missing), grants restricted setter
roles via pinned `grantSetterRoles`, reads chain status/text for each label,
then registers with the bootstrap key and splits `setText` writes:

- bootstrap (`PRIVATE_KEY`): `display_name`, `injury_places`
- roster (`ROSTER_PRIVATE_KEY`): `look`, `brief`, `icon`
- agent (`AGENT_PRIVATE_KEY`): `status`, `injuries` (new names get `alive` / `[]`)

```bash
python3 -m roster register --input /tmp/one-character.json
```

If a label is already registered on chain, the command fails unless
`--on-existing=skip` or `--on-existing=restore` is passed. Chain text records
are the source of prior `status` / `injuries` (not only a local file).

- `skip`: leave chain unchanged and report the label
- `restore`: set `status` to `alive` and write `injuries` from the **input file**
  (the file must include `injuries` explicitly)

### rewrite-empty-injuries (agent key only; not fight-settle)

One-shot repair for living characters whose on-chain `injuries` text is exactly
`""`. Sets those to `[]` with `AGENT_PRIVATE_KEY`. Stops on any other non-array
value and prints the subname and raw value. Do not run this as part of fight
settle. Do not point this at live Sepolia from CI.

```bash
pnpm ens:subnames rewrite-empty-injuries --labels /tmp/labels.json
```

### plan-remove (plan only)

```bash
ENS_LABEL=horrortube python3 -m roster plan-remove \
  --input labels.json \
  --out /tmp/remove-plan.json
```

### icons (Together + Spaces)

Reads Together and Spaces variables from the environment. Missing or blank
values fail and name the variable. Generates a square portrait at 1024×1024,
resizes to 100×100, uploads to the Spaces bucket with ACL `public-read`, and
writes updated character JSON with `icon` set to
`https://<SPACES_CDN_HOST>/<object-key>`.

Object keys:

- First upload: `<label>.png`
- `--override` when that object already exists: `<label>-<unix-seconds>.png`
  (does not overwrite `<label>.png` in place)

If `<label>.png` already exists on Spaces and `--override` was not passed, the
command skips Together and upload, logs the existing CDN URL, and fills an
empty `icon` field with that URL. A local PNG under `--out-dir` is not enough
to skip; existence is checked on the bucket. Refuses a path under `fixtures`.
One character failure stops the command.

`face_prompt` removes configured violent terms from the image prompt only, then
adds explicit no-blood, no-gore, no-wounds, and no-weapons instructions. The
sheet's `look` remains the full Fandom sentence.

```bash
python3 -m roster propose \
  --n 1 \
  --source 'https://villains.fandom.com/wiki/Pinhead_(Hellraiser)' \
  --out /tmp/pinhead.json

python3 -m roster icons \
  --input /tmp/pinhead.json \
  --out-dir /tmp/horror-tube-icons \
  --out /tmp/pinhead-with-icon.json

# Regenerate and upload under a new key when the canonical object already exists:
python3 -m roster icons \
  --input /tmp/pinhead.json \
  --out-dir /tmp/horror-tube-icons \
  --out /tmp/pinhead-with-icon.json \
  --override
```

### icons-cache (Together + Spaces, explicit cache use)

The git-tracked cache is
`packages/roster/roster/icon-prompt-cache.json`. `icons-cache` uses its saved
text and exact `image_prompt`; it does not fetch Fandom and does not rebuild the
prompt from `look`. A missing or malformed cache stops before Together or
Spaces setup and names the cache file.

```bash
python3 -m roster icons-cache \
  --cache roster/icon-prompt-cache.json \
  --out-dir /tmp/horror-tube-icons \
  --out /tmp/horror-tube-cached-icons.json \
  --override
```

Omit `--override` to reuse canonical `<label>.png` objects already in Spaces.
As with `icons`, `--override` writes `<label>-<unix-seconds>.png` when the
canonical object exists.

### icons-chain (Together + Spaces + ENS icon only)

Discovers every registered character under `ENS_LABEL.eth` from chain. For each
character whose on-chain `icon` is empty, generates a face PNG from the on-chain
`look`, uploads to Spaces, and `setText`s **only** the `icon` key to the https
CDN URL. Does not rewrite `display_name`, `look`, `brief`, `injury_places`, `injuries`, or `status`. Skips
characters that already have a non-empty https icon unless `--override`. Fails
if `look` is empty (names the label). One failure stops the command.

```bash
python3 -m roster icons-chain
```

### remove (sends transactions)

```bash
python3 -m roster remove --input labels.json
```

`labels.json` is a JSON array of label strings. Sends `UserRegistry.unregister`
for each. Use `plan-remove` if you only want the JSON plan.

## Character sheet dashboard

Read-only local page that discovers registered subnames under `ENS_LABEL.eth`
and shows `display_name` / `look` / `brief` / `injury_places` / `injuries` / `status` / `icon`.
`packages/ens/scripts/roster.ts` is the shared chain reader for this page, `character-subnames list`, and `apps/web/game.ts`. Needs
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
