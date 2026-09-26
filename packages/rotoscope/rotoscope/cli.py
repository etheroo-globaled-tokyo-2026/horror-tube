"""rotoscope run clip.mp4 --shots shots.json --out out.mp4
rotoscope serve --port 8765"""
import argparse
import logging
import os
import sys
import time
from dataclasses import replace
from pathlib import Path

import uvicorn

from rotoscope import devices, pipeline, shots, video
from rotoscope.config import Config
from rotoscope.server import create_app
from rotoscope.types import HandFinder, PeopleDrawer, Segmenter

log = logging.getLogger("rotoscope")


def mac_backends(cfg: Config) -> tuple[Segmenter, HandFinder, PeopleDrawer]:
    """SAM 3.1 on MLX, Apple Vision's hands and faces, and v7's people drawing. Imported here rather than at the top:
    they load MLX, torch and Vision, which the tests and --help don't need, and torch must come after the device
    guard."""
    devices.block_mps_fallback()
    from rotoscope.backends.apple_vision import AppleVision
    from rotoscope.backends.mlx_sam31 import MlxSam31
    from rotoscope.draw.people import V7Drawer

    models = Path(os.environ.get("ROTOSCOPE_MODELS", Path.home() / ".cache" / "rotoscope" / "mediapipe"))
    log.info("loading SAM 3.1, Apple Vision and the people drawing (MediaPipe files in %s)", models)
    vision = AppleVision()
    return MlxSam31(), vision, V7Drawer(vision, models, cfg.video.fps)


def run(args: argparse.Namespace, cfg: Config) -> int:
    try:
        shot_list = shots.parse(args.shots.read_bytes())
    except (OSError, shots.ShotListError) as e:
        log.error("%s: %s", args.shots, e)
        return 2
    segmenter, hands, drawer = mac_backends(cfg)
    t0 = time.monotonic()
    deadline = None if args.time_limit is None else t0 + args.time_limit
    result = pipeline.rotoscope(args.video, shot_list, cfg, segmenter, hands, drawer, deadline)
    n = video.encode(result.frames, args.video, args.out, cfg.video)
    with_face = sum(1 for f in result.faces if f)
    log.info("wrote %s: %d frames, cuts at %s, a face drawn in %d frames, %.1f s", args.out, n, result.cuts,
             with_face, time.monotonic() - t0)
    return 0


def serve(args: argparse.Namespace, cfg: Config) -> int:
    app = create_app(cfg, lambda: mac_backends(cfg), devices.accelerator())
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    return 0


def main(argv: list[str] | None = None) -> int:
    for var in ("HF_HUB_DISABLE_TELEMETRY", "DO_NOT_TRACK"):
        os.environ.setdefault(var, "1")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    cfg = Config()
    ap = argparse.ArgumentParser(prog="rotoscope", description="Fight videos as FAITH-style line drawings.")
    sub = ap.add_subparsers(dest="command", required=True)
    r = sub.add_parser("run", help="draw one video")
    r.add_argument("video", type=Path)
    r.add_argument("--shots", type=Path, required=True, help="the shot list JSON")
    r.add_argument("--out", type=Path, required=True, help="the mp4 to write")
    r.add_argument("--time-limit", type=float, default=None, help="seconds before it stops (default: none)")
    s = sub.add_parser("serve", help="serve POST /v1/rotoscope")
    s.add_argument("--port", type=int, default=8765)
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--time-limit", type=float, default=cfg.server.time_limit_s, help="seconds per request")
    args = ap.parse_args(argv)
    if args.command == "run":
        return run(args, cfg)
    return serve(args, replace(cfg, server=replace(cfg.server, time_limit_s=args.time_limit)))


if __name__ == "__main__":
    sys.exit(main())
