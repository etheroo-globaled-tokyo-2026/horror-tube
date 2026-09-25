# Roster JSON import and removal plans

First slice of issue #4: validate character JSON and emit **plans**. This PR does
**not** scrape Fandom, does **not** read ENS on-chain state, and does **not**
send register/unregister transactions. Subname registry writes land in a later
PR when the contracts path is safe to call.

Parent name comes from `ENS_LABEL` (`label.eth`). Character subnames are
`label.<ENS_LABEL>.eth`. Missing or blank `ENS_LABEL` fails with an error that
names the variable.

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

## Commands

Install deps once:

```bash
python3 -m pip install -r roster/requirements.txt
```

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

Chain reads are **not** in this PR. To exercise dead/injured handling, pass an
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
