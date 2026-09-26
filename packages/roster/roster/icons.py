"""Generate 100x100 face icons with Together FLUX.1 and upload to Spaces."""

from __future__ import annotations

import base64
import json
import logging
import re
import time
import urllib.error
import urllib.request
from io import BytesIO
from pathlib import Path
from typing import Any, Callable, Mapping, Protocol, Sequence
from urllib.parse import urlparse

import boto3
from botocore.client import BaseClient, Config
from botocore.exceptions import BotoCoreError, ClientError
from botocore.session import Session as BotocoreSession
from PIL import Image, UnidentifiedImageError

logger = logging.getLogger("roster.icons")

GENERATE_PX = 1024
ICON_PX = 100
REQUEST_TIMEOUT_SECONDS = 180


class IconGenerationError(RuntimeError):
    """Raised when face-icon generation or Spaces upload cannot finish."""


class IconObjectStore(Protocol):
    """Bucket operations used by the icons command."""

    def object_exists(self, key: str) -> bool:
        """Return True when the object key is already on the bucket."""
        ...

    def put_public_png(self, key: str, body: bytes) -> None:
        """Upload PNG bytes with ACL public-read."""
        ...


def required_env(name: str, env: Mapping[str, str]) -> str:
    value = env.get(name)
    if value is None or value.strip() == "":
        raise IconGenerationError(
            f"{name} is required. Set it in .env. See .env.example. Refusing to fall back."
        )
    return value.strip()


def spaces_region_from_endpoint(endpoint: str) -> str:
    parsed = urlparse(endpoint)
    host = parsed.hostname
    if host is None or host.strip() == "":
        raise IconGenerationError(
            f"SPACES_ENDPOINT must include a host. Got: {endpoint!r}"
        )
    region = host.split(".", 1)[0].strip()
    if region == "":
        raise IconGenerationError(
            f"SPACES_ENDPOINT host has no Spaces region prefix. Got: {host!r}"
        )
    return region


def canonical_icon_key(label: str) -> str:
    return f"{label}.png"


def override_icon_key(label: str, unix_seconds: int) -> str:
    if unix_seconds < 0:
        raise IconGenerationError(
            f"override unix_seconds must be >= 0. Got: {unix_seconds}"
        )
    return f"{label}-{unix_seconds}.png"


def icon_object_key(label: str, *, override: bool, unix_seconds: int) -> str:
    if override:
        return override_icon_key(label, unix_seconds)
    return canonical_icon_key(label)


def icon_cdn_url(cdn_host: str, object_key: str) -> str:
    host = cdn_host.strip()
    if host.startswith("https://"):
        host = host[len("https://") :]
    elif host.startswith("http://"):
        raise IconGenerationError(
            "SPACES_CDN_HOST must be a hostname (optionally with https://). "
            f"Got http:// URL: {cdn_host!r}"
        )
    host = host.strip().rstrip("/")
    if host == "":
        raise IconGenerationError(
            "SPACES_CDN_HOST is blank after normalization. Refusing to build an icon URL."
        )
    key = object_key.strip().lstrip("/")
    if key == "":
        raise IconGenerationError(
            "icon object key is blank. Refusing to build an icon URL."
        )
    return f"https://{host}/{key}"


def should_skip_generation(*, object_exists: bool, override: bool) -> bool:
    """Skip Together + upload when the canonical object exists and override is off."""
    return object_exists and not override


def image_request_body(look: str, model: str) -> dict[str, object]:
    return image_request_body_from_prompt(face_prompt(look), model)


def image_request_body_from_prompt(prompt: str, model: str) -> dict[str, object]:
    text = prompt.strip()
    if text == "":
        raise IconGenerationError(
            "image_prompt is empty. Refusing to generate an icon without the saved prompt."
        )
    return {
        "model": model,
        "prompt": text,
        "width": GENERATE_PX,
        "height": GENERATE_PX,
        "response_format": "base64",
    }


