"""Who each face belongs to, and its smoothed track.

Every face goes to the figure whose mask holds its nose (a bare box: its centre), or the nearest figure within 25 px.
A mask holding several faces (people who touch, merged into one mask) keeps its figure's id for its biggest face; each
other face gets an id of its own, drawn in the mask's colour, so every face is drawn and the merge still shows."""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from rotoscope.draw.face_boxes import FaceBox
from rotoscope.draw.holds import OneEuro
from rotoscope.draw.lines import OVAL
from rotoscope.draw.mediapipe_models import Mesh
from rotoscope.types import ANALYSIS_H as MH
from rotoscope.types import ANALYSIS_W as MW
from rotoscope.types import DRAW_H, DRAW_W

PROFILE_YAW = 50          # a box with no mesh turned further than this, in degrees, gets a profile mark
NEAR_PX = 25              # a face outside every mask goes to the nearest one within this many 640x360 px
LOST_FRAMES = 2           # a face the finders lose keeps drawing this many frames
# the mouth's points react faster than the rest of the face
_MOUTH = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308,
          61, 291, 84, 17, 314]
_SCALE = np.array([DRAW_W, DRAW_H], np.float32)


@dataclass
class FaceTrack:
    id: int
    filt: OneEuro
    host: int                  # the figure whose mask holds it
    raw: Mesh | None = None    # this frame's mesh; None while the face is lost
    sm: np.ndarray | None = None   # smoothed points (478, 2), normalised to the frame
    lost: int = 0


@dataclass
class BareFace:
    face: FaceBox
    host: int
    lost: int = 0


def _width(f: Mesh) -> float:
    return float(np.hypot(*(f.pts[454, :2] - f.pts[234, :2])))


class Seats:
    def __init__(self, fps: float):
        self.fps = fps
        self.tracks: dict[int, FaceTrack] = {}
        self.bare: dict[int, BareFace] = {}

    def step(self, persons: list[np.ndarray], ids: list[int], faces: list[Mesh], backup: list[Mesh],
             bare: list[FaceBox]):
        """persons: the figures' masks with their ids; faces: the face finder's boxes that got a mesh; backup: v7's
        own face search; bare: boxes with no mesh. Returns (id map at 640x360, face tracks, heads as (face id, x, y,
        radius) normalised to the frame, face id -> host figure id)."""
        pmap = np.full((MH, MW), -1, np.int32)
        for i in sorted(range(len(persons)), key=lambda i: -int(persons[i].sum())):
            pmap[persons[i]] = ids[i]
        near = [cv2.distanceTransform((~m).astype(np.uint8), cv2.DIST_L2, 3) for m in persons]

        def where(px, py):
            x, y = int(np.clip(px * MW, 0, MW - 1)), int(np.clip(py * MH, 0, MH - 1))
            pid = int(pmap[y, x])
            if pid < 0 and near:
                d = [n_[y, x] for n_ in near]
                pid = ids[int(np.argmin(d))] if min(d) <= NEAR_PX else -1
            return pid
        # One source per figure, in a fixed order, so a face id doesn't flip between sources from frame to frame (a
        # face is drawn only once it has been seen for 2 frames): the finder's faces with a mesh; else v7's own
        # faces; else a bare box turned far enough for a profile mark.
        hosted: dict[int, list] = {}
        for f in faces:
            pid = where(*f.pts[1, :2])
            if pid >= 0:
                hosted.setdefault(pid, []).append((f, _width(f)))
        vision = set(hosted)
        for f in backup:
            pid = where(*f.pts[1, :2])
            if pid >= 0 and pid not in vision:
                hosted.setdefault(pid, []).append((f, _width(f)))
        for b in bare:
            x0, y0, x1, y1 = b.box
            pid = where((x0 + x1) / 2, (y0 + y1) / 2)
            if pid >= 0 and pid not in hosted and abs(b.yaw) > PROFILE_YAW:
                hosted.setdefault(pid, []).append((b, x1 - x0))
        got = {}
        for pid, fs in hosted.items():
            for rank, (f, _) in enumerate(sorted(fs, key=lambda fw: -fw[1])):
                got[pid if rank == 0 else 10 * (pid + 1) + rank] = (f, pid)
        for fid in list(self.bare):
            b = self.bare[fid]
            b.lost += 1
            if fid in got or b.lost > LOST_FRAMES or b.host not in ids:
                del self.bare[fid]
        for fid, (f, pid) in list(got.items()):
            if isinstance(f, FaceBox):
                self.bare[fid] = BareFace(f, pid)
                del got[fid]
        for fid, (f, pid) in got.items():
            t = self.tracks.get(fid)
            if t is None:
                mc = np.full((478, 2), 1.0, np.float32)
                mc[_MOUTH] = 3.0
                t = self.tracks[fid] = FaceTrack(fid, OneEuro(self.fps, mc, 0.08), pid)
            t.raw, t.lost, t.host = f, 0, pid
            t.sm = t.filt(f.pts[:, :2] * _SCALE) / _SCALE
        for fid in list(self.tracks):
            if fid not in got:
                t = self.tracks[fid]
                t.lost += 1
                t.raw = None
                if t.lost > LOST_FRAMES or t.host not in ids:
                    del self.tracks[fid]
        tracks = list(self.tracks.values())
        heads = [(t.id, float(t.sm[OVAL, 0].mean()), float(t.sm[OVAL, 1].mean()),
                  max(float(abs(t.sm[454, 0] - t.sm[234, 0])) / 2, 0.01)) for t in tracks]
        host = {fid: b.host for fid, b in self.bare.items()}
        host.update({t.id: t.host for t in tracks})
        return pmap, tracks, heads, host
