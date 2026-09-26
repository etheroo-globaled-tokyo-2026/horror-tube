import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { applyDemonSound } from "../src/demon-sound.js";

describe("applyDemonSound", () => {
  it("fails closed with ffmpeg's reason when ffmpeg exits non-zero", async () => {
    await assert.rejects(
      () =>
        applyDemonSound(new Uint8Array([1, 2, 3]), async () => ({
          code: 1,
          stderr: "Stream specifier ':a' in filtergraph description matches no streams.",
        })),
      /ffmpeg exited 1 while running the demon sound: Stream specifier ':a'/,
    );
  });
});

// Real ffmpeg: registered only when the binary is on PATH, as in extract-frame.test.ts.
if (spawnSync("ffmpeg", ["-version"]).status === 0) {
  const SAMPLE_RATE = 44100;

  const ffmpeg = (args: string[]): Buffer => {
    const run = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], {
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.equal(run.status, 0, run.stderr.toString());
    return run.stdout;
  };

  /** Power of one frequency in the signal (Goertzel). */
  const power = (samples: Float32Array, hz: number): number => {
    const coeff = 2 * Math.cos((2 * Math.PI * hz) / SAMPLE_RATE);
    let s1 = 0;
    let s2 = 0;
    for (const x of samples) {
      const s0 = x + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    return s1 * s1 + s2 * s2 - coeff * s1 * s2;
  };

  describe("applyDemonSound with system ffmpeg", () => {
    it("drops the sound an octave and keeps the video stream as it was", async () => {
      const dir = await mkdtemp(join(tmpdir(), "horror-tube-demon-test-"));
      try {
        const clip = join(dir, "clip.mp4");
        const demon = join(dir, "demon.mp4");
        ffmpeg([
          "-f",
          "lavfi",
          "-i",
          "testsrc=size=64x36:rate=15:duration=1",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=880:duration=1",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          clip,
        ]);
        await writeFile(demon, await applyDemonSound(await readFile(clip)));

        const videoHash = (path: string) =>
          ffmpeg(["-i", path, "-map", "0:v", "-c", "copy", "-f", "md5", "-"]).toString();
        assert.equal(videoHash(demon), videoHash(clip));

        const pcm = ffmpeg([
          "-i",
          demon,
          "-map",
          "0:a",
          "-ac",
          "1",
          "-ar",
          String(SAMPLE_RATE),
          "-f",
          "f32le",
          "-",
        ]);
        const samples = new Float32Array(new Uint8Array(pcm).buffer);
        assert.ok(power(samples, 440) > 10 * power(samples, 880));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
}
