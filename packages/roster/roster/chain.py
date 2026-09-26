"""Invoke the TypeScript character-subnames chain script."""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Mapping, Sequence

from roster.validate import (
    Character,
    RosterValidationError,
    parse_injuries,
    parse_injury_places,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
TSX = REPO_ROOT / "packages" / "ens" / "node_modules" / ".bin" / "tsx"
CHAIN_SCRIPT = REPO_ROOT / "packages" / "ens" / "scripts" / "character-subnames.ts"


def _require_tsx() -> Path:
    if not TSX.is_file():
        raise RosterValidationError(
            f"Missing {TSX}. Run `pnpm install` in the repo root before "
            "`python -m roster register` or `python -m roster remove`."
        )
    if not CHAIN_SCRIPT.is_file():
        raise RosterValidationError(f"Missing chain script {CHAIN_SCRIPT}.")
    return TSX


def run_chain(args: Sequence[str]) -> None:
    tsx = _require_tsx()
    cmd = [str(tsx), str(CHAIN_SCRIPT), *args]
    print(f"chain: {' '.join(cmd)}", flush=True)
    try:
        completed = subprocess.run(cmd, cwd=str(REPO_ROOT), check=False)
    except OSError as exc:
        raise RosterValidationError(
            f"Failed to run chain script {CHAIN_SCRIPT}: {exc}"
        ) from exc
    if completed.returncode != 0:
        raise RosterValidationError(
            f"Chain script exited {completed.returncode}: {' '.join(cmd)}"
        )


def ensure_parent_infrastructure() -> None:
    run_chain(["ensure"])


def _chain_character(label: str, value: Mapping[str, Any], *, source: str) -> Character:
    for key in (
        "label",
        "display_name",
        "look",
        "brief",
        "injury_places",
        "injuries",
        "status",
        "icon",
    ):
        if key not in value or not isinstance(value[key], str):
            raise RosterValidationError(
                f"{source} {label!r} missing string field {key!r}."
            )
    display_name = value["display_name"]
    if display_name.strip() == "":
        raise RosterValidationError(
            f"{source} {label!r} has blank display_name."
        )
    raw_places = value["injury_places"]
    raw_injuries = value["injuries"]
    try:
        injury_places = parse_injury_places(raw_places, context=f"{source} {label!r}")
    except RosterValidationError as exc:
        raise RosterValidationError(
            f"{source} {label!r} has invalid injury_places {raw_places!r}: {exc}"
        ) from exc
    try:
        injuries = parse_injuries(raw_injuries, context=f"{source} {label!r}")
    except RosterValidationError as exc:
        raise RosterValidationError(
            f"{source} {label!r} has invalid injuries {raw_injuries!r}: {exc}"
        ) from exc
    return {
        "label": value["label"],
        "display_name": display_name,
        "look": value["look"],
        "brief": value["brief"],
        "injury_places": json.dumps(injury_places, ensure_ascii=False),
        "injuries": json.dumps(injuries, ensure_ascii=False),
        "status": value["status"],
        "icon": value["icon"],
    }


def snapshot_existing(labels: Sequence[str]) -> dict[str, Character]:
    if len(labels) == 0:
        return {}
    with tempfile.TemporaryDirectory() as tmp:
        labels_path = Path(tmp) / "labels.json"
        out_path = Path(tmp) / "existing.json"
        labels_path.write_text(json.dumps(list(labels)) + "\n", encoding="utf-8")
        run_chain(["snapshot", "--labels", str(labels_path), "--out", str(out_path)])
        try:
            raw: Any = json.loads(out_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RosterValidationError(
                f"Failed to read chain snapshot {out_path}: {exc}"
            ) from exc
    if not isinstance(raw, dict):
        raise RosterValidationError(
            f"Chain snapshot must be an object keyed by label. Got {type(raw).__name__}."
        )
    out: dict[str, Character] = {}
    for label, value in raw.items():
        if not isinstance(label, str) or not isinstance(value, dict):
            raise RosterValidationError(
                f"Chain snapshot entry for {label!r} must be a character object."
            )
        out[label] = _chain_character(label, value, source="Chain snapshot")
    return out


def apply_register_plan(plan: Mapping[str, Any]) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        plan_path = Path(tmp) / "register-plan.json"
        plan_path.write_text(json.dumps(plan, indent=2) + "\n", encoding="utf-8")
        run_chain(["apply-register", "--plan", str(plan_path)])


def unregister_labels(labels: Sequence[str]) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        labels_path = Path(tmp) / "labels.json"
        labels_path.write_text(json.dumps(list(labels)) + "\n", encoding="utf-8")
        run_chain(["unregister", "--labels", str(labels_path)])


def list_registered() -> dict[str, Character]:
    """Discover every registered character subname and read its text records."""
    with tempfile.TemporaryDirectory() as tmp:
        out_path = Path(tmp) / "registered.json"
        run_chain(["list", "--out", str(out_path)])
        try:
            raw: Any = json.loads(out_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RosterValidationError(
                f"Failed to read registered roster list {out_path}: {exc}"
            ) from exc
    if not isinstance(raw, dict):
        raise RosterValidationError(
            f"Registered roster list must be an object keyed by label. "
            f"Got {type(raw).__name__}."
        )
    out: dict[str, Character] = {}
    for label, value in raw.items():
        if not isinstance(label, str) or not isinstance(value, dict):
            raise RosterValidationError(
                f"Registered roster entry for {label!r} must be a character object."
            )
        out[label] = _chain_character(label, value, source="Registered roster")
    return out


def set_icons(
    updates: Sequence[Mapping[str, str]],
) -> list[dict[str, str]]:
    """setText only the icon key for each update. Does not touch other text keys."""
    if len(updates) == 0:
        raise RosterValidationError(
            "set_icons requires at least one {label, icon} update. Refusing empty list."
        )
    payload: list[dict[str, str]] = []
    for entry in updates:
        label = entry.get("label")
        icon = entry.get("icon")
        if not isinstance(label, str) or label.strip() == "":
            raise RosterValidationError(
                f"set_icons update missing non-empty label. Got: {entry!r}"
            )
        if not isinstance(icon, str) or not icon.startswith("https://"):
            raise RosterValidationError(
                f"set_icons for {label!r}: icon must be an https URL. Got: {icon!r}"
            )
        payload.append({"label": label.strip(), "icon": icon.strip()})

    with tempfile.TemporaryDirectory() as tmp:
        updates_path = Path(tmp) / "icon-updates.json"
        out_path = Path(tmp) / "icon-results.json"
        updates_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        run_chain(["set-icon", "--updates", str(updates_path), "--out", str(out_path)])
        try:
            raw: Any = json.loads(out_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RosterValidationError(
                f"Failed to read set-icon results {out_path}: {exc}"
            ) from exc
    if not isinstance(raw, list):
        raise RosterValidationError(
            f"set-icon results must be a JSON array. Got {type(raw).__name__}."
        )
    results: list[dict[str, str]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            raise RosterValidationError(
                f"set-icon result entry must be an object. Got {type(entry).__name__}."
            )
        for key in ("label", "icon", "txHash"):
            if key not in entry or not isinstance(entry[key], str) or entry[key].strip() == "":
                raise RosterValidationError(
                    f"set-icon result missing string field {key!r}: {entry!r}"
                )
        results.append(
            {
                "label": entry["label"],
                "icon": entry["icon"],
                "txHash": entry["txHash"],
            }
        )
    return results
