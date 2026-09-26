import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { FightError } from "./env.js";
import { defaultRunFfmpeg, type RunFfmpeg } from "./extract-frame.js";

/** Decaying-noise reverb impulse the voice chain convolves with. The build copies assets/ into dist/. */
const IMPULSE_PATH = fileURLToPath(new URL("./assets/demon-impulse.wav", import.meta.url));

const SAMPLE_RATE = 44100;

/** FAITH's possessed-Michael ("demon") voice chain settings. */
const DEMON_FX = {
  pitchSemitones: -12,
  reverbLowpassHz: 3500,
  wetDb: -10,
  crushRateHz: 11025,
  crushBits: 6,
  highpassHz: 70,
  lowpassHz: 14000,
} as const;

function demonFilterGraph(): string {
  const ratio = 2 ** (DEMON_FX.pitchSemitones / 12);
  const hold = Math.round(SAMPLE_RATE / DEMON_FX.crushRateHz);
  const { highpassHz: hp, lowpassHz: lp } = DEMON_FX;
  return [
    // Tape-style pitch shift, with the length restored.
    `[0:a]aresample=${SAMPLE_RATE},asetrate=${SAMPLE_RATE}*${ratio.toFixed(4)},aresample=${SAMPLE_RATE},atempo=${(1 / ratio).toFixed(4)},asplit=2[dry][w]`,
    `[w][1:a]afir=dry=1:wet=1:irnorm=2:gtype=none,lowpass=f=${DEMON_FX.reverbLowpassHz},volume=${DEMON_FX.wetDb}dB[wet]`,
    // Sample-and-hold crush with no anti-aliasing, then a 4-pole band-pass each side.
    `[dry][wet]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.9,acrusher=bits=${DEMON_FX.crushBits}:mode=lin:aa=0:samples=${hold},highpass=f=${hp},highpass=f=${hp},lowpass=f=${lp},lowpass=f=${lp},loudnorm=I=-16:TP=-1.5[a]`,
  ].join(";");
}

/**
 * Run a fight video's sound through FAITH's possessed-demon voice chain. The
 * video stream is copied as it is. Fails closed: a clip without sound or an
 * ffmpeg failure is an error, never the unprocessed clip.
 */
export async function applyDemonSound(
  mp4Bytes: Uint8Array,
  runFfmpeg: RunFfmpeg = defaultRunFfmpeg,
): Promise<Uint8Array> {
  if (mp4Bytes.byteLength === 0) {
    throw new FightError("fight video bytes are empty. Refusing to run the demon sound.");
  }

  const dir = await mkdtemp(join(tmpdir(), "horror-tube-demon-"));
  const inPath = join(dir, "fight.mp4");
  const outPath = join(dir, "demon.mp4");

  try {
    await writeFile(inPath, mp4Bytes);

    let result: { code: number; stderr: string };
    try {
      result = await runFfmpeg([
        "-loglevel",
        "error",
        "-y",
        "-i",
        inPath,
        "-i",
        IMPULSE_PATH,
        "-filter_complex",
        demonFilterGraph(),
        "-map",
        "0:v",
        "-map",
        "[a]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        outPath,
      ]);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new FightError(
        `ffmpeg failed while running the demon sound: ${detail}. Refusing to upload the video without it.`,
        { cause },
      );
    }

    if (result.code !== 0) {
      throw new FightError(
        `ffmpeg exited ${String(result.code)} while running the demon sound: ${result.stderr.trim()}. Refusing to upload the video without it.`,
      );
    }

    let out: Buffer;
    try {
      out = await readFile(outPath);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new FightError(
        `ffmpeg reported success but the demon-sound video could not be read: ${detail}.`,
        { cause },
      );
    }
    if (out.byteLength === 0) {
      throw new FightError("ffmpeg wrote an empty demon-sound video.");
    }
    return new Uint8Array(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
