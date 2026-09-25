"""CLI: validate roster JSON and emit import/removal plans (no chain I/O)."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Optional, Sequence

from roster.plan import ON_EXISTING_VALUES, build_import_plan, build_removal_plan
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
    return 0


def cmd_remove(args: argparse.Namespace) -> int:
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
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m roster",
        description=(
            "Validate character roster JSON and write normalized import/removal plans. "
            "Does not read or write ENS chain state in this PR."
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    import_p = sub.add_parser(
        "import",
        help="Validate import JSON, detect in-file dupes, write an import plan.",
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
            "Used only for dead/injured detection. Chain reads are not in this PR."
        ),
    )
    import_p.add_argument(
        "--on-existing",
        required=False,
        default=None,
        choices=sorted(ON_EXISTING_VALUES),
        help=(
            "Required when --existing marks any input label as dead or injured. "
            "skip: omit from plan. restore: clear status to \"\"; keep injuries from input."
        ),
    )
    import_p.set_defaults(func=cmd_import)

    remove_p = sub.add_parser(
        "remove",
        help="Validate a JSON list of labels and write a removal (unregister) plan.",
    )
    remove_p.add_argument(
        "--input",
        required=True,
        help="Path to a JSON array of labels to unregister.",
    )
    remove_p.add_argument(
        "--out",
        required=True,
        help="Path to write the normalized removal plan JSON.",
    )
    remove_p.set_defaults(func=cmd_remove)

    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except RosterValidationError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
