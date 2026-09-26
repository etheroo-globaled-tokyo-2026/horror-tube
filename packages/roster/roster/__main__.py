"""CLI: validate roster JSON, propose sheets, plan import/removal, register/unregister, generate face icons, sync icons onto chain."""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path
from typing import Mapping, Optional, Sequence

from dotenv import load_dotenv

from roster.chain import (
    apply_register_plan,
    list_registered,
    list_registered_labels,
    set_icons,
    snapshot_existing,
    unregister_labels,
)
from roster.fandom import FandomError, fetch_page_lore, require_source_count, resolve_page
from roster.icons import (
    IconGenerationError,
    generate_face_png,
    required_env,
    spaces_store_from_env,
    sync_chain_icons,
    write_face_icons,
)
from roster.plan import (
    ON_EXISTING_VALUES,
    build_import_plan,
    build_register_plan,
    build_removal_plan,
)
from roster.propose import propose_cast, propose_sheets, sheets_payload
from roster.validate import (
    RosterValidationError,
    load_characters,
    load_existing_index,
    load_label_list,
    require_no_duplicate_labels,
    require_no_duplicate_strings,
)


def _require_ens_label() -> str:
    raw = os.environ.get("ENS_LABEL")
    if raw is None or raw.strip() == "":
        raise RosterValidationError(
            "ENS_LABEL is required. Set it in .env. See .env.example. "
            "Parent name is <ENS_LABEL>.eth; character subnames are "
            "label.<ENS_LABEL>.eth."
        )
    label = raw.strip()
    if "." in label:
        raise RosterValidationError(
            f"ENS_LABEL must be one label, not a full name. Got: {label}"
        )
    return label


def _require_flag(value: Optional[str], *, name: str) -> str:
    if value is None or value.strip() == "":
        raise RosterValidationError(
            f"{name} is required. Refusing to default a path or flag."
        )
    return value


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=False) + "\n", encoding="utf-8")


def _load_sources_file(path: Path) -> list[str]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise FandomError(f"Failed to read sources file {path}: {exc}") from exc
    lines = []
    for raw in text.splitlines():
        line = raw.strip()
        if line == "" or line.startswith("#"):
            continue
        lines.append(line)
    if len(lines) == 0:
        raise FandomError(f"{path}: sources file has no URLs or page titles.")
    return lines


def cmd_icons(args: argparse.Namespace) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    input_path = Path(_require_flag(args.input, name="--input"))
    out_dir = Path(_require_flag(args.out_dir, name="--out-dir"))
    out_path = Path(_require_flag(args.out, name="--out"))
    _refuse_fixture_input(input_path, command="icons")
    characters = load_characters(input_path)
    require_no_duplicate_labels(characters, source=str(input_path))
    cdn_host = required_env("SPACES_CDN_HOST", os.environ)
    spaces = spaces_store_from_env(os.environ)
    written, updated = write_face_icons(
        characters,
        out_dir,
        api_key=required_env("TOGETHER_API_KEY", os.environ),
        model=required_env("TOGETHER_IMAGE_MODEL", os.environ),
        api_url=required_env("TOGETHER_API_URL", os.environ),
        spaces=spaces,
        cdn_host=cdn_host,
        override=bool(args.override),
    )
    _write_json(out_path, sheets_payload(updated))
    print(f"Wrote {len(written)} face icon(s) to {out_dir}")
    for path in written:
        print(path)
    print(f"Wrote character JSON with icon URLs: {out_path}")
    for character in updated:
        print(f"  {character['label']}: {character['icon']}")
    return 0


def _require_chain_env() -> None:
    """Fail closed before any chain or CDN write when ENS write env is missing."""
    for name in ("ENS_LABEL", "SEPOLIA_RPC_URL", "PRIVATE_KEY"):
        raw = os.environ.get(name)
        if raw is None or raw.strip() == "":
            raise RosterValidationError(
                f"{name} is required. Set it in .env. See .env.example. "
                "Refusing to fall back."
            )
    _require_ens_label()


