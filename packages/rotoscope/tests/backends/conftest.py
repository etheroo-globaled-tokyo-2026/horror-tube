"""The backends' smoke tests run on three frames of a fal gore clip in the ethglobal-tokyo-2026-design-drafts checkout
($ROTOSCOPE_RESEARCH, default ~/projects/...): Freddy Krueger and a Xenomorph, a red lamp, acid-green blood. They're
skipped where the clip isn't on this machine."""
import os
from pathlib import Path

import cv2
import numpy as np
import pytest

RESEARCH = Path(os.environ.get("ROTOSCOPE_RESEARCH",
                               Path.home() / "projects/ethglobal-tokyo-2026-design-drafts/research"))
GORE = RESEARCH / "generate/fal_gore_freddy_xeno/clip.mp4"
FIRST = 20                   # the Xenomorph is slashed here: blood in the air


def pytest_configure(config):
    config.addinivalue_line("markers", "slow: runs models on the GPU")


@pytest.fixture(scope="session")
def gore_frames() -> list[np.ndarray]:
    """Three consecutive frames, RGB, centre-cropped to 16:9."""
    if not GORE.exists():
        pytest.skip(f"research media not on this machine: {GORE}")
    cap = cv2.VideoCapture(str(GORE))
    cap.set(cv2.CAP_PROP_POS_FRAMES, FIRST)
    out = []
    for _ in range(3):
        ok, f = cap.read()
        assert ok, f"{GORE}: can't read frame {FIRST + len(out)}"
        h, w = f.shape[:2]
        ch = round(w * 9 / 16)
        out.append(cv2.cvtColor(f[(h - ch) // 2:(h - ch) // 2 + ch], cv2.COLOR_BGR2RGB))
    cap.release()
    return out
