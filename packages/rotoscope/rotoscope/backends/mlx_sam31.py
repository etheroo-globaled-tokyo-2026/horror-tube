"""SAM 3.1 on the Mac GPU (MLX, mlx-vlm), a Segmenter.

One backbone pass per frame serves every prompt. The finder runs on every frame; SAM 3.1's own tracker follows each
character and prop it is sure of into the frames after. A tracked object takes the find that matches it best (one find
per track); where the finder has it, its mask is the finder's, and where only the tracker has it, the tracker's (a
fill), so a prop the finder loses for a few frames keeps its mask. The tracker restarts from its latest masks every
RESEED frames and whenever a track starts: run alone, its masks drift and each step costs more. Every track ends at a
cut. Hands, blood and lights are found by the finder only.

Find.score is what the finder gave the object in that frame; a fill the finder missed scores 0."""
from __future__ import annotations

import logging
import time
from typing import Sequence

import cv2
import numpy as np
from PIL import Image

from rotoscope import devices
from rotoscope.types import ANALYSIS_H as MH
from rotoscope.types import ANALYSIS_W as MW
from rotoscope.types import Find, Prompt

log = logging.getLogger(__name__)

MODEL_ID = "mlx-community/sam3.1-bf16"
TRACKED = ("cast", "prop")
FINDER_FLOOR = 0.1       # finds the finder returns, for the rules to judge
FLOOR = {"hand": 0.25, "blood": 0.3, "light": 0.3}      # finder-only kinds, at the floors their rules were set on
GOOD = 0.25              # a find this sure gives a tracked object its mask
START = 0.4              # a find this sure starts a track
VISIBLE = 0.5            # the tracker's visibility at which a tracked object is kept from the tracker's own mask
SAME = 0.3               # mask overlap (IoU) at which a find is an object already tracked
RESEED = 8               # frames between tracker restarts
MIN_PX = 12              # masks smaller than this at 640x360 aren't returned
PROGRESS_S = 5.0


def _small(m) -> np.ndarray:
    return cv2.resize(np.asarray(m).astype(np.uint8), (MW, MH), interpolation=cv2.INTER_NEAREST) > 0


def _iou(a: np.ndarray, b: np.ndarray) -> float:
    return (a & b).sum() / max(1, (a | b).sum())


def _match(track: np.ndarray, find: np.ndarray) -> float:
    """How well a find matches a track's mask: their IoU; or, when the track's mask has shrunk inside the object (it
    drifts between restarts), a bare pass if most of it lies inside the find."""
    o = _iou(find, track)
    return o if o >= SAME or (find & track).sum() < 0.7 * max(1, track.sum()) else SAME


