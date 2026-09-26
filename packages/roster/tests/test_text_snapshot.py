"""Tests for ENS text snapshot load/reset (chain writer mocked)."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from argparse import Namespace
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
from unittest import mock

import roster.__main__ as cli
from roster.text_snapshot import (
    DEFAULT_ENS_TEXT_SNAPSHOT,
    characters_from_registered,
    load_text_snapshot,
    require_labels_registered,
    sheet_text_only,
)
from roster.validate import RosterValidationError


def _sheet(**overrides):
    base = {
        "label": "count",
        "display_name": "Count Dracula",
        "look": "A tall pale man in a cape.",
        "brief": (
            "He sleeps in a coffin, wants to bite necks and drink blood, "
            "and turns into a bat."
        ),
        "injury_places": '["neck", "heart"]',
        "injuries": "[]",
        "status": "alive",
        "icon": "https://cdn.example/count.png",
    }
    base.update(overrides)
    return base


class TextSnapshotUnitTests(unittest.TestCase):
    def test_sheet_text_only_drops_extra_keys(self):
        sheet = sheet_text_only({**_sheet(), "txHash": "0xabc", "rpc": "http://x"})
        self.assertNotIn("txHash", sheet)
        self.assertNotIn("rpc", sheet)
        self.assertEqual(sheet["label"], "count")

    def test_characters_from_registered_sorts_labels(self):
        sheets = characters_from_registered(
            {
                "wolf": _sheet(label="wolf", display_name="Wolf Man"),
                "count": _sheet(label="count"),
            }
        )
        self.assertEqual([s["label"] for s in sheets], ["count", "wolf"])

    def test_characters_from_registered_refuses_empty(self):
        with self.assertRaises(RosterValidationError) as ctx:
            characters_from_registered({})
        self.assertIn("empty", str(ctx.exception).lower())

    def test_load_missing_file_names_path(self):
        missing = Path("/tmp/does-not-exist-ens-text-snapshot.json")
        with self.assertRaises(RosterValidationError) as ctx:
            load_text_snapshot(missing)
        message = str(ctx.exception)
        self.assertIn(str(missing), message)
        self.assertIn("missing", message.lower())

    def test_load_blank_brief_names_file_label_field(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "snap.json"
            path.write_text(
                json.dumps([_sheet(brief="   ")]) + "\n", encoding="utf-8"
            )
            with self.assertRaises(RosterValidationError) as ctx:
                load_text_snapshot(path)
        message = str(ctx.exception)
        self.assertIn(str(path), message)
        self.assertIn("count", message)
        self.assertIn("brief", message)

    def test_require_unregistered_label_names_file_and_label(self):
        path = Path("/tmp/snap.json")
        with self.assertRaises(RosterValidationError) as ctx:
            require_labels_registered(
                [_sheet(label="missing-one")],
                path=path,
                registered_labels=["count", "wolf"],
            )
        message = str(ctx.exception)
        self.assertIn(str(path), message)
        self.assertIn("missing-one", message)
        self.assertIn("not registered", message)

    def test_default_snapshot_path_is_under_roster_package(self):
        self.assertEqual(DEFAULT_ENS_TEXT_SNAPSHOT.name, "ens-text-snapshot.json")
        self.assertEqual(DEFAULT_ENS_TEXT_SNAPSHOT.parent.name, "roster")


class SnapshotResetCliTests(unittest.TestCase):
    def test_snapshot_text_writes_sorted_sheets(self):
        registered = {
            "wolf": _sheet(label="wolf", display_name="Wolf Man"),
            "count": _sheet(label="count"),
        }
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "out.json"
            stdout = StringIO()
            with mock.patch.object(cli, "_require_chain_env"), mock.patch.object(
                cli, "list_registered", return_value=registered
            ):
                with redirect_stdout(stdout):
                    code = cli.cmd_snapshot_text(Namespace(out=str(out)))
            self.assertEqual(code, 0)
            payload = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual([row["label"] for row in payload], ["count", "wolf"])
        self.assertEqual(
            set(payload[0].keys()),
            {
                "label",
                "display_name",
                "look",
                "brief",
                "injury_places",
                "injuries",
                "status",
                "icon",
            },
        )
        self.assertNotIn("txHash", payload[0])
        self.assertIn("snapshot-text", stdout.getvalue())

    def test_reset_text_calls_apply_text_reset_when_registered(self):
        apply = mock.Mock()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "snap.json"
            path.write_text(json.dumps([_sheet()]) + "\n", encoding="utf-8")
            stdout = StringIO()
            with mock.patch.object(cli, "_require_chain_env"), mock.patch.object(
                cli, "list_registered_labels", return_value=["count", "wolf"]
            ), mock.patch.object(cli, "apply_text_reset", apply):
                with redirect_stdout(stdout):
                    code = cli.cmd_reset_text(Namespace(input=str(path)))
            self.assertEqual(code, 0)
            apply.assert_called_once()
            sheets = apply.call_args[0][0]
            self.assertEqual(sheets[0]["label"], "count")
            self.assertEqual(
                sheets[0]["brief"],
                "He sleeps in a coffin, wants to bite necks and drink blood, "
                "and turns into a bat.",
            )
        self.assertIn("reset-text", stdout.getvalue())

    def test_reset_text_does_not_call_writer_when_label_missing(self):
        apply = mock.Mock()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "snap.json"
            path.write_text(json.dumps([_sheet()]) + "\n", encoding="utf-8")
            with mock.patch.object(cli, "_require_chain_env"), mock.patch.object(
                cli, "list_registered_labels", return_value=["wolf"]
            ), mock.patch.object(cli, "apply_text_reset", apply):
                with self.assertRaises(RosterValidationError) as ctx:
                    cli.cmd_reset_text(Namespace(input=str(path)))
        self.assertIn("count", str(ctx.exception))
        apply.assert_not_called()

    def test_reset_text_missing_file_via_main(self):
        missing = "/tmp/ens-text-snapshot-does-not-exist.json"
        stderr = StringIO()
        with mock.patch.dict(
            os.environ,
            {
                "ENS_LABEL": "horrortube",
                "SEPOLIA_RPC_URL": "https://example.invalid",
                "PRIVATE_KEY": "0x" + ("11" * 32),
                "ROSTER_PRIVATE_KEY": "0x" + ("22" * 32),
                "AGENT_PRIVATE_KEY": "0x" + ("33" * 32),
            },
            clear=False,
        ), redirect_stderr(stderr):
            code = cli.main(["reset-text", "--input", missing])
        self.assertEqual(code, 1)
        self.assertIn(missing, stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
