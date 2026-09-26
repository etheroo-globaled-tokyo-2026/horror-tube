# Roster JSON import and removal plans

Part of #23: propose character sheets from Fandom, validate JSON, and emit
**plans**. This does **not** read chain state or send register/unregister
transactions. On-chain subname register/unregister is not implemented yet.

Parent name comes from `ENS_LABEL` (`label.eth`). Character subnames are
`label.<ENS_LABEL>.eth`. Missing or blank `ENS_LABEL` fails with an error that
names the variable. `propose` does not require `ENS_LABEL` and does not call ENS.

## Schemas

Checked in under `roster/schemas/`:

| File | Shape |
| --- | --- |
| `character.schema.json` | One character object |
| `character-bulk.schema.json` | Non-empty array of character objects |

### Required fields (every key must be present)

| Key | Rules |
| --- | --- |
| `label` | Lowercase DNS label (`a-z0-9` and internal hyphens) |
| `look` | Non-empty string |
| `brief` | Non-empty string |
| `injuries` | String; use `""` when unhurt. **Missing key is an error** (no silent default) |
| `status` | Must be present. Allowed: `""` or `dead` only. Anything else is rejected |
| `icon` | `""` or an `https://` URL. Missing key is an error |

**Forbidden keys:** `strength`, `intelligence`, `luck`, `role`.

Import accepts either one character object or a bulk array.

## Fixture

`roster/fixtures/sample-characters.json` is a **fixture** of two invented
characters for local tests. It is not live Fandom lore.

`roster/fixtures/fandom-api.json` holds real `villains.fandom.com` `api.php`
responses keyed by host and sorted query. Propose tests read it and never hit
the network.

## Commands

Install deps once:

```bash
python3 -m pip install -r roster/requirements.txt
```

### propose

Reads N pages through `https://<wiki>.fandom.com/api.php?action=parse` and
writes proposed roster JSON that matches the schemas above. It never fetches
`/wiki/` HTML (Fandom returns 403) and never falls through to another site.
`--n` must equal the number of sources. A `/wiki/<Title>` URL is only parsed for
host and title.

The command fails, naming the page, when:

- the page is a disambiguation page (`disambiguation` page property or a
  `*Disambiguation*` category)
- there is no `Appearance` / `Physical Appearance` section
- there is no `Powers and Abilities` section
- a section has no paragraph or list text, or `api.php` returns an error

```bash
# One character (full URL)
python3 -m roster propose \
  --n 1 \
  --source 'https://villains.fandom.com/wiki/Pinhead_(Hellraiser)' \
  --out /tmp/pinhead.json

# Bulk list of N (titles need --wiki)
python3 -m roster propose \
  --n 2 \
  --wiki villains.fandom.com \
  --source 'Pinhead (Hellraiser)' \
  --source 'Michael Myers (Halloween)' \
  --out /tmp/roster.json
```

`--sources-file` takes one URL or title per line (`#` comments allowed).

Field rules for proposed sheets:

- `label`: first lowercase word of the page title, parenthetical dropped
- `look`: first sentence of the Appearance section
- `brief`: first sentence of the Powers and Abilities section
- `injuries` / `status` / `icon`: always `""`. Icons are Spaces CDN URLs set
  separately.

Duplicate labels across the N proposed characters are an error.

Pass the output file straight into `import`:

```bash
ENS_LABEL=horrortube python3 -m roster import \
  --input /tmp/roster.json \
  --out /tmp/import-plan.json
```

Dead/injured restore behavior is owned by `import` (`--on-existing`); `propose`
does not silently restore names.

### import

```bash
ENS_LABEL=horrortube python3 -m roster import \
  --input roster/fixtures/sample-characters.json \
  --out /tmp/import-plan.json
```

- Validates JSON against the schemas and extra rules.
- Fails on duplicate `label` values inside the input file.
- Writes a normalized import plan JSON describing the intended ENS register/update
  action per character. Does not submit a transaction.

#### Existing dead / injured names

Chain reads are **not** implemented here. To exercise dead/injured handling, pass an
optional second file with the same character schema:

```bash
ENS_LABEL=horrortube python3 -m roster import \
  --input incoming.json \
  --existing already-known.json \
  --on-existing skip \
  --out /tmp/import-plan.json
```

If any label in `--input` appears in `--existing` with `status=dead` or a
non-empty `injuries` string:

- Missing `--on-existing` is an **error** (no silent default).
- `--on-existing=skip` omits that label from the plan and lists it under `skipped`.
- `--on-existing=restore` puts the character in the plan with `status` cleared to
  `""` and `injuries` taken from the **input file** as supplied (not invented).

If `--existing` is omitted, the script does not pretend to know chain state.

### remove

```bash
ENS_LABEL=horrortube python3 -m roster remove \
  --input labels.json \
  --out /tmp/remove-plan.json
```

`labels.json` must be a JSON array of label strings, for example:

```json
["fixture-one", "fixture-two"]
```

- Fails on duplicate labels in the list.
- Writes a removal plan that describes unregister of each
  `label.<ENS_LABEL>.eth`. Does not invent or send a transaction.

## Tests

```bash
python3 -m pip install -r roster/requirements.txt
PYTHONPATH=. python3 -m unittest discover -s tests -v
```
