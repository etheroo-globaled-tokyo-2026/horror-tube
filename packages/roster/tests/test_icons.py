"""Tests for face-icon prompt, response parsing, resize, skip/URL, and HTTP failure."""

from __future__ import annotations

import base64
import json
import os
import tempfile
import threading
import unittest
from contextlib import redirect_stderr
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO, StringIO
from pathlib import Path
from unittest import mock

from typing import Mapping, Sequence

from PIL import Image

from roster import __main__ as cli
from roster.icons import (
    GENERATE_PX,
    ICON_PX,
    IconGenerationError,
    _post_json,
    canonical_icon_key,
    decode_image,
    face_prompt,
    icon_cdn_url,
    icon_object_key,
    image_b64,
    image_request_body,
    override_icon_key,
    png_icon,
    required_env,
    should_skip_chain_icon,
    should_skip_generation,
    spaces_region_from_endpoint,
    sync_chain_icons,
    write_face_icons,
)


class _MemorySpaces:
    def __init__(self, existing: set[str] | None = None) -> None:
        self.objects: dict[str, bytes] = {
            key: b"existing" for key in (existing or set())
        }

    def object_exists(self, key: str) -> bool:
        return key in self.objects

    def put_public_png(self, key: str, body: bytes) -> None:
        self.objects[key] = body


class _FakeChain:
    def __init__(self) -> None:
        self.calls: list[list[dict[str, str]]] = []

    def set_icons(self, updates: Sequence[Mapping[str, str]]) -> list[dict[str, str]]:
        rows = [{"label": u["label"], "icon": u["icon"], "txHash": f"0x{u['label']}"} for u in updates]
        self.calls.append([dict(u) for u in updates])
        return rows


class _RejectHandler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        self.rfile.read(length)
        body = b'{"error":{"message":"passthrough blocked"}}'
        self.send_response(403)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return


def _reject_server() -> tuple[ThreadingHTTPServer, str]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _RejectHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    return server, f"http://{host}:{port}/v1/images/generations"


def _sheet(directory: Path) -> Path:
    path = directory / "maskcoat.json"
    path.write_text(
        json.dumps(
            {
                "label": "maskcoat",
                "display_name": "Maskcoat",
                "look": "Tall figure in a plain dark coat with a blank porcelain mask.",
                "brief": "Silent stalker who closes distance without speaking.",
                "injuries": "[]",
                "status": "",
                "icon": "",
            }
        ),
        encoding="utf-8",
    )
    return path


class IconEnvTests(unittest.TestCase):
    def test_missing_key_names_the_variable(self):
        with self.assertRaises(IconGenerationError) as ctx:
            required_env("TOGETHER_API_KEY", {})
        self.assertIn("TOGETHER_API_KEY", str(ctx.exception))

    def test_blank_key_names_the_variable(self):
        with self.assertRaises(IconGenerationError) as ctx:
            required_env("TOGETHER_IMAGE_MODEL", {"TOGETHER_IMAGE_MODEL": "  "})
        self.assertIn("TOGETHER_IMAGE_MODEL", str(ctx.exception))


class IconPromptTests(unittest.TestCase):
    def test_prompt_includes_look(self):
        prompt = face_prompt("  Tall figure in a plain dark coat. ")
        self.assertIn("Tall figure in a plain dark coat.", prompt)

    def test_empty_look_fails(self):
        with self.assertRaises(IconGenerationError) as ctx:
            face_prompt("   ")
        self.assertIn("look", str(ctx.exception))


