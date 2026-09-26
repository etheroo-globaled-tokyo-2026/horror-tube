"""Tests for roster JSON validation, Fandom propose, and plan generation."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
import urllib.parse
from pathlib import Path
from unittest import mock

from roster import __main__ as cli
from roster.fandom import FandomError, fetch_page_lore, resolve_page
from roster.plan import build_import_plan, build_register_plan, build_removal_plan, subname

from roster.propose import propose_sheets, sheet_from_battle_pages, sheet_from_lore, sheets_payload
from roster.validate import (
    RosterValidationError,
    load_characters,
    parse_characters,
    require_no_duplicate_labels,
    require_no_duplicate_strings,
)

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "roster" / "fixtures" / "sample-characters.json"
# Real villains.fandom.com api.php responses keyed by "<host> <sorted query>".
FANDOM_API = json.loads(
    (ROOT / "roster" / "fixtures" / "fandom-api.json").read_text(encoding="utf-8")
)
WIKI = "villains.fandom.com"


def _recorded_api(host, params):
    key = f"{host} {urllib.parse.urlencode(sorted(params.items()))}"
    if key not in FANDOM_API:
        raise AssertionError(f"no recorded api.php response for {key}")
    return FANDOM_API[key]


def _lore(title):
    with mock.patch("roster.fandom.fetch_api", side_effect=_recorded_api):
        return fetch_page_lore(resolve_page(title, wiki=WIKI))


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

    def test_restore_sets_status_alive_keeps_file_injuries(self):
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
        self.assertEqual(entry["status"], "alive")
        self.assertEqual(entry["injuries"], "scar on cheek")
        self.assertEqual(entry["action"], "restore_and_update")
        self.assertIn("jason.horrortube.eth", entry["name"])


class RegisterPlanTests(unittest.TestCase):
    def test_ens_name_is_label_parent_eth(self):
        self.assertEqual(subname("pinhead", "horrortube"), "pinhead.horrortube.eth")

    def test_duplicate_labels_in_file_fail(self):
        data = [_char(label="same"), _char(label="same", look="Other look.")]
        characters = parse_characters(data, source="dupes")
        with self.assertRaises(RosterValidationError) as ctx:
            require_no_duplicate_labels(characters, source="dupes")
        self.assertIn("duplicate", str(ctx.exception).lower())
        self.assertIn("same", str(ctx.exception))

    def test_missing_on_existing_when_chain_says_dead(self):
        incoming = [_char(label="jason")]
        chain = {"jason": _char(label="jason", status="dead")}
        with self.assertRaises(RosterValidationError) as ctx:
            build_register_plan(
                incoming,
                ens_label="horrortube",
                existing_on_chain=chain,
            )
        message = str(ctx.exception)
        self.assertIn("--on-existing", message)
        self.assertIn("jason", message)
        self.assertIn("dead", message.lower())

    def test_missing_on_existing_when_already_registered(self):
        incoming = [_char(label="jason")]
        chain = {"jason": _char(label="jason", status="")}
        with self.assertRaises(RosterValidationError) as ctx:
            build_register_plan(
                incoming,
                ens_label="horrortube",
                existing_on_chain=chain,
            )
        self.assertIn("already registered", str(ctx.exception).lower())
        self.assertIn("jason", str(ctx.exception))

    def test_register_plan_names_subname(self):
        plan = build_register_plan(
            [_char(label="fixture-one")],
            ens_label="horrortube",
            existing_on_chain={},
        )
        self.assertTrue(plan["chain_writes"])
        self.assertEqual(plan["characters"][0]["name"], "fixture-one.horrortube.eth")
        self.assertEqual(plan["characters"][0]["action"], "register")


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
        self.assertEqual(plan["labels"][0]["name"], "fixture-one.horrortube.eth")


class ResolvePageTests(unittest.TestCase):
    def test_wiki_url_is_parsed_not_fetched(self):
        ref = resolve_page("https://villains.fandom.com/wiki/Pinhead_(Hellraiser)", wiki=None)
        self.assertEqual((ref.host, ref.title), (WIKI, "Pinhead (Hellraiser)"))

    def test_non_fandom_host_fails(self):
        with self.assertRaises(FandomError) as ctx:
            resolve_page("https://en.wikipedia.org/wiki/Pinhead", wiki=None)
        self.assertIn("fandom.com", str(ctx.exception))

    def test_title_without_wiki_fails(self):
        with self.assertRaises(FandomError) as ctx:
            resolve_page("Pinhead", wiki=None)
        self.assertIn("--wiki", str(ctx.exception))


class ProposeTests(unittest.TestCase):
    def test_appearance_and_powers_become_sheet(self):
        sheet = sheet_from_lore(_lore("Pinhead (Hellraiser)"))
        self.assertEqual(sheet["label"], "pinhead")
        self.assertTrue(sheet["look"].startswith("Pinhead's unique physical description"))
        self.assertTrue(sheet["brief"].startswith("Immortality: Pinhead is shown"))
        self.assertEqual(sheet["injuries"], "")
        self.assertEqual(sheet["status"], "alive")
        self.assertEqual(sheet["icon"], "")
        self.assertNotIn("strength", sheet)
        self.assertNotIn("role", sheet)

    def test_physical_appearance_section_is_used(self):
        sheet = sheet_from_lore(_lore("Michael Myers (Halloween)"))
        self.assertEqual(sheet["label"], "michael")
        self.assertIn("tall man", sheet["look"])
        self.assertIn("Inhuman Strength", sheet["brief"])

    def test_missing_appearance_section_fails(self):
        with self.assertRaises(FandomError) as ctx:
            _lore("Jason Voorhees (Friday the 13th)")
        self.assertIn("no Appearance section", str(ctx.exception))

    def test_disambiguation_page_fails(self):
        with self.assertRaises(FandomError) as ctx:
            _lore("Freddy Krueger")
        self.assertIn("disambiguation", str(ctx.exception))

    def test_duplicate_labels_fail(self):
        lore = _lore("Pinhead (Hellraiser)")
        with self.assertRaises(RosterValidationError) as ctx:
            propose_sheets([lore, lore])
        self.assertIn("duplicate", str(ctx.exception).lower())
        self.assertIn("pinhead", str(ctx.exception))

    def test_bulk_propose_then_import_plan(self):
        lores = [_lore("Pinhead (Hellraiser)"), _lore("Michael Myers (Halloween)")]
        characters = propose_sheets(lores)
        self.assertEqual([c["label"] for c in characters], ["pinhead", "michael"])
        payload = sheets_payload(characters)
        self.assertIsInstance(payload, list)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "proposed.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            loaded = load_characters(path)
            plan = build_import_plan(loaded, ens_label="horrortube")
            self.assertEqual(plan["plan"], "import")
            self.assertEqual(len(plan["characters"]), 2)


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
            labels.write_text(json.dumps(["a", "a"]), encoding="utf-8")
            with mock.patch.dict(os.environ, {"ENS_LABEL": "horrortube"}):
                code = cli.main(["remove", "--input", str(labels)])
            self.assertEqual(code, 1)

    def test_plan_remove_cli_writes_plan(self):
        with tempfile.TemporaryDirectory() as tmp:
            labels = Path(tmp) / "labels.json"
            out = Path(tmp) / "plan.json"
            labels.write_text(json.dumps(["fixture-one"]), encoding="utf-8")
            with mock.patch.dict(os.environ, {"ENS_LABEL": "horrortube"}):
                code = cli.main(
                    ["plan-remove", "--input", str(labels), "--out", str(out)]
                )
            self.assertEqual(code, 0)
            payload = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(payload["plan"], "remove")
            self.assertFalse(payload["chain_writes"])

    def test_propose_cli_writes_bulk_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "out.json"
            with mock.patch("roster.fandom.fetch_api", side_effect=_recorded_api):
                code = cli.main(
                    [
                        "propose",
                        "--n",
                        "2",
                        "--wiki",
                        WIKI,
                        "--source",
                        "Pinhead (Hellraiser)",
                        "--source",
                        "https://villains.fandom.com/wiki/Michael_Myers_(Halloween)",
                        "--out",
                        str(out),
                    ]
                )
            self.assertEqual(code, 0)
            labels = [c["label"] for c in json.loads(out.read_text(encoding="utf-8"))]
            self.assertEqual(labels, ["pinhead", "michael"])

    def test_propose_cli_fails_on_fetch_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "out.json"
            with mock.patch(
                "roster.fandom.fetch_api",
                side_effect=FandomError("HTTP 404 for https://villains.fandom.com/api.php"),
            ):
                code = cli.main(
                    ["propose", "--n", "1", "--wiki", WIKI, "--source", "Nobody", "--out", str(out)]
                )
            self.assertEqual(code, 1)
            self.assertFalse(out.exists())


class TestRegisterRejectsFixtures(unittest.TestCase):
    def test_register_refuses_fixture_path(self):
        code = cli.main(["register", "--input", str(FIXTURE)])
        self.assertEqual(code, 1)


def _battle_api(host, params):
    if params.get("prop") == "text":
        if params["section"] == "4":
            body = "<p>Huge hulking man with green skin and a bolted neck.</p>"
        else:
            body = "<p>Superhuman Strength: He tears a man limb from limb.</p>"
        return {"parse": {"text": body}}
    title = params["page"]
    if "disambiguation" in params.get("page", ""):
        return {
            "parse": {
                "title": "Frankenstein",
                "pageid": 7337,
                "properties": {"disambiguation": ""},
                "categories": [{"category": "Disambiguation_pages"}],
                "sections": [{"index": "1", "line": "Similar characters"}],
            }
        }
    if "Dracula" in title:
        sections = [{"index": "2", "line": "Powers and Abilities"}]
    elif "Mary" in title:
        sections = [{"index": "7", "line": "Powers and Abilities"}]
    else:
        sections = [{"index": "4", "line": "Appearance"}]
    return {
        "parse": {
            "title": title,
            "pageid": 1,
            "properties": {},
            "categories": [],
            "sections": sections,
        }
    }


class BattleProfileTests(unittest.TestCase):
    def test_appearance_and_powers_from_two_pages_share_frankenstein(self):
        with mock.patch("roster.fandom.fetch_api", side_effect=_battle_api):
            sheet = sheet_from_battle_pages(
                resolve_page(
                    "https://villains.fandom.com/wiki/Frankenstein%27s_Monster_(Universal)",
                    wiki=None,
                ),
                resolve_page(
                    "https://villains.fandom.com/wiki/Frankenstein%27s_Monster_(Mary_Shelley)",
                    wiki=None,
                ),
            )
        self.assertEqual(sheet["label"], "frankenstein")
        self.assertIn("green skin", sheet["look"])
        self.assertIn("Superhuman Strength", sheet["brief"])

    def test_mismatched_labels_fail(self):
        with mock.patch("roster.fandom.fetch_api", side_effect=_battle_api):
            with self.assertRaises(FandomError) as ctx:
                sheet_from_battle_pages(
                    resolve_page(
                        "https://villains.fandom.com/wiki/Frankenstein%27s_Monster_(Universal)",
                        wiki=None,
                    ),
                    resolve_page(
                        "https://villains.fandom.com/wiki/Dracula_(Castlevania)",
                        wiki=None,
                    ),
                )
        self.assertIn("share one label", str(ctx.exception))

    def test_disambiguation_look_page_fails(self):
        with mock.patch("roster.fandom.fetch_api", side_effect=_battle_api):
            with self.assertRaises(FandomError) as ctx:
                sheet_from_battle_pages(
                    resolve_page(
                        "https://villains.fandom.com/wiki/Frankenstein_disambiguation",
                        wiki=None,
                    ),
                    resolve_page(
                        "https://villains.fandom.com/wiki/Frankenstein%27s_Monster_(Mary_Shelley)",
                        wiki=None,
                    ),
                )
        self.assertIn("disambiguation", str(ctx.exception))

    def test_sections_command_prints_headings(self):
        with mock.patch("roster.fandom.fetch_api", side_effect=_battle_api):
            with mock.patch("sys.stdout") as stdout:
                code = cli.main(
                    [
                        "sections",
                        "--source",
                        "https://villains.fandom.com/wiki/Frankenstein_disambiguation",
                    ]
                )
        self.assertEqual(code, 0)
        written = "".join(call.args[0] for call in stdout.write.call_args_list)
        payload = json.loads(written)
        self.assertTrue(payload["disambiguation"])
        self.assertEqual(payload["sections"][0]["line"], "Similar characters")


if __name__ == "__main__":
    unittest.main()
