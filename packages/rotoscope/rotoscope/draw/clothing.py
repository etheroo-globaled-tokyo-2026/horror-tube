"""Clothing lines inside a figure, from SCHP (Self-Correction Human Parsing, LIP's 20 body parts) on MPS: the coat's
edges inside the figure (a jacket opening) as 1-3 straight strokes, the arms' edges as smooth curves."""
from __future__ import annotations

import cv2
import numpy as np

from rotoscope import devices
from rotoscope.draw.holds import StrokeHold
from rotoscope.draw.lines import internal_runs, open_chaikin, poly_mask, square_crop, straight
from rotoscope.types import ANALYSIS_H as MH
from rotoscope.types import ANALYSIS_W as MW

SCHP_ID = "pirocheto/schp-lip-20"
# the model's code comes from its Hugging Face repo (trust_remote_code), so it is pinned to one revision
SCHP_REVISION = "7c0028fe34dcd8bd534ffa291a9086cdc856e4a9"
SCHP_SIDE = 473
SCHP_MEAN = np.array([0.406, 0.456, 0.485], np.float32)      # SCHP's BGR-order constants, applied to RGB as trained
SCHP_STD = np.array([0.225, 0.224, 0.229], np.float32)
LEFT_ARM, RIGHT_ARM, COAT = 14, 15, 7
CLOTHES = (5, 6, 7, 10, 11)          # upper clothes, dress, coat, jumpsuit, scarf


class Parser:
    """SCHP on a square crop round each figure; class scores pasted back at 640x360."""

    def __init__(self):
        self.dev = devices.torch_device("SCHP clothing parser (schp-lip-20)")
        # imported here: torch must come after devices.block_mps_fallback(), which torch_device runs
        import torch
        from transformers import AutoModelForSemanticSegmentation

        self.torch = torch
        self.net = AutoModelForSemanticSegmentation.from_pretrained(
            SCHP_ID, revision=SCHP_REVISION, trust_remote_code=True).eval().to(self.dev)

    def __call__(self, src: np.ndarray, pmap: np.ndarray) -> np.ndarray:
        """(20, 360, 640) part scores for every figure of at least 1500 px in the id map; background elsewhere."""
        k = src.shape[1] / MW
        out = np.zeros((20, MH, MW), np.float32)
        out[0] = 1.0
        for p in np.unique(pmap[pmap >= 0]):
            m = pmap == p
            if m.sum() < 1500:
                continue
            ys, xs = np.nonzero(m)
            x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
            crop, cx0, cy0 = square_crop(src, (x0 + x1) / 2 * k, (y0 + y1) / 2 * k, max(x1 - x0, y1 - y0) * 1.1 * k)
            x = (cv2.resize(crop, (SCHP_SIDE, SCHP_SIDE), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255
                 - SCHP_MEAN) / SCHP_STD
            with self.torch.no_grad():
                px = self.torch.from_numpy(x.transpose(2, 0, 1)[None].copy()).to(self.dev)
                pr = self.torch.softmax(self.net(pixel_values=px).logits[0], 0).cpu().numpy()
            sm = crop.shape[0] / k
            M = np.array([[sm / SCHP_SIDE, 0, cx0 / k], [0, sm / SCHP_SIDE, cy0 / k]], np.float32)
            reg = cv2.dilate(m.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
            for c in range(20):
                w = cv2.warpAffine(pr[c], M, (MW, MH), flags=cv2.INTER_LINEAR, borderValue=1.0 if c == 0 else 0.0)
                out[c][reg] = w[reg]
        return out


def inner_strokes(parse: np.ndarray, regions: dict, small: dict, order: list[int], hold: StrokeHold,
                  W: int, H: int) -> np.ndarray:
    """Label layer (1000 + figure id) of each figure's arm and coat edges that lie inside it, each stroke held still
    on its own while the outline animates."""
    layer = np.zeros((H, W), np.int32)
    sxy = np.array([W / MW, H / MH], np.float32)
    for p in order:
        dt_in = cv2.distanceTransform(regions[p].astype(np.uint8), cv2.DIST_L2, 3)
        strokes = []
        for part, style in ((LEFT_ARM, "curve"), (RIGHT_ARM, "curve"), (COAT, "straight")):
            m = (parse == part) & regions[p]
            m = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 2.0) >= 0.5
            if m.sum() < 300:
                continue
            cs, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
            for c in cs:
                if cv2.contourArea(c) < 300:
                    continue
                for run in internal_runs(c[:, 0], dt_in):
                    if len(run) < 8:
                        continue
                    seg = run.astype(np.float32)
                    poly = None
                    if style == "straight":
                        poly = straight(seg)
                        dev = cv2.distanceTransform((~poly_mask(poly, MW, MH)).astype(np.uint8), cv2.DIST_L2, 3)
                        ix = np.clip(seg[:, 0].astype(int), 0, MW - 1)
                        iy = np.clip(seg[:, 1].astype(int), 0, MH - 1)
                        if float(dev[iy, ix].max()) > 5:          # too bent for straight pieces
                            poly = None
                    if poly is None:
                        poly = open_chaikin(
                            cv2.approxPolyDP(seg.reshape(-1, 1, 2), 2.5, False)[:, 0].astype(np.float32), 2)
                    pt = (poly + 0.5) * sxy - 0.5
                    if len(pt) < 2 or np.hypot(*np.diff(pt, axis=0).T).sum() < 6:
                        continue
                    strokes.append(poly_mask(pt, W, H))
        inside = cv2.erode(small[p].astype(np.uint8), np.ones((3, 3), np.uint8), iterations=1) > 0
        for mm, _ in hold(("inner", p), strokes):
            ok = mm & inside & (layer == 0)
            layer[ok] = 1000 + p
    return layer