class IconUrlAndSkipTests(unittest.TestCase):
    def test_canonical_and_override_keys(self):
        self.assertEqual(canonical_icon_key("maskcoat"), "maskcoat.png")
        self.assertEqual(override_icon_key("maskcoat", 1700000000), "maskcoat-1700000000.png")
        self.assertEqual(
            icon_object_key("maskcoat", override=False, unix_seconds=1),
            "maskcoat.png",
        )
        self.assertEqual(
            icon_object_key("maskcoat", override=True, unix_seconds=1700000000),
            "maskcoat-1700000000.png",
        )

    def test_cdn_url_from_host(self):
        self.assertEqual(
            icon_cdn_url("cdn.example.test", "maskcoat.png"),
            "https://cdn.example.test/maskcoat.png",
        )
        self.assertEqual(
            icon_cdn_url("https://cdn.example.test/", "maskcoat.png"),
            "https://cdn.example.test/maskcoat.png",
        )

    def test_cdn_url_rejects_http_host(self):
        with self.assertRaises(IconGenerationError) as ctx:
            icon_cdn_url("http://cdn.example.test", "a.png")
        self.assertIn("http://", str(ctx.exception))

    def test_skip_when_exists_without_override(self):
        self.assertTrue(should_skip_generation(object_exists=True, override=False))
        self.assertFalse(should_skip_generation(object_exists=True, override=True))
        self.assertFalse(should_skip_generation(object_exists=False, override=False))
        self.assertFalse(should_skip_generation(object_exists=False, override=True))

    def test_region_from_endpoint(self):
        self.assertEqual(
            spaces_region_from_endpoint("https://sgp1.digitaloceanspaces.com"),
            "sgp1",
        )

    def test_skip_fills_empty_icon_without_together(self):
        spaces = _MemorySpaces(existing={"maskcoat.png"})
        with tempfile.TemporaryDirectory() as tmp:
            written, updated = write_face_icons(
                [
                    {
                        "label": "maskcoat",
                        "display_name": "Maskcoat",
                        "look": "Tall figure in a plain dark coat.",
                        "brief": "Silent stalker.",
                        "injuries": "[]",
                        "status": "alive",
                        "icon": "",
                    }
                ],
                Path(tmp),
                api_key="unused",
                model="unused",
                api_url="http://127.0.0.1:9/unused",
                spaces=spaces,
                cdn_host="cdn.example.test",
                override=False,
            )
        self.assertEqual(written, [])
        self.assertEqual(updated[0]["icon"], "https://cdn.example.test/maskcoat.png")
        self.assertEqual(spaces.objects["maskcoat.png"], b"existing")

    def test_override_uses_versioned_key(self):
        spaces = _MemorySpaces(existing={"maskcoat.png"})

        class _Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                length = int(self.headers.get("Content-Length", "0"))
                self.rfile.read(length)
                source = Image.new("RGB", (8, 8), (1, 2, 3))
                raw = BytesIO()
                source.save(raw, format="PNG")
                encoded = base64.b64encode(raw.getvalue()).decode("ascii")
                body = json.dumps({"data": [{"b64_json": encoded}]}).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, format: str, *args: object) -> None:
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        host, port = server.server_address
        url = f"http://{host}:{port}/v1/images/generations"
        try:
            with tempfile.TemporaryDirectory() as tmp:
                written, updated = write_face_icons(
                    [
                        {
                            "label": "maskcoat",
                            "display_name": "Maskcoat",
                            "look": "Tall figure in a plain dark coat.",
                            "brief": "Silent stalker.",
                            "injuries": "[]",
                            "status": "alive",
                            "icon": "",
                        }
                    ],
                    Path(tmp),
                    api_key="test-key",
                    model="test-model",
                    api_url=url,
                    spaces=spaces,
                    cdn_host="cdn.example.test",
                    override=True,
                    clock=lambda: 1700000000,
                )
                self.assertEqual(len(written), 1)
                self.assertTrue((Path(tmp) / "maskcoat.png").is_file())
        finally:
            server.shutdown()
            server.server_close()
        self.assertIn("maskcoat-1700000000.png", spaces.objects)
        self.assertEqual(spaces.objects["maskcoat.png"], b"existing")
        self.assertEqual(
            updated[0]["icon"],
            "https://cdn.example.test/maskcoat-1700000000.png",
        )


class IconResponseTests(unittest.TestCase):
    def test_reads_b64_json(self):
        self.assertEqual(image_b64({"data": [{"b64_json": "abc"}]}), "abc")

    def test_missing_b64_names_the_keys(self):
        with self.assertRaises(IconGenerationError) as ctx:
            image_b64({"data": [{"url": "https://example.test/a.png"}]})
        message = str(ctx.exception)
        self.assertIn("b64_json", message)
        self.assertIn("url", message)

    def test_invalid_base64_fails(self):
        with self.assertRaises(IconGenerationError) as ctx:
            decode_image("not base64 !!!")
        self.assertIn("base64", str(ctx.exception))


