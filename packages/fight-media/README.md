# @horror-tube/fight-media

Upload fight mp4 bytes to DigitalOcean Spaces and return a durable public CDN URL for `RoundState.videoUrl`.

## Generator (fal) — not implemented here

Fight videos are generated with **fal MiniMax H3 Max text-to-video**:

- Docs: https://fal.ai/models/minimax/h3-max/text-to-video
- Model id: `minimax/h3-max/text-to-video` (operator value for `FAL_MODEL`; no default in source)
- Result: an mp4 at `video.url` on a `fal.media` host

Those fal URLs expire. `@horror-tube/fight` `runFightTurn` downloads the mp4 bytes, then calls `uploadFightVideo` so Spaces holds a durable copy. **Do not store the fal URL as `RoundState.videoUrl`.**

This package does not call fal or run the game loop. It only PUTs bytes and returns the CDN URL.

## Spaces upload

```ts
import { uploadFightVideo } from "@horror-tube/fight-media";

const videoUrl = await uploadFightVideo({ body: mp4Bytes });
// videoUrl = https://<FIGHT_MEDIA_SPACES_CDN_HOST>/videos/<uuid>.mp4
```

Requires `FIGHT_MEDIA_SPACES_*` from `.env` (see root `.env.example`). Missing or blank values fail by name. Object keys are always a fresh `videos/<uuid>.mp4` (never overwrite). Upload failure does not return a placeholder URL.

Issue #53 will use `frames/` in the same bucket.
