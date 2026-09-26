"""Hair: MediaPipe's hair score averaged over time with enter and stay thresholds, drawn as a solid fill on heads of
16 px or more, else an outline and a few strands. Hair stops at the brows: nothing below them inside a face."""
from __future__ import annotations

import cv2
import numpy as np

from rotoscope.draw.face_kit import BROW_POINTS
from rotoscope.draw.holds import StrokeHold
from rotoscope.draw.lines import CROSS, chaikin, oval_mask
from rotoscope.draw.seats import FaceTrack
from rotoscope.types import ANALYSIS_H as MH
from rotoscope.types import ANALYSIS_W as MW

ENTER, STAY = 0.5, 0.35


class Hair:
    def __init__(self, hold: StrokeHold):
        self.hold = hold
        self.reset()

    def reset(self) -> None:
        self.prev_score = self.prev_mask = None

    def mask(self, score: np.ndarray, fig: np.ndarray) -> np.ndarray:
        """This frame's hair at 640x360 from the hair class score."""
        hp = score if self.prev_score is None else 0.4 * score + 0.6 * self.prev_score
        self.prev_score = hp
        hm = hp >= ENTER
        if self.prev_mask is not None:
            hm |= self.prev_mask & (hp >= STAY)
        hm &= fig
        self.prev_mask = hm
        return hm

    def draw(self, canvas: np.ndarray, hm: np.ndarray, regions: dict, order: list[int], tracks: list[FaceTrack],
             heads: list, figt: np.ndarray) -> np.ndarray:
        """Draws each figure's hair onto the label canvas; returns where a solid fill went, at the drawing's size."""
        H, W = canvas.shape
        head_px = {t.id: 1.3 * float(np.hypot((t.sm[10, 0] - t.sm[152, 0]) * W, (t.sm[10, 1] - t.sm[152, 1]) * H))
                   for t in tracks}
        for h in heads:
            head_px.setdefault(h[0], 2.6 * h[3] * W)
        no_hair = np.zeros((MH, MW), bool)
        for t in tracks:
            if t.raw is None:
                continue
            brow_y = float(np.mean([t.sm[i, 1] for i in BROW_POINTS])) * MH
            no_hair |= oval_mask(t.sm, MW, MH) & (np.arange(MH)[:, None] > brow_y - 2)
        filled = np.zeros((H, W), bool)
        for p in order:
            hair = cv2.GaussianBlur((hm & regions[p] & ~no_hair).astype(np.float32), (0, 0), 2.0) >= 0.5
            if hair.sum() < 120:
                continue
            ys, _ = np.nonzero(hair)
            hh = head_px.get(p, 1.6 * (ys.max() - ys.min()) * H / MH)
            cs, hier = cv2.findContours(hair.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
            polys, holes = [], []
            for c, hr in zip(cs, hier[0]):
                if abs(cv2.contourArea(c)) < 120:
                    continue
                ap = cv2.approxPolyDP(c, 1.5, True)[:, 0].astype(np.float32)
                if len(ap) < 3:
                    continue
                pts = (chaikin(ap, 2) + 0.5) * np.array([W / MW, H / MH], np.float32) - 0.5
                (holes if hr[3] >= 0 else polys).append(np.round(pts * 16).astype(np.int32))
            if not polys:
                continue
            layer = np.zeros((H, W), np.uint8)
            if hh >= 16:
                cv2.fillPoly(layer, polys, 1, cv2.LINE_8, 4)
                if holes:
                    cv2.fillPoly(layer, holes, 0, cv2.LINE_8, 4)
                    cv2.polylines(layer, holes, True, 1, 1, cv2.LINE_8, 4)
                fill = (layer > 0) & figt
                edge = fill & ~(cv2.erode(fill.astype(np.uint8), CROSS) > 0)
                (held,) = self.hold(("hair", p), [(edge, fill)])     # the shape holds unless its edge moves
                fill = held[1] if held[1] is not None else fill
                canvas[fill] = 1000 + p
                filled |= fill
            else:
                cv2.polylines(layer, polys, True, 1, 1, cv2.LINE_8, 4)
                ht = cv2.resize(hair.astype(np.float32), (W, H), interpolation=cv2.INTER_AREA) >= 0.5
                yy, xx = np.nonzero(ht)
                if len(xx):
                    for fx in (0.3, 0.55, 0.8)[: 3 if hh >= 10 else 2]:
                        x0 = int(round(xx.min() + fx * (xx.max() - xx.min())))
                        col = np.nonzero(ht[:, x0])[0]
                        if len(col) >= 3:
                            y0, y1 = col.min() + 1, col.min() + max(2, int(0.6 * (col.max() - col.min())))
                            cv2.line(layer, (x0, int(y0)), (x0 - 1, int(y1)), 1, 1, cv2.LINE_8)
                canvas[(layer > 0) & figt & (canvas == 0)] = 1000 + p
        return filled
