# Horror Tube roster import (dynamic ENS)

The runtime roster is not a hardcoded character list in the app. Characters are ENS
subnames under `horrortube.eth`. A label is in the roster when it is registered and
unexpired on the app's UserRegistry. Markdown under `docs/roster/` is import source
for a later register step only; it is not what battle selection reads at runtime.

## Pin

Sepolia ENSv2 beta, 15 September 2026 (`Deployed at: 2026-09-15T09:46:38.513Z` in the
pin's address table).

| Item                       | Value                                        |
| -------------------------- | -------------------------------------------- |
| contracts-v2 commit        | `71a3b7339dbc55ab47667abdfe8303bac4f4c24e`   |
| `UserRegistryImpl`         | `0xa80338aaa8d23831cea25e858d1774534abb0263` |
| `PermissionedResolverImpl` | `0x14f09fd05d4585759e54844dc9b00147131cf243` |

Source of truth for those addresses: `contracts/docs/addresses/sepolia.md` and
`contracts/deployments/sepolia/addresses.md` at that commit. The app deploys its own
`UserRegistry` proxy for `horrortube.eth` from `UserRegistryImpl`; character labels
live in that registry as `label.horrortube.eth`.

If any other doc in this repo or elsewhere disagrees with that pin's Solidity or
Sepolia address table, fail closed and follow the pin.

## What "in the roster" means

Per [Permissioned Registry — Name Lifecycle](https://docs.ens.domains/ensv2/permissioned-registry#name-lifecycle)
and `IPermissionedRegistry.Status` at the pin (`AVAILABLE`, `RESERVED`, `REGISTERED`):

- **In roster:** `getState(labelhash)` (or equivalent `anyId`) returns
  `status == REGISTERED`. That state is owner + token + unexpired (expired names
  are not `REGISTERED`; `ownerOf` / `getResolver` / `findOwner` treat expiry as
  gone).
- **Not selectable:** `status != REGISTERED` (never registered, reserved, expired,
  or unregistered), or the character card text record `status` equals `dead`.

Do not select a name whose resolver falls through to a parent wildcard. Read the
character's own resolver from the UserRegistry (`getResolver(label)`); if it is
zero or the card cannot be read from that resolver, fail closed.

## Register shape (import step)

Registration is `IStandardRegistry.register` on the character UserRegistry (pin:
`contracts/src/registry/interfaces/IStandardRegistry.sol`):

```text
register(label, owner, registry, resolver, roleBitmap, expiry) -> tokenId
```

Documented the same way in
[Permissioned Registry — Registration](https://docs.ens.domains/ensv2/permissioned-registry#registration)
and the contract-developer tutorial (`REGISTRY.register(label, owner, IRegistry(0), resolver, roleBitmap, expiry)`).

Import flow for each `docs/roster/<label>.md`:

1. Deploy a Permissioned Resolver proxy from `PermissionedResolverImpl` for that
   character (do not invent constructor args here; follow the pin's verifiable
   factory / resolver deploy helpers).
2. `register` the proposed ENS label under the `horrortube.eth` UserRegistry with
   the app as `owner`, that resolver, a `roleBitmap` that includes what the battle
   design requires at mint time (e.g. `ROLE_UNREGISTER` in the bitmap — see
   `docs/battle-royale.md`), and a far `expiry`.
3. Write card text on that resolver with `setText` (pin:
   `ITextSetter.setText(bytes name, string key, string value)` —
   DNS-encoded `name`). Keys: `brief`, `strength`, `intelligence`, `luck`, `role`,
   `injuries`, `status`. Initial import sets roster keys; leave `status` unset or
   non-`dead`, and `injuries` empty until battles.
4. Fine-grained text grants use `grantSetterRoles(setter, account)` on
   `IPermissionedResolver` at the pin — not `authorizeTextRoles`. Key-scoped
   `ROLE_SET_TEXT` is checked against `PermissionedResolverLib.resource(key)` on
   that resolver instance (see header comments on `PermissionedResolver.sol` at
   the pin).

## Enumerate registered labels (runtime roster)

There is no "list all labels" view on `IPermissionedRegistry` at the pin. Enumerate
from registry events on the `horrortube.eth` UserRegistry, then filter live state.

Authoritative event at the pin (`IRegistryEvents`):

```text
LabelRegistered(tokenId, labelHash, label, owner, expiry, sender)
```

Also track `LabelUnregistered`, `ExpiryUpdated`, `ResolverUpdated`, and
`TokenRegenerated` so the index stays correct. Official indexing write-up:
[Indexing ENSv2](https://docs.ens.domains/ensv2/indexing) (`LabelRegistered` on
PermissionedRegistry / UserRegistry).

**Pin inconsistency:** `doc/indexing-ensv2-events.md` at commit `71a3b733` names
the same lifecycle events `NameRegistered` / `NameUnregistered`. That disagrees
with `IRegistryEvents.sol` and with docs.ens.domains. Fail closed: use
`LabelRegistered` / `LabelUnregistered` from the Solidity interface.

After indexing candidate labels:

1. `getState(uint256(keccak256(bytes(label))))` — keep only `REGISTERED`.
2. `getResolver(label)` — must be non-zero; use that address for records.
3. Resolve ENSIP-5 text for keys `brief`, `strength`, `intelligence`, `luck`,
   `role`, `injuries`, `status` on that resolver (pin resolver header lists
   ENSIP-5 `text(key)`; writes go through `setText`). Prefer resolving against
   the character resolver directly; do not invent an ABI beyond what the pin
   exposes.
4. Drop any name where `status == dead`.
5. Optional label recovery: shared `LabelStore.getLabel(anyId)` at the pin can
   invert a stored labelhash to a string when the index has an id but lost the
   string; it is not a full roster enumerator by itself.

`findOwner(label)`, `findExpiry(label)`, and `findTokenId(label)` are label-string
helpers on the registry at the pin for spot checks.

## Selectable vs dead

| Condition                                                           | Selectable for battle? |
| ------------------------------------------------------------------- | ---------------------- |
| Label `REGISTERED` and unexpired, resolver set, `status` not `dead` | Yes                    |
| Label expired / `AVAILABLE` / `RESERVED` / never registered         | No                     |
| Label unregistered (`LabelUnregistered`)                            | No                     |
| Text `status` = `dead` (name may still be registered)               | No                     |
| Resolver missing or card only via parent wildcard                   | No (fail closed)       |

Death does not require unregister for the demo: set text `status` = `dead` with a
narrow agent grant (`docs/battle-royale.md`). Unregister is optional hard removal
via `ROLE_UNREGISTER`.

## Import markdown vs chain

| Source                                 | Role                                                |
| -------------------------------------- | --------------------------------------------------- |
| `docs/roster/*.md`                     | Offline card drafts for the register/setText import |
| `docs/roster/README.md`                | Index of proposed labels and Fandom sources         |
| UserRegistry + per-character resolvers | Runtime roster and cards                            |

After import, change the live roster by registering, renewing, unregistering, or
updating text on chain — not by editing these markdown files alone.