_IMAGE_DROP = re.compile(
    r"\b(?:massacre|chainsaws?|chain saw|machetes?|kill(?:er|ing)?|murders?|blood|gore|wounds?|weapons?)\b",
    re.IGNORECASE,
)


def face_prompt(look: str) -> str:
    text = look.strip()
    if text == "":
        raise IconGenerationError(
            "look is empty. Refusing to generate a face icon without a character description."
        )
    visual = " ".join(_IMAGE_DROP.sub(" ", text).split())
    if visual == "":
        raise IconGenerationError(
            f"look has no portrait words left after removing violent terms. Got: {text!r}"
        )
    return (
        "Square character portrait icon, head and shoulders, centered, "
        "facing the camera, plain dark background, no text, no blood, "
        "no gore, no wounds, no weapons. "
        + visual
    )


def _required_cache_string(
    value: object,
    *,
    field: str,
    source: str,
) -> str:
    if not isinstance(value, str) or value.strip() == "":
        raise IconGenerationError(
            f"{source}: {field} must be a non-empty string. "
            f"Got {type(value).__name__}."
        )
    return value


def build_icon_prompt_cache(
    characters: Sequence[Mapping[str, str]],
    cast_entries: Sequence[Mapping[str, Any]],
) -> dict[str, object]:
    """Build deterministic text/prompt records from live proposed sheets."""
    if len(characters) != len(cast_entries):
        raise IconGenerationError(
            "Cannot cache cast prompts: proposed character count "
            f"{len(characters)} does not match cast source count {len(cast_entries)}."
        )
    cached: list[dict[str, object]] = []
    seen: set[str] = set()
    for index, (character, cast_entry) in enumerate(zip(characters, cast_entries)):
        source = f"cast entry {index + 1}"
        label = _required_cache_string(
            character.get("label"), field="label", source=source
        )
        if label in seen:
            raise IconGenerationError(
                f"Cannot cache duplicate cast label {label!r} from {source}."
            )
        seen.add(label)
        display_name = _required_cache_string(
            character.get("display_name"), field="display_name", source=source
        )
        look = _required_cache_string(
            character.get("look"), field="look", source=source
        )
        brief = _required_cache_string(
            character.get("brief"), field="brief", source=source
        )

        raw_source = cast_entry.get("source")
        if isinstance(raw_source, str) and raw_source.strip() != "":
            look_source = raw_source
            brief_source = raw_source
        else:
            look_source = _required_cache_string(
                cast_entry.get("look_source"),
                field="look_source",
                source=source,
            )
            brief_source = _required_cache_string(
                cast_entry.get("brief_source"),
                field="brief_source",
                source=source,
            )
        cached.append(
            {
                "label": label,
                "display_name": display_name,
                "look": look,
                "brief": brief,
                "image_prompt": face_prompt(look),
                "sources": {
                    "look": look_source,
                    "brief": brief_source,
                },
            }
        )
    if len(cached) == 0:
        raise IconGenerationError("Cannot write an empty icon prompt cache.")
    return {"version": 1, "characters": cached}


