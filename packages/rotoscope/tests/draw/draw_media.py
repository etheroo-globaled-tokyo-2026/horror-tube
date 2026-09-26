"""Where the people drawing's tests find research media: the ethglobal-tokyo-2026-design-drafts checkout
($ROTOSCOPE_RESEARCH, default ~/projects/...). A test whose media isn't on this machine is skipped."""
import os
from pathlib import Path

import pytest

RESEARCH = Path(os.environ.get("ROTOSCOPE_RESEARCH",
                               Path.home() / "projects/ethglobal-tokyo-2026-design-drafts/research"))
V7 = RESEARCH / "rotoscope-eval/.cache/work/v7"
STAGED_FRAMES = RESEARCH / "rotoscope-eval/.cache/work/frames/staged.npy"


def media(*paths: Path) -> None:
    missing = [p for p in paths if not p.exists()]
    if missing:
        pytest.skip(f"research media not on this machine: {missing[0]}")
