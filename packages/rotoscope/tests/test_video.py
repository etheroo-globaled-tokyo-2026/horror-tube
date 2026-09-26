import numpy as np
from kit import write_clip

from rotoscope import video
from rotoscope.config import Video


def test_a_cut_is_found_where_the_picture_changes_not_where_it_moves():
    ramp = np.tile(np.linspace(0, 255, 160, dtype=np.uint8)[None, :, None], (90, 1, 3))
    frames = np.stack([ramp] * 12)
    for k in range(6):
        frames[k, 30:60, 10 + 12 * k:40 + 12 * k] = 255          # a white box crossing the first shot
    frames[6:] = 20
    frames[6:, 20:70, 40:120] = (220, 40, 40)                    # the second shot: a red shape on black
    assert video.cuts(frames, Video()) == [6]


def test_decode_takes_the_drawing_rate_and_a_centred_16_9_crop(tmp_path):
    frames = np.zeros((30, 240, 320, 3), np.uint8)
    frames[:, 30:210] = 200                                      # the 16:9 middle, between black bars
    clip = write_clip(tmp_path / "four_three.mp4", frames, fps=30, audio=False)
    got = video.decode(clip, tmp_path, Video())
    assert got.shape == (15, 180, 320, 3)
    assert got[:, 2:-2].min() > 150                              # the bars are cropped off