def load_icon_prompt_cache(path: Path) -> list[dict[str, object]]:
    """Load cache records without recomputing text or image prompts."""
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise IconGenerationError(f"Failed to read icon prompt cache {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise IconGenerationError(
            f"Icon prompt cache {path} is not valid JSON: {exc}"
        ) from exc
    if not isinstance(payload, dict) or payload.get("version") != 1:
        raise IconGenerationError(
            f"Icon prompt cache {path} must be an object with version 1."
        )
    raw_characters = payload.get("characters")
    if not isinstance(raw_characters, list) or len(raw_characters) == 0:
        raise IconGenerationError(
            f"Icon prompt cache {path} must contain a non-empty characters array."
        )
    characters: list[dict[str, object]] = []
    seen: set[str] = set()
    for index, raw in enumerate(raw_characters):
        source = f"{path}: characters[{index}]"
        if not isinstance(raw, dict):
            raise IconGenerationError(f"{source} must be an object.")
        record: dict[str, object] = {}
        for field in ("label", "display_name", "look", "brief", "image_prompt"):
            record[field] = _required_cache_string(
                raw.get(field), field=field, source=source
            )
        label = str(record["label"])
        if label in seen:
            raise IconGenerationError(f"{path}: duplicate cached label {label!r}.")
        seen.add(label)
        raw_sources = raw.get("sources")
        if not isinstance(raw_sources, dict):
            raise IconGenerationError(f"{source}: sources must be an object.")
        record["sources"] = {
            "look": _required_cache_string(
                raw_sources.get("look"), field="sources.look", source=source
            ),
            "brief": _required_cache_string(
                raw_sources.get("brief"), field="sources.brief", source=source
            ),
        }
        characters.append(record)
    return characters


def image_b64(payload: object) -> str:
    if not isinstance(payload, dict):
        raise IconGenerationError(
            "Together image response was not a JSON object. "
            f"Got {type(payload).__name__}."
        )
    data = payload.get("data")
    if not isinstance(data, list) or len(data) == 0:
        raise IconGenerationError(
            "Together image response has no data array. "
            f"Top-level keys: {sorted(payload.keys())}."
        )
    first = data[0]
    if not isinstance(first, dict):
        raise IconGenerationError(
            "Together image response data[0] was not an object. "
            f"Got {type(first).__name__}."
        )
    encoded = first.get("b64_json")
    if not isinstance(encoded, str) or encoded.strip() == "":
        raise IconGenerationError(
            "Together image response data[0] has no b64_json string. "
            f"data[0] keys: {sorted(first.keys())}."
        )
    return encoded


def decode_image(encoded: str) -> bytes:
    try:
        return base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise IconGenerationError(
            f"Together b64_json was not valid base64: {exc}"
        ) from exc


def png_icon(image_bytes: bytes, *, size: int = ICON_PX) -> bytes:
    try:
        image = Image.open(BytesIO(image_bytes))
        image.load()
    except UnidentifiedImageError as exc:
        raise IconGenerationError(
            f"Together returned bytes that are not an image: {exc}"
        ) from exc
    if image.width != image.height:
        raise IconGenerationError(
            f"Together returned {image.width}x{image.height}. "
            "Face icons require a square image."
        )
    resized = image.convert("RGB").resize((size, size), Image.Resampling.LANCZOS)
    out = BytesIO()
    resized.save(out, format="PNG")
    return out.getvalue()


def _post_json(url: str, body: Mapping[str, object], api_key: str) -> object:
    raw_body = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=raw_body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            # Cloudflare Error 1010 bans Python-urllib's default User-Agent.
            "User-Agent": "horror-tube-roster/0.1 (+https://github.com/etheroo-globaled-tokyo-2026/horror-tube)",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            raw = response.read()
            status = response.status
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise IconGenerationError(
            f"Together image generation failed: HTTP {exc.code} {exc.reason} "
            f"from {url}. Body: {detail}"
        ) from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        reason = exc.reason if isinstance(exc, urllib.error.URLError) else exc
        raise IconGenerationError(
            f"Together image generation request failed for {url}: {reason}"
        ) from exc
    if status != 200:
        raise IconGenerationError(
            f"Together image generation returned HTTP {status} from {url}. "
            f"Body: {raw.decode('utf-8', errors='replace')}"
        )
    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise IconGenerationError(
            f"Together image response was not JSON: {exc}. "
            f"Body starts: {raw[:200]!r}"
        ) from exc


def generate_face_png(
    look: str,
    *,
    api_key: str,
    model: str,
    api_url: str,
) -> bytes:
    return generate_face_png_from_prompt(
        face_prompt(look),
        api_key=api_key,
        model=model,
        api_url=api_url,
    )


