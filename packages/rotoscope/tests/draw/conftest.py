"""Fixtures for the people drawing's tests: the staged clip's frames and one drawer for the session. MediaPipe's model
files are shared with the CLI: $ROTOSCOPE_MODELS, else ~/.cache/rotoscope/mediapipe."""
import os
from pathlib import Path

import numpy as np
import pytest

from draw_media import STAGED_FRAMES, media

MODELS = Path.home() / ".cache" / "rotoscope" / "mediapipe"


def pytest_configure(config):
    config.addinivalue_line("markers", "slow: runs models on the GPU")


@pytest.fixture(scope="session")
def staged_frames() -> np.ndarray:
    """The staged clip: two people at arcade panels, one with a trophy; (77, 468, 832, 3) RGB."""
    media(STAGED_FRAMES)
    return np.load(STAGED_FRAMES, mmap_mode="r")


@pytest.fixture(scope="session")
def drawer():
    pytest.importorskip("Vision")
    from rotoscope.backends.apple_vision import AppleVision
    from rotoscope.draw.people import V7Drawer

    return V7Drawer(AppleVision(), Path(os.environ.get("ROTOSCOPE_MODELS", MODELS)))