class IconResizeTests(unittest.TestCase):
    def test_square_image_becomes_100_png(self):
        source = Image.new("RGB", (32, 32), (10, 20, 30))
        raw = BytesIO()
        source.save(raw, format="PNG")
        png = png_icon(raw.getvalue())
        image = Image.open(BytesIO(png))
        self.assertEqual(image.size, (ICON_PX, ICON_PX))
        self.assertEqual(image.format, "PNG")

    def test_non_square_fails(self):
        source = Image.new("RGB", (32, 16), (1, 2, 3))
        raw = BytesIO()
        source.save(raw, format="PNG")
        with self.assertRaises(IconGenerationError) as ctx:
            png_icon(raw.getvalue())
        self.assertIn("32x16", str(ctx.exception))

    def test_request_body_is_square_base64(self):
        body = image_request_body("A figure in a coat.", "black-forest-labs/FLUX.1.1-pro")
        self.assertEqual(body["width"], GENERATE_PX)
        self.assertEqual(body["height"], GENERATE_PX)
        self.assertEqual(body["response_format"], "base64")
        self.assertEqual(body["model"], "black-forest-labs/FLUX.1.1-pro")
        self.assertIn("A figure in a coat.", str(body["prompt"]))

    def test_http_error_names_status_and_body(self):
        server, url = _reject_server()
        try:
            with self.assertRaises(IconGenerationError) as ctx:
                _post_json(url, {"model": "test"}, "not-a-real-key")
        finally:
            server.shutdown()
            server.server_close()
        message = str(ctx.exception)
        self.assertIn("403", message)
        self.assertIn("passthrough blocked", message)

    def test_failed_character_is_named(self):
        server, url = _reject_server()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                with self.assertRaises(IconGenerationError) as ctx:
                    write_face_icons(
                        [
                            {
                                "label": "maskcoat",
                                "display_name": "Maskcoat",
                                "look": "Tall figure in a plain dark coat.",
                                "brief": "Silent stalker.",
                                "injuries": "[]",
                                "status": "alive",
                                "icon": "",
                            }
                        ],
                        Path(tmp),
                        api_key="not-a-real-key",
                        model="black-forest-labs/FLUX.1.1-pro",
                        api_url=url,
                        spaces=_MemorySpaces(),
                        cdn_host="cdn.example.test",
                        override=False,
                    )
        finally:
            server.shutdown()
            server.server_close()
        message = str(ctx.exception)
        self.assertIn("maskcoat", message)
        self.assertIn("403", message)
        self.assertIn("Wrote 0", message)

    def test_cli_http_failure_exits_1(self):
        server, url = _reject_server()
        previous = {
            name: os.environ.get(name)
            for name in (
                "TOGETHER_API_KEY",
                "TOGETHER_IMAGE_MODEL",
                "TOGETHER_API_URL",
                "SPACES_CDN_HOST",
            )
        }
        os.environ["TOGETHER_API_KEY"] = "not-a-real-key"
        os.environ["TOGETHER_IMAGE_MODEL"] = "black-forest-labs/FLUX.1.1-pro"
        os.environ["TOGETHER_API_URL"] = url
        os.environ["SPACES_CDN_HOST"] = "cdn.example.test"
        stderr = StringIO()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                sheet = _sheet(Path(tmp))
                with mock.patch(
                    "roster.__main__.spaces_store_from_env",
                    return_value=_MemorySpaces(),
                ):
                    with redirect_stderr(stderr):
                        code = cli.main(
                            [
                                "icons",
                                "--input",
                                str(sheet),
                                "--out-dir",
                                str(Path(tmp) / "out"),
                                "--out",
                                str(Path(tmp) / "with-icon.json"),
                            ]
                        )
        finally:
            server.shutdown()
            server.server_close()
            for name, value in previous.items():
                if value is None:
                    os.environ.pop(name, None)
                else:
                    os.environ[name] = value
        self.assertEqual(code, 1)
        self.assertIn("maskcoat", stderr.getvalue())
        self.assertIn("403", stderr.getvalue())

    def test_cli_refuses_fixture_path(self):
        stderr = StringIO()
        with redirect_stderr(stderr):
            code = cli.main(
                [
                    "icons",
                    "--input",
                    "roster/fixtures/sample-characters.json",
                    "--out-dir",
                    "/tmp/horror-tube-icons-should-not-exist",
                    "--out",
                    "/tmp/horror-tube-icons-out-should-not-exist.json",
                ]
            )
        self.assertEqual(code, 1)
        self.assertIn("will not accept a fixture", stderr.getvalue())

    def test_roundtrip_decode(self):
        source = Image.new("RGB", (8, 8), (4, 5, 6))
        raw = BytesIO()
        source.save(raw, format="PNG")
        encoded = base64.b64encode(raw.getvalue()).decode("ascii")
        png = png_icon(decode_image(encoded))
        self.assertEqual(Image.open(BytesIO(png)).size, (ICON_PX, ICON_PX))


