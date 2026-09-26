"""Who each face belongs to: two faces in one figure's mask, a turned face with no mesh, and faces that go missing."""
import numpy as np

from rotoscope.draw.face_boxes import FaceBox
from rotoscope.draw.mediapipe_models import Mesh
from rotoscope.draw.seats import LOST_FRAMES, Seats
from rotoscope.types import ANALYSIS_H, ANALYSIS_W


def figure(x0: int, x1: int) -> np.ndarray:
    m = np.zeros((ANALYSIS_H, ANALYSIS_W), bool)
    m[40:360, x0:x1] = True
    return m


def mesh(cx: float, cy: float, w: float) -> Mesh:
    """A face centred at (cx, cy), w wide, normalised to the frame."""
    pts = np.zeros((478, 3), np.float32)
    pts[:, 0], pts[:, 1] = cx, cy
    pts[234, 0], pts[454, 0] = cx - w / 2, cx + w / 2
    return Mesh(pts, 0.0, 0.0, None)


def test_faces_go_to_the_figure_holding_them():
    seats = Seats(15)
    persons, ids = [figure(0, 300), figure(340, 640)], [0, 1]
    turned = FaceBox((0.7, 0.2, 0.8, 0.35), 0.9, 70.0, 0.0)
    frontal = FaceBox((0.6, 0.2, 0.7, 0.35), 0.9, 10.0, 0.0)
    _, tracks, heads, host = seats.step(persons, ids, [mesh(0.1, 0.3, 0.05), mesh(0.3, 0.3, 0.1)], [],
                                        [frontal, turned])
    big = next(t for t in tracks if t.host == 0 and np.isclose(t.sm[1, 0], 0.3))
    small = next(t for t in tracks if t.host == 0 and t is not big)
    assert big.id == 0 and small.id != 0, "the figure's id goes to its biggest face; the other gets its own"
    assert host[small.id] == 0 and len(heads) == 2
    assert [(fid, b.face) for fid, b in seats.bare.items()] == [(1, turned)], \
        "a face with no mesh is kept only when turned, for a profile mark"
    for n in range(1, LOST_FRAMES + 2):
        _, tracks, _, host = seats.step(persons, ids, [], [], [])
        if n <= LOST_FRAMES:
            assert {t.id for t in tracks} == {big.id, small.id} and all(t.raw is None for t in tracks)
    assert tracks == [] and host == {}, "a face lost for longer is dropped"
