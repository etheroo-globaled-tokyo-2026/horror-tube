"""Blood: SAM's blood finds, each in the palette colour of its own median hue (red, or green for acid blood), drawn
as speckle. Blood that a light find outscores on the same pixels is the light, not blood."""
from dataclasses import dataclass
from typing import Sequence

import cv2
import numpy as np

from rotoscope.config import Gore
from rotoscope.palette import BLOOD_GREEN, BLOOD_RED
from rotoscope.types import DRAW_H, DRAW_W, Find


@dataclass(frozen=True)
class Blood:
    mask: np.ndarray        # bool (ANALYSIS_H, ANALYSIS_W)
    colour: int             # palette index


def blood(finds: Sequence[Find], frame: np.ndarray, cfg: Gore) -> list[Blood]:
    """A frame's blood patches. frame: RGB uint8 at the masks' size. Only the finder's own finds count: a tracker
    fill-in has no score of its own to weigh against a light."""
    hue = cv2.cvtColor(frame, cv2.COLOR_RGB2HSV)[..., 0]
    lights = [f for f in finds if f.kind == "light" and not f.fill and f.score >= cfg.min_score]
    lo, hi = cfg.green_hue
    out = []
    for f in finds:
        if f.kind != "blood" or f.fill or f.score < cfg.min_score:
            continue
        area = int(f.mask.sum())
        if area < cfg.min_px:
            continue
        if any(li.score > f.score and (f.mask & li.mask).sum() >= cfg.light_cover * area for li in lights):
            continue
        h = float(np.median(hue[f.mask]))
        out.append(Blood(f.mask, BLOOD_GREEN if lo <= h <= hi else BLOOD_RED))
    return out


def speckle(patches: Sequence[Blood], cfg: Gore) -> np.ndarray:
    """The blood layer at the drawing's size, 0 where there's none: each patch's outline, plus the pixels inside it
    where (x + 2y) % cfg.speckle == 0."""
    layer = np.zeros((DRAW_H, DRAW_W), np.uint8)
    for b in patches:
        small = cv2.resize(b.mask.astype(np.uint8), (DRAW_W, DRAW_H), interpolation=cv2.INTER_AREA) > 0
        cs, _ = cv2.findContours(small.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        cv2.drawContours(layer, cs, -1, int(b.colour), 1)
        ys, xs = np.nonzero(small)
        dots = (xs + 2 * ys) % cfg.speckle == 0
        layer[ys[dots], xs[dots]] = b.colour
    return layer
