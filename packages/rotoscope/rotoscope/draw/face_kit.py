"""FAITH's faces, drawn by head size at the drawing:
- under 30 px: white eye dots and a mouth line;
- 30-60 px: the kit, hand-designed strokes (brows, eyes with a 1 px white pupil, nose, mouth) placed on the mesh's
  anchors, scaled with the face and turned with its roll;
- 60 px and up: the mesh traced as FAITH traces a close-up, each stroke held still on its own.
Expressions come from the landmarker's blendshapes, smoothed and held. A face is drawn once its head pose has been
seen for 2 frames: frontal, three-quarter (far-side features dropped), profile (one eye) or head down (lower face
oval, a brow line and the nose). The face oval, ears, neck and cheek folds come from the mesh."""
from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from rotoscope.draw.face_boxes import FaceBox
from rotoscope.draw.holds import StrokeHold, Sticky
from rotoscope.draw.lines import CROSS, OVAL, chaikin, open_chaikin, poly_mask, remove_small
from rotoscope.draw.mediapipe_models import BS_NAMES
from rotoscope.draw.seats import PROFILE_YAW, BareFace, FaceTrack
from rotoscope.types import ANALYSIS_H as MH
from rotoscope.types import ANALYSIS_W as MW

WHITE = 6                  # palette index of #F2F2F8: pupils and teeth
HELD_FRAMES = 3            # a face whose kit can't be drawn keeps its last kit this many frames, following the head

