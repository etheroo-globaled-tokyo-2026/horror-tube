"""V7Drawer: each figure drawn the way v7 draws people, on the figure masks the core gives it.

Per frame: the figures' outlines back to front as smooth 1 px curves (each held still while it barely moves), the
line where two figures touch, clothing lines inside each figure (SCHP), hair (MediaPipe's classes), and a face kit for
every face (the face finder's boxes, MediaPipe's meshes). All in the figure's palette colour; pupils and teeth white.
Every model runs on the GPU or the Neural Engine."""
from __future__ import annotations

from pathlib import Path
from typing import Sequence

import cv2
import numpy as np

from rotoscope.draw.analysis import box_meshes, class_scores, search_faces
from rotoscope.draw.clothing import CLOTHES, Parser, inner_strokes
from rotoscope.draw.face_boxes import FaceFinder
from rotoscope.draw.face_kit import FaceKits, profile_marks
from rotoscope.draw.hair import Hair
from rotoscope.draw.holds import StrokeHold
from rotoscope.draw.lines import CROSS, nearest_values, oval_mask, remove_small, thin, trace
from rotoscope.draw.mediapipe_models import HAIR, ClassSegmenter, FaceMesher
from rotoscope.draw.seats import Seats
from rotoscope.types import ANALYSIS_H as MH
from rotoscope.types import ANALYSIS_W as MW
from rotoscope.types import DRAW_H, DRAW_W, Drawn, Figure

CAST = "ABCD"
APP_ONLY = 15               # palette index the app keeps for itself; never drawn
MIN_LINE = max(6.0, DRAW_W / 32)     # outline curves shorter than this (drawing px) are dropped
STEADY_MOVED = 0.15         # the outline is held when under this share of its pixels moved more than 1.5 px
STEADY_FRAMES = 2           # ...for at most this many frames running