class _LiveIconChain:
    def set_icons(
        self, updates: Sequence[Mapping[str, str]]
    ) -> list[dict[str, str]]:
        return set_icons(updates)


def cmd_icons_chain(args: argparse.Namespace) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    _require_chain_env()
    cdn_host = required_env("SPACES_CDN_HOST", os.environ)
    spaces = spaces_store_from_env(os.environ)
    api_key = required_env("TOGETHER_API_KEY", os.environ)
    model = required_env("TOGETHER_IMAGE_MODEL", os.environ)
    api_url = required_env("TOGETHER_API_URL", os.environ)

    registered = list_registered()
    if len(registered) == 0:
        raise RosterValidationError(
            "No registered character subnames found on chain under "
            f"{_require_ens_label()}.eth. Refusing to invent a roster."
        )
    characters = [registered[label] for label in sorted(registered.keys())]
    print(f"icons-chain: registered={len(characters)}")
    for character in characters:
        icon = character["icon"]
        print(
            f"  {character['label']}: "
            f"icon={'empty' if icon.strip() == '' else icon}"
        )

    results = sync_chain_icons(
        characters,
        generate_png=lambda look: generate_face_png(
            look,
            api_key=api_key,
            model=model,
            api_url=api_url,
        ),
        spaces=spaces,
        cdn_host=cdn_host,
        chain=_LiveIconChain(),
        override=bool(args.override),
    )
    print(f"icons-chain: done characters={len(results)}")
    for row in results:
        action = row["action"]
        label = row["label"]
        icon = row["icon"]
        tx = row["txHash"]
        if action == "skipped":
            print(f"skipped {label}: on-chain icon already {icon}")
        elif tx == "":
            print(f"{action} {label}: {icon}")
        else:
            print(f"{action} {label}: {icon} txHash={tx}")
    return 0


def cmd_propose(args: argparse.Namespace) -> int:
    out_path = Path(_require_flag(args.out, name="--out"))
    sources: list[str] = list(args.source or [])
    if args.sources_file is not None:
        if args.sources_file.strip() == "":
            raise FandomError("--sources-file was passed blank.")
        sources.extend(_load_sources_file(Path(args.sources_file)))
    if len(sources) == 0:
        raise FandomError(
            "Provide at least one --source URL/title, or a --sources-file list."
        )
    sources = require_source_count(sources, n=args.n)
    if args.wiki is not None and args.wiki.strip() == "":
        raise FandomError("--wiki was passed blank. Omit it or pass a Fandom host.")

    refs = [resolve_page(source, wiki=args.wiki) for source in sources]
    characters = propose_sheets([fetch_page_lore(ref) for ref in refs])
    payload = sheets_payload(characters)
    _write_json(out_path, payload)
    print(f"Wrote proposed roster JSON: {out_path}")
    print(f"characters={len(characters)}")
    for character in characters:
        print(f"  {character['label']}")
    print(
        "Pass this file to `python -m roster import --input ...` for a plan, "
        "or `python -m roster register --input ...` to send chain txs. "
        "This command does not call ENS."
    )
    return 0


def cmd_import(args: argparse.Namespace) -> int:
    ens_label = _require_ens_label()
    input_path = Path(_require_flag(args.input, name="--input"))
    out_path = Path(_require_flag(args.out, name="--out"))

    characters = load_characters(input_path)
    require_no_duplicate_labels(characters, source=str(input_path))

    existing = None
    if args.existing is not None:
        if args.existing.strip() == "":
            raise RosterValidationError(
                "--existing was passed blank. Omit the flag or pass a JSON path."
            )
        existing = load_existing_index(Path(args.existing))

    on_existing = args.on_existing
    if on_existing is not None and on_existing not in ON_EXISTING_VALUES:
        raise RosterValidationError(
            f"--on-existing must be one of {sorted(ON_EXISTING_VALUES)!r}. Got: {on_existing!r}"
        )

    plan = build_import_plan(
        characters,
        ens_label=ens_label,
        existing=existing,
        on_existing=on_existing,
    )
    _write_json(out_path, plan)
    print(f"Wrote import plan: {out_path}")
    print(f"characters={len(plan['characters'])} skipped={len(plan['skipped'])}")
    for entry in plan["characters"]:
        print(entry["ens_action"])
    for skipped in plan["skipped"]:
        print(f"skipped {skipped['label']}: {skipped['reason']}")
    print(
        "Plan only (chain_writes=false). Send with "
        "`python -m roster register --input ...`."
    )
    return 0


