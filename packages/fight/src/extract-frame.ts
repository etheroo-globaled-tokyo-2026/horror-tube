import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FightError } from "./env.js";

export type RunFfmpeg = (
  args: readonly string[],
) => Promise<{ code: number; stderr: string }>;

/** Longest one ffmpeg run may take before it is killed. */
const FFMPEG_TIMEOUT_MS = 120_000;

/** Spawn system ffmpeg. Injectable in tests so CI never skips around a missing binary. */
export async function defaultRunFfmpeg(
  args: readonly string[],
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [...args], {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: FFMPEG_TIMEOUT_MS,
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    child.on("error", (err) => {
      reject(err);
    });
    child.on("close", (code, signal) => {
      if (signal !== null) {
        reject(
          new Error(
            `ffmpeg was stopped by ${signal} (runs are killed after ${String(FFMPEG_TIMEOUT_MS)} ms): ${stderr.trim()}`,
          ),
        );
        return;
      }
      resolve({ code: code ?? 1, stderr });
    });
  });
}

/**
 * Extract the last decoded frame of an mp4 as JPEG bytes via ffmpeg.
 * Fails closed — no fixture still and no empty buffer.
 */
export async function extractLastFrameJpeg(
  mp4Bytes: Uint8Array,
  runFfmpeg: RunFfmpeg = defaultRunFfmpeg,
): Promise<Uint8Array> {
  if (mp4Bytes.byteLength === 0) {
    throw new FightError(
      "fight video bytes are empty. Refusing to extract a last frame for the next fight seed.",
    );
  }

  const dir = await mkdtemp(join(tmpdir(), "horror-tube-frame-"));
  const mp4Path = join(dir, "fight.mp4");
  const jpgPath = join(dir, "last.jpg");

  try {
    await writeFile(mp4Path, mp4Bytes);

    let result: { code: number; stderr: string };
    try {
      // -sseof -1 seeks near the end; -frames:v 1 writes one JPEG.
      result = await runFfmpeg([
        "-y",
        "-sseof",
        "-1",
        "-i",
        mp4Path,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        jpgPath,
      ]);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new FightError(
        `ffmpeg failed while extracting the last fight frame: ${detail}. Refusing to seed the next video without a frame.`,
        { cause },
      );
    }

    if (result.code !== 0) {
      throw new FightError(
        `ffmpeg exited ${String(result.code)} while extracting the last fight frame: ${result.stderr.slice(0, 500)}. Refusing to seed the next video without a frame.`,
      );
    }

    let jpeg: Buffer;
    try {
      jpeg = await readFile(jpgPath);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new FightError(
        `ffmpeg reported success but the last-frame JPEG could not be read at ${JSON.stringify(jpgPath)}: ${detail}. Refusing to seed the next video without a frame.`,
        { cause },
      );
    }

    if (jpeg.byteLength === 0) {
      throw new FightError(
        "ffmpeg wrote an empty last-frame JPEG. Refusing to seed the next video without a frame.",
      );
    }

    return new Uint8Array(jpeg);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
