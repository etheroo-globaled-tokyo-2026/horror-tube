import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FightError } from "./env.js";

export type RunFfmpeg = (
  args: readonly string[],
) => Promise<{ code: number; stderr: string }>;

const SEEK_NEAR_END = ["-sseof", "-1"];
const WRITE_ONE_JPEG_FRAME = ["-frames:v", "1", "-q:v", "2"];

export async function defaultRunFfmpeg(
  args: readonly string[],
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      reject(err);
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stderr });
    });
  });
}

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
      result = await runFfmpeg([
        "-y",
        ...SEEK_NEAR_END,
        "-i",
        mp4Path,
        ...WRITE_ONE_JPEG_FRAME,
        jpgPath,
      ]);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new FightError(
        `ffmpeg failed to start while extracting the last fight frame: ${detail}. Refusing to seed the next video without a frame.`,
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
