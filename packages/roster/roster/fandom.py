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

LOOK_SECTION_RES = (
    re.compile(r"^(physical\s+)?appearance$", re.IGNORECASE),
    re.compile(r"^character description$", re.IGNORECASE),
    re.compile(r"^appearance and character concept$", re.IGNORECASE),
)
BRIEF_SECTION_RES = (
    re.compile(r"^powers\s+(and|&)\s+abilities$", re.IGNORECASE),
    re.compile(r"^abilities and attributes$", re.IGNORECASE),
    re.compile(r"^abilities$", re.IGNORECASE),
)


class FandomError(ValueError):
    """Raised when a Fandom page cannot be resolved, fetched, or parsed."""


@dataclass(frozen=True)
class PageRef:
    host: str
    title: str

    def __str__(self) -> str:
        return f"{self.host}: {self.title}"

    def url(self) -> str:
        return f"https://{self.host}/wiki/{urllib.parse.quote(self.title.replace(' ', '_'), safe='()/')}"


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
        # api.php adds a table of contents to a single-section render when that
        # section has enough subheadings; its <li> items are headings, not prose.
        is_toc = "toc" in (dict(attrs).get("class") or "").split()
        if self._skip_depth > 0 or tag in _SKIP_TAGS or is_toc:
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


def _find_section(
    parse: dict[str, Any],
    patterns: Sequence[re.Pattern[str]],
    *,
    name: str,
    ref: PageRef,
) -> str:
    plain_sections = [(_plain(section["line"]), section) for section in parse["sections"]]
    for pattern in patterns:
        for line, section in plain_sections:
            if pattern.fullmatch(line):
                index = section.get("index")
                if index:
                    return str(index)
                anchor = section.get("anchor")
                if anchor:
                    return f"anchor:{anchor}"
                raise FandomError(
                    f"{ref}: matched {name} section {line!r}, but api.php returned "
                    "neither a section index nor anchor."
                )
    lines = ", ".join(line for line, _ in plain_sections) or "(none)"
    raise FandomError(
        f"{ref}: no {name} section. Sections: {lines}. "
        f"List headings with: python -m roster sections --source '{ref.url()}'"
    )


def _section_text(ref: PageRef, pageid: int, index: str, *, name: str) -> str:
    params = {
        "action": "parse",
        "pageid": str(pageid),
        "prop": "text",
        "disableeditsection": "1",
        "disablelimitreport": "1",
    }
    if index.startswith("anchor:"):
        anchor = index.removeprefix("anchor:")
        data = fetch_api(ref.host, params)
        page_html = data["parse"]["text"]
        escaped_anchor = re.escape(anchor)
        start = re.search(
            rf'<h(?P<level>[1-6])\b[^>]*>(?:(?!</?h[1-6]\b).)*?'
            rf'\bid=(?P<quote>["\']){escaped_anchor}(?P=quote)'
            rf'(?:(?!</?h[1-6]\b).)*?</h(?P=level)\s*>',
            page_html,
            flags=re.IGNORECASE | re.DOTALL,
        )
        if start is None:
            raise FandomError(
                f"{ref}: {name} section anchor {anchor!r} was listed by api.php "
                "but was not found in the rendered page."
            )
        level = int(start.group("level"))
        rest = page_html[start.end() :]
        # Stop at the next heading of this level or higher. An h3 inside an h2
        # section is still part of that section.
        stop = re.search(rf"<h([1-{level}])\b", rest, flags=re.IGNORECASE)
        section_html = rest[: stop.start()] if stop is not None else rest
    else:
        data = fetch_api(ref.host, {**params, "section": index})
        section_html = data["parse"]["text"]
    parser = _BlockText()
    parser.feed(section_html)
    parser.close()
    if not parser.blocks:
        raise FandomError(f"{ref}: {name} section {index} has no paragraph or list text.")
    return parser.blocks[0]


def _parse_page(ref: PageRef) -> dict[str, Any]:
    return fetch_api(
        ref.host,
        {
            "action": "parse",
            "page": ref.title,
            "prop": "sections|properties|categories",
            "redirects": "1",
        },
    )["parse"]


def _reject_disambiguation(ref: PageRef, parse: dict[str, Any]) -> None:
    if is_disambiguation(parse):
        raise FandomError(
            f"{ref}: {parse['title']!r} is a disambiguation page. "
            "Pass a specific character page to --source, "
            "or to --look-source / --brief-source."
        )


def page_section_index(ref: PageRef) -> dict[str, Any]:
    """Section headings from api.php. Does not read section bodies."""
    parse = _parse_page(ref)
    return {
        "title": parse["title"],
        "pageid": parse["pageid"],
        "disambiguation": is_disambiguation(parse),
        "sections": [
            {
                "index": str(
                    section.get("index")
                    or (
                        f"anchor:{section['anchor']}"
                        if section.get("anchor")
                        else ""
                    )
                ),
                "line": _plain(section["line"]),
            }
            for section in parse["sections"]
        ],
    }


def fetch_section(
    ref: PageRef,
    patterns: Sequence[re.Pattern[str]],
    *,
    name: str,
) -> tuple[str, str]:
    """Return the page title and the first paragraph of the first matching section."""
    parse = _parse_page(ref)
    _reject_disambiguation(ref, parse)
    index = _find_section(parse, patterns, name=name, ref=ref)
    return parse["title"], _section_text(ref, parse["pageid"], index, name=name)


def fetch_page_lore(ref: PageRef) -> PageLore:
    parse = _parse_page(ref)
    _reject_disambiguation(ref, parse)
    appearance = _find_section(parse, LOOK_SECTION_RES, name="look", ref=ref)
    powers = _find_section(parse, BRIEF_SECTION_RES, name="brief", ref=ref)
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
