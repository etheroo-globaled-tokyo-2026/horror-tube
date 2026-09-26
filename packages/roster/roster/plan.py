"""Build normalized import and removal plans (no on-chain writes)."""

from __future__ import annotations

from typing import Any, Mapping, Optional, Sequence

from roster.validate import (
    Character,
    CharacterList,
    RosterValidationError,
    is_dead_or_injured,
    normalize_character,
)


ON_EXISTING_SKIP = "skip"
ON_EXISTING_RESTORE = "restore"
ON_EXISTING_VALUES = frozenset({ON_EXISTING_SKIP, ON_EXISTING_RESTORE})


def subname(label: str, ens_label: str) -> str:
    return f"{label}.{ens_label}.eth"


def describe_ens_action(label: str, ens_label: str, *, kind: str) -> str:
    name = subname(label, ens_label)
    if kind == "import":
        return (
            f"Intended ENS action for {name}: register (or update text on) the subname "
            f"under parent {ens_label}.eth. Text keys: look, brief, injuries, status, icon. "
            "Plan only; does not send the transaction. Use `python -m roster register` to send."
        )
    if kind == "remove":
        return (
            f"Intended ENS action for {name}: unregister that label under parent "
            f"{ens_label}.eth. Plan only; does not send the transaction. "
            "Use `python -m roster remove` to send."
        )
    if kind == "register":
        return (
            f"ENS chain action for {name}: register (if needed) and setText "
            f"(look, brief, injuries, status, icon) under parent {ens_label}.eth."
        )
    raise RosterValidationError(f"Unknown ENS action kind: {kind!r}")


def build_import_plan(
    characters: CharacterList,
    *,
    ens_label: str,
    existing: Optional[Mapping[str, Character]] = None,
    on_existing: Optional[str] = None,
) -> dict[str, Any]:
    existing = existing or {}
    if on_existing is not None and on_existing not in ON_EXISTING_VALUES:
        raise RosterValidationError(
            f"--on-existing must be {ON_EXISTING_SKIP!r} or {ON_EXISTING_RESTORE!r}. "
            f"Got: {on_existing!r}"
        )

    conflicts: list[str] = []
    for character in characters:
        label = character["label"]
        prior = existing.get(label)
        if prior is not None and is_dead_or_injured(prior):
            conflicts.append(label)

    if conflicts and on_existing is None:
        raise RosterValidationError(
            "Input includes label(s) that already exist as dead or injured: "
            f"{', '.join(conflicts)}. Pass --on-existing={ON_EXISTING_SKIP} or "
            f"--on-existing={ON_EXISTING_RESTORE}."
        )

    planned: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []

    for character in characters:
        label = character["label"]
        prior = existing.get(label)
        if prior is not None and is_dead_or_injured(prior):
            if on_existing == ON_EXISTING_SKIP:
                skipped.append(
                    {
                        "label": label,
                        "name": subname(label, ens_label),
                        "reason": "existing dead or injured; --on-existing=skip",
                    }
                )
                continue
            sheet = normalize_character(character)
            sheet["status"] = ""
            entry = {
                **sheet,
                "name": subname(label, ens_label),
                "action": "restore_and_update",
                "ens_action": describe_ens_action(label, ens_label, kind="import"),
                "note": (
                    "status cleared to empty because --on-existing=restore; "
                    "injuries taken from the import file as supplied"
                ),
            }
            planned.append(entry)
            continue

        sheet = normalize_character(character)
        entry = {
            **sheet,
            "name": subname(label, ens_label),
            "action": "register_or_update",
            "ens_action": describe_ens_action(label, ens_label, kind="import"),
        }
        planned.append(entry)

    return {
        "plan": "import",
        "parent": f"{ens_label}.eth",
        "ens_label": ens_label,
        "chain_writes": False,
        "chain_reads": False,
        "note": (
            "Normalized import plan only. On-chain register/update is not executed. "
            "Use `python -m roster register` to read chain state and send transactions."
        ),
        "characters": planned,
        "skipped": skipped,
    }


def build_register_plan(
    characters: CharacterList,
    *,
    ens_label: str,
    existing_on_chain: Mapping[str, Character],
    on_existing: Optional[str] = None,
) -> dict[str, Any]:
    """Plan chain register/update from a chain snapshot of already-registered labels."""
    if on_existing is not None and on_existing not in ON_EXISTING_VALUES:
        raise RosterValidationError(
            f"--on-existing must be {ON_EXISTING_SKIP!r} or {ON_EXISTING_RESTORE!r}. "
            f"Got: {on_existing!r}"
        )

    conflicts = [
        character["label"]
        for character in characters
        if character["label"] in existing_on_chain
    ]
    if conflicts and on_existing is None:
        deadish = [
            label
            for label in conflicts
            if is_dead_or_injured(existing_on_chain[label])
        ]
        if deadish:
            raise RosterValidationError(
                "Input includes label(s) already registered on chain as dead or injured: "
                f"{', '.join(deadish)}. Pass --on-existing={ON_EXISTING_SKIP} or "
                f"--on-existing={ON_EXISTING_RESTORE}. Chain text records are the source."
            )
        raise RosterValidationError(
            "Input includes label(s) already registered on chain: "
            f"{', '.join(conflicts)}. Pass --on-existing={ON_EXISTING_SKIP} or "
            f"--on-existing={ON_EXISTING_RESTORE}."
        )

    planned: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []

    for character in characters:
        label = character["label"]
        prior = existing_on_chain.get(label)
        if prior is not None:
            if on_existing == ON_EXISTING_SKIP:
                skipped.append(
                    {
                        "label": label,
                        "name": subname(label, ens_label),
                        "reason": "already registered on chain; --on-existing=skip",
                    }
                )
                continue
            sheet = normalize_character(character)
            sheet["status"] = ""
            entry = {
                **sheet,
                "name": subname(label, ens_label),
                "action": "restore_and_update",
                "ens_action": describe_ens_action(label, ens_label, kind="register"),
                "note": (
                    "status cleared to empty because --on-existing=restore; "
                    "injuries taken from the input file as supplied"
                ),
            }
            planned.append(entry)
            continue

        sheet = normalize_character(character)
        entry = {
            **sheet,
            "name": subname(label, ens_label),
            "action": "register",
            "ens_action": describe_ens_action(label, ens_label, kind="register"),
        }
        planned.append(entry)

    return {
        "plan": "register",
        "parent": f"{ens_label}.eth",
        "ens_label": ens_label,
        "chain_writes": True,
        "chain_reads": True,
        "note": (
            "Register plan from chain snapshot. `python -m roster register` sends "
            "UserRegistry.register and PermissionedResolver.setText."
        ),
        "characters": planned,
        "skipped": skipped,
    }


def build_removal_plan(labels: Sequence[str], *, ens_label: str) -> dict[str, Any]:
    entries = []
    for label in labels:
        entries.append(
            {
                "label": label,
                "name": subname(label, ens_label),
                "action": "unregister",
                "ens_action": describe_ens_action(label, ens_label, kind="remove"),
            }
        )
    return {
        "plan": "remove",
        "parent": f"{ens_label}.eth",
        "ens_label": ens_label,
        "chain_writes": False,
        "chain_reads": False,
        "note": (
            "Normalized removal plan only. Unregister is not executed. "
            "Use `python -m roster remove` to send UserRegistry.unregister."
        ),
        "labels": entries,
    }