# Designs are polylines in a face frame: origin at the feature's anchor, x along the eye line (towards image right),
# y down, unit u (about the distance between the eyes). Eyes and brows are written for the image-left feature with
# +x towards the nose; the other side is mirrored. Noses point to image right and are mirrored to the way the face
# turns. ("w", pts) is a white stroke; "PUPIL" a 1 px white dot at the iris.
S, M, L = "S", "M", "L"
KIT = {
    "eye": {
        "open":     {S: [[(-0.2, 0.0), (0.2, 0.0)], "PUPIL"],
                     M: [[(-0.24, 0.03), (-0.13, -0.05), (0.02, -0.07), (0.16, -0.04), (0.24, 0.02)], "PUPIL"],
                     L: [[(-0.25, 0.03), (-0.14, -0.06), (0.02, -0.08), (0.16, -0.05), (0.25, 0.02)],
                         [(-0.13, 0.08), (0.12, 0.08)], "PUPIL"]},
        "narrowed": {S: [[(-0.2, 0.0), (0.2, 0.0)]],
                     M: [[(-0.24, 0.0), (0.24, -0.01)], [(-0.1, 0.05), (0.12, 0.05)]],
                     L: [[(-0.25, 0.01), (0.0, -0.02), (0.25, -0.01)], [(-0.12, 0.05), (0.14, 0.05)]]},
        "closed":   {S: [[(-0.2, 0.01), (0.2, 0.01)]],
                     M: [[(-0.24, 0.0), (-0.1, 0.04), (0.1, 0.04), (0.24, 0.0)]],
                     L: [[(-0.25, 0.0), (-0.1, 0.05), (0.1, 0.05), (0.25, 0.0)]]},
        "wide":     {S: [[(-0.2, -0.02), (0.0, -0.05), (0.2, -0.02)], "PUPIL"],
                     M: [[(-0.24, 0.02), (-0.13, -0.09), (0.13, -0.09), (0.24, 0.02)], [(-0.12, 0.09), (0.12, 0.09)],
                         "PUPIL"],
                     L: [[(-0.25, 0.02), (-0.14, -0.1), (0.14, -0.1), (0.25, 0.02)], [(-0.14, 0.1), (0.14, 0.1)],
                         "PUPIL"]},
    },
    "brow": {
        "neutral":  {S: [[(-0.2, 0.02), (0.2, 0.0)]],
                     M: [[(-0.27, 0.04), (-0.05, -0.02), (0.24, 0.0)]],
                     L: [[(-0.28, 0.05), (-0.06, -0.02), (0.25, 0.0)]]},
        "furrowed": {S: [[(-0.2, -0.02), (0.2, 0.05)]],
                     M: [[(-0.27, -0.03), (0.0, 0.0), (0.24, 0.08)]],
                     L: [[(-0.28, -0.03), (0.0, 0.0), (0.25, 0.09)]]},
        "raised":   {S: [[(-0.2, 0.02), (0.0, -0.03), (0.2, 0.0)]],
                     M: [[(-0.27, 0.05), (-0.05, -0.08), (0.24, -0.02)]],
                     L: [[(-0.28, 0.06), (-0.06, -0.09), (0.25, -0.02)]]},
    },
    "nose": {
        "frontal":  {S: [[(0.03, -0.12), (0.05, 0.03), (-0.04, 0.05)]],
                     M: [[(0.05, -0.36), (0.07, -0.04), (0.13, 0.05), (0.02, 0.09)]],
                     L: [[(0.05, -0.4), (0.08, -0.05), (0.15, 0.05), (0.02, 0.1), (-0.06, 0.08)]]},
        "three_quarter": {S: [[(0.0, -0.12), (0.03, 0.04), (-0.06, 0.05)]],
                          M: [[(0.0, -0.36), (0.05, 0.04), (-0.13, 0.07)]],
                          L: [[(0.0, -0.4), (0.06, 0.04), (-0.15, 0.08)]]},
    },
    "mouth": {
        "closed":   {S: [[(-0.2, 0.0), (0.2, 0.0)]],
                     M: [[(-0.3, 0.0), (-0.1, 0.01), (0.1, 0.01), (0.3, 0.0)]],
                     L: [[(-0.32, 0.0), (-0.1, 0.01), (0.1, 0.01), (0.32, 0.0)], [(-0.1, 0.13), (0.1, 0.13)]]},
        "open":     {S: [[(-0.16, 0.0), (0.16, 0.0)], [(-0.1, 0.08), (0.1, 0.08)]],
                     M: [[(-0.26, 0.0), (0.0, -0.03), (0.26, 0.0)],
                         [(-0.26, 0.0), (-0.12, 0.12), (0.12, 0.12), (0.26, 0.0)]],
                     L: [[(-0.28, 0.0), (0.0, -0.03), (0.28, 0.0)],
                         [(-0.28, 0.0), (-0.13, 0.14), (0.13, 0.14), (0.28, 0.0)]]},
        "smile":    {S: [[(-0.22, -0.04), (0.0, 0.03), (0.22, -0.04)]],
                     M: [[(-0.32, -0.07), (-0.16, 0.02), (0.0, 0.04), (0.16, 0.02), (0.32, -0.07)]],
                     L: [[(-0.34, -0.08), (-0.17, 0.02), (0.0, 0.05), (0.17, 0.02), (0.34, -0.08)],
                         [(-0.1, 0.14), (0.1, 0.14)]]},
        "grimace":  {S: [[(-0.2, -0.02), (0.2, -0.02), (0.2, 0.05), (-0.2, 0.05), (-0.2, -0.02)]],
                     M: [[(-0.3, -0.04), (0.3, -0.04), (0.3, 0.08), (-0.3, 0.08), (-0.3, -0.04)],
                         ("w", [(-0.26, 0.02), (0.26, 0.02)])],
                     L: [[(-0.32, -0.05), (0.32, -0.05), (0.32, 0.09), (-0.32, 0.09), (-0.32, -0.05)],
                         ("w", [(-0.28, 0.02), (0.28, 0.02)])]},
        "frown":    {S: [[(-0.22, 0.04), (0.0, -0.02), (0.22, 0.04)]],
                     M: [[(-0.3, 0.06), (-0.15, -0.01), (0.0, -0.02), (0.15, -0.01), (0.3, 0.06)]],
                     L: [[(-0.32, 0.07), (-0.16, -0.01), (0.0, -0.02), (0.16, -0.01), (0.32, 0.07)]]},
        "shout":    {S: [[(-0.12, 0.0), (0.12, 0.0), (0.08, 0.14), (-0.08, 0.14), (-0.12, 0.0)]],
                     M: [[(-0.2, 0.0), (-0.1, -0.07), (0.1, -0.07), (0.2, 0.0), (0.13, 0.22), (-0.13, 0.22),
                          (-0.2, 0.0)]],
                     L: [[(-0.22, 0.0), (-0.11, -0.08), (0.11, -0.08), (0.22, 0.0), (0.14, 0.25), (-0.14, 0.25),
                          (-0.22, 0.0)]]},
    },
    "profile_eye": {"-": {S: [[(-0.08, -0.03), (0.08, 0.0)]],
                          M: [[(-0.12, -0.05), (0.1, 0.0), (-0.08, 0.05)]],
                          L: [[(-0.13, -0.06), (0.11, 0.0), (-0.09, 0.06)]]}},
}
ALMOND = [[(-0.26, 0.0), (-0.14, -0.07), (0.02, -0.09), (0.16, -0.06), (0.26, 0.0)],
          [(-0.26, 0.0), (-0.12, 0.06), (0.1, 0.06), (0.26, 0.0)], "PUPIL"]
