import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractLastFrameJpeg } from "../src/extract-frame.js";

describe("extractLastFrameJpeg", () => {
  it("returns JPEG bytes from an injectable ffmpeg that writes the output path", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const frame = await extractLastFrameJpeg(new Uint8Array([1, 2, 3, 4]), async (args) => {
      const outPath = args[args.length - 1];
      assert.equal(typeof outPath, "string");
      const { writeFile } = await import("node:fs/promises");
      await writeFile(outPath as string, jpeg);
      return { code: 0, stderr: "" };
    });
    assert.deepEqual(frame, jpeg);
  });

  it("fails closed when ffmpeg exits non-zero", async () => {
    await assert.rejects(
      () =>
        extractLastFrameJpeg(new Uint8Array([1]), async () => ({
          code: 1,
          stderr: "Invalid data found when processing input",
        })),
      /ffmpeg exited 1.*Refusing to seed the next video/,
    );
  });

  it("fails closed when mp4 bytes are empty", async () => {
    await assert.rejects(
      () => extractLastFrameJpeg(new Uint8Array(), async () => ({ code: 0, stderr: "" })),
      /empty/,
    );
  });
});

// Real ffmpeg path: only registered when the binary is on PATH. No it.skip —
// a missing binary simply means this block is not defined, so CI stays green
// without a skipped "pass". Environments with ffmpeg fail if extract is broken.
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ffmpegProbe = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
if (ffmpegProbe.status === 0) {
  describe("extractLastFrameJpeg with system ffmpeg", () => {
    it("extracts a JPEG from a tiny generated mp4", async () => {
      const dir = await mkdtemp(join(tmpdir(), "horror-tube-ffmpeg-fixture-"));
      const mp4Path = join(dir, "tiny.mp4");
      try {
        const gen = spawnSync(
          "ffmpeg",
          [
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=64x64:d=0.5",
            "-pix_fmt",
            "yuv420p",
            mp4Path,
          ],
          { encoding: "utf8" },
        );
        assert.equal(
          gen.status,
          0,
          `ffmpeg fixture generation failed: ${gen.stderr}`,
        );
        const mp4 = await readFile(mp4Path);
        const jpeg = await extractLastFrameJpeg(mp4);
        assert.ok(jpeg.byteLength > 0);
        // JPEG SOI marker
        assert.equal(jpeg[0], 0xff);
        assert.equal(jpeg[1], 0xd8);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
}