class V7Drawer:
    """A PeopleDrawer. `face_finder` gives the face boxes (backends.apple_vision.AppleVision on the Mac);
    `models_dir` holds MediaPipe's model files (downloaded on first use)."""

    def __init__(self, face_finder: FaceFinder, models_dir: Path, fps: float = 15):
        self.face_finder = face_finder
        self.fps = fps
        self.classes = ClassSegmenter(models_dir)
        self.mesher = FaceMesher(models_dir)
        self.parser = Parser()
        self.hold = StrokeHold(1.5)
        self.hair = Hair(self.hold)
        self.kits = FaceKits(self.hold)
        self.reset()

    def reset(self) -> None:
        self.seats = Seats(self.fps)
        self.parse_prev = self.prev_fig = self.prev_lines = None
        self.steady = 0
        self.hold.reset()
        self.hair.reset()
        self.kits.reset()

    def draw(self, frame: np.ndarray, figures: Sequence[Figure]) -> Drawn:
        _check(frame, figures)
        ids = [CAST.index(f.id) for f in figures]
        persons = [f.mask for f in figures]
        fig = np.zeros((MH, MW), bool)
        for m in persons:
            fig |= m
        probs = class_scores(self.classes, frame, fig)
        meshes, bare, backup = [], [], []
        if figures:                  # a face with no figure to hold it is never drawn
            backup = search_faces(self.mesher, frame, probs.argmax(0), fig)
            meshes, bare = box_meshes(self.mesher, self.face_finder.faces(frame), frame)
        pmap, tracks, heads, host = self.seats.step(persons, ids, meshes, backup, bare)
        pp = self.parser(frame, pmap)
        pp = pp if self.parse_prev is None else 0.35 * pp + 0.65 * self.parse_prev
        self.parse_prev = pp
        img, kits = self._render(frame, fig, probs, pmap, tracks, heads, pp.argmax(0))
        marked = profile_marks(img, self.seats.bare, kits, fig)
        cast = dict(zip(ids, (f.id for f in figures)))
        colour = dict(zip(ids, (f.colour for f in figures)))
        return Drawn(canvas=_colourise(img, host, colour), faces={cast[host[i]] for i in kits | marked if i in host})

    def _render(self, src, fig_mask, probs, pmap, tracks, heads, parse) -> tuple[np.ndarray, set[int]]:
        """The label canvas (1000 + figure or face id for a line, WHITE, 0) and the face ids with a kit drawn."""
        W, H = DRAW_W, DRAW_H
        # the figures' mask, smoothed in space and time; every figure pixel takes the nearest figure's id, and the
        # pixels of a face's oval its face's id
        a = cv2.GaussianBlur(fig_mask.astype(np.float32), (0, 0), 1.5)
        if self.prev_fig is not None:
            a = 0.5 * a + 0.5 * self.prev_fig
        self.prev_fig = a
        fig = a >= 0.5
        lab = np.where(fig, pmap, -1)
        if (fig & (lab < 0)).any() and (lab >= 0).any():
            lab = np.where(fig & (lab < 0), nearest_values(lab, lab >= 0), lab)
        for t in tracks:
            lab[oval_mask(t.sm, MW, MH) & fig] = t.id
        hm = self.hair.mask(probs[HAIR], fig)
        # outlines, back (smallest) to front, each hidden where a figure in front covers it
        lines = np.zeros((H, W), np.int32)
        area = {p: int((lab == p).sum()) for p in (int(v) for v in np.unique(lab[lab >= 0]))}
        order = sorted(area, key=lambda p: area[p])
        regions = {p: cv2.GaussianBlur((lab == p).astype(np.float32), (0, 0), 1.2) >= 0.5 for p in order}
        small = {p: cv2.resize(regions[p].astype(np.float32), (W, H), interpolation=cv2.INTER_AREA) >= 0.5
                 for p in order}
        for k, p in enumerate(order):
            line = trace(regions[p], W, H, MIN_LINE)
            for q in order[k + 1:]:
                line &= ~(cv2.dilate(small[q].astype(np.uint8), CROSS) > 0)
            (held,) = self.hold(("outline", p), [remove_small(line, int(MIN_LINE))])
            lines[held[0]] = 1000 + p
        # where two figures touch, the line between them, on the side of the one in front
        labt = cv2.resize(lab.astype(np.float32), (W, H), interpolation=cv2.INTER_NEAREST).astype(np.int32)
        if len(order) > 1:
            rank = np.full(max(order) + 1, -1, np.int32)
            rank[order] = np.arange(len(order))
            r = np.where(labt >= 0, rank[np.clip(labt, 0, None)], -1)
            bnd = np.zeros((H, W), bool)
            for dy, dx in ((0, 1), (1, 0), (0, -1), (-1, 0)):
                nb = np.roll(np.roll(labt, -dy, 0), -dx, 1)
                nr = np.roll(np.roll(r, -dy, 0), -dx, 1)
                bnd |= (labt >= 0) & (nb >= 0) & (nb != labt) & (r > nr)
            bnd = remove_small(thin(bnd), 3)
            lines[bnd] = 1000 + labt[bnd]
        inner = inner_strokes(parse, regions, small, order, self.hold, W, H)
        lines = self._steady(lines)
        canvas = lines.copy()
        free = (inner > 0) & (canvas == 0)
        canvas[free] = inner[free]
        figt = cv2.resize(fig.astype(np.uint8), (W, H), interpolation=cv2.INTER_NEAREST) > 0
        interior = cv2.erode(figt.astype(np.uint8), CROSS) > 0
        hair_t = self.hair.draw(canvas, hm, regions, order, tracks, heads, figt)
        clothes_t = cv2.resize(np.isin(parse, CLOTHES).astype(np.uint8), (W, H), interpolation=cv2.INTER_NEAREST) > 0
        kits = self.kits.draw(canvas, tracks, heads, figt, interior, hair_t, lines > 0, clothes_t, hm, regions, order)
        return canvas, kits

    def _steady(self, lines: np.ndarray) -> np.ndarray:
        """When the outlines barely moved since the last frame, the last frame's pixels, coloured by the nearest
        current line, for at most STEADY_FRAMES frames running; otherwise this frame's."""
        new = lines > 0
        if self.prev_lines is not None and new.any() and self.steady < STEADY_FRAMES:
            prev = self.prev_lines > 0
            dist = cv2.distanceTransform((~prev).astype(np.uint8), cv2.DIST_L2, 3)
            moved = float((dist[new] > 1.5).mean())
            gone = float((cv2.distanceTransform((~new).astype(np.uint8), cv2.DIST_L2, 3)[prev] > 1.5).mean()) \
                if prev.any() else 1.0
            if moved < STEADY_MOVED and gone < STEADY_MOVED:
                lines = np.where(prev, nearest_values(lines, new), 0)
                self.steady += 1
            else:
                self.steady = 0
        else:
            self.steady = 0
        self.prev_lines = lines.copy()
        return lines


def _check(frame: np.ndarray, figures: Sequence[Figure]) -> None:
    if frame.dtype != np.uint8 or frame.ndim != 3 or frame.shape[2] != 3:
        raise ValueError(f"frame must be RGB uint8 (h, w, 3), got {frame.dtype} {frame.shape}")
    seen = set()
    for f in figures:
        if f.id not in CAST:
            raise ValueError(f"figure id {f.id!r} is not a cast id ({', '.join(CAST)})")
        if f.id in seen:
            raise ValueError(f"figure {f.id} appears twice in one frame")
        seen.add(f.id)
        if f.mask.shape != (MH, MW) or f.mask.dtype != bool:
            raise ValueError(f"figure {f.id}: mask must be bool ({MH}, {MW}), got {f.mask.dtype} {f.mask.shape}")
        if not 0 < f.colour < APP_ONLY:
            raise ValueError(f"figure {f.id}: colour {f.colour} is not a drawing colour (1-{APP_ONLY - 1})")


def _colourise(img: np.ndarray, host: dict[int, int], colour: dict[int, int]) -> np.ndarray:
    """The label canvas in palette indices: 1000 + id is a line in its figure's colour; a face with an id of its own
    takes the colour of the figure whose mask holds it."""
    out = np.where(img < 1000, img, 0).astype(np.uint8)
    for v in np.unique(img[img >= 1000]):
        owner = host.get(int(v) - 1000, int(v) - 1000)
        if owner not in colour:
            raise RuntimeError(f"line label {int(v) - 1000} belongs to no figure in this frame (owner {owner})")
        out[img == v] = colour[owner]
    return out
