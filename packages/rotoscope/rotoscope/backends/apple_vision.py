"""Apple Vision on the Neural Engine (or the GPU on a Mac without one): hand joints, for who holds a prop, and face
rectangles, which see the profile and small faces MediaPipe misses. A request stage Vision offers only on the CPU
raises devices.CPUBlocked unless ROTO_CPU=1. Frames go to Vision in memory."""
from __future__ import annotations

import math

import CoreML
import numpy as np
import objc
import Quartz
import Vision
from Foundation import NSData

from rotoscope import devices
from rotoscope.draw.face_boxes import FaceBox
from rotoscope.types import ANALYSIS_H as MH
from rotoscope.types import ANALYSIS_W as MW

MAX_HANDS = 6
MIN_JOINT_CONF = 0.3
MIN_JOINTS = 4              # a hand with fewer confident joints isn't kept


def _cgimage(rgb: np.ndarray):
    h, w = rgb.shape[:2]
    a = np.ascontiguousarray(np.dstack([rgb, np.full((h, w), 255, np.uint8)]))
    prov = Quartz.CGDataProviderCreateWithCFData(NSData.dataWithBytes_length_(a.tobytes(), a.nbytes))
    return Quartz.CGImageCreate(w, h, 8, 32, w * 4, Quartz.CGColorSpaceCreateDeviceRGB(),
                                Quartz.kCGImageAlphaNoneSkipLast, prov, None, False, Quartz.kCGRenderingIntentDefault)


def _at(p) -> tuple[float, float]:
    """A Vision point (normalised, origin bottom left) at 640x360, y down."""
    return round(p.location().x * MW, 1), round((1 - p.location().y) * MH, 1)


class AppleVision:
    """A HandFinder, and the drawing's FaceFinder."""

    def __init__(self):
        self._devices: dict[str, dict] = {}
        with objc.autorelease_pool():           # choose each request's devices now, so a CPU-only stage raises here
            for rq in (*self._hand_requests(), self._face_request()):
                self._on_accelerator(rq)

    @staticmethod
    def _hand_requests():
        hand = Vision.VNDetectHumanHandPoseRequest.alloc().init()
        hand.setMaximumHandCount_(MAX_HANDS)
        return hand, Vision.VNDetectHumanBodyPoseRequest.alloc().init()

    @staticmethod
    def _face_request():
        face = Vision.VNDetectFaceRectanglesRequest.alloc().init()
        face.setRevision_(Vision.VNDetectFaceRectanglesRequestRevision3)     # continuous yaw and roll
        return face

    def _on_accelerator(self, rq) -> None:
        """Runs each compute stage of the request on the Neural Engine, else the GPU."""
        name = type(rq).__name__
        if name not in self._devices:
            offered, err = rq.supportedComputeStageDevicesAndReturnError_(None)
            if offered is None:
                raise RuntimeError(f"Vision lists no compute devices for {name}: {err}")
            picks = {}
            for stage, devs in offered.items():
                pick = next((d for kind in (CoreML.MLNeuralEngineComputeDevice, CoreML.MLGPUComputeDevice)
                             for d in devs if isinstance(d, kind)), None)
                if pick is None:
                    devices.allow_cpu(f"Apple Vision {name} ({stage})", "Vision offers no Neural Engine or GPU")
                    pick = next(d for d in devs if isinstance(d, CoreML.MLCPUComputeDevice))
                picks[stage] = pick
            self._devices[name] = picks
        for stage, dev in self._devices[name].items():
            rq.setComputeDevice_forComputeStage_(dev, stage)

    def _perform(self, frame: np.ndarray, rqs) -> None:
        for rq in rqs:
            self._on_accelerator(rq)
        handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(_cgimage(frame), {})
        ok, err = handler.performRequests_error_(list(rqs), None)
        if not ok:
            raise RuntimeError(f"Vision failed on {', '.join(type(r).__name__ for r in rqs)}: {err}")

    def hands(self, frame: np.ndarray) -> list[list[tuple[float, float]]]:
        """Every hand's confident joints at 640x360; then each body pose's wrists as one-joint lists, since a hand
        wrapped round a handle often isn't found as a hand."""
        with objc.autorelease_pool():
            hand, body = self._hand_requests()
            self._perform(frame, (hand, body))
            out = []
            for obs in hand.results() or []:
                pts, err = obs.recognizedPointsForJointsGroupName_error_(
                    Vision.VNHumanHandPoseObservationJointsGroupNameAll, None)
                if pts is None:
                    raise RuntimeError(f"Vision gave a hand with no joints: {err}")
                joints = [_at(p) for p in pts.values() if p.confidence() > MIN_JOINT_CONF]
                if len(joints) >= MIN_JOINTS:
                    out.append(joints)
            for obs in body.results() or []:
                for name in (Vision.VNHumanBodyPoseObservationJointNameLeftWrist,
                             Vision.VNHumanBodyPoseObservationJointNameRightWrist):
                    p, _ = obs.recognizedPointForJointName_error_(name, None)    # None: the pose has no such joint
                    if p is not None and p.confidence() > MIN_JOINT_CONF:
                        out.append([_at(p)])
            return out

    def faces(self, frame: np.ndarray) -> list[FaceBox]:
        """Every face in the frame, biggest first."""
        with objc.autorelease_pool():
            rq = self._face_request()
            self._perform(frame, (rq,))
            deg = lambda v: 0.0 if v is None else float(v) * 180.0 / math.pi     # noqa: E731
            out = []
            for o in rq.results() or []:
                r = o.boundingBox()                        # normalised, origin bottom left
                x, y, w, h = r.origin.x, r.origin.y, r.size.width, r.size.height
                out.append(FaceBox((float(x), float(1 - y - h), float(x + w), float(1 - y)), float(o.confidence()),
                                   deg(o.yaw()), deg(o.roll())))
            return sorted(out, key=lambda f: -(f.box[2] - f.box[0]))
