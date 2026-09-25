"""Propose roster sheet fields from fetched Fandom page lore."""

from __future__ import annotations

import re
from typing import Any, Sequence

from roster.fandom import FandomError, PageLore
from roster.validate import (
    Character,
    CharacterList,
    RosterValidationError,
    find_duplicate_labels,
    normalize_character,
    parse_characters,
)


_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")
_NON_LABEL_RE = re.compile(r"[^a-z0-9]+")
_LEADING_ARTICLES = frozenset({"a", "an", "the"})


def label_from_title(title: str) -> str:
    cleaned = title.strip().lower()
    if cleaned == "":
        raise FandomError("Cannot build label from an empty title.")
    # Drop parenthetical disambiguators: "Jason (character)" -> "Jason"
    cleaned = re.sub(r"\([^)]*\)", " ", cleaned)
    cleaned = _NON_LABEL_RE.sub(" ", cleaned)
    parts = [p for p in cleaned.split() if p]
    if not parts:
        raise FandomError(f"Cannot build a lowercase label from title {title!r}.")
    if parts[0] in _LEADING_ARTICLES and len(parts) > 1:
        word = parts[1]
    else:
        word = parts[0]
    if word == "" or not re.fullmatch(r"[a-z0-9]+", word):
        raise FandomError(f"Cannot build a one-word lowercase label from title {title!r}.")
    return word


def _sentences_from_paragraphs(paragraphs: Sequence[str]) -> list[str]:
    sentences: list[str] = []
    for paragraph in paragraphs:
        text = paragraph.strip()
        if text == "":
            continue
        chunks = _SENTENCE_RE.split(text)
        for chunk in chunks:
            sentence = chunk.strip()
            if sentence == "":
                continue
            if sentence[-1] not in ".!?":
                sentence = sentence + "."
            if len(sentence) >= 12:
                sentences.append(sentence)
    return sentences


def sheet_from_lore(lore: PageLore) -> Character:
    """Map page lore into the roster character schema. Does not invent text."""
    sentences = _sentences_from_paragraphs(lore.paragraphs)
    if len(sentences) < 2:
        raise FandomError(
            f"{lore.url}: need at least two sentences of lore text to write look and brief. "
            f"Found {len(sentences)} usable sentence(s)."
        )
    look = sentences[0]
    brief = sentences[1]
    label = label_from_title(lore.title)
    icon = lore.image_https_url if lore.image_https_url.startswith("https://") else ""
    character: dict[str, Any] = {
        "label": label,
        "look": look,
        "brief": brief,
        "injuries": "",
        "status": "",
        "icon": icon,
    }
    # Reuse schema + rule checks so propose output is import-ready.
    parsed = parse_characters(character, source=lore.url)
    return parsed[0]


def propose_sheets(lores: Sequence[PageLore]) -> CharacterList:
    characters = [sheet_from_lore(lore) for lore in lores]
    dupes = find_duplicate_labels(characters)
    if dupes:
        raise RosterValidationError(
            f"duplicate label(s) in proposed roster: {', '.join(dupes)}"
        )
    return [normalize_character(c) for c in characters]


def sheets_payload(characters: CharacterList) -> Any:
    """Single object when one character; array for bulk N."""
    if len(characters) == 0:
        raise RosterValidationError("Cannot write an empty proposed roster.")
    if len(characters) == 1:
        return characters[0]
    return characters
