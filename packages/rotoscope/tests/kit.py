"""Mask and find builders, clip writers and fake backends shared by the core's tests."""
import subprocess
import time
from pathlib import Path

import numpy as np

from rotoscope.compose import trace
from rotoscope.config import Outline
from rotoscope.rules import box_of
from rotoscope.shots import SIDES, CastMember, PropSpec, Shot
from rotoscope.types import ANALYSIS_H, ANALYSIS_W, DRAW_H, DRAW_W, Drawn, Find


def rect(x0: int, y0: int, x1: int, y1: int) -> np.ndarray:
    m = np.zeros((ANALYSIS_H, ANALYSIS_W), bool)
    m[y0:y1, x0:x1] = True
    return m


def find(kind: str, key: str, mask: np.ndarray, score: float = 0.9, track: int | None = None,
         fill: bool = False) -> Find:
    return Find(kind, key, score, mask, box_of(mask), track, fill)


def shot(cast: str = "AB", props: tuple[tuple[str, str], ...] = (), finds: dict[str, str] | None = None) -> Shot:
    """cast: the ids, seated left to right. props: (find, holder) pairs. finds: a description per id, where it
    matters."""
    sides = SIDES if len(cast) == 3 else ("left", "right") if len(cast) == 2 else ("center",) * len(cast)
    members = tuple(CastMember(c, f"character {c}", (finds or {}).get(c, f"figure {c}"), side)
                    for c, side in zip(cast, sides))
    return Shot(0.0, 10.0, members, tuple(PropSpec(f, h) for f, h in props))


# a scene at 640x360: A on the left, B on the right, both full height
A_MASK = rect(100, 60, 220, 360)
B_MASK = rect(420, 60, 540, 360)
KNIFE = rect(222, 200, 262, 215)                     # just off A's right side
A_HAND = [(218.0, 204.0), (220.0, 207.0), (221.0, 211.0)]  # A's fingertips, beside the knife, not on it
BLOOD = rect(300, 300, 380, 340)


def write_clip(path: Path, frames: np.ndarray, fps: int = 15, audio: bool = True) -> Path:
    """RGB frames (n, h, w, 3) to an H.264 mp4, with a sine tone as its audio."""
    n, h, w, _ = frames.shape
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", str(fps),
           "-i", "-"]
    if audio:
        cmd += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={n / fps}", "-c:a", "aac"]
    cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "12", str(path)]
    subprocess.run(cmd, input=frames.tobytes(), check=True, capture_output=True)
    return path


def fight_frames(n: int = 30, cut: int | None = 15, size: tuple[int, int] = (320, 180)) -> np.ndarray:
    """Frames with a red patch where BLOOD is; dark before `cut`, bright from it on, so a cut is found there."""
    w, h = size
    frames = np.zeros((n, h, w, 3), np.uint8)
    frames[:] = (30, 30, 40)
    if cut is not None:
        frames[cut:] = (200, 200, 190)
    ys, xs = np.nonzero(BLOOD[:: ANALYSIS_H // h, :: ANALYSIS_W // w])
    frames[:, ys, xs] = (200, 20, 30)
    return frames


class FakeSegmenter:
    """Finds A, a knife at A's right hand and a patch of blood in every frame."""

    def __init__(self, delay_s: float = 0.0):
        self.delay_s = delay_s
        self.calls: list[tuple[int, list, list[int]]] = []

    def find(self, frames, prompts, cuts):
        time.sleep(self.delay_s)
        self.calls.append((len(frames), list(prompts), list(cuts)))
        return [[find("cast", "A", A_MASK), find("prop", "knife", KNIFE), find("blood", "blood", BLOOD, 0.8)]
                for _ in range(len(frames))]


class FakeHands:
    def __init__(self):
        self.calls = 0

    def hands(self, frame):
        self.calls += 1
        return [A_HAND]


class FakeDrawer:
    """Outlines each figure in its colour; every figure gets a face."""

    def __init__(self):
        self.drawn = 0
        self.resets: list[int] = []

    def reset(self) -> None:
        self.resets.append(self.drawn)

    def draw(self, frame, figures) -> Drawn:
        canvas = np.zeros((DRAW_H, DRAW_W), np.uint8)
        for f in figures:
            trace(canvas, f.mask, f.colour, Outline())
        self.drawn += 1
        return Drawn(canvas, {f.id for f in figures})