def _box(m: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.nonzero(m)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


class MlxSam31:
    def __init__(self, model_id: str = MODEL_ID):
        devices.block_mps_fallback()
        devices.mlx_gpu(f"SAM 3.1 ({model_id})")
        # imported here: mlx-vlm imports transformers, which can import torch, and torch must come after
        # devices.block_mps_fallback()
        import mlx.core as mx
        from mlx_vlm.models.sam3.generate import Sam3Predictor
        from mlx_vlm.models.sam3_1 import generate as sam31
        from mlx_vlm.models.sam3_1.processing_sam3_1 import Sam31Processor
        from mlx_vlm.utils import get_model_path, load_model

        self.mx, self.sam = mx, sam31
        path = get_model_path(model_id)
        self.model = load_model(path)
        self.predictor = Sam3Predictor(self.model, Sam31Processor.from_pretrained(str(path)),
                                       score_threshold=FINDER_FLOOR)

    def find(self, frames: Sequence[np.ndarray], prompts: Sequence[Prompt], cuts: Sequence[int]) -> list[list[Find]]:
        texts = list(dict.fromkeys(p.text for p in prompts))
        by_text = {t: [p for p in prompts if p.text == t] for t in texts}
        tracked = {t for t in texts if any(p.kind in TRACKED for p in by_text[t])}
        out = []
        for frame in self._run(frames, texts, tracked, set(cuts)):
            finds = []
            for text, score, track, fill, mask in frame:
                if mask.sum() < MIN_PX:
                    continue
                box = _box(mask)
                for i, p in enumerate(by_text[text]):
                    m = mask if i == 0 else mask.copy()     # prompts sharing a text don't share one mutable mask
                    if p.kind in TRACKED:
                        finds.append(Find(p.kind, p.key, score, m, box, track, fill))
                    elif not fill and score >= FLOOR[p.kind]:
                        finds.append(Find(p.kind, p.key, score, m, box))
            out.append(finds)
        return out

    def _run(self, frames, texts, tracked, cut_at):
        """Per frame, a list of (text, the finder's score or 0, track id or None, fill, mask at 640x360)."""
        mx, sam = self.mx, self.sam
        tracks, state, step, out, next_id = [], None, 0, [], 0
        t0 = last = time.monotonic()
        for k, f in enumerate(frames):
            if k in cut_at:                                      # a new shot: nothing tracked carries across a cut
                tracks, state, step = [], None, 0
            img = Image.fromarray(np.asarray(f))
            feats = sam._get_backbone_features(
                self.model, mx.array(self.predictor.processor.preprocess_image(img)["pixel_values"]))
            r = sam._detect_with_backbone(self.predictor, feats, texts, img.size, FINDER_FLOOR, encoder_cache={})
            finds = [{"text": r.labels[i], "score": float(r.scores[i]), "full": np.asarray(r.masks[i]),
                      "mask": _small(r.masks[i])} for i in range(len(r.scores))]
            seen = []
            if state is not None:
                step += 1
                t = sam._propagate_tracker(self.model, state, feats, step, len(tracks), img.size)
                seen = [(tr, float(t.scores[i]), np.asarray(t.masks[i])) for i, tr in enumerate(tracks)]
            masks = [_small(full) for _, _, full in seen]
            pairs = sorted(((_match(m, fd["mask"]), t, j) for t, ((tr, _, _), m) in enumerate(zip(seen, masks))
                            for j, fd in enumerate(finds) if fd["text"] == tr["text"]), reverse=True)
            taken, used = {}, set()
            for o, t, j in pairs:                                # the best overlap first, one find per track
                if o >= SAME and t not in taken and j not in used:
                    taken[t] = j
                    used.add(j)
            now, keep = [], []
            for t, ((tr, vis, full), m) in enumerate(zip(seen, masks)):
                best = finds[taken[t]] if t in taken else None
                if best is not None and best["score"] >= GOOD:      # the finder has it: its mask
                    now.append((tr["text"], best["score"], tr["id"], False, best["mask"]))
                    keep.append((tr, best["full"]))
                elif vis >= VISIBLE:                                 # only the tracker has it: a fill
                    now.append((tr["text"], 0.0 if best is None else best["score"], tr["id"], True, m))
                    keep.append((tr, full))
                elif best is not None:                               # lost for now: its weak find stays a plain find
                    used.discard(taken[t])
            # a sure find no track covers starts one; it carries the new track's id from this frame on
            new = {j: next_id + n for n, j in enumerate(
                j for j, fd in enumerate(finds) if j not in used and fd["score"] >= START and fd["text"] in tracked)}
            next_id += len(new)
            now += [(fd["text"], fd["score"], new.get(j), False, fd["mask"])
                    for j, fd in enumerate(finds) if j not in used]
            out.append(now)
            if new or (state is not None and step >= RESEED):
                for j, tid in new.items():
                    keep.append(({"text": finds[j]["text"], "id": tid}, finds[j]["full"]))
                if keep:
                    state = sam._init_tracker_state(self.model, feats, [full.astype(np.float32) for _, full in keep])
                    tracks, step = [tr for tr, _ in keep], 0
                else:
                    state, tracks = None, []
            if time.monotonic() - last >= PROGRESS_S or k == len(frames) - 1:
                log.info("SAM 3.1: %d/%d frames, %.2f s a frame, %d tracked", k + 1, len(frames),
                         (time.monotonic() - t0) / (k + 1), len(tracks))
                last = time.monotonic()
        return out