def generate_face_png_from_prompt(
    prompt: str,
    *,
    api_key: str,
    model: str,
    api_url: str,
) -> bytes:
    body = image_request_body_from_prompt(prompt, model)
    logger.info(
        "requesting face icon model=%s size=%sx%s url=%s",
        model,
        GENERATE_PX,
        GENERATE_PX,
        api_url,
    )
    logger.info("prompt=%s", body["prompt"])
    payload = _post_json(api_url, body, api_key)
    return png_icon(decode_image(image_b64(payload)))


class SpacesIconStore:
    """DigitalOcean Spaces (S3-compatible) store for character icon PNGs."""

    def __init__(
        self,
        *,
        client: BaseClient,
        bucket: str,
    ) -> None:
        self._client = client
        self.bucket = bucket

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> SpacesIconStore:
        access_key = required_env("SPACES_ACCESS_KEY_ID", env)
        secret = required_env("SPACES_SECRET", env)
        bucket = required_env("SPACES_BUCKET", env)
        endpoint = required_env("SPACES_ENDPOINT", env)
        region = spaces_region_from_endpoint(endpoint)
        # An ambient AWS_PROFILE / AWS_DEFAULT_PROFILE makes boto3.client() raise
        # ProfileNotFound even when explicit Spaces keys are passed.
        botocore_session = BotocoreSession(
            session_vars={"profile": (None, [], None, None)},
        )
        session = boto3.session.Session(botocore_session=botocore_session)
        client = session.client(
            "s3",
            region_name=region,
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret,
            config=Config(signature_version="s3v4"),
        )
        return cls(client=client, bucket=bucket)

    def object_exists(self, key: str) -> bool:
        try:
            self._client.head_object(Bucket=self.bucket, Key=key)
            return True
        except ClientError as exc:
            code = str(exc.response.get("Error", {}).get("Code", ""))
            http_status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            if code in ("404", "NoSuchKey", "NotFound") or http_status == 404:
                return False
            raise IconGenerationError(
                f"Spaces head_object failed for s3://{self.bucket}/{key}: "
                f"Code={code!r} HTTPStatusCode={http_status!r} {exc}"
            ) from exc
        except BotoCoreError as exc:
            raise IconGenerationError(
                f"Spaces head_object request failed for s3://{self.bucket}/{key}: {exc}"
            ) from exc

    def put_public_png(self, key: str, body: bytes) -> None:
        try:
            self._client.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=body,
                ACL="public-read",
                ContentType="image/png",
            )
        except (ClientError, BotoCoreError) as exc:
            raise IconGenerationError(
                f"Spaces put_object failed for s3://{self.bucket}/{key}: {exc}"
            ) from exc


def spaces_store_from_env(env: Mapping[str, str]) -> SpacesIconStore:
    return SpacesIconStore.from_env(env)


def should_skip_chain_icon(*, icon: str, override: bool) -> bool:
    """Skip when chain already has a non-empty https icon and override is off."""
    text = icon.strip()
    if text == "":
        return False
    if not text.startswith("https://"):
        raise IconGenerationError(
            f"on-chain icon must be empty or an https URL. Got: {icon!r}"
        )
    return not override


class IconChainWriter(Protocol):
    """Writes only the ENS icon text record."""

    def set_icons(
        self, updates: Sequence[Mapping[str, str]]
    ) -> list[dict[str, str]]:
        """setText icon for each update; return label/icon/txHash rows."""
        ...


class FacePngGenerator(Protocol):
    def __call__(self, look: str) -> bytes:
        """Return a 100x100 PNG for the given look description."""
        ...


