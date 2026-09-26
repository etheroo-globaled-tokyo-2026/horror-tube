"""The rotoscope over HTTP.
    POST /v1/rotoscope   multipart/form-data: "video" (mp4) and "shots" (the shot list JSON) -> the drawing as mp4
    GET  /healthz        the device and backends
Every error is JSON: {"error": what failed, "detail": {...}}. Jobs run one at a time on one worker thread, since each
needs the whole GPU. A request's time limit counts from its arrival, waiting included: past it the reply is 504 and
the job stops at its next step."""
import asyncio
import logging
import shutil
import tempfile
import time
import uuid
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from rotoscope import pipeline, shots, video
from rotoscope.config import Config
from rotoscope.pipeline import StageFailed, TimeLimit
from rotoscope.types import HandFinder, PeopleDrawer, Segmenter

log = logging.getLogger(__name__)
SHOTS_MAX_BYTES = 1 << 20


def error(status: int, what: str, **detail) -> JSONResponse:
    return JSONResponse({"error": what, "detail": detail}, status_code=status)


def _remove(job: str, path: Path) -> None:
    shutil.rmtree(path, onexc=lambda _fn, p, e: log.warning("job %s: couldn't remove %s: %s", job, p, e))


def create_app(cfg: Config, segmenter: Segmenter, hands: HandFinder, drawer: PeopleDrawer, device: str) -> Starlette:
    worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix="rotoscope")
    backends = {"segmenter": type(segmenter).__name__, "hands": type(hands).__name__, "drawer": type(drawer).__name__}
    limit = cfg.server.time_limit_s

    def run_job(job: str, src: Path, shot_list: shots.ShotList, deadline: float) -> tuple[bytes, int]:
        """Runs on the worker and removes src's directory when done. It logs its own end, since after a 504 no
        request is waiting for it."""
        try:
            if time.monotonic() > deadline:
                raise TimeLimit("past the time limit while waiting for the job before it")
            result = pipeline.rotoscope(src, shot_list, cfg, segmenter, hands, drawer, deadline)
            out = src.parent / "out.mp4"
            n = video.encode(result.frames, src, out, cfg.video)
            return out.read_bytes(), n
        except TimeLimit as e:
            log.warning("job %s stopped: %s", job, e)
            raise
        except Exception:
            log.exception("job %s failed", job)
            raise
        finally:
            _remove(job, src.parent)

    async def healthz(_: Request) -> JSONResponse:
        return JSONResponse({"ok": True, "device": device, "backends": backends})

    async def rotoscope(request: Request) -> Response:
        job = uuid.uuid4().hex[:8]
        started = time.monotonic()
        deadline = started + limit
        try:
            form = await request.form(max_files=2, max_fields=2, max_part_size=SHOTS_MAX_BYTES)
        except HTTPException as e:
            return error(400, "the body isn't readable multipart/form-data", job=job, reason=e.detail)
        try:
            video_part, shots_part = form.get("video"), form.get("shots")
            if not isinstance(video_part, UploadFile):
                return error(400, "no video part", job=job, parts=list(form.keys()))
            if shots_part is None:
                return error(400, "no shots part", job=job, parts=list(form.keys()))
            raw = await shots_part.read() if isinstance(shots_part, UploadFile) else shots_part
            try:
                shot_list = shots.parse(raw)
            except shots.ShotListError as e:
                return error(400, "bad shot list", job=job, problems=e.problems)
            tmp = Path(tempfile.mkdtemp(prefix=f"rotoscope-{job}-"))
            src = tmp / "in.mp4"
            with src.open("wb") as f:
                await run_in_threadpool(shutil.copyfileobj, video_part.file, f)
        finally:
            await form.close()
        try:
            p = await run_in_threadpool(video.probe, src, cfg.video)
        except video.VideoError as e:
            _remove(job, tmp)
            return error(400, "the video can't be read", job=job, reason=str(e))
        log.info("job %s: %dx%d, %.1f s, audio %s, %d shots", job, p.width, p.height, p.duration_s,
                 "yes" if p.has_audio else "no", len(shot_list.shots))
        submitted = worker.submit(run_job, job, src, shot_list, deadline)
        try:
            data, n = await asyncio.wait_for(asyncio.wrap_future(submitted), timeout=max(0.0, deadline - time.monotonic()))
        except TimeoutError:
            if submitted.cancelled():
                _remove(job, tmp)
            log.warning("job %s: past the time limit of %.0f s", job, limit)
            return error(504, f"past the time limit of {limit:.0f} s", job=job,
                         seconds=round(time.monotonic() - started, 1))
        except StageFailed as e:
            return error(500, f"rotoscope failed while {e.stage}", job=job, stage=e.stage, frame=e.frame,
                         reason=str(e))
        except video.VideoError as e:
            return error(500, "encoding the drawing failed", job=job, reason=str(e))
        except Exception as e:
            return error(500, "rotoscope failed", job=job, reason=f"{type(e).__name__}: {e}")
        seconds = time.monotonic() - started
        log.info("job %s: %d frames in %.1f s", job, n, seconds)
        return Response(data, media_type="video/mp4", headers={
            "X-Rotoscope-Frames": str(n), "X-Rotoscope-Seconds": f"{seconds:.1f}", "X-Rotoscope-Job": job})

    async def http_error(_: Request, e: HTTPException) -> JSONResponse:
        return error(e.status_code, str(e.detail))

    async def unhandled(request: Request, e: Exception) -> JSONResponse:
        log.error("%s %s failed", request.method, request.url.path, exc_info=e)
        return error(500, "rotoscope server error", reason=f"{type(e).__name__}: {e}")

    @asynccontextmanager
    async def lifespan(_: Starlette):
        yield
        worker.shutdown(wait=False, cancel_futures=True)

    return Starlette(routes=[Route("/v1/rotoscope", rotoscope, methods=["POST"]),
                             Route("/healthz", healthz, methods=["GET"])],
                     exception_handlers={HTTPException: http_error, Exception: unhandled}, lifespan=lifespan)