# a profile mark's nose for a box with no mesh: down to the tip at the box edge and a short return under it
PROFILE_NOSE = {S: [[(-0.05, -0.16), (0.05, 0.0), (-0.03, 0.05)]],
                M: [[(-0.08, -0.3), (0.08, 0.0), (-0.05, 0.07)]],
                L: [[(-0.1, -0.36), (0.1, 0.0), (-0.06, 0.09)]]}

EYE_A = dict(outer=33, inner=133, up=159, lo=145, brow=[70, 63, 105, 66, 107, 46, 53, 52, 65, 55])
EYE_B = dict(outer=263, inner=362, up=386, lo=374, brow=[300, 293, 334, 296, 336, 276, 283, 282, 295, 285])
BROW_POINTS = EYE_A["brow"][:5] + EYE_B["brow"][:5]          # the brows' upper edges
OVAL5 = [10, 152, 234, 454, 1]
JAW = [454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234]
IN_UP = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308]    # the lips' inner edges
IN_LO = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308]
IRISES = (468, 473)
# close-up traces: upper and lower lids, brows (upper and lower edge pairs), brows' upper edges
LID_UP = ([33, 246, 161, 160, 159, 158, 157, 173, 133], [263, 466, 388, 387, 386, 385, 384, 398, 362])
LID_LO = ([33, 7, 163, 144, 145, 153, 154, 155, 133], [263, 249, 390, 373, 374, 380, 381, 382, 362])
BROW_PAIRS = ([(70, 46), (63, 53), (105, 52), (66, 65), (107, 55)],
              [(300, 276), (293, 283), (334, 282), (296, 295), (336, 285)])
BROW_UP = ([70, 63, 105, 66, 107], [300, 293, 334, 296, 336])


def place(lay, white, design, anchor, u, roll, W, H, mirror=1.0, yscale=1.0, pupil=None) -> None:
    """Draws one kit feature: its polylines scaled by u, turned by roll, at anchor (drawing px)."""
    c, s = np.cos(roll), np.sin(roll)
    R = np.array([[c, -s], [s, c]], np.float32)
    for item in design:
        if item == "PUPIL":
            if pupil is not None:
                x, y = int(np.floor(pupil[0])), int(np.floor(pupil[1]))
                if 0 <= x < W and 0 <= y < H:
                    white[y, x] = True
            continue
        dst = white if isinstance(item, tuple) else lay
        pts = np.array(item[1] if isinstance(item, tuple) else item, np.float32)
        pts = (pts * np.array([mirror, yscale], np.float32) * u) @ R.T + np.asarray(anchor, np.float32)
        cv2.polylines(dst.view(np.uint8), [np.round(pts * 16).astype(np.int32)], False, 1, 1, cv2.LINE_8, 4)


def curve(pts, W, H, closed=False, it=2) -> np.ndarray:
    """A smoothed polyline through pts (drawing px), as a mask."""
    pts = np.asarray(pts, np.float32)
    if closed:
        pts = chaikin(pts, it)
    else:
        pts = open_chaikin(pts, it)
    m = np.zeros((H, W), np.uint8)
    cv2.polylines(m, [np.round(pts * 16).astype(np.int32)], closed, 1, 1, cv2.LINE_8, 4)
    return m > 0


