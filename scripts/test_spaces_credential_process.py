#!/usr/bin/env python3
"""Tests for scripts/spaces-credential-process. Uses fake keys only."""

import contextlib
import importlib.machinery
import importlib.util
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "spaces-credential-process"


def load_module():
    loader = importlib.machinery.SourceFileLoader("spaces_credential_process", str(SCRIPT))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    if spec is None:
        raise RuntimeError(f"cannot load {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


class SpacesCredentialProcessTest(unittest.TestCase):
    def setUp(self):
        self.mod = load_module()

    def test_reads_spaces_keys(self):
        text = "\n".join(
            [
                "# 1password: op://Private/ETHTokyo DigitalOcean/spaces_access_key_id",
                "SPACES_ACCESS_KEY_ID=AKIATEST",
                "# 1password: op://Private/ETHTokyo DigitalOcean/spaces_secret",
                "SPACES_SECRET=secret-test",
                "PRIVATE_KEY=not-used",
            ]
        )
        payload = self.mod.credentials_from_env_text(
            text, Path(".env"), Path(".env.example")
        )
        self.assertEqual(
            payload,
            {
                "Version": 1,
                "AccessKeyId": "AKIATEST",
                "SecretAccessKey": "secret-test",
            },
        )

    def test_strips_quotes(self):
        text = 'SPACES_ACCESS_KEY_ID="AKIATEST"\nSPACES_SECRET=\'secret-test\'\n'
        payload = self.mod.credentials_from_env_text(
            text, Path(".env"), Path(".env.example")
        )
        self.assertEqual(payload["AccessKeyId"], "AKIATEST")
        self.assertEqual(payload["SecretAccessKey"], "secret-test")

    def test_missing_env_file_names_example(self):
        with tempfile.TemporaryDirectory() as tmp:
            env_path = Path(tmp) / ".env"
            example_path = Path(tmp) / ".env.example"
            buf = io.StringIO()
            with contextlib.redirect_stderr(buf):
                with self.assertRaises(SystemExit) as raised:
                    self.mod.load_credentials(env_path, example_path)
            self.assertEqual(raised.exception.code, 1)
            message = buf.getvalue()
            self.assertIn(str(example_path), message)
            self.assertIn("op read", message)
            self.assertIn(".env", message)

    def test_blank_key_names_the_variable_and_example(self):
        with tempfile.TemporaryDirectory() as tmp:
            env_path = Path(tmp) / ".env"
            example_path = Path(tmp) / ".env.example"
            env_path.write_text("SPACES_ACCESS_KEY_ID=AKIATEST\nSPACES_SECRET=\n")
            buf = io.StringIO()
            with contextlib.redirect_stderr(buf):
                with self.assertRaises(SystemExit) as raised:
                    self.mod.load_credentials(env_path, example_path)
            self.assertEqual(raised.exception.code, 1)
            message = buf.getvalue()
            self.assertIn("SPACES_SECRET", message)
            self.assertIn(str(example_path), message)
            self.assertNotIn("AKIATEST", message)

    def test_cli_prints_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            scripts = root / "scripts"
            scripts.mkdir()
            script = scripts / "spaces-credential-process"
            script.write_text(SCRIPT.read_text())
            script.chmod(0o755)
            (root / ".env").write_text(
                "SPACES_ACCESS_KEY_ID=AKIATEST\nSPACES_SECRET=secret-test\n"
            )
            result = subprocess.run(
                [sys.executable, str(script)],
                capture_output=True,
                text=True,
                cwd=root,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(
                json.loads(result.stdout),
                {
                    "Version": 1,
                    "AccessKeyId": "AKIATEST",
                    "SecretAccessKey": "secret-test",
                },
            )


if __name__ == "__main__":
    unittest.main()
