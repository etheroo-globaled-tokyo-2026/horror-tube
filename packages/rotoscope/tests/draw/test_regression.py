"""Drawing the staged clip from the figure masks research drew it from should give research's v7 drawing: lines
within 1 px of research's, and faces drawn in the same frames.

Inputs from the research checkout: the clip's frames; staged__sam31_track_people.npz, the figure masks and cast index
per frame that research's v7 drawing was made from; and staged__sam31_track.npz, that drawing (frames, plus the cast
ids with a face drawn per frame as JSON)."""
import json

import cv2
import numpy as np
import pytest

from rotoscope.palette import CAST
from rotoscope.types import ANALYSIS_W, Figure

from draw_media import V7, media

pytestmark = pytest.mark.slow
PEOPLE, DRAWING = V7 / "staged__sam31_track_people.npz", V7 / "staged__sam31_track.npz"
NEAR = np.ones((3, 3), np.uint8)


def near_share(a: np.ndarray, b: np.ndarray) -> tuple[int, int]:
    """(pixels of a within 1 px of a pixel of b, pixels of a)."""
    return int((a & (cv2.dilate(b.astype(np.uint8), NEAR) > 0)).sum()), int(a.sum())


def test_staged_clip_matches_research(drawer, staged_frames):
    media(PEOPLE, DRAWING)
    people, ref = np.load(PEOPLE), np.load(DRAWING)
    masks = np.unpackbits(people["masks"], axis=-1, count=ANALYSIS_W).astype(bool)
    ref_faces = json.loads(str(ref["faces"]))
    starts = {0, *people["cuts"].tolist()}
    got = {"lines": [0, 0], "research lines": [0, 0], "same colour": [0, 0]}
    faces_same = 0
    for k in range(len(staged_frames)):
        if k in starts:
            drawer.reset()
        figures = [Figure("ABCD"[i], m, CAST["ABCD"[i]])
                   for m, i in zip(masks[people["frame"] == k], people["ids"][people["frame"] == k])]
        drawn = drawer.draw(np.asarray(staged_frames[k]), figures)
        ours, theirs = drawn.canvas, ref["frames"][k]
        for key, (a, b) in (("lines", (ours > 0, theirs > 0)), ("research lines", (theirs > 0, ours > 0))):
            n, d = near_share(a, b)
            got[key][0] += n
            got[key][1] += d
        for c in set(np.unique(theirs)) - {0}:
            n, d = near_share(theirs == c, ours == c)
            got["same colour"][0] += n
            got["same colour"][1] += d
        faces_same += sorted(drawn.faces) == ref_faces[k]
    share = {k: n / d for k, (n, d) in got.items()}
    print(f"\nwithin 1 px of research: our lines {share['lines']:.1%}, research's lines {share['research lines']:.1%}, "
          f"research's lines in the same colour {share['same colour']:.1%}; "
          f"faces as research in {faces_same}/{len(staged_frames)} frames")
    # the floors leave room for GPU and OS differences between machines; a drawing 2 px off scores well under them
    assert share["lines"] >= 0.95 and share["research lines"] >= 0.95 and share["same colour"] >= 0.95
    assert faces_same >= 0.9 * len(staged_frames)
