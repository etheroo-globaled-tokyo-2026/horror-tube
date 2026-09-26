"""Face rectangles, which the drawing takes from a face finder (backends.apple_vision on the Mac)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np


@dataclass(frozen=True)
class FaceBox:
    box: tuple[float, float, float, float]    # x0, y0, x1, y1 as fractions of the frame, y down
    conf: float
    yaw: float                                # degrees; above 0 the face turns to image right
    roll: float                               # degrees


class FaceFinder(Protocol):
    def faces(self, frame: np.ndarray) -> list[FaceBox]:
        """Every face in an RGB uint8 frame, biggest first."""
