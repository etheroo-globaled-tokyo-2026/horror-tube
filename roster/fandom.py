"""Fetch and parse Fandom character pages over HTTP."""

from __future__ import annotations

import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Optional, Sequence


USER_AGENT = "horror-tube-roster/0.1 (+https://github.com/etheroo-globaled-tokyo-2026/horror-tube)"
FETCH_TIMEOUT_SECONDS = 30


class FandomError(ValueError):
    """Raised when a Fandom page cannot be resolved, fetched, or parsed."""


@dataclass(frozen=True)
class PageLore:
    url: str
    title: str
    paragraphs: tuple[str, ...]
    image_https_url: str


_SKIP_TAGS = frozenset({"script", "style", "noscript", "nav", "footer", "header"})


class _FandomHTMLExtractor(HTMLParser):
    """Pull title, intro paragraphs, and the first https content image from HTML."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._in_title = False
        self._in_h1 = False
        self._in_p = False
        self._skip_depth = 0
        self._title_bits: list[str] = []
        self._h1_bits: list[str] = []
        self._p_bits: list[str] = []
        self._paragraphs: list[str] = []
        self._images: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        if self._skip_depth > 0:
            self._skip_depth += 1
            return
        attrs_map = {k: v for k, v in attrs}
        class_attr = attrs_map.get("class") or ""
        classes = set(class_attr.split())
        if tag in _SKIP_TAGS or "navbox" in classes or "reference" in classes:
            self._skip_depth = 1
            return
        if tag == "title":
            self._in_title = True
            return
        if tag == "h1":
            self._in_h1 = True
            self._h1_bits = []
            return
        if tag == "p":
            self._in_p = True
            self._p_bits = []
            return
        if tag == "img":
            src = attrs_map.get("src") or attrs_map.get("data-src") or ""
            if src.startswith("//"):
                src = "https:" + src
            if src.lower().startswith("https://"):
                self._images.append(src)

    def handle_endtag(self, tag: str) -> None:
        if self._skip_depth > 0:
            self._skip_depth -= 1
            return
        if tag == "title":
            self._in_title = False
            return
        if tag == "h1":
            self._in_h1 = False
            return
        if tag == "p" and self._in_p:
            self._in_p = False
            text = _normalize_ws("".join(self._p_bits))
            if text:
                self._paragraphs.append(text)
            self._p_bits = []
    def handle_data(self, data: str) -> None:
        if self._skip_depth > 0:
            return
        if self._in_title:
            self._title_bits.append(data)
            return
        if self._in_h1:
            self._h1_bits.append(data)
            return
        if self._in_p:
            self._p_bits.append(data)

    def result(self) -> tuple[str, list[str], list[str]]:
        h1 = _normalize_ws("".join(self._h1_bits))
        title_tag = _normalize_ws("".join(self._title_bits))
        title = h1 or _strip_wiki_suffix(title_tag)
        return title, self._paragraphs, self._images


_WS_RE = re.compile(r"\s+")
_WIKI_SUFFIX_RE = re.compile(r"\s*\|.*$")


def _normalize_ws(text: str) -> str:
    return _WS_RE.sub(" ", text).strip()


def _strip_wiki_suffix(title: str) -> str:
    return _WIKI_SUFFIX_RE.sub("", title).strip()


def resolve_source_url(source: str, *, wiki: Optional[str]) -> str:
    raw = source.strip()
    if raw == "":
        raise FandomError("Source URL or page title must not be blank.")
    lower = raw.lower()
    if lower.startswith("https://") or lower.startswith("http://"):
        return raw
    if wiki is None or wiki.strip() == "":
        raise FandomError(
            f"Page title {raw!r} requires --wiki (e.g. horror.fandom.com). "
            "Pass a full https URL instead if you do not want --wiki."
        )
    host = wiki.strip()
    if host.startswith("https://") or host.startswith("http://"):
        parsed = urllib.parse.urlparse(host)
        if parsed.netloc == "":
            raise FandomError(f"--wiki is not a usable host or origin: {wiki!r}")
        host = parsed.netloc
    if "/" in host:
        raise FandomError(
            f"--wiki must be a Fandom host like horror.fandom.com. Got: {wiki!r}"
        )
    title_path = urllib.parse.quote(raw.replace(" ", "_"), safe=":_()/")
    return f"https://{host}/wiki/{title_path}"


def fetch_html(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT_SECONDS) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            body = response.read()
    except urllib.error.HTTPError as exc:
        raise FandomError(f"HTTP {exc.code} for {url}: {exc.reason}") from exc
    except urllib.error.URLError as exc:
        raise FandomError(f"Failed to fetch {url}: {exc.reason}") from exc
    except TimeoutError as exc:
        raise FandomError(f"Timed out fetching {url}") from exc
    try:
        return body.decode(charset)
    except UnicodeDecodeError as exc:
        raise FandomError(f"Failed to decode HTML from {url}: {exc}") from exc


def parse_page_html(html: str, *, url: str) -> PageLore:
    if html.strip() == "":
        raise FandomError(f"{url}: page HTML is empty.")
    extractor = _FandomHTMLExtractor()
    extractor.feed(html)
    extractor.close()
    title, paragraphs, images = extractor.result()
    if title == "":
        raise FandomError(f"{url}: could not find a page title in the HTML.")
    usable = [p for p in paragraphs if len(p) >= 20]
    image = ""
    for candidate in images:
        lower = candidate.lower()
        if any(skip in lower for skip in ("/favicon", "data:image", "site-logo", "wordmark")):
            continue
        if lower.startswith("https://"):
            image = candidate
            break
    return PageLore(
        url=url,
        title=title,
        paragraphs=tuple(usable),
        image_https_url=image,
    )


def fetch_page_lore(source: str, *, wiki: Optional[str]) -> PageLore:
    url = resolve_source_url(source, wiki=wiki)
    try:
        html = fetch_html(url)
    except FandomError:
        raise
    except Exception as exc:
        raise FandomError(f"Failed to fetch {url}: {exc}") from exc
    return parse_page_html(html, url=url)


def require_source_count(sources: Sequence[str], *, n: int) -> list[str]:
    if n < 1:
        raise FandomError(f"--n must be >= 1. Got: {n}")
    cleaned = [s.strip() for s in sources]
    if any(s == "" for s in cleaned):
        raise FandomError("Source list contains a blank entry.")
    if len(cleaned) != n:
        raise FandomError(
            f"--n is {n} but {len(cleaned)} source(s) were provided. "
            "They must match exactly."
        )
    return cleaned
