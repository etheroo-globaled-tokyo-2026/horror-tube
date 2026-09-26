"""Propose roster sheets from Fandom Appearance and Powers and abilities sections."""

from __future__ import annotations

import re
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


def sheet_from_lore(lore: PageLore) -> Character:
    """Map page sections into the roster character schema. Does not invent text."""
    character: dict[str, Any] = {
        "label": label_from_title(lore.title),
        "look": first_sentence(lore.appearance),
        "brief": first_sentence(lore.powers),
        "injuries": "",
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
