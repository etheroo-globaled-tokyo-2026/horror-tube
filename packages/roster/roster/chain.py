"""Invoke the TypeScript character-subnames chain script."""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Mapping, Sequence

from roster.validate import Character, RosterValidationError

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
        for key in ("label", "look", "brief", "injuries", "status", "icon"):
            if key not in value or not isinstance(value[key], str):
                raise RosterValidationError(
                    f"Chain snapshot {label!r} missing string field {key!r}."
                )
        out[label] = {
            "label": value["label"],
            "look": value["look"],
            "brief": value["brief"],
            "injuries": value["injuries"],
            "status": value["status"],
            "icon": value["icon"],
        }
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
