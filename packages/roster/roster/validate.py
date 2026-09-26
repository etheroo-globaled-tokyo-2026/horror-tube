"""Load and validate roster character JSON against checked-in schemas."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Mapping, Sequence, Union

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from roster import FORBIDDEN_KEYS, STATUS_ALLOWED

SCHEMAS_DIR = Path(__file__).resolve().parent / "schemas"
CHARACTER_SCHEMA_PATH = SCHEMAS_DIR / "character.schema.json"
BULK_SCHEMA_PATH = SCHEMAS_DIR / "character-bulk.schema.json"

_LABEL_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_HTTPS_RE = re.compile(r"^https://", re.IGNORECASE)

Character = dict[str, Any]
CharacterList = list[Character]


class RosterValidationError(ValueError):
    """Raised when roster JSON fails schema or rule checks."""


def _load_json(path: Path) -> Any:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise RosterValidationError(f"Failed to read {path}: {exc}") from exc
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise RosterValidationError(
            f"Invalid JSON in {path}: {exc.msg} at line {exc.lineno} column {exc.colno}"
        ) from exc


def _registry() -> Registry:
    character = json.loads(CHARACTER_SCHEMA_PATH.read_text(encoding="utf-8"))
    bulk = json.loads(BULK_SCHEMA_PATH.read_text(encoding="utf-8"))
    return Registry().with_resources(
        [
            (
                "https://horror-tube.local/schemas/character.schema.json",
                Resource.from_contents(character),
            ),
            (
                "https://horror-tube.local/schemas/character-bulk.schema.json",
                Resource.from_contents(bulk),
            ),
        ]
    )


def _validate_against(schema_path: Path, instance: Any, *, what: str) -> None:
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    validator = Draft202012Validator(schema, registry=_registry())
    errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
    if not errors:
        return
    parts = []
    for err in errors:
        path = ".".join(str(p) for p in err.path) or "(root)"
        parts.append(f"{path}: {err.message}")
    raise RosterValidationError(
        f"{what} failed schema validation ({schema_path.name}):\n"
        + "\n".join(f"  - {p}" for p in parts)
    )


def _check_icon(icon: str, *, context: str) -> None:
    if icon == "":
        return
    if not _HTTPS_RE.match(icon):
        raise RosterValidationError(
            f"{context}: icon must be an https URL or \"\". Got: {icon!r}"
        )


def parse_string_list(
    value: Any, *, context: str, key: str, minimum: int
) -> list[str]:
    if not isinstance(value, str):
        raise RosterValidationError(f"{context}: {key} must be a string.")
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise RosterValidationError(
            f"{context}: {key} must be a JSON array of strings. Got: {value!r}"
        ) from exc
    if not isinstance(parsed, list):
        raise RosterValidationError(
            f"{context}: {key} must be a JSON array of strings. Got: {value!r}"
        )
    items: list[str] = []
    for index, item in enumerate(parsed):
        if not isinstance(item, str):
            raise RosterValidationError(
                f"{context}: {key}[{index}] must be a string. Got: {item!r}"
            )
        trimmed = item.strip()
        if trimmed == "":
            raise RosterValidationError(
                f"{context}: {key}[{index}] must not be empty or whitespace-only."
            )
        items.append(trimmed)
    if len(items) < minimum:
        raise RosterValidationError(
            f"{context}: {key} must contain at least {minimum} "
            f"{'entry' if minimum == 1 else 'entries'}. Got: {value!r}"
        )
    return items


def parse_injuries(value: Any, *, context: str) -> list[str]:
    return parse_string_list(value, context=context, key="injuries", minimum=0)


def parse_injury_places(value: Any, *, context: str) -> list[str]:
    return parse_string_list(value, context=context, key="injury_places", minimum=1)


def _check_character_rules(character: Mapping[str, Any], *, context: str) -> None:
    forbidden = FORBIDDEN_KEYS.intersection(character.keys())
    if forbidden:
        raise RosterValidationError(
            f"{context}: forbidden keys present: {', '.join(sorted(forbidden))}. "
            "Do not include strength, intelligence, luck, or role."
        )
    for key in (
        "label",
        "display_name",
        "look",
        "brief",
        "injury_places",
        "injuries",
        "status",
        "icon",
    ):
        if key not in character:
            raise RosterValidationError(
                f"{context}: missing required key {key!r}. "
                "Empty string is only valid when the key is present."
            )
    status = character["status"]
    if not isinstance(status, str) or status not in STATUS_ALLOWED:
        raise RosterValidationError(
            f"{context}: status must be one of {sorted(STATUS_ALLOWED)!r}. Got: {status!r}"
        )
    parse_injury_places(character["injury_places"], context=context)
    parse_injuries(character["injuries"], context=context)
    label = character["label"]
    if not isinstance(label, str) or not _LABEL_RE.fullmatch(label):
        raise RosterValidationError(
            f"{context}: label must be a single lowercase DNS label. Got: {label!r}"
        )
    display_name = character["display_name"]
    if not isinstance(display_name, str) or display_name.strip() == "":
        raise RosterValidationError(
            f"{context}: display_name must be a non-empty string."
        )
    if not isinstance(character["look"], str) or character["look"].strip() == "":
        raise RosterValidationError(f"{context}: look must be a non-empty string.")
    if not isinstance(character["brief"], str) or character["brief"].strip() == "":
        raise RosterValidationError(f"{context}: brief must be a non-empty string.")
    if not isinstance(character["icon"], str):
        raise RosterValidationError(f"{context}: icon must be a string.")
    _check_icon(character["icon"], context=context)


def normalize_character(character: Mapping[str, Any]) -> Character:
    context = f"character {character.get('label')!r}"
    injury_places = parse_injury_places(character["injury_places"], context=context)
    injuries = parse_injuries(character["injuries"], context=context)
    return {
        "label": character["label"],
        "display_name": character["display_name"].strip(),
        "look": character["look"],
        "brief": character["brief"],
        "injury_places": json.dumps(injury_places, ensure_ascii=False),
        "injuries": json.dumps(injuries, ensure_ascii=False),
        "status": character["status"],
        "icon": character["icon"],
    }


def parse_characters(data: Any, *, source: str) -> CharacterList:
    """Accept one character object or a non-empty array of characters."""
    if isinstance(data, dict):
        _validate_against(CHARACTER_SCHEMA_PATH, data, what=f"{source} (single character)")
        _check_character_rules(data, context=f"{source}")
        return [normalize_character(data)]
    if isinstance(data, list):
        _validate_against(BULK_SCHEMA_PATH, data, what=f"{source} (bulk list)")
        out: CharacterList = []
        for index, item in enumerate(data):
            if not isinstance(item, dict):
                raise RosterValidationError(
                    f"{source}[{index}]: expected object, got {type(item).__name__}"
                )
            _check_character_rules(item, context=f"{source}[{index}]")
            out.append(normalize_character(item))
        return out
    raise RosterValidationError(
        f"{source}: expected a character object or a non-empty array. Got {type(data).__name__}."
    )


def load_characters(path: Union[str, Path]) -> CharacterList:
    path = Path(path)
    data = _load_json(path)
    return parse_characters(data, source=str(path))


def find_duplicate_labels(characters: Sequence[Mapping[str, Any]]) -> list[str]:
    seen: set[str] = set()
    dupes: list[str] = []
    for character in characters:
        label = character["label"]
        if label in seen and label not in dupes:
            dupes.append(label)
        seen.add(label)
    return dupes


def require_no_duplicate_labels(characters: Sequence[Mapping[str, Any]], *, source: str) -> None:
    dupes = find_duplicate_labels(characters)
    if dupes:
        raise RosterValidationError(
            f"{source}: duplicate label(s) in file: {', '.join(dupes)}"
        )


def is_dead_or_injured(character: Mapping[str, Any]) -> bool:
    status = character.get("status")
    injuries = character.get("injuries")
    if status == "dead":
        return True
    label = character.get("label")
    return len(parse_injuries(injuries, context=f"character {label!r}")) > 0


def index_by_label(characters: Sequence[Mapping[str, Any]]) -> dict[str, Character]:
    out: dict[str, Character] = {}
    for character in characters:
        label = character["label"]
        if label in out:
            raise RosterValidationError(f"duplicate label while indexing: {label}")
        out[label] = normalize_character(character)
    return out


def load_existing_index(path: Union[str, Path]) -> dict[str, Character]:
    characters = load_characters(path)
    require_no_duplicate_labels(characters, source=str(path))
    return index_by_label(characters)


def parse_label_list(data: Any, *, source: str) -> list[str]:
    if not isinstance(data, list):
        raise RosterValidationError(
            f"{source}: removal input must be a JSON array of label strings. "
            f"Got {type(data).__name__}."
        )
    if len(data) == 0:
        raise RosterValidationError(f"{source}: removal label list must not be empty.")
    labels: list[str] = []
    for index, item in enumerate(data):
        if not isinstance(item, str) or item.strip() == "":
            raise RosterValidationError(
                f"{source}[{index}]: each entry must be a non-empty label string."
            )
        if not _LABEL_RE.fullmatch(item):
            raise RosterValidationError(
                f"{source}[{index}]: label must be a single lowercase DNS label. Got: {item!r}"
            )
        labels.append(item)
    return labels


def load_label_list(path: Union[str, Path]) -> list[str]:
    path = Path(path)
    data = _load_json(path)
    return parse_label_list(data, source=str(path))


def require_no_duplicate_strings(labels: Sequence[str], *, source: str) -> None:
    seen: set[str] = set()
    dupes: list[str] = []
    for label in labels:
        if label in seen and label not in dupes:
            dupes.append(label)
        seen.add(label)
    if dupes:
        raise RosterValidationError(
            f"{source}: duplicate label(s) in removal list: {', '.join(dupes)}"
        )