class IconChainSyncTests(unittest.TestCase):
    def test_skip_when_https_icon_present(self):
        self.assertTrue(
            should_skip_chain_icon(
                icon="https://cdn.example.test/art.png",
                override=False,
            )
        )
        self.assertFalse(
            should_skip_chain_icon(
                icon="https://cdn.example.test/art.png",
                override=True,
            )
        )
        self.assertFalse(should_skip_chain_icon(icon="", override=False))

    def test_non_https_on_chain_icon_fails(self):
        with self.assertRaises(IconGenerationError) as ctx:
            should_skip_chain_icon(icon="http://cdn.example.test/x.png", override=False)
        self.assertIn("https", str(ctx.exception))

    def test_sync_skips_existing_https_and_uploads_empty(self):
        spaces = _MemorySpaces()
        chain = _FakeChain()
        generated: list[str] = []

        def generate(look: str) -> bytes:
            generated.append(look)
            return b"png-bytes"

        results = sync_chain_icons(
            [
                {
                    "label": "art",
                    "display_name": "Art the Clown",
                    "look": "A smiling clown in white face paint.",
                    "brief": "brief",
                    "injuries": "[]",
                    "status": "alive",
                    "icon": "https://cdn.example.test/art.png",
                },
                {
                    "label": "pinhead",
                    "display_name": "Pinhead",
                    "look": "Bald pale face covered in pins.",
                    "brief": "brief",
                    "injuries": "[]",
                    "status": "alive",
                    "icon": "",
                },
            ],
            generate_png=generate,
            spaces=spaces,
            cdn_host="cdn.example.test",
            chain=chain,
            override=False,
        )
        self.assertEqual(results[0]["action"], "skipped")
        self.assertEqual(results[0]["txHash"], "")
        self.assertEqual(results[1]["action"], "uploaded")
        self.assertEqual(results[1]["icon"], "https://cdn.example.test/pinhead.png")
        self.assertEqual(results[1]["txHash"], "0xpinhead")
        self.assertEqual(generated, ["Bald pale face covered in pins."])
        self.assertEqual(spaces.objects["pinhead.png"], b"png-bytes")
        self.assertEqual(len(chain.calls), 1)
        self.assertEqual(chain.calls[0][0]["label"], "pinhead")

    def test_sync_reuses_spaces_object_when_chain_icon_empty(self):
        spaces = _MemorySpaces(existing={"chucky.png"})
        chain = _FakeChain()
        generated: list[str] = []

        def generate(look: str) -> bytes:
            generated.append(look)
            return b"new"

        results = sync_chain_icons(
            [
                {
                    "label": "chucky",
                    "display_name": "Chucky",
                    "look": "A scarred doll with orange hair.",
                    "brief": "brief",
                    "injuries": "[]",
                    "status": "alive",
                    "icon": "",
                }
            ],
            generate_png=generate,
            spaces=spaces,
            cdn_host="cdn.example.test",
            chain=chain,
            override=False,
        )
        self.assertEqual(results[0]["action"], "set")
        self.assertEqual(results[0]["icon"], "https://cdn.example.test/chucky.png")
        self.assertEqual(generated, [])
        self.assertEqual(spaces.objects["chucky.png"], b"existing")
        self.assertEqual(chain.calls[0][0]["icon"], "https://cdn.example.test/chucky.png")

    def test_empty_look_names_the_label(self):
        with self.assertRaises(IconGenerationError) as ctx:
            sync_chain_icons(
                [
                    {
                        "label": "michael",
                        "display_name": "Michael Myers",
                        "look": "   ",
                        "brief": "brief",
                        "injuries": "[]",
                        "status": "alive",
                        "icon": "",
                    }
                ],
                generate_png=lambda look: b"x",
                spaces=_MemorySpaces(),
                cdn_host="cdn.example.test",
                chain=_FakeChain(),
                override=False,
            )
        message = str(ctx.exception)
        self.assertIn("michael", message)
        self.assertIn("look", message)

    def test_one_failure_stops_and_names_label(self):
        spaces = _MemorySpaces()
        chain = _FakeChain()

        def generate(look: str) -> bytes:
            raise IconGenerationError("Together exploded")

        with self.assertRaises(IconGenerationError) as ctx:
            sync_chain_icons(
                [
                    {
                        "label": "candyman",
                        "display_name": "Candyman",
                        "look": "A man in a fur-lined coat with a hook.",
                        "brief": "brief",
                        "injuries": "[]",
                        "status": "alive",
                        "icon": "",
                    }
                ],
                generate_png=generate,
                spaces=spaces,
                cdn_host="cdn.example.test",
                chain=chain,
                override=False,
            )
        message = str(ctx.exception)
        self.assertIn("candyman", message)
        self.assertIn("Together exploded", message)
        self.assertEqual(chain.calls, [])

    def test_cli_icons_chain_missing_ens_env_names_variable(self):
        stderr = StringIO()
        with mock.patch("roster.__main__.load_dotenv"):
            with mock.patch.dict(os.environ, {"ENS_LABEL": ""}, clear=False):
                with redirect_stderr(stderr):
                    code = cli.main(["icons-chain"])
        self.assertEqual(code, 1)
        self.assertIn("ENS_LABEL", stderr.getvalue())
