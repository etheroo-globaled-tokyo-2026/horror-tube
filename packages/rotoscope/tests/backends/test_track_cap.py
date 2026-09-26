"""SAM 3.1 starts at most MAX_TRACKS tracks per text: a find phrase that fits both fighters mustn't pile up tracks."""
from rotoscope.backends.mlx_sam31 import MAX_TRACKS, START, _starts


def finds(*found: tuple[str, float]) -> list[dict]:
    return [{"text": t, "score": s} for t, s in found]


def test_a_text_starts_only_its_best_finds_while_it_has_room():
    fs = finds(("man in a hockey mask", 0.68), ("man in a hockey mask", 0.66), ("man in a hockey mask", 0.65),
               ("man in a hockey mask", 0.64), ("man in an apron", 0.9), ("man in an apron", START - 0.01),
               ("blood", 0.9))
    tracked = {"man in a hockey mask", "man in an apron"}
    assert _starts(fs, set(), {}, tracked) == [0, 1, 4], "the 2 best of each tracked text, and only sure finds"
    assert _starts(fs, set(), {"man in a hockey mask": MAX_TRACKS - 1}, tracked) == [0, 4], "room for one"
    assert _starts(fs, {0}, {"man in a hockey mask": MAX_TRACKS - 1}, tracked) == [1, 4], "a covered find starts none"
    assert _starts(fs, set(), {"man in a hockey mask": MAX_TRACKS, "man in an apron": MAX_TRACKS}, tracked) == [], \
        "a text with MAX_TRACKS live tracks starts no more"
