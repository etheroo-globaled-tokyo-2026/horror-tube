# rotoscope

Redraws a fight video as FAITH-style line art: 256x144 at 15 fps, one colour per character, props outlined, blood in
its own colour. The fight pipeline calls it over HTTP. Every model runs on the Mac's GPU or Neural Engine: SAM 3.1 on
MLX finds the characters, props and blood; Apple Vision finds hands and faces; v7's drawer (MediaPipe, SCHP on MPS)
draws the people.

## Install

Python 3.12 on Apple silicon, with `ffmpeg` and `ffprobe` on the PATH.

```sh
cd packages/rotoscope
UV_EXCLUDE_NEWER=2026-09-22T00:00:00Z uv sync
```

## Run

```sh
uv run rotoscope serve --port 8765                                  # --host (127.0.0.1), --time-limit (600 s)
uv run rotoscope run clip.mp4 --shots shots.json --out out.mp4      # --time-limit (none)
```

## HTTP

**`POST /v1/rotoscope`**, `multipart/form-data`: a `video` part (mp4) and a `shots` part (the shot list below).

- **200:** `video/mp4`, 1024x576 (the 256x144 drawing at 4x, nearest neighbour), 15 fps, H.264 yuv420p, the input's
  audio copied unchanged. Headers: `X-Rotoscope-Frames`, `X-Rotoscope-Seconds`, `X-Rotoscope-Job`.
- **400** bad input, **500** failure, **504** past the time limit. Body: `{"error": "<what failed>", "detail": {...}}`.
- Jobs run one at a time; the time limit counts from the request's arrival.

**`GET /healthz`:** `{"ok": true, "device": "mps", "backends": {...}}`.

The shot list:

```json
{"shots": [{"start_s": 0.0, "end_s": 5.0,
  "cast": [{"id": "A", "name": "Freddy Krueger", "find": "man in a red and green striped sweater"},
           {"id": "B", "name": "Xenomorph", "find": "black alien creature"}],
  "props": [{"find": "bladed glove", "holder": "A"}]}]}
```

- `find`: a plain noun phrase SAM 3.1 searches for, at most 8 words. Characters are found by it, never as "person".
- `id`: `A` to `D`, at most 4 per shot.
- `side` (optional): `left`, `center` or `right`, where they start. Required when two cast members in a shot share a
  `find`: it's the only way to tell them apart.
- `props` (optional): `holder` is a cast id or `"loose"`. A prop the list doesn't name isn't drawn. With no held prop,
  no hands are looked for.

## Environment

- `ROTO_CPU=1`: lets a model with no GPU path run on the CPU. Without it, building one raises.
- `ROTOSCOPE_MODELS`: MediaPipe's model files, downloaded on first use. Default `~/.cache/rotoscope/mediapipe`.
- `HF_HOME`: the Hugging Face cache for SAM 3.1 (`mlx-community/sam3.1-bf16`) and SCHP, downloaded on first use.
  Default `~/.cache/huggingface`; `HF_HUB_OFFLINE=1` once they're there.

## Tests

```sh
UV_EXCLUDE_NEWER=2026-09-22T00:00:00Z uv run pytest -m "not slow"   # the core, no GPU
UV_EXCLUDE_NEWER=2026-09-22T00:00:00Z uv run pytest                 # plus the models, on the GPU
```
