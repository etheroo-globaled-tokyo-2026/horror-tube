"""Apple Vision's hands and faces, in the frame's coordinates."""
import pytest

from rotoscope.types import ANALYSIS_H, ANALYSIS_W

pytest.importorskip("Vision")
from rotoscope.backends.apple_vision import AppleVision  # noqa: E402

pytestmark = pytest.mark.slow


def test_hands_and_faces(gore_frames):
    av = AppleVision()
    hands = [av.hands(f) for f in gore_frames]
    faces = [av.faces(f) for f in gore_frames]
    joints = [j for per in hands for hand in per for j in hand]
    assert joints, "Freddy's hands or wrists are found"
    assert all(0 <= x <= ANALYSIS_W and 0 <= y <= ANALYSIS_H for x, y in joints)
    boxes = [f for per in faces for f in per]
    assert boxes, "Freddy's face is found"
    for f in boxes:
        x0, y0, x1, y1 = f.box
        assert 0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1
        assert (x0 + x1) / 2 < 0.5, "the face is Freddy's, on the left"
    for per in faces:
        assert [f.box[2] - f.box[0] for f in per] == sorted((f.box[2] - f.box[0] for f in per), reverse=True)
