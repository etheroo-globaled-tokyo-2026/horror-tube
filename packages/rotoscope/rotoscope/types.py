from dataclasses import dataclass, field
from typing import Literal, Protocol, Sequence
import numpy as np

Kind = Literal["cast", "prop", "blood", "light", "hand"]
ANALYSIS_W, ANALYSIS_H = 640, 360        # every mask is bool (360, 640)
DRAW_W, DRAW_H = 256, 144                # the drawing, palette indices, 0 = background

@dataclass(frozen=True)
class Prompt:
    kind: Kind
    key: str        # cast id for "cast", the prop's find phrase for "prop", else the prompt text
    text: str       # what SAM is asked for

@dataclass(frozen=True)
class Find:
    kind: Kind
    key: str
    score: float
    mask: np.ndarray                     # bool (360, 640)
    box: tuple[int, int, int, int]       # x0, y0, x1, y1 at 640x360
    track: int | None = None             # the tracker's id for this object
    fill: bool = False                   # only the tracker has it in this frame (the finder missed it)

class Segmenter(Protocol):
    def find(self, frames: Sequence[np.ndarray], prompts: Sequence[Prompt], cuts: Sequence[int]) -> list[list[Find]]:
        """frames: RGB uint8 at source size, 16:9. Every track ends at a cut (frame indices)."""

class HandFinder(Protocol):
    def hands(self, frame: np.ndarray) -> list[list[tuple[float, float]]]:
        """Joints at 640x360; a one-joint list is a wrist from the body pose."""

@dataclass(frozen=True)
class Figure:
    id: str                 # cast id
    mask: np.ndarray        # bool (360, 640)
    colour: int             # palette index

@dataclass
class Drawn:
    canvas: np.ndarray                          # uint8 (144, 256) palette indices
    faces: set[str] = field(default_factory=set)  # cast ids with a face drawn

class PeopleDrawer(Protocol):
    def reset(self) -> None:
        """At a cut: face tracks and smoothing start again."""
    def draw(self, frame: np.ndarray, figures: Sequence[Figure]) -> Drawn: ...
