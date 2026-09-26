import numpy as np
import pytest

from rotoscope.compose import compose
from rotoscope.config import Config
from rotoscope.palette import APP_ONLY, PAL_RGB, nearest, to_rgb
from rotoscope.types import DRAW_H, DRAW_W


def test_the_apps_own_colour_maps_to_a_film_colour():
    assert nearest(tuple(PAL_RGB[APP_ONLY])) != APP_ONLY


def test_a_frame_holding_the_apps_colour_is_refused():
    canvas = np.zeros((DRAW_H, DRAW_W), np.uint8)
    canvas[5, 5] = APP_ONLY
    with pytest.raises(ValueError, match="palette indices"):
        compose(canvas, [], [], Config())
    with pytest.raises(ValueError, match="palette indices"):
        to_rgb(canvas)
