import json
import subprocess
import time

import pytest
from kit import FakeDrawer, FakeHands, FakeSegmenter, fight_frames, write_clip
from starlette.testclient import TestClient

from rotoscope.config import Config, Server
from rotoscope.server import create_app

CAST = {"id": "A", "name": "Freddy Krueger", "find": "man in a red and green striped sweater", "side": "left"}
SHOT = {"start_s": 0.0, "end_s": 2.0, "cast": [CAST], "props": [{"find": "knife", "holder": "A"}]}


@pytest.fixture(scope="module")
def clip(tmp_path_factory):
    return write_clip(tmp_path_factory.mktemp("clip") / "clip.mp4", fight_frames(30, cut=15))


def post(clip, shots=None, limit=600.0, delay_s=0.0, parts=("video", "shots")):
    app = create_app(Config(server=Server(time_limit_s=limit)), FakeSegmenter(delay_s), FakeHands(), FakeDrawer(),
                     "mps")
    shots = shots if shots is not None else {"shots": [SHOT]}
    files = {"video": ("clip.mp4", clip.read_bytes(), "video/mp4")} if "video" in parts else None
    data = {"shots": shots if isinstance(shots, str) else json.dumps(shots)} if "shots" in parts else None
    with TestClient(app) as c:
        return c.post("/v1/rotoscope", files=files, data=data)


def streams(mp4: bytes, tmp_path) -> list[dict]:
    path = tmp_path / "out.mp4"
    path.write_bytes(mp4)
    out = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(path)], check=True,
                         capture_output=True).stdout
    return json.loads(out)["streams"]


def test_a_clip_comes_back_drawn_at_4x_with_its_audio(clip, tmp_path):
    r = post(clip)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "video/mp4"
    assert r.headers["x-rotoscope-frames"] == "30" and float(r.headers["x-rotoscope-seconds"]) > 0
    got = streams(r.content, tmp_path)
    v = next(s for s in got if s["codec_type"] == "video")
    assert (v["codec_name"], v["width"], v["height"], v["pix_fmt"], v["r_frame_rate"]) == \
        ("h264", 1024, 576, "yuv420p", "15/1")
    assert [s["codec_name"] for s in got if s["codec_type"] == "audio"] == ["aac"]


@pytest.mark.parametrize("shots, problem", [
    ("{not json", "not JSON"),
    ({"shots": [{**SHOT, "cast": [{**CAST, "find": "a very tall man in a long dark coat and hat"}]}]}, "words"),
    ({"shots": [{**SHOT, "props": [{"find": "knife", "holder": "C"}]}]}, "holder"),
    ({"shots": [{**SHOT, "cast": [{**CAST, "side": "above"}]}]}, "side"),
])
def test_a_bad_shot_list_is_refused_saying_what_is_wrong(clip, shots, problem):
    r = post(clip, shots)
    assert r.status_code == 400
    body = r.json()
    assert body["error"] == "bad shot list" and any(problem in p for p in body["detail"]["problems"])


def test_a_request_without_a_video_is_refused(clip):
    r = post(clip, parts=("shots",))
    assert r.status_code == 400 and r.json()["error"] == "no video part"


def test_a_job_past_the_time_limit_gets_504_at_the_limit(clip):
    t0 = time.monotonic()
    r = post(clip, limit=0.5, delay_s=2.0)
    assert r.status_code == 504 and "time limit" in r.json()["error"]
    assert time.monotonic() - t0 < 2.0


def test_healthz_names_the_device_and_backends():
    app = create_app(Config(), FakeSegmenter(), FakeHands(), FakeDrawer(), "mps")
    with TestClient(app) as c:
        body = c.get("/healthz").json()
    assert body == {"ok": True, "device": "mps",
                    "backends": {"segmenter": "FakeSegmenter", "hands": "FakeHands", "drawer": "FakeDrawer"}}