def sync_chain_icons(
    characters: Sequence[Mapping[str, str]],
    *,
    generate_png: FacePngGenerator,
    spaces: IconObjectStore,
    cdn_host: str,
    chain: IconChainWriter,
    override: bool,
    clock: Callable[[], int] | None = None,
) -> list[dict[str, str]]:
    """
    For each registered character with an empty on-chain icon, generate from look,
    upload to Spaces, and setText only the icon key to the https CDN URL.
    """
    now = clock if clock is not None else (lambda: int(time.time()))
    results: list[dict[str, str]] = []

    for character in characters:
        label = character["label"]
        look = character.get("look", "")
        if not isinstance(look, str):
            raise IconGenerationError(
                f"{label}: look must be a string. Got {type(look).__name__}."
            )
        icon = character.get("icon", "")
        if not isinstance(icon, str):
            raise IconGenerationError(
                f"{label}: icon must be a string. Got {type(icon).__name__}."
            )

        try:
            if should_skip_chain_icon(icon=icon, override=override):
                logger.info(
                    "skipping %s; on-chain icon already set to %s",
                    label,
                    icon.strip(),
                )
                results.append(
                    {
                        "label": label,
                        "action": "skipped",
                        "icon": icon.strip(),
                        "txHash": "",
                    }
                )
                continue
        except IconGenerationError as exc:
            raise IconGenerationError(
                f"Face icon for {label} failed. "
                f"Processed {len(results)} character(s) before this failure. {exc}"
            ) from exc

        if look.strip() == "":
            raise IconGenerationError(
                f"{label}: look is empty on chain. "
                "Refusing to generate a face icon without a character description. "
                f"Processed {len(results)} character(s) before this failure."
            )

        canonical_key = canonical_icon_key(label)
        try:
            exists = spaces.object_exists(canonical_key)
        except IconGenerationError as exc:
            raise IconGenerationError(
                f"Face icon for {label} failed while checking Spaces. "
                f"Processed {len(results)} character(s) before this failure. {exc}"
            ) from exc

        if exists and override:
            object_key = override_icon_key(label, now())
        else:
            object_key = canonical_key

        # When the object already exists and we are not overriding Spaces, reuse
        # the canonical CDN URL without calling Together again — but still setText
        # when the chain icon was empty (or --override requires a new chain write).
        reuse_existing = exists and not override
        try:
            if reuse_existing:
                url = icon_cdn_url(cdn_host, canonical_key)
                logger.info(
                    "reusing existing Spaces object for %s at %s; "
                    "setting on-chain icon only",
                    label,
                    url,
                )
            else:
                png = generate_png(look)
                spaces.put_public_png(object_key, png)
                url = icon_cdn_url(cdn_host, object_key)
                logger.info("uploaded %s -> %s", label, url)
            if not url.startswith("https://"):
                raise IconGenerationError(
                    f"{label}: refusing non-https icon URL: {url!r}"
                )
            written = chain.set_icons([{"label": label, "icon": url}])
        except IconGenerationError as exc:
            raise IconGenerationError(
                f"Face icon for {label} failed. "
                f"Processed {len(results)} character(s) before this failure. {exc}"
            ) from exc
        except Exception as exc:
            raise IconGenerationError(
                f"Face icon for {label} failed. "
                f"Processed {len(results)} character(s) before this failure. {exc}"
            ) from exc

        if len(written) != 1:
            raise IconGenerationError(
                f"{label}: set_icons returned {len(written)} result(s); expected 1."
            )
        tx_hash = written[0]["txHash"]
        results.append(
            {
                "label": label,
                "action": "uploaded" if not reuse_existing else "set",
                "icon": url,
                "txHash": tx_hash,
            }
        )
        logger.info(
            "set-icon label=%s icon=%s txHash=%s",
            label,
            url,
            tx_hash,
        )

    return results


