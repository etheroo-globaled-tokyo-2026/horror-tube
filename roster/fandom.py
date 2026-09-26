"""Read Fandom character sections through the MediaWiki api.php parse endpoint."""

from __future__ import annotations

import html
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any, Optional, Sequence


USER_AGENT = "horror-tube-roster/0.1 (+https://github.com/etheroo-globaled-tokyo-2026/horror-tube)"
FETCH_TIMEOUT_SECONDS = 30

APPEARANCE_RE = re.compile(r"^(physical\s+)?appearance$", re.IGNORECASE)
POWERS_RE = re.compile(r"^powers\s+(and|&)\s+abilities$", re.IGNORECASE)


class FandomError(ValueError):
    """Raised when a Fandom page cannot be resolved, fetched, or parsed."""


@dataclass(frozen=True)
class PageRef:
    host: str
    title: str

    def __str__(self) -> str:
        return f"{self.host}: {self.title}"


@dataclass(frozen=True)
class PageLore:
    ref: PageRef
    title: str
    appearance: str
    powers: str


def _require_fandom_host(host: str, *, context: str) -> str:
    host = host.strip().lower()
    if not host.endswith(".fandom.com") or "/" in host:
        raise FandomError(f"{context}: host must be a *.fandom.com wiki. Got: {host!r}")
    return host


def resolve_page(source: str, *, wiki: Optional[str]) -> PageRef:
    raw = source.strip()
    if raw == "":
        raise FandomError("Source URL or page title must not be blank.")
    if raw.lower().startswith(("https://", "http://")):
        parsed = urllib.parse.urlparse(raw)
        if not parsed.path.startswith("/wiki/") or parsed.path == "/wiki/":
            raise FandomError(f"{raw}: expected a Fandom URL of the form https://<wiki>.fandom.com/wiki/<Title>.")
        host = _require_fandom_host(parsed.netloc, context=raw)
        title = urllib.parse.unquote(parsed.path[len("/wiki/"):]).replace("_", " ")
        return PageRef(host=host, title=title)
    if wiki is None or wiki.strip() == "":
        raise FandomError(f"Page title {raw!r} requires --wiki (e.g. villains.fandom.com).")
    return PageRef(host=_require_fandom_host(wiki, context="--wiki"), title=raw)


def fetch_api(host: str, params: dict[str, str]) -> dict[str, Any]:
    query = urllib.parse.urlencode({**params, "format": "json", "formatversion": "2"})
    url = f"https://{host}/api.php?{query}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT}, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT_SECONDS) as response:
            body = response.read()
    except urllib.error.HTTPError as exc:
        raise FandomError(f"HTTP {exc.code} for {url}: {exc.reason}") from exc
    except urllib.error.URLError as exc:
        raise FandomError(f"Failed to fetch {url}: {exc.reason}") from exc
    except TimeoutError as exc:
        raise FandomError(f"Timed out fetching {url}") from exc
    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        raise FandomError(f"{url}: response is not JSON: {exc}") from exc
    if "error" in data:
        error = data["error"]
        raise FandomError(f"{url}: api.php error {error.get('code')}: {error.get('info')}")
    return data


def _plain(text: str) -> str:
    return " ".join(html.unescape(re.sub(r"<[^>]+>", "", text)).split())


_SKIP_TAGS = frozenset({"script", "style", "noscript", "sup", "table", "figure", "aside"})
_VOID_TAGS = frozenset({"br", "img", "hr", "wbr", "input", "meta", "link", "source"})
_BLOCK_TAGS = frozenset({"p", "li"})


class _BlockText(HTMLParser):
    """Collect text of each outermost <p> or <li> block in a section fragment."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[str] = []
        self._skip_depth = 0
        self._block_depth = 0
        self._buf: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        if tag in _VOID_TAGS:
            return
        if self._skip_depth > 0 or tag in _SKIP_TAGS:
            self._skip_depth += 1
            return
        if tag in _BLOCK_TAGS:
            self._block_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in _VOID_TAGS:
            return
        if self._skip_depth > 0:
            self._skip_depth -= 1
            return
        if tag in _BLOCK_TAGS and self._block_depth > 0:
            self._block_depth -= 1
            if self._block_depth == 0:
                text = " ".join("".join(self._buf).split())
                if text:
                    self.blocks.append(text)
                self._buf = []

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0 and self._block_depth > 0:
            self._buf.append(data)


def is_disambiguation(parse: dict[str, Any]) -> bool:
    if "disambiguation" in parse.get("properties", {}):
        return True
    return any("disambiguation" in c["category"].lower() for c in parse.get("categories", []))


def _find_section(parse: dict[str, Any], pattern: re.Pattern[str], *, name: str, ref: PageRef) -> str:
    for section in parse["sections"]:
        if pattern.match(_plain(section["line"])):
            return section["index"]
    lines = ", ".join(_plain(s["line"]) for s in parse["sections"]) or "(none)"
    raise FandomError(f"{ref}: no {name} section. Sections: {lines}")


def _section_text(ref: PageRef, pageid: int, index: str, *, name: str) -> str:
    data = fetch_api(
        ref.host,
        {
            "action": "parse",
            "pageid": str(pageid),
            "prop": "text",
            "section": index,
            "disableeditsection": "1",
            "disablelimitreport": "1",
        },
    )
    parser = _BlockText()
    parser.feed(data["parse"]["text"])
    parser.close()
    if not parser.blocks:
        raise FandomError(f"{ref}: {name} section {index} has no paragraph or list text.")
    return parser.blocks[0]


def fetch_page_lore(ref: PageRef) -> PageLore:
    parse = fetch_api(
        ref.host,
        {
            "action": "parse",
            "page": ref.title,
            "prop": "sections|properties|categories",
            "redirects": "1",
        },
    )["parse"]
    if is_disambiguation(parse):
        raise FandomError(f"{ref}: {parse['title']!r} is a disambiguation page. Pass a specific character page.")
    appearance = _find_section(parse, APPEARANCE_RE, name="Appearance", ref=ref)
    powers = _find_section(parse, POWERS_RE, name="Powers and abilities", ref=ref)
    return PageLore(
        ref=ref,
        title=parse["title"],
        appearance=_section_text(ref, parse["pageid"], appearance, name="Appearance"),
        powers=_section_text(ref, parse["pageid"], powers, name="Powers and abilities"),
    )


def require_source_count(sources: Sequence[str], *, n: int) -> list[str]:
    if n < 1:
        raise FandomError(f"--n must be >= 1. Got: {n}")
    cleaned = [s.strip() for s in sources]
    if any(s == "" for s in cleaned):
        raise FandomError("Source list contains a blank entry.")
    if len(cleaned) != n:
        raise FandomError(
            f"--n is {n} but {len(cleaned)} source(s) were provided. They must match exactly."
        )
    return cleaned
