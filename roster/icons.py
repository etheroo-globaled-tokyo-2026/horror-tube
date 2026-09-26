"""Generate 100x100 face icons with Together FLUX.1."""

from __future__ import annotations

import base64
import json
import logging
import urllib.error
import urllib.request
from io import BytesIO
from pathlib import Path
from typing import Mapping, Sequence

from PIL import Image, UnidentifiedImageError

logger = logging.getLogger("roster.icons")

GENERATE_PX = 1024
ICON_PX = 100
REQUEST_TIMEOUT_SECONDS = 180


class IconGenerationError(RuntimeError):
    """Raised when face-icon generation cannot finish."""


def required_env(name: str, env: Mapping[str, str]) -> str:
    value = env.get(name)
    if value is None or value.strip() == "":
        raise IconGenerationError(
            f"{name} is required. Set it in .env. See .env.example. Refusing to fall back."
        )
    return value.strip()


def image_request_body(look: str, model: str) -> dict[str, object]:
    return {
        "model": model,
        "prompt": face_prompt(look),
        "width": GENERATE_PX,
        "height": GENERATE_PX,
        "response_format": "base64",
    }


def face_prompt(look: str) -> str:
    text = look.strip()
    if text == "":
        raise IconGenerationError(
            "look is empty. Refusing to generate a face icon without a character description."
        )
    return (
        "Square character portrait icon, head and shoulders, centered, "
        "facing the camera, plain dark background, no text. "
        + text
    )


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
    logger.info(
        "requesting face icon model=%s size=%sx%s url=%s",
        model,
        GENERATE_PX,
        GENERATE_PX,
        api_url,
    )
    logger.info("prompt=%s", face_prompt(look))
    payload = _post_json(api_url, image_request_body(look, model), api_key)
    return png_icon(decode_image(image_b64(payload)))


def write_face_icons(
    characters: Sequence[Mapping[str, str]],
    out_dir: Path,
    *,
    api_key: str,
    model: str,
    api_url: str,
) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for character in characters:
        label = character["label"]
        path = out_dir / f"{label}.png"
        if path.exists():
            logger.info("replacing existing icon %s", path)
        try:
            png = generate_face_png(
                character["look"],
                api_key=api_key,
                model=model,
                api_url=api_url,
            )
        except IconGenerationError as exc:
            raise IconGenerationError(
                f"Face icon for {label} failed. "
                f"Wrote {len(written)} icon(s) before this failure. {exc}"
            ) from exc
        path.write_bytes(png)
        logger.info("wrote %s (%s bytes)", path, len(png))
        written.append(path)
    return written
