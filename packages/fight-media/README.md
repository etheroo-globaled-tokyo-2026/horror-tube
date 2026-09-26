# @horror-tube/fight-media

Upload fight mp4 bytes (and last-frame JPEGs) to DigitalOcean Spaces and return durable public CDN URLs.

## Generator (fal) — not implemented here

Fight videos are generated with fal MiniMax H3 Max:

- Text-to-video (first bout): https://fal.ai/models/minimax/h3-max/text-to-video — operator value for `FAL_MODEL`
- Image-to-video (later bouts): https://fal.ai/models/minimax/h3-max/image-to-video — operator value for `FAL_IMAGE_TO_VIDEO_MODEL`; field `image_url`
- Result: an mp4 at `video.url` on a `fal.media` host

Those fal URLs expire. `@horror-tube/fight` `runFightTurn` downloads the mp4 bytes, then calls `uploadFightVideo` so Spaces holds a durable copy. **Do not store the fal URL as `RoundState.videoUrl`.** After upload it extracts the last frame with ffmpeg and calls `uploadFightFrame` for `RoundState.frameUrl`.

This package does not call fal or run the game loop. It only PUTs bytes and returns the CDN URL.

## Spaces upload

```ts
import { uploadFightVideo, uploadFightFrame } from "@horror-tube/fight-media";

const videoUrl = await uploadFightVideo({ body: mp4Bytes });
// videoUrl = https://<FIGHT_MEDIA_SPACES_CDN_HOST>/videos/<uuid>.mp4

const frameUrl = await uploadFightFrame({ body: jpegBytes });
// frameUrl = https://<FIGHT_MEDIA_SPACES_CDN_HOST>/frames/<uuid>.jpg
```

Requires `FIGHT_MEDIA_SPACES_*` from `.env` (see root `.env.example`). Missing or blank values fail by name. Object keys are always a fresh `videos/<uuid>.mp4` or `frames/<uuid>.jpg` (never overwrite). Upload failure does not return a placeholder URL.
