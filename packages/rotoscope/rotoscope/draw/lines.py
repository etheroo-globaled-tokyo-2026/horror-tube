"""Line geometry for the people drawing: masks to 1 px lines, curve smoothing, crops.

Analysis masks are 640x360; lines are drawn at the drawing's size. cv2 draws with 4 bits of sub-pixel shift, so
point coordinates are multiplied by 16 before drawing."""
from __future__ import annotations

import cv2
import numpy as np

from rotoscope.types import ANALYSIS_H as MH
from rotoscope.types import ANALYSIS_W as MW

CROSS = cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3))
# MediaPipe face mesh indices round the face, starting at the top of the forehead
OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176,
        149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]


def thin(m: np.ndarray) -> np.ndarray:
    return cv2.ximgproc.thinning(m.astype(np.uint8) * 255, thinningType=cv2.ximgproc.THINNING_ZHANGSUEN) > 0


def remove_small(m: np.ndarray, min_px: int) -> np.ndarray:
    """m without its 8-connected pieces smaller than min_px."""
    n, lab, st, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), connectivity=8)
    keep = np.zeros(n, bool)
    keep[1:] = st[1:, cv2.CC_STAT_AREA] >= min_px
    return keep[lab]


def chaikin(p: np.ndarray, it: int = 2) -> np.ndarray:
    """Chaikin corner cutting on a closed polygon."""
    for _ in range(it):
        q = np.roll(p, -1, 0)
        n = np.empty((2 * len(p), 2), np.float32)
        n[0::2] = 0.75 * p + 0.25 * q
        n[1::2] = 0.25 * p + 0.75 * q
        p = n
    return p


def open_chaikin(p: np.ndarray, it: int = 2) -> np.ndarray:
    """Chaikin corner cutting on an open line; its end points stay put."""
    for _ in range(it):
        q = np.empty((2 * len(p) - 2, 2), np.float32)
        q[0::2] = 0.75 * p[:-1] + 0.25 * p[1:]
        q[1::2] = 0.25 * p[:-1] + 0.75 * p[1:]
        p = np.vstack([p[:1], q, p[-1:]])
    return p


def trace(region: np.ndarray, W: int, H: int, min_len: float, eps: float = 1.3, min_area: int = 150,
          min_hole: int = 400) -> np.ndarray:
    """Smooth closed curves round a 640x360 region, as clean 1 px lines at W x H; curves shorter than min_len px
    are dropped."""
    lay = np.zeros((H, W), np.uint8)
    cs, hier = cv2.findContours(region.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    if hier is None:
        return lay > 0
    sx, sy = W / MW, H / MH
    for c, h in zip(cs, hier[0]):
        area = abs(cv2.contourArea(c))
        if area < (min_hole if h[3] >= 0 else min_area):
            continue
        ap = cv2.approxPolyDP(c, eps, True)[:, 0].astype(np.float32)
        if len(ap) < 3:
            continue
        pts = (chaikin(ap, 2) + 0.5) * np.array([sx, sy], np.float32) - 0.5
        if np.hypot(*np.diff(np.vstack([pts, pts[:1]]), axis=0).T).sum() < min_len:
            continue
        cv2.polylines(lay, [np.round(pts * 16).astype(np.int32)], True, 1, 1, cv2.LINE_8, 4)
    lay[0, :] = lay[-1, :] = 0          # a figure cut by the frame just ends there: no line along the edge
    lay[:, 0] = lay[:, -1] = 0
    return lay > 0


def poly_mask(pts, W: int, H: int, closed: bool = False) -> np.ndarray:
    m = np.zeros((H, W), np.uint8)
    cv2.polylines(m, [np.round(np.asarray(pts, np.float32) * 16).astype(np.int32)], closed, 1, 1, cv2.LINE_8, 4)
    return m > 0


def straight(seg: np.ndarray, max_segments: int = 3, snap_deg: float = 8.0) -> np.ndarray:
    """Douglas-Peucker, loosened until the line has at most max_segments straight pieces; pieces within snap_deg
    of vertical or horizontal snap to it."""
    eps = 2.0
    ap = cv2.approxPolyDP(seg.reshape(-1, 1, 2), eps, False)[:, 0].astype(np.float32)
    while len(ap) - 1 > max_segments and eps < 80:
        eps *= 1.4
        ap = cv2.approxPolyDP(seg.reshape(-1, 1, 2), eps, False)[:, 0].astype(np.float32)
    for i in range(len(ap) - 1):
        dx, dy = ap[i + 1] - ap[i]
        ang = abs(np.degrees(np.arctan2(dy, dx))) % 180
        if abs(ang - 90) < snap_deg:
            ap[i + 1, 0] = ap[i, 0]
        elif ang < snap_deg or ang > 180 - snap_deg:
            ap[i + 1, 1] = ap[i, 1]
    return ap


def internal_runs(pts: np.ndarray, inside_dist: np.ndarray, min_d: float = 4.0) -> list[np.ndarray]:
    """A closed contour split into the runs of points inside the figure, at least min_d px from its outline."""
    flag = inside_dist[pts[:, 1], pts[:, 0]] >= min_d
    if flag.all():
        return [pts]
    if not flag.any():
        return []
    start = int(np.argmin(flag))                  # start on an outline point, so no run wraps round the end
    pts, flag = np.roll(pts, -start, 0), np.roll(flag, -start)
    runs, cur = [], []
    for q, f_ in zip(pts, flag):
        if f_:
            cur.append(q)
        elif cur:
            runs.append(np.array(cur))
            cur = []
    if cur:
        runs.append(np.array(cur))
    return runs


def oval_mask(xy: np.ndarray, W: int, H: int) -> np.ndarray:
    """The face oval of a mesh (points normalised to the frame), filled, at W x H."""
    a = np.asarray(xy[OVAL, :2], np.float32) * np.array([W, H], np.float32) - 0.5
    m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(m, [np.round(a * 16).astype(np.int32)], 1, cv2.LINE_8, 4)
    return m > 0


def square_crop(img: np.ndarray, cx: float, cy: float, side: float) -> tuple[np.ndarray, int, int]:
    """A square crop centred on (cx, cy), black outside the image; returns it and its top-left corner."""
    h, w = img.shape[:2]
    side = int(round(side))
    x0, y0 = int(round(cx - side / 2)), int(round(cy - side / 2))
    out = np.zeros((side, side, 3), np.uint8)
    sx0, sy0, sx1, sy1 = max(0, x0), max(0, y0), min(w, x0 + side), min(h, y0 + side)
    if sx1 > sx0 and sy1 > sy0:
        out[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = img[sy0:sy1, sx0:sx1]
    return out, x0, y0


def nearest_values(values: np.ndarray, have: np.ndarray) -> np.ndarray:
    """For every pixel, the value at the nearest pixel where `have` is set."""
    idx = cv2.distanceTransformWithLabels((~have).astype(np.uint8), cv2.DIST_L2, 3, labelType=cv2.DIST_LABEL_PIXEL)[1]
    ys, xs = np.nonzero(have)
    lut = np.zeros(idx.max() + 1, values.dtype)
    lut[idx[ys, xs]] = values[ys, xs]
    return lut[idx]