def cmd_plan_remove(args: argparse.Namespace) -> int:
    ens_label = _require_ens_label()
    input_path = Path(_require_flag(args.input, name="--input"))
    out_path = Path(_require_flag(args.out, name="--out"))

    labels = load_label_list(input_path)
    require_no_duplicate_strings(labels, source=str(input_path))

    plan = build_removal_plan(labels, ens_label=ens_label)
    _write_json(out_path, plan)
    print(f"Wrote removal plan: {out_path}")
    print(f"labels={len(plan['labels'])}")
    for entry in plan["labels"]:
        print(entry["ens_action"])
    print(
        "Plan only (chain_writes=false). Send with "
        "`python -m roster remove --input ...`."
    )
    return 0


def _refuse_fixture_input(path: Path, *, command: str) -> None:
    resolved = path.resolve()
    if "fixtures" in resolved.parts:
        raise RosterValidationError(
            f"{path}: {command} will not accept a fixture. "
            "Run `python -m roster propose` against Fandom and pass that JSON. "
            "An end-to-end ENS or CDN upload requires that real sheet."
        )


def _refuse_fixture_for_chain(path: Path) -> None:
    _refuse_fixture_input(path, command="register")


def cmd_register(args: argparse.Namespace) -> int:
    ens_label = _require_ens_label()
    input_path = Path(_require_flag(args.input, name="--input"))
    _refuse_fixture_for_chain(input_path)

    characters = load_characters(input_path)
    require_no_duplicate_labels(characters, source=str(input_path))

    on_existing = args.on_existing
    if on_existing is not None and on_existing not in ON_EXISTING_VALUES:
        raise RosterValidationError(
            f"--on-existing must be one of {sorted(ON_EXISTING_VALUES)!r}. Got: {on_existing!r}"
        )

    labels = [character["label"] for character in characters]
    existing_on_chain = snapshot_existing(labels)
    plan = build_register_plan(
        characters,
        ens_label=ens_label,
        existing_on_chain=existing_on_chain,
        on_existing=on_existing,
    )
    print(
        f"register plan: characters={len(plan['characters'])} "
        f"skipped={len(plan['skipped'])} chain_writes=true"
    )
    for entry in plan["characters"]:
        print(entry["ens_action"])
    for skipped in plan["skipped"]:
        print(f"skipped {skipped['label']}: {skipped['reason']}")

    if args.out is not None:
        out_path = Path(_require_flag(args.out, name="--out"))
        _write_json(out_path, plan)
        print(f"Wrote register plan: {out_path}")

    if len(plan["characters"]) == 0:
        print("Nothing to register on chain.")
        return 0

    apply_register_plan(plan)
    print("register: chain writes complete")
    return 0


def cmd_wipe(_args: argparse.Namespace) -> int:
    """Unregister every character subname. Does not touch the parent .eth name."""
    _require_chain_env()
    labels = list_registered_labels()
    if len(labels) == 0:
        print("wipe: no registered character subnames.")
        return 0
    print(f"wipe: unregistering {len(labels)} label(s): {', '.join(labels)}")
    unregister_labels(labels)
    print("wipe: chain writes complete")
    return 0


