"""Tests for roster JSON validation and plan generation."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from roster import __main__ as cli
from roster.plan import build_import_plan, build_removal_plan
from roster.validate import (
    RosterValidationError,
    load_characters,
    parse_characters,
    require_no_duplicate_labels,
    require_no_duplicate_strings,
)

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "roster" / "fixtures" / "sample-characters.json"


def _char(**overrides):
    base = {
        "label": "alpha",
        "look": "A figure in a coat.",
        "brief": "Walks forward without stopping.",
        "injuries": "",
        "status": "",
        "icon": "",
    }
    base.update(overrides)
    return base


class SchemaTests(unittest.TestCase):
    def test_fixture_loads(self):
        characters = load_characters(FIXTURE)
        self.assertEqual(len(characters), 2)
        self.assertEqual(characters[0]["label"], "fixture-one")
        self.assertEqual(characters[1]["icon"].startswith("https://"), True)

    def test_missing_injuries_key_fails(self):
        data = _char()
        del data["injuries"]
        with self.assertRaises(RosterValidationError) as ctx:
            parse_characters(data, source="missing-injuries")
        self.assertIn("injuries", str(ctx.exception))

    def test_missing_status_key_fails(self):
        data = _char()
        del data["status"]
        with self.assertRaises(RosterValidationError) as ctx:
            parse_characters(data, source="missing-status")
        self.assertIn("status", str(ctx.exception))

    def test_empty_injuries_string_ok(self):
        characters = parse_characters(_char(injuries=""), source="ok")
        self.assertEqual(characters[0]["injuries"], "")

    def test_invalid_status_rejected(self):
        with self.assertRaises(RosterValidationError) as ctx:
            parse_characters(_char(status="wounded"), source="bad-status")
        self.assertIn("status", str(ctx.exception))

    def test_forbidden_keys_rejected(self):
        data = _char(strength="9")
        with self.assertRaises(RosterValidationError) as ctx:
            parse_characters(data, source="rpg")
        self.assertIn("strength", str(ctx.exception))

    def test_non_https_icon_rejected(self):
        with self.assertRaises(RosterValidationError) as ctx:
            parse_characters(_char(icon="http://example.test/x.png"), source="icon")
        self.assertIn("icon", str(ctx.exception))

    def test_duplicate_labels_in_file_fail(self):
        data = [_char(label="same"), _char(label="same", look="Other look.")]
        characters = parse_characters(data, source="dupes")
        with self.assertRaises(RosterValidationError) as ctx:
            require_no_duplicate_labels(characters, source="dupes")
        self.assertIn("duplicate", str(ctx.exception).lower())
        self.assertIn("same", str(ctx.exception))


class ImportPlanTests(unittest.TestCase):
    def test_missing_on_existing_fails_for_dead_or_injured(self):
        incoming = [_char(label="jason")]
        existing = {
            "jason": _char(label="jason", status="dead"),
        }
        with self.assertRaises(RosterValidationError) as ctx:
            build_import_plan(incoming, ens_label="horrortube", existing=existing)
        self.assertIn("--on-existing", str(ctx.exception))

    def test_missing_on_existing_fails_for_injured(self):
        incoming = [_char(label="jason", injuries="")]
        existing = {
            "jason": _char(label="jason", injuries="ripped left sleeve, slower swing"),
        }
        with self.assertRaises(RosterValidationError) as ctx:
            build_import_plan(incoming, ens_label="horrortube", existing=existing)
        self.assertIn("--on-existing", str(ctx.exception))

    def test_skip_omits_dead_label(self):
        incoming = [_char(label="jason"), _char(label="mike")]
        existing = {"jason": _char(label="jason", status="dead")}
        plan = build_import_plan(
            incoming,
            ens_label="horrortube",
            existing=existing,
            on_existing="skip",
        )
        labels = [c["label"] for c in plan["characters"]]
        self.assertEqual(labels, ["mike"])
        self.assertEqual(plan["skipped"][0]["label"], "jason")

    def test_restore_clears_status_keeps_file_injuries(self):
        incoming = [_char(label="jason", injuries="scar on cheek", status="dead")]
        existing = {"jason": _char(label="jason", status="dead", injuries="old wound")}
        plan = build_import_plan(
            incoming,
            ens_label="horrortube",
            existing=existing,
            on_existing="restore",
        )
        self.assertEqual(len(plan["characters"]), 1)
        entry = plan["characters"][0]
        self.assertEqual(entry["status"], "")
        self.assertEqual(entry["injuries"], "scar on cheek")
        self.assertEqual(entry["action"], "restore_and_update")
        self.assertIn("jason.horrortube.eth", entry["name"])


class RemovalPlanTests(unittest.TestCase):
    def test_duplicate_removal_labels_fail(self):
        with self.assertRaises(RosterValidationError) as ctx:
            require_no_duplicate_strings(["a", "b", "a"], source="rm")
        self.assertIn("duplicate", str(ctx.exception).lower())

    def test_removal_plan_describes_unregister(self):
        plan = build_removal_plan(["fixture-one"], ens_label="horrortube")
        self.assertEqual(plan["plan"], "remove")
        self.assertFalse(plan["chain_writes"])
        self.assertEqual(plan["labels"][0]["action"], "unregister")
        self.assertIn("unregister", plan["labels"][0]["ens_action"].lower())


class CliTests(unittest.TestCase):
    def test_import_cli_writes_plan(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "plan.json"
            with mock.patch.dict(os.environ, {"ENS_LABEL": "horrortube"}):
                code = cli.main(
                    [
                        "import",
                        "--input",
                        str(FIXTURE),
                        "--out",
                        str(out),
                    ]
                )
            self.assertEqual(code, 0)
            payload = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(payload["plan"], "import")
            self.assertEqual(len(payload["characters"]), 2)

    def test_import_cli_requires_on_existing(self):
        with tempfile.TemporaryDirectory() as tmp:
            incoming = Path(tmp) / "in.json"
            existing = Path(tmp) / "existing.json"
            out = Path(tmp) / "plan.json"
            incoming.write_text(json.dumps([_char(label="jason")]), encoding="utf-8")
            existing.write_text(
                json.dumps([_char(label="jason", status="dead")]), encoding="utf-8"
            )
            with mock.patch.dict(os.environ, {"ENS_LABEL": "horrortube"}):
                code = cli.main(
                    [
                        "import",
                        "--input",
                        str(incoming),
                        "--existing",
                        str(existing),
                        "--out",
                        str(out),
                    ]
                )
            self.assertEqual(code, 1)
            self.assertFalse(out.exists())

    def test_remove_cli_fails_on_dupes(self):
        with tempfile.TemporaryDirectory() as tmp:
            labels = Path(tmp) / "labels.json"
            out = Path(tmp) / "plan.json"
            labels.write_text(json.dumps(["a", "a"]), encoding="utf-8")
            with mock.patch.dict(os.environ, {"ENS_LABEL": "horrortube"}):
                code = cli.main(
                    ["remove", "--input", str(labels), "--out", str(out)]
                )
            self.assertEqual(code, 1)


if __name__ == "__main__":
    unittest.main()
