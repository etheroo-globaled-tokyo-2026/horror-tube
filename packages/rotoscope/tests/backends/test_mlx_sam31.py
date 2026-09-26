"""SAM 3.1 finds the cast, blood and lights, tracks the cast into the next frame, and ends every track at a cut."""
import numpy as np
import pytest

from rotoscope.types import ANALYSIS_H, ANALYSIS_W, Prompt

pytest.importorskip("mlx_vlm")
from rotoscope.backends.mlx_sam31 import FLOOR, MlxSam31  # noqa: E402

pytestmark = pytest.mark.slow
PROMPTS = [Prompt("cast", "A", "man in a red and green striped sweater"), Prompt("cast", "B", "black alien creature"),
           Prompt("blood", "blood", "blood"), Prompt("blood", "green blood", "green blood"),
           Prompt("light", "light", "light"), Prompt("hand", "hand", "hand")]


def test_finds_tracks_and_cuts(gore_frames):
    per = MlxSam31().find(gore_frames, PROMPTS, cuts=[2])
    assert len(per) == len(gore_frames)
    for finds in per:
        for f in finds:
            assert f.mask.dtype == bool and f.mask.shape == (ANALYSIS_H, ANALYSIS_W)
            ys, xs = np.nonzero(f.mask)
            assert f.box == (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
            if f.kind not in ("cast", "prop"):
                assert f.track is None and not f.fill and f.score >= FLOOR[f.kind]
        for key in ("A", "B"):
            assert max((f.score for f in finds if f.kind == "cast" and f.key == key), default=0) >= 0.5, \
                f"cast {key} found"
    assert any(f.kind == "blood" for finds in per for f in finds)
    started = {f.track for f in per[1] if f.kind == "cast"}
    assert started - {None}, "the cast found in the first frame is tracked into the second"
    assert all(f.track is None for f in per[2]), "no track carries across the cut"
