"""Fixtures for the people drawing's tests: the staged clip's frames and one drawer for the session. MediaPipe's model
files go to $ROTOSCOPE_MODELS, else pytest's cache."""
import os
from pathlib import Path

import numpy as np
import pytest

from draw_media import STAGED_FRAMES, media


def pytest_configure(config):
    config.addinivalue_line("markers", "slow: runs models on the GPU")


@pytest.fixture(scope="session")
def staged_frames() -> np.ndarray:
    """The staged clip: two people at arcade panels, one with a trophy; (77, 468, 832, 3) RGB."""
    media(STAGED_FRAMES)
    return np.load(STAGED_FRAMES, mmap_mode="r")


@pytest.fixture(scope="session")
def drawer(request):
    pytest.importorskip("Vision")
    from rotoscope.backends.apple_vision import AppleVision
    from rotoscope.draw.people import V7Drawer

    models = os.environ.get("ROTOSCOPE_MODELS")
    return V7Drawer(AppleVision(), Path(models) if models else request.config.cache.mkdir("mediapipe-models"))
