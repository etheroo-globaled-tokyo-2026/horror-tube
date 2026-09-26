"""The rotoscope: a video and its shot list in, one palette frame per video frame out. The models come in through
the Segmenter, HandFinder and PeopleDrawer protocols, so these steps are the same on any host."""
import logging
import re
import tempfile
import time
from collections import Counter
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Sequence

import cv2
import numpy as np

from rotoscope import compose, gore, rules, video
from rotoscope.config import Config
from rotoscope.palette import CAST
from rotoscope.shots import ShotList
from rotoscope.types import ANALYSIS_H, ANALYSIS_W, Figure, HandFinder, PeopleDrawer, Prompt, Segmenter

log = logging.getLogger(__name__)
PROGRESS_S = 5.0                    # seconds between progress lines in a per-frame step
NUMBER = re.compile(r"\d+(\.\d+)?( px)?")


@dataclass
class Result:
    frames: list[np.ndarray]        # uint8 (DRAW_H, DRAW_W) palette indices, one per decoded frame
    cuts: list[int]                 # frame indices where a new shot starts
    faces: list[set[str]]           # per frame, the cast ids with a face drawn


class TimeLimit(TimeoutError):
    """The job ran past its deadline."""


class StageFailed(RuntimeError):
    """A step raised. stage names the step; frame is the frame it was on, for a per-frame step."""

    def __init__(self, stage: str, frame: int | None, cause: BaseException):
        where = stage if frame is None else f"{stage}, frame {frame}"
        super().__init__(f"{where}: {type(cause).__name__}: {cause}")
        self.stage = stage
        self.frame = frame


class _Steps:
    """Checks the deadline before each step and names the step in anything it raises."""

    def __init__(self, deadline: float | None):
        self.deadline = deadline
        self.last_log = time.monotonic()

    @contextmanager
    def step(self, stage: str, frame: int | None = None) -> Iterator[None]:
        if self.deadline is not None and time.monotonic() > self.deadline:
            raise TimeLimit(f"past the time limit before {stage}" + ("" if frame is None else f", frame {frame}"))
        try:
            yield
        except (TimeLimit, StageFailed):
            raise
        except Exception as e:
            raise StageFailed(stage, frame, e) from e

    def progress(self, what: str, done: int, total: int) -> None:
        if done == total or time.monotonic() - self.last_log >= PROGRESS_S:
            log.info("%s: %d/%d frames", what, done, total)
            self.last_log = time.monotonic()


def summary(scenes: Sequence[rules.Scene]) -> str:
    """For the log: in how many frames each character and prop was drawn, and why the rest of their finds were
    dropped (numbers taken out, so each reason counts once)."""
    counts: Counter[str] = Counter()
    for s in scenes:
        counts.update(f"{cid} drawn" for cid in s.ids)
        counts.update(f"{p.key} {'loose' if s.holder(i) is None else 'held by ' + s.holder(i)}"
                      for i, p in enumerate(s.props))
        counts.update(f"{r.find.key} dropped, {NUMBER.sub('#', r.why)}" for r in s.rejected)
    return "; ".join(f"{k}: {v} frames" for k, v in sorted(counts.items()))


def prompts(shots: ShotList, cfg: Config) -> list[Prompt]:
    """Everything SAM is asked to find, once each: every shot's cast and props, blood, lights and hands."""
    asks = [Prompt("cast", c.id, c.find) for s in shots.shots for c in s.cast]
    asks += [Prompt("prop", p.find, p.find) for s in shots.shots for p in s.props]
    asks += [Prompt("blood", t, t) for t in cfg.gore.blood_prompts]
    asks += [Prompt("light", t, t) for t in cfg.gore.light_prompts]
    asks.append(Prompt("hand", cfg.rules.hand_prompt, cfg.rules.hand_prompt))
    return list(dict.fromkeys(asks))


def rotoscope(video_path: Path, shots: ShotList, cfg: Config, segmenter: Segmenter, hands: HandFinder,
              drawer: PeopleDrawer, deadline: float | None = None) -> Result:
    """Draws every frame of the video. deadline: a time.monotonic() value; past it the next step raises
    TimeLimit. A step that fails raises StageFailed naming it."""
    t0 = time.monotonic()
    steps = _Steps(deadline)
    with tempfile.TemporaryDirectory(prefix="rotoscope-") as tmp:
        with steps.step("decoding the video"):
            frames = video.decode(Path(video_path), Path(tmp), cfg.video)
        n = len(frames)
        with steps.step("finding the cuts"):
            cut_at = video.cuts(frames, cfg.video)
        runs = [rules.shot_of(cut_at, k) for k in range(n)]
        listed = [shots.at((k + 0.5) / cfg.video.fps) for k in range(n)]
        asks = prompts(shots, cfg)
        log.info("%d frames, cuts at %s; asking the segmenter for %s", n, cut_at,
                 ", ".join(f"{p.kind} {p.key}: {p.text!r}" for p in asks))
        with steps.step("finding the cast, props and blood"):
            finds = segmenter.find(frames, asks, cut_at)
            if len(finds) != n:
                raise ValueError(f"the segmenter returned finds for {len(finds)} frames of {n}")
        log.info("segmenter: %d finds in %.1f s", sum(len(f) for f in finds), time.monotonic() - t0)
        with steps.step("keeping finds"):
            kept = rules.decisions(finds, runs, cfg.rules)
        scenes = []
        for k in range(n):
            with steps.step("finding hands and who holds what", k):
                scenes.append(rules.assign(kept[k], hands.hands(np.asarray(frames[k])),
                                           rules.sam_hands(finds[k], cfg.rules), listed[k], cfg.rules))
            steps.progress("hands", k + 1, n)
        with steps.step("carrying holds and dropping set dressing"):
            scenes = rules.in_play(rules.carry(scenes, runs, cfg.rules), listed, cfg.rules)
        log.info("rules: %s", summary(scenes))
        out, faces, starts = [], [], {0, *cut_at}
        for k in range(n):
            with steps.step("drawing", k):
                if k in starts:
                    drawer.reset()
                frame, scene = np.asarray(frames[k]), scenes[k]
                drawn = drawer.draw(frame, [Figure(cid, f.mask, CAST[cid]) for f, cid in zip(scene.figures, scene.ids)])
                small = cv2.resize(frame, (ANALYSIS_W, ANALYSIS_H), interpolation=cv2.INTER_AREA)
                out.append(compose.compose(drawn.canvas, compose.props_of(scene),
                                           gore.blood(finds[k], small, cfg.gore), cfg))
                faces.append(set(drawn.faces))
            steps.progress("drawing", k + 1, n)
        del frames
    log.info("rotoscoped %s: %d frames, %d cuts, %.1f s", Path(video_path).name, n, len(cut_at), time.monotonic() - t0)
    return Result(out, cut_at, faces)