def write_face_icons(
    characters: Sequence[Mapping[str, str]],
    out_dir: Path,
    *,
    api_key: str,
    model: str,
    api_url: str,
    spaces: IconObjectStore,
    cdn_host: str,
    override: bool,
    clock: Callable[[], int] | None = None,
    image_prompts: Mapping[str, str] | None = None,
) -> tuple[list[Path], list[dict[str, str]]]:
    """Generate and/or upload face icons; return written paths and updated sheets."""
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    updated: list[dict[str, str]] = []
    now = clock if clock is not None else (lambda: int(time.time()))

    for character in characters:
        label = character["label"]
        sheet: dict[str, str] = dict(character)
        canonical_key = canonical_icon_key(label)
        canonical_url = icon_cdn_url(cdn_host, canonical_key)

        try:
            exists = spaces.object_exists(canonical_key)
        except IconGenerationError as exc:
            raise IconGenerationError(
                f"Face icon for {label} failed while checking Spaces. "
                f"Processed {len(updated)} character(s) before this failure. {exc}"
            ) from exc

        if should_skip_generation(object_exists=exists, override=override):
            logger.info(
                "skipping Together and upload for %s; already on Spaces at %s",
                label,
                canonical_url,
            )
            if sheet.get("icon", "").strip() == "":
                sheet["icon"] = canonical_url
            updated.append(sheet)
            continue

        # Missing object: first upload is always <label>.png (even with --override).
        # Existing object + --override: new key so the CDN does not keep the old file.
        if exists and override:
            object_key = override_icon_key(label, now())
        else:
            object_key = canonical_key

        try:
            if image_prompts is None:
                png = generate_face_png(
                    character["look"],
                    api_key=api_key,
                    model=model,
                    api_url=api_url,
                )
            else:
                if label not in image_prompts:
                    raise IconGenerationError(
                        f"{label}: no saved image_prompt exists in the icon prompt cache."
                    )
                png = generate_face_png_from_prompt(
                    image_prompts[label],
                    api_key=api_key,
                    model=model,
                    api_url=api_url,
                )
            spaces.put_public_png(object_key, png)
        except IconGenerationError as exc:
            raise IconGenerationError(
                f"Face icon for {label} failed. "
                f"Wrote {len(written)} icon(s) before this failure. {exc}"
            ) from exc

        path = out_dir / f"{label}.png"
        if path.exists():
            logger.info("replacing existing local icon %s", path)
        path.write_bytes(png)
        logger.info("wrote %s (%s bytes)", path, len(png))
        written.append(path)

        url = icon_cdn_url(cdn_host, object_key)
        sheet["icon"] = url
        logger.info("uploaded %s -> %s", label, url)
        updated.append(sheet)

    return written, updated


def write_cached_face_icons(
    cached_characters: Sequence[Mapping[str, object]],
    out_dir: Path,
    *,
    api_key: str,
    model: str,
    api_url: str,
    spaces: IconObjectStore,
    cdn_host: str,
    override: bool,
    clock: Callable[[], int] | None = None,
) -> tuple[list[Path], list[dict[str, object]]]:
    """Generate icons from exact cached prompts, without rebuilding from look."""
    characters: list[dict[str, str]] = []
    prompts: dict[str, str] = {}
    originals: dict[str, dict[str, object]] = {}
    for index, raw in enumerate(cached_characters):
        source = f"cached character {index + 1}"
        label = _required_cache_string(raw.get("label"), field="label", source=source)
        if label in prompts:
            raise IconGenerationError(f"Duplicate cached label {label!r}.")
        prompts[label] = _required_cache_string(
            raw.get("image_prompt"), field="image_prompt", source=source
        )
        characters.append(
            {
                "label": label,
                "look": _required_cache_string(
                    raw.get("look"), field="look", source=source
                ),
                "icon": "",
            }
        )
        originals[label] = dict(raw)
    written, icon_rows = write_face_icons(
        characters,
        out_dir,
        api_key=api_key,
        model=model,
        api_url=api_url,
        spaces=spaces,
        cdn_host=cdn_host,
        override=override,
        clock=clock,
        image_prompts=prompts,
    )
    updated: list[dict[str, object]] = []
    for row in icon_rows:
        merged = originals[row["label"]]
        merged["icon"] = row["icon"]
        updated.append(merged)
    return written, updated
