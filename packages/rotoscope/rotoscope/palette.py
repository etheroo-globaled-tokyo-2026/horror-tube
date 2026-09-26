"""TV.PAL, the 16 colours of FAITH's TV. A film frame holds palette indices 0-14; 15 belongs to the app's own UI and
is never written into a frame."""
import numpy as np

PAL_HEX = ("#0B0B12", "#16162A", "#2A2A4A", "#4A4A6A", "#8A8CAC", "#C8C8DC", "#F2F2F8", "#3BE8FF",
           "#1B9FD8", "#FF3B6B", "#C21E4E", "#FFD23B", "#E08A00", "#FF5A3C", "#3BE87A", "#FFF3C4")
PAL_RGB = np.array([[int(h[i:i + 2], 16) for i in (1, 3, 5)] for h in PAL_HEX], np.uint8)
APP_ONLY = 15
BACKGROUND = 0
LOOSE = 4                                       # a prop nobody holds
CAST = {"A": 7, "B": 12, "C": 5, "D": 9}        # v7's line colour for each character

MEASURED_RED = (220, 20, 40)                    # sRGB of blood
MEASURED_GREEN = (90, 220, 60)                  # sRGB of acid blood


def nearest(rgb: tuple[int, int, int]) -> int:
    """The film colour nearest an sRGB colour; never APP_ONLY."""
    d = ((PAL_RGB[:APP_ONLY].astype(np.int32) - np.asarray(rgb, np.int32)) ** 2).sum(axis=1)
    return int(np.argmin(d))


BLOOD_RED = nearest(MEASURED_RED)
BLOOD_GREEN = nearest(MEASURED_GREEN)


def check(canvas: np.ndarray) -> None:
    """Raises if a frame holds an index a film frame can't: APP_ONLY, or past the palette's end."""
    bad = canvas >= APP_ONLY
    if bad.any():
        raise ValueError(f"a film frame holds palette indices {sorted(int(v) for v in np.unique(canvas[bad]))} at "
                         f"{int(bad.sum())} px; only 0-{APP_ONLY - 1} may be drawn")


def to_rgb(canvas: np.ndarray) -> np.ndarray:
    """Palette indices (h, w) to sRGB (h, w, 3), after check()."""
    check(canvas)
    return PAL_RGB[canvas]
