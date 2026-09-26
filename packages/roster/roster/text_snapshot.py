"""Load and validate a checked-in ENS text-record snapshot for reset-text."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping, Sequence, Set

from roster import STATUS_ALLOWED
from roster.validate import (
    Character,
    CharacterList,
    RosterValidationError,
    normalize_character,
    parse_injuries,
    parse_injury_places,
)

# Checked-in chain text backup. Separate from icon-prompt-cache.json.
DEFAULT_ENS_TEXT_SNAPSHOT = Path(__file__).resolve().parent / "ens-text-snapshot.json"

SNAPSHOT_TEXT_KEYS = (
    "label",
    "display_name",
    "look",
    "brief",
    "injury_places",
    "injuries",
    "status",
    "icon",
)

# Keys that must be present and non-blank (after strip) for reset-text.
REQUIRED_NONEMPTY_KEYS = ("label", "display_name", "look", "brief")


def sheet_text_only(character: Mapping[str, Any]) -> Character:
    """Copy the eight text fields. Drop any extra keys from a chain read."""
    out: Character = {}
    for key in SNAPSHOT_TEXT_KEYS:
        if key not in character:
            raise RosterValidationError(
                f"snapshot sheet missing required key {key!r}."
            )
        value = character[key]
        if not isinstance(value, str):
            raise RosterValidationError(
                f"snapshot sheet field {key!r} must be a string. "
                f"Got {type(value).__name__}."
            )
        out[key] = value
    return out


def characters_from_registered(registered: Mapping[str, Character]) -> CharacterList:
    """Stable list of text-only sheets from a label -> Character map."""
    if len(registered) == 0:
        raise RosterValidationError(
            "No registered character subnames found on chain. "
            "Refusing to write an empty ENS text snapshot."
        )
    return [sheet_text_only(registered[label]) for label in sorted(registered.keys())]


def _blank_field_error(path: Path, label: str, field: str) -> RosterValidationError:
    return RosterValidationError(
        f"{path}: label {label!r} has blank required field {field!r}. "
        "Refusing to invent text or fall back to Fandom, fixtures, or "
        "icon-prompt-cache.json."
    )


def load_text_snapshot(path: Path) -> CharacterList:
    """Load snapshot JSON. Names path, label, and field on any blank required value."""
    if not path.is_file():
        raise RosterValidationError(
            f"{path}: ENS text snapshot file is missing. "
            "Run `python -m roster snapshot-text` against the live chain first."
        )
    try:
        raw: Any = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RosterValidationError(
            f"Failed to read ENS text snapshot {path}: {exc}"
        ) from exc
    if not isinstance(raw, list) or len(raw) == 0:
        raise RosterValidationError(
            f"{path}: ENS text snapshot must be a non-empty JSON array of "
            "character objects."
        )
    out: CharacterList = []
    seen: Set[str] = set()
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            raise RosterValidationError(
                f"{path}[{index}]: expected object, got {type(item).__name__}."
            )
        label_raw = item.get("label")
        label = label_raw if isinstance(label_raw, str) else f"index-{index}"
        for key in SNAPSHOT_TEXT_KEYS:
            if key not in item:
                raise RosterValidationError(
                    f"{path}: label {label!r} missing required field {key!r}."
                )
            if not isinstance(item[key], str):
                raise RosterValidationError(
                    f"{path}: label {label!r} field {key!r} must be a string. "
                    f"Got {type(item[key]).__name__}."
                )
        for key in REQUIRED_NONEMPTY_KEYS:
            if item[key].strip() == "":
                raise _blank_field_error(path, label, key)
        if label in seen:
            raise RosterValidationError(
                f"{path}: duplicate label {label!r}."
            )
        seen.add(label)
        status = item["status"]
        if status not in STATUS_ALLOWED:
            raise RosterValidationError(
                f"{path}: label {label!r} field 'status' must be one of "
                f"{sorted(STATUS_ALLOWED)!r}. Got: {status!r}."
            )
        try:
            parse_injury_places(
                item["injury_places"], context=f"{path} label {label!r}"
            )
        except RosterValidationError as exc:
            raise RosterValidationError(
                f"{path}: label {label!r} field 'injury_places' is invalid: {exc}"
            ) from exc
        try:
            parse_injuries(item["injuries"], context=f"{path} label {label!r}")
        except RosterValidationError as exc:
            raise RosterValidationError(
                f"{path}: label {label!r} field 'injuries' is invalid: {exc}"
            ) from exc
        icon = item["icon"]
        if icon != "" and not icon.startswith("https://"):
            raise RosterValidationError(
                f"{path}: label {label!r} field 'icon' must be \"\" or an "
                f"https URL. Got: {icon!r}."
            )
        out.append(normalize_character(sheet_text_only(item)))
    return out


def require_labels_registered(
    characters: Sequence[Character],
    *,
    path: Path,
    registered_labels: Sequence[str],
) -> None:
    """Stop when a snapshot label is not registered on chain."""
    registered = set(registered_labels)
    for character in characters:
        label = character["label"]
        if label not in registered:
            raise RosterValidationError(
                f"{path}: label {label!r} is not registered on chain under "
                "ENS_LABEL. Refusing to register, invent, or fall back."
            )
