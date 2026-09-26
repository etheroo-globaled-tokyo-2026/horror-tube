import json

import numpy as np
import pytest
from kit import FakeDrawer, FakeHands, FakeSegmenter, fight_frames, write_clip

from rotoscope import pipeline, shots
from rotoscope.config import Config
from rotoscope.palette import BLOOD_RED, CAST, LOOSE


def shot_list(holder: str) -> shots.ShotList:
    return shots.parse(json.dumps({"shots": [
        {"start_s": 0.0, "end_s": 2.0, "cast": [{"id": "A", "name": "Freddy", "find": "man in a striped sweater",
                                                 "side": "left"}],
         "props": [{"find": "knife", "holder": holder}]}]}))


@pytest.fixture(scope="module")
def clip(tmp_path_factory):
    return write_clip(tmp_path_factory.mktemp("clip") / "clip.mp4", fight_frames(30, cut=15))


def test_every_frame_is_drawn_and_the_drawer_restarts_at_each_cut(clip):
    seg, drawer = FakeSegmenter(), FakeDrawer()
    result = pipeline.rotoscope(clip, shot_list("A"), Config(), seg, FakeHands(), drawer)
    assert len(result.frames) == 30 and result.cuts == [15]
    assert seg.calls[0][2] == [15]
    assert drawer.resets == [0, 15]
    assert result.faces == [{"A"}] * 30


@pytest.mark.parametrize("holder, colour", [("A", CAST["A"]), ("loose", LOOSE)])
def test_a_held_prop_is_drawn_in_its_holders_colour_and_a_loose_one_grey(clip, holder, colour):
    result = pipeline.rotoscope(clip, shot_list(holder), Config(), FakeSegmenter(), FakeHands(), FakeDrawer())
    knife = result.frames[0][80:87, 92:104]                    # the knife's box on the drawing, clear of A's line
    assert set(np.unique(knife)) - {0} == {colour}
    assert BLOOD_RED in result.frames[0]
