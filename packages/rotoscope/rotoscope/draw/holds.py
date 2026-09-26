"""What keeps the drawing steady from frame to frame: stroke hysteresis, a held discrete state, landmark smoothing."""
from __future__ import annotations

import cv2
import numpy as np


class StrokeHold:
    """A new stroke is replaced by the matching stroke of the last frame when the two lie within `thr` px of each
    other (mean distance both ways), so a still line keeps its pixels. Strokes are masks, or (mask, extra) pairs whose
    extra mask is held along with them."""

    def __init__(self, thr: float = 1.5):
        self.thr = thr
        self.prev: dict = {}

    @staticmethod
    def dist(a: np.ndarray, b: np.ndarray) -> float:
        if not a.any() or not b.any():
            return 1e9
        da = cv2.distanceTransform((~a).astype(np.uint8), cv2.DIST_L2, 3)
        db = cv2.distanceTransform((~b).astype(np.uint8), cv2.DIST_L2, 3)
        return max(float(db[a].mean()), float(da[b].mean()))

    def __call__(self, key, strokes) -> list[tuple[np.ndarray, np.ndarray | None]]:
        prev, out, used = self.prev.get(key, []), [], set()
        for s in strokes:
            best, bd = None, self.thr
            for j, (pm, _) in enumerate(prev):
                if j in used:
                    continue
                d = self.dist(s[0] if isinstance(s, tuple) else s, pm)
                if d <= bd:
                    best, bd = j, d
            if best is not None:
                used.add(best)
                out.append(prev[best])
            else:
                out.append(s if isinstance(s, tuple) else (s, None))
        self.prev[key] = out
        return out

    def reset(self) -> None:
        self.prev = {}


class Sticky:
    """Holds a discrete state until a different one has been seen `hold` frames running."""

    def __init__(self, hold: int):
        self.hold, self.cur, self.cand, self.n = hold, None, None, 0

    def __call__(self, raw):
        if self.cur is None or raw == self.cur:
            self.cur, self.cand, self.n = raw, None, 0
        elif raw == self.cand:
            self.n += 1
            if self.n >= self.hold:
                self.cur, self.cand, self.n = raw, None, 0
        else:
            self.cand, self.n = raw, 1
            if self.hold <= 1:
                self.cur, self.cand, self.n = raw, None, 0
        return self.cur


class OneEuro:
    """The One Euro filter (Casiez et al.): smooths hard when points move slowly, follows closely when they move
    fast."""

    def __init__(self, fps: float, min_cut, beta: float, d_cut: float = 1.0):
        self.fps, self.min_cut, self.beta, self.d_cut = fps, np.asarray(min_cut, np.float32), beta, d_cut
        self.x = self.dx = None

    def _a(self, cut):
        tau = 1.0 / (2 * np.pi * cut)
        return 1.0 / (1.0 + tau * self.fps)

    def __call__(self, x: np.ndarray) -> np.ndarray:
        if self.x is None:
            self.x, self.dx = x.copy(), np.zeros_like(x)
            return x
        dx = (x - self.x) * self.fps
        self.dx = self.dx + self._a(self.d_cut) * (dx - self.dx)
        cut = self.min_cut + self.beta * np.abs(self.dx)
        self.x = self.x + self._a(cut) * (x - self.x)
        return self.x
