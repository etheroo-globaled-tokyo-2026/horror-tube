"""Per-frame analysis for the people drawing: region classes inside the figures, and faces.

Faces come from the face finder's boxes, with MediaPipe's mesh on a crop round each box. Where a box gets no mesh,
the drawing falls back to v7's own search: MediaPipe on the whole frame, then on a crop round every head blob (hair
or face skin) with no face yet, which finds small and sunglassed faces the face finder misses."""
from __future__ import annotations

import cv2
import numpy as np

from rotoscope.draw.face_boxes import FaceBox
from rotoscope.draw.lines import square_crop
from rotoscope.draw.mediapipe_models import BG, FACE, HAIR, ClassSegmenter, FaceMesher, Mesh
from rotoscope.types import ANALYSIS_H as MH
from rotoscope.types import ANALYSIS_W as MW

MESH_SIDE = 384                 # crops are upsampled to this before MediaPipe looks for a face
BOX_CROP = 1.8                  # a face box's crop, as a multiple of its longer side


def class_scores(seg: ClassSegmenter, src: np.ndarray, fig: np.ndarray) -> np.ndarray:
    """(6, 360, 640) class scores: the segmenter on a square crop round each figure blob, pasted back; background
    elsewhere."""
    sh, sw = src.shape[:2]
    k = sw / MW
    probs = np.zeros((6, MH, MW), np.float32)
    probs[BG] = 1.0
    n, lab, st, _ = cv2.connectedComponentsWithStats(fig.astype(np.uint8), connectivity=8)
    for i in sorted(range(1, n), key=lambda i: -st[i, cv2.CC_STAT_AREA]):
        x, y, w, h, area = st[i]
        if area < 150:
            continue
        crop, x0, y0 = square_crop(src, (x + w / 2) * k, (y + h / 2) * k, max(w, h) * 1.15 * k)
        conf = seg(crop)
        side_m = crop.shape[0] / k
        M = np.array([[side_m / conf.shape[2], 0, x0 / k], [0, side_m / conf.shape[1], y0 / k]], np.float32)
        region = cv2.dilate((lab == i).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
        flags = cv2.INTER_AREA if side_m < conf.shape[1] else cv2.INTER_LINEAR
        for c in range(6):
            warped = cv2.warpAffine(conf[c], M, (MW, MH), flags=flags, borderValue=1.0 if c == BG else 0.0)
            probs[c][region] = warped[region]
    return probs


def _crop_meshes(mesher: FaceMesher, src: np.ndarray, cx: float, cy: float, side: float) -> list[Mesh]:
    """MediaPipe's meshes on a square crop, upsampled to MESH_SIDE, in the frame's coordinates."""
    sh, sw = src.shape[:2]
    crop, x0, y0 = square_crop(src, cx, cy, max(side, 48))
    up = cv2.resize(crop, (MESH_SIDE, MESH_SIDE),
                    interpolation=cv2.INTER_CUBIC if crop.shape[0] < MESH_SIDE else cv2.INTER_AREA)
    return [f.mapped(crop.shape[1], crop.shape[0], x0, y0, sw, sh) for f in mesher(up)]


def search_faces(mesher: FaceMesher, src: np.ndarray, cls: np.ndarray, fig: np.ndarray) -> list[Mesh]:
    """v7's own face search: the whole frame, then a crop round every hair or face-skin blob that has no face yet."""
    sh, sw = src.shape[:2]
    k = sw / MW
    faces = mesher(src)
    heads = ((cls == HAIR) | (cls == FACE)) & fig
    n, _, st, _ = cv2.connectedComponentsWithStats(heads.astype(np.uint8), connectivity=8)
    for j in range(1, n):
        x, y, w, h, area = st[j]
        if area < 25:
            continue
        cx, cy = (x + w / 2) * k, (y + h / 2) * k
        if any(abs(f.pts[1, 0] * sw - cx) < w * k and abs(f.pts[1, 1] * sh - cy) < h * k for f in faces):
            continue
        # this crop is always upsampled with cubic interpolation, even when it is bigger than MESH_SIDE
        crop, x0, y0 = square_crop(src, cx, cy, max(max(w, h) * k * 2.4, 48))
        up = cv2.resize(crop, (MESH_SIDE, MESH_SIDE), interpolation=cv2.INTER_CUBIC)
        for f in mesher(up):
            g = f.mapped(crop.shape[1], crop.shape[0], x0, y0, sw, sh)
            if not any(np.hypot(*(g.pts[1, :2] - e.pts[1, :2])) < 0.03 for e in faces):
                faces.append(g)
    return faces


def mesh_in_box(mesher: FaceMesher, src: np.ndarray, box: tuple[float, float, float, float]) -> Mesh | None:
    """MediaPipe's mesh for one face box: the mesh on the box's crop whose nose is nearest the box centre, within a
    quarter of the box of it."""
    sh, sw = src.shape[:2]
    x0, y0, x1, y1 = box
    side = BOX_CROP * max((x1 - x0) * sw, (y1 - y0) * sh)
    mx, my = 0.25 * (x1 - x0), 0.25 * (y1 - y0)
    best = None
    for g in _crop_meshes(mesher, src, (x0 + x1) / 2 * sw, (y0 + y1) / 2 * sh, side):
        nx, ny = g.pts[1, :2]
        if x0 - mx <= nx <= x1 + mx and y0 - my <= ny <= y1 + my:
            d = float(np.hypot(nx - (x0 + x1) / 2, ny - (y0 + y1) / 2))
            if best is None or d < best[0]:
                best = (d, g)
    return None if best is None else best[1]


def box_meshes(mesher: FaceMesher, boxes: list[FaceBox], src: np.ndarray) -> tuple[list[Mesh], list[FaceBox]]:
    """(meshes, bare): a mesh for each face box MediaPipe could map, and the boxes it couldn't."""
    meshes, bare = [], []
    for f in boxes:
        g = mesh_in_box(mesher, src, f.box)
        if g is None:
            bare.append(f)
        else:
            meshes.append(g)
    return meshes, bare
