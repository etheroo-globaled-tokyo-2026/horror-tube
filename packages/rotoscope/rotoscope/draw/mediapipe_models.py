"""The MediaPipe models the people drawing runs, on MediaPipe's GPU delegate: region classes (hair, face skin...)
and the face landmarker (478 points, head pose, expression blendshapes)."""
from __future__ import annotations

import logging
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions, vision

from rotoscope import devices

log = logging.getLogger(__name__)

SEG_URL = ("https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/"
           "float32/latest/selfie_multiclass_256x256.tflite")
FACE_URL = ("https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/"
            "float16/latest/face_landmarker.task")
DOWNLOAD_TIMEOUT_S = 120
BG, HAIR, BODY, FACE, CLOTHES, OTHER = range(6)     # selfie_multiclass's classes
BS_NAMES = ["jawOpen", "mouthLowerDownLeft", "mouthLowerDownRight", "mouthSmileLeft", "mouthSmileRight",
            "mouthFrownLeft", "mouthFrownRight", "eyeBlinkLeft", "eyeBlinkRight", "eyeWideLeft", "eyeWideRight",
            "eyeSquintLeft", "eyeSquintRight", "browDownLeft", "browDownRight", "browInnerUp", "mouthStretchLeft",
            "mouthStretchRight"]


def fetch(url: str, path: Path) -> Path:
    """The model file at path, downloaded from url the first time."""
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    log.info("downloading %s to %s", url, path)
    tmp = path.with_suffix(path.suffix + ".part")
    with urllib.request.urlopen(url, timeout=DOWNLOAD_TIMEOUT_S) as r, open(tmp, "wb") as f:
        f.write(r.read())
    tmp.rename(path)
    return path


def _options(path: Path) -> BaseOptions:
    return BaseOptions(model_asset_path=str(path), delegate=devices.mediapipe_delegate())


def _image(rgb: np.ndarray, delegate) -> mp.Image:
    """MediaPipe's GPU delegate takes RGBA; its CPU delegate RGB."""
    if delegate == BaseOptions.Delegate.GPU:
        rgba = np.dstack([rgb, np.full(rgb.shape[:2], 255, np.uint8)])
        return mp.Image(image_format=mp.ImageFormat.SRGBA, data=np.ascontiguousarray(rgba))
    return mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))


class ClassSegmenter:
    """selfie_multiclass_256x256: per-pixel scores for background, hair, body skin, face skin, clothes, others."""

    def __init__(self, models_dir: Path):
        opts = _options(fetch(SEG_URL, models_dir / "selfie_multiclass_256x256.tflite"))
        self.delegate = opts.delegate
        self.seg = vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(
            base_options=opts, running_mode=vision.RunningMode.IMAGE, output_confidence_masks=True,
            output_category_mask=False))

    def __call__(self, rgb: np.ndarray) -> np.ndarray:
        """(6, h, w) float32 scores for an RGB image."""
        res = self.seg.segment(_image(rgb, self.delegate))
        return np.stack([m.numpy_view().astype(np.float32).reshape(rgb.shape[:2]) for m in res.confidence_masks])


@dataclass(frozen=True)
class Mesh:
    """One face from the landmarker: 478 points (x, y normalised to the image, z), head yaw and pitch in degrees,
    and the blendshape scores in BS_NAMES order (None when the model gave none)."""
    pts: np.ndarray
    yaw: float
    pitch: float
    blend: np.ndarray | None

    def mapped(self, w: float, h: float, x0: float, y0: float, sw: int, sh: int) -> Mesh:
        """The mesh of a w x h crop whose top-left corner is (x0, y0), in the sw x sh frame's coordinates."""
        p = self.pts.copy()
        p[:, 0] = (self.pts[:, 0] * w + x0) / sw
        p[:, 1] = (self.pts[:, 1] * h + y0) / sh
        return Mesh(p, self.yaw, self.pitch, self.blend)


class FaceMesher:
    """MediaPipe's face landmarker, up to 4 faces per image."""

    def __init__(self, models_dir: Path):
        opts = _options(fetch(FACE_URL, models_dir / "face_landmarker.task"))
        self.delegate = opts.delegate
        self.face = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
            base_options=opts, running_mode=vision.RunningMode.IMAGE, num_faces=4,
            min_face_detection_confidence=0.35, min_face_presence_confidence=0.35,
            output_facial_transformation_matrixes=True, output_face_blendshapes=True))

    def __call__(self, rgb: np.ndarray) -> list[Mesh]:
        res = self.face.detect(_image(rgb, self.delegate))
        out = []
        for k, lm in enumerate(res.face_landmarks):
            pts = np.array([[p.x, p.y, p.z] for p in lm], np.float32)
            yaw = pitch = 0.0
            if res.facial_transformation_matrixes:
                r = np.asarray(res.facial_transformation_matrixes[k], np.float64)[:3, :3]
                ang = cv2.RQDecomp3x3(r / np.linalg.norm(r, axis=0, keepdims=True))[0]   # degrees about x, y, z
                # float32, as the drawing's thresholds were set on
                yaw, pitch = float(np.float32(ang[1])), float(np.float32(ang[0]))
            blend = None
            if res.face_blendshapes:
                d = {c.category_name: c.score for c in res.face_blendshapes[k]}
                blend = np.array([d.get(n, 0.0) for n in BS_NAMES], np.float32)
            out.append(Mesh(pts, yaw, pitch, blend))
        return out
