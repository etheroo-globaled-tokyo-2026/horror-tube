"""V7Drawer on one real frame with a hand-drawn figure mask."""
import cv2
import numpy as np
import pytest

from rotoscope.draw.face_kit import WHITE
from rotoscope.types import ANALYSIS_H, ANALYSIS_W, DRAW_H, DRAW_W, Figure

pytestmark = pytest.mark.slow
FRAME = 10                  # the woman on the right faces the camera
COLOUR = 12


def woman() -> np.ndarray:
    """A rough outline of the woman on the right, drawn by hand at 640x360: head and body."""
    m = np.zeros((ANALYSIS_H, ANALYSIS_W), np.uint8)
    cv2.ellipse(m, (405, 95), (42, 58), 0, 0, 360, 1, -1)
    cv2.fillPoly(m, [np.array([(335, 150), (475, 150), (515, 330), (312, 330)], np.int32)], 1)
    return m > 0


def test_a_frontal_face_is_drawn_in_the_figures_colour(drawer, staged_frames):
    frame, fig = np.asarray(staged_frames[FRAME]), Figure("B", woman(), COLOUR)
    drawer.reset()
    drawn = [drawer.draw(frame, [fig]) for _ in range(3)]
    for d in drawn:
        assert d.canvas.shape == (DRAW_H, DRAW_W) and d.canvas.dtype == np.uint8
        assert set(np.unique(d.canvas)) <= {0, COLOUR, WHITE}
    assert (drawn[-1].canvas == COLOUR).sum() > 100, "the figure's outline and face are drawn in its colour"
    assert (drawn[-1].canvas == WHITE).any(), "an open eye gets a white pupil"
    assert drawn[0].faces == set(), "a face is drawn only once it has been seen for 2 frames"
    assert drawn[-1].faces == {"B"}
    drawer.reset()
    assert drawer.draw(frame, [fig]).faces == set(), "after a reset, face tracks start again"
    empty = drawer.draw(frame, [])
    assert not empty.canvas.any() and empty.faces == set()


def test_the_apps_colour_is_refused(drawer, staged_frames):
    with pytest.raises(ValueError, match="colour 15"):
        drawer.draw(np.asarray(staged_frames[FRAME]), [Figure("B", woman(), 15)])