def cmd_redeploy(_args: argparse.Namespace) -> int:
    """Propose the 12 from Fandom, upload icons, and register them."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    _require_chain_env()
    cdn_host = required_env("SPACES_CDN_HOST", os.environ)
    spaces = spaces_store_from_env(os.environ)
    characters = propose_cast()
    require_no_duplicate_labels(characters, source="cast.json")
    print(f"redeploy: proposed {len(characters)} sheet(s)")
    for character in characters:
        print(f"  {character['label']} {character['display_name']}")

    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        icon_dir = Path(tmp) / "icons"
        _written, updated = write_face_icons(
            characters,
            icon_dir,
            api_key=required_env("TOGETHER_API_KEY", os.environ),
            model=required_env("TOGETHER_IMAGE_MODEL", os.environ),
            api_url=required_env("TOGETHER_API_URL", os.environ),
            spaces=spaces,
            cdn_host=cdn_host,
            override=False,
        )
        ens_label = _require_ens_label()
        labels = [character["label"] for character in updated]
        existing_on_chain = snapshot_existing(labels)
        if len(existing_on_chain) != 0:
            still = ", ".join(sorted(existing_on_chain))
            raise RosterValidationError(
                f"Refusing to register over existing subnames: {still}. "
                "Run `python -m roster wipe` first."
            )
        plan = build_register_plan(
            updated,
            ens_label=ens_label,
            existing_on_chain=existing_on_chain,
            on_existing=None,
        )
        print(f"redeploy: registering {len(plan['characters'])} character(s)")
        apply_register_plan(plan)
    print("redeploy: chain writes complete")
    return 0


def cmd_remove(args: argparse.Namespace) -> int:
    _require_ens_label()
    input_path = Path(_require_flag(args.input, name="--input"))

    labels = load_label_list(input_path)
    require_no_duplicate_strings(labels, source=str(input_path))

    print(
        f"remove: unregistering {len(labels)} label(s) on chain "
        f"(not a plan; use plan-remove for plan-only)."
    )
    unregister_labels(labels)
    print("remove: chain writes complete")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m roster",
        description=(
            "Propose character sheets from Fandom lore, validate roster JSON, write "
            "import/removal plans, and register/unregister character subnames on ENS. "
            "`import` / `plan-remove` are plan-only. `register` / `remove` send transactions."
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    icons_p = sub.add_parser(
        "icons",
        help=(
            "Generate 100x100 face icons from each character look via Together, "
            "upload to Spaces with ACL public-read, and write character JSON with "
            "the CDN icon URL. Skips when <label>.png already exists on Spaces "
            "unless --override. Refuses fixture JSON."
        ),
    )
    icons_p.add_argument(
        "--input",
        required=True,
        help="Path to a single-character object or bulk character array JSON.",
    )
    icons_p.add_argument(
        "--out-dir",
        required=True,
        help=(
            "Directory to write local <label>.png files when an image is generated. "
            "Created if missing. Skipped characters are not rewritten here."
        ),
    )
    icons_p.add_argument(
        "--out",
        required=True,
        help="Path to write updated character JSON with icon CDN URLs filled.",
    )
    icons_p.add_argument(
        "--override",
        action="store_true",
        help=(
            "When <label>.png already exists on Spaces, generate a new image and "
            "upload under <label>-<unix-seconds>.png instead of skipping. "
            "Does not overwrite the canonical object in place."
        ),
    )
    icons_p.set_defaults(func=cmd_icons)

    icons_chain_p = sub.add_parser(
        "icons-chain",
        help=(
            "Read registered character subnames from chain. For each empty on-chain "
            "icon, generate a face PNG from the on-chain look, upload to Spaces, and "
            "setText only the icon key to the https CDN URL. Skips characters that "
            "already have a non-empty https icon unless --override. Does not change "
            "display_name, look, brief, injury_places, injuries, or status."
        ),
    )
    icons_chain_p.add_argument(
        "--override",
        action="store_true",
        help=(
            "Regenerate and setText icon even when the on-chain icon is already a "
            "non-empty https URL. Uploads under <label>-<unix-seconds>.png when the "
            "canonical Spaces object already exists."
        ),
    )
    icons_chain_p.set_defaults(func=cmd_icons_chain)

    propose_p = sub.add_parser(
        "propose",
        help=(
            "Read Appearance and Powers and abilities sections from Fandom api.php "
            "and write proposed roster JSON (ready for `import` or `register`)."
        ),
    )
    propose_p.add_argument(
        "--n",
        type=int,
        required=True,
        help="Exact number of characters to propose. Must equal the number of sources.",
    )
    propose_p.add_argument(
        "--source",
        action="append",
        default=[],
        help=(
            "https://<wiki>.fandom.com/wiki/<Title> URL (parsed, not fetched) or page title. "
            "Repeat for each character. Titles require --wiki."
        ),
    )
    propose_p.add_argument(
        "--sources-file",
        required=False,
        default=None,
        help="Optional text file: one URL or page title per line (# comments allowed).",
    )
    propose_p.add_argument(
        "--wiki",
        required=False,
        default=None,
        help="Fandom host for page titles, e.g. villains.fandom.com. Not used for full URLs.",
    )
    propose_p.add_argument(
        "--out",
        required=True,
        help="Path to write proposed character JSON (single object or bulk array).",
    )
    propose_p.set_defaults(func=cmd_propose)

    import_p = sub.add_parser(
        "import",
        help="Validate import JSON and write an import plan (no chain writes).",
    )
    import_p.add_argument(
        "--input",
        required=True,
        help="Path to a single-character object or bulk character array JSON.",
    )
    import_p.add_argument(
        "--out",
        required=True,
        help="Path to write the normalized import plan JSON.",
    )
    import_p.add_argument(
        "--existing",
        required=False,
        default=None,
        help=(
            "Optional JSON of already-known characters (same schema as import). "
            "Offline dead/injured detection only. Prefer `register`, which reads chain."
        ),
    )
    import_p.add_argument(
        "--on-existing",
        required=False,
        default=None,
        choices=sorted(ON_EXISTING_VALUES),
        help=(
            "Required when --existing marks any input label as dead or injured. "
            "skip: omit from plan. restore: set status to \"alive\"; keep injuries from input."
        ),
    )
    import_p.set_defaults(func=cmd_import)

    plan_remove_p = sub.add_parser(
        "plan-remove",
        help="Validate labels and write a removal plan (no chain writes).",
    )
    plan_remove_p.add_argument(
        "--input",
        required=True,
        help="Path to a JSON array of labels to unregister.",
    )
    plan_remove_p.add_argument(
        "--out",
        required=True,
        help="Path to write the normalized removal plan JSON.",
    )
    plan_remove_p.set_defaults(func=cmd_plan_remove)

    register_p = sub.add_parser(
        "register",
        help=(
            "Read chain state, then register character subnames and setText "
            "(display_name, look, brief, injury_places, injuries, status, icon). Sends transactions."
        ),
    )
    register_p.add_argument(
        "--input",
        required=True,
        help=(
            "Path to propose output: a single-character object or bulk array. "
            "Files under a fixtures directory are rejected."
        ),
    )
    register_p.add_argument(
        "--out",
        required=False,
        default=None,
        help="Optional path to write the register plan JSON that was applied.",
    )
    register_p.add_argument(
        "--on-existing",
        required=False,
        default=None,
        choices=sorted(ON_EXISTING_VALUES),
        help=(
            "Required when any input label is already registered on chain. "
            "skip: leave chain unchanged and report. "
            "restore: set status to \"alive\"; write injuries from the input file."
        ),
    )
    register_p.set_defaults(func=cmd_register)

    remove_p = sub.add_parser(
        "remove",
        help=(
            "Unregister character subnames on chain (UserRegistry.unregister). "
            "Sends transactions. Use plan-remove for a plan-only JSON."
        ),
    )
    remove_p.add_argument(
        "--input",
        required=True,
        help="Path to a JSON array of labels to unregister.",
    )
    remove_p.set_defaults(func=cmd_remove)

    wipe_p = sub.add_parser(
        "wipe",
        help=(
            "Unregister every character subname under ENS_LABEL. "
            "Does not read text records and does not remove the parent .eth name."
        ),
    )
    wipe_p.set_defaults(func=cmd_wipe)

    redeploy_p = sub.add_parser(
        "redeploy",
        help=(
            "Propose the 12 cast fighters from live Fandom pages, upload face icons, "
            "and register them with display_name, injury_places, and injuries."
        ),
    )
    redeploy_p.set_defaults(func=cmd_redeploy)

    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    load_dotenv()
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except FandomError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except RosterValidationError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except IconGenerationError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