def measures(xy, W, H):
    """(eyelid gap over eye width per eye, lip gap over mouth width, per eye (centre, brow centre, width), head roll,
    kit unit u, head height), in drawing px."""
    P = lambda i: np.array([xy[i, 0] * W, xy[i, 1] * H], np.float32)     # noqa: E731
    d = lambda a, b: float(np.hypot(*(a - b)))                              # noqa: E731
    lid, eyes = [], []
    for E in (EYE_A, EYE_B):
        w = max(d(P(E["outer"]), P(E["inner"])), 1e-3)
        lid.append(d(P(E["up"]), P(E["lo"])) / w)
        ec = (P(E["outer"]) + P(E["inner"]) + P(E["up"]) + P(E["lo"])) / 4
        eyes.append((ec, np.mean([P(i) for i in E["brow"]], 0), w))
    lip = d(P(13), P(14)) / max(d(P(61), P(291)), 1e-3)
    a, b = (eyes[0][0], eyes[1][0]) if eyes[0][0][0] < eyes[1][0][0] else (eyes[1][0], eyes[0][0])
    roll = float(np.arctan2(*(b - a)[::-1]))
    fh = d(P(10), P(152))
    return lid, lip, eyes, roll, 0.35 * fh, 1.3 * fh


def pose_class(yaw: float, pitch: float) -> str:
    if abs(yaw) <= 22 and abs(pitch) <= 20:
        return "frontal"
    if abs(yaw) <= 50 and abs(pitch) <= 24:
        return "three_quarter"
    return "profile_or_down"


@dataclass
class FaceState:
    age: int = 0
    yaw: float | None = None
    pitch: float | None = None
    cls: str | None = None
    cand: str | None = None
    n: int = 0
    blend: np.ndarray | None = None
    mouth_now: str | None = None
    mouth: Sticky = field(default_factory=lambda: Sticky(1))
    eye: Sticky = field(default_factory=lambda: Sticky(2))
    brow: Sticky = field(default_factory=lambda: Sticky(2))

    def see(self, yaw: float, pitch: float) -> None:
        """This frame's head pose: smoothed, and the pose class changes after 2 frames of a new one."""
        self.age += 1
        self.yaw = yaw if self.yaw is None else 0.5 * self.yaw + 0.5 * yaw
        self.pitch = pitch if self.pitch is None else 0.5 * self.pitch + 0.5 * pitch
        c = pose_class(self.yaw, self.pitch)
        if c == self.cls:
            self.cand, self.n = None, 0
        elif c == self.cand:
            self.n += 1
            if self.n >= 2:
                self.cls = c
        else:
            self.cand, self.n = c, 1
        if self.cls is None and self.age >= 2:
            self.cls = c

    def expression(self, blend: np.ndarray | None, lip: float) -> tuple[str, str, str]:
        """(eye, mouth, brow) states from the blendshapes, smoothed, with hysteresis and a short hold."""
        if blend is None:
            return "open", ("open" if lip >= 0.12 else "closed"), "neutral"
        self.blend = blend if self.blend is None else 0.5 * self.blend + 0.5 * blend
        B = dict(zip(BS_NAMES, self.blend))
        two = lambda n: 0.5 * (B[n + "Left"] + B[n + "Right"])             # noqa: E731
        opn = max(1.5 * B["jawOpen"], lip, two("mouthLowerDown"))
        smile, frown, stretch = two("mouthSmile"), two("mouthFrown"), two("mouthStretch")
        open_thr = 0.04 if self.mouth_now in ("open", "shout", "grimace") else 0.06
        if B["jawOpen"] >= 0.45 or opn >= 0.5:
            m_raw = "shout"
        elif smile >= 0.5 and opn >= 0.12:
            m_raw = "grimace"                          # a grin with teeth
        elif stretch >= 0.4 and opn >= 0.08:
            m_raw = "grimace"
        elif smile >= (0.25 if self.mouth_now == "smile" else 0.35):
            m_raw = "smile"
        elif opn >= open_thr:
            m_raw = "open"
        elif frown >= 0.3:
            m_raw = "frown"
        else:
            m_raw = "closed"
        blink, wide, squint = two("eyeBlink"), two("eyeWide"), two("eyeSquint")
        e_raw = ("closed" if blink >= 0.6 else "narrowed" if (blink >= 0.4 or squint >= 0.6) else
                 "wide" if wide >= 0.3 else "open")
        b_raw = "furrowed" if two("browDown") >= 0.35 else "raised" if B["browInnerUp"] >= 0.35 else "neutral"
        mv = self.mouth(m_raw)
        self.mouth_now = mv
        return self.eye(e_raw), mv, self.brow(b_raw)


@dataclass
class Kit:
    lay: np.ndarray            # the face's strokes at the drawing's size
    white: np.ndarray          # its white pixels
    head: np.ndarray           # the head point it was drawn at (drawing px), for following the head while held
    held_strokes: bool         # each stroke was already held still on its own


