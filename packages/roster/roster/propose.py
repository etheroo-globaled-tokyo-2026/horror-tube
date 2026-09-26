"""Propose roster sheets from Fandom Appearance and Powers and abilities sections."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Sequence

from roster.fandom import FandomError, PageLore
from roster.validate import (
    Character,
    CharacterList,
    RosterValidationError,
    find_duplicate_labels,
    parse_characters,
)


_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")
_NON_LABEL_RE = re.compile(r"[^a-z0-9]+")
_LEADING_ARTICLES = frozenset({"a", "an", "the"})
_INJURY_PLACES_PATH = Path(__file__).resolve().parent / "injury_places.json"


def display_name_from_title(title: str) -> str:
    display_name = re.sub(r"\([^)]*\)", " ", title)
    display_name = " ".join(display_name.split())
    if display_name == "":
        raise FandomError(f"Cannot build display_name from title {title!r}.")
    return display_name


def label_from_title(title: str) -> str:
    # "Pinhead (Hellraiser)" -> "pinhead"
    cleaned = re.sub(r"\([^)]*\)", " ", title.strip().lower())
    parts = _NON_LABEL_RE.sub(" ", cleaned).split()
    if not parts:
        raise FandomError(f"Cannot build a lowercase label from title {title!r}.")
    if parts[0] in _LEADING_ARTICLES and len(parts) > 1:
        return parts[1]
    return parts[0]


def first_sentence(text: str) -> str:
    sentence = _SENTENCE_RE.split(text.strip(), maxsplit=1)[0].strip()
    if sentence and sentence[-1] not in ".!?":
        sentence += "."
    return sentence


def injury_places_json_for_label(label: str) -> str:
    """Places this label can be injured, from roster issues #11, #12, and #13."""
    try:
        catalog = json.loads(_INJURY_PLACES_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise FandomError(
            f"Failed to read injury places {_INJURY_PLACES_PATH}: {exc}"
        ) from exc
    if not isinstance(catalog, dict) or label not in catalog:
        raise FandomError(
            f"No injury_places for label {label!r}. "
            "Places come from roster issues #11, #12, and #13 "
            f"in {_INJURY_PLACES_PATH.name}. Refusing to invent them."
        )
    places = catalog[label]
    if not isinstance(places, list) or len(places) < 1:
        raise FandomError(
            f"injury_places for label {label!r} in {_INJURY_PLACES_PATH.name} "
            "must be a non-empty list."
        )
    return json.dumps(places, ensure_ascii=False)


def sheet_from_lore(lore: PageLore, *, injury_places: str | None = None) -> Character:
    """Map page sections into the roster character schema. Does not invent text."""
    label = label_from_title(lore.title)
    if injury_places is None:
        injury_places = injury_places_json_for_label(label)
    character: dict[str, Any] = {
        "label": label,
        "display_name": display_name_from_title(lore.title),
        "look": first_sentence(lore.appearance),
        "brief": first_sentence(lore.powers),
        "injury_places": injury_places,
        "injuries": "[]",
        "status": "alive",
        "icon": "",
    }
    return parse_characters(character, source=str(lore.ref))[0]


def propose_sheets(lores: Sequence[PageLore]) -> CharacterList:
    characters = [sheet_from_lore(lore) for lore in lores]
    dupes = find_duplicate_labels(characters)
    if dupes:
        raise RosterValidationError(f"duplicate label(s) in proposed roster: {', '.join(dupes)}")
    return characters


def sheets_payload(characters: CharacterList) -> Any:
    """Single object when one character; array for bulk N."""
    if len(characters) == 0:
        raise RosterValidationError("Cannot write an empty proposed roster.")
    if len(characters) == 1:
        return characters[0]
    return characters
