"""Propose roster sheets from Fandom Appearance and Powers and abilities sections."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Sequence

from roster.fandom import (
    BRIEF_SECTION_RES,
    LOOK_SECTION_RES,
    FandomError,
    PageLore,
    PageRef,
    fetch_page_lore,
    fetch_section,
    resolve_page,
)
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
_CAST_PATH = Path(__file__).resolve().parent / "cast.json"


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


def sheet_from_page_pair(look_ref: PageRef, brief_ref: PageRef) -> Character:
    """One fighter: look from one page, brief from another. Both must share a label."""
    look_title, appearance = fetch_section(look_ref, LOOK_SECTION_RES, name="look")
    brief_title, powers = fetch_section(brief_ref, BRIEF_SECTION_RES, name="brief")
    look_label = label_from_title(look_title)
    brief_label = label_from_title(brief_title)
    if look_label != brief_label:
        raise FandomError(
            f"Look page {look_title!r} is label {look_label!r} but "
            f"brief page {brief_title!r} is label {brief_label!r}. "
            "Refusing to pair different characters."
        )
    return sheet_from_lore(
        PageLore(ref=look_ref, title=look_title, appearance=appearance, powers=powers)
    )


def propose_one(entry: dict[str, Any], *, wiki: str | None) -> Character:
    source = entry.get("source")
    look_source = entry.get("look_source")
    brief_source = entry.get("brief_source")
    if isinstance(source, str) and source.strip() != "":
        if look_source is not None or brief_source is not None:
            raise FandomError(
                f"Cast entry has source and also look_source/brief_source: {entry!r}"
            )
        return sheet_from_lore(fetch_page_lore(resolve_page(source, wiki=wiki)))
    if not isinstance(look_source, str) or look_source.strip() == "":
        raise FandomError(f"Cast entry needs source or look_source. Got: {entry!r}")
    if not isinstance(brief_source, str) or brief_source.strip() == "":
        raise FandomError(f"Cast entry needs brief_source with look_source. Got: {entry!r}")
    return sheet_from_page_pair(
        resolve_page(look_source, wiki=wiki),
        resolve_page(brief_source, wiki=wiki),
    )


def load_cast() -> list[dict[str, Any]]:
    try:
        raw = json.loads(_CAST_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise FandomError(f"Failed to read cast {_CAST_PATH}: {exc}") from exc
    if not isinstance(raw, list) or len(raw) != 12:
        raise FandomError(
            f"{_CAST_PATH.name} must be a list of 12 fighters. Got {type(raw).__name__} "
            f"length {len(raw) if isinstance(raw, list) else 'n/a'}."
        )
    return raw


def propose_cast() -> CharacterList:
    characters = [propose_one(entry, wiki=None) for entry in load_cast()]
    dupes = find_duplicate_labels(characters)
    if dupes:
        raise RosterValidationError(
            f"duplicate label(s) in cast: {', '.join(dupes)}"
        )
    return characters


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
