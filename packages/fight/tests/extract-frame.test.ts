import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { extractLastFrameJpeg } from "../src/extract-frame.js";

const JPEG_START_OF_IMAGE = [0xff, 0xd8];

describe("extractLastFrameJpeg", () => {
  it("returns JPEG bytes from an injectable ffmpeg that writes the output path", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const frame = await extractLastFrameJpeg(new Uint8Array([1, 2, 3, 4]), async (args) => {
      const outPath = args.at(-1);
      assert.ok(outPath !== undefined);
      await writeFile(outPath, jpeg);
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

const systemFfmpegOnPath =
  spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0;
if (systemFfmpegOnPath) {
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
        assert.deepEqual([...jpeg.subarray(0, 2)], JPEG_START_OF_IMAGE);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
}
