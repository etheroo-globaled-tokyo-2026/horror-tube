"""One finished frame: the people drawing, blood under its lines, and each prop outlined on top."""
from typing import Sequence

import cv2
import numpy as np

from rotoscope.config import Config, Outline
from rotoscope.gore import Blood, speckle
from rotoscope.palette import BACKGROUND, CAST, LOOSE, check
from rotoscope.rules import Scene
from rotoscope.types import DRAW_H, DRAW_W


def trace(canvas: np.ndarray, mask: np.ndarray, colour: int, cfg: Outline) -> None:
    """A mask's 1 px outline on the drawing. The contour is found at 4x the drawing's size and simplified there, so
    the line steps cleanly between the drawing's pixels."""
    small = cv2.resize(mask.astype(np.float32), (DRAW_W, DRAW_H), interpolation=cv2.INTER_AREA) >= 0.5
    big = cv2.resize(small.astype(np.uint8), (DRAW_W * 4, DRAW_H * 4), interpolation=cv2.INTER_NEAREST)
    cs, _ = cv2.findContours(big, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    for c in cs:
        if cv2.arcLength(c, True) < cfg.min_length:
            continue
        c = cv2.approxPolyDP(c, cfg.epsilon, True).astype(np.float32) / 4
        cv2.polylines(canvas, [np.round(c).astype(np.int32)], True, int(colour), 1, cv2.LINE_8)


def props_of(scene: Scene) -> list[tuple[np.ndarray, int]]:
    """Each prop's mask and line colour: its holder's, or grey when loose."""
    out = []
    for i, p in enumerate(scene.props):
        who = scene.holder(i)
        out.append((p.mask, CAST[who] if who is not None else LOOSE))
    return out


def compose(canvas: np.ndarray, props: Sequence[tuple[np.ndarray, int]], blood: Sequence[Blood],
            cfg: Config) -> np.ndarray:
    """The drawer's canvas with blood where it has no line and the props outlined over everything. Raises if the
    result holds an index a film frame can't."""
    if canvas.shape != (DRAW_H, DRAW_W) or canvas.dtype != np.uint8:
        raise ValueError(f"the people drawing is {canvas.dtype} {canvas.shape}, not uint8 ({DRAW_H}, {DRAW_W})")
    out = canvas.copy()
    layer = speckle(blood, cfg.gore)
    under = (layer > 0) & (out == BACKGROUND)
    out[under] = layer[under]
    for mask, colour in props:
        trace(out, mask, colour, cfg.outline)
    check(out)
    return out