class FaceKits:
    """Draws every confident face, holds a lost face's last kit for a few frames, and falls back to a jaw line under
    the hair for a head whose face turned away."""

    def __init__(self, hold: StrokeHold):
        self.hold = hold
        self.reset()

    def reset(self) -> None:
        self.state: dict[int, FaceState] = {}
        self.held: dict[int, tuple[np.ndarray, np.ndarray, np.ndarray, int]] = {}   # face id -> lay, white, head, holds
        self.last_faces: dict[int, dict] = {}       # figure id -> its hair centre and angle and its jaw, last seen

    def draw(self, canvas, tracks: list[FaceTrack], heads, figt, interior, hair_t, outline, clothes_t, hm,
             regions: dict, order: list[int]) -> set[int]:
        """Draws the faces onto the label canvas; returns the face ids with a kit drawn, fresh or held."""
        H, W = canvas.shape
        head_at = {h[0]: np.array([h[1] * W, h[2] * H], np.float32) for h in heads}
        drawn = set()
        for t in tracks:
            st = self.state.setdefault(t.id, FaceState())
            if t.raw is None:
                st.age = 0
                continue
            st.see(t.raw.yaw, t.raw.pitch)
            if st.age < 2 or st.cls is None:
                continue
            x = int(np.clip(t.sm[1, 0] * W, 0, W - 1))
            y = int(np.clip(t.sm[1, 1] * H, 0, H - 1))
            if not figt[max(0, y - 2):y + 3, max(0, x - 2):x + 3].any():
                continue
            kit = self._kit(t, st, W, H, hair_t, interior, outline, clothes_t, head_at[t.id])
            if kit is None:
                continue
            lay, white = kit.lay, kit.white
            if not kit.held_strokes:
                (held,) = self.hold(("face", t.id), [(lay, white)])
                lay, white = held[0], (held[1] if held[1] is not None else white)
            canvas[lay] = 1000 + t.id
            canvas[white] = WHITE
            hair_p = hm & regions.get(t.id, np.zeros_like(hm))
            if hair_p.sum() >= 150:
                hc, th = _hair_pose(hair_p)
                self.last_faces[t.id] = {"hc": hc, "th": th,
                                         "jaw": t.sm[JAW, :2] * np.array([MW, MH], np.float32) - hc}
            self.held[t.id] = (lay, white, kit.head, 0)
            drawn.add(t.id)
        for fid, (lay, white, head0, n) in list(self.held.items()):
            if fid in drawn:
                continue
            if n >= HELD_FRAMES or fid not in head_at:
                del self.held[fid]
                continue
            dx, dy = (head_at[fid] - head0).round().astype(int)
            shift = np.float32([[1, 0, dx], [0, 1, dy]])
            l2 = cv2.warpAffine(lay.astype(np.uint8), shift, (W, H), flags=cv2.INTER_NEAREST) > 0
            w2 = cv2.warpAffine(white.astype(np.uint8), shift, (W, H), flags=cv2.INTER_NEAREST) > 0
            canvas[l2 & interior] = 1000 + fid
            canvas[w2 & interior] = WHITE
            self.held[fid] = (lay, white, head0, n + 1)
        for p in order:
            if p not in drawn and p not in self.held:
                self._jaw(canvas, p, hm & regions[p], interior, hair_t)
        live = {t.id for t in tracks}
        for fid in list(self.state):
            if fid not in live:
                del self.state[fid]
        return set(self.held)

    def _jaw(self, canvas, p, hair_p, interior, hair_t) -> None:
        """A head with hair but no face this frame: the last face's jaw line, turned with the hair and slid down
        until it shows below it."""
        H, W = canvas.shape
        if hair_p.sum() < 150:
            return
        hc, th = _hair_pose(hair_p)
        lf = self.last_faces.get(p)
        if lf is None and self.last_faces:
            q = min(self.last_faces.values(), key=lambda v: abs(v["hc"][0] - hc[0]))
            lf = q if abs(q["hc"][0] - hc[0]) < 60 else None
        if lf is None:
            return
        dth = float(np.clip(th - lf["th"], -0.5, 0.5))
        rm = np.array([[np.cos(dth), -np.sin(dth)], [np.sin(dth), np.cos(dth)]], np.float32)
        jaw = hc + (lf["jaw"] * np.array([1.0, 0.8], np.float32)) @ rm.T
        hair_d = cv2.dilate(hair_p.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
        for _ in range(40):
            ji = np.clip(np.round(jaw).astype(int), 0, [MW - 1, MH - 1])
            if hair_d[ji[:, 1], ji[:, 0]].mean() < 0.4:
                break
            jaw = jaw + np.array([0.0, 2.0], np.float32)
        pt = (jaw + 0.5) * np.array([W / MW, H / MH], np.float32) - 0.5
        m = poly_mask(open_chaikin(pt, 1), W, H) & interior & ~(cv2.dilate(hair_t.astype(np.uint8), CROSS) > 0)
        (held,) = self.hold(("jaw", p), [m])
        canvas[held[0] & (canvas == 0)] = 1000 + p

    def _kit(self, t: FaceTrack, st: FaceState, W, H, hair_t, interior, outline, clothes_t, head_pt) -> Kit | None:
        xy = t.sm
        lid, lip, eyes, roll, u, head = measures(xy, W, H)
        if head < 10:
            return None
        size = S if head < 26 else (M if head < 56 else L)
        U = 1.5 * u
        yaw = abs(st.yaw)
        lay, white, struct = (np.zeros((H, W), bool) for _ in range(3))
        Px = lambda i: np.array([xy[i, 0] * W, xy[i, 1] * H], np.float32)     # noqa: E731
        crv = lambda pts, closed=False, it=2: curve(pts, W, H, closed, it)     # noqa: E731
        mid = (eyes[0][0] + eyes[1][0]) / 2
        turn = 1.0 if Px(1)[0] >= mid[0] else -1.0
        near = 0 if eyes[0][2] >= eyes[1][2] else 1
        down = np.array([-np.sin(roll), np.cos(roll)], np.float32)
        centre = np.mean([Px(i) for i in OVAL5], 0)
        clear = interior & ~(cv2.dilate(hair_t.astype(np.uint8), CROSS) > 0) & \
            ~(cv2.dilate(outline.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0)    # 3 px clear of the outline
        kit = lambda lay_, held=False: Kit(lay_ & interior, white & interior, head_pt, held)   # noqa: E731
        if st.cls == "profile_or_down" and yaw > 50:            # profile: the near eye only, if it's open
            if lid[near] < 0.15:
                return None
            place(lay, white, KIT["profile_eye"]["-"][size], eyes[near][0], U, 0.0, W, H, mirror=turn)
            return kit(lay)
        if st.cls == "profile_or_down":                          # head down: lower face oval, a brow line, the nose
            struct |= crv([Px(i) for i in JAW]) & clear
            b0, b1 = eyes[0][1], eyes[1][1]
            struct |= crv([b0 + (b0 - b1) * 0.1, (b0 + b1) / 2 + down * 0.03 * U, b1 + (b1 - b0) * 0.1]) & clear
            place(lay, white, KIT["nose"]["frontal"][S if size == S else M], Px(1), U, roll, W, H, mirror=turn)
            return kit(lay | struct)
        three = st.cls == "three_quarter"
        drop_far = three and yaw > 32
        ev, mv, bv = st.expression(t.raw.blend, lip)
        # the face oval below the brows only: FAITH draws no line across the forehead
        brow_y = float(np.mean([Px(i)[1] for i in BROW_POINTS]))
        below = np.zeros((H, W), bool)
        below[max(0, int(brow_y) + 1):, :] = True
        struct |= crv([Px(i) for i in OVAL], closed=True) & clear & below
        for jaw_i in (172, 397):                                 # neck lines down to the clothes
            s0 = Px(jaw_i) * 0.7 + Px(152) * 0.3
            neck = crv([s0, s0 + down * 0.5 * u, s0 + down * 1.0 * u], it=1) & clear & ~clothes_t
            if neck.sum() >= 2:
                struct |= neck
        if not three:                                            # ears, where they're inside the figure, not hair
            for top, midp, low in ((127, 234, 93), (356, 454, 323)):
                out = Px(midp) - centre
                out /= max(np.hypot(*out), 1e-3)
                a_m = crv([Px(top) + out * 0.05 * u, Px(top) + out * 0.2 * u, Px(midp) + out * 0.24 * u,
                           Px(low) + out * 0.08 * u], it=1)
                if (a_m & clear).sum() >= 0.6 * max(a_m.sum(), 1):
                    struct |= a_m & clear
        if mv in ("smile", "grimace"):                           # cheek folds
            for wing, corner in ((129, 61), (358, 291)):
                w_, c_ = Px(wing), Px(corner)
                out = w_ - Px(1)
                out /= max(np.hypot(*out), 1e-3)
                struct |= crv([w_ + out * 0.05 * u, (w_ * 0.55 + c_ * 0.45) + out * 0.08 * u,
                               w_ * 0.2 + c_ * 0.8 + out * 0.05 * u], it=1) & clear
        if head < 30:                                            # small heads: white eye dots and a mouth line
            for k, (ec, _, _) in enumerate(eyes):
                if (drop_far and k != near) or ev == "closed":
                    continue
                p = Px(min(IRISES, key=lambda i: np.hypot(*(Px(i) - ec))))
                x, y = int(np.floor(p[0])), int(np.floor(p[1]))
                if 0 <= x < W and 0 <= y < H:
                    white[y, x] = True
            lay |= crv([Px(61), (Px(13) + Px(14)) / 2, Px(291)], it=1)
            return kit(lay | struct if head >= 20 else lay)
        if head >= 60:
            lay, white = self._closeup(t.id, Px, crv, eyes, near, drop_far, ev, mv, bv, struct, interior, u,
                                       head, three, turn, W, H)
            return Kit(lay, white, head_pt, True)
        for k, (ec, bc, _) in enumerate(eyes):
            if drop_far and k != near:
                continue
            mirror = 1.0 if ec[0] < mid[0] else -1.0
            E = (EYE_A, EYE_B)[k]
            eye_h = float(np.hypot(*(Px(E["up"]) - Px(E["lo"]))))
            pupil = None
            if ev in ("open", "wide") and not three:
                p = Px(min(IRISES, key=lambda i: np.hypot(*(Px(i) - ec))))
                if np.hypot(*(p - ec)) < 0.2 * u:
                    pupil = p + np.array([0.0, 0.5], np.float32)
            if eye_h >= 3 and ev in ("open", "wide", "narrowed"):
                ys = float(np.clip(lid[k] / 0.3, 0.6, 1.4))
                place(lay, white, ALMOND, ec, U, roll, W, H, mirror=mirror, yscale=ys, pupil=pupil)
            else:
                place(lay, white, KIT["eye"][ev][size], ec, U, roll, W, H, mirror=mirror, pupil=pupil)
            place(lay, white, KIT["brow"][bv][size], bc, U, roll, W, H, mirror=mirror)
        place(lay, white, KIT["nose"]["three_quarter" if three else "frontal"][size], Px(1), U, roll, W, H,
              mirror=turn)
        ys = float(np.clip(lip / 0.25, 0.7, 1.6)) if mv in ("open", "shout") else 1.0
        place(lay, white, KIT["mouth"][mv][size], (Px(13) + Px(14)) / 2, U * (0.85 if three else 1.0) * 0.8, roll,
              W, H, yscale=ys)
        return kit(lay | struct)

    def _closeup(self, fid, Px, crv, eyes, near, drop_far, ev, mv, bv, struct, interior, u, head, three, turn,
                 W, H):
        """The mesh traced the way FAITH traces a close-up face; each stroke held still on its own."""
        strokes, whites = {}, {}
        for k in (0, 1):
            if drop_far and k != near:
                continue
            ec = eyes[k][0]
            if ev == "closed":
                strokes[f"eye{k}"] = crv([(Px(a) + Px(b)) / 2 for a, b in zip(LID_UP[k], LID_LO[k])])
            else:
                lo = [Px(i) for i in LID_LO[k]]
                if ev == "narrowed":
                    lo = [Px(a) * 0.35 + Px(b) * 0.65 for a, b in zip(LID_UP[k], LID_LO[k])]
                strokes[f"eye{k}"] = crv([Px(i) for i in LID_UP[k]]) | crv(lo)
                if not three:
                    p = Px(min(IRISES, key=lambda i: np.hypot(*(Px(i) - ec))))
                    w_ = np.zeros((H, W), bool)
                    x, y = int(np.floor(p[0])), int(np.floor(p[1]))
                    if 0 <= x < W and 0 <= y < H:
                        w_[y, x] = True
                    whites[f"eye{k}"] = w_
            lift = np.array([0.0, {"raised": -0.06, "furrowed": 0.04}.get(bv, 0.0) * u], np.float32)
            b_mid = [(Px(a) + Px(b)) / 2 + lift for a, b in BROW_PAIRS[k]]
            if bv == "furrowed":                                 # the inner end drops
                b_mid[-1] = b_mid[-1] + np.array([0.0, 0.06 * u], np.float32)
            bm = crv(b_mid)
            if head >= 90:
                bm |= crv([Px(i) + lift for i in BROW_UP[k]])
            strokes[f"brow{k}"] = bm
        far_alar = 98 if turn < 0 else 327
        inner_eye = 133 if far_alar == 98 else 362
        strokes["bridge"] = crv([Px(168) * 0.7 + Px(inner_eye) * 0.3, Px(197) * 0.7 + Px(far_alar) * 0.3,
                                 Px(195) * 0.55 + Px(far_alar) * 0.45, Px(far_alar)], it=1)
        strokes["nostril"] = crv([Px(98), Px(97), Px(2), Px(326), Px(327)], it=1)
        if mv in ("open", "shout", "grimace"):
            strokes["lip_up"] = crv([Px(61)] + [Px(i) for i in IN_UP[1:-1]] + [Px(291)])
            strokes["lip_in_lo"] = crv([Px(61)] + [Px(i) for i in IN_LO[1:-1]] + [Px(291)])
        else:
            strokes["lip_up"] = crv([Px(61)] + [(Px(a) + Px(b)) / 2 for a, b in zip(IN_UP[1:-1], IN_LO[1:-1])]
                                    + [Px(291)])
        strokes["lip_lo"] = crv([Px(181), Px(84), Px(17), Px(314), Px(405)], it=1)
        strokes["struct"] = struct
        lay_all, white_all = np.zeros((H, W), bool), np.zeros((H, W), bool)
        for name, m in strokes.items():
            m = m & interior
            if name != "struct":
                m = remove_small(m, 3) if m.sum() >= 3 else np.zeros_like(m)
            (held,) = self.hold(("cu", fid, name), [(m, whites.get(name))])
            lay_all |= held[0]
            if held[1] is not None:
                white_all |= held[1]
        return lay_all & interior, white_all & interior


def _hair_pose(hair_p: np.ndarray) -> tuple[np.ndarray, float]:
    """The hair's centre (640x360 px) and the angle of its main axis."""
    mo = cv2.moments(hair_p.astype(np.uint8), True)
    hc = np.array([mo["m10"] / mo["m00"], mo["m01"] / mo["m00"]], np.float32)
    return hc, 0.5 * np.arctan2(2 * mo["mu11"], mo["mu20"] - mo["mu02"])


def profile_marks(img: np.ndarray, bare: dict[int, BareFace], kits: set[int], fig: np.ndarray) -> set[int]:
    """A profile mark for each bare box turned past PROFILE_YAW whose face has no kit drawn: v7's profile eye inside
    the box and a short nose line at the edge it turns to, inside the figure (1 px of slack for the nose on the
    outline). Returns the face ids marked."""
    H, W = img.shape
    allowed = cv2.dilate((cv2.resize(fig.astype(np.uint8), (W, H), interpolation=cv2.INTER_NEAREST) > 0)
                         .astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    marked = set()
    for fid, b in bare.items():
        f: FaceBox = b.face
        if fid in kits or abs(f.yaw) <= PROFILE_YAW:
            continue
        x0, y0, x1, y1 = np.array(f.box) * [W, H, W, H]
        bw, bh = x1 - x0, y1 - y0
        U = 1.5 * 0.35 * bh                                     # the kit's unit for a face this tall
        size = S if 1.3 * bh < 26 else (M if 1.3 * bh < 56 else L)
        turn = 1.0 if f.yaw > 0 else -1.0
        lay, white = np.zeros((H, W), bool), np.zeros((H, W), bool)
        place(lay, white, KIT["profile_eye"]["-"][size], ((x0 + x1) / 2 + turn * 0.15 * bw, y0 + 0.38 * bh), U, 0.0,
              W, H, mirror=turn)
        place(lay, white, PROFILE_NOSE[size], (x1 if turn > 0 else x0, y0 + 0.6 * bh), U, 0.0, W, H, mirror=turn)
        lay &= allowed
        if lay.any():
            img[lay] = 1000 + fid
            marked.add(fid)
    return marked
