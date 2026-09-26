"""Video in and out through ffmpeg: decode at the drawing's frame rate, centre-cropped to 16:9, find the cuts, and
encode palette frames to H.264 with the source's audio copied."""
import json
import logging
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence

import cv2
import numpy as np

from rotoscope.config import Video
from rotoscope.palette import to_rgb
from rotoscope.types import DRAW_H, DRAW_W

log = logging.getLogger(__name__)


class VideoError(RuntimeError):
    """ffmpeg couldn't read or write a video."""


@dataclass(frozen=True)
class Probe:
    width: int
    height: int
    duration_s: float
    has_audio: bool


def _run(cmd: list[str], timeout: float, what: str) -> subprocess.CompletedProcess:
    try:
        done = subprocess.run(cmd, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired as e:
        raise VideoError(f"{what}: ffmpeg took over {timeout:.0f} s") from e
    if done.returncode != 0:
        raise VideoError(f"{what}: {done.stderr.decode(errors='replace').strip() or f'exit {done.returncode}'}")
    return done


def probe(path: Path, cfg: Video) -> Probe:
    out = _run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration",
                "-of", "json", str(path)], cfg.ffmpeg_timeout_s, f"reading {path.name}").stdout
    info = json.loads(out)
    streams = info.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    if video is None:
        raise VideoError(f"reading {path.name}: no video stream")
    return Probe(int(video["width"]), int(video["height"]), float(info.get("format", {}).get("duration", 0.0)),
                 any(s.get("codec_type") == "audio" for s in streams))


def crop_16_9(width: int, height: int) -> tuple[int, int]:
    """The largest centred 16:9 crop, in even pixels."""
    if width * 9 > height * 16:
        return int(height * 16 / 9) // 2 * 2, height // 2 * 2
    return width // 2 * 2, int(width * 9 / 16) // 2 * 2


def decode(path: Path, workdir: Path, cfg: Video) -> np.memmap:
    """Every frame at cfg.fps, centre-cropped to 16:9 at the source's size: (n, h, w, 3) RGB uint8, mapped from a
    file in workdir so the frames stay on disk until read. Copy-on-write: writing to a frame never changes the
    file."""
    p = probe(path, cfg)
    w, h = crop_16_9(p.width, p.height)
    raw = workdir / "frames.rgb"
    _run(["ffmpeg", "-v", "error", "-y", "-i", str(path), "-vf", f"fps={cfg.fps},crop={w}:{h}", "-f", "rawvideo",
          "-pix_fmt", "rgb24", str(raw)], cfg.ffmpeg_timeout_s, f"decoding {path.name}")
    n = raw.stat().st_size // (w * h * 3)
    if n == 0:
        raise VideoError(f"decoding {path.name}: no frames")
    log.info("decoded %s: %d frames at %d fps, %dx%d from %dx%d", path.name, n, cfg.fps, w, h, p.width, p.height)
    return np.memmap(raw, np.uint8, mode="c", shape=(n, h, w, 3))


def cuts(frames: Sequence[np.ndarray], cfg: Video) -> list[int]:
    """Frame indices where a new shot starts: the grey-level histogram of a small copy changes by more than cfg.cut
    (half the L1 distance of the normalised histograms) from the frame before."""
    hists = []
    for f in frames:
        g = cv2.cvtColor(cv2.resize(np.asarray(f), cfg.cut_size, interpolation=cv2.INTER_AREA), cv2.COLOR_RGB2GRAY)
        h = cv2.calcHist([g], [0], None, [cfg.cut_bins], [0, 256]).ravel()
        hists.append(h / h.sum())
    return [k for k in range(1, len(hists)) if 0.5 * float(np.abs(hists[k] - hists[k - 1]).sum()) > cfg.cut]


def encode(frames: Iterable[np.ndarray], audio_from: Path, out: Path, cfg: Video) -> int:
    """Palette frames (DRAW_H, DRAW_W) to an H.264 yuv420p mp4 at cfg.scale times the size, each palette pixel a
    block of cfg.scale x cfg.scale, with audio_from's audio copied unchanged. Returns the frame count."""
    w, h = DRAW_W * cfg.scale, DRAW_H * cfg.scale
    cmd = ["ffmpeg", "-v", "error", "-y",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", str(cfg.fps), "-i", "-",
           "-i", str(audio_from), "-map", "0:v:0", "-map", "1:a?",
           # tagged BT.709 so players show the palette's own colours
           "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
           "-c:v", "libx264", "-preset", "medium", "-tune", "animation", "-crf", str(cfg.crf),
           "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
           "-c:a", "copy", "-movflags", "+faststart", str(out)]
    n = 0
    with tempfile.TemporaryFile() as err:
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=err)
        try:
            for f in frames:
                big = cv2.resize(to_rgb(f), (w, h), interpolation=cv2.INTER_NEAREST)
                proc.stdin.write(big.tobytes())
                n += 1
            proc.stdin.close()
            proc.wait(timeout=cfg.ffmpeg_timeout_s)
        except BrokenPipeError:
            proc.wait(timeout=cfg.ffmpeg_timeout_s)
        except BaseException:
            proc.kill()
            proc.wait()
            raise
        if proc.returncode != 0:
            err.seek(0)
            raise VideoError(f"encoding {out.name}: {err.read().decode(errors='replace').strip()}")
    if n == 0:
        raise VideoError(f"encoding {out.name}: no frames")
    log.info("encoded %s: %d frames at %dx%d", out.name, n, w, h)
    return n
