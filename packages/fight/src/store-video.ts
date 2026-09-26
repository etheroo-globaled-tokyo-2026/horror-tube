import { FightError } from "./env.js";

/** Minimal fetch shape so tests can stub the HTTP boundary without a real network. */
export type FetchLike = (
  url: string,
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/**
 * Download fight mp4 bytes from a generator URL (fal). Fails closed on blank URL,
 * transport errors, non-OK HTTP, or an empty body — never returns placeholder bytes.
 */
export async function downloadFightVideoBytes(
  url: string,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<Uint8Array> {
  const trimmed = url.trim();
  if (trimmed === "") {
    throw new FightError(
      "fight video download URL is blank. Refusing to fetch. Refusing to keep a fal URL as RoundState.videoUrl.",
    );
  }

  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(trimmed);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new FightError(
      `fight video download failed for ${JSON.stringify(trimmed)}: ${detail}. Refusing to keep a fal URL as RoundState.videoUrl.`,
      { cause },
    );
  }

  if (!response.ok) {
    throw new FightError(
      `fight video download failed for ${JSON.stringify(trimmed)}: HTTP ${String(response.status)} ${response.statusText}. Refusing to keep a fal URL as RoundState.videoUrl.`,
    );
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await response.arrayBuffer();
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new FightError(
      `fight video download body read failed for ${JSON.stringify(trimmed)}: ${detail}. Refusing to keep a fal URL as RoundState.videoUrl.`,
      { cause },
    );
  }

  if (buffer.byteLength === 0) {
    throw new FightError(
      `fight video download returned empty body for ${JSON.stringify(trimmed)}. Refusing to upload. Refusing to keep a fal URL as RoundState.videoUrl.`,
    );
  }

  return new Uint8Array(buffer);
}
