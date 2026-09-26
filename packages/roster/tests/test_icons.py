"""Tests for face-icon prompt, response parsing, resize, and HTTP failure."""

from __future__ import annotations

import base64
import json
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO, StringIO
from contextlib import redirect_stderr
from pathlib import Path

from PIL import Image

from roster import __main__ as cli
from roster.icons import (
    GENERATE_PX,
    ICON_PX,
    IconGenerationError,
    _post_json,
    decode_image,
    face_prompt,
    image_b64,
    image_request_body,
    png_icon,
    required_env,
    write_face_icons,
)


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
                "look": "Tall figure in a plain dark coat with a blank porcelain mask.",
                "brief": "Silent stalker who closes distance without speaking.",
                "injuries": "",
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
                                "look": "Tall figure in a plain dark coat.",
                            }
                        ],
                        Path(tmp),
                        api_key="not-a-real-key",
                        model="black-forest-labs/FLUX.1.1-pro",
                        api_url=url,
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
            for name in ("TOGETHER_API_KEY", "TOGETHER_IMAGE_MODEL", "TOGETHER_API_URL")
        }
        os.environ["TOGETHER_API_KEY"] = "not-a-real-key"
        os.environ["TOGETHER_IMAGE_MODEL"] = "black-forest-labs/FLUX.1.1-pro"
        os.environ["TOGETHER_API_URL"] = url
        stderr = StringIO()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                sheet = _sheet(Path(tmp))
                with redirect_stderr(stderr):
                    code = cli.main(
                        ["icons", "--input", str(sheet), "--out-dir", str(Path(tmp) / "out")]
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
