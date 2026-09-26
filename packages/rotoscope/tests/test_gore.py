import numpy as np
from kit import find, rect

from rotoscope import gore
from rotoscope.config import Gore
from rotoscope.palette import BLOOD_GREEN, BLOOD_RED
from rotoscope.types import ANALYSIS_H, ANALYSIS_W

CFG = Gore()
RED = rect(100, 100, 200, 200)
GREEN = rect(400, 100, 500, 200)


def frame() -> np.ndarray:
    f = np.full((ANALYSIS_H, ANALYSIS_W, 3), 20, np.uint8)
    f[RED] = (190, 25, 35)
    f[GREEN] = (80, 210, 60)
    return f


def test_each_patch_is_drawn_in_the_blood_colour_of_its_own_hue():
    got = gore.blood([find("blood", "blood", GREEN, 0.7), find("blood", "blood", RED, 0.6)], frame(), CFG)
    assert [b.colour for b in got] == [BLOOD_GREEN, BLOOD_RED]


def test_blood_a_light_outscores_is_the_light():
    blood = find("blood", "blood", RED, 0.6)
    lamp = rect(90, 90, 210, 210)
    assert gore.blood([blood, find("light", "light", lamp, 0.8)], frame(), CFG) == []
    assert len(gore.blood([blood, find("light", "light", lamp, 0.5)], frame(), CFG)) == 1
